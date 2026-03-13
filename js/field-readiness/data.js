/* =====================================================================
/Farm-vista/js/field-readiness/data.js  (FULL FILE)
Rev: 2026-03-12b-normalize-new-field-coordinates-no-trim

Changes (per Dane):
✅ Keep correct initial tile count (ex: 25) AND speed up:
   - Warm weather for ONLY the initial visible set (awaited)
   - Warm the remaining fields in the background (not awaited)
✅ Added MRMS doc loader for field_mrms_weather/{fieldId}
✅ Caches MRMS docs by fieldId for details rendering

NEW (THIS REV):
✅ FIX: normalize field GPS from multiple possible field doc shapes so
   new fields do not lose readiness just because lat/lng were stored
   somewhere other than location.lat/location.lng
✅ Supported coordinate paths now include common variants such as:
   - location.lat / location.lng
   - location.latitude / location.longitude
   - lat / lng
   - latitude / longitude
   - gps.lat / gps.lng
   - gps.latitude / gps.longitude
   - center.lat / center.lng
   - center.latitude / center.longitude
   - fieldCenter.lat / fieldCenter.lng
   - fieldCenter.latitude / fieldCenter.longitude
✅ Keeps output shape unchanged:
   - extracted field objects still expose location:{ lat, lng }
===================================================================== */
'use strict';

import { normalizeStatus, setErr } from './utils.js';
import { getAPI } from './firebase.js';
import { hydrateParamsFromFieldDoc, saveParamsToLocal, ensureSelectedParamsToSliders } from './params.js';
import { buildWxCtx, CONST } from './state.js';
import { PATHS } from './paths.js';

/* ---------- local module loader (avoids importing render.js) ---------- */
async function ensureModelWeatherModulesLocal(state){
  if (state._mods && state._mods.model && state._mods.weather) return;
  const [weather, model] = await Promise.all([ import(PATHS.WEATHER), import(PATHS.MODEL) ]);
  state._mods = state._mods || {};
  state._mods.weather = weather;
  state._mods.model = model;
}

/* ---------- robust param read helpers ---------- */
function getByPath(obj, path){
  try{
    const parts = String(path||'').split('.');
    let cur = obj;
    for (const p of parts){
      if (!cur || typeof cur !== 'object') return undefined;
      cur = cur[p];
    }
    return cur;
  }catch(_){ return undefined; }
}

function toNum(v){
  if (typeof v === 'number') return (isFinite(v) ? v : null);
  if (typeof v === 'string'){
    const n = Number(v.trim());
    return isFinite(n) ? n : null;
  }
  if (v && typeof v === 'object'){
    if (typeof v.value === 'number' && isFinite(v.value)) return v.value;
    if (typeof v.value === 'string'){
      const n = Number(String(v.value).trim());
      return isFinite(n) ? n : null;
    }
    if (typeof v.n === 'number' && isFinite(v.n)) return v.n;
    if (typeof v.n === 'string'){
      const n = Number(String(v.n).trim());
      return isFinite(n) ? n : null;
    }
  }
  return null;
}

function pickFirstNumber(d, paths){
  for (const p of paths){
    const raw = getByPath(d, p);
    const n = toNum(raw);
    if (n != null) return n;
  }
  return null;
}

/* ---------- robust coordinate extraction for newer field shapes ---------- */
function isValidLatLng(lat, lng){
  return (
    lat != null &&
    lng != null &&
    isFinite(lat) &&
    isFinite(lng) &&
    Math.abs(Number(lat)) <= 90 &&
    Math.abs(Number(lng)) <= 180
  );
}

function extractLocation(d){
  const lat = pickFirstNumber(d, [
    'location.lat',
    'location.latitude',
    'lat',
    'latitude',
    'gps.lat',
    'gps.latitude',
    'center.lat',
    'center.latitude',
    'fieldCenter.lat',
    'fieldCenter.latitude',
    'coordinates.lat',
    'coordinates.latitude',
    'centroid.lat',
    'centroid.latitude',
    'map.lat',
    'map.latitude'
  ]);

  const lng = pickFirstNumber(d, [
    'location.lng',
    'location.lon',
    'location.long',
    'location.longitude',
    'lng',
    'lon',
    'long',
    'longitude',
    'gps.lng',
    'gps.lon',
    'gps.long',
    'gps.longitude',
    'center.lng',
    'center.lon',
    'center.long',
    'center.longitude',
    'fieldCenter.lng',
    'fieldCenter.lon',
    'fieldCenter.long',
    'fieldCenter.longitude',
    'coordinates.lng',
    'coordinates.lon',
    'coordinates.long',
    'coordinates.longitude',
    'centroid.lng',
    'centroid.lon',
    'centroid.long',
    'centroid.longitude',
    'map.lng',
    'map.lon',
    'map.long',
    'map.longitude'
  ]);

  if (!isValidLatLng(lat, lng)) return null;

  return {
    lat: Number(lat),
    lng: Number(lng)
  };
}

