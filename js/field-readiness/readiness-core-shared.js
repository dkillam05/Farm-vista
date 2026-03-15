/* =====================================================================
/Farm-vista/js/field-readiness/readiness-core-shared.js  (FULL FILE)
Rev: 2026-03-15b-shared-core-live-parity

Shared readiness engine used by BOTH:

- Browser UI (render / quickview / map)
- Cloud Run backend snapshot

This file contains the SAME core readiness math the browser model uses:
✅ persisted truth seed by matching asOfDateISO
✅ MRMS / Open-Meteo-adjusted rain via incoming row data
✅ storage-state drydown behavior
✅ CAL application
✅ readiness credit from Smax
✅ trace output so UI can still inspect day-by-day behavior

IMPORTANT:
- Pure math only
- No DOM
- No Firebase
- No browser-only dependencies
===================================================================== */
'use strict';

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

// Slider extremes
const SMAX_MIN = 3.0;
const SMAX_MAX = 5.0;
const SMAX_MID = 4.0;

// EXTREME: 20 points each way => 40 total swing
const REV_POINTS_MAX = 20;

function signedCreditInchesFromSmax(Smax){
  const s = clamp(Number(Smax), SMAX_MIN, SMAX_MAX);
  const signed = clamp((SMAX_MID - s) / 1.0, -1, 1);
  return signed * (REV_POINTS_MAX / 100) * s;
}

const DEFAULT_LOSS_SCALE = 0.55;

const DEFAULT_EXTRA = {
  DRYPWR_VPD_W: 0.06,
  DRYPWR_CLOUD_W: 0.04,
  LOSS_ET0_W: 0.08,
  ADD_SM010_W: 0.10,
  DRY_LOSS_MULT: 1.0,
  RAIN_EFF_MULT: 1.0
};

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
  WET_HOLD_EXP: 1.70,

  MID_ACCEL_START: 0.50,
  MID_ACCEL_MAX_BOOST: 0.18,
  MID_ACCEL_EXP: 1.35
};

function buildExtra(options){
  const src = (options && options.EXTRA && typeof options.EXTRA === 'object')
    ? options.EXTRA
    : {};
  return { ...DEFAULT_EXTRA, ...src };
}

