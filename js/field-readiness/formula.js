/* =====================================================================
/Farm-vista/js/field-readiness/formula.js  (FULL FILE)
Rev: 2026-03-10b-single-source-of-truth-mrms-model-fallback

PURPOSE:
✅ Single source of truth for Field Readiness computation wiring.
✅ render.js / quickview.js / global calibration should ALL use this module.

THIS REV:
✅ Model now prefers MRMS DAILY rainfall when MRMS backfill is fully ready
✅ If MRMS is still processing / incomplete, model uses Open-Meteo rainfall
✅ Forecast rainfall remains Open-Meteo (MRMS is observed/history only)
✅ Exposes model weather rows so UI can later show which rainfall source was used

This module:
- Ensures model/weather/forecast modules are loaded
- Builds deps consistently:
  - model weather series (MRMS-ready => MRMS history; else Open-Meteo history)
  - field params
  - persisted truth seed (field_readiness_state)
  - CAL legacy adjustments => ALWAYS ZERO
  - EXTRA + CONST
  - optional forecast series (for ETA helper use)
- Calls model.runField(field, deps) and returns the run

NOTES:
- This DOES NOT change the math inside field-readiness.model.js.
- It standardizes the inputs so every UI gets the same output.
- Rainfall switch rule is intentionally simple:
    * MRMS ready for rolling 30d => use MRMS daily rain for model history
    * MRMS not ready            => use Open-Meteo rain for model history
===================================================================== */
'use strict';

// Keep these aligned with render.js imports
import { EXTRA, CONST, buildWxCtx } from './state.js';
import { getFieldParams } from './params.js';
import { getCurrentOp, getThresholdForOp } from './thresholds.js';
import { getAPI } from './firebase.js';
import { mrmsBackfillReady } from './rain.js';

