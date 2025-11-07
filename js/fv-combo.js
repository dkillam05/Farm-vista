/* /Farm-vista/js/fv-combo.js
   FarmVista Combo Upgrader — v1.1.0
   Rounded "buttonish + combo panel", portaled to <body> so it won't be clipped.
   Panels auto-position under the trigger but will NOT overlap the green footer.
   Opt in with:  <select data-fv-combo ...>
*/

(function () {
  /* ---------- Styles (token-friendly) ---------- */
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
    border-top:7px solid var(--muted,#67706B); transform:translateY(-50%); pointer-events:none;
  }
  .fv-combo .fv-anchor{ position:relative; display:inline-block; width:100%; }

  /* Portaled panel: fixed to viewport so parents can't clip it. */
  .fv-panel{
    position:fixed; left:0; top:0; width:auto;
    background:var(--surface); border:1px solid var(--border); border-radius:var(--combo-radius);
    box-shadow:var(--combo-shadow); z-index:2147483000; padding:8px; display:none;
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

  /* ---------- One portal root ---------- */
  const portalRoot = (() => {
    let n = document.getElementById('fv-portal-root');
    if (!n) {
      n = document.createElement('div');
      n.id = 'fv-portal-root';
      n.style.position = 'fixed';
      n.style.left = '0';
      n.style.top = '0';
      n.style.width = '0';
      n.style.height = '0';
      n.style.zIndex = '2147483000';
      document.body.appendChild(n);
    }
    return n;
  })();

  function closeAll(except = null) {
    document.querySelectorAll('.fv-panel.show').forEach(p => { if (p !== except) p.classList.remove('show'); });
  }
  document.addEventListener('click', () => closeAll());
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAll(); });

  /* ---- Helpers ---- */
  const isScrollable = (el) => {
    const cs = getComputedStyle(el);
    return /(auto|scroll|overlay)/.test(cs.overflow + cs.overflowY + cs.overflowX);
  };
  const nearestScrollParent = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      if (isScrollable(p)) return p;
    }
    return window;
  };

  // Try to learn footer height (favor real element; fall back to CSS var or default 44)
  function getFooterHeight() {
    const el =
      document.querySelector('[data-fv-footer]') ||
      document.querySelector('.ftr') ||
      document.querySelector('footer.fv-footer');
    if (el) return Math.max(0, el.getBoundingClientRect().height);
    const root = getComputedStyle(document.documentElement);
    const varFtr = parseFloat(root.getPropertyValue('--ftr-h')) || 0;
    return varFtr || 44;
  }

  function upgradeSelect(sel) {
    if (sel._fvUpgraded || !sel.matches('[data-fv-combo]')) return;
    // Skip invisible nodes to avoid bad rects
    const cs = getComputedStyle(sel);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;

    sel._fvUpgraded = true;

    const searchable  = String(sel.dataset.fvSearch || '').toLowerCase() === 'true';
    const placeholder = sel.getAttribute('placeholder') || (sel.options[0]?.text ?? '— Select —');

    // Hide native select but keep it in DOM for form semantics
    sel.style.position = 'absolute';
    sel.style.opacity = '0';
    sel.style.pointerEvents = 'none';
    sel.style.width = '0';
    sel.style.height = '0';
    sel.tabIndex = -1;

    // Build UI
    const field  = document.createElement('div'); field.className = 'fv-field fv-combo';
    const anchor = document.createElement('div'); anchor.className = 'fv-anchor';
    const btn    = document.createElement('button'); btn.type = 'button'; btn.className = 'fv-buttonish has-caret'; btn.textContent = placeholder;
    const panel  = document.createElement('div'); panel.className = 'fv-panel'; panel.setAttribute('role','listbox'); panel.setAttribute('aria-label', sel.getAttribute('aria-label') || sel.name || 'List');
    const list   = document.createElement('div'); list.className = 'fv-list';

    if (searchable) {
      const sWrap = document.createElement('div'); sWrap.className = 'fv-search';
      const sInput = document.createElement('input'); sInput.type = 'search'; sInput.placeholder = sel.getAttribute('data-fv-placeholder') || 'Search…';
      sWrap.appendChild(sInput); panel.appendChild(sWrap);
      sInput.addEventListener('input', () => render(sInput.value));
    }
    panel.appendChild(list);

    // Insert before select
    sel.parentNode.insertBefore(field, sel);
    anchor.appendChild(btn);
    field.append(anchor, sel);

    // Items
    let items = [];
    function readItems() {
      items = Array.from(sel.options).map((opt, idx) => ({
        id: String(idx), value: opt.value, label: opt.text, disabled: opt.disabled, hidden: opt.hidden
      })).filter(x => !x.hidden);
    }
    function render(q='') {
      const qq = (q||'').toLowerCase();
      const vis = items.filter(x => !qq || x.label.toLowerCase().includes(qq) || x.value.toLowerCase().includes(qq))
                       .filter(x => !x.disabled);
      list.innerHTML = vis.length
        ? vis.map(x => `<div class="fv-item" data-id="${x.id}">${x.label}</div>`).join('')
        : `<div class="fv-empty">(no matches)</div>`;
    }

    // ----- Smart placement (no footer overlap) -----
    let scrollUnsub = null;

    function placePanel() {
      const gap = Math.max(4, parseInt(getComputedStyle(document.documentElement).getPropertyValue('--combo-gap')) || 4);
      const r = anchor.getBoundingClientRect();
      const vwH = window.innerHeight;
      const footerH = getFooterHeight();
      const bottomLimit = vwH - footerH - 6; // hard cap just above footer
      const width = Math.max(180, r.width);

      // Temporarily show to measure content height
      panel.style.visibility = 'hidden';
      panel.style.display = 'block';
      panel.style.width = width + 'px';
      const panelH = panel.offsetHeight || 0;

      // Prefer below
      let top = r.bottom + gap;
      let flipUp = false;

      // If below would cross the footer line, try flipping up
      if ((top + panelH) > bottomLimit) {
        const tryUp = r.top - gap - panelH;
        if (tryUp >= 8) {
          top = tryUp;
          flipUp = true;
        } else {
          // Not enough space either way: clamp between 8 and bottomLimit - minHeight
          top = Math.max(8, Math.min(top, bottomLimit - 120)); // 120 = minimum comfortable menu height
        }
      }

      // Final clamp so bottom never dips into footer
      const maxBottom = bottomLimit;
      const maxListHeight = Math.max(120, maxBottom - top - 12); // leave a small margin
      const listEl = panel.querySelector('.fv-list');
      if (listEl) listEl.style.maxHeight = maxListHeight + 'px';

      panel.style.left = Math.round(r.left) + 'px';
      panel.style.top  = Math.round(top) + 'px';
      panel.style.width = Math.round(width) + 'px';
      panel.style.visibility = '';
    }

    function open() {
      closeAll(panel);
      if (!panel.isConnected) portalRoot.appendChild(panel);
      render('');
      panel.classList.add('show');
      placePanel();

      const sp = nearestScrollParent(anchor);
      const onMove = () => { if (panel.classList.contains('show')) placePanel(); };
      if (sp === window) window.addEventListener('scroll', onMove, { passive:true });
      else { sp.addEventListener('scroll', onMove, { passive:true }); window.addEventListener('scroll', onMove, { passive:true }); }
      window.addEventListener('resize', onMove, { passive:true });

      scrollUnsub = () => {
        if (sp === window) window.removeEventListener('scroll', onMove);
        else { sp.removeEventListener('scroll', onMove); window.removeEventListener('scroll', onMove); }
        window.removeEventListener('resize', onMove);
      };

      const s = panel.querySelector('.fv-search input'); if (s){ s.value=''; s.focus(); }
    }
    function close() {
      panel.classList.remove('show');
      if (typeof scrollUnsub === 'function') scrollUnsub();
    }

    btn.addEventListener('click', e => {
      e.stopPropagation();
      panel.classList.contains('show') ? close() : open();
    });

    list.addEventListener('mousedown', e => {
      const row = e.target.closest('.fv-item'); if (!row) return;
      const it = items[Number(row.dataset.id)]; if (!it) return;
      sel.value = it.value;
      btn.textContent = it.label || placeholder;
      close();
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Initial hydrate
    readItems();
    const curr = sel.options[sel.selectedIndex];
    btn.textContent = curr?.text || placeholder;

    // Keep in sync with dynamic option changes
    const mo = new MutationObserver(() => {
      const prev = sel.value;
      readItems(); render('');
      const currOpt = Array.from(sel.options).find(o => o.value === prev) || sel.options[sel.selectedIndex];
      btn.textContent = currOpt?.text || placeholder;
    });
    mo.observe(sel, { childList: true, subtree: true, attributes: true });

    // Programmatic changes & disabled reflection
    sel.addEventListener('change', () => { const opt = sel.options[sel.selectedIndex]; btn.textContent = opt?.text || placeholder; });
    const syncDisabled = () => { btn.disabled = sel.disabled; btn.classList.toggle('is-disabled', !!sel.disabled); };
    syncDisabled();
    new MutationObserver(syncDisabled).observe(sel, { attributes: true, attributeFilter: ['disabled'] });
  }

  function upgradeAll(root = document) {
    root.querySelectorAll('select[data-fv-combo]').forEach(upgradeSelect);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => upgradeAll());
  else upgradeAll();

  window.FVCombo = { upgrade: upgradeAll, upgradeSelect };
})();
