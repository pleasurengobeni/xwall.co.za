'use strict';
require('dotenv').config();

const crypto      = require('crypto');
const express     = require('express');
const session     = require('express-session');
const passport    = require('passport');
const helmet      = require('helmet');
const path        = require('path');

const hpp         = require('hpp');

const pool        = require('./db/pool');
const analytics   = require('./db/analytics');
const { general: generalLimit } = require('./middleware/rateLimit');

const authRoutes   = require('./routes/auth');
const apiRoutes    = require('./routes/api');
const adminRoutes  = require('./routes/admin');
const trackVisitor = require('./middleware/track');

require('./config/passport');

const fs = require('fs');

const app = express();
const PUBLIC_DIR = path.join(__dirname, 'public');

// ── Asset versioning ─────────────────────────────────────────────────────────
// index.html is served no-cache, but the browser used to be free to keep an
// older /js/app.js alongside it, so a deploy could leave Chrome running new
// HTML against stale JavaScript. Every local script/stylesheet URL therefore
// carries ?v=<content hash>: a changed file gets a new URL and is always
// fetched, while unchanged files stay cacheable.
function _assetHash(publicPath) {
  try {
    const buf = fs.readFileSync(path.join(PUBLIC_DIR, publicPath));
    return crypto.createHash('sha1').update(buf).digest('hex').slice(0, 10);
  } catch (_) {
    return null;
  }
}

function _renderIndexHtml() {
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  return html.replace(/(src|href)="(\/(?:js|css)\/[^"?]+)"/g, (match, attr, assetPath) => {
    const hash = _assetHash(assetPath);
    return hash ? `${attr}="${assetPath}?v=${hash}"` : match;
  });
}

let _indexHtml = null;
function indexHtml() {
  // Cached after the first render; the file only changes on deploy (restart).
  if (_indexHtml === null) _indexHtml = _renderIndexHtml();
  return _indexHtml;
}

// Trust reverse-proxy headers (Nginx sets X-Forwarded-For / X-Forwarded-Proto).
// TRUST_PROXY=1 in production; leave unset (0) for local dev without a proxy.
app.set('trust proxy', parseInt(process.env.TRUST_PROXY || '0', 10));

// Per-request CSP nonce for admin pages that render inline <style>/<script> blocks.
app.use((_req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
});

const enableHttpsUpgrade = process.env.CSP_UPGRADE_INSECURE_REQUESTS === '1';

// ── Security headers ──────────────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc:            ["'self'"],
        scriptSrc:             [
          "'self'",
          (_req, res) => `'nonce-${res.locals.cspNonce}'`,
          'https://www.youtube.com',
          'https://s.ytimg.com',
        ],
        scriptSrcAttr:         ["'none'"],
        styleSrc:              [
          "'self'",
          (_req, res) => `'nonce-${res.locals.cspNonce}'`,
        ],
        styleSrcAttr:          ["'none'"],
        imgSrc:                ["'self'", "data:", "https:"],
        fontSrc:               ["'self'"],
        // Allow YouTube & Spotify iframes for background video and player panel
        frameSrc:              [
          "https://www.youtube.com",
          "https://open.spotify.com",
        ],
        frameAncestors:        ["'self'"],
        connectSrc:            ["'self'"],
        mediaSrc:              ["'self'"],
        workerSrc:             ["'none'"],
        manifestSrc:           ["'self'"],
        objectSrc:             ["'none'"],
        baseUri:               ["'self'"],
        formAction:            ["'self'"],
        // Enable only after valid HTTPS is configured for the domain.
        upgradeInsecureRequests: enableHttpsUpgrade ? [] : null,
      },
    },
    // Allow embedding in iframes on the same origin
    frameguard: { action: 'sameorigin' },
    // Helmet defaults to COOP "same-origin", which severs window.opener once the
    // OAuth popup navigates to accounts.google.com and back — breaking the
    // postMessage handshake the popup uses to close itself and refresh the
    // opener tab. Disable it so the popup keeps a reference to its opener.
    crossOriginOpenerPolicy: false,
    // Helmet's default "no-referrer" makes YouTube embeds fail (player error
    // 153: embeds must identify the embedding site). Send only the origin
    // cross-site, never full paths or query strings.
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  })
);

// Browser features this app never uses. Autoplay, fullscreen and
// encrypted-media stay available for the YouTube/Spotify embeds.
app.use((_req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  next();
});

// ── Cheap, stateless endpoints first ─────────────────────────────────────────
// Static assets and the keep-alive ping don't need body parsing, sessions or
// the per-IP request budget (clients ping every 25 s). `index: false` lets GET /
// fall through to visitor tracking and the SPA handler below.
app.get('/ping', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.status(200).json({ ok: true });
});
app.use(express.static(PUBLIC_DIR, {
  index:    false,
  dotfiles: 'ignore',
  redirect: false,
  setHeaders(res, filePath, stat) {
    // A versioned URL names one exact build of the file, so it can be cached
    // hard. Anything unversioned must be revalidated on every load.
    if (res.req.query && res.req.query.v) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      res.setHeader('Cache-Control', 'no-cache');
    }
    void filePath; void stat;
  },
}));

// ── Body parsing (size limits guard against request flooding) ─────────────────
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));

// Prevent HTTP Parameter Pollution (strips duplicate query/body params)
app.use(hpp());

// ── Rate limiting ─────────────────────────────────────────────────────────────
app.use(generalLimit);

