/* =====================================================================
   FarmVista — Ticket Details portrait first-load viewer fix
   Sept 5, 2026

   Portrait only. Horizontal behavior is intentionally untouched.
   - Waits for both image + real viewer dimensions before fitting.
   - Uses ResizeObserver so first-load Safari layout races self-correct.
   - Own touch surface for pinch zoom + one-finger pan.
   - Does not depend on the older desktop/touch image-stage handlers.
===================================================================== */
(() => {
  'use strict';

  const path = String(location.pathname || '').toLowerCase();
  if (!path.endsWith('/pages/grain/grain-ticket-detail.html')) return;
  if (window.__FV_TICKET_DETAIL_PORTRAIT_FIX_20260905) return;
  window.__FV_TICKET_DETAIL_PORTRAIT_FIX_20260905 = true;

  const $ = id => document.getElementById(id);
  const isPortraitPhone = () =>
    matchMedia('(orientation:portrait)').matches &&
    (matchMedia('(pointer:coarse)').matches || innerWidth <= 700);

  function boot() {
    const wrap = $('ticketImageWrap');
    const stage = $('ticketImageStage');
    const source = $('ticketImage');
    if (!wrap || !stage || !source) return;

    const style = document.createElement('style');
    style.id = 'fv-ticket-detail-portrait-fix-style';
    style.textContent = `
      .fv-portrait-ticket-photo,
      .fv-portrait-ticket-touch {
        display:none;
      }

      @media (max-width:700px) and (orientation:portrait) {
        #ticketImageWrap.fv-portrait-ready {
          position:relative !important;
          overflow:hidden !important;
          touch-action:none !important;
          overscroll-behavior:contain !important;
        }

        #ticketImageWrap.fv-portrait-ready #ticketImage,
        #ticketImageWrap.fv-portrait-ready .fv-mobile-ticket-photo {
          visibility:hidden !important;
          opacity:0 !important;
          pointer-events:none !important;
        }

        #ticketImageWrap .fv-portrait-ticket-photo {
          display:block;
          position:absolute;
          left:50%;
          top:50%;
          max-width:none !important;
          max-height:none !important;
          transform-origin:center center;
          user-select:none;
          -webkit-user-select:none;
          -webkit-user-drag:none;
          pointer-events:none;
          will-change:transform;
          z-index:3;
        }

        #ticketImageWrap .fv-portrait-ticket-touch {
          display:block;
          position:absolute;
          inset:0;
          z-index:4;
          touch-action:none;
          user-select:none;
          -webkit-user-select:none;
          background:transparent;
        }
      }
    `;
    document.head.appendChild(style);

    const photo = document.createElement('img');
    photo.className = 'fv-portrait-ticket-photo';
    photo.alt = 'Scanned grain ticket';
    photo.draggable = false;

    const touch = document.createElement('div');
    touch.className = 'fv-portrait-ticket-touch';
    touch.setAttribute('aria-label', 'Grain ticket image. Pinch to zoom and drag to move.');

    stage.appendChild(photo);
    wrap.appendChild(touch);

    let scale = 1;
    let x = 0;
    let y = 0;
    let baseWidth = 0;
    let baseHeight = 0;
    let pinchStartDistance = 0;
    let pinchStartScale = 1;
    let panning = false;
    let startX = 0;
    let startY = 0;
    let startPanX = 0;
    let startPanY = 0;
    let lastGoodWrapW = 0;
    let lastGoodWrapH = 0;
    let fitTimer = 0;

    const clampScale = value => Math.min(6, Math.max(1, value));

    function distance(touches) {
      if (!touches || touches.length < 2) return 0;
      return Math.hypot(
        touches[1].clientX - touches[0].clientX,
        touches[1].clientY - touches[0].clientY
      );
    }

    function bounds() {
      return {
        x: Math.max(0, (baseWidth * scale - wrap.clientWidth) / 2),
        y: Math.max(0, (baseHeight * scale - wrap.clientHeight) / 2)
      };
    }

    function applyTransform() {
      const b = bounds();
      x = Math.max(-b.x, Math.min(b.x, x));
      y = Math.max(-b.y, Math.min(b.y, y));
      photo.style.transform =
        `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${scale})`;
    }

    function fit(reset = true) {
      if (!isPortraitPhone()) {
        wrap.classList.remove('fv-portrait-ready');
        return false;
      }

      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (
        !photo.naturalWidth ||
        !photo.naturalHeight ||
        w < 100 ||
        h < 200
      ) {
        return false;
      }

      lastGoodWrapW = w;
      lastGoodWrapH = h;

      const availableW = Math.max(1, w - 18);
      const availableH = Math.max(1, h - 18);
      const fitScale = Math.min(
        availableW / photo.naturalWidth,
        availableH / photo.naturalHeight
      );

      baseWidth = photo.naturalWidth * fitScale;
      baseHeight = photo.naturalHeight * fitScale;
      photo.style.width = `${baseWidth}px`;
      photo.style.height = `${baseHeight}px`;

      if (reset) {
        scale = 1;
        x = 0;
        y = 0;
      }

      wrap.classList.add('fv-portrait-ready');
      applyTransform();
      return true;
    }

    function scheduleFit(reset = true, delay = 0) {
      clearTimeout(fitTimer);
      fitTimer = setTimeout(() => {
        if (fit(reset)) return;

        /* Safari sometimes finalizes the card dimensions after image load.
           Keep checking briefly until both image + real box size exist. */
        let tries = 0;
        const retry = () => {
          if (fit(reset)) return;
          tries += 1;
          if (tries < 40) requestAnimationFrame(retry);
        };
        requestAnimationFrame(retry);
      }, delay);
    }

    function syncSource() {
      const src = source.currentSrc || source.src || '';
      if (!src) return;

      if (photo.src !== src) {
        photo.src = src;
      } else if (photo.complete && photo.naturalWidth) {
        scheduleFit(true, 0);
      }
    }

    photo.addEventListener('load', () => {
      scheduleFit(true, 0);
      scheduleFit(true, 120);
      scheduleFit(true, 350);
    });

    source.addEventListener('load', syncSource);

    new MutationObserver(syncSource).observe(source, {
      attributes:true,
      attributeFilter:['src','hidden']
    });

    const ro = new ResizeObserver(entries => {
      if (!isPortraitPhone()) return;
      const rect = entries[0]?.contentRect;
      if (!rect || rect.width < 100 || rect.height < 200) return;

      const changed =
        Math.abs(rect.width - lastGoodWrapW) > 2 ||
        Math.abs(rect.height - lastGoodWrapH) > 2;

      if (changed) scheduleFit(true, 0);
    });
    ro.observe(wrap);

    touch.addEventListener('touchstart', event => {
      if (!isPortraitPhone() || !photo.naturalWidth) return;
      event.preventDefault();
      event.stopPropagation();

      if (event.touches.length === 2) {
        panning = false;
        pinchStartDistance = distance(event.touches);
        pinchStartScale = scale;
        return;
      }

      if (event.touches.length === 1) {
        const t = event.touches[0];
        panning = true;
        startX = t.clientX;
        startY = t.clientY;
        startPanX = x;
        startPanY = y;
      }
    }, { passive:false });

    touch.addEventListener('touchmove', event => {
      if (!isPortraitPhone() || !photo.naturalWidth) return;
      event.preventDefault();
      event.stopPropagation();

      if (event.touches.length === 2 && pinchStartDistance) {
        scale = clampScale(
          pinchStartScale * (distance(event.touches) / pinchStartDistance)
        );
        applyTransform();
        return;
      }

      if (event.touches.length === 1 && panning) {
        const t = event.touches[0];
        x = startPanX + (t.clientX - startX);
        y = startPanY + (t.clientY - startY);
        applyTransform();
      }
    }, { passive:false });

    touch.addEventListener('touchend', event => {
      event.stopPropagation();
      if (event.touches.length < 2) pinchStartDistance = 0;

      if (event.touches.length === 1) {
        const t = event.touches[0];
        panning = true;
        startX = t.clientX;
        startY = t.clientY;
        startPanX = x;
        startPanY = y;
      } else {
        panning = false;
      }
    }, { passive:true });

    touch.addEventListener('touchcancel', event => {
      event.stopPropagation();
      panning = false;
      pinchStartDistance = 0;
    }, { passive:true });

    /* The page's rotate buttons still control the native/landscape viewer.
       Portrait mirrors that visual intent with its own 90-degree rotation by
       swapping dimensions through a temporary CSS rotation is not needed here;
       re-fit after button use keeps the ticket centered. */
    $('rotateLeftBtn')?.addEventListener('click', () => scheduleFit(true, 60));
    $('rotateRightBtn')?.addEventListener('click', () => scheduleFit(true, 60));

    window.addEventListener('orientationchange', () => scheduleFit(true, 180), { passive:true });
    window.addEventListener('pageshow', () => {
      syncSource();
      scheduleFit(true, 60);
    }, { passive:true });

    syncSource();
    scheduleFit(true, 0);
    scheduleFit(true, 300);
    scheduleFit(true, 900);
    scheduleFit(true, 1800);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once:true });
  } else {
    boot();
  }
})();
