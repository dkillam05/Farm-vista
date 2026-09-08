/* FarmVista automatic PWA update checker
   Keeps installed/mobile sessions current without asking users to force-close
   or manually refresh. Version checks are network-only and reload only when
   the current page is safe to refresh.
*/
(function () {
  'use strict';

  if (window.__FV_AUTO_UPDATE_ACTIVE) return;
  window.__FV_AUTO_UPDATE_ACTIVE = true;

  const CHECK_INTERVAL_MS = 5 * 60 * 1000;
  const MIN_CHECK_GAP_MS = 30 * 1000;
  const VERSION_URL = '/js/version.js';

  let lastCheckAt = 0;
  let updatePending = false;
  let reloadStarted = false;
  let pageDirty = false;

  const initialVersion = String(
    window.FV_VERSION?.number ||
    window.FarmVistaVersion ||
    window.FV_BUILD ||
    ''
  ).trim();

  function parseVersion(text) {
    const source = String(text || '');
    const match =
      source.match(/number\s*:\s*["']([^"']+)["']/) ||
      source.match(/FV_NUMBER\s*=\s*["']([^"']+)["']/);
    return match ? String(match[1]).trim() : '';
  }

  function isSafeToReload() {
    if (document.visibilityState !== 'visible') return false;

    const active = document.activeElement;
    if (
      active &&
      (active.matches?.('input, textarea, select, [contenteditable="true"]'))
    ) {
      return false;
    }

    if (pageDirty) return false;

    if (
      document.querySelector(
        '.processing-screen.show, .assist-screen.show, .result-screen.show, .error-screen.show, ' +
        '.modal.show, .modal.open, dialog[open], [data-fv-update-block="true"]'
      )
    ) {
      return false;
    }

    return true;
  }

  async function prepareServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return;

      await reg.update().catch(() => {});

      if (reg.waiting?.postMessage) {
        reg.waiting.postMessage('SKIP_WAITING');
      }
    } catch (err) {
      console.warn('[FarmVista Update] Service worker update check failed:', err);
    }
  }

  async function reloadWhenSafe() {
    if (!updatePending || reloadStarted) return;
    if (!isSafeToReload()) return;

    reloadStarted = true;

    try {
      await prepareServiceWorker();
    } finally {
      // Give a waiting worker a brief moment to activate before reloading.
      setTimeout(() => {
        location.reload();
      }, 350);
    }
  }

  async function checkForUpdate(force) {
    if (reloadStarted) return;

    const now = Date.now();
    if (!force && now - lastCheckAt < MIN_CHECK_GAP_MS) return;
    lastCheckAt = now;

    try {
      const response = await fetch(
        VERSION_URL + '?fv_update_check=' + now,
        {
          cache: 'no-store',
          credentials: 'same-origin',
          headers: { 'Cache-Control': 'no-cache' }
        }
      );

      if (!response.ok) return;

      const deployedVersion = parseVersion(await response.text());
      if (!deployedVersion || !initialVersion) return;

      if (deployedVersion !== initialVersion) {
        console.info(
          '[FarmVista Update] New version detected:',
          initialVersion,
          '→',
          deployedVersion
        );
        updatePending = true;
        await reloadWhenSafe();
      }
    } catch (err) {
      // Offline/poor-signal users should keep working normally.
      console.debug('[FarmVista Update] Version check skipped:', err);
    }
  }

  // Do not interrupt a user who has begun editing a form. A normal page
  // navigation will pick up the new version; otherwise the next safe page
  // focus will refresh automatically.
  document.addEventListener('input', () => { pageDirty = true; }, true);
  document.addEventListener('change', () => { pageDirty = true; }, true);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkForUpdate(true);
      reloadWhenSafe();
    }
  });

  window.addEventListener('focus', () => {
    checkForUpdate(false);
    reloadWhenSafe();
  });

  window.addEventListener('pageshow', () => {
    checkForUpdate(true);
  });

  window.addEventListener('online', () => {
    checkForUpdate(true);
  });

  // If an update was deferred only because a control had focus, retry as soon
  // as the user leaves that control.
  document.addEventListener('focusout', () => {
    setTimeout(reloadWhenSafe, 0);
  }, true);

  setInterval(() => {
    checkForUpdate(false);
    reloadWhenSafe();
  }, CHECK_INTERVAL_MS);

  // First check shortly after boot so normal page rendering is never delayed.
  setTimeout(() => checkForUpdate(true), 2500);
})();
