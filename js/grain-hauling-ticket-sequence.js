/* FarmVista — hauling-job ticket sequence review — Sept. 12, 2026
   Stable version: does not add, remove, or move DOM nodes inside the status DND.
   The core DND renderer watches childList changes, so this script uses only
   attributes/classes/styles on the existing ticket cards.
*/
(() => {
  'use strict';
  if (window.__FV_HAULING_TICKET_SEQUENCE_20260912_V3) return;
  window.__FV_HAULING_TICKET_SEQUENCE_20260912_V3 = true;
  if (!location.pathname.toLowerCase().endsWith('/pages/grain/grain-contracts.html')) return;

  const clean = v => String(v ?? '').trim();
  const num = v => {
    const n = Number(String(v ?? '').replace(/,/g,'').replace(/[^0-9.-]/g,''));
    return Number.isFinite(n) ? n : 0;
  };
  const fmt = v => num(v).toLocaleString('en-US',{maximumFractionDigits:2});
  const collator = new Intl.Collator(undefined,{numeric:true,sensitivity:'base'});
  const expanded = new Set();
  let firebase = null;
  let db = null;
  let jobs = new Map();
  let tickets = new Map();
  let loading = null;
  let queued = false;

  function installStyles() {
    if (document.getElementById('fv-hauling-ticket-sequence-style-v3')) return;
    const style = document.createElement('style');
    style.id = 'fv-hauling-ticket-sequence-style-v3';
    style.textContent = `
      #fv-ticket-status-job-list .fv-ticket-job-linked-label.fv-seq-toggle{
        display:flex!important;
        align-items:center;
        justify-content:space-between;
        width:100%;
        box-sizing:border-box;
        margin-top:8px;
        padding:8px 10px!important;
        border:1px solid var(--border,#ddd);
        border-radius:8px;
        background:var(--surface-2,#f5f5f5);
        color:inherit;
        font-size:.78rem;
        font-weight:900;
        cursor:pointer;
        user-select:none;
      }
      #fv-ticket-status-job-list .fv-ticket-job-linked-label.fv-seq-toggle::after{
        content:'›';
        font-size:1rem;
        font-weight:900;
        transition:transform .15s ease;
      }
      #fv-ticket-status-job-list .fv-ticket-job-linked-label.fv-seq-toggle[aria-expanded="true"]::after{
        transform:rotate(90deg);
      }
      #fv-ticket-status-job-list .fv-ticket-job-linked.fv-seq-collapsed > [data-fv-status-ticket]{
        display:none!important;
      }
      #fv-ticket-status-job-list .fv-ticket-job-linked:not(.fv-seq-collapsed) > [data-fv-status-ticket]{
        display:grid!important;
      }
      #fv-ticket-status-job-list .fv-ticket-job-linked{
        display:flex!important;
        flex-direction:column;
      }
      #fv-ticket-status-job-list [data-fv-status-ticket]{
        position:relative;
      }
      #fv-ticket-status-job-list [data-fv-status-ticket] .fv-hauling-ticket-title > span:first-child::after{
        content:attr(data-fv-seq-label);
        display:inline-flex;
        margin-left:7px;
        padding:2px 7px;
        border-radius:999px;
        font-size:.67rem;
        font-weight:900;
        vertical-align:middle;
      }
      #fv-ticket-status-job-list [data-fv-seq-type="job"] .fv-hauling-ticket-title > span:first-child::after{
        background:rgba(59,126,70,.12);color:#2d6937;
      }
      #fv-ticket-status-job-list [data-fv-seq-type="split"] .fv-hauling-ticket-title > span:first-child::after{
        background:rgba(230,126,34,.14);color:#a65300;
      }
      #fv-ticket-status-job-list [data-fv-seq-type="spot"] .fv-hauling-ticket-title > span:first-child::after{
        background:rgba(179,38,30,.11);color:#9d241e;
      }
      #fv-ticket-status-job-list [data-fv-status-ticket]::after{
        content:attr(data-fv-seq-detail);
        display:block;
        grid-column:2;
        margin-top:4px;
        font-size:.72rem;
        font-weight:850;
        white-space:pre-wrap;
      }
      #fv-ticket-status-job-list [data-fv-seq-type="split"]::after,
      #fv-ticket-status-job-list [data-fv-seq-type="spot"]::after{
        color:#9d241e;
      }
      [data-theme="dark"] #fv-ticket-status-job-list [data-fv-seq-type="job"] .fv-hauling-ticket-title > span:first-child::after{color:#b9e4bf}
      [data-theme="dark"] #fv-ticket-status-job-list [data-fv-seq-type="split"] .fv-hauling-ticket-title > span:first-child::after{color:#f4bb78}
      [data-theme="dark"] #fv-ticket-status-job-list [data-fv-seq-type="spot"] .fv-hauling-ticket-title > span:first-child::after,
      [data-theme="dark"] #fv-ticket-status-job-list [data-fv-seq-type="split"]::after,
      [data-theme="dark"] #fv-ticket-status-job-list [data-fv-seq-type="spot"]::after{color:#ffaaa4}
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
      const [jobSnap,ticketSnap] = await Promise.all([
        f.getDocs(f.collection(db,'grain_hauling_jobs')),
        f.getDocs(f.collection(db,'grain_tickets'))
      ]);
      jobs = new Map(jobSnap.docs.map(x => [x.id,{id:x.id,...x.data()}]));
      tickets = new Map(ticketSnap.docs.map(x => [x.id,{id:x.id,...x.data()}]));
    })().catch(error => console.warn('[FarmVista] hauling ticket sequence load failed:',error))
      .finally(() => { loading = null; });
    return loading;
  }

  const ticketNo = t => clean(t?.ticketNumber || t?.ticketNo || t?.ticket || t?.number || t?.scaleTicketNumber || t?.id);
  const ticketBu = t => Math.max(0,num(t?.netBushels ?? t?.netBu ?? t?.bushels));
  const target = j => Math.max(0,num(j?.startingBushels ?? j?.jobBushels ?? j?.bushels));

  function ordered(jobId) {
    return [...tickets.values()]
      .filter(t => clean(t?.haulingJobId) === jobId && !clean(t?.status).toLowerCase().includes('void'))
      .sort((a,b) => collator.compare(ticketNo(a),ticketNo(b)) || clean(a?.ticketDate || a?.date).localeCompare(clean(b?.ticketDate || b?.date)));
  }

  function allocation(job,list) {
    let used = 0;
    const max = target(job);
    return list.map((t,index) => {
      const bu = ticketBu(t);
      const fill = Math.min(bu,Math.max(0,max-used));
      const spot = Math.max(0,bu-fill);
      used += bu;
      return {t,index,fill,spot,type:spot>.005 ? (fill>.005 ? 'split' : 'spot') : 'job'};
    });
  }

  function syncLinkedSection(jobCard,jobId,count) {
    const linked = jobCard.querySelector('.fv-ticket-job-linked');
    const label = linked?.querySelector(':scope > .fv-ticket-job-linked-label');
    if (!linked || !label) return null;

    label.classList.add('fv-seq-toggle');
    label.setAttribute('role','button');
    label.setAttribute('tabindex','0');
    label.dataset.fvSeqJobId = jobId;

    const open = expanded.has(jobId);
    label.setAttribute('aria-expanded',open ? 'true' : 'false');
    label.textContent = `${count} assigned ticket${count===1?'':'s'} — ${open?'Hide':'View'}`;
    linked.classList.toggle('fv-seq-collapsed',!open);
    return linked;
  }

  function decorateTicket(card,a) {
    card.style.order = String(a.index + 1);
    card.dataset.fvSeqType = a.type;
    card.dataset.fvSeqLabel = a.type === 'spot' ? 'SPOT' : a.type === 'split' ? 'FILLS JOB + SPOT' : 'JOB';
    card.dataset.fvSeqDetail = a.type === 'split'
      ? `Job: ${fmt(a.fill)} bu • Spot: ${fmt(a.spot)} bu`
      : a.type === 'spot'
        ? `Spot: ${fmt(a.spot)} bu`
        : `Job: ${fmt(a.fill)} bu`;

    const titleFirst = card.querySelector('.fv-hauling-ticket-title > span:first-child');
    if (titleFirst) titleFirst.dataset.fvSeqLabel = card.dataset.fvSeqLabel;
  }

  async function run(forceLoad=false) {
    const root = document.getElementById('fv-ticket-status-job-list');
    if (!root || root.hidden) return;
    await load(forceLoad);

    root.querySelectorAll('[data-fv-status-job][data-fv-ticket-job-id]').forEach(jobCard => {
      const jobId = clean(jobCard.dataset.fvTicketJobId);
      const job = jobs.get(jobId);
      if (!job) return;

      const list = allocation(job,ordered(jobId));
      const linked = syncLinkedSection(jobCard,jobId,list.length);
      if (!linked) return;

      const cards = new Map(
        [...linked.querySelectorAll(':scope > [data-fv-status-ticket][data-ticket-id]')]
          .map(card => [clean(card.dataset.ticketId),card])
      );
      list.forEach(a => {
        const card = cards.get(a.t.id);
        if (card) decorateTicket(card,a);
      });
    });
  }

  function toggleFromLabel(label) {
    const jobId = clean(label?.dataset?.fvSeqJobId);
    if (!jobId) return;
    if (expanded.has(jobId)) expanded.delete(jobId); else expanded.add(jobId);

    const linked = label.closest('.fv-ticket-job-linked');
    const count = linked?.querySelectorAll(':scope > [data-fv-status-ticket]').length || 0;
    const open = expanded.has(jobId);
    label.setAttribute('aria-expanded',open ? 'true' : 'false');
    label.textContent = `${count} assigned ticket${count===1?'':'s'} — ${open?'Hide':'View'}`;
    linked?.classList.toggle('fv-seq-collapsed',!open);
  }

  document.addEventListener('click',event => {
    const label = event.target.closest?.('#fv-ticket-status-job-list .fv-ticket-job-linked-label.fv-seq-toggle');
    if (!label) return;
    event.preventDefault();
    event.stopPropagation();
    toggleFromLabel(label);
  },true);

  document.addEventListener('keydown',event => {
    if (!['Enter',' '].includes(event.key)) return;
    const label = event.target.closest?.('#fv-ticket-status-job-list .fv-ticket-job-linked-label.fv-seq-toggle');
    if (!label) return;
    event.preventDefault();
    toggleFromLabel(label);
  },true);

  function queue(force=false,delay=50) {
    if (queued) return;
    queued = true;
    setTimeout(() => requestAnimationFrame(async() => {
      queued = false;
      installStyles();
      await run(force);
    }),delay);
  }

  // Watch for the core renderer replacing job cards, but this script itself makes
  // no childList changes, so it cannot cause a render loop.
  new MutationObserver(records => {
    const relevant = records.some(record => {
      const target = record.target instanceof Element ? record.target : record.target?.parentElement;
      return target?.closest?.('#fv-ticket-status-job-list') || [...record.addedNodes].some(node => node instanceof Element && (node.id === 'fv-ticket-status-job-list' || node.querySelector?.('#fv-ticket-status-job-list')));
    });
    if (relevant) queue(false,30);
  }).observe(document.documentElement,{childList:true,subtree:true});

  document.addEventListener('change',event => {
    if (event.target?.id === 'fv-ticket-job-status-filter') queue(true,120);
  },true);
  document.addEventListener('drop',() => queue(true,500),true);
  document.addEventListener('click',event => {
    if (event.target.closest?.('#fv-refresh-ticket-hauling')) queue(true,250);
  },true);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',() => queue(true,80),{once:true});
  else queue(true,80);
})();
