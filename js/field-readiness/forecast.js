/* =====================================================================
/Farm-vista/js/field-readiness/forecast.js  (FULL FILE)
Rev: 2025-12-31b

Fix:
✅ Forecast predictor now applies the SAME wetBias (calibration) used by tiles.
   - Pass opts.wetBias (points on 0..100 wetness scale; + = wetter, - = drier)
   - Applied AFTER physics wetness, BEFORE readiness compare
   - Makes “within 72h” match tile reality

Everything else unchanged.
===================================================================== */
'use strict';

/* =====================================================================
   TUNING — tweak these if needed
===================================================================== */
export const FV_FORECAST_TUNE = {
  WEATHER_CACHE_COLLECTION: 'field_weather_cache',
  DEFAULT_THRESHOLD: 70,
  HORIZON_HOURS: 72,
  MAX_SIM_DAYS: 7,
  DAILY_EVENT_HOUR_LOCAL: 12
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

function applyWetBiasToWetness(wetnessPhysical, wetBiasPoints){
  const wb = isNum(wetBiasPoints) ? clamp(Number(wetBiasPoints), -25, 25) : 0;
  return clamp(Number(wetnessPhysical) + wb, 0, 100);
}

/* =====================================================================
   Compute "current" storage from HISTORY series (<= today)
   Returns { readinessNow, wetnessNow, storage, factors }
===================================================================== */
function computeNowFromHistory(histSeries, soilWetness, drainageIndex, phys, wetBias){
  if (!Array.isArray(histSeries) || !histSeries.length) return null;

  const EXTRA = phys.EXTRA;
  const LOSS_SCALE = phys.LOSS_SCALE;

  const last = histSeries[histSeries.length - 1] || {};
  const f = mapFactors(soilWetness, drainageIndex, last.sm010, EXTRA);

  const first7 = histSeries.slice(0, 7);
  const rain7 = first7.reduce((s,x)=> s + Number(x.rainIn||0), 0);
  const rainNudgeFrac = clamp(rain7 / 8.0, 0, 1);
  const rainNudge = rainNudgeFrac * (0.10 * f.Smax);

  let storage = clamp((0.30 * f.Smax) + rainNudge, 0, f.Smax);

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

  const wetnessPhys = clamp((storage / f.Smax) * 100, 0, 100);
  const wetnessNow = applyWetBiasToWetness(wetnessPhys, wetBias);
  const readinessNow = Math.round(clamp(100 - wetnessNow, 0, 100));

  return { readinessNow, wetnessNow, storage, factors: f };
}

/* =====================================================================
   Step forward using forecast days (dailySeriesFcst)
===================================================================== */
function simulateForward(nowState, fcstSeries, threshold, horizonHours, localEventHour, wetBias){
  if (!nowState) return null;
  if (!Array.isArray(fcstSeries) || !fcstSeries.length) return { readinessAtHorizon: null, crossingHours: null };

  const { storage: storage0, factors: f, phys } = nowState;
  const EXTRA = phys.EXTRA;
  const LOSS_SCALE = phys.LOSS_SCALE;
  const rainTune = phys.rainTune;

  let storage = storage0;

  const startMs = Date.now();
  const horizonMs = startMs + (horizonHours * 3600 * 1000);

  let readinessAtHorizon = null;
  let crossingHours = null;

  for (const day of fcstSeries){
    const dateISO = normISO(day.dateISO);
    if (!dateISO) continue;

    const event = new Date(`${dateISO}T${String(localEventHour).padStart(2,'0')}:00:00`);
    const eventMs = event.getTime();

    const parts = calcDryPartsDay(day, EXTRA);

    const before = storage;
    const rain = Number(day.rainIn || 0);
    const rainEff = effectiveRainInches(rain, before, f.Smax, f, rainTune);

    let add = rainEff * f.infilMult;
    add += (EXTRA.ADD_SM010_W * parts.smN_day) * 0.05;

    const loss = Number(parts.dryPwr||0) * LOSS_SCALE * f.dryMult * (1 + EXTRA.LOSS_ET0_W * parts.et0N);

    storage = clamp(before + add - loss, 0, f.Smax);

    const wetPhys = clamp((storage / f.Smax) * 100, 0, 100);
    const wet = applyWetBiasToWetness(wetPhys, wetBias);
    const readiness = Math.round(clamp(100 - wet, 0, 100));

    if (eventMs >= horizonMs && readinessAtHorizon === null){
      readinessAtHorizon = readiness;
    }

    if (crossingHours === null && readiness >= threshold){
      const hrs = Math.max(0, Math.round((eventMs - startMs) / (3600*1000)));
      crossingHours = hrs;
    }
  }

  return { readinessAtHorizon, crossingHours };
}

/* =====================================================================
   Public API
===================================================================== */
export async function predictDryForField(fieldId, params, opts){
  const T = mergeTune(FV_FORECAST_TUNE, opts && opts.tune);

  const threshold = isNum(opts && opts.threshold) ? Number(opts.threshold) : T.DEFAULT_THRESHOLD;
  const horizonHours = isNum(opts && opts.horizonHours) ? Number(opts.horizonHours) : T.HORIZON_HOURS;
  const maxSimDays = isNum(opts && opts.maxSimDays) ? Number(opts.maxSimDays) : T.MAX_SIM_DAYS;
  const eventHour = isNum(opts && opts.dailyEventHourLocal) ? Number(opts.dailyEventHourLocal) : T.DAILY_EVENT_HOUR_LOCAL;

  const soilWetness = isNum(params && params.soilWetness) ? Number(params.soilWetness) : 60;
  const drainageIndex = isNum(params && params.drainageIndex) ? Number(params.drainageIndex) : 45;

  // ✅ NEW: wetBias points (same meaning as CAL.wetBias)
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

  const phys = {
    LOSS_SCALE: isNum(opts && opts.LOSS_SCALE) ? Number(opts.LOSS_SCALE) : FV_PHYS_DEFAULTS.LOSS_SCALE,
    EXTRA: mergeTune(FV_PHYS_DEFAULTS.EXTRA, opts && opts.EXTRA),
    rainTune: clampRainTune(mergeTune(FV_RAIN_TUNE_DEFAULT, opts && opts.rainTune))
  };

  const nowState0 = computeNowFromHistory(hist, soilWetness, drainageIndex, phys, wetBias);
  if (!nowState0){
    return { ok:false, status:'noData', fieldId, readinessNow:null, hoursUntilDry:null, message:'Unable to compute current readiness from history.' };
  }

  const readinessNow = Number(nowState0.readinessNow);

  if (readinessNow >= threshold){
    return { ok:true, status:'dryNow', fieldId, readinessNow, readinessAt72: readinessNow, hoursUntilDry: 0, threshold, message:`Dry now (≥ ${threshold}).` };
  }

  if (!fcstRaw.length){
    return { ok:true, status:'noForecast', fieldId, readinessNow, readinessAt72:null, hoursUntilDry:null, threshold, message:'No forecast series cached yet (dailySeriesFcst missing).' };
  }

  const fcst = fcstRaw
    .filter(d => d && d.dateISO)
    .slice(0, clamp(maxSimDays, 1, 16));

  const nowState = { ...nowState0, phys };

  const sim = simulateForward(nowState, fcst, threshold, horizonHours, eventHour, wetBias);
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
      message: (crossing <= 0) ? `Dry now (≥ ${threshold}).` : `Est: ~${crossing} hours`
    };
  }

  const eta = (crossing !== null) ? crossing : null;

  return {
    ok: true,
    status: 'notWithin72',
    fieldId,
    readinessNow,
    readinessAt72,
    hoursUntilDry: eta,
    threshold,
    message: (eta !== null)
      ? (eta > horizonHours ? `> ${horizonHours} hours (Est: ~${eta}h)` : `> ${horizonHours} hours`)
      : `> ${horizonHours} hours`
  };
}
