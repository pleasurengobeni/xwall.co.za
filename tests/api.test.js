/**
 * @jest-environment node
 *
 * tests/api.test.js
 * Unit tests for the api route helper (requireAuth) and playlist-shaping logic,
 * without making real network requests to Spotify/YouTube.
 */
process.env.SESSION_SECRET = 'test-secret-must-be-at-least-32-chars!';
process.env.NODE_ENV       = 'test';

const request = require('supertest');
const app     = require('../server');

// ── requireAuth middleware ────────────────────────────────────────────────────
describe('requireAuth middleware', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).get('/api/playlists');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Not authenticated');
  });
});

// ── Playlist route with mocked fetch ─────────────────────────────────────────
// We inject a fake authenticated session by monkey-patching passport's
// deserializeUser path via a custom test helper middleware — the cleanest
// way without exposing session internals in production code.
// Instead we test the route logic through a thin wrapper that directly invokes
// the handler with a mock req/res.

describe('playlist shaping — Spotify', () => {
  const buildSpotifyResponse = (items) => ({
    ok: true,
    json: async () => ({ items }),
  });

  let originalFetch;
  beforeEach(() => { originalFetch = global.fetch; });
  afterEach  (() => { global.fetch = originalFetch; });

  // Load the router in isolation by requiring it directly
  const router = require('../routes/api');

  function makeReqRes(user) {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const req = {
      isAuthenticated: () => true,
      user,
    };
    const res = { json, status };
    const next = jest.fn();
    return { req, res, next, json, status };
  }

  it('maps Spotify items to { id, name, image, provider }', async () => {
    const items = [
      { id: 'abc123', name: 'My Mix', images: [{ url: 'https://img.example.com/1.jpg' }] },
      { id: 'def456', name: 'Chill', images: [] },
    ];
    global.fetch = jest.fn().mockResolvedValue(buildSpotifyResponse(items));

    const { req, res, json } = makeReqRes({ provider: 'spotify', accessToken: 'tok' });
    // Invoke the stack manually — find the /playlists route handler
    const layer = router.stack.find((l) => l.route && l.route.path === '/playlists');
    const handlers = layer.route.stack.map((s) => s.handle);
    // handlers[0] = requireAuth, handlers[1] = async route fn
    await handlers[1](req, res, jest.fn());

    expect(json).toHaveBeenCalledWith({
      playlists: [
        { id: 'abc123', name: 'My Mix', image: 'https://img.example.com/1.jpg', provider: 'spotify' },
        { id: 'def456', name: 'Chill', image: null, provider: 'spotify' },
      ],
    });
  });

  it('returns upstream status code when Spotify responds non-ok', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'Unauthorized' } }),
    });

    const { req, res, status, json } = makeReqRes({ provider: 'spotify', accessToken: 'bad' });
    const layer = router.stack.find((l) => l.route && l.route.path === '/playlists');
    const handlers = layer.route.stack.map((s) => s.handle);
    await handlers[1](req, res, jest.fn());

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: 'Unauthorized', reauth: true });
  });
});

