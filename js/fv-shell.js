// FarmVista Shell (global) — header, sidebar, footer, user menu
// No page-specific content here (no hero tiles).

class FVShell extends HTMLElement {
  constructor() {
    super();
    const r = this.attachShadow({ mode: 'open' });
    r.innerHTML = `
      <style>
        :host{ display:block;
          --fv-green:#3B7E46; --fv-yellow:#D0C542; --fv-gunmetal:#CBCDCB; --fv-black:#141514; --fv-border:#e2e5e5; --sidebar-w:300px;
        }
        .container{ width:min(1100px,100%); margin-inline:auto; padding:0 16px; }

        /* Header */
        header.fv-header{ position:sticky; top:0; z-index:6; }
        .hdr-top{ background:var(--fv-green); color:#fff; border-bottom:1px solid color-mix(in srgb,#000 12%,var(--fv-green)); }
        .hdr-top .bar{ height:56px; display:flex; align-items:center; justify-content:space-between; gap:12px; }
        .brand{ font-weight:800; letter-spacing:.3px; font-size:20px; color:#fff; }
        .hdr-sub{ background:var(--fv-gunmetal); color:var(--fv-black); }
        .hdr-sub .bar{ min-height:40px; display:flex; align-items:center; }
        .hdr-sub .accent{ height:3px; background:var(--fv-yellow); }

        .btn-plain{ display:inline-flex; align-items:center; justify-content:center; width:40px; height:40px; border-radius:9px;
          cursor:pointer; font-size:22px; background:color-mix(in srgb,#fff 6%,transparent);
          border:1px solid color-mix(in srgb,#fff 25%,transparent); color:#fff; }
        .btn-plain:focus{ outline:3px solid #b9e1c4; outline-offset:1px; }

        /* Sidebar */
        aside.fv-sidebar{ position:fixed; inset:0 auto 0 0; width:var(--sidebar-w); background:#fff; color:var(--fv-black);
          border-right:1px solid var(--fv-border); transform:translateX(-100%); transition:transform .18s ease-out;
          z-index:999; display:flex; flex-direction:column; overflow-y:auto; box-shadow:0 10px 22px rgba(0,0,0,.18); }
        nav.sd-menu{ padding:8px; }
        .nav-item{ display:flex; align-items:center; gap:12px; padding:12px 10px; border-radius:10px; text-decoration:none; color:#232523; }
        .nav-item.active{ background:var(--fv-green); color:#fff; }

        /* Scrim + toggle */
        .scrim{ position:fixed; inset:0; background:rgba(0,0,0,.45); opacity:0; pointer-events:none; transition:opacity .18s; z-index:998; }
        #navToggle{ display:none; }
        #navToggle:checked ~ aside.fv-sidebar{ transform:translateX(0); }
        #navToggle:checked ~ .scrim{ opacity:1; pointer-events:auto; }

        /* Main & Footer */
        main.fv-main{ padding:18px 16px 44px; }
        footer.fv-footer{ background:var(--fv-gunmetal); color:#2b2e2b; border-top:3px solid var(--fv-yellow); padding:12px 0; }

        /* Breadcrumb slot */
        ::slotted(.breadcrumbs){ display:flex; gap:6px; font-size:13px; }

        /* User menu */
        .menu-anchor{ position:relative; }
        .user-menu{ display:none; position:absolute; right:0; top:48px; min-width:260px; background:#fff; color:#1b1d1b;
          border:1px solid var(--fv-border); border-radius:12px; box-shadow:0 10px 22px rgba(0,0,0,.12); padding:10px; z-index:1000; }
        .group-title{ font-size:12px; letter-spacing:.12em; opacity:.8; margin:4px 6px 8px; }
        .chip-row{ display:flex; gap:8px; }
        .chip{ border:1px solid var(--fv-border); padding:8px 12px; border-radius:999px; background:#f6f6f6; cursor:pointer; }
        .chip[aria-pressed="true"]{ outline:2px solid #fff; box-shadow:0 0 0 3px rgba(255,255,255,.6) inset, 0 0 0 2px #fff; background:#3B7E46; color:#fff; }
        .menu-item{ display:flex; align-items:center; justify-content:space-between; padding:10px 8px; border-radius:10px; text-decoration:none; color:inherit; }
        .menu-item:hover{ background:#f3f5f3; }
        .muted{ opacity:.7; }
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
              <button class="btn-plain people" aria-haspopup="menu" aria-expanded="false" title="User menu">
                <!-- people icon -->
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M16 11c1.66 0 3-1.57 3-3.5S17.66 4 16 4s-3 1.57-3 3.5 1.34 3.5 3 3.5zM8 11c1.66 0 3-1.57 3-3.5S9.66 4 8 4 5 5.57 5 7.5 6.34 11 8 11z"/>
                  <path d="M2 20v-1c0-2.21 3.58-4 6-4s6 1.79 6 4v1"/><path d="M14 20v-1c0-1.48.8-2.78 2-3.58"/>
                </svg>
              </button>
              <div class="user-menu" role="menu" aria-label="User menu">
                <div class="group-title">THEME</div>
                <div class="chip-row">
                  <button class="chip" data-theme="system" aria-pressed="false">System</button>
                  <button class="chip" data-theme="light"  aria-pressed="false">Light</button>
                  <button class="chip" data-theme="dark"   aria-pressed="false">Dark</button>
                </div>

                <div class="group-title" style="margin-top:12px;">PROFILE</div>
                <a href="#" class="menu-item">Account details <span class="muted">Coming soon</span></a>
                <a href="#" class="menu-item">Feedback <span class="muted">Coming soon</span></a>
                <a href="#" class="menu-item">Security <span class="muted">Coming soon</span></a>

                <div class="group-title" style="margin-top:12px;">MAINTENANCE</div>
                <a href="#" class="menu-item" id="btn-check-update">
                  Check for updates <span id="updSpin" aria-hidden="true" style="margin-left:8px; display:none;">⏳</span>
                </a>
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
        <nav class="sd-menu">
          <a class="nav-item" data-route="dashboard" href="#">🏠 Home</a>
          <a class="nav-item" href="#">🌱 Crop Production</a>
          <a class="nav-item" href="#">🚜 Equipment</a>
          <a class="nav-item" href="#">🌾 Grain</a>
          <a class="nav-item" href="#">📊 Reports</a>
          <a class="nav-item" href="#">⚙️ Setup</a>
        </nav>
        <div class="sd-foot" style="margin-top:auto; padding:12px 16px; border-top:1px solid var(--fv-border);">
          <small><strong>FarmVista</strong> <span class="ver">1.0.0</span></small>
        </div>
      </aside>

      <label class="scrim" for="navToggle" aria-hidden="true"></label>

      <main class="fv-main"><slot></slot></main>

      <footer class="fv-footer">
        <div class="container">
          <small>© <span id="y"></span> FarmVista • <span id="d"></span></small>
        </div>
      </footer>
    `;

    // Footer date/year
    const y = r.getElementById('y'); if (y) y.textContent = new Date().getFullYear();
    const d = r.getElementById('d'); if (d) {
      const fmt = new Intl.DateTimeFormat(undefined, { weekday:'long', year:'numeric', month:'long', day:'numeric' });
      d.textContent = fmt.format(new Date());
    }

    // Repo-safe dashboard link + active state
    const dash = r.querySelector('[data-route="dashboard"]');
    if (dash) {
      dash.setAttribute('href', '/Farm-vista/dashboard/');
      if (location.pathname.includes('/dashboard/')) dash.classList.add('active');
    }

    // User menu open/close
    const people = r.querySelector('.people');
    const menu = r.querySelector('.user-menu');
    const onDocClick = (e) => {
      const path = e.composedPath();
      if (!path.includes(menu) && !path.includes(people)) {
        menu.style.display = 'none';
        people.setAttribute('aria-expanded','false');
        document.removeEventListener('click', onDocClick, true);
      }
    };
    people?.addEventListener('click', () => {
      const open = menu.style.display !== 'block';
      menu.style.display = open ? 'block' : 'none';
      people.setAttribute('aria-expanded', String(open));
      if (open) document.addEventListener('click', onDocClick, true);
    });

    // ===== Theme (matches theme.css html[data-theme="..."]) =====
    const THEME_KEY = 'fv-theme';        // 'system' | 'light' | 'dark'
    const root = document.documentElement;

    const reflectChips = (mode) => {
      r.querySelectorAll('.chip').forEach(ch => ch.setAttribute('aria-pressed', String(ch.dataset.theme===mode)));
    };

    const applyTheme = (mode='system') => {
      root.setAttribute('data-theme', mode === 'system' ? 'auto' : mode);
      try { localStorage.setItem(THEME_KEY, mode); } catch {}
      reflectChips(mode);
      // Legacy support: also toggle .dark for components that rely on it
      root.classList.toggle('dark', mode === 'dark' || (mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches));
    };

    r.querySelectorAll('.chip').forEach(btn => btn.addEventListener('click', () => applyTheme(btn.dataset.theme)));

    let saved = 'system';
    try { saved = localStorage.getItem(THEME_KEY) || 'system'; } catch {}
    applyTheme(saved);
    matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
      if ((localStorage.getItem(THEME_KEY)||'system') === 'system') applyTheme('system');
    });

    // ===== Check for updates (clears Cache Storage then reloads) =====
    const btnUpd = r.getElementById('btn-check-update');
    const spin = r.getElementById('updSpin');
    const toast = (msg) => {
      const t = document.createElement('div');
      t.textContent = msg;
      Object.assign(t.style, { position:'fixed', left:'50%', bottom:'18px', transform:'translateX(-50%)', background:'#141514', color:'#fff',
        padding:'10px 14px', borderRadius:'10px', zIndex:9999, fontSize:'14px' });
      document.body.appendChild(t); setTimeout(()=>t.remove(), 2200);
    };
    btnUpd?.addEventListener('click', async (e) => {
      e.preventDefault();
      spin.style.display = 'inline';
      try {
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map(k=>caches.delete(k)));
        }
        toast('Checking for updates…');
        setTimeout(()=>location.reload(true), 400);
      } catch {
        toast('Update check failed.');
      } finally {
        spin.style.display = 'none';
      }
    });

    // Version in sidebar from attribute (defaults to 1.0.0)
    const ver = this.getAttribute('version') || '1.0.0';
    const vEl = r.querySelector('.ver'); if (vEl) vEl.textContent = ver;
  }
}
customElements.define('fv-shell', FVShell);