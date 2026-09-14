// FarmVista — Hauling Job form pickers
// Uses the same field-local picker pattern as Grain Ticket Detail.
// No page-wide MutationObserver: menus stay physically attached to their fields.

(() => {
  'use strict';

  if (window.__FV_HAULING_JOB_LOCAL_PICKERS_V2) return;
  window.__FV_HAULING_JOB_LOCAL_PICKERS_V2 = true;

  const CONFIG = [
    { id: 'hauling-job-buyer', placeholder: 'Select buyer', addLabel: '+ Add New Buyer' },
    { id: 'hauling-job-location', placeholder: 'Select location', addLabel: '+ Add New Location' },
    { id: 'hauling-job-customer', placeholder: 'Select customer', addLabel: '+ Add New Sold Under' },
    { id: 'hauling-job-crop', placeholder: 'Select crop', addLabel: '' }
  ];

  const state = new Map();
  let clickAwayInstalled = false;
  let modalObserver = null;
  let syncTimer = 0;

  function installStyles() {
    if (document.getElementById('fv-hauling-local-picker-style-v2')) return;

    const style = document.createElement('style');
    style.id = 'fv-hauling-local-picker-style-v2';
    style.textContent = `
      #hauling-job-modal .fv-combo[data-fv-hauling-legacy-combo="1"] {
        display:none !important;
      }

      #hauling-job-modal .hj-load-picker {
        position:relative !important;
        width:100% !important;
        min-width:0 !important;
        overflow:visible !important;
      }

      #hauling-job-modal .hj-load-picker-button {
        width:100% !important;
        min-height:46px;
        display:flex;
        align-items:center;
        border:1px solid var(--border,#d4d4d4);
        border-radius:11px;
        background-color:var(--surface,#fff);
        color:var(--text,#142018);
        padding:9px 38px 9px 11px;
        font:inherit;
        text-align:left;
        cursor:pointer;
        background-image:url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="14" height="8" viewBox="0 0 14 8"><path d="M1 1l6 6 6-6" fill="none" stroke="%2367706B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>');
        background-repeat:no-repeat;
        background-position:right 11px center;
        background-size:14px 8px;
        box-sizing:border-box;
      }

      #hauling-job-modal .hj-load-picker-button:focus {
        outline:none;
        border-color:#3B7E46;
        box-shadow:0 0 0 3px rgba(59,126,70,.13);
      }

      #hauling-job-modal .hj-load-picker-button:disabled {
        opacity:.55;
        cursor:not-allowed;
      }

      #hauling-job-modal .hj-load-picker-menu {
        position:absolute !important;
        left:0 !important;
        right:0 !important;
        top:calc(100% + 5px) !important;
        bottom:auto !important;
        transform:none !important;
        translate:none !important;
        z-index:30000 !important;
        display:none;
        width:100% !important;
        max-width:100% !important;
        max-height:min(390px,48dvh);
        overflow-x:hidden;
        overflow-y:auto;
        border:1px solid var(--border,#d4d4d4);
        border-radius:11px;
        background:var(--surface,#fff);
        color:var(--text,#142018);
        box-shadow:0 14px 34px rgba(0,0,0,.20);
        padding:0 0 5px;
        margin:0 !important;
        box-sizing:border-box;
        scrollbar-width:none;
        -ms-overflow-style:none;
        -webkit-overflow-scrolling:touch;
        overscroll-behavior:contain;
      }

      #hauling-job-modal .hj-load-picker-menu::-webkit-scrollbar { display:none; }
      #hauling-job-modal .hj-load-picker-menu.open { display:block; }

      #hauling-job-modal .hj-load-picker-search-wrap {
        position:sticky;
        top:0;
        z-index:2;
        padding:8px;
        background:var(--surface,#fff);
        border-bottom:1px solid var(--border,#d4d4d4);
      }

      #hauling-job-modal .hj-load-picker-search {
        width:100%;
        box-sizing:border-box;
        border:1px solid var(--border,#d4d4d4);
        border-radius:9px;
        background:var(--surface,#fff);
        color:var(--text,#142018);
        padding:9px 10px;
        font:inherit;
      }

      #hauling-job-modal .hj-load-picker-choice {
        width:100%;
        appearance:none;
        border:0;
        border-bottom:1px solid var(--border,#d4d4d4);
        background:var(--surface,#fff);
        color:var(--text,#142018);
        padding:11px 13px;
        font:inherit;
        font-weight:650;
        text-align:left;
        cursor:pointer;
      }

      #hauling-job-modal .hj-load-picker-choice:hover,
      #hauling-job-modal .hj-load-picker-choice:focus,
      #hauling-job-modal .hj-load-picker-choice.selected {
        background:var(--surface-2,rgba(59,126,70,.08));
        outline:none;
      }

      #hauling-job-modal .hj-load-picker-empty {
        padding:12px;
        color:var(--muted,#68716c);
        font-size:12px;
        font-weight:700;
      }

      html.dark #hauling-job-modal .hj-load-picker-menu,
      html.dark #hauling-job-modal .hj-load-picker-search-wrap,
      html.dark #hauling-job-modal .hj-load-picker-choice,
      html.dark #hauling-job-modal .hj-load-picker-button,
      html[data-theme="dark"] #hauling-job-modal .hj-load-picker-menu,
      html[data-theme="dark"] #hauling-job-modal .hj-load-picker-search-wrap,
      html[data-theme="dark"] #hauling-job-modal .hj-load-picker-choice,
      html[data-theme="dark"] #hauling-job-modal .hj-load-picker-button {
        background:#18231b !important;
        color:#eef4ef !important;
        border-color:#314137 !important;
      }
    `;
    document.head.appendChild(style);
  }

  function closeAll(except = null) {
    state.forEach(entry => {
      if (entry === except) return;
      entry.menu.classList.remove('open');
      entry.button.setAttribute('aria-expanded', 'false');
    });
  }

  function selectedLabel(select, placeholder) {
    const option = select.options?.[select.selectedIndex];
    const text = String(option?.textContent || '').trim();
    return text || placeholder;
  }

  function hideLegacyCombo(select) {
    const combo = select.closest('.fv-combo');
    if (combo) combo.dataset.fvHaulingLegacyCombo = '1';
  }

  function optionsFor(select) {
    return Array.from(select.options || []).filter(option => !option.disabled);
  }

  function triggerLegacyAdd(entry) {
    const { select, config } = entry;
    const combo = select.closest('.fv-combo');
    const legacyButton = combo?.querySelector('.fv-buttonish');
    if (!legacyButton || !config.addLabel) return;

    legacyButton.click();

    const tryClick = () => {
      const panels = Array.from(document.querySelectorAll('.fv-panel.show'));
      const panel = panels[panels.length - 1];
      const target = Array.from(panel?.querySelectorAll?.('.fv-item') || [])
        .find(item => String(item.textContent || '').trim() === config.addLabel);
      if (!target) return false;
      target.click();
      return true;
    };

    if (!tryClick()) {
      setTimeout(tryClick, 0);
      setTimeout(tryClick, 40);
    }
  }

  function buildMenu(entry) {
    const { select, menu, config, search } = entry;
    const query = String(search?.value || '').trim().toLowerCase();

    menu.querySelectorAll('.hj-load-picker-choice,.hj-load-picker-empty').forEach(node => node.remove());

    if (config.addLabel) {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'hj-load-picker-choice';
      add.textContent = config.addLabel;
      add.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        menu.classList.remove('open');
        entry.button.setAttribute('aria-expanded', 'false');
        triggerLegacyAdd(entry);
      });
      menu.appendChild(add);
    }

    const options = optionsFor(select).filter(option => {
      const text = String(option.textContent || '').trim();
      return !query || text.toLowerCase().includes(query);
    });

    options.forEach(option => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'hj-load-picker-choice';
      button.textContent = String(option.textContent || '').trim();
      if (String(option.value) === String(select.value)) button.classList.add('selected');
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        syncEntry(entry);
        menu.classList.remove('open');
        entry.button.setAttribute('aria-expanded', 'false');
      });
      menu.appendChild(button);
    });

    if (!options.length) {
      const empty = document.createElement('div');
      empty.className = 'hj-load-picker-empty';
      empty.textContent = 'No options found.';
      menu.appendChild(empty);
    }
  }

  function syncEntry(entry) {
    hideLegacyCombo(entry.select);
    entry.button.textContent = selectedLabel(entry.select, entry.config.placeholder);
    entry.button.disabled = !!entry.select.disabled;
    if (entry.menu.classList.contains('open')) buildMenu(entry);
  }

  function syncAll() {
    CONFIG.forEach(config => {
      const entry = state.get(config.id);
      if (entry) syncEntry(entry);
    });
  }

  function scheduleSync(delay = 0) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncAll, delay);
  }

  function enhance(config) {
    const select = document.getElementById(config.id);
    if (!select) return false;

    hideLegacyCombo(select);

    if (state.has(config.id)) {
      syncEntry(state.get(config.id));
      return true;
    }

    const field = select.closest('.field') || select.parentElement;
    if (!field) return false;

    const picker = document.createElement('div');
    picker.className = 'hj-load-picker';
    picker.dataset.haulingPickerFor = config.id;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hj-load-picker-button';
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');

    const menu = document.createElement('div');
    menu.className = 'hj-load-picker-menu';
    menu.setAttribute('role', 'listbox');

    let search = null;
    if (config.id !== 'hauling-job-crop') {
      const searchWrap = document.createElement('div');
      searchWrap.className = 'hj-load-picker-search-wrap';
      search = document.createElement('input');
      search.type = 'search';
      search.className = 'hj-load-picker-search';
      search.placeholder = 'Search';
      search.autocomplete = 'off';
      searchWrap.appendChild(search);
      menu.appendChild(searchWrap);
    }

    picker.appendChild(button);
    picker.appendChild(menu);
    field.appendChild(picker);

    const entry = { select, picker, button, menu, search, config };
    state.set(config.id, entry);

    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      if (button.disabled) return;

      const opening = !menu.classList.contains('open');
      closeAll(entry);
      menu.classList.toggle('open', opening);
      button.setAttribute('aria-expanded', opening ? 'true' : 'false');

      if (opening) {
        if (search) search.value = '';
        buildMenu(entry);
      }
    });

    search?.addEventListener('input', () => buildMenu(entry));
    search?.addEventListener('click', event => event.stopPropagation());

    select.addEventListener('change', () => {
      syncEntry(entry);
      scheduleSync(0);
      setTimeout(syncAll, 50);
    });

    syncEntry(entry);
    return true;
  }

  function installClickAway() {
    if (clickAwayInstalled) return;
    clickAwayInstalled = true;

    document.addEventListener('click', event => {
      if (event.target.closest?.('.hj-load-picker')) return;
      closeAll();
    }, true);
  }

  function enhanceAll() {
    CONFIG.forEach(enhance);
    syncAll();
  }

  function installModalObserver() {
    const modal = document.getElementById('hauling-job-modal');
    if (!modal || modalObserver) return;

    modalObserver = new MutationObserver(() => {
      if (!modal.classList.contains('open')) {
        closeAll();
        return;
      }

      enhanceAll();
      requestAnimationFrame(syncAll);
      setTimeout(syncAll, 60);
    });

    modalObserver.observe(modal, { attributes:true, attributeFilter:['class'] });
  }

  function init() {
    installStyles();
    installClickAway();
    enhanceAll();
    installModalObserver();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once:true });
  } else {
    init();
  }
})();
