// /Farm-vista/js/theme-boot.js  (PROJECT-SITE SAFE: base-relative paths)
// Viewport + theme boot + firebase boot + app startup + AUTH GUARD

// === Global viewport + mobile tap behavior (inject once for the whole app) ===
(function(){
  try{
    var HARD_NO_ZOOM = true;

    var desired = HARD_NO_ZOOM
      ? 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover'
      : 'width=device-width, initial-scale=1, viewport-fit=cover';

    var m = document.querySelector('meta[name="viewport"]');
    if (m) {
      m.setAttribute('content', desired);
    } else {
      m = document.createElement('meta');
      m.name = 'viewport';
      m.content = desired;
      if (document.head && document.head.firstChild) {
        document.head.insertBefore(m, document.head.firstChild);
      } else if (document.head) {
        document.head.appendChild(m);
      }
    }

    var style = document.createElement('style');
    style.textContent = `
      /* Prevent iOS auto-zoom on inputs and kill 300ms delay */
      input, select, textarea, button { font-size: 16px !important; }
      a, button, .btn { -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
      html, body { touch-action: pan-x pan-y; }
    `;
    document.head.appendChild(style);
  }catch(e){}
})();

// === Theme preference boot (unchanged) ===
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

// === Global Firebase boot: load once as a module across the whole app ===
(function(){
  try{
    if (window.__FV_FIREBASE_INIT_LOADED__) return;
    window.__FV_FIREBASE_INIT_LOADED__ = true;

    var s = document.createElement('script');
    s.type = 'module';
    s.defer = true;
    // BASE-RELATIVE (respects <base href="/Farm-vista/">)
    s.src = 'js/firebase-init.js';
    document.head.appendChild(s);

    s.addEventListener('load', function(){
      console.log('[FV] firebase-init loaded');
    });
    s.addEventListener('error', function(){
      console.warn('[FV] firebase-init failed to load — check path js/firebase-init.js');
    });
  }catch(e){
    console.warn('[FV] Firebase boot error:', e);
  }
})();

// === App startup (profile + storage sync) ===
(function(){
  try{
    if (window.__FV_APP_STARTUP_LOADED__) return;
    window.__FV_APP_STARTUP_LOADED__ = true;

    var start = document.createElement('script');
    start.type = 'module';
    start.defer = true;
    // BASE-RELATIVE
    start.src = 'js/app/startup.js';
    document.head.appendChild(start);

    start.addEventListener('error', function(){
      console.warn('[FV] startup module failed to load — check js/app/startup.js');
    });
  }catch(e){
    console.warn('[FV] startup boot error:', e);
  }
})();

// === Global Auth Guard (runs on every page) ===
// RULES:
//  - Login page is PUBLIC. Never redirect away from it (even if already signed-in).
//  - Any other page requires auth. If not signed-in, redirect to login with ?next=<current>.
//  - Optional Firestore gating (disabled by default below — flip flags to enable).
(function(){
  // ---- Optional Firestore gating toggles ----
  const REQUIRE_FIRESTORE_USER_DOC = false; // set true to require users/{uid} doc
  const TREAT_MISSING_DOC_AS_DENY   = false; // if true, missing doc denies access
  const FIELD_DISABLED = 'disabled';
  const FIELD_ACTIVE   = 'active';

  const samePath = (a, b) => {
    try {
      const ua = new URL(a, document.baseURI || location.href);
      const ub = new URL(b, document.baseURI || location.href);
      return ua.pathname === ub.pathname && ua.search === ub.search && ua.hash === ub.hash;
    } catch { return a === b; }
  };

  const isLoginPath = () => {
    // Support: /pages/login, /pages/login/, /pages/login/index.html
    const p = new URL('pages/login/', location.href).pathname;   // base-relative
    const cur = location.pathname.endsWith('/') ? location.pathname : location.pathname + '/';
    return cur.startsWith(p);
  };

  const gotoLogin = (reason) => {
    const here = location.pathname + location.search + location.hash;
    const url = new URL('pages/login/index.html', location.href);
    url.searchParams.set('next', here);
    if (reason) url.searchParams.set('reason', reason);
    const dest = url.pathname + url.search + url.hash;
    if (!samePath(location.href, dest)) location.replace(dest);
  };

  const run = async () => {
    try {
      const mod = await import('js/firebase-init.js');
      const ctx = await mod.ready;
      const auth = ctx && ctx.auth;

      // LOGIN PAGE IS ALWAYS PUBLIC
      if (isLoginPath()) return;

      // Fail-closed if no Firebase auth (stub/offline) on non-login pages
      if (!auth || (mod.isStub && mod.isStub())) {
        gotoLogin('no-auth');
        return;
      }

      // Persist session to local for predictable behavior
      try {
        if (mod.setPersistence && mod.browserLocalPersistence) {
          await mod.setPersistence(auth, mod.browserLocalPersistence());
        }
      } catch (e) { console.warn('[FV] setPersistence failed:', e); }

      // For all other pages, require auth.
      mod.onAuthStateChanged(auth, async (user) => {
        if (!user) { gotoLogin('unauthorized'); return; }

        // Optional Firestore user-doc enforcement
        if (!REQUIRE_FIRESTORE_USER_DOC && !TREAT_MISSING_DOC_AS_DENY) return;

        try {
          const db = mod.getFirestore();
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
          // else allowed
        } catch (err) {
          console.warn('[FV] Firestore auth check failed:', err);
          if (REQUIRE_FIRESTORE_USER_DOC && TREAT_MISSING_DOC_AS_DENY) {
            try { await mod.signOut(auth); } catch {}
            gotoLogin('auth-check-failed');
          }
        }
      });
    } catch (e) {
      console.warn('[FV] auth-guard error:', e);
      // On any fatal error, fail-closed off login
      if (!isLoginPath()) gotoLogin('guard-error');
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once:true });
  } else {
    run();
  }
})();