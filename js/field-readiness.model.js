/* =====================================================================
/Farm-vista/js/field-readiness.model.js  (FULL FILE)
Rev: 2025-12-31a
Model math (dry power, storage, readiness) + helpers

What changed (Option A: saturation-aware effective rain):
✅ Rain now depends on antecedent saturation (bucket level BEFORE rain):
   - When already wet/saturated => more runoff (less rain counts)
   - When very dry => more “bypass” (rain doesn’t keep top wet as long)
✅ DrainageIndex influences both:
   - Poor drainage => MORE runoff + LESS bypass (sticks around more)
   - Good drainage => LESS runoff + MORE bypass (leaves top sooner)

TUNING:
✅ All tweakable variables are listed together below in FV_TUNE.
   - Change these numbers to adjust behavior without touching model math.

Calibration hook (unchanged):
✅ Optional wetBias applied AFTER physics model:
   - deps.CAL.wetBias (number, wetness points; + = wetter, - = drier)
   - deps.CAL.opWetBias[opKey] (optional per-op wetBias)
   - deps.opKey (optional current operation key)
===================================================================== */
'use strict';

function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }

/* =====================================================================
   FV_TUNE — ALL ADJUSTABLE VARIABLES (Option A)
   ------------------------------------------------
   These are the knobs you tweak.

   1) SAT_RUNOFF_START
      - Saturation (0..1) where runoff begins ramping up.
      - Higher => allow more rain to count before runoff.
      - Lower  => fields “top out” sooner in wet spells.

   2) RUNOFF_EXP
      - Shape of runoff ramp after SAT_RUNOFF_START.
      - Higher => sharper cliff near saturation.
      - Lower  => smoother ramp.

   3) RUNOFF_DRAINPOOR_W
      - How much poor drainage INCREASES runoff (multiplier effect).
      - 0.35 means poor drainage increases runoff up to +35%.

   4) DRY_BYPASS_END
      - Saturation (0..1) below which “dry bypass” is active.
      - Higher => bypass affects a wider range of dry conditions.
      - Lower  => bypass only when truly very dry.

   5) DRY_EXP
      - Shape of bypass curve as it approaches bone-dry.
      - Higher => bypass spikes strongly at very dry conditions.

   6) DRY_BYPASS_BASE
      - Max fraction of post-runoff rain that can bypass the “top bucket”
        when extremely dry (0..1). Example: 0.45 => up to 45% bypass.

   7) BYPASS_GOODDRAIN_W
      - Good drainage (low drainPoor) increases bypass.
      - 0.15 means very good drainage can increase bypass up to +15%.

   8) SAT_DRYBYPASS_FLOOR
      - Minimum saturation used inside bypass math (avoid extreme behavior).
      - Raise to reduce “too much bypass” spikes.

   9) SAT_RUNOFF_CAP
      - Max runoff fraction allowed (guardrail).
      - 0.85 means even in extreme saturation, at least 15% of rain can count.

   10) RAIN_EFF_MIN
      - Minimum effective rain fraction (guardrail) after runoff+bypass.
      - 0.05 means at least 5% of measured rain always counts.

   Notes:
   - “drainPoor” in this model = drainageIndex/100
     (1 = poorer drainage, 0 = better drainage)
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
  RAIN_EFF_MIN: 0.05
};

// Allows ops to override without editing file:
// - deps.EXTRA can include any FV_TUNE keys to override.
// - or deps.FV_TUNE can be passed directly.
function getTune(deps){
  const t = { ...FV_TUNE };
  const srcA = (deps && deps.FV_TUNE && typeof deps.FV_TUNE === 'object') ? deps.FV_TUNE : null;
  const srcB = (deps && deps.EXTRA && typeof deps.EXTRA === 'object') ? deps.EXTRA : null;

  // Apply overrides from FV_TUNE first, then EXTRA
  for (const src of [srcA, srcB]){
    if (!src) continue;
    for (const k of Object.keys(t)){
      if (src[k] === null || src[k] === undefined) continue;
      const v = Number(src[k]);
      if (isFinite(v)) t[k] = v;
    }
  }

  // Clamp obvious ranges
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

  return t;
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
  const soilHold = clamp(Number(soilWetness0_100) / 100, 0, 1);
  const drainPoor= clamp(Number(drainageIndex0_100) / 100, 0, 1);

  const smN = (sm010===null || sm010===undefined || !isFinite(Number(sm010)))
    ? 0
    : clamp((Number(sm010) - 0.10) / 0.25, 0, 1);

  // Note: these were your existing mappings. Keeping intact.
  const infilMult = 0.60 + 0.30*soilHold + 0.35*drainPoor;
  const dryMult   = 1.20 - 0.35*soilHold - 0.40*drainPoor;

  const SmaxBase  = 2.60 + 1.00*soilHold + 0.90*drainPoor;
  const Smax      = SmaxBase * (1 + EXTRA.STORAGE_CAP_SM010_W * smN);

  return { soilHold, drainPoor, smN, infilMult, dryMult, Smax, SmaxBase };
}

/* =====================================================================
   Calibration hook (unchanged)
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

/* =====================================================================
   NEW: Saturation-aware rain effectiveness (Option A)
===================================================================== */
function effectiveRainInches(rainIn, storageBefore, Smax, factors, tune){
  const rain = Math.max(0, Number(rainIn||0));
  if (!rain || !isFinite(rain) || !isFinite(storageBefore) || !isFinite(Smax) || Smax <= 0) return 0;

  // Antecedent saturation
  const satRaw = storageBefore / Smax;
  const sat = clamp(satRaw, 0, 1);

  // Poor drainage (1) = more runoff, less bypass; good drainage (0) = less runoff, more bypass
  const drainPoor = clamp(Number(factors && factors.drainPoor), 0, 1);

  // --- Runoff when saturated ---
  const sr = clamp((sat - tune.SAT_RUNOFF_START) / Math.max(1e-6, (1 - tune.SAT_RUNOFF_START)), 0, 1);
  let runoffFrac = Math.pow(sr, tune.RUNOFF_EXP);

  // Poor drainage increases runoff (up to +RUNOFF_DRAINPOOR_W)
  runoffFrac = runoffFrac * (1 + tune.RUNOFF_DRAINPOOR_W * drainPoor);
  runoffFrac = clamp(runoffFrac, 0, tune.SAT_RUNOFF_CAP);

  const rainAfterRunoff = rain * (1 - runoffFrac);

  // --- Dry bypass when very dry ---
  // Bypass strongest when sat is near 0, fades to 0 by DRY_BYPASS_END.
  const satB = Math.max(tune.SAT_DRYBYPASS_FLOOR, sat);
  const db = clamp((tune.DRY_BYPASS_END - satB) / Math.max(1e-6, tune.DRY_BYPASS_END), 0, 1);
  const dryBypassCurve = Math.pow(db, tune.DRY_EXP);

  // Base bypass fraction, then adjust for drainage:
  // good drainage (low drainPoor) increases bypass
  const goodDrain = 1 - drainPoor;
  let bypassFrac = tune.DRY_BYPASS_BASE * dryBypassCurve * (1 + tune.BYPASS_GOODDRAIN_W * goodDrain);
  bypassFrac = clamp(bypassFrac, 0, 0.90);

  const rainEffective = rainAfterRunoff * (1 - bypassFrac);

  // Guardrail: ensure some small portion always counts if rain occurred
  const minEff = tune.RAIN_EFF_MIN * rain;
  return Math.max(minEff, rainEffective);
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
 *   - FV_TUNE: override tuning variables in this file
 */
export function runField(field, deps){
  const wx = deps.getWeatherSeriesForFieldId(field.id);
  if (!wx.length) return null;

  const p = deps.getFieldParams(field.id);

  const last = wx[wx.length-1] || {};
  const f = mapFactors(p.soilWetness, p.drainageIndex, last.sm010, deps.EXTRA);

  const tune = getTune(deps);

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
  // Existing tuning: rain nudge + starting storage baseline (unchanged)
  // -------------------------------------------------------------------
  const first7 = rows.slice(0,7);
  const rain7 = first7.reduce((s,x)=> s + Number(x.rainInAdj||0), 0);

  const rainNudgeFrac = clamp(rain7 / 8.0, 0, 1);
  const rainNudge = rainNudgeFrac * (0.1 * f.Smax);

  let storage = clamp((0.30 * f.Smax) + rainNudge, 0, f.Smax);

  const trace = [];
  for (const d of rows){
    const rain = Number(d.rainInAdj||0);

    const before = storage;

    // ✅ NEW: saturation-aware effective rain inches
    const rainEff = effectiveRainInches(rain, before, f.Smax, f, tune);

    // Base add from effective rain
    let add = rainEff * f.infilMult;

    // Keep your SM010 helper term intact
    add += (deps.EXTRA.ADD_SM010_W * d.smN_day) * 0.05;

    const loss = Number(d.dryPwr||0) * deps.LOSS_SCALE * f.dryMult * (1 + deps.EXTRA.LOSS_ET0_W * d.et0N);

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

  // Physical wetness (0..100)
  let wetness = clamp((storage / f.Smax) * 100, 0, 100);

  // ✅ Calibration wetness bias (unchanged)
  const wetBias = clamp(getWetBiasFromDeps(deps), -25, 25);
  wetness = clamp(wetness + wetBias, 0, 100);

  const wetnessR = Math.round(wetness);
  const readinessR = Math.round(clamp(100 - wetness, 0, 100));

  const last7 = trace.slice(-7);
  const avgLossDay = last7.length ? (last7.reduce((s,x)=> s + x.loss, 0) / last7.length) : 0.08;

  return {
    field,
    factors: f,
    rows,
    trace,
    storageFinal: storage,
    wetnessR,
    readinessR,
    avgLossDay,

    // helpful for debugging calibration
    wetBiasApplied: wetBias,

    // helpful for debugging tuning
    tuneUsed: tune
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
