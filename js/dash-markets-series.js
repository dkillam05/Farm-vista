/* =====================================================================
/Farm-vista/js/dash-markets-series.js  (FULL FILE)
Rev: 2026-01-28e
Purpose:
✅ Time-range + series shaping helper for FarmVista Markets charts (standalone)
✅ Converts Cloud Run chart.points[] into normalized series rows for:
   - Candles (OHLC)
   - Line (close)
✅ Enforces your rules + Yahoo-style labels:
   - 1D  = TODAY session only (no overnight) using America/Chicago buckets + RTH filter (intraday)
   - 5D  = last 5 trading sessions, HOURLY candlesticks (RTH only when intraday)
   - 1M  = last 30 trading sessions, DAILY candlesticks (1 candle per day)
   - 6M  = line (close), last ~126 sessions
   - 1Y  = line (close), last ~252 sessions
✅ Backward compatibility:
   - Accepts legacy mode names: daily/weekly/monthly/6mo/1y
   - Maps them to Yahoo equivalents internally:
       daily   -> 1d
       weekly  -> 5d
       monthly -> 1m
       6mo     -> 6m
       1y      -> 1y
✅ Provides:
   - range label text (replaces "Points:")
   - x-axis label function appropriate to mode

Fixes in this rev:
✅ 5D x-axis labels now include MONTH/DAY (not just “9am”)
   - Labels are "M/D H" in America/Chicago
   - So even if the sampled ticks land on the same hour each day, you still see the date
✅ 5D label count slightly increased for readability

✅ Safe global API:
   window.FVMarketsSeries.shape(points, mode, opts) -> { ok, mode, kind, label, rows, xLabelFn, xLabelCount, timeZone }
===================================================================== */

