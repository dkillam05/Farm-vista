// js/fv-shell.js
// FarmVista shell with white, iconized side drawer (logo header, active highlight),
// green header, gunmetal breadcrumb row, gear menu + theme switch, repo-safe links.

class FVShell extends HTMLElement {
  constructor() {
    super();
    const r = this.attachShadow({ mode: 'open' });
    r.innerHTML = `
      <style>
        :host { display: block; }

        /* Inherit tokens (fallbacks for safety) */
        :host{
          --fv-green:      var(--fv-green, #3B7E46);
          --fv-yellow:     var(--fv-yellow, #D0C542);
          --fv-gunmetal:   var(--fv-gunmetal, #CBCDCB);
          --fv-black:      var(--fv-black, #141514);
          --fv-border:     var(--fv-border, #e2e5e5);
          --fv-surface:    var(--fv-surface, #f5f6f6);
          --fv-ring:       var(--fv-ring, #b9e1c4);
          --sidebar-w:     var(--sidebar-w, 300px); /* drawer a bit wider like the screenshot */
        }

        .container { width: min(1100px, 100%); margin-inline: auto; padding: 0 16px; }

        /* ================= HEADER ================= */
        header.fv-header { position: sticky; top: 0; z-index: 6; }

        .hdr-top{
          background: var(--fv-green);
          color:#fff;
          border-bottom:1px solid color-mix(in srgb, #000 12%, var(--fv-green));
        }
        .hdr-top .bar{
          height:56px; display:flex; align-items:center; justify-content:space-between; gap:12px;
        }
        .brand{ font-weight:800; letter-spacing:.3px; font-size:20px; color:#fff; }

        .hdr-sub{ background:var(--fv-gunmetal); color:var(--fv-black); }
        .hdr-sub .bar{ min-height:40px; display:flex; align-items:center; }
        .hdr-sub .accent{ height:3px; background:var(--fv-yellow); }

        .btn-plain{
          display:inline-flex; align-items:center; justify-content:center;
          width:40px; height:40px; border-radius:9px; cursor:pointer; font-size:22px;
          background: color-mix(in srgb, #fff 6%, transparent);
          border:1px solid color-mix(in srgb, #fff 25%, transparent);
          color:#fff; transition:transform .02s ease;
        }
        .btn-plain:active{ transform:translateY(1px); }
        .btn-plain:focus{ outline:3px solid var(--fv-ring); outline-offset:1px; }

        /* ================= SIDEBAR (white drawer like screenshot) ================= */
        aside.fv-sidebar{
          position:fixed; left:0; top:0;
          width:var(--sidebar-w); height:100dvh;
          background:#fff; color:var(--fv-black);
          border-right:1px solid var(--fv-border);
          transform:translateX(-100%); transition:transform .18s ease-out;
          z-index:999; display:flex; flex-direction:column;
          overflow-y:auto; overscroll-behavior:contain; -webkit-overflow-scrolling:touch; touch-action:pan-y;
          box-shadow:0 10px 22px rgba(0,0,0,.18);
        }

        /* Drawer header with logo */
        .sd-head{
          padding:16px 16px 12px;
          background:#fff;
          border-bottom:1px solid var(--fv-border);
        }
        .sd-head img{
          display:block; max-width:100%; height:44px; object-fit:contain;
        }

        /* Menu list */
        nav.sd-menu{ padding:8px 8px; }
        .nav-item{
          display:flex; align-items:center; gap:12px;
          padding:12px 10px; border-radius:10px; text-decoration:none;
          color:#232523; transition:background .15s ease;
        }
        .nav-item:hover{ background:#f4f6f4; }
        .nav-item .i{
          width:24px; height:24px; display:inline-flex; align-items:center; justify-content:center;
          color:#2f3530; /* icon inherits currentColor via stroke */
        }
        .nav-item .t{ font-size:16px; }

        /* Active item (teal/green block, white icon+text) */
        .nav-item.active{
          background: var(--fv-green);
          color:#fff;
        }
        .nav-item.active .i{ color:#fff; }

        /* Drawer footer (status + version) */
        .sd-foot{
          margin-top:auto; padding:14px 16px; border-top:1px solid var(--fv-border); font-size:13px;
          display:grid; gap:6px;
        }
        .status{ display:flex; align-items:center; gap:8px; color:#2b2e2b; }
        .dot{ width:10px; height:10px; border-radius:999px; background:#2BB673; box-shadow:0 0 0 2px #dcefe6 inset; }
        .muted{ color:#6a6d6a; }

        /* Scrim */
        .scrim{ position:fixed; inset:0; background:rgba(0,0,0,.45); opacity:0; pointer-events:none; transition:opacity .18s ease-out; z-index:998; }

        /* ===== MAIN & FOOTER ===== */
        main.fv-main{ padding:18px 16px 44px; }
        footer.fv-footer{ background:var(--fv-gunmetal); color:#2b2e2b; border-top:3px solid var(--fv-yellow); padding:12px 0; }

        /* Toggle mechanics */
        #navToggle{ display:none; }
        #navToggle:checked ~ aside.fv-sidebar{ transform:translateX(0); }
        #navToggle:checked ~ .scrim{ opacity:1; pointer-events:auto; }

        /* Desktop pinned */
        @media(min-width:1000px){
          .burger{ display:none; }
          aside.fv-sidebar{ transform:none; }
          .scrim{ display:none; }
          main.fv-main, footer.fv-footer{ margin-left:var(--sidebar-w); }
        }

        /* Breadcrumbs in header (for gunmetal row) */
        ::slotted(.breadcrumbs){ display:flex; flex-wrap:wrap; align-items:center; gap:6px; font-size:13px; }
        ::slotted(.breadcrumbs a){ color:#0e4d26; padding:4px 6px; border-radius:6px; text-decoration:none; }
        ::slotted(.breadcrumbs a:hover){ background:color-mix(in srgb, var(--fv-green) 18%, white); color:#0e4d26; }
        ::slotted(.breadcrumbs .sep){ opacity:.65; }
      </style>

      <input id="navToggle" type="checkbox" hidden />

      <!-- ===== Header ===== -->
      <header class="fv-header">
        <div class="hdr-top">
          <div class="container bar">
            <label for="navToggle" class="btn-plain burger" aria-label="Open menu">☰</label>
            <div class="brand">FarmVista</div>

            <div class="menu-anchor">
              <button class="btn-plain gear" aria-haspopup="menu" aria-expanded="false" title="User menu">⚙️</button>
              <div class="user-menu" role="menu" aria-label="User menu" style="display:none"></div>
            </div>
          </div>
        </div>
        <div class="hdr-sub">
          <div class="container bar"><slot name="breadcrumbs"></slot></div>
          <div class="accent"></div>
        </div>
      </header>

      <!-- ===== Sidebar (white drawer) ===== -->
      <aside class="fv-sidebar" aria-label="Primary">
        <div class="sd-head">
          <img class="logo-img" alt="FarmVista logo" />
        </div>

        <nav class="sd-menu">
          <a class="nav-item" data-route="dashboard" href="#">
            <span class="i">${iconHome()}</span><span class="t">Home</span>
          </a>
          <a class="nav-item" href="#">
            <span class="i">${iconGrid()}</span><span class="t">Grain Tracking</span>
          </a>
          <a class="nav-item" href="#">
            <span class="i">${iconDroplet()}</span><span class="t">Crop Production</span>
          </a>
          <a class="nav-item" href="#">
            <span class="i">${iconTractor()}</span><span class="t">Equipment</span>
          </a>
          <a class="nav-item" href="#">
            <span class="i">${iconChart()}</span><span class="t">Reports</span>
          </a>
          <a class="nav-item" href="#">
            <span class="i">${iconBell()}</span><span class="t">Alerts</span>
          </a>
          <a class="nav-item" href="#">
            <span class="i">${iconUser()}</span><span class="t">Account Details</span>
          </a>
          <a class="nav-item" href="#">
            <span class="i">${iconLogout()}</span><span class="t">Logout</span>
          </a>
        </nav>

        <div class="sd-foot">
          <div class="status"><span class="dot" aria-hidden="true"></span>All Systems Operational</div>
          <div class="muted">App Version <span class="ver">1.0.0</span></div>
        </div>
      </aside>

      <label class="scrim" for="navToggle" aria-hidden="true"></label>

      <main class="fv-main"><slot></slot></main>

      <footer class="fv-footer">
        <div class="container">
          <small>© <span id="y"></span> FarmVista • All rights reserved.</small>
        </div>
      </footer>
    `;

    // simple inline user menu (gear) - placeholder
    const menu = r.querySelector('.user-menu');
    if (menu) {
      menu.outerHTML = `
      <div class="user-menu" role="menu" aria-label="User menu" style="display:none; position:absolute; right:0; top:48px; min-width:220px; background:#fff; color:var(--fv-black); border:1px solid var(--fv-border); border-radius:10px; box-shadow:0 10px 22px rgba(0,0,0,.10); padding:6px; z-index:1000;">
        <h6 style="margin:6px 8px; font-size:12px; text-transform:uppercase; letter-spacing:.12em; color:#6a6d6a;">Theme</h6>
        <button data-theme="light" style="display:flex; align-items:center; justify-content:space-between; width:100%; padding:10px 10px; background:none; border:0; text-align:left; cursor:pointer; border-radius:8px;">Light <span class="check">○</span></button>
        <button data-theme="dark"  style="display:flex; align-items:center; justify-content:space-between; width:100%; padding:10px 10px; background:none; border:0; text-align:left; cursor:pointer; border-radius:8px;">Dark <span class="check">○</span></button>
        <button data-theme="system" style="display:flex; align-items:center; justify-content:space-between; width:100%; padding:10px 10px; background:none; border:0; text-align:left; cursor:pointer; border-radius:8px;">System <span class="check">○</span></button>
        <div style="height:1px; background:var(--fv-border); margin:6px; border-radius:999px;"></div>
        <a href="#" class="logout" style="display:flex; align-items:center; justify-content:space-between; width:100%; padding:10px 10px; text-decoration:none; border-radius:8px; color:#9b1d1d;">Logout</a>
      </div>`;
    }

    // helper: inline icons (stroke = currentColor)
    function icon(svgPath){ return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${svgPath}</svg>`; }
    function iconHome(){ return icon('<path d="M3 10.5 12 4l9 6.5"/><path d="M5 10.5V20h14v-9.5"/><path d="M10 20v-5h4v5"/>'); }
    function iconGrid(){ return icon('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>'); }
    function iconDroplet(){ return icon('<path d="M12 3c3.5 4.6 7 7.7 7 12a7 7 0 1 1-14 0c0-4.3 3.5-7.4 7-12z"/>'); }
    function iconTractor(){ return icon('<circle cx="7" cy="17" r="3"/><circle cx="18" cy="15" r="2"/><path d="M5 17h-2v-4l3-2 5 2 2-4h4l1 4h-5m-7 4h10"/>'); }
    function iconChart(){ return icon('<path d="M3 3v18h18"/><rect x="6" y="10" width="3" height="8"/><rect x="11" y="6" width="3" height="12"/><rect x="16" y="12" width="3" height="6"/>'); }
    function iconBell(){ return icon('<path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>'); }
    function iconUser(){ return icon('<circle cx="12" cy="8" r="4"/><path d="M6 20c2-3 10-3 12 0"/>'); }
    function iconLogout(){ return icon('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>'); }

    // expose for template literals to use inside string above
    this._icons = { iconHome, iconGrid, iconDroplet, iconTractor, iconChart, iconBell, iconUser, iconLogout };
  }

  connectedCallback() {
    const y = this.shadowRoot.getElementById('y');
    if (y) y.textContent = new Date().getFullYear();

    // Set correct logo path relative to repo root
    const prefix = this._computeRepoPrefix();
    const logo = this.shadowRoot.querySelector('.logo-img');
    if (logo) logo.src = `${prefix}assets/icons/logo.png`;

    // Repo-safe Dashboard link + active state
    const dash = this.shadowRoot.querySelector('[data-route="dashboard"]');
    if (dash) {
      dash.setAttribute('href', `${prefix}dashboard/`);
      if (location.pathname.includes('/dashboard/')) dash.classList.add('active');
    }

    // Make the first nav item active by default if none is marked
    const anyActive = this.shadowRoot.querySelector('.nav-item.active');
    if (!anyActive && dash) dash.classList.add('active');

    // Gear menu basic open/close + theme switch
    const gear = this.shadowRoot.querySelector('.gear');
    const menu = this.shadowRoot.querySelector('.user-menu');
    const onDocClick = (e) => {
      const path = e.composedPath();
      const inside = path.some(el => el === this.shadowRoot || (el && el.host === this));
      if (!inside) { menu.style.display = 'none'; gear.setAttribute('aria-expanded','false'); document.removeEventListener('click', onDocClick, true); }
    };
    gear?.addEventListener('click', () => {
      const open = menu.style.display !== 'block';
      menu.style.display = open ? 'block' : 'none';
      gear.setAttribute('aria-expanded', String(open));
      if (open) document.addEventListener('click', onDocClick, true);
    });

    // Theme persistence
    const applyTheme = (mode) => {
      localStorage.setItem('fv-theme', mode);
      const root = document.documentElement;
      root.classList.remove('dark');
      if (mode === 'dark') root.classList.add('dark');
      else if (mode === 'system') {
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) root.classList.add('dark');
      }
      reflectChecks();
    };
    const reflectChecks = () => {
      const mode = localStorage.getItem('fv-theme') || 'system';
      this.shadowRoot.querySelectorAll('.user-menu .check').forEach(c => c.textContent = '○');
      const curr = this.shadowRoot.querySelector(\`.user-menu [data-theme="\${mode}"] .check\`);
      if (curr) curr.textContent = '●';
    };
    const saved = localStorage.getItem('fv-theme') || 'system';
    applyTheme(saved);
    this.shadowRoot.querySelectorAll('.user-menu [data-theme]').forEach(btn => {
      btn.addEventListener('click', () => applyTheme(btn.getAttribute('data-theme') || 'system'));
    });
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener?.('change', () => { if ((localStorage.getItem('fv-theme')||'system')==='system') applyTheme('system'); });

    // Version from attribute if provided <fv-shell version="1.0.5">
    const ver = this.getAttribute('version');
    if (ver) {
      const vEl = this.shadowRoot.querySelector('.sd-foot .ver');
      if (vEl) vEl.textContent = ver;
    }
  }

  /* Compute prefix to repo root (handles user or project sites, any depth) */
  _computeRepoPrefix(){
    const parts = location.pathname.split('/').filter(Boolean);
    // For project site (username.github.io/RepoName/...), site root is first segment
    // For user site, site root is /
    // We want to go "up" to the first segment (or to root if user site).
    if (parts.length === 0) return './';
    // If first part looks like a repo (most cases), prefix should go back to root of site:
    // e.g., /Farm-vista/dashboard/ -> parts= ['Farm-vista','dashboard'] -> up = parts.length - 1 = 1 -> '../'
    const up = Math.max(0, parts.length - 1);
    return '../'.repeat(up);
  }
}

// ---- inline icon helpers (used above) ----
function icon(svgPath){ return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${svgPath}</svg>`; }
function iconHome(){ return icon('<path d="M3 10.5 12 4l9 6.5"/><path d="M5 10.5V20h14v-9.5"/><path d="M10 20v-5h4v5"/>'); }
function iconGrid(){ return icon('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>'); }
function iconDroplet(){ return icon('<path d="M12 3c3.5 4.6 7 7.7 7 12a7 7 0 1 1-14 0c0-4.3 3.5-7.4 7-12z"/>'); }
function iconTractor(){ return icon('<circle cx="7" cy="17" r="3"/><circle cx="18" cy="15" r="2"/><path d="M5 17h-2v-4l3-2 5 2 2-4h4l1 4h-5m-7 4h10"/>'); }
function iconChart(){ return icon('<path d="M3 3v18h18"/><rect x="6" y="10" width="3" height="8"/><rect x="11" y="6" width="3" height="12"/><rect x="16" y="12" width="3" height="6"/>'); }
function iconBell(){ return icon('<path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>'); }
function iconUser(){ return icon('<circle cx="12" cy="8" r="4"/><path d="M6 20c2-3 10-3 12 0"/>'); }
function iconLogout(){ return icon('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>'); }

customElements.define('fv-shell', FVShell);