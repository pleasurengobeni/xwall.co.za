'use strict';
const express = require('express');
const fs      = require('fs');
const path    = require('path');
const router  = express.Router();

const analytics = require('../db/analytics');
const geo       = require('../lib/geo');
const { fetchWithTimeout, createTtlCache } = require('../lib/http');
const { getAccessToken, authorizedFetch } = require('../lib/tokens');
const {
  track:   trackLimit,
  weather: weatherLimit,
  search:  searchLimit,
} = require('../middleware/rateLimit');

// Events the client is allowed to record. Anything else is rejected so the
// events table can't be filled with arbitrary junk.
const TRACKABLE_EVENTS = new Set(['mode_select', 'video_select', 'launch', 'clock_style_select', 'player_error']);

// Upstream quota protection: YouTube search costs 100 units per call against a
// 10k/day default quota, so identical requests are served from memory.
const suggestionCache = createTtlCache({ ttlMs: 6 * 60 * 60 * 1000, max: 20 });
// Search results are public and change slowly, so one lookup of a popular
// query serves every visitor for a day. This is the main defence for the
// project's 10k/day quota: ~100 YouTube searches a day is the hard ceiling.
const searchCache     = createTtlCache({ ttlMs: 24 * 60 * 60 * 1000, max: 2000 });
const weatherCache    = createTtlCache({ ttlMs: 10 * 60 * 1000, max: 2000 });

const MODE_SEARCH_QUERIES = {
  fireplace: 'fireplace ambience crackling fire 4k',
  rain:      'rain ambience nature 4k',
  river:     'river ambience nature sounds 4k',
  scenic:    'outer space ambience stars galaxy earth 4k',
  space:     'outer space ambience stars galaxy earth 4k',
};

const MODE_FALLBACK_VIDEOS = {
  fireplace: [
    { id: 'L_LUpnjgPso', title: 'Cozy Hearth', thumbnail: 'https://i.ytimg.com/vi/L_LUpnjgPso/mqdefault.jpg', durationLabel: '30+ min' },
    { id: 'q76bMs-NwRk', title: 'Warm Ambience', thumbnail: 'https://i.ytimg.com/vi/q76bMs-NwRk/mqdefault.jpg', durationLabel: '30+ min' },
    { id: 'V1bFr2SWP1I', title: 'Cabin Stream + Fire', thumbnail: 'https://i.ytimg.com/vi/V1bFr2SWP1I/mqdefault.jpg', durationLabel: '30+ min' },
    { id: 'BHACKCNDMW8', title: 'Night Fireplace Atmosphere', thumbnail: 'https://i.ytimg.com/vi/BHACKCNDMW8/mqdefault.jpg', durationLabel: '30+ min' },
  ],
  rain: [
    { id: 'q76bMs-NwRk', title: 'Rain on Window', thumbnail: 'https://i.ytimg.com/vi/q76bMs-NwRk/mqdefault.jpg', durationLabel: '30+ min' },
    { id: 'nDq6TstdEi8', title: 'Rainy Night', thumbnail: 'https://i.ytimg.com/vi/nDq6TstdEi8/mqdefault.jpg', durationLabel: '30+ min' },
    { id: 'V1bFr2SWP1I', title: 'Rain by the River', thumbnail: 'https://i.ytimg.com/vi/V1bFr2SWP1I/mqdefault.jpg', durationLabel: '30+ min' },
    { id: '2OEL4P1Rz04', title: 'Waterfall Mist', thumbnail: 'https://i.ytimg.com/vi/2OEL4P1Rz04/mqdefault.jpg', durationLabel: '30+ min' },
  ],
  river: [
    { id: 'V1bFr2SWP1I', title: 'Mountain Stream', thumbnail: 'https://i.ytimg.com/vi/V1bFr2SWP1I/mqdefault.jpg', durationLabel: '30+ min' },
    { id: '2OEL4P1Rz04', title: 'Waterfall', thumbnail: 'https://i.ytimg.com/vi/2OEL4P1Rz04/mqdefault.jpg', durationLabel: '30+ min' },
    { id: 'nDq6TstdEi8', title: 'River at Night', thumbnail: 'https://i.ytimg.com/vi/nDq6TstdEi8/mqdefault.jpg', durationLabel: '30+ min' },
    { id: 'q76bMs-NwRk', title: 'Calm Brook', thumbnail: 'https://i.ytimg.com/vi/q76bMs-NwRk/mqdefault.jpg', durationLabel: '30+ min' },
  ],
  scenic: [
    { id: 'BHACKCNDMW8', title: 'Deep Space Drift', thumbnail: 'https://i.ytimg.com/vi/BHACKCNDMW8/mqdefault.jpg', durationLabel: '30+ min' },
    { id: 'DWcJFNfaw9c', title: 'Stars and Nebulae', thumbnail: 'https://i.ytimg.com/vi/DWcJFNfaw9c/mqdefault.jpg', durationLabel: '30+ min' },
    { id: '3sL0omwElxw', title: 'Cosmic Silence', thumbnail: 'https://i.ytimg.com/vi/3sL0omwElxw/mqdefault.jpg', durationLabel: '30+ min' },
    { id: 'V1bFr2SWP1I', title: 'Orbit Window', thumbnail: 'https://i.ytimg.com/vi/V1bFr2SWP1I/mqdefault.jpg', durationLabel: '30+ min' },
  ],
};

