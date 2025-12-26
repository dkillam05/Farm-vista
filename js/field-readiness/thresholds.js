/* =====================================================================
/Farm-vista/js/field-readiness/thresholds.js  (FULL FILE)
Rev: 2025-12-26a
Thresholds per op (same logic as your working file).
===================================================================== */
'use strict';

import { OPS, CONST } from './state.js';
import { clamp } from './utils.js';
import { getAPI } from './firebase.js';

function defaultThresholds(){
  return {
    spring_tillage: 70,
    planting: 70,
    spraying: 70,
    harvest: 70,
    fall_tillage: 70
  };
}

function applyThresholdObject(state, obj){
  const defs = defaultThresholds();
  state.thresholdsByOp = new Map();
  for (const op of OPS){
    const v = (obj && typeof obj === 'object') ? obj[op.key] : undefined;
    const num = isFinite(Number(v)) ? Number(v) : defs[op.key];
    state.thresholdsByOp.set(op.key, clamp(Math.round(num), 0, 100));
  }
}

export function loadThresholdsFromLocal(state){
  let parsed = null;
  try{
    const raw = localStorage.getItem(CONST.LS_THR_KEY);
    parsed = raw ? JSON.parse(raw) : null;
  }catch(_){ parsed = null; }
  applyThresholdObject(state, parsed);
}

export function saveThresholdsToLocal(state){
  try{
    const obj = {};
    for (const op of OPS) obj[op.key] = state.thresholdsByOp.get(op.key);
    localStorage.setItem(CONST.LS_THR_KEY, JSON.stringify(obj));
  }catch(_){}
}

export async function loadThresholdsFromFirestore(state){
  const api = getAPI(state);
  if (!api || api.kind === 'compat') return false;
  try{
    const db = api.getFirestore();
    const ref = api.doc(db, CONST.THR_COLLECTION, CONST.THR_DOC_ID);
    const snap = await api.getDoc(ref);
    if (snap && snap.exists && snap.exists()){
      const data = snap.data() || {};
      const thr = data.thresholds || data;
      applyThresholdObject(state, thr);
      saveThresholdsToLocal(state);
      return true;
    }
    return false;
  }catch(e){
    console.warn('[FieldReadiness] thresholds read failed:', e);
    return false;
  }
}

export function getCurrentOp(){
  const sel = document.getElementById('opSel');
  const key = String(sel ? sel.value : OPS[0].key);
  return OPS.find(o=>o.key===key) ? key : OPS[0].key;
}

export function getThresholdForOp(state, opKey){
  const v = state.thresholdsByOp.get(opKey);
  return isFinite(Number(v)) ? Number(v) : 70;
}
