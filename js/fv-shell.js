/* /Farm-vista/js/fv-shell.js */
/* FarmVista Shell — v5.10.23  (Mobile Quick Camera – Side Rail • Camera Popup with Close • Strong PTR Contract)
   - Mobile-only right-edge handle with “QR Scanner” and “Camera”.
   - QR Scanner => /Farm-vista/pages/qr-scan.html (override via <html data-scan-url>).
   - Camera => FarmVista popup with:
       • Receipt Scan → if already on Expenditures Add, it triggers that page’s “Take Photo” button.
                       otherwise, navigates to Expenditures Add (quick-camera mode).
       • Grain Ticket (Coming Soon) → disabled.
   - PTR: Top-zone only, auth/context revalidation, page & data hooks, begin/end events.

   QC Capability Gate (SAFE):
   - Uses cap ids: cap-qr-scanner, cap-camera-popup
   - If neither is enabled => hide QC rail.
   - If one is enabled => show QC rail and only that item.
   - If both enabled => show both.
   - Uses FVUserContext.allowedIds OR FVUserContext.get().perms (if present) to detect caps.
   - Seatbelt override:
       ?qctest=1  -> force show rail + both
       ?qctest=0  -> force hide rail

   MENU ACL HARDENING (FIX):
   - Strict prune now allows by id OR perm OR permKey to prevent menu items disappearing when IDs change.
*/
(function () {
  // ====== TUNABLES ======
  const AUTH_MAX_MS = 5000;
  const MENU_MAX_MS = 3000;

  // Capability ids
  const CAP_QR = 'cap-qr-scanner';
  const CAP_CAMERA = 'cap-camera-popup';
  const QC_TEST_PARAM = 'qctest'; // 1 show, 0 hide

  // Figure out whether we're in beta (/Farm-vista/beta/...) or live (/Farm-vista/...)
  const FV_ROOT = location.pathname.startsWith('/Farm-vista/beta/')
    ? '/Farm-vista/beta'
    : '/Farm-vista';

  const tpl = document.createElement('template');
  tpl.innerHTML = `
  <style>
    :host{ --green:#3B7E46; --gold:#D0C542; --hdr-h:56px; --ftr-h:14px;
      display:block; color:#141514; background:#fff; min-height:100vh; position:relative; }
    .hdr{ position:fixed; inset:0 0 auto 0; height:calc(var(--hdr-h) + env(safe-area-inset-top,0px));
      padding-top:env(safe-area-inset-top,0px); background:var(--green); color:#fff;
      display:grid; grid-template-columns:56px 1fr 56px; align-items:center; z-index:1000; box-shadow:0 2px 0 rgba(0,0,0,.05); }
    .hdr .title{ text-align:center; font-weight:800; font-size:20px; display:flex; align-items:center; justify-content:center; gap:8px; }
    .beta-pill{
      padding:2px 8px;
      border-radius:999px;
      font-size:11px;
      font-weight:800;
      letter-spacing:.06em;
      text-transform:uppercase;
      background:rgba(239,68,68,0.95);
      color:#fff;
      border:1px solid rgba(0,0,0,0.18);
      box-shadow:0 0 0 1px rgba(0,0,0,0.06);
    }
    .iconbtn{ display:grid; place-items:center; width:48px; height:48px; border:none; background:transparent; color:#fff; font-size:28px; line-height:1; -webkit-tap-highlight-color: transparent; margin:0 auto;}
    .iconbtn svg{ width:26px; height:26px; display:block; }
    .gold-bar{ position:fixed; top:calc(var(--hdr-h) + env(safe-area-inset-top,0px)); left:0; right:0; height:3px; background:var(--gold); z-index:999; }

    .boot{ position:fixed; inset:0; z-index:2000; display:flex; align-items:center; justify-content:center;
      background:color-mix(in srgb, #000 25%, transparent);
      backdrop-filter: blur(6px) saturate(1.1); -webkit-backdrop-filter: blur(6px) saturate(1.1);
      color:#fff; transition: opacity .22s ease, visibility .22s ease; }
    .boot[hidden]{ opacity:0; visibility:hidden; pointer-events:none; }
    .boot-card{ background: rgba(21,23,21,.85); border:1px solid rgba(255,255,255,.14); border-radius:14px; padding:18px 20px;
      box-shadow:0 18px 44px rgba(0,0,0,.4); display:flex; align-items:center; gap:12px; font-weight:800;}
    .spin{ width:18px; height:18px; border-radius:50%; border:2.25px solid rgba(255,255,255,.35); border-top-color:#fff; animation:spin .8s linear infinite; }
    @keyframes spin{ to{ transform:rotate(360deg); } }

    .ptr{ position:fixed; top:calc(var(--hdr-h) + env(safe-area-inset-top,0px) + 3px); left:0; right:0; height:54px; background:var(--surface,#fff);
      color:var(--text,#111); border-bottom:1px solid var(--border,#e4e7e4); display:flex; align-items:center; justify-content:center; gap:10px;
      z-index:998; transform:translateY(-56px); transition:transform .16s ease; will-change: transform, opacity; pointer-events:none; }
    .ptr.show{ transform:translateY(0); }
    .ptr .spinner{ width:18px;height:18px;border-radius:50%; border:2.25px solid #c9cec9;border-top-color:var(--green,#3B7E46); animation:spin 800ms linear infinite; }
    .ptr .dot{ width:10px; height:10px; border-radius:50%; background:var(--green,#3B7E46); }
    .ptr .txt{ font-weight:800; }

    .ftr{ position:fixed; inset:auto 0 0 0; height:calc(var(--ftr-h) + env(safe-area-inset-bottom,0px));
      padding-bottom:env(safe-area-inset-bottom,0px); background:var(--green); color:#fff;
      display:flex; align-items:center; justify-content:center; border-top:2px solid var(--gold); z-index:900; }
    .ftr .text{ font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

    .main{ position:relative; padding:
        calc(var(--hdr-h) + env(safe-area-inset-top,0px) + 11px) 16px
        calc(var(--ftr-h) + env(safe-area-inset-bottom,0px) + 16px);
      min-height:100vh; box-sizing:border-box; background: var(--bg); color: var(--text); }
    ::slotted(.container){ max-width:980px; margin:0 auto; }

    .scrim{ position:fixed; inset:0; background:rgba(0,0,0,.45); opacity:0; pointer-events:none; transition:opacity .2s; z-index:1100; }
    :host(.drawer-open) .scrim,
    :host(.top-open) .scrim{ opacity:1; pointer-events:auto; }
    :host(.camera-open) .scrim{
      opacity:1;
      pointer-events:auto;
      background:color-mix(in srgb,#000 40%, transparent);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
    }

    .drawer{ position:fixed; top:0; bottom:0; left:0; width:min(84vw, 320px);
      background: var(--surface); color: var(--text); box-shadow: var(--shadow);
      transform:translateX(-100%); transition:transform .25s; z-index:1200; -webkit-overflow-scrolling:touch;
      display:flex; flex-direction:column; height:100%; overflow:hidden; padding-bottom:env(safe-area-inset-bottom,0px);
      border-right: 1px solid var(--border); }
    :host(.drawer-open) .drawer{ transform:translateX(0); }
    .drawer header{ padding:16px; border-bottom:1px solid var(--border); display:flex; align-items:center; gap:12px; flex:0 0 auto; background: var(--surface); }
    .org{ display:flex; align-items:center; gap:12px; }
    .org img{ width:40px; height:40px; border-radius:8px; object-fit:cover; }
    .org .org-text{ display:flex; flex-direction:column; }
    .org .org-name{ font-weight:800; line-height:1.15; }
    .org .org-loc{ font-size:13px; color:#666; }

    .drawer nav{ flex:1 1 auto; overflow:auto; background: var(--bg); }
    .drawer nav .skeleton{ padding:16px; color:#777; }
    .drawer nav a{ display:flex; align-items:center; gap:12px; padding:16px; text-decoration:none; color: var(--text); border-bottom:1px solid var(--border); }
    .drawer nav a span:first-child{ width:22px; text-align:center; opacity:.95; }

    .drawer-footer{ flex:0 0 auto; display:flex; align-items:flex-end; justify-content:space-between; gap:12px; padding:12px 16px;
      padding-bottom:calc(12px + env(safe-area-inset-bottom,0px)); border-top:1px solid var(--border);
      background: var(--surface); color: var(--text); }
    .df-left{ display:flex; flex-direction:column; align-items:flex-start; }
    .df-left .brand{ font-weight:800; line-height:1.15; }
    .df-left .slogan{ font-size:12.5px; color:#777; line-height:1.2; }
    .df-right{ font-size:13px; color:#777; white-space:nowrap; }

    .topdrawer{ position:fixed; left:0; right:0; top:0; transform:translateY(-105%); transition:transform .26s ease;
      z-index:1300; background:var(--green); color:#fff; box-shadow:0 20px 44px rgba(0,0,0,.35);
      border-bottom-left-radius:16px; border-bottom-right-radius:16px; padding-top:calc(env(safe-area-inset-top,0px) + 8px); max-height:72vh; overflow:auto; }
    :host(.top-open) .topdrawer{ transform:translateY(0); }
    .topwrap{ padding:6px 10px 14px; }
    .brandrow{ display:flex; align-items:center; justify-content:center; gap:10px; padding:10px 8px 12px 8px; }
    .brandrow img{ width:28px; height:28px; border-radius:6px; object-fit:cover; }
    .brandrow .brandname{ font-weight:800; font-size:18px; letter-spacing:.2px; }
    .section-h{ padding:12px 12px 6px; font:600 12px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif; letter-spacing:.12em; color:color-mix(in srgb,#fff 85%, transparent); }

    .chips{ padding:0 12px 10px; }
    .chip{ appearance:none; border:1.5px solid color-mix(in srgb,#fff 65%, transparent); padding:9px 14px; border-radius:20px; background:#fff; color:#111; margin-right:10px; font-weight:700; display:inline-flex; align-items:center; gap:8px; }
    .chip[aria-pressed="true"]{ outline:3px solid color-mix(in srgb,#fff 25%, transparent); background:var(--gold); color:#111; border-color:transparent; }

    .row{ display:flex; align-items:center; justify-content:space-between; padding:16px 12px; text-decoration:none; color:#fff; border-top:1px solid color-mix(in srgb,#000 22%, var(--green)); }
    .row .left{ display:flex; align-items:center; gap:14px; }
    .row .ico{ width:28px; height:28px; display:grid; place-items:center; font-size:24px; line-height:1; text-align:center; opacity:.95; }
    .row .txt{ font-size:16px; line-height:1.25; }
    .row .chev{ opacity:.9; }

    .toast{ position:fixed; left:50%; bottom:calc(var(--ftr-h) + env(safe-area-inset-bottom,0px) + 12px);
      transform:translateX(-50%); background:#111; color:#fff; padding:12px 22px; border-radius:12px; box-shadow:0 12px 32px rgba(0,0,0,.35);
      z-index:1400; font-size:14px; opacity:0; pointer-events:none; transition:opacity .18s ease, transform .18s ease;
      white-space:nowrap; min-width:320px; max-width:92vw; overflow:hidden; text-overflow:ellipsis; display:flex; align-items:center; justify-content:center; text-align:center; }
    .toast.show{ opacity:1; pointer-events:auto; transform:translateX(-50%) translateY(-4px); }

    :host(.ui-locked) .main { touch-action: none; }

    /* Quick Camera — side rail */
    .qc-rail{ position:fixed; right:0;
      bottom:calc(var(--ftr-h) + env(safe-area-inset-bottom,0px) + 75px);
      height:auto; z-index:1350; display:none; }
    @media (pointer:coarse) { .qc-rail{ display:block; } }

    .qc-handle{ position:absolute; right:0; bottom:0; width:30px; height:56px; border-top-left-radius:12px; border-bottom-left-radius:12px;
      display:grid; place-items:center; background:var(--green); color:#fff; border:1px solid color-mix(in srgb,#000 18%, transparent);
      box-shadow:0 8px 22px rgba(0,0,0,.28); transform:translateX(6px); }
    .qc-handle svg{ width:18px; height:18px; }

    .qc-panel{ position:absolute; right:30px; bottom:0; width:186px; padding:6px;
      background:var(--surface,#fff); color:var(--text,#111); border:1px solid var(--border,#e6e9e6);
      border-radius:12px; box-shadow:0 16px 36px rgba(0,0,0,.28);
      transform:translateX(12px); opacity:0; pointer-events:none; transition:transform .18s ease, opacity .18s ease; }
    .qc-rail[aria-expanded="true"] .qc-panel{ transform:translateX(0); opacity:1; pointer-events:auto; }

    .qc-item{ display:flex; align-items:center; gap:10px; padding:10px 10px; border-radius:10px; text-decoration:none; color:inherit; }
    .qc-item:hover{ background:color-mix(in srgb, var(--green) 10%, transparent); }
    .qc-ico{ width:20px; height:20px; display:grid; place-items:center; opacity:.95; }
    .qc-sep{ height:1px; background:var(--border,#e6e9e6); margin:4px 6px; border-radius:1px; }

    /* Camera popup (Receipt / Grain Ticket) */
    .camera-modal{
      position:fixed;
      inset:0;
      display:flex;
      align-items:center;
      justify-content:center;
      z-index:1500;
      pointer-events:none;
      opacity:0;
      transition:opacity .22s ease;
    }
    .camera-card{
      width:min(360px, 90vw);
      background:linear-gradient(135deg, #FFFFFF, #F3F4F6);
      border-radius:18px;
      border:1px solid rgba(0,0,0,.06);
      box-shadow:0 18px 44px rgba(0,0,0,.30);
      padding:18px 18px 16px;
      display:flex;
      flex-direction:column;
      gap:12px;
      transform:translateY(8px);
      transition:transform .22s ease, box-shadow .22s ease;
    }
    :host(.camera-open) .camera-modal{
      opacity:1;
      pointer-events:auto;
    }
    :host(.camera-open) .camera-card{
      transform:translateY(0);
      box-shadow:0 22px 52px rgba(0,0,0,.34);
    }

    .camera-head{
      display:flex;
      align-items:flex-start;
      justify-content:space-between;
      gap:8px;
    }
    .camera-title{
      font-weight:800;
      font-size:17px;
      color:#111827;
      display:flex;
      align-items:center;
      gap:8px;
    }
    .camera-title span.emoji{
      font-size:20px;
    }
    .camera-sub{
      margin:4px 0 0;
      font-size:13px;
      color:#6B7280;
    }
    .camera-close{
      border:none;
      background:transparent;
      color:#6B7280;
      width:28px;
      height:28px;
      border-radius:999px;
      display:grid;
      place-items:center;
      font-size:18px;
      cursor:pointer;
      -webkit-tap-highlight-color: transparent;
    }
    .camera-close:focus-visible{
      outline:2px solid var(--green);
      outline-offset:2px;
    }

    .camera-actions{
      display:flex;
      flex-direction:column;
      gap:8px;
      margin-top:10px;
    }
    .camera-btn{
      appearance:none;
      border-radius:14px;
      padding:10px 12px;
      border:1px solid transparent;
      background:#fff;
      display:flex;
      align-items:center;
      gap:10px;
      width:100%;
      text-align:left;
      font:600 14px/1.2 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
      cursor:pointer;
    }
    .camera-btn.primary{
      background:linear-gradient(135deg, #3B7E46, #2F6C3C);
      color:#fff;
      border-color:rgba(0,0,0,.12);
      box-shadow:0 10px 26px rgba(59,126,70,.55);
    }
    .camera-btn.primary .hint{
      color:color-mix(in srgb,#fff 82%, transparent);
    }
    .camera-btn.secondary{
      background:#E5E7EB;
      color:#6B7280;
      border-color:rgba(17,24,39,.06);
    }
    .camera-btn.secondary.disabled{
      opacity:.65;
      cursor:default;
    }
    .camera-btn .icon{
      width:26px;
      height:26px;
      display:grid;
      place-items:center;
      font-size:18px;
    }
    .camera-btn .text{
      flex:1 1 auto;
      display:flex;
      flex-direction:column;
      gap:2px;
    }
    .camera-btn .label{
      font-weight:700;
      font-size:14px;
    }
    .camera-btn .hint{
      font-weight:500;
      font-size:12px;
    }
    .camera-btn .chevron{
      font-size:18px;
      opacity:.85;
    }
    /* ===== Desktop: tighten top drawer to right side ===== */
@media (min-width: 900px) {
  .topdrawer{
    left: auto;
    right: 16px;
    width: 420px;
    max-width: calc(100vw - 32px);
    border-radius: 16px;
    top: 8px;
  }

  .topwrap{
    padding-left: 8px;
    padding-right: 8px;
  }
}

  </style>

  <header class="hdr" part="header">
    <button class="iconbtn js-menu" aria-label="Open menu">≡</button>
    <div class="title">
      <span>FarmVista</span>
      <span id="betaBadge" class="beta-pill" hidden>BETA</span>
    </div>
    <button class="iconbtn js-account" aria-label="Account" title="Account">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/>
        <circle cx="12" cy="9.2" r="3.0" fill="none" stroke="currentColor" stroke-width="1.6"/>
        <path d="M7 17.4c1.3-2.2 3.1-3.4 5-3.4s3.7 1.2 5 3.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
      </svg>
    </button>
  </header>
  <div class="gold-bar" aria-hidden="true"></div>

  <div class="boot js-boot"><div class="boot-card"><div class="spin" aria-hidden="true"></div><div>Loading. Please wait.</div></div></div>

  <div class="ptr js-ptr" aria-hidden="true">
    <div class="dot js-dot" hidden></div>
    <div class="spinner js-spin" hidden></div>
    <div class="txt js-txt">Pull to refresh</div>
  </div>

  <div class="scrim js-scrim"></div>

  <aside class="drawer" part="drawer" aria-label="Main menu">
    <header>
      <div class="org">
        <img src="/Farm-vista/assets/icons/icon-192.png" alt="" />
        <div class="org-text">
          <div class="org-name">Dowson Farms</div>
          <div class="org-loc">Divernon, Illinois</div>
        </div>
      </div>
    </header>
    <nav class="js-nav"><div class="skeleton">Loading menu…</div></nav>
    <footer class="drawer-footer">
      <div class="df-left"><div class="brand">FarmVista</div><div class="slogan js-slogan">Loading…</div></div>
      <div class="df-right"><span class="js-ver">v0.0.0</span></div>
    </footer>
  </aside>

  <section class="topdrawer js-top" role="dialog" aria-label="Account & settings">
    <div class="topwrap">
      <div class="brandrow"><img src="/Farm-vista/assets/icons/icon-192.png" alt="" /><div class="brandname">FarmVista</div></div>

      <div class="section-h">THEME</div>
      <div class="chips">
        <button class="chip js-theme" data-mode="system" aria-pressed="true">System</button>
        <button class="chip js-theme" data-mode="light"  aria-pressed="false">Light</button>
        <button class="chip js-theme" data-mode="dark"   aria-pressed="false">Dark</button>
      </div>

      <div class="section-h">PROFILE</div>
      <a class="row" id="userDetailsLink" href="/Farm-vista/pages/user-details/index.html"><div class="left"><div class="ico">🧾</div><div class="txt">User Details</div></div><div class="chev">›</div></a>
      <a class="row" id="feedbackLink" href="/Farm-vista/pages/feedback/index.html"><div class="left"><div class="ico">💬</div><div class="txt">Feedback</div></div><div class="chev">›</div></a>

      <div class="section-h">MAINTENANCE</div>
      <a class="row js-conn" href="#" tabindex="-1" aria-disabled="true" title="Shows Online only when network and cloud are both ready"><div class="left"><div class="ico">🌐</div><div class="txt">Connection: <span class="js-conn-text">Checking…</span></div></div><div class="chev">•</div></a>
      <a class="row js-update-row" href="#"><div class="left"><div class="ico">⟳</div><div class="txt">Check for updates</div></div><div class="chev">›</div></a>
      <a class="row" href="#" id="logoutRow">
        <div class="left">
          <div class="ico" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M10 4H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M14 8l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M11 12h7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <div class="txt" id="logoutLabel">Logout</div>
        </div>
        <div class="chev">›</div>
      </a>
    </div>
  </section>

  <main class="main" part="main"><slot></slot></main>
  <footer class="ftr" part="footer"><div class="text js-footer"></div></footer>

  <!-- Quick Camera: right-edge rail -->
  <div class="qc-rail js-qc" aria-expanded="false">
    <button class="qc-handle js-qc-handle" aria-label="Camera tools" title="Scan / Camera">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3.5" y="6.5" width="17" height="11" rx="2" ry="2" fill="none" stroke="currentColor" stroke-width="1.8"/>
        <path d="M8.5 8.5l2-2h3l2 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/>
      </svg>
    </button>
    <div class="qc-panel js-qc-panel" role="menu" aria-label="Camera options">
      <a href="#" class="qc-item js-qc-scan" role="menuitem"><span class="qc-ico">▣</span><span>QR Scanner</span></a>
      <div class="qc-sep js-qc-sep" aria-hidden="true"></div>
      <a href="#" class="qc-item js-qc-camera" role="menuitem"><span class="qc-ico">📷</span><span>Camera</span></a>
    </div>
  </div>

  <!-- Camera popup (Receipt / Grain Ticket) -->
  <div class="camera-modal js-camera-modal" role="dialog" aria-modal="true" aria-labelledby="cameraModalTitle">
    <div class="camera-card">
      <div class="camera-head">
        <div>
          <div class="camera-title">
            <span class="emoji">✨</span>
            <span id="cameraModalTitle">Quick Capture</span>
          </div>
          <p class="camera-sub">Choose what you’re scanning today.</p>
        </div>
        <button class="camera-close js-camera-close" type="button" aria-label="Close">
          ×
        </button>
      </div>

      <div class="camera-actions">
        <button class="camera-btn primary js-camera-receipt">
          <span class="icon">📷</span>
          <span class="text">
            <span class="label">Receipt Scan</span>
            <span class="hint">Open expense capture</span>
          </span>
          <span class="chevron">›</span>
        </button>
        <button class="camera-btn secondary disabled" disabled aria-disabled="true">
          <span class="icon">🧾</span>
          <span class="text">
            <span class="label">Grain Ticket</span>
            <span class="hint">Coming soon</span>
          </span>
          <span class="chevron">›</span>
        </button>
      </div>
    </div>
  </div>

  <div class="toast js-toast" role="status" aria-live="polite"></div>
  `;

  class FVShell extends HTMLElement {
    constructor(){
      super();
      this.attachShadow({mode:'open'}).appendChild(tpl.content.cloneNode(true));
      this._menuPainted = false;
      this._lastLogoutName = '';
      this._lastUID = '';
      this._lastRoleHash = '';
      this.LOGIN_URL = '/Farm-vista/pages/login/index.html';

      this._scrollLocked = false;
      this._scrollY = 0;
      this._isIOSStandaloneFlag = null;
      this._scrimTouchBlocker = (e)=>{ e.preventDefault(); e.stopPropagation(); };

      this._ptrDisabled = false;

      // QC caps (defaults: allow until context says otherwise)
      this._qcCaps = { qr:true, camera:true };

      // Soft retry timers
      this._softMenuRetryTimer = null;
      this._softNameRetryTimer = null;
      this._bootHoldTimer = null;


      // Toast timer
      this._toastTimer = null;
    }

    connectedCallback(){
      const r = this.shadowRoot;
      this._btnMenu = r.querySelector('.js-menu');
      this._btnAccount = r.querySelector('.js-account');
      this._scrim = r.querySelector('.js-scrim');
      this._drawer = r.querySelector('.drawer');
      this._top = r.querySelector('.js-top');
      this._footerText = r.querySelector('.js-footer');
      this._toast = r.querySelector('.js-toast');
      this._verEl = r.querySelector('.js-ver');
      this._sloganEl = r.querySelector('.js-slogan');
      this._navEl = r.querySelector('.js-nav');
      this._boot = r.querySelector('.js-boot');
      this._logoutLabel = r.getElementById('logoutLabel');
      this._connRow = r.querySelector('.js-conn');
      this._connTxt = r.querySelector('.js-conn-text');
      this._betaBadge = r.getElementById('betaBadge');

      /* QC refs */
      this._qcRail   = r.querySelector('.js-qc');
      this._qcHandle = r.querySelector('.js-qc-handle');
      this._qcPanel  = r.querySelector('.js-qc-panel');
      this._qcScan   = r.querySelector('.js-qc-scan');
      this._qcSep    = r.querySelector('.js-qc-sep');
      this._qcCamera = r.querySelector('.js-qc-camera');

      /* Camera popup refs */
      this._cameraModal      = r.querySelector('.js-camera-modal');
      this._cameraReceiptBtn = r.querySelector('.js-camera-receipt');
      this._cameraCloseBtn   = r.querySelector('.js-camera-close');

      // Beta detection: show badge only when running under /Farm-vista/beta/...
      const isBeta = (FV_ROOT === '/Farm-vista/beta');
      if (isBeta && this._betaBadge) {
        this._betaBadge.hidden = false;
      }

      if (this._boot) this._boot.hidden = false;

      this._btnMenu.addEventListener('click', ()=> { this.toggleTop(false); this.toggleDrawer(true); });
      this._scrim.addEventListener('click', ()=> {
        this.toggleDrawer(false);
        this.toggleTop(false);
        this._qcToggle(false);
        this._closeCameraModal();
      });
      this._btnAccount.addEventListener('click', ()=> { this.toggleDrawer(false); this.toggleTop(); this._qcToggle(false); this._closeCameraModal(); });
      document.addEventListener('keydown', (e)=>{ if(e.key==='Escape'){ this.toggleDrawer(false); this.toggleTop(false); this._qcToggle(false); this._closeCameraModal(); } });

      r.querySelectorAll('.js-theme').forEach(btn=> btn.addEventListener('click', ()=> this.setTheme(btn.dataset.mode)));
      document.addEventListener('fv:theme', (e)=> this._syncThemeChips(e.detail.mode));
      this._syncThemeChips((window.App && App.getTheme && App.getTheme()) || 'system');

      const now = new Date();
      const dateStr = now.toLocaleDateString(undefined, { weekday:'long', year:'numeric', month:'long', day:'numeric' });
      this._footerText.textContent = `© ${now.getFullYear()} FarmVista • ${dateStr}`;

      this._bootSequence();

      window.addEventListener('orientationchange', ()=>{ this._setScrollLock(false); }, { passive:true });
      window.addEventListener('resize', ()=>{ if (this._scrollLocked) this._applyBodyFixedStyles(); }, { passive:true });

      /* QC init */
      this._initQuickCamera();
      this._qcApplyFromContext('connect');

      /* Camera popup – Receipt Scan behavior */
      if (this._cameraReceiptBtn) {
        this._cameraReceiptBtn.addEventListener('click', (e)=>{
          e.preventDefault();

          // Always close the popup first
          this._closeCameraModal();

          const addPathFragment = '/pages/expenses/expenditures/expenditures-add.html';
          const onAddPage = location.pathname.includes(addPathFragment);
          const btnTake = document.getElementById('btnTake');

          if (onAddPage && btnTake) {
            // Already on Expenditures Add → behave exactly like tapping "Take Photo"
            btnTake.click();
            return;
          }

          // Otherwise, navigate to Expenditures Add in quick-camera mode.
          const target = '/Farm-vista/pages/expenses/expenditures/expenditures-add.html?src=quick-camera';
          location.href = target;
        });
      }

      /* Camera popup – Close X */
      if (this._cameraCloseBtn) {
        this._cameraCloseBtn.addEventListener('click', (e)=>{
          e.preventDefault();
          this._closeCameraModal();
        });
      }
    }

    /* ============================== */
    /* Toast helper (FIX)             */
    /* ============================== */
    _toastMsg(message, ms = 1600) {
      try {
        const el = this._toast || (this.shadowRoot && this.shadowRoot.querySelector('.js-toast'));
        if (!el) return;

        const msg = (message == null) ? '' : String(message);
        el.textContent = msg;

        el.classList.add('show');

        if (this._toastTimer) {
          clearTimeout(this._toastTimer);
          this._toastTimer = null;
        }

        const dur = Math.max(400, Number(ms) || 0);
        this._toastTimer = setTimeout(() => {
          el.classList.remove('show');
          this._toastTimer = null;
        }, dur);
      } catch (e) {
        console.warn('[FV] toast failed:', e);
      }
    }

    /* ----------------- QC helpers (SAFE) ----------------- */

    _qcForceMode(){
      try{
        const u = new URL(location.href);
        const v = u.searchParams.get(QC_TEST_PARAM);
        if (v === '1') return 'show';
        if (v === '0') return 'hide';
      }catch{}
      return null;
    }

    _getUserCtx(){
      try{
        return window.FVUserContext && window.FVUserContext.get && window.FVUserContext.get();
      }catch{ return null; }
    }

    _capEnabled(capId){
      const ctx = this._getUserCtx();
      if (!ctx) return false;

      // 1) allowedIds list
      try{
        const ids = Array.isArray(ctx.allowedIds) ? ctx.allowedIds : [];
        if (ids.includes(capId)) return true;
      }catch{}

      // 2) perms map (if your context exposes it)
      try{
        const perms = ctx.perms || ctx.permissions || null;
        if (perms && typeof perms === 'object' && perms[capId]) {
          const v = perms[capId];
          if (typeof v === 'boolean') return v;
          if (v && typeof v.view === 'boolean') return !!v.view;
          if (v && typeof v.on === 'boolean') return !!v.on;
        }
      }catch{}

      return false;
    }

    _qcApplyFromContext(reason){
      if (!this._qcRail) return;

      // mobile only guard
      const isCoarse = window.matchMedia && window.matchMedia('(pointer:coarse)').matches;
      if (!isCoarse){
        this._qcRail.style.display = 'none';
        return;
      }

      const force = this._qcForceMode();
      if (force === 'hide'){
        this._qcToggle(false);
        this._closeCameraModal();
        this._qcRail.style.display = 'none';
        return;
      }
      if (force === 'show'){
        this._qcCaps = { qr:true, camera:true };
        this._qcRail.style.display = 'block';
        if (this._qcScan) this._qcScan.style.display = '';
        if (this._qcCamera) this._qcCamera.style.display = '';
        if (this._qcSep) this._qcSep.style.display = '';
        return;
      }

      const ctx = this._getUserCtx();
      if (!ctx){
        // ✅ safer boot behavior: hide rail until context arrives (prevents “everything shows” flicker)
        this._qcToggle(false);
        this._closeCameraModal();
        this._qcRail.style.display = 'none';
        return;
      }

      const qrOn = this._capEnabled(CAP_QR);
      const camOn = this._capEnabled(CAP_CAMERA);

      this._qcCaps = { qr: !!qrOn, camera: !!camOn };

      // close open panel if items change
      this._qcToggle(false);

      if (!qrOn && !camOn){
        this._closeCameraModal();
        this._qcRail.style.display = 'none';
        return;
      }

      this._qcRail.style.display = 'block';
      if (this._qcScan) this._qcScan.style.display = qrOn ? '' : 'none';
      if (this._qcCamera) this._qcCamera.style.display = camOn ? '' : 'none';
      if (this._qcSep) this._qcSep.style.display = (qrOn && camOn) ? '' : 'none';
    }

    _isIOSStandalone(){
      if (this._isIOSStandaloneFlag != null) return this._isIOSStandaloneFlag;
      const ua = (navigator.userAgent || '').toLowerCase();
      const isIOS = /iphone|ipad|ipod/.test(ua);
      const isStandalone = (window.navigator.standalone === true) ||
        (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
      this._isIOSStandaloneFlag = !!(isIOS && isStandalone);
      return this._isIOSStandaloneFlag;
    }
     /* ============================== */
/* Boot overlay hold (page-only)  */
/* ============================== */
_bootHoldMs(){
  try{
    // <fv-shell data-boot-hold-ms="1500">
    const raw = this.getAttribute('data-boot-hold-ms');
    const n = Number(raw);
    if (!isFinite(n)) return 0;
    return Math.max(0, Math.min(60000, Math.floor(n))); // clamp 0..60s
  }catch{
    return 0;
  }
}

_hideBootOverlayWithOptionalHold(){
  try{
    if (!this._boot) return;

    if (this._bootHoldTimer){
      clearTimeout(this._bootHoldTimer);
      this._bootHoldTimer = null;
    }

    const hold = this._bootHoldMs();
    if (hold > 0){
      // Keep visible a bit longer for this page only
      this._boot.hidden = false;
      this._bootHoldTimer = setTimeout(()=>{
        try{ if (this._boot) this._boot.hidden = true; }catch(_){}
        this._bootHoldTimer = null;
      }, hold);
      return;
    }

    // default behavior
    this._boot.hidden = true;
  }catch(_){}
}

    /* =============================== */
    /* Boot: phased, auth-only hard gate */
    /* =============================== */

    async _bootSequence(){
      await this._loadScriptOnce('/Farm-vista/js/version.js').catch(()=>{});
      this._applyVersionToUI();

      await this._loadScriptOnce('/Farm-vista/js/firebase-config.js').catch(()=>{});
      await this._ensureFirebaseInit();

      await this._loadScriptOnce('/Farm-vista/js/app/user-context.js').catch(()=>{});
      await this._loadScriptOnce('/Farm-vista/js/menu-acl.js').catch(()=>{});

      // Phase A (hard): auth only
      const authed = await this._requireAuthOnly();
      if (!authed) {
        this._kickToLogin('auth-timeout');
        return;
      }

      // Wire the rest ASAP; do NOT block on context/menu readiness
      this._wireAuthLogout(this.shadowRoot);
      this._initConnectionStatus();
      this._watchUserContextForSwaps();

      // Hide overlay as soon as auth is confirmed (menu/context can finish in background)
      this._hideBootOverlayWithOptionalHold();
      sessionStorage.setItem('fv:boot:hydrated', '1');

      const upd = this.shadowRoot.querySelector('.js-update-row');
      if (upd) upd.addEventListener('click', (e)=> { e.preventDefault(); this.checkForUpdates(); });

      const r = this.shadowRoot;
      const ud = r.getElementById('userDetailsLink'); if (ud) ud.addEventListener('click', () => { this.toggleTop(false); });
      const fb = r.getElementById('feedbackLink'); if (fb) fb.addEventListener('click', () => { this.toggleTop(false); });

      this._initPTR();

      // Phase B/C (soft): wait for context; render menu when possible; keep retrying without redirect
      this._softWaitForCtxAndMenu('boot');

      // Post paint: repair only (no redirect)
      setTimeout(()=> this._postPaintSanity(), 300);
    }

    async _requireAuthOnly(){
      const deadline = Date.now() + AUTH_MAX_MS;
      while (Date.now() < deadline) {
        if (await this._isAuthed()) return true;
        await this._sleep(120);
      }
      return !!(await this._isAuthed());
    }

    async _softWaitForCtxAndMenu(reason){
      // If context already present, render now
      if (this._hasUserCtx()){
        try{
          const { uid, roleHash } = this._currentUIDAndRoleHash();
          this._lastUID = uid; this._lastRoleHash = roleHash;
        }catch{}
        try { await this._initMenuFiltered(); } catch {}
        this._setLogoutLabelNow();
        this._qcApplyFromContext(reason || 'ctx-ready');
        return;
      }

      // Otherwise: soft loop (no redirect)
      const deadline = Date.now() + Math.max(MENU_MAX_MS, 3000);
      while (Date.now() < deadline) {
        if (this._hasUserCtx()) break;
        await this._sleep(150);
      }

      if (this._hasUserCtx()){
        try{
          const { uid, roleHash } = this._currentUIDAndRoleHash();
          this._lastUID = uid; this._lastRoleHash = roleHash;
        }catch{}
        try { await this._initMenuFiltered(); } catch {}
        this._setLogoutLabelNow();
        this._qcApplyFromContext('ctx-ready');
        return;
      }

      // Still no context: keep skeleton and schedule a retry; never kick to login for “slow”
      this._scheduleMenuRetry(650, 'soft-ctx-wait');
      this._scheduleNameRetry(650, 'soft-ctx-wait');
      this._qcApplyFromContext('ctx-missing');
    }

    _scheduleMenuRetry(ms=650, why='retry'){
      clearTimeout(this._softMenuRetryTimer);
      this._softMenuRetryTimer = setTimeout(async ()=>{
        // If auth is gone, *then* redirect
        if (!(await this._isAuthed())) { this._kickToLogin('auth-missing'); return; }
        try { await this._initMenuFiltered(); } catch {}
        if (!this._hasMenuLinks() && !this._hasUserCtx()) {
          // still not ready; try again
          this._scheduleMenuRetry(900, 'retry-loop');
        }
      }, ms);
    }

    _scheduleNameRetry(ms=650, why='retry'){
      clearTimeout(this._softNameRetryTimer);
      this._softNameRetryTimer = setTimeout(async ()=>{
        if (!(await this._isAuthed())) { this._kickToLogin('auth-missing'); return; }
        this._setLogoutLabelNow();
        const nameOK = (this._logoutLabel && this._logoutLabel.textContent && this._logoutLabel.textContent.trim() !== 'Logout');
        if (!nameOK && !this._hasUserCtx()){
          this._scheduleNameRetry(900, 'retry-loop');
        }
      }, ms);
    }

    async _authAndMenuGate(){
      // Kept for compatibility if anything still calls it, but now:
      // ✅ auth is the only hard gate
      const ok = await this._requireAuthOnly();
      if (!ok) {
        this._kickToLogin('auth-timeout');
        return Promise.reject('auth-timeout');
      }

      // Soft: try to paint menu / name without redirects
      this._softWaitForCtxAndMenu('legacy-gate');
      return true;
    }

    _kickToLogin(reason){
      try{
        const url = new URL(this.LOGIN_URL, location.origin);
        url.searchParams.set('reason', reason || 'guard');
        url.searchParams.set('next', location.pathname + location.search + location.hash);
        location.replace(url.toString());
      }catch{ location.replace(this.LOGIN_URL); }
    }

    async _ensureFirebaseInit(){
      try {
        if (!window.__FV_FIREBASE_INIT_LOADED__) {
          window.__FV_FIREBASE_INIT_LOADED__ = true;
          await this._loadScriptOnce('/Farm-vista/js/firebase-init.js', { type:'module' });
        }
      } catch {}
    }

    async _isAuthed(){
      try{
        const mod = await import('/Farm-vista/js/firebase-init.js');
        const ctx = await mod.ready;
        const auth = (ctx && ctx.auth) || window.firebaseAuth || null;
        return !!(auth && auth.currentUser);
      }catch{ return false; }
    }

    _hasUserCtx(){
      try{
        const u = window.FVUserContext && window.FVUserContext.get && window.FVUserContext.get();
        return !!u;
      }catch{ return false; }
    }

    _hasMenuLinks(){
      const nav = this._navEl;
      if (!nav) return false;
      return nav.querySelectorAll('a[href]').length > 0;
    }

    _setLogoutLabelNow(){
      const logoutLabel = this._logoutLabel; if (!logoutLabel) return;
      let name = '';
      try{
        const ctx = window.FVUserContext && window.FVUserContext.get && window.FVUserContext.get();
        if (ctx && (ctx.displayName || ctx.email)) name = ctx.displayName || ctx.email;
      }catch{}
      try{
        if (!name && window.firebaseAuth && window.firebaseAuth.currentUser) {
          const u = window.firebaseAuth.currentUser;
          name = u && (u.displayName || u.email) || '';
        }
      }catch{}
      if (name) this._lastLogoutName = name;
      logoutLabel.textContent = (this._lastLogoutName || name) ? `Logout ${this._lastLogoutName || name}` : 'Logout';
    }

    _sleep(ms){ return new Promise(r=> setTimeout(r, ms)); }

    _applyVersionToUI(){
      const v = (window && window.FV_VERSION) || {};
      const num = (v.number || '').toString().replace(/^\s*v/i,'').trim() || '0.0.0';
      const tag = (v.tagline || 'Simplified');
      if (this._verEl) this._verEl.textContent = `v${num}`;
      if (this._sloganEl) this._sloganEl.textContent = tag;
    }

    _loadScriptOnce(src, opts){
      return new Promise((resolve, reject)=>{
        const exists = Array.from(document.scripts).some(s=> (s.getAttribute('src')||'') === src);
        if (exists) { resolve(); return; }
        const s = document.createElement('script');
        if (opts && opts.type) s.type = opts.type;
        s.defer = true;
        s.src = src;
        s.onload = ()=> resolve();
        s.onerror = (e)=> reject(e);
        document.head.appendChild(s);
      });
    }

    _watchUserContextForSwaps(){
      const update = async ()=>{
        const { uid, roleHash } = this._currentUIDAndRoleHash();
        const changed = (!!uid && uid !== this._lastUID) || (!!roleHash && roleHash !== this._lastRoleHash);

        // Always keep QC rail synced to current context
        this._qcApplyFromContext(changed ? 'ctx-swap' : 'ctx-ping');

        // Soft behavior: if context is missing, just keep trying to render later
        if (!this._hasUserCtx()){
          this._scheduleMenuRetry(650, 'ctx-missing');
          this._scheduleNameRetry(650, 'ctx-missing');
          return;
        }

        if (!changed) {
          // Still allow late menu/name repairs
          if (!this._hasMenuLinks()) this._scheduleMenuRetry(450, 'menu-late');
          const nameOK = (this._logoutLabel && this._logoutLabel.textContent && this._logoutLabel.textContent.trim() !== 'Logout');
          if (!nameOK) this._scheduleNameRetry(450, 'name-late');
          return;
        }

        sessionStorage.removeItem('fv:boot:hydrated');
        if (this._boot) this._boot.hidden = false;

        this._clearMenuStateFor(this._lastUID, this._lastRoleHash);
        this._paintSkeleton();

        this._lastUID = uid;
        this._lastRoleHash = roleHash;
        this._menuPainted = false;

        // Render menu; no redirects if links aren't ready yet
        try { await this._initMenuFiltered(); } catch {}
        this._scheduleMenuRetry(450, 'ctx-swap');
        this._setLogoutLabelNow();

        if (this._boot) this._boot.hidden = true;
        sessionStorage.setItem('fv:boot:hydrated', '1');
      };

      try { if (window.FVUserContext && typeof window.FVUserContext.onChange === 'function') window.FVUserContext.onChange(update); } catch {}
    }

    _paintSkeleton(){
      if (!this._navEl) return;
      this._navEl.innerHTML = `<div class="skeleton">Loading menu…</div>`;
      this._collapseAllNavGroups();
    }

    _clearMenuStateFor(uid, roleHash){
      try {
        const key = this._navStateKeyFor(uid, roleHash);
        if (key) localStorage.removeItem(key);
      } catch {}
    }

    _currentUIDAndRoleHash(){
      let uid = '';
      try {
        const auth = (window.firebaseAuth) || null;
        if (auth && auth.currentUser && auth.currentUser.uid) uid = auth.currentUser.uid;
      } catch {}
      let roleHash = '';
      try {
        const ctx = window.FVUserContext && window.FVUserContext.get && window.FVUserContext.get();
        const ids = (ctx && Array.isArray(ctx.allowedIds)) ? ctx.allowedIds : [];
        roleHash = this._hashIDs(ids);
      } catch {}
      return { uid, roleHash };
    }

    _hashIDs(arr){
      const s = (arr||[]).slice().sort().join('|');
      let h = 5381; for (let i=0;i<s.length;i++) { h = ((h<<5)+h) ^ s.charCodeAt(i); }
      return ('h' + (h>>>0).toString(36));
    }

    _navStateKeyFor(uid, roleHash){
      if (!uid) return null;
      return `fv:nav:groups:${uid}:${roleHash||'no-role'}`;
    }

    async _loadMenu(){
      // ✅ stable import (no Date.now cache bust). Beta/live aware.
      const primary = `${FV_ROOT}/js/menu.js`;
      const fallback = `/Farm-vista/js/menu.js`;

      try{
        const mod = await import(primary);
        return (mod && (mod.NAV_MENU || mod.default)) || null;
      }catch(e1){
        try{
          const mod2 = await import(fallback);
          return (mod2 && (mod2.NAV_MENU || mod2.default)) || null;
        }catch(e2){
          // Final fallback: script tag (still stable URL)
          const url = primary;
          try{
            await new Promise((res, rej)=>{
              const s = document.createElement('script');
              s.src = url; s.defer = true; s.onload = ()=> res(); s.onerror = (err)=> rej(err);
              document.head.appendChild(s);
            });
            return (window && window.FV_MENU) || null;
          }catch(err){
            console.error('[FV] Unable to load menu:', err);
            return null;
          }
        }
      }
    }

    _countLinks(cfg){
      let n = 0;
      const walk = (nodes)=> (nodes||[]).forEach(it=>{
        if (it.type === 'link') n++;
        if (it.children) walk(it.children);
      });
      walk(cfg && cfg.items);
      return n;
    }

    _collectAllLinks(cfg){
      const out = [];
      const walk = (nodes)=> (nodes||[]).forEach(it=>{
        if (it.type === 'link') out.push(it);
        if (it.children) walk(it.children);
      });
      walk(cfg && cfg.items);
      return out;
    }

    _looksLikeHome(link){
      const id = (link.id||'').toLowerCase();
      const lbl = (link.label||'').toLowerCase();
      const href = (link.href||'');
      const p = href ? new URL(href, location.href).pathname : '';
      if (id.includes('home') || id.includes('dashboard')) return true;
      if (lbl.includes('home') || lbl.includes('dashboard')) return true;
      return (p === '/Farm-vista/' || p === '/Farm-vista/index.html');
    }

    /* ============================================================
       STRICT MENU SEATBELT (HARDENED):
       - After FVMenuACL.filter(), prune any link whose id is NOT in allowedIds.
       - Prevents “parent group allowed => all children show” bugs.
       - Removes empty groups after pruning.
       - Hardened: allow by id OR perm OR permKey (prevents renames breaking menus)
       ============================================================ */

    _menuAllowed(item, set){
      if (!item) return false;

      // Always keep Home-ish links
      if (this._looksLikeHome(item)) return true;

      const id      = (item.id != null) ? String(item.id) : '';
      const perm    = (item.perm != null) ? String(item.perm) : '';
      const permKey = (item.permKey != null) ? String(item.permKey) : '';

      if (id && set.has(id)) return true;
      if (perm && set.has(perm)) return true;
      if (permKey && set.has(permKey)) return true;

      return false;
    }

    _strictPruneMenuByAllowedIds(cfg, allowedIds){
      const set = new Set(Array.isArray(allowedIds) ? allowedIds.map(x => String(x)) : []);

      const clone = (obj)=> {
        try { return JSON.parse(JSON.stringify(obj)); } catch { return obj; }
      };

      const walkNodes = (nodes)=>{
        const out = [];
        (nodes||[]).forEach(it=>{
          if (!it || typeof it !== 'object') return;

          if (it.type === 'link'){
            if (this._menuAllowed(it, set)) {
              out.push(it);
            } else {
              try{
                console.warn('[FV ACL] menu hidden:', it.label, 'id=', it.id, 'perm=', it.perm, 'permKey=', it.permKey);
              }catch{}
            }
            return;
          }

          if (it.type === 'group'){
            const kids = walkNodes(it.children || []);
            if (kids.length){
              const g2 = clone(it);
              g2.children = kids;
              out.push(g2);
            }
            return;
          }
        });
        return out;
      };

      const base = (cfg && cfg.items) ? cfg : { items: [] };
      const pruned = clone(base);
      pruned.items = walkNodes(base.items || []);
      return pruned;
    }

    async _initMenuFiltered(){
      const NAV_MENU = await this._loadMenu();
      if (!NAV_MENU || !Array.isArray(NAV_MENU.items)) return;

      const ctx = (window.FVUserContext && window.FVUserContext.get && window.FVUserContext.get()) || null;
      const allowedIds = (ctx && Array.isArray(ctx.allowedIds)) ? ctx.allowedIds : [];

      if (!this._menuPainted && allowedIds.length === 0) { this._paintSkeleton(); return; }
      if (this._menuPainted && allowedIds.length === 0) return;

      const filtered = (window.FVMenuACL && window.FVMenuACL.filter)
        ? window.FVMenuACL.filter(NAV_MENU, allowedIds)
        : NAV_MENU;

      const filteredStrict = this._strictPruneMenuByAllowedIds(filtered, allowedIds);

      let cfgToRender = filteredStrict;
      let linkCount = this._countLinks(filteredStrict);

      if (linkCount === 0 && allowedIds.length > 0) {
        const allLinks = this._collectAllLinks(NAV_MENU);
        const set = new Set(allowedIds.map(x => String(x)));

        const rescued = allLinks.filter(l => this._menuAllowed(l, set));

        const homeLink = allLinks.find(l => this._looksLikeHome(l));
        if (homeLink && !rescued.includes(homeLink)) rescued.unshift(homeLink);

        cfgToRender = {
          items: rescued.map(l => ({
            type:'link',
            id:l.id,
            perm:l.perm,
            permKey:l.permKey,
            label:l.label,
            href:l.href,
            icon:l.icon,
            activeMatch:l.activeMatch
          }))
        };
      } else {
        const alreadyHasHome = (()=> {
          const links = this._collectAllLinks(filteredStrict);
          return links.some(l => this._looksLikeHome(l));
        })();

        if (!alreadyHasHome) {
          const allLinks = this._collectAllLinks(NAV_MENU);
          const homeLink = allLinks.find(l => this._looksLikeHome(l));
          if (homeLink) {
            cfgToRender = {
              items: [{
                type:'link',
                id:homeLink.id,
                perm:homeLink.perm,
                permKey:homeLink.permKey,
                label:homeLink.label,
                href:homeLink.href,
                icon:homeLink.icon,
                activeMatch:homeLink.activeMatch
              }].concat((filteredStrict.items||[]))
            };
          }
        }
      }

      this._renderMenu(cfgToRender);
      this._menuPainted = true;
    }

    _renderMenu(cfg){
      const nav = this._navEl; if (!nav) return;
      nav.innerHTML = '';

      const path = location.pathname;
      const { uid, roleHash } = this._currentUIDAndRoleHash();
      const stateKey = (cfg.options && cfg.options.stateKey) || this._navStateKeyFor(uid, roleHash) || 'fv:nav:groups';
      this._navStateKey = stateKey;
      let groupState = {};
      try { groupState = JSON.parse(localStorage.getItem(stateKey) || '{}'); } catch {}

      const pad = (depth)=> `${16 + (depth * 18)}px`;

      const mkLink = (item, depth=0) => {
        const a = document.createElement('a');

        // Normalize href: if it starts with /Farm-vista/, remap it to FV_ROOT
        let href = item.href || '#';
        if (href.startsWith('/Farm-vista/')) {
          href = FV_ROOT + href.substring('/Farm-vista'.length);
        }
        a.href = href;

        a.innerHTML = `<span>${item.icon||''}</span> ${item.label}`;
        a.style.paddingLeft = pad(depth);
        const mode = item.activeMatch || 'starts-with';
        const hrefPath = new URL(a.href, location.href).pathname;
        if ((mode==='exact' && path === hrefPath) || (mode!=='exact' && item.href && path.startsWith(hrefPath))) {
          a.setAttribute('aria-current', 'page');
        }
        return a;
      };

      const setOpen = (open, kids, btn) => {
        kids.style.display = open ? 'block' : 'none';
        btn.setAttribute('aria-expanded', String(open));
        const chev = btn.firstElementChild;
        if (chev) chev.style.transform = open ? 'rotate(90deg)' : 'rotate(0deg)';
      };

      const mkGroup = (g, depth=0) => {
        const wrap = document.createElement('div'); wrap.className = 'nav-group';

        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'stretch';
        row.style.borderBottom = '1px solid var(--border)';

        const link = mkLink(g, depth);
        link.style.flex = '1 1 auto';
        link.style.borderRight = '1px solid var(--border)';
        link.style.display = 'flex';
        link.style.alignItems = 'center';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('aria-label', 'Toggle ' + g.label);
        btn.setAttribute('aria-expanded', 'false');
        btn.style.width = '44px';
        btn.style.height = '44px';
        btn.style.display = 'grid';
        btn.style.placeItems = 'center';
        btn.style.background = 'transparent';
        btn.style.border = '0';
        btn.style.cursor = 'pointer';
        btn.style.color = 'var(--text)';

        const chev = document.createElement('span');
        chev.textContent = '▶';
        chev.style.display = 'inline-block';
        chev.style.transition = 'transform .18s ease';
        btn.appendChild(chev);

        const kids = document.createElement('div');
        kids.setAttribute('role','group');
        kids.style.display = 'none';

        (g.children || []).forEach(ch => {
          if (ch.type === 'group' && ch.collapsible) kids.appendChild(mkGroup(ch, depth + 1));
          else if (ch.type === 'link') kids.appendChild(mkLink(ch, depth + 1));
        });

        const open = !!(groupState[g.id] ?? g.initialOpen);
        setOpen(open, kids, btn);

        btn.addEventListener('click', (e)=>{
          e.preventDefault();
          const nowOpen = kids.style.display === 'none';
          setOpen(nowOpen, kids, btn);
          groupState[g.id] = nowOpen;
          try { localStorage.setItem(stateKey, JSON.stringify(groupState)); } catch {}
        });

        row.appendChild(link); row.appendChild(btn);
        wrap.appendChild(row); wrap.appendChild(kids);
        return wrap;
      };

      (cfg.items || []).forEach(item=>{
        if (item.type === 'group' && item.collapsible) nav.appendChild(mkGroup(item, 0));
        else if (item.type === 'link') nav.appendChild(mkLink(item, 0));
      });
    }

    _postPaintSanity(){
      // ✅ repair-only (never redirect)
      const nameOK = (this._logoutLabel && this._logoutLabel.textContent && this._logoutLabel.textContent.trim() !== 'Logout');
      const menuOK = this._hasMenuLinks();

      if (!nameOK) {
        this._setLogoutLabelNow();
        this._scheduleNameRetry(650, 'postpaint');
      }

      if (!menuOK) {
        // try to render now; if still not ready, retry later
        (async ()=>{
          try { await this._initMenuFiltered(); } catch {}
          if (!this._hasMenuLinks()) this._scheduleMenuRetry(650, 'postpaint');
        })();
      }
    }

    _collapseAllNavGroups(){
      const nav = this._navEl;
      if (!nav) return;
      nav.querySelectorAll('div[role="group"]').forEach(kids=>{
        kids.style.display = 'none';
        const row = kids.previousElementSibling;
        const btn = row && row.querySelector('button[aria-expanded]');
        if (btn) btn.setAttribute('aria-expanded','false');
      });
      const key = this._navStateKey || 'fv:nav:groups';
      try { localStorage.setItem(key, JSON.stringify({})); } catch {}
    }

    _applyBodyFixedStyles(){
      document.body.style.position = 'fixed';
      document.body.style.top = `-${this._scrollY}px`;
      document.body.style.left = '0';
      document.body.style.right = '0';
      document.body.style.width = '100%';
      document.body.style.overflow = 'hidden';
    }

    _setScrollLock(on){
      const iosStandalone = this._isIOSStandalone();
      const html = document.documentElement;
      if (on && !this._scrollLocked){
        this._scrollY = window.scrollY || html.scrollTop || 0;
        if (iosStandalone){
          this._applyBodyFixedStyles();
          html.style.overflow = 'hidden';
          html.style.height = '100%';
          if (this._scrim) {
            this._scrim.addEventListener('touchmove', this._scrimTouchBlocker, { passive:false });
            this._scrim.addEventListener('wheel', this._scrimTouchBlocker, { passive:false });
          }
        } else {
          html.style.overflow = 'hidden';
        }
        this.classList.add('ui-locked');
        this._scrollLocked = true;
        this._ptrDisabled = true;
      } else if (!on && this._scrollLocked){
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.left = '';
        document.body.style.right = '';
        document.body.style.width = '';
        document.body.style.overflow = '';
        html.style.overflow = '';
        html.style.height = '';
        if (this._scrim) {
          this._scrim.removeEventListener('touchmove', this._scrimTouchBlocker, { passive:false });
          this._scrim.removeEventListener('wheel', this._scrimTouchBlocker, { passive:false });
        }
        window.scrollTo(0, this._scrollY || 0);
        this.classList.remove('ui-locked');
        this._scrollLocked = false;
        setTimeout(()=> { this._ptrDisabled = false; }, 150);
      }
    }

    _syncScrollLock(){
      const anyOpen = this.classList.contains('drawer-open') ||
                      this.classList.contains('top-open') ||
                      this.classList.contains('camera-open');
      this._setScrollLock(anyOpen);
    }

    toggleDrawer(open){
      const wasOpen = this.classList.contains('drawer-open');
      const on = (open===undefined) ? !wasOpen : open;
      this.classList.toggle('drawer-open', on);
      this._syncScrollLock();
      if (wasOpen && !on) { this._collapseAllNavGroups(); }
    }

    toggleTop(open){
      const on = (open===undefined) ? !this.classList.contains('top-open') : open;
      this.classList.toggle('top-open', on);
      this._syncScrollLock();
    }

    _openCameraModal(){
      if (!this._cameraModal) return;
      // Gate by cap
      if (!this._qcCaps.camera) return;

      this.classList.add('camera-open');
      this._syncScrollLock();
      const btn = this._cameraReceiptBtn;
      if (btn && typeof btn.focus === 'function') {
        setTimeout(()=> btn.focus(), 20);
      }
    }

    _closeCameraModal(){
      if (!this._cameraModal) return;
      if (!this.classList.contains('camera-open')) return;
      this.classList.remove('camera-open');
      this._syncScrollLock();
    }

    _syncThemeChips(mode){
      this.shadowRoot.querySelectorAll('.js-theme').forEach(b=> b.setAttribute('aria-pressed', String(b.dataset.mode===mode)));
    }

    setTheme(mode){
      try{
        if(window.App && App.setTheme){ App.setTheme(mode); }
        else {
          document.documentElement.setAttribute('data-theme', mode === 'system' ? 'auto' : mode);
          document.documentElement.classList.toggle('dark',
            mode==='dark' || (mode==='system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
          );
          localStorage.setItem('fv-theme', mode);
        }
      }catch{}
      this._syncThemeChips(mode);
    }

    _initPTR(){
      const bar  = this._ptr      = this.shadowRoot.querySelector('.js-ptr');
      const txt  = this._ptrTxt   = this.shadowRoot.querySelector('.js-txt');
      const spin = this._ptrSpin  = this.shadowRoot.querySelector('.js-spin');
      const dot  = this._ptrDot   = this.shadowRoot.querySelector('.js-dot');

      const THRESHOLD = 72;
      const MAX_ANGLE = 18;
      const COOLDOWN  = 600;
      const TOP_TOL   = 2;
      const START_ZONE_PX = 90;

      let armed=false, pulling=false, startY=0, startX=0, deltaY=0, lastEnd=0;

      const atTop  = ()=> (window.scrollY || 0) <= TOP_TOL;
      const canUse = ()=> !this.classList.contains('drawer-open') && !this.classList.contains('top-open') && !this._ptrDisabled;

      const showBar = ()=>{ bar.classList.add('show'); spin.hidden = true; dot.hidden = false; txt.textContent = 'Pull to refresh'; };
      const hideBar = ()=>{ bar.classList.remove('show'); spin.hidden = true; dot.hidden = true; txt.textContent = 'Pull to refresh'; };

      const onStart = (x,y)=>{
        if (!canUse() || !atTop() || Date.now()-lastEnd<COOLDOWN || y > START_ZONE_PX){
          armed=false; return;
        }
        const active = document.activeElement;
        if (active && (active.tagName==='INPUT' || active.tagName==='TEXTAREA' || active.isContentEditable)) { armed=false; return; }

        armed=true; pulling=false; startY=y; startX=x; deltaY=0;
      };

      const onMove  = (x,y,prevent)=>{
        if (!armed) return;
        const dy=y-startY, dx=x-startX, angle=Math.abs(Math.atan2(dx,dy)*(180/Math.PI));
        if (angle>MAX_ANGLE){ armed=false; pulling=false; hideBar(); return; }
        if (dy>0){ deltaY=dy; if(!pulling){pulling=true; showBar();} txt.textContent=(deltaY>=THRESHOLD)?'Release to refresh':'Pull to refresh'; prevent(); }
        else { armed=false; pulling=false; hideBar(); }
      };

      const revalidateAuthOnly = async()=>{
        const deadline = Date.now() + 1500;
        while (Date.now() < deadline) {
          if (await this._isAuthed()) return true;
          await this._sleep(80);
        }
        return false;
      };

      const runRefreshContract = async ()=>{
        document.dispatchEvent(new CustomEvent('fv:refresh:begin'));

        let didSomething = false;

        if (typeof window.FVRefresh === 'function') {
          try {
            await window.FVRefresh();
            didSomething = true;
          } catch(e){
            console.error('[FV] FVRefresh failed:', e);
          }
        }

        try {
          if (window.FVData && typeof window.FVData.refreshAll === 'function') {
            await window.FVData.refreshAll();
            didSomething = true;
          }
        } catch(e){
          console.error('[FV] FVData.refreshAll failed:', e);
        }

        // Soft: try menu refresh; if still not ready, schedule retry (no login kick)
        try { await this._initMenuFiltered(); } catch {}
        if (!this._hasMenuLinks()) this._scheduleMenuRetry(650, 'ptr');

        document.dispatchEvent(new CustomEvent('fv:refresh:end'));

        if (!didSomething) {
          try {
            const url = new URL(location.href);
            url.searchParams.set('ptr', Date.now().toString(36));
            location.replace(url.toString());
          } catch {
            location.reload();
          }
        }
      };

      const onEnd = ()=>{
        if (!armed) return;
        const shouldRefresh = pulling && deltaY>=THRESHOLD;
        armed=false; pulling=false; deltaY=0; startY=0; startX=0;

        if (shouldRefresh){
          lastEnd=Date.now();
          (async ()=>{
            dot.hidden=true; spin.hidden=false; txt.textContent='Refreshing…';

            document.dispatchEvent(new CustomEvent('fv:refresh'));

            const ok = await revalidateAuthOnly();
            if (ok) {
              await runRefreshContract();
              // Soft: context might still be late
              this._softWaitForCtxAndMenu('ptr');
            } else {
              this._toastMsg('Session expired. Re-authenticating…', 1400);
              this._kickToLogin('ptr-auth');
              return;
            }

            await new Promise(res=> setTimeout(res, 900));
            hideBar();
          })();
        } else {
          hideBar();
        }
      };

      window.addEventListener('touchstart', (e)=>{ if(e.touches&&e.touches.length===1){const t=e.touches[0]; onStart(t.clientX,t.clientY);} }, { passive:true });
      window.addEventListener('touchmove',  (e)=>{ if(e.touches&&e.touches.length===1){const t=e.touches[0]; onMove(t.clientX,t.clientY, ()=>e.preventDefault());} }, { passive:false });
      window.addEventListener('touchend', onEnd, { passive:true });
      window.addEventListener('touchcancel', onEnd, { passive:true });

      window.addEventListener('pointerdown', (e)=>{ if(e.pointerType!=='mouse') onStart(e.clientX,e.clientY); }, { passive:true });
      window.addEventListener('pointermove', (e)=>{ if(e.pointerType!=='mouse') onMove(e.clientX,e.clientY, ()=>e.preventDefault());} , { passive:false });
      window.addEventListener('pointerup', onEnd, { passive:true });
      window.addEventListener('pointercancel', onEnd, { passive:true });

      document.addEventListener('visibilitychange', ()=>{ if (document.hidden) { armed=false; pulling=false; hideBar(); } });
    }

    _wireAuthLogout(r){
      const logoutRow = r.getElementById('logoutRow');
      const setLabel = ()=> this._setLogoutLabelNow();
      setLabel();
      try { if (window.FVUserContext && typeof window.FVUserContext.onChange === 'function') window.FVUserContext.onChange(() => setLabel()); } catch {}
      let tries = 30; const tick = setInterval(()=>{ setLabel(); if(--tries<=0) clearInterval(tick); }, 200);

      if (logoutRow) {
        logoutRow.addEventListener('click', async (e)=>{
          e.preventDefault();
          this.toggleTop(false); this.toggleDrawer(false);
          try{ if (typeof window.fvSignOut === 'function') await window.fvSignOut(); }catch(e){}
          try { window.FVUserContext && window.FVUserContext.clear && window.FVUserContext.clear(); } catch {}
          this._lastLogoutName = '';
          location.replace(this.LOGIN_URL);
        });
      }
    }

    _initConnectionStatus(){
      const update = ()=>{
        const net = navigator.onLine;
        let cloudReady = false;
        try { cloudReady = !!(window.FVUserContext && window.FVUserContext.get && window.FVUserContext.get()); } catch {}
        const ok = !!(net && cloudReady);
        if (this._connTxt) this._connTxt.textContent = ok ? 'Online' : 'Offline';
        if (this._connRow) {
          this._connRow.style.opacity = '1';
          this._connRow.title = `Network: ${net ? 'online' : 'offline'} • Cloud: ${cloudReady ? 'ready' : 'not ready'}`;
        }
      };
      update();
      window.addEventListener('online', update);
      window.addEventListener('offline', update);
      try { if (window.FVUserContext && typeof window.FVUserContext.onChange === 'function') window.FVUserContext.onChange(update); } catch {}
      let tries = 20; const t = setInterval(()=>{ update(); if(--tries<=0) clearInterval(t); }, 250);
    }

    async checkForUpdates(){
      const sleep = (ms)=> new Promise(res=> setTimeout(res, ms));

      const readTargetVersion = async ()=>{
        try{
          const resp = await fetch('/Farm-vista/js/version.js?ts=' + Date.now(), { cache:'reload' });
          const txt = await resp.text();
          const m =
            txt.match(/number\s*:\s*["']([\d.]+)["']/) ||
            txt.match(/FV_NUMBER\s*=\s*["']([\d.]+)["']/);
          return (m && m[1]) || '';
        }catch{
          return '';
        }
      };

      try{
        // ---- Read versions (informational only) ----
        const targetVer = await readTargetVersion();
        const curVer = (window.FV_VERSION && window.FV_VERSION.number)
          ? String(window.FV_VERSION.number)
          : '';

        if (targetVer && curVer && targetVer === curVer) {
          this._toastMsg(`Up to date (v${curVer}) — refreshing cache…`, 1400);
        } else if (targetVer) {
          this._toastMsg(`Updating to v${targetVer}…`, 1200);
        } else {
          this._toastMsg('Refreshing cache…', 1200);
        }

        // ---- HARD CLEAR: Service Workers ----
        if (navigator.serviceWorker) {
          try {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.map(r => r.unregister()));
          } catch (e) {
            console.warn('[FV] SW unregister failed:', e);
          }
        }

        // ---- HARD CLEAR: CacheStorage ----
        if ('caches' in window) {
          try {
            const keys = await caches.keys();
            await Promise.all(keys.map(k => caches.delete(k)));
          } catch (e) {
            console.warn('[FV] Cache delete failed:', e);
          }
        }

        // ---- Re-register Service Worker (cache-busted) ----
        if (navigator.serviceWorker) {
          try {
            const reg = await navigator.serviceWorker.register(
              '/Farm-vista/serviceworker.js?ts=' + Date.now()
            );
            if (reg?.waiting && reg.waiting.postMessage) {
              reg.waiting.postMessage('SKIP_WAITING');
            }
          } catch (e) {
            console.warn('[FV] SW re-register failed:', e);
          }
        }

        // ---- Give browser a moment to settle ----
        await sleep(250);

        // ---- Force hard navigation ----
        const url = new URL(location.href);
        url.searchParams.set('rev', targetVer || Date.now().toString(36));
        location.replace(url.toString());

      } catch (e) {
        console.error('[FV] Update failed:', e);
        this._toastMsg('Update failed. Try again.', 2400);
      }
    }

    /* ============================== */
    /* Quick Camera interactions      */
    /* ============================== */
    _initQuickCamera(){
      if (!this._qcRail || !this._qcHandle) return;

      // mobile only guard
      const isCoarse = window.matchMedia && window.matchMedia('(pointer:coarse)').matches;
      if (!isCoarse) this._qcRail.style.display = 'none';

      // Toggle panel
      this._qcHandle.addEventListener('click', (e)=>{
        e.preventDefault();
        if (this._qcRail.style.display === 'none') return;
        const on = this._qcRail.getAttribute('aria-expanded') !== 'true';
        this._qcToggle(on);
      });

      // Close when tapping outside (use composedPath so shadow DOM clicks aren't mis-read)
      document.addEventListener('pointerdown', (e)=>{
        if (this._qcRail.getAttribute('aria-expanded') !== 'true') return;
        const path = e.composedPath ? e.composedPath() : [e.target];
        if (!path.includes(this._qcRail)) this._qcToggle(false);
      });

      // Open actions
      const html = document.documentElement;
      const scanURL   = html.getAttribute('data-scan-url')   || '/Farm-vista/pages/qr-scan.html';

      if (this._qcScan) this._qcScan.addEventListener('click', (e)=>{
        e.preventDefault();
        e.stopPropagation();
        if (!this._qcCaps.qr) return;
        if (scanURL) location.href = scanURL;
        else this.dispatchEvent(new CustomEvent('fv:open:qr', { bubbles:true, composed:true }));
        this._qcToggle(false);
      });

      if (this._qcCamera) this._qcCamera.addEventListener('click', (e)=>{
        e.preventDefault();
        e.stopPropagation();
        if (!this._qcCaps.camera) return;

        // Open FarmVista popup (existing behavior)
        this._qcToggle(false);
        this._openCameraModal();
      });
    }

    _qcToggle(on){
      if (!this._qcRail) return;
      this._qcRail.setAttribute('aria-expanded', String(!!on));
    }

    // Native camera via hidden input (kept for global 'fv:open:camera' compatibility)
    _openNativeCamera(){
      try{
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.setAttribute('capture', 'environment'); // prefer rear

        input.style.position = 'fixed';
        input.style.left = '-9999px';
        input.style.top = '0';
        input.style.opacity = '0.0001';
        input.style.width = '1px';
        input.style.height = '1px';
        input.style.pointerEvents = 'none';

        document.body.appendChild(input);

        input.addEventListener('change', ()=>{
          const file = input.files && input.files[0];
          if (file) {
            this.dispatchEvent(new CustomEvent('fv:camera:file', { bubbles:true, composed:true, detail:{ file } }));
            this._toastMsg('Photo captured.', 1400);
          } else {
            this._toastMsg('Camera closed.', 1200);
          }
          setTimeout(()=> input.remove(), 0);
        }, { once:true });

        input.click();
      }catch{
        this._toastMsg('Unable to open camera.', 1800);
      }
    }
  }

  if (!customElements.get('fv-shell')) customElements.define('fv-shell', FVShell);

  // Optional global fallbacks (kept for compatibility with older pages)
  document.addEventListener('fv:open:qr', () => {
    location.href = '/Farm-vista/pages/qr-scan.html';
  });
  document.addEventListener('fv:open:camera', () => {
    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.setAttribute('capture','environment');
      input.style.position='fixed'; input.style.left='-9999px'; input.style.top='0'; input.style.opacity='0.0001';
      document.body.appendChild(input);
      input.addEventListener('change', ()=> input.remove(), { once:true });
      input.click();
    } catch (err) { console.error('Camera launch failed:', err); }
  });

})();
