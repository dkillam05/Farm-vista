/* =====================================================================
/Farm-vista/js/dash-markets-series.js  (FULL FILE)
Rev: 2026-01-28a
Purpose:
✅ Time-range + series shaping helper for FarmVista Markets charts (standalone)
✅ Converts Cloud Run chart.points[] into normalized series rows for:
   - Candles (OHLC) for: daily / weekly / monthly
   - Line (close) for: 6mo / 1y
✅ Enforces your rules:
   - Daily = TODAY session only (no overnight) using America/Chicago day bucket
   - Weekly = last 7 trading sessions (last 7 Chicago day buckets)
   - Monthly = last 30 trading sessions (last 30 Chicago day buckets)
   - 6mo = last ~126 sessions
   - 1y = last ~252 sessions
✅ Provides:
   - range label text (replaces "Points:")
   - x-axis label function appropriate to mode (times for daily, dates for weekly/monthly, months for 6mo/1y)
✅ Safe global API:
   window.FVMarketsSeries.shape(points, mode, opts) -> { ok, mode, kind, label, rows, xLabelFn, xLabelCount, timeZone }
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
    const lastKey = chicagoDayKeyFromUtc(pts[pts.length - 1].tUtc);
    return pts.filter(p => chicagoDayKeyFromUtc(p.tUtc) === lastKey);
  }

  function lastNSessions(points, n){
    const { buckets, keys } = bucketByChicagoDay(points);
    if (!keys.length) return [];
    const keepKeys = keys.slice(Math.max(0, keys.length - n));
    const out = [];
    for (const k of keepKeys){
      out.push(...(buckets.get(k) || []));
    }
    return out;
  }

  function makeCandleSeries(points){
    const rows = (points || []).map(p => ({
      t: p?.tUtc ?? null,
      o: toNum(p?.o),
      h: toNum(p?.h),
      l: toNum(p?.l),
      c: toNum(p?.c)
    })).filter(r => r.t && r.o != null && r.h != null && r.l != null && r.c != null);
    return rows;
  }

  function makeLineSeries(points){
    const rows = (points || []).map(p => ({
      t: p?.tUtc ?? null,
      c: toNum(p?.c ?? p?.close ?? p?.Close)
    })).filter(r => r.t && r.c != null);
    return rows;
  }

  function rangeLabel(mode){
    if (mode === "daily") return "Today";
    if (mode === "weekly") return "Last 7 sessions";
    if (mode === "monthly") return "Last 30 sessions";
    if (mode === "6mo") return "Last 6 months";
    if (mode === "1y") return "Last 12 months";
    return "";
  }

  // X label formatters
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
      return (idx)=> fmtTimeCT(rows[idx]?.t);
    }
    if (mode === "weekly" || mode === "monthly"){
      return (idx)=> fmtDateCT(rows[idx]?.t);
    }
    // 6mo / 1y
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

  // Public: shape chart.points into renderable rows + labels
  API.shape = function(pointsOrChart, mode, opts){
    const m = String(mode || "daily").toLowerCase();
    const points = normalizePoints(pointsOrChart);

    let shaped = [];
    let kind = "candles";

    if (m === "daily"){
      shaped = sessionOnlyToday(points);
      kind = "candles";
      const rows = makeCandleSeries(shaped);
      return {
        ok: rows.length >= 2,
        mode: m,
        kind,
        label: rangeLabel(m),
        rows,
        xLabelFn: buildXLabelFn(rows, m),
        xLabelCount: xLabelCountFor(m),
        timeZone: TZ
      };
    }

    if (m === "weekly"){
      shaped = lastNSessions(points, SESSIONS_WEEK);
      kind = "candles";
      const rows = makeCandleSeries(shaped);
      return {
        ok: rows.length >= 2,
        mode: m,
        kind,
        label: rangeLabel(m),
        rows,
        xLabelFn: buildXLabelFn(rows, m),
        xLabelCount: xLabelCountFor(m),
        timeZone: TZ
      };
    }

    if (m === "monthly"){
      shaped = lastNSessions(points, SESSIONS_MONTH);
      kind = "candles";
      const rows = makeCandleSeries(shaped);
      return {
        ok: rows.length >= 2,
        mode: m,
        kind,
        label: rangeLabel(m),
        rows,
        xLabelFn: buildXLabelFn(rows, m),
        xLabelCount: xLabelCountFor(m),
        timeZone: TZ
      };
    }

    if (m === "6mo"){
      shaped = lastNSessions(points, SESSIONS_6MO);
      kind = "line";
      const rows = makeLineSeries(shaped);
      return {
        ok: rows.length >= 2,
        mode: m,
        kind,
        label: rangeLabel(m),
        rows,
        xLabelFn: buildXLabelFn(rows, m),
        xLabelCount: xLabelCountFor(m),
        timeZone: TZ
      };
    }

    if (m === "1y" || m === "1yr" || m === "year"){
      shaped = lastNSessions(points, SESSIONS_1Y);
      kind = "line";
      const rows = makeLineSeries(shaped);
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

    // fallback: treat unknown as daily
    shaped = sessionOnlyToday(points);
    kind = "candles";
    const rows = makeCandleSeries(shaped);
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
