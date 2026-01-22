/* =====================================================================
/Farm-vista/js/field-readiness.model.js  (FULL FILE)
Rev: 2026-01-22f-storage-truth-rewind14-rateTuning-dryTailFix-impactFactor-intReadiness-Smax3to5-hardEndpoints

CHANGES:
✅ Readiness whole numbers only
✅ Tank size (Smax) now has HARD endpoints:
   - sliders 0/0 => Smax EXACTLY 3.0
   - sliders 100/100 => Smax EXACTLY 5.0
✅ Smax is now ONLY based on the two sliders (no SM010 influence)
✅ Snap slider values near ends to true 0/100 so every field matches
===================================================================== */
'use strict';

function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
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
  // Hard endpoint snapping so 0/100 is truly 3.0/5.0 for ALL fields
  const v = Number(x);
  if (!Number.isFinite(v)) return 0;
  if (v <= 0.01) return 0;
  if (v >= 0.99) return 1;
  return v;
}

/* =====================================================================
   FV_TUNE — ALL ADJUSTABLE VARIABLES (Option A)
===================================================================== */
const FV_TUNE = {
  // Wet spell / saturation behavior
  SAT_RUNOFF_START: 0.75,
  RUNOFF_EXP: 2.2,
  RUNOFF_DRAINPOOR_W: 0.35,   // poor drainage increases runoff

  // Dry spell behavior
  DRY_BYPASS_END: 0.35,
  DRY_EXP: 1.6,
  DRY_BYPASS_BASE: 0.45,      // max bypass when extremely dry
  BYPASS_GOODDRAIN_W: 0.15,   // good drainage increases bypass

  // Guardrails / stability
  SAT_DRYBYPASS_FLOOR: 0.02,
  SAT_RUNOFF_CAP: 0.85,
  RAIN_EFF_MIN: 0.05,

  // Dry tail easing (prevents "cap-like" pile-ups at very dry end)
  DRY_TAIL_START: 0.12,       // fraction of Smax where taper begins
  DRY_TAIL_MIN_MULT: 0.55     // minimum loss multiplier at extreme dry
};

// Allows ops to override without editing file:
// - deps.EXTRA can include any FV_TUNE keys to override.
// - or deps.FV_TUNE can be passed directly.
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

  t.SAT_DRYBYPASS_FLOOR= clamp(t.SAT_DRYBYPASS_FLOOR, 0.0, 0.20);
  t.SAT_RUNOFF_CAP     = clamp(t.SAT_RUNOFF_CAP, 0.20, 0.95);
  t.RAIN_EFF_MIN       = clamp(t.RAIN_EFF_MIN, 0.0, 0.20);

  t.DRY_TAIL_START     = clamp(t.DRY_TAIL_START, 0.03, 0.30);
  t.DRY_TAIL_MIN_MULT  = clamp(t.DRY_TAIL_MIN_MULT, 0.20, 1.00);

  return t;
}

/* =====================================================================
   Rate tuning multipliers (learning hooks)
===================================================================== */
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

/* ===================================================================== */

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

  const tempN = clamp((temp - 20) / 45, 0, 1);
  const windN = clamp((wind - 2) / 20, 0, 1);
  const solarN= clamp((solar - 60) / 300, 0, 1);
  const rhN   = clamp((rh - 35) / 65, 0, 1);

  const rawBase = (0.35*tempN + 0.30*solarN + 0.25*windN - 0.25*rhN);
  let dryPwr = clamp(rawBase, 0, 1);

  const vpd = (r.vpdKpa===null || r.vpdKpa===undefined) ? null : Number(r.vpdKpa);
  const cloud = (r.cloudPct===null || r.cloudPct===undefined) ? null : Number(r.cloudPct);

  const vpdN = (vpd===null || !isFinite(vpd)) ? 0 : clamp(vpd / 2.6, 0, 1);
  const cloudN = (cloud===null || !isFinite(cloud)) ? 0 : clamp(cloud / 100, 0, 1);

  dryPwr = clamp(dryPwr + EXTRA.DRYPWR_VPD_W * vpdN - EXTRA.DRYPWR_CLOUD_W * cloudN, 0, 1);

  return {
    temp, wind, rh, solar,
    tempN, windN, rhN, solarN,
    vpd: (isFinite(vpd)?vpd:0),
    vpdN,
    cloud: (isFinite(cloud)?cloud:0),
    cloudN,
    raw: rawBase,
    dryPwr
  };
}

