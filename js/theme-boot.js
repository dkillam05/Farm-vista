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

// === Full-App Firestore Sync (localStorage ⇄ Firestore) ===
// Startup is QUIET (banner only). Spinner shows ONLY on user saves.
(function(){
  // Kill-switch: disable sync entirely if ?nosync=1 or localStorage flag present
  try{
    const qs = new URLSearchParams(location.search);
    if (qs.get('nosync') === '1' || localStorage.getItem('fv:sync:disabled') === '1'){
      console.warn('[FV] Sync disabled by flag.');
      return;
    }
  }catch{}

  // Timings
  const MIN_SPIN_MS = 2000;
  const MAX_SPIN_MS = 20000;
  let uiReady = false, spinnerShownAt = 0, minTimer = null, maxTimer = null, backoffTimer = null;
  let backoffMs = 1200; const BACKOFF_MAX = 20000;

  // UI
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
      .fv-sync-bar{position:fixed;left:0;right:0;bottom:0;background:#1d1f1e;color:#fff;border-top:1px solid #2a2e2b;
        padding:10px 14px;z-index:99999;display:none;font:500 14px system-ui,sans-serif;white-space:nowrap;overflow:hidden;
        text-overflow:ellipsis;display:flex;align-items:center;justify-content:space-between}
      .fv-sync-bar.show{display:flex}
      .fv-sync-left{display:flex;align-items:center;gap:10px;min-width:0;overflow:hidden}
      .fv-sync-dot{width:10px;height:10px;border-radius:50%;background:#f6c73b;flex:0 0 auto}
      .fv-sync-ok{background:#2b8f4e}
      .fv-sync-text{overflow:hidden;text-overflow:ellipsis}
      .fv-sync-btn{appearance:none;border:1px solid #3b7e46;background:#3b7e46;color:#fff;border-radius:10px;padding:6px 12px;font-weight:700;cursor:pointer;flex:0 0 auto}
    `;
    document.head.appendChild(css);

    const overlay = document.createElement('div');
    overlay.className = 'fv-sync-overlay';
    overlay.innerHTML = `<div class="fv-sync-spinner" aria-label="Syncing"></div>`;
    document.body.appendChild(overlay);

    const bar = document.createElement('div');
    bar.className = 'fv-sync-bar';
    bar.innerHTML = `
      <div class="fv-sync-left">
        <span class="fv-sync-dot"></span>
        <span class="fv-sync-text">Still syncing… we’ll keep trying.</span>
      </div>
      <button class="fv-sync-btn" type="button">Retry now</button>
    `;
    document.body.appendChild(bar);

    const btn = bar.querySelector('.fv-sync-btn');
    btn.addEventListener('click', ()=> {
      backoffMs = 1200;
      showSpinner();          // foreground on manual retry
      scheduleFlush(true);
    });

    window.__FV_SYNC_UI__ = {
      overlay, bar,
      setBarState(ok, msg){
        const dot = bar.querySelector('.fv-sync-dot');
        const txt = bar.querySelector('.fv-sync-text');
        if (ok){
          dot.classList.add('fv-sync-ok'); txt.textContent = 'Synced';
          setTimeout(()=>{ bar.classList.remove('show'); dot.classList.remove('fv-sync-ok'); }, 1200);
        }else{
          dot.classList.remove('fv-sync-ok');
          txt.textContent = msg || (navigator.onLine ? 'Still syncing… we’ll keep trying.' : 'Offline — will sync when back online.');
          bar.classList.add('show');
        }
      }
    };
  }

  function showSpinner(){
    ensureUI();
    const ui = window.__FV_SYNC_UI__;
    spinnerShownAt = Date.now();
    ui.overlay.classList.add('show');
    clearTimeout(minTimer); clearTimeout(maxTimer);
    minTimer = setTimeout(()=>{}, MIN_SPIN_MS);
    maxTimer = setTimeout(()=>{ ui.overlay.classList.remove('show'); ui.setBarState(false); }, MAX_SPIN_MS);
  }
  function hideSpinnerIfAllowed(){
    const ui = window.__FV_SYNC_UI__; if (!ui) return;
    const elapsed = Date.now() - spinnerShownAt;
    const doHide = () => ui.overlay.classList.remove('show');
    if (!ui.overlay.classList.contains('show')) return;
    if (elapsed >= MIN_SPIN_MS) doHide(); else setTimeout(doHide, MIN_SPIN_MS - elapsed);
  }
  function showBar(msg){ ensureUI(); window.__FV_SYNC_UI__.setBarState(false, msg); }
  function showSynced(){ ensureUI(); window.__FV_SYNC_UI__.setBarState(true); }

  // Conventions
  function keyToCollection(lsKey){
    if (!lsKey || typeof lsKey !== 'string' || !lsKey.startsWith('fv_')) return null;
    let s = lsKey.replace(/^fv_/, '');
    s = s.replace(/^(setup|contacts|calc|pages|app|settings|data)_/, '');
    s = s.replace(/_v\d+$/, '');
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
  function normalizeItem(it){ const o = {...(it||{})}; if (!o.id) o.id = String(o.t || Date.now()); return o; }
  function sortNewestFirst(rows){
    rows.sort((a,b)=>{
      const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : (+a.createdAt || 0);
      const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : (+b.createdAt || 0);
      return tb - ta;
    });
  }

  // Echo control + edit window
  const _setItem = localStorage.setItem;
  let   MUTED_SETITEM = false;
  const lastLocalEditAt = new Map();
  const EDIT_WIN_MS = 800;

  // Pending queue
  const pending = new Map();
  let flushTimer = null;
  let foregroundFlush = false; // <— only true when user edited

  function scheduleFlush(immediate){
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, immediate ? 0 : 250);
  }

  // Wait for auth before writing
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
    }catch(e){ showBar('Auth not ready'); }
  }

  // Intercept local writes — this is considered **foreground** (user save)
  localStorage.setItem = function(key, val){
    try { _setItem.apply(this, arguments); } catch {}
    try{
      if (typeof key === 'string' && key.startsWith('fv_') && typeof val === 'string'){
        if (MUTED_SETITEM) return;
        const coll = keyToCollection(key);
        if (coll) lastLocalEditAt.set(coll, Date.now());
        const parsed = JSON.parse(val);
        pending.set(key, parsed);

        foregroundFlush = true;  // user action
        showSpinner();           // only show overlay for foreground
        scheduleFlush(true);
      }
    }catch{}
  };

  async function flush(){
    if (!pending.size){
      if (foregroundFlush) hideSpinnerIfAllowed(); // only hide spinner if we showed it
      showSynced(); // hides banner shortly after
      FV.announce('sync:idle');
      foregroundFlush = false;
      backoffMs = 1200;
      return;
    }
    FV.announce('sync:active');

    ensureAuthThen(async (env)=>{
      const { auth, db } = env;
      const user = auth.currentUser; if (!user || !db){
        if (foregroundFlush) showSpinner(); else showBar(!user ? 'Sign in to sync' : 'Database not ready');
        return rescheduleBackoff();
      }

      let f;
      try{ f = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js'); }
      catch{ if (foregroundFlush) showSpinner(); else showBar('Network / SDK load failed'); return rescheduleBackoff(); }

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
              ...it, uid: user.uid,
              updatedAt: f.serverTimestamp(),
              createdAt: it.createdAt || f.serverTimestamp(),
            }, { merge: true });
          }
          touched.add(coll);
        }catch(err){
          hadError = true;
          const code = (err && (err.code || err.message)) || 'write failed';
          showBar(code.includes('permission') ? 'Permission denied' : String(code));
        }
      }

      if (touched.size){
        try{
          const list = Array.from(touched);
          const regRef = f.doc(f.collection(db, '_sync'), 'collections');
          const { arrayUnion, setDoc } = f;
          await setDoc(regRef, { list: arrayUnion(...list) }, { merge: true });
        }catch(_){}
      }

      if (hadError || pending.size){
        if (foregroundFlush) showSpinner(); else showBar();
        rescheduleBackoff();
      } else {
        if (foregroundFlush) hideSpinnerIfAllowed();
        showSynced();
        FV.announce('sync:idle');
        foregroundFlush = false;
        backoffMs = 1200;
      }
    });
  }

  function rescheduleBackoff(){
    clearTimeout(backoffTimer);
    backoffTimer = setTimeout(()=>{
      scheduleFlush(true);
      backoffMs = Math.min(Math.floor(backoffMs * 1.8), BACKOFF_MAX);
    }, backoffMs);
  }

  // Startup upsync sweep is **quiet** (no overlay)
  function initialUpsyncSweep(){
    try{
      for (let i=0;i<localStorage.length;i++){
        const k = localStorage.key(i); const coll = keyToCollection(k); if (!coll) continue;
        try{
          const raw = localStorage.getItem(k); const parsed = JSON.parse(raw || '[]');
          if (Array.isArray(parsed) && parsed.length) pending.set(k, parsed);
        }catch{}
      }
      if (pending.size) { foregroundFlush = false; scheduleFlush(true); }
    }catch{}
  }

  // Downsync (listeners) — quiet
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
          if (Date.now() - t < EDIT_WIN_MS) return;

          const rows = [];
          snap.forEach(doc => rows.push({ id: doc.id, ...doc.data() }));
          sortNewestFirst(rows);

          const keys = collectionToLikelyKeys(coll);
          try{
            MUTED_SETITEM = true;
            keys.forEach(k => _setItem.call(localStorage, k, JSON.stringify(rows)));
          }finally{ MUTED_SETITEM = false; }
        }, (err)=>{
          const code = (err && (err.code || err.message)) || 'read failed';
          showBar(String(code));
        });
      }

      subscribeFor.forEach(startColl);

      const regRef = f.doc(f.collection(db, '_sync'), 'collections');
      f.onSnapshot(regRef, (snap)=>{
        const data = snap.exists() ? snap.data() : {};
        const list = Array.isArray(data.list) ? data.list : [];
        list.forEach(c => startColl(typeof c === 'string' ? c.trim() : ''));
      });
    }catch(e){ showBar('Listener failed'); }
  }

  // Flush on leave (quiet)
  function attachVisibilityFlush(){
    try{
      window.addEventListener('pagehide', ()=> scheduleFlush(true), { passive:true });
      window.addEventListener('beforeunload', ()=> scheduleFlush(true), { passive:true });
      document.addEventListener('visibilitychange', ()=>{ if (document.visibilityState === 'hidden') scheduleFlush(true); });
    }catch{}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialUpsyncSweep, { once:true });
    document.addEventListener('DOMContentLoaded', hydrateAndListen, { once:true });
    document.addEventListener('DOMContentLoaded', attachVisibilityFlush, { once:true });
  } else {
    initialUpsyncSweep();
    hydrateAndListen();
    attachVisibilityFlush();
  }
})();