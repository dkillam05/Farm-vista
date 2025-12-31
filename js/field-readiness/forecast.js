/* =====================================================================
/Farm-vista/js/field-readiness/forecast.js  (FULL FILE)
Rev: 2025-12-31g

Fix (per Dane):
✅ ETA now uses SAME FarmVista daily weather modeling, but simulates in sub-daily steps
   to eliminate “cliff jumps”.
   - Inputs remain your canonical daily rows (same as the rest of the app):
       rainIn, tempF, windMph, rh, solarWm2, cloudPct, vpdKpa, sm010, et0In
   - We simulate forward in STEP_HOURS increments up to 72 hours.
   - Rain for each day is distributed across the day (uniform) for sub-steps.
   - Drying/loss is scaled per-step (stepHours/24).

Rules:
✅ Show "Est: ~X hours" ONLY if X <= 72
✅ Else show "Greater Than 72 hours"
✅ "Greater Than" casing kept

Keeps:
✅ wetBias applied exactly like tiles
✅ Option A saturation-aware rain effectiveness
===================================================================== */
'use strict';

/* =====================================================================
   TUNING
===================================================================== */
export const FV_FORECAST_TUNE = {
  WEATHER_CACHE_COLLECTION: 'field_weather_cache',
  DEFAULT_THRESHOLD: 70,
  HORIZON_HOURS: 72,
  MAX_SIM_DAYS: 7,

  // Key change: sub-daily simulation step (smaller => smoother)
  // 3 is a good balance; 1 is very smooth but more compute.
  STEP_HOURS: 3
};

