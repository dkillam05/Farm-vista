/* FarmVista — Grain Contracts hauling-job compact cards + overview modal
   Sept. 11, 2026

   Grain Contracts only:
   - Hauling Job assignment cards stay compact when they already have tickets.
   - Clicking a Hauling Job row opens a quick overview first instead of jumping
     directly into edit mode.
   - The overview has a green Edit Hauling Job button in the TOP header with
     forced white text; Edit then opens the existing Hauling Job edit modal.

   Grain Inventory is intentionally untouched. It remains quick-overview only.
*/
(() => {
  'use strict';

  if (window.__FV_HAULING_JOB_UX_20260911_V2) return;
  window.__FV_HAULING_JOB_UX_20260911_V2 = true;

  const clean = value => String(value ?? '').trim();
  const path = String(location.pathname || '').toLowerCase();
  const isContracts = path.endsWith('/pages/grain/grain-contracts.html');

  if (!isContracts) return;

  const n = value => {
    const parsed = Number(String(value ?? '').replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const fmtBu = value => n(value).toLocaleString('en-US', {
    maximumFractionDigits: 2
  });

  const fmtGrade = value => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? `${parsed.toFixed(2)}%` : '—';
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

      #fv-contract-hauling-overview{
        position:fixed;
        inset:0;
        z-index:12600;
        display:none;
        align-items:center;
        justify-content:center;
        padding:18px;
        background:rgba(0,0,0,.48);
      }
      #fv-contract-hauling-overview.open{display:flex}
      .fv-contract-job-modal{
        width:min(760px,96vw);
        max-height:min(86vh,840px);
        overflow:hidden;
        border:1px solid var(--border,#ddd);
        border-radius:16px;
        background:var(--surface,#fff);
        color:var(--text,#111);
        box-shadow:0 22px 60px rgba(0,0,0,.28);
      }
      .fv-contract-job-modal-head{
        display:flex;
        align-items:flex-start;
        justify-content:space-between;
        gap:14px;
        padding:16px 18px;
        border-bottom:1px solid var(--border,#ddd);
      }
      .fv-contract-job-modal-title{font-size:1.15rem;font-weight:900;line-height:1.25}
      .fv-contract-job-modal-sub{margin-top:4px;font-size:.84rem;opacity:.7;line-height:1.35}
      .fv-contract-job-modal-head-actions{display:flex;align-items:center;gap:8px;flex:0 0 auto}
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
        width:38px;
        height:38px;
        border:0;
        border-radius:10px;
        background:var(--surface-2,#eee);
        color:var(--text,#111);
        font-size:1.25rem;
        cursor:pointer;
      }
      .fv-contract-job-modal-body{padding:16px 18px 18px;overflow:auto;max-height:calc(min(86vh,840px) - 76px)}
      .fv-contract-job-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}
      .fv-contract-job-box{padding:11px 12px;border-radius:10px;background:var(--surface-2,rgba(0,0,0,.05));min-width:0}
      .fv-contract-job-label{font-size:.72rem;opacity:.67;margin-bottom:4px}
      .fv-contract-job-value{font-weight:900;font-size:.98rem;overflow-wrap:anywhere}
      .fv-contract-job-ticket-heading{margin:18px 0 8px;font-size:.82rem;font-weight:900;opacity:.72}
      .fv-contract-job-ticket-list{display:grid;gap:8px}
      .fv-contract-job-ticket{
        display:grid;
        grid-template-columns:minmax(0,1fr) auto;
        gap:10px;
        padding:10px 11px;
        border:1px solid var(--border,#ddd);
        border-radius:10px;
        background:var(--surface,#fff);
        color:var(--text,#111);
        text-decoration:none;
      }
      .fv-contract-job-ticket:hover{border-color:#3B7E46;background:rgba(59,126,70,.05)}
      .fv-contract-job-ticket-number{font-weight:900}
      .fv-contract-job-ticket-meta{margin-top:3px;font-size:.76rem;opacity:.7;line-height:1.35}
      .fv-contract-job-ticket-bu{font-weight:900;white-space:nowrap}
      .fv-contract-job-empty{padding:22px 10px;text-align:center;opacity:.64}
      @media(max-width:620px){
        .fv-contract-job-modal-head{align-items:center}
        .fv-contract-job-modal-head-actions{gap:6px}
        #fv-contract-job-edit-btn{padding:8px 10px;font-size:.8rem}
        .fv-contract-job-summary{grid-template-columns:repeat(2,minmax(0,1fr))}
      }
    `;
    document.head.appendChild(style);
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

  function grade(ticket, type) {
    if (type === 'mo') return n(ticket?.moisture ?? ticket?.mo ?? ticket?.MO);
    if (type === 'fm') return n(ticket?.foreignMaterial ?? ticket?.fm ?? ticket?.FM);
    return n(ticket?.damage ?? ticket?.damaged ?? ticket?.dm ?? ticket?.DM);
  }

  function weightedAverage(tickets, type) {
    let weighted = 0;
    let weight = 0;

    tickets.forEach(ticket => {
      const bushels = ticketBushels(ticket);
      const raw = type === 'mo'
        ? (ticket?.moisture ?? ticket?.mo ?? ticket?.MO)
        : type === 'fm'
          ? (ticket?.foreignMaterial ?? ticket?.fm ?? ticket?.FM)
          : (ticket?.damage ?? ticket?.damaged ?? ticket?.dm ?? ticket?.DM);

      const value = Number(raw);
      if (!Number.isFinite(value) || !(bushels > 0)) return;
      weighted += value * bushels;
      weight += bushels;
    });

    return weight ? weighted / weight : null;
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
          <div class="fv-contract-job-ticket-list" id="fv-contract-job-ticket-list"></div>
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

    state.currentJobId = job.id;
    state.currentRow = row;

    backdrop.querySelector('#fv-contract-job-modal-title').textContent = jobName(job);
    backdrop.querySelector('#fv-contract-job-modal-sub').textContent = [
      jobCrop(job),
      sold !== '—' ? `Sold Under: ${sold}` : ''
    ].filter(Boolean).join(' • ');

    backdrop.querySelector('#fv-contract-job-summary').innerHTML = `
      <div class="fv-contract-job-box"><div class="fv-contract-job-label">Starting Bushels</div><div class="fv-contract-job-value">${fmtBu(starting)} bu</div></div>
      <div class="fv-contract-job-box"><div class="fv-contract-job-label">Ticketed Bushels</div><div class="fv-contract-job-value">${fmtBu(ticketed)} bu</div></div>
      <div class="fv-contract-job-box"><div class="fv-contract-job-label">Remaining</div><div class="fv-contract-job-value">${fmtBu(remaining)} bu</div></div>
      <div class="fv-contract-job-box"><div class="fv-contract-job-label">Loads</div><div class="fv-contract-job-value">${tickets.length.toLocaleString('en-US')}</div></div>
      <div class="fv-contract-job-box"><div class="fv-contract-job-label">Avg Moisture</div><div class="fv-contract-job-value">${fmtGrade(weightedAverage(tickets, 'mo'))}</div></div>
      <div class="fv-contract-job-box"><div class="fv-contract-job-label">Avg FM / Damage</div><div class="fv-contract-job-value">${fmtGrade(weightedAverage(tickets, 'fm'))} / ${fmtGrade(weightedAverage(tickets, 'damage'))}</div></div>
    `;

    const heading = backdrop.querySelector('#fv-contract-job-ticket-heading');
    heading.textContent = `Assigned Tickets (${tickets.length.toLocaleString('en-US')})`;

    const list = backdrop.querySelector('#fv-contract-job-ticket-list');
    if (!tickets.length) {
      list.innerHTML = '<div class="fv-contract-job-empty">No tickets are linked to this hauling job yet.</div>';
    } else {
      list.innerHTML = tickets.map(ticket => {
        const id = encodeURIComponent(clean(ticket.id));
        const grades = [
          Number.isFinite(Number(ticket?.moisture ?? ticket?.mo ?? ticket?.MO)) ? `MO ${grade(ticket, 'mo').toFixed(1)}` : '',
          Number.isFinite(Number(ticket?.foreignMaterial ?? ticket?.fm ?? ticket?.FM)) ? `FM ${grade(ticket, 'fm').toFixed(1)}` : '',
          Number.isFinite(Number(ticket?.damage ?? ticket?.damaged ?? ticket?.dm ?? ticket?.DM)) ? `DM ${grade(ticket, 'damage').toFixed(1)}` : ''
        ].filter(Boolean).join(' • ');

        return `
          <a class="fv-contract-job-ticket" href="/pages/grain/grain-ticket-detail.html?id=${id}">
            <div>
              <div class="fv-contract-job-ticket-number">Ticket ${escapeHtml(ticketNumber(ticket))}</div>
              <div class="fv-contract-job-ticket-meta">${escapeHtml([ticketDate(ticket), grades].filter(Boolean).join(' • '))}</div>
            </div>
            <div class="fv-contract-job-ticket-bu">${fmtBu(ticketBushels(ticket))} bu</div>
          </a>
        `;
      }).join('');
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
    installContractCollapse();
    installHaulingRowOverview();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once:true });
  } else {
    start();
  }
})();
