/* /Farm-vista/js/perm-filter.js
   Drawer visibility guard (role + per-user overrides)
   STRICT MODE: hides all menu items until permissions are computed (deny-by-default).
*/

import NAV_MENU from '/Farm-vista/js/menu.js';
import {
  ready,
  getFirestore, doc, getDoc, collection, getDocs, query, where,
  getAuth
} from '/Farm-vista/js/firebase-init.js';

/* ------------------------------ config ------------------------------ */
const STRICT_DENY_UNTIL_READY = true;   // ⬅ keep everything hidden until we know allowed set
const ALWAYS_ALLOW_HOME = true;         // usability; set false for absolute strict

/* ------------------------------ helpers ------------------------------ */
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
const emailKey = e => String(e||'').trim().toLowerCase();

/* Build a flat map of href->id for all links so we can match DOM anchors */
function flattenLinks(nav){
  const hrefToId = new Map();
  const idToHref  = new Map();

  function walk(nodes){
    (nodes||[]).forEach(n=>{
      if(n.type==='link' && n.id && n.href){
        hrefToId.set(n.href, n.id);
        idToHref.set(n.id, n.href);
      }else if(n.type==='group' && Array.isArray(n.children)){
        walk(n.children);
      }
    });
  }
  walk(nav.items||[]);
  return { hrefToId, idToHref };
}

/* Build container indexes: containerId -> [leaf ids], plus top-label mapping */
function buildContainerIndexes(nav){
  const CONTAINERS = new Map();
  const CAP_TO_TOP = new Map();
  const CAP_SET    = new Set();
  const TOP_LABELS = [];

  function collectLinks(nodes, acc){
    nodes.forEach(n=>{
      if(n.type==='group' && Array.isArray(n.children)){
        collectLinks(n.children, acc);
      }else if(n.type==='link'){
        acc.push(n.id);
      }
    });
  }

  (nav.items||[]).forEach(top=>{
    if(top.type!=='group') return;
    const topLabel = top.label || top.id || 'General';
    TOP_LABELS.push(topLabel);

    const topIds = [];
    collectLinks([top], topIds);
    CONTAINERS.set(top.id, topIds.slice());

    (top.children||[]).forEach(ch=>{
      if(ch.type==='group'){
        const arr=[]; collectLinks([ch], arr);
        CONTAINERS.set(ch.id, arr.slice());
      }
    });

    topIds.forEach(id=>{
      CAP_SET.add(id);
      CAP_TO_TOP.set(id, topLabel);
    });
  });

  return { CONTAINERS, CAP_TO_TOP, CAP_SET, TOP_LABELS };
}

/* Convert accountRoles.perms into a baseline { topLabel: { capId: boolean } } */
function buildBaselineFromPerms(perms, indexes){
  const { CONTAINERS, CAP_TO_TOP, CAP_SET, TOP_LABELS } = indexes;
  const base = {};
  TOP_LABELS.forEach(t=>{ base[t] = {}; });

  CAP_SET.forEach(id=>{
    const t = CAP_TO_TOP.get(id);
    if(t) base[t][id] = false;
  });

  if(!perms || typeof perms!=='object') return base;

  // container defaults
  Object.keys(perms).forEach(key=>{
    const val = perms[key];
    const on = (typeof val==='boolean') ? val : (val && typeof val.on==='boolean' ? val.on : undefined);
    if(on === undefined) return;
    if(CONTAINERS.has(key)){
      (CONTAINERS.get(key)||[]).forEach(leaf=>{
        const t = CAP_TO_TOP.get(leaf);
        if(t) base[t][leaf] = on;
      });
    }
  });

  // explicit leaf overrides
  Object.keys(perms).forEach(key=>{
    const val = perms[key];
    const on = (typeof val==='boolean') ? val : (val && typeof val.on==='boolean' ? val.on : undefined);
    if(on === undefined) return;
    if(indexes.CAP_SET.has(key)){
      const t = indexes.CAP_TO_TOP.get(key);
      if(t) base[t][key] = on;
    }
  });

  return base;
}

/* Apply per-record overrides: { "Group.capId": true|false } and return Set of allowed leaf ids */
function computeAllowedSet(base, overrides){
  const allowed = new Set();
  Object.keys(base).forEach(group=>{
    Object.entries(base[group]).forEach(([capId, on])=>{
      if(on) allowed.add(capId);
    });
  });
  if(overrides && typeof overrides==='object'){
    Object.entries(overrides).forEach(([path, v])=>{
      const parts = path.split('.');
      const capId = parts.length>=2 ? parts.slice(1).join('.') : null;
      if(!capId) return;
      if(v === true)  allowed.add(capId);
      if(v === false) allowed.delete(capId);
    });
  }
  return allowed;
}

/* --------------------------- data loaders --------------------------- */
async function fetchRoleDocByName(name){
  const db = getFirestore();
  const qRef = query(collection(db,'accountRoles'), where('name','==', name));
  const snap = await getDocs(qRef);
  let docData=null; snap.forEach(d=>{ docData = d.data()||null; });
  return docData;
}

