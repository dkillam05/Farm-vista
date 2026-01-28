/* =====================================================================
/Farm-vista/js/dash-markets-ui.js  (FULL FILE)
Rev: 2026-01-28a
Purpose:
✅ Dashboard wiring for Markets:
   - Tap contract tile => open chart modal
   - "View more contracts" => open list modal for that crop
   - Tap list item => open chart
Uses:
  window.FVMarkets.fetchChart(symbol, mode)
  window.FVMarkets.getLast()
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

  function isMobile(){
    try{ return window.matchMedia && window.matchMedia("(max-width: 899px)").matches; }
    catch{ return false; }
  }

  function ensureModalStyles(){
    if (document.getElementById("fv-mkt-modal-style")) return;
    const st = document.createElement("style");
    st.id = "fv-mkt-modal-style";
    st.textContent = `
#${BACKDROP_ID}{
  position:fixed; inset:0;
  background:rgba(15,23,42,0.45);
  display:none;
  z-index:9999;
}
#${BACKDROP_ID}.open{ display:flex; align-items:center; justify-content:center; }

#${MODAL_ID}{
  width:min(920px, calc(100vw - 24px));
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

.fv-mktm-head{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
  margin:0 0 10px 0;
}
.fv-mktm-title{
  font-size:15px;
  font-weight:800;
  margin:0;
}
.fv-mktm-actions{
  display:flex;
  gap:8px;
  align-items:center;
}
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
.fv-mktm-btn.primary{
  background:#3B7E46;
  border-color:#3B7E46;
  color:#fff;
}
.fv-mktm-btn.primary *{ color:#fff; }
.fv-mktm-btn:active{ transform:scale(.99); }

.fv-mktm-grid{
  display:grid;
  grid-template-columns: 1fr;
  gap:12px;
}
@media (min-width: 900px){
  .fv-mktm-grid{ grid-template-columns: 320px 1fr; }
}

.fv-mktm-list{
  border:1px solid rgba(0,0,0,.12);
  border-radius:14px;
  padding:10px;
  background:var(--card-surface, var(--surface,#fff));
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
.fv-mktm-sym{ font-weight:900; letter-spacing:.02em; }
.fv-mktm-label{ font-size:12px; opacity:.78; }

.fv-mktm-chart{
  border:1px solid rgba(0,0,0,.12);
  border-radius:14px;
  padding:10px 10px 12px;
  background:var(--card-surface, var(--surface,#fff));
}
.fv-mktm-sub{
  font-size:12px;
  color:var(--muted,#67706B);
  margin:4px 0 8px 0;
}
.fv-mktm-canvas{
  width:100%;
  height:220px;
  display:block;
  border-radius:12px;
  background:rgba(0,0,0,0.02);
}
.fv-mktm-empty{
  font-size:13px;
  color:var(--muted,#67706B);
  padding:10px 0;
}
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

    back.addEventListener("click", (e)=>{
      // click outside modal closes
      if (e.target === back) closeModal();
    });

    back.querySelector("#fv-mktm-close").addEventListener("click", closeModal);

    document.addEventListener("keydown", (e)=>{
      if (e.key === "Escape") closeModal();
    });

    return back;
  }

  function openModal(){
    const back = ensureModal();
    back.classList.add("open");
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

  function pickBars(chart){
    return Array.isArray(chart)
      ? chart
      : (chart && (chart.bars || chart.data || chart.series)) || [];
  }

  function toNum(x){
    if (typeof x === "number" && isFinite(x)) return x;
    if (typeof x === "string"){
      const v = parseFloat(x);
      return (isFinite(v) ? v : null);
    }
    return null;
  }

  function extractCloses(bars){
    const out = [];
    for (const b of (bars || [])){
      const c = toNum(b?.c ?? b?.close ?? b?.Close);
      const t = b?.t ?? b?.time ?? b?.date ?? null;
      if (c != null) out.push({ c, t });
    }
    return out;
  }

  function drawLine(canvas, points){
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // size canvas to display size
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, rect.width, rect.height);

    if (!points || points.length < 2){
      ctx.globalAlpha = 0.75;
      ctx.font = "13px system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.fillText("No chart data", 12, 24);
      return;
    }

    const vals = points.map(p => p.c);
    let min = Math.min(...vals);
    let max = Math.max(...vals);
    if (!isFinite(min) || !isFinite(max)) return;
    if (min === max){ min -= 1; max += 1; }

    const pad = 12;
    const W = rect.width;
    const H = rect.height;

    // axes baseline (subtle)
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.moveTo(pad, H - pad);
    ctx.lineTo(W - pad, H - pad);
    ctx.stroke();

    ctx.globalAlpha = 1;

    const n = points.length;
    const xFor = (i)=> pad + (i * (W - pad*2) / (n - 1));
    const yFor = (v)=> pad + ((max - v) * (H - pad*2) / (max - min));

    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(xFor(0), yFor(points[0].c));
    for (let i = 1; i < n; i++){
      ctx.lineTo(xFor(i), yFor(points[i].c));
    }
    ctx.stroke();

    // last value
    const last = points[n-1].c;
    ctx.globalAlpha = 0.8;
    ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.fillText(`Last: ${last.toFixed(2)}`, pad, pad + 12);
    ctx.globalAlpha = 1;
  }

  async function openChart(symbol){
    openModal();
    setModalTitle(symbol || "Chart");
    setModalBody(`
      <div class="fv-mktm-grid">
        <div class="fv-mktm-list">
          <div class="fv-mktm-empty">Loading chart…</div>
        </div>
        <div class="fv-mktm-chart">
          <div class="fv-mktm-sub">Daily (line from closes)</div>
          <canvas class="fv-mktm-canvas" id="fv-mktm-canvas"></canvas>
          <div class="fv-mktm-sub" id="fv-mktm-note"></div>
        </div>
      </div>
    `);

    // left side empty for chart-only view on tile tap
    const listEl = document.querySelector(".fv-mktm-list");
    if (listEl) listEl.innerHTML = `<div class="fv-mktm-empty">Chart</div>`;

    try{
      const chart = await window.FVMarkets.fetchChart(symbol, "daily");
      const bars = pickBars(chart);
      const closes = extractCloses(bars);
      const canvas = document.getElementById("fv-mktm-canvas");
      drawLine(canvas, closes.slice(-180)); // keep it light
      const note = document.getElementById("fv-mktm-note");
      if (note){
        note.textContent = closes.length ? `Points: ${closes.length}` : "No closes found.";
      }
    } catch (e){
      const note = document.getElementById("fv-mktm-note");
      if (note) note.textContent = `Chart load failed: ${e?.message || "error"}`;
    }
  }

  function openContractsList(crop){
    const last = window.FVMarkets?.getLast?.() || null;
    const list = (crop === "corn") ? (last?.corn || []) : (last?.soy || []);
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
          <div class="fv-mktm-sub">Tap a contract to open chart</div>
          <canvas class="fv-mktm-canvas" id="fv-mktm-canvas"></canvas>
          <div class="fv-mktm-sub" id="fv-mktm-note"></div>
        </div>
      </div>
    `);

    // wire list clicks
    document.querySelectorAll("[data-mkt-sym]").forEach(btn=>{
      btn.addEventListener("click", async ()=>{
        const sym = btn.getAttribute("data-mkt-sym");
        if (!sym) return;
        setModalTitle(sym);
        const note = document.getElementById("fv-mktm-note");
        if (note) note.textContent = "Loading chart…";
        try{
          const chart = await window.FVMarkets.fetchChart(sym, "daily");
          const bars = pickBars(chart);
          const closes = extractCloses(bars);
          drawLine(document.getElementById("fv-mktm-canvas"), closes.slice(-180));
          if (note) note.textContent = closes.length ? `Points: ${closes.length}` : "No closes found.";
        } catch (e){
          if (note) note.textContent = `Chart load failed: ${e?.message || "error"}`;
        }
      });
    });
  }

  // Event wiring
  function onContractTap(e){
    const sym = e?.detail?.symbol;
    if (!sym) return;
    openChart(sym);
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