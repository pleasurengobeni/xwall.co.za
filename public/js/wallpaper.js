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
  // Self-hosted ambient video (xwall originals), served from /media/ by nginx
  let _localVideo = null;
  const LOCAL_PREFIX = 'local:';
  const LOCAL_SRC_RE = /^\/media\/[A-Za-z0-9%._\-/]+$/;

  function _isLocal(id) {
    return typeof id === 'string' && id.startsWith(LOCAL_PREFIX);
  }

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
    if (_localVideo) {
      // Stop the download as well as playback
      try { _localVideo.pause(); } catch (_) {}
      _localVideo.removeAttribute('src');
      try { _localVideo.load(); } catch (_) {}
      _localVideo = null;
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

  function _attemptAudibleLocal(video) {
    video.muted  = false;
    video.volume = 1;
    const attempt = video.play();
    if (attempt && typeof attempt.then === 'function') {
      attempt
        .then(() => {
          _awaitingUserUnmute = false;
          _clearUserUnmuteListeners();
        })
        .catch(() => {
          // Sound not allowed yet: keep the picture playing muted and try
          // again on the next tap or key press.
          video.muted = true;
          const retry = video.play();
          if (retry && retry.catch) retry.catch(() => {});
          _registerUserUnmuteListeners();
        });
    }
  }

  function _attemptAudibleBackgroundFromGesture() {
    if (!_wantsAudibleBackground) return;
    if (_localVideo) {
      _attemptAudibleLocal(_localVideo);
      return;
    }
    if (!_ytPlayer) return;
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

    // The YouTube API is only loaded when a YouTube candidate is reached, so a
    // self-hosted video starts without waiting on it.
    _tryLoadCandidate(mode, candidates, token);
  }

  function _tryLoadCandidate(mode, candidates, token) {
    const nextId = candidates.shift();
    if (!nextId || token !== _loadToken) return;

    _currentVideoId = nextId;

    if (_isLocal(nextId)) {
      _playLocal(mode, nextId.slice(LOCAL_PREFIX.length), candidates, token);
      return;
    }

    if (!(window.YT && window.YT.Player)) {
      _ensureYtApi().then(() => {
        if (token === _loadToken) _createYtPlayer(mode, nextId, candidates, token);
      });
      return;
    }
    _createYtPlayer(mode, nextId, candidates, token);
  }

  // Plays one of your own videos with a plain <video> element. Starts muted
  // (always allowed) and unmutes once the browser permits sound.
  function _playLocal(mode, src, candidates, token) {
    if (!LOCAL_SRC_RE.test(src)) {
      _tryLoadCandidate(mode, candidates, token);
      return;
    }

    _clearStartupRecoveryTimer();
    bgVideo.innerHTML = '';

    const video = document.createElement('video');
    video.className    = 'bg-local-video';
    video.muted        = true;
    video.defaultMuted = true;
    video.loop         = true;
    video.autoplay     = true;
    video.playsInline  = true;
    video.preload      = 'auto';
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('aria-hidden', 'true');
    video.src = src;
    _localVideo = video;

    let triedSound = false;
    video.addEventListener('playing', () => {
      if (token !== _loadToken || _localVideo !== video) return;
      _clearStartupRecoveryTimer();
      bgVideo.classList.add('loaded');
      // Try for sound once automatically; further attempts wait for a gesture
      if (_wantsAudibleBackground && video.muted && !triedSound) {
        triedSound = true;
        _attemptAudibleLocal(video);
      }
    });

    video.addEventListener('error', () => {
      if (token !== _loadToken || _localVideo !== video) return;
      bgVideo.classList.remove('loaded');
      _destroyPlayer();
      _tryLoadCandidate(mode, candidates, token);
    });

    bgVideo.appendChild(video);
    const started = video.play();
    if (started && started.catch) started.catch(() => {});

    // Same guard as the YouTube path: move on if nothing starts in time
    _startupRecoveryTimer = setTimeout(() => {
      if (token !== _loadToken) return;
      if (bgVideo.classList.contains('loaded')) return;
      _destroyPlayer();
      _tryLoadCandidate(mode, candidates, token);
    }, BG_STARTUP_RECOVERY_MS);
  }

  function _createYtPlayer(mode, nextId, candidates, token) {
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
    // Forget the active selection. set() short-circuits when the same mode and
    // video are requested again, so leaving these set meant returning from the
    // home view to the same wallpaper never rebuilt the player: no video, no
    // ambient sound.
    currentMode     = null;
    _currentVideoId = null;
  }

  return { init, set, stop, current: () => currentMode };
})();
