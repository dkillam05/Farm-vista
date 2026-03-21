/* =====================================================================
/Farm-vista/js/field-readiness/readiness-core-shared.js  (FULL FILE)
Rev: 2026-03-21a-add-incremental-storage-replay-parity

PURPOSE
✅ Shared PURE readiness math core for BOTH:
   - Browser UI (render / quickview / map)
   - Cloud Run backend snapshot
✅ Rebuilt to match the current live field-readiness model logic much more closely
✅ No Firebase / DOM / state / cache code in this file
✅ Pure inputs in -> pure outputs out

IMPORTANT
✅ This file is ONLY the math/seed engine
✅ Caller must still supply the correct weather rows:
   - MRMS-overlaid rows when MRMS is ready
   - Open-Meteo rows when MRMS is not ready
✅ Caller must still supply persisted truth state when available
✅ CAL is intentionally zeroed here for parity with your current formula.js setup

MATCHES LIVE MODEL FOR:
✅ baseline seed logic
✅ persisted seed with asOfDateISO row start
✅ factor math
✅ signed readiness credit from Smax
✅ saturation-aware rain effectiveness
✅ dry bypass / runoff behavior
✅ storage-state drydown behavior
✅ dry-tail slowdown
✅ learning multipliers
✅ SM010 nudges
✅ readiness/wetness/storage outputs

FIXES IN THIS REV
✅ FIX: rain precedence now matches backend:
   - rainInAdj first
   - then rainIn
   - MRMS-only fallback only if caller did not already provide rainInAdj
✅ FIX: avgLossDay now computes correctly even when includeTrace=false
✅ FIX: backend-style row normalization parity tightened
✅ NEW: if persisted storage exists but the exact asOfDate row is not present,
   seed from persisted storage anyway and replay the available rows instead of
   falling back to baseline rebuild
✅ NEW: returns seed metadata for UI/debug parity

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

function safeISO10(v){
  const s = safeStr(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

/* =====================================================================
   Defaults aligned to live model
===================================================================== */
const DEFAULT_LOSS_SCALE = 0.55;

const DEFAULT_EXTRA = {
  DRYPWR_VPD_W: 0.06,
  DRYPWR_CLOUD_W: 0.04,
  LOSS_ET0_W: 0.08,
  ADD_SM010_W: 0.10,
  STORAGE_CAP_SM010_W: 0.05, // kept for compatibility; live model Smax does not currently use it
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
  WET_HOLD_EXP: 1.70,

  MID_ACCEL_START: 0.50,
  MID_ACCEL_MAX_BOOST: 0.18,
  MID_ACCEL_EXP: 1.35
};

