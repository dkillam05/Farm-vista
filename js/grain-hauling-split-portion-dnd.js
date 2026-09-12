/* FarmVista — hauling-job split portion DND
   Sept. 12, 2026

   Makes the ticket that fills a hauling job and spills over behave like the
   contract split-load workspace: the Job portion stays in Job Fill and the
   remainder becomes its own draggable tile in Spot Loads.

   Moving only the split Spot portion does NOT move the whole grain ticket.
   The physical ticket keeps its original haulingJobId for compatibility; the
   moved partial bushels are stored in haulingJobSplitAllocations on the ticket.
*/
(() => {
  'use strict';

  if (window.__FV_HAULING_SPLIT_PORTION_DND_20260912_V1) return;
  window.__FV_HAULING_SPLIT_PORTION_DND_20260912_V1 = true;
  if (!String(location.pathname || '').toLowerCase().endsWith('/pages/grain/grain-contracts.html')) return;

  const clean = value => String(value ?? '').trim();
  const num = value => {
    const parsed = Number(String(value ?? '').replace(/,/g,'').replace(/[^0-9.-]/g,''));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const round2 = value => Number(num(value).toFixed(2));
  const fmt = value => num(value).toLocaleString('en-US',{maximumFractionDigits:2});
  const esc = value => clean(value)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#039;');

  let firebase = null;
  let db = null;
  let tickets = new Map();
  let jobs = new Map();
  let loading = null;
  let decorating = false;
  let queued = false;
  let rootObserver = null;
  let observedRoot = null;

  function installStyle() {
    if (document.getElementById('fv-hauling-split-portion-style')) return;
    const style = document.createElement('style');
    style.id = 'fv-hauling-split-portion-style';
    style.textContent = `
      .fv-split-portion-card{
        margin-top:8px;
        padding:10px 11px;
        border:1px solid var(--border,#d8d8d8);
        border-radius:9px;
        background:var(--surface,#fff);
        cursor:grab;
      }
      .fv-split-portion-card.dragging{opacity:.48}
      .fv-split-portion-title{
        display:flex;align-items:center;justify-content:space-between;gap:10px;
        font-weight:900;
      }
      .fv-split-portion-title-left{min-width:0}
      .fv-split-portion-badge{
        display:inline-flex;margin-left:7px;padding:2px 7px;border-radius:999px;
        font-size:.67rem;font-weight:900;vertical-align:middle;
        background:rgba(179,38,30,.11);color:#9d241e;
      }
      .fv-split-portion-badge.job{
        background:rgba(59,126,70,.12);color:#2d6937;
      }
      .fv-split-portion-meta{margin-top:5px;font-size:.72rem;line-height:1.4;opacity:.72}
      .fv-split-portion-detail{margin-top:5px;font-size:.72rem;font-weight:900;color:#9d241e}
      .fv-split-portion-card.job .fv-split-portion-detail{color:#2d6937}
      .fv-split-portion-note{margin-top:5px;font-size:.7rem;font-weight:750;opacity:.63}
      .fv-split-portion-drop.drag-over,
      [data-fv-status-job].fv-split-portion-drop-target{
        outline:2px solid #4f718f!important;outline-offset:1px;background:rgba(79,113,143,.08)!important;
      }
      [data-theme="dark"] .fv-split-portion-badge{color:#ffaaa4}
      [data-theme="dark"] .fv-split-portion-badge.job{color:#b9e4bf}
    `;
    document.head.appendChild(style);
  }

  async function load(force=false) {
    if (loading && !force) return loading;
    loading = (async() => {
      const f = firebase || await import('/js/firebase-init.js');
      await f.ready;
      firebase = f;
      db = f.getFirestore();
      const [ticketSnap,jobSnap] = await Promise.all([
        f.getDocs(f.collection(db,'grain_tickets')),
        f.getDocs(f.collection(db,'grain_hauling_jobs'))
      ]);
      tickets = new Map(ticketSnap.docs.map(s => [s.id,{id:s.id,...s.data()}]));
      jobs = new Map(jobSnap.docs.map(s => [s.id,{id:s.id,...s.data()}]));
    })().catch(error => console.warn('[FarmVista] split hauling portion load failed:',error))
      .finally(() => { loading = null; });
    return loading;
  }

  function splitAllocations(ticket) {
    const raw = Array.isArray(ticket?.haulingJobSplitAllocations)
      ? ticket.haulingJobSplitAllocations
      : [];
    return raw
      .map((item,index) => ({
        id:clean(item?.id) || `split-${index}`,
        sourceJobId:clean(item?.sourceJobId || ticket?.haulingJobId),
        haulingJobId:clean(item?.haulingJobId || item?.jobId),
        bushels:round2(item?.bushels),
        allocationType:clean(item?.allocationType || item?.type || 'job').toLowerCase() === 'spot' ? 'spot' : 'job',
        createdAt:item?.createdAt || null
      }))
      .filter(item => item.haulingJobId && item.bushels > .005);
  }

  function parseSplitDetail(card) {
    const detail = clean(card.querySelector('.fv-seq-detail.split')?.textContent);
    const jobMatch = detail.match(/Job:\s*([\d,.]+)\s*bu/i);
    const spotMatch = detail.match(/Spot:\s*([\d,.]+)\s*bu/i);
    return {
      fill:round2(jobMatch ? jobMatch[1] : 0),
      spot:round2(spotMatch ? spotMatch[1] : 0)
    };
  }

  function movedFromSource(ticket,sourceJobId) {
    return splitAllocations(ticket)
      .filter(item => item.sourceJobId === sourceJobId && item.haulingJobId !== sourceJobId)
      .reduce((sum,item) => sum + item.bushels,0);
  }

  function ticketMeta(ticket) {
    const date = clean(ticket?.ticketDate || ticket?.date || ticket?.deliveryDate) || 'No date';
    const crop = clean(ticket?.crop || ticket?.commodity || ticket?.grain || ticket?.cropName) || 'Unknown crop';
    const destination = clean(ticket?.deliveryLocationName || ticket?.destinationName || ticket?.destination || ticket?.buyerName || ticket?.elevatorName) || 'Unknown destination';
    return `${date} • ${crop}<br>${destination}`;
  }

  function partialTile({ticket,sourceJobId,currentJobId,bushels,type='spot',origin='automatic'}) {
    const ticketNo = clean(ticket?.ticketNumber || ticket?.ticketNo || ticket?.ticket || ticket?.number || ticket?.scaleTicketNumber || ticket?.id);
    const badge = type === 'spot' ? 'SPOT PORTION' : 'SPLIT PORTION';
    const detail = type === 'spot'
      ? `Spot: ${fmt(bushels)} bu`
      : `Assigned to this hauling job: ${fmt(bushels)} bu`;
    const note = type === 'spot'
      ? 'Drag this portion onto another hauling job to move only these bushels. The rest of the ticket stays where it is.'
      : 'This is only part of the original elevator ticket. Drag it to another hauling job if needed.';
    return `
      <div class="fv-split-portion-card ${type==='job'?'job':''}" draggable="true"
           data-fv-split-portion="1"
           data-ticket-id="${esc(ticket.id)}"
           data-source-job-id="${esc(sourceJobId)}"
           data-current-job-id="${esc(currentJobId)}"
           data-portion-bushels="${esc(bushels)}"
           data-portion-type="${esc(type)}"
           data-portion-origin="${esc(origin)}">
        <div class="fv-split-portion-title">
          <span class="fv-split-portion-title-left">Ticket ${esc(ticketNo)}<span class="fv-split-portion-badge ${type==='job'?'job':''}">${badge}</span></span>
          <span>${fmt(bushels)} bu</span>
        </div>
        <div class="fv-split-portion-meta">${ticketMeta(ticket)}</div>
        <div class="fv-split-portion-detail">${detail}</div>
        <div class="fv-split-portion-note">${note}</div>
      </div>`;
  }

  function clearInjected() {
    document.querySelectorAll('.fv-split-portion-card').forEach(node => node.remove());
  }

  function adjustSourceSplitCard(card,ticket,sourceJobId) {
    const parts = parseSplitDetail(card);
    if (!(parts.spot > .005)) return;

    const moved = movedFromSource(ticket,sourceJobId);
    const remainingSpot = Math.max(0,round2(parts.spot - moved));

    const amount = card.querySelector('.fv-hauling-ticket-title > span:last-child');
    if (amount) amount.textContent = `${fmt(parts.fill)} bu`;

    const badge = card.querySelector('.fv-seq-badge.split');
    if (badge) {
      badge.textContent = 'JOB FILL';
      badge.classList.remove('split');
      badge.classList.add('job');
    }

    const detail = card.querySelector('.fv-seq-detail.split');
    if (detail) {
      detail.classList.remove('split');
      detail.textContent = `Job: ${fmt(parts.fill)} bu`;
    }

    const jobCard = card.closest('[data-fv-status-job][data-fv-ticket-job-id]');
    const spotZone = jobCard?.querySelector(`[data-fv-spot-job-id="${CSS.escape(sourceJobId)}"]`);
    if (spotZone && remainingSpot > .005) {
      spotZone.insertAdjacentHTML('beforeend',partialTile({
        ticket,
        sourceJobId,
        currentJobId:sourceJobId,
        bushels:remainingSpot,
        type:'spot',
        origin:'automatic'
      }));
    }
  }

  function injectMovedPortions(ticket) {
    splitAllocations(ticket).forEach(item => {
      if (!item.haulingJobId || item.haulingJobId === item.sourceJobId) return;
      const jobCard = document.querySelector(`#fv-ticket-status-job-list [data-fv-status-job][data-fv-ticket-job-id="${CSS.escape(item.haulingJobId)}"]`);
      if (!jobCard) return;
      const target = item.allocationType === 'spot'
        ? jobCard.querySelector(`[data-fv-spot-job-id="${CSS.escape(item.haulingJobId)}"]`)
        : jobCard.querySelector(`[data-fv-fill-job-id="${CSS.escape(item.haulingJobId)}"]`);
      if (!target) return;
      target.insertAdjacentHTML('beforeend',partialTile({
        ticket,
        sourceJobId:item.sourceJobId,
        currentJobId:item.haulingJobId,
        bushels:item.bushels,
        type:item.allocationType,
        origin:'moved'
      }));
    });
  }

  async function decorate(forceLoad=false) {
    const root = document.getElementById('fv-ticket-status-job-list');
    if (!root || root.hidden || decorating) return;
    decorating = true;
    try {
      installStyle();
      await load(forceLoad);
      clearInjected();

      root.querySelectorAll('[data-fv-status-job][data-fv-ticket-job-id]').forEach(jobCard => {
        const sourceJobId = clean(jobCard.dataset.fvTicketJobId);
        jobCard.querySelectorAll('[data-fv-status-ticket][data-ticket-id]').forEach(card => {
          const badge = card.querySelector('.fv-seq-badge.split');
          if (!badge) return;
          const ticket = tickets.get(clean(card.dataset.ticketId));
          if (!ticket) return;
          adjustSourceSplitCard(card,ticket,sourceJobId);
        });
      });

      tickets.forEach(ticket => injectMovedPortions(ticket));
      bindPartialCards();
    } finally {
      decorating = false;
    }
  }

  function payloadFromCard(card) {
    return {
      ticketId:clean(card.dataset.ticketId),
      sourceJobId:clean(card.dataset.sourceJobId),
      currentJobId:clean(card.dataset.currentJobId),
      bushels:round2(card.dataset.portionBushels),
      portionType:clean(card.dataset.portionType || 'spot'),
      origin:clean(card.dataset.portionOrigin || 'automatic')
    };
  }

  function bindPartialCards() {
    document.querySelectorAll('.fv-split-portion-card[data-fv-split-portion="1"]').forEach(card => {
      if (card.dataset.fvSplitBound === '1') return;
      card.dataset.fvSplitBound = '1';
      card.addEventListener('dragstart',event => {
        const payload = payloadFromCard(card);
        card.classList.add('dragging');
        try {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('application/x-fv-hauling-portion',JSON.stringify(payload));
          event.dataTransfer.setData('text/plain',`FVPORTION:${JSON.stringify(payload)}`);
        } catch(_) {}
      });
      card.addEventListener('dragend',() => card.classList.remove('dragging'));
    });
  }

  function dropPayload(event) {
    let raw = '';
    try { raw = event.dataTransfer?.getData('application/x-fv-hauling-portion') || ''; } catch(_) {}
    if (!raw) {
      try {
        const plain = event.dataTransfer?.getData('text/plain') || '';
        if (plain.startsWith('FVPORTION:')) raw = plain.slice('FVPORTION:'.length);
      } catch(_) {}
    }
    if (!raw) return null;
    try { return JSON.parse(raw); } catch(_) { return null; }
  }

  async function movePortion(payload,destinationJobId,{spot=false}={}) {
    await load(true);
    const ticket = tickets.get(clean(payload?.ticketId));
    const destination = jobs.get(clean(destinationJobId));
    if (!ticket || !destination) return;

    const amount = round2(payload?.bushels);
    if (!(amount > .005)) return;

    const sourceJobId = clean(payload?.sourceJobId || ticket?.haulingJobId);
    const currentJobId = clean(payload?.currentJobId || sourceJobId);

    const existing = splitAllocations(ticket);
    let next = existing.filter(item => !(
      item.sourceJobId === sourceJobId &&
      item.haulingJobId === currentJobId &&
      Math.abs(item.bushels - amount) < .01
    ));

    if (clean(destinationJobId) !== sourceJobId) {
      next.push({
        id:`${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
        sourceJobId,
        haulingJobId:clean(destinationJobId),
        bushels:amount,
        allocationType:spot ? 'spot' : 'job',
        source:'manual_split_dnd',
        createdAt:new Date().toISOString()
      });
    }

    const merged = new Map();
    next.forEach(item => {
      const key = `${item.sourceJobId}|${item.haulingJobId}|${item.allocationType}`;
      const prior = merged.get(key);
      if (prior) prior.bushels = round2(prior.bushels + item.bushels);
      else merged.set(key,{...item,bushels:round2(item.bushels)});
    });
    next = [...merged.values()].filter(item => item.bushels > .005);

    try {
      await firebase.updateDoc(firebase.doc(db,'grain_tickets',ticket.id),{
        haulingJobSplitAllocations:next,
        haulingJobSplitUpdatedAt:firebase.serverTimestamp(),
        updatedAt:firebase.serverTimestamp()
      });
      await load(true);
      await decorate(false);
      document.getElementById('fv-refresh-ticket-hauling')?.click();
    } catch(error) {
      console.error('[FarmVista] Could not move hauling split portion:',error);
      alert(error?.message || 'FarmVista could not move that split-load portion.');
    }
  }

  document.addEventListener('dragover',event => {
    const hasPartial = [...document.querySelectorAll('.fv-split-portion-card.dragging')].length > 0;
    if (!hasPartial) return;
    const target = event.target.closest?.('[data-fv-spot-job-id],[data-fv-status-job][data-fv-ticket-job-id]');
    if (!target) return;
    event.preventDefault();
    target.classList.add(target.hasAttribute('data-fv-spot-job-id') ? 'drag-over' : 'fv-split-portion-drop-target');
  },true);

  document.addEventListener('dragleave',event => {
    const target = event.target.closest?.('[data-fv-spot-job-id],[data-fv-status-job][data-fv-ticket-job-id]');
    if (!target) return;
    target.classList.remove('drag-over','fv-split-portion-drop-target');
  },true);

  document.addEventListener('drop',event => {
    const payload = dropPayload(event);
    if (!payload) return;
    const spotZone = event.target.closest?.('[data-fv-spot-job-id]');
    const jobCard = event.target.closest?.('[data-fv-status-job][data-fv-ticket-job-id]');
    const destinationJobId = clean(spotZone?.dataset?.fvSpotJobId || jobCard?.dataset?.fvTicketJobId);
    if (!destinationJobId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    spotZone?.classList.remove('drag-over');
    jobCard?.classList.remove('fv-split-portion-drop-target');
    movePortion(payload,destinationJobId,{spot:!!spotZone});
  },true);

  function queue(force=false,delay=80) {
    if (queued) return;
    queued = true;
    setTimeout(() => requestAnimationFrame(async() => {
      queued = false;
      ensureRootObserver();
      await decorate(force);
    }),delay);
  }

  function ensureRootObserver() {
    const root = document.getElementById('fv-ticket-status-job-list');
    if (!root || root === observedRoot) return;

    rootObserver?.disconnect();
    observedRoot = root;
    rootObserver = new MutationObserver(() => {
      if (!decorating) queue(false,80);
    });
    rootObserver.observe(root,{childList:true});
  }

  document.addEventListener('change',event => {
    if (event.target?.id === 'fv-ticket-job-status-filter') queue(true,180);
  },true);
  document.addEventListener('click',event => {
    if (event.target.closest?.('[data-fv-job-toggle],#fv-refresh-ticket-hauling')) queue(true,180);
  },true);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',() => queue(true,120),{once:true});
  else queue(true,120);
})();
