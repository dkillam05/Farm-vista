/* =====================================================================
/Farm-vista/js/field-readiness/perm.js  (FULL FILE)
Rev: 2025-12-27a

Fixes:
✅ Robust perm-key matching (crop-weather / crop_weather / cropWeather / etc)
✅ Keeps cold-start behavior:
   - view allowed while not loaded (prevents “no permission” flash)
   - edit false until loaded (prevents premature edit UI)
✅ data-perm attributes kept as "crop-weather"

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
    // legacy {on:true}
    if (typeof v.on === 'boolean'){
      out.view = !!v.on;
    }
    return out;
  }

  return out;
}

function simplifyKey(s){
  return String(s||'')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g,'-')
    .replace(/[^a-z0-9.-]+/g,'')
    .replace(/-+/g,'-');
}

function pickPermValue(eff){
  if (!eff || typeof eff !== 'object') return { found:false, key:null, value:null };

  // 1) exact
  if (PERM_KEY in eff) return { found:true, key:PERM_KEY, value: eff[PERM_KEY] };

  // 2) common alternates
  const alts = [
    PERM_KEY.replace(/-/g,'_'),
    PERM_KEY.replace(/-/g,''),
    PERM_KEY.replace(/-/g,' ').trim(),
    'cropWeather',
    'crop_weather'
  ];
  for (const k of alts){
    if (k in eff) return { found:true, key:k, value: eff[k] };
  }

  // 3) simplified match (covers crop-weather vs crop_weather vs Crop Weather)
  const want = simplifyKey(PERM_KEY);
  for (const k of Object.keys(eff)){
    if (simplifyKey(k) === want) return { found:true, key:k, value: eff[k] };
  }

  return { found:false, key:null, value:null };
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
  // Provisional defaults:
  // - allow view while resolving (no "no permission" flash)
  // - do NOT allow edit until definitive perms arrive
  state.perm = {
    key: PERM_KEY,
    ...emptyPerm(),
    view: true,
    edit: false,
    loaded: false,
    roleName: null,
    email: null
  };

  applyPermDataAttrs();

  if (!window.FVUserContext || typeof window.FVUserContext.ready !== 'function'){
    // No context => view for dev, edit off
    return state.perm;
  }

  let ctx = null;
  try{
    ctx = await window.FVUserContext.ready();
  }catch(_){
    ctx = window.FVUserContext.get ? window.FVUserContext.get() : null;
  }

  const eff = (ctx && ctx.effectivePerms && typeof ctx.effectivePerms === 'object') ? ctx.effectivePerms : null;

  const picked = pickPermValue(eff);

  // If not ready or key not present yet: keep provisional view=true/edit=false/loaded=false
  if (!picked.found){
    state.perm.roleName = (ctx && ctx.roleName) ? String(ctx.roleName) : null;
    state.perm.email = (ctx && ctx.email) ? String(ctx.email) : null;
    state.perm.loaded = false;
    return state.perm;
  }

  const p = normalizePerm(picked.value);

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
