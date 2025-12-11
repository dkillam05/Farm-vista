/* /Farm-vista/js/app/user-context.js
   FarmVista — UserContext (Session Locker) with forgiving Firestore key mapping + debug

   What this version adds:
   - Session Locker: once hydrated, context sticks for the session (no mid-session null/empty).
   - Debounced auth watchers (onIdTokenChanged/onAuthStateChanged) to ignore transient "null" during refresh.
   - Last-Known-Good (LKG) reuse: on network/auth hiccups, we keep the prior context instead of emitting blanks.
   - No behavioral change to your permissive key-mapping logic and ACL computation.
   - NEW: exposes role/employee/perms/effectivePerms so the permission engine in theme-boot.js can use them.
*/

(function () {
  'use strict';

  const STORAGE_KEY = 'fv:userctx:v1'; // keep same to preserve existing cache
  const HOME_PATHS = [
    '/Farm-vista/index.html',
    '/Farm-vista/',
  ];

  // --- Session Locker knobs ---
  const AUTH_DEBOUNCE_MS = 450;        // suppress brief null→user flips during token refresh
  const BUILD_TIMEOUT_MS = 6000;       // give buildContext time before falling back to LKG
  const PERMISSIVE_WHEN_NO_LKG = true; // on cold start w/o auth & no cache, allow whole menu (your current behavior)

  /* ------------------------------- helpers ------------------------------- */
  const nowIso = () => new Date().toISOString();
  const lsGet = (k) => { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : null; } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const lsDel = (k) => { try { localStorage.removeItem(k); } catch {} };
  const emailKey = (e) => String(e || '').trim().toLowerCase();

  const wantDebug = (() => {
    try {
      if (new URL(location.href).searchParams.get('navdebug') === '1') return true;
      return (localStorage.getItem('fv:navdebug') === '1');
    } catch { return false; }
  })();

  function log(...args){ if (wantDebug) console.log('[FV:UserContext]', ...args); }
  const debug = log;

  async function importFirebase(){ return await import('/Farm-vista/js/firebase-init.js'); }
  async function importMenu(){ const m = await import('/Farm-vista/js/menu.js'); return (m && (m.NAV_MENU || m.default)) || null; }

  /* ---------------------- NAV indexing (ids + labels) --------------------- */
  function buildNavIndexes(NAV_MENU){
    const CONTAINERS = new Map();   // containerId -> [leafIds]
    const CAP_SET    = new Set();   // leaf ids
    const CAP_LABELS = new Map();   // simplified label -> leafId (first wins)
    const CONT_BY_ID = new Map();   // id -> true
    const CONT_BY_LABEL = new Map();// simplified label -> containerId
    const HREF_TO_ID = new Map();   // href -> leafId
    const ID_TO_LABEL = new Map();  // id -> label (for debug)

    const simplify = (s)=> String(s||'').toLowerCase().replace(/\s+/g,' ').trim();

    function collectLinks(nodes, acc){
      (nodes||[]).forEach(n=>{
        if(n.type==='group' && Array.isArray(n.children)){
          collectLinks(n.children, acc);
        } else if(n.type==='link' && n.id){
          acc.push(n);
        }
      });
    }

    (NAV_MENU?.items || []).forEach(top=>{
      if(top.type!=='group') return;
      const contId = top.id;
      const contLabel = simplify(top.label || top.id || '');
      CONT_BY_ID.set(contId, true);
      if(contLabel) CONT_BY_LABEL.set(contLabel, contId);

      const underTop = [];
      collectLinks([top], underTop);

      (top.children||[]).forEach(ch=>{
        if(ch.type==='group'){
          const sid = ch.id;
          const sl  = simplify(ch.label || ch.id || '');
          CONT_BY_ID.set(sid, true);
          if(sl) CONT_BY_LABEL.set(sl, sid);
          const underSub = []; collectLinks([ch], underSub);
          CONTAINERS.set(sid, underSub.map(x=>x.id));
        }
      });

      CONTAINERS.set(contId, underTop.map(x=>x.id));

      underTop.forEach(link=>{
        CAP_SET.add(link.id);
        ID_TO_LABEL.set(link.id, link.label || link.id);
        if (link.href) HREF_TO_ID.set(link.href, link.id);
        const labKey = simplify(link.label || '');
        if (labKey && !CAP_LABELS.has(labKey)) CAP_LABELS.set(labKey, link.id);
      });
    });

    let HOME_ID = null;
    for (const [href, id] of HREF_TO_ID.entries()){
      try { if (HOME_PATHS.some(p=> new URL(href, location.origin).pathname === p)) { HOME_ID = id; break; } } catch {}
    }
    if (!HOME_ID){
      const homeKey = 'home';
      if (CAP_LABELS.has(homeKey)) HOME_ID = CAP_LABELS.get(homeKey);
    }

    return { CONTAINERS, CAP_SET, CAP_LABELS, CONT_BY_ID, CONT_BY_LABEL, HREF_TO_ID, HOME_ID, ID_TO_LABEL };
  }

  /* ----------------------- key mapping (forgiving) ------------------------ */
  function normalize(s){ return String(s||'').trim(); }
  function simplifyKey(s){ return String(s||'').toLowerCase().replace(/[\s_/]+/g,'-').replace(/[^a-z0-9.-]+/g,'').replace(/-+/g,'-').trim(); }
  function simpleLabel(s){ return String(s||'').toLowerCase().replace(/\s+/g,' ').trim(); }

  function mapContainerKey(raw, idx){
    if (!raw) return null;
    const k = normalize(raw);
    if (idx.CONT_BY_ID.has(k)) return k;
    const sl = simpleLabel(k);
    if (idx.CONT_BY_LABEL.has(sl)) return idx.CONT_BY_LABEL.get(sl);
    const dashy = simplifyKey(k);
    if (idx.CONT_BY_ID.has(dashy)) return dashy;
    return null;
  }

  function mapLeafKey(raw, idx){
    if (!raw) return null;
    const id = normalize(raw);
    if (idx.CAP_SET.has(id)) return id;

    const byLabel = idx.CAP_LABELS.get(simpleLabel(id));
    if (byLabel) return byLabel;

    let best = null;
    for (const candidate of idx.CAP_SET){
      if (candidate === id) return candidate;
      if (candidate.endsWith(id) || candidate.includes(id)){
        if (!best || candidate.length > best.length) best = candidate;
      }
    }
    return best;
  }

  // UPDATED to understand new {view,add,edit,delete} permission objects
  function valToBool(v){
    if (typeof v === 'boolean') return v;
    if (v && typeof v.view === 'boolean') return v.view;
    if (v && typeof v.on === 'boolean') return v.on;
    return undefined;
  }

  function baselineFromPerms(perms, idx){
    const base = { all: {} };
    idx.CAP_SET.forEach(leaf=> { base.all[leaf] = false; });
    if (!perms || typeof perms !== 'object') return base;

    const unknownContainers = [];
    Object.keys(perms).forEach(key=>{
      const on = valToBool(perms[key]); if (on===undefined) return;
      const mapped = mapContainerKey(key, idx);
      if (mapped && idx.CONTAINERS.has(mapped)){
        (idx.CONTAINERS.get(mapped)||[]).forEach(leaf=>{ base.all[leaf] = on; });
      } else if (mapped === null && !idx.CAP_SET.has(key)) {
        unknownContainers.push(key);
      }
    });

    const unknownLeaves = [];
    Object.keys(perms).forEach(key=>{
      const on = valToBool(perms[key]); if (on===undefined) return;
      const leaf = mapLeafKey(key, idx);
      if (leaf) { base.all[leaf] = on; } else if (!idx.CONTAINERS.has(key)) {
        unknownLeaves.push(key);
      }
    });

    if (wantDebug && (unknownContainers.length || unknownLeaves.length)){
      debug('Unknown container keys from perms:', unknownContainers);
      debug('Unknown leaf keys from perms:', unknownLeaves);
    }
    return base;
  }

  function applyOverrides(base, overrides, idx){
    const allowed = new Set();
    Object.values(base).forEach(bucket=>{
      Object.entries(bucket).forEach(([leaf, on])=> { if (on) allowed.add(leaf); });
    });

    if (overrides && typeof overrides === 'object'){
      const unknownOverrideLeaves = [];
      Object.entries(overrides).forEach(([path, v])=>{
        const bits = String(path).split('.');
        const rawLeaf = bits.length >= 2 ? bits.slice(1).join('.') : bits[0];
        const leaf = mapLeafKey(rawLeaf, idx);
        if (!leaf){ unknownOverrideLeaves.push(path); return; }
        if (v === true) allowed.add(leaf);
        else if (v === false) allowed.delete(leaf);
      });
      if (wantDebug && unknownOverrideLeaves.length){
        debug('Unknown override keys (not matched to any menu id):', unknownOverrideLeaves);
      }
    }
    return allowed;
  }

  // NEW: merge role perms + employee overrides into a single effectivePerms map
  function mergePermsWithOverrides(perms, overrides){
    const result = {};
    if (perms && typeof perms === 'object'){
      Object.keys(perms).forEach(key=>{
        result[key] = perms[key];
      });
    }
    if (overrides && typeof overrides === 'object'){
      Object.keys(overrides).forEach(key=>{
        const v = overrides[key];
        if (typeof v === 'boolean' || (v && typeof v === 'object')){
          // overrides win
          result[key] = v;
        }
      });
    }
    return result;
  }

  /* ------------------------- Firestore data fetchers ------------------------- */
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
    const db = mod.getFirestore();
    const q = mod.query(mod.collection(db, 'accountRoles'), mod.where('name', '==', roleName));
    const snap = await mod.getDocs(q);
    let data = null; snap.forEach(d => { data = d.data() || null; });
    return data;
  }

  /* ----------------------------- core state/cache ---------------------------- */
  let _ctx = lsGet(STORAGE_KEY);     // Last-Known-Good snapshot (persisted)
  let _listeners = new Set();
  let _inflight = null;
  let _authUnsub = null;
  let _debounceTimer = null;

  function notify(){ _listeners.forEach(fn => { try { fn(_ctx || null); } catch {} }); }
  function cacheSet(ctx){
    // Session Locker: never emit null mid-session; only clear() can null it.
    _ctx = ctx ? { ...ctx } : null;
    if (ctx) lsSet(STORAGE_KEY, ctx); else lsDel(STORAGE_KEY);
    notify();
  }

  /* ----------------------------- context builder ----------------------------- */
  async function buildContextWithTimeout(){
    const timeout = new Promise((resolve)=> setTimeout(()=> resolve({ __timeout:true }), BUILD_TIMEOUT_MS));
    const built = await Promise.race([buildContext(), timeout]);
    return built;
  }

  async function buildContext(){
    let mod, NAV_MENU;
    try { [mod, NAV_MENU] = await Promise.all([importFirebase(), importMenu()]); }
    catch (e) { debug('import error', e); }

    if (!NAV_MENU || !Array.isArray(NAV_MENU.items)) NAV_MENU = { items: [] };
    const idx = buildNavIndexes(NAV_MENU);

    // If firebase module failed, return LKG or permissive (cold start)
    if (!mod || !mod.ready){
      if (_ctx) { debug('Using LKG (no firebase module)'); return { ..._ctx, updatedAt: nowIso() }; }
      if (PERMISSIVE_WHEN_NO_LKG){
        const ids = Array.from(idx.CAP_SET);
        if (idx.HOME_ID) ids.unshift(idx.HOME_ID);
        return {
          mode:'unknown',
          uid:null,
          email:null,
          displayName:null,
          profile:null,
          roleName:'Standard',
          role: null,
          employee: null,
          perms:{},
          effectivePerms:{},
          allowedIds:ids,
          updatedAt:nowIso()
        };
      }
      return null; // rare: login page context
    }

    const { mode } = await mod.ready.catch(()=>({mode:'unknown'}));
    const auth = (mod.getAuth && mod.getAuth()) || window.firebaseAuth || null;
    const liveUser = auth && auth.currentUser ? auth.currentUser : null;

    // If we truly have no user:
    if (mode !== 'firebase' || !liveUser || !liveUser.email){
      if (_ctx) {
        debug('No live user; reusing LKG session context');
        return { ..._ctx, updatedAt: nowIso() };
      }
      if (PERMISSIVE_WHEN_NO_LKG){
        const ids = Array.from(idx.CAP_SET);
        if (idx.HOME_ID) ids.unshift(idx.HOME_ID);
        return {
          mode,
          uid:liveUser?.uid||null,
          email:liveUser?.email||null,
          displayName:liveUser?.displayName||liveUser?.email||null,
          profile:null,
          roleName:'Standard',
          role:null,
          employee:null,
          perms:{},
          effectivePerms:{},
          allowedIds:ids,
          updatedAt:nowIso()
        };
      }
      return null;
    }

    // Firestore: build from person + role
    const person = await fetchPersonRecord(mod, liveUser.email);
    const emp = person?.data || {};
    const roleName = emp.permissionGroup || 'Standard';
    const roleDoc  = await fetchRoleDocByName(mod, roleName);

    // Raw perms as stored on the role doc
    const perms    = roleDoc?.perms || roleDoc?.permissions || null;

    // Nav ACL (existing behavior)
    const base    = baselineFromPerms(perms, idx);
    const allow   = applyOverrides(base, emp.overrides || {}, idx);

    if (idx.HOME_ID) allow.add(idx.HOME_ID);

    // NEW: merge into effectivePerms (role perms + employee overrides on same keys)
    const effectivePerms = mergePermsWithOverrides(perms || {}, emp.overrides || {});

    let displayName = liveUser.displayName || '';
    if (!displayName){
      const fn = String(emp.firstName || emp.first || '').trim();
      const ln = String(emp.lastName  || emp.last  || '').trim();
      const full = `${fn} ${ln}`.trim();
      displayName = full || liveUser.email;
    }

    const roleOut = roleDoc
      ? { ...roleDoc, name: roleName }
      : { name: roleName, perms: perms || {} };

    const employeeOut = emp
      ? { ...emp, id: person ? person.id : null, coll: person ? person.coll : null }
      : null;

    const out = {
      mode:'firebase',
      uid:liveUser.uid||null,
      email:liveUser.email||null,
      displayName,
      profile: emp ? { ...emp, type: person ? person.coll.slice(0,-1) : null } : null,
      roleName,
      role: roleOut,
      employee: employeeOut,
      perms: perms || {},
      effectivePerms,
      allowedIds: Array.from(allow),
      updatedAt: nowIso()
    };

    if (wantDebug){
      debug('CTX DEBUG → role:', roleName);
      debug('Allowed IDs:', out.allowedIds);
      debug('Home id:', idx.HOME_ID);
      const rawPermKeys = perms ? Object.keys(perms) : [];
      const unknownPerms = rawPermKeys.filter(k=>{
        const c = mapContainerKey(k, idx); if (c) return false;
        const l = mapLeafKey(k, idx);      if (l) return false;
        return true;
      });
      if (unknownPerms.length) debug('Unmapped role keys:', unknownPerms);
    }

    return out;
  }

  /* --------------------------------- API --------------------------------- */
  async function refresh({ force=false } = {}){
    if (_inflight && !force) return _inflight;
    _inflight = (async ()=>{
      let ctx = null;
      try {
        ctx = await buildContextWithTimeout();
        if (ctx && !ctx.__timeout) {
          cacheSet(ctx);
          _inflight = null;
          return ctx;
        }
      } catch (e) {
        debug('refresh build error; using LKG', e);
      }
      if (_ctx) { _inflight = null; return _ctx; }
      const m = await importMenu().catch(()=>null);
      const idx = buildNavIndexes(m||{items:[]});
      if (PERMISSIVE_WHEN_NO_LKG){
        const ids = Array.from(idx.CAP_SET);
        if (idx.HOME_ID) ids.unshift(idx.HOME_ID);
        const cold = {
          mode:'unknown',
          uid:null,
          email:null,
          displayName:null,
          profile:null,
          roleName:'Standard',
          role:null,
          employee:null,
          perms:{},
          effectivePerms:{},
          allowedIds:ids,
          updatedAt:nowIso()
        };
        cacheSet(cold);
        _inflight = null;
        return cold;
      }
      _inflight = null;
      return null;
    })();
    return _inflight;
  }

  function get(){ return _ctx; }
  async function ready(){ if (_ctx) return _ctx; return await refresh(); }
  function onChange(fn){ if (typeof fn==='function') _listeners.add(fn); return ()=>_listeners.delete(fn); }
  function clear(){
    if (_authUnsub) { try { _authUnsub(); } catch {} _authUnsub = null; }
    cacheSet(null);
  }

  window.FVUserContext = { get, ready, refresh, onChange, clear };

  /* ------------------------------- auth watch ------------------------------- */
  (async function ensureAuthWatcher(){
    try{
      const mod = await importFirebase().catch(()=>null);
      if (!mod) return;
      const auth = (mod.getAuth && mod.getAuth()) || window.firebaseAuth || null;
      if (!auth) return;

      const watchFn = (mod.onIdTokenChanged || mod.onAuthStateChanged);
      if (!watchFn) return;

      if (_authUnsub) return;

      _authUnsub = watchFn(auth, async (_userOrNull)=>{
        clearTimeout(_debounceTimer);
        _debounceTimer = setTimeout(async ()=>{
          await refresh({ force:true }).catch(()=>{});
        }, AUTH_DEBOUNCE_MS);
      });
    } catch (e) {
      debug('ensureAuthWatcher error', e);
    }
  })();

  _ctx = lsGet(STORAGE_KEY);
  if (!_ctx) { refresh().catch(()=>{}); } else { notify(); }
})();
