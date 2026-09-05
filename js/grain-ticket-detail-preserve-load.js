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

/* Sept 5, 2026 — Ticket Details mobile viewer + OCR display tools. */
(() => {
  const path = String(location.pathname || '').toLowerCase();
  if (!path.endsWith('/pages/grain/grain-ticket-detail.html')) return;
  if (window.__FV_TICKET_DETAIL_MOBILE_VIEWER_LOADER_V3_20260905) return;
  window.__FV_TICKET_DETAIL_MOBILE_VIEWER_LOADER_V3_20260905 = true;

  const script = document.createElement('script');
  script.src = '/js/grain-ticket-detail-mobile-viewer-v2.js?v=20260905-3';
  script.dataset.fvTicketDetailMobileViewer = '1';
  document.head.appendChild(script);
})();
