'use strict';
const express  = require('express');
const passport = require('passport');
const router   = express.Router();
const analytics = require('../db/analytics');

// ── Google / YouTube ──────────────────────────────────────────────────────────
router.get(
  '/google',
  passport.authenticate('google', {
    scope: [
      'profile',
      'email',
      'https://www.googleapis.com/auth/youtube.readonly',
    ],
  })
);

router.get(
  '/google/callback',
  passport.authenticate('google', { failureRedirect: '/?error=auth_failed' }),
  (req, res) => {
    // Fire-and-forget — don't delay the redirect to the app
    analytics.recordAuth({ visitorId: req.session?._vid, provider: 'google' }).catch(() => {});
    res.redirect('/?auth=success');
  }
);

// ── Spotify ───────────────────────────────────────────────────────────────────
router.get(
  '/spotify',
  passport.authenticate('spotify', {
    scope: [
      'user-read-private',
      'user-read-email',
      'playlist-read-private',
      'playlist-read-collaborative',
      'streaming',
      'user-read-playback-state',
      'user-modify-playback-state',
    ],
    showDialog: false,
  })
);

router.get(
  '/spotify/callback',
  passport.authenticate('spotify', { failureRedirect: '/?error=auth_failed' }),
  (req, res) => {
    // Fire-and-forget — don't delay the redirect to the app
    analytics.recordAuth({ visitorId: req.session?._vid, provider: 'spotify' }).catch(() => {});
    res.redirect('/?auth=success');
  }
);

// ── Status ────────────────────────────────────────────────────────────────────
// Returns minimal public profile — never exposes tokens or full internal user obj
router.get('/status', (req, res) => {
  if (req.isAuthenticated()) {
    const { id, provider, displayName, photo } = req.user;
    return res.json({ authenticated: true, user: { id, provider, displayName, photo } });
  }
  res.json({ authenticated: false });
});

// ── Logout ────────────────────────────────────────────────────────────────────
router.post('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy(() => {
      res.clearCookie('connect.sid');
      res.json({ ok: true });
    });
  });
});

module.exports = router;
