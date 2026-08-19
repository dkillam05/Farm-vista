/**
 * FarmVista — firebase-init.js
 * v2.4.0
 *
 * v2.4.0
 * - Adds Firebase Phone Authentication support
 * - Adds createRecaptchaVerifier()
 * - Adds signInWithPhoneNumber()
 *
 * v2.3.1
 * - Storage exports + FV_HAS_STORAGE
 */

const CDN_BASE =
  "https://www.gstatic.com/firebasejs/10.12.5/";

const CDN_APP =
  `${CDN_BASE}firebase-app.js`;

const CDN_AUTH =
  `${CDN_BASE}firebase-auth.js`;

const CDN_STORE =
  `${CDN_BASE}firebase-firestore.js`;

const CDN_STORAGE =
  `${CDN_BASE}firebase-storage.js`;


const STUB_USER_KEY =
  "fv:stub:user";

const STUB_ACCOUNT_KEY =
  "fv:stub:accounts";

const STUB_STORE_KEY =
  "fv:stub:firestore";


const toStr =
  value =>
    typeof value ===
      "string"
      ? value.trim()
      : "";


const clone =
  value => {

    try {

      return (
        typeof structuredClone ===
          "function"
          ? structuredClone(
              value
            )
          : JSON.parse(
              JSON.stringify(
                value
              )
            )
      );

    }
    catch {

      return JSON.parse(
        JSON.stringify(
          value
        )
      );

    }

  };


const randomId =
  () =>
    Math.random()
      .toString(36)
      .slice(2,11) +
    Math.random()
      .toString(36)
      .slice(2,11);


// ==========================================================
// USER SANITIZER
// ==========================================================

const sanitizeUser =
  user => {

    if (
      !user
    ) {

      return null;

    }


    const email =
      toStr(
        user.email
      );


    const phoneNumber =
      toStr(
        user.phoneNumber
      );


    const displayName =
      toStr(
        user.displayName
      ) ||
      toStr(
        user.name
      ) ||
      (
        email
          ? email.split("@")[0]
          : phoneNumber ||
            "FarmVista User"
      );


    return {

      uid:
        toStr(
          user.uid
        ) ||
        `stub-${randomId()}`,

      displayName,

      email,

      photoURL:
        toStr(
          user.photoURL
        ),

      phoneNumber,

      isAnonymous:
        false

    };

  };


// ==========================================================
// STUB AUTH
// ==========================================================

const loadStubUser =
  () => {

    try {

      const raw =
        localStorage.getItem(
          STUB_USER_KEY
        );


      if (
        raw
      ) {

        return sanitizeUser(
          JSON.parse(
            raw
          )
        );

      }

    }
    catch (
      error
    ) {

      console.warn(
        "[FV] stub auth storage read failed:",
        error
      );

    }


    if (
      window.FV_DEFAULT_USER
    ) {

      return sanitizeUser(
        window.FV_DEFAULT_USER
      );

    }


    return sanitizeUser(
      {
        displayName:
          "FarmVista User"
      }
    );

  };


const saveStubUser =
  user => {

    try {

      if (
        user
      ) {

        localStorage.setItem(
          STUB_USER_KEY,
          JSON.stringify(
            user
          )
        );

      }
      else {

        localStorage.removeItem(
          STUB_USER_KEY
        );

      }

    }
    catch (
      error
    ) {

      console.warn(
        "[FV] stub auth storage write failed:",
        error
      );

    }

  };


const loadStubAccounts =
  () => {

    try {

      const raw =
        localStorage.getItem(
          STUB_ACCOUNT_KEY
        );


      if (
        !raw
      ) {

        return {};

      }


      const parsed =
        JSON.parse(
          raw
        );


      return (
        parsed &&
        typeof parsed ===
          "object"
          ? parsed
          : {}
      );

    }
    catch {

      return {};

    }

  };


const saveStubAccounts =
  map => {

    try {

      localStorage.setItem(
        STUB_ACCOUNT_KEY,
        JSON.stringify(
          map
        )
      );

    }
    catch (
      error
    ) {

      console.warn(
        "[FV] stub account storage write failed:",
        error
      );

    }

  };


const digestText =
  async text => {

    try {

      if (
        crypto &&
        crypto.subtle &&
        typeof TextEncoder !==
          "undefined"
      ) {

        const data =
          new TextEncoder().encode(
            text
          );


        const buffer =
          await crypto.subtle.digest(
            "SHA-256",
            data
          );


        return Array
          .from(
            new Uint8Array(
              buffer
            )
          )
          .map(
            byte =>
              byte
                .toString(16)
                .padStart(
                  2,
                  "0"
                )
          )
          .join("");

      }

    }
    catch {}


    let hash =
      0;


    for (
      let i = 0;
      i < text.length;
      i++
    ) {

      hash =
        (
          hash << 5
        ) -
        hash +
        text.charCodeAt(
          i
        );


      hash |=
        0;

    }


    return Math
      .abs(
        hash
      )
      .toString(16);

  };


