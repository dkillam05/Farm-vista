/* FarmVista — hauling split portion checkbox styling
   Sept. 12, 2026

   Keeps JOB FILL / SPOT PORTION / UNASSIGNED PORTION tiles visually consistent
   with normal grain-ticket cards by giving every partial tile the same checkbox
   treatment. Presentation-only: no allocation, totals, DND, or dropdown changes.
*/
(() => {
  'use strict';

  if (window.__FV_HAULING_PARTIAL_CHECKBOXES_20260912_V2) return;
  window.__FV_HAULING_PARTIAL_CHECKBOXES_20260912_V2 = true;

  if (!String(location.pathname || '').toLowerCase().endsWith('/pages/grain/grain-contracts.html')) return;

  const STYLE_ID = 'fv-hauling-partial-checkbox-style-v2';

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .fv-hauling-partial-tile{
        display:grid !important;
        grid-template-columns:20px minmax(0,1fr) !important;
        align-items:start !important;
        column-gap:10px !important;
      }
      .fv-hauling-partial-tile > .fv-hauling-partial-select{
        grid-column:1 !important;
        grid-row:1 / span 6 !important;
        width:16px !important;
        height:16px !important;
        margin:2px 0 0 0 !important;
        padding:0 !important;
        cursor:pointer !important;
        align-self:start !important;
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
    root.querySelectorAll?.('.fv-hauling-partial-tile').forEach(tile => {
      let box = tile.querySelector(':scope > .fv-hauling-partial-select');
      if (!box) {
        box = document.createElement('input');
        box.type = 'checkbox';
        box.className = 'fv-ticket-select fv-hauling-partial-select';
        box.draggable = false;
        box.setAttribute('aria-label', `Select ${tile.dataset.portionType || 'ticket'} portion`);

        box.addEventListener('pointerdown', event => event.stopPropagation());
        box.addEventListener('mousedown', event => event.stopPropagation());
        box.addEventListener('click', event => event.stopPropagation());
        box.addEventListener('dragstart', event => event.preventDefault());
        box.addEventListener('change', () => {
          tile.classList.toggle('fv-partial-selected', box.checked);
        });

        tile.prepend(box);
      }
    });
  }

  function decorateAll() {
    decorate(document);
  }

  installStyle();
  decorateAll();

  // The hauling DND renderer can synchronously rebuild its derived split tiles.
  // Keep the visual checkbox attached after any such rebuild. This only inspects
  // the small split-tile selector and never rewrites dropdowns or allocation data.
  const observer = new MutationObserver(records => {
    if (records.some(record => record.addedNodes?.length || record.removedNodes?.length)) {
      queueMicrotask(decorateAll);
    }
  });
  observer.observe(document.body, { childList:true, subtree:true });

  // Safety net for renderers that replace a hooked innerHTML tree in the same turn.
  // Idempotent: existing checkboxes are left untouched.
  setInterval(decorateAll, 500);
})();