async function loadPersonRecord(email){
  const db = getFirestore();
  const id = emailKey(email);
  const tries = [
    { coll:'employees',       key:'Employee' },
    { coll:'subcontractors',  key:'Subcontractor' },
    { coll:'vendors',         key:'Vendor' }
  ];
  for(const t of tries){
    const ref = doc(db, t.coll, id);
    const s = await getDoc(ref);
    if(s.exists()) return { type:t.key, data:s.data(), id, coll:t.coll };
  }
  return null;
}

/* ----------------------- DOM filtering engine ----------------------- */
function getShell(){ return document.querySelector('fv-shell'); }
function getDrawerRoot(shell){
  const r = shell && shell.shadowRoot;
  if(!r) return null;
  return r.querySelector('.drawer') || r.querySelector('nav') || r.querySelector('[part="drawer"]');
}

function setAllVisible(root, on){
  if(!root) return;
  root.querySelectorAll('a[href^="/Farm-vista/"]').forEach(a=>{
    const li = a.closest('a, li, .nav-item, .drawer-row, div') || a;
    li.style.display = on ? '' : 'none';
  });
  root.querySelectorAll('.nav-group, details, .group').forEach(g=>{
    g.style.display = on ? '' : 'none';
  });
}

function applyAllowed(root, allowedIds, hrefToId){
  if(!root) return false;

  // Start by hiding all if strict, else show all and hide selectively
  if (STRICT_DENY_UNTIL_READY) setAllVisible(root, false);

  // Show allowed links
  let anyShown = false;
  root.querySelectorAll('a[href^="/Farm-vista/"]').forEach(a=>{
    const href = a.getAttribute('href');
    const id = hrefToId.get(href);
    if(!id) return;
    if(allowedIds.has(id)){
      const li = a.closest('a, li, .nav-item, .drawer-row, div') || a;
      li.style.display = '';
      anyShown = true;
    }
  });

  // Reveal parent groups that contain visible links
  root.querySelectorAll('.nav-group, details, .group').forEach(g=>{
    const visibleChild = Array.from(g.querySelectorAll('a[href^="/Farm-vista/"]')).some(a=>{
      const el = a.closest('a, li, .nav-item, .drawer-row, div') || a;
      return el.style.display !== 'none';
    });
    g.style.display = visibleChild ? '' : 'none';
  });

  return anyShown;
}

function observeShell(allowedIds, hrefToId){
  const shell = getShell(); if(!shell) return;
  const root  = getDrawerRoot(shell); if(!root) return;

  const apply = ()=> applyAllowed(getDrawerRoot(getShell()), allowedIds, hrefToId);

  // First, hide everything strictly until we apply (prevents flash of full menu)
  if (STRICT_DENY_UNTIL_READY) setAllVisible(root, false);

  // Initial attempts
  let tries = 0;
  const kick = async ()=>{
    for(; tries<12; tries++){
      if(apply()) return;
      await sleep(120);
    }
  };
  kick();

  const mo = new MutationObserver(()=>apply());
  mo.observe(shell.shadowRoot, { childList:true, subtree:true });
}

/* ------------------------------- main ------------------------------- */
(async function boot(){
  try{
    const { hrefToId } = flattenLinks(NAV_MENU);
    const indexes = buildContainerIndexes(NAV_MENU);

    await ready;
    const auth = getAuth();

    // If auth hasn’t hydrated yet, keep everything hidden in strict mode.
    let user = auth && auth.currentUser;
    for(let i=0; i<30 && !user; i++){ await sleep(100); user = auth.currentUser; }

    // Prepare drawer early to avoid flash
    const shell = getShell();
    const root  = getDrawerRoot(shell);
    if (STRICT_DENY_UNTIL_READY && root) setAllVisible(root, false);

    if(!user || !user.email){
      // No authenticated user → remain hidden (strict) to avoid privilege leak.
      // If you prefer public Home, flip STRICT_DENY_UNTIL_READY to false and rely on shell-only.
      return;
    }

    // Load person + role
    const person   = await loadPersonRecord(user.email);
    const roleName = person?.data?.permissionGroup || 'Standard';
    const roleDoc  = await fetchRoleDocByName(roleName);
    const perms    = roleDoc?.perms || roleDoc?.permissions || null;

    const base     = buildBaselineFromPerms(perms, indexes);
    const overrides= person?.data?.overrides || {};
    const allowed  = computeAllowedSet(base, overrides);

    // Optional: always allow Home
    if (ALWAYS_ALLOW_HOME && hrefToId.has('/Farm-vista/index.html')) {
      allowed.add('home');
    }

    observeShell(allowed, hrefToId);

    // Debug handle
    window.FV_EFFECTIVE_MENU = { role: roleName, personType: person?.type || null, allowedIds: Array.from(allowed) };
  }catch(err){
    console.error('[perm-filter] failed', err);
    // On failure, strict mode keeps the drawer hidden to prevent exposure.
  }
})();