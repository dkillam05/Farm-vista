/* =====================================================================
/Farm-vista/js/field-readiness/firebase.js  (FULL FILE)
Rev: 2025-12-26a
Wrapper around firebase-init.js.
===================================================================== */
'use strict';

import { PATHS } from './paths.js';

export async function importFirebaseInit(state){
  try{
    const mod = await import(PATHS.FIREBASE_INIT);
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
