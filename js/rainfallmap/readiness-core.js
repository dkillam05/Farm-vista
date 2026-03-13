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

    const deps = buildFRDeps(state, {
      wxCtx,
      persistedGetter: (id)=> getPersistedStateForDeps(state, id)
    });

    const model = state && state._mods ? state._mods.model : null;
    if (!model || typeof model.runField !== 'function') return null;

    const run = model.runField(fieldObj, deps);
    if (!run) return null;

    const score = Number(run.readinessR);
    if (!Number.isFinite(score)) return null;

    return run;
  }catch(e){
    console.warn('[WeatherMap] readiness run failed:', fieldObj && fieldObj.id, e);
    return null;
  }
}
