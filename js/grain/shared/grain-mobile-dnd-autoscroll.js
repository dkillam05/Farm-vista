// FarmVista — Grain Contracts DND workspace loader + Sold Under display + assignment filters
// Sept. 11, 2026
//
// The full hybrid DND workspace is preserved in grain-mobile-dnd-autoscroll-core.js.
// This lightweight loader keeps that behavior intact, adds Sold Under to the
// Ticket -> Hauling Job assignment cards, repairs ticket context from the hauling
// job after assignment, and provides Buyer / Sold Under / Crop narrowing filters.

(() => {
  'use strict';

  if (window.__FV_GRAIN_DND_WRAPPER_20260911_V3) return;
  window.__FV_GRAIN_DND_WRAPPER_20260911_V3 = true;

  const clean = value => String(value ?? '').trim();
  const norm = value => clean(value).toLowerCase().replace(/[^a-z0-9]/g, '');
  const escapeHtml = value => clean(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  const core = document.createElement('script');
  core.src = '/js/grain-mobile-dnd-autoscroll-core.js?v=20260911-1';
  core.dataset.fvGrainMobileDndCore = '1';
  document.head.appendChild(core);

  const state = {
    loaded: false,
    loading: null,
    repairing: false,
    tickets: new Map(),
    jobs: new Map(),
    customers: new Map(),
    observer: null,
    renderQueued: false
  };

  function soldUnderFromRecord(record) {
    if (!record) return '';

    const direct = clean(
      record.customerName ||
      record.soldUnderName ||
      record.soldUnder ||
      record.customer
    );

    if (direct && direct.toLowerCase() !== 'unknown') return direct;

    const customerId = clean(
      record.customerId ||
      record.soldUnderId ||
      record.grainCustomerId
    );

    return customerId ? clean(state.customers.get(customerId)?.name) : '';
  }

  function buyerFromRecord(record) {
    return clean(
      record?.buyerName ||
      record?.buyer ||
      record?.grainBuyerName ||
      record?.destinationBuyerName
    );
  }

  function cropFromRecord(record) {
    return clean(
      record?.crop ||
      record?.commodity ||
      record?.cropName ||
      record?.cropType
    );
  }

  function soldUnderForJob(jobId) {
    return soldUnderFromRecord(state.jobs.get(clean(jobId)));
  }

  function soldUnderForTicket(ticketId) {
    const ticket = state.tickets.get(clean(ticketId));
    if (!ticket) return '';

    const direct = soldUnderFromRecord(ticket);
    if (direct) return direct;

    return soldUnderForJob(
      ticket.haulingJobId ||
      ticket.haulingJob ||
      ticket.jobId
    );
  }

  async function loadData(force = false) {
    if (state.loading && !force) return state.loading;
    if (state.loaded && !force) return;

    state.loading = import('/js/firebase-init.js').then(async firebase => {
      await firebase.ready;
      const db = firebase.getFirestore();
      const [ticketsSnap, jobsSnap, customersSnap] = await Promise.all([
        firebase.getDocs(firebase.collection(db, 'grain_tickets')),
        firebase.getDocs(firebase.collection(db, 'grain_hauling_jobs')),
        firebase.getDocs(firebase.collection(db, 'grain_customers'))
      ]);

      state.tickets = new Map(
        ticketsSnap.docs.map(snapshot => [snapshot.id, { id: snapshot.id, ...snapshot.data() }])
      );

      state.jobs = new Map(
        jobsSnap.docs.map(snapshot => [snapshot.id, { id: snapshot.id, ...snapshot.data() }])
      );

      state.customers = new Map(
        customersSnap.docs.map(snapshot => [snapshot.id, { id: snapshot.id, ...snapshot.data() }])
      );

      state.loaded = true;
    }).catch(error => {
      console.warn('[FarmVista] Could not load ticket assignment context:', error);
    }).finally(() => {
      state.loading = null;
    });

    return state.loading;
  }

  function isMissing(value) {
    const text = clean(value);
    return !text || text.toLowerCase() === 'unknown';
  }

  function jobCustomer(job) {
    const customerId = clean(
      job?.customerId ||
      job?.soldUnderId ||
      job?.grainCustomerId
    );

    const directName = clean(
      job?.customerName ||
      job?.soldUnderName ||
      job?.soldUnder ||
      job?.customer
    );

    const customerName =
      directName && directName.toLowerCase() !== 'unknown'
        ? directName
        : clean(state.customers.get(customerId)?.name);

    return { customerId, customerName };
  }

  async function repairMissingAssignedTicketContext() {
    if (state.repairing) return;
    await loadData();
    if (!state.loaded) return;

    const repairs = [];

    for (const ticket of state.tickets.values()) {
      const jobId = clean(ticket.haulingJobId);
      if (!jobId) continue;

      const job = state.jobs.get(jobId);
      if (!job) continue;

      const { customerId, customerName } = jobCustomer(job);
      const patch = {};

      if (customerId && clean(ticket.customerId) !== customerId) patch.customerId = customerId;
      if (customerName && clean(ticket.customerName) !== customerName) patch.customerName = customerName;

      const buyerId = clean(job.buyerId || job.grainBuyerId);
      const buyerName = clean(job.buyerName || job.buyer);
      const locationId = clean(job.deliveryLocationId || job.locationId || job.destinationId);
      const locationName = clean(job.deliveryLocationName || job.locationName || job.destinationName || job.destination);
      const crop = clean(job.crop || job.commodity || job.cropName || job.cropType);

      if (buyerId && isMissing(ticket.buyerId)) patch.buyerId = buyerId;
      if (buyerName && isMissing(ticket.buyerName)) patch.buyerName = buyerName;
      if (locationId && isMissing(ticket.deliveryLocationId)) patch.deliveryLocationId = locationId;
      if (locationName && isMissing(ticket.deliveryLocationName)) patch.deliveryLocationName = locationName;
      if (crop && isMissing(ticket.crop)) patch.crop = crop;

      if (Object.keys(patch).length) repairs.push({ ticket, patch });
    }

    if (!repairs.length) return;

    state.repairing = true;
    try {
      const firebase = await import('/js/firebase-init.js');
      await firebase.ready;
      const db = firebase.getFirestore();

      await Promise.all(repairs.map(({ ticket, patch }) =>
        firebase.updateDoc(
          firebase.doc(db, 'grain_tickets', ticket.id),
          { ...patch, updatedAt: firebase.serverTimestamp() }
        )
      ));

      repairs.forEach(({ ticket, patch }) => Object.assign(ticket, patch));
    } catch (error) {
      console.warn('[FarmVista] Could not repair ticket context from hauling job:', error);
    } finally {
      state.repairing = false;
    }
  }

  function ensureStyle() {
    if (document.getElementById('fv-ticket-job-sold-under-style')) return;

    const style = document.createElement('style');
    style.id = 'fv-ticket-job-sold-under-style';
    style.textContent = `
      .fv-ticket-sold-under,
      .fv-job-sold-under {
        margin-top:4px;
        font-size:.78rem;
        line-height:1.35;
        font-weight:800;
        opacity:.88;
      }
      .fv-ticket-sold-under strong,
      .fv-job-sold-under strong {
        font-weight:900;
      }

      .fv-ticket-hauling-filterbar {
        display:grid;
        grid-template-columns:repeat(3,minmax(170px,1fr)) auto;
        gap:10px;
        align-items:end;
        margin-top:12px;
        padding:10px 11px;
        border:1px solid var(--border,#ddd);
        border-radius:10px;
        background:var(--surface-2,#f5f5f5);
      }
      .fv-ticket-hauling-filterfield {
        display:flex;
        flex-direction:column;
        gap:5px;
        min-width:0;
      }
      .fv-ticket-hauling-filterfield > span {
        font-size:.78rem;
        font-weight:850;
        opacity:.78;
      }
      .fv-ticket-hauling-filterfield select {
        width:100%;
        min-height:38px;
        padding:7px 9px;
        border:1px solid var(--border,#c8c8c8);
        border-radius:8px;
        background:var(--surface,#fff);
        color:inherit;
        font:inherit;
      }
      .fv-assignment-filter-hidden {
        display:none!important;
      }
      .fv-assignment-filter-empty {
        padding:24px 14px;
        text-align:center;
        font-size:.8rem;
        font-weight:700;
        opacity:.62;
      }
      @media(max-width:900px) {
        .fv-ticket-hauling-filterbar {
          grid-template-columns:1fr 1fr;
        }
      }
      @media(max-width:560px) {
        .fv-ticket-hauling-filterbar {
          grid-template-columns:1fr;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function applyTicketLabels() {
    document.querySelectorAll('.fv-hauling-ticket-card[data-ticket-id]').forEach(card => {
      const ticketId = clean(card.dataset.ticketId);
      const content = card.children?.[1];
      if (!ticketId || !content) return;

      const name = soldUnderForTicket(ticketId) || '—';
      let row = content.querySelector(':scope > .fv-ticket-sold-under');
      if (!row) {
        row = document.createElement('div');
        row.className = 'fv-ticket-sold-under';
        const meta = content.querySelector(':scope > .fv-hauling-ticket-meta');
        if (meta) meta.insertAdjacentElement('afterend', row);
        else content.appendChild(row);
      }
      const desired = `<strong>Sold Under:</strong> ${escapeHtml(name)}`;
      if (row.innerHTML !== desired) row.innerHTML = desired;
    });
  }

  function applyJobLabels() {
    document.querySelectorAll('.fv-ticket-job-card[data-fv-ticket-job-id]').forEach(card => {
      const jobId = clean(card.dataset.fvTicketJobId);
      if (!jobId) return;

      const name = soldUnderForJob(jobId) || '—';
      let row = card.querySelector(':scope > .fv-job-sold-under');
      if (!row) {
        row = document.createElement('div');
        row.className = 'fv-job-sold-under';
        const meta = card.querySelector(':scope > .fv-ticket-job-meta');
        if (meta) meta.insertAdjacentElement('afterend', row);
        else card.appendChild(row);
      }
      const desired = `<strong>Sold Under:</strong> ${escapeHtml(name)}`;
      if (row.innerHTML !== desired) row.innerHTML = desired;
    });
  }

  function uniqueSorted(values) {
    const byKey = new Map();
    values.map(clean).filter(Boolean).forEach(value => {
      const key = norm(value);
      if (key && !byKey.has(key)) byKey.set(key, value);
    });
    return Array.from(byKey.values()).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric:true, sensitivity:'base' })
    );
  }

  function syncSelectOptions(select, values, allLabel) {
    if (!select) return;

    const current = clean(select.value);
    const items = uniqueSorted(values);
    const desired = [
      { value:'', label:allLabel },
      ...items.map(value => ({ value, label:value }))
    ];

    const currentSignature = Array.from(select.options)
      .map(option => `${option.value}\u0000${option.textContent}`)
      .join('\u0001');
    const desiredSignature = desired
      .map(option => `${option.value}\u0000${option.label}`)
      .join('\u0001');

    if (currentSignature !== desiredSignature) {
      select.innerHTML = desired.map(option =>
        `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`
      ).join('');
    }

    const match = items.find(item => norm(item) === norm(current));
    select.value = match || '';
  }

  function assignmentFilterValues() {
    return {
      buyer: clean(document.getElementById('fv-ticket-filter-buyer')?.value),
      soldUnder: clean(document.getElementById('fv-ticket-filter-sold-under')?.value),
      crop: clean(document.getElementById('fv-ticket-filter-crop')?.value)
    };
  }

  function recordMatchesFilters(record, filters) {
    if (!record) return true;
    if (filters.buyer && norm(buyerFromRecord(record)) !== norm(filters.buyer)) return false;
    if (filters.soldUnder && norm(soldUnderFromRecord(record)) !== norm(filters.soldUnder)) return false;
    if (filters.crop && norm(cropFromRecord(record)) !== norm(filters.crop)) return false;
    return true;
  }

  function unassignedTicketRecords() {
    return Array.from(
      document.querySelectorAll('#fv-unassigned-ticket-list > .fv-hauling-ticket-card[data-ticket-id]')
    ).map(card => state.tickets.get(clean(card.dataset.ticketId))).filter(Boolean);
  }

  function ensureFilterEmpty(list, id, text) {
    if (!list) return null;
    let empty = list.querySelector(`:scope > #${id}`);
    if (!empty) {
      empty = document.createElement('div');
      empty.id = id;
      empty.className = 'fv-assignment-filter-empty';
      empty.textContent = text;
      empty.hidden = true;
      list.appendChild(empty);
    }
    return empty;
  }

  function syncAssignmentFilterOptions() {
    const buyerSelect = document.getElementById('fv-ticket-filter-buyer');
    const soldUnderSelect = document.getElementById('fv-ticket-filter-sold-under');
    const cropSelect = document.getElementById('fv-ticket-filter-crop');
    if (!buyerSelect || !soldUnderSelect || !cropSelect) return;

    const records = unassignedTicketRecords();

    syncSelectOptions(buyerSelect, records.map(buyerFromRecord), 'All Buyers');

    const buyer = clean(buyerSelect.value);
    const buyerRecords = records.filter(record =>
      !buyer || norm(buyerFromRecord(record)) === norm(buyer)
    );

    syncSelectOptions(
      soldUnderSelect,
      buyerRecords.map(soldUnderFromRecord),
      'All Sold Under'
    );

    const soldUnder = clean(soldUnderSelect.value);
    const soldUnderRecords = buyerRecords.filter(record =>
      !soldUnder || norm(soldUnderFromRecord(record)) === norm(soldUnder)
    );

    syncSelectOptions(cropSelect, soldUnderRecords.map(cropFromRecord), 'All Crops');
  }

  function applyAssignmentFilters() {
    const block = document.getElementById('fv-ticket-hauling-block');
    if (!block) return;

    ensureAssignmentFilterBar();
    syncAssignmentFilterOptions();

    const filters = assignmentFilterValues();
    const ticketCards = Array.from(
      block.querySelectorAll('#fv-unassigned-ticket-list > .fv-hauling-ticket-card[data-ticket-id]')
    );
    const jobCards = Array.from(
      block.querySelectorAll('#fv-ticket-job-list > .fv-ticket-job-card[data-fv-ticket-job-id]')
    );

    let visibleTickets = 0;
    ticketCards.forEach(card => {
      const record = state.tickets.get(clean(card.dataset.ticketId));
      const show = recordMatchesFilters(record, filters);
      card.classList.toggle('fv-assignment-filter-hidden', !show);
      if (show) visibleTickets += 1;
    });

    let visibleJobs = 0;
    jobCards.forEach(card => {
      const record = state.jobs.get(clean(card.dataset.fvTicketJobId));
      const show = recordMatchesFilters(record, filters);
      card.classList.toggle('fv-assignment-filter-hidden', !show);
      if (show) visibleJobs += 1;
    });

    const ticketCount = document.getElementById('fv-unassigned-ticket-count');
    if (ticketCount) ticketCount.textContent = `${visibleTickets} ${visibleTickets === 1 ? 'ticket' : 'tickets'}`;

    const jobCount = document.getElementById('fv-ticket-job-count');
    if (jobCount) jobCount.textContent = `${visibleJobs} ${visibleJobs === 1 ? 'job' : 'jobs'}`;

    const ticketList = document.getElementById('fv-unassigned-ticket-list');
    const jobList = document.getElementById('fv-ticket-job-list');
    const ticketEmpty = ensureFilterEmpty(ticketList, 'fv-ticket-filter-empty-tickets', 'No grain tickets match these filters.');
    const jobEmpty = ensureFilterEmpty(jobList, 'fv-ticket-filter-empty-jobs', 'No hauling jobs match these filters.');

    if (ticketEmpty) ticketEmpty.hidden = !(ticketCards.length > 0 && visibleTickets === 0);
    if (jobEmpty) jobEmpty.hidden = !(jobCards.length > 0 && visibleJobs === 0);
  }

  function ensureAssignmentFilterBar() {
    const block = document.getElementById('fv-ticket-hauling-block');
    if (!block || document.getElementById('fv-ticket-hauling-filterbar')) return;

    const toolbar = block.querySelector('.fv-ticket-hauling-toolbar');
    const message = block.querySelector('#fv-ticket-hauling-message');
    if (!toolbar || !message) return;

    const filters = document.createElement('div');
    filters.className = 'fv-ticket-hauling-filterbar';
    filters.id = 'fv-ticket-hauling-filterbar';
    filters.innerHTML = `
      <label class="fv-ticket-hauling-filterfield">
        <span>Buyer</span>
        <select id="fv-ticket-filter-buyer" aria-label="Filter grain tickets and hauling jobs by buyer">
          <option value="">All Buyers</option>
        </select>
      </label>
      <label class="fv-ticket-hauling-filterfield">
        <span>Sold Under</span>
        <select id="fv-ticket-filter-sold-under" aria-label="Filter grain tickets and hauling jobs by sold under">
          <option value="">All Sold Under</option>
        </select>
      </label>
      <label class="fv-ticket-hauling-filterfield">
        <span>Crop</span>
        <select id="fv-ticket-filter-crop" aria-label="Filter grain tickets and hauling jobs by crop">
          <option value="">All Crops</option>
        </select>
      </label>
      <button type="button" class="btn btn-secondary btn-small" id="fv-ticket-filter-clear">Clear Filters</button>
    `;

    toolbar.insertAdjacentElement('afterend', filters);

    const buyer = filters.querySelector('#fv-ticket-filter-buyer');
    const soldUnder = filters.querySelector('#fv-ticket-filter-sold-under');
    const crop = filters.querySelector('#fv-ticket-filter-crop');
    const clear = filters.querySelector('#fv-ticket-filter-clear');

    buyer?.addEventListener('change', () => {
      if (soldUnder) soldUnder.value = '';
      if (crop) crop.value = '';
      applyAssignmentFilters();
    });

    soldUnder?.addEventListener('change', () => {
      if (crop) crop.value = '';
      applyAssignmentFilters();
    });

    crop?.addEventListener('change', applyAssignmentFilters);

    clear?.addEventListener('click', () => {
      if (buyer) buyer.value = '';
      if (soldUnder) soldUnder.value = '';
      if (crop) crop.value = '';
      applyAssignmentFilters();
    });
  }

  async function render() {
    state.renderQueued = false;
    ensureStyle();
    await loadData();
    await repairMissingAssignedTicketContext();
    applyTicketLabels();
    applyJobLabels();
    applyAssignmentFilters();
  }

  function queueRender() {
    if (state.renderQueued) return;
    state.renderQueued = true;
    requestAnimationFrame(render);
  }

  core.addEventListener('load', queueRender, { once: true });
  core.addEventListener('error', () => {
    console.error('[FarmVista] Grain DND workspace core failed to load.');
  }, { once: true });

  state.observer = new MutationObserver(queueRender);
  state.observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  document.addEventListener('click', event => {
    if (event.target.closest('#refresh-hauling-link-btn, #fv-refresh-ticket-hauling')) {
      state.loaded = false;
      setTimeout(() => loadData(true).then(repairMissingAssignedTicketContext).then(queueRender), 250);
    }
  }, true);

  queueRender();
})();
