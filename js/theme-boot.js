// /Farm-vista/js/theme-boot.js — shell + theme + loaders (Soft Guard w/ auth wait)

/* ——— Helpers: env + PWA detect ——— */
(function(){
  try{
    window.FV = window.FV || {};
    FV.isPWA = function(){
      return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
          || (typeof navigator !== 'undefined' && 'standalone' in navigator && navigator.standalone === true);
    };
  }catch(e){}
})();

const __FV_AUTH_WAIT_MS__ = 2200;   // Max time to wait for a real auth signal
const __FV_SYNC_BUST__    = true;   // Keep your cache-bust on sync module

/* 0) SOFT AUTH GUARD (waits briefly for real auth before redirecting)
      Avoids bounce/loops in both Safari and PWA by listening for:
      - Firebase onAuthStateChanged user
      - localStorage key 'fv:sessionAuthed' === '1' (existing, storage event, or polling)
*/
(function(){
  try{
    // Normalize path and detect if we're already on the login page
    var p = location.pathname.replace(/\/index\.html$/i,'').replace(/\/+$/,'');
    var isLogin = p.endsWith('/Farm-vista/pages/login');

    // Don’t guard the Login page
    if (isLogin) return;

    // Add a quick hold to prevent content flash while we verify auth
    document.documentElement.classList.add('fv-guard-hold');

    // Small, scoped CSS for the hold state
    (function(){
      try{
        var style = document.createElement('style');
        style.textContent = `
          html.fv-guard-hold { opacity: .001; pointer-events: none; }
          html.fv-guard-clear{ opacity: 1;    pointer-events: auto; }
        `;
        document.head.appendChild(style);
      }catch(e){}
    })();

    // Immediate allow if flag is already there
    var hasFlag = (localStorage.getItem('fv:sessionAuthed') === '1');
    if (hasFlag) {
      document.documentElement.classList.remove('fv-guard-hold');
      document.documentElement.classList.add('fv-guard-clear');
      return;
    }

    // Otherwise, wait for a real signal (Firebase user OR storage flag) up to timeout
    var resolved = false;
    var cleanupFns = [];

    function done(allow){
      if (resolved) return;
      resolved = true;
      cleanupFns.forEach(fn => { try{ fn(); }catch{} });
      if (allow) {
        document.documentElement.classList.remove('fv-guard-hold');
        document.documentElement.classList.add('fv-guard-clear');
      } else {
        // Redirect to login with next=
        var next = encodeURIComponent(location.pathname + location.search + location.hash);
        location.replace('/Farm-vista/pages/login/?next=' + next);
      }
    }

    // 0a) If the key appears at any moment, allow
    const poll = setInterval(()=>{
      try{
        if (localStorage.getItem('fv:sessionAuthed') === '1') done(true);
      }catch(e){}
    }, 120);
    cleanupFns.push(()=>clearInterval(poll));

    // 0b) Listen for storage changes (e.g., other modules setting the key)
    function onStorage(ev){
      try{
        if (ev && ev.key === 'fv:sessionAuthed' && ev.newValue === '1') done(true);
      }catch(e){}
    }
    window.addEventListener('storage', onStorage);
    cleanupFns.push(()=>window.removeEventListener('storage', onStorage));

    // 0c) Also hook Firebase directly so we don’t depend solely on the flag
    (async function(){
      try{
        const mod = await import('/Farm-vista/js/firebase-init.js'); await mod.ready;
        const { auth } = mod;
        const { onAuthStateChanged } =
          await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js');
        const un = onAuthStateChanged(auth, (user)=>{
          if (user) {
            // set the flag to keep future cold launches fast
            try{ localStorage.setItem('fv:sessionAuthed','1'); }catch(e){}
            done(true);
          }
        });
        cleanupFns.push(()=>{ try{ un(); }catch{} });
      }catch(e){
        // If Firebase can’t load, we’ll fall back to timeout → login
      }
    })();

    // 0d) Timeout → if nothing proved auth, go to login
    const t = setTimeout(()=>done(false), __FV_AUTH_WAIT_MS__);
    cleanupFns.push(()=>clearTimeout(t));
  }catch(e){}
})();

