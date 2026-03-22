// /js/field-readiness/shared/index.js  (FULL FILE)
// FarmVista Readiness Rebuilder (Cloud Run)
// Rev: 2026-03-22e-full-file-stable-history-hourly-seed
//
// PURPOSE:
// ✅ DOES NOT fetch Open-Meteo
// ✅ DOES NOT write field_weather_cache
// ✅ ONLY rebuilds field_readiness_latest
// ✅ Uses existing field_weather_cache as primary input
// ✅ Uses MRMS overlay when ready
// ✅ Uses persisted truth from field_readiness_state
// ✅ Uses same field param paths as frontend
// ✅ Uses shared readiness core from readiness-core-shared.cjs
// ✅ FIX: iterates ALL active fields, not only weather-cache docs
// ✅ FIX: new fields with lat/lng now get written into field_readiness_latest
// ✅ FIX: if weather cache is missing but persisted truth exists, writes provisional readiness
// ✅ FIX: if both are missing, writes placeholder row so field is not invisible
// ✅ NEW: saves tank size fields into field_readiness_latest:
//    - storageMax
//    - storageCapacity
//    - storageMaxFinal
// ✅ NEW: placeholder/new fields ALSO get storageMax immediately from slider math
// ✅ FIX: when a field is updated, rebuild uses current fields/{fieldId} slider values
// ✅ FIX: clears stale placeholder "reason" when field becomes ready/provisional
// ✅ NEW: persists 30-day display history into field_readiness_latest
// ✅ NEW: writes modelRows + tankTrace + wx daily/forecast + MRMS daily to latest doc
// ✅ NEW: writes MRMS hourly last 24 + latest hourly summary to latest doc
// ✅ FIX: seed history rebuild from persisted state so tank trace is not all zeroes
// ✅ FIX: chunk processing + smaller batch commits to avoid heap/memory crashes
//
const express = require("express");
const {
  runFieldReadinessCore,
  runReadinessFromPersistedStateOnly
} = require("./readiness-core-shared.cjs");

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
const PERSISTED_STATE_COLLECTION = process.env.FV_PERSISTED_STATE_COLLECTION || "field_readiness_state";
const MRMS_COLLECTION = process.env.FV_MRMS_COLLECTION || "field_mrms_weather";
const WEATHER_CACHE_COLLECTION = process.env.FV_WEATHER_CACHE_COLLECTION || "field_weather_cache";

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

