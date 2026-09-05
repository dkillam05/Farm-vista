/* FarmVista — Ticket Details portrait first-load wake, Sept 5 2026 */
(() => {
  'use strict';

  const path = String(location.pathname || '').toLowerCase();
  if (!path.endsWith('/pages/grain/grain-ticket-detail.html')) return;
  if (window.__FV_TICKET_DETAIL_FIRST_LOAD_WAKE_20260905) return;
  window.__FV_TICKET_DETAIL_FIRST_LOAD_WAKE_20260905 = true;

  const isPortraitPhone = () =>
    matchMedia('(orientation:portrait)').matches &&
    (matchMedia('(pointer:coarse)').matches || innerWidth <= 700);

  function boot() {
    const wrap = document.getElementById('ticketImageWrap');
    const source = document.getElementById('ticketImage');
    if (!wrap || !source) return;

    let wokeForSrc = '';
    let timer = 0;

    function readyToWake() {
      const src = source.currentSrc || source.getAttribute('src') || source.src || '';
      return Boolean(
        isPortraitPhone() &&
        src &&
        !source.hidden &&
        source.naturalWidth > 0 &&
        source.naturalHeight > 0 &&
        wrap.clientWidth >= 100 &&
        wrap.clientHeight >= 200
      );
    }

    function wake() {
      if (!readyToWake()) return false;

      const src = source.currentSrc || source.getAttribute('src') || source.src || '';
      if (src === wokeForSrc) return true;
      wokeForSrc = src;

      /* The existing mobile viewer already refits correctly on a real resize.
         Fire one after image + layout are both genuinely ready instead of
         creating another image layer. */
      requestAnimationFrame(() => {
        window.dispatchEvent(new Event('resize'));
        setTimeout(() => window.dispatchEvent(new Event('resize')), 90);
      });

      return true;
    }

    function schedule() {
      clearTimeout(timer);
      let attempts = 0;

      const check = () => {
        attempts += 1;
        if (wake() || attempts >= 80) return;
        timer = setTimeout(check, 75);
      };

      check();
    }

    source.addEventListener('load', schedule, { passive:true });

    new MutationObserver(() => {
      wokeForSrc = '';
      schedule();
    }).observe(source, {
      attributes:true,
      attributeFilter:['src','hidden']
    });

    if ('ResizeObserver' in window) {
      new ResizeObserver(() => {
        if (!wokeForSrc) schedule();
      }).observe(wrap);
    }

    window.addEventListener('pageshow', schedule, { passive:true });
    schedule();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once:true });
  } else {
    boot();
  }
})();
