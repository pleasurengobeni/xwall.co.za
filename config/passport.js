'use strict';
const passport = require('passport');
const GoogleStrategy  = require('passport-google-oauth20').Strategy;
const SpotifyStrategy = require('passport-spotify').Strategy;
const { encrypt, expiresAtFrom } = require('../lib/tokens');

// The session (stored server-side in PostgreSQL) keeps the profile fields the
// UI needs, the short-lived access token, and the refresh token used to renew
// it so users stay signed in. The refresh token is a long-lived credential, so
// it is stored encrypted (lib/tokens.js) and never sent to the browser.
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// ── Google / YouTube ──────────────────────────────────────────────────────────
if (process.env.GOOGLE_CLIENT_ID) {
  passport.use(
    new GoogleStrategy(
      {
        clientID:     process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL:  process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback',
        scope: [
          'profile',
          'email',
          'https://www.googleapis.com/auth/youtube.readonly',
        ],
      },
      // Five parameters so passport-oauth2 passes the token response (params),
      // which carries the access token's lifetime.
      (accessToken, refreshToken, params, profile, done) => {
        const user = {
          id:              profile.id,
          provider:        'google',
          displayName:     profile.displayName,
          photo:           profile.photos?.[0]?.value ?? null,
          accessToken,
          expiresAt:       expiresAtFrom(params?.expires_in),
          refreshTokenEnc: encrypt(refreshToken),
        };
        return done(null, user);
      }
    )
  );
}

// ── Spotify ───────────────────────────────────────────────────────────────────
if (process.env.SPOTIFY_CLIENT_ID) {
  passport.use(
    new SpotifyStrategy(
      {
        clientID:     process.env.SPOTIFY_CLIENT_ID,
        clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
        callbackURL:  process.env.SPOTIFY_CALLBACK_URL || '/auth/spotify/callback',
      },
      (accessToken, refreshToken, expiresIn, profile, done) => {
        const user = {
          id:              profile.id,
          provider:        'spotify',
          displayName:     profile.displayName,
          photo:           profile.photos?.[0]?.value ?? null,
          accessToken,
          expiresAt:       expiresAtFrom(expiresIn),
          refreshTokenEnc: encrypt(refreshToken),
        };
        return done(null, user);
      }
    )
  );
}
