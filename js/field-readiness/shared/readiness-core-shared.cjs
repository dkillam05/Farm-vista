/* =====================================================================
/js/field-readiness/shared/readiness-core-shared.cjs  (FULL FILE)
Rev: 2026-03-29a-align-shared-core-to-coupled-surface-storage-model

PURPOSE
✅ Shared PURE readiness math core for backend import
✅ CommonJS module for Cloud Run / Node
✅ Keeps backend scheduler aligned to current frontend/server model behavior
✅ Rain precedence matches live field-readiness.model.js + server index.js
✅ Preserves helper to compute readiness from persisted storage only
✅ Preserves storage cap fields for backend/UI display:
   - storageMax
   - storageCapacity
   - storageMaxFinal
✅ Preserves includeTrace support for backend/UI display traces
✅ Preserves forceFullHistoryFromPersisted option
✅ NEW: surface storage + deep storage coupled together
✅ NEW: same-day rain timing affects drydown
✅ NEW: late-day rain suppresses same-day drying much more
✅ NEW: surface storage can percolate into deep storage
✅ NEW: wet surface slows deep-tank drydown
✅ NEW: soft deep-storage floor while surface remains wet
✅ NEW: readiness now includes baseReadiness + surfacePenalty outputs
===================================================================== */

'use strict';

/* =====================================================================
   Small helpers
===================================================================== */
function clamp(v, lo, hi){
  return Math.max(lo, Math.min(hi, v));
}

