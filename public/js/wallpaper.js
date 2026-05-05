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

  let currentMode     = null;
  let _currentVideoId  = null;
  let fadeTimer        = null;

  // ── YouTube embed URL builder ─────────────────────────────────────────────
  function _ytUrl(id) {
    const p = new URLSearchParams({
      autoplay:        1,
      mute:            1,
      loop:            1,
      controls:        0,
      playlist:        id,   // required for loop to work
      rel:             0,
      showinfo:        0,
      iv_load_policy:  3,
      modestbranding:  1,
      disablekb:       1,
      playsinline:     1,
      enablejsapi:     1,
      origin:          window.location.origin,
    });
    return `https://www.youtube.com/embed/${id}?${p}`;
  }

  // ── Set a wallpaper mode ──────────────────────────────────────────────────
  function set(mode, videoId) {
    const vid = (mode !== 'clock') ? (videoId || VIDEO_IDS[mode]) : null;
    if (mode === currentMode && vid === _currentVideoId) return;
    currentMode     = mode;
    _currentVideoId = vid;

    // Persist preference
    try { localStorage.setItem('xwall_mode', mode); } catch (_) {}

    if (mode === 'clock') {
      _activateClock();
    } else {
      _activateVideo(mode, vid);
    }
  }

  function _activateClock() {
    Rain.stop();
    Clock.start();
    // Hide video
    bgVideo.classList.remove('loaded');
    clearTimeout(fadeTimer);
    setTimeout(() => { bgVideo.src = ''; }, 1500);
    cssBg.className = 'css-bg clock-bg';
  }

  function _activateVideo(mode, videoId) {
    Clock.stop();

    // Start / stop rain canvas
    if (mode === 'rain') {
      Rain.start();
    } else {
      Rain.stop();
    }

    // CSS fallback visible immediately
    cssBg.className = `css-bg ${mode}`;

    // Unload previous video
    bgVideo.classList.remove('loaded');
    bgVideo.src = '';

    // Load new video with a brief delay so the CSS is visible first
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => {
      bgVideo.src = _ytUrl(videoId || VIDEO_IDS[mode]);
      // Fade in after additional delay (allow iframe to buffer)
      fadeTimer = setTimeout(() => bgVideo.classList.add('loaded'), 2500);
    }, 200);
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  // No-op: mode selection is handled by app.js home view before entering main
  function init() {}

  return { init, set, current: () => currentMode };
})();
