// FarmVista — Grain Contracts DND + hybrid workspace UX v5
// Sept. 11, 2026
//
// Existing file intentionally owns the Grain Contracts hybrid workspace:
//   • mobile long-press DND edge auto-scroll;
//   • remembered collapsible Contracts / Settlement / assignment sections;
//   • contextual Contract -> Hauling Job filtering;
//   • contextual Grain Ticket -> Hauling Job assignment and review.
//
// No new page or script is required. Hauling Job remains the parent record.

(() => {
  'use strict';

  if (window.__FV_GRAIN_DND_WORKSPACE_20260911_V5) return;
  window.__FV_GRAIN_DND_WORKSPACE_20260911_V5 = true;

  const clean = value => String(value ?? '').trim();
  const norm = value => clean(value).toLowerCase().replace(/[^a-z0-9]/g, '');
  const num = value => {
    const parsed = Number(String(value ?? '').replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const fmtBu = value => num(value).toLocaleString('en-US', { maximumFractionDigits:2 });
  const escapeHtml = value => clean(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  /* ======================================================================
     MOBILE / TOUCH EDGE AUTO-SCROLL
  ====================================================================== */

  const TOP_EDGE_PX = 180;
  const BOTTOM_EDGE_MIN_PX = 260;
  const BOTTOM_EDGE_RATIO = 0.40;
  const MIN_SPEED_PX = 10;
  const MAX_SPEED_PX = 52;

  const DRAG_SELECTOR = [
    '.hauling-contract-card.dragging',
    '.hauling-linked-contract-item.dragging',
    '.ticket-card.dragging',
    '[data-hauling-contract-id].dragging',
    '[data-ticket-id].dragging'
  ].join(',');

  let lastClientX = 0;
  let lastClientY = 0;
  let havePointer = false;
  let frame = 0;

  function dragSource() {
    return document.querySelector(DRAG_SELECTOR);
  }

  function viewportHeight() {
    return window.visualViewport?.height ||
      window.innerHeight ||
      document.documentElement.clientHeight ||
      0;
  }

  function bottomEdgePx(height) {
    return Math.min(
      Math.max(BOTTOM_EDGE_MIN_PX, height * BOTTOM_EDGE_RATIO),
      Math.max(BOTTOM_EDGE_MIN_PX, height - TOP_EDGE_PX - 80)
    );
  }

  function easedSpeed(strength) {
    const s = Math.min(1, Math.max(0, strength));
    return MIN_SPEED_PX + (MAX_SPEED_PX - MIN_SPEED_PX) * Math.sqrt(s);
  }

  function edgeSpeed() {
    if (!havePointer) return 0;
    const height = viewportHeight();
    if (!height) return 0;

    if (lastClientY < TOP_EDGE_PX) {
      return -easedSpeed((TOP_EDGE_PX - lastClientY) / TOP_EDGE_PX);
    }

    const zone = bottomEdgePx(height);
    const start = height - zone;
    return lastClientY > start
      ? easedSpeed((lastClientY - start) / zone)
      : 0;
  }

  function canScroll(element, direction) {
    if (!element) return false;
    const max = element.scrollHeight - element.clientHeight;
    if (max <= 1) return false;
    return direction < 0
      ? element.scrollTop > 0
      : element.scrollTop < max - 1;
  }

  function scrollableAncestor(start, direction) {
    let element = start instanceof Element ? start : null;

    while (
      element &&
      element !== document.body &&
      element !== document.documentElement
    ) {
      const style = window.getComputedStyle(element);
      if (
        /(auto|scroll|overlay)/.test(style.overflowY) &&
        canScroll(element, direction)
      ) {
        return element;
      }
      element = element.parentElement;
    }

    const root = document.scrollingElement || document.documentElement;
    return canScroll(root, direction) ? root : null;
  }

  function elementUnderFinger() {
    const height = viewportHeight();
    const x = Math.max(1, Math.min(lastClientX, Math.max(1, window.innerWidth - 1)));
    const y = Math.max(1, Math.min(lastClientY, Math.max(1, height - 1)));
    return document.elementFromPoint(x, y);
  }

  function refreshCoreDropTarget() {
    const source = dragSource();
    if (!source) return;

    try {
      source.dispatchEvent(new PointerEvent('pointermove', {
        bubbles:true,
        cancelable:true,
        pointerType:'touch',
        clientX:lastClientX,
        clientY:lastClientY
      }));
    } catch (_) {}
  }

  function tick() {
    frame = 0;
    if (!dragSource()) return;

    const speed = edgeSpeed();
    if (speed) {
      const target =
        scrollableAncestor(elementUnderFinger(), speed) ||
        scrollableAncestor(dragSource(), speed);

      if (target) {
        const before = target.scrollTop;
        target.scrollTop += speed;
        if (target.scrollTop !== before) refreshCoreDropTarget();
      }
    }

    frame = requestAnimationFrame(tick);
  }

  function ensureRunning() {
    if (!frame && dragSource()) frame = requestAnimationFrame(tick);
  }

  function rememberPointer(x, y) {
    lastClientX = x;
    lastClientY = y;
    havePointer = true;
    ensureRunning();
  }

  function stopScroll() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  }

  document.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'mouse') rememberPointer(event.clientX, event.clientY);
  }, { passive:true, capture:true });

  document.addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse') rememberPointer(event.clientX, event.clientY);
  }, { passive:true, capture:true });

  document.addEventListener('touchstart', event => {
    const touch = event.touches?.[0];
    if (touch) rememberPointer(touch.clientX, touch.clientY);
  }, { passive:true, capture:true });

  document.addEventListener('touchmove', event => {
    const touch = event.touches?.[0];
    if (touch) rememberPointer(touch.clientX, touch.clientY);
  }, { passive:true, capture:true });

  [
    'pointerup','pointercancel','touchend','touchcancel','drop','dragend'
  ].forEach(type => {
    document.addEventListener(type, stopScroll, { passive:true, capture:true });
  });

  window.addEventListener('blur', stopScroll, { passive:true });

  /* ======================================================================
     HYBRID WORKSPACE STATE
  ====================================================================== */

  const ui = {
    uid:'local',
    activeContractId:'',
    contextSuppressed:false,
    activeTicketId:'',
    contracts:new Map(),
    jobs:new Map(),
    tickets:new Map(),
    dataPromise:null,
    renderQueued:false,
    ticketRenderQueued:false,
    selectedTicketIds:new Set(),
    dragTicketIds:[],
    ticketBusy:false,
    touchTicket:{
      timer:null,
      active:false,
      source:null,
      ghost:null,
      target:null,
      ids:[],
      startX:0,
      startY:0
    }
  };

  function injectStyle() {
    if (document.getElementById('fv-grain-hybrid-workspace-style')) return;

    const style = document.createElement('style');
    style.id = 'fv-grain-hybrid-workspace-style';
    style.textContent = `
      .fv-workflow-collapsible-head{cursor:pointer;user-select:none}
      .fv-workflow-collapsible-head:focus-visible{outline:3px solid rgba(59,126,70,.35);outline-offset:2px}
      .fv-collapse-chevron{flex:0 0 auto;width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;border-radius:999px;font-size:1.05rem;font-weight:900;opacity:.72;transition:transform .16s ease}
      .fv-workflow-collapsible-head[aria-expanded="true"] .fv-collapse-chevron{transform:rotate(90deg)}
      .fv-workflow-collapsed.workflow-group>:not(.workflow-group-head),
      .workflow-block.fv-workflow-collapsed>:not(.workflow-block-head){display:none!important}
      .fv-workflow-collapsed.workflow-group>.workflow-group-head,
      .workflow-block.fv-workflow-collapsed>.workflow-block-head{border-bottom:0!important;margin-bottom:0!important}
      .hauling-contract-card.fv-context-selected{border-color:#3B7E46!important;box-shadow:0 0 0 2px rgba(59,126,70,.16)}
      .hauling-job-drop-card.fv-context-hidden{display:none!important}
      #hauling-job-drop-list.fv-context-active{min-height:180px}

      #fv-ticket-hauling-block .fv-ticket-hauling-body{padding-top:0}
      .fv-ticket-hauling-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;margin-top:14px}
      .fv-ticket-hauling-column{min-width:0;border:1px solid var(--border,#d4d4d4);border-radius:11px;overflow:hidden;background:var(--surface,#fff)}
      .fv-ticket-hauling-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;background:var(--surface-2,#f3f3f3);border-bottom:1px solid var(--border,#d4d4d4);font-weight:800}
      .fv-ticket-hauling-count{font-size:.8rem;opacity:.65;white-space:nowrap}
      .fv-ticket-hauling-list{min-height:220px;padding:10px}
      .fv-ticket-hauling-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:14px;padding:9px 11px;border:1px solid var(--border,#ddd);border-radius:10px;background:var(--surface-2,#f5f5f5)}
      .fv-ticket-hauling-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .fv-ticket-hauling-selection{font-size:.82rem;font-weight:700;opacity:.72}
      .fv-hauling-ticket-card{display:grid;grid-template-columns:auto minmax(0,1fr);gap:9px;align-items:start;padding:10px;border:1px solid var(--border,#d4d4d4);border-radius:9px;background:var(--surface,#fff);margin-bottom:8px;cursor:grab;touch-action:pan-y}
      .fv-hauling-ticket-card:last-child{margin-bottom:0}
      .fv-hauling-ticket-card.fv-active-ticket{border-color:#3B7E46;box-shadow:0 0 0 2px rgba(59,126,70,.14)}
      .fv-hauling-ticket-card.dragging{opacity:.42}
      .fv-hauling-ticket-card.fv-contract-locked{cursor:default;opacity:.82}
      .fv-hauling-ticket-title{display:flex;justify-content:space-between;gap:8px;font-weight:800}
      .fv-hauling-ticket-meta{font-size:.78rem;opacity:.72;line-height:1.4;margin-top:4px}
      .fv-hauling-ticket-lock{margin-top:5px;font-size:.72rem;font-weight:800;color:#8a6200}
      .fv-ticket-select{width:17px;height:17px;margin-top:2px}
      .fv-ticket-job-card{padding:12px;border:2px dashed var(--border,#c8c8c8);border-radius:10px;background:var(--surface,#fff);margin-bottom:10px}
      .fv-ticket-job-card:last-child{margin-bottom:0}
      .fv-ticket-job-card.drag-over{border-color:#3B7E46;background:rgba(59,126,70,.08)}
      .fv-ticket-job-title{font-weight:800}
      .fv-ticket-job-meta{font-size:.78rem;opacity:.72;line-height:1.4;margin-top:4px}
      .fv-ticket-job-linked{margin-top:9px;padding-top:8px;border-top:1px solid var(--border,#ddd)}
      .fv-ticket-job-linked-label{font-size:.72rem;font-weight:800;opacity:.65;margin-bottom:5px}
      .fv-ticket-job-empty{font-size:.74rem;opacity:.58;margin-top:7px}
      #fv-unassigned-ticket-list.fv-drop-unassign{outline:2px dashed #b3261e;outline-offset:-5px;background:rgba(179,38,30,.05)}
      #fv-unassigned-ticket-list.drag-over{outline:3px solid #b3261e;outline-offset:-5px;background:rgba(179,38,30,.08)}
      .fv-ticket-drag-ghost{position:fixed;z-index:999999;pointer-events:none;max-width:290px;padding:10px 12px;border-radius:9px;background:var(--surface,#fff);border:2px solid #3B7E46;box-shadow:0 8px 26px rgba(0,0,0,.24);font-weight:800;transform:translate(-50%,-50%)}
      .fv-ticket-context-message{margin-top:10px;padding:8px 11px;border-radius:9px;background:var(--surface-2,#f2f2f2);font-size:.82rem;font-weight:700}
      .fv-ticket-context-message.ready{background:rgba(59,126,70,.12);color:#2f6e39}
      .fv-ticket-empty{padding:26px 16px;text-align:center;opacity:.66}
      .fv-ticket-empty-title{font-weight:800;margin-bottom:4px}
      .fv-ticket-empty-sub{font-size:.8rem;line-height:1.4}
      @media(max-width:760px){.fv-ticket-hauling-grid{grid-template-columns:1fr}.fv-ticket-hauling-list{min-height:160px}}
    `;
    document.head.appendChild(style);
  }

  function storageKey(name) {
    return `fv:grain-contracts:${ui.uid}:${name}`;
  }

  function readCollapsed(name, defaultValue = true) {
    try {
      const value = localStorage.getItem(storageKey(name));
      if (value === 'expanded') return false;
      if (value === 'collapsed') return true;
    } catch (_) {}
    return defaultValue;
  }

  function saveCollapsed(name, collapsed) {
    try {
      localStorage.setItem(storageKey(name), collapsed ? 'collapsed' : 'expanded');
    } catch (_) {}
  }

  function applyCollapsed(container, head, collapsed) {
    if (!container || !head) return;
    container.classList.toggle('fv-workflow-collapsed', collapsed);
    head.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }

  function makeCollapsible(container, head, stateName) {
    if (!container || !head || head.dataset.fvCollapsible === '1') return;

    head.dataset.fvCollapsible = '1';
    head.classList.add('fv-workflow-collapsible-head');
    head.setAttribute('role', 'button');
    head.setAttribute('tabindex', '0');

    const title = head.querySelector('.workflow-group-title,.workflow-block-title,h2,h3');
    if (title?.textContent) {
      head.setAttribute('aria-label', `Expand or collapse ${clean(title.textContent)}`);
    }

    const chevron = document.createElement('span');
    chevron.className = 'fv-collapse-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = '›';
    head.appendChild(chevron);

    applyCollapsed(container, head, readCollapsed(stateName, true));

    const toggle = event => {
      if (event?.target?.closest?.('button,a,input,select,textarea,label')) return;
      const collapsed = !container.classList.contains('fv-workflow-collapsed');
      applyCollapsed(container, head, collapsed);
      saveCollapsed(stateName, collapsed);
      if (!collapsed && container.id === 'fv-ticket-hauling-block') queueTicketRender();
    };

    head.addEventListener('click', toggle);
    head.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      toggle(event);
    });
  }

  function findBlock(titleText) {
    return Array.from(document.querySelectorAll('.workflow-block')).find(block =>
      norm(block.querySelector('.workflow-block-title')?.textContent) === norm(titleText)
    ) || null;
  }

  function installTicketHaulingBlock() {
    if (document.getElementById('fv-ticket-hauling-block')) return;

    const assignContracts = findBlock('Assign Contracts to Hauling Jobs');
    if (!assignContracts?.parentElement) return;

    const block = document.createElement('div');
    block.className = 'workflow-block';
    block.id = 'fv-ticket-hauling-block';
    block.innerHTML = `
      <div class="workflow-block-head">
        <div>
          <h3 class="workflow-block-title">Assign Grain Tickets to Hauling Jobs</h3>
          <div class="workflow-block-copy">Review loads by hauling job. Unassigned tickets stay on the left; the matching hauling jobs and their assigned tickets stay on the right.</div>
        </div>
      </div>
      <div class="fv-ticket-hauling-body">
        <div class="fv-ticket-hauling-toolbar">
          <div class="fv-ticket-hauling-tools">
            <button type="button" class="btn btn-secondary btn-small" id="fv-select-all-hauling-tickets">Select All</button>
            <button type="button" class="btn btn-secondary btn-small" id="fv-clear-hauling-tickets">Clear</button>
            <span class="fv-ticket-hauling-selection" id="fv-ticket-hauling-selection">0 selected</span>
          </div>
          <button type="button" class="btn btn-secondary btn-small" id="fv-refresh-ticket-hauling">Refresh</button>
        </div>
        <div class="fv-ticket-context-message" id="fv-ticket-hauling-message">Select or drag a ticket to show only compatible hauling jobs.</div>
        <div class="fv-ticket-hauling-grid">
          <div class="fv-ticket-hauling-column">
            <div class="fv-ticket-hauling-head"><span>Unassigned Grain Tickets</span><span class="fv-ticket-hauling-count" id="fv-unassigned-ticket-count">0 tickets</span></div>
            <div class="fv-ticket-hauling-list" id="fv-unassigned-ticket-list"></div>
          </div>
          <div class="fv-ticket-hauling-column">
            <div class="fv-ticket-hauling-head"><span>Hauling Jobs</span><span class="fv-ticket-hauling-count" id="fv-ticket-job-count">0 jobs</span></div>
            <div class="fv-ticket-hauling-list" id="fv-ticket-job-list"></div>
          </div>
        </div>
      </div>`;

    assignContracts.parentElement.insertBefore(block, assignContracts);
    wireTicketWorkspaceControls();
  }

  function setupCollapsibles() {
    injectStyle();
    installTicketHaulingBlock();

    const contracts = document.querySelector('.workflow-group.grain-ticket-group');
    const settlement = document.querySelector('.workflow-group.settlement-group');
    const assignTickets = document.getElementById('fv-ticket-hauling-block');
    const assignContracts = findBlock('Assign Contracts to Hauling Jobs');

    makeCollapsible(contracts, contracts?.querySelector(':scope>.workflow-group-head'), 'contracts-section');
    makeCollapsible(settlement, settlement?.querySelector(':scope>.workflow-group-head'), 'settlement-section');
    makeCollapsible(assignTickets, assignTickets?.querySelector(':scope>.workflow-block-head'), 'ticket-hauling-assignment');
    makeCollapsible(assignContracts, assignContracts?.querySelector(':scope>.workflow-block-head'), 'contract-hauling-assignment');
  }

  function reapplyRememberedState() {
    const contracts = document.querySelector('.workflow-group.grain-ticket-group');
    const settlement = document.querySelector('.workflow-group.settlement-group');
    const assignTickets = document.getElementById('fv-ticket-hauling-block');
    const assignContracts = findBlock('Assign Contracts to Hauling Jobs');

    [
      [contracts, contracts?.querySelector(':scope>.workflow-group-head'), 'contracts-section'],
      [settlement, settlement?.querySelector(':scope>.workflow-group-head'), 'settlement-section'],
      [assignTickets, assignTickets?.querySelector(':scope>.workflow-block-head'), 'ticket-hauling-assignment'],
      [assignContracts, assignContracts?.querySelector(':scope>.workflow-block-head'), 'contract-hauling-assignment']
    ].forEach(([container, head, key]) => {
      if (container && head) applyCollapsed(container, head, readCollapsed(key, true));
    });
  }

  async function resolveUser() {
    try {
      const firebase = await import('/js/firebase-init.js');
      await firebase.ready;
      ui.uid = clean(firebase.getAuth()?.currentUser?.uid) || 'local';
    } catch (_) {
      ui.uid = 'local';
    }
    reapplyRememberedState();
  }

  /* ======================================================================
     SHARED DATA / MATCHING
  ====================================================================== */

  function cropKey(value) {
    const key = norm(value);
    if (key === 'corn' || key === 'yellowcorn') return 'corn';
    if (['soy','soybean','soybeans','bean','beans'].includes(key)) return 'soybeans';
    return key;
  }

  function contractRecord(snapshot) {
    const data = snapshot.data() || {};
    return {
      id:snapshot.id,
      buyerId:clean(data.buyerId || data.grainBuyerId),
      buyerName:clean(data.buyerName),
      locationId:clean(data.deliveryLocationId || data.locationId || data.destinationId),
      locationName:clean(data.deliveryLocationName || data.locationName || data.destinationName),
      crop:cropKey(data.crop || data.commodity)
    };
  }

  function jobRecord(snapshot) {
    const data = snapshot.data() || {};
    const buyerName = clean(data.buyerName || data.buyer);
    const locationName = clean(data.deliveryLocationName || data.locationName || data.destinationName || data.destination);
    const bushels = num(data.startingBushels ?? data.jobBushels ?? data.bushels);
    return {
      id:snapshot.id,
      buyerId:clean(data.buyerId || data.grainBuyerId),
      buyerName,
      locationId:clean(data.deliveryLocationId || data.locationId || data.destinationId),
      locationName,
      crop:cropKey(data.crop || data.commodity || data.cropName || data.cropType),
      cropLabel:clean(data.crop || data.commodity || data.cropName || data.cropType),
      bushels,
      startDate:clean(data.deliveryStartDate || data.startDate),
      endDate:clean(data.deliveryEndDate || data.endDate),
      status:norm(data.status),
      active:data.active !== false,
      name:clean(data.displayName || data.jobName || data.haulingJobName) || `${buyerName || locationName || 'Hauling Job'} — ${fmtBu(bushels)} bu`
    };
  }

  function ticketHasContract(data) {
    if (clean(data.contractId || data.grainContractId || data.contractNumber)) return true;
    const groups = [data.allocations, data.contractAllocations, data.contractAssignments];
    return groups.some(group => Array.isArray(group) && group.some(item =>
      clean(item?.contractId || item?.grainContractId || item?.contractNumber)
    ));
  }

  function ticketRecord(snapshot) {
    const data = snapshot.data() || {};
    const ticketNo = clean(data.ticketNumber || data.ticketNo || data.ticket || data.number) || snapshot.id;
    const buyerName = clean(data.buyerName || data.destinationBuyerName || data.elevatorName);
    const locationName = clean(data.deliveryLocationName || data.locationName || data.destinationName || data.destination || data.elevator);
    const voided = data.voided === true || norm(data.status).includes('void');
    return {
      id:snapshot.id,
      number:ticketNo,
      date:clean(data.ticketDate || data.date || data.deliveryDate),
      buyerId:clean(data.buyerId || data.grainBuyerId || data.destinationBuyerId),
      buyerName,
      locationId:clean(data.deliveryLocationId || data.locationId || data.destinationId),
      locationName,
      crop:cropKey(data.crop || data.commodity || data.grain || data.cropName),
      cropLabel:clean(data.crop || data.commodity || data.grain || data.cropName),
      bushels:num(data.netBushels ?? data.netBu ?? data.bushels),
      haulingJobId:clean(data.haulingJobId),
      haulingJobName:clean(data.haulingJobName),
      contractLocked:ticketHasContract(data),
      voided,
      raw:data
    };
  }

  async function loadContextData(force = false) {
    if (ui.dataPromise && !force) return ui.dataPromise;

    ui.dataPromise = (async () => {
      try {
        const firebase = await import('/js/firebase-init.js');
        await firebase.ready;
        const db = firebase.getFirestore();
        const [contracts, jobs, tickets] = await Promise.all([
          firebase.getDocs(firebase.collection(db, 'grain_contracts')),
          firebase.getDocs(firebase.collection(db, 'grain_hauling_jobs')),
          firebase.getDocs(firebase.collection(db, 'grain_tickets'))
        ]);

        ui.contracts = new Map(contracts.docs.map(snapshot => {
          const item = contractRecord(snapshot);
          return [item.id, item];
        }));

        ui.jobs = new Map(jobs.docs.map(snapshot => {
          const item = jobRecord(snapshot);
          return [item.id, item];
        }));

        ui.tickets = new Map(tickets.docs.map(snapshot => {
          const item = ticketRecord(snapshot);
          return [item.id, item];
        }));
      } catch (error) {
        console.warn('[Grain DND] hybrid workspace data unavailable:', error);
      }
    })();

    return ui.dataPromise;
  }

  function idsOrNamesMatch(aId, aName, bId, bName) {
    if (aId && bId) return aId === bId;
    if (aName && bName) return norm(aName) === norm(bName);
    return true;
  }

  function recordsMatch(contract, job) {
    if (!contract || !job) return true;
    if (!idsOrNamesMatch(contract.buyerId, contract.buyerName, job.buyerId, job.buyerName)) return false;
    if (!idsOrNamesMatch(contract.locationId, contract.locationName, job.locationId, job.locationName)) return false;
    if (contract.crop && job.crop && contract.crop !== job.crop) return false;
    return true;
  }

  function ticketMatchesJob(ticket, job) {
    if (!ticket || !job) return true;
    if (!idsOrNamesMatch(ticket.buyerId, ticket.buyerName, job.buyerId, job.buyerName)) return false;
    if (!idsOrNamesMatch(ticket.locationId, ticket.locationName, job.locationId, job.locationName)) return false;
    if (ticket.crop && job.crop && ticket.crop !== job.crop) return false;
    return true;
  }

  function jobIsOpen(job) {
    return !!job && job.active !== false && !['voided','closed','cancelled','canceled'].some(key => job.status.includes(key));
  }

  /* ======================================================================
     CONTEXTUAL CONTRACT -> HAULING JOB FILTER
  ====================================================================== */

  function contextLabel(contract) {
    if (!contract) return '';
    const crop = contract.crop === 'corn' ? 'Corn' : (contract.crop === 'soybeans' ? 'Soybeans' : contract.crop);
    return [contract.buyerName, contract.locationName, crop].filter(Boolean).join(' • ');
  }

  function markSelectedContract() {
    document.querySelectorAll('#hauling-unlinked-contract-list .hauling-contract-card[data-hauling-contract-id]').forEach(card => {
      card.classList.toggle('fv-context-selected', clean(card.dataset.haulingContractId) === ui.activeContractId);
    });
  }

  function showContextualJobs() {
    const list = document.getElementById('hauling-job-drop-list');
    if (!list) return;

    const contract = ui.contracts.get(ui.activeContractId);
    const cards = Array.from(list.querySelectorAll('.hauling-job-drop-card[data-hauling-job-drop-id]'));

    if (!contract || !ui.activeContractId || ui.contextSuppressed) {
      cards.forEach(card => card.classList.remove('fv-context-hidden'));
      list.classList.remove('fv-context-active');
      return;
    }

    cards.forEach(card => {
      const job = ui.jobs.get(clean(card.dataset.haulingJobDropId));
      card.classList.toggle('fv-context-hidden', !recordsMatch(contract, job));
    });

    list.classList.add('fv-context-active');
    const visible = cards.filter(card => !card.classList.contains('fv-context-hidden')).length;
    const count = document.getElementById('hauling-link-job-count');
    if (count) count.textContent = `${visible} job${visible === 1 ? '' : 's'}`;

    const label = contextLabel(contract);
    const message = document.getElementById('hauling-link-message');
    if (message && label) {
      message.textContent = `Showing hauling jobs matching ${label}. Drag the contract onto the correct hauling job.`;
      message.classList.add('ready');
    }
  }

  function queueContextRender() {
    if (ui.renderQueued) return;
    ui.renderQueued = true;
    requestAnimationFrame(() => {
      ui.renderQueued = false;
      markSelectedContract();
      showContextualJobs();
    });
  }

  async function activateContract(contractId) {
    const id = clean(contractId);
    if (!id) return;
    ui.contextSuppressed = false;
    await loadContextData();
    if (!ui.contracts.has(id)) return;
    ui.activeContractId = id;
    queueContextRender();
  }

  function autoActivateSingleContract() {
    if (ui.activeContractId || ui.contextSuppressed) return;
    const cards = Array.from(document.querySelectorAll('#hauling-unlinked-contract-list .hauling-contract-card[data-hauling-contract-id]'));
    if (cards.length === 1) activateContract(cards[0].dataset.haulingContractId);
  }

  function wireContextualDnd() {
    document.addEventListener('click', event => {
      const card = event.target.closest?.('#hauling-unlinked-contract-list .hauling-contract-card[data-hauling-contract-id]');
      if (card) activateContract(card.dataset.haulingContractId);
    }, true);

    document.addEventListener('dragstart', event => {
      const card = event.target.closest?.('#hauling-unlinked-contract-list .hauling-contract-card[data-hauling-contract-id]');
      if (card) activateContract(card.dataset.haulingContractId);
    }, true);

    document.addEventListener('change', event => {
      if (!['hauling-link-buyer','hauling-link-customer','hauling-link-crop'].includes(event.target?.id)) return;
      ui.contextSuppressed = true;
      ui.activeContractId = '';
      queueContextRender();
    }, true);
  }

  /* ======================================================================
     GRAIN TICKET -> HAULING JOB WORKSPACE
  ====================================================================== */

  function ticketLabel(ticket) {
    if (!ticket) return '';
    const crop = ticket.crop === 'corn' ? 'Corn' : (ticket.crop === 'soybeans' ? 'Soybeans' : ticket.cropLabel || ticket.crop);
    return [ticket.buyerName, ticket.locationName, crop].filter(Boolean).join(' • ');
  }

  function visibleUnassignedTickets() {
    return Array.from(ui.tickets.values())
      .filter(ticket => !ticket.voided && !ticket.haulingJobId)
      .sort((a,b) => clean(b.date).localeCompare(clean(a.date)) || a.number.localeCompare(b.number, undefined, { numeric:true, sensitivity:'base' }));
  }

  function ticketsForJob(jobId) {
    return Array.from(ui.tickets.values())
      .filter(ticket => !ticket.voided && ticket.haulingJobId === clean(jobId))
      .sort((a,b) => clean(b.date).localeCompare(clean(a.date)) || a.number.localeCompare(b.number, undefined, { numeric:true, sensitivity:'base' }));
  }

  function eligibleTicketIds(ids) {
    return Array.from(new Set(ids.map(clean).filter(Boolean))).filter(id => {
      const ticket = ui.tickets.get(id);
      return ticket && !ticket.voided && !ticket.contractLocked;
    });
  }

  function currentDragTicketIds(sourceId) {
    const source = clean(sourceId);
    if (ui.selectedTicketIds.has(source)) {
      const selected = eligibleTicketIds(Array.from(ui.selectedTicketIds));
      if (selected.length) return selected;
    }
    return eligibleTicketIds([source]);
  }

  function updateTicketSelectionText() {
    const eligible = eligibleTicketIds(Array.from(ui.selectedTicketIds));
    const label = document.getElementById('fv-ticket-hauling-selection');
    if (label) label.textContent = `${eligible.length} selected`;
  }

  function ticketCardMarkup(ticket, linked = false) {
    const locked = ticket.contractLocked;
    const selected = ui.selectedTicketIds.has(ticket.id);
    return `
      <div class="fv-hauling-ticket-card${ui.activeTicketId === ticket.id ? ' fv-active-ticket' : ''}${locked ? ' fv-contract-locked' : ''}"
           data-ticket-id="${escapeHtml(ticket.id)}"
           draggable="${locked ? 'false' : 'true'}">
        <input class="fv-ticket-select" type="checkbox" data-fv-ticket-check="${escapeHtml(ticket.id)}" ${selected ? 'checked' : ''} ${locked ? 'disabled' : ''} aria-label="Select ticket ${escapeHtml(ticket.number)}">
        <div>
          <div class="fv-hauling-ticket-title"><span>Ticket ${escapeHtml(ticket.number)}</span><span>${fmtBu(ticket.bushels)} bu</span></div>
          <div class="fv-hauling-ticket-meta">${escapeHtml(ticket.date || 'No date')} • ${escapeHtml(ticket.cropLabel || ticket.crop || 'Unknown crop')}<br>${escapeHtml(ticket.buyerName || ticket.locationName || 'Unknown destination')}${ticket.locationName && ticket.buyerName ? ` • ${escapeHtml(ticket.locationName)}` : ''}</div>
          ${locked ? '<div class="fv-hauling-ticket-lock">Assigned to a grain contract — move it in the Grain Contracts section.</div>' : (linked ? '<div class="fv-hauling-ticket-lock" style="color:inherit;opacity:.62">Drag left to unassign or onto another compatible job.</div>' : '')}
        </div>
      </div>`;
  }

  function jobCardMarkup(job) {
    const linked = ticketsForJob(job.id);
    const ticketed = linked.reduce((sum,ticket) => sum + ticket.bushels, 0);
    return `
      <div class="fv-ticket-job-card" data-fv-ticket-job-id="${escapeHtml(job.id)}">
        <div class="fv-ticket-job-title">${escapeHtml(job.name)}</div>
        <div class="fv-ticket-job-meta">${escapeHtml(job.buyerName || 'Unknown buyer')} • ${escapeHtml(job.locationName || 'Unknown location')} • ${escapeHtml(job.cropLabel || job.crop || 'Unknown crop')}<br>${fmtBu(ticketed)} bu ticketed • ${linked.length} ticket${linked.length === 1 ? '' : 's'}</div>
        ${linked.length ? `<div class="fv-ticket-job-linked"><div class="fv-ticket-job-linked-label">Assigned Tickets</div>${linked.map(ticket => ticketCardMarkup(ticket, true)).join('')}</div>` : '<div class="fv-ticket-job-empty">No tickets assigned yet.</div>'}
      </div>`;
  }

  function renderTicketWorkspace() {
    const block = document.getElementById('fv-ticket-hauling-block');
    const left = document.getElementById('fv-unassigned-ticket-list');
    const right = document.getElementById('fv-ticket-job-list');
    if (!block || !left || !right) return;

    const unassigned = visibleUnassignedTickets();
    if (ui.activeTicketId && !ui.tickets.has(ui.activeTicketId)) ui.activeTicketId = '';
    if (!ui.activeTicketId && unassigned.length === 1) ui.activeTicketId = unassigned[0].id;

    document.getElementById('fv-unassigned-ticket-count').textContent = `${unassigned.length} ticket${unassigned.length === 1 ? '' : 's'}`;
    left.innerHTML = unassigned.length
      ? unassigned.map(ticket => ticketCardMarkup(ticket, false)).join('')
      : '<div class="fv-ticket-empty"><div class="fv-ticket-empty-title">No Unassigned Tickets</div><div class="fv-ticket-empty-sub">All current grain tickets have a hauling job.</div></div>';

    const activeTicket = ui.tickets.get(ui.activeTicketId) || null;
    let jobs = Array.from(ui.jobs.values()).filter(jobIsOpen);

    if (activeTicket) {
      jobs = jobs.filter(job => ticketMatchesJob(activeTicket, job));
    } else if (!unassigned.length) {
      jobs = jobs.filter(job => ticketsForJob(job.id).length > 0);
    } else {
      jobs = [];
    }

    jobs.sort((a,b) => clean(a.startDate).localeCompare(clean(b.startDate)) || a.name.localeCompare(b.name, undefined, { numeric:true, sensitivity:'base' }));
    document.getElementById('fv-ticket-job-count').textContent = `${jobs.length} job${jobs.length === 1 ? '' : 's'}`;
    right.innerHTML = jobs.length
      ? jobs.map(jobCardMarkup).join('')
      : `<div class="fv-ticket-empty"><div class="fv-ticket-empty-title">${activeTicket ? 'No Compatible Hauling Jobs' : (unassigned.length ? 'Select a Ticket' : 'No Assigned Hauling Jobs')}</div><div class="fv-ticket-empty-sub">${activeTicket ? 'No open hauling job matches this ticket\'s destination and crop.' : (unassigned.length ? 'The ticket on the left determines which hauling jobs appear here.' : 'There are no hauling jobs with assigned tickets to show.')}</div></div>`;

    const message = document.getElementById('fv-ticket-hauling-message');
    if (message) {
      if (activeTicket) {
        const label = ticketLabel(activeTicket);
        message.textContent = label ? `Showing hauling jobs matching ${label}.` : 'Showing hauling jobs compatible with the selected ticket.';
        message.classList.add('ready');
      } else if (unassigned.length) {
        message.textContent = 'Select or drag a ticket to show only compatible hauling jobs.';
        message.classList.remove('ready');
      } else {
        message.textContent = 'Showing hauling jobs that already have grain tickets assigned.';
        message.classList.add('ready');
      }
    }

    left.classList.toggle('fv-drop-unassign', ui.dragTicketIds.some(id => ui.tickets.get(id)?.haulingJobId));
    updateTicketSelectionText();
    bindTicketWorkspaceDnd();
  }

  function queueTicketRender() {
    if (ui.ticketRenderQueued) return;
    ui.ticketRenderQueued = true;
    requestAnimationFrame(() => {
      ui.ticketRenderQueued = false;
      renderTicketWorkspace();
    });
  }

  async function refreshTicketWorkspace(force = true) {
    ui.dataPromise = null;
    await loadContextData(force);
    ui.selectedTicketIds.forEach(id => {
      if (!ui.tickets.has(id) || ui.tickets.get(id)?.contractLocked) ui.selectedTicketIds.delete(id);
    });
    queueTicketRender();
  }

  async function assignTicketsToJob(ids, jobId) {
    const ticketIds = eligibleTicketIds(ids);
    const job = ui.jobs.get(clean(jobId));
    if (!ticketIds.length || !job || ui.ticketBusy) return;

    const invalid = ticketIds.some(id => !ticketMatchesJob(ui.tickets.get(id), job));
    if (invalid) {
      alert('One or more selected tickets do not match this hauling job\'s destination or crop.');
      return;
    }

    ui.ticketBusy = true;
    try {
      const firebase = await import('/js/firebase-init.js');
      await firebase.ready;
      const db = firebase.getFirestore();
      await Promise.all(ticketIds.map(id => firebase.updateDoc(
        firebase.doc(db, 'grain_tickets', id),
        {
          haulingJobId:job.id,
          haulingJobName:job.name,
          updatedAt:firebase.serverTimestamp()
        }
      )));

      ticketIds.forEach(id => {
        const ticket = ui.tickets.get(id);
        if (ticket) {
          ticket.haulingJobId = job.id;
          ticket.haulingJobName = job.name;
        }
        ui.selectedTicketIds.delete(id);
      });
      ui.activeTicketId = '';
      queueTicketRender();
      document.getElementById('refresh-hauling-link-btn')?.click();
    } catch (error) {
      console.error('[Grain DND] ticket -> hauling job failed:', error);
      alert(error?.message || 'FarmVista could not assign the grain ticket to that hauling job.');
    } finally {
      ui.ticketBusy = false;
    }
  }

  async function unassignTickets(ids) {
    const ticketIds = eligibleTicketIds(ids).filter(id => ui.tickets.get(id)?.haulingJobId);
    if (!ticketIds.length || ui.ticketBusy) return;

    ui.ticketBusy = true;
    try {
      const firebase = await import('/js/firebase-init.js');
      await firebase.ready;
      const db = firebase.getFirestore();
      await Promise.all(ticketIds.map(id => firebase.updateDoc(
        firebase.doc(db, 'grain_tickets', id),
        {
          haulingJobId:null,
          haulingJobName:null,
          updatedAt:firebase.serverTimestamp()
        }
      )));

      ticketIds.forEach(id => {
        const ticket = ui.tickets.get(id);
        if (ticket) {
          ticket.haulingJobId = '';
          ticket.haulingJobName = '';
        }
        ui.selectedTicketIds.delete(id);
      });
      ui.activeTicketId = ticketIds.length === 1 ? ticketIds[0] : '';
      queueTicketRender();
      document.getElementById('refresh-hauling-link-btn')?.click();
    } catch (error) {
      console.error('[Grain DND] hauling job ticket unlink failed:', error);
      alert(error?.message || 'FarmVista could not unassign that grain ticket.');
    } finally {
      ui.ticketBusy = false;
    }
  }

  function clearTicketDragClasses() {
    document.querySelectorAll('#fv-ticket-hauling-block .drag-over').forEach(node => node.classList.remove('drag-over'));
    document.querySelectorAll('#fv-ticket-hauling-block .dragging').forEach(node => node.classList.remove('dragging'));
    document.getElementById('fv-unassigned-ticket-list')?.classList.remove('fv-drop-unassign');
    ui.dragTicketIds = [];
  }

  function beginDesktopTicketDrag(card, event) {
    const id = clean(card?.dataset.ticketId);
    const ticket = ui.tickets.get(id);
    if (!id || !ticket || ticket.contractLocked) {
      event.preventDefault();
      return;
    }

    ui.activeTicketId = id;
    ui.dragTicketIds = currentDragTicketIds(id);
    card.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
    try { event.dataTransfer.setData('text/plain', id); } catch (_) {}
    queueTicketRender();
  }

  function bindTicketWorkspaceDnd() {
    const block = document.getElementById('fv-ticket-hauling-block');
    if (!block) return;

    block.querySelectorAll('.fv-hauling-ticket-card[data-ticket-id]').forEach(card => {
      if (card.dataset.fvTicketDnd === '1') return;
      card.dataset.fvTicketDnd = '1';

      card.addEventListener('click', event => {
        if (event.target.closest('input')) return;
        const id = clean(card.dataset.ticketId);
        if (!id) return;
        ui.activeTicketId = id;
        queueTicketRender();
      });

      card.addEventListener('dragstart', event => beginDesktopTicketDrag(card, event));
      card.addEventListener('dragend', clearTicketDragClasses);
      card.addEventListener('pointerdown', event => startTouchTicketDrag(card, event));
    });

    block.querySelectorAll('.fv-ticket-job-card[data-fv-ticket-job-id]').forEach(card => {
      if (card.dataset.fvTicketDrop === '1') return;
      card.dataset.fvTicketDrop = '1';
      card.addEventListener('dragover', event => {
        if (!ui.dragTicketIds.length) return;
        event.preventDefault();
        card.classList.add('drag-over');
      });
      card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
      card.addEventListener('drop', event => {
        if (!ui.dragTicketIds.length) return;
        event.preventDefault();
        const ids = [...ui.dragTicketIds];
        clearTicketDragClasses();
        assignTicketsToJob(ids, card.dataset.fvTicketJobId);
      });
    });

    const left = document.getElementById('fv-unassigned-ticket-list');
    if (left && left.dataset.fvTicketUnassign !== '1') {
      left.dataset.fvTicketUnassign = '1';
      left.addEventListener('dragover', event => {
        if (!ui.dragTicketIds.some(id => ui.tickets.get(id)?.haulingJobId)) return;
        event.preventDefault();
        left.classList.add('drag-over');
      });
      left.addEventListener('dragleave', () => left.classList.remove('drag-over'));
      left.addEventListener('drop', event => {
        const ids = ui.dragTicketIds.filter(id => ui.tickets.get(id)?.haulingJobId);
        if (!ids.length) return;
        event.preventDefault();
        clearTicketDragClasses();
        unassignTickets(ids);
      });
    }
  }

  function wireTicketWorkspaceControls() {
    document.getElementById('fv-select-all-hauling-tickets')?.addEventListener('click', () => {
      visibleUnassignedTickets().forEach(ticket => {
        if (!ticket.contractLocked) ui.selectedTicketIds.add(ticket.id);
      });
      queueTicketRender();
    });

    document.getElementById('fv-clear-hauling-tickets')?.addEventListener('click', () => {
      ui.selectedTicketIds.clear();
      queueTicketRender();
    });

    document.getElementById('fv-refresh-ticket-hauling')?.addEventListener('click', () => refreshTicketWorkspace(true));

    document.getElementById('fv-ticket-hauling-block')?.addEventListener('change', event => {
      const checkbox = event.target.closest?.('[data-fv-ticket-check]');
      if (!checkbox) return;
      const id = clean(checkbox.dataset.fvTicketCheck);
      if (checkbox.checked) ui.selectedTicketIds.add(id);
      else ui.selectedTicketIds.delete(id);
      ui.activeTicketId = id;
      queueTicketRender();
    });
  }

  function touchPoint(event) {
    return event.touches?.[0] || event.changedTouches?.[0] || event;
  }

  function cancelTouchTicketDrag() {
    if (ui.touchTicket.timer) clearTimeout(ui.touchTicket.timer);
    ui.touchTicket.timer = null;
    if (!ui.touchTicket.active) return;
    ui.touchTicket.active = false;
    ui.touchTicket.source?.classList.remove('dragging');
    ui.touchTicket.ghost?.remove();
    ui.touchTicket.target?.classList.remove('drag-over');
    ui.touchTicket.source = null;
    ui.touchTicket.ghost = null;
    ui.touchTicket.target = null;
    ui.touchTicket.ids = [];
    clearTicketDragClasses();
  }

  function moveTouchGhost(x, y) {
    if (!ui.touchTicket.ghost) return;
    ui.touchTicket.ghost.style.left = `${x}px`;
    ui.touchTicket.ghost.style.top = `${y}px`;
  }

  function touchDropTarget(x, y) {
    const ghost = ui.touchTicket.ghost;
    if (ghost) ghost.style.display = 'none';
    const under = document.elementFromPoint(x, y);
    if (ghost) ghost.style.display = '';
    return under?.closest?.('.fv-ticket-job-card[data-fv-ticket-job-id],#fv-unassigned-ticket-list') || null;
  }

  function updateTouchTicketTarget(x, y) {
    const target = touchDropTarget(x, y);
    if (ui.touchTicket.target !== target) {
      ui.touchTicket.target?.classList.remove('drag-over');
      ui.touchTicket.target = target;
      target?.classList.add('drag-over');
    }
  }

  function startTouchTicketDrag(card, event) {
    if (event.pointerType === 'mouse' || event.target.closest('input,button,a')) return;
    const id = clean(card.dataset.ticketId);
    const ticket = ui.tickets.get(id);
    if (!ticket || ticket.contractLocked) return;

    const point = touchPoint(event);
    ui.touchTicket.startX = point.clientX;
    ui.touchTicket.startY = point.clientY;
    if (ui.touchTicket.timer) clearTimeout(ui.touchTicket.timer);

    ui.touchTicket.timer = setTimeout(() => {
      ui.touchTicket.timer = null;
      ui.touchTicket.active = true;
      ui.touchTicket.source = card;
      ui.activeTicketId = id;
      ui.touchTicket.ids = currentDragTicketIds(id);
      ui.dragTicketIds = [...ui.touchTicket.ids];
      card.classList.add('dragging');

      const ghost = document.createElement('div');
      ghost.className = 'fv-ticket-drag-ghost';
      ghost.textContent = ui.touchTicket.ids.length > 1
        ? `${ui.touchTicket.ids.length} grain tickets`
        : `Ticket ${ticket.number}`;
      document.body.appendChild(ghost);
      ui.touchTicket.ghost = ghost;
      moveTouchGhost(ui.touchTicket.startX, ui.touchTicket.startY);
      document.getElementById('fv-unassigned-ticket-list')?.classList.toggle('fv-drop-unassign', ui.touchTicket.ids.some(ticketId => ui.tickets.get(ticketId)?.haulingJobId));
      ensureRunning();
      try { navigator.vibrate?.(18); } catch (_) {}
    }, 430);
  }

  document.addEventListener('pointermove', event => {
    if (event.pointerType === 'mouse') return;
    if (!ui.touchTicket.active) {
      if (ui.touchTicket.timer) {
        const dx = Math.abs(event.clientX - ui.touchTicket.startX);
        const dy = Math.abs(event.clientY - ui.touchTicket.startY);
        if (dx > 12 || dy > 12) {
          clearTimeout(ui.touchTicket.timer);
          ui.touchTicket.timer = null;
        }
      }
      return;
    }
    event.preventDefault();
    moveTouchGhost(event.clientX, event.clientY);
    updateTouchTicketTarget(event.clientX, event.clientY);
  }, { passive:false, capture:true });

  document.addEventListener('pointerup', event => {
    if (event.pointerType === 'mouse') return;
    if (ui.touchTicket.timer) {
      clearTimeout(ui.touchTicket.timer);
      ui.touchTicket.timer = null;
    }
    if (!ui.touchTicket.active) return;

    const target = ui.touchTicket.target || touchDropTarget(event.clientX, event.clientY);
    const ids = [...ui.touchTicket.ids];
    const jobId = clean(target?.dataset?.fvTicketJobId);
    const unassign = target?.id === 'fv-unassigned-ticket-list';
    cancelTouchTicketDrag();

    if (jobId) assignTicketsToJob(ids, jobId);
    else if (unassign) unassignTickets(ids);
  }, { passive:true, capture:true });

  document.addEventListener('pointercancel', cancelTouchTicketDrag, { passive:true, capture:true });

  /* ======================================================================
     START / WATCH CORE RENDERS
  ====================================================================== */

  function start() {
    injectStyle();
    setupCollapsibles();
    resolveUser();
    wireContextualDnd();
    loadContextData().then(queueTicketRender);

    const observer = new MutationObserver(() => {
      ensureRunning();
      setupCollapsibles();
      queueContextRender();
      autoActivateSingleContract();
    });

    observer.observe(document.documentElement, {
      subtree:true,
      childList:true,
      attributes:true,
      attributeFilter:['class']
    });

    autoActivateSingleContract();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once:true });
  } else {
    start();
  }
})();
