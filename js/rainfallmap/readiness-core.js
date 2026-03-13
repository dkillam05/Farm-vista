import { ensureFRModules, buildFRDeps } from '/Farm-vista/js/field-readiness/formula.js';
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

export async function computeReadinessRunForMapField(state, fieldObj){
  try{
    if (!state || !fieldObj) return null;

    await ensureFRModules(state);

    const wxCtx = buildWxCtx(state);

    const depsTruth = buildFRDeps(state, {
      wxCtx,
      persistedGetter: (id)=> getPersistedStateForDeps(state, id)
    });

    const runTruth = state._mods.model.runField(fieldObj, depsTruth);
    if (!runTruth) return null;

    const score = Number(runTruth.readinessR);
    if (!Number.isFinite(score)) return null;

    return runTruth;
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