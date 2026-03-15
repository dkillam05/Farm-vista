/* ======================================================================
   /Farm-vista/js/rainfallmap/readiness-core.js
   FULL FILE REBUILD
   REV: 2026-03-15a-map-readiness-centralized-fallback

   GOAL:
   - make map readiness use the same centralized path as the rest of app
   - prefer field_readiness_latest
   - keep persisted getter wiring consistent
   - keep model fallback for fields missing centralized docs
====================================================================== */

import { buildWxCtx } from '/Farm-vista/js/field-readiness/state.js';
import {
  ensureFRModules,
  buildFRDeps,
  runFieldReadiness
} from '/Farm-vista/js/field-readiness/formula.js';

const FR_LATEST_COLLECTION = 'field_readiness_latest';

function safeObj(x){ return (x && typeof x === 'object') ? x : null; }
function safeStr(x){
  const s = String(x || '');
  return s ? s : '';
}
function safeNum(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function safeInt(v, fallback = null){
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}
function toIsoFromAny(v){
  try{
    if (!v) return '';
    if (typeof v === 'string'){
      const d = new Date(v);
      return Number.isFinite(d.getTime()) ? d.toISOString() : v;
    }
    if (v && typeof v.toDate === 'function'){
      const d = v.toDate();
      return Number.isFinite(d.getTime()) ? d.toISOString() : '';
    }
    if (v && typeof v === 'object' && typeof v.seconds === 'number'){
      const ms = (Number(v.seconds) * 1000) + Math.round(Number(v.nanoseconds || 0) / 1e6);
      const d = new Date(ms);
      return Number.isFinite(d.getTime()) ? d.toISOString() : '';
    }
    if (v && typeof v === 'object' && typeof v.__time__ === 'string'){
      const d = new Date(v.__time__);
      return Number.isFinite(d.getTime()) ? d.toISOString() : String(v.__time__ || '');
    }
  }catch(_){}
  return '';
}

function buildLatestReadinessRecord(raw, fallbackId){
  const d = safeObj(raw) || {};
  const fieldId = safeStr(d.fieldId || fallbackId);
  if (!fieldId) return null;

  return {
    fieldId,
    farmId: safeStr(d.farmId),
    farmName: d.farmName == null ? null : safeStr(d.farmName),
    fieldName: safeStr(d.fieldName),
    county: safeStr(d.county),
    state: safeStr(d.state),
    readiness: safeInt(d.readiness),
    wetness: safeInt(d.wetness),
    soilWetness: safeNum(d.soilWetness),
    drainageIndex: safeNum(d.drainageIndex),
    readinessCreditIn: safeNum(d.readinessCreditIn) ?? 0,
    storageFinal: safeNum(d.storageFinal),
    storageForReadiness: safeNum(d.storageForReadiness),
    storagePhysFinal: safeNum(d.storagePhysFinal),
    wetBiasApplied: safeNum(d.wetBiasApplied),
    runKey: safeStr(d.runKey),
    seedSource: safeStr(d.seedSource),
    weatherSource: safeStr(d.weatherSource),
    timezone: safeStr(d.timezone),
    computedAtISO: toIsoFromAny(d.computedAt),
    weatherFetchedAtISO: toIsoFromAny(d.weatherFetchedAt),
    location: {
      lat: safeNum(d && d.location && d.location.lat),
      lng: safeNum(d && d.location && d.location.lng)
    },
    _raw: d
  };
}

function getPersistedStateForDeps(state, fieldId){
  try{
    const map = (state && state.persistedStateByFieldId && typeof state.persistedStateByFieldId === 'object')
      ? state.persistedStateByFieldId
      : {};

    const fid = String(fieldId || '').trim();
    if (!fid) return null;

    const hit = map[fid];
    return (hit && typeof hit === 'object') ? hit : null;
  }catch(_){
    return null;
  }
}

function buildDepsForState(state, opKey){
  const wxCtx = buildWxCtx(state);
  return buildFRDeps(state, {
    opKey: String(opKey || ''),
    wxCtx,
    persistedGetter: (id)=> getPersistedStateForDeps(state, id)
  });
}

async function getLatestReadinessForField(state, fieldId){
  try{
    const fid = String(fieldId || '').trim();
    if (!fid) return null;

    const cachedMap = (state && state.latestReadinessByFieldId && typeof state.latestReadinessByFieldId === 'object')
      ? state.latestReadinessByFieldId
      : null;

    if (cachedMap && cachedMap[fid]) return cachedMap[fid];

    const fb = state && state.fb ? state.fb : null;
    if (!fb || typeof fb.getFirestore !== 'function' || typeof fb.doc !== 'function' || typeof fb.getDoc !== 'function'){
      return null;
    }

    const db = fb.getFirestore();
    const ref = fb.doc(db, FR_LATEST_COLLECTION, fid);
    const snap = await fb.getDoc(ref);

    const exists =
      !!snap &&
      ((typeof snap.exists === 'function' && snap.exists()) || (snap.exists === true));

    if (!exists) return null;

    const rec = buildLatestReadinessRecord(snap.data() || {}, fid);
    if (!rec) return null;

    state.latestReadinessByFieldId = state.latestReadinessByFieldId || {};
    state.latestReadinessByFieldId[fid] = rec;
    return rec;
  }catch(e){
    console.warn('[WeatherMap] latest readiness fetch failed:', fieldId, e);
    return null;
  }
}

function buildSyntheticRunFromLatest(fieldObj, latest){
  if (!latest) return null;

  const readiness = safeNum(latest.readiness);
  if (!Number.isFinite(readiness)) return null;

  return {
    ok: true,
    source: 'field_readiness_latest',
    sourceLabel: 'field_readiness_latest',
    fieldId: safeStr(latest.fieldId || (fieldObj && fieldObj.id)),
    readinessR: readiness,
    readiness,
    wetnessR: Number.isFinite(Number(latest.wetness)) ? Number(latest.wetness) : null,
    wetness: Number.isFinite(Number(latest.wetness)) ? Number(latest.wetness) : null,
    storageFinal: safeNum(latest.storageFinal),
    storageForReadiness: safeNum(latest.storageForReadiness),
    storagePhysFinal: safeNum(latest.storagePhysFinal),
    runKey: safeStr(latest.runKey),
    seedSource: safeStr(latest.seedSource),
    weatherSource: safeStr(latest.weatherSource),
    computedAtISO: safeStr(latest.computedAtISO),
    weatherFetchedAtISO: safeStr(latest.weatherFetchedAtISO),
    _latest: latest
  };
}

export async function computeReadinessRunForMapField(state, fieldObj, opKey){
  try{
    if (!state || !fieldObj) return null;

    // ✅ First choice: centralized doc
    const latest = await getLatestReadinessForField(state, fieldObj.id || fieldObj.fieldId);
    const synthetic = buildSyntheticRunFromLatest(fieldObj, latest);
    if (synthetic && Number.isFinite(Number(synthetic.readinessR))){
      return synthetic;
    }

    // ✅ Fallback: full model pipeline
    await ensureFRModules(state);

    const wxCtx = buildWxCtx(state);

    try{
      const run = await runFieldReadiness(state, fieldObj, {
        opKey: String(opKey || ''),
        wxCtx,
        persistedGetter: (id)=> getPersistedStateForDeps(state, id)
      });

      if (run && Number.isFinite(Number(run.readinessR))){
        return run;
      }
    }catch(e){
      console.warn('[WeatherMap] runFieldReadiness failed, trying same-deps fallback:', fieldObj && fieldObj.id, e);
    }

    try{
      const deps = buildDepsForState(state, opKey);
      const model = state && state._mods ? state._mods.model : null;

      if (model && typeof model.runField === 'function'){
        const legacy = model.runField(fieldObj, deps);
        if (legacy && Number.isFinite(Number(legacy.readinessR))){
          return legacy;
        }
      }
    }catch(e){
      console.warn('[WeatherMap] buildFRDeps/model fallback failed:', fieldObj && fieldObj.id, e);
    }

    return null;
  }catch(e){
    console.warn('[WeatherMap] readiness run failed:', fieldObj && fieldObj.id, e);
    return null;
  }
}

export function getModelReadinessColor(state, score){
  try{
    const model = state && state._mods ? state._mods.model : null;
    if (model && typeof model.readinessColor === 'function'){
      return model.readinessColor(Number(score || 0));
    }
  }catch(_){}

  const p = Math.max(0, Math.min(100, Number(score || 0)));

  if (p <= 55){
    const t = p / 55;
    const r = Math.round(200 + (216 - 200) * t);
    const g = Math.round(59 + (178 - 59) * t);
    const b = 59;
    return `rgb(${r},${g},${b})`;
  }

  const t = (p - 55) / 45;
  const r = Math.round(216 + (47 - 216) * t);
  const g = Math.round(178 + (143 - 178) * t);
  const b = Math.round(59 + (75 - 59) * t);
  return `rgb(${r},${g},${b})`;
}
