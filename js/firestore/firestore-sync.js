// /Farm-vista/js/firestore/firestore-sync.js
// Universal localStorage → Firestore sync engine
// Runs silently, detects any page save based on your existing pattern.

(async function(){
  const OWNER_UID = "zD2ssHGNE6RmBSqAyg8r3s3tBKl2";

  // Wait for Firebase to be ready
  let firebaseEnv = null;
  try {
    const mod = await import('/Farm-vista/js/firebase-init.js');
    firebaseEnv = await mod.ready;
  } catch {
    console.warn('[FV] firestore-sync: Firebase not loaded');
    return;
  }

  const { auth, db } = firebaseEnv;
  if (!auth || !db) return;

  // Import Firestore methods
  const { setDoc, doc, collection } = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');

  // Helper: push dataset to Firestore
  async function pushToFirestore(key, arr) {
    if (!Array.isArray(arr) || !arr.length) return;
    const user = auth.currentUser;
    if (!user) return;
    const uid = user.uid || 'anon';

    // Example: fv_setup_farms_v1 → collection = setup_farms
    const collName = key.replace(/^fv_/, '').replace(/_v\d+$/, '');
    const collRef = collection(db, collName);

    try {
      for (const it of arr) {
        const id = it.id || String(it.t || Date.now());
        const ref = doc(collRef, id);
        await setDoc(ref, {
          ...it,
          uid,
          syncedAt: Date.now(),
        }, { merge: true });
      }
      console.log(`[FV] Synced ${arr.length} items from ${key} → ${collName}`);
    } catch (err) {
      showDiag(`Sync failed for ${collName}: ${err.message}`);
    }
  }

  // Helper: show diagnostics only if failing
  function showDiag(msg){
    try{
      const box = document.createElement('div');
      box.textContent = '[FV] Firestore sync error: ' + msg;
      box.style.cssText = `
        position:fixed; bottom:12px; left:50%; transform:translateX(-50%);
        background:#B71C1C; color:#fff; padding:10px 16px; border-radius:8px;
        font-size:14px; z-index:99999; box-shadow:0 6px 20px rgba(0,0,0,.4);
      `;
      document.body.appendChild(box);
      setTimeout(()=> box.remove(), 6000);
    }catch{}
  }

  // Intercept localStorage.setItem globally
  const _setItem = localStorage.setItem;
  localStorage.setItem = function(key, val) {
    try { _setItem.apply(this, arguments); } catch {}
    try {
      if (typeof val === 'string' && key.startsWith('fv_')) {
        const parsed = JSON.parse(val);
        pushToFirestore(key, parsed);
      }
    } catch {}
  };

  console.log('[FV] firestore-sync initialized');
})();