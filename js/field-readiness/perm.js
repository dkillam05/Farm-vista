/* =====================================================================
/Farm-vista/js/field-readiness/perm.js  (FULL FILE)
Rev: 2025-12-26a

Permission resolution for Field Readiness using FarmVista data model:

- employees/{email} → permissionGroup + overrides
- accountRoles (query name == permissionGroup) → perms map
- merge employee overrides into role perms
- exports:
    loadFieldReadinessPerms(state) -> sets state.perm
    applyPermDataAttrs(state) -> adds data-perm attributes (optional UX)

Permission key:
  crop-field-readiness

Actions:
  view / edit / add / delete
===================================================================== */
'use strict';

import { getAPI } from './firebase.js';
import { setErr } from './utils.js';

const PERM_KEY = 'crop-field-readiness';

function normEmail(s){
  return String(s||'').trim().toLowerCase();
}

function emptyPerm(){
  return { view:false, edit:false, add:false, delete:false };
}

function mergePerm(base, over){
  const out = { ...emptyPerm(), ...(base||{}) };
  if (!over || typeof over !== 'object') return out;

  for (const k of ['view','edit','add','delete']){
    if (typeof over[k] === 'boolean') out[k] = over[k];
  }
  return out;
}

// If your FV.can() already exists, we DO NOT replace it.
// If it doesn't exist, we install a minimal version for this page.
function ensureFVCan(state){
  if (!window.FV) window.FV = {};
  if (typeof window.FV.can === 'function') return;

  window.FV.can = function(permission){
    try{
      const perm = String(permission||'').trim();
      if (!perm) return true;

      // Allow both "crop-field-readiness" and "crop-field-readiness.view"
      const parts = perm.split('.');
      const key = parts[0];
      const action = (parts[1] || 'view').toLowerCase();

      // Only handle our key; fail-open for other keys (so we don't break the app)
      if (key !== PERM_KEY) return true;

      const p = (state && state.perm && state.perm.key === PERM_KEY) ? state.perm : null;
      if (!p) return true; // fail-open until loaded; perm-ui will reapply after fv:user-ready
      if (action === 'view') return !!p.view;
      if (action === 'edit') return !!p.edit;
      if (action === 'add') return !!p.add;
      if (action === 'delete') return !!p.delete;

      // unknown action -> be conservative
      return false;
    }catch(_){
      return true;
    }
  };
}

// Best-effort read of employees doc:
// 1) docId = lowercased email
// 2) docId = original email
// 3) query where('email' == emailLower) and take first
async function readEmployeeByEmail(api, email){
  const emailLower = normEmail(email);
  if (!emailLower) return null;

  if (api.kind !== 'compat'){
    const db = api.getFirestore();

    // try doc(lower)
    try{
      const ref1 = api.doc(db, 'employees', emailLower);
      const snap1 = await api.getDoc(ref1);
      if (snap1 && snap1.exists && snap1.exists()) return { id:snap1.id, ...snap1.data() };
    }catch(_){}

    // try doc(original)
    try{
      const ref2 = api.doc(db, 'employees', String(email||'').trim());
      const snap2 = await api.getDoc(ref2);
      if (snap2 && snap2.exists && snap2.exists()) return { id:snap2.id, ...snap2.data() };
    }catch(_){}

    // query by email field
    try{
      const q = api.query(api.collection(db,'employees'), api.where('email','==', emailLower));
      const snap = await api.getDocs(q);
      let found = null;
      snap.forEach(doc=>{
        if (found) return;
        found = { id:doc.id, ...doc.data() };
      });
      return found;
    }catch(_){
      return null;
    }
  }

  // compat mode
  try{
    const db = window.firebase.firestore();

    // doc(lower)
    try{
      const s1 = await db.collection('employees').doc(emailLower).get();
      if (s1 && s1.exists) return { id:s1.id, ...s1.data() };
    }catch(_){}

    // doc(original)
    try{
      const s2 = await db.collection('employees').doc(String(email||'').trim()).get();
      if (s2 && s2.exists) return { id:s2.id, ...s2.data() };
    }catch(_){}

    // query
    const qs = await db.collection('employees').where('email','==', emailLower).limit(1).get();
    if (!qs.empty){
      const d = qs.docs[0];
      return { id:d.id, ...d.data() };
    }
  }catch(_){}

  return null;
}

