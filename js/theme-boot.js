// /Farm-vista/js/theme-boot.js

// === Global viewport + mobile tap behavior (inject once for the whole app) ===
(function(){
  try{
    var HARD_NO_ZOOM = true;
    var desired = HARD_NO_ZOOM
      ? 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover'
      : 'width=device-width, initial-scale=1, viewport-fit=cover';
    var m = document.querySelector('meta[name="viewport"]');
    if (m) { m.setAttribute('content', desired); }
    else {
      m = document.createElement('meta');
      m.name = 'viewport';
      m.content = desired;
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

// === App bus (light) ===
(function(){
  try{
    window.FV = window.FV || {};
    if (!FV.bus) FV.bus = new EventTarget();
    if (typeof FV.announce !== 'function') {
      FV.announce = function(evtName, detail){
        try{
          FV.bus.dispatchEvent(new CustomEvent(evtName, { detail }));
          window.dispatchEvent(new CustomEvent('fv:' + evtName, { detail })); // legacy mirror
        }catch{}
      };
    }
  }catch(e){}
})();

// === Firebase boot (global) ===
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

// === Auth Guard (all pages) ===
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
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once:true });
  else run();
})();

// === User Ready Broadcast (prevents placeholder flash) ===
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
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();
})();

// === Firestore Heartbeat (diagnostics only if broken) ===
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
      const ref = doc(db, '_heartbeat', 'ping'); // harmless read probe
      try { await getDoc(ref); console.log('[FV] ✅ Firestore connection OK'); }
      catch { throw new Error('Firestore read failed — likely rules or network'); }
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
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', checkFirestore, {once:true});
  else checkFirestore();
})();

// === Inline Global Firestore Sync (localStorage → Firestore) ===
(function(){
  // Map your localStorage keys → Firestore collections
  // Example: 'fv_setup_farms_v1' must go to 'farms'
  function mapKeyToCollection(key){
    if (key === 'fv_setup_farms_v1') return 'farms';        // explicit mapping for Farms page
    // fallback: strip 'fv_' prefix and _v<number> suffix → e.g., fv_setup_fields_v1 → setup_fields
    return key.replace(/^fv_/, '').replace(/_v\d+$/, '');
  }

  // Minimum shape normalization for items saved locally
  function normalizeItem(it){
    if (!it || typeof it !== 'object') return {};
    const out = { ...it };
    if (!out.id) out.id = String(out.t || Date.now());
    return out;
  }

  // Debounce queue so we don’t hammer Firestore on rapid saves
  const pending = new Map(); // key -> latest array
  let flushTimer = null;
  function scheduleFlush(){ clearTimeout(flushTimer); flushTimer = setTimeout(flush, 250); }

  async function flush(){
    if (!pending.size) return;
    let env;
    try{
      const mod = await import('/Farm-vista/js/firebase-init.js');
      env = await mod.ready;
      if (!env || !env.auth || !env.db) throw new Error('Firebase not ready');
    }catch(e){
      diag('Firebase not ready for sync');
      return;
    }

    const user = env.auth.currentUser;
    if (!user) { diag('No signed-in user for sync'); return; }

    // Lazy-load Firestore ops
    let f;
    try{
      f = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
    }catch{ diag('Failed to load Firestore SDK'); return; }

    // Attempt to push each dataset
    for (const [lsKey, arr] of pending.entries()){
      pending.delete(lsKey);
      const coll = mapKeyToCollection(lsKey);
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
        console.log(`[FV] Synced ${list.length} items from ${lsKey} → ${coll}`);
      }catch(err){
        diag(`Sync failed for ${coll}: ${err && err.message ? err.message : err}`);
      }
    }
  }

  function diag(msg){
    // Only show visible diagnostics if something actually failed
    try{
      const box = document.createElement('div');
      box.textContent = '[FV] Firestore sync error: ' + msg;
      box.style.cssText = `
        position:fixed; bottom:12px; left:50%; transform:translateX(-50%);
        background:#B71C1C; color:#fff; padding:10px 16px; border-radius:8px;
        font-size:14px; z-index:99999; box-shadow:0 6px 20px rgba(0,0,0,.4);
      `;
      document.body.appendChild(box);
      setTimeout(()=> box.remove(), 6000);
    }catch{}
  }

  // Intercept localStorage.setItem globally and queue a sync
  const _setItem = localStorage.setItem;
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

  // One-time initial sweep (in case there’s already data saved locally)
  function initialSweep(){
    try{
      for (let i=0; i<localStorage.length; i++){
        const k = localStorage.key(i);
        if (!k || !k.startsWith('fv_')) continue;
        try{
          const raw = localStorage.getItem(k);
          const parsed = JSON.parse(raw || '[]');
          if (Array.isArray(parsed) && parsed.length){
            pending.set(k, parsed);
          }
        }catch{}
      }
      if (pending.size) scheduleFlush();
    }catch{}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialSweep, { once:true });
  } else {
    initialSweep();
  }
})();