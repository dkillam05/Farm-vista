// /Farm-vista/js/firestore/fv-sync.js
// Bi-directional sync for the whole app.
// - Upsync: localStorage → Firestore (robust retries, auth-hydration safe)
// - Downsync: Firestore → localStorage (live listeners, anti-echo)
// No UI and non-blocking; theme-boot.js remains unchanged.

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
  const o = {...(it||{})};
  if (!o.id) o.id = String(o.t || Date.now());
  return o;
}

// ========= Queue & monkey-patch =========
const _setItem = localStorage.setItem;
let MUTED_SETITEM = false;      // prevents echo when we write from downsync
const pending = new Map();      // key -> latest array
let flushTimer = null;

function scheduleFlush(delayMs = 250){
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, delayMs);
}

localStorage.setItem = function(key, val){
  try { _setItem.apply(this, arguments); } catch {}
  try{
    if (!MUTED_SETITEM && typeof key === 'string' && key.startsWith('fv_') && typeof val === 'string'){
      const parsed = JSON.parse(val);
      pending.set(key, parsed);
      scheduleFlush(200);
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
  if (!authHooked){
    authHooked = true;
    try{
      const { onAuthStateChanged } =
        await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js');
      onAuthStateChanged(env.auth, () => { if (pending.size) scheduleFlush(0); startDownsync(); });
    }catch{}
  }
  return null;
}

// ========= UPSYNC (push pending to Firestore) =========
let sdkFirestore = null;

async function flush(){
  if (!pending.size) return;

  const env = await getEnv();
  if (!env){ scheduleFlush(800); return; }

  const user = await waitForUser(env);
  if (!user){ scheduleFlush(800); return; }

  if (!sdkFirestore){
    try{ sdkFirestore = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js'); }
    catch{ scheduleFlush(backoffGrow()); return; }
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
      // Register collection so new browsers know to subscribe
      try{
        const regRef = f.doc(f.collection(env.db, '_sync'), 'collections');
        const { arrayUnion, setDoc } = f;
        await setDoc(regRef, { list: arrayUnion(coll) }, { merge: true });
      }catch(_){}
    }catch(_err){
      hadError = true;
      // Put it back so we try again later
      pending.set(lsKey, arr);
    }
  }

  if (pending.size || hadError) scheduleFlush(backoffGrow());
  else resetBackoff();
}

// ========= Initial sweep (push existing local on startup) =========
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
    if (pending.size) scheduleFlush(0);
  }catch{}
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialSweep, { once:true });
else initialSweep();

// ========= DOWNSYNC (subscribe Firestore → local) =========
let downsyncStarted = false;
let startedColls = new Set();

async function startDownsync(){
  if (downsyncStarted) return;
  const env = await getEnv();
  if (!env) return;
  const user = env.auth.currentUser;
  if (!user) return; // will be called again when auth hydrates

  downsyncStarted = true;

  let f;
  try{ f = sdkFirestore || await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js'); }
  catch{ downsyncStarted = false; setTimeout(startDownsync, 1200); return; }

  const { db } = env;
  const subscribeFor = new Set();

  // Seed from existing keys so current pages hydrate immediately
  try{
    for (let i=0;i<localStorage.length;i++){
      const k = localStorage.key(i);
      const c = keyToCollection(k);
      if (c) subscribeFor.add(c);
    }
  }catch{}

  // Helper to attach a live subscription once per collection
  function attachColl(coll){
    if (!coll || startedColls.has(coll)) return;
    startedColls.add(coll);

    // Simple query: only match this user; avoid extra indexes by not ordering
    const q = f.query(f.collection(db, coll), f.where('uid','==', user.uid));
    f.onSnapshot(q, (snap)=>{
      const rows = [];
      snap.forEach(doc => rows.push({ id: doc.id, ...doc.data() }));

      // Write to all likely localStorage keys for this collection (anti-echo protected)
      const keys = collectionToLikelyKeys(coll);
      try{
        MUTED_SETITEM = true;
        for (const k of keys){
          _setItem.call(localStorage, k, JSON.stringify(rows));
        }
      }finally{
        MUTED_SETITEM = false;
      }
    }, (_err)=>{ /* quiet */ });
  }

  // Attach any seed collections
  subscribeFor.forEach(attachColl);

  // Also follow registry doc for future collections (keeps new browsers in sync)
  const regRef = f.doc(f.collection(db, '_sync'), 'collections');
  f.onSnapshot(regRef, (snap)=>{
    const data = snap.exists() ? snap.data() : {};
    const list = Array.isArray(data.list) ? data.list : [];
    list.forEach(c => attachColl(typeof c === 'string' ? c.trim() : ''));
  }, (_)=>{ /* quiet */ });
}

// Kick off downsync soon after load (auth may not be ready yet; waitForUser hooks it)
setTimeout(startDownsync, 500);

// ========= Lifecycle helpers =========
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && pending.size) scheduleFlush(0);
});
window.addEventListener('pagehide', () => { if (pending.size) scheduleFlush(0); }, { passive:true });
window.addEventListener('beforeunload', () => { if (pending.size) scheduleFlush(0); }, { passive:true });

// ========= Heartbeat/backoff for upsync reliability =========
let beatTimer = null;
let beatMs = 1000;           // start at 1s
const BEAT_MAX = 15000;      // cap at 15s
function startHeartbeat(){
  clearInterval(beatTimer);
  beatTimer = setInterval(()=>{
    if (pending.size) flush(); // direct flush while anything is queued
  }, beatMs);
}
function backoffGrow(){
  beatMs = Math.min(Math.floor(beatMs * 1.8), BEAT_MAX);
  startHeartbeat();
  return beatMs;
}
function resetBackoff(){
  beatMs = 1000;
  startHeartbeat();
}
resetBackoff();

// Optional manual nudge from pages: window.dispatchEvent(new CustomEvent('fv:sync:nudge'))
window.addEventListener('fv:sync:nudge', ()=> scheduleFlush(0));