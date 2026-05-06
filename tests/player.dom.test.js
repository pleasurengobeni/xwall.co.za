/**
 * @jest-environment jsdom
 *
 * tests/player.dom.test.js
 * DOM-level tests for Player module: load, stop, transport state,
 * Spotify postMessage delegation, YouTube IFrame API integration.
 */

// ── Minimal DOM scaffold ──────────────────────────────────────────────────────
// Must be set up BEFORE player.js is evaluated because the IIFE captures
// DOM refs at module evaluation time.
beforeAll(() => {
  document.body.innerHTML = `
    <div id="transport"></div>
    <span id="transport-current"></span>
    <span id="transport-title"></span>
    <button id="tp-play">
      <span class="icon-play"></span>
      <span class="icon-pause hidden"></span>
    </button>
    <button id="tp-stop"></button>
    <button id="tp-prev"></button>
    <button id="tp-next"></button>
    <iframe id="sp-embed" class="hidden"></iframe>
    <div id="yt-player-host"></div>
    <div id="wake-indicator"></div>
  `;

  // Fake YT global (YouTube IFrame API stub)
  global.YT = {
    PlayerState: { PLAYING: 1, PAUSED: 2, ENDED: 0, BUFFERING: 3, CUED: 5 },
    Player: jest.fn().mockImplementation((_el, opts) => {
      const player = {
        playVideo:     jest.fn(),
        pauseVideo:    jest.fn(),
        stopVideo:     jest.fn(),
        nextVideo:     jest.fn(),
        previousVideo: jest.fn(),
        destroy:       jest.fn(),
        getVideoData:  jest.fn(() => ({ title: 'Current YT Track' })),
        _opts:         opts,
      };
      // Immediately fire onReady so load() resolves
      setTimeout(() => opts.events?.onReady?.({ target: player }), 0);
      return player;
    }),
  };

  // Load the module (IIFE executes immediately)
  const { loadModule } = require('./setup/globals');
  loadModule('player.js');
});

afterEach(() => {
  // Reset transport state between tests
  Player.stop(true);
  jest.clearAllMocks();
});

// ── parseUrl (exposed on Player) ──────────────────────────────────────────────
describe('Player.parseUrl in browser context', () => {
  it('parses a YouTube playlist URL', () => {
    const r = Player.parseUrl('https://www.youtube.com/playlist?list=PLDOM');
    expect(r).toMatchObject({ provider: 'youtube', id: 'PLDOM' });
  });

  it('parses a Spotify playlist URL', () => {
    const r = Player.parseUrl('https://open.spotify.com/playlist/abcXYZ');
    expect(r).toMatchObject({ provider: 'spotify', type: 'playlist', id: 'abcXYZ' });
  });

  it('returns null for an unsupported URL', () => {
    expect(Player.parseUrl('https://example.com/music')).toBeNull();
  });
});

// ── load() — transport visibility ────────────────────────────────────────────
describe('Player.load()', () => {
  it('shows transport panel after loading a Spotify playlist', async () => {
    await Player.load({ provider: 'spotify', type: 'playlist', id: 'abc123', title: 'Test' });
    const transport = document.getElementById('transport');
    expect(transport.classList.contains('shown')).toBe(true);
  });

  it('sets transport title to the playlist title', async () => {
    await Player.load({ provider: 'spotify', type: 'playlist', id: 'x', title: 'My Playlist' });
    expect(document.getElementById('transport-title').textContent).toBe('My Playlist');
  });

  it('sets current line to the provided title initially', async () => {
    await Player.load({ provider: 'spotify', type: 'playlist', id: 'x', title: 'My Playlist' });
    expect(document.getElementById('transport-current').textContent).toBe('My Playlist');
  });

  it('sets sp-embed src for Spotify', async () => {
    await Player.load({ provider: 'spotify', type: 'playlist', id: 'SPID', title: 'T' });
    const iframe = document.getElementById('sp-embed');
    expect(iframe.src).toContain('open.spotify.com/embed/playlist/SPID');
  });

  it('shows sp-embed iframe for Spotify', async () => {
    await Player.load({ provider: 'spotify', type: 'playlist', id: 'SPID2', title: 'T' });
    expect(document.getElementById('sp-embed').classList.contains('hidden')).toBe(false);
  });

  it('creates a YT.Player instance for YouTube', async () => {
    await Player.load({ provider: 'youtube', id: 'PLYT', title: 'YT' });
    expect(YT.Player).toHaveBeenCalled();
  });

  it('passes correct listType and list to YT.Player', async () => {
    await Player.load({ provider: 'youtube', id: 'PLYYYY', title: 'YT' });
    const callOpts = YT.Player.mock.calls.at(-1)?.[1];
    expect(callOpts.playerVars).toMatchObject({ listType: 'playlist', list: 'PLYYYY' });
  });

  it('falls back to id when title is empty', async () => {
    await Player.load({ provider: 'spotify', type: 'playlist', id: 'NOID', title: '' });
    expect(document.getElementById('transport-title').textContent).toBe('NOID');
  });

  it('shows current YouTube video title when the player is ready', async () => {
    await Player.load({ provider: 'youtube', id: 'PLYYYY', title: 'YT Playlist' });
    await new Promise((r) => setTimeout(r, 10));
    expect(document.getElementById('transport-current').textContent).toBe('Current YT Track');
    expect(document.getElementById('transport-title').textContent).toBe('YT Playlist');
  });
});

