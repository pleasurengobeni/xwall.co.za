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
    // Count only what the second, identical call does
    const before = YT.Player.mock.calls.length;
    Wallpaper.set('river'); // no-op
    expect(YT.Player.mock.calls.length).toBe(before);
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

// ── Returning to the wallpaper after visiting the home view ─────────────────
describe('Wallpaper.stop() then set() again', () => {
  it('rebuilds the player when the same mode is re-entered', async () => {
    Wallpaper.set('fireplace', ['vid1']);
    await flushAsync();
    expect(YT.Player).toHaveBeenCalledTimes(1);

    // Leaving for the home view tears the player down...
    Wallpaper.stop();
    // ...and coming back to the very same wallpaper must load it again,
    // rather than being swallowed by the "already showing this" guard.
    Wallpaper.set('fireplace', ['vid1']);
    await flushAsync();
    expect(YT.Player).toHaveBeenCalledTimes(2);
    expect(Wallpaper.current()).toBe('fireplace');
  });
});

// ── Self-hosted videos (xwall originals served from /media/) ────────────────
describe('Wallpaper self-hosted video', () => {
  beforeAll(() => {
    // jsdom has no media playback; stub what the player calls
    window.HTMLMediaElement.prototype.play  = jest.fn(() => Promise.resolve());
    window.HTMLMediaElement.prototype.pause = jest.fn();
    window.HTMLMediaElement.prototype.load  = jest.fn();
  });

  const localVideo = () => document.querySelector('#bg-video video');

  it('plays a /media/ file in a <video> element without touching YouTube', () => {
    Wallpaper.set('clock');
    Wallpaper.set('fireplace', ['local:/media/fireplace/cozy-hearth.mp4']);

    const video = localVideo();
    expect(video).not.toBeNull();
    expect(video.getAttribute('src')).toBe('/media/fireplace/cozy-hearth.mp4');
    expect(video.muted).toBe(true);   // muted start is always allowed to autoplay
    expect(video.loop).toBe(true);
    expect(YT.Player).not.toHaveBeenCalled();
  });

  it('fades the video in once it is actually playing', () => {
    Wallpaper.set('clock');
    Wallpaper.set('rain', ['local:/media/rain/window.mp4']);
    const bgVideo = document.getElementById('bg-video');
    expect(bgVideo.classList.contains('loaded')).toBe(false);

    localVideo().dispatchEvent(new Event('playing'));
    expect(bgVideo.classList.contains('loaded')).toBe(true);
  });

  it('falls back to the next candidate (YouTube) if the file fails to load', () => {
    Wallpaper.set('clock');
    Wallpaper.set('river', ['local:/media/river/missing.mp4', 'ytFallback1']);

    localVideo().dispatchEvent(new Event('error'));
    expect(localVideo()).toBeNull();
    expect(YT.Player).toHaveBeenCalledTimes(1);
    expect(YT.Player.mock.calls[0][1].videoId).toBe('ytFallback1');
  });

  it('refuses sources outside /media/ and moves on', () => {
    Wallpaper.set('clock');
    Wallpaper.set('scenic', ['local:https://evil.example/x.mp4', 'local:javascript:alert(1)', 'ytSafe']);

    expect(localVideo()).toBeNull();
    expect(YT.Player).toHaveBeenCalledTimes(1);
    expect(YT.Player.mock.calls[0][1].videoId).toBe('ytSafe');
  });

  it('stops and removes the video when leaving the wallpaper', () => {
    Wallpaper.set('clock');
    Wallpaper.set('fireplace', ['local:/media/fireplace/cozy-hearth.mp4']);
    expect(localVideo()).not.toBeNull();

    Wallpaper.stop();
    expect(localVideo()).toBeNull();
    expect(window.HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  });
});

// ── init() ────────────────────────────────────────────────────────────────────
describe('Wallpaper.init()', () => {
  it('is callable without throwing', () => {
    expect(() => Wallpaper.init()).not.toThrow();
  });
});
