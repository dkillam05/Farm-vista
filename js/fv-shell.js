/* ==========================================================
   FarmVista — <fv-shell> v4
   Global header • sidebar • footer • account panel
   - Works with App.{getTheme,setTheme} from core.js
   - Content scrolls between fixed header & footer
   - Check for updates: clears cache + hard reload (with spinner + toast)
   ========================================================== */
(function () {
  const tpl = document.createElement('template');
  tpl.innerHTML = `
  <style>
    :host{
      --green:#3B7E46;         /* fallback; theme.css should override */
      --gold:#D0C542;
      --surface:var(--surface, #fff);
      --text:var(--text, #141514);
      --muted:var(--muted, #5c5f5a);
      --border:var(--border, #E3E6E2);
      --shadow:var(--shadow, 0 10px 22px rgba(0,0,0,.10));

      --hdr-h:56px;
      --ftr-h:42px;
      display:block;
      color:var(--text);
      background:var(--page, var(--app-bg, #f5f7f4));
      min-height:100vh;
      position:relative;
    }

    /* ===== Header (fixed) ===== */
    .hdr{
      position:fixed; inset:0 0 auto 0; height:var(--hdr-h);
      background:var(--brand-green, var(--green));
      color:#fff; display:grid; grid-template-columns:56px 1fr 56px; align-items:center;
      z-index:1000; box-shadow:0 2px 0 rgba(0,0,0,.05);
    }
    .hdr .title{ text-align:center; font-weight:800; font-size:20px; }
    .iconbtn{
      display:grid; place-items:center; width:56px; height:56px; border:none; background:transparent; color:#fff;
    }
    .gold-bar{
      position:fixed; top:var(--hdr-h); left:0; right:0; height:3px; background:var(--brand-gold, var(--gold)); z-index:999;
    }

    /* ===== Footer (fixed) ===== */
    .ftr{
      position:fixed; inset:auto 0 0 0; height:var(--ftr-h);
      background:var(--brand-green, var(--green)); color:#fff;
      display:flex; align-items:center; justify-content:center;
      border-top:3px solid var(--brand-gold, var(--gold));
      z-index:900;
    }
    .ftr .text{ font-size:14px; opacity:.95; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

    /* ===== Main scroll area ===== */
    .main{
      position:relative;
      padding: calc(var(--hdr-h) + 8px) 16px calc(var(--ftr-h) + 16px);
      min-height:100vh;
      box-sizing:border-box;
    }
    ::slotted(.container){ max-width:980px; margin:0 auto; }

    /* ===== Sidebar (drawer) ===== */
    .scrim{
      position:fixed; inset:0; background:rgba(0,0,0,.45); opacity:0; pointer-events:none; transition:opacity .2s;
      z-index:1100;
    }
    .drawer{
      position:fixed; top:0; bottom:0; left:0; width:min(84vw, 320px);
      background:#fff; color:#222; box-shadow:0 0 36px rgba(0,0,0,.25);
      transform:translateX(-100%); transition:transform .25s; z-index:1200; overflow-y:auto;
      -webkit-overflow-scrolling:touch;
    }
    .drawer header{ padding:16px; border-bottom:1px solid #eee; display:flex; align-items:center; gap:12px; }
    .drawer nav a{
      display:flex; align-items:center; gap:12px; padding:14px 16px; text-decoration:none; color:#222;
      border-bottom:1px solid #f3f3f3;
    }
    .drawer footer{ padding:14px 16px; font-size:14px; color:#777; }

    .drawer-open .scrim{ opacity:1; pointer-events:auto; }
    .drawer-open .drawer{ transform:translateX(0); }

    /* ===== Account panel ===== */
    .panel{
      position:fixed; right:8px; top:calc(var(--hdr-h) + 8px);
      background:#fff; color:#111; border:1px solid #e6e6e6; border-radius:12px; box-shadow:0 18px 44px rgba(0,0,0,.28);
      min-width:280px; max-width:92vw; z-index:1300; display:none; overflow:hidden;
    }
    .panel.open{ display:block; }
    .panel .sec{ padding:14px 16px; }
    .panel h6{ margin:0 0 10px; font:600 12px/1 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; letter-spacing:.12em; color:#6c6f6a; }
    .seg{ border-top:1px solid #eee; }

    .chip{
      appearance:none; border:1.5px solid #d7dbd3; padding:8px 12px; border-radius:20px; background:#fff; color:#111; margin-right:10px;
      font-weight:600;
    }
    .chip[aria-pressed="true"]{ outline:3px solid #fff; background:var(--brand-green, var(--green)); color:#fff; border-color:transparent; }

    .linkrow{ display:flex; align-items:center; justify-content:space-between; padding:12px 0; }
    .linkrow a{ color:#111; text-decoration:none; }
    .tiny{ font-size:13px; color:#666; }

    /* Toast */
    .toast{
      position:fixed; left:50%; bottom:calc(var(--ftr-h) + 12px); transform:translateX(-50%);
      background:#111; color:#fff; padding:10px 14px; border-radius:10px; box-shadow:0 8px 24px rgba(0,0,0,.3); z-index:1400;
      font-size:14px; display:none;
    }
    .toast.show{ display:block; }

    /* Dark overrides (panel/drawer surfaces) */
    :host-context(.dark) .drawer{ background:#171917; color:#f1f3ef; border-right:1px solid #1f231f; }
    :host-context(.dark) .drawer nav a{ color:#f1f3ef; border-color:#1f231f; }
    :host-context(.dark) .panel{ background:#1b1d1b; color:#f1f3ef; border-color:#253228; }
    :host-context(.dark) .chip{ background:#1b1d1b; color:#f1f3ef; border-color:#3a423a; }
  </style>

  <!-- Header -->
  <header class="hdr" part="header">
    <button class="iconbtn js-menu" aria-label="Open menu">☰</button>
    <div class="title">FarmVista</div>
    <button class="iconbtn js-account" aria-label="Account">👥</button>
  </header>
  <div class="gold-bar" aria-hidden="true"></div>

  <!-- Scrim + Drawer -->
  <div class="scrim js-scrim"></div>
  <aside class="drawer" part="drawer" aria-label="Main menu">
    <header>
      <img src="/Farm-vista/assets/icons/icon-192.png" alt="" width="40" height="40" />
      <div>
        <div style="font-weight:800">FarmVista</div>
        <div class="tiny">Menu</div>
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
    <footer><strong>FarmVista</strong> <span class="tiny js-ver">v0.0.0</span></footer>
  </aside>

  <!-- Account panel -->
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
      <div class="linkrow"><a href="#">Feedback</a>       <span class="tiny">Coming soon</span></div>
      <div class="linkrow"><a href="#">Security</a>       <span class="tiny">Coming soon</span></div>
    </div>
    <div class="sec seg">
      <h6>MAINTENANCE</h6>
      <div class="linkrow">
        <button class="chip js-update" aria-busy="false">Check for updates</button>
        <span class="tiny">Clears cache & reloads</span>
      </div>
    </div>
  </section>

  <!-- Main scrolling content -->
  <main class="main" part="main"><slot></slot></main>

  <!-- Footer -->
  <footer class="ftr" part="footer">
    <div class="text js-footer"></div>
  </footer>

  <!-- Toast -->
  <div class="toast js-toast" role="status" aria-live="polite"></div>
  `;

  class FVShell extends HTMLElement {
    constructor(){ super(); this.attachShadow({mode:'open'}).appendChild(tpl.content.cloneNode(true)); }
    connectedCallback(){
      const r = this.shadowRoot;
      // Buttons
      this._btnMenu = r.querySelector('.js-menu');
      this._btnAccount = r.querySelector('.js-account');
      this._scrim = r.querySelector('.js-scrim');
      this._drawer = r.querySelector('.drawer');
      this._panel = r.querySelector('.js-panel');
      this._footerText = r.querySelector('.js-footer');
      this._toast = r.querySelector('.js-toast');
      this._ver = r.querySelector('.js-ver');

      // Events
      this._btnMenu.addEventListener('click', ()=> this.toggleDrawer(true));
      this._scrim.addEventListener('click', ()=> this.toggleDrawer(false));
      this._btnAccount.addEventListener('click', ()=> this.togglePanel());
      document.addEventListener('keydown', (e)=>{ if(e.key==='Escape'){ this.toggleDrawer(false); this.openPanel(false);} });

      // Theme chips
      r.querySelectorAll('.js-theme').forEach(btn=>{
        btn.addEventListener('click', ()=> this.setTheme(btn.dataset.mode));
      });
      this._syncThemeChips((window.App && App.getTheme && App.getTheme()) || 'system');

      // Keep chips in sync with external changes
      document.addEventListener('fv:theme', (e)=> this._syncThemeChips(e.detail.mode));

      // Footer text & version
      const now = new Date();
      const dateStr = now.toLocaleDateString(undefined, { weekday:'long', year:'numeric', month:'long', day:'numeric' });
      const ver = (window.App && App.getVersion && (App.getVersion().number || '')) || (window.FV_BUILD || '');
      this._ver.textContent = ver ? `v${ver}` : 'v0.0.0';
      this._footerText.textContent = `© ${now.getFullYear()} FarmVista • ${dateStr}`;

      // Check for updates
      r.querySelector('.js-update').addEventListener('click', ()=> this.checkForUpdates());
    }

    /* Drawer & panel */
    toggleDrawer(open){
      const on = (open===undefined) ? !this.classList.contains('drawer-open') : open;
      this.classList.toggle('drawer-open', on);
      // prevent background scroll when drawer is open
      document.documentElement.style.overflow = on ? 'hidden' : '';
    }
    togglePanel(){ this.openPanel(!this._panel.classList.contains('open')); }
    openPanel(on){
      this._panel.classList.toggle('open', !!on);
      if(on){ this._positionPanel(); }
    }
    _positionPanel(){
      // keep inside viewport (right aligned under header)
      const rect = this._panel.getBoundingClientRect();
      if(rect.right > window.innerWidth - 8){
        this._panel.style.right = '8px';
        this._panel.style.left = 'auto';
      }
    }

    /* Theme */
    _syncThemeChips(mode){
      this.shadowRoot.querySelectorAll('.js-theme').forEach(btn=>{
        btn.setAttribute('aria-pressed', String(btn.dataset.mode===mode));
      });
    }
    setTheme(mode){
      try{
        if(window.App && App.setTheme){ App.setTheme(mode); }
        else { // safe fallback
          document.documentElement.classList.toggle('dark', mode==='dark' || (mode==='system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches));
          localStorage.setItem('fv-theme', mode);
        }
      }catch{}
      this._syncThemeChips(mode);
    }

    /* Updates: clear caches + reload with spinner + toast */
    async checkForUpdates(){
      const btn = this.shadowRoot.querySelector('.js-update');
      btn.setAttribute('aria-busy','true');
      const done = (msg)=>{ btn.setAttribute('aria-busy','false'); this._toastMsg(msg); };

      try{
        // Clear Cache Storage if available
        if('caches' in window){
          const keys = await caches.keys();
          await Promise.all(keys.map(k=>caches.delete(k)));
        }
        // Bust SW (if you add one later)
        if('serviceWorker' in navigator){
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map(r=>r.unregister()));
        }
        // Hard reload with cache-buster
        done('Updated. Reloading…');
        const url = new URL(location.href);
        url.searchParams.set('rev', String(Date.now()));
        location.replace(url.toString());
      }catch(err){
        done('Could not complete update. Try again.');
        console.error('[FV] update error', err);
      }
    }

    _toastMsg(msg){
      const t = this._toast;
      t.textContent = msg;
      t.classList.add('show');
      clearTimeout(this._tTimer);
      this._tTimer = setTimeout(()=> t.classList.remove('show'), 2400);
    }
  }

  customElements.define('fv-shell', FVShell);
})();