/* =====================================================================
/Farm-vista/js/field-readiness/quickview.js  (FULL FILE)
Rev: 2026-05-13-cloud-run-preview-debounced

GOAL:
✅ Keep Quick View UI visually the same
✅ Read centralized readiness from field_conditions_current first
✅ Fall back to field_readiness_latest if needed
✅ Slider movement is PREVIEW ONLY
✅ Live preview calls Cloud Run readiness preview endpoint
✅ Debounce slider preview so it does not spam Cloud Run
✅ Save & Close writes:
   - fields/{fieldId} slider values
   - field_conditions_current/{fieldId} preview result
   - field_readiness_latest/{fieldId} compatibility result
✅ Does NOT save temporary preview values until Save & Close

EXPECTED CLOUD RUN PREVIEW ENDPOINT:
GET https://farmvista-field-weather-300398089669.us-central1.run.app/preview?fieldId=FIELD_ID&soilWetness=60&drainageIndex=45

===================================================================== */
'use strict';

import { OPS } from './state.js';
import { getAPI } from './firebase.js';
import { getFieldParams, saveParamsToLocal } from './params.js';
import { getCurrentOp, getThresholdForOp } from './thresholds.js';
import { esc, clamp } from './utils.js';
import { canEdit } from './perm.js';
import { parseRangeFromInput, mrmsRainInRange } from './rain.js';
import { loadFieldMrmsDoc } from './data.js';

function $(id){ return document.getElementById(id); }

const FIELD_CONDITIONS_COLLECTION = 'field_conditions_current';
const FR_LATEST_COLLECTION = 'field_readiness_latest';

const LATEST_TTL_MS = 30000;
const PREVIEW_DEBOUNCE_MS = 3000;

const PREVIEW_BASE_URL =
  'https://farmvista-field-weather-300398089669.us-central1.run.app';

function safeObj(x){ return (x && typeof x === 'object') ? x : null; }

function safeStr(x){
  const s = String(x || '');
  return s ? s : '';
}

function safeISO10(x){
  const s = safeStr(x);
  return (s.length >= 10) ? s.slice(0,10) : s;
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
      const ms =
        (Number(v.seconds) * 1000) +
        Math.round(Number(v.nanoseconds || 0) / 1e6);

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
  const final = safeObj(d.final) || {};
  const soil = safeObj(d.soil) || {};
  const surface = safeObj(d.surface) || {};

  const fieldId = safeStr(d.fieldId || fallbackId);
  if (!fieldId) return null;

  return {
    fieldId,
    farmId: safeStr(d.farmId),
    farmName: d.farmName == null ? null : safeStr(d.farmName),
    fieldName: safeStr(d.fieldName),
    county: safeStr(d.county),
    state: safeStr(d.state),

    readiness: safeInt(final.readiness ?? d.readiness),
    wetness: safeInt(final.wetness ?? d.wetness),

    baseReadiness: safeNum(final.baseReadiness ?? d.baseReadiness),
    surfacePenalty: safeNum(final.surfacePenalty ?? d.surfacePenalty),

    soilWetness: safeNum(d.soilWetness),
    drainageIndex: safeNum(d.drainageIndex),
    readinessCreditIn: safeNum(d.readinessCreditIn) ?? 0,

    storageFinal: safeNum(final.storageFinal ?? soil.storage ?? d.storageFinal),
    storageForReadiness: safeNum(final.storageForReadiness ?? d.storageForReadiness),
    storagePhysFinal: safeNum(final.storagePhysFinal ?? d.storagePhysFinal),
    surfaceFinal: safeNum(final.surfaceFinal ?? surface.water ?? d.surfaceFinal ?? d.surfaceStorageFinal),

    storageMax:
      safeNum(d.storageMax) ??
      safeNum(soil.Smax) ??
      safeNum(d.Smax),

    storageCapacity: safeNum(d.storageCapacity),
    storageMaxFinal: safeNum(d.storageMaxFinal),
    wetBiasApplied: safeNum(d.wetBiasApplied),

    runKey: safeStr(d.runKey),
    seedSource: safeStr(d.seedSource || d.seedMode),
    weatherSource: safeStr(d.weatherSource || d.source),
    timezone: safeStr(d.timezone),
    status: safeStr(d.status),
    reason: safeStr(d.reason),

    computedAtISO: toIsoFromAny(d.computedAt ?? d.updatedAt),
    updatedAtISO: toIsoFromAny(d.updatedAt ?? d.computedAt),
    weatherFetchedAtISO: toIsoFromAny(d.weatherFetchedAt),

    location: {
      lat: safeNum(d && d.location && d.location.lat),
      lng: safeNum(d && d.location && d.location.lng)
    },

    _raw: d
  };
}

async function loadLatestReadiness(state, { force=false } = {}){
  try{
    if (!state) return;

    const now = Date.now();
    const last = Number(state._qvLatestLoadedAt || 0);

    if (
      !force &&
      state.latestReadinessByFieldId &&
      (now - last) < LATEST_TTL_MS
    ){
      return;
    }

    state.latestReadinessByFieldId = state.latestReadinessByFieldId || {};
    const out = {};

    const api = getAPI(state);

    if (!api){
      state.latestReadinessByFieldId = out;
      state._qvLatestLoadedAt = now;
      return;
    }

    if (api.kind === 'compat' && window.firebase && window.firebase.firestore){
      const db = window.firebase.firestore();

      try{
        const currentSnap = await db.collection(FIELD_CONDITIONS_COLLECTION).get();

        currentSnap.forEach(doc=>{
          const rec = buildLatestReadinessRecord(doc.data() || {}, doc.id);
          if (!rec || !rec.fieldId) return;
          out[rec.fieldId] = rec;
        });
      }catch(e){
        console.warn('[FieldReadiness] quickview field_conditions_current load failed:', e);
      }

      try{
        const latestSnap = await db.collection(FR_LATEST_COLLECTION).get();

        latestSnap.forEach(doc=>{
          const rec = buildLatestReadinessRecord(doc.data() || {}, doc.id);
          if (!rec || !rec.fieldId) return;
          if (!out[rec.fieldId]) out[rec.fieldId] = rec;
        });
      }catch(e){
        console.warn('[FieldReadiness] quickview field_readiness_latest fallback load failed:', e);
      }

      state.latestReadinessByFieldId = out;
      state._qvLatestLoadedAt = now;
      return;
    }

    if (api.kind !== 'compat'){
      const db = api.getFirestore();

      try{
        const currentCol = api.collection(db, FIELD_CONDITIONS_COLLECTION);
        const currentSnap = await api.getDocs(currentCol);

        currentSnap.forEach(doc=>{
          const rec = buildLatestReadinessRecord(doc.data() || {}, doc.id);
          if (!rec || !rec.fieldId) return;
          out[rec.fieldId] = rec;
        });
      }catch(e){
        console.warn('[FieldReadiness] quickview field_conditions_current load failed:', e);
      }

      try{
        const latestCol = api.collection(db, FR_LATEST_COLLECTION);
        const latestSnap = await api.getDocs(latestCol);

        latestSnap.forEach(doc=>{
          const rec = buildLatestReadinessRecord(doc.data() || {}, doc.id);
          if (!rec || !rec.fieldId) return;
          if (!out[rec.fieldId]) out[rec.fieldId] = rec;
        });
      }catch(e){
        console.warn('[FieldReadiness] quickview field_readiness_latest fallback load failed:', e);
      }

      state.latestReadinessByFieldId = out;
      state._qvLatestLoadedAt = now;
      return;
    }
  }catch(e){
    console.warn('[FieldReadiness] quickview latest readiness load failed:', e);
    state.latestReadinessByFieldId = state.latestReadinessByFieldId || {};
    state._qvLatestLoadedAt = Date.now();
  }
}

