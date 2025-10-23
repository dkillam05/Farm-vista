// /Farm-vista/js/firestore/firestore-save.js
// ESM module

import { needFirebase, toast, stampForCreate, stampForUpdate, getUidOrThrow } from './firestore-common.js';

export async function saveForm(collectionName, formData, opts = {}) {
  const { db, auth } = await needFirebase();
  getUidOrThrow(auth); // throw if not signed in

  const f = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const col = f.collection(db, collectionName);

  const base = Object(formData || {});
  if (opts.id) {
    // Upsert with a provided ID (merge keeps existing fields)
    const ref = f.doc(db, collectionName, String(opts.id));
    const meta = await (opts.isCreate ? stampForCreate(auth) : stampForUpdate());
    await f.setDoc(ref, { ...base, ...meta }, { merge: true });
    toast('Saved ✅');
    return { id: ref.id };
  } else {
    // Create new doc with auto ID
    const meta = await stampForCreate(auth);
    const ref = await f.addDoc(col, { ...base, ...meta });
    toast('Saved ✅');
    return { id: ref.id };
  }
}

export async function updateForm(collectionName, id, patch) {
  const { db } = await needFirebase();
  const f = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const ref = f.doc(db, collectionName, String(id));
  const meta = await stampForUpdate();
  await f.updateDoc(ref, { ...Object(patch || {}), ...meta });
  toast('Updated ✅');
  return { id };
}

export async function deleteForm(collectionName, id) {
  const { db } = await needFirebase();
  const f = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const ref = f.doc(db, collectionName, String(id));
  await f.deleteDoc(ref);
  toast('Deleted 🗑️');
  return { id };
}

// Live list of "my docs" for a collection.
// Example use: const unsub = await listenMy('farms', docs => render(docs));
export async function listenMy(collectionName, onChange, orderField = 'createdAt', direction = 'desc') {
  const { db, auth } = await needFirebase();
  const uid = getUidOrThrow(auth);
  const f = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const q = f.query(
    f.collection(db, collectionName),
    f.where('uid', '==', uid),
    f.orderBy(orderField, direction)
  );
  const unsub = f.onSnapshot(q, (snap) => {
    const rows = [];
    snap.forEach(d => rows.push({ id: d.id, ...d.data() }));
    try { onChange(rows); } catch (e) { console.warn('listenMy handler error', e); }
  });
  return unsub;
}