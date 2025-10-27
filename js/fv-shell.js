/* FarmVista — <fv-shell> v5.9.9 (project-site safe with menu fallback)
   - Works under https://dkillam05.github.io/Farm-vista/
   - Absolute import for js/menu.js + classic <script> fallback
   - Version + tagline are read ONLY from js/version.js
   - Logout label = "Logout First Last" (from Firestore), else displayName, else email
   - Logout performs signOut (if available) and hard-navigates to pages/login/index.html
*/
(function () {
  const tpl = document.createElement('template');
  tpl.innerHTML = `
  <style>
    :host{
      --green:#3B7E46; --gold:#D0C542;
      --hdr-h:56px; --ftr-h:14px;
      display:block; color:#141514; background:#fff;
      min-height:100vh; position:relative;
    }
    .hdr{
      position:fixed; inset:0 0 auto 0;
      height:calc(var(--hdr-h) + env(safe-area-inset-top,0px));
      padding-top:env(safe-area-inset-top,0px);
      background:var(--green); color:#fff;
      display:grid; grid-template-columns:56px 1fr 56px; align-items:center;
      z-index:1000; box-shadow:0 2px 0 rgba(0,0,0,.05);
    }
    .hdr .title{ text-align:center; font-weight:800; font-size:20px; }
    .iconbtn{
      display:grid; place-items:center; width:48px; height:48px;
      border:none; background:transparent; color:#fff; font-size:28px; line-height:1;
      -webkit-tap-highlight-color: transparent; margin:0 auto;
    }
    .iconbtn svg{ width:26px; height:26px; display:block; }
    .gold-bar{
      position:fixed; top:calc(var(--hdr-h) + env(safe-area-inset-top,0px));
      left:0; right:0; height:3px; background:var(--gold); z-index:999;
    }
    .ftr{
      position:fixed; inset:auto 0 0 0;
      height:calc(var(--ftr-h) + env(safe-area-inset-bottom,0px));
      padding-bottom:env(safe-area-inset-bottom,0px);
      background:var(--green); color:#fff;
      display:flex; align-items:center; justify-content:center;
      border-top:2px solid var(--gold); z-index:900;
    }
    .ftr .text{ font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .main{
      position:relative;
      padding:
        calc(var(--hdr-h) + env(safe-area-inset-top,0px) + 11px)
        16px
        calc(var(--ftr-h) + env(safe-area-inset-bottom,0px) + 16px);
      min-height:100vh; box-sizing:border-box;
      background: var(--bg);
      color: var(--text);
    }
    ::slotted(.container){ max-width:980px; margin:0 auto; }
    .scrim{
      position:fixed; inset:0; background:rgba(0,0,0,.45);
      opacity:0; pointer-events:none; transition:opacity .2s; z-index:1100;
    }
    :host(.drawer-open) .scrim, :host(.top-open) .scrim{ opacity:1; pointer-events:auto; }
    .drawer{
      position:fixed; top:0; bottom:0; left:0; width:min(84vw, 320px);
      background: var(--surface); color: var(--text);
      box-shadow: var(--shadow);
      transform:translateX(-100%); transition:transform .25s; z-index:1200;
      -webkit-overflow-scrolling:touch;
      display:flex; flex-direction:column; height:100%; overflow:hidden;
      padding-bottom:env(safe-area-inset-bottom,0px);
      border-right: 1px solid var(--border);
    }
    :host(.drawer-open) .drawer{ transform:translateX(0); }
    .drawer header{
      padding:16px; border-bottom:1px solid var(--border);
      display:flex; align-items:center; gap:12px; flex:0 0 auto;
      background: var(--surface);
    }
    .org{ display:flex; align-items:center; gap:12px; }
    .org img{ width:40px; height:40px; border-radius:8px; object-fit:cover; }
    .org .org-text{ display:flex; flex-direction:column; }
    .org .org-name{ font-weight:800; line-height:1.15; }
    .org .org-loc{ font-size:13px; color:#666; }
    .drawer nav{ flex:1 1 auto; overflow:auto; background: var(--bg); }
    .drawer nav a{
      display:flex; align-items:center; gap:12px; padding:16px; text-decoration:none;
      color: var(--text); border-bottom:1px solid var(--border);
    }
    .drawer nav a span:first-child{ width:22px; text-align:center; opacity:.95; }
    .drawer-footer{
      flex:0 0 auto; display:flex; align-items:flex-end; justify-content:space-between; gap:12px;
      padding:12px 16px;
      padding-bottom:calc(12px + env(safe-area-inset-bottom,0px));
      border-top:1px solid var(--border);
      background: var(--surface); color: var(--text);
    }
    .df-left{ display:flex; flex-direction:column; align-items:flex-start; }
    .df-left .brand{ font-weight:800; line-height:1.15; }
    .df-left .slogan{ font-size:12.5px; color:#777; line-height:1.2; }
    .df-right{ font-size:13px; color:#777; white-space:nowrap; }
    .topdrawer{
      position:fixed; left:0; right:0; top:0;
      transform:translateY(-105%); transition:transform .26s ease;
      z-index:1300; background:var(--green); color:#fff;
      box-shadow:0 20px 44px rgba(0,0,0,.35);
      border-bottom-left-radius:16px; border-bottom-right-radius:16px;
      padding-top:calc(env(safe-area-inset-top,0px) + 8px);
      max-height:72vh; overflow:auto;
    }
    :host(.top-open) .topdrawer{ transform:translateY(0); }
    .topwrap{ padding:6px 10px 14px; }
    .brandrow{
      display:flex; align-items:center; justify-content:center; gap:10px;
      padding:10px 8px 12px 8px;
    }
    .brandrow img{ width:28px; height:28px; border-radius:6px; object-fit:cover; }
    .brandrow .brandname{ font-weight:800; font-size:18px; letter-spacing:.2px; }
    .section-h{
      padding:12px 12px 6px;
      font:600 12px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
      letter-spacing:.12em; color:color-mix(in srgb,#fff 85%, transparent);
    }
    .chips{ padding:0 12px 10px; }
    .chip{
      appearance:none; border:1.5px solid color-mix(in srgb,#fff 65%, transparent);
      padding:9px 14px; border-radius:20px; background:#fff; color:#111; margin-right:10px; font-weight:700;
      display:inline-flex; align-items:center; gap:8px;
    }
    .chip[aria-pressed="true"]{
      outline:3px solid color-mix(in srgb,#fff 25%, transparent);
      background:var(--gold); color:#111; border-color:transparent;
    }
    .row{
      display:flex; align-items:center; justify-content:space-between;
      padding:16px 12px; text-decoration:none; color:#fff;
      border-top:1px solid color-mix(in srgb,#000 22%, var(--green));
    }
    .row .left{ display:flex; align-items:center; gap:14px; }
    .row .ico{ width:28px; height:28px; display:grid; place-items:center; font-size:24px; line-height:1; text-align:center; opacity:.95; }
    .row .txt{ font-size:16px; line-height:1.25; }
    .row .chev{ opacity:.9; }
    .toast{
      position:fixed; left:50%; bottom:calc(var(--ftr-h) + env(safe-area-inset-bottom,0px) + 12px);
      transform:translateX(-50%); background:#111; color:#fff;
      padding:12px 16px; border-radius:12px; box-shadow:0 12px 32px rgba(0,0,0,.35);
      z-index:1400; font-size:14px; opacity:0; pointer-events:none; transition:opacity .18s ease, transform .18s ease;
    }
    .toast.show{ opacity:1; pointer-events:auto; transform:translateX(-50%) translateY(-4px); }
    :host-context(.dark){ color:var(--text); background:var(--bg); }
    :host-context(.dark) .main{ background:var(--bg); color:var(--text); }
    :host-context(.dark) .drawer{
      background:var(--sidebar-surface, #171a18);
      color:var(--sidebar-text, #f1f3ef);
      border-right:1px solid var(--sidebar-border, #2a2e2b);
      box-shadow:0 0 36px rgba(0,0,0,.45);
    }
    :host-context(.dark) .drawer header{
      background:var(--sidebar-surface, #171a18);
      border-bottom:1px solid var(--sidebar-border, #2a2e2b);
    }
    :host-context(.dark) .org .org-loc{ color:color-mix(in srgb, var(--sidebar-text, #f1f3ef) 80%, transparent); }
    :host-context(.dark) .drawer nav{ background:color-mix(in srgb, var(--sidebar-surface, #171a18) 88%, #000); }
    :host-context(.dark) .drawer nav a{
      color:var(--sidebar-text, #f1f3ef);
      border-bottom:1px solid var(--sidebar-border, #232725);
    }
    .drawer-footer{
      background:var(--sidebar-surface, #171a18);
      border-top:1px solid var(--sidebar-border, #2a2e2b);
      color:var(--sidebar-text, #f1f3ef);
    }
    :host-context(.dark) .df-left .slogan, :host-context(.dark) .df-right{
      color:color-mix(in srgb, var(--sidebar-text, #f1f3ef) 80%, transparent);
    }
    :host-context(.dark) .toast{
      background:#1b1f1c; color:#F2F4F1; border:1px solid #2a2e2b; box-shadow:0 12px 32px rgba(0,0,0,.55);
    }
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

  <div class="scrim js-scrim"></div>

  <aside class="drawer" part="drawer" aria-label="Main menu">
    <header>
      <div class="org">
        <img src="assets/icons/icon-192.png" alt="" />
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
        <img src="assets/icons/icon-192.png" alt="" />
        <div class="brandname">FarmVista</div>
      </div>

      <div class="section-h">THEME</div>
      <div class="chips">
        <button class="chip js-theme" data-mode="system" aria-pressed="true">System</button>
        <button class="chip js-theme" data-mode="light"  aria-pressed="false">Light</button>
        <button class="chip js-theme" data-mode="dark"   aria-pressed="false">Dark</button>
      </div>

      <div class="section-h">PROFILE</div>
      <a class="row" id="userDetailsLink" href="pages/user-details/index.html">
        <div class="left"><div class="ico">🧾</div><div class="txt">User Details</div></div>
        <div class="chev">›</div>
      </a>
      <a class="row" id="feedbackLink" href="pages/feedback/index.html">
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

      this._btnMenu.addEventListener('click', ()=> { this.toggleTop(false); this.toggleDrawer(true); });
      this._scrim.addEventListener('click', ()=> { this.toggleDrawer(false); this.toggleTop(false); });
      this._btnAccount.addEventListener('click', ()=> { this.toggleDrawer(false); this.toggleTop(); });
      document.addEventListener('keydown', (e)=>{ if(e.key==='Escape'){ this.toggleDrawer(false); this.toggleTop(false); } });

      r.querySelectorAll('.js-theme').forEach(btn=> btn.addEventListener('click', ()=> this.setTheme(btn.dataset.mode)));
      document.addEventListener('fv:theme', (e)=> this._syncThemeChips(e.detail.mode));
      this._syncThemeChips((window.App && App.getTheme && App.getTheme()) || 'system');

      const now = new Date();
      const dateStr = now.toLocaleDateString(undefined, { weekday:'long', year:'numeric', month:'long', day:'numeric' });
      this._footerBase = `© ${now.getFullYear()} FarmVista • ${dateStr}`;
      this._footerText.textContent = this._footerBase;

      this._loadVersionIntoUI();       // ← version + tagline ONLY from js/version.js
      this._wireAuthLogout(r);         // ← logout label with Firestore profile

      const upd = r.querySelector('.js-update-row');
      if (upd) upd.addEventListener('click', (e)=> { e.preventDefault(); this.checkForUpdates(); });

      const ud = r.getElementById('userDetailsLink'); if (ud) ud.addEventListener('click', () => { this.toggleTop(false); });
      const fb = r.getElementById('feedbackLink'); if (fb) fb.addEventListener('click', () => { this.toggleTop(false); });

      this._initMenu();
    }

    /* ===== Version + tagline (ONLY from js/version.js) ===== */
    async _loadVersionIntoUI(){
      const setUI = (num, tag) => {
        const clean = (num||'').toString().replace(/^\s*v/i,'').trim() || '0.0.0';
        if (this._verEl) this._verEl.textContent = `v${clean}`;
        if (this._sloganEl) this._sloganEl.textContent = (tag && String(tag).trim()) || 'Simplified';
        this._applyFooterVersion(clean);
      };

      try {
        // Load once; version.js populates window.FV_VERSION
        await import('js/version.js');
      } catch (e) {
        // If version.js fails to load, still don’t crash the UI
      }

      const v = (window && window.FV_VERSION) || {};
      setUI(v.number, v.tagline);
    }

    _applyFooterVersion(num){
      if (!this._footerText) return;
      const base = this._footerBase || '';
      const suffix = num ? ` • v${num}` : '';
      this._footerText.textContent = base + suffix;
    }

    /* ===== Robust menu loader (absolute URL + fallback) ===== */
    async _initMenu(){
      const url = location.origin + '/Farm-vista/js/menu.js?v=' + Date.now();

      try {
        const mod = await import(url);
        const NAV_MENU = (mod && (mod.NAV_MENU || mod.default)) || null;
        if (!NAV_MENU || !Array.isArray(NAV_MENU.items)) throw new Error('Invalid NAV_MENU export');
        console.log('[FV] menu loaded via import()', url);
        this._renderMenu(NAV_MENU);
        return;
      } catch (e) {
        console.warn('[FV] import(menu.js) failed, falling back to classic script:', e);
      }

      try {
        await new Promise((res, rej) => {
          const s = document.createElement('script');
          s.src = url;
          s.defer = true;
          s.onload = () => res();
          s.onerror = (err) => rej(err);
          document.head.appendChild(s);
        });
        const NAV_MENU = (window && window.FV_MENU) || null;
        if (!NAV_MENU || !Array.isArray(NAV_MENU.items)) throw new Error('window.FV_MENU missing/invalid');
        console.log('[FV] menu loaded via fallback script', url);
        this._renderMenu(NAV_MENU);
      } catch (err) {
        console.error('[FV] Unable to load menu by any method:', url, err);
        this._toastMsg('Menu failed to load. Please refresh.', 3000);
      }
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

    /* ===== Logout label with Firestore name (First Last → displayName → email) ===== */
    async _wireAuthLogout(r){
      const logoutRow = r.getElementById('logoutRow');
      const logoutLabel = r.getElementById('logoutLabel');

      const needAuthFns = async () => {
        const mod = await import('js/firebase-init.js');
        const ctx = await mod.ready;
        const auth = window.firebaseAuth || (ctx && ctx.auth) || mod.getAuth(ctx && ctx.app);
        const db = mod.getFirestore ? mod.getFirestore(ctx && ctx.app) : (window.firebaseFirestore || null);
        return { mod, ctx, auth, db };
      };

      const pickName = (user, profile) => {
        const first = profile && typeof profile.firstName === 'string' ? profile.firstName.trim() : '';
        const last  = profile && typeof profile.lastName  === 'string' ? profile.lastName.trim()  : '';
        const fnln  = [first, last].filter(Boolean).join(' ').trim();
        const dname = (profile && profile.displayName && profile.displayName.trim()) ||
                      (user && user.displayName && user.displayName.trim()) || '';
        const email = (user && user.email) || '';
        return fnln || dname || email || 'User';
      };

      const setLabel = (user, profile) => {
        if (logoutLabel) logoutLabel.textContent = `Logout ${pickName(user, profile)}`;
      };

      const readProfile = async (mod, db, uid) => {
        if (!db || !uid) return null;
        const tryPaths = [
          ['users', uid],
          ['profiles', uid],
          ['userProfiles', uid]
        ];
        for (const [col, id] of tryPaths) {
          try{
            const ref = mod.doc(db, col, id);
            const snap = await mod.getDoc(ref);
            if (snap && typeof snap.data === 'function' && snap.exists()) {
              const data = snap.data() || {};
              if (data.firstName || data.lastName || data.displayName) return data;
            }
          }catch{}
        }
        return null;
      };

      try{
        const { mod, auth, db } = await needAuthFns();
        if (!auth) throw new Error('Auth unavailable');

        // Initial label
        setLabel(auth.currentUser, window.__FV_PROFILE);

        // React to auth changes
        mod.onAuthStateChanged(auth, async (user) => {
          let profile = null;
          if (user && user.uid) {
            profile = await readProfile(mod, db, user.uid);
            if (profile) {
              window.__FV_PROFILE = profile;
              try { document.dispatchEvent(new CustomEvent('fv:profile', { detail: profile })); } catch {}
            }
          }
          setLabel(user, profile);
        });

        // Also react to external profile updates if your app sets them
        document.addEventListener('fv:profile', (e)=> setLabel(auth.currentUser, e.detail));

        // Make sure we don’t sit blank on slow boot
        if (!auth.currentUser) {
          let tries = 12;
          const tick = setInterval(()=>{
            setLabel(auth.currentUser, window.__FV_PROFILE);
            if (auth.currentUser || --tries <= 0) clearInterval(tick);
          }, 150);
        }

        if (logoutRow) {
          logoutRow.addEventListener('click', async (e)=>{
            e.preventDefault();
            this.toggleTop(false);
            this.toggleDrawer(false);
            try{
              if (typeof window.fvSignOut === 'function') { await window.fvSignOut(); }
              else if (mod.signOut) { await mod.signOut(auth); }
            }catch(err){ console.warn('[FV] logout error:', err); }
            location.replace('pages/login/index.html');
          });
        }
      }catch(err){
        console.warn('[FV] auth wiring skipped (offline or no firebase):', err);
        if (logoutRow) {
          logoutRow.addEventListener('click', (e)=> {
            e.preventDefault();
            this.toggleTop(false);
            this.toggleDrawer(false);
            location.replace('pages/login/index.html');
          });
        }
      }
    }

    /* ===== Update flow ===== */
    async checkForUpdates(){
      const sleep = (ms)=> new Promise(res=> setTimeout(res, ms));
      async function readTargetVersion(){
        try{
          const txt = await (await fetch('js/version.js?ts=' + Date.now(), { cache:'reload' })).text();
          const m = txt.match(/number\s*:\s*["']([\d.]+)["']/) ||
                    txt.match(/FV_NUMBER\s*=\s*["']([\d.]+)["']/) ||
                    txt.match(/window\.FV_BUILD\s*=\s*["']([\d.]+)["']/);
          return (m && m[1]) || String(Date.now());
        }catch{ return String(Date.now()); }
      }
      try{
        this._toastMsg('Checking For Updates…', 1200);
        const targetVer = await readTargetVersion();

        if (navigator.serviceWorker && navigator.serviceWorker.controller) {
          try { navigator.serviceWorker.controller.postMessage('SKIP_WAITING'); } catch {}
        }
        if ('caches' in window) {
          try { const keys = await caches.keys(); await Promise.all(keys.map(k=> caches.delete(k))); } catch {}
        }
        if ('serviceWorker' in navigator) {
          try { const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(r=> r.unregister())); } catch {}
          await sleep(150);
          try { await navigator.serviceWorker.register('serviceworker.js?ts=' + Date.now()); } catch {}
        }

        this._toastMsg('Updating…', 900);
        await sleep(400);
        const url = new URL(location.href);
        url.searchParams.set('rev', targetVer);
        location.replace(url.toString());
      }catch(e){
        console.error(e);
        this._toastMsg('Update failed. Try again.', 2200);
      }
    }

    _toastMsg(msg, ms=1600){
      const t = this._toast; t.textContent = msg; t.classList.add('show');
      clearTimeout(this._tt); this._tt = setTimeout(()=> t.classList.remove('show'), ms);
    }
  }

  if (!customElements.get('fv-shell')) {
    customElements.define('fv-shell', FVShell);
  }
})();