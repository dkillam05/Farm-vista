/**
 * FarmVista — firebase-init.js
 * v2.2.0 — adds global RefreshBus + soft refresh handler (`fv:refresh`)
 *
 * - `RefreshBus.register(fn)` to let shared loaders re-query on demand
 * - Listens for `document` event `fv:refresh` to:
 *    • ensure network is enabled (Firebase mode)
 *    • briefly re-enable network to force listeners to sync
 *    • call all registered refreshers
 *    • emit `fv:refreshed` afterward
 * - Safe no-op in stub mode
 */

const CDN_BASE = 'https://www.gstatic.com/firebasejs/10.12.5/';
const CDN_APP = `${CDN_BASE}firebase-app.js`;
const CDN_AUTH = `${CDN_BASE}firebase-auth.js`;
const CDN_STORE = `${CDN_BASE}firebase-firestore.js`;
/* === ADD: Firebase Storage module === */
const CDN_STORAGE = `${CDN_BASE}firebase-storage.js`;

const STUB_USER_KEY = 'fv:stub:user';
const STUB_ACCOUNT_KEY = 'fv:stub:accounts';
const STUB_STORE_KEY = 'fv:stub:firestore';

const toStr = (val) => (typeof val === 'string' ? val.trim() : '');
const clone = (value) => {
  try { return (typeof structuredClone === 'function') ? structuredClone(value) : JSON.parse(JSON.stringify(value)); }
  catch { return JSON.parse(JSON.stringify(value)); }
};

const randomId = () => Math.random().toString(36).slice(2, 11) + Math.random().toString(36).slice(2, 11);

const sanitizeUser = (user) => {
  if (!user) return null;
  const email = toStr(user.email);
  const displayName = toStr(user.displayName) || toStr(user.name) || (email ? email.split('@')[0] : 'FarmVista User');
  return {
    uid: toStr(user.uid) || `stub-${randomId()}`,
    displayName,
    email,
    photoURL: toStr(user.photoURL),
    phoneNumber: toStr(user.phoneNumber),
    isAnonymous: false
  };
};

/* -------------------------------------------------------------------------- */
/* Stub Authentication                                                        */
/* -------------------------------------------------------------------------- */

const loadStubUser = () => {
  try {
    const raw = localStorage.getItem(STUB_USER_KEY);
    if (raw) return sanitizeUser(JSON.parse(raw));
  } catch (err) {
    console.warn('[FV] stub auth storage read failed:', err);
  }
  if (window.FV_DEFAULT_USER) return sanitizeUser(window.FV_DEFAULT_USER);
  return sanitizeUser({ displayName: 'FarmVista User' });
};

