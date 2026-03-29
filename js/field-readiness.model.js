/* =====================================================================
/Farm-vista/js/field-readiness.model.js  (FULL FILE)
Rev: 2026-03-29b-surface-penalty-recovers-faster

OPTION 1 (per Dane):
✅ Model owns ETA and computes it from the SAME truth-seeded run + SAME physics.
✅ Forward sim uses forecast daily rows when available (dailySeriesFcst).
✅ No legacy ETA math (avgLossDay shortcut) anywhere.
✅ Legacy etaFor() is kept ONLY as a compatibility stub returning '' (blank),
   so older callers won't crash while we wire quickview/details to model ETA.

THIS REV:
✅ Keeps MRMS rainfall preference with Open-Meteo fallback
✅ Keeps truth seed / ETA-start priority behavior intact
✅ Rebuilds model to match server-side coupled physics
✅ NEW: surface storage and deep storage now work together
✅ NEW: same-day rain timing affects how much drying counts
✅ NEW: late-day rain suppresses same-day drydown much more
✅ NEW: surface storage can percolate into deep storage over time
✅ NEW: wet surface slows deep-tank drydown
✅ NEW: soft storage floor while surface remains wet
✅ NEW: ETA forward sim uses the same coupled storage/surface logic
✅ TUNE: physical penalty still hits after rain but recovers faster afterward

IMPORTANT:
- Truth seed (storageFinal + asOfDateISO) still anchors "now"
- Learning (EXTRA.DRY_LOSS_MULT / EXTRA.RAIN_EFF_MULT) still applies
- This file still supports merged weather input through deps:
    1) getModelWeatherSeriesForFieldId(fieldId)
    2) getMergedWeatherSeriesForFieldId(fieldId)
    3) fallback getWeatherSeriesForFieldId(fieldId)
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
function safeStr(x){
  const s = String(x || '');
  return s ? s : '';
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

  // Surface storage system (same pattern as server file)
  SURFACE_CAP_IN: 0.70,
  SURFACE_RAIN_CAPTURE: 1.00,
  SURFACE_PENALTY_MAX: 36,
  SURFACE_PENALTY_EXP: 1.35,

  SURFACE_DRY_BASE: 0.02,
  SURFACE_DRY_DRYPWR_W: 0.16,
  SURFACE_DRY_ET0_W: 0.10,
  SURFACE_DRY_WIND_W: 0.05,
  SURFACE_DRY_SUN_W: 0.05,
  SURFACE_DRY_VPD_W: 0.04,
  SURFACE_DRY_CLOUD_W: 0.10,

  // Same-day rain timing
  SAME_DAY_LATE_RAIN_DRY_FLOOR: 0.18,
  SAME_DAY_MORNING_RAIN_DRY_MIN: 0.70,
  SAME_DAY_MIDDAY_RAIN_DRY_MIN: 0.45,
  SAME_DAY_EVENING_RAIN_DRY_MIN: 0.12,

  // Surface -> storage handoff
  SURFACE_TO_STORAGE_BASE: 0.12,
  SURFACE_TO_STORAGE_DRY_W: 0.08,
  SURFACE_TO_STORAGE_MORNING_W: 0.10,
  SURFACE_TO_STORAGE_EVENING_W: 0.08,
  SURFACE_TO_STORAGE_MAX_FRAC: 0.35,

  // Wet surface suppresses deep drying
  SURFACE_WET_HOLD_START_FRAC: 0.18,
  SURFACE_WET_HOLD_MAX_REDUCTION: 0.55,

  // Storage floor while surface still wet
  SURFACE_STORAGE_FLOOR_W: 0.45,
  SURFACE_STORAGE_FLOOR_CAP_FRAC: 0.22,

  // ETA pacing / guardrails
  ETA_MAX_GAIN_PER_HOUR: 0.40
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

  t.ETA_MAX_GAIN_PER_HOUR = clamp(t.ETA_MAX_GAIN_PER_HOUR, 0.05, 5);

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

  // Match server-style dry power
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
   Persisted / centralized seed helpers
===================================================================== */
function getPersistedState(deps, fieldId){
  try{
    if (!deps || !fieldId) return null;
    if (typeof deps.getPersistedState === 'function'){
      const s = deps.getPersistedState(fieldId);
      return (s && typeof s === 'object') ? s : null;
    }
    const map = deps.persistedStateByFieldId;
    if (map && typeof map === 'object'){
      const s = map[fieldId];
      return (s && typeof s === 'object') ? s : null;
    }
    return null;
  }catch(_){
    return null;
  }
}

