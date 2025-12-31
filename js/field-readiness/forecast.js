/* =====================================================================
/Farm-vista/js/field-readiness/forecast.js  (FULL FILE)
Rev: 2025-12-31a

Purpose:
✅ 72-hour “will it be dry?” prediction using:
   - Firestore cache: field_weather_cache/{fieldId}.dailySeries (history <= today)
   - Firestore cache: field_weather_cache/{fieldId}.dailySeriesFcst (forecast > today, next ~7)
✅ If within 72 hours: returns countdown hoursUntilDry
✅ If beyond 72 hours: returns status notWithin72 + a best-effort ETA (if we can estimate)
✅ Uses the SAME physics style as field-readiness.model.js (Option A saturation-aware rain)

Design goals:
- Keep weather.js as fetch/normalize/cache only
- Keep model.js as “current wetness” only
- Put forecasting logic here (pure helper)

How to use (typical UI flow):
1) Ensure your scheduler batch has written dailySeries + dailySeriesFcst to field_weather_cache
2) Call:
   const r = await predictDryForField(fieldId, { soilWetness, drainageIndex }, { threshold: 70 });
   r.status: 'dryNow' | 'within72' | 'notWithin72' | 'noForecast' | 'noData'
   r.hoursUntilDry: number|null
   r.readinessNow: number|null
   r.readinessAt72: number|null
   r.message: string

Notes:
- This file reads Firestore directly (via /Farm-vista/js/firebase-init.js modular exports)
- It does NOT write Firestore
===================================================================== */
'use strict';

/* =====================================================================
   TUNING — tweak these if needed
===================================================================== */
export const FV_FORECAST_TUNE = {
  // Reads these fields from field_weather_cache
  WEATHER_CACHE_COLLECTION: 'field_weather_cache',

  // Prediction threshold (readiness score 0..100; higher = drier)
  DEFAULT_THRESHOLD: 70,

  // Horizon for “countdown” behavior
  HORIZON_HOURS: 72,

  // If you also want a best-effort longer ETA, we’ll simulate up to this many days
  // (limited by available forecast days, but we will not exceed this)
  MAX_SIM_DAYS: 7,

  // If we must approximate "hours from now" using daily steps:
  // We treat readiness changes as occurring at local noon by default.
  // (Good enough for UX; you can change to 18 if you prefer end-of-day.)
  DAILY_EVENT_HOUR_LOCAL: 12
};

/* =====================================================================
   Option A rain-effect tuning (match your UI model defaults)
   If you want, you can override by passing opts.rainTune
===================================================================== */
export const FV_RAIN_TUNE_DEFAULT = {
  SAT_RUNOFF_START: 0.75,
  RUNOFF_EXP: 2.2,
  RUNOFF_DRAINPOOR_W: 0.35,

  DRY_BYPASS_END: 0.35,
  DRY_EXP: 1.6,
  DRY_BYPASS_BASE: 0.45,
  BYPASS_GOODDRAIN_W: 0.15,

  SAT_DRYBYPASS_FLOOR: 0.02,
  SAT_RUNOFF_CAP: 0.85,
  RAIN_EFF_MIN: 0.05
};

/* =====================================================================
   Default physics constants (match your server/index.js defaults)
   You can override by passing opts.EXTRA / opts.LOSS_SCALE.
===================================================================== */
export const FV_PHYS_DEFAULTS = {
  LOSS_SCALE: 0.55,
  EXTRA: {
    DRYPWR_VPD_W: 0.06,
    DRYPWR_CLOUD_W: 0.04,
    LOSS_ET0_W: 0.08,
    ADD_SM010_W: 0.10,
    STORAGE_CAP_SM010_W: 0.05
  }
};

/* ===================================================================== */

function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
function isNum(v){ return Number.isFinite(Number(v)); }
function normISO(s){ return String(s||'').slice(0,10); }

function mergeTune(base, override){
  const out = { ...(base||{}) };
  const src = (override && typeof override === 'object') ? override : null;
  if (src){
    for (const k of Object.keys(out)){
      if (src[k] === null || src[k] === undefined) continue;
      const n = Number(src[k]);
      if (Number.isFinite(n)) out[k] = n;
    }
  }
  return out;
}

