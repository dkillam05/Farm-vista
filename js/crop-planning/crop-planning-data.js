/* =====================================================================
/Farm-vista/js/crop-planning/crop-planning-data.js  (FULL FILE)
Rev: 2025-12-30c
Firestore data helpers for Crop Planning Selector

Collections:
- farms
- fields
- field_crop_plans/{year}/fields/{fieldId}
===================================================================== */
'use strict';

import {
  ready,
  getFirestore, getAuth,
  collection, getDocs,
  doc, setDoc, deleteDoc,
  serverTimestamp
} from '/Farm-vista/js/firebase-init.js';

const norm = (s) => String(s || '').trim().toLowerCase();

function getEmail(){
  try{
    const a = getAuth();
    const u = a?.currentUser;
    return u?.email || '';
  }catch{
    return '';
  }
}

export async function initDB(){
  await ready;
  return getFirestore();
}

export async function loadFarms(db){
  const snap = await getDocs(collection(db, 'farms'));
  const out = [];
  snap.forEach(d=>{
    const x = d.data() || {};
    const name = String(x.name || '').trim();
    if(!name) return;
    out.push({
      id: d.id,
      name,
      status: String(x.status || 'active')
    });
  });
  out.sort((a,b)=> a.name.localeCompare(b.name));
  return out;
}

export async function loadFields(db){
  const snap = await getDocs(collection(db, 'fields'));
  const out = [];
  snap.forEach(d=>{
    const x = d.data() || {};
    const name = String(x.name || '').trim();
    if(!name) return;

    const tillable = Number(x.tillable || 0);
    out.push({
      id: d.id,
      name,
      nameLower: norm(name),
      farmId: String(x.farmId || '').trim(),
      status: String(x.status || 'active').trim(),
      tillable: Number.isFinite(tillable) ? tillable : 0
    });
  });
  out.sort((a,b)=> a.name.localeCompare(b.name));
  return out;
}

export async function loadPlansForYear(db, year){
  const y = String(year || '').trim();
  const plans = new Map();
  if(!y) return plans;

  const snap = await getDocs(collection(db, 'field_crop_plans', y, 'fields'));
  snap.forEach(d=>{
    const x = d.data() || {};
    plans.set(d.id, {
      crop: norm(x.crop),
      acres: Number(x.acres || 0),
      farmId: String(x.farmId || '').trim(),
      fieldName: String(x.fieldName || '').trim(),
      status: String(x.status || '').trim()
    });
  });
  return plans;
}

export async function setPlan(db, year, field, crop){
  const y = String(year || '').trim();
  const c = norm(crop);
  if(!y) throw new Error('Missing year');
  if(c !== 'corn' && c !== 'soybeans') throw new Error('Invalid crop');

  const email = getEmail();
  const ref = doc(db, 'field_crop_plans', y, 'fields', field.id);

  const payload = {
    crop: c,
    acres: Number(field.tillable || 0),
    farmId: String(field.farmId || ''),
    fieldName: String(field.name || ''),
    status: String(field.status || ''),
    updatedAt: serverTimestamp()
  };
  if(email) payload.updatedBy = email;

  await setDoc(ref, payload, { merge: true });
  return payload;
}

export async function clearPlan(db, year, fieldId){
  const y = String(year || '').trim();
  if(!y) throw new Error('Missing year');
  const id = String(fieldId || '').trim();
  if(!id) return;
  await deleteDoc(doc(db, 'field_crop_plans', y, 'fields', id));
}
