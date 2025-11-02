/* FarmVista — fv-data.js v1.0.2
   Matches your Firestore/Storage rules:
   - Firestore: auto uid + createdAt/updatedAt (serverTimestamp)
   - Storage: default path user-uploads/{uid}/..., plus feedback screenshot helper
   - Admin detection: custom claim (token.admin) OR employees/<lowercased email> group
   Works with your modular /Farm-vista/js/firebase-init.js, falls back to compat if present.
*/

(function () {
  'use strict';

  // ---------- tiny utils ----------
  const pad2 = (n) => (n < 10 ? '0' + n : '' + n);
  const dateFolders = (d = new Date()) => `${d.getFullYear()}/${pad2(d.getMonth()+1)}/${pad2(d.getDate())}`;
  const slug = (s) => (s || '').toString().trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80) || 'file';
  const uuid = () => (crypto && crypto.randomUUID) ? crypto.randomUUID()
    : ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));

  // ---------- firebase binding (modular preferred, compat fallback) ----------
  let bind = null; // { mode:'mod'|'compat', app, auth, db, storage, fns:{...} }
  let _user = undefined;
  let _empDoc = null;

  async function bindFirebase() {
    if (bind) return bind;

    // Prefer your modular init
    try {
      const mod = await import('/Farm-vista/js/firebase-init.js');
      const ctx = mod.ready ? await mod.ready : null;
      const app = (ctx && ctx.app) || (mod.getApp && mod.getApp()) || null;
      const auth = (ctx && ctx.auth) || (mod.getAuth && mod.getAuth()) || null;
      const db = mod.getFirestore ? mod.getFirestore(app) : null;
      const storage = mod.getStorage ? mod.getStorage(app) : null;

      if (app && auth && db && storage) {
        bind = {
          mode: 'mod',
          app, auth, db, storage,
          fns: {
            doc: mod.doc, collection: mod.collection, getDoc: mod.getDoc, getDocs: mod.getDocs,
            addDoc: mod.addDoc, setDoc: mod.setDoc, updateDoc: mod.updateDoc, query: mod.query, where: mod.where, limit: mod.limit,
            serverTimestamp: mod.serverTimestamp, arrayUnion: mod.arrayUnion,
            ref: mod.ref, uploadBytesResumable: mod.uploadBytesResumable, getDownloadURL: mod.getDownloadURL, deleteObject: mod.deleteObject
          }
        };
        return bind;
      }
    } catch (e) {
      console.warn('[FVData] modular init not available (will try compat):', e);
    }

    // Compat fallback
    if (window.firebase && firebase.app) {
      const app = firebase.app();
      bind = {
        mode: 'compat',
        app,
        auth: firebase.auth(),
        db: firebase.firestore(),
        storage: firebase.storage(),
        fns: {
          serverTimestamp: () => firebase.firestore.FieldValue.serverTimestamp(),
          arrayUnion: (...args) => firebase.firestore.FieldValue.arrayUnion(...args),
        }
      };
      return bind;
    }

    throw new Error('[FVData] Firebase not initialized. Ensure theme-boot.js ran and /Farm-vista/js/firebase-init.js is reachable.');
  }

  const now = async () => (await bindFirebase()).fns.serverTimestamp();
  const isSignedIn = () => !!(bind && bind.auth && bind.auth.currentUser);
  const uid = () => (bind && bind.auth && bind.auth.currentUser ? bind.auth.currentUser.uid : null);
  const email = () => (bind && bind.auth && bind.auth.currentUser ? (bind.auth.currentUser.email || '') : '');

  const OWNER_UID = 'zD2ssHGNE6RmBSqAyg8r3s3tBKl2';
  const isOwner = () => uid() === OWNER_UID;

  async function _fetchEmployeeDoc() {
    try {
      const b = await bindFirebase();
      const em = email();
      if (!em) return null;
      const key = em.toLowerCase(); // your app writes employees LOWERCASE
      if (b.mode === 'mod') {
        const { doc, getDoc } = b.fns;
        const snap = await getDoc(doc(b.db, 'employees', key));
        return snap.exists() ? ({ id: key, ...snap.data() }) : null;
      } else {
        const snap = await b.db.collection('employees').doc(key).get();
        return snap.exists ? ({ id: key, ...snap.data() }) : null;
      }
    } catch { return null; }
  }

  async function isAdmin() {
    await ready();
    if (isOwner()) return true;
    try {
      const u = bind.auth.currentUser;
      if (u && u.getIdTokenResult) {
        const res = await u.getIdTokenResult();
        if (res && res.claims && res.claims.admin === true) return true; // matches rules: request.auth.token.admin == true
      }
    } catch {}
    if (!_empDoc) _empDoc = await _fetchEmployeeDoc();
    if (_empDoc && typeof _empDoc.permissionGroup === 'string') {
      const g = _empDoc.permissionGroup.toLowerCase();
      if (g === 'admin' || g === 'administrator') return true;
    }
    return false;
  }

  // ---------- lifecycle: mirror your auth-guard hydration ----------
  async function ready() {
    await bindFirebase();
    if (_user !== undefined) return { user: _user, emp: _empDoc };
    _user = await new Promise((resolve) => {
      let done = (u)=> resolve(u || null);
      try {
        if (bind.auth.currentUser) return done(bind.auth.currentUser);
        const off = bind.auth.onAuthStateChanged
          ? bind.auth.onAuthStateChanged((u)=>{ off && off(); done(u); })
          : null;
        setTimeout(()=> done(bind.auth.currentUser), 1600);
      } catch { done(bind.auth && bind.auth.currentUser); }
    });
    if (_user && !_empDoc) _empDoc = await _fetchEmployeeDoc();
    return { user: _user, emp: _empDoc };
  }

  // ---------- meta stamping (rules-friendly) ----------
  async function _withMeta(data, { ownership = true, touched = true } = {}) {
    const out = { ...(data || {}) };
    const me = uid();
    if (ownership && me) out.uid = out.uid || me; // ensure request.resource.data.uid == request.auth.uid on create
    if (touched) {
      out.updatedAt = await now();
      if (!('createdAt' in out)) out.createdAt = await now();
    }
    return out;
  }

  // ---------- Firestore helpers ----------
  async function addDocWithMeta(colPath, data, opts = {}) {
    await ready();
    const b = await bindFirebase();
    const payload = await _withMeta(data, opts);
    if (b.mode === 'mod') {
      const { collection, addDoc } = b.fns;
      const ref = await addDoc(collection(b.db, colPath), payload);
      return await getDocData(`${colPath}/${ref.id}`);
    } else {
      const ref = await b.db.collection(colPath).add(payload);
      return (await ref.get()).data();
    }
  }

  async function setDocMerge(docPath, data, opts = {}) {
    await ready();
    const b = await bindFirebase();
    const payload = await _withMeta(data, opts);
    if (b.mode === 'mod') {
      const { setDoc, doc } = b.fns;
      await setDoc(doc(b.db, ...docPath.split('/')), payload, { merge: true });
    } else {
      await b.db.doc(docPath).set(payload, { merge: true });
    }
    return true;
  }

  async function updateDocWithMeta(docPath, data) {
    await ready();
    const b = await bindFirebase();
    const patch = { ...(data || {}), updatedAt: await now() };
    if (b.mode === 'mod') {
      const { updateDoc, doc } = b.fns;
      await updateDoc(doc(b.db, ...docPath.split('/')), patch);
    } else {
      await b.db.doc(docPath).update(patch);
    }
    return true;
  }

  async function getDocData(docPath) {
    await ready();
    const b = await bindFirebase();
    if (b.mode === 'mod') {
      const { doc, getDoc } = b.fns;
      const snap = await getDoc(doc(b.db, ...docPath.split('/')));
      return snap.exists() ? ({ id: snap.id, ...snap.data() }) : null;
    } else {
      const snap = await b.db.doc(docPath).get();
      return snap.exists ? ({ id: snap.id, ...snap.data() }) : null;
    }
  }

  async function getWhere(colPath, field, op, value, { limit: lim = 50 } = {}) {
    await ready();
    const b = await bindFirebase();
    if (b.mode === 'mod') {
      const { collection, query, where, limit, getDocs } = b.fns;
      const q = query(collection(b.db, colPath), where(field, op, value), limit(lim));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } else {
      const snap = await b.db.collection(colPath).where(field, op, value).limit(lim).get();
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }
  }

  // ---------- Storage helpers ----------
  const DEFAULT_PREFIX = 'user-uploads'; // conforms to rules match /user-uploads/{uid}/{rest=**}

  function _defaultKey(file, prefix = DEFAULT_PREFIX) {
    const u = uid() || 'anon';
    const name = typeof file === 'string' ? file : (file.name || 'file');
    const base = slug(name.replace(/\.[^.]+$/,''));
    const ext = (name.lastIndexOf('.') > -1) ? name.slice(name.lastIndexOf('.')+1).toLowerCase() : '';
    const folder = dateFolders();
    const id = uuid();
    return `${prefix}/${u}/${folder}/${id}-${base}${ext ? '.'+ext : ''}`;
  }

  async function uploadFile(fileOrBlob, {
    storagePath = null,
    prefix = DEFAULT_PREFIX,
    onProgress = null,
    cacheControl = 'public,max-age=31536000,immutable',
    contentType = null
  } = {}) {
    await ready();
    const b = await bindFirebase();
    const key = storagePath || _defaultKey(fileOrBlob, prefix);

    if (b.mode === 'mod') {
      const { ref, uploadBytesResumable, getDownloadURL } = b.fns;
      const r = ref(b.storage, key);
      const metadata = { cacheControl };
      if (contentType) metadata.contentType = contentType;
      else if (fileOrBlob && fileOrBlob.type) metadata.contentType = fileOrBlob.type;

      return await new Promise((resolve, reject) => {
        const task = uploadBytesResumable(r, fileOrBlob, metadata);
        task.on('state_changed',
          (snap) => {
            if (onProgress && snap.totalBytes) {
              const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
              try { onProgress(pct); } catch(_) {}
            }
          },
          reject,
          async () => {
            const url = await getDownloadURL(r);
            resolve({ path: key, url });
          }
        );
      });
    } else {
      const ref = b.storage.ref().child(key);
      const metadata = { cacheControl };
      if (contentType) metadata.contentType = contentType;
      else if (fileOrBlob && fileOrBlob.type) metadata.contentType = fileOrBlob.type;

      return await new Promise((resolve, reject) => {
        const task = ref.put(fileOrBlob, metadata);
        task.on('state_changed',
          (snap) => {
            if (onProgress && snap.totalBytes) {
              const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
              try { onProgress(pct); } catch(_) {}
            }
          },
          reject,
          async () => {
            const url = await ref.getDownloadURL();
            resolve({ path: key, url });
          }
        );
      });
    }
  }

  async function deleteFile(storagePath) {
    await ready();
    const b = await bindFirebase();
    if (!storagePath) throw new Error('No storage path given.');
    if (b.mode === 'mod') {
      const { ref, deleteObject } = b.fns;
      await deleteObject(ref(b.storage, storagePath));
    } else {
      await b.storage.ref().child(storagePath).delete();
    }
    return true;
  }

  async function getDownloadURL(storagePath) {
    await ready();
    const b = await bindFirebase();
    if (b.mode === 'mod') {
      const { ref, getDownloadURL } = b.fns;
      return await getDownloadURL(ref(b.storage, storagePath));
    } else {
      return await b.storage.ref().child(storagePath).getDownloadURL();
    }
  }

  // ---------- High-level patterns ----------
  async function saveRecordWithFiles({
    docPath,            // "collection/docId"
    data,               // plain object
    files = [],         // File[] or Blob[]
    filePrefix = DEFAULT_PREFIX,
    merge = true
  }) {
    await ready();
    const b = await bindFirebase();

    const uploads = [];
    for (const f of (files || [])) {
      const res = await uploadFile(f, { prefix: filePrefix });
      uploads.push({
        name: (f && f.name) ? f.name : 'file',
        path: res.path,
        url: res.url,
        type: (f && f.type) || '',
        size: (f && f.size) || null,
      });
    }

    const stamp = await now();
    const payload = {
      ...(data || {}),
      // arrayUnion is allowed for owners/admins or doc owner; reads are covered by your rules
      attachments: (bind.mode === 'mod') ? bind.fns.arrayUnion(...uploads) : firebase.firestore.FieldValue.arrayUnion(...uploads),
      updatedAt: stamp
    };
    if (!(data && 'createdAt' in data)) payload.createdAt = stamp;
    if (uid()) payload.uid = payload.uid || uid();

    if (merge) {
      await setDocMerge(docPath, payload, { ownership: true, touched: false });
    } else {
      const full = await _withMeta(payload, { ownership: true, touched: true });
      if (bind.mode === 'mod') {
        const { setDoc, doc } = bind.fns;
        await setDoc(doc(bind.db, ...docPath.split('/')), full);
      } else {
        await bind.db.doc(docPath).set(full);
      }
    }
    const saved = await getDocData(docPath);
    return { doc: saved, uploads };
  }

  async function addRecordWithFiles({
    collectionPath,
    data,
    files = [],
    filePrefix = DEFAULT_PREFIX
  }) {
    await ready();
    const b = await bindFirebase();
    if (b.mode === 'mod') {
      const { collection, addDoc } = b.fns;
      const stamp = await now();
      const base = { ...(data || {}), updatedAt: stamp, createdAt: stamp };
      const me = uid(); if (me) base.uid = base.uid || me;
      const ref = await addDoc(collection(b.db, collectionPath), base);
      await saveRecordWithFiles({ docPath: `${collectionPath}/${ref.id}`, data: {}, files, filePrefix, merge: true });
      return await getDocData(`${collectionPath}/${ref.id}`);
    } else {
      const ref = b.db.collection(collectionPath).doc();
      await saveRecordWithFiles({ docPath: `${collectionPath}/${ref.id}`, data, files, filePrefix, merge: true });
      return await getDocData(`${collectionPath}/${ref.id}`);
    }
  }

  // Feedback screenshots helper to match Storage rules:
  //   feedback/{type}/{$docId}/screenshots/{$fileId}
  async function uploadFeedbackScreenshot({ type = 'ideas', docId, file, onProgress = null }) {
    if (!docId) throw new Error('docId required');
    const base = slug((file && file.name) || 'screenshot');
    const ext  = (file && file.name && file.name.includes('.')) ? file.name.slice(file.name.lastIndexOf('.')+1).toLowerCase() : 'png';
    const fileId = `${uuid()}-${base}.${ext}`;
    const path = `feedback/${type}/${docId}/screenshots/${fileId}`;
    // (Optional) enforce images client-side; your rules can also enforce contentType
    const contentType = file && file.type ? file.type : (ext === 'png' ? 'image/png' : undefined);
    return await uploadFile(file, { storagePath: path, onProgress, contentType });
  }

  // ---------- Public API ----------
  window.FVData = {
    // lifecycle / identity
    ready, isSignedIn, uid, email, isOwner, isAdmin,

    // firestore basic
    addDocWithMeta, setDocMerge, updateDocWithMeta, getDocData, getWhere,

    // storage basic
    uploadFile, deleteFile, getDownloadURL,

    // higher-level
    saveRecordWithFiles, addRecordWithFiles, uploadFeedbackScreenshot
  };
})();