/* /Farm-vista/js/fv-shell.js
   FarmVista Shell — v5.10.8 (sticky user/menu hotfix)
   - One-time boot overlay (blurred) "Loading. Please wait." ONLY on first load
     or when forced by pull-to-refresh / check-for-updates.
   - Logout label comes from FVUserContext (fallback to Firebase Auth) with sticky cache.
   - Menu filtered by FVMenuACL + FVUserContext.allowedIds.
   - NEW: Uses cached user context to prevent “full menu flash” and missing name between page loads.
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

    /* One-time boot overlay (default hidden unless forced) */
    .boot{ position:fixed; inset:0; z-index:2000; display:flex; align-items:center; justify-content:center;
      background:color-mix(in srgb, #000 25%, transparent);
      backdrop-filter: blur(6px) saturate(1.1); -webkit-backdrop-filter: blur(6px) saturate(1.1);
      color:#fff; transition: opacity .22s ease, visibility .22s ease; }
    .boot[hidden]{ opacity:0; visibility:hidden; pointer-events:none; }
    .boot-card{ background: rgba(21,23,21,.85); border:1px solid rgba(255,255,255,.14); border-radius:14px; padding:18px 20px;
      box-shadow:0 18px 44px rgba(0,0,0,.4); display:flex; align-items:center; gap:12px; font-weight:800;}
    .spin{ width:18px; height:18px; border-radius:50%; border:2.25px solid rgba(255,255,255,.35); border-top-color:#fff; animation:spin .8s linear infinite; }
    @keyframes spin{ to{ transform:rotate(360deg); } }
    .boot-text{ font-size:15px; letter-spacing:.2px; }

    .ptr{ position:fixed; top:calc(var(--hdr-h) + env(safe-area-inset-top,0px) + 3px); left:0; right:0; height:54px; background:var(--surface,#fff);
      color:var(--text,#111); border-bottom:1px solid var(--border,#e4e7e4); display:flex; align-items:center; justify-content:center; gap:10px;
      z-index:998; transform:translateY(-56px); transition:transform .16s ease; will-change:transform; pointer-events:none; }
    .ptr.show{ transform:translateY(0); }
    .ptr .spinner{ width:18px;height:18px;border-radius:50%; border:2.25px solid #c9cec9;border-top-color:var(--green,#3B7E46); animation:spin 800ms linear infinite; }
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

  <!-- One-time boot overlay: shown only if session not hydrated OR forced -->
  <div class="boot js-boot" hidden>
    <div class="boot-card">
      <div class="spin" aria-hidden="true"></div>
      <div class="boot-text">Loading. Please wait.</div>
    </div>
  </div>

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

  const CACHE_KEY_CTX = 'fv:lastUserCtx'; // session-scoped, survives page changes inside the same tab
  const BOOT_FLAG = 'fv:boot:hydrated';
  const FORCE_ONCE = 'fv:boot:forceOnce';

  function readCachedCtx(){
    try { return JSON.parse(sessionStorage.getItem(CACHE_KEY_CTX) || 'null'); } catch { return null; }
  }
  function writeCachedCtx(ctx){
    try {
      if (!ctx) { sessionStorage.removeItem(CACHE_KEY_CTX); return; }
      const slim = {
        uid: ctx.uid || null,
        displayName: ctx.displayName || null,
        email: ctx.email || null,
        allowedIds: Array.isArray(ctx.allowedIds) ? ctx.allowedIds : null,
        roles: Array.isArray(ctx.roles) ? ctx.roles : null,
        t: Date.now()
      };
      sessionStorage.setItem(CACHE_KEY_CTX, JSON.stringify(slim));
    } catch {}
  }

  class FVShell extends HTMLElement {
    constructor(){ super(); this.attachShadow({mode:'open'}).appendChild(tpl.content.cloneNode(true)); }

    connectedCallback(){
      const r = this.shadowRoot;
      this._btnMenu = r.querySelector('.js-menu');
      this._btnAccount = r.querySelector('.js-account');
      this._scrim = r.querySelector('.js-scrim');
      this._drawer = r.querySelector('.drawer');
      this._top = r.querySelector('.js-top');
      this._footerText = r.querySelector('.js-footer');
      this._toast = r.querySelector('.js-toast');
      this._verEl = r.querySelector('.js-ver');
      this._sloganEl = r.querySelector('.js-slogan');
      this._navEl = r.querySelector('.js-nav');
      this._boot = r.querySelector('.js-boot');
      this._logoutLabel = r.getElementById('logoutLabel');

      // Show boot overlay only if first-load OR forced
      const shouldBoot = !sessionStorage.getItem(BOOT_FLAG) ||
                         sessionStorage.getItem(FORCE_ONCE) === '1';
      if (this._boot) this._boot.hidden = !shouldBoot;

      // Clear force flag if it existed
      sessionStorage.removeItem(FORCE_ONCE);

      // header buttons & theme
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

      // Boot
      this._bootSequence();
    }

    /* =================== Boot sequence (order matters) =================== */
    async _bootSequence(){
      await this._loadScriptOnce('/Farm-vista/js/version.js').catch(()=>{});
      this._applyVersionToUI();

      await this._loadScriptOnce('/Farm-vista/js/firebase-config.js').catch(()=>{});
      await this._ensureFirebaseInit(); // tolerant

      // user-context + menu-acl
      await this._loadScriptOnce('/Farm-vista/js/app/user-context.js').catch(()=>{});
      await this._loadScriptOnce('/Farm-vista/js/menu-acl.js').catch(()=>{});

      // 1) Paint immediately from cached context (no flicker)
      const cached = readCachedCtx();
      if (cached && Array.isArray(cached.allowedIds)) {
        await this._initMenuFiltered(cached); // render from cache
      }

      // 2) Wait for live user context (with timeout)
      const ctx = await this._waitForUserContext(5000);

      // If we never had cached AND live ctx is still missing, keep boot up and bail (no unfiltered menu).
      if (!cached && !ctx) {
        // leave boot visible; try a light retry once after a short delay
        setTimeout(()=> this._refreshMenuFromLive(), 800);
        return;
      }

      // 3) If live context exists and differs from cached, re-render + update cache
      if (ctx) {
        writeCachedCtx(ctx);
        await this._initMenuFiltered(ctx);
      }

      // Wire logout label and actions (sticky)
      this._wireAuthLogout(this.shadowRoot);

      // Hide boot overlay and mark hydrated (one per tab session)
      if (this._boot) this._boot.hidden = true;
      sessionStorage.setItem(BOOT_FLAG, '1');

      // PTR & misc
      const upd = this.shadowRoot.querySelector('.js-update-row');
      if (upd) upd.addEventListener('click', (e)=> { e.preventDefault(); this.checkForUpdates(); });

      const r = this.shadowRoot;
      const ud = r.getElementById('userDetailsLink'); if (ud) ud.addEventListener('click', () => { this.toggleTop(false); });
      const fb = r.getElementById('feedbackLink'); if (fb) fb.addEventListener('click', () => { this.toggleTop(false); });

      this._initPTR();
    }

    async _refreshMenuFromLive(){
      const ctx = (window.FVUserContext && window.FVUserContext.get && window.FVUserContext.get()) || null;
      if (!ctx) return;
      writeCachedCtx(ctx);
      await this._initMenuFiltered(ctx);
      if (this._boot) this._boot.hidden = true;
      sessionStorage.setItem(BOOT_FLAG, '1');
    }

    async _ensureFirebaseInit(){
      try {
        if (!window.__FV_FIREBASE_INIT_LOADED__) {
          window.__FV_FIREBASE_INIT_LOADED__ = true;
          await this._loadScriptOnce('/Farm-vista/js/firebase-init.js', { type:'module' });
        }
      } catch (e) { /* ignore */ }
    }

    _applyVersionToUI(){
      const v = (window && window.FV_VERSION) || {};
      const num = (v.number || '').toString().replace(/^\s*v/i,'').trim() || '0.0.0';
      const tag = (v.tagline || 'Simplified');
      if (this._verEl) this._verEl.textContent = `v${num}`;
      if (this._sloganEl) this._sloganEl.textContent = tag;
    }

    _loadScriptOnce(src, opts){
      return new Promise((resolve, reject)=>{
        const exists = Array.from(document.scripts).some(s=> (s.getAttribute('src')||'') === src);
        if (exists) { resolve(); return; }
        const s = document.createElement('script');
        if (opts && opts.type) s.type = opts.type;
        s.defer = true;
        s.src = src;
        s.onload = ()=> resolve();
        s.onerror = (e)=> reject(e);
        document.head.appendChild(s);
      });
    }

    async _waitForUserContext(timeoutMs){
      const start = Date.now();
      const good = () => {
        const g = window.FVUserContext && window.FVUserContext.get && window.FVUserContext.get();
        return g && (Array.isArray(g.allowedIds) || Array.isArray(g.roles));
      };
      if (good()) return window.FVUserContext.get();
      try { if (window.FVUserContext && window.FVUserContext.ready) await window.FVUserContext.ready(); } catch {}
      while (!good() && (Date.now() - start) < timeoutMs) await new Promise(r => setTimeout(r, 120));
      return good() ? window.FVUserContext.get() : null;
    }

    async _loadMenu(){
      const url = location.origin + '/Farm-vista/js/menu.js?v=' + Date.now();
      try{
        const mod = await import(url);
        return (mod && (mod.NAV_MENU || mod.default)) || null;
      }catch(e){
        try{
          await new Promise((res, rej)=>{
            const s = document.createElement('script');
            s.src = url; s.defer = true; s.onload = ()=> res(); s.onerror = (err)=> rej(err);
            document.head.appendChild(s);
          });
          return (window && window.FV_MENU) || null;
        }catch(err){
          console.error('[FV] Unable to load menu:', err);
          return null;
        }
      }
    }

    async _initMenuFiltered(ctxMaybe){
      const NAV_MENU = await this._loadMenu();
      if (!NAV_MENU || !Array.isArray(NAV_MENU.items)) return;

      const ctx = ctxMaybe || (window.FVUserContext && window.FVUserContext.get && window.FVUserContext.get()) || readCachedCtx() || null;

      // If no context at all, do NOT render an unfiltered menu (prevents “entire menu” flash).
      if (!ctx) return;

      const allowedIds = Array.isArray(ctx.allowedIds) ? ctx.allowedIds : [];
      let filtered = NAV_MENU;
      try {
        if (window.FVMenuACL && typeof window.FVMenuACL.filter === 'function') {
          filtered = window.FVMenuACL.filter(NAV_MENU, allowedIds);
        }
      } catch {}

      this._renderMenu(filtered);
    }

    _renderMenu(cfg){
      const nav = this._navEl; if (!nav) return;
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
      const bar = this._ptr = this.shadowRoot.querySelector('.js-ptr');
      const txt = this._ptrTxt = this.shadowRoot.querySelector('.js-txt');
      const spin = this._ptrSpin = this.shadowRoot.querySelector('.js-spin');
      const dot = this._ptrDot = this.shadowRoot.querySelector('.js-dot');

      const THRESHOLD = 70; let armed=false, pulling=false, startY=0, delta=0;
      const atTop = () => (window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0) === 0;

      const onStart = (e)=>{
        if (!atTop() || this.classList.contains('drawer-open') || this.classList.contains('top-open')) { armed=false; pulling=false; return; }
        const t = e.touches ? e.touches[0] : e; startY = t.clientY; delta=0; armed=true; pulling=false;
      };
      const onMove = (e)=>{
        if (!armed) return;
        const t = e.touches ? e.touches[0] : e; delta = Math.max(0, t.clientY - startY);
        if (delta > 0) {
          if (!pulling) { pulling=true; bar.classList.add('show'); spin.hidden=true; dot.hidden=false; txt.textContent='Pull to refresh'; }
          txt.textContent = (delta >= THRESHOLD) ? 'Release to refresh' : 'Pull to refresh';
          e.preventDefault();
        }
      };
      const doRefresh = async ()=>{
        dot.hidden=true; spin.hidden=false; txt.textContent='Refreshing…';
        document.dispatchEvent(new CustomEvent('fv:refresh'));
        try { window.FVUserContext && window.FVUserContext.clear && window.FVUserContext.clear(); } catch {}
        // Force the next page to show the boot once
        sessionStorage.setItem(FORCE_ONCE,'1');
        try { await (window.FVUserContext && window.FVUserContext.ready ? window.FVUserContext.ready() : Promise.resolve()); } catch {}
        await this._refreshMenuFromLive();
        await new Promise(res=> setTimeout(res, 900));
        bar.classList.remove('show'); spin.hidden=true; dot.hidden=true; txt.textContent='Pull to refresh';
      };
      const onEnd = ()=>{ if (!armed) return; if (pulling && delta >= THRESHOLD) doRefresh(); else bar.classList.remove('show'); armed=false; pulling=false; startY=0; delta=0; };

      window.addEventListener('touchstart', onStart, { passive:true });
      window.addEventListener('touchmove', onMove, { passive:false });
      window.addEventListener('touchend', onEnd, { passive:true });
      window.addEventListener('touchcancel', onEnd, { passive:true });
      window.addEventListener('mousedown', onStart);
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onEnd);
    }

    /* ===== Auth + Logout label (sticky) ===== */
    _wireAuthLogout(r){
      const logoutRow = r.getElementById('logoutRow');
      const logoutLabel = r.getElementById('logoutLabel');
      const LOGIN_URL = '/Farm-vista/pages/login/index.html';

      const cached = readCachedCtx();

      const setLabel = ()=>{
        // Prefer live context, otherwise stick to cached name instead of blanking.
        let name = '';
        try {
          const ctx = window.FVUserContext && window.FVUserContext.get && window.FVUserContext.get();
          if (ctx && (ctx.displayName || ctx.email)) name = ctx.displayName || ctx.email;
        } catch {}
        if (!name && cached && (cached.displayName || cached.email)) {
          name = cached.displayName || cached.email;
        }
        if (!name && window.firebaseAuth && window.firebaseAuth.currentUser) {
          const u = window.firebaseAuth.currentUser;
          name = u.displayName || u.email || '';
        }
        logoutLabel.textContent = name ? `Logout ${name}` : 'Logout';
      };

      setLabel();
      try {
        if (window.FVUserContext && typeof window.FVUserContext.onChange === 'function') {
          window.FVUserContext.onChange((ctx) => {
            if (ctx) writeCachedCtx(ctx);
            setLabel();
          });
        }
      } catch {}

      // Short “settling” window to catch late auth rehydration
      let tries = 30; const tick = setInterval(()=>{ setLabel(); if(--tries<=0) clearInterval(tick); }, 200);

      if (logoutRow) {
        logoutRow.addEventListener('click', async (e)=>{
          e.preventDefault();
          this.toggleTop(false); this.toggleDrawer(false);
          try{ if (typeof window.fvSignOut === 'function') await window.fvSignOut(); }catch(e){}
          try { window.FVUserContext && window.FVUserContext.clear && window.FVUserContext.clear(); } catch {}
          sessionStorage.removeItem(BOOT_FLAG);
          sessionStorage.removeItem(CACHE_KEY_CTX);
          location.replace(LOGIN_URL);
        });
      }
    }

    /* ===== Version + updates ===== */
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

        if (targetVer && cur && targetVer === cur) { this._toastMsg(`Already up to date (v${cur})`, 2200); return; }

        this._toastMsg('Clearing cache…', 900);

        if (navigator.serviceWorker) {
          try { const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(r=> r.unregister())); } catch {}
        }
        if ('caches' in window) {
          try { const keys = await caches.keys(); await Promise.all(keys.map(k => caches.delete(k))); } catch {}
        }

        try { window.FVUserContext && window.FVUserContext.clear && window.FVUserContext.clear(); } catch {}
        // Force next boot once after update
        sessionStorage.setItem(FORCE_ONCE,'1');

        await sleep(150);
        if (navigator.serviceWorker) { try { await navigator.serviceWorker.register('/Farm-vista/serviceworker.js?ts=' + Date.now()); } catch {} }

        this._toastMsg('Updating…', 1200);
        await sleep(320);
        const url = new URL(location.href); url.searchParams.set('rev', targetVer || String(Date.now()));
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

  if (!customElements.get('fv-shell')) customElements.define('fv-shell', FVShell);
})();