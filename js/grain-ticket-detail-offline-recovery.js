/* FarmVista — Grain Ticket Detail transient Firestore offline recovery
   One automatic retry only; prevents reload loops.

   Sept 11, 2026:
   Do NOT scan document.body.innerText from a broad MutationObserver. Ticket
   Detail changes many classes/values while populating, and the old observer
   repeatedly forced a full-page innerText layout/read on every mutation. That
   could monopolize the main thread and leave Ticket Detail apparently frozen.
*/
(() => {
  'use strict';
  if (window.__FV_TICKET_DETAIL_OFFLINE_RECOVERY_20260911) return;
  window.__FV_TICKET_DETAIL_OFFLINE_RECOVERY_20260911 = true;

  const OFFLINE_TEXT = 'failed to get document because the client is offline';
  const key = `fv:ticket-detail-offline-retry:${location.pathname}${location.search}`;
  let scheduled = false;
  let checkTimer = 0;

  function visibleText(el) {
    return String(el?.textContent || '').toLowerCase();
  }

  function hasOfflineFailure() {
    // Offline failures are rendered into Ticket Detail's message/error areas.
    // Read only those small nodes; never force a full-document innerText scan.
    const candidates = [
      document.getElementById('message'),
      document.getElementById('loadStatus'),
      document.getElementById('ticketError'),
      document.querySelector('.message.error'),
      document.querySelector('.error-message')
    ].filter(Boolean);

    return candidates.some(el => visibleText(el).includes(OFFLINE_TEXT));
  }

  function retryOnce() {
    if (scheduled || !hasOfflineFailure()) return;
    if (sessionStorage.getItem(key) === '1') return;
    scheduled = true;

    const perform = () => {
      if (sessionStorage.getItem(key) === '1') return;
      sessionStorage.setItem(key, '1');
      location.reload();
    };

    if (navigator.onLine) {
      setTimeout(perform, 1800);
    } else {
      window.addEventListener('online', () => setTimeout(perform, 500), { once: true });
    }
  }

  function clearGuardWhenHealthy() {
    const image = document.getElementById('ticketImage');
    const ticketNumber = document.getElementById('ticketNumber');
    const hasImage = Boolean(image?.currentSrc || image?.getAttribute('src'));
    const hasTicket = Boolean(String(ticketNumber?.value || '').trim());

    if ((hasImage || hasTicket) && !hasOfflineFailure()) {
      sessionStorage.removeItem(key);
    }
  }

  function observe() {
    retryOnce();
    clearGuardWhenHealthy();
  }

  function scheduleCheck() {
    if (checkTimer) return;
    checkTimer = window.setTimeout(() => {
      checkTimer = 0;
      observe();
    }, 250);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observe, { once: true });
  } else {
    observe();
  }

  // Observe only the small status nodes that can actually contain an offline
  // error. Do not observe documentElement or form/class/value churn.
  const attachObservers = () => {
    const nodes = [
      document.getElementById('message'),
      document.getElementById('loadStatus'),
      document.getElementById('ticketError')
    ].filter(Boolean);

    if (!nodes.length) return;

    const observer = new MutationObserver(scheduleCheck);
    nodes.forEach(node => observer.observe(node, {
      childList: true,
      subtree: true,
      characterData: true
    }));

    window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachObservers, { once: true });
  } else {
    attachObservers();
  }

  window.addEventListener('online', scheduleCheck, { passive: true });
})();
