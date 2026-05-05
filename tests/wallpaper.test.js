/**
 * @jest-environment jsdom
 *
 * tests/wallpaper.test.js
 * Tests for the Wallpaper module: set(), mode persistence, clock/rain coordination.
 */

let clockStartSpy, clockStopSpy, rainStartSpy, rainStopSpy;

beforeAll(() => {
  document.body.innerHTML = `
    <div id="bg-layer">
      <div id="css-bg"></div>
      <iframe id="bg-video" class=""></iframe>
    </div>
  `;

  // Stub Clock and Rain globals before wallpaper.js tries to call them
  global.Clock = { start: jest.fn(), stop: jest.fn() };
  global.Rain  = { start: jest.fn(), stop: jest.fn() };

  clockStartSpy = jest.spyOn(Clock, 'start');
  clockStopSpy  = jest.spyOn(Clock, 'stop');
  rainStartSpy  = jest.spyOn(Rain,  'start');
  rainStopSpy   = jest.spyOn(Rain,  'stop');

  jest.useFakeTimers();
  const { loadModule } = require('./setup/globals');
  loadModule('wallpaper.js');
});

afterEach(() => {
  // Reset Wallpaper's internal currentMode so the next test's set() is never
  // treated as a no-op. Use a sentinel value that no real test will use.
  Wallpaper.set('_reset_');
  jest.clearAllMocks();
  // Reset CSS classes
  const cssBg   = document.getElementById('css-bg');
  const bgVideo = document.getElementById('bg-video');
  if (cssBg)   cssBg.className   = '';
  if (bgVideo) bgVideo.className = '';
  bgVideo.setAttribute('src', '');
  jest.clearAllTimers();
});

afterAll(() => jest.useRealTimers());

// ── set() — basic mode switching ─────────────────────────────────────────────
describe('Wallpaper.set()', () => {
  it('sets css-bg class to "css-bg fireplace" for fireplace mode', () => {
    Wallpaper.set('fireplace');
    jest.advanceTimersByTime(300);
    expect(document.getElementById('css-bg').className).toContain('fireplace');
  });

  it('sets css-bg class to "css-bg rain" for rain mode', () => {
    Wallpaper.set('rain');
    jest.advanceTimersByTime(300);
    expect(document.getElementById('css-bg').className).toContain('rain');
  });

  it('sets css-bg class to "css-bg river" for river mode', () => {
    Wallpaper.set('river');
    jest.advanceTimersByTime(300);
    expect(document.getElementById('css-bg').className).toContain('river');
  });

  it('sets css-bg class to "css-bg scenic" for scenic mode', () => {
    Wallpaper.set('scenic');
    jest.advanceTimersByTime(300);
    expect(document.getElementById('css-bg').className).toContain('scenic');
  });

  it('sets css-bg class to "css-bg clock-bg" for clock mode', () => {
    Wallpaper.set('clock');
    expect(document.getElementById('css-bg').className).toContain('clock-bg');
  });

  it('persists mode to localStorage', () => {
    Wallpaper.set('river');
    expect(localStorage.getItem('xwall_mode')).toBe('river');
  });

  it('current() returns the active mode', () => {
    Wallpaper.set('scenic');
    expect(Wallpaper.current()).toBe('scenic');
  });
});

// ── Clock coordination ────────────────────────────────────────────────────────
describe('Wallpaper clock mode coordination', () => {
  it('calls Clock.start() when mode is "clock"', () => {
    Wallpaper.set('clock');
    expect(clockStartSpy).toHaveBeenCalled();
  });

  it('calls Rain.stop() before starting the clock', () => {
    Wallpaper.set('clock');
    expect(rainStopSpy).toHaveBeenCalled();
  });

  it('calls Clock.stop() when switching away from clock mode', () => {
    Wallpaper.set('clock');
    clockStopSpy.mockClear();
    Wallpaper.set('fireplace');
    expect(clockStopSpy).toHaveBeenCalled();
  });
});

// ── Rain coordination ─────────────────────────────────────────────────────────
describe('Wallpaper rain mode coordination', () => {
  it('calls Rain.start() for rain mode', () => {
    Wallpaper.set('rain');
    expect(rainStartSpy).toHaveBeenCalled();
  });

  it('calls Rain.stop() when switching to a non-rain mode', () => {
    Wallpaper.set('rain');
    rainStopSpy.mockClear();
    Wallpaper.set('scenic');
    expect(rainStopSpy).toHaveBeenCalled();
  });

  it('does NOT call Rain.start() for non-rain video modes', () => {
    Wallpaper.set('fireplace');
    expect(rainStartSpy).not.toHaveBeenCalled();
  });
});

// ── Idempotency ───────────────────────────────────────────────────────────────
describe('Wallpaper.set() idempotency', () => {
  it('does not fire timers again when same mode called twice', () => {
    Wallpaper.set('river');
    const timerSpy = jest.spyOn(global, 'setTimeout');
    Wallpaper.set('river'); // no-op
    expect(timerSpy).not.toHaveBeenCalled();
    timerSpy.mockRestore();
  });
});

// ── Video fade-in timing ──────────────────────────────────────────────────────
describe('Wallpaper video loading', () => {
  it('video src is set after 200 ms delay', () => {
    Wallpaper.set('fireplace');
    expect(document.getElementById('bg-video').getAttribute('src')).toBe('');
    jest.advanceTimersByTime(200);
    expect(document.getElementById('bg-video').src).toContain('youtube.com');
  });

  it('video gets "loaded" class after 200 + 2500 ms', () => {
    Wallpaper.set('scenic');
    jest.advanceTimersByTime(2700);
    expect(document.getElementById('bg-video').classList.contains('loaded')).toBe(true);
  });

  it('bg-video loses "loaded" class immediately on mode switch', () => {
    Wallpaper.set('fireplace');
    jest.advanceTimersByTime(2700); // fully loaded
    Wallpaper.set('river');
    expect(document.getElementById('bg-video').classList.contains('loaded')).toBe(false);
  });
});

// ── init() ────────────────────────────────────────────────────────────────────
describe('Wallpaper.init()', () => {
  it('is callable without throwing', () => {
    expect(() => Wallpaper.init()).not.toThrow();
  });
});
