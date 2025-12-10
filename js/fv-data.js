/* FarmVista — fv-data.js v1.2.0
   Long-term stable:
   - FIX: remove undefined reference crash
   - Align storage helpers to firebase-init.js (uploadBytes, uploadBytesResumable, getDownloadURL, deleteObject)
   - Keep meta: uid + createdAt/updatedAt serverTimestamp
   - Keep sugar API: add/list/update/remove with rule-friendly defaults
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

    // Prefer modular init
    try {
      const mod = await import('/Farm-vista/js/firebase-init.js');
      const ctx = mod.ready ? await mod.ready : null;
      const app = (ctx && ctx.app) || (mod.getApp && mod.getApp()) || null;
      const auth = (ctx && ctx.auth) || (mod.getAuth && mod.getAuth()) || null;
      const db = mod.getFirestore ? mod.getFirestore(app) : null;
      const storage = mod.getStorage ? mod.getStorage(app) : null;

      if (app && auth && db) {
        bind = {
          mode: 'mod',
          app, auth, db, storage,
          fns: {
            // firestore
            doc: mod.doc, collection: mod.collection, getDoc: mod.getDoc, getDocs: mod.getDocs,
            addDoc: mod.addDoc, setDoc: mod.setDoc, updateDoc: mod.updateDoc, deleteDoc: mod.deleteDoc,
            query: mod.query, where: mod.where, limit: mod.limit,
            serverTimestamp: mod.serverTimestamp,
            // storage (all available now in v2.3.1)
            ref: mod.ref,
            uploadBytes: mod.uploadBytes,
            uploadBytesResumable: mod.uploadBytesResumable,
            getDownloadURL: mod.getDownloadURL,
            deleteObject: mod.deleteObject
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
        storage: firebase.storage && firebase.storage(),
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
      const key = em.toLowerCase(); // employees are keyed by LOWERCASE email
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
        if (res && res.claims && res.claims.admin === true) return true;
      }
    } catch {}
    if (!_empDoc) _empDoc = await _fetchEmployeeDoc();
    if (_empDoc && typeof _empDoc.permissionGroup === 'string') {
      const g = _empDoc.permissionGroup.toLowerCase();
      if (g === 'admin' || g === 'administrator') return true;
    }
    return false;
  }

  // ---------- lifecycle: mirror auth-guard hydration ----------
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
      const snap = await ref.get();
      return snap.exists ? ({ id: ref.id, ...snap.data() }) : null;
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

  async function deleteDocPath(docPath) {
    await ready();
    const b = await bindFirebase();
    if (b.mode === 'mod') {
      const { deleteDoc, doc } = b.fns;
      await deleteDoc(doc(b.db, ...docPath.split('/')));
    } else {
      await b.db.doc(docPath).delete();
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
      return snap.docs.map(d => {
        const data = d.data() || {};
        return { ...data, id: d.id }; // ensure doc ID always wins
      });
    } else {
      const snap = await b.db.collection(colPath).where(field, op, value).limit(lim).get();
      return snap.docs.map(d => {
        const data = d.data() || {};
        return { ...data, id: d.id }; // ensure doc ID always wins
      });
    }
  }

  // ---------- Storage helpers ----------
  const DEFAULT_PREFIX = 'user-uploads';

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
    contentType = null,
    resumable = true
  } = {}) {
    await ready();
    const b = await bindFirebase();
    if (!b.storage || !b.fns.ref) throw new Error('Storage not available');

    const key = storagePath || _defaultKey(fileOrBlob, prefix);
    const r = b.fns.ref(b.storage, key);

    // Choose resumable (preferred) or simple upload
    if (resumable && b.fns.uploadBytesResumable) {
      const task = b.fns.uploadBytesResumable(r, fileOrBlob, {
        cacheControl,
        contentType: contentType || (fileOrBlob && fileOrBlob.type) || undefined
      });
      return await new Promise((resolve, reject) => {
        task.on('state_changed',
          (snap) => {
            if (onProgress && snap.totalBytes) {
              try { onProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)); } catch {}
            }
          },
          reject,
          async () => {
            const url = await b.fns.getDownloadURL(r);
            resolve({ path: key, url });
          }
        );
      });
    } else if (b.fns.uploadBytes) {
      await b.fns.uploadBytes(r, fileOrBlob, {
        cacheControl,
        contentType: contentType || (fileOrBlob && fileOrBlob.type) || undefined
      });
      const url = await b.fns.getDownloadURL(r);
      return { path: key, url };
    } else {
      throw new Error('No upload method available');
    }
  }

  async function deleteFile(storagePath) {
    await ready();
    const b = await bindFirebase();
    if (!storagePath) throw new Error('No storage path given.');
    if (!b.storage || !b.fns.ref) throw new Error('Storage not available');
    if (!b.fns.deleteObject) throw new Error('deleteObject not available');
    const r = b.fns.ref(b.storage, storagePath);
    await b.fns.deleteObject(r);
    return true;
  }

  async function getDownloadURL(storagePath) {
    await ready();
    const b = await bindFirebase();
    if (!b.storage || !b.fns.ref || !b.fns.getDownloadURL) throw new Error('Storage not available');
    const r = b.fns.ref(b.storage, storagePath);
    return await b.fns.getDownloadURL(r);
  }

  // ---------- High-level patterns ----------
  async function saveRecordWithFiles({
    docPath,
    data,
    files = [],
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
      attachments: uploads, // keep simple array; your rules allow arrayUnion too for admins
      updatedAt: stamp
    };
    if (!(data && 'createdAt' in data)) payload.createdAt = stamp;
    if (uid()) payload.uid = payload.uid || uid();

    if (merge) {
      await setDocMerge(docPath, payload, { ownership: true, touched: false });
    } else {
      const full = await _withMeta(payload, { ownership: true, touched: true });
      const bmod = await bindFirebase();
      if (bmod.mode === 'mod') {
        const { setDoc, doc } = bmod.fns;
        await setDoc(doc(bmod.db, ...docPath.split('/')), full);
      } else {
        await bmod.db.doc(docPath).set(full);
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

  // (Optional) tiny helper to avoid the previous undefined crash.
  async function uploadFeedbackScreenshot() { return null; }

  // ---------- Public API ----------
  window.FVData = {
    // lifecycle / identity
    ready, isSignedIn, uid, email, isOwner, isAdmin,

    // firestore basic
    addDocWithMeta, setDocMerge, updateDocWithMeta, getDocData, getWhere, deleteDocPath,

    // storage basic
    uploadFile, deleteFile, getDownloadURL,

    // higher-level
    saveRecordWithFiles, addRecordWithFiles, uploadFeedbackScreenshot,

    // sugar
    async add(col, data) {
      return await addDocWithMeta(col, data);
    },
    async list(col, opts = {}) {
      const { limit = 500, mine = true } = opts;
      if (mine !== false) {
        const me = uid();
        if (!me) { await ready(); }
        return await getWhere(col, 'uid', '==', uid(), { limit });
      }
      return await getWhere(col, 'uid', '>=', '', { limit });
    },
    async update(col, id, patch) {
      return await setDocMerge(`${col}/${id}`, patch);
    },
    async remove(col, id) {
      return await deleteDocPath(`${col}/${id}`);
    }
  };
})();
