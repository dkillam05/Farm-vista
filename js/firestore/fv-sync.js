// /Farm-vista/js/firestore/fv-sync.js
// Quiet, non-blocking sync for the whole app.
// TODAY: Upsync only (localStorage → Firestore). No UI. Robust retries.

// ========= Utilities =========
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

// ========= Queue & monkey-patch =========
const _setItem = localStorage.setItem;
const pending = new Map();   // key -> latest array
let flushTimer = null;

// Schedule a flush soon
function scheduleFlush(delayMs = 250){
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, delayMs);
}

// Patch localStorage.setItem so existing pages trigger sync
localStorage.setItem = function(key, val){
  try { _setItem.apply(this, arguments); } catch {}
  try{
    if (typeof key === 'string' && key.startsWith('fv_') && typeof val === 'string'){
      const parsed = JSON.parse(val);
      pending.set(key, parsed);
      scheduleFlush(200); // quick nudge
    }
  }catch{}
};

// ========= Firebase helpers =========
async function getEnv(){
  try{
    const mod = await import('/Farm-vista/js/firebase-init.js');
    const env = await mod.ready;
    if (!env || !env.auth || !env.db) return null;
    return env;
  }catch(_){ return null; }
}

let authHooked = false;
async function waitForUser(env){
  if (env.auth.currentUser) return env.auth.currentUser;
  // hook once so when auth hydrates we flush automatically
  if (!authHooked){
    authHooked = true;
    try{
      const { onAuthStateChanged } =
        await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js');
      onAuthStateChanged(env.auth, () => {
        // user arrived; kick the queue
        if (pending.size) scheduleFlush(0);
      });
    }catch{}
  }
  return null;
}

// ========= Core flush (pushes all pending) =========
let sdkFirestore = null;

async function flush(){
  if (!pending.size) return;

  const env = await getEnv();
  if (!env) { // firebase-init not ready yet; try again soon
    scheduleFlush(800);
    return;
  }

  const user = await waitForUser(env);
  if (!user) { // auth not hydrated yet; short retry
    scheduleFlush(800);
    return;
  }

  if (!sdkFirestore){
    try{
      sdkFirestore = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
    }catch(_){
      // SDK failed to load (offline / blocked) — try again later
      scheduleFlush(backoffGrow());
      return;
    }
  }

  const f = sdkFirestore;
  let hadError = false;

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

      // Opportunistically register the collection for later downsync builds
      try{
        const regRef = f.doc(f.collection(env.db, '_sync'), 'collections');
        const { arrayUnion, setDoc } = f;
        await setDoc(regRef, { list: arrayUnion(coll) }, { merge: true });
      }catch(_){}
    }catch(_err){
      hadError = true;
      // put it back in the queue so we don't lose data
      pending.set(lsKey, arr);
    }
  }

  if (pending.size || hadError){
    // retry with backoff
    scheduleFlush(backoffGrow());
  }else{
    // success — reset backoff
    resetBackoff();
  }
}

// ========= Initial sweep (push existing local) =========
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
    if (pending.size) scheduleFlush(0);
  }catch{}
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialSweep, { once:true });
} else {
  initialSweep();
}

// ========= Lifecyle helpers (ensure we push without user action) =========
// 1) When the page/app becomes visible again
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && pending.size) {
    scheduleFlush(0);
  }
});

// 2) When navigating away or closing
window.addEventListener('pagehide', () => { if (pending.size) scheduleFlush(0); }, { passive:true });
window.addEventListener('beforeunload', () => { if (pending.size) scheduleFlush(0); }, { passive:true });

// 3) Heartbeat: keep trying while there’s anything pending (handles slow auth/SW)
//    Starts aggressive (1s), backs off up to 15s, resets on success.
let beatTimer = null;
let beatMs = 1000;           // start at 1s
const BEAT_MAX = 15000;      // cap at 15s
function startHeartbeat(){
  clearInterval(beatTimer);
  beatTimer = setInterval(()=>{
    if (pending.size) flush(); // call flush directly so we don’t postpone via scheduleFlush
  }, beatMs);
}
function backoffGrow(){
  beatMs = Math.min(Math.floor(beatMs * 1.8), BEAT_MAX);
  startHeartbeat();
  return beatMs; // also use as delay for scheduleFlush
}
function resetBackoff(){
  beatMs = 1000;
  startHeartbeat();
}
resetBackoff(); // start the heartbeat immediately

// 4) Manual external nudge (if you ever want to call this from code)
//    window.dispatchEvent(new CustomEvent('fv:sync:nudge'))
window.addEventListener('fv:sync:nudge', ()=> scheduleFlush(0));