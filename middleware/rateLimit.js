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

// GET /api/playlists/search — each uncached call costs 100 YouTube quota units.
// Only searches that reach YouTube are counted (cached results are served
// before this limiter), and failed upstream calls are refunded.
exports.search = rateLimit({
  ..._base,
  windowMs: 24 * 60 * 60 * 1000, // 24 h
  max:      2,
  skipFailedRequests: true,
  message:  {
    error: 'Daily search limit reached. Paste a playlist link instead, or try again tomorrow.',
    code:  'search_limit',
  },
});
