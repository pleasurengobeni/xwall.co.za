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
      videoLibraryEl.innerHTML = '<p class="vlib-empty">No videos available right now. Try again in a moment.</p>';
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
          const thumb = _escapeHtml(v.thumbnail || `https://i.ytimg.com/vi/${encodeURIComponent(v.id)}/mqdefault.jpg`);
          return (
            `<button class="vlib-card${v.id === activeId ? ' active' : ''}" ` +
            `data-id="${_escapeHtml(v.id)}" data-mode="${_escapeHtml(mode)}" type="button" aria-label="${title}" aria-pressed="${v.id === activeId}">` +
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
        videoLibraryEl.querySelectorAll('.vlib-card').forEach((b) => {
          b.classList.toggle('active', b.dataset.id === id);
          b.setAttribute('aria-pressed', String(b.dataset.id === id));
        });
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
      })
      .finally(() => {
        videoLibraryEl.querySelector('.vlib-loading')?.remove();
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
  let _dropdownActiveIndex = -1;

  function _dropdownItems() {
    return playlistDropdownEl
      ? Array.from(playlistDropdownEl.querySelectorAll('.pdrop-item'))
      : [];
  }

  function _isDropdownOpen() {
    return Boolean(playlistDropdownEl) && !playlistDropdownEl.classList.contains('hidden');
  }

  function _setDropdownActive(index) {
    const items = _dropdownItems();
    if (!items.length) { _dropdownActiveIndex = -1; return; }
    _dropdownActiveIndex = (index + items.length) % items.length;
    items.forEach((item, i) => {
      const active = i === _dropdownActiveIndex;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-selected', String(active));
      if (active) {
        urlInput.setAttribute('aria-activedescendant', item.id);
        item.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  function _renderDropdownItems(playlists, label) {
    if (!playlistDropdownEl) return;
    playlistDropdownEl.innerHTML = '';
    _dropdownActiveIndex = -1;
    urlInput.removeAttribute('aria-activedescendant');
    if (label) {
      const hdr = document.createElement('p');
      hdr.className = 'pdrop-label';
      hdr.textContent = label;
      playlistDropdownEl.appendChild(hdr);
    }
    playlists.slice(0, 8).forEach((pl, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = `pdrop-item-${index}`;
      btn.tabIndex = -1;
      btn.className = 'pdrop-item';
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', 'false');
      if (pl.image) {
        const img = document.createElement('img');
        img.src = pl.image; img.className = 'pdrop-thumb'; img.alt = ''; img.loading = 'lazy';
        img.referrerPolicy = 'no-referrer';
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
    urlInput.setAttribute('aria-expanded', 'true');
  }

  function _showPlaylistDropdown(query) {
    if (!playlistDropdownEl) return;
    const q = query.toLowerCase();

    // First: filter saved playlists
    if (_savedPlaylistsData.length) {
      const saved = _savedPlaylistsData.filter((pl) => pl.name.toLowerCase().includes(q));
      if (saved.length) {
        _renderDropdownItems(saved, null);
        return;
      }
    }

    // No saved match. Searching uses the signed-in user's own account, and only
    // runs on Enter rather than on every keystroke.
    _hidePlaylistDropdown();
    if (q.length < 2) return;
    _setHint(
      authUser
        ? `Press Enter to search ${authUser.provider === 'spotify' ? 'Spotify' : 'YouTube'}`
        : 'Sign in with YouTube or Spotify to search, or paste a playlist link',
      'playlist-hint'
    );
  }

  let _searchInFlight = false;

  async function _searchPlaylists(query) {
    if (_searchInFlight || query.length < 2) return;
    if (!authUser) {
      _hidePlaylistDropdown();
      _setHint('Sign in with YouTube or Spotify to search, or paste a playlist link', 'playlist-hint');
      return;
    }
    const providerName = authUser.provider === 'spotify' ? 'Spotify' : 'YouTube';
    _searchInFlight = true;
    _setHint('', 'playlist-hint');
    if (playlistDropdownEl) {
      playlistDropdownEl.innerHTML = `<p class="pdrop-label pdrop-searching">Searching ${providerName}…</p>`;
      playlistDropdownEl.classList.remove('hidden');
    }

    try {
      const res = await fetch(`/api/playlists/search?q=${encodeURIComponent(query)}&limit=8`);
      const payload = await res.json().catch(() => ({}));
      if (urlInput.value.trim() !== query) return; // input changed meanwhile

      if (!res.ok) {
        _hidePlaylistDropdown();
        if (res.status === 401 && payload.reauth) {
          // The provider token expired mid-session
          await Auth.logout();
          _setHint('Your sign-in expired. Sign in again to search.', 'playlist-hint');
          return;
        }
        _setHint(
          res.status === 401 ? 'Sign in with YouTube or Spotify to search, or paste a playlist link'
            : res.status === 429 ? (payload.error || 'Daily search limit reached. Paste a playlist link instead.')
              : `${providerName} search is unavailable right now. Paste a playlist link instead.`,
          'playlist-hint'
        );
        return;
      }

      const playlists = Array.isArray(payload.playlists) ? payload.playlists : [];
      if (!playlists.length) {
        _hidePlaylistDropdown();
        _setHint(`No ${providerName} playlists found for \u201c${query}\u201d`, 'playlist-hint');
        return;
      }

      // Only present on searches that counted against the daily allowance
      const remaining = parseInt(res.headers.get('RateLimit-Remaining'), 10);
      const label = Number.isFinite(remaining)
        ? `${providerName} results \u00b7 ${remaining} left today`
        : `${providerName} results`;
      _renderDropdownItems(playlists, label);
    } catch (_) {
      _hidePlaylistDropdown();
      _setHint('Search failed. Check your connection and try again.', 'playlist-hint');
    } finally {
      _searchInFlight = false;
    }
  }

  function _hidePlaylistDropdown() {
    _dropdownActiveIndex = -1;
    urlInput.removeAttribute('aria-activedescendant');
    urlInput.setAttribute('aria-expanded', 'false');
    if (playlistDropdownEl) playlistDropdownEl.classList.add('hidden');
  }

  function _setHint(text, className) {
    urlHint.textContent = text;
    urlHint.className   = className;
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
    } else {
      urlHint.textContent = '';
      urlHint.className   = 'playlist-hint';
      _showPlaylistDropdown(raw);
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
      const res = await fetch('/api/playlists', { cache: 'no-store' });
      const payload = await res.json().catch(() => ({}));
      if (res.status === 401 && payload?.reauth) {
        // Provider token expired: sign out locally so the sign-in buttons return.
        await Auth.logout();
        _setHint('Your sign-in expired. Sign in again to see your playlists.', 'playlist-hint');
        return;
      }
      if (!res.ok) throw new Error('playlists unavailable');
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
          `<p class="saved-playlists-empty">${_escapeHtml(emptyCopy)}</p>`;
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
            `<button class="spl-item" data-id="${_escapeHtml(pl.id)}" data-provider="${pl.provider === 'spotify' ? 'spotify' : 'youtube'}" type="button">` +
            (pl.image
              ? `<img class="spl-thumb" src="${_escapeHtml(pl.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
              : `<span class="spl-thumb-empty"></span>`) +
            `<span class="spl-copy">` +
            `<span class="spl-name">${_escapeHtml(pl.name || 'Untitled')}</span>` +
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
  urlInput.addEventListener('keydown', (e) => {
    const items = _isDropdownOpen() ? _dropdownItems() : [];

    if (e.key === 'ArrowDown' && items.length) {
      e.preventDefault();
      _setDropdownActive(_dropdownActiveIndex + 1);
      return;
    }
    if (e.key === 'ArrowUp' && items.length) {
      e.preventDefault();
      _setDropdownActive(_dropdownActiveIndex - 1);
      return;
    }
    if (e.key === 'Escape' && _isDropdownOpen()) {
      e.preventDefault();
      _hidePlaylistDropdown();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      // With results showing, Enter picks the highlighted (or first) playlist.
      if (items.length && !parsedPlaylist) {
        items[Math.max(_dropdownActiveIndex, 0)].click();
        return;
      }
      // Typed text that isn't a playlist link: search the user's provider.
      const raw = urlInput.value.trim();
      if (raw && !parsedPlaylist) {
        _searchPlaylists(raw);
        return;
      }
      goMain();
    }
  });

  function goMain() {
    if (!viewMain.classList.contains('hidden')) return;
    _hidePlaylistDropdown();
    viewHome.classList.add('hidden');
    viewMain.classList.remove('hidden');

    // Give the ambient view its own history entry so the browser / Android
    // back button returns to the selection screen instead of leaving the site.
    try {
      if (!history.state || history.state.xwallView !== 'main') {
        history.pushState({ xwallView: 'main' }, '');
      }
    } catch (_) {}
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
  backBtn.addEventListener('click', _navigateHome);

  function _navigateHome() {
    // Pop our own history entry when present; popstate then calls goHome().
    if (history.state && history.state.xwallView === 'main') {
      history.back();
    } else {
      goHome();
    }
  }

  window.addEventListener('popstate', () => {
    if (!viewMain.classList.contains('hidden')) goHome();
  });

  function goHome() {
    if (viewMain.classList.contains('hidden')) return;
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
    document.removeEventListener('keydown', _onMainKeydown);
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
    document.addEventListener('keydown', _onMainKeydown);
  }

  // ── Keyboard shortcuts in the ambient view (desktop / TV remotes) ─────────
  //   Space / K → play-pause    ← / → → previous / next track
  //   F → toggle fullscreen     Esc / Backspace → back to selection
  function _clickIfShown(id) {
    const transport = document.getElementById('transport');
    if (transport && transport.classList.contains('shown')) {
      document.getElementById(id)?.click();
    }
  }

  function _onMainKeydown(e) {
    if (viewMain.classList.contains('hidden')) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    _onActivity();

    // Let focused controls handle their own activation keys.
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if ((tag === 'BUTTON' || tag === 'A') && (e.key === ' ' || e.key === 'Enter')) return;

    switch (e.key) {
      case ' ':
      case 'k':
      case 'K':
        e.preventDefault();
        _clickIfShown('tp-play');
        break;
      case 'ArrowRight':
        e.preventDefault();
        _clickIfShown('tp-next');
        break;
      case 'ArrowLeft':
        e.preventDefault();
        _clickIfShown('tp-prev');
        break;
      case 'f':
      case 'F':
        e.preventDefault();
        _toggleFullscreen();
        break;
      case 'Escape':
      case 'Backspace':
        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
          e.preventDefault();
          _navigateHome();
        }
        break;
      default:
        break;
    }
  }

  function _toggleFullscreen() {
    const docEl = document.documentElement;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else if (document.webkitFullscreenElement) {
      document.webkitExitFullscreen();
    } else if (docEl.requestFullscreen) {
      docEl.requestFullscreen().catch(() => {});
    } else if (docEl.webkitRequestFullscreen) {
      docEl.webkitRequestFullscreen();
    }
  }

  // ── Auth check (shows/hides home sign-in row + saves playlists) ───────────
  Auth.onAuthChange(async (user) => {
    authUser = user;
    _updateSearchAffordance();
    if (user) {
      await _loadSavedPlaylists();
    } else {
      _hideSavedPlaylists();
    }
  });

  // The placeholder tells visitors what the input can do for them right now.
  function _updateSearchAffordance() {
    urlInput.placeholder = authUser
      ? `Paste a playlist link, or search ${authUser.provider === 'spotify' ? 'Spotify' : 'YouTube'} + Enter…`
      : 'Paste a playlist link, or sign in to search…';
  }

  _updateSearchAffordance();

  await Auth.check();
})();

