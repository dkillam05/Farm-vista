/* =====================================================================
/Farm-vista/js/field-readiness/formula.js  (FULL FILE)
Rev: 2026-03-30b-fix-eta-forecast-fallback-from-latest-doc

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
✅ NEW: exposes centralized field_readiness_latest truth to ETA/model path
   so ETA can seed from live latest readiness/storage instead of recomputing
   "now" from historical series only
✅ FIX: if params cache is empty for a field, model/ETA now fall back to
   field_readiness_latest soilWetness + drainageIndex before using defaults
✅ FIX: prevents ETA from simming with blank params and collapsing toward 1h
✅ NEW FIX: do NOT let getFieldParams() auto-create 60/45 defaults before
   latest Firestore truth is checked. Math now prefers:
      1) live in-memory override
      2) field_readiness_latest
      3) field doc values
      4) hard defaults
✅ REAL ETA FIX: forecast getter now falls back to field_readiness_latest._raw.dailySeriesFcst
✅ REAL ETA FIX: merged history + forecast getter now exists for ETA/model fallback

This module:
- Ensures model/weather/forecast modules are loaded
- Builds deps consistently:
  - model weather series (MRMS-ready => MRMS history; else Open-Meteo history)
  - field params
  - persisted truth seed (field_readiness_state)
  - centralized latest truth seed (field_readiness_latest)
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

/* =====================================================================
   Param fallback defaults
===================================================================== */
const PARAM_FALLBACK_SOIL_WETNESS = 60;
const PARAM_FALLBACK_DRAINAGE_INDEX = 45;

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
   Small helpers
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
function hasFinite(v){
  return Number.isFinite(Number(v));
}
function toISODateOnly(v){
  try{
    const s = String(v || '').trim();
    if (!s) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = new Date(s);
    if (!Number.isFinite(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  }catch(_){
    return '';
  }
}

/* =====================================================================
   Persisted truth seed helpers
===================================================================== */
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
   Centralized latest truth helpers
===================================================================== */
export function getLatestTruthFromState(state, fieldId){
  try{
    const map = safeObj(state && state.latestReadinessByFieldId) || {};
    const fid = safeStr(fieldId);
    const rec = map[fid];
    return safeObj(rec);
  }catch(_){
    return null;
  }
}

function getLatestRawDocFromState(state, fieldId){
  try{
    const rec = getLatestTruthFromState(state, fieldId);
    return safeObj(rec && rec._raw) || {};
  }catch(_){
    return {};
  }
}

function buildEtaSeedFromLatestRecord(rec, fieldId){
  try{
    const r = safeObj(rec);
    if (!r) return null;

    const fid = safeStr(r.fieldId || fieldId);
    if (!fid) return null;

    const out = {
      fieldId: fid,
      readiness: num(r.readiness, null),
      wetness: num(r.wetness, null),
      soilWetness: num(r.soilWetness, null),
      drainageIndex: num(r.drainageIndex, null),
      storagePhysFinal: num(r.storagePhysFinal, null),
      storageFinal: num(r.storageFinal, null),
      storageForReadiness: num(r.storageForReadiness, null),
      readinessCreditIn: num(r.readinessCreditIn, null),
      wetBiasApplied: num(r.wetBiasApplied, null),
      computedAtISO: safeStr(r.computedAtISO),
      weatherFetchedAtISO: safeStr(r.weatherFetchedAtISO),
      runKey: safeStr(r.runKey),
      weatherSource: safeStr(r.weatherSource),
      seedSource: safeStr(r.seedSource),
      source: 'field_readiness_latest'
    };

    const hasUsefulSeed =
      Number.isFinite(Number(out.storagePhysFinal)) ||
      Number.isFinite(Number(out.storageFinal)) ||
      Number.isFinite(Number(out.readiness));

    return hasUsefulSeed ? out : null;
  }catch(_){
    return null;
  }
}

/* =====================================================================
   Param resolution helpers
===================================================================== */
function getRawParamsFromStateMap(state, fieldId){
  try{
    const fid = safeStr(fieldId);
    if (!fid) return null;

    const map = state && state.perFieldParams;
    if (!(map instanceof Map)) return null;

    const existing = map.get(fid);
    return safeObj(existing);
  }catch(_){
    return null;
  }
}

function getParamsFromFieldDoc(state, fieldId){
  try{
    const fid = safeStr(fieldId);
    if (!fid) return null;

    const fields = Array.isArray(state && state.fields) ? state.fields : [];
    const field = fields.find(x => String(x && x.id || '') === fid);
    if (!field) return null;

    const out = {};
    if (hasFinite(field.soilWetness)) out.soilWetness = Number(field.soilWetness);
    if (hasFinite(field.drainageIndex)) out.drainageIndex = Number(field.drainageIndex);

    return Object.keys(out).length ? out : null;
  }catch(_){
    return null;
  }
}

function buildResolvedFieldParams(state, fieldId){
  const fid = safeStr(fieldId);

  // IMPORTANT:
  // Do NOT call getFieldParams() first here, because params.js auto-creates
  // 60/45 defaults and stores them in memory, which blocks latest Firestore
  // truth from ever winning.
  const mem = getRawParamsFromStateMap(state, fid) || null;
  const latest = getLatestTruthFromState(state, fid) || null;
  const fieldDoc = getParamsFromFieldDoc(state, fid) || null;

  const soilWetness = hasFinite(mem && mem.soilWetness)
    ? Number(mem.soilWetness)
    : (
        hasFinite(latest && latest.soilWetness)
          ? Number(latest.soilWetness)
          : (
              hasFinite(fieldDoc && fieldDoc.soilWetness)
                ? Number(fieldDoc.soilWetness)
                : PARAM_FALLBACK_SOIL_WETNESS
            )
      );

  const drainageIndex = hasFinite(mem && mem.drainageIndex)
    ? Number(mem.drainageIndex)
    : (
        hasFinite(latest && latest.drainageIndex)
          ? Number(latest.drainageIndex)
          : (
              hasFinite(fieldDoc && fieldDoc.drainageIndex)
                ? Number(fieldDoc.drainageIndex)
                : PARAM_FALLBACK_DRAINAGE_INDEX
            )
      );

  // Keep params map synchronized after we resolve the true values so any later
  // getFieldParams() calls elsewhere get the corrected numbers.
  try{
    if (!(state.perFieldParams instanceof Map)){
      state.perFieldParams = new Map();
    }
    state.perFieldParams.set(fid, {
      ...(mem || {}),
      soilWetness,
      drainageIndex
    });
  }catch(_){}

  return {
    ...(mem || {}),
    soilWetness,
    drainageIndex
  };
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

  ensureMrmsCaches(state);

  try{
    const cached = state._mrmsDocByFieldId.get(fid) || null;
    const loadedAt = Number(state._mrmsDocLoadedAtByFieldId.get(fid) || 0);

    if (!force && cached && loadedAt && (Date.now() - loadedAt) < MRMS_DOC_TTL_MS){
      return cached;
    }

    let data = null;

    try{
      const api = (typeof getAPI === 'function') ? getAPI(state) : null;
      const db = api && typeof api.getFirestore === 'function' ? api.getFirestore() : null;

      if (db && api && typeof api.doc === 'function' && typeof api.getDoc === 'function'){
        const ref = api.doc(db, MRMS_COLLECTION, fid);
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

    if (!data){
      const compatDb =
        (window.firebase && typeof window.firebase.firestore === 'function')
          ? window.firebase.firestore()
          : null;

      if (compatDb && typeof compatDb.collection === 'function'){
        const snap = await compatDb.collection(MRMS_COLLECTION).doc(fid).get();
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
  return (Array.isArray(rows) ? rows : [])
    .map(r => {
      const row = safeObj(r) || {};
      return {
        ...row,
        dateISO: toISODateOnly(
          row.dateISO ||
          row.date ||
          row.day ||
          row.timeISO ||
          row.timestampISO ||
          row.validDate ||
          row.validTime ||
          row.ds ||
          ''
        ),
        rainInAdj: num(row.rainInAdj, num(row.rainIn, num(row.precipIn, num(row.precipitationIn, 0)))),
        rainSource: String(row.rainSource || row.precipSource || 'open-meteo')
      };
    })
    .filter(r => !!safeStr(r.dateISO));
}

function normalizeHistoryRows(rows){
  return (Array.isArray(rows) ? rows : [])
    .map(r => {
      const row = safeObj(r) || {};
      return {
        ...row,
        dateISO: toISODateOnly(
          row.dateISO ||
          row.date ||
          row.day ||
          row.timeISO ||
          row.timestampISO ||
          row.validDate ||
          row.validTime ||
          row.ds ||
          ''
        ),
        rainInAdj: num(row.rainInAdj, num(row.rainIn, num(row.precipIn, num(row.precipitationIn, 0)))),
        rainSource: String(row.rainSource || row.precipSource || 'open-meteo')
      };
    })
    .filter(r => !!safeStr(r.dateISO));
}

function getLatestForecastRowsFromDoc(state, fieldId){
  try{
    const raw = getLatestRawDocFromState(state, fieldId);

    const rows =
      Array.isArray(raw.dailySeriesFcst) ? raw.dailySeriesFcst :
      Array.isArray(raw.forecastRows) ? raw.forecastRows :
      Array.isArray(raw.weatherForecastRows) ? raw.weatherForecastRows :
      Array.isArray(raw.forecastDailyRows) ? raw.forecastDailyRows :
      Array.isArray(raw.openMeteoForecastRows) ? raw.openMeteoForecastRows :
      [];

    return normalizeForecastRows(rows);
  }catch(_){
    return [];
  }
}

function getLatestHistoryRowsFromDoc(state, fieldId){
  try{
    const raw = getLatestRawDocFromState(state, fieldId);

    const rows =
      Array.isArray(raw.dailySeries30d) ? raw.dailySeries30d :
      Array.isArray(raw.dailySeries) ? raw.dailySeries :
      Array.isArray(raw.weatherDailySeries) ? raw.weatherDailySeries :
      Array.isArray(raw.wxDailySeries) ? raw.wxDailySeries :
      [];

    return normalizeHistoryRows(rows);
  }catch(_){
    return [];
  }
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
    if (Array.isArray(hit) && hit.length) return hit;

    const fc = state && state._mods ? state._mods.forecast : null;
    let rows = [];

    if (fc && typeof fc.readWxSeriesFromCache === 'function'){
      const wx = await fc.readWxSeriesFromCache(fid, {});
      rows = normalizeForecastRows((wx && Array.isArray(wx.fcst)) ? wx.fcst : []);
    }

    // CRITICAL FIX:
    // If forecast cache path is blank, fall back to latest Firestore doc.
    if (!rows.length){
      rows = getLatestForecastRowsFromDoc(state, fid);
    }

    state._frForecastCache.set(fid, rows);
    state._frForecastMetaByFieldId.set(fid, {
      count: rows.length,
      updatedAt: Date.now(),
      source: rows.length ? 'open-meteo-or-latest-doc' : 'unavailable'
    });

    return rows;
  }catch(e){
    console.warn('[FieldReadiness] forecast prewarm failed:', e);
    try{
      ensureForecastCaches(state);
      const fid = String(fieldId);
      const fallbackRows = getLatestForecastRowsFromDoc(state, fid);

      state._frForecastCache.set(fid, fallbackRows);
      state._frForecastMetaByFieldId.set(fid, {
        count: fallbackRows.length,
        updatedAt: Date.now(),
        source: fallbackRows.length ? 'latest-doc-fallback' : 'error'
      });
    }catch(_){}
    return [];
  }
}

export async function prewarmForecastForFields(state, fieldIds){
  const ids = Array.isArray(fieldIds) ? fieldIds : [];
  if (!state || !ids.length) return;

  await ensureFRModules(state);
  ensureForecastCaches(state);

  await Promise.all(
    ids.map(async (id)=>{
      try{
        await prewarmForecastForField(state, String(id));
      }catch(_){}
    })
  );
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

    // ✅ Safe wrapper with corrected precedence:
    // live memory -> latest Firestore truth -> field doc -> defaults
    getFieldParams: (fid)=>{
      return buildResolvedFieldParams(state, fid);
    },

    LOSS_SCALE: CONST.LOSS_SCALE,
    EXTRA: EXTRA,
    opKey: okOpKey,
    CAL: getCalZero(),
    getPersistedState,

    // ETA/helper expects a synchronous getter.
    // IMPORTANT FIX:
    // Prefer warmed forecast cache first, but if cache is blank, fall back to
    // field_readiness_latest._raw.dailySeriesFcst so ETA can still resolve.
    getForecastSeriesForFieldId: (id)=>{
      try{
        const fid = String(id);
        ensureForecastCaches(state);

        const cacheRows = state._frForecastCache.get(fid);
        if (Array.isArray(cacheRows) && cacheRows.length){
          return normalizeForecastRows(cacheRows);
        }

        const latestRows = getLatestForecastRowsFromDoc(state, fid);
        if (latestRows.length) return latestRows;

        return [];
      }catch(_){
        return [];
      }
    },

    // IMPORTANT FIX:
    // Give ETA/model a merged history + forecast series fallback using the
    // saved latest Firestore doc when forecast cache wiring is incomplete.
    getWxSeriesWithForecastForFieldId: (id)=>{
      try{
        const fid = String(id);

        const histRows = (() => {
          try{
            const weatherRows = state._mods.weather.getWeatherSeriesForFieldId(fid, okWxCtx);
            if (Array.isArray(weatherRows) && weatherRows.length){
              return withRainSource(weatherRows, 'open-meteo');
            }
          }catch(_){}
          return getLatestHistoryRowsFromDoc(state, fid);
        })();

        const fcstRows = (() => {
          try{
            ensureForecastCaches(state);

            const cacheRows = state._frForecastCache.get(fid);
            if (Array.isArray(cacheRows) && cacheRows.length){
              return normalizeForecastRows(cacheRows);
            }
          }catch(_){}

          return getLatestForecastRowsFromDoc(state, fid);
        })();

        return [...histRows, ...fcstRows];
      }catch(_){
        return [];
      }
    },

    // NEW: expose centralized latest collection directly
    getCentralizedLatestForFieldId: (id)=>{
      try{
        return getLatestTruthFromState(state, String(id));
      }catch(_){
        return null;
      }
    },

    // NEW: expose a normalized ETA seed object from field_readiness_latest
    getEtaSeedForFieldId: (id)=>{
      try{
        const fid = String(id);
        const rec = getLatestTruthFromState(state, fid);
        return buildEtaSeedFromLatestRecord(rec, fid);
      }catch(_){
        return null;
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