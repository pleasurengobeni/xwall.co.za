'use strict';
const express = require('express');
const router  = express.Router();

const analytics = require('../db/analytics');
const { track: trackLimit, weather: weatherLimit } = require('../middleware/rateLimit');

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
      const response = await fetch(
        'https://www.googleapis.com/youtube/v3/playlists?part=snippet&mine=true&maxResults=20',
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        return res.status(response.status).json({ error: err.error?.message || 'YouTube API error' });
      }
      const data = await response.json();
      const playlists = (data.items || []).map((p) => ({
        id:       p.id,
        name:     p.snippet?.title ?? 'Untitled',
        image:    p.snippet?.thumbnails?.default?.url ?? null,
        provider: 'youtube',
      }));
      return res.json({ playlists });
    }

    res.status(400).json({ error: 'Unknown provider' });
  } catch (err) {
    console.error('Playlist fetch error:', err.message);
    res.status(500).json({ error: 'Failed to fetch playlists' });
  }
});

module.exports = router;
