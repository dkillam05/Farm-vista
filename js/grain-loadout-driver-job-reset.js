/* =====================================================================
   FarmVista — Load Out Driver Hauling-Job Reset Guard

   On a NEW load, changing Driver / Trucking Sub must never preserve the
   hauling job from the previously selected driver. grain-ticket.html
   rebuilds the hauling-job SELECT after a driver change and can preserve the
   prior selected value while doing so. This guard keeps the select at its
   normal blank/default value during that rebuild.

   The repeat-run module still owns driver-specific autofill. As soon as that
   module begins applying a valid previous run (fv-loadout-silent-preload),
   this guard gets out of the way so the newly selected driver's hauling job
   can be restored normally.
===================================================================== */

(function () {
  'use strict';

  if (window.__FV_LOADOUT_DRIVER_JOB_RESET_20260904) return;
  window.__FV_LOADOUT_DRIVER_JOB_RESET_20260904 = true;

  const $ = id => document.getElementById(id);
  const clean = value => String(value ?? '').trim();

  let resetToken = 0;
  let observer = null;
  let stopTimer = null;

  function isCreateModal() {
    const backdrop = $('loadout-modal-backdrop');
    const title = $('loadout-modal-title');
    return Boolean(
      backdrop?.classList.contains('open') &&
      clean(title?.textContent).toLowerCase() === 'assign load'
    );
  }

  function stopGuard() {
    resetToken += 1;
    if (observer) observer.disconnect();
    observer = null;
    if (stopTimer) clearTimeout(stopTimer);
    stopTimer = null;
  }

  function ensureBlankOption(select) {
    if (!select) return null;

    let blank = Array.from(select.options || [])
      .find(option => clean(option.value) === '') || null;

    if (!blank) {
      blank = document.createElement('option');
      blank.value = '';
      blank.textContent = 'Select hauling job';
      select.insertBefore(blank, select.firstChild || null);
    }

    return blank;
  }

  function forceBlank() {
    if (!isCreateModal()) return;

    // Once the repeat-run module starts applying the NEW driver's own saved
    // run, it owns the hauling-job value and this guard must not fight it.
    if (document.documentElement.classList.contains('fv-loadout-silent-preload')) {
      stopGuard();
      return;
    }

    const select = $('loadout-hauling-job');
    if (!select) return;

    // Remove only options injected by the repeat-run helper for the prior
    // driver. Normal hauling-job options remain untouched.
    select.querySelectorAll('option[data-fv-repeat-injected="1"]')
      .forEach(option => option.remove());

    const blank = ensureBlankOption(select);
    if (!blank) return;

    Array.from(select.options || []).forEach(option => {
      option.selected = option === blank;
    });

    select.value = '';
    select.selectedIndex = Array.from(select.options || []).indexOf(blank);
  }

  function beginGuard() {
    stopGuard();
    const myToken = resetToken;

    if (!isCreateModal()) return;

    // Run after grain-ticket.html's own driver-change handler, then continue
    // watching while that page rebuilds the hauling-job SELECT.
    queueMicrotask(() => {
      if (myToken !== resetToken) return;
      forceBlank();
    });

    requestAnimationFrame(() => {
      if (myToken !== resetToken) return;
      forceBlank();
      requestAnimationFrame(() => {
        if (myToken !== resetToken) return;
        forceBlank();
      });
    });

    const select = $('loadout-hauling-job');
    if (select) {
      observer = new MutationObserver(() => {
        if (myToken !== resetToken) return;
        forceBlank();
      });
      observer.observe(select, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['selected']
      });
    }

    [40, 100, 180, 300, 500, 800].forEach(ms => {
      setTimeout(() => {
        if (myToken !== resetToken) return;
        forceBlank();
      }, ms);
    });

    stopTimer = setTimeout(() => {
      if (myToken !== resetToken) return;
      stopGuard();
    }, 1000);
  }

  document.addEventListener('change', event => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    if (target.id === 'loadout-driver' || target.id === 'loadout-subdriver') {
      beginGuard();
    }
  }, true);

  // Closing/reopening the modal must never leave a stale guard active.
  document.addEventListener('click', event => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    if (target.closest('#loadout-close, #loadout-cancel')) {
      stopGuard();
    }
  }, true);
})();
