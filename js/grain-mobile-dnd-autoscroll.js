// FarmVista — Grain Contracts DND + hybrid workspace UX v4
// Sept. 11, 2026
//
// Existing file intentionally owns both pieces now:
//   1) mobile long-press DND edge auto-scroll;
//   2) clean Grain Contracts workspace behavior (collapse state + contextual
//      Contract -> Hauling Job filtering).
//
// No extra management mode is introduced. The existing Buyer / Sold Under /
// Crop filters remain available whenever the user wants to temporarily leave
// contextual view and expose other linked jobs for unlinking/rearranging.

(() => {
  'use strict';

  if (window.__FV_GRAIN_DND_WORKSPACE_20260911_V4) return;
  window.__FV_GRAIN_DND_WORKSPACE_20260911_V4 = true;

  const clean = value => String(value ?? '').trim();
  const norm = value => clean(value).toLowerCase().replace(/[^a-z0-9]/g, '');

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
        bubbles: true,
        cancelable: true,
        pointerType: 'touch',
        clientX: lastClientX,
        clientY: lastClientY
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
    'pointerup', 'pointercancel', 'touchend', 'touchcancel',
    'drop', 'dragend'
  ].forEach(type => {
    document.addEventListener(type, stopScroll, { passive:true, capture:true });
  });

  window.addEventListener('blur', stopScroll, { passive:true });

  /* ======================================================================
     HYBRID WORKSPACE STATE
  ====================================================================== */

  const ui = {
    uid: 'local',
    activeContractId: '',
    contextSuppressed: false,
    contracts: new Map(),
    jobs: new Map(),
    dataPromise: null,
    renderQueued: false
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

  function setupCollapsibles() {
    injectStyle();

    const contracts = document.querySelector('.workflow-group.grain-ticket-group');
    const settlement = document.querySelector('.workflow-group.settlement-group');
    const assignContracts = findBlock('Assign Contracts to Hauling Jobs');

    makeCollapsible(
      contracts,
      contracts?.querySelector(':scope>.workflow-group-head'),
      'contracts-section'
    );

    makeCollapsible(
      settlement,
      settlement?.querySelector(':scope>.workflow-group-head'),
      'settlement-section'
    );

    makeCollapsible(
      assignContracts,
      assignContracts?.querySelector(':scope>.workflow-block-head'),
      'contract-hauling-assignment'
    );
  }

  function reapplyRememberedState() {
    const contracts = document.querySelector('.workflow-group.grain-ticket-group');
    const settlement = document.querySelector('.workflow-group.settlement-group');
    const assignContracts = findBlock('Assign Contracts to Hauling Jobs');

    [
      [contracts, contracts?.querySelector(':scope>.workflow-group-head'), 'contracts-section'],
      [settlement, settlement?.querySelector(':scope>.workflow-group-head'), 'settlement-section'],
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
     CONTEXTUAL CONTRACT -> HAULING JOB FILTER
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
      id: snapshot.id,
      buyerId: clean(data.buyerId || data.grainBuyerId),
      buyerName: clean(data.buyerName),
      locationId: clean(data.deliveryLocationId || data.locationId || data.destinationId),
      locationName: clean(data.deliveryLocationName || data.locationName || data.destinationName),
      crop: cropKey(data.crop || data.commodity)
    };
  }

  function jobRecord(snapshot) {
    const data = snapshot.data() || {};
    return {
      id: snapshot.id,
      buyerId: clean(data.buyerId || data.grainBuyerId),
      locationId: clean(data.deliveryLocationId || data.locationId || data.destinationId),
      crop: cropKey(data.crop || data.commodity || data.cropName || data.cropType)
    };
  }

  async function loadContextData(force = false) {
    if (ui.dataPromise && !force) return ui.dataPromise;

    ui.dataPromise = (async () => {
      try {
        const firebase = await import('/js/firebase-init.js');
        await firebase.ready;
        const db = firebase.getFirestore();
        const [contracts, jobs] = await Promise.all([
          firebase.getDocs(firebase.collection(db, 'grain_contracts')),
          firebase.getDocs(firebase.collection(db, 'grain_hauling_jobs'))
        ]);

        ui.contracts = new Map(contracts.docs.map(snapshot => {
          const item = contractRecord(snapshot);
          return [item.id, item];
        }));

        ui.jobs = new Map(jobs.docs.map(snapshot => {
          const item = jobRecord(snapshot);
          return [item.id, item];
        }));
      } catch (error) {
        console.warn('[Grain DND] smart hauling-job filter unavailable:', error);
      }
    })();

    return ui.dataPromise;
  }

  function recordsMatch(contract, job) {
    if (!contract || !job) return true;
    if (contract.buyerId && job.buyerId && contract.buyerId !== job.buyerId) return false;
    if (contract.locationId && job.locationId && contract.locationId !== job.locationId) return false;
    if (contract.crop && job.crop && contract.crop !== job.crop) return false;
    return true;
  }

  function contextLabel(contract) {
    if (!contract) return '';
    const crop = contract.crop === 'corn'
      ? 'Corn'
      : (contract.crop === 'soybeans' ? 'Soybeans' : contract.crop);
    return [contract.buyerName, contract.locationName, crop].filter(Boolean).join(' • ');
  }

  function markSelectedContract() {
    document.querySelectorAll(
      '#hauling-unlinked-contract-list .hauling-contract-card[data-hauling-contract-id]'
    ).forEach(card => {
      card.classList.toggle(
        'fv-context-selected',
        clean(card.dataset.haulingContractId) === ui.activeContractId
      );
    });
  }

  function showContextualJobs() {
    const list = document.getElementById('hauling-job-drop-list');
    if (!list) return;

    const contract = ui.contracts.get(ui.activeContractId);
    const cards = Array.from(
      list.querySelectorAll('.hauling-job-drop-card[data-hauling-job-drop-id]')
    );

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

    const cards = Array.from(document.querySelectorAll(
      '#hauling-unlinked-contract-list .hauling-contract-card[data-hauling-contract-id]'
    ));

    if (cards.length === 1) activateContract(cards[0].dataset.haulingContractId);
  }

  function wireContextualDnd() {
    document.addEventListener('click', event => {
      const card = event.target.closest?.(
        '#hauling-unlinked-contract-list .hauling-contract-card[data-hauling-contract-id]'
      );
      if (card) activateContract(card.dataset.haulingContractId);
    }, true);

    document.addEventListener('dragstart', event => {
      const card = event.target.closest?.(
        '#hauling-unlinked-contract-list .hauling-contract-card[data-hauling-contract-id]'
      );
      if (card) activateContract(card.dataset.haulingContractId);
    }, true);

    document.addEventListener('change', event => {
      if (![
        'hauling-link-buyer',
        'hauling-link-customer',
        'hauling-link-crop'
      ].includes(event.target?.id)) return;

      // Existing filters are the clean escape hatch. Once the user changes one,
      // do not automatically snap back to the single left-hand contract until
      // they click/drag that contract again.
      ui.contextSuppressed = true;
      ui.activeContractId = '';
      queueContextRender();
    }, true);
  }

  /* ======================================================================
     START / WATCH CORE RENDERS
  ====================================================================== */

  function start() {
    injectStyle();
    setupCollapsibles();
    resolveUser();
    wireContextualDnd();
    loadContextData();

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
