/**
 * @jest-environment jsdom
 *
 * tests/wallpaper.test.js
 * Tests for the Wallpaper module: mode persistence, clock/rain coordination,
 * YouTube background API loading, mute preference, and fallback behaviour.
 */

let clockStartSpy, clockStopSpy, rainStartSpy, rainStopSpy;
let lastPlayer;

async function flushAsync() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeAll(() => {
  document.body.innerHTML = `
    <div id="bg-layer">
      <div id="css-bg"></div>
      <div id="bg-video" class=""></div>
    </div>
  `;

  // Stub Clock and Rain globals before wallpaper.js tries to call them
  global.Clock = { start: jest.fn(), stop: jest.fn() };
  global.Rain  = { start: jest.fn(), stop: jest.fn() };

  clockStartSpy = jest.spyOn(Clock, 'start');
  clockStopSpy  = jest.spyOn(Clock, 'stop');
  rainStartSpy  = jest.spyOn(Rain,  'start');
  rainStopSpy   = jest.spyOn(Rain,  'stop');

  global.YT = {
    PlayerState: { PLAYING: 1, BUFFERING: 3 },
    Player: jest.fn().mockImplementation((_el, opts) => {
      const player = {
        playVideo: jest.fn(),
        destroy: jest.fn(),
        mute: jest.fn(),
        unMute: jest.fn(),
        setVolume: jest.fn(),
      };
      lastPlayer = player;
      setTimeout(() => opts.events?.onReady?.({ target: player }), 0);
      return player;
    }),
  };
  window.YT = global.YT;

  const { loadModule } = require('./setup/globals');
  loadModule('wallpaper.js');
});

afterEach(() => {
  Wallpaper.set('_reset_');
  const cssBg   = document.getElementById('css-bg');
  const bgVideo = document.getElementById('bg-video');
  if (cssBg)   cssBg.className   = '';
  if (bgVideo) bgVideo.className = '';
  bgVideo.innerHTML = '';
  lastPlayer = null;
  jest.clearAllMocks();
});

// ── set() — basic mode switching ─────────────────────────────────────────────
describe('Wallpaper.set()', () => {
  it('sets css-bg class to "css-bg fireplace" for fireplace mode', () => {
    Wallpaper.set('fireplace');
    expect(document.getElementById('css-bg').className).toContain('fireplace');
  });

  it('sets css-bg class to "css-bg rain" for rain mode', () => {
    Wallpaper.set('rain');
    expect(document.getElementById('css-bg').className).toContain('rain');
  });

  it('sets css-bg class to "css-bg river" for river mode', () => {
    Wallpaper.set('river');
    expect(document.getElementById('css-bg').className).toContain('river');
  });

  it('sets css-bg class to "css-bg scenic" for scenic mode', () => {
    Wallpaper.set('scenic');
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
    const playerSpy = jest.spyOn(YT, 'Player');
    Wallpaper.set('river'); // no-op
    expect(playerSpy).not.toHaveBeenCalled();
    playerSpy.mockRestore();
  });
});

// ── Video loading / playback ────────────────────────────────────────────────
describe('Wallpaper video loading', () => {
  it('creates a YT.Player instance for video modes', async () => {
    Wallpaper.set('fireplace');
    await flushAsync();
    expect(YT.Player).toHaveBeenCalled();
  });

  it('keeps css fallback only when cssOnly option is enabled', async () => {
    Wallpaper.set('fireplace', ['vid1'], { cssOnly: true, muted: true });
    await flushAsync();
    expect(YT.Player).not.toHaveBeenCalled();
    expect(document.getElementById('css-bg').className).toContain('fireplace');
    expect(document.getElementById('bg-video').classList.contains('loaded')).toBe(false);
  });

  it('tries the next candidate when the first video errors', async () => {
    Wallpaper.set('clock');
    Wallpaper.set('fireplace', ['bad1', 'good2']);
    await flushAsync();
    YT.Player.mock.calls[0][1].events.onError();
    expect(YT.Player).toHaveBeenCalledTimes(2);
  });

  it('adds loaded class when playback starts', async () => {
    Wallpaper.set('clock');
    Wallpaper.set('scenic', ['space1']);
    await flushAsync();
    YT.Player.mock.calls[0][1].events.onStateChange({ data: YT.PlayerState.PLAYING });
    expect(document.getElementById('bg-video').classList.contains('loaded')).toBe(true);
  });
});

// ── init() ────────────────────────────────────────────────────────────────────
describe('Wallpaper.init()', () => {
  it('is callable without throwing', () => {
    expect(() => Wallpaper.init()).not.toThrow();
  });
});
