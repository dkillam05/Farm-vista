/* FarmVista — <fv-shell> v4.6
   - Sidebar header: logo LEFT, "Dowson Farms" + "Divernon, Illinois" RIGHT
   - Drawer footer pinned: LEFT (FarmVista + slogan), RIGHT (live version)
*/
(function () {
  const tpl = document.createElement('template');
  tpl.innerHTML = `
  <style>
    :host{
      --green:#3B7E46; --gold:#D0C542;
      --surface:var(--surface,#fff); --text:var(--text,#141514);
      --hdr-h:56px; --ftr-h:42px;
      display:block; color:var(--text); background:var(--page, var(--app-bg,#f5f7f4));
      min-height:100vh; position:relative;
    }

    /* ===== Header (fixed) ===== */
    .hdr{
      position:fixed; inset:0 0 auto 0;
      height:calc(var(--hdr-h) + env(safe-area-inset-top,0px));
      padding-top:env(safe-area-inset-top,0px);
      background:var(--brand-green,var(--green)); color:#fff;
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
      left:0; right:0; height:3px; background:var(--brand-gold,var(--gold)); z-index:999;
    }

    /* ===== Footer (fixed) ===== */
    .ftr{
      position:fixed; inset:auto 0 0 0;
      height:calc(var(--ftr-h) + env(safe-area-inset-bottom,0px));
      padding-bottom:env(safe-area-inset-bottom,0px);
      background:var(--brand-green,var(--green)); color:#fff;
      display:flex; align-items:center; justify-content:center;
      border-top:3px solid var(--brand-gold,var(--gold)); z-index:900;
    }
    .ftr .text{ font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

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

    /* ===== Sidebar (drawer) ===== */
    .scrim{
      position:fixed; inset:0; background:rgba(0,0,0,.45);
      opacity:0; pointer-events:none; transition:opacity .2s; z-index:1100;
    }
    .drawer{
      position:fixed; top:0; bottom:0; left:0; width:min(84vw, 320px);
      background:#fff; color:#222; box-shadow:0 0 36px rgba(0,0,0,.25);
      transform:translateX(-100%); transition:transform .25s; z-index:1200;
      -webkit-overflow-scrolling:touch;

      /* Footer pinned / only nav scrolls */
      display:flex; flex-direction:column; height:100%; overflow:hidden;
      padding-bottom:env(safe-area-inset-bottom,0px);
    }

    /* Header (org block) */
    .drawer header{
      padding:16px; border-bottom:1px solid #eee; display:flex; align-items:center; gap:12px; flex:0 0 auto;
    }
    .org{ display:flex; align-items:center; gap:12px; }
    .org img{ width:40px; height:40px; border-radius:8px; object-fit:cover; }
    .org .org-text{ display:flex; flex-direction:column; }
    .org .org-name{ font-weight:800; line-height:1.15; }
    .org .org-loc{ font-size:13px; color:#666; }

    /* Nav */
    .drawer nav{ flex:1 1 auto; overflow:auto; }
    .drawer nav a{
      display:flex; align-items:center; gap:12px; padding:16px; text-decoration:none; color:#222; border-bottom:1px solid #f3f3f3;
    }

    /* Drawer footer (pinned bottom) */
    .drawer-footer{
      flex:0 0 auto;
      display:flex; align-items:flex-end; justify-content:space-between; gap:12px;
      padding:12px 16px;
      padding-bottom:calc(12px + env(safe-area-inset-bottom,0px));
      border-top:1px solid #eee; background:#fff;
    }
    .df-left{ display:flex; flex-direction:column; align-items:flex-start; }
    .df-left .brand{ font-weight:800; line-height:1.15; }
    .df-left .slogan{ font-size:12.5px; color:#777; line-height:1.2; }
    .df-right{ font-size:13px; color:#777; white-space:nowrap; }

    /* State */
    :host(.drawer-open) .scrim{ opacity:1; pointer-events:auto; }
    :host(.drawer-open) .drawer{ transform:translateX(0); }

    /* Account panel */
    .panel{
      position:fixed; right:8px; left:auto;
      top:calc(var(--hdr-h) + env(safe-area-inset-top,0px) + 8px);
      background:#fff; color:#111; border:1px solid #e6e6e6; border-radius:12px; box-shadow:0 18px 44px rgba(0,0,0,.28);
      min-width:300px; max-width:92vw; z-index:1300; display:none; overflow:hidden;
    }
    .panel.open{ display:block; }
    .panel .sec{ padding:14px 16px; }
    .panel h6{ margin:0 0 10px; font:600 12px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif; letter-spacing:.12em; color:#6c6f6a; }
    .seg{ border-top:1px solid #eee; }

    .chip{ appearance:none; border:1.5px solid #d7dbd3; padding:9px 14px; border-radius:20px; background:#fff; color:#111; margin-right:10px; font-weight:700; }
    .chip[aria-pressed="true"]{ outline:3px solid #fff; background:var(--brand-green,var(--green)); color:#fff; border-color:transparent; }

    .linkrow{ display:flex; align-items:center; justify-content:space-between; padding:12px 0; }
    .linkrow a{ color:#111; text-decoration:none; }
    .tiny{ font-size:13px; color:#666; }

    /* Toast */
    .toast{
      position:fixed; left:50%; bottom:calc(var(--ftr-h) + env(safe-area-inset-bottom,0px) + 12px); transform:translateX(-50%);
      background:#111; color:#fff; padding:10px 14px; border-radius:10px; box-shadow:0 8px 24px rgba(0,0,0,.3); z-index:1400; font-size:14px; display:none;
    }
    .toast.show{ display:block; }

    /* Dark mode */
    :host-context(.dark) .drawer{ background:#171917; color:#f1f3ef; border-right:1px solid #1f231f; }
    :host-context(.dark) .drawer nav a{ color:#f1f3ef; border-color:#1f231f; }
    :host-context(.dark) .drawer-footer{ background:#171917; border-top:1px solid #1f231f; }
    :host-context(.dark) .df-left .slogan,
    :host-context(.dark) .df-right,
    :host-context(.dark) .org .org-loc{ color:#cfd3cf; }
    :host-context(.dark) .panel{ background:#1b1d1b; color:#f1f3f1; border-color:#253228; }
    :host-context(.dark) .chip{ background:#1b1d1b; color:#f1f3f1; border-color:#3a423a; }
  </style>

  <header class="hdr" part="header">
    <button class="iconbtn js-menu" aria-label="Open menu">≡</button>
    <div class="title">FarmVista</div>
    <button class="iconbtn js-account" aria-label="Account">👥</button>
  </header>
  <div class="gold-bar" aria-hidden="true"></div>

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

    <nav>
      <a href="/Farm-vista/dashboard/"><span>🏠</span> Home</a>
      <a href="#"><span>🌱</span> Crop Production</a>
      <a href="#"><span>🚜</span> Equipment</a>
      <a href="#"><span>🌾</span> Grain</a>
      <a href="#"><span>💵</span> Expenses</a>
      <a href="#"><span>📊</span> Reports</a>
      <a href="#"><span>⚙️</span> Setup</a>
    </nav>

    <!-- Pinned footer -->
    <footer class="drawer-footer">
      <div class="df-left">
        <div class="brand">FarmVista</div>
        <div class="slogan js-slogan">Loading…</div>
      </div>
      <div class="df-right"><span class="js-ver">v0.0.0</span></div>
    </footer>
  </aside>

  <section class="panel js-panel" role="dialog" aria-label="Account & settings">
    <div class="sec">
      <h6>THEME</h6>
      <button class="chip js-theme" data-mode="system" aria-pressed="true">System</button>
      <button class="chip js-theme" data-mode="light"  aria-pressed="false">Light</button>
      <button class="chip js-theme" data-mode="dark"   aria-pressed="false">Dark</button>
    </div>
    <div class="sec seg">
      <h6>PROFILE</h6>
      <div class="linkrow"><a href="#">Account details</a><span class="tiny">Coming soon</span></div>
      <div class="linkrow"><a href="#">Feedback</a><span class="tiny">Coming soon</span></div>
      <div class="linkrow"><a href="#">Security</a><span class="tiny">Coming soon</span></div>
    </div>
    <div class="sec seg">
      <h6>MAINTENANCE</h6>
      <div class="linkrow">
        <button class="chip js-update" aria-busy="false">Check for updates</button>
        <span class="tiny">Clears cache & reloads</span>
      </div>
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
      this._panel = r.querySelector('.js-panel');
      this._footerText = r.querySelector('.js-footer');
      this._toast = r.querySelector('.js-toast');

      // Drawer footer refs
      this._verEl = r.querySelector('.js-ver');
      this._sloganEl = r.querySelector('.js-slogan');

      this._btnMenu.addEventListener('click', ()=> this.toggleDrawer(true));
      this._scrim.addEventListener('click', ()=> this.toggleDrawer(false));
      this._btnAccount.addEventListener('click', ()=> this.togglePanel());
      document.addEventListener('keydown', (e)=>{ if(e.key==='Escape'){ this.toggleDrawer(false); this.openPanel(false);} });

      r.querySelectorAll('.js-theme').forEach(btn=>{
        btn.addEventListener('click', ()=> this.setTheme(btn.dataset.mode));
      });
      document.addEventListener('fv:theme', (e)=> this._syncThemeChips(e.detail.mode));
      this._syncThemeChips((window.App && App.getTheme && App.getTheme()) || 'system');

      // Version + slogan + date
      const now = new Date();
      const dateStr = now.toLocaleDateString(undefined, { weekday:'long', year:'numeric', month:'long', day:'numeric' });

      const verNumber =
        (window.FV_VERSION && FV_VERSION.number) ||
        (window.App && App.getVersion && (App.getVersion().number || '')) ||
        (window.FV_BUILD || '0.0.0');

      const tagline =
        (window.FV_VERSION && FV_VERSION.tagline) ||
        'Farm data, simplified';

      // Bottom app footer (green bar)
      this._footerText.textContent = `© ${now.getFullYear()} FarmVista • ${dateStr}`;

      // Sidebar footer (left/right layout)
      this._verEl.textContent = `v${verNumber}`;
      this._sloganEl.textContent = tagline;

      r.querySelector('.js-update').addEventListener('click', ()=> this.checkForUpdates());

      setTimeout(()=>{
        if (!customElements.get('fv-hero-card')) {
          this._toastMsg('Hero components not loaded. Check /js/fv-hero.js path or cache.');
        }
      }, 300);
    }

    toggleDrawer(open){
      const on = (open===undefined) ? !this.classList.contains('drawer-open') : open;
      this.classList.toggle('drawer-open', on);
      document.documentElement.style.overflow = on ? 'hidden' : '';
    }
    togglePanel(){ this.openPanel(!this._panel.classList.contains('open')); }
    openPanel(on){ this._panel.classList.toggle('open', !!on); if(on){ this._positionPanel(); } }
    _positionPanel(){
      const rect = this._panel.getBoundingClientRect();
      if(rect.right > window.innerWidth - 8){ this._panel.style.right = '8px'; this._panel.style.left = 'auto'; }
    }

    _syncThemeChips(mode){
      this.shadowRoot.querySelectorAll('.js-theme').forEach(b=> b.setAttribute('aria-pressed', String(b.dataset.mode===mode)));
    }
    setTheme(mode){
      try{
        if(window.App && App.setTheme){ App.setTheme(mode); }
        else {
          document.documentElement.classList.toggle('dark',
            mode==='dark' || (mode==='system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
          );
          localStorage.setItem('fv-theme', mode);
        }
      }catch{}
      this._syncThemeChips(mode);
    }

    async checkForUpdates(){
      const btn = this.shadowRoot.querySelector('.js-update');
      btn.setAttribute('aria-busy','true');
      const done = (m)=>{ btn.setAttribute('aria-busy','false'); this._toastMsg(m); };
      try{
        if('caches' in window){ const keys = await caches.keys(); await Promise.all(keys.map(k=>caches.delete(k))); }
        if('serviceWorker' in navigator){ const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(r=>r.unregister())); }
        done('Updated. Reloading…');
        const url = new URL(location.href); url.searchParams.set('rev', Date.now().toString()); location.replace(url.toString());
      }catch(e){ console.error(e); done('Could not complete update.'); }
    }
    _toastMsg(msg){
      const t = this._toast; t.textContent = msg; t.classList.add('show');
      clearTimeout(this._tt); this._tt = setTimeout(()=>t.classList.remove('show'), 2400);
    }
  }
  customElements.define('fv-shell', FVShell);
})();