/* /Farm-vista/js/app/user-context.js
   FarmVista — UserContext (Firestore-driven roles → allowedIds, cached)

   What this version does:
   - Uses absolute imports of /js/firebase-init.js and /js/menu.js (dynamic import).
   - Computes allowedIds from Firestore role + per-employee overrides.
   - Caches a compact context in localStorage so pages render instantly.
   - Exposes a GLOBAL API on window.FVUserContext (same API you have today).

   API:
     window.FVUserContext.get()        -> returns cached context or null
     window.FVUserContext.ready()      -> Promise<context> (builds cache if empty)
     window.FVUserContext.refresh({force}) -> Promise<context> (rebuilds)
     window.FVUserContext.onChange(fn) -> subscribe; returns off()
     window.FVUserContext.clear()      -> clear cache

   Context shape:
     {
       mode: 'firebase' | 'stub' | 'unknown',
       uid, email, displayName,
       profile: { ...employees/subcontractors/vendors doc... } | null,
       roleName: string,
       allowedIds: string[],       // menu "id" values allowed for this user
       updatedAt: ISOString
     }
*/

(function () {
  'use strict';

  /* ------------------------------ constants ------------------------------ */
  const LS_KEY     = 'fv:userctx:v1';
  const HOME_HREF  = '/Farm-vista/index.html';

  /* ------------------------------- helpers ------------------------------- */
  const emailKey = (e) => String(e || '').trim().toLowerCase();
  const nowIso   = () => new Date().toISOString();

  function lsGet(key){ try{ const s = localStorage.getItem(key); return s ? JSON.parse(s) : null; }catch{ return null; } }
  function lsSet(key,v){ try{ localStorage.setItem(key, JSON.stringify(v)); }catch{} }
  function lsDel(key){ try{ localStorage.removeItem(key); }catch{} }

  async function importFirebase(){ return await import('/Farm-vista/js/firebase-init.js'); }
  async function importMenu(){
    // Works whether /js/menu.js exports ESM or attaches window.FV_MENU
    try{
      const mod = await import('/Farm-vista/js/menu.js');
      return (mod && (mod.NAV_MENU || mod.default)) || null;
    }catch{
      // fallback: classic script loader
      await new Promise((res, rej)=>{
        const s = document.createElement('script');
        s.src = '/Farm-vista/js/menu.js?v=' + Date.now(); s.defer = true;
        s.onload = ()=> res(); s.onerror = (e)=> rej(e);
        document.head.appendChild(s);
      });
      return (window && window.FV_MENU) || null;
    }
  }

  /* ---------------------- NAV → indexes (ids + mapping) ---------------------- */
  function buildNavIndexes(NAV_MENU) {
    const CONTAINERS = new Map(); // containerId -> [leafIds]
    const CAP_TO_TOP = new Map(); // leafId -> top label (pretty name)
    const CAP_SET    = new Set(); // all leaf ids
    const HREF_TO_ID = new Map(); // href -> id

    function collectLinks(nodes, acc) {
      (nodes || []).forEach(n => {
        if (n.type === 'group' && Array.isArray(n.children)) {
          collectLinks(n.children, acc);
        } else if (n.type === 'link' && n.id) {
          acc.push(String(n.id));
          if (n.href) HREF_TO_ID.set(n.href, n.id);
        }
      });
    }

    (NAV_MENU?.items || []).forEach(top => {
      if (top.type !== 'group') return;
      const topLabel = top.label || top.id || 'General';

      const underTop = [];
      collectLinks([top], underTop);
      CONTAINERS.set(top.id, underTop.slice());

      (top.children || []).forEach(ch => {
        if (ch.type === 'group') {
          const arr = [];
          collectLinks([ch], arr);
          CONTAINERS.set(ch.id, arr.slice());
        }
      });

      underTop.forEach(id => { CAP_SET.add(id); CAP_TO_TOP.set(id, topLabel); });
    });

    return { CONTAINERS, CAP_TO_TOP, CAP_SET, HREF_TO_ID };
  }

  function valToBool(v){
    if (typeof v === 'boolean') return v;
    if (v && typeof v.on === 'boolean') return v.on;
    return undefined;
  }

  // From role permissions (containers + explicit leaves), produce baseline map
  function baselineFromPerms(perms, indexes){
    const { CONTAINERS, CAP_TO_TOP, CAP_SET } = indexes;
    const base = {};
    CAP_SET.forEach(id => {
      const group = CAP_TO_TOP.get(id) || 'General';
      if (!base[group]) base[group] = {};
      base[group][id] = false;
    });
    if (!perms || typeof perms !== 'object') return base;

    // 1) container-level (top/subgroup) defaults
    Object.keys(perms).forEach(key => {
      const b = valToBool(perms[key]); if (b === undefined) return;
      if (CONTAINERS.has(key)) {
        (CONTAINERS.get(key) || []).forEach(leaf => {
          const group = CAP_TO_TOP.get(leaf) || 'General';
          base[group][leaf] = !!b;
        });
      }
    });

    // 2) explicit leaf toggles
    Object.keys(perms).forEach(key => {
      const b = valToBool(perms[key]); if (b === undefined) return;
      if (indexes.CAP_SET.has(key)) {
        const group = indexes.CAP_TO_TOP.get(key) || 'General';
        base[group][key] = !!b;
      }
    });

    return base;
  }

  // Employee overrides are "Group.capId": true|false (leaf-level)
  function applyOverrides(base, overrides){
    const allowed = new Set();
    Object.keys(base).forEach(group => {
      Object.entries(base[group]).forEach(([leafId, on]) => { if (on) allowed.add(leafId); });
    });
    if (overrides && typeof overrides === 'object') {
      Object.entries(overrides).forEach(([path, v]) => {
        const parts = String(path).split('.');
        const capId = parts.length >= 2 ? parts.slice(1).join('.') : null;
        if (!capId) return;
        if (v === true) allowed.add(capId);
        if (v === false) allowed.delete(capId);
      });
    }
    return allowed;
  }

  /* ------------------------- Firestore helpers ------------------------- */
  async function fetchPersonRecord(mod, userEmail) {
    const db = mod.getFirestore();
    const id = emailKey(userEmail);
    const tries = ['employees', 'subcontractors', 'vendors'];
    for (const coll of tries) {
      try {
        const ref = mod.doc(db, coll, id);
        const snap = await mod.getDoc(ref);
        if (snap.exists()) return { coll, id, data: snap.data() || {} };
      } catch {}
    }
    return null;
  }

  async function fetchRoleDocByName(mod, roleName) {
    if (!roleName) return null;
    const db = mod.getFirestore();
    const q = mod.query(mod.collection(db, 'accountRoles'), mod.where('name', '==', roleName));
    const snap = await mod.getDocs(q);
    let data = null; snap.forEach(d => { data = d.data() || null; });
    return data;
  }

  /* ----------------------------- core state/cache ---------------------------- */
  let _ctx = lsGet(LS_KEY);       // may be null on very first app run
  let _listeners = new Set();
  let _inflight = null;

  function notify(){ _listeners.forEach(fn => { try{ fn(_ctx || null); }catch{} }); }
  function cacheSet(ctx){
    _ctx = ctx ? { ...ctx } : null;
    if (ctx) lsSet(LS_KEY, ctx); else lsDel(LS_KEY);
    notify();
  }

  /* ----------------------------- context builder ----------------------------- */
  async function buildContext(){
    let mod, NAV_MENU;
    try { [mod, NAV_MENU] = await Promise.all([importFirebase(), importMenu()]); }
    catch { /* fall through */ }

    if (!NAV_MENU || !Array.isArray(NAV_MENU.items)) NAV_MENU = { items: [] };
    const indexes = buildNavIndexes(NAV_MENU);

    if (!mod || !mod.ready) {
      return {
        mode: 'unknown',
        uid: null, email: null, displayName: null,
        profile: null, roleName: 'Standard',
        allowedIds: Array.from(indexes.CAP_SET),
        updatedAt: nowIso()
      };
    }

    const { mode } = await mod.ready.catch(() => ({ mode: 'unknown' }));
    const auth = (mod.getAuth && mod.getAuth()) || window.firebaseAuth || null;
    let user = auth && auth.currentUser ? auth.currentUser : null;

    // short hydration wait
    if (!user && mod.onAuthStateChanged && auth) {
      user = await new Promise(res => {
        let done = false;
        try {
          const off = mod.onAuthStateChanged(auth, u => { if (!done){ done=true; off&&off(); res(u||null); } });
          setTimeout(()=>{ if(!done){ done=true; res(auth.currentUser||null); } }, 1500);
        }catch{ res(null); }
      });
    }

    // Stub/missing user → permissive so app stays usable
    if (mode !== 'firebase' || !user || !user.email) {
      const all = Array.from(indexes.CAP_SET);
      if (indexes.HREF_TO_ID.has(HOME_HREF)) all.push(indexes.HREF_TO_ID.get(HOME_HREF));
      return {
        mode, uid: user?.uid || null, email: user?.email || null,
        displayName: user?.displayName || user?.email || null,
        profile: null, roleName: 'Standard',
        allowedIds: all, updatedAt: nowIso()
      };
    }

    // Firestore → person + role → allowedIds
    const person = await fetchPersonRecord(mod, user.email);
    const roleName = person?.data?.permissionGroup || 'Standard';
    const roleDoc  = await fetchRoleDocByName(mod, roleName);
    const perms    = roleDoc?.perms || roleDoc?.permissions || null;

    const base      = baselineFromPerms(perms, indexes);
    const overrides = person?.data?.overrides || {};
    const allowed   = applyOverrides(base, overrides);

    if (indexes.HREF_TO_ID.has(HOME_HREF)) allowed.add(indexes.HREF_TO_ID.get(HOME_HREF));

    let displayName = user.displayName || null;
    const emp = person?.data || {};
    if (!displayName) {
      const fn = String(emp.firstName || emp.first || '').trim();
      const ln = String(emp.lastName  || emp.last  || '').trim();
      const full = `${fn} ${ln}`.trim();
      if (full) displayName = full;
    }
    if (!displayName && user.email) displayName = user.email;

    return {
      mode: 'firebase',
      uid: user.uid || null,
      email: user.email || null,
      displayName,
      profile: emp ? { ...emp, type: person ? person.coll.slice(0, -1) : null } : null, // employee|subcontractor|vendor
      roleName,
      allowedIds: Array.from(allowed),
      updatedAt: nowIso()
    };
  }

  /* --------------------------------- API --------------------------------- */
  async function refresh({ force=false } = {}){
    if (_inflight && !force) return _inflight;
    _inflight = (async ()=>{
      const ctx = await buildContext();
      cacheSet(ctx);
      _inflight = null;
      return ctx;
    })();
    return _inflight;
  }

  function get(){ return _ctx || null; }
  async function ready(){ if (_ctx) return _ctx; return await refresh(); }

  function onChange(fn){ if (typeof fn==='function') _listeners.add(fn); return ()=> _listeners.delete(fn); }
  function clear(){ cacheSet(null); }

  // Expose global (same name you already use)
  window.FVUserContext = { get, ready, refresh, onChange, clear };

  // Seed immediately from cache (fast path)
  _ctx = lsGet(LS_KEY);

  // If no cache on first boot, build once in background
  if (!_ctx) { refresh().catch(()=>{}); }
})();