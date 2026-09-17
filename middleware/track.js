'use strict';
/**
 * middleware/track.js
 * Records a page view on every GET request for HTML (the SPA root).
 * Geo lookups go through lib/geo, which caches per IP.
 */

const analytics = require('../db/analytics');
const geo       = require('../lib/geo');
const { normalizeIp } = require('../lib/http');

module.exports = function trackVisitor(req, res, next) {
  // Only instrument the SPA root page load
  if (req.method !== 'GET' || req.path !== '/' || req.xhr) return next();

  // req.ip honours the 'trust proxy' setting, so a client can't spoof its
  // address by sending its own X-Forwarded-For header.
  const ip = normalizeIp(req.ip);
  if (!ip) return next();

  const userAgent = String(req.headers['user-agent'] || '').slice(0, 512);
  const sessionId = req.session?.id || null;

  // Fire-and-forget: don't block the response
  (async () => {
    const location  = await geo.lookup(ip);
    const visitorId = await analytics.recordVisit({
      ip, userAgent, sessionId,
      country: location.country,
      city:    location.city,
    });
    // Stash visitor_id in session so auth routes can reference it
    if (req.session && !req.session._vid) req.session._vid = visitorId;
  })().catch(() => {});

  next();
};
