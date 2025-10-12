// js/fv-shell.js
// FarmVista Shell Web Component: header + sidebar (scrollable) + footer
class FVShell extends HTMLElement {
  constructor() {
    super();
    const r = this.attachShadow({ mode: 'open' });
    r.innerHTML = `
      <style>
        :host { display: block; }

        :root{ --sidebar-w: 270px; }

        /* Local tokens tied to theme variables (inheritable into shadow) */
        :host {
          --fv-green:      var(--fv-green, #3B7E46);
          --fv-yellow:     var(--fv-yellow, #D0C542);
          --fv-gunmetal:   var(--fv-gunmetal, #CBCDCB);
          --fv-black:      var(--fv-black, #141514);
          --fv-border:     var(--fv-border, #e2e5e5);
          --fv-surface:    var(--fv-surface, #f5f6f6);
          --fv-ring:       var(--fv-ring, #b9e1c4);
        }

        /* Minimal utility inside shadow */
        .container { width: min(1100px, 100%); margin-inline: auto; padding: 0 16px; }
        .brand { font-weight: 700; letter-spacing: .4px; font-size: 20px; color: var(--fv-black); }

        header.fv-header {
          display: grid; row-gap: 8px;
          padding: 10px 0 12px;
          border-bottom: 1px solid var(--fv-border);
          background: #fff;
          position: sticky; top: 0; z-index: 5;
        }
        header .top {
          display: flex; align-items: center; gap: 12px; justify-content: space-between;
        }
        .burger {
          display: inline-flex; align-items: center; justify-content: center;
          width: 40px; height: 40px; border-radius: 8px;
          border: 1px solid var(--fv-border);
          background: #fff; cursor: pointer; font-size: 22px; line-height: 1;
        }
        .burger:focus { outline: 3px solid var(--fv-ring); outline-offset: 1px; }

        .stripe {
          height: 4px;
          background: linear-gradient(90deg, var(--fv-green), var(--fv-yellow));
          border-radius: 999px; margin-top: 8px;
        }

        /* Sidebar */
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
        }
        aside .menu h6 {
          margin: 10px 8px; font-size: 12px; text-transform: uppercase; letter-spacing: .12em; color: #b9beb9;
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

        .scrim {
          position: fixed; inset: 0;
          background: rgba(0,0,0,.45);
          opacity: 0; pointer-events: none; transition: opacity .18s ease-out;
          z-index: 998;
        }

        main.fv-main { padding: 18px 16px 40px; }

        footer.fv-footer {
          border-top: 1px solid var(--fv-border);
          background: #fff;
          padding: 14px 0;
          color: #5c5f5c;
        }

        /* Toggle mechanics */
        #navToggle { display: none; }
        #navToggle:checked ~ aside.fv-sidebar { transform: translateX(0); }
        #navToggle:checked ~ .scrim { opacity: 1; pointer-events: auto; }

        /* Desktop pinned sidebar */
        @media (min-width: 1000px) {
          .burger { display: none; }
          aside.fv-sidebar { transform: none; }
          .scrim { display: none; }
          main.fv-main, footer.fv-footer { margin-left: var(--sidebar-w); }
        }
      </style>

      <!-- internal toggle checkbox -->
      <input id="navToggle" type="checkbox" hidden />

      <!-- Header -->
      <header class="fv-header">
        <div class="container top">
          <label for="navToggle" class="burger" aria-label="Open menu">☰</label>
          <div class="brand">FarmVista</div>
          <div style="width:40px;height:40px;border:1px solid var(--fv-border); border-radius:8px; background:#fff; display:flex; align-items:center; justify-content:center;" title="Profile">⚙️</div>
        </div>
        <div class="container"><div class="stripe"></div></div>
      </header>

      <!-- Sidebar -->
      <aside class="fv-sidebar" aria-label="Primary">
        <nav class="menu">
          <h6>Navigation</h6>

          <a href="index.html">Dashboard</a>

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
  }

  connectedCallback() {
    // simple year stamp
    const y = this.shadowRoot.getElementById('y');
    if (y) y.textContent = new Date().getFullYear();
  }
}

customElements.define('fv-shell', FVShell);