const ensureStubAccountRecord =
  async (
    user,
    password
  ) => {

    if (
      !user ||
      !user.email
    ) {

      return;

    }


    const map =
      loadStubAccounts();


    const key =
      user.email.toLowerCase();


    if (
      !map[key]
    ) {

      const salt =
        randomId();


      const hash =
        await digestText(
          (
            password ||
            "FarmVista!"
          ) +
          "::" +
          salt
        );


      map[key] = {

        uid:
          user.uid,

        email:
          user.email,

        displayName:
          user.displayName,

        salt,

        hash,

        updatedAt:
          Date.now()

      };


      saveStubAccounts(
        map
      );

    }

  };


const stubSubscribe =
  (
    authInstance,
    callback
  ) => {

    if (
      !authInstance ||
      typeof callback !==
        "function"
    ) {

      return () => {};

    }


    authInstance._listeners.add(
      callback
    );


    try {

      callback(
        authInstance.currentUser
      );

    }
    catch (
      error
    ) {

      console.error(
        "[FV] stub auth callback error:",
        error
      );

    }


    return () =>
      authInstance._listeners.delete(
        callback
      );

  };


const createStubAuth =
  () => {

    const listeners =
      new Set();


    const auth = {

      currentUser:
        loadStubUser(),

      _listeners:
        listeners,


      async signOut(){

        auth.currentUser =
          null;


        saveStubUser(
          null
        );


        auth._emit();


        return Promise.resolve();

      },


      async _setUser(
        user,
        password
      ){

        auth.currentUser =
          sanitizeUser(
            user
          );


        saveStubUser(
          auth.currentUser
        );


        await ensureStubAccountRecord(
          auth.currentUser,
          password
        );


        auth._emit();


        return auth.currentUser;

      },


      _emit(){

        window.__FV_USER =
          auth.currentUser ||
          null;


        listeners.forEach(
          callback => {

            try {

              callback(
                auth.currentUser
              );

            }
            catch (
              error
            ) {

              console.error(
                "[FV] stub auth listener error:",
                error
              );

            }

          }
        );

      }

    };


    auth._emit();


    return auth;

  };


const stubSignIn =
  async (
    authInstance,
    email,
    password
  ) => {

    const map =
      loadStubAccounts();


    const key =
      (
        email ||
        ""
      ).toLowerCase();


    const entry =
      map[key];


    if (
      !entry
    ) {

      const error =
        new Error(
          "User not found"
        );


      error.code =
        "auth/user-not-found";


      throw error;

    }


    const hash =
      await digestText(
        (
          password ||
          ""
        ) +
        "::" +
        entry.salt
      );


    if (
      hash !==
      entry.hash
    ) {

      const error =
        new Error(
          "Wrong password"
        );


      error.code =
        "auth/wrong-password";


      throw error;

    }


    const user =
      sanitizeUser(
        {

          uid:
            entry.uid,

          email:
            entry.email,

          displayName:
            entry.displayName

        }
      );


    await authInstance._setUser(
      user,
      password
    );


    return {
      user
    };

  };


const stubCreateUser =
  async (
    authInstance,
    email,
    password,
    opts = {}
  ) => {

    const map =
      loadStubAccounts();


    const key =
      (
        email ||
        ""
      ).toLowerCase();


    if (
      !key
    ) {

      const error =
        new Error(
          "Invalid email"
        );


      error.code =
        "auth/invalid-email";


      throw error;

    }


    if (
      map[key]
    ) {

      const error =
        new Error(
          "Email already in use"
        );


      error.code =
        "auth/email-already-in-use";


      throw error;

    }


    const salt =
      randomId();


    const hash =
      await digestText(
        (
          password ||
          ""
        ) +
        "::" +
        salt
      );


    const user =
      sanitizeUser(
        {

          uid:
            `stub-${randomId()}`,

          email,

          displayName:
            opts.displayName ||
            (
              email
                ? email.split("@")[0]
                : "FarmVista User"
            )

        }
      );


    map[key] = {

      uid:
        user.uid,

      email:
        user.email,

      displayName:
        user.displayName,

      salt,

      hash,

      updatedAt:
        Date.now()

    };


    saveStubAccounts(
      map
    );


    await authInstance._setUser(
      user,
      password
    );


    return {
      user
    };

  };


const stubSendPasswordResetEmail =
  async email => {

    console.info(
      "[FV] stub reset password for",
      email
    );


    return Promise.resolve();

  };


