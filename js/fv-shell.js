// FarmVista — App Shell (people icon + spinner + toasts) v2025-10-13k
// - People menu button (👥) opens settings sheet
// - One-button updater with spinner + progress + post-reload outcome toast
// - Pinned footer; main is only scroller; safe-area aware

class FVShell extends HTMLElement {
  constructor() {
    super();
    const r = this.attachShadow({ mode: "open" });
    r.innerHTML = `
      <style>
        :host{ display:block;
          --fv-green:#3B7E46; --fv-gold:#D0C542; --fv-bg:#CBCDCB; --fv-text:#141514;
          --sidebar-w:280px; --sidebar-mini:72px; --container-max:1040px;
          --radius:12px; --shadow:0 10px 22px rgba(0,0,0,.12);
          --safe-right: env(safe-area-inset-right, 0px);
          --safe-left:  env(safe-area-inset-left, 0px);
          --safe-top:   env(safe-area-inset-top, 0px);
        }

        /* ===== Shell: header | main (scrolls) | footer (pinned) ===== */
        .shell{
          height:100dvh; display:grid;
          grid-template-columns: var(--sidebar-mini) 1fr; /* desktop */
          grid-template-rows: auto 1fr auto;
          overflow:hidden; background:var(--fv-bg); color:var(--fv-text);
        }
        .shell.expanded{ grid-template-columns: var(--sidebar-w) 1fr; }

        /* ===== Header ===== */
        header.hdr{
          grid-column:1 / -1; background:var(--fv-green); color:#fff;
          position:sticky; top:0; z-index:1000;
          border-bottom:1px solid rgba(0,0,0,.15);
        }
        .hdr-top{
          display:flex; align-items:center; justify-content:space-between; gap:12px;
          padding:10px max(14px, var(--safe-right)) 10px max(14px, var(--safe-left));
          padding-top: calc(10px + var(--safe-top));
          max-width:calc(var(--container-max) + 32px); margin:0 auto;
        }
        .wordmark{font-weight:800;font-size:20px;letter-spacing:.3px;white-space:nowrap;}
        .btn{ display:inline-flex; align-items:center; justify-content:center;
          width:40px; height:40px; border-radius:9px; color:#fff;
          background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.28); cursor:pointer; }
        .hdr-accent{ height:3px; background:var(--fv-gold); }
        .offline{ display:none; background:var(--fv-gold); color:var(--fv-text); padding:8px 14px; text-align:center; font-weight:600; }
        .offline.show{ display:block; }

        /* ===== Sidebar ===== */
        aside.sb{
          grid-row:2 / span 1; background:#fff; color:var(--fv-text);
          border-right:1px solid rgba(0,0,0,.08); box-shadow:var(--shadow);
          position:sticky; top:0; height:100%; display:flex; flex-direction:column;
        }
        @media (min-width:1024px){
          .sb{ width:var(--sidebar-mini); transition:width .18s ease; }
          .shell.expanded .sb{ width:var(--sidebar-w); }
        }
        @media (max-width:1023px){
          .shell{ grid-template-columns: 1fr; }
          aside.sb{
            position:fixed; left:0; top:0; bottom:0; width:84vw; max-width:320px;
            transform:translateX(-100%); transition:transform .2s ease-out; z-index:1001; box-shadow:none;
          }
          .shell.mobile-open aside.sb{ transform:translateX(0); box-shadow:var(--shadow); }
        }
        .sb-head{display:grid;gap:6px;padding:14px 12px;border-bottom:1px solid rgba(0,0,0,.08);}
        .farm-row{display:flex;align-items:center;gap:10px;}
        .farm-logo{width:36px;height:36px;border-radius:8px;object-fit:contain;background:#f0f2ef;border:1px solid rgba(0,0,0,.06);}
        .farm-title{font-weight:700;}
        .farm-sub{font-size:13px;opacity:.8;}
        @media (min-width:1024px){ .shell:not(.expanded) .farm-title, .shell:not(.expanded) .farm-sub{ display:none; } }
        nav.menu{ padding:8px; overflow:auto; flex:1; }
        a.item{display:flex;align-items:center;gap:10px;padding:10px;border-radius:10px;text-decoration:none;color:inherit;}
        a.item:hover{background:#f4f6f4;}
        .emoji{width:24px;text-align:center;}
        .label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        @media (min-width:1024px){ .shell:not(.expanded) .label{ display:none; } }

        .sb-foot{border-top:1px solid rgba(0,0,0,.08);padding:12px;font-size:12.5px;color:#2b2e2b;}
        .sb-foot strong{font-weight:800;}
        .sb-tagline{margin-top:4px;color:#49514d;}

        .scrim{position:fixed;inset:0;background:rgba(0,0,0,.45);opacity:0;pointer-events:none;transition:opacity .18s ease;z-index:1000;}
        .scrim.show{opacity:1;pointer-events:auto;}

        /* ===== Main (only scroller) ===== */
        main{ grid-column:1 / -1; overflow:auto; overscroll-behavior:contain; -webkit-overflow-scrolling:touch; background:var(--fv-bg); }
        .container{ max-width:var(--container-max); margin:0 auto; padding:18px 14px 14px; }

        /* ===== Footer pinned ===== */
        footer.foot{
          grid-column:1 / -1; position:sticky; bottom:0;
          background:var(--fv-green); color:#fff; border-top:3px solid var(--fv-gold);
          display:grid; place-items:center; padding:10px max(14px,var(--safe-right));
          white-space:nowrap; font-size:clamp(12px,1.6vw,14px); z-index:1;
        }

        /* ===== Settings sheet ===== */
        .gear{
          position:fixed; left:0; right:0;
          top:calc(56px + var(--safe-top));
          background:var(--fv-green); color:#fff; border-bottom:1px solid rgba(0,0,0,.15);
          transform-origin:top center; transform:scaleY(.98); opacity:0; visibility:hidden;
          transition:transform .14s ease, opacity .14s ease, visibility .14s; z-index:1002;
          max-height:calc(100dvh - 56px - var(--safe-top)); overflow:auto; -webkit-overflow-scrolling:touch;
        }
        .gear.show{ transform:scaleY(1); opacity:1; visibility:visible; }
        .gear-inner{ max-width:calc(var(--container-max) + 32px);
          margin:0 auto; padding:8px max(14px, var(--safe-right)) 14px max(14px, var(--safe-left)); }
        .section-title{ text-transform:uppercase; letter-spacing:.12em; font-size:12px; opacity:.9; margin:6px 0 2px 4px; }
        .chips{ display:flex; gap:8px; flex-wrap:wrap; padding:6px 4px 8px; }
        .chip{ border:1px solid rgba(255,255,255,.35); background:rgba(255,255,255,.08); color:#fff; padding:8px 12px; border-radius:999px; cursor:pointer; }
        .chip[aria-pressed="true"]{ outline:2px solid #fff; outline-offset:2px; }
        .row{ display:flex; align-items:center; justify-content:space-between; padding:12px 6px; border-radius:10px; cursor:pointer; }
        .row:hover{ background:rgba(255,255,255,.08); }
        .muted{ opacity:.8; font-size:.95em; }

        /* tiny inline spinner for update action */
        #updIcon .spin{
          width:16px; height:16px; display:inline-block;
          border:2px solid rgba(255,255,255,.35);
          border-top-color:#fff; border-radius:50%;
          animation: fvspin 0.9s linear infinite;
        }
        @keyframes fvspin { to { transform: rotate(360deg); } }
      </style>

      <div class="shell">
        <header class="hdr">
          <div class="hdr-top">
            <button class="btn" id="btnMenu" title="Menu" aria-label="Menu">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M3 6h18M3 12h18M3 18h18"/>
              </svg>
            </button>
            <div class="wordmark">FarmVista</div>
            <button class="btn" id="btnGear" title="User menu" aria-haspopup="menu" aria-expanded="false" aria-label="User menu">
              <!-- People (two users) icon -->
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
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

        <main><div class="container"><slot></slot></div></main>

        <footer class="foot"><div id="footLine">© 2025 FarmVista • </div></footer>

        <!-- Settings sheet -->
        <div class="gear" id="gearSheet" role="menu" aria-label="User menu">
          <div class="gear-inner">
            <div class="section-title">Theme</div>
            <div class="chips">
              <button class="chip" data-theme="system" aria-pressed="false">System</button>
              <button class="chip" data-theme="light"  aria-pressed="false">Light</button>
              <button class="chip" data-theme="dark"   aria-pressed="false">Dark</button>
            </div>

            <div class="section-title">Profile</div>
            <div class="row"><div>Account details</div><div class="muted">Coming soon</div></div>
            <div class="row"><div>Feedback</div><div class="muted">Coming soon</div></div>
            <div class="row"><div>Security</div><div class="muted">Coming soon</div></div>

            <div class="section-title">Maintenance</div>
            <div class="row" id="btnUpdateAll" aria-busy="false">
              <div>Check for updates (also clears cache)</div>
              <div id="updIcon">↻</div>
            </div>
          </div>
        </div>
      </div>
    `;

    this._root = r;
    this.$ = (s) => r.querySelector(s);

    this._initVersion();
    this._initFooterDate();
    const logo = this.$("#farmLogo"); if (logo) logo.src = "/Farm-vista/assets/icons/logo.png";
  }

