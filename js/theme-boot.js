// /Farm-vista/js/theme-boot.js  — viewport + theme + firebase boot + AUTH GUARD
// All internal paths are ABSOLUTE under /Farm-vista/ to avoid 404s on deep pages.

/* =========================  Viewport & tap behavior  ========================= */
(function(){
  try{
    var HARD_NO_ZOOM = true;
    var desired = HARD_NO_ZOOM
      ? 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover'
      : 'width=device-width, initial-scale=1, viewport-fit=cover';

    var m = document.querySelector('meta[name="viewport"]');
    if (m) m.setAttribute('content', desired);
    else {
      m = document.createElement('meta');
      m.name = 'viewport'; m.content = desired;
      if (document.head && document.head.firstChild) document.head.insertBefore(m, document.head.firstChild);
      else if (document.head) document.head.appendChild(m);
    }

    var style = document.createElement('style');
    style.textContent = `
      input, select, textarea, button { font-size: 16px !important; }
      a, button, .btn { -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
      html, body { touch-action: pan-x pan-y; }
    `;
    document.head.appendChild(style);
  }catch(e){}
})();

/* ==============================  Theme boot  ================================ */
(function(){
  try{
    var t = localStorage.getItem('fv-theme');        // 'light' | 'dark' | 'system'
    if(!t) return;
    document.documentElement.setAttribute('data-theme', t === 'system' ? 'auto' : t);
    document.documentElement.classList.toggle('dark',
      t === 'dark' ||
      (t === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
    );
  }catch(e){}
})();

/* =====================  Helpers for ordered script loads  ==================== */
const __fvBoot = (function(){
  const once = (key, fn) => {
    if (window[key]) return window[key];
    window[key] = fn();
    return window[key];
  };
  const loadScript = (src, {type, defer=true, async=false}) => new Promise((res, rej)=>{
    // Avoid duplicate <script> by URL
    if ([...document.scripts].some(s => (s.getAttribute('src')||'') === src)) { res(); return; }
    const s = document.createElement('script');
    if (type) s.type = type;
    s.defer = !!defer; s.async = !!async;
    s.src = src;
    s.onload = () => res();
    s.onerror = (e) => rej(e);
    document.head.appendChild(s);
  });
  return { once, loadScript };
})();

/* ==============  Firebase CONFIG -> INIT -> STARTUP -> PERM FILTER  ============== */
/* Centralizes boot so pages do NOT need to include perm-filter.js themselves. */
(function(){
  __fvBoot.once('__FV_FIREBASE_CHAIN__', async () => {
    try{
      // 1) Ensure global config is present BEFORE loading firebase-init.js
      if (!window.FV_FIREBASE_CONFIG) {
        try {
          await __fvBoot.loadScript('/Farm-vista/js/firebase-config.js', { defer:false, async:false });
        } catch(e) {
          console.warn('[FV] firebase-config.js failed to load (continuing):', e);
        }
      }

      // 2) Load firebase-init.js as a module (once)
      if (!window.__FV_FIREBASE_INIT_LOADED__) {
        window.__FV_FIREBASE_INIT_LOADED__ = true;
        try {
          await __fvBoot.loadScript('/Farm-vista/js/firebase-init.js', { type:'module', defer:true });
          // console.log('[FV] firebase-init loaded');
        } catch (e) {
          console.warn('[FV] firebase-init failed to load — check path /Farm-vista/js/firebase-init.js', e);
        }
      }

      // 3) App startup module (optional, safe if missing)
      if (!window.__FV_APP_STARTUP_LOADED__) {
        window.__FV_APP_STARTUP_LOADED__ = true;
        try {
          await __fvBoot.loadScript('/Farm-vista/js/app/startup.js', { type:'module', defer:true });
        } catch (e) {
          // optional; fine if missing
          // console.warn('[FV] startup module failed to load — check /Farm-vista/js/app/startup.js', e);
        }
      }

      // 4) Permission drawer filter (module) — centralized here
      if (!window.__FV_PERM_FILTER_LOADED__) {
        window.__FV_PERM_FILTER_LOADED__ = true;
        try {
          await __fvBoot.loadScript('/Farm-vista/js/perm-filter.js', { type:'module', defer:true });
        } catch (e) {
          console.warn('[FV] perm-filter failed to load — check /Farm-vista/js/perm-filter.js', e);
        }
      }
    }catch(e){
      console.warn('[FV] Firebase boot chain error:', e);
    }
  });
})();

/* ===============================  Auth Guard  =============================== */
/*
 RULES:
  - Login page is PUBLIC.
  - Other pages require Auth. We wait briefly for hydration before redirect.
  - Optional Firestore-gating toggles below.
  - In stub/dev, we allow by default to prevent bounce-loops.
*/
(function(){
  const REQUIRE_FIRESTORE_USER_DOC = false;
  const TREAT_MISSING_DOC_AS_DENY  = false;
  const ALLOW_STUB_MODE            = true;

  const FIELD_DISABLED = 'disabled';
  const FIELD_ACTIVE   = 'active';

  const samePath = (a, b) => {
    try {
      const ua = new URL(a, location.href);
      const ub = new URL(b, location.href);
      return ua.pathname === ub.pathname && ua.search === ub.search && ua.hash === ub.hash;
    } catch { return a === b; }
  };

  const isLoginPath = () => {
    const cur = location.pathname.endsWith('/') ? location.pathname : (location.pathname + '/');
    return cur.startsWith('/Farm-vista/pages/login/');
  };

  const gotoLogin = (reason) => {
    const here = location.pathname + location.search + location.hash;
    const url = new URL('/Farm-vista/pages/login/index.html', location.origin);
    url.searchParams.set('next', here);
    if (reason) url.searchParams.set('reason', reason);
    const dest = url.pathname + url.search + url.hash;
    if (!samePath(location.href, dest)) location.replace(dest);
  };

  const waitForAuthHydration = async (mod, auth, ms=1600) => {
    return new Promise((resolve) => {
      let settled = false;
      const done = (u)=>{ if(!settled){ settled=true; resolve(u); } };
      try {
        if (auth && auth.currentUser) return done(auth.currentUser);
        const off = mod.onAuthStateChanged(auth, u => { done(u); off && off(); });
        setTimeout(()=> done(auth && auth.currentUser || null), ms);
      } catch {
        resolve(auth && auth.currentUser || null);
      }
    });
  };

  const run = async () => {
    try {
      if (isLoginPath()) return;

      let mod;
      try {
        mod = await import('/Farm-vista/js/firebase-init.js');
      } catch (e) {
        console.warn('[FV] guard: firebase-init import failed:', e);
        gotoLogin('no-auth-mod');
        return;
      }

      const ctx = await (mod.ready || Promise.resolve(null));
      const isStub = (mod.isStub && mod.isStub()) || false;
      const auth = (ctx && ctx.auth) || window.firebaseAuth || null;

      if (isStub && ALLOW_STUB_MODE) return;
      if (!auth) { gotoLogin('no-auth'); return; }

      try {
        if (mod.setPersistence && mod.browserLocalPersistence) {
          await mod.setPersistence(auth, mod.browserLocalPersistence());
        }
      } catch (e) { /* non-fatal */ }

      const user = await waitForAuthHydration(mod, auth, 1600);
      if (!user) { gotoLogin('unauthorized'); return; }

      if (!REQUIRE_FIRESTORE_USER_DOC && !TREAT_MISSING_DOC_AS_DENY) return;

      try {
        const db  = mod.getFirestore();
        const ref = mod.doc(db, 'users', user.uid);
        const snap = await mod.getDoc(ref);

        if (!snap.exists()) {
          if (REQUIRE_FIRESTORE_USER_DOC && TREAT_MISSING_DOC_AS_DENY) {
            try { await mod.signOut(auth); } catch {}
            gotoLogin('no-user-doc');
          }
          return;
        }

        const u = snap.data() || {};
        const denied =
          (FIELD_DISABLED in u && !!u[FIELD_DISABLED]) ||
          (FIELD_ACTIVE in u && u[FIELD_ACTIVE] === false);

        if (denied) {
          try { await mod.signOut(auth); } catch {}
          gotoLogin('disabled');
          return;
        }
      } catch (err) {
        console.warn('[FV] Firestore auth check failed:', err);
        if (REQUIRE_FIRESTORE_USER_DOC && TREAT_MISSING_DOC_AS_DENY) {
          try { await mod.signOut(auth); } catch {}
          gotoLogin('auth-check-failed');
        }
      }
    } catch (e) {
      console.warn('[FV] auth-guard error:', e);
      if (!isLoginPath()) gotoLogin('guard-error');
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once:true });
  } else {
    run();
  }
})();