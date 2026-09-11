/* FarmVista — Grain Contracts hauling-job compact cards + overview modal
   Sept. 11, 2026

   Grain Contracts only:
   - Hauling Job assignment cards stay compact when they already have tickets.
   - Clicking a Hauling Job row opens a Grain Inventory-style overview first.
   - The overview keeps Edit Hauling Job in the header and shows ticket grades
     in a compact drill-down table with lightweight quality alerts.
   - The two drag/drop assignment workflows get a small visual treatment so
     users can tell they are interactive without making the page feel busy.

   Grain Inventory is intentionally untouched.
*/
(() => {
  'use strict';

  if (window.__FV_HAULING_JOB_UX_20260911_V3) return;
  window.__FV_HAULING_JOB_UX_20260911_V3 = true;

  const clean = value => String(value ?? '').trim();
  const path = String(location.pathname || '').toLowerCase();
  const isContracts = path.endsWith('/pages/grain/grain-contracts.html');
  if (!isContracts) return;

  const n = value => {
    if (value === null || value === undefined || value === '') return 0;
    const parsed = Number(String(value).replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const rawNumber = value => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(String(value).replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  };

  const fmtBu = value => n(value).toLocaleString('en-US', {
    maximumFractionDigits: 2
  });

  const fmtGrade = value => {
    const parsed = rawNumber(value);
    return parsed === null ? '—' : `${parsed.toFixed(2)}%`;
  };

  const fmtTicketGrade = value => {
    const parsed = rawNumber(value);
    return parsed === null ? '—' : parsed.toFixed(1);
  };

  const escapeHtml = value => clean(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  const state = {
    dataPromise: null,
    jobs: new Map(),
    tickets: [],
    customers: new Map(),
    currentJobId: '',
    currentRow: null,
    bypassJobId: ''
  };

  function ensureStyle() {
    if (document.getElementById('fv-hauling-job-ux-style')) return;

    const style = document.createElement('style');
    style.id = 'fv-hauling-job-ux-style';
    style.textContent = `
      .fv-job-ticket-collapse-row{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:10px;
        margin-top:9px;
        padding-top:8px;
        border-top:1px solid var(--border,#ddd);
      }
      .fv-job-ticket-collapse-btn{
        width:100%;
        min-height:34px;
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:10px;
        padding:6px 8px;
        border:0;
        border-radius:8px;
        background:var(--surface-2,rgba(0,0,0,.04));
        color:var(--text,#111);
        font:inherit;
        font-size:.76rem;
        font-weight:850;
        text-align:left;
        cursor:pointer;
      }
      .fv-job-ticket-collapse-btn:hover,
      .fv-job-ticket-collapse-btn:focus{
        outline:none;
        background:rgba(59,126,70,.10);
      }
      .fv-job-ticket-collapse-chevron{
        flex:0 0 auto;
        font-size:1rem;
        transition:transform .15s ease;
      }
      .fv-job-ticket-collapse-btn[aria-expanded="true"] .fv-job-ticket-collapse-chevron{
        transform:rotate(90deg);
      }
      .fv-ticket-job-linked[data-fv-job-tickets-collapsed="1"]{
        display:none!important;
      }

      /* Small visual cue for the two interactive assignment areas. */
      .workflow-block.fv-assignment-action{
        position:relative;
        margin:12px 14px 16px;
        padding:16px 18px;
        border:1px solid rgba(59,126,70,.24);
        border-left:4px solid #3B7E46;
        border-radius:12px;
        background:linear-gradient(90deg,rgba(59,126,70,.055),transparent 38%);
      }
      .workflow-block.fv-assignment-action.fv-assignment-hauling{
        border-color:rgba(79,113,143,.28);
        border-left-color:#4f718f;
        background:linear-gradient(90deg,rgba(79,113,143,.065),transparent 38%);
      }
      .fv-assignment-action .workflow-block-head{
        align-items:center;
      }
      .fv-assignment-chip{
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
      .fv-assignment-hauling .fv-assignment-chip{
        border-color:rgba(79,113,143,.25);
        background:rgba(79,113,143,.11);
        color:#425f79;
      }
      [data-theme="dark"] .fv-assignment-chip{color:#b9e4bf}
      [data-theme="dark"] .fv-assignment-hauling .fv-assignment-chip{color:#bed2e2}
      .fv-assignment-chip-icon{
        font-size:.95rem;
        line-height:1;
      }

      /* Grain Inventory-style quick overview modal. */
      #fv-contract-hauling-overview{
        position:fixed;
        inset:0;
        z-index:12600;
        display:none;
        align-items:flex-start;
        justify-content:center;
        padding:20px;
        overflow:auto;
        background:rgba(0,0,0,.50);
      }
      #fv-contract-hauling-overview.open{display:flex}
      .fv-contract-job-modal{
        width:min(820px,100%);
        margin:auto;
        overflow:hidden;
        border:0;
        border-radius:16px;
        background:var(--surface,#fff);
        color:var(--text,#111);
        box-shadow:0 18px 55px rgba(0,0,0,.30);
      }
      .fv-contract-job-modal-head{
        display:flex;
        align-items:flex-start;
        justify-content:space-between;
        gap:12px;
        padding:18px 20px;
        border-bottom:1px solid var(--border,#ddd);
      }
      .fv-contract-job-modal-title{
        font-size:1.25rem;
        font-weight:800;
        line-height:1.25;
      }
      .fv-contract-job-modal-sub{
        margin-top:4px;
        font-size:.9rem;
        opacity:.68;
        line-height:1.35;
      }
      .fv-contract-job-modal-head-actions{
        display:flex;
        align-items:center;
        gap:8px;
        flex:0 0 auto;
      }
      #fv-contract-job-edit-btn{
        min-height:38px;
        padding:8px 13px;
        border:1px solid #3B7E46!important;
        border-radius:10px;
        background:#3B7E46!important;
        color:#fff!important;
        -webkit-text-fill-color:#fff!important;
        font:inherit;
        font-weight:900;
        cursor:pointer;
        white-space:nowrap;
      }
      #fv-contract-job-edit-btn:hover,
      #fv-contract-job-edit-btn:focus{
        background:#326d3c!important;
        color:#fff!important;
        -webkit-text-fill-color:#fff!important;
        outline:none;
      }
      .fv-contract-job-close{
        width:40px;
        height:40px;
        border:0;
        border-radius:10px;
        background:var(--surface-2,#eee);
        color:var(--text,#111);
        font-size:1.25rem;
        cursor:pointer;
      }
      .fv-contract-job-modal-body{
        padding:20px;
      }
      .fv-contract-job-summary{
        display:grid;
        grid-template-columns:repeat(3,minmax(0,1fr));
        gap:10px;
        margin-bottom:18px;
      }
      .fv-contract-job-box{
        min-width:0;
        padding:12px;
        border:0;
        border-radius:10px;
        background:var(--surface-2,#f2f2f2);
      }
      .fv-contract-job-label{
        font-size:.74rem;
        opacity:.65;
        margin-bottom:4px;
        font-weight:500;
      }
      .fv-contract-job-value{
        font-size:1rem;
        font-weight:800;
        overflow-wrap:anywhere;
      }
      .fv-contract-job-ticket-heading{
        margin:0 0 9px;
        font-size:.84rem;
        font-weight:800;
        opacity:.78;
      }
      .fv-contract-job-table-wrap{
        width:100%;
        overflow-x:auto;
        border:1px solid var(--border,#d4d4d4);
        border-radius:10px;
      }
      .fv-contract-job-table{
        width:100%;
        min-width:690px;
        border-collapse:collapse;
      }
      .fv-contract-job-table th{
        padding:10px 12px;
        background:var(--surface-2,#f3f3f3);
        border-bottom:1px solid var(--border,#d4d4d4);
        font-size:.76rem;
        font-weight:800;
        text-align:center;
        white-space:nowrap;
      }
      .fv-contract-job-table td{
        padding:10px 12px;
        border-bottom:1px solid var(--border,#e1e1e1);
        text-align:center;
        font-size:.86rem;
        white-space:nowrap;
      }
      .fv-contract-job-table tbody tr:last-child td{border-bottom:0}
      .fv-contract-job-table tbody tr{cursor:pointer}
      .fv-contract-job-table tbody tr:hover{background:var(--surface-2,rgba(0,0,0,.04))}
      .fv-contract-job-table th:first-child,
      .fv-contract-job-table td:first-child{text-align:left}
      .fv-contract-job-ticket-link{
        color:#3B7E46;
        font-weight:800;
        text-decoration:none;
      }
      .fv-contract-job-ticket-link:hover{text-decoration:underline}
      .fv-grade-pill{
        display:inline-flex;
        min-width:46px;
        min-height:26px;
        align-items:center;
        justify-content:center;
        padding:4px 7px;
        border-radius:999px;
        font-weight:800;
      }
      .fv-grade-pill.good{background:transparent}
      .fv-grade-pill.warn{
        background:rgba(230,126,34,.14);
        box-shadow:inset 0 0 0 1px rgba(230,126,34,.25);
        color:#a65300;
      }
      .fv-grade-pill.severe{
        background:rgba(179,38,30,.12);
        box-shadow:inset 0 0 0 1px rgba(179,38,30,.24);
        color:#9d241e;
      }
      [data-theme="dark"] .fv-grade-pill.warn{color:#f4bb78}
      [data-theme="dark"] .fv-grade-pill.severe{color:#ffaaa4}
      .fv-contract-job-empty{
        padding:28px 12px;
        text-align:center;
        opacity:.64;
        border:1px dashed var(--border,#d7d7d7);
        border-radius:10px;
      }
      @media(max-width:700px){
        .fv-contract-job-summary{grid-template-columns:repeat(2,minmax(0,1fr))}
        .fv-assignment-action .workflow-block-head{align-items:flex-start}
      }
      @media(max-width:560px){
        #fv-contract-hauling-overview{padding:0}
        .fv-contract-job-modal{width:100%;min-height:100vh;border-radius:0}
        .fv-contract-job-modal-head{align-items:center}
        .fv-contract-job-modal-body{padding:14px}
        #fv-contract-job-edit-btn{padding:8px 10px;font-size:.8rem}
        .fv-contract-job-summary{grid-template-columns:repeat(2,minmax(0,1fr))}
        .workflow-block.fv-assignment-action{margin:10px 8px 14px;padding:14px}
      }
    `;
    document.head.appendChild(style);
  }

  /* ============================================================
     LIGHT INTERACTION CUES FOR ASSIGNMENT WORKFLOWS
  ============================================================ */

  function decorateAssignmentBlocks() {
    document.querySelectorAll('.workflow-block').forEach(block => {
      const title = clean(block.querySelector('.workflow-block-title')?.textContent).toLowerCase();
      const isHauling = title === 'assign contracts to hauling jobs';
      const isTickets = title === 'assign grain tickets to contracts';
      if (!isHauling && !isTickets) return;

      block.classList.add('fv-assignment-action');
      if (isHauling) block.classList.add('fv-assignment-hauling');

      const head = block.querySelector('.workflow-block-head');
      if (!head || head.querySelector('.fv-assignment-chip')) return;

      const chip = document.createElement('div');
      chip.className = 'fv-assignment-chip';
      chip.setAttribute('aria-hidden', 'true');
      chip.innerHTML = '<span class="fv-assignment-chip-icon">↔</span><span>Drag & Drop</span>';
      head.appendChild(chip);
    });
  }

  /* ============================================================
     COMPACT ASSIGNED TICKETS IN DND HAULING JOB CARDS
  ============================================================ */

  function assignedTickets(linked) {
    if (!linked) return [];
    return Array.from(linked.querySelectorAll('.fv-hauling-ticket-card[data-ticket-id]'));
  }

  function syncButtonLabel(button, count) {
    const label = button?.querySelector('.fv-job-ticket-collapse-label');
    if (!label) return;

    const expanded = button.getAttribute('aria-expanded') === 'true';
    const text = `${count.toLocaleString('en-US')} assigned ${count === 1 ? 'ticket' : 'tickets'} — ${expanded ? 'Hide' : 'View'}`;
    if (label.textContent !== text) label.textContent = text;
  }

  function syncJobTicketCollapse(card) {
    if (!card) return;

    const linked = card.querySelector(':scope > .fv-ticket-job-linked');
    if (!linked) {
      card.querySelector(':scope > .fv-job-ticket-collapse-row')?.remove();
      return;
    }

    const tickets = assignedTickets(linked);
    if (!tickets.length) {
      linked.removeAttribute('data-fv-job-tickets-collapsed');
      card.querySelector(':scope > .fv-job-ticket-collapse-row')?.remove();
      return;
    }

    let row = card.querySelector(':scope > .fv-job-ticket-collapse-row');
    let button = row?.querySelector('.fv-job-ticket-collapse-btn');

    if (!row) {
      row = document.createElement('div');
      row.className = 'fv-job-ticket-collapse-row';

      button = document.createElement('button');
      button.type = 'button';
      button.className = 'fv-job-ticket-collapse-btn';
      button.setAttribute('aria-expanded', 'false');
      button.innerHTML = `
        <span class="fv-job-ticket-collapse-label"></span>
        <span class="fv-job-ticket-collapse-chevron" aria-hidden="true">›</span>
      `;

      button.addEventListener('pointerdown', event => event.stopPropagation());
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();

        const next = button.getAttribute('aria-expanded') !== 'true';
        button.setAttribute('aria-expanded', next ? 'true' : 'false');
        linked.dataset.fvJobTicketsCollapsed = next ? '0' : '1';
        syncButtonLabel(button, assignedTickets(linked).length);
      });

      row.appendChild(button);
      linked.insertAdjacentElement('beforebegin', row);
    }

    if (!button.dataset.fvInitialized) {
      button.dataset.fvInitialized = '1';
      button.setAttribute('aria-expanded', 'false');
      linked.dataset.fvJobTicketsCollapsed = '1';
    }

    syncButtonLabel(button, tickets.length);
  }

  function syncAllContractJobCards() {
    document
      .querySelectorAll('.fv-ticket-job-card[data-fv-ticket-job-id]')
      .forEach(syncJobTicketCollapse);
  }

  function installContractCollapse() {
    syncAllContractJobCards();

    let queued = false;
    const observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        syncAllContractJobCards();
        decorateAssignmentBlocks();
      });
    });

    observer.observe(document.body, { childList:true, subtree:true });
  }

  /* ============================================================
     HAULING JOB OVERVIEW MODAL ON GRAIN CONTRACTS
  ============================================================ */

  function startingBushels(job) {
    return Math.max(0, n(job?.startingBushels ?? job?.jobBushels ?? job?.bushels));
  }

  function ticketBushels(ticket) {
    return Math.max(0, n(ticket?.netBushels ?? ticket?.netBu ?? ticket?.bushels));
  }

  function isVoided(ticket) {
    return ticket?.voided === true || clean(ticket?.status).toLowerCase().includes('void');
  }

  function ticketsFor(jobId) {
    return state.tickets.filter(ticket =>
      !isVoided(ticket) && clean(ticket?.haulingJobId) === clean(jobId)
    );
  }

  function soldUnder(job) {
    const direct = clean(job?.customerName || job?.soldUnderName || job?.soldUnder || job?.customer);
    if (direct && direct.toLowerCase() !== 'unknown') return direct;

    const id = clean(job?.customerId || job?.grainCustomerId || job?.soldUnderId);
    if (!id) return '—';
    return clean(state.customers.get(id)?.name) || '—';
  }

  function jobName(job) {
    const saved = clean(job?.displayName || job?.jobName || job?.haulingJobName);
    if (saved) return saved;

    const buyer = clean(job?.buyerName || job?.buyer);
    const locationName = clean(job?.deliveryLocationName || job?.locationName || job?.destinationName || job?.destination);
    const place = buyer && locationName && !locationName.toLowerCase().startsWith(buyer.toLowerCase())
      ? `${buyer} ${locationName}`
      : (locationName || buyer || 'Hauling Job');

    return `${place} — ${fmtBu(startingBushels(job))} bu`;
  }

  function jobCrop(job) {
    return clean(job?.crop || job?.commodity || job?.cropName || job?.cropType) || '—';
  }

  function ticketNumber(ticket) {
    return clean(ticket?.ticketNumber || ticket?.ticketNo || ticket?.number) || ticket?.id || 'Ticket';
  }

  function ticketDate(ticket) {
    return clean(ticket?.ticketDate || ticket?.date || ticket?.deliveryDate);
  }

  function gradeRaw(ticket, type) {
    if (type === 'mo') return rawNumber(ticket?.moisture ?? ticket?.mo ?? ticket?.MO);
    if (type === 'fm') return rawNumber(ticket?.foreignMaterial ?? ticket?.fm ?? ticket?.FM);
    return rawNumber(ticket?.damage ?? ticket?.damaged ?? ticket?.dm ?? ticket?.DM);
  }

  function weightedAverage(tickets, type) {
    let weighted = 0;
    let weight = 0;

    tickets.forEach(ticket => {
      const bushels = ticketBushels(ticket);
      const value = gradeRaw(ticket, type);
      if (value === null || !(bushels > 0)) return;
      weighted += value * bushels;
      weight += bushels;
    });

    return weight ? weighted / weight : null;
  }

  function gradeSeverity(crop, type, value) {
    const v = rawNumber(value);
    if (v === null) return 'good';

    if (type === 'mo') {
      const soy = clean(crop).toLowerCase().includes('soy');
      const warn = soy ? 13.5 : 16.5;
      const severe = soy ? 15.5 : 19;
      if (v > severe) return 'severe';
      if (v >= warn) return 'warn';
      return 'good';
    }

    if (type === 'fm') {
      if (v > 8) return 'severe';
      if (v >= 3) return 'warn';
      return 'good';
    }

    if (v > 9) return 'severe';
    if (v >= 5) return 'warn';
    return 'good';
  }

  function gradePill(crop, type, value) {
    const parsed = rawNumber(value);
    if (parsed === null) return '<span class="fv-grade-pill good">—</span>';
    const severity = gradeSeverity(crop, type, parsed);
    return `<span class="fv-grade-pill ${severity}">${escapeHtml(fmtTicketGrade(parsed))}</span>`;
  }

  async function loadData(force = false) {
    if (state.dataPromise && !force) return state.dataPromise;

    state.dataPromise = import('/js/firebase-init.js').then(async firebase => {
      await firebase.ready;
      const db = firebase.getFirestore();
      const [jobsSnap, ticketsSnap, customersSnap] = await Promise.all([
        firebase.getDocs(firebase.collection(db, 'grain_hauling_jobs')),
        firebase.getDocs(firebase.collection(db, 'grain_tickets')),
        firebase.getDocs(firebase.collection(db, 'grain_customers'))
      ]);

      state.jobs = new Map(jobsSnap.docs.map(docSnap => [docSnap.id, { id:docSnap.id, ...docSnap.data() }]));
      state.tickets = ticketsSnap.docs.map(docSnap => ({ id:docSnap.id, ...docSnap.data() }));
      state.customers = new Map(customersSnap.docs.map(docSnap => [docSnap.id, { id:docSnap.id, ...docSnap.data() }]));
    }).catch(error => {
      state.dataPromise = null;
      throw error;
    });

    return state.dataPromise;
  }

  function ensureOverviewModal() {
    let backdrop = document.getElementById('fv-contract-hauling-overview');
    if (backdrop) return backdrop;

    backdrop = document.createElement('div');
    backdrop.id = 'fv-contract-hauling-overview';
    backdrop.setAttribute('aria-hidden', 'true');
    backdrop.innerHTML = `
      <div class="fv-contract-job-modal" role="dialog" aria-modal="true" aria-labelledby="fv-contract-job-modal-title">
        <div class="fv-contract-job-modal-head">
          <div>
            <div class="fv-contract-job-modal-title" id="fv-contract-job-modal-title">Hauling Job</div>
            <div class="fv-contract-job-modal-sub" id="fv-contract-job-modal-sub"></div>
          </div>
          <div class="fv-contract-job-modal-head-actions">
            <button type="button" id="fv-contract-job-edit-btn">Edit Hauling Job</button>
            <button type="button" class="fv-contract-job-close" id="fv-contract-job-close" aria-label="Close">×</button>
          </div>
        </div>
        <div class="fv-contract-job-modal-body">
          <div class="fv-contract-job-summary" id="fv-contract-job-summary"></div>
          <div class="fv-contract-job-ticket-heading" id="fv-contract-job-ticket-heading">Assigned Tickets</div>
          <div id="fv-contract-job-ticket-list"></div>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);

    const close = () => {
      backdrop.classList.remove('open');
      backdrop.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    };

    backdrop.querySelector('#fv-contract-job-close').addEventListener('click', close);
    backdrop.addEventListener('click', event => {
      if (event.target === backdrop) close();
    });

    backdrop.querySelector('#fv-contract-job-edit-btn').addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();

      const jobId = clean(state.currentJobId);
      const row = state.currentRow;
      if (!jobId || !row) return;

      close();
      state.bypassJobId = jobId;
      row.click();
    });

    return backdrop;
  }

  function renderOverview(job, row) {
    const backdrop = ensureOverviewModal();
    const tickets = ticketsFor(job.id)
      .sort((a, b) => ticketDate(b).localeCompare(ticketDate(a)) || ticketNumber(a).localeCompare(ticketNumber(b), undefined, { numeric:true, sensitivity:'base' }));

    const ticketed = tickets.reduce((sum, ticket) => sum + ticketBushels(ticket), 0);
    const starting = startingBushels(job);
    const remaining = Math.max(0, starting - ticketed);
    const sold = soldUnder(job);
    const crop = jobCrop(job);

    state.currentJobId = job.id;
    state.currentRow = row;

    backdrop.querySelector('#fv-contract-job-modal-title').textContent = jobName(job);
    backdrop.querySelector('#fv-contract-job-modal-sub').textContent = [
      crop,
      sold !== '—' ? `Sold Under: ${sold}` : ''
    ].filter(Boolean).join(' • ');

    backdrop.querySelector('#fv-contract-job-summary').innerHTML = `
      <div class="fv-contract-job-box"><div class="fv-contract-job-label">Starting Bushels</div><div class="fv-contract-job-value">${fmtBu(starting)} bu</div></div>
      <div class="fv-contract-job-box"><div class="fv-contract-job-label">Ticketed Bushels</div><div class="fv-contract-job-value">${fmtBu(ticketed)} bu</div></div>
      <div class="fv-contract-job-box"><div class="fv-contract-job-label">Remaining</div><div class="fv-contract-job-value">${fmtBu(remaining)} bu</div></div>
      <div class="fv-contract-job-box"><div class="fv-contract-job-label">Loads Hauled</div><div class="fv-contract-job-value">${tickets.length.toLocaleString('en-US')}</div></div>
      <div class="fv-contract-job-box"><div class="fv-contract-job-label">Avg Moisture</div><div class="fv-contract-job-value">${fmtGrade(weightedAverage(tickets, 'mo'))}</div></div>
      <div class="fv-contract-job-box"><div class="fv-contract-job-label">Avg FM / Damage</div><div class="fv-contract-job-value">${fmtGrade(weightedAverage(tickets, 'fm'))} / ${fmtGrade(weightedAverage(tickets, 'damage'))}</div></div>
    `;

    const heading = backdrop.querySelector('#fv-contract-job-ticket-heading');
    heading.textContent = `Assigned Tickets (${tickets.length.toLocaleString('en-US')})`;

    const list = backdrop.querySelector('#fv-contract-job-ticket-list');
    if (!tickets.length) {
      list.innerHTML = '<div class="fv-contract-job-empty">No tickets are linked to this hauling job yet.</div>';
    } else {
      list.innerHTML = `
        <div class="fv-contract-job-table-wrap">
          <table class="fv-contract-job-table">
            <thead>
              <tr>
                <th>Ticket #</th>
                <th>Date</th>
                <th>Bushels</th>
                <th>MO</th>
                <th>FM</th>
                <th>Damage</th>
              </tr>
            </thead>
            <tbody>
              ${tickets.map(ticket => {
                const id = encodeURIComponent(clean(ticket.id));
                const ticketCrop = clean(ticket?.crop || crop);
                return `
                  <tr data-ticket-url="/pages/grain/grain-ticket-detail.html?id=${id}">
                    <td><a class="fv-contract-job-ticket-link" href="/pages/grain/grain-ticket-detail.html?id=${id}">Ticket ${escapeHtml(ticketNumber(ticket))}</a></td>
                    <td>${escapeHtml(ticketDate(ticket) || '—')}</td>
                    <td>${fmtBu(ticketBushels(ticket))} bu</td>
                    <td>${gradePill(ticketCrop, 'mo', gradeRaw(ticket, 'mo'))}</td>
                    <td>${gradePill(ticketCrop, 'fm', gradeRaw(ticket, 'fm'))}</td>
                    <td>${gradePill(ticketCrop, 'damage', gradeRaw(ticket, 'damage'))}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;

      list.querySelectorAll('tr[data-ticket-url]').forEach(ticketRow => {
        ticketRow.addEventListener('click', event => {
          if (event.target.closest('a')) return;
          location.href = ticketRow.dataset.ticketUrl;
        });
      });
    }

    backdrop.classList.add('open');
    backdrop.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  async function openOverview(jobId, row) {
    const backdrop = ensureOverviewModal();
    state.currentJobId = clean(jobId);
    state.currentRow = row;

    backdrop.querySelector('#fv-contract-job-modal-title').textContent = 'Loading Hauling Job…';
    backdrop.querySelector('#fv-contract-job-modal-sub').textContent = '';
    backdrop.querySelector('#fv-contract-job-summary').innerHTML = '';
    backdrop.querySelector('#fv-contract-job-ticket-list').innerHTML = '<div class="fv-contract-job-empty">Loading hauling job details…</div>';
    backdrop.classList.add('open');
    backdrop.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    try {
      await loadData(true);
      const job = state.jobs.get(clean(jobId));
      if (!job) throw new Error('Hauling job not found.');
      renderOverview(job, row);
    } catch (error) {
      console.error('[FarmVista] Hauling Job overview failed:', error);
      backdrop.querySelector('#fv-contract-job-modal-title').textContent = 'Hauling Job';
      backdrop.querySelector('#fv-contract-job-ticket-list').innerHTML = '<div class="fv-contract-job-empty">Hauling job details could not be loaded.</div>';
    }
  }

  function installHaulingRowOverview() {
    document.addEventListener('click', event => {
      const row = event.target?.closest?.('tr.hauling-row[data-hauling-job-id]');
      if (!row) return;

      const jobId = clean(row.dataset.haulingJobId);
      if (!jobId) return;

      if (state.bypassJobId === jobId) {
        state.bypassJobId = '';
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      openOverview(jobId, row);
    }, true);

    document.addEventListener('keydown', event => {
      if (!['Enter', ' '].includes(event.key)) return;
      const row = event.target?.closest?.('tr.hauling-row[data-hauling-job-id]');
      if (!row) return;

      const jobId = clean(row.dataset.haulingJobId);
      if (!jobId) return;

      if (state.bypassJobId === jobId) {
        state.bypassJobId = '';
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      openOverview(jobId, row);
    }, true);
  }

  function start() {
    ensureStyle();
    decorateAssignmentBlocks();
    installContractCollapse();
    installHaulingRowOverview();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once:true });
  } else {
    start();
  }
})();