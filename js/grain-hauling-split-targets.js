/* FarmVista — split/spot portion target helper — Sept. 15, 2026
   A split/spot portion may be manually moved to another eligible hauling job,
   including a different Sold Under. When the clean Matching Jobs view is active,
   expose Active jobs before the drag begins so the proper target is available.
   Event-driven only: deliberately no MutationObserver or repaint loop.
*/
(() => {
  'use strict';
  if (window.__FV_HAULING_SPLIT_TARGETS_20260915) return;
  window.__FV_HAULING_SPLIT_TARGETS_20260915 = true;
  if (!String(location.pathname || '').toLowerCase().endsWith('/pages/grain/grain-contracts.html')) return;

  function exposeTargets(event) {
    const portion = event.target?.closest?.('.fv-hauling-partial-tile.unassigned, .fv-hauling-partial-tile.spot');
    if (!portion) return;

    const status = document.getElementById('fv-ticket-job-status-filter');
    if (!status || status.value !== 'matching') return;

    status.value = 'active';
    status.dispatchEvent(new Event('change', { bubbles: true }));

    const message = document.getElementById('fv-ticket-hauling-message');
    if (message) {
      message.textContent = 'Showing active hauling jobs for this split/spot portion. Destination and crop must match; Sold Under may be changed by the manual split override.';
      message.classList.add('ready');
    }
  }

  // pointerdown runs before the browser starts native drag, so targets are ready
  // without rebuilding the page continuously (the previous flashing problem).
  document.addEventListener('pointerdown', exposeTargets, true);
  document.addEventListener('mousedown', exposeTargets, true);
})();
