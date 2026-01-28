/* =====================================================================
/Farm-vista/js/dash-markets-series.js  (FULL FILE)
Rev: 2026-01-28c
Purpose:
✅ Time-range + series shaping helper for FarmVista Markets charts (standalone)
✅ Converts Cloud Run chart.points[] into normalized series rows for:
   - Candles (OHLC) for: daily / weekly / monthly
   - Line (close) for: 6mo / 1y
✅ Enforces your rules:
   - Daily = TODAY session only (no overnight) using America/Chicago buckets + RTH filter
   - Weekly = last 7 trading sessions (last 7 Chicago day buckets)
   - Monthly = last 30 trading sessions (last 30 Chicago day buckets)
   - 6mo = last ~126 sessions
   - 1y = last ~252 sessions
✅ Provides:
   - range label text (replaces "Points:")
   - x-axis label function appropriate to mode
✅ Safe global API:
   window.FVMarketsSeries.shape(points, mode, opts) -> { ok, mode, kind, label, rows, xLabelFn, xLabelCount, timeZone }

IMPORTANT CHANGE (fix your complaint):
✅ Weekly/Monthly now render TRUE session candles:
   - 1 candle per Chicago session/day (RTH only when intraday)
   - Weekly => 7 candles
   - Monthly => 30 candles
✅ Daily stays intraday (5m) but session-only, RTH only

Notes:
- Cloud Run modes:
  - daily: 5m OHLC points (intraday)
  - weekly: currently returns 6mo + 1wk candles (we still support it), BUT if it returns intraday we aggregate anyway
  - monthly: often still comes back intraday (depends on backend). We aggregate to session candles regardless.
===================================================================== */

