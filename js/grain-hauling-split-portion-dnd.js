/* FarmVista — hauling-job split portion DND
   Sept. 12, 2026

   Purpose: make hauling-job split loads behave visually like contract split loads.
   A physical ticket that crosses the hauling-job target is represented by TWO
   stable portions:
     • JOB FILL — only the bushels that finish the hauling job
     • SPOT PORTION — only the overflow bushels, shown in Spot Loads

   The original full-ticket split card is hidden. The Spot Portion is independently
   draggable to another hauling job. This file intentionally does NOT use a
   MutationObserver so it cannot create the render/flash loop that previously
   fought the hauling-job renderer or custom dropdowns.
*/
(() => {
  'use strict';

  if (window.__FV_HAULING_SPLIT_PORTION_DND_20260912_V4) return;
  window.__FV_HAULING_SPLIT_PORTION_DND_20260912_V4 = true;

  if (!String(location.pathname || '').toLowerCase().endsWith('/pages/grain/grain-contracts.html')) return;

  const ROOT_ID = 'fv-ticket-status-job-list';
  const clean = value => String(value ?? '').trim();
  const numberValue = value => {
    const parsed = Number(String(value ?? '').replace(/,/g, '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const round2 = value => Number(numberValue(value).toFixed(2));
  const fmtBu = value => numberValue(value).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const esc = value => clean(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  let firebase = null;
  let db = null;
  let moving = false;

  function installStyle() {
    if (document.getElementById('fv-hauling-split-contract-style-v4')) return;
    const style = document.createElement('style');
    style.id = 'fv-hauling-split-contract-style-v4';
    style.textContent = `
      /* Never flash the original whole-ticket split card. */
      #${ROOT_ID} .fv-hauling-ticket-card:has(.fv-seq-badge.split){display:none!important}

      .fv-hauling-derived-portion{
        margin-top:8px;
        padding:10px 11px;
        border:1px solid var(--border,#d8d8d8);
        border-radius:9px;
        background:var(--surface,#fff);
      }
      .fv-hauling-derived-portion.spot{cursor:grab}
      .fv-hauling-derived-portion.spot.dragging{opacity:.48}
      .fv-hauling-derived-title{
        display:flex;align-items:center;justify-content:space-between;gap:10px;font-weight:900
      }
      .fv-hauling-derived-left{min-width:0}
      .fv-hauling-derived-badge{
        display:inline-flex;margin-left:7px;padding:2px 7px;border-radius:999px;
        font-size:.67rem;font-weight:900;vertical-align:middle
      }
      .fv-hauling-derived-badge.job{background:rgba(59,126,70,.12);color:#2d6937}
      .fv-hauling-derived-badge.spot{background:rgba(179,38,30,.11);color:#9d241e}
      .fv-hauling-derived-meta{margin-top:5px;font-size:.72rem;line-height:1.4;opacity:.72}
      .fv-hauling-derived-sold{margin-top:5px;font-size:.72rem;font-weight:800}
      .fv-hauling-derived-detail{margin-top:5px;font-size:.72rem;font-weight:900}
      .fv-hauling-derived-portion.job .fv-hauling-derived-detail{color:#2d6937}
      .fv-hauling-derived-portion.spot .fv-hauling-derived-detail{color:#9d241e}
      .fv-hauling-derived-note{margin-top:5px;font-size:.7rem;font-weight:750;opacity:.64}
      .fv-hauling-derived-drop{outline:2px solid #4f718f!important;outline-offset:1px;background:rgba(79,113,143,.08)!important}
      [data-theme="dark"] .fv-hauling-derived-badge.job{color:#b9e4bf}
      [data-theme="dark"] .fv-hauling-derived-badge.spot{color:#ffaaa4}
    `;
    document.head.appendChild(style);
  }

  function parseSplit(card) {
    const detail = clean(card.querySelector('.fv-seq-detail.split')?.textContent);
    const jobMatch = detail.match(/Job:\s*([\d,.]+)\s*bu/i);
    const spotMatch = detail.match(/Spot:\s*([\d,.]+)\s*bu/i);
    return {
      fill: round2(jobMatch ? jobMatch[1] : 0),
      spot: round2(spotMatch ? spotMatch[1] : 0)
    };
  }

  function ticketNo(card) {
    const text = clean(card.querySelector('.fv-hauling-ticket-title > span:first-child')?.textContent);
    const match = text.match(/Ticket\s+([^\s]+)/i);
    return match?.[1] || clean(card.dataset.ticketId) || 'Ticket';
  }

  function ticketMeta(card) {
    return clean(card.querySelector('.fv-hauling-ticket-meta')?.innerHTML) || '';
  }

  function soldUnderHtml(card) {
    return card.querySelector('.fv-ticket-sold-under')?.innerHTML || '<strong>Sold Under:</strong> —';
  }

  function portionMarkup({ card, jobId, amount, type }) {
    const ticketId = clean(card.dataset.ticketId);
    const no = ticketNo(card);
    const isSpot = type === 'spot';
    const key = `${ticketId}|${jobId}|${type}`;
    return `
      <div class="fv-hauling-derived-portion ${type}"
           ${isSpot ? 'draggable="true"' : ''}
           data-fv-hauling-derived="${esc(key)}"
           data-ticket-id="${esc(ticketId)}"
           data-source-job-id="${esc(jobId)}"
           data-current-job-id="${esc(jobId)}"
           data-portion-bushels="${esc(round2(amount))}"
           data-portion-type="${esc(type)}">
        <div class="fv-hauling-derived-title">
          <span class="fv-hauling-derived-left">Ticket ${esc(no)}<span class="fv-hauling-derived-badge ${type}">${isSpot ? 'SPOT PORTION' : 'JOB FILL'}</span></span>
          <span>${fmtBu(amount)} bu</span>
        </div>
        <div class="fv-hauling-derived-meta">${ticketMeta(card)}</div>
        <div class="fv-hauling-derived-sold">${soldUnderHtml(card)}</div>
        <div class="fv-hauling-derived-detail">${isSpot ? 'Spot' : 'Job'}: ${fmtBu(amount)} bu</div>
        <div class="fv-hauling-derived-note">${isSpot
          ? 'Drag this Spot portion to another hauling job to move only these bushels.'
          : 'This portion stays on the hauling job that this elevator ticket filled.'}</div>
      </div>`;
  }

  function removeOldSplitSummary(spotZone) {
    spotZone?.querySelectorAll('.fv-job-spot-empty').forEach(node => {
      if (/split-load\s+spot\s+portion/i.test(clean(node.textContent))) node.remove();
    });
  }

  function ensureSplitTiles() {
    installStyle();
    const root = document.getElementById(ROOT_ID);
    if (!root || root.hidden) return;

    root.querySelectorAll('[data-fv-status-job][data-fv-ticket-job-id]').forEach(jobCard => {
      const jobId = clean(jobCard.dataset.fvTicketJobId);
      if (!jobId) return;

      const fillZone = jobCard.querySelector(`[data-fv-fill-job-id="${CSS.escape(jobId)}"]`);
      const spotZone = jobCard.querySelector(`[data-fv-spot-job-id="${CSS.escape(jobId)}"]`);
      removeOldSplitSummary(spotZone);

      jobCard.querySelectorAll('.fv-hauling-ticket-card[data-fv-status-ticket][data-ticket-id]').forEach(card => {
        if (!card.querySelector('.fv-seq-badge.split')) return;

        const { fill, spot } = parseSplit(card);
        if (!(fill > .005) || !(spot > .005)) return;

        const ticketId = clean(card.dataset.ticketId);
        const fillKey = `${ticketId}|${jobId}|job`;
        const spotKey = `${ticketId}|${jobId}|spot`;

        if (fillZone && !fillZone.querySelector(`[data-fv-hauling-derived="${CSS.escape(fillKey)}"]`)) {
          fillZone.insertAdjacentHTML('beforeend', portionMarkup({ card, jobId, amount: fill, type: 'job' }));
        }
        if (spotZone && !spotZone.querySelector(`[data-fv-hauling-derived="${CSS.escape(spotKey)}"]`)) {
          spotZone.insertAdjacentHTML('beforeend', portionMarkup({ card, jobId, amount: spot, type: 'spot' }));
        }
      });
    });

    bindSpotTiles(root);
  }

  function bindSpotTiles(root) {
    root.querySelectorAll('.fv-hauling-derived-portion.spot[draggable="true"]').forEach(tile => {
      if (tile.dataset.fvBound === '1') return;
      tile.dataset.fvBound = '1';
      tile.addEventListener('dragstart', event => {
        const payload = {
          ticketId: clean(tile.dataset.ticketId),
          sourceJobId: clean(tile.dataset.sourceJobId),
          currentJobId: clean(tile.dataset.currentJobId),
          bushels: round2(tile.dataset.portionBushels),
          portionType: 'spot'
        };
        tile.classList.add('dragging');
        event.dataTransfer.effectAllowed = 'move';
        try {
          event.dataTransfer.setData('application/x-fv-hauling-portion', JSON.stringify(payload));
          event.dataTransfer.setData('text/plain', `FVPORTION:${JSON.stringify(payload)}`);
        } catch (_) {}
      });
      tile.addEventListener('dragend', () => tile.classList.remove('dragging'));
    });
  }

  function readPayload(event) {
    let raw = '';
    try { raw = event.dataTransfer?.getData('application/x-fv-hauling-portion') || ''; } catch (_) {}
    if (!raw) {
      try {
        const text = event.dataTransfer?.getData('text/plain') || '';
        if (text.startsWith('FVPORTION:')) raw = text.slice('FVPORTION:'.length);
      } catch (_) {}
    }
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (_) { return null; }
  }

  async function ensureFirebase() {
    if (firebase && db) return;
    firebase = await import('/js/firebase-init.js');
    await firebase.ready;
    db = firebase.getFirestore();
  }

  async function moveSpotPortion(payload, destinationJobId) {
    if (moving) return;
    moving = true;
    try {
      await ensureFirebase();
      const ticketRef = firebase.doc(db, 'grain_tickets', clean(payload.ticketId));
      const snap = await firebase.getDoc(ticketRef);
      if (!snap.exists()) return;
      const ticket = snap.data();
      const amount = round2(payload.bushels);
      const sourceJobId = clean(payload.sourceJobId || ticket?.haulingJobId);
      const destination = clean(destinationJobId);
      if (!sourceJobId || !destination || !(amount > .005)) return;

      const current = Array.isArray(ticket?.haulingJobSplitAllocations)
        ? ticket.haulingJobSplitAllocations.filter(Boolean)
        : [];

      const next = current.filter(item => !(
        clean(item?.sourceJobId) === sourceJobId &&
        clean(item?.haulingJobId || item?.jobId) === clean(payload.currentJobId || sourceJobId) &&
        Math.abs(numberValue(item?.bushels) - amount) < .01
      ));

      if (destination !== sourceJobId) {
        next.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          sourceJobId,
          haulingJobId: destination,
          bushels: amount,
          allocationType: 'job',
          source: 'manual_split_dnd',
          createdAt: new Date().toISOString()
        });
      }

      await firebase.updateDoc(ticketRef, {
        haulingJobSplitAllocations: next,
        haulingJobSplitUpdatedAt: firebase.serverTimestamp(),
        updatedAt: firebase.serverTimestamp()
      });

      document.getElementById('fv-refresh-ticket-hauling')?.click();
    } catch (error) {
      console.error('[FarmVista] Could not move split hauling-job Spot portion:', error);
      alert(error?.message || 'FarmVista could not move that split-load Spot portion.');
    } finally {
      moving = false;
    }
  }

  document.addEventListener('dragover', event => {
    if (!document.querySelector('.fv-hauling-derived-portion.spot.dragging')) return;
    const target = event.target.closest?.('[data-fv-status-job][data-fv-ticket-job-id]');
    if (!target) return;
    event.preventDefault();
    target.classList.add('fv-hauling-derived-drop');
  }, true);

  document.addEventListener('dragleave', event => {
    const target = event.target.closest?.('[data-fv-status-job][data-fv-ticket-job-id]');
    target?.classList.remove('fv-hauling-derived-drop');
  }, true);

  document.addEventListener('drop', event => {
    const payload = readPayload(event);
    if (!payload) return;
    const target = event.target.closest?.('[data-fv-status-job][data-fv-ticket-job-id]');
    const destinationJobId = clean(target?.dataset?.fvTicketJobId);
    if (!destinationJobId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    target.classList.remove('fv-hauling-derived-drop');
    moveSpotPortion(payload, destinationJobId);
  }, true);

  /*
    Deliberately use a small idempotent timer rather than observing DOM changes.
    The status DND renderer may replace a job card after a filter/refresh. This
    quietly restores the two contract-style tiles without causing a render loop.
    It does not touch dropdowns or any element outside the hauling-job DND list.
  */
  setInterval(ensureSplitTiles, 350);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureSplitTiles, { once: true });
  } else {
    ensureSplitTiles();
  }
})();