function clampRainTune(t){
  const o = { ...(t||{}) };
  o.SAT_RUNOFF_START   = clamp(o.SAT_RUNOFF_START, 0.40, 0.95);
  o.RUNOFF_EXP         = clamp(o.RUNOFF_EXP, 0.8, 6.0);
  o.RUNOFF_DRAINPOOR_W = clamp(o.RUNOFF_DRAINPOOR_W, 0.0, 0.8);

  o.DRY_BYPASS_END     = clamp(o.DRY_BYPASS_END, 0.10, 0.70);
  o.DRY_EXP            = clamp(o.DRY_EXP, 0.8, 6.0);
  o.DRY_BYPASS_BASE    = clamp(o.DRY_BYPASS_BASE, 0.0, 0.85);
  o.BYPASS_GOODDRAIN_W = clamp(o.BYPASS_GOODDRAIN_W, 0.0, 0.6);

  o.SAT_DRYBYPASS_FLOOR= clamp(o.SAT_DRYBYPASS_FLOOR, 0.0, 0.20);
  o.SAT_RUNOFF_CAP     = clamp(o.SAT_RUNOFF_CAP, 0.20, 0.95);
  o.RAIN_EFF_MIN       = clamp(o.RAIN_EFF_MIN, 0.0, 0.20);
  return o;
}

/* =====================================================================
   Firebase modular loader (same pattern you use elsewhere)
===================================================================== */
let __fbModPromise = null;
async function getFirebaseMod(){
  if (__fbModPromise) return __fbModPromise;
  __fbModPromise = (async()=>{
    try{
      const mod = await import('/Farm-vista/js/firebase-init.js');
      if (mod && mod.ready) await mod.ready;
      return mod;
    }catch(_){
      return null;
    }
  })();
  return __fbModPromise;
}

/* =====================================================================
   Read cached series from Firestore:
   field_weather_cache/{fieldId}:
     - dailySeries (history <= today)
     - dailySeriesFcst (forecast > today)
===================================================================== */
export async function readWxSeriesFromCache(fieldId, opts){
  const T = mergeTune(FV_FORECAST_TUNE, opts && opts.tune);
  const colName = String((opts && opts.collectionName) || T.WEATHER_CACHE_COLLECTION || 'field_weather_cache');

  const mod = await getFirebaseMod();
  if (!mod || !(mod.getFirestore && mod.getDoc && mod.doc)) return null;

  try{
    const db = mod.getFirestore();
    const ref = mod.doc(db, colName, String(fieldId));
    const snap = await mod.getDoc(ref);
    if (!snap || !snap.exists || !snap.exists()) return null;

    const data = snap.data() || {};
    const hist = Array.isArray(data.dailySeries) ? data.dailySeries : [];
    const fcst = Array.isArray(data.dailySeriesFcst) ? data.dailySeriesFcst : [];
    const meta = data.dailySeriesMeta || {};

    return {
      hist,
      fcst,
      meta,
      fetchedAt: data.fetchedAt || null,
      timezone: data.timezone || null,
      source: data.source || null
    };
  }catch(_){
    return null;
  }
}

/* =====================================================================
   Physics helpers (matches your model style)
===================================================================== */
function calcDryPartsDay(r, EXTRA){
  const temp = Number(r.tempF||0);
  const wind = Number(r.windMph||0);
  const rh   = Number(r.rh||0);
  const solar= Number(r.solarWm2||0);

  const tempN = clamp((temp - 20) / 45, 0, 1);
  const windN = clamp((wind - 2) / 20, 0, 1);
  const solarN= clamp((solar - 60) / 300, 0, 1);
  const rhN   = clamp((rh - 35) / 65, 0, 1);

  const rawBase = (0.35*tempN + 0.30*solarN + 0.25*windN - 0.25*rhN);
  let dryPwr = clamp(rawBase, 0, 1);

  const vpd = (r.vpdKpa===null || r.vpdKpa===undefined) ? null : Number(r.vpdKpa);
  const cloud = (r.cloudPct===null || r.cloudPct===undefined) ? null : Number(r.cloudPct);

  const vpdN = (vpd===null || !isNum(vpd)) ? 0 : clamp(vpd / 2.6, 0, 1);
  const cloudN = (cloud===null || !isNum(cloud)) ? 0 : clamp(cloud / 100, 0, 1);

  dryPwr = clamp(dryPwr + EXTRA.DRYPWR_VPD_W * vpdN - EXTRA.DRYPWR_CLOUD_W * cloudN, 0, 1);

  const et0 = (r.et0In===null || r.et0In===undefined) ? null : Number(r.et0In);
  const et0N = (et0===null || !isNum(et0)) ? 0 : clamp(et0 / 0.30, 0, 1);

  const smN = (r.sm010===null || r.sm010===undefined || !isNum(r.sm010))
    ? 0
    : clamp((Number(r.sm010)-0.10)/0.25, 0, 1);

  return { dryPwr, et0N, smN_day: smN };
}

