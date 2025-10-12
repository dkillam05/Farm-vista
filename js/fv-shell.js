// js/fv-shell.js
// FarmVista Shell Web Component: header + sidebar (scrollable) + footer + user menu + theme switch
class FVShell extends HTMLElement {
  constructor() {
    super();
    const r = this.attachShadow({ mode: 'open' });
    r.innerHTML = `
      <style>
        :host { display: block; }

        /* inherit brand tokens from page (theme.css) with sensible fallbacks */
        :host {
          --fv-green:      var(--fv-green, #3B7E46);
          --fv-yellow:     var(--fv-yellow, #D0C542);
          --fv-gunmetal:   var(--fv-gunmetal, #CBCDCB);
          --fv-black:      var(--fv-black, #141514);
          --fv-border:     var(--fv-border, #e2e5e5);
          --fv-surface:    var(--fv-surface, #f5f6f6);
          --fv-ring:       var(--fv-ring, #b9e1c4);
        }

        .container { width: min(1100px, 100%); margin-inline: auto; padding: 0 16px; }
        .brand { font-weight: 700; letter-spacing: .4px; font-size: 20px; color: var(--fv-black); }

        /* ---------- Header ---------- */
        header.fv-header {
          position: sticky; top: 0; z-index: 5;
          background: #fff;
          border-bottom: 1px solid var(--fv-border);
        }
        header .top {
          display: flex; align-items: center; justify-content: space-between;
          gap: 12px; padding: 10px 0;
        }
        header .bottom {
          padding: 0 0 8px;
        }
        .stripe {
          height: 6px;
          background: linear-gradient(90deg, var(--fv-green), var(--fv-yellow));
          border-radius: 999px;
          margin: 0 0 8px;
        }

        /* burger + gear buttons */
        .btn-plain {
          display: inline-flex; align-items: center; justify-content: center;
          width: 40px; height: 40px;
          border-radius: 8px; border: 1px solid var(--fv-border);
          background: #fff; cursor: pointer; font-size: 22px; line-height: 1;
          transition: transform .02s ease;
        }
        .btn-plain:active { transform: translateY(1px); }
        .btn-plain:focus { outline: 3px solid var(--fv-ring); outline-offset: 1px; }

        /* ---------- Sidebar ---------- */
        aside.fv-sidebar {
          position: fixed; left: 0; top: 0;
          width: var(--sidebar-w, 270px);
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
        }

        /* nav colors & states */
        aside .menu h6 {
          margin: 10px 8px; font-size: 12px; text-transform: uppercase; letter-spacing: .12em;
          color: var(--fv-yellow);
        }
        aside .menu a, aside .menu summary {
          display: block; color: #f0f3f0; text-decoration: none;
          padding: 10px 10px; border-radius: 8px; font-size: 14px; cursor: pointer;
        }
        aside .menu a:hover, aside .menu summary:hover { background: rgba(255,255,255,.06); }
        aside .menu details { margin: 4px 0; }
        aside .menu details > summary { list-style: none; }
        aside .menu details > summary::-webkit-details-marker { display: none; }
        aside .menu details[open] > summary { background: rgba(255,255,255,.06); }
        /* active link style (apply class="active" on the <a> for current page) */
        aside .menu a.active {
          position: relative; background: rgba(255,255,255,.08);
        }
        aside .menu a.active::before {
          content: ""; position: absolute; left: 0; top: 6px; bottom: 6px; width: 3px;
          background: var(--fv-green); border-radius: 3px;
        }

        /* ---------- Scrim ---------- */
        .scrim {
          position: fixed; inset: 0;
          background: rgba(0,0,0,.45);
          opacity: 0; pointer-events: none; transition: opacity .18s ease-out;
          z-index: 998;
        }

        /* ---------- Main ---------- */
        main.fv-main { padding: 18px 16px 40px; }

        /* ---------- Footer ---------- */
        footer.fv-footer {
          border-top: 1px solid var(--fv-border);
          background: #fff; padding: 14px 0; color: #5c5f5c;
        }

        /* ---------- Toggle mechanics ---------- */
        #navToggle { display: none; }
        #navToggle:checked ~ aside.fv-sidebar { transform: translateX(0); }
        #navToggle:checked ~ .scrim { opacity: 1; pointer-events: auto; }

        /* ---------- Profile menu (gear) ---------- */
        .menu-anchor { position: relative; }
        .user-menu {
          position: absolute; right: 0; top: 48px;
          min-width: 220px;
          background: #fff; color: var(--fv-black);
          border: 1px solid var(--fv-border);
          border-radius: 10px;
          box-shadow: 0 10px 22px rgba(0,0,0,.08);
          padding: 6px;
          display: none;
          z-index: 1000;
        }
        .user-menu.open { display: block; }
        .user-menu h6 {
          margin: 6px 8px 6px; font-size: 12px; text-transform: uppercase; letter-spacing: .12em; color: #6a6d6a;
        }
        .user-menu button, .user-menu a {
          display: flex; align-items: center; justify-content: space-between;
          width: 100%;
          padding: 10px 10px;
          background: none; border: 0; text-align: left; cursor: pointer;
          border-radius: 8px; font: inherit; color: inherit;
        }
        .user-menu button:hover, .user-menu a:hover { background: #f4f6f4; }
        .divider { height: 1px; background: var(--fv-border); margin: 6px; border-radius: 999px; }
        .check { font-size: 16px; opacity: .9; }
        .logout { color: #9b1d1d; }

        /* ---------- Desktop pinned sidebar ---------- */
        @media (min-width: 1000px) {
          .burger { display: none; }
          aside.fv-sidebar { transform: none; }
          .scrim { display: none; }
          main.fv-main, footer.fv-footer { margin-left: var(--sidebar-w, 270px); }
        }

        /* Optional: slight style for slotted breadcrumbs */
        ::slotted(.breadcrumbs) { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 13px; }
      </style>

      <!-- internal toggle checkbox -->
      <input id="navToggle" type="checkbox" hidden />

      <!-- Header -->
      <header class="fv-header">
        <div class="stripe"></div>
        <div class="container top">
          <label for="navToggle" class="btn-plain burger" aria-label="Open menu">☰</label>
          <div class="brand">FarmVista</div>

          <!-- gear + user menu -->
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
        <div class="container bottom">
          <!-- Breadcrumbs injected by page -->
          <slot name="breadcrumbs"></slot>
        </div>
      </header>

      <!-- Sidebar -->
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

      <!-- click to close menu on mobile -->
      <label class="scrim" for="navToggle" aria-hidden="true"></label>

      <!-- Main content from the page goes here -->
      <main class="fv-main"><slot></slot></main>

      <!-- Footer -->
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

    // user menu elements
    this._menu = this.shadowRoot.querySelector('.user-menu');
    this._gear = this.shadowRoot.querySelector('.gear');

    // open/close menu
    this._gear?.addEventListener('click', () => {
      const open = this._menu?.classList.toggle('open');
      if (this._gear) this._gear.setAttribute('aria-expanded', String(!!open));
      // when opening, start listening for outside clicks
      if (open) document.addEventListener('click', this._onDocClick, true);
    });

    // theme handling
    const btns = this.shadowRoot.querySelectorAll('.user-menu [data-theme]');
    btns.forEach(b => b.addEventListener('click', () => {
      const mode = b.getAttribute('data-theme');
      this._applyTheme(mode || 'system');
      this._reflectThemeChecks();
    }));

    // initialize theme from storage or system
    this._mq = window.matchMedia('(prefers-color-scheme: dark)');
    this._mq.addEventListener?.('change', () => {
      const saved = localStorage.getItem('fv-theme') || 'system';
      if (saved === 'system') this._applyTheme('system');
    });
    const saved = localStorage.getItem('fv-theme') || 'system';
    this._applyTheme(saved);
    this._reflectThemeChecks();

    // logout (placeholder event)
    const logout = this.shadowRoot.querySelector('.logout');
    logout?.addEventListener('click', (e) => {
      e.preventDefault();
      this.dispatchEvent(new CustomEvent('logout', { bubbles: true, composed: true }));
      // for now just close menu
      this._closeMenu();
    });
  }

  disconnectedCallback() {
    document.removeEventListener('click', this._onDocClick, true);
    this._mq?.removeEventListener?.('change', this._applyTheme);
  }

  _handleDocClick(e) {
    // close menu if click is outside shadow root or outside the menu/gear
    const path = e.composedPath();
    const contains = path.some(el => el === this.shadowRoot || (el && el.host === this));
    if (!contains) this._closeMenu();
  }

  _closeMenu() {
    this._menu?.classList.remove('open');
    this._gear?.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', this._onDocClick, true);
  }

  _applyTheme(mode) {
    localStorage.setItem('fv-theme', mode);
    const root = document.documentElement;
    // remove existing
    root.classList.remove('dark');
    if (mode === 'dark') {
      root.classList.add('dark');
    } else if (mode === 'system') {
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