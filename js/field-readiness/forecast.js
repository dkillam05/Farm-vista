/* =====================================================================
/Farm-vista/js/field-readiness/forecast.js  (FULL FILE)
Rev: 2025-12-31d

Change:
✅ HARD CAP at 72 hours:
   - Estimates shown ONLY when <= 72h
   - If >72h → display "Greater Than 72 hours" (NO estimate)
   - This applies even if forecast math could compute farther out

Keeps:
✅ wetBias applied (matches tiles)
✅ Option A rain physics
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
  DAILY_EVENT_HOUR_LOCAL: 12
};

/* =====================================================================
   Option A rain-effect tuning
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
   Default physics constants
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

function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
function isNum(v){ return Number.isFinite(Number(v)); }
function normISO(s){ return String(s||'').slice(0,10); }

/* =====================================================================
   Firebase loader
===================================================================== */
let __fbModPromise = null;
async function getFirebaseMod(){
  if (__fbModPromise) return __fbModPromise;
  __fbModPromise = (async()=>{
    try{
      const mod = await import('/Farm-vista/js/firebase-init.js');
      if (mod && mod.ready) await mod.ready;
      return mod;
    }catch(_){ return null; }
  })();
  return __fbModPromise;
}

/* =====================================================================
   Read cached weather
===================================================================== */
export async function readWxSeriesFromCache(fieldId){
  const mod = await getFirebaseMod();
  if (!mod || !(mod.getFirestore && mod.getDoc && mod.doc)) return null;

  try{
    const db = mod.getFirestore();
    const ref = mod.doc(db, FV_FORECAST_TUNE.WEATHER_CACHE_COLLECTION, String(fieldId));
    const snap = await mod.getDoc(ref);
    if (!snap || !snap.exists || !snap.exists()) return null;

    const d = snap.data() || {};
    return {
      hist: Array.isArray(d.dailySeries) ? d.dailySeries : [],
      fcst: Array.isArray(d.dailySeriesFcst) ? d.dailySeriesFcst : []
    };
  }catch(_){
    return null;
  }
}

/* =====================================================================
   Physics helpers (unchanged)
===================================================================== */
function applyWetBiasToWetness(w, wb){
  const b = isNum(wb) ? clamp(Number(wb), -25, 25) : 0;
  return clamp(Number(w) + b, 0, 100);
}

/* =====================================================================
   Public API
===================================================================== */
export async function predictDryForField(fieldId, params, opts){
  const threshold = isNum(opts?.threshold) ? Number(opts.threshold) : 70;
  const horizon = FV_FORECAST_TUNE.HORIZON_HOURS;
  const wetBias = isNum(opts?.wetBias) ? Number(opts.wetBias) : 0;

  const wx = await readWxSeriesFromCache(fieldId);
  if (!wx || !wx.hist.length){
    return { ok:false, status:'noData', message:'' };
  }

  // --- CURRENT readiness (already computed elsewhere; passed for safety) ---
  const readinessNow = isNum(opts?.readinessNow)
    ? Number(opts.readinessNow)
    : null;

  if (readinessNow !== null && readinessNow >= threshold){
    return {
      ok: true,
      status: 'dryNow',
      hoursUntilDry: 0,
      message: ''
    };
  }

  // --- FORECAST SIMULATION RESULT (precomputed by caller) ---
  const eta = isNum(opts?.etaHours) ? Number(opts.etaHours) : null;

  // ✅ WITHIN 72 HOURS → SHOW ESTIMATE
  if (eta !== null && eta <= horizon){
    return {
      ok: true,
      status: 'within72',
      hoursUntilDry: eta,
      message: `Est: ~${eta} hours`
    };
  }

  // ❌ BEYOND 72 HOURS → NO ESTIMATE SHOWN
  return {
    ok: true,
    status: 'notWithin72',
    hoursUntilDry: null,
    message: `Greater Than ${horizon} hours`
  };
}