function getLatestReadinessForField(state, fieldId){
  try{
    const map = safeObj(state && state.latestReadinessByFieldId) || {};
    const fid = safeStr(fieldId);
    const rec = map[fid];
    return safeObj(rec);
  }catch(_){
    return null;
  }
}

function buildSyntheticRunFromLatest(state, fieldObj, latestRec){
  const f = fieldObj || {};
  const rec = latestRec || getLatestReadinessForField(state, f.id);

  if (!rec) return null;

  const readinessR = safeInt(rec.readiness);
  if (!Number.isFinite(readinessR)) return null;

  const storageCap =
    safeNum(rec.storageMax) ??
    safeNum(rec.storageCapacity) ??
    safeNum(rec.storageMaxFinal) ??
    safeNum(rec.storagePhysFinal) ??
    safeNum(rec.storageForReadiness) ??
    safeNum(rec.storageFinal) ??
    0;

  return {
    ok: true,
    source: FIELD_CONDITIONS_COLLECTION,
    sourceLabel: FIELD_CONDITIONS_COLLECTION,
    fieldId: safeStr(rec.fieldId || f.id),

    readinessR,
    readiness: readinessR,

    wetness: safeInt(rec.wetness),
    wetnessR: safeInt(rec.wetness),

    soilWetness: safeNum(rec.soilWetness),
    drainageIndex: safeNum(rec.drainageIndex),
    readinessCreditIn: safeNum(rec.readinessCreditIn) ?? 0,

    storageFinal: safeNum(rec.storageFinal),
    storageForReadiness: safeNum(rec.storageForReadiness),
    storagePhysFinal: safeNum(rec.storagePhysFinal),
    surfaceFinal: safeNum(rec.surfaceFinal),

    surfaceStorageFinal: safeNum(rec.surfaceFinal),

    storageMax: safeNum(rec.storageMax) ?? storageCap,
    storageCapacity: safeNum(rec.storageCapacity) ?? storageCap,
    storageMaxFinal: safeNum(rec.storageMaxFinal) ?? storageCap,

    wetBiasApplied: safeNum(rec.wetBiasApplied),

    runKey: safeStr(rec.runKey),
    seedSource: safeStr(rec.seedSource),
    weatherSource: safeStr(rec.weatherSource),
    timezone: safeStr(rec.timezone),

    computedAtISO: safeStr(rec.computedAtISO),
    updatedAtISO: safeStr(rec.updatedAtISO),
    weatherFetchedAtISO: safeStr(rec.weatherFetchedAtISO),

    county: safeStr(rec.county || f.county),
    state: safeStr(rec.state || f.state),

    factors: {
      Smax: storageCap
    },

    trace: [],
    rows: [],
    _latest: rec
  };
}

function normalizePreviewRun(raw, field){
  const r = safeObj(raw) || {};
  const f = field || {};

  const result = safeObj(r.result) || r;
  const soil = safeObj(result.soil) || {};
  const surface = safeObj(result.surface) || {};
  const factors = safeObj(result.factors) || {};

  const readinessR =
    safeInt(result.readiness) ??
    safeInt(result.readinessR);

  const wetnessR =
    safeInt(result.wetness) ??
    safeInt(result.wetnessR);

  if (!Number.isFinite(readinessR)) {
    return {
      ok: false,
      error: safeStr(result.error || r.error || 'Preview did not return readiness')
    };
  }

  const storageFinal =
    safeNum(result.storageFinal) ??
    safeNum(soil.storage);

  const surfaceFinal =
    safeNum(result.surfaceStorageFinal) ??
    safeNum(result.surfaceFinal) ??
    safeNum(surface.water);

  const smax =
    safeNum(result.Smax) ??
    safeNum(factors.Smax) ??
    safeNum(soil.Smax);

  return {
    ok: true,
    source: 'cloud-run-preview',
    sourceLabel: 'Cloud Run Preview',

    fieldId: safeStr(result.fieldId || r.fieldId || f.id),
    fieldName: safeStr(result.fieldName || r.fieldName || f.name),

    readinessR,
    readiness: readinessR,

    wetnessR: Number.isFinite(wetnessR) ? wetnessR : clamp(100 - readinessR, 0, 100),
    wetness: Number.isFinite(wetnessR) ? wetnessR : clamp(100 - readinessR, 0, 100),

    baseReadiness: safeNum(result.baseReadiness),
    surfacePenalty: safeNum(result.surfacePenalty),

    storageFinal,
    storageForReadiness: safeNum(result.storageForReadiness),
    storagePhysFinal: safeNum(result.storagePhysFinal),
    surfaceFinal,
    surfaceStorageFinal: surfaceFinal,

    readinessCreditIn: safeNum(result.readinessCreditIn) ?? 0,

    storageMax: smax,
    storageCapacity: smax,
    storageMaxFinal: smax,

    weatherSource: safeStr(result.weatherSource || result.source || 'farmvista-engine'),
    seedSource: safeStr(result.seedMode || result.seedSource),
    runKey: safeStr(result.runKey || 'quickview-preview'),

    computedAtISO: toIsoFromAny(result.computedAt || new Date().toISOString()),

    factors: {
      ...(factors || {}),
      Smax: smax
    },

    trace: Array.isArray(result.trace) ? result.trace : [],
    rows: Array.isArray(result.rows) ? result.rows : [],

    debug: safeObj(result.debug) || {},
    _previewRaw: raw
  };
}

async function callPreviewEndpoint(state, field, values){
  const fid = safeStr(field && field.id);
  if (!fid) {
    return { ok:false, error:'Missing field ID' };
  }

  const soilWetness = clamp(Number(values && values.soilWetness), 0, 100);
  const drainageIndex = clamp(Number(values && values.drainageIndex), 0, 100);

  const url =
    `${PREVIEW_BASE_URL}/preview` +
    `?fieldId=${encodeURIComponent(fid)}` +
    `&soilWetness=${encodeURIComponent(soilWetness)}` +
    `&drainageIndex=${encodeURIComponent(drainageIndex)}`;

  const controller = new AbortController();
  const timeout = setTimeout(()=> controller.abort(), 20000);

  try{
    const res = await fetch(url, {
      method: 'GET',
      mode: 'cors',
      cache: 'no-store',
      signal: controller.signal
    });

    if (!res.ok){
      return {
        ok:false,
        error:`Preview failed (${res.status})`
      };
    }

    const json = await res.json();
    const normalized = normalizePreviewRun(json, field);

    if (!normalized.ok){
      return normalized;
    }

    normalized._previewValues = {
      soilWetness,
      drainageIndex
    };

    return normalized;
  }catch(e){
    return {
      ok:false,
      error: e && e.name === 'AbortError'
        ? 'Preview timed out'
        : (e && e.message ? e.message : String(e || 'Preview failed'))
    };
  }finally{
    clearTimeout(timeout);
  }
}

