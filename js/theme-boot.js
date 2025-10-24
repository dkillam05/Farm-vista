// /Farm-vista/js/theme-boot.js — shell + theme only (no Firebase, no auth, no sync)
// Adds a one-time Service Worker kill switch via ?nosw=1 to ensure fresh code is running.

/* 0) SW kill switch (one-time: visit any page with ?nosw=1) */
(async function(){
  try{
    const u = new URL(location.href);
    if (u.searchParams.get('nosw') === '1') {
      // Unregister any service workers
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
      // Clear caches
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      // Remove the flag and hard-reload this page clean
      u.searchParams.delete('nosw');
      location.replace(u.toString());
      return; // stop boot so reload happens immediately
    }
  }catch(e){}
})();

/* 1) Helpers (PWA detect, tiny event bus) */
(function(){
  try{
    window.FV = window.FV || {};
    FV.isPWA = function(){
      return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
          || (typeof navigator !== 'undefined' && 'standalone' in navigator && navigator.standalone === true);
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

      /* Auth-free: never hide name placeholders */
      html:not(.fv-user-ready) [data-user-name] { visibility: visible; }

      /* Footer-safe/iOS-safe baseline */
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