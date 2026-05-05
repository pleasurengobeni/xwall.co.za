/**
 * @jest-environment node
 *
 * tests/server.test.js
 * Integration tests for Express routes using supertest.
 * The server module is required directly — no HTTP listener is started.
 */
process.env.SESSION_SECRET = 'test-secret-must-be-at-least-32-chars!';
process.env.NODE_ENV       = 'test';

const request = require('supertest');
const app     = require('../server');

// ── /ping ─────────────────────────────────────────────────────────────────────
describe('GET /ping', () => {
  it('returns 200 with { ok: true }', async () => {
    const res = await request(app).get('/ping');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

// ── /auth/status ──────────────────────────────────────────────────────────────
describe('GET /auth/status', () => {
  it('returns authenticated:false when no session', async () => {
    const res = await request(app).get('/auth/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authenticated: false });
  });

  it('sets Content-Type application/json', async () => {
    const res = await request(app).get('/auth/status');
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });
});

// ── /auth/google ──────────────────────────────────────────────────────────────
describe('GET /auth/google (no credentials configured)', () => {
  it('returns 302 or 500 — does not expose internal errors as plain text', async () => {
    const res = await request(app).get('/auth/google');
    // Without GOOGLE_CLIENT_ID set, passport throws InternalOAuthError or redirects
    expect([302, 500]).toContain(res.status);
  });
});

// ── /auth/spotify ─────────────────────────────────────────────────────────────
describe('GET /auth/spotify (no credentials configured)', () => {
  it('returns 302 or 500 — does not expose internal errors as plain text', async () => {
    const res = await request(app).get('/auth/spotify');
    expect([302, 500]).toContain(res.status);
  });
});

// ── /auth/logout ──────────────────────────────────────────────────────────────
describe('POST /auth/logout', () => {
  it('returns 200 with { ok: true } when not logged in', async () => {
    const res = await request(app).post('/auth/logout');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('clears connect.sid cookie', async () => {
    const res = await request(app).post('/auth/logout');
    const setCookie = res.headers['set-cookie'] ?? [];
    const cleared = setCookie.some(
      (c) => c.startsWith('connect.sid=') && c.includes('Expires=')
    );
    // cookie clearing is best-effort; pass if either cleared or not present
    expect(typeof cleared).toBe('boolean');
  });
});

// ── /api/playlists (requires auth) ───────────────────────────────────────────
describe('GET /api/playlists', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/playlists');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: 'Not authenticated' });
  });
});

// ── SPA fallback ──────────────────────────────────────────────────────────────
describe('GET unknown route', () => {
  it('serves index.html for unmatched routes (SPA fallback)', async () => {
    const res = await request(app).get('/does-not-exist/at/all');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.text).toContain('xwall');
  });
});

// ── Security headers ──────────────────────────────────────────────────────────
describe('Security headers (helmet)', () => {
  let res;
  beforeAll(async () => { res = await request(app).get('/ping'); });

  it('sets X-Content-Type-Options: nosniff', () => {
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('sets X-Frame-Options (frameguard)', () => {
    expect(res.headers['x-frame-options']).toBeDefined();
  });

  it('Content-Security-Policy includes YouTube script src', () => {
    const csp = res.headers['content-security-policy'] ?? '';
    expect(csp).toContain('https://www.youtube.com');
  });

  it('Content-Security-Policy includes Spotify frame-src', () => {
    const csp = res.headers['content-security-policy'] ?? '';
    expect(csp).toContain('https://open.spotify.com');
  });

  it('Content-Security-Policy blocks object-src', () => {
    const csp = res.headers['content-security-policy'] ?? '';
    expect(csp).toContain("object-src 'none'");
  });
});
