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
    expect(json).toHaveBeenCalledWith({ error: 'Unauthorized' });
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
  const originalApiKey = process.env.GOOGLE_API_KEY;
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    process.env.GOOGLE_API_KEY = 'test-google-key';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.GOOGLE_API_KEY = originalApiKey;
  });

  it('filters suggestions to 30+ minute embeddable videos and returns duration labels', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            { id: { videoId: 'long1' } },
            { id: { videoId: 'short1' } },
          ],
        }),
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

    const res = await request(app).get('/api/videos/suggestions?mode=scenic&limit=5');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      videos: [
        {
          id: 'long1',
          title: 'Long Space Video',
          thumbnail: 'https://img/long.jpg',
          durationLabel: '2h 5m',
        },
      ],
    });
  });

  it('returns 400 for unsupported suggestion mode', async () => {
    const res = await request(app).get('/api/videos/suggestions?mode=unknown');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Unsupported mode' });
  });
});