/* 1) Viewport & tap behavior */
(function(){
  try{
    var HARD_NO_ZOOM = true;
    var desired = HARD_NO_ZOOM
      ? 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover'
      : 'width=device-width, initial-scale=1, viewport-fit=cover';
    var m = document.querySelector('meta[name="viewport"]');
    if (m) m.setAttribute('content', desired);
    else {
      m = document.createElement('meta'); m.name = 'viewport'; m.content = desired;
      if (document.head && document.head.firstChild) document.head.insertBefore(m, document.head.firstChild);
      else if (document.head) document.head.appendChild(m);
    }
    var style = document.createElement('style');
    style.textContent = `
      input, select, textarea, button { font-size: 16px !important; }
      a, button, .btn { -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
      html, body { touch-action: pan-x pan-y; }
      html:not(.fv-user-ready) [data-user-name] { visibility: hidden; }
    `;
    document.head.appendChild(style);
  }catch(e){}
})();

/* 2) Theme preference */
(function(){
  try{
    var t = localStorage.getItem('fv-theme');
    if(!t) return;
    document.documentElement.setAttribute('data-theme', t === 'system' ? 'auto' : t);
    document.documentElement.classList.toggle('dark',
      t === 'dark' ||
      (t === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
    );
  }catch(e){}
})();

/* 3) Tiny app bus */
(function(){
  try{
    window.FV = window.FV || {};
    if (!FV.bus) FV.bus = new EventTarget();
    if (!FV.announce) {
      FV.announce = function(evt, detail){
        try{
          FV.bus.dispatchEvent(new CustomEvent(evt, { detail }));
          window.dispatchEvent(new CustomEvent('fv:' + evt, { detail }));
        }catch{}
      };
    }
  }catch(e){}
})();

/* 4) Firebase init (global, once) */
(function(){
  try{
    if (window.__FV_FIREBASE_INIT_LOADED__) return;
    window.__FV_FIREBASE_INIT_LOADED__ = true;
    var s = document.createElement('script');
    s.type = 'module';
    s.defer = true;
    s.src = '/Farm-vista/js/firebase-init.js';
    s.addEventListener('error', ()=>console.warn('[FV] firebase-init failed to load'));
    document.head.appendChild(s);
  }catch(e){ console.warn('[FV] Firebase boot error:', e); }
})();

/* 5) External Auth Guard (async; your canonical login/logout handler) */
(function(){
  try{
    if (window.__FV_AUTH_GUARD_LOADED__) return;
    window.__FV_AUTH_GUARD_LOADED__ = true;
    var s = document.createElement('script');
    s.type = 'module';
    s.defer = true;
    s.src = '/Farm-vista/js/auth-guard.js';
    s.addEventListener('error', ()=>console.warn('[FV] auth-guard failed to load'));
    document.head.appendChild(s);
  }catch(e){ console.warn('[FV] Auth-guard inject error:', e); }
})();

/* 6) User-ready broadcast (fires after Firebase signals; safe in both PWA & Safari) */
(function(){
  const start = async () => {
    try{
      const mod = await import('/Farm-vista/js/firebase-init.js'); await mod.ready;
      const { auth } = mod;
      const { onAuthStateChanged } =
        await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js');

      onAuthStateChanged(auth, (user) => {
        document.documentElement.classList.add('fv-user-ready');
        // If signed out, clear the authed flag so guard behaves correctly next launch
        try{
          if (!user) localStorage.removeItem('fv:sessionAuthed');
          else localStorage.setItem('fv:sessionAuthed','1');
        }catch(e){}
        FV.announce('user-ready', user || null);
        FV.announce('user-change', user || null);
      });
    }catch(e){
      document.documentElement.classList.add('fv-user-ready');
      FV.announce('user-ready', null);
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once:true });
  } else {
    start();
  }
})();

/* 7) Firestore sync module (optional; your up/down sync lives there) */
(function(){
  try{
    if (window.__FV_SYNC_LOADED__) return;
    const qs = new URLSearchParams(location.search);
    const disabled = (qs.get('nosync') === '1') || (localStorage.getItem('fv:sync:disabled') === '1');
    if (disabled) { console.warn('[FV] Sync disabled by flag'); return; }

    window.__FV_SYNC_LOADED__ = true;
    var s = document.createElement('script');
    s.type = 'module';
    s.defer = true;
    s.src = '/Farm-vista/js/firestore/fv-sync.js' + (__FV_SYNC_BUST__ ? ('?ts=' + Date.now()) : '');
    s.addEventListener('error', ()=> console.warn('[FV] fv-sync.js failed to load'));
    document.head.appendChild(s);
  }catch(e){
    console.warn('[FV] Sync inject error:', e);
  }
})();