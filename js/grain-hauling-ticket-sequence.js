/* FarmVista — hauling-job ticket sequence review — Sept. 12, 2026
   Stable DND version: uses existing DOM only (classes/data/style attributes), so
   the Grain Contracts renderer cannot wipe out the collapse controls.
*/
(() => {
  'use strict';
  if (window.__FV_HAULING_TICKET_SEQUENCE_20260912_V2) return;
  window.__FV_HAULING_TICKET_SEQUENCE_20260912_V2 = true;
  if (!String(location.pathname || '').toLowerCase().endsWith('/pages/grain/grain-contracts.html')) return;

  const clean = value => String(value ?? '').trim();
  const num = value => {
    const n = Number(String(value ?? '').replace(/,/g,'').replace(/[^0-9.-]/g,''));
    return Number.isFinite(n) ? n : 0;
  };
  const fmt = value => num(value).toLocaleString('en-US',{maximumFractionDigits:2});
  const collator = new Intl.Collator(undefined,{numeric:true,sensitivity:'base'});
  const expanded = new Set();
  let queued = false;

  function installStyles() {
    if (document.getElementById('fv-hauling-ticket-sequence-style-v2')) return;
    const style = document.createElement('style');
    style.id = 'fv-hauling-ticket-sequence-style-v2';
    style.textContent = `
      #fv-ticket-status-job-list .fv-ticket-job-linked{
        display:grid!important;
        gap:8px!important;
        margin-top:8px!important;
      }
      #fv-ticket-status-job-list .fv-ticket-job-linked-label{
        order:-1000;
        display:flex!important;
        align-items:center;
        justify-content:space-between;
        width:100%;
        min-height:34px;
        margin:0!important;
        padding:8px 10px!important;
        border:1px solid var(--border,#ddd);
        border-radius:8px;
        background:var(--surface-2,#f5f5f5);
        color:inherit;
        cursor:pointer;
        user-select:none;
        font-size:0!important;
        font-weight:900;
      }
      #fv-ticket-status-job-list .fv-ticket-job-linked-label::before{
        content:attr(data-fv-seq-label);
        font-size:.78rem;
      }
      #fv-ticket-status-job-list .fv-ticket-job-linked-label::after{
        content:'›';
        font-size:1rem;
        line-height:1;
        transition:transform .15s ease;
      }
      #fv-ticket-status-job-list .fv-ticket-job-linked[data-fv-seq-open="1"] > .fv-ticket-job-linked-label::after{
        transform:rotate(90deg);
      }
      #fv-ticket-status-job-list .fv-ticket-job-linked[data-fv-seq-open="0"] > [data-fv-status-ticket]{
        display:none!important;
      }
      #fv-ticket-status-job-list .fv-ticket-job-linked[data-fv-seq-open="1"] > [data-fv-status-ticket]{
        display:grid!important;
      }

      #fv-ticket-status-job-list [data-fv-seq-type="job"] .fv-hauling-ticket-title span:first-child::after,
      #fv-ticket-status-job-list [data-fv-seq-type="split"] .fv-hauling-ticket-title span:first-child::after,
      #fv-ticket-status-job-list [data-fv-seq-type="spot"] .fv-hauling-ticket-title span:first-child::after{
        display:inline-flex;
        align-items:center;
        margin-left:7px;
        padding:2px 7px;
        border-radius:999px;
        font-size:.67rem;
        font-weight:900;
        vertical-align:middle;
      }
      #fv-ticket-status-job-list [data-fv-seq-type="job"] .fv-hauling-ticket-title span:first-child::after{
        content:'JOB';background:rgba(59,126,70,.12);color:#2d6937;
      }
      #fv-ticket-status-job-list [data-fv-seq-type="split"] .fv-hauling-ticket-title span:first-child::after{
        content:'FILLS JOB + SPOT';background:rgba(230,126,34,.14);color:#a65300;
      }
      #fv-ticket-status-job-list [data-fv-seq-type="spot"] .fv-hauling-ticket-title span:first-child::after{
        content:'SPOT';background:rgba(179,38,30,.11);color:#9d241e;
      }
      #fv-ticket-status-job-list .fv-hauling-ticket-meta[data-fv-seq-detail]::after{
        content:attr(data-fv-seq-detail);
        display:block;
        margin-top:4px;
        font-size:.72rem;
        font-weight:900;
        color:var(--text,#222);
      }
      #fv-ticket-status-job-list [data-fv-seq-type="split"] .fv-hauling-ticket-meta[data-fv-seq-detail]::after,
      #fv-ticket-status-job-list [data-fv-seq-type="spot"] .fv-hauling-ticket-meta[data-fv-seq-detail]::after{
        color:#9d241e;
      }
      [data-theme="dark"] #fv-ticket-status-job-list [data-fv-seq-type="job"] .fv-hauling-ticket-title span:first-child::after{color:#b9e4bf}
      [data-theme="dark"] #fv-ticket-status-job-list [data-fv-seq-type="split"] .fv-hauling-ticket-title span:first-child::after{color:#f4bb78}
      [data-theme="dark"] #fv-ticket-status-job-list [data-fv-seq-type="spot"] .fv-hauling-ticket-title span:first-child::after,
      [data-theme="dark"] #fv-ticket-status-job-list [data-fv-seq-type="split"] .fv-hauling-ticket-meta[data-fv-seq-detail]::after,
      [data-theme="dark"] #fv-ticket-status-job-list [data-fv-seq-type="spot"] .fv-hauling-ticket-meta[data-fv-seq-detail]::after{color:#ffaaa4}
    `;
    document.head.appendChild(style);
  }

  function ticketNumber(card) {
    const text = clean(card.querySelector('.fv-hauling-ticket-title span:first-child')?.textContent)
      .replace(/^ticket\s*/i,'');
    return text || clean(card.dataset.ticketId);
  }

  function ticketBushels(card) {
    return Math.max(0,num(card.querySelector('.fv-hauling-ticket-title span:last-child')?.textContent));
  }

  function jobTarget(jobCard) {
    const title = clean(jobCard.querySelector('.fv-ticket-job-title')?.textContent);
    const match = title.match(/([\d,]+(?:\.\d+)?)\s*bu\b/i);
    return match ? Math.max(0,num(match[1])) : 0;
  }

  function setOpen(linked,jobId,open,count) {
    linked.dataset.fvSeqOpen = open ? '1' : '0';
    const label = linked.querySelector(':scope > .fv-ticket-job-linked-label');
    if (label) {
      label.dataset.fvSeqLabel = `${count} assigned ticket${count === 1 ? '' : 's'} — ${open ? 'Hide' : 'View'}`;
      label.setAttribute('role','button');
      label.setAttribute('tabindex','0');
      label.setAttribute('aria-expanded',open ? 'true' : 'false');
    }
    if (open) expanded.add(jobId); else expanded.delete(jobId);
  }

  function bindToggle(linked,jobId,count) {
    const label = linked.querySelector(':scope > .fv-ticket-job-linked-label');
    if (!label) return;
    if (label.dataset.fvSeqBound !== '1') {
      label.dataset.fvSeqBound = '1';
      const toggle = event => {
        event.preventDefault();
        event.stopPropagation();
        const open = linked.dataset.fvSeqOpen !== '1';
        const currentCount = linked.querySelectorAll(':scope > [data-fv-status-ticket][data-ticket-id]').length;
        setOpen(linked,jobId,open,currentCount);
      };
      label.addEventListener('click',toggle);
      label.addEventListener('keydown',event => {
        if (event.key === 'Enter' || event.key === ' ') toggle(event);
      });
    }
    setOpen(linked,jobId,expanded.has(jobId),count);
  }

  function classify(jobCard,linked) {
    const cards = [...linked.querySelectorAll(':scope > [data-fv-status-ticket][data-ticket-id]')];
    if (!cards.length) return;

    cards.sort((a,b) => collator.compare(ticketNumber(a),ticketNumber(b)));
    const max = jobTarget(jobCard);
    let used = 0;

    cards.forEach((card,index) => {
      const bu = ticketBushels(card);
      const fill = Math.min(bu,Math.max(0,max-used));
      const spot = Math.max(0,bu-fill);
      used += bu;

      const type = spot > .005 ? (fill > .005 ? 'split' : 'spot') : 'job';
      card.dataset.fvSeqType = type;
      card.style.order = String(index + 1);

      const meta = card.querySelector('.fv-hauling-ticket-meta');
      if (meta) {
        if (type === 'split') meta.dataset.fvSeqDetail = `Job: ${fmt(fill)} bu • Spot: ${fmt(spot)} bu`;
        else if (type === 'spot') meta.dataset.fvSeqDetail = `Spot: ${fmt(spot)} bu`;
        else meta.dataset.fvSeqDetail = `Job: ${fmt(fill)} bu`;
      }
    });
  }

  function run() {
    installStyles();
    const root = document.getElementById('fv-ticket-status-job-list');
    if (!root || root.hidden) return;

    root.querySelectorAll('[data-fv-status-job][data-fv-ticket-job-id]').forEach(jobCard => {
      const jobId = clean(jobCard.dataset.fvTicketJobId);
      const linked = jobCard.querySelector(':scope > .fv-ticket-job-linked');
      if (!jobId || !linked) return;
      const count = linked.querySelectorAll(':scope > [data-fv-status-ticket][data-ticket-id]').length;
      bindToggle(linked,jobId,count);
      classify(jobCard,linked);
    });
  }

  function queue(delay=40) {
    if (queued) return;
    queued = true;
    setTimeout(() => requestAnimationFrame(() => {
      queued = false;
      run();
    }),delay);
  }

  // The status DND renderer replaces its cards with innerHTML. Observe only those
  // child replacements; our own class/data/style changes do not retrigger it.
  new MutationObserver(() => queue()).observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('change',event => {
    if (event.target?.id === 'fv-ticket-job-status-filter') queue(120);
  },true);
  document.addEventListener('drop',() => queue(450),true);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',() => queue(80),{once:true});
  else queue(80);
})();
