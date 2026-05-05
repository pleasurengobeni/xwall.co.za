'use strict';
require('dotenv').config();

const express     = require('express');
const session     = require('express-session');
const passport    = require('passport');
const helmet      = require('helmet');
const path        = require('path');

const pool        = require('./db/pool');
const analytics   = require('./db/analytics');

const authRoutes   = require('./routes/auth');
const apiRoutes    = require('./routes/api');
const adminRoutes  = require('./routes/admin');
const trackVisitor = require('./middleware/track');

require('./config/passport');

const app = express();

// ── Security headers ──────────────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc:            ["'self'"],
        scriptSrc:             ["'self'", 'https://www.youtube.com', 'https://s.ytimg.com'],
        styleSrc:              ["'self'", "'unsafe-inline'"],
        imgSrc:                ["'self'", "data:", "https:"],
        fontSrc:               ["'self'"],
        // Allow YouTube & Spotify iframes for background video and player panel
        frameSrc:              [
          "https://www.youtube.com",
          "https://open.spotify.com",
        ],
        connectSrc:            ["'self'"],
        mediaSrc:              ["'self'"],
        objectSrc:             ["'none'"],
        baseUri:               ["'self'"],
        formAction:            ["'self'"],
      },
    },
    // Allow embedding in iframes on the same origin
    frameguard: { action: 'sameorigin' },
  })
);

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ── Session ───────────────────────────────────────────────────────────────────
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret || sessionSecret.length < 32) {
  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: SESSION_SECRET must be at least 32 characters in production.');
    process.exit(1);
  }
}

// Use PostgreSQL-backed session store in non-test environments so sessions
// survive server restarts and scale across multiple instances.
const sessionConfig = {
  secret:            sessionSecret || 'dev-secret-change-me-in-production-please',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   24 * 60 * 60 * 1000, // 24 h
  },
};

if (process.env.NODE_ENV !== 'test') {
  const pgSession = require('connect-pg-simple')(session);
  sessionConfig.store = new pgSession({
    pool,
    tableName:            'sessions',
    createTableIfMissing: true,
    ttl:                  86400, // 24 h in seconds
    pruneSessionInterval: 3600,  // prune expired sessions every hour
  });
}

app.use(session(sessionConfig));

// ── Passport ──────────────────────────────────────────────────────────────────
app.use(passport.initialize());
app.use(passport.session());

// ── Analytics visitor tracking ───────────────────────────────────────────────
app.use(trackVisitor);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/auth',  authRoutes);
app.use('/api',   apiRoutes);
app.use('/admin', adminRoutes);

// Keep-alive ping endpoint (called by client's network keep-alive timer)
app.get('/ping', (_req, res) => res.status(200).json({ ok: true }));

// ── Static files ──────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────────
// Only start the HTTP listener when this file is run directly (not required by tests)
if (require.main === module) {
  const PORT = parseInt(process.env.PORT, 10) || 3000;
  analytics.init()
    .then(() => {
      app.listen(PORT, () => {
        console.log(`xwall running on http://localhost:${PORT}`);
      });
    })
    .catch((err) => {
      console.error('Failed to initialise database:', err.message);
      process.exit(1);
    });
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────
// Drain open connections before the process exits (Docker / Kubernetes SIGTERM).
async function _shutdown() {
  try { await analytics.close(); } catch (_) {}
  process.exit(0);
}
process.on('SIGTERM', _shutdown);
process.on('SIGINT',  _shutdown);

module.exports = app;
