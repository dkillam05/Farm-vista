// js/fv-shell.js
// FarmVista Shell: global header + sidebar + footer + user menu (no hero logic)

class FVShell extends HTMLElement {
  constructor() {
    super();
    const r = this.attachShadow({ mode: 'open' });
    r.innerHTML = `
      <style>
        :host{
          display:block;
          /* brand tokens (fall back to CSS variables if present in theme.css) */
          --fv-green:    var(--fv-green, #3B7E46);
          --fv-yellow:   var(--fv-yellow, #D0C542);
          --fv-gunmetal: var(--fv-gunmetal, #CBCDCB);
          --fv-black:    var(--fv-black, #141514);
          --fv-border:   var(--fv-border, #e2e5e5);
          --fv-surface:  var(--fv-surface, #ffffff);
          --fv-ring:     var(--fv-ring, #b9e1c4);
          --sidebar-w:   var(--sidebar-w, 300px);
          --safe-right:  env(safe-area-inset-right);
          --safe-left:   env(safe-area-inset-left);
          --safe-bottom: env(safe-area-inset-bottom);
          --hdr-h:       56px;
        }
        .container{ width:min(1100px,100%); margin-inline:auto; padding:0 16px; }

        /* ===== HEADER ===== */
        header.fv-header{ position:sticky; top:0; z-index:6; }
        .hdr-top{ background:var(--fv-green); color:#fff; border-bottom:1px solid color-mix(in srgb,#000 12%,var(--fv-green)); }
        .hdr-top .bar{ height:var(--hdr-h); display:flex; align-items:center; justify-content:space-between; gap:12px; }
        .brand{ font-weight:800; letter-spacing:.3px; font-size:20px; color:#fff; }
        .hdr-sub{ background:var(--fv-gunmetal); color:var(--fv-black); }
        .hdr-sub .bar{ min-height:40px; display:flex; align-items:center; }
        .hdr-sub .accent{ height:3px; background:var(--fv-yellow); }

        /* Buttons */
        .btn-plain{
          display:inline-flex; align-items:center; justify-content:center;
          width:40px; height:40px; border-radius:9px; cursor:pointer; font-size:22px;
          background: color-mix(in srgb, #fff 6%, transparent);
          border:1px solid color-mix(in srgb, #fff 25%, transparent);
          color:#fff; transition:transform .02s ease;
        }
        .btn-plain:active{ transform:translateY(1px); }
        .btn-plain:focus{ outline:3px solid var(--fv-ring); outline-offset:1px; }

        /* ===== DRAWER ===== */
        aside.fv-sidebar{
          position:fixed; inset:0 auto 0 0; width:var(--sidebar-w);
          background:#fff; color:var(--fv-black);
          border-right:1px solid var(--fv-border);
          transform:translateX(-100%); transition:transform .18s ease-out;
          z-index:999; display:flex; flex-direction:column;
          overflow-y:auto; overscroll-behavior:contain; -webkit-overflow-scrolling:touch; touch-action:pan-y;
          box-shadow:0 10px 22px rgba(0,0,0,.18);
        }
        .sd-head{ padding:16px 16px 12px; background:#fff; border-bottom:1px solid var(--fv-border); }
        .sd-head img{ display:block; max-width:100%; height:44px; object-fit:contain; }

        nav.sd-menu{ padding:8px 8px; }
        .nav-item{
          display:flex; align-items:center; gap:12px;
          padding:12px 10px; border-radius:10px; text-decoration:none;
          color:#232523; transition:background .15s ease;
        }
        .nav-item:hover{ background:#f4f6f4; }
        .nav-item .i{ width:24px; height:24px; display:inline-flex; align-items:center; justify-content:center; color:#2f3530; }
        .nav-item .t{ font-size:16px; }
        .nav-item.active{ background:var(--fv-green); color:#fff; }
        .nav-item.active .i{ color:#fff; }

        .sd-foot{ margin-top:auto; padding:14px 16px; border-top:1px solid var(--fv-border); font-size:13px; display:grid; gap:4px; }
        .muted{ color:#6a6d6a; }

        /* Scrim behind drawer */
        .scrim{ position:fixed; inset:0; background:rgba(0,0,0,.45); opacity:0; pointer-events:none; transition:opacity .18s ease-out; z-index:998; }

        /* Main + footer */
        main.fv-main{ padding:18px 16px 44px; background:var(--fv-surface); min-height: 40vh; }
        footer.fv-footer{
          background:var(--fv-gunmetal); color:#2b2e2b; border-top:3px solid var(--fv-yellow); padding:12px max(16px, var(--safe-right)) calc(12px + var(--safe-bottom)) max(16px, var(--safe-left));
        }

        /* Toggle mechanics */
        #navToggle{ display:none; }
        #navToggle:checked ~ aside.fv-sidebar{ transform:translateX(0); }
        #navToggle:checked ~ .scrim{ opacity:1; pointer-events:auto; }

        /* ===== USER MENU (fixed, safe-area aware) ===== */
        .menu-anchor{ position:relative; }
        .user-menu{
          position:fixed;               /* critical: avoid clipping inside header */
          top: var(--hdr-h);
          right: max(8px, var(--safe-right));
          min-width: 280px;
          max-width: calc(100vw - 16px - var(--safe-right));
          background:#fff; color:var(--fv-black);
          border:1px solid var(--fv-border);
          border-radius:12px;
          box-shadow:0 10px 22px rgba(0,0,0,.14);
          padding:8px;
          z-index:1002;                 /* above scrim (998) */
          display:none;
        }
        .um-section{ margin:4px 6px 8px; font-size:12px; font-weight:700; letter-spacing:.12em; color:#6a6d6a; text-transform:uppercase; }
        .chip-row{ display:flex; gap:8px; padding:0 6px 8px; }
        .chip{
          border:1px solid var(--fv-border); border-radius:999px; padding:8px 12px; background:#fff; cursor:pointer; user-select:none;
        }
        .chip[aria-pressed="true"]{ outline:2px solid var(--fv-ring); }
        .um-item{ display:flex; align-items:center; justify-content:space-between; padding:10px 10px; border-radius:10px; text-decoration:none; color:inherit; }
        .um-item:hover{ background:#f6f7f6; }
        .um-meta{ color:#6a6d6a; }
        .um-spinner{ display:none; width:16px; height:16px; border-radius:50%; border:2px solid #8aa892; border-top-color:transparent; animation:spin .8s linear infinite; margin-left:6px; }
        @keyframes spin{ to { transform:rotate(360deg);} }

        /* Breadcrumbs coloring in header */
        ::slotted(.breadcrumbs){ display:flex; flex-wrap:wrap; align-items:center; gap:6px; font-size:13px; }
        ::slotted(.breadcrumbs a){ color:#0e4d26; padding:4px 6px; border-radius:6px; text-decoration:none; }
        ::slotted(.breadcrumbs a:hover){ background:color-mix(in srgb, var(--fv-green) 18%, white); color:#0e4d26; }
        ::slotted(.breadcrumbs .sep){ opacity:.65; }

        /* Toast */
        .toast{
          position:fixed; left:50%; bottom:calc(12px + var(--safe-bottom));
          transform:translateX(-50%); background:#1b1d1b; color:#fff;
          padding:10px 14px; border-radius:10px; box-shadow:0 10px 22px rgba(0,0,0,.18);
          z-index:1003; display:none; font-size:14px;
        }
      </style>

      <input id="navToggle" type="checkbox" hidden />

      <header class="fv-header">
        <div class="hdr-top">
          <div class="container bar">
            <label for="navToggle" class="btn-plain" aria-label="Open menu" title="Menu">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
            </label>
            <div class="brand">FarmVista</div>

            <div class="menu-anchor">
              <button class="btn-plain gear" aria-haspopup="menu" aria-expanded="false" title="User menu">
                <!-- people icon -->
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
              </button>

              <!-- User menu -->
              <div class="user-menu" role="menu" aria-label="User menu">
                <div class="um-section">Theme</div>
                <div class="chip-row">
                  <button class="chip" data-theme="system" aria-pressed="false">System</button>
                  <button class="chip" data-theme="light"  aria-pressed="false">Light</button>
                  <button class="chip" data-theme="dark"   aria-pressed="false">Dark</button>
                </div>

                <div class="um-section">Profile</div>
                <a class="um-item" href="#"><span>Account details</span><span class="um-meta">Coming soon</span></a>
                <a class="um-item" href="#"><span>Feedback</span><span class="um-meta">Coming soon</span></a>
                <a class="um-item" href="#"><span>Security</span><span class="um-meta">Coming soon</span></a>

                <div class="um-section">Maintenance</div>
                <button class="um-item um-update" type="button" title="Check for updates">
                  <span>Check for updates</span>
                  <span style="display:inline-flex; align-items:center;">
                    <span class="um-spinner" aria-hidden="true"></span>
                    <svg class="um-refresh" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 1 1 2.13 9.36L1 14"/></svg>
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
        <div class="hdr-sub">
          <div class="container bar"><slot name="breadcrumbs"></slot></div>
          <div class="accent"></div>
        </div>
      </header>

      <aside class="fv-sidebar" aria-label="Primary">
        <div class="sd-head">
          <img class="logo-img" alt="FarmVista logo" />
        </div>

        <nav class="sd-menu">
          <a class="nav-item" data-route="dashboard" href="#"><span class="i">${iconHome()}</span><span class="t">Home</span></a>
          <a class="nav-item" href="#"><span class="i">${iconLeaf()}</span><span class="t">Crop Production</span></a>
          <a class="nav-item" href="#"><span class="i">${iconTractor()}</span><span class="t">Equipment</span></a>
          <a class="nav-item" href="#"><span class="i">${iconGrain()}</span><span class="t">Grain</span></a>
          <a class="nav-item" href="#"><span class="i">${iconMoney()}</span><span class="t">Expenses</span></a>
          <a class="nav-item" href="#"><span class="i">${iconChart()}</span><span class="t">Reports</span></a>
          <a class="nav-item" href="#"><span class="i">${iconCog()}</span><span class="t">Setup</span></a>
        </nav>

        <div class="sd-foot">
          <div class="muted"><strong>FarmVista</strong> <span class="ver">1.0.0</span></div>
        </div>
      </aside>

      <label class="scrim" for="navToggle" aria-hidden="true"></label>

      <main class="fv-main"><slot></slot></main>

      <footer class="fv-footer">
        <div class="container">
          <small>© <span id="y"></span> FarmVista • <span class="date"></span></small>
        </div>
      </footer>

      <div class="toast" role="status" aria-live="polite"></div>
    `;

    // icon helpers
    function icon(p){ return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`; }
    function iconHome(){ return icon('<path d="M3 10.5 12 4l9 6.5"/><path d="M5 10.5V20h14v-9.5"/><path d="M10 20v-5h4v5"/>'); }
    function iconLeaf(){ return icon('<path d="M2 22s4-10 20-10c-2 6-8 10-14 10-3 0-6 0-6 0Z"/><path d="M7 13c2 2 3 5 3 9"/>'); }
    function iconTractor(){ return icon('<circle cx="7" cy="17" r="3"/><circle cx="18" cy="15" r="2"/><path d="M5 17h-2v-4l3-2 5 2 2-4h4l1 4h-5m-7 4h10"/>'); }
    function iconGrain(){ return icon('<path d="M4 22s2-8 10-8c-1 5-5 8-8 8-2 0-2 0-2 0Z"/><path d="M9 13c1 1 2 3 2 6"/>'); }
    function iconMoney(){ return icon('<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M12 8v8"/><path d="M8 10c1-1 3-1 4-1s3 0 4 1"/>'); }
    function iconChart(){ return icon('<path d="M3 3v18h18"/><rect x="6" y="10" width="3" height="8"/><rect x="11" y="6" width="3" height="12"/><rect x="16" y="12" width="3" height="6"/>'); }
    function iconCog(){ return icon('<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06A2 2 0 0 1 7.04 3.3l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.08a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c0 .67.39 1.27 1 1.51H21a2 2 0 1 1 0 4h-.09c-.61.24-1 .84-1 1.49z"/>'); }

    this._icons = { iconHome, iconLeaf, iconTractor, iconGrain, iconMoney, iconChart, iconCog };
  }

  connectedCallback(){
    const root = this.shadowRoot;

    // Footer year + date
    const y = root.getElementById('y'); if (y) y.textContent = new Date().getFullYear();
    const dateEl = root.querySelector('.date');
    if (dateEl){
      const d = new Date();
      const fmt = new Intl.DateTimeFormat(undefined, { weekday:'long', year:'numeric', month:'long', day:'numeric' });
      dateEl.textContent = fmt.format(d);
    }

    // repo-safe asset prefix
    const prefix = this._computeRepoPrefix();
    const logo = root.querySelector('.logo-img'); if (logo) logo.src = `${prefix}assets/icons/logo.png`;

    // Dashboard link + active state
    const dash = root.querySelector('[data-route="dashboard"]');
    if (dash) {
      dash.setAttribute('href', `${prefix}dashboard/`);
      if (location.pathname.includes('/dashboard/')) dash.classList.add('active');
    }

    // Reflect version if provided on attribute
    const ver = this.getAttribute('version');
    const vEl = root.querySelector('.sd-foot .ver');
    if (ver && vEl) vEl.textContent = ver;

    // Menu toggle
    const gear = root.querySelector('.gear');
    const menu = root.querySelector('.user-menu');
    const scrim = root.querySelector('.scrim');
    const onDocClick = (e) => {
      const path = e.composedPath();
      const insideShadow = path.includes(menu) || path.includes(gear) || path.includes(this);
      if (!insideShadow) { menu.style.display = 'none'; gear?.setAttribute('aria-expanded','false'); document.removeEventListener('click', onDocClick, true); }
    };
    gear?.addEventListener('click', () => {
      const open = menu.style.display !== 'block';
      menu.style.display = open ? 'block' : 'none';
      gear.setAttribute('aria-expanded', String(open));
      if (open) document.addEventListener('click', onDocClick, true);
    });
    scrim?.addEventListener('click', () => { menu.style.display='none'; gear?.setAttribute('aria-expanded','false'); });

    // Theme chips
    const chips = Array.from(root.querySelectorAll('.chip[data-theme]'));
    const reflect = () => {
      const mode = (window.localStorage.getItem('fv-theme') || 'system');
      chips.forEach(c => c.setAttribute('aria-pressed', String(c.dataset.theme === mode)));
    };
    chips.forEach(btn => btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-theme') || 'system';
      if (window.App?.setTheme) window.App.setTheme(mode);
      else { try { localStorage.setItem('fv-theme', mode); } catch {} }
      reflect();
    }));
    reflect();
    // If core broadcasts changes, reflect them
    document.addEventListener('fv:theme', reflect);

    // Check for updates (one button)
    const btnUpdate = root.querySelector('.um-update');
    const spinner = root.querySelector('.um-spinner');
    btnUpdate?.addEventListener('click', async () => {
      spinner.style.display = 'inline-block';
      btnUpdate.disabled = true;
      try {
        await this._hardRefresh();
        this._toast('Updated • reloading…');
        location.reload();
      } catch (e){
        this._toast('You are up to date');
      } finally {
        spinner.style.display = 'none';
        btnUpdate.disabled = false;
      }
    });
  }

  _computeRepoPrefix(){
    // works both at / and at /dashboard/
    const parts = location.pathname.split('/').filter(Boolean);
    const up = Math.max(0, parts.length - 1);
    return '../'.repeat(up);
  }

  async _hardRefresh(){
    try {
      // clear Cache Storage
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    } catch {}
    // tell SW to skipWaiting (if present)
    if (navigator.serviceWorker?.getRegistrations){
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(async r => { try { await r.update(); r.waiting?.postMessage?.({type:'SKIP_WAITING'}); } catch{} }));
    }
  }

  _toast(msg){
    const t = this.shadowRoot.querySelector('.toast');
    if(!t) return;
    t.textContent = msg;
    t.style.display = 'block';
    clearTimeout(this._toastT);
    this._toastT = setTimeout(()=>{ t.style.display='none'; }, 1800);
  }
}

customElements.define('fv-shell', FVShell);