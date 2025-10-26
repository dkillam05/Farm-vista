// /Farm-vista/js/theme-boot.js  (PROJECT-SITE SAFE: base-relative paths)

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
(function(){
  const run = async () => {
    try {
      // BASE-RELATIVE dynamic import
      const mod = await import('js/firebase-init.js');
      const ctx = await mod.ready;
      const auth = ctx && ctx.auth;

      // In stub/offline mode we skip redirects entirely.
      if (!auth || (mod.isStub && mod.isStub())) return;

      const here = location.pathname + location.search + location.hash;

      // Normalize and robustly detect login page:
      // supports /pages/login, /pages/login/, /pages/login/index.html
      const normalize = (p) => p.replace(/\/+$/,'/'); // keep single trailing slash
      const pNow   = normalize(location.pathname);
      const pLogin = normalize(new URL('pages/login/', location.href).pathname);
      const isLogin = pNow === pLogin || pNow.startsWith(pLogin);

      mod.onAuthStateChanged(auth, (user) => {
        if (!user) {
          if (!isLogin) {
            const next = encodeURIComponent(here);
            // BASE-RELATIVE redirect to login with return url
            location.replace('pages/login/?next=' + next);
          }
        } else if (isLogin) {
          // Already signed in and on login — bounce to next or dashboard/
          const qs = new URLSearchParams(location.search);
          const nextUrl = qs.get('next') || 'dashboard/';
          location.replace(nextUrl);
        }
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