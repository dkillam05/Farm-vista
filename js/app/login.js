// /js/app/login.js
// FarmVista Login
// Multi-farm ready
//
// Email/password + employee-authorized phone authentication.
//
// IMPORTANT:
// - Login UI is wired immediately.
// - Firebase can finish initializing afterward.
// - No stub-mode login bypass.
// - Selected farm must have a real Firebase connection.
//
// PHONE SECURITY:
// Firebase may still SEND an SMS to a valid phone number.
// After verification, FarmVista only allows access when the
// verified phone belongs to exactly one ACTIVE employee record.

import {
  ready,
  getAuth,

  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,

  createRecaptchaVerifier,
  signInWithPhoneNumber,

  getFirestore,
  collection,
  getDocs,
  query,
  where,
  limit,
  doc,
  setDoc,

  isStub
} from "../firebase-init.js";


// ==========================================================
// ELEMENTS
// ==========================================================

const els = {

  emailTab:
    document.getElementById(
      "emailTab"
    ),

  phoneTab:
    document.getElementById(
      "phoneTab"
    ),

  emailForm:
    document.getElementById(
      "loginForm"
    ),

  phoneForm:
    document.getElementById(
      "phoneForm"
    ),

  email:
    document.getElementById(
      "email"
    ),

  password:
    document.getElementById(
      "password"
    ),

  err:
    document.getElementById(
      "errBox"
    ),

  forgot:
    document.getElementById(
      "forgot"
    ),

  signIn:
    document.getElementById(
      "signIn"
    ),

  phone:
    document.getElementById(
      "phone"
    ),

  phoneRequestStep:
    document.getElementById(
      "phoneRequestStep"
    ),

  phoneVerifyStep:
    document.getElementById(
      "phoneVerifyStep"
    ),

  phoneErr:
    document.getElementById(
      "phoneErrBox"
    ),

  phoneVerifyErr:
    document.getElementById(
      "phoneVerifyErrBox"
    ),

  sendCode:
    document.getElementById(
      "sendCode"
    ),

  verifyCode:
    document.getElementById(
      "verifyCode"
    ),

  verificationCode:
    document.getElementById(
      "verificationCode"
    ),

  phoneStatus:
    document.getElementById(
      "phoneStatus"
    ),

  changePhone:
    document.getElementById(
      "changePhone"
    ),

  resendCode:
    document.getElementById(
      "resendCode"
    )

};


// ==========================================================
// FIREBASE STATE
// ==========================================================

let firebaseContext =
  null;

let auth =
  null;

let firebaseReady =
  false;

let firebaseFailed =
  false;

let firebaseReadyPromise =
  null;


// ==========================================================
// PHONE AUTH STATE
// ==========================================================

let confirmationResult =
  null;

let recaptchaVerifier =
  null;

let recaptchaWidgetId =
  null;

let lastPhoneE164 =
  "";

let lastPhoneDisplay =
  "";


// ==========================================================
// AUTH MODE
// ==========================================================

let authMode =
  "email";


// ==========================================================
// BASIC HELPERS
// ==========================================================

function showErr(
  message
) {

  if (
    !els.err
  ) {

    return;

  }


  els.err.textContent =
    message ||
    "";

}


function showPhoneErr(
  message
) {

  if (
    !els.phoneErr
  ) {

    return;

  }


  els.phoneErr.textContent =
    message ||
    "";

}


function showPhoneVerifyErr(
  message
) {

  if (
    !els.phoneVerifyErr
  ) {

    return;

  }


  els.phoneVerifyErr.textContent =
    message ||
    "";

}


function setButtonBusy(
  button,
  busy,
  busyText,
  normalText
) {

  if (
    !button
  ) {

    return;

  }


  button.disabled =
    Boolean(
      busy
    );


  button.textContent =
    busy
      ? busyText
      : normalText;

}


// ==========================================================
// HOME / NEXT URL
// ==========================================================

const DEFAULT_HOME =
  "index.html";


function resolveUnderBase(
  pathLike
) {

  try {

    const url =
      new URL(
        pathLike,
        document.baseURI ||
        location.href
      );


    return (
      url.pathname +
      (
        url.search ||
        ""
      ) +
      (
        url.hash ||
        ""
      )
    );

  }
  catch {

    return pathLike;

  }

}


