/* =======================================================================
// /Farm-vista/js/fv-weather.js
// Rev: 2025-12-23d (Mobile cache + helper sync + tighter ZIP footer)
//
// Fixes (per Dane):
// ✅ Mobile persistence: if localStorage is blocked/flaky (iOS), fall back to cookie (+ sessionStorage)
// ✅ Header + footer helper ALWAYS stay in sync (including any external “footer helper” elements)
// ✅ ZIP row is tighter / takes less space, wraps clean on phone
// ✅ Still: ZIP lookup via Zippopotam.us (no Google Geocoding), subtle refresh, timer, etc.
// ======================================================================= */

(() => {
  "use strict";
    // Center placeholder text in the ZIP input (Safari/iOS needs ::placeholder rule)
  (function injectZipPlaceholderStyle(){
    try{
      if (document.getElementById('fv-weather-zip-ph-style')) return;
      const s = document.createElement('style');
      s.id = 'fv-weather-zip-ph-style';
      s.textContent = `
        .fv-weather-zip::placeholder{ text-align:center; }
        .fv-weather-zip::-webkit-input-placeholder{ text-align:center; }
      `;
      document.head.appendChild(s);
    }catch(_){}
  })();

  const GOOGLE_CURRENT_URL =
    "https://weather.googleapis.com/v1/currentConditions:lookup";
  const GOOGLE_HISTORY_URL =
    "https://weather.googleapis.com/v1/history/hours:lookup";
  const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";

  const ZIP_LOOKUP_URL = (zip5) => `https://api.zippopotam.us/us/${zip5}`;

  const LS_KEYS = {
    zip:   "fv_weather_zip",
    lat:   "fv_weather_lat",
    lon:   "fv_weather_lon",
    label: "fv_weather_label"
  };

  // Cookie name (fallback persistence for iOS quirks)
  const CK_NAME = "fv_weather_loc"; // stores JSON {zip,lat,lon,label}

  const DEFAULT_LOCATION = {
    lat: 39.5656,
    lon: -89.6573,
    label: "Divernon, Illinois",
    zip: ""
  };

  const DEFAULT_CONFIG = {
    googleApiKey: "",
    lat: DEFAULT_LOCATION.lat,
    lon: DEFAULT_LOCATION.lon,
    unitsSystem: "IMPERIAL",
    selector: "#fv-weather",
    showOpenMeteo: true,
    mode: "card", // "card" | "modal"
    locationLabel: DEFAULT_LOCATION.label,
    autoRefreshSec: 60 // 0 disables
  };

  // timers per selector (avoid duplicates)
  const __timers = new Map(); // selector => { refreshId, tickId, nextAtMs, lastCfgSig }
  const __rendered = new Set(); // selector => has base DOM structure rendered

  // in-memory fallback (last resort)
  let __memLoc = null;

  /* ==========================
     Helpers
     ========================== */

  function getContainer(selector) {
    const el = document.querySelector(selector);
    if (!el) console.warn("[FVWeather] Container not found:", selector);
    return el;
  }

  function safeText(s){
    return (s == null ? "" : String(s));
  }

  function clampZipInput(raw){
    const s = safeText(raw).trim();
    const digits = s.replace(/[^\d]/g, "").slice(0, 9);
    if (digits.length <= 5) return digits;
    return digits.slice(0,5) + "-" + digits.slice(5);
  }

  function zip5Only(raw){
    const digits = safeText(raw).replace(/[^\d]/g, "");
    return digits.length >= 5 ? digits.slice(0,5) : "";
  }

  // -------- Storage layer (localStorage -> sessionStorage -> cookie -> memory) --------

  function canUseStorage(which){
    try{
      const s = (which === "local") ? window.localStorage : window.sessionStorage;
      if (!s) return false;
      const k = "__fv_test__";
      s.setItem(k, "1");
      s.removeItem(k);
      return true;
    }catch{
      return false;
    }
  }

  function cookieSet(name, value, days){
    try{
      const d = new Date();
      d.setTime(d.getTime() + (days*24*60*60*1000));
      const expires = "expires=" + d.toUTCString();
      document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)};${expires};path=/;SameSite=Lax`;
      return true;
    }catch{
      return false;
    }
  }

  function cookieGet(name){
    try{
      const n = encodeURIComponent(name) + "=";
      const parts = (document.cookie || "").split(";");
      for (let p of parts){
        p = p.trim();
        if (p.startsWith(n)) return decodeURIComponent(p.substring(n.length));
      }
    }catch{}
    return "";
  }

  function cookieDel(name){
    try{
      document.cookie = `${encodeURIComponent(name)}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;SameSite=Lax`;
    }catch{}
  }

  function readSavedLocation(){
    // 1) localStorage
    try{
      if (canUseStorage("local")){
        const lat = Number(localStorage.getItem(LS_KEYS.lat));
        const lon = Number(localStorage.getItem(LS_KEYS.lon));
        const label = safeText(localStorage.getItem(LS_KEYS.label)).trim();
        const zip = safeText(localStorage.getItem(LS_KEYS.zip)).trim();
        if (Number.isFinite(lat) && Number.isFinite(lon) && lat !== 0 && lon !== 0){
          return { lat, lon, label: label || DEFAULT_LOCATION.label, zip: zip || "" };
        }
      }
    }catch{}

    // 2) sessionStorage
    try{
      if (canUseStorage("session")){
        const lat = Number(sessionStorage.getItem(LS_KEYS.lat));
        const lon = Number(sessionStorage.getItem(LS_KEYS.lon));
        const label = safeText(sessionStorage.getItem(LS_KEYS.label)).trim();
        const zip = safeText(sessionStorage.getItem(LS_KEYS.zip)).trim();
        if (Number.isFinite(lat) && Number.isFinite(lon) && lat !== 0 && lon !== 0){
          return { lat, lon, label: label || DEFAULT_LOCATION.label, zip: zip || "" };
        }
      }
    }catch{}

    // 3) cookie (persistent fallback)
    try{
      const raw = cookieGet(CK_NAME);
      if (raw){
        const obj = JSON.parse(raw);
        const lat = Number(obj.lat);
        const lon = Number(obj.lon);
        const label = safeText(obj.label).trim();
        const zip = safeText(obj.zip).trim();
        if (Number.isFinite(lat) && Number.isFinite(lon) && lat !== 0 && lon !== 0){
          return { lat, lon, label: label || DEFAULT_LOCATION.label, zip: zip || "" };
        }
      }
    }catch{}

    // 4) in-memory
    if (__memLoc && Number.isFinite(__memLoc.lat) && Number.isFinite(__memLoc.lon)){
      return { ...__memLoc };
    }

    return null;
  }

  function persistToAll(loc){
    // localStorage
    try{
      if (canUseStorage("local")){
        localStorage.setItem(LS_KEYS.zip, String(loc.zip || ""));
        localStorage.setItem(LS_KEYS.lat, String(loc.lat));
        localStorage.setItem(LS_KEYS.lon, String(loc.lon));
        localStorage.setItem(LS_KEYS.label, String(loc.label || DEFAULT_LOCATION.label));
      }
    }catch{}

    // sessionStorage
    try{
      if (canUseStorage("session")){
        sessionStorage.setItem(LS_KEYS.zip, String(loc.zip || ""));
        sessionStorage.setItem(LS_KEYS.lat, String(loc.lat));
        sessionStorage.setItem(LS_KEYS.lon, String(loc.lon));
        sessionStorage.setItem(LS_KEYS.label, String(loc.label || DEFAULT_LOCATION.label));
      }
    }catch{}

    // cookie (1 year)
    try{
      cookieSet(CK_NAME, JSON.stringify({
        zip: loc.zip || "",
        lat: Number(loc.lat),
        lon: Number(loc.lon),
        label: loc.label || DEFAULT_LOCATION.label
      }), 365);
    }catch{}

    // memory
    __memLoc = { ...loc };
  }

  function saveLocation({ zip, lat, lon, label }){
    const loc = {
      zip: String(zip || ""),
      lat: Number(lat),
      lon: Number(lon),
      label: String(label || DEFAULT_LOCATION.label)
    };
    if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lon)) return;
    persistToAll(loc);
  }

  function clearSavedLocation(){
    try{
      if (canUseStorage("local")){
        localStorage.removeItem(LS_KEYS.zip);
        localStorage.removeItem(LS_KEYS.lat);
        localStorage.removeItem(LS_KEYS.lon);
        localStorage.removeItem(LS_KEYS.label);
      }
    }catch{}
    try{
      if (canUseStorage("session")){
        sessionStorage.removeItem(LS_KEYS.zip);
        sessionStorage.removeItem(LS_KEYS.lat);
        sessionStorage.removeItem(LS_KEYS.lon);
        sessionStorage.removeItem(LS_KEYS.label);
      }
    }catch{}
    try{ cookieDel(CK_NAME); }catch{}
    __memLoc = null;
  }

  // External helper sync: anything with [data-fv-weather-help] OR #fv-weather-help
  function syncExternalHelper(label){
    const text = label ? `Using ${label}` : `Using ${DEFAULT_LOCATION.label}`;
    try{
      const els = [
        ...document.querySelectorAll('[data-fv-weather-help]'),
      ];
      const byId = document.getElementById("fv-weather-help");
      if (byId) els.push(byId);

      els.forEach(el => {
        if (!el) return;
        // if element is an input, set value; else textContent
        if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") el.value = text;
        else el.textContent = text;
      });
    }catch{}
  }

  // NEW: decide when saved label should override caller
  function shouldUseSavedLabel(saved, options){
    if (!saved || !saved.label) return false;

    const hasRealSaved =
      !!saved.zip ||
      (Number.isFinite(saved.lat) && Number.isFinite(saved.lon) &&
       (Math.abs(saved.lat - DEFAULT_LOCATION.lat) > 1e-6 ||
        Math.abs(saved.lon - DEFAULT_LOCATION.lon) > 1e-6));

    if (!hasRealSaved) return false;

    const callerProvidedLabel = !!(options && Object.prototype.hasOwnProperty.call(options, "locationLabel"));
    if (!callerProvidedLabel) return true;

    const callerLabel = safeText(options.locationLabel).trim();
    if (!callerLabel) return true;
    if (callerLabel === DEFAULT_LOCATION.label) return true;
    if (callerLabel === DEFAULT_CONFIG.locationLabel) return true;

    return false;
  }

  function effectiveConfig(options){
    const cfg = { ...DEFAULT_CONFIG, ...options };

    const callerProvidedLatLon =
      options && (Object.prototype.hasOwnProperty.call(options,"lat") || Object.prototype.hasOwnProperty.call(options,"lon"));

    const saved = readSavedLocation();

    if (saved && !callerProvidedLatLon){
      cfg.lat = saved.lat;
      cfg.lon = saved.lon;
    }

    if (saved && shouldUseSavedLabel(saved, options)){
      cfg.locationLabel = saved.label || cfg.locationLabel;
    }

    return cfg;
  }

  function formatTemp(tempObj) {
    if (!tempObj || typeof tempObj.degrees !== "number") return "—";
    const value = Math.round(tempObj.degrees);
    const unit =
      tempObj.unit === "FAHRENHEIT" ? "°F"
      : tempObj.unit === "CELSIUS" ? "°C"
      : "";
    return `${value}${unit}`;
  }

  function formatHumidity(value) {
    if (typeof value !== "number") return "—";
    return `${value}%`;
  }

  function formatWind(wind) {
    if (!wind || !wind.speed || typeof wind.speed.value !== "number") return "—";
    const speed = Math.round(wind.speed.value);
    const dir = wind.direction && wind.direction.cardinal
      ? wind.direction.cardinal.replace("_", " ")
      : "";
    return dir ? `${speed} mph ${dir}` : `${speed} mph`;
  }

  function buildGoogleIconUrl(weatherCondition) {
    if (!weatherCondition || !weatherCondition.iconBaseUri) return "";
    return `${weatherCondition.iconBaseUri}.svg`;
  }

  function safeSum(arr) {
    return (arr || []).reduce((sum, v) => {
      const n = typeof v === "number" ? v : 0;
      return sum + n;
    }, 0);
  }

  function roundTo2(n) {
    return Math.round(n * 100) / 100;
  }

  function fmtDayShort(dateStr) {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, { weekday: "short" });
  }

  function fmtMD(dateStr) {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function toLocalTime(dateStr) {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  function msToClock(ms){
    const s = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${String(m).padStart(2,"0")}:${String(r).padStart(2,"0")}`;
  }

  function cfgSig(cfg){
    return [
      cfg.selector, cfg.mode, cfg.lat, cfg.lon, cfg.locationLabel,
      cfg.unitsSystem, cfg.showOpenMeteo, cfg.autoRefreshSec
    ].join("|");
  }

  function stopTimers(selector){
    const t = __timers.get(selector);
    if (!t) return;
    if (t.refreshId) clearInterval(t.refreshId);
    if (t.tickId) clearInterval(t.tickId);
    __timers.delete(selector);
  }

  function setUpdating(container, on){
    if (!container) return;
    const badge = container.querySelector('[data-fv="upd"]');
    if (!badge) return;
    badge.textContent = on ? "• Updating…" : "";
  }

  function updateCountdown(container, selector){
    const t = __timers.get(selector);
    if (!t) return;
    const el = container.querySelector('[data-fv="next"]');
    if (!el) return;
    el.textContent = `• Next refresh in ${msToClock(t.nextAtMs - Date.now())}`;
  }

  function wireAutoRefresh(container, config, doRefresh){
    if (!container) return;

    const sec = Number(config.autoRefreshSec);
    if (!Number.isFinite(sec) || sec <= 0){
      stopTimers(config.selector);
      const nxt = container.querySelector('[data-fv="next"]');
      if (nxt) nxt.textContent = "";
      return;
    }

    const sig = cfgSig(config);
    const existing = __timers.get(config.selector);
    if (existing && existing.lastCfgSig === sig) {
      updateCountdown(container, config.selector);
      return;
    }

    stopTimers(config.selector);

    const state = {
      refreshId: null,
      tickId: null,
      nextAtMs: Date.now() + sec * 1000,
      lastCfgSig: sig
    };
    __timers.set(config.selector, state);

    state.tickId = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      updateCountdown(container, config.selector);
    }, 1000);

    state.refreshId = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      state.nextAtMs = Date.now() + sec * 1000;
      setUpdating(container, true);
      try{
        await doRefresh();
      }finally{
        setUpdating(container, false);
        updateCountdown(container, config.selector);
      }
    }, sec * 1000);

    // NOTE: ensure we don't stack multiple visibility listeners per page load
    if (!wireAutoRefresh.__wired){
      wireAutoRefresh.__wired = true;
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "visible") return;
        const t = __timers.get(config.selector);
        if (!t) return;
        t.nextAtMs = Date.now() + sec * 1000;
        setUpdating(container, true);
        doRefresh().finally(() => {
          setUpdating(container, false);
          updateCountdown(container, config.selector);
        });
      });
    }

    updateCountdown(container, config.selector);
  }

  /* ==========================
     ZIP lookup (NO Google Geocoding)
     ========================== */

  async function lookupZip(zipInput){
    const z5 = zip5Only(zipInput);
    if (!z5) throw new Error("Enter a 5-digit ZIP.");

    const res = await fetch(ZIP_LOOKUP_URL(z5));
    if (!res.ok) throw new Error(`ZIP lookup failed (${res.status}).`);

    const data = await res.json();
    const places = Array.isArray(data.places) ? data.places : [];
    if (!places.length) throw new Error("ZIP not found.");

    const p = places[0];
    const lat = Number(p.latitude);
    const lon = Number(p.longitude);
    const city = safeText(p["place name"]).trim();
    const state = safeText(p["state abbreviation"]).trim();
    const label = (city && state) ? `${city}, ${state}` : `ZIP ${z5}`;

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("ZIP returned invalid coordinates.");
    return { zip: z5, lat, lon, label };
  }

  /* ==========================
     Fetchers
     ========================== */

  async function fetchGoogleCurrent(config) {
    const params = new URLSearchParams({
      key: config.googleApiKey,
      "location.latitude": String(config.lat),
      "location.longitude": String(config.lon),
      unitsSystem: config.unitsSystem
    });

    const url = `${GOOGLE_CURRENT_URL}?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`currentConditions HTTP ${res.status}`);
    const data = await res.json();
    const current =
      Array.isArray(data.currentConditions) && data.currentConditions.length > 0
        ? data.currentConditions[0]
        : data.currentConditions || data;
    return { raw: data, current };
  }

  async function fetchGoogleHistory24(config) {
    const params = new URLSearchParams({
      key: config.googleApiKey,
      "location.latitude": String(config.lat),
      "location.longitude": String(config.lon),
      unitsSystem: config.unitsSystem,
      hours: String(24)
    });

    const url = `${GOOGLE_HISTORY_URL}?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`history.hours HTTP ${res.status}`);
    const data = await res.json();
    const hoursArr = data.historyHours || [];

    let totalInches = 0;
    for (const h of hoursArr) {
      const precip = h.precipitation;
      const qpf = precip && precip.qpf;
      const qty = qpf && typeof qpf.quantity === "number" ? qpf.quantity : 0;
      totalInches += qty;
    }

    return { raw: data, rain24hInches: totalInches };
  }

  async function fetchOpenMeteoRain(config) {
    const params = new URLSearchParams({
      latitude: String(config.lat),
      longitude: String(config.lon),
      daily: "precipitation_sum",
      past_days: "30",
      forecast_days: "0",
      timezone: "auto",
      precipitation_unit: "inch"
    });

    const url = `${OPEN_METEO_URL}?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Open-Meteo rain HTTP ${res.status}`);
    const data = await res.json();

    const daily = data.daily || {};
    const amounts = daily.precipitation_sum || [];
    const dates = daily.time || [];
    const n = amounts.length;

    const last30 = safeSum(amounts);
    let last7 = 0;
    let last7Dates = [];
    let last7Amounts = [];

    if (n > 0) {
      const startIdx = n >= 7 ? n - 7 : 0;
      last7Amounts = amounts.slice(startIdx);
      last7Dates = dates.slice(startIdx);
      last7 = safeSum(last7Amounts);
    }

    return {
      raw: data,
      rain7dInches: last7,
      rain30dInches: last30,
      last7: { dates: last7Dates, amounts: last7Amounts }
    };
  }

  async function fetchOpenMeteoForecast(config) {
    const params = new URLSearchParams({
      latitude: String(config.lat),
      longitude: String(config.lon),
      daily: [
        "temperature_2m_max",
        "temperature_2m_min",
        "precipitation_sum",
        "precipitation_probability_mean",
        "cloudcover_mean",
        "windspeed_10m_max",
        "winddirection_10m_dominant",
        "sunrise",
        "sunset"
      ].join(","),
      forecast_days: "7",
      timezone: "auto",
      precipitation_unit: "inch",
      temperature_unit: "fahrenheit",
      wind_speed_unit: "mph"
    });

    const url = `${OPEN_METEO_URL}?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Open-Meteo forecast HTTP ${res.status}`);
    const data = await res.json();

    const daily = data.daily || {};
    const times = daily.time || [];
    const tMax = daily.temperature_2m_max || [];
    const tMin = daily.temperature_2m_min || [];
    const precip = daily.precipitation_sum || [];
    const prob = daily.precipitation_probability_mean || [];
    const clouds = daily.cloudcover_mean || [];
    const windSpeed = daily.windspeed_10m_max || [];
    const windDir = daily.winddirection_10m_dominant || [];
    const sunrise = daily.sunrise || [];
    const sunset = daily.sunset || [];

    const days = [];
    for (let i = 0; i < times.length; i++) {
      days.push({
        date: times[i],
        tMax: typeof tMax[i] === "number" ? tMax[i] : null,
        tMin: typeof tMin[i] === "number" ? tMin[i] : null,
        precipIn: typeof precip[i] === "number" ? precip[i] : 0,
        precipProb: typeof prob[i] === "number" ? prob[i] : null,
        cloudCover: typeof clouds[i] === "number" ? clouds[i] : null,
        windSpeedMax: typeof windSpeed[i] === "number" ? windSpeed[i] : null,
        windDirDeg: typeof windDir[i] === "number" ? windDir[i] : null,
        sunrise: sunrise[i],
        sunset: sunset[i]
      });
    }

    return { raw: data, days };
  }

  /* ==========================
     Render skeleton (card) + update-in-place
     ========================== */

  function cardSkeletonHtml(config){
    const saved = readSavedLocation();
    const zipVal = saved && saved.zip ? saved.zip : "";

    return `
      <section class="fv-weather-card" style="
        border-radius:14px;border:1px solid var(--border,#d1d5db);
        background:var(--card-surface,var(--surface));
        box-shadow:0 8px 18px rgba(0,0,0,0.06);
        padding:10px 14px 10px;cursor:pointer;
      ">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;">
          <div style="min-width:0;">
            <div style="font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              <span data-fv="title">Weather · ${safeText(config.locationLabel || "")}</span>
            </div>
            <div style="font-size:11px;color:var(--muted,#67706B);display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
              <span data-fv="tz"></span>
              <span data-fv="upd"></span>
              <span data-fv="updated"></span>
              <span data-fv="next"></span>
            </div>
          </div>
          <button type="button" class="fv-weather-refresh" style="
            border-radius:999px;border:1px solid var(--border,#d1d5db);
            background:var(--surface,#fff0);
            padding:4px 8px;
            font-size:12px;cursor:pointer;
            color:inherit;
            flex:0 0 auto;
          " aria-label="Refresh weather">⟳</button>
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
          <div style="display:flex;flex-direction:column;gap:2px;min-width:0;">
            <div style="font-size:1.8rem;font-weight:600;" data-fv="temp">—</div>
            <div style="font-size:0.9rem;" data-fv="desc">—</div>
            <div style="font-size:0.8rem;color:var(--muted,#67706B);">
              Feels like <strong data-fv="feels">—</strong>
            </div>
            <div style="font-size:0.8rem;color:var(--muted,#67706B);">
              Humidity: <strong data-fv="humid">—</strong> • Wind: <strong data-fv="wind">—</strong>
            </div>
          </div>
          <div style="flex:0 0 auto;">
            <img data-fv="icon" alt="" style="width:48px;height:48px;display:none;" loading="lazy">
          </div>
        </div>

        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;">
          <div style="
            padding:4px 8px;border-radius:999px;
            background:var(--surface);
            border:1px solid var(--border);
            font-size:11px;display:flex;gap:4px;align-items:center;
          ">
            <span style="font-weight:500;">Rain last 24 hours</span>
            <span style="font-variant-numeric:tabular-nums;" data-fv="r24">—</span>
          </div>
          <div style="
            padding:4px 8px;border-radius:999px;
            background:var(--surface);
            border:1px solid var(--border);
            font-size:11px;display:flex;gap:4px;align-items:center;
          ">
            <span style="font-weight:500;">Rain last 7 days</span>
            <span style="font-variant-numeric:tabular-nums;" data-fv="r7">—</span>
          </div>
          <div style="
            padding:4px 8px;border-radius:999px;
            background:var(--surface);
            border:1px solid var(--border);
            font-size:11px;display:flex;gap:4px;align-items:center;
          ">
            <span style="font-weight:500;">Rain last 30 days</span>
            <span style="font-variant-numeric:tabular-nums;" data-fv="r30">—</span>
          </div>
        </div>

        <!-- Location (ZIP) - tighter + mobile friendly -->
<div class="fv-weather-loc" style="
  display:flex;align-items:center;justify-content:space-between;gap:8px;
  flex-wrap:wrap;margin-top:8px;
  padding-top:8px;border-top:1px solid rgba(148,163,184,0.22);
">
  <div style="display:flex;align-items:center;gap:8px;flex:0 0 auto;">
    <div style="
      font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;
      color:var(--muted,#67706B);
    ">ZIP</div>

    <input
      type="text"
      inputmode="numeric"
      autocomplete="postal-code"
      class="fv-weather-zip"
      value="${safeText(zipVal).replace(/"/g,"&quot;")}"
      placeholder="Enter Zip"
      style="
        width:108px;
        border:1px solid var(--border,#d1d5db);
        border-radius:999px;
        padding:4px 9px;
        background:var(--surface);
        color:inherit;
        font:inherit;
        font-size:12px;
        outline:none;
        text-align:center;
      "
    />
  </div>

  <div class="fv-weather-zip-status" style="
    font-size:8px;color:var(--muted,#67706B);
    flex:1 1 auto;
    text-align:center;
    white-space:nowrap;
    overflow:hidden;
    text-overflow:ellipsis;
    min-width:140px;
  "></div>
</div>
</section>
`;
}

  function updateCardInPlace(container, combined, config){
    if (!container) return;

    const current = combined.googleCurrent?.current || {};
    const currentData = combined.googleCurrent?.raw || {};
    const history24 = combined.googleHistory || {};
    const openRain = combined.openMeteo || {};

    const condition = current.weatherCondition || {};
    const temp = current.temperature || {};
    const feels = current.feelsLikeTemperature || {};
    const humidity = current.relativeHumidity;
    const wind = current.wind || {};
    const iconUrl = buildGoogleIconUrl(condition);

    const desc =
      (condition.description && condition.description.text) ||
      condition.type ||
      "Current conditions";

    const timeZone =
      (currentData.timeZone && currentData.timeZone.id) ||
      (history24.raw && history24.raw.timeZone && history24.raw.timeZone.id) ||
      "";

    const updatedTime =
      current.displayTime ||
      current.currentTime ||
      currentData.currentTime ||
      "";
    const updatedLocal =
      updatedTime && updatedTime.iso8601
        ? updatedTime.iso8601
        : typeof updatedTime === "string"
        ? updatedTime
        : "";

    const rain24 =
      typeof history24.rain24hInches === "number" ? `${roundTo2(history24.rain24hInches)}"` : "—";
    const rain7 =
      typeof openRain.rain7dInches === "number" ? `${roundTo2(openRain.rain7dInches)}"` : "—";
    const rain30 =
      typeof openRain.rain30dInches === "number" ? `${roundTo2(openRain.rain30dInches)}"` : "—";

    const set = (sel, text) => {
      const el = container.querySelector(`[data-fv="${sel}"]`);
      if (el) el.textContent = text;
    };

    set("title", `Weather · ${safeText(config.locationLabel || "")}`);
    set("tz", timeZone ? timeZone : "");
    set("temp", formatTemp(temp));
    set("desc", desc);
    set("feels", formatTemp(feels));
    set("humid", formatHumidity(humidity));
    set("wind", formatWind(wind));
    set("r24", rain24);
    set("r7", rain7);
    set("r30", rain30);

    const updatedEl = container.querySelector('[data-fv="updated"]');
    if (updatedEl){
      if (updatedLocal){
        const t = new Date(updatedLocal).toLocaleTimeString([], { hour:"numeric", minute:"2-digit" });
        updatedEl.textContent = `• Updated ${t}`;
      }else{
        updatedEl.textContent = "";
      }
    }

    const iconEl = container.querySelector('[data-fv="icon"]');
    if (iconEl){
      if (iconUrl){
        iconEl.src = iconUrl;
        iconEl.alt = desc;
        iconEl.style.display = "block";
      }else{
        iconEl.removeAttribute("src");
        iconEl.alt = "";
        iconEl.style.display = "none";
      }
    }
  }

  function wireCardControls(container, config){
    if (!container) return;

    // prevent stacking duplicate listeners on repeated init calls
    if (container.__fvWeatherWired) return;
    container.__fvWeatherWired = true;

    // refresh click should NOT bubble to modal open
    const refreshBtn = container.querySelector(".fv-weather-refresh");
    if (refreshBtn){
      refreshBtn.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        initWeatherModule({ ...config, __forceRefresh:true });
      });
    }

    // ZIP area should NEVER open modal
    const loc = container.querySelector(".fv-weather-loc");
    if (loc){
      loc.addEventListener("click", (evt)=> evt.stopPropagation());
      loc.addEventListener("mousedown", (evt)=> evt.stopPropagation());
      loc.addEventListener("pointerdown", (evt)=> evt.stopPropagation());
      loc.addEventListener("touchstart", (evt)=> evt.stopPropagation(), { passive:true });
    }

    const zipEl = container.querySelector(".fv-weather-zip");
    const statusEl = container.querySelector(".fv-weather-zip-status");
    if (!zipEl) return;

    const setStatus = (msg, alsoLabel) => {
      if (statusEl) statusEl.textContent = msg || "";
      if (alsoLabel) syncExternalHelper(alsoLabel);
    };

    let debounceId = null;
    async function applyZip(raw){
      const cleaned = clampZipInput(raw);
      zipEl.value = cleaned;

      const z5 = zip5Only(cleaned);
      if (!z5){
        // empty => revert to Divernon
        clearSavedLocation();
        saveLocation({
          zip:"",
          lat: DEFAULT_LOCATION.lat,
          lon: DEFAULT_LOCATION.lon,
          label: DEFAULT_LOCATION.label
        });
        setStatus(`Using ${DEFAULT_LOCATION.label}`, DEFAULT_LOCATION.label);
        await initWeatherModule({ ...config, lat: DEFAULT_LOCATION.lat, lon: DEFAULT_LOCATION.lon, locationLabel: DEFAULT_LOCATION.label, __forceRefresh:true });
        return;
      }

      if (z5.length !== 5) return;

      setStatus("Looking up ZIP…");
      try{
        const loc = await lookupZip(z5);
        saveLocation(loc);

        // immediately sync any external footer helper
        setStatus(`Using ${loc.label}`, loc.label);

        await initWeatherModule({ ...config, lat: loc.lat, lon: loc.lon, locationLabel: loc.label, __forceRefresh:true });
      }catch(e){
        console.warn("[FVWeather] ZIP set failed:", e);
        setStatus(e && e.message ? e.message : "ZIP lookup failed.");
      }
    }

    function scheduleApply(){
      if (debounceId) clearTimeout(debounceId);
      debounceId = setTimeout(() => {
        applyZip(zipEl.value);
      }, 650);
    }

    zipEl.addEventListener("input", (evt)=>{
      evt.stopPropagation();
      zipEl.value = clampZipInput(zipEl.value);
      if (zip5Only(zipEl.value).length === 5) scheduleApply();
      else setStatus("");
    });

    zipEl.addEventListener("keydown", (evt)=>{
      evt.stopPropagation();
      if (evt.key === "Enter"){
        evt.preventDefault();
        applyZip(zipEl.value);
      }
    });

    zipEl.addEventListener("blur", ()=>{
      if (zip5Only(zipEl.value).length === 5) applyZip(zipEl.value);
      if (!zipEl.value) applyZip("");
    });

    // initial status + external helper sync
    const saved = readSavedLocation();
    if (saved && saved.label){
      setStatus(`Using ${saved.label}`, saved.label);
      // ensure input shows saved ZIP even if skeleton rendered before cookie/localStorage was ready
      if (saved.zip) zipEl.value = saved.zip;
    } else {
      setStatus(`Using ${DEFAULT_LOCATION.label}`, DEFAULT_LOCATION.label);
    }
  }

  /* ==========================
     Render – modal (kept as your original full render)
     ========================== */

  function classifyDay(day) {
    const hi = day.tMax;
    const precip = day.precipIn || 0;
    const clouds = day.cloudCover != null ? day.cloudCover : 0;

    let type = "Unknown";
    if (precip >= 0.05 && hi <= 34) type = "Snow";
    else if (precip >= 0.05) type = "Rain";
    else if (clouds <= 20) type = "Sunny";
    else if (clouds <= 60) type = "Partly cloudy";
    else type = "Cloudy";

    let snowRange = null;
    if (type === "Snow" && precip > 0) {
      const inch = precip;
      if (inch < 0.2) snowRange = "Dusting";
      else if (inch < 1.0) snowRange = "½–1\"";
      else if (inch < 2.0) snowRange = "1–2\"";
      else if (inch < 3.0) snowRange = "2–4\"";
      else if (inch < 5.0) snowRange = "3–5\"";
      else snowRange = `${Math.round(inch)}"+`;
    }
    return { type, snowRange };
  }

  function renderModal(container, combined, config) {
    if (!container) return;

    const current = combined.googleCurrent?.current || {};
    const history24 = combined.googleHistory || {};
    const openRain = combined.openMeteo || {};
    const forecast = combined.openForecast || {};
    const condition = current.weatherCondition || {};
    const temp = current.temperature || {};
    const feels = current.feelsLikeTemperature || {};
    const humidity = current.relativeHumidity;
    const wind = current.wind || {};
    const iconUrl = buildGoogleIconUrl(condition);

    const desc =
      (condition.description && condition.description.text) ||
      condition.type ||
      "Current conditions";

    const tempStr = formatTemp(temp);
    const feelsStr = formatTemp(feels);
    const humidStr = formatHumidity(humidity);
    const windStr = formatWind(wind);

    const rain24 =
      typeof history24.rain24hInches === "number"
        ? `${roundTo2(history24.rain24hInches)}"`
        : "—";
    const rain7 =
      typeof openRain.rain7dInches === "number"
        ? `${roundTo2(openRain.rain7dInches)}"`
        : "—";
    const rain30 =
      typeof openRain.rain30dInches === "number"
        ? `${roundTo2(openRain.rain30dInches)}"`
        : "—";

    const rainSeries = (openRain && openRain.last7) || { dates: [], amounts: [] };
    const seriesDates = rainSeries.dates || [];
    const seriesAmounts = rainSeries.amounts || [];
    const maxAmt = Math.max(...seriesAmounts, 0.01);

    const rainChartHtml = seriesDates.length
      ? seriesDates
          .map((d, idx) => {
            const val = seriesAmounts[idx] || 0;
            const pct = Math.max(5, (val / maxAmt) * 100);
            return `
              <div class="fv-rain-row" style="
                display:grid;grid-template-columns:50px 1fr 52px;
                align-items:center;gap:6px;font-size:12px;
              ">
                <div class="fv-rain-label" style="font-weight:500;">${fmtDayShort(d)}</div>
                <div class="fv-rain-bar-wrap" style="
                  position:relative;height:8px;border-radius:999px;
                  background:var(--border);opacity:.4;overflow:hidden;
                ">
                  <div class="fv-rain-bar" style="
                    position:absolute;inset:0;border-radius:999px;
                    background:#2F6C3C;width:${pct}%;
                  "></div>
                </div>
                <div class="fv-rain-value" style="
                  text-align:right;font-variant-numeric:tabular-nums;
                ">
                  ${roundTo2(val)}"
                </div>
              </div>
            `;
          })
          .join("")
      : `<div class="fv-rain-chart-empty" style="font-size:12px;color:var(--muted,#67706B);">
           No recent rainfall data.
         </div>`;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const allDays = forecast.days || [];
    const upcoming = allDays.filter(d => new Date(d.date) >= today);
    const forecastDays = upcoming.slice(0, 5);

    const forecastRowsHtml = forecastDays.length
      ? forecastDays.map((day, idx) => {
          const hi = day.tMax != null ? `${Math.round(day.tMax)}°` : "—";
          const lo = day.tMin != null ? `${Math.round(day.tMin)}°` : "—";
          const rainIn = day.precipIn != null ? `${roundTo2(day.precipIn)}"` : "—";
          const prob = day.precipProb != null ? `${Math.round(day.precipProb)}%` : "—";
          const selectedClass = idx === 0 ? " fv-forecast-row-selected" : "";
          return `
            <div class="fv-forecast-row${selectedClass}" data-idx="${idx}" style="
              display:grid;grid-template-columns:90px 1fr 110px;
              align-items:center;gap:8px;padding:6px 0;
              border-bottom:1px dashed rgba(148,163,184,0.4);
              font-size:12px;cursor:pointer;
            ">
              <div style="display:flex;flex-direction:column;gap:2px;">
                <div style="font-weight:600;">${fmtDayShort(day.date)}</div>
                <div style="font-size:11px;color:var(--muted,#67706B);">${fmtMD(day.date)}</div>
              </div>
              <div style="display:flex;align-items:center;gap:6px;font-variant-numeric:tabular-nums;">
                <span style="font-weight:600;">${hi}</span>
                <span style="color:var(--muted,#67706B);">${lo}</span>
              </div>
              <div style="display:flex;justify-content:flex-end;gap:6px;font-variant-numeric:tabular-nums;">
                <span style="font-weight:500;">${rainIn}</span>
                <span style="color:var(--muted,#67706B);">${prob}</span>
              </div>
            </div>
          `;
        }).join("")
      : `<div style="font-size:12px;color:var(--muted,#67706B);">Forecast data not available.</div>`;

    container.innerHTML = `
      <section class="fv-weather-card fv-weather-modal-card" style="cursor:auto;box-shadow:none;border:none;padding:0;">
        <header style="margin-bottom:10px;">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap;">
            <div>
              <div style="font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;">
                Weather · ${safeText(config.locationLabel || "")}
              </div>
              <div style="font-size:11px;color:var(--muted,#67706B);">
                Detailed conditions, 5-day outlook, and rain history.
              </div>
            </div>
            <button type="button" class="fv-weather-refresh" style="
              border-radius:999px;border:1px solid var(--border,#d1d5db);
              background:var(--surface);
              color:inherit;
              padding:6px 10px;
              font-size:13px;
              cursor:pointer;
              white-space:nowrap;
            ">Refresh</button>
          </div>
        </header>

        <div style="display:flex;flex-direction:column;gap:14px;">
          <section style="
            border-radius:12px;border:1px solid var(--border,#e5e7eb);
            padding:10px 12px 12px;background:var(--card-surface,var(--surface));
          ">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
              <div style="display:flex;flex-direction:column;gap:2px;">
                <div style="font-size:2rem;font-weight:600;">${tempStr}</div>
                <div style="font-size:0.95rem;">${desc}</div>
                <div style="font-size:0.85rem;color:var(--muted,#67706B);">
                  Feels like <strong>${feelsStr}</strong>
                </div>
                <div style="font-size:0.85rem;color:var(--muted,#67706B);">
                  Humidity: <strong>${humidStr}</strong> • Wind: <strong>${windStr}</strong>
                </div>
                <div style="margin-top:6px;font-size:0.82rem;color:var(--muted,#67706B);">
                  Rain last 24h: <strong>${rain24}</strong> ·
                  7 days: <strong>${rain7}</strong> ·
                  30 days: <strong>${rain30}</strong>
                </div>
              </div>
              <div style="flex:0 0 auto;">
                ${iconUrl ? `<img src="${iconUrl}" alt="${desc}" style="width:60px;height:60px;" loading="lazy">` : ""}
              </div>
            </div>
          </section>

          <section style="
            border-radius:12px;border:1px solid var(--border,#e5e7eb);
            padding:10px 12px 12px;background:var(--card-surface,var(--surface));
          ">
            <h3 style="
              margin:0 0 6px 0;font-size:13px;font-weight:600;
              letter-spacing:.05em;text-transform:uppercase;color:var(--muted,#67706B);
            ">Next 5 days</h3>
            <div class="fv-forecast-list">${forecastRowsHtml}</div>
            <div class="fv-forecast-detail" style="
              margin-top:8px;padding-top:6px;border-top:1px solid rgba(148,163,184,0.25);
              font-size:12px;color:var(--muted,#67706B);
            "></div>
          </section>

          <section style="
            border-radius:12px;border:1px solid var(--border,#e5e7eb);
            padding:10px 12px 12px;background:var(--card-surface,var(--surface));
          ">
            <h3 style="
              margin:0 0 6px 0;font-size:13px;font-weight:600;
              letter-spacing:.05em;text-transform:uppercase;color:var(--muted,#67706B);
            ">Rainfall – last 7 days</h3>
            <div class="fv-rain-chart">${rainChartHtml}</div>
          </section>
        </div>
      </section>
    `;

    const btn = container.querySelector(".fv-weather-refresh");
    if (btn) {
      btn.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        initWeatherModule({ ...config, __forceRefresh:true });
      });
    }

    const rows = container.querySelectorAll(".fv-forecast-row");
    const detailEl = container.querySelector(".fv-forecast-detail");

    function renderDetail(idx) {
      const day = forecastDays[idx];
      if (!day || !detailEl) return;
      const { type, snowRange } = classifyDay(day);

      const hi = day.tMax != null ? `${Math.round(day.tMax)}°F` : "—";
      const lo = day.tMin != null ? `${Math.round(day.tMin)}°F` : "—";
      const rainIn = day.precipIn != null ? `${roundTo2(day.precipIn)}"` : "0";
      const prob = day.precipProb != null ? `${Math.round(day.precipProb)}%` : "–";
      const windSpeed = day.windSpeedMax != null ? `${Math.round(day.windSpeedMax)} mph` : "–";
      const windDir = day.windDirDeg != null ? `${Math.round(day.windDirDeg)}°` : "–";
      const sunrise = toLocalTime(day.sunrise);
      const sunset = toLocalTime(day.sunset);

      const precipLine =
        type === "Snow"
          ? `Snow: ${snowRange || `${rainIn}"`} (chance ${prob})`
          : `Precip: ${rainIn}" (chance ${prob})`;

      detailEl.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:3px;">
          <div style="font-weight:600;">
            ${fmtDayShort(day.date)} · ${fmtMD(day.date)} — ${type}
          </div>
          <div>High: <strong>${hi}</strong> · Low: <strong>${lo}</strong></div>
          <div>${precipLine}</div>
          <div>Wind: <strong>${windSpeed}</strong> (dir ${windDir})</div>
          ${
            sunrise || sunset
              ? `<div>Sunrise: <strong>${sunrise || "–"}</strong> · Sunset: <strong>${sunset || "–"}</strong></div>`
              : ""
          }
        </div>
      `;
    }

    if (rows.length && detailEl && forecastDays.length) {
      renderDetail(0);
      rows.forEach(row => {
        row.addEventListener("click", () => {
          rows.forEach(r => r.classList.remove("fv-forecast-row-selected"));
          row.classList.add("fv-forecast-row-selected");
          const idx = Number(row.getAttribute("data-idx") || "0") || 0;
          renderDetail(idx);
        });
      });
    }
  }

  /* ==========================
     Orchestration (subtle refresh)
     ========================== */

  async function __fetchCombined(config){
    const mode = config.mode || "card";
    const wantForecast = mode === "modal" && config.showOpenMeteo;

    const tasks = [
      fetchGoogleCurrent(config),
      fetchGoogleHistory24(config),
      config.showOpenMeteo ? fetchOpenMeteoRain(config) : Promise.resolve(null),
      wantForecast ? fetchOpenMeteoForecast(config) : Promise.resolve(null)
    ];

    const results = await Promise.allSettled(tasks);
    const [curRes, histRes, rainRes, fcRes] = results;

    const combined = {
      googleCurrent: curRes.status === "fulfilled" ? curRes.value : null,
      googleHistory: histRes.status === "fulfilled" ? histRes.value : null,
      openMeteo: rainRes.status === "fulfilled" ? rainRes.value : null,
      openForecast: fcRes.status === "fulfilled" ? fcRes.value : null
    };

    if (!combined.googleCurrent && !combined.googleHistory){
      console.warn("[FVWeather] Google Weather failed:", { current: curRes, history: histRes });
      throw new Error("Weather service error.");
    }

    return combined;
  }

  async function initWeatherModule(options = {}) {
    const config = effectiveConfig(options);
    const container = getContainer(config.selector);
    if (!container) return;

    if (!config.googleApiKey) {
      container.innerHTML = `
        <section class="fv-weather-card" style="
          border-radius:14px;border:1px solid var(--border,#d1d5db);
          background:var(--card-surface,var(--surface));
          box-shadow:0 8px 18px rgba(0,0,0,.06);
          padding:10px 14px 12px;
        ">
          <div style="font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;">Weather</div>
          <div style="font-size:13px;color:var(--muted,#67706B);margin-top:6px;">
            Missing Google Weather API key.
          </div>
        </section>
      `;
      console.error("[FVWeather] No googleApiKey provided.");
      return;
    }

    const firstPaint = !__rendered.has(config.selector) && (config.mode === "card");

    if (config.mode === "card") {
      if (firstPaint) {
        container.innerHTML = cardSkeletonHtml(config);
        __rendered.add(config.selector);
        wireCardControls(container, config);
      } else {
        setUpdating(container, !!options.__forceRefresh);
      }
    }

    try{
      const combined = await __fetchCombined(config);

      if (config.mode === "modal") {
        renderModal(container, combined, config);
      } else {
        updateCardInPlace(container, combined, config);

        // If saved label exists, re-sync helper text (fixes “header changed, footer didn’t” cases)
        const saved = readSavedLocation();
        if (saved && saved.label) syncExternalHelper(saved.label);

        updateCountdown(container, config.selector);
      }
    }catch(err){
      console.warn("[FVWeather] render failed:", err);
      if (config.mode === "card") {
        const statusEl = container.querySelector(".fv-weather-zip-status");
        if (statusEl) statusEl.textContent = "Weather unavailable.";
      } else {
        container.innerHTML = `<div style="font-size:13px;color:var(--muted,#67706B);">Weather unavailable.</div>`;
      }
    }finally{
      setUpdating(container, false);
    }

    // timers
    const doRefresh = async () => {
      const saved = readSavedLocation();
      const nextCfg = { ...config };

      if (saved){
        nextCfg.lat = saved.lat;
        nextCfg.lon = saved.lon;
        nextCfg.locationLabel = saved.label || nextCfg.locationLabel;
      } else {
        nextCfg.lat = DEFAULT_LOCATION.lat;
        nextCfg.lon = DEFAULT_LOCATION.lon;
        nextCfg.locationLabel = DEFAULT_LOCATION.label;
      }

      await initWeatherModule({ ...nextCfg });
    };

    wireAutoRefresh(container, config, doRefresh);
  }

  window.FVWeather = { initWeatherModule };
})();
