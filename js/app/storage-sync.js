/**
 * FarmVista — storage-sync.js
 * Bridges window.localStorage with Cloud Firestore so legacy features that
 * rely on synchronous storage automatically persist to the authenticated
 * user's secure database. The helper mirrors setItem/removeItem/clear calls
 * and replays remote changes back into localStorage without disrupting
 * existing code.
 */

import {
  ready,
  getAuth,
  onAuthStateChanged,
  getFirestore,
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDocs,
  onSnapshot,
  serverTimestamp
} from '../firebase-init.js';

let initialized = false;
let wrapped = false;

const original = {
  setItem: window.localStorage ? window.localStorage.setItem.bind(window.localStorage) : () => {},
  removeItem: window.localStorage ? window.localStorage.removeItem.bind(window.localStorage) : () => {},
  clear: window.localStorage ? window.localStorage.clear.bind(window.localStorage) : () => {}
};

const state = {
  paused: false,
  user: null,
  collection: null,
  unsubscribe: null
};

const pendingWrites = new Map();
const pendingDeletes = new Set();
const managedKeys = new Set();
let writeChain = Promise.resolve();

const queue = (fn) => {
  writeChain = writeChain.then(() => fn()).catch((err) => {
    console.warn('[FV] storage sync write failed:', err);
  });
  return writeChain;
};

const setPaused = (on) => { state.paused = !!on; };

const markKey = (key) => { if (key) managedKeys.add(key); };

const scheduleSet = (key, value) => {
  if (!key) return;
  if (!state.collection) {
    pendingWrites.set(key, value);
    pendingDeletes.delete(key);
    return;
  }
  const col = state.collection;
  queue(async () => {
    try {
      const ref = doc(col, key);
      await setDoc(ref, {
        value,
        updatedAt: serverTimestamp(),
        uid: state.user ? state.user.uid : null
      });
    } catch (err) {
      console.warn('[FV] storage sync set failed:', err);
      pendingWrites.set(key, value);
    }
  });
};

const scheduleDelete = (key) => {
  if (!key) return;
  if (!state.collection) {
    pendingWrites.delete(key);
    pendingDeletes.add(key);
    return;
  }
  const col = state.collection;
  queue(async () => {
    try {
      const ref = doc(col, key);
      await deleteDoc(ref);
    } catch (err) {
      console.warn('[FV] storage sync delete failed:', err);
      pendingWrites.delete(key);
      pendingDeletes.add(key);
    }
  });
};

const flushPending = () => {
  if (!state.collection) return;
  pendingWrites.forEach((value, key) => scheduleSet(key, value));
  pendingWrites.clear();
  pendingDeletes.forEach((key) => scheduleDelete(key));
  pendingDeletes.clear();
};

const wrapLocalStorage = () => {
  if (wrapped || !window.localStorage) return;
  wrapped = true;

  const ls = window.localStorage;

  ls.setItem = (key, value) => {
    original.setItem(key, value);
    markKey(key);
    if (!state.paused) scheduleSet(key, value);
  };

  ls.removeItem = (key) => {
    original.removeItem(key);
    if (!state.paused) scheduleDelete(key);
    managedKeys.delete(key);
  };

  ls.clear = () => {
    const keys = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k) keys.push(k);
    }
    original.clear();
    keys.forEach((k) => { if (!state.paused) scheduleDelete(k); managedKeys.delete(k); });
  };
};

const applyRemoteSnapshot = (snapshot) => {
  if (!snapshot) return;
  const docs = snapshot.docs || [];
  const seen = new Set();
  setPaused(true);
  try {
    docs.forEach((snap) => {
      if (!snap) return;
      const data = typeof snap.data === 'function' ? snap.data() : snap.data;
      const value = data && typeof data.value === 'string' ? data.value : data && data.value != null ? String(data.value) : '';
      original.setItem(snap.id, value);
      markKey(snap.id);
      seen.add(snap.id);
    });
    managedKeys.forEach((key) => {
      if (!seen.has(key)) {
        original.removeItem(key);
        managedKeys.delete(key);
      }
    });
  } finally {
    setPaused(false);
  }
};

const hydrateFromRemote = async (col) => {
  try {
    const snapshot = await getDocs(col);
    if (snapshot && typeof snapshot.forEach === 'function') {
      setPaused(true);
      try {
        snapshot.forEach((snap) => {
          if (!snap) return;
          const data = typeof snap.data === 'function' ? snap.data() : snap.data;
          const value = data && typeof data.value === 'string' ? data.value : data && data.value != null ? String(data.value) : '';
          original.setItem(snap.id, value);
          markKey(snap.id);
        });
      } finally {
        setPaused(false);
      }
    }
  } catch (err) {
    console.warn('[FV] storage hydration failed:', err);
  }
};

const disconnect = () => {
  if (state.unsubscribe) {
    try { state.unsubscribe(); } catch {}
    state.unsubscribe = null;
  }
  state.collection = null;
  state.user = null;
  setPaused(true);
  try {
    managedKeys.forEach((key) => original.removeItem(key));
    managedKeys.clear();
  } finally {
    setPaused(false);
  }
  pendingWrites.clear();
  pendingDeletes.clear();
};

const connect = async (user) => {
  if (!user) { disconnect(); return; }
  const { app } = await ready;
  const db = getFirestore(app);
  if (!db) return;

  wrapLocalStorage();
  state.user = user;
  state.collection = collection(db, 'users', user.uid, 'kv');

  await hydrateFromRemote(state.collection);
  flushPending();

  if (state.unsubscribe) {
    try { state.unsubscribe(); } catch {}
    state.unsubscribe = null;
  }

  state.unsubscribe = onSnapshot(state.collection, (snapshot) => applyRemoteSnapshot(snapshot));
};

const start = async () => {
  if (initialized) return;
  initialized = true;
  const { app } = await ready;
  const auth = getAuth(app);
  if (!auth) return;
  wrapLocalStorage();
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      disconnect();
    } else {
      await connect(user);
    }
  });
};

start().catch((err) => console.warn('[FV] storage sync init error:', err));

export const initStorageSync = () => start();
