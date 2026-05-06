/**
 * wallpaper.js
 * Manages background mode selection (Fireplace / Rain / River / Scenic / Clock).
 *
 * Each mode:
 *  1. Sets a CSS gradient fallback immediately (zero-latency visual)
 *  2. Loads a muted, looping YouTube embed that fades in once ready
 *  3. Rain mode also starts the canvas animation on top
 *
 * ── Configuring ambient video IDs ────────────────────────────────────────────
 * Replace the YouTube video IDs below with your preferred ambient videos.
 * The ID is the part after "v=" in a YouTube URL, e.g.:
 *   https://www.youtube.com/watch?v=ZY3J3Y_OU0w  →  ZY3J3Y_OU0w
 */
const Wallpaper = (() => {
  'use strict';

  // ── Ambient video IDs — customise these ──────────────────────────────────
  const VIDEO_IDS = {
    fireplace: 'ZY3J3Y_OU0w',
    rain:      'q76bMs-NwRk',
    river:     'V1bFr2SWP1I',
    scenic:    'BHACKCNDMW8',
  };

  const bgVideo    = document.getElementById('bg-video');
  const cssBg      = document.getElementById('css-bg');
  const BG_PLAYER_HOST_ID = 'bg-video-player';

  let currentMode      = null;
  let _currentVideoId  = null;
  let _candidateIds    = [];
  let _muteBackground  = false;
  let _wantsAudibleBackground = false;
  let _clockStyle      = 'digital';
  let _cssOnlyBackground = false;
  let _ytPlayer        = null;
  let fadeTimer        = null;
  let _loadToken       = 0;
  let _ytApiReady      = !!(window.YT && window.YT.Player);
  let _startupRecoveryTimer = null;
  let _awaitingUserUnmute = false;
  let _userUnmuteHandler = null;

  const BG_STARTUP_RECOVERY_MS = 4500;

  function _ensureYtApi() {
    if (_ytApiReady || (window.YT && window.YT.Player)) {
      _ytApiReady = true;
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const queue = window.__xwallYtReadyCallbacks || (window.__xwallYtReadyCallbacks = []);
      queue.push(resolve);

      if (!window.__xwallYtApiBootstrap) {
        window.__xwallYtApiBootstrap = true;
        const previousReady = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = function () {
          _ytApiReady = true;
          const callbacks = window.__xwallYtReadyCallbacks || [];
          callbacks.splice(0).forEach((fn) => fn());
          if (typeof previousReady === 'function') previousReady();
        };
      }

      if (!document.getElementById('yt-api-script')) {
        const script = document.createElement('script');
        script.id = 'yt-api-script';
        script.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(script);
      }
    });
  }

  function _destroyPlayer() {
    _clearStartupRecoveryTimer();
    _clearUserUnmuteListeners();
    _awaitingUserUnmute = false;
    if (_ytPlayer) {
      try { _ytPlayer.destroy(); } catch (_) {}
      _ytPlayer = null;
    }
    bgVideo.innerHTML = `<div id="${BG_PLAYER_HOST_ID}"></div>`;
  }

  function _ensurePlayerHost() {
    let host = document.getElementById(BG_PLAYER_HOST_ID);
    if (!host) {
      bgVideo.innerHTML = `<div id="${BG_PLAYER_HOST_ID}"></div>`;
      host = document.getElementById(BG_PLAYER_HOST_ID);
    }
    return host;
  }

  function _clearStartupRecoveryTimer() {
    if (_startupRecoveryTimer) {
      clearTimeout(_startupRecoveryTimer);
      _startupRecoveryTimer = null;
    }
  }

  function _clearUserUnmuteListeners() {
    if (!_userUnmuteHandler) return;
    ['pointerdown', 'touchstart', 'keydown'].forEach((evt) => {
      document.removeEventListener(evt, _userUnmuteHandler);
    });
    _userUnmuteHandler = null;
  }

  function _attemptAudibleBackgroundFromGesture() {
    if (!_wantsAudibleBackground || !_ytPlayer) return;
    try {
      _ytPlayer.unMute();
      _ytPlayer.setVolume(100);
      _ytPlayer.playVideo();
    } catch (_) {}

    const muted = typeof _ytPlayer.isMuted === 'function' ? _ytPlayer.isMuted() : false;
    if (!muted) {
      _awaitingUserUnmute = false;
      _clearUserUnmuteListeners();
    }
  }

  function _registerUserUnmuteListeners() {
    if (_awaitingUserUnmute) return;
    _awaitingUserUnmute = true;
    _userUnmuteHandler = () => _attemptAudibleBackgroundFromGesture();
    ['pointerdown', 'touchstart', 'keydown'].forEach((evt) => {
      document.addEventListener(evt, _userUnmuteHandler, { passive: true });
    });
  }

  // ── Set a wallpaper mode ──────────────────────────────────────────────────
  function set(mode, videoIds, options = {}) {
    const requestedClockStyle = options.clockStyle || _clockStyle;
    const requestedCssOnly = Boolean(options.cssOnly);
    const candidates = mode === 'clock'
      ? []
      : (Array.isArray(videoIds) ? videoIds.filter(Boolean) : [videoIds || VIDEO_IDS[mode]].filter(Boolean));
    const vid = mode !== 'clock' ? (candidates[0] || VIDEO_IDS[mode]) : null;
    if (mode === currentMode && vid === _currentVideoId && (mode !== 'clock' || requestedClockStyle === _clockStyle) && requestedCssOnly === _cssOnlyBackground) return;
    currentMode     = mode;
    _currentVideoId = vid;
    _candidateIds   = candidates.length ? candidates : [VIDEO_IDS[mode]].filter(Boolean);
    _muteBackground = Boolean(options.muted);
    _wantsAudibleBackground = !_muteBackground;
    _clockStyle     = requestedClockStyle;
    _cssOnlyBackground = requestedCssOnly;

    // Persist preference
    try { localStorage.setItem('xwall_mode', mode); } catch (_) {}

    if (mode === 'clock') {
      _activateClock(_clockStyle);
    } else {
      _activateVideo(mode, vid);
    }
  }

  function _activateClock(style) {
    Rain.stop();
    Clock.start(style);
    bgVideo.classList.remove('loaded');
    clearTimeout(fadeTimer);
    _clearStartupRecoveryTimer();
    _destroyPlayer();
    cssBg.className = 'css-bg clock-bg';
  }

  async function _activateVideo(mode) {
    Clock.stop();

    // Start / stop rain canvas
    if (mode === 'rain') {
      Rain.start();
    } else {
      Rain.stop();
    }

    // CSS fallback visible immediately
    cssBg.className = `css-bg ${mode}`;

    bgVideo.classList.remove('loaded');
    _destroyPlayer();
    _clearStartupRecoveryTimer();
    clearTimeout(fadeTimer);

    if (_cssOnlyBackground) return;

    const token = ++_loadToken;
    const candidates = _candidateIds.length ? _candidateIds.slice() : [VIDEO_IDS[mode]];

    await _ensureYtApi();
    if (token !== _loadToken) return;

    _tryLoadCandidate(mode, candidates, token);
  }

  function _tryLoadCandidate(mode, candidates, token) {
    const nextId = candidates.shift();
    if (!nextId || token !== _loadToken) return;

    _currentVideoId = nextId;
    _ensurePlayerHost();

    // Guard against cases where the iframe initializes but never emits onReady.
    _clearStartupRecoveryTimer();
    _startupRecoveryTimer = setTimeout(() => {
      if (token !== _loadToken) return;
      if (bgVideo.classList.contains('loaded')) return;
      _destroyPlayer();
      _tryLoadCandidate(mode, candidates, token);
    }, BG_STARTUP_RECOVERY_MS);

    _ytPlayer = new YT.Player(BG_PLAYER_HOST_ID, {
      videoId: nextId,
      width: '100%',
      height: '100%',
      playerVars: {
        autoplay:        1,
        controls:        0,
        loop:            1,
        playlist:        nextId,
        rel:             0,
        iv_load_policy:  3,
        modestbranding:  1,
        disablekb:       1,
        playsinline:     1,
        origin:          window.location.origin,
      },
      events: {
        onReady: (event) => {
          if (token !== _loadToken) return;
          // Start muted for reliable autoplay, then unmute when allowed.
          event.target.mute();
          event.target.playVideo();

          if (_wantsAudibleBackground) {
            setTimeout(() => {
              if (token !== _loadToken) return;
              _attemptAudibleBackgroundFromGesture();
              const muted = typeof event.target.isMuted === 'function' ? event.target.isMuted() : false;
              if (muted) {
                _registerUserUnmuteListeners();
              }
            }, 180);
          }

          clearTimeout(fadeTimer);
          fadeTimer = setTimeout(() => bgVideo.classList.add('loaded'), 700);
        },
        onStateChange: (event) => {
          if (token !== _loadToken) return;
          if (event.data === YT.PlayerState.PLAYING || event.data === YT.PlayerState.BUFFERING) {
            bgVideo.classList.add('loaded');
            _clearStartupRecoveryTimer();
          }

          if (event.data === YT.PlayerState.PLAYING && _wantsAudibleBackground) {
            _attemptAudibleBackgroundFromGesture();
            const player = event.target || _ytPlayer;
            const muted = player && typeof player.isMuted === 'function' ? player.isMuted() : false;
            if (muted) {
              _registerUserUnmuteListeners();
            }
          }
        },
        onError: () => {
          bgVideo.classList.remove('loaded');
          _destroyPlayer();
          _tryLoadCandidate(mode, candidates, token);
        },
      },
    });
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  // No-op: mode selection is handled by app.js home view before entering main
  function init() {
    _ensurePlayerHost();
  }

  function stop() {
    _loadToken += 1;
    clearTimeout(fadeTimer);
    bgVideo.classList.remove('loaded');
    _destroyPlayer();
  }

  return { init, set, stop, current: () => currentMode };
})();
