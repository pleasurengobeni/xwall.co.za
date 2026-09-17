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

  function _buildAuthUrl(basePath) {
    const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    return `${basePath}?return_to=${encodeURIComponent(returnTo)}`;
  }

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

  function _closeAuthPopup() {
    try { window.close(); } catch (_) {}
    setTimeout(() => {
      if (!window.closed) {
        try { window.open('', '_self'); } catch (_) {}
        try { window.close(); } catch (_) {}
      }
    }, 80);
  }

  // ── Check session status ──────────────────────────────────────────────────
  async function check() {
    try {
      const res  = await fetch('/auth/status', { cache: 'no-store' });
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

  // Locally generated initials avatar — avoids sending the user's name to a
  // third-party avatar service.
  function _initialsAvatar(name) {
    const initials = String(name || '')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => Array.from(part)[0] || '')
      .join('')
      .toUpperCase() || '?';
    const safe = initials.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">' +
      '<rect width="64" height="64" fill="#222"/>' +
      '<text x="32" y="32" dy="0.35em" text-anchor="middle" fill="#fff" ' +
      'font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="26">' +
      safe + '</text></svg>';
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  function _applyUser(user) {
    _user = user;
    const displayName = String(user.displayName || 'Signed in');

    // Provider avatar hosts may reject requests that carry a Referer header.
    userPhoto.referrerPolicy = 'no-referrer';
    userPhoto.onerror = () => {
      userPhoto.onerror = null;
      userPhoto.src = _initialsAvatar(displayName);
    };
    userPhoto.src = typeof user.photo === 'string' && user.photo.startsWith('https://')
      ? user.photo
      : _initialsAvatar(displayName);
    userPhoto.alt    = '';
    userName.textContent = displayName;

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
  async function logout() {
    try {
      await fetch('/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
    } catch (_) {}
    _clearUser();
  }

  logoutBtn.addEventListener('click', logout);

  // ── OAuth popup wiring ────────────────────────────────────────────────────
  loginButtons.querySelectorAll('a[href^="/auth/"]').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const href = link.getAttribute('href');
      const provider = href.includes('/google') ? 'google' : 'spotify';
      _openAuthPopup(_buildAuthUrl(href), provider);
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
  if (params.has('auth') || params.has('error')) {
    // Remove OAuth marker params without touching other URL query params.
    params.delete('auth');
    params.delete('error');
    const qs = params.toString();
    const cleaned = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;

    if (window.opener && !window.opener.closed) {
      // Preferred path: notify opener and let it refresh auth status.
      window.opener.postMessage(
        {
          type: 'xwall:auth',
          status: params.has('auth') ? 'success' : 'error',
        },
        window.location.origin
      );

      // Safari fallback: refresh opener location to the original page.
      try {
        window.opener.location.href = cleaned;
        window.opener.focus();
      } catch (_) {}

      _closeAuthPopup();
      return;
    }

    window.history.replaceState({}, '', cleaned);
  }

  return { check, logout, current: () => _user, onAuthChange: (cb) => { _onAuthChange = cb; } };
})();