const stubUpdateProfile =
  async (
    user,
    data
  ) => {

    if (
      !user
    ) {

      return;

    }


    const map =
      loadStubAccounts();


    const key =
      (
        user.email ||
        ""
      ).toLowerCase();


    if (
      map[key]
    ) {

      map[key].displayName =
        data.displayName ||
        map[key].displayName;


      map[key].updatedAt =
        Date.now();


      saveStubAccounts(
        map
      );

    }


    const current =
      sanitizeUser(
        {
          ...user,
          ...data
        }
      );


    await stubAuth._setUser(
      current
    );


    return current;

  };


const stubAuth =
  createStubAuth();


// ==========================================================
// STUB FIRESTORE
// ==========================================================

const loadStubStore =
  () => {

    try {

      const raw =
        localStorage.getItem(
          STUB_STORE_KEY
        );


      if (
        !raw
      ) {

        return {};

      }


      const data =
        JSON.parse(
          raw
        );


      return (
        data &&
        typeof data ===
          "object"
          ? data
          : {}
      );

    }
    catch {

      return {};

    }

  };


const stubFirestoreData =
  loadStubStore();


const stubDocListeners =
  new Map();


const stubCollectionListeners =
  new Map();


const persistStubStore =
  () => {

    try {

      localStorage.setItem(
        STUB_STORE_KEY,
        JSON.stringify(
          stubFirestoreData
        )
      );

    }
    catch (
      error
    ) {

      console.warn(
        "[FV] stub firestore storage write failed:",
        error
      );

    }

  };


const flatten =
  input => {

    const out =
      [];


    (
      function walk(
        item
      ){

        if (
          Array.isArray(
            item
          )
        ) {

          item.forEach(
            walk
          );

        }
        else if (
          item !==
            undefined &&
          item !==
            null
        ) {

          out.push(
            String(
              item
            )
          );

        }

      }
    )(
      input
    );


    return out;

  };


const normalizePath =
  parts =>
    flatten(
      parts
    )
    .filter(
      Boolean
    )
    .join("/");


const stubDocRef =
  path => ({

    firestore:
      stubFirestore,

    type:
      "doc",

    path,

    id:
      path
        .split("/")
        .pop() ||
      path

  });


const stubCollectionRef =
  path => ({

    firestore:
      stubFirestore,

    type:
      "collection",

    path,

    id:
      path
        .split("/")
        .pop() ||
      path

  });


const stubQueryRef =
  (
    source,
    constraints = []
  ) => ({

    firestore:
      stubFirestore,

    type:
      "query",

    source,

    constraints

  });


const stubDocSnapshot =
  path => {

    const data =
      stubFirestoreData[path];


    return {

      id:
        path
          .split("/")
          .pop() ||
        path,

      ref:
        stubDocRef(
          path
        ),

      exists:
        () =>
          data !==
          undefined,

      data:
        () =>
          data !==
            undefined
            ? clone(
                data
              )
            : undefined

    };

  };


const collectDocsUnder =
  collectionPath => {

    const docs =
      [];


    const prefix =
      collectionPath.endsWith(
        "/"
      )
        ? collectionPath
        : `${collectionPath}/`;


    Object
      .keys(
        stubFirestoreData
      )
      .forEach(
        key => {

          if (
            !key.startsWith(
              prefix
            )
          ) {

            return;

          }


          const remainder =
            key.slice(
              prefix.length
            );


          if (
            remainder.includes(
              "/"
            )
          ) {

            return;

          }


          docs.push(
            stubDocSnapshot(
              key
            )
          );

        }
      );


    return docs;

  };


const stubCollectionSnapshot =
  collectionPath => {

    const docs =
      collectDocsUnder(
        collectionPath
      );


    return {

      docs,

      size:
        docs.length,

      empty:
        docs.length ===
        0,

      forEach:
        callback =>
          docs.forEach(
            snapshot =>
              callback(
                snapshot
              )
          )

    };

  };


const notifyDocListeners =
  path => {

    const listeners =
      stubDocListeners.get(
        path
      );


    if (
      listeners &&
      listeners.size
    ) {

      const snapshot =
        stubDocSnapshot(
          path
        );


      listeners.forEach(
        callback => {

          try {

            callback(
              snapshot
            );

          }
          catch (
            error
          ) {

            console.error(
              "[FV] stub doc listener error:",
              error
            );

          }

        }
      );

    }


    const index =
      path.lastIndexOf(
        "/"
      );


    if (
      index > 0
    ) {

      notifyCollectionListeners(
        path.slice(
          0,
          index
        )
      );

    }

  };


