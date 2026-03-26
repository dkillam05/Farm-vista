// /js/field-readiness/shared/index.js  (FULL FILE)
// FarmVista MRMS Hourly Trigger Proxy
// Rev: 2026-03-26a-stop-readiness-rebuild-trigger-python-mrms-only
//
// PURPOSE:
// ✅ NO readiness math here
// ✅ NO field_readiness_latest writes here
// ✅ NO readiness-core-shared usage here
// ✅ This service now acts as a lightweight scheduler target / proxy only
// ✅ On scheduler run, it calls the Python MRMS service to:
//    - write latest MRMS hour to field_mrms_weather
//    - optionally process one queued backfill chunk
// ✅ Keeps hourly MRMS updates alive without touching readiness scores
//
// EXPECTED ENV VARS:
// - FV_ALLOWED_ORIGINS               optional CSV for CORS
// - FV_MRMS_SERVICE_BASE_URL         required for scheduler runs
//      example:
//      https://YOUR-MRMS-SERVICE-NAME-xxxxx-uc.a.run.app
// - FV_MRMS_MODE                     optional, default: weighted
// - FV_MRMS_RADIUS_MILES             optional, default: 0.5
// - FV_MRMS_PROCESS_BACKFILL         optional, default: true
// - FV_MRMS_BACKFILL_MAX_FIELDS      optional, default: 1
// - FV_MRMS_BACKFILL_MAX_MINUTES     optional, default: 4
//
// SCHEDULER:
// - Run at quarter past each hour:
//   15 * * * *
//
// NOTES:
// - This file should NOT change readiness anymore.
// - Rain / MRMS comes from the Python service only.
// - If you later want this to run once daily instead, change the scheduler only.
// =====================================================================

const express = require("express");

const app = express();
app.disable("x-powered-by");

const PORT = process.env.PORT || 8080;

// Optional: lock CORS to your domains (comma-separated).
const ALLOWED = (process.env.FV_ALLOWED_ORIGINS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

function cors(req, res) {
  const origin = req.headers.origin || "";
  if (!ALLOWED.length) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  } else if (ALLOWED.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

app.options("*", (req, res) => {
  cors(req, res);
  res.status(204).send("");
});

function num(v, d = null){
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function clamp(v, lo, hi){
  const n = Number(v);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function safeStr(x){
  const s = String(x || "");
  return s ? s : "";
}

function isSchedulerRequest(req){
  const ua = String(req.headers["user-agent"] || "");
  if (ua.includes("Google-Cloud-Scheduler")) return true;
  const run = String(req.query.run || "");
  return run === "1" || run === "true";
}

function makeRunKey(timeZone){
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });

  const parts = dtf.formatToParts(new Date());
  const map = {};
  for (const p of parts) map[p.type] = p.value;

  const y = map.year || "0000";
  const mo = map.month || "01";
  const d = map.day || "01";
  const hh = map.hour || "00";
  const mm = map.minute || "00";
  return `${y}-${mo}-${d}_${hh}${mm}`;
}

function buildUrl(base, path, params = {}){
  const root = String(base || "").replace(/\/+$/, "");
  const p = String(path || "").startsWith("/") ? path : `/${path}`;
  const url = new URL(root + p);

  for (const [k, v] of Object.entries(params)){
    if (v === undefined || v === null || v === "") continue;
    url.searchParams.set(k, String(v));
  }

  return url.toString();
}

async function fetchJsonWithTimeout(url, timeoutMs = 240000){
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try{
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "Accept": "application/json"
      }
    });

    const text = await res.text();
    let data = null;

    try{
      data = text ? JSON.parse(text) : null;
    }catch(_){
      data = { raw: text || "" };
    }

    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      data
    };
  } finally {
    clearTimeout(timer);
  }
}