function fallbackVideosForMode(mode, limit) {
  const canonicalMode = mode === 'space' ? 'scenic' : mode;
  const source = MODE_FALLBACK_VIDEOS[canonicalMode] || [];
  return source.slice(0, limit).map((item) => ({ ...item }));
}

function parseIso8601DurationToSeconds(value) {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i.exec(value || '');
  if (!match) return 0;
  const hours = parseInt(match[1] || '0', 10);
  const mins  = parseInt(match[2] || '0', 10);
  const secs  = parseInt(match[3] || '0', 10);
  return (hours * 3600) + (mins * 60) + secs;
}

function secondsToLabel(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const mins  = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

// Expired access tokens are renewed transparently (lib/tokens.js). A 401 that
// survives the refresh means the user revoked access or has no refresh token,
// so flag it and the client prompts a fresh sign-in.
function upstreamError(status, body, fallbackMessage) {
  const payload = { error: body?.error?.message || fallbackMessage };
  if (status === 401) payload.reauth = true;
  return payload;
}

function requireAuth(req, res, next) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

// ── POST /api/track ──────────────────────────────────────────────────────────
// Records a client-side behavioural event (mode_select, video_select, launch, etc.)
router.post('/track', trackLimit, async (req, res) => {
  const { event } = req.body || {};
  if (typeof event !== 'string' || !TRACKABLE_EVENTS.has(event)) {
    return res.status(400).json({ error: 'invalid event' });
  }
  try {
    await analytics.recordEvent({
      visitorId:  req.session?._vid  || null,
      sessionId:  req.session?.id    || null,
      event,
      data:       sanitizeEventData(req.body.data),
    });
  } catch (err) {
    console.error('Track event error:', err.message);
  }
  res.json({ ok: true });
});

// Accept only a small flat object of primitive values.
function sanitizeEventData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const clean = {};
  for (const [key, value] of Object.entries(data).slice(0, 10)) {
    if (!/^[a-zA-Z0-9_]{1,32}$/.test(key)) continue;
    if (typeof value === 'string')                              clean[key] = value.slice(0, 200);
    else if (typeof value === 'number' && Number.isFinite(value)) clean[key] = value;
    else if (typeof value === 'boolean' || value === null)      clean[key] = value;
  }
  return Object.keys(clean).length ? clean : null;
}

// ── GET /api/media ───────────────────────────────────────────────────────────
// Lists self-hosted ambient videos ("xwall originals"). Drop a file into
// media/<mode>/ and it appears in the app — no code change or deploy needed.
// nginx serves the files themselves straight from disk at /media/.
//
//   media/fireplace/cozy-hearth.mp4   (+ optional cozy-hearth.jpg poster)
//   media/rain/…  media/river/…  media/space/…
const MEDIA_FOLDERS = { fireplace: 'fireplace', rain: 'rain', river: 'river', space: 'scenic', scenic: 'scenic' };
const MEDIA_VIDEO_EXT  = new Set(['.mp4', '.webm']);
const MEDIA_POSTER_EXT = ['.jpg', '.jpeg', '.webp', '.png'];
const MEDIA_SAFE_NAME  = /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/;
let _mediaListing = { dir: null, at: 0, value: null };

