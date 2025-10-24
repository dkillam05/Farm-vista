// /Farm-vista/js/theme-boot.js — shell + theme only (no Firebase, no auth, no sync)

/* 0) Helpers (PWA detect, event bus bootstrap) */
(function(){
  try{
    window.FV = window.FV || {};
    FV.isPWA = function(){
      return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
          || (typeof navigator !== 'undefined' && 'standalone' in navigator && navigator.standalone === true);
    };
    // Tiny app bus
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
      /* Since there's no auth layer now, never hide name placeholders */
      html:not(.fv-user-ready) [data-user-name] { visibility: visible; }
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

/* 3) App ready (no auth gating) */
(function(){
  const markReady = () => {
    try{
      document.documentElement.classList.add('fv-user-ready');
      // Broadcast a basic ready event (no user payload anymore)
      FV.announce('user-ready', null);
    }catch(e){}
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', markReady, { once:true });
  } else {
    markReady();
  }
})();

/* 4) (Removed) Firebase init — not used */

/* 5) (Removed) Auth guard inject — not used */

/* 6) (Removed) Auth state listener — not used */

/* 7) (Removed) Firestore sync module — not used */