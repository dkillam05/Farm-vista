/* /Farm-vista/js/app/user-context.js
   FarmVista — UserContext with forgiving Firestore key mapping + debug

   What changed vs your previous file:
   - Robust mapping from Firestore keys → actual menu ids (by id OR label, case-insensitive).
   - Smart fallback for leaf ids: exact → endsWith → contains (longest match wins).
   - Always-add Home.
   - Optional debug: add ?navdebug=1 or localStorage 'fv:navdebug' = '1' to log mapping details.
*/

(function () {
  'use strict';

  const STORAGE_KEY = 'fv:userctx:v1';
  const HOME_PATHS = [
    '/Farm-vista/index.html',
    '/Farm-vista/',                 // just in case
  ];

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

  async function importFirebase(){ return await import('/Farm-vista/js/firebase-init.js'); }
  async function importMenu(){ const m = await import('/Farm-vista/js/menu.js'); return (m && (m.NAV_MENU || m.default)) || null; }

  /* ---------------------- NAV indexing (ids + labels) --------------------- */
  function buildNavIndexes(NAV_MENU){
    const CONTAINERS = new Map();   // containerId -> [leafIds]
    const CAP_SET    = new Set();   // leaf ids
    const CAP_LABELS = new Map();   // simplified label -> leafId (first wins)
    const CONT_BY_ID = new Map();   // id -> true
    const CONT_BY_LABEL = new Map(); // simplified label -> containerId
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

      // gather under top (including subgroups)
      const underTop = [];
      collectLinks([top], underTop);

      // add subgroup containers too
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

    // try to detect a “Home” id from hrefs or label
    let HOME_ID = null;
    for (const [href, id] of HREF_TO_ID.entries()){
      if (HOME_PATHS.some(p=> new URL(href, location.origin).pathname === p)) { HOME_ID = id; break; }
    }
    if (!HOME_ID){
      // fallback by label
      const homeKey = 'home';
      if (CAP_LABELS.has(homeKey)) HOME_ID = CAP_LABELS.get(homeKey);
    }

    return { CONTAINERS, CAP_SET, CAP_LABELS, CONT_BY_ID, CONT_BY_LABEL, HREF_TO_ID, HOME_ID, ID_TO_LABEL };
  }

  /* ----------------------- key mapping (forgiving) ------------------------ */
  function normalize(s){ return String(s||'').trim(); }
  function simplify(s){ return String(s||'').toLowerCase().replace(/[\s_/]+/g,'-').replace(/[^a-z0-9.-]+/g,'').replace(/-+/g,'-').trim(); }
  function simpleLabel(s){ return String(s||'').toLowerCase().replace(/\s+/g,' ').trim(); }

  function mapContainerKey(raw, idx){
    if (!raw) return null;
    const k = normalize(raw);
    if (idx.CONT_BY_ID.has(k)) return k;                 // exact id
    const sl = simpleLabel(k);                           // try label
    if (idx.CONT_BY_LABEL.has(sl)) return idx.CONT_BY_LABEL.get(sl);
    // loose: replace spaces/underscores with dashes
    const dashy = simplify(k);
    if (idx.CONT_BY_ID.has(dashy)) return dashy;
    // no match
    return null;
  }

  function mapLeafKey(raw, idx){
    if (!raw) return null;
    const id = normalize(raw);
    if (idx.CAP_SET.has(id)) return id;                  // exact id

    // try by label: if caller accidentally stored a label instead of id
    const byLabel = idx.CAP_LABELS.get(simpleLabel(id));
    if (byLabel) return byLabel;

    // relaxed: endsWith or contains (pick the longest candidate)
    let best = null;
    for (const candidate of idx.CAP_SET){
      if (candidate === id) return candidate;
      if (candidate.endsWith(id) || candidate.includes(id)){
        if (!best || candidate.length > best.length) best = candidate;
      }
    }
    return best; // may be null
  }

  function valToBool(v){
    if (typeof v === 'boolean') return v;
    if (v && typeof v.on === 'boolean') return v.on;
    return undefined;
  }

  function baselineFromPerms(perms, idx){
    const base = {}; // {topLabelLike:{leafId:boolean}} — we’ll group by “top label” string we synthesize
    // seed all false
    idx.CAP_SET.forEach(leaf=>{
      const topKey = 'all';                // we don’t actually need the label to compute allowed set
      if(!base[topKey]) base[topKey] = {};
      base[topKey][leaf] = false;
    });
    if (!perms || typeof perms !== 'object') return base;

    // container-level defaults
    const unknownContainers = [];
    Object.keys(perms).forEach(key=>{
      const on = valToBool(perms[key]); if (on===undefined) return;
      const mapped = mapContainerKey(key, idx);
      if (mapped && idx.CONTAINERS.has(mapped)){
        (idx.CONTAINERS.get(mapped)||[]).forEach(leaf=>{
          base.all[leaf] = on;
        });
      } else if (mapped === null && !idx.CAP_SET.has(key)) {
        unknownContainers.push(key);
      }
    });

    // explicit leaf ids
    const unknownLeaves = [];
    Object.keys(perms).forEach(key=>{
      const on = valToBool(perms[key]); if (on===undefined) return;
      const leaf = mapLeafKey(key, idx);
      if (leaf) { base.all[leaf] = on; } else if (!idx.CONTAINERS.has(key)) {
        unknownLeaves.push(key);
      }
    });

    if (wantDebug && (unknownContainers.length || unknownLeaves.length)){
      log('Unknown container keys from perms:', unknownContainers);
      log('Unknown leaf keys from perms:', unknownLeaves);
    }
    return base;
  }

  function applyOverrides(base, overrides, idx){
    const allowed = new Set();
    // baseline allow
    Object.values(base).forEach(bucket=>{
      Object.entries(bucket).forEach(([leaf, on])=> { if (on) allowed.add(leaf); });
    });

    if (overrides && typeof overrides === 'object'){
      const unknownOverrideLeaves = [];
      Object.entries(overrides).forEach(([path, v])=>{
        // path form: "Group.capId" OR just "capId"
        const bits = String(path).split('.');
        const rawLeaf = bits.length >= 2 ? bits.slice(1).join('.') : bits[0];
        const leaf = mapLeafKey(rawLeaf, idx);
        if (!leaf){ unknownOverrideLeaves.push(path); return; }
        if (v === true) allowed.add(leaf);
        else if (v === false) allowed.delete(leaf);
      });
      if (wantDebug && unknownOverrideLeaves.length){
        log('Unknown override keys (not matched to any menu id):', unknownOverrideLeaves);
      }
    }
    return allowed;
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
  let _ctx = lsGet(STORAGE_KEY);
  let _listeners = new Set();
  let _inflight = null;

  function notify(){ _listeners.forEach(fn => { try { fn(_ctx || null); } catch {} }); }
  function cacheSet(ctx){ _ctx = ctx ? { ...ctx } : null; if (ctx) lsSet(STORAGE_KEY, ctx); else lsDel(STORAGE_KEY); notify(); }

  /* ----------------------------- context builder ----------------------------- */
  async function buildContext(){
    let mod, NAV_MENU;
    try { [mod, NAV_MENU] = await Promise.all([importFirebase(), importMenu()]); }
    catch (e) { log('import error', e); }

    if (!NAV_MENU || !Array.isArray(NAV_MENU.items)) NAV_MENU = { items: [] };
    const idx = buildNavIndexes(NAV_MENU);

    // No firebase → permissive fallback (keeps UI usable)
    if (!mod || !mod.ready){
      const ids = Array.from(idx.CAP_SET);
      if (idx.HOME_ID) ids.unshift(idx.HOME_ID);
      return { mode:'unknown', uid:null, email:null, displayName:null, profile:null, roleName:'Standard', allowedIds:ids, updatedAt:nowIso() };
    }

    const { mode } = await mod.ready.catch(()=>({mode:'unknown'}));
    const auth = (mod.getAuth && mod.getAuth()) || window.firebaseAuth || null;
    let user = auth && auth.currentUser ? auth.currentUser : null;

    if (!user && mod.onAuthStateChanged && auth){
      user = await new Promise(res=>{
        let done=false;
        try{
          const off = mod.onAuthStateChanged(auth, u=>{ if(!done){ done=true; off&&off(); res(u||null); }});
          setTimeout(()=>{ if(!done){ done=true; res(auth.currentUser||null); }}, 1500);
        }catch{ res(null); }
      });
    }

    // stub or no user → permissive
    if (mode !== 'firebase' || !user || !user.email){
      const ids = Array.from(idx.CAP_SET);
      if (idx.HOME_ID) ids.unshift(idx.HOME_ID);
      return { mode, uid:user?.uid||null, email:user?.email||null, displayName:user?.displayName||user?.email||null, profile:null, roleName:'Standard', allowedIds:ids, updatedAt:nowIso() };
    }

    // Firestore: person + role
    const person = await fetchPersonRecord(mod, user.email);
    const emp = person?.data || {};
    const roleName = emp.permissionGroup || 'Standard';
    const roleDoc  = await fetchRoleDocByName(mod, roleName);
    const perms    = roleDoc?.perms || roleDoc?.permissions || null;

    const base    = baselineFromPerms(perms, idx);
    const allow   = applyOverrides(base, emp.overrides || {}, idx);

    // Always allow Home
    if (idx.HOME_ID) allow.add(idx.HOME_ID);

    let displayName = user.displayName || '';
    if (!displayName){
      const fn = String(emp.firstName || emp.first || '').trim();
      const ln = String(emp.lastName  || emp.last  || '').trim();
      const full = `${fn} ${ln}`.trim();
      displayName = full || user.email;
    }

    const out = {
      mode:'firebase',
      uid:user.uid||null,
      email:user.email||null,
      displayName,
      profile: emp ? { ...emp, type: person ? person.coll.slice(0,-1) : null } : null,
      roleName,
      allowedIds: Array.from(allow),
      updatedAt: nowIso()
    };

    if (wantDebug){
      log('CTX DEBUG → role:', roleName);
      log('Allowed IDs:', out.allowedIds);
      log('Home id:', idx.HOME_ID);
      // highlight any stored keys that didn’t map
      const rawPermKeys = perms ? Object.keys(perms) : [];
      const unknownPerms = rawPermKeys.filter(k=>{
        const c = mapContainerKey(k, idx); if (c) return false;
        const l = mapLeafKey(k, idx);      if (l) return false;
        return true;
      });
      if (unknownPerms.length) log('Unmapped role keys:', unknownPerms);
    }

    return out;
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

  function get(){ return _ctx; }
  async function ready(){ if (_ctx) return _ctx; return await refresh(); }
  function onChange(fn){ if (typeof fn==='function') _listeners.add(fn); return ()=>_listeners.delete(fn); }
  function clear(){ cacheSet(null); }

  window.FVUserContext = { get, ready, refresh, onChange, clear };

  // seed & lazy build
  _ctx = lsGet(STORAGE_KEY);
  if (!_ctx) { refresh().catch(()=>{}); }
})();