/* =====================================================================
   Module loading (same approach as render.js)
===================================================================== */
const WEATHER_URL = '/Farm-vista/js/field-readiness.weather.js';
const MODEL_URL   = '/Farm-vista/js/field-readiness.model.js';
const MRMS_COLLECTION = 'field_mrms_weather';
const MRMS_DOC_TTL_MS = 5 * 60 * 1000;

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
===================================================================== */
function safeObj(x){
  return (x && typeof x === 'object') ? x : null;
}
function safeStr(x){
  const s = String(x || '');
  return s ? s : '';
}
function num(v, d=0){
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
function round3(v){
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0;
}
function mmToIn(mm){
  return num(mm, 0) / 25.4;
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
   MRMS doc loading + cache
===================================================================== */
function ensureMrmsCaches(state){
  if (!state._mrmsDocByFieldId) state._mrmsDocByFieldId = new Map();
  if (!state._mrmsDocLoadedAtByFieldId) state._mrmsDocLoadedAtByFieldId = new Map();
}

async function loadFieldMrmsDocLocal(state, fieldId, { force=false } = {}){
  try{
    if (!state || !fieldId) return null;
    ensureMrmsCaches(state);

    const fid = String(fieldId);
    const loadedAt = Number(state._mrmsDocLoadedAtByFieldId.get(fid) || 0);
    const cached = state._mrmsDocByFieldId.get(fid) || null;
    const fresh = loadedAt > 0 && ((Date.now() - loadedAt) < MRMS_DOC_TTL_MS);

    if (!force && fresh) return cached;

    const api = getAPI(state);
    if (!api){
      state._mrmsDocByFieldId.set(fid, null);
      state._mrmsDocLoadedAtByFieldId.set(fid, Date.now());
      return null;
    }

    let out = null;

    if (api.kind !== 'compat'){
      const db = api.getFirestore();
      const ref = api.doc(db, MRMS_COLLECTION, fid);
      const snap = await api.getDoc(ref);
      if (snap && snap.exists && snap.exists()){
        out = snap.data() || null;
      }
    } else if (window.firebase && window.firebase.firestore){
      const db = window.firebase.firestore();
      const snap = await db.collection(MRMS_COLLECTION).doc(fid).get();
      if (snap && snap.exists){
        out = snap.data() || null;
      }
    }

    state._mrmsDocByFieldId.set(fid, out);
    state._mrmsDocLoadedAtByFieldId.set(fid, Date.now());
    return out;
  }catch(e){
    console.warn('[FieldReadiness] MRMS doc load failed:', e);
    try{
      ensureMrmsCaches(state);
      state._mrmsDocByFieldId.set(String(fieldId), null);
      state._mrmsDocLoadedAtByFieldId.set(String(fieldId), Date.now());
    }catch(_){}
    return null;
  }
}

/* =====================================================================
   Build model weather rows
===================================================================== */
function getBaseWeatherRows(state, fieldId, wxCtx){
  try{
    const rows = state._mods.weather.getWeatherSeriesForFieldId(fieldId, wxCtx);
    return Array.isArray(rows) ? rows.slice() : [];
  }catch(_){
    return [];
  }
}

function buildMrmsDailyMap(doc){
  const map = new Map();
  const rows = Array.isArray(doc && doc.mrmsDailySeries30d) ? doc.mrmsDailySeries30d : [];
  for (const r of rows){
    const iso = String(r && r.dateISO || '').slice(0,10);
    if (!iso) continue;
    map.set(iso, {
      dateISO: iso,
      rainMm: num(r && r.rainMm, 0),
      rainIn: mmToIn(r && r.rainMm),
      hoursCount: Math.round(num(r && r.hoursCount, 0))
    });
  }
  return map;
}

function withRainSource(rows, source){
  return (Array.isArray(rows) ? rows : []).map(r => ({
    ...r,
    rainInAdj: num(r && r.rainInAdj, num(r && r.rainIn, 0)),
    rainSource: String(source || 'open-meteo')
  }));
}

function overlayMrmsRainOntoWeatherRows(baseRows, mrmsDoc){
  const rows = Array.isArray(baseRows) ? baseRows.slice() : [];
  if (!rows.length) return [];

  const mrmsMap = buildMrmsDailyMap(mrmsDoc);
  if (!mrmsMap.size) return withRainSource(rows, 'open-meteo');

  return rows.map(r=>{
    const iso = String(r && r.dateISO || '').slice(0,10);
    const m = mrmsMap.get(iso);

    if (!m){
      return {
        ...r,
        rainInAdj: num(r && r.rainInAdj, num(r && r.rainIn, 0)),
        rainSource: String(r && (r.rainSource || r.precipSource) || 'open-meteo')
      };
    }

    return {
      ...r,
      rainMrmsMm: round3(m.rainMm),
      rainMrmsIn: round3(m.rainIn),
      rainInAdj: round3(m.rainIn),
      rainSource: 'mrms',
      mrmsHoursCount: m.hoursCount
    };
  });
}

async function buildModelWeatherSeriesForFieldId(state, fieldId, wxCtx){
  const baseRows = getBaseWeatherRows(state, fieldId, wxCtx);
  if (!baseRows.length){
    return { rows: [], mode: 'none', mrmsReady: false };
  }

  const mrmsDoc = await loadFieldMrmsDocLocal(state, fieldId, { force:false });
  const ready = !!mrmsBackfillReady(mrmsDoc);

  if (!ready){
    return {
      rows: withRainSource(baseRows, 'open-meteo'),
      mode: 'open-meteo',
      mrmsReady: false,
      mrmsDoc: mrmsDoc || null
    };
  }

  return {
    rows: overlayMrmsRainOntoWeatherRows(baseRows, mrmsDoc),
    mode: 'mrms',
    mrmsReady: true,
    mrmsDoc: mrmsDoc || null
  };
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
    // legacy/base weather getter still exposed
    getWeatherSeriesForFieldId: (fieldId)=> state._mods.weather.getWeatherSeriesForFieldId(fieldId, okWxCtx),

    // new preferred getter for the model
    getModelWeatherSeriesForFieldId: (fieldId)=>{
      const fid = String(fieldId);
      const cacheKey = `modelwx:${fid}`;
      state._frModelWxCache = state._frModelWxCache || new Map();

      const hit = state._frModelWxCache.get(cacheKey);
      if (hit && Array.isArray(hit.rows)) return hit.rows;

      // synchronous fallback if caller forgot to prewarm:
      // use open-meteo rows immediately
      const rows = withRainSource(
        state._mods.weather.getWeatherSeriesForFieldId(fid, okWxCtx),
        'open-meteo'
      );
      state._frModelWxCache.set(cacheKey, { rows, mode:'open-meteo', mrmsReady:false });
      return rows;
    },

    // optional richer merged getter
    getMergedWeatherSeriesForFieldId: (fieldId)=>{
      const fid = String(fieldId);
      const cacheKey = `modelwx:${fid}`;
      state._frModelWxCache = state._frModelWxCache || new Map();
      const hit = state._frModelWxCache.get(cacheKey);
      if (hit && Array.isArray(hit.rows)) return hit.rows;
      return withRainSource(
        state._mods.weather.getWeatherSeriesForFieldId(fid, okWxCtx),
        'open-meteo'
      );
    },

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
        return rows.map(r=>({
          ...r,
          rainInAdj: num(r && r.rainInAdj, num(r && r.rainIn, 0)),
          rainSource: String(r && (r.rainSource || r.precipSource) || 'open-meteo')
        }));
      }catch(_){
        return [];
      }
    }
  };
}

/* =====================================================================
   Internal prewarm for model weather rows
===================================================================== */
async function prewarmModelWeatherForField(state, fieldObj, wxCtx){
  try{
    if (!state || !fieldObj || !fieldObj.id) return;
    state._frModelWxCache = state._frModelWxCache || new Map();

    const fid = String(fieldObj.id);
    const cacheKey = `modelwx:${fid}`;

    const built = await buildModelWeatherSeriesForFieldId(state, fid, wxCtx);
    state._frModelWxCache.set(cacheKey, built);

    state._frModelWxMetaByFieldId = state._frModelWxMetaByFieldId || new Map();
    state._frModelWxMetaByFieldId.set(fid, {
      mode: String(built.mode || 'open-meteo'),
      mrmsReady: !!built.mrmsReady,
      updatedAt: Date.now()
    });
  }catch(e){
    console.warn('[FieldReadiness] prewarmModelWeatherForField failed:', e);
  }
}

/* =====================================================================
   Run the model (single entry point)
===================================================================== */
export async function runFieldReadiness(state, fieldObj, opts = {}){
  if (!state) throw new Error('state required');
  if (!fieldObj) return null;

  await ensureFRModules(state);

  const wxCtx = opts.wxCtx || buildWxCtx(state);

  // Prewarm merged/model weather so model gets MRMS rows when ready
  await prewarmModelWeatherForField(state, fieldObj, wxCtx);

  const deps = buildFRDeps(state, { ...opts, wxCtx });
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