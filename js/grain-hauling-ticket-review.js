/* FarmVista — Grain Contracts all-hauling-jobs DND mode
   Sept. 12, 2026

   Keeps the normal contextual Ticket -> Hauling Job view as the default.
   "Show All Jobs" expands the SAME drag-and-drop workspace so the office can
   review completed / overhauled jobs, move tickets to another compatible job,
   or drag tickets back to Unassigned. No separate review modal or Unassign
   buttons are used.
*/
(() => {
  'use strict';

  if (window.__FV_HAULING_ALL_JOBS_DND_20260912) return;
  window.__FV_HAULING_ALL_JOBS_DND_20260912 = true;

  const path = String(location.pathname || '').toLowerCase();
  if (!path.endsWith('/pages/grain/grain-contracts.html')) return;

  const clean = value => String(value ?? '').trim();
  const norm = value => clean(value).toLowerCase().replace(/[^a-z0-9]/g, '');
  const num = value => {
    const parsed = Number(String(value ?? '').replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const fmtBu = value => num(value).toLocaleString('en-US', { maximumFractionDigits:2 });
  const esc = value => clean(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  const state = {
    allMode:false,
    firebase:null,
    db:null,
    jobs:new Map(),
    tickets:new Map(),
    customers:new Map(),
    loading:null,
    rendering:false,
    renderQueued:false,
    busy:false,
    touch:{
      timer:0,
      active:false,
      source:null,
      ghost:null,
      target:null,
      ids:[],
      startX:0,
      startY:0
    }
  };

  function isVoided(record) {
    const raw = clean(record?.status || record?.contractStatus).toLowerCase();
    return record?.voided === true || raw.includes('void');
  }

  function isClosed(record) {
    const raw = clean(record?.status).toLowerCase();
    return record?.manualClosed === true || raw.includes('closed') || raw.includes('cancel');
  }

  function cropKey(value) {
    const key = norm(value);
    if (key === 'corn' || key === 'yellowcorn') return 'corn';
    if (['soy','soybean','soybeans','bean','beans','yellowsoybeans'].includes(key)) return 'soybeans';
    return key;
  }

  function ticketHasContract(ticket) {
    if (!ticket) return false;
    if (clean(ticket.contractId)) return true;
    return Array.isArray(ticket.contractAllocations) && ticket.contractAllocations.some(allocation =>
      clean(allocation?.contractId) && num(allocation?.bushels) > .005
    );
  }

  function ticketBushels(ticket) {
    return Math.max(0, num(ticket?.netBushels ?? ticket?.netBu ?? ticket?.bushels));
  }

  function ticketNo(ticket) {
    return clean(ticket?.ticketNumber || ticket?.ticketNo || ticket?.ticket || ticket?.number) || clean(ticket?.id) || 'Ticket';
  }

  function ticketDate(ticket) {
    return clean(ticket?.ticketDate || ticket?.date || ticket?.deliveryDate) || 'No date';
  }

  function jobTarget(job) {
    return Math.max(0, num(job?.startingBushels ?? job?.jobBushels ?? job?.bushels));
  }

  function jobName(job) {
    const saved = clean(job?.displayName || job?.jobName || job?.haulingJobName);
    if (saved) return saved;
    const buyer = clean(job?.buyerName || job?.buyer);
    const location = clean(job?.deliveryLocationName || job?.locationName || job?.destinationName || job?.destination);
    const place = buyer && location && !norm(location).startsWith(norm(buyer))
      ? `${buyer} ${location}`
      : (location || buyer || 'Hauling Job');
    return `${place} — ${fmtBu(jobTarget(job))} bu`;
  }

  function soldUnder(record) {
    const direct = clean(record?.customerName || record?.soldUnderName || record?.soldUnder || record?.customer);
    if (direct && direct.toLowerCase() !== 'unknown') return direct;
    const id = clean(record?.customerId || record?.grainCustomerId || record?.soldUnderId);
    return clean(state.customers.get(id)?.name) || '—';
  }

  function jobBuyer(job) {
    return clean(job?.buyerName || job?.buyer || job?.grainBuyerName);
  }

  function jobBuyerId(job) {
    return clean(job?.buyerId || job?.grainBuyerId);
  }

  function jobLocation(job) {
    return clean(job?.deliveryLocationName || job?.locationName || job?.destinationName || job?.destination);
  }

  function jobLocationId(job) {
    return clean(job?.deliveryLocationId || job?.locationId || job?.destinationId);
  }

  function jobCrop(job) {
    return clean(job?.crop || job?.commodity || job?.cropName || job?.cropType);
  }

  function ticketBuyer(ticket) {
    return clean(ticket?.buyerName || ticket?.destinationBuyerName || ticket?.elevatorName);
  }

  function ticketBuyerId(ticket) {
    return clean(ticket?.buyerId || ticket?.grainBuyerId || ticket?.destinationBuyerId);
  }

  function ticketLocation(ticket) {
    return clean(ticket?.deliveryLocationName || ticket?.locationName || ticket?.destinationName || ticket?.destination || ticket?.elevator);
  }

  function ticketLocationId(ticket) {
    return clean(ticket?.deliveryLocationId || ticket?.locationId || ticket?.destinationId);
  }

  function idsOrNamesMatch(aId, aName, bId, bName) {
    if (aId && bId) return clean(aId) === clean(bId);
    if (aName && bName) return norm(aName) === norm(bName);
    return true;
  }

  function ticketMatchesJob(ticket, job) {
    if (!ticket || !job) return false;
    if (!idsOrNamesMatch(ticketBuyerId(ticket), ticketBuyer(ticket), jobBuyerId(job), jobBuyer(job))) return false;
    if (!idsOrNamesMatch(ticketLocationId(ticket), ticketLocation(ticket), jobLocationId(job), jobLocation(job))) return false;
    const tc = cropKey(ticket?.crop || ticket?.commodity || ticket?.grain || ticket?.cropName);
    const jc = cropKey(jobCrop(job));
    if (tc && jc && tc !== jc) return false;
    return true;
  }

  function localISO() {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  }

  function ticketsForJob(jobId) {
    return Array.from(state.tickets.values())
      .filter(ticket => !isVoided(ticket) && clean(ticket?.haulingJobId) === clean(jobId))
      .sort((a,b) => ticketDate(b).localeCompare(ticketDate(a)) || ticketNo(a).localeCompare(ticketNo(b), undefined, { numeric:true, sensitivity:'base' }));
  }

  function jobStatus(job) {
    const raw = clean(job?.status).toLowerCase();
    const target = jobTarget(job);
    const ticketed = ticketsForJob(job.id).reduce((sum,ticket) => sum + ticketBushels(ticket), 0);
    const start = clean(job?.deliveryStartDate || job?.startDate);
    const end = clean(job?.deliveryEndDate || job?.endDate);

    if (isVoided(job)) return 'voided';
    if (isClosed(job)) return 'closed';
    if (raw.includes('complete') || (target > 0 && ticketed >= target - .005)) return 'completed';
    if (start && start > localISO()) return 'upcoming';
    if (end && end < localISO() && ticketed < target - .005) return 'past_due';
    return 'active';
  }

  function statusLabel(status) {
    return ({ active:'Active', upcoming:'Upcoming', past_due:'Past Due', completed:'Completed' })[status] || 'Active';
  }

  function availableJobs() {
    return Array.from(state.jobs.values())
      .filter(job => !['voided','closed'].includes(jobStatus(job)))
      .sort((a,b) => {
        const order = { past_due:0, active:1, upcoming:2, completed:3 };
        const diff = (order[jobStatus(a)] ?? 9) - (order[jobStatus(b)] ?? 9);
        if (diff) return diff;
        return clean(a?.deliveryStartDate || a?.startDate).localeCompare(clean(b?.deliveryStartDate || b?.startDate)) ||
          jobName(a).localeCompare(jobName(b), undefined, { numeric:true, sensitivity:'base' });
      });
  }

  async function context(force = false) {
    if (state.loading && !force) return state.loading;
    state.loading = (async () => {
      const firebase = state.firebase || await import('/js/firebase-init.js');
      await firebase.ready;
      state.firebase = firebase;
      state.db = firebase.getFirestore();

      const [jobsSnap,ticketsSnap,customersSnap] = await Promise.all([
        firebase.getDocs(firebase.collection(state.db,'grain_hauling_jobs')),
        firebase.getDocs(firebase.collection(state.db,'grain_tickets')),
        firebase.getDocs(firebase.collection(state.db,'grain_customers'))
      ]);

      state.jobs = new Map(jobsSnap.docs.map(snapshot => [snapshot.id,{ id:snapshot.id,...snapshot.data() }]));
      state.tickets = new Map(ticketsSnap.docs.map(snapshot => [snapshot.id,{ id:snapshot.id,...snapshot.data() }]));
      state.customers = new Map(customersSnap.docs.map(snapshot => [snapshot.id,{ id:snapshot.id,...snapshot.data() }]));
    })().catch(error => {
      console.warn('[FarmVista] Show All Hauling Jobs load failed:', error);
    }).finally(() => {
      state.loading = null;
    });
    return state.loading;
  }

  function installStyles() {
    if (document.getElementById('fv-all-hauling-jobs-dnd-style')) return;
    const style = document.createElement('style');
    style.id = 'fv-all-hauling-jobs-dnd-style';
    style.textContent = `
      .fv-show-all-jobs-btn{
        min-height:36px;padding:7px 11px;border:1px solid rgba(79,113,143,.35);border-radius:9px;
        background:rgba(79,113,143,.10);color:inherit;font:inherit;font-size:.84rem;font-weight:850;cursor:pointer;white-space:nowrap
      }
      .fv-show-all-jobs-btn:hover,.fv-show-all-jobs-btn:focus{outline:none;background:rgba(79,113,143,.18)}
      .fv-show-all-jobs-btn.active{background:#4f718f;color:#fff;border-color:#4f718f}
      .fv-alljobs-status{display:inline-flex;align-items:center;justify-content:center;margin-left:7px;padding:2px 7px;border-radius:999px;font-size:.68rem;font-weight:900;vertical-align:middle}
      .fv-alljobs-status.active{background:rgba(59,126,70,.14);color:#2d6937}
      .fv-alljobs-status.upcoming{background:rgba(230,126,34,.16);color:#a65300}
      .fv-alljobs-status.past_due{background:rgba(179,38,30,.13);color:#9d241e}
      .fv-alljobs-status.completed{background:rgba(37,99,235,.14);color:#1d5bbf}
      .fv-alljobs-over{font-weight:900;color:#9d241e}
      .fv-alljobs-remaining{font-weight:850}
      .fv-ticket-job-card.fv-alljobs-completed{border-color:rgba(37,99,235,.45)}
      .fv-ticket-job-card.fv-alljobs-overhauled{box-shadow:inset 4px 0 0 rgba(179,38,30,.72)}
      [data-theme="dark"] .fv-alljobs-status.active{color:#b9e4bf}
      [data-theme="dark"] .fv-alljobs-status.upcoming{color:#f4bb78}
      [data-theme="dark"] .fv-alljobs-status.past_due,[data-theme="dark"] .fv-alljobs-over{color:#ffaaa4}
      [data-theme="dark"] .fv-alljobs-status.completed{color:#a8c7ff}
    `;
    document.head.appendChild(style);
  }

  function ensureButton() {
    const toolbar = document.querySelector('#fv-ticket-hauling-block .fv-ticket-hauling-toolbar');
    if (!toolbar) return null;
    let button = document.getElementById('fv-show-all-hauling-jobs');
    if (button) return button;

    button = document.createElement('button');
    button.type = 'button';
    button.id = 'fv-show-all-hauling-jobs';
    button.className = 'fv-show-all-jobs-btn';
    button.textContent = 'Show All Jobs';
    button.setAttribute('aria-pressed','false');

    const refresh = toolbar.querySelector('#fv-refresh-ticket-hauling');
    if (refresh) refresh.insertAdjacentElement('beforebegin',button);
    else toolbar.appendChild(button);

    button.addEventListener('click', async event => {
      event.stopPropagation();
      state.allMode = !state.allMode;
      button.classList.toggle('active',state.allMode);
      button.setAttribute('aria-pressed',state.allMode ? 'true' : 'false');
      button.textContent = state.allMode ? 'Matching Jobs' : 'Show All Jobs';

      if (state.allMode) {
        await context(true);
        scheduleRender();
      } else {
        document.getElementById('fv-refresh-ticket-hauling')?.click();
      }
    });

    return button;
  }

  function ticketMarkup(ticket, linked = true) {
    const locked = ticketHasContract(ticket);
    return `
      <div class="fv-hauling-ticket-card${locked ? ' fv-contract-locked' : ''}" data-ticket-id="${esc(ticket.id)}" data-fv-alljobs-ticket="1" draggable="${locked ? 'false' : 'true'}">
        <input class="fv-ticket-select" type="checkbox" data-fv-ticket-check="${esc(ticket.id)}" ${locked ? 'disabled' : ''} aria-label="Select ticket ${esc(ticketNo(ticket))}">
        <div>
          <div class="fv-hauling-ticket-title"><span>Ticket ${esc(ticketNo(ticket))}</span><span>${fmtBu(ticketBushels(ticket))} bu</span></div>
          <div class="fv-hauling-ticket-meta">${esc(ticketDate(ticket))} • ${esc(clean(ticket?.crop || ticket?.commodity || ticket?.grain || ticket?.cropName) || 'Unknown crop')}<br>${esc(ticketBuyer(ticket) || ticketLocation(ticket) || 'Unknown destination')}${ticketLocation(ticket) && ticketBuyer(ticket) ? ` • ${esc(ticketLocation(ticket))}` : ''}</div>
          <div class="fv-ticket-sold-under"><strong>Sold Under:</strong> ${esc(soldUnder(ticket))}</div>
          ${locked ? '<div class="fv-hauling-ticket-lock">Assigned to a grain contract — move it in the Grain Contracts section.</div>' : (linked ? '<div class="fv-hauling-ticket-lock" style="color:inherit;opacity:.62">Drag left to unassign or onto another compatible job.</div>' : '')}
        </div>
      </div>`;
  }

  function jobMarkup(job) {
    const tickets = ticketsForJob(job.id);
    const ticketed = tickets.reduce((sum,ticket) => sum + ticketBushels(ticket),0);
    const target = jobTarget(job);
    const remaining = Math.max(0,target-ticketed);
    const over = Math.max(0,ticketed-target);
    const status = jobStatus(job);

    return `
      <div class="fv-ticket-job-card${status === 'completed' ? ' fv-alljobs-completed' : ''}${over > .005 ? ' fv-alljobs-overhauled' : ''}" data-fv-ticket-job-id="${esc(job.id)}" data-fv-alljobs-job="1">
        <div class="fv-ticket-job-title">${esc(jobName(job))}<span class="fv-alljobs-status ${status}">${esc(statusLabel(status))}</span></div>
        <div class="fv-ticket-job-meta">
          ${esc(jobBuyer(job) || 'Unknown buyer')} • ${esc(jobLocation(job) || 'Unknown location')} • ${esc(jobCrop(job) || 'Unknown crop')}<br>
          ${fmtBu(ticketed)} bu ticketed • <span class="fv-alljobs-remaining">${fmtBu(remaining)} bu remaining</span>${over > .005 ? ` • <span class="fv-alljobs-over">${fmtBu(over)} bu over</span>` : ''} • ${tickets.length} ticket${tickets.length === 1 ? '' : 's'}
        </div>
        <div class="fv-job-sold-under"><strong>Sold Under:</strong> ${esc(soldUnder(job))}</div>
        ${tickets.length
          ? `<div class="fv-ticket-job-linked"><div class="fv-ticket-job-linked-label">Assigned Tickets</div>${tickets.map(ticket => ticketMarkup(ticket,true)).join('')}</div>`
          : '<div class="fv-ticket-job-empty">No tickets assigned yet.</div>'}
      </div>`;
  }

  function selectedTicketIds(sourceId) {
    const ids = Array.from(document.querySelectorAll('#fv-ticket-hauling-block [data-fv-ticket-check]:checked'))
      .map(input => clean(input.dataset.fvTicketCheck))
      .filter(Boolean);
    const source = clean(sourceId);
    const requested = ids.includes(source) && ids.length ? ids : [source];
    return [...new Set(requested)].filter(id => {
      const ticket = state.tickets.get(id);
      return ticket && !isVoided(ticket) && !ticketHasContract(ticket);
    });
  }

  async function assign(ids,jobId) {
    if (state.busy) return;
    await context();
    const job = state.jobs.get(clean(jobId));
    const ticketIds = [...new Set(ids.map(clean).filter(Boolean))].filter(id => {
      const ticket = state.tickets.get(id);
      return ticket && !isVoided(ticket) && !ticketHasContract(ticket);
    });
    if (!job || !ticketIds.length) return;

    const invalid = ticketIds.some(id => !ticketMatchesJob(state.tickets.get(id),job));
    if (invalid) {
      alert('One or more selected tickets do not match this hauling job\'s destination or crop.');
      return;
    }

    state.busy = true;
    try {
      const firebase = state.firebase;
      const customerId = clean(job?.customerId || job?.grainCustomerId || job?.soldUnderId);
      const customerName = soldUnder(job);
      const patchBase = {
        haulingJobId:job.id,
        haulingJobName:jobName(job),
        updatedAt:firebase.serverTimestamp()
      };
      if (jobBuyerId(job)) patchBase.buyerId = jobBuyerId(job);
      if (jobBuyer(job)) patchBase.buyerName = jobBuyer(job);
      if (jobLocationId(job)) patchBase.deliveryLocationId = jobLocationId(job);
      if (jobLocation(job)) patchBase.deliveryLocationName = jobLocation(job);
      if (customerId) patchBase.customerId = customerId;
      if (customerName && customerName !== '—') patchBase.customerName = customerName;
      if (jobCrop(job)) patchBase.crop = jobCrop(job);

      await Promise.all(ticketIds.map(id => firebase.updateDoc(
        firebase.doc(state.db,'grain_tickets',id),
        patchBase
      )));

      await context(true);
      document.getElementById('refresh-hauling-link-btn')?.click();
      document.getElementById('fv-refresh-ticket-hauling')?.click();
      scheduleRender();
    } catch (error) {
      console.error('[FarmVista] All Jobs ticket move failed:',error);
      alert(error?.message || 'FarmVista could not move that grain ticket.');
    } finally {
      state.busy = false;
    }
  }

  async function unassign(ids) {
    if (state.busy) return;
    await context();
    const ticketIds = [...new Set(ids.map(clean).filter(Boolean))].filter(id => {
      const ticket = state.tickets.get(id);
      return ticket && clean(ticket?.haulingJobId) && !ticketHasContract(ticket);
    });
    if (!ticketIds.length) return;

    state.busy = true;
    try {
      const firebase = state.firebase;
      await Promise.all(ticketIds.map(id => firebase.updateDoc(
        firebase.doc(state.db,'grain_tickets',id),
        {
          haulingJobId:null,
          haulingJobName:null,
          haulingJobAssignmentSource:null,
          updatedAt:firebase.serverTimestamp()
        }
      )));
      await context(true);
      document.getElementById('refresh-hauling-link-btn')?.click();
      document.getElementById('fv-refresh-ticket-hauling')?.click();
      scheduleRender();
    } catch (error) {
      console.error('[FarmVista] All Jobs ticket unassign failed:',error);
      alert(error?.message || 'FarmVista could not unassign that grain ticket.');
    } finally {
      state.busy = false;
    }
  }

  function bindDesktop() {
    const right = document.getElementById('fv-ticket-job-list');
    const left = document.getElementById('fv-unassigned-ticket-list');
    if (!right || !left) return;

    right.querySelectorAll('[data-fv-alljobs-ticket="1"][data-ticket-id]').forEach(card => {
      if (card.dataset.fvAllJobsDrag === '1') return;
      card.dataset.fvAllJobsDrag = '1';
      card.addEventListener('dragstart',event => {
        const id = clean(card.dataset.ticketId);
        if (!id || ticketHasContract(state.tickets.get(id))) {
          event.preventDefault();
          return;
        }
        const ids = selectedTicketIds(id);
        card.classList.add('dragging');
        event.dataTransfer.effectAllowed = 'move';
        try { event.dataTransfer.setData('text/plain',ids.join(',')); } catch (_) {}
      });
      card.addEventListener('dragend',() => card.classList.remove('dragging'));
    });

    right.querySelectorAll('[data-fv-alljobs-job="1"][data-fv-ticket-job-id]').forEach(card => {
      if (card.dataset.fvAllJobsDrop === '1') return;
      card.dataset.fvAllJobsDrop = '1';
      card.addEventListener('dragover',event => {
        event.preventDefault();
        card.classList.add('drag-over');
      });
      card.addEventListener('dragleave',() => card.classList.remove('drag-over'));
      card.addEventListener('drop',event => {
        event.preventDefault();
        card.classList.remove('drag-over');
        const raw = clean(event.dataTransfer?.getData('text/plain'));
        const source = raw.split(',').map(clean).filter(Boolean);
        const sourceId = source[0] || clean(document.querySelector('.fv-hauling-ticket-card.dragging')?.dataset.ticketId);
        const ids = source.length > 1 ? source : selectedTicketIds(sourceId);
        assign(ids,card.dataset.fvTicketJobId);
      });
    });

    if (left.dataset.fvAllJobsUnassign !== '1') {
      left.dataset.fvAllJobsUnassign = '1';
      left.addEventListener('dragover',event => {
        if (!state.allMode) return;
        event.preventDefault();
        left.classList.add('drag-over');
      });
      left.addEventListener('dragleave',() => left.classList.remove('drag-over'));
      left.addEventListener('drop',event => {
        if (!state.allMode) return;
        event.preventDefault();
        left.classList.remove('drag-over');
        const raw = clean(event.dataTransfer?.getData('text/plain'));
        const source = raw.split(',').map(clean).filter(Boolean);
        const sourceId = source[0] || clean(document.querySelector('.fv-hauling-ticket-card.dragging')?.dataset.ticketId);
        const ids = source.length > 1 ? source : selectedTicketIds(sourceId);
        unassign(ids);
      });
    }
  }

  function touchTarget(x,y) {
    const ghost = state.touch.ghost;
    if (ghost) ghost.style.display = 'none';
    const element = document.elementFromPoint(x,y);
    if (ghost) ghost.style.display = '';
    return element?.closest?.('[data-fv-alljobs-job="1"][data-fv-ticket-job-id],#fv-unassigned-ticket-list') || null;
  }

  function clearTouch() {
    if (state.touch.timer) clearTimeout(state.touch.timer);
    state.touch.timer = 0;
    state.touch.source?.classList.remove('dragging');
    state.touch.target?.classList.remove('drag-over');
    state.touch.ghost?.remove();
    state.touch.active = false;
    state.touch.source = null;
    state.touch.target = null;
    state.touch.ghost = null;
    state.touch.ids = [];
  }

  function bindTouch() {
    const right = document.getElementById('fv-ticket-job-list');
    if (!right) return;
    right.querySelectorAll('[data-fv-alljobs-ticket="1"][data-ticket-id]').forEach(card => {
      if (card.dataset.fvAllJobsTouch === '1') return;
      card.dataset.fvAllJobsTouch = '1';
      card.addEventListener('pointerdown',event => {
        if (!state.allMode || event.pointerType === 'mouse' || event.target.closest('input,button,a')) return;
        const id = clean(card.dataset.ticketId);
        if (!id || ticketHasContract(state.tickets.get(id))) return;
        state.touch.startX = event.clientX;
        state.touch.startY = event.clientY;
        if (state.touch.timer) clearTimeout(state.touch.timer);
        state.touch.timer = setTimeout(() => {
          state.touch.timer = 0;
          state.touch.active = true;
          state.touch.source = card;
          state.touch.ids = selectedTicketIds(id);
          card.classList.add('dragging');
          const ghost = document.createElement('div');
          ghost.className = 'fv-ticket-drag-ghost';
          ghost.textContent = state.touch.ids.length > 1 ? `${state.touch.ids.length} grain tickets` : `Ticket ${ticketNo(state.tickets.get(id))}`;
          document.body.appendChild(ghost);
          state.touch.ghost = ghost;
          ghost.style.left = `${state.touch.startX}px`;
          ghost.style.top = `${state.touch.startY}px`;
          try { navigator.vibrate?.(18); } catch (_) {}
        },430);
      });
    });
  }

  document.addEventListener('pointermove',event => {
    if (!state.allMode || event.pointerType === 'mouse') return;
    if (!state.touch.active) {
      if (state.touch.timer) {
        const dx = Math.abs(event.clientX-state.touch.startX);
        const dy = Math.abs(event.clientY-state.touch.startY);
        if (dx > 12 || dy > 12) {
          clearTimeout(state.touch.timer);
          state.touch.timer = 0;
        }
      }
      return;
    }
    event.preventDefault();
    if (state.touch.ghost) {
      state.touch.ghost.style.left = `${event.clientX}px`;
      state.touch.ghost.style.top = `${event.clientY}px`;
    }
    const target = touchTarget(event.clientX,event.clientY);
    if (target !== state.touch.target) {
      state.touch.target?.classList.remove('drag-over');
      state.touch.target = target;
      target?.classList.add('drag-over');
    }
  },{ passive:false,capture:true });

  document.addEventListener('pointerup',event => {
    if (!state.allMode || event.pointerType === 'mouse' || !state.touch.active) return;
    const target = state.touch.target || touchTarget(event.clientX,event.clientY);
    const ids = [...state.touch.ids];
    const jobId = clean(target?.dataset?.fvTicketJobId);
    const toUnassigned = target?.id === 'fv-unassigned-ticket-list';
    clearTouch();
    if (jobId) assign(ids,jobId);
    else if (toUnassigned) unassign(ids);
  },{ passive:true,capture:true });

  document.addEventListener('pointercancel',clearTouch,{ passive:true,capture:true });

  function renderAllJobs() {
    if (!state.allMode || state.rendering) return;
    const right = document.getElementById('fv-ticket-job-list');
    if (!right) return;

    state.rendering = true;
    try {
      const jobs = availableJobs();
      const html = jobs.length
        ? jobs.map(jobMarkup).join('')
        : '<div class="fv-ticket-empty"><div class="fv-ticket-empty-title">No Hauling Jobs</div><div class="fv-ticket-empty-sub">No active, upcoming, past-due, or completed hauling jobs are available.</div></div>';

      if (right.dataset.fvAllJobsHtml !== html) {
        right.innerHTML = html;
        right.dataset.fvAllJobsHtml = html;
      }

      const count = document.getElementById('fv-ticket-job-count');
      if (count) count.textContent = `${jobs.length} job${jobs.length === 1 ? '' : 's'}`;

      const message = document.getElementById('fv-ticket-hauling-message');
      if (message) {
        message.textContent = 'Showing all active, upcoming, past-due, and completed hauling jobs. Drag tickets between jobs or back to Unassigned.';
        message.classList.add('ready');
      }

      bindDesktop();
      bindTouch();
    } finally {
      state.rendering = false;
    }
  }

  async function scheduleRender() {
    if (!state.allMode || state.renderQueued) return;
    state.renderQueued = true;
    requestAnimationFrame(async () => {
      state.renderQueued = false;
      await context();
      renderAllJobs();
    });
  }

  function start() {
    installStyles();
    const observer = new MutationObserver(() => {
      ensureButton();
      if (state.allMode && !state.rendering) scheduleRender();
    });
    observer.observe(document.documentElement,{ childList:true,subtree:true });

    document.addEventListener('click',event => {
      if (event.target.closest('#fv-refresh-ticket-hauling') && state.allMode) {
        setTimeout(() => context(true).then(scheduleRender),250);
      }
    },true);

    ensureButton();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',start,{ once:true });
  else start();
})();