function notifyCollectionListeners(
  path
){

  const listeners =
    stubCollectionListeners.get(
      path
    );


  if (
    listeners &&
    listeners.size
  ) {

    const snapshot =
      stubCollectionSnapshot(
        path
      );


    listeners.forEach(
      callback => {

        try {

          callback(
            snapshot
          );

        }
        catch (
          error
        ) {

          console.error(
            "[FV] stub collection listener error:",
            error
          );

        }

      }
    );

  }

}


const stubSetDoc =
  (
    path,
    value,
    merge = false
  ) => {

    if (
      merge &&
      stubFirestoreData[path]
    ) {

      stubFirestoreData[path] = {

        ...stubFirestoreData[path],

        ...clone(
          value
        )

      };

    }
    else {

      stubFirestoreData[path] =
        clone(
          value
        );

    }


    persistStubStore();

    notifyDocListeners(
      path
    );

  };


const stubDeleteDoc =
  path => {

    if (
      path in
      stubFirestoreData
    ) {

      delete stubFirestoreData[path];


      persistStubStore();

      notifyDocListeners(
        path
      );

    }

  };


const stubFirestore = {

  _type:
    "stub",

  persistence:
    "local"

};


// ==========================================================
// RUNTIME GLOBALS
// ==========================================================

let app =
  null;

let auth =
  stubAuth;

let firestore =
  stubFirestore;

let authModule =
  null;

let storeModule =
  null;

let storageModule =
  null;


export let mode =
  "stub";


// ==========================================================
// AUTH IMPLEMENTATIONS
// ==========================================================

let onAuthStateChangedImpl =
  (
    instance,
    callback
  ) =>
    stubSubscribe(
      instance ||
      auth,
      callback
    );


let onIdTokenChangedImpl =
  (
    instance,
    callback
  ) =>
    stubSubscribe(
      instance ||
      auth,
      callback
    );


let signOutImpl =
  instance =>
    (
      instance ||
      auth
    ).signOut();


let getAuthImpl =
  () =>
    auth;


let signInWithEmailAndPasswordImpl =
  (
    instance,
    email,
    password
  ) =>
    stubSignIn(
      instance ||
      auth,
      email,
      password
    );


let createUserWithEmailAndPasswordImpl =
  (
    instance,
    email,
    password,
    opts
  ) =>
    stubCreateUser(
      instance ||
      auth,
      email,
      password,
      opts
    );


let sendPasswordResetEmailImpl =
  (
    instance,
    email
  ) =>
    stubSendPasswordResetEmail(
      email,
      instance ||
      auth
    );


let updateProfileImpl =
  (
    user,
    data
  ) =>
    stubUpdateProfile(
      user,
      data
    );


let setPersistenceImpl =
  () =>
    Promise.resolve();


let browserLocalPersistenceValue = {
  type:
    "stub-local"
};


// ==========================================================
// PHONE AUTH IMPLEMENTATIONS
// ==========================================================

let createRecaptchaVerifierImpl =
  () => {

    const error =
      new Error(
        "Phone authentication is unavailable in stub mode."
      );


    error.code =
      "auth/operation-not-supported-in-this-environment";


    throw error;

  };


let signInWithPhoneNumberImpl =
  async () => {

    const error =
      new Error(
        "Phone authentication is unavailable in stub mode."
      );


    error.code =
      "auth/operation-not-supported-in-this-environment";


    throw error;

  };


// ==========================================================
// FIRESTORE IMPLEMENTATIONS
// ==========================================================

const docImpl =
  (...args) => {

    if (
      storeModule
    ) {

      return storeModule.doc(
        ...args
      );

    }


    if (
      !args.length
    ) {

      throw new Error(
        "doc() requires arguments"
      );

    }


    const [
      first,
      ...rest
    ] =
      args;


    if (
      first &&
      first.type ===
        "collection" &&
      first.firestore ===
        stubFirestore
    ) {

      if (
        !rest.length
      ) {

        throw new Error(
          "doc() requires an id when using a collection reference"
        );

      }


      return stubDocRef(
        `${first.path}/${rest[0]}`
      );

    }


    if (
      first &&
      first._type ===
        "stub"
    ) {

      const path =
        normalizePath(
          rest
        );


      return stubDocRef(
        path
      );

    }


    const path =
      normalizePath(
        [
          first,
          ...rest
        ]
      );


    return stubDocRef(
      path
    );

  };


