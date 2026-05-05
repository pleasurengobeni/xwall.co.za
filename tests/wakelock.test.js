/**
 * @jest-environment jsdom
 *
 * tests/wakelock.test.js
 * Tests for the WakeLock module: request, release, network keep-alive,
 * visibility change re-acquire, indicator updates.
 */

let mockLock;

beforeAll(() => {
  document.body.innerHTML = `<span id="wake-indicator"></span>`;

  // Mock navigator.wakeLock
  mockLock = {
    release: jest.fn().mockResolvedValue(undefined),
    addEventListener: jest.fn(),
    released: false,
  };

  Object.defineProperty(navigator, 'wakeLock', {
    configurable: true,
    value: {
      request: jest.fn().mockResolvedValue(mockLock),
    },
  });

  // Mock fetch for /ping
  global.fetch = jest.fn().mockResolvedValue({ ok: true });

  jest.useFakeTimers();
  const { loadModule } = require('./setup/globals');
  loadModule('wakelock.js');
});

afterEach(async () => {
  await WakeLock.release();
  WakeLock.stopNetwork();
  jest.clearAllMocks();
  // Reset mock lock
  mockLock.release.mockResolvedValue(undefined);
  navigator.wakeLock.request.mockResolvedValue(mockLock);
});

afterAll(() => jest.useRealTimers());

// ── request() ────────────────────────────────────────────────────────────────
describe('WakeLock.request()', () => {
  it('calls navigator.wakeLock.request("screen")', async () => {
    await WakeLock.request();
    expect(navigator.wakeLock.request).toHaveBeenCalledWith('screen');
  });

  it('sets wake-indicator to ☀️ on success', async () => {
    await WakeLock.request();
    expect(document.getElementById('wake-indicator').textContent).toBe('☀️');
  });

  it('does not throw when wakeLock is unsupported', async () => {
    const original = navigator.wakeLock;
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: undefined });
    await expect(WakeLock.request()).resolves.not.toThrow();
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: original });
  });

  it('silently handles rejection from wakeLock.request', async () => {
    navigator.wakeLock.request.mockRejectedValueOnce(new DOMException('Not allowed', 'NotAllowedError'));
    await expect(WakeLock.request()).resolves.not.toThrow();
    expect(document.getElementById('wake-indicator').textContent).toBe('💤');
  });
});

// ── release() ────────────────────────────────────────────────────────────────
describe('WakeLock.release()', () => {
  it('calls lock.release()', async () => {
    await WakeLock.request();
    await WakeLock.release();
    expect(mockLock.release).toHaveBeenCalled();
  });

  it('sets wake-indicator to 💤', async () => {
    await WakeLock.request();
    await WakeLock.release();
    expect(document.getElementById('wake-indicator').textContent).toBe('💤');
  });

  it('does not throw when no lock is held', async () => {
    await expect(WakeLock.release()).resolves.not.toThrow();
  });

  it('stops the network timer', async () => {
    await WakeLock.request();
    WakeLock.startNetwork();
    await WakeLock.release();
    // After release, advancing time should NOT trigger more fetch calls
    jest.clearAllMocks();
    jest.advanceTimersByTime(30_000);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ── startNetwork() / stopNetwork() ───────────────────────────────────────────
describe('WakeLock network keep-alive', () => {
  it('calls fetch("/ping") after 25 s', () => {
    WakeLock.startNetwork();
    jest.advanceTimersByTime(25_000);
    expect(global.fetch).toHaveBeenCalledWith('/ping', expect.objectContaining({ method: 'GET' }));
  });

  it('pings twice after 50 s', () => {
    WakeLock.startNetwork();
    jest.advanceTimersByTime(50_000);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('startNetwork() is idempotent — does not create double interval', () => {
    WakeLock.startNetwork();
    WakeLock.startNetwork(); // second call should no-op
    jest.advanceTimersByTime(25_000);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('stopNetwork() prevents further pings', () => {
    WakeLock.startNetwork();
    WakeLock.stopNetwork();
    jest.advanceTimersByTime(50_000);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fetch failure does not throw or crash ping loop', () => {
    global.fetch.mockRejectedValueOnce(new Error('Network error'));
    WakeLock.startNetwork();
    expect(() => jest.advanceTimersByTime(25_000)).not.toThrow();
  });
});

// ── Visibility change re-acquire ──────────────────────────────────────────────
describe('WakeLock visibility change', () => {
  it('re-requests lock when tab becomes visible after release', async () => {
    await WakeLock.request();
    await WakeLock.release();
    jest.clearAllMocks();

    // Simulate tab becoming visible
    Object.defineProperty(document, 'visibilityState', {
      configurable: true, value: 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));

    // Allow micro-task queue to flush
    await Promise.resolve();
    expect(navigator.wakeLock.request).toHaveBeenCalled();
  });

  it('does NOT re-request when tab becomes hidden', async () => {
    await WakeLock.request();
    jest.clearAllMocks();

    Object.defineProperty(document, 'visibilityState', {
      configurable: true, value: 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    // No new request since a lock is already held
    expect(navigator.wakeLock.request).not.toHaveBeenCalled();
  });
});
