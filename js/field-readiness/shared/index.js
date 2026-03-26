// /js/field-readiness/shared/index.js  (FULL FILE)
// FarmVista Rainfall Sync Only (Cloud Run)
// Rev: 2026-03-26b-remove-readiness-rebuild-keep-rainfall-sync-only
//
// PURPOSE:
// ✅ DOES NOT calculate readiness
// ✅ DOES NOT write readiness / wetness / storage fields
// ✅ DOES NOT write modelRows / tankTrace
// ✅ DOES NOT overwrite frontend readiness scores
// ✅ ONLY syncs rainfall/history support data into field_readiness_latest:
//    - dailySeries30d
//    - dailySeriesFcst
//    - dailySeriesMeta
//    - mrmsDailySeries30d
//    - mrmsHourlyLast24
//    - mrmsHourlyLatest
//    - mrmsHistoryMeta
//    - mrmsLastUpdatedAt
//    - historyReady
//    - historyCoverageMeta
//    - locationChanged
// ✅ Uses existing field_weather_cache + field_mrms_weather
// ✅ Keeps active fields visible in latest collection without touching readiness
//
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
function round(v, d=2){
  const p = Math.pow(10, d);
  return Math.round(Number(v) * p) / p;
}
function mmToIn(mm){
  return Number(mm || 0) / 25.4;
}
function safeStr(x){
  const s = String(x || "");
  return s ? s : "";
}
function safeISO10(x){
  const s = safeStr(x);
  return s.length >= 10 ? s.slice(0, 10) : s;
}
function safeNum(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function normalizeStatus(s){
  return String(s || "").trim().toLowerCase();
}

/* =====================================================================
   Firestore
===================================================================== */
const READINESS_LATEST_COLLECTION = process.env.FV_READINESS_LATEST_COLLECTION || "field_readiness_latest";
const READINESS_RUNS_COLLECTION = process.env.FV_READINESS_RUNS_COLLECTION || "field_readiness_runs";
const MRMS_COLLECTION = process.env.FV_MRMS_COLLECTION || "field_mrms_weather";
const WEATHER_CACHE_COLLECTION = process.env.FV_WEATHER_CACHE_COLLECTION || "field_weather_cache";

const HISTORY_DAYS_REQUIRED = 30;
const MRMS_MIN_COVERAGE = 0.90;
const LOCATION_EPSILON = 0.00001;

let _admin = null;
let _db = null;

function getFirestore(){
  if (_db) return _db;

  try{
    if (!_admin) _admin = require("firebase-admin");
  }catch(e){
    const err = new Error("firebase-admin is not installed. Add it to dependencies in package.json.");
    err.code = "MISSING_FIREBASE_ADMIN";
    throw err;
  }

  if (!_admin.apps || !_admin.apps.length){
    _admin.initializeApp();
  }

  _db = _admin.firestore();
  return _db;
}

/* =====================================================================
   Helpers
===================================================================== */
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

async function ensureRunLockOrSkip(runKey, timezone){
  const db = getFirestore();
  const runRef = db.collection(READINESS_RUNS_COLLECTION).doc(runKey);

  let shouldRun = false;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(runRef);
    if (snap.exists){
      const d = snap.data() || {};
      const st = String(d.status || "");
      if (st === "done" || st === "running"){
        shouldRun = false;
        return;
      }
    }
    tx.set(runRef, {
      status: "running",
      timezone,
      startedAt: _admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    shouldRun = true;
  });

  return { shouldRun, runRef };
}

/* =====================================================================
   Field helpers
===================================================================== */
function getByPath(obj, path){
  try{
    const parts = String(path || "").split(".");
    let cur = obj;
    for (const p of parts){
      if (!cur || typeof cur !== "object") return undefined;
      cur = cur[p];
    }
    return cur;
  }catch(_){
    return undefined;
  }
}

function toNumMaybe(v){
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string"){
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  if (v && typeof v === "object"){
    if (typeof v.value === "number" && Number.isFinite(v.value)) return v.value;
    if (typeof v.value === "string"){
      const n = Number(String(v.value).trim());
      return Number.isFinite(n) ? n : null;
    }
    if (typeof v.n === "number" && Number.isFinite(v.n)) return v.n;
    if (typeof v.n === "string"){
      const n = Number(String(v.n).trim());
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

function pickFirstNumber(d, paths){
  for (const p of paths){
    const raw = getByPath(d, p);
    const n = toNumMaybe(raw);
    if (n != null) return n;
  }
  return null;
}

function extractLocation(d){
  const lat = pickFirstNumber(d, [
    "location.lat", "location.latitude", "lat", "latitude",
    "gps.lat", "gps.latitude", "center.lat", "center.latitude",
    "fieldCenter.lat", "fieldCenter.latitude", "coordinates.lat",
    "coordinates.latitude", "centroid.lat", "centroid.latitude",
    "map.lat", "map.latitude"
  ]);

  const lng = pickFirstNumber(d, [
    "location.lng", "location.lon", "location.long", "location.longitude",
    "lng", "lon", "long", "longitude",
    "gps.lng", "gps.lon", "gps.long", "gps.longitude",
    "center.lng", "center.lon", "center.long", "center.longitude",
    "fieldCenter.lng", "fieldCenter.lon", "fieldCenter.long", "fieldCenter.longitude",
    "coordinates.lng", "coordinates.lon", "coordinates.long", "coordinates.longitude",
    "centroid.lng", "centroid.lon", "centroid.long", "centroid.longitude",
    "map.lng", "map.lon", "map.long", "map.longitude"
  ]);

  if (
    lat == null || lng == null ||
    !Number.isFinite(lat) || !Number.isFinite(lng) ||
    Math.abs(Number(lat)) > 90 || Math.abs(Number(lng)) > 180
  ){
    return null;
  }

  return { lat: Number(lat), lng: Number(lng) };
}

async function loadActiveFieldsMap(){
  const db = getFirestore();
  const out = new Map();
  let raw = [];

  try{
    const snap = await db.collection("fields").where("status", "==", "active").get();
    snap.forEach(doc => raw.push({ id: doc.id, data: doc.data() || {} }));
  }catch(e){
    console.warn("[RainSync] fields query(status==active) failed:", e?.message || e);
  }

  if (!raw.length){
    try{
      const snap2 = await db.collection("fields").get();
      snap2.forEach(doc => raw.push({ id: doc.id, data: doc.data() || {} }));
    }catch(e){
      console.warn("[RainSync] fields query(all) failed:", e?.message || e);
      raw = [];
    }
  }

  for (const r of raw){
    const d = r.data || {};
    const st = normalizeStatus(d.status);
    if (st && st !== "active") continue;

    out.set(r.id, {
      id: r.id,
      data: d,
      location: extractLocation(d)
    });
  }

  return out;
}

/* =====================================================================
   Cache loaders
===================================================================== */
async function loadWeatherCacheMap(){
  const db = getFirestore();
  const out = new Map();

  try{
    const snap = await db.collection(WEATHER_CACHE_COLLECTION).get();
    snap.forEach(docSnap => {
      out.set(String(docSnap.id), docSnap.data() || {});
    });
  }catch(e){
    console.warn("[RainSync] loadWeatherCacheMap failed:", e?.message || e);
  }

  return out;
}

async function loadMrmsDocMap(){
  const db = getFirestore();
  const out = new Map();

  try{
    const snap = await db.collection(MRMS_COLLECTION).get();
    snap.forEach(docSnap => {
      out.set(String(docSnap.id), docSnap.data() || {});
    });
  }catch(e){
    console.warn("[RainSync] loadMrmsDocMap failed:", e?.message || e);
  }

  return out;
}

/* =====================================================================
   MRMS helpers
===================================================================== */
function toYMDLocal(d){
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function startOfDayLocal(d){
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}
function addDaysLocal(d, delta){
  const out = new Date(d);
  out.setDate(out.getDate() + delta);
  return out;
}
function getDefaultRainRange72h(){
  const end = new Date();
  const start = new Date(end.getTime() - (72 * 60 * 60 * 1000));
  return { start, end };
}
function getMrmsDailySeries(doc){
  return Array.isArray(doc && doc.mrmsDailySeries30d) ? doc.mrmsDailySeries30d : [];
}
function getMrmsDailyMap(doc){
  const rows = getMrmsDailySeries(doc);
  const map = new Map();
  for (const r of rows){
    const key = String(r && r.dateISO || "").trim();
    if (!key) continue;
    map.set(key, r);
  }
  return map;
}
function mrmsBackfillReadyServer(doc){
  if (!doc || typeof doc !== "object") return false;

  const map = getMrmsDailyMap(doc);
  if (!map.size) return false;

  const meta = doc.mrmsHistoryMeta || {};
  const def = getDefaultRainRange72h();

  const start = startOfDayLocal(def.start);
  const end = startOfDayLocal(def.end);

  if (meta && meta.fullBackfillComplete === true){
    let cursor = new Date(start);
    while (cursor <= end){
      const key = toYMDLocal(cursor);
      if (!map.has(key)) return false;
      cursor = addDaysLocal(cursor, 1);
    }
    return true;
  }

  let cursor = new Date(start);
  while (cursor <= end){
    const key = toYMDLocal(cursor);
    if (!map.has(key)) return false;
    cursor = addDaysLocal(cursor, 1);
  }

  return true;
}

function getRecentMrmsDailyRows(mrmsDoc, days = HISTORY_DAYS_REQUIRED){
  const rows = Array.isArray(mrmsDoc && mrmsDoc.mrmsDailySeries30d) ? mrmsDoc.mrmsDailySeries30d.slice() : [];
  return rows.slice(-days);
}

function getMrmsCoverageStats(mrmsDoc, days = HISTORY_DAYS_REQUIRED){
  const rows = getRecentMrmsDailyRows(mrmsDoc, days);
  const expectedHours = days * 24;

  let actualHours = 0;
  for (const r of rows){
    const hrs = Math.max(0, Math.min(24, Math.round(num(r && r.hoursCount, 0))));
    actualHours += hrs;
  }

  const coverage = expectedHours > 0 ? (actualHours / expectedHours) : 0;

  return {
    daysRequired: days,
    daysPresent: rows.length,
    expectedHours,
    actualHours,
    coverage,
    coveragePct: round(coverage * 100, 1),
    isReady: rows.length >= days && coverage >= MRMS_MIN_COVERAGE
  };
}

function hasSufficientWeatherHistory(wxDoc, days = HISTORY_DAYS_REQUIRED){
  const rows = Array.isArray(wxDoc && wxDoc.dailySeries) ? wxDoc.dailySeries : [];
  return rows.length >= days;
}

function buildHistoryReadiness(wxDoc, mrmsDoc, days = HISTORY_DAYS_REQUIRED){
  const weatherReady = hasSufficientWeatherHistory(wxDoc, days);
  const mrmsStats = getMrmsCoverageStats(mrmsDoc, days);
  const recentReady = mrmsBackfillReadyServer(mrmsDoc);

  return {
    ready: weatherReady && (mrmsStats.isReady || recentReady),
    weatherReady,
    mrmsStats,
    recentReady
  };
}

function hasLocationChanged(oldLocation, newLocation){
  if (!oldLocation || !newLocation) return false;

  const oldLat = Number(oldLocation.lat);
  const oldLng = Number(oldLocation.lng);
  const newLat = Number(newLocation.lat);
  const newLng = Number(newLocation.lng);

  if (!Number.isFinite(oldLat) || !Number.isFinite(oldLng)) return false;
  if (!Number.isFinite(newLat) || !Number.isFinite(newLng)) return false;

  return (
    Math.abs(oldLat - newLat) > LOCATION_EPSILON ||
    Math.abs(oldLng - newLng) > LOCATION_EPSILON
  );
}

/* =====================================================================
   Field metadata base
===================================================================== */
function buildBaseLatestDoc({
  fieldId,
  fieldData,
  fieldLocation,
  wxDoc,
  runKey,
  timezone
}){
  const fd = fieldData || {};
  const wx = wxDoc || {};

  return {
    fieldId: String(fieldId),
    fieldName: safeStr(fd.name || wx.fieldName || null) || null,
    farmId: fd.farmId || wx.farmId || null,
    farmName: fd.farmName || wx.farmName || null,
    county: fd.county || null,
    state: fd.state || null,
    location: fieldLocation || wx.location || null,
    soilWetness: Number.isFinite(Number(fd.soilWetness)) ? Number(fd.soilWetness) : null,
    drainageIndex: Number.isFinite(Number(fd.drainageIndex)) ? Number(fd.drainageIndex) : null,
    weatherFetchedAt: wx.fetchedAt || null,
    weatherSource: wx.source || null,
    runKey,
    timezone,
    computedAt: _admin.firestore.FieldValue.serverTimestamp()
  };
}

/* =====================================================================
   Rainfall-only sync writer
===================================================================== */
async function writeRainfallSupportLatest(runKey, timezone){
  const db = getFirestore();

  const [fieldsMap, mrmsMap, wxMap] = await Promise.all([
    loadActiveFieldsMap(),
    loadMrmsDocMap(),
    loadWeatherCacheMap()
  ]);

  let batch = db.batch();
  let writes = 0;
  let ok = 0;
  let fail = 0;
  let totalFields = 0;
  let latLngChangedFields = 0;

  const fieldEntries = Array.from(fieldsMap.entries());
  const CHUNK_SIZE = 10;

  for (let i = 0; i < fieldEntries.length; i += CHUNK_SIZE){
    const chunk = fieldEntries.slice(i, i + CHUNK_SIZE);

    for (const [fieldId, fieldRow] of chunk){
      totalFields++;

      const fd = fieldRow ? (fieldRow.data || {}) : {};
      const currentLocation = fieldRow?.location || null;
      const wxRaw = wxMap.get(fieldId) || null;
      const mrmsRaw = mrmsMap.get(fieldId) || null;

      try{
        const wxLocationChanged = hasLocationChanged(wxRaw && wxRaw.location, currentLocation);
        const mrmsLocationChanged = hasLocationChanged(mrmsRaw && mrmsRaw.location, currentLocation);
        const locationChanged = !!(wxLocationChanged || mrmsLocationChanged);

        const wx = locationChanged ? null : wxRaw;
        const mrmsDoc = locationChanged ? null : mrmsRaw;

        if (locationChanged){
          latLngChangedFields++;
        }

        const outRef = db.collection(READINESS_LATEST_COLLECTION).doc(fieldId);
        const baseDoc = buildBaseLatestDoc({
          fieldId,
          fieldData: fd,
          fieldLocation: currentLocation,
          wxDoc: wx,
          runKey,
          timezone
        });

        const historyReadiness = buildHistoryReadiness(wx, mrmsDoc, HISTORY_DAYS_REQUIRED);

        const dailySeries30d = Array.isArray(wx && wx.dailySeries)
          ? wx.dailySeries.slice(-HISTORY_DAYS_REQUIRED)
          : [];

        const dailySeriesFcst = Array.isArray(wx && wx.dailySeriesFcst)
          ? wx.dailySeriesFcst.slice(0, 7)
          : [];

        const mrmsDailySeries30d = Array.isArray(mrmsDoc && mrmsDoc.mrmsDailySeries30d)
          ? mrmsDoc.mrmsDailySeries30d.slice(-HISTORY_DAYS_REQUIRED)
          : [];

        const mrmsHourlyLast24 = Array.isArray(mrmsDoc && mrmsDoc.mrmsHourlyLast24)
          ? mrmsDoc.mrmsHourlyLast24.slice(-24)
          : [];

        const mrmsHourlyLatest = mrmsDoc && mrmsDoc.mrmsHourlyLatest
          ? mrmsDoc.mrmsHourlyLatest
          : null;

        batch.set(outRef, {
          ...baseDoc,

          dailySeries30d,
          dailySeriesFcst,
          dailySeriesMeta: {
            histDays: dailySeries30d.length,
            fcstDays: dailySeriesFcst.length,
            todayISO: safeISO10((dailySeries30d[dailySeries30d.length - 1] || {}).dateISO) || null
          },

          historyReady: historyReadiness.ready,
          historyCoverageMeta: historyReadiness.mrmsStats,
          locationChanged,

          mrmsDailySeries30d,
          mrmsHourlyLast24,
          mrmsHourlyLatest,
          mrmsHistoryMeta: mrmsDoc && mrmsDoc.mrmsHistoryMeta ? mrmsDoc.mrmsHistoryMeta : null,
          mrmsLastUpdatedAt: mrmsDoc && mrmsDoc.mrmsLastUpdatedAt ? mrmsDoc.mrmsLastUpdatedAt : null,

          debug: {
            rainfallOnlySync: true,
            locationChanged,
            wxLocationChanged,
            mrmsLocationChanged,
            recentMrmsReady: historyReadiness.recentReady
          }
        }, { merge: true });

        writes++;
        ok++;

        if (writes >= 50){
          await batch.commit();
          batch = db.batch();
          writes = 0;
        }
      }catch(e){
        fail++;
        console.warn("[RainSync] field failed:", fieldId, e?.message || e);
      }
    }

    await new Promise(r => setTimeout(r, 50));
  }

  if (writes > 0){
    await batch.commit();
  }

  return {
    ok,
    fail,
    latLngChangedFields,
    totalFields,
    weatherDocs: wxMap.size,
    mrmsDocs: mrmsMap.size
  };
}

/* =====================================================================
   Routes
===================================================================== */
app.get("/", async (req, res) => {
  cors(req, res);

  if (isSchedulerRequest(req)){
    try{
      const timezone = String(req.query.timezone || "America/Chicago");
      const runKey = String(req.query.runKey || "").trim() || makeRunKey(timezone);

      const lock = await ensureRunLockOrSkip(runKey, timezone);

      let rainfall = null;
      if (lock.shouldRun){
        rainfall = await writeRainfallSupportLatest(runKey, timezone);
        await lock.runRef.set({
          status: "done",
          finishedAt: _admin.firestore.FieldValue.serverTimestamp(),
          fieldsOk: rainfall.ok,
          fieldsFail: rainfall.fail,
          latLngChangedFields: rainfall.latLngChangedFields,
          totalFields: rainfall.totalFields,
          weatherDocs: rainfall.weatherDocs,
          mrmsDocs: rainfall.mrmsDocs,
          mode: "rainfall_support_only"
        }, { merge: true });
      } else {
        rainfall = { skipped: true, reason: "runKey already processed", runKey };
      }

      return res.status(200).json({
        ok: true,
        mode: "rainfall_support_only",
        ranAt: new Date().toISOString(),
        runKey,
        rainfall
      });
    }catch(e){
      console.error("[RainSync] run failed:", e);
      return res.status(500).json({
        ok: false,
        error: e?.message || "Rainfall sync failed",
        code: e?.code || null,
        hint: (e?.code === "MISSING_FIREBASE_ADMIN")
          ? "Add firebase-admin to package.json dependencies and redeploy."
          : null
      });
    }
  }

  return res.status(200).send(
    "FarmVista Rainfall Sync Only OK. Use /?run=1 to sync rainfall support fields into field_readiness_latest."
  );
});

app.get("/healthz", (req, res) => {
  cors(req, res);
  res.status(200).send("ok");
});

app.listen(PORT, () => {
  console.log(`farmvista-rainfall-sync-only listening on ${PORT}`);
});