async function readRoleByName(api, roleName){
  const name = String(roleName||'').trim();
  if (!name) return null;

  if (api.kind !== 'compat'){
    try{
      const db = api.getFirestore();
      const q = api.query(api.collection(db,'accountRoles'), api.where('name','==', name));
      const snap = await api.getDocs(q);
      let found = null;
      snap.forEach(doc=>{
        if (found) return;
        found = { id:doc.id, ...doc.data() };
      });
      return found;
    }catch(_){
      return null;
    }
  }

  // compat
  try{
    const db = window.firebase.firestore();
    const qs = await db.collection('accountRoles').where('name','==', name).limit(1).get();
    if (!qs.empty){
      const d = qs.docs[0];
      return { id:d.id, ...d.data() };
    }
  }catch(_){}

  return null;
}

export async function loadFieldReadinessPerms(state){
  state.perm = {
    key: PERM_KEY,
    ...emptyPerm(),
    loaded: false,
    roleName: null,
    employeeId: null,
    email: null
  };

  ensureFVCan(state);

  const api = getAPI(state);
  if (!api){
    // no firebase helpers; fail-open view but no edit
    state.perm.view = true;
    state.perm.edit = false;
    state.perm.loaded = true;
    try{ document.dispatchEvent(new CustomEvent('fv:user-ready')); }catch(_){}
    return state.perm;
  }

  // Determine current user email
  let email = '';
  try{
    const auth = api.getAuth ? api.getAuth() : null;
    const user = auth && auth.currentUser ? auth.currentUser : null;
    email = user && user.email ? String(user.email) : '';
  }catch(_){}
  email = normEmail(email);

  state.perm.email = email;

  // If no email (stub mode / not signed in), fail-open view but no edit
  if (!email){
    state.perm.view = true;
    state.perm.edit = false;
    state.perm.loaded = true;
    try{ document.dispatchEvent(new CustomEvent('fv:user-ready')); }catch(_){}
    return state.perm;
  }

  const emp = await readEmployeeByEmail(api, email);
  const group = emp ? String(emp.permissionGroup||'').trim() : '';
  const overrides = emp && emp.overrides ? emp.overrides : {};

  // If no employee doc, fail-open view but no edit (you can tighten later)
  if (!emp || !group){
    state.perm.view = true;
    state.perm.edit = false;
    state.perm.loaded = true;
    state.perm.roleName = group || null;
    state.perm.employeeId = emp ? emp.id : null;

    try{ document.dispatchEvent(new CustomEvent('fv:user-ready')); }catch(_){}
    return state.perm;
  }

  const role = await readRoleByName(api, group);
  const base = (role && role.perms && role.perms[PERM_KEY]) ? role.perms[PERM_KEY] : emptyPerm();
  const ov  = (overrides && overrides[PERM_KEY]) ? overrides[PERM_KEY] : null;
  const merged = mergePerm(base, ov);

  state.perm = {
    key: PERM_KEY,
    ...merged,
    loaded: true,
    roleName: group,
    employeeId: emp.id || null,
    email
  };

  // Let perm-ui re-apply once perms are known
  try{ document.dispatchEvent(new CustomEvent('fv:user-ready')); }catch(_){}

  return state.perm;
}

export function applyPermDataAttrs(){
  // Optional: add data-perm hooks so your existing perm-ui.js can hide/disable.
  // We avoid changing HTML files by setting them at runtime.
  try{
    const grid = document.getElementById('fieldsGrid');
    const details = document.getElementById('detailsPanel');
    if (grid) grid.setAttribute('data-perm', `${PERM_KEY}.view`);
    if (details) details.setAttribute('data-perm', `${PERM_KEY}.view`);
  }catch(_){}
}
