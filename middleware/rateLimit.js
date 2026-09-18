'use strict';
/**
 * middleware/rateLimit.js
 * Reusable rate-limit presets.  All limits are automatically bypassed in the
 * test environment so the Jest suite can hammer routes freely.
 */
const rateLimit = require('express-rate-limit');

const _skip = () => process.env.NODE_ENV === 'test';

const _base = {
  standardHeaders: true,   // RateLimit-* headers (RFC 6585)
  legacyHeaders:   false,   // no X-RateLimit-* (deprecated)
  skip:            _skip,
};

// Applied to every dynamic request (static assets and /ping are served first)
exports.general = rateLimit({
  ..._base,
  windowMs: 15 * 60 * 1000, // 15 min
  max:      300,
  message:  { error: 'Too many requests, please try again later.' },
});

// Admin login brute-force protection — only failed attempts count
exports.adminLogin = rateLimit({
  ..._base,
  windowMs: 15 * 60 * 1000, // 15 min
  max:      5,
  skipSuccessfulRequests: true,
  handler: (_req, res) => {
    res.redirect('/admin?error=Too+many+login+attempts.+Try+again+in+15+minutes');
  },
});

// POST /api/track (client-side events)
exports.track = rateLimit({
  ..._base,
  windowMs: 60 * 1000, // 1 min
  max:      60,
  message:  { error: 'Too many tracking requests.' },
});

// GET /api/weather (external API calls)
exports.weather = rateLimit({
  ..._base,
  windowMs: 60 * 1000, // 1 min
  max:      20,
  message:  { error: 'Too many weather requests.' },
});

// GET /api/playlists/search — searches run on the signed-in user's own
// account, so the limit is per user rather than per IP. It exists only to stop
// a runaway client from exhausting the shared YouTube project quota (each
// uncached YouTube search costs 100 of 10,000 daily units); Spotify searches
// cost no YouTube quota at all. Tune with SEARCH_LIMIT_PER_DAY.
// Cached results are served before this limiter and failed calls are refunded.
exports.search = rateLimit({
  ..._base,
  windowMs: 24 * 60 * 60 * 1000, // 24 h
  max:      parseInt(process.env.SEARCH_LIMIT_PER_DAY, 10) || 50,
  skipFailedRequests: true,
  keyGenerator: (req) => `u:${req.user?.id || 'anon'}`,
  message:  {
    error: 'Daily search limit reached for this account. Paste a playlist link instead, or try again tomorrow.',
    code:  'search_limit',
  },
});
