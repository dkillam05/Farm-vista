/* =====================================================================
/Farm-vista/js/field-readiness/params.js  (FULL FILE)
Rev: 2026-03-13b-harden-perfieldparams-init-no-trim

Per-field sliders cache + LIVE update while sliding.

FIXES:
✅ Always initialize state.perFieldParams before any .get/.set usage
✅ Prevent readiness-map crashes when params state was not preloaded
✅ Keep existing slider/live-refresh behavior unchanged

KEEPS:
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

function ensureParamsMap(state){
  if (!state || typeof state !== 'object') return new Map();
  if (!(state.perFieldParams instanceof Map)){
    state.perFieldParams = new Map();
  }
  return state.perFieldParams;
}

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
  const map = ensureParamsMap(state);
  map.clear();

  try{
    const raw = localStorage.getItem(CONST.LS_KEY);
    if (!raw) return;

    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return;

    for (const [k, v] of Object.entries(obj)){
      if (!v || typeof v !== 'object') continue;

      map.set(String(k), {
        soilWetness: clamp(Number(v.soilWetness ?? 60), 0, 100),
        drainageIndex: clamp(Number(v.drainageIndex ?? 45), 0, 100)
      });
    }
  }catch(_){}
}

export function saveParamsToLocal(state){
  try{
    const map = ensureParamsMap(state);
    const obj = {};

    for (const [k, v] of map.entries()){
      obj[k] = {
        soilWetness: clamp(Number(v && v.soilWetness), 0, 100),
        drainageIndex: clamp(Number(v && v.drainageIndex), 0, 100)
      };
    }

    localStorage.setItem(CONST.LS_KEY, JSON.stringify(obj));
  }catch(_){}
}

export function getFieldParams(state, fieldId){
  const map = ensureParamsMap(state);
  const fid = String(fieldId || '').trim();
  if (!fid){
    return { soilWetness:60, drainageIndex:45 };
  }

  const existing = map.get(fid);
  if (existing && typeof existing === 'object'){
    return existing;
  }

  const def = { soilWetness:60, drainageIndex:45 };
  map.set(fid, def);
  return def;
}

export function ensureSelectedParamsToSliders(state){
  if (!state || !state.selectedFieldId) return;

  const p = getFieldParams(state, state.selectedFieldId);
  const a = getSoilEl();
  const b = getDrainEl();

  if (a) a.value = String(clamp(Number(p.soilWetness), 0, 100));
  if (b) b.value = String(clamp(Number(p.drainageIndex), 0, 100));
}

export function hydrateParamsFromFieldDoc(state, field){
  if (!field) return;

  const map = ensureParamsMap(state);
  const fid = String(field.id || '').trim();
  if (!fid) return;

  const cur = getFieldParams(state, fid);

  if (isFinite(field.soilWetness)){
    cur.soilWetness = clamp(Number(field.soilWetness), 0, 100);
  }
  if (isFinite(field.drainageIndex)){
    cur.drainageIndex = clamp(Number(field.drainageIndex), 0, 100);
  }

  map.set(fid, cur);
}

/* =====================================================================
   Wire sliders for LIVE updates while dragging
===================================================================== */
export function wireParamSliders(state){
  try{
    if (!state) return;

    ensureParamsMap(state);

    if (state._paramsWired) return;
    state._paramsWired = true;

    const soil = getSoilEl();
    const drain = getDrainEl();

    if (!soil || !drain){
      setTimeout(()=>{
        try{
          state._paramsWired = false;
          wireParamSliders(state);
        }catch(_){}
      }, 60);
      return;
    }

    function applyFromUI(){
      try{
        const fid = String(state.selectedFieldId || '').trim();
        if (!fid) return;

        const map = ensureParamsMap(state);
        const p = getFieldParams(state, fid);

        const sw = clamp(Number(soil.value), 0, 100);
        const dr = clamp(Number(drain.value), 0, 100);

        p.soilWetness = sw;
        p.drainageIndex = dr;

        map.set(fid, p);

        scheduleSaveLocal(state);
        dispatchDetailsRefresh(fid);
        dispatchTileRefresh(fid);
      }catch(_){}
    }

    soil.addEventListener('input', applyFromUI, { passive:true });
    drain.addEventListener('input', applyFromUI, { passive:true });

    soil.addEventListener('change', applyFromUI, { passive:true });
    drain.addEventListener('change', applyFromUI, { passive:true });

  }catch(_){}
}
