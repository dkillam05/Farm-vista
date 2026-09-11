import "/js/fv-combo.js";

/* FarmVista — Grain Contracts UI follow-up
   Sept. 11, 2026

   - Make Assign Grain Tickets to Hauling Jobs filters use the same FarmVista
     custom rounded combo control used elsewhere.
   - In simple hauling mode, do not label normal hauling-job tickets as
     "Uncontracted / Spot Tickets". If a hauling-job popup has no actual
     linked-contract groups, keep it as the plain Assigned Tickets view.
*/
(() => {
  'use strict';

  if (window.__FV_GRAIN_CONTRACTS_UI_FOLLOWUP_20260911_V2) return;
  window.__FV_GRAIN_CONTRACTS_UI_FOLLOWUP_20260911_V2 = true;

  const clean = value => String(value ?? '').trim();
  const norm = value => clean(value).toLowerCase();

  function findTicketAssignmentBlock() {
    return Array.from(document.querySelectorAll('.workflow-block')).find(block =>
      norm(block.querySelector('.workflow-block-title')?.textContent) === 'assign grain tickets to hauling jobs'
    ) || null;
  }

  function upgradeTicketAssignmentFilters() {
    const block = findTicketAssignmentBlock();
    if (!block) return;

    block.querySelectorAll('select').forEach(select => {
      select.setAttribute('data-fv-combo', '');
      select.setAttribute('data-fv-search', 'false');
    });

    window.FVCombo?.upgrade?.(block);
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
    upgradeTicketAssignmentFilters();
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
      attributeFilter:['class']
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once:true });
  } else {
    start();
  }
})();
