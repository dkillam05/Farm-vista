// /Farm-vista/js/theme-boot.js

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
      html:not(.fv-user-ready) [data-user-name] { visibility: hidden; }
    `;
    document.head.appendChild(style);
  }catch(e){}
})();

// === Theme preference boot ===
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

// === App bus ===
(function(){
  try{
    window.FV = window.FV || {};
    if (!FV.bus) FV.bus = new EventTarget();
    if (typeof FV.announce !== 'function') {
      FV.announce = function(evtName, detail){
        try {
          FV.bus.dispatchEvent(new CustomEvent(evtName, { detail }));
          window.dispatchEvent(new CustomEvent('fv:' + evtName, { detail }));
        } catch {}
      };
    }
  }catch(e){}
})();

// === Firebase boot ===
(function(){
  try{
    if (window.__FV_FIREBASE_INIT_LOADED__) return;
    window.__FV_FIREBASE_INIT_LOADED__ = true;

    var s = document.createElement('script');
    s.type = 'module';
    s.defer = true;
    s.src = '/Farm-vista/js/firebase-init.js';
    document.head.appendChild(s);
    s.addEventListener('load', ()=> console.log('[FV] firebase-init loaded'));
    s.addEventListener('error', ()=> console.warn('[FV] firebase-init failed to load — check path'));
  }catch(e){
    console.warn('[FV] Firebase boot error:', e);
  }
})();

// === Auth Guard ===
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
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', run, { once:true });
  else run();
})();

// === User Ready Broadcast ===
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
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();
})();

// === Firestore Heartbeat ===
(function(){
  const OWNER_UID = "zD2ssHGNE6RmBSqAyg8r3s3tBKl2";
  async function checkFirestore(){
    try{
      const mod = await import('/Farm-vista/js/firebase-init.js');
      await mod.ready;
      const { app, auth, db } = mod;
      if (!app || !auth || !db) throw new Error('Missing Firebase core');
      const user = auth.currentUser;
      if (!user) throw new Error('No signed-in user');
      if (user.uid !== OWNER_UID)
        console.warn('[FV] Firestore heartbeat: signed in as non-owner', user.email || user.uid);
      const { getDoc, doc } = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
      const ref = doc(db, '_heartbeat', 'ping');
      try { await getDoc(ref); console.log('[FV] ✅ Firestore connection OK'); }
      catch { throw new Error('Firestore read failed — likely rules or network'); }
    }catch(err){ showDiag(err.message || String(err)); }
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
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', checkFirestore, {once:true});
  else checkFirestore();
})();

// === Firestore Sync (global listener) ===
(function(){
  try {
    import('/Farm-vista/js/firestore/firestore-sync.js').catch(()=>{});
  } catch {}
})();