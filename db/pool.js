'use strict';
/**
 * db/pool.js
 * Shared pg.Pool singleton.  Imported by both analytics and the session store
 * so the app holds a single connection pool regardless of traffic.
 *
 * Env vars:
 *   DATABASE_URL  — PostgreSQL connection string (required)
 *   PG_POOL_MAX   — max connections in pool (default 20)
 *
 * SSL: disabled for local/test; enabled (cert-check skipped) for hosted DBs.
 * Most hosted providers (Railway, Render, Supabase, RDS) require SSL but
 * use self-signed certs, so rejectUnauthorized:false is the standard approach.
 */

const { Pool } = require('pg');

const connStr  = process.env.DATABASE_URL || '';
const sslMode  = (process.env.PGSSLMODE || process.env.PGSSL || '').toLowerCase();

function _isLocalDb(connectionString) {
  if (!connectionString) return true;

  try {
    const host = new URL(connectionString).hostname;
    return host === 'localhost' ||
           host === '127.0.0.1' ||
           host === '::1' ||
           host === 'db';
  } catch (_) {
    return connectionString.includes('localhost') ||
           connectionString.includes('127.0.0.1') ||
           connectionString.includes('@db:');
  }
}

const isLocal  = _isLocalDb(connStr);
const sslConfig = sslMode === 'disable' || sslMode === 'false' || sslMode === '0'
  ? false
  : sslMode === 'require' || sslMode === 'true' || sslMode === '1'
    ? { rejectUnauthorized: false }
    : isLocal
      ? false
      : { rejectUnauthorized: false };

const pool = new Pool({
  connectionString: connStr || undefined,
  max:                    parseInt(process.env.PG_POOL_MAX, 10) || 20,
  idleTimeoutMillis:      30_000,
  connectionTimeoutMillis: 3_000,
  ssl: sslConfig,
});

pool.on('error', (err) => {
  console.error('[pg] Unexpected pool error:', err.message);
});

module.exports = pool;