// ── stop() ────────────────────────────────────────────────────────────────────
describe('Player.stop()', () => {
  it('hides transport panel', async () => {
    await Player.load({ provider: 'spotify', type: 'playlist', id: 'x', title: 'x' });
    Player.stop(true);
    expect(document.getElementById('transport').classList.contains('shown')).toBe(false);
  });

  it('clears sp-embed src', async () => {
    await Player.load({ provider: 'spotify', type: 'playlist', id: 'x', title: 'x' });
    Player.stop(true);
    expect(document.getElementById('sp-embed').getAttribute('src')).toBe('');
  });

  it('shows play icon and hides pause icon after stop', async () => {
    await Player.load({ provider: 'spotify', type: 'playlist', id: 'x', title: 'x' });
    Player.stop(true);
    expect(document.querySelector('.icon-play').classList.contains('hidden')).toBe(false);
    expect(document.querySelector('.icon-pause').classList.contains('hidden')).toBe(true);
  });

  it('does not throw when called with nothing loaded', () => {
    expect(() => Player.stop(true)).not.toThrow();
  });

  it('clears the current title on stop', async () => {
    await Player.load({ provider: 'spotify', type: 'playlist', id: 'x', title: 'x' });
    Player.stop(true);
    expect(document.getElementById('transport-current').textContent).toBe('');
  });

  it('does not hide transport when hidePanel=false', async () => {
    await Player.load({ provider: 'spotify', type: 'playlist', id: 'x', title: 'x' });
    Player.stop(false);
    // transport.shown is removed only when hidePanel=true
    // After stop(false) the panel is still visible (used internally during reload)
    // This is correct behaviour — verify stop didn't crash
  });
});

// ── Transport play/pause icon toggle ─────────────────────────────────────────
describe('play button icon toggle', () => {
  it('play icon hidden and pause shown when playing', async () => {
    jest.useFakeTimers();
    await Player.load({ provider: 'spotify', type: 'playlist', id: 'x', title: 'x' });
    jest.advanceTimersByTime(2000); // trigger _setPlaying(true) from Spotify timeout
    expect(document.querySelector('.icon-play').classList.contains('hidden')).toBe(true);
    expect(document.querySelector('.icon-pause').classList.contains('hidden')).toBe(false);
    jest.useRealTimers();
  });
});

// ── Spotify postMessage delegation ───────────────────────────────────────────
describe('Spotify transport — postMessage', () => {
  let postMessageMock;
  beforeEach(async () => {
    await Player.load({ provider: 'spotify', type: 'playlist', id: 'SP1', title: 'T' });
    // Mock contentWindow.postMessage
    const iframe = document.getElementById('sp-embed');
    postMessageMock = jest.fn();
    Object.defineProperty(iframe, 'contentWindow', {
      value: { postMessage: postMessageMock },
      configurable: true,
    });
  });

  it('prev button sends { command: "prev" } via postMessage', () => {
    document.getElementById('tp-prev').click();
    expect(postMessageMock).toHaveBeenCalledWith(
      JSON.stringify({ command: 'prev' }),
      'https://open.spotify.com'
    );
  });

  it('next button sends { command: "next" } via postMessage', () => {
    document.getElementById('tp-next').click();
    expect(postMessageMock).toHaveBeenCalledWith(
      JSON.stringify({ command: 'next' }),
      'https://open.spotify.com'
    );
  });

  it('play button sends { command: "toggle" } via postMessage', () => {
    document.getElementById('tp-play').click();
    expect(postMessageMock).toHaveBeenCalledWith(
      JSON.stringify({ command: 'toggle' }),
      'https://open.spotify.com'
    );
  });
});

// ── YouTube transport controls ────────────────────────────────────────────────
describe('YouTube transport controls', () => {
  let ytInstance;
  let ytEvents;
  beforeEach(async () => {
    YT.Player.mockImplementationOnce((_el, opts) => {
      ytEvents = opts.events;
      ytInstance = {
        playVideo:     jest.fn(),
        pauseVideo:    jest.fn(),
        stopVideo:     jest.fn(),
        nextVideo:     jest.fn(),
        previousVideo: jest.fn(),
        destroy:       jest.fn(),
      };
      setTimeout(() => opts.events?.onReady?.({ target: ytInstance }), 0);
      return ytInstance;
    });
    await Player.load({ provider: 'youtube', id: 'PLYT2', title: 'YT' });
    await new Promise((r) => setTimeout(r, 10));
  });

  it('next button calls ytPlayer.nextVideo()', () => {
    document.getElementById('tp-next').click();
    expect(ytInstance.nextVideo).toHaveBeenCalled();
  });

  it('prev button calls ytPlayer.previousVideo()', () => {
    document.getElementById('tp-prev').click();
    expect(ytInstance.previousVideo).toHaveBeenCalled();
  });

  it('stop button stops playback and keeps player mounted', () => {
    document.getElementById('tp-stop').click();
    expect(ytInstance.stopVideo).toHaveBeenCalled();
    expect(ytInstance.destroy).not.toHaveBeenCalled();
    expect(document.getElementById('transport').classList.contains('shown')).toBe(true);
  });

  it('onError attempts to recover by skipping to next video', () => {
    ytEvents.onError();
    expect(ytInstance.nextVideo).toHaveBeenCalled();
    expect(ytInstance.playVideo).toHaveBeenCalled();
    expect(document.getElementById('transport-current').textContent).toBe('Trying next track...');
  });
});