function mapFactors(soilWetness0_100, drainageIndex0_100, sm010, EXTRA){
  const soilHold = clamp(Number(soilWetness0_100) / 100, 0, 1);
  const drainPoor= clamp(Number(drainageIndex0_100) / 100, 0, 1);

  const smN = (sm010===null || sm010===undefined || !isNum(sm010))
    ? 0
    : clamp((Number(sm010) - 0.10) / 0.25, 0, 1);

  const infilMult = 0.60 + 0.30*soilHold + 0.35*drainPoor;
  const dryMult   = 1.20 - 0.35*soilHold - 0.40*drainPoor;

  const SmaxBase  = 2.60 + 1.00*soilHold + 0.90*drainPoor;
  const Smax      = SmaxBase * (1 + EXTRA.STORAGE_CAP_SM010_W * smN);

  return { soilHold, drainPoor, smN, infilMult, dryMult, Smax, SmaxBase };
}

function effectiveRainInches(rainIn, storageBefore, Smax, factors, tune){
  const rain = Math.max(0, Number(rainIn||0));
  if (!rain || !isNum(rain) || !isNum(storageBefore) || !isNum(Smax) || Smax <= 0) return 0;

  const sat = clamp(storageBefore / Smax, 0, 1);
  const drainPoor = clamp(Number(factors && factors.drainPoor), 0, 1);

  const sr = clamp((sat - tune.SAT_RUNOFF_START) / Math.max(1e-6, (1 - tune.SAT_RUNOFF_START)), 0, 1);
  let runoffFrac = Math.pow(sr, tune.RUNOFF_EXP);

  runoffFrac = runoffFrac * (1 + tune.RUNOFF_DRAINPOOR_W * drainPoor);
  runoffFrac = clamp(runoffFrac, 0, tune.SAT_RUNOFF_CAP);

  const rainAfterRunoff = rain * (1 - runoffFrac);

  const satB = Math.max(tune.SAT_DRYBYPASS_FLOOR, sat);
  const db = clamp((tune.DRY_BYPASS_END - satB) / Math.max(1e-6, tune.DRY_BYPASS_END), 0, 1);
  const dryBypassCurve = Math.pow(db, tune.DRY_EXP);

  const goodDrain = 1 - drainPoor;
  let bypassFrac = tune.DRY_BYPASS_BASE * dryBypassCurve * (1 + tune.BYPASS_GOODDRAIN_W * goodDrain);
  bypassFrac = clamp(bypassFrac, 0, 0.90);

  const rainEff = rainAfterRunoff * (1 - bypassFrac);

  const minEff = tune.RAIN_EFF_MIN * rain;
  return Math.max(minEff, rainEff);
}

/* =====================================================================
   Compute "current" storage from HISTORY series (<= today)
   Returns { readinessNow, wetnessNow, storage, factors }
===================================================================== */
function computeNowFromHistory(histSeries, soilWetness, drainageIndex, phys){
  if (!Array.isArray(histSeries) || !histSeries.length) return null;

  const EXTRA = phys.EXTRA;
  const LOSS_SCALE = phys.LOSS_SCALE;

  const last = histSeries[histSeries.length - 1] || {};
  const f = mapFactors(soilWetness, drainageIndex, last.sm010, EXTRA);

  // match your model baseline (kept compatible with your existing server snapshot style)
  const first7 = histSeries.slice(0, 7);
  const rain7 = first7.reduce((s,x)=> s + Number(x.rainIn||0), 0);
  const rainNudgeFrac = clamp(rain7 / 8.0, 0, 1);
  const rainNudge = rainNudgeFrac * (0.10 * f.Smax);

  let storage = clamp((0.30 * f.Smax) + rainNudge, 0, f.Smax);

  // Option A rain
  const rainTune = phys.rainTune;

  for (const day of histSeries){
    const parts = calcDryPartsDay(day, EXTRA);
    const before = storage;

    const rain = Number(day.rainIn || 0);
    const rainEff = effectiveRainInches(rain, before, f.Smax, f, rainTune);

    let add = rainEff * f.infilMult;
    add += (EXTRA.ADD_SM010_W * parts.smN_day) * 0.05;

    const loss = Number(parts.dryPwr||0) * LOSS_SCALE * f.dryMult * (1 + EXTRA.LOSS_ET0_W * parts.et0N);

    storage = clamp(before + add - loss, 0, f.Smax);
  }

  const wetnessNow = clamp((storage / f.Smax) * 100, 0, 100);
  const readinessNow = Math.round(clamp(100 - wetnessNow, 0, 100));

  return { readinessNow, wetnessNow, storage, factors: f };
}