function getModelWeatherSourceValue(run){
  try{
    const rows = Array.isArray(run && run.rows) ? run.rows : [];
    if (!rows.length) return safeStr(run && run.weatherSource) || 'farmvista-engine';

    let mrmsCount = 0;
    let omCount = 0;

    for (const r of rows){
      const src = String(r && r.rainSource || '').toLowerCase();
      if (src === 'mrms') mrmsCount++;
      else if (src) omCount++;
    }

    if (mrmsCount > 0 && omCount === 0) return 'mrms';
    if (mrmsCount > 0 && omCount > 0) return 'mixed';

    return 'open-meteo';
  }catch(_){
    return 'farmvista-engine';
  }
}

function buildLatestPayloadFromRun(state, field, run){
  const f = field || {};
  const r = run || {};
  const latestExisting = getLatestReadinessForField(state, f.id) || null;

  const farmName =
    (state && state.farmsById && state.farmsById.get && f.farmId)
      ? (state.farmsById.get(f.farmId) || '')
      : '';

  const nowIso = new Date().toISOString();

  const location = {
    lat: safeNum(f && f.location && f.location.lat),
    lng: safeNum(f && f.location && f.location.lng)
  };

  return {
    fieldId: safeStr(f.id),
    farmId: safeStr(f.farmId),
    farmName: farmName || null,
    fieldName: safeStr(f.name),
    county: safeStr(f.county),
    state: safeStr(f.state),

    readiness: safeInt(r.readinessR),
    wetness: safeInt(r.wetnessR),

    soilWetness: safeNum(f.soilWetness),
    drainageIndex: safeNum(f.drainageIndex),

    baseReadiness: safeNum(r.baseReadiness),
    surfacePenalty: safeNum(r.surfacePenalty) ?? 0,

    readinessCreditIn: safeNum(r.readinessCreditIn) ?? 0,

    storageFinal: safeNum(r.storageFinal),
    surfaceStorageFinal:
      safeNum(r.surfaceStorageFinal) ??
      safeNum(r.surfaceFinal),

    storageForReadiness:
      safeNum(r.storageForReadiness) ??
      safeNum(latestExisting && latestExisting.storageForReadiness),

    storagePhysFinal:
      safeNum(r.storagePhysFinal) ??
      safeNum(latestExisting && latestExisting.storagePhysFinal),

    storageMax:
      safeNum(r.storageMax) ??
      safeNum(r.storageCapacity) ??
      safeNum(r.storageMaxFinal) ??
      safeNum(r && r.factors && r.factors.Smax) ??
      safeNum(latestExisting && latestExisting.storageMax),

    storageCapacity:
      safeNum(r.storageCapacity) ??
      safeNum(r.storageMax) ??
      safeNum(r.storageMaxFinal) ??
      safeNum(r && r.factors && r.factors.Smax) ??
      safeNum(latestExisting && latestExisting.storageCapacity),

    storageMaxFinal:
      safeNum(r.storageMaxFinal) ??
      safeNum(r.storageMax) ??
      safeNum(r.storageCapacity) ??
      safeNum(r && r.factors && r.factors.Smax) ??
      safeNum(latestExisting && latestExisting.storageMaxFinal),

    wetBiasApplied:
      safeNum(r.wetBiasApplied) ??
      safeNum(latestExisting && latestExisting.wetBiasApplied),

    runKey: safeStr(r.runKey) || 'quickview-save',
    seedSource: 'quickview-save',
    weatherSource: getModelWeatherSourceValue(r),

    timezone:
      safeStr(r.timezone) ||
      safeStr(latestExisting && latestExisting.timezone) ||
      'America/Chicago',

    weatherFetchedAt: new Date(nowIso),
    computedAt: new Date(nowIso),
    updatedAt: new Date(nowIso),

    source: 'quickview-cloud-run-preview',
    status: 'ok',

    location
  };
}

function buildFieldConditionsPayloadFromRun(state, field, run){
  const f = field || {};
  const r = run || {};
  const smax =
    safeNum(r && r.factors && r.factors.Smax) ??
    safeNum(r.storageMax) ??
    safeNum(r.storageCapacity) ??
    safeNum(r.storageMaxFinal) ??
    0;

  const surfaceWater =
    safeNum(r.surfaceStorageFinal) ??
    safeNum(r.surfaceFinal) ??
    0;

  return {
    fieldId: safeStr(f.id),
    fieldName: safeStr(f.name) || null,

    farmId: safeStr(f.farmId) || null,
    farmName:
      (state && state.farmsById && state.farmsById.get && f.farmId)
        ? (state.farmsById.get(f.farmId) || null)
        : null,

    location: f.location || null,
    county: f.county || null,
    state: f.state || null,

    soilWetness: safeNum(f.soilWetness),
    drainageIndex: safeNum(f.drainageIndex),

    readiness: Number(safeInt(r.readinessR)),
    wetness: Number(safeInt(r.wetnessR)),

    baseReadiness: Number(
      safeNum(r.baseReadiness) ??
      safeInt(r.readinessR)
    ),

    surfacePenalty: Number(
      safeNum(r.surfacePenalty) ?? 0
    ),

    soil: {
      storage: Number(safeNum(r.storageFinal) ?? 0),
      Smax: Number(smax)
    },

    surface: {
      water: Number(surfaceWater),
      penalty: Number(safeNum(r.surfacePenalty) ?? 0)
    },

    storageFinal: Number(safeNum(r.storageFinal) ?? 0),
    surfaceStorageFinal: Number(surfaceWater),
    storageForReadiness: Number(safeNum(r.storageForReadiness) ?? 0),
    readinessCreditIn: Number(safeNum(r.readinessCreditIn) ?? 0),

    asOfDateISO: new Date().toISOString().slice(0, 10),
    computedAt: new Date(),
    updatedAt: new Date(),

    modelVersion: 'quickview-cloud-run-preview',
    source: 'quickview-save',
    seedMode: safeStr(r.seedSource || 'quickview-save'),
    status: 'ok'
  };
}