  /* ===== Toasts & spinners ===== */
  _showToast(msg, ms=2200){
    let el = this._root.getElementById('fvToast');
    if(!el){
      el = document.createElement('div');
      el.id = 'fvToast';
      el.style.cssText = `
        position:fixed; left:50%; top:70px; transform:translateX(-50%);
        z-index:2000; background:rgba(0,0,0,.85); color:#fff;
        padding:10px 12px; border-radius:10px; font-size:14px;
        box-shadow:0 8px 18px rgba(0,0,0,.25); transition:opacity .18s ease;
      `;
      this._root.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(()=>{ el.style.opacity='0'; }, ms);
  }
  _setUpdating(isOn){
    const row = this.$('#btnUpdateAll');
    const ico = this.$('#updIcon');
    if(!row || !ico) return;
    row.setAttribute('aria-busy', String(isOn));
    row.style.pointerEvents = isOn ? 'none' : '';
    ico.innerHTML = isOn ? '<span class="spin" aria-hidden="true"></span>' : '↻';
  }

  connectedCallback(){
    // Lock global scroll (prevents gray bounce above/below on iOS)
    const GL_ID = "fv-global-lock-style";
    if (!document.getElementById(GL_ID)) {
      const g = document.createElement("style");
      g.id = GL_ID;
      g.textContent = `html, body { height:100%; margin:0; overflow:hidden; overscroll-behavior:none; -webkit-overflow-scrolling:auto; }`;
      document.head.appendChild(g);
    }

    const shell = this.$(".shell");
    const scrim = this.$("#scrim");
    const btnMenu = this.$("#btnMenu");
    const btnGear = this.$("#btnGear");
    const gear = this.$("#gearSheet");
    const offlineBanner = this.$("#offlineBanner");

    const isDesktop = () => matchMedia("(min-width:1024px)").matches;

    const closeOverlays = () => {
      shell.classList.remove("mobile-open");
      scrim.classList.remove("show");
      gear.classList.remove("show");
      btnGear.setAttribute("aria-expanded","false");
    };

    const applySidebarState = () => {
      if (isDesktop()) { closeOverlays(); shell.classList.remove("expanded"); }
      else { shell.classList.remove("expanded"); }
    };
    applySidebarState();
    addEventListener("resize", applySidebarState);

    btnMenu.addEventListener("click", () => {
      if (isDesktop()) shell.classList.toggle("expanded");
      else {
        const open = !shell.classList.contains("mobile-open");
        shell.classList.toggle("mobile-open", open);
        scrim.classList.toggle("show", open);
        if (open) gear.classList.remove("show");
      }
    });

    // open/close the settings sheet
    btnGear.addEventListener("click", () => {
      const open = !gear.classList.contains("show");
      gear.classList.toggle("show", open);
      btnGear.setAttribute("aria-expanded", String(open));
      scrim.classList.toggle("show", open);
      if (open) shell.classList.remove("mobile-open");
    });
    scrim.addEventListener("click", closeOverlays);

    // Theme chips
    const reflect = () => {
      const m = localStorage.getItem("fv-theme") || "system";
      this._root.querySelectorAll('.chip[data-theme]').forEach(ch=>{
        ch.setAttribute("aria-pressed", String(ch.getAttribute("data-theme")===m));
      });
      const root=document.documentElement;
      root.classList.remove("dark");
      if (m==="dark") root.classList.add("dark");
      else if (m==="system" && matchMedia('(prefers-color-scheme: dark)').matches) root.classList.add("dark");
    };
    this._root.querySelectorAll('.chip[data-theme]').forEach(ch=>{
      ch.addEventListener('click', ()=>{
        localStorage.setItem("fv-theme", ch.getAttribute("data-theme")||"system");
        reflect();
      });
    });
    reflect();

    // Offline banner
    const onOffline = () => offlineBanner?.classList.add("show");
    const onOnline  = () => offlineBanner?.classList.remove("show");
    addEventListener("offline", onOffline);
    addEventListener("online", onOnline);
    if (!navigator.onLine) onOffline();

    // One-button update action
    this.$("#btnUpdateAll")?.addEventListener("click", () => this._checkForUpdatesAndRefresh());

    // Dev helper: auto-open sheet with ?gear=1
    if (new URLSearchParams(location.search).has("gear")) {
      setTimeout(()=>btnGear.click(), 80);
    }

    // Service worker
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/Farm-vista/serviceworker.js").catch(()=>{});
    }

    // Post-reload outcome toast
    const post = sessionStorage.getItem('fv-postUpdateMsg');
    if (post) {
      this._showToast(post, 2600);
      sessionStorage.removeItem('fv-postUpdateMsg');
    }
  }

