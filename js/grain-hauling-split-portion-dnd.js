/* FarmVista — stable hauling-job split portions — Sept. 12, 2026
   The hauling-job status renderer owns the job cards. This helper only turns
   a FILLS JOB + SPOT ticket into two contract-style visual portions:
     • JOB FILL in Job Fill
     • SPOT PORTION in Spot Loads

   Important: the status renderer replaces #fv-ticket-status-job-list.innerHTML.
   We hook that ONE element's innerHTML setter and decorate immediately after
   every replacement, before the browser paints. No MutationObserver, no page-
   wide timer, and nothing here touches FarmVista dropdowns.
*/
(() => {
  'use strict';

  if (window.__FV_HAULING_SPLIT_STABLE_V5) return;
  window.__FV_HAULING_SPLIT_STABLE_V5 = true;
  if (!String(location.pathname || '').toLowerCase().endsWith('/pages/grain/grain-contracts.html')) return;

  const ROOT_ID = 'fv-ticket-status-job-list';
  const clean = value => String(value ?? '').trim();
  const num = value => {
    const n = Number(String(value ?? '').replace(/,/g,'').replace(/[^0-9.-]/g,''));
    return Number.isFinite(n) ? n : 0;
  };
  const round2 = value => Number(num(value).toFixed(2));
  const fmt = value => num(value).toLocaleString('en-US',{maximumFractionDigits:2});
  const esc = value => clean(value)
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'",'&#039;');

  let hookedRoot = null;
  let nativeInnerHTML = null;
  let firebase = null;
  let db = null;
  let moving = false;

  function installStyle(){
    if (document.getElementById('fv-hauling-split-stable-style-v5')) return;
    const style = document.createElement('style');
    style.id = 'fv-hauling-split-stable-style-v5';
    style.textContent = `
      #${ROOT_ID} .fv-hauling-ticket-card[data-fv-split-source="1"]{display:none!important}
      .fv-hauling-split-tile{
        margin-top:8px;padding:10px 11px;border:1px solid var(--border,#d8d8d8);
        border-radius:9px;background:var(--surface,#fff)
      }
      .fv-hauling-split-tile.spot{cursor:grab}
      .fv-hauling-split-tile.spot.dragging{opacity:.48}
      .fv-hauling-split-title{display:flex;align-items:center;justify-content:space-between;gap:10px;font-weight:900}
      .fv-hauling-split-badge{display:inline-flex;margin-left:7px;padding:2px 7px;border-radius:999px;font-size:.67rem;font-weight:900;vertical-align:middle}
      .fv-hauling-split-badge.job{background:rgba(59,126,70,.12);color:#2d6937}
      .fv-hauling-split-badge.spot{background:rgba(179,38,30,.11);color:#9d241e}
      .fv-hauling-split-meta{margin-top:5px;font-size:.72rem;line-height:1.4;opacity:.72}
      .fv-hauling-split-sold{margin-top:5px;font-size:.72rem;font-weight:800}
      .fv-hauling-split-detail{margin-top:5px;font-size:.72rem;font-weight:900}
      .fv-hauling-split-tile.job .fv-hauling-split-detail{color:#2d6937}
      .fv-hauling-split-tile.spot .fv-hauling-split-detail{color:#9d241e}
      .fv-hauling-split-note{margin-top:5px;font-size:.7rem;font-weight:750;opacity:.64}
      .fv-hauling-split-drop{outline:2px solid #4f718f!important;outline-offset:1px;background:rgba(79,113,143,.08)!important}
      [data-theme="dark"] .fv-hauling-split-badge.job{color:#b9e4bf}
      [data-theme="dark"] .fv-hauling-split-badge.spot{color:#ffaaa4}
    `;
    document.head.appendChild(style);
  }

  function splitAmounts(card){
    const text = clean(card.querySelector('.fv-seq-detail.split')?.textContent);
    const j = text.match(/Job:\s*([\d,.]+)\s*bu/i);
    const s = text.match(/Spot:\s*([\d,.]+)\s*bu/i);
    return {job:round2(j?.[1] || 0),spot:round2(s?.[1] || 0)};
  }

  function ticketNumber(card){
    const text = clean(card.querySelector('.fv-hauling-ticket-title span:first-child')?.textContent);
    return text.match(/Ticket\s+([^\s]+)/i)?.[1] || clean(card.dataset.ticketId) || 'Ticket';
  }

  function tile(card,jobId,amount,type){
    const ticketId = clean(card.dataset.ticketId);
    const no = ticketNumber(card);
    const meta = card.querySelector('.fv-hauling-ticket-meta')?.innerHTML || '';
    const sold = card.querySelector('.fv-ticket-sold-under')?.innerHTML || '<strong>Sold Under:</strong> —';
    const spot = type === 'spot';
    const key = `${ticketId}|${jobId}|${type}`;
    return `
      <div class="fv-hauling-split-tile ${type}" ${spot?'draggable="true"':''}
           data-fv-hauling-split-key="${esc(key)}"
           data-ticket-id="${esc(ticketId)}"
           data-source-job-id="${esc(jobId)}"
           data-current-job-id="${esc(jobId)}"
           data-portion-bushels="${esc(amount)}"
           data-portion-type="${type}">
        <div class="fv-hauling-split-title">
          <span>Ticket ${esc(no)}<span class="fv-hauling-split-badge ${type}">${spot?'SPOT PORTION':'JOB FILL'}</span></span>
          <span>${fmt(amount)} bu</span>
        </div>
        <div class="fv-hauling-split-meta">${meta}</div>
        <div class="fv-hauling-split-sold">${sold}</div>
        <div class="fv-hauling-split-detail">${spot?'Spot':'Job'}: ${fmt(amount)} bu</div>
        <div class="fv-hauling-split-note">${spot
          ? 'Drag this Spot portion onto another hauling job to move only these bushels.'
          : 'This portion stays on the hauling job that this elevator ticket filled.'}</div>
      </div>`;
  }

  function decorate(root = document.getElementById(ROOT_ID)){
    if (!root || root.hidden) return;
    installStyle();

    root.querySelectorAll('[data-fv-status-job][data-fv-ticket-job-id]').forEach(jobCard => {
      const jobId = clean(jobCard.dataset.fvTicketJobId);
      if (!jobId) return;
      const fillZone = jobCard.querySelector(`[data-fv-fill-job-id="${CSS.escape(jobId)}"]`);
      const spotZone = jobCard.querySelector(`[data-fv-spot-job-id="${CSS.escape(jobId)}"]`);
      if (!fillZone || !spotZone) return;

      spotZone.querySelectorAll('.fv-job-spot-empty').forEach(node => {
        if (/split-load\s+spot\s+portion/i.test(clean(node.textContent))) node.remove();
      });

      jobCard.querySelectorAll('.fv-hauling-ticket-card[data-fv-status-ticket][data-ticket-id]').forEach(card => {
        if (!card.querySelector('.fv-seq-badge.split')) return;
        const amounts = splitAmounts(card);
        if (!(amounts.job>.005) || !(amounts.spot>.005)) return;

        const ticketId = clean(card.dataset.ticketId);
        card.dataset.fvSplitSource = '1';

        const jobKey = `${ticketId}|${jobId}|job`;
        const spotKey = `${ticketId}|${jobId}|spot`;
        if (!fillZone.querySelector(`[data-fv-hauling-split-key="${CSS.escape(jobKey)}"]`)) {
          fillZone.insertAdjacentHTML('beforeend',tile(card,jobId,amounts.job,'job'));
        }
        if (!spotZone.querySelector(`[data-fv-hauling-split-key="${CSS.escape(spotKey)}"]`)) {
          spotZone.insertAdjacentHTML('beforeend',tile(card,jobId,amounts.spot,'spot'));
        }
      });
    });

    bindSpotTiles(root);
  }

  function hookRoot(){
    const root = document.getElementById(ROOT_ID);
    if (!root || root === hookedRoot) return !!root;

    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype,'innerHTML');
    if (!descriptor?.get || !descriptor?.set) return false;
    nativeInnerHTML = descriptor;

    Object.defineProperty(root,'innerHTML',{
      configurable:true,
      enumerable:false,
      get(){ return nativeInnerHTML.get.call(this); },
      set(value){
        nativeInnerHTML.set.call(this,value);
        // The hauling-job renderer just replaced the cards. Rebuild the split
        // portions synchronously in the same JS turn, before the browser paints.
        decorate(this);
      }
    });
    hookedRoot = root;
    decorate(root);
    return true;
  }

  function bindSpotTiles(root){
    root.querySelectorAll('.fv-hauling-split-tile.spot[draggable="true"]').forEach(card => {
      if (card.dataset.fvBound==='1') return;
      card.dataset.fvBound='1';
      card.addEventListener('dragstart',event => {
        card.classList.add('dragging');
        const payload = {
          ticketId:clean(card.dataset.ticketId),
          sourceJobId:clean(card.dataset.sourceJobId),
          currentJobId:clean(card.dataset.currentJobId),
          bushels:round2(card.dataset.portionBushels),
          portionType:'spot'
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

  async function ensureFirebase(){
    if (firebase && db) return;
    firebase = await import('/js/firebase-init.js');
    await firebase.ready;
    db = firebase.getFirestore();
  }

  async function movePortion(payload,destinationJobId){
    if (moving) return;
    moving=true;
    try {
      await ensureFirebase();
      const ref=firebase.doc(db,'grain_tickets',clean(payload.ticketId));
      const snap=await firebase.getDoc(ref);
      if (!snap.exists()) return;
      const ticket=snap.data();
      const amount=round2(payload.bushels);
      const sourceJobId=clean(payload.sourceJobId || ticket?.haulingJobId);
      const destination=clean(destinationJobId);
      if (!sourceJobId || !destination || !(amount>.005)) return;

      const current=Array.isArray(ticket?.haulingJobSplitAllocations)
        ? ticket.haulingJobSplitAllocations.filter(Boolean)
        : [];
      const next=current.filter(item => !(
        clean(item?.sourceJobId)===sourceJobId &&
        clean(item?.haulingJobId || item?.jobId)===clean(payload.currentJobId || sourceJobId) &&
        Math.abs(num(item?.bushels)-amount)<.01
      ));
      if (destination!==sourceJobId) {
        next.push({
          id:`${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
          sourceJobId,
          haulingJobId:destination,
          bushels:amount,
          allocationType:'job',
          source:'manual_split_dnd',
          createdAt:new Date().toISOString()
        });
      }
      await firebase.updateDoc(ref,{
        haulingJobSplitAllocations:next,
        haulingJobSplitUpdatedAt:firebase.serverTimestamp(),
        updatedAt:firebase.serverTimestamp()
      });
      document.getElementById('fv-refresh-ticket-hauling')?.click();
    } catch(error) {
      console.error('[FarmVista] Could not move hauling split portion:',error);
      alert(error?.message || 'FarmVista could not move that split-load portion.');
    } finally { moving=false; }
  }

  document.addEventListener('dragover',event => {
    if (!document.querySelector('.fv-hauling-split-tile.spot.dragging')) return;
    const target=event.target.closest?.('[data-fv-status-job][data-fv-ticket-job-id]');
    if (!target) return;
    event.preventDefault();
    target.classList.add('fv-hauling-split-drop');
  },true);

  document.addEventListener('dragleave',event => {
    event.target.closest?.('[data-fv-status-job][data-fv-ticket-job-id]')?.classList.remove('fv-hauling-split-drop');
  },true);

  document.addEventListener('drop',event => {
    const payload=readPayload(event);
    if (!payload) return;
    const target=event.target.closest?.('[data-fv-status-job][data-fv-ticket-job-id]');
    const destinationJobId=clean(target?.dataset?.fvTicketJobId);
    if (!destinationJobId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    target.classList.remove('fv-hauling-split-drop');
    movePortion(payload,destinationJobId);
  },true);

  // Install only until the alternate hauling-job list exists. No repeating
  // decorator runs after the hook is established.
  const installTimer=setInterval(() => {
    if (hookRoot()) clearInterval(installTimer);
  },100);

  if (document.readyState==='loading') {
    document.addEventListener('DOMContentLoaded',hookRoot,{once:true});
  } else {
    hookRoot();
  }
})();