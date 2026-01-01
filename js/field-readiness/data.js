/* =====================================================================
/Farm-vista/js/field-readiness/data.js  (FULL FILE)
Rev: 2026-01-01a

IMPORTANT FIX (per Dane):
✅ Fields now use a local cache (instant load)
✅ Firestore refresh runs in the background
✅ UI/state only updates when fields data is actually different ("new data")

Keeps:
✅ Breaks circular import (data.js never imports render.js)
✅ farms/fields loading
✅ per-field params hydration from field docs
✅ weather warmup
✅ fetchAndHydrateFieldParams(state, fieldId)

Notes:
- Cache is stored in localStorage (fields list + signature + timestamp)
- Signature changes when any field’s id/name/farmId/status/location/soilWetness/drainageIndex/updatedAt changes
- When remote changes are detected, we update state + cache, then dispatch 'fr:soft-reload'
  (render.js already listens for that and does refreshAll)

===================================================================== */
'use strict';

import { normalizeStatus, setErr } from './utils.js';
import { getAPI } from './firebase.js';
import { hydrateParamsFromFieldDoc, saveParamsToLocal, ensureSelectedParamsToSliders } from './params.js';
import { buildWxCtx, CONST } from './state.js';
import { PATHS } from './paths.js';

/* =====================================================================
   Local cache (fields)
===================================================================== */
const FIELDS_CACHE_KEY = 'fv_fr_fields_cache_v1';
const FIELDS_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days (safe + generous)

/* small fast hash */
function fnv1a(str){
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++){
    h ^= str.charCodeAt(i);
    h = (h + ((h<<1) + (h<<4) + (h<<7) + (h<<8) + (h<<24))) >>> 0;
  }
  return ('00000000' + h.toString(16)).slice(-8);
}

function readFieldsCache(){
  try{
    const raw = localStorage.getItem(FIELDS_CACHE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return null;
    if (!Array.isArray(obj.fields) || typeof obj.sig !== 'string') return null;

    const ts = Number(obj.ts || 0);
    if (ts && (Date.now() - ts) > FIELDS_CACHE_TTL_MS) return null;

    return obj; // { ts, sig, fields }
  }catch(_){
    return null;
  }
}

function writeFieldsCache(fields, sig){
  try{
    localStorage.setItem(FIELDS_CACHE_KEY, JSON.stringify({
      ts: Date.now(),
      sig: String(sig || ''),
      fields: Array.isArray(fields) ? fields : []
    }));
  }catch(_){}
}

function updatedAtKey(v){
  // Accept Firestore Timestamp, compat Timestamp, number, string, etc.
  try{
    if (!v) return '';
    if (typeof v === 'number') return String(v);
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object'){
      if (typeof v.toMillis === 'function') return String(v.toMillis());
      if (typeof v.seconds === 'number') return String(v.seconds);
      if (v.__time__) return String(v.__time__);
      if (v._seconds) return String(v._seconds);
      if (v.value && (typeof v.value === 'number' || typeof v.value === 'string')) return String(v.value);
    }
  }catch(_){}
  return '';
}

function buildFieldsSignature(fields){
  const parts = [];
  for (const f of (fields || [])){
    const loc = f.location || null;
    const lat = loc && typeof loc.lat === 'number' ? loc.lat.toFixed(6) : '';
    const lng = loc && typeof loc.lng === 'number' ? loc.lng.toFixed(6) : '';
    parts.push([
      f.id || '',
      f.farmId || '',
      f.name || '',
      normalizeStatus(f.status || ''),
      f.county || '',
      f.state || '',
      lat, lng,
      (f.soilWetness == null ? '' : String(f.soilWetness)),
      (f.drainageIndex == null ? '' : String(f.drainageIndex)),
      updatedAtKey(f.updatedAt)
    ].join('|'));
  }
  parts.sort();
  return fnv1a(parts.join('~~'));
}

