/* FarmVista — hauling status DND follow-up
   Sept. 12, 2026
   - Remaining bushels use FONT color only. Never fill the table cell.
   - Status-filter hauling-job cards keep their assigned tickets visible and draggable.
*/
(() => {
  'use strict';

  if (window.__FV_HAULING_STATUS_DND_FOLLOWUP_20260912_V2) return;
  window.__FV_HAULING_STATUS_DND_FOLLOWUP_20260912_V2 = true;

  const path = String(location.pathname || '').toLowerCase();
  if (!path.endsWith('/pages/grain/grain-contracts.html')) return;

  function installStyles() {
    let style = document.getElementById('fv-hauling-status-dnd-followup-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'fv-hauling-status-dnd-followup-style';
      document.head.appendChild(style);
    }

    style.textContent = `
      /* IMPORTANT: remaining warnings are FONT COLOR ONLY. */
      #hauling-jobs-table-body td[class*="fv-remain-"],
      #contracts-table-body td[class*="fv-remain-"],
      #contracts-table-body td[class*="fv-contract-remaining-"]{
        background:none!important;
        background-color:transparent!important;
        background-image:none!important;
        box-shadow:none!important;
      }

      #hauling-jobs-table-body td.fv-remain-green,
      #contracts-table-body td.fv-remain-green,
      #contracts-table-body td.fv-contract-remaining-green,
      .compact-contract-number strong.fv-contract-remaining-green{
        color:#2d6937!important;
        -webkit-text-fill-color:#2d6937!important;
        font-weight:900!important;
      }
      #hauling-jobs-table-body td.fv-remain-orange,
      #contracts-table-body td.fv-remain-orange,
      #contracts-table-body td.fv-contract-remaining-orange,
      .compact-contract-number strong.fv-contract-remaining-orange{
        color:#a65300!important;
        -webkit-text-fill-color:#a65300!important;
        font-weight:900!important;
      }
      #hauling-jobs-table-body td.fv-remain-red,
      #contracts-table-body td.fv-remain-red,
      #contracts-table-body td.fv-contract-remaining-red,
      .compact-contract-number strong.fv-contract-remaining-red{
        color:#9d241e!important;
        -webkit-text-fill-color:#9d241e!important;
        font-weight:900!important;
      }

      [data-theme="dark"] #hauling-jobs-table-body td.fv-remain-green,
      [data-theme="dark"] #contracts-table-body td.fv-remain-green,
      [data-theme="dark"] #contracts-table-body td.fv-contract-remaining-green{color:#b9e4bf!important;-webkit-text-fill-color:#b9e4bf!important}
      [data-theme="dark"] #hauling-jobs-table-body td.fv-remain-orange,
      [data-theme="dark"] #contracts-table-body td.fv-remain-orange,
      [data-theme="dark"] #contracts-table-body td.fv-contract-remaining-orange{color:#f4bb78!important;-webkit-text-fill-color:#f4bb78!important}
      [data-theme="dark"] #hauling-jobs-table-body td.fv-remain-red,
      [data-theme="dark"] #contracts-table-body td.fv-remain-red,
      [data-theme="dark"] #contracts-table-body td.fv-contract-remaining-red{color:#ffaaa4!important;-webkit-text-fill-color:#ffaaa4!important}

      /* Keep status-filter DND tickets visible/interactable. */
      #fv-ticket-status-job-list .fv-status-job-card .fv-ticket-job-linked,
      #fv-ticket-status-job-list .fv-status-job-card .fv-ticket-job-linked[hidden],
      #fv-ticket-status-job-list .fv-status-job-card [data-fv-status-ticket],
      #fv-ticket-status-job-list .fv-status-job-card [data-fv-status-ticket][hidden]{
        visibility:visible!important;
        opacity:1!important;
        pointer-events:auto!important;
      }
      #fv-ticket-status-job-list .fv-status-job-card .fv-status-compact-ticket-toggle{
        display:none!important;
      }
    `;
  }

  function clearInlineRemainingBackgrounds() {
    document.querySelectorAll(
      '#hauling-jobs-table-body td[class*="fv-remain-"],'+
      '#contracts-table-body td[class*="fv-remain-"],'+
      '#contracts-table-body td[class*="fv-contract-remaining-"]'
    ).forEach(cell => {
      cell.style.setProperty('background','none','important');
      cell.style.setProperty('background-color','transparent','important');
      cell.style.setProperty('background-image','none','important');
      cell.style.setProperty('box-shadow','none','important');
    });
  }

  function isCompactTicketToggle(node) {
    if (!(node instanceof Element)) return false;
    if (!node.matches('button,[role="button"],summary')) return false;
    const text = String(node.textContent || '').replace(/\s+/g,' ').trim().toLowerCase();
    return /assigned tickets?/.test(text) && /view/.test(text);
  }

  function repairStatusCards() {
    document.querySelectorAll('#fv-ticket-status-job-list .fv-status-job-card').forEach(card => {
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

  function run() {
    installStyles();
    clearInlineRemainingBackgrounds();
    repairStatusCards();
  }

  let queued = false;
  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      run();
    });
  }

  function start() {
    run();
    new MutationObserver(queue).observe(document.body || document.documentElement,{
      childList:true,
      subtree:true,
      attributes:true,
      attributeFilter:['class','hidden','style']
    });
    setInterval(clearInlineRemainingBackgrounds,750);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
