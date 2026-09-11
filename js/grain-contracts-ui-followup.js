import "/js/fv-combo.js";

/* FarmVista — Grain Contracts UI follow-up
   Sept. 11, 2026

   - Keep the Grain Tickets -> Hauling Jobs filters on FarmVista custom combos.
   - Restore the contract-assignment filters to the same custom combo behavior.
   - In simple hauling mode, hide the misleading Uncontracted / Spot Tickets
     heading when there are no actual linked-contract groups.
*/
(() => {
  'use strict';

  if (window.__FV_GRAIN_CONTRACTS_UI_FOLLOWUP_20260911_V3) return;
  window.__FV_GRAIN_CONTRACTS_UI_FOLLOWUP_20260911_V3 = true;

  const clean = value => String(value ?? '').trim();
  const norm = value => clean(value).toLowerCase();

  function findWorkflowBlock(title) {
    const wanted = norm(title);
    return Array.from(document.querySelectorAll('.workflow-block')).find(block =>
      norm(block.querySelector('.workflow-block-title')?.textContent) === wanted
    ) || null;
  }

  function upgradeSelect(select) {
    if (!select) return;
    select.setAttribute('data-fv-combo', '');
    select.setAttribute('data-fv-search', 'false');
  }

  function upgradeAssignmentFilters() {
    // SIMPLE MODE: Assign Grain Tickets to Hauling Jobs.
    const haulingTicketBlock = findWorkflowBlock('Assign Grain Tickets to Hauling Jobs');
    haulingTicketBlock?.querySelectorAll('select').forEach(upgradeSelect);

    // DETAILED MODE: Assign Contracts to Hauling Jobs.
    [
      document.getElementById('hauling-link-buyer'),
      document.getElementById('hauling-link-customer'),
      document.getElementById('hauling-link-crop')
    ].forEach(upgradeSelect);

    // DETAILED MODE: Assign Grain Tickets to Contracts.
    [
      document.getElementById('reconcile-buyer'),
      document.getElementById('reconcile-customer')
    ].forEach(upgradeSelect);

    // Upgrade only after all attributes are in place. FVCombo preserves the
    // native selects/change events, so the existing filtering logic continues
    // to work while the visible control uses the rounded FarmVista dropdown.
    window.FVCombo?.upgrade?.(document);
  }

  function installSimplePopupStyles() {
    if (document.getElementById('fv-simple-hauling-popup-style')) return;

    const style = document.createElement('style');
    style.id = 'fv-simple-hauling-popup-style';
    style.textContent = `
      .fv-simple-only-job-group{
        border:0 !important;
        border-radius:0 !important;
        overflow:visible !important;
        background:transparent !important;
      }
      .fv-simple-only-job-group > .fv-job-contract-toggle{
        display:none !important;
      }
      .fv-simple-only-job-group > .fv-job-contract-body{
        background:transparent !important;
      }
    `;
    document.head.appendChild(style);
  }

  function normalizeSimpleHaulingPopup() {
    const modal = document.getElementById('fv-contract-hauling-overview');
    if (!modal?.classList.contains('open')) return;

    const list = modal.querySelector('#fv-contract-job-ticket-list');
    if (!list) return;

    const titles = Array.from(list.querySelectorAll('.fv-job-contract-title'));
    const spotTitle = titles.find(node => /uncontracted\s*\/\s*spot\s*tickets/i.test(clean(node.textContent)));
    if (!spotTitle) return;

    const hasActualContractGroup = titles.some(node => /^contract\b/i.test(clean(node.textContent)));
    if (hasActualContractGroup) return;

    const group = spotTitle.closest('.fv-job-contract-group');
    if (!group) return;

    group.classList.add('fv-simple-only-job-group');

    const heading = modal.querySelector('#fv-contract-job-ticket-heading, .fv-contract-job-ticket-heading');
    if (heading && !/^assigned tickets/i.test(clean(heading.textContent))) {
      heading.textContent = 'Assigned Tickets';
    }
  }

  function runFixes() {
    upgradeAssignmentFilters();
    normalizeSimpleHaulingPopup();
  }

  function start() {
    installSimplePopupStyles();
    runFixes();

    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        runFixes();
      });
    }).observe(document.body, {
      childList:true,
      subtree:true,
      attributes:true,
      attributeFilter:['class', 'disabled']
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once:true });
  } else {
    start();
  }
})();
