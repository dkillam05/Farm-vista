// /Farm-vista/js/theme-boot.js — shell + theme only (no Firebase, no auth, no sync)
// Adds a simple, auth-free logout handler that routes to Dashboard (not /pages/login/)

/* 0) SW kill switch (optional): visit any page with ?nosw=1 to clear old caches */
(async function(){
  try{
    const u = new URL(location.href);
    if (u.searchParams.get('nosw') === '1') {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      u.searchParams.delete('nosw');
      location.replace(u.toString());
      return;
    }
  }catch(e){}
})();

/* 1) Helpers (PWA detect, tiny event bus) */
(function(){
  try{
    window.FV = window.FV || {};
    FV.isPWA = function(){
      return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
          || (typeof navigator !== 'undefined' && navigator.standalone === true);
    };
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

/* 2) Viewport & global layout baseline */
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

    // Global CSS (footer-safe, iOS-safe) applied to all pages
    var style = document.createElement('style');
    style.textContent = `
      input, select, textarea, button { font-size: 16px !important; }
      a, button, .btn { -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
      html, body { touch-action: pan-x pan-y; }

      html, body { height: 100%; }
      body{
        background: var(--app-bg, var(--surface));
        min-height: 100svh;
        overscroll-behavior-y: contain;
        margin: 0;
      }
      .page{
        max-width: 1100px;
        margin: 0 auto;
        padding: clamp(14px, 3vw, 22px);
        padding-bottom: calc(env(safe-area-inset-bottom, 0px) + var(--ftr-h, 42px) + 8px);
        min-height: calc(
          100svh
          - var(--hdr-h, 56px)
          - var(--ftr-h, 42px)
          - env(safe-area-inset-top, 0px)
          - env(safe-area-inset-bottom, 0px)
        );
        display: flex;
        flex-direction: column;
      }
    `;
    document.head.appendChild(style);
  }catch(e){}
})();

/* 3) Theme preference */
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

/* 4) App ready (no auth gating) */
(function(){
  const markReady = () => {
    try{
      document.documentElement.classList.add('fv-user-ready');
      FV.announce('user-ready', null);
    }catch(e){}
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', markReady, { once:true });
  } else {
    markReady();
  }
})();

/* 5) SIMPLE LOGOUT (auth-free)
   Any element with .js-logout will:
   - clear local app flags
   - route to /Farm-vista/pages/dashboard/ (NOT /pages/login/)
   This prevents the offline page that your SW shows for the old login route. */
(function(){
  const DASH = '/Farm-vista/pages/dashboard/';
  document.addEventListener('click', (e)=>{
    const el = e.target.closest('.js-logout, [data-logout]');
    if (!el) return;

    e.preventDefault();
    // clear only our app flags (keep user prefs like theme)
    try {
      localStorage.removeItem('fv:sessionAuthed');
      localStorage.removeItem('fv:auth:op');
      // add any other app-session keys you used before here
    } catch {}

    // hard navigate to a real, online page (avoid old /pages/login/)
    const url = DASH + (DASH.includes('?') ? '&' : '?') + 'v=' + Date.now();
    location.replace(url);
  }, true);
})();