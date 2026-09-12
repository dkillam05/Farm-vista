/* FarmVista — hauling-job effective totals — Sept. 12, 2026
   Keeps the main Hauling Jobs table in sync with the hauling-job DND partial ledger.

   A physical grain ticket still keeps its original haulingJobId for traceability.
   haulingJobSplitAllocations records bushel portions moved away from that source
   job, into another job, left as Spot on the source job, or left Unassigned.

   The DND workspace already honors that ledger. This helper makes the main table
   use the SAME effective bushel ownership so Ticketed / Remaining agree after
   split moves and relinks. It is intentionally isolated from combo/dropdown code.
*/
(() => {
  'use strict';

  if (window.__FV_HAULING_EFFECTIVE_TOTALS_20260912_V1) return;
  window.__FV_HAULING_EFFECTIVE_TOTALS_20260912_V1 = true;
  if (!String(location.pathname || '').toLowerCase().endsWith('/pages/grain/grain-contracts.html')) return;

  const clean = value => String(value ?? '').trim();
  const num = value => {
    const n = Number(String(value ?? '').replace(/,/g, '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  };
  const round2 = value => Number(num(value).toFixed(2));
  const fmt = value => num(value).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const EPS = .005;

  let firebase = null;
  let db = null;
  let timer = 0;
  let running = false;
  let rerun = false;

  async function ensureFirebase() {
    if (firebase && db) return;
    firebase = await import('/js/firebase-init.js');
    await firebase.ready;
    db = firebase.getFirestore();
  }

  function ticketBushels(ticket) {
    return Math.max(0, round2(ticket?.netBushels ?? ticket?.netBu ?? ticket?.bushels));
  }

  function isVoided(ticket) {
    return ticket?.voided === true || clean(ticket?.status).toLowerCase().includes('void');
  }

  function normalizedAllocations(ticket) {
    const source = clean(ticket?.haulingJobId);
    const raw = Array.isArray(ticket?.haulingJobSplitAllocations)
      ? ticket.haulingJobSplitAllocations
      : [];

    return raw.map(item => {
      const rawType = clean(item?.allocationType || item?.type || 'job').toLowerCase();
      return {
        sourceJobId: clean(item?.sourceJobId || source),
        haulingJobId: clean(item?.haulingJobId || item?.jobId),
        bushels: Math.max(0, round2(item?.bushels)),
        allocationType: rawType === 'unassigned'
          ? 'unassigned'
          : (rawType === 'spot' ? 'spot' : 'job')
      };
    }).filter(item => item.sourceJobId && item.bushels > EPS);
  }

  /*
     Same ownership model used by the DND engine:
       1. Start with the ticket's physical bushels on its source haulingJobId.
       2. Carve out every recorded partial that left the source residual.
       3. Add non-unassigned partials to their current hauling job.

     A Spot partial whose destination is still the source job is subtracted then
     added back, so it still counts as hauled on that job until the user moves it.
  */
  function addTicketToTotals(ticket, totals) {
    if (isVoided(ticket)) return;

    const source = clean(ticket?.haulingJobId);
    const total = ticketBushels(ticket);
    const allocations = normalizedAllocations(ticket);

    if (source && total > EPS) {
      totals.set(source, round2((totals.get(source) || 0) + total));
    }

    allocations.forEach(allocation => {
      const amount = allocation.bushels;
      const fromSource = allocation.sourceJobId === source;
      const destination = allocation.haulingJobId;
      const carved = fromSource && (
        allocation.allocationType === 'unassigned' ||
        allocation.allocationType === 'spot' ||
        (destination && destination !== source)
      );

      if (carved && source) {
        totals.set(source, round2(Math.max(0, (totals.get(source) || 0) - amount)));
      }

      if (allocation.allocationType !== 'unassigned' && destination) {
        // A normal job allocation back to its own source is not a carved piece;
        // avoid double-counting it. Source Spot IS carved and therefore added back.
        if (!(destination === source && allocation.allocationType !== 'spot')) {
          totals.set(destination, round2((totals.get(destination) || 0) + amount));
        }
      }
    });
  }

  function tableHeaderIndexes(table) {
    const headers = Array.from(table?.querySelectorAll('thead th') || [])
      .map(th => clean(th.textContent).toLowerCase().replace(/\s+/g, ' '));

    const find = candidates => {
      for (const candidate of candidates) {
        const index = headers.findIndex(header => header === candidate || header.startsWith(candidate));
        if (index >= 0) return index;
      }
      return -1;
    };

    return {
      starting: find(['starting bu.', 'starting bu', 'starting']),
      ticketed: find(['ticketed bu.', 'ticketed bu', 'ticketed', 'hauled bu.', 'hauled bu', 'hauled']),
      remaining: find(['remaining'])
    };
  }

  function applyToTable(totals) {
    const body = document.getElementById('hauling-jobs-table-body');
    const table = body?.closest('table');
    if (!body || !table) return;

    const indexes = tableHeaderIndexes(table);
    if (indexes.ticketed < 0 || indexes.remaining < 0) return;

    Array.from(body.querySelectorAll('tr[data-hauling-job-id], tr.hauling-row')).forEach(row => {
      const jobId = clean(row.dataset.haulingJobId);
      if (!jobId) return;

      const ticketed = round2(totals.get(jobId) || 0);
      const starting = indexes.starting >= 0 ? num(row.cells[indexes.starting]?.textContent) : 0;
      const remaining = round2(Math.max(0, starting - ticketed));

      if (row.cells[indexes.ticketed]) row.cells[indexes.ticketed].textContent = fmt(ticketed);
      if (row.cells[indexes.remaining]) row.cells[indexes.remaining].textContent = fmt(remaining);
    });

    // Rebuild visible summary from the rows currently displayed, preserving filters.
    let ticketedTotal = 0;
    let remainingTotal = 0;
    Array.from(body.querySelectorAll('tr[data-hauling-job-id], tr.hauling-row')).forEach(row => {
      if (indexes.ticketed >= 0) ticketedTotal += num(row.cells[indexes.ticketed]?.textContent);
      if (indexes.remaining >= 0) remainingTotal += num(row.cells[indexes.remaining]?.textContent);
    });

    const delivered = document.getElementById('hauling-summary-delivered');
    const remainingSummary = document.getElementById('hauling-summary-remaining');
    if (delivered) delivered.textContent = fmt(round2(ticketedTotal));
    if (remainingSummary) remainingSummary.textContent = fmt(round2(remainingTotal));

    // Re-run the existing remaining-color helper without touching dropdowns.
    window.dispatchEvent(new CustomEvent('fv:hauling-effective-totals-updated'));
  }

  async function refreshNow() {
    if (running) {
      rerun = true;
      return;
    }
    running = true;
    try {
      await ensureFirebase();
      const snap = await firebase.getDocs(firebase.collection(db, 'grain_tickets'));
      const totals = new Map();
      snap.docs.forEach(docSnap => addTicketToTotals({ id: docSnap.id, ...docSnap.data() }, totals));
      applyToTable(totals);
    } catch (error) {
      console.warn('[FarmVista] effective hauling totals refresh failed:', error);
    } finally {
      running = false;
      if (rerun) {
        rerun = false;
        schedule(75);
      }
    }
  }

  function schedule(delay = 250) {
    clearTimeout(timer);
    timer = setTimeout(refreshNow, delay);
  }

  // Refresh after the same user actions that rebuild hauling totals / move portions.
  document.addEventListener('click', event => {
    if (event.target.closest?.('#fv-refresh-ticket-hauling, #refresh-hauling-link-btn')) schedule(450);
  }, true);

  document.addEventListener('drop', () => schedule(700), true);

  // The core table renderer replaces tbody rows. Watch only this tbody, never the
  // whole page, so dropdown portals cannot trigger or be modified by this helper.
  const installTimer = setInterval(() => {
    const body = document.getElementById('hauling-jobs-table-body');
    if (!body || body.dataset.fvEffectiveTotalsWatch === '1') return;
    body.dataset.fvEffectiveTotalsWatch = '1';
    new MutationObserver(() => schedule(50)).observe(body, { childList: true });
    clearInterval(installTimer);
    schedule(50);
  }, 100);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => schedule(100), { once: true });
  } else {
    schedule(100);
  }
})();
