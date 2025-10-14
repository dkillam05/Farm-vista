// ==========================================================
// FarmVista — Shell (header, sidebar, footer, user menu)
// - Uses App.* from core.js for theme + updater
// - User menu: System / Light / Dark + "Check for updates"
// - Single update button clears cache/SW and reloads (with spinner + toast)
// - No hero content here (that stays in fv-hero.js / page)
// ==========================================================
class FVShell extends HTMLElement {
  constructor() {
    super();
    const r = this.attachShadow({ mode: 'open' });
    r.innerHTML = `
      <style>
        :host{ display:block; }
        .container{ width:min(1100px,100%); margin-inline:auto; padding:0 16px; }

        /* Header */
        header.fv-header{ position:sticky; top:0; z-index:1000; }
        .hdr-top{
          background: var(--header-bg, #3B7E46);
          color: var(--header-fg, #fff);
          border-bottom: 1px solid rgba(0,0,0,.15);
        }
        .hdr-top .bar{ height:56px; display:flex; align-items:center; justify-content:space-between; gap:12px; }
        .brand{ font-weight:800; letter-spacing:.3px; font-size:20px; color:inherit; }

        .btn-plain{
          display:inline-flex; align-items:center; justify-content:center;
          width:40px; height:40px; border-radius:9px; cursor:pointer;
          background: rgba(255,255,255,.08);
          border:1px solid rgba(255,255,255,.28);
          color:inherit;
        }

        /* Sidebar drawer (overlay) */
        #navToggle{ display:none; }
        aside.fv-sidebar{
          position:fixed; inset:0 auto 0 0; width:300px; max-width:92vw;
          background:#fff; color:#141514;
          border-right:1px solid #e2e5e5;
          transform:translateX(-100%); transition:transform .18s ease-out;
          z-index:998; display:flex; flex-direction:column; overflow:auto;
          box-shadow:0 10px 22px rgba(0,0,0,.18);
        }
        :host-context(.dark) aside.fv-sidebar{ background:#1b1d1b; color:#e8eee9; border-color:#253228; }
        #navToggle:checked ~ aside.fv-sidebar{ transform:translateX(0); }
        .scrim{ position:fixed; inset:0; background:rgba(0,0,0,.45); opacity:0; pointer-events:none; transition:opacity .18s; z-index:997; }
        #navToggle:checked ~ .scrim{ opacity:1; pointer-events:auto; }

        nav.sd-menu{ padding:10px; }
        .nav-item{
          display:flex; align-items:center; gap:12px;
          padding:12px 10px; border-radius:10px; text-decoration:none; color:inherit;
        }
        .nav-item:hover{ background:rgba(0,0,0,.06); }
        :host-context(.dark) .nav-item:hover{ background:rgba(255,255,255,.06); }

        /* Main + footer */
        main.fv-main{ padding:18px 16px 44px; }
        footer.fv-footer{
          background:var(--footer-bg, #0b1a10);
          color:var(--footer-fg, #cfd7d1);
          border-top:3px solid var(--brand-gold, #D0C542);
          padding:10px 0;
        }

        /* User menu panel (fixed so it never clips) */
        .menu-anchor{ position:relative; }
        .user-panel{
          position:fixed; right:12px; top:56px;
          width:min(520px, 94vw);
          background:#fff; color:#141514;
          border:1px solid #e3e6e2; border-radius:12px; box-shadow:0 12px 24px rgba(0,0,0,.18);
          transform-origin: top right; transform:scale(.98); opacity:0; visibility:hidden;
          transition:transform .16s ease, opacity .16s ease, visibility .16s;
          z-index:1001;
        }
        :host-context(.dark) .user-panel{ background:#151b17; color:#e8eee9; border-color:#253228; box-shadow:0 12px 24px rgba(0,0,0,.5); }
        .user-panel[aria-hidden="false"]{ transform:scale(1); opacity:1; visibility:visible; }
        .up-sec{ padding:14px; border-bottom:1px solid #e3e6e2; }
        :host-context(.dark) .up-sec{ border-color:#253228; }
        .up-title{ font-size:.8rem; letter-spacing:.12em; text-transform:uppercase; opacity:.8; margin:0 0 10px; }

        /* Theme chips */
        .chips{ display:flex; gap:8px; flex-wrap:wrap; }
        .chip{
          border:1px solid #e3e6e2; border-radius:999px; padding:8px 12px; cursor:pointer; background:#fff; color:#141514;
        }
        :host-context(.dark) .chip{ border-color:#253228; background:#151b17; color:#e8eee9; }
        .chip[aria-pressed="true"]{ outline:2px solid var(--brand-gold, #D0C542); }

        /* Rows */
        .row{ display:flex; align-items:center; justify-content:space-between; padding:12px 10px; border-radius:10px; }
        .row:hover{ background:rgba(0,0,0,.04); }
        :host-context(.dark) .row:hover{ background:rgba(255,255,255,.06); }
        .muted{ opacity:.7; }

        /* Spinner + toast */
        .spin{ animation:sp 1s linear infinite; }
        @keyframes sp { from{transform:rotate(0)} to{transform:rotate(360deg)} }
        .toast{
          position:fixed; left:50%; bottom:16px; transform:translateX(-50%);
          background:#141514; color:#fff; padding:10px 14px; border-radius:10px; box-shadow:0 8px 16px rgba(0,0,0,.28);
          opacity:0; pointer-events:none; transition:opacity .18s ease;
          z-index:1100;
        }
        .toast.show{ opacity:1; }
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
              <button class="btn-plain btn-user" aria-haspopup="menu" aria-expanded="false" title="User menu">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="8" r="4"/><path d="M6 20c2-3 10-3 12 0"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
      </header>

      <!-- Sidebar -->
      <aside class="fv-sidebar" aria-label="Primary">
        <nav class="sd-menu">
          <a class="nav-item" href="/Farm-vista/dashboard/">🏠 Home</a>
          <a class="nav-item" href="#">🌱 Crop Production</a>
          <a class="nav-item" href="#">🚜 Equipment</a>
          <a class="nav-item" href="#">🌾 Grain</a>
          <a class="nav-item" href="#">💵 Expenses</a>
          <a class="nav-item" href="#">📊 Reports</a>
          <a class="nav-item" href="#">⚙️ Setup</a>
        </nav>
      </aside>
      <label class="scrim" for="navToggle" aria-hidden="true"></label>

      <main class="fv-main"><slot></slot></main>

      <footer class="fv-footer">
        <div class="container">
          <small>© <span class="y"></span> FarmVista • <span class="d"></span></small>
        </div>
      </footer>

      <!-- User Panel -->
      <div class="user-panel" aria-hidden="true" role="menu" aria-label="User menu">
        <div class="up-sec">
          <p class="up-title">Theme</p>
          <div class="chips">
            <button class="chip th" data-mode="system" aria-pressed="false">System</button>
            <button class="chip th" data-mode="light"  aria-pressed="false">Light</button>
            <button class="chip th" data-mode="dark"   aria-pressed="false">Dark</button>
          </div>
        </div>

        <div class="up-sec">
          <p class="up-title">Profile</p>
          <div class="row">Account details <span class="muted">Coming soon</span></div>
          <div class="row">Feedback <span class="muted">Coming soon</span></div>
          <div class="row">Security <span class="muted">Coming soon</span></div>
        </div>

        <div class="up-sec">
          <p class="up-title">Maintenance</p>
          <button class="row btn-update" title="Check for updates">
            <span>Check for updates</span>
            <span class="ico" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>
              </svg>
            </span>
          </button>
        </div>
      </div>

      <div class="toast" aria-live="polite"></div>
    `;

    // Footer year/date
    const now = new Date();
    const y = r.querySelector('.y'); if (y) y.textContent = now.getFullYear();
    const d = r.querySelector('.d'); if (d) d.textContent = now.toLocaleDateString(undefined, { weekday:'long', year:'numeric', month:'long', day:'numeric' });

    // Menu open/close
    const btnUser = r.querySelector('.btn-user');
    const panel   = r.querySelector('.user-panel');
    const openMenu = (open) => {
      panel.setAttribute('aria-hidden', String(!open));
      btnUser.setAttribute('aria-expanded', String(open));
      if (open) document.addEventListener('click', onDoc, true);
      else document.removeEventListener('click', onDoc, true);
    };
    const onDoc = (e) => {
      const path = e.composedPath();
      const inside = path.includes(panel) || path.includes(btnUser) || path.includes(this);
      if (!inside) openMenu(false);
    };
    btnUser?.addEventListener('click', () => {
      const want = panel.getAttribute('aria-hidden') !== 'false';
      openMenu(want);
      if (want) this._reflectThemeChips();
    });

    // Theme chips
    this.shadowRoot.querySelectorAll('.chip.th').forEach(chip => {
      chip.addEventListener('click', () => {
        const mode = chip.getAttribute('data-mode');
        try { window.App?.setTheme(mode); } catch {}
        this._reflectThemeChips();
      });
    });
    // Also respond to outside theme changes
    document.addEventListener('fv:theme', () => this._reflectThemeChips());
    this._reflectThemeChips();

    // Update button (single action: clear caches + SW, then reload)
    const btnUpd = r.querySelector('.btn-update');
    const ico = r.querySelector('.btn-update .ico');
    btnUpd?.addEventListener('click', async () => {
      // spinner
      ico.classList.add('spin');
      this._toast('Refreshing app…');
      try {
        await window.App?.checkForUpdates();
        // page will reload; spinner just in case
        setTimeout(()=>ico.classList.remove('spin'), 1500);
      } catch {
        ico.classList.remove('spin');
        this._toast('Could not refresh (offline?)');
      }
    });
  }

  _reflectThemeChips() {
    const mode = (window.App?.getTheme && window.App.getTheme()) || 'system';
    this.shadowRoot.querySelectorAll('.chip.th').forEach(c =>
      c.setAttribute('aria-pressed', String(c.getAttribute('data-mode') === mode))
    );
  }

  _toast(msg) {
    const t = this.shadowRoot.querySelector('.toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this._to);
    this._to = setTimeout(()=>t.classList.remove('show'), 1800);
  }
}

customElements.define('fv-shell', FVShell);