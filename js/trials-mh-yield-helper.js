<!-- ======================================================================
/Farm-vista/pages/crop-production/trials/dev-trial-field-yield-mh-helper.html
Helper/demo page that hosts the Multi-Hybrid Yield helper.
====================================================================== -->
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>FarmVista • Helper • Trial Field Yields (Multi-Hybrid)</title>
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#3B7E46" />

  <!-- ABSOLUTE PATHS -->
  <link rel="manifest" href="/Farm-vista/manifest.webmanifest" />
  <link rel="apple-touch-icon" href="/Farm-vista/assets/icons/apple-touch-icon.png" />
  <link rel="icon" href="/Farm-vista/assets/icons/icon-192.png" />
  <script src="/Farm-vista/js/theme-boot.js"></script>
  <!-- Dictation helper (used by notes mic buttons) -->
  <script src="/Farm-vista/js/fv-dictation.js"></script>
  <link rel="stylesheet" href="/Farm-vista/assets/css/theme.css" />
  <link rel="stylesheet" href="/Farm-vista/assets/css/app.css" />

  <style>
    :root{
      --card-max: 900px;
      --page-bottom-gap: 72px;
      --accent: #2F6C3C;

      /* FV Combo vars */
      --combo-gap: 4px;
      --combo-radius: 12px;
      --combo-btn-radius: 10px;
      --combo-shadow: 0 12px 26px rgba(0,0,0,.18);
      --combo-item-pad: 10px 8px;
      --combo-max-h: 50vh;
    }

    html{-webkit-text-size-adjust:100%}
    body{
      background: var(--app-bg,var(--surface));
      overflow-x:hidden;
    }

    .wrap{
      max-width: var(--card-max);
      margin: 0 auto;
      padding: clamp(14px,3vw,22px);
      padding-bottom: calc(env(safe-area-inset-bottom,0px) + 72px + var(--page-bottom-gap)) !important;
      box-sizing:border-box;
      display:grid;
      gap:16px;
    }

    .hero{
      border:1px solid var(--border);
      border-radius:14px;
      background:var(--surface);
      box-shadow:var(--shadow,0 8px 20px rgba(0,0,0,.08));
      overflow:hidden;
    }

    .hero-head{
      display:grid;
      grid-template-columns:auto 1fr;
      gap:12px;
      align-items:center;
      padding:14px 16px;
      border-bottom:1px solid var(--border);
      background:linear-gradient(90deg, rgba(47,108,60,.12), transparent);
    }
    .hero-head-title{
      display:flex;
      flex-direction:column;
      gap:4px;
    }
    .hero-head h1{
      margin:0;
      font-size:clamp(20px,3.2vw,26px);
      line-height:1.2;
    }
    .muted{color:var(--muted,#67706B)}

    .body{
      padding:16px;
      display:grid;
      gap:14px;
    }

    .top-row-actions-left{
      display:flex;
      justify-content:flex-start;
    }

    .btn{
      display:inline-flex;
      align-items:center;
      justify-content:center;
      min-width:150px;
      padding:11px 16px;
      border-radius:12px;
      border:1px solid var(--border);
      background:var(--card-surface,var(--surface));
      font-weight:800;
      color:var(--text)!important;
      cursor:pointer;
      text-decoration:none;
    }
    .btn-primary{
      border-color:transparent;
      background:#2F6C3C;
      color:#fff!important;
    }
    .btn-quiet{
      background:transparent;
      min-width:auto;
      padding-inline:10px;
    }
    .btn-small{
      padding:6px 10px;
      min-width:auto;
      font-size:0.8rem;
      border-radius:999px;
    }

    .fields-hero{
      border:1px solid var(--border);
      border-radius:14px;
      background:var(--surface);
      box-shadow:var(--shadow,0 8px 20px rgba(0,0,0,.08));
      overflow:hidden;
    }
    .fields-head{
      padding:12px 16px;
      border-bottom:1px solid var(--border);
      display:flex;
      justify-content:space-between;
      align-items:center;
      gap:10px;
    }
    .fields-head h2{
      margin:0;
      font-size:1rem;
    }
    .fields-body{
      padding:14px 16px 16px;
      display:grid;
      gap:12px;
    }

    .field-card{
      border-radius:12px;
      border:1px solid var(--border);
      background:var(--card-surface,var(--surface));
      padding:9px 10px;
      display:grid;
      gap:4px;
      font-size:0.9rem;
      cursor:pointer;
      transition:background 0.12s ease, box-shadow 0.12s ease, transform 0.08s ease;
    }
    .field-card:hover{
      background:rgba(0,0,0,.03);
      box-shadow:0 4px 10px rgba(0,0,0,.08);
      transform:translateY(-1px);
    }
    .field-card-top{
      display:flex;
      justify-content:space-between;
      gap:8px;
      align-items:flex-start;
    }
    .field-card-title{
      font-weight:700;
    }
    .field-card-sub{
      font-size:0.82rem;
      color:var(--muted,#67706B);
    }
    .field-card-note{
      font-size:0.83rem;
      color:var(--muted,#67706B);
      margin-top:2px;
    }
    @media (max-width:640px){
      .field-card-top .btn-small{ display:none; }
    }

    /* Modal shell */
    .modal-backdrop{
      position:fixed;
      inset:0;
      background:rgba(0,0,0,.4);
      display:flex;
      align-items:center;
      justify-content:center;
      z-index:9999;
    }
    .modal-backdrop.hidden{ display:none; }
    .modal{
      max-width:720px;
      width:96vw;
      background:var(--surface);
      border-radius:16px;
      box-shadow:0 18px 45px rgba(0,0,0,.28);
      border:1px solid var(--border);
      display:flex;
      flex-direction:column;
      overflow:hidden;
      max-height:100vh;
    }
    .modal-header{
      padding:12px 16px;
      border-bottom:1px solid var(--border);
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:8px;
    }
    .modal-header h3{
      margin:0;
      font-size:1rem;
    }
    .modal-close{
      border:none;
      background:transparent;
      color:var(--muted,#67706B);
      font-size:0;
      line-height:1;
      cursor:pointer;
      padding:4px;
      border-radius:999px;
      display:flex;
      align-items:center;
      justify-content:center;
    }
    .modal-close svg{
      width:18px;
      height:18px;
      display:block;
    }
    .modal-body{
      padding:14px 16px 10px;
      font-size:0.9rem;
      display:grid;
      gap:10px;
      max-height:calc(100vh - 120px);
      overflow-y:auto;
    }
    .modal-footer{
      padding:10px 16px 12px;
      border-top:1px solid var(--border);
      display:flex;
      justify-content:flex-end;
      gap:10px;
      flex-shrink:0;
      background:var(--surface);
    }
    @media (max-width:640px){
      .modal{
        width:100vw;
        max-width:100vw;
        border-radius:0;
        max-height:100vh;
      }
      .modal-body{
        max-height:calc(100vh - 110px);
      }
    }

    .yield-summary{
      display:grid;
      gap:4px;
    }
    .yield-summary .muted{ font-size:0.82rem; }

    .primary-full-btn{
      margin-top:4px;
      margin-bottom:4px;
      border-radius:999px;
      padding:11px 16px;
      border:none;
      width:100%;
      font-weight:800;
      font-size:0.95rem;
      cursor:pointer;
      background:#2F6C3C;
      color:#fff;
      box-shadow:0 8px 18px rgba(46,123,53,0.35);
    }

    /* === FIELD LOOK FROM ADD TRIAL === */
    .row{
      display:grid;
      gap:10px;
      grid-template-columns:1fr 1fr;
    }
    @media (max-width:880px){
      .row{grid-template-columns:1fr;}
    }

    .field{ position:relative; }
    .field label{
      display:block;
      font-weight:800;
      margin:0 0 6px;
    }
    .input,
    .select{
      width:100%;
      font:inherit;
      font-size:16px;
      color:var(--text);
      background:var(--card-surface,var(--surface));
      border:1px solid var(--border);
      border-radius:10px;
      padding:12px;
      outline:none;
      box-sizing:border-box;
    }

    .help{
      font-size:13px;
      color:var(--muted,#67706B);
      margin-top:6px;
    }

    /* === FV Combo === */
    .combo{ position:relative; }
    .combo .combo-anchor{
      position:relative; display:inline-block; width:100%;
    }
    .buttonish{
      width:100%; font:inherit; font-size:16px; color:var(--text);
      background:var(--card-surface,var(--surface)); border:1px solid var(--border);
      border-radius:var(--combo-btn-radius); padding:12px; outline:none;
      cursor:pointer; text-align:left; position:relative; padding-right:42px;
      box-sizing:border-box;
    }
    .buttonish.has-caret::after{
      content:""; position:absolute; right:14px; top:50%; width:0; height:0;
      border-left:6px solid transparent; border-right:6px solid transparent;
      border-top:7px solid var(--muted,#67706B); transform:translateY(-50%); pointer-events:none;
    }
    .combo-panel{
      position:absolute; left:0; right:0; top:calc(100% + var(--combo-gap));
      background:var(--surface); border:1px solid var(--border); border-radius:var(--combo-radius);
      box-shadow:var(--combo-shadow); z-index:9999; padding:8px; display:none;
    }
    .combo-panel.show{ display:block; }
    .combo-panel .list{
      max-height:var(--combo-max-h);
      overflow:auto;
      border-top:1px solid var(--border);
    }
    .combo-item{
      padding:var(--combo-item-pad);
      border-bottom:1px solid var(--border);
      cursor:pointer;
      font-size:0.9rem;
    }
    .combo-item:last-child{ border-bottom:none; }
    .combo-item:hover{ background:rgba(0,0,0,.04); }
    .combo-empty{ padding:var(--combo-item-pad); color:#67706B; }

    /* Yield-specific layout */
    .setup-panel{
      border-radius:14px;
      border:1px solid var(--border);
      background:var(--surface);
      padding:10px 12px;
      display:grid;
      gap:10px;
    }

    .setup-hybrids-header{
      display:flex;
      justify-content:space-between;
      align-items:center;
      gap:8px;
    }
    .setup-hybrids-header h3{
      margin:0;
      font-size:0.9rem;
    }

    .entry-label{
      font-size:0.8rem;
      font-weight:600;
      white-space:nowrap;
    }

    .setup-hybrid-row{
      display:grid;
      grid-template-columns:auto minmax(0,2.3fr) minmax(0,1.2fr) auto;
      gap:6px;
      align-items:center;
      padding:6px 8px;
      border-radius:10px;
      border:1px solid var(--border);
      background:var(--surface-soft,var(--surface));
    }

    .check-indicator{
      display:inline-flex;
      align-items:center;
      gap:4px;
      font-size:0.78rem;
      white-space:nowrap;
      cursor:pointer;
    }
    .check-dot{
      width:10px;
      height:10px;
      border-radius:999px;
      border:2px solid #9ca3af;
      box-sizing:border-box;
    }
    .check-dot--on{
      border-color:#166534;
      background:#16a34a;
    }

    .row-remove{
      border:none;
      background:transparent;
      color:var(--muted,#67706B);
      font-size:0;
      line-height:1;
      cursor:pointer;
      padding:4px;
      border-radius:999px;
      display:none;
    }
    .row-remove svg{
      width:14px;
      height:14px;
      display:block;
    }
    @media (min-width:641px){
      .row-remove{
        display:flex;
        align-items:center;
        justify-content:center;
      }
    }

    .setup-errors{
      font-size:0.8rem;
      color:#b3261e;
    }

    .blocks-panel{
      border-radius:14px;
      border:1px solid var(--border);
      background:var(--surface);
      padding:10px 12px;
      display:grid;
      gap:8px;
    }
    .blocks-panel-header{
      font-size:0.85rem;
      margin-bottom:4px;
    }

    .yield-block-card{
      border-radius:10px;
      border:1px solid var(--border);
      background:var(--surface-soft,var(--surface));
      padding:8px 10px;
      display:grid;
      gap:6px;
      font-size:0.88rem;
    }
    .yield-block-head{
      display:flex;
      justify-content:space-between;
      gap:8px;
      align-items:flex-start;
    }
    .yield-block-title{
      font-weight:700;
    }
    .yield-block-sub{
      font-size:0.8rem;
      color:var(--muted,#67706B);
    }

    .badge-check{
      border-radius:999px;
      padding:2px 8px;
      font-size:0.72rem;
      background:#2F6C3C;
      color:#fff;
      text-transform:uppercase;
      letter-spacing:0.06em;
      align-self:flex-start;
      margin-left:4px;
    }
    .badge-void{
      border-radius:999px;
      padding:2px 8px;
      font-size:0.72rem;
      background:#b91c1c;
      color:#fff;
      text-transform:uppercase;
      letter-spacing:0.06em;
      margin-left:4px;
    }

    .field-mini{
      display:flex;
      flex-direction:column;
      gap:3px;
    }
    .field-mini span{
      font-size:0.8rem;
      font-weight:600;
    }

    .yield-block-grid{
      display:grid;
      grid-template-columns:repeat(3,minmax(0,1fr));
      gap:8px;
      align-items:flex-end;
    }
    @media (max-width:640px){
      .yield-block-grid{
        grid-template-columns:1fr;
      }
    }

    .yield-value{
      font-size:0.85rem;
      font-weight:600;
      margin-top:2px;
    }
    .yield-value.bad{
      color:#b3261e;
    }

    .void-row{
      display:flex;
      align-items:center;
      gap:6px;
      font-size:0.8rem;
      margin-top:4px;
    }

    /* Notes + files on blocks */
    .yield-extra{
      display:flex;
      flex-direction:column;
      gap:8px;
      margin-top:8px;
    }

    .notes-shell{
      position:relative;
    }
    .notes-input{
      width:100%;
      min-height:96px;
      padding-right:52px; /* room for mic */
      resize:vertical;
    }

    /* Mic button (square style) */
    .mic-btn{
      position:absolute;
      right:10px;
      bottom:10px;
      width:36px;
      height:36px;
      border-radius:10px;
      border:1px solid var(--border);
      background:var(--surface);
      display:grid;
      place-items:center;
      cursor:pointer;
    }
    .mic-btn[disabled]{
      opacity:.6;
      cursor:not-allowed;
    }
    .mic-btn.mic-active{
      background:#2F6C3C;
      color:#fff;
      border-color:#2F6C3C;
    }
    .mic-svg{
      width:18px;
      height:18px;
      display:block;
    }

    .files-shell{
      display:flex;
      flex-direction:column;
      gap:6px;
    }
    .hidden-file{
      display:none;
    }
    .file-list{
      margin:0;
      padding:0;
      list-style:none;
      font-size:0.8rem;
    }
    .file-list li{
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:6px;
      padding:4px 6px;
      border-radius:6px;
      border:1px solid var(--border);
      background:var(--surface);
    }
    .file-name{
      overflow:hidden;
      text-overflow:ellipsis;
      white-space:nowrap;
      max-width:200px;
    }
    .file-remove{
      border:none;
      background:transparent;
      font-size:14px;
      line-height:1;
      cursor:pointer;
      padding:2px 4px;
      border-radius:999px;
      color:var(--muted,#67706B);
    }
    .file-remove:hover{
      background:rgba(0,0,0,.06);
    }

    .hidden{display:none;}
  </style>
</head>

<body>
  <fv-shell>
    <div class="wrap">
      <section class="hero">
        <header class="hero-head">
          <div class="hero-head-title">
            <h1>Helper • Trial Field Yields (Multi-Hybrid)</h1>
            <p class="muted">
              Reusable helper for multi-hybrid seed plots. This same engine can be imported into the real Trials page.
            </p>
          </div>
        </header>

        <div class="body">
          <div class="top-row-actions-left">
            <button type="button" class="btn btn-quiet" id="btnOpenModal">
              Open Yield Helper
            </button>
          </div>
        </div>
      </section>

      <section class="fields-hero">
        <header class="fields-head">
          <h2>Dev field card (Sample)</h2>
        </header>
        <div class="fields-body">
          <div class="field-card" id="devFieldCard">
            <div class="field-card-top">
              <div>
                <div class="field-card-title">Divernon–Farmersville • 0702-Grandmas TestPlot</div>
                <div class="field-card-sub">
                  Trial acres: <strong>20.00 ac</strong> (Max tillable: 39.45)
                </div>
                <div class="field-card-note" id="devFieldSummary"></div>
              </div>
              <div><span class="btn btn-small">View / Add Yield</span></div>
            </div>
          </div>
        </div>
      </section>
    </div>
  </fv-shell>

  <!-- Yield modal that the helper wires up -->
  <div id="yieldModalBackdrop" class="modal-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="yieldModalTitle">
    <div class="modal">
      <div class="modal-header">
        <h3 id="yieldModalTitle">0702-Grandmas TestPlot • Yield Entry</h3>
        <button id="btnYieldClose" type="button" class="modal-close" aria-label="Close">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4.22 4.22a.75.75 0 0 1 1.06 0L8 6.94l2.72-2.72a.75.75 0 1 1 1.06 1.06L9.06 8l2.72 2.72a.75.75 0 0 1-1.06 1.06L8 9.06l-2.72 2.72a.75.75 0 0 1-1.06-1.06L6.94 8 4.22 5.28a.75.75 0 0 1 0-1.06z"></path>
          </svg>
        </button>
      </div>
      <div class="modal-body">
        <div id="yieldSummary" class="yield-summary"></div>

        <button type="button" class="primary-full-btn" id="btnSetUpPlot">
          Set Up Plot
        </button>

        <div id="mhStageShell"></div>
      </div>
      <div class="modal-footer">
        <button id="btnYieldOk" type="button" class="btn btn-primary">Save &amp; Close (Dev)</button>
      </div>
    </div>
  </div>

  <!-- Helper init -->
  <script type="module">
    import { initMhYieldHelper } from '/Farm-vista/js/trials-mh-yield-helper.js';

    // In this helper/demo page we just initialize with defaults.
    // Later, the real Trials page can also call initMhYieldHelper().
    const mhHelper = initMhYieldHelper();
    // window.FV_MH_HELPER = mhHelper; // optional: expose for dev console
  </script>
</body>
</html>

<!-- ======================================================================
/Farm-vista/js/trials-mh-yield-helper.js
Reusable Multi-Hybrid Yield helper engine.
Can be imported into dev helper page AND real Trials page.
====================================================================== -->
<script type="module">
// NOTE: remove this <script> wrapper when you save the JS file.
// The JS file content starts below this comment.

export function initMhYieldHelper() {
  const PASS_WIDTH_OPTIONS = [15,20,25,30,35,40,45,50,60];

  const mhState = {
    cropKind: 'corn',
    stage: 'setup',          // 'setup' | 'blocks'
    passLengthFt: 600,
    passWidthFt: 20,
    checkProductId: null,
    hybrids: [],
    blocks: []
  };

  const mockHybrids = [
    { id: 'P1185Q', name: 'Pioneer P1185Q', maturity: 118 },
    { id: 'P1742Q', name: 'Pioneer P1742Q', maturity: 117 },
    { id: 'P1366Q', name: 'Pioneer P1366Q', maturity: 113 },
    { id: 'DKC6460', name: 'Dekalb DKC6460', maturity: 114 },
    { id: 'DKC6499', name: 'Dekalb DKC6499', maturity: 114 },
    { id: 'AG3640',  name: 'AgriGold 3640',  maturity: 112 }
  ];

  const modalBackdrop = document.getElementById('yieldModalBackdrop');
  const btnOpenModal  = document.getElementById('btnOpenModal');
  const devFieldCard  = document.getElementById('devFieldCard');
  const btnClose      = document.getElementById('btnYieldClose');
  const btnOk         = document.getElementById('btnYieldOk');
  const btnSetUpPlot  = document.getElementById('btnSetUpPlot');
  const summaryEl     = document.getElementById('yieldSummary');
  const stageShell    = document.getElementById('mhStageShell');
  const devFieldSummaryEl = document.getElementById('devFieldSummary');

  const $  = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  function nextRowId(){
    return 'row_' + Math.random().toString(36).slice(2,9);
  }

  function formatNumber(num, decimals){
    if(num === null || num === undefined || isNaN(num)) return '—';
    return Number(num).toFixed(decimals);
  }

  function formatWithCommas(num){
    if(num === null || num === undefined || isNaN(num)) return '';
    const s = String(Math.round(num));
    return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function calcDevYield({ cropKind, moisturePct, wetWeightLbs, lengthFt, widthFt }){
    if(!moisturePct || !wetWeightLbs || !lengthFt || !widthFt) return null;
    const areaAc = (lengthFt * widthFt) / 43560;
    if(areaAc <= 0) return null;

    const stdMoist = cropKind === 'soy' ? 13.0 : 15.0;
    const testWt   = cropKind === 'soy' ? 60.0 : 56.0;
    const m = Number(moisturePct);
    const w = Number(wetWeightLbs);
    if(!isFinite(m) || !isFinite(w) || m <= 0 || m >= 80 || w <= 0) return null;

    // Drier than standard -> treat as standard, so no over-dry credit
    const used = Math.max(m, stdMoist);
    const dryWeightStd = w * (100 - used) / (100 - stdMoist);
    const bu = dryWeightStd / testWt;
    return bu / areaAc;
  }

  function renderDevSummary(){
    if(!devFieldSummaryEl) return;
    if(!mhState.hybrids.length){
      devFieldSummaryEl.textContent = '';
      return;
    }
    const lines = mhState.hybrids.map((h, idx) => {
      if(!h.productId) return null;
      const blk = mhState.blocks.find(b => b.rowId === h.rowId) || {};
      const hasData = blk.moisturePct != null && blk.weightLbs != null && blk.yieldBuPerAc != null;
      const isCheck = mhState.checkProductId && h.productId === mhState.checkProductId;

      const parts = [];
      parts.push(`Entry ${idx+1}: ${h.name || 'Variety'}`);
      if(h.maturity != null) parts.push(`(${h.maturity} RM)`);
      if(isCheck) parts.push('– CHECK');
      if(hasData){
        parts.push(`– ${formatNumber(blk.moisturePct,2)}% • ${formatNumber(blk.yieldBuPerAc,1)} bu/ac`);
      }
      return parts.join(' ');
    }).filter(Boolean);
    devFieldSummaryEl.innerHTML = lines.join('<br>');
  }

  function openModal(){
    if(!summaryEl || !modalBackdrop) return;

    summaryEl.innerHTML = `
      <div>
        <strong>Trial:</strong> Grandmas Test Plot North<br>
        <strong>Field:</strong> Divernon-Farmersville • 0702-Grandmas TestPlot<br>
        <strong>Trial acres:</strong> 20.00 ac<br>
        <strong>Field tillable:</strong> 39.45 ac
      </div>
      <div class="muted">
        Multi-hybrid helper. Set up plot length, width, entries, and check variety. Then we’ll show one yield card
        per entry using weight-only data.
      </div>
    `;
    modalBackdrop.classList.remove('hidden');

    // If we've already generated blocks once, go straight to data entry
    if (mhState.blocks.length > 0) {
      mhState.stage = 'blocks';
    } else {
      mhState.stage = 'setup';
    }

    renderStage();
  }

  function closeModal(){
    if(!modalBackdrop) return;
    modalBackdrop.classList.add('hidden');
  }

  /* === Combo helpers === */
  function closeAllCombos(except=null){
    $$('.combo-panel.show').forEach(p => { if(p !== except) p.classList.remove('show'); });
  }

  function makeCombo({ btn, panel, list, items=[], formatter=x=>String(x.label ?? x), onPick }){
    if(!btn || !panel || !list) return;

    panel.addEventListener('click', e => e.stopPropagation());
    panel.addEventListener('mousedown', e => e.stopPropagation());

    function renderList(){
      list.innerHTML = (items||[]).map(x => `
        <div class="combo-item" data-id="${String(x.id)}">${formatter(x)}</div>
      `).join('') || `<div class="combo-empty">(no options)</div>`;
    }

    function open(){
      closeAllCombos(panel);
      panel.classList.add('show');
      renderList();
    }
    function close(){
      panel.classList.remove('show');
    }

    btn.addEventListener('click', e => {
      e.stopPropagation();
      panel.classList.contains('show') ? close() : open();
    });

    list.addEventListener('mousedown', e => {
      const row = e.target.closest('.combo-item');
      if(!row) return;
      const id  = row.dataset.id;
      const it  = (items||[]).find(x => String(x.id) === id);
      if(!it) return;
      onPick?.(it);
      close();
    });

    return { open, close };
  }

  function validateSetup(){
    const errors = [];
    if(!mhState.passLengthFt || mhState.passLengthFt <= 0){
      errors.push('Enter a positive plot length.');
    }
    if(!mhState.passWidthFt || mhState.passWidthFt <= 0){
      errors.push('Select a positive pass width.');
    }
    if(!mhState.hybrids.length){
      errors.push('Add at least one entry.');
    }else{
      mhState.hybrids.forEach((h, idx) => {
        if(!h.productId){
          errors.push(`Entry ${idx+1}: select a variety.`);
        }
      });
    }
    if(!mhState.checkProductId){
      errors.push('Pick one check variety (tied to the variety).');
    }
    const box = document.getElementById('mh-setup-errors');
    if(box){
      box.innerHTML = errors.map(e => '• ' + e).join('<br>');
    }
    return errors.length === 0;
  }

  function renderSetup(){
    if(!stageShell) return;
    const hybrids = mhState.hybrids;
    const lengthFt = mhState.passLengthFt;
    const widthFt  = mhState.passWidthFt;
    let html = '';

    html += `
      <div class="setup-panel">
        <div class="row">
          <div class="field">
            <label for="mh-length-input">Plot length (ft)</label>
            <input id="mh-length-input" type="text" inputmode="numeric" class="input" value="${lengthFt}">
            <div class="help">Same length for every strip in this plot.</div>
          </div>

          <div class="field combo">
            <label for="mh-width-btn">Pass width (ft)</label>
            <div class="combo-anchor">
              <button id="mh-width-btn" class="buttonish has-caret" type="button">${widthFt}</button>
              <div class="combo-panel" id="mh-width-panel" role="listbox" aria-label="Pass width options">
                <div class="list" id="mh-width-list"></div>
              </div>
            </div>
            <div class="help">Planter/harvest width, e.g. 20 ft, 30 ft.</div>
          </div>
        </div>

        <div class="setup-hybrids-header">
          <h3>Varieties in this plot (planting order)</h3>
          <button type="button" class="btn btn-small btn-quiet" id="mh-add-row-btn">+ Add variety</button>
        </div>
    `;

    if(!hybrids.length){
      html += `<p class="muted">No entries yet. Tap <strong>+ Add variety</strong> to start.</p>`;
    }else{
      hybrids.forEach((hyb, idx) => {
        const isCheckRow = hyb.productId && mhState.checkProductId === hyb.productId;
        const label = hyb.productId
          ? `${hyb.name || 'Variety'}${hyb.maturity != null ? ' (' + hyb.maturity + ' RM)' : ''}`
          : 'Select variety…';

        html += `
          <div class="setup-hybrid-row" data-row-id="${hyb.rowId}">
            <div class="entry-label">Entry ${idx+1}</div>
            <div class="combo">
              <div class="combo-anchor">
                <button type="button"
                        class="buttonish has-caret"
                        id="mh-hybrid-btn-${hyb.rowId}">
                  ${label}
                </button>
                <div class="combo-panel" id="mh-hybrid-panel-${hyb.rowId}">
                  <div class="list" id="mh-hybrid-list-${hyb.rowId}"></div>
                </div>
              </div>
            </div>
            <div class="check-indicator" data-row-id="${hyb.rowId}">
              <span class="check-dot ${isCheckRow ? 'check-dot--on' : ''}"></span>
              <span>Check</span>
            </div>
            <button type="button" class="row-remove" data-row-id="${hyb.rowId}" aria-label="Remove entry">
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4.22 4.22a.75.75 0 0 1 1.06 0L8 6.94l2.72-2.72a.75.75 0 1 1 1.06 1.06L9.06 8l2.72 2.72a.75.75 0 0 1-1.06 1.06L8 9.06l-2.72 2.72a.75.75 0 0 1-1.06-1.06L6.94 8 4.22 5.28a.75.75 0 0 1 0-1.06z"></path>
              </svg>
            </button>
          </div>
        `;
      });
    }

    html += `<div class="setup-errors" id="mh-setup-errors"></div></div>`;
    stageShell.innerHTML = html;

    // Length input
    const lenInput = document.getElementById('mh-length-input');
    if(lenInput){
      lenInput.addEventListener('input', e => {
        const v = e.target.value.replace(/[^0-9]/g,'');
        e.target.value = v;
        mhState.passLengthFt = v === '' ? 0 : Number(v);
      });
    }

    // Pass width combo
    const widthBtn   = document.getElementById('mh-width-btn');
    const widthPanel = document.getElementById('mh-width-panel');
    const widthList  = document.getElementById('mh-width-list');

    if(widthBtn && widthPanel && widthList){
      makeCombo({
        btn: widthBtn,
        panel: widthPanel,
        list: widthList,
        items: PASS_WIDTH_OPTIONS.map(v => ({ id:String(v), label:String(v) })),
        formatter: x => x.label,
        onPick: it => {
          mhState.passWidthFt = Number(it.id);
          widthBtn.textContent = it.label;
          renderDevSummary();
        }
      });
    }

    // Add variety
    const addRowBtn = document.getElementById('mh-add-row-btn');
    if(addRowBtn){
      addRowBtn.addEventListener('click', () => {
        mhState.hybrids.push({
          rowId: nextRowId(),
          productId: '',
          name: '',
          maturity: null
        });
        renderStage();
      });
    }

    // Variety combos + check + remove
    mhState.hybrids.forEach(hyb => {
      const btn   = document.getElementById(`mh-hybrid-btn-${hyb.rowId}`);
      const panel = document.getElementById(`mh-hybrid-panel-${hyb.rowId}`);
      const list  = document.getElementById(`mh-hybrid-list-${hyb.rowId}`);

      if(btn && panel && list){
        makeCombo({
          btn,
          panel,
          list,
          items: mockHybrids.map(m => ({
            id: m.id,
            label: `${m.name} (${m.maturity} RM)`
          })),
          formatter: x => x.label,
          onPick: it => {
            const found = mockHybrids.find(m => m.id === it.id);
            hyb.productId = it.id;
            hyb.name = found ? found.name : '';
            hyb.maturity = found ? found.maturity : null;
            renderStage();
          }
        });
      }

      const checkEl = stageShell.querySelector(`.check-indicator[data-row-id="${hyb.rowId}"]`);
      if(checkEl){
        checkEl.addEventListener('click', () => {
          if(!hyb.productId) return;
          mhState.checkProductId = hyb.productId;
          renderStage();
        });
      }

      const removeBtn = stageShell.querySelector(`.row-remove[data-row-id="${hyb.rowId}"]`);
      if(removeBtn){
        removeBtn.addEventListener('click', () => {
          const idx = mhState.hybrids.findIndex(h => h.rowId === hyb.rowId);
          if(idx !== -1) mhState.hybrids.splice(idx,1);
          if(mhState.hybrids.every(h => h.productId !== mhState.checkProductId)){
            mhState.checkProductId = null;
          }
          renderStage();
        });
      }
    });
  }

  function renderBlocks(){
    if(!stageShell) return;
    const blocks = mhState.blocks;
    const lengthFt = mhState.passLengthFt;
    const widthFt  = mhState.passWidthFt;
    let html = '';

    html += `
      <div class="blocks-panel">
        <div class="blocks-panel-header">
          Plot length: <strong>${lengthFt} ft</strong> • Pass width: <strong>${widthFt} ft</strong> • Area per strip:
          <strong>${formatNumber((lengthFt*widthFt)/43560,3)} ac</strong>
        </div>
    `;

    if(!blocks.length){
      html += `<p class="muted">No blocks generated. Hit Set Up Plot and try again.</p>`;
    }else{
      blocks.forEach((blk, idx) => {
        const isCheck = mhState.checkProductId && blk.productId === mhState.checkProductId;
        const badYield = blk.yieldBuPerAc != null && (blk.yieldBuPerAc < 50 || blk.yieldBuPerAc > 400);
        const notesVal = blk.notes || '';
        const files = blk.files || [];

        html += `
          <div class="yield-block-card" data-row-id="${blk.rowId}">
            <div class="yield-block-head">
              <div>
                <div class="yield-block-title">
                  Entry ${idx+1} · ${blk.name || 'Variety'}
                  ${isCheck ? '<span class="badge-check">Check</span>' : ''}
                  ${blk.voided ? '<span class="badge-void">Voided</span>' : ''}
                </div>
                <div class="yield-block-sub">
                  ${blk.maturity ? `${blk.maturity} RM` : ''}
                </div>
              </div>
            </div>
            <div class="yield-block-grid">
              <label class="field-mini">
                <span>Moisture %</span>
                <input type="text" inputmode="decimal"
                       class="input" id="mh-moist-${blk.rowId}"
                       value="${blk.moisturePct != null ? formatNumber(blk.moisturePct,2) : ''}">
              </label>
              <label class="field-mini">
                <span>Weight (Lbs)</span>
                <input type="text" inputmode="numeric"
                       class="input" id="mh-weight-${blk.rowId}"
                       value="${blk.weightLbs != null ? formatWithCommas(blk.weightLbs) : ''}">
              </label>
              <div class="field-mini">
                <span>Yield (bu/ac)</span>
                <div id="mh-yield-${blk.rowId}" class="yield-value ${badYield ? 'bad' : ''}">
                  ${blk.yieldBuPerAc != null ? formatNumber(blk.yieldBuPerAc,2) : '—'}
                </div>
              </div>
            </div>
            <div class="void-row">
              <input type="checkbox" id="mh-void-${blk.rowId}" ${blk.voided ? 'checked' : ''}>
              <label for="mh-void-${blk.rowId}">Void this hybrid</label>
            </div>

            <div class="yield-extra">
              <div class="field-mini">
                <span>Notes</span>
                <div class="notes-shell">
                  <textarea class="input notes-input"
                            id="mh-notes-${blk.rowId}"
                            rows="2"
                            placeholder="Notes about this hybrid…">${notesVal}</textarea>
                  <button type="button"
                          class="mic-btn"
                          data-dict-target="mh-notes-${blk.rowId}"
                          data-dictation-target="#mh-notes-${blk.rowId}"
                          aria-label="Dictate notes">
                    <svg class="mic-svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0 1 1 0 0 0-2 0 7 7 0 0 0 6 6.92V20H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-2.08A7 7 0 0 0 19 11a1 1 0 0 0-2 0z"></path>
                    </svg>
                  </button>
                </div>
              </div>
              <div class="field-mini">
                <span>Attachments (max 5)</span>
                <div class="files-shell">
                  <input type="file"
                         id="mh-files-input-${blk.rowId}"
                         class="hidden-file"
                         multiple>
                  <button type="button"
                          class="btn btn-small"
                          id="mh-files-btn-${blk.rowId}">
                    Add files (${files.length}/5)
                  </button>
                  <ul class="file-list" id="mh-files-list-${blk.rowId}">
                    ${files.map((f, i) => `
                      <li data-idx="${i}">
                        <span class="file-name">${f.name}</span>
                        <button type="button" class="file-remove" aria-label="Remove file">&times;</button>
                      </li>
                    `).join('')}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        `;
      });
    }

    html += `</div>`;
    stageShell.innerHTML = html;

    mhState.blocks.forEach(blk => {
      const moistEl = document.getElementById(`mh-moist-${blk.rowId}`);
      const weightEl = document.getElementById(`mh-weight-${blk.rowId}`);
      const yieldEl  = document.getElementById(`mh-yield-${blk.rowId}`);
      const voidEl   = document.getElementById(`mh-void-${blk.rowId}`);
      const notesEl  = document.getElementById(`mh-notes-${blk.rowId}`);
      const filesInput = document.getElementById(`mh-files-input-${blk.rowId}`);
      const filesBtn   = document.getElementById(`mh-files-btn-${blk.rowId}`);
      const filesList  = document.getElementById(`mh-files-list-${blk.rowId}`);

      function updateYieldDisplay(){
        if(!yieldEl) return;
        if(blk.yieldBuPerAc != null){
          yieldEl.textContent = formatNumber(blk.yieldBuPerAc,2);
          const bad = blk.yieldBuPerAc < 50 || blk.yieldBuPerAc > 400;
          yieldEl.classList.toggle('bad', bad);
        }else{
          yieldEl.textContent = '—';
          yieldEl.classList.remove('bad');
        }
      }

      function recalcYield(){
        blk.yieldBuPerAc = calcDevYield({
          cropKind: mhState.cropKind,
          moisturePct: blk.moisturePct,
          wetWeightLbs: blk.weightLbs,
          lengthFt: mhState.passLengthFt,
          widthFt: mhState.passWidthFt
        });
        updateYieldDisplay();
        renderDevSummary();
      }

      if(moistEl){
        moistEl.dataset.prev = moistEl.value;

        moistEl.addEventListener('input', e => {
          const oldVal = e.target.dataset.prev || '';
          let v = e.target.value;

          v = v.replace(/[^0-9.]/g,'');
          const parts = v.split('.');
          if(parts.length > 2){
            v = oldVal;
          }else if(parts.length === 2 && parts[1].length > 2){
            v = oldVal;
          }

          e.target.value = v;
          e.target.dataset.prev = v;
          blk.moisturePct = v === '' ? null : Number(v);
          recalcYield();
        });

        moistEl.addEventListener('blur', e => {
          let v = e.target.value;
          if(v === ''){
            blk.moisturePct = null;
            recalcYield();
            return;
          }
          v = v.replace(/[^0-9.]/g,'');
          const parts = v.split('.');
          if(parts.length > 2){
            v = parts[0] + '.' + parts.slice(1).join('');
          }
          const num = Number(v);
          blk.moisturePct = isFinite(num) ? num : null;
          e.target.value = blk.moisturePct != null ? blk.moisturePct.toFixed(2) : '';
          recalcYield();
        });
      }

      if(weightEl){
        weightEl.addEventListener('input', e => {
          let v = e.target.value.replace(/\D/g,'');
          e.target.value = v;
          blk.weightLbs = v === '' ? null : Number(v);
          recalcYield();
        });
        weightEl.addEventListener('blur', e => {
          if(blk.weightLbs != null){
            e.target.value = formatWithCommas(blk.weightLbs);
          }
        });
      }

      if(voidEl){
        voidEl.addEventListener('change', e => {
          blk.voided = e.target.checked;
          renderBlocks(); // notes/files live in blk.* so they persist
        });
      }

      if(notesEl){
        notesEl.addEventListener('input', e => {
          blk.notes = e.target.value;
        });
      }

      if(filesBtn && filesInput && filesList){
        if(!Array.isArray(blk.files)) blk.files = [];

        function renderFileList(){
          const files = blk.files || [];
          filesList.innerHTML = files.map((f, i) => `
            <li data-idx="${i}">
              <span class="file-name">${f.name}</span>
              <button type="button" class="file-remove" aria-label="Remove file">&times;</button>
            </li>
          `).join('');
          filesBtn.textContent = `Add files (${files.length}/5)`;
        }

        renderFileList();

        filesBtn.addEventListener('click', () => {
          filesInput.click();
        });

        filesInput.addEventListener('change', e => {
          const selected = Array.from(e.target.files || []);
          if(!selected.length) return;
          if(!Array.isArray(blk.files)) blk.files = [];
          const spaceLeft = Math.max(0, 5 - blk.files.length);
          const toAdd = selected.slice(0, spaceLeft);
          toAdd.forEach(f => {
            blk.files.push({
              name: f.name,
              size: f.size,
              type: f.type
            });
          });
          filesInput.value = '';
          renderFileList();
        });

        filesList.addEventListener('click', e => {
          const li = e.target.closest('li');
          if(!li) return;
          if(e.target.classList.contains('file-remove')){
            const idx = Number(li.dataset.idx);
            if(!isNaN(idx)){
              blk.files.splice(idx,1);
              renderFileList();
            }
          }
        });
      }
    });
  }

  function renderStage(){
    if(btnSetUpPlot){
      btnSetUpPlot.textContent = mhState.blocks.length ? 'Edit Plot Setup' : 'Set Up Plot';
    }
    if(mhState.stage === 'setup'){
      renderSetup();
    }else{
      renderBlocks();
    }
    renderDevSummary();
  }

  // ===================== Wire global listeners =====================
  if(btnOpenModal) btnOpenModal.addEventListener('click', openModal);
  if(devFieldCard) devFieldCard.addEventListener('click', openModal);
  if(btnClose)     btnClose.addEventListener('click', closeModal);

  // close on ESC when modal open
  document.addEventListener('keydown', e => {
    if(e.key === 'Escape'){
      if(!modalBackdrop?.classList.contains('hidden')){
        closeModal();
      }
      closeAllCombos();
    }
  });

  document.addEventListener('click', () => closeAllCombos());

  // Set Up Plot button:
  // - In setup: focus length
  // - In blocks: jump back to setup for editing
  if(btnSetUpPlot){
    btnSetUpPlot.addEventListener('click', () => {
      if(mhState.stage === 'setup'){
        const lenInput = document.getElementById('mh-length-input');
        if(lenInput) lenInput.focus();
      }else{
        mhState.stage = 'setup';
        renderStage();
      }
    });
  }

  if(btnOk){
    btnOk.addEventListener('click', () => {
      if(mhState.stage === 'setup'){
        if(!validateSetup()) return;
        mhState.blocks = mhState.hybrids.map(h => ({
          rowId: h.rowId,
          productId: h.productId,
          name: h.name,
          maturity: h.maturity,
          moisturePct: null,
          weightLbs: null,
          yieldBuPerAc: null,
          voided: false,
          notes: '',
          files: []
        }));
        mhState.stage = 'blocks';
        renderStage();
        return;
      }

      console.log('Multi-Hybrid Helper Save', JSON.parse(JSON.stringify(mhState)));
      alert('Dev helper only. In the real app this would save to Firestore and close.');
      closeModal();
    });
  }

  // Initial so summary is ready even before open
  renderStage();

  // Public API the Trials page can use later if needed
  return {
    open: openModal,
    close: closeModal,
    getState: () => JSON.parse(JSON.stringify(mhState)),
    setStage: (stage) => { mhState.stage = stage; renderStage(); }
  };
}

// JS file ends here.
</script>
