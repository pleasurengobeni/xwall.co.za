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
const isLocal  = !connStr ||
                 connStr.includes('localhost') ||
                 connStr.includes('127.0.0.1');
const sslConfig = isLocal ? false : { rejectUnauthorized: false };

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
