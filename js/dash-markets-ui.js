/* =====================================================================
/Farm-vista/js/dash-markets-ui.js  (FULL FILE)
Rev: 2026-01-28e
Fixes:
✅ Bigger charts on desktop
✅ Color: true green/red candles + visible line in dark mode
✅ Remove blank left pane on chart-only modal
✅ Hide contracts that don’t fetch data (dead/nodata)
✅ Modes: daily/weekly candles, 6mo/1y/all line
===================================================================== */

(function(){
  "use strict";

  const MODAL_ID = "fv-mkt-modal";
  const BACKDROP_ID = "fv-mkt-backdrop";

  function escapeHtml(s){
    return String(s || "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  function ensureModalStyles(){
    if (document.getElementById("fv-mkt-modal-style")) return;
    const st = document.createElement("style");
    st.id = "fv-mkt-modal-style";
    st.textContent = `
#${BACKDROP_ID}{ position:fixed; inset:0; background:rgba(15,23,42,0.45); display:none; z-index:9999; }
#${BACKDROP_ID}.open{ display:flex; align-items:center; justify-content:center; padding:12px; }

#${MODAL_ID}{
  width:min(1120px, calc(100vw - 24px));
  max-height:calc(100vh - 120px);
  overflow:auto;
  background:var(--surface,#fff);
  border:1px solid var(--border,#d1d5db);
  border-radius:18px;
  box-shadow:0 18px 40px rgba(0,0,0,0.30);
  padding:14px 14px 16px;
  -ms-overflow-style:none;
  scrollbar-width:none;
}
#${MODAL_ID}::-webkit-scrollbar{ width:0; height:0; }

.fv-mktm-head{ display:flex; align-items:center; justify-content:space-between; gap:10px; margin:0 0 10px 0; }
.fv-mktm-title{ font-size:15px; font-weight:900; margin:0; }
.fv-mktm-actions{ display:flex; gap:8px; align-items:center; }
.fv-mktm-btn{
  appearance:none; border:1px solid var(--border,#d1d5db); background:var(--surface,#fff);
  border-radius:999px; padding:7px 10px; font-size:12px; color:var(--muted,#67706B); cursor:pointer;
}
.fv-mktm-btn:active{ transform:scale(.99); }

.fv-mktm-grid{ display:grid; grid-template-columns:1fr; gap:12px; }
@media (min-width: 900px){ .fv-mktm-grid{ grid-template-columns: 360px 1fr; } }

.fv-mktm-list{ border:1px solid rgba(0,0,0,.12); border-radius:14px; padding:10px; background:var(--card-surface, var(--surface,#fff)); }
.fv-mktm-row{
  width:100%; text-align:left; appearance:none; border:1px solid rgba(0,0,0,.10); background:var(--surface,#fff);
  border-radius:12px; padding:10px 10px; cursor:pointer; margin:0 0 8px 0; color:inherit;
}
.fv-mktm-row:last-child{ margin-bottom:0; }
.fv-mktm-sym{ font-weight:900; letter-spacing:.02em; }
.fv-mktm-label{ font-size:12px; opacity:.78; }

.fv-mktm-chart{ border:1px solid rgba(0,0,0,.12); border-radius:14px; padding:10px 10px 12px; background:var(--card-surface, var(--surface,#fff)); }
.fv-mktm-sub{ font-size:12px; color:var(--muted,#67706B); margin:4px 0 8px 0; display:flex; gap:10px; flex-wrap:wrap; align-items:center; justify-content:space-between; }
.fv-mktm-tabs{ display:flex; gap:6px; flex-wrap:wrap; }
.fv-mktm-tab{
  appearance:none; border:1px solid rgba(0,0,0,.12); background:var(--surface,#fff);
  border-radius:999px; padding:6px 10px; font-size:12px; color:inherit; cursor:pointer;
}
.fv-mktm-tab[aria-selected="true"]{ border-color:rgba(59,126,70,.70); box-shadow:0 0 0 2px rgba(59,126,70,.22); }
.fv-mktm-canvas{ width:100%; height:260px; display:block; border-radius:12px; background:rgba(0,0,0,0.02); }
@media (min-width: 900px){ .fv-mktm-canvas{ height:420px; } }

.fv-mktm-empty{ font-size:13px; color:var(--muted,#67706B); padding:10px 0; }
.fv-mktm-kpis{ display:flex; gap:10px; flex-wrap:wrap; }
.fv-mktm-k{ font-variant-numeric:tabular-nums; font-weight:800; color:inherit; }
.fv-mktm-k.small{ font-weight:700; opacity:.8; }
`;
    document.head.appendChild(st);
  }

  function ensureModal(){
    ensureModalStyles();
    let back = document.getElementById(BACKDROP_ID);
    if (back) return back;

    back = document.createElement("div");
    back.id = BACKDROP_ID;
    back.setAttribute("role", "presentation");
    back.innerHTML = `
      <div id="${MODAL_ID}" role="dialog" aria-modal="true" aria-label="Markets">
        <div class="fv-mktm-head">
          <h2 class="fv-mktm-title" id="fv-mktm-title">Markets</h2>
          <div class="fv-mktm-actions">
            <button type="button" class="fv-mktm-btn" id="fv-mktm-close">Close</button>
          </div>
        </div>
        <div id="fv-mktm-body"></div>
      </div>
    `;
    document.body.appendChild(back);

    back.addEventListener("click", (e)=>{ if (e.target === back) closeModal(); });
    back.querySelector("#fv-mktm-close").addEventListener("click", closeModal);
    document.addEventListener("keydown", (e)=>{ if (e.key === "Escape") closeModal(); });

    return back;
  }

  function openModal(){
    ensureModal().classList.add("open");
    document.body.style.overflow = "hidden";
  }

  function closeModal(){
    const back = document.getElementById(BACKDROP_ID);
    if (!back) return;
    back.classList.remove("open");
    document.body.style.overflow = "";
  }

  function setModalTitle(t){
    const el = document.getElementById("fv-mktm-title");
    if (el) el.textContent = t || "Markets";
  }

  function setModalBody(html){
    const body = document.getElementById("fv-mktm-body");
    if (body) body.innerHTML = html || "";
  }

  function normalizePoints(chart){
    if (Array.isArray(chart)) return chart;
    if (!chart) return [];
    return chart.points || chart.bars || chart.data || chart.series || [];
  }

  function toNum(x){
    if (typeof x === "number" && isFinite(x)) return x;
    if (typeof x === "string"){
      const v = parseFloat(x);
      return (isFinite(v) ? v : null);
    }
    return null;
  }

  function prepCanvas(canvas){
    const ctx = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    return { ctx, rect };
  }

  // More color:
  const GREEN = "#2F6C3C";
  const RED   = "#b42318";
  const WICK  = "rgba(90,100,95,.8)";
  function lineColor(){
    // bright-ish green that reads in dark mode too
    return "rgba(59, 158, 92, 0.95)";
  }

  function drawLine(canvas, points){
    if (!canvas) return;
    const { ctx, rect } = prepCanvas(canvas);

    const closes = (points || [])
      .map(p => ({ c: toNum(p?.c), t: p?.tUtc ?? p?.t ?? p?.time ?? p?.date ?? null }))
      .filter(x => x.c != null);

    if (closes.length < 2){
      ctx.globalAlpha = 0.75;
      ctx.font = "13px system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.fillStyle = "rgba(120,130,125,.9)";
      ctx.fillText("No chart data", 12, 24);
      return;
    }

    const vals = closes.map(p => p.c);
    let min = Math.min(...vals);
    let max = Math.max(...vals);
    if (!isFinite(min) || !isFinite(max)) return;
    if (min === max){ min -= 1; max += 1; }

    const pad = 12, W = rect.width, H = rect.height;

    // baseline
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = "rgba(120,130,125,.8)";
    ctx.beginPath();
    ctx.moveTo(pad, H - pad);
    ctx.lineTo(W - pad, H - pad);
    ctx.stroke();
    ctx.globalAlpha = 1;

    const n = closes.length;
    const xFor = (i)=> pad + (i * (W - pad*2) / (n - 1));
    const yFor = (v)=> pad + ((max - v) * (H - pad*2) / (max - min));

    ctx.lineWidth = 3;
    ctx.strokeStyle = lineColor();
    ctx.beginPath();
    ctx.moveTo(xFor(0), yFor(closes[0].c));
    for (let i = 1; i < n; i++) ctx.lineTo(xFor(i), yFor(closes[i].c));
    ctx.stroke();
  }

  function drawCandles(canvas, points){
    if (!canvas) return;
    const { ctx, rect } = prepCanvas(canvas);

    const rows = (points || [])
      .map(p => ({
        o: toNum(p?.o), h: toNum(p?.h), l: toNum(p?.l), c: toNum(p?.c)
      }))
      .filter(r => r.o != null && r.h != null && r.l != null && r.c != null);

    if (rows.length < 2){
      ctx.globalAlpha = 0.75;
      ctx.font = "13px system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.fillStyle = "rgba(120,130,125,.9)";
      ctx.fillText("No candle data", 12, 24);
      return;
    }

    const highs = rows.map(r => r.h);
    const lows  = rows.map(r => r.l);
    let min = Math.min(...lows);
    let max = Math.max(...highs);
    if (!isFinite(min) || !isFinite(max)) return;
    if (min === max){ min -= 1; max += 1; }

    const pad = 12, W = rect.width, H = rect.height;
    const n = rows.length;

    const yFor = (v)=> pad + ((max - v) * (H - pad*2) / (max - min));
    const slot = (W - pad*2) / n;
    const bodyW = Math.max(4, Math.min(12, slot * 0.6));
    const xFor = (i)=> pad + i * slot + slot/2;

    // baseline
    ctx.globalAlpha = 0.20;
    ctx.strokeStyle = "rgba(120,130,125,.8)";
    ctx.beginPath();
    ctx.moveTo(pad, H - pad);
    ctx.lineTo(W - pad, H - pad);
    ctx.stroke();
    ctx.globalAlpha = 1;

    for (let i = 0; i < n; i++){
      const r = rows[i];
      const x = xFor(i);
      const yH = yFor(r.h);
      const yL = yFor(r.l);
      const yO = yFor(r.o);
      const yC = yFor(r.c);

      const up = r.c >= r.o;
      const color = up ? GREEN : RED;

      // wick
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = WICK;
      ctx.beginPath();
      ctx.moveTo(x, yH);
      ctx.lineTo(x, yL);
      ctx.stroke();

      // body
      const top = Math.min(yO, yC);
      const bot = Math.max(yO, yC);
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = color;
      ctx.fillRect(x - bodyW/2, top, bodyW, Math.max(2, bot - top));
      ctx.globalAlpha = 1;
    }
  }

  async function loadAndRender(symbol, mode){
    const note = document.getElementById("fv-mktm-note");
    if (note) note.textContent = "Loading…";

    try{
      const chart = await window.FVMarkets.fetchChart(symbol, mode);
      const points = normalizePoints(chart);
      const canvas = document.getElementById("fv-mktm-canvas");

      if (mode === "daily" || mode === "weekly") drawCandles(canvas, points);
      else drawLine(canvas, points);

      if (note) note.textContent = points?.length ? `Points: ${points.length}` : "No points found.";
    } catch (e){
      if (note) note.textContent = `Chart failed: ${e?.message || "error"}`;
    }
  }

  function renderTabs(active){
    const modes = [
      ["daily", "Daily"],
      ["weekly", "Weekly"],
      ["6mo", "6mo"],
      ["1y", "1Y"],
      ["all", "All"]
    ];
    return `
      <div class="fv-mktm-tabs" role="tablist" aria-label="Chart range">
        ${modes.map(([m, label]) =>
          `<button class="fv-mktm-tab" data-mode="${m}" aria-selected="${m===active ? "true":"false"}">${label}</button>`
        ).join("")}
      </div>
    `;
  }

  function renderChartOnlyModal(symbol){
    openModal();
    setModalTitle(symbol || "Chart");

    // ✅ No blank left pane anymore
    setModalBody(`
      <div class="fv-mktm-chart">
        <div class="fv-mktm-sub">
          ${renderTabs("daily")}
          <div class="fv-mktm-kpis">
            <span class="fv-mktm-k small" id="fv-mktm-last"></span>
          </div>
        </div>
        <canvas class="fv-mktm-canvas" id="fv-mktm-canvas"></canvas>
        <div class="fv-mktm-sub" id="fv-mktm-note"></div>
      </div>
    `);

    loadAndRender(symbol, "daily");

    document.querySelectorAll(".fv-mktm-tab").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        document.querySelectorAll(".fv-mktm-tab").forEach(b=>b.setAttribute("aria-selected","false"));
        btn.setAttribute("aria-selected","true");
        loadAndRender(symbol, btn.getAttribute("data-mode") || "daily");
      });
    });
  }

  function openContractsList(crop){
    const last = window.FVMarkets?.getLast?.() || null;
    const raw = (crop === "corn") ? (last?.corn || []) : (last?.soy || []);

    // ✅ Hide dead/nodata in list view
    const list = raw.filter(c => {
      const sym = c?.symbol;
      if (!sym) return false;
      const st = window.FVMarkets?.getSymbolState?.(sym) || "unknown";
      return st !== "dead" && st !== "nodata";
    });

    const title = (crop === "corn") ? "Corn contracts" : "Soybean contracts";

    openModal();
    setModalTitle(title);

    const rows = (list || []).map(c => {
      const sym = c?.symbol || "";
      const label = c?.label || "";
      return `
        <button class="fv-mktm-row" data-mkt-sym="${escapeHtml(sym)}">
          <div class="fv-mktm-sym">${escapeHtml(sym)}</div>
          <div class="fv-mktm-label">${escapeHtml(label)}</div>
        </button>
      `;
    }).join("");

    setModalBody(`
      <div class="fv-mktm-grid">
        <div class="fv-mktm-list">
          ${rows || `<div class="fv-mktm-empty">No contracts</div>`}
        </div>

        <div class="fv-mktm-chart">
          <div class="fv-mktm-sub">
            ${renderTabs("daily")}
            <div class="fv-mktm-kpis">
              <span class="fv-mktm-k small" id="fv-mktm-last"></span>
            </div>
          </div>
          <canvas class="fv-mktm-canvas" id="fv-mktm-canvas"></canvas>
          <div class="fv-mktm-sub" id="fv-mktm-note"></div>
        </div>
      </div>
    `);

    let currentSymbol = null;

    const renderCurrent = ()=>{
      if (!currentSymbol){
        const note = document.getElementById("fv-mktm-note");
        if (note) note.textContent = "Tap a contract to load chart.";
        return;
      }
      const active = document.querySelector(".fv-mktm-tab[aria-selected='true']");
      const mode = active ? (active.getAttribute("data-mode") || "daily") : "daily";
      loadAndRender(currentSymbol, mode);
    };

    document.querySelectorAll(".fv-mktm-tab").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        document.querySelectorAll(".fv-mktm-tab").forEach(b=>b.setAttribute("aria-selected","false"));
        btn.setAttribute("aria-selected","true");
        renderCurrent();
      });
    });

    document.querySelectorAll("[data-mkt-sym]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        currentSymbol = btn.getAttribute("data-mkt-sym");
        if (!currentSymbol) return;
        setModalTitle(currentSymbol);
        renderCurrent();
      });
    });

    // auto-load first item
    if (list?.[0]?.symbol){
      currentSymbol = list[0].symbol;
      setModalTitle(currentSymbol);
      renderCurrent();
    }
  }

  function onContractTap(e){
    const sym = e?.detail?.symbol;
    if (!sym) return;
    renderChartOnlyModal(sym);
  }

  function onViewMore(e){
    const crop = (e?.detail?.crop || "").toLowerCase();
    if (crop !== "corn" && crop !== "soy") return;
    openContractsList(crop);
  }

  function init(){
    ensureModal();
    window.addEventListener("fv:markets:contractTap", onContractTap);
    window.addEventListener("fv:markets:viewMore", onViewMore);
  }

  if (document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", init, { once:true });
  } else {
    init();
  }

})();
