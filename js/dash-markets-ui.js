/* =====================================================================
/Farm-vista/js/dash-markets-ui.js  (FULL FILE)
Rev: 2026-01-28f

Adds:
✅ Chart tooltip on tap/click (price at cursor)
✅ Monthly mode (monthly candles computed from daily closes)
✅ Mobile "View more contracts": show tiles with quotes
✅ Tap contract tile => auto-scroll to chart on mobile
===================================================================== */

(function(){
  "use strict";

  const MODAL_ID = "fv-mkt-modal";
  const BACKDROP_ID = "fv-mkt-backdrop";

  // Candle colors (no blue)
  const GREEN = "#2F6C3C";
  const RED   = "#b42318";
  const WICK  = "rgba(90,100,95,.8)";
  const LINE  = "rgba(59, 158, 92, 0.95)";

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
@media (min-width: 900px){ .fv-mktm-grid{ grid-template-columns: 380px 1fr; } }

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

.fv-mktm-canvas-wrap{ position:relative; }
.fv-mktm-canvas{ width:100%; height:260px; display:block; border-radius:12px; background:rgba(0,0,0,0.02); }
@media (min-width: 900px){ .fv-mktm-canvas{ height:420px; } }

.fv-mktm-tooltip{
  position:absolute;
  pointer-events:none;
  transform:translate(-50%, -100%);
  padding:6px 8px;
  border-radius:10px;
  border:1px solid rgba(0,0,0,.18);
  background:var(--surface,#fff);
  box-shadow:0 10px 18px rgba(0,0,0,.18);
  font-size:12px;
  color:inherit;
  white-space:nowrap;
  opacity:0;
  transition:opacity .08s ease;
}
.fv-mktm-tooltip.show{ opacity:1; }

.fv-mktm-empty{ font-size:13px; color:var(--muted,#67706B); padding:10px 0; }

/* Modal tiles (mobile "view more"): reuse dashboard-like feel */
.fv-mktm-tiles{ display:flex; flex-direction:column; gap:8px; }
.fv-mktm-tile{
  appearance:none;
  width:100%;
  border:1px solid rgba(0,0,0,.12);
  background:var(--surface,#fff);
  border-radius:14px;
  padding:10px 12px;
  cursor:pointer;
  text-align:left;
  color:inherit;
}
.fv-mktm-tile:active{ transform:scale(.995); }
.fv-mktm-trow{ display:flex; justify-content:space-between; gap:10px; align-items:center; }
.fv-mktm-tleft{ min-width:0; }
.fv-mktm-tsym{ font-weight:900; letter-spacing:.02em; }
.fv-mktm-tlab{ font-size:12px; opacity:.78; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.fv-mktm-tright{ text-align:right; flex:0 0 auto; }
.fv-mktm-tprice{ font-weight:900; font-variant-numeric:tabular-nums; }
.fv-mktm-tchg{ font-size:12px; font-variant-numeric:tabular-nums; opacity:.9; display:flex; gap:6px; justify-content:flex-end; align-items:center; }
.fv-mktm-tchg.up{ color:#2F6C3C; }
.fv-mktm-tchg.down{ color:#b42318; }
.fv-mktm-tchg.flat{ color:var(--muted,#67706B); }
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

  function drawLine(canvas, points){
    if (!canvas) return { xToIndex: null, series: [] };
    const { ctx, rect } = prepCanvas(canvas);

    const series = (points || [])
      .map(p => ({ t: p?.tUtc ?? p?.t ?? p?.time ?? p?.date ?? null, c: toNum(p?.c) }))
      .filter(p => p.c != null);

    if (series.length < 2){
      ctx.globalAlpha = 0.75;
      ctx.font = "13px system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.fillStyle = "rgba(120,130,125,.9)";
      ctx.fillText("No chart data", 12, 24);
      return { xToIndex: null, series: [] };
    }

    const vals = series.map(p => p.c);
    let min = Math.min(...vals);
    let max = Math.max(...vals);
    if (!isFinite(min) || !isFinite(max)) return { xToIndex: null, series: [] };
    if (min === max){ min -= 1; max += 1; }

    const pad = 12, W = rect.width, H = rect.height;
    const n = series.length;

    const xFor = (i)=> pad + (i * (W - pad*2) / (n - 1));
    const yFor = (v)=> pad + ((max - v) * (H - pad*2) / (max - min));

    // baseline
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = "rgba(120,130,125,.8)";
    ctx.beginPath();
    ctx.moveTo(pad, H - pad);
    ctx.lineTo(W - pad, H - pad);
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.lineWidth = 3;
    ctx.strokeStyle = LINE;
    ctx.beginPath();
    ctx.moveTo(xFor(0), yFor(series[0].c));
    for (let i = 1; i < n; i++) ctx.lineTo(xFor(i), yFor(series[i].c));
    ctx.stroke();

    function xToIndex(x){
      const clamped = Math.max(pad, Math.min(W - pad, x));
      const t = (clamped - pad) / (W - pad*2);
      const idx = Math.round(t * (n - 1));
      return Math.max(0, Math.min(n - 1, idx));
    }

    return { xToIndex, series };
  }

  function drawCandles(canvas, points){
    if (!canvas) return { xToIndex: null, series: [] };
    const { ctx, rect } = prepCanvas(canvas);

    const series = (points || [])
      .map(p => ({
        t: p?.tUtc ?? p?.t ?? p?.time ?? p?.date ?? null,
        o: toNum(p?.o), h: toNum(p?.h), l: toNum(p?.l), c: toNum(p?.c)
      }))
      .filter(r => r.o != null && r.h != null && r.l != null && r.c != null);

    if (series.length < 2){
      ctx.globalAlpha = 0.75;
      ctx.font = "13px system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.fillStyle = "rgba(120,130,125,.9)";
      ctx.fillText("No candle data", 12, 24);
      return { xToIndex: null, series: [] };
    }

    const highs = series.map(r => r.h);
    const lows  = series.map(r => r.l);
    let min = Math.min(...lows);
    let max = Math.max(...highs);
    if (!isFinite(min) || !isFinite(max)) return { xToIndex: null, series: [] };
    if (min === max){ min -= 1; max += 1; }

    const pad = 12, W = rect.width, H = rect.height;
    const n = series.length;

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
      const r = series[i];
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

    function xToIndex(x){
      const clamped = Math.max(pad, Math.min(W - pad, x));
      const t = (clamped - pad) / (W - pad*2);
      const idx = Math.round(t * (n - 1));
      return Math.max(0, Math.min(n - 1, idx));
    }

    return { xToIndex, series };
  }

  // Monthly candles computed from daily closes (mode=all or 1y)
  function toMonthKey(iso){
    try{
      const d = new Date(iso);
      const y = d.getFullYear();
      const m = d.getMonth() + 1;
      return `${y}-${String(m).padStart(2,"0")}`;
    } catch {
      return null;
    }
  }

  function monthlyFromDaily(points){
    const daily = (points || [])
      .map(p => ({ t: p?.tUtc ?? p?.t ?? null, c: toNum(p?.c) }))
      .filter(p => p.t && p.c != null);

    const map = new Map(); // key -> { t, o,h,l,c }
    for (const p of daily){
      const key = toMonthKey(p.t);
      if (!key) continue;
      const cur = map.get(key);
      if (!cur){
        map.set(key, { t: `${key}-01T00:00:00.000Z`, o: p.c, h: p.c, l: p.c, c: p.c });
      } else {
        cur.h = Math.max(cur.h, p.c);
        cur.l = Math.min(cur.l, p.c);
        cur.c = p.c;
      }
    }

    // Sort by key
    const keys = Array.from(map.keys()).sort();
    return keys.map(k => map.get(k));
  }

  function renderTabs(active){
    const modes = [
      ["daily", "Daily"],
      ["weekly", "Weekly"],
      ["monthly", "Monthly"],
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

  // Tooltip helpers
  function fmtIsoShort(iso){
    try{
      const d = new Date(iso);
      return d.toLocaleString([], { year:"numeric", month:"short", day:"2-digit", hour:"numeric", minute:"2-digit" });
    } catch { return ""; }
  }

  function setTooltip(el, show, x, y, html){
    if (!el) return;
    if (!show){
      el.classList.remove("show");
      return;
    }
    el.innerHTML = html || "";
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.classList.add("show");
  }

  function attachChartTooltip(canvas, tooltipEl, getIndex, series, mode){
    if (!canvas || !tooltipEl || !getIndex || !Array.isArray(series) || !series.length) return;

    function handle(evt){
      const r = canvas.getBoundingClientRect();
      const x = (evt.clientX ?? (evt.touches?.[0]?.clientX)) - r.left;
      const y = (evt.clientY ?? (evt.touches?.[0]?.clientY)) - r.top;

      const idx = getIndex(x);
      const p = series[idx];
      if (!p) return;

      if (mode === "daily" || mode === "weekly" || mode === "monthly"){
        const t = p.t || "";
        const html =
          `<div><strong>${escapeHtml(fmtIsoShort(t))}</strong></div>` +
          `<div>O ${p.o.toFixed(2)} H ${p.h.toFixed(2)} L ${p.l.toFixed(2)} C ${p.c.toFixed(2)}</div>`;
        setTooltip(tooltipEl, true, x, y, html);
      } else {
        const t = p.t || "";
        const html =
          `<div><strong>${escapeHtml(fmtIsoShort(t))}</strong></div>` +
          `<div>Close ${p.c.toFixed(2)}</div>`;
        setTooltip(tooltipEl, true, x, y, html);
      }
    }

    function hide(){ setTooltip(tooltipEl, false); }

    // click/tap to show; move to update; leave to hide
    canvas.addEventListener("click", handle);
    canvas.addEventListener("mousemove", handle);
    canvas.addEventListener("mouseleave", hide);

    // touch
    canvas.addEventListener("touchstart", handle, { passive:true });
    canvas.addEventListener("touchmove", handle, { passive:true });
    canvas.addEventListener("touchend", hide);
  }

  async function loadAndRender(symbol, mode){
    const note = document.getElementById("fv-mktm-note");
    if (note) note.textContent = "Loading…";

    const canvas = document.getElementById("fv-mktm-canvas");
    const tooltip = document.getElementById("fv-mktm-tooltip");
    if (tooltip) setTooltip(tooltip, false);

    try{
      let points = [];
      let drawResult = { xToIndex:null, series:[] };

      if (mode === "monthly"){
        // build monthly candles from all (daily closes)
        const chart = await window.FVMarkets.fetchChart(symbol, "all");
        const raw = normalizePoints(chart);
        points = monthlyFromDaily(raw);
        drawResult = drawCandles(canvas, points);
      } else {
        const chart = await window.FVMarkets.fetchChart(symbol, mode);
        points = normalizePoints(chart);

        if (mode === "daily" || mode === "weekly"){
          drawResult = drawCandles(canvas, points);
        } else {
          drawResult = drawLine(canvas, points);
        }
      }

      // attach tooltip
      attachChartTooltip(canvas, tooltip, drawResult.xToIndex, drawResult.series, mode);

      if (note) note.textContent = points?.length ? `Points: ${points.length}` : "No points found.";
    } catch (e){
      if (note) note.textContent = `Chart failed: ${e?.message || "error"}`;
    }
  }

  function renderChartOnlyModal(symbol){
    openModal();
    setModalTitle(symbol || "Chart");

    setModalBody(`
      <div class="fv-mktm-chart" id="fv-mktm-chartCard">
        <div class="fv-mktm-sub">
          ${renderTabs("daily")}
        </div>

        <div class="fv-mktm-canvas-wrap" id="fv-mktm-chartWrap">
          <canvas class="fv-mktm-canvas" id="fv-mktm-canvas"></canvas>
          <div class="fv-mktm-tooltip" id="fv-mktm-tooltip"></div>
        </div>

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

  // Render modal tiles with quotes (like dashboard)
  function arrowDirFrom(chg){
    if (!(typeof chg === "number" && isFinite(chg))) return "flat";
    if (chg > 0) return "up";
    if (chg < 0) return "down";
    return "flat";
  }
  function arrowChar(dir){ return dir === "up" ? "▲" : dir === "down" ? "▼" : "—"; }

  function fmtPrice(v){ return (typeof v === "number" && isFinite(v)) ? v.toFixed(2) : "—"; }
  function fmtSigned(v){
    if (!(typeof v === "number" && isFinite(v))) return "—";
    return (v > 0 ? "+" : "") + v.toFixed(2);
  }
  function fmtPct(v){
    if (!(typeof v === "number" && isFinite(v))) return "—";
    return (v > 0 ? "+" : "") + v.toFixed(2) + "%";
  }

  function renderContractTiles(list){
    const tiles = (list || []).map(c => {
      const sym = c?.symbol || "";
      const label = c?.label || "";

      const q = window.FVMarkets?.getQuote?.(sym) || null;
      const price = q?.price ?? null;
      const chg = q?.chg ?? null;
      const pct = q?.pct ?? null;

      const dir = arrowDirFrom(chg);
      const arr = arrowChar(dir);

      return `
        <button class="fv-mktm-tile" data-mkt-sym="${escapeHtml(sym)}" aria-label="${escapeHtml(label || sym)}">
          <div class="fv-mktm-trow">
            <div class="fv-mktm-tleft">
              <div class="fv-mktm-tsym">${escapeHtml(sym)}</div>
              <div class="fv-mktm-tlab">${escapeHtml(label)}</div>
            </div>
            <div class="fv-mktm-tright">
              <div class="fv-mktm-tprice">${escapeHtml(fmtPrice(price))}</div>
              <div class="fv-mktm-tchg ${dir}">
                <span aria-hidden="true">${arr}</span>
                <span>${escapeHtml(fmtSigned(chg))}</span>
                <span>${escapeHtml(fmtPct(pct))}</span>
              </div>
            </div>
          </div>
        </button>
      `;
    }).join("");

    return `<div class="fv-mktm-tiles">${tiles || `<div class="fv-mktm-empty">No contracts</div>`}</div>`;
  }

  async function openContractsList(crop){
    const last = window.FVMarkets?.getLast?.() || null;
    const raw = (crop === "corn") ? (last?.corn || []) : (last?.soy || []);

    // Filter dead/nodata
    const list = raw.filter(c => {
      const sym = c?.symbol;
      if (!sym) return false;
      const st = window.FVMarkets?.getSymbolState?.(sym) || "unknown";
      return st !== "dead" && st !== "nodata";
    });

    openModal();
    setModalTitle((crop === "corn") ? "Corn contracts" : "Soybean contracts");

    setModalBody(`
      <div class="fv-mktm-grid">
        <div class="fv-mktm-list" id="fv-mktm-list">
          <div class="fv-mktm-empty">Loading prices…</div>
        </div>

        <div class="fv-mktm-chart" id="fv-mktm-chartCard">
          <div class="fv-mktm-sub">
            ${renderTabs("daily")}
          </div>

          <div class="fv-mktm-canvas-wrap" id="fv-mktm-chartWrap">
            <canvas class="fv-mktm-canvas" id="fv-mktm-canvas"></canvas>
            <div class="fv-mktm-tooltip" id="fv-mktm-tooltip"></div>
          </div>

          <div class="fv-mktm-sub" id="fv-mktm-note">Tap a contract to load chart.</div>
        </div>
      </div>
    `);

    // Load quotes for the list like the dashboard tiles
    const symbols = list.map(c => c.symbol).filter(Boolean);

    // 1) quick prices (lite)
    await window.FVMarkets.warmQuotes(symbols, "lite").catch(()=>{});
    const listEl = document.getElementById("fv-mktm-list");
    if (listEl) listEl.innerHTML = renderContractTiles(list);

    // 2) upgrade first chunk to full (so change/% appears like front tiles)
    const firstChunk = symbols.slice(0, 10);
    window.FVMarkets.warmQuotes(firstChunk, "full").then(()=>{
      const el = document.getElementById("fv-mktm-list");
      if (el) el.innerHTML = renderContractTiles(list);
    }).catch(()=>{});

    let currentSymbol = null;

    function scrollChartIntoView(){
      if (!isMobile()) return;
      const chartCard = document.getElementById("fv-mktm-chartCard");
      if (chartCard) chartCard.scrollIntoView({ behavior:"smooth", block:"start" });
    }

    function renderCurrent(){
      if (!currentSymbol) return;
      const active = document.querySelector(".fv-mktm-tab[aria-selected='true']");
      const mode = active ? (active.getAttribute("data-mode") || "daily") : "daily";
      loadAndRender(currentSymbol, mode);
      scrollChartIntoView();
    }

    // Wire tabs
    document.querySelectorAll(".fv-mktm-tab").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        document.querySelectorAll(".fv-mktm-tab").forEach(b=>b.setAttribute("aria-selected","false"));
        btn.setAttribute("aria-selected","true");
        renderCurrent();
      });
    });

    // Wire tile clicks
    function wireTiles(){
      document.querySelectorAll("[data-mkt-sym]").forEach(btn=>{
        btn.addEventListener("click", async ()=>{
          const sym = btn.getAttribute("data-mkt-sym");
          if (!sym) return;
          currentSymbol = sym;
          setModalTitle(sym);

          // Ensure full quote for the selected one
          window.FVMarkets.warmQuotes([sym], "full").then(()=>{
            const el = document.getElementById("fv-mktm-list");
            if (el) el.innerHTML = renderContractTiles(list);
            wireTiles(); // rewire after rerender
          }).catch(()=>{});

          renderCurrent();
        });
      });
    }
    wireTiles();

    // Auto-select first contract on mobile for "pops up" feel
    if (isMobile() && list?.[0]?.symbol){
      currentSymbol = list[0].symbol;
      setModalTitle(currentSymbol);
      renderCurrent();
      scrollChartIntoView();
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
