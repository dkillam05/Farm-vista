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
  if (window.__FV_TICKET_DETAIL_MOBILE_VIEWER_LOADER_V4_20260905) return;
  window.__FV_TICKET_DETAIL_MOBILE_VIEWER_LOADER_V4_20260905 = true;

  const script = document.createElement('script');
  script.src = '/js/grain-ticket-detail-mobile-viewer-v2.js?v=20260905-4';
  script.dataset.fvTicketDetailMobileViewer = '1';
  document.head.appendChild(script);

  const firstLoadWake = document.createElement('script');
  firstLoadWake.src = '/js/grain-ticket-detail-first-load-wake.js?v=20260905-2';
  firstLoadWake.dataset.fvTicketDetailFirstLoadWake = '1';
  document.head.appendChild(firstLoadWake);
})();

/*
  Sept 10, 2026 — Review completion gate
  --------------------------------------
  Once an office user opens a grain ticket for review, FarmVista must not save
  another partially-resolved Needs Review record. The detail page already has
  one authoritative validator: currentReviewReasons(). Its result drives the
  status pill, review list, and the "Save & Verify Ticket" label.

  This capture-phase gate deliberately uses that existing UI result instead of
  inventing a second set of business rules. If ANY review reason remains, the
  native save handler is stopped, the user is moved to the review errors, and
  the first unresolved control is focused when possible.
*/
(() => {
  const path = String(location.pathname || '').toLowerCase();
  if (!path.endsWith('/pages/grain/grain-ticket-detail.html')) return;
  if (window.__FV_GRAIN_TICKET_REVIEW_COMPLETION_GATE_20260910) return;
  window.__FV_GRAIN_TICKET_REVIEW_COMPLETION_GATE_20260910 = true;

  const clean = value => String(value == null ? '' : value).trim();

  function verifiedNow() {
    const status = document.getElementById('statusPill');
    const save = document.getElementById('saveBtn');

    return Boolean(
      status?.classList.contains('good') &&
      /save\s*&\s*verify\s*ticket/i.test(clean(save?.textContent))
    );
  }

  function firstReviewText() {
    const item = document.querySelector('#reviewList li');
    return clean(item?.textContent).toLowerCase();
  }

  function targetForReviewText(text) {
    const map = [
      [/destination|delivery location|elevator/, 'destinationButton'],
      [/sold under|customer/, 'customerButton'],
      [/crop/, 'crop'],
      [/grain source|source/, 'grainSourceButton'],
      [/hauling job|spot load/, 'contractSelect'],
      [/ticket number|ticket #/, 'ticketNumber'],
      [/ticket date|date/, 'ticketDate'],
      [/weight|gross|tare|net weight/, 'grossWeight'],
      [/bushel|shrink/, 'grossBushels']
    ];

    for (const [pattern, id] of map) {
      if (pattern.test(text)) return document.getElementById(id);
    }

    return null;
  }

  function showBlockedMessage() {
    const message = document.getElementById('message');
    if (!message) return;

    message.textContent =
      'This ticket cannot be saved yet. Correct every item under Needs Review, then Save & Verify Ticket.';

    message.className = 'message warning show';
  }

  function redirectToErrors() {
    showBlockedMessage();

    const reviewBox = document.getElementById('reviewBox');
    const firstText = firstReviewText();
    const target = targetForReviewText(firstText);

    (target || reviewBox)?.scrollIntoView({
      behavior: 'smooth',
      block: 'center'
    });

    if (target && typeof target.focus === 'function') {
      setTimeout(() => {
        try { target.focus({ preventScroll: true }); }
        catch (_) { try { target.focus(); } catch (_) {} }
      }, 350);
    }
  }

  function blockIncompleteSave(event) {
    if (verifiedNow()) return false;

    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') {
      event.stopImmediatePropagation();
    }

    redirectToErrors();
    return true;
  }

  function onClickCapture(event) {
    const save = event.target?.closest?.('#saveBtn');
    if (!save) return;
    blockIncompleteSave(event);
  }

  function onSubmitCapture(event) {
    const save = document.getElementById('saveBtn');
    if (!save) return;

    const form = save.closest('form');
    if (form && event.target !== form) return;

    blockIncompleteSave(event);
  }

  document.addEventListener('click', onClickCapture, true);
  document.addEventListener('submit', onSubmitCapture, true);
})();