async function loadActiveFieldsMap(){
  const db = getFirestore();
  const out = new Map();
  let raw = [];

  try{
    const snap = await db.collection("fields").where("status", "==", "active").get();
    snap.forEach(doc => raw.push({ id: doc.id, data: doc.data() || {} }));
  }catch(e){
    console.warn("[Readiness] fields query(status==active) failed:", e?.message || e);
  }

  if (!raw.length){
    try{
      const snap2 = await db.collection("fields").get();
      snap2.forEach(doc => raw.push({ id: doc.id, data: doc.data() || {} }));
    }catch(e){
      console.warn("[Readiness] fields query(all) failed:", e?.message || e);
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
   Persisted truth
===================================================================== */
async function loadPersistedStateMap(){
  const db = getFirestore();
  const out = new Map();

  try{
    const snap = await db.collection(PERSISTED_STATE_COLLECTION).get();
    snap.forEach(docSnap => {
      const d = docSnap.data() || {};
      const fid = safeStr(d.fieldId || docSnap.id);
      if (!fid) return;

      const storageFinal = safeNum(d.storageFinal);
      const asOfDateISO = safeISO10(d.asOfDateISO);
      if (storageFinal == null || !asOfDateISO) return;

      out.set(fid, {
        fieldId: fid,
        storageFinal,
        asOfDateISO,
        SmaxAtSave: safeNum(d.SmaxAtSave) ?? safeNum(d.smaxAtSave) ?? 0
      });
    });
  }catch(e){
    console.warn("[Readiness] loadPersistedStateMap failed:", e?.message || e);
  }

  return out;
}

/* =====================================================================
   Weather cache
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
    console.warn("[Readiness] loadWeatherCacheMap failed:", e?.message || e);
  }

  return out;
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

function buildMrmsDailyMapRows(mrmsDoc){
  const map = new Map();
  const rows = Array.isArray(mrmsDoc && mrmsDoc.mrmsDailySeries30d) ? mrmsDoc.mrmsDailySeries30d : [];
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

async function loadMrmsDocMap(){
  const db = getFirestore();
  const out = new Map();

  try{
    const snap = await db.collection(MRMS_COLLECTION).get();
    snap.forEach(docSnap => {
      out.set(String(docSnap.id), docSnap.data() || {});
    });
  }catch(e){
    console.warn("[Readiness] loadMrmsDocMap failed:", e?.message || e);
  }

  return out;
}

function buildModelWeatherRowsForServer(wxDoc, mrmsDoc){
  const baseRows = Array.isArray(wxDoc && wxDoc.dailySeries) ? wxDoc.dailySeries.slice() : [];
  if (!baseRows.length) return [];

  const mrmsReady = mrmsBackfillReadyServer(mrmsDoc);
  if (!mrmsReady){
    return withRainSource(baseRows, "open-meteo");
  }

  return overlayMrmsRainOntoWeatherRows(baseRows, mrmsDoc);
}

function choosePersistedStateForHistoryRun(persistedState, weatherRows){
  if (!persistedState || typeof persistedState !== "object") return null;
  const rows = Array.isArray(weatherRows) ? weatherRows : [];
  if (!rows.length) return persistedState;

  const lastISO = safeISO10(rows[rows.length - 1] && rows[rows.length - 1].dateISO);
  const persistedISO = safeISO10(persistedState.asOfDateISO);

  if (!persistedISO) return null;
  if (!lastISO) return persistedState;

  if (persistedISO >= lastISO){
    return null;
  }

  return persistedState;
}

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
    rainIn: round(num(t && t.rainIn, 0), 3),
    infilMult: round(num(t && t.infilMult, 0), 3),
    addIn: round(num(t && t.addIn, 0), 3),
    dryPwr: round(num(t && t.dryPwr, 0), 3),
    lossIn: round(num(t && t.lossIn, 0), 3),
    storageStart: round(num(t && t.storageStart, 0), 4),
    storageEnd: round(num(t && t.storageEnd, 0), 4),
    storageCap: round(num(t && t.storageCap, 0), 4)
  }));
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
    computedAt: _admin.firestore.FieldValue.serverTimestamp()
  };
}

/* =====================================================================
   Main writer
===================================================================== */
async function writeReadinessLatest(runKey, timezone){
  const db = getFirestore();

  const DEFAULT_SOIL = 60;
  const DEFAULT_DRAIN = 45;

  const [fieldsMap, persistedMap, mrmsMap, wxMap] = await Promise.all([
    loadActiveFieldsMap(),
    loadPersistedStateMap(),
    loadMrmsDocMap(),
    loadWeatherCacheMap()
  ]);

  let batch = db.batch();
  let writes = 0;
  let ok = 0;
  let fail = 0;
  let skippedNoWeather = 0;
  let placeholderOnly = 0;
  let provisionalFromPersisted = 0;
  let totalFields = 0;

  const fieldEntries = Array.from(fieldsMap.entries());
  const CHUNK_SIZE = 10;

  for (let i = 0; i < fieldEntries.length; i += CHUNK_SIZE){
    const chunk = fieldEntries.slice(i, i + CHUNK_SIZE);

    for (const [fieldId, fieldRow] of chunk){
      totalFields++;

      const fd = fieldRow ? (fieldRow.data || {}) : {};
      const wx = wxMap.get(fieldId) || null;
      const persistedState = persistedMap.get(fieldId) || null;

      try{
        const extractedParams = extractFieldParamsLikeFrontend(fd);

        const soilWetness = Number.isFinite(Number(extractedParams.soilWetness))
          ? Number(extractedParams.soilWetness)
          : DEFAULT_SOIL;

        const drainageIndex = Number.isFinite(Number(extractedParams.drainageIndex))
          ? Number(extractedParams.drainageIndex)
          : DEFAULT_DRAIN;

        const outRef = db.collection(READINESS_LATEST_COLLECTION).doc(fieldId);
        const baseDoc = buildBaseLatestDoc({
          fieldId,
          fieldData: fd,
          fieldLocation: fieldRow?.location || null,
          wxDoc: wx,
          runKey,
          timezone
        });

        const mrmsDoc = mrmsMap.get(fieldId) || null;
        const weatherRows = buildModelWeatherRowsForServer(wx, mrmsDoc);

        // PRIMARY PATH: full weather-based readiness + persisted display history
        if (weatherRows.length){
          // IMPORTANT:
          // Use persistedState directly when available so the history trace seeds from
          // real saved storage instead of collapsing to baseline/zero on same-day runs.
          const historyPersistedState = (
            persistedState &&
            Number.isFinite(Number(persistedState.storageFinal)) &&
            safeISO10(persistedState.asOfDateISO)
          )
            ? persistedState
            : null;

          const snapshot = runFieldReadinessCore(
            weatherRows,
            soilWetness,
            drainageIndex,
            historyPersistedState,
            {
              extra: EXTRA,
              tune: FV_TUNE,
              lossScale: LOSS_SCALE,
              includeTrace: true
            }
          );

          if (!snapshot || !Number.isFinite(Number(snapshot.readinessR))){
            fail++;
            continue;
          }

          const modelRows = toPlainModelRows(
            Array.isArray(snapshot.rows) && snapshot.rows.length ? snapshot.rows : weatherRows
          ).slice(-30);

          const tankTrace = toPlainTankTrace(snapshot.trace).slice(-30);

          const dailySeries30d = Array.isArray(wx && wx.dailySeries)
            ? wx.dailySeries.slice(-30)
            : [];

          const dailySeriesFcst = Array.isArray(wx && wx.dailySeriesFcst)
            ? wx.dailySeriesFcst.slice(0, 7)
            : [];

          const mrmsDailySeries30d = Array.isArray(mrmsDoc && mrmsDoc.mrmsDailySeries30d)
            ? mrmsDoc.mrmsDailySeries30d.slice(-30)
            : [];

          const mrmsHourlyLast24 = Array.isArray(mrmsDoc && mrmsDoc.mrmsHourlyLast24)
            ? mrmsDoc.mrmsHourlyLast24.slice(-24)
            : [];

          const mrmsHourlyLatest = mrmsDoc && mrmsDoc.mrmsHourlyLatest
            ? mrmsDoc.mrmsHourlyLatest
            : null;

          batch.set(outRef, {
            ...baseDoc,
            asOfDateISO: safeISO10(snapshot.asOfDateISO) || safeISO10((modelRows[modelRows.length - 1] || {}).dateISO) || null,
            readiness: Number(snapshot.readinessR),
            wetness: Number(snapshot.wetnessR),
            storageFinal: Number(snapshot.storageFinal),
            storagePhysFinal: Number(snapshot.storagePhysFinal),
            readinessCreditIn: Number(snapshot.readinessCreditIn || 0),
            storageForReadiness: Number(snapshot.storageForReadiness || 0),

            storageMax: Number(snapshot.storageMax || 0),
            storageCapacity: Number(snapshot.storageCapacity || 0),
            storageMaxFinal: Number(snapshot.storageMaxFinal || 0),

            soilWetness,
            drainageIndex,
            seedSource: snapshot.seedSource || null,
            seedStorage: safeNum(snapshot.seedStorage),
            sourceMode: snapshot.sourceMode || null,
            startIdx: safeNum(snapshot.startIdx),

            modelRows,
            tankTrace,
            dailySeries30d,
            dailySeriesFcst,
            dailySeriesMeta: {
              histDays: dailySeries30d.length,
              fcstDays: dailySeriesFcst.length,
              todayISO: safeISO10((dailySeries30d[dailySeries30d.length - 1] || {}).dateISO) || null
            },

            mrmsDailySeries30d,
            mrmsHourlyLast24,
            mrmsHourlyLatest,
            mrmsHistoryMeta: mrmsDoc && mrmsDoc.mrmsHistoryMeta ? mrmsDoc.mrmsHistoryMeta : null,
            mrmsLastUpdatedAt: mrmsDoc && mrmsDoc.mrmsLastUpdatedAt ? mrmsDoc.mrmsLastUpdatedAt : null,

            debug: snapshot.debug || null,
            status: "ready",
            reason: _admin.firestore.FieldValue.delete()
          }, { merge: true });

          writes++;
          ok++;
        }
        // SECONDARY PATH: no weather cache, but persisted truth exists
        else if (persistedState && Number.isFinite(Number(persistedState.storageFinal))){
          const snapshot = runReadinessFromPersistedStateOnly(
            soilWetness,
            drainageIndex,
            persistedState,
            { extra: EXTRA }
          );

          if (!snapshot || !Number.isFinite(Number(snapshot.readinessR))){
            fail++;
            continue;
          }

          batch.set(outRef, {
            ...baseDoc,
            readiness: Number(snapshot.readinessR),
            wetness: Number(snapshot.wetnessR),
            storageFinal: Number(snapshot.storageFinal),
            storagePhysFinal: Number(snapshot.storagePhysFinal),
            readinessCreditIn: Number(snapshot.readinessCreditIn || 0),
            storageForReadiness: Number(snapshot.storageForReadiness || 0),

            storageMax: Number(snapshot.storageMax || 0),
            storageCapacity: Number(snapshot.storageCapacity || 0),
            storageMaxFinal: Number(snapshot.storageMaxFinal || 0),

            soilWetness,
            drainageIndex,
            seedSource: "persisted-state-only",
            status: "provisional_no_weather_cache",
            reason: "Missing field_weather_cache; using persisted truth only."
          }, { merge: true });

          writes++;
          ok++;
          provisionalFromPersisted++;
        }
        // LAST PATH: create placeholder doc so new field is visible in collection
        else {
          const capOnly = buildStorageCapOnlySnapshot(soilWetness, drainageIndex);

          batch.set(outRef, {
            ...baseDoc,
            readiness: null,
            wetness: null,
            storageFinal: null,
            storagePhysFinal: null,
            readinessCreditIn: null,
            storageForReadiness: null,

            storageMax: safeNum(capOnly && capOnly.storageMax),
            storageCapacity: safeNum(capOnly && capOnly.storageCapacity),
            storageMaxFinal: safeNum(capOnly && capOnly.storageMaxFinal),

            soilWetness,
            drainageIndex,
            seedSource: null,
            status: "waiting_for_weather_cache",
            reason: "Field exists, but no field_weather_cache and no persisted truth are available yet."
          }, { merge: true });

          writes++;
          skippedNoWeather++;
          placeholderOnly++;
        }

        if (writes >= 50){
          await batch.commit();
          batch = db.batch();
          writes = 0;
        }
      }catch(e){
        fail++;
        console.warn("[Readiness] field failed:", fieldId, e?.message || e);
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
    skippedNoWeather,
    placeholderOnly,
    provisionalFromPersisted,
    totalFields,
    weatherDocs: wxMap.size
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

      let readiness = null;
      if (lock.shouldRun){
        readiness = await writeReadinessLatest(runKey, timezone);
        await lock.runRef.set({
          status: "done",
          finishedAt: _admin.firestore.FieldValue.serverTimestamp(),
          fieldsOk: readiness.ok,
          fieldsFail: readiness.fail,
          skippedNoWeather: readiness.skippedNoWeather,
          placeholderOnly: readiness.placeholderOnly,
          provisionalFromPersisted: readiness.provisionalFromPersisted,
          totalFields: readiness.totalFields,
          weatherDocs: readiness.weatherDocs
        }, { merge: true });
      } else {
        readiness = { skipped: true, reason: "runKey already processed", runKey };
      }

      return res.status(200).json({
        ok: true,
        mode: "readiness_only_rebuild",
        ranAt: new Date().toISOString(),
        runKey,
        readiness
      });
    }catch(e){
      console.error("[Readiness] run failed:", e);
      return res.status(500).json({
        ok: false,
        error: e?.message || "Readiness rebuild failed",
        code: e?.code || null,
        hint: (e?.code === "MISSING_FIREBASE_ADMIN")
          ? "Add firebase-admin to package.json dependencies and redeploy."
          : null
      });
    }
  }

  return res.status(200).send(
    "FarmVista Readiness Rebuilder OK. Use /?run=1 to rebuild field_readiness_latest from existing caches."
  );
});

app.get("/healthz", (req, res) => {
  cors(req, res);
  res.status(200).send("ok");
});

app.listen(PORT, () => {
  console.log(`farmvista-readiness-rebuilder listening on ${PORT}`);
});
