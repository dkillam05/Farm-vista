// FarmVista — Grain Contracts DND + workspace UX helpers v4
// Sept. 11, 2026
//
// Keeps mobile long-press DND edge scrolling intact, and adds the clean hybrid
// Grain Contracts workspace behavior without creating another script:
//   • Grain Contracts & Tickets and Settlement groups collapse/expand.
//   • Assign Contracts to Hauling Jobs collapses/expands independently.
//   • Collapse state is remembered per signed-in user on this device.
//   • The active unlinked contract contextually narrows the right-hand hauling
//     jobs to compatible Buyer + Location + Crop jobs.
//   • Existing Buyer / Sold Under / Crop filters remain the escape hatch for
//     viewing every linked job and unlinking/rearranging contracts. No new
//     management mode or extra toolbar buttons are introduced.

(() => {
  'use strict';

  if (window.__FV_GRAIN_DND_WORKSPACE_20260911_V4) return;
  window.__FV_GRAIN_DND_WORKSPACE_20260911_V4 = true;

  /* ======================================================================
     MOBILE / TOUCH DND EDGE AUTO-SCROLL
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
    const eased = Math.sqrt(s);
    return MIN_SPEED_PX + (MAX_SPEED_PX - MIN_SPEED_PX) * eased;
  }

  function edgeSpeed() {
    if (!havePointer) return 0;

    const height = viewportHeight();
    if (!height) return 0;

    if (lastClientY < TOP_EDGE_PX) {
      const strength = (TOP_EDGE_PX - lastClientY) / TOP_EDGE_PX;
      return -easedSpeed(strength);
    }

    const bottomZone = bottomEdgePx(height);
    const bottomStart = height - bottomZone;

    if (lastClientY > bottomStart) {
      const strength = (lastClientY - bottomStart) / bottomZone;
      return easedSpeed(strength);
    }

    return 0;
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

  function scrollTarget(direction) {
    return scrollableAncestor(elementUnderFinger(), direction) ||
      scrollableAncestor(dragSource(), direction);
  }

  function refreshCoreDropTarget() {
    const source = dragSource();
    if (!source) return;

    try {
      source.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          cancelable: true,
          pointerType: 'touch',
          clientX: lastClientX,
          clientY: lastClientY
        })
      );
    } catch (_) {
      // Older iOS versions may reject constructed PointerEvents. The next real
      // finger movement still refreshes the existing FarmVista drop target.
    }
  }

  function tick() {
    frame = 0;

    if (!dragSource()) return;

    const speed = edgeSpeed();

    if (speed) {
      const target = scrollTarget(speed);

      if (target) {
        const before = target.scrollTop;
        target.scrollTop += speed;

        if (target.scrollTop !== before) {
          refreshCoreDropTarget();
        }
      }
    }

    frame = requestAnimationFrame(tick);
  }

  function ensureRunning() {
    if (!frame && dragSource()) {
      frame = requestAnimationFrame(tick);
    }
  }

  function rememberPointer(clientX, clientY) {
    lastClientX = clientX;
    lastClientY = clientY;
    havePointer = true;
    ensureRunning();
  }

  function stop() {
    if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  }

  document.addEventListener(
    'pointerdown',
    event => {
      if (event.pointerType === 'mouse') return;
      rememberPointer(event.clientX, event.clientY);
    },
    { passive: true, capture: true }
  );

  document.addEventListener(
    'pointermove',
    event => {
      if (event.pointerType === 'mouse') return;
      rememberPointer(event.clientX, event.clientY);
    },
    { passive: true, capture: true }
  );

  document.addEventListener(
    'touchstart',
    event => {
      const touch = event.touches?.[0];
      if (touch) rememberPointer(touch.clientX, touch.clientY);
    },
    { passive: true, capture: true }
  );

  document.addEventListener(
    'touchmove',
    event => {
      const touch = event.touches?.[0];
      if (touch) rememberPointer(touch.clientX, touch.clientY);
    },
    { passive: true, capture: true }
  );

  [
    'pointerup',
    'pointercancel',
    'touchend',
    'touchcancel',
    'drop',
    'dragend'
  ].forEach(type => {
    document.addEventListener(type, stop, {
      passive: true,
      capture: true
    });
  });

  window.addEventListener('blur', stop, { passive: true });

  /* ======================================================================
     COLLAPSIBLE WORKFLOW SECTIONS
  ====================================================================== */

  const uiState = {
    uid: 'local',
    collapsiblesReady: false,
    activeContractId: '',
    applyingCoreFilters: false,
    dataPromise: null,
    contracts: new Map(),
    jobs: new Map(),
    contextualRenderQueued: false
  };

  function clean(value) {
    return String(value ?? '').trim();
  }

  function norm(value) {
    return clean(value).toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function injectWorkspaceStyles() {
    if (document.getElementById('fv-grain-hybrid-workspace-style')) return;

    const style = document.createElement('style');
    style.id = 'fv-grain-hybrid-workspace-style';
    style.textContent = `
      .fv-workflow-collapsible-head {
        cursor:pointer;
        user-select:none;
      }

      .fv-workflow-collapsible-head:focus-visible {
        outline:3px solid rgba(59,126,70,.35);
        outline-offset:2px;
      }

      .fv-collapse-chevron {
        flex:0 0 auto;
        width:28px;
        height:28px;
        display:inline-flex;
        align-items:center;
        justify-content:center;
        border-radius:999px;
        font-size:1.05rem;
        font-weight:900;
        transition:transform .16s ease;
        opacity:.72;
      }

      .fv-workflow-collapsible-head[aria-expanded="true"] .fv-collapse-chevron {
        transform:rotate(90deg);
      }

      .fv-workflow-collapsed > :not(.workflow-group-head),
      .workflow-block.fv-workflow-collapsed > :not(.workflow-block-head) {
        display:none !important;
      }

      .fv-workflow-collapsed.workflow-group > .workflow-group-head,
      .workflow-block.fv-workflow-collapsed > .workflow-block-head {
        border-bottom:0 !important;
        margin-bottom:0 !important;
      }

      .hauling-contract-card.fv-context-selected {
        border-color:#3B7E46 !important;
        box-shadow:0 0 0 2px rgba(59,126,70,.16);
      }

      .hauling-job-drop-card.fv-context-hidden {
        display:none !important;
      }

      .dnd-column-body.fv-context-active {
        min-height:180px;
      }
    `;
    document.head.appendChild(style);
  }

  function storageKey(name) {
    return `fv:grain-contracts:${uiState.uid}:${name}`;
  }

  function readCollapsed(name, defaultCollapsed = true) {
    try {
      const saved = localStorage.getItem(storageKey(name));
      if (saved === 'expanded') return false;
      if (saved === 'collapsed') return true;
    } catch (_) {}
    return defaultCollapsed;
  }

  function saveCollapsed(name, collapsed) {
    try {
      localStorage.setItem(
        storageKey(name),
        collapsed ? 'collapsed' : 'expanded'
      );
    } catch (_) {}
  }

  function titleElementForHead(head) {
    return head?.querySelector('.workflow-group-title, .workflow-block-title, h2, h3') || null;
  }

  function installChevron(head) {
    if (!head || head.querySelector(':scope > .fv-collapse-chevron')) return;

    const chevron = document.createElement('span');
    chevron.className = 'fv-collapse-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = '›';
    head.appendChild(chevron);
  }

  function applyCollapsed(container, head, collapsed) {
    container.classList.toggle('fv-workflow-collapsed', collapsed);
    head.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }

  function makeCollapsible(container, head, stateName, defaultCollapsed = true) {
    if (!container || !head || head.dataset.fvCollapsible === '1') return;

    head.dataset.fvCollapsible = '1';
    head.classList.add('fv-workflow-collapsible-head');
    head.setAttribute('role', 'button');
    head.setAttribute('tabindex', '0');

    const title = titleElementForHead(head);
    if (title?.textContent) {
      head.setAttribute('aria-label', `Expand or collapse ${clean(title.textContent)}`);
    }

    installChevron(head);
    applyCollapsed(container, head, readCollapsed(stateName, defaultCollapsed));

    const toggle = event => {
      if (
        event?.target?.closest?.(
          'button, a, input, select, textarea, label'
        )
      ) {
        return;
      }

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

  function findWorkflowBlockByTitle(titleText) {
    return Array.from(document.querySelectorAll('.workflow-block')).find(block => {
      const title = block.querySelector('.workflow-block-title');
      return norm(title?.textContent) === norm(titleText);
    }) || null;
  }

  function setupCollapsibles() {
    injectWorkspaceStyles();

    const contractsGroup = document.querySelector('.workflow-group.grain-ticket-group');
    const settlementGroup = document.querySelector('.workflow-group.settlement-group');
    const assignmentBlock = findWorkflowBlockByTitle('Assign Contracts to Hauling Jobs');

    if (contractsGroup) {
      makeCollapsible(
        contractsGroup,
        contractsGroup.querySelector(':scope > .workflow-group-head'),
        'contracts-section',
        true
      );
    }

    if (settlementGroup) {
      makeCollapsible(
        settlementGroup,
        settlementGroup.querySelector(':scope > .workflow-group-head'),
        'settlement-section',
        true
      );
    }

    if (assignmentBlock) {
      makeCollapsible(
        assignmentBlock,
        assignmentBlock.querySelector(':scope > .workflow-block-head'),
        'contract-hauling-assignment',
        true
      );
    }
  }

  async function resolveUserAndRestoreCollapsibles() {
    try {
      const firebase = await import('/js/firebase-init.js');
      await firebase.ready;
      uiState.uid = clean(firebase.getAuth()?.currentUser?.uid) || 'local';
    } catch (_) {
      uiState.uid = 'local';
    }

    // setupCollapsibles is idempotent for listeners. Reapply only saved state
    // after the UID becomes known so different FarmVista users on one device
    // retain their own preferences.
    [
      ['.workflow-group.grain-ticket-group', 'contracts-section'],
      ['.workflow-group.settlement-group', 'settlement-section']
    ].forEach(([selector, key]) => {
      const container = document.querySelector(selector);
      const head = container?.querySelector(':scope > .workflow-group-head');
      if (container && head) {
        applyCollapsed(container, head, readCollapsed(key, true));
      }
    });

    const block = findWorkflowBlockByTitle('Assign Contracts to Hauling Jobs');
    const blockHead = block?.querySelector(':scope > .workflow-block-head');
    if (block && blockHead) {
      applyCollapsed(
        block,
        blockHead,
        readCollapsed('contract-hauling-assignment', true)
      );
    }
  }

  /* ======================================================================
     CONTEXTUAL CONTRACT → HAULING JOB DND FILTERING

     Normal behavior:
       Left contract determines what is useful on the right.
       Buyer + Location + Crop must match.

     Unlink / rearrange behavior:
       The existing filters are intentionally left in place. If the user
       changes one of them, contextual mode is cleared and the core workspace
       goes back to its normal filtered/all view. Clicking an unlinked contract
       engages contextual mode again.
  ====================================================================== */

  function normalizedCrop(value) {
    const key = norm(value);
    if (key === 'corn' || key === 'yellowcorn') return 'corn';
    if ([
      'soy', 'soybean', 'soybeans', 'bean', 'beans'
    ].includes(key)) return 'soybeans';
    return key;
  }

  function contractRecord(snapshot) {
    const data = snapshot.data() || {};
    return {
      id: snapshot.id,
      buyerId: clean(data.buyerId || data.grainBuyerId),
      locationId: clean(
        data.deliveryLocationId || data.locationId || data.destinationId
      ),
      crop: normalizedCrop(data.crop || data.commodity),
      buyerName: clean(data.buyerName),
      locationName: clean(
        data.deliveryLocationName || data.locationName || data.destinationName
      )
    };
  }

  function jobRecord(snapshot) {
    const data = snapshot.data() || {};
    return {
      id: snapshot.id,
      buyerId: clean(data.buyerId || data.grainBuyerId),
      locationId: clean(
        data.deliveryLocationId || data.locationId || data.destinationId
      ),
      crop: normalizedCrop(
        data.crop || data.commodity || data.cropName || data.cropType
      )
    };
  }

  async function loadContextData(force = false) {
    if (uiState.dataPromise && !force) return uiState.dataPromise;

    uiState.dataPromise = (async () => {
      try {
        const firebase = await import('/js/firebase-init.js');
        await firebase.ready;
        const db = firebase.getFirestore();

        const [contractSnap, jobSnap] = await Promise.all([
          firebase.getDocs(firebase.collection(db, 'grain_contracts')),
          firebase.getDocs(firebase.collection(db, 'grain_hauling_jobs'))
        ]);

        uiState.contracts = new Map(
          contractSnap.docs.map(snapshot => {
            const record = contractRecord(snapshot);
            return [record.id, record];
          })
        );

        uiState.jobs = new Map(
          jobSnap.docs.map(snapshot => {
            const record = jobRecord(snapshot);
            return [record.id, record];
          })
        );
      } catch (error) {
        console.warn('[Grain DND] contextual hauling-job filter unavailable:', error);
      }
    })();

    return uiState.dataPromise;
  }

  function recordsMatch(contract, job) {
    if (!contract || !job) return true;

    if (
      contract.buyerId &&
      job.buyerId &&
      contract.buyerId !== job.buyerId
    ) {
      return false;
    }

    if (
      contract.locationId &&
      job.locationId &&
      contract.locationId !== job.locationId
    ) {
      return false;
    }

    if (
      contract.crop &&
      job.crop &&
      contract.crop !== job.crop
    ) {
      return false;
    }

    return true;
  }

  function contextDescription(contract) {
    if (!contract) return '';
    return [
      contract.buyerName,
      contract.locationName,
      contract.crop === 'soybeans' ? 'Soybeans' : (
        contract.crop === 'corn' ? 'Corn' : contract.crop
      )
    ].filter(Boolean).join(' • ');
  }

  function updateVisibleJobCount() {
    const count = Array.from(
      document.querySelectorAll('#hauling-job-drop-list .hauling-job-drop-card')
    ).filter(card => !card.classList.contains('fv-context-hidden')).length;

    const countElement = document.getElementById('hauling-link-job-count');
    if (countElement && uiState.activeContractId) {
      countElement.textContent = `${count} job${count === 1 ? '' : 's'}`;
    }
  }

  function applyContextualJobVisibility() {
    const contract = uiState.contracts.get(uiState.activeContractId);
    const jobList = document.getElementById('hauling-job-drop-list');
    if (!jobList) return;

    const cards = Array.from(
      jobList.querySelectorAll('.hauling-job-drop-card[data-hauling-job-drop-id]')
    );

    if (!contract || !uiState.activeContractId) {
      cards.forEach(card => card.classList.remove('fv-context-hidden'));
      jobList.classList.remove('fv-context-active');
      return;
    }

    cards.forEach(card => {
      const job = uiState.jobs.get(clean(card.dataset.haulingJobDropId));
      card.classList.toggle('fv-context-hidden', !recordsMatch(contract, job));
    });

    jobList.classList.add('fv-context-active');
    updateVisibleJobCount();

    const message = document.getElementById('hauling-link-message');
    const description = contextDescription(contract);
    if (message && description) {
      message.textContent = `Showing hauling jobs matching ${description}. Drag the contract onto the correct job. Use the existing filters whenever you need to view linked jobs to unlink or rearrange them.`;
      message.classList.add('ready');
    }
  }

  function markSelectedContract() {
    document.querySelectorAll(
      '#hauling-unlinked-contract-list .hauling-contract-card'
    ).forEach(card => {
      card.classList.toggle(
        'fv-context-selected',
        clean(card.dataset.haulingContractId) === uiState.activeContractId
      );
    });
  }

  function queueContextualRender() {
    if (uiState.contextualRenderQueued) return;
    uiState.contextualRenderQueued = true;

    requestAnimationFrame(() => {
      uiState.contextualRenderQueued = false;
      markSelectedContract();
      applyContextualJobVisibility();
    });
  }

  function setCoreSelectValue(id, value) {
    const select = document.getElementById(id);
    if (!select) return;

    const wanted = clean(value);
    const available = Array.from(select.options).some(
      option => clean(option.value) === wanted
    );

    select.value = available ? wanted : '';
  }

  async function activateContractContext(contractId) {
    const id = clean(contractId);
    if (!id) return;

    await loadContextData();
    const contract = uiState.contracts.get(id);
    if (!contract) return;

    uiState.activeContractId = id;
    markSelectedContract();

    // Let the existing filter controls visibly reflect the active contract.
    // We intentionally do NOT set Sold Under; one detailed hauling job may
    // legitimately contain contracts for more than one Sold Under customer.
    uiState.applyingCoreFilters = true;
    setCoreSelectValue('hauling-link-buyer', contract.buyerId);
    setCoreSelectValue('hauling-link-crop', contract.crop === 'corn'
      ? 'Corn'
      : (contract.crop === 'soybeans' ? 'Soybeans' : contract.crop));
    uiState.applyingCoreFilters = false;

    queueContextualRender();
  }

  function clearContractContext() {
    uiState.activeContractId = '';
    markSelectedContract();
    queueContextualRender();
  }

  function autoChooseSingleUnlinkedContract() {
    if (uiState.activeContractId) return;

    const cards = Array.from(
      document.querySelectorAll(
        '#hauling-unlinked-contract-list .hauling-contract-card[data-hauling-contract-id]'
      )
    );

    if (cards.length === 1) {
      activateContractContext(cards[0].dataset.haulingContractId);
    }
  }

  function wireContextualDnd() {
    document.addEventListener('click', event => {
      const card = event.target.closest?.(
        '#hauling-unlinked-contract-list .hauling-contract-card[data-hauling-contract-id]'
      );
      if (!card) return;
      activateContractContext(card.dataset.haulingContractId);
    }, true);

    document.addEventListener('dragstart', event => {
      const card = event.target.closest?.(
        '#hauling-unlinked-contract-list .hauling-contract-card[data-hauling-contract-id]'
      );
      if (!card) return;
      activateContractContext(card.dataset.haulingContractId);
    }, true);

    ['hauling-link-buyer', 'hauling-link-customer', 'hauling-link-crop']
      .forEach(id => {
        document.addEventListener('change', event => {
          if (event.target?.id !== id) return;
          if (uiState.applyingCoreFilters) return;

          // Changing the filters is the natural, existing way to leave the
          // smart contextual view and see other linked jobs for unlinking.
          clearContractContext();
        }, true);
      });
  }

  /* ======================================================================
     START / OBSERVE CORE RENDERS
  ====================================================================== */

  function startWorkspaceEnhancements() {
    setupCollapsibles();
    resolveUserAndRestoreCollapsibles();
    wireContextualDnd();
    loadContextData();

    const observer = new MutationObserver(() => {
      ensureRunning();
      setupCollapsibles();
      queueContextualRender();
      autoChooseSingleUnlinkedContract();
    });

    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class']
    });

    autoChooseSingleUnlinkedContract();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startWorkspaceEnhancements, {
      once: true
    });
  } else {
    startWorkspaceEnhancements();
  }
})();
