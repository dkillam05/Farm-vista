// /Farm-vista/js/app/login.js
// FarmVista Login
// Email/password + employee-authorized phone authentication.
//
// PHONE SECURITY:
// Firebase may still SEND an SMS to a valid phone number.
// However, after the code is verified, FarmVista will ONLY
// allow the user into the app if the verified phone belongs
// to exactly one ACTIVE employee record.

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
  // FIRST: exact normalized phoneE164 match
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


    /*
      Keep going so older employee records can still
      be checked by their formatted phone field.
    */

  }


  // ========================================================
  // SECOND: compatibility with older employee records
  //
  // Older employees may only have:
  //
  // phone: "(217) 555-1234"
  //
  // instead of phoneE164.
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

      console.error(
        "[Login] Duplicate employee phone records:",
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

    /*
      IMPORTANT:
      Do not block a valid employee merely because the
      convenience UID-link write failed.

      Authorization has already been proven by the employee
      lookup above.
    */

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
  auth,
  reason
) {

  console.warn(
    "[Login] phone user denied:",
    reason
  );


  try {

    await signOut(
      auth
    );

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
// AUTH MODE
// ==========================================================

let authMode =
  "email";


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

async function getRecaptchaVerifier(
  auth
) {

  if (
    recaptchaVerifier
  ) {

    return recaptchaVerifier;

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
// BOOT
// ==========================================================

(async function boot() {

  let ctx;
  let auth;


  try {

    await import(
      "../firebase-init.js"
    );


    ctx =
      await ready;


    auth =
      ctx?.auth ||
      getAuth(
        ctx?.app
      );

  }
  catch (
    error
  ) {

    console.warn(
      "[Login] Firebase initialization failed:",
      error
    );


    showErr(
      "Unable to initialize authentication."
    );


    showPhoneErr(
      "Unable to initialize authentication."
    );


    return;

  }


  // ========================================================
  // AUTH METHOD TABS
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
    async event => {

      event.preventDefault();


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


      if (
        ctx &&
        isStub &&
        isStub()
      ) {

        location.replace(
          nextUrl()
        );


        return;

      }


      setButtonBusy(
        els.signIn,
        true,
        "Signing In…",
        "Sign In"
      );


      try {

        await signInWithEmailAndPassword(
          auth,
          email,
          password
        );


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


        setButtonBusy(
          els.signIn,
          false,
          "Signing In…",
          "Sign In"
        );

      }

    }
  );


  // ========================================================
  // PASSWORD RESET
  // ========================================================

  els.forgot?.addEventListener(
    "click",
    async event => {

      event.preventDefault();


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


      if (
        ctx &&
        isStub &&
        isStub()
      ) {

        showErr(
          "Password reset is unavailable in offline mode."
        );


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
  // SEND SMS CODE
  // ========================================================

  async function sendVerificationCode() {

    showPhoneErr(
      ""
    );


    showPhoneVerifyErr(
      ""
    );


    if (
      ctx &&
      isStub &&
      isStub()
    ) {

      showPhoneErr(
        "Phone sign-in is unavailable in offline mode."
      );


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
        await getRecaptchaVerifier(
          auth
        );


      /*
        IMPORTANT:

        Until the optional backend blocking function is added,
        Firebase can still send an SMS to an unknown number.

        The REQUIRED employee authorization check happens
        immediately after the code is verified below.
      */

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
  // VERIFY SMS CODE + REQUIRED EMPLOYEE ACCESS CHECK
  // ========================================================

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

      // ----------------------------------------------------
      // STEP 1:
      // Firebase proves ownership of the phone number.
      // ----------------------------------------------------

      const credential =
        await confirmationResult.confirm(
          code
        );


      const firebaseUser =
        credential?.user ||
        auth.currentUser ||
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
          auth,
          "invalid_phone"
        );


        return;

      }


      // ----------------------------------------------------
      // STEP 2:
      // REQUIRED FARMVISTA AUTHORIZATION CHECK.
      // ----------------------------------------------------

      const employeeMatch =
        await findEmployeeForPhone(
          verifiedPhone
        );


      if (
        !employeeMatch.ok
      ) {

        await rejectPhoneUser(
          auth,
          employeeMatch.reason
        );


        return;

      }


      // ----------------------------------------------------
      // STEP 3:
      // Link this Firebase UID to the employee record.
      // ----------------------------------------------------

      await linkPhoneAuthToEmployee(
        employeeMatch,
        firebaseUser
      );


      // ----------------------------------------------------
      // STEP 4:
      // Clear any previous person's cached FarmVista context.
      // ----------------------------------------------------

      clearFarmVistaUserCache();


      try {

        await window.FVUserContext?.refresh?.({
          force:
            true
        });

      }
      catch {}


      // ----------------------------------------------------
      // STEP 5:
      // ONLY NOW may the user enter FarmVista.
      // ----------------------------------------------------

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


      /*
        If Firebase authentication itself fails, remain on
        the verification-code screen.
      */

      showPhoneVerifyErr(
        phoneVerifyErrorMessage(
          error
        )
      );


      setButtonBusy(
        els.verifyCode,
        false,
        "Verifying…",
        "Verify & Sign In"
      );

    }

  }


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
    async () => {

      showPhoneVerifyErr(
        ""
      );


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
          await getRecaptchaVerifier(
            auth
          );


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
  );


  // ========================================================
  // INITIAL MODE
  // ========================================================

  setAuthMode(
    authMode
  );

})();