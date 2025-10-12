// js/fv-shell.js
// FarmVista Shell: bold brand header, gunmetal subbar with breadcrumbs,
// scrollable black sidebar, footer accent, user menu + theme switch.

class FVShell extends HTMLElement {
  constructor() {
    super();
    const r = this.attachShadow({ mode: 'open' });
    r.innerHTML = `
      <style>
        :host { display: block; }

        /* Inherit brand tokens from theme.css (with safe fallbacks) */
        :host {
          --fv-green:      var(--fv-green, #3B7E46);
          --fv-yellow:     var(--fv-yellow, #D0C542);
          --fv-gunmetal:   var(--fv-gunmetal, #CBCDCB);
          --fv-black:      var(--fv-black, #141514);
          --fv-border:     var(--fv-border, #e2e5e5);
          --fv-surface:    var(--fv-surface, #f5f6f6);
          --fv-ring:       var(--fv-ring, #b9e1c4);
          --sidebar-w:     var(--sidebar-w, 280px); /* host can override via app.css */
        }

        .container { width: min(1100px, 100%); margin-inline: auto; padding: 0 16px; }

        /* ================= HEADER ================= */
        header.fv-header { position: sticky; top: 0; z-index: 6; }

        /* Top bar: solid FarmVista green */
        .hdr-top {
          background: var(--fv-green);
          color: #fff;
          border-bottom: 1px solid color-mix(in srgb, #000 12%, var(--fv-green));
        }
        .hdr-top .bar {
          height: 56px;
          display: flex; align-items: center; justify-content: space-between; gap: 12px;
        }
        .brand { font-weight: 800; letter-spacing: .3px; font-size: 20px; color: #fff; }

        /* Sub bar: gunmetal with breadcrumbs */
        .hdr-sub {
          background: var(--fv-gunmetal);
          color: var(--fv-black);
        }
        .hdr-sub .bar {
          min-height: 40px; display: flex; align-items: center;
        }
        .hdr-sub .accent { height: 3px; background: var(--fv-yellow); }

        /* buttons on dark/green */
        .btn-plain {
          display: inline-flex; align-items: center; justify-content: center;
          width: 40px; height: 40px; border-radius: 9px;
          cursor: pointer; font-size: 22px; line-height: 1;
          transition: transform .02s ease;
        }
        .btn-plain:active { transform: translateY(1px); }
        .btn-plain:focus { outline: 3px solid var(--fv-ring); outline-offset: 1px; }

        /* burger on green background */
        .burger {
          color: #fff;
          background: color-mix(in srgb, #fff 6%, transparent);
          border: 1px solid color-mix(in srgb, #fff 25%, transparent);
        }
        .gear {
          color: #fff;
          background: color-mix(in srgb, #fff 6%, transparent);
          border: 1px solid color-mix(in srgb, #fff 25%, transparent);
        }

        /* ================= SIDEBAR ================= */
        aside.fv-sidebar {
          position: fixed; left: 0; top: 0;
          width: var(--sidebar-w);
          height: 100dvh;
          background: var(--fv-black); color: #fff;
          transform: translateX(-100%);
          transition: transform .18s ease-out;
          z-index: 999;
          display: flex; flex-direction: column;
          padding: 12px 12px 18px;
          overflow-y: auto;
          overscroll-behavior: contain;
          -webkit-overflow-scrolling: touch;
          touch-action: pan-y;
          box-shadow: 0 10px 22px rgba(0,0,0,.25);
        }
        aside .menu h6 {
          margin: 6px 8px 8px; font-size: 12px; text-transform: uppercase; letter-spacing: .12em;
          color: var(--fv-yellow);
        }
        aside .menu a, aside .menu summary {
          display: block; color: #f0f3f0; text-decoration: none;
          padding: 10px 10px; border-radius: 8px; font-size: 14px; cursor: pointer;
        }
        aside .menu a:hover, aside .menu summary:hover { background: rgba(255,255,255,.08); }
        aside .menu details { margin: 4px 0; }
        aside .menu details > summary { list-style: none; }
        aside .menu details > summary::-webkit-details-marker { display: none; }
        aside .menu details[open] > summary { background: rgba(255,255,255,.06); }
        aside .menu a.active {
          position: relative; background: rgba(255,255,255,.10);
        }
        aside .menu a.active::before {
          content: ""; position: absolute; left: 0; top: 6px; bottom: 6px; width: 3px;
          background: var(--fv-yellow); border-radius: 3px;
        }

        /* Scrim */
        .scrim {
          position: fixed; inset: 0; background: rgba(0,0,0,.45);
          opacity: 0; pointer-events: none; transition: opacity .18s ease-out; z-index: 998;
        }

        /* ================= MAIN ================= */
        main.fv-main { padding: 18px 16px 44px; }

        /* ================= FOOTER ================= */
        footer.fv-footer {
          background: var(--fv-gunmetal);
          color: #2b2e2b;
          border-top: 3px solid var(--fv-yellow);
          padding: 12px 0;
        }

        /* Toggle mechanics */
        #navToggle { display: none; }
        #navToggle:checked ~ aside.fv-sidebar { transform: translateX(0); }
        #navToggle:checked ~ .scrim { opacity: 1; pointer-events: auto; }

        /* User menu (gear) */
        .menu-anchor { position: relative; }
        .user-menu {
          position: absolute; right: 0; top: 48px; min-width: 220px;
          background: #fff; color: var(--fv-black);
          border: 1px solid var(--fv-border); border-radius: 10px;
          box-shadow: 0 10px 22px rgba(0,0,0,.10); padding: 6px; display: none; z-index: 1000;
        }
        .user-menu.open { display: block; }
        .user-menu h6 { margin: 6px 8px; font-size: 12px; text-transform: uppercase; letter-spacing: .12em; color: #6a6d6a; }
        .user-menu button, .user-menu a {
          display: flex; align-items: center; justify-content: space-between; width: 100%;
          padding: 10px 10px; background: none; border: 0; text-align: left; cursor: pointer;
          border-radius: 8px; font: inherit; color: inherit;
        }
        .user-menu button:hover, .user-menu a:hover { background: #f4f6f4; }
        .divider { height: 1px; background: var(--fv-border); margin: 6px; border-radius: 999px; }
        .check { font-size: 16px; opacity: .9; }
        .logout { color: #9b1d1d; }

        /* Desktop pinned sidebar */
        @media (min-width: 1000px) {
          .burger { display: none; }
          aside.fv-sidebar { transform: none; }
          .scrim { display: none; }
          main.fv-main, footer.fv-footer { margin-left: var(--sidebar-w); }
        }

        /* Breadcrumbs inside header (colors tuned for gunmetal bar) */
        ::slotted(.breadcrumbs) {
          display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 13px;
        }
        ::slotted(.breadcrumbs a) {
          color: #0e4d26; /* darker green for contrast on gunmetal */
          padding: 4px 6px; border-radius: 6px; text-decoration: none;
        }
        ::slotted(.breadcrumbs a:hover) {
          background: color-mix(in srgb, var(--fv-green) 18%, white);
          color: #0e4d26;
        }
        ::slotted(.breadcrumbs .sep) { opacity: .65; }
      </style>

      <input id="navToggle" type="checkbox" hidden />

      <header class="fv-header">
        <div class="hdr-top">
          <div class="container bar">
            <label for="navToggle" class="btn-plain burger" aria-label="Open menu">☰</label>
            <div class="brand">FarmVista</div>

            <div class="menu-anchor">
              <button class="btn-plain gear" aria-haspopup="menu" aria-expanded="false" title="User menu">⚙️</button>
              <div class="user-menu" role="menu" aria-label="User menu">
                <h6>Theme</h6>
                <button data-theme="light" role="menuitem">Light <span class="check" aria-hidden="true">○</span></button>
                <button data-theme="dark" role="menuitem">Dark <span class="check" aria-hidden="true">○</span></button>
                <button data-theme="system" role="menuitem">System <span class="check" aria-hidden="true">○</span></button>
                <div class="divider"></div>
                <a class="logout" href="#" role="menuitem">Logout</a>
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
        <nav class="menu">
          <h6>Navigation</h6>

          <a href="/dashboard/" class="active">Dashboard</a>

          <details open>
            <summary>Grain Tracking</summary>
            <a href="#">Grain Bins</a>
            <a href="#">Grain Bags</a>
            <a href="#">Contracts</a>
            <a href="#">Ticket OCR</a>
          </details>

          <details>
            <summary>Crop Production</summary>
            <a href="#">Planting</a>
            <a href="#">Harvest</a>
            <a href="#">Spraying</a>
            <a href="#">Trials</a>
          </details>

          <details>
            <summary>Equipment</summary>
            <a href="#">Combines</a>
            <a href="#">Tractors</a>
            <a href="#">Sprayers</a>
            <a href="#">Implements</a>
          </details>

          <details>
            <summary>Reports</summary>
            <a href="#">AI Reports</a>
            <a href="#">Report History</a>
            <a href="#">Predefined Reports</a>
          </details>
        </nav>
      </aside>

      <label class="scrim" for="navToggle" aria-hidden="true"></label>

      <main class="fv-main"><slot></slot></main>

      <footer class="fv-footer">
        <div class="container">
          <small>© <span id="y"></span> FarmVista • All rights reserved.</small>
        </div>
      </footer>
    `;

    // --- state ---
    this._menu = null;
    this._gear = null;
    this._mq = null;
    this._onDocClick = this._handleDocClick.bind(this);
  }

