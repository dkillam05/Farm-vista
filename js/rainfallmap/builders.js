/* ======================================================================
/Farm-vista/js/rainfallmap/builders.js   (FULL FILE)
Rev: 2026-03-15b-labeled-builder-file

GOAL
✔ Readiness mode uses centralized field_readiness_latest first
✔ Map readiness matches render.js / quickview.js / global-calibration.js
✔ Keeps fallback path available for fields missing latest docs
✔ Keeps rainfall-map Firebase bridge working

IMPORTANT NOTE
Rainfall date-range switching is NOT fully fixed in this file yet because
the rain builder below does not currently pass the selected date range into
buildFieldPoints() or buildRainSummary(). The real rainfall-range math is
very likely inside rain-data.js and must be updated there.
====================================================================== */

import {
  collection,
  getDocs,
  query,
  where,
  doc,
  getDoc
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import { appState } from './store.js';
import {
  loadMrmsDocs,
  loadPersistedStateMap
} from './data-loaders.js';

import { getSelectedFarmId } from './selection.js';
import {
  hasUsableRainData,
  buildFieldPoints,
  buildRainSummary,
  totalRainInLast72h
} from './rain-data.js';

import { setDebug } from './dom.js';
import { computeReadinessRunForMapField } from './readiness-core.js';

import {
  loadFields as loadFrFields,
  loadFarmsOptional,
  fetchAndHydrateFieldParams
} from '/Farm-vista/js/field-readiness/data.js';

import { ensureFRModules } from '/Farm-vista/js/field-readiness/formula.js';
import { getCurrentOp } from '/Farm-vista/js/field-readiness/thresholds.js';

/* =====================================================================
   Centralized readiness collection
===================================================================== */
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

async function loadLatestReadinessMapForState(state){
  try{
    const fb = state && state.fb ? state.fb : null;
    if (!fb || typeof fb.getFirestore !== 'function') return {};

    const db = fb.getFirestore();
    const colRef = fb.collection(db, FR_LATEST_COLLECTION);
    const snap = await fb.getDocs(colRef);

    const out = {};
    snap.forEach(docSnap=>{
      const rec = buildLatestReadinessRecord(docSnap.data() || {}, docSnap.id);
      if (!rec || !rec.fieldId) return;
      out[String(rec.fieldId)] = rec;
    });

    state.latestReadinessByFieldId = out;
    state._latestReadinessLoadedAt = Date.now();
    return out;
  }catch(e){
    console.warn('[WeatherMap] latest readiness load failed:', e);
    state.latestReadinessByFieldId = state.latestReadinessByFieldId || {};
    state._latestReadinessLoadedAt = Date.now();
    return state.latestReadinessByFieldId;
  }
}

/* =====================================================================
   Rain builder
===================================================================== */

export async function buildRainRenderableRows(requestId, force=false){
  const rows = await loadMrmsDocs(force);
  if (requestId !== appState.currentRequestId) return { cancelled:true };

  const selectedFarmId = getSelectedFarmId();

  const usableRows = rows.filter(row=>{
    if (!hasUsableRainData(row.raw)) return false;
    if (!selectedFarmId) return true;
    return String(row.farmId || '') === String(selectedFarmId);
  });

  const points = [];
  const summaries = [];
  const renderedFields = [];

  usableRows.forEach(row=>{
    const fieldPoints = buildFieldPoints(row);
    const summary = buildRainSummary(row);

    if (!fieldPoints.length || !summary) return;

    renderedFields.push({
      fieldId: row.fieldId,
      fieldName: row.fieldName,
      farmId: row.farmId,
      lat: row.location.lat,
      lng: row.location.lng
    });

    summaries.push(summary);
    points.push(...fieldPoints);
  });

  return { points, summaries, renderedFields };
}

/* =====================================================================
   Readiness helpers
===================================================================== */

function resetReadinessRunCaches(state){
  try{
    state.lastRuns = new Map();

    if (state._frModelWxCache instanceof Map) state._frModelWxCache.clear();
    else state._frModelWxCache = new Map();

    if (state._frForecastCache instanceof Map) state._frForecastCache.clear();
    else state._frForecastCache = new Map();

    if (state._frForecastMetaByFieldId instanceof Map) state._frForecastMetaByFieldId.clear();
    else state._frForecastMetaByFieldId = new Map();

    if (state.weatherByFieldId instanceof Map) state.weatherByFieldId.clear();
    else state.weatherByFieldId = new Map();

    if (state.wxInfoByFieldId instanceof Map) state.wxInfoByFieldId.clear();
    else state.wxInfoByFieldId = new Map();

    if (state.mrmsByFieldId instanceof Map) state.mrmsByFieldId.clear();
    else state.mrmsByFieldId = new Map();

    if (state.mrmsInfoByFieldId instanceof Map) state.mrmsInfoByFieldId.clear();
    else state.mrmsInfoByFieldId = new Map();

    if (state._mrmsDocByFieldId instanceof Map) state._mrmsDocByFieldId.clear();
    else state._mrmsDocByFieldId = new Map();

    if (state._mrmsDocLoadedAtByFieldId instanceof Map) state._mrmsDocLoadedAtByFieldId.clear();
    else state._mrmsDocLoadedAtByFieldId = new Map();

    state.weather30 = [];
  }catch(_){}
}

function installFieldReadinessFirebaseAdapter(state){
  try{
    const dbRef = appState.dbRef || null;
    const authRef = appState.authRef || null;

    if (!dbRef) {
      throw new Error('rainfall map dbRef missing');
    }

    state.fb = {
      ready: Promise.resolve(),
      getFirestore: ()=> dbRef,
      getAuth: ()=> authRef,
      collection,
      getDocs,
      query,
      where,
      doc,
      getDoc
    };
  }catch(e){
    console.warn('[WeatherMap] failed to install FR firebase adapter:', e);
    state.fb = null;
  }
}

function getFilteredActiveFieldsFromReadinessState(state, selectedFarmId){
  const list = Array.isArray(state && state.fields) ? state.fields : [];
  return list.filter(f=>{
    if (!f || !f.id) return false;
    if (!f.location) return false;

    const lat = Number(f.location.lat);
    const lng = Number(f.location.lng);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    if (selectedFarmId && String(f.farmId || '') !== String(selectedFarmId)) return false;

    return true;
  });
}

/* =====================================================================
   Readiness builder
===================================================================== */

export async function buildReadinessRenderableRows(requestId, force=false){
  const selectedFarmId = getSelectedFarmId();
  const state = appState.readinessState;

  const [mrmsRows, persistedMap] = await Promise.all([
    loadMrmsDocs(force),
    loadPersistedStateMap(force)
  ]);

  if (requestId !== appState.currentRequestId) return { cancelled:true };

  resetReadinessRunCaches(state);

  state.farmFilter = selectedFarmId || '__all__';
  state.pageSize = -1;
  state.persistedStateByFieldId = persistedMap || {};
  state._persistLoadedAt = Date.now();

  installFieldReadinessFirebaseAdapter(state);

  await ensureFRModules(state);

  await loadFarmsOptional(state);
  await loadFrFields(state);

  if (requestId !== appState.currentRequestId) return { cancelled:true };

  const latestByFieldId = await loadLatestReadinessMapForState(state);

  if (requestId !== appState.currentRequestId) return { cancelled:true };

  const fields = getFilteredActiveFieldsFromReadinessState(state, selectedFarmId);
  const farmMap = (state.farmsById instanceof Map) ? state.farmsById : new Map();
  const opKey = getCurrentOp();

  const mrmsByFieldId = new Map();
  (Array.isArray(mrmsRows) ? mrmsRows : []).forEach(r=>{
    if (r && r.fieldId) mrmsByFieldId.set(String(r.fieldId), r);
  });

  const renderedFields = [];
  const summaries = [];

  for (let i = 0; i < fields.length; i++){
    if (requestId !== appState.currentRequestId) return { cancelled:true };

    const f = fields[i];
    const fid = String(f.id);
    const lat = Number(f.location.lat);
    const lng = Number(f.location.lng);

    setDebug(`building readiness ${i+1}/${fields.length} • ${f.name} • op=${opKey}`);

    try{
      await fetchAndHydrateFieldParams(state, f.id);
    }catch(e){
      console.warn('[WeatherMap] field params load failed', f.id, e);
    }

    let run = null;

    const latest = latestByFieldId ? latestByFieldId[fid] : null;
    if (latest && Number.isFinite(Number(latest.readiness))){
      run = {
        ok: true,
        source: 'field_readiness_latest',
        sourceLabel: 'field_readiness_latest',
        fieldId: fid,
        readinessR: Number(latest.readiness),
        readiness: Number(latest.readiness),
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
    } else {
      run = await computeReadinessRunForMapField(
        state,
        {
          id: fid,
          fieldId: fid,
          name: String(f.name || 'Field'),
          farmId: String(f.farmId || ''),
          county: String(f.county || ''),
          state: String(f.state || ''),
          location: { lat, lng }
        },
        opKey
      );
    }

    if (!run) continue;

    const readiness = Number(run.readinessR);
    if (!Number.isFinite(readiness)) continue;

    const mrmsRow = mrmsByFieldId.get(fid) || null;
    const rain72hInches = totalRainInLast72h(mrmsRow ? mrmsRow.raw : null);

    const rendered = {
      kind: 'readiness',
      fieldId: fid,
      fieldName: String(f.name || 'Field'),
      farmId: String(f.farmId || ''),
      farmName: String((latest && latest.farmName) || farmMap.get(String(f.farmId || '')) || ''),
      county: String((latest && latest.county) || f.county || ''),
      state: String((latest && latest.state) || f.state || ''),
      lat,
      lng,
      readiness,
      wetness: Number.isFinite(Number(run.wetnessR)) ? Number(run.wetnessR) : null,
      rain72hInches,
      source: String(run.source || run.sourceLabel || (latest ? 'field_readiness_latest' : 'model'))
    };

    renderedFields.push(rendered);
    summaries.push(rendered);
    state.lastRuns.set(fid, run);
  }

  return { summaries, renderedFields };
}
