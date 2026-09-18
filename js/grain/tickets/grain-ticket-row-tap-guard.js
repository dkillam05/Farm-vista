/* FarmVista — Grain Tickets table deliberate-tap guard, Sept 5 2026 */
(() => {
  'use strict';

  const path = String(location.pathname || '').toLowerCase();
  if (!path.endsWith('/pages/grain/grain-ticket.html')) return;
  if (window.__FV_GRAIN_TICKET_ROW_TAP_GUARD_20260905) return;
  window.__FV_GRAIN_TICKET_ROW_TAP_GUARD_20260905 = true;

  const coarse = () => matchMedia('(pointer:coarse)').matches;
  let startX = 0;
  let startY = 0;
  let moved = false;
  let activeRow = null;
  let lastMovedAt = 0;

  function rowFrom(target) {
    const row = target?.closest?.('tbody tr');
    if (!row) return null;

    /* Only guard rows that behave like navigation rows. Leave buttons,
       links, selects, inputs, and modal/table controls alone. */
    if (target.closest('button,a,input,select,textarea,label')) return null;
    return row;
  }

  document.addEventListener('touchstart', event => {
    if (!coarse() || event.touches.length !== 1) return;
    const row = rowFrom(event.target);
    if (!row) {
      activeRow = null;
      return;
    }

    const touch = event.touches[0];
    activeRow = row;
    startX = touch.clientX;
    startY = touch.clientY;
    moved = false;
  }, { capture:true, passive:true });

  document.addEventListener('touchmove', event => {
    if (!activeRow || event.touches.length !== 1) return;
    const touch = event.touches[0];
    const distance = Math.hypot(touch.clientX - startX, touch.clientY - startY);

    /* Require a genuinely deliberate tap. Small finger wobble is fine,
       but any real scroll/swipe should never open Ticket Details. */
    if (distance > 12) {
      moved = true;
      lastMovedAt = Date.now();
    }
  }, { capture:true, passive:true });

  document.addEventListener('touchend', () => {
    if (moved) lastMovedAt = Date.now();
    setTimeout(() => {
      activeRow = null;
      moved = false;
    }, 0);
  }, { capture:true, passive:true });

  document.addEventListener('click', event => {
    if (!coarse()) return;
    const row = rowFrom(event.target);
    if (!row) return;

    if (moved || (Date.now() - lastMovedAt) < 350) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
})();