async function writeDocCompatAware(state, collectionName, fieldId, payload){
  const api = getAPI(state);
  if (!api) return;

  if (api.kind !== 'compat'){
    const db = api.getFirestore();
    const ref = api.doc(db, collectionName, String(fieldId));

    if (typeof api.setDoc === 'function'){
      await api.setDoc(ref, payload, { merge:true });
      return;
    }

    if (typeof api.updateDoc === 'function'){
      try{
        await api.updateDoc(ref, payload);
      }catch(_){
        if (typeof api.setDoc === 'function'){
          await api.setDoc(ref, payload, { merge:true });
        }else{
          throw _;
        }
      }
      return;
    }
  }

  if (api.kind === 'compat' && window.firebase && window.firebase.firestore){
    const db = window.firebase.firestore();
    await db.collection(collectionName).doc(String(fieldId)).set(payload, { merge:true });
  }
}

async function persistLatestReadinessForField(state, field, run){
  const payload = buildLatestPayloadFromRun(state, field, run);
  await writeDocCompatAware(state, FR_LATEST_COLLECTION, field.id, payload);

  state.latestReadinessByFieldId = state.latestReadinessByFieldId || {};
  state.latestReadinessByFieldId[String(field.id)] =
    buildLatestReadinessRecord(payload, String(field.id));

  state._qvLatestLoadedAt = Date.now();
}

async function persistFieldConditionsForField(state, field, run){
  const payload = buildFieldConditionsPayloadFromRun(state, field, run);
  await writeDocCompatAware(state, FIELD_CONDITIONS_COLLECTION, field.id, payload);

  state.latestReadinessByFieldId = state.latestReadinessByFieldId || {};
  state.latestReadinessByFieldId[String(field.id)] =
    buildLatestReadinessRecord(payload, String(field.id));

  state._qvLatestLoadedAt = Date.now();
}

function perceivedFromThreshold(readiness, thr){
  const r = clamp(Math.round(Number(readiness)), 0, 100);
  const t = clamp(Math.round(Number(thr)), 0, 100);

  if (t <= 0) return 100;
  if (t >= 100) return Math.round((r / 100) * 50);
  if (r === t) return 50;

  if (r > t){
    const denom = Math.max(1, 100 - t);
    const frac = (r - t) / denom;
    return clamp(Math.round(50 + frac * 50), 0, 100);
  }

  const denom = Math.max(1, t);
  const frac = r / denom;
  return clamp(Math.round(frac * 50), 0, 100);
}

function colorForPerceived(p){
  const x = clamp(Number(p), 0, 100);
  let h;

  if (x <= 50){
    const frac = x / 50;
    h = 10 + (45 - 10) * frac;
  } else {
    const frac = (x - 50) / 50;
    h = 45 + (120 - 45) * frac;
  }

  return `hsl(${h.toFixed(0)} 70% 38%)`;
}

function gradientForThreshold(thr){
  const t = clamp(Math.round(Number(thr)), 0, 100);
  const a = `${t}%`;

  return `linear-gradient(90deg,
    hsl(10 70% 38%) 0%,
    hsl(45 75% 38%) ${a},
    hsl(120 55% 34%) 100%
  )`;
}

function getSoilMoistureDisplay(run){
  try{
    const r = run || {};

    const value =
      safeNum(r.storageFinal) ??
      safeNum(r.storageForReadiness) ??
      safeNum(r.storagePhysFinal);

    const cap =
      safeNum(r.storageMax) ??
      safeNum(r.storageCapacity) ??
      safeNum(r.storageMaxFinal) ??
      safeNum(r && r.factors && r.factors.Smax);

    return { value, cap };
  }catch(_){
    return { value:null, cap:null };
  }
}

function getSurfaceWetnessDisplay(run){
  try{
    const r = run || {};

    const value =
      safeNum(r.surfaceFinal) ??
      safeNum(r.surfaceStorageFinal) ??
      safeNum(r.storagePhysFinal) ??
      safeNum(r && r.trace && r.trace.length ? r.trace[r.trace.length - 1].after : null);

    return { value };
  }catch(_){
    return { value:null };
  }
}

function mapEls(){
  return {
    backdrop: $('mapBackdrop'),
    canvas: $('fvMapCanvas'),
    sub: $('mapSub'),
    latlng: $('mapLatLng'),
    err: $('mapError'),
    wrap: $('mapWrap'),
    btnX: $('btnMapX')
  };
}

function showMapModal(on){
  const { backdrop } = mapEls();
  if (backdrop) backdrop.classList.toggle('pv-hide', !on);
}

function setMapError(msg){
  const { err, wrap } = mapEls();

  if (err){
    if (!msg){
      err.style.display = 'none';
      err.textContent = '';
    } else {
      err.style.display = 'block';
      err.textContent = String(msg);
    }
  }

  if (wrap) wrap.style.opacity = msg ? '0.65' : '1';
}

function waitForGoogleMaps(timeoutMs = 8000){
  const t0 = Date.now();

  return new Promise((resolve, reject)=>{
    const tick = ()=>{
      if (window.google && window.google.maps) return resolve(window.google.maps);

      if (Date.now() - t0 > timeoutMs){
        return reject(new Error('Google Maps is still loading. Try again in a moment.'));
      }

      setTimeout(tick, 50);
    };

    tick();
  });
}

async function openMapForField(state, field){
  const { canvas, sub, latlng } = mapEls();

  if (!field || !field.location || !canvas){
    setMapError('Map unavailable for this field.');
    showMapModal(true);
    return;
  }

  const lat = Number(field.location.lat);
  const lng = Number(field.location.lng);

  if (!isFinite(lat) || !isFinite(lng)){
    setMapError('Invalid GPS coordinates.');
    showMapModal(true);
    return;
  }

  if (sub) sub.textContent = (field.name ? `${field.name}` : 'Field') + ' • HYBRID';
  if (latlng) latlng.textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

  setMapError('');
  showMapModal(true);

  try{
    const maps = await waitForGoogleMaps();
    const center = { lat, lng };

    if (!state._qvGMap){
      state._qvGMap = new maps.Map(canvas, {
        center,
        zoom: 16,
        mapTypeId: maps.MapTypeId.HYBRID,
        streetViewControl: false,
        fullscreenControl: false,
        mapTypeControl: true,
        clickableIcons: false
      });
    } else {
      state._qvGMap.setCenter(center);
      state._qvGMap.setZoom(16);
      state._qvGMap.setMapTypeId(maps.MapTypeId.HYBRID);
    }

    if (!state._qvGMarker){
      state._qvGMarker = new maps.Marker({
        position: center,
        map: state._qvGMap
      });
    } else {
      state._qvGMarker.setMap(state._qvGMap);
      state._qvGMarker.setPosition(center);
    }

    setTimeout(()=>{
      try{ maps.event.trigger(state._qvGMap, 'resize'); }catch(_){}
      try{ state._qvGMap.setCenter(center); }catch(_){}
    }, 60);
  }catch(e){
    console.warn('[FieldReadiness] map open failed:', e);
    setMapError(e && e.message ? e.message : 'Map failed to load.');
  }
}

