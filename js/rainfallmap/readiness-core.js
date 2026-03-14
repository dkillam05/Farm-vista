/* =====================================================================
/Farm-vista/js/rainfallmap/readiness-core.js  (FULL FILE)
Rev: 2026-03-13b-match-quickview-readiness-path

Goal:
- Make map readiness use the same model wiring pattern as Quick View
- Keep weather warm/prep so map rows still build
- Return null only when the run is truly unusable
===================================================================== */

import {
  ensureFRModules,
  buildFRDeps
} from '/Farm-vista/js/field-readiness/formula.js';

import { buildWxCtx } from '/Farm-vista/js/field-readiness/state.js';

function getPersistedStateForDeps(state, fieldId){
  try{
    const map = (state && state.persistedStateByFieldId && typeof state.persistedStateByFieldId === 'object')
      ? state.persistedStateByFieldId
      : {};

    const fid = String(fieldId || '').trim();
    if (!fid) return null;

    const hit = map[fid];
    return (hit && typeof hit === 'object') ? hit : null;
  }catch(_){
    return null;
  }
}

async function warmFieldWeatherIfAvailable(state, fieldObj, wxCtx){
  try{
    const weather = state && state._mods ? state._mods.weather : null;
    if (!weather || typeof weather.warmWeatherForFields !== 'function') return;

    await weather.warmWeatherForFields([fieldObj], wxCtx, {
      force: false,
      onEach: ()=>{}
    });
  }catch(e){
    console.warn('[WeatherMap] field weather warm failed:', fieldObj && fieldObj.id, e);
  }
}

export async function computeReadinessRunForMapField(state, fieldObj){
  try{
    if (!state || !fieldObj) return null;

    await ensureFRModules(state);

    const wxCtx = buildWxCtx(state);

    await warmFieldWeatherIfAvailable(state, fieldObj, wxCtx);

    const depsTruth = buildFRDeps(state, {
      wxCtx,
      persistedGetter: (id)=> getPersistedStateForDeps(state, id)
    });

    const model = state && state._mods ? state._mods.model : null;
    if (!model || typeof model.runField !== 'function') return null;

    const run = model.runField(fieldObj, depsTruth);
    if (!run) return null;

    const score = Number(run.readinessR);
    if (!Number.isFinite(score)) return null;

    return run;
  }catch(e){
    console.warn('[WeatherMap] readiness run failed:', fieldObj && fieldObj.id, e);
    return null;
  }
}

export function getModelReadinessColor(state, score){
  try{
    const model = state && state._mods ? state._mods.model : null;
    if (model && typeof model.readinessColor === 'function'){
      return model.readinessColor(Number(score || 0));
    }
  }catch(_){}

  const p = Math.max(0, Math.min(100, Number(score || 0)));

  if (p <= 55){
    const t = p / 55;
    const r = Math.round(200 + (216 - 200) * t);
    const g = Math.round(59 + (178 - 59) * t);
    const b = 59;
    return `rgb(${r},${g},${b})`;
  }

  const t = (p - 55) / 45;
  const r = Math.round(216 + (47 - 216) * t);
  const g = Math.round(178 + (143 - 178) * t);
  const b = Math.round(59 + (75 - 59) * t);
  return `rgb(${r},${g},${b})`;
}