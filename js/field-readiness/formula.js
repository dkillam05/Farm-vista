/* =====================================================================
/Farm-vista/js/field-readiness/formula.js  (FULL FILE)
Rev: 2026-03-13b-fix-eta-helper-sync-forecast-cache

PURPOSE:
✅ Single source of truth for Field Readiness computation wiring.
✅ render.js / quickview.js / global calibration should ALL use this module.

THIS REV:
✅ Model now prefers MRMS DAILY rainfall when MRMS backfill is fully ready
✅ If MRMS is still processing / incomplete, model uses Open-Meteo rainfall
✅ Forecast rainfall remains Open-Meteo (MRMS is observed/history only)
✅ Exposes model weather rows so UI can later show which rainfall source was used
✅ FIX: force warm weather for the specific field before building model weather
   so newly added fields can still get an initial readiness score from
   Open-Meteo even before MRMS is ready
✅ FIX: all weather warm calls are guarded so page does not hard-stop if the
   weather module is unavailable or warmWeatherForFields is missing
✅ FIX: ETA helper contract restored — forecast getter is synchronous again.
   Forecast rows are prewarmed/cached, then buildFRDeps exposes them as a
   normal array getter instead of returning a Promise.

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
  const fid = String(fieldId || '').trim();
  if (!fid) return null;

  state._mrmsDocByFieldId = state._mrmsDocByFieldId || new Map();
  state._mrmsDocLoadedAtByFieldId = state._mrmsDocLoadedAtByFieldId || new Map();

  const TTL_MS = 5 * 60 * 1000;

  try{
    const cached = state._mrmsDocByFieldId.get(fid) || null;
    const loadedAt = Number(state._mrmsDocLoadedAtByFieldId.get(fid) || 0);

    if (!force && cached && loadedAt && (Date.now() - loadedAt) < TTL_MS){
      return cached;
    }

    let data = null;

    // Prefer modular API first
    try{
      const api = (typeof getAPI === 'function') ? getAPI(state) : null;
      const db = api && typeof api.getFirestore === 'function' ? api.getFirestore() : null;

      if (db && api && typeof api.doc === 'function' && typeof api.getDoc === 'function'){
        const ref = api.doc(db, 'field_mrms_weather', fid);
        const snap = await api.getDoc(ref);

        if (snap){
          const exists =
            (typeof snap.exists === 'function' && snap.exists()) ||
            (typeof snap.exists === 'boolean' && snap.exists === true);

          if (exists){
            data = snap.data() || null;
          }
        }
      }
    }catch(_){}

    // Compat fallback only if modular did not return a doc
    if (!data){
      const compatDb =
        (window.firebase && typeof window.firebase.firestore === 'function')
          ? window.firebase.firestore()
          : null;

      if (compatDb && typeof compatDb.collection === 'function'){
        const snap = await compatDb.collection('field_mrms_weather').doc(fid).get();
        if (snap && snap.exists){
          data = snap.data() || null;
        }
      }
    }

    state._mrmsDocByFieldId.set(fid, data || null);
    state._mrmsDocLoadedAtByFieldId.set(fid, Date.now());

    return data || null;
  }catch(e){
    console.warn('[FieldReadiness] MRMS doc load failed:', e);
    state._mrmsDocByFieldId.set(fid, null);
    state._mrmsDocLoadedAtByFieldId.set(fid, Date.now());
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

function normalizeForecastRows(rows){
  return (Array.isArray(rows) ? rows : []).map(r => ({
    ...r,
    rainInAdj: num(r && r.rainInAdj, num(r && r.rainIn, 0)),
    rainSource: String(r && (r.rainSource || r.precipSource) || 'open-meteo')
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
   Forecast cache helpers
===================================================================== */
function ensureForecastCaches(state){
  if (!state._frForecastCache) state._frForecastCache = new Map();
  if (!state._frForecastMetaByFieldId) state._frForecastMetaByFieldId = new Map();
}

