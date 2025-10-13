// ==========================================================
// FarmVista — Reusable App Shell (Header / Sidebar / Footer)
// - Text-only wordmark with full-width gold accent bar
// - Gear top-sheet menu (Theme: System/Light/Dark; Profile/Feedback/Logout placeholders)
// - Sidebar: pinned on desktop (≥1024px), collapsed by default to mini icon rail,
//            overlay on phones; only "Home" navigates today
// - Sidebar header shows Farm logo + "Dowson Farms" + "Divernon, IL" (placeholders)
// - Sidebar footer shows "FarmVista v{version}" and tagline from js/version.js
// - Global footer: one-line, no wrap, auto-shrink, © YEAR • localized date (America/Chicago)
// - Offline banner (shows on offline, hides on online)
// - SW registration (silent updates)
// - Absolute paths from /Farm-vista/
//
// NOTE: Requires js/version.js loaded somewhere on the page first
//       (exposes FV_BUILD, FV_BUILD_DATE, FV_TAGLINE / FV_VERSION)
// ==========================================================
class FVShell extends HTMLElement {
  constructor() {
    super();
    const r = this.attachShadow({ mode: "open" });

    // --- Styling (scoped) ---
    r.innerHTML = `
      <style>
        :host { display:block; }

        /* Brand tokens with fallbacks (match theme.css) */
        :host {
          --fv-green:    #3B7E46;
          --fv-gold:     #D0C542;
          --fv-bg:       #CBCDCB;
          --fv-text:     #141514;

          /* Dark tuned palette (used when <html>.classList.contains('dark')) */
          --fv-dark-bg:        #141514;
          --fv-dark-surface:   #1B1D1B;
          --fv-dark-text:      #F2F4F1;
          --fv-dark-muted:     #AEB5AD;
          --fv-dark-border:    rgba(255,255,255,0.14);

          --sidebar-w: 280px;          /* pinned width */
          --sidebar-mini: 72px;        /* mini icon rail */
          --container-max: 1040px;     /* content max width */
          --radius: 12px;

          --shadow: 0 10px 22px rgba(0,0,0,.12);
          --shadow-strong: 0 14px 28px rgba(0,0,0,.18);
        }

        /* Layout grid: header on top, sidebar left (desktop), content + footer right */
        .shell {
          display: grid;
          grid-template-columns: var(--sidebar-mini) 1fr;
          grid-template-rows: auto 1fr auto;
          min-height: 100vh;
          background: var(--fv-bg);
          color: var(--fv-text);
        }

        /* When desktop and expanded */
        .shell.expanded {
          grid-template-columns: var(--sidebar-w) 1fr;
        }

        /* On phones: sidebar overlays; single column */
        @media (max-width: 1023px) {
          .shell,
          .shell.expanded {
            grid-template-columns: 1fr;
          }
        }

        /* Header */
        header.hdr {
          grid-column: 1 / -1;
          background: var(--fv-green);
          color: #fff;
          position: sticky; top: 0; z-index: 1000;
          border-bottom: 1px solid rgba(0,0,0,.15);
        }
        .hdr-top {
          display:flex; align-items:center; justify-content:space-between;
          gap: 12px; padding: 10px 14px;
          max-width: calc(var(--container-max) + 32px);
          margin: 0 auto;
        }
        .wordmark {
          font-weight: 800; font-size: 20px; letter-spacing: .3px;
          text-transform: none; white-space: nowrap;
        }
        .btn {
          display:inline-flex; align-items:center; justify-content:center;
          width:40px; height:40px; border-radius: 9px;
          color:#fff; background: rgba(255,255,255,.08);
          border: 1px solid rgba(255,255,255,.28);
          cursor:pointer; -webkit-tap-highlight-color: transparent;
        }
        .btn:active { transform: translateY(1px); }

        /* Full-width gold accent bar */
        .hdr-accent { height: 3px; background: var(--fv-gold); }

        /* Offline banner */
        .offline {
          display:none;
          background: var(--fv-gold);
          color: var(--fv-text);
          padding: 8px 14px;
          text-align: center;
          font-weight: 600;
        }
        .offline.show { display:block; }

        /* Sidebar (desktop pinned) */
        aside.sb {
          grid-row: 2 / span 2;
          background: #fff;
          color: var(--fv-text);
          border-right: 1px solid rgba(0,0,0,0.08);
          box-shadow: var(--shadow);
          position: sticky; top: 0; height: 100dvh;
          display:flex; flex-direction: column;
        }
        .sb-mini aside.sb { width: var(--sidebar-mini); }
        .sb.expanded { width: var(--sidebar-w); }

        /* Sidebar collapsed vs expanded (desktop ≥1024) */
        @media (min-width: 1024px) {
          .sb { width: var(--sidebar-mini); transition: width .18s ease; }
          .shell.expanded .sb { width: var(--sidebar-w); }
        }

        /* Sidebar header (logo + farm name/address) */
        .sb-head {
          display:grid; gap:6px; padding: 14px 12px;
          border-bottom: 1px solid rgba(0,0,0,0.08);
          align-content: start;
        }
        .farm-row { display:flex; align-items:center; gap:10px; }
        .farm-logo {
          width: 36px; height: 36px; border-radius: 8px; object-fit: contain;
          background: #f0f2ef; border:1px solid rgba(0,0,0,.06);
        }
        .farm-title { font-weight: 700; }
        .farm-sub   { font-size: 13px; opacity: .8; }

        /* Hide text in mini mode on desktop */
        @media (min-width: 1024px) {
          .shell:not(.expanded) .farm-title,
          .shell:not(.expanded) .farm-sub { display:none; }
        }

        /* Menu */
        nav.menu { padding: 8px; overflow: auto; flex: 1; }
        a.item {
          display:flex; align-items:center; gap:10px;
          padding: 10px 10px; border-radius: 10px;
          text-decoration: none; color: inherit;
        }
        a.item:hover { background: #f4f6f4; }
        .emoji { width: 24px; text-align: center; }
        .label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

        /* Hide labels in mini mode desktop */
        @media (min-width: 1024px) {
          .shell:not(.expanded) .label { display:none; }
        }

        /* Sidebar footer */
        .sb-foot {
          border-top: 1px solid rgba(0,0,0,0.08);
          padding: 12px;
          font-size: 12.5px;
          color: #2b2e2b;
        }
        .sb-foot strong { font-weight: 800; }
        .sb-tagline { margin-top: 4px; color: #49514d; }

        /* Scrim for overlays (phone + gear sheet) */
        .scrim {
          position: fixed; inset: 0; background: rgba(0,0,0,.45);
          opacity: 0; pointer-events: none; transition: opacity .18s ease;
          z-index: 900;
        }
        .scrim.show { opacity: 1; pointer-events: auto; }

        /* Gear top-sheet (full-width under header) */
        .gear {
          position: fixed; left: 0; right: 0; top: 56px;
          background: var(--fv-green); color: #fff;
          border-bottom: 1px solid rgba(0,0,0,.15);
          transform-origin: top center;
          transform: scaleY(.98);
          opacity: 0; visibility: hidden;
          transition: transform .14s ease, opacity .14s ease, visibility .14s;
          z-index: 1001;
        }
        .gear.show { transform: scaleY(1); opacity: 1; visibility: visible; }
        .gear-inner {
          max-width: calc(var(--container-max) + 32px);
          margin: 0 auto; padding: 8px 14px 12px 14px;
        }
        .row {
          display:flex; align-items:center; justify-content:space-between;
          padding: 12px 6px; border-radius: 10px;
          cursor: pointer; user-select: none;
        }
        .row:hover { background: rgba(255,255,255,.08); }
        .row .l { display:flex; align-items:center; gap:10px; }
        .chev { opacity: .8; }
        .row.logout { color: #FFD8D8; }
        .row.logout:hover { background: rgba(255,255,255,.03); }

        .section-title {
          text-transform: uppercase; letter-spacing: .12em;
          font-size: 12px; opacity: .9; margin: 6px 0 2px 4px;
        }

        /* Theme chips */
        .chips { display:flex; gap:8px; flex-wrap:wrap; padding: 6px 4px 8px; }
        .chip {
          border: 1px solid rgba(255,255,255,.35);
          background: rgba(255,255,255,.08);
          color: #fff; padding: 8px 12px;
          border-radius: 999px; cursor: pointer;
        }
        .chip[aria-pressed="true"] { outline: 2px solid #fff; outline-offset: 2px; }

        /* Main */
        main {
          background: var(--fv-bg);
          padding: 18px 14px 44px;
          min-width: 0;
        }
        .container { max-width: var(--container-max); margin: 0 auto; }

        /* Footer (global) */
        footer.foot {
          grid-column: 2 / -1;
          background: var(--fv-green); color: #fff;
          border-top: 3px solid var(--fv-gold);
          display: grid; place-items: center;
          padding: 10px 14px;
          white-space: nowrap;
          font-size: clamp(12px, 1.6vw, 14px); /* auto-shrink on small screens */
        }
        @media (max-width: 1023px) {
          footer.foot { grid-column: 1 / -1; }
        }
      </style>

      <div class="shell"><!-- classes toggled by JS: expanded -->
        <header class="hdr">
          <div class="hdr-top">
            <button class="btn" id="btnMenu" title="Menu" aria-label="Menu">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M3 6h18M3 12h18M3 18h18"/>
              </svg>
            </button>
            <div class="wordmark">FarmVista</div>
            <button class="btn" id="btnGear" title="User menu" aria-haspopup="menu" aria-expanded="false" aria-label="User menu">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06A2 2 0 0 1 7.04 3.3l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.08a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c0 .67.39 1.27 1 1.51H21a2 2 0 1 1 0 4h-.09c-.61.24-1 .84-1 1.49z"/>
              </svg>
            </button>
          </div>
          <div class="offline" id="offlineBanner">You’re offline. Some data may be unavailable.</div>
          <div class="hdr-accent"></div>
        </header>

        <aside class="sb">
          <div class="sb-head">
            <div class="farm-row">
              <img class="farm-logo" id="farmLogo" alt="Farm logo"/>
              <div class="farm-texts">
                <div class="farm-title">Dowson Farms</div>
                <div class="farm-sub">Divernon, IL</div>
              </div>
            </div>
          </div>
          <nav class="menu" id="menu">
            <a class="item" href="/Farm-vista/dashboard/"><span class="emoji">🏠</span><span class="label">Home</span></a>
            <a class="item" href="javascript:void(0)"><span class="emoji">🌱</span><span class="label">Crop Production</span></a>
            <a class="item" href="javascript:void(0)"><span class="emoji">🚜</span><span class="label">Equipment</span></a>
            <a class="item" href="javascript:void(0)"><span class="emoji">🌾</span><span class="label">Grain</span></a>
            <a class="item" href="javascript:void(0)"><span class="emoji">💵</span><span class="label">Expenses</span></a>
            <a class="item" href="javascript:void(0)"><span class="emoji">📊</span><span class="label">Reports</span></a>
            <a class="item" href="javascript:void(0)"><span class="emoji">⚙️</span><span class="label">Setup</span></a>
          </nav>
          <div class="sb-foot">
            <div><strong>FarmVista</strong> <span id="ver">v0.0.0</span></div>
            <div class="sb-tagline" id="tagline">Clean farm data. Smarter reporting.</div>
          </div>
        </aside>

        <div class="scrim" id="scrim"></div>

        <main>
          <div class="container">
            <slot></slot>
          </div>
        </main>

        <footer class="foot">
          <div id="footLine">© 2025 FarmVista • Monday, October 13th, 2025</div>
        </footer>

        <!-- Gear top-sheet -->
        <div class="gear" id="gearSheet" role="menu" aria-label="User menu">
          <div class="gear-inner">
            <div class="section-title">Theme</div>
            <div class="chips">
              <button class="chip" data-theme="system" aria-pressed="false">System</button>
              <button class="chip" data-theme="light"  aria-pressed="false">Light</button>
              <button class="chip" data-theme="dark"   aria-pressed="false">Dark</button>
            </div>

            <div class="section-title">Account</div>
            <div class="row" data-action="profile">
              <div class="l"><span>Profile</span></div>
              <div class="chev">›</div>
            </div>
            <div class="row" data-action="feedback">
              <div class="l"><span>Feedback</span></div>
              <div class="chev">›</div>
            </div>
            <div class="row logout" data-action="logout">
              <div class="l"><span>Logout</span></div>
              <div class="chev">›</div>
            </div>
          </div>
        </div>
      </div>
    `;

    // Cache important nodes
    this._root = r;
    this.$ = (sel) => r.querySelector(sel);

    // Initialize static bits
    this._initVersion();
    this._initFooterDate();
    this._initSidebarLogo();
  }

