// /js/field-readiness/shared/index.js  (FULL FILE)
// FarmVista Readiness Rebuilder (Cloud Run)
// Rev: 2026-04-29a-scheduler-safe-paged-display-refresh
//
// PURPOSE:
// ✅ DOES NOT fetch Open-Meteo
// ✅ DOES NOT write field_weather_cache
// ✅ ONLY reads existing field_weather_cache as primary input
// ✅ STILL writes weather / display history into field_readiness_latest
// ✅ STILL uses MRMS overlay when ready enough for display/model rows
// ✅ STILL iterates ALL active fields
// ✅ STILL writes placeholder docs for new fields so they are not invisible
// ✅ STILL ignores stale cache automatically when lat/lng changed
// ✅ SAFER scheduled runs: pages fields and loads per-field support docs
// ✅ SAFER runKey: hourly bucket by default
// ❌ DOES NOT overwrite readiness score fields in field_readiness_latest
// ❌ DOES NOT overwrite wetness/storage/readiness-derived scalar fields

const express = require("express");
const {
  runFieldReadinessCore,
  runReadinessFromPersistedStateOnly
} = require("./readiness-core-shared.cjs");

const app = express();
app.disable("x-powered-by");

const PORT = process.env.PORT || 8080;

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

function round(v, d = 2){
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  const p = Math.pow(10, d);
  return Math.round(n * p) / p;
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
   Firestore / env
===================================================================== */
const READINESS_LATEST_COLLECTION = process.env.FV_READINESS_LATEST_COLLECTION || "field_readiness_latest";
const READINESS_RUNS_COLLECTION = process.env.FV_READINESS_RUNS_COLLECTION || "field_readiness_runs";
const PERSISTED_STATE_COLLECTION = process.env.FV_PERSISTED_STATE_COLLECTION || "field_readiness_state";
const MRMS_COLLECTION = process.env.FV_MRMS_COLLECTION || "field_mrms_weather";
const WEATHER_CACHE_COLLECTION = process.env.FV_WEATHER_CACHE_COLLECTION || "field_weather_cache";
const FIELDS_COLLECTION = process.env.FV_FIELDS_COLLECTION || "fields";

const PAGE_SIZE = Math.max(5, Math.min(100, Number(process.env.FV_READINESS_FIELD_PAGE_SIZE || 25)));
const BATCH_COMMIT_SIZE = Math.max(10, Math.min(400, Number(process.env.FV_READINESS_BATCH_COMMIT_SIZE || 50)));
const HISTORY_DAYS_REQUIRED = 30;
const MRMS_MIN_COVERAGE = 0.90;
const LOCATION_EPSILON = 0.00001;

const LOSS_SCALE = Number.isFinite(Number(process.env.FV_READINESS_LOSS_SCALE))
  ? Number(process.env.FV_READINESS_LOSS_SCALE)
  : 0.55;

const EXTRA = {
  DRYPWR_VPD_W: Number.isFinite(Number(process.env.FV_DRYPWR_VPD_W)) ? Number(process.env.FV_DRYPWR_VPD_W) : 0.06,
  DRYPWR_CLOUD_W: Number.isFinite(Number(process.env.FV_DRYPWR_CLOUD_W)) ? Number(process.env.FV_DRYPWR_CLOUD_W) : 0.04,
  LOSS_ET0_W: Number.isFinite(Number(process.env.FV_LOSS_ET0_W)) ? Number(process.env.FV_LOSS_ET0_W) : 0.08,
  ADD_SM010_W: Number.isFinite(Number(process.env.FV_ADD_SM010_W)) ? Number(process.env.FV_ADD_SM010_W) : 0.10,
  STORAGE_CAP_SM010_W: Number.isFinite(Number(process.env.FV_STORAGE_CAP_SM010_W)) ? Number(process.env.FV_STORAGE_CAP_SM010_W) : 0.05,
  DRY_LOSS_MULT: Number.isFinite(Number(process.env.FV_DRY_LOSS_MULT)) ? Number(process.env.FV_DRY_LOSS_MULT) : 1.0,
  RAIN_EFF_MULT: Number.isFinite(Number(process.env.FV_RAIN_EFF_MULT)) ? Number(process.env.FV_RAIN_EFF_MULT) : 1.0
};

const FV_TUNE = {
  SAT_RUNOFF_START: Number.isFinite(Number(process.env.FV_SAT_RUNOFF_START)) ? Number(process.env.FV_SAT_RUNOFF_START) : 0.75,
  RUNOFF_EXP: Number.isFinite(Number(process.env.FV_RUNOFF_EXP)) ? Number(process.env.FV_RUNOFF_EXP) : 2.2,
  RUNOFF_DRAINPOOR_W: Number.isFinite(Number(process.env.FV_RUNOFF_DRAINPOOR_W)) ? Number(process.env.FV_RUNOFF_DRAINPOOR_W) : 0.35,

  DRY_BYPASS_END: Number.isFinite(Number(process.env.FV_DRY_BYPASS_END)) ? Number(process.env.FV_DRY_BYPASS_END) : 0.35,
  DRY_EXP: Number.isFinite(Number(process.env.FV_DRY_EXP)) ? Number(process.env.FV_DRY_EXP) : 1.6,
  DRY_BYPASS_BASE: Number.isFinite(Number(process.env.FV_DRY_BYPASS_BASE)) ? Number(process.env.FV_DRY_BYPASS_BASE) : 0.45,
  BYPASS_GOODDRAIN_W: Number.isFinite(Number(process.env.FV_BYPASS_GOODDRAIN_W)) ? Number(process.env.FV_BYPASS_GOODDRAIN_W) : 0.15,

  DRY_BYPASS_CAP_SAT: Number.isFinite(Number(process.env.FV_DRY_BYPASS_CAP_SAT)) ? Number(process.env.FV_DRY_BYPASS_CAP_SAT) : 0.15,
  DRY_BYPASS_CAP_MAX: Number.isFinite(Number(process.env.FV_DRY_BYPASS_CAP_MAX)) ? Number(process.env.FV_DRY_BYPASS_CAP_MAX) : 0.12,

  SAT_DRYBYPASS_FLOOR: Number.isFinite(Number(process.env.FV_SAT_DRYBYPASS_FLOOR)) ? Number(process.env.FV_SAT_DRYBYPASS_FLOOR) : 0.02,
  SAT_RUNOFF_CAP: Number.isFinite(Number(process.env.FV_SAT_RUNOFF_CAP)) ? Number(process.env.FV_SAT_RUNOFF_CAP) : 0.85,
  RAIN_EFF_MIN: Number.isFinite(Number(process.env.FV_RAIN_EFF_MIN)) ? Number(process.env.FV_RAIN_EFF_MIN) : 0.05,

  DRY_TAIL_START: Number.isFinite(Number(process.env.FV_DRY_TAIL_START)) ? Number(process.env.FV_DRY_TAIL_START) : 0.12,
  DRY_TAIL_MIN_MULT: Number.isFinite(Number(process.env.FV_DRY_TAIL_MIN_MULT)) ? Number(process.env.FV_DRY_TAIL_MIN_MULT) : 0.55,

  WET_HOLD_START: Number.isFinite(Number(process.env.FV_WET_HOLD_START)) ? Number(process.env.FV_WET_HOLD_START) : 0.62,
  WET_HOLD_MAX_REDUCTION: Number.isFinite(Number(process.env.FV_WET_HOLD_MAX_REDUCTION)) ? Number(process.env.FV_WET_HOLD_MAX_REDUCTION) : 0.32,
  WET_HOLD_EXP: Number.isFinite(Number(process.env.FV_WET_HOLD_EXP)) ? Number(process.env.FV_WET_HOLD_EXP) : 1.70,

  MID_ACCEL_START: Number.isFinite(Number(process.env.FV_MID_ACCEL_START)) ? Number(process.env.FV_MID_ACCEL_START) : 0.50,
  MID_ACCEL_MAX_BOOST: Number.isFinite(Number(process.env.FV_MID_ACCEL_MAX_BOOST)) ? Number(process.env.FV_MID_ACCEL_MAX_BOOST) : 0.18,
  MID_ACCEL_EXP: Number.isFinite(Number(process.env.FV_MID_ACCEL_EXP)) ? Number(process.env.FV_MID_ACCEL_EXP) : 1.35
};

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

function fv(){
  getFirestore();
  return _admin.firestore.FieldValue;
}

/* =====================================================================
   Scheduler / run lock
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
    hour12: false
  });

  const parts = dtf.formatToParts(new Date());
  const map = {};
  for (const p of parts) map[p.type] = p.value;

  const y = map.year || "0000";
  const mo = map.month || "01";
  const d = map.day || "01";
  const hh = map.hour || "00";

  return `${y}-${mo}-${d}_${hh}00`;
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
      startedAt: fv().serverTimestamp(),
      mode: "readiness_display_refresh_only",
      rev: "2026-04-29a-scheduler-safe-paged-display-refresh"
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

function extractFieldParamsLikeFrontend(d){
  const soilWetness = pickFirstNumber(d, [
    "soilWetness",
    "fieldReadiness.soilWetness",
    "readiness.soilWetness",
    "params.soilWetness",
    "sliders.soilWetness",
    "field_readiness.soilWetness"
  ]);

  const drainageIndex = pickFirstNumber(d, [
    "drainageIndex",
    "fieldReadiness.drainageIndex",
    "readiness.drainageIndex",
    "params.drainageIndex",
    "sliders.drainageIndex",
    "field_readiness.drainageIndex"
  ]);

  return {
    soilWetness: soilWetness == null ? null : soilWetness,
    drainageIndex: drainageIndex == null ? null : drainageIndex
  };
}

/* =====================================================================
   Paged fields
===================================================================== */
async function getFieldPage(cursorDoc){
  const db = getFirestore();

  let q = db.collection(FIELDS_COLLECTION)
    .orderBy("__name__")
    .limit(PAGE_SIZE);

  if (cursorDoc){
    q = q.startAfter(cursorDoc);
  }

  const snap = await q.get();

  const rows = [];
  snap.forEach(docSnap => {
    const d = docSnap.data() || {};
    const st = normalizeStatus(d.status);

    if (st && st !== "active") return;

    rows.push({
      id: docSnap.id,
      data: d,
      location: extractLocation(d)
    });
  });

  const docs = snap.docs || [];
  const lastDoc = docs.length ? docs[docs.length - 1] : null;

  return {
    rows,
    lastDoc,
    empty: snap.empty,
    docsRead: docs.length
  };
}

async function loadSupportDocsForField(fieldId){
  const db = getFirestore();

  const [wxSnap, mrmsSnap, stateSnap] = await Promise.all([
    db.collection(WEATHER_CACHE_COLLECTION).doc(fieldId).get(),
    db.collection(MRMS_COLLECTION).doc(fieldId).get(),
    db.collection(PERSISTED_STATE_COLLECTION).doc(fieldId).get()
  ]);

  const wxDoc = wxSnap.exists ? (wxSnap.data() || {}) : null;
  const mrmsDoc = mrmsSnap.exists ? (mrmsSnap.data() || {}) : null;

  let persistedState = null;
  if (stateSnap.exists){
    const d = stateSnap.data() || {};
    const storageFinal = safeNum(d.storageFinal);
    const asOfDateISO = safeISO10(d.asOfDateISO);

    if (storageFinal != null && asOfDateISO){
      persistedState = {
        fieldId: safeStr(d.fieldId || fieldId),
        storageFinal,
        asOfDateISO,
        SmaxAtSave: safeNum(d.SmaxAtSave) ?? safeNum(d.smaxAtSave) ?? 0
      };
    }
  }

  return {
    wxDoc,
    mrmsDoc,
    persistedState
  };
}

/* =====================================================================
   MRMS overlay
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

  let cursor = new Date(start);

  while (cursor <= end){
    const key = toYMDLocal(cursor);
    if (!map.has(key)) return false;
    cursor = addDaysLocal(cursor, 1);
  }

  if (meta && meta.fullBackfillComplete === true){
    return true;
  }

  return true;
}

function buildMrmsDailyMapRows(mrmsDoc){
  const map = new Map();
  const rows = Array.isArray(mrmsDoc && mrmsDoc.mrmsDailySeries30d)
    ? mrmsDoc.mrmsDailySeries30d
    : [];

  for (const r of rows){
    const iso = String(r && r.dateISO || "").slice(0, 10);
    if (!iso) continue;

    map.set(iso, {
      dateISO: iso,
      rainMm: num(r && r.rainMm, 0),
      rainIn: mmToIn(r && r.rainMm),
      hoursCount: Math.round(num(r && r.hoursCount, 0))
    });
  }

  return map;
}

function withRainSource(rows, source){
  return (Array.isArray(rows) ? rows : []).map(r => ({
    ...r,
    rainInAdj: num(r && r.rainInAdj, num(r && r.rainIn, 0)),
    rainSource: String(source || "open-meteo")
  }));
}

function overlayMrmsRainOntoWeatherRows(baseRows, mrmsDoc){
  const rows = Array.isArray(baseRows) ? baseRows.slice() : [];
  if (!rows.length) return [];

  const mrmsMap = buildMrmsDailyMapRows(mrmsDoc);
  if (!mrmsMap.size) return withRainSource(rows, "open-meteo");

  return rows.map(r => {
    const iso = String(r && r.dateISO || "").slice(0, 10);
    const m = mrmsMap.get(iso);

    if (!m){
      return {
        ...r,
        rainInAdj: num(r && r.rainInAdj, num(r && r.rainIn, 0)),
        rainSource: String(r && (r.rainSource || r.precipSource) || "open-meteo")
      };
    }

    return {
      ...r,
      rainMrmsMm: round(m.rainMm, 3),
      rainMrmsIn: round(m.rainIn, 3),
      rainInAdj: round(m.rainIn, 3),
      rainSource: "mrms",
      mrmsHoursCount: m.hoursCount
    };
  });
}

function getRecentMrmsDailyRows(mrmsDoc, days = HISTORY_DAYS_REQUIRED){
  const rows = Array.isArray(mrmsDoc && mrmsDoc.mrmsDailySeries30d)
    ? mrmsDoc.mrmsDailySeries30d.slice()
    : [];

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
  const ready = weatherReady && mrmsStats.isReady;

  let reason = null;

  if (!weatherReady){
    const count = Array.isArray(wxDoc && wxDoc.dailySeries) ? wxDoc.dailySeries.length : 0;
    reason = `Processing history: weather days ${count}/${days}.`;
  } else if (!mrmsStats.isReady){
    reason = `Processing history: MRMS coverage ${mrmsStats.coveragePct}% (${mrmsStats.actualHours}/${mrmsStats.expectedHours} hours).`;
  }

  return {
    ready,
    weatherReady,
    mrmsStats,
    reason
  };
}

function buildModelWeatherRowsForServer(wxDoc, mrmsDoc){
  const baseRows = Array.isArray(wxDoc && wxDoc.dailySeries)
    ? wxDoc.dailySeries.slice()
    : [];

  if (!baseRows.length) return [];

  const coverageReady = getMrmsCoverageStats(mrmsDoc).isReady;
  const recentReady = mrmsBackfillReadyServer(mrmsDoc);

  if (!(coverageReady || recentReady)){
    return withRainSource(baseRows, "open-meteo");
  }

  return overlayMrmsRainOntoWeatherRows(baseRows, mrmsDoc);
}

/* =====================================================================
   Plain Firestore-safe rows
===================================================================== */
function toPlainModelRows(rows){
  return (Array.isArray(rows) ? rows : []).map(r => ({
    dateISO: safeISO10(r && r.dateISO),
    rainInAdj: round(num(r && r.rainInAdj, num(r && r.rainIn, 0)), 3),
    rainMrmsIn: round(num(r && r.rainMrmsIn, 0), 3),
    rainMrmsMm: round(num(r && r.rainMrmsMm, 0), 3),
    rainSource: safeStr(r && (r.rainSource || r.precipSource) || "open-meteo") || "open-meteo",
    tempF: safeNum(r && r.tempF),
    windMph: safeNum(r && r.windMph),
    rh: safeNum(r && r.rh),
    solarWm2: safeNum(r && r.solarWm2),
    et0In: round(num(r && r.et0In, 0), 3),
    sm010: safeNum(r && r.sm010),
    st010F: safeNum(r && r.st010F),
    vpdKpa: safeNum(r && r.vpdKpa),
    cloudPct: safeNum(r && r.cloudPct),
    dryPwr: safeNum(r && r.dryPwr),
    tempN: safeNum(r && r.tempN),
    windN: safeNum(r && r.windN),
    rhN: safeNum(r && r.rhN),
    solarN: safeNum(r && r.solarN),
    vpdN: safeNum(r && r.vpdN),
    cloudN: safeNum(r && r.cloudN)
  }));
}

function toPlainTankTrace(trace){
  return (Array.isArray(trace) ? trace : []).map(t => ({
    dateISO: safeISO10(t && t.dateISO),
    rainIn: round(num(t && t.rainIn, num(t && t.rain, 0)), 3),
    infilMult: round(num(t && t.infilMult, 0), 3),
    addIn: round(num(t && t.addIn, num(t && t.add, 0)), 3),
    dryPwr: round(num(t && t.dryPwr, 0), 3),
    lossIn: round(num(t && t.lossIn, num(t && t.loss, 0)), 3),
    storageStart: round(num(t && t.storageStart, num(t && t.before, 0)), 4),
    storageEnd: round(num(t && t.storageEnd, num(t && t.after, 0)), 4),
    storageCap: round(num(t && t.storageCap, 0), 4)
  }));
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
   Placeholder storage-cap helper
===================================================================== */
function buildStorageCapOnlySnapshot(soilWetness, drainageIndex){
  const snapshot = runReadinessFromPersistedStateOnly(
    soilWetness,
    drainageIndex,
    { storageFinal: 0, asOfDateISO: "2000-01-01", SmaxAtSave: null },
    { extra: EXTRA }
  );

  if (!snapshot) return null;

  return {
    storageMax: safeNum(snapshot.storageMax),
    storageCapacity: safeNum(snapshot.storageCapacity),
    storageMaxFinal: safeNum(snapshot.storageMaxFinal)
  };
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
    computedAt: fv().serverTimestamp()
  };
}

/* =====================================================================
   Per-field writer
===================================================================== */
function buildFieldWritePayload({
  fieldId,
  fieldRow,
  wxRaw,
  mrmsRaw,
  persistedState,
  runKey,
  timezone
}){
  const DEFAULT_SOIL = 60;
  const DEFAULT_DRAIN = 45;

  const fd = fieldRow ? (fieldRow.data || {}) : {};
  const currentLocation = fieldRow?.location || null;

  const extractedParams = extractFieldParamsLikeFrontend(fd);

  const soilWetness = Number.isFinite(Number(extractedParams.soilWetness))
    ? Number(extractedParams.soilWetness)
    : DEFAULT_SOIL;

  const drainageIndex = Number.isFinite(Number(extractedParams.drainageIndex))
    ? Number(extractedParams.drainageIndex)
    : DEFAULT_DRAIN;

  const wxLocationChanged = hasLocationChanged(wxRaw && wxRaw.location, currentLocation);
  const mrmsLocationChanged = hasLocationChanged(mrmsRaw && mrmsRaw.location, currentLocation);
  const locationChanged = !!(wxLocationChanged || mrmsLocationChanged);

  const wx = locationChanged ? null : wxRaw;
  const mrmsDoc = locationChanged ? null : mrmsRaw;

  const baseDoc = buildBaseLatestDoc({
    fieldId,
    fieldData: fd,
    fieldLocation: currentLocation,
    wxDoc: wx,
    runKey,
    timezone
  });

  const weatherRows = buildModelWeatherRowsForServer(wx, mrmsDoc);
  const historyReadiness = buildHistoryReadiness(wx, mrmsDoc, HISTORY_DAYS_REQUIRED);

  if (weatherRows.length){
    const summarySnapshot = runFieldReadinessCore(
      weatherRows,
      soilWetness,
      drainageIndex,
      null,
      {
        extra: EXTRA,
        tune: FV_TUNE,
        lossScale: LOSS_SCALE,
        includeTrace: true
      }
    );

    if (!summarySnapshot){
      return {
        ok: false,
        skipWrite: true,
        failReason: "runFieldReadinessCore returned empty summarySnapshot"
      };
    }

    let historySnapshot = null;

    if (historyReadiness.ready){
      historySnapshot = runFieldReadinessCore(
        weatherRows,
        soilWetness,
        drainageIndex,
        null,
        {
          extra: EXTRA,
          tune: FV_TUNE,
          lossScale: LOSS_SCALE,
          includeTrace: true,
          forceFullHistoryFromPersisted: true
        }
      );
    }

    const sourceRows = Array.isArray(historySnapshot && historySnapshot.rows) && historySnapshot.rows.length
      ? historySnapshot.rows
      : (Array.isArray(summarySnapshot.rows) && summarySnapshot.rows.length ? summarySnapshot.rows : weatherRows);

    const modelRows = toPlainModelRows(sourceRows).slice(-HISTORY_DAYS_REQUIRED);

    const tankTrace = historyReadiness.ready
      ? toPlainTankTrace(historySnapshot && historySnapshot.trace).slice(-HISTORY_DAYS_REQUIRED)
      : [];

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

    return {
      ok: true,
      type: "weatherRows",
      locationChanged,
      processingHistory: !historyReadiness.ready,
      payload: {
        ...baseDoc,

        dailySeries30d,
        dailySeriesFcst,
        dailySeriesMeta: {
          histDays: dailySeries30d.length,
          fcstDays: dailySeriesFcst.length,
          todayISO: safeISO10((dailySeries30d[dailySeries30d.length - 1] || {}).dateISO) || null
        },

        modelRows,
        tankTrace,

        historyReady: historyReadiness.ready,
        historyCoverageMeta: historyReadiness.mrmsStats,
        locationChanged,

        mrmsDailySeries30d,
        mrmsHourlyLast24,
        mrmsHourlyLatest,
        mrmsHistoryMeta: mrmsDoc && mrmsDoc.mrmsHistoryMeta ? mrmsDoc.mrmsHistoryMeta : null,
        mrmsLastUpdatedAt: mrmsDoc && mrmsDoc.mrmsLastUpdatedAt ? mrmsDoc.mrmsLastUpdatedAt : null,

        debug: {
          summary: summarySnapshot.debug || null,
          history: historySnapshot && historySnapshot.debug ? historySnapshot.debug : null,
          locationChanged,
          wxLocationChanged,
          mrmsLocationChanged
        },

        status: historyReadiness.ready ? "ready" : "processing_history",
        reason: historyReadiness.ready
          ? fv().delete()
          : (historyReadiness.reason || "Processing history.")

        // IMPORTANT:
        // readiness / wetness / storage* / seed* / sourceMode / startIdx
        // are intentionally NOT written here, so existing readiness score
        // is preserved and not recalculated/overwritten.
      }
    };
  }

  const capOnly = buildStorageCapOnlySnapshot(soilWetness, drainageIndex);

  if (locationChanged){
    return {
      ok: true,
      type: "locationChangedNoWeather",
      locationChanged: true,
      skippedNoWeather: true,
      placeholderOnly: true,
      payload: {
        ...baseDoc,

        storageMax: safeNum(capOnly && capOnly.storageMax),
        storageCapacity: safeNum(capOnly && capOnly.storageCapacity),
        storageMaxFinal: safeNum(capOnly && capOnly.storageMaxFinal),

        soilWetness,
        drainageIndex,
        historyReady: false,
        locationChanged: true,
        status: "waiting_for_weather_cache",
        reason: "Field lat/lng changed. Waiting for fresh weather and MRMS cache for the new location."

        // readiness fields intentionally not written
      }
    };
  }

  if (persistedState && Number.isFinite(Number(persistedState.storageFinal))){
    return {
      ok: true,
      type: "provisionalFromPersisted",
      provisionalFromPersisted: true,
      payload: {
        ...baseDoc,

        storageMax: safeNum(capOnly && capOnly.storageMax),
        storageCapacity: safeNum(capOnly && capOnly.storageCapacity),
        storageMaxFinal: safeNum(capOnly && capOnly.storageMaxFinal),

        soilWetness,
        drainageIndex,
        status: "provisional_no_weather_cache",
        reason: "Missing field_weather_cache; preserving existing readiness while waiting on weather cache."

        // readiness fields intentionally not written
      }
    };
  }

  return {
    ok: true,
    type: "placeholderOnly",
    skippedNoWeather: true,
    placeholderOnly: true,
    payload: {
      ...baseDoc,

      storageMax: safeNum(capOnly && capOnly.storageMax),
      storageCapacity: safeNum(capOnly && capOnly.storageCapacity),
      storageMaxFinal: safeNum(capOnly && capOnly.storageMaxFinal),

      soilWetness,
      drainageIndex,
      status: "waiting_for_weather_cache",
      reason: "Field exists, but no field_weather_cache and no persisted truth are available yet."

      // readiness fields intentionally not written
    }
  };
}

/* =====================================================================
   Main writer - paged / memory safe
===================================================================== */
async function writeReadinessLatest(runKey, timezone){
  const db = getFirestore();

  let batch = db.batch();
  let batchWrites = 0;

  let ok = 0;
  let fail = 0;
  let skippedNoWeather = 0;
  let placeholderOnly = 0;
  let provisionalFromPersisted = 0;
  let processingHistory = 0;
  let totalFields = 0;
  let docsRead = 0;
  let pagesRead = 0;
  let latLngChangedFields = 0;
  let weatherDocs = 0;

  let cursorDoc = null;

  async function commitIfNeeded(force = false){
    if (batchWrites <= 0) return;
    if (!force && batchWrites < BATCH_COMMIT_SIZE) return;

    await batch.commit();
    batch = db.batch();
    batchWrites = 0;
  }

  while (true){
    const page = await getFieldPage(cursorDoc);

    pagesRead++;
    docsRead += page.docsRead;

    if (page.empty){
      break;
    }

    cursorDoc = page.lastDoc;

    for (const fieldRow of page.rows){
      totalFields++;

      const fieldId = fieldRow.id;

      try{
        const support = await loadSupportDocsForField(fieldId);
        if (support.wxDoc) weatherDocs++;

        const built = buildFieldWritePayload({
          fieldId,
          fieldRow,
          wxRaw: support.wxDoc,
          mrmsRaw: support.mrmsDoc,
          persistedState: support.persistedState,
          runKey,
          timezone
        });

        if (!built || built.ok !== true){
          fail++;
          console.warn("[Readiness] field skipped/fail:", fieldId, built && built.failReason ? built.failReason : "unknown");
          continue;
        }

        if (built.skipWrite){
          fail++;
          continue;
        }

        const outRef = db.collection(READINESS_LATEST_COLLECTION).doc(fieldId);
        batch.set(outRef, built.payload, { merge: true });
        batchWrites++;

        ok++;

        if (built.locationChanged) latLngChangedFields++;
        if (built.processingHistory) processingHistory++;
        if (built.skippedNoWeather) skippedNoWeather++;
        if (built.placeholderOnly) placeholderOnly++;
        if (built.provisionalFromPersisted) provisionalFromPersisted++;

        await commitIfNeeded(false);
      }catch(e){
        fail++;
        console.warn("[Readiness] field failed:", fieldId, e?.message || e);
      }
    }

    await commitIfNeeded(true);

    if (!cursorDoc || page.docsRead < PAGE_SIZE){
      break;
    }

    await new Promise(r => setTimeout(r, 25));
  }

  await commitIfNeeded(true);

  return {
    ok,
    fail,
    skippedNoWeather,
    placeholderOnly,
    provisionalFromPersisted,
    processingHistory,
    latLngChangedFields,
    totalFields,
    weatherDocs,
    docsRead,
    pagesRead,
    pageSize: PAGE_SIZE,
    batchCommitSize: BATCH_COMMIT_SIZE
  };
}

/* =====================================================================
   Routes
===================================================================== */
app.get("/", async (req, res) => {
  cors(req, res);

  if (isSchedulerRequest(req)){
    let lock = null;
    let runKey = null;
    let timezone = null;

    try{
      timezone = String(req.query.timezone || "America/Chicago");
      runKey = String(req.query.runKey || "").trim() || makeRunKey(timezone);

      lock = await ensureRunLockOrSkip(runKey, timezone);

      let readiness = null;

      if (lock.shouldRun){
        readiness = await writeReadinessLatest(runKey, timezone);

        await lock.runRef.set({
          status: "done",
          finishedAt: fv().serverTimestamp(),
          fieldsOk: readiness.ok,
          fieldsFail: readiness.fail,
          skippedNoWeather: readiness.skippedNoWeather,
          placeholderOnly: readiness.placeholderOnly,
          provisionalFromPersisted: readiness.provisionalFromPersisted,
          processingHistory: readiness.processingHistory,
          latLngChangedFields: readiness.latLngChangedFields,
          totalFields: readiness.totalFields,
          weatherDocs: readiness.weatherDocs,
          docsRead: readiness.docsRead,
          pagesRead: readiness.pagesRead,
          pageSize: readiness.pageSize,
          batchCommitSize: readiness.batchCommitSize
        }, { merge: true });
      } else {
        readiness = {
          skipped: true,
          reason: "runKey already processed or running",
          runKey
        };
      }

      return res.status(200).json({
        ok: true,
        mode: "readiness_display_refresh_only",
        rev: "2026-04-29a-scheduler-safe-paged-display-refresh",
        ranAt: new Date().toISOString(),
        runKey,
        readiness
      });
    }catch(e){
      console.error("[Readiness] run failed:", e);

      try{
        if (lock && lock.runRef){
          await lock.runRef.set({
            status: "failed",
            failedAt: fv().serverTimestamp(),
            error: e?.message || "Readiness rebuild failed",
            code: e?.code || null
          }, { merge: true });
        }
      }catch(markErr){
        console.warn("[Readiness] failed to mark run failed:", markErr?.message || markErr);
      }

      return res.status(500).json({
        ok: false,
        mode: "readiness_display_refresh_only",
        rev: "2026-04-29a-scheduler-safe-paged-display-refresh",
        runKey,
        error: e?.message || "Readiness rebuild failed",
        code: e?.code || null,
        hint: (e?.code === "MISSING_FIREBASE_ADMIN")
          ? "Add firebase-admin to package.json dependencies and redeploy."
          : null
      });
    }
  }

  return res.status(200).send(
    "FarmVista Readiness Display Refresher OK. Use /?run=1 to refresh weather/display fields in field_readiness_latest without overwriting readiness score."
  );
});

app.get("/healthz", (req, res) => {
  cors(req, res);
  res.status(200).send("ok");
});

app.listen(PORT, () => {
  console.log(`farmvista-readiness-rebuilder listening on ${PORT}`);
});
