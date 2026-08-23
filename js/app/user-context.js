/* /js/app/user-context.js
   FarmVista — UserContext (Session Locker)

   PHONE AUTH UPDATE — 2026-08-19
   ----------------------------------------------------------
   Identity resolution order:
   1. Firebase Auth UID
   2. Verified phone number -> ACTIVE employee
   3. Existing email/document-ID lookup

   Phone authentication is employee-only.
   A Firebase phone user who does not match an ACTIVE employee
   does NOT receive a FarmVista employee context.

   Existing email/password behavior remains supported.
*/

(function () {
  'use strict';


  // ==========================================================
  // CONSTANTS
  // ==========================================================

  const STORAGE_KEY =
    'fv:userctx:v1';


  const HOME_PATHS = [
    '/index.html',
    '/',
  ];


  const AUTH_DEBOUNCE_MS =
    450;


  const BUILD_TIMEOUT_MS =
    6000;


  const PERMISSIVE_WHEN_NO_LKG =
    true;


  // ==========================================================
  // BASIC HELPERS
  // ==========================================================

  const nowIso =
    () =>
      new Date().toISOString();


  const lsGet =
    key => {

      try {

        const raw =
          localStorage.getItem(
            key
          );


        return raw
          ? JSON.parse(
              raw
            )
          : null;

      }
      catch {

        return null;

      }

    };


  const lsSet =
    (
      key,
      value
    ) => {

      try {

        localStorage.setItem(
          key,
          JSON.stringify(
            value
          )
        );

      }
      catch {}

    };


  const lsDel =
    key => {

      try {

        localStorage.removeItem(
          key
        );

      }
      catch {}

    };


  const emailKey =
    email =>
      String(
        email ||
        ''
      )
        .trim()
        .toLowerCase();


  const digitsOnly =
    value =>
      String(
        value ||
        ''
      ).replace(
        /\D/g,
        ''
      );


  function normalizeUSPhone(
    value
  ){

    let digits =
      digitsOnly(
        value
      );


    if (
      digits.length ===
        11 &&
      digits.startsWith(
        '1'
      )
    ) {

      digits =
        digits.slice(
          1
        );

    }


    if (
      digits.length !==
      10
    ) {

      return '';

    }


    return (
      `+1${digits}`
    );

  }


  function employeeIsActive(
    employee
  ){

    if (
      !employee ||
      typeof employee !==
        'object'
    ) {

      return false;

    }


    const status =
      String(
        employee.status ||
        ''
      )
        .trim()
        .toLowerCase();


    /*
      If the employee has a Status field, it is authoritative.
    */

    if (
      status
    ) {

      return (
        status ===
        'active'
      );

    }


    /*
      Compatibility with older employee records.
    */

    if (
      typeof employee.active ===
      'boolean'
    ) {

      return employee.active;

    }


    /*
      Old records without either field were historically treated
      as usable records. Preserve that behavior for email users.
    */

    return true;

  }


  const wantDebug =
    (() => {

      try {

        if (
          new URL(
            location.href
          ).searchParams.get(
            'navdebug'
          ) ===
          '1'
        ) {

          return true;

        }


        return (
          localStorage.getItem(
            'fv:navdebug'
          ) ===
          '1'
        );

      }
      catch {

        return false;

      }

    })();


  function log(
    ...args
  ){

    if (
      wantDebug
    ) {

      console.log(
        '[FV:UserContext]',
        ...args
      );

    }

  }


  const debug =
    log;


  async function importFirebase(){

    return await import(
      '/js/firebase-init.js'
    );

  }


  async function importMenu(){

    const module =
      await import(
        '/js/menu.js'
      );


    return (
      module &&
      (
        module.NAV_MENU ||
        module.default
      )
    ) ||
    null;

  }


  // ==========================================================
  // NAV INDEXING
  // ==========================================================

  function buildNavIndexes(
    NAV_MENU
  ){

    const CONTAINERS =
      new Map();


    const CAP_SET =
      new Set();


    const CAP_LABELS =
      new Map();


    const CONT_BY_ID =
      new Map();


    const CONT_BY_LABEL =
      new Map();


    const HREF_TO_ID =
      new Map();


    const ID_TO_LABEL =
      new Map();


    const PERM_TO_ID =
      new Map();


    const ID_TO_PERM =
      new Map();


    const simplify =
      value =>
        String(
          value ||
          ''
        )
          .toLowerCase()
          .replace(
            /\s+/g,
            ' '
          )
          .trim();


    const normPerm =
      value =>
        String(
          value ||
          ''
        ).trim();


    function leafBelongsToContainer(
      containerId,
      leaf
    ){

      const cid =
        String(
          containerId ||
          ''
        ).trim();


      if (
        !cid
      ) {

        return true;

      }


      const perm =
        normPerm(
          leaf &&
          leaf.perm
        );


      if (
        !perm
      ) {

        return true;

      }


      if (
        perm ===
        cid
      ) {

        return true;

      }


      if (
        perm.startsWith(
          cid +
          '-'
        )
      ) {

        return true;

      }


      return false;

    }


    function collectLinksForContainer(
      nodes,
      acc,
      containerId
    ){

      (
        nodes ||
        []
      ).forEach(
        node => {

          if (
            node.type ===
              'group' &&
            Array.isArray(
              node.children
            )
          ) {

            collectLinksForContainer(
              node.children,
              acc,
              containerId
            );

          }
          else if (
            node.type ===
              'link' &&
            node.id
          ) {

            if (
              leafBelongsToContainer(
                containerId,
                node
              )
            ) {

              acc.push(
                node
              );

            }

          }

        }
      );

    }


    function collectLinksAll(
      nodes,
      acc
    ){

      (
        nodes ||
        []
      ).forEach(
        node => {

          if (
            node.type ===
              'group' &&
            Array.isArray(
              node.children
            )
          ) {

            collectLinksAll(
              node.children,
              acc
            );

          }
          else if (
            node.type ===
              'link' &&
            node.id
          ) {

            acc.push(
              node
            );

          }

        }
      );

    }


    (
      NAV_MENU?.items ||
      []
    ).forEach(
      top => {

        if (
          top.type !==
          'group'
        ) {

          return;

        }


        const contId =
          top.id;


        const contLabel =
          simplify(
            top.label ||
            top.id ||
            ''
          );


        CONT_BY_ID.set(
          contId,
          true
        );


        if (
          contLabel
        ) {

          CONT_BY_LABEL.set(
            contLabel,
            contId
          );

        }


        const underTop =
          [];


        collectLinksForContainer(
          [top],
          underTop,
          contId
        );


        (
          top.children ||
          []
        ).forEach(
          child => {

            if (
              child.type ===
              'group'
            ) {

              const sid =
                child.id;


              const sl =
                simplify(
                  child.label ||
                  child.id ||
                  ''
                );


              CONT_BY_ID.set(
                sid,
                true
              );


              if (
                sl
              ) {

                CONT_BY_LABEL.set(
                  sl,
                  sid
                );

              }


              const underSub =
                [];


              collectLinksForContainer(
                [child],
                underSub,
                sid
              );


              CONTAINERS.set(
                sid,
                underSub.map(
                  item =>
                    item.id
                )
              );

            }

          }
        );


        CONTAINERS.set(
          contId,
          underTop.map(
            item =>
              item.id
          )
        );


        const allUnderTop =
          [];


        collectLinksAll(
          [top],
          allUnderTop
        );


        allUnderTop.forEach(
          link => {

            CAP_SET.add(
              link.id
            );


            ID_TO_LABEL.set(
              link.id,
              link.label ||
              link.id
            );


            if (
              link.href
            ) {

              HREF_TO_ID.set(
                link.href,
                link.id
              );

            }


            const labelKey =
              simplify(
                link.label ||
                ''
              );


            if (
              labelKey &&
              !CAP_LABELS.has(
                labelKey
              )
            ) {

              CAP_LABELS.set(
                labelKey,
                link.id
              );

            }


            const permKey =
              normPerm(
                link.perm
              );


            if (
              permKey
            ) {

              if (
                !PERM_TO_ID.has(
                  permKey
                )
              ) {

                PERM_TO_ID.set(
                  permKey,
                  link.id
                );

              }


              if (
                !ID_TO_PERM.has(
                  link.id
                )
              ) {

                ID_TO_PERM.set(
                  link.id,
                  permKey
                );

              }

            }

          }
        );

      }
    );


    let HOME_ID =
      null;


    for (
      const [
        href,
        id
      ] of
      HREF_TO_ID.entries()
    ) {

      try {

        if (
          HOME_PATHS.some(
            path =>
              new URL(
                href,
                location.origin
              ).pathname ===
              path
          )
        ) {

          HOME_ID =
            id;

          break;

        }

      }
      catch {}

    }


    if (
      !HOME_ID
    ) {

      const homeKey =
        'home';


      if (
        CAP_LABELS.has(
          homeKey
        )
      ) {

        HOME_ID =
          CAP_LABELS.get(
            homeKey
          );

      }

    }


    return {

      CONTAINERS,
      CAP_SET,
      CAP_LABELS,
      CONT_BY_ID,
      CONT_BY_LABEL,
      HREF_TO_ID,
      HOME_ID,
      ID_TO_LABEL,
      PERM_TO_ID,
      ID_TO_PERM

    };

  }


  // ==========================================================
  // PERMISSION KEY MAPPING
  // ==========================================================

  function normalize(
    value
  ){

    return String(
      value ||
      ''
    ).trim();

  }


  function simplifyKey(
    value
  ){

    return String(
      value ||
      ''
    )
      .toLowerCase()
      .replace(
        /[\s_/]+/g,
        '-'
      )
      .replace(
        /[^a-z0-9.-]+/g,
        ''
      )
      .replace(
        /-+/g,
        '-'
      )
      .trim();

  }


  function simpleLabel(
    value
  ){

    return String(
      value ||
      ''
    )
      .toLowerCase()
      .replace(
        /\s+/g,
        ' '
      )
      .trim();

  }


  function mapContainerKey(
    raw,
    idx
  ){

    if (
      !raw
    ) {

      return null;

    }


    const key =
      normalize(
        raw
      );


    if (
      idx.CONT_BY_ID.has(
        key
      )
    ) {

      return key;

    }


    const label =
      simpleLabel(
        key
      );


    if (
      idx.CONT_BY_LABEL.has(
        label
      )
    ) {

      return idx.CONT_BY_LABEL.get(
        label
      );

    }


    const dashy =
      simplifyKey(
        key
      );


    if (
      idx.CONT_BY_ID.has(
        dashy
      )
    ) {

      return dashy;

    }


    return null;

  }


  function mapLeafKey(
    raw,
    idx
  ){

    if (
      !raw
    ) {

      return null;

    }


    const id =
      normalize(
        raw
      );


    if (
      idx.CAP_SET.has(
        id
      )
    ) {

      return id;

    }


    try {

      if (
        idx.PERM_TO_ID &&
        idx.PERM_TO_ID.has(
          id
        )
      ) {

        return idx.PERM_TO_ID.get(
          id
        );

      }


      const dashy =
        simplifyKey(
          id
        );


      if (
        idx.PERM_TO_ID &&
        idx.PERM_TO_ID.has(
          dashy
        )
      ) {

        return idx.PERM_TO_ID.get(
          dashy
        );

      }

    }
    catch {}


    const byLabel =
      idx.CAP_LABELS.get(
        simpleLabel(
          id
        )
      );


    if (
      byLabel
    ) {

      return byLabel;

    }


    let best =
      null;


    for (
      const candidate
      of idx.CAP_SET
    ) {

      if (
        candidate ===
        id
      ) {

        return candidate;

      }


      if (
        candidate.endsWith(
          id
        ) ||
        candidate.includes(
          id
        )
      ) {

        if (
          !best ||
          candidate.length >
            best.length
        ) {

          best =
            candidate;

        }

      }

    }


    return best;

  }


  function valToBool(
    value
  ){

    if (
      typeof value ===
      'boolean'
    ) {

      return value;

    }


    if (
      value &&
      typeof value.view ===
        'boolean'
    ) {

      return value.view;

    }


    if (
      value &&
      typeof value.on ===
        'boolean'
    ) {

      return value.on;

    }


    return undefined;

  }


  function baselineFromPerms(
    perms,
    idx
  ){

    const base = {
      all:{}
    };


    idx.CAP_SET.forEach(
      leaf => {

        base.all[
          leaf
        ] =
          false;

      }
    );


    if (
      !perms ||
      typeof perms !==
        'object'
    ) {

      return base;

    }


    const unknownContainers =
      [];


    Object.keys(
      perms
    ).forEach(
      key => {

        const on =
          valToBool(
            perms[key]
          );


        if (
          on ===
          undefined
        ) {

          return;

        }


        const mapped =
          mapContainerKey(
            key,
            idx
          );


        if (
          mapped &&
          idx.CONTAINERS.has(
            mapped
          )
        ) {

          (
            idx.CONTAINERS.get(
              mapped
            ) ||
            []
          ).forEach(
            leaf => {

              base.all[
                leaf
              ] =
                on;

            }
          );

        }
        else if (
          mapped ===
            null &&
          !idx.CAP_SET.has(
            key
          )
        ) {

          unknownContainers.push(
            key
          );

        }

      }
    );


    const unknownLeaves =
      [];


    Object.keys(
      perms
    ).forEach(
      key => {

        const on =
          valToBool(
            perms[key]
          );


        if (
          on ===
          undefined
        ) {

          return;

        }


        const leaf =
          mapLeafKey(
            key,
            idx
          );


        if (
          leaf
        ) {

          base.all[
            leaf
          ] =
            on;

        }
        else if (
          !idx.CONTAINERS.has(
            key
          )
        ) {

          unknownLeaves.push(
            key
          );

        }

      }
    );


    if (
      wantDebug &&
      (
        unknownContainers.length ||
        unknownLeaves.length
      )
    ) {

      debug(
        'Unknown container keys from perms:',
        unknownContainers
      );


      debug(
        'Unknown leaf keys from perms:',
        unknownLeaves
      );

    }


    return base;

  }


  function applyOverrides(
    base,
    overrides,
    idx
  ){

    const allowed =
      new Set();


    Object.values(
      base
    ).forEach(
      bucket => {

        Object.entries(
          bucket
        ).forEach(
          ([
            leaf,
            on
          ]) => {

            if (
              on
            ) {

              allowed.add(
                leaf
              );

            }

          }
        );

      }
    );


    if (
      overrides &&
      typeof overrides ===
        'object'
    ) {

      const unknownOverrideLeaves =
        [];


      Object.entries(
        overrides
      ).forEach(
        ([
          path,
          value
        ]) => {

          const bits =
            String(
              path
            ).split(
              '.'
            );


          const rawLeaf =
            bits.length >=
              2
              ? bits
                  .slice(
                    1
                  )
                  .join(
                    '.'
                  )
              : bits[0];


          const leaf =
            mapLeafKey(
              rawLeaf,
              idx
            );


          if (
            !leaf
          ) {

            unknownOverrideLeaves.push(
              path
            );

            return;

          }


          /*
            Support both old boolean overrides and your newer
            {view,add,edit,delete} employee override objects.
          */

          if (
            value ===
            true
          ) {

            allowed.add(
              leaf
            );

          }
          else if (
            value ===
            false
          ) {

            allowed.delete(
              leaf
            );

          }
          else if (
            value &&
            typeof value ===
              'object' &&
            typeof value.view ===
              'boolean'
          ) {

            if (
              value.view
            ) {

              allowed.add(
                leaf
              );

            }
            else {

              allowed.delete(
                leaf
              );

            }

          }

        }
      );


      if (
        wantDebug &&
        unknownOverrideLeaves.length
      ) {

        debug(
          'Unknown override keys:',
          unknownOverrideLeaves
        );

      }

    }


    return allowed;

  }


  function mergePermsWithOverrides(
    perms,
    overrides
  ){

    const result =
      {};


    if (
      perms &&
      typeof perms ===
        'object'
    ) {

      Object.keys(
        perms
      ).forEach(
        key => {

          result[
            key
          ] =
            perms[key];

        }
      );

    }


    if (
      overrides &&
      typeof overrides ===
        'object'
    ) {

      Object.keys(
        overrides
      ).forEach(
        key => {

          const value =
            overrides[key];


          if (
            typeof value ===
              'boolean' ||
            (
              value &&
              typeof value ===
                'object'
            )
          ) {

            result[
              key
            ] =
              value;

          }

        }
      );

    }


    return result;

  }


  // ==========================================================
  // FIRESTORE IDENTITY LOOKUP
  // ==========================================================

  async function findByField(
    mod,
    collectionName,
    field,
    value
  ){

    if (
      !value
    ) {

      return null;

    }


    try {

      const db =
        mod.getFirestore();


      const q =
        mod.query(
          mod.collection(
            db,
            collectionName
          ),
          mod.where(
            field,
            '==',
            value
          ),
          mod.limit(
            2
          )
        );


      const snap =
        await mod.getDocs(
          q
        );


      if (
        snap.empty
      ) {

        return null;

      }


      /*
        Duplicate identity values are unsafe.
        Do not arbitrarily select one.
      */

      if (
        snap.size >
        1
      ) {

        console.error(
          '[FV:UserContext] Duplicate identity match:',
          {
            collection:
              collectionName,
            field,
            value
          }
        );


        return {
          duplicate:
            true
        };

      }


      const item =
        snap.docs[0];


      return {
        coll:
          collectionName,

        id:
          item.id,

        data:
          item.data() ||
          {},

        matchType:
          field

      };

    }
    catch (
      error
    ) {

      debug(
        'findByField failed:',
        collectionName,
        field,
        error
      );


      return null;

    }

  }


  async function findEmployeeByLegacyPhone(
    mod,
    phoneE164
  ){

    if (
      !phoneE164
    ) {

      return null;

    }


    try {

      const db =
        mod.getFirestore();


      const snap =
        await mod.getDocs(
          mod.collection(
            db,
            'employees'
          )
        );


      const matches =
        [];


      for (
        const employeeDoc
        of snap.docs
      ) {

        const data =
          employeeDoc.data() ||
          {};


        const existingPhone =
          data.phoneE164 ||
          normalizeUSPhone(
            data.phone ||
            data.mobile ||
            data.phoneNumber ||
            ''
          );


        if (
          existingPhone ===
          phoneE164
        ) {

          matches.push({
            coll:
              'employees',

            id:
              employeeDoc.id,

            data,

            matchType:
              'legacy-phone'
          });

        }

      }


      if (
        matches.length >
        1
      ) {

        console.error(
          '[FV:UserContext] Duplicate employee phone:',
          phoneE164
        );


        return {
          duplicate:
            true
        };

      }


      return (
        matches[0] ||
        null
      );

    }
    catch (
      error
    ) {

      debug(
        'legacy phone lookup failed:',
        error
      );


      return null;

    }

  }


  async function fetchPersonRecord(
    mod,
    liveUser
  ){

    const db =
      mod.getFirestore();


    const uid =
      String(
        liveUser?.uid ||
        ''
      ).trim();


    const userEmail =
      emailKey(
        liveUser?.email ||
        ''
      );


    const phoneE164 =
      normalizeUSPhone(
        liveUser?.phoneNumber ||
        ''
      );


    const collections = [
      'employees',
      'subcontractors',
      'vendors'
    ];


    // ======================================================
    // 1. FIREBASE UID
    // ======================================================

    if (
      uid
    ) {

      const uidFields = [
        'authUid',
        'uid',
        'phoneAuthUid'
      ];


      for (
        const collectionName
        of collections
      ) {

        for (
          const field
          of uidFields
        ) {

          const result =
            await findByField(
              mod,
              collectionName,
              field,
              uid
            );


          if (
            result?.duplicate
          ) {

            return result;

          }


          if (
            result
          ) {

            return result;

          }

        }

      }

    }


    // ======================================================
    // 2. VERIFIED PHONE
    //
    // PHONE LOGIN IS EMPLOYEE-ONLY.
    // ======================================================

    if (
      phoneE164
    ) {

      let result =
        await findByField(
          mod,
          'employees',
          'phoneE164',
          phoneE164
        );


      if (
        result?.duplicate
      ) {

        return result;

      }


      if (
        result
      ) {

        return result;

      }


      /*
        Compatibility with employees saved before phoneE164
        was added.
      */

      result =
        await findEmployeeByLegacyPhone(
          mod,
          phoneE164
        );


      if (
        result
      ) {

        return result;

      }


      /*
        IMPORTANT:
        Do not fall through and identify phone-auth users
        as subcontractors/vendors.

        Phone login access is controlled by Employees.
      */

      return null;

    }


    // ======================================================
    // 3. EXISTING EMAIL LOOKUP
    // ======================================================

    if (
      userEmail
    ) {

      /*
        Preserve FarmVista's existing direct-document lookup.
      */

      for (
        const collectionName
        of collections
      ) {

        try {

          const ref =
            mod.doc(
              db,
              collectionName,
              userEmail
            );


          const snap =
            await mod.getDoc(
              ref
            );


          if (
            snap.exists()
          ) {

            return {
              coll:
                collectionName,

              id:
                userEmail,

              data:
                snap.data() ||
                {},

              matchType:
                'email-id'
            };

          }

        }
        catch {}

      }


      /*
        Compatibility if an employee document no longer uses
        email as its document ID.
      */

      for (
        const collectionName
        of collections
      ) {

        const result =
          await findByField(
            mod,
            collectionName,
            'email',
            userEmail
          );


        if (
          result?.duplicate
        ) {

          return result;

        }


        if (
          result
        ) {

          return result;

        }

      }

    }


    return null;

  }


  async function linkAuthUidToEmployee(
    mod,
    person,
    liveUser
  ){

    if (
      !person ||
      person.coll !==
        'employees' ||
      !person.id ||
      !liveUser?.uid
    ) {

      return;

    }


    try {

      const db =
        mod.getFirestore();


      const ref =
        mod.doc(
          db,
          'employees',
          person.id
        );


      const phoneE164 =
        normalizeUSPhone(
          liveUser.phoneNumber ||
          person.data?.phoneE164 ||
          person.data?.phone ||
          ''
        );


      const patch = {

        authUid:
          liveUser.uid,

        uid:
          liveUser.uid

      };


      if (
        phoneE164
      ) {

        patch.phoneE164 =
          phoneE164;

        patch.phoneAuthUid =
          liveUser.uid;

      }


      /*
        Do not make sign-in depend on this write succeeding.
        The server-side Auth function will eventually become
        the authoritative UID writer.
      */

      await mod.setDoc(
        ref,
        patch,
        {
          merge:true
        }
      );


      person.data = {
        ...person.data,
        ...patch
      };

    }
    catch (
      error
    ) {

      debug(
        'Could not link auth UID to employee:',
        error
      );

    }

  }


async function fetchRoleDocByName(
  mod,
  roleName
){

  const db =
    mod.getFirestore();


  const q =
    mod.query(
      mod.collection(
        db,
        'accountRoles'
      ),
      mod.where(
        'name',
        '==',
        roleName
      )
    );


  const snap =
    await mod.getDocs(
      q
    );


  let data =
    null;


  snap.forEach(
    item => {

      data =
        item.data() ||
        null;

    }
  );


  return data;

}


// ==========================================================
// FARM OWNER / SETUP ADMIN
// ==========================================================

async function fetchFarmAccessState(
  mod
){

  const db =
    mod.getFirestore();


  let company =
    {};


  let rolesKnown =
    false;


  let hasRoles =
    false;


  // --------------------------------------------------------
  // COMPANY
  // --------------------------------------------------------

  try {

    const companyRef =
      mod.doc(
        db,
        'company',
        'main'
      );


    const companySnap =
      await mod.getDoc(
        companyRef
      );


    if (
      companySnap.exists()
    ) {

      company =
        companySnap.data() ||
        {};

    }

  }
  catch (
    error
  ) {

    debug(
      'Unable to read company/main for farm access:',
      error
    );

  }


  // --------------------------------------------------------
  // ACCOUNT ROLES
  //
  // Important:
  // Only call the farm "new" if Firestore successfully tells
  // us there are zero Account Roles.
  // --------------------------------------------------------

  try {

    const roleQuery =
      mod.query(
        mod.collection(
          db,
          'accountRoles'
        ),
        mod.limit(
          1
        )
      );


    const roleSnap =
      await mod.getDocs(
        roleQuery
      );


    rolesKnown =
      true;


    hasRoles =
      !roleSnap.empty;

  }
  catch (
    error
  ) {

    debug(
      'Unable to determine whether account roles exist:',
      error
    );

  }


  return {

    company,

    ownerUid:
      String(
        company.ownerUid ||
        ''
      ).trim(),

    setupAdminUid:
      String(
        company.setupAdminUid ||
        ''
      ).trim(),

    rolesKnown,

    hasRoles

  };

}


async function claimSetupAdminIfNeeded(
  mod,
  liveUser,
  farmAccess
){

  if (
    !liveUser?.uid ||
    !farmAccess
  ) {

    return false;

  }


  // Farm already has a real owner.
  if (
    farmAccess.ownerUid
  ) {

    return false;

  }


  // A setup admin has already been established.
  if (
    farmAccess.setupAdminUid
  ) {

    return (
      farmAccess.setupAdminUid ===
      liveUser.uid
    );

  }


  // Do not automatically claim an established farm.
  if (
    !farmAccess.rolesKnown ||
    farmAccess.hasRoles
  ) {

    return false;

  }


  try {

    const db =
      mod.getFirestore();


    const companyRef =
      mod.doc(
        db,
        'company',
        'main'
      );


    await mod.setDoc(
      companyRef,
      {

        setupAdminUid:
          liveUser.uid,

        setupAdminEmail:
          liveUser.email ||
          null,

        setupAdminCreatedAt:
          nowIso()

      },
      {
        merge:true
      }
    );


    farmAccess.setupAdminUid =
      liveUser.uid;


    debug(
      'Claimed temporary farm setup administrator:',
      liveUser.uid
    );


    return true;

  }
  catch (
    error
  ) {

    console.error(
      '[FV:UserContext] Unable to claim setup administrator:',
      error
    );


    return false;

  }

}


function buildFullAccessSet(
  idx
){

  const allow =
    new Set(
      Array.from(
        idx.CAP_SET
      )
    );


  if (
    idx.HOME_ID
  ) {

    allow.add(
      idx.HOME_ID
    );

  }


  /*
    Capabilities used by the shell that are not normal
    navigation leaf IDs.
  */

  allow.add(
    'cap-qr-scanner'
  );


  allow.add(
    'cap-camera-popup'
  );


  return allow;

}


  // ==========================================================
  // CORE STATE
  // ==========================================================

  let _ctx =
    lsGet(
      STORAGE_KEY
    );


  let _listeners =
    new Set();


  let _inflight =
    null;


  let _authUnsub =
    null;


  let _debounceTimer =
    null;


  function notify(){

    _listeners.forEach(
      fn => {

        try {

          fn(
            _ctx ||
            null
          );

        }
        catch {}

      }
    );

  }


  function cacheSet(
    ctx
  ){

    _ctx =
      ctx
        ? {
            ...ctx
          }
        : null;


    if (
      ctx
    ) {

      lsSet(
        STORAGE_KEY,
        ctx
      );

    }
    else {

      lsDel(
        STORAGE_KEY
      );

    }


    notify();

  }


  // ==========================================================
  // DENIED PHONE CONTEXT
  // ==========================================================

  function buildPhoneAccessDeniedContext(
    liveUser,
    reason
  ){

    return {

      mode:
        'firebase',

      uid:
        liveUser?.uid ||
        null,

      email:
        liveUser?.email ||
        null,

      phoneNumber:
        normalizeUSPhone(
          liveUser?.phoneNumber ||
          ''
        ) ||
        liveUser?.phoneNumber ||
        null,

      displayName:
        liveUser?.displayName ||
        liveUser?.phoneNumber ||
        null,

      profile:
        null,

      roleName:
        null,

      role:
        null,

      employee:
        null,

      perms:
        {},

      effectivePerms:
        {},

      allowedIds:
        [],

      accessDenied:
        true,

      accessDeniedReason:
        reason ||
        'phone_not_authorized',

      updatedAt:
        nowIso()

    };

  }


  // ==========================================================
  // CONTEXT BUILDER
  // ==========================================================

  async function buildContextWithTimeout(){

    const timeout =
      new Promise(
        resolve =>
          setTimeout(
            () =>
              resolve({
                __timeout:true
              }),
            BUILD_TIMEOUT_MS
          )
      );


    return await Promise.race([
      buildContext(),
      timeout
    ]);

  }


  async function buildContext(){

    let mod;
    let NAV_MENU;


    try {

      [
        mod,
        NAV_MENU
      ] =
        await Promise.all([
          importFirebase(),
          importMenu()
        ]);

    }
    catch (
      error
    ) {

      debug(
        'import error',
        error
      );

    }


    if (
      !NAV_MENU ||
      !Array.isArray(
        NAV_MENU.items
      )
    ) {

      NAV_MENU = {
        items:[]
      };

    }


    const idx =
      buildNavIndexes(
        NAV_MENU
      );


    // ======================================================
    // FIREBASE MODULE UNAVAILABLE
    // ======================================================

    if (
      !mod ||
      !mod.ready
    ) {

      if (
        _ctx
      ) {

        debug(
          'Using LKG (no firebase module)'
        );


        return {
          ..._ctx,
          updatedAt:
            nowIso()
        };

      }


      if (
        PERMISSIVE_WHEN_NO_LKG
      ) {

        const ids =
          Array.from(
            idx.CAP_SET
          );


        if (
          idx.HOME_ID
        ) {

          ids.unshift(
            idx.HOME_ID
          );

        }


        return {

          mode:
            'unknown',

          uid:
            null,

          email:
            null,

          phoneNumber:
            null,

          displayName:
            null,

          profile:
            null,

          roleName:
            'Standard',

          role:
            null,

          employee:
            null,

          perms:
            {},

          effectivePerms:
            {},

          allowedIds:
            ids,

          accessDenied:
            false,

          updatedAt:
            nowIso()

        };

      }


      return null;

    }


    const {
      mode
    } =
      await mod.ready.catch(
        () => ({
          mode:'unknown'
        })
      );


    const auth =
      (
        mod.getAuth &&
        mod.getAuth()
      ) ||
      window.firebaseAuth ||
      null;


    const liveUser =
      auth &&
      auth.currentUser
        ? auth.currentUser
        : null;


    // ======================================================
    // NO AUTHENTICATED USER
    // ======================================================

    if (
      mode !==
        'firebase' ||
      !liveUser
    ) {

      if (
        _ctx
      ) {

        debug(
          'No live user; reusing LKG session context'
        );


        return {
          ..._ctx,
          updatedAt:
            nowIso()
        };

      }


      if (
        PERMISSIVE_WHEN_NO_LKG
      ) {

        const ids =
          Array.from(
            idx.CAP_SET
          );


        if (
          idx.HOME_ID
        ) {

          ids.unshift(
            idx.HOME_ID
          );

        }


        return {

          mode,

          uid:
            liveUser?.uid ||
            null,

          email:
            liveUser?.email ||
            null,

          phoneNumber:
            liveUser?.phoneNumber ||
            null,

          displayName:
            liveUser?.displayName ||
            liveUser?.email ||
            liveUser?.phoneNumber ||
            null,

          profile:
            null,

          roleName:
            'Standard',

          role:
            null,

          employee:
            null,

          perms:
            {},

          effectivePerms:
            {},

          allowedIds:
            ids,

          accessDenied:
            false,

          updatedAt:
            nowIso()

        };

      }


      return null;

    }


    const isPhoneAuth =
      Boolean(
        normalizeUSPhone(
          liveUser.phoneNumber ||
          ''
        )
      );

     // ======================================================
// FARM OWNER / TEMPORARY SETUP ADMIN
// ======================================================

const farmAccess =
  await fetchFarmAccessState(
    mod
  );


const isOwner =
  Boolean(
    farmAccess.ownerUid &&
    farmAccess.ownerUid ===
      liveUser.uid
  );


let isSetupAdmin =
  Boolean(
    !farmAccess.ownerUid &&
    farmAccess.setupAdminUid &&
    farmAccess.setupAdminUid ===
      liveUser.uid
  );


/*
  Brand-new farm:

  If there is no owner, no setup administrator and Firestore
  confirms there are no Account Roles yet, the first
  authenticated user becomes the temporary setup administrator.
*/

if (
  !isOwner &&
  !farmAccess.ownerUid &&
  !farmAccess.setupAdminUid
) {

  isSetupAdmin =
    await claimSetupAdminIfNeeded(
      mod,
      liveUser,
      farmAccess
    );

}


    // ======================================================
    // RESOLVE FIREBASE USER -> FARMVISTA PERSON
    // ======================================================

    const person =
      await fetchPersonRecord(
        mod,
        liveUser
      );


    /*
      Duplicate identity records are never safe.
    */

    if (
      person?.duplicate
    ) {

      if (
        isPhoneAuth
      ) {

        return buildPhoneAccessDeniedContext(
          liveUser,
          'duplicate_phone_identity'
        );

      }


      debug(
        'Duplicate identity match for email user.'
      );

    }


    // ======================================================
    // PHONE LOGIN AUTHORIZATION
    // ======================================================

    if (
      isPhoneAuth
    ) {

      /*
        A phone-authenticated Firebase account MUST correspond
        to an Employee record.
      */

      if (
        !person ||
        person.duplicate ||
        person.coll !==
          'employees'
      ) {

        debug(
          'Phone user denied: no employee match',
          liveUser.phoneNumber
        );


        return buildPhoneAccessDeniedContext(
          liveUser,
          'phone_not_linked_to_employee'
        );

      }


      /*
        Employee must currently be Active.
      */

      if (
        !employeeIsActive(
          person.data
        )
      ) {

        debug(
          'Phone user denied: employee inactive',
          person.id
        );


        return buildPhoneAccessDeniedContext(
          liveUser,
          'employee_inactive'
        );

      }


      /*
        Save Firebase UID onto the Employee record.
      */

      await linkAuthUidToEmployee(
        mod,
        person,
        liveUser
      );

    }


    // ======================================================
    // EXISTING EMAIL BEHAVIOR
    // ======================================================

    const emp =
      person?.data ||
      {};


    const roleName =
      emp.permissionGroup ||
      'Standard';


    const roleDoc =
      await fetchRoleDocByName(
        mod,
        roleName
      );


    const perms =
      roleDoc?.perms ||
      roleDoc?.permissions ||
      null;


const base =
  baselineFromPerms(
    perms,
    idx
  );


let allow;


// ======================================================
// OWNER / SETUP ADMIN OVERRIDE
// ======================================================

if (
  isOwner ||
  isSetupAdmin
) {

  allow =
    buildFullAccessSet(
      idx
    );

}
else {

  allow =
    applyOverrides(
      base,
      emp.overrides ||
      {},
      idx
    );


  if (
    idx.HOME_ID
  ) {

    allow.add(
      idx.HOME_ID
    );

  }

}


    const effectivePerms =
      mergePermsWithOverrides(
        perms ||
        {},
        emp.overrides ||
        {}
      );


    let displayName =
      liveUser.displayName ||
      '';


    if (
      !displayName
    ) {

      const firstName =
        String(
          emp.firstName ||
          emp.first ||
          ''
        ).trim();


      const lastName =
        String(
          emp.lastName ||
          emp.last ||
          ''
        ).trim();


      const fullName =
        `${firstName} ${lastName}`.trim();


      displayName =
        fullName ||
        liveUser.email ||
        liveUser.phoneNumber ||
        'FarmVista User';

    }


    const roleOut =
      roleDoc
        ? {
            ...roleDoc,
            name:
              roleName
          }
        : {
            name:
              roleName,
            perms:
              perms ||
              {}
          };


    const employeeOut =
      person
        ? {
            ...emp,

            id:
              person.id,

            coll:
              person.coll,

            matchType:
              person.matchType ||
              null
          }
        : null;


    const out = {

      mode:
        'firebase',

      uid:
        liveUser.uid ||
        null,

      email:
        liveUser.email ||
        null,

      phoneNumber:
        liveUser.phoneNumber ||
        emp.phoneE164 ||
        emp.phone ||
        null,

      displayName,

      profile:
        person
          ? {
              ...emp,
              type:
                person.coll
                  ? person.coll.slice(
                      0,
                      -1
                    )
                  : null
            }
          : null,

      roleName,

      role:
        roleOut,

      employee:
        employeeOut,

      perms:
        perms ||
        {},

      effectivePerms,

      allowedIds:
        Array.from(
          allow
        ),

accessDenied:
  false,

isOwner:
  Boolean(
    isOwner
  ),

isSetupAdmin:
  Boolean(
    isSetupAdmin
  ),

farmOwnerUid:
  farmAccess.ownerUid ||
  null,

setupAdminUid:
  farmAccess.setupAdminUid ||
  null,

updatedAt:
  nowIso()

    };


    if (
      wantDebug
    ) {

      debug(
        'CTX DEBUG → role:',
        roleName
      );


      debug(
        'Identity:',
        {
          uid:
            liveUser.uid ||
            null,

          email:
            liveUser.email ||
            null,

          phone:
            liveUser.phoneNumber ||
            null,

          personCollection:
            person?.coll ||
            null,

          personId:
            person?.id ||
            null,

          matchType:
            person?.matchType ||
            null
        }
      );


      debug(
        'Allowed IDs:',
        out.allowedIds
      );


      debug(
        'Home id:',
        idx.HOME_ID
      );


      const rawPermKeys =
        perms
          ? Object.keys(
              perms
            )
          : [];


      const unknownPerms =
        rawPermKeys.filter(
          key => {

            const container =
              mapContainerKey(
                key,
                idx
              );


            if (
              container
            ) {

              return false;

            }


            const leaf =
              mapLeafKey(
                key,
                idx
              );


            if (
              leaf
            ) {

              return false;

            }


            return true;

          }
        );


      if (
        unknownPerms.length
      ) {

        debug(
          'Unmapped role keys:',
          unknownPerms
        );

      }

    }


    return out;

  }


  // ==========================================================
  // PUBLIC REFRESH
  // ==========================================================

  async function refresh({
    force =
      false
  } = {}){

    if (
      _inflight &&
      !force
    ) {

      return _inflight;

    }


    _inflight =
      (
        async () => {

          let ctx =
            null;


          try {

            ctx =
              await buildContextWithTimeout();


            if (
              ctx &&
              !ctx.__timeout
            ) {

              cacheSet(
                ctx
              );


              _inflight =
                null;


              return ctx;

            }

          }
          catch (
            error
          ) {

            debug(
              'refresh build error; using LKG',
              error
            );

          }


          if (
            _ctx
          ) {

            _inflight =
              null;

            return _ctx;

          }


          const menu =
            await importMenu().catch(
              () =>
                null
            );


          const idx =
            buildNavIndexes(
              menu ||
              {
                items:[]
              }
            );


          if (
            PERMISSIVE_WHEN_NO_LKG
          ) {

            const ids =
              Array.from(
                idx.CAP_SET
              );


            if (
              idx.HOME_ID
            ) {

              ids.unshift(
                idx.HOME_ID
              );

            }


            const cold = {

              mode:
                'unknown',

              uid:
                null,

              email:
                null,

              phoneNumber:
                null,

              displayName:
                null,

              profile:
                null,

              roleName:
                'Standard',

              role:
                null,

              employee:
                null,

              perms:
                {},

              effectivePerms:
                {},

              allowedIds:
                ids,

              accessDenied:
                false,

              updatedAt:
                nowIso()

            };


            cacheSet(
              cold
            );


            _inflight =
              null;


            return cold;

          }


          _inflight =
            null;


          return null;

        }
      )();


    return _inflight;

  }


  function get(){

    return _ctx;

  }


  async function ready(){

    if (
      _ctx
    ) {

      return _ctx;

    }


    return await refresh();

  }


  function onChange(
    fn
  ){

    if (
      typeof fn ===
      'function'
    ) {

      _listeners.add(
        fn
      );

    }


    return () =>
      _listeners.delete(
        fn
      );

  }


  function clear(){

    if (
      _authUnsub
    ) {

      try {

        _authUnsub();

      }
      catch {}


      _authUnsub =
        null;

    }


    cacheSet(
      null
    );

  }


  window.FVUserContext = {
    get,
    ready,
    refresh,
    onChange,
    clear
  };


  // ==========================================================
  // AUTH WATCHER
  // ==========================================================

  (
    async function ensureAuthWatcher(){

      try {

        const mod =
          await importFirebase().catch(
            () =>
              null
          );


        if (
          !mod
        ) {

          return;

        }


        const auth =
          (
            mod.getAuth &&
            mod.getAuth()
          ) ||
          window.firebaseAuth ||
          null;


        if (
          !auth
        ) {

          return;

        }


        const watchFn =
          (
            mod.onIdTokenChanged ||
            mod.onAuthStateChanged
          );


        if (
          !watchFn
        ) {

          return;

        }


        if (
          _authUnsub
        ) {

          return;

        }


        _authUnsub =
          watchFn(
            auth,
            async userOrNull => {

              clearTimeout(
                _debounceTimer
              );


              /*
                IMPORTANT FOR PHONE AUTH:

                If Firebase switches to a different user, do not
                allow an old cached employee identity to remain
                authoritative while the new user is resolving.
              */

              if (
                userOrNull &&
                _ctx &&
                _ctx.uid &&
                userOrNull.uid &&
                _ctx.uid !==
                  userOrNull.uid
              ) {

                debug(
                  'Authenticated UID changed; clearing old user context.'
                );


                lsDel(
                  STORAGE_KEY
                );


                _ctx =
                  null;

              }


              _debounceTimer =
                setTimeout(
                  async () => {

                    await refresh({
                      force:true
                    }).catch(
                      () => {}
                    );

                  },
                  AUTH_DEBOUNCE_MS
                );

            }
          );

      }
      catch (
        error
      ) {

        debug(
          'ensureAuthWatcher error',
          error
        );

      }

    }
  )();


  // ==========================================================
  // INITIALIZE
  // ==========================================================

  _ctx =
    lsGet(
      STORAGE_KEY
    );


  if (
    !_ctx
  ) {

    refresh().catch(
      () => {}
    );

  }
  else {

    notify();

  }

})();
