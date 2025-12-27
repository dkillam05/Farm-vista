/* =====================================================================
/Farm-vista/js/field-readiness/data.js  (FULL FILE)
Rev: 2025-12-27a

Fix:
✅ Field Readiness sliders now hydrate from Firestore correctly even if
   soilWetness / drainageIndex are stored under nested objects or as strings.
✅ Firestore wins over localStorage on load (local remains fallback).

===================================================================== */
'use strict';

import { normalizeStatus, setErr } from './utils.js';
import { getAPI } from './firebase.js';
import { hydrateParamsFromFieldDoc, saveParamsToLocal, ensureSelectedParamsToSliders } from './params.js';
import { buildWxCtx } from './state.js';
import { ensureModelWeatherModules } from './render.js';

function getByPath(obj, path){
  try{
    const parts = String(path||'').split('.');
    let cur = obj;
    for (const p of parts){
      if (!cur || typeof cur !== 'object') return undefined;
      cur = cur[p];
    }
    return cur;
  }catch(_){
    return undefined;
  }
}

function toNum(v){
  // Accept: number, numeric string, {value:number}, {n:number}
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

  // ✅ Robust hydration: support different Firestore shapes/paths
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

    // IMPORTANT: these are the values that hydrate the Field Readiness sliders
    soilWetness: (soilWetness == null) ? null : soilWetness,
    drainageIndex: (drainageIndex == null) ? null : drainageIndex
  };
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

      // ✅ This is what makes Firestore win over local
      hydrateParamsFromFieldDoc(state, f);
    }

    arr.sort((a,b)=> String(a.name).localeCompare(String(b.name), undefined, {numeric:true, sensitivity:'base'}));
    state.fields = arr;

    // Persist the merged params map (Firestore-hydrated values win)
    saveParamsToLocal(state);

    if (!state.selectedFieldId || !state.fields.find(x=>x.id===state.selectedFieldId)){
      state.selectedFieldId = state.fields.length ? state.fields[0].id : null;
    }

    // Ensure selected field sliders reflect Firestore-hydrated params
    ensureSelectedParamsToSliders(state);

    const empty = document.getElementById('emptyMsg');
    if (empty) empty.style.display = state.fields.length ? 'none' : 'block';

    // weather warmup (uses existing weather module)
    await ensureModelWeatherModules(state);
    const wxCtx = buildWxCtx(state);
    await state._mods.weather.warmWeatherForFields(state.fields, wxCtx, { force:false, onEach:()=>{} });

  }catch(e){
    setErr(`Failed to load fields: ${e.message}`);
    state.fields = [];
    const empty = document.getElementById('emptyMsg');
    if (empty) empty.style.display = 'block';
  }
}
