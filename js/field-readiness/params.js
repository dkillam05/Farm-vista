/* =====================================================================
/Farm-vista/js/field-readiness/params.js  (FULL FILE)
Rev: 2025-12-26a
Per-field sliders cache (same logic as your working file).
===================================================================== */
'use strict';

import { CONST } from './state.js';
import { clamp } from './utils.js';

export function loadParamsFromLocal(state){
  state.perFieldParams = new Map();
  try{
    const raw = localStorage.getItem(CONST.LS_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return;
    for (const [k,v] of Object.entries(obj)){
      if (!v || typeof v !== 'object') continue;
      state.perFieldParams.set(k, {
        soilWetness: clamp(Number(v.soilWetness ?? 60), 0, 100),
        drainageIndex: clamp(Number(v.drainageIndex ?? 45), 0, 100)
      });
    }
  }catch(_){}
}

export function saveParamsToLocal(state){
  try{
    const obj = {};
    for (const [k,v] of state.perFieldParams.entries()){
      obj[k] = { soilWetness:v.soilWetness, drainageIndex:v.drainageIndex };
    }
    localStorage.setItem(CONST.LS_KEY, JSON.stringify(obj));
  }catch(_){}
}

export function getFieldParams(state, fieldId){
  const p = state.perFieldParams.get(fieldId);
  if (p) return p;
  const def = { soilWetness:60, drainageIndex:45 };
  state.perFieldParams.set(fieldId, def);
  return def;
}

export function ensureSelectedParamsToSliders(state){
  if (!state.selectedFieldId) return;
  const p = getFieldParams(state, state.selectedFieldId);
  const a = document.getElementById('soilWet');
  const b = document.getElementById('drain');
  if (a) a.value = String(p.soilWetness);
  if (b) b.value = String(p.drainageIndex);
}

export function hydrateParamsFromFieldDoc(state, field){
  if (!field) return;
  const cur = getFieldParams(state, field.id);
  if (isFinite(field.soilWetness)) cur.soilWetness = clamp(Number(field.soilWetness), 0, 100);
  if (isFinite(field.drainageIndex)) cur.drainageIndex = clamp(Number(field.drainageIndex), 0, 100);
  state.perFieldParams.set(field.id, cur);
}

