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

// Applied to every incoming request
exports.general = rateLimit({
  ..._base,
  windowMs: 15 * 60 * 1000, // 15 min
  max:      300,
  message:  { error: 'Too many requests, please try again later.' },
});

// Admin login brute-force protection
exports.adminLogin = rateLimit({
  ..._base,
  windowMs: 15 * 60 * 1000, // 15 min
  max:      5,
  message:  { error: 'Too many login attempts, please try again in 15 minutes.' },
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
