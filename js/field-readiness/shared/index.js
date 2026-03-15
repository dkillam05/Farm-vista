// /index.js  (FULL FILE)
// FarmVista Field Weather proxy (Cloud Run)
// Rev: 2026-03-15f-real-shared-core-import-shared-path
//
// THIS REV:
// ✅ Keeps current batch weather cache flow
// ✅ Keeps current readiness snapshot flow
// ✅ Keeps today-hour cutoff when aggregating dailySeries
// ✅ Keeps same field param path support as frontend
// ✅ Keeps persisted truth seed from field_readiness_state
// ✅ Keeps MRMS 72h backfill-ready overlay logic
// ✅ Keeps robust field coordinate extraction for new fields
// ✅ Backend now imports shared readiness core module from:
//    ./js/field-readiness/shared/readiness-core-shared.cjs
//
const express = require("express");
const { runFieldReadinessCore } = require("./js/field-readiness/shared/readiness-core-shared.cjs");

const app = express();
app.disable("x-powered-by");

const PORT = process.env.PORT || 8080;
const OPEN_METEO_API_KEY = (process.env.OPEN_METEO_API_KEY || "").trim();

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
function clamp(n, lo, hi){
  n = Number(n);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
function isoDate(d){
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addDays(date, delta){
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + delta);
  return d;
}
function mergeArraysByTime(a, b){
  const out = [];
  const seen = new Set();

  for (const row of [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]) {
    const key = String(row?.time || row?.date || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }

  out.sort((x, y) => String(x.time || x.date || "").localeCompare(String(y.time || y.date || "")));
  return out;
}
function forecastBaseUrl(){
  return OPEN_METEO_API_KEY
    ? "https://customer-api.open-meteo.com/v1/forecast"
    : "https://api.open-meteo.com/v1/forecast";
}
function historicalBaseUrl(){
  return "https://archive-api.open-meteo.com/v1/archive";
}

// Open-Meteo wind_speed_10m is returned in km/h by default.
const KMH_TO_MPH = 0.621371;

function safeArr(v){
  return Array.isArray(v) ? v : [];
}
function safeLen(...arrs){
  let m = 0;
  for (const a of arrs) m = Math.max(m, Array.isArray(a) ? a.length : 0);
  return m;
}
function getAt(arr, i){
  if (!Array.isArray(arr)) return null;
  const v = arr[i];
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function getStrAt(arr, i){
  if (!Array.isArray(arr)) return null;
  const v = arr[i];
  return (typeof v === "string" && v) ? v : null;
}
function round(v, d=2){
  const p = Math.pow(10,d);
  return Math.round(Number(v) * p) / p;
}
function mmToIn(mm){ return (Number(mm || 0) / 25.4); }
function cToF2(c){ return (Number(c) * 9/5) + 32; }

function todayISOInTimeZone(timeZone){
  try{
    const dtf = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });
    return dtf.format(new Date());
  }catch(_){
    return isoDate(new Date());
  }
}

/* =========================================================================
   Match field-readiness.weather.js local-time parsing + today-hour cutoff
   ========================================================================= */
function timeToMsLocal(t){
  try{
    if (!t || typeof t !== "string") return NaN;
    const ms = Date.parse(t);
    return Number.isFinite(ms) ? ms : NaN;
  }catch(_){
    return NaN;
  }
}

function aggregateHourlyToDailySplit(hourlyCore, hourlyExt, dailyArr, timeZone, keepHistDays=30, keepFcstDays=7){
  const map = new Map();
  const tISO = todayISOInTimeZone(timeZone || "America/Chicago");
  const nowMs = Date.now();

  function ensure(dateISO){
    let row = map.get(dateISO);
    if (!row){
      row = {
        dateISO,
        rain_mm_sum:0,
        temp_c_sum:0, nt:0,
        wind_mph_sum:0, nw:0,
        rh_sum:0, nrh:0,
        solar_sum:0, ns:0,

        cloud_sum:0, ncloud:0,
        vpd_sum:0, nvpd:0,
        dew_sum:0, ndew:0,
        sm010_sum:0, nsm010:0,
        st010_sum:0, nst010:0,

        et0_mm:null,
        daylight_s:null,
        sunshine_s:null
      };
      map.set(dateISO, row);
    }
    return row;
  }

  function includeHour(timeStr){
    if (!timeStr || typeof timeStr !== "string" || timeStr.length < 10) return false;
    const dateISO = timeStr.slice(0,10);
    if (dateISO !== tISO) return true;

    const ms = timeToMsLocal(timeStr);
    if (!Number.isFinite(ms)) return true;
    return ms <= nowMs;
  }

  for (const h of (hourlyCore||[])){
    const t = String(h.time||"");
    if (t.length < 10) continue;
    if (!includeHour(t)) continue;

    const dateISO = t.slice(0,10);
    const row = ensure(dateISO);

    row.rain_mm_sum += Number(h.rain_mm||0);

    const tc = Number(h.temp_c);
    if (Number.isFinite(tc)){ row.temp_c_sum += tc; row.nt++; }

    const w = Number(h.wind_mph);
    if (Number.isFinite(w)){ row.wind_mph_sum += w; row.nw++; }

    const rh = Number(h.rh_pct);
    if (Number.isFinite(rh)){ row.rh_sum += rh; row.nrh++; }

    const s = Number(h.solar_wm2);
    if (Number.isFinite(s)){ row.solar_sum += s; row.ns++; }
  }

  for (const h of (hourlyExt||[])){
    const t = String(h.time||"");
    if (t.length < 10) continue;
    if (!includeHour(t)) continue;

    const dateISO = t.slice(0,10);
    const row = ensure(dateISO);

    const cloud = Number(h.cloud_cover_pct);
    if (Number.isFinite(cloud)){ row.cloud_sum += cloud; row.ncloud++; }

    const vpd = Number(h.vapour_pressure_deficit_kpa);
    if (Number.isFinite(vpd)){ row.vpd_sum += vpd; row.nvpd++; }

    const dew = Number(h.dew_point_c);
    if (Number.isFinite(dew)){ row.dew_sum += dew; row.ndew++; }

    const sm = Number(h.soil_moisture_0_10);
    if (Number.isFinite(sm)){ row.sm010_sum += sm; row.nsm010++; }

    const st = Number(h.soil_temp_c_0_10);
    if (Number.isFinite(st)){ row.st010_sum += st; row.nst010++; }
  }

  const dailyMap = new Map();
  for (const d of (dailyArr||[])){
    const iso = String(d.dateISO || d.time || d.date || "").slice(0,10);
    if (!iso) continue;
    dailyMap.set(iso, d);
  }

  const out = [...map.values()]
    .sort((a,b)=> a.dateISO.localeCompare(b.dateISO))
    .map(r=>{
      const rainIn = mmToIn(r.rain_mm_sum);
      const tempF = (r.nt ? cToF2(r.temp_c_sum / r.nt) : 0);
      const windMph = (r.nw ? (r.wind_mph_sum / r.nw) : 0);
      const rh = (r.nrh ? (r.rh_sum / r.nrh) : 0);
      const solarWm2 = (r.ns ? (r.solar_sum / r.ns) : 0);

      const cloudPct = (r.ncloud ? (r.cloud_sum / r.ncloud) : null);
      const vpdKpa = (r.nvpd ? (r.vpd_sum / r.nvpd) : null);
      const dewF = (r.ndew ? cToF2(r.dew_sum / r.ndew) : null);
      const sm010 = (r.nsm010 ? (r.sm010_sum / r.nsm010) : null);
      const st010F = (r.nst010 ? cToF2(r.st010_sum / r.nst010) : null);

      const d0 = dailyMap.get(r.dateISO) || {};
      const et0mm = (d0 && Number.isFinite(Number(d0.et0_mm))) ? Number(d0.et0_mm) : null;
      const et0In = (et0mm === null) ? null : mmToIn(et0mm);
      const daylightHr = (d0 && Number.isFinite(Number(d0.daylight_s))) ? (Number(d0.daylight_s)/3600) : null;
      const sunshineHr = (d0 && Number.isFinite(Number(d0.sunshine_s))) ? (Number(d0.sunshine_s)/3600) : null;

      return {
        dateISO: r.dateISO,
        rainIn: round(rainIn, 2),
        tempF: Math.round(tempF),
        windMph: Math.round(windMph),
        rh: Math.round(rh),
        solarWm2: Math.round(solarWm2),

        cloudPct: (cloudPct===null ? null : Math.round(cloudPct)),
        vpdKpa: (vpdKpa===null ? null : round(vpdKpa, 2)),
        dewF: (dewF===null ? null : Math.round(dewF)),
        sm010: (sm010===null ? null : round(sm010, 3)),
        st010F: (st010F===null ? null : Math.round(st010F)),

        et0In: (et0In===null ? null : round(et0In, 2)),
        daylightHr: (daylightHr===null ? null : round(daylightHr, 1)),
        sunshineHr: (sunshineHr===null ? null : round(sunshineHr, 1))
      };
    });

  const hist = out.filter(d=> d.dateISO && d.dateISO <= tISO).slice(-keepHistDays);
  const fcst = out.filter(d=> d.dateISO && d.dateISO > tISO).slice(0, keepFcstDays);

  return { hist, fcst, tISO };
}

// ---- Hourly normalizer ----
function normalizeHourlyCore(data){
  const h = (data && data.hourly) ? data.hourly : {};
  const time = safeArr(h.time);
  const p  = safeArr(h.precipitation);
  const t  = safeArr(h.temperature_2m);
  const w  = safeArr(h.wind_speed_10m);
  const rh = safeArr(h.relative_humidity_2m);
  const sw = safeArr(h.shortwave_radiation);

  const N = safeLen(time, p, t, w, rh, sw);

  const out = [];
  for (let i=0; i<N; i++){
    const rain_mm  = getAt(p, i) ?? 0;
    const temp_c   = getAt(t, i);
    const wind_kmh = getAt(w, i) ?? 0;
    const rh_pct   = getAt(rh, i);
    const solar_wm2= getAt(sw, i);

    out.push({
      time: getStrAt(time, i) || null,
      rain_mm,
      temp_c,
      wind_mph: Math.round((wind_kmh * KMH_TO_MPH) * 10) / 10,
      rh_pct,
      solar_wm2
    });
  }
  return out;
}

// ---- Hourly extended variables ----
function normalizeHourlyExt(data){
  const h = (data && data.hourly) ? data.hourly : {};
  const time = safeArr(h.time);

  const cloud = safeArr(h.cloud_cover);
  const dp    = safeArr(h.dew_point_2m);
  const vpd   = safeArr(h.vapour_pressure_deficit);

  const st_0_10   = safeArr(h.soil_temperature_0_to_10cm);
  const st_10_40  = safeArr(h.soil_temperature_10_to_40cm);
  const st_40_100 = safeArr(h.soil_temperature_40_to_100cm);
  const st_100_200= safeArr(h.soil_temperature_100_to_200cm);

  const sm_0_10   = safeArr(h.soil_moisture_0_to_10cm);
  const sm_10_40  = safeArr(h.soil_moisture_10_to_40cm);
  const sm_40_100 = safeArr(h.soil_moisture_40_to_100cm);
  const sm_100_200= safeArr(h.soil_moisture_100_to_200cm);

  const N = safeLen(
    time, cloud, dp, vpd,
    st_0_10, st_10_40, st_40_100, st_100_200,
    sm_0_10, sm_10_40, sm_40_100, sm_100_200
  );

  const out = [];
  for (let i=0; i<N; i++){
    out.push({
      time: getStrAt(time, i) || null,

      cloud_cover_pct: getAt(cloud, i),
      dew_point_c: getAt(dp, i),
      vapour_pressure_deficit_kpa: getAt(vpd, i),

      soil_temp_c_0_10: getAt(st_0_10, i),
      soil_temp_c_10_40: getAt(st_10_40, i),
      soil_temp_c_40_100: getAt(st_40_100, i),
      soil_temp_c_100_200: getAt(st_100_200, i),

      soil_moisture_0_10: getAt(sm_0_10, i),
      soil_moisture_10_40: getAt(sm_10_40, i),
      soil_moisture_40_100: getAt(sm_40_100, i),
      soil_moisture_100_200: getAt(sm_100_200, i)
    });
  }
  return out;
}

// ---- Daily normalizer ----
function normalizeDaily(data){
  const d = (data && data.daily) ? data.daily : {};
  const time = safeArr(d.time);

  const daylight = safeArr(d.daylight_duration);
  const sunshine = safeArr(d.sunshine_duration);
  const rad_sum  = safeArr(d.shortwave_radiation_sum);
  const et0      = safeArr(d.et0_fao_evapotranspiration);

  const tmax = safeArr(d.temperature_2m_max);
  const tmin = safeArr(d.temperature_2m_min);

  const N = safeLen(time, daylight, sunshine, rad_sum, et0, tmax, tmin);

  const out = [];
  for (let i=0; i<N; i++){
    out.push({
      date: getStrAt(time, i) || null,

      daylight_s: getAt(daylight, i),
      sunshine_s: getAt(sunshine, i),
      shortwave_radiation_sum: getAt(rad_sum, i),
      et0_mm: getAt(et0, i),

      temp_max_c: getAt(tmax, i),
      temp_min_c: getAt(tmin, i),

      gdu: null
    });
  }
  return out;
}

function cToF(c){
  const n = Number(c);
  if (!Number.isFinite(n)) return null;
  return (n * 9/5) + 32;
}

function computeDailyGDU(dailyArr, gduBaseF=50, gduCapF=86){
  for (const day of dailyArr){
    const maxF = cToF(day.temp_max_c);
    const minF = cToF(day.temp_min_c);
    if (!Number.isFinite(maxF) || !Number.isFinite(minF)){
      day.gdu = null;
      continue;
    }
    const maxFc = Math.min(maxF, gduCapF);
    const minFc = Math.min(minF, gduCapF);
    const avg = (maxFc + minFc) / 2;
    const gdu = avg - gduBaseF;
    day.gdu = Math.max(0, Math.round(gdu * 10) / 10);
  }
}

/* =====================================================================
   Firestore cache
===================================================================== */
const WEATHER_CACHE_COLLECTION = process.env.FV_WEATHER_CACHE_COLLECTION || "field_weather_cache";
const DEFAULT_PAST_DAYS = 30;
const DEFAULT_FORECAST_DAYS_PROXY = 3;
const DEFAULT_FORECAST_DAYS_BATCH = 7;
const DEFAULT_BATCH_CONCURRENCY = 6;

let _admin = null;
let _db = null;

function getFirestore(){
  if (_db) return _db;

  try{
    if (!_admin){
      _admin = require("firebase-admin");
    }
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

function isSchedulerRequest(req){
  const ua = String(req.headers["user-agent"] || "");
  if (ua.includes("Google-Cloud-Scheduler")) return true;
  const run = String(req.query.run || "");
  return run === "1" || run === "true";
}

function normalizeStatus(s){
  return String(s || "").trim().toLowerCase();
}

/* =====================================================================
   Robust field extraction so NEW fields are included
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

function isValidLatLng(lat, lng){
  return (
    lat != null &&
    lng != null &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(Number(lat)) <= 90 &&
    Math.abs(Number(lng)) <= 180
  );
}

function extractLocation(d){
  const lat = pickFirstNumber(d, [
    "location.lat",
    "location.latitude",
    "lat",
    "latitude",
    "gps.lat",
    "gps.latitude",
    "center.lat",
    "center.latitude",
    "fieldCenter.lat",
    "fieldCenter.latitude",
    "coordinates.lat",
    "coordinates.latitude",
    "centroid.lat",
    "centroid.latitude",
    "map.lat",
    "map.latitude"
  ]);

  const lng = pickFirstNumber(d, [
    "location.lng",
    "location.lon",
    "location.long",
    "location.longitude",
    "lng",
    "lon",
    "long",
    "longitude",
    "gps.lng",
    "gps.lon",
    "gps.long",
    "gps.longitude",
    "center.lng",
    "center.lon",
    "center.long",
    "center.longitude",
    "fieldCenter.lng",
    "fieldCenter.lon",
    "fieldCenter.long",
    "fieldCenter.longitude",
    "coordinates.lng",
    "coordinates.lon",
    "coordinates.long",
    "coordinates.longitude",
    "centroid.lng",
    "centroid.lon",
    "centroid.long",
    "centroid.longitude",
    "map.lng",
    "map.lon",
    "map.long",
    "map.longitude"
  ]);

  if (!isValidLatLng(lat, lng)) return null;

  return {
    lat: Number(lat),
    lng: Number(lng)
  };
}

async function loadActiveFieldsForBatch(){
  const db = getFirestore();
  let raw = [];

  try{
    const snap = await db.collection("fields").where("status", "==", "active").get();
    snap.forEach(doc => raw.push({ id: doc.id, data: doc.data() || {} }));
  }catch(e){
    console.warn("[Batch] fields query(status==active) failed:", e?.message || e);
  }

  if (!raw.length){
    try{
      const snap2 = await db.collection("fields").get();
      snap2.forEach(doc => raw.push({ id: doc.id, data: doc.data() || {} }));
    }catch(e){
      console.warn("[Batch] fields query(all) failed:", e?.message || e);
      raw = [];
    }
  }

  const out = [];
  for (const r of raw){
    const d = r.data || {};
    const st = normalizeStatus(d.status);
    if (st && st !== "active") continue;

    const location = extractLocation(d);
    if (!location) continue;

    out.push({
      id: r.id,
      name: String(d.name || ""),
      farmId: d.farmId || null,
      farmName: d.farmName || null,
      county: d.county || null,
      state: d.state || null,
      lat: location.lat,
      lng: location.lng,
      raw: d
    });
  }

  return out;
}

/* =====================================================================
   Open-Meteo split fetch:
   - history = archive API
   - forecast = forecast API
===================================================================== */

function buildSharedOpenMeteoFields(){
  return {
    hourly: [
      "precipitation",
      "temperature_2m",
      "wind_speed_10m",
      "relative_humidity_2m",
      "shortwave_radiation",
      "cloud_cover",
      "dew_point_2m",
      "vapour_pressure_deficit",
      "soil_temperature_0_to_10cm",
      "soil_temperature_10_to_40cm",
      "soil_temperature_40_to_100cm",
      "soil_temperature_100_to_200cm",
      "soil_moisture_0_to_10cm",
      "soil_moisture_10_to_40cm",
      "soil_moisture_40_to_100cm",
      "soil_moisture_100_to_200cm"
    ],
    daily: [
      "daylight_duration",
      "sunshine_duration",
      "shortwave_radiation_sum",
      "et0_fao_evapotranspiration",
      "temperature_2m_max",
      "temperature_2m_min"
    ]
  };
}

async function fetchOpenMeteoJson(url){
  const r = await fetch(url, { headers: { "Accept":"application/json" } });
  const json = await r.json().catch(() => ({}));

  if (!r.ok){
    const err = new Error("Open-Meteo failed");
    err.status = r.status;
    err.body = json;
    throw err;
  }

  return json;
}

function buildHistoricalUrl(lat, lng, timezone, start_date, end_date){
  const fields = buildSharedOpenMeteoFields();
  const params = new URLSearchParams();
  params.set("latitude", String(lat));
  params.set("longitude", String(lng));
  params.set("timezone", timezone);
  params.set("start_date", start_date);
  params.set("end_date", end_date);
  params.set("hourly", fields.hourly.join(","));
  params.set("daily", fields.daily.join(","));
  if (OPEN_METEO_API_KEY) params.set("apikey", OPEN_METEO_API_KEY);
  return `${historicalBaseUrl()}?${params.toString()}`;
}

function buildForecastUrl(lat, lng, timezone, forecast_days){
  const fields = buildSharedOpenMeteoFields();
  const params = new URLSearchParams();
  params.set("latitude", String(lat));
  params.set("longitude", String(lng));
  params.set("timezone", timezone);
  params.set("forecast_days", String(forecast_days));
  params.set("hourly", fields.hourly.join(","));
  params.set("daily", fields.daily.join(","));
  if (OPEN_METEO_API_KEY) params.set("apikey", OPEN_METEO_API_KEY);
  return `${forecastBaseUrl()}?${params.toString()}`;
}

function filterHourlyFutureOnly(rows, todayISO){
  return (Array.isArray(rows) ? rows : []).filter(r => {
    const t = String(r?.time || "");
    return t.slice(0, 10) > todayISO;
  });
}

function filterDailyFutureOnly(rows, todayISO){
  return (Array.isArray(rows) ? rows : []).filter(r => {
    const d = String(r?.date || "");
    return d.slice(0, 10) > todayISO;
  });
}

async function fetchOpenMeteo(lat, lng, days, timezone, forecast_days, gdu_base_f, gdu_cap_f){
  const now = new Date();
  const endDate = isoDate(now);
  const startDate = isoDate(addDays(now, -(Number(days) || DEFAULT_PAST_DAYS)));
  const todayISO = todayISOInTimeZone(timezone);

  const [histJson, fcstJson] = await Promise.all([
    fetchOpenMeteoJson(buildHistoricalUrl(lat, lng, timezone, startDate, endDate)),
    fetchOpenMeteoJson(buildForecastUrl(lat, lng, timezone, forecast_days))
  ]);

  const histHourlyCore = normalizeHourlyCore(histJson);
  const histHourlyExt  = normalizeHourlyExt(histJson);
  const histDaily      = normalizeDaily(histJson);
  computeDailyGDU(histDaily, gdu_base_f, gdu_cap_f);

  const fcstHourlyCore = filterHourlyFutureOnly(normalizeHourlyCore(fcstJson), todayISO);
  const fcstHourlyExt  = filterHourlyFutureOnly(normalizeHourlyExt(fcstJson), todayISO);
  const fcstDaily      = filterDailyFutureOnly(normalizeDaily(fcstJson), todayISO);
  computeDailyGDU(fcstDaily, gdu_base_f, gdu_cap_f);

  const hourlyCore = mergeArraysByTime(histHourlyCore, fcstHourlyCore);
  const hourlyExt  = mergeArraysByTime(histHourlyExt, fcstHourlyExt);
  const daily      = mergeArraysByTime(histDaily, fcstDaily);

  const units = {
    historical: {
      hourly: histJson?.hourly_units || null,
      daily: histJson?.daily_units || null
    },
    forecast: {
      hourly: fcstJson?.hourly_units || null,
      daily: fcstJson?.daily_units || null
    }
  };

  return {
    ok: true,
    source: OPEN_METEO_API_KEY ? "open-meteo-historical+forecast-customer" : "open-meteo-historical+forecast",
    request: {
      lat,
      lng,
      days,
      timezone,
      forecast_days,
      gdu_base_f,
      gdu_cap_f,
      historical: {
        start_date: startDate,
        end_date: endDate
      }
    },
    normalized: {
      hourly: hourlyCore,
      hourly_ext: hourlyExt,
      daily,
      meta: {
        units,
        todayISO,
        note: "History comes from /v1/archive. Future comes from /v1/forecast. Future rows are filtered to dates > today."
      }
    },
    raw: {
      historical: histJson,
      forecast: fcstJson
    }
  };
}

async function cacheWeatherForField(field, opts){
  const db = getFirestore();

  const payload = await fetchOpenMeteo(
    field.lat,
    field.lng,
    opts.days,
    opts.timezone,
    opts.forecast_days,
    opts.gdu_base_f,
    opts.gdu_cap_f
  );

  const hourlyCore = Array.isArray(payload?.normalized?.hourly) ? payload.normalized.hourly : [];
  const hourlyExt  = Array.isArray(payload?.normalized?.hourly_ext) ? payload.normalized.hourly_ext : [];
  const dailyArr   = Array.isArray(payload?.normalized?.daily) ? payload.normalized.daily : [];

  const keepHistDays = clamp(opts.days ?? DEFAULT_PAST_DAYS, 1, 90);
  const keepFcstDays = clamp(opts.forecast_days ?? DEFAULT_FORECAST_DAYS_BATCH, 0, 16);

  const split = aggregateHourlyToDailySplit(hourlyCore, hourlyExt, dailyArr, opts.timezone, keepHistDays, keepFcstDays);

  const dailySeries = split.hist;
  const dailySeriesFcst = split.fcst;

  const docRef = db.collection(WEATHER_CACHE_COLLECTION).doc(field.id);

  await docRef.set({
    fieldId: field.id,
    fieldName: field.name || null,
    farmId: field.farmId || null,
    farmName: field.farmName || null,
    location: { lat: field.lat, lng: field.lng },
    timezone: opts.timezone,
    fetchedAt: _admin.firestore.FieldValue.serverTimestamp(),
    source: payload.source,
    request: payload.request,
    normalized: payload.normalized,

    dailySeries,
    dailySeriesFcst,

    dailySeriesMeta: {
      todayISO: split.tISO,
      histDays: keepHistDays,
      fcstDays: keepFcstDays
    }
  }, { merge: true });

  return true;
}

async function runBatchCache(opts){
  const fields = await loadActiveFieldsForBatch();
  const total = fields.length;

  const maxConc = clamp(process.env.FV_BATCH_CONCURRENCY || DEFAULT_BATCH_CONCURRENCY, 1, 20);

  let ok = 0;
  let fail = 0;
  const failures = [];

  let idx = 0;

  async function worker(){
    while (idx < fields.length){
      const f = fields[idx++];
      try{
        await cacheWeatherForField(f, opts);
        ok++;
      }catch(e){
        fail++;
        const msg = e?.body ? JSON.stringify(e.body).slice(0, 500) : (e?.message || String(e));
        console.warn("[Batch] cache failed:", f.id, f.name, e?.status || "", msg);
        failures.push({
          fieldId: f.id,
          fieldName: f.name || null,
          status: e?.status || null,
          error: e?.message || "error"
        });
      }
    }
  }

  const t0 = Date.now();
  const workers = [];
  for (let i = 0; i < Math.min(maxConc, total); i++) workers.push(worker());
  await Promise.all(workers);
  const ms = Date.now() - t0;

  return { fields, total, ok, fail, ms, collection: WEATHER_CACHE_COLLECTION, failures: failures.slice(0, 25) };
}

/* =====================================================================
   Field Readiness snapshot
===================================================================== */
const READINESS_LATEST_COLLECTION = process.env.FV_READINESS_LATEST_COLLECTION || "field_readiness_latest";
const READINESS_RUNS_COLLECTION = process.env.FV_READINESS_RUNS_COLLECTION || "field_readiness_runs";
const PERSISTED_STATE_COLLECTION = process.env.FV_PERSISTED_STATE_COLLECTION || "field_readiness_state";
const MRMS_COLLECTION = process.env.FV_MRMS_COLLECTION || "field_mrms_weather";

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

function safeStr(x){
  const s = String(x || "");
  return s ? s : "";
}
function safeISO10(x){
  const s = safeStr(x);
  return (s.length >= 10) ? s.slice(0,10) : s;
}
function safeNum(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function makeRunKey(timeZone){
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false
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
  await db.runTransaction(async (tx)=>{
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
   Exact MRMS 72h logic ported from field-readiness/rain.js
===================================================================== */
function toYMDLocal(d){
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function startOfDayLocal(d){
  const out = new Date(d);
  out.setHours(0,0,0,0);
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
    const iso = String(r && r.dateISO || "").slice(0,10);
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

function overlayMrmsRainOntoWeatherRows(baseRows, mrmsDoc){
  const rows = Array.isArray(baseRows) ? baseRows.slice() : [];
  if (!rows.length) return [];

  const mrmsMap = buildMrmsDailyMapRows(mrmsDoc);
  if (!mrmsMap.size){
    return rows.map(r => ({
      ...r,
      rainInAdj: num(r && r.rainInAdj, num(r && r.rainIn, 0)),
      rainSource: "open-meteo"
    }));
  }

  return rows.map(r=>{
    const iso = String(r && r.dateISO || "").slice(0,10);
    const m = mrmsMap.get(iso);

    if (!m){
      return {
        ...r,
        rainInAdj: num(r && r.rainInAdj, num(r && r.rainIn, 0)),
        rainSource: "open-meteo"
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

function buildModelWeatherRowsForServer(wxDoc, mrmsDoc){
  const baseRows = Array.isArray(wxDoc && wxDoc.dailySeries) ? wxDoc.dailySeries.slice() : [];
  if (!baseRows.length) return [];

  const mrmsReady = mrmsBackfillReadyServer(mrmsDoc);
  if (!mrmsReady){
    return baseRows.map(r => ({
      ...r,
      rainInAdj: num(r && r.rainInAdj, num(r && r.rainIn, 0)),
      rainSource: "open-meteo"
    }));
  }

  return overlayMrmsRainOntoWeatherRows(baseRows, mrmsDoc);
}

/* =====================================================================
   Persisted truth + MRMS overlay
===================================================================== */
async function loadPersistedStateMap(){
  const db = getFirestore();
  const out = new Map();

  try{
    const snap = await db.collection(PERSISTED_STATE_COLLECTION).get();
    snap.forEach(docSnap=>{
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
        SmaxAtSave: safeNum(d.SmaxAtSave) ?? safeNum(d.SmaxAtSave || d.smaxAtSave) ?? 0
      });
    });
  }catch(e){
    console.warn("[Readiness] loadPersistedStateMap failed:", e?.message || e);
  }

  return out;
}

async function loadMrmsDocMap(){
  const db = getFirestore();
  const out = new Map();

  try{
    const snap = await db.collection(MRMS_COLLECTION).get();
    snap.forEach(docSnap=>{
      out.set(String(docSnap.id), docSnap.data() || {});
    });
  }catch(e){
    console.warn("[Readiness] loadMrmsDocMap failed:", e?.message || e);
  }

  return out;
}

/* =========================================================================
   SAME field param paths as field-readiness/data.js
   ========================================================================= */
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
    soilWetness: (soilWetness == null) ? null : soilWetness,
    drainageIndex: (drainageIndex == null) ? null : drainageIndex
  };
}

async function writeReadinessLatest(fields, runKey, timezone){
  const db = getFirestore();

  const DEFAULT_SOIL = 60;
  const DEFAULT_DRAIN = 45;

  const [persistedMap, mrmsMap] = await Promise.all([
    loadPersistedStateMap(),
    loadMrmsDocMap()
  ]);

  let batch = db.batch();
  let writes = 0;
  let ok = 0;
  let fail = 0;

  for (const f of fields){
    try{
      const wxSnap = await db.collection(WEATHER_CACHE_COLLECTION).doc(f.id).get();
      if (!wxSnap.exists){
        fail++;
        continue;
      }

      const wx = wxSnap.data() || {};

      let weatherRows = buildModelWeatherRowsForServer(
        wx,
        mrmsMap.get(String(f.id)) || null
      );

      if (!weatherRows.length){
        const normalized = wx.normalized || null;
        if (!normalized){
          fail++;
          continue;
        }

        const hourlyCore = Array.isArray(normalized.hourly) ? normalized.hourly : [];
        const hourlyExt  = Array.isArray(normalized.hourly_ext) ? normalized.hourly_ext : [];
        const dailyArr   = Array.isArray(normalized.daily) ? normalized.daily : [];

        const split = aggregateHourlyToDailySplit(
          hourlyCore,
          hourlyExt,
          dailyArr,
          timezone,
          DEFAULT_PAST_DAYS,
          DEFAULT_FORECAST_DAYS_BATCH
        );

        weatherRows = buildModelWeatherRowsForServer(
          { dailySeries: split.hist },
          mrmsMap.get(String(f.id)) || null
        );
      }

      if (!weatherRows.length){
        fail++;
        continue;
      }

      const fieldDoc = await db.collection("fields").doc(f.id).get();
      const fd = fieldDoc.exists ? (fieldDoc.data() || {}) : {};
      const extractedParams = extractFieldParamsLikeFrontend(fd);

      const soilWetness = Number.isFinite(Number(extractedParams.soilWetness))
        ? Number(extractedParams.soilWetness)
        : DEFAULT_SOIL;

      const drainageIndex = Number.isFinite(Number(extractedParams.drainageIndex))
        ? Number(extractedParams.drainageIndex)
        : DEFAULT_DRAIN;

      const persistedState = persistedMap.get(String(f.id)) || null;

      const snapshot = runFieldReadinessCore(
        weatherRows,
        soilWetness,
        drainageIndex,
        persistedState,
        {
          extra: EXTRA,
          tune: FV_TUNE,
          lossScale: LOSS_SCALE,
          includeTrace: false
        }
      );

      if (!snapshot || !Number.isFinite(Number(snapshot.readinessR))){
        fail++;
        continue;
      }

      const outRef = db.collection(READINESS_LATEST_COLLECTION).doc(f.id);

      batch.set(outRef, {
        fieldId: f.id,
        fieldName: f.name || (wx.fieldName || null),
        farmId: fd.farmId || f.farmId || null,
        farmName: fd.farmName || f.farmName || null,
        county: fd.county || f.county || null,
        state: fd.state || f.state || null,
        location: { lat: f.lat, lng: f.lng },

        readiness: Number(snapshot.readinessR),
        wetness: Number(snapshot.wetnessR),
        storageFinal: Number(snapshot.storageFinal),
        storagePhysFinal: Number(snapshot.storagePhysFinal),
        readinessCreditIn: Number(snapshot.readinessCreditIn || 0),
        storageForReadiness: Number(snapshot.storageForReadiness || 0),

        soilWetness,
        drainageIndex,

        seedSource: snapshot.seedSource,
        weatherFetchedAt: wx.fetchedAt || null,
        weatherSource: wx.source || null,

        runKey,
        timezone,
        computedAt: _admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      writes++;
      ok++;

      if (writes >= 400){
        await batch.commit();
        batch = db.batch();
        writes = 0;
      }
    }catch(e){
      fail++;
      console.warn("[Readiness] field failed:", f.id, f.name, e?.message || e);
    }
  }

  if (writes > 0){
    await batch.commit();
  }

  return { ok, fail };
}

/* =====================================================================
   Routes
===================================================================== */

app.get("/", async (req, res) => {
  cors(req, res);

  if (isSchedulerRequest(req)){
    try{
      const timezone = String(req.query.timezone || "America/Chicago");
      const days = clamp(req.query.days ?? DEFAULT_PAST_DAYS, 1, 90);
      const forecast_days = clamp(req.query.forecast_days ?? DEFAULT_FORECAST_DAYS_BATCH, 0, 16);
      const gdu_base_f = clamp(req.query.gdu_base_f ?? 50, 30, 70);
      const gdu_cap_f  = clamp(req.query.gdu_cap_f ?? 86, 60, 110);

      const out = await runBatchCache({ days, timezone, forecast_days, gdu_base_f, gdu_cap_f });

      const runKey = String(req.query.runKey || "").trim() || makeRunKey(timezone);
      const lock = await ensureRunLockOrSkip(runKey, timezone);

      let readiness = null;
      if (lock.shouldRun){
        readiness = await writeReadinessLatest(out.fields, runKey, timezone);
        await lock.runRef.set({
          status: "done",
          finishedAt: _admin.firestore.FieldValue.serverTimestamp(),
          fieldsTotal: out.total,
          fieldsOk: readiness.ok,
          fieldsFail: readiness.fail
        }, { merge: true });
      } else {
        readiness = { skipped: true, reason: "runKey already processed", runKey };
      }

      return res.status(200).json({
        ok: true,
        mode: "batch_cache_plus_readiness",
        ranAt: new Date().toISOString(),
        runKey,
        weather: {
          total: out.total,
          ok: out.ok,
          fail: out.fail,
          ms: out.ms,
          collection: out.collection,
          failures: out.failures
        },
        readiness
      });
    }catch(e){
      console.error("[Batch] run failed:", e);
      return res.status(500).json({
        ok:false,
        error: e?.message || "Batch failed",
        code: e?.code || null,
        hint: (e?.code === "MISSING_FIREBASE_ADMIN")
          ? "Add firebase-admin to package.json dependencies and redeploy."
          : null
      });
    }
  }

  res.status(200).send(
    "FarmVista Field Weather OK. Try /healthz or /api/open-meteo?lat=..&lng=..&days=30"
  );
});

app.get("/healthz", (req, res) => {
  cors(req, res);
  res.status(200).send("ok");
});

app.get("/api/open-meteo", async (req, res) => {
  cors(req, res);

  try{
    const lat = num(req.query.lat);
    const lng = num(req.query.lng);
    const days = clamp(req.query.days ?? 30, 1, 90);
    const timezone = String(req.query.timezone || "America/Chicago");

    const forecast_days = clamp(req.query.forecast_days ?? DEFAULT_FORECAST_DAYS_PROXY, 0, 16);

    const gdu_base_f = clamp(req.query.gdu_base_f ?? 50, 30, 70);
    const gdu_cap_f  = clamp(req.query.gdu_cap_f ?? 86, 60, 110);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ ok:false, error:"Missing or invalid lat/lng" });
    }

    const payload = await fetchOpenMeteo(
      lat,
      lng,
      days,
      timezone,
      forecast_days,
      gdu_base_f,
      gdu_cap_f
    );

    res.setHeader("Cache-Control", "public, max-age=300");

    return res.json({
      ok: true,
      source: payload.source,
      request: payload.request,
      normalized: payload.normalized,
      raw: payload.raw
    });

  }catch(e){
    console.error("open-meteo proxy error:", e);
    return res.status(500).json({ ok:false, error: e.message || "Server error" });
  }
});

app.listen(PORT, () => {
  console.log(`farmvista-field-weather listening on ${PORT}`);
});
