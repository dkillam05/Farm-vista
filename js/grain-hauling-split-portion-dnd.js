/* FarmVista — hauling-job split portion DND
   Sept. 12, 2026

   Stable split-load renderer for the hauling-job DND workspace.
   The physical ticket that crosses a hauling-job target is hidden and replaced
   with two derived tiles:
     • Job Fill portion inside Job Fill
     • Spot Portion inside Spot Loads

   Only the Spot Portion is independently draggable. Moving that portion stores
   haulingJobSplitAllocations on the physical grain ticket; the original ticket
   remains traceable by elevator ticket number.
*/
(() => {
  'use strict';

  if (window.__FV_HAULING_SPLIT_PORTION_DND_20260912_V3) return;
  window.__FV_HAULING_SPLIT_PORTION_DND_20260912_V3 = true;
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
  let queued = false;
  let rendering = false;

  function installStyle() {
    if (document.getElementById('fv-hauling-split-portion-style-v3')) return;
    const style = document.createElement('style');
    style.id = 'fv-hauling-split-portion-style-v3';
    style.textContent = `
      #fv-ticket-status-job-list [data-fv-split-source-hidden="1"]{display:none!important}
      .fv-split-derived-card{
        margin-top:8px;padding:10px 11px;border:1px solid var(--border,#d8d8d8);
        border-radius:9px;background:var(--surface,#fff)
      }
      .fv-split-derived-card.spot{cursor:grab}
      .fv-split-derived-card.spot.dragging{opacity:.48}
      .fv-split-derived-title{
        display:flex;align-items:center;justify-content:space-between;gap:10px;font-weight:900
      }
      .fv-split-derived-left{min-width:0}
      .fv-split-derived-badge{
        display:inline-flex;margin-left:7px;padding:2px 7px;border-radius:999px;
        font-size:.67rem;font-weight:900;vertical-align:middle
      }
      .fv-split-derived-badge.job{background:rgba(59,126,70,.12);color:#2d6937}
      .fv-split-derived-badge.spot{background:rgba(179,38,30,.11);color:#9d241e}
      .fv-split-derived-meta{margin-top:5px;font-size:.72rem;line-height:1.4;opacity:.72}
      .fv-split-derived-sold{margin-top:5px;font-size:.72rem;font-weight:800}
      .fv-split-derived-detail{margin-top:5px;font-size:.72rem;font-weight:900}
      .fv-split-derived-card.job .fv-split-derived-detail{color:#2d6937}
      .fv-split-derived-card.spot .fv-split-derived-detail{color:#9d241e}
      .fv-split-derived-note{margin-top:5px;font-size:.7rem;font-weight:750;opacity:.64}
      .fv-split-drop-target{outline:2px solid #4f718f!important;outline-offset:1px;background:rgba(79,113,143,.08)!important}
      [data-theme="dark"] .fv-split-derived-badge.job{color:#b9e4bf}
      [data-theme="dark"] .fv-split-derived-badge.spot{color:#ffaaa4}
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

  function ticketNo(ticket) {
    return clean(ticket?.ticketNumber || ticket?.ticketNo || ticket?.ticket || ticket?.number || ticket?.scaleTicketNumber || ticket?.id);
  }
  function ticketMeta(ticket) {
    const date = clean(ticket?.ticketDate || ticket?.date || ticket?.deliveryDate) || 'No date';
    const crop = clean(ticket?.crop || ticket?.commodity || ticket?.grain || ticket?.cropName) || 'Unknown crop';
    const destination = clean(ticket?.deliveryLocationName || ticket?.destinationName || ticket?.destination || ticket?.buyerName || ticket?.elevatorName) || 'Unknown destination';
    return `${esc(date)} • ${esc(crop)}<br>${esc(destination)}`;
  }
  function soldUnder(ticket) {
    return clean(ticket?.customerName || ticket?.soldUnderName || ticket?.soldUnder || ticket?.customer) || '—';
  }
  function parseSplit(card) {
    const detail = clean(card.querySelector('.fv-seq-detail.split')?.textContent);
    const jobMatch = detail.match(/Job:\s*([\d,.]+)\s*bu/i);
    const spotMatch = detail.match(/Spot:\s*([\d,.]+)\s*bu/i);
    return {
      fill:round2(jobMatch ? jobMatch[1] : 0),
      spot:round2(spotMatch ? spotMatch[1] : 0)
    };
  }

  function splitAllocations(ticket) {
    const raw = Array.isArray(ticket?.haulingJobSplitAllocations) ? ticket.haulingJobSplitAllocations : [];
    return raw.map((item,index) => ({
      id:clean(item?.id) || `split-${index}`,
      sourceJobId:clean(item?.sourceJobId || ticket?.haulingJobId),
      haulingJobId:clean(item?.haulingJobId || item?.jobId),
      bushels:round2(item?.bushels),
      allocationType:clean(item?.allocationType || item?.type || 'job').toLowerCase()==='spot' ? 'spot' : 'job'
    })).filter(item => item.haulingJobId && item.bushels>.005);
  }
  function movedFromSource(ticket,sourceJobId) {
    return splitAllocations(ticket)
      .filter(item => item.sourceJobId===sourceJobId && item.haulingJobId!==sourceJobId)
      .reduce((sum,item) => sum+item.bushels,0);
  }

  function derivedTile({ticket,sourceJobId,currentJobId,bushels,type,origin}) {
    const isSpot = type==='spot';
    return `
      <div class="fv-split-derived-card ${isSpot?'spot':'job'}"
           ${isSpot?'draggable="true"':''}
           data-fv-split-derived="1"
           data-ticket-id="${esc(ticket.id)}"
           data-source-job-id="${esc(sourceJobId)}"
           data-current-job-id="${esc(currentJobId)}"
           data-portion-bushels="${esc(round2(bushels))}"
           data-portion-type="${esc(type)}"
           data-portion-origin="${esc(origin)}">
        <div class="fv-split-derived-title">
          <span class="fv-split-derived-left">Ticket ${esc(ticketNo(ticket))}<span class="fv-split-derived-badge ${isSpot?'spot':'job'}">${isSpot?'SPOT PORTION':'JOB FILL'}</span></span>
          <span>${fmt(bushels)} bu</span>
        </div>
        <div class="fv-split-derived-meta">${ticketMeta(ticket)}</div>
        <div class="fv-split-derived-sold"><strong>Sold Under:</strong> ${esc(soldUnder(ticket))}</div>
        <div class="fv-split-derived-detail">${isSpot?'Spot':'Job'}: ${fmt(bushels)} bu</div>
        <div class="fv-split-derived-note">${isSpot
          ? 'Drag this Spot portion onto another hauling job to move only these bushels.'
          : 'This portion remains on the hauling job that the ticket filled.'}</div>
      </div>`;
  }

  function removeSummaryText(spotZone) {
    spotZone?.querySelectorAll('.fv-job-spot-empty').forEach(node => {
      if (/split-load\s+spot\s+portion/i.test(clean(node.textContent))) node.remove();
    });
  }

  function clearDerived(root) {
    root.querySelectorAll('.fv-split-derived-card').forEach(node => node.remove());
    root.querySelectorAll('[data-fv-split-source-hidden="1"]').forEach(node => {
      node.removeAttribute('data-fv-split-source-hidden');
    });
  }

  function injectMovedPortions(root,ticket) {
    splitAllocations(ticket).forEach(item => {
      if (!item.haulingJobId || item.haulingJobId===item.sourceJobId) return;
      const jobCard = root.querySelector(`[data-fv-status-job][data-fv-ticket-job-id="${CSS.escape(item.haulingJobId)}"]`);
      if (!jobCard) return;
      const target = item.allocationType==='spot'
        ? jobCard.querySelector(`[data-fv-spot-job-id="${CSS.escape(item.haulingJobId)}"]`)
        : jobCard.querySelector(`[data-fv-fill-job-id="${CSS.escape(item.haulingJobId)}"]`);
      if (!target) return;
      target.insertAdjacentHTML('beforeend',derivedTile({
        ticket,
        sourceJobId:item.sourceJobId,
        currentJobId:item.haulingJobId,
        bushels:item.bushels,
        type:item.allocationType,
        origin:'moved'
      }));
    });
  }

  async function render(forceLoad=false) {
    const root = document.getElementById('fv-ticket-status-job-list');
    if (!root || root.hidden || rendering) return;
    rendering = true;
    try {
      installStyle();
      await load(forceLoad);
      clearDerived(root);

      root.querySelectorAll('[data-fv-status-job][data-fv-ticket-job-id]').forEach(jobCard => {
        const sourceJobId = clean(jobCard.dataset.fvTicketJobId);
        const spotZone = jobCard.querySelector(`[data-fv-spot-job-id="${CSS.escape(sourceJobId)}"]`);
        removeSummaryText(spotZone);

        jobCard.querySelectorAll('[data-fv-status-ticket][data-ticket-id]').forEach(card => {
          if (!card.querySelector('.fv-seq-badge.split')) return;
          const ticket = tickets.get(clean(card.dataset.ticketId));
          if (!ticket) return;
          const parts = parseSplit(card);
          if (!(parts.fill>.005) || !(parts.spot>.005)) return;

          const moved = movedFromSource(ticket,sourceJobId);
          const remainingSpot = Math.max(0,round2(parts.spot-moved));
          card.dataset.fvSplitSourceHidden='1';

          const fillZone = jobCard.querySelector(`[data-fv-fill-job-id="${CSS.escape(sourceJobId)}"]`);
          if (fillZone) {
            fillZone.insertAdjacentHTML('beforeend',derivedTile({
              ticket,
              sourceJobId,
              currentJobId:sourceJobId,
              bushels:parts.fill,
              type:'job',
              origin:'automatic'
            }));
          }
          if (spotZone && remainingSpot>.005) {
            spotZone.insertAdjacentHTML('beforeend',derivedTile({
              ticket,
              sourceJobId,
              currentJobId:sourceJobId,
              bushels:remainingSpot,
              type:'spot',
              origin:'automatic'
            }));
          }
        });
      });

      tickets.forEach(ticket => injectMovedPortions(root,ticket));
      bindDerivedCards(root);
    } finally {
      rendering=false;
    }
  }

  function payload(card) {
    return {
      ticketId:clean(card.dataset.ticketId),
      sourceJobId:clean(card.dataset.sourceJobId),
      currentJobId:clean(card.dataset.currentJobId),
      bushels:round2(card.dataset.portionBushels),
      portionType:clean(card.dataset.portionType || 'spot')
    };
  }

  function bindDerivedCards(root) {
    root.querySelectorAll('.fv-split-derived-card.spot[draggable="true"]').forEach(card => {
      if (card.dataset.fvSplitBound==='1') return;
      card.dataset.fvSplitBound='1';
      card.addEventListener('dragstart',event => {
        const data=payload(card);
        card.classList.add('dragging');
        event.dataTransfer.effectAllowed='move';
        try {
          event.dataTransfer.setData('application/x-fv-hauling-portion',JSON.stringify(data));
          event.dataTransfer.setData('text/plain',`FVPORTION:${JSON.stringify(data)}`);
        } catch(_) {}
      });
      card.addEventListener('dragend',() => card.classList.remove('dragging'));
    });
  }

  function readPayload(event) {
    let raw='';
    try { raw=event.dataTransfer?.getData('application/x-fv-hauling-portion') || ''; } catch(_) {}
    if (!raw) {
      try {
        const text=event.dataTransfer?.getData('text/plain') || '';
        if (text.startsWith('FVPORTION:')) raw=text.slice('FVPORTION:'.length);
      } catch(_) {}
    }
    if (!raw) return null;
    try { return JSON.parse(raw); } catch(_) { return null; }
  }

  async function movePortion(data,destinationJobId,{spot=false}={}) {
    await load(true);
    const ticket=tickets.get(clean(data?.ticketId));
    if (!ticket || !jobs.has(clean(destinationJobId))) return;
    const amount=round2(data?.bushels);
    if (!(amount>.005)) return;

    const sourceJobId=clean(data?.sourceJobId || ticket?.haulingJobId);
    const currentJobId=clean(data?.currentJobId || sourceJobId);
    let next=splitAllocations(ticket).filter(item => !(
      item.sourceJobId===sourceJobId &&
      item.haulingJobId===currentJobId &&
      Math.abs(item.bushels-amount)<.01
    ));

    if (clean(destinationJobId)!==sourceJobId) {
      next.push({
        id:`${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
        sourceJobId,
        haulingJobId:clean(destinationJobId),
        bushels:amount,
        allocationType:spot?'spot':'job',
        source:'manual_split_dnd',
        createdAt:new Date().toISOString()
      });
    }

    try {
      await firebase.updateDoc(firebase.doc(db,'grain_tickets',ticket.id),{
        haulingJobSplitAllocations:next,
        haulingJobSplitUpdatedAt:firebase.serverTimestamp(),
        updatedAt:firebase.serverTimestamp()
      });
      await load(true);
      await render(false);
    } catch(error) {
      console.error('[FarmVista] Could not move hauling split portion:',error);
      alert(error?.message || 'FarmVista could not move that split-load portion.');
    }
  }

  document.addEventListener('dragover',event => {
    const dragging=document.querySelector('.fv-split-derived-card.spot.dragging');
    if (!dragging) return;
    const target=event.target.closest?.('[data-fv-spot-job-id],[data-fv-status-job][data-fv-ticket-job-id]');
    if (!target) return;
    event.preventDefault();
    target.classList.add('fv-split-drop-target');
  },true);

  document.addEventListener('dragleave',event => {
    const target=event.target.closest?.('[data-fv-spot-job-id],[data-fv-status-job][data-fv-ticket-job-id]');
    target?.classList.remove('fv-split-drop-target');
  },true);

  document.addEventListener('drop',event => {
    const data=readPayload(event);
    if (!data) return;
    const spotZone=event.target.closest?.('[data-fv-spot-job-id]');
    const jobCard=event.target.closest?.('[data-fv-status-job][data-fv-ticket-job-id]');
    const destinationJobId=clean(spotZone?.dataset?.fvSpotJobId || jobCard?.dataset?.fvTicketJobId);
    if (!destinationJobId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    spotZone?.classList.remove('fv-split-drop-target');
    jobCard?.classList.remove('fv-split-drop-target');
    movePortion(data,destinationJobId,{spot:!!spotZone});
  },true);

  function queue(force=false,delay=60) {
    if (queued) return;
    queued=true;
    setTimeout(() => requestAnimationFrame(async() => {
      queued=false;
      await render(force);
    }),delay);
  }

  // Only top-level list replacement is observed. Internal derived-tile changes
  // are ignored, so this renderer cannot trigger itself.
  const observer=new MutationObserver(records => {
    const root=document.getElementById('fv-ticket-status-job-list');
    if (!root || root.hidden || rendering) return;
    const relevant=records.some(record => record.target===root && record.type==='childList');
    if (relevant) queue(false,40);
  });

  function attachObserver() {
    const root=document.getElementById('fv-ticket-status-job-list');
    if (!root) return false;
    observer.disconnect();
    observer.observe(root,{childList:true});
    return true;
  }

  document.addEventListener('click',event => {
    if (event.target.closest?.('[data-fv-job-toggle],#fv-refresh-ticket-hauling')) queue(true,120);
  },true);
  document.addEventListener('change',event => {
    if (event.target?.id==='fv-ticket-job-status-filter') queue(true,160);
  },true);

  function start() {
    installStyle();
    const tryAttach=() => {
      if (attachObserver()) {
        queue(true,100);
        return;
      }
      setTimeout(tryAttach,100);
    };
    tryAttach();
  }

  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();