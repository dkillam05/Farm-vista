/* FarmVista — <fv-shell> v6.0.1 (lean)
   Changes vs 6.0.0:
   - Removed built-in permission filter engine (now handled by /js/perm-filter.js).
   - Dispatches 'fv:nav-rendered' after nav render for external filters to hook in.
   - Retains: PTR, version UI, update flow, robust menu load, auth/logout labeling.
*/
(function () {
  const tpl = document.createElement('template');
  tpl.innerHTML = `
  <style>
    :host{
      --green:#3B7E46; --gold:#D0C542;
      --hdr-h:56px; --ftr-h:14px;
      display:block; color:#141514; background:#fff; min-height:100vh; position:relative;
    }
    .hdr{ position:fixed; inset:0 0 auto 0; height:calc(var(--hdr-h) + env(safe-area-inset-top,0px));
      padding-top:env(safe-area-inset-top,0px); background:var(--green); color:#fff;
      display:grid; grid-template-columns:56px 1fr 56px; align-items:center; z-index:1000; box-shadow:0 2px 0 rgba(0,0,0,.05); }
    .hdr .title{ text-align:center; font-weight:800; font-size:20px; }
    .iconbtn{ display:grid; place-items:center; width:48px; height:48px; border:none; background:transparent; color:#fff; font-size:28px; line-height:1; -webkit-tap-highlight-color: transparent; margin:0 auto;}
    .iconbtn svg{ width:26px; height:26px; display:block; }
    .gold-bar{ position:fixed; top:calc(var(--hdr-h) + env(safe-area-inset-top,0px)); left:0; right:0; height:3px; background:var(--gold); z-index:999; }

    /* === Fixed pull-to-refresh bar (does not move with drag) === */
    .ptr{
      position:fixed;
      top:calc(var(--hdr-h) + env(safe-area-inset-top,0px) + 3px);
      left:0; right:0;
      height:54px;
      background:var(--surface,#fff);
      color:var(--text,#111);
      border-bottom:1px solid var(--border,#e4e7e4);
      display:flex; align-items:center; justify-content:center; gap:10px;
      z-index:998;
      transform:translateY(-56px);
      transition:transform .16s ease;
      will-change:transform;
      pointer-events:none;
    }
    .ptr.show{ transform:translateY(0); }
    .ptr .spinner{
      width:18px;height:18px;border-radius:50%;
      border:2.25px solid #c9cec9;border-top-color:var(--green,#3B7E46);
      animation:spin 800ms linear infinite;
    }
    @keyframes spin{ to{ transform:rotate(360deg); } }
    .ptr .dot{ width:10px; height:10px; border-radius:50%; background:var(--green,#3B7E46); }
    .ptr .txt{ font-weight:800; }

    .ftr{ position:fixed; inset:auto 0 0 0; height:calc(var(--ftr-h) + env(safe-area-inset-bottom,0px));
      padding-bottom:env(safe-area-inset-bottom,0px); background:var(--green); color:#fff;
      display:flex; align-items:center; justify-content:center; border-top:2px solid var(--gold); z-index:900; }
    .ftr .text{ font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

    .main{ position:relative; padding:
        calc(var(--hdr-h) + env(safe-area-inset-top,0px) + 11px) 16px
        calc(var(--ftr-h) + env(safe-area-inset-bottom,0px) + 16px);
      min-height:100vh; box-sizing:border-box; background: var(--bg); color: var(--text); }
    ::slotted(.container){ max-width:980px; margin:0 auto; }

    .scrim{ position:fixed; inset:0; background:rgba(0,0,0,.45); opacity:0; pointer-events:none; transition:opacity .2s; z-index:1100; }
    :host(.drawer-open) .scrim, :host(.top-open) .scrim{ opacity:1; pointer-events:auto; }

    .drawer{ position:fixed; top:0; bottom:0; left:0; width:min(84vw, 320px);
      background: var(--surface); color: var(--text); box-shadow: var(--shadow);
      transform:translateX(-100%); transition:transform .25s; z-index:1200; -webkit-overflow-scrolling:touch;
      display:flex; flex-direction:column; height:100%; overflow:hidden; padding-bottom:env(safe-area-inset-bottom,0px);
      border-right: 1px solid var(--border); }
    :host(.drawer-open) .drawer{ transform:translateX(0); }
    .drawer header{ padding:16px; border-bottom:1px solid var(--border); display:flex; align-items:center; gap:12px; flex:0 0 auto; background: var(--surface); }
    .org{ display:flex; align-items:center; gap:12px; }
    .org img{ width:40px; height:40px; border-radius:8px; object-fit:cover; }
    .org .org-text{ display:flex; flex-direction:column; }
    .org .org-name{ font-weight:800; line-height:1.15; }
    .org .org-loc{ font-size:13px; color:#666; }
    .drawer nav{ flex:1 1 auto; overflow:auto; background: var(--bg); }
    .drawer nav a{ display:flex; align-items:center; gap:12px; padding:16px; text-decoration:none; color: var(--text); border-bottom:1px solid var(--border); }
    .drawer nav a span:first-child{ width:22px; text-align:center; opacity:.95; }
    .drawer-footer{ flex:0 0 auto; display:flex; align-items:flex-end; justify-content:space-between; gap:12px; padding:12px 16px;
      padding-bottom:calc(12px + env(safe-area-inset-bottom,0px)); border-top:1px solid var(--border);
      background: var(--surface); color: var(--text); }
    .df-left{ display:flex; flex-direction:column; align-items:flex-start; }
    .df-left .brand{ font-weight:800; line-height:1.15; }
    .df-left .slogan{ font-size:12.5px; color:#777; line-height:1.2; }
    .df-right{ font-size:13px; color:#777; white-space:nowrap; }

    .topdrawer{ position:fixed; left:0; right:0; top:0; transform:translateY(-105%); transition:transform .26s ease;
      z-index:1300; background:var(--green); color:#fff; box-shadow:0 20px 44px rgba(0,0,0,.35);
      border-bottom-left-radius:16px; border-bottom-right-radius:16px; padding-top:calc(env(safe-area-inset-top,0px) + 8px); max-height:72vh; overflow:auto; }
    :host(.top-open) .topdrawer{ transform:translateY(0); }
    .topwrap{ padding:6px 10px 14px; }
    .brandrow{ display:flex; align-items:center; justify-content:center; gap:10px; padding:10px 8px 12px 8px; }
    .brandrow img{ width:28px; height:28px; border-radius:6px; object-fit:cover; }
    .brandrow .brandname{ font-weight:800; font-size:18px; letter-spacing:.2px; }
    .section-h{ padding:12px 12px 6px; font:600 12px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif; letter-spacing:.12em; color:color-mix(in srgb,#fff 85%, transparent); }
    .chips{ padding:0 12px 10px; }
    .chip{ appearance:none; border:1.5px solid color-mix(in srgb,#fff 65%, transparent); padding:9px 14px; border-radius:20px; background:#fff; color:#111; margin-right:10px; font-weight:700; display:inline-flex; align-items:center; gap:8px; }
    .chip[aria-pressed="true"]{ outline:3px solid color-mix(in srgb,#fff 25%, transparent); background:var(--gold); color:#111; border-color:transparent; }
    .row{ display:flex; align-items:center; justify-content:space-between; padding:16px 12px; text-decoration:none; color:#fff; border-top:1px solid color-mix(in srgb,#000 22%, var(--green)); }
    .row .left{ display:flex; align-items:center; gap:14px; }
    .row .ico{ width:28px; height:28px; display:grid; place-items:center; font-size:24px; line-height:1; text-align:center; opacity:.95; }
    .row .txt{ font-size:16px; line-height:1.25; }
    .row .chev{ opacity:.9; }

    .toast{ position:fixed; left:50%; bottom:calc(var(--ftr-h) + env(safe-area-inset-bottom,0px) + 12px);
      transform:translateX(-50%); background:#111; color:#fff; padding:12px 22px; border-radius:12px; box-shadow:0 12px 32px rgba(0,0,0,.35);
      z-index:1400; font-size:14px; opacity:0; pointer-events:none; transition:opacity .18s ease, transform .18s ease;
      white-space:nowrap; min-width:320px; max-width:92vw; overflow:hidden; text-overflow:ellipsis; display:flex; align-items:center; justify-content:center; text-align:center; }
    .toast.show{ opacity:1; pointer-events:auto; transform:translateX(-50%) translateY(-4px); }

    :host-context(.dark){ color:var(--text); background:var(--bg); }
    :host-context(.dark) .main{ background:var(--bg); color:var(--text); }
    :host-context(.dark) .drawer{ background:var(--sidebar-surface, #171a18); color:var(--sidebar-text, #f1f3ef);
      border-right:1px solid var(--sidebar-border, #2a2e2b); box-shadow:0 0 36px rgba(0,0,0,.45); }
    :host-context(.dark) .drawer header{ background:var(--sidebar-surface, #171a18); border-bottom:1px solid var(--sidebar-border, #2a2e2b); }
    :host-context(.dark) .org .org-loc{ color:color-mix(in srgb, var(--sidebar-text, #f1f3ef) 80%, transparent); }
    :host-context(.dark) .drawer nav{ background:color-mix(in srgb, var(--sidebar-surface, #171a18) 88%, #000); }
    :host-context(.dark) .drawer nav a{ color:var(--sidebar-text, #f1f3ef); border-bottom:1px solid var(--sidebar-border, #232725); }
    .drawer-footer{ background:var(--sidebar-surface, #171a18); border-top:1px solid var(--sidebar-border, #2a2e2b); color:var(--sidebar-text, #f1f3ef); }
    :host-context(.dark) .df-left .slogan, :host-context(.dark) .df-right{ color:color-mix(in srgb, var(--sidebar-text, #f1f3ef) 80%, transparent); }
    :host-context(.dark) .toast{ background:#1b1f1c; color:#F2F4F1; border:1px solid #2a2e2b; box-shadow:0 12px 32px rgba(0,0,0,.55); }
  </style>

  <header class="hdr" part="header">
    <button class="iconbtn js-menu" aria-label="Open menu">≡</button>
    <div class="title">FarmVista</div>
    <button class="iconbtn js-account" aria-label="Account" title="Account">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/>
        <circle cx="12" cy="9.2" r="3.0" fill="none" stroke="currentColor" stroke-width="1.6"/>
        <path d="M7 17.4c1.3-2.2 3.1-3.4 5-3.4s3.7 1.2 5 3.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
      </svg>
    </button>
  </header>
  <div class="gold-bar" aria-hidden="true"></div>

  <!-- Fixed PTR bar -->
  <div class="ptr js-ptr" aria-hidden="true">
    <div class="dot js-dot" hidden></div>
    <div class="spinner js-spin" hidden></div>
    <div class="txt js-txt">Pull to refresh</div>
  </div>

  <div class="scrim js-scrim"></div>

  <aside class="drawer" part="drawer" aria-label="Main menu">
    <header>
      <div class="org">
        <img src="/Farm-vista/assets/icons/icon-192.png" alt="" />
        <div class="org-text">
          <div class="org-name">Dowson Farms</div>
          <div class="org-loc">Divernon, Illinois</div>
        </div>
      </div>
    </header>
    <nav class="js-nav"></nav>
    <footer class="drawer-footer">
      <div class="df-left">
        <div class="brand">FarmVista</div>
        <div class="slogan js-slogan">Loading…</div>
      </div>
      <div class="df-right"><span class="js-ver">v0.0.0</span></div>
    </footer>
  </aside>

  <section class="topdrawer js-top" role="dialog" aria-label="Account & settings">
    <div class="topwrap">
      <div class="brandrow">
        <img src="/Farm-vista/assets/icons/icon-192.png" alt="" />
        <div class="brandname">FarmVista</div>
      </div>

      <div class="section-h">THEME</div>
      <div class="chips">
        <button class="chip js-theme" data-mode="system" aria-pressed="true">System</button>
        <button class="chip js-theme" data-mode="light"  aria-pressed="false">Light</button>
        <button class="chip js-theme" data-mode="dark"   aria-pressed="false">Dark</button>
      </div>

      <div class="section-h">PROFILE</div>
      <a class="row" id="userDetailsLink" href="/Farm-vista/pages/user-details/index.html">
        <div class="left"><div class="ico">🧾</div><div class="txt">User Details</div></div>
        <div class="chev">›</div>
      </a>
      <a class="row" id="feedbackLink" href="/Farm-vista/pages/feedback/index.html">
        <div class="left"><div class="ico">💬</div><div class="txt">Feedback</div></div>
        <div class="chev">›</div>
      </a>

      <div class="section-h">MAINTENANCE</div>
      <a class="row js-update-row" href="#">
        <div class="left"><div class="ico">⟳</div><div class="txt">Check for updates</div></div>
        <div class="chev">›</div>
      </a>

      <a class="row" href="#" id="logoutRow">
        <div class="left"><div class="ico">⏻</div><div class="txt" id="logoutLabel">Logout</div></div>
        <div class="chev">›</div>
      </a>
    </div>
  </section>

  <main class="main" part="main"><slot></slot></main>
  <footer class="ftr" part="footer"><div class="text js-footer"></div></footer>
  <div class="toast js-toast" role="status" aria-live="polite"></div>
  `;

  class FVShell extends HTMLElement {
    constructor(){ super(); this.attachShadow({mode:'open'}).appendChild(tpl.content.cloneNode(true)); }

    connectedCallback(){
      const r = this.shadowRoot;
      this._btnMenu   = r.querySelector('.js-menu');
      this._btnAccount= r.querySelector('.js-account');
      this._scrim     = r.querySelector('.js-scrim');
      this._drawer    = r.querySelector('.drawer');
      this._top       = r.querySelector('.js-top');
      this._footerText= r.querySelector('.js-footer');
      this._toast     = r.querySelector('.js-toast');
      this._verEl     = r.querySelector('.js-ver');
      this._sloganEl  = r.querySelector('.js-slogan');
      this._navEl     = r.querySelector('.js-nav');

      // PTR refs
      this._ptr    = r.querySelector('.js-ptr');
      this._ptrTxt = r.querySelector('.js-txt');
      this._ptrSpin= r.querySelector('.js-spin');
      this._ptrDot = r.querySelector('.js-dot');

      this._btnMenu.addEventListener('click', ()=> { this.toggleTop(false); this.toggleDrawer(true); });
      this._scrim.addEventListener('click', ()=> { this.toggleDrawer(false); this.toggleTop(false); });
      this._btnAccount.addEventListener('click', ()=> { this.toggleDrawer(false); this.toggleTop(); });
      document.addEventListener('keydown', (e)=>{ if(e.key==='Escape'){ this.toggleDrawer(false); this.toggleTop(false); } });

      r.querySelectorAll('.js-theme').forEach(btn=> btn.addEventListener('click', ()=> this.setTheme(btn.dataset.mode)));
      document.addEventListener('fv:theme', (e)=> this._syncThemeChips(e.detail.mode));
      this._syncThemeChips((window.App && App.getTheme && App.getTheme()) || 'system');

      const now = new Date();
      const dateStr = now.toLocaleDateString(undefined, { weekday:'long', year:'numeric', month:'long', day:'numeric' });
      this._footerText.textContent = `© ${now.getFullYear()} FarmVista • ${dateStr}`;

      this._ensureVersionThenAuth();

      const upd = r.querySelector('.js-update-row');
      if (upd) upd.addEventListener('click', (e)=> { e.preventDefault(); this.checkForUpdates(); });

      const ud = r.getElementById('userDetailsLink'); if (ud) ud.addEventListener('click', () => { this.toggleTop(false); });
      const fb = r.getElementById('feedbackLink'); if (fb) fb.addEventListener('click', () => { this.toggleTop(false); });

      this._initMenu();              // renders menu
      this._initPTR();               // Pull-to-refresh
    }

    /* ==== Load order: version.js → firebase-config.js → import(firebase-init.js) ==== */
    async _ensureVersionThenAuth(){
      await this._loadScriptOnce('/Farm-vista/js/version.js').catch(()=>{});
      this._applyVersionToUI();

      await this._loadScriptOnce('/Farm-vista/js/firebase-config.js').catch(()=>{});
      try{
        const mod = await import('/Farm-vista/js/firebase-init.js');
        this._firebase = mod;
        await this._wireAuthLogout(this.shadowRoot, mod);
        // Permissions are handled externally by /js/perm-filter.js
      }catch(err){
        console.warn('[FV] firebase-init import failed:', err);
        this._wireAuthLogout(this.shadowRoot, null);
      }
    }

    _applyVersionToUI(){
      const v = (window && window.FV_VERSION) || {};
      const num = (v.number || '').toString().replace(/^\s*v/i,'').trim() || '0.0.0';
      const tag = (v.tagline || 'Simplified');
      if (this._verEl) this._verEl.textContent = `v${num}`;
      if (this._sloganEl) this._sloganEl.textContent = tag;
    }

    _loadScriptOnce(src){
      return new Promise((resolve, reject)=>{
        const exists = Array.from(document.scripts).some(s=> (s.getAttribute('src')||'') === src);
        if (exists) { resolve(); return; }
        const s = document.createElement('script');
        s.src = src; s.defer = true;
        s.onload = ()=> resolve();
        s.onerror = (e)=> reject(e);
        document.head.appendChild(s);
      });
    }

    /* ===== Robust menu loader (ABSOLUTE + fallback) ===== */
    async _initMenu(){
      const url = location.origin + '/Farm-vista/js/menu.js?v=' + Date.now();

      try {
        const mod = await import(url);
        const NAV_MENU = (mod && (mod.NAV_MENU || mod.default)) || null;
        if (!NAV_MENU || !Array.isArray(NAV_MENU.items)) throw new Error('Invalid NAV_MENU export');
        this._renderMenu(NAV_MENU);
        return;
      } catch (e) {
        console.warn('[FV] import(menu.js) failed, falling back to classic script:', e);
      }

      try {
        await new Promise((res, rej) => {
          const s = document.createElement('script');
          s.src = url; s.defer = true;
          s.onload = () => res();
          s.onerror = (err) => rej(err);
          document.head.appendChild(s);
        });
        const NAV_MENU = (window && window.FV_MENU) || null;
        if (!NAV_MENU || !Array.isArray(NAV_MENU.items)) throw new Error('window.FV_MENU missing/invalid');
        this._renderMenu(NAV_MENU);
      } catch (err) {
        console.error('[FV] Unable to load menu:', err);
        this._toastMsg('Menu failed to load. Please refresh.', 2400);
      }
    }

    _renderMenu(cfg){
      const nav = this._navEl; if (!nav) return;
      this._navCfg = cfg; // kept only for current-page highlighting
      nav.innerHTML = '';

      const path = location.pathname;
      const stateKey = (cfg.options && cfg.options.stateKey) || 'fv:nav:groups';
      this._navStateKey = stateKey;
      let groupState = {};
      try { groupState = JSON.parse(localStorage.getItem(stateKey) || '{}'); } catch {}

      const pad = (depth)=> `${16 + (depth * 18)}px`;

      const mkLink = (item, depth=0) => {
        const a = document.createElement('a');
        a.href = item.href || '#';
        a.innerHTML = `<span>${item.icon||''}</span> ${item.label}`;
        a.style.paddingLeft = pad(depth);
        const mode = item.activeMatch || 'starts-with';
        const hrefPath = new URL(a.href, location.href).pathname;
        if ((mode==='exact' && path === hrefPath) || (mode!=='exact' && item.href && path.startsWith(hrefPath))) {
          a.setAttribute('aria-current', 'page');
        }
        return a;
      };

      const setOpen = (open, kids, btn) => {
        kids.style.display = open ? 'block' : 'none';
        btn.setAttribute('aria-expanded', String(open));
        const chev = btn.firstElementChild;
        if (chev) chev.style.transform = open ? 'rotate(90deg)' : 'rotate(0deg)';
      };

      const mkGroup = (g, depth=0) => {
        const wrap = document.createElement('div'); wrap.className = 'nav-group';

        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'stretch';
        row.style.borderBottom = '1px solid var(--border)';

        const link = mkLink(g, depth);
        link.style.flex = '1 1 auto';
        link.style.borderRight = '1px solid var(--border)';
        link.style.display = 'flex';
        link.style.alignItems = 'center';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('aria-label', 'Toggle ' + g.label);
        btn.setAttribute('aria-expanded', 'false');
        btn.style.width = '44px';
        btn.style.height = '44px';
        btn.style.display = 'grid';
        btn.style.placeItems = 'center';
        btn.style.background = 'transparent';
        btn.style.border = '0';
        btn.style.cursor = 'pointer';
        btn.style.color = 'var(--text)';

        const chev = document.createElement('span');
        chev.textContent = '▶';
        chev.style.display = 'inline-block';
        chev.style.transition = 'transform .18s ease';
        btn.appendChild(chev);

        const kids = document.createElement('div');
        kids.setAttribute('role','group');
        kids.style.display = 'none';

        (g.children || []).forEach(ch => {
          if (ch.type === 'group' && ch.collapsible) kids.appendChild(mkGroup(ch, depth + 1));
          else if (ch.type === 'link') kids.appendChild(mkLink(ch, depth + 1));
        });

        const open = !!(groupState[g.id] ?? g.initialOpen);
        setOpen(open, kids, btn);

        btn.addEventListener('click', (e)=>{
          e.preventDefault();
          const nowOpen = kids.style.display === 'none';
          setOpen(nowOpen, kids, btn);
          groupState[g.id] = nowOpen;
          try { localStorage.setItem(stateKey, JSON.stringify(groupState)); } catch {}
        });

        row.appendChild(link);
        row.appendChild(btn);
        wrap.appendChild(row);
        wrap.appendChild(kids);
        return wrap;
      };

      (cfg.items || []).forEach(item=>{
        if (item.type === 'group' && item.collapsible) nav.appendChild(mkGroup(item, 0));
        else if (item.type === 'link') nav.appendChild(mkLink(item, 0));
      });

      // ↪ Let external permission filter know the nav is painted
      document.dispatchEvent(new CustomEvent('fv:nav-rendered'));
    }

    _collapseAllNavGroups(){
      const nav = this._navEl;
      if (!nav) return;
      nav.querySelectorAll('div[role="group"]').forEach(kids=>{
        kids.style.display = 'none';
        const row = kids.previousElementSibling;
        const btn = row && row.querySelector('button[aria-expanded]');
        if (btn) btn.setAttribute('aria-expanded','false');
      });
      const key = this._navStateKey || 'fv:nav:groups';
      try { localStorage.setItem(key, JSON.stringify({})); } catch {}
    }

    toggleDrawer(open){
      const wasOpen = this.classList.contains('drawer-open');
      const on = (open===undefined) ? !wasOpen : open;
      this.classList.toggle('drawer-open', on);
      document.documentElement.style.overflow = (on || this.classList.contains('top-open')) ? 'hidden' : '';
      if (wasOpen && !on) { this._collapseAllNavGroups(); }
    }
    toggleTop(open){
      const on = (open===undefined) ? !this.classList.contains('top-open') : open;
      this.classList.toggle('top-open', on);
      document.documentElement.style.overflow = (on || this.classList.contains('drawer-open')) ? 'hidden' : '';
    }

    _syncThemeChips(mode){
      this.shadowRoot.querySelectorAll('.js-theme').forEach(b=> b.setAttribute('aria-pressed', String(b.dataset.mode===mode)));
    }
    setTheme(mode){
      try{
        if(window.App && App.setTheme){ App.setTheme(mode); }
        else {
          document.documentElement.setAttribute('data-theme', mode === 'system' ? 'auto' : mode);
          document.documentElement.classList.toggle('dark',
            mode==='dark' || (mode==='system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
          );
          localStorage.setItem('fv-theme', mode);
        }
      }catch{}
      this._syncThemeChips(mode);
    }

    /* ===== PULL-TO-REFRESH ===== */
    _initPTR(){
      const bar = this._ptr;
      const txt = this._ptrTxt;
      const spin = this._ptrSpin;
      const dot = this._ptrDot;

      const THRESHOLD = 70; // px drag required
      let armed = false;     // only true if touchstart occurs at top
      let pulling = false;
      let startY = 0;
      let delta = 0;

      const atTop = () => (window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0) === 0;

      const onStart = (e)=>{
        // Only arm when the page itself is at the very top and drawers are closed
        if (!atTop() || this.classList.contains('drawer-open') || this.classList.contains('top-open')) {
          armed = false; pulling = false; return;
        }
        const t = e.touches ? e.touches[0] : e;
        startY = t.clientY;
        delta = 0;
        armed = true;
        pulling = false;
      };

      const onMove = (e)=>{
        if (!armed) return;
        const t = e.touches ? e.touches[0] : e;
        delta = Math.max(0, t.clientY - startY);
        if (delta > 0) {
          if (!pulling) {
            pulling = true;
            bar.classList.add('show');
            spin.hidden = true; dot.hidden = false;
            txt.textContent = 'Pull to refresh';
          }
          txt.textContent = (delta >= THRESHOLD) ? 'Release to refresh' : 'Pull to refresh';
          // prevent overscroll bounce from immediately scrolling content
          e.preventDefault();
        }
      };

      const doRefresh = async ()=>{
        dot.hidden = true; spin.hidden = false;
        txt.textContent = 'Refreshing…';
        document.dispatchEvent(new CustomEvent('fv:refresh'));
        await new Promise(res=> setTimeout(res, 900));
        bar.classList.remove('show');
        spin.hidden = true; dot.hidden = true;
        txt.textContent = 'Pull to refresh';
      };

      const onEnd = ()=>{
        if (!armed) return;
        if (pulling && delta >= THRESHOLD) {
          doRefresh();
        } else {
          bar.classList.remove('show');
        }
        armed = false; pulling = false; startY = 0; delta = 0;
      };

      // Passive false on touchmove so we can preventDefault() when pulling
      window.addEventListener('touchstart', onStart, { passive:true });
      window.addEventListener('touchmove', onMove, { passive:false });
      window.addEventListener('touchend', onEnd, { passive:true });
      window.addEventListener('touchcancel', onEnd, { passive:true });

      // Also support mouse (desktop testing)
      window.addEventListener('mousedown', onStart);
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onEnd);
    }

    /* ===== Auth: logout + label (Employees → Users → displayName → email) ===== */
    async _wireAuthLogout(r, mod){
      const logoutRow = r.getElementById('logoutRow');
      const logoutLabel = r.getElementById('logoutLabel');

      const LOGIN_URL = '/Farm-vista/pages/login/index.html';

      const bestUser = (auth)=> (auth && auth.currentUser) ||
                               (window.firebaseAuth && window.firebaseAuth.currentUser) ||
                               (window.__FV_USER) || null;

      const setLabelFromProfile = async () => {
        try{
          const auth = (mod && (window.firebaseAuth || (mod.getAuth && mod.getAuth()))) || window.firebaseAuth;
          const fs   = (mod && (mod.getFirestore && mod.getFirestore())) || window.firebaseFirestore;
          const user = bestUser(auth);

          if (!user) { logoutLabel.textContent = 'Logout'; return; }

          let name = '';

          // 1) Prefer employees/{emailKey} → firstName + lastName or fullName
          const email = (user.email || '').trim().toLowerCase();
          if (fs && mod && mod.doc && mod.getDoc && email) {
            try{
              const empRef = mod.doc(fs, 'employees', email);
              const empSnap = await mod.getDoc(empRef);
              const emp = empSnap && (typeof empSnap.data === 'function' ? empSnap.data() : empSnap.data);
              if (emp) {
                const fn = (emp.firstName || emp.first || '').toString().trim();
                const ln = (emp.lastName  || emp.last  || '').toString().trim();
                const full = (emp.fullName || `${fn} ${ln}`).trim();
                if (full) name = full;
              }
            }catch(e){ /* ignore and fall through */ }
          }

          // 2) Fallback to users/{uid}
          if (!name && fs && mod && mod.doc && mod.getDoc && user.uid) {
            try{
              const ref = mod.doc(fs, 'users', user.uid);
              const snap = await mod.getDoc(ref);
              const data = snap && (typeof snap.data === 'function' ? snap.data() : empSnap.data);
              if (data) {
                const fn = (data.firstName || data.first || '').toString().trim();
                const ln = (data.lastName  || data.last  || '').toString().trim();
                const full = `${fn} ${ln}`.trim();
                if (full) name = full;
              }
            }catch(e){ /* ignore */ }
          }

          // 3) displayName
          if (!name && user.displayName) name = String(user.displayName).trim();

          // 4) email
          if (!name && user.email) name = String(user.email).trim();

          logoutLabel.textContent = name ? `Logout ${name}` : 'Logout';
        }catch{
          logoutLabel.textContent = 'Logout';
        }
      };

      try{
        if (mod && mod.onIdTokenChanged && mod.onAuthStateChanged) {
          const ctx = await mod.ready.catch(()=>null);
          const auth = (ctx && ctx.auth) || (mod.getAuth && mod.getAuth()) || window.firebaseAuth;
          await setLabelFromProfile();
          mod.onIdTokenChanged(auth, async ()=>{ await setLabelFromProfile(); });
          mod.onAuthStateChanged(auth, async ()=>{ await setLabelFromProfile(); });

          let tries = 18;
          const tick = setInterval(async ()=>{
            await setLabelFromProfile();
            if (bestUser(auth) || --tries <= 0) clearInterval(tick);
          }, 150);

          if (logoutRow) {
            logoutRow.addEventListener('click', async (e)=>{
              e.preventDefault();
              this.toggleTop(false);
              this.toggleDrawer(false);
              try{
                if (typeof window.fvSignOut === 'function') { await window.fvSignOut(); }
                else if (mod && mod.signOut) { await mod.signOut(auth); }
              }catch(err){ console.warn('[FV] logout error:', err); }
              location.replace(LOGIN_URL);
            });
          }
        } else {
          if (logoutRow) {
            logoutRow.addEventListener('click', (e)=>{
              e.preventDefault();
              this.toggleTop(false);
              this.toggleDrawer(false);
              location.replace(LOGIN_URL);
            });
          }
          await setLabelFromProfile();
        }
      }catch(err){
        console.warn('[FV] auth wiring skipped:', err);
        if (logoutRow) {
          logoutRow.addEventListener('click', (e)=>{
            e.preventDefault();
            this.toggleTop(false);
            this.toggleDrawer(false);
            location.replace(LOGIN_URL);
          });
        }
      }
    }

    /* ===== Update flow ===== */
    async checkForUpdates(){
      const sleep = (ms)=> new Promise(res=> setTimeout(res, ms));

      async function readTargetVersion(){
        try{
          const resp = await fetch('/Farm-vista/js/version.js?ts=' + Date.now(), { cache:'reload' });
          const txt = await resp.text();
          const m = txt.match(/number\s*:\s*["']([\d.]+)["']/) || txt.match(/FV_NUMBER\s*=\s*["']([\d.]+)["']/);
          return (m && m[1]) || '';
        }catch{ return ''; }
      }

      try{
        const targetVer = await readTargetVersion();
        const cur = (window.FV_VERSION && window.FV_VERSION.number) ? String(window.FV_VERSION.number) : '';

        if (targetVer && cur && targetVer === cur) {
          this._toastMsg(`Already up to date (v${cur})`, 2200);
          return;
        }

        this._toastMsg('Clearing cache…', 900);

        if (navigator.serviceWorker) {
          try {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.map(r=> r.unregister()));
          } catch {}
        }
        if ('caches' in window) {
          try {
            const keys = await caches.keys();
            await Promise.all(keys.map(k => caches.delete(k)));
          } catch {}
        }

        await sleep(150);
        if (navigator.serviceWorker) {
          try { await navigator.serviceWorker.register('/Farm-vista/serviceworker.js?ts=' + Date.now()); } catch {}
        }

        this._toastMsg('Updating…', 1200);
        await sleep(320);
        const url = new URL(location.href);
        url.searchParams.set('rev', targetVer || String(Date.now()));
        location.replace(url.toString());
      }catch(e){
        console.error(e);
        this._toastMsg('Update failed. Try again.', 2400);
      }
    }

    _toastMsg(msg, ms=2000){
      const t = this._toast; if (!t) return;
      t.textContent = msg;
      t.classList.add('show');
      clearTimeout(this._tt);
      this._tt = setTimeout(()=> t.classList.remove('show'), ms);
    }
  }

  if (!customElements.get('fv-shell')) {
    customElements.define('fv-shell', FVShell);
  }
})();