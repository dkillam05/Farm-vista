// =====================================================================
// /functions/index.js
// FarmVista • Copilot backend
//  - Exposes fvCopilotChat HTTPS function
//  - Uses OpenAI (ChatGPT) via functions.config().openai.key
//  - Optional Firestore context hook (fieldMaintenance summary)
// =====================================================================

"use strict";

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const OpenAI = require("openai");

// ---------------------------------------------------------
// Firebase Admin init
// ---------------------------------------------------------
if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

// ---------------------------------------------------------
// OpenAI client (v4) – API key stored in functions config:
//
//   firebase functions:config:set openai.key="sk-XXXX"
// ---------------------------------------------------------
const openai = new OpenAI({
  apiKey: functions.config().openai.key,
});

// ---------------------------------------------------------
// Simple CORS helper for your PWA
// (we can tighten this later to your exact domain)
// ---------------------------------------------------------
function setCors(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
}

// ---------------------------------------------------------
// fvCopilotChat
//
// HTTPS endpoint:
//   https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/fvCopilotChat
//
// Request (POST JSON):
//   { "question": "text from Dane", "context": { ...optional } }
//
// Response (JSON):
//   { "answer": "string response from Copilot" }
// ---------------------------------------------------------
exports.fvCopilotChat = functions
  .region("us-central1")
  .https.onRequest(async (req, res) => {
    setCors(res);

    // Preflight (for browsers)
    if (req.method === "OPTIONS") {
      return res.status(204).send("");
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Use POST" });
    }

    try {
      const body = req.body || {};
      const question = (body.question || "").toString().trim();
      const context = body.context || {}; // we can use this later for field/equipment IDs

      if (!question) {
        return res.status(400).json({ error: "Missing 'question' in body." });
      }

      // =====================================================
      // Optional: Firestore context example (fieldMaintenance)
      //  - Right now: if you pass { type: "fieldMaintenanceSummary", fieldId: "abc" }
      //    we pull up to 10 recent work orders for that field and feed a summary to GPT.
      //  - You can ignore this for now; it won't break anything.
      // =====================================================
      let fieldSummary = "";

      try {
        if (context.type === "fieldMaintenanceSummary" && context.fieldId) {
          const snap = await db
            .collection("fieldMaintenance")
            .where("fieldId", "==", context.fieldId)
            .orderBy("createdAt", "desc")
            .limit(10)
            .get();

          if (!snap.empty) {
            const lines = [];
            snap.forEach((doc) => {
              const d = doc.data() || {};
              lines.push(
                [
                  `• Topic: ${d.topicLabel || d.topic || "Unknown"}`,
                  `Status: ${d.status || "unknown"}`,
                  `Priority: ${d.priority ?? "n/a"}`,
                  `Notes: ${(d.notes || "").slice(0, 120)}${
                    (d.notes || "").length > 120 ? "…" : ""
                  }`,
                ].join(" | ")
              );
            });
            fieldSummary = lines.join("\n");
          }
        }
      } catch (ctxErr) {
        console.error("Context lookup failed:", ctxErr);
        // If this fails, we just proceed without extra context
      }

      // =====================================================
      // System prompt – FarmVista Copilot personality
      // =====================================================
      const systemPrompt = `
You are FarmVista Copilot, an internal assistant for Dowson Farms' FarmVista PWA.

You:
- Answer questions clearly and concisely.
- Focus on farm operations: fields, equipment, field maintenance, grain, etc.
- When summarizing maintenance or work orders, be practical and action-oriented.
- If the user asks for a "report", structure your response with headings and bullet points.

If you are given a data extract or summary from Firestore, use ONLY that plus the user's question.
If you don't have enough data to answer precisely, say so and explain what else you'd need.

Current context (may be empty):

Field maintenance summary:
${fieldSummary || "(none loaded)"}
      `.trim();

      // =====================================================
      // Call OpenAI (ChatGPT) via gpt-4.1-mini
      // =====================================================
      const completion = await openai.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: question },
        ],
        temperature: 0.4,
        max_tokens: 800,
      });

      const answer =
        completion?.choices?.[0]?.message?.content?.trim() ||
        "I wasn’t able to generate a response.";

      return res.json({ answer });
    } catch (err) {
      console.error("fvCopilotChat error:", err);
      return res.status(500).json({
        error: "Internal error talking to FarmVista Copilot.",
      });
    }
  });
