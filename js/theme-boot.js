// /Farm-vista/js/theme-boot.js  — viewport + theme + firebase boot + AUTH GUARD + USER CONTEXT WARM
// All internal paths are ABSOLUTE under /Farm-vista/ to avoid 404s on deep pages.

/* =========================  Viewport & tap behavior  ========================= */
(function(){
  try{
    var HARD_NO_ZOOM = true;
    var desired = HARD_NO_ZOOM
      ? 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover'
      : 'width=device-width, initial-scale=1, viewport-fit=cover';

    var m = document.querySelector('meta[name="viewport"]');
    if (m) m.setAttribute('content', desired);
    else {
      m = document.createElement('meta');
      m.name = 'viewport'; m.content = desired;
      if (document.head && document.head.firstChild) document.head.insertBefore(m, document.head.firstChild);
      else if (document.head) document.head.appendChild(m);
    }

    var style = document.createElement('style');
    style.textContent = `
      input, select, textarea, button { font-size: 16px !important; }
      a, button, .btn { -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
      html, body { touch-action: pan-x pan-y; }
    `;
    document.head.appendChild(style);
  }catch(e){}
})();

/* ==============================  Theme boot  ================================ */
(function(){
  try{
    var t = localStorage.getItem('fv-theme');        // 'light' | 'dark' | 'system'
    if(!t) return;
    document.documentElement.setAttribute('data-theme', t === 'system' ? 'auto' : t);
    document.documentElement.classList.toggle('dark',
      t === 'dark' ||
      (t === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
    );
  }catch(e){}
})();

/* =====================  Helpers for ordered script loads  ==================== */
const __fvBoot = (function(){
  const once = (key, fn) => {
    if (window[key]) return window[key];
    window[key] = fn();
    return window[key];
  };
  const loadScript = (src, {type, defer=true, async=false}) => new Promise((res, rej)=>{
    const s = document.createElement('script');
    if (type) s.type = type;
    s.defer = !!defer; s.async = !!async;
    s.src = src;
    s.onload = () => res();
    s.onerror = (e) => rej(e);
    document.head.appendChild(s);
  });
  const fire = (name, detail)=> {
    try{ document.dispatchEvent(new CustomEvent(name, { detail })); }catch{}
  };
  return { once, loadScript, fire };
})();

/* ==============  Firebase CONFIG -> INIT -> USER CONTEXT WARM  ============== */
(function(){
  __fvBoot.once('__FV_FIREBASE_CHAIN__', async () => {
    try{
      // 1) Ensure global config is present BEFORE loading firebase-init.js
      if (!window.FV_FIREBASE_CONFIG) {
        try {
          await __fvBoot.loadScript('/Farm-vista/js/firebase-config.js', { defer:false, async:false });
        } catch(e) {
          console.warn('[FV] firebase-config.js failed to load (continuing):', e);
        }
      }

      // 2) Load firebase-init.js as a module (once)
      if (!window.__FV_FIREBASE_INIT_LOADED__) {
        window.__FV_FIREBASE_INIT_LOADED__ = true;
        try {
          await __fvBoot.loadScript('/Farm-vista/js/firebase-init.js', { type:'module', defer:true });
          console.log('[FV] firebase-init loaded');
        } catch (e) {
          console.warn('[FV] firebase-init failed to load — check path /Farm-vista/js/firebase-init.js', e);
        }
      }

      // 3) App startup module (optional, safe if missing)
      if (!window.__FV_APP_STARTUP_LOADED__) {
        window.__FV_APP_STARTUP_LOADED__ = true;
        try {
          await __fvBoot.loadScript('/Farm-vista/js/app/startup.js', { type:'module', defer:true });
        } catch (e) {
          console.warn('[FV] startup module failed — check /Farm-vista/js/app/startup.js', e);
        }
      }

      // 4) USER CONTEXT: load and warm cached user/role/perms once per session.
      //    - Emits 'fv:user-ready' quickly (from cache), then re-emits after refresh.
      //    - Lets pages react immediately without waiting on Firestore every time.
      try{
        // Load the module once
        if (!window.__FV_USER_CONTEXT_LOADED__) {
          window.__FV_USER_CONTEXT_LOADED__ = true;
          await __fvBoot.loadScript('/Farm-vista/js/app/user-context.js', { type:'module', defer:true });
        }

        // If the module exposes a "get" method, fire a quick event with whatever is cached.
        if (window.FVUserContext && typeof window.FVUserContext.get === 'function') {
          const cached = window.FVUserContext.get();
          if (cached) __fvBoot.fire('fv:user-ready', { source:'cache', data: cached });
        }

        // Kick a warm refresh; when done, notify again so UIs can update.
        if (window.FVUserContext && typeof window.FVUserContext.refresh === 'function') {
          const data = await window.FVUserContext.refresh({ warm:true }); // warm: use cache first, then fetch
          __fvBoot.fire('fv:user-ready', { source:'refresh', data });
        }
      }catch(e){
        console.warn('[FV] user-context warm failed (non-fatal):', e);
      }

    }catch(e){
      console.warn('[FV] Firebase boot chain error:', e);
    }
  });
})();

/* ===============================  Auth Guard  =============================== */
/*
 RULES (relaxed):
  - Login page is PUBLIC.
  - Other pages require Auth, but:
      • We trust FVUserContext's "session locker" to smooth over transient nulls.
      • We only redirect to login when there is NO auth user AND NO user-context uid.
  - Optional Firestore-gating toggles below (still off by default).
  - In stub/dev, we allow by default to prevent bounce-loops.
*/
(function(){
  const REQUIRE_FIRESTORE_USER_DOC = false;
  const TREAT_MISSING_DOC_AS_DENY  = false;
  const ALLOW_STUB_MODE            = true;

  const FIELD_DISABLED = 'disabled';
  const FIELD_ACTIVE   = 'active';

  const samePath = (a, b) => {
    try {
      const ua = new URL(a, location.href);
      const ub = new URL(b, location.href);
      return ua.pathname === ub.pathname && ua.search === ub.search && ua.hash === ub.hash;
    } catch { return a === b; }
  };

  const isLoginPath = () => {
    const cur = location.pathname.endsWith('/') ? location.pathname : (location.pathname + '/');
    return cur.startsWith('/Farm-vista/pages/login/');
  };

  const getUserContextSnapshot = () => {
    try {
      if (window.FVUserContext && typeof window.FVUserContext.get === 'function') {
        return window.FVUserContext.get();
      }
    } catch {}
    return null;
  };

  const gotoLogin = (reason) => {
    const here = location.pathname + location.search + location.hash;
    const url = new URL('/Farm-vista/pages/login/index.html', location.origin);
    url.searchParams.set('next', here);
    if (reason) url.searchParams.set('reason', reason);
    const dest = url.pathname + url.search + url.hash;
    if (!samePath(location.href, dest)) location.replace(dest);
  };

  const waitForAuthHydration = async (mod, auth, ms=3000) => {
    return new Promise((resolve) => {
      let settled = false;
      const done = (u)=>{ if(!settled){ settled=true; resolve(u); } };
      try {
        if (auth && auth.currentUser) return done(auth.currentUser);
        const off = mod.onAuthStateChanged(auth, u => { done(u); off && off(); });
        setTimeout(()=> done(auth && auth.currentUser || null), ms);
      } catch {
        resolve(auth && auth.currentUser || null);
      }
    });
  };

  const run = async () => {
    try {
      if (isLoginPath()) return;

      const mod = await import('/Farm-vista/js/firebase-init.js');
      const ctx = await mod.ready;
      const isStub = (mod.isStub && mod.isStub()) || false;
      const auth = (ctx && ctx.auth) || window.firebaseAuth || null;

      // In stub/dev, never bounce
      if (isStub && ALLOW_STUB_MODE) return;

      // If we can't even get an auth instance, only bounce if there's also no user-context
      if (!auth) {
        const uc = getUserContextSnapshot();
        if (uc && uc.uid) {
          console.warn('[FV] Auth guard: no auth instance, but user-context has uid — allowing page.');
          return;
        }
        gotoLogin('no-auth');
        return;
      }

      // Make sure persistence is local, but don't die if it fails
      try {
        if (mod.setPersistence && mod.browserLocalPersistence) {
          await mod.setPersistence(auth, mod.browserLocalPersistence());
        }
      } catch (e) {
        console.warn('[FV] setPersistence failed:', e);
      }

      const user = await waitForAuthHydration(mod, auth, 3000);

      if (!user) {
        // No auth user — trust FVUserContext "session locker" before bouncing
        const uc = getUserContextSnapshot();
        if (uc && uc.uid) {
          // We treat this as an in-progress refresh / transient null; stay on page.
          console.warn('[FV] Auth guard: no live user, but user-context has uid — treating as signed-in.');
          return;
        }
        // Truly no auth and no session context → redirect to login
        gotoLogin('unauthorized');
        return;
      }

      // At this point we have an auth user; optional Firestore gating
      if (!REQUIRE_FIRESTORE_USER_DOC && !TREAT_MISSING_DOC_AS_DENY) return;

      try {
        const db  = mod.getFirestore();
        const ref = mod.doc(db, 'users', user.uid);
        const snap = await mod.getDoc(ref);

        if (!snap.exists()) {
          if (REQUIRE_FIRESTORE_USER_DOC && TREAT_MISSING_DOC_AS_DENY) {
            try { await mod.signOut(auth); } catch {}
            gotoLogin('no-user-doc');
          }
          return;
        }

        const u = snap.data() || {};
        const denied =
          (FIELD_DISABLED in u && !!u[FIELD_DISABLED]) ||
          (FIELD_ACTIVE in u && u[FIELD_ACTIVE] === false);

        if (denied) {
          try { await mod.signOut(auth); } catch {}
          gotoLogin('disabled');
          return;
        }
      } catch (err) {
        console.warn('[FV] Firestore auth check failed:', err);
        if (REQUIRE_FIRESTORE_USER_DOC && TREAT_MISSING_DOC_AS_DENY) {
          try { await mod.signOut(auth); } catch {}
          gotoLogin('auth-check-failed');
        }
      }
    } catch (e) {
      console.warn('[FV] auth-guard error (non-fatal, using soft behavior):', e);
      // On guard errors now, prefer to stay on page if we have any user-context hint
      if (isLoginPath()) return;
      const uc = getUserContextSnapshot();
      if (uc && uc.uid) {
        console.warn('[FV] Auth guard: error occurred, but user-context has uid — not redirecting.');
        return;
      }
      gotoLogin('guard-error');
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once:true });
  } else {
    run();
  }
})();

