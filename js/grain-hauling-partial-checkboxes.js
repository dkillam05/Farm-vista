/* FarmVista — hauling split portion checkbox styling
   Sept. 12, 2026

   Keeps JOB FILL / SPOT PORTION / UNASSIGNED PORTION tiles visually consistent
   with normal grain-ticket cards by giving each partial tile the same checkbox
   treatment. This helper is intentionally presentation-only and does not change
   hauling allocation, DND, dropdown, or accounting behavior.
*/
(() => {
  'use strict';

  if (window.__FV_HAULING_PARTIAL_CHECKBOXES_20260912_V1) return;
  window.__FV_HAULING_PARTIAL_CHECKBOXES_20260912_V1 = true;

  if (!String(location.pathname || '').toLowerCase().endsWith('/pages/grain/grain-contracts.html')) return;

  const STYLE_ID = 'fv-hauling-partial-checkbox-style-v1';

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .fv-hauling-partial-tile{
        display:grid !important;
        grid-template-columns:auto minmax(0,1fr) !important;
        align-items:start !important;
        column-gap:10px !important;
      }
      .fv-hauling-partial-tile > .fv-hauling-partial-select{
        grid-column:1 !important;
        grid-row:1 / span 5 !important;
        margin:2px 0 0 0 !important;
        cursor:pointer !important;
      }
      .fv-hauling-partial-tile > :not(.fv-hauling-partial-select){
        grid-column:2 !important;
      }
      .fv-hauling-partial-tile.fv-partial-selected{
        outline:1px solid rgba(59,126,70,.45);
        outline-offset:-1px;
      }
    `;
    document.head.appendChild(style);
  }

  function decorate(root = document) {
    installStyle();
    root.querySelectorAll?.('.fv-hauling-partial-tile[data-fv-hauling-partial="1"]').forEach(tile => {
      if (tile.querySelector(':scope > .fv-hauling-partial-select')) return;

      const box = document.createElement('input');
      box.type = 'checkbox';
      box.className = 'fv-ticket-select fv-hauling-partial-select';
      box.draggable = false;
      box.setAttribute('aria-label', `Select ${tile.dataset.portionType || 'ticket'} portion`);

      box.addEventListener('pointerdown', event => event.stopPropagation());
      box.addEventListener('dragstart', event => event.preventDefault());
      box.addEventListener('change', () => {
        tile.classList.toggle('fv-partial-selected', box.checked);
      });

      tile.prepend(box);
    });
  }

  const roots = [
    document.getElementById('fv-ticket-status-job-list'),
    document.getElementById('fv-unassigned-ticket-list')
  ].filter(Boolean);

  roots.forEach(root => {
    decorate(root);
    new MutationObserver(records => {
      const added = records.some(record => record.addedNodes?.length);
      if (added) queueMicrotask(() => decorate(root));
    }).observe(root, { childList:true, subtree:true });
  });

  if (!roots.length) {
    const timer = setInterval(() => {
      const right = document.getElementById('fv-ticket-status-job-list');
      const left = document.getElementById('fv-unassigned-ticket-list');
      if (!right && !left) return;
      clearInterval(timer);
      [right,left].filter(Boolean).forEach(root => {
        decorate(root);
        new MutationObserver(records => {
          const added = records.some(record => record.addedNodes?.length);
          if (added) queueMicrotask(() => decorate(root));
        }).observe(root, { childList:true, subtree:true });
      });
    },100);
  }
})();