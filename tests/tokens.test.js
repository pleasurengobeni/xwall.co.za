/**
 * @jest-environment node
 *
 * tests/tokens.test.js
 * Keeping users signed in: expired provider tokens are renewed with the
 * encrypted refresh token instead of signing the user out.
 */
process.env.SESSION_SECRET       = 'test-secret-must-be-at-least-32-chars!';
process.env.GOOGLE_CLIENT_ID     = 'google-client';
process.env.GOOGLE_CLIENT_SECRET = 'google-secret';
process.env.SPOTIFY_CLIENT_ID     = 'spotify-client';
process.env.SPOTIFY_CLIENT_SECRET = 'spotify-secret';

const tokens = require('../lib/tokens');

let originalFetch;
beforeEach(() => { originalFetch = global.fetch; });
afterEach(() => { global.fetch = originalFetch; });

const json = (status, body) => ({ ok: status < 400, status, json: async () => body });

function makeReq(user) {
  const session = { passport: { user }, save: jest.fn((cb) => cb()) };
  return { user, session };
}

describe('refresh token encryption', () => {
  it('round-trips and never stores the token in plain text', () => {
    const box = tokens.encrypt('1//refresh-token');
    expect(box).not.toContain('refresh-token');
    expect(tokens.decrypt(box)).toBe('1//refresh-token');
  });

  it('returns null for tampered or foreign data instead of throwing', () => {
    const box = tokens.encrypt('secret');
    const tampered = box.slice(0, -4) + (box.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    expect(tokens.decrypt(tampered)).toBeNull();
    expect(tokens.decrypt('garbage')).toBeNull();
    expect(tokens.decrypt(null)).toBeNull();
  });
});

describe('getAccessToken()', () => {
  it('uses the current token while it is still valid', async () => {
    global.fetch = jest.fn();
    const req = makeReq({ provider: 'google', accessToken: 'live', expiresAt: Date.now() + 30 * 60 * 1000 });
    expect(await tokens.getAccessToken(req)).toBe('live');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('renews an expired Google token and saves it to the session', async () => {
    global.fetch = jest.fn().mockResolvedValue(json(200, { access_token: 'fresh', expires_in: 3599 }));
    const user = {
      provider: 'google', accessToken: 'stale', expiresAt: Date.now() - 1000,
      refreshTokenEnc: tokens.encrypt('g-refresh'),
    };
    const req = makeReq(user);

    expect(await tokens.getAccessToken(req)).toBe('fresh');

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    const body = new URLSearchParams(options.body.toString());
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('g-refresh');
    expect(req.session.passport.user.accessToken).toBe('fresh');
    expect(req.session.passport.user.expiresAt).toBeGreaterThan(Date.now());
    expect(req.session.save).toHaveBeenCalled();
  });

  it('stores a rotated Spotify refresh token, still encrypted', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      json(200, { access_token: 'sp-fresh', expires_in: 3600, refresh_token: 'sp-rotated' }));
    const user = {
      provider: 'spotify', accessToken: 'old', expiresAt: Date.now() - 1,
      refreshTokenEnc: tokens.encrypt('sp-refresh'),
    };
    const req = makeReq(user);

    expect(await tokens.getAccessToken(req)).toBe('sp-fresh');
    expect(global.fetch.mock.calls[0][0]).toBe('https://accounts.spotify.com/api/token');
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toMatch(/^Basic /);
    expect(user.refreshTokenEnc).not.toContain('sp-rotated');
    expect(tokens.decrypt(user.refreshTokenEnc)).toBe('sp-rotated');
  });

  it('returns null when the user revoked access (refresh rejected)', async () => {
    global.fetch = jest.fn().mockResolvedValue(json(400, { error: 'invalid_grant' }));
    const req = makeReq({
      provider: 'google', accessToken: 'stale', expiresAt: Date.now() - 1,
      refreshTokenEnc: tokens.encrypt('revoked'),
    });
    expect(await tokens.getAccessToken(req)).toBeNull();
  });
});

describe('authorizedFetch()', () => {
  it('refreshes once and retries when the provider rejects the token', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(json(401, {}))                                   // API call: token rejected
      .mockResolvedValueOnce(json(200, { access_token: 'renewed', expires_in: 3600 })) // refresh
      .mockResolvedValueOnce(json(200, { items: [] }));                       // retried API call
    const req = makeReq({
      provider: 'google', accessToken: 'rejected', refreshTokenEnc: tokens.encrypt('g-refresh'),
    });

    const res = await tokens.authorizedFetch(req, 'https://www.googleapis.com/youtube/v3/playlists');

    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(global.fetch.mock.calls[2][1].headers.Authorization).toBe('Bearer renewed');
  });

  it('passes the 401 through when there is nothing to refresh with', async () => {
    global.fetch = jest.fn().mockResolvedValue(json(401, {}));
    const req = makeReq({ provider: 'google', accessToken: 'rejected' });

    const res = await tokens.authorizedFetch(req, 'https://www.googleapis.com/youtube/v3/playlists');
    expect(res.status).toBe(401);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
