'use strict';
/**
 * db/analytics.js
 * PostgreSQL-backed analytics store.  All public functions are async.
 *
 * Tables
 * ──────
 *  visitors   — one row per unique visitor (hashed IP+UA fingerprint)
 *  page_views — one row per site visit / reload
 *  events     — client-side behavioural events (mode, video, playlist, launch)
 *
 * Timestamps are TIMESTAMPTZ so PostgreSQL handles time arithmetic.
 * Event data is JSONB for efficient operator queries.
 * Visitor upsert uses ON CONFLICT for atomicity — no lost updates under load.
 */

const crypto = require('crypto');
const pool   = require('./pool');

// ── Schema init ───────────────────────────────────────────────────────────────
// Called once at server startup.  Safe to call multiple times (IF NOT EXISTS).
async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS visitors (
      visitor_id    TEXT        PRIMARY KEY,
      first_seen    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      visit_count   INTEGER     NOT NULL DEFAULT 1,
      country       TEXT,
      city          TEXT,
      auth_provider TEXT
    );

    CREATE TABLE IF NOT EXISTS page_views (
      id           BIGSERIAL   PRIMARY KEY,
      visitor_id   TEXT        NOT NULL,
      session_id   TEXT,
      is_returning BOOLEAN     NOT NULL DEFAULT FALSE,
      timestamp    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS events (
      id          BIGSERIAL   PRIMARY KEY,
      visitor_id  TEXT,
      session_id  TEXT,
      event       TEXT        NOT NULL,
      data        JSONB,
      timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_pv_ts    ON page_views(timestamp);
    CREATE INDEX IF NOT EXISTS idx_pv_vid   ON page_views(visitor_id);
    CREATE INDEX IF NOT EXISTS idx_ev_ts    ON events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_ev_evt   ON events(event);
    CREATE INDEX IF NOT EXISTS idx_ev_data  ON events USING GIN (data);
    CREATE INDEX IF NOT EXISTS idx_vis_prov ON visitors(auth_provider)
      WHERE auth_provider IS NOT NULL;
  `);
}

// ── Helper ────────────────────────────────────────────────────────────────────
function hashVisitor(ip, userAgent) {
  return crypto.createHash('sha256')
    .update(`${ip}|${userAgent}`)
    .digest('hex')
    .slice(0, 32);
}

// ── Public write API ──────────────────────────────────────────────────────────

/**
 * Record a page view.  Returns the visitor_id string.
 * Atomic UPSERT — safe under concurrent traffic.
 */
async function recordVisit({ ip, userAgent, sessionId, country, city }) {
  const visitor_id = hashVisitor(ip, userAgent);

  // Upsert visitor; RETURNING visit_count tells us if it's a new visitor
  const { rows } = await pool.query(
    `INSERT INTO visitors (visitor_id, first_seen, last_seen, visit_count, country, city)
     VALUES ($1, NOW(), NOW(), 1, $2, $3)
     ON CONFLICT (visitor_id) DO UPDATE
       SET last_seen   = NOW(),
           visit_count = visitors.visit_count + 1
     RETURNING visit_count`,
    [visitor_id, country || null, city || null]
  );

  const isReturning = rows[0].visit_count > 1;

  await pool.query(
    `INSERT INTO page_views (visitor_id, session_id, is_returning)
     VALUES ($1, $2, $3)`,
    [visitor_id, sessionId || null, isReturning]
  );

  return visitor_id;
}

/**
 * Record a client-side event.
 */
async function recordEvent({ visitorId, sessionId, event, data }) {
  await pool.query(
    `INSERT INTO events (visitor_id, session_id, event, data)
     VALUES ($1, $2, $3, $4)`,
    [visitorId || null, sessionId || null, event, data != null ? JSON.stringify(data) : null]
  );
}

/**
 * Mark visitor as authenticated with a provider.
 */
async function recordAuth({ visitorId, provider }) {
  if (!visitorId) return;
  await pool.query(
    `UPDATE visitors SET auth_provider = $1 WHERE visitor_id = $2`,
    [provider, visitorId]
  );
  await pool.query(
    `INSERT INTO events (visitor_id, event, data) VALUES ($1, 'login', $2)`,
    [visitorId, JSON.stringify({ provider })]
  );
}

// ── Dashboard queries ─────────────────────────────────────────────────────────

async function getStats() {
  const [overview, timeline, topModes, topVideos, topCountries, recentLogins, recentEvents] =
    await Promise.all([
      _overview(),
      _timeline(),
      _topEvents('mode_select',  'mode'),
      _topEvents('video_select', 'videoId'),
      _topField('country'),
      _recentLogins(),
      _recentEvents(),
    ]);
  return { overview, timeline, topModes, topVideos, topCountries, recentLogins, recentEvents };
}

async function _overview() {
  const { rows: [pv] } = await pool.query(`
    SELECT
      COUNT(*)                                                           AS "totalViews",
      COUNT(*) FILTER (WHERE timestamp > NOW() - INTERVAL '1 day')      AS "viewsToday",
      COUNT(*) FILTER (WHERE timestamp > NOW() - INTERVAL '7 days')     AS "views7d",
      COUNT(*) FILTER (WHERE timestamp > NOW() - INTERVAL '30 days')    AS "views30d",
      COUNT(DISTINCT visitor_id)                                         AS "uniqueAll",
      COUNT(DISTINCT visitor_id) FILTER (WHERE timestamp > NOW() - INTERVAL '1 day')  AS "uniqueToday",
      COUNT(DISTINCT visitor_id) FILTER (WHERE timestamp > NOW() - INTERVAL '7 days') AS "unique7d",
      COUNT(*) FILTER (WHERE is_returning)                               AS "returningAll"
    FROM page_views
  `);
  const { rows: [vi] } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE auth_provider IS NOT NULL)   AS "loggedInTotal",
      COUNT(*) FILTER (WHERE auth_provider = 'google')    AS "loggedInGoogle",
      COUNT(*) FILTER (WHERE auth_provider = 'spotify')   AS "loggedInSpotify"
    FROM visitors
  `);
  const { rows: [ev] } = await pool.query(`
    SELECT
      COUNT(*)                                                        AS "launches",
      COUNT(*) FILTER (WHERE timestamp > NOW() - INTERVAL '7 days')  AS "launches7d"
    FROM events WHERE event = 'launch'
  `);
  return {
    totalViews:      Number(pv?.totalViews)      || 0,
    viewsToday:      Number(pv?.viewsToday)      || 0,
    views7d:         Number(pv?.views7d)         || 0,
    views30d:        Number(pv?.views30d)        || 0,
    uniqueAll:       Number(pv?.uniqueAll)       || 0,
    uniqueToday:     Number(pv?.uniqueToday)     || 0,
    unique7d:        Number(pv?.unique7d)        || 0,
    returningAll:    Number(pv?.returningAll)    || 0,
    loggedInTotal:   Number(vi?.loggedInTotal)   || 0,
    loggedInGoogle:  Number(vi?.loggedInGoogle)  || 0,
    loggedInSpotify: Number(vi?.loggedInSpotify) || 0,
    launches:        Number(ev?.launches)        || 0,
    launches7d:      Number(ev?.launches7d)      || 0,
  };
}

