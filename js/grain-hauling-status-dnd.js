/* FarmVista — Grain Contracts hauling-job status DND
   Sept. 12, 2026

   Status-based hauling-job DND workspace.
   Matching Jobs remains the clean default and is owned by the core DND renderer.
   All/Active/Upcoming/Past Due/Completed use this alternate workspace.
   Assigned tickets are collapsed by default.
   Hauling-job fill/spot is calculated by elevator ticket number order, not scan order.
   The ticket that crosses the job target is shown as SPLIT (job fill + spot).
   Once the job is full, a Spot Loads drop section is always shown, even at 0 bu.
   Drag a ticket to Spot Loads to force that whole ticket to Spot on the same job.
   Drag a Spot ticket back onto the hauling-job card to return it to automatic sequence.
   Drag left to Unassigned or onto another compatible hauling job as normal.

   Contract allocation is never changed by this workspace.
*/
(() => {
  'use strict';

  if (window.__FV_HAULING_STATUS_DND_20260912_V4) return;
  window.__FV_HAULING_STATUS_DND_20260912_V4 = true;

  const path = String(location.pathname || '').toLowerCase();
  if (!path.endsWith('/pages/grain/grain-contracts.html')) return;

  const clean = value => String(value ?? '').trim();
  const norm = value => clean(value).toLowerCase().replace(/[^a-z0-9]/g, '');
  const num = value => {
    const parsed = Number(String(value ?? '').replace(/,/g, '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const fmtBu = value => num(value).toLocaleString('en-US', { maximumFractionDigits:2 });
  const esc = value => clean(value)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#039;');
  const collator = new Intl.Collator(undefined,{ numeric:true, sensitivity:'base' });

  const state = {
    mode:'matching',
    firebase:null,
    db:null,
    jobs:new Map(),
    tickets:new Map(),
    customers:new Map(),
    loading:null,
    selected:new Set(),
    expandedJobs:new Set(),
    dragIds:[],
    busy:false,
    queued:false,
    touch:{timer:0,active:false,source:null,ghost:null,target:null,ids:[],startX:0,startY:0}
  };

  function installStyle() {
    if (document.getElementById('fv-hauling-status-dnd-style-v4')) return;
    const style = document.createElement('style');
    style.id = 'fv-hauling-status-dnd-style-v4';
    style.textContent = `
      #fv-ticket-hauling-filterbar.fv-status-filterbar{
        grid-template-columns:repeat(4,minmax(155px,1fr)) auto;
      }
      #fv-ticket-status-job-list[hidden]{display:none!important}
      .fv-status-job-card{position:relative}
      .fv-status-pill{
        display:inline-flex;align-items:center;justify-content:center;margin-left:7px;
        padding:2px 7px;border-radius:999px;font-size:.68rem;font-weight:900;vertical-align:middle
      }
      .fv-status-pill.active{background:rgba(59,126,70,.14);color:#2d6937}
      .fv-status-pill.upcoming{background:rgba(230,126,34,.16);color:#a65300}
      .fv-status-pill.past_due{background:rgba(179,38,30,.13);color:#9d241e}
      .fv-status-pill.completed{background:rgba(37,99,235,.14);color:#1d5bbf}
      .fv-status-over{color:#9d241e;font-weight:900}
      .fv-status-ticket-note{margin-top:5px;font-size:.72rem;font-weight:750;opacity:.63}
      .fv-status-job-card.completed{border-color:rgba(37,99,235,.44)}
      .fv-status-job-card.overhauled{box-shadow:inset 4px 0 0 rgba(179,38,30,.70)}

      .fv-job-ticket-toggle{
        width:100%;margin-top:10px;padding:8px 10px;border:1px solid var(--border,#ddd);
        border-radius:8px;background:var(--surface-2,#f5f5f5);color:inherit;
        display:flex;align-items:center;justify-content:space-between;gap:10px;
        font:inherit;font-size:.78rem;font-weight:900;cursor:pointer;text-align:left
      }
      .fv-job-ticket-toggle .arrow{font-size:1rem;transition:transform .15s ease}
      .fv-job-ticket-toggle[aria-expanded="true"] .arrow{transform:rotate(90deg)}
      .fv-job-ticket-body[hidden]{display:none!important}
      .fv-job-ticket-body{margin-top:8px;display:flex;flex-direction:column;gap:10px}
      .fv-job-allocation-section{
        border:1px solid var(--border,#ddd);border-radius:9px;padding:9px;background:var(--surface,#fff)
      }
      .fv-job-allocation-head{
        display:flex;align-items:center;justify-content:space-between;gap:8px;
        font-size:.75rem;font-weight:900;margin-bottom:7px
      }
      .fv-job-fill-zone.drag-over,
      .fv-job-spot-zone.drag-over{
        outline:2px solid #4f718f;outline-offset:1px;background:rgba(79,113,143,.08)
      }
      .fv-job-spot-zone{
        border:2px dashed rgba(179,38,30,.35);border-radius:9px;padding:9px;
        background:rgba(179,38,30,.025)
      }
      .fv-job-spot-empty{
        padding:10px 8px;text-align:center;font-size:.74rem;font-weight:750;opacity:.68
      }
      .fv-job-spot-total{color:#9d241e;font-weight:900}
      .fv-seq-badge{
        display:inline-flex;margin-left:7px;padding:2px 7px;border-radius:999px;
        font-size:.67rem;font-weight:900;vertical-align:middle
      }
      .fv-seq-badge.job{background:rgba(59,126,70,.12);color:#2d6937}
      .fv-seq-badge.split{background:rgba(230,126,34,.14);color:#a65300}
      .fv-seq-badge.spot{background:rgba(179,38,30,.11);color:#9d241e}
      .fv-seq-detail{margin-top:5px;font-size:.72rem;font-weight:850}
      .fv-seq-detail.split,.fv-seq-detail.spot{color:#9d241e}
      .fv-manual-spot-note{font-size:.7rem;font-weight:850;color:#9d241e;margin-top:3px}

      /* Remaining bushels: FONT COLOR ONLY. */
      #hauling-jobs-table-body td.fv-remain-green,
      #contracts-table-body td.fv-remain-green{
        background:transparent!important;background-color:transparent!important;background-image:none!important;
        box-shadow:none!important;color:#2d6937!important;font-weight:900!important
      }
      #hauling-jobs-table-body td.fv-remain-orange,
      #contracts-table-body td.fv-remain-orange{
        background:transparent!important;background-color:transparent!important;background-image:none!important;
        box-shadow:none!important;color:#a65300!important;font-weight:900!important
      }
      #hauling-jobs-table-body td.fv-remain-red,
      #contracts-table-body td.fv-remain-red{
        background:transparent!important;background-color:transparent!important;background-image:none!important;
        box-shadow:none!important;color:#9d241e!important;font-weight:900!important
      }
      [data-theme="dark"] #hauling-jobs-table-body td.fv-remain-green,
      [data-theme="dark"] #contracts-table-body td.fv-remain-green{color:#b9e4bf!important}
      [data-theme="dark"] #hauling-jobs-table-body td.fv-remain-orange,
      [data-theme="dark"] #contracts-table-body td.fv-remain-orange{color:#f4bb78!important}
      [data-theme="dark"] #hauling-jobs-table-body td.fv-remain-red,
      [data-theme="dark"] #contracts-table-body td.fv-remain-red{color:#ffaaa4!important}

      @media(max-width:1050px){
        #fv-ticket-hauling-filterbar.fv-status-filterbar{grid-template-columns:1fr 1fr}
      }
      @media(max-width:560px){
        #fv-ticket-hauling-filterbar.fv-status-filterbar{grid-template-columns:1fr}
      }
    `;
    document.head.appendChild(style);
  }

  async function load(force=false) {
    if (state.loading && !force) return state.loading;
    state.loading = (async() => {
      const firebase = state.firebase || await import('/js/firebase-init.js');
      await firebase.ready;
      state.firebase = firebase;
      state.db = firebase.getFirestore();
      const [jobsSnap,ticketsSnap,customersSnap] = await Promise.all([
        firebase.getDocs(firebase.collection(state.db,'grain_hauling_jobs')),
        firebase.getDocs(firebase.collection(state.db,'grain_tickets')),
        firebase.getDocs(firebase.collection(state.db,'grain_customers'))
      ]);
      state.jobs = new Map(jobsSnap.docs.map(s => [s.id,{id:s.id,...s.data()}]));
      state.tickets = new Map(ticketsSnap.docs.map(s => [s.id,{id:s.id,...s.data()}]));
      state.customers = new Map(customersSnap.docs.map(s => [s.id,{id:s.id,...s.data()}]));
    })().catch(error => console.warn('[FarmVista] Hauling status DND load failed:',error))
      .finally(() => { state.loading = null; });
    return state.loading;
  }

  function isVoided(record) {
    const status = clean(record?.status || record?.contractStatus).toLowerCase();
    return record?.voided === true || status.includes('void');
  }
  function isClosed(job) {
    const status = clean(job?.status).toLowerCase();
    return job?.manualClosed === true || status.includes('closed') || status.includes('cancel');
  }
  function localISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function ticketBushels(ticket) {
    return Math.max(0,num(ticket?.netBushels ?? ticket?.netBu ?? ticket?.bushels));
  }
  function jobTarget(job) {
    return Math.max(0,num(job?.startingBushels ?? job?.jobBushels ?? job?.bushels));
  }
  function ticketNo(ticket) {
    return clean(ticket?.ticketNumber || ticket?.ticketNo || ticket?.ticket || ticket?.number || ticket?.scaleTicketNumber || ticket?.id) || 'Ticket';
  }
  function ticketDate(ticket) {
    return clean(ticket?.ticketDate || ticket?.date || ticket?.deliveryDate);
  }
  function manualSpot(ticket) {
    const type = clean(ticket?.haulingJobAllocationType || ticket?.haulingAllocationType).toLowerCase();
    return type === 'spot';
  }
  function ticketsForJob(jobId) {
    return Array.from(state.tickets.values())
      .filter(ticket => !isVoided(ticket) && clean(ticket?.haulingJobId) === clean(jobId))
      .sort((a,b) => collator.compare(ticketNo(a),ticketNo(b)) || ticketDate(a).localeCompare(ticketDate(b)) || clean(a.id).localeCompare(clean(b.id)));
  }
  function allocationForJob(job) {
    const list = ticketsForJob(job.id);
    const max = jobTarget(job);
    let used = 0;
    return list.map((ticket,index) => {
      const bu = ticketBushels(ticket);
      if (manualSpot(ticket)) {
        return {ticket,index,fill:0,spot:bu,type:'spot',manual:true};
      }
      const fill = Math.min(bu,Math.max(0,max-used));
      const spot = Math.max(0,bu-fill);
      used += fill;
      return {
        ticket,index,fill,spot,
        type:spot>.005 ? (fill>.005 ? 'split' : 'spot') : 'job',
        manual:false
      };
    });
  }
  function jobNumbers(job) {
    const allocations = allocationForJob(job);
    const target = jobTarget(job);
    const fill = allocations.reduce((sum,a) => sum+a.fill,0);
    const spot = allocations.reduce((sum,a) => sum+a.spot,0);
    const assigned = allocations.reduce((sum,a) => sum+ticketBushels(a.ticket),0);
    return {allocations,target,fill,spot,assigned,remaining:Math.max(0,target-fill)};
  }
  function jobStatus(job) {
    if (isVoided(job)) return 'voided';
    if (isClosed(job)) return 'closed';
    const raw = clean(job?.status).toLowerCase();
    const numbers = jobNumbers(job);
    const start = clean(job?.deliveryStartDate || job?.startDate);
    const end = clean(job?.deliveryEndDate || job?.endDate);
    if (raw.includes('complete') || (numbers.target>0 && numbers.fill>=numbers.target-.005)) return 'completed';
    if (start && start>localISO()) return 'upcoming';
    if (end && end<localISO() && numbers.fill<numbers.target-.005) return 'past_due';
    return 'active';
  }
  const statusLabel = status => ({active:'Active',upcoming:'Upcoming',past_due:'Past Due',completed:'Completed'})[status] || status;

  function soldUnder(record) {
    const direct = clean(record?.customerName || record?.soldUnderName || record?.soldUnder || record?.customer);
    if (direct && direct.toLowerCase()!=='unknown') return direct;
    const id = clean(record?.customerId || record?.soldUnderId || record?.grainCustomerId);
    return clean(state.customers.get(id)?.name) || '—';
  }
  function jobName(job) {
    const saved = clean(job?.displayName || job?.jobName || job?.haulingJobName);
    if (saved) return saved;
    const buyer = clean(job?.buyerName || job?.buyer);
    const location = clean(job?.deliveryLocationName || job?.locationName || job?.destinationName || job?.destination);
    return `${location || buyer || 'Hauling Job'} — ${fmtBu(jobTarget(job))} bu`;
  }
  function jobBuyer(job) { return clean(job?.buyerName || job?.buyer || job?.grainBuyerName); }
  function jobBuyerId(job) { return clean(job?.buyerId || job?.grainBuyerId); }
  function jobLocation(job) { return clean(job?.deliveryLocationName || job?.locationName || job?.destinationName || job?.destination); }
  function jobLocationId(job) { return clean(job?.deliveryLocationId || job?.locationId || job?.destinationId); }
  function jobCrop(job) { return clean(job?.crop || job?.commodity || job?.cropName || job?.cropType); }
  function ticketBuyer(ticket) { return clean(ticket?.buyerName || ticket?.destinationBuyerName || ticket?.elevatorName); }
  function ticketBuyerId(ticket) { return clean(ticket?.buyerId || ticket?.grainBuyerId || ticket?.destinationBuyerId); }
  function ticketLocation(ticket) { return clean(ticket?.deliveryLocationName || ticket?.locationName || ticket?.destinationName || ticket?.destination || ticket?.elevator); }
  function ticketLocationId(ticket) { return clean(ticket?.deliveryLocationId || ticket?.locationId || ticket?.destinationId); }
  function cropKey(value) {
    const key = norm(value);
    if (key==='corn' || key==='yellowcorn') return 'corn';
    if (['soy','soybean','soybeans','beans','yellowsoybeans'].includes(key)) return 'soybeans';
    return key;
  }
  function idsOrNamesMatch(aId,aName,bId,bName) {
    if (aId && bId) return clean(aId)===clean(bId);
    if (aName && bName) return norm(aName)===norm(bName);
    return true;
  }
  function ticketMatchesJob(ticket,job) {
    if (!idsOrNamesMatch(ticketBuyerId(ticket),ticketBuyer(ticket),jobBuyerId(job),jobBuyer(job))) return false;
    if (!idsOrNamesMatch(ticketLocationId(ticket),ticketLocation(ticket),jobLocationId(job),jobLocation(job))) return false;
    const tc = cropKey(ticket?.crop || ticket?.commodity || ticket?.grain || ticket?.cropName);
    const jc = cropKey(jobCrop(job));
    return !(tc && jc && tc!==jc);
  }

  function activeFilters() {
    return {
      buyer:clean(document.getElementById('fv-ticket-filter-buyer')?.value),
      sold:clean(document.getElementById('fv-ticket-filter-sold-under')?.value),
      crop:clean(document.getElementById('fv-ticket-filter-crop')?.value)
    };
  }
  function jobMatchesFilters(job) {
    const f = activeFilters();
    if (f.buyer && norm(jobBuyer(job))!==norm(f.buyer)) return false;
    if (f.sold && norm(soldUnder(job))!==norm(f.sold)) return false;
    if (f.crop && cropKey(jobCrop(job))!==cropKey(f.crop)) return false;
    return true;
  }
  function jobsForMode() {
    return Array.from(state.jobs.values())
      .filter(job => {
        const status = jobStatus(job);
        if (['voided','closed'].includes(status)) return false;
        if (state.mode!=='all' && status!==state.mode) return false;
        return jobMatchesFilters(job);
      })
      .sort((a,b) => {
        const order = {past_due:0,active:1,upcoming:2,completed:3};
        const d = (order[jobStatus(a)]??9)-(order[jobStatus(b)]??9);
        if (d) return d;
        return clean(a?.deliveryStartDate || a?.startDate).localeCompare(clean(b?.deliveryStartDate || b?.startDate)) ||
          jobName(a).localeCompare(jobName(b),undefined,{numeric:true,sensitivity:'base'});
      });
  }

  function ticketMarkup(allocation) {
    const ticket = allocation.ticket;
    const selected = state.selected.has(ticket.id);
    const type = allocation.type;
    const badge = type==='spot' ? 'SPOT' : type==='split' ? 'FILLS JOB + SPOT' : 'JOB';
    const detail = type==='split'
      ? `Job: ${fmtBu(allocation.fill)} bu • Spot: ${fmtBu(allocation.spot)} bu`
      : type==='spot'
        ? `Spot: ${fmtBu(allocation.spot)} bu`
        : `Job: ${fmtBu(allocation.fill)} bu`;
    return `
      <div class="fv-hauling-ticket-card" data-fv-status-ticket="1" data-ticket-id="${esc(ticket.id)}" draggable="true">
        <input class="fv-ticket-select" type="checkbox" data-fv-status-check="${esc(ticket.id)}" ${selected?'checked':''} aria-label="Select ticket ${esc(ticketNo(ticket))}">
        <div>
          <div class="fv-hauling-ticket-title">
            <span>Ticket ${esc(ticketNo(ticket))}<span class="fv-seq-badge ${type}">${badge}</span></span>
            <span>${fmtBu(ticketBushels(ticket))} bu</span>
          </div>
          <div class="fv-hauling-ticket-meta">${esc(ticketDate(ticket) || 'No date')} • ${esc(clean(ticket?.crop || ticket?.commodity || ticket?.grain || ticket?.cropName) || 'Unknown crop')}<br>${esc(ticketBuyer(ticket) || ticketLocation(ticket) || 'Unknown destination')}${ticketLocation(ticket) && ticketBuyer(ticket) ? ` • ${esc(ticketLocation(ticket))}` : ''}</div>
          <div class="fv-ticket-sold-under"><strong>Sold Under:</strong> ${esc(soldUnder(ticket))}</div>
          <div class="fv-seq-detail ${type}">${detail}</div>
          ${allocation.manual ? '<div class="fv-manual-spot-note">Manually marked Spot on this hauling job.</div>' : ''}
          <div class="fv-status-ticket-note">Drag left to unassign, onto another compatible hauling job to move it, or into Spot Loads to mark the whole ticket Spot.</div>
        </div>
      </div>`;
  }

  function jobMarkup(job) {
    const n = jobNumbers(job);
    const status = jobStatus(job);
    const open = state.expandedJobs.has(job.id);
    const fillAllocations = n.allocations.filter(a => a.type!=='spot');
    const spotAllocations = n.allocations.filter(a => a.type==='spot');
    const splitSpot = n.allocations.filter(a => a.type==='split').reduce((sum,a) => sum+a.spot,0);
    const spotVisible = ((n.target>0 && n.fill>=n.target-.005) || n.spot>.005);
    return `
      <div class="fv-ticket-job-card fv-status-job-card ${status}${n.spot>.005?' overhauled':''}" data-fv-status-job="1" data-fv-ticket-job-id="${esc(job.id)}">
        <div class="fv-ticket-job-title">${esc(jobName(job))}<span class="fv-status-pill ${status}">${esc(statusLabel(status))}</span></div>
        <div class="fv-ticket-job-meta">
          ${esc(jobBuyer(job) || 'Unknown buyer')} • ${esc(jobLocation(job) || 'Unknown location')} • ${esc(jobCrop(job) || 'Unknown crop')}<br>
          ${fmtBu(n.fill)} bu job fill • ${fmtBu(n.remaining)} bu remaining${n.spot>.005 ? ` • <span class="fv-status-over">${fmtBu(n.spot)} bu spot</span>` : ''} • ${n.allocations.length} ticket${n.allocations.length===1?'':'s'}
        </div>
        <div class="fv-job-sold-under"><strong>Sold Under:</strong> ${esc(soldUnder(job))}</div>
        <button type="button" class="fv-job-ticket-toggle" data-fv-job-toggle="${esc(job.id)}" aria-expanded="${open?'true':'false'}">
          <span>${n.allocations.length} assigned ticket${n.allocations.length===1?'':'s'} — ${open?'Hide':'View'}</span><span class="arrow">›</span>
        </button>
        <div class="fv-job-ticket-body" data-fv-job-body="${esc(job.id)}" ${open?'':'hidden'}>
          <div class="fv-job-allocation-section fv-job-fill-zone" data-fv-fill-job-id="${esc(job.id)}">
            <div class="fv-job-allocation-head"><span>Job Fill</span><span>${fmtBu(n.fill)} / ${fmtBu(n.target)} bu</span></div>
            ${fillAllocations.length ? fillAllocations.map(ticketMarkup).join('') : '<div class="fv-job-spot-empty">No tickets currently filling this hauling job.</div>'}
          </div>
          ${spotVisible ? `
            <div class="fv-job-spot-zone" data-fv-spot-job-id="${esc(job.id)}">
              <div class="fv-job-allocation-head"><span>Spot Loads</span><span class="fv-job-spot-total">${fmtBu(n.spot)} bu</span></div>
              ${spotAllocations.length ? spotAllocations.map(ticketMarkup).join('') : '<div class="fv-job-spot-empty">0 whole-ticket Spot loads. Drop a ticket here if the elevator treated it as Spot.</div>'}
              ${splitSpot>.005 ? `<div class="fv-job-spot-empty">Split-load Spot portion: ${fmtBu(splitSpot)} bu</div>` : ''}
            </div>` : ''}
        </div>
      </div>`;
  }

  function ensureStatusUI() {
    document.getElementById('fv-show-all-hauling-jobs')?.remove();
    const bar = document.getElementById('fv-ticket-hauling-filterbar');
    if (!bar) return false;
    bar.classList.add('fv-status-filterbar');

    if (!document.getElementById('fv-ticket-job-status-filter')) {
      const label = document.createElement('label');
      label.className = 'fv-ticket-hauling-filterfield';
      label.id = 'fv-ticket-job-status-field';
      label.innerHTML = `
        <span>Job Status</span>
        <select id="fv-ticket-job-status-filter" aria-label="Filter hauling jobs by status">
          <option value="matching">Matching Jobs</option>
          <option value="all">All Jobs</option>
          <option value="active">Active</option>
          <option value="upcoming">Upcoming</option>
          <option value="past_due">Past Due</option>
          <option value="completed">Completed</option>
        </select>`;
      bar.prepend(label);
      const select = label.querySelector('select');
      select.value = state.mode;
      select.addEventListener('change', async() => {
        state.mode = select.value || 'matching';
        state.selected.clear();
        if (state.mode==='matching') {
          showCoreList();
          document.getElementById('fv-refresh-ticket-hauling')?.click();
        } else {
          await load(true);
          renderOverride();
        }
      });
    }

    const coreList = document.getElementById('fv-ticket-job-list');
    const column = coreList?.closest('.fv-ticket-hauling-column');
    if (coreList && column && !document.getElementById('fv-ticket-status-job-list')) {
      const alt = document.createElement('div');
      alt.id = 'fv-ticket-status-job-list';
      alt.className = 'fv-ticket-hauling-list';
      alt.hidden = true;
      coreList.insertAdjacentElement('afterend',alt);
    }
    return true;
  }

  function showCoreList() {
    const core = document.getElementById('fv-ticket-job-list');
    const alt = document.getElementById('fv-ticket-status-job-list');
    if (core) core.hidden = false;
    if (alt) alt.hidden = true;
  }

  function renderOverride() {
    if (state.mode==='matching') return showCoreList();
    const core = document.getElementById('fv-ticket-job-list');
    const alt = document.getElementById('fv-ticket-status-job-list');
    if (!core || !alt) return;
    const jobs = jobsForMode();
    core.hidden = true;
    alt.hidden = false;
    alt.innerHTML = jobs.length
      ? jobs.map(jobMarkup).join('')
      : '<div class="fv-ticket-empty"><div class="fv-ticket-empty-title">No Hauling Jobs</div><div class="fv-ticket-empty-sub">No hauling jobs match this status and the current Buyer / Sold Under / Crop filters.</div></div>';

    const count = document.getElementById('fv-ticket-job-count');
    if (count) count.textContent = `${jobs.length} job${jobs.length===1?'':'s'}`;
    const message = document.getElementById('fv-ticket-hauling-message');
    if (message) {
      message.textContent = `${state.mode==='all' ? 'Showing all hauling jobs' : `Showing ${statusLabel(state.mode)} hauling jobs`}. Open a job to review Job Fill and Spot Loads, then drag tickets where they belong.`;
      message.classList.add('ready');
    }
    bindOverrideDnd();
  }

  function dragSelection(sourceId) {
    const source = clean(sourceId);
    if (state.selected.has(source) && state.selected.size) return [...state.selected];
    return source ? [source] : [];
  }

  async function assignTickets(ids,jobId,{spot=false}={}) {
    if (state.busy) return;
    await load();
    const job = state.jobs.get(clean(jobId));
    const ticketIds = [...new Set(ids.map(clean).filter(Boolean))].filter(id => state.tickets.has(id));
    if (!job || !ticketIds.length) return;
    if (ticketIds.some(id => !ticketMatchesJob(state.tickets.get(id),job))) {
      alert('One or more selected tickets do not match this hauling job\'s destination or crop.');
      return;
    }
    state.busy = true;
    try {
      const f = state.firebase;
      const customerId = clean(job?.customerId || job?.soldUnderId || job?.grainCustomerId);
      const customerName = soldUnder(job);
      const patch = {
        haulingJobId:job.id,
        haulingJobName:jobName(job),
        haulingJobAssignmentSource:'manual_dnd',
        haulingJobAssignedAt:f.serverTimestamp(),
        haulingJobAllocationType:spot ? 'spot' : null,
        haulingJobAllocationSource:spot ? 'manual_spot_dnd' : null,
        haulingJobManualUnassignedFromJobId:null,
        haulingJobManualUnassignedAt:null,
        haulingJobManualUnassignedByUid:null,
        haulingJobManualUnassignedByName:null,
        updatedAt:f.serverTimestamp()
      };
      if (jobBuyerId(job)) patch.buyerId = jobBuyerId(job);
      if (jobBuyer(job)) patch.buyerName = jobBuyer(job);
      if (jobLocationId(job)) patch.deliveryLocationId = jobLocationId(job);
      if (jobLocation(job)) patch.deliveryLocationName = jobLocation(job);
      if (jobCrop(job)) patch.crop = jobCrop(job);
      if (customerId) patch.customerId = customerId;
      if (customerName && customerName!=='—') patch.customerName = customerName;

      await Promise.all(ticketIds.map(id => f.updateDoc(f.doc(state.db,'grain_tickets',id),patch)));
      ticketIds.forEach(id => state.selected.delete(id));
      state.expandedJobs.add(job.id);
      await load(true);
      renderOverride();
      document.getElementById('refresh-hauling-link-btn')?.click();
    } catch(error) {
      console.error('[FarmVista] Manual hauling-job ticket move failed:',error);
      alert(error?.message || 'FarmVista could not move that grain ticket.');
    } finally { state.busy=false; }
  }

  async function unassignTickets(ids) {
    if (state.busy) return;
    await load();
    const ticketIds = [...new Set(ids.map(clean).filter(Boolean))].filter(id => clean(state.tickets.get(id)?.haulingJobId));
    if (!ticketIds.length) return;
    state.busy = true;
    try {
      const f = state.firebase;
      const user = f.getAuth?.()?.currentUser;
      await Promise.all(ticketIds.map(id => {
        const ticket = state.tickets.get(id);
        const oldJobId = clean(ticket?.haulingJobId);
        return f.updateDoc(f.doc(state.db,'grain_tickets',id),{
          haulingJobId:null,
          haulingJobName:null,
          haulingJobAssignmentSource:'manual_unassigned',
          haulingJobAllocationType:null,
          haulingJobAllocationSource:null,
          haulingJobManualUnassignedFromJobId:oldJobId || null,
          haulingJobManualUnassignedAt:f.serverTimestamp(),
          haulingJobManualUnassignedByUid:clean(user?.uid) || null,
          haulingJobManualUnassignedByName:clean(user?.displayName || user?.email || user?.phoneNumber) || null,
          updatedAt:f.serverTimestamp()
        });
      }));
      ticketIds.forEach(id => state.selected.delete(id));
      await load(true);
      renderOverride();
      document.getElementById('refresh-hauling-link-btn')?.click();
      document.getElementById('fv-refresh-ticket-hauling')?.click();
    } catch(error) {
      console.error('[FarmVista] Manual hauling-job unassign failed:',error);
      alert(error?.message || 'FarmVista could not unassign that grain ticket.');
    } finally { state.busy=false; }
  }

  function idsFromDrop(event) {
    const raw = clean(event.dataTransfer?.getData('text/plain'));
    return raw ? raw.split(',').map(clean).filter(Boolean) : [...state.dragIds];
  }

  function bindDropTarget(target,handler) {
    target.addEventListener('dragover',event => {
      if (!state.dragIds.length) return;
      event.preventDefault();
      target.classList.add('drag-over');
    });
    target.addEventListener('dragleave',event => {
      if (event.relatedTarget && target.contains(event.relatedTarget)) return;
      target.classList.remove('drag-over');
    });
    target.addEventListener('drop',event => {
      event.preventDefault();
      event.stopPropagation();
      target.classList.remove('drag-over');
      const ids = idsFromDrop(event);
      state.dragIds = [];
      handler(ids);
    });
  }

  function bindOverrideDnd() {
    const alt = document.getElementById('fv-ticket-status-job-list');
    const left = document.getElementById('fv-unassigned-ticket-list');
    if (!alt || !left) return;

    alt.querySelectorAll('[data-fv-job-toggle]').forEach(button => {
      button.addEventListener('click',event => {
        event.preventDefault();
        event.stopPropagation();
        const id = clean(button.dataset.fvJobToggle);
        if (state.expandedJobs.has(id)) state.expandedJobs.delete(id);
        else state.expandedJobs.add(id);
        renderOverride();
      });
    });

    alt.querySelectorAll('[data-fv-status-check]').forEach(box => {
      box.addEventListener('change',() => {
        const id = clean(box.dataset.fvStatusCheck);
        if (box.checked) state.selected.add(id); else state.selected.delete(id);
      });
    });

    alt.querySelectorAll('[data-fv-status-ticket][data-ticket-id]').forEach(card => {
      card.addEventListener('dragstart',event => {
        const ids = dragSelection(card.dataset.ticketId);
        state.dragIds = ids;
        card.classList.add('dragging');
        event.dataTransfer.effectAllowed = 'move';
        try { event.dataTransfer.setData('text/plain',ids.join(',')); } catch(_) {}
      });
      card.addEventListener('dragend',() => {
        card.classList.remove('dragging');
        state.dragIds = [];
      });
      card.addEventListener('pointerdown',event => startTouch(card,event));
    });

    alt.querySelectorAll('[data-fv-status-job][data-fv-ticket-job-id]').forEach(card => {
      bindDropTarget(card,ids => assignTickets(ids,card.dataset.fvTicketJobId,{spot:false}));
    });
    alt.querySelectorAll('[data-fv-spot-job-id]').forEach(zone => {
      bindDropTarget(zone,ids => assignTickets(ids,zone.dataset.fvSpotJobId,{spot:true}));
    });

    if (left.dataset.fvStatusUnassignV4!=='1') {
      left.dataset.fvStatusUnassignV4='1';
      left.addEventListener('dragover',event => {
        if (state.mode==='matching' || !state.dragIds.length) return;
        event.preventDefault();
        left.classList.add('drag-over');
      });
      left.addEventListener('dragleave',() => left.classList.remove('drag-over'));
      left.addEventListener('drop',event => {
        if (state.mode==='matching') return;
        event.preventDefault();
        left.classList.remove('drag-over');
        const ids = idsFromDrop(event);
        state.dragIds=[];
        unassignTickets(ids);
      });
    }
  }

  function touchTarget(x,y) {
    const ghost = state.touch.ghost;
    if (ghost) ghost.style.display='none';
    const under = document.elementFromPoint(x,y);
    if (ghost) ghost.style.display='';
    return under?.closest?.('[data-fv-spot-job-id],[data-fv-status-job][data-fv-ticket-job-id],#fv-unassigned-ticket-list') || null;
  }
  function clearTouch() {
    if (state.touch.timer) clearTimeout(state.touch.timer);
    state.touch.timer=0;
    state.touch.source?.classList.remove('dragging');
    state.touch.target?.classList.remove('drag-over');
    state.touch.ghost?.remove();
    state.touch={timer:0,active:false,source:null,ghost:null,target:null,ids:[],startX:0,startY:0};
  }
  function startTouch(card,event) {
    if (state.mode==='matching' || event.pointerType==='mouse' || event.target.closest('input,button,a')) return;
    state.touch.startX=event.clientX;
    state.touch.startY=event.clientY;
    state.touch.timer=setTimeout(() => {
      state.touch.timer=0;
      state.touch.active=true;
      state.touch.source=card;
      state.touch.ids=dragSelection(card.dataset.ticketId);
      card.classList.add('dragging');
      const ghost=document.createElement('div');
      ghost.className='fv-ticket-drag-ghost';
      ghost.textContent=state.touch.ids.length>1 ? `${state.touch.ids.length} grain tickets` : `Ticket ${ticketNo(state.tickets.get(state.touch.ids[0]))}`;
      document.body.appendChild(ghost);
      state.touch.ghost=ghost;
      ghost.style.left=`${event.clientX}px`;
      ghost.style.top=`${event.clientY}px`;
      try { navigator.vibrate?.(18); } catch(_) {}
    },430);
  }

  document.addEventListener('pointermove',event => {
    if (!state.touch.active) {
      if (state.touch.timer && (Math.abs(event.clientX-state.touch.startX)>12 || Math.abs(event.clientY-state.touch.startY)>12)) clearTouch();
      return;
    }
    if (event.pointerType==='mouse') return;
    event.preventDefault();
    if (state.touch.ghost) {
      state.touch.ghost.style.left=`${event.clientX}px`;
      state.touch.ghost.style.top=`${event.clientY}px`;
    }
    const target=touchTarget(event.clientX,event.clientY);
    if (target!==state.touch.target) {
      state.touch.target?.classList.remove('drag-over');
      state.touch.target=target;
      target?.classList.add('drag-over');
    }
  },{passive:false,capture:true});

  document.addEventListener('pointerup',event => {
    if (!state.touch.active || event.pointerType==='mouse') return;
    const target=state.touch.target || touchTarget(event.clientX,event.clientY);
    const ids=[...state.touch.ids];
    const spotJobId=clean(target?.dataset?.fvSpotJobId);
    const jobId=clean(target?.dataset?.fvTicketJobId);
    const unassign=target?.id==='fv-unassigned-ticket-list';
    clearTouch();
    if (spotJobId) assignTickets(ids,spotJobId,{spot:true});
    else if (jobId) assignTickets(ids,jobId,{spot:false});
    else if (unassign) unassignTickets(ids);
  },{passive:true,capture:true});
  document.addEventListener('pointercancel',clearTouch,{passive:true,capture:true});

  function remainingClass(percent) {
    if (percent<5) return 'fv-remain-red';
    if (percent<35) return 'fv-remain-orange';
    return 'fv-remain-green';
  }
  function colorTable(bodyId,totalHeaders) {
    const body=document.getElementById(bodyId);
    const table=body?.closest('table');
    if (!body || !table) return;
    const headers=Array.from(table.querySelectorAll('thead th')).map(th => clean(th.textContent).toLowerCase().replace(/\s+/g,' '));
    const totalIndex=totalHeaders.map(h => headers.indexOf(h)).find(i => i>=0);
    const remainingIndex=headers.indexOf('remaining');
    if (totalIndex===undefined || totalIndex<0 || remainingIndex<0) return;
    Array.from(body.querySelectorAll('tr')).forEach(row => {
      const totalCell=row.cells[totalIndex];
      const remainingCell=row.cells[remainingIndex];
      if (!totalCell || !remainingCell) return;
      remainingCell.classList.remove('fv-remain-green','fv-remain-orange','fv-remain-red');
      remainingCell.style.setProperty('background','transparent','important');
      remainingCell.style.setProperty('background-color','transparent','important');
      remainingCell.style.setProperty('background-image','none','important');
      remainingCell.style.setProperty('box-shadow','none','important');
      const total=num(totalCell.textContent);
      const remaining=num(remainingCell.textContent);
      if (!(total>0)) return;
      const percent=Math.max(0,(remaining/total)*100);
      remainingCell.classList.add(remainingClass(percent));
      remainingCell.title=`${percent.toFixed(1)}% remaining`;
    });
  }
  function colorRemaining() {
    colorTable('hauling-jobs-table-body',['starting bu.','starting bu','starting']);
    colorTable('contracts-table-body',['contract bu.','contract bu','contracted']);
  }

  function queue() {
    if (state.queued) return;
    state.queued=true;
    requestAnimationFrame(async() => {
      state.queued=false;
      installStyle();
      const ready=ensureStatusUI();
      colorRemaining();
      if (!ready) return;
      if (state.mode!=='matching') {
        await load();
        renderOverride();
      }
    });
  }

  document.addEventListener('change',event => {
    if (['fv-ticket-filter-buyer','fv-ticket-filter-sold-under','fv-ticket-filter-crop'].includes(event.target?.id) && state.mode!=='matching') {
      load(true).then(renderOverride);
    }
  },true);
  document.addEventListener('click',event => {
    if (event.target.closest('#fv-refresh-ticket-hauling') && state.mode!=='matching') {
      setTimeout(() => load(true).then(renderOverride),200);
    }
  },true);

  new MutationObserver(records => {
    const relevant = records.some(record => {
      const target = record.target instanceof Element ? record.target : record.target?.parentElement;
      if (target?.closest?.('#fv-ticket-status-job-list')) return false;
      return true;
    });
    if (relevant) queue();
  }).observe(document.documentElement,{childList:true,subtree:true});

  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',queue,{once:true});
  else queue();
})();