  /* ===== Version + date ===== */
  _initVersion(){
    const v=this.$("#ver"), t=this.$("#tagline");
    const num=(window.FarmVistaVersion)||(window.FV_VERSION&&window.FV_VERSION.number)||"1.0.0";
    const tag=(window.FV_TAGLINE)||(window.FV_VERSION&&window.FV_VERSION.tagline)||"Clean farm data. Smarter reporting.";
    if (v) v.textContent = `v${num}`;
    if (t) t.textContent = tag;
  }
  _initFooterDate(){
    const el=this.$("#footLine"); if(!el) return;
    const now=this._fmt(new Date());
    const yr=new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",year:"numeric"}).format(new Date());
    el.textContent = `© ${yr} FarmVista • ${now}`;
  }
  _fmt(d){
    const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",weekday:"long",month:"long",day:"numeric",year:"numeric"}).formatToParts(d);
    const map=Object.fromEntries(parts.map(p=>[p.type,p.value]));
    const n=parseInt(map.day,10);
    const s=(n%10===1&&n%100!==11)?"st":(n%10===2&&n%100!==12)?"nd":(n%10===3&&n%100!==13)?"rd":"th";
    return `${map.weekday}, ${map.month} ${n}${s}, ${map.year}`;
  }

  /* ===== Update utilities ===== */
  async _fetchLatestVersion(){
    try{
      const res  = await fetch("/Farm-vista/js/version.js?rev="+Date.now(), {cache:"no-store"});
      const text = await res.text();
      const m = text.match(/FarmVistaVersion\\s*=\\s*["']([^"']+)["']/);
      return m ? m[1] : null;
    }catch{ return null; }
  }

