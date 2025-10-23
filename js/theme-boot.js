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
      /* Hide user-name placeholders until auth is ready */
      html:not(.fv-user-ready) [data-user-name] { visibility: hidden; }
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

// === Light app bus so we can announce auth readiness across pages ===
(function(){
  try{
    window.FV = window.FV || {};
    if (!FV.bus) FV.bus = new EventTarget();
    if (typeof FV.announce !== 'function') {
      FV.announce = function(evtName, detail){
        try {
          FV.bus.dispatchEvent(new CustomEvent(evtName, { detail }));
          window.dispatchEvent(new CustomEvent('fv:' + evtName, { detail })); // legacy mirror
        } catch {}
      };
    }
  }catch(e){}
})();

// === Global Firebase boot: load once as a module across the whole app ===
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

// === Global Auth Guard (runs on every page) ===
(function(){
  const run = async () => {
    try{
      const mod = await import('/Farm-vista/js/firebase-init.js');
      await mod.ready;
      const { auth } = mod;

      const here = location.pathname + location.search + location.hash;
      const isLogin = location.pathname.replace(/\/+$/,'').endsWith('/Farm-vista/pages/login');

      const { onAuthStateChanged } = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js');
      onAuthStateChanged(auth, (user) => {
        if (!user) {
          if (!isLogin) {
            const next = encodeURIComponent(here);
            location.replace('/Farm-vista/pages/login/?next=' + next);
          }
        } else {
          if (isLogin) {
            const qs = new URLSearchParams(location.search);
            const nextUrl = qs.get('next') || '/Farm-vista/dashboard/';
            location.replace(nextUrl);
          }
        }
      }, { onlyOnce: true });
    }catch(e){
      console.warn('[FV] auth-guard error:', e);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once:true });
  } else {
    run();
  }
})();

// === Announce user readiness immediately on first auth resolve (prevents "JOHNDOE" flash) ===
(function(){
  const start = async () => {
    try{
      const mod = await import('/Farm-vista/js/firebase-init.js');
      await mod.ready;
      const { auth } = mod;
      const { onAuthStateChanged } = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js');
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

// === Firestore Heartbeat & Diagnostics (global) ===
(function(){
  const OWNER_UID = "zD2ssHGNE6RmBSqAyg8r3s3tBKl2"; // your UID

  async function checkFirestore(){
    try{
      const mod = await import('/Farm-vista/js/firebase-init.js');
      await mod.ready;
      const { app, auth, db } = mod;
      if (!app || !auth || !db) throw new Error('Missing Firebase core');

      const user = auth.currentUser;
      if (!user) throw new Error('No signed-in user');
      if (user.uid !== OWNER_UID) {
        console.warn('[FV] Firestore heartbeat: signed in as non-owner', user.email || user.uid);
      }

      const { getDoc, doc } = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
      const ref = doc(db, '_heartbeat', 'ping');
      try {
        await getDoc(ref);
        console.log('[FV] ✅ Firestore connection OK');
      } catch (readErr) {
        throw new Error('Firestore read failed — likely rules or network');
      }
    }catch(err){
      showDiag(err.message || String(err));
    }
  }

  function showDiag(msg){
    try{
      const box = document.createElement('div');
      box.textContent = '[FV] Firestore error: ' + msg;
      box.style.cssText = `
        position:fixed; bottom:12px; left:50%; transform:translateX(-50%);
        background:#B71C1C; color:#fff; padding:10px 16px; border-radius:8px;
        font-size:14px; z-index:99999; box-shadow:0 6px 20px rgba(0,0,0,.4);
      `;
      document.body.appendChild(box);
      setTimeout(()=> box.remove(), 6000);
    }catch{}
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', checkFirestore, {once:true});
  } else {
    checkFirestore();
  }
})();