'use strict';
const express = require('express');
const router  = express.Router();

const analytics = require('../db/analytics');
const { track: trackLimit, weather: weatherLimit } = require('../middleware/rateLimit');

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

function requireAuth(req, res, next) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

// ── POST /api/track ──────────────────────────────────────────────────────────
// Records a client-side behavioural event (mode_select, video_select, launch, etc.)
router.post('/track', trackLimit, async (req, res) => {
  const { event, data } = req.body;
  if (!event || typeof event !== 'string' || event.length > 64) {
    return res.status(400).json({ error: 'invalid event' });
  }
  await analytics.recordEvent({
    visitorId:  req.session?._vid  || null,
    sessionId:  req.session?.id    || null,
    event:      event.replace(/[^a-z0-9_]/gi, '_').toLowerCase(),
    data:       typeof data === 'object' ? data : null,
  });
  res.json({ ok: true });
});

// ── GET /api/weather ──────────────────────────────────────────────────────────
// Server-side proxy: IP → coordinates (ip-api.com) → current weather (Open-Meteo).
// No auth, no browser geolocation permission, no external CSP entries needed.
router.get('/weather', weatherLimit, async (req, res) => {
  try {
    // req.ip is set correctly when trust proxy is configured in server.js
    const rawIp   = (req.ip || '').replace(/^::ffff:/, '').trim();
    const isLocal = rawIp === '127.0.0.1' || rawIp === '::1' || rawIp === '';

    // Validate IP format before embedding in URL to prevent SSRF via injection
    if (!isLocal && !/^[\da-f.:]+$/i.test(rawIp)) {
      return res.status(400).json({ error: 'Bad request' });
    }

    const geoUrl = isLocal ? 'http://ip-api.com/json' : `http://ip-api.com/json/${rawIp}`;
    const geoRes = await fetch(geoUrl);
    const geo    = await geoRes.json();
    if (geo.status !== 'success') throw new Error('geo lookup failed');

    // Validate coordinates before embedding in URL
    const lat = parseFloat(geo.lat);
    const lon = parseFloat(geo.lon);
    if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      throw new Error('invalid coordinates');
    }

    const wxRes = await fetch(
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,weather_code`
    );
    if (!wxRes.ok) throw new Error('weather api failed');
    const wx = await wxRes.json();

    res.json({
      temp: Math.round(wx.current.temperature_2m),
      code: wx.current.weather_code,
    });
  } catch (_) {
    res.status(503).json({ error: 'Weather unavailable' });
  }
});
// ── GET /api/playlists ────────────────────────────────────────────────────────
// Fetches the signed-in user's playlists from YouTube or Spotify.
// Tokens live only in the server-side session — never sent to the browser.
router.get('/playlists', requireAuth, async (req, res) => {
  const { provider, accessToken } = req.user;

  try {
    if (provider === 'spotify') {
      const response = await fetch(
        'https://api.spotify.com/v1/me/playlists?limit=20',
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        return res.status(response.status).json({ error: err.error?.message || 'Spotify API error' });
      }
      const data = await response.json();
      const playlists = data.items.map((p) => ({
        id:       p.id,
        name:     p.name,
        image:    p.images?.[0]?.url ?? null,
        provider: 'spotify',
      }));
      return res.json({ playlists });
    }

    if (provider === 'google') {
      const authHeader = { Authorization: `Bearer ${accessToken}` };

      // Fetch the authenticated channel identity in parallel with playlists
      const [channelRes, playlistRes] = await Promise.all([
        fetch(
          'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&maxResults=1',
          { headers: authHeader }
        ),
        fetch(
          'https://www.googleapis.com/youtube/v3/playlists?part=snippet&mine=true&maxResults=50',
          { headers: authHeader }
        ),
      ]);

      if (!playlistRes.ok) {
        const err = await playlistRes.json().catch(() => ({}));
        return res.status(playlistRes.status).json({ error: err.error?.message || 'YouTube API error' });
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
// Search YouTube for public playlists by keyword. No auth required.
router.get('/playlists/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Missing q parameter' });

  const limit = Math.min(parseInt(req.query.limit || '8', 10), 20);
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'Search unavailable' });
  }

  try {
    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('type', 'playlist');
    url.searchParams.set('q', q);
    url.searchParams.set('maxResults', String(limit));
    url.searchParams.set('key', apiKey);

    const searchRes = await fetch(url.toString());
    if (!searchRes.ok) {
      return res.status(502).json({ error: 'YouTube search failed' });
    }
    const data = await searchRes.json();
    const playlists = (data.items || []).map((item) => ({
      id:       item.id?.playlistId,
      name:     item.snippet?.title ?? 'Untitled',
      image:    item.snippet?.thumbnails?.medium?.url ?? item.snippet?.thumbnails?.default?.url ?? null,
      provider: 'youtube',
    })).filter((p) => p.id);

    res.json({ playlists });
  } catch (err) {
    console.error('Playlist search error:', err.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

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

  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return res.json(fallbackPayload());
  }

  try {
    const searchParams = new URLSearchParams({
      key:             apiKey,
      part:            'snippet',
      type:            'video',
      q:               query,
      maxResults:      '25',
      videoDuration:   'long',
      videoEmbeddable: 'true',
      safeSearch:      'moderate',
      relevanceLanguage: 'en',
    });

    const searchRes = await fetch(`https://www.googleapis.com/youtube/v3/search?${searchParams}`);
    if (!searchRes.ok) {
      return res.json(fallbackPayload());
    }

    const searchData = await searchRes.json();
    const videoIds = (searchData.items || [])
      .map((item) => item?.id?.videoId)
      .filter(Boolean);

    if (!videoIds.length) return res.json(fallbackPayload());

    const detailsParams = new URLSearchParams({
      key:  apiKey,
      part: 'snippet,contentDetails',
      id:   videoIds.join(','),
      maxResults: String(Math.min(videoIds.length, 50)),
    });

    const detailsRes = await fetch(`https://www.googleapis.com/youtube/v3/videos?${detailsParams}`);
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
      .slice(0, limit)
      .map(({ durationSecs, ...rest }) => rest);

    if (!videos.length) return res.json(fallbackPayload());
    return res.json({ videos, fallback: false });
  } catch (err) {
    console.error('Video suggestion error:', err.message);
    return res.json(fallbackPayload());
  }
});

module.exports = router;
