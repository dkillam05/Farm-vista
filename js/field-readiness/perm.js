/* =====================================================================
/Farm-vista/js/field-readiness/perm.js  (FULL FILE)
Rev: 2025-12-26f

Fixes cold-start race with FVUserContext:

- If ctx.effectivePerms does not yet contain 'crop-weather', we treat perms as NOT READY.
  -> view allowed (so no “no permission” flash)
  -> edit false until perms arrive
  -> loaded=false so callers know it’s provisional

- When fv:user-ready fires, index.js will call loadFieldReadinessPerms(state) again.

data-perm:
- Uses data-perm="crop-weather" (no .view suffix) because FV.can expects that.

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
  try{
    const grid = document.getElementById('fieldsGrid');
    const detailsPanel = document.getElementById('detailsPanel');

    if (grid) grid.setAttribute('data-perm', PERM_KEY);
    if (detailsPanel) detailsPanel.setAttribute('data-perm', PERM_KEY);
  }catch(_){}
}

export async function loadFieldReadinessPerms(state){
  // Default: allow viewing while perms are still resolving, but do NOT allow edit.
  state.perm = {
    key: PERM_KEY,
    ...emptyPerm(),

    // provisional defaults
    view: true,
    edit: false,

    loaded: false,
    roleName: null,
    email: null
  };

  applyPermDataAttrs();

  if (!window.FVUserContext || typeof window.FVUserContext.ready !== 'function'){
    // No user context available => allow view for testing; no edit
    try{ document.dispatchEvent(new CustomEvent('fv:user-ready')); }catch(_){}
    return state.perm;
  }

  let ctx = null;
  try{
    ctx = await window.FVUserContext.ready();
  }catch(_){
    ctx = window.FVUserContext.get ? window.FVUserContext.get() : null;
  }

  const eff = (ctx && ctx.effectivePerms && typeof ctx.effectivePerms === 'object') ? ctx.effectivePerms : null;

  // 🚨 KEY FIX:
  // If effectivePerms isn't ready OR doesn't have our key yet, we DO NOT deny.
  // We keep view=true/edit=false and loaded=false, and we rely on fv:user-ready refresh.
  if (!eff || !(PERM_KEY in eff)){
    state.perm.roleName = (ctx && ctx.roleName) ? String(ctx.roleName) : null;
    state.perm.email = (ctx && ctx.email) ? String(ctx.email) : null;
    state.perm.loaded = false;
    return state.perm;
  }

  // Now we have a definitive permission object/boolean
  const p = normalizePerm(eff[PERM_KEY]);

  state.perm = {
    key: PERM_KEY,
    ...p,
    loaded: true,
    roleName: (ctx && ctx.roleName) ? String(ctx.roleName) : null,
    email: (ctx && ctx.email) ? String(ctx.email) : null
  };

  return state.perm;
}

export function canView(state){
  // While not loaded, allow view (prevents “no permission” flash).
  return !!(state && state.perm ? (state.perm.loaded ? state.perm.view : true) : true);
}

export function canEdit(state){
  // While not loaded, do NOT allow edit.
  return !!(state && state.perm ? (state.perm.loaded ? state.perm.edit : false) : false);
}