function nextUrl() {

  const qs =
    new URLSearchParams(
      location.search
    );


  const hint =
    (
      qs.get(
        "next"
      ) ||
      ""
    ).trim();


  return resolveUnderBase(
    hint ||
    DEFAULT_HOME
  );

}


// ==========================================================
// FARM HELPERS
// ==========================================================

function selectedFarmKey() {

  let farmKey =
    String(
      window.FV_FARM_KEY ||
      ""
    )
      .trim()
      .toLowerCase();


  if (
    farmKey
  ) {

    return farmKey;

  }


  try {

    const params =
      new URLSearchParams(
        location.search
      );


    farmKey =
      String(
        params.get(
          "farm"
        ) ||
        ""
      )
        .trim()
        .toLowerCase();

  }
  catch {}


  if (
    farmKey
  ) {

    return farmKey;

  }


  try {

    farmKey =
      String(
        localStorage.getItem(
          "fv:farm-key"
        ) ||
        ""
      )
        .trim()
        .toLowerCase();

  }
  catch {}


  return farmKey;

}


function showNoFarmMessage() {

  showErr(
    "Choose a FarmVista farm before signing in."
  );


  showPhoneErr(
    "Choose a FarmVista farm before signing in."
  );

}


// ==========================================================
// FIREBASE INITIALIZATION
// ==========================================================

function initializeFirebase() {

  if (
    firebaseReadyPromise
  ) {

    return firebaseReadyPromise;

  }


  firebaseReadyPromise =
    (
      async () => {

        try {

          /*
            firebase-config.js may be fetching:

              /farms/dowson.json
              /farms/borrowman.json

            Wait for that tenant lookup first.
          */

          if (
            window.FV_FARM_READY &&
            typeof window.FV_FARM_READY.then ===
              "function"
          ) {

            await window.FV_FARM_READY;

          }


          const farmKey =
            selectedFarmKey();


          if (
            !farmKey
          ) {

            firebaseFailed =
              true;

            firebaseReady =
              false;


            return null;

          }


          firebaseContext =
            await ready;


          if (
            isStub &&
            isStub()
          ) {

            console.error(
              "[Login] Firebase initialized in stub mode.",
              {
                farmKey:
                  window.FV_FARM_KEY,

                firebaseConfig:
                  window.FV_FIREBASE_CONFIG,

                configFailed:
                  window.__FV_FARM_CONFIG_FAILED,

                noFarm:
                  window.__FV_NO_FARM_SELECTED
              }
            );


            firebaseFailed =
              true;

            firebaseReady =
              false;


            return null;

          }


          auth =
            firebaseContext?.auth ||
            getAuth(
              firebaseContext?.app
            );


          if (
            !auth
          ) {

            throw new Error(
              "Firebase Authentication did not initialize."
            );

          }


          firebaseReady =
            true;

          firebaseFailed =
            false;


          console.info(
            "[Login] Firebase ready.",
            {
              farmKey:
                window.FV_FARM_KEY,

              projectId:
                window.FV_FIREBASE_CONFIG?.projectId ||
                ""
            }
          );


          return {
            context:
              firebaseContext,

            auth
          };

        }
        catch (
          error
        ) {

          console.error(
            "[Login] Firebase initialization failed:",
            error
          );


          firebaseFailed =
            true;

          firebaseReady =
            false;


          return null;

        }

      }
    )();


  return firebaseReadyPromise;

}


async function requireFirebase(
  errorTarget =
    "email"
) {

  const farmKey =
    selectedFarmKey();


  if (
    !farmKey
  ) {

    if (
      errorTarget ===
      "phone"
    ) {

      showPhoneErr(
        "FarmVista does not know which farm to connect to."
      );

    }
    else {

      showErr(
        "FarmVista does not know which farm to connect to."
      );

    }


    return false;

  }


  if (
    firebaseReady &&
    auth
  ) {

    return true;

  }


  const result =
    await initializeFirebase();


  if (
    result &&
    firebaseReady &&
    auth
  ) {

    return true;

  }


  const message =
    "FarmVista could not connect to this farm. Please refresh and try again.";


  if (
    errorTarget ===
    "phone"
  ) {

    showPhoneErr(
      message
    );

  }
  else {

    showErr(
      message
    );

  }


  return false;

}