async function prewarmForecastForField(state, fieldId){
  try{
    if (!state || !fieldId) return [];
    ensureForecastCaches(state);

    const fid = String(fieldId);
    const hit = state._frForecastCache.get(fid);
    if (Array.isArray(hit)) return hit;

    const fc = state && state._mods ? state._mods.forecast : null;
    if (!fc || typeof fc.readWxSeriesFromCache !== 'function'){
      state._frForecastCache.set(fid, []);
      state._frForecastMetaByFieldId.set(fid, {
        count: 0,
        updatedAt: Date.now(),
        source: 'unavailable'
      });
      return [];
    }

    const wx = await fc.readWxSeriesFromCache(fid, {});
    const rows = normalizeForecastRows((wx && Array.isArray(wx.fcst)) ? wx.fcst : []);

    state._frForecastCache.set(fid, rows);
    state._frForecastMetaByFieldId.set(fid, {
      count: rows.length,
      updatedAt: Date.now(),
      source: 'open-meteo'
    });

    return rows;
  }catch(e){
    console.warn('[FieldReadiness] forecast prewarm failed:', e);
    try{
      ensureForecastCaches(state);
      const fid = String(fieldId);
      state._frForecastCache.set(fid, []);
      state._frForecastMetaByFieldId.set(fid, {
        count: 0,
        updatedAt: Date.now(),
        source: 'error'
      });
    }catch(_){}
    return [];
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

  ensureForecastCaches(state);

  // ✅ Harden common param caches so params.js does not crash on .get(...)
  state.paramsByFieldId = (state.paramsByFieldId instanceof Map) ? state.paramsByFieldId : new Map();
  state.paramMetaByFieldId = (state.paramMetaByFieldId instanceof Map) ? state.paramMetaByFieldId : new Map();
  state._frModelWxCache = (state._frModelWxCache instanceof Map) ? state._frModelWxCache : new Map();

  return {
    // legacy/base weather getter still exposed
    getWeatherSeriesForFieldId: (fieldId)=> state._mods.weather.getWeatherSeriesForFieldId(fieldId, okWxCtx),

    // new preferred getter for the model
    getModelWeatherSeriesForFieldId: (fieldId)=>{
      const fid = String(fieldId);
      const cacheKey = `modelwx:${fid}`;

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
      const hit = state._frModelWxCache.get(cacheKey);
      if (hit && Array.isArray(hit.rows)) return hit.rows;
      return withRainSource(
        state._mods.weather.getWeatherSeriesForFieldId(fid, okWxCtx),
        'open-meteo'
      );
    },

    // ✅ Safe wrapper so readiness map does not hard-crash if params cache is empty
    getFieldParams: (fid)=>{
      try{
        const out = getFieldParams(state, fid);
        return (out && typeof out === 'object') ? out : {};
      }catch(e){
        console.warn('[FieldReadiness] getFieldParams wrapper failed:', fid, e);
        return {};
      }
    },

    LOSS_SCALE: CONST.LOSS_SCALE,
    EXTRA: EXTRA,
    opKey: okOpKey,
    CAL: getCalZero(),
    getPersistedState,

    // ETA/helper expects a synchronous getter.
    // Forecast cache is prewarmed before runFieldReadiness/model use.
    getForecastSeriesForFieldId: (id)=>{
      try{
        const fid = String(id);
        ensureForecastCaches(state);
        const rows = state._frForecastCache.get(fid);
        return Array.isArray(rows) ? rows : [];
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

    // ✅ Force weather warm for this exact field first, so newly added fields
    // can get Open-Meteo rows even if they were not part of the initial warm set.
    try{
      if (
        state._mods &&
        state._mods.weather &&
        typeof state._mods.weather.warmWeatherForFields === 'function'
      ){
        await state._mods.weather.warmWeatherForFields([fieldObj], wxCtx, {
          force: false,
          onEach: ()=>{}
        });
      }
    }catch(e){
      console.warn('[FieldReadiness] field weather warm failed:', e);
    }

    // ✅ Prewarm forecast cache too so ETA helper sees sync rows later.
    try{
      await prewarmForecastForField(state, fid);
    }catch(e){
      console.warn('[FieldReadiness] field forecast warm failed:', e);
    }

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