function getEtaSeed(deps, fieldId){
  try{
    if (!deps || !fieldId) return null;

    if (typeof deps.getEtaSeedForFieldId === 'function'){
      const s = deps.getEtaSeedForFieldId(fieldId);
      if (s && typeof s === 'object') return s;
    }

    const map = deps.etaSeedByFieldId;
    if (map && typeof map === 'object'){
      const s = map[fieldId];
      if (s && typeof s === 'object') return s;
    }

    return null;
  }catch(_){
    return null;
  }
}

function getSeedMode(deps){
  const m = deps && deps.seedMode ? String(deps.seedMode) : '';
  if (m === 'rewind' || m === 'baseline' || m === 'persisted') return m;
  return 'persisted';
}
function getRewindDays(deps){
  const n = Number(deps && deps.rewindDays);
  if (!isFinite(n)) return 14;
  return clamp(Math.round(n), 3, 45);
}

function baselineSeedFromWindow(rowsWindow, f){
  const first7 = rowsWindow.slice(0,7);
  const rain7 = first7.reduce((s,x)=> s + Number(x && x.rainInAdj || 0), 0);

  const rainNudgeFrac = clamp(rain7 / 8.0, 0, 1);
  const rainNudge = rainNudgeFrac * (0.1 * f.Smax);

  const storage0 = clamp((0.30 * f.Smax) + rainNudge, 0, f.Smax);
  return { storage0 };
}