async function triggerMrmsLatestHour(){
  const baseUrl = safeStr(process.env.FV_MRMS_SERVICE_BASE_URL);
  if (!baseUrl){
    const err = new Error("Missing FV_MRMS_SERVICE_BASE_URL");
    err.code = "MISSING_MRMS_SERVICE_BASE_URL";
    throw err;
  }

  const mode = safeStr(process.env.FV_MRMS_MODE || "weighted").toLowerCase() || "weighted";
  const radiusMiles = num(process.env.FV_MRMS_RADIUS_MILES, 0.5);

  const url = buildUrl(baseUrl, "/run", {
    mode,
    radiusMiles: radiusMiles > 0 ? radiusMiles : 0.5
  });

  const out = await fetchJsonWithTimeout(url, 240000);

  if (!out.ok){
    const err = new Error(`MRMS /run failed (${out.status})`);
    err.code = "MRMS_RUN_FAILED";
    err.details = out;
    throw err;
  }

  return {
    endpoint: url,
    mode,
    radiusMiles: radiusMiles > 0 ? radiusMiles : 0.5,
    response: out.data
  };
}

async function triggerMrmsBackfillWorker(){
  const enabledRaw = safeStr(process.env.FV_MRMS_PROCESS_BACKFILL || "true").toLowerCase();
  const enabled = !(enabledRaw === "0" || enabledRaw === "false" || enabledRaw === "no");

  if (!enabled){
    return {
      skipped: true,
      reason: "FV_MRMS_PROCESS_BACKFILL disabled"
    };
  }

  const baseUrl = safeStr(process.env.FV_MRMS_SERVICE_BASE_URL);
  if (!baseUrl){
    const err = new Error("Missing FV_MRMS_SERVICE_BASE_URL");
    err.code = "MISSING_MRMS_SERVICE_BASE_URL";
    throw err;
  }

  const maxFields = Math.round(clamp(num(process.env.FV_MRMS_BACKFILL_MAX_FIELDS, 1), 1, 1000));
  const maxMinutes = clamp(num(process.env.FV_MRMS_BACKFILL_MAX_MINUTES, 4), 1, 55);

  const url = buildUrl(baseUrl, "/process-next-backfill", {
    maxFields,
    maxMinutes
  });

  const out = await fetchJsonWithTimeout(url, 240000);

  if (!out.ok){
    const err = new Error(`MRMS /process-next-backfill failed (${out.status})`);
    err.code = "MRMS_BACKFILL_FAILED";
    err.details = out;
    throw err;
  }

  return {
    endpoint: url,
    maxFields,
    maxMinutes,
    response: out.data
  };
}

app.get("/", async (req, res) => {
  cors(req, res);

  if (!isSchedulerRequest(req)){
    return res.status(200).send(
      "FarmVista MRMS trigger proxy OK. Use /?run=1 to trigger Python MRMS latest-hour write."
    );
  }

  try{
    const timezone = String(req.query.timezone || "America/Chicago");
    const runKey = String(req.query.runKey || "").trim() || makeRunKey(timezone);

    const latestHour = await triggerMrmsLatestHour();
    const backfill = await triggerMrmsBackfillWorker();

    return res.status(200).json({
      ok: true,
      mode: "mrms_only_trigger",
      ranAt: new Date().toISOString(),
      runKey,
      timezone,
      latestHour,
      backfill
    });
  }catch(e){
    console.error("[MRMS Trigger Proxy] run failed:", e);

    return res.status(500).json({
      ok: false,
      error: e?.message || "MRMS trigger failed",
      code: e?.code || null,
      details: e?.details?.data || null,
      hint:
        e?.code === "MISSING_MRMS_SERVICE_BASE_URL"
          ? "Set FV_MRMS_SERVICE_BASE_URL to your Python MRMS Cloud Run base URL."
          : null
    });
  }
});

app.get("/healthz", (req, res) => {
  cors(req, res);
  res.status(200).send("ok");
});

app.listen(PORT, () => {
  console.log(`farmvista-mrms-trigger-proxy listening on ${PORT}`);
});