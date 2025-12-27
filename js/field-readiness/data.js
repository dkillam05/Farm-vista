/* =====================================================================
/Farm-vista/js/field-readiness/data.js  (FULL FILE)
Rev: 2025-12-27a

Adds:
✅ Background live-sync for ONLY the selected field doc (onSnapshot)
✅ Updates sliders + details without full reload / without rerendering all tiles

Keeps:
- farms/fields loading behavior
===================================================================== */
'use strict';

import { normalizeStatus, setErr } from './utils.js';
import { getAPI } from './firebase.js';
import { hydrateParamsFromFieldDoc, saveParamsToLocal, ensureSelectedParamsToSliders } from './params.js';
import { buildWxCtx } from './state.js';
import { ensureModelWeatherModules } from './render.js';

function extractFieldDoc(docId, d){
  const loc = d.location || {};
  const lat = Number(loc.lat);
  const lng = Number(loc.lng);
  const soilWetness = Number(d.soilWetness);
  const drainageIndex = Number(d.drainageIndex);
  return {
    id: docId,
    name: String(d.name||''),
    county: String(d.county||''),
    state: String(d.state||''),
    farmId: String(d.farmId||''),
    status: String(d.status||''),
    tillable: Number(d.tillable||0),
    location: (isFinite(lat) && isFinite(lng)) ? { lat, lng } : null,
    soilWetness: isFinite(soilWetness) ? soilWetness : null,
    drainageIndex: isFinite(drainageIndex) ? drainageIndex : null
  };
}

/* =========================
   Selected field live sync
   ========================= */
export function stopSelectedFieldLiveSync(state){
  try{
    if (state && state._selFieldUnsub){
      state._selFieldUnsub();
    }
  }catch(_){}
  if (state){
    state._selFieldUnsub = null;
    state._selFieldWatchId = null;
  }
}

export function startSelectedFieldLiveSync(state, fieldId, onUpdate){
  if (!state || !fieldId) return;
  const fid = String(fieldId);

  // Avoid re-subscribing to same doc
  if (state._selFieldWatchId === fid && state._selFieldUnsub) return;

  stopSelectedFieldLiveSync(state);
  state._selFieldWatchId = fid;

  const api = getAPI(state);
  if (!api){
    state._selFieldUnsub = null;
    return;
  }

  const applyDoc = (docId, data)=>{
    try{
      const f = extractFieldDoc(docId, data || {});

      // Update the copy in state.fields (so future renders match Firestore)
      const idx = state.fields.findIndex(x=>x.id === docId);
      if (idx >= 0){
        state.fields[idx] = { ...state.fields[idx], ...f };
      }

      // Hydrate params map from Firestore doc, then update sliders
      hydrateParamsFromFieldDoc(state, f);
      saveParamsToLocal(state);

      // Only apply to sliders if this doc is currently selected
      if (state.selectedFieldId === docId){
        ensureSelectedParamsToSliders(state);
      }

      if (typeof onUpdate === 'function'){
        onUpdate();
      }
    }catch(_){}
  };

  // Modular SDK
  if (api.kind !== 'compat'){
    try{
      const db = api.getFirestore();
      const ref = api.doc(db, 'fields', fid);
      const unsub = api.onSnapshot(ref, (snap)=>{
        try{
          if (!snap || !snap.exists || !snap.exists()) return;
          applyDoc(fid, snap.data() || {});
        }catch(_){}
      }, (_err)=>{});
      state._selFieldUnsub = unsub;
      return;
    }catch(_){}
  }

  // Compat fallback
  try{
    const db = window.firebase.firestore();
    const unsub = db.collection('fields').doc(fid).onSnapshot((snap)=>{
      try{
        if (!snap || !snap.exists) return;
        applyDoc(fid, snap.data() || {});
      }catch(_){}
    }, (_err)=>{});
    state._selFieldUnsub = unsub;
  }catch(_){
    state._selFieldUnsub = null;
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
