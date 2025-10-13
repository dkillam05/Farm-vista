// FarmVista — App Shell (header, sidebar, footer) — v2025-10-13d
class FVShell extends HTMLElement {
  constructor() {
    super();
    const r = this.attachShadow({ mode: "open" });
    r.innerHTML = `
      <style>
        :host{ display:block; --fv-green:#3B7E46; --fv-gold:#D0C542; --fv-bg:#CBCDCB; --fv-text:#141514; --sidebar-w:280px; --sidebar-mini:72px; --container-max:1040px; --radius:12px; --shadow:0 10px 22px rgba(0,0,0,.12); }

        /* Shell uses full viewport height; ONLY the main area scrolls */
        .shell{
          height:100dvh;           /* important: pin header+footer */
          display:grid;
          grid-template-columns: var(--sidebar-mini) 1fr;
          grid-template-rows: auto 1fr auto; /* header, MAIN (scroll), footer */
          overflow:hidden;         /* prevent body scroll; main will scroll */
          background:var(--fv-bg);
          color:var(--fv-text);
        }
        .shell.expanded{ grid-template-columns: var(--sidebar-w) 1fr; }

        /* Header */
        header.hdr{
          grid-column:1 / -1;
          background:var(--fv-green); color:#fff;
          position:sticky; top:0; z-index:1000;
          border-bottom:1px solid rgba(0,0,0,.15);
        }
        .hdr-top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;max-width:calc(var(--container-max) + 32px);margin:0 auto;}
        .wordmark{font-weight:800;font-size:20px;letter-spacing:.3px;white-space:nowrap;}
        .btn{display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:9px;color:#fff;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.28);cursor:pointer;}
        .hdr-accent{height:3px;background:var(--fv-gold);}

        .offline{display:none;background:var(--fv-gold);color:var(--fv-text);padding:8px 14px;text-align:center;font-weight:600;}
        .offline.show{display:block;}

        /* Sidebar */
        aside.sb{
          grid-row:2 / span 1; /* only alongside main row */
          background:#fff;color:var(--fv-text);
          border-right:1px solid rgba(0,0,0,.08);
          box-shadow:var(--shadow);
          position:sticky; top:0; height:100%;
          display:flex; flex-direction:column;
        }
        @media (min-width:1024px){
          .sb{ width:var(--sidebar-mini); transition:width .18s ease; }
          .shell.expanded .sb{ width:var(--sidebar-w); }
        }

        /* MOBILE overlay */
        @media (max-width:1023px){
          aside.sb{
            position:fixed; left:0; top:0; bottom:0;
            width:84vw; max-width:320px;
            transform: translateX(-100%);
            transition: transform .2s ease-out;
            z-index: 1001;
          }
          .shell.mobile-open aside.sb{ transform: translateX(0); }
        }

        .sb-head{display:grid;gap:6px;padding:14px 12px;border-bottom:1px solid rgba(0,0,0,.08);align-content:start;}
        .farm-row{display:flex;align-items:center;gap:10px;}
        .farm-logo{width:36px;height:36px;border-radius:8px;object-fit:contain;background:#f0f2ef;border:1px solid rgba(0,0,0,.06);}
        .farm-title{font-weight:700;}
        .farm-sub{font-size:13px;opacity:.8;}
        @media (min-width:1024px){
          .shell:not(.expanded) .farm-title,
          .shell:not(.expanded) .farm-sub{ display:none; }
        }
        nav.menu{ padding:8px; overflow:auto; flex:1; }
        a.item{display:flex;align-items:center;gap:10px;padding:10px 10px;border-radius:10px;text-decoration:none;color:inherit;}
        a.item:hover{background:#f4f6f4;}
        .emoji{width:24px;text-align:center;}
        .label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        @media (min-width:1024px){ .shell:not(.expanded) .label{ display:none; } }

        .sb-foot{border-top:1px solid rgba(0,0,0,.08);padding:12px;font-size:12.5px;color:#2b2e2b;}
        .sb-foot strong{font-weight:800;}
        .sb-tagline{margin-top:4px;color:#49514d;}

        .scrim{position:fixed;inset:0;background:rgba(0,0,0,.45);opacity:0;pointer-events:none;transition:opacity .18s ease;z-index:1000;}
        .scrim.show{opacity:1;pointer-events:auto;}

        /* MAIN scrolls between header & footer */
        main{ grid-column:2 / -1; overflow:auto; background:var(--fv-bg); }
        .container{ max-width:var(--container-max); margin:0 auto; padding:18px 14px 14px; }

        /* Footer is always visible */
        footer.foot{
          grid-column:1 / -1;
          position:sticky; bottom:0;      /* pinned even if main scrolls */
          background:var(--fv-green); color:#fff;
          border-top:3px solid var(--fv-gold);
          display:grid; place-items:center;
          padding:10px 14px; white-space:nowrap;
          font-size:clamp(12px,1.6vw,14px);
          z-index: 1;                      /* above main content edges */
        }
      </style>

      <div class="shell">
        <header class="hdr">
          <div class="hdr-top">
            <button class="btn" id="btnMenu" title="Menu" aria-label="Menu">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
            </button>
            <div class="wordmark">FarmVista</div>
            <button class="btn" id="btnGear" title="User menu" aria-haspopup="menu" aria-expanded="false" aria-label="User menu">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09c.61-.24 1-.84 1-1.49"/></svg>
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
          <nav class="menu">
            <a class="item" href="/Farm-vista/dashboard/"><span class="emoji">🏠</span><span class="label">Home</span></a>
            <a class="item" href="#"><span class="emoji">🌱</span><span class="label">Crop Production</span></a>
            <a class="item" href="#"><span class="emoji">🚜</span><span class="label">Equipment</span></a>
            <a class="item" href="#"><span class="emoji">🌾</span><span class="label">Grain</span></a>
            <a class="item" href="#"><span class="emoji">💵</span><span class="label">Expenses</span></a>
            <a class="item" href="#"><span class="emoji">📊</span><span class="label">Reports</span></a>
            <a class="item" href="#"><span class="emoji">⚙️</span><span class="label">Setup</span></a>
          </nav>
          <div class="sb-foot">
            <div><strong>FarmVista</strong> <span id="ver">v1.0.0</span></div>
            <div class="sb-tagline" id="tagline">Clean farm data. Smarter reporting.</div>
          </div>
        </aside>

        <div class="scrim" id="scrim"></div>

        <main>
          <div class="container"><slot></slot></div>
        </main>

        <footer class="foot"><div id="footLine">© 2025 FarmVista • Monday, October 13th, 2025</div></footer>
      </div>
    `;

    this._root = r;
    this.$ = (s) => r.querySelector(s);

    this._initVersion();
    this._initFooterDate();
    this._initSidebarLogo();
  }

