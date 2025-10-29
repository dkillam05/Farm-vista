/* /Farm-vista/js/app/user-context.js
   FarmVista — UserContext cache (roles + overrides → allowedIds)
   v1.2.1 — Always includes Home; safe fallback if role resolves empty.
*/

(function () {
  'use strict';

  const STORAGE_KEY = 'fv:userctx:v1';

  const emailKey = (e) => String(e || '').trim().toLowerCase();
  const nowIso   = () => new Date().toISOString();

  function lsGet(k){ try{ const s = localStorage.getItem(k); return s ? JSON.parse(s) : null; }catch{return null;} }
  function lsSet(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} }
  function lsDel(k){   try{ localStorage.removeItem(k); }catch{} }

  async function importFirebase(){ return await import('/Farm-vista/js/firebase-init.js'); }
  async function importMenu(){ const mod = await import('/Farm-vista/js/menu.js'); return (mod && (mod.NAV_MENU || mod.default)) || null; }

  function buildNavIndexes(NAV_MENU) {
    const CONTAINERS = new Map(); // containerId -> [leafIds]
    const CAP_TO_TOP = new Map(); // leafId -> top label
    const CAP_SET    = new Set(); // all leaf ids
    const HREF_TO_ID = new Map(); // href -> id
    let HOME_ID = null;

    function collectLinks(nodes, acc) {
      (nodes || []).forEach(n => {
        if (n.type === 'group' && Array.isArray(n.children)) {
          collectLinks(n.children, acc);
        } else if (n.type === 'link' && n.id) {
          acc.push(n.id);
          if (n.href) {
            const path = new URL(n.href, location.origin).pathname;
            HREF_TO_ID.set(path, n.id);
            // common home href patterns
            if (!HOME_ID && (
                /\/Farm-vista\/index\.html$/.test(path) ||
                /\/Farm-vista\/dashboard\/?$/.test(path) ||
                /\/Farm-vista\/dashboard\/index\.html$/.test(path)
              )) {
              HOME_ID = n.id;
            }
          }
          if (!HOME_ID && (n.id === 'home' || /home/i.test(n.id))) HOME_ID = n.id;
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

    return { CONTAINERS, CAP_TO_TOP, CAP_SET, HREF_TO_ID, HOME_ID };
  }

  function valToBool(v){ if(typeof v==='boolean') return v; if(v && typeof v.on==='boolean') return v.on; return undefined; }

  function baselineFromPerms(perms, indexes){
    const { CONTAINERS, CAP_TO_TOP, CAP_SET } = indexes;
    const base = {};
    CAP_SET.forEach(id => {
      const top = CAP_TO_TOP.get(id); if (!top) return;
      if (!base[top]) base[top] = {};
      base[top][id] = false;
    });
    if (!perms || typeof perms !== 'object') return base;

    Object.keys(perms).forEach(key => {
      const on = valToBool(perms[key]); if (on === undefined) return;
      if (CONTAINERS.has(key)) (CONTAINERS.get(key)||[]).forEach(leaf => {
        const top = CAP_TO_TOP.get(leaf); if (!top) return;
        base[top][leaf] = on;
      });
    });

    Object.keys(perms).forEach(key => {
      const on = valToBool(perms[key]); if (on === undefined) return;
      if (indexes.CAP_SET.has(key)) {
        const top = indexes.CAP_TO_TOP.get(key); if (!top) return;
        base[top][key] = on;
      }
    });
    return base;
  }

  function applyOverrides(base, overrides){
    const allowed = new Set();
    Object.keys(base).forEach(group => {
      Object.entries(base[group]).forEach(([capId, on]) => { if (on) allowed.add(capId); });
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

  async function fetchPersonRecord(mod, userEmail){
    const db = mod.getFirestore();
    const id = emailKey(userEmail);
    const tries = ['employees','subcontractors','vendors'];
    for (const coll of tries) {
      try {
        const ref = mod.doc(db, coll, id);
        const snap = await mod.getDoc(ref);
        if (snap.exists()) return { coll, id, data: snap.data() || {} };
      } catch {}
    }
    return null;
  }

  async function fetchRoleDocByName(mod, roleName){
    const db = mod.getFirestore();
    const q = mod.query(mod.collection(db, 'accountRoles'), mod.where('name','==',roleName));
    const snap = await mod.getDocs(q);
    let data = null; snap.forEach(d=>{ data = d.data()||null; });
    return data;
  }

  let _ctx = lsGet(STORAGE_KEY);
  let _listeners = new Set();
  let _inflight = null;

  function notify(){ _listeners.forEach(fn=>{ try{ fn(_ctx||null); }catch{} }); }
  function cacheSet(c){ _ctx = c ? {...c} : null; if (c) lsSet(STORAGE_KEY,c); else lsDel(STORAGE_KEY); notify(); }

  async function buildContext(){
    let mod, NAV_MENU;
    try { [mod, NAV_MENU] = await Promise.all([importFirebase(), importMenu()]); } catch {}

    if (!NAV_MENU || !Array.isArray(NAV_MENU.items)) NAV_MENU = { items: [] };
    const indexes = buildNavIndexes(NAV_MENU);

    if (!mod || !mod.ready) {
      // No Firebase → permissive fallback, but still guarantee Home if present
      const ids = Array.from(indexes.CAP_SET);
      if (indexes.HOME_ID && !ids.includes(indexes.HOME_ID)) ids.unshift(indexes.HOME_ID);
      return {
        mode:'unknown', uid:null, email:null, displayName:null,
        profile:null, roleName:'Standard', allowedIds: ids, updatedAt: nowIso()
      };
    }

    const { mode } = await mod.ready.catch(()=>({mode:'unknown'}));
    const auth = (mod.getAuth && mod.getAuth()) || window.firebaseAuth || null;
    let user = auth && auth.currentUser ? auth.currentUser : null;

    if (!user && mod.onAuthStateChanged && auth) {
      user = await new Promise(res=>{
        let done=false;
        try{
          const off = mod.onAuthStateChanged(auth, u=>{ if(!done){ done=true; off&&off(); res(u||null);} });
          setTimeout(()=>{ if(!done){ done=true; res(auth.currentUser||null);} }, 1500);
        }catch{ res(null); }
      });
    }

    // Stub or missing user → allow Home at minimum
    if (mode !== 'firebase' || !user || !user.email) {
      const ids = Array.from(indexes.CAP_SET);
      if (indexes.HOME_ID && !ids.includes(indexes.HOME_ID)) ids.unshift(indexes.HOME_ID);
      return {
        mode, uid:user?.uid||null, email:user?.email||null,
        displayName: user?.displayName || user?.email || null,
        profile:null, roleName:'Standard', allowedIds: ids, updatedAt: nowIso()
      };
    }

    // Firestore person + role
    const person   = await fetchPersonRecord(mod, user.email);
    const roleName = person?.data?.permissionGroup || 'Standard';
    const roleDoc  = await fetchRoleDocByName(mod, roleName);
    const perms    = roleDoc?.perms || roleDoc?.permissions || null;

    const base      = baselineFromPerms(perms, indexes);
    const overrides = person?.data?.overrides || {};
    const allowed   = applyOverrides(base, overrides);

    // Always allow Home for usability
    if (indexes.HOME_ID) allowed.add(indexes.HOME_ID);

    // If role resolved to NOTHING (buggy/empty), still show Home so app isn’t blank
    if (allowed.size === 0 && indexes.HOME_ID) allowed.add(indexes.HOME_ID);

    // Display name
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
      mode:'firebase',
      uid:user.uid||null, email:user.email||null, displayName,
      profile: emp ? { ...emp, type: person ? person.coll.slice(0,-1) : null } : null,
      roleName, allowedIds:Array.from(allowed), updatedAt: nowIso()
    };
  }

  async function refresh({ force=false } = {}){
    if (_inflight && !force) return _inflight;
    _inflight = (async ()=>{ const c = await buildContext(); cacheSet(c); _inflight=null; return c; })();
    return _inflight;
  }
  function get(){ return _ctx; }
  async function ready(){ if (_ctx) return _ctx; return await refresh(); }
  function onChange(fn){ if (typeof fn==='function') _listeners.add(fn); return ()=>_listeners.delete(fn); }
  function clear(){ cacheSet(null); }

  window.FVUserContext = { get, ready, refresh, onChange, clear };

  _ctx = lsGet(STORAGE_KEY);
  if (!_ctx) { refresh().catch(()=>{}); }
})();