function extractFieldDoc(docId, d){
  const location = extractLocation(d);

  // Support common storage paths (keeps you compatible with Fields Settings variations)
  const soilWetness = pickFirstNumber(d, [
    'soilWetness',
    'fieldReadiness.soilWetness',
    'readiness.soilWetness',
    'params.soilWetness',
    'sliders.soilWetness',
    'field_readiness.soilWetness'
  ]);

  const drainageIndex = pickFirstNumber(d, [
    'drainageIndex',
    'fieldReadiness.drainageIndex',
    'readiness.drainageIndex',
    'params.drainageIndex',
    'sliders.drainageIndex',
    'field_readiness.drainageIndex'
  ]);

  return {
    id: docId,
    name: String(d.name||''),
    county: String(d.county||''),
    state: String(d.state||''),
    farmId: String(d.farmId||''),
    status: String(d.status||''),
    tillable: Number(d.tillable||0),
    location,
    soilWetness: (soilWetness == null) ? null : soilWetness,
    drainageIndex: (drainageIndex == null) ? null : drainageIndex
  };
}

function safeMrmsDocData(d){
  return (d && typeof d === 'object') ? d : null;
}

/* =====================================================================
   NEW: MRMS one-doc fetch/cache
===================================================================== */
const MRMS_TTL_MS = 5 * 60 * 1000;

export async function loadFieldMrmsDoc(state, fieldId, { force=false } = {}){
  const fid = String(fieldId || '').trim();
  if (!fid) return null;

  state.mrmsByFieldId = state.mrmsByFieldId || new Map();
  state.mrmsInfoByFieldId = state.mrmsInfoByFieldId || new Map();

  try{
    const cached = state.mrmsByFieldId.get(fid) || null;
    const info = state.mrmsInfoByFieldId.get(fid) || null;
    const loadedAt = Number(info && info.loadedAt ? info.loadedAt : 0);

    if (!force && cached && loadedAt && (Date.now() - loadedAt) < MRMS_TTL_MS){
      return cached;
    }

    const api = getAPI(state);
    if (!api){
      state.mrmsByFieldId.set(fid, null);
      state.mrmsInfoByFieldId.set(fid, {
        ok: false,
        loadedAt: Date.now(),
        source: 'firestore',
        reason: 'api-missing'
      });
      return null;
    }

    let data = null;

    if (api.kind !== 'compat'){
      const db = api.getFirestore();
      const ref = api.doc(db, CONST.MRMS_FIRESTORE_COLLECTION, fid);
      const snap = await api.getDoc(ref);
      if (snap && snap.exists && snap.exists()){
        data = safeMrmsDocData(snap.data());
      }
    } else {
      const db = window.firebase.firestore();
      const snap = await db.collection(CONST.MRMS_FIRESTORE_COLLECTION).doc(fid).get();
      if (snap && snap.exists){
        data = safeMrmsDocData(snap.data());
      }
    }

    state.mrmsByFieldId.set(fid, data || null);
    state.mrmsInfoByFieldId.set(fid, {
      ok: !!data,
      loadedAt: Date.now(),
      source: 'firestore',
      collection: CONST.MRMS_FIRESTORE_COLLECTION
    });

    return data || null;
  }catch(e){
    console.warn('[FieldReadiness] loadFieldMrmsDoc failed:', e);
    state.mrmsByFieldId.set(fid, null);
    state.mrmsInfoByFieldId.set(fid, {
      ok: false,
      loadedAt: Date.now(),
      source: 'firestore',
      collection: CONST.MRMS_FIRESTORE_COLLECTION,
      error: String(e && e.message ? e.message : e || '')
    });
    return null;
  }
}

/* =====================================================================
   NEW: One-doc background fetch for selected field params
===================================================================== */
export async function fetchAndHydrateFieldParams(state, fieldId){
  const fid = String(fieldId || '').trim();
  if (!fid) return false;

  const api = getAPI(state);
  if (!api) return false;

  try{
    let data = null;

    // Try modular Firestore first
    try{
      const db = api.getFirestore ? api.getFirestore() : null;

      if (db && typeof api.doc === 'function' && typeof api.getDoc === 'function'){
        const ref = api.doc(db, 'fields', fid);
        const snap = await api.getDoc(ref);

        if (snap){
          const exists =
            (typeof snap.exists === 'function' && snap.exists()) ||
            (typeof snap.exists === 'boolean' && snap.exists === true);

          if (exists){
            data = snap.data() || {};
          }
        }
      }
    }catch(_){}

    // Compat fallback only if modular did not load the doc
    if (!data){
      const db =
        (window.firebase && typeof window.firebase.firestore === 'function')
          ? window.firebase.firestore()
          : null;

      if (db && typeof db.collection === 'function'){
        const snap = await db.collection('fields').doc(fid).get();
        if (snap && snap.exists){
          data = snap.data() || {};
        }
      }
    }

    if (!data) return false;

    const f = extractFieldDoc(fid, data);

    // Update state.fields copy if present
    const idx = (state.fields || []).findIndex(x => x.id === fid);
    if (idx >= 0){
      state.fields[idx] = { ...state.fields[idx], ...f };
    }

    // Hydrate params map from Firestore values
    hydrateParamsFromFieldDoc(state, f);
    saveParamsToLocal(state);

    // If selected, update sliders immediately
    if (state.selectedFieldId === fid){
      ensureSelectedParamsToSliders(state);
    }

    return true;
  }catch(e){
    console.warn('[FieldReadiness] fetchAndHydrateFieldParams failed:', e);
    return false;
  }
}

