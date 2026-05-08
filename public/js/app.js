/**
 * app.js — xwall.co.za entry point
 *
 * Two-view SPA router:
 *   #view-home  ← wallpaper selection + video library + playlist input + auth
 *   #view-main  ← ambient display (enters fullscreen)
 */
(async () => {
  'use strict';

  const MODE_ALIASES = {
    space: 'scenic',
  };

  function normalizeMode(mode) {
    return MODE_ALIASES[mode] || mode;
  }

  function isMobileMediaEnvironment() {
    const ua = navigator.userAgent || '';
    const mobileUa = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
    const coarsePointer = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    return mobileUa || coarsePointer;
  }

  // ── Fallback ambient library (used if API suggestions are unavailable) ───
  const FALLBACK_VIDEO_LIBRARY = {
    fireplace: [
      { id: 'L_LUpnjgPso', title: 'Cozy Hearth' },
      { id: 'q76bMs-NwRk', title: 'Warm Ambience' },
      { id: 'V1bFr2SWP1I', title: 'Cabin Stream + Fire' },
      { id: 'BHACKCNDMW8', title: 'Night Fireplace Atmosphere' },
    ],
    rain: [
      { id: 'q76bMs-NwRk', title: 'Rain on Window' },
      { id: 'nDq6TstdEi8', title: 'Rainy Night' },
      { id: 'V1bFr2SWP1I', title: 'Rain by the River' },
      { id: '2OEL4P1Rz04', title: 'Waterfall Mist' },
    ],
    river: [
      { id: 'V1bFr2SWP1I', title: 'Mountain Stream' },
      { id: '2OEL4P1Rz04', title: 'Waterfall' },
      { id: 'nDq6TstdEi8', title: 'River at Night' },
      { id: 'q76bMs-NwRk', title: 'Calm Brook' },
    ],
    scenic: [
      { id: 'BHACKCNDMW8', title: 'Deep Space Drift' },
      { id: 'DWcJFNfaw9c', title: 'Stars and Nebulae' },
      { id: '3sL0omwElxw', title: 'Cosmic Silence' },
      { id: 'V1bFr2SWP1I', title: 'Orbit View' },
    ],
  };

  const CLOCK_STYLE_LIBRARY = [
    { id: 'digital', title: 'Digital Glow', meta: 'Classic 12-hour' },
    { id: 'analog', title: 'Analog Watch', meta: 'Sweep hand dial' },
    { id: 'minimal', title: 'Minimal 24h', meta: 'Clean + compact' },
    { id: 'panel', title: 'Split Panel', meta: 'Large hour + minutes' },
  ];

  // ── DOM refs ─────────────────────────────────────────────────────────────
  const viewHome         = document.getElementById('view-home');
  const viewMain         = document.getElementById('view-main');
  const cards            = document.querySelectorAll('.wpc');
  const urlInput           = document.getElementById('playlist-url');
  const urlClear           = document.getElementById('playlist-clear');
  const urlHint            = document.getElementById('playlist-hint');
  const playlistDropdownEl = document.getElementById('playlist-dropdown');
  const launchBtn          = document.getElementById('launch-btn');
  const backBtn            = document.getElementById('back-btn');
  const videoLibraryEl     = document.getElementById('video-library');
  const savedPlaylistsEl   = document.getElementById('saved-playlists');

  // ── State ─────────────────────────────────────────────────────────────────
  let selectedMode      = null;
  let parsedPlaylist    = null;
  let uiActiveTimer     = null;
  let authUser          = null;
  let selectedClockStyle = 'digital';
  let _savedPlaylistsData = [];

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
      selectedMode = normalizeMode(saved);
      cards.forEach((c) => c.classList.toggle('active', normalizeMode(c.dataset.wallpaper) === selectedMode));
    }
  } catch (_) {}

  try {
    const savedClockStyle = localStorage.getItem('xwall_clock_style');
    if (savedClockStyle && CLOCK_STYLE_LIBRARY.some((s) => s.id === savedClockStyle)) {
      selectedClockStyle = savedClockStyle;
    }
  } catch (_) {}

  // Default to first card if nothing saved
  if (!selectedMode && cards.length) {
    selectedMode = normalizeMode(cards[0].dataset.wallpaper);
    cards[0].classList.add('active');
  }

  // Show video library for the initial selection
  _showVideoLibrary(selectedMode);

  // ── Wallpaper card selection ──────────────────────────────────────────────
  cards.forEach((card) => {
    card.addEventListener('click', () => {
      cards.forEach((c) => c.classList.remove('active'));
      card.classList.add('active');
      selectedMode = normalizeMode(card.dataset.wallpaper);
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
    if (!Array.isArray(videos) || !videos.length) {
      videoLibraryEl.innerHTML = '<p class="vlib-empty">No space videos available right now. Try again in a moment.</p>';
      videoLibraryEl.classList.remove('hidden');
      return;
    }

    const activeId = selectedVideoIds[mode];
    videoLibraryEl.innerHTML =
      `<div class="xrail" data-step="252">` +
      `<button class="xrail-btn xrail-btn-left" type="button" aria-label="Scroll left">&lt;</button>` +
      `<div class="xrail-track vlib-scroll">${
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
      }</div>` +
      `<button class="xrail-btn xrail-btn-right" type="button" aria-label="Scroll right">&gt;</button>` +
      `</div>`;
    videoLibraryEl.classList.remove('hidden');
    _wireHorizontalRail(videoLibraryEl);

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
    if (mode === 'clock') {
      _renderClockStyles();
      return;
    }

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

  function _renderClockStyles() {
    videoLibraryEl.innerHTML =
      `<div class="xrail" data-step="252">` +
      `<button class="xrail-btn xrail-btn-left" type="button" aria-label="Scroll clock styles left">&lt;</button>` +
      `<div class="xrail-track vlib-scroll">${
        CLOCK_STYLE_LIBRARY.map((style) =>
          `<button class="vlib-card clock-style-card${style.id === selectedClockStyle ? ' active' : ''}" data-clock-style="${style.id}" type="button" aria-label="${_escapeHtml(style.title)}">` +
          `<span class="clock-style-thumb clock-style-thumb-${style.id}" aria-hidden="true"></span>` +
          `<span class="vlib-title">${_escapeHtml(style.title)}</span>` +
          `<span class="vlib-meta">${_escapeHtml(style.meta)}</span>` +
          `</button>`
        ).join('')
      }</div>` +
      `<button class="xrail-btn xrail-btn-right" type="button" aria-label="Scroll clock styles right">&gt;</button>` +
      `</div>` +
      `<p class="vlib-loading">Clock mode styles: choose your preferred watch face.</p>`;

    videoLibraryEl.classList.remove('hidden');
    _wireHorizontalRail(videoLibraryEl);

    videoLibraryEl.querySelectorAll('.clock-style-card').forEach((btn) => {
      btn.addEventListener('click', () => {
        const styleId = btn.dataset.clockStyle;
        if (!CLOCK_STYLE_LIBRARY.some((style) => style.id === styleId)) return;

        selectedClockStyle = styleId;
        try { localStorage.setItem('xwall_clock_style', selectedClockStyle); } catch (_) {}
        _track('clock_style_select', { style: selectedClockStyle });

        videoLibraryEl.querySelectorAll('.clock-style-card').forEach((card) => {
          card.classList.toggle('active', card.dataset.clockStyle === selectedClockStyle);
        });
      });
    });
  }

  function _wireHorizontalRail(rootEl) {
    const rail = rootEl.querySelector('.xrail');
    const track = rootEl.querySelector('.xrail-track');
    const left = rootEl.querySelector('.xrail-btn-left');
    const right = rootEl.querySelector('.xrail-btn-right');
    if (!rail || !track || !left || !right) return;

    const stepRaw = rail.dataset.step || '220';
    const resolveStep = () => {
      if (stepRaw === 'page') return Math.max(track.clientWidth - 24, 180);
      const parsed = parseInt(stepRaw, 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 220;
    };

    left.addEventListener('click', () => track.scrollBy({ left: -resolveStep(), behavior: 'smooth' }));
    right.addEventListener('click', () => track.scrollBy({ left: resolveStep(), behavior: 'smooth' }));
  }

  function _orderedVideoIdsForMode(mode) {
    const suggested = suggestedVideoLibrary[mode]?.length
      ? suggestedVideoLibrary[mode]
      : [];
    const fallback = FALLBACK_VIDEO_LIBRARY[mode] || [];
    const preferredId = selectedVideoIds[mode];
    return [preferredId]
      .concat(suggested.map((video) => video.id))
      .concat(fallback.map((video) => video.id))
      .filter((id, index, arr) => id && arr.indexOf(id) === index);
  }

  // ── Playlist search dropdown ─────────────────────────────────────────────
  function _showPlaylistDropdown(query) {
    if (!playlistDropdownEl || !_savedPlaylistsData.length) return;
    const q = query.toLowerCase();
    const matches = _savedPlaylistsData.filter((pl) => pl.name.toLowerCase().includes(q));
    if (!matches.length) { _hidePlaylistDropdown(); return; }
    playlistDropdownEl.innerHTML = '';
    matches.slice(0, 8).forEach((pl) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pdrop-item';
      btn.setAttribute('role', 'option');
      if (pl.image) {
        const img = document.createElement('img');
        img.src = pl.image; img.className = 'pdrop-thumb'; img.alt = ''; img.loading = 'lazy';
        btn.appendChild(img);
      } else {
        const sp = document.createElement('span'); sp.className = 'pdrop-thumb-empty';
        btn.appendChild(sp);
      }
      const nameEl = document.createElement('span');
      nameEl.className = 'pdrop-name';
      nameEl.textContent = pl.name;
      btn.appendChild(nameEl);
      const badge = document.createElement('span');
      badge.className = `pdrop-badge ${pl.provider === 'spotify' ? 'pdrop-badge-sp' : 'pdrop-badge-yt'}`;
      badge.textContent = pl.provider === 'spotify' ? 'Spotify' : 'YouTube';
      btn.appendChild(badge);
      btn.addEventListener('click', () => _selectDropdownPlaylist(pl));
      playlistDropdownEl.appendChild(btn);
    });
    playlistDropdownEl.classList.remove('hidden');
  }

  function _hidePlaylistDropdown() {
    if (playlistDropdownEl) playlistDropdownEl.classList.add('hidden');
  }

  function _selectDropdownPlaylist(pl) {
    savedPlaylistsEl?.querySelectorAll('.spl-item').forEach((b) => b.classList.remove('active'));
    parsedPlaylist = { provider: pl.provider, type: pl.provider === 'spotify' ? 'playlist' : undefined, id: pl.id, title: pl.name };
    urlInput.value = '';
    urlClear.classList.add('hidden');
    urlHint.textContent = `\u2713 ${pl.name} selected`;
    urlHint.className   = `playlist-hint ${pl.provider === 'spotify' ? 'hint-sp' : 'hint-yt'}`;
    _hidePlaylistDropdown();
  }

  // Close dropdown when clicking outside the input row
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.playlist-input-row')) _hidePlaylistDropdown();
  });

  // ── Playlist URL input ───────────────────────────────────────────────────
  urlInput.addEventListener('input', () => {
    const raw = urlInput.value.trim();
    if (!raw) {
      parsedPlaylist = null;
      urlClear.classList.add('hidden');
      urlHint.textContent = '';
      urlHint.className   = 'playlist-hint';
      _hidePlaylistDropdown();
      return;
    }
    urlClear.classList.remove('hidden');
    parsedPlaylist = Player.parseUrl(raw);
    if (parsedPlaylist) {
      urlHint.textContent = `\u2713 ${parsedPlaylist.provider === 'youtube' ? 'YouTube' : 'Spotify'} playlist detected`;
      urlHint.className   = 'playlist-hint ok';
      _hidePlaylistDropdown();
    } else if (_savedPlaylistsData.length) {
      urlHint.textContent = '';
      urlHint.className   = 'playlist-hint';
      _showPlaylistDropdown(raw);
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
    _hidePlaylistDropdown();
    urlInput.focus();
  });

  // ── Saved playlists (populated when signed in with Google) ────────────────
  async function _loadSavedPlaylists() {
    if (!savedPlaylistsEl) return;
    try {
      const res = await fetch('/api/playlists');
      const payload = await res.json();
      const list = Array.isArray(payload?.playlists) ? payload.playlists : [];
      _savedPlaylistsData = list;
      if (!list.length) {
        let emptyCopy;
        if (authUser?.provider === 'google') {
          const ch = payload?.channelInfo;
          const chName = ch?.title ? `"${ch.title}"` : 'your YouTube channel';
          emptyCopy =
            `No playlists found for ${chName}. ` +
            `If your playlists are on a different YouTube channel or Brand Account, ` +
            `sign out and sign in again — then pick the correct Google account that owns those playlists. ` +
            `Or paste a playlist URL directly below.`;
        } else {
          emptyCopy = 'No playlists found for this account yet.';
        }
        savedPlaylistsEl.innerHTML =
          '<p class="saved-playlists-label">Your playlists</p>' +
          `<p class="saved-playlists-empty">${emptyCopy}</p>`;
        savedPlaylistsEl.classList.remove('hidden');
        return;
      }

      const providerLabel = authUser?.provider === 'spotify' ? 'Spotify playlists' : 'YouTube playlists';
      savedPlaylistsEl.innerHTML =
        `<p class="saved-playlists-label">${providerLabel}</p>` +
        `<div class="xrail" data-step="page">` +
        `<button class="xrail-btn xrail-btn-left" type="button" aria-label="Scroll playlists left">&lt;</button>` +
        `<div class="xrail-track saved-playlists-list">${
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
        }</div>` +
        `<button class="xrail-btn xrail-btn-right" type="button" aria-label="Scroll playlists right">&gt;</button>` +
        `</div>`;
      savedPlaylistsEl.classList.remove('hidden');
      _wireHorizontalRail(savedPlaylistsEl);
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
    } catch (_) {
      savedPlaylistsEl.innerHTML =
        '<p class="saved-playlists-label">Your playlists</p>' +
        '<p class="saved-playlists-empty">Could not load playlists right now. Try sign out and sign in again.</p>';
      savedPlaylistsEl.classList.remove('hidden');
    }
  }

  function _hideSavedPlaylists() {
    if (savedPlaylistsEl) {
      savedPlaylistsEl.classList.add('hidden');
      savedPlaylistsEl.innerHTML = '';
    }
    _savedPlaylistsData = [];
    _hidePlaylistDropdown();
  }

  // ── Launch → go to main view ──────────────────────────────────────────────
  launchBtn.addEventListener('click', goMain);
  urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') goMain(); });

  function goMain() {
    viewHome.classList.add('hidden');
    viewMain.classList.remove('hidden');
    const shouldMuteBackground = Boolean(parsedPlaylist);
    const shouldUseCssOnlyBackground = Boolean(parsedPlaylist) && isMobileMediaEnvironment();

    // Request fullscreen (best-effort — silently fails on iOS)
    const docEl = document.documentElement;
    if (docEl.requestFullscreen)            docEl.requestFullscreen().catch(() => {});
    else if (docEl.webkitRequestFullscreen) docEl.webkitRequestFullscreen();

    _track('launch', { mode: selectedMode, video: selectedVideoIds[selectedMode] || null });
    Wallpaper.set(selectedMode, _orderedVideoIdsForMode(selectedMode), {
      muted: shouldMuteBackground,
      clockStyle: selectedClockStyle,
      cssOnly: shouldUseCssOnlyBackground,
    });

    // Force a second autostart attempt if the first initialization stalls.
    setTimeout(() => {
      const bg = document.getElementById('bg-video');
      if (!bg || viewMain.classList.contains('hidden')) return;
      if (!bg.classList.contains('loaded')) {
        Wallpaper.set(selectedMode, _orderedVideoIdsForMode(selectedMode), {
          muted: shouldMuteBackground,
          clockStyle: selectedClockStyle,
          cssOnly: shouldUseCssOnlyBackground,
        });
      }
    }, 2200);

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
    if (Wallpaper && typeof Wallpaper.stop === 'function') Wallpaper.stop();
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

