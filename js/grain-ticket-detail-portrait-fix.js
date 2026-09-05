/* FarmVista — Ticket Details portrait image viewer final fix, Sept 5 2026 */
(() => {
  'use strict';

  const path = String(location.pathname || '').toLowerCase();
  if (!path.endsWith('/pages/grain/grain-ticket-detail.html')) return;
  if (window.__FV_TICKET_DETAIL_PORTRAIT_FIX_20260905) return;
  window.__FV_TICKET_DETAIL_PORTRAIT_FIX_20260905 = true;

  const $ = id => document.getElementById(id);
  const isPortraitPhone = () =>
    matchMedia('(orientation: portrait)').matches &&
    (matchMedia('(pointer: coarse)').matches || innerWidth <= 700);

  function installStyles() {
    if ($('fv-ticket-detail-portrait-final-style')) return;
    const style = document.createElement('style');
    style.id = 'fv-ticket-detail-portrait-final-style';
    style.textContent = `
      @media (max-width:700px) and (orientation:portrait) {
        #ticketImageWrap {
          position:relative !important;
          overflow:hidden !important;
          touch-action:none !important;
          overscroll-behavior:contain !important;
        }

        #ticketImageWrap .fv-mobile-ticket-photo {
          display:none !important;
        }

        #fvPortraitTicketLayer {
          position:absolute;
          inset:0;
          z-index:20;
          overflow:hidden;
          touch-action:none;
          overscroll-behavior:contain;
          user-select:none;
          -webkit-user-select:none;
          background:transparent;
        }

        #fvPortraitTicketImage {
          position:absolute;
          left:50%;
          top:50%;
          display:block;
          max-width:none;
          max-height:none;
          transform-origin:center center;
          user-select:none;
          -webkit-user-select:none;
          -webkit-user-drag:none;
          pointer-events:none;
          will-change:transform;
        }
      }

      @media (orientation:landscape) {
        #fvPortraitTicketLayer { display:none !important; }
      }
    `;
    document.head.appendChild(style);
  }

  function setup() {
    const wrap = $('ticketImageWrap');
    const source = $('ticketImage');
    if (!wrap || !source) return;

    let layer = $('fvPortraitTicketLayer');
    let image = $('fvPortraitTicketImage');

    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'fvPortraitTicketLayer';
      wrap.appendChild(layer);
    }

    if (!image) {
      image = document.createElement('img');
      image.id = 'fvPortraitTicketImage';
      image.alt = 'Scanned grain ticket';
      image.draggable = false;
      layer.appendChild(image);
    }

    let scale = 1;
    let rotation = 0;
    let x = 0;
    let y = 0;
    let fittedWidth = 0;
    let fittedHeight = 0;
    let panning = false;
    let panStartX = 0;
    let panStartY = 0;
    let panOriginX = 0;
    let panOriginY = 0;
    let pinchStartDistance = 0;
    let pinchStartScale = 1;

    const clampScale = value => Math.min(6, Math.max(1, value));

    function distance(touches) {
      if (!touches || touches.length < 2) return 0;
      return Math.hypot(
        touches[1].clientX - touches[0].clientX,
        touches[1].clientY - touches[0].clientY
      );
    }

    function bounds() {
      const sideways = Math.abs(rotation % 180) === 90;
      const w = (sideways ? fittedHeight : fittedWidth) * scale;
      const h = (sideways ? fittedWidth : fittedHeight) * scale;
      return {
        x: Math.max(0, (w - layer.clientWidth) / 2),
        y: Math.max(0, (h - layer.clientHeight) / 2)
      };
    }

    function apply() {
      const b = bounds();
      x = Math.max(-b.x, Math.min(b.x, x));
      y = Math.max(-b.y, Math.min(b.y, y));
      image.style.transform =
        `translate(-50%, -50%) translate(${x}px, ${y}px) rotate(${rotation}deg) scale(${scale})`;
    }

    function fit(reset = true) {
      if (!isPortraitPhone() || !image.naturalWidth || !image.naturalHeight) return;
      if (!layer.clientWidth || !layer.clientHeight) {
        setTimeout(() => fit(reset), 80);
        return;
      }

      const sideways = Math.abs(rotation % 180) === 90;
      const sourceW = sideways ? image.naturalHeight : image.naturalWidth;
      const sourceH = sideways ? image.naturalWidth : image.naturalHeight;
      const availW = Math.max(1, layer.clientWidth - 18);
      const availH = Math.max(1, layer.clientHeight - 18);
      const ratio = Math.min(availW / sourceW, availH / sourceH);

      fittedWidth = image.naturalWidth * ratio;
      fittedHeight = image.naturalHeight * ratio;
      image.style.width = `${fittedWidth}px`;
      image.style.height = `${fittedHeight}px`;

      if (reset) {
        scale = 1;
        x = 0;
        y = 0;
      }
      apply();
    }

    function sourceUrl() {
      return source.currentSrc || source.getAttribute('src') || source.src || '';
    }

    function sync() {
      const src = sourceUrl();
      if (!src) return false;
      if (image.src !== src) image.src = src;
      layer.style.display = isPortraitPhone() ? 'block' : 'none';
      return true;
    }

    image.addEventListener('load', () => {
      layer.style.display = isPortraitPhone() ? 'block' : 'none';
      setTimeout(() => fit(true), 0);
      setTimeout(() => fit(true), 120);
    });

    source.addEventListener('load', () => {
      sync();
      setTimeout(() => fit(true), 80);
    });

    new MutationObserver(() => {
      if (sync()) setTimeout(() => fit(true), 80);
    }).observe(source, { attributes:true, attributeFilter:['src','hidden'] });

    /* Poll briefly because the ticket src is populated asynchronously after
       Firestore returns. This fixes first-load portrait without requiring an
       orientation change to trigger a resize. */
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      const found = sync();
      if (found && image.complete && image.naturalWidth) fit(true);
      if ((found && image.naturalWidth) || attempts >= 50) clearInterval(timer);
    }, 100);

    layer.addEventListener('touchstart', event => {
      if (!isPortraitPhone() || !image.naturalWidth) return;
      event.preventDefault();
      event.stopPropagation();

      if (event.touches.length === 2) {
        panning = false;
        pinchStartDistance = distance(event.touches);
        pinchStartScale = scale;
        return;
      }

      if (event.touches.length === 1) {
        const touch = event.touches[0];
        panning = true;
        panStartX = touch.clientX;
        panStartY = touch.clientY;
        panOriginX = x;
        panOriginY = y;
      }
    }, { passive:false });

    layer.addEventListener('touchmove', event => {
      if (!isPortraitPhone() || !image.naturalWidth) return;
      event.preventDefault();
      event.stopPropagation();

      if (event.touches.length === 2 && pinchStartDistance) {
        scale = clampScale(
          pinchStartScale * (distance(event.touches) / pinchStartDistance)
        );
        apply();
        return;
      }

      if (event.touches.length === 1 && panning) {
        const touch = event.touches[0];
        x = panOriginX + (touch.clientX - panStartX);
        y = panOriginY + (touch.clientY - panStartY);
        apply();
      }
    }, { passive:false });

    layer.addEventListener('touchend', event => {
      event.stopPropagation();
      if (event.touches.length < 2) pinchStartDistance = 0;
      if (event.touches.length === 1) {
        const touch = event.touches[0];
        panning = true;
        panStartX = touch.clientX;
        panStartY = touch.clientY;
        panOriginX = x;
        panOriginY = y;
      } else {
        panning = false;
      }
    }, { passive:true });

    layer.addEventListener('touchcancel', event => {
      event.stopPropagation();
      panning = false;
      pinchStartDistance = 0;
    }, { passive:true });

    $('rotateLeftBtn')?.addEventListener('click', () => {
      if (!isPortraitPhone()) return;
      rotation -= 90;
      setTimeout(() => fit(true), 0);
    });

    $('rotateRightBtn')?.addEventListener('click', () => {
      if (!isPortraitPhone()) return;
      rotation += 90;
      setTimeout(() => fit(true), 0);
    });

    let resizeTimer = 0;
    const refresh = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        layer.style.display = isPortraitPhone() ? 'block' : 'none';
        sync();
        if (isPortraitPhone()) fit(true);
      }, 180);
    };

    window.addEventListener('resize', refresh, { passive:true });
    window.addEventListener('orientationchange', refresh, { passive:true });

    sync();
    setTimeout(() => fit(true), 300);
    setTimeout(() => fit(true), 900);
  }

  function boot() {
    installStyles();
    setup();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once:true });
  } else {
    boot();
  }
})();