function hideQuickViewForMap(state){
  try{
    const qv = $('frQvBackdrop');
    if (!qv) return;

    state._qvHiddenForMap = true;
    qv.classList.add('pv-hide');
  }catch(_){}
}

function restoreQuickViewAfterMap(state){
  try{
    if (!state._qvHiddenForMap) return;

    const qv = $('frQvBackdrop');
    if (!qv) return;

    qv.classList.remove('pv-hide');
    state._qvHiddenForMap = false;
  }catch(_){}
}

async function getQuickViewMrmsRainText(state, fieldId, range){
  try{
    const doc = await loadFieldMrmsDoc(state, String(fieldId), { force:false });
    const res = mrmsRainInRange(doc, range);

    if (!res || res.ready !== true) return 'Processing Data';

    return `${Number(res.inches || 0).toFixed(2)} in`;
  }catch(_){
    return 'Processing Data';
  }
}

function getModelRainSourceLabel(run){
  try{
    const rows = Array.isArray(run && run.rows) ? run.rows : [];
    if (!rows.length) return safeStr(run && run.weatherSource) || 'FarmVista Engine';

    let mrmsCount = 0;
    let omCount = 0;

    for (const r of rows){
      const src = String(r && r.rainSource || '').toLowerCase();

      if (src === 'mrms') mrmsCount++;
      else if (src) omCount++;
    }

    if (mrmsCount > 0 && omCount === 0) return 'MRMS';
    if (mrmsCount > 0 && omCount > 0) return 'Mixed';

    return 'Open-Meteo';
  }catch(_){
    return 'FarmVista Engine';
  }
}

