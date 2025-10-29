/* /Farm-vista/js/app/user-context.js
   FarmVista — UserContext (simple, fast cache for user + permissions)

   What it does (plain English):
   - On first run after login, it pulls the current user + role + overrides from Firestore,
     computes which menu items are allowed, and saves that bundle in localStorage.
   - Every page can read this cached bundle instantly (no waiting) to render the right UI.
   - You can force a refresh any time (e.g., after changing roles) and it will update the cache.
   - Works in "stub" mode too (it will just allow everything so the app stays usable).

   How to use from any page:
     // 1) Include this file (once, before your page scripts):
     // <script src="/Farm-vista/js/app/user-context.js"></script>

     // 2) Read quickly (sync) — may be null on the very first app launch:
     const ctx = window.FVUserContext.get();

     // 3) Guaranteed context (Promise): resolves using cache, refreshes if empty
     window.FVUserContext.ready().then(ctx => {
       // ctx.allowedIds → array of menu "id" strings this user is allowed to see
       // ctx.displayName → nice name for header/logout
     });

     // 4) Force a re-build from Firestore/Auth later (e.g., after admin edits)
     await window.FVUserContext.refresh({ force: true });

     // 5) Listen for changes (like a tiny event bus)
     const off = window.FVUserContext.onChange(ctx => { /* re-render if you want */ });
     // off() to unsubscribe

   Shape of the cached context:
     {
       mode: 'firebase' | 'stub' | 'unknown',
       uid, email, displayName,
       profile: { ...personDoc },        // employees/subcontractors/vendors fields (if found)
       roleName: 'Standard' | string,
       allowedIds: [ 'home', 'crop.planting', ... ],
       updatedAt: ISOString
     }
*/

