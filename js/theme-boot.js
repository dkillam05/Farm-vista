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

      // 4) USER CONTEXT warm
      try{
        if (!window.__FV_USER_CONTEXT_LOADED__) {
          window.__FV_USER_CONTEXT_LOADED__ = true;
          await __fvBoot.loadScript('/Farm-vista/js/app/user-context.js', { type:'module', defer:true });
        }

        // Load perm-ui globally ONCE (so you don't have to add it to every page)
        if (!window.__FV_PERM_UI_SCRIPT_LOADED__) {
          window.__FV_PERM_UI_SCRIPT_LOADED__ = true;
          try { await __fvBoot.loadScript('/Farm-vista/js/perm-ui.js', { defer:true }); }
          catch(e){ console.warn('[FV] perm-ui failed to load:', e); }
        }

        if (window.FVUserContext && typeof window.FVUserContext.get === 'function') {
          const cached = window.FVUserContext.get();
          if (cached) __fvBoot.fire('fv:user-ready', { source:'cache', data: cached });
        }

        if (window.FVUserContext && typeof window.FVUserContext.refresh === 'function') {
          const data = await window.FVUserContext.refresh({ warm:true });
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

      if (isStub && ALLOW_STUB_MODE) return;

      if (!auth) {
        const uc = getUserContextSnapshot();
        if (uc && uc.uid) return;
        gotoLogin('no-auth');
        return;
      }

      try {
        if (mod.setPersistence && mod.browserLocalPersistence) {
          await mod.setPersistence(auth, mod.browserLocalPersistence());
        }
      } catch (e) {
        console.warn('[FV] setPersistence failed:', e);
      }

      const user = await waitForAuthHydration(mod, auth, 3000);

      if (!user) {
        const uc = getUserContextSnapshot();
        if (uc && uc.uid) return;
        gotoLogin('unauthorized');
        return;
      }

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
      console.warn('[FV] auth-guard error (non-fatal):', e);
      if (isLoginPath()) return;
      const uc = getUserContextSnapshot();
      if (uc && uc.uid) return;
      gotoLogin('guard-error');
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once:true });
  } else {
    run();
  }
})();

/* =====================  Permission Engine (BRAIN ONLY — NO HIDE)  ===================== */
/* Provides FV.can("key") and FV.can("key:action") using FVUserContext perms.
   UI behavior (hide tiles / disable forms) is handled by /js/perm-ui.js.
*/
(function(){
  try{
    window.FV = window.FV || {};

    function extractCoreUser(ctx){
      if (!ctx || typeof ctx !== 'object') return ctx;
      if (ctx.user && typeof ctx.user === 'object' && (ctx.role || ctx.employee || ctx.effectivePerms || ctx.perms)) {
        return Object.assign({}, ctx, ctx.user);
      }
      return ctx;
    }

    function updatePermsFromContext(rawCtx){
      const ctx = extractCoreUser(rawCtx) || {};

      const rawPerms =
        (ctx.effectivePerms && typeof ctx.effectivePerms === 'object') ? ctx.effectivePerms :
        (ctx.perms && typeof ctx.perms === 'object') ? ctx.perms :
        (ctx.role && typeof ctx.role.perms === 'object') ? ctx.role.perms :
        {};

      window.FV_PERMS_RAW = rawPerms;
      window.FV.permsRaw = rawPerms;
    }

    if (typeof window.FV.can !== 'function') {
      window.FV.can = function(featureOrKey){
        if (!featureOrKey) return false;

        const raw = window.FV_PERMS_RAW || null;

        // Fail-open until perms load; perm-ui re-applies on fv:user-ready
        if (!raw) return true;

        const str = String(featureOrKey);
        const parts = str.split(':');
        const feature = parts[0];
        const action = parts.length > 1 ? parts[1] : null;

        if (action) {
          const v = raw[feature];
          if (v && typeof v === 'object' && typeof v[action] === 'boolean') return v[action];
          return false;
        }

        const v = raw[str];
        if (typeof v === 'boolean') return v;
        if (v && typeof v === 'object') {
          return (v.view === true || v.add === true || v.edit === true || v.delete === true || v.on === true);
        }
        return false;
      };
    }

    document.addEventListener('fv:user-ready', function(ev){
      try{
        const data = ev && ev.detail && ev.detail.data;
        if (data) updatePermsFromContext(data);
      } catch(e){
        console.warn('[FV] fv:user-ready → perm update failed:', e);
      }
    });

    // init from cache if available
    try{
      if (window.FVUserContext && typeof window.FVUserContext.get === 'function') {
        const cached = window.FVUserContext.get();
        if (cached) updatePermsFromContext(cached);
      }
    }catch(e){}

  }catch(e){
    console.warn('[FV] permission-engine error:', e);
  }
})();

/* =======================  GLOBAL COMBO UPGRADER (INLINE)  ======================= */
/* (unchanged) */
(function(){
  try{
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
      const cs = window.getComputedStyle(sel);
      if (cs.display === 'none' || cs.visibility === 'hidden') { return; }

      sel._fvUpgraded = true;
      const searchable = String(sel.dataset.fvSearch||'').toLowerCase()==='true';
      const placeholder = sel.getAttribute('placeholder') || (sel.options[0]?.text ?? '— Select —');

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

      const mo = new MutationObserver(()=>{
        const old = sel.value;
        readItems(); render('');
        const currOpt = Array.from(sel.options).find(o=>o.value===old) || sel.options[sel.selectedIndex];
        btn.textContent = currOpt?.text || placeholder;
      });
      mo.observe(sel, { childList:true, subtree:true, attributes:true });

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
      root.querySelectorAll('select:not([data-fv-native="true"])').forEach(upgradeSelect);
    }

    const run = ()=>{ try{ upgradeAll(); setTimeout(upgradeAll, 0); }catch(e){ console.warn('[FV] combo upgrade error:', e); } };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', run, { once:true });
    } else {
      run();
    }

    window.FVCombo = { upgradeAll, upgradeSelect };
  }catch(e){
    console.warn('[FV] inline combo upgrader failed:', e);
  }
})();
