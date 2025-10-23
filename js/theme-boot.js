// /Farm-vista/js/theme-boot.js — STABLE (Upsync-only, no overlays, no downsync)

/* Viewport & tap */
(function(){
  try{
    var HARD_NO_ZOOM = true;
    var desired = HARD_NO_ZOOM
      ? 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover'
      : 'width=device-width, initial-scale=1, viewport-fit=cover';
    var m = document.querySelector('meta[name="viewport"]');
    if (m) m.setAttribute('content', desired);
    else {
      m = document.createElement('meta'); m.name='viewport'; m.content=desired;
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

/* Theme pref */
(function(){
  try{
    var t = localStorage.getItem('fv-theme');
    if(!t) return;
    document.documentElement.setAttribute('data-theme', t === 'system' ? 'auto' : t);
    document.documentElement.classList.toggle('dark',
      t === 'dark' || (t === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
    );
  }catch(e){}
})();

/* Tiny app bus */
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

/* Firebase boot (global) */
(function(){
  try{
    if (window.__FV_FIREBASE_INIT_LOADED__) return;
    window.__FV_FIREBASE_INIT_LOADED__ = true;
    var s = document.createElement('script');
    s.type = 'module'; s.defer = true; s.src = '/Farm-vista/js/firebase-init.js';
    document.head.appendChild(s);
  }catch(e){ console.warn('[FV] Firebase boot error:', e); }
})();

/* Auth guard */
(function(){
  const run = async () => {
    try{
      const mod = await import('/Farm-vista/js/firebase-init.js'); await mod.ready;
      const { auth } = mod;
      const here = location.pathname + location.search + location.hash;
      const isLogin = location.pathname.replace(/\/+$/,'').endsWith('/Farm-vista/pages/login');
      const { onAuthStateChanged } = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js');
      onAuthStateChanged(auth, (user) => {
        if (!user) {
          if (!isLogin) location.replace('/Farm-vista/pages/login/?next=' + encodeURIComponent(here));
        } else if (isLogin) {
          const qs = new URLSearchParams(location.search);
          location.replace(qs.get('next') || '/Farm-vista/dashboard/');
        }
      }, { onlyOnce: true });
    }catch(e){ console.warn('[FV] auth-guard error:', e); }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once:true }); else run();
})();

/* User-ready broadcast */
(function(){
  const start = async () => {
    try{
      const mod = await import('/Farm-vista/js/firebase-init.js'); await mod.ready;
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
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true }); else start();
})();

/* UPSYNC ONLY: localStorage → Firestore (no listeners, no UI) */
(function(){
  // Map fv_* keys to collection names by convention
  function keyToCollection(lsKey){
    if (!lsKey || typeof lsKey !== 'string' || !lsKey.startsWith('fv_')) return null;
    let s = lsKey.replace(/^fv_/, '');
    s = s.replace(/^(setup|contacts|calc|pages|app|settings|data)_/, '');
    s = s.replace(/_v\d+$/, '');
    return s || null;
  }
  function normalizeItem(it){ const o = {...(it||{})}; if (!o.id) o.id = String(o.t || Date.now()); return o; }

  const _setItem = localStorage.setItem;
  const pending = new Map();
  let flushTimer = null;

  function scheduleFlush(){ clearTimeout(flushTimer); flushTimer = setTimeout(flush, 250); }

  localStorage.setItem = function(key, val){
    try { _setItem.apply(this, arguments); } catch {}
    try{
      if (typeof key === 'string' && key.startsWith('fv_') && typeof val === 'string'){
        const parsed = JSON.parse(val);
        pending.set(key, parsed);
        scheduleFlush();
      }
    }catch{}
  };

  async function flush(){
    if (!pending.size) return;
    let env;
    try{
      const mod = await import('/Farm-vista/js/firebase-init.js');
      env = await mod.ready;
      if (!env || !env.auth || !env.db) return;
    }catch(e){ return; }

    const user = env.auth.currentUser; if (!user) return;

    let f;
    try{ f = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js'); }
    catch{ return; }

    for (const [lsKey, arr] of Array.from(pending.entries())){
      pending.delete(lsKey);
      const coll = keyToCollection(lsKey);
      if (!coll) continue;

      try{
        const list = Array.isArray(arr) ? arr : [];
        for (const raw of list){
          const it = normalizeItem(raw);
          const ref = f.doc(f.collection(env.db, coll), it.id);
          await f.setDoc(ref, {
            ...it,
            uid: user.uid,
            updatedAt: f.serverTimestamp(),
            createdAt: it.createdAt || f.serverTimestamp(),
          }, { merge: true });
        }
        // also register collection so future builds can downsync, but do not depend on it
        try{
          const regRef = f.doc(f.collection(env.db, '_sync'), 'collections');
          const { arrayUnion, setDoc } = f;
          await setDoc(regRef, { list: arrayUnion(coll) }, { merge: true });
        }catch(_){}
      }catch(_err){
        // silent in stable build
      }
    }
  }

  // One-time sweep (push existing local caches)
  function initialSweep(){
    try{
      for (let i=0;i<localStorage.length;i++){
        const k = localStorage.key(i);
        const coll = keyToCollection(k);
        if (!coll) continue;
        try{
          const raw = localStorage.getItem(k);
          const parsed = JSON.parse(raw || '[]');
          if (Array.isArray(parsed) && parsed.length) pending.set(k, parsed);
        }catch{}
      }
      if (pending.size) scheduleFlush();
    }catch{}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialSweep, { once:true });
  else initialSweep();
})();