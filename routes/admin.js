'use strict';
/**
 * routes/admin.js
 * Admin analytics dashboard.
 *
 * Routes:
 *   GET  /admin           → login form (if not authenticated)
 *   POST /admin/login     → authenticate with ADMIN_PASSWORD
 *   POST /admin/logout    → clear admin session
 *   GET  /admin/dashboard → full dashboard (requires admin session)
 *   GET  /admin/data      → raw JSON stats (requires admin session)
 */

const crypto    = require('crypto');
const express   = require('express');
const router    = express.Router();
const analytics = require('../db/analytics');
const { adminLogin: loginLimit } = require('../middleware/rateLimit');

function requireAdmin(req, res, next) {
  if (req.session?.isAdmin) return next();
  res.redirect('/admin');
}

// ── CSRF helpers (synchronizer-token pattern) ─────────────────────────────────
function _getCsrfToken(req) {
  // In tests, return a fixed value so test suites don't need real sessions
  if (process.env.NODE_ENV === 'test') return 'test-csrf-token';
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

function _verifyCsrf(req) {
  if (process.env.NODE_ENV === 'test') return true;
  const submitted = req.body._csrf;
  const expected  = req.session?.csrfToken;
  return !!(submitted && expected && submitted === expected);
}

// ── Login page ────────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  if (req.session?.isAdmin) return res.redirect('/admin/dashboard');
  // Ensure a CSRF token exists in the session before rendering the form
  const csrfToken = _getCsrfToken(req);
  res.send(_loginPage(req.query.error, csrfToken, res.locals.cspNonce));
});

router.post('/login', loginLimit, (req, res) => {
  // CSRF check must come before any credential comparison
  if (!_verifyCsrf(req)) {
    return res.status(403).redirect('/admin?error=Invalid+security+token');
  }

  const { password } = req.body;
  const adminPw = process.env.ADMIN_PASSWORD || '';
  if (!adminPw) return res.redirect('/admin?error=No+admin+password+configured');
  if (password !== adminPw) return res.redirect('/admin?error=Wrong+password');

  // Regenerate session ID on privilege elevation to prevent session fixation
  req.session.regenerate((err) => {
    if (err) return res.redirect('/admin?error=Session+error');
    req.session.isAdmin   = true;
    // Issue a fresh CSRF token for the new session
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    res.redirect('/admin/dashboard');
  });
});

router.post('/logout', requireAdmin, (req, res) => {
  if (!_verifyCsrf(req)) {
    return res.status(403).redirect('/admin?error=Invalid+security+token');
  }
  // Fully destroy the session on logout
  req.session.destroy(() => res.redirect('/admin'));
});

// ── Dashboard ─────────────────────────────────────────────────────────────────
router.get('/dashboard', requireAdmin, async (req, res) => {
  const stats = await analytics.getStats();
  res.send(_dashboardPage(stats, _getCsrfToken(req), res.locals.cspNonce));
});

// ── Raw JSON (for auto-refresh fetch) ────────────────────────────────────────
router.get('/data', requireAdmin, async (_req, res) => {
  res.json(await analytics.getStats());
});

// ═════════════════════════════════════════════════════════════════════════════
// HTML generators
// ═════════════════════════════════════════════════════════════════════════════

