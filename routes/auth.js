'use strict';
const express  = require('express');
const passport = require('passport');
const router   = express.Router();
const analytics = require('../db/analytics');

const SESSION_COOKIE = 'xws';

function sanitizeReturnTo(rawPath) {
  if (typeof rawPath !== 'string') return '/';
  if (!rawPath.startsWith('/') || rawPath.startsWith('//') || rawPath.startsWith('/\\')) return '/';
  if (rawPath.includes('\n') || rawPath.includes('\r')) return '/';

  try {
    const parsed = new URL(rawPath, 'http://xwall.local');
    if (parsed.host !== 'xwall.local') return '/';
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

function buildRedirectWithStatus(returnTo, key, value) {
  const url = new URL(sanitizeReturnTo(returnTo || '/'), 'http://xwall.local');
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}${url.hash}`;
}

// Shared OAuth callback. Passport 0.7 regenerates the session on login (to
// prevent session fixation), which discards everything stored on it — so read
// the return path and analytics visitor id *before* calling req.logIn.
function oauthCallback(provider) {
  return (req, res, next) => {
    passport.authenticate(provider, (err, user) => {
      const returnTo  = req.session?.oauthReturnTo;
      const visitorId = req.session?._vid;
      if (req.session) delete req.session.oauthReturnTo;

      if (err || !user) {
        return res.redirect(buildRedirectWithStatus(returnTo, 'error', 'auth_failed'));
      }

      req.logIn(user, (loginErr) => {
        if (loginErr) {
          return res.redirect(buildRedirectWithStatus(returnTo, 'error', 'auth_failed'));
        }

        if (visitorId) req.session._vid = visitorId;
        // Fire-and-forget — don't delay the redirect to the app
        analytics.recordAuth({ visitorId, provider }).catch(() => {});
        return res.redirect(buildRedirectWithStatus(returnTo, 'auth', 'success'));
      });
    })(req, res, next);
  };
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
    // Offline access makes Google issue a refresh token, so the session can
    // renew its hourly access token instead of signing the user out. Google
    // only returns one on a consent screen, hence prompt=consent.
    accessType: 'offline',
    prompt: 'select_account consent',
    includeGrantedScopes: true,
  })
);

router.get('/google/callback', oauthCallback('google'));

// ── Spotify ───────────────────────────────────────────────────────────────────
// Least privilege: the app only lists playlists and plays them through the
// public embed, so no playback/streaming scopes are requested.
router.get(
  '/spotify',
  rememberReturnTo,
  passport.authenticate('spotify', {
    scope: [
      'user-read-private',
      'user-read-email',
      'playlist-read-private',
      'playlist-read-collaborative',
    ],
    showDialog: false,
  })
);

router.get('/spotify/callback', oauthCallback('spotify'));

// ── Status ────────────────────────────────────────────────────────────────────
// Returns minimal public profile — never exposes tokens or full internal user obj
router.get('/status', (req, res) => {
  res.set('Cache-Control', 'no-store');
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
      res.clearCookie(SESSION_COOKIE, {
        httpOnly: true,
        secure:   process.env.NODE_ENV === 'production',
        sameSite: 'lax',
      });
      res.json({ ok: true });
    });
  });
});

router.use((_req, res) => res.status(404).json({ error: 'Not found' }));

module.exports = router;
