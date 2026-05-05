'use strict';
/**
 * middleware/track.js
 * Records a page view on every GET request for HTML (the SPA root).
 * Runs geo-lookup against /api/weather's ip-api result if geo not cached in session.
 */

const analytics = require('../db/analytics');

async function _lookupGeo(ip) {
  try {
    const isLocal = ip === '127.0.0.1' || ip === '::1';
    const url     = isLocal ? 'http://ip-api.com/json' : `http://ip-api.com/json/${ip}`;
    const res     = await fetch(url, { signal: AbortSignal.timeout(3000) });
    const d       = await res.json();
    if (d.status === 'success') return { country: d.country, city: d.city };
  } catch (_) {}
  return { country: null, city: null };
}

module.exports = function trackVisitor(req, res, next) {
  // Only instrument the SPA root page load
  if (req.method !== 'GET' || req.path !== '/' || req.xhr) return next();

  const forwarded = req.headers['x-forwarded-for'];
  const rawIp     = forwarded ? forwarded.split(',')[0].trim() : req.ip;
  const ip        = rawIp.replace(/^::ffff:/, '');
  const userAgent = req.headers['user-agent'] || '';
  const sessionId = req.session?.id || null;

  // Fire-and-forget: don't block the response
  (async () => {
    let geo = req.session?._geo;
    if (!geo) {
      geo = await _lookupGeo(ip);
      if (req.session) req.session._geo = geo;
    }
    const visitorId = await analytics.recordVisit({
      ip, userAgent, sessionId,
      country: geo.country,
      city:    geo.city,
    });
    // Stash visitor_id in session so auth routes can reference it
    if (req.session && !req.session._vid) req.session._vid = visitorId;
  })().catch(() => {});

  next();
};
