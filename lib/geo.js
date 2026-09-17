'use strict';
/**
 * lib/geo.js
 * IP → approximate location via ip-api.com, shared by visitor tracking and the
 * weather proxy. Results (including failures) are cached so page reloads and
 * traffic spikes don't exceed ip-api's free-tier limit (45 req/min), which
 * would get the server's IP temporarily banned.
 */

const { fetchWithTimeout, createTtlCache, normalizeIp, isLoopbackIp } = require('./http');

const FIELDS = 'status,country,city,lat,lon';
const cache  = createTtlCache({ ttlMs: 60 * 60 * 1000, max: 5000 });
const FAILURE_TTL_MS = 5 * 60 * 1000;

const EMPTY = Object.freeze({ ok: false, country: null, city: null, lat: null, lon: null });

/**
 * @param {string} rawIp  client IP (req.ip). Loopback resolves the server's own
 *                        public IP, which is handy for local development.
 * @returns {Promise<{ok, country, city, lat, lon}>}
 */
async function lookup(rawIp) {
  const ip = normalizeIp(rawIp);
  if (!ip) return EMPTY;

  const self = isLoopbackIp(ip);
  const key  = self ? 'self' : ip;
  const cached = cache.get(key);
  if (cached) return cached;

  let result = EMPTY;
  try {
    // ip-api's free tier is HTTP-only; the IP is validated by net.isIP above
    // so nothing attacker-controlled can alter the request path.
    const url = self
      ? `http://ip-api.com/json/?fields=${FIELDS}`
      : `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=${FIELDS}`;
    const res = await fetchWithTimeout(url, {}, 3000);
    if (res.ok) {
      const d   = await res.json();
      const lat = Number(d.lat);
      const lon = Number(d.lon);
      if (d.status === 'success') {
        result = {
          ok:      true,
          country: typeof d.country === 'string' ? d.country.slice(0, 80) : null,
          city:    typeof d.city === 'string' ? d.city.slice(0, 80) : null,
          lat:     Number.isFinite(lat) && lat >= -90 && lat <= 90 ? lat : null,
          lon:     Number.isFinite(lon) && lon >= -180 && lon <= 180 ? lon : null,
        };
      }
    }
  } catch (_) {
    // Network error / timeout — fall through to cached failure
  }

  cache.set(key, result, result.ok ? undefined : FAILURE_TTL_MS);
  return result;
}

module.exports = { lookup, _cache: cache };