const collectionImpl =
  (...args) => {

    if (
      storeModule
    ) {

      return storeModule.collection(
        ...args
      );

    }


    if (
      !args.length
    ) {

      throw new Error(
        "collection() requires arguments"
      );

    }


    const [
      first,
      ...rest
    ] =
      args;


    if (
      first &&
      first.type ===
        "doc" &&
      first.firestore ===
        stubFirestore
    ) {

      const path =
        normalizePath(
          [
            first.path,
            ...rest
          ]
        );


      return stubCollectionRef(
        path
      );

    }


    if (
      first &&
      first._type ===
        "stub"
    ) {

      const path =
        normalizePath(
          rest
        );


      return stubCollectionRef(
        path
      );

    }


    const path =
      normalizePath(
        [
          first,
          ...rest
        ]
      );


    return stubCollectionRef(
      path
    );

  };


const getDocImpl =
  async ref => {

    if (
      storeModule
    ) {

      return storeModule.getDoc(
        ref
      );

    }


    return stubDocSnapshot(
      ref.path
    );

  };


const setDocImpl =
  async (
    ref,
    data,
    opts
  ) => {

    if (
      storeModule
    ) {

      return storeModule.setDoc(
        ref,
        data,
        opts
      );

    }


    stubSetDoc(
      ref.path,
      data,
      opts &&
      opts.merge
    );

  };


const updateDocImpl =
  async (
    ref,
    data
  ) => {

    if (
      storeModule
    ) {

      return storeModule.updateDoc(
        ref,
        data
      );

    }


    stubSetDoc(
      ref.path,
      data,
      true
    );

  };


const addDocImpl =
  async (
    ref,
    data
  ) => {

    if (
      storeModule
    ) {

      return storeModule.addDoc(
        ref,
        data
      );

    }


    const id =
      randomId();


    const docRef =
      stubDocRef(
        `${ref.path}/${id}`
      );


    stubSetDoc(
      docRef.path,
      data,
      false
    );


    return docRef;

  };


const deleteDocImpl =
  async ref => {

    if (
      storeModule &&
      typeof storeModule.deleteDoc ===
        "function"
    ) {

      return storeModule.deleteDoc(
        ref
      );

    }


    stubDeleteDoc(
      ref.path
    );

  };


const getDocsImpl =
  async target => {

    if (
      storeModule
    ) {

      return storeModule.getDocs(
        target
      );

    }


    if (
      target.type ===
      "query"
    ) {

      return stubCollectionSnapshot(
        target.source.path
      );

    }


    if (
      target.type ===
      "collection"
    ) {

      return stubCollectionSnapshot(
        target.path
      );

    }


    throw new Error(
      "Unsupported target for getDocs in stub mode"
    );

  };


const onSnapshotImpl =
  (
    target,
    callback
  ) => {

    if (
      storeModule
    ) {

      return storeModule.onSnapshot(
        target,
        callback
      );

    }


    if (
      !target ||
      typeof callback !==
        "function"
    ) {

      return () => {};

    }


    if (
      target.type ===
      "doc"
    ) {

      const set =
        stubDocListeners.get(
          target.path
        ) ||
        new Set();


      set.add(
        callback
      );


      stubDocListeners.set(
        target.path,
        set
      );


      Promise
        .resolve()
        .then(
          () =>
            callback(
              stubDocSnapshot(
                target.path
              )
            )
        );


      return () => {

        set.delete(
          callback
        );


        if (
          !set.size
        ) {

          stubDocListeners.delete(
            target.path
          );

        }

      };

    }


    if (
      target.type ===
      "query"
    ) {

      return onSnapshotImpl(
        target.source,
        callback
      );

    }


    if (
      target.type ===
      "collection"
    ) {

      const set =
        stubCollectionListeners.get(
          target.path
        ) ||
        new Set();


      set.add(
        callback
      );


      stubCollectionListeners.set(
        target.path,
        set
      );


      Promise
        .resolve()
        .then(
          () =>
            callback(
              stubCollectionSnapshot(
                target.path
              )
            )
        );


      return () => {

        set.delete(
          callback
        );


        if (
          !set.size
        ) {

          stubCollectionListeners.delete(
            target.path
          );

        }

      };

    }


    return () => {};

  };


const serverTimestampImpl =
  () =>
    storeModule
      ? storeModule.serverTimestamp()
      : new Date().toISOString();


const queryImpl =
  (...args) =>
    storeModule
      ? storeModule.query(
          ...args
        )
      : stubQueryRef(
          args[0],
          args.slice(1)
        );


const whereImpl =
  (...args) =>
    storeModule
      ? storeModule.where(
          ...args
        )
      : {
          type:
            "where",
          args
        };


const orderByImpl =
  (...args) =>
    storeModule
      ? storeModule.orderBy(
          ...args
        )
      : {
          type:
            "orderBy",
          args
        };


const limitImpl =
  (...args) =>
    storeModule
      ? storeModule.limit(
          ...args
        )
      : {
          type:
            "limit",
          args
        };


