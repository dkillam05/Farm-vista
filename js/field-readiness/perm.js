/* =====================================================================
/Farm-vista/js/field-readiness/perm.js  (FULL FILE)
Rev: 2025-12-26c

Uses existing FarmVista permission engine (FVUserContext):
- Reads ctx.effectivePerms['crop-weather']
- Normalizes to {view, edit, add, delete}
- Adds data-perm hooks for perm-ui.js

===================================================================== */
'use strict';

const PERM_KEY = 'crop-weather';

function emptyPerm(){
  return { view:false, edit:false, add:false, delete:false };
}

function normalizePerm(v){
  const out = emptyPerm();

  // boolean -> treat as view
  if (typeof v === 'boolean'){
    out.view = v;
    out.edit = false;
    return out;
  }

  // object {view, edit, add, delete}
  if (v && typeof v === 'object'){
    for (const k of ['view','edit','add','delete']){
      if (typeof v[k] === 'boolean') out[k] = v[k];
    }
    return out;
  }

  return out;
}

export function applyPermDataAttrs(){
  try{
    const grid = document.getElementById('fieldsGrid');
    const detailsPanel = document.getElementById('detailsPanel');

    // page visibility
    if (grid) grid.setAttribute('data-perm', `${PERM_KEY}.view`);
    if (detailsPanel) detailsPanel.setAttribute('data-perm', `${PERM_KEY}.view`);

    // edit-only interactions will be wired in later modules; when you add UI elements,
    // set data-perm="${PERM_KEY}.edit" on them.
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

  // If FVUserContext isn't available, fail-open view (so layout/testing still works)
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

  try{ document.dispatchEvent(new CustomEvent('fv:user-ready')); }catch(_){}
  return state.perm;
}

export function canView(state){
  return !!(state && state.perm && state.perm.loaded ? state.perm.view : true);
}

export function canEdit(state){
  return !!(state && state.perm && state.perm.loaded ? state.perm.edit : true);
}