(function(){
  "use strict";

  const API = {};
  window.FVMarketsSeries = API;

  const TZ = "America/Chicago";

  // Session counts
  const SESSIONS_5D   = 5;
  const SESSIONS_1M   = 30;
  const SESSIONS_6M   = 126; // ~21*6
  const SESSIONS_1Y   = 252; // ~21*12

  // RTH window: 08:30–13:20 America/Chicago (client-side)
  // NOTE: This is what you asked for to remove overnight trades.
  const RTH_OPEN_MIN  = 8 * 60 + 30;
  const RTH_CLOSE_MIN = 13 * 60 + 20;

  // For 5D hourly candles, we bucket by hour (CT)
  const HOUR_MINUTES = 60;

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

  // ---------------------------------------
  // Mode normalization (Yahoo-style labels)
  // ---------------------------------------
  function normMode(mode){
    const m = String(mode || "").toLowerCase().trim();

    // Yahoo-style
    if (m === "1d" || m === "1day") return "1d";
    if (m === "5d" || m === "5day") return "5d";
    if (m === "1m" || m === "1mo" || m === "1mon" || m === "month") return "1m";
    if (m === "6m" || m === "6mo" || m === "6mon") return "6m";
    if (m === "1y" || m === "1yr" || m === "year") return "1y";

    // Legacy labels used earlier in this project
    if (m === "daily") return "1d";
    if (m === "weekly") return "5d";     // you want 5D like Yahoo, not weekly bars
    if (m === "monthly") return "1m";
    if (m === "6mo") return "6m";
    if (m === "1y") return "1y";

    // Fallback
    return "1d";
  }

  function rangeLabel(mode){
    if (mode === "1d") return "1D";
    if (mode === "5d") return "5D";
    if (mode === "1m") return "1M";
    if (mode === "6m") return "6M";
    if (mode === "1y") return "1Y";
    return "";
  }

  // ---------------------------------------
  // Time helpers (Chicago)
  // ---------------------------------------
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

  // ---------------------------------------
  // Series builders
  // ---------------------------------------
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
        const ta = Date.parse(a.tUtc || "") || 0;
        const tb = Date.parse(b.tUtc || "") || 0;
        return ta - tb;
      });

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

      out.push({
        t: bars[bars.length - 1].t, // anchor
        o, h, l, c
      });
    }

    return out;
  }

  function aggregateToHourlyCandles(points){
    // Build HOURLY candles within each Chicago day bucket.
    // - If intraday, first apply RTH filter (requested).
    // - Then bucket by Chicago day + Chicago hour.
    const pts = (points || []).filter(p => p && p.tUtc);
    if (!pts.length) return [];

    const src = isIntraday(pts) ? filterRTH(pts) : pts;

    // dayKey|hourKey -> bars[]
    const buckets = new Map();

    for (const p of src){
      const t = p?.tUtc;
      if (!t) continue;

      const dayKey = chicagoDayKeyFromUtc(t);
      const { hh } = chicagoHourMinute(t);

      // Hour bucket start (00..23)
      const hourKey = String(hh).padStart(2, "0");

      const key = `${dayKey}|${hourKey}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(p);
    }

    const keys = Array.from(buckets.keys()).sort(); // chronological by day then hour (string sortable)

    const out = [];
    for (const k of keys){
      const arr = (buckets.get(k) || []).slice().sort((a,b)=>{
        const ta = Date.parse(a.tUtc || "") || 0;
        const tb = Date.parse(b.tUtc || "") || 0;
        return ta - tb;
      });

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

      out.push({
        t: bars[bars.length - 1].t,
        o, h, l, c
      });
    }

    return out;
  }

  // ---------------------------------------
  // X label formatters
  // ---------------------------------------
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

  // ✅ FIX: 5D labels should show date + hour, not just hour
  // Example: "1/28 9a" or "1/28 9 AM" depending on locale.
  function fmtDateHourCT(iso){
    try{
      const d = new Date(iso);

      const date = new Intl.DateTimeFormat("en-US", {
        timeZone: TZ,
        month:"numeric",
        day:"numeric"
      }).format(d);

      const hour = new Intl.DateTimeFormat("en-US", {
        timeZone: TZ,
        hour:"numeric"
      }).format(d);

      return `${date} ${hour}`;
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

    // 1D: intraday (5m) => show times
    if (mode === "1d"){
      return (idx)=> fmtTimeCT(rows[idx]?.t);
    }

    // 5D: hourly candles => show "M/D H"
    if (mode === "5d"){
      return (idx)=> fmtDateHourCT(rows[idx]?.t);
    }

    // 1M: daily candles => dates
    if (mode === "1m"){
      return (idx)=> fmtDateCT(rows[idx]?.t);
    }

    // 6M / 1Y lines => months
    return (idx)=> fmtMonthCT(rows[idx]?.t);
  }

  function xLabelCountFor(mode){
    if (mode === "1d") return 4;

    // ✅ small bump so you see multiple days clearly on wide screens
    if (mode === "5d") return 6;

    if (mode === "1m") return 5;
    if (mode === "6m") return 5;
    if (mode === "1y") return 6;
    return 4;
  }

  // ---------------------------------------
  // Public API
  // ---------------------------------------
  API.shape = function(pointsOrChart, mode, opts){
    const m = normMode(mode);
    const points = normalizePoints(pointsOrChart);

    let shaped = [];
    let kind = "candles";
    let rows = [];

    // 1D: intraday candles, session-only (RTH only when intraday)
    if (m === "1d"){
      shaped = sessionOnlyToday(points);
      kind = "candles";
      rows = makeIntradayCandleRows(shaped);

      return {
        ok: rows.length >= 2,
        mode: "1d",
        kind,
        label: rangeLabel("1d"),
        rows,
        xLabelFn: buildXLabelFn(rows, "1d"),
        xLabelCount: xLabelCountFor("1d"),
        timeZone: TZ
      };
    }

    // 5D: last 5 sessions, HOURLY candles (Yahoo-like)
    if (m === "5d"){
      shaped = lastNSessions(points, SESSIONS_5D);
      kind = "candles";

      rows = aggregateToHourlyCandles(shaped);

      return {
        ok: rows.length >= 2,
        mode: "5d",
        kind,
        label: rangeLabel("5d"),
        rows,
        xLabelFn: buildXLabelFn(rows, "5d"),
        xLabelCount: xLabelCountFor("5d"),
        timeZone: TZ
      };
    }

    // 1M: last 30 sessions, DAILY candles (1 candle per day)
    if (m === "1m"){
      shaped = lastNSessions(points, SESSIONS_1M);
      kind = "candles";

      rows = aggregateToSessionCandles(shaped);

      return {
        ok: rows.length >= 2,
        mode: "1m",
        kind,
        label: rangeLabel("1m"),
        rows,
        xLabelFn: buildXLabelFn(rows, "1m"),
        xLabelCount: xLabelCountFor("1m"),
        timeZone: TZ
      };
    }

    // 6M: line close
    if (m === "6m"){
      shaped = lastNSessions(points, SESSIONS_6M);
      kind = "line";
      rows = makeLineRows(shaped);

      return {
        ok: rows.length >= 2,
        mode: "6m",
        kind,
        label: rangeLabel("6m"),
        rows,
        xLabelFn: buildXLabelFn(rows, "6m"),
        xLabelCount: xLabelCountFor("6m"),
        timeZone: TZ
      };
    }

    // 1Y: line close
    if (m === "1y"){
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

    // Fallback: 1D
    shaped = sessionOnlyToday(points);
    kind = "candles";
    rows = makeIntradayCandleRows(shaped);

    return {
      ok: rows.length >= 2,
      mode: "1d",
      kind,
      label: rangeLabel("1d"),
      rows,
      xLabelFn: buildXLabelFn(rows, "1d"),
      xLabelCount: xLabelCountFor("1d"),
      timeZone: TZ
    };
  };

})();
