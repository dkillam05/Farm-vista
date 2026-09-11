/*
  FarmVista — Grain Ticket Detail source edit preservation
  --------------------------------------------------------
  Ticket Details historically treated Grain Source as an early wizard step:
  changing it cleared Destination, Sold Under, and Hauling Job.

  On an EXISTING ticket that is wrong. Editing only Field / Active Harvest /
  Storage should not disturb the already-established load details.

  This helper lets the page's native chooseGrainSource() run so its internal
  selectedSource state stays correct, then restores the existing downstream
  selections through the page's own rendered controls in order:
    Destination -> Sold Under -> Hauling Job.

  It does not alter Crop, Driver, Load Number, Destination, Sold Under, or
  Hauling Job unless the user explicitly changes those controls themselves.
*/

(() => {
  const path = String(location.pathname || '').toLowerCase();
  if (!path.endsWith('/pages/grain/grain-ticket-detail.html')) return;

  const clean = value => String(value == null ? '' : value).trim();

  let restoring = false;

  function snapshotLoadDetails() {
    return {
      locationId: clean(document.getElementById('locationSelect')?.value),
      buyerId: clean(document.getElementById('buyerSelect')?.value),
      customerId: clean(document.getElementById('customerSelect')?.value),
      haulingJobId: clean(document.getElementById('contractSelect')?.value),
      destinationLabel: clean(document.getElementById('destinationButtonText')?.textContent),
      customerLabel: clean(document.getElementById('customerButtonText')?.textContent)
    };
  }

  function clickMatching(menuId, dataKey, wanted) {
    if (!wanted) return false;
    const menu = document.getElementById(menuId);
    if (!menu) return false;

    const buttons = Array.from(menu.querySelectorAll('.load-picker-choice'));
    const match = buttons.find(button => clean(button.dataset?.[dataKey]) === wanted);
    if (!match) return false;

    match.click();
    return true;
  }

  function restoreDirect(snapshot) {
    const location = document.getElementById('locationSelect');
    const buyer = document.getElementById('buyerSelect');
    const customer = document.getElementById('customerSelect');
    const haulingJob = document.getElementById('contractSelect');
    const destinationText = document.getElementById('destinationButtonText');
    const customerText = document.getElementById('customerButtonText');

    if (location && snapshot.locationId) location.value = snapshot.locationId;
    if (buyer && snapshot.buyerId) buyer.value = snapshot.buyerId;
    if (customer && snapshot.customerId) customer.value = snapshot.customerId;
    if (haulingJob && snapshot.haulingJobId) haulingJob.value = snapshot.haulingJobId;

    if (destinationText && snapshot.destinationLabel) {
      destinationText.textContent = snapshot.destinationLabel;
    }
    if (customerText && snapshot.customerLabel) {
      customerText.textContent = snapshot.customerLabel;
    }
  }

  function restoreLoadDetails(snapshot) {
    if (restoring) return;
    restoring = true;

    try {
      const destinationRestored = clickMatching(
        'destinationMenu',
        'locationId',
        snapshot.locationId
      );

      const customerRestored = clickMatching(
        'customerMenu',
        'customerId',
        snapshot.customerId
      );

      const haulingJob = document.getElementById('contractSelect');
      if (haulingJob && snapshot.haulingJobId) {
        const exists = Array.from(haulingJob.options || [])
          .some(option => clean(option.value) === snapshot.haulingJobId);

        if (exists) {
          haulingJob.value = snapshot.haulingJobId;
          haulingJob.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }

      if (!destinationRestored || !customerRestored) {
        restoreDirect(snapshot);
      }
    } finally {
      restoring = false;
    }
  }

  function onSourceClickCapture(event) {
    if (restoring) return;

    const button = event.target?.closest?.('#grainSourceMenu .load-picker-choice[data-source-value]');
    if (!button) return;

    const snapshot = snapshotLoadDetails();
    setTimeout(() => restoreLoadDetails(snapshot), 0);
  }

  function bind() {
    document.addEventListener('click', onSourceClickCapture, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind, { once: true });
  } else {
    bind();
  }
})();

/*
  Sept 11, 2026 — Saved ticket assignment reconciliation.

  Driver-/office-selected FarmVista IDs are authoritative. OCR is supporting
  evidence only and may contain a different postal ZIP or a slightly different
  printed address. The inline Ticket Details matcher can reject a correct saved
  destination when one OCR location field differs, and it can downgrade a real
  saved Sold Under to Unknown while the hauling job is still unresolved.

  After the native page controls render, re-select the saved destination and
  saved Sold Under through the page's OWN picker buttons. That keeps the private
  Ticket Details state, hidden IDs, hauling-job filtering, and review state in
  sync. Hauling Job itself is never guessed here.
*/
(() => {
  const path = String(location.pathname || '').toLowerCase();
  if (!path.endsWith('/pages/grain/grain-ticket-detail.html')) return;
  if (window.__FV_TICKET_DETAIL_SAVED_ASSIGNMENTS_20260911_V2) return;
  window.__FV_TICKET_DETAIL_SAVED_ASSIGNMENTS_20260911_V2 = true;

  const clean = value => String(value == null ? '' : value).trim();
  const ticketId = clean(new URLSearchParams(location.search).get('id'));

  async function readSavedAssignments() {
    if (!ticketId) return null;

    try {
      const firebase = await import('/js/firebase-init.js');
      await firebase.ready;

      const db = firebase.getFirestore();
      const snap = await firebase.getDoc(
        firebase.doc(db, 'grain_tickets', ticketId)
      );

      if (!snap.exists()) return null;

      const ticket = snap.data() || {};

      return {
        locationId: clean(
          ticket.deliveryLocationId ||
          ticket.destinationId ||
          ticket.locationId
        ),
        customerId: clean(
          ticket.customerId ||
          ticket.grainCustomerId
        ),
        locationMatchType: clean(ticket.deliveryLocationMatchType),
        customerMatchType: clean(ticket.customerMatchType)
      };
    } catch (error) {
      console.warn('[FarmVista] Could not reconcile saved grain ticket assignments:', error);
      return null;
    }
  }

  function clickSavedDestination(locationId) {
    if (!locationId) return true;

    const current = clean(document.getElementById('locationSelect')?.value);
    if (current === locationId) return true;

    const menu = document.getElementById('destinationMenu');
    if (!menu) return false;

    const button = Array.from(
      menu.querySelectorAll('.load-picker-choice[data-location-id]')
    ).find(item => clean(item.dataset.locationId) === locationId);

    if (!button) return false;

    button.click();
    return clean(document.getElementById('locationSelect')?.value) === locationId;
  }

  function clickSavedCustomer(customerId) {
    if (!customerId) return true;

    const current = clean(document.getElementById('customerSelect')?.value);
    if (current === customerId) return true;

    const menu = document.getElementById('customerMenu');
    if (!menu) return false;

    const button = Array.from(
      menu.querySelectorAll('.load-picker-choice[data-customer-id]')
    ).find(item => clean(item.dataset.customerId) === customerId);

    if (!button) return false;

    button.click();
    return clean(document.getElementById('customerSelect')?.value) === customerId;
  }

  async function reconcile() {
    const saved = await readSavedAssignments();
    if (!saved) return;

    let attempts = 0;

    const tryRestore = () => {
      attempts += 1;

      const locationReady = clickSavedDestination(saved.locationId);
      const customerReady = locationReady && clickSavedCustomer(saved.customerId);

      if (locationReady && customerReady) {
        console.info('[Grain Ticket Detail] Restored saved FarmVista assignments.', {
          ticketId,
          deliveryLocationId: saved.locationId || null,
          deliveryLocationMatchType: saved.locationMatchType || null,
          customerId: saved.customerId || null,
          customerMatchType: saved.customerMatchType || null
        });
        return;
      }

      if (attempts < 50) {
        setTimeout(tryRestore, 100);
      } else {
        console.warn('[Grain Ticket Detail] Saved assignment restore timed out.', {
          ticketId,
          deliveryLocationId: saved.locationId || null,
          customerId: saved.customerId || null
        });
      }
    };

    tryRestore();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', reconcile, { once: true });
  } else {
    reconcile();
  }
})();

/* Sept 5, 2026 — Ticket Details mobile viewer + OCR display tools. */
(() => {
  const path = String(location.pathname || '').toLowerCase();
  if (!path.endsWith('/pages/grain/grain-ticket-detail.html')) return;
  if (window.__FV_TICKET_DETAIL_MOBILE_VIEWER_LOADER_V5_20260911) return;
  window.__FV_TICKET_DETAIL_MOBILE_VIEWER_LOADER_V5_20260911 = true;

  const script = document.createElement('script');
  script.src = '/js/grain-ticket-detail-mobile-viewer-v2.js?v=20260905-4';
  script.dataset.fvTicketDetailMobileViewer = '1';
  document.head.appendChild(script);

  const firstLoadWake = document.createElement('script');
  firstLoadWake.src = '/js/grain-ticket-detail-first-load-wake.js?v=20260911-3';
  firstLoadWake.dataset.fvTicketDetailFirstLoadWake = '1';
  document.head.appendChild(firstLoadWake);
})();
