/**
 * app.js — xwall.co.za entry point
 *
 * Two-view SPA router:
 *   #view-home  ← wallpaper selection + video library + playlist input + auth
 *   #view-main  ← ambient display (enters fullscreen)
 */
(async () => {
  'use strict';

  // ── Fallback ambient library (used if API suggestions are unavailable) ───
  const FALLBACK_VIDEO_LIBRARY = {
    fireplace: [
      { id: 'ZY3J3Y_OU0w', title: 'Classic Fireplace' },
      { id: 'L_LUpnjgPso', title: 'Cozy Hearth' },
      { id: 'IyH8bDHBFgA', title: 'Nordic Fireplace' },
      { id: 'kZbTznKlFqc', title: 'Winter Fire' },
      { id: 'ruDjKAdtHmk', title: 'Log Cabin Fire' },
    ],
    rain: [
      { id: 'q76bMs-NwRk', title: 'Rain on Window' },
      { id: 'CfHpO6DrfbA', title: 'Heavy Downpour' },
      { id: 'nDq6TstdEi8', title: 'Rainy Night' },
      { id: 'BOUTfqTsnlo', title: 'Rain & Thunder' },
      { id: 'iK0E4PVuJTE', title: 'Gentle Rain' },
    ],
    river: [
      { id: 'V1bFr2SWP1I', title: 'Mountain Stream' },
      { id: 'qgPbsGRCoQ8', title: 'Forest River' },
      { id: 'YsUUdAH3gy8', title: 'Babbling Brook' },
      { id: '2OEL4P1Rz04', title: 'Waterfall' },
      { id: 'SmVAWKfJ4Go', title: 'Tropical River' },
    ],
    scenic: [
      { id: 'BHACKCNDMW8', title: 'Scenic Drive' },
      { id: 'DWcJFNfaw9c', title: 'Mountains' },
      { id: '1ZYbU82uUws', title: 'Aerial Landscape' },
      { id: 'XMTCjzAePXs', title: 'Golden Valley' },
      { id: '3sL0omwElxw', title: 'Desert Sunset' },
    ],
  };

  // ── DOM refs ─────────────────────────────────────────────────────────────
  const viewHome         = document.getElementById('view-home');
  const viewMain         = document.getElementById('view-main');
  const cards            = document.querySelectorAll('.wpc');
  const urlInput         = document.getElementById('playlist-url');
  const urlClear         = document.getElementById('playlist-clear');
  const urlHint          = document.getElementById('playlist-hint');
  const launchBtn        = document.getElementById('launch-btn');
  const backBtn          = document.getElementById('back-btn');
  const videoLibraryEl   = document.getElementById('video-library');
  const savedPlaylistsEl = document.getElementById('saved-playlists');

  // ── State ─────────────────────────────────────────────────────────────────
  let selectedMode   = null;
  let parsedPlaylist = null;
  let uiActiveTimer  = null;
  let authUser       = null;

  const suggestedVideoLibrary = {};
  const suggestionRequested   = new Set();

  // Selected video ID per mode — default to first entry in each library
  const selectedVideoIds = {};
  Object.keys(FALLBACK_VIDEO_LIBRARY).forEach((m) => {
    selectedVideoIds[m] = FALLBACK_VIDEO_LIBRARY[m][0].id;
  });

  // ── Analytics helper ────────────────────────────────────────────────────
  function _track(event, data) {
    fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, data }),
    }).catch(() => {});
  }

  // ── Restore saved wallpaper choice ───────────────────────────────────────
  try {
    const saved = localStorage.getItem('xwall_mode');
    if (saved) {
      selectedMode = saved;
      cards.forEach((c) => c.classList.toggle('active', c.dataset.wallpaper === saved));
    }
  } catch (_) {}

  // Default to first card if nothing saved
  if (!selectedMode && cards.length) {
    selectedMode = cards[0].dataset.wallpaper;
    cards[0].classList.add('active');
  }

  // Show video library for the initial selection
  _showVideoLibrary(selectedMode);

  // ── Wallpaper card selection ──────────────────────────────────────────────
  cards.forEach((card) => {
    card.addEventListener('click', () => {
      cards.forEach((c) => c.classList.remove('active'));
      card.classList.add('active');
      selectedMode = card.dataset.wallpaper;
      _track('mode_select', { mode: selectedMode });
      _showVideoLibrary(selectedMode);
    });
  });

  // ── Video library panel ───────────────────────────────────────────────────
  function _escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async function _fetchSuggestedVideos(mode) {
    const res = await fetch(`/api/videos/suggestions?mode=${encodeURIComponent(mode)}&limit=8`);
    if (!res.ok) throw new Error('suggestions unavailable');
    const payload = await res.json();
    if (!Array.isArray(payload.videos)) throw new Error('invalid suggestion payload');
    return payload.videos;
  }

  function _renderVideoLibrary(mode, videos) {
    const activeId = selectedVideoIds[mode];
    videoLibraryEl.innerHTML =
      `<div class="vlib-scroll">${
        videos.map((v) => {
          const title = _escapeHtml(v.title);
          const meta = _escapeHtml(v.durationLabel || '30+ min');
          const thumb = _escapeHtml(v.thumbnail || `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`);
          return (
            `<button class="vlib-card${v.id === activeId ? ' active' : ''}" ` +
            `data-id="${v.id}" data-mode="${mode}" type="button" aria-label="${title}">` +
            `<img class="vlib-thumb" src="${thumb}" alt="${title}" loading="lazy" />` +
            `<span class="vlib-title">${title}</span>` +
            `<span class="vlib-meta">${meta}</span>` +
            `</button>`
          );
        }).join('')
      }</div>`;
    videoLibraryEl.classList.remove('hidden');

    videoLibraryEl.querySelectorAll('.vlib-card').forEach((btn) => {
      btn.addEventListener('click', () => {
        const m  = btn.dataset.mode;
        const id = btn.dataset.id;
        selectedVideoIds[m] = id;
        _track('video_select', { mode: m, videoId: id });
        videoLibraryEl.querySelectorAll('.vlib-card').forEach((b) =>
          b.classList.toggle('active', b.dataset.id === id)
        );
      });
    });
  }

  function _showVideoLibrary(mode) {
    const fallbackVideos = FALLBACK_VIDEO_LIBRARY[mode];
    if (!fallbackVideos) {
      videoLibraryEl.classList.add('hidden');
      return;
    }

    const suggestedVideos = suggestedVideoLibrary[mode];
    const videosToRender = suggestedVideos && suggestedVideos.length
      ? suggestedVideos
      : fallbackVideos;

    if (!selectedVideoIds[mode] || !videosToRender.some((v) => v.id === selectedVideoIds[mode])) {
      selectedVideoIds[mode] = videosToRender[0].id;
    }

    _renderVideoLibrary(mode, videosToRender);

    if (suggestionRequested.has(mode)) return;

    suggestionRequested.add(mode);
    videoLibraryEl.insertAdjacentHTML(
      'beforeend',
      '<p class="vlib-loading">Finding 30+ minute YouTube videos...</p>'
    );

    _fetchSuggestedVideos(mode)
      .then((videos) => {
        if (!Array.isArray(videos) || !videos.length) return;
        suggestedVideoLibrary[mode] = videos;
        if (!videos.some((v) => v.id === selectedVideoIds[mode])) {
          selectedVideoIds[mode] = videos[0].id;
        }
        if (selectedMode === mode) {
          _renderVideoLibrary(mode, videos);
        }
      })
      .catch(() => {
        // Silent fallback to bundled list when suggestions cannot be fetched.
      });
  }

  // ── Playlist URL input ───────────────────────────────────────────────────
  urlInput.addEventListener('input', () => {
    const raw = urlInput.value.trim();
    if (!raw) {
      parsedPlaylist = null;
      urlClear.classList.add('hidden');
      urlHint.textContent = '';
      urlHint.className   = 'playlist-hint';
      return;
    }
    urlClear.classList.remove('hidden');
    parsedPlaylist = Player.parseUrl(raw);
    if (parsedPlaylist) {
      urlHint.textContent = `\u2713 ${parsedPlaylist.provider === 'youtube' ? 'YouTube' : 'Spotify'} playlist detected`;
      urlHint.className   = 'playlist-hint ok';
    } else {
      urlHint.textContent = 'Paste a YouTube or Spotify playlist URL';
      urlHint.className   = 'playlist-hint err';
    }
  });

  urlClear.addEventListener('click', () => {
    urlInput.value      = '';
    parsedPlaylist      = null;
    urlHint.textContent = '';
    urlHint.className   = 'playlist-hint';
    urlClear.classList.add('hidden');
    urlInput.focus();
  });

  // ── Saved playlists (populated when signed in with Google) ────────────────
  async function _loadSavedPlaylists() {
    if (!savedPlaylistsEl) return;
    try {
      const res = await fetch('/api/playlists');
      const payload = await res.json();
      const list = Array.isArray(payload?.playlists) ? payload.playlists : [];
      if (!list.length) {
        savedPlaylistsEl.innerHTML =
          '<p class="saved-playlists-label">Your playlists</p>' +
          '<p class="saved-playlists-empty">No playlists found for this account yet.</p>';
        savedPlaylistsEl.classList.remove('hidden');
        return;
      }

      const providerLabel = authUser?.provider === 'spotify' ? 'Spotify playlists' : 'YouTube playlists';
      savedPlaylistsEl.innerHTML =
        `<p class="saved-playlists-label">${providerLabel}</p>` +
        `<div class="saved-playlists-list">${
          list.map((pl) =>
            `<button class="spl-item" data-id="${pl.id}" data-provider="${pl.provider}" type="button">` +
            (pl.image
              ? `<img class="spl-thumb" src="${pl.image}" alt="" loading="lazy" />`
              : `<span class="spl-thumb-empty"></span>`) +
            `<span class="spl-copy">` +
            `<span class="spl-name">${pl.name}</span>` +
            `<span class="spl-subtitle">Ready on this device</span>` +
            `</span>` +
            `<span class="spl-badge ${pl.provider === 'spotify' ? 'spl-badge-sp' : 'spl-badge-yt'}">${pl.provider === 'spotify' ? 'Spotify' : 'YouTube'}</span>` +
            `</button>`
          ).join('')
        }</div>`;
      savedPlaylistsEl.classList.remove('hidden');
      savedPlaylistsEl.querySelectorAll('.spl-item').forEach((btn) => {
        btn.addEventListener('click', () => {
          savedPlaylistsEl.querySelectorAll('.spl-item').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          const provider = btn.dataset.provider;
          const name = btn.querySelector('.spl-name').textContent;
          parsedPlaylist = {
            provider,
            type:     provider === 'spotify' ? 'playlist' : undefined,
            id:       btn.dataset.id,
            title:    name,
          };
          urlInput.value = '';
          urlClear.classList.add('hidden');
          urlHint.textContent = `\u2713 ${name} selected from your ${provider === 'spotify' ? 'Spotify' : 'YouTube'} account`;
          urlHint.className   = `playlist-hint ${provider === 'spotify' ? 'hint-sp' : 'hint-yt'}`;
        });
      });
    } catch (_) {}
  }

  function _hideSavedPlaylists() {
    if (savedPlaylistsEl) {
      savedPlaylistsEl.classList.add('hidden');
      savedPlaylistsEl.innerHTML = '';
    }
  }

  // ── Launch → go to main view ──────────────────────────────────────────────
  launchBtn.addEventListener('click', goMain);
  urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') goMain(); });

  function goMain() {
    viewHome.classList.add('hidden');
    viewMain.classList.remove('hidden');

    // Request fullscreen (best-effort — silently fails on iOS)
    const docEl = document.documentElement;
    if (docEl.requestFullscreen)            docEl.requestFullscreen().catch(() => {});
    else if (docEl.webkitRequestFullscreen) docEl.webkitRequestFullscreen();

    _track('launch', { mode: selectedMode, video: selectedVideoIds[selectedMode] || null });
    Wallpaper.set(selectedMode, selectedVideoIds[selectedMode]);
    WakeLock.request();
    WakeLock.startNetwork();

    if (parsedPlaylist) {
      Player.load(parsedPlaylist);
    }

    _bindUiActivity();
  }

  // ── Back → return to home view ────────────────────────────────────────────
  backBtn.addEventListener('click', goHome);

  function goHome() {
    viewMain.classList.add('hidden');
    viewMain.classList.remove('ui-active');
    viewHome.classList.remove('hidden');

    Player.stop();
    Clock.stop();
    Rain.stop();
    WakeLock.release();

    if (document.fullscreenElement)             document.exitFullscreen().catch(() => {});
    else if (document.webkitFullscreenElement)  document.webkitExitFullscreen();

    clearTimeout(uiActiveTimer);
    ['mousemove', 'touchstart'].forEach((evt) =>
      document.removeEventListener(evt, _onActivity)
    );
  }

  // ── UI activity detection (reveals back button) ───────────────────────────
  function _onActivity() {
    viewMain.classList.add('ui-active');
    clearTimeout(uiActiveTimer);
    uiActiveTimer = setTimeout(() => viewMain.classList.remove('ui-active'), 4000);
  }

  function _bindUiActivity() {
    ['mousemove', 'touchstart'].forEach((evt) =>
      document.addEventListener(evt, _onActivity, { passive: true })
    );
  }

  // ── Auth check (shows/hides home sign-in row + saves playlists) ───────────
  Auth.onAuthChange(async (user) => {
    authUser = user;
    if (user) {
      await _loadSavedPlaylists();
    } else {
      _hideSavedPlaylists();
    }
  });

  await Auth.check();
})();