async function _timeline() {
  const { rows } = await pool.query(`
    SELECT
      TO_CHAR(timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
      COUNT(*)                                            AS views,
      COUNT(DISTINCT visitor_id)                          AS uniq
    FROM page_views
    WHERE timestamp > NOW() - INTERVAL '30 days'
    GROUP BY day ORDER BY day ASC
  `);
  return rows.map((r) => ({ day: r.day, views: Number(r.views), uniq: Number(r.uniq) }));
}

async function _topEvents(eventName, dataKey) {
  const { rows } = await pool.query(
    `SELECT data->>$2 AS label, COUNT(*) AS count
     FROM events
     WHERE event = $1 AND data IS NOT NULL AND data->>$2 IS NOT NULL
     GROUP BY label ORDER BY count DESC LIMIT 10`,
    [eventName, dataKey]
  );
  return rows.map((r) => ({ label: r.label, count: Number(r.count) }));
}

const TOP_FIELD_WHITELIST = new Set(['country', 'city', 'auth_provider']);
async function _topField(field) {
  if (!TOP_FIELD_WHITELIST.has(field)) throw new Error(`Invalid field: ${field}`);
  const { rows } = await pool.query(
    `SELECT "${field}" AS label, COUNT(*) AS count
     FROM visitors WHERE "${field}" IS NOT NULL
     GROUP BY "${field}" ORDER BY count DESC LIMIT 10`
  );
  return rows.map((r) => ({ label: r.label, count: Number(r.count) }));
}

async function _recentLogins() {
  const { rows } = await pool.query(`
    SELECT v.auth_provider, v.country, v.city,
           EXTRACT(EPOCH FROM e.timestamp)::BIGINT * 1000 AS timestamp
    FROM events e
    LEFT JOIN visitors v ON e.visitor_id = v.visitor_id
    WHERE e.event = 'login'
    ORDER BY e.timestamp DESC LIMIT 20
  `);
  return rows.map((r) => ({ ...r, timestamp: Number(r.timestamp) }));
}

async function _recentEvents() {
  const { rows } = await pool.query(`
    SELECT event,
           data::TEXT AS data,
           EXTRACT(EPOCH FROM timestamp)::BIGINT * 1000 AS timestamp
    FROM events ORDER BY timestamp DESC LIMIT 50
  `);
  return rows.map((r) => ({ ...r, timestamp: Number(r.timestamp) }));
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
/** Drain the connection pool — call on SIGTERM for graceful shutdown. */
async function close() {
  await pool.end();
}

module.exports = { init, close, recordVisit, recordEvent, recordAuth, getStats, hashVisitor };