  connectedCallback(){
    const shell = this.$(".shell");
    const scrim = this.$("#scrim");
    const btnMenu = this.$("#btnMenu");
    const btnGear = this.$("#btnGear");
    const gear = this.$("#gearSheet");
    const offlineBanner = this.$("#offlineBanner");

    const isDesktop = () => matchMedia("(min-width:1024px)").matches;

    const applySidebarState = () => {
      if (isDesktop()) {
        shell.classList.remove("mobile-open");
        scrim.classList.remove("show");
        shell.classList.remove("expanded");  // start collapsed as mini rail
      } else {
        shell.classList.remove("expanded");
        scrim.classList.remove("show");
      }
    };
    applySidebarState();
    addEventListener("resize", applySidebarState);

    const toggleSidebar = () => {
      if (isDesktop()) shell.classList.toggle("expanded");
      else {
        const open = !shell.classList.contains("mobile-open");
        shell.classList.toggle("mobile-open", open);
        scrim.classList.toggle("show", open);
      }
    };

    btnMenu.addEventListener("click", toggleSidebar);
    scrim.addEventListener("click", () => {
      shell.classList.remove("mobile-open");
      scrim.classList.remove("show");
    });

    // Offline banner
    const onOffline = () => offlineBanner?.classList.add("show");
    const onOnline  = () => offlineBanner?.classList.remove("show");
    addEventListener("offline", onOffline);
    addEventListener("online", onOnline);
    if (!navigator.onLine) onOffline();

    // Register SW
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/Farm-vista/serviceworker.js").catch(()=>{});
    }
  }

  _initVersion(){
    const v=this.$("#ver"), t=this.$("#tagline");
    const num=window.FarmVistaVersion || (window.FV_VERSION&&window.FV_VERSION.number) || "1.0.0";
    const tag=window.FV_TAGLINE || (window.FV_VERSION&&window.FV_VERSION.tagline) || "Clean farm data. Smarter reporting.";
    if (v) v.textContent=`v${num}`;
    if (t) t.textContent=tag;
  }
  _initFooterDate(){
    const el=this.$("#footLine"); if(!el) return;
    const now=this._fmt(new Date());
    const yr=new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",year:"numeric"}).format(new Date());
    el.textContent=`© ${yr} FarmVista • ${now}`;
  }
  _fmt(d){
    const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",weekday:"long",month:"long",day:"numeric",year:"numeric"}).formatToParts(d);
    const map=Object.fromEntries(parts.map(p=>[p.type,p.value])); const n=parseInt(map.day,10);
    const s=(n%10===1&&n%100!==11)?"st":(n%10===2&&n%100!==12)?"nd":(n%10===3&&n%100!==13)?"rd":"th";
    return `${map.weekday}, ${map.month} ${n}${s}, ${map.year}`;
  }
  _initSidebarLogo(){ const img=this.$("#farmLogo"); if(img) img.src="/Farm-vista/assets/icons/logo.png"; }
}
customElements.define("fv-shell", FVShell);