// ==========================================================
// GLOBAL HELPERS
// ==========================================================

const ensureStubGlobals =
  () => {

    if (
      !window.firebase
    ) {

      window.firebase = {};

    }


    if (
      !window.firebase.auth
    ) {

      window.firebase.auth =
        () =>
          auth;

    }


    if (
      !window.firebase.firestore
    ) {

      window.firebase.firestore =
        () =>
          firestore;

    }


    window.firebaseAuth =
      auth;

    window.firebaseApp =
      app;

    window.firebaseFirestore =
      firestore;


    window.fvSignOut =
      () =>
        auth &&
        typeof auth.signOut ===
          "function"
          ? auth.signOut()
          : Promise.resolve();

  };


const updateWindowUser =
  user => {

    window.__FV_USER =
      user
        ? sanitizeUser(
            user
          )
        : null;


    try {

      document.dispatchEvent(
        new CustomEvent(
          "fv:user",
          {
            detail:
              window.__FV_USER
          }
        )
      );

    }
    catch (
      error
    ) {

      console.warn(
        "[FV] dispatch fv:user failed:",
        error
      );

    }

  };


// ==========================================================
// REFRESH BUS
// ==========================================================

export const RefreshBus = {

  _fns:
    new Set(),


  register(
    fn
  ){

    if (
      typeof fn ===
      "function"
    ) {

      this._fns.add(
        fn
      );

    }


    return () =>
      this._fns.delete(
        fn
      );

  },


  async runAll(){

    for (
      const fn
      of Array.from(
        this._fns
      )
    ) {

      try {

        await fn();

      }
      catch (
        error
      ) {

        console.warn(
          "[FV] refresh fn failed",
          error
        );

      }

    }

  }

};


ensureStubGlobals();


onAuthStateChangedImpl(
  auth,
  user =>
    updateWindowUser(
      user
    )
);


// ==========================================================
// FIREBASE READY
// ==========================================================

