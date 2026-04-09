/* ======================================================================
/Farm-vista/js/rainfallmap/builders.js   (FULL FILE)
Rev: 2026-04-09a-readiness-map-latest-only-stable

GOAL
✔ Rainfall path stays intact
✔ Readiness map becomes a simple display layer
✔ Readiness reads from field_readiness_latest only
✔ No fallback model compute on the map page
✔ No persisted-state dependency for readiness rendering
✔ No field param hydration for readiness rendering
✔ Reduced failure points on refresh / reopen
✔ Keeps local overlay cache for fast reopen and temporary fallback

IMPORTANT
This file intentionally makes readiness rendering SIMPLE:
- load active fields
- load field_readiness_latest
- join by fieldId
- draw markers/blobs

If a field does not have a latest readiness doc, it is skipped.
The map page should not try to recompute readiness.
====================================================================== */

import {
  collection,
  getDocs,
  query,
  where
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import { appState } from './store.js';
import { loadMrmsDocs } from './data-loaders.js';
import { getSelectedFarmId } from './selection.js';
import {
  hasUsableRainData,
  buildFieldPoints,
  buildRainSummary
} from './rain-data.js';
import {
  loadFields as loadFrFields,
  loadFarmsOptional
} from '/Farm-vista/js/field-readiness/data.js';

/* =====================================================================
   Centralized readiness collection
===================================================================== */
const FR_LATEST_COLLECTION = 'field_readiness_latest';

/* =====================================================================
   Overlay cache (1 hour TTL)
===================================================================== */
const OVERLAY_CACHE_TTL_MS = 60 * 60 * 1000;

function safeStorageGet(key){
  try{
    return localStorage.getItem(key);
  }catch(_){
    return null;
  }
}

function safeStorageSet(key, value){
  try{
    localStorage.setItem(key, value);
  }catch(_){}
}

function getCurrentRangeCachePart(){
  const start = String(appState.currentRangeStartISO || '').trim();
  const end = String(appState.currentRangeEndISO || '').trim();
  if (start || end) return `custom:${start}|${end}`;
  return String(appState.currentRangeKey || 'last72h');
}

function makeRainCacheKey(){
  const farmId = String(getSelectedFarmId() || 'ALL');
  const rangePart = getCurrentRangeCachePart();
  return `fv_rainfallmap_overlay_rain_v1|farm:${farmId}|range:${rangePart}`;
}

function makeReadinessCacheKey(){
  const farmId = String(getSelectedFarmId() || 'ALL');
  return `fv_rainfallmap_overlay_ready_v2|farm:${farmId}`;
}

function readOverlayCache(key){
  try{
    const raw = safeStorageGet(key);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.savedAt || !parsed.data) return null;

    return parsed;
  }catch(_){
    return null;
  }
}

function writeOverlayCache(key, data){
  try{
    safeStorageSet(key, JSON.stringify({
      savedAt: Date.now(),
      data
    }));
  }catch(_){}
}

function isOverlayCacheFresh(entry){
  if (!entry || !entry.savedAt) return false;
  return (Date.now() - Number(entry.savedAt)) <= OVERLAY_CACHE_TTL_MS;
}

/* =====================================================================
   Safe helpers
===================================================================== */
function safeObj(x){
  return (x && typeof x === 'object') ? x : null;
}

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

/* =====================================================================
   Readiness latest doc normalization
===================================================================== */
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

/* =====================================================================
   Firebase adapter for field-readiness data.js helpers
===================================================================== */
function installFieldReadinessFirebaseAdapter(state){
  try{
    const dbRef = appState.dbRef || null;
    const authRef = appState.authRef || null;

    if (!dbRef){
      throw new Error('rainfall map dbRef missing');
    }

    state.fb = {
      ready: Promise.resolve(),
      getFirestore: ()=> dbRef,
      getAuth: ()=> authRef,
      collection,
      getDocs,
      query,
      where
    };
  }catch(e){
    console.warn('[WeatherMap] failed to install FR firebase adapter:', e);
    state.fb = null;
  }
}

/* =====================================================================
   Field filtering
===================================================================== */
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
   Latest readiness load
===================================================================== */
async function loadLatestReadinessMap(selectedFarmId){
  const db = appState.dbRef || null;
  if (!db){
    throw new Error('readiness dbRef missing');
  }

  const colRef = collection(db, FR_LATEST_COLLECTION);

  const snap = selectedFarmId
    ? await getDocs(query(colRef, where('farmId', '==', String(selectedFarmId))))
    : await getDocs(colRef);

  const out = {};

  snap.forEach(docSnap=>{
    const rec = buildLatestReadinessRecord(docSnap.data() || {}, docSnap.id);
    if (!rec || !rec.fieldId) return;
    out[String(rec.fieldId)] = rec;
  });

  return out;
}

