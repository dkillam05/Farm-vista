/* =====================================================================
/Farm-vista/js/dash-markets-series.js  (FULL FILE)
Rev: 2026-01-29f
Purpose:
✅ Time-range + series shaping helper for FarmVista Markets charts (standalone)
✅ Converts Cloud Run chart.points[] into normalized series rows for:
   - Candles (OHLC)
   - Line (close)
✅ Enforces your rules + Yahoo-style labels:
   - 1D  = TODAY session only (no overnight) using America/Chicago buckets + RTH filter (intraday)
   - 5D  = last 5 trading sessions, HOURLY candlesticks (RTH only when intraday)  ✅ requested
   - 1M  = last 30 trading sessions, DAILY candlesticks (1 candle per day)        ✅ requested
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
✅ Safe global API:
   window.FVMarketsSeries.shape(points, mode, opts) -> { ok, mode, kind, label, rows, xLabelFn, xLabelCount, timeZone, sessionLabel }

Fixes in this rev:
✅ 1D will NOT go blank in the morning:
   - If today has no RTH bars yet, it shows yesterday’s most recent RTH session instead.
✅ Adds sessionLabel (e.g., "Thu 1/29" or "Wed 1/28") so UI can display what day is shown.
✅ 5D x-axis is orientation-aware:
   - Portrait (vertical): DATE ONLY (M/D) — no hour (prevents overlap)
   - Landscape (horizontal): Hour labels, with DATE shown only at day breaks (Yahoo-like)
✅ 1M “one day behind / missing Friday / Sunday trades” FIX (final):
   - Daily bars can be timestamp-anchored near UTC midnight.
   - We bucket daily bars using a +12h shifted dayKey (Chicago).
   - AND we normalize EACH DAILY CANDLE'S OUTPUT TIMESTAMP `t` to MIDDAY CHICAGO of that dayKey,
     so labels/click-details match the real calendar day.
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
  // Orientation helper (portrait vs landscape)
  // ---------------------------------------
  function detectLandscape(opts){
    // Allow caller to force it: shape(points, mode, { isLandscape:true/false })
    if (opts && typeof opts.isLandscape === "boolean") return opts.isLandscape;

    try{
      if (typeof window !== "undefined"){
        if (window.matchMedia){
          const mq = window.matchMedia("(orientation: landscape)");
          if (mq && typeof mq.matches === "boolean") return mq.matches;
        }
        if (typeof window.innerWidth === "number" && typeof window.innerHeight === "number"){
          return window.innerWidth > window.innerHeight;
        }
      }
    }catch{}
    return false; // default to portrait
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

  // Daily-bar safety: shift +12h before converting to Chicago day
  function chicagoDayKeyFromUtcShifted(iso, shiftHours){
    const hrs = (typeof shiftHours === "number" && isFinite(shiftHours)) ? shiftHours : 12;
    try{
      const ms = Date.parse(iso || "");
      if (!isFinite(ms)) return chicagoDayKeyFromUtc(iso);
      const d = new Date(ms + hrs * 60 * 60 * 1000);
      const fmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year:"numeric", month:"2-digit", day:"2-digit" });
      const parts = fmt.formatToParts(d);
      const y = parts.find(p=>p.type==="year")?.value || "0000";
      const m = parts.find(p=>p.type==="month")?.value || "00";
      const da = parts.find(p=>p.type==="day")?.value || "00";
      return `${y}-${m}-${da}`;
    }catch{
      return chicagoDayKeyFromUtc(iso);
    }
  }

  // ✅ Normalized ISO for a given Chicago dayKey at MIDDAY (12:00 CT)
  // Used for DAILY candle output timestamps so labels/clicks match calendar day.
  function isoFromChicagoDayKeyMidday(dayKey){
    try{
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dayKey || ""));
      if (!m) return null;

      const y = parseInt(m[1], 10);
      const mo = parseInt(m[2], 10);
      const da = parseInt(m[3], 10);
      if (!isFinite(y) || !isFinite(mo) || !isFinite(da)) return null;

      // We need an ISO that formats to that Chicago date at ~12:00.
      // Build a UTC date that is safely inside the Chicago day:
      // Choose 18:00 UTC which is 12:00 CT (standard) or 13:00 CT (DST),
      // still safely same calendar day for our labeling.
      const d = new Date(Date.UTC(y, mo - 1, da, 18, 0, 0));
      return d.toISOString();
    }catch{
      return null;
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

  function bucketByChicagoDayWith(points, dayKeyFn){
    const pts = (points || []).filter(p => p && p.tUtc);
    const buckets = new Map(); // key -> points[]
    for (const p of pts){
      const k = dayKeyFn(p.tUtc);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(p);
    }
    const keys = Array.from(buckets.keys()).sort(); // chronological
    return { buckets, keys };
  }

  function bucketByChicagoDay(points){
    return bucketByChicagoDayWith(points, chicagoDayKeyFromUtc);
  }

  function fmtSessionLabelFromDayKey(dayKey){
    try{
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dayKey || ""));
      if (!m) return "";
      const y = parseInt(m[1], 10);
      const mo = parseInt(m[2], 10);
      const da = parseInt(m[3], 10);
      const d = new Date(Date.UTC(y, mo - 1, da, 12, 0, 0));
      return new Intl.DateTimeFormat("en-US", {
        timeZone: TZ,
        weekday: "short",
        month: "numeric",
        day: "numeric"
      }).format(d);
    }catch{
      return "";
    }
  }

  function session1dPreferTodayElsePrev(points){
    const pts = (points || []).filter(p => p && p.tUtc);
    if (!pts.length) return { points: [], dayKey: "" };

    const intraday = isIntraday(pts);

    if (!intraday){
      const lastKey = chicagoDayKeyFromUtcShifted(pts[pts.length - 1].tUtc, 12);
      const out = pts.filter(p => chicagoDayKeyFromUtcShifted(p.tUtc, 12) === lastKey);
      return { points: out, dayKey: lastKey };
    }

    const rth = filterRTH(pts);
    if (!rth.length){
      const lastKey = chicagoDayKeyFromUtc(pts[pts.length - 1].tUtc);
      const out = pts.filter(p => chicagoDayKeyFromUtc(p.tUtc) === lastKey);
      return { points: out, dayKey: lastKey };
    }

    const { buckets, keys } = bucketByChicagoDay(rth);
    if (!keys.length) return { points: [], dayKey: "" };

    const lastKey = keys[keys.length - 1];
    const out = (buckets.get(lastKey) || []).slice();
    return { points: out, dayKey: lastKey };
  }

  function lastNSessions(points, n){
    const pts = (points || []).filter(p => p && p.tUtc);
    if (!pts.length) return [];

    const intraday = isIntraday(pts);
    const src = intraday ? filterRTH(pts) : pts;

    const dayKeyFn = intraday
      ? chicagoDayKeyFromUtc
      : (iso)=>chicagoDayKeyFromUtcShifted(iso, 12);

    const { buckets, keys } = bucketByChicagoDayWith(src, dayKeyFn);
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
    const pts = (points || []).filter(p => p && p.tUtc);
    if (!pts.length) return [];

    const intraday = isIntraday(pts);

    // If intraday, force RTH only before bucketing
    const src = intraday ? filterRTH(pts) : pts;

    // If daily bars, use shifted dayKey to avoid “one day behind”
    const dayKeyFn = intraday
      ? chicagoDayKeyFromUtc
      : (iso)=>chicagoDayKeyFromUtcShifted(iso, 12);

    const { buckets, keys } = bucketByChicagoDayWith(src, dayKeyFn);
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

      // ✅ IMPORTANT: for DAILY candles, normalize output timestamp to midday Chicago of the dayKey.
      // This is what fixes the “still 1 day behind” when clicking/labeling.
      let tOut = bars[bars.length - 1].t; // default anchor
      if (!intraday){
        const mid = isoFromChicagoDayKeyMidday(k);
        if (mid) tOut = mid;
      }

      out.push({
        t: tOut,
        o, h, l, c
      });
    }

    return out;
  }

  function aggregateToHourlyCandles(points){
    const pts = (points || []).filter(p => p && p.tUtc);
    if (!pts.length) return [];

    const src = isIntraday(pts) ? filterRTH(pts) : pts;

    const buckets = new Map();

    for (const p of src){
      const t = p?.tUtc;
      if (!t) continue;

      const dayKey = chicagoDayKeyFromUtc(t);
      const { hh, mm } = chicagoHourMinute(t);

      const hourKey = String(hh).padStart(2, "0");

      const key = `${dayKey}|${hourKey}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(p);
    }

    const keys = Array.from(buckets.keys()).sort();

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

  function fmtHourCT(iso){
    try{
      const d = new Date(iso);
      return new Intl.DateTimeFormat("en-US", {
        timeZone: TZ,
        hour:"numeric"
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

  function build5dLandscapeLabelFn(rows){
    return (idx)=>{
      const t = rows[idx]?.t;
      if (!t) return "";
      const curDay = chicagoDayKeyFromUtc(t);
      const prevT = rows[idx - 1]?.t;
      const prevDay = prevT ? chicagoDayKeyFromUtc(prevT) : null;

      if (idx === 0 || (prevDay && prevDay !== curDay)) return fmtDateCT(t);
      return fmtHourCT(t);
    };
  }

  function buildXLabelFn(rows, mode, opts){
    if (!rows || rows.length < 2) return ()=>"";

    if (mode === "1d"){
      return (idx)=> fmtTimeCT(rows[idx]?.t);
    }

    if (mode === "5d"){
      const isLand = detectLandscape(opts);
      if (!isLand){
        return (idx)=> fmtDateCT(rows[idx]?.t);
      }
      return build5dLandscapeLabelFn(rows);
    }

    if (mode === "1m"){
      return (idx)=> fmtDateCT(rows[idx]?.t);
    }

    return (idx)=> fmtMonthCT(rows[idx]?.t);
  }

  function xLabelCountFor(mode, opts){
    if (mode === "1d") return 4;

    if (mode === "5d"){
      const isLand = detectLandscape(opts);
      return isLand ? 8 : 6;
    }

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
    let sessionLabel = "";

    if (m === "1d"){
      const pick = session1dPreferTodayElsePrev(points);
      shaped = pick.points;
      sessionLabel = fmtSessionLabelFromDayKey(pick.dayKey);
      kind = "candles";
      rows = makeIntradayCandleRows(shaped);

      return {
        ok: rows.length >= 2,
        mode: "1d",
        kind,
        label: rangeLabel("1d"),
        sessionLabel,
        rows,
        xLabelFn: buildXLabelFn(rows, "1d", opts),
        xLabelCount: xLabelCountFor("1d", opts),
        timeZone: TZ
      };
    }

    if (m === "5d"){
      shaped = lastNSessions(points, SESSIONS_5D);
      kind = "candles";
      rows = aggregateToHourlyCandles(shaped);

      return {
        ok: rows.length >= 2,
        mode: "5d",
        kind,
        label: rangeLabel("5d"),
        sessionLabel: "",
        rows,
        xLabelFn: buildXLabelFn(rows, "5d", opts),
        xLabelCount: xLabelCountFor("5d", opts),
        timeZone: TZ
      };
    }

    if (m === "1m"){
      shaped = lastNSessions(points, SESSIONS_1M);
      kind = "candles";
      rows = aggregateToSessionCandles(shaped);

      return {
        ok: rows.length >= 2,
        mode: "1m",
        kind,
        label: rangeLabel("1m"),
        sessionLabel: "",
        rows,
        xLabelFn: buildXLabelFn(rows, "1m", opts),
        xLabelCount: xLabelCountFor("1m", opts),
        timeZone: TZ
      };
    }

    if (m === "6m"){
      shaped = lastNSessions(points, SESSIONS_6M);
      kind = "line";
      rows = makeLineRows(shaped);

      return {
        ok: rows.length >= 2,
        mode: "6m",
        kind,
        label: rangeLabel("6m"),
        sessionLabel: "",
        rows,
        xLabelFn: buildXLabelFn(rows, "6m", opts),
        xLabelCount: xLabelCountFor("6m", opts),
        timeZone: TZ
      };
    }

    if (m === "1y"){
      shaped = lastNSessions(points, SESSIONS_1Y);
      kind = "line";
      rows = makeLineRows(shaped);

      return {
        ok: rows.length >= 2,
        mode: "1y",
        kind,
        label: rangeLabel("1y"),
        sessionLabel: "",
        rows,
        xLabelFn: buildXLabelFn(rows, "1y", opts),
        xLabelCount: xLabelCountFor("1y", opts),
        timeZone: TZ
      };
    }

    const pick = session1dPreferTodayElsePrev(points);
    shaped = pick.points;
    sessionLabel = fmtSessionLabelFromDayKey(pick.dayKey);
    kind = "candles";
    rows = makeIntradayCandleRows(shaped);

    return {
      ok: rows.length >= 2,
      mode: "1d",
      kind,
      label: rangeLabel("1d"),
      sessionLabel,
      rows,
      xLabelFn: buildXLabelFn(rows, "1d", opts),
      xLabelCount: xLabelCountFor("1d", opts),
      timeZone: TZ
    };
  };

})();
