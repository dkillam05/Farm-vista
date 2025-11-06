/* /Farm-vista/js/fv-combo.js
   FarmVista Combo Upgrader — v1.0.0
   Converts native <select data-fv-combo> into the rounded "buttonish + combo-panel"
   used on your working Grain Bag "Put Down" page — without rebuilding those pages.
*/

(function () {
  // Inject minimal styles (matched to your good page)
  const style = document.createElement('style');
  style.textContent = `
  :root{
    --combo-gap:4px; --combo-radius:12px; --combo-btn-radius:10px;
    --combo-shadow:0 12px 26px rgba(0,0,0,.18);
    --combo-item-pad:10px 8px; --combo-max-h:50vh;
  }
  .fv-field{ position:relative }
  .fv-buttonish{
    width:100%; font:inherit; font-size:16px; color:var(--text);
    background:var(--card-surface,var(--surface)); border:1px solid var(--border);
    border-radius:var(--combo-btn-radius); padding:12px; outline:none;
    cursor:pointer; text-align:left; position:relative; padding-right:42px;
  }
  .fv-buttonish.has-caret::after{
    content:""; position:absolute; right:14px; top:50%; width:0; height:0;
    border-left:6px solid transparent; border-right:6px solid transparent;
    border-top:7px solid var(--muted,#67706B); transform:translateY(-50%);
    pointer-events:none;
  }
  .fv-combo{ position:relative }
  .fv-combo .fv-anchor{ position:relative; display:inline-block; width:100%; }
  .fv-panel{
    position:absolute; left:0; right:0; top:calc(100% + var(--combo-gap));
    background:var(--surface); border:1px solid var(--border); border-radius:var(--combo-radius);
    box-shadow:var(--combo-shadow); z-index:9999; padding:8px; display:none;
  }
  .fv-panel.show{ display:block }
  .fv-panel .fv-search{ padding:4px 2px 8px }
  .fv-panel .fv-search input{
    width:100%; padding:10px; border:1px solid var(--border); border-radius:var(--combo-btn-radius);
    background:var(--card-surface,var(--surface)); color:var(--text);
  }
  .fv-panel .fv-list{ max-height:var(--combo-max-h); overflow:auto; border-top:1px solid var(--border) }
  .fv-item{ padding:var(--combo-item-pad); border-bottom:1px solid var(--border); cursor:pointer }
  .fv-item:hover{ background:rgba(0,0,0,.04) }
  .fv-item:last-child{ border-bottom:none }
  .fv-empty{ padding:var(--combo-item-pad); color:#67706B }
  `;
  document.head.appendChild(style);

  // Keep only one combo open at a time
  function closeAll(except = null) {
    document.querySelectorAll('.fv-panel.show').forEach(p => { if (p !== except) p.classList.remove('show'); });
  }
  document.addEventListener('click', () => closeAll());
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAll(); });

  // Upgrade a single <select>
  function upgradeSelect(sel) {
    if (sel._fvUpgraded) return; // idempotent
    sel._fvUpgraded = true;

    const searchable = String(sel.dataset.fvSearch || '').toLowerCase() === 'true';
    const placeholder = sel.getAttribute('placeholder') || (sel.options[0]?.text ?? '— Select —');

    // Wrap the select (keep it for value/serialize; hide it)
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

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'fv-buttonish has-caret';
    btn.textContent = placeholder;

    const panel = document.createElement('div');
    panel.className = 'fv-panel';
    panel.setAttribute('role', 'listbox');
    panel.setAttribute('aria-label', sel.getAttribute('aria-label') || sel.name || 'List');

    const list = document.createElement('div');
    list.className = 'fv-list';

    // Optional search
    if (searchable) {
      const sWrap = document.createElement('div');
      sWrap.className = 'fv-search';
      const sInput = document.createElement('input');
      sInput.type = 'search';
      sInput.placeholder = sel.getAttribute('data-fv-placeholder') || 'Search…';
      sWrap.appendChild(sInput);
      panel.appendChild(sWrap);
      sInput.addEventListener('input', () => render(sInput.value));
    }

    panel.appendChild(list);
    anchor.append(btn, panel);

    // Insert UI before select
    sel.parentNode.insertBefore(field, sel);
    field.appendChild(anchor);
    field.appendChild(sel); // keep select within for form semantics

    // Build items from the select
    let items = [];
    function readItems() {
      items = Array.from(sel.options).map((opt, idx) => ({
        id: String(idx),
        value: opt.value,
        label: opt.text,
        disabled: opt.disabled,
        hidden: opt.hidden
      })).filter(x => !x.hidden);
    }

    function render(q = '') {
      const qq = (q || '').toLowerCase();
      const visible = items.filter(x =>
        !qq || String(x.label).toLowerCase().includes(qq) || String(x.value).toLowerCase().includes(qq)
      ).filter(x => !x.disabled);

      list.innerHTML = visible.length
        ? visible.map(x => `<div class="fv-item" data-id="${x.id}">${x.label}</div>`).join('')
        : `<div class="fv-empty">(no matches)</div>`;
    }

    function open() {
      closeAll(panel);
      panel.classList.add('show');
      render('');
      const s = panel.querySelector('.fv-search input');
      if (s) { s.value = ''; s.focus(); }
    }
    function close() { panel.classList.remove('show'); }

    btn.addEventListener('click', e => {
      e.stopPropagation();
      panel.classList.contains('show') ? close() : open();
    });

    list.addEventListener('mousedown', e => {
      const row = e.target.closest('.fv-item'); if (!row) return;
      const it = items[Number(row.dataset.id)]; if (!it) return;
      // Set underlying select value and fire change
      sel.value = it.value;
      btn.textContent = it.label || placeholder;
      close();
      const evt = new Event('change', { bubbles: true });
      sel.dispatchEvent(evt);
    });

    // Initial hydrate
    readItems();
    // Default button text from current selection
    const curr = sel.options[sel.selectedIndex];
    btn.textContent = curr?.text || placeholder;

    // Mutation observer to keep in sync if options change dynamically
    const mo = new MutationObserver(() => {
      const prevVal = sel.value;
      readItems();
      render('');
      // Preserve current text
      const currOpt = Array.from(sel.options).find(o => o.value === prevVal) || sel.options[sel.selectedIndex];
      btn.textContent = currOpt?.text || placeholder;
    });
    mo.observe(sel, { childList: true, subtree: true, attributes: true });

    // If the select gets changed programmatically, reflect it
    sel.addEventListener('change', () => {
      const opt = sel.options[sel.selectedIndex];
      btn.textContent = opt?.text || placeholder;
    });

    // Respect disabled state
    function syncDisabled() {
      const dis = sel.disabled;
      btn.disabled = dis;
      btn.classList.toggle('is-disabled', !!dis);
    }
    syncDisabled();

    const moAttr = new MutationObserver(syncDisabled);
    moAttr.observe(sel, { attributes: true, attributeFilter: ['disabled'] });
  }

  function upgradeAll(root = document) {
    root.querySelectorAll('select[data-fv-combo]').forEach(upgradeSelect);
  }

  // Auto-run after DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => upgradeAll());
  } else {
    upgradeAll();
  }

  // Expose for manual calls if you inject selects later
  window.FVCombo = { upgrade: upgradeAll, upgradeSelect };

})();