function getTune(options){
  const t = { ...FV_TUNE };
  const srcA = (options && options.FV_TUNE && typeof options.FV_TUNE === 'object') ? options.FV_TUNE : null;
  const srcB = (options && options.EXTRA && typeof options.EXTRA === 'object') ? options.EXTRA : null;

  for (const src of [srcA, srcB]){
    if (!src) continue;
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

  return t;
}

function getRateMults(extra){
  try{
    const dryLossMult = Number(extra.DRY_LOSS_MULT);
    const rainEffMult = Number(extra.RAIN_EFF_MULT);

    return {
      dryLossMult: clamp(Number.isFinite(dryLossMult) ? dryLossMult : 1.0, 0.30, 3.00),
      rainEffMult: clamp(Number.isFinite(rainEffMult) ? rainEffMult : 1.0, 0.30, 3.00)
    };
  }catch(_){
    return { dryLossMult: 1.0, rainEffMult: 1.0 };
  }
}

function calcDryParts(r, extra){
  const temp = Number(r.tempF || 0);
  const wind = Number(r.windMph || 0);
  const rh   = Number(r.rh || 0);
  const solar= Number(r.solarWm2 || 0);

  const tempN = clamp((temp - 20) / 45, 0, 1);
  const windN = clamp((wind - 2) / 20, 0, 1);
  const solarN= clamp((solar - 60) / 300, 0, 1);
  const rhN   = clamp((rh - 35) / 65, 0, 1);

  const rawBase = (0.35*tempN + 0.30*solarN + 0.25*windN - 0.25*rhN);
  let dryPwr = clamp(rawBase, 0, 1);

  const vpd = (r.vpdKpa === null || r.vpdKpa === undefined) ? null : Number(r.vpdKpa);
  const cloud = (r.cloudPct === null || r.cloudPct === undefined) ? null : Number(r.cloudPct);

  const vpdN = (vpd === null || !Number.isFinite(vpd)) ? 0 : clamp(vpd / 2.6, 0, 1);
  const cloudN = (cloud === null || !Number.isFinite(cloud)) ? 0 : clamp(cloud / 100, 0, 1);

  dryPwr = clamp(dryPwr + extra.DRYPWR_VPD_W * vpdN - extra.DRYPWR_CLOUD_W * cloudN, 0, 1);

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
  const drainPoorRaw= safePct01(drainageIndex0_100);

  const soilHold = snap01(soilHoldRaw);
  const drainPoor= snap01(drainPoorRaw);

  const smN = (sm010 === null || sm010 === undefined || !Number.isFinite(Number(sm010)))
    ? 0
    : clamp((Number(sm010) - 0.10) / 0.25, 0, 1);

  const infilMult = 0.60 + 0.30*soilHold + 0.35*drainPoor;
  const dryMult   = 1.20 - 0.35*soilHold - 0.40*drainPoor;

  const SmaxBase = 3.00 + 1.00*soilHold + 1.00*drainPoor;
  const Smax = clamp(SmaxBase, 3.00, 5.00);

  return { soilHold, drainPoor, smN, infilMult, dryMult, Smax, SmaxBase };
}

function effectiveRainInches(rainIn, storageBefore, Smax, factors, tune){
  const rain = Math.max(0, Number(rainIn || 0));
  if (!rain || !Number.isFinite(rain) || !Number.isFinite(storageBefore) || !Number.isFinite(Smax) || Smax <= 0) return 0;

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
  if (!Number.isFinite(storageBefore) || !Number.isFinite(Smax) || Smax <= 0) return 1;

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

function getWetBiasFromOptions(options){
  try{
    const CAL = options && options.CAL ? options.CAL : null;
    if (!CAL || typeof CAL !== 'object') return 0;

    const opKey = (options && typeof options.opKey === 'string') ? options.opKey : '';

    if (opKey && CAL.opWetBias && typeof CAL.opWetBias === 'object'){
      const vOp = CAL.opWetBias[opKey];
      if (Number.isFinite(Number(vOp))) return Number(vOp);
    }

    const v = CAL.wetBias;
    if (Number.isFinite(Number(v))) return Number(v);

    return 0;
  }catch(_){
    return 0;
  }
}

function getReadinessShiftFromOptions(options){
  try{
    const CAL = options && options.CAL ? options.CAL : null;
    if (!CAL || typeof CAL !== 'object') return 0;

    const opKey = (options && typeof options.opKey === 'string') ? options.opKey : '';

    if (opKey && CAL.opReadinessShift && typeof CAL.opReadinessShift === 'object'){
      const vOp = CAL.opReadinessShift[opKey];
      if (Number.isFinite(Number(vOp))) return Number(vOp);
    }

    const v = CAL.readinessShift;
    if (Number.isFinite(Number(v))) return Number(v);

    return 0;
  }catch(_){
    return 0;
  }
}

function applyCalToStorage(storagePhys, Smax, options){
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

  const wetBias = clamp(getWetBiasFromOptions(options), -25, 25);
  const readinessShift = clamp(getReadinessShiftFromOptions(options), -50, 50);

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

function normalizeRows(rows, extra){
  return (Array.isArray(rows) ? rows : []).map(w=>{
    const rainPick = pickRainForRow(w);
    const parts = calcDryParts(w, extra);

    const et0 = (w.et0In === null || w.et0In === undefined) ? null : Number(w.et0In);
    const et0N = (et0 === null || !Number.isFinite(et0)) ? 0 : clamp(et0 / 0.30, 0, 1);

    const smN2 = (w.sm010 === null || w.sm010 === undefined || !Number.isFinite(Number(w.sm010)))
      ? 0
      : clamp((Number(w.sm010)-0.10)/0.25, 0, 1);

    return {
      ...w,
      rainInAdj: rainPick.rainInAdj,
      rainSource: rainPick.rainSource,
      et0: Number.isFinite(et0) ? et0 : 0,
      et0N,
      smN_day: smN2,
      ...parts
    };
  });
}

function baselineSeedFromWindow(rowsWindow, f){
  const first7 = rowsWindow.slice(0,7);
  const rain7 = first7.reduce((s,x)=> s + Number(x && x.rainInAdj || 0), 0);

  const rainNudgeFrac = clamp(rain7 / 8.0, 0, 1);
  const rainNudge = rainNudgeFrac * (0.1 * f.Smax);

  const storage0 = clamp((0.30 * f.Smax) + rainNudge, 0, f.Smax);
  return { storage0 };
}

function getSeedMode(options){
  const m = options && options.seedMode ? String(options.seedMode) : '';
  if (m === 'rewind' || m === 'baseline' || m === 'persisted') return m;
  return 'persisted';
}

function getRewindDays(options){
  const n = Number(options && options.rewindDays);
  if (!Number.isFinite(n)) return 14;
  return clamp(Math.round(n), 3, 45);
}

function pickSeed(rows, f, persistedState, options){
  const mode = getSeedMode(options);

  if (mode === 'rewind'){
    const N = getRewindDays(options);
    const startIdx = Math.max(0, rows.length - N);
    const b = baselineSeedFromWindow(rows.slice(startIdx), f);
    return { seedStorage: b.storage0, startIdx, source: 'rewind' };
  }

  if (mode === 'persisted'){
    if (
      persistedState &&
      Number.isFinite(Number(persistedState.storageFinal)) &&
      persistedState.asOfDateISO
    ){
      const asOf = String(persistedState.asOfDateISO).slice(0,10);
      const idx = rows.findIndex(r => String(r.dateISO || '').slice(0,10) === asOf);
      if (idx >= 0){
        return {
          seedStorage: clamp(Number(persistedState.storageFinal), 0, f.Smax),
          startIdx: idx + 1,
          source: 'persisted'
        };
      }
    }
  }

  const b0 = baselineSeedFromWindow(rows, f);
  return { seedStorage: b0.storage0, startIdx: 0, source: 'baseline' };
}

export function runFieldReadinessCore(rows, soilWetness, drainageIndex, persistedState, options = {}){
  if (!Array.isArray(rows) || !rows.length) return null;

  const extra = buildExtra(options);
  const tune = getTune(options);
  const rate = getRateMults(extra);
  const lossScale = Number.isFinite(Number(options && options.LOSS_SCALE))
    ? Number(options.LOSS_SCALE)
    : DEFAULT_LOSS_SCALE;

  const rowsNorm = normalizeRows(rows, extra);
  if (!rowsNorm.length) return null;

  const last = rowsNorm[rowsNorm.length - 1] || {};
  const f = mapFactors(soilWetness, drainageIndex, last.sm010);

  const seedPick = pickSeed(rowsNorm, f, persistedState, options);
  let storage = clamp(seedPick.seedStorage, 0, f.Smax);

  const trace = [];

  for (let i = seedPick.startIdx; i < rowsNorm.length; i++){
    const d = rowsNorm[i];
    const rain = Number(d.rainInAdj || 0);

    const before = storage;

    let rainEff = effectiveRainInches(rain, before, f.Smax, f, tune);
    rainEff = clamp(rainEff * rate.rainEffMult, 0, 1000);

    const addSm = (extra.ADD_SM010_W * d.smN_day) * 0.05;
    const addRain = rainEff * f.infilMult;
    const add = addRain + addSm;

    let lossBase = Number(d.dryPwr || 0) * lossScale * f.dryMult * (1 + extra.LOSS_ET0_W * d.et0N);

    const stateDryMult = storageDrydownMult(before, f.Smax, tune);

    let loss = lossBase * stateDryMult;
    loss = Math.max(0, loss * rate.dryLossMult);

    if (f.Smax > 0 && Number.isFinite(before)){
      const sat = clamp(before / f.Smax, 0, 1);
      if (sat < tune.DRY_TAIL_START){
        const frac = clamp(sat / Math.max(1e-6, tune.DRY_TAIL_START), 0, 1);
        const mult = tune.DRY_TAIL_MIN_MULT + (1 - tune.DRY_TAIL_MIN_MULT) * frac;
        loss = loss * mult;
      }
    }

    const after = clamp(before + add - loss, 0, f.Smax);
    storage = after;

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

  const storagePhysFinal = storage;

  const calRes = applyCalToStorage(storagePhysFinal, f.Smax, options);
  const storageEff = calRes.storageEff;

  const creditIn = signedCreditInchesFromSmax(f.Smax);
  const storageForReadiness = clamp(storageEff - creditIn, 0, f.Smax);

  const wetness = (f.Smax > 0) ? clamp((storageForReadiness / f.Smax) * 100, 0, 100) : 0;
  const readiness = clamp(100 - wetness, 0, 100);

  const wetnessR = roundInt(wetness);
  const readinessR = roundInt(readiness);

  const last7 = trace.slice(-7);
  const avgLossDay = last7.length ? (last7.reduce((s,x)=> s + x.loss, 0) / last7.length) : 0.08;

  return {
    factors: f,
    rows: rowsNorm,
    trace,

    storagePhysFinal,
    storageFinal: storageEff,

    wetness,
    readiness,
    wetnessR,
    readinessR,
    avgLossDay,

    readinessCreditIn: creditIn,
    storageForReadiness,

    seedSource: seedPick.source,
    calRes
  };
}
