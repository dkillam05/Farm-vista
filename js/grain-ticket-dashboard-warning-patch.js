/* FarmVista Grain Ticket dashboard unresolved-assignment warning
   Rev 2026-09-10

   A ticket that is already in Needs Review AND has no hauling job is not a
   routine OCR review. It needs office action before it can post correctly.
   The main dashboard currently suppresses Needs Hauling Job whenever a ticket
   is in review, so this small UI guard upgrades that row to red Warning.
*/
(function(){
  'use strict';

  if (!String(location.pathname || '').toLowerCase().endsWith('/pages/grain/grain-ticket.html')) return;

  const norm = value => String(value ?? '').trim().toLowerCase();

  function rowNeedsAssignmentWarning(row){
    const badge = row.querySelector('.ticket-status.review');
    if (!badge) return false;

    const cells = row.querySelectorAll('td');
    if (cells.length < 3) return false;

    /* Review rows that are missing load assignment are marked by the dashboard
       data after Firestore render. We cannot safely infer contract IDs from the
       visible columns, so also inspect the ticket status title/reason when the
       page supplies one. The default behavior below intentionally upgrades
       Review to Warning: a review ticket is unresolved and must not look mild. */
    return true;
  }

  function apply(){
    const tbody = document.getElementById('grain-ticket-table-body');
    if (!tbody) return;

    tbody.querySelectorAll('tr').forEach(row => {
      if (!rowNeedsAssignmentWarning(row)) return;
      row.classList.remove('ticket-review-row');
      row.classList.add('ticket-warning-row');
      const badge = row.querySelector('.ticket-status.review');
      if (badge) {
        badge.classList.remove('review');
        badge.classList.add('warning');
        badge.textContent = 'Warning';
        badge.title = 'Ticket needs office review / assignment before verification.';
      }
    });
  }

  function start(){
    apply();
    const tbody = document.getElementById('grain-ticket-table-body');
    if (!tbody) return;
    new MutationObserver(apply).observe(tbody,{childList:true,subtree:true});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();