export const ready =
  (
    async () => {

      const waitForConfig =
        async (
          ms = 2500
        ) => {

          const start =
            Date.now();


          while (
            Date.now() -
              start <
            ms
          ) {

            if (
              window.FV_FIREBASE_CONFIG
            ) {

              return window.FV_FIREBASE_CONFIG;

            }


            await new Promise(
              resolve =>
                setTimeout(
                  resolve,
                  50
                )
            );

          }


          return (
            window.FV_FIREBASE_CONFIG ||
            null
          );

        };


      const cfg =
        await waitForConfig(
          2500
        );


      if (
        !cfg
      ) {

        const online =
          (() => {

            try {

              return navigator.onLine !==
                false;

            }
            catch {

              return true;

            }

          })();


        mode =
          "stub";


        ensureStubGlobals();


        window.FV_HAS_STORAGE =
          false;


        if (
          online
        ) {

          console.warn(
            "[FV] Firebase config missing while online. Likely stale cached JS/SW. Running in stub mode."
          );


          window.__FV_FIREBASE_CONFIG_MISSING =
            true;

        }


        return {

          app,

          auth,

          firestore,

          mode

        };

      }


      try {

        const [
          {
            initializeApp
          },
          authMod,
          storeMod,
          storageMod
        ] =
          await Promise.all(
            [

              import(
                CDN_APP
              ),

              import(
                CDN_AUTH
              ),

              import(
                CDN_STORE
              ),

              import(
                CDN_STORAGE
              )

            ]
          );


        authModule =
          authMod;

        storeModule =
          storeMod;

        storageModule =
          storageMod;


        app =
          initializeApp(
            cfg
          );


        auth =
          authMod.getAuth(
            app
          );


        firestore =
          storeMod.initializeFirestore(
            app,
            {

              experimentalForceLongPolling:
                true,

              useFetchStreams:
                false

            }
          );


        mode =
          "firebase";


        try {

          await authMod.setPersistence(
            auth,
            authMod.browserLocalPersistence
          );

        }
        catch (
          error
        ) {

          console.warn(
            "[FV] setPersistence failed (non-fatal):",
            error
          );

        }


        getAuthImpl =
          appInstance =>
            authMod.getAuth(
              appInstance ||
              app
            );


        onAuthStateChangedImpl =
          (
            instance,
            callback
          ) =>
            authMod.onAuthStateChanged(
              instance ||
              auth,
              callback
            );


        onIdTokenChangedImpl =
          (
            instance,
            callback
          ) =>
            authMod.onIdTokenChanged(
              instance ||
              auth,
              callback
            );


        signOutImpl =
          instance =>
            authMod.signOut(
              instance ||
              auth
            );


        signInWithEmailAndPasswordImpl =
          (
            instance,
            email,
            password
          ) =>
            authMod.signInWithEmailAndPassword(
              instance ||
              auth,
              email,
              password
            );


        createUserWithEmailAndPasswordImpl =
          async (
            instance,
            email,
            password,
            opts
          ) => {

            const authInstance =
              instance ||
              auth;


            const credential =
              await authMod.createUserWithEmailAndPassword(
                authInstance,
                email,
                password
              );


            if (
              opts &&
              opts.displayName
            ) {

              try {

                await authMod.updateProfile(
                  credential.user,
                  {
                    displayName:
                      opts.displayName
                  }
                );

              }
              catch (
                error
              ) {

                console.warn(
                  "[FV] displayName update failed:",
                  error
                );

              }

            }


            return credential;

          };


        sendPasswordResetEmailImpl =
          (
            instance,
            email
          ) =>
            authMod.sendPasswordResetEmail(
              instance ||
              auth,
              email
            );


        updateProfileImpl =
          (
            user,
            data
          ) =>
            authMod.updateProfile(
              user,
              data
            );


        setPersistenceImpl =
          (
            instance,
            persistence
          ) =>
            authMod.setPersistence(
              instance ||
              auth,
              persistence
            );


        browserLocalPersistenceValue =
          authMod.browserLocalPersistence;


        // ================================================
        // PHONE AUTH
        // ================================================

        createRecaptchaVerifierImpl =
          (
            instance,
            containerOrId,
            parameters = {}
          ) =>
            new authMod.RecaptchaVerifier(
              instance ||
              auth,
              containerOrId,
              parameters
            );


        signInWithPhoneNumberImpl =
          (
            instance,
            phoneNumber,
            appVerifier
          ) =>
            authMod.signInWithPhoneNumber(
              instance ||
              auth,
              phoneNumber,
              appVerifier
            );


        ensureStubGlobals();


        window.firebaseApp =
          app;

        window.firebaseAuth =
          auth;

        window.firebaseFirestore =
          firestore;


        window.fvSignOut =
          () =>
            authMod.signOut(
              auth
            );


        window.FV_HAS_STORAGE =
          Boolean(
            storageModule
          );


        onAuthStateChangedImpl(
          auth,
          user =>
            updateWindowUser(
              user
            )
        );


        window.__FV_FIREBASE_MODE =
          "firebase";


        return {

          app,

          auth,

          firestore,

          mode

        };

      }
      catch (
        error
      ) {

        const online =
          (() => {

            try {

              return navigator.onLine !==
                false;

            }
            catch {

              return true;

            }

          })();


        console.warn(
          "[FV] Firebase init failed.",
          error
        );


        if (
          online
        ) {

          window.__FV_FIREBASE_INIT_FAILED =
            true;

        }


        app =
          null;

        auth =
          stubAuth;

        firestore =
          stubFirestore;

        mode =
          "stub";

        authModule =
          null;

        storeModule =
          null;

        storageModule =
          null;


        ensureStubGlobals();


        window.FV_HAS_STORAGE =
          false;

        window.__FV_FIREBASE_MODE =
          "stub";


        return {

          app,

          auth,

          firestore,

          mode

        };

      }

    }
  )();


// ==========================================================
// SOFT REFRESH
// ==========================================================

async function _softRefreshNow(){

  try {

    if (
      mode ===
        "firebase" &&
      storeModule &&
      firestore
    ) {

      try {

        await storeModule.enableNetwork(
          firestore
        );

      }
      catch {}


      try {

        await storeModule.disableNetwork(
          firestore
        );

      }
      catch {}


      try {

        await storeModule.enableNetwork(
          firestore
        );

      }
      catch {}

    }

  }
  catch (
    error
  ) {

    console.warn(
      "[FV] refresh network nudge failed",
      error
    );

  }


  try {

    await RefreshBus.runAll();

  }
  catch {}


  try {

    document.dispatchEvent(
      new CustomEvent(
        "fv:refreshed"
      )
    );

  }
  catch {}

}


document.addEventListener(
  "fv:refresh",
  () => {

    _softRefreshNow();

  }
);


// ==========================================================
// PUBLIC AUTH API
// ==========================================================

export const getApp =
  () =>
    app;


export const getAuth =
  appInstance =>
    getAuthImpl(
      appInstance
    );


export const onAuthStateChanged =
  (
    instance,
    callback
  ) =>
    onAuthStateChangedImpl(
      instance ||
      auth,
      callback
    );


export const onIdTokenChanged =
  (
    instance,
    callback
  ) =>
    onIdTokenChangedImpl(
      instance ||
      auth,
      callback
    );


export const signOut =
  instance =>
    signOutImpl(
      instance ||
      auth
    );


