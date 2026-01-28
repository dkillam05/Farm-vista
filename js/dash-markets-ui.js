/* =====================================================================
/Farm-vista/js/dash-markets-ui.js  (FULL FILE)
Rev: 2026-01-28g
Purpose:
✅ Markets modal + chart UI:
   - Tap tile => open chart modal (chart-only, single column on desktop)
   - View more contracts => list modal; tap contract => chart (split layout on desktop)
✅ Contract rows:
   - Show quote badge (price + ▲/▼ + $chg + %chg) on EVERY contract row
   - Uses FVMarkets.getQuote() + FVMarkets.warmQuotes()
✅ Chart modes (NO "All"):
   - Daily (candles, session-only, no overnight)
   - Weekly (last 7 trading sessions)
   - Monthly (last 30 trading sessions)
   - 6mo (line, last ~126 sessions)
   - 1Y (line, last ~252 sessions)
✅ UI:
   - Replaces "Points:" with range label
   - Candles colored green/red, neutral wicks
   - Lines high-contrast (not black) with subtle glow
   - Tooltip clamped on-screen
   - If no chart data => "No chart data at this time"
✅ Uses Cloud Run chart.points[] (o/h/l/c + tUtc)
===================================================================== */

(function(){
  "use strict";

  const MODAL_ID = "fv-mkt-modal";
  const BACKDROP_ID = "fv-mkt-backdrop";

  const UP = "#2F6C3C";
  const DOWN = "#b42318";
  const WICK = "rgba(160,170,180,.75)";

  // Trading-session slicing heuristics (client-side)
  const SESSIONS_WEEK = 7;
  const SESSIONS_MONTH = 30;
  const SESSIONS_6MO = 126;  // ~21*6
  const SESSIONS_1Y  = 252;  // ~21*12

  function escapeHtml(s){
    return String(s || "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  function isWide(){
    try{ return window.matchMedia && window.matchMedia("(min-width: 900px)").matches; }
    catch{ return false; }
  }

  function toNum(x){
    if (typeof x === "number" && isFinite(x)) return x;
    if (typeof x === "string"){
      const v = parseFloat(x);
      return isFinite(v) ? v : null;
    }
    return null;
  }

  function fmtPrice(v){ return (typeof v === "number" && isFinite(v)) ? v.toFixed(2) : "—"; }
  function fmtSigned(v){
    if (!(typeof v === "number" && isFinite(v))) return "—";
    return (v > 0 ? "+" : "") + v.toFixed(2);
  }
  function fmtPct(v){
    if (!(typeof v === "number" && isFinite(v))) return "—";
    return (v > 0 ? "+" : "") + v.toFixed(2) + "%";
  }

  function dirFrom(chg){
    if (typeof chg !== "number" || !isFinite(chg)) return "flat";
    if (chg > 0) return "up";
    if (chg < 0) return "down";
    return "flat";
  }
  function arrowFor(dir){
    if (dir === "up") return "▲";
    if (dir === "down") return "▼";
    return "—";
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
#${MODAL_ID}::-webkit-scrollbar{ width:0; height:0; }

.fv-mktm-head{ display:flex; align-items:center; justify-content:space-between; gap:10px; margin:0 0 10px 0; }
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
.fv-mktm-grid{ display:grid; grid-template-columns: 1fr; gap:12px; }
@media (min-width: 900px){
  .fv-mktm-grid.fv-mktm-split{ grid-template-columns: 360px 1fr; }
}
.fv-mktm-grid.fv-mktm-chartonly{ grid-template-columns: 1fr !important; }

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
.fv-mktm-label{ font-size:12px; opacity:.78; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.fv-mktm-row-right{ display:flex; flex-direction:column; align-items:flex-end; gap:2px; flex:0 0 auto; }

.fv-mktm-price{ font-weight:900; font-variant-numeric:tabular-nums; }

/* Badge-style change for every row */
.fv-mktm-badge{
  display:inline-flex;
  align-items:center;
  gap:6px;
  font-size:12px;
  padding:4px 8px;
  border-radius:999px;
  border:1px solid rgba(0,0,0,.10);
  background:rgba(0,0,0,.03);
  font-variant-numeric:tabular-nums;
}
.fv-mktm-badge.up{ color:${UP}; border-color:rgba(47,108,60,.35); background:rgba(47,108,60,.10); }
.fv-mktm-badge.down{ color:${DOWN}; border-color:rgba(180,35,24,.30); background:rgba(180,35,24,.08); }
.fv-mktm-badge.flat{ color:var(--muted,#67706B); }

.fv-mktm-badge .arr{ width:16px; text-align:center; font-weight:900; }

/* Chart */
.fv-mktm-chart{
  border:1px solid rgba(0,0,0,.12);
  border-radius:14px;
  padding:10px 10px 12px;
  background:var(--card-surface, var(--surface,#fff));
  position:relative;
}
.fv-mktm-chart-title{
  font-size:13px;
  font-weight:800;
  margin:0 0 6px 0;
}
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

.fv-mktm-empty{
  font-size:13px;
  color:var(--muted,#67706B);
  padding:10px 0;
}

/* Tooltip */
.fv-mktm-tip{
  position:fixed;
  z-index:10000;
  padding:10px 12px;
  border-radius:12px;
  border:1px solid rgba(0,0,0,.16);
  background:rgba(15,23,42,.92);
  color:#fff;
  font-size:12px;
  line-height:1.25;
  box-shadow:0 10px 28px rgba(0,0,0,.35);
  max-width:min(320px, calc(100vw - 24px));
  pointer-events:none;
  display:none;
  white-space:nowrap;
}
.fv-mktm-tip .muted{ opacity:.78; }
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
      <div class="fv-mktm-tip" id="fv-mktm-tip"></div>
    `;
    document.body.appendChild(back);

    back.addEventListener("click", (e)=>{ if (e.target === back) closeModal(); });
    back.querySelector("#fv-mktm-close").addEventListener("click", closeModal);
    document.addEventListener("keydown", (e)=>{ if (e.key === "Escape") closeModal(); });

    return back;
  }

  function openModal(){
    const back = ensureModal();
    back.classList.add("open");
    document.body.style.overflow = "hidden";

    const modal = document.getElementById(MODAL_ID);
    if (modal) modal.scrollTop = 0;

    hideTip();
  }

  function closeModal(){
    const back = document.getElementById(BACKDROP_ID);
    if (!back) return;
    back.classList.remove("open");
    document.body.style.overflow = "";
    hideTip();
  }

  function setModalTitle(t){
    const el = document.getElementById("fv-mktm-title");
    if (el) el.textContent = t || "Markets";
  }

  function setModalBody(html){
    const body = document.getElementById("fv-mktm-body");
    if (body) body.innerHTML = html || "";
    hideTip();
  }

  function normalizePoints(chart){
    if (Array.isArray(chart)) return chart;
    if (!chart) return [];
    return chart.points || chart.bars || chart.data || chart.series || [];
  }

  function fmtStamp(tUtc){
    try{
      const d = new Date(tUtc);
      return d.toLocaleString([], { month:"numeric", day:"numeric", year:"2-digit", hour:"numeric", minute:"2-digit" });
    } catch {
      return String(tUtc || "");
    }
  }

  function clamp(v, lo, hi){
    return Math.max(lo, Math.min(hi, v));
  }

  function tipEl(){ return document.getElementById("fv-mktm-tip"); }

  function showTipAt(clientX, clientY, html){
    const tip = tipEl();
    if (!tip) return;

    tip.innerHTML = html;
    tip.style.display = "block";

    const rect = tip.getBoundingClientRect();
    const pad = 10;

    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let x = clientX + 14;
    let y = clientY + 14;

    x = clamp(x, pad, vw - rect.width - pad);
    y = clamp(y, pad, vh - rect.height - pad);

    tip.style.left = `${x}px`;
    tip.style.top  = `${y}px`;
  }

  function hideTip(){
    const tip = tipEl();
    if (!tip) return;
    tip.style.display = "none";
  }

  function getThemeStroke(){
    return getComputedStyle(document.body).color || "rgb(240,240,240)";
  }

  function sizeCanvas(canvas){
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { rect, ctx };
  }

  function drawNoData(canvas, msg){
    if (!canvas) return;
    const { rect, ctx } = sizeCanvas(canvas);
    if (!ctx) return;
    ctx.clearRect(0,0,rect.width,rect.height);
    ctx.globalAlpha = 0.9;
    ctx.font = "14px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.fillStyle = getComputedStyle(document.body).color || "#111";
    ctx.fillText(msg || "No chart data at this time", 12, 28);
    ctx.globalAlpha = 1;
  }

  // Build "sessions" from chart points by grouping by Chicago calendar date
  function chicagoDayKeyFromUtc(iso){
    try{
      const d = new Date(iso);
      const fmt = new Intl.DateTimeFormat("en-US", { timeZone:"America/Chicago", year:"numeric", month:"2-digit", day:"2-digit" });
      const parts = fmt.formatToParts(d);
      const y = parts.find(p=>p.type==="year")?.value || "0000";
      const m = parts.find(p=>p.type==="month")?.value || "00";
      const da = parts.find(p=>p.type==="day")?.value || "00";
      return `${y}-${m}-${da}`;
    }catch{
      return "0000-00-00";
    }
  }

  function sessionFilterDaily(points){
    // Keep only points from the most recent Chicago day present in the data.
    // This naturally removes older overnight portions and prior day segments.
    const pts = (points || []).filter(p => p && p.tUtc);
    if (!pts.length) return [];

    const lastKey = chicagoDayKeyFromUtc(pts[pts.length - 1].tUtc);
    return pts.filter(p => chicagoDayKeyFromUtc(p.tUtc) === lastKey);
  }

  function lastNSessions(points, n){
    const pts = (points || []).filter(p => p && p.tUtc);
    if (!pts.length) return [];

    const buckets = new Map(); // key -> array of points
    for (const p of pts){
      const k = chicagoDayKeyFromUtc(p.tUtc);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(p);
    }
    const keys = Array.from(buckets.keys()).sort(); // chronological
    const keepKeys = keys.slice(Math.max(0, keys.length - n));
    const out = [];
    for (const k of keepKeys){
      out.push(...(buckets.get(k) || []));
    }
    return out;
  }

  function makeLineSeries(points){
    const rows = (points || []).map(p => ({
      t: p?.tUtc ?? p?.t ?? p?.time ?? p?.date ?? null,
      c: toNum(p?.c ?? p?.close ?? p?.Close)
    })).filter(r => r.t && r.c != null);
    return rows;
  }

  function makeCandleSeries(points){
    const rows = (points || []).map(p => ({
      t: p?.tUtc ?? p?.t ?? p?.time ?? p?.date ?? null,
      o: toNum(p?.o), h: toNum(p?.h), l: toNum(p?.l), c: toNum(p?.c)
    })).filter(r => r.t && r.o != null && r.h != null && r.l != null && r.c != null);
    return rows;
  }

  function drawLine(canvas, rows){
    if (!canvas) return { rows: [] };
    const { rect, ctx } = sizeCanvas(canvas);
    if (!ctx) return { rows: [] };

    ctx.clearRect(0, 0, rect.width, rect.height);

    if (!rows || rows.length < 2){
      drawNoData(canvas, "No chart data at this time");
      return { rows: rows || [] };
    }

    const vals = rows.map(r => r.c);
    let min = Math.min(...vals);
    let max = Math.max(...vals);
    if (min === max){ min -= 1; max += 1; }

    const pad = 12;
    const W = rect.width;
    const H = rect.height;

    // baseline
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = "rgba(0,0,0,.20)";
    ctx.beginPath();
    ctx.moveTo(pad, H - pad);
    ctx.lineTo(W - pad, H - pad);
    ctx.stroke();
    ctx.globalAlpha = 1;

    const n = rows.length;
    const xFor = (i)=> pad + (i * (W - pad*2) / (n - 1));
    const yFor = (v)=> pad + ((max - v) * (H - pad*2) / (max - min));

    // subtle glow + colored line (not black)
    const stroke = isWide() ? "rgba(59,126,70,.95)" : "rgba(59,126,70,.90)";

    ctx.lineWidth = 6;
    ctx.strokeStyle = "rgba(59,126,70,.18)";
    ctx.beginPath();
    ctx.moveTo(xFor(0), yFor(rows[0].c));
    for (let i = 1; i < n; i++) ctx.lineTo(xFor(i), yFor(rows[i].c));
    ctx.stroke();

    ctx.lineWidth = 2.8;
    ctx.strokeStyle = stroke;
    ctx.beginPath();
    ctx.moveTo(xFor(0), yFor(rows[0].c));
    for (let i = 1; i < n; i++) ctx.lineTo(xFor(i), yFor(rows[i].c));
    ctx.stroke();

    // last label
    ctx.globalAlpha = 0.9;
    ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.fillStyle = getThemeStroke();
    ctx.fillText(`Last: ${rows[n-1].c.toFixed(2)}`, pad, pad + 12);
    ctx.globalAlpha = 1;

    return { rows };
  }

  function drawCandles(canvas, rows){
    if (!canvas) return { rows: [] };
    const { rect, ctx } = sizeCanvas(canvas);
    if (!ctx) return { rows: [] };

    ctx.clearRect(0, 0, rect.width, rect.height);

    if (!rows || rows.length < 2){
      drawNoData(canvas, "No chart data at this time");
      return { rows: rows || [] };
    }

    const highs = rows.map(r => r.h);
    const lows  = rows.map(r => r.l);
    let min = Math.min(...lows);
    let max = Math.max(...highs);
    if (min === max){ min -= 1; max += 1; }

    const pad = 12;
    const W = rect.width;
    const H = rect.height;
    const n = rows.length;

    const yFor = (v)=> pad + ((max - v) * (H - pad*2) / (max - min));
    const slot = (W - pad*2) / n;
    const bodyW = Math.max(3, Math.min(10, slot * 0.55));
    const xFor = (i)=> pad + i * slot + slot/2;

    // baseline
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = "rgba(0,0,0,.14)";
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

      // wick
      ctx.strokeStyle = WICK;
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.moveTo(x, yH);
      ctx.lineTo(x, yL);
      ctx.stroke();

      // body
      const top = Math.min(yO, yC);
      const bot = Math.max(yO, yC);
      ctx.fillStyle = up ? UP : DOWN;
      ctx.fillRect(x - bodyW/2, top, bodyW, Math.max(2, bot - top));
    }

    // last label
    ctx.globalAlpha = 0.9;
    ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.fillStyle = getThemeStroke();
    ctx.fillText(`Last: ${rows[n-1].c.toFixed(2)}`, pad, pad + 12);
    ctx.globalAlpha = 1;

    return { rows };
  }

  function bindTooltip(canvas, rows, kind){
    hideTip();
    if (!canvas || !rows || rows.length < 2) return;

    const getIndexFromX = (clientX)=>{
      const rect = canvas.getBoundingClientRect();
      const x = clamp(clientX - rect.left, 0, rect.width);
      const n = rows.length;
      const i = Math.round((x / rect.width) * (n - 1));
      return clamp(i, 0, n - 1);
    };

    const onMove = (e)=>{
      const touch = e.touches && e.touches[0] ? e.touches[0] : null;
      const cx = touch ? touch.clientX : e.clientX;
      const cy = touch ? touch.clientY : e.clientY;

      const idx = getIndexFromX(cx);
      const r = rows[idx];
      if (!r) return;

      const when = r.t ? fmtStamp(r.t) : "—";
      let html = `<div><strong>${escapeHtml(when)}</strong></div>`;

      if (kind === "candles"){
        html += `<div class="muted">O ${escapeHtml(fmt2(r.o))}  H ${escapeHtml(fmt2(r.h))}  L ${escapeHtml(fmt2(r.l))}  C ${escapeHtml(fmt2(r.c))}</div>`;
      } else {
        html += `<div class="muted">Close ${escapeHtml(fmt2(r.c))}</div>`;
      }

      showTipAt(cx, cy, html);
    };

    const onLeave = ()=> hideTip();

    canvas.onmousemove = onMove;
    canvas.ontouchstart = onMove;
    canvas.ontouchmove = onMove;
    canvas.ontouchend = onLeave;
    canvas.onmouseleave = onLeave;
  }

  function findContractLabel(symbol){
    try{
      const last = window.FVMarkets?.getLast?.();
      const all = []
        .concat((last?.corn || []), (last?.soy || []));
      const hit = all.find(x => x?.symbol === symbol);
      return hit?.label || "";
    } catch {
      return "";
    }
  }

  function setChartHeader(symbol){
    const hdr = document.getElementById("fv-mktm-chart-hdr");
    if (!hdr) return;
    const label = findContractLabel(symbol);
    hdr.textContent = label ? `${label} — ${symbol}` : symbol;
  }

  function setSelectedTab(mode){
    document.querySelectorAll(".fv-mktm-tab").forEach(b=>b.setAttribute("aria-selected","false"));
    const btn = document.querySelector(`.fv-mktm-tab[data-mode="${mode}"]`);
    if (btn) btn.setAttribute("aria-selected","true");
  }

  function rangeLabel(mode){
    if (mode === "daily") return "Today";
    if (mode === "weekly") return "Last 7 sessions";
    if (mode === "monthly") return "Last 30 sessions";
    if (mode === "6mo") return "Last 6 months";
    if (mode === "1y") return "Last 12 months";
    return "";
  }

  function renderTabs(){
    return `
      <div class="fv-mktm-tabs" role="tablist" aria-label="Chart range">
        <button class="fv-mktm-tab" data-mode="daily" aria-selected="true">Daily</button>
        <button class="fv-mktm-tab" data-mode="weekly" aria-selected="false">Weekly</button>
        <button class="fv-mktm-tab" data-mode="monthly" aria-selected="false">Monthly</button>
        <button class="fv-mktm-tab" data-mode="6mo" aria-selected="false">6mo</button>
        <button class="fv-mktm-tab" data-mode="1y" aria-selected="false">1Y</button>
      </div>
    `;
  }

  function wireTabs(getSymbol){
    document.querySelectorAll(".fv-mktm-tab").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const sym = getSymbol();
        if (!sym) return;
        const mode = btn.getAttribute("data-mode") || "daily";
        setSelectedTab(mode);
        loadAndRender(sym, mode);
      });
    });
  }

  async function loadAndRender(symbol, mode){
    const note = document.getElementById("fv-mktm-note");
    const rangeEl = document.getElementById("fv-mktm-range");
    if (note) note.textContent = "Loading…";
    if (rangeEl) rangeEl.textContent = rangeLabel(mode) || "";
    hideTip();

    try{
      const chart = await window.FVMarkets.fetchChart(symbol, mode);
      let points = normalizePoints(chart);
      const canvas = document.getElementById("fv-mktm-canvas");

      // Mode shaping rules
      if (mode === "daily"){
        points = sessionFilterDaily(points);
      } else if (mode === "weekly"){
        points = lastNSessions(points, SESSIONS_WEEK);
      } else if (mode === "monthly"){
        points = lastNSessions(points, SESSIONS_MONTH);
      } else if (mode === "6mo"){
        points = lastNSessions(points, SESSIONS_6MO);
      } else if (mode === "1y"){
        points = lastNSessions(points, SESSIONS_1Y);
      }

      let drawn;
      if (mode === "daily" || mode === "weekly" || mode === "monthly"){
        const rows = makeCandleSeries(points);
        drawn = drawCandles(canvas, rows);
        bindTooltip(canvas, drawn.rows, "candles");
      } else {
        const rows = makeLineSeries(points);
        drawn = drawLine(canvas, rows);
        bindTooltip(canvas, drawn.rows, "line");
      }

      // Replace "Points" helper with proper range status
      if (note){
        note.textContent = (drawn.rows && drawn.rows.length >= 2)
          ? ""
          : "No chart data at this time";
      }
    } catch (e){
      const canvas = document.getElementById("fv-mktm-canvas");
      drawNoData(canvas, "No chart data at this time");
      if (note) note.textContent = "No chart data at this time";
    }
  }

  // --- Quote badge for every row ---
  function renderBadge(q){
    const price = q ? q.price : null;
    const chg = q ? q.chg : null;
    const pct = q ? q.pct : null;

    const hasChange = (typeof chg === "number" && isFinite(chg)) && (typeof pct === "number" && isFinite(pct));
    const dir = hasChange ? dirFrom(chg) : "flat";
    const arr = hasChange ? arrowFor(dir) : "—";

    const priceTxt = fmtPrice(price);
    const chgTxt = hasChange ? fmtSigned(chg) : "—";
    const pctTxt = hasChange ? fmtPct(pct) : "—";

    return { dir, arr, priceTxt, chgTxt, pctTxt, hasChange };
  }

  function updateRowQuote(sym){
    const row = document.querySelector(`.fv-mktm-row[data-mkt-sym="${CSS.escape(sym)}"]`);
    if (!row) return;

    const q = window.FVMarkets?.getQuote ? window.FVMarkets.getQuote(sym) : null;
    const b = renderBadge(q);

    const priceEl = row.querySelector('[data-q="price"]');
    const badgeEl = row.querySelector('[data-q="badge"]');
    const arrEl = row.querySelector('[data-q="arr"]');
    const chgEl = row.querySelector('[data-q="chg"]');
    const pctEl = row.querySelector('[data-q="pct"]');

    if (priceEl) priceEl.textContent = b.priceTxt;

    if (badgeEl){
      badgeEl.classList.remove("up","down","flat");
      badgeEl.classList.add(b.dir);
    }
    if (arrEl) arrEl.textContent = b.arr;
    if (chgEl) chgEl.textContent = b.chgTxt;
    if (pctEl) pctEl.textContent = b.pctTxt;
  }

  function warmAllVisibleListQuotes(list){
    const symbols = (list || []).map(x => x?.symbol).filter(Boolean);
    symbols.forEach(updateRowQuote);

    // Lite warm first for speed, then progressively full on wide screens
    if (window.FVMarkets?.warmQuotes){
      window.FVMarkets.warmQuotes(symbols, "lite").then(()=>{
        symbols.forEach(updateRowQuote);

        // On desktop, progressively compute full change/% in background (so every row gets the yellow badge)
        if (isWide()){
          window.FVMarkets.warmQuotes(symbols, "full").then(()=>{
            symbols.forEach(updateRowQuote);
          }).catch(()=>{});
        }
      }).catch(()=>{});
    }
  }

  function renderChartModal(symbol){
    openModal();
    setModalTitle(symbol || "Chart");

    setModalBody(`
      <div class="fv-mktm-grid fv-mktm-chartonly">
        <div class="fv-mktm-chart">
          <div class="fv-mktm-chart-title" id="fv-mktm-chart-hdr"></div>

          <div class="fv-mktm-sub">
            ${renderTabs()}
            <div id="fv-mktm-range">${escapeHtml(rangeLabel("daily"))}</div>
          </div>

          <canvas class="fv-mktm-canvas" id="fv-mktm-canvas"></canvas>
          <div class="fv-mktm-sub" id="fv-mktm-note"></div>
        </div>
      </div>
    `);

    setChartHeader(symbol);
    wireTabs(()=>symbol);

    loadAndRender(symbol, "daily");
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
          <div class="fv-mktm-row-inner">
            <div class="fv-mktm-row-left">
              <div class="fv-mktm-sym">${escapeHtml(sym)}</div>
              <div class="fv-mktm-label">${escapeHtml(label)}</div>
            </div>
            <div class="fv-mktm-row-right">
              <div class="fv-mktm-price" data-q="price">—</div>
              <div class="fv-mktm-badge flat" data-q="badge">
                <span class="arr" data-q="arr">—</span>
                <span data-q="chg">—</span>
                <span data-q="pct">—</span>
              </div>
            </div>
          </div>
        </button>
      `;
    }).join("");

    setModalBody(`
      <div class="fv-mktm-grid fv-mktm-split">
        <div class="fv-mktm-list" id="fv-mktm-listbox">
          ${rows || `<div class="fv-mktm-empty">No contracts</div>`}
        </div>

        <div class="fv-mktm-chart">
          <div class="fv-mktm-chart-title" id="fv-mktm-chart-hdr">Select a contract</div>

          <div class="fv-mktm-sub">
            ${renderTabs()}
            <div id="fv-mktm-range">${escapeHtml(rangeLabel("daily"))}</div>
          </div>

          <canvas class="fv-mktm-canvas" id="fv-mktm-canvas"></canvas>
          <div class="fv-mktm-sub" id="fv-mktm-note">Tap a contract on the left to load the chart.</div>
        </div>
      </div>
    `);

    let currentSymbol = null;

    wireTabs(()=>currentSymbol);

    // IMPORTANT: no chart load until a contract is selected
    bindTooltip(null, [], "line");

    // Warm quotes so every row gets the badge (especially on desktop)
    warmAllVisibleListQuotes(list);

    document.querySelectorAll("[data-mkt-sym]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        document.querySelectorAll("[data-mkt-sym]").forEach(b=>b.setAttribute("aria-current","false"));
        btn.setAttribute("aria-current","true");

        const sym = btn.getAttribute("data-mkt-sym");
        if (!sym) return;

        currentSymbol = sym;
        setModalTitle(sym);
        setChartHeader(sym);

        const active = document.querySelector(".fv-mktm-tab[aria-selected='true']");
        const mode = active ? (active.getAttribute("data-mode") || "daily") : "daily";
        loadAndRender(sym, mode);

        // compute full quote for selected to ensure badge change/% is filled
        if (window.FVMarkets?.warmQuotes){
          window.FVMarkets.warmQuotes([sym], "full").then(()=>updateRowQuote(sym)).catch(()=>{});
        }

        const modal = document.getElementById(MODAL_ID);
        if (modal) modal.scrollTop = 0;
      });
    });

    const modal = document.getElementById(MODAL_ID);
    if (modal) modal.scrollTop = 0;
  }

  function onContractTap(e){
    const sym = e?.detail?.symbol;
    if (!sym) return;
    renderChartModal(sym);
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
