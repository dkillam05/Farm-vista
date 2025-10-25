/**
 * FarmVista — user-profile.js
 * Keeps the authenticated user's profile document in sync with Firestore and
 * exposes helpers for other modules to react to profile changes.
 */

import {
  ready,
  getAuth,
  onAuthStateChanged,
  getFirestore,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  serverTimestamp
} from '../firebase-init.js';

const PROFILE_COLLECTION = 'users';
const PROFILE_EVENT = 'fv:profile';

let listening = false;
let activeUnsubscribe = null;
let lastUid = null;

const dispatchProfile = (profile) => {
  try { document.dispatchEvent(new CustomEvent(PROFILE_EVENT, { detail: profile })); }
  catch (err) { console.warn('[FV] dispatch profile failed:', err); }
};

export const ensureUserProfile = async (user) => {
  if (!user || !user.uid) return null;
  const { app } = await ready;
  const db = getFirestore(app);
  if (!db) return null;
  const ref = doc(db, PROFILE_COLLECTION, user.uid);
  try {
    const snap = await getDoc(ref);
    const base = {
      displayName: user.displayName || '',
      email: user.email || '',
      photoURL: user.photoURL || '',
      updatedAt: serverTimestamp()
    };
    if (!snap || (typeof snap.exists === 'function' ? !snap.exists() : !snap.exists)) {
      await setDoc(ref, { ...base, createdAt: serverTimestamp() }, { merge: true });
    } else {
      await setDoc(ref, base, { merge: true });
    }
  } catch (err) {
    console.warn('[FV] ensure profile failed:', err);
  }
  return ref;
};

export const watchUserProfile = async (user, handler) => {
  if (!user || !user.uid || typeof handler !== 'function') return () => {};
  const { app } = await ready;
  const db = getFirestore(app);
  if (!db) return () => {};
  await ensureUserProfile(user);
  const ref = doc(db, PROFILE_COLLECTION, user.uid);
  return onSnapshot(ref, (snap) => {
    const data = snap && typeof snap.exists === 'function' && snap.exists() ? snap.data() : null;
    handler(data || null);
  });
};

export const saveUserProfile = async (updates = {}, userOverride) => {
  const user = userOverride || window.__FV_USER;
  if (!user || !user.uid) return;
  const { app } = await ready;
  const db = getFirestore(app);
  if (!db) return;
  const ref = doc(db, PROFILE_COLLECTION, user.uid);
  try {
    await setDoc(ref, { ...updates, updatedAt: serverTimestamp() }, { merge: true });
  } catch (err) {
    console.warn('[FV] save profile failed:', err);
  }
};

export const initUserProfileListener = async () => {
  if (listening) return;
  listening = true;
  const { app } = await ready;
  const auth = getAuth(app);
  if (!auth) return;

  onAuthStateChanged(auth, async (user) => {
    if (activeUnsubscribe) {
      try { activeUnsubscribe(); } catch {}
      activeUnsubscribe = null;
    }

    if (!user) {
      lastUid = null;
      window.__FV_PROFILE = null;
      dispatchProfile(null);
      return;
    }

    if (user.uid === lastUid && activeUnsubscribe) return;
    lastUid = user.uid;

    try {
      await ensureUserProfile(user);
      activeUnsubscribe = await watchUserProfile(user, (profile) => {
        window.__FV_PROFILE = profile;
        dispatchProfile(profile);
      });
    } catch (err) {
      console.warn('[FV] profile listener error:', err);
    }
  });
};

export const PROFILE_EVENT_NAME = PROFILE_EVENT;
