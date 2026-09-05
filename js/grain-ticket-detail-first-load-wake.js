/* FarmVista — Ticket Details portrait first-load wake, Sept 5 2026 */
(() => {
  'use strict';

  const path = String(location.pathname || '').toLowerCase();
  if (!path.endsWith('/pages/grain/grain-ticket-detail.html')) return;
  if (window.__FV_TICKET_DETAIL_FIRST_LOAD_WAKE_V2_20260905) return;
  window.__FV_TICKET_DETAIL_FIRST_LOAD_WAKE_V2_20260905 = true;

  const isPortraitPhone = () =>
    matchMedia('(orientation:portrait)').matches &&
    (matchMedia('(pointer:coarse)').matches || innerWidth <= 700);

  function boot() {
    const wrap = document.getElementById('ticketImageWrap');
    const stage = document.getElementById('ticketImageStage');
    const source = document.getElementById('ticketImage');
    if (!wrap || !stage || !source) return;

    let timer = 0;
    let attempts = 0;
    let finished = false;

    function sourceUrl() {
      return source.currentSrc || source.getAttribute('src') || source.src || '';
    }

    function findMobilePhoto() {
      return stage.querySelector('.fv-mobile-ticket-photo');
    }

    function ready() {
      const photo = findMobilePhoto();
      return Boolean(
        isPortraitPhone() &&
        sourceUrl() &&
        !source.hidden &&
        source.naturalWidth > 0 &&
        source.naturalHeight > 0 &&
        wrap.clientWidth >= 100 &&
        wrap.clientHeight >= 300 &&
        photo &&
        photo.naturalWidth > 0 &&
        photo.naturalHeight > 0
      );
    }

    function forcePortraitFit() {
      if (!ready()) return false;

      const photo = findMobilePhoto();
      if (!photo) return false;

      /*
        The main mobile viewer already owns zoom/pan. This helper only fixes
        its FIRST portrait frame. Safari can finish the page/image before the
        viewer's own fit runs, leaving the photo off-canvas until a rotate or
        resize happens.

        Force the stage to exactly match the visible black viewer, then fit
        the EXISTING mobile photo to that box and center it. No second image
        layer is created, so pinch zoom and one-finger pan continue to be
        handled by the normal viewer after this one-time startup correction.
      */
      wrap.classList.add('fv-phone-viewer');

      stage.style.setProperty('position', 'absolute', 'important');
      stage.style.setProperty('inset', '0', 'important');
      stage.style.setProperty('width', '100%', 'important');
      stage.style.setProperty('height', '100%', 'important');
      stage.style.setProperty('min-width', '0', 'important');
      stage.style.setProperty('min-height', '0', 'important');

      photo.style.setProperty('left', '50%', 'important');
      photo.style.setProperty('top', '50%', 'important');

      const availableWidth = Math.max(1, wrap.clientWidth - 18);
      const availableHeight = Math.max(1, wrap.clientHeight - 18);
      const fit = Math.min(
        availableWidth / photo.naturalWidth,
        availableHeight / photo.naturalHeight
      );

      const fittedWidth = photo.naturalWidth * fit;
      const fittedHeight = photo.naturalHeight * fit;

      photo.style.width = `${fittedWidth}px`;
      photo.style.height = `${fittedHeight}px`;
      photo.style.transform = 'translate(-50%, -50%) translate(0px, 0px) rotate(0deg) scale(1)';

      /* Clear any stale native scroll position from the original image stage. */
      wrap.scrollLeft = 0;
      wrap.scrollTop = 0;

      finished = true;
      return true;
    }

    function check() {
      if (finished || !isPortraitPhone()) return;
      attempts += 1;

      if (forcePortraitFit()) {
        /* One final layout pass catches Safari changing toolbar/viewport size
           immediately after paint, but does not stay around to fight zoom. */
        requestAnimationFrame(() => {
          requestAnimationFrame(() => forcePortraitFit());
        });
        return;
      }

      if (attempts < 120) {
        timer = setTimeout(check, 50);
      }
    }

    function restart() {
      if (!isPortraitPhone()) return;
      clearTimeout(timer);
      attempts = 0;
      finished = false;
      check();
    }

    source.addEventListener('load', restart, { passive:true });

    new MutationObserver(restart).observe(source, {
      attributes:true,
      attributeFilter:['src','hidden']
    });

    if ('ResizeObserver' in window) {
      const ro = new ResizeObserver(() => {
        if (!finished) restart();
      });
      ro.observe(wrap);
    }

    window.addEventListener('pageshow', restart, { passive:true });
    restart();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once:true });
  } else {
    boot();
  }
})();
