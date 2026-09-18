/* =====================================================================
   FarmVista — Grain Inventory Ticket Image Zoom/Pan
   Sept 5, 2026

   Adds photo-viewer style interaction to the saved ticket image modal:
     - desktop mouse-wheel zoom
     - desktop click + drag pan while zoomed
     - phone/tablet pinch-to-zoom
     - phone/tablet one-finger drag pan while zoomed

   This helper is intentionally limited to the Grain Inventory ticket image
   modal and does not alter ticket data, modal navigation, or image URLs.
===================================================================== */

(function () {
  'use strict';

  if (window.__FV_GRAIN_INVENTORY_TICKET_ZOOM_20260905) return;
  window.__FV_GRAIN_INVENTORY_TICKET_ZOOM_20260905 = true;

  const MIN_SCALE = 1;
  const MAX_SCALE = 6;

  function init() {
    const backdrop = document.getElementById('ticket-image-modal-backdrop');
    const image = document.getElementById('ticket-image-modal-img');
    if (!backdrop || !image) return false;

    const viewport = image.closest('.ticket-image-modal-body');
    if (!viewport) return false;

    const style = document.createElement('style');
    style.id = 'fv-grain-inventory-ticket-zoom-style';
    style.textContent = `
      #ticket-image-modal-backdrop .ticket-image-modal-body {
        position: relative !important;
        overflow: hidden !important;
        touch-action: none !important;
        overscroll-behavior: contain !important;
        user-select: none !important;
        -webkit-user-select: none !important;
      }

      #ticket-image-modal-backdrop .ticket-image-modal-img {
        transform-origin: center center !important;
        will-change: transform;
        user-select: none !important;
        -webkit-user-select: none !important;
        -webkit-user-drag: none !important;
      }

      #ticket-image-modal-backdrop .ticket-image-modal-body.fv-ticket-can-pan {
        cursor: grab !important;
      }

      #ticket-image-modal-backdrop .ticket-image-modal-body.fv-ticket-panning {
        cursor: grabbing !important;
      }
    `;
    document.head.appendChild(style);

    let scale = 1;
    let panX = 0;
    let panY = 0;
    let dragStart = null;
    let pinchStart = null;
    const pointers = new Map();

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

    function boundsFor(nextScale = scale) {
      const viewRect = viewport.getBoundingClientRect();
      const imgRect = image.getBoundingClientRect();
      const baseWidth = imgRect.width / (scale || 1);
      const baseHeight = imgRect.height / (scale || 1);
      const scaledWidth = baseWidth * nextScale;
      const scaledHeight = baseHeight * nextScale;

      return {
        x: Math.max(0, (scaledWidth - viewRect.width) / 2),
        y: Math.max(0, (scaledHeight - viewRect.height) / 2)
      };
    }

    function constrainPan() {
      if (scale <= 1) {
        panX = 0;
        panY = 0;
        return;
      }

      const bounds = boundsFor(scale);
      panX = clamp(panX, -bounds.x, bounds.x);
      panY = clamp(panY, -bounds.y, bounds.y);
    }

    function render() {
      constrainPan();
      image.style.transform = `translate3d(${panX}px, ${panY}px, 0) scale(${scale})`;
      viewport.classList.toggle('fv-ticket-can-pan', scale > 1.001);
      if (scale <= 1.001) viewport.classList.remove('fv-ticket-panning');
    }

    function reset() {
      scale = 1;
      panX = 0;
      panY = 0;
      dragStart = null;
      pinchStart = null;
      pointers.clear();
      viewport.classList.remove('fv-ticket-panning');
      render();
    }

    function zoomAt(clientX, clientY, nextScale) {
      nextScale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
      if (Math.abs(nextScale - scale) < 0.0001) return;

      const rect = viewport.getBoundingClientRect();
      const focusX = clientX - (rect.left + rect.width / 2);
      const focusY = clientY - (rect.top + rect.height / 2);
      const ratio = nextScale / scale;

      panX = focusX - ratio * (focusX - panX);
      panY = focusY - ratio * (focusY - panY);
      scale = nextScale;
      render();
    }

    viewport.addEventListener('wheel', (event) => {
      if (!backdrop.classList.contains('open')) return;
      event.preventDefault();

      const factor = Math.exp(-event.deltaY * 0.0018);
      zoomAt(event.clientX, event.clientY, scale * factor);
    }, { passive: false });

    viewport.addEventListener('pointerdown', (event) => {
      if (!backdrop.classList.contains('open')) return;

      pointers.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
        type: event.pointerType
      });

      try { viewport.setPointerCapture(event.pointerId); } catch (_) {}

      if (pointers.size === 1 && scale > 1.001) {
        dragStart = {
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          panX,
          panY
        };
        viewport.classList.add('fv-ticket-panning');
      } else if (pointers.size === 2) {
        const pts = Array.from(pointers.values());
        const dx = pts[1].x - pts[0].x;
        const dy = pts[1].y - pts[0].y;
        pinchStart = {
          distance: Math.hypot(dx, dy) || 1,
          scale,
          panX,
          panY,
          midX: (pts[0].x + pts[1].x) / 2,
          midY: (pts[0].y + pts[1].y) / 2
        };
        dragStart = null;
        viewport.classList.add('fv-ticket-panning');
      }
    });

    viewport.addEventListener('pointermove', (event) => {
      if (!pointers.has(event.pointerId)) return;

      pointers.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
        type: event.pointerType
      });

      if (pointers.size >= 2 && pinchStart) {
        event.preventDefault();
        const pts = Array.from(pointers.values()).slice(0, 2);
        const dx = pts[1].x - pts[0].x;
        const dy = pts[1].y - pts[0].y;
        const distance = Math.hypot(dx, dy) || 1;
        const nextScale = clamp(
          pinchStart.scale * (distance / pinchStart.distance),
          MIN_SCALE,
          MAX_SCALE
        );

        const currentMidX = (pts[0].x + pts[1].x) / 2;
        const currentMidY = (pts[0].y + pts[1].y) / 2;
        const rect = viewport.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const startFocusX = pinchStart.midX - centerX;
        const startFocusY = pinchStart.midY - centerY;
        const currentFocusX = currentMidX - centerX;
        const currentFocusY = currentMidY - centerY;
        const ratio = nextScale / pinchStart.scale;

        panX = currentFocusX - ratio * (startFocusX - pinchStart.panX);
        panY = currentFocusY - ratio * (startFocusY - pinchStart.panY);
        scale = nextScale;
        render();
        return;
      }

      if (
        dragStart &&
        dragStart.pointerId === event.pointerId &&
        scale > 1.001
      ) {
        event.preventDefault();
        panX = dragStart.panX + (event.clientX - dragStart.x);
        panY = dragStart.panY + (event.clientY - dragStart.y);
        render();
      }
    }, { passive: false });

    function releasePointer(event) {
      pointers.delete(event.pointerId);

      if (pointers.size < 2) pinchStart = null;

      if (pointers.size === 1 && scale > 1.001) {
        const [pointerId, point] = Array.from(pointers.entries())[0];
        dragStart = {
          pointerId,
          x: point.x,
          y: point.y,
          panX,
          panY
        };
      } else if (pointers.size === 0) {
        dragStart = null;
        viewport.classList.remove('fv-ticket-panning');
      }

      if (scale <= 1.001) reset();
    }

    viewport.addEventListener('pointerup', releasePointer);
    viewport.addEventListener('pointercancel', releasePointer);
    viewport.addEventListener('lostpointercapture', (event) => {
      if (pointers.has(event.pointerId)) releasePointer(event);
    });

    image.addEventListener('dragstart', (event) => event.preventDefault());
    image.addEventListener('load', reset);

    window.addEventListener('resize', render);

    const modalObserver = new MutationObserver(() => {
      if (backdrop.classList.contains('open')) reset();
    });
    modalObserver.observe(backdrop, { attributes: true, attributeFilter: ['class'] });

    reset();
    return true;
  }

  if (!init()) {
    const observer = new MutationObserver(() => {
      if (init()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
