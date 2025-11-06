/* /Farm-vista/js/fv-shell.js
   FarmVista Shell — v5.10.20
   - Fix: iOS Safari bottom toolbar clipping footer.
     * In iOS browser (not standalone), footer becomes sticky (bottom:0) instead of fixed.
     * In standalone/Android/desktop, footer remains fixed.
   - QR mini icon stays inside footer (left), hidden on desktop.
*/
(function () {
  const AUTH_MAX_MS = 5000;
  const MENU_MAX_MS = 3000;

  const tpl = document.createElement('template');
  tpl.innerHTML = `
  <style>
    :host{ --green:#3B7E46; --gold:#D0C542; --hdr-h:56px; --ftr-h:14px;
      display:block; color:#141514; background:#fff; min-height:100vh; position:relative; }

    /* ===== Header ===== */
    .hdr{ position:fixed; inset:0 0 auto 0; height:calc(var(--hdr-h) + env(safe-area-inset-top,0px));
      padding-top:env(safe-area-inset-top,0px); background:var(--green); color:#fff;
      display:grid; grid-template-columns:56px 1fr 56px; align-items:center; z-index:1000; box-shadow:0 2px 0 rgba(0,0,0,.05); }
    .hdr .title{ text-align:center; font-weight:800; font-size:20px; }
    .iconbtn{ display:grid; place-items:center; width:48px; height:48px; border:none; background:transparent; color:#fff; font-size:28px; line-height:1; -webkit-tap-highlight-color: transparent; margin:0 auto;}
    .iconbtn svg{ width:26px; height:26px; display:block; }
    .gold-bar{ position:fixed; top:calc(var(--hdr-h) + env(safe-area-inset-top,0px)); left:0; right:0; height:3px; background:var(--gold); z-index:999; }

    /* ===== Boot Overlay ===== */
    .boot{ position:fixed; inset:0; z-index:2000; display:flex; align-items:center; justify-content:center;
      background:color-mix(in srgb, #000 25%, transparent);
      backdrop-filter: blur(6px) saturate(1.1); -webkit-backdrop-filter: blur(6px) saturate(1.1);
      color:#fff; transition: opacity .22s ease, visibility .22s ease; }
    .boot[hidden]{ opacity:0; visibility:hidden; pointer-events:none; }
    .boot-card{ background: rgba(21,23,21,.85); border:1px solid rgba(255,255,255,.14); border-radius:14px; padding:18px 20px;
      box-shadow:0 18px 44px rgba(0,0,0,.4); display:flex; align-items:center; gap:12px; font-weight:800;}
    .spin{ width:18px; height:18px; border-radius:50%; border:2.25px solid rgba(255,255,255,.35); border-top-color:#fff; animation:spin .8s linear infinite; }
    @keyframes spin{ to{ transform:rotate(360deg); } }

    /* ===== Pull To Refresh ===== */
    .ptr{ position:fixed; top:calc(var(--hdr-h) + env(safe-area-inset-top,0px) + 3px); left:0; right:0; height:54px; background:var(--surface,#fff);
      color:var(--text,#111); border-bottom:1px solid var(--border,#e4e7e4); display:flex; align-items:center; justify-content:center; gap:10px;
      z-index:998; transform:translateY(-56px); transition:transform .16s ease; will-change: transform, opacity; pointer-events:none; }
    .ptr.show{ transform:translateY(0); }
    .ptr .spinner{ width:18px;height:18px;border-radius:50%; border:2.25px solid #c9cec9;border-top-color:var(--green,#3B7E46); animation:spin 800ms linear infinite; }
    .ptr .dot{ width:10px; height:10px; border-radius:50%; background:var(--green,#3B7E46); }
    .ptr .txt{ font-weight:800; }

    /* ===== Footer (default = fixed) ===== */
    .ftr{
      position:fixed; inset:auto 0 0 0;
      height:calc(var(--ftr-h) + env(safe-area-inset-bottom,0px));
      padding-bottom:env(safe-area-inset-bottom,0px);
      background:var(--green); color:#fff; border-top:2px solid var(--gold); z-index:900;
      display:grid; grid-template-columns:44px 1fr 12px; align-items:center;
    }
    .ftr .text{ font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; justify-self:center; }

    /* iOS Safari (browser, not standalone): footer becomes sticky so it never sits under the toolbar */
    :host(.ios-browser) .ftr{
      position:sticky; bottom:0; inset:auto 0 auto 0; z-index:900;
    }

    /* QR camera icon in footer (white) */
    .qr-mini{
      place-self:center start;
      width:28px; height:28px; display:grid; place-items:center; color:#fff; opacity:.98;
      text-decoration:none; -webkit-tap-highlight-color:transparent; margin-left:8px;
    }
    .qr-mini svg{ width:22px; height:22px; display:block; }
    .qr-mini:active{ transform:translateY(1px); }

    /* ===== Main ===== */
    .main{
      position:relative;
      padding: calc(var(--hdr-h) + env(safe-area-inset-top,0px) + 11px) 16px
               calc(var(--ftr-h) + env(safe-area-inset-bottom,0px) + 16px);
      min-height:100vh; box-sizing:border-box; background: var(--bg); color: var(--text);
    }
    /* In ios-browser mode footer is in flow; reduce bottom padding */
    :host(.ios-browser) .main{
      padding-bottom: 16px;
      min-height: calc(100dvh - var(--hdr-h) - 3px); /* dynamic viewport prevents jump under Safari bars */
    }

    ::slotted(.container){ max-width:980px; margin:0 auto; }

    /* ===== Overlay + Drawers ===== */
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
    .drawer nav .skeleton{ padding:16px; color:#777; }
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

    :host(.ui-locked) .main { touch-action: none; }
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

  <div class="boot js-boot"><div class="boot-card"><div class="spin" aria-hidden="true"></div><div>Loading. Please wait.</div></div></div>

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
    <nav class="js-nav"><div class="skeleton">Loading menu…</div></nav>
    <footer class="drawer-footer">
      <div class="df-left"><div class="brand">FarmVista</div><div class="slogan js-slogan">Loading…</div></div>
      <div class="df-right"><span class="js-ver">v0.0.0</span></div>
    </footer>
  </aside>

  <section class="topdrawer js-top" role="dialog" aria-label="Account & settings">
    <div class="topwrap">
      <div class="brandrow"><img src="/Farm-vista/assets/icons/icon-192.png" alt="" /><div class="brandname">FarmVista</div></div>

      <div class="section-h">THEME</div>
      <div class="chips">
        <button class="chip js-theme" data-mode="system" aria-pressed="true">System</button>
        <button class="chip js-theme" data-mode="light"  aria-pressed="false">Light</button>
        <button class="chip js-theme" data-mode="dark"   aria-pressed="false">Dark</button>
      </div>

      <div class="section-h">PROFILE</div>
      <a class="row" id="userDetailsLink" href="/Farm-vista/pages/user-details/index.html"><div class="left"><div class="ico">🧾</div><div class="txt">User Details</div></div><div class="chev">›</div></a>
      <a class="row" id="feedbackLink" href="/Farm-vista/pages/feedback/index.html"><div class="left"><div class="ico">💬</div><div class="txt">Feedback</div></div><div class="chev">›</div></a>

      <div class="section-h">MAINTENANCE</div>
      <a class="row js-conn" href="#" tabindex="-1" aria-disabled="true" title="Shows Online only when network and cloud are both ready"><div class="left"><div class="ico">🌐</div><div class="txt">Connection: <span class="js-conn-text">Checking…</span></div></div><div class="chev">•</div></a>
      <a class="row js-update-row" href="#"><div class="left"><div class="ico">⟳</div><div class="txt">Check for updates</div></div><div class="chev">›</div></a>
      <a class="row" href="#" id="logoutRow"><div class="left"><div class="ico">⏻</div><div class="txt" id="logoutLabel">Logout</div></div><div class="chev">›</div></a>
    </div>
  </section>

  <main class="main" part="main"><slot></slot></main>

  <footer class="ftr" part="footer">
    <a class="qr-mini" href="/Farm-vista/pages/qr-scan.html" aria-label="Open QR Scanner">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 7.5l1.2-1.6c.2-.3.5-.4.9-.4h1.8c.3 0 .6.2.8.4L15 7.5h2.2c1.5 0 2.8 1.2 2.8 2.8v6.2c0 1.5-1.2 2.8-2.8 2.8H6.8C5.2 19.3 4 18 4 16.5V10.3C4 8.7 5.2 7.5 6.8 7.5H9z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
        <circle cx="12" cy="13.5" r="3.6" fill="none" stroke="currentColor" stroke-width="1.6"/>
      </svg>
    </a>
    <div class="text js-footer"></div>
    <div aria-hidden="true"></div>
  </footer>

  <div class="toast js-toast" role="status" aria-live="polite"></div>
  `;

  class FVShell extends HTMLElement {
    constructor(){
      super();
      this.attachShadow({mode:'open'}).appendChild(tpl.content.cloneNode(true));
      this._menuPainted = false;
      this._lastLogoutName = '';
      this._lastUID = '';
      this._lastRoleHash = '';
      this.LOGIN_URL = '/Farm-vista/pages/login/index.html';

      this._scrollLocked = false;
      this._scrollY = 0;
      this._isIOSStandaloneFlag = null;
      this._scrimTouchBlocker = (e)=>{ e.preventDefault(); e.stopPropagation(); };
      this._ptrDisabled = false;
    }

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
      this._connRow = r.querySelector('.js-conn');
      this._connTxt = r.querySelector('.js-conn-text');

      // Platform flags
      const ua = (navigator.userAgent||'').toLowerCase();
      const isIOS = /iphone|ipad|ipod/.test(ua);
      const isStandalone = (window.navigator.standalone === true) ||
        (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
      const isMobile = /iphone|ipad|ipod|android/i.test(navigator.userAgent||'');

      // In iOS browser (not standalone), use sticky footer to dodge the toolbar
      if (isIOS && !isStandalone) this.classList.add('ios-browser');

      // Hide QR icon on desktop; show on phones
      const qrMini = r.querySelector('.qr-mini');
      if (qrMini && !isMobile) qrMini.style.display = 'none';

      // Footer text
      const now = new Date();
      const dateStr = now.toLocaleDateString(undefined, { weekday:'long', year:'numeric', month:'long', day:'numeric' });
      this._footerText.textContent = `© ${now.getFullYear()} FarmVista • ${dateStr}`;

      // Wire header buttons
      this._btnMenu.addEventListener('click', ()=> { this.toggleTop(false); this.toggleDrawer(true); });
      this._scrim.addEventListener('click', ()=> { this.toggleDrawer(false); this.toggleTop(false); });
      this._btnAccount.addEventListener('click', ()=> { this.toggleDrawer(false); this.toggleTop(); });
      document.addEventListener('keydown', (e)=>{ if(e.key==='Escape'){ this.toggleDrawer(false); this.toggleTop(false); } });

      r.querySelectorAll('.js-theme').forEach(btn=> btn.addEventListener('click', ()=> this.setTheme(btn.dataset.mode)));
      document.addEventListener('fv:theme', (e)=> this._syncThemeChips(e.detail.mode));
      this._syncThemeChips((window.App && App.getTheme && App.getTheme()) || 'system');

      if (this._boot) this._boot.hidden = false;
      this._bootSequence();

      window.addEventListener('orientationchange', ()=>{ this._setScrollLock(false); }, { passive:true });
      window.addEventListener('resize', ()=>{ if (this._scrollLocked) this._applyBodyFixedStyles(); }, { passive:true });
    }

    _isIOSStandalone(){
      if (this._isIOSStandaloneFlag != null) return this._isIOSStandaloneFlag;
      const ua = (navigator.userAgent || '').toLowerCase();
      const isIOS = /iphone|ipad|ipod/.test(ua);
      const isStandalone = (window.navigator.standalone === true) ||
        (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
      this._isIOSStandaloneFlag = !!(isIOS && isStandalone);
      return this._isIOSStandaloneFlag;
    }

    async _bootSequence(){
      await this._loadScriptOnce('/Farm-vista/js/version.js').catch(()=>{});
      this._applyVersionToUI();

      await this._loadScriptOnce('/Farm-vista/js/firebase-config.js').catch(()=>{});
      await this._ensureFirebaseInit();

      await this._loadScriptOnce('/Farm-vista/js/app/user-context.js').catch(()=>{});
      await this._loadScriptOnce('/Farm-vista/js/menu-acl.js').catch(()=>{});

      await this._authAndMenuGate();

      this._wireAuthLogout(this.shadowRoot);
      this._initConnectionStatus();
      this._watchUserContextForSwaps();

      if (this._boot) this._boot.hidden = true;
      sessionStorage.setItem('fv:boot:hydrated', '1');

      const upd = this.shadowRoot.querySelector('.js-update-row');
      if (upd) upd.addEventListener('click', (e)=> { e.preventDefault(); this.checkForUpdates(); });

      const r = this.shadowRoot;
      const ud = r.getElementById('userDetailsLink'); if (ud) ud.addEventListener('click', () => { this.toggleTop(false); });
      const fb = r.getElementById('feedbackLink'); if (fb) fb.addEventListener('click', () => { this.toggleTop(false); });

      this._initPTR();
      setTimeout(()=> this._postPaintSanity(), 300);
    }

    async _authAndMenuGate(){
      const deadline = Date.now() + AUTH_MAX_MS;
      while (Date.now() < deadline) {
        if (await this._isAuthed() && this._hasUserCtx()) break;
        await this._sleep(120);
      }
      if (!(await this._isAuthed()) || !this._hasUserCtx()) {
        this._kickToLogin('auth-timeout'); return Promise.reject('auth-timeout');
      }
      const { uid, roleHash } = this._currentUIDAndRoleHash();
      this._lastUID = uid; this._lastRoleHash = roleHash;
      await this._initMenuFiltered();

      const menuDeadline = Date.now() + MENU_MAX_MS;
      while (Date.now() < menuDeadline) {
        if (this._hasMenuLinks()) break;
        await this._sleep(120);
      }
      if (!this._hasMenuLinks()) {
        this._kickToLogin('menu-timeout'); return Promise.reject('menu-timeout');
      }
      this._setLogoutLabelNow();
    }

    _kickToLogin(reason){
      try{
        const url = new URL(this.LOGIN_URL, location.origin);
        url.searchParams.set('reason', reason || 'guard');
        url.searchParams.set('next', location.pathname + location.search + location.hash);
        location.replace(url.toString());
      }catch{ location.replace(this.LOGIN_URL); }
    }

    async _ensureFirebaseInit(){
      try {
        if (!window.__FV_FIREBASE_INIT_LOADED__) {
          window.__FV_FIREBASE_INIT_LOADED__ = true;
          await this._loadScriptOnce('/Farm-vista/js/firebase-init.js', { type:'module' });
        }
      } catch {}
    }

    async _isAuthed(){
      try{
        const mod = await import('/Farm-vista/js/firebase-init.js');
        const ctx = await mod.ready;
        const auth = (ctx && ctx.auth) || window.firebaseAuth || null;
        return !!(auth && auth.currentUser);
      }catch{ return false; }
    }
    _hasUserCtx(){
      try{
        const u = window.FVUserContext && window.FVUserContext.get && window.FVUserContext.get();
        return !!u;
      }catch{ return false; }
    }
    _hasMenuLinks(){
      const nav = this._navEl;
      if (!nav) return false;
      return nav.querySelectorAll('a[href]').length > 0;
    }
    _setLogoutLabelNow(){
      const logoutLabel = this._logoutLabel; if (!logoutLabel) return;
      let name = '';
      try{
        const ctx = window.FVUserContext && window.FVUserContext.get && window.FVUserContext.get();
        if (ctx && (ctx.displayName || ctx.email)) name = ctx.displayName || ctx.email;
      }catch{}
      try{
        if (!name && window.firebaseAuth && window.firebaseAuth.currentUser) {
          const u = window.firebaseAuth.currentUser;
          name = u && (u.displayName || u.email) || '';
        }
      }catch{}
      if (name) this._lastLogoutName = name;
      logoutLabel.textContent = (this._lastLogoutName || name) ? `Logout ${this._lastLogoutName || name}` : 'Logout';
    }

    _sleep(ms){ return new Promise(r=> setTimeout(r, ms)); }
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

    _watchUserContextForSwaps(){
      const update = async ()=>{
        const { uid, roleHash } = this._currentUIDAndRoleHash();
        const changed = (!!uid && uid !== this._lastUID) || (!!roleHash && roleHash !== this._lastRoleHash);
        if (!changed) return;

        sessionStorage.removeItem('fv:boot:hydrated');
        if (this._boot) this._boot.hidden = false;

        this._clearMenuStateFor(this._lastUID, this._lastRoleHash);
        this._paintSkeleton();

        this._lastUID = uid;
        this._lastRoleHash = roleHash;
        this._menuPainted = false;

        await this._initMenuFiltered();

        const menuDeadline = Date.now() + MENU_MAX_MS;
        while (Date.now() < menuDeadline) {
          if (this._hasMenuLinks()) break;
          await this._sleep(120);
        }
        if (!this._hasMenuLinks()) {
          this._kickToLogin('menu-timeout'); return;
        }
        this._setLogoutLabelNow();
        if (this._boot) this._boot.hidden = true;
        sessionStorage.setItem('fv:boot:hydrated', '1');
      };

      try {
        if (window.FVUserContext && typeof window.FVUserContext.onChange === 'function') {
          window.FVUserContext.onChange(update);
        }
      } catch {}
    }

    _paintSkeleton(){
      if (!this._navEl) return;
      this._navEl.innerHTML = `<div class="skeleton">Loading menu…</div>`;
      this._collapseAllNavGroups();
    }
    _clearMenuStateFor(uid, roleHash){
      try {
        const key = this._navStateKeyFor(uid, roleHash);
        if (key) localStorage.removeItem(key);
      } catch {}
    }
    _currentUIDAndRoleHash(){
      let uid = '';
      try {
        const auth = (window.firebaseAuth) || null;
        if (auth && auth.currentUser && auth.currentUser.uid) uid = auth.currentUser.uid;
      } catch {}
      let roleHash = '';
      try {
        const ctx = window.FVUserContext && window.FVUserContext.get && window.FVUserContext.get();
        const ids = (ctx && Array.isArray(ctx.allowedIds)) ? ctx.allowedIds : [];
        roleHash = this._hashIDs(ids);
      } catch {}
      return { uid, roleHash };
    }
    _hashIDs(arr){
      const s = (arr||[]).slice().sort().join('|');
      let h = 5381; for (let i=0;i<s.length;i++) { h = ((h<<5)+h) ^ s.charCodeAt(i); }
      return ('h' + (h>>>0).toString(36));
    }
    _navStateKeyFor(uid, roleHash){
      if (!uid) return null;
      return `fv:nav:groups:${uid}:${roleHash||'no-role'}`;
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
    _countLinks(cfg){ let n=0; (function walk(nodes){ (nodes||[]).forEach(it=>{ if (it.type==='link') n++; if (it.children) walk(it.children); }); })(cfg&&cfg.items); return n; }
    _collectAllLinks(cfg){ const out=[]; (function walk(nodes){ (nodes||[]).forEach(it=>{ if (it.type==='link') out.push(it); if (it.children) walk(it.children); }); })(cfg&&cfg.items); return out; }
    _looksLikeHome(link){
      const id = (link.id||'').toLowerCase();
      const lbl = (link.label||'').toLowerCase();
      const href = (link.href||'');
      const p = href ? new URL(href, location.href).pathname : '';
      if (id.includes('home') || id.includes('dashboard')) return true;
      if (lbl.includes('home') || lbl.includes('dashboard')) return true;
      return (p === '/Farm-vista/' || p === '/Farm-vista/index.html');
    }

    async _initMenuFiltered(){
      const NAV_MENU = await this._loadMenu();
      if (!NAV_MENU || !Array.isArray(NAV_MENU.items)) return;

      const ctx = (window.FVUserContext && window.FVUserContext.get && window.FVUserContext.get()) || null;
      const allowedIds = (ctx && Array.isArray(ctx.allowedIds)) ? ctx.allowedIds : [];

      if (!this._menuPainted && allowedIds.length === 0) { this._paintSkeleton(); return; }
      if (this._menuPainted && allowedIds.length === 0) return;

      const filtered = (window.FVMenuACL && window.FVMenuACL.filter) ? window.FVMenuACL.filter(NAV_MENU, allowedIds) : NAV_MENU;

      let cfgToRender = filtered;
      let linkCount = this._countLinks(filtered);

      if (linkCount === 0 && allowedIds.length > 0) {
        const allLinks = this._collectAllLinks(NAV_MENU);
        const set = new Set(allowedIds);
        const rescued = allLinks.filter(l => set.has(l.id));
        const homeLink = allLinks.find(l => this._looksLikeHome(l));
        if (homeLink && !rescued.includes(homeLink)) rescued.unshift(homeLink);
        cfgToRender = { items: rescued.map(l => ({ type:'link', id:l.id, label:l.label, href:l.href, icon:l.icon, activeMatch:l.activeMatch })) };
      } else {
        const alreadyHasHome = (()=> {
          const links = this._collectAllLinks(filtered);
          return links.some(l => this._looksLikeHome(l));
        })();
        if (!alreadyHasHome) {
          const allLinks = this._collectAllLinks(NAV_MENU);
          const homeLink = allLinks.find(l => this._looksLikeHome(l));
          if (homeLink) {
            cfgToRender = {
              items: [{ type:'link', id:homeLink.id, label:homeLink.label, href:homeLink.href, icon:homeLink.icon, activeMatch:homeLink.activeMatch }]
                     .concat(filtered.items||[])
            };
          }
        }
      }
      this._renderMenu(cfgToRender);
      this._menuPainted = true;
    }

    _renderMenu(cfg){
      const nav = this._navEl; if (!nav) return;
      nav.innerHTML = '';

      const path = location.pathname;
      const { uid, roleHash } = this._currentUIDAndRoleHash();
      const stateKey = (cfg.options && cfg.options.stateKey) || this._navStateKeyFor(uid, roleHash) || 'fv:nav:groups';
      this._navStateKey = stateKey;
      let groupState = {}; try { groupState = JSON.parse(localStorage.getItem(stateKey) || '{}'); } catch {}

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
        btn.style.place-items = 'center';
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

        row.appendChild(link); row.appendChild(btn);
        wrap.appendChild(row); wrap.appendChild(kids);
        return wrap;
      };

      (cfg.items || []).forEach(item=>{
        if (item.type === 'group' && item.collapsible) nav.appendChild(mkGroup(item, 0));
        else if (item.type === 'link') nav.appendChild(mkLink(item, 0));
      });
    }

    _postPaintSanity(){
      const nameOK = (this._logoutLabel && this._logoutLabel.textContent && this._logoutLabel.textContent.trim() !== 'Logout');
      const menuOK = this._hasMenuLinks();
      if (!nameOK || !menuOK) this._kickToLogin(!nameOK ? 'no-name' : 'no-menu');
    }

    _collapseAllNavGroups(){
      const nav = this._navEl; if (!nav) return;
      nav.querySelectorAll('div[role="group"]').forEach(kids=>{
        kids.style.display = 'none';
        const row = kids.previousElementSibling;
        const btn = row && row.querySelector('button[aria-expanded]');
        if (btn) btn.setAttribute('aria-expanded','false');
      });
      const key = this._navStateKey || 'fv:nav:groups';
      try { localStorage.setItem(key, JSON.stringify({})); } catch {}
    }

    /* ===== Scroll lock helpers ===== */
    _applyBodyFixedStyles(){
      document.body.style.position = 'fixed';
      document.body.style.top = `-${this._scrollY}px`;
      document.body.style.left = '0'; document.body.style.right = '0';
      document.body.style.width = '100%'; document.body.style.overflow = 'hidden';
    }
    _setScrollLock(on){
      const iosStandalone = this._isIOSStandalone();
      const html = document.documentElement;
      if (on && !this._scrollLocked){
        this._scrollY = window.scrollY || html.scrollTop || 0;
        if (iosStandalone){
          this._applyBodyFixedStyles();
          html.style.overflow = 'hidden'; html.style.height = '100%';
          if (this._scrim) {
            this._scrim.addEventListener('touchmove', this._scrimTouchBlocker, { passive:false });
            this._scrim.addEventListener('wheel', this._scrimTouchBlocker, { passive:false });
          }
        } else {
          html.style.overflow = 'hidden';
        }
        this.classList.add('ui-locked');
        this._scrollLocked = true;
        this._ptrDisabled = true;
      } else if (!on && this._scrollLocked){
        document.body.style.position = ''; document.body.style.top = '';
        document.body.style.left = ''; document.body.style.right = '';
        document.body.style.width = ''; document.body.style.overflow = '';
        html.style.overflow = ''; html.style.height = '';
        if (this._scrim) {
          this._scrim.removeEventListener('touchmove', this._scrimTouchBlocker, { passive:false });
          this._scrim.removeEventListener('wheel', this._scrimTouchBlocker, { passive:false });
        }
        window.scrollTo(0, this._scrollY || 0);
        this.classList.remove('ui-locked');
        this._scrollLocked = false;
        setTimeout(()=> { this._ptrDisabled = false; }, 150);
      }
    }

    toggleDrawer(open){
      const wasOpen = this.classList.contains('drawer-open');
      const on = (open===undefined) ? !wasOpen : open;
      this.classList.toggle('drawer-open', on);
      this._setScrollLock(on || this.classList.contains('top-open'));
      if (wasOpen && !on) { this._collapseAllNavGroups(); }
    }
    toggleTop(open){
      const on = (open===undefined) ? !this.classList.contains('top-open') : open;
      this.classList.toggle('top-open', on);
      this._setScrollLock(on || this.classList.contains('drawer-open'));
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

    /* ===== PTR ===== */
    _initPTR(){
      const bar  = this._ptr      = this.shadowRoot.querySelector('.js-ptr');
      const txt  = this._ptrTxt   = this.shadowRoot.querySelector('.js-txt');
      const spin = this._ptrSpin  = this.shadowRoot.querySelector('.js-spin');
      const dot  = this._ptrDot   = this.shadowRoot.querySelector('.js-dot');

      const THRESHOLD = 72, MAX_ANGLE = 18, COOLDOWN = 600, TOP_TOL = 2;
      let armed=false, pulling=false, startY=0, startX=0, deltaY=0, lastEnd=0;

      const atTop  = ()=> (window.scrollY || 0) <= TOP_TOL;
      const canUse = ()=> !this.classList.contains('drawer-open') && !this.classList.contains('top-open') && !this._ptrDisabled;

      const showBar = ()=>{ bar.classList.add('show'); spin.hidden = true; dot.hidden = false; txt.textContent='Pull to refresh'; };
      const hideBar = ()=>{ bar.classList.remove('show'); spin.hidden = true; dot.hidden = true; txt.textContent='Pull to refresh'; };

      const onStart = (clientX, clientY)=>{ if (!canUse() || !atTop() || (Date.now()-lastEnd<COOLDOWN)) return; armed=true; pulling=false; startY=clientY; startX=clientX; deltaY=0; };
      const onMoveInternal = (clientX, clientY, prevent)=>{
        if (!armed) return;
        const dy = clientY-startY, dx = clientX-startX, angle = Math.abs(Math.atan2(dx, dy)*(180/Math.PI));
        if (angle > MAX_ANGLE) { armed=false; pulling=false; hideBar(); return; }
        if (dy > 0) { deltaY=dy; if (!pulling){ pulling=true; showBar(); } txt.textContent = (deltaY>=THRESHOLD)?'Release to refresh':'Pull to refresh'; prevent(); }
        else { armed=false; pulling=false; hideBar(); }
      };
      const onEnd = ()=>{
        if (!armed) return;
        const ok = pulling && deltaY>=THRESHOLD; armed=false; pulling=false; deltaY=0; startY=0; startX=0;
        if (ok) {
          lastEnd = Date.now(); (async ()=>{
            dot.hidden=true; spin.hidden=false; txt.textContent='Refreshing…';
            document.dispatchEvent(new CustomEvent('fv:refresh'));
            try { await this._initMenuFiltered(); } catch {}
            if (typeof window.FVRefresh === 'function') { try { await window.FVRefresh(); } catch {} }
            await new Promise(res=> setTimeout(res, 900)); hideBar();
          })();
        } else { hideBar(); }
      };

      window.addEventListener('touchstart', (e)=>{ if (!e.touches || e.touches.length!==1) return; const t=e.touches[0]; onStart(t.clientX,t.clientY); }, { passive:true });
      window.addEventListener('touchmove',  (e)=>{ if (!e.touches || e.touches.length!==1) return; const t=e.touches[0]; onMoveInternal(t.clientX,t.clientY, ()=>e.preventDefault()); }, { passive:false });
      window.addEventListener('touchend', onEnd, { passive:true });
      window.addEventListener('touchcancel', onEnd, { passive:true });

      window.addEventListener('pointerdown', (e)=>{ if (e.pointerType==='mouse') return; onStart(e.clientX,e.clientY); }, { passive:true });
      window.addEventListener('pointermove',  (e)=>{ if (e.pointerType==='mouse') return; onMoveInternal(e.clientX,e.clientY, ()=>e.preventDefault()); }, { passive:false });
      window.addEventListener('pointerup', onEnd, { passive:true });
      window.addEventListener('pointercancel', onEnd, { passive:true });

      document.addEventListener('visibilitychange', ()=>{ if (document.hidden) { armed=false; pulling=false; hideBar(); } });
    }

    _wireAuthLogout(r){
      const logoutRow = r.getElementById('logoutRow');
      const setLabel = ()=> this._setLogoutLabelNow();
      setLabel();
      try { if (window.FVUserContext && typeof window.FVUserContext.onChange === 'function') window.FVUserContext.onChange(() => setLabel()); } catch {}
      let tries = 30; const tick = setInterval(()=>{ setLabel(); if(--tries<=0) clearInterval(tick); }, 200);

      if (logoutRow) {
        logoutRow.addEventListener('click', async (e)=>{
          e.preventDefault();
          this.toggleTop(false); this.toggleDrawer(false);
          try{ if (typeof window.fvSignOut === 'function') await window.fvSignOut(); }catch(e){}
          try { window.FVUserContext && window.FVUserContext.clear && window.FVUserContext.clear(); } catch {}
          this._lastLogoutName = '';
          location.replace(this.LOGIN_URL);
        });
      }
    }

    _initConnectionStatus(){
      const update = ()=>{
        const net = navigator.onLine;
        let cloudReady = false;
        try { cloudReady = !!(window.FVUserContext && window.FVUserContext.get && window.FVUserContext.get()); } catch {}
        const ok = !!(net && cloudReady);
        if (this._connTxt) this._connTxt.textContent = ok ? 'Online' : 'Offline';
        if (this._connRow) { this._connRow.style.opacity = '1'; this._connRow.title = `Network: ${net ? 'online' : 'offline'} • Cloud: ${cloudReady ? 'ready' : 'not ready'}`; }
      };
      update();
      window.addEventListener('online', update);
      window.addEventListener('offline', update);
      try { if (window.FVUserContext && typeof window.FVUserContext.onChange === 'function') window.FVUserContext.onChange(update); } catch {}
      let tries = 20; const t = setInterval(()=>{ update(); if(--tries<=0) clearInterval(t); }, 250);
    }

    async checkForUpdates(){
      const sleep = (ms)=> new Promise(res=> setTimeout(res, ms));
      async function readTargetVersion(){
        try{
          const resp = await fetch('/Farm-vista/js/version.js?ts=' + Date.now(), { cache:'reload' });
          const txt = await resp.text();
          const m = txt.match(/number\\s*:\\s*["']([\\d.]+)["']/) || txt.match(/FV_NUMBER\\s*=\\s*["']([\\d.]+)["']/);
          return (m && m[1]) || '';
        }catch{ return ''; }
      }
      try{
        const targetVer = await readTargetVersion();
        const cur = (window.FV_VERSION && window.FV_VERSION.number) ? String(window.FV_VERSION.number) : '';
        if (targetVer && cur && targetVer === cur) { this._toastMsg(\`Up To Date (v\${cur})\`, 2200); return; }
        this._toastMsg('Clearing cache…', 900);
        if (navigator.serviceWorker) { try { const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(r=> r.unregister())); } catch {} }
        if ('caches' in window) { try { const keys = await caches.keys(); await Promise.all(keys.map(k => caches.delete(k))); } catch {} }
        const waitForControl = new Promise((resolve) => {
          const timer = setTimeout(()=> resolve(false), 3000);
          if (navigator.serviceWorker) navigator.serviceWorker.oncontrollerchange = () => { clearTimeout(timer); resolve(true); };
          else { clearTimeout(timer); resolve(false); }
        });
        if (navigator.serviceWorker) { try { const reg = await navigator.serviceWorker.register('/Farm-vista/serviceworker.js?ts=' + Date.now()); if (reg && reg.waiting && reg.waiting.postMessage) reg.waiting.postMessage('SKIP_WAITING'); } catch {} }
        this._toastMsg('Updating…', 1200);
        await waitForControl; await sleep(200);
        const url = new URL(location.href); url.searchParams.set('rev', targetVer || String(Date.now()));
        location.replace(url.toString());
      }catch(e){ console.error(e); this._toastMsg('Update failed. Try again.', 2400); }
    }

    _toastMsg(msg, ms=2000){
      const t = this._toast; if (!t) return;
      t.textContent = msg; t.classList.add('show');
      clearTimeout(this._tt); this._tt = setTimeout(()=> t.classList.remove('show'), ms);
    }
  }

  if (!customElements.get('fv-shell')) customElements.define('fv-shell', FVShell);
})();
