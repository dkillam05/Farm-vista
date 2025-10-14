/* FarmVista — <fv-shell> v5.9
   Based on your v5.8 file.
   Changes (and only these):
   • .main background/text now use tokens (var(--bg)/var(--text)) — no hard-coded colors
   • Dark-context shell/MAIN use tokens too
   • Sidebar dark rules read --sidebar-* tokens (with fallbacks), so it flips with theme
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

    /* ===== Header (fixed) ===== */
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
    .gold-bar{
      position:fixed; top:calc(var(--hdr-h) + env(safe-area-inset-top,0px));
      left:0; right:0; height:3px; background:var(--gold); z-index:999;
    }

    /* ===== Footer (fixed, extra slim) ===== */
    .ftr{
      position:fixed; inset:auto 0 0 0;
      height:calc(var(--ftr-h) + env(safe-area-inset-bottom,0px));
      padding-bottom:env(safe-area-inset-bottom,0px);
      background:var(--green); color:#fff;
      display:flex; align-items:center; justify-content:center;
      border-top:2px solid var(--gold); z-index:900;
    }
    .ftr .text{ font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

    /* ===== Main scroll area ===== */
    .main{
      position:relative;
      padding:
        calc(var(--hdr-h) + env(safe-area-inset-top,0px) + 11px)
        16px
        calc(var(--ftr-h) + env(safe-area-inset-bottom,0px) + 16px);
      min-height:100vh; box-sizing:border-box;
      /* Token-driven so it flips with theme */
      background: var(--bg);
      color: var(--text);
    }
    ::slotted(.container){ max-width:980px; margin:0 auto; }

    /* ===== Shared scrim (side + top drawers) ===== */
    .scrim{
      position:fixed; inset:0; background:rgba(0,0,0,.45);
      opacity:0; pointer-events:none; transition:opacity .2s; z-index:1100;
    }
    :host(.drawer-open) .scrim,
    :host(.top-open) .scrim{ opacity:1; pointer-events:auto; }

    /* ===== Sidebar (left drawer) — LIGHT MODE defaults ===== */
    .drawer{
      position:fixed; top:0; bottom:0; left:0; width:min(84vw, 320px);
      background:#fff; color:#222; box-shadow:0 0 36px rgba(0,0,0,.25);
      transform:translateX(-100%); transition:transform .25s; z-index:1200;
      -webkit-overflow-scrolling:touch;
      display:flex; flex-direction:column; height:100%; overflow:hidden;
      padding-bottom:env(safe-area-inset-bottom,0px);
      border-right:1px solid #eee;
    }
    :host(.drawer-open) .drawer{ transform:translateX(0); }

    .drawer header{
      padding:16px; border-bottom:1px solid #eee; display:flex; align-items:center; gap:12px; flex:0 0 auto;
      background:#fff;
    }
    .org{ display:flex; align-items:center; gap:12px; }
    .org img{ width:40px; height:40px; border-radius:8px; object-fit:cover; }
    .org .org-text{ display:flex; flex-direction:column; }
    .org .org-name{ font-weight:800; line-height:1.15; }
    .org .org-loc{ font-size:13px; color:#666; }

    .drawer nav{ flex:1 1 auto; overflow:auto; background:#f6f7f6; }
    .drawer nav a{
      display:flex; align-items:center; gap:12px; padding:16px; text-decoration:none; color:#222;
      border-bottom:1px solid #f3f3f3;
    }
    .drawer nav a span:first-child{ width:22px; text-align:center; opacity:.95; }

    .drawer-footer{
      flex:0 0 auto;
      display:flex; align-items:flex-end; justify-content:space-between; gap:12px;
      padding:12px 16px;
      padding-bottom:calc(12px + env(safe-area-inset-bottom,0px));
      border-top:1px solid #eee; background:#fff; color:#222;
    }
    .df-left{ display:flex; flex-direction:column; align-items:flex-start; }
    .df-left .brand{ font-weight:800; line-height:1.15; }
    .df-left .slogan{ font-size:12.5px; color:#777; line-height:1.2; }
    .df-right{ font-size:13px; color:#777; white-space:nowrap; }

    /* ===== Top Drawer (Account) ===== */
    .topdrawer{
      position:fixed; left:0; right:0; top:0;
      transform:translateY(-105%); transition:transform .26s ease;
      z-index:1300;
      background:var(--green); color:#fff;
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

    /* Rows */
    .row{
      display:flex; align-items:center; justify-content:space-between;
      padding:14px 12px; text-decoration:none; color:#fff;
      border-top:1px solid color-mix(in srgb,#000 22%, var(--green));
    }
    .row .left{ display:flex; align-items:center; gap:10px; }
    .row .ico{ width:22px; text-align:center; opacity:.95; }
    .row .txt{ font-size:16px; }
    .row .chev{ opacity:.9; }

    /* Toast — LIGHT defaults */
    .toast{
      position:fixed; left:50%; bottom:calc(var(--ftr-h) + env(safe-area-inset-bottom,0px) + 12px);
      transform:translateX(-50%); background:#111; color:#fff;
      padding:12px 16px; border-radius:12px; box-shadow:0 12px 32px rgba(0,0,0,.35);
      z-index:1400; font-size:14px; opacity:0; pointer-events:none; transition:opacity .18s ease, transform .18s ease;
    }
    .toast.show{ opacity:1; pointer-events:auto; transform:translateX(-50%) translateY(-4px); }

    /* ===== DARK CONTEXT — token driven ===== */
    :host-context(.dark){
      color:var(--text); background:var(--bg);
    }
    :host-context(.dark) .main{
      background:var(--bg); color:var(--text);
    }

    /* Sidebar surfaces in dark (tokenized with fallbacks) */
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
    :host-context(.dark) .drawer nav{
      background:color-mix(in srgb, var(--sidebar-surface, #171a18) 88%, #000);
    }
    :host-context(.dark) .drawer nav a{
      color:var(--sidebar-text, #f1f3ef);
      border-bottom:1px solid var(--sidebar-border, #232725);
    }
    :host-context(.dark) .drawer-footer{
      background:var(--sidebar-surface, #171a18);
      border-top:1px solid var(--sidebar-border, #2a2e2b);
      color:var(--sidebar-text, #f1f3ef);
    }
    :host-context(.dark) .df-left .slogan,
    :host-context(.dark) .df-right{
      color:color-mix(in srgb, var(--sidebar-text, #f1f3ef) 80%, transparent);
    }

    /* Toast in dark */
    :host-context(.dark) .toast{
      background:#1b1f1c; color:#F2F4F1;
      border:1px solid #2a2e2b; box-shadow:0 12px 32px rgba(0,0,0,.55);
    }
  </style>

  <header class="hdr" part="header">
    <button class="iconbtn js-menu" aria-label="Open menu">≡</button>
    <div class="title">FarmVista</div>
    <button class="iconbtn js-account" aria-label="Account">👥</button>
  </header>
  <div class="gold-bar" aria-hidden="true"></div>

  <div class="scrim js-scrim"></div>

  <!-- ===== Left Drawer ===== -->
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

    <nav>
      <a href="/Farm-vista/dashboard/"><span>🏠</span> Home</a>
      <a href="#"><span>🌱</span> Crop Production</a>
      <a href="#"><span>🚜</span> Equipment</a>
      <a href="#"><span>🌾</span> Grain</a>
      <a href="#"><span>💵</span> Expenses</a>
      <a href="#"><span>📊</span> Reports</a>
      <a href="#"><span>⚙️</span> Setup</a>
    </nav>

    <footer class="drawer-footer">
      <div class="df-left">
        <div class="brand">FarmVista</div>
        <div class="slogan js-slogan">Loading…</div>
      </div>
      <div class="df-right"><span class="js-ver">v0.0.0</span></div>
    </footer>
  </aside>

  <!-- ===== Top Drawer (Account) ===== -->
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
      <a class="row" href="#"><div class="left"><div class="ico">🧾</div><div class="txt">Account details</div></div><div class="chev">›</div></a>
      <a class="row" href="#"><div class="left"><div class="ico">💬</div><div class="txt">Feedback</div></div><div class="chev">›</div></a>

      <div class="section-h">MAINTENANCE</div>
      <a class="row js-update-row" href="#">
        <div class="left"><div class="ico">⟳</div><div class="txt">Check for updates</div></div>
        <div class="chev">›</div>
      </a>

      <a class="row" href="#" id="logoutRow">
        <div class="left"><div class="ico">⏻</div><div class="txt">Logout JOHNDOE</div></div>
        <div class="chev">›</div>
      </a>
    </div>
  </section>

  <main class="main" part="main"><slot></slot></main>

  <footer class="ftr" part="footer">
    <div class="text js-footer"></div>
  </footer>

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

      this._btnMenu.addEventListener('click', ()=> { this.toggleTop(false); this.toggleDrawer(true); });
      this._scrim.addEventListener('click', ()=> { this.toggleDrawer(false); this.toggleTop(false); });
      this._btnAccount.addEventListener('click', ()=> { this.toggleDrawer(false); this.toggleTop(); });
      document.addEventListener('keydown', (e)=>{ if(e.key==='Escape'){ this.toggleDrawer(false); this.toggleTop(false); } });

      r.querySelectorAll('.js-theme').forEach(btn=> btn.addEventListener('click', ()=> this.setTheme(btn.dataset.mode)));
      document.addEventListener('fv:theme', (e)=> this._syncThemeChips(e.detail.mode));
      this._syncThemeChips((window.App && App.getTheme && App.getTheme()) || 'system');

      const now = new Date();
      const dateStr = now.toLocaleDateString(undefined, { weekday:'long', year:'numeric', month:'long', day:'numeric' });
      const verNumber = (window.FV_VERSION && window.FV_VERSION.number)
                     || (window.App && App.getVersion && App.getVersion().number)
                     || (window.FV_BUILD)
                     || '0.0.0';
      const tagline = (window.FV_VERSION && window.FV_VERSION.tagline)
                   || (window.App && App.getVersion && App.getVersion().tagline)
                   || 'Farm data, simplified';

      this._footerText.textContent = `© ${now.getFullYear()} FarmVista • ${dateStr}`;
      this._verEl.textContent = `v${verNumber}`;
      this._sloganEl.textContent = tagline;

      r.querySelector('.js-update-row').addEventListener('click', (e)=> { e.preventDefault(); this.checkForUpdates(); });

      const logoutRow = r.getElementById('logoutRow');
      if (logoutRow) logoutRow.addEventListener('click', (e)=>{ e.preventDefault(); this._toastMsg('Logout not implemented yet.', 2000); });

      setTimeout(()=>{ if (!customElements.get('fv-hero-card')) this._toastMsg('Hero components not loaded. Check /js/fv-hero.js path or cache.', 2600); }, 300);
    }

    toggleDrawer(open){
      const on = (open===undefined) ? !this.classList.contains('drawer-open') : open;
      this.classList.toggle('drawer-open', on);
      document.documentElement.style.overflow = (on || this.classList.contains('top-open')) ? 'hidden' : '';
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

    /* ===== Updater (version.js–driven, cache + SW reset, hard reload with ?rev=<ver>) ===== */
    async checkForUpdates(){
      const sleep = (ms)=> new Promise(res=> setTimeout(res, ms));

      async function readTargetVersion(){
        // prefer in-memory version
        const v = (window.FV_VERSION && window.FV_VERSION.number) || (window.FV_BUILD);
        if (v) return v;
        // fallback: fetch version.js and parse
        try{
          const resp = await fetch('/Farm-vista/js/version.js?ts=' + Date.now(), { cache:'reload' });
          const txt = await resp.text();
          const m = txt.match(/number\s*:\s*["']([\d.]+)["']/) || txt.match(/FV_NUMBER\s*=\s*["']([\d.]+)["']/);
          return (m && m[1]) || String(Date.now());
        }catch{ return String(Date.now()); }
      }

      try{
        this._toastMsg('Checking for updates…', 1200);
        const targetVer = await readTargetVersion();

        // Ask the current SW (if any) to skip waiting so a new one can take control
        if (navigator.serviceWorker && navigator.serviceWorker.controller) {
          try { navigator.serviceWorker.controller.postMessage('SKIP_WAITING'); } catch {}
        }

        // Clear all caches
        if('caches' in window){
          try{
            const keys = await caches.keys();
            await Promise.all(keys.map(k=> caches.delete(k)));
          }catch{}
        }

        // Unregister any existing SWs, then register fresh (timestamped URL)
        if('serviceWorker' in navigator){
          try {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.map(r=> r.unregister()));
          } catch {}
          await sleep(150);
          try {
            await navigator.serviceWorker.register('/Farm-vista/serviceworker.js?ts=' + Date.now());
          } catch {}
        }

        // Hard reload with the version as the rev param so every CSS/JS link updates
        this._toastMsg(`Updating to v${targetVer}…`, 900);
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
  customElements.define('fv-shell', FVShell);
})();