/* FarmVista — <fv-shell> v5.5
   - Maintenance: "Check for updates" styled as row (matches Account/Feedback)
   - Updater: version-aware toasts
   - Footer remains extra-slim (14px)
   - NEW: full tokenization for light/dark (no hard-coded #fff/#222/#eee/#111)
*/
(function () {
  const tpl = document.createElement('template');
  tpl.innerHTML = `
  <style>
    :host{
      /* brand fallbacks if page CSS hasn't loaded yet */
      --green:#3B7E46; --gold:#D0C542;

      /* map global tokens from theme.css (inherit across shadow DOM) */
      --brand-green: var(--brand-green, var(--green));
      --brand-gold:  var(--brand-gold,  var(--gold));
      --c-bg:        var(--surface, #ffffff);
      --c-bg-2:      var(--surface-2, #f0f2ee);
      --c-fg:        var(--text, #141514);
      --c-muted:     var(--muted, #677a6e);
      --c-border:    var(--border, #e3e6e2);
      --c-shadow:    var(--shadow, 0 12px 24px rgba(0,0,0,.14));

      --hdr-h:56px; --ftr-h:14px;
      display:block; color:var(--c-fg); background:var(--c-bg);
      min-height:100vh; position:relative;
    }

    /* ===== Header (fixed) ===== */
    .hdr{
      position:fixed; inset:0 0 auto 0;
      height:calc(var(--hdr-h) + env(safe-area-inset-top,0px));
      padding-top:env(safe-area-inset-top,0px);
      background:var(--brand-green); color:#fff;
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
      left:0; right:0; height:3px; background:var(--brand-gold); z-index:999;
    }

    /* ===== Footer (fixed, extra slim) ===== */
    .ftr{
      position:fixed; inset:auto 0 0 0;
      height:calc(var(--ftr-h) + env(safe-area-inset-bottom,0px));
      padding-bottom:env(safe-area-inset-bottom,0px);
      background:var(--brand-green); color:#fff;
      display:flex; align-items:center; justify-content:center;
      border-top:2px solid var(--brand-gold); z-index:900;
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
    }
    ::slotted(.container){ max-width:980px; margin:0 auto; }

    /* ===== Shared scrim (side + top drawers) ===== */
    .scrim{
      position:fixed; inset:0; background:rgba(0,0,0,.45);
      opacity:0; pointer-events:none; transition:opacity .2s; z-index:1100;
    }
    :host(.drawer-open) .scrim,
    :host(.top-open) .scrim{ opacity:1; pointer-events:auto; }

    /* ===== Sidebar (left drawer) ===== */
    .drawer{
      position:fixed; top:0; bottom:0; left:0; width:min(84vw, 320px);
      background:var(--c-bg-2); color:var(--c-fg); box-shadow:0 0 36px rgba(0,0,0,.25);
      transform:translateX(-100%); transition:transform .25s; z-index:1200;
      -webkit-overflow-scrolling:touch;
      display:flex; flex-direction:column; height:100%; overflow:hidden;
      padding-bottom:env(safe-area-inset-bottom,0px);
      border-right:1px solid var(--c-border);
    }
    :host(.drawer-open) .drawer{ transform:translateX(0); }

    .drawer header{
      padding:16px; border-bottom:1px solid var(--c-border);
      display:flex; align-items:center; gap:12px; flex:0 0 auto;
      background:var(--c-bg);
    }
    .org{ display:flex; align-items:center; gap:12px; }
    .org img{ width:40px; height:40px; border-radius:8px; object-fit:cover; }
    .org .org-text{ display:flex; flex-direction:column; }
    .org .org-name{ font-weight:800; line-height:1.15; }
    .org .org-loc{ font-size:13px; color:var(--c-muted); }

    .drawer nav{ flex:1 1 auto; overflow:auto; background:var(--c-bg-2); }
    .drawer nav a{
      display:flex; align-items:center; gap:12px; padding:16px; text-decoration:none;
      color:var(--c-fg); border-bottom:1px solid color-mix(in srgb, var(--c-border) 90%, transparent);
    }
    .drawer nav a span:first-child{ width:22px; text-align:center; opacity:.95; }

    .drawer-footer{
      flex:0 0 auto;
      display:flex; align-items:flex-end; justify-content:space-between; gap:12px;
      padding:12px 16px;
      padding-bottom:calc(12px + env(safe-area-inset-bottom,0px));
      border-top:1px solid var(--c-border);
      background:var(--c-bg);
      color:var(--c-fg);
    }
    .df-left{ display:flex; flex-direction:column; align-items:flex-start; }
    .df-left .brand{ font-weight:800; line-height:1.15; }
    .df-left .slogan{ font-size:12.5px; color:var(--c-muted); line-height:1.2; }
    .df-right{ font-size:13px; color:var(--c-muted); white-space:nowrap; }

    /* ===== Top Drawer (Account) ===== */
    .topdrawer{
      position:fixed; left:0; right:0; top:0;
      transform:translateY(-105%); transition:transform .26s ease;
      z-index:1300;
      background:var(--brand-green); color:#fff;
      box-shadow:0 20px 44px rgba(0,0,0,.35);
      border-bottom-left-radius:16px; border-bottom-right-radius:16px;
      padding-top:calc(env(safe-area-inset-top,0px) + 8px);
      max-height:72vh; overflow:auto;
    }
    :host(.top-open) .topdrawer{ transform:translateY(0); }

    .topwrap{ padding:6px 10px 14px; }

    /* Centered brand row */
    .brandrow{
      display:flex; align-items:center; justify-content:center; gap:10px;
      padding:10px 8px 12px 8px;
    }
    .brandrow img{ width:28px; height:28px; border-radius:6px; object-fit:cover; }
    .brandrow .brandname{ font-weight:800; font-size:18px; letter-spacing:.2px; }

    /* Section headers & chips on green */
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
      background:var(--brand-gold); color:#111; border-color:transparent;
    }

    /* Rows (Profile, Maintenance, Logout) */
    .row{
      display:flex; align-items:center; justify-content:space-between;
      padding:14px 12px; text-decoration:none; color:#fff;
      border-top:1px solid color-mix(in srgb,#000 22%, var(--brand-green));
    }
    .row .left{ display:flex; align-items:center; gap:10px; }
    .row .ico{ width:22px; text-align:center; opacity:.95; }
    .row .txt{ font-size:16px; }
    .row .chev{ opacity:.9; }

    /* Toast (now tokenized) */
    .toast{
      position:fixed; left:50%; bottom:calc(var(--ftr-h) + env(safe-area-inset-bottom,0px) + 12px);
      transform:translateX(-50%);
      background:var(--c-bg-2); color:var(--c-fg);
      padding:12px 16px; border-radius:12px; box-shadow:var(--c-shadow); border:1px solid var(--c-border);
      z-index:1400; font-size:14px; opacity:0; pointer-events:none; transition:opacity .18s ease, transform .18s ease;
    }
    .toast.show{ opacity:1; pointer-events:auto; transform:translateX(-50%) translateY(-4px); }

    /* Dark tweaks for left drawer done via tokens; no extra rules needed */
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
      <!-- Centered brand row -->
      <div class="brandrow">
        <img src="/Farm-vista/assets/icons/icon-192.png" alt="" />
        <div class="brandname">FarmVista</div>
      </div>

      <!-- Theme -->
      <div class="section-h">THEME</div>
      <div class="chips">
        <button class="chip js-theme" data-mode="system" aria-pressed="true">System</button>
        <button class="chip js-theme" data-mode="light"  aria-pressed="false">Light</button>
        <button class="chip js-theme" data-mode="dark"   aria-pressed="false">Dark</button>
      </div>

      <!-- Profile -->
      <div class="section-h">PROFILE</div>
      <a class="row" href="#"><div class="left"><div class="ico">🧾</div><div class="txt">Account details</div></div><div class="chev">›</div></a>
      <a class="row" href="#"><div class="left"><div class="ico">💬</div><div class="txt">Feedback</div></div><div class="chev">›</div></a>

      <!-- Maintenance (row style) -->
      <div class="section-h">MAINTENANCE</div>
      <a class="row js-update-row" href="#">
        <div class="left"><div class="ico">⟳</div><div class="txt">Check for updates</div></div>
        <div class="chev">›</div>
      </a>

      <!-- Logout -->
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

      // Drawer footer refs
      this._verEl = r.querySelector('.js-ver');
      this._sloganEl = r.querySelector('.js-slogan');

      // Events
      this._btnMenu.addEventListener('click', ()=> { this.toggleTop(false); this.toggleDrawer(true); });
      this._scrim.addEventListener('click', ()=> { this.toggleDrawer(false); this.toggleTop(false); });
      this._btnAccount.addEventListener('click', ()=> { this.toggleDrawer(false); this.toggleTop(); });
      document.addEventListener('keydown', (e)=>{
        if(e.key==='Escape'){ this.toggleDrawer(false); this.toggleTop(false); }
      });

      r.querySelectorAll('.js-theme').forEach(btn=>{
        btn.addEventListener('click', ()=> this.setTheme(btn.dataset.mode));
      });
      document.addEventListener('fv:theme', (e)=> this._syncThemeChips(e.detail.mode));
      this._syncThemeChips((window.App && App.getTheme && App.getTheme()) || 'system');

      // Version + slogan + date
      const now = new Date();
      const dateStr = now.toLocaleDateString(undefined, { weekday:'long', year:'numeric', month:'long', day:'numeric' });

      const verNumber = (window.FV_VERSION && window.FV_VERSION.number)
                     || (window.App && App.getVersion && App.getVersion().number)
                     || (window.FV_BUILD)
                     || '0.0.0';

      const tagline = (window.FV_VERSION && window.FV_VERSION.tagline)
                   || (window.App && App.getVersion && App.getVersion().tagline)
                   || 'Farm data, simplified';

      // Bottom app footer
      this._footerText.textContent = `© ${now.getFullYear()} FarmVista • ${dateStr}`;

      // Sidebar footer (left/right layout)
      this._verEl.textContent = `v${verNumber}`;
      this._sloganEl.textContent = tagline;

      // Update row click
      r.querySelector('.js-update-row').addEventListener('click', (e)=> {
        e.preventDefault();
        this.checkForUpdates();
      });

      // Mock logout (placeholder)
      const logoutRow = r.getElementById('logoutRow');
      if (logoutRow) {
        logoutRow.addEventListener('click', (e)=>{
          e.preventDefault();
          this._toastMsg('Logout not implemented yet.', 2000);
        });
      }

      // Hero check
      setTimeout(()=>{
        if (!customElements.get('fv-hero-card')) {
          this._toastMsg('Hero components not loaded. Check /js/fv-hero.js path or cache.', 2600);
        }
      }, 300);
    }

    /* ===== Side Drawer ===== */
    toggleDrawer(open){
      const on = (open===undefined) ? !this.classList.contains('drawer-open') : open;
      this.classList.toggle('drawer-open', on);
      document.documentElement.style.overflow = (on || this.classList.contains('top-open')) ? 'hidden' : '';
    }

    /* ===== Top Drawer ===== */
    toggleTop(open){
      const on = (open===undefined) ? !this.classList.contains('top-open') : open;
      this.classList.toggle('top-open', on);
      document.documentElement.style.overflow = (on || this.classList.contains('drawer-open')) ? 'hidden' : '';
    }

    /* ===== Theme ===== */
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

    /* ===== Updater (version-aware) ===== */
    async checkForUpdates(){
      const current = (this._verEl && this._verEl.textContent || '').replace(/^v/i,'').trim();
      const sleep = (ms)=> new Promise(res=> setTimeout(res, ms));
      const fetchLatestVersion = async () => {
        try {
          const resp = await fetch('/Farm-vista/js/version.js?rev=' + Date.now(), { cache:'reload' });
          const txt = await resp.text();
          const m = txt.match(/number\s*:\s*["']([\d.]+)["']/);
          return m ? m[1] : null;
        } catch { return null; }
      };
      const cmp = (a,b)=>{
        const pa=a.split('.').map(n=>parseInt(n||'0',10));
        const pb=b.split('.').map(n=>parseInt(n||'0',10));
        const len=Math.max(pa.length,pb.length);
        for(let i=0;i<len;i++){ const da=pa[i]||0, db=pb[i]||0; if(da>db) return 1; if(da<db) return -1; }
        return 0;
      };

      try{
        this._toastMsg('Checking for updates…', 1200);
        const latest = await fetchLatestVersion();

        if (latest && current && cmp(latest, current) <= 0) {
          this._toastMsg(`You’re on v${current} — no update found.`, 1800);
          return;
        }

        if (latest) this._toastMsg(`Updating to v${latest}…`, 1200);
        else this._toastMsg('Updating…', 1000);

        if('caches' in window){
          const keys = await caches.keys();
          await Promise.all(keys.map(k=> caches.delete(k)));
        }
        await sleep(200);

        if('serviceWorker' in navigator){
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map(r=> r.unregister()));
        }
        await sleep(200);

        try{ await fetch('/Farm-vista/js/version.js?rev=' + Date.now(), { cache:'reload' }); }catch{}

        this._toastMsg('Reloading with fresh assets…', 900);
        await sleep(500);

        const url = new URL(location.href);
        url.searchParams.set('rev', Date.now().toString());
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