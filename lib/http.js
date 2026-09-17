'use strict';
/**
 * lib/http.js
 * Small helpers shared by routes that call third-party APIs.
 *
 *  fetchWithTimeout — every outbound call gets a hard deadline so a slow
 *                     upstream can never pin request handlers open.
 *  createTtlCache   — bounded in-memory cache (oldest entry evicted first) used
 *                     to protect API quotas and upstream rate limits.
 *  normalizeIp      — returns a canonical IPv4/IPv6 string or null.
 */

const net = require('net');

const DEFAULT_TIMEOUT_MS = 5000;

function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
}

function createTtlCache({ ttlMs, max = 500 }) {
  const store = new Map();

  return {
    get(key) {
      const hit = store.get(key);
      if (!hit) return undefined;
      if (hit.expires <= Date.now()) {
        store.delete(key);
        return undefined;
      }
      return hit.value;
    },
    set(key, value, customTtlMs = ttlMs) {
      store.delete(key);
      if (store.size >= max) store.delete(store.keys().next().value);
      store.set(key, { value, expires: Date.now() + customTtlMs });
    },
    clear() {
      store.clear();
    },
  };
}

function normalizeIp(raw) {
  const ip = String(raw || '').trim().replace(/^::ffff:/i, '');
  return net.isIP(ip) ? ip : null;
}

function isLoopbackIp(ip) {
  return ip === '::1' || /^127\./.test(ip || '');
}

module.exports = { fetchWithTimeout, createTtlCache, normalizeIp, isLoopbackIp };
