/* FarmVista — cross-entity split hauling allocation guard — Sept. 14, 2026
   Manual override only. Automatic assignment remains unchanged.
   A draggable split/spot/unassigned PORTION may move to a hauling job with a
   different Sold Under only when destination, crop and delivery date match.
   Cross-entity drops require an explicit acknowledgement before assignment.
*/
(() => {
  'use strict';

  if (window.__FV_CROSS_ENTITY_SPLIT_GUARD_20260914_V1) return;
  window.__FV_CROSS_ENTITY_SPLIT_GUARD_20260914_V1 = true;
  if (!String(location.pathname || '').toLowerCase().endsWith('/pages/grain/grain-contracts.html')) return;

  const clean = value => String(value ?? '').trim();
  const norm = value => clean(value).toLowerCase().replace(/[^a-z0-9]/g, '');
  const cropKey = value => {
    const key = norm(value);
    if (key === 'corn' || key === 'yellowcorn') return 'corn';
    if (['soy','soybean','soybeans','beans','yellowsoybeans'].includes(key)) return 'soybeans';
    return key;
  };

  let firebase = null;
  let db = null;
  let tickets = new Map();
  let jobs = new Map();
  let loading = null;

  async function ensureData(force = false) {
    if (loading && !force) return loading;
    loading = (async () => {
      firebase = firebase || await import('/js/firebase-init.js');
      await firebase.ready;
      db = db || firebase.getFirestore();
      const [ticketSnap, jobSnap] = await Promise.all([
        firebase.getDocs(firebase.collection(db, 'grain_tickets')),
        firebase.getDocs(firebase.collection(db, 'grain_hauling_jobs'))
      ]);
      tickets = new Map(ticketSnap.docs.map(s => [s.id, { id:s.id, ...s.data() }]));
      jobs = new Map(jobSnap.docs.map(s => [s.id, { id:s.id, ...s.data() }]));
    })().catch(error => console.warn('[FarmVista] Cross-entity split guard data load failed:', error))
      .finally(() => { loading = null; });
    return loading;
  }

  const ticketBuyerId = t => clean(t?.buyerId || t?.grainBuyerId || t?.destinationBuyerId);
  const ticketBuyer = t => clean(t?.buyerName || t?.destinationBuyerName || t?.elevatorName);
  const ticketLocationId = t => clean(t?.deliveryLocationId || t?.locationId || t?.destinationId);
  const ticketLocation = t => clean(t?.deliveryLocationName || t?.locationName || t?.destinationName || t?.destination || t?.elevator);
  const ticketCrop = t => clean(t?.crop || t?.commodity || t?.grain || t?.cropName);
  const ticketEntityId = t => clean(t?.customerId || t?.soldUnderId || t?.customerAccountId);
  const ticketEntity = t => clean(t?.customerName || t?.soldUnderName || t?.soldUnder || t?.customer) || 'Unknown';
  const ticketDate = t => t?.ticketDate ?? t?.date ?? t?.deliveryDate ?? null;
  const ticketNo = t => clean(t?.ticketNumber || t?.ticketNo || t?.ticket || t?.number || t?.scaleTicketNumber || t?.id) || 'Unknown';

  const jobBuyerId = j => clean(j?.buyerId || j?.grainBuyerId);
  const jobBuyer = j => clean(j?.buyerName || j?.buyer || j?.grainBuyerName);
  const jobLocationId = j => clean(j?.deliveryLocationId || j?.locationId || j?.destinationId);
  const jobLocation = j => clean(j?.deliveryLocationName || j?.locationName || j?.destinationName || j?.destination);
  const jobCrop = j => clean(j?.crop || j?.commodity || j?.cropName || j?.cropType);
  const jobEntityId = j => clean(j?.customerId || j?.soldUnderId || j?.customerAccountId);
  const jobEntity = j => clean(j?.customerName || j?.soldUnderName || j?.soldUnder || j?.customer) || 'Unknown';

  function idsOrNamesMatch(aId, aName, bId, bName) {
    if (aId && bId) return aId === bId;
    if (aName && bName) return norm(aName) === norm(bName);
    return true;
  }

  function toDate(value) {
    if (!value) return null;
    if (typeof value?.toDate === 'function') return value.toDate();
    if (typeof value?.seconds === 'number') return new Date(value.seconds * 1000);
    if (value instanceof Date) return value;
    const text = clean(value);
    if (!text) return null;
    const d = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T12:00:00`) : new Date(text);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function startDate(job) {
    return toDate(job?.startDate || job?.deliveryStartDate || job?.beginDate || job?.dateStart);
  }
  function endDate(job) {
    return toDate(job?.endDate || job?.deliveryEndDate || job?.expirationDate || job?.deliveryDate || job?.dateEnd);
  }
  function sameDayNumber(date) {
    return date ? new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() : null;
  }

  function dateEligible(ticket, job) {
    const td = sameDayNumber(toDate(ticketDate(ticket)));
    if (td == null) return true;
    const start = sameDayNumber(startDate(job));
    const end = sameDayNumber(endDate(job));
    if (start != null && td < start) return false;
    if (end != null && td > end) return false;
    return true;
  }

  function compatibleExceptEntity(ticket, job) {
    if (!idsOrNamesMatch(ticketBuyerId(ticket), ticketBuyer(ticket), jobBuyerId(job), jobBuyer(job))) return false;
    if (!idsOrNamesMatch(ticketLocationId(ticket), ticketLocation(ticket), jobLocationId(job), jobLocation(job))) return false;
    const tc = cropKey(ticketCrop(ticket));
    const jc = cropKey(jobCrop(job));
    if (tc && jc && tc !== jc) return false;
    return dateEligible(ticket, job);
  }

  function entityDiffers(ticket, job) {
    const ti = ticketEntityId(ticket);
    const ji = jobEntityId(job);
    if (ti && ji) return ti !== ji;
    const tn = norm(ticketEntity(ticket));
    const jn = norm(jobEntity(job));
    return !!(tn && jn && tn !== jn);
  }

  function readPayload(event) {
    let raw = '';
    try { raw = event.dataTransfer?.getData('application/x-fv-hauling-portion') || ''; } catch (_) {}
    if (!raw) {
      try {
        const plain = event.dataTransfer?.getData('text/plain') || '';
        if (plain.startsWith('FVPORTION:')) raw = plain.slice('FVPORTION:'.length);
      } catch (_) {}
    }
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (_) { return null; }
  }

  function destinationFromEvent(event) {
    const spotZone = event.target.closest?.('[data-fv-spot-job-id]');
    const jobCard = event.target.closest?.('[data-fv-status-job][data-fv-ticket-job-id]');
    return clean(spotZone?.dataset?.fvSpotJobId || jobCard?.dataset?.fvTicketJobId);
  }

  function stopDrop(event, message) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (message) alert(message);
  }

  /* Registered before grain-hauling-split-portion-dnd.js. This is deliberately
     synchronous at drop time so a cancelled acknowledgement can never race the
     underlying allocation write. */
  document.addEventListener('drop', event => {
    const payload = readPayload(event);
    if (!payload) return;
    const destinationId = destinationFromEvent(event);
    if (!destinationId) return; // Unassigning never prompts.

    const ticket = tickets.get(clean(payload.ticketId));
    const job = jobs.get(destinationId);
    if (!ticket || !job) {
      stopDrop(event, 'FarmVista could not verify that split allocation. Refresh and try again.');
      return;
    }

    if (!compatibleExceptEntity(ticket, job)) {
      stopDrop(event, 'That split portion cannot be assigned to this hauling job. The elevator, crop, and ticket date must match the hauling job.');
      return;
    }

    if (!entityDiffers(ticket, job)) return;

    const fromEntity = ticketEntity(ticket);
    const toEntity = jobEntity(job);
    const amount = Number(payload.bushels || 0).toLocaleString('en-US', { maximumFractionDigits:2 });
    const ok = window.confirm(
      `NOTICE\n\nTicket ${ticketNo(ticket)} was originally indicated as Sold Under: ${fromEntity}.\n\nYou are assigning this ${amount} bu split portion to a hauling job Sold Under: ${toEntity}.\n\nThis is a manual cross-entity split override. The original ticket will remain unchanged and only this split portion will be allocated to ${toEntity}.\n\nSelect OK to acknowledge and continue, or Cancel to leave it where it is.`
    );
    if (!ok) stopDrop(event, '');
  }, true);

  /* Keep the split tile transparent about both entities after a manual override:
     the elevator-ticket entity remains the source of truth, while the hauling
     job shows where that portion is currently allocated. */
  function decorateEntityOverrides() {
    document.querySelectorAll('.fv-hauling-partial-tile[data-current-job-id]').forEach(tile => {
      const ticket = tickets.get(clean(tile.dataset.ticketId));
      const job = jobs.get(clean(tile.dataset.currentJobId));
      if (!ticket || !job || !entityDiffers(ticket, job)) return;
      const sold = tile.querySelector('.fv-hauling-partial-sold');
      if (!sold) return;
      sold.innerHTML = `<strong>Original Sold Under:</strong> ${escapeHtml(ticketEntity(ticket))}<br><strong>Assigned Under:</strong> ${escapeHtml(jobEntity(job))} <span style="font-weight:900">• MANUAL OVERRIDE</span>`;
    });
  }

  function escapeHtml(value) {
    return clean(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  }

  const observer = new MutationObserver(() => decorateEntityOverrides());
  if (document.documentElement) observer.observe(document.documentElement, { childList:true, subtree:true });

  ensureData().then(() => decorateEntityOverrides());
  document.addEventListener('dragstart', event => {
    if (event.target.closest?.('.fv-hauling-partial-tile')) ensureData(true);
  }, true);
  document.addEventListener('click', event => {
    if (event.target.closest?.('#fv-refresh-ticket-hauling,#refresh-hauling-link-btn')) {
      setTimeout(() => ensureData(true).then(decorateEntityOverrides), 150);
    }
  }, true);
})();