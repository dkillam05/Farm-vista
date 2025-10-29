/* /Farm-vista/js/perm-filter.js  v2
   Drawer visibility guard (role + per-user overrides), security-first.

   Key behaviors:
   - DENY BY DEFAULT: while auth/perms are unresolved, the drawer content stays masked.
   - Uses menu structure to map hrefs → capability IDs; hides disallowed links.
   - Loads person (employees|subcontractors|vendors) by emailKey and resolves role baseline
     from accountRoles.perms (or .permissions), then applies per-record overrides.
   - Caches allowed set in sessionStorage per-user (for offline). If offline and no cache,
     drawer remains hidden instead of exposing everything.
   - Re-applies when <fv-shell> re-renders and on auth changes.

   Assumptions:
   - /Farm-vista/js/menu.js exports default NAV_MENU or named NAV_MENU (id+href present on links).
   - Person doc: { permissionGroup: string, overrides: { "Group.capId": true|false } }
   - accountRoles doc: { name: string, perms?: object, permissions?: object }
*/

import NAV_MENU from '/Farm-vista/js/menu.js';
import {
  ready,
  getFirestore, doc, getDoc, collection, getDocs, query, where,
  getAuth, onAuthStateChanged
} from '/Farm-vista/js/firebase-init.js';

/* ------------------------------ helpers ------------------------------ */
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
const emailKey = e => String(e||'').trim().toLowerCase();

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const cacheKey = (email)=> `fv:perm:v2:${emailKey(email)}`;

function getShell(){ return document.querySelector('fv-shell'); }
function getShellRoot(){ const s=getShell(); return s && s.shadowRoot; }

function getDrawerNav(){
  const r = getShellRoot();
  if(!r) return null;
  // We mask/unmask at NAV level so nothing flashes.
  return r.querySelector('.drawer .js-nav') || r.querySelector('.drawer nav') || r.querySelector('nav');
}

function getDrawer(){
  const r = getShellRoot();
  return r && r.querySelector('.drawer');
}

function maskDrawer(on=true){
  const nav = getDrawerNav();
  const drawer = getDrawer();
  if(!drawer || !nav) return;
  // Use visibility:hidden so layout stays stable; nothing is clickable.
  drawer.setAttribute('data-perm-mask', on ? '1' : '0');
  drawer.style.visibility = on ? 'hidden' : '';
  nav.style.visibility = on ? 'hidden' : '';
}

function hideNode(node){
  if(!node) return;
  const li = node.closest('a, li, .nav-item, .drawer-row, div') || node;
  li.style.display = 'none';
}
function showNode(node){
  if(!node) return;
  const li = node.closest('a, li, .nav-item, .drawer-row, div') || node;
  li.style.display = '';
}
function isVisible(node){
  const el = node.closest('a, li, .nav-item, .drawer-row, div') || node;
  return el.style.display !== 'none';
}

/* Build a flat map of href->id for all links so we can match DOM anchors */
function flattenLinks(nav){
  const hrefToId = new Map();
  const idToHref  = new Map();
  (function walk(nodes){
    (nodes||[]).forEach(n=>{
      if(n.type==='link' && n.id && n.href){
        hrefToId.set(n.href, n.id);
        idToHref.set(n.id, n.href);
      }else if(n.type==='group' && Array.isArray(n.children)){
        walk(n.children);
      }
    });
  })(nav.items||[]);
  return { hrefToId, idToHref };
}