function _mediaDir() {
  return process.env.MEDIA_DIR || path.join(__dirname, '..', 'media');
}

function _titleFromFilename(base) {
  const words = base.replace(/[-_.]+/g, ' ').replace(/\s+/g, ' ').trim();
  return words ? words.replace(/\b\w/g, (c) => c.toUpperCase()) : 'Ambient';
}

function listLocalMedia() {
  const dir = _mediaDir();
  const now = Date.now();
  if (_mediaListing.value && _mediaListing.dir === dir && now - _mediaListing.at < 30_000) {
    return _mediaListing.value;
  }

  const videos = { fireplace: [], rain: [], river: [], scenic: [] };
  let folders = [];
  try { folders = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { folders = []; }

  for (const folder of folders) {
    const mode = folder.isDirectory() ? MEDIA_FOLDERS[folder.name] : null;
    if (!mode) continue;
    let files = [];
    try { files = fs.readdirSync(path.join(dir, folder.name)); } catch (_) { continue; }
    const present = new Set(files);

    for (const file of files.sort()) {
      const ext = path.extname(file).toLowerCase();
      if (!MEDIA_VIDEO_EXT.has(ext) || !MEDIA_SAFE_NAME.test(file)) continue;
      const base   = file.slice(0, -ext.length);
      const poster = MEDIA_POSTER_EXT.map((e) => base + e).find((n) => present.has(n));
      const src    = `/media/${folder.name}/${encodeURIComponent(file)}`;
      videos[mode].push({
        id:            `local:${src}`,
        title:         _titleFromFilename(base),
        src,
        thumbnail:     poster ? `/media/${folder.name}/${encodeURIComponent(poster)}` : null,
        durationLabel: 'xwall original',
        local:         true,
      });
    }
  }

  _mediaListing = { dir, at: now, value: videos };
  return videos;
}

router.get('/media', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ videos: listLocalMedia() });
});

// ── GET /api/weather ──────────────────────────────────────────────────────────
// Server-side proxy: IP → coordinates (ip-api.com) → current weather (Open-Meteo).
// No auth, no browser geolocation permission, no external CSP entries needed.
router.get('/weather', weatherLimit, async (req, res) => {
  try {
    // req.ip is set correctly when trust proxy is configured in server.js;
    // lib/geo validates it before it is embedded in a URL.
    const location = await geo.lookup(req.ip);
    if (!location.ok || location.lat === null || location.lon === null) {
      throw new Error('geo lookup failed');
    }

    // ~11 km grid so nearby visitors share one upstream call
    const lat = Math.round(location.lat * 10) / 10;
    const lon = Math.round(location.lon * 10) / 10;
    const cacheKey = `${lat},${lon}`;

    let payload = weatherCache.get(cacheKey);
    if (!payload) {
      const wxRes = await fetchWithTimeout(
        `https://api.open-meteo.com/v1/forecast` +
        `?latitude=${lat}&longitude=${lon}` +
        `&current=temperature_2m,weather_code`
      );
      if (!wxRes.ok) throw new Error('weather api failed');
      const wx   = await wxRes.json();
      const temp = Number(wx?.current?.temperature_2m);
      const code = Number(wx?.current?.weather_code);
      if (!Number.isFinite(temp) || !Number.isInteger(code)) throw new Error('bad weather payload');
      payload = { temp: Math.round(temp), code };
      weatherCache.set(cacheKey, payload);
    }

    res.set('Cache-Control', 'private, max-age=600');
    res.json(payload);
  } catch (_) {
    res.status(503).json({ error: 'Weather unavailable' });
  }
});