export function mapFactors(soilWetness0_100, drainageIndex0_100, sm010, EXTRA){
  // Sliders -> 0..1, with hard snapping at ends
  const soilHoldRaw = safePct01(soilWetness0_100);
  const drainPoorRaw= safePct01(drainageIndex0_100);

  const soilHold = snap01(soilHoldRaw);
  const drainPoor= snap01(drainPoorRaw);

  const smN = (sm010===null || sm010===undefined || !isFinite(Number(sm010)))
    ? 0
    : clamp((Number(sm010) - 0.10) / 0.25, 0, 1);

  // Existing mappings (kept)
  const infilMult = 0.60 + 0.30*soilHold + 0.35*drainPoor;
  const dryMult   = 1.20 - 0.35*soilHold - 0.40*drainPoor;

  // ============================================================
  // Smax HARD endpoints: ONLY sliders control tank size.
  //  soilHold=0 & drainPoor=0 => 3.0 exactly
  //  soilHold=1 & drainPoor=1 => 5.0 exactly
  // ============================================================
  const SmaxBase = 3.00 + 1.00*soilHold + 1.00*drainPoor; // exact 3..5
  const Smax = clamp(SmaxBase, 3.00, 5.00);

  // ============================================================
// STRONG PARTIAL REVERSAL (per Dane)
// Goal: when sliders go DOWN (smaller tank), readiness goes UP.
// We implement this by making impactFactor DECREASE as the tank grows.
//
// Implementation:
// - "tightness" = how small the tank is relative to 3..5 range
// - tightness = 0 when Smax=5.0, tightness=1 when Smax=3.0
// - Convert to a wetness multiplier range that yields up to +15 readiness points.
//   If wetness is scaled by (1 - K*tightness), readiness increases.
// ============================================================
const tightness = clamp((5.00 - Smax) / 2.00, 0, 1); // 0..1 (5->0, 3->1)

// Strong max boost = +15 readiness points at tightness=1.
// That corresponds to reducing wetness by 15 points (out of 100),
// so wetnessMult min = 0.85.
const wetnessMult = 1.00 - (0.15 * tightness); // 1.00..0.85

// Keep the same field-driven influence, but REVERSED:
// when sliders are higher (soilHold/drainPoor higher), slightly MORE wetness impact,
// when sliders lower, slightly LESS.
const subtle = clamp(
  1.00 + (0.03 * (soilHold + drainPoor - 1.0)), // ~0.97..1.03
  0.95,
  1.05
);

// Final impactFactor applied to wetness
const impactFactor = clamp(wetnessMult * subtle, 0.85, 1.05);


  return { soilHold, drainPoor, smN, infilMult, dryMult, Smax, SmaxBase, impactFactor };
}

/* =====================================================================
   Calibration hooks (applied to STORAGE)
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
   Saturation-aware rain effectiveness
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

  const rainEffective = rainAfterRunoff * (1 - bypassFrac);

  const minEff = tune.RAIN_EFF_MIN * rain;
  return Math.max(minEff, rainEffective);
}

/* =====================================================================
   Persisted state helpers (STATEFUL OPTION 1)
===================================================================== */
function isoDay(iso){
  if (!iso) return '';
  const s = String(iso);
  return (s.length >= 10) ? s.slice(0,10) : s;
}

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

function buildStateOut(fieldId, storageFinal, asOfDateISO, f){
  return {
    fieldId: String(fieldId || ''),
    storageFinal: Number(storageFinal || 0),
    asOfDateISO: isoDay(asOfDateISO || ''),
    SmaxAtSave: Number(f && f.Smax ? f.Smax : 0)
  };
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

  return { storage0, rain7, rainNudgeFrac, rainNudge };
}