export const isStub =
  () =>
    mode !==
    "firebase";


export const signInWithEmailAndPassword =
  (
    instance,
    email,
    password
  ) =>
    signInWithEmailAndPasswordImpl(
      instance ||
      auth,
      email,
      password
    );


export const createUserWithEmailAndPassword =
  (
    instance,
    email,
    password,
    opts
  ) =>
    createUserWithEmailAndPasswordImpl(
      instance ||
      auth,
      email,
      password,
      opts
    );


export const sendPasswordResetEmail =
  (
    instance,
    email
  ) =>
    sendPasswordResetEmailImpl(
      instance ||
      auth,
      email
    );


export const updateProfile =
  (
    user,
    data
  ) =>
    updateProfileImpl(
      user,
      data
    );


export const setPersistence =
  (
    instance,
    persistence
  ) =>
    setPersistenceImpl(
      instance ||
      auth,
      persistence
    );


export const browserLocalPersistence =
  () =>
    browserLocalPersistenceValue;


// ==========================================================
// PUBLIC PHONE AUTH API
// ==========================================================

export const createRecaptchaVerifier =
  (
    instance,
    containerOrId,
    parameters = {}
  ) =>
    createRecaptchaVerifierImpl(
      instance ||
      auth,
      containerOrId,
      parameters
    );


export const signInWithPhoneNumber =
  (
    instance,
    phoneNumber,
    appVerifier
  ) =>
    signInWithPhoneNumberImpl(
      instance ||
      auth,
      phoneNumber,
      appVerifier
    );


// ==========================================================
// PUBLIC FIRESTORE API
// ==========================================================

export const getFirestore =
  appInstance =>
    storeModule
      ? storeModule.getFirestore(
          appInstance ||
          app
        )
      : firestore;


export const doc =
  (...args) =>
    docImpl(
      ...args
    );


export const collection =
  (...args) =>
    collectionImpl(
      ...args
    );


export const getDoc =
  ref =>
    getDocImpl(
      ref
    );


export const setDoc =
  (
    ref,
    data,
    opts
  ) =>
    setDocImpl(
      ref,
      data,
      opts
    );


export const updateDoc =
  (
    ref,
    data
  ) =>
    updateDocImpl(
      ref,
      data
    );


export const addDoc =
  (
    ref,
    data
  ) =>
    addDocImpl(
      ref,
      data
    );


export const deleteDoc =
  ref =>
    deleteDocImpl(
      ref
    );


export const getDocs =
  target =>
    getDocsImpl(
      target
    );


export const onSnapshot =
  (
    target,
    callback
  ) =>
    onSnapshotImpl(
      target,
      callback
    );


export const serverTimestamp =
  () =>
    serverTimestampImpl();


export const query =
  (...args) =>
    queryImpl(
      ...args
    );


export const where =
  (...args) =>
    whereImpl(
      ...args
    );


export const orderBy =
  (...args) =>
    orderByImpl(
      ...args
    );


export const limit =
  (...args) =>
    limitImpl(
      ...args
    );


export const setStubUser =
  (
    user,
    password
  ) =>
    stubAuth._setUser(
      user,
      password
    );


export const getStubUser =
  () =>
    stubAuth.currentUser;


// ==========================================================
// STORAGE API
// ==========================================================

export const getStorage =
  appInstance =>
    storageModule
      ? storageModule.getStorage(
          appInstance ||
          app
        )
      : null;


export const ref =
  (...args) => {

    if (
      !storageModule
    ) {

      throw new Error(
        "Storage not loaded"
      );

    }


    return storageModule.ref(
      ...args
    );

  };


export const storageRef =
  ref;


export const uploadBytes =
  (...args) => {

    if (
      !storageModule
    ) {

      return Promise.reject(
        new Error(
          "Storage not loaded"
        )
      );

    }


    return storageModule.uploadBytes(
      ...args
    );

  };


export const uploadBytesResumable =
  (...args) => {

    if (
      !storageModule
    ) {

      return Promise.reject(
        new Error(
          "Storage not loaded"
        )
      );

    }


    return storageModule.uploadBytesResumable(
      ...args
    );

  };


export const getDownloadURL =
  (...args) => {

    if (
      !storageModule
    ) {

      return Promise.reject(
        new Error(
          "Storage not loaded"
        )
      );

    }


    return storageModule.getDownloadURL(
      ...args
    );

  };


export const deleteObject =
  (...args) => {

    if (
      !storageModule
    ) {

      return Promise.reject(
        new Error(
          "Storage not loaded"
        )
      );

    }


    return storageModule.deleteObject(
      ...args
    );

  };


window.__FV_USER =
  stubAuth.currentUser ||
  null;
