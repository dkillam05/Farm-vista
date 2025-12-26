/* =====================================================================
/Farm-vista/js/field-readiness/perm.js  (FULL FILE)
Rev: 2025-12-26e

Permission key: crop-weather (existing system)

IMPORTANT:
- perm-ui.js expects FV.can('crop-weather') style keys (no ".view")
- So we set data-perm="crop-weather" (no suffix)
- Edit gating is handled in code via state.perm.edit

===================================================================== */
'use strict';

const PERM_KEY = 'crop-weather';

function emptyPerm(){
  return { view:false, edit:false, add:false, delete:false };
}

function normalizePerm(v){
  const out = emptyPerm();

  if (typeof v === 'boolean'){
    out.view = v;
    out.edit = false;
    return out;
  }

  if (v && typeof v === 'object'){
    for (const k of ['view','edit','add','delete']){
      if (typeof v[k] === 'boolean') out[k] = v[k];
    }
    return out;
  }

  return out;
}

export function applyPermDataAttrs(){
  // Use the exact key that FV.can understands
  try{
    const grid = document.getElementById('fieldsGrid');
    const detailsPanel = document.getElementById('detailsPanel');

    if (grid) grid.setAttribute('data-perm', PERM_KEY);
    if (detailsPanel) detailsPanel.setAttribute('data-perm', PERM_KEY);
  }catch(_){}
}

export async function loadFieldReadinessPerms(state){
  state.perm = {
    key: PERM_KEY,
    ...emptyPerm(),
    loaded: false,
    roleName: null,
    email: null
  };

  applyPermDataAttrs();

  // If FVUserContext isn't available, fail-open view for testing (but no edit)
  if (!window.FVUserContext || typeof window.FVUserContext.ready !== 'function'){
    state.perm.view = true;
    state.perm.edit = false;
    state.perm.loaded = true;
    try{ document.dispatchEvent(new CustomEvent('fv:user-ready')); }catch(_){}
    return state.perm;
  }

  let ctx = null;
  try{
    ctx = await window.FVUserContext.ready();
  }catch(_){
    ctx = window.FVUserContext.get ? window.FVUserContext.get() : null;
  }

  const eff = (ctx && ctx.effectivePerms && typeof ctx.effectivePerms === 'object') ? ctx.effectivePerms : {};
  const raw = eff[PERM_KEY];

  const p = normalizePerm(raw);

  state.perm = {
    key: PERM_KEY,
    ...p,
    loaded: true,
    roleName: (ctx && ctx.roleName) ? String(ctx.roleName) : null,
    email: (ctx && ctx.email) ? String(ctx.email) : null
  };

  // perm-ui.js listens for fv:user-ready
  try{ document.dispatchEvent(new CustomEvent('fv:user-ready')); }catch(_){}
  return state.perm;
}

export function canView(state){
  return !!(state && state.perm && state.perm.loaded ? state.perm.view : true);
}

export function canEdit(state){
  return !!(state && state.perm && state.perm.loaded ? state.perm.edit : true);
}
