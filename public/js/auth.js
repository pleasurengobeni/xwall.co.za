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

  // ── Handle redirect from OAuth (e.g. ?auth=success) ──────────────────────
  const params = new URLSearchParams(window.location.search);
  if (params.has('auth') || params.has('error')) {
    // Remove query params from URL bar without triggering a reload
    window.history.replaceState({}, '', window.location.pathname);
  }

  return { check, current: () => _user, onAuthChange: (cb) => { _onAuthChange = cb; } };
})();
