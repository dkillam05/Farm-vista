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

// === Theme preference boot ===
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
    s.type = 'module'; s.defer = true; s.src = '/Farm-vista/js/firebase-init.js';
    document.head.appendChild(s);
    s.addEventListener('load', ()=> console.log('[FV] firebase-init loaded'));
    s.addEventListener('error', ()=> console.warn('[FV] firebase-init failed to load — check path'));
  }catch(e){ console.warn('[FV] Firebase boot error:', e); }
})();

// === Auth Guard (all pages) ===
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

// === User Ready Broadcast (prevents placeholder flash) ===
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

// === Firestore Heartbeat (diagnostics only if broken) ===
(function(){
  const OWNER_UID = "zD2ssHGNE6RmBSqAyg8r3s3tBKl2"; // harmless check; doesn’t block
  async function checkFirestore(){
    try{
      const mod = await import('/Farm-vista/js/firebase-init.js'); await mod.ready;
      const { app, auth, db } = mod;
      if (!app || !auth || !db) throw new Error('Missing Firebase core');
      const user = auth.currentUser; if (!user) throw new Error('No signed-in user');
      if (user.uid !== OWNER_UID) console.warn('[FV] Firestore heartbeat: non-owner', user.email || user.uid);
      const { getDoc, doc } = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
      const ref = doc(db, '_heartbeat', 'ping'); await getDoc(ref);
      console.log('[FV] ✅ Firestore connection OK');
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
      document.body.appendChild(box); setTimeout(()=> box.remove(), 6000);
    }catch{}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', checkFirestore, {once:true}); else checkFirestore();
})();

// === Full-App Firestore Sync (localStorage ⇄ Firestore, echo-safe, guardrails, no indexes required) ===
(function(){
  // ----- Conventions & helpers -----
  function keyToCollection(lsKey){
    // fv_[optional category]_name[_vN]
    if (!lsKey || typeof lsKey !== 'string' || !lsKey.startsWith('fv_')) return null;
    let s = lsKey.replace(/^fv_/, '');
    s = s.replace(/^(setup|contacts|calc|pages|app|settings|data)_/, ''); // drop one optional category
    s = s.replace(/_v\d+$/, '');                                        // drop version suffix
    return s || null;
  }
  function collectionToLikelyKeys(coll){
    const out = new Set([`fv_${coll}_v1`, `fv_setup_${coll}_v1`, `fv_contacts_${coll}_v1`]);
    try{
      for (let i=0;i<localStorage.length;i++){
        const k = localStorage.key(i);
        if (keyToCollection(k) === coll) out.add(k);
      }
    }catch{}
    return Array.from(out);
  }
  function normalizeItem(it){
    if (!it || typeof it !== 'object') return {};
    const out = { ...it };
    if (!out.id) out.id = String(out.t || Date.now()); // stable id if page didn’t set one
    return out;
  }
  function sortNewestFirst(rows){
    rows.sort((a,b)=>{
      const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : (+a.createdAt || 0);
      const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : (+b.createdAt || 0);
      return tb - ta;
    });
  }
  function diag(msg){
    try{
      const box = document.createElement('div');
      box.textContent = '[FV] Firestore sync error: ' + msg;
      box.style.cssText = `
        position:fixed; bottom:12px; left:50%; transform:translateX(-50%);
        background:#B71C1C; color:#fff; padding:10px 16px; border-radius:8px;
        font-size:14px; z-index:99999; box-shadow:0 6px 20px rgba(0,0,0,.4);
      `;
      document.body.appendChild(box); setTimeout(()=> box.remove(), 6000);
    }catch{}
  }

  // ----- Echo control & edit window -----
  const _setItem = localStorage.setItem; // keep original
  let   MUTED_SETITEM = false;           // prevents echo during cloud→local writes
  const lastLocalEditAt = new Map();     // coll -> timestamp of last local write we saw
  const EDIT_WIN_MS = 800;               // ignore cloud snapshots briefly after a local edit

  // ----- UPSYNC (local → Firestore) -----
  const pending = new Map(); // lsKey -> latest array
  let flushTimer = null;
  function scheduleFlush(){ clearTimeout(flushTimer); flushTimer = setTimeout(flush, 250); }

  localStorage.setItem = function(key, val){
    // Always perform the real write
    try { _setItem.apply(this, arguments); } catch {}
    try{
      if (typeof key === 'string' && key.startsWith('fv_') && typeof val === 'string'){
        // If this was a cloud write, we’re muted and we do NOT upsync
        if (MUTED_SETITEM) return;

        // Record edit time by collection, for snapshot suppression
        const coll = keyToCollection(key);
        if (coll) lastLocalEditAt.set(coll, Date.now());

        // Queue upsync of the full array
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
      const mod = await import('/Farm-vista/js/firebase-init.js'); env = await mod.ready;
      if (!env || !env.auth || !env.db) throw new Error('Firebase not ready');
    }catch(e){ return diag('Firebase not ready for sync'); }

    const user = env.auth.currentUser; if (!user) return diag('No signed-in user for sync');

    let f;
    try{ f = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js'); }
    catch{ return diag('Failed to load Firestore SDK'); }

    for (const [lsKey, arr] of pending.entries()){
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
        console.log(`[FV] Synced ${list.length} items from ${lsKey} → ${coll}`);
      }catch(err){ diag(`Sync failed for ${coll}: ${err && err.message ? err.message : err}`); }
    }
  }

  function initialUpsyncSweep(){
    try{
      for (let i=0;i<localStorage.length;i++){
        const k = localStorage.key(i); const coll = keyToCollection(k); if (!coll) continue;
        try{
          const raw = localStorage.getItem(k); const parsed = JSON.parse(raw || '[]');
          if (Array.isArray(parsed) && parsed.length) pending.set(k, parsed);
        }catch{}
      }
      if (pending.size) scheduleFlush();
    }catch{}
  }

  // ----- DOWNSYNC (Firestore → local) -----
  async function hydrateAndListen(){
    try{
      const mod = await import('/Farm-vista/js/firebase-init.js'); const env = await mod.ready;
      const { auth, db } = env; if (!auth || !db) return;
      const user = auth.currentUser; if (!user) return;
      const f = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');

      const subscribeFor = new Set();

      // From existing localStorage keys
      try{
        for (let i=0;i<localStorage.length;i++){
          const k = localStorage.key(i); const c = keyToCollection(k); if (c) subscribeFor.add(c);
        }
      }catch{}

      const started = new Set();
      function startColl(coll){
        if (!coll || started.has(coll)) return;
        started.add(coll);

        // No orderBy -> no composite index needed; we sort client-side.
        const q = f.query(f.collection(db, coll), f.where('uid','==', user.uid));

        f.onSnapshot(q, (snap)=>{
          // Respect recent local edit (edit-wins window)
          const t = lastLocalEditAt.get(coll) || 0;
          if (Date.now() - t < EDIT_WIN_MS) return; // skip this snapshot; next one will apply

          const rows = [];
          snap.forEach(doc => rows.push({ id: doc.id, ...doc.data() }));
          sortNewestFirst(rows);

          // Hydrate-if-empty per key: only overwrite if key is empty OR we’re not within edit window
          const keys = collectionToLikelyKeys(coll);
          try{
            MUTED_SETITEM = true; // prevent echo while we write localStorage
            keys.forEach(k => {
              try{
                const cur = JSON.parse(localStorage.getItem(k) || '[]');
                const isEmpty = !Array.isArray(cur) || cur.length === 0;
                if (isEmpty || Date.now() - (lastLocalEditAt.get(coll)||0) >= EDIT_WIN_MS){
                  _setItem.call(localStorage, k, JSON.stringify(rows));
                }
              }catch{
                _setItem.call(localStorage, k, JSON.stringify(rows));
              }
            });
          }finally{
            MUTED_SETITEM = false;
          }
        }, (err)=>{ diag(`Live read failed for ${coll}: ${err && err.message ? err.message : err}`); });
      }

      // Start listeners for what we already know
      subscribeFor.forEach(startColl);

      // Optional registry to pre-enable more collections without any local save
      const regRef = f.doc(f.collection(db, '_sync'), 'collections');
      f.onSnapshot(regRef, (snap)=>{
        const data = snap.exists() ? snap.data() : {};
        const list = Array.isArray(data.list) ? data.list : [];
        list.forEach(c => startColl(typeof c === 'string' ? c.trim() : ''));
      }, ()=>{ /* ignore errors; heartbeat/upsync will surface core issues */ });

    }catch(e){ /* silent */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialUpsyncSweep, { once:true });
    document.addEventListener('DOMContentLoaded', hydrateAndListen, { once:true });
  } else {
    initialUpsyncSweep();
    hydrateAndListen();
  }
})();