/* =====================================================================
   Option A rain-effect tuning (match your UI model defaults)
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
function toNum(v, d=0){ const n = Number(v); return Number.isFinite(n) ? n : d; }

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
   Firebase modular loader
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
    return { hist, fcst };
  }catch(_){
    return null;
  }
}

/* =====================================================================
   Physics helpers (same as model.js approach)
===================================================================== */
function calcDryPartsDay(r, EXTRA){
  const temp = toNum(r.tempF, 0);
  const wind = toNum(r.windMph, 0);
  const rh   = toNum(r.rh, 0);
  const solar= toNum(r.solarWm2, 0);

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

  return { soilHold, drainPoor, smN, infilMult, dryMult, Smax };
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

function applyWetBiasToWetness(wetnessPhysical, wetBiasPoints){
  const wb = isNum(wetBiasPoints) ? clamp(Number(wetBiasPoints), -25, 25) : 0;
  return clamp(Number(wetnessPhysical) + wb, 0, 100);
}

/* =====================================================================
   Compute storage + readiness "now" from history (same baseline style)
===================================================================== */
function computeNowFromHistory(histSeries, soilWetness, drainageIndex, phys, wetBias){
  const EXTRA = phys.EXTRA;
  const LOSS_SCALE = phys.LOSS_SCALE;

  const last = histSeries[histSeries.length - 1] || {};
  const f = mapFactors(soilWetness, drainageIndex, last.sm010, EXTRA);

  const first7 = histSeries.slice(0, 7);
  const rain7 = first7.reduce((s,x)=> s + Number(x.rainIn||0), 0);
  const rainNudgeFrac = clamp(rain7 / 8.0, 0, 1);
  const rainNudge = rainNudgeFrac * (0.10 * f.Smax);

  let storage = clamp((0.30 * f.Smax) + rainNudge, 0, f.Smax);

  for (const day of histSeries){
    const parts = calcDryPartsDay(day, EXTRA);

    const before = storage;

    // history uses daily rain already (this matches your model)
    const rain = Number(day.rainIn || 0);
    const rainEff = effectiveRainInches(rain, before, f.Smax, f, phys.rainTune);

    let add = rainEff * f.infilMult;
    add += (EXTRA.ADD_SM010_W * parts.smN_day) * 0.05;

    const loss = Number(parts.dryPwr||0) * LOSS_SCALE * f.dryMult * (1 + EXTRA.LOSS_ET0_W * parts.et0N);

    storage = clamp(before + add - loss, 0, f.Smax);
  }

  const wetPhys = clamp((storage / f.Smax) * 100, 0, 100);
  const wet = applyWetBiasToWetness(wetPhys, wetBias);
  const readiness = clamp(100 - wet, 0, 100);

  return { storage, factors: f, readinessNow: readiness };
}

/* =====================================================================
   Sub-daily forward simulation (FarmVista daily inputs, scaled per step)
===================================================================== */
function lerp(a,b,t){ return a + (b-a)*t; }

// Build an “effective day row” at fractional position between day i and i+1.
// This stays in the SAME canonical daily modeling universe.
function interpDayRow(d0, d1, frac){
  const a = d0 || {};
  const b = d1 || d0 || {};
  const f = clamp(frac, 0, 1);

  function lerpNum(k, fallback=0){
    const va = toNum(a[k], fallback);
    const vb = toNum(b[k], va);
    return lerp(va, vb, f);
  }
  function lerpNullable(k){
    const va = a[k];
    const vb = b[k];
    if (va == null && vb == null) return null;
    if (va == null) return vb;
    if (vb == null) return va;
    return lerpNum(k, 0);
  }

  return {
    // for our math, we only need these:
    rainIn: lerpNum('rainIn', 0),
    tempF:  lerpNum('tempF', 0),
    windMph:lerpNum('windMph', 0),
    rh:     lerpNum('rh', 0),
    solarWm2: lerpNum('solarWm2', 0),

    cloudPct: lerpNullable('cloudPct'),
    vpdKpa:   lerpNullable('vpdKpa'),
    sm010:    lerpNullable('sm010'),
    et0In:    lerpNullable('et0In')
  };
}

function simulateEtaHoursSubdaily(nowState, fcstSeries, threshold, phys, wetBias, horizonHours, stepHours){
  const EXTRA = phys.EXTRA;
  const LOSS_SCALE = phys.LOSS_SCALE;

  const stepH = clamp(Number(stepHours||3), 1, 12);
  const steps = Math.ceil(horizonHours / stepH);

  let storage = nowState.storage;
  const f = nowState.factors;

  let prevReadiness = Number(nowState.readinessNow);
  let prevT = 0;

  // Ensure we have enough forecast rows for the horizon. (72h => up to 3 days)
  const fcst = (fcstSeries || []).filter(d => d && d.dateISO).slice();
  if (!fcst.length) return null;

  // We simulate along the forecast day index.
  // tHours -> dayFloat = tHours/24. i = floor(dayFloat), frac = dayFloat - i
  for (let s=1; s<=steps; s++){
    const tHours = Math.min(horizonHours, s * stepH);
    const dayFloat = tHours / 24;
    const i = Math.floor(dayFloat);
    const frac = dayFloat - i;

    const d0 = fcst[Math.min(i, fcst.length - 1)];
    const d1 = fcst[Math.min(i + 1, fcst.length - 1)];
    const row = interpDayRow(d0, d1, frac);

    // Distribute daily rain across day for sub-steps.
    // Convert row.rainIn (daily) to rain for this step.
    const stepRain = (toNum(row.rainIn, 0) / 24) * stepH;

    const parts = calcDryPartsDay(row, EXTRA);

    const before = storage;

    const rainEff = effectiveRainInches(stepRain, before, f.Smax, f, phys.rainTune);

    // Scale the “soil moisture nudge” for sub-steps (it was per-day in model)
    let add = rainEff * f.infilMult;
    add += ((EXTRA.ADD_SM010_W * parts.smN_day) * 0.05) * (stepH / 24);

    // Scale loss to the step duration
    const lossDay = Number(parts.dryPwr||0) * LOSS_SCALE * f.dryMult * (1 + EXTRA.LOSS_ET0_W * parts.et0N);
    const loss = lossDay * (stepH / 24);

    storage = clamp(before + add - loss, 0, f.Smax);

    const wetPhys = clamp((storage / f.Smax) * 100, 0, 100);
    const wet = applyWetBiasToWetness(wetPhys, wetBias);
    const readiness = clamp(100 - wet, 0, 100);

    // Cross upward?
    if (prevReadiness < threshold && readiness >= threshold){
      const denom = readiness - prevReadiness;
      const fracCross = denom <= 1e-6 ? 1 : clamp((threshold - prevReadiness) / denom, 0, 1);
      const eta = prevT + fracCross * (tHours - prevT);
      return Math.max(0, Math.round(eta));
    }

    prevReadiness = readiness;
    prevT = tHours;
  }

  return null;
}

/* =====================================================================
   Public API
===================================================================== */
export async function predictDryForField(fieldId, params, opts){
  const T = mergeTune(FV_FORECAST_TUNE, opts && opts.tune);

  const threshold = isNum(opts && opts.threshold) ? Number(opts.threshold) : T.DEFAULT_THRESHOLD;
  const horizonHours = isNum(opts && opts.horizonHours) ? Number(opts.horizonHours) : T.HORIZON_HOURS;
  const maxSimDays = isNum(opts && opts.maxSimDays) ? Number(opts.maxSimDays) : T.MAX_SIM_DAYS;

  const soilWetness = isNum(params && params.soilWetness) ? Number(params.soilWetness) : 60;
  const drainageIndex = isNum(params && params.drainageIndex) ? Number(params.drainageIndex) : 45;

  const wetBias = isNum(opts && opts.wetBias) ? clamp(Number(opts.wetBias), -25, 25) : 0;

  const wx = await readWxSeriesFromCache(fieldId, { collectionName: opts && opts.collectionName, tune: T });
  if (!wx) {
    return { ok:false, status:'noData', fieldId, readinessNow:null, hoursUntilDry:null, message:'No cached weather found for this field yet.' };
  }

  const hist = Array.isArray(wx.hist) ? wx.hist : [];
  const fcstRaw = Array.isArray(wx.fcst) ? wx.fcst : [];

  if (!hist.length){
    return { ok:false, status:'noData', fieldId, readinessNow:null, hoursUntilDry:null, message:'Weather history series is empty.' };
  }

  // limit forecast days to what caller requests (still uses your canonical daily forecast series)
  const fcst = fcstRaw
    .filter(d => d && d.dateISO)
    .slice(0, clamp(maxSimDays, 1, 16));

  const phys = {
    LOSS_SCALE: isNum(opts && opts.LOSS_SCALE) ? Number(opts.LOSS_SCALE) : FV_PHYS_DEFAULTS.LOSS_SCALE,
    EXTRA: mergeTune(FV_PHYS_DEFAULTS.EXTRA, opts && opts.EXTRA),
    rainTune: clampRainTune(mergeTune(FV_RAIN_TUNE_DEFAULT, opts && opts.rainTune))
  };

  const nowState = computeNowFromHistory(hist, soilWetness, drainageIndex, phys, wetBias);
  if (!nowState){
    return { ok:false, status:'noData', fieldId, readinessNow:null, hoursUntilDry:null, message:'Unable to compute current readiness from history.' };
  }

  const readinessNow = Math.round(clamp(nowState.readinessNow, 0, 100));

  if (readinessNow >= threshold){
    return { ok:true, status:'dryNow', fieldId, readinessNow, readinessAt72: readinessNow, hoursUntilDry: 0, threshold, message:`Dry now (≥ ${threshold}).` };
  }

  if (!fcst.length){
    return { ok:true, status:'noForecast', fieldId, readinessNow, readinessAt72:null, hoursUntilDry:null, threshold, message:'No forecast series cached yet (dailySeriesFcst missing).' };
  }

  const stepH = clamp(Number(T.STEP_HOURS || 3), 1, 12);

  const eta = simulateEtaHoursSubdaily(
    nowState,
    fcst,
    threshold,
    phys,
    wetBias,
    horizonHours,
    stepH
  );

  if (eta !== null && eta <= horizonHours){
    return {
      ok: true,
      status: 'within72',
      fieldId,
      readinessNow,
      readinessAt72: null,
      hoursUntilDry: eta,
      threshold,
      message: `Est: ~${eta} hours`
    };
  }

  return {
    ok: true,
    status: 'notWithin72',
    fieldId,
    readinessNow,
    readinessAt72: null,
    hoursUntilDry: null,
    threshold,
    message: `Greater Than ${horizonHours} hours`
  };
}
