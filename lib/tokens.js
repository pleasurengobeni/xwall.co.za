'use strict';
/**
 * lib/tokens.js
 * Keeps signed-in users signed in. Google and Spotify access tokens expire
 * after about an hour; instead of signing the user out, we exchange the
 * provider's refresh token for a new access token in the background.
 *
 * Refresh tokens are long-lived credentials, so they are stored encrypted
 * (AES-256-GCM, key derived from SESSION_SECRET) inside the server-side
 * session and never sent to the browser. A leaked session table alone does
 * not expose them.
 */

const crypto = require('crypto');
const { fetchWithTimeout } = require('./http');

const REFRESH_MARGIN_MS = 60 * 1000; // refresh a minute before expiry

function _key() {
  const secret = process.env.SESSION_SECRET || 'dev-secret-change-me-in-production-please';
  return crypto.createHash('sha256').update(`xwall-token-key:${secret}`).digest();
}

function encrypt(plain) {
  if (!plain) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', _key(), iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

function decrypt(box) {
  if (!box || typeof box !== 'string') return null;
  try {
    const [iv, tag, data] = box.split('.').map((p) => Buffer.from(p, 'base64'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', _key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch (_) {
    // Wrong key (e.g. SESSION_SECRET rotated) or tampered data
    return null;
  }
}

function expiresAtFrom(expiresInSeconds) {
  const secs = Number(expiresInSeconds);
  return Number.isFinite(secs) && secs > 0 ? Date.now() + secs * 1000 : null;
}

async function _refreshWithProvider(user, refreshToken) {
  if (user.provider === 'google') {
    const res = await fetchWithTimeout('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'refresh_token',
        refresh_token: refreshToken,
        client_id:     process.env.GOOGLE_CLIENT_ID || '',
        client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      }),
    });
    return res.ok ? res.json() : null;
  }

  if (user.provider === 'spotify') {
    const basic = Buffer.from(
      `${process.env.SPOTIFY_CLIENT_ID || ''}:${process.env.SPOTIFY_CLIENT_SECRET || ''}`
    ).toString('base64');
    const res = await fetchWithTimeout('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization:  `Basic ${basic}`,
      },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    });
    return res.ok ? res.json() : null;
  }

  return null;
}

/**
 * Returns a usable access token for the signed-in user, refreshing it first
 * when it has expired (or when `force` is set after the provider rejected it).
 * Returns null when the user must sign in again (no refresh token, or the
 * user revoked access).
 */
async function getAccessToken(req, { force = false } = {}) {
  const user = req.user;
  if (!user) return null;

  const stillValid = user.accessToken &&
    (!user.expiresAt || user.expiresAt - REFRESH_MARGIN_MS > Date.now());
  if (stillValid && !force) return user.accessToken;

  const refreshToken = decrypt(user.refreshTokenEnc);
  if (!refreshToken) return force ? null : user.accessToken || null;

  let data = null;
  try {
    data = await _refreshWithProvider(user, refreshToken);
  } catch (_) {
    data = null;
  }
  if (!data || !data.access_token) return null;

  user.accessToken = data.access_token;
  user.expiresAt   = expiresAtFrom(data.expires_in);
  // Spotify may rotate the refresh token; Google usually does not
  if (data.refresh_token) user.refreshTokenEnc = encrypt(data.refresh_token);

  // Persist the new token in the session (passport stores the whole user)
  if (req.session && req.session.passport) {
    req.session.passport.user = user;
    await new Promise((resolve) => req.session.save(() => resolve()));
  }
  return user.accessToken;
}

/**
 * fetch() on the user's behalf. Adds their bearer token, and if the provider
 * rejects it (401) refreshes once and retries — so an expired token never
 * signs the user out while their refresh token is still valid.
 */
async function authorizedFetch(req, url, options = {}) {
  const withToken = (token) => fetchWithTimeout(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
  });

  const token = await getAccessToken(req);
  const res = await withToken(token || '');
  if (res.status !== 401) return res;

  const fresh = await getAccessToken(req, { force: true });
  return fresh ? withToken(fresh) : res;
}

module.exports = { encrypt, decrypt, expiresAtFrom, getAccessToken, authorizedFetch };
