/* FarmVista — hauling status DND follow-up
   Sept. 12, 2026
   - Remaining bushels use FONT color only (no filled cell background).
   - Status-filter hauling-job cards keep their assigned tickets expanded and
     draggable. Any older "assigned tickets — View" compact toggle is hidden
     so it cannot block the DND ticket cards underneath.
*/
(() => {
  'use strict';

  if (window.__FV_HAULING_STATUS_DND_FOLLOWUP_20260912) return;
  window.__FV_HAULING_STATUS_DND_FOLLOWUP_20260912 = true;

  const path = String(location.pathname || '').toLowerCase();
  if (!path.endsWith('/pages/grain/grain-contracts.html')) return;

  function installStyles() {
    if (document.getElementById('fv-hauling-status-dnd-followup-style')) return;
    const style = document.createElement('style');
    style.id = 'fv-hauling-status-dnd-followup-style';
    style.textContent = `
      /* Remaining bushels: font color only. */
      #hauling-jobs-table-body td.fv-remain-green,
      #contracts-table-body td.fv-remain-green,
      #contracts-table-body td.fv-contract-remaining-green,
      .compact-contract-number strong.fv-contract-remaining-green{
        background:transparent!important;
        box-shadow:none!important;
        color:#2d6937!important;
        font-weight:900!important;
      }
      #hauling-jobs-table-body td.fv-remain-orange,
      #contracts-table-body td.fv-remain-orange,
      #contracts-table-body td.fv-contract-remaining-orange,
      .compact-contract-number strong.fv-contract-remaining-orange{
        background:transparent!important;
        box-shadow:none!important;
        color:#a65300!important;
        font-weight:900!important;
      }
      #hauling-jobs-table-body td.fv-remain-red,
      #contracts-table-body td.fv-remain-red,
      #contracts-table-body td.fv-contract-remaining-red,
      .compact-contract-number strong.fv-contract-remaining-red{
        background:transparent!important;
        box-shadow:none!important;
        color:#9d241e!important;
        font-weight:900!important;
      }

      [data-theme="dark"] #hauling-jobs-table-body td.fv-remain-green,
      [data-theme="dark"] #contracts-table-body td.fv-remain-green,
      [data-theme="dark"] #contracts-table-body td.fv-contract-remaining-green,
      [data-theme="dark"] .compact-contract-number strong.fv-contract-remaining-green{color:#b9e4bf!important}
      [data-theme="dark"] #hauling-jobs-table-body td.fv-remain-orange,
      [data-theme="dark"] #contracts-table-body td.fv-remain-orange,
      [data-theme="dark"] #contracts-table-body td.fv-contract-remaining-orange,
      [data-theme="dark"] .compact-contract-number strong.fv-contract-remaining-orange{color:#f4bb78!important}
      [data-theme="dark"] #hauling-jobs-table-body td.fv-remain-red,
      [data-theme="dark"] #contracts-table-body td.fv-remain-red,
      [data-theme="dark"] #contracts-table-body td.fv-contract-remaining-red,
      [data-theme="dark"] .compact-contract-number strong.fv-contract-remaining-red{color:#ffaaa4!important}

      /* Status-filter DND tickets must stay visible and interactive. */
      #fv-ticket-status-job-list .fv-status-job-card .fv-ticket-job-linked,
      #fv-ticket-status-job-list .fv-status-job-card .fv-ticket-job-linked[hidden],
      #fv-ticket-status-job-list .fv-status-job-card [data-fv-status-ticket],
      #fv-ticket-status-job-list .fv-status-job-card [data-fv-status-ticket][hidden]{
        display:block!important;
        visibility:visible!important;
        opacity:1!important;
        height:auto!important;
        max-height:none!important;
        overflow:visible!important;
        pointer-events:auto!important;
      }
      #fv-ticket-status-job-list .fv-status-job-card [data-fv-status-ticket]{
        display:grid!important;
      }
      #fv-ticket-status-job-list .fv-status-job-card .fv-ticket-job-linked-label{
        display:block!important;
      }
      #fv-ticket-status-job-list .fv-status-job-card .fv-status-compact-ticket-toggle{
        display:none!important;
      }
    `;
    document.head.appendChild(style);
  }

  function isCompactTicketToggle(node) {
    if (!(node instanceof Element)) return false;
    if (!node.matches('button,[role="button"],summary')) return false;
    const text = String(node.textContent || '').replace(/\s+/g,' ').trim().toLowerCase();
    return /assigned tickets?/.test(text) && /view/.test(text);
  }

  function repairStatusCards(root = document) {
    root.querySelectorAll?.('#fv-ticket-status-job-list .fv-status-job-card').forEach(card => {
      // Older compact rendering inserted a View control over the assigned-ticket
      // area. Hide only that control; never hide the actual ticket container.
      card.querySelectorAll('button,[role="button"],summary').forEach(node => {
        if (!isCompactTicketToggle(node)) return;
        node.classList.add('fv-status-compact-ticket-toggle');
        node.hidden = true;
        node.setAttribute('aria-hidden','true');
      });

      card.querySelectorAll('.fv-ticket-job-linked,[data-fv-status-ticket]').forEach(node => {
        node.hidden = false;
        node.removeAttribute('aria-hidden');
      });
    });
  }

  function run(root = document) {
    installStyles();
    repairStatusCards(root);
  }

  let queued = false;
  const observer = new MutationObserver(records => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      run(document);
    });
  });

  function start() {
    run(document);
    observer.observe(document.body || document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class','hidden','style']});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
