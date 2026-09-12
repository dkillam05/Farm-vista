/* FarmVista — hauling status DND follow-up
   Sept. 12, 2026
   Remaining bushels use FONT color only. Ticket collapse/expand is owned by
   grain-hauling-ticket-sequence.js so this file must not force ticket cards open.
*/
(() => {
  'use strict';
  if (window.__FV_HAULING_STATUS_DND_FOLLOWUP_20260912_V2) return;
  window.__FV_HAULING_STATUS_DND_FOLLOWUP_20260912_V2 = true;
  if (!String(location.pathname || '').toLowerCase().endsWith('/pages/grain/grain-contracts.html')) return;

  function installStyles() {
    if (document.getElementById('fv-hauling-status-dnd-followup-style-v2')) return;
    const style = document.createElement('style');
    style.id = 'fv-hauling-status-dnd-followup-style-v2';
    style.textContent = `
      #hauling-jobs-table-body td.fv-remain-green,
      #contracts-table-body td.fv-remain-green,
      #contracts-table-body td.fv-contract-remaining-green,
      .compact-contract-number strong.fv-contract-remaining-green{
        background:transparent!important;background-color:transparent!important;background-image:none!important;
        box-shadow:none!important;color:#2d6937!important;font-weight:900!important;
      }
      #hauling-jobs-table-body td.fv-remain-orange,
      #contracts-table-body td.fv-remain-orange,
      #contracts-table-body td.fv-contract-remaining-orange,
      .compact-contract-number strong.fv-contract-remaining-orange{
        background:transparent!important;background-color:transparent!important;background-image:none!important;
        box-shadow:none!important;color:#a65300!important;font-weight:900!important;
      }
      #hauling-jobs-table-body td.fv-remain-red,
      #contracts-table-body td.fv-remain-red,
      #contracts-table-body td.fv-contract-remaining-red,
      .compact-contract-number strong.fv-contract-remaining-red{
        background:transparent!important;background-color:transparent!important;background-image:none!important;
        box-shadow:none!important;color:#9d241e!important;font-weight:900!important;
      }
      [data-theme="dark"] #hauling-jobs-table-body td.fv-remain-green,
      [data-theme="dark"] #contracts-table-body td.fv-remain-green{color:#b9e4bf!important}
      [data-theme="dark"] #hauling-jobs-table-body td.fv-remain-orange,
      [data-theme="dark"] #contracts-table-body td.fv-remain-orange{color:#f4bb78!important}
      [data-theme="dark"] #hauling-jobs-table-body td.fv-remain-red,
      [data-theme="dark"] #contracts-table-body td.fv-remain-red{color:#ffaaa4!important}
    `;
    document.head.appendChild(style);
  }

  function clearInlineFills() {
    document.querySelectorAll(
      '#hauling-jobs-table-body td.fv-remain-green,' +
      '#hauling-jobs-table-body td.fv-remain-orange,' +
      '#hauling-jobs-table-body td.fv-remain-red,' +
      '#contracts-table-body td.fv-remain-green,' +
      '#contracts-table-body td.fv-remain-orange,' +
      '#contracts-table-body td.fv-remain-red'
    ).forEach(cell => {
      cell.style.setProperty('background','transparent','important');
      cell.style.setProperty('background-color','transparent','important');
      cell.style.setProperty('background-image','none','important');
      cell.style.setProperty('box-shadow','none','important');
    });
  }

  let queued = false;
  function run() { installStyles(); clearInlineFills(); }
  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; run(); });
  }

  function start() {
    run();
    new MutationObserver(queue).observe(document.body || document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style']});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
