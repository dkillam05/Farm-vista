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
(function(){
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

  const run = async () => {
    try {
      const mod = await import('js/firebase-init.js');
      const ctx = await mod.ready;
      const auth = ctx && ctx.auth;

      // If offline/stub: allow everything (no redirects)
      if (!auth || (mod.isStub && mod.isStub())) return;

      const here = location.pathname + location.search + location.hash;

      // Always allow the login page, signed-in or not.
      if (isLoginPath()) {
        return; // ❗️No redirect logic at all on login page
      }

      // For all other pages, require auth.
      mod.onAuthStateChanged(auth, (user) => {
        if (!user) {
          const dest = 'pages/login/index.html?next=' + encodeURIComponent(here);
          if (!samePath(location.href, dest)) location.replace(dest);
        }
        // If user exists, do nothing (they can stay on any page including dashboard)
      });
    } catch (e) {
      console.warn('[FV] auth-guard error:', e);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once:true });
  } else {
    run();
  }
})();