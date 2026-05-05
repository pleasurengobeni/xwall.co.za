'use strict';
const passport = require('passport');
const GoogleStrategy  = require('passport-google-oauth20').Strategy;
const SpotifyStrategy = require('passport-spotify').Strategy;

// Only store what we need — never persist raw tokens to a shared store
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
      (accessToken, refreshToken, profile, done) => {
        const user = {
          id:          profile.id,
          provider:    'google',
          displayName: profile.displayName,
          photo:       profile.photos?.[0]?.value ?? null,
          accessToken,
          refreshToken,
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
      (accessToken, refreshToken, _expiresIn, profile, done) => {
        const user = {
          id:          profile.id,
          provider:    'spotify',
          displayName: profile.displayName,
          photo:       profile.photos?.[0]?.value ?? null,
          accessToken,
          refreshToken,
        };
        return done(null, user);
      }
    )
  );
}
