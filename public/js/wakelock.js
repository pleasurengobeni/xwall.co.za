/**
 * wakelock.js
 * Keeps the screen awake using the Web Wake Lock API and sends
 * periodic keep-alive pings to prevent network/WiFi idle timeouts.
 */
const WakeLock = (() => {
  'use strict';

  let lock          = null;
  let netTimer      = null;
  let supported     = ('wakeLock' in navigator);
  const PING_MS     = 25_000; // every 25 s — well under most 30 s idle timeouts

  async function request() {
    if (!supported) return;
    try {
      lock = await navigator.wakeLock.request('screen');
      _setIndicator(true);
      lock.addEventListener('release', _onRelease);
    } catch (err) {
      // Fails silently — e.g. when tab is backgrounded or on unsupported device
      _setIndicator(false);
    }
  }

  function _onRelease() {
    lock = null;
    _setIndicator(false);
    // Re-acquire automatically once the page is visible again
    if (document.visibilityState === 'visible') {
      setTimeout(request, 800);
    }
  }

  function startNetwork() {
    if (netTimer) return;
    netTimer = setInterval(_ping, PING_MS);
  }

  function stopNetwork() {
    clearInterval(netTimer);
    netTimer = null;
  }

  function _ping() {
    // Fire-and-forget — keeps TCP/WiFi connection alive
    fetch('/ping', { method: 'GET', cache: 'no-store' }).catch(() => {});
  }

  function _setIndicator(active) {
    const el = document.getElementById('wake-indicator');
    if (!el) return;
    el.textContent = active ? '☀️' : '💤';
    el.title = active ? 'Screen keep-awake active' : 'Screen keep-awake inactive';
  }

  // Re-acquire whenever the tab becomes visible
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !lock) {
      request();
    }
  });

  async function release() {
    stopNetwork();
    if (lock) {
      try { await lock.release(); } catch (_) {}
      lock = null;
    }
    _setIndicator(false);
  }

  return { request, release, startNetwork, stopNetwork };
})();