// ==========================================================
// AUTH MODE UI
// ==========================================================

function setAuthMode(
  mode
) {

  authMode =
    mode ===
      "phone"
      ? "phone"
      : "email";


  const emailMode =
    authMode ===
    "email";


  if (
    els.emailForm
  ) {

    els.emailForm.style.display =
      emailMode
        ? "grid"
        : "none";

  }


  if (
    els.phoneForm
  ) {

    els.phoneForm.style.display =
      emailMode
        ? "none"
        : "grid";

  }


  els.emailTab?.classList.toggle(
    "active",
    emailMode
  );


  els.phoneTab?.classList.toggle(
    "active",
    !emailMode
  );


  els.emailTab?.setAttribute(
    "aria-selected",
    emailMode
      ? "true"
      : "false"
  );


  els.phoneTab?.setAttribute(
    "aria-selected",
    emailMode
      ? "false"
      : "true"
  );


  showErr(
    ""
  );


  showPhoneErr(
    ""
  );


  showPhoneVerifyErr(
    ""
  );


  try {

    if (
      emailMode
    ) {

      els.email?.focus({
        preventScroll:
          true
      });

    }
    else {

      els.phone?.focus({
        preventScroll:
          true
      });

    }

  }
  catch {}

}


// ==========================================================
// PHONE NORMALIZATION
// ==========================================================

function digitsOnly(
  value
) {

  return String(
    value ||
    ""
  ).replace(
    /\D/g,
    ""
  );

}


function formatUSPhoneDisplay(
  value
) {

  let digits =
    digitsOnly(
      value
    );


  if (
    digits.length >
      10 &&
    digits.startsWith(
      "1"
    )
  ) {

    digits =
      digits.slice(
        1,
        11
      );

  }
  else {

    digits =
      digits.slice(
        0,
        10
      );

  }


  if (
    digits.length <=
    3
  ) {

    return digits;

  }


  if (
    digits.length <=
    6
  ) {

    return (
      `(${digits.slice(0,3)}) ` +
      digits.slice(
        3
      )
    );

  }


  return (
    `(${digits.slice(0,3)}) ` +
    `${digits.slice(3,6)}-` +
    digits.slice(
      6
    )
  );

}


