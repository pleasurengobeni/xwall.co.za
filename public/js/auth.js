/**
 * auth.js
 * Manages authentication state by calling the server-side /auth/status
 * endpoint. Tokens are never exposed to the browser — the server holds them
 * in an httpOnly session cookie.
 */
const Auth = (() => {
  'use strict';

  const userInfo     = document.getElementById('home-user-info');
  const loginButtons = document.getElementById('home-login-buttons');
  const userPhoto    = document.getElementById('home-user-photo');
  const userName     = document.getElementById('home-user-name');
  const logoutBtn    = document.getElementById('home-logout-btn');

  let _user = null;
  let _onAuthChange = null;

  function _openAuthPopup(url, provider) {
    const w = 520;
    const h = 680;
    const dualScreenLeft = window.screenLeft !== undefined ? window.screenLeft : window.screenX;
    const dualScreenTop  = window.screenTop  !== undefined ? window.screenTop  : window.screenY;
    const width  = window.innerWidth  || document.documentElement.clientWidth  || screen.width;
    const height = window.innerHeight || document.documentElement.clientHeight || screen.height;
    const left = Math.max(0, dualScreenLeft + Math.round((width  - w) / 2));
    const top  = Math.max(0, dualScreenTop  + Math.round((height - h) / 2));

    const popup = window.open(
      url,
      `xwall-${provider}-auth`,
      `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`
    );

    // Popup blocked: fallback to same-window auth redirect
    if (!popup || popup.closed || typeof popup.closed === 'undefined') {
      window.location.href = url;
      return;
    }

    popup.focus();
  }

  // ── Check session status ──────────────────────────────────────────────────
  async function check() {
    try {
      const res  = await fetch('/auth/status');
      const data = await res.json();
      if (data.authenticated) {
        _applyUser(data.user);
      } else {
        _clearUser();
      }
    } catch (err) {
      console.warn('Auth: status check failed', err);
      _clearUser();
    }
  }

  function _applyUser(user) {
    _user = user;

    // Fallback avatar via initials if no photo
    userPhoto.src = user.photo && user.photo.startsWith('https://')
      ? user.photo
      : `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName)}&background=222&color=fff&size=64`;
    userPhoto.alt    = user.displayName;
    userName.textContent = user.displayName;

    userInfo.classList.remove('hidden');
    loginButtons.classList.add('hidden');
    if (_onAuthChange) _onAuthChange(_user);
  }

  function _clearUser() {
    _user = null;
    userInfo.classList.add('hidden');
    loginButtons.classList.remove('hidden');
    if (_onAuthChange) _onAuthChange(null);
  }

  // ── Logout ────────────────────────────────────────────────────────────────
  logoutBtn.addEventListener('click', async () => {
    try { await fetch('/auth/logout', { method: 'POST' }); } catch (_) {}
    _clearUser();
  });

  // ── OAuth popup wiring ────────────────────────────────────────────────────
  loginButtons.querySelectorAll('a[href^="/auth/"]').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const href = link.getAttribute('href');
      const provider = href.includes('/google') ? 'google' : 'spotify';
      _openAuthPopup(href, provider);
    });
  });

  window.addEventListener('message', async (event) => {
    if (event.origin !== window.location.origin) return;
    if (!event.data || event.data.type !== 'xwall:auth') return;

    if (event.data.status === 'success') {
      await check();
      if (_onAuthChange) _onAuthChange(_user);
      return;
    }

    if (event.data.status === 'error') {
      console.warn('Auth: popup sign-in failed');
    }
  });

  // ── Handle redirect from OAuth (e.g. ?auth=success) ──────────────────────
  const params = new URLSearchParams(window.location.search);
  if (window.opener && (params.has('auth') || params.has('error'))) {
    // When OAuth happens inside a popup, notify the opener and close.
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(
        {
          type: 'xwall:auth',
          status: params.has('auth') ? 'success' : 'error',
        },
        window.location.origin
      );
    }

    window.close();
  }

  if (params.has('auth') || params.has('error')) {
    // Remove query params from URL bar without triggering a reload
    window.history.replaceState({}, '', window.location.pathname);
  }

  return { check, current: () => _user, onAuthChange: (cb) => { _onAuthChange = cb; } };
})();
