/* FarmVista — Matching Jobs visible count authority — Sept. 16, 2026
   In Matching Jobs mode, display the number of hauling-job cards actually
   rendered by grain-hauling-matching-controller.js. The legacy core count is
   hidden in this mode because the core renderer counts its broader job pool and
   may refresh after the matching renderer. Other status modes keep the legacy
   count unchanged.
*/
(() => {
  'use strict';
  if (window.__FV_HAULING_MATCHING_COUNT_20260916_V1) return;
  window.__FV_HAULING_MATCHING_COUNT_20260916_V1 = true;
  if (!String(location.pathname || '').toLowerCase().endsWith('/pages/grain/grain-contracts.html')) return;

  const clean = value => String(value ?? '').trim();
  let observer = null;
  let observedList = null;
  let queued = false;

  function isMatchingMode() {
    return clean(document.getElementById('fv-ticket-job-status-filter')?.value) === 'matching';
  }

  function matchingList() {
    return document.getElementById('fv-ticket-matching-job-list');
  }

  function renderedMatchingCount() {
    const list = matchingList();
    if (!list) return null;
    return list.querySelectorAll(':scope > [data-fv-matching-job="1"]').length;
  }

  function ensureAuthoritativeCount(legacy) {
    let count = document.getElementById('fv-ticket-matching-job-count');
    if (count) return count;

    count = document.createElement(legacy.tagName === 'SPAN' ? 'span' : 'div');
    count.id = 'fv-ticket-matching-job-count';
    count.className = legacy.className;
    count.setAttribute('aria-live', 'polite');
    count.textContent = 'Loading…';
    legacy.insertAdjacentElement('afterend', count);
    return count;
  }

  function sync() {
    queued = false;
    const legacy = document.getElementById('fv-ticket-job-count');
    if (!legacy) return;

    const authoritative = ensureAuthoritativeCount(legacy);
    const matching = isMatchingMode();

    if (!matching) {
      legacy.hidden = false;
      authoritative.hidden = true;
      return;
    }

    // Never show the core renderer's broader count while Matching Jobs owns the view.
    legacy.hidden = true;
    authoritative.hidden = false;

    const count = renderedMatchingCount();
    authoritative.textContent = count === null
      ? 'Loading…'
      : `${count} job${count === 1 ? '' : 's'}`;

    const list = matchingList();
    if (list && list !== observedList) {
      observer?.disconnect();
      observedList = list;
      observer = new MutationObserver(queue);
      observer.observe(list, { childList: true, subtree: false });
    }
  }

  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(sync);
  }

  document.addEventListener('change', event => {
    if (event.target?.id === 'fv-ticket-job-status-filter') queue();
  }, true);

  document.addEventListener('click', event => {
    if (event.target?.closest?.('#fv-refresh-ticket-hauling')) queue();
  }, true);

  // The matching list is created after the base DND UI, so watch only until it exists.
  const bootObserver = new MutationObserver(() => {
    queue();
    if (matchingList() && document.getElementById('fv-ticket-job-count')) bootObserver.disconnect();
  });

  function start() {
    bootObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });
    sync();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
