/* =====================================================================
/Farm-vista/js/field-readiness/data.js  (FULL FILE)
Rev: 2026-01-02a

Fix (per Dane):
✅ Do NOT block initial tile paint on weather warmup:
   - loadFields() loads fields + hydrates params and returns immediately
   - weather warmup runs in the background (fire-and-forget)

✅ As weather warms per-field, trigger lightweight tile refresh:
   - dispatches fr:tile-refresh { fieldId } so render.js updates that tile in place

Keeps:
✅ farms/fields loading
✅ per-field params hydration from field docs
✅ weather warmup (still happens, just not blocking)

Adds:
✅ safe background warmup guard + throttle
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

/* =====================================================================
   Background warmup runner (non-blocking)
===================================================================== */
function startWeatherWarmupNonBlocking(state){
  try{
    // avoid duplicate warmups (BFCache return, etc.)
    if (state._wxWarmStarted) return;
    state._wxWarmStarted = true;

    // Defer a tick so initial tile render can happen ASAP
    setTimeout(async ()=>{
      try{
        await ensureModelWeatherModulesLocal(state);
        const wxCtx = buildWxCtx(state);

        // Throttle tile refresh dispatch (avoid spamming)
        let lastTick = 0;
        const minGapMs = 120;

        await state._mods.weather.warmWeatherForFields(state.fields, wxCtx, {
          force:false,
          onEach: (fieldId)=>{
            try{
              const fid = String(fieldId || '').trim();
              if (!fid) return;

              const now = Date.now();
              if ((now - lastTick) < minGapMs) return;
              lastTick = now;

              document.dispatchEvent(new CustomEvent('fr:tile-refresh', { detail:{ fieldId: fid } }));
            }catch(_){}
          }
        });
      }catch(e){
        console.warn('[FieldReadiness] weather warmup failed:', e?.message || e);
      }
    }, 0);
  }catch(_){}
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

    // ✅ IMPORTANT: Start warmup but DO NOT await it (tiles should paint immediately)
    startWeatherWarmupNonBlocking(state);

  }catch(e){
    setErr(`Failed to load fields: ${e.message}`);
    state.fields = [];
    const empty = document.getElementById('emptyMsg');
    if (empty) empty.style.display = 'block';
  }
}