  async _clearCachesAndReload(latestTag){
    try{
      // show outcome after reload
      if (latestTag) sessionStorage.setItem('fv-postUpdateMsg', \`Updated & refreshed (v\${latestTag}).\`);
      else sessionStorage.setItem('fv-postUpdateMsg', 'Refreshed with latest files.');

      // unregister all SWs
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const reg of regs) { await reg.unregister(); }
      }
      // delete caches
      if ("caches" in window) {
        const keys = await caches.keys();
        for (const k of keys) { await caches.delete(k); }
      }
      // preserve theme only
      const theme = localStorage.getItem("fv-theme");
      localStorage.clear(); sessionStorage.removeItem('fv-postUpdateMsg'); // keep only our message
      // re-set post message after clear
      if (latestTag) sessionStorage.setItem('fv-postUpdateMsg', \`Updated & refreshed (v\${latestTag}).\`);
      else sessionStorage.setItem('fv-postUpdateMsg', 'Refreshed with latest files.');
      if (theme) localStorage.setItem("fv-theme", theme);

      await new Promise(r => setTimeout(r, 150)); // let SW fully release
      const stamp = latestTag || Date.now();
      location.replace(location.pathname + "?rev=" + encodeURIComponent(stamp));
    }catch(e){
      sessionStorage.setItem('fv-postUpdateMsg', 'Refreshed.');
      location.reload();
    }
  }

  async _checkForUpdatesAndRefresh(){
    this._setUpdating(true);
    this._showToast('Checking for updates…', 1200);
    const current = (window.FarmVistaVersion)||(window.FV_VERSION&&window.FV_VERSION.number)||"0.0.0";
    let latest = await this._fetchLatestVersion();
    if (!latest) latest = current || Date.now().toString();
    this._showToast('Clearing cache…', 1000);
    await this._clearCachesAndReload(latest);
    // If reload is blocked for any reason, fall back to UI reset
    setTimeout(()=>this._setUpdating(false), 4000);
  }
}
customElements.define("fv-shell", FVShell);