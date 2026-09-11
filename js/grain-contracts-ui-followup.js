/* FarmVista — Grain Contracts UI follow-up
   Sept. 11, 2026

   - Make the Grain Tickets -> Hauling Jobs filters use FarmVista custom combos.
   - When a hauling job has NO linked contracts, keep the original simple
     Assigned Tickets popup instead of labeling tickets as spot/uncontracted.
*/
(() => {
  'use strict';

  if (window.__FV_GRAIN_CONTRACTS_UI_FOLLOWUP_20260911) return;
  window.__FV_GRAIN_CONTRACTS_UI_FOLLOWUP_20260911 = true;

  const clean = value => String(value ?? '').trim();
  const norm = value => clean(value).toLowerCase();
  const num = value => {
    const parsed = Number(String(value ?? '').replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const rawNum = value => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const esc = value => clean(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  let currentJobId = '';
  let ticketCache = null;

  function findTicketAssignmentBlock() {
    return Array.from(document.querySelectorAll('.workflow-block')).find(block =>
      norm(block.querySelector('.workflow-block-title')?.textContent) === 'assign grain tickets to hauling jobs'
    ) || null;
  }

  function upgradeTicketAssignmentFilters() {
    const block = findTicketAssignmentBlock();
    if (!block) return;

    const selects = Array.from(block.querySelectorAll('select'));
    selects.forEach(select => {
      if (!select.hasAttribute('data-fv-combo')) {
        select.setAttribute('data-fv-combo', '');
      }
      select.setAttribute('data-fv-search', 'false');
    });

    if (window.FVCombo?.upgrade) {
      window.FVCombo.upgrade(block);
    }
  }

  async function ticketsForJob(jobId) {
    if (!ticketCache) {
      ticketCache = import('/js/firebase-init.js').then(async firebase => {
        await firebase.ready;
        const db = firebase.getFirestore();
        const snap = await firebase.getDocs(firebase.collection(db, 'grain_tickets'));
        return snap.docs.map(docSnap => ({ id:docSnap.id, ...docSnap.data() }));
      }).catch(error => {
        ticketCache = null;
        throw error;
      });
    }

    const tickets = await ticketCache;
    return tickets
      .filter(ticket => {
        const voided = ticket?.voided === true || norm(ticket?.status).includes('void');
        return !voided && clean(ticket?.haulingJobId) === clean(jobId);
      })
      .sort((a,b) => {
        const ad = clean(a?.ticketDate || a?.date || a?.deliveryDate);
        const bd = clean(b?.ticketDate || b?.date || b?.deliveryDate);
        const an = clean(a?.ticketNumber || a?.ticketNo || a?.number);
        const bn = clean(b?.ticketNumber || b?.ticketNo || b?.number);
        return bd.localeCompare(ad) || an.localeCompare(bn, undefined, { numeric:true, sensitivity:'base' });
      });
  }

  function fmtBu(value) {
    return num(value).toLocaleString('en-US', { maximumFractionDigits:2 });
  }

  function fmtGrade(value) {
    const parsed = rawNum(value);
    return parsed === null ? '—' : parsed.toFixed(1);
  }

  function ticketNo(ticket) {
    return clean(ticket?.ticketNumber || ticket?.ticketNo || ticket?.number || ticket?.scaleTicketNumber) || clean(ticket?.id).slice(0,10);
  }

  function ticketDate(ticket) {
    return clean(ticket?.ticketDate || ticket?.date || ticket?.deliveryDate) || '—';
  }

  function ticketBushels(ticket) {
    return num(ticket?.netBushels ?? ticket?.netBu ?? ticket?.bushels);
  }

  function flatTicketTable(tickets) {
    return `
      <div class="fv-contract-job-table-wrap">
        <table class="fv-contract-job-table">
          <thead>
            <tr><th>Ticket #</th><th>Date</th><th>Bushels</th><th>MO</th><th>FM</th><th>Damage</th></tr>
          </thead>
          <tbody>
            ${tickets.map(ticket => `
              <tr>
                <td><a class="fv-contract-job-ticket-link" href="/pages/grain/grain-ticket-detail.html?id=${encodeURIComponent(clean(ticket.id))}">Ticket ${esc(ticketNo(ticket))}</a></td>
                <td>${esc(ticketDate(ticket))}</td>
                <td>${fmtBu(ticketBushels(ticket))} bu</td>
                <td>${fmtGrade(ticket?.moisture ?? ticket?.mo ?? ticket?.MO)}</td>
                <td>${fmtGrade(ticket?.foreignMaterial ?? ticket?.fm ?? ticket?.FM)}</td>
                <td>${fmtGrade(ticket?.damage ?? ticket?.damaged ?? ticket?.dm ?? ticket?.DM)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`;
  }

  async function restoreSimpleOverviewWhenNoContracts() {
    const modal = document.getElementById('fv-contract-hauling-overview');
    if (!modal?.classList.contains('open') || !currentJobId) return;

    const list = modal.querySelector('#fv-contract-job-ticket-list');
    const heading = modal.querySelector('#fv-contract-job-ticket-heading');
    if (!list || list.dataset.fvSimpleFallbackFor === currentJobId) return;

    const realContractGroups = list.querySelectorAll('[data-fv-contract-group]').length;
    const hasSpotLabel = /uncontracted\s*\/\s*spot/i.test(list.textContent || '');

    // Only replace the grouped UI when the job truly has no linked contracts.
    if (realContractGroups > 0 || !hasSpotLabel) return;

    try {
      const tickets = await ticketsForJob(currentJobId);
      if (!modal.classList.contains('open') || currentJobId !== clean(currentJobId)) return;

      if (heading) heading.textContent = `Assigned Tickets (${tickets.length.toLocaleString('en-US')})`;
      list.innerHTML = tickets.length
        ? flatTicketTable(tickets)
        : '<div class="fv-contract-job-empty">No tickets are linked to this hauling job yet.</div>';

      list.dataset.fvSimpleFallbackFor = currentJobId;
      // Keep the grouped renderer from immediately replacing this simple view again.
      list.dataset.fvContractGroupedFor = currentJobId;
    } catch (error) {
      console.warn('[FarmVista] Could not restore simple hauling-job overview:', error);
    }
  }

  function captureJobClick() {
    document.addEventListener('click', event => {
      const row = event.target?.closest?.('tr.hauling-row[data-hauling-job-id]');
      if (!row) return;
      currentJobId = clean(row.dataset.haulingJobId);
      ticketCache = null;
      setTimeout(restoreSimpleOverviewWhenNoContracts, 120);
      setTimeout(restoreSimpleOverviewWhenNoContracts, 350);
    }, true);
  }

  function start() {
    upgradeTicketAssignmentFilters();
    captureJobClick();

    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        upgradeTicketAssignmentFilters();
        restoreSimpleOverviewWhenNoContracts();
      });
    }).observe(document.body, { childList:true, subtree:true, attributes:true, attributeFilter:['class'] });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once:true });
  } else {
    start();
  }
})();
