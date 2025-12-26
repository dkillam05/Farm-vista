/* =====================================================================
/Farm-vista/js/field-readiness/data.js  (FULL FILE)
Rev: 2025-12-26a

Owns: loading farms + fields + warm weather.
This is intentionally small right now.
Next step: we port your exact load logic from the working file into here.
===================================================================== */
'use strict';

import { CONSTANTS } from './state.js';
import { getAPI } from './firebase.js';

export async function loadInitialData(state){
  // This file is the “home” for all the Firestore loading logic.
  // Right now, we only ensure we can talk to Firestore and load farms/fields
  // in the same manner as your current working file (we will port it next).

  await loadFarmsOptional(state);
  await loadFields(state);
}

async function loadFarmsOptional(state){
  const api = getAPI(state);
  if (!api || api.kind === 'compat') return;

  try{
    const db = api.getFirestore();
    const snap = await api.getDocs(api.collection(db, CONSTANTS.FARMS_COLLECTION));
    const map = new Map();
    snap.forEach(doc=>{
      const d = doc.data() || {};
      if (d && d.name) map.set(doc.id, String(d.name));
    });
    state.farmsById = map;
  }catch(e){
    console.warn('[FieldReadiness] farms load failed:', e);
  }
}

async function loadFields(state){
  const api = getAPI(state);
  if (!api){
    console.warn('[FieldReadiness] Firestore helpers not found.');
    state.fields = [];
    return;
  }

  try{
    const rawDocs = [];

    if (api.kind !== 'compat'){
      const db = api.getFirestore();
      const q = api.query(api.collection(db, CONSTANTS.FIELDS_COLLECTION), api.where('status','==','active'));
      const snap = await api.getDocs(q);
      snap.forEach(doc=> rawDocs.push({ id: doc.id, data: doc.data() || {} }));

      if (!rawDocs.length){
        const snap2 = await api.getDocs(api.collection(db, CONSTANTS.FIELDS_COLLECTION));
        snap2.forEach(doc=> rawDocs.push({ id: doc.id, data: doc.data() || {} }));
      }
    } else {
      const db = window.firebase.firestore();
      let snap = await db.collection(CONSTANTS.FIELDS_COLLECTION).where('status','==','active').get();
      snap.forEach(doc=> rawDocs.push({ id: doc.id, data: doc.data() || {} }));

      if (!rawDocs.length){
        snap = await db.collection(CONSTANTS.FIELDS_COLLECTION).get();
        snap.forEach(doc=> rawDocs.push({ id: doc.id, data: doc.data() || {} }));
      }
    }

    const out = [];
    for (const r of rawDocs){
      const d = r.data || {};
      const loc = d.location || {};
      const lat = Number(loc.lat);
      const lng = Number(loc.lng);

      const f = {
        id: r.id,
        name: String(d.name||''),
        county: String(d.county||''),
        state: String(d.state||''),
        farmId: String(d.farmId||''),
        status: String(d.status||''),
        tillable: Number(d.tillable||0),
        location: (isFinite(lat) && isFinite(lng)) ? { lat, lng } : null,
        soilWetness: isFinite(Number(d.soilWetness)) ? Number(d.soilWetness) : null,
        drainageIndex: isFinite(Number(d.drainageIndex)) ? Number(d.drainageIndex) : null
      };

      if (String(f.status||'').toLowerCase() !== 'active') continue;
      if (!f.location) continue;

      out.push(f);
    }

    out.sort((a,b)=> String(a.name).localeCompare(String(b.name), undefined, {numeric:true, sensitivity:'base'}));
    state.fields = out;

    if (!state.selectedFieldId && state.fields.length){
      state.selectedFieldId = state.fields[0].id;
    }
  }catch(e){
    console.warn('[FieldReadiness] fields load failed:', e);
    state.fields = [];
  }
}
