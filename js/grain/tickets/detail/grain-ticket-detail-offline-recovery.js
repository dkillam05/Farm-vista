/* FarmVista — Grain Ticket Detail transient Firestore offline recovery
   One automatic retry only; prevents reload loops.

   Sept 11, 2026:
   Do NOT scan document.body.innerText from a broad MutationObserver. Ticket
   Detail changes many classes/values while populating, and the old observer
   repeatedly forced a full-page innerText layout/read on every mutation. That
   could monopolize the main thread and leave Ticket Detail apparently frozen.

   Sept 11, 2026 — return navigation:
   Ticket Detail can be opened from Grain Tickets, Grain Inventory, Contracts,
   reports, and drill-downs. Back and a successful Save now return to the
   FarmVista page that opened the detail instead of always forcing Grain Tickets.
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

  /* ----------------------------------------------------------
     RETURN TO THE PAGE THAT OPENED TICKET DETAIL
  ---------------------------------------------------------- */
  const fallbackReturn = '/pages/grain/grain-ticket.html';
  let returnUrl = fallbackReturn;
  let returning = false;

  try {
    const referrer = document.referrer ? new URL(document.referrer) : null;
    const sameOrigin = referrer && referrer.origin === location.origin;
    const isThisDetail = sameOrigin &&
      referrer.pathname.toLowerCase().endsWith('/pages/grain/grain-ticket-detail.html');

    if (sameOrigin && !isThisDetail) {
      returnUrl = `${referrer.pathname}${referrer.search}${referrer.hash}`;
    }
  } catch (_) {
    returnUrl = fallbackReturn;
  }

  function returnToSource() {
    if (returning) return;
    returning = true;

    if (returnUrl && returnUrl !== fallbackReturn) {
      location.href = returnUrl;
      return;
    }

    // If the browser has a real previous FarmVista entry but referrer was
    // unavailable (some PWA/browser launches), history is the next best truth.
    if (history.length > 1) {
      history.back();
      return;
    }

    location.href = fallbackReturn;
  }

  function attachReturnNavigation() {
    const backBtn = document.getElementById('backBtn');
    if (backBtn) {
      backBtn.addEventListener('click', event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        returnToSource();
      }, true);
    }

    const message = document.getElementById('message');
    if (!message) return;

    const checkSaved = () => {
      const text = String(message.textContent || '').trim().toLowerCase();
      if (
        text.startsWith('ticket saved and verified.') ||
        text.startsWith('ticket saved. it will stay under needs review')
      ) {
        returnToSource();
      }
    };

    const saveObserver = new MutationObserver(checkSaved);
    saveObserver.observe(message, {
      childList: true,
      subtree: true,
      characterData: true
    });
    window.addEventListener('pagehide', () => saveObserver.disconnect(), { once: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observe, { once: true });
    document.addEventListener('DOMContentLoaded', attachReturnNavigation, { once: true });
  } else {
    observe();
    attachReturnNavigation();
  }

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
