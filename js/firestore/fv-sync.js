/* /Farm-vista/js/firestore/fv-sync.js — v0.9.0
   Goal (STEP 1 ONLY): Disable UPSYNC (localStorage → Firestore) to stop per-keystroke writes.
   Keep DOWNSYNC (Firestore → localStorage) working so pages still hydrate.
   Once this is stable, we can add explicit "Press Save" writes separately.
*/

// ========= Feature flags =========
const UPSYNC_ENABLED = false;   // <- OFF: stops capturing localStorage writes
const DOWNSYNC_ENABLED = true;  // <- ON: keep Firestore → localStorage live listeners

// ========= Utilities =========
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

// ========= Queue & (optional) monkey-patch =========
const _setItem = localStorage.setItem;
let MUTED_SETITEM = false;      // prevents echo when we write from downsync
const pending = new Map();      // key -> latest array
let flushTimer = null;

function scheduleFlush(delayMs = 250){
  clearTimeout(flushTimer);
  if (!UPSYNC_ENABLED) return;
  flushTimer = setTimeout(flush, delayMs);
}

if (UPSYNC_ENABLED){
  // Capture localStorage writes (fv_* keys) → queue for Firestore
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
} else {
  // Pass-through; DO NOT hook keystrokes
  console.warn('[FV] fv-sync: UPSYNC is DISABLED (no localStorage→Firestore writes).');
  localStorage.setItem = function(){ try { return _setItem.apply(this, arguments); } catch {} };
}

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
      onAuthStateChanged(env.auth, () => { if (pending.size) scheduleFlush(0); if (DOWNSYNC_ENABLED) startDownsync(); });
    }catch{}
  }
  return null;
}

// ========= UPSYNC (push pending to Firestore) =========
let sdkFirestore = null;

async function flush(){
  if (!UPSYNC_ENABLED) return;
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
      // Registry
      try{
        const regRef = f.doc(f.collection(env.db, '_sync'), 'collections');
        const { arrayUnion, setDoc } = f;
        await setDoc(regRef, { list: arrayUnion(coll) }, { merge: true });
      }catch(_){}
    }catch(_err){
      hadError = true;
      pending.set(lsKey, arr);
    }
  }

  if (pending.size || hadError) scheduleFlush(backoffGrow());
  else resetBackoff();
}

// ========= Initial sweep (only if UPSYNC) =========
function initialSweep(){
  if (!UPSYNC_ENABLED) return;
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
  if (!DOWNSYNC_ENABLED) return;
  if (downsyncStarted) return;

  const env = await getEnv();
  if (!env) return;
  const user = env.auth.currentUser;
  if (!user) return; // will re-run when auth hydrates

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

  function attachColl(coll){
    if (!coll || startedColls.has(coll)) return;
    startedColls.add(coll);

    // Only this user's docs
    const q = f.query(f.collection(db, coll), f.where('uid','==', user.uid));
    f.onSnapshot(q, (snap)=>{
      const rows = [];
      snap.forEach(doc => rows.push({ id: doc.id, ...doc.data() }));

      // Write to all likely localStorage keys (anti-echo protected)
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

  // Also follow registry doc for future collections
  const regRef = f.doc(f.collection(db, '_sync'), 'collections');
  f.onSnapshot(regRef, (snap)=>{
    const data = snap.exists() ? snap.data() : {};
    const list = Array.isArray(data.list) ? data.list : [];
    list.forEach(c => attachColl(typeof c === 'string' ? c.trim() : ''));
  }, (_)=>{ /* quiet */ });
}

// Kick off downsync (auth may hydrate later; waitForUser will re-trigger)
setTimeout(startDownsync, 500);

// ========= Lifecycle helpers =========
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && UPSYNC_ENABLED && pending.size) scheduleFlush(0);
});
window.addEventListener('pagehide', () => { if (UPSYNC_ENABLED && pending.size) scheduleFlush(0); }, { passive:true });
window.addEventListener('beforeunload', () => { if (UPSYNC_ENABLED && pending.size) scheduleFlush(0); }, { passive:true });

// ========= Heartbeat/backoff for upsync reliability =========
let beatTimer = null;
let beatMs = 1000;           // start at 1s
const BEAT_MAX = 15000;      // cap at 15s
function startHeartbeat(){
  clearInterval(beatTimer);
  if (!UPSYNC_ENABLED) return;
  beatTimer = setInterval(()=>{
    if (pending.size) flush();
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

// Optional manual nudge (no-op when UPSYNC_ENABLED=false)
window.addEventListener('fv:sync:nudge', ()=> scheduleFlush(0));