/* =======================  GLOBAL COMBO UPGRADER (INLINE)  ======================= */
/* Converts EVERY <select> (except data-fv-native="true") into the same
   "buttonish + floating panel" combo used on your working page. No page edits. */
(function(){
  try{
    // Minimal styles to mimic the good page
    const style = document.createElement('style');
    style.textContent = `
    :root{
      --combo-gap:4px; --combo-radius:12px; --combo-btn-radius:10px;
      --combo-shadow:0 12px 26px rgba(0,0,0,.18);
      --combo-item-pad:10px 8px; --combo-max-h:50vh;
    }
    .fv-field{ position:relative }
    .fv-buttonish{
      width:100%; font:inherit; font-size:16px; color:var(--text);
      background:var(--card-surface,var(--surface)); border:1px solid var(--border);
      border-radius:var(--combo-btn-radius); padding:12px; outline:none;
      cursor:pointer; text-align:left; position:relative; padding-right:42px;
    }
    .fv-buttonish.has-caret::after{
      content:""; position:absolute; right:14px; top:50%; width:0; height:0;
      border-left:6px solid transparent; border-right:6px solid transparent;
      border-top:7px solid var(--muted,#67706B); transform:translateY(-50%);

      pointer-events:none;
    }
    .fv-combo{ position:relative }
    .fv-combo .fv-anchor{ position:relative; display:inline-block; width:100%; }
    .fv-panel{
      position:absolute; left:0; right:0; top:calc(100% + var(--combo-gap));
      background:var(--surface); border:1px solid var(--border); border-radius:var(--combo-radius);
      box-shadow:var(--combo-shadow); z-index:9999; padding:8px; display:none;
    }
    .fv-panel.show{ display:block }
    .fv-panel .fv-search{ padding:4px 2px 8px }
    .fv-panel .fv-search input{
      width:100%; padding:10px; border:1px solid var(--border); border-radius:var(--combo-btn-radius);
      background:var(--card-surface,var(--surface)); color:var(--text);
    }
    .fv-panel .fv-list{ max-height:var(--combo-max-h); overflow:auto; border-top:1px solid var(--border) }
    .fv-item{ padding:var(--combo-item-pad); border-bottom:1px solid var(--border); cursor:pointer }
    .fv-item:hover{ background:rgba(0,0,0,.04) }
    .fv-item:last-child{ border-bottom:none }
    .fv-empty{ padding:var(--combo-item-pad); color:#67706B }
    `;
    document.head.appendChild(style);

    function closeAll(except=null){
      document.querySelectorAll('.fv-panel.show').forEach(p=>{ if(p!==except) p.classList.remove('show'); });
    }
    document.addEventListener('click', ()=> closeAll());
    document.addEventListener('keydown', e=>{ if(e.key==='Escape') closeAll(); });

    function upgradeSelect(sel){
      if (sel._fvUpgraded || sel.matches('[data-fv-native="true"]')) return;
      // Skip hidden or display:none containers to avoid layout jumps
      const cs = window.getComputedStyle(sel);
      if (cs.display === 'none' || cs.visibility === 'hidden') { return; }

      sel._fvUpgraded = true;
      const searchable = String(sel.dataset.fvSearch||'').toLowerCase()==='true';
      const placeholder = sel.getAttribute('placeholder') || (sel.options[0]?.text ?? '— Select —');

      // Hide the real select but keep it in the DOM for forms and change events
      sel.style.position='absolute'; sel.style.opacity='0';
      sel.style.pointerEvents='none'; sel.style.width='0'; sel.style.height='0';
      sel.tabIndex = -1;

      const field = document.createElement('div'); field.className='fv-field fv-combo';
      const anchor = document.createElement('div'); anchor.className='fv-anchor';

      const btn = document.createElement('button'); btn.type='button';
      btn.className='fv-buttonish has-caret'; btn.textContent=placeholder;

      const panel = document.createElement('div'); panel.className='fv-panel';
      panel.setAttribute('role','listbox'); panel.setAttribute('aria-label', sel.getAttribute('aria-label') || sel.name || 'List');

      const list = document.createElement('div'); list.className='fv-list';

      if (searchable) {
        const sWrap=document.createElement('div'); sWrap.className='fv-search';
        const sInput=document.createElement('input'); sInput.type='search'; sInput.placeholder='Search…';
        sWrap.appendChild(sInput); panel.appendChild(sWrap);
        sInput.addEventListener('input', ()=> render(sInput.value));
      }

      panel.appendChild(list);
      anchor.append(btn,panel);

      // Insert combo before select; keep select inside for semantics
      sel.parentNode.insertBefore(field, sel);
      field.appendChild(anchor);
      field.appendChild(sel);

      let items=[];
      function readItems(){
        items = Array.from(sel.options).map((opt, idx)=>({
          id:String(idx), value:opt.value, label:opt.text, disabled:opt.disabled, hidden:opt.hidden
        })).filter(x=>!x.hidden);
      }
      function render(q=''){
        const qq=(q||'').toLowerCase();
        const vis = items.filter(x=>!qq || x.label.toLowerCase().includes(qq) || x.value.toLowerCase().includes(qq))
                         .filter(x=>!x.disabled);
        list.innerHTML = vis.length
          ? vis.map(x=>`<div class="fv-item" data-id="${x.id}">${x.label}</div>`).join('')
          : `<div class="fv-empty">(no matches)</div>`;
      }
      function open(){
        closeAll(panel);
        panel.classList.add('show');
        render('');
        const s = panel.querySelector('.fv-search input'); if (s){ s.value=''; s.focus(); }
      }
      function close(){ panel.classList.remove('show'); }

      btn.addEventListener('click', e=>{
        e.stopPropagation();
        panel.classList.contains('show') ? close() : open();
      });
      list.addEventListener('mousedown', e=>{
        const row=e.target.closest('.fv-item'); if(!row) return;
        const it=items[Number(row.dataset.id)]; if(!it) return;
        sel.value = it.value;
        btn.textContent = it.label || placeholder;
        close();
        sel.dispatchEvent(new Event('change', { bubbles:true }));
      });

      readItems();
      const curr = sel.options[sel.selectedIndex];
      btn.textContent = curr?.text || placeholder;

      // Watch for dynamic option changes
      const mo = new MutationObserver(()=>{
        const old = sel.value;
        readItems(); render('');
        const currOpt = Array.from(sel.options).find(o=>o.value===old) || sel.options[sel.selectedIndex];
        btn.textContent = currOpt?.text || placeholder;
      });
      mo.observe(sel, { childList:true, subtree:true, attributes:true });

      // Reflect disabled state
      function syncDisabled(){
        const dis = sel.disabled;
        btn.disabled = dis;
        btn.classList.toggle('is-disabled', !!dis);
      }
      syncDisabled();
      const moAttr = new MutationObserver(syncDisabled);
      moAttr.observe(sel, { attributes:true, attributeFilter:['disabled'] });
    }

    function upgradeAll(root=document){
      // Upgrade all selects except explicit opt-outs
      root.querySelectorAll('select:not([data-fv-native="true"])').forEach(upgradeSelect);
    }

    // Run after DOM is ready (and again after microtask in case pages inject late)
    const run = ()=>{ try{ upgradeAll(); setTimeout(upgradeAll, 0); }catch(e){ console.warn('[FV] combo upgrade error:', e); } };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', run, { once:true });
    } else {
      run();
    }

    // Expose for manual re-upgrade if a page inserts selects later
    window.FVCombo = { upgradeAll, upgradeSelect };
  }catch(e){
    console.warn('[FV] inline combo upgrader failed:', e);
  }
})();