function applyFieldsToState(state, fields, sig){
  const arr = Array.isArray(fields) ? fields : [];
  state.fields = arr;
  state._fieldsSig = String(sig || buildFieldsSignature(arr));

  // hydrate params map from fields (keeps existing behavior)
  for (const f of arr){
    try{ hydrateParamsFromFieldDoc(state, f); }catch(_){}
  }
  saveParamsToLocal(state);

  if (!state.selectedFieldId || !arr.find(x => x.id === state.selectedFieldId)){
    state.selectedFieldId = arr.length ? arr[0].id : null;
  }

  const empty = document.getElementById('emptyMsg');
  if (empty) empty.style.display = arr.length ? 'none' : 'block';

  ensureSelectedParamsToSliders(state);
}

/* =====================================================================
   Local module loader (avoids importing render.js)
===================================================================== */
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

function extractFieldDoc(docId, d){
  const loc = d.location || {};
  const lat = Number(loc.lat);
  const lng = Number(loc.lng);

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

  // NEW: pull updatedAt for cache signature freshness
  const updatedAt = d.updatedAt || d.modifiedAt || d.lastUpdatedAt || d.ts || d.createdAt || null;

  return {
    id: docId,
    name: String(d.name||''),
    county: String(d.county||''),
    state: String(d.state||''),
    farmId: String(d.farmId||''),
    status: String(d.status||''),
    tillable: Number(d.tillable||0),
    location: (isFinite(lat) && isFinite(lng)) ? { lat, lng } : null,
    soilWetness: (soilWetness == null) ? null : soilWetness,
    drainageIndex: (drainageIndex == null) ? null : drainageIndex,
    updatedAt
  };
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

    if (api.kind !== 'compat'){
      const db = api.getFirestore();
      const ref = api.doc(db, 'fields', fid);
      const snap = await api.getDoc(ref);
      if (!snap || !snap.exists || !snap.exists()) return false;
      data = snap.data() || {};
    } else {
      const db = window.firebase.firestore();
      const snap = await db.collection('fields').doc(fid).get();
      if (!snap || !snap.exists) return false;
      data = snap.data() || {};
    }

    const f = extractFieldDoc(fid, data);

    // Update state.fields copy if present
    const idx = (state.fields || []).findIndex(x=>x.id === fid);
    if (idx >= 0){
      state.fields[idx] = { ...state.fields[idx], ...f };
      // update signature + cache because we pulled fresh doc fields
      try{
        const sig = buildFieldsSignature(state.fields);
        state._fieldsSig = sig;
        writeFieldsCache(state.fields, sig);
      }catch(_){}
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

/* =====================================================================
   Farms optional
===================================================================== */
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

/* =====================================================================
   Firestore fetch (raw -> filtered fields)
===================================================================== */
async function fetchFieldsRawDocs(api){
  const rawDocs = [];

  if (api.kind !== 'compat'){
    const db = api.getFirestore();

    // Prefer active-only query (fast)
    try{
      const q = api.query(api.collection(db,'fields'), api.where('status','==','active'));
      const snap = await api.getDocs(q);
      snap.forEach(doc=> rawDocs.push({ id: doc.id, data: doc.data() || {} }));
    }catch(_){}

    // Fallback to full collection if active query returned nothing
    if (rawDocs.length === 0){
      const snap2 = await api.getDocs(api.collection(db,'fields'));
      snap2.forEach(doc=> rawDocs.push({ id: doc.id, data: doc.data() || {} }));
    }
    return rawDocs;
  }

  // compat
  const db = window.firebase.firestore();
  try{
    let snap = await db.collection('fields').where('status','==','active').get();
    snap.forEach(doc=> rawDocs.push({ id: doc.id, data: doc.data() || {} }));
    if (rawDocs.length === 0){
      snap = await db.collection('fields').get();
      snap.forEach(doc=> rawDocs.push({ id: doc.id, data: doc.data() || {} }));
    }
  }catch(e){
    // last resort
    const snap = await db.collection('fields').get();
    snap.forEach(doc=> rawDocs.push({ id: doc.id, data: doc.data() || {} }));
  }

  return rawDocs;
}

function buildFilteredActiveLocatedFieldsFromRaw(rawDocs, state){
  const arr = [];
  for (const r of (rawDocs || [])){
    const f = extractFieldDoc(r.id, r.data || {});
    if (normalizeStatus(f.status) !== 'active') continue;
    if (!f.location) continue;
    arr.push(f);

    // keep old behavior: hydrate params from field doc while building
    hydrateParamsFromFieldDoc(state, f);
  }

  arr.sort((a,b)=> String(a.name).localeCompare(String(b.name), undefined, {numeric:true, sensitivity:'base'}));
  return arr;
}

/* =====================================================================
   loadFields(state)
   - Instant paint from cache (if available)
   - Background refresh from Firestore
   - Only update if changed
===================================================================== */
export async function loadFields(state){
  const api = getAPI(state);
  if (!api){
    setErr('Firestore helpers not found.');
    state.fields = [];
    return;
  }

  // 1) Try cache first (instant)
  const cached = readFieldsCache();
  if (cached && Array.isArray(cached.fields) && cached.fields.length){
    try{
      applyFieldsToState(state, cached.fields, cached.sig);

      // Warm weather in background (don’t block UI)
      (async ()=>{
        try{
          await ensureModelWeatherModulesLocal(state);
          const wxCtx = buildWxCtx(state);
          await state._mods.weather.warmWeatherForFields(state.fields, wxCtx, { force:false, onEach:()=>{} });
        }catch(_){}
      })();

    }catch(_){}
  }

  // 2) Background Firestore refresh (non-blocking if cache was used)
  const runRemoteRefresh = async ()=>{
    try{
      // Rebuild from remote docs
      const rawDocs = await fetchFieldsRawDocs(api);

      // Reset params hydration (like old behavior) before building
      // (hydrateParamsFromFieldDoc will re-fill map)
      const arr = buildFilteredActiveLocatedFieldsFromRaw(rawDocs, state);

      // Save params (old behavior)
      saveParamsToLocal(state);

      const sig = buildFieldsSignature(arr);
      const prev = String(state._fieldsSig || (cached ? cached.sig : ''));

      if (sig !== prev){
        applyFieldsToState(state, arr, sig);
        writeFieldsCache(arr, sig);

        // Warm weather again (new list)
        try{
          await ensureModelWeatherModulesLocal(state);
          const wxCtx = buildWxCtx(state);
          await state._mods.weather.warmWeatherForFields(state.fields, wxCtx, { force:false, onEach:()=>{} });
        }catch(_){}

        // Tell render.js to refresh using updated state (no circular import)
        try{
          document.dispatchEvent(new CustomEvent('fr:soft-reload'));
        }catch(_){}
      } else {
        // Signature same: no UI churn, no re-render
        // Still do a gentle warmup if modules exist (optional)
        try{
          await ensureModelWeatherModulesLocal(state);
          const wxCtx = buildWxCtx(state);
          await state._mods.weather.warmWeatherForFields(state.fields, wxCtx, { force:false, onEach:()=>{} });
        }catch(_){}
      }
    }catch(e){
      // If we had cache, don’t blow up UI; just log.
      // If no cache, show error like before.
      if (!cached || !cached.fields || !cached.fields.length){
        setErr(`Failed to load fields: ${e.message}`);
        state.fields = [];
        const empty = document.getElementById('emptyMsg');
        if (empty) empty.style.display = 'block';
      } else {
        console.warn('[FieldReadiness] background fields refresh failed:', e);
      }
    }
  };

  // If we loaded cache, don’t block the caller
  if (cached && Array.isArray(cached.fields) && cached.fields.length){
    runRemoteRefresh(); // fire-and-forget
    return;
  }

  // No cache: do normal blocking fetch (but still caches result)
  await runRemoteRefresh();
}