(function(){
  "use strict";

  const API = {};
  window.FVMarketsSeries = API;

  const TZ = "America/Chicago";

  const SESSIONS_WEEK = 7;
  const SESSIONS_MONTH = 30;
  const SESSIONS_6MO = 126; // ~21*6
  const SESSIONS_1Y  = 252; // ~21*12

  // RTH window: 08:30–13:20 America/Chicago (client-side)
  const RTH_OPEN_MIN = 8 * 60 + 30;
  const RTH_CLOSE_MIN = 13 * 60 + 20;

  function toNum(x){
    if (typeof x === "number" && isFinite(x)) return x;
    if (typeof x === "string"){
      const v = parseFloat(x);
      return isFinite(v) ? v : null;
    }
    return null;
  }

  function normalizePoints(chartOrPoints){
    if (Array.isArray(chartOrPoints)) return chartOrPoints;
    if (!chartOrPoints) return [];
    return chartOrPoints.points || chartOrPoints.bars || chartOrPoints.data || chartOrPoints.series || [];
  }

  function chicagoDayKeyFromUtc(iso){
    try{
      const d = new Date(iso);
      const fmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year:"numeric", month:"2-digit", day:"2-digit" });
      const parts = fmt.formatToParts(d);
      const y = parts.find(p=>p.type==="year")?.value || "0000";
      const m = parts.find(p=>p.type==="month")?.value || "00";
      const da = parts.find(p=>p.type==="day")?.value || "00";
      return `${y}-${m}-${da}`;
    }catch{
      return "0000-00-00";
    }
  }

  function chicagoHourMinute(iso){
    try{
      const d = new Date(iso);
      const fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: TZ,
        hour:"2-digit",
        minute:"2-digit",
        hour12:false
      });
      const parts = fmt.formatToParts(d);
      const hh = parseInt(parts.find(p=>p.type==="hour")?.value || "0", 10);
      const mm = parseInt(parts.find(p=>p.type==="minute")?.value || "0", 10);
      if (!isFinite(hh) || !isFinite(mm)) return { hh:0, mm:0 };
      return { hh, mm };
    }catch{
      return { hh:0, mm:0 };
    }
  }

  function isRTHPoint(iso){
    if (!iso) return false;
    const { hh, mm } = chicagoHourMinute(iso);
    const minutes = hh * 60 + mm;
    return minutes >= RTH_OPEN_MIN && minutes <= RTH_CLOSE_MIN;
  }

  // Detect intraday: many points per Chicago day bucket
  function isIntraday(points){
    const pts = (points || []).filter(p => p && p.tUtc);
    if (pts.length < 40) return false;

    const counts = new Map();
    for (const p of pts){
      const k = chicagoDayKeyFromUtc(p.tUtc);
      counts.set(k, (counts.get(k) || 0) + 1);
      if ((counts.get(k) || 0) >= 12) return true; // 12+ in a day => intraday
    }
    return false;
  }

  function filterRTH(points){
    return (points || []).filter(p => p && p.tUtc && isRTHPoint(p.tUtc));
  }

  function bucketByChicagoDay(points){
    const pts = (points || []).filter(p => p && p.tUtc);
    const buckets = new Map(); // key -> points[]
    for (const p of pts){
      const k = chicagoDayKeyFromUtc(p.tUtc);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(p);
    }
    const keys = Array.from(buckets.keys()).sort(); // chronological
    return { buckets, keys };
  }

  function sessionOnlyToday(points){
    const pts = (points || []).filter(p => p && p.tUtc);
    if (!pts.length) return [];

    // If intraday, keep RTH only and most recent Chicago day that has RTH points
    if (isIntraday(pts)){
      const rth = filterRTH(pts);
      if (!rth.length) return [];
      const { buckets, keys } = bucketByChicagoDay(rth);
      if (!keys.length) return [];
      const lastKey = keys[keys.length - 1];
      return (buckets.get(lastKey) || []).slice();
    }

    // Non-intraday: keep latest Chicago day
    const lastKey = chicagoDayKeyFromUtc(pts[pts.length - 1].tUtc);
    return pts.filter(p => chicagoDayKeyFromUtc(p.tUtc) === lastKey);
  }

  function lastNSessions(points, n){
    const pts = (points || []).filter(p => p && p.tUtc);
    if (!pts.length) return [];

    const src = isIntraday(pts) ? filterRTH(pts) : pts;

    const { buckets, keys } = bucketByChicagoDay(src);
    if (!keys.length) return [];

    const keepKeys = keys.slice(Math.max(0, keys.length - n));
    const out = [];
    for (const k of keepKeys){
      out.push(...(buckets.get(k) || []));
    }
    return out;
  }

  // ============================
  // Series builders
  // ============================

  function makeIntradayCandleRows(points){
    // Keep each point as a candle (intraday bars)
    const rows = (points || []).map(p => ({
      t: p?.tUtc ?? null,
      o: toNum(p?.o),
      h: toNum(p?.h),
      l: toNum(p?.l),
      c: toNum(p?.c)
    })).filter(r => r.t && r.o != null && r.h != null && r.l != null && r.c != null);
    return rows;
  }

  function makeLineRows(points){
    const rows = (points || []).map(p => ({
      t: p?.tUtc ?? null,
      c: toNum(p?.c ?? p?.close ?? p?.Close)
    })).filter(r => r.t && r.c != null);
    return rows;
  }

  function aggregateToSessionCandles(points){
    // Build ONE candle per Chicago day bucket:
    // open = first bar open, close = last bar close, high=max high, low=min low
    const pts = (points || []).filter(p => p && p.tUtc);
    if (!pts.length) return [];

    // If intraday, force RTH only before bucketing
    const src = isIntraday(pts) ? filterRTH(pts) : pts;

    const { buckets, keys } = bucketByChicagoDay(src);
    const out = [];

    for (const k of keys){
      const arr = (buckets.get(k) || []).slice().sort((a,b)=>{
        // chronological by tUtc
        const ta = Date.parse(a.tUtc || "") || 0;
        const tb = Date.parse(b.tUtc || "") || 0;
        return ta - tb;
      });

      // Extract valid OHLC points
      const bars = arr.map(p => ({
        t: p?.tUtc ?? null,
        o: toNum(p?.o),
        h: toNum(p?.h),
        l: toNum(p?.l),
        c: toNum(p?.c)
      })).filter(b => b.t && b.o != null && b.h != null && b.l != null && b.c != null);

      if (!bars.length) continue;

      const o = bars[0].o;
      const c = bars[bars.length - 1].c;
      let h = -Infinity;
      let l = Infinity;
      for (const b of bars){
        if (b.h != null) h = Math.max(h, b.h);
        if (b.l != null) l = Math.min(l, b.l);
      }
      if (!isFinite(h) || !isFinite(l)) continue;

      // Use the session date as timestamp anchor (use last bar time)
      out.push({
        t: bars[bars.length - 1].t,
        o, h, l, c
      });
    }

    return out;
  }

  // ============================
  // Labels
  // ============================

  function rangeLabel(mode){
    if (mode === "daily") return "Today";
    if (mode === "weekly") return "Last 7 sessions";
    if (mode === "monthly") return "Last 30 sessions";
    if (mode === "6mo") return "Last 6 months";
    if (mode === "1y") return "Last 12 months";
    return "";
  }

  function fmtTimeCT(iso){
    try{
      const d = new Date(iso);
      return new Intl.DateTimeFormat("en-US", {
        timeZone: TZ,
        hour:"numeric",
        minute:"2-digit"
      }).format(d);
    }catch{
      return "";
    }
  }

  function fmtDateCT(iso){
    try{
      const d = new Date(iso);
      return new Intl.DateTimeFormat("en-US", {
        timeZone: TZ,
        month:"numeric",
        day:"numeric"
      }).format(d);
    }catch{
      return "";
    }
  }

  function fmtMonthCT(iso){
    try{
      const d = new Date(iso);
      return new Intl.DateTimeFormat("en-US", {
        timeZone: TZ,
        month:"short"
      }).format(d);
    }catch{
      return "";
    }
  }

  function buildXLabelFn(rows, mode){
    if (!rows || rows.length < 2) return ()=>"";
    if (mode === "daily"){
      // intraday => times
      return (idx)=> fmtTimeCT(rows[idx]?.t);
    }
    if (mode === "weekly" || mode === "monthly"){
      // session candles => dates
      return (idx)=> fmtDateCT(rows[idx]?.t);
    }
    // 6mo / 1y => month names
    return (idx)=> fmtMonthCT(rows[idx]?.t);
  }

  function xLabelCountFor(mode){
    if (mode === "daily") return 4;
    if (mode === "weekly") return 4;
    if (mode === "monthly") return 5;
    if (mode === "6mo") return 5;
    if (mode === "1y") return 6;
    return 4;
  }

  // ============================
  // Public API
  // ============================

  API.shape = function(pointsOrChart, mode, opts){
    const m = String(mode || "daily").toLowerCase();
    const points = normalizePoints(pointsOrChart);

    let shaped = [];
    let kind = "candles";
    let rows = [];

    // DAILY: intraday candles, session-only (RTH only when intraday)
    if (m === "daily"){
      shaped = sessionOnlyToday(points);
      kind = "candles";
      rows = makeIntradayCandleRows(shaped);

      return {
        ok: rows.length >= 2,
        mode: "daily",
        kind,
        label: rangeLabel("daily"),
        rows,
        xLabelFn: buildXLabelFn(rows, "daily"),
        xLabelCount: xLabelCountFor("daily"),
        timeZone: TZ
      };
    }

    // WEEKLY: last 7 sessions => 7 session candles
    if (m === "weekly"){
      shaped = lastNSessions(points, SESSIONS_WEEK);
      kind = "candles";

      // ✅ FIX: aggregate to 1 candle per session/day
      rows = aggregateToSessionCandles(shaped);

      // In case backend already sent 1wk candles (not intraday), aggregateToSessionCandles still works (1 per day bucket)
      return {
        ok: rows.length >= 2,
        mode: "weekly",
        kind,
        label: rangeLabel("weekly"),
        rows,
        xLabelFn: buildXLabelFn(rows, "weekly"),
        xLabelCount: xLabelCountFor("weekly"),
        timeZone: TZ
      };
    }

    // MONTHLY: last 30 sessions => 30 session candles
    if (m === "monthly"){
      shaped = lastNSessions(points, SESSIONS_MONTH);
      kind = "candles";

      // ✅ FIX: aggregate to 1 candle per session/day
      rows = aggregateToSessionCandles(shaped);

      return {
        ok: rows.length >= 2,
        mode: "monthly",
        kind,
        label: rangeLabel("monthly"),
        rows,
        xLabelFn: buildXLabelFn(rows, "monthly"),
        xLabelCount: xLabelCountFor("monthly"),
        timeZone: TZ
      };
    }

    // 6mo: line (last ~126 sessions)
    if (m === "6mo"){
      shaped = lastNSessions(points, SESSIONS_6MO);
      kind = "line";
      rows = makeLineRows(shaped);

      return {
        ok: rows.length >= 2,
        mode: "6mo",
        kind,
        label: rangeLabel("6mo"),
        rows,
        xLabelFn: buildXLabelFn(rows, "6mo"),
        xLabelCount: xLabelCountFor("6mo"),
        timeZone: TZ
      };
    }

    // 1y: line (last ~252 sessions)
    if (m === "1y" || m === "1yr" || m === "year"){
      shaped = lastNSessions(points, SESSIONS_1Y);
      kind = "line";
      rows = makeLineRows(shaped);

      return {
        ok: rows.length >= 2,
        mode: "1y",
        kind,
        label: rangeLabel("1y"),
        rows,
        xLabelFn: buildXLabelFn(rows, "1y"),
        xLabelCount: xLabelCountFor("1y"),
        timeZone: TZ
      };
    }

    // Fallback: daily
    shaped = sessionOnlyToday(points);
    kind = "candles";
    rows = makeIntradayCandleRows(shaped);

    return {
      ok: rows.length >= 2,
      mode: "daily",
      kind,
      label: rangeLabel("daily"),
      rows,
      xLabelFn: buildXLabelFn(rows, "daily"),
      xLabelCount: xLabelCountFor("daily"),
      timeZone: TZ
    };
  };

})();
