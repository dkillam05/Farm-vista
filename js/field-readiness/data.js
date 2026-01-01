/* =====================================================================
/Farm-vista/js/field-readiness/data.js  (FULL FILE)
Rev: 2026-01-01b

GOAL (per Dane):
✅ Fields load instantly from local cache (no blank screen)
✅ Firestore refresh runs silently in background
✅ UI/state only updates when field data actually changed
✅ Prevent false "changed" detection (NO updatedAt in signature)
✅ Avoid heavy warmups when nothing changed

Keeps:
✅ Breaks circular import:
   - render.js can import from data.js
   - data.js NO LONGER imports from render.js
✅ farms/fields loading
✅ per-field params hydration from field docs
✅ weather warmup (only when needed)
✅ fetchAndHydrateFieldParams(state, fieldId) — one-doc background pull for sliders

How it works:
- On open: apply cached fields immediately (if any)
- Then: fetch from Firestore in background
- Compute signature from meaningful field values ONLY (id/name/farmId/status/location/soilWetness/drainageIndex/county/state)
- If signature differs: update state + cache + dispatch 'fr:soft-reload' (render.js refresh listener)
- If signature same: do nothing (no UI churn; no extra warmup)

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
const FIELDS_CACHE_KEY = 'fv_fr_fields_cache_v2'; // bump key to avoid old signature mismatch
const FIELDS_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

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

/* IMPORTANT:
   Signature uses ONLY stable, meaningful data.
   Do NOT include Firestore Timestamp objects (updatedAt) because cache JSON + Firestore Timestamp
   can serialize differently and cause false changes every load.
*/
function buildFieldsSignature(fields){
  const parts = [];
  for (const f of (fields || [])){
    const loc = f.location || null;
    const lat = loc && typeof loc.lat === 'number' ? f.location.lat.toFixed(6) : '';
    const lng = loc && typeof loc.lng === 'number' ? f.location.lng.toFixed(6) : '';
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
      (Number.isFinite(Number(f.tillable)) ? String(Number(f.tillable)) : '')
    ].join('|'));
  }
  parts.sort();
  return fnv1a(parts.join('~~'));
}

function applyFieldsToState(state, fields, sig){
  const arr = Array.isArray(fields) ? fields : [];
  state.fields = arr;
  state._fieldsSig = String(sig || buildFieldsSignature(arr));

  // hydrate params from field docs (keeps existing behavior)
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

  // Support common storage paths
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
    location: (isFinite(lat) && isFinite(lng)) ? { lat, lng } : null,
    soilWetness: (soilWetness == null) ? null : soilWetness,
    drainageIndex: (drainageIndex == null) ? null : drainageIndex
  };
}

/* =====================================================================
   One-doc background fetch for selected field params
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

    hydrateParamsFromFieldDoc(state, f);
    saveParamsToLocal(state);

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
    hydrateParamsFromFieldDoc(state, f);
  }

  arr.sort((a,b)=> String(a.name).localeCompare(String(b.name), undefined, {numeric:true, sensitivity:'base'}));
  return arr;
}

/* =====================================================================
   loadFields(state)
   - Instant paint from cache (if available)
   - Silent Firestore refresh in background
   - Only update if changed (signature)
===================================================================== */
export async function loadFields(state){
  const api = getAPI(state);
  if (!api){
    setErr('Firestore helpers not found.');
    state.fields = [];
    return;
  }

  // 1) Apply cached fields immediately (if any)
  const cached = readFieldsCache();
  if (cached && Array.isArray(cached.fields) && cached.fields.length){
    try{
      applyFieldsToState(state, cached.fields, cached.sig);
      // Do NOT warm weather here; render.js will request weather as needed.
      // (Warmup only when we actually receive new data from Firestore.)
    }catch(_){}
  }

  // 2) Silent background refresh from Firestore
  const runRemoteRefresh = async ()=>{
    try{
      const rawDocs = await fetchFieldsRawDocs(api);
      const arr = buildFilteredActiveLocatedFieldsFromRaw(rawDocs, state);
      saveParamsToLocal(state);

      const sig = buildFieldsSignature(arr);
      const prev = String(state._fieldsSig || (cached ? cached.sig : ''));

      if (sig !== prev){
        applyFieldsToState(state, arr, sig);
        writeFieldsCache(arr, sig);

        // Warm weather ONLY when fields list actually changed (or first time with no cache)
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
        // No change -> do nothing (silent)
      }
    }catch(e){
      // If we had cache, keep UI and just log; if no cache, show error
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

  // If cache existed: do not block UI
  if (cached && Array.isArray(cached.fields) && cached.fields.length){
    runRemoteRefresh();
    return;
  }

  // No cache: block once to get initial list + warmup
  await runRemoteRefresh();
}