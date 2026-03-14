/* ======================================================================
   /Farm-vista/js/rainfallmap/data-loaders.js
   FULL FILE REBUILD
   Fix:
   - rainfall map now warms weather caches so readiness model
     gets the same Open-Meteo inputs as Quick View
====================================================================== */

import {
  collection,
  getDocs
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import {
  MRMS_COLLECTION,
  FIELDS_COLLECTION,
  FARMS_COLLECTION,
  FR_STATE_COLLECTION,
  CACHE_TTL_MS
} from './config.js';

import { appState } from './store.js';
import { initFirebase } from './firebase.js';
import { retry, toNum, isPermissionError } from './utils.js';

/* readiness modules */
import { ensureFRModules } from '/Farm-vista/js/field-readiness/formula.js';
import { buildWxCtx } from '/Farm-vista/js/field-readiness/state.js';

/* =====================================================================
   Normalizers (unchanged)
===================================================================== */

export function normalizeFieldDoc(docId, d){
  const lat = toNum(
    d && (
      d.lat ??
      d.latitude ??
      (d.location && (d.location.lat ?? d.location.latitude))
    )
  );

  const lng = toNum(
    d && (
      d.lng ??
      d.lon ??
      d.longitude ??
      (d.location && (d.location.lng ?? d.location.lon ?? d.location.longitude))
    )
  );

  const fieldId = String((d && (d.fieldId || d.id || docId)) || docId || '').trim();
  if (!fieldId) return null;

  const fieldName = String((d && (d.fieldName || d.name || d.field || d.label)) || 'Field').trim() || 'Field';

  return {
    id: fieldId,
    fieldId,
    name: fieldName,
    farmId: String(d?.farmId || ''),
    county: String(d?.county || ''),
    state: String(d?.state || ''),
    location: (lat != null && lng != null) ? { lat, lng } : null,
    raw: d || {}
  };
}

export function normalizeMrmsDoc(docId, d){
  const lat = toNum(d?.location?.lat);
  const lng = toNum(d?.location?.lng);
  if (lat == null || lng == null) return null;

  return {
    docId: String(docId || ''),
    fieldId: String(d?.fieldId || docId),
    fieldName: String(d?.fieldName || d?.name || 'Field'),
    farmId: String(d?.farmId || ''),
    farmName: d?.farmName != null ? String(d.farmName) : '',
    location: { lat, lng },
    raw: d || {}
  };
}

/* =====================================================================
   Load Fields
===================================================================== */

export async function loadFieldDocs(force=false){

  if (!appState.dbRef) await initFirebase();

  const fresh =
    !force &&
    appState.fieldsCache.data.length &&
    (Date.now() - appState.fieldsCache.loadedAt) < CACHE_TTL_MS;

  if (fresh) return appState.fieldsCache.data;

  const snap = await retry(
    () => getDocs(collection(appState.dbRef, FIELDS_COLLECTION)),
    3,
    250
  );

  const out = [];

  snap.forEach(docSnap=>{
    const row = normalizeFieldDoc(docSnap.id, docSnap.data() || {});
    if (row) out.push(row);
  });

  appState.fieldsCache = { loadedAt: Date.now(), data: out };

  /* ---------------------------------------------------------
     NEW: Warm weather caches so readiness model works
  --------------------------------------------------------- */

  try{
    const state = appState.readinessState;

    state.fields = out.slice();

    await ensureFRModules(state);

    const wxCtx = buildWxCtx(state);

    if (
      state._mods &&
      state._mods.weather &&
      typeof state._mods.weather.warmWeatherForFields === 'function'
    ){
      await state._mods.weather.warmWeatherForFields(out, wxCtx, {
        force:false,
        onEach:()=>{}
      });
    }

  }catch(e){
    console.warn('[WeatherMap] weather warm failed:', e);
  }

  return out;
}

/* =====================================================================
   Load Farms
===================================================================== */

export async function loadFarmDocs(force=false){

  if (!appState.dbRef) await initFirebase();

  const fresh =
    !force &&
    appState.farmsCache.data.length &&
    (Date.now() - appState.farmsCache.loadedAt) < CACHE_TTL_MS;

  if (fresh) return appState.farmsCache.data;

  try{

    const snap = await retry(
      () => getDocs(collection(appState.dbRef, FARMS_COLLECTION)),
      3,
      250
    );

    const out = [];

    snap.forEach(docSnap=>{
      const d = docSnap.data() || {};
      out.push({
        id: String(docSnap.id || ''),
        name: String(d.name || d.farmName || 'Farm')
      });
    });

    appState.farmsCache = { loadedAt: Date.now(), data: out };

    return out;

  }catch(_){

    appState.farmsCache = { loadedAt: Date.now(), data: [] };

    return [];

  }
}

/* =====================================================================
   Load MRMS docs
===================================================================== */

export async function loadMrmsDocs(force=false){

  if (!appState.dbRef) await initFirebase();

  const fresh =
    !force &&
    appState.mrmsCache.data.length &&
    (Date.now() - appState.mrmsCache.loadedAt) < CACHE_TTL_MS;

  if (fresh) return appState.mrmsCache.data;

  try{

    const snap = await retry(
      () => getDocs(collection(appState.dbRef, MRMS_COLLECTION)),
      3,
      250
    );

    const out = [];

    snap.forEach(docSnap=>{
      const row = normalizeMrmsDoc(docSnap.id, docSnap.data() || {});
      if (row) out.push(row);
    });

    appState.mrmsCache = { loadedAt: Date.now(), data: out };

    return out;

  }catch(e){

    if (isPermissionError(e)){
      console.warn('[WeatherMap] MRMS permission denied.');
      appState.mrmsCache = { loadedAt: Date.now(), data: [] };
      return [];
    }

    throw e;
  }
}

/* =====================================================================
   Persisted readiness state (legacy seed)
===================================================================== */

export async function loadPersistedStateMap(force=false){

  const now = Date.now();

  if (
    !force &&
    appState.readinessState._persistLoadedAt &&
    (now - appState.readinessState._persistLoadedAt) < 30000
  ){
    return appState.readinessState.persistedStateByFieldId || {};
  }

  const out = {};

  try{

    const snap = await retry(
      () => getDocs(collection(appState.dbRef, FR_STATE_COLLECTION)),
      3,
      250
    );

    snap.forEach(docSnap=>{
      const d = docSnap.data() || {};

      const fid = String(d.fieldId || docSnap.id || '').trim();

      const storageFinal = toNum(d.storageFinal);

      const asOfDateISO = String(d.asOfDateISO || '').trim().slice(0,10);

      if (!fid || storageFinal == null || !asOfDateISO) return;

      out[fid] = {
        fieldId: fid,
        storageFinal,
        asOfDateISO,
        SmaxAtSave: toNum(d.SmaxAtSave ?? d.smaxAtSave) ?? 0
      };

    });

  }catch(e){
    console.warn('[WeatherMap] persisted state load failed:', e);
  }

  appState.readinessState.persistedStateByFieldId = out;
  appState.readinessState._persistLoadedAt = now;

  return out;
}
