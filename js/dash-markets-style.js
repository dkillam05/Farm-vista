/* =====================================================================
/Farm-vista/js/dash-markets-style.js  (FULL FILE)
Rev: 2026-01-28b
Purpose:
✅ Restores Markets modal styling after UI split
✅ Fixes badge styling:
   - green/red background depending on direction
   - white text ALWAYS

CHANGE (critical):
✅ Force badge colors to WIN even if older/yellow CSS exists elsewhere:
   - background/border/color use !important
   - targets both .fv-mktm-badge and [data-q="badge"]
✅ Also covers legacy/alternate badge class names if they exist:
   - .fv-mkt-badge, .fv-mkt-pill (safe no-op if unused)
===================================================================== */

(function(){
  "use strict";

  if (document.getElementById("fv-mkt-style-split")) return;

  const UP_BG = "#2F6C3C";
  const DOWN_BG = "#b42318";
  const FLAT_BG = "#67706B";

  const css = `
/* Backdrop + modal shell */
#fv-mkt-backdrop{
  position:fixed;
  inset:0;
  background:rgba(15,23,42,0.45);
  display:none;
  z-index:9999;
}
#fv-mkt-backdrop.open{
  display:flex;
  align-items:center;
  justify-content:center;
}

#fv-mkt-modal{
  width:min(1100px, calc(100vw - 24px));
  max-height:calc(100vh - 120px);
  overflow:auto;
  background:var(--surface,#fff);
  border:1px solid var(--border,#d1d5db);
  border-radius:18px;
  box-shadow:0 18px 40px rgba(0,0,0,0.30);
  padding:14px 14px 16px;
  -ms-overflow-style:none;
  scrollbar-width:none;
  position:relative;
}
#fv-mkt-modal::-webkit-scrollbar{ width:0; height:0; }

.fv-mktm-head{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
  margin:0 0 10px 0;
}
.fv-mktm-title{ font-size:15px; font-weight:800; margin:0; }
.fv-mktm-actions{ display:flex; gap:8px; align-items:center; }
.fv-mktm-btn{
  appearance:none;
  border:1px solid var(--border,#d1d5db);
  background:var(--surface,#fff);
  border-radius:999px;
  padding:7px 10px;
  font-size:12px;
  color:var(--muted,#67706B);
  cursor:pointer;
}
.fv-mktm-btn:active{ transform:scale(.99); }

/* Layout */
.fv-mktm-grid{
  display:grid;
  grid-template-columns:1fr;
  gap:12px;
}
@media (min-width: 900px){
  .fv-mktm-grid.fv-mktm-split{ grid-template-columns:360px 1fr; }
}
.fv-mktm-grid.fv-mktm-chartonly{ grid-template-columns:1fr !important; }

/* List */
.fv-mktm-list{
  border:1px solid rgba(0,0,0,.12);
  border-radius:14px;
  padding:10px;
  background:var(--card-surface, var(--surface,#fff));
  max-height:520px;
  overflow:auto;
}
.fv-mktm-row{
  width:100%;
  text-align:left;
  appearance:none;
  border:1px solid rgba(0,0,0,.10);
  background:var(--surface,#fff);
  border-radius:12px;
  padding:10px 10px;
  cursor:pointer;
  margin:0 0 8px 0;
  color:inherit;
}
.fv-mktm-row:last-child{ margin-bottom:0; }
.fv-mktm-row[aria-current="true"]{
  border-color:rgba(59,126,70,.70);
  box-shadow:0 0 0 2px rgba(59,126,70,.22);
}

.fv-mktm-row-inner{
  display:flex;
  justify-content:space-between;
  align-items:center;
  gap:12px;
}
.fv-mktm-row-left{ display:flex; flex-direction:column; min-width:0; }
.fv-mktm-sym{ font-weight:900; letter-spacing:.02em; }
.fv-mktm-label{
  font-size:12px;
  opacity:.78;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
.fv-mktm-row-right{ display:flex; flex-direction:column; align-items:flex-end; gap:2px; flex:0 0 auto; }
.fv-mktm-price{ font-weight:900; font-variant-numeric:tabular-nums; }

/* =========================================================
   Badge: red/green background, WHITE text always
   (Force override of any prior yellow/legacy badge CSS)
   ========================================================= */

/* Target both class + attribute so this works even if markup changes */
.fv-mktm-badge,
.fv-mktm-row [data-q="badge"],
.fv-mkt-badge,
.fv-mkt-pill{
  display:inline-flex;
  align-items:center;
  gap:6px;
  font-size:12px;
  padding:4px 8px;
  border-radius:999px;
  border:1px solid rgba(0,0,0,.12);
  font-variant-numeric:tabular-nums;
  color:#fff !important;
  background: ${FLAT_BG} !important;
  border-color:${FLAT_BG} !important;
}
.fv-mktm-badge *,
.fv-mktm-row [data-q="badge"] *,
.fv-mkt-badge *,
.fv-mkt-pill *{ color:#fff !important; }

.fv-mktm-badge.up,
.fv-mktm-row [data-q="badge"].up,
.fv-mkt-badge.up,
.fv-mkt-pill.up{
  background:${UP_BG} !important;
  border-color:${UP_BG} !important;
}

.fv-mktm-badge.down,
.fv-mktm-row [data-q="badge"].down,
.fv-mkt-badge.down,
.fv-mkt-pill.down{
  background:${DOWN_BG} !important;
  border-color:${DOWN_BG} !important;
}

.fv-mktm-badge.flat,
.fv-mktm-row [data-q="badge"].flat,
.fv-mkt-badge.flat,
.fv-mkt-pill.flat{
  background:${FLAT_BG} !important;
  border-color:${FLAT_BG} !important;
}

.fv-mktm-badge .arr,
.fv-mktm-row [data-q="badge"] .arr,
.fv-mkt-badge .arr,
.fv-mkt-pill .arr{
  width:16px;
  text-align:center;
  font-weight:900;
}

/* Chart */
.fv-mktm-chart{
  border:1px solid rgba(0,0,0,.12);
  border-radius:14px;
  padding:10px 10px 12px;
  background:var(--card-surface, var(--surface,#fff));
}
.fv-mktm-chart-title{ font-size:13px; font-weight:800; margin:0 0 6px 0; }
.fv-mktm-sub{
  font-size:12px;
  color:var(--muted,#67706B);
  margin:4px 0 8px 0;
  display:flex;
  gap:8px;
  flex-wrap:wrap;
  align-items:center;
  justify-content:space-between;
}
.fv-mktm-tabs{ display:flex; gap:6px; flex-wrap:wrap; }
.fv-mktm-tab{
  appearance:none;
  border:1px solid rgba(0,0,0,.12);
  background:var(--surface,#fff);
  border-radius:999px;
  padding:6px 10px;
  font-size:12px;
  color:inherit;
  cursor:pointer;
}
.fv-mktm-tab[aria-selected="true"]{
  border-color:rgba(59,126,70,.70);
  box-shadow:0 0 0 2px rgba(59,126,70,.22);
}

.fv-mktm-canvas{
  width:100%;
  height:280px;
  display:block;
  border-radius:12px;
  background:rgba(0,0,0,0.02);
}
@media (min-width: 900px){
  .fv-mktm-canvas{ height:440px; }
}
.fv-mktm-empty{ font-size:13px; color:var(--muted,#67706B); padding:10px 0; }
`;

  const st = document.createElement("style");
  st.id = "fv-mkt-style-split";
  st.textContent = css;
  document.head.appendChild(st);
})();
