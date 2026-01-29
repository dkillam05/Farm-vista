/* =====================================================================
/Farm-vista/js/dash-markets-chart.js  (FULL FILE)
Rev: 2026-01-28e
Purpose:
✅ Canvas chart renderer for FarmVista Markets modal (standalone helper)
✅ Supports:
   - Candlesticks (OHLC) with green/red bodies + neutral wicks
   - Line charts (close) with high-contrast stroke + subtle glow
   - X/Y axes labels drawn INSIDE the canvas (readable)
   - Tooltip that follows pointer AND click-to-lock on a point
   - Touch support (tap locks; drag previews; tap again toggles)
   - "No chart data at this time" rendering
✅ No dependencies on modal/UI files. Safe global API:
   window.FVMarketsChart.render(canvas, rows, opts)
   window.FVMarketsChart.clear(canvas)

Fixes in this rev:
✅ Tooltip lock clears on ANY re-render (tab switch / contract change)
✅ Public API: FVMarketsChart.hideTip() -> hides + unlocks
✅ When chart is cleared, tooltip is also cleared + unlocked
✅ Keeps iOS synthetic mouse suppression + resize/orientation re-render
===================================================================== */

(function(){
  "use strict";

  const API = {};
  window.FVMarketsChart = API;

  // Default colors (match your scheme)
  const UP = "#2F6C3C";
  const DOWN = "#b42318";
  const WICK = "rgba(160,170,180,.75)";

  // Tooltip singleton
  const TIP_ID = "fv-mkt-chart-tip";

  // ✅ Suppress synthetic mouse events after touch (iOS)
  const TOUCH_SUPPRESS_MS = 900;

  function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }

  // ✅ escapeHtml (needed for tooltip safety + avoids crashes)
  function escapeHtml(s){
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function toNum(x){
    if (typeof x === "number" && isFinite(x)) return x;
    if (typeof x === "string"){
      const v = parseFloat(x);
      return isFinite(v) ? v : null;
    }
    return null;
  }

  function getBodyTextColor(){
    try{ return getComputedStyle(document.body).color || "rgb(20,20,20)"; }
    catch{ return "rgb(20,20,20)"; }
  }

  // -------------------------
  // Tooltip DOM + positioning
  // -------------------------
  function ensureTip(){
    let tip = document.getElementById(TIP_ID);
    if (tip) return tip;

    tip = document.createElement("div");
    tip.id = TIP_ID;

    // Core layout / positioning
    tip.style.position = "fixed";
    tip.style.zIndex = "10000";
    tip.style.pointerEvents = "none";
    tip.style.display = "none";

    // Tight “card”
    tip.style.padding = "8px 10px";
    tip.style.borderRadius = "10px";
    tip.style.border = "1px solid rgba(0,0,0,.18)";
    tip.style.background = "rgba(15,23,42,.92)";
    tip.style.color = "#fff";
    tip.style.boxShadow = "0 10px 28px rgba(0,0,0,.35)";

    // ✅ prevent “full width”
    tip.style.maxWidth = "260px";
    tip.style.whiteSpace = "normal";
    tip.style.overflow = "hidden";

    // Typography
    tip.style.fontSize = "12px";
    tip.style.lineHeight = "1.25";
    tip.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, Arial";

    document.body.appendChild(tip);
    return tip;
  }

  function showTip(clientX, clientY, html){
    const tip = ensureTip();
    tip.innerHTML = html;
    tip.style.display = "block";

    // measure after display
    const r = tip.getBoundingClientRect();
    const pad = 10;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let x = clientX + 14;
    let y = clientY + 14;

    x = clamp(x, pad, vw - r.width - pad);
    y = clamp(y, pad, vh - r.height - pad);

    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  }

  function hideTip(){
    const tip = document.getElementById(TIP_ID);
    if (!tip) return;
    tip.style.display = "none";
  }

  // -------------------------
  // Formatting helpers
  // -------------------------
  function fmt2(x){
    const n = toNum(x);
    return (n == null) ? "—" : n.toFixed(2);
  }

  function fmtStamp(iso, timeZone){
    try{
      const d = new Date(iso);
      if (timeZone){
        return new Intl.DateTimeFormat("en-US", {
          timeZone,
          month:"numeric", day:"numeric", year:"2-digit",
          hour:"numeric", minute:"2-digit"
        }).format(d);
      }
      return d.toLocaleString([], {
        month:"numeric", day:"numeric", year:"2-digit",
        hour:"numeric", minute:"2-digit"
      });
    }catch{
      return String(iso || "");
    }
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

  function noData(canvas, msg){
    const { rect, ctx } = sizeCanvas(canvas);
    if (!ctx) return;
    ctx.clearRect(0,0,rect.width,rect.height);

    ctx.globalAlpha = 0.9;
    ctx.font = "14px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.fillStyle = getBodyTextColor();
    ctx.fillText(msg || "No chart data at this time", 12, 28);
    ctx.globalAlpha = 1;
  }

  // -------------------------
  // Axes + grid
  // -------------------------
  function yTicks(min, max, count){
    const n = Math.max(2, Math.min(8, count || 5));
    if (!isFinite(min) || !isFinite(max)) return [];
    if (min === max){ min -= 1; max += 1; }
    const step = (max - min) / (n - 1);
    const out = [];
    for (let i = 0; i < n; i++){
      out.push(min + step * i);
    }
    return out;
  }

  function drawAxes(ctx, rect, frame){
    const padL = frame.padL, padR = frame.padR, padT = frame.padT, padB = frame.padB;
    const W = rect.width, H = rect.height;

    const axisColor = frame.textColor || getBodyTextColor();
    const gridA = (typeof frame.gridAlpha === "number") ? frame.gridAlpha : 0.18;

    const ticks = yTicks(frame.min, frame.max, frame.yTickCount || 5);

    ctx.save();
    ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.fillStyle = axisColor;
    ctx.strokeStyle = axisColor;

    // horizontal grid
    ctx.globalAlpha = gridA;
    for (let i = 0; i < ticks.length; i++){
      const v = ticks[i];
      const y = padT + ((frame.max - v) * (H - padT - padB) / (frame.max - frame.min));
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(W - padR, y);
      ctx.stroke();
    }

    // y labels
    ctx.globalAlpha = 0.85;
    for (let i = 0; i < ticks.length; i++){
      const v = ticks[i];
      const y = padT + ((frame.max - v) * (H - padT - padB) / (frame.max - frame.min));
      ctx.fillText(v.toFixed(2), 6, y + 4);
    }

    // x baseline
    ctx.globalAlpha = gridA;
    ctx.beginPath();
    ctx.moveTo(padL, H - padB);
    ctx.lineTo(W - padR, H - padB);
    ctx.stroke();

    // x labels
    const xLabelFn = frame.xLabelFn;
    const xCount = Math.max(2, Math.min(6, frame.xLabelCount || 4));
    if (typeof xLabelFn === "function" && frame.nPoints >= 2){
      ctx.globalAlpha = 0.85;
      for (let i = 0; i < xCount; i++){
        const t = i / (xCount - 1);
        const idx = Math.round(t * (frame.nPoints - 1));
        const x = padL + (idx * (W - padL - padR) / (frame.nPoints - 1));
        const txt = String(xLabelFn(idx) || "");
        const tw = ctx.measureText(txt).width;
        const tx = clamp(x - tw / 2, padL, W - padR - tw);
        ctx.fillText(txt, tx, H - 8);
      }
    }

    ctx.restore();
  }

  function nearestIndexFromClientX(canvas, rect, padL, padR, n, clientX){
    const x = clamp(clientX - rect.left, padL, rect.width - padR);
    if (n <= 1) return 0;
    const t = (x - padL) / (rect.width - padL - padR);
    const idx = Math.round(t * (n - 1));
    return clamp(idx, 0, n - 1);
  }

  // -------------------------
  // Per-canvas state (handlers + lock)
  // -------------------------
  const stateByCanvas = new WeakMap();

  function detach(canvas){
    const st = stateByCanvas.get(canvas);
    if (!st) return;
    canvas.onmousemove = null;
    canvas.onmouseleave = null;
    canvas.onmousedown = null;
    canvas.ontouchstart = null;
    canvas.ontouchmove = null;
    canvas.ontouchend = null;
    canvas.onclick = null;
    stateByCanvas.delete(canvas);
  }

  // Track active canvas for resize rerender + allow hideTip() to unlock
  function markActive(canvas){
    window.__FV_MKT_ACTIVE_CANVAS = canvas;
    const st = stateByCanvas.get(canvas);
    if (st) window.__FV_MKT_ACTIVE_STATE = st;
  }

  // ✅ Public: hide tip + unlock current chart
  function hideTipAndUnlock(){
    try{
      const st = window.__FV_MKT_ACTIVE_STATE || null;
      if (st) st.locked = false;
    }catch{}
    hideTip();
  }

  API.hideTip = function(){
    hideTipAndUnlock();
  };

  // -------------------------
  // Render engine
  // -------------------------
  function renderInternal(canvas, rows, opts){
    if (!canvas) return;

    // ✅ Key fix: switching ranges/contracts calls render() again.
    // We must clear any locked tooltip from previous render.
    hideTipAndUnlock();

    markActive(canvas);

    const kind = (opts && opts.kind) || "candles";
    const title = (opts && opts.title) || "";
    const timeZone = (opts && opts.timeZone) || null;

    const data = Array.isArray(rows) ? rows.slice() : [];
    const n = data.length;

    if (n < 2){
      detach(canvas);
      hideTipAndUnlock();
      noData(canvas, (opts && opts.noDataText) || "No chart data at this time");
      return;
    }

    // Determine min/max
    let min = Infinity, max = -Infinity;
    if (kind === "candles"){
      for (const r of data){
        const h = toNum(r.h), l = toNum(r.l);
        if (h != null) max = Math.max(max, h);
        if (l != null) min = Math.min(min, l);
      }
    } else {
      for (const r of data){
        const c = toNum(r.c);
        if (c != null) max = Math.max(max, c);
        if (c != null) min = Math.min(min, c);
      }
    }
    if (!isFinite(min) || !isFinite(max)){
      detach(canvas);
      hideTipAndUnlock();
      noData(canvas, (opts && opts.noDataText) || "No chart data at this time");
      return;
    }
    if (min === max){ min -= 1; max += 1; }

    const { rect, ctx } = sizeCanvas(canvas);
    if (!ctx) return;

    const padL = 56;
    const padR = 14;
    const padT = 16;
    const padB = 26;

    const W = rect.width;
    const H = rect.height;

    const yFor = (v)=> padT + ((max - v) * (H - padT - padB) / (max - min));
    const xForIdx = (i)=> padL + (i * (W - padL - padR) / (n - 1));

    // X label fn fallback
    let xLabelFn = opts && opts.xLabelFn;
    if (typeof xLabelFn !== "function"){
      xLabelFn = (idx)=>{
        const t = data[idx] && data[idx].t;
        if (!t) return "";
        const d = new Date(t);
        if (timeZone){
          return new Intl.DateTimeFormat("en-US", { timeZone, month:"numeric", day:"numeric" }).format(d);
        }
        return d.toLocaleDateString([], { month:"numeric", day:"numeric" });
      };
    }

    // Clear
    ctx.clearRect(0,0,W,H);

    // Axes + grid + labels
    drawAxes(ctx, rect, {
      padL, padR, padT, padB,
      min, max,
      nPoints: n,
      xLabelFn,
      xLabelCount: (opts && opts.xLabelCount) || 4,
      yTickCount: (opts && opts.yTickCount) || 5,
      textColor: (opts && opts.axisColor) || getBodyTextColor(),
      gridAlpha: (opts && opts.gridAlpha) != null ? opts.gridAlpha : 0.16
    });

    // Title (optional)
    if (title){
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.fillStyle = getBodyTextColor();
      ctx.fillText(title, padL, 12);
      ctx.restore();
    }

    // Draw series
    if (kind === "candles"){
      const slot = (W - padL - padR) / n;
      const bodyW = Math.max(3, Math.min(10, slot * 0.55));

      for (let i = 0; i < n; i++){
        const r = data[i];
        const o = toNum(r.o), h = toNum(r.h), l = toNum(r.l), c = toNum(r.c);
        if (o == null || h == null || l == null || c == null) continue;

        const x = xForIdx(i);
        const yH = yFor(h);
        const yL = yFor(l);
        const yO = yFor(o);
        const yC = yFor(c);

        const up = c >= o;
        const col = up ? UP : DOWN;

        // wick
        ctx.save();
        ctx.strokeStyle = WICK;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, yH);
        ctx.lineTo(x, yL);
        ctx.stroke();
        ctx.restore();

        // body
        const top = Math.min(yO, yC);
        const bot = Math.max(yO, yC);
        ctx.save();
        ctx.fillStyle = col;
        ctx.fillRect(x - bodyW/2, top, bodyW, Math.max(2, bot - top));
        ctx.restore();
      }
    } else {
      // line with glow
      const stroke = (opts && opts.lineColor) || "rgba(59,126,70,.95)";
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      // glow
      ctx.lineWidth = 6;
      ctx.strokeStyle = "rgba(59,126,70,.18)";
      ctx.beginPath();
      let glowStarted = false;
      for (let i = 0; i < n; i++){
        const c = toNum(data[i].c);
        if (c == null) continue;
        const x = xForIdx(i);
        const y = yFor(c);
        if (!glowStarted){ ctx.moveTo(x, y); glowStarted = true; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // main
      ctx.lineWidth = 2.8;
      ctx.strokeStyle = stroke;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < n; i++){
        const c = toNum(data[i].c);
        if (c == null) continue;
        const x = xForIdx(i);
        const y = yFor(c);
        if (!started){ ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      ctx.restore();
    }

    // Tooltip handlers (hover + click-to-lock)
    detach(canvas);

    const st = {
      locked: false,
      lockedIdx: 0,
      kind,
      padL, padR,
      data,
      timeZone,
      lastTouchMs: 0,

      // Store last render params for resize rerender
      _lastRows: data.slice(),
      _lastOpts: Object.assign({}, opts || {})
    };
    stateByCanvas.set(canvas, st);
    window.__FV_MKT_ACTIVE_STATE = st;

    function tipHtmlFor(idx){
      const r = data[idx] || {};
      const when = r.t ? fmtStamp(r.t, timeZone) : "—";
      const lockNote = st.locked ? `<div style="opacity:.78; margin-top:2px;">Locked</div>` : "";

      if (kind === "candles"){
        return `
          <div style="font-weight:800; margin-bottom:3px;">${escapeHtml(when)}</div>
          <div style="opacity:.85;">
            O ${escapeHtml(fmt2(r.o))} · H ${escapeHtml(fmt2(r.h))} · L ${escapeHtml(fmt2(r.l))} · C ${escapeHtml(fmt2(r.c))}
          </div>
          ${lockNote}
        `;
      }

      return `
        <div style="font-weight:800; margin-bottom:3px;">${escapeHtml(when)}</div>
        <div style="opacity:.85;">Close ${escapeHtml(fmt2(r.c))}</div>
        ${lockNote}
      `;
    }

    function handleMove(clientX, clientY){
      if (st.locked){
        showTip(clientX, clientY, tipHtmlFor(st.lockedIdx));
        return;
      }
      const idx = nearestIndexFromClientX(canvas, rect, padL, padR, n, clientX);
      showTip(clientX, clientY, tipHtmlFor(idx));
    }

    function handleLeave(){
      if (st.locked) return;
      hideTip();
    }

    function handleClick(clientX, clientY){
      const idx = nearestIndexFromClientX(canvas, rect, padL, padR, n, clientX);

      if (!st.locked){
        st.locked = true;
        st.lockedIdx = idx;
      } else {
        if (idx === st.lockedIdx){
          st.locked = false;
        } else {
          st.lockedIdx = idx;
        }
      }

      if (!st.locked){
        hideTip();
      } else {
        showTip(clientX, clientY, tipHtmlFor(st.lockedIdx));
      }
    }

    canvas.onmousemove = (e)=> handleMove(e.clientX, e.clientY);
    canvas.onmouseleave = ()=> handleLeave();

    canvas.onmousedown = (e)=>{
      const now = Date.now();
      if (now - (st.lastTouchMs || 0) < TOUCH_SUPPRESS_MS) return;
      handleClick(e.clientX, e.clientY);
    };

    canvas.ontouchstart = (e)=>{
      if (!e.touches || !e.touches[0]) return;
      st.lastTouchMs = Date.now();
      const t = e.touches[0];
      handleMove(t.clientX, t.clientY);
    };
    canvas.ontouchmove = (e)=>{
      if (!e.touches || !e.touches[0]) return;
      st.lastTouchMs = Date.now();
      const t = e.touches[0];
      handleMove(t.clientX, t.clientY);
    };
    canvas.ontouchend = (e)=>{
      try{
        st.lastTouchMs = Date.now();
        const c = e.changedTouches && e.changedTouches[0] ? e.changedTouches[0] : null;
        if (c) handleClick(c.clientX, c.clientY);
        else handleLeave();
      } catch {
        handleLeave();
      }
    };

    // ESC hides tooltip (and clears lock)
    if (!window.__FV_MKT_CHART_ESC_WIRED){
      window.__FV_MKT_CHART_ESC_WIRED = true;
      document.addEventListener("keydown", (e)=>{
        if (e.key !== "Escape") return;
        hideTipAndUnlock();
      });
    }

    // Resize/orientation re-render (once)
    if (!window.__FV_MKT_CHART_RESIZE_WIRED){
      window.__FV_MKT_CHART_RESIZE_WIRED = true;

      let t = null;
      const rerender = ()=>{
        const c = window.__FV_MKT_ACTIVE_CANVAS;
        if (!c) return;
        const s = stateByCanvas.get(c);
        if (!s) return;

        try{
          const r = c.getBoundingClientRect();
          if (!r || r.width < 10 || r.height < 10) return;
        } catch {
          return;
        }

        renderInternal(c, s._lastRows || [], s._lastOpts || {});
      };

      const schedule = ()=>{
        if (t) clearTimeout(t);
        t = setTimeout(rerender, 80);
      };

      window.addEventListener("resize", schedule, { passive:true });
      window.addEventListener("orientationchange", schedule, { passive:true });
    }
  }

  API.render = function(canvas, rows, opts){
    renderInternal(canvas, rows, opts || {});
  };

  API.clear = function(canvas){
    if (!canvas) return;
    detach(canvas);
    hideTipAndUnlock();
    const { rect, ctx } = sizeCanvas(canvas);
    if (ctx) ctx.clearRect(0,0,rect.width,rect.height);
  };

})();