(function () {
  'use strict';

  /* ------------------------------ constants ------------------------------ */
  const STORAGE_KEY = 'fv:userctx:v1';
  const HOME_HREF   = '/Farm-vista/index.html';

  /* ------------------------------- helpers ------------------------------- */
  const emailKey = (e) => String(e || '').trim().toLowerCase();
  const nowIso   = () => new Date().toISOString();

  function lsGet(key) {
    try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : null; }
    catch { return null; }
  }
  function lsSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }
  function lsDel(key) { try { localStorage.removeItem(key); } catch {} }

  async function importFirebase() {
    // Absolute path (same everywhere in your app)
    return await import('/Farm-vista/js/firebase-init.js');
  }
  async function importMenu() {
    const mod = await import('/Farm-vista/js/menu.js');
    return (mod && (mod.NAV_MENU || mod.default)) || null;
  }

  /* ---------------------- NAV → indexes (ids + mapping) ---------------------- */
  function buildNavIndexes(NAV_MENU) {
    const CONTAINERS = new Map(); // containerId (top or subgroup) -> [leafIds]
    const CAP_TO_TOP = new Map(); // leafId -> top label (pretty name)
    const CAP_SET    = new Set(); // all leaf ids
    const HREF_TO_ID = new Map(); // href -> id

    function collectLinks(nodes, acc) {
      (nodes || []).forEach(n => {
        if (n.type === 'group' && Array.isArray(n.children)) {
          collectLinks(n.children, acc);
        } else if (n.type === 'link' && n.id) {
          acc.push(n.id);
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

      // sub-groups
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

  function valToBool(v) {
    if (typeof v === 'boolean') return v;
    if (v && typeof v.on === 'boolean') return v.on;
    return undefined;
  }

  function baselineFromPerms(perms, indexes) {
    const { CONTAINERS, CAP_TO_TOP, CAP_SET } = indexes;
    // Start all false
    const base = {};
    CAP_SET.forEach(id => {
      const top = CAP_TO_TOP.get(id); if (!top) return;
      if (!base[top]) base[top] = {};
      base[top][id] = false;
    });
    if (!perms || typeof perms !== 'object') return base;

    // Container-level defaults (top/subgroup ids)
    Object.keys(perms).forEach(key => {
      const on = valToBool(perms[key]); if (on === undefined) return;
      if (CONTAINERS.has(key)) {
        (CONTAINERS.get(key) || []).forEach(leaf => {
          const top = CAP_TO_TOP.get(leaf); if (!top) return;
          base[top][leaf] = on;
        });
      }
    });

    // Explicit leaf overrides (cap ids)
    Object.keys(perms).forEach(key => {
      const on = valToBool(perms[key]); if (on === undefined) return;
      if (indexes.CAP_SET.has(key)) {
        const top = indexes.CAP_TO_TOP.get(key); if (!top) return;
        base[top][key] = on;
      }
    });

    return base;
  }

  function applyOverrides(base, overrides) {
    const allowed = new Set();
    // seed from baseline
    Object.keys(base).forEach(group => {
      Object.entries(base[group]).forEach(([capId, on]) => { if (on) allowed.add(capId); });
    });
    // record overrides "Group.capId": true|false
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
  let _ctx = lsGet(STORAGE_KEY);  // may be null on very first app run
  let _listeners = new Set();
  let _inflight = null;

  function notify() {
    _listeners.forEach(fn => { try { fn(_ctx || null); } catch {} });
  }
  function cacheSet(ctx) {
    _ctx = ctx ? { ...ctx } : null;
    if (ctx) lsSet(STORAGE_KEY, ctx); else lsDel(STORAGE_KEY);
    notify();
  }

  /* ----------------------------- context builder ----------------------------- */
  async function buildContext() {
    // Load deps
    let mod, NAV_MENU;
    try { [mod, NAV_MENU] = await Promise.all([importFirebase(), importMenu()]); }
    catch { /* best effort */ }

    if (!NAV_MENU || !Array.isArray(NAV_MENU.items)) NAV_MENU = { items: [] };
    const indexes = buildNavIndexes(NAV_MENU);

    if (!mod || !mod.ready) {
      // No firebase module → permissive fallback
      return {
        mode: 'unknown',
        uid: null, email: null, displayName: null,
        profile: null,
        roleName: 'Standard',
        allowedIds: Array.from(indexes.CAP_SET),
        updatedAt: nowIso()
      };
    }

    const { mode } = await mod.ready.catch(() => ({ mode: 'unknown' }));
    const auth = (mod.getAuth && mod.getAuth()) || (window.firebaseAuth) || null;
    let user = auth && auth.currentUser ? auth.currentUser : null;

    // If not hydrated yet, wait briefly
    if (!user && mod.onAuthStateChanged && auth) {
      user = await new Promise(res => {
        let done = false;
        try {
          const off = mod.onAuthStateChanged(auth, u => { if (!done) { done = true; off && off(); res(u || null); } });
          setTimeout(() => { if (!done) { done = true; res(auth.currentUser || null); } }, 1500);
        } catch { res(null); }
      });
    }

    // Stub or missing user → allow everything (keeps UI usable/offline)
    if (mode !== 'firebase' || !user || !user.email) {
      const ids = Array.from(indexes.CAP_SET);
      // Always allow Home if present
      if (indexes.HREF_TO_ID.has(HOME_HREF)) ids.push(indexes.HREF_TO_ID.get(HOME_HREF));
      return {
        mode, uid: user?.uid || null, email: user?.email || null,
        displayName: user?.displayName || user?.email || null,
        profile: null,
        roleName: 'Standard',
        allowedIds: ids,
        updatedAt: nowIso()
      };
    }

    // Firestore path: person + role + effective allowed
    const person = await fetchPersonRecord(mod, user.email);
    const roleName = person?.data?.permissionGroup || 'Standard';
    const roleDoc  = await fetchRoleDocByName(mod, roleName);
    const perms    = roleDoc?.perms || roleDoc?.permissions || null;

    const base      = baselineFromPerms(perms, indexes);
    const overrides = person?.data?.overrides || {};
    const allowed   = applyOverrides(base, overrides);

    // Always allow Home for usability
    if (indexes.HREF_TO_ID.has(HOME_HREF)) allowed.add(indexes.HREF_TO_ID.get(HOME_HREF));

    // Nice display name
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
  async function refresh({ force = false } = {}) {
    if (_inflight && !force) return _inflight;
    _inflight = (async () => {
      const ctx = await buildContext();
      cacheSet(ctx);
      _inflight = null;
      return ctx;
    })();
    return _inflight;
  }

  function get() {
    // Fast, synchronous (returns the cached value; may be null on very first run)
    return _ctx;
  }

  async function ready() {
    // Returns cached value if present, otherwise builds it once
    if (_ctx) return _ctx;
    return await refresh();
  }

  function onChange(fn) {
    if (typeof fn === 'function') { _listeners.add(fn); }
    return () => _listeners.delete(fn);
  }

  function clear() {
    cacheSet(null);
  }

  /* ---------------------------- expose globally ---------------------------- */
  window.FVUserContext = { get, ready, refresh, onChange, clear };

  // Seed from any existing cache immediately (so first consumer sees *something*)
  _ctx = lsGet(STORAGE_KEY);

  // If there is no cache at all (first app launch), build it once in the background
  if (!_ctx) {
    refresh().catch(() => { /* ignore */ });
  }
})();