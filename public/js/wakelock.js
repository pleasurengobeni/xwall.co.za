/**
 * wakelock.js
 * Keeps the screen awake using the Web Wake Lock API and sends
 * periodic keep-alive pings to prevent network/WiFi idle timeouts.
 */
const WakeLock = (() => {
  'use strict';

  let lock          = null;
  let netTimer      = null;
  // True between request() and release(): the page *wants* the screen kept on.
  // Without it, the auto re-acquire logic would grab a new lock right after an
  // intentional release (e.g. returning to the home view).
  let wanted        = false;
  let supported     = ('wakeLock' in navigator);
  const PING_MS     = 25_000; // every 25 s — well under most 30 s idle timeouts

  async function request() {
    wanted = true;
    if (!supported || lock) return;
    try {
      const acquired = await navigator.wakeLock.request('screen');
      if (!wanted) {
        // release() was called while the request was pending
        try { await acquired.release(); } catch (_) {}
        return;
      }
      lock = acquired;
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
    // The system dropped the lock (tab hidden, battery saver…): re-acquire once
    // the page is visible again, but only if we still want it.
    if (wanted && document.visibilityState === 'visible') {
      setTimeout(() => { if (wanted) request(); }, 800);
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
    if (wanted && document.visibilityState === 'visible' && !lock) {
      request();
    }
  });

  async function release() {
    wanted = false;
    stopNetwork();
    if (lock) {
      const current = lock;
      lock = null;
      try { await current.release(); } catch (_) {}
    }
    _setIndicator(false);
  }

  return { request, release, startNetwork, stopNetwork };
})();
