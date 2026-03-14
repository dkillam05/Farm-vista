/* ======================================================================
   /Farm-vista/js/rainfallmap/data-loaders.js
   FULL FILE REBUILD
   FIX GOAL:
   - restore robust coordinate normalization
   - keep rainfall-mode data loading here
   - DO NOT try to build readiness truth state here
     (readiness mode now uses field-readiness/data.js in builders.js)
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

export function normalizeFieldDoc(docId, d){
  const lat = toNum(
    d && (
      d.lat ??
      d.latitude ??
      (d.location && (d.location.lat ?? d.location.latitude)) ??
      (d.center && (d.center.lat ?? d.center.latitude)) ??
      (d.centroid && (d.centroid.lat ?? d.centroid.latitude)) ??
      (d.coords && (d.coords.lat ?? d.coords.latitude)) ??
      (d.gps && (d.gps.lat ?? d.gps.latitude)) ??
      (d.fieldCenter && (d.fieldCenter.lat ?? d.fieldCenter.latitude))
    )
  );

  const lng = toNum(
    d && (
      d.lng ??
      d.lon ??
      d.longitude ??
      (d.location && (d.location.lng ?? d.location.lon ?? d.location.longitude)) ??
      (d.center && (d.center.lng ?? d.center.lon ?? d.center.longitude)) ??
      (d.centroid && (d.centroid.lng ?? d.centroid.lon ?? d.centroid.longitude)) ??
      (d.coords && (d.coords.lng ?? d.coords.lon ?? d.coords.longitude)) ??
      (d.gps && (d.gps.lng ?? d.gps.lon ?? d.gps.longitude)) ??
      (d.fieldCenter && (d.fieldCenter.lng ?? d.fieldCenter.lon ?? d.fieldCenter.longitude))
    )
  );

  const fieldId = String((d && (d.fieldId || d.id || docId)) || docId || '').trim();
  if (!fieldId) return null;

  const fieldName = String((d && (d.fieldName || d.name || d.field || d.label)) || 'Field').trim() || 'Field';
  const farmId = String((d && (d.farmId || d.farmID || '')) || '').trim();
  const county = String((d && (d.county || '')) || '').trim();
  const stateName = String((d && (d.state || '')) || '').trim();

  return {
    id: fieldId,
    fieldId,
    name: fieldName,
    farmId,
    county,
    state: stateName,
    location: (lat != null && lng != null) ? { lat, lng } : null,
    raw: d || {}
  };
}

export function normalizeMrmsDoc(docId, d){
  const lat = toNum(d && d.location && d.location.lat);
  const lng = toNum(d && d.location && d.location.lng);
  if (lat == null || lng == null) return null;

  const fieldId = String((d && (d.fieldId || docId)) || docId || '');
  const fieldName = String((d && d.fieldName) || (d && d.name) || 'Field');
  const farmId = String((d && d.farmId) || '');
  const farmName = d && d.farmName != null ? String(d.farmName) : '';

  return {
    docId: String(docId || ''),
    fieldId,
    fieldName,
    farmId,
    farmName,
    location: { lat, lng },
    raw: d || {}
  };
}

export async function loadFieldDocs(force=false){
  if (!appState.dbRef) await initFirebase();

  const fresh = !force &&
    appState.fieldsCache.data.length &&
    (Date.now() - appState.fieldsCache.loadedAt) < CACHE_TTL_MS;

  if (fresh) return appState.fieldsCache.data;

  const snap = await retry(() => getDocs(collection(appState.dbRef, FIELDS_COLLECTION)), 3, 250);
  const out = [];

  snap.forEach(docSnap=>{
    const row = normalizeFieldDoc(docSnap.id, docSnap.data() || {});
    if (row) out.push(row);
  });

  appState.fieldsCache = { loadedAt: Date.now(), data: out };
  return out;
}

export async function loadFarmDocs(force=false){
  if (!appState.dbRef) await initFirebase();

  const fresh = !force &&
    appState.farmsCache.data.length &&
    (Date.now() - appState.farmsCache.loadedAt) < CACHE_TTL_MS;

  if (fresh) return appState.farmsCache.data;

  try{
    const snap = await retry(() => getDocs(collection(appState.dbRef, FARMS_COLLECTION)), 3, 250);
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

export async function loadMrmsDocs(force=false){
  if (!appState.dbRef) await initFirebase();

  const fresh = !force &&
    appState.mrmsCache.data.length &&
    (Date.now() - appState.mrmsCache.loadedAt) < CACHE_TTL_MS;

  if (fresh) return appState.mrmsCache.data;

  try{
    const snap = await retry(() => getDocs(collection(appState.dbRef, MRMS_COLLECTION)), 3, 250);
    const out = [];

    snap.forEach(docSnap=>{
      const row = normalizeMrmsDoc(docSnap.id, docSnap.data() || {});
      if (row) out.push(row);
    });

    appState.mrmsCache = { loadedAt: Date.now(), data: out };
    return out;
  }catch(e){
    if (isPermissionError(e)){
      console.warn('[WeatherMap] MRMS permission denied; continuing without MRMS collection.');
      appState.mrmsCache = { loadedAt: Date.now(), data: [] };
      return [];
    }
    throw e;
  }
}

export async function loadPersistedStateMap(force=false){
  const now = Date.now();

  if (!force &&
      appState.readinessState._persistLoadedAt &&
      (now - appState.readinessState._persistLoadedAt) < 30000){
    return appState.readinessState.persistedStateByFieldId || {};
  }

  const out = {};

  try{
    const snap = await retry(() => getDocs(collection(appState.dbRef, FR_STATE_COLLECTION)), 3, 250);

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
