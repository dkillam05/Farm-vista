/* =====================================================================
/Farm-vista/js/field-readiness.model.js  (FULL FILE)
Rev: 2026-02-10b-option1-model-eta-truth-consistent-legacy-etaFor-disabled-compat

OPTION 1 (per Dane):
✅ Model owns ETA and computes it from the SAME truth-seeded run + SAME physics.
✅ Forward sim uses forecast daily rows when available (dailySeriesFcst).
✅ No legacy ETA math (avgLossDay shortcut) anywhere.
✅ Legacy etaFor() is kept ONLY as a compatibility stub returning '' (blank),
   so older callers won't crash while we wire quickview/details to model ETA.

ETA output format:
- Within horizon: "~XXh"
- Beyond horizon: ">168h"
- Already ready: "" (blank)
- No forecast cached: "" (blank; caller can choose to display a message)

IMPORTANT:
- Truth seed (storageFinal + asOfDateISO) still anchors "now"
- Learning (EXTRA.DRY_LOSS_MULT) still applies to drying physics
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
  const signed = clamp((SMAX_MID - s) / 1.0, -1, 1); // +1 at 3, 0 at 4, -1 at 5
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

  SAT_DRYBYPASS_FLOOR: 0.02,
  SAT_RUNOFF_CAP: 0.85,
  RAIN_EFF_MIN: 0.05,

  DRY_TAIL_START: 0.12,
  DRY_TAIL_MIN_MULT: 0.55
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

  t.SAT_DRYBYPASS_FLOOR= clamp(t.SAT_DRYBYPASS_FLOOR, 0.0, 0.20);
  t.SAT_RUNOFF_CAP     = clamp(t.SAT_RUNOFF_CAP, 0.20, 0.95);
  t.RAIN_EFF_MIN       = clamp(t.RAIN_EFF_MIN, 0.0, 0.20);

  t.DRY_TAIL_START     = clamp(t.DRY_TAIL_START, 0.03, 0.30);
  t.DRY_TAIL_MIN_MULT  = clamp(t.DRY_TAIL_MIN_MULT, 0.20, 1.00);

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
  const soilHoldRaw = safePct01(soilWetness0_100);
  const drainPoorRaw= safePct01(drainageIndex0_100);

  const soilHold = snap01(soilHoldRaw);
  const drainPoor= snap01(drainPoorRaw);

  const smN = (sm010===null || sm010===undefined || !isFinite(Number(sm010)))
    ? 0
    : clamp((Number(sm010) - 0.10) / 0.25, 0, 1);

  const infilMult = 0.60 + 0.30*soilHold + 0.35*drainPoor;
  const dryMult   = 1.20 - 0.35*soilHold - 0.40*drainPoor;

  // Tank: 3..5 hard endpoints
  const SmaxBase = 3.00 + 1.00*soilHold + 1.00*drainPoor;
  const Smax = clamp(SmaxBase, 3.00, 5.00);

  return { soilHold, drainPoor, smN, infilMult, dryMult, Smax, SmaxBase };
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
   Persisted state helpers
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
    return { seedStorage: b.storage0, startIdx };
  }

  if (mode === 'persisted'){
    const persisted = getPersistedState(deps, fieldId);
    if (persisted && isFinite(Number(persisted.storageFinal)) && persisted.asOfDateISO){
      const asOf = String(persisted.asOfDateISO).slice(0,10);
      const idx = rows.findIndex(r => String(r.dateISO||'').slice(0,10) === asOf);
      if (idx >= 0){
        return { seedStorage: clamp(Number(persisted.storageFinal), 0, f.Smax), startIdx: idx + 1 };
      }
    }
  }

  const b0 = baselineSeedFromWindow(rows, f);
  return { seedStorage: b0.storage0, startIdx: 0 };
}

/* =====================================================================
   Readiness from physical storage (truth-consistent)
===================================================================== */
function computeReadinessFromStorage(storagePhys, f, deps){
  const calRes = applyCalToStorage(storagePhys, f.Smax, deps);
  const storageEff = calRes.storageEff;

  // Symmetric extreme slider effect (readiness derivation only)
  const creditIn = signedCreditInchesFromSmax(f.Smax);
  const storageForReadiness = clamp(storageEff - creditIn, 0, f.Smax);

  const wetness = (f.Smax > 0) ? clamp((storageForReadiness / f.Smax) * 100, 0, 100) : 0;
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
   Sub-daily forward simulation (Option 1 ETA)
===================================================================== */
function lerp(a,b,t){ return a + (b-a)*t; }
function toNum(v, d=0){
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

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
    dateISO: String(a.dateISO || b.dateISO || '').slice(0,10),
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

function normalizeDailyRowForSim(w, EXTRA){
  const parts = calcDryParts(w, EXTRA);

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

/**
 * Model-owned ETA (Option 1).
 * Requires caller to provide forecast via deps.getForecastSeriesForFieldId(fieldId)
 * OR deps.getWxSeriesWithForecastForFieldId(fieldId).
 */
export async function etaToThreshold(field, deps, threshold, horizonHours=168, stepHours=3){
  try{
    if (!field || !deps) return { ok:false, status:'noData', hours:null, text:'' };

    const thr = clamp(Number(threshold||0), 0, 100);
    const H = clamp(Number(horizonHours||168), 1, 360);
    const stepH = clamp(Number(stepHours||3), 1, 12);

    const run = runField(field, deps);
    if (!run) return { ok:false, status:'noData', hours:null, text:'' };

    // Already ready
    if (Number(run.readinessR) >= thr){
      return { ok:true, status:'dryNow', hours:0, text:'' };
    }

    // Get forecast
    let fcstDaily = [];
    if (deps && typeof deps.getForecastSeriesForFieldId === 'function'){
      const got = await deps.getForecastSeriesForFieldId(String(field.id));
      fcstDaily = Array.isArray(got) ? got.slice() : [];
    }

    // Optional: if a caller provides combined series, split it
    if (!fcstDaily.length && deps && typeof deps.getWxSeriesWithForecastForFieldId === 'function'){
      const all = await deps.getWxSeriesWithForecastForFieldId(String(field.id));
      const sp = splitHistFcstFromWx(all);
      fcstDaily = sp.fcst || [];
    }

    if (!fcstDaily.length){
      return { ok:true, status:'noForecast', hours:null, text:'' };
    }

    const fcst = fcstDaily
      .filter(d => d && d.dateISO)
      .slice(0, 16)
      .map(d=> normalizeDailyRowForSim(d, deps.EXTRA || {}));

    if (!fcst.length){
      return { ok:true, status:'noForecast', hours:null, text:'' };
    }

    const f = run.factors;
    const tune = getTune(deps);
    const rate = getRateMults(deps);

    // Starting physical storage is the history-sim final storage (truth physics)
    let storagePhys = Number.isFinite(Number(run.storagePhysFinal))
      ? Number(run.storagePhysFinal)
      : Number(run.storageFinal || 0);

    storagePhys = clamp(storagePhys, 0, f.Smax);

    const nowR = computeReadinessFromStorage(storagePhys, f, deps).readiness;
    if (Number(nowR) >= thr){
      return { ok:true, status:'dryNow', hours:0, text:'' };
    }

    const steps = Math.ceil(H / stepH);

    let prevR = Number(nowR);
    let prevT = 0;

    for (let s=1; s<=steps; s++){
      const tHours = Math.min(H, s * stepH);
      const dayFloat = tHours / 24;
      const i = Math.floor(dayFloat);
      const frac = dayFloat - i;

      const d0 = fcst[Math.min(i, fcst.length - 1)];
      const d1 = fcst[Math.min(i + 1, fcst.length - 1)];
      const row = interpDayRow(d0, d1, frac);

      const stepRain = (toNum(row.rainIn, 0) / 24) * stepH;

      const parts = calcDryParts(row, deps.EXTRA || {});

      const et0 = (row.et0In===null || row.et0In===undefined) ? null : Number(row.et0In);
      const et0N = (et0===null || !isFinite(et0)) ? 0 : clamp(et0 / 0.30, 0, 1);

      const smN = (row.sm010===null || row.sm010===undefined || !isFinite(Number(row.sm010)))
        ? 0
        : clamp((Number(row.sm010)-0.10)/0.25, 0, 1);

      const before = storagePhys;

      let rainEff = effectiveRainInches(stepRain, before, f.Smax, f, tune);
      rainEff = clamp(rainEff * rate.rainEffMult, 0, 1000);

      let add = rainEff * f.infilMult;
      add += ((deps.EXTRA.ADD_SM010_W * smN) * 0.05) * (stepH / 24);

      let lossDay = Number(parts.dryPwr||0) * deps.LOSS_SCALE * f.dryMult * (1 + deps.EXTRA.LOSS_ET0_W * et0N);
      let loss = Math.max(0, lossDay * (stepH / 24));
      loss = Math.max(0, loss * rate.dryLossMult);

      // Dry tail
      if (f.Smax > 0 && isFinite(before)){
        const sat = clamp(before / f.Smax, 0, 1);
        if (sat < tune.DRY_TAIL_START){
          const frac2 = clamp(sat / Math.max(1e-6, tune.DRY_TAIL_START), 0, 1);
          const mult = tune.DRY_TAIL_MIN_MULT + (1 - tune.DRY_TAIL_MIN_MULT) * frac2;
          loss = loss * mult;
        }
      }

      storagePhys = clamp(before + add - loss, 0, f.Smax);

      const rNow = computeReadinessFromStorage(storagePhys, f, deps).readiness;

      if (prevR < thr && rNow >= thr){
        const denom = rNow - prevR;
        const fracCross = denom <= 1e-6 ? 1 : clamp((thr - prevR) / denom, 0, 1);
        const eta = prevT + fracCross * (tHours - prevT);
        const hrs = Math.max(0, Math.round(eta));

        if (hrs <= H) return { ok:true, status:'within', hours:hrs, text:`~${hrs}h` };
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

    trace.push({ dateISO: d.dateISO, before, after, rain, rainEff, add, loss, dryPwr: d.dryPwr });
  }

  // Physical storage final (truth physics)
  const storagePhysFinal = storage;

  // Derive readiness from cal + symmetric slider credit
  const calRes = applyCalToStorage(storagePhysFinal, f.Smax, deps);
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
    field,
    factors: f,
    rows,
    trace,

    storagePhysFinal,          // ✅ physical storage used by physics + ETA
    storageFinal: storageEff,  // effective storage after cal (kept name)

    wetnessR,
    readinessR,
    avgLossDay,

    // debug
    readinessCreditIn: creditIn,
    storageForReadiness
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
 * Legacy ETA function (COMPAT STUB ONLY):
 * - returns blank so no legacy ETA ever shows
 * - kept temporarily so older imports don't crash
 */
export function etaFor(_run, _threshold, _ETA_MAX_HOURS){
  return '';
}