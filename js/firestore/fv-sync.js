// /Farm-vista/js/firestore/fv-sync.js
// Quiet, non-blocking sync for the whole app.
// TODAY: Upsync only (localStorage → Firestore). No UI, no downsync.

// ------- Utilities -------
function keyToCollection(lsKey){
  if (!lsKey || typeof lsKey !== 'string' || !lsKey.startsWith('fv_')) return null;
  let s = lsKey.replace(/^fv_/, '');
  // optional category prefix
  s = s.replace(/^(setup|contacts|calc|pages|app|settings|data)_/, '');
  // optional version suffix
  s = s.replace(/_v\d+$/, '');
  return s || null;
}

function normalizeItem(it){
  const o = {...(it||{})};
  if (!o.id) o.id = String(o.t || Date.now());
  return o;
}

// ------- Queue + monkeypatch localStorage.setItem so existing pages trigger sync -------
const _setItem = localStorage.setItem;
const pending = new Map();
let flushTimer = null;

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

function scheduleFlush(){ clearTimeout(flushTimer); flushTimer = setTimeout(flush, 250); }

// ------- Flush: pushes all pending datasets to Firestore -------
async function flush(){
  if (!pending.size) return;

  // Wait for Firebase init
  let env;
  try{
    const mod = await import('/Farm-vista/js/firebase-init.js');
    env = await mod.ready;
    if (!env || !env.auth || !env.db) return;
  }catch(e){ return; }

  // Auth may not have hydrated yet on first load — hook and retry
  const user = env.auth.currentUser;
  if (!user) {
    try {
      if (!window.__fv_sync_auth_hooked__) {
        window.__fv_sync_auth_hooked__ = true;
        const { onAuthStateChanged } =
          await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js');
        onAuthStateChanged(env.auth, () => {
          // when the user appears, try again
          scheduleFlush();
        });
      }
    } catch {}
    // backoff too, in case listener is late
    setTimeout(scheduleFlush, 800);
    return;
  }

  // Load Firestore ops
  let f;
  try{ f = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js'); }
  catch{ return; }

  // Push each dataset
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

      // Opportunistically register the collection for future downsync builds
      try{
        const regRef = f.doc(f.collection(env.db, '_sync'), 'collections');
        const { arrayUnion, setDoc } = f;
        await setDoc(regRef, { list: arrayUnion(coll) }, { merge: true });
      }catch(_){}
    }catch(_err){
      // Quiet in stable build
    }
  }
}

// ------- One-time initial sweep: push anything already in local caches -------
function initialSweep(){
  try{
    for (let i=0;i<localStorage.length;i++){
      const k = localStorage.key(i);
      const coll = keyToCollection(k);
      if (!coll) continue;
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

// Optional: retry when tab becomes active (helps PWAs after background)
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && pending.size) {
    scheduleFlush();
  }
});