/* =====================================================================
   Step forward using forecast days (dailySeriesFcst)
   Returns:
     - readinessAtHorizon (72h)
     - crossingHours (hours until readiness >= threshold), or null
===================================================================== */
function simulateForward(nowState, fcstSeries, threshold, horizonHours, localEventHour){
  if (!nowState) return null;
  if (!Array.isArray(fcstSeries) || !fcstSeries.length) return { readinessAtHorizon: null, crossingHours: null };

  const { storage: storage0, factors: f, phys } = nowState;
  const EXTRA = phys.EXTRA;
  const LOSS_SCALE = phys.LOSS_SCALE;
  const rainTune = phys.rainTune;

  let storage = storage0;

  // We treat each forecast "day row" as applying at localEventHour that day.
  // This is a UX-friendly approximation; the model itself is daily-granular.
  const startMs = Date.now();
  const horizonMs = startMs + (horizonHours * 3600 * 1000);

  let readinessAtHorizon = null;
  let crossingHours = null;

  for (const day of fcstSeries){
    const dateISO = normISO(day.dateISO);
    if (!dateISO) continue;

    const event = new Date(`${dateISO}T${String(localEventHour).padStart(2,'0')}:00:00`);
    const eventMs = event.getTime();

    // If the event time is already past "now", still process it (forecast rows often start tomorrow)
    // but compute crossing/horizon relative to now.
    const parts = calcDryPartsDay(day, EXTRA);

    const before = storage;
    const rain = Number(day.rainIn || 0);
    const rainEff = effectiveRainInches(rain, before, f.Smax, f, rainTune);

    let add = rainEff * f.infilMult;
    add += (EXTRA.ADD_SM010_W * parts.smN_day) * 0.05;

    const loss = Number(parts.dryPwr||0) * LOSS_SCALE * f.dryMult * (1 + EXTRA.LOSS_ET0_W * parts.et0N);

    storage = clamp(before + add - loss, 0, f.Smax);

    const wetness = clamp((storage / f.Smax) * 100, 0, 100);
    const readiness = Math.round(clamp(100 - wetness, 0, 100));

    // horizon sample
    if (eventMs >= horizonMs && readinessAtHorizon === null){
      readinessAtHorizon = readiness;
    }

    // first crossing
    if (crossingHours === null && readiness >= threshold){
      const hrs = Math.max(0, Math.round((eventMs - startMs) / (3600*1000)));
      crossingHours = hrs;
    }
  }

  // If no event landed beyond horizon, approximate using last processed readiness
  if (readinessAtHorizon === null){
    // If we at least processed something, treat the last day as our best horizon proxy
    const last = fcstSeries[fcstSeries.length - 1];
    if (last){
      // not perfect, but better than null
      // (callers can show “72h+”)
      const dateISO = normISO(last.dateISO);
      const event = dateISO ? new Date(`${dateISO}T${String(localEventHour).padStart(2,'0')}:00:00`) : null;
      // we can’t reconstruct final readiness without re-running, so we leave null if unknown
      // (caller will display “unknown”)
    }
  }

  return { readinessAtHorizon, crossingHours };
}

