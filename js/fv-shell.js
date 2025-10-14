// ==========================================================
// FarmVista Shell (header + sidebar + footer)
// - Uses theme tokens from /assets/css/theme.css
// - Right-side "people" menu with Theme controls
// - "Check for updates" clears SW caches, compares version,
//    shows spinner + toast, then reloads if needed
// - No hero logic here; <slot> renders page content
// ==========================================================
class FVShell extends HTMLElement {
  constructor(){
    super();
    const r = this.attachShadow({mode:'open'});
    r.innerHTML = `
      <style>
        :host{ display:block; }
        .container{ width:min(1100px,100%); margin-inline:auto; padding:0 16px; }

        /* HEADER */
        header.hdr{ position:sticky; top:0; z-index:6; background:var(--header-bg); color:var(--header-fg); }
        .top{ height:56px; display:flex; align-items:center; justify-content:space-between; padding:0 12px; border-bottom:1px solid rgba(0,0,0,.15); }
        .brand{ font-weight:800; letter-spacing:.3px; font-size:20px; color:inherit; }
        .btn{
          display:inline-grid; place-items:center; width:40px; height:40px; border-radius:9px;
          background:transparent; border:1px solid color-mix(in srgb,#fff 25%, transparent); color:inherit; cursor:pointer;
        }
        .btn:focus-visible{ outline:3px solid #b9e1c4; outline-offset:1px; }
        .sub{ background:var(--header-bg); }
        .accent{ height:3px; background:var(--brand-gold); }

        /* SIDEBAR (overlay drawer) */
        #navToggle{ display:none; }
        aside.sd{
          position:fixed; inset:0 auto 0 0; width:300px; background:var(--surface); color:var(--text);
          border-right:1px solid var(--border); transform:translateX(-100%); transition:transform .18s ease-out;
          z-index:999; display:flex; flex-direction:column; box-shadow:0 10px 22px rgba(0,0,0,.20);
          overflow-y:auto; -webkit-overflow-scrolling:touch; touch-action:pan-y;
        }
        #navToggle:checked ~ aside.sd{ transform:translateX(0); }
        .scrim{ position:fixed; inset:0; background:rgba(0,0,0,.45); opacity:0; pointer-events:none; transition:opacity .18s; z-index:998; }
        #navToggle:checked ~ .scrim{ opacity:1; pointer-events:auto; }

        .sd-head{ padding:16px; border-bottom:1px solid var(--border); }
        .sd-head img{ height:44px; width:auto; display:block; }
        .sd-menu{ padding:8px; }
        .item{
          display:flex; align-items:center; gap:12px; padding:12px 10px; border-radius:10px;
          color:var(--text); text-decoration:none;
        }
        .item:hover{ background:color-mix(in srgb, var(--brand-gold) 8%, var(--surface)); }
        .sd-foot{ margin-top:auto; padding:14px 16px; border-top:1px solid var(--border); font-size:13px; color:var(--muted); }

        /* MAIN + FOOTER */
        main.main{ padding:18px 16px 44px; background:var(--bg); color:var(--text); min-height:40vh; }
        footer.foot{
          background:var(--footer-bg); color:var(--footer-fg); border-top:3px solid var(--brand-gold);
          padding:10px max(16px, env(safe-area-inset-right)) calc(10px + env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
          text-align:center;
        }

        /* USER MENU (right) */
        .anchor{ position:relative; }
        .menu{ position:absolute; right:0; top:48px; min-width:290px; background:var(--surface); color:var(--text);
               border:1px solid var(--border); border-radius:12px; box-shadow:0 12px 24px rgba(0,0,0,.18); padding:10px; display:none; }
        .menu.open{ display:block; }
        .section{ margin:6px 6px 8px; font-size:.82rem; letter-spacing:.12em; text-transform:uppercase; color:var(--muted); }
        .pillrow{ display:flex; gap:8px; padding:0 6px 8px; }
        .pill{
          border:1px solid var(--border); background:var(--surface); color:var(--text);
          border-radius:999px; padding:8px 12px; cursor:pointer; user-select:none;
        }
        .pill[aria-pressed="true"]{ outline:2px solid var(--brand-gold); }
        .menu-item{ display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px; border-radius:10px; cursor:pointer; }
        .menu-item:hover{ background:color-mix(in srgb, var(--brand-gold) 8%, var(--surface)); }
        .spin{ width:16px; height:16px; border:2px solid color-mix(in srgb, var(--text) 30%, transparent); border-top-color:var(--brand-gold); border-radius:50%; animation:sp 1s linear infinite; }
        @keyframes sp{ to{ transform:rotate(360deg); } }

        /* TOAST */
        .toast{ position:fixed; left:50%; bottom:20px; transform:translateX(-50%); background:var(--surface); color:var(--text);
                border:1px solid var(--border); border-radius:999px; padding:10px 14px; box-shadow:0 12px 24px rgba(0,0,0,.18); display:none; z-index:1000; }
        .toast.show{ display:block; }
      </style>

      <input id="navToggle" type="checkbox" />

      <header class="hdr">
        <div class="top container">
          <label for="navToggle" class="btn" aria-label="Open menu">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
          </label>
          <div class="brand">FarmVista</div>
          <div class="anchor">
            <button class="btn" id="btnPeople" aria-haspopup="menu" aria-expanded="false" title="User menu">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="9" cy="7" r="3"/><circle cx="17" cy="7" r="3"/><path d="M2 21c0-3.3 2.7-6 6-6h2"/><path d="M14 15h2c3.3 0 6 2.7 6 6"/>
              </svg>
            </button>
            <div class="menu" role="menu" aria-label="User menu">
              <div class="section">Theme</div>
              <div class="pillrow">
                <button class="pill" data-theme="system" aria-pressed="false">System</button>
                <button class="pill" data-theme="light"  aria-pressed="false">Light</button>
                <button class="pill" data-theme="dark"   aria-pressed="false">Dark</button>
              </div>

              <div class="section">Profile</div>
              <div class="menu-item">Account details <span style="color:var(--muted)">Coming soon</span></div>
              <div class="menu-item">Feedback <span style="color:var(--muted)">Coming soon</span></div>
              <div class="menu-item">Security <span style="color:var(--muted)">Coming soon</span></div>

              <div class="section">Maintenance</div>
              <div class="menu-item" id="btnUpdate">Check for updates <span id="updIcon" aria-hidden="true">⟳</span></div>
            </div>
          </div>
        </div>
        <div class="sub">
          <div class="accent"></div>
        </div>
      </header>

      <aside class="sd" aria-label="Primary">
        <div class="sd-head"><img class="logo-img" alt="FarmVista logo" /></div>
        <nav class="sd-menu">
          <a class="item" data-route="dashboard" href="#">🏠 <span>Home</span></a>
          <a class="item" href="#">🌱 <span>Crop Production</span></a>
          <a class="item" href="#">🚜 <span>Equipment</span></a>
          <a class="item" href="#">🌾 <span>Grain</span></a>
          <a class="item" href="#">💵 <span>Expenses</span></a>
          <a class="item" href="#">📊 <span>Reports</span></a>
          <a class="item" href="#">⚙️ <span>Setup</span></a>
        </nav>
        <div class="sd-foot">FarmVista <span class="ver">1.0.0</span></div>
      </aside>
      <label class="scrim" for="navToggle" aria-hidden="true"></label>

      <main class="main">
        <slot></slot>
      </main>

      <footer class="foot">
        <small>© <span id="y"></span> FarmVista • <span id="d"></span></small>
      </footer>

      <div class="toast" id="toast" role="status" aria-live="polite"></div>
    `;

    // Static wiring
    const y = r.getElementById('y'); if (y) y.textContent = new Date().getFullYear();
    const d = r.getElementById('d'); if (d) d.textContent = new Date().toLocaleDateString(undefined, { weekday:'long', year:'numeric', month:'long', day:'numeric' });

    // repo-safe prefix (works on GH Pages and locally)
    const parts = location.pathname.split('/').filter(Boolean);
    const up = Math.max(0, parts.length - 1);
    const prefix = '../'.repeat(up);

    // logo + active dashboard link
    const logo = r.querySelector('.logo-img'); if (logo) logo.src = `${prefix}assets/icons/logo.png`;
    const dash = r.querySelector('[data-route="dashboard"]');
    if (dash) { dash.setAttribute('href', `${prefix}dashboard/`); if (location.pathname.includes('/dashboard/')) dash.classList.add('active'); }

    // Version (if attribute present)
    const verAttr = this.getAttribute('version');
    if (verAttr) r.querySelector('.ver').textContent = verAttr;

    // ===== Right menu open/close =====
    const peopleBtn = r.getElementById('btnPeople');
    const menu = r.querySelector('.menu');
    const closeMenu = () => { menu.classList.remove('open'); peopleBtn.setAttribute('aria-expanded','false'); };
    const openMenu  = () => { menu.classList.add('open'); peopleBtn.setAttribute('aria-expanded','true'); };
    peopleBtn.addEventListener('click', (e)=>{ e.stopPropagation(); menu.classList.toggle('open'); peopleBtn.setAttribute('aria-expanded', String(menu.classList.contains('open'))); });
    document.addEventListener('click', (e)=>{ if (!this.shadowRoot.contains(e.target)) closeMenu(); }, true);

    // ===== Theme pills =====
    const reflectPills = () => {
      const mode = (localStorage.getItem('fv-theme') || 'system');
      r.querySelectorAll('.pill').forEach(p => p.setAttribute('aria-pressed', String(p.dataset.theme === mode)));
    };
    r.querySelectorAll('.pill').forEach(p=>{
      p.addEventListener('click', ()=>{
        window.App?.setTheme(p.dataset.theme || 'system');
        reflectPills();
      });
    });
    reflectPills();
    document.addEventListener('fv:theme', reflectPills);

    // ===== Check for updates (also clears cache) =====
    const updBtn = r.getElementById('btnUpdate');
    const updIcon = r.getElementById('updIcon');
    const toast = r.getElementById('toast');

    const showToast = (msg) => {
      toast.textContent = msg;
      toast.classList.add('show');
      setTimeout(()=> toast.classList.remove('show'), 2500);
    };

    async function clearCachesAndSW(){
      try {
        // delete caches
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      } catch {}
      try {
        // unregister service workers
        const regs = await navigator.serviceWorker?.getRegistrations?.();
        if (regs?.length) await Promise.all(regs.map(r => r.unregister()));
      } catch {}
    }

    async function checkForUpdates(){
      // spinner
      updIcon.replaceWith(Object.assign(r.createElement('span'), { id:'updIcon', className:'spin', ariaHidden:'true' }));
      try {
        const current = (window.FV_VERSION && window.FV_VERSION.number) || '';
        // try to fetch version file fresh
        let latest = current;
        try {
          const res = await fetch(`${prefix}js/version.js?ts=${Date.now()}`, { cache:'no-store' });
          const txt = await res.text();
          const m = txt.match(/number\s*:\s*["'`]([^"'`]+)["'`]/);
          if (m) latest = m[1];
        } catch {}
        // always clear caches so user gets files fresh
        await clearCachesAndSW();

        if (latest && latest !== current) {
          showToast(`Updating to ${latest}…`);
          location.reload();
        } else {
          showToast('You are up to date');
          // soft reload to pick up any changed assets after cache clear
          setTimeout(()=> location.reload(), 400);
        }
      } finally {
        // restore icon (in case we didn't reload yet)
        const spin = r.getElementById('updIcon');
        if (spin) {
          const span = r.createElement('span');
          span.id = 'updIcon';
          span.textContent = '⟳';
          spin.replaceWith(span);
        }
      }
    }
    updBtn.addEventListener('click', checkForUpdates);
  }

  connectedCallback(){
    // nothing else; all wired in constructor for GH Pages safety
  }
}
customElements.define('fv-shell', FVShell);