function ensureBuiltOnce(state){
  if (state._qvBuilt) return;
  state._qvBuilt = true;

  const wrap = document.createElement('div');
  wrap.id = 'frQvBackdrop';
  wrap.className = 'modal-backdrop pv-hide';
  wrap.setAttribute('role','dialog');
  wrap.setAttribute('aria-modal','true');

  wrap.innerHTML = `
    <style>
      #frQvBackdrop{
        align-items:flex-start !important;
        padding-top: calc(env(safe-area-inset-top, 0px) + 10px) !important;
        padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 10px) !important;
      }

      #frQvBackdrop .modal{
        width: min(760px, 96vw);
        max-height: calc(100svh - 20px);
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }

      #frQvBackdrop .modal-h{
        position: sticky;
        top: 0;
        z-index: 2;
        background: var(--surface);
        border-bottom: 1px solid var(--border);
        padding: 14px 56px 10px 14px;
      }

      #frQvBackdrop .modal-b{
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
        padding: 14px;
        padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 18px);
      }

      #frQvX{
        width: 44px !important;
        height: 44px !important;
        border-radius: 14px !important;
        top: 10px !important;
        right: 10px !important;
        z-index: 3 !important;
        border: 1px solid var(--border) !important;
        background: color-mix(in srgb, var(--surface) 92%, #ffffff 8%) !important;
        color: var(--text) !important;
        box-shadow: 0 10px 25px rgba(0,0,0,.14) !important;
      }

      #frQvX svg{
        width:20px;
        height:20px;
      }

      #frQvX:active{
        transform: translateY(1px);
      }

      #frQvSaveClose{
        background: var(--accent, #2F6C3C) !important;
        border-color: transparent !important;
        color: #fff !important;
        border-radius: 12px !important;
        padding: 10px 14px !important;
        font-weight: 900 !important;
        box-shadow: 0 10px 26px rgba(47,108,60,.45) !important;
      }

      #frQvSaveClose:active{
        transform: translateY(1px);
      }

      #frQvSaveClose:disabled{
        opacity: .55 !important;
        cursor: not-allowed !important;
        box-shadow: none !important;
      }

      #frQvMapBtn{
        border: 1px solid var(--border) !important;
        background: color-mix(in srgb, var(--surface) 92%, #ffffff 8%) !important;
        color: var(--text) !important;
        border-radius: 10px !important;
        padding: 6px 10px !important;
        font-weight: 900 !important;
        font-size: 12px !important;
        line-height: 1 !important;
        cursor: pointer;
        user-select:none;
      }

      #frQvMapBtn:active{
        transform: translateY(1px);
      }

      #frQvMapBtn:disabled{
        opacity:.55 !important;
        cursor:not-allowed !important;
      }

      #frQvGpsRow{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:10px;
        flex-wrap:nowrap;
        min-width:0;
      }

      #frQvGpsRow .mono{
        min-width:0;
        overflow:hidden;
        text-overflow:ellipsis;
        white-space:nowrap;
      }

      .fv-range-help{
        margin-top: 6px;
        font-size: 12px;
        line-height: 1.25;
        color: var(--muted,#67706B);
      }

      .fv-range-ends{
        display:flex;
        justify-content:space-between;
        gap:10px;
        margin-top: 4px;
        font-size: 11px;
        color: var(--muted,#67706B);
        opacity: .95;
      }

      .fv-range-ends span{
        white-space:nowrap;
      }

      @media (max-width: 420px){
        #frQvBackdrop{
          padding-left: 10px !important;
          padding-right: 10px !important;
        }

        #frQvBackdrop .modal{
          width: 100%;
        }
      }
    </style>

    <div class="modal">
      <div class="modal-h">
        <h3 id="frQvTitle">Field</h3>

        <button id="frQvX" class="xbtn" type="button" aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 6L18 18M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
          </svg>
        </button>

        <div class="muted" style="font-size:12px; margin-top:4px;" id="frQvSub">—</div>
      </div>

      <div class="modal-b" style="display:grid;gap:12px;">
        <div id="frQvTilePreview"></div>

        <div class="panel" style="margin:0;" id="frQvInputsPanel">
          <h3 style="margin:0 0 8px;font-size:13px;font-weight:900;">Inputs (field-specific)</h3>

          <div style="display:grid;gap:12px;grid-template-columns:1fr 1fr;align-items:start;">
            <div class="field">
              <label for="frQvSoil">Soil Wetness</label>
              <input id="frQvSoil" type="range" min="0" max="100" step="1" value="60"/>
              <div class="fv-range-help">
                0 = Dry • 100 = Wet • Current:
                <span class="mono" id="frQvSoilVal">60</span>/100
              </div>
              <div class="fv-range-ends">
                <span>Dry (0)</span>
                <span>Wet (100)</span>
              </div>
            </div>

            <div class="field">
              <label for="frQvDrain">Drainage Index</label>
              <input id="frQvDrain" type="range" min="0" max="100" step="1" value="45"/>
              <div class="fv-range-help">
                0 = Well-drained • 100 = Poor drainage • Current:
                <span class="mono" id="frQvDrainVal">45</span>/100
              </div>
              <div class="fv-range-ends">
                <span>Well-drained (0)</span>
                <span>Poor (100)</span>
              </div>
            </div>
          </div>

          <div class="actions" style="margin-top:12px;justify-content:flex-end;">
            <div class="help muted" id="frQvHint" style="margin:0;flex:1 1 auto;align-self:center;">—</div>
            <button id="frQvSaveClose" class="btn btn-primary" type="button">Save &amp; Close</button>
          </div>
        </div>

        <div class="panel" style="margin:0;">
          <h3 style="margin:0 0 8px;font-size:13px;font-weight:900;">Field + Settings</h3>

          <div class="kv">
            <div class="k">Field</div>
            <div class="v" id="frQvFieldName">—</div>

            <div class="k">County / State</div>
            <div class="v" id="frQvCounty">—</div>

            <div class="k">Tillable</div>
            <div class="v" id="frQvAcres">—</div>

            <div class="k">GPS</div>
            <div class="v" id="frQvGpsRow">
              <span class="mono" id="frQvGps">—</span>
              <button id="frQvMapBtn" type="button">Map</button>
            </div>

            <div class="k">Operation</div>
            <div class="v" id="frQvOp">—</div>

            <div class="k">Threshold</div>
            <div class="v" id="frQvThr">—</div>
          </div>

          <div class="help" id="frQvParamExplain">—</div>
        </div>

        <div class="panel" style="margin:0;">
          <h3 style="margin:0 0 8px;font-size:13px;font-weight:900;">Weather + Output</h3>

          <div class="kv">
            <div class="k">Range rain</div>
            <div class="v" id="frQvRain">—</div>

            <div class="k">Readiness</div>
            <div class="v" id="frQvReadiness">—</div>

            <div class="k">Wetness</div>
            <div class="v" id="frQvWetness">—</div>

            <div class="k">Soil Moisture</div>
            <div class="v" id="frQvSoilMoisture">—</div>

            <div class="k">Surface Wetness</div>
            <div class="v" id="frQvSurfaceWetness">—</div>
          </div>

          <div class="help" id="frQvWxMeta">—</div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(wrap);

  const close = ()=> closeQuickView(state);
  const x = $('frQvX');

  if (x) x.addEventListener('click', close);

  wrap.addEventListener('click', e=>{
    if (e.target && e.target.id === 'frQvBackdrop') close();
  });

  (function wireMapCloseOnce(){
    if (state._qvMapWired) return;
    state._qvMapWired = true;

    const { btnX, backdrop } = mapEls();

    function closeMapAndReturn(){
      showMapModal(false);
      restoreQuickViewAfterMap(state);
    }

    if (btnX) btnX.addEventListener('click', closeMapAndReturn);

    if (backdrop){
      backdrop.addEventListener('click', e=>{
        if (e.target && e.target.id === 'mapBackdrop') closeMapAndReturn();
      });
    }
  })();

  const soil = $('frQvSoil');
  const drain = $('frQvDrain');
  const soilVal = $('frQvSoilVal');
  const drainVal = $('frQvDrainVal');

  function onSliderChange(){
    state._qvDidAdjust = true;

    state._qvPreviewValues = {
      soilWetness: clamp(Number(soil ? soil.value : 60), 0, 100),
      drainageIndex: clamp(Number(drain ? drain.value : 45), 0, 100)
    };

    if (soilVal){
      soilVal.textContent = String(
        Math.round(state._qvPreviewValues.soilWetness)
      );
    }

    if (drainVal){
      drainVal.textContent = String(
        Math.round(state._qvPreviewValues.drainageIndex)
      );
    }

    schedulePreviewRefresh(state);
  }

  if (soil) soil.addEventListener('input', onSliderChange);
  if (drain) drain.addEventListener('input', onSliderChange);

  const saveClose = $('frQvSaveClose');

  if (saveClose){
    saveClose.addEventListener('click', async ()=>{
      if (!canEdit(state)) return;
      if (state._qvSaving) return;

      await saveAndClose(state);
    });
  }

  const mapBtn = $('frQvMapBtn');

  if (mapBtn){
    mapBtn.addEventListener('click', async e=>{
      e.preventDefault();
      e.stopPropagation();

      const fid = state._qvFieldId;
      const f = fid ? state.fields.find(x=>x.id===fid) : null;

      if (!f) return;

      hideQuickViewForMap(state);
      await openMapForField(state, f);
    });
  }

  if (!state._qvRefreshWired){
    state._qvRefreshWired = true;

    document.addEventListener('fr:tile-refresh', async e=>{
      try{
        if (!state._qvOpen) return;

        const fid = e && e.detail ? String(e.detail.fieldId || '') : '';
        if (!fid) return;
        if (String(state._qvFieldId || '') !== fid) return;

        await fillQuickView(state, { live:true, immediate:true });
      }catch(_){}
    });

    document.addEventListener('fr:details-refresh', async e=>{
      try{
        if (!state._qvOpen) return;

        const fid = e && e.detail ? String(e.detail.fieldId || '') : '';
        if (!fid) return;
        if (String(state._qvFieldId || '') !== fid) return;

        await fillQuickView(state, { live:true, immediate:true });
      }catch(_){}
    });
  }
}

function schedulePreviewRefresh(state){
  try{
    if (state._qvPreviewTimer){
      clearTimeout(state._qvPreviewTimer);
      state._qvPreviewTimer = null;
    }

    const hint = $('frQvHint');
    if (hint) hint.textContent = 'Preview will update after you stop moving the slider…';

    state._qvPreviewTimer = setTimeout(()=>{
      state._qvPreviewTimer = null;
      fillQuickView(state, { live:true, immediate:true });
    }, PREVIEW_DEBOUNCE_MS);
  }catch(_){}
}

export function openQuickView(state, fieldId){
  if (!canEdit(state)) return;

  ensureBuiltOnce(state);

  const f = state.fields.find(x=>x.id===fieldId);
  if (!f) return;

  state._qvFieldId = fieldId;
  state.selectedFieldId = fieldId;
  state._qvDidAdjust = false;
  state._qvPreviewValues = null;
  state._qvPreviewRun = null;
  state._qvPreviewError = '';
  state._qvPreviewSeq = 0;

  if (state._qvPreviewTimer){
    clearTimeout(state._qvPreviewTimer);
    state._qvPreviewTimer = null;
  }

  const b = $('frQvBackdrop');

  if (b) b.classList.remove('pv-hide');

  state._qvOpen = true;

  fillQuickView(state, { live:false, immediate:true });
}

export function closeQuickView(state){
  const b = $('frQvBackdrop');

  if (b) b.classList.add('pv-hide');

  state._qvOpen = false;
  state._qvPreviewValues = null;
  state._qvPreviewRun = null;
  state._qvPreviewError = '';

  if (state._qvPreviewTimer){
    clearTimeout(state._qvPreviewTimer);
    state._qvPreviewTimer = null;
  }

  try{
    state._qvHiddenForMap = false;
  }catch(_){}
}

function setText(id, val){
  const el = $(id);
  if (el) el.textContent = String(val);
}

async function renderTilePreview(state, run, thr, etaTxt){
  const wrap = $('frQvTilePreview');
  if (!wrap) return;

  const f = state.fields.find(x=>x.id===state._qvFieldId);
  if (!f || !run) return;

  const readiness = run.readinessR;
  const range = parseRangeFromInput();
  const rainText = await getQuickViewMrmsRainText(state, f.id, range);

  const leftPos =
    state._mods &&
    state._mods.model &&
    typeof state._mods.model.markerLeftCSS === 'function'
      ? state._mods.model.markerLeftCSS(readiness)
      : `${clamp(Number(readiness),0,100)}%`;

  const thrPos =
    state._mods &&
    state._mods.model &&
    typeof state._mods.model.markerLeftCSS === 'function'
      ? state._mods.model.markerLeftCSS(thr)
      : `${clamp(Number(thr),0,100)}%`;

  const perceived = perceivedFromThreshold(readiness, thr);
  const pillBg = colorForPerceived(perceived);
  const grad = gradientForThreshold(thr);
  const eta = String(etaTxt || '').trim();

  wrap.innerHTML = `
    <div class="tile" style="cursor:default; user-select:none;">
      <div
        class="tile-top"
        style="
          display:flex;
          align-items:center;
          justify-content:space-between;
          flex-wrap:nowrap;
          gap:10px;
          width:100%;
          min-width:0;
        "
      >
        <div
          class="name"
          title="${esc(f.name || 'Field')}"
          style="
            flex:1 1 auto;
            min-width:0;
            overflow:hidden;
            text-overflow:ellipsis;
            white-space:nowrap;
            font-weight:900;
          "
        >
          ${esc(f.name || 'Field')}
        </div>

        <div
          class="readiness-pill"
          style="
            background:${pillBg};
            color:#fff;
            flex:0 0 auto;
            white-space:nowrap;
          "
        >
          Field Readiness ${readiness}
        </div>
      </div>

      <p class="subline">
        Rain (range): <span class="mono">${esc(rainText)}</span>
      </p>

      <div class="gauge-wrap">
        <div class="chips">
          <div class="chip wet">Wet</div>
          <div class="chip readiness">Readiness</div>
        </div>

        <div class="gauge" style="background:${grad};">
          <div class="thr" style="left:${thrPos};"></div>
          <div class="marker" style="left:${leftPos};"></div>
          <div
            class="badge"
            style="
              left:${leftPos};
              background:${pillBg};
              color:#fff;
              border:1px solid rgba(255,255,255,.18);
            "
          >
            Field Readiness ${readiness}
          </div>
        </div>

        <div class="ticks">
          <span>0</span>
          <span>50</span>
          <span>100</span>
        </div>

        ${eta ? `<div class="help"><b>${esc(eta)}</b></div>` : ``}
      </div>
    </div>
  `;
}

async function fillQuickView(state, { live=false, immediate=false } = {}){
  const fid = state._qvFieldId;
  const f = state.fields.find(x=>x.id===fid);

  if (!f) return;

  await loadLatestReadiness(state, { force:true });

  const opKey = getCurrentOp();
  const savedParams = getFieldParams(state, f.id);
  const previewParams = state._qvPreviewValues || null;

  const pRaw =
    live && previewParams
      ? {
          ...savedParams,
          soilWetness: previewParams.soilWetness,
          drainageIndex: previewParams.drainageIndex
        }
      : savedParams;

  const latestRec = getLatestReadinessForField(state, fid);
  const latestRun = buildSyntheticRunFromLatest(state, f, latestRec);

  const previewMode = !!live || !!state._qvDidAdjust;

  let previewRun = state._qvPreviewRun || null;

  if (previewMode && immediate){
    const seq = Number(state._qvPreviewSeq || 0) + 1;
    state._qvPreviewSeq = seq;
    state._qvPreviewLoading = true;
    state._qvPreviewError = '';

    const hint = $('frQvHint');
    if (hint) hint.textContent = 'Calculating live preview…';

    const res = await callPreviewEndpoint(state, f, pRaw);

    if (seq !== state._qvPreviewSeq) return;

    state._qvPreviewLoading = false;

    if (res && res.ok){
      previewRun = res;
      state._qvPreviewRun = res;
      state._qvPreviewError = '';
    } else {
      state._qvPreviewError = res && res.error ? res.error : 'Preview failed';
    }
  }

  const displayRun =
    previewMode
      ? (previewRun || latestRun)
      : latestRun;

  const farmName =
    (latestRec && latestRec.farmName) ||
    state.farmsById.get(f.farmId) ||
    '';

  const opLabel = (OPS.find(o=>o.key===opKey)?.label) || opKey;
  const thr = getThresholdForOp(state, opKey);

  const title = $('frQvTitle');
  const sub = $('frQvSub');

  if (title) title.textContent = f.name || 'Field';

  if (sub){
    let sourceTag = 'Centralized readiness';

    if (previewMode && state._qvPreviewLoading) sourceTag = 'Live preview calculating';
    else if (previewMode && previewRun) sourceTag = 'Live preview';
    else if (previewMode && state._qvPreviewError) sourceTag = 'Preview unavailable';
    else if (!latestRun) sourceTag = 'No centralized readiness';

    sub.textContent = farmName ? `${farmName} • ${sourceTag}` : sourceTag;
  }

  const soil = $('frQvSoil');
  const drain = $('frQvDrain');
  const soilVal = $('frQvSoilVal');
  const drainVal = $('frQvDrainVal');

  if (!live){
    if (soil) soil.value = String(pRaw.soilWetness);
    if (drain) drain.value = String(pRaw.drainageIndex);

    if (soilVal){
      soilVal.textContent = String(
        Math.round(Number(pRaw.soilWetness || 0))
      );
    }

    if (drainVal){
      drainVal.textContent = String(
        Math.round(Number(pRaw.drainageIndex || 0))
      );
    }
  }

  const hint = $('frQvHint');
  const saveBtn = $('frQvSaveClose');
  const inputsPanel = $('frQvInputsPanel');

  if (!canEdit(state)){
    if (hint) hint.textContent = 'View only. You do not have edit permission.';
    if (saveBtn) saveBtn.disabled = true;
    if (inputsPanel) inputsPanel.style.opacity = '0.75';
  } else {
    if (previewMode && state._qvPreviewLoading){
      if (hint) hint.textContent = 'Calculating live preview…';
    } else if (previewMode && state._qvPreviewError){
      if (hint) hint.textContent = `Preview failed: ${state._qvPreviewError}`;
    } else if (previewMode){
      if (hint) hint.textContent = 'Live preview only. Save & Close writes these slider settings.';
    } else {
      if (hint) hint.textContent = 'Move sliders to preview readiness live. Save & Close updates Firestore.';
    }

    if (saveBtn) saveBtn.disabled = false;
    if (inputsPanel) inputsPanel.style.opacity = '1';
  }

  setText(
    'frQvFieldName',
    farmName ? `${farmName} • ${f.name}` : (f.name || '—')
  );

  setText(
    'frQvCounty',
    `${String((latestRec && latestRec.county) || f.county || '—')} / ${String((latestRec && latestRec.state) || f.state || '—')}`
  );

  setText(
    'frQvAcres',
    isFinite(f.tillable) ? `${f.tillable.toFixed(2)} ac` : '—'
  );

  const gpsText =
    f.location
      ? `${f.location.lat.toFixed(6)}, ${f.location.lng.toFixed(6)}`
      : '—';

  setText('frQvGps', gpsText);

  const mapBtn = $('frQvMapBtn');
  if (mapBtn) mapBtn.disabled = !(f && f.location);

  setText('frQvOp', opLabel);
  setText('frQvThr', thr);

  const range = parseRangeFromInput();
  const rainText = await getQuickViewMrmsRainText(state, fid, range);

  setText('frQvRain', rainText);

  setText(
    'frQvReadiness',
    displayRun && Number.isFinite(Number(displayRun.readinessR))
      ? displayRun.readinessR
      : '—'
  );

  setText(
    'frQvWetness',
    displayRun && Number.isFinite(Number(displayRun.wetnessR))
      ? displayRun.wetnessR
      : '—'
  );

  let soilMoistureText = '—';

  {
    const tank = getSoilMoistureDisplay(displayRun);
    const v = safeNum(tank.value);
    const c = safeNum(tank.cap);

    if (v != null && c != null){
      soilMoistureText = `${v.toFixed(2)} / ${c.toFixed(2)}`;
    } else if (v != null){
      soilMoistureText = `${v.toFixed(2)}`;
    }
  }

  setText('frQvSoilMoisture', soilMoistureText);

  let surfaceWetnessText = '—';

  {
    const sw = getSurfaceWetnessDisplay(displayRun);
    const v = safeNum(sw.value);

    if (v != null){
      surfaceWetnessText = `${v.toFixed(2)}`;
    }
  }

  setText('frQvSurfaceWetness', surfaceWetnessText);

  const wxMeta = $('frQvWxMeta');

  if (wxMeta){
    const centralR =
      (latestRun && isFinite(Number(latestRun.readinessR)))
        ? Number(latestRun.readinessR)
        : null;

    const shownR =
      (displayRun && isFinite(Number(displayRun.readinessR)))
        ? Number(displayRun.readinessR)
        : null;

    const previewR =
      (previewRun && isFinite(Number(previewRun.readinessR)))
        ? Number(previewRun.readinessR)
        : null;

    const rainSource = getModelRainSourceLabel(displayRun);
    const whenTxt =
      (displayRun && displayRun.computedAtISO)
        ? new Date(displayRun.computedAtISO).toLocaleString()
        : '—';

    wxMeta.innerHTML =
      `Weather updated: <span class="mono">${esc(whenTxt)}</span>` +
      ` • Model rain: <span class="mono">${esc(rainSource)}</span>` +
      (shownR != null ? ` • Shown: <span class="mono">${shownR}</span>` : ``) +
      (centralR != null ? ` • Centralized: <span class="mono">${centralR}</span>` : ``) +
      (previewR != null ? ` • Preview: <span class="mono">${previewR}</span>` : ``);
  }

  const pe = $('frQvParamExplain');

  if (pe){
    pe.innerHTML =
      `soil=<span class="mono">${Math.round(Number(pRaw.soilWetness || 0))}</span>/100 • ` +
      `drain=<span class="mono">${Math.round(Number(pRaw.drainageIndex || 0))}</span>/100`;
  }

  await renderTilePreview(state, displayRun, thr, '');
}

async function saveAndClose(state){
  const fid = state._qvFieldId;
  const f = state.fields.find(x=>x.id===fid);

  if (!f) return;

  const soil = $('frQvSoil');
  const drain = $('frQvDrain');
  const btn = $('frQvSaveClose');
  const hint = $('frQvHint');

  const soilWetness = clamp(Number(soil ? soil.value : 60), 0, 100);
  const drainageIndex = clamp(Number(drain ? drain.value : 45), 0, 100);

  state._qvSaving = true;

  if (btn){
    btn.disabled = true;
    btn.textContent = 'Saving…';
  }

  if (hint) hint.textContent = 'Saving…';

  try{
    let runTruth = null;

    const previewMatches =
      state._qvPreviewRun &&
      state._qvPreviewRun._previewValues &&
      Number(state._qvPreviewRun._previewValues.soilWetness) === Number(soilWetness) &&
      Number(state._qvPreviewRun._previewValues.drainageIndex) === Number(drainageIndex);

    if (previewMatches){
      runTruth = state._qvPreviewRun;
    } else {
      if (hint) hint.textContent = 'Calculating final preview before save…';

      const res = await callPreviewEndpoint(state, f, {
        soilWetness,
        drainageIndex
      });

      if (!res || !res.ok){
        throw new Error(res && res.error ? res.error : 'Preview failed before save');
      }

      runTruth = res;
    }

    const p = getFieldParams(state, fid);

    p.soilWetness = soilWetness;
    p.drainageIndex = drainageIndex;

    state.perFieldParams.set(fid, p);
    saveParamsToLocal(state);

    f.soilWetness = soilWetness;
    f.drainageIndex = drainageIndex;

    const api = getAPI(state);

    if (api && api.kind !== 'compat'){
      const db = api.getFirestore();
      const auth = api.getAuth ? api.getAuth() : null;
      const user = auth && auth.currentUser ? auth.currentUser : null;
      const ref = api.doc(db, 'fields', fid);

      await api.updateDoc(ref, {
        soilWetness,
        drainageIndex,
        updatedAt: api.serverTimestamp ? api.serverTimestamp() : new Date().toISOString(),
        updatedBy: user ? (user.email || user.uid || null) : null
      });
    } else if (api && api.kind === 'compat' && window.firebase && window.firebase.firestore){
      const db = window.firebase.firestore();

      await db.collection('fields').doc(fid).set({
        soilWetness,
        drainageIndex,
        updatedAt: new Date().toISOString()
      }, { merge:true });
    }

    await persistFieldConditionsForField(state, f, runTruth);
    await persistLatestReadinessForField(state, f, runTruth);

    state._qvDidAdjust = false;
    state._qvPreviewValues = null;
    state._qvPreviewRun = null;
    state._qvPreviewError = '';

    try{
      document.dispatchEvent(
        new CustomEvent('fr:tile-refresh', {
          detail:{ fieldId: fid }
        })
      );
    }catch(_){}

    try{
      document.dispatchEvent(
        new CustomEvent('fr:details-refresh', {
          detail:{ fieldId: fid }
        })
      );
    }catch(_){}

    closeQuickView(state);
  }catch(e){
    console.warn('[FieldReadiness] Save & Close failed:', e);

    if (hint) hint.textContent = `Save failed: ${e.message || e}`;

    if (btn){
      btn.disabled = false;
      btn.textContent = 'Save & Close';
    }

    state._qvSaving = false;
    return;
  }

  state._qvSaving = false;

  if (btn){
    btn.disabled = false;
    btn.textContent = 'Save & Close';
  }

  if (hint) hint.textContent = 'Saved.';
}