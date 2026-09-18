// FarmVista — Hauling Job form pickers
// Field-local menus using the existing FarmVista combo as the data/action source.
// No page-wide observer and no viewport-positioned popup.

(() => {
  'use strict';

  if (window.__FV_HAULING_JOB_LOCAL_PICKERS_V3) return;
  window.__FV_HAULING_JOB_LOCAL_PICKERS_V3 = true;

  const CONFIG = [
    { id:'hauling-job-buyer', placeholder:'Select buyer' },
    { id:'hauling-job-location', placeholder:'Select location' },
    { id:'hauling-job-customer', placeholder:'Select customer' },
    { id:'hauling-job-crop', placeholder:'Select crop' }
  ];

  const state = new Map();
  let modalObserver = null;

  function installStyles() {
    if (document.getElementById('fv-hauling-local-picker-style-v3')) return;
    const style = document.createElement('style');
    style.id = 'fv-hauling-local-picker-style-v3';
    style.textContent = `
      #hauling-job-modal .fv-combo[data-fv-hauling-legacy-combo="1"]{display:none!important}
      #hauling-job-modal .hj-load-picker{position:relative!important;width:100%!important;min-width:0!important;overflow:visible!important}
      #hauling-job-modal .hj-load-picker-button{
        width:100%!important;min-height:46px;display:flex;align-items:center;
        border:1px solid var(--border,#d4d4d4);border-radius:11px;
        background-color:var(--surface,#fff)!important;color:var(--text,#142018);
        padding:9px 38px 9px 11px;font:inherit;text-align:left;cursor:pointer;
        background-image:url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="14" height="8" viewBox="0 0 14 8"><path d="M1 1l6 6 6-6" fill="none" stroke="%2367706B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>')!important;
        background-repeat:no-repeat!important;background-position:right 11px center!important;background-size:14px 8px!important;
        box-sizing:border-box!important
      }
      #hauling-job-modal .hj-load-picker-button:focus{outline:none;border-color:#3B7E46;box-shadow:0 0 0 3px rgba(59,126,70,.13)}
      #hauling-job-modal .hj-load-picker-button:disabled{opacity:.55;cursor:not-allowed}
      #hauling-job-modal .hj-load-picker-menu{
        position:absolute!important;left:0!important;right:0!important;top:calc(100% + 5px)!important;bottom:auto!important;
        transform:none!important;translate:none!important;z-index:30000!important;display:none;
        width:100%!important;max-width:100%!important;max-height:min(390px,48dvh);
        overflow-x:hidden;overflow-y:auto;border:1px solid var(--border,#d4d4d4);border-radius:11px;
        background-color:var(--surface,#fff)!important;color:var(--text,#142018);box-shadow:0 14px 34px rgba(0,0,0,.20);
        padding:0 0 5px;margin:0!important;box-sizing:border-box;scrollbar-width:none;-ms-overflow-style:none;
        -webkit-overflow-scrolling:touch;overscroll-behavior:contain
      }
      #hauling-job-modal .hj-load-picker-menu::-webkit-scrollbar{display:none}
      #hauling-job-modal .hj-load-picker-menu.open{display:block}
      #hauling-job-modal .hj-load-picker-search-wrap{position:sticky;top:0;z-index:2;padding:8px;background-color:var(--surface,#fff)!important;border-bottom:1px solid var(--border,#d4d4d4)}
      #hauling-job-modal .hj-load-picker-search{width:100%;box-sizing:border-box;border:1px solid var(--border,#d4d4d4);border-radius:9px;background-color:var(--surface,#fff)!important;color:var(--text,#142018);padding:9px 10px;font:inherit}
      #hauling-job-modal .hj-load-picker-choice{width:100%;appearance:none;border:0;border-bottom:1px solid var(--border,#d4d4d4);background-color:var(--surface,#fff)!important;color:var(--text,#142018);padding:11px 13px;font:inherit;font-weight:650;text-align:left;cursor:pointer}
      #hauling-job-modal .hj-load-picker-choice:hover,#hauling-job-modal .hj-load-picker-choice:focus{background-color:var(--surface-2,rgba(59,126,70,.08))!important;outline:none}
      #hauling-job-modal .hj-load-picker-empty{padding:12px;color:var(--muted,#68716c);font-size:12px;font-weight:700}
      html.dark #hauling-job-modal .hj-load-picker-button,
      html.dark #hauling-job-modal .hj-load-picker-menu,
      html.dark #hauling-job-modal .hj-load-picker-search-wrap,
      html.dark #hauling-job-modal .hj-load-picker-search,
      html.dark #hauling-job-modal .hj-load-picker-choice,
      html[data-theme="dark"] #hauling-job-modal .hj-load-picker-button,
      html[data-theme="dark"] #hauling-job-modal .hj-load-picker-menu,
      html[data-theme="dark"] #hauling-job-modal .hj-load-picker-search-wrap,
      html[data-theme="dark"] #hauling-job-modal .hj-load-picker-search,
      html[data-theme="dark"] #hauling-job-modal .hj-load-picker-choice{
        background-color:#18231b!important;color:#eef4ef!important;border-color:#314137!important
      }
    `;
    document.head.appendChild(style);
  }

  function clean(value){ return String(value ?? '').trim(); }
  function norm(value){ return clean(value).toLowerCase(); }

  function closeAll(except=null){
    state.forEach(entry => {
      if (entry === except) return;
      entry.menu.classList.remove('open');
      entry.button.setAttribute('aria-expanded','false');
    });
  }

  function selectedLabel(select, placeholder){
    const option = select.options?.[select.selectedIndex];
    return clean(option?.textContent) || placeholder;
  }

  function hideLegacy(select){
    const combo = select.closest('.fv-combo');
    if (combo) combo.dataset.fvHaulingLegacyCombo = '1';
  }

  function legacyButton(entry){
    return entry.select.closest('.fv-combo')?.querySelector('.fv-buttonish') || null;
  }

  function latestLegacyPanel(){
    const panels = Array.from(document.querySelectorAll('.fv-panel.show'));
    return panels[panels.length - 1] || null;
  }

  function placeholderText(entry, text){
    const n = norm(text);
    return !n || n === norm(entry.config.placeholder) || n === 'select buyer first';
  }

  function readLegacyChoices(entry){
    const panel = latestLegacyPanel();
    if (!panel) return [];

    const seen = new Set();
    const choices = [];
    panel.querySelectorAll('.fv-item').forEach(item => {
      const text = clean(item.textContent);
      const key = norm(text);
      if (!text || placeholderText(entry,text) || seen.has(key)) return;
      seen.add(key);
      choices.push({ text, source:item });
    });

    panel.classList.remove('show');
    panel.setAttribute('aria-hidden','true');
    return choices;
  }

  function renderChoices(entry, choices){
    const query = norm(entry.search?.value);
    entry.menu.querySelectorAll('.hj-load-picker-choice,.hj-load-picker-empty').forEach(node => node.remove());

    const filtered = choices.filter(choice => !query || norm(choice.text).includes(query));
    filtered.forEach(choice => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'hj-load-picker-choice';
      button.textContent = choice.text;
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        entry.menu.classList.remove('open');
        entry.button.setAttribute('aria-expanded','false');
        choice.source.click();
        setTimeout(() => syncEntry(entry),0);
        setTimeout(syncAll,50);
      });
      entry.menu.appendChild(button);
    });

    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'hj-load-picker-empty';
      empty.textContent = choices.length ? 'No options found.' : 'Loading options…';
      entry.menu.appendChild(empty);
    }
  }

  function refreshFromLegacy(entry){
    const sourceButton = legacyButton(entry);
    if (!sourceButton) {
      renderChoices(entry,[]);
      return;
    }

    sourceButton.click();

    const capture = () => {
      const choices = readLegacyChoices(entry);
      if (choices.length) {
        entry.choices = choices;
        renderChoices(entry,choices);
        return true;
      }
      return false;
    };

    if (!capture()) {
      setTimeout(() => { if (!capture()) setTimeout(capture,50); },0);
    }
  }

  function syncEntry(entry){
    hideLegacy(entry.select);
    entry.button.textContent = selectedLabel(entry.select,entry.config.placeholder);
    entry.button.disabled = !!entry.select.disabled;
  }

  function syncAll(){ state.forEach(syncEntry); }

  function enhance(config){
    const select = document.getElementById(config.id);
    if (!select) return false;
    hideLegacy(select);

    if (state.has(config.id)) { syncEntry(state.get(config.id)); return true; }

    const field = select.closest('.field') || select.parentElement;
    if (!field) return false;

    const picker = document.createElement('div');
    picker.className = 'hj-load-picker';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hj-load-picker-button';
    button.setAttribute('aria-haspopup','listbox');
    button.setAttribute('aria-expanded','false');

    const menu = document.createElement('div');
    menu.className = 'hj-load-picker-menu';
    menu.setAttribute('role','listbox');

    let search = null;
    if (config.id !== 'hauling-job-crop') {
      const wrap = document.createElement('div');
      wrap.className = 'hj-load-picker-search-wrap';
      search = document.createElement('input');
      search.type = 'search';
      search.className = 'hj-load-picker-search';
      search.placeholder = 'Search';
      search.autocomplete = 'off';
      wrap.appendChild(search);
      menu.appendChild(wrap);
    }

    picker.append(button,menu);
    field.appendChild(picker);

    const entry = { select,config,picker,button,menu,search,choices:[] };
    state.set(config.id,entry);

    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      if (button.disabled) return;
      const opening = !menu.classList.contains('open');
      closeAll(entry);
      menu.classList.toggle('open',opening);
      button.setAttribute('aria-expanded',opening ? 'true' : 'false');
      if (!opening) return;
      if (search) search.value = '';
      renderChoices(entry,entry.choices);
      refreshFromLegacy(entry);
    });

    search?.addEventListener('input',() => renderChoices(entry,entry.choices));
    search?.addEventListener('click',event => event.stopPropagation());
    select.addEventListener('change',() => { syncEntry(entry); setTimeout(syncAll,25); });

    syncEntry(entry);
    return true;
  }

  function enhanceAll(){ CONFIG.forEach(enhance); syncAll(); }

  function installModalObserver(){
    const modal = document.getElementById('hauling-job-modal');
    if (!modal || modalObserver) return;
    modalObserver = new MutationObserver(() => {
      if (!modal.classList.contains('open')) { closeAll(); return; }
      enhanceAll();
      requestAnimationFrame(syncAll);
      setTimeout(syncAll,60);
    });
    modalObserver.observe(modal,{attributes:true,attributeFilter:['class']});
  }

  function init(){
    installStyles();
    enhanceAll();
    installModalObserver();
    document.addEventListener('click',event => {
      if (!event.target.closest?.('.hj-load-picker')) closeAll();
    },true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
