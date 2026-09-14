// FarmVista — Hauling Job form pickers
// Uses the same local-picker pattern as Grain Ticket Detail so menus stay
// physically attached to the field that opened them instead of floating
// against the viewport.

(() => {
  const CONFIG = [
    { id: 'hauling-job-buyer', placeholder: 'Select buyer', addLabel: '+ Add New Buyer' },
    { id: 'hauling-job-location', placeholder: 'Select location', addLabel: '+ Add New Location' },
    { id: 'hauling-job-customer', placeholder: 'Select customer', addLabel: '+ Add New Sold Under' },
    { id: 'hauling-job-crop', placeholder: 'Select crop', addLabel: '' }
  ];

  const state = new Map();
  let clickAwayInstalled = false;
  let modalObserver = null;

  function installStyles() {
    if (document.getElementById('fv-hauling-local-picker-style')) return;
    const style = document.createElement('style');
    style.id = 'fv-hauling-local-picker-style';
    style.textContent = `
      #hauling-job-modal .fv-combo[data-fv-hauling-legacy-combo="1"] {
        display:none !important;
      }

      #hauling-job-modal select[data-fv-hauling-local-select="1"] {
        position:absolute !important;
        width:1px !important;
        height:1px !important;
        opacity:0 !important;
        pointer-events:none !important;
        overflow:hidden !important;
        clip:rect(0 0 0 0) !important;
        clip-path:inset(50%) !important;
        white-space:nowrap !important;
      }

      #hauling-job-modal .hj-load-picker {
        position:relative;
        width:100%;
        min-width:0;
        overflow:visible;
      }

      #hauling-job-modal .hj-load-picker-button {
        width:100%;
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
        inset:auto 0 auto 0 !important;
        transform:none !important;
        translate:none !important;
        z-index:30000 !important;
        display:none;
        max-height:min(390px,48dvh);
        overflow:auto;
        border:1px solid var(--border,#d4d4d4);
        border-radius:11px;
        background:var(--surface,#fff);
        color:var(--text,#142018);
        box-shadow:0 14px 34px rgba(0,0,0,.20);
        padding:0 0 5px;
        margin:0 !important;
        width:100% !important;
        max-width:100% !important;
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
        padding:10px 13px;
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
      if (entry !== except) entry.menu.classList.remove('open');
    });
  }

  function labelFor(select, placeholder) {
    const option = select.options[select.selectedIndex];
    const text = option ? String(option.textContent || '').trim() : '';
    return text || placeholder;
  }

  function suppressLegacy(select) {
    select.dataset.fvHaulingLocalSelect = '1';
    const combo = select.closest('.fv-combo');
    if (combo) combo.dataset.fvHaulingLegacyCombo = '1';
  }

  function visibleOptions(select) {
    return Array.from(select.options).filter(option => {
      if (option.disabled) return false;
      return true;
    });
  }

  function clickLegacyAdd(select, text) {
    const field = select.closest('.field');
    const combo = select.closest('.fv-combo');
    const legacyButton = combo?.querySelector('.fv-buttonish');
    if (!legacyButton) return false;

    legacyButton.click();

    const tryClick = () => {
      const items = Array.from(document.querySelectorAll('.fv-panel.show .fv-item'));
      const target = items.find(item => String(item.textContent || '').trim() === text);
      if (!target) return false;
      target.click();
      return true;
    };

    if (tryClick()) return true;
    setTimeout(tryClick, 0);
    setTimeout(tryClick, 40);
    return true;
  }

  function buildMenu(entry) {
    const { select, menu, config, search } = entry;
    const query = String(search?.value || '').trim().toLowerCase();

    Array.from(menu.querySelectorAll('.hj-load-picker-choice,.hj-load-picker-empty'))
      .forEach(node => node.remove());

    if (config.addLabel) {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'hj-load-picker-choice';
      add.textContent = config.addLabel;
      add.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        menu.classList.remove('open');
        clickLegacyAdd(select, config.addLabel);
      });
      menu.appendChild(add);
    }

    const options = visibleOptions(select).filter(option => {
      const text = String(option.textContent || '').trim();
      if (!query) return true;
      return text.toLowerCase().includes(query);
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
    suppressLegacy(entry.select);
    entry.button.textContent = labelFor(entry.select, entry.config.placeholder);
    entry.button.disabled = !!entry.select.disabled;
    buildMenu(entry);
  }

  function enhance(config) {
    const select = document.getElementById(config.id);
    if (!select) return false;

    suppressLegacy(select);

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
        buildMenu(entry);
        if (search) {
          search.value = '';
          setTimeout(() => search.focus({ preventScroll: true }), 0);
        }
      }
    });

    search?.addEventListener('input', () => buildMenu(entry));
    search?.addEventListener('click', event => event.stopPropagation());

    select.addEventListener('change', () => syncEntry(entry));
    new MutationObserver(() => syncEntry(entry)).observe(select, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled','selected','value']
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

  function installModalObserver() {
    const modal = document.getElementById('hauling-job-modal');
    if (!modal || modalObserver) return;
    modalObserver = new MutationObserver(() => {
      if (!modal.classList.contains('open')) {
        closeAll();
        return;
      }
      CONFIG.forEach(config => enhance(config));
      state.forEach(syncEntry);
    });
    modalObserver.observe(modal, { attributes: true, attributeFilter: ['class'] });
  }

  function sweepLegacy() {
    CONFIG.forEach(config => {
      const select = document.getElementById(config.id);
      if (select) suppressLegacy(select);
    });
  }

  function init() {
    installStyles();
    installClickAway();
    CONFIG.forEach(config => enhance(config));
    installModalObserver();
    sweepLegacy();

    const rootObserver = new MutationObserver(() => {
      CONFIG.forEach(config => enhance(config));
      sweepLegacy();
    });
    rootObserver.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
