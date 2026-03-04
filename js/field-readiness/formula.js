/* =====================================================================
/Farm-vista/js/field-readiness/formula.js  (NEW FILE)
Rev: 2026-03-04a-single-source-of-truth

PURPOSE:
✅ Single source of truth for Field Readiness computation wiring.
✅ render.js / quickview.js / global calibration should ALL use this module.

This module:
- Ensures model/weather/forecast modules are loaded
- Builds deps consistently:
  - weather series
  - field params
  - persisted truth seed (field_readiness_state)
  - CAL legacy adjustments => ALWAYS ZERO
  - EXTRA + CONST
  - optional forecast series (for ETA helper use)
- Calls model.runField(field, deps) and returns the run

NOTES:
- This DOES NOT change the math inside field-readiness.model.js.
- It standardizes the inputs so every UI gets the same output.
===================================================================== */
'use strict';

// Keep these aligned with render.js imports
import { EXTRA, CONST, buildWxCtx } from './state.js';
import { getFieldParams } from './params.js';
import { getCurrentOp, getThresholdForOp } from './thresholds.js';

/* =====================================================================
   Module loading (same approach as render.js)
===================================================================== */
const WEATHER_URL = '/Farm-vista/js/field-readiness.weather.js';
const MODEL_URL   = '/Farm-vista/js/field-readiness.model.js';

export async function ensureFRModules(state){
  if (!state) return;
  if (!state._mods) state._mods = {};
  if (state._mods.model && state._mods.weather && state._mods.forecast) return;

  const [weather, model, forecast] = await Promise.all([
    import(WEATHER_URL),
    import(MODEL_URL),
    import('./forecast.js')
  ]);

  state._mods.weather = weather;
  state._mods.model = model;
  state._mods.forecast = forecast;
}

/* =====================================================================
   CAL (FINAL): legacy adjustments disabled everywhere
===================================================================== */
function getCalZero(){
  return { wetBias: 0, opWetBias: {}, readinessShift: 0, opReadinessShift: {} };
}

/* =====================================================================
   Persisted truth seed helpers

IMPORTANT:
This module does NOT decide HOW you load persisted state.
It expects the caller to have already loaded state.persistedStateByFieldId
(or provide a getter).
That way we don't duplicate Firestore code in multiple places.

So: render.js can keep loadPersistedState() and just call formula.js after.
===================================================================== */
function safeObj(x){
  return (x && typeof x === 'object') ? x : null;
}
function safeStr(x){
  const s = String(x || '');
  return s ? s : '';
}

export function getPersistedTruthFromState(state, fieldId){
  try{
    const map = safeObj(state && state.persistedStateByFieldId) || {};
    const fid = safeStr(fieldId);
    const s = map[fid];
    return safeObj(s);
  }catch(_){
    return null;
  }
}

/* =====================================================================
   Build deps (the “truth wiring”)
===================================================================== */
export function buildFRDeps(state, { opKey=null, wxCtx=null, persistedGetter=null } = {}){
  if (!state) throw new Error('state required');
  if (!state._mods || !state._mods.model || !state._mods.weather) {
    throw new Error('FR modules not loaded; call ensureFRModules(state) first');
  }

  const okOpKey = (opKey != null) ? String(opKey) : String(getCurrentOp());
  const okWxCtx = wxCtx || buildWxCtx(state);

  const getPersistedState =
    (typeof persistedGetter === 'function')
      ? (id)=> persistedGetter(String(id))
      : (id)=> getPersistedTruthFromState(state, String(id));

  return {
    getWeatherSeriesForFieldId: (fieldId)=> state._mods.weather.getWeatherSeriesForFieldId(fieldId, okWxCtx),
    getFieldParams: (fid)=> getFieldParams(state, fid),
    LOSS_SCALE: CONST.LOSS_SCALE,
    EXTRA: EXTRA,
    opKey: okOpKey,
    CAL: getCalZero(),
    getPersistedState,

    // Used by ETA helper / any feature that wants forecast rows, but harmless otherwise.
    getForecastSeriesForFieldId: async (id)=>{
      try{
        const fc = state._mods.forecast;
        if (!fc || typeof fc.readWxSeriesFromCache !== 'function') return [];
        const wx = await fc.readWxSeriesFromCache(String(id), {});
        const rows = (wx && Array.isArray(wx.fcst)) ? wx.fcst : [];
        return rows;
      }catch(_){
        return [];
      }
    }
  };
}

/* =====================================================================
   Run the model (single entry point)
===================================================================== */
export async function runFieldReadiness(state, fieldObj, opts = {}){
  if (!state) throw new Error('state required');
  if (!fieldObj) return null;

  await ensureFRModules(state);

  const deps = buildFRDeps(state, opts);
  const run = state._mods.model.runField(fieldObj, deps);
  return run || null;
}

/* Convenience helpers */
export async function getFieldReadinessNumber(state, fieldObj, opts = {}){
  const run = await runFieldReadiness(state, fieldObj, opts);
  if (!run) return null;
  const n = Number(run.readinessR);
  return Number.isFinite(n) ? n : null;
}

export function getOpThreshold(state, opKey){
  return getThresholdForOp(state, opKey != null ? String(opKey) : String(getCurrentOp()));
}