// ── Session ───────────────────────────────────────────────────────────────────
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret || sessionSecret.length < 32) {
  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: SESSION_SECRET must be at least 32 characters in production.');
    process.exit(1);
  }
}

// A long secret is not enough: the placeholders shipped in .env.example are
// public, so a session signed with one can be forged by anyone. Warn loudly
// rather than exiting, so a misconfigured deploy degrades instead of going down.
if (process.env.NODE_ENV === 'production') {
  const placeholderSecret = /^(replace_with|your_|changeme|dev-secret)/i.test(sessionSecret || '');
  if (placeholderSecret) {
    console.error(
      'SECURITY WARNING: SESSION_SECRET is still the example placeholder. ' +
      'Anyone who knows it can forge session cookies. Generate a new one with: ' +
      'node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"'
    );
  }
}

// Users stay signed in for 90 days, renewed on every visit (rolling), so anyone
// who opens xwall at least once a quarter is never signed out. Their hourly
// provider tokens are renewed in the background (lib/tokens.js). Admin
// sessions override this with a much shorter lifetime (routes/admin.js).
const SESSION_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

// Use PostgreSQL-backed session store in non-test environments so sessions
// survive server restarts and scale across multiple instances.
const sessionConfig = {
  secret:            sessionSecret || 'dev-secret-change-me-in-production-please',
  resave:            false,
  saveUninitialized: false,
  // Rename away from the default 'connect.sid' to avoid fingerprinting Express.
  name:   'xws',
  rolling: true, // reset maxAge on every request to extend active sessions
  cookie: {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    // Lax keeps OAuth callback sessions reliable across Chrome/Safari.
    sameSite: 'lax',
    maxAge:   SESSION_MAX_AGE_MS,
  },
};

if (process.env.NODE_ENV !== 'test') {
  const pgSession = require('connect-pg-simple')(session);
  sessionConfig.store = new pgSession({
    pool,
    tableName:            'sessions',
    createTableIfMissing: true,
    ttl:                  SESSION_MAX_AGE_MS / 1000, // fallback; the cookie's expiry is used
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

// Public legal page used by OAuth consent configuration
app.get('/privacy-policy', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'privacy-policy.html'));
});

app.get('/terms-of-service', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'terms-of-service.html'));
});

// SPA fallback — only for extension-less paths. Probes such as /.env,
// /wp-login.php or /config.json get a plain 404 instead of the app shell.
app.get('*', (req, res, next) => {
  if (path.extname(req.path) || req.path.includes('/.')) return next();
  res.set('Cache-Control', 'no-cache');
  res.type('html').send(indexHtml());
});

app.use((_req, res) => {
  res.status(404).type('text/plain').send('Not found');
});

// ── Error handler ─────────────────────────────────────────────────────────────
// Never leak stack traces or internal messages to clients.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const code   = err.status || err.statusCode;
  const status = Number.isInteger(code) && code >= 400 && code < 600 ? code : 500;
  if (status >= 500) console.error(`[error] ${req.method} ${req.path}:`, err.message);
  if (res.headersSent) return;

  const message = status >= 500 ? 'Internal server error'
    : status === 413 ? 'Payload too large'
      : 'Bad request';
  if (req.accepts(['json', 'html']) === 'json' || req.path.startsWith('/api/')) {
    return res.status(status).json({ error: message });
  }
  res.status(status).type('text/plain').send(message);
});

// ── Start ─────────────────────────────────────────────────────────────────────
// Only start the HTTP listener when this file is run directly (not required by tests)
let server = null;

if (require.main === module) {
  const PORT = parseInt(process.env.PORT, 10) || 3000;

  if (process.env.NODE_ENV === 'production' && (process.env.ADMIN_PASSWORD || '').length < 16) {
    console.warn('WARNING: ADMIN_PASSWORD should be at least 16 random characters.');
  }

  analytics.init()
    .then(() => {
      server = app.listen(PORT, () => {
        console.log(`xwall running on http://localhost:${PORT}`);
      });
      // Slow-client (slowloris) protection: bound how long a request may take
      // to send headers and body.
      server.headersTimeout = 20_000;
      server.requestTimeout = 30_000;

      // Enforce the analytics retention period stated in the privacy policy
      const prune = () => analytics.pruneExpired()
        .then((n) => {
          const total = n.pageViews + n.events + n.visitors;
          if (total) console.log(`Retention: deleted ${total} analytics rows older than ${analytics.RETENTION_MONTHS} months`);
        })
        .catch((err) => console.error('Retention prune failed:', err.message));
      prune();
      setInterval(prune, 24 * 60 * 60 * 1000).unref();
    })
    .catch((err) => {
      console.error('Failed to initialise database:', err.message);
      process.exit(1);
    });
}

// Log instead of crashing on stray async errors (Node exits on unhandled
// rejections by default, which would turn any bug into downtime).
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason instanceof Error ? reason.message : reason);
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
// Stop accepting connections, let in-flight requests finish, then drain the DB
// pool before exiting (Docker / Kubernetes SIGTERM).
let _shuttingDown = false;
async function _shutdown() {
  if (_shuttingDown) return;
  _shuttingDown = true;
  setTimeout(() => process.exit(0), 10_000).unref();
  if (server) await new Promise((resolve) => server.close(resolve));
  try { await analytics.close(); } catch (_) {}
  process.exit(0);
}
process.on('SIGTERM', _shutdown);
process.on('SIGINT',  _shutdown);

module.exports = app;