/* =====================================================================
   Public API: predict dry for a fieldId
   params: { soilWetness, drainageIndex }
   opts:
     - threshold (readiness threshold)
     - horizonHours (default 72)
     - maxSimDays (default 7)
     - collectionName (override cache collection)
     - tune (override FV_FORECAST_TUNE)
     - EXTRA / LOSS_SCALE (override physics)
     - rainTune (override Option A tune)
===================================================================== */
export async function predictDryForField(fieldId, params, opts){
  const T = mergeTune(FV_FORECAST_TUNE, opts && opts.tune);

  const threshold = isNum(opts && opts.threshold) ? Number(opts.threshold) : T.DEFAULT_THRESHOLD;
  const horizonHours = isNum(opts && opts.horizonHours) ? Number(opts.horizonHours) : T.HORIZON_HOURS;
  const maxSimDays = isNum(opts && opts.maxSimDays) ? Number(opts.maxSimDays) : T.MAX_SIM_DAYS;
  const eventHour = isNum(opts && opts.dailyEventHourLocal) ? Number(opts.dailyEventHourLocal) : T.DAILY_EVENT_HOUR_LOCAL;

  const soilWetness = isNum(params && params.soilWetness) ? Number(params.soilWetness) : 60;
  const drainageIndex = isNum(params && params.drainageIndex) ? Number(params.drainageIndex) : 45;

  const wx = await readWxSeriesFromCache(fieldId, { collectionName: opts && opts.collectionName, tune: T });
  if (!wx) {
    return {
      ok: false,
      status: 'noData',
      fieldId,
      readinessNow: null,
      hoursUntilDry: null,
      message: 'No cached weather found for this field yet.'
    };
  }

  const hist = Array.isArray(wx.hist) ? wx.hist : [];
  const fcstRaw = Array.isArray(wx.fcst) ? wx.fcst : [];

  if (!hist.length){
    return {
      ok: false,
      status: 'noData',
      fieldId,
      readinessNow: null,
      hoursUntilDry: null,
      message: 'Weather history series is empty.'
    };
  }

  // physics setup
  const phys = {
    LOSS_SCALE: isNum(opts && opts.LOSS_SCALE) ? Number(opts.LOSS_SCALE) : FV_PHYS_DEFAULTS.LOSS_SCALE,
    EXTRA: mergeTune(FV_PHYS_DEFAULTS.EXTRA, opts && opts.EXTRA),
    rainTune: clampRainTune(mergeTune(FV_RAIN_TUNE_DEFAULT, opts && opts.rainTune))
  };

  // compute now
  const nowState0 = computeNowFromHistory(hist, soilWetness, drainageIndex, phys);
  if (!nowState0){
    return {
      ok: false,
      status: 'noData',
      fieldId,
      readinessNow: null,
      hoursUntilDry: null,
      message: 'Unable to compute current readiness from history.'
    };
  }

  const readinessNow = Number(nowState0.readinessNow);

  // already dry enough
  if (readinessNow >= threshold){
    return {
      ok: true,
      status: 'dryNow',
      fieldId,
      readinessNow,
      readinessAt72: readinessNow,
      hoursUntilDry: 0,
      threshold,
      message: `Dry now (≥ ${threshold}).`
    };
  }

  // no forecast available
  if (!fcstRaw.length){
    return {
      ok: true,
      status: 'noForecast',
      fieldId,
      readinessNow,
      readinessAt72: null,
      hoursUntilDry: null,
      threshold,
      message: 'No forecast series cached yet (dailySeriesFcst missing).'
    };
  }

  // limit to maxSimDays (and keep only valid future rows)
  const fcst = fcstRaw
    .filter(d => d && d.dateISO)
    .slice(0, clamp(maxSimDays, 1, 16));

  // attach phys to state
  const nowState = { ...nowState0, phys };

  const sim = simulateForward(nowState, fcst, threshold, horizonHours, eventHour);
  const crossing = sim ? sim.crossingHours : null;
  const readinessAt72 = sim ? sim.readinessAtHorizon : null;

  if (crossing !== null && crossing <= horizonHours){
    return {
      ok: true,
      status: 'within72',
      fieldId,
      readinessNow,
      readinessAt72,
      hoursUntilDry: crossing,
      threshold,
      message: (crossing <= 0)
        ? `Dry now (≥ ${threshold}).`
        : `Est: ~${crossing} hours`
    };
  }

  // Not within 72h (or not reached in available forecast window)
  // If crossing exists but beyond horizon, we can show "72h+" and optional ETA.
  const eta = (crossing !== null) ? crossing : null;

  return {
    ok: true,
    status: 'notWithin72',
    fieldId,
    readinessNow,
    readinessAt72,
    hoursUntilDry: eta,      // may be null if never crossed in available forecast
    threshold,
    message: (eta !== null)
      ? (eta > horizonHours ? `> ${horizonHours} hours (Est: ~${eta}h)` : `> ${horizonHours} hours`)
      : `> ${horizonHours} hours`
  };
}
