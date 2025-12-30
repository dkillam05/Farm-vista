/* =====================================================================
/Farm-vista/js/field-readiness.model.js  (FULL FILE)
Rev: 2025-12-28a
Model math (dry power, storage, readiness) + helpers

TUNING (per Dane):
✅ Reduce "too wet" baseline by lowering starting storage
✅ Reduce rain nudge strength so fields don't default overly wet

NEW (Calibration hook):
✅ Optional calibration bias applied AFTER physics model:
   - deps.CAL.wetBias (number, wetness points; + = wetter, - = drier)
   - deps.CAL.opWetBias[opKey] (optional per-op wetBias)
   - deps.opKey (optional current operation key)
===================================================================== */
'use strict';

function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }

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
  const soilHold = clamp(Number(soilWetness0_100) / 100, 0, 1);
  const drainPoor= clamp(Number(drainageIndex0_100) / 100, 0, 1);

  const smN = (sm010===null || sm010===undefined || !isFinite(Number(sm010)))
    ? 0
    : clamp((Number(sm010) - 0.10) / 0.25, 0, 1);

  const infilMult = 0.60 + 0.30*soilHold + 0.35*drainPoor;
  const dryMult   = 1.20 - 0.35*soilHold - 0.40*drainPoor;

  const SmaxBase  = 2.60 + 1.00*soilHold + 0.90*drainPoor;
  const Smax      = SmaxBase * (1 + EXTRA.STORAGE_CAP_SM010_W * smN);

  return { soilHold, drainPoor, smN, infilMult, dryMult, Smax, SmaxBase };
}

/* =====================================================================
   Calibration hook
   - We keep the physical model intact
   - Apply a small bias to wetness AFTER storage/Smax computed
   - Bias units are "wetness points" (0..100 scale)
===================================================================== */
function getWetBiasFromDeps(deps){
  try{
    const CAL = deps && deps.CAL ? deps.CAL : null;
    if (!CAL || typeof CAL !== 'object') return 0;

    const opKey = (deps && typeof deps.opKey === 'string') ? deps.opKey : '';

    // optional per-op override
    if (opKey && CAL.opWetBias && typeof CAL.opWetBias === 'object'){
      const vOp = CAL.opWetBias[opKey];
      if (isFinite(Number(vOp))) return Number(vOp);
    }

    // global bias
    const v = CAL.wetBias;
    if (isFinite(Number(v))) return Number(v);

    return 0;
  }catch(_){
    return 0;
  }
}

/**
 * runField(field, deps)
 * deps:
 * - getWeatherSeriesForFieldId(fieldId) -> daily series
 * - getFieldParams(fieldId) -> { soilWetness, drainageIndex }
 * - LOSS_SCALE
 * - EXTRA (object)
 * - OPTIONAL:
 *   - opKey (string): current operation key (for per-op bias)
 *   - CAL: { wetBias?: number, opWetBias?: { [opKey]: number } }
 */
export function runField(field, deps){
  const wx = deps.getWeatherSeriesForFieldId(field.id);
  if (!wx.length) return null;

  const p = deps.getFieldParams(field.id);

  const last = wx[wx.length-1] || {};
  const f = mapFactors(p.soilWetness, p.drainageIndex, last.sm010, deps.EXTRA);

  const rows = wx.map(w=>{
    const parts = calcDryParts(w, deps.EXTRA);

    const et0 = (w.et0In===null || w.et0In===undefined) ? null : Number(w.et0In);
    const et0N = (et0===null || !isFinite(et0)) ? 0 : clamp(et0 / 0.30, 0, 1);

    const smN = (w.sm010===null || w.sm010===undefined || !isFinite(Number(w.sm010)))
      ? 0
      : clamp((Number(w.sm010)-0.10)/0.25, 0, 1);

    return {
      ...w,
      rainInAdj: Number(w.rainIn||0),
      et0: (isFinite(et0)?et0:0),
      et0N,
      smN_day: smN,
      ...parts
    };
  });

  // -------------------------------------------------------------------
  // TUNING: rain nudge + starting storage baseline
  // New: rain7/8.0 and 0.10*Smax (softer) + start at 0.30*Smax (drier baseline)
  // -------------------------------------------------------------------
  const first7 = rows.slice(0,7);
  const rain7 = first7.reduce((s,x)=> s + Number(x.rainInAdj||0), 0);

  const rainNudgeFrac = clamp(rain7 / 7.0, 0, 1);
  const rainNudge = rainNudgeFrac * (0.18 * f.Smax);

  let storage = clamp((0.30 * f.Smax) + rainNudge, 0, f.Smax);

  const trace = [];
  for (const d of rows){
    const rain = Number(d.rainInAdj||0);

    let add = rain * f.infilMult;
    add += (deps.EXTRA.ADD_SM010_W * d.smN_day) * 0.05;

    const loss = Number(d.dryPwr||0) * deps.LOSS_SCALE * f.dryMult * (1 + deps.EXTRA.LOSS_ET0_W * d.et0N);

    const before = storage;
    const after = clamp(before + add - loss, 0, f.Smax);
    storage = after;

    trace.push({ dateISO:d.dateISO, rain, infilMult:f.infilMult, add, dryPwr:d.dryPwr, loss, before, after });
  }

  // Physical wetness (0..100)
  let wetness = clamp((storage / f.Smax) * 100, 0, 100);

  // ✅ Calibration wetness bias (from adjustments aggregation via deps.CAL)
  // Positive = wetter, Negative = drier
  const wetBias = clamp(getWetBiasFromDeps(deps), -25, 25); // guardrail
  wetness = clamp(wetness + wetBias, 0, 100);

  const wetnessR = Math.round(wetness);
  const readinessR = Math.round(clamp(100 - wetness, 0, 100));

  const last7 = trace.slice(-7);
  const avgLossDay = last7.length ? (last7.reduce((s,x)=> s + x.loss, 0) / last7.length) : 0.08;

  return {
    field,
    factors:f,
    rows,
    trace,
    storageFinal:storage,
    wetnessR,
    readinessR,
    avgLossDay,

    // helpful for debugging calibration
    wetBiasApplied: wetBias
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
  if (run.readinessR >= threshold) return '';

  const wetTarget = clamp(100 - threshold, 0, 100);
  const storageTarget = run.factors.Smax * (wetTarget / 100);
  const delta = run.storageFinal - storageTarget;

  if (!isFinite(delta) || delta <= 0) return '';

  const dailyLoss = Math.max(0.02, run.avgLossDay);
  let hours = Math.ceil((delta / dailyLoss) * 24);

  if (!isFinite(hours) || hours <= 0) hours = 1;

  if (hours > ETA_MAX_HOURS) return `> ${ETA_MAX_HOURS} hours`;
  return `Est: ~${hours} hours`;
}
