const functions = require("@google-cloud/functions-framework");
const admin = require("firebase-admin");
const twilio = require("twilio");

const FARM_PROJECTS = {
  dowson: "dowsonfarms-illinois",
  borrowman: "borrowman-farms"
};

const ALLOWED_ORIGINS = new Set([
  "https://farmvista.app",
  "https://www.farmvista.app",
  "http://localhost",
  "http://localhost:5000",
  "http://127.0.0.1:5000"
]);

const farmApps = new Map();

function setCors(req, res) {
  const origin = String(req.get("origin") || "").trim();

  if (ALLOWED_ORIGINS.has(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
  }

  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
}

function normalizeUSPhone(raw) {
  let digits = String(raw || "").replace(/\D+/g, "");

  if (digits.length === 11 && digits.startsWith("1")) {
    digits = digits.slice(1);
  }

  if (digits.length !== 10) {
    return "";
  }

  return `+1${digits}`;
}

function getFarmApp(farmKey) {
  const projectId = FARM_PROJECTS[farmKey];

  if (!projectId) {
    throw new Error("Unknown FarmVista farm.");
  }

  if (farmApps.has(farmKey)) {
    return farmApps.get(farmKey);
  }

  const app = admin.initializeApp(
    {
      credential: admin.credential.applicationDefault(),
      projectId
    },
    `farm-${farmKey}`
  );

  farmApps.set(farmKey, app);
  return app;
}

async function verifyCaller(req, farmKey) {
  const authHeader = String(req.get("authorization") || "");
  const match = authHeader.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    const error = new Error("Authentication required.");
    error.status = 401;
    throw error;
  }

  const app = getFarmApp(farmKey);
  const decoded = await admin.auth(app).verifyIdToken(match[1]);

  if (!decoded || !decoded.uid) {
    const error = new Error("Invalid login.");
    error.status = 401;
    throw error;
  }

  return decoded;
}

async function assertActiveEmployeePhone(farmKey, phone) {
  const app = getFarmApp(farmKey);
  const db = admin.firestore(app);

  const direct = await db
    .collection("employees")
    .where("phoneE164", "==", phone)
    .limit(1)
    .get();

  if (!direct.empty) {
    const data = direct.docs[0].data() || {};

    if (data.active === true || data.status === "Active") {
      return;
    }
  }

  const all = await db.collection("employees").get();

  for (const doc of all.docs) {
    const data = doc.data() || {};
    const existing = normalizeUSPhone(data.phoneE164 || data.phone || "");

    if (
      existing === phone &&
      (data.active === true || data.status === "Active")
    ) {
      return;
    }
  }

  const error = new Error(
    "That phone number is not assigned to an active employee."
  );
  error.status = 400;
  throw error;
}

functions.http("farmvistaEmployeeInvite", async (req, res) => {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(204).send("");
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed."
    });
  }

  try {
    const body =
      req.body && typeof req.body === "object"
        ? req.body
        : {};

    const farmKey = String(body.farmKey || "")
      .trim()
      .toLowerCase();

    const phone = normalizeUSPhone(body.phone);

    const firstName = String(body.firstName || "").trim();
    const lastName = String(body.lastName || "").trim();

    if (!FARM_PROJECTS[farmKey]) {
      return res.status(400).json({
        ok: false,
        error: "Invalid farm."
      });
    }

    if (!phone) {
      return res.status(400).json({
        ok: false,
        error: "A valid mobile phone number is required."
      });
    }

    await verifyCaller(req, farmKey);
    await assertActiveEmployeePhone(farmKey, phone);

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_FROM_NUMBER;

    if (!accountSid || !authToken || !fromNumber) {
      throw new Error("Twilio configuration is incomplete.");
    }

    const client = twilio(accountSid, authToken);

    const name = [firstName, lastName]
      .filter(Boolean)
      .join(" ")
      .trim();

    const greeting = name
      ? `Hi ${firstName || name}, `
      : "";

    const message =
      `${greeting}you've been invited to FarmVista. ` +
      "Open https://farmvista.app/ to access the app. " +
      "Use your mobile number to sign in.";

    const sent = await client.messages.create({
      to: phone,
      from: fromNumber,
      body: message
    });

    console.info("[Employee Invite] SMS sent", {
      farmKey,
      to: phone,
      sid: sent.sid
    });

    return res.status(200).json({
      ok: true,
      sid: sent.sid
    });
  } catch (error) {
    console.error("[Employee Invite] Failed", error);

    const status =
      Number(error?.status) ||
      (error?.code === "auth/id-token-expired" ||
      error?.code === "auth/argument-error"
        ? 401
        : 500);

    return res.status(status).json({
      ok: false,
      error:
        status >= 500
          ? "Employee invite could not be sent."
          : String(error?.message || "Invite failed.")
    });
  }
});