export async function loadFarmsOptional(state){
  const api = getAPI(state);
  if (!api || api.kind === 'compat') return;
  try{
    const db = api.getFirestore();
    const snap = await api.getDocs(api.collection(db,'farms'));
    const map = new Map();
    snap.forEach(doc=>{
      const d = doc.data() || {};
      if (d && d.name) map.set(doc.id, String(d.name));
    });
    state.farmsById = map;
  }catch(_){}
}

/* ---------- decide how many fields to warm before first paint ---------- */
function initialWarmCount(state){
  try{
    const v = state && state.pageSize != null ? state.pageSize : null;

    // "__all__" can be huge; don't block on it
    if (String(v) === '__all__' || Number(v) === -1) return 50;

    const n = Number(v);
    if (isFinite(n) && n > 0) return Math.min(250, Math.max(10, Math.floor(n)));
  }catch(_){}

  return 25; // sensible default
}

export async function loadFields(state){
  const api = getAPI(state);
  if (!api){
    setErr('Firestore helpers not found.');
    state.fields = [];
    return;
  }

  try{
    let rawDocs = [];

    if (api.kind !== 'compat'){
      const db = api.getFirestore();
      const q = api.query(api.collection(db,'fields'), api.where('status','==','active'));
      const snap = await api.getDocs(q);
      snap.forEach(doc=> rawDocs.push({ id: doc.id, data: doc.data() || {} }));
      if (rawDocs.length === 0){
        const snap2 = await api.getDocs(api.collection(db,'fields'));
        snap2.forEach(doc=> rawDocs.push({ id: doc.id, data: doc.data() || {} }));
      }
    } else {
      const db = window.firebase.firestore();
      let snap = await db.collection('fields').where('status','==','active').get();
      snap.forEach(doc=> rawDocs.push({ id: doc.id, data: doc.data() || {} }));
      if (rawDocs.length === 0){
        snap = await db.collection('fields').get();
        snap.forEach(doc=> rawDocs.push({ id: doc.id, data: doc.data() || {} }));
      }
    }

    const arr = [];
    for (const r of rawDocs){
      const f = extractFieldDoc(r.id, r.data);
      if (normalizeStatus(f.status) !== 'active') continue;
      if (!f.location) continue;
      arr.push(f);
      hydrateParamsFromFieldDoc(state, f);
    }

    arr.sort((a,b)=> String(a.name).localeCompare(String(b.name), undefined, {numeric:true, sensitivity:'base'}));
    state.fields = arr;
    saveParamsToLocal(state);

    if (!state.selectedFieldId || !state.fields.find(x=>x.id===state.selectedFieldId)){
      state.selectedFieldId = state.fields.length ? state.fields[0].id : null;
    }

    const empty = document.getElementById('emptyMsg');
    if (empty) empty.style.display = state.fields.length ? 'none' : 'block';

    ensureSelectedParamsToSliders(state);

    // weather warmup (uses existing weather module)
    await ensureModelWeatherModulesLocal(state);
    const wxCtx = buildWxCtx(state);

    // ✅ Warm a small "first paint" slice (awaited so tiles aren't skipped)
    const cap = Math.min(state.fields.length, initialWarmCount(state));
    const first = state.fields.slice(0, cap);
    const rest  = state.fields.slice(cap);

    await state._mods.weather.warmWeatherForFields(first, wxCtx, { force:false, onEach:()=>{} });

    // ✅ Warm the remainder in background (keeps caches building, but no blocking)
    if (rest.length){
      setTimeout(()=>{
        try{
          state._mods.weather.warmWeatherForFields(rest, wxCtx, { force:false, onEach:()=>{} })
            .catch(()=>{});
        }catch(_){}
      }, 0);
    }

  }catch(e){
    setErr(`Failed to load fields: ${e.message}`);
    state.fields = [];
    const empty = document.getElementById('emptyMsg');
    if (empty) empty.style.display = 'block';
  }
}
