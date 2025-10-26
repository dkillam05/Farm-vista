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

      if (!auth || mod.isStub()) return;

      const here = location.pathname + location.search + location.hash;

      // Compute login path relative to current site (respects <base>)
      const loginPath = new URL('pages/login/', location.href).pathname.replace(/\/+$/,'');
      const herePath  = location.pathname.replace(/\/+$/,'');
      const isLogin = (herePath === loginPath) || herePath.startsWith(loginPath);

      mod.onAuthStateChanged(auth, (user) => {
        if (!user) {
          if (!isLogin) {
            const next = encodeURIComponent(here);
            // BASE-RELATIVE redirect
            location.replace('pages/login/?next=' + next);
          }
        } else if (isLogin) {
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