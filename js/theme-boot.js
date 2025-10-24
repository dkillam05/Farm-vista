// /Farm-vista/js/theme-boot.js — shell + theme + loaders (with PWA grace timing)

/* ——— Small helpers ——— */
(function(){
  try{
    window.FV = window.FV || {};
    // Detect if we're running as an installed iOS/standalone PWA
    FV.isPWA = function(){
      return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
          || (typeof navigator !== 'undefined' && 'standalone' in navigator && navigator.standalone === true);
    };
    // Short, safe delay (PWA only) to let Firebase/Auth initialize
    FV.pwaDelay = function(ms){
      if (!FV.isPWA()) return Promise.resolve();
      return new Promise(res => setTimeout(res, ms));
    };
  }catch(e){}
})();

const __FV_GUARD_GRACE_MS__ = 900;   // <- small timing shim for iOS PWA boot
const __FV_SYNC_BUST__       = true; // keep your cache-bust on sync module

/* 0) INSTANT PRE-GUARD (runs before any modules)
      If not on Login and we lack the session "authed" flag → bounce to Login.
      In PWA/standalone, wait briefly so Firebase/Auth can initialize to avoid loops. */
(function(){
  try{
    var p = location.pathname.replace(/\/index\.html$/i,'').replace(/\/+$/,'');
    var isLogin = p.endsWith('/Farm-vista/pages/login');
    var enforce = function(){
      try{
        var authed = sessionStorage.getItem('fv:sessionAuthed') === '1';
        if (!isLogin && !authed) {
          var next = encodeURIComponent(location.pathname + location.search + location.hash);
          location.replace('/Farm-vista/pages/login/?next=' + next);
        }
      }catch(e){}
    };

    if (FV && FV.isPWA && FV.isPWA()) {
      // Give auth-guard/firebase a moment to set sessionAuthed before we enforce
      setTimeout(enforce, __FV_GUARD_GRACE_MS__);
    } else {
      enforce();
    }
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

/* 5) External Auth Guard (async; real source of truth for redirects) */
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

/* 6) User-ready broadcast (for UI that shows user name, etc.)
      In PWA/standalone we wait a beat before listening, so onAuthStateChanged binds after firebase.init. */
(function(){
  const start = async () => {
    try{
      // Give the PWA a tiny grace period so firebase-init.js can fully init
      if (window.FV && FV.pwaDelay) await FV.pwaDelay(__FV_GUARD_GRACE_MS__);

      const mod = await import('/Farm-vista/js/firebase-init.js'); await mod.ready;
      const { auth } = mod;
      const { onAuthStateChanged } =
        await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js');

      onAuthStateChanged(auth, (user) => {
        document.documentElement.classList.add('fv-user-ready');
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