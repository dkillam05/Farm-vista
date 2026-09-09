/* FarmVista — Grain Ticket Detail transient Firestore offline recovery
   One automatic retry only; prevents reload loops.
*/
(() => {
  'use strict';
  if (window.__FV_TICKET_DETAIL_OFFLINE_RECOVERY_20260909) return;
  window.__FV_TICKET_DETAIL_OFFLINE_RECOVERY_20260909 = true;

  const OFFLINE_TEXT = 'failed to get document because the client is offline';
  const key = `fv:ticket-detail-offline-retry:${location.pathname}${location.search}`;
  let scheduled = false;

  function hasOfflineFailure(){
    return String(document.body?.innerText || '').toLowerCase().includes(OFFLINE_TEXT);
  }

  function retryOnce(){
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
      window.addEventListener('online', () => setTimeout(perform, 500), {once:true});
    }
  }

  function clearGuardWhenHealthy(){
    const image = document.getElementById('ticketImage');
    const ticketNumber = document.getElementById('ticketNumber');
    const hasImage = Boolean(image?.currentSrc || image?.getAttribute('src'));
    const hasTicket = Boolean(String(ticketNumber?.value || '').trim());
    if ((hasImage || hasTicket) && !hasOfflineFailure()) {
      sessionStorage.removeItem(key);
    }
  }

  const observe = () => {
    retryOnce();
    clearGuardWhenHealthy();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observe, {once:true});
  } else {
    observe();
  }

  new MutationObserver(observe).observe(document.documentElement, {
    childList:true,
    subtree:true,
    characterData:true,
    attributes:true,
    attributeFilter:['src','value','class']
  });

  window.addEventListener('online', observe, {passive:true});
})();
