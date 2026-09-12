/* FarmVista — dynamic hauling-job split portions — Sept. 12, 2026
   Makes hauling-job partials behave like contract split loads.
   - Any split JOB FILL or SPOT PORTION is independently draggable.
   - Dropping a partial left creates a partial Unassigned tile.
   - If all portions of one elevator ticket become Unassigned, they merge back
     into the original whole ticket automatically.
   - Hauling-job fill/spot is recalculated from elevator ticket-number order
     after every partial move, so the ticket that fills the job can change.
   - The main hauling-job Ticketed/Remaining figures are corrected from the
     effective partial allocation totals, without changing dropdown code.
*/
(() => {
  'use strict';

  if (window.__FV_HAULING_SPLIT_DYNAMIC_20260912_V6) return;
  window.__FV_HAULING_SPLIT_DYNAMIC_20260912_V6 = true;
  if (!String(location.pathname || '').toLowerCase().endsWith('/pages/grain/grain-contracts.html')) return;

  const RIGHT_ID = 'fv-ticket-status-job-list';
  const LEFT_ID = 'fv-unassigned-ticket-list';
  const EPS = .005;
  const clean = v => String(v ?? '').trim();
  const num = v => {
    const n = Number(String(v ?? '').replace(/,/g,'').replace(/[^0-9.-]/g,''));
    return Number.isFinite(n) ? n : 0;
  };
  const round2 = v => Number(num(v).toFixed(2));
  const fmt = v => num(v).toLocaleString('en-US',{maximumFractionDigits:2});
  const esc = v => clean(v)
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const norm = v => clean(v).toLowerCase().replace(/[^a-z0-9]/g,'');
  const collator = new Intl.Collator(undefined,{numeric:true,sensitivity:'base'});

  let firebase = null;
  let db = null;
  let tickets = new Map();
  let jobs = new Map();
  let dataReady = false;
  let loading = null;
  let moving = false;
  let hookedRight = null;
  let hookedLeft = null;
  let nativeInnerHTML = null;

  function installStyle(){
    if (document.getElementById('fv-hauling-split-dynamic-style-v6')) return;
    const style = document.createElement('style');
    style.id = 'fv-hauling-split-dynamic-style-v6';
    style.textContent = `
      #${RIGHT_ID} .fv-hauling-ticket-card[data-fv-dynamic-hidden="1"]{display:none!important}
      .fv-hauling-partial-tile{
        margin-top:8px;padding:10px 11px;border:1px solid var(--border,#d8d8d8);
        border-radius:9px;background:var(--surface,#fff);cursor:grab
      }
      .fv-hauling-partial-tile.dragging{opacity:.48}
      .fv-hauling-partial-title{display:flex;align-items:center;justify-content:space-between;gap:10px;font-weight:900}
      .fv-hauling-partial-badge{display:inline-flex;margin-left:7px;padding:2px 7px;border-radius:999px;font-size:.67rem;font-weight:900;vertical-align:middle}
      .fv-hauling-partial-badge.job{background:rgba(59,126,70,.12);color:#2d6937}
      .fv-hauling-partial-badge.spot{background:rgba(179,38,30,.11);color:#9d241e}
      .fv-hauling-partial-badge.unassigned{background:rgba(59,130,246,.11);color:#245aa8}
      .fv-hauling-partial-meta{margin-top:5px;font-size:.72rem;line-height:1.4;opacity:.72}
      .fv-hauling-partial-sold{margin-top:5px;font-size:.72rem;font-weight:800}
      .fv-hauling-partial-detail{margin-top:5px;font-size:.72rem;font-weight:900}
      .fv-hauling-partial-tile.job .fv-hauling-partial-detail{color:#2d6937}
      .fv-hauling-partial-tile.spot .fv-hauling-partial-detail{color:#9d241e}
      .fv-hauling-partial-tile.unassigned .fv-hauling-partial-detail{color:#245aa8}
      .fv-hauling-partial-note{margin-top:5px;font-size:.7rem;font-weight:750;opacity:.64}
      .fv-hauling-partial-drop{outline:2px solid #4f718f!important;outline-offset:1px;background:rgba(79,113,143,.08)!important}
      .fv-hauling-partial-left-over{outline:2px solid #4f8f59!important;outline-offset:-2px;background:rgba(79,143,89,.06)!important}
      [data-theme="dark"] .fv-hauling-partial-badge.job{color:#b9e4bf}
      [data-theme="dark"] .fv-hauling-partial-badge.spot{color:#ffaaa4}
      [data-theme="dark"] .fv-hauling-partial-badge.unassigned{color:#9cc5ff}
    `;
    document.head.appendChild(style);
  }

  async function ensureFirebase(){
    if (firebase && db) return;
    firebase = await import('/js/firebase-init.js');
    await firebase.ready;
    db = firebase.getFirestore();
  }

  async function loadData(force=false){
    if (loading && !force) return loading;
    loading = (async() => {
      await ensureFirebase();
      const [ticketSnap,jobSnap] = await Promise.all([
        firebase.getDocs(firebase.collection(db,'grain_tickets')),
        firebase.getDocs(firebase.collection(db,'grain_hauling_jobs'))
      ]);
      tickets = new Map(ticketSnap.docs.map(s => [s.id,{id:s.id,...s.data()}]));
      jobs = new Map(jobSnap.docs.map(s => [s.id,{id:s.id,...s.data()}]));
      dataReady = true;
    })().catch(error => console.warn('[FarmVista] dynamic hauling split load failed:',error))
      .finally(() => { loading = null; });
    return loading;
  }

  function ticketBushels(ticket){
    return Math.max(0,round2(ticket?.netBushels ?? ticket?.netBu ?? ticket?.bushels));
  }
  function ticketNo(ticket){
    return clean(ticket?.ticketNumber || ticket?.ticketNo || ticket?.ticket || ticket?.number || ticket?.scaleTicketNumber || ticket?.id) || 'Ticket';
  }
  function ticketDate(ticket){
    return clean(ticket?.ticketDate || ticket?.date || ticket?.deliveryDate);
  }
  function ticketCrop(ticket){
    return clean(ticket?.crop || ticket?.commodity || ticket?.grain || ticket?.cropName) || 'Unknown crop';
  }
  function ticketDestination(ticket){
    const buyer = clean(ticket?.buyerName || ticket?.destinationBuyerName || ticket?.elevatorName);
    const loc = clean(ticket?.deliveryLocationName || ticket?.locationName || ticket?.destinationName || ticket?.destination || ticket?.elevator);
    return buyer && loc && norm(buyer)!==norm(loc) ? `${buyer} • ${loc}` : (buyer || loc || 'Unknown destination');
  }
  function soldUnder(ticket){
    return clean(ticket?.customerName || ticket?.soldUnderName || ticket?.soldUnder || ticket?.customer) || '—';
  }
  function sourceJobId(ticket){
    return clean(ticket?.haulingJobId);
  }
  function jobTarget(job){
    return Math.max(0,round2(job?.startingBushels ?? job?.jobBushels ?? job?.bushels));
  }
  function jobBuyerId(job){ return clean(job?.buyerId || job?.grainBuyerId); }
  function jobBuyer(job){ return clean(job?.buyerName || job?.buyer || job?.grainBuyerName); }
  function jobLocationId(job){ return clean(job?.deliveryLocationId || job?.locationId || job?.destinationId); }
  function jobLocation(job){ return clean(job?.deliveryLocationName || job?.locationName || job?.destinationName || job?.destination); }
  function jobCrop(job){ return clean(job?.crop || job?.commodity || job?.cropName || job?.cropType); }
  function ticketBuyerId(ticket){ return clean(ticket?.buyerId || ticket?.grainBuyerId || ticket?.destinationBuyerId); }
  function ticketBuyer(ticket){ return clean(ticket?.buyerName || ticket?.destinationBuyerName || ticket?.elevatorName); }
  function ticketLocationId(ticket){ return clean(ticket?.deliveryLocationId || ticket?.locationId || ticket?.destinationId); }
  function ticketLocation(ticket){ return clean(ticket?.deliveryLocationName || ticket?.locationName || ticket?.destinationName || ticket?.destination || ticket?.elevator); }
  function cropKey(value){
    const key=norm(value);
    if (key==='corn'||key==='yellowcorn') return 'corn';
    if (['soy','soybean','soybeans','beans','yellowsoybeans'].includes(key)) return 'soybeans';
    return key;
  }
  function idsOrNamesMatch(aId,aName,bId,bName){
    if (aId && bId) return clean(aId)===clean(bId);
    if (aName && bName) return norm(aName)===norm(bName);
    return true;
  }
  function ticketMatchesJob(ticket,job){
    if (!idsOrNamesMatch(ticketBuyerId(ticket),ticketBuyer(ticket),jobBuyerId(job),jobBuyer(job))) return false;
    if (!idsOrNamesMatch(ticketLocationId(ticket),ticketLocation(ticket),jobLocationId(job),jobLocation(job))) return false;
    const tc=cropKey(ticketCrop(ticket));
    const jc=cropKey(jobCrop(job));
    return !(tc && jc && tc!==jc);
  }

  function normalizeAllocations(ticket){
    const source = sourceJobId(ticket);
    const raw = Array.isArray(ticket?.haulingJobSplitAllocations) ? ticket.haulingJobSplitAllocations : [];
    return raw.map((item,index) => {
      const type = clean(item?.allocationType || item?.type || 'job').toLowerCase();
      return {
        id: clean(item?.id) || `legacy-${index}`,
        sourceJobId: clean(item?.sourceJobId || source),
        haulingJobId: clean(item?.haulingJobId || item?.jobId),
        bushels: round2(item?.bushels),
        allocationType: type==='unassigned' ? 'unassigned' : (type==='spot' ? 'spot' : 'job'),
        source: clean(item?.source),
        createdAt: clean(item?.createdAt)
      };
    }).filter(item => item.bushels>EPS && item.sourceJobId);
  }

  function carvedFromSource(ticket){
    const source=sourceJobId(ticket);
    return normalizeAllocations(ticket)
      .filter(a => a.sourceJobId===source && (
        a.allocationType==='unassigned' ||
        a.allocationType==='spot' ||
        (a.haulingJobId && a.haulingJobId!==source)
      ))
      .reduce((sum,a)=>sum+a.bushels,0);
  }

  function piecesForJob(jobId){
    const pieces=[];
    tickets.forEach(ticket => {
      if (ticket?.voided===true || clean(ticket?.status).toLowerCase().includes('void')) return;
      const source=sourceJobId(ticket);
      const total=ticketBushels(ticket);
      const allocations=normalizeAllocations(ticket);

      if (source===jobId) {
        const residual=Math.max(0,round2(total-carvedFromSource(ticket)));
        if (residual>EPS) {
          const forceSpot=clean(ticket?.haulingJobAllocationType || ticket?.haulingAllocationType).toLowerCase()==='spot';
          pieces.push({
            ticket, sourceJobId:source, currentJobId:source, allocationId:'',
            amount:residual, forceSpot, origin:'source', full:Math.abs(residual-total)<.01
          });
        }
      }

      allocations.forEach(a => {
        if (a.allocationType==='unassigned') return;
        if (a.haulingJobId!==jobId) return;
        if (a.haulingJobId===source && a.allocationType!=='spot') return;
        pieces.push({
          ticket, sourceJobId:a.sourceJobId || source, currentJobId:jobId, allocationId:a.id,
          amount:a.bushels, forceSpot:a.allocationType==='spot', origin:'allocation', full:false
        });
      });
    });

    pieces.sort((a,b) =>
      collator.compare(ticketNo(a.ticket),ticketNo(b.ticket)) ||
      ticketDate(a.ticket).localeCompare(ticketDate(b.ticket)) ||
      clean(a.allocationId).localeCompare(clean(b.allocationId))
    );
    return pieces;
  }

  function classifyJob(jobId){
    const job=jobs.get(jobId);
    const target=jobTarget(job);
    let used=0;
    const classified=piecesForJob(jobId).map(piece => {
      if (piece.forceSpot) return {...piece,fill:0,spot:piece.amount,type:'spot'};
      const fill=Math.min(piece.amount,Math.max(0,target-used));
      const spot=Math.max(0,round2(piece.amount-fill));
      used=round2(used+fill);
      return {...piece,fill:round2(fill),spot,type:spot>EPS ? (fill>EPS?'split':'spot') : 'job'};
    });
    const fill=round2(classified.reduce((s,p)=>s+p.fill,0));
    const spot=round2(classified.reduce((s,p)=>s+p.spot,0));
    return {job,target,fill,spot,remaining:Math.max(0,round2(target-fill)),pieces:classified};
  }

  function metaHtml(ticket){
    return `${esc(ticketDate(ticket) || 'No date')} • ${esc(ticketCrop(ticket))}<br>${esc(ticketDestination(ticket))}`;
  }

  function partialTile(piece,amount,type){
    const unassigned=type==='unassigned';
    const spot=type==='spot';
    const badge=unassigned?'UNASSIGNED PORTION':(spot?'SPOT PORTION':'JOB FILL');
    const label=unassigned?'Unassigned':(spot?'Spot':'Job');
    return `
      <div class="fv-hauling-partial-tile ${type}" draggable="true"
           data-fv-hauling-partial="1"
           data-ticket-id="${esc(piece.ticket.id)}"
           data-source-job-id="${esc(piece.sourceJobId)}"
           data-current-job-id="${esc(piece.currentJobId)}"
           data-allocation-id="${esc(piece.allocationId || '')}"
           data-portion-bushels="${esc(round2(amount))}"
           data-portion-type="${esc(type)}">
        <div class="fv-hauling-partial-title">
          <span>Ticket ${esc(ticketNo(piece.ticket))}<span class="fv-hauling-partial-badge ${type}">${badge}</span></span>
          <span>${fmt(amount)} bu</span>
        </div>
        <div class="fv-hauling-partial-meta">${metaHtml(piece.ticket)}</div>
        <div class="fv-hauling-partial-sold"><strong>Sold Under:</strong> ${esc(soldUnder(piece.ticket))}</div>
        <div class="fv-hauling-partial-detail">${label}: ${fmt(amount)} bu</div>
        <div class="fv-hauling-partial-note">${unassigned
          ? 'Drag this portion onto a compatible hauling job. If every portion of this ticket is unassigned, FarmVista puts the original ticket back together.'
          : 'Drag this portion to another hauling job or anywhere in the Unassigned column.'}</div>
      </div>`;
  }

  function setOriginalCard(card,piece,zone,type){
    if (!card || !zone) return;
    card.removeAttribute('data-fv-dynamic-hidden');
    zone.appendChild(card);
    const badge=card.querySelector('.fv-seq-badge');
    if (badge) {
      badge.classList.remove('job','spot','split');
      badge.classList.add(type);
      badge.textContent=type==='spot'?'SPOT':'JOB';
    }
    const detail=card.querySelector('.fv-seq-detail');
    if (detail) {
      detail.classList.remove('job','spot','split');
      detail.classList.add(type);
      detail.textContent=`${type==='spot'?'Spot':'Job'}: ${fmt(piece.amount)} bu`;
    }
  }

  function ensureSpotZone(jobCard,jobId){
    let zone=jobCard.querySelector(`[data-fv-spot-job-id="${CSS.escape(jobId)}"]`);
    if (zone) return zone;
    const body=jobCard.querySelector(`[data-fv-job-body="${CSS.escape(jobId)}"]`);
    if (!body) return null;
    zone=document.createElement('div');
    zone.className='fv-job-spot-zone';
    zone.dataset.fvSpotJobId=jobId;
    zone.innerHTML='<div class="fv-job-allocation-head"><span>Spot Loads</span><span class="fv-job-spot-total">0 bu</span></div>';
    body.appendChild(zone);
    return zone;
  }

  function decorateRight(){
    const root=document.getElementById(RIGHT_ID);
    if (!root || root.hidden || !dataReady) return;
    installStyle();

    root.querySelectorAll('.fv-hauling-partial-tile').forEach(n=>n.remove());
    root.querySelectorAll('.fv-hauling-ticket-card[data-fv-dynamic-hidden="1"]').forEach(n=>n.removeAttribute('data-fv-dynamic-hidden'));

    root.querySelectorAll('[data-fv-status-job][data-fv-ticket-job-id]').forEach(jobCard => {
      const jobId=clean(jobCard.dataset.fvTicketJobId);
      if (!jobId || !jobs.has(jobId)) return;
      const result=classifyJob(jobId);
      const fillZone=jobCard.querySelector(`[data-fv-fill-job-id="${CSS.escape(jobId)}"]`);
      const spotZone=ensureSpotZone(jobCard,jobId);
      if (!fillZone || !spotZone) return;

      fillZone.querySelectorAll('.fv-job-spot-empty').forEach(n=>n.remove());
      spotZone.querySelectorAll('.fv-job-spot-empty').forEach(n=>n.remove());

      const originals=new Map();
      jobCard.querySelectorAll('.fv-hauling-ticket-card[data-fv-status-ticket][data-ticket-id]').forEach(card => {
        originals.set(clean(card.dataset.ticketId),card);
        card.dataset.fvDynamicHidden='1';
      });

      result.pieces.forEach(piece => {
        const original=piece.origin==='source' ? originals.get(piece.ticket.id) : null;
        const needsPartial=!piece.full || piece.type==='split' || piece.origin!=='source';

        if (!needsPartial && original) {
          setOriginalCard(original,piece,piece.type==='spot'?spotZone:fillZone,piece.type);
          return;
        }

        if (piece.fill>EPS) fillZone.insertAdjacentHTML('beforeend',partialTile(piece,piece.fill,'job'));
        if (piece.spot>EPS) spotZone.insertAdjacentHTML('beforeend',partialTile(piece,piece.spot,'spot'));
      });

      const fillHead=fillZone.querySelector('.fv-job-allocation-head span:last-child');
      if (fillHead) fillHead.textContent=`${fmt(result.fill)} / ${fmt(result.target)} bu`;
      const spotTotal=spotZone.querySelector('.fv-job-spot-total');
      if (spotTotal) spotTotal.textContent=`${fmt(result.spot)} bu`;
      if (result.spot<=EPS) spotZone.insertAdjacentHTML('beforeend','<div class="fv-job-spot-empty">0 bu Spot. Drop a ticket here if needed.</div>');

      const meta=jobCard.querySelector('.fv-ticket-job-meta');
      if (meta) {
        const first=(meta.innerHTML.split(/<br\s*\/?>/i)[0] || '').trim();
        meta.innerHTML=`${first}<br>${fmt(result.fill)} bu job fill • ${fmt(result.remaining)} bu remaining${result.spot>EPS?` • <span class="fv-status-over">${fmt(result.spot)} bu spot</span>`:''} • ${result.pieces.length} ticket portion${result.pieces.length===1?'':'s'}`;
      }
    });

    bindPartialTiles(document.getElementById(RIGHT_ID));
    patchHaulingTable();
  }

  function unassignedPieces(){
    const out=[];
    tickets.forEach(ticket => {
      normalizeAllocations(ticket).forEach(a => {
        if (a.allocationType!=='unassigned') return;
        out.push({ticket,sourceJobId:a.sourceJobId,currentJobId:'',allocationId:a.id,amount:a.bushels,origin:'allocation'});
      });
    });
    return out.sort((a,b)=>collator.compare(ticketNo(a.ticket),ticketNo(b.ticket)));
  }

  function decorateLeft(){
    const list=document.getElementById(LEFT_ID);
    if (!list || !dataReady) return;
    list.querySelectorAll('.fv-hauling-partial-tile.unassigned').forEach(n=>n.remove());
    const pieces=unassignedPieces();
    if (!pieces.length) return;
    const frag=document.createDocumentFragment();
    pieces.forEach(piece => {
      const wrap=document.createElement('div');
      wrap.innerHTML=partialTile(piece,piece.amount,'unassigned').trim();
      frag.appendChild(wrap.firstElementChild);
    });
    list.prepend(frag);
    bindPartialTiles(list);
  }

  function bindPartialTiles(root){
    if (!root) return;
    root.querySelectorAll('.fv-hauling-partial-tile[draggable="true"]').forEach(card => {
      if (card.dataset.fvPartialBound==='1') return;
      card.dataset.fvPartialBound='1';
      card.addEventListener('dragstart',event => {
        card.classList.add('dragging');
        const payload={
          ticketId:clean(card.dataset.ticketId),
          sourceJobId:clean(card.dataset.sourceJobId),
          currentJobId:clean(card.dataset.currentJobId),
          allocationId:clean(card.dataset.allocationId),
          bushels:round2(card.dataset.portionBushels),
          portionType:clean(card.dataset.portionType)
        };
        event.dataTransfer.effectAllowed='move';
        try {
          event.dataTransfer.setData('application/x-fv-hauling-portion',JSON.stringify(payload));
          event.dataTransfer.setData('text/plain',`FVPORTION:${JSON.stringify(payload)}`);
        } catch(_) {}
      });
      card.addEventListener('dragend',()=>card.classList.remove('dragging'));
    });
  }

  function readPayload(event){
    let raw='';
    try { raw=event.dataTransfer?.getData('application/x-fv-hauling-portion') || ''; } catch(_) {}
    if (!raw) {
      try {
        const plain=event.dataTransfer?.getData('text/plain') || '';
        if (plain.startsWith('FVPORTION:')) raw=plain.slice('FVPORTION:'.length);
      } catch(_) {}
    }
    if (!raw) return null;
    try { return JSON.parse(raw); } catch(_) { return null; }
  }

  function mergeAllocations(items){
    const map=new Map();
    items.filter(a=>a.bushels>EPS).forEach(a => {
      const key=`${a.sourceJobId}|${a.haulingJobId}|${a.allocationType}`;
      const existing=map.get(key);
      if (existing) existing.bushels=round2(existing.bushels+a.bushels);
      else map.set(key,{...a,bushels:round2(a.bushels)});
    });
    return [...map.values()];
  }

  function removeFromCurrentAllocation(allocations,payload,amount){
    if (!payload.allocationId) return allocations;
    const next=[];
    let remaining=amount;
    allocations.forEach(a => {
      if (a.id!==payload.allocationId || remaining<=EPS) { next.push(a); return; }
      const take=Math.min(a.bushels,remaining);
      const left=round2(a.bushels-take);
      remaining=round2(remaining-take);
      if (left>EPS) next.push({...a,bushels:left});
    });
    return next;
  }

  async function movePortion(payload,destinationJobId,{spot=false,unassigned=false}={}){
    if (moving) return;
    moving=true;
    try {
      await ensureFirebase();
      const ticket=tickets.get(clean(payload.ticketId));
      if (!ticket) return;
      const amount=round2(payload.bushels);
      const source=clean(payload.sourceJobId || sourceJobId(ticket));
      const destination=clean(destinationJobId);
      if (!source || !(amount>EPS)) return;

      if (destination) {
        const job=jobs.get(destination);
        if (!job || !ticketMatchesJob(ticket,job)) {
          alert('That ticket portion does not match this hauling job\'s destination or crop.');
          return;
        }
      }

      let allocations=normalizeAllocations(ticket);
      allocations=removeFromCurrentAllocation(allocations,payload,amount);

      const returningToSource=!unassigned && destination===source && !spot;
      if (!returningToSource) {
        allocations.push({
          id:`${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
          sourceJobId:source,
          haulingJobId:unassigned?'':destination,
          bushels:amount,
          allocationType:unassigned?'unassigned':(spot?'spot':'job'),
          source:'manual_split_dnd',
          createdAt:new Date().toISOString()
        });
      }
      allocations=mergeAllocations(allocations);

      const total=ticketBushels(ticket);
      const unassignedTotal=round2(allocations.filter(a=>a.allocationType==='unassigned').reduce((s,a)=>s+a.bushels,0));
      const assignedAllocations=allocations.filter(a=>a.allocationType!=='unassigned');
      const mergeWhole=unassignedTotal>=total-.01 && !assignedAllocations.length;

      const ref=firebase.doc(db,'grain_tickets',ticket.id);
      const patch=mergeWhole ? {
        haulingJobId:null,
        haulingJobName:null,
        haulingJobSplitAllocations:[],
        haulingJobAssignmentSource:'manual_unassigned',
        haulingJobAllocationType:null,
        haulingJobAllocationSource:null,
        haulingJobManualUnassignedFromJobId:source,
        haulingJobManualUnassignedAt:firebase.serverTimestamp(),
        haulingJobSplitUpdatedAt:firebase.serverTimestamp(),
        updatedAt:firebase.serverTimestamp()
      } : {
        haulingJobSplitAllocations:allocations,
        haulingJobSplitUpdatedAt:firebase.serverTimestamp(),
        updatedAt:firebase.serverTimestamp()
      };

      await firebase.updateDoc(ref,patch);
      await loadData(true);
      document.getElementById('fv-refresh-ticket-hauling')?.click();
      document.getElementById('refresh-hauling-link-btn')?.click();
      setTimeout(() => { decorateRight(); decorateLeft(); patchHaulingTable(); },120);
    } catch(error) {
      console.error('[FarmVista] Could not move hauling-job partial:',error);
      alert(error?.message || 'FarmVista could not move that hauling-job ticket portion.');
    } finally { moving=false; }
  }

  function draggingPartial(){
    return document.querySelector('.fv-hauling-partial-tile.dragging');
  }
  function leftColumn(){
    return document.getElementById(LEFT_ID)?.closest?.('.fv-ticket-hauling-column') || null;
  }

  document.addEventListener('dragover',event => {
    if (!draggingPartial()) return;
    const spotZone=event.target.closest?.('[data-fv-spot-job-id]');
    const jobCard=event.target.closest?.('[data-fv-status-job][data-fv-ticket-job-id]');
    const left=leftColumn();
    if (spotZone || jobCard) {
      event.preventDefault();
      (spotZone || jobCard).classList.add('fv-hauling-partial-drop');
      return;
    }
    if (left && left.contains(event.target)) {
      event.preventDefault();
      left.classList.add('fv-hauling-partial-left-over');
    }
  },true);

  document.addEventListener('dragleave',event => {
    event.target.closest?.('[data-fv-spot-job-id],[data-fv-status-job][data-fv-ticket-job-id]')?.classList.remove('fv-hauling-partial-drop');
    const left=leftColumn();
    if (left && (!event.relatedTarget || !left.contains(event.relatedTarget))) left.classList.remove('fv-hauling-partial-left-over');
  },true);

  document.addEventListener('drop',event => {
    const payload=readPayload(event);
    if (!payload) return;

    const left=leftColumn();
    if (left && left.contains(event.target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      left.classList.remove('fv-hauling-partial-left-over');
      movePortion(payload,'',{unassigned:true});
      return;
    }

    const spotZone=event.target.closest?.('[data-fv-spot-job-id]');
    const jobCard=event.target.closest?.('[data-fv-status-job][data-fv-ticket-job-id]');
    const destination=clean(spotZone?.dataset?.fvSpotJobId || jobCard?.dataset?.fvTicketJobId);
    if (!destination) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    (spotZone || jobCard)?.classList.remove('fv-hauling-partial-drop');
    movePortion(payload,destination,{spot:!!spotZone});
  },true);

  function patchHaulingTable(){
    if (!dataReady) return;
    let summaryFill=0;
    let summaryRemaining=0;
    document.querySelectorAll('#hauling-jobs-table-body tr[data-hauling-job-id]').forEach(row => {
      const id=clean(row.dataset.haulingJobId);
      if (!jobs.has(id)) return;
      const result=classifyJob(id);
      if (row.cells[7]) row.cells[7].textContent=fmt(result.fill);
      if (row.cells[8]) row.cells[8].textContent=fmt(result.remaining);
      summaryFill+=result.fill;
      summaryRemaining+=result.remaining;
    });
    const delivered=document.getElementById('hauling-summary-delivered');
    const remaining=document.getElementById('hauling-summary-remaining');
    if (delivered) delivered.textContent=fmt(round2(summaryFill));
    if (remaining) remaining.textContent=fmt(round2(summaryRemaining));
  }

  function hookInnerHTML(id,which){
    const el=document.getElementById(id);
    if (!el) return false;
    if ((which==='right' && hookedRight===el) || (which==='left' && hookedLeft===el)) return true;
    const descriptor=Object.getOwnPropertyDescriptor(Element.prototype,'innerHTML');
    if (!descriptor?.get || !descriptor?.set) return false;
    nativeInnerHTML=nativeInnerHTML || descriptor;
    Object.defineProperty(el,'innerHTML',{
      configurable:true,enumerable:false,
      get(){ return nativeInnerHTML.get.call(this); },
      set(value){
        nativeInnerHTML.set.call(this,value);
        if (which==='right') queueMicrotask(decorateRight);
        else queueMicrotask(decorateLeft);
      }
    });
    if (which==='right') hookedRight=el; else hookedLeft=el;
    return true;
  }

  function installHooks(){
    const r=hookInnerHTML(RIGHT_ID,'right');
    const l=hookInnerHTML(LEFT_ID,'left');
    return r&&l;
  }

  document.addEventListener('click',event => {
    if (event.target.closest?.('#fv-refresh-ticket-hauling,#refresh-hauling-link-btn')) {
      setTimeout(async()=>{ await loadData(true); decorateRight(); decorateLeft(); patchHaulingTable(); },180);
    }
  },true);

  document.addEventListener('change',event => {
    if (['fv-ticket-job-status-filter','fv-ticket-filter-buyer','fv-ticket-filter-sold-under','fv-ticket-filter-crop','hauling-status-filter','hauling-crop-filter','hauling-buyer-filter','hauling-customer-filter'].includes(event.target?.id)) {
      setTimeout(()=>{ decorateRight(); decorateLeft(); patchHaulingTable(); },80);
    }
  },true);

  installStyle();
  loadData().then(()=>{ decorateRight(); decorateLeft(); patchHaulingTable(); });

  const timer=setInterval(() => {
    if (installHooks()) clearInterval(timer);
  },100);
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',installHooks,{once:true});
  else installHooks();
})();