// ── GET /api/playlists ────────────────────────────────────────────────────────
// Fetches the signed-in user's playlists from YouTube or Spotify.
// Tokens live only in the server-side session — never sent to the browser.
router.get('/playlists', requireAuth, async (req, res) => {
  const { provider } = req.user;

  try {
    if (provider === 'spotify') {
      const response = await authorizedFetch(req, 'https://api.spotify.com/v1/me/playlists?limit=50');
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        return res.status(response.status).json(upstreamError(response.status, err, 'Spotify API error'));
      }
      const data = await response.json();
      const playlists = (data.items || []).filter(Boolean).map((p) => ({
        id:       p.id,
        name:     p.name,
        image:    p.images?.[0]?.url ?? null,
        provider: 'spotify',
      }));
      return res.json({ playlists });
    }

    if (provider === 'google') {
      // Renew an expired token once, up front, before the two parallel calls
      await getAccessToken(req);

      // Fetch the authenticated channel identity in parallel with playlists
      const [channelRes, playlistRes] = await Promise.all([
        authorizedFetch(req,
          'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&maxResults=1'),
        authorizedFetch(req,
          'https://www.googleapis.com/youtube/v3/playlists?part=snippet&mine=true&maxResults=50'),
      ]);

      if (!playlistRes.ok) {
        const err = await playlistRes.json().catch(() => ({}));
        return res.status(playlistRes.status).json(upstreamError(playlistRes.status, err, 'YouTube API error'));
      }

      const [channelData, playlistData] = await Promise.all([
        channelRes.ok ? channelRes.json() : Promise.resolve(null),
        playlistRes.json(),
      ]);

      const channelSnippet = channelData?.items?.[0]?.snippet;
      const channelInfo = channelSnippet
        ? { title: channelSnippet.title, customUrl: channelSnippet.customUrl ?? null }
        : null;

      const playlists = (playlistData.items || []).map((p) => ({
        id:       p.id,
        name:     p.snippet?.title ?? 'Untitled',
        image:    p.snippet?.thumbnails?.default?.url ?? null,
        provider: 'youtube',
      }));
      return res.json({ playlists, channelInfo });
    }

    res.status(400).json({ error: 'Unknown provider' });
  } catch (err) {
    console.error('Playlist fetch error:', err.message);
    res.status(500).json({ error: 'Failed to fetch playlists' });
  }
});

