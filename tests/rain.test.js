/**
 * @jest-environment jsdom
 *
 * tests/rain.test.js
 * Tests for the Rain module: start, stop, canvas creation/teardown,
 * resize handling, drop count, animation loop.
 */

let mockCtx;

beforeAll(() => {
  document.body.innerHTML = `<div id="rain-canvas-host" style="width:800px;height:600px;"></div>`;

  // jsdom doesn't implement canvas — provide a minimal mock.
  // Return the SAME mockCtx object every time so tests can inspect it.
  mockCtx = {
    clearRect:            jest.fn(),
    beginPath:            jest.fn(),
    moveTo:               jest.fn(),
    lineTo:               jest.fn(),
    stroke:               jest.fn(),
    createLinearGradient: jest.fn().mockReturnValue({ addColorStop: jest.fn() }),
    lineWidth:   0,
    strokeStyle: '',
  };
  global.HTMLCanvasElement.prototype.getContext = jest.fn(() => mockCtx);

  // Use fake timers FIRST — then override RAF/CAF with jest.fn that delegate
  // to fake setTimeout so advanceTimersByTime drives the animation loop.
  jest.useFakeTimers();

  // Mock requestAnimationFrame / cancelAnimationFrame AFTER fake timers so our
  // jest.fn wrappers are not overwritten by Jest's fake timer installation.
  let rafId = 0;
  global.requestAnimationFrame  = jest.fn((cb) => { rafId++; return setTimeout(cb, 16); });
  global.cancelAnimationFrame   = jest.fn((id) => clearTimeout(id));
  const { loadModule } = require('./setup/globals');
  loadModule('rain.js');
});

afterEach(() => {
  Rain.stop();
  // Only clear call counts, not the mock implementation
  mockCtx.clearRect.mockClear();
  mockCtx.beginPath.mockClear();
  mockCtx.moveTo.mockClear();
  mockCtx.lineTo.mockClear();
  mockCtx.stroke.mockClear();
  mockCtx.createLinearGradient.mockClear();
  mockCtx.createLinearGradient.mockReturnValue({ addColorStop: jest.fn() });
  global.requestAnimationFrame.mockClear();
  global.cancelAnimationFrame.mockClear();
  jest.clearAllTimers();
});

afterAll(() => jest.useRealTimers());

// ── start() ───────────────────────────────────────────────────────────────────
describe('Rain.start()', () => {
  it('appends a canvas to #rain-canvas-host', () => {
    Rain.start();
    const host = document.getElementById('rain-canvas-host');
    expect(host.querySelector('canvas')).not.toBeNull();
  });

  it('canvas has pointer-events:none and position:absolute', () => {
    Rain.start();
    const canvas = document.getElementById('rain-canvas-host').querySelector('canvas');
    expect(canvas.style.pointerEvents).toBe('none');
    expect(canvas.style.position).toBe('absolute');
  });

  it('starts requestAnimationFrame loop', () => {
    Rain.start();
    jest.advanceTimersByTime(16);
    expect(global.requestAnimationFrame).toHaveBeenCalled();
  });

  it('calling start() while already running does not create a second canvas', () => {
    Rain.start();
    Rain.start(); // should call stop() internally first
    const host = document.getElementById('rain-canvas-host');
    expect(host.querySelectorAll('canvas').length).toBe(1);
  });
});

// ── stop() ────────────────────────────────────────────────────────────────────
describe('Rain.stop()', () => {
  it('removes canvas from DOM', () => {
    Rain.start();
    Rain.stop();
    expect(document.getElementById('rain-canvas-host').querySelector('canvas')).toBeNull();
  });

  it('calls cancelAnimationFrame', () => {
    Rain.start();
    jest.advanceTimersByTime(15); // kick off at least one frame
    Rain.stop();
    expect(global.cancelAnimationFrame).toHaveBeenCalled();
  });

  it('does not throw when called without a prior start()', () => {
    expect(() => Rain.stop()).not.toThrow();
  });

  it('can be restarted after stop', () => {
    Rain.start();
    Rain.stop();
    Rain.start();
    expect(document.getElementById('rain-canvas-host').querySelector('canvas')).not.toBeNull();
  });
});

// ── Resize handling ───────────────────────────────────────────────────────────
describe('Rain resize handler', () => {
  it('removes resize listener on stop', () => {
    const spy = jest.spyOn(window, 'removeEventListener');
    Rain.start();
    Rain.stop();
    expect(spy).toHaveBeenCalledWith('resize', expect.any(Function));
    spy.mockRestore();
  });

  it('adds resize listener on start', () => {
    const spy = jest.spyOn(window, 'addEventListener');
    Rain.start();
    expect(spy).toHaveBeenCalledWith('resize', expect.any(Function));
    spy.mockRestore();
  });
});

// ── Frame rendering ───────────────────────────────────────────────────────────
describe('Rain frame rendering', () => {
  it('calls clearRect on each animation frame', () => {
    Rain.start();
    jest.advanceTimersByTime(15); // advance <16ms so exactly one frame fires
    expect(mockCtx.clearRect).toHaveBeenCalled();
  });

  it('draws 140 strokes per frame (COUNT drops)', () => {
    Rain.start();
    jest.advanceTimersByTime(15);
    // Each drop calls stroke once; one frame = 140 strokes
    expect(mockCtx.stroke).toHaveBeenCalledTimes(140);
  });
});
