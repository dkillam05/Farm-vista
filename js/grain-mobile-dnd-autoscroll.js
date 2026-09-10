// FarmVista — mobile drag/drop edge auto-scroll
// Sept. 10, 2026
//
// Keeps long-press drag/drop usable on phones/tablets by scrolling the page
// when the held item is moved near the top or bottom edge of the viewport.
// Works with the existing Grain Contracts ticket DND and Hauling Jobs /
// Contract Planning DND without changing their assignment/drop logic.

(() => {
  'use strict';

  if (window.__FV_GRAIN_MOBILE_DND_AUTOSCROLL_20260910) return;
  window.__FV_GRAIN_MOBILE_DND_AUTOSCROLL_20260910 = true;

  const EDGE_PX = 110;
  const MAX_SPEED_PX = 22;
  const MIN_SPEED_PX = 4;

  let lastClientX = 0;
  let lastClientY = 0;
  let frame = 0;
  let active = false;

  function coarsePointer() {
    return window.matchMedia?.('(pointer: coarse)').matches ||
      navigator.maxTouchPoints > 0;
  }

  function draggingNow() {
    return !!document.querySelector(
      '.hauling-contract-card.dragging,' +
      '.hauling-linked-contract-item.dragging,' +
      '.ticket-card.dragging,' +
      '[data-hauling-contract-id].dragging,' +
      '[data-ticket-id].dragging'
    );
  }

  function scrollSpeed(clientY) {
    const height = window.innerHeight || document.documentElement.clientHeight || 0;
    if (!height) return 0;

    if (clientY < EDGE_PX) {
      const strength = Math.min(1, Math.max(0, (EDGE_PX - clientY) / EDGE_PX));
      return -(MIN_SPEED_PX + (MAX_SPEED_PX - MIN_SPEED_PX) * strength);
    }

    if (clientY > height - EDGE_PX) {
      const strength = Math.min(
        1,
        Math.max(0, (clientY - (height - EDGE_PX)) / EDGE_PX)
      );
      return MIN_SPEED_PX + (MAX_SPEED_PX - MIN_SPEED_PX) * strength;
    }

    return 0;
  }

  function refreshDropTarget() {
    // The core touch DND handlers already update their target on pointermove.
    // During auto-scroll the finger can stay still while content moves beneath
    // it, so synthesize one pointermove to make the existing handler recalc the
    // drop target at the finger's current viewport position.
    const source = document.querySelector(
      '.hauling-contract-card.dragging,' +
      '.hauling-linked-contract-item.dragging,' +
      '.ticket-card.dragging,' +
      '[data-hauling-contract-id].dragging,' +
      '[data-ticket-id].dragging'
    );

    if (!source) return;

    try {
      source.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        cancelable: true,
        pointerType: 'touch',
        clientX: lastClientX,
        clientY: lastClientY
      }));
    } catch (_) {
      // Older iOS builds can reject constructed PointerEvents. Scrolling still
      // works; the user's next real finger movement refreshes the drop target.
    }
  }

  function tick() {
    frame = 0;

    if (!active || !draggingNow()) {
      active = false;
      return;
    }

    const speed = scrollSpeed(lastClientY);
    if (speed) {
      const before = window.scrollY;
      window.scrollBy(0, speed);
      if (window.scrollY !== before) {
        refreshDropTarget();
      }
    }

    frame = requestAnimationFrame(tick);
  }

  function start(clientX, clientY) {
    if (!coarsePointer() || !draggingNow()) return;

    lastClientX = clientX;
    lastClientY = clientY;
    active = true;

    if (!frame) frame = requestAnimationFrame(tick);
  }

  function stop() {
    active = false;
    if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  }

  document.addEventListener('pointermove', event => {
    if (event.pointerType === 'mouse') return;
    start(event.clientX, event.clientY);
  }, { passive: true, capture: true });

  document.addEventListener('touchmove', event => {
    const touch = event.touches?.[0];
    if (!touch) return;
    start(touch.clientX, touch.clientY);
  }, { passive: true, capture: true });

  document.addEventListener('dragover', event => {
    if (!coarsePointer()) return;
    start(event.clientX, event.clientY);
  }, { passive: true, capture: true });

  ['pointerup', 'pointercancel', 'touchend', 'touchcancel', 'drop', 'dragend'].forEach(type => {
    document.addEventListener(type, stop, { passive: true, capture: true });
  });

  window.addEventListener('blur', stop, { passive: true });
})();
