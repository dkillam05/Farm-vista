// /Farm-vista/js/theme-boot.js  (PROJECT-SITE SAFE: absolute project-root paths)
// Viewport + theme boot + firebase config/init + app startup + AUTH GUARD + login wiring

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
  // Detect the project root '/Farm-vista/' in ANY path depth
  const projectRoot = (() => {
    const m = location.pathname.match(/^(.*?\/Farm-vista\/)/);
    if (m && m[1]) return m[1];               // e.g., '/Farm-vista/'
    return '/Farm-vista/';                     // fallback for GH Pages
  })();

  const once = (key, fn) => {
    if (window[key]) return window[key];
    window[key] = fn();
    return window[key];
  };

  // Always load from absolute project root (prevents deep-path 404s)
  const loadScriptAbs = (pathFromRoot, {type, defer=true, async=false}={}) => new Promise((res, rej)=>{
    const s = document.createElement('script');
    if (type) s.type = type;
    s.defer = !!defer; s.async = !!async;
    s.src = projectRoot + String(pathFromRoot).replace(/^\/+/, '');
    s.onload = () => res();
    s.onerror = (e) => rej(e);
    document.head.appendChild(s);
  });

  return { once, loadScriptAbs, projectRoot };
})();

/* ==============  Firebase CONFIG -> INIT (absolute /Farm-vista/ paths)  ============== */
(function(){
  __fvBoot.once('__FV_FIREBASE_CHAIN__', async () => {
    try{
      // 1) Ensure global config is present BEFORE loading firebase-init.js
      if (!window.FV_FIREBASE_CONFIG) {
        try {
          await __fvBoot.loadScriptAbs('js/firebase-config.js', { defer:false, async:false });
        } catch(e) {
          console.warn('[FV] firebase-config.js failed to load (continuing with stub):', e);
        }
      }

      // 2) Load firebase-init.js as a module (once)
      if (!window.__FV_FIREBASE_INIT_LOADED__) {
        window.__FV_FIREBASE_INIT_LOADED__ = true;
        try {
          await __fvBoot.loadScriptAbs('js/firebase-init.js', { type:'module', defer:true });
          console.log('[FV] firebase-init loaded');
        } catch (e) {
          console.warn('[FV] firebase-init failed to load — check /Farm-vista/js/firebase-init.js', e);
        }
      }

      // 3) App startup module (optional, safe if missing)
      if (!window.__FV_APP_STARTUP_LOADED__) {
        window.__FV_APP_STARTUP_LOADED__ = true;
        try {
          await __fvBoot.loadScriptAbs('js/app/startup.js', { type:'module', defer:true });
        } catch (e) {
          console.warn('[FV] startup module failed to load — check /Farm-vista/js/app/startup.js', e);
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
  - In dev/stub, we allow by default to prevent bounce-loops.
*/
(function(){
  const REQUIRE_FIRESTORE_USER_DOC = false;
  const TREAT_MISSING_DOC_AS_DENY  = false;
  const ALLOW_STUB_MODE            = true;   // prevents bounce during stub/dev

  const FIELD_DISABLED = 'disabled';
  const FIELD_ACTIVE   = 'active';

  const projectRoot = __fvBoot.projectRoot;

  const samePath = (a, b) => {
    try {
      const ua = new URL(a, document.baseURI || location.href);
      const ub = new URL(b, document.baseURI || location.href);
      return ua.pathname === ub.pathname && ua.search === ub.search && ua.hash === ub.hash;
    } catch { return a === b; }
  };

  const isLoginPath = () => {
    // supports /pages/login, /pages/login/, /pages/login/index.html
    try {
      const loginAbs = new URL(projectRoot + 'pages/login/', location.origin).pathname;
      const cur = location.pathname.endsWith('/') ? location.pathname : (location.pathname + '/');
      return cur.startsWith(loginAbs);
    } catch {
      return location.pathname.includes('/pages/login/');
    }
  };

  const gotoLogin = (reason) => {
    const here = location.pathname + location.search + location.hash;
    const loginUrl = new URL(projectRoot + 'pages/login/index.html', location.origin);
    loginUrl.searchParams.set('next', here);
    if (reason) loginUrl.searchParams.set('reason', reason);
    const dest = loginUrl.pathname + loginUrl.search + loginUrl.hash;
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

  // Optional: wire the login page without editing HTML
  const wireLoginPage = async () => {
    if (!isLoginPath()) return;
    try{
      const mod = await import('/Farm-vista/js/firebase-init.js');
      await mod.ready;
      const auth = (window.firebaseAuth) || (mod.getAuth && mod.getAuth()) || null;
      if (!auth) { console.warn('[FV] No auth available on login page'); return; }

      const qs = (sel) => document.querySelector(sel);
      const form = qs('form[data-fv-login]') || qs('#loginForm') || qs('form[action*="login"]') || qs('form');

      if (!form) { console.warn('[FV] No login form found'); return; }

      const emailEl = form.querySelector('input[type="email"], input[name="email"], #email');
      const passEl  = form.querySelector('input[type="password"], input[name="password"], #password');
      const btn     = form.querySelector('button[type="submit"], input[type="submit"], .js-login');
      const errBox  = form.querySelector('.js-error') || null;

      const showErr = (msg) => {
        if (errBox) { errBox.textContent = msg; errBox.style.display = 'block'; }
        else alert(msg);
      };

      form.addEventListener('submit', async (e)=>{
        e.preventDefault();
        const email = (emailEl && emailEl.value || '').trim();
        const pass  = (passEl && passEl.value || '');
        if (btn) btn.disabled = true;

        try{
          // Use real Firebase if available; stub sign-in also supported by mod
          await mod.signInWithEmailAndPassword(auth, email, pass);

          // On success, go to ?next=… or to dashboard
          const url = new URL(location.href);
          const next = url.searchParams.get('next') || (__fvBoot.projectRoot + 'dashboard/index.html');
          location.replace(next);
        }catch(err){
          console.warn('[FV] login error:', err);
          let msg = 'Login failed.';
          if (err && (err.message || err.code)) msg = `${msg} ${err.code || ''} ${err.message || ''}`.trim();
          showErr(msg);
        }finally{
          if (btn) btn.disabled = false;
        }
      }, { once:false });
    }catch(e){
      console.warn('[FV] wireLoginPage error:', e);
    }
  };

  const run = async () => {
    try {
      // If we are on the login page, do NOT guard; just wire it and exit.
      if (isLoginPath()) { wireLoginPage(); return; }

      const mod = await import('/Farm-vista/js/firebase-init.js');
      const ctx = await mod.ready;
      const isStub = (mod.isStub && mod.isStub()) || false;
      const auth = (ctx && ctx.auth) || window.firebaseAuth || null;

      if (isStub && ALLOW_STUB_MODE) return;

      if (!auth) { gotoLogin('no-auth'); return; }

      try {
        if (mod.setPersistence && mod.browserLocalPersistence) {
          await mod.setPersistence(auth, mod.browserLocalPersistence());
        }
      } catch (e) { console.warn('[FV] setPersistence failed:', e); }

      const user = await waitForAuthHydration(mod, auth, 1600);
      if (!user) { gotoLogin('unauthorized'); return; }

      // Optional Firestore gating
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