function _loginPage(error, csrfToken, nonce) {
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>xwall admin</title>
<style nonce="${_esc(nonce)}">
  *{box-sizing:border-box;margin:0;padding:0}
  body{min-height:100vh;display:flex;align-items:center;justify-content:center;
       background:#0b0d16;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
  .card{background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);
        border-radius:1rem;padding:2.5rem 2rem;width:min(380px,92vw);text-align:center}
  h1{font-size:1.5rem;font-weight:300;letter-spacing:0.15em;text-transform:uppercase;margin-bottom:0.3rem}
  .sub{font-size:0.7rem;opacity:0.35;letter-spacing:0.25em;text-transform:uppercase;margin-bottom:2rem}
  input{width:100%;padding:0.75rem 1.1rem;background:rgba(255,255,255,0.06);
        border:1px solid rgba(255,255,255,0.12);border-radius:0.6rem;color:#fff;
        font-size:0.9rem;font-family:inherit;outline:none;margin-bottom:1rem}
  input:focus{border-color:rgba(255,255,255,0.3)}
  button{width:100%;padding:0.75rem;background:rgba(255,255,255,0.1);
         border:1px solid rgba(255,255,255,0.2);border-radius:0.6rem;color:#fff;
         font-size:0.88rem;font-family:inherit;cursor:pointer;transition:background 0.2s}
  button:hover{background:rgba(255,255,255,0.18)}
  .err{color:#ff7070;font-size:0.75rem;margin-bottom:1rem}
</style></head><body>
<div class="card">
  <h1>xwall</h1>
  <p class="sub">Admin</p>
  ${error ? `<p class="err">${_esc(error)}</p>` : ''}
  <form method="POST" action="/admin/login">
    <input type="hidden" name="_csrf" value="${_esc(csrfToken)}"/>
    <input type="password" name="password" placeholder="Password" autofocus autocomplete="current-password"/>
    <button type="submit">Sign in →</button>
  </form>
</div></body></html>`;
}

function _dashboardPage(s, csrfToken, nonce) {
  const o  = s.overview;
  const tl = s.timeline;

  // Build sparkline path for page views (last 30 days)
  const maxV   = Math.max(...tl.map(r => r.views), 1);
  const W = 460, H = 60, PAD = 4;
  const sparkPath = tl.length < 2 ? '' : (() => {
    const pts = tl.map((r, i) => {
      const x = PAD + (i / (tl.length - 1)) * (W - PAD * 2);
      const y = H - PAD - (r.views / maxV) * (H - PAD * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return `M ${pts.join(' L ')}`;
  })();

  const uniqPath = tl.length < 2 ? '' : (() => {
    const maxU = Math.max(...tl.map(r => r.uniq), 1);
    const pts = tl.map((r, i) => {
      const x = PAD + (i / (tl.length - 1)) * (W - PAD * 2);
      const y = H - PAD - (r.uniq / maxU) * (H - PAD * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return `M ${pts.join(' L ')}`;
  })();

  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>xwall · Analytics</title>
<style nonce="${_esc(nonce)}">
*{box-sizing:border-box;margin:0;padding:0}
body{background:#080b12;color:#e8eaf0;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  font-size:14px;line-height:1.5;min-height:100vh}
a{color:inherit;text-decoration:none}
/* Layout */
.topbar{display:flex;align-items:center;justify-content:space-between;
  padding:1rem 1.8rem;border-bottom:1px solid rgba(255,255,255,0.06);
  background:rgba(255,255,255,0.02);position:sticky;top:0;z-index:10;backdrop-filter:blur(12px)}
.topbar h1{font-size:1.05rem;font-weight:400;letter-spacing:0.18em;text-transform:uppercase;opacity:0.8}
.topbar-right{display:flex;align-items:center;gap:1rem}
.refresh-label{font-size:0.68rem;opacity:0.3;letter-spacing:0.06em}
.logout-form{margin:0}
.logout-btn{font-size:0.72rem;opacity:0.45;border:1px solid rgba(255,255,255,0.12);
  border-radius:0.4rem;padding:0.25rem 0.65rem;cursor:pointer;background:transparent;
  color:#fff;font-family:inherit;transition:opacity 0.2s}
.logout-btn:hover{opacity:1}
.page{max-width:1200px;margin:0 auto;padding:2rem 1.5rem;display:grid;gap:1.5rem}

/* Stat cards */
.section-label{font-size:0.62rem;letter-spacing:0.2em;text-transform:uppercase;
  opacity:0.3;margin-bottom:0.75rem}
.stat-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:0.9rem}
.stat-card{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);
  border-radius:0.9rem;padding:1.1rem 1.2rem}
.stat-label{font-size:0.65rem;letter-spacing:0.1em;text-transform:uppercase;opacity:0.38;margin-bottom:0.35rem}
.stat-value{font-size:1.9rem;font-weight:600;letter-spacing:-0.02em;line-height:1}
.stat-value-blue{color:#adf}
.stat-sub{font-size:0.68rem;opacity:0.28;margin-top:0.25rem}

/* Charts */
.chart-card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);
  border-radius:0.9rem;padding:1.2rem 1.4rem}
.chart-title{font-size:0.65rem;letter-spacing:0.12em;text-transform:uppercase;opacity:0.35;margin-bottom:1rem}
svg.sparkline{display:block;width:100%;height:60px;overflow:visible}
.spark-views{fill:none;stroke:rgba(120,160,255,0.7);stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.spark-uniq{fill:none;stroke:rgba(80,220,140,0.6);stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.chart-legend{display:flex;gap:1.2rem;margin-top:0.6rem}
.legend-item{display:flex;align-items:center;gap:0.35rem;font-size:0.65rem;opacity:0.45}
.dot-blue{width:8px;height:8px;border-radius:50%;background:rgba(120,160,255,0.8);flex-shrink:0}
.dot-green{width:8px;height:8px;border-radius:50%;background:rgba(80,220,140,0.7);flex-shrink:0}

/* Tables */
.table-card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);
  border-radius:0.9rem;overflow:hidden}
.table-header{padding:0.9rem 1.2rem;font-size:0.62rem;letter-spacing:0.15em;
  text-transform:uppercase;opacity:0.3;border-bottom:1px solid rgba(255,255,255,0.06)}
.table-row{display:flex;align-items:center;padding:0.6rem 1.2rem;
  border-bottom:1px solid rgba(255,255,255,0.04);gap:0.8rem}
.table-row:last-child{border-bottom:none}
.row-label{flex:1;opacity:0.72;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.row-bar-wrap{flex:2;height:6px;background:rgba(255,255,255,0.07);border-radius:3px;overflow:hidden}
.row-bar-svg{display:block;width:100%;height:100%}
.row-bar-fill{fill:rgba(120,160,255,0.55)}
.row-count{width:40px;text-align:right;opacity:0.45;font-size:0.8rem}
.badge{font-size:0.6rem;padding:0.15rem 0.45rem;border-radius:0.3rem;font-weight:600;letter-spacing:0.04em}
.badge-yt{background:rgba(255,0,0,0.2);color:#ff7070}
.badge-sp{background:rgba(29,185,84,0.2);color:#1DB954}

/* Recent events */
.event-row{display:flex;align-items:baseline;gap:0.7rem;padding:0.45rem 1.2rem;
  border-bottom:1px solid rgba(255,255,255,0.03);font-size:0.78rem}
.event-row:last-child{border-bottom:none}
.event-type{opacity:0.55;white-space:nowrap;min-width:90px}
.event-data{flex:1;opacity:0.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:0.7rem}
.event-ts{opacity:0.2;font-size:0.65rem;white-space:nowrap}

/* Two-column layout */
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:1.2rem}
@media(max-width:700px){.two-col{grid-template-columns:1fr}.stat-grid{grid-template-columns:repeat(2,1fr)}}

/* Auth split */
.auth-split{display:flex;gap:1.5rem;margin-top:0.8rem}
.auth-provider{flex:1;background:rgba(255,255,255,0.03);border-radius:0.55rem;
  padding:0.9rem 1rem;text-align:center}
.auth-num{font-size:1.6rem;font-weight:600;line-height:1;margin-bottom:0.2rem}
.auth-num-google{color:#ff7070}
.auth-num-spotify{color:#1DB954}
.auth-label{font-size:0.62rem;letter-spacing:0.1em;text-transform:uppercase;opacity:0.3}
</style>
</head><body>

<div class="topbar">
  <h1>xwall · Analytics</h1>
  <div class="topbar-right">
    <span class="refresh-label" id="refresh-label">auto-refresh 60s</span>
    <form class="logout-form" method="POST" action="/admin/logout">
      <input type="hidden" name="_csrf" value="${_esc(csrfToken)}"/>
      <button class="logout-btn" type="submit">Sign out</button>
    </form>
  </div>
</div>

<div class="page">

  <!-- ── Overview numbers ─────────────────────────────────────────────────── -->
  <div>
    <p class="section-label">Page Views</p>
    <div class="stat-grid">
      ${_sc('Today',    o.viewsToday,  'visits')}
      ${_sc('Last 7d',  o.views7d,     'visits')}
      ${_sc('Last 30d', o.views30d,    'visits')}
      ${_sc('All time', o.totalViews,  'visits')}
    </div>
  </div>

  <!-- ── Unique visitors ───────────────────────────────────────────────────── -->
  <div>
    <p class="section-label">Unique Visitors</p>
    <div class="stat-grid">
      ${_sc('Today',   o.uniqueToday, 'visitors')}
      ${_sc('Last 7d', o.unique7d,    'visitors')}
      ${_sc('All time',o.uniqueAll,   'visitors')}
      ${_sc('Returning',o.returningAll,'all-time views', '#adf')}
    </div>
  </div>

  <!-- ── Chart ────────────────────────────────────────────────────────────── -->
  <div class="chart-card">
    <p class="chart-title">Daily visits — last 30 days</p>
    <svg class="sparkline" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      ${sparkPath  ? `<path class="spark-views" d="${sparkPath}"/>` : ''}
      ${uniqPath   ? `<path class="spark-uniq"  d="${uniqPath}"/>` : ''}
    </svg>
    <div class="chart-legend">
      <span class="legend-item"><span class="dot-blue"></span>Views</span>
      <span class="legend-item"><span class="dot-green"></span>Unique</span>
    </div>
  </div>

  <!-- ── Logins ────────────────────────────────────────────────────────────── -->
  <div>
    <p class="section-label">Authenticated Users</p>
    <div class="stat-grid">
      ${_sc('Total logged in',  o.loggedInTotal,   'ever signed in', '#adf')}
      ${_sc('Launches today',   o.viewsToday,      '')}
      ${_sc('Launches 7d',      o.launches7d,      'Enter clicks')}
      ${_sc('Total launches',   o.launches,        'Enter clicks')}
    </div>
    <div class="auth-split">
      <div class="auth-provider">
        <div class="auth-num auth-num-google">${o.loggedInGoogle}</div>
        <div class="auth-label">Google / YouTube</div>
      </div>
      <div class="auth-provider">
        <div class="auth-num auth-num-spotify">${o.loggedInSpotify}</div>
        <div class="auth-label">Spotify</div>
      </div>
    </div>
  </div>

  <!-- ── Mode + country tables ─────────────────────────────────────────────── -->
  <div class="two-col">
    ${_barTable('Popular Modes', s.topModes, (r) => r.label)}
    ${_barTable('Top Countries', s.topCountries, (r) => r.label || 'Unknown')}
  </div>

  <!-- ── Video popularity ──────────────────────────────────────────────────── -->
  ${_barTable('Popular Videos', s.topVideos, (r) => r.label)}

  <!-- ── Recent logins ─────────────────────────────────────────────────────── -->
  <div class="table-card">
    <div class="table-header">Recent Sign-ins</div>
    ${s.recentLogins.length === 0
      ? `<div class="event-row"><span class="event-data">No logins yet</span></div>`
      : s.recentLogins.map(r =>
          `<div class="event-row">
            <span class="badge ${r.auth_provider === 'google' ? 'badge-yt' : 'badge-sp'}">
              ${r.auth_provider === 'google' ? 'YT' : 'SP'}
            </span>
            <span class="row-label">${_esc(r.city || '')}${r.city && r.country ? ', ' : ''}${_esc(r.country || 'Unknown')}</span>
            <span class="event-ts">${_relTime(r.timestamp)}</span>
          </div>`
        ).join('')}
  </div>

  <!-- ── Recent events ─────────────────────────────────────────────────────── -->
  <div class="table-card">
    <div class="table-header">Recent Events (last 50)</div>
    ${s.recentEvents.map(r => {
        let data = r.data;
        try { const d = JSON.parse(r.data); data = Object.values(d).join(' · '); } catch(_) {}
        return `<div class="event-row">
          <span class="event-type">${_esc(r.event)}</span>
          <span class="event-data">${_esc(data || '')}</span>
          <span class="event-ts">${_relTime(r.timestamp)}</span>
        </div>`;
    }).join('') || `<div class="event-row"><span class="event-data">No events yet</span></div>`}
  </div>

</div>

<script nonce="${_esc(nonce)}">
  let countdown = 60;
  const label = document.getElementById('refresh-label');
  setInterval(() => {
    countdown--;
    label.textContent = 'auto-refresh ' + countdown + 's';
    if (countdown <= 0) { location.reload(); }
  }, 1000);
</script>
</body></html>`;
}

// ── Small helpers ─────────────────────────────────────────────────────────────
function _esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _sc(label, value, sub, color = '#fff') {
  const tone = color === '#adf' ? ' stat-value-blue' : '';
  return `<div class="stat-card">
    <div class="stat-label">${label}</div>
    <div class="stat-value${tone}">${value.toLocaleString()}</div>
    ${sub ? `<div class="stat-sub">${sub}</div>` : ''}
  </div>`;
}

function _barTable(title, rows, labelFn) {
  const max = rows.length ? Math.max(...rows.map(r => r.count)) : 1;
  return `<div class="table-card">
    <div class="table-header">${title}</div>
    ${rows.length === 0
      ? `<div class="event-row"><span class="event-data">No data yet</span></div>`
      : rows.map(r => {
          const pct = Math.round((r.count / max) * 100);
          return `<div class="table-row">
            <span class="row-label">${_esc(labelFn(r))}</span>
            <div class="row-bar-wrap">
              <svg class="row-bar-svg" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true">
                <rect class="row-bar-fill" x="0" y="0" width="${pct}" height="6" rx="3" ry="3"></rect>
              </svg>
            </div>
            <span class="row-count">${r.count}</span>
          </div>`;
        }).join('')}
  </div>`;
}

function _relTime(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000)  return 'just now';
  if (diff < 3600000)  return Math.floor(diff/60000)  + 'm ago';
  if (diff < 86400000) return Math.floor(diff/3600000) + 'h ago';
  return Math.floor(diff/86400000) + 'd ago';
}

module.exports = router;
