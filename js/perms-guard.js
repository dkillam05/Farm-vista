/* FarmVista perms-guard v1.0.0
   - Deny-by-default route guard.
   - Uses cached perms for the *current* signed-in user (uid+emailKey).
   - Resolves the required perm id from menu.js by matching current path.
*/

(function () {
  const LS_KEY = 'fv:perms:v1';       // {uid,emailKey,issuedAt,final,on}
  const LS_USER = 'fv:user:last';     // {uid,emailKey,email}

  // Record last-seen auth identity for offline checks (set by shell too)
  function rememberUser(u){
    try{ localStorage.setItem(LS_USER, JSON.stringify(u||{})); }catch{}
  }

  // Small helper to get cached perms for this exact identity
  function readCachedPerms(identity){
    try{
      const raw = localStorage.getItem(LS_KEY);
      if(!raw) return null;
      const obj = JSON.parse(raw);
      if(!obj || !obj.uid || !obj.emailKey) return null;
      if(!identity) return obj; // best-effort
      return (obj.uid===identity.uid && obj.emailKey===identity.emailKey) ? obj : null;
    }catch{ return null; }
  }

  // Derive the "id" required for this page by comparing hrefs in menu.js
  async function resolveRequiredIdFromMenu(){
    const url = location.origin + '/Farm-vista/js/menu.js';
    try{
      const mod = await import(url + '?pg=' + Date.now());
      const NAV = (mod && (mod.NAV_MENU || mod.default)) || {};
      const items = Array.isArray(NAV.items) ? NAV.items : [];
      const here = new URL(location.href);
      const herePath = here.pathname;

      const ids = [];
      (function walk(arr){
        for(const it of (arr||[])){
          if(it.type === 'link' && it.href){
            const hp = new URL(it.href, location.origin).pathname;
            // exact page (or the page is inside that section path)
            if(herePath===hp || herePath.startsWith(hp.replace(/\/index\.html$/,''))){
              ids.push(it.id);
            }
          }
          if(it.children && it.children.length) walk(it.children);
        }
      })(items);

      // Prefer the most specific match (longest href path usually ends up last)
      return ids.length ? ids[ids.length-1] : null;
    }catch{
      return null;
    }
  }

  // Enforce guard:
  // 1) If we have cached perms for the signed-in user → allow only if that id is on.
  // 2) If we cannot verify a user AND have no cached perms → block navigation (offline safe).
  // 3) If id can't be resolved → allow Home only, otherwise block.
  async function guard(){
    // 1) try to detect auth quickly via window.firebaseAuth (shell also sets)
    let identity = null;
    try{
      const a = (window.firebaseAuth && window.firebaseAuth.currentUser) || null;
      if(a && a.email){
        identity = { uid:a.uid, email:a.email, emailKey:String(a.email).trim().toLowerCase() };
        rememberUser(identity);
      }else{
        // fall back to last known (offline)
        const last = JSON.parse(localStorage.getItem(LS_USER)||'null');
        if(last && last.uid && last.emailKey) identity = last;
      }
    }catch{}

    const cached = readCachedPerms(identity);

    // If no identity & no cached perms → block
    if(!identity && !cached){
      if(location.pathname.endsWith('/pages/login/index.html')) return; // login stays accessible
      location.replace('/Farm-vista/pages/unauthorized/index.html');
      return;
    }

    // Login page never needs guard
    if(location.pathname.endsWith('/pages/login/index.html')) return;

    const reqId = await resolveRequiredIdFromMenu();

    // If we have cached perms, enforce them
    if(cached && cached.final && cached.final.on){
      // If no specific id resolved, allow only main index/home
      if(!reqId){
        // allow index/home; block others
        const okRoots = ['/Farm-vista/', '/Farm-vista/index.html'];
        const isRootish = okRoots.includes(location.pathname);
        if(!isRootish) location.replace('/Farm-vista/pages/unauthorized/index.html');
        return;
      }
      const allowed = !!cached.final.on[reqId];
      if(!allowed){
        location.replace('/Farm-vista/pages/unauthorized/index.html');
      }
      return;
    }

    // If we got here: identity exists but no cached perms → we must wait for shell to compute them.
    // Show a minimal waiting screen if desired; for now, block by redirect to unauthorized.
    location.replace('/Farm-vista/pages/unauthorized/index.html');
  }

  // run asap
  try{ guard(); }catch{}
})();