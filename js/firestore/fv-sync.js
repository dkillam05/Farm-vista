// /Farm-vista/js/fv-sync.js
// Quiet, non-blocking sync for the whole app.
// TODAY: Upsync only (localStorage → Firestore). Downsync scaffolding included but OFF.

const ENABLE_DOWNSYNC = false; // flip to true later when you’re ready

// Map fv_* keys to collection names by convention
function keyToCollection(lsKey){
  if (!lsKey || typeof lsKey !== 'string' || !lsKey.startsWith('fv_')) return null;
  let s = lsKey.replace(/^fv_/, '');
  s = s.replace(/^(setup|contacts|calc|pages|app|settings|data)_/, '');
  s = s.replace(/_v\d+$/, '');
  return s || null;
}

function normalizeItem(it){
  const o = {...(it||{})};
  if (!o.id) o.id = String(o.t || Date.now());
  return o;
}

function sortNewestFirst(rows){
  rows.sort((a,b)=>{
    const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : (+a.createdAt || 0);
    const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : (+b.createdAt || 0);
    return tb - ta;
  });
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

// ===== UPSYNC (local → Firestore) =====
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
      // Register the collection (so future downsync can know what to watch)
      try{
        const regRef = f.doc(f.collection(env.db, '_sync'), 'collections');
        const { arrayUnion, setDoc } = f;
        await setDoc(regRef, { list: arrayUnion(coll) }, { merge: true });
      }catch(_){}
    }catch(_err){
      // Silent in stable build
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

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialSweep, { once:true });
} else {
  initialSweep();
}

// ===== DOWNSYNC (Firestore → local) — OFF by default =====
if (ENABLE_DOWNSYNC){
  (async function startDownsync(){
    try{
      const mod = await import('/Farm-vista/js/firebase-init.js'); const env = await mod.ready;
      const { auth, db } = env; if (!auth || !db) return;
      const user = auth.currentUser; if (!user) return;

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
          const rows = [];
          snap.forEach(doc => rows.push({ id: doc.id, ...doc.data() }));
          sortNewestFirst(rows);

          const keys = collectionToLikelyKeys(coll);
          keys.forEach(k => {
            try { _setItem.call(localStorage, k, JSON.stringify(rows)); } catch {}
          });
        }, (_err)=>{ /* quiet */ });
      }

      subscribeFor.forEach(startColl);

      const regRef = f.doc(f.collection(db, '_sync'), 'collections');
      f.onSnapshot(regRef, (snap)=>{
        const data = snap.exists() ? snap.data() : {};
        const list = Array.isArray(data.list) ? data.list : [];
        list.forEach(c => startColl(typeof c === 'string' ? c.trim() : ''));
      });
    }catch(_e){ /* quiet */ }
  })();
}