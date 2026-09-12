/* FarmVista — Grain Contracts hauling DND left-column drop zone
   Sept. 12, 2026

   The core/status DND unassign handler is attached to #fv-unassigned-ticket-list.
   When the right hauling-job column is much taller than the left ticket list,
   the blank lower part of the left column was not a drop target. This helper
   makes the ENTIRE left column act like the existing Unassigned list without
   replacing or duplicating the actual unassign logic.
*/
(() => {
  'use strict';

  if (window.__FV_HAULING_LEFT_DROP_ZONE_20260912_V1) return;
  window.__FV_HAULING_LEFT_DROP_ZONE_20260912_V1 = true;

  if (!String(location.pathname || '').toLowerCase().endsWith('/pages/grain/grain-contracts.html')) return;

  const STYLE_ID = 'fv-hauling-left-drop-zone-style-v1';

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .fv-ticket-hauling-column.fv-left-column-drop-ready{position:relative}
      .fv-ticket-hauling-column.fv-left-column-drop-over{
        outline:2px solid #4f8f59;
        outline-offset:-2px;
        background:rgba(79,143,89,.06)
      }
      [data-theme="dark"] .fv-ticket-hauling-column.fv-left-column-drop-over{
        background:rgba(120,190,130,.08)
      }
    `;
    document.head.appendChild(style);
  }

  function parts() {
    const list = document.getElementById('fv-unassigned-ticket-list');
    const column = list?.closest?.('.fv-ticket-hauling-column');
    return { list, column };
  }

  function isWholeTicketDrag(event) {
    // Status DND writes comma-separated ticket ids to text/plain.
    // Split portions use FVPORTION:... and are intentionally handled by their
    // own partial-allocation DND logic instead of being mistaken for a whole ticket.
    let plain = '';
    try { plain = String(event.dataTransfer?.getData('text/plain') || ''); } catch (_) {}
    return !plain.startsWith('FVPORTION:');
  }

  function forwardDrop(event, list) {
    let forwarded;
    try {
      forwarded = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: event.dataTransfer
      });
    } catch (_) {
      forwarded = new Event('drop', { bubbles: true, cancelable: true });
      try { Object.defineProperty(forwarded, 'dataTransfer', { value: event.dataTransfer }); } catch (_) {}
    }
    list.dispatchEvent(forwarded);
  }

  function install() {
    installStyle();
    const { list, column } = parts();
    if (!list || !column || column.dataset.fvWholeColumnDrop === '1') return false;

    column.dataset.fvWholeColumnDrop = '1';
    column.classList.add('fv-left-column-drop-ready');

    column.addEventListener('dragover', event => {
      // If the pointer is already over the real list, let its native handler own it.
      if (event.target === list || list.contains(event.target)) return;
      if (!isWholeTicketDrag(event)) return;
      event.preventDefault();
      try { event.dataTransfer.dropEffect = 'move'; } catch (_) {}
      column.classList.add('fv-left-column-drop-over');
    }, true);

    column.addEventListener('dragleave', event => {
      if (event.relatedTarget && column.contains(event.relatedTarget)) return;
      column.classList.remove('fv-left-column-drop-over');
    }, true);

    column.addEventListener('drop', event => {
      if (event.target === list || list.contains(event.target)) return;
      if (!isWholeTicketDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      column.classList.remove('fv-left-column-drop-over');
      forwardDrop(event, list);
    }, true);

    document.addEventListener('dragend', () => column.classList.remove('fv-left-column-drop-over'), true);
    return true;
  }

  const timer = setInterval(() => {
    if (install()) clearInterval(timer);
  }, 100);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();