function pickSeed(rows, f, deps, fieldId){
  const mode = getSeedMode(deps);

  const firstDate = rows.length ? isoDay(rows[0].dateISO) : '';
  const lastDate  = rows.length ? isoDay(rows[rows.length-1].dateISO) : '';

  if (mode === 'rewind'){
    const N = getRewindDays(deps);
    const startIdx = Math.max(0, rows.length - N);

    const windowRows = rows.slice(startIdx);
    const b = baselineSeedFromWindow(windowRows, f);

    return {
      seedMethod: 'rewind_baseline',
      seedStorage: b.storage0,
      startIdx,
      seedDebug: {
        rewindDays: N,
        startIdx,
        firstDateISO: firstDate,
        lastDateISO: lastDate,
        rain7: b.rain7,
        rainNudgeFrac: b.rainNudgeFrac,
        rainNudge: b.rainNudge
      }
    };
  }

  if (mode === 'persisted'){
    const persisted = getPersistedState(deps, fieldId);

    if (persisted && isFinite(Number(persisted.storageFinal)) && persisted.asOfDateISO){
      const asOf = isoDay(persisted.asOfDateISO);

      if (lastDate && asOf > lastDate){
        return {
          seedMethod: 'persisted_no_sim',
          seedStorage: clamp(Number(persisted.storageFinal), 0, f.Smax),
          startIdx: rows.length,
          seedDebug: { asOfDateISO: asOf, firstDateISO: firstDate, lastDateISO: lastDate }
        };
      }

      const idx = rows.findIndex(r => isoDay(r.dateISO) === asOf);
      if (idx >= 0){
        return {
          seedMethod: 'persisted_storage',
          seedStorage: clamp(Number(persisted.storageFinal), 0, f.Smax),
          startIdx: idx + 1,
          seedDebug: { asOfDateISO: asOf, matchIdx: idx, firstDateISO: firstDate, lastDateISO: lastDate }
        };
      }

      if (firstDate && asOf < firstDate){
        // fall through to baseline
      }
    }
  }

  const b0 = baselineSeedFromWindow(rows, f);

  return {
    seedMethod: (mode === 'baseline') ? 'baseline_forced' : 'baseline_rain7_nudge',
    seedStorage: b0.storage0,
    startIdx: 0,
    seedDebug: { rain7: b0.rain7, rainNudgeFrac: b0.rainNudgeFrac, rainNudge: b0.rainNudge, firstDateISO: firstDate, lastDateISO: lastDate }
  };
}

/**
 * runField(field, deps)
 */
