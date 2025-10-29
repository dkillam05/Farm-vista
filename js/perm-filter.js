/* /Farm-vista/js/perm-filter.js
   Drawer visibility guard (role + per-user overrides)
   - Reads NAV structure from /js/menu.js
   - Loads the current user's record (employees | subcontractors | vendors)
   - Loads that record's permissionGroup → baseline from accountRoles.perms
   - Applies per-record overrides { "Group.capId": true|false }
   - Hides disallowed links in <fv-shell> drawer without touching your shell code

   Assumptions:
   - accountRoles docs have: { name: string, perms: object }  (or 'permissions' alias)
   - person doc has: { permissionGroup: string, overrides: { "Group.capId": bool } }
   - person doc id is lowercased email (same “emailKey” used across your app)
*/

import NAV_MENU from '/Farm-vista/js/menu.js';
import {
  ready,
  getFirestore, doc, getDoc, collection, getDocs, query, where,
  getAuth
} from '/Farm-vista/js/firebase-init.js';

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
  const CONTAINERS = new Map();       // containerId -> [leaf ids]
  const CAP_TO_TOP = new Map();       // leafId -> topLabel
  const CAP_SET    = new Set();       // all leaf ids
  const TOP_LABELS = [];              // ordered list of top labels (for UI, if needed)

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

    // container for the top group id
    const topIds = [];
    collectLinks([top], topIds);
    CONTAINERS.set(top.id, topIds.slice());

    // subgroup containers
    (top.children||[]).forEach(ch=>{
      if(ch.type==='group'){
        const arr=[]; collectLinks([ch], arr);
        CONTAINERS.set(ch.id, arr.slice());
      }
    });

    // map leaves to top label
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

  // initialize all leaves false
  CAP_SET.forEach(id=>{
    const t = CAP_TO_TOP.get(id);
    if(t) base[t][id] = false;
  });

  if(!perms || typeof perms!=='object') return base;

  // (1) container-level defaults
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

  // (2) explicit leaf overrides
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
  // start from baseline
  Object.keys(base).forEach(group=>{
    Object.entries(base[group]).forEach(([capId, on])=>{
      if(on) allowed.add(capId);
    });
  });
  // apply overrides
  if(overrides && typeof overrides==='object'){
    Object.entries(overrides).forEach(([path, v])=>{
      const parts = path.split('.');
      const capId = parts.length>=2 ? parts.slice(1).join('.') : null; // "Group.cap" -> "cap"
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
  // Priority: employees → subcontractors → vendors
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
function findShell(){
  return document.querySelector('fv-shell');
}

function findDrawerRoot(shell){
  // Best-effort: look into shadowRoot and try common containers
  const r = shell && shell.shadowRoot;
  if(!r) return null;
  return r.querySelector('nav, aside, .drawer, [data-role="drawer"], [part="drawer"]');
}

function hideNode(node){
  if(!node) return;
  // Hide the LI/row wrapper if possible
  const li = node.closest('li, .nav-item, .drawer-row') || node;
  li.style.display = 'none';
}

function isNodeVisible(node){
  const el = node.closest('li, .nav-item, .drawer-row') || node;
  return el.style.display !== 'none';
}

function filterDrawer(allowedIds, hrefToId){
  const shell = findShell();
  if(!shell) return false;

  const root = findDrawerRoot(shell);
  if(!root) return false;

  const anchors = root.querySelectorAll('a[href^="/Farm-vista/"]');
  anchors.forEach(a=>{
    const href = a.getAttribute('href');
    const id = hrefToId.get(href);
    if(!id) return;                       // non-menu or container header link → skip
    if(!allowedIds.has(id)){
      hideNode(a);
    }
  });

  // Second pass: hide empty group headers (no visible descendants)
  const possibleGroups = root.querySelectorAll('details, .nav-group, .group');
  possibleGroups.forEach(g=>{
    const visibleChildLink = g.querySelector('a[href^="/Farm-vista/"]');
    if(!visibleChildLink){
      // If it has any anchor at all, check if any are visible
      const anyVisible = Array.from(g.querySelectorAll('a[href^="/Farm-vista/"]'))
        .some(isNodeVisible);
      if(!anyVisible){
        g.style.display='none';
      }
    }else{
      // has a link; ensure at least one is visible
      const anyVisible = Array.from(g.querySelectorAll('a[href^="/Farm-vista/"]'))
        .some(isNodeVisible);
      if(!anyVisible){
        g.style.display='none';
      }
    }
  });

  return true;
}

/* Observe re-renders of <fv-shell> and re-apply filtering */
function observeShell(allowedIds, hrefToId){
  const shell = findShell();
  if(!shell) return;

  const r = shell.shadowRoot;
  if(!r) return;

  const apply = ()=>filterDrawer(allowedIds, hrefToId);

  // Initial attempt(s)
  let tries = 0;
  const kick = async ()=>{
    for(; tries<10; tries++){
      if(apply()) return;
      await sleep(120);
    }
  };
  kick();

  const mo = new MutationObserver(()=>apply());
  mo.observe(r, { childList:true, subtree:true });
}

/* ------------------------------- main ------------------------------- */
(async function boot(){
  try{
    const { hrefToId } = flattenLinks(NAV_MENU);
    const indexes = buildContainerIndexes(NAV_MENU);

    await ready;
    const auth = getAuth();

    // Wait for user to be available
    let user = auth.currentUser;
    for(let i=0; i<30 && !user; i++){ await sleep(100); user = auth.currentUser; }

    if(!user || !user.email){
      // No user (public view?) → do nothing
      return;
    }

    // Load per-user core record
    const person = await loadPersonRecord(user.email);
    const roleName = person?.data?.permissionGroup || 'Standard';

    // Load role baseline
    const roleDoc = await fetchRoleDocByName(roleName);
    const perms = roleDoc?.perms || roleDoc?.permissions || null;
    const base = buildBaselineFromPerms(perms, indexes);

    // Apply overrides (if any)
    const overrides = person?.data?.overrides || {};
    const allowedIds = computeAllowedSet(base, overrides);

    // OPTIONAL: always allow 'home' if present in menu (keeps app usable)
    // Comment this out if you strictly want to control Home too.
    if(hrefToId.has('/Farm-vista/index.html')) {
      allowedIds.add('home');
    }

    // Filter drawer when shell is ready / re-renders
    observeShell(allowedIds, hrefToId);

    // Also expose for debugging
    window.FV_EFFECTIVE_MENU = { role: roleName, personType: person?.type || null, allowedIds: Array.from(allowedIds) };
  }catch(err){
    console.error('[perm-filter] failed', err);
  }
})();