describe('playlist shaping — YouTube', () => {
  let originalFetch;
  beforeEach(() => { originalFetch = global.fetch; });
  afterEach  (() => { global.fetch = originalFetch; });

  const router = require('../routes/api');
  function makeReqRes(user) {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const req = { isAuthenticated: () => true, user };
    const res = { json, status };
    return { req, res, json, status };
  }

  it('maps YouTube items to { id, name, image, provider }', async () => {
    const playlistItems = [
      {
        id: 'PL123',
        snippet: {
          title: 'Lofi Beats',
          thumbnails: { default: { url: 'https://img.yt.com/t.jpg' } },
        },
      },
    ];
    const channelItems = [{ snippet: { title: 'Lofi Beats', customUrl: null } }];
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: channelItems }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: playlistItems }) });

    const { req, res, json } = makeReqRes({ provider: 'google', accessToken: 'tok' });
    const layer = router.stack.find((l) => l.route && l.route.path === '/playlists');
    const handlers = layer.route.stack.map((s) => s.handle);
    await handlers[1](req, res, jest.fn());

    expect(json).toHaveBeenCalledWith({
      playlists: [
        { id: 'PL123', name: 'Lofi Beats', image: 'https://img.yt.com/t.jpg', provider: 'youtube' },
      ],
      channelInfo: { title: 'Lofi Beats', customUrl: null },
    });
  });

  it('handles missing thumbnails gracefully (image: null)', async () => {
    const playlistItems = [{ id: 'PL999', snippet: { title: 'No Thumb' } }];
    const channelItems = [{ snippet: { title: 'No Thumb', customUrl: null } }];
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: channelItems }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: playlistItems }) });

    const { req, res, json } = makeReqRes({ provider: 'google', accessToken: 'tok' });
    const layer = router.stack.find((l) => l.route && l.route.path === '/playlists');
    const handlers = layer.route.stack.map((s) => s.handle);
    await handlers[1](req, res, jest.fn());

    expect(json).toHaveBeenCalledWith({
      playlists: [{ id: 'PL999', name: 'No Thumb', image: null, provider: 'youtube' }],
      channelInfo: { title: 'No Thumb', customUrl: null },
    });
  });

  it('handles empty items array', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [] }) });

    const { req, res, json } = makeReqRes({ provider: 'google', accessToken: 'tok' });
    const layer = router.stack.find((l) => l.route && l.route.path === '/playlists');
    const handlers = layer.route.stack.map((s) => s.handle);
    await handlers[1](req, res, jest.fn());

    expect(json).toHaveBeenCalledWith({ playlists: [], channelInfo: null });
  });

  it('returns 400 for unknown provider', async () => {
    const { req, res, status, json } = makeReqRes({ provider: 'unknown', accessToken: 'tok' });
    const layer = router.stack.find((l) => l.route && l.route.path === '/playlists');
    const handlers = layer.route.stack.map((s) => s.handle);
    await handlers[1](req, res, jest.fn());

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ error: 'Unknown provider' });
  });

  it('returns 500 when fetch throws a network error', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network failure'));
    const { req, res, status, json } = makeReqRes({ provider: 'google', accessToken: 'tok' });
    const layer = router.stack.find((l) => l.route && l.route.path === '/playlists');
    const handlers = layer.route.stack.map((s) => s.handle);
    await handlers[1](req, res, jest.fn());

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ error: 'Failed to fetch playlists' });
  });
});

describe('video suggestions', () => {
  let originalFetch;

  // The route is authenticated-optional: signed-in Google users get live
  // results on their own token, everyone else gets the bundled list.
  const router = require('../routes/api');
  const suggestionHandler = () => {
    const layer = router.stack.find((l) => l.route && l.route.path === '/videos/suggestions');
    return layer.route.stack[layer.route.stack.length - 1].handle;
  };
  function makeReqRes({ authenticated = false, query = {} } = {}) {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const req = {
      query,
      isAuthenticated: () => authenticated,
      user: authenticated ? { provider: 'google', accessToken: 'user-token', id: 'u1' } : undefined,
    };
    return { req, res: { json, status }, json, status };
  }

  beforeEach(() => { originalFetch = global.fetch; });
  afterEach(() => { global.fetch = originalFetch; });

  it("uses the signed-in user's token and filters to 30+ minute videos", async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ id: { videoId: 'long1' } }, { id: { videoId: 'short1' } }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            {
              id: 'long1',
              snippet: { title: 'Long Space Video', thumbnails: { medium: { url: 'https://img/long.jpg' } } },
              contentDetails: { duration: 'PT2H5M' },
            },
            {
              id: 'short1',
              snippet: { title: 'Short Clip', thumbnails: { medium: { url: 'https://img/short.jpg' } } },
              contentDetails: { duration: 'PT9M' },
            },
          ],
        }),
      });

    const { req, res, json } = makeReqRes({ authenticated: true, query: { mode: 'scenic', limit: '5' } });
    await suggestionHandler()(req, res);

    // Both upstream calls carry the user's bearer token and no API key
    for (const [url, options] of global.fetch.mock.calls) {
      expect(options.headers.Authorization).toBe('Bearer user-token');
      expect(url).not.toContain('key=');
    }
    expect(json).toHaveBeenCalledWith({
      fallback: false,
      videos: [
        { id: 'long1', title: 'Long Space Video', thumbnail: 'https://img/long.jpg', durationLabel: '2h 5m' },
      ],
    });
  });

  it('serves the bundled list to visitors who are not signed in', async () => {
    global.fetch = jest.fn();
    const { req, res, json } = makeReqRes({ authenticated: false, query: { mode: 'river', limit: '4' } });
    await suggestionHandler()(req, res);

    expect(global.fetch).not.toHaveBeenCalled();
    const payload = json.mock.calls[0][0];
    expect(payload.fallback).toBe(true);
    expect(payload.videos.length).toBeGreaterThan(0);
  });

  it('returns 400 for unsupported suggestion mode', async () => {
    const res = await request(app).get('/api/videos/suggestions?mode=unknown');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Unsupported mode' });
  });

  it('falls back to the bundled list when the user\'s search fails', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: false, status: 403 });

    const { req, res, json } = makeReqRes({ authenticated: true, query: { mode: 'fireplace', limit: '4' } });
    await suggestionHandler()(req, res);

    const payload = json.mock.calls[0][0];
    expect(payload.fallback).toBe(true);
    expect(payload.videos[0]).toHaveProperty('id');
  });
});