export function runField(field, deps){
  const wx = deps.getWeatherSeriesForFieldId(field.id);
  if (!wx || !wx.length) return null;

  const p = deps.getFieldParams(field.id);

  const last = wx[wx.length-1] || {};
  const f = mapFactors(p.soilWetness, p.drainageIndex, last.sm010, deps.EXTRA);

  const tune = getTune(deps);
  const rate = getRateMults(deps);

  const rows = wx.map(w=>{
    const parts = calcDryParts(w, deps.EXTRA);

    const et0 = (w.et0In===null || w.et0In===undefined) ? null : Number(w.et0In);
    const et0N = (et0===null || !isFinite(et0)) ? 0 : clamp(et0 / 0.30, 0, 1);

    const smN2 = (w.sm010===null || w.sm010===undefined || !isFinite(Number(w.sm010)))
      ? 0
      : clamp((Number(w.sm010)-0.10)/0.25, 0, 1);

    return {
      ...w,
      rainInAdj: Number(w.rainIn||0),
      et0: (isFinite(et0)?et0:0),
      et0N,
      smN_day: smN2,
      ...parts
    };
  });

  const seedPick = pickSeed(rows, f, deps, field.id);
  let storage = clamp(seedPick.seedStorage, 0, f.Smax);

  const trace = [];

  if (seedPick.startIdx >= rows.length){
    const calRes = applyCalToStorage(storage, f.Smax, deps);
    const storageEff = calRes.storageEff;

    const rawWetness = (f.Smax > 0) ? clamp((storageEff / f.Smax) * 100, 0, 100) : 0;
    const effWetness = clamp(rawWetness * Number(f.impactFactor || 1.0), 0, 100);

    const wetnessR = roundInt(effWetness);
    const readinessR = roundInt(clamp(100 - effWetness, 0, 100));

    const avgLossDay = 0.08;
    const lastDateISO = rows.length ? rows[rows.length-1].dateISO : '';

    return {
      field,
      factors: f,
      rows,
      trace,

      storageFinal: storageEff,

      wetnessR,
      readinessR,
      avgLossDay,

      wetBiasApplied: calRes.wetBiasApplied,
      readinessShiftApplied: calRes.readinessShiftApplied,
      wetnessDeltaApplied: calRes.wetnessDeltaApplied,
      storageDeltaApplied: calRes.storageDeltaApplied,

      dryLossMultApplied: rate.dryLossMult,
      rainEffMultApplied: rate.rainEffMult,

      tuneUsed: tune,

      rawWetnessPct: rawWetness,
      effWetnessPct: effWetness,
      impactFactorApplied: Number(f.impactFactor || 1.0),

      stateOut: buildStateOut(field.id, storageEff, (lastDateISO || seedPick.seedDebug.asOfDateISO || ''), f),

      seedDebug: {
        seedMethod: seedPick.seedMethod,
        seedStorage: seedPick.seedStorage,
        startIdx: seedPick.startIdx,
        ...(seedPick.seedDebug || {})
      }
    };
  }

  for (let i = seedPick.startIdx; i < rows.length; i++){
    const d = rows[i];
    const rain = Number(d.rainInAdj||0);

    const before = storage;

    let rainEff = effectiveRainInches(rain, before, f.Smax, f, tune);
    rainEff = clamp(rainEff * rate.rainEffMult, 0, 1000);

    let add = rainEff * f.infilMult;
    add += (deps.EXTRA.ADD_SM010_W * d.smN_day) * 0.05;

    let loss = Number(d.dryPwr||0) * deps.LOSS_SCALE * f.dryMult * (1 + deps.EXTRA.LOSS_ET0_W * d.et0N);
    loss = Math.max(0, loss * rate.dryLossMult);

    if (f.Smax > 0 && isFinite(before)){
      const sat = clamp(before / f.Smax, 0, 1);
      if (sat < tune.DRY_TAIL_START){
        const frac = clamp(sat / Math.max(1e-6, tune.DRY_TAIL_START), 0, 1);
        const mult = tune.DRY_TAIL_MIN_MULT + (1 - tune.DRY_TAIL_MIN_MULT) * frac;
        loss = loss * mult;
      }
    }

    const after = clamp(before + add - loss, 0, f.Smax);
    storage = after;

    trace.push({
      dateISO: d.dateISO,
      rain,
      rainEff,
      satBefore: (f.Smax>0 ? clamp(before/f.Smax,0,1) : 0),
      infilMult: f.infilMult,
      add,
      dryPwr: d.dryPwr,
      loss,
      before,
      after
    });
  }

  const calRes = applyCalToStorage(storage, f.Smax, deps);
  const storageEff = calRes.storageEff;

  const rawWetness = (f.Smax > 0) ? clamp((storageEff / f.Smax) * 100, 0, 100) : 0;
  const effWetness = clamp(rawWetness * Number(f.impactFactor || 1.0), 0, 100);

  const wetnessR = roundInt(effWetness);
  const readinessR = roundInt(clamp(100 - effWetness, 0, 100));

  const last7 = trace.slice(-7);
  const avgLossDay = last7.length ? (last7.reduce((s,x)=> s + x.loss, 0) / last7.length) : 0.08;

  const lastDateISO = rows.length ? rows[rows.length-1].dateISO : '';

  return {
    field,
    factors: f,
    rows,
    trace,

    storageFinal: storageEff,

    wetnessR,
    readinessR,
    avgLossDay,

    wetBiasApplied: calRes.wetBiasApplied,
    readinessShiftApplied: calRes.readinessShiftApplied,
    wetnessDeltaApplied: calRes.wetnessDeltaApplied,
    storageDeltaApplied: calRes.storageDeltaApplied,

    dryLossMultApplied: rate.dryLossMult,
    rainEffMultApplied: rate.rainEffMult,

    tuneUsed: tune,

    rawWetnessPct: rawWetness,
    effWetnessPct: effWetness,
    impactFactorApplied: Number(f.impactFactor || 1.0),

    stateOut: buildStateOut(field.id, storageEff, lastDateISO, f),

    seedDebug: {
      seedMethod: seedPick.seedMethod,
      seedStorage: seedPick.seedStorage,
      startIdx: seedPick.startIdx,
      ...(seedPick.seedDebug || {})
    }
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

export function etaFor(run, threshold, ETA_MAX_HOURS){
  if (!run) return '';

  if (Number(run.readinessR) >= Number(threshold)) return '';

  const Smax = run.factors && isFinite(Number(run.factors.Smax)) ? Number(run.factors.Smax) : 0;
  if (!isFinite(Smax) || Smax <= 0) return '';

  const wetTarget = clamp(100 - threshold, 0, 100);
  const storageTarget = Smax * (wetTarget / 100);

  const storageNow = isFinite(Number(run.storageFinal)) ? Number(run.storageFinal) : 0;

  const delta = storageNow - storageTarget;
  if (!isFinite(delta) || delta <= 0) return '';

  const dailyLoss = Math.max(0.02, Number(run.avgLossDay || 0.08));
  let hours = Math.ceil((delta / dailyLoss) * 24);

  if (!isFinite(hours) || hours <= 0) hours = 1;

  if (hours > ETA_MAX_HOURS) return `> ${ETA_MAX_HOURS} hours`;
  return `Est: ~${hours} hours`;
}
