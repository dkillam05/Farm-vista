/* ======================================================================
   /Farm-vista/js/rainfallmap/readiness-core.js
   FULL FILE REBUILD
   Matches render.js readiness path:
   - uses runFieldReadiness(..., { opKey, wxCtx, persistedGetter })
   - falls back to model.runField(buildFRDeps(...))
   ====================================================================== */

import { buildWxCtx } from '/Farm-vista/js/field-readiness/state.js';
import { ensureFRModules, buildFRDeps, runFieldReadiness } from '/Farm-vista/js/field-readiness/formula.js';

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

function buildDepsForState(state, opKey){
  const wxCtx = buildWxCtx(state);
  return buildFRDeps(state, {
    opKey: String(opKey || ''),
    wxCtx,
    persistedGetter: (id)=> getPersistedStateForDeps(state, id)
  });
}

export async function computeReadinessRunForMapField(state, fieldObj, opKey){
  try{
    if (!state || !fieldObj) return null;

    await ensureFRModules(state);

    const wxCtx = buildWxCtx(state);

    try{
      const run = await runFieldReadiness(state, fieldObj, {
        opKey: String(opKey || ''),
        wxCtx,
        persistedGetter: (id)=> getPersistedStateForDeps(state, id)
      });

      if (run && Number.isFinite(Number(run.readinessR))){
        return run;
      }
    }catch(_){
      // fall through to legacy fallback below
    }

    try{
      const deps = buildDepsForState(state, opKey);
      const model = state && state._mods ? state._mods.model : null;

      if (model && typeof model.runField === 'function'){
        const legacy = model.runField(fieldObj, deps);
        if (legacy && Number.isFinite(Number(legacy.readinessR))){
          return legacy;
        }
      }
    }catch(_){
      // fall through
    }

    return null;
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