/* FarmVista — Hauling Jobs rendered-count authority — Sept. 16, 2026
   The header count always reflects the hauling-job cards ACTUALLY rendered in
   the currently selected Job Status view. It does not count the Firestore pool,
   hidden jobs, or jobs from another status.
*/
(() => {
  'use strict';
  if (window.__FV_HAULING_RENDERED_COUNT_20260916_V2) return;
  window.__FV_HAULING_RENDERED_COUNT_20260916_V2 = true;
  if (!String(location.pathname || '').toLowerCase().endsWith('/pages/grain/grain-contracts.html')) return;

  const clean = value => String(value ?? '').trim();
  let queued = false;

  function activeJobList() {
    const mode = clean(document.getElementById('fv-ticket-job-status-filter')?.value) || 'matching';
    if (mode === 'matching') {
      return document.getElementById('fv-ticket-matching-job-list') || document.getElementById('fv-ticket-job-list');
    }
    return document.getElementById('fv-ticket-status-job-list');
  }

  function renderedCards(list) {
    if (!list || list.hidden) return [];
    return [...list.children].filter(el => {
      if (!(el instanceof HTMLElement)) return false;
      if (el.hidden) return false;
      if (getComputedStyle(el).display === 'none') return false;
      return el.matches('[data-fv-matching-job="1"], [data-fv-status-job="1"], [data-fv-ticket-job-id]');
    });
  }

  function sync() {
    queued = false;
    const countEl = document.getElementById('fv-ticket-job-count');
    if (!countEl) return;

    // Remove the temporary duplicate Matching Jobs counter from the previous fix.
    document.getElementById('fv-ticket-matching-job-count')?.remove();
    countEl.hidden = false;

    const list = activeJobList();
    if (!list) return;
    const count = renderedCards(list).length;
    const text = `${count} job${count === 1 ? '' : 's'}`;
    if (countEl.textContent !== text) countEl.textContent = text;
  }

  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(sync);
  }

  // Any DND renderer may rebuild a list or rewrite the legacy count. Recalculate
  // from the visible cards after that DOM change so the header and cards agree.
  const observer = new MutationObserver(records => {
    const relevant = records.some(record => {
      const target = record.target instanceof Element ? record.target : record.target?.parentElement;
      return target?.id === 'fv-ticket-job-count' ||
        target?.closest?.('#fv-ticket-job-list, #fv-ticket-matching-job-list, #fv-ticket-status-job-list, #fv-ticket-hauling-filterbar');
    });
    if (relevant) queue();
  });

  document.addEventListener('change', event => {
    if (['fv-ticket-job-status-filter','fv-ticket-filter-buyer','fv-ticket-filter-sold-under','fv-ticket-filter-crop'].includes(event.target?.id)) queue();
  }, true);
  document.addEventListener('click', event => {
    if (event.target?.closest?.('#fv-refresh-ticket-hauling, #fv-ticket-clear-filters')) queue();
  }, true);
  window.addEventListener('fv:hauling-effective-totals-updated', queue);

  function start() {
    observer.observe(document.body || document.documentElement, { childList:true, subtree:true, characterData:true });
    queue();
    setTimeout(queue, 250);
    setTimeout(queue, 750);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();
})();
