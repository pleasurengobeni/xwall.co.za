/**
 * player.js
 * Paste-URL playlist player with transport controls (prev/play/pause/stop/next).
 *
 * YouTube → YouTube IFrame API for full programmatic playback control.
 * Spotify → compact embed iframe (with postMessage best-effort transport).
 */
const Player = (() => {
  'use strict';

  const transport     = document.getElementById('transport');
  const currentEl     = document.getElementById('transport-current');
  const titleEl       = document.getElementById('transport-title');
  const btnPlay       = document.getElementById('tp-play');
  const btnStop       = document.getElementById('tp-stop');
  const btnPrev       = document.getElementById('tp-prev');
  const btnNext       = document.getElementById('tp-next');
  const iconPlay      = btnPlay.querySelector('.icon-play');
  const iconPause     = btnPlay.querySelector('.icon-pause');
  const progressFill  = document.getElementById('tp-progress-fill');
  const progressTime  = document.getElementById('tp-progress-time');
  const progressWrap  = transport ? transport.querySelector('.transport-progress') : null;
  const spEmbed       = document.getElementById('sp-embed');
  const ytHost        = document.getElementById('yt-player-host');

  let _provider  = null; // 'youtube' | 'spotify'
  let _ytPlayer  = null;
  let _isPlaying = false;
  let _ytApiReady = !!(window.YT && window.YT.Player);
  let _contextTitle = '';
  let _ytRecoverTimer = null;
  let _progressUpdateTimer = null;
  let _ytSkipAttempts = 0;
  // Set when the user presses play before the iframe has finished loading;
  // honoured in onReady so the click is never silently dropped.
  let _playRequested = false;
  const YT_MAX_SKIP_ATTEMPTS = 6;

  // What the IFrame API's error codes actually mean for a listener. Without
  // these the transport just went quiet and gave no clue why.
  const YT_ERRORS = {
    2:   'That playlist link is not valid',
    5:   'This track will not play in this browser',
    100: 'Track unavailable - it was removed, or the playlist is private',
    101: 'The owner does not allow this track to play outside YouTube',
    150: 'The owner does not allow this track to play outside YouTube',
  };
  let _lastErrorMessage = '';

  function _failureMessage() {
    return _lastErrorMessage || _contextTitle || 'Playback unavailable';
  }

  // Report playback failures so they show up in the admin dashboard.
  function _trackPlayerError(code) {
    try {
      fetch('/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'player_error', data: { provider: 'youtube', code: Number(code) || 0 } }),
      }).catch(() => {});
    } catch (_) {}
  }

  // ── YouTube IFrame API loader ─────────────────────────────────────────────
  // Called once; resolved when window.onYouTubeIframeAPIReady fires
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
        const s = document.createElement('script');
        s.id  = 'yt-api-script';
        s.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(s);
      }
    });
  }

  // YT.Player only gains its control methods once its iframe is ready, so any
  // call made before then (e.g. the user leaves immediately) must not throw.
  function _ytCall(method, ...args) {
    if (!_ytPlayer || typeof _ytPlayer[method] !== 'function') return undefined;
    try { return _ytPlayer[method](...args); } catch (_) { return undefined; }
  }

  function _setContextTitle(value) {
    _contextTitle = value || '';
    titleEl.textContent = _contextTitle;
  }

  function _setCurrentTitle(value) {
    currentEl.textContent = value || '';
  }

  function _refreshYoutubeCurrentTitle() {
    if (!_ytPlayer || typeof _ytPlayer.getVideoData !== 'function') return;
    const title = _ytPlayer.getVideoData()?.title;
    if (title) _setCurrentTitle(title);
  }

  function _clearYtRecoveryTimer() {
    if (_ytRecoverTimer) {
      clearTimeout(_ytRecoverTimer);
      _ytRecoverTimer = null;
    }
  }

  // Some videos never fire onStateChange/onError after playVideo() — e.g. a
  // silent embed restriction that the IFrame API swallows. Without this watchdog
  // the transport is left showing "playing" while no audio ever starts. Re-arm
  // whenever a play attempt is made; cleared once PLAYING is confirmed or the
  // user explicitly pauses/stops.
  function _startYtRecoveryWatchdog() {
    _clearYtRecoveryTimer();
    _ytRecoverTimer = setTimeout(() => {
      _ytRecoverTimer = null;
      if (_provider !== 'youtube' || !_ytPlayer || _isPlaying) return;
      if (!_recoverFromYoutubeError()) {
        _setPlaying(false);
        _setCurrentTitle(_failureMessage());
      }
    }, 6000);
  }

  function _recoverFromYoutubeError() {
    if (_provider !== 'youtube' || !_ytPlayer) return false;
    if (_ytSkipAttempts >= YT_MAX_SKIP_ATTEMPTS) return false;
    _ytSkipAttempts += 1;
    _setCurrentTitle('Trying next track...');
    try { _ytPlayer.nextVideo(); } catch (_) {}
    try { _ytPlayer.playVideo(); } catch (_) {}
    _startYtRecoveryWatchdog();
    return true;
  }

  function _formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  function _updateProgress() {
    if (_provider !== 'youtube' || !_ytPlayer || !_isPlaying) return;
    try {
      const current = _ytPlayer.getCurrentTime?.() || 0;
      const duration = _ytPlayer.getDuration?.() || 0;
      if (duration > 0) {
        const percent = (current / duration) * 100;
        if (progressFill) progressFill.style.width = `${percent}%`;
        if (progressTime) progressTime.textContent = `${_formatTime(current)} / ${_formatTime(duration)}`;
      }
    } catch (_) {}
  }

  function _startProgressUpdates() {
    _stopProgressUpdates();
    if (_provider === 'youtube' && _isPlaying) {
      _progressUpdateTimer = setInterval(_updateProgress, 500);
    }
  }

  function _stopProgressUpdates() {
    if (_progressUpdateTimer) {
      clearInterval(_progressUpdateTimer);
      _progressUpdateTimer = null;
    }
  }

  // ── URL parser — returns { provider, id, title } or null ─────────────────
  function parseUrl(raw) {
    const url = raw.trim();
    try {
      const u = new URL(url);

      if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
      const host = u.hostname.toLowerCase();

      // YouTube — playlist URL (youtube.com, any subdomain, or youtu.be)
      if (host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be') {
        const list = u.searchParams.get('list');
        if (list && /^[A-Za-z0-9_-]{2,64}$/.test(list)) {
          return { provider: 'youtube', id: list, title: 'YouTube Playlist' };
        }
      }

      // Spotify — playlist / album / artist
      if (host === 'open.spotify.com') {
        const m = u.pathname.match(/\/(playlist|album|artist)\/([A-Za-z0-9]+)/);
        if (m) return { provider: 'spotify', type: m[1], id: m[2], title: `Spotify ${m[1]}` };
      }
    } catch (_) {}
    return null;
  }

  // ── Load a playlist ───────────────────────────────────────────────────────
  async function load(parsed) {
    stop(false); // stop previous without hiding transport
    _stopProgressUpdates();
    _provider = parsed.provider;
    _setContextTitle(parsed.title || parsed.id);
    _setCurrentTitle(parsed.title || parsed.id);
    if (progressFill) progressFill.style.width = '0%';
    if (progressTime) progressTime.textContent = '0:00 / 0:00';

    // Spotify's embed has its own progress bar; ours only tracks YouTube.
    if (progressWrap) progressWrap.classList.toggle('hidden', parsed.provider !== 'youtube');

    if (parsed.provider === 'youtube') {
      await _loadYoutube(parsed.id);
    } else if (parsed.provider === 'spotify') {
      _loadSpotify(parsed.type || 'playlist', parsed.id);
    }

    transport.classList.add('shown');
  }

  // ── YouTube ───────────────────────────────────────────────────────────────
  async function _loadYoutube(playlistId) {
    spEmbed.src = '';
    spEmbed.classList.add('hidden');
    _ytSkipAttempts = 0;
    _clearYtRecoveryTimer();

    try {
      await _ensureYtApi();
    } catch (e) {
      console.error('YouTube API failed to load:', e.message);
      _setCurrentTitle('YouTube not available on this browser');
      _setPlaying(false);
      return;
    }

    if (!window.YT || !window.YT.Player) {
      console.warn('YouTube API not available; browser may not support it');
      _setCurrentTitle('YouTube not supported; try Chrome');
      _setPlaying(false);
      return;
    }

    if (_ytPlayer) { _ytCall('destroy'); _ytPlayer = null; }

    // The YT.Player element must exist in the DOM
    try {
      _ytPlayer = new YT.Player(ytHost, {
      width:  1,
      height: 1,
      playerVars: {
        listType:       'playlist',
        list:            playlistId,
        autoplay:        0,
        controls:        0,
        disablekb:       1,
        rel:             0,
        modestbranding:  1,
        playsinline:     1,
        origin:          window.location.origin,
      },
      events: {
        onReady:       (e) => {
          _refreshYoutubeCurrentTitle();
          if (_playRequested) {
            // The user already pressed play while this was loading
            _playRequested = false;
            try {
              e.target.unMute();
              e.target.setVolume(100);
              e.target.playVideo();
            } catch (_) {}
            _setPlaying(true);
            _startYtRecoveryWatchdog();
            return;
          }
          try {
            e.target.mute();
            e.target.setVolume(0); // Ensure muted on init
          } catch (_) {}
          _setPlaying(false);
          if (_contextTitle) {
            _setCurrentTitle(`${_contextTitle} - Press Play to start`);
          }
        },
        onStateChange: (e) => {
          const s = e.data;
          if (
            s === YT.PlayerState.PLAYING ||
            s === YT.PlayerState.BUFFERING ||
            s === YT.PlayerState.CUED
          ) {
            _refreshYoutubeCurrentTitle();
          }
          if (s === YT.PlayerState.PLAYING) {
            _ytSkipAttempts = 0;
            _clearYtRecoveryTimer();
            try {
              _ytPlayer.unMute();
              _ytPlayer.setVolume(100);
            } catch (_) {}
          }
          // Auto-play next track when current one ends
          if (s === YT.PlayerState.ENDED) {
            try {
              _ytPlayer.nextVideo();
              _ytPlayer.playVideo();
            } catch (_) {}
          }
          _setPlaying(s === YT.PlayerState.PLAYING);
        },
        onError: (e) => {
          const code = e?.data;
          console.error('YouTube player error:', code);
          _lastErrorMessage = YT_ERRORS[code] || `Playback error (code ${code})`;
          _trackPlayerError(code);
          if (!_isPlaying) {
            _setPlaying(false);
            // A playlist that cannot be embedded at all fails before playback
            // ever starts, so say why instead of inviting another press.
            _setCurrentTitle(YT_ERRORS[code] || 'Press Play to start music');
            return;
          }
          if (_recoverFromYoutubeError()) return;
          _setPlaying(false);
          _setCurrentTitle(_failureMessage());
        },
      },
      });
    } catch (e) {
      console.error('Failed to create YouTube player:', e.message);
      _setCurrentTitle('Could not initialize YouTube player');
      _setPlaying(false);
    }
  }

  // ── Spotify ───────────────────────────────────────────────────────────────
  function _loadSpotify(type, id) {
    if (_ytPlayer) { _ytCall('destroy'); _ytPlayer = null; }

    const safeType = ['playlist', 'album', 'artist'].includes(type) ? type : 'playlist';
    const src = `https://open.spotify.com/embed/${safeType}/${encodeURIComponent(id)}?utm_source=generator&theme=0`;
    spEmbed.src = src;
    spEmbed.classList.remove('hidden');

    // Assume playing once loaded — Spotify embed autoplays
    setTimeout(() => _setPlaying(true), 1500);
  }

  // ── Transport state ───────────────────────────────────────────────────────
  function _setPlaying(state) {
    _isPlaying = state;
    iconPlay.classList.toggle('hidden',  state);
    iconPause.classList.toggle('hidden', !state);
    if (state) {
      _startProgressUpdates();
    } else {
      _stopProgressUpdates();
    }
  }

  // ── Transport controls ────────────────────────────────────────────────────
  // ── Spotify postMessage helper ────────────────────────────────────────────
  function _spMsg(command) {
    if (spEmbed.contentWindow) {
      spEmbed.contentWindow.postMessage(
        JSON.stringify({ command }),
        'https://open.spotify.com'
      );
    }
  }

  btnPlay.addEventListener('click', () => {
    // Still loading: remember the intent instead of dropping the click
    if (_provider === 'youtube' && (!_ytPlayer || typeof _ytPlayer.playVideo !== 'function')) {
      _playRequested = true;
      _setPlaying(true);
      _setCurrentTitle(_contextTitle ? `${_contextTitle} - starting…` : 'Starting…');
      return;
    }

    if (_provider === 'youtube' && _ytPlayer) {
      if (_isPlaying) {
        _clearYtRecoveryTimer();
        _ytCall('pauseVideo');
        _setPlaying(false);
      } else {
        try {
          // On Android, unmute must happen with user gesture (which button click provides)
          _ytPlayer.unMute();
          _ytPlayer.setVolume(100);
        } catch (_) {}
        try {
          _ytPlayer.playVideo();
        } catch (_) {}
        _setPlaying(true);
        _startYtRecoveryWatchdog();
      }
    } else if (_provider === 'spotify') {
      _spMsg('toggle');
      _setPlaying(!_isPlaying); // optimistic toggle
    }
  });

  function _softStop() {
    if (_provider === 'youtube' && _ytPlayer) {
      _clearYtRecoveryTimer();
      _ytCall('stopVideo');
      _setPlaying(false);
      _setCurrentTitle('Stopped');
      return;
    }

    if (_provider === 'spotify') {
      // Spotify iframe has no true stop command; toggle pause when currently playing.
      if (_isPlaying) _spMsg('toggle');
      _setPlaying(false);
      _setCurrentTitle('Stopped');
    }
  }

  btnStop.addEventListener('click', _softStop);

  btnPrev.addEventListener('click', () => {
    if (_provider === 'youtube' && _ytPlayer) {
      _ytCall('previousVideo');
    } else if (_provider === 'spotify') {
      _spMsg('prev');
    }
  });

  btnNext.addEventListener('click', () => {
    if (_provider === 'youtube' && _ytPlayer) {
      _ytCall('nextVideo');
    } else if (_provider === 'spotify') {
      _spMsg('next');
    }
  });

  // Progress bar seeking
  if (progressFill?.parentElement) {
    progressFill.parentElement.addEventListener('click', (e) => {
      if (_provider !== 'youtube' || !_ytPlayer) return;
      try {
        const rect = progressFill.parentElement.getBoundingClientRect();
        const percent = (e.clientX - rect.left) / rect.width;
        const duration = _ytPlayer.getDuration?.() || 0;
        if (duration > 0) {
          const seekTime = percent * duration;
          _ytPlayer.seekTo?.(seekTime, true);
        }
      } catch (_) {}
    });
  }

  // ── Stop / tear down ──────────────────────────────────────────────────────
  function stop(hidePanel = true) {
    _clearYtRecoveryTimer();
    _ytSkipAttempts   = 0;
    _playRequested    = false;
    _lastErrorMessage = '';
    if (_ytPlayer) { _ytCall('stopVideo'); _ytCall('destroy'); _ytPlayer = null; }
    spEmbed.src = '';
    spEmbed.classList.add('hidden');
    _setPlaying(false);
    _setCurrentTitle('');
    _setContextTitle('');
    _provider = null;
    if (hidePanel) transport.classList.remove('shown');
  }

  return { parseUrl, load, stop };
})();

