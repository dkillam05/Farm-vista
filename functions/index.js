// functions/index.js
const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const OpenAI = require("openai");

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

// Read API key from Firebase config: functions.config().openai.key
const functions = require("firebase-functions");
const openai = new OpenAI({
  apiKey: functions.config().openai.key,
});

exports.fvCopilotChat = onRequest(async (req, res) => {
  // Basic CORS so your PWA can call this
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.status(204).send("");
  }

  try {
    // ---- 1. Auth guard (requires Firebase ID token) ----
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (!token) {
      return res.status(401).json({ error: "Missing auth token" });
    }

    const decoded = await admin.auth().verifyIdToken(token);
    const uid = decoded.uid;

    // ---- 2. Read prompt from body ----
    const body = req.body || {};
    const prompt = (body.prompt || "").toString().trim();
    if (!prompt) {
      return res.status(400).json({ error: "Missing prompt" });
    }

    // ---- 3. Example: pull some context from Firestore ----
    // You can change this query later to whatever you want Copilot to see
    const fmSnap = await db.collection("fieldMaintenance")
      .where("status", "in", ["needs_approved", "pending"])
      .limit(20)
      .get();

    const items = fmSnap.docs.map(d => {
      const x = d.data();
      const field = x.fieldName || x.fieldId || d.id;
      const status = x.status || "unknown";
      const priority = x.priority != null ? x.priority : "n/a";
      const details = (x.details || x.notes || "").toString().slice(0, 140);
      return `• Field ${field} — status: ${status}, priority: ${priority}, notes: ${details}`;
    });

    const context = items.length
      ? items.join("\n")
      : "No matching field maintenance items found.";

    // ---- 4. Call OpenAI (GPT-4.1-mini) ----
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content:
            "You are FarmVista Copilot. You help farmers by summarizing data from their system and answering clearly in a few short paragraphs or bullet points.",
        },
        {
          role: "user",
          content:
            `User ID: ${uid}\n\n` +
            `Question: ${prompt}\n\n` +
            `Relevant data:\n${context}`,
        },
      ],
      max_tokens: 400,
    });

    const reply =
      completion.choices[0]?.message?.content ||
      "Sorry, I couldn't generate a response.";

    return res.json({ reply });
  } catch (err) {
    console.error("[fvCopilotChat] error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
});