  connectedCallback() {
    const y = this.shadowRoot.getElementById('y');
    if (y) y.textContent = new Date().getFullYear();

    this._menu = this.shadowRoot.querySelector('.user-menu');
    this._gear = this.shadowRoot.querySelector('.gear');

    this._gear?.addEventListener('click', () => {
      const open = this._menu?.classList.toggle('open');
      if (this._gear) this._gear.setAttribute('aria-expanded', String(!!open));
      if (open) document.addEventListener('click', this._onDocClick, true);
    });

    // Theme
    const btns = this.shadowRoot.querySelectorAll('.user-menu [data-theme]');
    btns.forEach(b => b.addEventListener('click', () => {
      const mode = b.getAttribute('data-theme') || 'system';
      this._applyTheme(mode);
      this._reflectThemeChecks();
    }));

    this._mq = window.matchMedia('(prefers-color-scheme: dark)');
    this._mq.addEventListener?.('change', () => {
      const saved = localStorage.getItem('fv-theme') || 'system';
      if (saved === 'system') this._applyTheme('system');
    });

    const saved = localStorage.getItem('fv-theme') || 'system';
    this._applyTheme(saved);
    this._reflectThemeChecks();

    // Logout placeholder
    const logout = this.shadowRoot.querySelector('.logout');
    logout?.addEventListener('click', (e) => {
      e.preventDefault();
      this.dispatchEvent(new CustomEvent('logout', { bubbles: true, composed: true }));
      this._closeMenu();
    });
  }

  disconnectedCallback() {
    document.removeEventListener('click', this._onDocClick, true);
    this._mq?.removeEventListener?.('change', this._applyTheme);
  }

  _handleDocClick(e) {
    const path = e.composedPath();
    const inside = path.some(el => el === this.shadowRoot || (el && el.host === this));
    if (!inside) this._closeMenu();
  }
  _closeMenu() {
    this._menu?.classList.remove('open');
    this._gear?.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', this._onDocClick, true);
  }

  _applyTheme(mode) {
    localStorage.setItem('fv-theme', mode);
    const root = document.documentElement;
    root.classList.remove('dark');
    if (mode === 'dark') root.classList.add('dark');
    else if (mode === 'system') {
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        root.classList.add('dark');
      }
    }
  }
  _reflectThemeChecks() {
    const mode = localStorage.getItem('fv-theme') || 'system';
    const btns = this.shadowRoot.querySelectorAll('.user-menu [data-theme] .check');
    btns.forEach(c => c.textContent = '○');
    const current = this.shadowRoot.querySelector(\`.user-menu [data-theme="\${mode}"] .check\`);
    if (current) current.textContent = '●';
  }
}

customElements.define('fv-shell', FVShell);