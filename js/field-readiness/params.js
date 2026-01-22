/* =====================================================================
/Farm-vista/js/field-readiness/params.js  (FULL FILE)
Rev: 2026-01-22a-live-slide-refresh

Per-field sliders cache + LIVE update while sliding.

NEW:
✅ wireParamSliders(state): on slider input, update in-memory params immediately
   and trigger UI/model refresh via events already handled in render.js:
   - fr:details-refresh (updates the weather=output section live)
   - fr:tile-refresh    (updates the selected tile live)

✅ Debounced localStorage save while sliding (does NOT require hitting Save)
===================================================================== */
'use strict';

import { CONST } from './state.js';
import { clamp } from './utils.js';

const LIVE_SAVE_DEBOUNCE_MS = 250;

function getSoilEl(){ return document.getElementById('soilWet'); }
function getDrainEl(){ return document.getElementById('drain'); }

function dispatchDetailsRefresh(fieldId){
  try{
    document.dispatchEvent(new CustomEvent('fr:details-refresh', { detail:{ fieldId:String(fieldId||'') } }));
  }catch(_){}
}
function dispatchTileRefresh(fieldId){
  try{
    document.dispatchEvent(new CustomEvent('fr:tile-refresh', { detail:{ fieldId:String(fieldId||'') } }));
  }catch(_){}
}

function scheduleSaveLocal(state){
  try{
    if (!state) return;
    if (state._paramsSaveTimer) clearTimeout(state._paramsSaveTimer);
    state._paramsSaveTimer = setTimeout(()=>{
      state._paramsSaveTimer = null;
      try{ saveParamsToLocal(state); }catch(_){}
    }, LIVE_SAVE_DEBOUNCE_MS);
  }catch(_){}
}

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
  const a = getSoilEl();
  const b = getDrainEl();
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

/* =====================================================================
   NEW: Wire sliders for LIVE updates while dragging
===================================================================== */
export function wireParamSliders(state){
  try{
    if (!state) return;
    if (state._paramsWired) return;
    state._paramsWired = true;

    const soil = getSoilEl();
    const drain = getDrainEl();

    if (!soil || !drain){
      // If DOM not ready yet, retry once shortly
      setTimeout(()=>{ try{ state._paramsWired = false; wireParamSliders(state); }catch(_){ } }, 60);
      return;
    }

    function applyFromUI(){
      try{
        const fid = String(state.selectedFieldId || '');
        if (!fid) return;

        const p = getFieldParams(state, fid);

        // Read live slider values
        const sw = clamp(Number(soil.value), 0, 100);
        const dr = clamp(Number(drain.value), 0, 100);

        // Update in-memory immediately
        p.soilWetness = sw;
        p.drainageIndex = dr;
        state.perFieldParams.set(fid, p);

        // Debounced save to local so it persists even if they don't hit Save
        scheduleSaveLocal(state);

        // Trigger live re-render (render.js already listens)
        dispatchDetailsRefresh(fid);
        dispatchTileRefresh(fid);
      }catch(_){}
    }

    // LIVE while sliding
    soil.addEventListener('input', applyFromUI, { passive:true });
    drain.addEventListener('input', applyFromUI, { passive:true });

    // Also fire on "change" to catch non-drag interactions
    soil.addEventListener('change', applyFromUI, { passive:true });
    drain.addEventListener('change', applyFromUI, { passive:true });

  }catch(_){}
}
