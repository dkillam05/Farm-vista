/* FarmVista automatic PWA update checker
   Keeps installed/mobile sessions current without asking users to force-close
   or manually hard-refresh.

   Sept. 12, 2026 update behavior:
   - detect the new FarmVista version network-only;
   - wait briefly and verify the same version again so GitHub Pages has time
     to finish publishing all files before we reload;
   - update/activate the service worker first;
   - reload once with a harmless version query so normal browser caches cannot
     hand the app an old HTML shell;
   - NEVER reload the same release repeatedly if an old controlled page still
     reports a stale in-memory version. One automatic reload attempt per release.
*/
(function () {
  'use strict';

  if (window.__FV_AUTO_UPDATE_ACTIVE) return;
  window.__FV_AUTO_UPDATE_ACTIVE = true;

  const CHECK_INTERVAL_MS = 5 * 60 * 1000;
  const MIN_CHECK_GAP_MS = 30 * 1000;
  const DEPLOY_SETTLE_MS = 4500;
  const VERSION_URL = '/js/version.js';
  const UPDATE_PARAM = 'fv_release';
  const ATTEMPT_KEY = 'fv:auto-update-attempted-release';

  let lastCheckAt = 0;
  let updatePending = false;
  let reloadStarted = false;
  let pageDirty = false;
  let pendingVersion = '';
  let settleTimer = 0;

  const initialVersion = String(
    window.FV_VERSION?.number ||
    window.FarmVistaVersion ||
    window.FV_BUILD ||
    ''
  ).trim();

  const releaseFromUrl = (() => {
    try {
      return String(new URL(location.href).searchParams.get(UPDATE_PARAM) || '').trim();
    } catch {
      return '';
    }
  })();

  function getAttemptedRelease() {
    try { return String(sessionStorage.getItem(ATTEMPT_KEY) || '').trim(); }
    catch { return ''; }
  }

  function setAttemptedRelease(version) {
    try { sessionStorage.setItem(ATTEMPT_KEY, String(version || '')); }
    catch {}
  }

  function clearAttemptedRelease() {
    try { sessionStorage.removeItem(ATTEMPT_KEY); }
    catch {}
  }

  // Once the page actually boots the requested release, clear the one-shot
  // protection so a future release can update normally.
  if (releaseFromUrl && initialVersion === releaseFromUrl) {
    clearAttemptedRelease();
  }

  function parseVersion(text) {
    const source = String(text || '');
    const match =
      source.match(/number\s*:\s*["']([^"']+)["']/) ||
      source.match(/FV_NUMBER\s*=\s*["']([^"']+)["']/);
    return match ? String(match[1]).trim() : '';
  }

  async function fetchDeployedVersion() {
    const now = Date.now();
    const response = await fetch(
      VERSION_URL + '?fv_update_check=' + now,
      {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'Cache-Control': 'no-cache' }
      }
    );

    if (!response.ok) return '';
    return parseVersion(await response.text());
  }

  function alreadyAttempted(version) {
    const wanted = String(version || '').trim();
    if (!wanted) return false;
    return releaseFromUrl === wanted || getAttemptedRelease() === wanted;
  }

  function isSafeToReload() {
    if (document.visibilityState !== 'visible') return false;

    const active = document.activeElement;
    if (
      active &&
      active.matches?.('input, textarea, select, [contenteditable="true"]')
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

  async function waitForControllerChange(timeoutMs = 2500) {
    if (!('serviceWorker' in navigator)) return;

    await new Promise(resolve => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        navigator.serviceWorker.removeEventListener('controllerchange', finish);
        resolve();
      };

      navigator.serviceWorker.addEventListener('controllerchange', finish, { once: true });
      setTimeout(finish, timeoutMs);
    });
  }

  async function prepareServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return;

      const beforeController = navigator.serviceWorker.controller;
      await reg.update().catch(() => {});

      if (reg.waiting?.postMessage) {
        reg.waiting.postMessage('SKIP_WAITING');
      }

      if (reg.installing) {
        await new Promise(resolve => {
          const worker = reg.installing;
          const done = () => {
            if (worker.state === 'activated' || worker.state === 'redundant') resolve();
          };
          worker.addEventListener('statechange', done);
          done();
          setTimeout(resolve, 2500);
        });
      }

      if (beforeController && navigator.serviceWorker.controller === beforeController) {
        await waitForControllerChange(1800);
      }
    } catch (err) {
      console.warn('[FarmVista Update] Service worker update check failed:', err);
    }
  }

  function freshReload(version) {
    const wanted = String(version || Date.now());
    setAttemptedRelease(wanted);

    const url = new URL(location.href);
    url.searchParams.set(UPDATE_PARAM, wanted);

    // replace() avoids adding a useless update-only history entry.
    location.replace(url.toString());
  }

  async function reloadWhenSafe() {
    if (!updatePending || reloadStarted) return;
    if (!isSafeToReload()) return;
    if (alreadyAttempted(pendingVersion)) {
      updatePending = false;
      return;
    }

    reloadStarted = true;

    try {
      await prepareServiceWorker();
    } finally {
      freshReload(pendingVersion);
    }
  }

  async function confirmSettledUpdate(version) {
    clearTimeout(settleTimer);

    settleTimer = window.setTimeout(async () => {
      try {
        const confirmed = await fetchDeployedVersion();

        if (!confirmed || confirmed === initialVersion) return;
        if (alreadyAttempted(confirmed)) return;

        // If another version landed during the short settle window, restart
        // the wait for that newest version rather than reloading mid-deploy.
        if (confirmed !== version) {
          pendingVersion = confirmed;
          confirmSettledUpdate(confirmed);
          return;
        }

        console.info(
          '[FarmVista Update] Release ready:',
          initialVersion,
          '→',
          confirmed
        );

        pendingVersion = confirmed;
        updatePending = true;
        await reloadWhenSafe();
      } catch (err) {
        console.debug('[FarmVista Update] Release verification skipped:', err);
      }
    }, DEPLOY_SETTLE_MS);
  }

  async function checkForUpdate(force) {
    if (reloadStarted) return;

    const now = Date.now();
    if (!force && now - lastCheckAt < MIN_CHECK_GAP_MS) return;
    lastCheckAt = now;

    try {
      const deployedVersion = await fetchDeployedVersion();
      if (!deployedVersion || !initialVersion) return;

      if (deployedVersion !== initialVersion) {
        // Critical loop guard: if this browser already attempted this exact
        // release, do not flash/reload every DEPLOY_SETTLE_MS. A normal later
        // navigation or manual refresh can still pick up fresh assets.
        if (alreadyAttempted(deployedVersion)) return;

        if (deployedVersion !== pendingVersion) {
          console.info(
            '[FarmVista Update] New version detected:',
            initialVersion,
            '→',
            deployedVersion,
            '(waiting for deploy to settle)'
          );
          pendingVersion = deployedVersion;
          confirmSettledUpdate(deployedVersion);
        }
      }
    } catch (err) {
      console.debug('[FarmVista Update] Version check skipped:', err);
    }
  }

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

  document.addEventListener('focusout', () => {
    setTimeout(reloadWhenSafe, 0);
  }, true);

  setInterval(() => {
    checkForUpdate(false);
    reloadWhenSafe();
  }, CHECK_INTERVAL_MS);

  setTimeout(() => checkForUpdate(true), 2500);
})();