/* Build container indexes: containerId -> [leaf ids], plus top-label mapping */
function buildContainerIndexes(nav){
  const CONTAINERS = new Map(); // containerId -> [leaf ids]
  const CAP_TO_TOP = new Map(); // leafId -> topLabel
  const CAP_SET    = new Set();
  const TOP_LABELS = [];

  const collectLinks=(nodes,acc)=>{
    nodes.forEach(n=>{
      if(n.type==='group' && Array.isArray(n.children)) collectLinks(n.children, acc);
      else if(n.type==='link') acc.push(n.id);
    });
  };

  (nav.items||[]).forEach(top=>{
    if(top.type!=='group') return;
    const topLabel = top.label || top.id || 'General';
    TOP_LABELS.push(topLabel);

    const topIds=[]; collectLinks([top], topIds);
    CONTAINERS.set(top.id, topIds.slice());

    (top.children||[]).forEach(ch=>{
      if(ch.type==='group'){
        const arr=[]; collectLinks([ch], arr);
        CONTAINERS.set(ch.id, arr.slice());
      }
    });

    topIds.forEach(id=>{ CAP_SET.add(id); CAP_TO_TOP.set(id, topLabel); });
  });

  return { CONTAINERS, CAP_TO_TOP, CAP_SET, TOP_LABELS };
}

/* Convert accountRoles.perms into a baseline { topLabel: { capId: boolean } } */
function buildBaselineFromPerms(perms, indexes){
  const { CONTAINERS, CAP_TO_TOP, CAP_SET, TOP_LABELS } = indexes;
  const base = {}; TOP_LABELS.forEach(t=> base[t]={});
  CAP_SET.forEach(id=>{ const t=CAP_TO_TOP.get(id); if(t) base[t][id]=false; });
  if(!perms || typeof perms!=='object') return base;

  // container-level
  Object.keys(perms).forEach(k=>{
    const v = perms[k];
    const on = (typeof v==='boolean')? v : (v && typeof v.on==='boolean'? v.on : undefined);
    if(on===undefined) return;
    if(CONTAINERS.has(k)){
      (CONTAINERS.get(k)||[]).forEach(leaf=>{
        const t = CAP_TO_TOP.get(leaf); if(t) base[t][leaf]=on;
      });
    }
  });
  // explicit leafs
  Object.keys(perms).forEach(k=>{
    const v = perms[k];
    const on = (typeof v==='boolean')? v : (v && typeof v.on==='boolean'? v.on : undefined);
    if(on===undefined) return;
    if(indexes.CAP_SET.has(k)){
      const t = indexes.CAP_TO_TOP.get(k);
      if(t) base[t][k]=on;
    }
  });
  return base;
}

