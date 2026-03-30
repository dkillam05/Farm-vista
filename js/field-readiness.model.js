/* =====================================================================
/Farm-vista/js/field-readiness.model.js  (FULL FILE)
Rev: 2026-03-30c-eta-full-restructure-stable-forward-sim

GOAL:
✅ Match the new no-state backend direction
✅ Remove persisted-state and ETA-seed dependence
✅ Keep coupled storage + surface physics
✅ Keep ETA using the same model physics
✅ Seed from rewind window or baseline only
✅ Default to rewind mode (10 days) so model behaves closer to index
✅ COMPLETELY RESTRUCTURE ETA so it is stable and believable

IMPORTANT:
- No persisted state
- No field_readiness_state dependency
- No ETA seed from field_readiness_latest
- "Now" comes from the model run itself
===================================================================== */
'use strict';

function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
function roundInt(x){
  const n = Number(x);
  return Number.isFinite(n) ? Math.round(n) : 0;
}
function roundTo(x, d = 2){
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  const p = Math.pow(10, d);
  return Math.round(n * p) / p;
}
function safePct01(v){
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return clamp(n / 100, 0, 1);
}
function snap01(x){
  const v = Number(x);
  if (!Number.isFinite(v)) return 0;
  if (v <= 0.01) return 0;
  if (v >= 0.99) return 1;
  return v;
}
function todayISO(){
  try{
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  }catch(_){
    return '';
  }
}
function safeObj(x){
  return (x && typeof x === 'object') ? x : null;
}
function safeNum(v, fallback = null){
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function lerp(a,b,t){ return a + (b-a)*t; }
function toNum(v, d=0){
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

// Slider extremes
const SMAX_MIN = 3.0;
const SMAX_MAX = 5.0;
const SMAX_MID = 4.0;

// EXTREME: 20 points each way => 40 total swing
const REV_POINTS_MAX = 20;

/**
 * SIGNED credit in inches:
 *  - at Smax=3 => + (20% of Smax)  => subtracts water => drier => readiness UP
 *  - at Smax=4 => 0
 *  - at Smax=5 => - (20% of Smax) => adds water      => wetter => readiness DOWN
 */
function signedCreditInchesFromSmax(Smax){
  const s = clamp(Number(Smax), SMAX_MIN, SMAX_MAX);
  const signed = clamp((SMAX_MID - s) / 1.0, -1, 1);
  return signed * (REV_POINTS_MAX / 100) * s;
}

/* =====================================================================
   FV_TUNE
===================================================================== */
const FV_TUNE = {
  SAT_RUNOFF_START: 0.75,
  RUNOFF_EXP: 2.2,
  RUNOFF_DRAINPOOR_W: 0.35,

  DRY_BYPASS_END: 0.35,
  DRY_EXP: 1.6,
  DRY_BYPASS_BASE: 0.45,
  BYPASS_GOODDRAIN_W: 0.15,

  DRY_BYPASS_CAP_SAT: 0.15,
  DRY_BYPASS_CAP_MAX: 0.12,

  SAT_DRYBYPASS_FLOOR: 0.02,
  SAT_RUNOFF_CAP: 0.85,
  RAIN_EFF_MIN: 0.05,

  DRY_TAIL_START: 0.12,
  DRY_TAIL_MIN_MULT: 0.55,

  WET_HOLD_START: 0.62,
  WET_HOLD_MAX_REDUCTION: 0.32,
  WET_HOLD_EXP: 1.7,

  MID_ACCEL_START: 0.50,
  MID_ACCEL_MAX_BOOST: 0.18,
  MID_ACCEL_EXP: 1.35,

  // Surface storage system
  SURFACE_CAP_IN: 0.70,
  SURFACE_RAIN_CAPTURE: 1.00,
  SURFACE_PENALTY_MAX: 36,
  SURFACE_PENALTY_EXP: 1.20,

  SURFACE_DRY_BASE: 0.05,
  SURFACE_DRY_DRYPWR_W: 0.22,
  SURFACE_DRY_ET0_W: 0.14,
  SURFACE_DRY_WIND_W: 0.07,
  SURFACE_DRY_SUN_W: 0.07,
  SURFACE_DRY_VPD_W: 0.05,
  SURFACE_DRY_CLOUD_W: 0.08,

  // Same-day rain timing
  SAME_DAY_LATE_RAIN_DRY_FLOOR: 0.25,
  SAME_DAY_MORNING_RAIN_DRY_MIN: 0.78,
  SAME_DAY_MIDDAY_RAIN_DRY_MIN: 0.58,
  SAME_DAY_EVENING_RAIN_DRY_MIN: 0.20,

  // Surface -> storage handoff
  SURFACE_TO_STORAGE_BASE: 0.10,
  SURFACE_TO_STORAGE_DRY_W: 0.06,
  SURFACE_TO_STORAGE_MORNING_W: 0.08,
  SURFACE_TO_STORAGE_EVENING_W: 0.05,
  SURFACE_TO_STORAGE_MAX_FRAC: 0.28,

  // Wet surface suppresses deep drying
  SURFACE_WET_HOLD_START_FRAC: 0.28,
  SURFACE_WET_HOLD_MAX_REDUCTION: 0.25,

  // Storage floor while surface still wet
  SURFACE_STORAGE_FLOOR_W: 0.12,
  SURFACE_STORAGE_FLOOR_CAP_FRAC: 0.06,

  // ETA pacing / guardrails
  ETA_MAX_GAIN_PER_HOUR: 0.28,
  ETA_STEPS_PER_DAY: 2,                 // 12h steps
  ETA_REQUIRE_CONSECUTIVE_STEPS: 2,     // must stay above threshold for 2 steps
  ETA_MIN_HOURS_ANY_WET: 6,
  ETA_MIN_HOURS_80S: 18,
  ETA_MIN_HOURS_70S: 36,
  ETA_MIN_HOURS_60S: 60,
  ETA_WET_RAIN_LOCK_HOURS: 24,
  ETA_HEAVY_RAIN_LOCK_HOURS: 48,
  ETA_MAX_DAILY_GAIN: 10
};

function getTune(deps){
  const t = { ...FV_TUNE };
  const srcA = (deps && deps.FV_TUNE && typeof deps.FV_TUNE === 'object') ? deps.FV_TUNE : null;
  const srcB = (deps && deps.EXTRA && typeof deps.EXTRA === 'object') ? deps.EXTRA : null;

  for (const src of [srcA, srcB]){
    if (!src) continue;
    for (const k of Object.keys(t)){
      if (src[k] === null || src[k] === undefined) continue;
      const v = Number(src[k]);
      if (isFinite(v)) t[k] = v;
    }
  }

  t.SAT_RUNOFF_START   = clamp(t.SAT_RUNOFF_START, 0.40, 0.95);
  t.RUNOFF_EXP         = clamp(t.RUNOFF_EXP, 0.8, 6.0);
  t.RUNOFF_DRAINPOOR_W = clamp(t.RUNOFF_DRAINPOOR_W, 0.0, 0.8);

  t.DRY_BYPASS_END     = clamp(t.DRY_BYPASS_END, 0.10, 0.70);
  t.DRY_EXP            = clamp(t.DRY_EXP, 0.8, 6.0);
  t.DRY_BYPASS_BASE    = clamp(t.DRY_BYPASS_BASE, 0.0, 0.85);
  t.BYPASS_GOODDRAIN_W = clamp(t.BYPASS_GOODDRAIN_W, 0.0, 0.6);

  t.DRY_BYPASS_CAP_SAT = clamp(t.DRY_BYPASS_CAP_SAT, 0.03, 0.35);
  t.DRY_BYPASS_CAP_MAX = clamp(t.DRY_BYPASS_CAP_MAX, 0.0, 0.35);

  t.SAT_DRYBYPASS_FLOOR= clamp(t.SAT_DRYBYPASS_FLOOR, 0.0, 0.20);
  t.SAT_RUNOFF_CAP     = clamp(t.SAT_RUNOFF_CAP, 0.20, 0.95);
  t.RAIN_EFF_MIN       = clamp(t.RAIN_EFF_MIN, 0.0, 0.20);

  t.DRY_TAIL_START     = clamp(t.DRY_TAIL_START, 0.03, 0.30);
  t.DRY_TAIL_MIN_MULT  = clamp(t.DRY_TAIL_MIN_MULT, 0.20, 1.00);

  t.WET_HOLD_START        = clamp(t.WET_HOLD_START, 0.40, 0.90);
  t.WET_HOLD_MAX_REDUCTION= clamp(t.WET_HOLD_MAX_REDUCTION, 0.00, 0.60);
  t.WET_HOLD_EXP          = clamp(t.WET_HOLD_EXP, 0.6, 4.0);

  t.MID_ACCEL_START    = clamp(t.MID_ACCEL_START, t.DRY_TAIL_START + 0.05, 0.80);
  t.MID_ACCEL_MAX_BOOST= clamp(t.MID_ACCEL_MAX_BOOST, 0.00, 0.40);
  t.MID_ACCEL_EXP      = clamp(t.MID_ACCEL_EXP, 0.6, 4.0);

  t.SURFACE_CAP_IN = clamp(t.SURFACE_CAP_IN, 0.10, 1.25);
  t.SURFACE_RAIN_CAPTURE = clamp(t.SURFACE_RAIN_CAPTURE, 0.20, 1.50);
  t.SURFACE_PENALTY_MAX = clamp(t.SURFACE_PENALTY_MAX, 5, 60);
  t.SURFACE_PENALTY_EXP = clamp(t.SURFACE_PENALTY_EXP, 0.60, 2.00);

  t.SURFACE_DRY_BASE = clamp(t.SURFACE_DRY_BASE, 0.00, 0.20);
  t.SURFACE_DRY_DRYPWR_W = clamp(t.SURFACE_DRY_DRYPWR_W, 0.00, 0.40);
  t.SURFACE_DRY_ET0_W = clamp(t.SURFACE_DRY_ET0_W, 0.00, 0.25);
  t.SURFACE_DRY_WIND_W = clamp(t.SURFACE_DRY_WIND_W, 0.00, 0.20);
  t.SURFACE_DRY_SUN_W = clamp(t.SURFACE_DRY_SUN_W, 0.00, 0.20);
  t.SURFACE_DRY_VPD_W = clamp(t.SURFACE_DRY_VPD_W, 0.00, 0.20);
  t.SURFACE_DRY_CLOUD_W = clamp(t.SURFACE_DRY_CLOUD_W, 0.00, 0.20);

  t.SAME_DAY_LATE_RAIN_DRY_FLOOR = clamp(t.SAME_DAY_LATE_RAIN_DRY_FLOOR, 0.05, 0.50);
  t.SAME_DAY_MORNING_RAIN_DRY_MIN = clamp(t.SAME_DAY_MORNING_RAIN_DRY_MIN, 0.35, 1.00);
  t.SAME_DAY_MIDDAY_RAIN_DRY_MIN = clamp(t.SAME_DAY_MIDDAY_RAIN_DRY_MIN, 0.20, 0.90);
  t.SAME_DAY_EVENING_RAIN_DRY_MIN = clamp(t.SAME_DAY_EVENING_RAIN_DRY_MIN, 0.05, 0.60);

  t.SURFACE_TO_STORAGE_BASE = clamp(t.SURFACE_TO_STORAGE_BASE, 0.02, 0.30);
  t.SURFACE_TO_STORAGE_DRY_W = clamp(t.SURFACE_TO_STORAGE_DRY_W, 0.00, 0.25);
  t.SURFACE_TO_STORAGE_MORNING_W = clamp(t.SURFACE_TO_STORAGE_MORNING_W, 0.00, 0.25);
  t.SURFACE_TO_STORAGE_EVENING_W = clamp(t.SURFACE_TO_STORAGE_EVENING_W, 0.00, 0.25);
  t.SURFACE_TO_STORAGE_MAX_FRAC = clamp(t.SURFACE_TO_STORAGE_MAX_FRAC, 0.05, 0.60);

  t.SURFACE_WET_HOLD_START_FRAC = clamp(t.SURFACE_WET_HOLD_START_FRAC, 0.05, 0.60);
  t.SURFACE_WET_HOLD_MAX_REDUCTION = clamp(t.SURFACE_WET_HOLD_MAX_REDUCTION, 0.00, 0.80);

  t.SURFACE_STORAGE_FLOOR_W = clamp(t.SURFACE_STORAGE_FLOOR_W, 0.00, 1.00);
  t.SURFACE_STORAGE_FLOOR_CAP_FRAC = clamp(t.SURFACE_STORAGE_FLOOR_CAP_FRAC, 0.00, 0.60);

  t.ETA_MAX_GAIN_PER_HOUR = clamp(t.ETA_MAX_GAIN_PER_HOUR, 0.05, 2.0);
  t.ETA_STEPS_PER_DAY = clamp(Math.round(t.ETA_STEPS_PER_DAY), 1, 4);
  t.ETA_REQUIRE_CONSECUTIVE_STEPS = clamp(Math.round(t.ETA_REQUIRE_CONSECUTIVE_STEPS), 1, 4);
  t.ETA_MIN_HOURS_ANY_WET = clamp(t.ETA_MIN_HOURS_ANY_WET, 1, 48);
  t.ETA_MIN_HOURS_80S = clamp(t.ETA_MIN_HOURS_80S, 1, 72);
  t.ETA_MIN_HOURS_70S = clamp(t.ETA_MIN_HOURS_70S, 1, 120);
  t.ETA_MIN_HOURS_60S = clamp(t.ETA_MIN_HOURS_60S, 1, 168);
  t.ETA_WET_RAIN_LOCK_HOURS = clamp(t.ETA_WET_RAIN_LOCK_HOURS, 0, 72);
  t.ETA_HEAVY_RAIN_LOCK_HOURS = clamp(t.ETA_HEAVY_RAIN_LOCK_HOURS, 0, 96);
  t.ETA_MAX_DAILY_GAIN = clamp(t.ETA_MAX_DAILY_GAIN, 1, 30);

  return t;
}

function getRateMults(deps){
  try{
    const EXTRA = (deps && deps.EXTRA && typeof deps.EXTRA === 'object') ? deps.EXTRA : {};
    const dryLossMult = Number(EXTRA.DRY_LOSS_MULT);
    const rainEffMult = Number(EXTRA.RAIN_EFF_MULT);

    return {
      dryLossMult: clamp(isFinite(dryLossMult) ? dryLossMult : 1.0, 0.30, 3.00),
      rainEffMult: clamp(isFinite(rainEffMult) ? rainEffMult : 1.0, 0.30, 3.00)
    };
  }catch(_){
    return { dryLossMult: 1.0, rainEffMult: 1.0 };
  }
}

export function modelClassFromRun(run){
  if (!run) return 'ok';
  const w = Number(run.wetnessR);
  if (!isFinite(w)) return 'ok';
  if (w >= 70) return 'wet';
  if (w <= 30) return 'dry';
  return 'ok';
}

export function calcDryParts(r, EXTRA){
  const temp = Number(r.tempF||0);
  const wind = Number(r.windMph||0);
  const rh   = Number(r.rh||0);
  const solar= Number(r.solarWm2||0);
  const sunshineHr = Number(r.sunshineHr||0);
  const daylightHr = Number(r.daylightHr||0);

  const tempN = clamp((temp - 20) / 45, 0, 1);
  const windN = clamp((wind - 2) / 20, 0, 1);
  const solarN= clamp((solar - 60) / 300, 0, 1);
  const rhN   = clamp((rh - 35) / 65, 0, 1);
  const sunshineN = clamp(sunshineHr / 12, 0, 1);
  const daylightN = clamp((daylightHr - 8) / 8, 0, 1);

  const rawBase =
    (0.35 * tempN) +
    (0.30 * solarN) +
    (0.25 * windN) -
    (0.25 * rhN);

  let dryPwr = clamp(rawBase, 0, 1);

  const vpd = (r.vpdKpa===null || r.vpdKpa===undefined) ? null : Number(r.vpdKpa);
  const cloud = (r.cloudPct===null || r.cloudPct===undefined) ? null : Number(r.cloudPct);

  const vpdN = (vpd===null || !isFinite(vpd)) ? 0 : clamp(vpd / 2.6, 0, 1);
  const cloudN = (cloud===null || !isFinite(cloud)) ? 0 : clamp(cloud / 100, 0, 1);

  const vpdW = Number((EXTRA && EXTRA.DRYPWR_VPD_W) ?? 0.06);
  const cloudW = Number((EXTRA && EXTRA.DRYPWR_CLOUD_W) ?? 0.04);

  dryPwr = clamp(
    dryPwr + (vpdW * vpdN) - (cloudW * cloudN),
    0,
    1
  );

  return {
    temp, wind, rh, solar, sunshineHr, daylightHr,
    tempN, windN, rhN, solarN, sunshineN, daylightN,
    vpd: (isFinite(vpd)?vpd:0),
    vpdN,
    cloud: (isFinite(cloud)?cloud:0),
    cloudN,
    raw: rawBase,
    dryPwr
  };
}

export function mapFactors(soilWetness0_100, drainageIndex0_100, sm010, EXTRA){
  const soilHoldRaw = safePct01(soilWetness0_100);
  const drainPoorRaw= safePct01(drainageIndex0_100);

  const soilHold = snap01(soilHoldRaw);
  const drainPoor= snap01(drainPoorRaw);

  const smN = (sm010===null || sm010===undefined || !isFinite(Number(sm010)))
    ? 0
    : clamp((Number(sm010) - 0.10) / 0.25, 0, 1);

  const infilMult = 0.60 + 0.30*soilHold + 0.35*drainPoor;
  const dryMult   = 1.20 - 0.35*soilHold - 0.40*drainPoor;

  const SmaxBase = 3.00 + 1.00*soilHold + 1.00*drainPoor;
  const Smax = clamp(SmaxBase, 3.00, 5.00);

  return { soilHold, drainPoor, smN, infilMult, dryMult, Smax, SmaxBase };
}

/* =====================================================================
   Calibration hooks
===================================================================== */
function getWetBiasFromDeps(deps){
  try{
    const CAL = deps && deps.CAL ? deps.CAL : null;
    if (!CAL || typeof CAL !== 'object') return 0;

    const opKey = (deps && typeof deps.opKey === 'string') ? deps.opKey : '';

    if (opKey && CAL.opWetBias && typeof CAL.opWetBias === 'object'){
      const vOp = CAL.opWetBias[opKey];
      if (isFinite(Number(vOp))) return Number(vOp);
    }

    const v = CAL.wetBias;
    if (isFinite(Number(v))) return Number(v);

    return 0;
  }catch(_){
    return 0;
  }
}

function getReadinessShiftFromDeps(deps){
  try{
    const CAL = deps && deps.CAL ? deps.CAL : null;
    if (!CAL || typeof CAL !== 'object') return 0;

    const opKey = (deps && typeof deps.opKey === 'string') ? deps.opKey : '';

    if (opKey && CAL.opReadinessShift && typeof CAL.opReadinessShift === 'object'){
      const vOp = CAL.opReadinessShift[opKey];
      if (isFinite(Number(vOp))) return Number(vOp);
    }

    const v = CAL.readinessShift;
    if (isFinite(Number(v))) return Number(v);

    return 0;
  }catch(_){
    return 0;
  }
}

function applyCalToStorage(storagePhys, Smax, deps){
  const smax = Number(Smax);
  const s0 = Number(storagePhys);

  if (!isFinite(smax) || smax <= 0 || !isFinite(s0)){
    return {
      storageEff: isFinite(s0) ? s0 : 0,
      wetBiasApplied: 0,
      readinessShiftApplied: 0,
      wetnessDeltaApplied: 0,
      storageDeltaApplied: 0
    };
  }

  const wetBias = clamp(getWetBiasFromDeps(deps), -25, 25);
  const readinessShift = clamp(getReadinessShiftFromDeps(deps), -50, 50);

  const wetnessDelta = clamp((wetBias - readinessShift), -60, 60);

  const storageDelta = (wetnessDelta / 100) * smax;
  const storageEff = clamp(s0 + storageDelta, 0, smax);

  return {
    storageEff,
    wetBiasApplied: wetBias,
    readinessShiftApplied: readinessShift,
    wetnessDeltaApplied: wetnessDelta,
    storageDeltaApplied: storageDelta
  };
}

/* =====================================================================
   Physics helpers
===================================================================== */
function effectiveRainInches(rainIn, storageBefore, Smax, factors, tune){
  const rain = Math.max(0, Number(rainIn||0));
  if (!rain || !isFinite(rain) || !isFinite(storageBefore) || !isFinite(Smax) || Smax <= 0) return 0;

  const satRaw = storageBefore / Smax;
  const sat = clamp(satRaw, 0, 1);
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

  if (sat < tune.DRY_BYPASS_CAP_SAT){
    bypassFrac = Math.min(bypassFrac, tune.DRY_BYPASS_CAP_MAX);
  }

  const rainEffective = rainAfterRunoff * (1 - bypassFrac);
  const minEff = tune.RAIN_EFF_MIN * rain;
  return Math.max(minEff, rainEffective);
}

function storageDrydownMult(storageBefore, Smax, tune){
  if (!isFinite(storageBefore) || !isFinite(Smax) || Smax <= 0) return 1;

  const sat = clamp(storageBefore / Smax, 0, 1);
  let mult = 1;

  if (sat > tune.WET_HOLD_START){
    const wetFrac = clamp((sat - tune.WET_HOLD_START) / Math.max(1e-6, (1 - tune.WET_HOLD_START)), 0, 1);
    const wetReduction = tune.WET_HOLD_MAX_REDUCTION * Math.pow(wetFrac, tune.WET_HOLD_EXP);
    mult *= (1 - wetReduction);
  }

  if (sat < tune.MID_ACCEL_START && sat > tune.DRY_TAIL_START){
    const midFrac = clamp((tune.MID_ACCEL_START - sat) / Math.max(1e-6, (tune.MID_ACCEL_START - tune.DRY_TAIL_START)), 0, 1);
    const boost = tune.MID_ACCEL_MAX_BOOST * Math.pow(midFrac, tune.MID_ACCEL_EXP);
    mult *= (1 + boost);
  }

  return clamp(mult, 0.20, 2.50);
}

function surfaceStorageAddFromRain(rainIn, tune){
  const rain = Math.max(0, Number(rainIn || 0));
  if (!Number.isFinite(rain) || rain <= 0) return 0;
  return clamp(rain * tune.SURFACE_RAIN_CAPTURE, 0, tune.SURFACE_CAP_IN);
}

function surfaceDrydownInchesPerDay(parts, et0N, tune){
  const p = safeObj(parts) || {};

  const dryPwr = clamp(Number(p.dryPwr || 0), 0, 1);
  const windN = clamp(Number(p.windN || 0), 0, 1);
  const sunshineN = clamp(Number(p.sunshineN || 0), 0, 1);
  const vpdN = clamp(Number(p.vpdN || 0), 0, 1);
  const cloudN = clamp(Number(p.cloudN || 0), 0, 1);
  const etN = clamp(Number(et0N || 0), 0, 1);

  const loss =
    tune.SURFACE_DRY_BASE +
    (tune.SURFACE_DRY_DRYPWR_W * dryPwr) +
    (tune.SURFACE_DRY_ET0_W * etN) +
    (tune.SURFACE_DRY_WIND_W * windN) +
    (tune.SURFACE_DRY_SUN_W * sunshineN) +
    (tune.SURFACE_DRY_VPD_W * vpdN) -
    (tune.SURFACE_DRY_CLOUD_W * cloudN);

  return clamp(loss, 0, tune.SURFACE_CAP_IN);
}

function surfacePenaltyFromStorage(surfaceStorage, tune){
  const cap = Math.max(1e-6, Number(tune.SURFACE_CAP_IN || 0.60));
  const frac = clamp(Number(surfaceStorage || 0) / cap, 0, 1);
  return clamp(
    Math.pow(frac, tune.SURFACE_PENALTY_EXP) * tune.SURFACE_PENALTY_MAX,
    0,
    tune.SURFACE_PENALTY_MAX
  );
}

function sameDayRainDryFactor(row, tune){
  const rain = Math.max(0, Number(row?.rainInAdj ?? row?.rainIn ?? 0));
  if (!rain) return 1;

  const morning = Math.max(0, Number(row?.rainMorningIn || 0));
  const midday = Math.max(0, Number(row?.rainMiddayIn || 0));
  const evening = Math.max(0, Number(row?.rainEveningIn || 0));
  const total = Math.max(1e-6, morning + midday + evening);

  const morningShare = clamp(morning / total, 0, 1);
  const middayShare = clamp(midday / total, 0, 1);
  const eveningShare = clamp(evening / total, 0, 1);

  const factor =
    (morningShare * tune.SAME_DAY_MORNING_RAIN_DRY_MIN) +
    (middayShare * tune.SAME_DAY_MIDDAY_RAIN_DRY_MIN) +
    (eveningShare * tune.SAME_DAY_EVENING_RAIN_DRY_MIN);

  return clamp(factor, tune.SAME_DAY_LATE_RAIN_DRY_FLOOR, 1);
}

function surfaceToStorageFrac(row, tune){
  const dryPwr = clamp(Number(row?.dryPwr || 0), 0, 1);
  const morning = clamp(Number(row?.rainMorningShare || 0), 0, 1);
  const evening = clamp(Number(row?.rainEveningShare || 0), 0, 1);

  const frac =
    tune.SURFACE_TO_STORAGE_BASE +
    (tune.SURFACE_TO_STORAGE_DRY_W * dryPwr) +
    (tune.SURFACE_TO_STORAGE_MORNING_W * morning) -
    (tune.SURFACE_TO_STORAGE_EVENING_W * evening);

  return clamp(frac, 0, tune.SURFACE_TO_STORAGE_MAX_FRAC);
}

function surfaceWetHoldDryMult(surfaceStorage, tune){
  const cap = Math.max(1e-6, Number(tune.SURFACE_CAP_IN || 0.7));
  const frac = clamp(Number(surfaceStorage || 0) / cap, 0, 1);
  const start = clamp(Number(tune.SURFACE_WET_HOLD_START_FRAC || 0.18), 0, 1);
  if (frac <= start) return 1;

  const wetFrac = clamp((frac - start) / Math.max(1e-6, 1 - start), 0, 1);
  const reduction = clamp(
    wetFrac * Number(tune.SURFACE_WET_HOLD_MAX_REDUCTION || 0),
    0,
    0.9
  );
  return clamp(1 - reduction, 0.1, 1);
}

function surfaceDrivenStorageFloor(surfaceStorage, Smax, tune){
  const floorRaw = Number(surfaceStorage || 0) * Number(tune.SURFACE_STORAGE_FLOOR_W || 0);
  const cap = Number(Smax || 0) * Number(tune.SURFACE_STORAGE_FLOOR_CAP_FRAC || 0);
  return clamp(floorRaw, 0, Math.max(0, cap));
}

/* =====================================================================
   No-state seed helpers
===================================================================== */
function getSeedMode(deps){
  const m = deps && deps.seedMode ? String(deps.seedMode) : '';
  if (m === 'rewind' || m === 'baseline') return m;
  return 'rewind';
}

function getRewindDays(deps){
  const n = Number(deps && deps.rewindDays);
  if (!isFinite(n)) return 10;
  return clamp(Math.round(n), 3, 21);
}

function baselineSeedFromWindow(rowsWindow, f){
  const first7 = rowsWindow.slice(0,7);
  const rain7 = first7.reduce((s,x)=> s + Number((x && x.rainInAdj) || 0), 0);

  const rainNudgeFrac = clamp(rain7 / 8.0, 0, 1);
  const rainNudge = rainNudgeFrac * (0.10 * f.Smax);

  const storage0 = clamp((0.10 * f.Smax) + rainNudge, 0, f.Smax);
  return { storage0 };
}

function pickSeed(rows, f, deps){
  const mode = getSeedMode(deps);

  if (mode === 'rewind'){
    const N = getRewindDays(deps);
    const startIdx = Math.max(0, rows.length - N);
    const b = baselineSeedFromWindow(rows.slice(startIdx), f);
    return { seedStorage: b.storage0, startIdx, source: 'rewind' };
  }

  const b0 = baselineSeedFromWindow(rows, f);
  return { seedStorage: b0.storage0, startIdx: 0, source: 'baseline' };
}

/* =====================================================================
   Weather-series selection
===================================================================== */
function getBestWeatherSeriesForField(deps, fieldId){
  try{
    if (!deps || !fieldId) return [];

    if (typeof deps.getModelWeatherSeriesForFieldId === 'function'){
      const rows = deps.getModelWeatherSeriesForFieldId(fieldId);
      if (Array.isArray(rows) && rows.length) return rows;
    }

    if (typeof deps.getMergedWeatherSeriesForFieldId === 'function'){
      const rows = deps.getMergedWeatherSeriesForFieldId(fieldId);
      if (Array.isArray(rows) && rows.length) return rows;
    }

    if (typeof deps.getWeatherSeriesForFieldId === 'function'){
      const rows = deps.getWeatherSeriesForFieldId(fieldId);
      if (Array.isArray(rows) && rows.length) return rows;
    }

    return [];
  }catch(_){
    return [];
  }
}

function pickRainForRow(w){
  if (!w || typeof w !== 'object'){
    return { rainInAdj: 0, rainSource: 'none' };
  }

  const mrmsIn = Number(w.rainMrmsIn);
  if (Number.isFinite(mrmsIn)){
    return { rainInAdj: Math.max(0, mrmsIn), rainSource: 'mrms' };
  }

  if (Number.isFinite(Number(w.rainInAdj))){
    const src = String(w.rainSource || w.precipSource || 'open-meteo').toLowerCase();
    return { rainInAdj: Math.max(0, Number(w.rainInAdj)), rainSource: src || 'open-meteo' };
  }

  if (Number.isFinite(Number(w.rainIn))){
    return { rainInAdj: Math.max(0, Number(w.rainIn)), rainSource: 'open-meteo' };
  }

  if (Number.isFinite(Number(w.precipIn))){
    return { rainInAdj: Math.max(0, Number(w.precipIn)), rainSource: 'open-meteo' };
  }

  return { rainInAdj: 0, rainSource: 'none' };
}

function normalizeRowForModel(w, deps, tune){
  const rainPick = pickRainForRow(w);
  const parts = calcDryParts(w, deps.EXTRA || {});

  const et0 = (w.et0In===null || w.et0In===undefined) ? null : Number(w.et0In);
  const et0N = (et0===null || !isFinite(et0)) ? 0 : clamp(et0 / 0.30, 0, 1);

  const smN2 = (w.sm010===null || w.sm010===undefined || !isFinite(Number(w.sm010)))
    ? 0
    : clamp((Number(w.sm010)-0.10)/0.25, 0, 1);

  const rainMorningIn = Number.isFinite(Number(w.rainMorningIn)) ? Number(w.rainMorningIn) : 0;
  const rainMiddayIn = Number.isFinite(Number(w.rainMiddayIn)) ? Number(w.rainMiddayIn) : 0;
  const rainEveningIn = Number.isFinite(Number(w.rainEveningIn)) ? Number(w.rainEveningIn) : 0;
  const totalTimingRain = Math.max(1e-6, rainMorningIn + rainMiddayIn + rainEveningIn);

  const row = {
    ...w,
    rainInAdj: rainPick.rainInAdj,
    rainSource: rainPick.rainSource,
    et0: (isFinite(et0)?et0:0),
    et0N,
    smN_day: smN2,

    rainMorningIn,
    rainMiddayIn,
    rainEveningIn,
    rainMorningShare: rainPick.rainInAdj > 0 ? clamp(rainMorningIn / totalTimingRain, 0, 1) : 0,
    rainMiddayShare: rainPick.rainInAdj > 0 ? clamp(rainMiddayIn / totalTimingRain, 0, 1) : 0,
    rainEveningShare: rainPick.rainInAdj > 0 ? clamp(rainEveningIn / totalTimingRain, 0, 1) : 0,

    ...parts
  };

  row.rainTimingDryFactor = sameDayRainDryFactor(row, tune);
  return row;
}

/* =====================================================================
   Readiness from physical storage
===================================================================== */
function computeReadinessFromState(storagePhys, surfaceStorage, f, deps, tune){
  const calRes = applyCalToStorage(storagePhys, f.Smax, deps);
  const storageEff = calRes.storageEff;

  const creditIn = signedCreditInchesFromSmax(f.Smax);
  const storageForReadiness = clamp(storageEff - creditIn, 0, f.Smax);

  const baseWetness = (f.Smax > 0) ? clamp((storageForReadiness / f.Smax) * 100, 0, 100) : 0;
  const baseReadiness = clamp(100 - baseWetness, 0, 100);
  const surfacePenalty = surfacePenaltyFromStorage(surfaceStorage, tune);

  const readiness = clamp(baseReadiness - surfacePenalty, 0, 100);
  const wetness = clamp(100 - readiness, 0, 100);

  return {
    readiness,
    wetness,
    baseReadiness,
    surfacePenalty,
    creditIn,
    storageEff,
    storageForReadiness,
    calRes
  };
}

/* =====================================================================
   Forecast helpers
===================================================================== */
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

  const rainPickA = pickRainForRow(a);
  const rainPickB = pickRainForRow(b);

  return {
    dateISO: String(a.dateISO || b.dateISO || '').slice(0,10),
    rainIn: lerpNum('rainIn', 0),
    rainInAdj: lerp(rainPickA.rainInAdj, rainPickB.rainInAdj, f),
    rainSource: String(rainPickA.rainSource || rainPickB.rainSource || 'mixed'),
    tempF:  lerpNum('tempF', 0),
    windMph:lerpNum('windMph', 0),
    rh:     lerpNum('rh', 0),
    solarWm2: lerpNum('solarWm2', 0),
    sunshineHr: lerpNum('sunshineHr', 0),
    daylightHr: lerpNum('daylightHr', 0),
    cloudPct: lerpNullable('cloudPct'),
    vpdKpa:   lerpNullable('vpdKpa'),
    sm010:    lerpNullable('sm010'),
    et0In:    lerpNullable('et0In'),
    rainMorningIn: lerpNum('rainMorningIn', 0),
    rainMiddayIn: lerpNum('rainMiddayIn', 0),
    rainEveningIn: lerpNum('rainEveningIn', 0)
  };
}

function normalizeDailyRowForSim(w, deps, tune){
  return normalizeRowForModel(w, deps, tune);
}

function splitHistFcstFromWx(wxSeries){
  const arr = Array.isArray(wxSeries) ? wxSeries.slice() : [];
  const tISO = todayISO();
  if (!tISO) return { hist: arr, fcst: [] };

  const hist = [];
  const fcst = [];
  for (const d of arr){
    const iso = String(d && d.dateISO ? d.dateISO : '').slice(0,10);
    if (!iso){
      hist.push(d);
      continue;
    }
    if (iso <= tISO) hist.push(d);
    else fcst.push(d);
  }
  return { hist, fcst };
}

function buildEtaForecastSteps(fcstDaily, deps, tune){
  const out = [];
  const stepsPerDay = Math.max(1, Number(tune.ETA_STEPS_PER_DAY || 2));
  const fracPerStep = 1 / stepsPerDay;

  for (let i = 0; i < fcstDaily.length; i++){
    const d0 = fcstDaily[i];
    const d1 = fcstDaily[Math.min(i + 1, fcstDaily.length - 1)] || d0;

    for (let s = 0; s < stepsPerDay; s++){
      const frac = (s + 0.5) * fracPerStep;
      const base = interpDayRow(d0, d1, frac);
      const row = normalizeDailyRowForSim(base, deps, tune);

      row.rainInAdj = Math.max(0, Number(row.rainInAdj || 0)) * fracPerStep;
      row.rainMorningIn = Math.max(0, Number(row.rainMorningIn || 0)) * fracPerStep;
      row.rainMiddayIn = Math.max(0, Number(row.rainMiddayIn || 0)) * fracPerStep;
      row.rainEveningIn = Math.max(0, Number(row.rainEveningIn || 0)) * fracPerStep;
      row.rainTimingDryFactor = sameDayRainDryFactor(row, tune);

      out.push(row);
    }
  }

  return out;
}

/* =====================================================================
   Shared step simulation
===================================================================== */
function simulateOneStep(state, row, stepFrac, f, deps, tune, rate){
  let storagePhys = clamp(Number(state.storagePhys || 0), 0, f.Smax);
  let surfaceStorage = clamp(Number(state.surfaceStorage || 0), 0, tune.SURFACE_CAP_IN);

  const rain = Math.max(0, Number(row.rainInAdj || 0));
  const before = storagePhys;
  const surfaceBefore = surfaceStorage;

  let rainEff = effectiveRainInches(rain, before, f.Smax, f, tune);
  rainEff = clamp(rainEff * rate.rainEffMult, 0, 1000);

  const addRain = rainEff * f.infilMult;
  const addSm = ((Number((deps.EXTRA && deps.EXTRA.ADD_SM010_W) || 0.10) * Number(row.smN_day || 0)) * 0.05) * stepFrac;
  const add = addRain + addSm;

  const lossEt0W = Number((deps.EXTRA && deps.EXTRA.LOSS_ET0_W) || 0.08);
  let lossBase =
    Number(row.dryPwr || 0) *
    Number(deps.LOSS_SCALE || 0.55) *
    f.dryMult *
    (1 + (lossEt0W * Number(row.et0N || 0)));

  const rainTimingDryFactorVal = clamp(
    Number(row.rainTimingDryFactor ?? sameDayRainDryFactor(row, tune)),
    tune.SAME_DAY_LATE_RAIN_DRY_FLOOR,
    1
  );
  lossBase *= rainTimingDryFactorVal;

  const stateDryMult = storageDrydownMult(before, f.Smax, tune);
  const surfaceWetDryMult = surfaceWetHoldDryMult(surfaceBefore, tune);

  let loss = lossBase * stateDryMult * surfaceWetDryMult * stepFrac;
  loss = Math.max(0, loss * rate.dryLossMult);

  if (f.Smax > 0 && isFinite(before)){
    const sat = clamp(before / f.Smax, 0, 1);
    if (sat < tune.DRY_TAIL_START){
      const frac = clamp(sat / Math.max(1e-6, tune.DRY_TAIL_START), 0, 1);
      const mult = tune.DRY_TAIL_MIN_MULT + (1 - tune.DRY_TAIL_MIN_MULT) * frac;
      loss = loss * mult;
    }
  }

  let after = clamp(before + add - loss, 0, f.Smax);

  const surfaceAdd = surfaceStorageAddFromRain(rain, tune);
  const surfaceDryBase = surfaceDrydownInchesPerDay(row, row.et0N, tune);
  const surfaceDry = surfaceDryBase * rainTimingDryFactorVal * stepFrac;

  surfaceStorage = clamp(surfaceBefore + surfaceAdd - surfaceDry, 0, tune.SURFACE_CAP_IN);

  const handoffFrac = surfaceToStorageFrac(row, tune);
  const storageRoom = Math.max(0, f.Smax - after);
  const surfaceToStorage = Math.min(surfaceStorage * handoffFrac * stepFrac, storageRoom);

  after = clamp(after + surfaceToStorage, 0, f.Smax);
  surfaceStorage = clamp(surfaceStorage - surfaceToStorage, 0, tune.SURFACE_CAP_IN);

  const storageFloor = surfaceDrivenStorageFloor(surfaceStorage, f.Smax, tune);
  after = Math.max(after, storageFloor);

  storagePhys = clamp(after, 0, f.Smax);

  const stateNow = computeReadinessFromState(storagePhys, surfaceStorage, f, deps, tune);

  return {
    storagePhys,
    surfaceStorage,
    readiness: clamp(Number(stateNow.readiness || 0), 0, 100),
    wetness: clamp(Number(stateNow.wetness || 0), 0, 100),
    baseReadiness: clamp(Number(stateNow.baseReadiness || 0), 0, 100),
    surfacePenalty: clamp(Number(stateNow.surfacePenalty || 0), 0, 100)
  };
}

/* =====================================================================
   ETA helpers
===================================================================== */
function etaMinHoursFloor(readinessNow, rainRecentIn, tune){
  let floor = 0;

  const r = Number(readinessNow || 0);
  const rain = Math.max(0, Number(rainRecentIn || 0));

  if (r < 90) floor = Math.max(floor, tune.ETA_MIN_HOURS_ANY_WET);
  if (r <= 89) floor = Math.max(floor, tune.ETA_MIN_HOURS_80S);
  if (r <= 79) floor = Math.max(floor, tune.ETA_MIN_HOURS_70S);
  if (r <= 69) floor = Math.max(floor, tune.ETA_MIN_HOURS_60S);

  if (rain >= 0.20) floor = Math.max(floor, tune.ETA_WET_RAIN_LOCK_HOURS);
  if (rain >= 0.50) floor = Math.max(floor, tune.ETA_HEAVY_RAIN_LOCK_HOURS);

  return floor;
}

/* =====================================================================
   Model-owned ETA
===================================================================== */
export async function etaToThreshold(field, deps, threshold, horizonHours=168, _stepHours=12){
  try{
    if (!field || !deps) return { ok:false, status:'noData', hours:null, text:'ETA ?' };

    const thr = clamp(Number(threshold || 0), 0, 100);
    const H = clamp(Number(horizonHours || 168), 1, 360);

    const run = runField(field, deps);
    if (!run) return { ok:false, status:'noData', hours:null, text:'ETA ?' };

    let fcstDaily = [];
    if (deps && typeof deps.getForecastSeriesForFieldId === 'function'){
      const got = await deps.getForecastSeriesForFieldId(String(field.id));
      fcstDaily = Array.isArray(got) ? got.slice() : [];
    }

    if (!fcstDaily.length && deps && typeof deps.getWxSeriesWithForecastForFieldId === 'function'){
      const all = await deps.getWxSeriesWithForecastForFieldId(String(field.id));
      const sp = splitHistFcstFromWx(all);
      fcstDaily = sp.fcst || [];
    }

    if (!fcstDaily.length){
      return { ok:true, status:'noForecast', hours:null, text:'ETA ?' };
    }

    const tune = getTune(deps);
    const fcst = fcstDaily
      .filter(d => d && d.dateISO)
      .slice(0, 16)
      .map(d => normalizeDailyRowForSim(d, deps, tune));

    if (!fcst.length){
      return { ok:true, status:'noForecast', hours:null, text:'ETA ?' };
    }

    const stepRows = buildEtaForecastSteps(fcst, deps, tune);
    if (!stepRows.length){
      return { ok:true, status:'noForecast', hours:null, text:'ETA ?' };
    }

    const f = run.factors;
    const rate = getRateMults(deps);
    const stepHours = 24 / Math.max(1, Number(tune.ETA_STEPS_PER_DAY || 2));
    const stepFrac = stepHours / 24;
    const maxSteps = Math.min(stepRows.length, Math.ceil(H / stepHours));

    let state = {
      storagePhys: Number.isFinite(Number(run.storagePhysFinal))
        ? Number(run.storagePhysFinal)
        : Number(run.storageFinal || 0),
      surfaceStorage: Number.isFinite(Number(run.surfaceStorageFinal))
        ? Number(run.surfaceStorageFinal)
        : 0
    };

    state.storagePhys = clamp(state.storagePhys, 0, f.Smax);
    state.surfaceStorage = clamp(state.surfaceStorage, 0, tune.SURFACE_CAP_IN);

    const nowState = computeReadinessFromState(state.storagePhys, state.surfaceStorage, f, deps, tune);
    const readinessNow = clamp(Number(nowState.readiness || 0), 0, 100);

    if (readinessNow >= thr){
      return { ok:true, status:'dryNow', hours:0, text:'Now' };
    }

    const recentTrace = Array.isArray(run.trace) ? run.trace.slice(-2) : [];
    const recentRainIn = recentTrace.reduce((s, x) => s + Math.max(0, Number(x && x.rain || 0)), 0);
    const minFloorHours = etaMinHoursFloor(readinessNow, recentRainIn, tune);

    let prevReadiness = readinessNow;
    let prevHours = 0;
    let consecutiveHit = 0;
    let dailyGainTracker = 0;
    let stepsIntoDay = 0;

    for (let i = 0; i < maxSteps; i++){
      const row = stepRows[i];
      const next = simulateOneStep(state, row, stepFrac, f, deps, tune, rate);

      let rNow = clamp(Number(next.readiness || 0), 0, 100);

      const maxGainThisStep = tune.ETA_MAX_GAIN_PER_HOUR * stepHours;
      rNow = Math.min(rNow, prevReadiness + maxGainThisStep);

      dailyGainTracker += Math.max(0, rNow - prevReadiness);
      stepsIntoDay += 1;

      if (stepsIntoDay >= tune.ETA_STEPS_PER_DAY){
        if (dailyGainTracker > tune.ETA_MAX_DAILY_GAIN){
          const over = dailyGainTracker - tune.ETA_MAX_DAILY_GAIN;
          rNow = Math.max(prevReadiness, rNow - over);
        }
        dailyGainTracker = 0;
        stepsIntoDay = 0;
      }

      const tHours = Math.min(H, (i + 1) * stepHours);

      if (rNow >= thr){
        consecutiveHit += 1;
      }else{
        consecutiveHit = 0;
      }

      if (prevReadiness < thr && rNow >= thr && consecutiveHit >= tune.ETA_REQUIRE_CONSECUTIVE_STEPS){
        const denom = rNow - prevReadiness;
        const fracCross = denom <= 1e-6 ? 1 : clamp((thr - prevReadiness) / denom, 0, 1);
        const rawEta = prevHours + fracCross * (tHours - prevHours);
        const eta = Math.max(minFloorHours, Math.round(rawEta));

        if (eta <= H) return { ok:true, status:'within', hours:eta, text:`~${eta}h` };
        return { ok:true, status:'beyond', hours:null, text:`>${Math.round(H)}h` };
      }

      state.storagePhys = next.storagePhys;
      state.surfaceStorage = next.surfaceStorage;
      prevReadiness = rNow;
      prevHours = tHours;
    }

    return { ok:true, status:'beyond', hours:null, text:`>${Math.round(H)}h` };
  }catch(_){
    return { ok:false, status:'error', hours:null, text:'ETA ?' };
  }
}

/* =====================================================================
   runField
===================================================================== */
export function runField(field, deps){
  const wx = getBestWeatherSeriesForField(deps, field.id);
  if (!wx || !wx.length) return null;

  const p = deps.getFieldParams(field.id);

  const tune = getTune(deps);
  const last = wx[wx.length-1] || {};
  const f = mapFactors(p.soilWetness, p.drainageIndex, last.sm010, deps.EXTRA);
  const rate = getRateMults(deps);

  const rows = wx.map(w => normalizeRowForModel(w, deps, tune));

  const seedPick = pickSeed(rows, f, deps);
  let storage = clamp(seedPick.seedStorage, 0, f.Smax);
  let surfaceStorage = 0;

  const trace = [];

  for (let i = seedPick.startIdx; i < rows.length; i++){
    const d = rows[i];

    const next = simulateOneStep(
      { storagePhys: storage, surfaceStorage },
      d,
      1,
      f,
      deps,
      tune,
      rate
    );

    const rain = Number(d.rainInAdj || 0);
    const before = storage;
    const surfaceBefore = surfaceStorage;

    let rainEff = effectiveRainInches(rain, before, f.Smax, f, tune);
    rainEff = clamp(rainEff * rate.rainEffMult, 0, 1000);

    const addSm = (Number((deps.EXTRA && deps.EXTRA.ADD_SM010_W) || 0.10) * d.smN_day) * 0.05;
    const addRain = rainEff * f.infilMult;
    const add = addRain + addSm;

    const lossEt0W = Number((deps.EXTRA && deps.EXTRA.LOSS_ET0_W) || 0.08);
    let lossBase =
      Number(d.dryPwr||0) *
      Number(deps.LOSS_SCALE || 0.55) *
      f.dryMult *
      (1 + (lossEt0W * d.et0N));

    const rainTimingDryFactorVal = clamp(
      Number(d.rainTimingDryFactor ?? sameDayRainDryFactor(d, tune)),
      tune.SAME_DAY_LATE_RAIN_DRY_FLOOR,
      1
    );
    lossBase *= rainTimingDryFactorVal;

    const stateDryMult = storageDrydownMult(before, f.Smax, tune);
    const surfaceWetDryMult = surfaceWetHoldDryMult(surfaceBefore, tune);

    let loss = lossBase * stateDryMult * surfaceWetDryMult;
    loss = Math.max(0, loss * rate.dryLossMult);

    if (f.Smax > 0 && isFinite(before)){
      const sat = clamp(before / f.Smax, 0, 1);
      if (sat < tune.DRY_TAIL_START){
        const frac = clamp(sat / Math.max(1e-6, tune.DRY_TAIL_START), 0, 1);
        const mult = tune.DRY_TAIL_MIN_MULT + (1 - tune.DRY_TAIL_MIN_MULT) * frac;
        loss = loss * mult;
      }
    }

    const surfaceAdd = surfaceStorageAddFromRain(rain, tune);
    const surfaceDryBase = surfaceDrydownInchesPerDay(d, d.et0N, tune);
    const surfaceDry = surfaceDryBase * rainTimingDryFactorVal;

    const surfaceAfterTemp = clamp(surfaceBefore + surfaceAdd - surfaceDry, 0, tune.SURFACE_CAP_IN);
    const handoffFrac = surfaceToStorageFrac(d, tune);
    const storageRoom = Math.max(0, f.Smax - next.storagePhys);
    const surfaceToStorage = Math.min(surfaceAfterTemp * handoffFrac, storageRoom);

    storage = clamp(next.storagePhys, 0, f.Smax);
    surfaceStorage = clamp(next.surfaceStorage, 0, tune.SURFACE_CAP_IN);

    const infilMultEff = (rain > 0)
      ? clamp((addRain / Math.max(1e-6, rain)), 0, 5)
      : 0;

    trace.push({
      dateISO: d.dateISO,
      before,
      after: storage,
      rain,
      rainSource: String(d.rainSource || 'unknown'),

      rainMorningIn: Number(d.rainMorningIn || 0),
      rainMiddayIn: Number(d.rainMiddayIn || 0),
      rainEveningIn: Number(d.rainEveningIn || 0),
      rainTimingDryFactor: roundTo(rainTimingDryFactorVal, 3),

      rainEff,
      infilMult: infilMultEff,

      addRain,
      addSm,
      add,

      lossBase,
      stateDryMult,
      surfaceWetDryMult,
      loss,
      dryPwr: d.dryPwr,

      surfaceBefore,
      surfaceAdd,
      surfaceDry,
      surfaceToStorage,
      surfaceAfter: surfaceStorage,
      surfacePenalty: surfacePenaltyFromStorage(surfaceStorage, tune),

      storageFloor: surfaceDrivenStorageFloor(surfaceStorage, f.Smax, tune)
    });
  }

  const storagePhysFinal = storage;
  const stateFinal = computeReadinessFromState(storagePhysFinal, surfaceStorage, f, deps, tune);

  const wetnessR = roundInt(stateFinal.wetness);
  const readinessR = roundInt(stateFinal.readiness);
  const baseReadinessR = roundInt(stateFinal.baseReadiness);
  const surfacePenaltyR = roundInt(stateFinal.surfacePenalty);

  const last7 = trace.slice(-7);
  const avgLossDay = last7.length ? (last7.reduce((s,x)=> s + x.loss, 0) / last7.length) : 0.08;

  return {
    field,
    factors: f,
    rows,
    trace,

    storagePhysFinal,
    storageFinal: stateFinal.storageEff,
    surfaceStorageFinal: surfaceStorage,

    wetnessR,
    readinessR,
    baseReadinessR,
    surfacePenaltyFinal: stateFinal.surfacePenalty,
    surfacePenaltyR,
    avgLossDay,

    readinessCreditIn: stateFinal.creditIn,
    storageForReadiness: stateFinal.storageForReadiness,
    seedSource: seedPick.source,
    rewindDays: getRewindDays(deps)
  };
}

export function readinessColor(score){
  const p = clamp(score, 0, 100);
  if (p <= 55){
    const t = p / 55;
    const r = Math.round(200 + (216-200)*t);
    const g = Math.round(59  + (178-59)*t);
    const b = 59;
    return `rgb(${r},${g},${b})`;
  } else {
    const t = (p - 55) / 45;
    const r = Math.round(216 + (47-216)*t);
    const g = Math.round(178 + (143-178)*t);
    const b = Math.round(59  + (75-59)*t);
    return `rgb(${r},${g},${b})`;
  }
}

export function markerLeftCSS(pct){
  const p = clamp(pct, 0, 100);
  if (p >= 100) return 'calc(100% - 2px)';
  if (p <= 0) return '2px';
  return p.toFixed(2) + '%';
}

/**
 * Legacy ETA function (COMPAT STUB ONLY)
 */
export function etaFor(_run, _threshold, _ETA_MAX_HOURS){
  return 'ETA n/a';
}