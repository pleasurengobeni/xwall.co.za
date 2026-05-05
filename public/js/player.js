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
  const titleEl       = document.getElementById('transport-title');
  const btnPlay       = document.getElementById('tp-play');
  const btnStop       = document.getElementById('tp-stop');
  const btnPrev       = document.getElementById('tp-prev');
  const btnNext       = document.getElementById('tp-next');
  const iconPlay      = btnPlay.querySelector('.icon-play');
  const iconPause     = btnPlay.querySelector('.icon-pause');
  const spEmbed       = document.getElementById('sp-embed');
  const ytHost        = document.getElementById('yt-player-host');

  let _provider  = null; // 'youtube' | 'spotify'
  let _ytPlayer  = null;
  let _isPlaying = false;
  let _ytApiReady = ('YT' in window && window.YT.loaded);
  const _ytReadyCallbacks = [];

  // ── YouTube IFrame API loader ─────────────────────────────────────────────
  // Called once; resolved when window.onYouTubeIframeAPIReady fires
  function _ensureYtApi() {
    if (_ytApiReady) return Promise.resolve();
    return new Promise((resolve) => {
      _ytReadyCallbacks.push(resolve);
      if (!document.getElementById('yt-api-script')) {
        const s = document.createElement('script');
        s.id  = 'yt-api-script';
        s.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(s);
      }
    });
  }

  // YouTube calls this when the IFrame API is ready
  window.onYouTubeIframeAPIReady = function () {
    _ytApiReady = true;
    _ytReadyCallbacks.forEach((fn) => fn());
    _ytReadyCallbacks.length = 0;
  };

  // ── URL parser — returns { provider, id, title } or null ─────────────────
  function parseUrl(raw) {
    const url = raw.trim();
    try {
      const u = new URL(url);

      // YouTube — playlist URL
      if (u.hostname.includes('youtube.com') || u.hostname === 'youtu.be') {
        const list = u.searchParams.get('list');
        if (list) return { provider: 'youtube', id: list, title: 'YouTube Playlist' };
      }

      // Spotify — playlist / album / artist
      if (u.hostname === 'open.spotify.com') {
        const m = u.pathname.match(/\/(playlist|album|artist)\/([A-Za-z0-9]+)/);
        if (m) return { provider: 'spotify', type: m[1], id: m[2], title: `Spotify ${m[1]}` };
      }
    } catch (_) {}
    return null;
  }

  // ── Load a playlist ───────────────────────────────────────────────────────
  async function load(parsed) {
    stop(false); // stop previous without hiding transport
    _provider = parsed.provider;
    titleEl.textContent = parsed.title || parsed.id;

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

    await _ensureYtApi();

    if (_ytPlayer) { _ytPlayer.destroy(); _ytPlayer = null; }

    // The YT.Player element must exist in the DOM
    _ytPlayer = new YT.Player(ytHost, {
      width:  1,
      height: 1,
      playerVars: {
        listType:       'playlist',
        list:            playlistId,
        autoplay:        1,
        controls:        0,
        disablekb:       1,
        rel:             0,
        modestbranding:  1,
        playsinline:     1,
        origin:          window.location.origin,
      },
      events: {
        onReady:       (e) => { e.target.playVideo(); },
        onStateChange: (e) => {
          const s = e.data;
          _setPlaying(s === YT.PlayerState.PLAYING);
        },
        onError: () => { _setPlaying(false); },
      },
    });
  }

  // ── Spotify ───────────────────────────────────────────────────────────────
  function _loadSpotify(type, id) {
    if (_ytPlayer) { _ytPlayer.destroy(); _ytPlayer = null; }

    const src = `https://open.spotify.com/embed/${type}/${id}?utm_source=generator&theme=0`;
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
    if (_provider === 'youtube' && _ytPlayer) {
      _isPlaying ? _ytPlayer.pauseVideo() : _ytPlayer.playVideo();
    } else if (_provider === 'spotify') {
      _spMsg('toggle');
      _setPlaying(!_isPlaying); // optimistic toggle
    }
  });

  btnStop.addEventListener('click', () => stop(true));

  btnPrev.addEventListener('click', () => {
    if (_provider === 'youtube' && _ytPlayer) {
      _ytPlayer.previousVideo();
    } else if (_provider === 'spotify') {
      _spMsg('prev');
    }
  });

  btnNext.addEventListener('click', () => {
    if (_provider === 'youtube' && _ytPlayer) {
      _ytPlayer.nextVideo();
    } else if (_provider === 'spotify') {
      _spMsg('next');
    }
  });

  // ── Stop / tear down ──────────────────────────────────────────────────────
  function stop(hidePanel = true) {
    if (_ytPlayer) { _ytPlayer.stopVideo(); _ytPlayer.destroy(); _ytPlayer = null; }
    spEmbed.src = '';
    spEmbed.classList.add('hidden');
    _setPlaying(false);
    _provider = null;
    if (hidePanel) transport.classList.remove('shown');
  }

  return { parseUrl, load, stop };
})();