describe('playlist search — runs on the user\'s own account', () => {
  let originalFetch;
  const router = require('../routes/api');

  // [gate, searchLimit, handler] — the gate and the handler are what we drive
  const searchLayers = () => {
    const layer = router.stack.find((l) => l.route && l.route.path === '/playlists/search');
    return layer.route.stack.map((s) => s.handle);
  };

  function makeReqRes(user, query) {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const res = { json, status, locals: {} };
    const req = { query, isAuthenticated: () => Boolean(user), user };
    return { req, res, json, status };
  }

  beforeEach(() => { originalFetch = global.fetch; });
  afterEach(() => { global.fetch = originalFetch; });

  it('asks unauthenticated visitors to sign in instead of using a server key', async () => {
    const res = await request(app).get('/api/playlists/search?q=lofi');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Sign in to search playlists', signin: true });
  });

  it("searches YouTube with the Google user's token", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [{ id: { playlistId: 'PLx' }, snippet: { title: 'Lofi', thumbnails: { medium: { url: 'https://i/y.jpg' } } } }],
      }),
    });

    const [gate, , handler] = searchLayers();
    const { req, res, json } = makeReqRes(
      { provider: 'google', accessToken: 'g-token', id: 'u1' },
      { q: 'lofi beats', limit: '8' }
    );
    await new Promise((resolve) => gate(req, res, resolve));
    await handler(req, res);

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toContain('googleapis.com/youtube/v3/search');
    expect(url).not.toContain('key=');
    expect(options.headers.Authorization).toBe('Bearer g-token');
    expect(json).toHaveBeenCalledWith({
      provider: 'youtube',
      playlists: [{ id: 'PLx', name: 'Lofi', image: 'https://i/y.jpg', provider: 'youtube' }],
    });
  });

  it("searches Spotify with the Spotify user's token (no YouTube quota)", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        playlists: { items: [null, { id: 'sp1', name: 'Chill', images: [{ url: 'https://i/s.jpg' }] }] },
      }),
    });

    const [gate, , handler] = searchLayers();
    const { req, res, json } = makeReqRes(
      { provider: 'spotify', accessToken: 's-token', id: 'u2' },
      { q: 'chill vibes', limit: '8' }
    );
    await new Promise((resolve) => gate(req, res, resolve));
    await handler(req, res);

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toContain('api.spotify.com/v1/search');
    expect(options.headers.Authorization).toBe('Bearer s-token');
    expect(json).toHaveBeenCalledWith({
      provider: 'spotify',
      playlists: [{ id: 'sp1', name: 'Chill', image: 'https://i/s.jpg', provider: 'spotify' }],
    });
  });

  it('flags an expired provider token so the client can prompt a fresh sign-in', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'Invalid Credentials' } }),
    });

    const [gate, , handler] = searchLayers();
    const { req, res, status, json } = makeReqRes(
      { provider: 'google', accessToken: 'stale', id: 'u3' },
      { q: 'expired token query', limit: '8' }
    );
    await new Promise((resolve) => gate(req, res, resolve));
    await handler(req, res);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: 'Invalid Credentials', reauth: true });
  });
});