function num(v, d=0){
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function roundInt(x){
  const n = Number(x);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function roundTo(x, d=2){
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

function safeStr(v){
  return String(v || '');
}

/* =====================================================================
   Defaults aligned to live model / server
===================================================================== */
const DEFAULT_LOSS_SCALE = 0.55;

const DEFAULT_EXTRA = {
  DRYPWR_VPD_W: 0.06,
  DRYPWR_CLOUD_W: 0.04,
  LOSS_ET0_W: 0.08,
  ADD_SM010_W: 0.10,
  STORAGE_CAP_SM010_W: 0.05,
  DRY_LOSS_MULT: 1.0,
  RAIN_EFF_MULT: 1.0
};

const DEFAULT_TUNE = {
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

  SURFACE_CAP_IN: 0.70,
  SURFACE_RAIN_CAPTURE: 1.00,
  SURFACE_PENALTY_MAX: 42,
  SURFACE_PENALTY_EXP: 0.82,

  SURFACE_DRY_BASE: 0.02,
  SURFACE_DRY_DRYPWR_W: 0.16,
  SURFACE_DRY_ET0_W: 0.10,
  SURFACE_DRY_WIND_W: 0.05,
  SURFACE_DRY_SUN_W: 0.05,
  SURFACE_DRY_VPD_W: 0.04,
  SURFACE_DRY_CLOUD_W: 0.10,

  SAME_DAY_LATE_RAIN_DRY_FLOOR: 0.18,
  SAME_DAY_MORNING_RAIN_DRY_MIN: 0.70,
  SAME_DAY_MIDDAY_RAIN_DRY_MIN: 0.45,
  SAME_DAY_EVENING_RAIN_DRY_MIN: 0.12,

  SURFACE_TO_STORAGE_BASE: 0.12,
  SURFACE_TO_STORAGE_DRY_W: 0.08,
  SURFACE_TO_STORAGE_MORNING_W: 0.10,
  SURFACE_TO_STORAGE_EVENING_W: 0.08,
  SURFACE_TO_STORAGE_MAX_FRAC: 0.35,

  SURFACE_WET_HOLD_START_FRAC: 0.18,
  SURFACE_WET_HOLD_MAX_REDUCTION: 0.55,

  SURFACE_STORAGE_FLOOR_W: 0.45,
  SURFACE_STORAGE_FLOOR_CAP_FRAC: 0.22
};

/* =====================================================================
   Signed readiness credit
===================================================================== */
const SMAX_MIN = 3.0;
const SMAX_MAX = 5.0;
const SMAX_MID = 4.0;
const REV_POINTS_MAX = 20;

function signedCreditInchesFromSmax(Smax){
  const s = clamp(Number(Smax), SMAX_MIN, SMAX_MAX);
  const signed = clamp((SMAX_MID - s) / 1.0, -1, 1);
  return signed * (REV_POINTS_MAX / 100) * s;
}

/* =====================================================================
   Tune / multipliers
===================================================================== */
function buildExtra(extra){
  const src = (extra && typeof extra === 'object') ? extra : {};
  return {
    DRYPWR_VPD_W: num(src.DRYPWR_VPD_W, DEFAULT_EXTRA.DRYPWR_VPD_W),
    DRYPWR_CLOUD_W: num(src.DRYPWR_CLOUD_W, DEFAULT_EXTRA.DRYPWR_CLOUD_W),
    LOSS_ET0_W: num(src.LOSS_ET0_W, DEFAULT_EXTRA.LOSS_ET0_W),
    ADD_SM010_W: num(src.ADD_SM010_W, DEFAULT_EXTRA.ADD_SM010_W),
    STORAGE_CAP_SM010_W: num(src.STORAGE_CAP_SM010_W, DEFAULT_EXTRA.STORAGE_CAP_SM010_W),
    DRY_LOSS_MULT: clamp(num(src.DRY_LOSS_MULT, DEFAULT_EXTRA.DRY_LOSS_MULT), 0.30, 3.00),
    RAIN_EFF_MULT: clamp(num(src.RAIN_EFF_MULT, DEFAULT_EXTRA.RAIN_EFF_MULT), 0.30, 3.00)
  };
}

function buildTune(tune){
  const src = (tune && typeof tune === 'object') ? tune : null;
  const t = { ...DEFAULT_TUNE };

  if (src){
    for (const k of Object.keys(t)){
      if (src[k] === null || src[k] === undefined) continue;
      const v = Number(src[k]);
      if (Number.isFinite(v)) t[k] = v;
    }
  }

  t.SAT_RUNOFF_START = clamp(t.SAT_RUNOFF_START, 0.40, 0.95);
  t.RUNOFF_EXP = clamp(t.RUNOFF_EXP, 0.8, 6.0);
  t.RUNOFF_DRAINPOOR_W = clamp(t.RUNOFF_DRAINPOOR_W, 0.0, 0.8);

  t.DRY_BYPASS_END = clamp(t.DRY_BYPASS_END, 0.10, 0.70);
  t.DRY_EXP = clamp(t.DRY_EXP, 0.8, 6.0);
  t.DRY_BYPASS_BASE = clamp(t.DRY_BYPASS_BASE, 0.0, 0.85);
  t.BYPASS_GOODDRAIN_W = clamp(t.BYPASS_GOODDRAIN_W, 0.0, 0.6);

  t.DRY_BYPASS_CAP_SAT = clamp(t.DRY_BYPASS_CAP_SAT, 0.03, 0.35);
  t.DRY_BYPASS_CAP_MAX = clamp(t.DRY_BYPASS_CAP_MAX, 0.0, 0.35);

  t.SAT_DRYBYPASS_FLOOR = clamp(t.SAT_DRYBYPASS_FLOOR, 0.0, 0.20);
  t.SAT_RUNOFF_CAP = clamp(t.SAT_RUNOFF_CAP, 0.20, 0.95);
  t.RAIN_EFF_MIN = clamp(t.RAIN_EFF_MIN, 0.0, 0.20);

  t.DRY_TAIL_START = clamp(t.DRY_TAIL_START, 0.03, 0.30);
  t.DRY_TAIL_MIN_MULT = clamp(t.DRY_TAIL_MIN_MULT, 0.20, 1.00);

  t.WET_HOLD_START = clamp(t.WET_HOLD_START, 0.40, 0.90);
  t.WET_HOLD_MAX_REDUCTION = clamp(t.WET_HOLD_MAX_REDUCTION, 0.00, 0.60);
  t.WET_HOLD_EXP = clamp(t.WET_HOLD_EXP, 0.6, 4.0);

  t.MID_ACCEL_START = clamp(t.MID_ACCEL_START, t.DRY_TAIL_START + 0.05, 0.80);
  t.MID_ACCEL_MAX_BOOST = clamp(t.MID_ACCEL_MAX_BOOST, 0.00, 0.40);
  t.MID_ACCEL_EXP = clamp(t.MID_ACCEL_EXP, 0.6, 4.0);

  t.SURFACE_CAP_IN = clamp(t.SURFACE_CAP_IN, 0.10, 1.25);
  t.SURFACE_RAIN_CAPTURE = clamp(t.SURFACE_RAIN_CAPTURE, 0.20, 1.50);
  t.SURFACE_PENALTY_MAX = clamp(t.SURFACE_PENALTY_MAX, 5, 60);
  t.SURFACE_PENALTY_EXP = clamp(t.SURFACE_PENALTY_EXP, 0.30, 2.00);

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

  return t;
}

/* =====================================================================
   Core helpers
===================================================================== */
function calcDryParts(row, extra){
  const temp = num(row && row.tempF, 0);
  const wind = num(row && row.windMph, 0);
  const rh = num(row && row.rh, 0);
  const solar = num(row && row.solarWm2, 0);
  const sunshineHr = num(row && row.sunshineHr, 0);
  const daylightHr = num(row && row.daylightHr, 0);

  const tempN = clamp((temp - 20) / 45, 0, 1);
  const windN = clamp((wind - 2) / 20, 0, 1);
  const solarN = clamp((solar - 60) / 300, 0, 1);
  const rhN = clamp((rh - 35) / 65, 0, 1);
  const sunshineN = clamp(sunshineHr / 12, 0, 1);
  const daylightN = clamp((daylightHr - 8) / 8, 0, 1);

  const rawBase =
    (0.35 * tempN) +
    (0.30 * solarN) +
    (0.25 * windN) -
    (0.25 * rhN);

  let dryPwr = clamp(rawBase, 0, 1);

  const vpd = (row && row.vpdKpa != null) ? Number(row.vpdKpa) : null;
  const cloud = (row && row.cloudPct != null) ? Number(row.cloudPct) : null;

  const vpdN = (vpd === null || !Number.isFinite(vpd)) ? 0 : clamp(vpd / 2.6, 0, 1);
  const cloudN = (cloud === null || !Number.isFinite(cloud)) ? 0 : clamp(cloud / 100, 0, 1);

  dryPwr = clamp(
    dryPwr + (extra.DRYPWR_VPD_W * vpdN) - (extra.DRYPWR_CLOUD_W * cloudN),
    0,
    1
  );

  return {
    temp,
    wind,
    rh,
    solar,
    sunshineHr,
    daylightHr,
    tempN,
    windN,
    rhN,
    solarN,
    sunshineN,
    daylightN,
    vpd: Number.isFinite(vpd) ? vpd : 0,
    vpdN,
    cloud: Number.isFinite(cloud) ? cloud : 0,
    cloudN,
    raw: rawBase,
    dryPwr
  };
}

function mapFactors(soilWetness0_100, drainageIndex0_100, sm010){
  const soilHoldRaw = safePct01(soilWetness0_100);
  const drainPoorRaw = safePct01(drainageIndex0_100);

  const soilHold = snap01(soilHoldRaw);
  const drainPoor = snap01(drainPoorRaw);

  const smN = (sm010 == null || !Number.isFinite(Number(sm010)))
    ? 0
    : clamp((Number(sm010) - 0.10) / 0.25, 0, 1);

  const infilMult = 0.60 + 0.30 * soilHold + 0.35 * drainPoor;
  const dryMult = 1.20 - 0.35 * soilHold - 0.40 * drainPoor;

  const SmaxBase = 3.00 + 1.00 * soilHold + 1.00 * drainPoor;
  const Smax = clamp(SmaxBase, 3.00, 5.00);

  return { soilHold, drainPoor, smN, infilMult, dryMult, Smax, SmaxBase };
}

function effectiveRainInches(rainIn, storageBefore, Smax, factors, tune){
  const rain = Math.max(0, Number(rainIn || 0));
  if (!rain || !Number.isFinite(storageBefore) || !Number.isFinite(Smax) || Smax <= 0){
    return 0;
  }

  const sat = clamp(storageBefore / Smax, 0, 1);
  const drainPoor = clamp(Number(factors && factors.drainPoor), 0, 1);

  const sr = clamp(
    (sat - tune.SAT_RUNOFF_START) / Math.max(1e-6, 1 - tune.SAT_RUNOFF_START),
    0,
    1
  );
  let runoffFrac = Math.pow(sr, tune.RUNOFF_EXP);
  runoffFrac = runoffFrac * (1 + tune.RUNOFF_DRAINPOOR_W * drainPoor);
  runoffFrac = clamp(runoffFrac, 0, tune.SAT_RUNOFF_CAP);

  const rainAfterRunoff = rain * (1 - runoffFrac);

  const satB = Math.max(tune.SAT_DRYBYPASS_FLOOR, sat);
  const db = clamp(
    (tune.DRY_BYPASS_END - satB) / Math.max(1e-6, tune.DRY_BYPASS_END),
    0,
    1
  );
  const dryBypassCurve = Math.pow(db, tune.DRY_EXP);

  const goodDrain = 1 - drainPoor;
  let bypassFrac =
    tune.DRY_BYPASS_BASE * dryBypassCurve * (1 + tune.BYPASS_GOODDRAIN_W * goodDrain);
  bypassFrac = clamp(bypassFrac, 0, 0.90);

  if (sat < tune.DRY_BYPASS_CAP_SAT){
    bypassFrac = Math.min(bypassFrac, tune.DRY_BYPASS_CAP_MAX);
  }

  const rainEffective = rainAfterRunoff * (1 - bypassFrac);
  const minEff = tune.RAIN_EFF_MIN * rain;

  return Math.max(minEff, rainEffective);
}

function storageDrydownMult(storageBefore, Smax, tune){
  if (!Number.isFinite(storageBefore) || !Number.isFinite(Smax) || Smax <= 0) return 1;

  const sat = clamp(storageBefore / Smax, 0, 1);
  let mult = 1;

  if (sat > tune.WET_HOLD_START){
    const wetFrac = clamp(
      (sat - tune.WET_HOLD_START) / Math.max(1e-6, 1 - tune.WET_HOLD_START),
      0,
      1
    );
    const wetReduction = tune.WET_HOLD_MAX_REDUCTION * Math.pow(wetFrac, tune.WET_HOLD_EXP);
    mult *= (1 - wetReduction);
  }

  if (sat < tune.MID_ACCEL_START && sat > tune.DRY_TAIL_START){
    const midFrac = clamp(
      (tune.MID_ACCEL_START - sat) / Math.max(1e-6, tune.MID_ACCEL_START - tune.DRY_TAIL_START),
      0,
      1
    );
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
  const dryPwr = clamp(Number(parts && parts.dryPwr || 0), 0, 1);
  const windN = clamp(Number(parts && parts.windN || 0), 0, 1);
  const sunshineN = clamp(Number(parts && parts.sunshineN || 0), 0, 1);
  const vpdN = clamp(Number(parts && parts.vpdN || 0), 0, 1);
  const cloudN = clamp(Number(parts && parts.cloudN || 0), 0, 1);
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
  const rain = Math.max(0, Number(row && (row.rainInAdj != null ? row.rainInAdj : row.rainIn) || 0));
  if (!rain) return 1;

  const morning = Math.max(0, Number(row && row.rainMorningIn || 0));
  const midday = Math.max(0, Number(row && row.rainMiddayIn || 0));
  const evening = Math.max(0, Number(row && row.rainEveningIn || 0));
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
  const dryPwr = clamp(Number(row && row.dryPwr || 0), 0, 1);
  const morning = clamp(Number(row && row.rainMorningShare || 0), 0, 1);
  const evening = clamp(Number(row && row.rainEveningShare || 0), 0, 1);

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
   Calibration
===================================================================== */
function getWetBias(opts){
  try{
    const cal = opts && opts.cal && typeof opts.cal === 'object' ? opts.cal : {};
    const v = Number(cal.wetBias);
    return Number.isFinite(v) ? clamp(v, -25, 25) : 0;
  }catch(_){
    return 0;
  }
}

function getReadinessShift(opts){
  try{
    const cal = opts && opts.cal && typeof opts.cal === 'object' ? opts.cal : {};
    const v = Number(cal.readinessShift);
    return Number.isFinite(v) ? clamp(v, -50, 50) : 0;
  }catch(_){
    return 0;
  }
}

function applyCalToStorage(storagePhys, Smax, opts){
  const smax = Number(Smax);
  const s0 = Number(storagePhys);

  if (!Number.isFinite(smax) || smax <= 0 || !Number.isFinite(s0)){
    return {
      storageEff: Number.isFinite(s0) ? s0 : 0,
      wetBiasApplied: 0,
      readinessShiftApplied: 0,
      wetnessDeltaApplied: 0,
      storageDeltaApplied: 0
    };
  }

  const wetBias = getWetBias(opts);
  const readinessShift = getReadinessShift(opts);
  const wetnessDelta = clamp(wetBias - readinessShift, -60, 60);
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
   Rain precedence
===================================================================== */
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

/* =====================================================================
   Readiness from physical storage
===================================================================== */
function computeReadinessFromState(storagePhys, surfaceStorage, factors, opts, tune){
  const calRes = applyCalToStorage(storagePhys, factors.Smax, opts);
  const storageEff = calRes.storageEff;

  const creditIn = signedCreditInchesFromSmax(factors.Smax);
  const storageForReadiness = clamp(storageEff - creditIn, 0, factors.Smax);

  const baseWetness = (factors.Smax > 0)
    ? clamp((storageForReadiness / factors.Smax) * 100, 0, 100)
    : 0;

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
    storageMax: factors.Smax,
    storageCapacity: factors.Smax,
    storageMaxFinal: factors.Smax,
    calRes
  };
}

/* =====================================================================
   Seed logic
===================================================================== */
function baselineSeedFromWindow(rowsWindow, factors){
  const first7 = rowsWindow.slice(0, 7);
  const rain7 = first7.reduce((s, x) => s + Number(x && x.rainInAdj || 0), 0);

  const rainNudgeFrac = clamp(rain7 / 8.0, 0, 1);
  const rainNudge = rainNudgeFrac * (0.10 * factors.Smax);

  const storage0 = clamp((0.30 * factors.Smax) + rainNudge, 0, factors.Smax);
  return { storage0, rain7, rainNudge };
}

function pickSeed(rows, factors, persistedState, opts = {}){
  if (
    persistedState &&
    Number.isFinite(Number(persistedState.storageFinal)) &&
    persistedState.asOfDateISO
  ){
    const asOf = String(persistedState.asOfDateISO).slice(0, 10);
    const idx = rows.findIndex(r => String(r.dateISO || '').slice(0, 10) === asOf);

    if (idx >= 0){
      const forceFull = !!opts.forceFullHistoryFromPersisted;
      return {
        seedStorage: clamp(Number(persistedState.storageFinal), 0, factors.Smax),
        startIdx: forceFull ? 0 : (idx + 1),
        source: forceFull ? 'persisted-full-history' : 'persisted'
      };
    }
  }

  const b0 = baselineSeedFromWindow(rows, factors);
  return {
    seedStorage: b0.storage0,
    startIdx: 0,
    source: 'baseline',
    baselineRain7: b0.rain7,
    baselineRainNudge: b0.rainNudge
  };
}

/* =====================================================================
   Row normalization
===================================================================== */
function normalizeWeatherRowsForModel(rows, extra, tune){
  return (Array.isArray(rows) ? rows : []).map(w => {
    const rainPick = pickRainForRow(w);
    const parts = calcDryParts(w, extra);

    const et0 = (w && w.et0In != null) ? Number(w.et0In) : null;
    const et0N = (et0 === null || !Number.isFinite(et0)) ? 0 : clamp(et0 / 0.30, 0, 1);

    const smNDay = (w && w.sm010 != null && Number.isFinite(Number(w.sm010)))
      ? clamp((Number(w.sm010) - 0.10) / 0.25, 0, 1)
      : 0;

    const rainMorningIn = Number.isFinite(Number(w && w.rainMorningIn)) ? Number(w.rainMorningIn) : 0;
    const rainMiddayIn = Number.isFinite(Number(w && w.rainMiddayIn)) ? Number(w.rainMiddayIn) : 0;
    const rainEveningIn = Number.isFinite(Number(w && w.rainEveningIn)) ? Number(w.rainEveningIn) : 0;
    const totalTimingRain = Math.max(1e-6, rainMorningIn + rainMiddayIn + rainEveningIn);

    const row = {
      ...w,
      rainInAdj: rainPick.rainInAdj,
      rainSource: rainPick.rainSource,
      et0: Number.isFinite(et0) ? et0 : 0,
      et0N,
      smN_day: smNDay,

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
  });
}

/* =====================================================================
   Public API
===================================================================== */
function runFieldReadinessCore(
  rows,
  soilWetness,
  drainageIndex,
  persistedState = null,
  opts = {}
){
  if (!Array.isArray(rows) || !rows.length) return null;

  const extra = buildExtra(opts.extra);
  const tune = buildTune(opts.tune);
  const lossScale = Number.isFinite(Number(opts.lossScale))
    ? Number(opts.lossScale)
    : DEFAULT_LOSS_SCALE;

  const normalizedRows = normalizeWeatherRowsForModel(rows, extra, tune);
  if (!normalizedRows.length) return null;

  const last = normalizedRows[normalizedRows.length - 1] || {};
  const factors = mapFactors(soilWetness, drainageIndex, last.sm010);

  const seedPick = pickSeed(normalizedRows, factors, persistedState, {
    forceFullHistoryFromPersisted: !!opts.forceFullHistoryFromPersisted
  });

  let storage = clamp(seedPick.seedStorage, 0, factors.Smax);
  let surfaceStorage = 0;

  const trace = [];
  const wantTrace = !!opts.includeTrace;
  const lossHistory = [];

  for (let i = seedPick.startIdx; i < normalizedRows.length; i++){
    const d = normalizedRows[i];
    const rain = Number(d.rainInAdj || 0);

    const before = storage;
    const surfaceBefore = surfaceStorage;

    let rainEff = effectiveRainInches(rain, before, factors.Smax, factors, tune);
    rainEff = clamp(rainEff * extra.RAIN_EFF_MULT, 0, 1000);

    const addSm = (extra.ADD_SM010_W * d.smN_day) * 0.05;
    const addRain = rainEff * factors.infilMult;
    const add = addRain + addSm;

    let lossBase =
      Number(d.dryPwr || 0) *
      lossScale *
      factors.dryMult *
      (1 + (extra.LOSS_ET0_W * d.et0N));

    const rainTimingDryFactorVal = clamp(
      Number(d.rainTimingDryFactor != null ? d.rainTimingDryFactor : sameDayRainDryFactor(d, tune)),
      tune.SAME_DAY_LATE_RAIN_DRY_FLOOR,
      1
    );
    lossBase *= rainTimingDryFactorVal;

    const stateDryMult = storageDrydownMult(before, factors.Smax, tune);
    const surfaceWetDryMult = surfaceWetHoldDryMult(surfaceBefore, tune);

    let loss = lossBase * stateDryMult * surfaceWetDryMult;
    loss = Math.max(0, loss * extra.DRY_LOSS_MULT);

    if (factors.Smax > 0 && Number.isFinite(before)){
      const sat = clamp(before / factors.Smax, 0, 1);
      if (sat < tune.DRY_TAIL_START){
        const frac = clamp(sat / Math.max(1e-6, tune.DRY_TAIL_START), 0, 1);
        const mult = tune.DRY_TAIL_MIN_MULT + (1 - tune.DRY_TAIL_MIN_MULT) * frac;
        loss = loss * mult;
      }
    }

    let after = clamp(before + add - loss, 0, factors.Smax);

    const surfaceAdd = surfaceStorageAddFromRain(rain, tune);
    const surfaceDryBase = surfaceDrydownInchesPerDay(d, d.et0N, tune);
    const surfaceDry = surfaceDryBase * rainTimingDryFactorVal;

    surfaceStorage = clamp(surfaceBefore + surfaceAdd - surfaceDry, 0, tune.SURFACE_CAP_IN);

    const handoffFrac = surfaceToStorageFrac(d, tune);
    const storageRoom = Math.max(0, factors.Smax - after);
    const surfaceToStorage = Math.min(surfaceStorage * handoffFrac, storageRoom);

    after = clamp(after + surfaceToStorage, 0, factors.Smax);
    surfaceStorage = clamp(surfaceStorage - surfaceToStorage, 0, tune.SURFACE_CAP_IN);

    const storageFloor = surfaceDrivenStorageFloor(surfaceStorage, factors.Smax, tune);
    after = Math.max(after, storageFloor);

    storage = clamp(after, 0, factors.Smax);
    lossHistory.push(loss);

    if (wantTrace){
      const infilMultEff = (rain > 0)
        ? clamp((addRain / Math.max(1e-6, rain)), 0, 5)
        : 0;

      trace.push({
        dateISO: d.dateISO,
        before,
        after: storage,
        rain,
        rainIn: rain,
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
  }

  const storagePhysFinal = storage;
  const out = computeReadinessFromState(storagePhysFinal, surfaceStorage, factors, opts, tune);

  const avgLossDay = lossHistory.length
    ? (lossHistory.slice(-7).reduce((s, x) => s + x, 0) / Math.min(7, lossHistory.length))
    : 0;

  return {
    sourceMode: 'weather-rows',

    rows: normalizedRows,
    trace,
    factors,

    seedSource: safeStr(seedPick.source),
    seedStorage: seedPick.seedStorage,
    startIdx: seedPick.startIdx,
    baselineRain7: num(seedPick.baselineRain7, 0),
    baselineRainNudge: num(seedPick.baselineRainNudge, 0),

    storagePhysFinal,
    storageFinal: out.storageEff,
    storageMax: out.storageMax,
    storageCapacity: out.storageCapacity,
    storageMaxFinal: out.storageMaxFinal,

    surfaceStorageFinal: surfaceStorage,
    surfacePenalty: out.surfacePenalty,
    surfacePenaltyR: roundInt(out.surfacePenalty),
    baseReadiness: out.baseReadiness,
    baseReadinessR: roundInt(out.baseReadiness),

    wetness: out.wetness,
    readiness: out.readiness,
    wetnessR: roundInt(out.wetness),
    readinessR: roundInt(out.readiness),

    readinessCreditIn: out.creditIn,
    storageForReadiness: out.storageForReadiness,
    avgLossDay,

    debug: {
      sourceMode: 'weather-rows',
      rowCount: normalizedRows.length,
      startIdx: seedPick.startIdx,
      seedSource: safeStr(seedPick.source),
      lastDateISO: safeStr(last.dateISO),
      lastRainSource: safeStr(last.rainSource),
      Smax: num(factors.Smax, 0),
      soilHold: num(factors.soilHold, 0),
      drainPoor: num(factors.drainPoor, 0),
      storageMax: num(out.storageMax, 0),
      forceFullHistoryFromPersisted: !!opts.forceFullHistoryFromPersisted
    }
  };
}

/* =====================================================================
   Readiness from persisted storage only
===================================================================== */
function runReadinessFromPersistedStateOnly(
  soilWetness,
  drainageIndex,
  persistedState = null,
  opts = {}
){
  if (!persistedState || !Number.isFinite(Number(persistedState.storageFinal))){
    return null;
  }

  const tune = buildTune(opts.tune);
  const factors = mapFactors(soilWetness, drainageIndex, null);

  let storagePhysFinal = clamp(Number(persistedState.storageFinal), 0, factors.Smax);

  const savedSmax = Number(persistedState.SmaxAtSave);
  if (Number.isFinite(savedSmax) && savedSmax > 0 && Math.abs(savedSmax - factors.Smax) > 0.001){
    const frac = clamp(storagePhysFinal / savedSmax, 0, 1);
    storagePhysFinal = clamp(frac * factors.Smax, 0, factors.Smax);
  }

  const surfaceStorageFinal = 0;
  const out = computeReadinessFromState(storagePhysFinal, surfaceStorageFinal, factors, opts, tune);

  return {
    sourceMode: 'persisted-state-only',

    rows: [],
    trace: [],
    factors,

    seedSource: 'persisted-state-only',
    seedStorage: storagePhysFinal,
    startIdx: 0,
    baselineRain7: 0,
    baselineRainNudge: 0,

    storagePhysFinal,
    storageFinal: out.storageEff,
    storageMax: out.storageMax,
    storageCapacity: out.storageCapacity,
    storageMaxFinal: out.storageMaxFinal,

    surfaceStorageFinal,
    surfacePenalty: out.surfacePenalty,
    surfacePenaltyR: roundInt(out.surfacePenalty),
    baseReadiness: out.baseReadiness,
    baseReadinessR: roundInt(out.baseReadiness),

    wetness: out.wetness,
    readiness: out.readiness,
    wetnessR: roundInt(out.wetness),
    readinessR: roundInt(out.readiness),

    readinessCreditIn: out.creditIn,
    storageForReadiness: out.storageForReadiness,
    avgLossDay: 0,

    debug: {
      sourceMode: 'persisted-state-only',
      seedSource: 'persisted-state-only',
      rowCount: 0,
      startIdx: 0,
      Smax: num(factors.Smax, 0),
      soilHold: num(factors.soilHold, 0),
      drainPoor: num(factors.drainPoor, 0),
      savedSmax: Number.isFinite(savedSmax) ? savedSmax : null,
      storageMax: num(out.storageMax, 0)
    }
  };
}

module.exports = {
  runFieldReadinessCore,
  runReadinessFromPersistedStateOnly
};