// ── GET /api/playlists/search?q=lofi&limit=8 ──────────────────────────────
// Searches with the signed-in user's own account: Google users search YouTube
// with their OAuth token, Spotify users search Spotify with theirs. Visitors
// who are not signed in are asked to sign in — the app never searches on a
// shared server-side API key.
router.get('/playlists/search', (req, res, next) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Sign in to search playlists', signin: true });
  }

  const q = String(req.query.q || '').trim().replace(/\s+/g, ' ').slice(0, 100);
  if (!q) return res.status(400).json({ error: 'Missing q parameter' });

  const requestedLimit = parseInt(req.query.limit, 10);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 20)
    : 8;

  // Results are public data, so the cache is shared; the key includes the
  // provider so YouTube and Spotify results never mix.
  const provider = req.user.provider === 'spotify' ? 'spotify' : 'youtube';
  const cacheKey = `${provider}:${limit}:${q.toLowerCase()}`;
  const cached = searchCache.get(cacheKey);
  if (cached) return res.json({ playlists: cached, provider });

  res.locals.search = { q, limit, provider, cacheKey };
  next();
}, searchLimit, async (req, res) => {
  const { q, limit, provider, cacheKey } = res.locals.search;

  try {
    const playlists = provider === 'spotify'
      ? await _searchSpotifyPlaylists(req, q, limit, res)
      : await _searchYoutubePlaylists(req, q, limit, res);
    if (!playlists) return; // helper already sent an error response

    searchCache.set(cacheKey, playlists);
    res.json({ playlists, provider });
  } catch (err) {
    console.error('Playlist search error:', err.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

async function _searchYoutubePlaylists(req, q, limit, res) {
  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('type', 'playlist');
  url.searchParams.set('q', q);
  url.searchParams.set('maxResults', String(limit));
  url.searchParams.set('safeSearch', 'moderate');

  const searchRes = await authorizedFetch(req, url.toString());
  if (!searchRes.ok) {
    const err = await searchRes.json().catch(() => ({}));
    res.status(searchRes.status === 401 ? 401 : 502)
      .json(upstreamError(searchRes.status, err, 'YouTube search failed'));
    return null;
  }

  const data = await searchRes.json();
  return (data.items || []).map((item) => ({
    id:       item.id?.playlistId,
    name:     item.snippet?.title ?? 'Untitled',
    image:    item.snippet?.thumbnails?.medium?.url ?? item.snippet?.thumbnails?.default?.url ?? null,
    provider: 'youtube',
  })).filter((p) => p.id);
}

async function _searchSpotifyPlaylists(req, q, limit, res) {
  const url = new URL('https://api.spotify.com/v1/search');
  url.searchParams.set('q', q);
  url.searchParams.set('type', 'playlist');
  url.searchParams.set('limit', String(limit));

  const searchRes = await authorizedFetch(req, url.toString());
  if (!searchRes.ok) {
    const err = await searchRes.json().catch(() => ({}));
    res.status(searchRes.status === 401 ? 401 : 502)
      .json(upstreamError(searchRes.status, err, 'Spotify search failed'));
    return null;
  }

  const data = await searchRes.json();
  // Spotify occasionally returns null entries in this array
  return (data.playlists?.items || []).filter(Boolean).map((p) => ({
    id:       p.id,
    name:     p.name ?? 'Untitled',
    image:    p.images?.[0]?.url ?? null,
    provider: 'spotify',
  })).filter((p) => p.id);
}

// ── GET /api/videos/suggestions?mode=fireplace&limit=8 ─────────────────────
// Returns embeddable YouTube ambience videos filtered to >= 30 minutes.
router.get('/videos/suggestions', async (req, res) => {
  const mode = String(req.query.mode || '').toLowerCase();
  const query = MODE_SEARCH_QUERIES[mode];
  if (!query) {
    return res.status(400).json({ error: 'Unsupported mode' });
  }

  const requestedLimit = parseInt(req.query.limit, 10);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 12)
    : 8;

  const fallbackPayload = () => ({ videos: fallbackVideosForMode(mode, limit), fallback: true });

  // Cached results are public video listings, so everyone can be served from
  // them once a signed-in visitor has populated the cache.
  const canonicalMode = mode === 'space' ? 'scenic' : mode;
  const cached = suggestionCache.get(canonicalMode);
  if (cached) {
    return res.json({ videos: cached.slice(0, limit), fallback: false });
  }

  // Live lookups run on the signed-in Google user's own account. Visitors who
  // are not signed in get the bundled ambience list.
  const signedInWithGoogle = req.isAuthenticated() && req.user.provider === 'google';
  if (!signedInWithGoogle) {
    return res.json(fallbackPayload());
  }

  try {
    const searchParams = new URLSearchParams({
      part:            'snippet',
      type:            'video',
      q:               query,
      maxResults:      '25',
      videoDuration:   'long',
      videoEmbeddable: 'true',
      safeSearch:      'moderate',
      relevanceLanguage: 'en',
    });

    const searchRes = await authorizedFetch(req,
      `https://www.googleapis.com/youtube/v3/search?${searchParams}`);
    if (!searchRes.ok) {
      return res.json(fallbackPayload());
    }

    const searchData = await searchRes.json();
    const videoIds = (searchData.items || [])
      .map((item) => item?.id?.videoId)
      .filter(Boolean);

    if (!videoIds.length) return res.json(fallbackPayload());

    const detailsParams = new URLSearchParams({
      part: 'snippet,contentDetails',
      id:   videoIds.join(','),
      maxResults: String(Math.min(videoIds.length, 50)),
    });

    const detailsRes = await authorizedFetch(req,
      `https://www.googleapis.com/youtube/v3/videos?${detailsParams}`);
    if (!detailsRes.ok) {
      return res.json(fallbackPayload());
    }

    const detailsData = await detailsRes.json();
    const byId = new Map((detailsData.items || []).map((item) => [item.id, item]));

    const videos = videoIds
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((item) => {
        const seconds = parseIso8601DurationToSeconds(item.contentDetails?.duration);
        return {
          id:            item.id,
          title:         item.snippet?.title || 'Ambient Video',
          thumbnail:     item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || null,
          durationLabel: secondsToLabel(seconds),
          durationSecs:  seconds,
        };
      })
      .filter((v) => v.durationSecs >= 1800)
      .slice(0, 12)
      .map(({ durationSecs, ...rest }) => rest);

    if (!videos.length) return res.json(fallbackPayload());
    suggestionCache.set(canonicalMode, videos);
    return res.json({ videos: videos.slice(0, limit), fallback: false });
  } catch (err) {
    console.error('Video suggestion error:', err.message);
    return res.json(fallbackPayload());
  }
});

// Unknown API paths get a JSON 404 instead of falling through to the SPA page
router.use((_req, res) => res.status(404).json({ error: 'Not found' }));

module.exports = router;
