// /Farm-vista/js/firestore/firestore-common.js
// ESM module

// Load your existing Firebase bootstrap and wait until it's ready.
export async function needFirebase() {
  const mod = await import('/Farm-vista/js/firebase-init.js');
  // Your file already exposes a `ready` promise; if not, we still proceed.
  try { await mod.ready; } catch {}
  // Prefer named exports; fall back to window for maximum compatibility.
  const app       = mod.app       || (window.FV && window.FV.firebase && window.FV.firebase.app);
  const auth      = mod.auth      || (window.FV && window.FV.firebase && window.FV.firebase.auth);
  const db        = mod.db        || (window.FV && window.FV.firebase && window.FV.firebase.db);
  const storage   = mod.storage   || (window.FV && window.FV.firebase && window.FV.firebase.storage);
  const functions = mod.functions || (window.FV && window.FV.firebase && window.FV.firebase.functions);
  if (!app || !auth || !db) throw new Error('Firebase not initialized');
  return { app, auth, db, storage, functions };
}

// Light toast helper — works with your <fv-shell> toast; falls back to alert/console.
export function toast(msg) {
  try { window.dispatchEvent(new CustomEvent('fv:toast', { detail: String(msg) })); }
  catch {}
  try { console.log('[FV]', msg); } catch {}
}

export function getUid(auth) { return (auth && auth.currentUser && auth.currentUser.uid) || null; }
export function getUidOrThrow(auth) {
  const uid = getUid(auth);
  if (!uid) throw new Error('Not signed in');
  return uid;
}

// Server timestamps (lazy import to keep first paint fast)
async function ts() {
  const f = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  return f.serverTimestamp();
}

export async function stampForCreate(auth) {
  const uid = getUidOrThrow(auth);
  const now = await ts();
  return { uid, createdAt: now, updatedAt: now, status: 'active' };
}

export async function stampForUpdate() {
  const now = await ts();
  return { updatedAt: now };
}