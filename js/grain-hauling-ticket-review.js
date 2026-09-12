/* FarmVista — Grain Contracts hauling-job ticket review
   Sept. 12, 2026

   Keeps the normal ticket-to-hauling-job workspace clean by default.
   A Review All Jobs button opens a focused manager where active, upcoming,
   past-due, completed, and closed hauling jobs can be inspected and tickets
   can be manually unassigned from the wrong job.

   Manual hauling-job unassignment intentionally does NOT change the ticket's
   contract allocations or Spot bushels. That lets the office remove a ticket
   from an overhauled job first, then reconcile it to Spot or another contract.
*/
(() => {
  'use strict';

  if (window.__FV_HAULING_TICKET_REVIEW_20260912) return;
  window.__FV_HAULING_TICKET_REVIEW_20260912 = true;

  const path = String(location.pathname || '').toLowerCase();
  if (!path.endsWith('/pages/grain/grain-contracts.html')) return;

  const clean = value => String(value ?? '').trim();
  const norm = value => clean(value).toLowerCase();
  const num = value => {
    const parsed = Number(String(value ?? '').replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const esc = value => clean(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
  const fmtBu = value => num(value).toLocaleString('en-US', { maximumFractionDigits:2 });

  const state = {
    firebase: null,
    db: null,
    jobs: [],
    tickets: [],
    customers: new Map(),
    loading: false,
    busyTicketId: '',
    search: '',
    status: 'all'
  };

  function findBlock() {
    return [...document.querySelectorAll('.workflow-block')].find(block =>
      norm(block.querySelector('.workflow-block-title')?.textContent) === 'assign grain tickets to hauling jobs'
    ) || null;
  }

  function installStyles() {
    if (document.getElementById('fv-hauling-ticket-review-style')) return;

    const style = document.createElement('style');
    style.id = 'fv-hauling-ticket-review-style';
    style.textContent = `
      .fv-review-all-jobs-btn{
        min-height:36px;padding:7px 12px;border:1px solid rgba(79,113,143,.34);
        border-radius:9px;background:rgba(79,113,143,.10);color:inherit;font:inherit;
        font-size:.84rem;font-weight:850;cursor:pointer;white-space:nowrap
      }
      .fv-review-all-jobs-btn:hover,.fv-review-all-jobs-btn:focus{
        outline:none;background:rgba(79,113,143,.17)
      }
      #fv-hauling-ticket-review-modal{
        position:fixed;inset:0;z-index:12950;display:none;align-items:flex-start;
        justify-content:center;padding:20px;overflow:auto;background:rgba(0,0,0,.52)
      }
      #fv-hauling-ticket-review-modal.open{display:flex}
      .fv-hauling-review-card{
        width:min(980px,100%);margin:auto;overflow:hidden;border-radius:16px;
        background:var(--surface,#fff);color:var(--text,#111);box-shadow:0 18px 55px rgba(0,0,0,.30)
      }
      .fv-hauling-review-head{
        display:flex;align-items:flex-start;justify-content:space-between;gap:12px;
        padding:18px 20px;border-bottom:1px solid var(--border,#ddd)
      }
      .fv-hauling-review-title{font-size:1.2rem;font-weight:900}
      .fv-hauling-review-sub{margin-top:4px;font-size:.86rem;opacity:.68;line-height:1.4}
      .fv-hauling-review-close{
        width:40px;height:40px;flex:0 0 auto;border:0;border-radius:10px;
        background:var(--surface-2,#eee);color:inherit;font-size:1.25rem;cursor:pointer
      }
      .fv-hauling-review-body{padding:16px 20px 20px}
      .fv-hauling-review-controls{
        display:grid;grid-template-columns:minmax(220px,1fr) minmax(150px,220px) auto;
        gap:10px;align-items:end;margin-bottom:12px
      }
      .fv-hauling-review-field{display:flex;flex-direction:column;gap:5px;min-width:0}
      .fv-hauling-review-field label{font-size:.76rem;font-weight:800;opacity:.72}
      .fv-hauling-review-field input,.fv-hauling-review-field select{
        width:100%;min-height:40px;padding:8px 10px;border:1px solid var(--border,#ccc);
        border-radius:9px;background:var(--surface,#fff);color:inherit;font:inherit
      }
      .fv-hauling-review-refresh{
        min-height:40px;padding:8px 13px;border:0;border-radius:9px;background:var(--surface-2,#eee);
        color:inherit;font:inherit;font-weight:850;cursor:pointer
      }
      .fv-hauling-review-list{display:grid;gap:10px}
      .fv-hauling-review-job{
        overflow:hidden;border:1px solid var(--border,#d6d6d6);border-radius:11px;background:var(--surface,#fff)
      }
      .fv-hauling-review-job-toggle{
        width:100%;display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:12px;align-items:center;
        padding:12px 14px;border:0;background:var(--surface-2,#f4f4f4);color:inherit;font:inherit;text-align:left;cursor:pointer
      }
      .fv-hauling-review-job-toggle:hover,.fv-hauling-review-job-toggle:focus{outline:none;background:rgba(59,126,70,.08)}
      .fv-hauling-review-job-name{font-weight:900;line-height:1.25}
      .fv-hauling-review-job-meta{margin-top:3px;font-size:.76rem;opacity:.68;line-height:1.35}
      .fv-hauling-review-job-count{font-size:.78rem;font-weight:900;white-space:nowrap}
      .fv-hauling-review-chevron{font-size:1rem;font-weight:900;transition:transform .15s ease}
      .fv-hauling-review-job-toggle[aria-expanded="true"] .fv-hauling-review-chevron{transform:rotate(90deg)}
      .fv-hauling-review-job-body[hidden]{display:none!important}
      .fv-hauling-review-ticket-table-wrap{width:100%;overflow-x:auto}
      .fv-hauling-review-ticket-table{width:100%;min-width:720px;border-collapse:collapse}
      .fv-hauling-review-ticket-table th{
        padding:9px 11px;background:var(--surface,#fff);border-bottom:1px solid var(--border,#ddd);
        text-align:left;font-size:.73rem;font-weight:850;white-space:nowrap
      }
      .fv-hauling-review-ticket-table td{
        padding:9px 11px;border-bottom:1px solid var(--border,#e5e5e5);font-size:.82rem;vertical-align:middle;white-space:nowrap
      }
      .fv-hauling-review-ticket-table tbody tr:last-child td{border-bottom:0}
      .fv-hauling-review-ticket-table .number{text-align:right;font-variant-numeric:tabular-nums}
      .fv-hauling-review-ticket-link{font-weight:900;color:#3B7E46;text-decoration:none}
      .fv-hauling-review-ticket-link:hover{text-decoration:underline}
      .fv-hauling-review-unassign{
        min-height:32px;padding:5px 9px;border:1px solid rgba(179,38,30,.25);border-radius:8px;
        background:rgba(179,38,30,.08);color:#9d241e;font:inherit;font-size:.76rem;font-weight:900;cursor:pointer
      }
      .fv-hauling-review-unassign:disabled{opacity:.5;cursor:wait}
      [data-theme="dark"] .fv-hauling-review-unassign{color:#ffaaa4}
      .fv-hauling-review-status{
        display:inline-flex;align-items:center;justify-content:center;min-width:68px;padding:4px 8px;
        border-radius:999px;font-size:.7rem;font-weight:900;background:rgba(59,126,70,.12);color:#2d6937
      }
      .fv-hauling-review-status.completed{background:rgba(37,99,235,.12);color:#1d5bbf}
      .fv-hauling-review-status.upcoming{background:rgba(79,113,143,.12);color:#425f79}
      .fv-hauling-review-status.past_due{background:rgba(179,38,30,.12);color:#9d241e}
      .fv-hauling-review-status.closed{background:rgba(0,0,0,.08);color:inherit}
      [data-theme="dark"] .fv-hauling-review-status{color:#b9e4bf}
      [data-theme="dark"] .fv-hauling-review-status.completed{color:#a8c7ff}
      [data-theme="dark"] .fv-hauling-review-status.upcoming{color:#bed2e2}
      [data-theme="dark"] .fv-hauling-review-status.past_due{color:#ffaaa4}
      .fv-hauling-review-empty{padding:28px 16px;text-align:center;opacity:.65}
      .fv-hauling-review-note{
        margin-bottom:12px;padding:9px 11px;border-radius:9px;background:rgba(79,113,143,.08);
        font-size:.78rem;line-height:1.4;opacity:.85
      }
      @media(max-width:700px){
        #fv-hauling-ticket-review-modal{padding:0}
        .fv-hauling-review-card{width:100%;min-height:100vh;border-radius:0}
        .fv-hauling-review-body{padding:14px}
        .fv-hauling-review-controls{grid-template-columns:1fr 1fr}
        .fv-hauling-review-refresh{grid-column:1/-1}
        .fv-hauling-review-job-toggle{grid-template-columns:minmax(0,1fr) auto}
        .fv-hauling-review-job-count{grid-column:1/-1;grid-row:2}
      }
    `;
    document.head.appendChild(style);
  }

  async function firebaseContext() {
    if (state.firebase && state.db) return { firebase:state.firebase, db:state.db };
    const firebase = await import('/js/firebase-init.js');
    await firebase.ready;
    state.firebase = firebase;
    state.db = firebase.getFirestore();
    return { firebase, db:state.db };
  }

  function isVoided(record) {
    return record?.voided === true || norm(record?.status || record?.contractStatus).includes('void');
  }

  function localISO(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  }

  function jobStarting(job) {
    return Math.max(0, num(job?.startingBushels ?? job?.jobBushels ?? job?.bushels));
  }

  function ticketBushels(ticket) {
    return Math.max(0, num(ticket?.netBushels ?? ticket?.netBu ?? ticket?.bushels));
  }

  function ticketsFor(jobId) {
    return state.tickets
      .filter(ticket => !isVoided(ticket) && clean(ticket?.haulingJobId) === clean(jobId))
      .sort((a,b) => ticketDate(b).localeCompare(ticketDate(a)) || ticketNo(a).localeCompare(ticketNo(b), undefined, { numeric:true, sensitivity:'base' }));
  }

  function jobTicketed(job) {
    return ticketsFor(job.id).reduce((sum,ticket) => sum + ticketBushels(ticket), 0);
  }

  function jobStatus(job) {
    if (job?.manualClosed === true) return 'closed';
    const raw = norm(job?.status);
    if (job?.active === false || raw.includes('void')) return 'voided';
    if (raw.includes('closed') || raw.includes('cancel')) return 'closed';

    const start = clean(job?.deliveryStartDate || job?.startDate);
    const end = clean(job?.deliveryEndDate || job?.endDate);
    const remaining = Math.max(0, jobStarting(job) - jobTicketed(job));

    if (raw.includes('complete') || (jobStarting(job) > 0 && remaining <= .005)) return 'completed';
    if (start && start > localISO()) return 'upcoming';
    if (end && end < localISO() && remaining > .005) return 'past_due';
    return 'active';
  }

  function statusLabel(status) {
    return ({ active:'Active', upcoming:'Upcoming', past_due:'Past Due', completed:'Completed', closed:'Closed' })[status] || 'Active';
  }

  function jobCrop(job) {
    return clean(job?.crop || job?.commodity || job?.cropName || job?.cropType) || '—';
  }

  function soldUnder(job) {
    const direct = clean(job?.customerName || job?.soldUnderName || job?.soldUnder || job?.customer);
    if (direct && norm(direct) !== 'unknown') return direct;
    const id = clean(job?.customerId || job?.grainCustomerId || job?.soldUnderId);
    return clean(state.customers.get(id)?.name) || '—';
  }

  function jobName(job) {
    const saved = clean(job?.displayName || job?.jobName || job?.haulingJobName);
    if (saved) return saved;
    const buyer = clean(job?.buyerName || job?.buyer);
    const location = clean(job?.deliveryLocationName || job?.locationName || job?.destinationName || job?.destination);
    const place = buyer && location && !norm(location).startsWith(norm(buyer)) ? `${buyer} ${location}` : (location || buyer || 'Hauling Job');
    return `${place} — ${fmtBu(jobStarting(job))} bu`;
  }

  function ticketNo(ticket) {
    return clean(ticket?.ticketNumber || ticket?.ticketNo || ticket?.number || ticket?.scaleTicketNumber) || clean(ticket?.id).slice(0,10) || 'Ticket';
  }

  function ticketDate(ticket) {
    return clean(ticket?.ticketDate || ticket?.date || ticket?.deliveryDate) || '—';
  }

  function ticketSoldUnder(ticket) {
    const direct = clean(ticket?.customerName || ticket?.soldUnderName || ticket?.soldUnder || ticket?.customer);
    if (direct && norm(direct) !== 'unknown') return direct;
    const id = clean(ticket?.customerId || ticket?.grainCustomerId || ticket?.soldUnderId);
    return clean(state.customers.get(id)?.name) || '—';
  }

  async function loadData() {
    if (state.loading) return;
    state.loading = true;
    renderLoading();

    try {
      const { firebase, db } = await firebaseContext();
      const [jobSnap, ticketSnap, customerSnap] = await Promise.all([
        firebase.getDocs(firebase.collection(db, 'grain_hauling_jobs')),
        firebase.getDocs(firebase.collection(db, 'grain_tickets')),
        firebase.getDocs(firebase.collection(db, 'grain_customers'))
      ]);

      state.jobs = jobSnap.docs.map(docSnap => ({ id:docSnap.id, ...docSnap.data() })).filter(job => !isVoided(job));
      state.tickets = ticketSnap.docs.map(docSnap => ({ id:docSnap.id, ...docSnap.data() })).filter(ticket => !isVoided(ticket));
      state.customers = new Map(customerSnap.docs.map(docSnap => [docSnap.id, { id:docSnap.id, ...docSnap.data() }]));
      renderJobs();
    } catch (error) {
      console.error('[Hauling Ticket Review] load failed:', error);
      const list = document.getElementById('fv-hauling-review-list');
      if (list) list.innerHTML = `<div class="fv-hauling-review-empty">${esc(error?.message || 'FarmVista could not load hauling jobs.')}</div>`;
    } finally {
      state.loading = false;
    }
  }

  function renderLoading() {
    const list = document.getElementById('fv-hauling-review-list');
    if (list) list.innerHTML = '<div class="fv-hauling-review-empty">Loading hauling jobs…</div>';
  }

  function filteredJobs() {
    const rank = { active:1, past_due:2, upcoming:3, completed:4, closed:5 };
    return state.jobs
      .filter(job => {
        const status = jobStatus(job);
        if (state.status !== 'all' && status !== state.status) return false;
        if (!state.search) return true;
        const haystack = [jobName(job), job?.buyerName, job?.deliveryLocationName, soldUnder(job), jobCrop(job), statusLabel(status)].join(' ').toLowerCase();
        return haystack.includes(state.search);
      })
      .sort((a,b) => {
        const sa = jobStatus(a), sb = jobStatus(b);
        return (rank[sa] || 99) - (rank[sb] || 99) ||
          clean(b?.deliveryEndDate || b?.endDate).localeCompare(clean(a?.deliveryEndDate || a?.endDate)) ||
          jobName(a).localeCompare(jobName(b), undefined, { numeric:true, sensitivity:'base' });
      });
  }

  function ticketRows(job, tickets) {
    return tickets.map(ticket => `
      <tr data-fv-review-ticket-row="${esc(ticket.id)}">
        <td><a class="fv-hauling-review-ticket-link" href="/pages/grain/grain-ticket-detail.html?id=${encodeURIComponent(clean(ticket.id))}">${esc(ticketNo(ticket))}</a></td>
        <td>${esc(ticketDate(ticket))}</td>
        <td>${esc(ticketSoldUnder(ticket))}</td>
        <td class="number">${fmtBu(ticketBushels(ticket))} bu</td>
        <td><button type="button" class="fv-hauling-review-unassign" data-ticket-id="${esc(ticket.id)}" data-job-id="${esc(job.id)}" ${state.busyTicketId === ticket.id ? 'disabled' : ''}>${state.busyTicketId === ticket.id ? 'Unassigning…' : 'Unassign'}</button></td>
      </tr>
    `).join('');
  }

  function renderJobs() {
    const list = document.getElementById('fv-hauling-review-list');
    if (!list) return;

    const jobs = filteredJobs();
    if (!jobs.length) {
      list.innerHTML = '<div class="fv-hauling-review-empty">No hauling jobs match this view.</div>';
      return;
    }

    list.innerHTML = jobs.map(job => {
      const tickets = ticketsFor(job.id);
      const status = jobStatus(job);
      const ticketed = tickets.reduce((sum,ticket) => sum + ticketBushels(ticket), 0);
      const remaining = Math.max(0, jobStarting(job) - ticketed);
      return `
        <div class="fv-hauling-review-job" data-review-job-id="${esc(job.id)}">
          <button type="button" class="fv-hauling-review-job-toggle" aria-expanded="false">
            <span>
              <span class="fv-hauling-review-job-name"><span class="fv-hauling-review-status ${esc(status)}">${esc(statusLabel(status))}</span> &nbsp;${esc(jobName(job))}</span>
              <span class="fv-hauling-review-job-meta">${esc(job?.buyerName || '—')} • ${esc(job?.deliveryLocationName || '—')} • Sold Under: ${esc(soldUnder(job))} • ${esc(jobCrop(job))} • ${fmtBu(remaining)} bu remaining</span>
            </span>
            <span class="fv-hauling-review-job-count">${tickets.length} ${tickets.length === 1 ? 'ticket' : 'tickets'} • ${fmtBu(ticketed)} bu</span>
            <span class="fv-hauling-review-chevron" aria-hidden="true">›</span>
          </button>
          <div class="fv-hauling-review-job-body" hidden>
            ${tickets.length ? `
              <div class="fv-hauling-review-ticket-table-wrap">
                <table class="fv-hauling-review-ticket-table">
                  <thead><tr><th>Ticket #</th><th>Date</th><th>Sold Under</th><th class="number">Net Bu.</th><th>Action</th></tr></thead>
                  <tbody>${ticketRows(job,tickets)}</tbody>
                </table>
              </div>
            ` : '<div class="fv-hauling-review-empty">No tickets are assigned to this hauling job.</div>'}
          </div>
        </div>
      `;
    }).join('');

    list.querySelectorAll('.fv-hauling-review-job-toggle').forEach(button => {
      button.addEventListener('click', () => {
        const expanded = button.getAttribute('aria-expanded') === 'true';
        button.setAttribute('aria-expanded', expanded ? 'false' : 'true');
        const body = button.closest('.fv-hauling-review-job')?.querySelector('.fv-hauling-review-job-body');
        if (body) body.hidden = expanded;
      });
    });

    list.querySelectorAll('.fv-hauling-review-unassign').forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        unassignTicket(clean(button.dataset.ticketId), clean(button.dataset.jobId));
      });
    });
  }

  async function unassignTicket(ticketId, jobId) {
    if (!ticketId || !jobId || state.busyTicketId) return;
    const ticket = state.tickets.find(item => item.id === ticketId);
    const job = state.jobs.find(item => item.id === jobId);
    if (!ticket || !job) return;

    if (!window.confirm(
      `Unassign Ticket ${ticketNo(ticket)} from ${jobName(job)}?\n\n` +
      `This only removes the hauling-job assignment. Contract or Spot allocation will not be changed.`
    )) return;

    state.busyTicketId = ticketId;
    renderJobs();

    try {
      const { firebase, db } = await firebaseContext();
      const user = firebase.getAuth()?.currentUser;
      await firebase.updateDoc(firebase.doc(db, 'grain_tickets', ticketId), {
        haulingJobId:null,
        haulingJobName:null,
        haulingJobAssignmentSource:null,
        haulingJobAssignedAt:null,
        haulingJobManualUnassignedFromJobId:jobId,
        haulingJobManualUnassignedAt:firebase.serverTimestamp(),
        haulingJobManualUnassignedByUid:user?.uid || null,
        haulingJobManualUnassignedByName:user?.displayName || user?.email || 'FarmVista User',
        updatedAt:firebase.serverTimestamp()
      });

      ticket.haulingJobId = null;
      ticket.haulingJobName = null;
      ticket.haulingJobAssignmentSource = null;
      ticket.haulingJobManualUnassignedFromJobId = jobId;

      requestWorkspaceRefresh();
      renderJobs();
    } catch (error) {
      console.error('[Hauling Ticket Review] unassign failed:', error);
      alert(error?.message || 'FarmVista could not unassign that ticket.');
    } finally {
      state.busyTicketId = '';
      renderJobs();
    }
  }

  function requestWorkspaceRefresh() {
    const block = findBlock();
    const refresh = [...(block?.querySelectorAll('button') || [])].find(button => norm(button.textContent) === 'refresh');
    if (refresh) {
      setTimeout(() => refresh.click(), 100);
      return;
    }
    document.getElementById('refresh-hauling-link-btn')?.click();
  }

  function ensureModal() {
    let modal = document.getElementById('fv-hauling-ticket-review-modal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'fv-hauling-ticket-review-modal';
    modal.setAttribute('aria-hidden','true');
    modal.innerHTML = `
      <div class="fv-hauling-review-card" role="dialog" aria-modal="true" aria-labelledby="fv-hauling-review-title">
        <div class="fv-hauling-review-head">
          <div>
            <div class="fv-hauling-review-title" id="fv-hauling-review-title">Review All Hauling Jobs</div>
            <div class="fv-hauling-review-sub">Find tickets on active, upcoming, completed, past-due, or closed jobs and remove a wrong hauling-job assignment.</div>
          </div>
          <button type="button" class="fv-hauling-review-close" aria-label="Close">×</button>
        </div>
        <div class="fv-hauling-review-body">
          <div class="fv-hauling-review-note">Unassigning here only breaks the hauling-job link. The ticket's contract or Spot allocation stays exactly as it is so you can reconcile it next.</div>
          <div class="fv-hauling-review-controls">
            <div class="fv-hauling-review-field"><label for="fv-hauling-review-search">Search Jobs</label><input id="fv-hauling-review-search" type="search" placeholder="Buyer, location, sold under, crop…"></div>
            <div class="fv-hauling-review-field"><label for="fv-hauling-review-status">Status</label><select id="fv-hauling-review-status"><option value="all">All Jobs</option><option value="active">Active</option><option value="upcoming">Upcoming</option><option value="past_due">Past Due</option><option value="completed">Completed</option><option value="closed">Closed</option></select></div>
            <button type="button" class="fv-hauling-review-refresh">Refresh</button>
          </div>
          <div class="fv-hauling-review-list" id="fv-hauling-review-list"></div>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const close = () => {
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden','true');
      document.body.style.overflow = '';
    };
    modal.querySelector('.fv-hauling-review-close')?.addEventListener('click', close);
    modal.addEventListener('click', event => { if (event.target === modal) close(); });
    modal.querySelector('.fv-hauling-review-refresh')?.addEventListener('click', loadData);
    modal.querySelector('#fv-hauling-review-search')?.addEventListener('input', event => {
      state.search = norm(event.target.value);
      renderJobs();
    });
    modal.querySelector('#fv-hauling-review-status')?.addEventListener('change', event => {
      state.status = clean(event.target.value) || 'all';
      renderJobs();
    });

    return modal;
  }

  function openModal() {
    const modal = ensureModal();
    modal.classList.add('open');
    modal.setAttribute('aria-hidden','false');
    document.body.style.overflow = 'hidden';
    loadData();
  }

  function installButton() {
    const block = findBlock();
    if (!block || block.querySelector('.fv-review-all-jobs-btn')) return;

    const toolbar = block.querySelector('.dnd-toolbar');
    const right = toolbar?.querySelector('.dnd-toolbar-right') || toolbar;
    if (!right) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'fv-review-all-jobs-btn';
    button.textContent = 'Review All Jobs';
    button.title = 'See every non-voided hauling job and unassign tickets from the wrong job';
    button.addEventListener('click', openModal);

    const refresh = [...right.querySelectorAll('button')].find(item => norm(item.textContent) === 'refresh');
    if (refresh) right.insertBefore(button, refresh);
    else right.appendChild(button);
  }

  function start() {
    installStyles();
    ensureModal();
    installButton();

    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        installButton();
      });
    }).observe(document.body, { childList:true, subtree:true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();
})();