  connectedCallback() {
    const shell = this.$(".shell");
    const sb = this.$(".sb");
    const scrim = this.$("#scrim");
    const btnMenu = this.$("#btnMenu");
    const btnGear = this.$("#btnGear");
    const gear = this.$("#gearSheet");
    const offlineBanner = this.$("#offlineBanner");

    // ----- Sidebar behavior -----
    const isDesktop = () => window.matchMedia("(min-width: 1024px)").matches;

    const applySidebarState = () => {
      // Desktop: pinned but collapsed by default every load
      if (isDesktop()) {
        shell.classList.remove("overlay");
        shell.classList.remove("mobile-open");
        shell.classList.remove("expanded"); // collapsed = mini rail
        scrim.classList.remove("show");
      } else {
        // Phone: overlay closed by default
        shell.classList.add("overlay");
        shell.classList.remove("expanded");
        scrim.classList.remove("show");
      }
    };
    applySidebarState();
    window.addEventListener("resize", applySidebarState);

    const toggleSidebar = () => {
      if (isDesktop()) {
        // Toggle collapsed <-> expanded
        shell.classList.toggle("expanded");
      } else {
        // Mobile overlay
        const open = !scrim.classList.contains("show");
        scrim.classList.toggle("show", open);
        shell.classList.toggle("mobile-open", open);
      }
    };
    btnMenu.addEventListener("click", toggleSidebar);
    scrim.addEventListener("click", () => {
      scrim.classList.remove("show");
      shell.classList.remove("mobile-open");
      this._hideGear();
    });

    // ----- Gear menu -----
    btnGear.addEventListener("click", () => {
      const open = !gear.classList.contains("show");
      if (open) {
        this._showGear();
        // Close sidebar overlay if open
        scrim.classList.add("show");
      } else {
        this._hideGear();
        scrim.classList.remove("show");
      }
    });

    // Theme chips
    this._reflectThemeChips();
    this._root.querySelectorAll(".chip[data-theme]").forEach(btn => {
      btn.addEventListener("click", () => {
        const mode = btn.getAttribute("data-theme") || "system";
        this._applyTheme(mode);
      });
    });

    // Placeholder actions
    this._root.querySelector('[data-action="profile"]').addEventListener("click", () => {
      this._toast("(Mock) Profile screen coming soon.");
    });
    this._root.querySelector('[data-action="feedback"]').addEventListener("click", () => {
      this._toast("(Mock) Feedback screen coming soon.");
    });
    this._root.querySelector('[data-action="logout"]').addEventListener("click", () => {
      this._toast("(Mock) Logout not wired yet.");
    });

    // ----- Offline banner -----
    const onOffline = () => offlineBanner.classList.add("show");
    const onOnline  = () => offlineBanner.classList.remove("show");
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    if (!navigator.onLine) onOffline();

    // ----- Service Worker registration (silent updates) -----
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/Farm-vista/serviceworker.js").catch(()=>{});
    }
  }

  // ----- Helpers -----
  _initVersion() {
    const verEl = this.$("#ver");
    const tagEl = this.$("#tagline");
    const v = (window.FV_BUILD || (window.FV_VERSION && window.FV_VERSION.number) || "0.0.0");
    const t = (window.FV_TAGLINE || (window.FV_VERSION && window.FV_VERSION.tagline) || "");
    if (verEl) verEl.textContent = `v${v}`;
    if (tagEl) tagEl.textContent = t || "";
  }

  _initFooterDate() {
    const foot = this.$("#footLine");
    if (!foot) return;
    const now = this._formatLongDateChi(new Date());
    const year = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric" }).format(new Date());
    foot.textContent = `© ${year} FarmVista • ${now}`;
    // Update shortly after midnight local
    const schedule = () => {
      const chiNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }));
      const next = new Date(chiNow); next.setDate(chiNow.getDate() + 1); next.setHours(0, 0, 5, 0);
      const ms = +next - +chiNow;
      setTimeout(() => { this._initFooterDate(); schedule(); }, Math.max(ms, 30_000));
    };
    schedule();
  }

  _formatLongDateChi(d) {
    // Monday, October 13th, 2025
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      weekday: "long", month: "long", day: "numeric", year: "numeric"
    }).formatToParts(d);
    const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
    const day = parseInt(map.day, 10);
    const suffix = (n) => {
      const j = n % 10, k = n % 100;
      if (j === 1 && k !== 11) return "st";
      if (j === 2 && k !== 12) return "nd";
      if (j === 3 && k !== 13) return "rd";
      return "th";
    };
    return `${map.weekday}, ${map.month} ${day}${suffix(day)}, ${map.year}`;
  }

  _initSidebarLogo() {
    const img = this.$("#farmLogo");
    if (!img) return;
    img.src = "/Farm-vista/assets/icons/logo.png";
  }

  _showGear() {
    const gear = this.$("#gearSheet");
    const btn = this.$("#btnGear");
    const scrim = this.$("#scrim");
    gear.classList.add("show");
    btn.setAttribute("aria-expanded", "true");
    scrim.classList.add("show");
  }
  _hideGear() {
    const gear = this.$("#gearSheet");
    const btn = this.$("#btnGear");
    const scrim = this.$("#scrim");
    gear.classList.remove("show");
    btn.setAttribute("aria-expanded", "false");
    // scrim is closed by sidebar/gear interactions
  }

  _applyTheme(mode) {
    // Persist & apply: default System
    try { localStorage.setItem("fv-theme", mode); } catch {}
    const root = document.documentElement;
    root.classList.remove("dark");
    if (mode === "dark") {
      root.classList.add("dark");
    } else if (mode === "system") {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      if (prefersDark) root.classList.add("dark");
    }
    this._reflectThemeChips();
  }

  _reflectThemeChips() {
    let mode = "system";
    try { mode = localStorage.getItem("fv-theme") || "system"; } catch {}
    this._root.querySelectorAll('.chip[data-theme]').forEach(ch => {
      ch.setAttribute("aria-pressed", String(ch.getAttribute("data-theme") === mode));
    });
  }

  _toast(msg) {
    // Minimal unobtrusive toast inside shadow root
    const t = document.createElement("div");
    t.textContent = msg;
    Object.assign(t.style, {
      position: "fixed", left: "50%", bottom: "16px", transform: "translateX(-50%)",
      background: "rgba(0,0,0,.85)", color: "#fff", padding: "10px 12px",
      borderRadius: "10px", fontSize: "13px", zIndex: "2000"
    });
    this._root.appendChild(t);
    setTimeout(() => t.remove(), 1800);
  }
}

customElements.define("fv-shell", FVShell);