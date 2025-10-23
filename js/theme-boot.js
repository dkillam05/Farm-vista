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

// === Full-App Firestore Sync (localStorage ⇄ Firestore) + Spinner & Status Bar ===
(function(){
  // --- Tweakable timings ---
  const MIN_SPIN_MS = 2000;   // spinner shows at least this long
  const MAX_SPIN_MS = 20000;  // after this, switch to sticky "Still syncing..." bar

  // --- UI: overlay spinner + sticky status bar ---
  let uiReady = false, spinnerShownAt = 0, minTimer = null, maxTimer = null, backoffTimer = null;
  let backoffMs = 1200; const BACKOFF_MAX = 15000;
  function ensureUI(){
    if (uiReady) return;
    uiReady = true;
    const css = document.createElement('style');
    css.textContent = `
      .fv-sync-overlay{position:fixed;inset:0;background:rgba(0,0,0,.35);display:none;z-index:99998}
      .fv-sync-overlay.show{display:block}
      .fv-sync-spinner{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:60px;height:60px;border-radius:50%;
        border:6px solid rgba(255,255,255,.4);border-top-color:#fff;animation:fvspin 1s linear infinite}
      @keyframes fvspin{to{transform:translate(-50%,-50%) rotate(360deg)}}

      .fv-sync-bar{position:fixed;left:50%;transform:translateX(-50%);bottom:18px;background:#1d1f1e;color:#fff;border:1px solid #2a2e2b;
        border-radius:12px;padding:10px 14px;display:none;z-index:99999;box-shadow:0 10px 24px rgba(0,0,0,.35);font:500 14px system-ui,sans-serif}
      .fv-sync-bar.show{display:flex;gap:12px;align-items:center}
      .fv-sync-btn{appearance:none;border:1px solid #3b7e46;background:#3b7e46;color:#fff;border-radius:10px;padding:6px 10px;font-weight:700;cursor:pointer}
      .fv-sync-dot{width:10px;height:10px;border-radius:50%;background:#f6c73b;display:inline-block;margin-right:8px}
      .fv-sync-ok{background:#2b8f4e}
    `;
    document.head.appendChild(css);

    const overlay = document.createElement('div');
    overlay.className = 'fv-sync-overlay';
    overlay.innerHTML = `<div class="fv-sync-spinner" aria-label="Syncing"></div>`;
    document.body.appendChild(overlay);

    const bar = document.createElement('div');
    bar.className = 'fv-sync-bar';
    bar.innerHTML = `<span class="fv-sync-dot"></span><span class="fv-sync-text">Still syncing… we’ll keep trying.</span><button class="fv-sync-btn" type="button">Retry now</button>`;
    document.body.appendChild(bar);

    const btn = bar.querySelector('.fv-sync-btn');
    btn.addEventListener('click', ()=> { backoffMs = 1200; scheduleFlush(true); });

    // expose for helpers
    window.__FV_SYNC_UI__ = {
      overlay, bar,
      setBarState(ok){
        const dot = bar.querySelector('.fv-sync-dot'), txt = bar.querySelector('.fv-sync-text');
        if (ok){
          dot.classList.add('fv-sync-ok');
          txt.textContent = 'Synced.';
          setTimeout(()=>{ bar.classList.remove('show'); dot.classList.remove('fv-sync-ok'); }, 1200);
        } else {
          dot.classList.remove('fv-sync-ok');
          txt.textContent = navigator.onLine ? 'Still syncing… we’ll keep trying.' : 'Offline — will sync when back online.';
        }
      }
    };
  }
  function showSpinner(){
    ensureUI();
    const ui = window.__FV_SYNC_UI__;
    if (!ui) return;
    spinnerShownAt = Date.now();
    ui.overlay.classList.add('show');
    clearTimeout(minTimer); clearTimeout(maxTimer);
    minTimer = setTimeout(()=>{}, MIN_SPIN_MS);
    maxTimer = setTimeout(()=>{
      // hard stop overlay; show sticky bar and keep retrying
      ui.overlay.classList.remove('show');
      ui.setBarState(false);
      ui.bar.classList.add('show');
    }, MAX_SPIN_MS);
  }
  function hideSpinnerIfAllowed(){
    const ui = window.__FV_SYNC_UI__; if (!ui) return;
    const elapsed = Date.now() - spinnerShownAt;
    const doHide = () => ui.overlay.classList.remove('show');
    if (!ui.overlay.classList.contains('show')) return;
    if (elapsed >= MIN_SPIN_MS) doHide(); else setTimeout(doHide, MIN_SPIN_MS - elapsed);
  }
  function hideBarAsSynced(){
    const ui = window.__FV_SYNC_UI__; if (!ui) return;
    if (ui.bar.classList.contains('show')){
      ui.setBarState(true);
    }
  }

  // --- Conventions & helpers for datasets ---
  function keyToCollection(lsKey){
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
        const k = localStorage.key(i); if (keyToCollection(k) === coll) out.add(k);
      }
    }catch{}
    return Array.from(out);
  }
  function normalizeItem(it){
    if (!it || typeof it !== 'object') return {};
    const out = { ...it };
    if (!out.id) out.id = String(out.t || Date.now());
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

  // --- Echo control & edit window ---
  const _setItem = localStorage.setItem; // original
  let   MUTED_SETITEM = false;
  const lastLocalEditAt = new Map(); // coll -> timestamp
  const EDIT_WIN_MS = 800;

  // --- UPSYNC (local → Firestore) with immediate spinner + retries ---
  const pending = new Map(); // lsKey -> latest array
  let flushTimer = null;

  function scheduleFlush(immediate){
    clearTimeout(flushTimer);
    if (immediate) flushTimer = setTimeout(flush, 0);
    else flushTimer = setTimeout(flush, 250);
  }

  // Auth wait util
  let waitingForAuthFlush = false;
  async function ensureAuthThen(fn){
    try{
      const mod = await import('/Farm-vista/js/firebase-init.js'); const env = await mod.ready;
      const { auth } = env;
      if (auth.currentUser) return fn(env);
      if (waitingForAuthFlush) return;
      waitingForAuthFlush = true;
      const { onAuthStateChanged } = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js');
      onAuthStateChanged(auth, (u)=>{ if (u){ waitingForAuthFlush = false; fn(env); } }, { onlyOnce:true });
    }catch(e){ diag('Auth not ready'); }
  }

  localStorage.setItem = function(key, val){
    // Perform the real write
    try { _setItem.apply(this, arguments); } catch {}
    try{
      if (typeof key === 'string' && key.startsWith('fv_') && typeof val === 'string'){
        if (MUTED_SETITEM) return; // skip cloud→local echoes
        const coll = keyToCollection(key);
        if (coll) lastLocalEditAt.set(coll, Date.now());
        const parsed = JSON.parse(val);
        pending.set(key, parsed);

        // user just saved -> show spinner immediately and flush asap
        showSpinner();
        scheduleFlush(true);
      }
    }catch{}
  };

  async function flush(){
    if (!pending.size){
      // queue is empty -> synced
      hideSpinnerIfAllowed();
      hideBarAsSynced();
      FV.announce('sync:idle');
      backoffMs = 1200;
      return;
    }
    FV.announce('sync:active');

    ensureAuthThen(async (env)=>{
      const { auth, db } = env;
      const user = auth.currentUser; if (!user || !db){ // try again soon
        showSpinner();
        rescheduleBackoff();
        return;
      }

      let f;
      try{ f = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js'); }
      catch{
        // SDK failed to load (offline?) -> retry with backoff
        showSpinner();
        rescheduleBackoff();
        return;
      }

      const touched = new Set();
      let hadError = false;

      for (const [lsKey, arr] of Array.from(pending.entries())){
        pending.delete(lsKey);
        const coll = keyToCollection(lsKey);
        if (!coll) continue;

        try{
          const list = Array.isArray(arr) ? arr : [];
          for (const raw of list){
            const it = normalizeItem(raw);
            const ref = f.doc(f.collection(db, coll), it.id);
            await f.setDoc(ref, {
              ...it,
              uid: user.uid,
              updatedAt: f.serverTimestamp(),
              createdAt: it.createdAt || f.serverTimestamp(),
            }, { merge: true });
          }
          touched.add(coll);
          console.log(`[FV] Synced ${list.length} items from ${lsKey} → ${coll}`);
        }catch(err){
          hadError = true;
          diag(`Sync failed for ${coll}: ${err && err.message ? err.message : err}`);
        }
      }

      // Register touched collections so other devices downsync automatically
      if (touched.size){
        try{
          const list = Array.from(touched);
          const regRef = f.doc(f.collection(db, '_sync'), 'collections');
          const { arrayUnion, setDoc } = f;
          await setDoc(regRef, { list: arrayUnion(...list) }, { merge: true });
        }catch(_){}
      }

      if (hadError || pending.size){
        // something left or went wrong -> keep trying
        showSpinner();
        rescheduleBackoff();
      } else {
        // success: queue empty
        hideSpinnerIfAllowed();
        hideBarAsSynced();
        FV.announce('sync:idle');
        backoffMs = 1200;
      }
    });
  }

  function rescheduleBackoff(){
    clearTimeout(backoffTimer);
    const ui = window.__FV_SYNC_UI__; ensureUI();
    if (ui){ ui.setBarState(false); }
    // show sticky bar if spinner already timed out
    if (ui && !ui.overlay.classList.contains('show')) ui.bar.classList.add('show');

    backoffTimer = setTimeout(()=>{
      scheduleFlush(true);
      backoffMs = Math.min(Math.floor(backoffMs * 1.8), BACKOFF_MAX);
    }, backoffMs);
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
      if (pending.size) { showSpinner(); scheduleFlush(true); }
    }catch{}
  }

  // --- DOWNSYNC (Firestore → local), full app ---
  async function hydrateAndListen(){
    try{
      const mod = await import('/Farm-vista/js/firebase-init.js'); const env = await mod.ready;
      const { auth, db } = env; if (!auth || !db) return;
      const user = auth.currentUser;
      if (!user){
        const { onAuthStateChanged } = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js');
        onAuthStateChanged(auth, ()=> hydrateAndListen(), { onlyOnce:true });
        return;
      }

      const f = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');

      const subscribeFor = new Set();
      try{
        for (let i=0;i<localStorage.length;i++){
          const k = localStorage.key(i); const c = keyToCollection(k); if (c) subscribeFor.add(c);
        }
      }catch{}

      const started = new Set();
      function startColl(coll){
        if (!coll || started.has(coll)) return;
        started.add(coll);

        const q = f.query(f.collection(db, coll), f.where('uid','==', user.uid));

        f.onSnapshot(q, (snap)=>{
          const t = lastLocalEditAt.get(coll) || 0;
          if (Date.now() - t < EDIT_WIN_MS) return; // let local change push first

          const rows = [];
          snap.forEach(doc => rows.push({ id: doc.id, ...doc.data() }));
          sortNewestFirst(rows);

          const keys = collectionToLikelyKeys(coll);
          try{
            MUTED_SETITEM = true; // prevent echo while writing localStorage
            keys.forEach(k => _setItem.call(localStorage, k, JSON.stringify(rows)));
          }finally{
            MUTED_SETITEM = false;
          }
        }, (err)=>{ diag(`Live read failed for ${coll}: ${err && err.message ? err.message : err}`); });
      }

      // Start for known keys
      subscribeFor.forEach(startColl);

      // Registry: auto-boot additional collections from other devices
      const regRef = f.doc(f.collection(db, '_sync'), 'collections');
      f.onSnapshot(regRef, (snap)=>{
        const data = snap.exists() ? snap.data() : {};
        const list = Array.isArray(data.list) ? data.list : [];
        list.forEach(c => startColl(typeof c === 'string' ? c.trim() : ''));
      }, ()=>{ /* ignore; upsync/heartbeat handle core errors */ });

    }catch(e){ /* silent */ }
  }

  // Init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialUpsyncSweep, { once:true });
    document.addEventListener('DOMContentLoaded', hydrateAndListen, { once:true });
  } else {
    initialUpsyncSweep();
    hydrateAndListen();
  }
})();