function normalizeUSPhone(
  value
) {

  let digits =
    digitsOnly(
      value
    );


  if (
    digits.length ===
      11 &&
    digits.startsWith(
      "1"
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

    return "";

  }


  return (
    `+1${digits}`
  );

}


// ==========================================================
// EMPLOYEE HELPERS
// ==========================================================

function employeeIsActive(
  employee
) {

  if (
    !employee
  ) {

    return false;

  }


  const status =
    String(
      employee.status ||
      ""
    )
      .trim()
      .toLowerCase();


  if (
    status
  ) {

    return (
      status ===
      "active"
    );

  }


  if (
    typeof employee.active ===
      "boolean"
  ) {

    return employee.active;

  }


  return false;

}


// ==========================================================
// FIND EMPLOYEE BY VERIFIED PHONE
// ==========================================================

async function findEmployeeForPhone(
  phoneE164
) {

  if (
    !phoneE164
  ) {

    return {
      ok:
        false,

      reason:
        "invalid_phone"
    };

  }


  const db =
    getFirestore();


  // ========================================================
  // FIRST:
  // exact phoneE164 match
  // ========================================================

  try {

    const phoneQuery =
      query(
        collection(
          db,
          "employees"
        ),
        where(
          "phoneE164",
          "==",
          phoneE164
        ),
        limit(
          2
        )
      );


    const snap =
      await getDocs(
        phoneQuery
      );


    if (
      snap.size >
      1
    ) {

      console.error(
        "[Login] Duplicate phoneE164 employee records:",
        phoneE164
      );


      return {
        ok:
          false,

        reason:
          "duplicate"
      };

    }


    if (
      snap.size ===
      1
    ) {

      const employeeDoc =
        snap.docs[0];


      const employee =
        employeeDoc.data() ||
        {};


      if (
        !employeeIsActive(
          employee
        )
      ) {

        return {
          ok:
            false,

          reason:
            "inactive",

          id:
            employeeDoc.id,

          employee
        };

      }


      return {
        ok:
          true,

        id:
          employeeDoc.id,

        employee
      };

    }

  }
  catch (
    error
  ) {

    console.warn(
      "[Login] phoneE164 lookup failed:",
      error
    );

  }


  // ========================================================
  // SECOND:
  // compatibility with older phone fields
  // ========================================================

  try {

    const snap =
      await getDocs(
        collection(
          db,
          "employees"
        )
      );


    const matches =
      [];


    for (
      const employeeDoc
      of snap.docs
    ) {

      const employee =
        employeeDoc.data() ||
        {};


      const existingPhone =
        normalizeUSPhone(
          employee.phoneE164 ||
          employee.phone ||
          employee.mobile ||
          employee.phoneNumber ||
          ""
        );


      if (
        existingPhone ===
        phoneE164
      ) {

        matches.push({
          id:
            employeeDoc.id,

          employee
        });

      }

    }


    if (
      matches.length >
      1
    ) {

      return {
        ok:
          false,

        reason:
          "duplicate"
      };

    }


    if (
      matches.length ===
      1
    ) {

      const match =
        matches[0];


      if (
        !employeeIsActive(
          match.employee
        )
      ) {

        return {
          ok:
            false,

          reason:
            "inactive",

          id:
            match.id,

          employee:
            match.employee
        };

      }


      return {
        ok:
          true,

        id:
          match.id,

        employee:
          match.employee
      };

    }


    return {
      ok:
        false,

      reason:
        "not_found"
    };

  }
  catch (
    error
  ) {

    console.error(
      "[Login] employee phone lookup failed:",
      error
    );


    return {
      ok:
        false,

      reason:
        "lookup_failed",

      error
    };

  }

}


// ==========================================================
// LINK FIREBASE UID TO EMPLOYEE
// ==========================================================

async function linkPhoneAuthToEmployee(
  employeeMatch,
  firebaseUser
) {

  if (
    !employeeMatch?.ok ||
    !employeeMatch.id ||
    !firebaseUser?.uid
  ) {

    return;

  }


  const phoneE164 =
    normalizeUSPhone(
      firebaseUser.phoneNumber ||
      ""
    );


  try {

    const db =
      getFirestore();


    await setDoc(
      doc(
        db,
        "employees",
        employeeMatch.id
      ),
      {
        authUid:
          firebaseUser.uid,

        uid:
          firebaseUser.uid,

        phoneAuthUid:
          firebaseUser.uid,

        phoneE164:
          phoneE164,

        phoneVerified:
          true,

        phoneVerifiedAt:
          new Date().toISOString()
      },
      {
        merge:
          true
      }
    );

  }
  catch (
    error
  ) {

    console.warn(
      "[Login] could not link auth UID to employee:",
      error
    );

  }

}


// ==========================================================
// CLEAR OLD FARMVISTA USER CONTEXT
// ==========================================================

function clearFarmVistaUserCache() {

  try {

    localStorage.removeItem(
      "fv:userctx:v1"
    );

  }
  catch {}


  try {

    window.FVUserContext?.clear?.();

  }
  catch {}

}


// ==========================================================
// FORCE UNAUTHORIZED PHONE USER BACK OUT
// ==========================================================

async function rejectPhoneUser(
  reason
) {

  console.warn(
    "[Login] phone user denied:",
    reason
  );


  try {

    if (
      auth
    ) {

      await signOut(
        auth
      );

    }

  }
  catch (
    error
  ) {

    console.warn(
      "[Login] denied-user signOut failed:",
      error
    );

  }


  clearFarmVistaUserCache();


  confirmationResult =
    null;


  if (
    els.verificationCode
  ) {

    els.verificationCode.value =
      "";

  }


  if (
    els.phoneVerifyStep
  ) {

    els.phoneVerifyStep.style.display =
      "none";

  }


  if (
    els.phoneRequestStep
  ) {

    els.phoneRequestStep.style.display =
      "grid";

  }


  let message =
    (
      "Access denied. This phone number is not linked " +
      "to an active FarmVista employee account."
    );


  if (
    reason ===
    "inactive"
  ) {

    message =
      (
        "Access denied. This FarmVista employee account " +
        "is not currently Active."
      );

  }
  else if (
    reason ===
    "duplicate"
  ) {

    message =
      (
        "Access denied. This phone number is assigned to " +
        "more than one employee. Contact an administrator."
      );

  }
  else if (
    reason ===
    "lookup_failed"
  ) {

    message =
      (
        "FarmVista could not verify employee access. " +
        "Please try again."
      );

  }


  showPhoneVerifyErr(
    ""
  );


  showPhoneErr(
    message
  );


  setButtonBusy(
    els.verifyCode,
    false,
    "Verifying…",
    "Verify & Sign In"
  );

}


// ==========================================================
// PHONE UI STEPS
// ==========================================================

function showPhoneRequestStep() {

  confirmationResult =
    null;


  if (
    els.phoneRequestStep
  ) {

    els.phoneRequestStep.style.display =
      "grid";

  }


  if (
    els.phoneVerifyStep
  ) {

    els.phoneVerifyStep.style.display =
      "none";

  }


  if (
    els.verificationCode
  ) {

    els.verificationCode.value =
      "";

  }


  showPhoneErr(
    ""
  );


  showPhoneVerifyErr(
    ""
  );

}


function showPhoneVerifyStep() {

  if (
    els.phoneRequestStep
  ) {

    els.phoneRequestStep.style.display =
      "none";

  }


  if (
    els.phoneVerifyStep
  ) {

    els.phoneVerifyStep.style.display =
      "grid";

  }


  if (
    els.phoneStatus
  ) {

    els.phoneStatus.textContent =
      `Verification code sent to ${lastPhoneDisplay}.`;

  }


  try {

    els.verificationCode?.focus({
      preventScroll:
        true
    });

  }
  catch {}

}


// ==========================================================
// FIREBASE ERROR DETECTION
// ==========================================================

function isEmployeeAccessDenied(
  error
) {

  const code =
    String(
      error?.code ||
      ""
    ).toLowerCase();


  const message =
    String(
      error?.message ||
      ""
    ).toLowerCase();


  return (
    code.includes(
      "permission-denied"
    ) ||

    code.includes(
      "blocking-function"
    ) ||

    message.includes(
      "farmvista access denied"
    ) ||

    message.includes(
      "not an active farmvista employee"
    ) ||

    message.includes(
      "phone number is not authorized"
    )
  );

}


function phoneSendErrorMessage(
  error
) {

  if (
    isEmployeeAccessDenied(
      error
    )
  ) {

    return (
      "Access denied. This phone number is not linked " +
      "to an active FarmVista employee account."
    );

  }


  const code =
    error?.code ||
    "";


  if (
    code ===
    "auth/invalid-phone-number"
  ) {

    return (
      "Enter a valid 10-digit mobile phone number."
    );

  }


  if (
    code ===
    "auth/missing-phone-number"
  ) {

    return (
      "Enter your mobile phone number."
    );

  }


  if (
    code ===
    "auth/quota-exceeded"
  ) {

    return (
      "The SMS sending limit has been reached. " +
      "Please try again later."
    );

  }


  if (
    code ===
    "auth/too-many-requests"
  ) {

    return (
      "Too many verification attempts. " +
      "Please try again later."
    );

  }


  if (
    code ===
    "auth/captcha-check-failed"
  ) {

    return (
      "Phone verification could not be completed. " +
      "Please try again."
    );

  }


  if (
    code ===
    "auth/operation-not-allowed"
  ) {

    return (
      "Phone sign-in is not enabled for this FarmVista account."
    );

  }


  if (
    code ===
    "auth/unauthorized-domain"
  ) {

    return (
      "This FarmVista web address is not authorized for phone sign-in."
    );

  }


  return (
    "Could not send the verification code. " +
    "Please try again."
  );

}


function phoneVerifyErrorMessage(
  error
) {

  if (
    isEmployeeAccessDenied(
      error
    )
  ) {

    return (
      "Access denied. This phone number is not linked " +
      "to an active FarmVista employee account."
    );

  }


  const code =
    error?.code ||
    "";


  if (
    code ===
    "auth/invalid-verification-code"
  ) {

    return (
      "That verification code is incorrect."
    );

  }


  if (
    code ===
    "auth/code-expired"
  ) {

    return (
      "That verification code has expired. " +
      "Please resend a new code."
    );

  }


  if (
    code ===
    "auth/missing-verification-code"
  ) {

    return (
      "Enter the verification code from the text message."
    );

  }


  if (
    code ===
    "auth/session-expired"
  ) {

    return (
      "The verification session expired. " +
      "Please resend a new code."
    );

  }


  if (
    code ===
    "auth/too-many-requests"
  ) {

    return (
      "Too many verification attempts. " +
      "Please try again later."
    );

  }


  return (
    "Phone verification failed. " +
    "Please check the code and try again."
  );

}


// ==========================================================
// RECAPTCHA
// ==========================================================

async function getRecaptchaVerifier() {

  if (
    recaptchaVerifier
  ) {

    return recaptchaVerifier;

  }


  if (
    !auth
  ) {

    throw new Error(
      "Firebase Authentication is not ready."
    );

  }


  recaptchaVerifier =
    createRecaptchaVerifier(
      auth,
      "recaptcha-container",
      {
        size:
          "invisible"
      }
    );


  recaptchaWidgetId =
    await recaptchaVerifier.render();


  return recaptchaVerifier;

}


async function resetRecaptcha() {

  try {

    if (
      window.grecaptcha &&
      recaptchaWidgetId !==
        null
    ) {

      window.grecaptcha.reset(
        recaptchaWidgetId
      );

    }

  }
  catch (
    error
  ) {

    console.warn(
      "[Login] reCAPTCHA reset failed:",
      error
    );

  }

}


// ==========================================================
// EMAIL SIGN IN
// ==========================================================

async function handleEmailSignIn(
  event
) {

  event?.preventDefault?.();


  showErr(
    ""
  );


  const email =
    (
      els.email?.value ||
      ""
    ).trim();


  const password =
    els.password?.value ||
    "";


  if (
    !email ||
    !password
  ) {

    showErr(
      "Enter your email and password."
    );


    return;

  }


  try {

    localStorage.setItem(
      "fv_last_email",
      email
    );

  }
  catch {}


  setButtonBusy(
    els.signIn,
    true,
    "Signing In…",
    "Sign In"
  );


  try {

    const ok =
      await requireFirebase(
        "email"
      );


    if (
      !ok
    ) {

      return;

    }


    await signInWithEmailAndPassword(
      auth,
      email,
      password
    );


    clearFarmVistaUserCache();


    location.replace(
      nextUrl()
    );

  }
  catch (
    error
  ) {

    console.warn(
      "[Login] email sign-in error:",
      error
    );


    const code =
      error?.code ||
      "";


    let message =
      "Sign in failed. Please check your email and password.";


    if (
      code ===
      "auth/invalid-email"
    ) {

      message =
        "That email address looks invalid.";

    }
    else if (
      code ===
      "auth/user-disabled"
    ) {

      message =
        "This account has been disabled.";

    }
    else if (
      code ===
        "auth/user-not-found" ||
      code ===
        "auth/wrong-password" ||
      code ===
        "auth/invalid-credential"
    ) {

      message =
        "Incorrect email or password.";

    }
    else if (
      code ===
      "auth/too-many-requests"
    ) {

      message =
        "Too many attempts. Please try again later.";

    }


    showErr(
      message
    );

  }
  finally {

    setButtonBusy(
      els.signIn,
      false,
      "Signing In…",
      "Sign In"
    );

  }

}


// ==========================================================
// PASSWORD RESET
// ==========================================================

async function handlePasswordReset(
  event
) {

  event?.preventDefault?.();


  showErr(
    ""
  );


  const email =
    (
      els.email?.value ||
      ""
    ).trim();


  if (
    !email
  ) {

    showErr(
      "Enter your email above, then tap “Forgot password?”."
    );


    return;

  }


  const ok =
    await requireFirebase(
      "email"
    );


  if (
    !ok
  ) {

    return;

  }


  try {

    await sendPasswordResetEmail(
      auth,
      email
    );


    showErr(
      "Reset link sent if the email exists."
    );

  }
  catch (
    error
  ) {

    console.warn(
      "[Login] reset error:",
      error
    );


    showErr(
      "Could not send reset link. Please try again later."
    );

  }

}


// ==========================================================
// SEND SMS CODE
// ==========================================================

async function sendVerificationCode() {

  showPhoneErr(
    ""
  );


  showPhoneVerifyErr(
    ""
  );


  const ok =
    await requireFirebase(
      "phone"
    );


  if (
    !ok
  ) {

    return;

  }


  const rawPhone =
    els.phone?.value ||
    "";


  const phoneE164 =
    normalizeUSPhone(
      rawPhone
    );


  if (
    !phoneE164
  ) {

    showPhoneErr(
      "Enter a valid 10-digit mobile phone number."
    );


    return;

  }


  lastPhoneE164 =
    phoneE164;


  lastPhoneDisplay =
    formatUSPhoneDisplay(
      rawPhone
    );


  setButtonBusy(
    els.sendCode,
    true,
    "Sending Code…",
    "Send Verification Code"
  );


  if (
    els.resendCode
  ) {

    els.resendCode.disabled =
      true;

  }


  try {

    const verifier =
      await getRecaptchaVerifier();


    confirmationResult =
      await signInWithPhoneNumber(
        auth,
        lastPhoneE164,
        verifier
      );


    showPhoneVerifyStep();

  }
  catch (
    error
  ) {

    console.warn(
      "[Login] phone send error:",
      error
    );


    await resetRecaptcha();


    showPhoneErr(
      phoneSendErrorMessage(
        error
      )
    );

  }
  finally {

    setButtonBusy(
      els.sendCode,
      false,
      "Sending Code…",
      "Send Verification Code"
    );


    if (
      els.resendCode
    ) {

      els.resendCode.disabled =
        false;

    }

  }

}


// ==========================================================
// VERIFY SMS CODE
// ==========================================================

async function verifyPhoneCode() {

  showPhoneVerifyErr(
    ""
  );


  if (
    !confirmationResult
  ) {

    showPhoneVerifyErr(
      "Please resend a verification code."
    );


    return;

  }


  const code =
    digitsOnly(
      els.verificationCode?.value
    ).slice(
      0,
      6
    );


  if (
    code.length !==
    6
  ) {

    showPhoneVerifyErr(
      "Enter the 6-digit verification code."
    );


    return;

  }


  setButtonBusy(
    els.verifyCode,
    true,
    "Verifying…",
    "Verify & Sign In"
  );


  try {

    const credential =
      await confirmationResult.confirm(
        code
      );


    const firebaseUser =
      credential?.user ||
      auth?.currentUser ||
      null;


    if (
      !firebaseUser
    ) {

      throw new Error(
        "Firebase did not return the authenticated phone user."
      );

    }


    const verifiedPhone =
      normalizeUSPhone(
        firebaseUser.phoneNumber ||
        ""
      );


    if (
      !verifiedPhone
    ) {

      await rejectPhoneUser(
        "invalid_phone"
      );


      return;

    }


    const employeeMatch =
      await findEmployeeForPhone(
        verifiedPhone
      );


    if (
      !employeeMatch.ok
    ) {

      await rejectPhoneUser(
        employeeMatch.reason
      );


      return;

    }


    await linkPhoneAuthToEmployee(
      employeeMatch,
      firebaseUser
    );


    clearFarmVistaUserCache();


    try {

      await window.FVUserContext?.refresh?.({
        force:
          true
      });

    }
    catch {}


    location.replace(
      nextUrl()
    );

  }
  catch (
    error
  ) {

    console.warn(
      "[Login] phone verify error:",
      error
    );


    showPhoneVerifyErr(
      phoneVerifyErrorMessage(
        error
      )
    );

  }
  finally {

    setButtonBusy(
      els.verifyCode,
      false,
      "Verifying…",
      "Verify & Sign In"
    );

  }

}


// ==========================================================
// RESEND CODE
// ==========================================================

async function resendVerificationCode() {

  showPhoneVerifyErr(
    ""
  );


  const ok =
    await requireFirebase(
      "phone"
    );


  if (
    !ok
  ) {

    return;

  }


  if (
    !lastPhoneE164
  ) {

    showPhoneRequestStep();


    return;

  }


  setButtonBusy(
    els.resendCode,
    true,
    "Resending…",
    "Resend verification code"
  );


  try {

    const verifier =
      await getRecaptchaVerifier();


    confirmationResult =
      await signInWithPhoneNumber(
        auth,
        lastPhoneE164,
        verifier
      );


    if (
      els.phoneStatus
    ) {

      els.phoneStatus.textContent =
        `A new verification code was sent to ${lastPhoneDisplay}.`;

    }

  }
  catch (
    error
  ) {

    console.warn(
      "[Login] resend error:",
      error
    );


    await resetRecaptcha();


    showPhoneVerifyErr(
      phoneSendErrorMessage(
        error
      )
    );

  }
  finally {

    setButtonBusy(
      els.resendCode,
      false,
      "Resending…",
      "Resend verification code"
    );

  }

}


// ==========================================================
// WIRE UI IMMEDIATELY
// ==========================================================

function wireUI() {

  // ========================================================
  // EMAIL / PHONE TABS
  // ========================================================

  els.emailTab?.addEventListener(
    "click",
    () => {

      setAuthMode(
        "email"
      );

    }
  );


  els.phoneTab?.addEventListener(
    "click",
    () => {

      setAuthMode(
        "phone"
      );

    }
  );


  // ========================================================
  // EMAIL LOGIN
  // ========================================================

  els.emailForm?.addEventListener(
    "submit",
    handleEmailSignIn
  );


  // ========================================================
  // PASSWORD RESET
  // ========================================================

  els.forgot?.addEventListener(
    "click",
    handlePasswordReset
  );


  // ========================================================
  // PHONE FORMAT
  // ========================================================

  els.phone?.addEventListener(
    "input",
    () => {

      const current =
        els.phone.value;


      const formatted =
        formatUSPhoneDisplay(
          current
        );


      if (
        current !==
        formatted
      ) {

        els.phone.value =
          formatted;

      }

    }
  );


  // ========================================================
  // PHONE FORM
  // ========================================================

  els.phoneForm?.addEventListener(
    "submit",
    async event => {

      event.preventDefault();


      if (
        els.phoneRequestStep?.style.display !==
        "none"
      ) {

        await sendVerificationCode();

      }
      else {

        await verifyPhoneCode();

      }

    }
  );


  // ========================================================
  // VERIFY CODE
  // ========================================================

  els.verifyCode?.addEventListener(
    "click",
    verifyPhoneCode
  );


  els.verificationCode?.addEventListener(
    "input",
    () => {

      els.verificationCode.value =
        digitsOnly(
          els.verificationCode.value
        ).slice(
          0,
          6
        );

    }
  );


  els.verificationCode?.addEventListener(
    "keydown",
    event => {

      if (
        event.key ===
        "Enter"
      ) {

        event.preventDefault();


        verifyPhoneCode();

      }

    }
  );


  // ========================================================
  // CHANGE PHONE
  // ========================================================

  els.changePhone?.addEventListener(
    "click",
    () => {

      showPhoneRequestStep();


      try {

        els.phone?.focus({
          preventScroll:
            true
        });

      }
      catch {}

    }
  );


  // ========================================================
  // RESEND
  // ========================================================

  els.resendCode?.addEventListener(
    "click",
    resendVerificationCode
  );


  // ========================================================
  // INITIAL MODE
  // ========================================================

  setAuthMode(
    authMode
  );

}


// ==========================================================
// START
// ==========================================================

wireUI();


/*
  Start Firebase in the background.

  The UI is already usable at this point, so the Email /
  Phone tabs will never be blocked by Firebase initialization.
*/

initializeFirebase()
  .then(
    result => {

      if (
        result
      ) {

        console.info(
          "[Login] Authentication connection ready."
        );

        return;

      }


      if (
        !selectedFarmKey()
      ) {

        console.info(
          "[Login] No farm selected yet."
        );

        return;

      }


      console.warn(
        "[Login] Farm selected but Firebase is not ready."
      );

    }
  )
  .catch(
    error => {

      firebaseFailed =
        true;


      console.error(
        "[Login] Background Firebase startup failed:",
        error
      );

    }
  );