/* =====================================================================
   Signed readiness credit (same live logic)
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

  t.SAT_RUNOFF_START   = clamp(t.SAT_RUNOFF_START, 0.40, 0.95);
  t.RUNOFF_EXP         = clamp(t.RUNOFF_EXP, 0.8, 6.0);
  t.RUNOFF_DRAINPOOR_W = clamp(t.RUNOFF_DRAINPOOR_W, 0.0, 0.8);

  t.DRY_BYPASS_END     = clamp(t.DRY_BYPASS_END, 0.10, 0.70);
  t.DRY_EXP            = clamp(t.DRY_EXP, 0.8, 6.0);
  t.DRY_BYPASS_BASE    = clamp(t.DRY_BYPASS_BASE, 0.0, 0.85);
  t.BYPASS_GOODDRAIN_W = clamp(t.BYPASS_GOODDRAIN_W, 0.0, 0.6);

  t.DRY_BYPASS_CAP_SAT = clamp(t.DRY_BYPASS_CAP_SAT, 0.03, 0.35);
  t.DRY_BYPASS_CAP_MAX = clamp(t.DRY_BYPASS_CAP_MAX, 0.0, 0.35);

  t.SAT_DRYBYPASS_FLOOR = clamp(t.SAT_DRYBYPASS_FLOOR, 0.0, 0.20);
  t.SAT_RUNOFF_CAP      = clamp(t.SAT_RUNOFF_CAP, 0.20, 0.95);
  t.RAIN_EFF_MIN        = clamp(t.RAIN_EFF_MIN, 0.0, 0.20);

  t.DRY_TAIL_START     = clamp(t.DRY_TAIL_START, 0.03, 0.30);
  t.DRY_TAIL_MIN_MULT  = clamp(t.DRY_TAIL_MIN_MULT, 0.20, 1.00);

  t.WET_HOLD_START         = clamp(t.WET_HOLD_START, 0.40, 0.90);
  t.WET_HOLD_MAX_REDUCTION = clamp(t.WET_HOLD_MAX_REDUCTION, 0.00, 0.60);
  t.WET_HOLD_EXP           = clamp(t.WET_HOLD_EXP, 0.6, 4.0);

  t.MID_ACCEL_START     = clamp(t.MID_ACCEL_START, t.DRY_TAIL_START + 0.05, 0.80);
  t.MID_ACCEL_MAX_BOOST = clamp(t.MID_ACCEL_MAX_BOOST, 0.00, 0.40);
  t.MID_ACCEL_EXP       = clamp(t.MID_ACCEL_EXP, 0.6, 4.0);

  return t;
}

/* =====================================================================
   Core live-model helpers
===================================================================== */
function calcDryParts(row, extra){
  const temp = num(row && row.tempF, 0);
  const wind = num(row && row.windMph, 0);
  const rh   = num(row && row.rh, 0);
  const solar= num(row && row.solarWm2, 0);

  const tempN  = clamp((temp - 20) / 45, 0, 1);
  const windN  = clamp((wind - 2) / 20, 0, 1);
  const solarN = clamp((solar - 60) / 300, 0, 1);
  const rhN    = clamp((rh - 35) / 65, 0, 1);

  const rawBase = (0.35 * tempN + 0.30 * solarN + 0.25 * windN - 0.25 * rhN);
  let dryPwr = clamp(rawBase, 0, 1);

  const vpd = (row && row.vpdKpa != null) ? Number(row.vpdKpa) : null;
  const cloud = (row && row.cloudPct != null) ? Number(row.cloudPct) : null;

  const vpdN = (vpd === null || !Number.isFinite(vpd)) ? 0 : clamp(vpd / 2.6, 0, 1);
  const cloudN = (cloud === null || !Number.isFinite(cloud)) ? 0 : clamp(cloud / 100, 0, 1);

  dryPwr = clamp(
    dryPwr + extra.DRYPWR_VPD_W * vpdN - extra.DRYPWR_CLOUD_W * cloudN,
    0,
    1
  );

  return {
    temp, wind, rh, solar,
    tempN, windN, rhN, solarN,
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

  const smN = (sm010 === null || sm010 === undefined || !Number.isFinite(Number(sm010)))
    ? 0
    : clamp((Number(sm010) - 0.10) / 0.25, 0, 1);

  const infilMult = 0.60 + 0.30 * soilHold + 0.35 * drainPoor;
  const dryMult   = 1.20 - 0.35 * soilHold - 0.40 * drainPoor;

  const SmaxBase = 3.00 + 1.00 * soilHold + 1.00 * drainPoor;
  const Smax = clamp(SmaxBase, 3.00, 5.00);

  return { soilHold, drainPoor, smN, infilMult, dryMult, Smax, SmaxBase };
}

/* =====================================================================
   Rain precedence must match backend
===================================================================== */
function pickRainForRow(w){
  if (!w || typeof w !== 'object'){
    return { rainInAdj: 0, rainSource: 'none' };
  }

  if (Number.isFinite(Number(w.rainInAdj))){
    const src = String(w.rainSource || w.precipSource || 'open-meteo').toLowerCase();
    return {
      rainInAdj: Math.max(0, Number(w.rainInAdj)),
      rainSource: src || 'open-meteo'
    };
  }

  if (Number.isFinite(Number(w.rainIn))){
    return {
      rainInAdj: Math.max(0, Number(w.rainIn)),
      rainSource: 'open-meteo'
    };
  }

  if (Number.isFinite(Number(w.rainMrmsIn))){
    return {
      rainInAdj: Math.max(0, Number(w.rainMrmsIn)),
      rainSource: 'mrms'
    };
  }

  if (Number.isFinite(Number(w.precipIn))){
    return {
      rainInAdj: Math.max(0, Number(w.precipIn)),
      rainSource: 'open-meteo'
    };
  }

  return { rainInAdj: 0, rainSource: 'none' };
}

function effectiveRainInches(rainIn, storageBefore, Smax, factors, tune){
  const rain = Math.max(0, Number(rainIn || 0));
  if (!rain || !Number.isFinite(rain) || !Number.isFinite(storageBefore) || !Number.isFinite(Smax) || Smax <= 0){
    return 0;
  }

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
  if (!Number.isFinite(storageBefore) || !Number.isFinite(Smax) || Smax <= 0){
    return 1;
  }

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

function applyCalToStorage(storagePhys, Smax){
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

  const wetBias = 0;
  const readinessShift = 0;

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

function computeReadinessFromStorage(storagePhys, factors){
  const calRes = applyCalToStorage(storagePhys, factors.Smax);
  const storageEff = calRes.storageEff;

  const creditIn = signedCreditInchesFromSmax(factors.Smax);
  const storageForReadiness = clamp(storageEff - creditIn, 0, factors.Smax);

  const wetness = (factors.Smax > 0)
    ? clamp((storageForReadiness / factors.Smax) * 100, 0, 100)
    : 0;

  const readiness = clamp(100 - wetness, 0, 100);

  return {
    readiness,
    wetness,
    creditIn,
    storageEff,
    storageForReadiness,
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

function pickSeed(rows, factors, persistedState){
  if (
    persistedState &&
    Number.isFinite(Number(persistedState.storageFinal))
  ){
    const seedStorage = clamp(Number(persistedState.storageFinal), 0, factors.Smax);
    const asOf = safeISO10(persistedState.asOfDateISO);

    if (asOf){
      const idx = rows.findIndex(r => safeISO10(r && r.dateISO) === asOf);
      if (idx >= 0){
        return {
          seedStorage,
          startIdx: idx + 1,
          source: 'persisted_exact_match',
          persistedAsOfDateISO: asOf
        };
      }
    }

    return {
      seedStorage,
      startIdx: 0,
      source: 'persisted_replay_available_rows',
      persistedAsOfDateISO: asOf || ''
    };
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
   Row normalization for model loop
===================================================================== */
function normalizeWeatherRowsForModel(rows, extra){
  return (Array.isArray(rows) ? rows : []).map(w => {
    const rainPick = pickRainForRow(w);
    const parts = calcDryParts(w, extra);

    const et0 = (w && w.et0In != null) ? Number(w.et0In) : null;
    const et0N = (et0 === null || !Number.isFinite(et0)) ? 0 : clamp(et0 / 0.30, 0, 1);

    const smNDay = (w && w.sm010 != null && Number.isFinite(Number(w.sm010)))
      ? clamp((Number(w.sm010) - 0.10) / 0.25, 0, 1)
      : 0;

    return {
      ...w,
      rainInAdj: rainPick.rainInAdj,
      rainSource: rainPick.rainSource,
      et0: Number.isFinite(et0) ? et0 : 0,
      et0N,
      smN_day: smNDay,
      ...parts
    };
  });
}

/* =====================================================================
   Public shared core
===================================================================== */
/**
 * Pure shared readiness engine.
 *
 * @param {Array} rows
 * @param {number} soilWetness
 * @param {number} drainageIndex
 * @param {object|null} persistedState
 * @param {object} opts
 *   - extra
 *   - tune
 *   - lossScale
 *   - includeTrace
 *
 * @returns {object|null}
 */
export function runFieldReadinessCore(
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

  const normalizedRows = normalizeWeatherRowsForModel(rows, extra);
  if (!normalizedRows.length) return null;

  const last = normalizedRows[normalizedRows.length - 1] || {};
  const factors = mapFactors(soilWetness, drainageIndex, last.sm010);

  const seedPick = pickSeed(normalizedRows, factors, persistedState);
  let storage = clamp(seedPick.seedStorage, 0, factors.Smax);

  const trace = [];
  const wantTrace = !!opts.includeTrace;
  const lossHistory = [];

  for (let i = seedPick.startIdx; i < normalizedRows.length; i++){
    const d = normalizedRows[i];
    const rain = Number(d.rainInAdj || 0);
    const before = storage;

    let rainEff = effectiveRainInches(rain, before, factors.Smax, factors, tune);
    rainEff = clamp(rainEff * extra.RAIN_EFF_MULT, 0, 1000);

    const addSm = (extra.ADD_SM010_W * d.smN_day) * 0.05;
    const addRain = rainEff * factors.infilMult;
    const add = addRain + addSm;

    let lossBase = Number(d.dryPwr || 0) * lossScale * factors.dryMult * (1 + extra.LOSS_ET0_W * d.et0N);

    const stateDryMult = storageDrydownMult(before, factors.Smax, tune);
    let loss = lossBase * stateDryMult;
    loss = Math.max(0, loss * extra.DRY_LOSS_MULT);

    if (factors.Smax > 0 && Number.isFinite(before)){
      const sat = clamp(before / factors.Smax, 0, 1);
      if (sat < tune.DRY_TAIL_START){
        const frac = clamp(sat / Math.max(1e-6, tune.DRY_TAIL_START), 0, 1);
        const mult = tune.DRY_TAIL_MIN_MULT + (1 - tune.DRY_TAIL_MIN_MULT) * frac;
        loss = loss * mult;
      }
    }

    const after = clamp(before + add - loss, 0, factors.Smax);
    storage = after;
    lossHistory.push(loss);

    if (wantTrace){
      const infilMultEff = (rain > 0)
        ? clamp((addRain / Math.max(1e-6, rain)), 0, 5)
        : 0;

      trace.push({
        dateISO: d.dateISO,
        before,
        after,
        rain,
        rainSource: String(d.rainSource || 'unknown'),
        rainEff,
        infilMult: infilMultEff,
        addRain,
        addSm,
        add,
        lossBase,
        stateDryMult,
        loss,
        dryPwr: d.dryPwr
      });
    }
  }

  const storagePhysFinal = storage;
  const out = computeReadinessFromStorage(storagePhysFinal, factors);

  const wetnessR = roundInt(out.wetness);
  const readinessR = roundInt(out.readiness);

  const last7Loss = lossHistory.slice(-7);
  const avgLossDay = last7Loss.length
    ? (last7Loss.reduce((s, x) => s + x, 0) / last7Loss.length)
    : 0.08;

  return {
    rows: normalizedRows,
    trace: wantTrace ? trace : [],
    factors,

    seedSource: seedPick.source,
    seedStorage: seedPick.seedStorage,
    startIdx: seedPick.startIdx,
    baselineRain7: num(seedPick.baselineRain7, 0),
    baselineRainNudge: num(seedPick.baselineRainNudge, 0),
    persistedAsOfDateISO: safeStr(seedPick.persistedAsOfDateISO || ''),

    storagePhysFinal,
    storageFinal: out.storageEff,

    wetness: out.wetness,
    readiness: out.readiness,
    wetnessR,
    readinessR,

    readinessCreditIn: out.creditIn,
    storageForReadiness: out.storageForReadiness,
    avgLossDay
  };
}