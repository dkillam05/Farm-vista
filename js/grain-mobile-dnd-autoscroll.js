// FarmVista — Grain Contracts DND workspace loader + Sold Under display
// Sept. 11, 2026
//
// The full hybrid DND workspace is preserved in grain-mobile-dnd-autoscroll-core.js.
// This lightweight loader keeps that behavior intact and adds Sold Under to the
// Ticket -> Hauling Job assignment cards. It also repairs ticket context from
// the hauling job after assignment so the ticket detail/list stays aligned.

(() => {
  'use strict';

  if (window.__FV_GRAIN_DND_WRAPPER_20260911_V2) return;
  window.__FV_GRAIN_DND_WRAPPER_20260911_V2 = true;

  const clean = value => String(value ?? '').trim();
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
      console.warn('[FarmVista] Could not load Sold Under labels for ticket assignment cards:', error);
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
      row.innerHTML = `<strong>Sold Under:</strong> ${escapeHtml(name)}`;
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
      row.innerHTML = `<strong>Sold Under:</strong> ${escapeHtml(name)}`;
    });
  }

  async function render() {
    state.renderQueued = false;
    ensureStyle();
    await loadData();
    await repairMissingAssignedTicketContext();
    applyTicketLabels();
    applyJobLabels();
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
    if (event.target.closest('#refresh-hauling-link-btn')) {
      state.loaded = false;
      setTimeout(() => loadData(true).then(repairMissingAssignedTicketContext).then(queueRender), 250);
    }
  }, true);

  queueRender();
})();
