/* =====================================================================
/Farm-vista/js/field-readiness/firebase.js  (FULL FILE)
Rev: 2025-12-26a
Thin wrapper over /Farm-vista/js/firebase-init.js
===================================================================== */
'use strict';

export async function importFirebaseInit(state){
  try{
    const mod = await import('/Farm-vista/js/firebase-init.js');
    state.fb = mod;
    if (mod && mod.ready) await mod.ready;
    return true;
  }catch(e){
    console.warn('[FieldReadiness] firebase-init import failed:', e);
    state.fb = null;
    return false;
  }
}

export function getAPI(state){
  const m = state.fb;
  if (m && m.getFirestore && m.collection && m.getDocs && m.query && m.where){
    return { kind:'module', ...m };
  }
  if (window.firebase && window.firebase.firestore){
    return { kind:'compat' };
  }
  return null;
}
