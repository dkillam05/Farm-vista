/* FarmVista — Grain Contracts hauling-job overview grouping
   Sept. 11, 2026

   Enhancements layered on top of the existing hauling-job overview:
   - Give "Assign Grain Tickets to Hauling Jobs" the same light interactive
     treatment as the contract assignment area.
   - In the Grain Contracts hauling-job quick overview, show linked contracts
     as expandable/collapsible groups and list each contract's tickets inside.
*/
(() => {
  'use strict';

  if (window.__FV_CONTRACT_JOB_GROUPS_20260911_V1) return;
  window.__FV_CONTRACT_JOB_GROUPS_20260911_V1 = true;

  const clean = value => String(value ?? '').trim();
  const norm = value => clean(value).toLowerCase();
  const num = value => {
    if (value === null || value === undefined || value === '') return 0;
    const parsed = Number(String(value).replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const rawNumber = value => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(String(value).replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  };
  const esc = value => clean(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
  const fmtBu = value => num(value).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const fmtGrade = value => {
    const parsed = rawNumber(value);
    return parsed === null ? '—' : `${parsed.toFixed(2)}%`;
  };
  const ticketNo = ticket => clean(ticket?.ticketNumber || ticket?.ticketNo || ticket?.number || ticket?.scaleTicketNumber) || clean(ticket?.id).slice(0, 10) || 'Ticket';
  const ticketDate = ticket => clean(ticket?.ticketDate || ticket?.date || ticket?.deliveryDate) || '—';
  const driverName = ticket => clean(ticket?.driverName || ticket?.driver || ticket?.submittedByName || ticket?.submittedBy) || '—';
  const ticketBushels = ticket => Math.max(0, num(ticket?.netBushels ?? ticket?.netBu ?? ticket?.bushels));
  const isVoided = record => record?.voided === true || norm(record?.status || record?.contractStatus).includes('void');

  const state = {
    jobId: '',
    dataPromise: null,
    contracts: [],
    tickets: []
  };

  function installStyles() {
    if (document.getElementById('fv-contract-job-groups-style')) return;
    const style = document.createElement('style');
    style.id = 'fv-contract-job-groups-style';
    style.textContent = `
      .fv-ticket-hauling-action{
        position:relative;
        margin:12px 14px 16px !important;
        padding:16px 18px !important;
        border:1px solid rgba(59,126,70,.24) !important;
        border-left:4px solid #3B7E46 !important;
        border-radius:12px !important;
        background:linear-gradient(90deg,rgba(59,126,70,.055),transparent 38%) !important;
      }
      .fv-ticket-hauling-action .workflow-block-head,
      .fv-ticket-hauling-action-head{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:12px;
      }
      .fv-ticket-hauling-chip{
        flex:0 0 auto;
        display:inline-flex;
        align-items:center;
        gap:6px;
        min-height:28px;
        padding:5px 9px;
        border:1px solid rgba(59,126,70,.24);
        border-radius:999px;
        background:rgba(59,126,70,.10);
        color:#2d6937;
        font-size:.72rem;
        font-weight:900;
        white-space:nowrap;
      }
      [data-theme="dark"] .fv-ticket-hauling-chip{color:#b9e4bf}

      .fv-job-contract-groups{display:grid;gap:12px}
      .fv-job-contract-group{
        overflow:hidden;
        border:1px solid var(--border,#d4d4d4);
        border-radius:11px;
        background:var(--surface,#fff);
      }
      .fv-job-contract-toggle{
        width:100%;
        display:grid;
        grid-template-columns:minmax(0,1fr) auto auto;
        align-items:center;
        gap:12px;
        padding:12px 14px;
        border:0;
        background:var(--surface-2,#f3f3f3);
        color:inherit;
        font:inherit;
        text-align:left;
        cursor:pointer;
      }
      .fv-job-contract-toggle:hover,
      .fv-job-contract-toggle:focus{
        outline:none;
        background:rgba(59,126,70,.08);
      }
      .fv-job-contract-title{font-weight:900;font-size:.93rem}
      .fv-job-contract-sub{margin-top:3px;font-size:.76rem;opacity:.68}
      .fv-job-contract-stats{font-size:.78rem;font-weight:900;white-space:nowrap}
      .fv-job-contract-chevron{font-size:1.05rem;font-weight:900;transition:transform .15s ease}
      .fv-job-contract-toggle[aria-expanded="true"] .fv-job-contract-chevron{transform:rotate(90deg)}
      .fv-job-contract-body[hidden]{display:none!important}
      .fv-job-contract-body{background:var(--surface,#fff)}
      .fv-job-contract-empty{padding:20px 14px;text-align:center;opacity:.62;font-size:.86rem}
      .fv-job-contract-table-wrap{width:100%;overflow-x:auto}
      .fv-job-contract-table{width:100%;min-width:760px;border-collapse:collapse}
      .fv-job-contract-table th{
        padding:10px 11px;
        background:var(--surface,#fff);
        border-bottom:1px solid var(--border,#ddd);
        font-size:.73rem;
        font-weight:800;
        text-align:center;
        white-space:nowrap;
      }
      .fv-job-contract-table td{
        padding:10px 11px;
        border-bottom:1px solid var(--border,#e1e1e1);
        font-size:.83rem;
        text-align:center;
        white-space:nowrap;
      }
      .fv-job-contract-table tbody tr:last-child td{border-bottom:0}
      .fv-job-contract-table th:first-child,
      .fv-job-contract-table td:first-child{text-align:left}
      .fv-job-contract-ticket-link{font-weight:900;color:inherit;text-decoration:none}
      .fv-job-contract-ticket-link:hover{text-decoration:underline;color:#3B7E46}
      .fv-job-grade-pill{
        display:inline-flex;
        min-width:46px;
        min-height:26px;
        align-items:center;
        justify-content:center;
        padding:4px 7px;
        border-radius:999px;
        font-weight:850;
      }
      .fv-job-grade-pill.warn{background:rgba(230,126,34,.13);box-shadow:inset 0 0 0 1px rgba(230,126,34,.45);color:#a65300}
      .fv-job-grade-pill.severe{background:rgba(179,38,30,.12);box-shadow:inset 0 0 0 1px rgba(179,38,30,.35);color:#9d241e}
      [data-theme="dark"] .fv-job-grade-pill.warn{color:#f4bb78}
      [data-theme="dark"] .fv-job-grade-pill.severe{color:#ffaaa4}
      @media(max-width:700px){
        .fv-job-contract-toggle{grid-template-columns:minmax(0,1fr) auto}
        .fv-job-contract-stats{grid-column:1 / -1;grid-row:2}
        .fv-ticket-hauling-action{margin:10px 8px 14px !important;padding:14px !important}
      }
    `;
    document.head.appendChild(style);
  }

  function decorateTicketHaulingAssignment() {
    const candidates = Array.from(document.querySelectorAll('h2,h3,h4,.workflow-block-title,.workflow-group-title,strong,div'));
    const titleNode = candidates.find(node => norm(node.textContent) === 'assign grain tickets to hauling jobs');
    if (!titleNode) return;

    let block = titleNode.closest('.workflow-block');
    if (!block) block = titleNode.parentElement;
    if (!block || block.classList.contains('fv-ticket-hauling-action')) return;

    block.classList.add('fv-ticket-hauling-action');
    const head = titleNode.closest('.workflow-block-head') || titleNode.parentElement;
    if (head && !head.querySelector('.fv-ticket-hauling-chip')) {
      head.classList.add('fv-ticket-hauling-action-head');
      const chip = document.createElement('span');
      chip.className = 'fv-ticket-hauling-chip';
      chip.setAttribute('aria-hidden', 'true');
      chip.innerHTML = '<span>↔</span><span>Drag & Drop</span>';
      head.appendChild(chip);
    }
  }

  async function loadData(force = false) {
    if (state.dataPromise && !force) return state.dataPromise;
    state.dataPromise = import('/js/firebase-init.js').then(async firebase => {
      await firebase.ready;
      const db = firebase.getFirestore();
      const [contractSnap, ticketSnap] = await Promise.all([
        firebase.getDocs(firebase.collection(db, 'grain_contracts')),
        firebase.getDocs(firebase.collection(db, 'grain_tickets'))
      ]);
      state.contracts = contractSnap.docs.map(docSnap => ({ id:docSnap.id, ...docSnap.data() })).filter(contract => !isVoided(contract));
      state.tickets = ticketSnap.docs.map(docSnap => ({ id:docSnap.id, ...docSnap.data() })).filter(ticket => !isVoided(ticket));
    }).catch(error => {
      state.dataPromise = null;
      throw error;
    });
    return state.dataPromise;
  }

  function contractNumber(contract) {
    return clean(contract?.contractNumber || contract?.number || contract?.contractNo) || 'Contract';
  }

  function contractSoldUnder(contract) {
    return clean(contract?.customerName || contract?.soldUnderName || contract?.soldUnder || contract?.customer) || '—';
  }

  function contractTarget(contract) {
    return Math.max(0, num(contract?.contractBushels ?? contract?.bushels ?? contract?.quantity));
  }

  function allocationsForTicket(ticket) {
    if (Array.isArray(ticket?.contractAllocations) && ticket.contractAllocations.length) {
      return ticket.contractAllocations
        .map(allocation => ({ contractId:clean(allocation?.contractId), bushels:Math.max(0,num(allocation?.bushels)) }))
        .filter(allocation => allocation.contractId && allocation.bushels > 0);
    }
    const contractId = clean(ticket?.contractId);
    if (!contractId) return [];
    return [{ contractId, bushels:ticketBushels(ticket) }];
  }

  function allocationFor(ticket, contractId) {
    return allocationsForTicket(ticket).find(allocation => allocation.contractId === contractId)?.bushels || 0;
  }

  function ticketsForContract(contractId) {
    return state.tickets
      .filter(ticket => allocationFor(ticket, contractId) > 0)
      .sort((a,b) => ticketDate(b).localeCompare(ticketDate(a)) || ticketNo(a).localeCompare(ticketNo(b), undefined, { numeric:true, sensitivity:'base' }));
  }

  function gradeClass(crop, type, value) {
    const v = rawNumber(value);
    if (v === null) return '';
    const c = norm(crop);
    if (type === 'mo') {
      if (c.includes('soy')) return v > 15.5 ? 'severe' : (v >= 13.5 ? 'warn' : '');
      return v > 19 ? 'severe' : (v >= 16.5 ? 'warn' : '');
    }
    if (type === 'fm') return v > 8 ? 'severe' : (v >= 3 ? 'warn' : '');
    if (type === 'damage') return v > 9 ? 'severe' : (v >= 5 ? 'warn' : '');
    return '';
  }

  function gradeValue(ticket, type) {
    if (type === 'mo') return ticket?.moisture ?? ticket?.mo ?? ticket?.MO;
    if (type === 'fm') return ticket?.foreignMaterial ?? ticket?.fm ?? ticket?.FM;
    return ticket?.damage ?? ticket?.damaged ?? ticket?.dm ?? ticket?.DM;
  }

  function gradePill(ticket, type) {
    const value = gradeValue(ticket, type);
    const cls = gradeClass(ticket?.crop, type, value);
    return `<span class="fv-job-grade-pill ${cls}">${fmtGrade(value)}</span>`;
  }

  function contractGroupHtml(contract, index) {
    const tickets = ticketsForContract(contract.id);
    const assigned = tickets.reduce((sum,ticket) => sum + allocationFor(ticket, contract.id), 0);
    const target = contractTarget(contract);
    const soldUnder = contractSoldUnder(contract);
    const expanded = index === 0 || tickets.length > 0;

    return `
      <div class="fv-job-contract-group" data-fv-contract-group="${esc(contract.id)}">
        <button type="button" class="fv-job-contract-toggle" aria-expanded="${expanded ? 'true' : 'false'}">
          <span>
            <span class="fv-job-contract-title">Contract ${esc(contractNumber(contract))}</span>
            <span class="fv-job-contract-sub">Sold Under: ${esc(soldUnder)}${target > 0 ? ` • ${fmtBu(target)} bu contract` : ''}</span>
          </span>
          <span class="fv-job-contract-stats">${fmtBu(assigned)} bu • ${tickets.length} ${tickets.length === 1 ? 'ticket' : 'tickets'}</span>
          <span class="fv-job-contract-chevron" aria-hidden="true">›</span>
        </button>
        <div class="fv-job-contract-body" ${expanded ? '' : 'hidden'}>
          ${tickets.length ? `
            <div class="fv-job-contract-table-wrap">
              <table class="fv-job-contract-table">
                <thead><tr><th>Ticket #</th><th>Date</th><th>Driver</th><th>Contract Bu.</th><th>MO</th><th>FM</th><th>Damage</th></tr></thead>
                <tbody>
                  ${tickets.map(ticket => `
                    <tr>
                      <td><a class="fv-job-contract-ticket-link" href="/pages/grain/grain-ticket-detail.html?id=${encodeURIComponent(clean(ticket.id))}">${esc(ticketNo(ticket))}</a></td>
                      <td>${esc(ticketDate(ticket))}</td>
                      <td>${esc(driverName(ticket))}</td>
                      <td>${fmtBu(allocationFor(ticket, contract.id))} bu</td>
                      <td>${gradePill(ticket,'mo')}</td>
                      <td>${gradePill(ticket,'fm')}</td>
                      <td>${gradePill(ticket,'damage')}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          ` : '<div class="fv-job-contract-empty">No tickets are assigned to this contract yet.</div>'}
        </div>
      </div>
    `;
  }

  function uncontractedGroupHtml(jobId, linkedContractIds) {
    const tickets = state.tickets.filter(ticket => {
      if (clean(ticket?.haulingJobId) !== clean(jobId)) return false;
      const ids = allocationsForTicket(ticket).map(allocation => allocation.contractId);
      return !ids.some(id => linkedContractIds.has(id));
    });
    if (!tickets.length) return '';
    const total = tickets.reduce((sum,ticket) => sum + ticketBushels(ticket),0);
    return `
      <div class="fv-job-contract-group">
        <button type="button" class="fv-job-contract-toggle" aria-expanded="true">
          <span><span class="fv-job-contract-title">Uncontracted / Spot Tickets</span><span class="fv-job-contract-sub">Tickets on this hauling job without one of its linked contracts.</span></span>
          <span class="fv-job-contract-stats">${fmtBu(total)} bu • ${tickets.length} tickets</span>
          <span class="fv-job-contract-chevron" aria-hidden="true">›</span>
        </button>
        <div class="fv-job-contract-body">
          <div class="fv-job-contract-table-wrap"><table class="fv-job-contract-table">
            <thead><tr><th>Ticket #</th><th>Date</th><th>Driver</th><th>Net Bu.</th><th>MO</th><th>FM</th><th>Damage</th></tr></thead>
            <tbody>${tickets.map(ticket => `
              <tr><td><a class="fv-job-contract-ticket-link" href="/pages/grain/grain-ticket-detail.html?id=${encodeURIComponent(clean(ticket.id))}">${esc(ticketNo(ticket))}</a></td><td>${esc(ticketDate(ticket))}</td><td>${esc(driverName(ticket))}</td><td>${fmtBu(ticketBushels(ticket))} bu</td><td>${gradePill(ticket,'mo')}</td><td>${gradePill(ticket,'fm')}</td><td>${gradePill(ticket,'damage')}</td></tr>
            `).join('')}</tbody>
          </table></div>
        </div>
      </div>
    `;
  }

  function bindGroupToggles(root) {
    root.querySelectorAll('.fv-job-contract-toggle').forEach(button => {
      if (button.dataset.fvBound === '1') return;
      button.dataset.fvBound = '1';
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const body = button.parentElement?.querySelector(':scope > .fv-job-contract-body');
        if (!body) return;
        const expanded = button.getAttribute('aria-expanded') === 'true';
        button.setAttribute('aria-expanded', expanded ? 'false' : 'true');
        body.hidden = expanded;
      });
    });
  }

  async function upgradeOverview() {
    const modal = document.getElementById('fv-contract-hauling-overview');
    if (!modal?.classList.contains('open') || !state.jobId) return;
    const list = modal.querySelector('#fv-contract-job-ticket-list');
    const heading = modal.querySelector('#fv-contract-job-ticket-heading');
    if (!list || list.dataset.fvContractGroupedFor === state.jobId) return;

    try {
      await loadData(true);
      if (!modal.classList.contains('open')) return;

      const contracts = state.contracts
        .filter(contract => clean(contract?.haulingJobId) === state.jobId)
        .sort((a,b) => contractNumber(a).localeCompare(contractNumber(b), undefined, { numeric:true, sensitivity:'base' }));

      const linkedIds = new Set(contracts.map(contract => contract.id));
      const spotHtml = uncontractedGroupHtml(state.jobId, linkedIds);
      if (heading) heading.textContent = `Linked Contracts (${contracts.length})`;

      if (!contracts.length && !spotHtml) {
        list.innerHTML = '<div class="fv-job-contract-empty">No linked contracts or assigned tickets are on this hauling job yet.</div>';
      } else {
        list.innerHTML = `<div class="fv-job-contract-groups">${contracts.map(contractGroupHtml).join('')}${spotHtml}</div>`;
        bindGroupToggles(list);
      }
      list.dataset.fvContractGroupedFor = state.jobId;
    } catch (error) {
      console.warn('[FarmVista] Could not group hauling-job contracts in overview:', error);
    }
  }

  function installJobCapture() {
    document.addEventListener('click', event => {
      const row = event.target?.closest?.('tr.hauling-row[data-hauling-job-id]');
      if (!row) return;
      state.jobId = clean(row.dataset.haulingJobId);
      const list = document.querySelector('#fv-contract-job-ticket-list');
      if (list) delete list.dataset.fvContractGroupedFor;
      setTimeout(upgradeOverview, 60);
      setTimeout(upgradeOverview, 250);
    }, true);
  }

  function start() {
    installStyles();
    installJobCapture();
    decorateTicketHaulingAssignment();

    let queued = false;
    const observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        decorateTicketHaulingAssignment();
        upgradeOverview();
      });
    });
    observer.observe(document.body, { childList:true, subtree:true, attributes:true, attributeFilter:['class'] });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();
})();
