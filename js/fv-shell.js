<script>
/* ==========================================================
   FarmVista — Shell (header • sidebar • footer • user menu)
   v5 — fixes right-edge overflow using grid + safe-area padding
   ========================================================== */
class FVShell extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' }).innerHTML = `
      <style>
        :host{ display:block; min-height:100dvh; background:var(--bg,#F4F6F4); color:var(--text,#141514); }
        /* Safe areas */
        .safe { padding-left: calc(12px + env(safe-area-inset-left)); padding-right: calc(12px + env(safe-area-inset-right)); }
        /* ===== App Bar ===== */
        .appbar{
          position:sticky; top:0; z-index:1000;
          background:var(--header-bg,#3B7E46);
          color:var(--header-fg,#fff);
          border-bottom:2px solid var(--brand-gold,#D0C542);
          /* Key change: grid keeps title centered and keeps buttons inside viewport */
          display:grid; grid-template-columns:auto 1fr auto; align-items:center;
          height:56px;
        }
        .btn{
          appearance:none; border:0; background:transparent; color:inherit;
          width:40px; height:40px; border-radius:10px; display:grid; place-items:center;
          margin:8px; outline:none;
        }
        .btn:focus-visible{ box-shadow:0 0 0 3px rgba(255,255,255,.4); }
        .title{ 
          font-weight:800; letter-spacing:.2px; text-align:center; overflow:hidden;
          text-overflow:ellipsis; white-space:nowrap; min-width:0;
        }
        /* ===== Drawer ===== */
        .scrim{ position:fixed; inset:0; background:rgba(0,0,0,.4); opacity:0; pointer-events:none; transition:opacity .18s ease; }
        .drawer{
          position:fixed; inset:0 auto 0 0; width:300px; max-width:85vw;
          transform:translateX(-102%); transition:transform .22s ease;
          background:var(--surface,#fff); color:var(--text,#141514);
          box-shadow: 0 18px 40px rgba(0,0,0,.28);
          display:flex; flex-direction:column;
        }
        .drawer.open{ transform:none; }
        .scrim.show{ opacity:1; pointer-events:auto; }
        .nav{ padding:16px 0 10px; overflow:auto; }
        .nav a{
          display:flex; align-items:center; gap:12px;
          padding:12px 18px; color:inherit; text-decoration:none;
        }
        .nav a:hover{ background: color-mix(in srgb, var(--brand-gold,#D0C542) 12%, transparent); }
        .nav .logo{ display:flex; align-items:center; gap:10px; padding:16px 18px 8px; }
        .nav .ver{ margin:12px 18px 16px; color:var(--muted,#6b6f6b); font-size:.9rem; }
        .nav img{ height:28px; width:auto; object-fit:contain; }
        /* ===== User Menu (popover) ===== */
        .menu{
          position:fixed; right:12px; top:56px; /* sits under appbar */
          background:var(--surface,#fff); color:var(--text,#141514);
          border:1px solid var(--border,#E3E6E2); border-radius:14px;
          box-shadow:0 18px 40px rgba(0,0,0,.28);
          width:min(420px, calc(100vw - 24px - env(safe-area-inset-right)));
          max-height:70vh; overflow:auto; padding:14px 0; display:none;
        }
        .menu.show{ display:block; }
        .menu h4{ margin:10px 16px 6px; font-size:.85rem; letter-spacing:.12em; color:var(--muted,#6b6f6b); }
        .seg{ display:flex; gap:10px; padding:8px 16px 14px; }
        .seg .chip{
          padding:8px 14px; border-radius:22px; border:1.5px solid var(--border,#E3E6E2);
          background:var(--surface,#fff); color:var(--text,#141514); cursor:pointer; user-select:none;
        }
        .chip.active{ outline:3px solid rgba(59,126,70,.35); }
        .menu .row{ display:flex; justify-content:space-between; align-items:center; padding:12px 16px; }
        .menu .row .cta{ padding:10px 14px; border-radius:10px; border:1.5px solid var(--border,#E3E6E2); background:var(--surface,#fff); }
        .menu .row .cta:disabled{ opacity:.6; }
        /* ===== Content & Footer ===== */
        .content{ min-height:0; }
        .container{ max-width:1100px; margin:0 auto; }
        .footer{
          position:sticky; bottom:0; z-index:5;
          background:var(--footer-bg,#2C5D35); color:#fff;
          border-top:3px solid var(--brand-gold,#D0C542);
          padding:10px calc(12px + env(safe-area-inset-right));
          font-size:.95rem;
        }
        /* Dark support follows html.dark */
        :host-context(html.dark){
          --bg:#0f1110; --surface:#1B1D1B; --text:#F2F4F1; --border:#253228; --muted:#A8ADA8;
          --header-bg:#2f6239; --footer-bg:#1f4a2a;
        }
      </style>

      <!-- App bar -->
      <header class="appbar safe">
        <button class="btn js-open"><span aria-hidden="true">☰</span><span class="sr">Menu</span></button>
        <div class="title">FarmVista</div>
        <button class="btn js-user" aria-haspopup="menu" aria-expanded="false" title="Account & Settings">👥</button>
      </header>

      <!-- Drawer + scrim -->
      <div class="scrim"></div>
      <aside class="drawer" aria-label="Main navigation">
        <div class="logo">
          <img alt="FarmVista" src="/Farm-vista/assets/icons/logo.png">
          <strong>FarmVista</strong>
        </div>
        <nav class="nav">
          <a href="/Farm-vista/dashboard/index.html">🏠 Dashboard</a>
          <a href="#">🌱 Crop Production</a>
          <a href="#">🚜 Equipment</a>
          <a href="#">🌾 Grain</a>
          <a href="#">💵 Expenses</a>
          <a href="#">📊 Reports</a>
          <a href="#">⚙️ Setup</a>
          <div class="ver">FarmVista <span class="js-ver">1.0.0</span></div>
        </nav>
      </aside>

      <!-- User menu -->
      <div class="menu" role="menu" aria-label="Account & Settings">
        <h4>THEME</h4>
        <div class="seg">
          <button class="chip js-theme" data-mode="system">System</button>
          <button class="chip js-theme" data-mode="light">Light</button>
          <button class="chip js-theme" data-mode="dark">Dark</button>
        </div>
        <h4>PROFILE</h4>
        <div class="row"><div>Account details</div><div class="muted">Coming soon</div></div>
        <div class="row"><div>Feedback</div><div class="muted">Coming soon</div></div>
        <div class="row"><div>Security</div><div class="muted">Coming soon</div></div>

        <h4>MAINTENANCE</h4>
        <div class="row">
          <div>Check for updates</div>
          <button class="cta js-update" title="Clear cache and reload">⟳</button>
        </div>
      </div>

      <!-- Main content -->
      <main class="content">
        <slot></slot>
      </main>

      <!-- Footer -->
      <footer class="footer">
        <div class="container">
          <span>© <span class="js-year"></span> FarmVista • <span class="js-date"></span></span>
        </div>
      </footer>
    `;
  }

  connectedCallback(){
    const r = this.shadowRoot;
    // Buttons
    const openBtn = r.querySelector('.js-open');
    const userBtn = r.querySelector('.js-user');
    const scrim   = r.querySelector('.scrim');
    const drawer  = r.querySelector('.drawer');
    const menu    = r.querySelector('.menu');

    const openDrawer = () => { drawer.classList.add('open'); r.querySelector('.scrim').classList.add('show'); };
    const closeDrawer= () => { drawer.classList.remove('open'); r.querySelector('.scrim').classList.remove('show'); };

    openBtn.addEventListener('click', openDrawer);
    scrim.addEventListener('click', closeDrawer);

    userBtn.addEventListener('click', () => {
      const show = !menu.classList.contains('show');
      menu.classList.toggle('show', show);
      userBtn.setAttribute('aria-expanded', show ? 'true' : 'false');
    });
    document.addEventListener('click', (e)=>{
      if (!this.contains(e.target) && !this.shadowRoot.contains(e.target)) menu.classList.remove('show');
    });

    // Theme chips
    const chips = [...r.querySelectorAll('.js-theme')];
    const paintActive = (mode)=>{
      chips.forEach(c=>c.classList.toggle('active', c.dataset.mode === mode));
    };
    const current = (window.App && App.getTheme ? App.getTheme() : 'system');
    paintActive(current);
    chips.forEach(c => c.addEventListener('click', ()=>{
      const mode = c.dataset.mode;
      if (window.App && App.setTheme) App.setTheme(mode);
      paintActive(mode);
    }));
    document.addEventListener('fv:theme', e => paintActive(e.detail.mode));

    // Updater
    r.querySelector('.js-update').addEventListener('click', async ()=>{
      const btn = r.querySelector('.js-update');
      btn.disabled = true; btn.textContent = '…';
      try{
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map(k=>caches.delete(k)));
        }
      }catch{}
      location.reload(true);
    });

    // Footer date/version
    const y = new Date().getFullYear();
    r.querySelector('.js-year').textContent = y;
    try{
      const d = new Date();
      const opts = { weekday:'long', year:'numeric', month:'long', day:'numeric' };
      r.querySelector('.js-date').textContent = d.toLocaleDateString(undefined, opts);
    }catch{}
    try{
      const v = (window.FV_BUILD || (window.FV_VERSION && window.FV_VERSION.number) || '1.0.0');
      r.querySelector('.js-ver').textContent = v;
    }catch{}
  }
}

customElements.define('fv-shell', FVShell);
</script>