/* Apply per-record overrides → Set of allowed leaf ids */
function computeAllowedSet(base, overrides){
  const allowed = new Set();
  Object.keys(base).forEach(group=>{
    Object.entries(base[group]).forEach(([capId,on])=>{ if(on) allowed.add(capId); });
  });
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
function applyFilterToDrawer(allowedIds, hrefToId){
  const r = getShellRoot(); if(!r) return false;
  const drawer = r.querySelector('.drawer'); if(!drawer) return false;
  const nav = getDrawerNav(); if(!nav) return false;

  // Reset any prior visibility (for re-renders)
  nav.querySelectorAll('a[href^="/Farm-vista/"]').forEach(a=> showNode(a));
  r.querySelectorAll('.nav-group, .group, details').forEach(g=> g.style.display='');

  // Hide disallowed links
  nav.querySelectorAll('a[href^="/Farm-vista/"]').forEach(a=>{
    const href = a.getAttribute('href');
    const id = hrefToId.get(href);
    if(!id) return; // header rows that are groups may have hrefs; only hide when we have a leaf id
    if(!allowedIds.has(id)) hideNode(a);
  });

  // Hide empty groups
  const groups = r.querySelectorAll('.nav-group, .group, details');
  groups.forEach(g=>{
    const links = g.querySelectorAll('a[href^="/Farm-vista/"]');
    const anyVisible = Array.from(links).some(isVisible);
    if(!anyVisible) g.style.display='none';
  });

  return true;
}

function observeDrawer(allowedIds, hrefToId){
  const r = getShellRoot(); if(!r) return;
  const apply = ()=> applyFilterToDrawer(allowedIds, hrefToId);

  // Attempt a few times (menus can render after import)
  (async()=>{ for(let i=0;i<12;i++){ if(apply()) break; await sleep(100);} })();

  // Watch for drawer/nav changes and re-apply
  const mo = new MutationObserver(()=>apply());
  mo.observe(r, { childList:true, subtree:true });
}

/* ----------------------------- caching ------------------------------ */
function readCache(email){
  try{
    const raw = sessionStorage.getItem(cacheKey(email));
    if(!raw) return null;
    const obj = JSON.parse(raw);
    if(!obj || !obj.ts || !Array.isArray(obj.allowed)) return null;
    if(Date.now() - obj.ts > CACHE_TTL_MS) return null;
    return new Set(obj.allowed);
  }catch{ return null; }
}
function writeCache(email, allowedSet){
  try{
    const obj = { ts: Date.now(), allowed: Array.from(allowedSet||[]) };
    sessionStorage.setItem(cacheKey(email), JSON.stringify(obj));
  }catch{}
}

/* ------------------------------- main ------------------------------- */
(async function boot(){
  try{
    // Start masked to avoid “flash of everything”
    maskDrawer(true);

    const { hrefToId } = flattenLinks(NAV_MENU);
    const indexes = buildContainerIndexes(NAV_MENU);

    await ready;
    const auth = getAuth();

    // Wait for auth/user hydration
    const user = await new Promise(resolve=>{
      if (auth.currentUser) return resolve(auth.currentUser);
      const off = onAuthStateChanged(auth, u=>{ off && off(); resolve(u); });
      setTimeout(()=> resolve(auth.currentUser||null), 1600);
    });

    if(!user || !user.email){
      // No recognized user → keep masked (security-first)
      return;
    }

    // Try cached permissions (offline/fast path)
    let allowed = readCache(user.email);
    if(!allowed){
      // Live fetch
      let person=null, roleDoc=null, base=null, overrides=null;

      try{ person = await loadPersonRecord(user.email); }catch{}
      const roleName = person?.data?.permissionGroup || 'Standard';

      try{ roleDoc = await fetchRoleDocByName(roleName); }catch{}
      const perms = roleDoc?.perms || roleDoc?.permissions || null;

      base = buildBaselineFromPerms(perms, indexes);
      overrides = person?.data?.overrides || {};
      allowed = computeAllowedSet(base, overrides);

      // Optional usability: always allow Home if present
      if(hrefToId.has('/Farm-vista/index.html')) allowed.add('home');

      writeCache(user.email, allowed);
    }

    // Apply to current drawer & observe re-renders
    observeDrawer(allowed, hrefToId);

    // Unmask now that rules are applied
    maskDrawer(false);

    // Re-apply on future auth changes (switch user)
    onAuthStateChanged(getAuth(), async (u)=>{
      if(!u || !u.email){
        maskDrawer(true);
        return;
      }
      const cached = readCache(u.email);
      if(cached){
        observeDrawer(cached, hrefToId);
        maskDrawer(false);
        return;
      }
      // No cache → recompute
      try{
        const person = await loadPersonRecord(u.email);
        const roleName = person?.data?.permissionGroup || 'Standard';
        const roleDoc = await fetchRoleDocByName(roleName);
        const perms = roleDoc?.perms || roleDoc?.permissions || null;
        const base = buildBaselineFromPerms(perms, indexes);
        const overrides = person?.data?.overrides || {};
        const allowed = computeAllowedSet(base, overrides);
        if(hrefToId.has('/Farm-vista/index.html')) allowed.add('home');
        writeCache(u.email, allowed);
        observeDrawer(allowed, hrefToId);
        maskDrawer(false);
      }catch{
        maskDrawer(true);
      }
    });

    // Expose for quick debug
    window.FV_PERMS_DEBUG = { email: user.email, allowed: Array.from(allowed) };
  }catch(err){
    console.error('[perm-filter] failed', err);
    // On any fatal error, keep masked (safer than exposing everything)
    maskDrawer(true);
  }
})();