/* =====================================================================
   Rain builder
===================================================================== */
export async function buildRainRenderableRows(requestId, force = false){
  const cacheKey = makeRainCacheKey();
  const cached = !force ? readOverlayCache(cacheKey) : null;

  if (!force && cached && cached.data){
    if (requestId !== appState.currentRequestId) return { cancelled: true };

    if (!isOverlayCacheFresh(cached)){
      setTimeout(()=>{
        buildRainRenderableRows(requestId, true).catch(()=>{});
      }, 0);
    }

    return cached.data;
  }

  const rows = await loadMrmsDocs(force);
  if (requestId !== appState.currentRequestId) return { cancelled: true };

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

  const result = { points, summaries, renderedFields };
  writeOverlayCache(cacheKey, result);
  return result;
}

/* =====================================================================
   Readiness builder
===================================================================== */
export async function buildReadinessRenderableRows(requestId, force = false){
  const cacheKey = makeReadinessCacheKey();
  const cached = readOverlayCache(cacheKey);

  if (!force && cached && cached.data){
    if (requestId !== appState.currentRequestId) return { cancelled: true };

    if (!isOverlayCacheFresh(cached)){
      setTimeout(()=>{
        buildReadinessRenderableRows(requestId, true).catch(()=>{});
      }, 0);
    }

    return cached.data;
  }

  const selectedFarmId = getSelectedFarmId();
  const state = appState.readinessState || (appState.readinessState = {});

  installFieldReadinessFirebaseAdapter(state);

  if (!state.fb){
    if (cached && cached.data) return cached.data;
    throw new Error('readiness firebase adapter unavailable');
  }

  state.farmFilter = selectedFarmId || '__all__';
  state.pageSize = -1;

  await loadFarmsOptional(state);
  await loadFrFields(state);

  if (requestId !== appState.currentRequestId) return { cancelled: true };

  const fields = getFilteredActiveFieldsFromReadinessState(state, selectedFarmId);
  const farmMap = (state.farmsById instanceof Map) ? state.farmsById : new Map();

  let latestByFieldId = {};
  try{
    latestByFieldId = await loadLatestReadinessMap(selectedFarmId);
  }catch(e){
    console.warn('[WeatherMap] latest readiness load failed:', e);

    if (cached && cached.data){
      return cached.data;
    }

    throw e;
  }

  if (requestId !== appState.currentRequestId) return { cancelled: true };

  const renderedFields = [];
  const summaries = [];

  for (let i = 0; i < fields.length; i++){
    if (requestId !== appState.currentRequestId) return { cancelled: true };

    const f = fields[i];
    const fid = String(f.id);
    const lat = Number(f.location.lat);
    const lng = Number(f.location.lng);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const latest = latestByFieldId ? latestByFieldId[fid] : null;
    if (!latest) continue;

    const readiness = Number(latest.readiness);
    if (!Number.isFinite(readiness)) continue;

    const wetness = Number(latest.wetness);
    const rendered = {
      kind: 'readiness',
      fieldId: fid,
      fieldName: String(latest.fieldName || f.name || 'Field'),
      farmId: String(latest.farmId || f.farmId || ''),
      farmName: String(latest.farmName || farmMap.get(String(f.farmId || '')) || ''),
      county: String(latest.county || f.county || ''),
      state: String(latest.state || f.state || ''),
      lat,
      lng,

      readiness,
      wetness: Number.isFinite(wetness) ? wetness : null,
      rain72hInches: null,

      source: 'field_readiness_latest',
      runKey: safeStr(latest.runKey),
      seedSource: safeStr(latest.seedSource),
      weatherSource: safeStr(latest.weatherSource),
      computedAtISO: safeStr(latest.computedAtISO),
      weatherFetchedAtISO: safeStr(latest.weatherFetchedAtISO),

      storageFinal: safeNum(latest.storageFinal),
      storageForReadiness: safeNum(latest.storageForReadiness),
      storagePhysFinal: safeNum(latest.storagePhysFinal)
    };

    renderedFields.push(rendered);
    summaries.push(rendered);
  }

  const result = { summaries, renderedFields };
  writeOverlayCache(cacheKey, result);
  return result;
}