const saveStubUser = (user) => {
  try {
    if (user) localStorage.setItem(STUB_USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(STUB_USER_KEY);
  } catch (err) {
    console.warn('[FV] stub auth storage write failed:', err);
  }
};

const loadStubAccounts = () => {
  try {
    const raw = localStorage.getItem(STUB_ACCOUNT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch {
    return {};
  }
};

const saveStubAccounts = (map) => {
  try { localStorage.setItem(STUB_ACCOUNT_KEY, JSON.stringify(map)); }
  catch (err) { console.warn('[FV] stub account storage write failed:', err); }
};

const digestText = async (text) => {
  try {
    if (crypto && crypto.subtle && typeof TextEncoder !== 'undefined') {
      const data = new TextEncoder().encode(text);
      const buf = await crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch {}
  // Fallback hash
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
};

const ensureStubAccountRecord = async (user, password) => {
  if (!user || !user.email) return;
  const map = loadStubAccounts();
  const key = user.email.toLowerCase();
  if (!map[key]) {
    const salt = randomId();
    const hash = await digestText((password || 'FarmVista!') + '::' + salt);
    map[key] = {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      salt,
      hash,
      updatedAt: Date.now()
    };
    saveStubAccounts(map);
  }
};

const stubSubscribe = (authInstance, cb) => {
  if (!authInstance || typeof cb !== 'function') return () => {};
  authInstance._listeners.add(cb);
  try { cb(authInstance.currentUser); }
  catch (err) { console.error('[FV] stub auth callback error:', err); }
  return () => authInstance._listeners.delete(cb);
};

const createStubAuth = () => {
  const listeners = new Set();
  const auth = {
    currentUser: loadStubUser(),
    _listeners: listeners,
    async signOut() {
      auth.currentUser = null;
      saveStubUser(null);
      auth._emit();
      return Promise.resolve();
    },
    async _setUser(user, password) {
      auth.currentUser = sanitizeUser(user);
      saveStubUser(auth.currentUser);
      await ensureStubAccountRecord(auth.currentUser, password);
      auth._emit();
      return auth.currentUser;
    },
    _emit() {
      window.__FV_USER = auth.currentUser || null;
      listeners.forEach((cb) => {
        try { cb(auth.currentUser); }
        catch (err) { console.error('[FV] stub auth listener error:', err); }
      });
    }
  };
  auth._emit();
  return auth;
};

const stubSignIn = async (authInstance, email, password) => {
  const map = loadStubAccounts();
  const key = (email || '').toLowerCase();
  const entry = map[key];
  if (!entry) {
    const err = new Error('User not found');
    err.code = 'auth/user-not-found';
    throw err;
  }
  const hash = await digestText((password || '') + '::' + entry.salt);
  if (hash !== entry.hash) {
    const err = new Error('Wrong password');
    err.code = 'auth/wrong-password';
    throw err;
  }
  const user = sanitizeUser({ uid: entry.uid, email: entry.email, displayName: entry.displayName });
  await authInstance._setUser(user, password);
  return { user };
};

const stubCreateUser = async (authInstance, email, password, opts = {}) => {
  const map = loadStubAccounts();
  const key = (email || '').toLowerCase();
  if (!key) {
    const err = new Error('Invalid email');
    err.code = 'auth/invalid-email';
    throw err;
  }
  if (map[key]) {
    const err = new Error('Email already in use');
    err.code = 'auth/email-already-in-use';
    throw err;
  }
  const salt = randomId();
  const hash = await digestText((password || '') + '::' + salt);
  const user = sanitizeUser({
    uid: `stub-${randomId()}`,
    email,
    displayName: opts.displayName || (email ? email.split('@')[0] : 'FarmVista User')
  });
  map[key] = { uid: user.uid, email: user.email, displayName: user.displayName, salt, hash, updatedAt: Date.now() };
  saveStubAccounts(map);
  await authInstance._setUser(user, password);
  return { user };
};

const stubSendPasswordResetEmail = async (email) => {
  console.info('[FV] stub reset password for', email);
  return Promise.resolve();
};

const stubUpdateProfile = async (user, data) => {
  if (!user) return;
  const map = loadStubAccounts();
  const key = (user.email || '').toLowerCase();
  if (map[key]) {
    map[key].displayName = data.displayName || map[key].displayName;
    map[key].updatedAt = Date.now();
    saveStubAccounts(map);
  }
  const cur = sanitizeUser({ ...user, ...data });
  await stubAuth._setUser(cur);
  return cur;
};

const stubAuth = createStubAuth();

/* -------------------------------------------------------------------------- */
/* Stub Firestore                                                             */
/* -------------------------------------------------------------------------- */

const loadStubStore = () => {
  try {
    const raw = localStorage.getItem(STUB_STORE_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    return (data && typeof data === 'object') ? data : {};
  } catch {
    return {};
  }
};

const stubFirestoreData = loadStubStore();
const stubDocListeners = new Map();
const stubCollectionListeners = new Map();

const persistStubStore = () => {
  try { localStorage.setItem(STUB_STORE_KEY, JSON.stringify(stubFirestoreData)); }
  catch (err) { console.warn('[FV] stub firestore storage write failed:', err); }
};

const flatten = (input) => {
  const out = [];
  (function walk(item) {
    if (Array.isArray(item)) item.forEach(walk);
    else if (item !== undefined && item !== null) out.push(String(item));
  })(input);
  return out;
};

const normalizePath = (parts) => flatten(parts).filter(Boolean).join('/');

const stubDocRef = (path) => ({ firestore: stubFirestore, type: 'doc', path, id: path.split('/').pop() || path });
const stubCollectionRef = (path) => ({ firestore: stubFirestore, type: 'collection', path, id: path.split('/').pop() || path });
const stubQueryRef = (source, constraints = []) => ({ firestore: stubFirestore, type: 'query', source, constraints });

const stubDocSnapshot = (path) => {
  const data = stubFirestoreData[path];
  return {
    id: path.split('/').pop() || path,
    ref: stubDocRef(path),
    exists: () => data !== undefined,
    data: () => (data !== undefined ? clone(data) : undefined)
  };
};

const collectDocsUnder = (collectionPath) => {
  const docs = [];
  const prefix = collectionPath.endsWith('/') ? collectionPath : `${collectionPath}/`;
  Object.keys(stubFirestoreData).forEach((key) => {
    if (!key.startsWith(prefix)) return;
    const remainder = key.slice(prefix.length);
    if (remainder.includes('/')) return; // only immediate children
    docs.push(stubDocSnapshot(key));
  });
  return docs;
};

const stubCollectionSnapshot = (collectionPath) => {
  const docs = collectDocsUnder(collectionPath);
  return {
    docs,
    size: docs.length,
    empty: docs.length === 0,
    forEach: (cb) => docs.forEach((snap) => cb(snap))
  };
};

const notifyDocListeners = (path) => {
  const listeners = stubDocListeners.get(path);
  if (listeners && listeners.size) {
    const snap = stubDocSnapshot(path);
    listeners.forEach((cb) => {
      try { cb(snap); } catch (err) { console.error('[FV] stub doc listener error:', err); }
    });
  }
  const idx = path.lastIndexOf('/');
  if (idx > 0) notifyCollectionListeners(path.slice(0, idx));
};

function notifyCollectionListeners(path) {
  const listeners = stubCollectionListeners.get(path);
  if (listeners && listeners.size) {
    const snap = stubCollectionSnapshot(path);
    listeners.forEach((cb) => {
      try { cb(snap); } catch (err) { console.error('[FV] stub collection listener error:', err); }
    });
  }
}

const stubSetDoc = (path, value, merge = false) => {
  if (merge && stubFirestoreData[path]) {
    stubFirestoreData[path] = { ...stubFirestoreData[path], ...clone(value) };
  } else {
    stubFirestoreData[path] = clone(value);
  }
  persistStubStore();
  notifyDocListeners(path);
};

const stubDeleteDoc = (path) => {
  if (path in stubFirestoreData) {
    delete stubFirestoreData[path];
    persistStubStore();
    notifyDocListeners(path);
  }
};

const stubFirestore = {
  _type: 'stub',
  persistence: 'local'
};

/* -------------------------------------------------------------------------- */
/* Runtime globals                                                            */
/* -------------------------------------------------------------------------- */

let app = null;
let auth = stubAuth;
let firestore = stubFirestore;
let authModule = null;
let storeModule = null;
/* === ADD: Storage module handle === */
let storageModule = null;

export let mode = 'stub';

let onAuthStateChangedImpl = (instance, cb) => stubSubscribe(instance || auth, cb);
let onIdTokenChangedImpl = (instance, cb) => stubSubscribe(instance || auth, cb);
let signOutImpl = (instance) => (instance || auth).signOut();
let getAuthImpl = () => auth;
let signInWithEmailAndPasswordImpl = (instance, email, password) => stubSignIn(instance || auth, email, password);
let createUserWithEmailAndPasswordImpl = (instance, email, password, opts) => stubCreateUser(instance || auth, email, password, opts);
let sendPasswordResetEmailImpl = (instance, email) => stubSendPasswordResetEmail(email, instance || auth);
let updateProfileImpl = (user, data) => stubUpdateProfile(user, data);
let setPersistenceImpl = () => Promise.resolve();
let browserLocalPersistenceValue = { type: 'stub-local' };

const docImpl = (...args) => {
  if (storeModule) return storeModule.doc(...args);
  if (!args.length) throw new Error('doc() requires arguments');
  const [first, ...rest] = args;
  if (first && first.type === 'collection' && first.firestore === stubFirestore) {
    if (!rest.length) throw new Error('doc() requires an id when using a collection reference');
    return stubDocRef(`${first.path}/${rest[0]}`);
  }
  if (first && first._type === 'stub') {
    const path = normalizePath(rest);
    return stubDocRef(path);
  }
  const path = normalizePath([first, ...rest]);
  return stubDocRef(path);
};

const collectionImpl = (...args) => {
  if (storeModule) return storeModule.collection(...args);
  if (!args.length) throw new Error('collection() requires arguments');
  const [first, ...rest] = args;
  if (first && first.type === 'doc' && first.firestore === stubFirestore) {
    const path = normalizePath([first.path, ...rest]);
    return stubCollectionRef(path);
  }
  if (first && first._type === 'stub') {
    const path = normalizePath(rest);
    return stubCollectionRef(path);
  }
  const path = normalizePath([first, ...rest]);
  return stubCollectionRef(path);
};

const getDocImpl = async (ref) => {
  if (storeModule) return storeModule.getDoc(ref);
  return stubDocSnapshot(ref.path);
};

const setDocImpl = async (ref, data, opts) => {
  if (storeModule) return storeModule.setDoc(ref, data, opts);
  stubSetDoc(ref.path, data, opts && opts.merge);
};

const updateDocImpl = async (ref, data) => {
  if (storeModule) return storeModule.updateDoc(ref, data);
  stubSetDoc(ref.path, data, true);
};

const addDocImpl = async (ref, data) => {
  if (storeModule) return storeModule.addDoc(ref, data);
  const id = randomId();
  const docRef = stubDocRef(`${ref.path}/${id}`);
  stubSetDoc(docRef.path, data, false);
  return docRef;
};

const deleteDocImpl = async (ref) => {
  if (storeModule) return storeModule.deleteDoc(ref);
  stubDeleteDoc(ref.path);
};

const getDocsImpl = async (target) => {
  if (storeModule) return storeModule.getDocs(target);
  if (target.type === 'query') {
    const src = target.source;
    return stubCollectionSnapshot(src.path);
  }
  if (target.type === 'collection') {
    return stubCollectionSnapshot(target.path);
  }
  throw new Error('Unsupported target for getDocs in stub mode');
};

const onSnapshotImpl = (target, cb) => {
  if (storeModule) return storeModule.onSnapshot(target, cb);
  if (!target || typeof cb !== 'function') return () => {};
  if (target.type === 'doc') {
    const set = stubDocListeners.get(target.path) || new Set();
    set.add(cb);
    stubDocListeners.set(target.path, set);
    Promise.resolve().then(() => cb(stubDocSnapshot(target.path)));
    return () => {
      set.delete(cb);
      if (!set.size) stubDocListeners.delete(target.path);
    };
  }
  if (target.type === 'query') {
    return onSnapshotImpl(target.source, cb);
  }
  if (target.type === 'collection') {
    const set = stubCollectionListeners.get(target.path) || new Set();
    set.add(cb);
    stubCollectionListeners.set(target.path, set);
    Promise.resolve().then(() => cb(stubCollectionSnapshot(target.path)));
    return () => {
      set.delete(cb);
      if (!set.size) stubCollectionListeners.delete(target.path);
    };
  }
  return () => {};
};

const serverTimestampImpl = () => (storeModule ? storeModule.serverTimestamp() : new Date().toISOString());
const queryImpl = (...args) => (storeModule ? storeModule.query(...args) : stubQueryRef(args[0], args.slice(1)));
const whereImpl = (...args) => (storeModule ? storeModule.where(...args) : { type: 'where', args });
const orderByImpl = (...args) => (storeModule ? storeModule.orderBy(...args) : { type: 'orderBy', args });
const limitImpl = (...args) => (storeModule ? storeModule.limit(...args) : { type: 'limit', args });

const ensureStubGlobals = () => {
  if (!window.firebase) window.firebase = {};
  if (!window.firebase.auth) { window.firebase.auth = () => auth; }
  if (!window.firebase.firestore) { window.firebase.firestore = () => firestore; }
  window.firebaseAuth = auth;
  window.firebaseApp = app;
  window.firebaseFirestore = firestore;
  window.fvSignOut = () => (auth && typeof auth.signOut === 'function' ? auth.signOut() : Promise.resolve());
};

const updateWindowUser = (user) => {
  window.__FV_USER = user ? sanitizeUser(user) : null;
  try { document.dispatchEvent(new CustomEvent('fv:user', { detail: window.__FV_USER })); }
  catch (err) { console.warn('[FV] dispatch fv:user failed:', err); }
};

/* ----------------------------- Refresh Bus -------------------------------- */

export const RefreshBus = {
  _fns: new Set(),
  register(fn){
    if (typeof fn === 'function') this._fns.add(fn);
    return ()=> this._fns.delete(fn);
  },
  async runAll(){
    for (const fn of Array.from(this._fns)) {
      try { await fn(); } catch (e) { console.warn('[FV] refresh fn failed', e); }
    }
  }
};

ensureStubGlobals();
onAuthStateChangedImpl(auth, (user) => updateWindowUser(user));

export const ready = (async () => {
  const cfg = window.FV_FIREBASE_CONFIG;
  if (!cfg) {
    mode = 'stub';
    ensureStubGlobals();
    return { app, auth, firestore, mode };
  }

  try {
    /* === CHANGED: also import STORAGE === */
    const [{ initializeApp }, authMod, storeMod, storageMod] = await Promise.all([
      import(CDN_APP),
      import(CDN_AUTH),
      import(CDN_STORE),
      import(CDN_STORAGE)
    ]);

    authModule = authMod;
    storeModule = storeMod;
    storageModule = storageMod;   // <-- keep handle

    app = initializeApp(cfg);
    auth = authMod.getAuth(app);
    firestore = storeMod.getFirestore(app);
    mode = 'firebase';

    getAuthImpl = (appInstance) => authMod.getAuth(appInstance || app);
    onAuthStateChangedImpl = (instance, cb) => authMod.onAuthStateChanged(instance || auth, cb);
    onIdTokenChangedImpl = (instance, cb) => authMod.onIdTokenChanged(instance || auth, cb);
    signOutImpl = (instance) => authMod.signOut(instance || auth);
    signInWithEmailAndPasswordImpl = (instance, email, password) => authMod.signInWithEmailAndPassword(instance || auth, email, password);
    createUserWithEmailAndPasswordImpl = async (instance, email, password, opts) => {
      const authInstance = instance || auth;
      const cred = await authMod.createUserWithEmailAndPassword(authInstance, email, password);
      if (opts && opts.displayName) {
        try { await authMod.updateProfile(cred.user, { displayName: opts.displayName }); }
        catch (err) { console.warn('[FV] displayName update failed:', err); }
      }
      return cred;
    };
    sendPasswordResetEmailImpl = (instance, email) => authMod.sendPasswordResetEmail(instance || auth, email);
    updateProfileImpl = (user, data) => authMod.updateProfile(user, data);
    setPersistenceImpl = (instance, persistence) => authMod.setPersistence(instance || auth, persistence);
    browserLocalPersistenceValue = authMod.browserLocalPersistence;

    firestore = storeMod.getFirestore(app);

    ensureStubGlobals();
    window.firebaseApp = app;
    window.firebaseAuth = auth;
    window.firebaseFirestore = firestore;
    window.fvSignOut = () => authMod.signOut(auth);
    // (Optional) expose storage on window if you like:
    // window.firebaseStorage = storageMod.getStorage(app);

    onAuthStateChangedImpl(auth, (user) => updateWindowUser(user));

    return { app, auth, firestore, mode };
  } catch (err) {
    console.warn('[FV] Firebase init failed, using stub mode:', err);
    app = null;
    auth = stubAuth;
    firestore = stubFirestore;
    mode = 'stub';
    authModule = null;
    storeModule = null;
    storageModule = null; // ensure null in stub
    ensureStubGlobals();
    return { app, auth, firestore, mode };
  }
})();

/* ------------------------ Global PTR event handler ------------------------ */
/* Soft refresh workflow:
   1) If Firebase mode, ensure network is enabled (in case it's offline).
   2) Nudge listeners by toggling network: disable→enable (safe no-op if already online).
   3) Run all registered refreshers.
   4) Emit 'fv:refreshed' for any UI that wants to show a toast, etc.
*/
async function _softRefreshNow(){
  try {
    if (mode === 'firebase' && storeModule && firestore) {
      try { await storeModule.enableNetwork(firestore); } catch {}
      // nudge live listeners by toggling briefly
      try {
        await storeModule.disableNetwork(firestore);
      } catch {}
      try {
        await storeModule.enableNetwork(firestore);
      } catch {}
    }
  } catch (e) {
    console.warn('[FV] refresh network nudge failed', e);
  }

  try { await RefreshBus.runAll(); } catch {}
  try { document.dispatchEvent(new CustomEvent('fv:refreshed')); } catch {}
}

document.addEventListener('fv:refresh', () => { _softRefreshNow(); });

/* ------------------------------ Public API -------------------------------- */

export const getApp = () => app;
export const getAuth = (appInstance) => getAuthImpl(appInstance);
export const onAuthStateChanged = (instance, cb) => onAuthStateChangedImpl(instance || auth, cb);
export const onIdTokenChanged = (instance, cb) => onIdTokenChangedImpl(instance || auth, cb);
export const signOut = (instance) => signOutImpl(instance || auth);
export const isStub = () => mode !== 'firebase';
export const signInWithEmailAndPassword = (instance, email, password) => signInWithEmailAndPasswordImpl(instance || auth, email, password);
export const createUserWithEmailAndPassword = (instance, email, password, opts) => createUserWithEmailAndPasswordImpl(instance || auth, email, password, opts);
export const sendPasswordResetEmail = (instance, email) => sendPasswordResetEmailImpl(instance || auth, email);
export const updateProfile = (user, data) => updateProfileImpl(user, data);
export const setPersistence = (instance, persistence) => setPersistenceImpl(instance || auth, persistence);
export const browserLocalPersistence = () => browserLocalPersistenceValue;
export const getFirestore = (appInstance) => (storeModule ? storeModule.getFirestore(appInstance || app) : firestore);
export const doc = (...args) => docImpl(...args);
export const collection = (...args) => collectionImpl(...args);
export const getDoc = (ref) => getDocImpl(ref);
export const setDoc = (ref, data, opts) => setDocImpl(ref, data, opts);
export const updateDoc = (ref, data) => updateDocImpl(ref, data);
export const addDoc = (ref, data) => addDocImpl(ref, data);
export const deleteDoc = (ref) => deleteDocImpl(ref);
export const getDocs = (target) => getDocsImpl(target);
export const onSnapshot = (target, cb) => onSnapshotImpl(target, cb);
export const serverTimestamp = () => serverTimestampImpl();
export const query = (...args) => queryImpl(...args);
export const where = (...args) => whereImpl(...args);
export const orderBy = (...args) => orderByImpl(...args);
export const limit = (...args) => limitImpl(...args);
export const setStubUser = (user, password) => stubAuth._setUser(user, password);
export const getStubUser = () => stubAuth.currentUser;

/* === ADD: Public Storage API (Firebase mode only) ===
   These match the modular SDK signatures. In stub mode they return null
   or reject, which your page already handles gracefully. */
export const getStorage = (appInstance) => (storageModule ? storageModule.getStorage(appInstance || app) : null);
export const ref = (...args) => {
  if (!storageModule) throw new Error('Storage not available (stub mode)');
  return storageModule.ref(...args);
};
// alias for convenience—some code imports `storageRef`
export const storageRef = (...args) => ref(...args);
export const uploadBytes = (...args) => {
  if (!storageModule) return Promise.reject(new Error('Storage not available (stub mode)'));
  return storageModule.uploadBytes(...args);
};
export const getDownloadURL = (...args) => {
  if (!storageModule) return Promise.reject(new Error('Storage not available (stub mode)'));
  return storageModule.getDownloadURL(...args);
};

window.__FV_USER = stubAuth.currentUser || null;