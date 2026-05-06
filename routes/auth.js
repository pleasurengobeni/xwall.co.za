'use strict';
const express  = require('express');
const passport = require('passport');
const router   = express.Router();
const analytics = require('../db/analytics');

function sanitizeReturnTo(rawPath) {
  if (typeof rawPath !== 'string') return '/';
  if (!rawPath.startsWith('/') || rawPath.startsWith('//')) return '/';
  if (rawPath.includes('\n') || rawPath.includes('\r')) return '/';

  try {
    const parsed = new URL(rawPath, 'http://xwall.local');
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch (_) {
    return '/';
  }
}

function rememberReturnTo(req, _res, next) {
  if (req.session) {
    req.session.oauthReturnTo = sanitizeReturnTo(req.query.return_to || '/');
  }
  next();
}

function buildRedirectWithStatus(req, key, value) {
  const target = sanitizeReturnTo(req.session?.oauthReturnTo || '/');
  if (req.session) delete req.session.oauthReturnTo;

  const url = new URL(target, 'http://xwall.local');
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}${url.hash}`;
}

// ── Google / YouTube ──────────────────────────────────────────────────────────
router.get(
  '/google',
  rememberReturnTo,
  passport.authenticate('google', {
    scope: [
      'profile',
      'email',
      'https://www.googleapis.com/auth/youtube.readonly',
    ],
    prompt: 'select_account',
    includeGrantedScopes: true,
  })
);

router.get(
  '/google/callback',
  (req, res, next) => {
    passport.authenticate('google', (err, user) => {
      if (err || !user) {
        return res.redirect(buildRedirectWithStatus(req, 'error', 'auth_failed'));
      }

      req.logIn(user, (loginErr) => {
        if (loginErr) {
          return res.redirect(buildRedirectWithStatus(req, 'error', 'auth_failed'));
        }

        // Fire-and-forget — don't delay the redirect to the app
        analytics.recordAuth({ visitorId: req.session?._vid, provider: 'google' }).catch(() => {});
        return res.redirect(buildRedirectWithStatus(req, 'auth', 'success'));
      });
    })(req, res, next);
  }
);

// ── Spotify ───────────────────────────────────────────────────────────────────
router.get(
  '/spotify',
  rememberReturnTo,
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
  (req, res, next) => {
    passport.authenticate('spotify', (err, user) => {
      if (err || !user) {
        return res.redirect(buildRedirectWithStatus(req, 'error', 'auth_failed'));
      }

      req.logIn(user, (loginErr) => {
        if (loginErr) {
          return res.redirect(buildRedirectWithStatus(req, 'error', 'auth_failed'));
        }

        // Fire-and-forget — don't delay the redirect to the app
        analytics.recordAuth({ visitorId: req.session?._vid, provider: 'spotify' }).catch(() => {});
        return res.redirect(buildRedirectWithStatus(req, 'auth', 'success'));
      });
    })(req, res, next);
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
