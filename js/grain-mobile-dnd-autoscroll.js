// FarmVista — mobile drag/drop edge auto-scroll v3
// Sept. 10, 2026
//
// iPhone/PWA-safe edge auto-scroll for the Grain Contracts hauling-job and
// ticket drag/drop workspaces. v3 deliberately starts bottom auto-scroll much
// earlier on a phone so the user does not have to drag into the fixed footer
// or almost off-screen before the page begins moving.

(() => {
  'use strict';

  if (window.__FV_GRAIN_MOBILE_DND_AUTOSCROLL_20260910_V3) return;
  window.__FV_GRAIN_MOBILE_DND_AUTOSCROLL_20260910_V3 = true;

  const TOP_EDGE_PX = 180;
  const BOTTOM_EDGE_MIN_PX = 260;
  const BOTTOM_EDGE_RATIO = 0.40;
  const MIN_SPEED_PX = 10;
  const MAX_SPEED_PX = 52;

  const DRAG_SELECTOR = [
    '.hauling-contract-card.dragging',
    '.hauling-linked-contract-item.dragging',
    '.ticket-card.dragging',
    '[data-hauling-contract-id].dragging',
    '[data-ticket-id].dragging'
  ].join(',');

  let lastClientX = 0;
  let lastClientY = 0;
  let havePointer = false;
  let frame = 0;

  function dragSource() {
    return document.querySelector(DRAG_SELECTOR);
  }

  function viewportHeight() {
    return window.visualViewport?.height ||
      window.innerHeight ||
      document.documentElement.clientHeight ||
      0;
  }

  function bottomEdgePx(height) {
    // On short landscape phone screens, 135px was still forcing the user's
    // finger almost into the footer. Start scrolling through roughly the lower
    // 40% of the usable viewport, with a generous minimum zone.
    return Math.min(
      Math.max(BOTTOM_EDGE_MIN_PX, height * BOTTOM_EDGE_RATIO),
      Math.max(BOTTOM_EDGE_MIN_PX, height - TOP_EDGE_PX - 80)
    );
  }

  function easedSpeed(strength) {
    const s = Math.min(1, Math.max(0, strength));
    // Slightly aggressive curve so movement is obvious as soon as the user
    // enters the zone, while still accelerating toward the edge.
    const eased = Math.sqrt(s);
    return MIN_SPEED_PX + (MAX_SPEED_PX - MIN_SPEED_PX) * eased;
  }

  function edgeSpeed() {
    if (!havePointer) return 0;

    const height = viewportHeight();
    if (!height) return 0;

    if (lastClientY < TOP_EDGE_PX) {
      const strength = (TOP_EDGE_PX - lastClientY) / TOP_EDGE_PX;
      return -easedSpeed(strength);
    }

    const bottomZone = bottomEdgePx(height);
    const bottomStart = height - bottomZone;

    if (lastClientY > bottomStart) {
      const strength = (lastClientY - bottomStart) / bottomZone;
      return easedSpeed(strength);
    }

    return 0;
  }

  function canScroll(element, direction) {
    if (!element) return false;

    const max = element.scrollHeight - element.clientHeight;
    if (max <= 1) return false;

    return direction < 0
      ? element.scrollTop > 0
      : element.scrollTop < max - 1;
  }

  function scrollableAncestor(start, direction) {
    let element = start instanceof Element ? start : null;

    while (
      element &&
      element !== document.body &&
      element !== document.documentElement
    ) {
      const style = window.getComputedStyle(element);

      if (
        /(auto|scroll|overlay)/.test(style.overflowY) &&
        canScroll(element, direction)
      ) {
        return element;
      }

      element = element.parentElement;
    }

    const root = document.scrollingElement || document.documentElement;
    return canScroll(root, direction) ? root : null;
  }

  function elementUnderFinger() {
    const height = viewportHeight();
    const x = Math.max(1, Math.min(lastClientX, Math.max(1, window.innerWidth - 1)));
    const y = Math.max(1, Math.min(lastClientY, Math.max(1, height - 1)));

    return document.elementFromPoint(x, y);
  }

  function scrollTarget(direction) {
    return scrollableAncestor(elementUnderFinger(), direction) ||
      scrollableAncestor(dragSource(), direction);
  }

  function refreshCoreDropTarget() {
    const source = dragSource();
    if (!source) return;

    try {
      source.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          cancelable: true,
          pointerType: 'touch',
          clientX: lastClientX,
          clientY: lastClientY
        })
      );
    } catch (_) {
      // Older iOS versions may reject constructed PointerEvents. The next real
      // finger movement will still refresh the existing FarmVista drop target.
    }
  }

  function tick() {
    frame = 0;

    if (!dragSource()) return;

    const speed = edgeSpeed();

    if (speed) {
      const target = scrollTarget(speed);

      if (target) {
        const before = target.scrollTop;
        target.scrollTop += speed;

        if (target.scrollTop !== before) {
          refreshCoreDropTarget();
        }
      }
    }

    frame = requestAnimationFrame(tick);
  }

  function ensureRunning() {
    if (!frame && dragSource()) {
      frame = requestAnimationFrame(tick);
    }
  }

  function rememberPointer(clientX, clientY) {
    lastClientX = clientX;
    lastClientY = clientY;
    havePointer = true;
    ensureRunning();
  }

  function stop() {
    if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  }

  document.addEventListener(
    'pointerdown',
    event => {
      if (event.pointerType === 'mouse') return;
      rememberPointer(event.clientX, event.clientY);
    },
    { passive: true, capture: true }
  );

  document.addEventListener(
    'pointermove',
    event => {
      if (event.pointerType === 'mouse') return;
      rememberPointer(event.clientX, event.clientY);
    },
    { passive: true, capture: true }
  );

  document.addEventListener(
    'touchstart',
    event => {
      const touch = event.touches?.[0];
      if (touch) rememberPointer(touch.clientX, touch.clientY);
    },
    { passive: true, capture: true }
  );

  document.addEventListener(
    'touchmove',
    event => {
      const touch = event.touches?.[0];
      if (touch) rememberPointer(touch.clientX, touch.clientY);
    },
    { passive: true, capture: true }
  );

  // Core FarmVista DND adds .dragging only after the long-press delay. Watching
  // class changes starts auto-scroll even when the finger is already parked in
  // the lower zone and does not move again after activation.
  const observer = new MutationObserver(ensureRunning);
  observer.observe(document.documentElement, {
    subtree: true,
    attributes: true,
    attributeFilter: ['class']
  });

  [
    'pointerup',
    'pointercancel',
    'touchend',
    'touchcancel',
    'drop',
    'dragend'
  ].forEach(type => {
    document.addEventListener(type, stop, {
      passive: true,
      capture: true
    });
  });

  window.addEventListener('blur', stop, { passive: true });
})();