function pickSeed(rows, f, deps, fieldId){
  const mode = getSeedMode(deps);

  if (mode === 'rewind'){
    const N = getRewindDays(deps);
    const startIdx = Math.max(0, rows.length - N);
    const b = baselineSeedFromWindow(rows.slice(startIdx), f);
    return { seedStorage: b.storage0, startIdx, source: 'rewind' };
  }

  if (mode === 'persisted'){
    const persisted = getPersistedState(deps, fieldId);
    if (persisted && isFinite(Number(persisted.storageFinal)) && persisted.asOfDateISO){
      const asOf = String(persisted.asOfDateISO).slice(0,10);
      const idx = rows.findIndex(r => String(r.dateISO||'').slice(0,10) === asOf);
      if (idx >= 0){
        return {
          seedStorage: clamp(Number(persisted.storageFinal), 0, f.Smax),
          startIdx: idx + 1,
          source: 'persisted'
        };
      }
    }
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

function deriveStoragePhysFromAuthoritativeReadiness(readinessValue, f, deps){
  const readiness = safeNum(readinessValue, null);
  if (!Number.isFinite(readiness)) return null;

  const wetness = clamp(100 - readiness, 0, 100);
  const storageForReadiness = (wetness / 100) * f.Smax;

  const creditIn = signedCreditInchesFromSmax(f.Smax);
  const storageEff = clamp(storageForReadiness + creditIn, 0, f.Smax);

  const calAtZero = applyCalToStorage(0, f.Smax, deps);
  const storageDeltaApplied = safeNum(calAtZero && calAtZero.storageDeltaApplied, 0);

  return clamp(storageEff - storageDeltaApplied, 0, f.Smax);
}

function buildEtaNowStateFromSeed(run, f, deps, fieldId){
  try{
    const seed = getEtaSeed(deps, fieldId);
    if (!seed) return null;

    const authoritativeReadiness = safeNum(seed.readiness, null);

    let storagePhys = safeNum(seed.storagePhysFinal, null);
    if (Number.isFinite(storagePhys)){
      storagePhys = clamp(storagePhys, 0, f.Smax);
    }

    if (!Number.isFinite(storagePhys)){
      const storageEffMaybe = safeNum(seed.storageFinal, null);
      if (Number.isFinite(storageEffMaybe)){
        const calAtZero = applyCalToStorage(0, f.Smax, deps);
        const storageDeltaApplied = safeNum(calAtZero && calAtZero.storageDeltaApplied, 0);
        storagePhys = clamp(storageEffMaybe - storageDeltaApplied, 0, f.Smax);
      }
    }

    if (!Number.isFinite(storagePhys)){
      storagePhys = deriveStoragePhysFromAuthoritativeReadiness(authoritativeReadiness, f, deps);
    }

    if (!Number.isFinite(storagePhys)){
      storagePhys = Number.isFinite(Number(run && run.storagePhysFinal))
        ? clamp(Number(run.storagePhysFinal), 0, f.Smax)
        : null;
    }

    const surfaceStorage = Number.isFinite(Number(seed.surfaceStorageFinal))
      ? clamp(Number(seed.surfaceStorageFinal), 0, getTune(deps).SURFACE_CAP_IN)
      : (
          Number.isFinite(Number(run && run.surfaceStorageFinal))
            ? clamp(Number(run.surfaceStorageFinal), 0, getTune(deps).SURFACE_CAP_IN)
            : 0
        );

    const derived = Number.isFinite(storagePhys)
      ? computeReadinessFromState(storagePhys, surfaceStorage, f, deps, getTune(deps))
      : null;

    return {
      storagePhys: Number.isFinite(storagePhys) ? storagePhys : null,
      surfaceStorage,
      readiness: Number.isFinite(authoritativeReadiness)
        ? authoritativeReadiness
        : Number(derived && derived.readiness),
      wetness: Number.isFinite(Number(seed.wetness))
        ? Number(seed.wetness)
        : Number(derived && derived.wetness),
      derivedReadiness: Number(derived && derived.readiness),
      source: safeStr(seed.source || 'field_readiness_latest'),
      seed
    };
  }catch(_){
    return null;
  }
}

/* =====================================================================
   Forecast / split helpers
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

/* =====================================================================
   Model-owned ETA
===================================================================== */
export async function etaToThreshold(field, deps, threshold, horizonHours=168, stepHours=3){
  try{
    if (!field || !deps) return { ok:false, status:'noData', hours:null, text:'' };

    const thr = clamp(Number(threshold||0), 0, 100);
    const H = clamp(Number(horizonHours||168), 1, 360);
    const stepH = clamp(Number(stepHours||3), 1, 12);

    const run = runField(field, deps);
    if (!run) return { ok:false, status:'noData', hours:null, text:'' };

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
      return { ok:true, status:'noForecast', hours:null, text:'' };
    }

    const tune = getTune(deps);
    const fcst = fcstDaily
      .filter(d => d && d.dateISO)
      .slice(0, 16)
      .map(d=> normalizeDailyRowForSim(d, deps, tune));

    if (!fcst.length){
      return { ok:true, status:'noForecast', hours:null, text:'' };
    }

    const f = run.factors;
    const rate = getRateMults(deps);

    const etaSeedNow = buildEtaNowStateFromSeed(run, f, deps, field.id);

    let storagePhys = Number.isFinite(Number(etaSeedNow && etaSeedNow.storagePhys))
      ? Number(etaSeedNow.storagePhys)
      : (
          Number.isFinite(Number(run.storagePhysFinal))
            ? Number(run.storagePhysFinal)
            : Number(run.storageFinal || 0)
        );

    storagePhys = clamp(storagePhys, 0, f.Smax);

    let surfaceStorage = Number.isFinite(Number(etaSeedNow && etaSeedNow.surfaceStorage))
      ? Number(etaSeedNow.surfaceStorage)
      : (
          Number.isFinite(Number(run.surfaceStorageFinal))
            ? Number(run.surfaceStorageFinal)
            : 0
        );

    surfaceStorage = clamp(surfaceStorage, 0, tune.SURFACE_CAP_IN);

    const authoritativeNowR = Number.isFinite(Number(etaSeedNow && etaSeedNow.readiness))
      ? Number(etaSeedNow.readiness)
      : null;

    const derivedNowR = computeReadinessFromState(storagePhys, surfaceStorage, f, deps, tune).readiness;
    const hasAuthoritativeNow = Number.isFinite(authoritativeNowR);

    const dryNowGateR = hasAuthoritativeNow ? authoritativeNowR : derivedNowR;

    if (dryNowGateR >= thr && !(hasAuthoritativeNow && authoritativeNowR < thr)){
      return { ok:true, status:'dryNow', hours:0, text:'' };
    }

    let prevR = hasAuthoritativeNow ? authoritativeNowR : derivedNowR;
    let prevT = 0;

    if (hasAuthoritativeNow && authoritativeNowR < thr){
      prevR = Math.min(prevR, thr - 1);
    } else if (prevR >= thr){
      prevR = Math.max(0, thr - 1);
    }

    const steps = Math.ceil(H / stepH);

    for (let s=1; s<=steps; s++){
      const tHours = Math.min(H, s * stepH);
      const dayFloat = tHours / 24;
      const i = Math.floor(dayFloat);
      const frac = dayFloat - i;

      const d0 = fcst[Math.min(i, fcst.length - 1)];
      const d1 = fcst[Math.min(i + 1, fcst.length - 1)];
      const row = normalizeDailyRowForSim(interpDayRow(d0, d1, frac), deps, tune);

      const stepFrac = stepH / 24;
      const stepRain = Math.max(0, Number(row.rainInAdj || 0)) * stepFrac;

      const before = storagePhys;
      const surfaceBefore = surfaceStorage;

      let rainEff = effectiveRainInches(stepRain, before, f.Smax, f, tune);
      rainEff = clamp(rainEff * rate.rainEffMult, 0, 1000);

      const addRain = rainEff * f.infilMult;
      const addSm = ((Number(deps.EXTRA && deps.EXTRA.ADD_SM010_W || 0.10) * row.smN_day) * 0.05) * stepFrac;
      const add = addRain + addSm;

      const lossEt0W = Number(deps.EXTRA && deps.EXTRA.LOSS_ET0_W || 0.08);
      let lossBase =
        Number(row.dryPwr||0) *
        Number(deps.LOSS_SCALE || 0.55) *
        f.dryMult *
        (1 + (lossEt0W * row.et0N));

      const rainTimingDryFactorVal = clamp(
        Number(row.rainTimingDryFactor ?? sameDayRainDryFactor(row, tune)),
        tune.SAME_DAY_LATE_RAIN_DRY_FLOOR,
        1
      );
      lossBase *= rainTimingDryFactorVal;

      const stateDryMult = storageDrydownMult(before, f.Smax, tune);
      const surfaceWetDryMult = surfaceWetHoldDryMult(surfaceBefore, tune);

      let lossDay = lossBase * stateDryMult * surfaceWetDryMult;
      let loss = Math.max(0, lossDay * stepFrac);
      loss = Math.max(0, loss * rate.dryLossMult);

      if (f.Smax > 0 && isFinite(before)){
        const sat = clamp(before / f.Smax, 0, 1);
        if (sat < tune.DRY_TAIL_START){
          const frac2 = clamp(sat / Math.max(1e-6, tune.DRY_TAIL_START), 0, 1);
          const mult = tune.DRY_TAIL_MIN_MULT + (1 - tune.DRY_TAIL_MIN_MULT) * frac2;
          loss = loss * mult;
        }
      }

      let after = clamp(before + add - loss, 0, f.Smax);

      const surfaceAdd = surfaceStorageAddFromRain(stepRain, tune);
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
      let rNow = clamp(stateNow.readiness, 0, 100);

      const maxGain = tune.ETA_MAX_GAIN_PER_HOUR * stepH;
      rNow = Math.min(rNow, prevR + maxGain);

      if (prevR < thr && rNow >= thr){
        const denom = rNow - prevR;
        const fracCross = denom <= 1e-6 ? 1 : clamp((thr - prevR) / denom, 0, 1);
        let eta = prevT + fracCross * (tHours - prevT);

        if (eta <= 0 && Number(dryNowGateR) < thr){
          eta = 1;
        }

        const hrs = Math.max(0, Math.round(eta));
        const outHrs = (Number(dryNowGateR) < thr) ? Math.max(1, hrs) : hrs;

        if (outHrs <= H) return { ok:true, status:'within', hours:outHrs, text:`~${outHrs}h` };
        return { ok:true, status:'beyond', hours:null, text:`>${Math.round(H)}h` };
      }

      prevR = rNow;
      prevT = tHours;
    }

    return { ok:true, status:'beyond', hours:null, text:`>${Math.round(H)}h` };
  }catch(_){
    return { ok:false, status:'error', hours:null, text:'' };
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

  const seedPick = pickSeed(rows, f, deps, field.id);
  let storage = clamp(seedPick.seedStorage, 0, f.Smax);
  let surfaceStorage = 0;

  const trace = [];

  for (let i = seedPick.startIdx; i < rows.length; i++){
    const d = rows[i];
    const rain = Number(d.rainInAdj||0);

    const before = storage;
    const surfaceBefore = surfaceStorage;

    let rainEff = effectiveRainInches(rain, before, f.Smax, f, tune);
    rainEff = clamp(rainEff * rate.rainEffMult, 0, 1000);

    const addSm = (Number(deps.EXTRA && deps.EXTRA.ADD_SM010_W || 0.10) * d.smN_day) * 0.05;
    const addRain = rainEff * f.infilMult;
    const add = addRain + addSm;

    const lossEt0W = Number(deps.EXTRA && deps.EXTRA.LOSS_ET0_W || 0.08);
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

    let after = clamp(before + add - loss, 0, f.Smax);

    const surfaceAdd = surfaceStorageAddFromRain(rain, tune);
    const surfaceDryBase = surfaceDrydownInchesPerDay(d, d.et0N, tune);
    const surfaceDry = surfaceDryBase * rainTimingDryFactorVal;

    surfaceStorage = clamp(surfaceBefore + surfaceAdd - surfaceDry, 0, tune.SURFACE_CAP_IN);

    const handoffFrac = surfaceToStorageFrac(d, tune);
    const storageRoom = Math.max(0, f.Smax - after);
    const surfaceToStorage = Math.min(surfaceStorage * handoffFrac, storageRoom);

    after = clamp(after + surfaceToStorage, 0, f.Smax);
    surfaceStorage = clamp(surfaceStorage - surfaceToStorage, 0, tune.SURFACE_CAP_IN);

    const storageFloor = surfaceDrivenStorageFloor(surfaceStorage, f.Smax, tune);
    after = Math.max(after, storageFloor);

    storage = clamp(after, 0, f.Smax);

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

      storageFloor
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
    seedSource: seedPick.source
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
  return '';
}
