// /Farm-vista/js/theme-boot.js

// === Global viewport + mobile tap behavior (inject once for the whole app) ===
(function(){
  try{
    // Set to true to fully disable zoom (double-tap & pinch). Set false to keep pinch-zoom.
    var HARD_NO_ZOOM = true;

    var desired = HARD_NO_ZOOM
      ? 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover'
      : 'width=device-width, initial-scale=1, viewport-fit=cover';

    // Ensure a consistent viewport meta across all pages.
    var m = document.querySelector('meta[name="viewport"]');
    if (m) {
      m.setAttribute('content', desired);
    } else {
      m = document.createElement('meta');
      m.name = 'viewport';
      m.content = desired;
      // Prepend so iOS honors it early
      if (document.head && document.head.firstChild) {
        document.head.insertBefore(m, document.head.firstChild);
      } else if (document.head) {
        document.head.appendChild(m);
      }
    }

    // Global CSS to stop iOS zoom-on-focus and the 300ms double-tap delay
    var style = document.createElement('style');
    style.textContent = `
      /* Prevent iOS auto-zoom on form focus */
      input, select, textarea, button { font-size: 16px !important; }
      /* Smoother taps; removes 300ms delay on clickable elements */
      a, button, .btn { -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
      /* Reduce accidental double-tap zooms while keeping natural panning */
      html, body { touch-action: pan-x pan-y; }
    `;
    document.head.appendChild(style);
  }catch(e){}
})();

// === Theme preference boot (your original code, unchanged) ===
(function(){
  try{
    var t = localStorage.getItem('fv-theme');        // 'light' | 'dark' | 'system'
    if(!t) return;                                   // no preference → keep light defaults
    document.documentElement.setAttribute('data-theme', t === 'system' ? 'auto' : t);
    document.documentElement.classList.toggle('dark',
      t === 'dark' ||
      (t === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
    );
  }catch(e){}
})();

// === Global Firebase boot: load once as a module across the whole app ===
// We don't convert this file to a module; instead we inject a module script safely.
(function(){
  try{
    // Avoid double-loading if another page already added it.
    if (window.__FV_FIREBASE_INIT_LOADED__) return;
    window.__FV_FIREBASE_INIT_LOADED__ = true;

    var s = document.createElement('script');
    s.type = 'module';
    s.defer = true;
    s.src = '/Farm-vista/js/firebase-init.js'; // <-- make sure this file exists
    document.head.appendChild(s);

    // Optional: light console breadcrumb for verification
    s.addEventListener('load', function(){
      console.log('[FV] firebase-init loaded');
    });
    s.addEventListener('error', function(){
      console.warn('[FV] firebase-init failed to load — check path /Farm-vista/js/firebase-init.js');
    });
  }catch(e){
    console.warn('[FV] Firebase boot error:', e);
  }
})();