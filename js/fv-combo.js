/* /js/fv-combo.js
   FarmVista Combo Upgrader — v1.5.0
   - Custom selects stay anchored to their source control while any page/container scrolls.
   - Clicking anywhere outside an open combo closes it immediately.
   - Long lists remain viewport-clamped and internally scrollable.
   - Dynamically-added data-fv-combo selects are upgraded automatically.
   - Grain Contracts page patch keeps All Jobs DND mode from being overwritten,
     moves the mode toggle into the Hauling Jobs header, and colors contract
     Remaining bushels by percent left.
*/
(function () {
  'use strict';

  if (window.__FV_COMBO_150) return;
  window.__FV_COMBO_150 = true;

  const style = document.createElement('style');
  style.textContent = `
    :root{
      --combo-gap:4px;
      --combo-radius:12px;
      --combo-btn-radius:10px;
      --combo-shadow:0 12px 26px rgba(0,0,0,.18);
      --combo-item-pad:10px 8px;
      --combo-max-h:50vh;
    }

    .fv-field{position:relative}
    .fv-combo .fv-anchor{position:relative;display:inline-block;width:100%}

    .fv-buttonish{
      position:relative;
      width:100%;
      font:inherit;
      font-size:16px;
      color:var(--text);
      background:var(--card-surface,var(--surface));
      border:1px solid var(--border);
      border-radius:var(--combo-btn-radius);
      padding:12px 42px 12px 12px;
      outline:none;
      cursor:pointer;
      text-align:left;
      transition:box-shadow .12s ease;
    }
    .fv-buttonish:focus-visible{box-shadow:0 0 0 3px rgba(59,126,70,.25)}
    .fv-buttonish.is-disabled{opacity:.58;cursor:not-allowed}
    .fv-buttonish.has-caret::after{
      content:"";
      position:absolute;
      right:14px;
      top:50%;
      width:0;
      height:0;
      border-left:6px solid transparent;
      border-right:6px solid transparent;
      border-top:7px solid var(--muted,#67706B);
      transform:translateY(-50%);
      pointer-events:none;
    }

    .fv-panel{
      position:fixed;
      left:0;
      top:0;
      width:auto;
      background:var(--surface);
      border:1px solid var(--border);
      border-radius:var(--combo-radius);
      box-shadow:var(--combo-shadow);
      padding:8px;
      display:none;
      overflow:hidden;
      max-height:calc(100vh - 16px);
    }
    .fv-panel.show{display:block}
    .fv-panel .fv-search{padding:4px 2px 8px}
    .fv-panel .fv-search input{
      width:100%;
      padding:10px;
      border:1px solid var(--border);
      border-radius:var(--combo-btn-radius);
      background:var(--card-surface,var(--surface));
      color:var(--text);
    }
    .fv-panel .fv-list{
      max-height:var(--combo-max-h);
      min-height:0;
      overflow-y:auto;
      overflow-x:hidden;
      overscroll-behavior:contain;
      -webkit-overflow-scrolling:touch;
      scrollbar-gutter:stable;
      border-top:1px solid var(--border);
      padding-bottom:10px;
    }
    .fv-item{padding:var(--combo-item-pad);border-bottom:1px solid var(--border);cursor:pointer}
    .fv-item:hover{background:rgba(0,0,0,.04)}
    .fv-item:last-child{border-bottom:0}
    .fv-empty{padding:var(--combo-item-pad);color:#67706B}

    /* Grain Contracts: put the All Jobs toggle where it belongs. */
    #fv-ticket-hauling-block .fv-ticket-hauling-head-actions{
      display:flex;
      align-items:center;
      gap:8px;
      margin-left:auto;
    }
    #fv-ticket-hauling-block #fv-show-all-hauling-jobs{
      min-height:30px!important;
      padding:5px 10px!important;
      border:1px solid #4f718f!important;
      border-radius:8px!important;
      background:var(--surface,#fff)!important;
      color:#4f718f!important;
      -webkit-text-fill-color:#4f718f!important;
      font:inherit!important;
      font-size:.76rem!important;
      font-weight:900!important;
      line-height:1!important;
      cursor:pointer!important;
      white-space:nowrap!important;
      box-shadow:none!important;
    }
    #fv-ticket-hauling-block #fv-show-all-hauling-jobs:hover,
    #fv-ticket-hauling-block #fv-show-all-hauling-jobs:focus{
      background:rgba(79,113,143,.10)!important;
      outline:none!important;
    }
    #fv-ticket-hauling-block #fv-show-all-hauling-jobs.active,
    #fv-ticket-hauling-block #fv-show-all-hauling-jobs[aria-pressed="true"]{
      background:#4f718f!important;
      color:#fff!important;
      -webkit-text-fill-color:#fff!important;
    }

    /* Contract Remaining bushels visual warning. */
    #contracts-table-body td.fv-remain-green{
      background:rgba(59,126,70,.14)!important;
      color:#2d6937!important;
      font-weight:900!important;
    }
    #contracts-table-body td.fv-remain-orange{
      background:rgba(230,126,34,.16)!important;
      color:#a65300!important;
      font-weight:900!important;
    }
    #contracts-table-body td.fv-remain-red{
      background:rgba(179,38,30,.14)!important;
      color:#9d241e!important;
      font-weight:900!important;
    }
    [data-theme="dark"] #contracts-table-body td.fv-remain-green{color:#b9e4bf!important}
    [data-theme="dark"] #contracts-table-body td.fv-remain-orange{color:#f4bb78!important}
    [data-theme="dark"] #contracts-table-body td.fv-remain-red{color:#ffaaa4!important}
  `;
  document.head.appendChild(style);

  let portalRoot = null;
  function ensurePortalRoot() {
    if (portalRoot?.isConnected) return portalRoot;
    portalRoot = document.getElementById('fv-portal-root');
    if (!portalRoot) {
      portalRoot = document.createElement('div');
      portalRoot.id = 'fv-portal-root';
      portalRoot.style.position = 'fixed';
      portalRoot.style.left = '0';
      portalRoot.style.top = '0';
      portalRoot.style.width = '0';
      portalRoot.style.height = '0';
      (document.body || document.documentElement).appendChild(portalRoot);
    }
    return portalRoot;
  }

  const closeCallbacks = new WeakMap();

  function closePanel(panel) {
    if (!panel?.classList?.contains('show')) return;
    const closer = closeCallbacks.get(panel);
    if (typeof closer === 'function') closer();
    else panel.classList.remove('show');
  }

  function closeAll(except = null) {
    document.querySelectorAll('.fv-panel.show').forEach(panel => {
      if (panel !== except) closePanel(panel);
    });
  }

  function isInsideCombo(target) {
    if (!(target instanceof Element)) return false;
    return !!(
      target.closest('.fv-panel') ||
      target.closest('.fv-buttonish') ||
      target.closest('.fv-field.fv-combo')
    );
  }

  // Close immediately when the user starts interacting anywhere else.
  document.addEventListener('pointerdown', event => {
    if (isInsideCombo(event.target)) return;
    closeAll();
  }, true);

  // Keep click capture too for keyboard/synthetic interactions.
  document.addEventListener('click', event => {
    if (isInsideCombo(event.target)) return;
    closeAll();
  }, true);

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeAll();
  });

  function getFooterEl() {
    return (
      document.querySelector('.ftr') ||
      document.querySelector('[data-fv-footer]') ||
      document.querySelector('footer.fv-footer')
    );
  }

  function getFooterZ() {
    const footer = getFooterEl();
    if (!footer) return 900;
    const value = parseInt(getComputedStyle(footer).zIndex || '900', 10);
    return Number.isNaN(value) ? 900 : value;
  }

  function getFooterHeight() {
    const footer = getFooterEl();
    if (footer) return Math.max(0, footer.getBoundingClientRect().height);
    const root = getComputedStyle(document.documentElement);
    return parseFloat(root.getPropertyValue('--ftr-h')) || 44;
  }

  function upgradeSelect(sel) {
    if (!sel || sel._fvUpgraded || !sel.matches('select[data-fv-combo]')) return;

    const cs = getComputedStyle(sel);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;

    sel._fvUpgraded = true;

    const searchable = String(sel.dataset.fvSearch || '').toLowerCase() === 'true';
    const placeholder = sel.getAttribute('placeholder') || (sel.options[0]?.text ?? '— Select —');

    sel.style.position = 'absolute';
    sel.style.opacity = '0';
    sel.style.pointerEvents = 'none';
    sel.style.width = '0';
    sel.style.height = '0';
    sel.tabIndex = -1;

    const field = document.createElement('div');
    field.className = 'fv-field fv-combo';

    const anchor = document.createElement('div');
    anchor.className = 'fv-anchor';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'fv-buttonish has-caret';
    button.textContent = placeholder;

    const panel = document.createElement('div');
    panel.className = 'fv-panel';
    panel.setAttribute('role','listbox');
    panel.setAttribute('aria-label', sel.getAttribute('aria-label') || sel.name || 'List');

    const list = document.createElement('div');
    list.className = 'fv-list';

    if (searchable) {
      const searchWrap = document.createElement('div');
      searchWrap.className = 'fv-search';
      const searchInput = document.createElement('input');
      searchInput.type = 'search';
      searchInput.placeholder = sel.getAttribute('data-fv-placeholder') || 'Search…';
      searchWrap.appendChild(searchInput);
      panel.appendChild(searchWrap);
      searchInput.addEventListener('input', () => render(searchInput.value));
    }

    panel.appendChild(list);
    sel.parentNode.insertBefore(field, sel);
    anchor.appendChild(button);
    field.append(anchor, sel);

    let items = [];
    let cleanupOpenListeners = null;
    let raf = 0;

    function readItems() {
      items = Array.from(sel.options).map((option, index) => ({
        id:String(index),
        value:option.value,
        label:option.text,
        disabled:option.disabled,
        hidden:option.hidden
      })).filter(item => !item.hidden);
    }

    function render(query = '') {
      const q = String(query || '').toLowerCase();
      const visible = items
        .filter(item => !item.disabled)
        .filter(item => !q || item.label.toLowerCase().includes(q) || item.value.toLowerCase().includes(q));

      list.innerHTML = visible.length
        ? visible.map(item => `<div class="fv-item" data-id="${item.id}">${item.label}</div>`).join('')
        : '<div class="fv-empty">(no matches)</div>';
    }

    function placePanel() {
      if (!panel.classList.contains('show') || !anchor.isConnected) return;

      panel.style.zIndex = String(Math.max(1, getFooterZ() - 1));

      const rootStyle = getComputedStyle(document.documentElement);
      const gap = Math.max(4, parseInt(rootStyle.getPropertyValue('--combo-gap')) || 4);
      const hardListCeiling = parseInt(rootStyle.getPropertyValue('--combo-max-h')) || 600;
      const rect = anchor.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const topLimit = 8;
      const bottomLimit = Math.max(topLimit + 80, viewportHeight - getFooterHeight() - 6);

      // If its source control is no longer visible, close instead of leaving a floating list.
      if (rect.bottom < topLimit || rect.top > bottomLimit || rect.right < 0 || rect.left > viewportWidth) {
        close();
        return;
      }

      panel.style.visibility = 'hidden';
      const desiredWidth = Math.max(180, rect.width);
      panel.style.width = `${desiredWidth}px`;
      const panelWidth = panel.offsetWidth || desiredWidth;
      const left = Math.round(Math.min(Math.max(8, rect.left), viewportWidth - panelWidth - 8));

      const searchEl = panel.querySelector('.fv-search');
      const searchChrome = searchEl ? (searchEl.getBoundingClientRect().height || 42) : 0;
      const chrome = 18 + searchChrome;
      if (list) list.style.maxHeight = `${hardListCeiling}px`;

      const naturalPanelHeight = panel.offsetHeight || (chrome + 120);
      const belowTop = rect.bottom + gap;
      const aboveBottom = rect.top - gap;
      const spaceBelow = Math.max(0, bottomLimit - belowTop);
      const spaceAbove = Math.max(0, aboveBottom - topLimit);
      const openUp = naturalPanelHeight > spaceBelow && spaceAbove > spaceBelow;
      const availableHeight = Math.max(72, openUp ? spaceAbove : spaceBelow);
      const maxListHeight = Math.max(56, Math.min(hardListCeiling, availableHeight - chrome));
      list.style.maxHeight = `${maxListHeight}px`;

      const clampedHeight = panel.offsetHeight || Math.min(naturalPanelHeight, availableHeight);
      let top = openUp ? aboveBottom - clampedHeight : belowTop;
      top = Math.max(topLimit, Math.min(top, bottomLimit - clampedHeight));

      panel.style.left = `${left}px`;
      panel.style.top = `${Math.round(top)}px`;
      panel.style.maxHeight = `${Math.max(72, bottomLimit - top)}px`;
      panel.style.visibility = '';
    }

    function queuePlace() {
      if (!panel.classList.contains('show') || raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        placePanel();
      });
    }

    function removeOpenListeners() {
      if (typeof cleanupOpenListeners === 'function') cleanupOpenListeners();
      cleanupOpenListeners = null;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    }

    function open() {
      closeAll(panel);
      const portal = ensurePortalRoot();
      if (!panel.isConnected || panel.parentElement !== portal) portal.appendChild(panel);
      readItems();
      render('');
      panel.classList.add('show');
      placePanel();

      // Capture-phase document scroll catches window AND every nested scroll container.
      document.addEventListener('scroll', queuePlace, true);
      window.addEventListener('scroll', queuePlace, { passive:true });
      window.addEventListener('resize', queuePlace, { passive:true });
      window.addEventListener('orientationchange', queuePlace, { passive:true });

      cleanupOpenListeners = () => {
        document.removeEventListener('scroll', queuePlace, true);
        window.removeEventListener('scroll', queuePlace);
        window.removeEventListener('resize', queuePlace);
        window.removeEventListener('orientationchange', queuePlace);
      };

      const searchInput = panel.querySelector('.fv-search input');
      if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
      }
    }

    function close() {
      panel.classList.remove('show');
      removeOpenListeners();
    }

    closeCallbacks.set(panel, close);

    button.addEventListener('click', event => {
      event.stopPropagation();
      panel.classList.contains('show') ? close() : open();
    });

    list.addEventListener('mousedown', event => {
      const row = event.target.closest('.fv-item');
      if (!row) return;
      const item = items[Number(row.dataset.id)];
      if (!item) return;
      sel.value = item.value;
      button.textContent = item.label || placeholder;
      close();
      sel.dispatchEvent(new Event('change', { bubbles:true }));
    });

    readItems();
    const current = sel.options[sel.selectedIndex];
    button.textContent = current?.text || placeholder;

    new MutationObserver(() => {
      const previous = sel.value;
      readItems();
      render('');
      const option = Array.from(sel.options).find(item => item.value === previous) || sel.options[sel.selectedIndex];
      button.textContent = option?.text || placeholder;
      queuePlace();
    }).observe(sel, { childList:true,subtree:true,attributes:true });

    sel.addEventListener('change', () => {
      const option = sel.options[sel.selectedIndex];
      button.textContent = option?.text || placeholder;
    });

    const syncDisabled = () => {
      button.disabled = sel.disabled;
      button.classList.toggle('is-disabled', !!sel.disabled);
    };
    syncDisabled();
    new MutationObserver(syncDisabled).observe(sel, { attributes:true,attributeFilter:['disabled'] });
  }

  function upgradeAll(root = document) {
    if (!root?.querySelectorAll) return;
    root.querySelectorAll('select[data-fv-combo]').forEach(upgradeSelect);
  }

  function bootCombos() {
    upgradeAll();
    new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.target?.matches?.('select[data-fv-combo]')) {
          upgradeSelect(mutation.target);
        }
        mutation.addedNodes?.forEach(node => {
          if (!(node instanceof Element)) return;
          if (node.matches('select[data-fv-combo]')) upgradeSelect(node);
          upgradeAll(node);
        });
      }
    }).observe(document.documentElement, {
      childList:true,
      subtree:true,
      attributes:true,
      attributeFilter:['data-fv-combo']
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootCombos, { once:true });
  else bootCombos();

  window.FVCombo = { upgrade:upgradeAll, upgradeSelect, closeAll };

  /* ====================================================================
     Grain Contracts targeted UI/behavior repair — Sept. 12, 2026
  ==================================================================== */
  function installGrainContractsRepair() {
    if (!String(location.pathname || '').toLowerCase().endsWith('/pages/grain/grain-contracts.html')) return;
    if (window.__FV_GRAIN_CONTRACTS_UI_REPAIR_20260912) return;
    window.__FV_GRAIN_CONTRACTS_UI_REPAIR_20260912 = true;

    function numberValue(value) {
      const parsed = Number(String(value ?? '').replace(/,/g,'').replace(/[^0-9.-]/g,''));
      return Number.isFinite(parsed) ? parsed : null;
    }

    function decorateRemaining() {
      const body = document.getElementById('contracts-table-body');
      const table = body?.closest('table');
      if (!body || !table) return;

      const headers = Array.from(table.querySelectorAll('thead th'));
      const contractIndex = headers.findIndex(th => /contract\s*bu/i.test(th.textContent || ''));
      const remainingIndex = headers.findIndex(th => /^\s*remaining\s*$/i.test(th.textContent || ''));
      if (contractIndex < 0 || remainingIndex < 0) return;

      Array.from(body.querySelectorAll('tr')).forEach(row => {
        if (row.cells.length !== headers.length) return;
        const contractCell = row.cells[contractIndex];
        const remainingCell = row.cells[remainingIndex];
        if (!contractCell || !remainingCell) return;

        remainingCell.classList.remove('fv-remain-green','fv-remain-orange','fv-remain-red');
        const contract = numberValue(contractCell.textContent);
        const remaining = numberValue(remainingCell.textContent);
        if (!(contract > 0) || remaining === null) return;

        const percent = Math.max(0,(remaining / contract) * 100);
        const cls = percent < 5 ? 'fv-remain-red' : (percent < 35 ? 'fv-remain-orange' : 'fv-remain-green');
        remainingCell.classList.add(cls);
        remainingCell.title = `${percent.toFixed(1)}% remaining`;
      });
    }

    function placeAllJobsButton() {
      const button = document.getElementById('fv-show-all-hauling-jobs');
      const list = document.getElementById('fv-ticket-job-list');
      const head = list?.closest('.fv-ticket-hauling-column')?.querySelector(':scope > .fv-ticket-hauling-head');
      const count = document.getElementById('fv-ticket-job-count');
      if (!button || !head || !count) return;

      let actions = head.querySelector('.fv-ticket-hauling-head-actions');
      if (!actions) {
        actions = document.createElement('div');
        actions.className = 'fv-ticket-hauling-head-actions';
        head.appendChild(actions);
      }
      if (count.parentElement !== actions) actions.appendChild(count);
      if (button.parentElement !== actions) actions.appendChild(button);
    }

    function rescueAllJobsRender() {
      const button = document.getElementById('fv-show-all-hauling-jobs');
      const right = document.getElementById('fv-ticket-job-list');
      if (!button || !right || button.getAttribute('aria-pressed') !== 'true') return;
      if (right.querySelector('[data-fv-alljobs-job="1"]')) return;

      // The original all-jobs renderer caches its HTML in this dataset.
      // Core DND can replace innerHTML afterward without clearing that cache,
      // which made the button look active while still showing Matching Jobs.
      // Clearing the cache forces the existing all-jobs renderer to repaint.
      right.dataset.fvAllJobsHtml = '';

      if (!right.querySelector('[data-fv-alljobs-rescue]')) {
        const marker = document.createElement('span');
        marker.hidden = true;
        marker.dataset.fvAlljobsRescue = '1';
        right.appendChild(marker);
        queueMicrotask(() => marker.remove());
      }
    }

    let queued = false;
    function sync() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        placeAllJobsButton();
        decorateRemaining();
        rescueAllJobsRender();
      });
    }

    new MutationObserver(sync).observe(document.documentElement, { childList:true,subtree:true });
    document.addEventListener('click', event => {
      if (event.target.closest('#fv-show-all-hauling-jobs,#fv-refresh-ticket-hauling')) {
        setTimeout(sync,0);
        setTimeout(sync,80);
        setTimeout(sync,250);
      }
    }, true);

    setInterval(() => {
      decorateRemaining();
      placeAllJobsButton();
      rescueAllJobsRender();
    }, 500);

    sync();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installGrainContractsRepair, { once:true });
  else installGrainContractsRepair();
})();
