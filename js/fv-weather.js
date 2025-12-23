/* =======================================================================
// /Farm-vista/js/fv-weather.js
// Rev: 2025-12-23a (Auto-refresh timer + ZIP location picker)
//
// FarmVista Weather module
// - Google Weather: current conditions + last 24h precip
// - Open-Meteo: 7d & 30d rainfall + 7d forecast
//
// NEW (per Dane):
// ✅ Auto-refresh timer (default: every 60s) with “Next refresh in …” countdown
// ✅ ZIP code location picker (defaults to Divernon, IL)
//    - Stores chosen location in localStorage
//    - Uses Google Geocoding API to turn ZIP → lat/lon
//    - Applies to both card + modal
//
// Usage in dashboard:
//
//   FVWeather.initWeatherModule({
//     googleApiKey: "YOUR_KEY", // also used for geocoding
//     selector: "#fv-weather",
//     mode: "card",
//     autoRefreshSec: 60
//   });
//
//   FVWeather.initWeatherModule({
//     googleApiKey: "YOUR_KEY",
//     selector: "#fv-weather-modal-body",
//     mode: "modal",
//     autoRefreshSec: 60
//   });
//
// Lat / lon default to Divernon, IL but can be overridden.
// ======================================================================= */

(() => {
  "use strict";

  const GOOGLE_CURRENT_URL =
    "https://weather.googleapis.com/v1/currentConditions:lookup";
  const GOOGLE_HISTORY_URL =
    "https://weather.googleapis.com/v1/history/hours:lookup";
  const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";
  const GOOGLE_GEOCODE_URL =
    "https://maps.googleapis.com/maps/api/geocode/json";

  const LS_KEYS = {
    zip:   "fv_weather_zip",
    lat:   "fv_weather_lat",
    lon:   "fv_weather_lon",
    label: "fv_weather_label"
  };

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

    // NEW: Auto refresh
    autoRefreshSec: 60, // set 0 to disable
  };

  // per container timers to avoid duplicates when re-init is called
  const __timers = new Map(); // key: selector string => { refreshId, tickId, nextAtMs, lastCfgSig }

  /* ==========================
     Helpers
     ========================== */

  function getContainer(selector) {
    const el = document.querySelector(selector);
    if (!el) console.warn("[FVWeather] Container not found:", selector);
    return el;
  }

  function clampZip(s){
    const v = (s || "").toString().trim();
    // allow 5 or 5-4
    if (/^\d{5}$/.test(v)) return v;
    if (/^\d{5}-\d{4}$/.test(v)) return v;
    // if they type 9 digits without dash, normalize to 5-4
    if (/^\d{9}$/.test(v)) return v.slice(0,5) + "-" + v.slice(5);
    return v;
  }

  function readSavedLocation(){
    try{
      const lat = Number(localStorage.getItem(LS_KEYS.lat));
      const lon = Number(localStorage.getItem(LS_KEYS.lon));
      const label = (localStorage.getItem(LS_KEYS.label) || "").toString().trim();
      const zip = (localStorage.getItem(LS_KEYS.zip) || "").toString().trim();

      if (Number.isFinite(lat) && Number.isFinite(lon) && lat !== 0 && lon !== 0){
        return {
          lat, lon,
          label: label || DEFAULT_LOCATION.label,
          zip: zip || ""
        };
      }
    }catch{}
    return null;
  }

  function saveLocation({ zip, lat, lon, label }){
    try{
      if (zip != null) localStorage.setItem(LS_KEYS.zip, String(zip || ""));
      if (Number.isFinite(lat)) localStorage.setItem(LS_KEYS.lat, String(lat));
      if (Number.isFinite(lon)) localStorage.setItem(LS_KEYS.lon, String(lon));
      if (label != null) localStorage.setItem(LS_KEYS.label, String(label || DEFAULT_LOCATION.label));
    }catch{}
  }

  function clearSavedLocation(){
    try{
      localStorage.removeItem(LS_KEYS.zip);
      localStorage.removeItem(LS_KEYS.lat);
      localStorage.removeItem(LS_KEYS.lon);
      localStorage.removeItem(LS_KEYS.label);
    }catch{}
  }

  function effectiveConfig(options){
    const cfg = { ...DEFAULT_CONFIG, ...options };

    // If caller didn't explicitly override lat/lon/label, use saved location if present
    const callerProvidedLatLon =
      options && (Object.prototype.hasOwnProperty.call(options,"lat") || Object.prototype.hasOwnProperty.call(options,"lon"));
    const callerProvidedLabel =
      options && Object.prototype.hasOwnProperty.call(options,"locationLabel");

    const saved = readSavedLocation();
    if (saved && !callerProvidedLatLon){
      cfg.lat = saved.lat;
      cfg.lon = saved.lon;
    }
    if (saved && !callerProvidedLabel){
      cfg.locationLabel = saved.label || cfg.locationLabel;
    }

    return cfg;
  }

  function renderLoading(container) {
    if (!container) return;
    container.innerHTML = `
      <section class="fv-weather-card" style="
        border-radius:14px;border:1px solid var(--border,#d1d5db);
        background:var(--card-surface,var(--surface));
        box-shadow:0 8px 18px rgba(0,0,0,.06);
        padding:10px 14px 12px;
      ">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;">
          <div>
            <div style="font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;">
              Weather
            </div>
            <div style="font-size:11px;color:var(--muted,#67706B);">
              Loading current conditions…
            </div>
          </div>
        </div>
      </section>
    `;
  }

  function renderError(container, message) {
    if (!container) return;
    container.innerHTML = `
      <section class="fv-weather-card" style="
        border-radius:14px;border:1px solid var(--border,#d1d5db);
        background:var(--card-surface,var(--surface));
        box-shadow:0 8px 18px rgba(0,0,0,.06);
        padding:10px 14px 12px;
      ">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;">
          <div>
            <div style="font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;">
              Weather
            </div>
            <div style="font-size:11px;color:var(--muted,#67706B);">
              Unavailable
            </div>
          </div>
        </div>
        <div style="font-size:13px;color:var(--muted,#67706B);">
          Couldn’t load weather data. ${message || "Try again in a bit."}
        </div>
      </section>
    `;
  }

  function formatTemp(tempObj) {
    if (!tempObj || typeof tempObj.degrees !== "number") return "—";
    const value = Math.round(tempObj.degrees);
    const unit =
      tempObj.unit === "FAHRENHEIT"
        ? "°F"
        : tempObj.unit === "CELSIUS"
        ? "°C"
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
    const mm = String(m).padStart(2,"0");
    const rr = String(r).padStart(2,"0");
    return `${mm}:${rr}`;
  }

  // Classify a day into Sunny / Cloudy / Rain / Snow and compute snow range text.
  function classifyDay(day) {
    const hi = day.tMax;
    const precip = day.precipIn || 0;
    const clouds = day.cloudCover != null ? day.cloudCover : 0;

    let type = "Unknown";
    if (precip >= 0.05 && hi <= 34) {
      type = "Snow";
    } else if (precip >= 0.05) {
      type = "Rain";
    } else if (clouds <= 20) {
      type = "Sunny";
    } else if (clouds <= 60) {
      type = "Partly cloudy";
    } else {
      type = "Cloudy";
    }

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

  function cfgSig(cfg){
    // used to avoid restarting timers unnecessarily; include only what matters
    return [
      cfg.selector,
      cfg.mode,
      cfg.lat,
      cfg.lon,
      cfg.locationLabel,
      cfg.unitsSystem,
      cfg.showOpenMeteo,
      cfg.autoRefreshSec
    ].join("|");
  }

  function stopTimers(selector){
    const t = __timers.get(selector);
    if (!t) return;
    if (t.refreshId) clearInterval(t.refreshId);
    if (t.tickId) clearInterval(t.tickId);
    __timers.delete(selector);
  }

  function wireAutoRefresh(container, config, doRefresh){
    if (!container) return;

    const sec = Number(config.autoRefreshSec);
    if (!Number.isFinite(sec) || sec <= 0){
      stopTimers(config.selector);
      const nxt = container.querySelector(".fv-weather-next");
      if (nxt) nxt.textContent = "";
      return;
    }

    const sig = cfgSig(config);
    const existing = __timers.get(config.selector);

    // If config signature is same, keep existing timers
    if (existing && existing.lastCfgSig === sig) return;

    // Otherwise restart clean
    stopTimers(config.selector);

    const nextAt = Date.now() + sec * 1000;
    const state = {
      refreshId: null,
      tickId: null,
      nextAtMs: nextAt,
      lastCfgSig: sig
    };
    __timers.set(config.selector, state);

    function updateCountdown(){
      const el = container.querySelector(".fv-weather-next");
      if (!el) return;
      const remaining = state.nextAtMs - Date.now();
      el.textContent = `• Next refresh in ${msToClock(remaining)}`;
    }

    // 1s tick for countdown text
    state.tickId = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      updateCountdown();
    }, 1000);

    // main refresh interval
    state.refreshId = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      state.nextAtMs = Date.now() + sec * 1000;
      await doRefresh();
      updateCountdown();
    }, sec * 1000);

    // refresh immediately when tab becomes visible
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      state.nextAtMs = Date.now() + sec * 1000;
      doRefresh();
      updateCountdown();
    });

    // initial countdown draw
    updateCountdown();
  }

  /* ==========================
     ZIP → Lat/Lon (Google Geocoding)
     ========================== */

  async function geocodeZip(zip, apiKey){
    const z = clampZip(zip);
    if (!z) throw new Error("ZIP is blank.");
    if (!/^\d{5}(-\d{4})?$/.test(z)) throw new Error("ZIP must be 5 digits (or 5-4).");
    if (!apiKey) throw new Error("Missing Google API key (needed for ZIP lookup).");

    // Address is ZIP; restrict to US for less weird results
    const params = new URLSearchParams({
      address: z,
      components: "country:US",
      key: apiKey
    });

    const url = `${GOOGLE_GEOCODE_URL}?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Geocode HTTP ${res.status}`);

    const data = await res.json();
    if (!data || data.status !== "OK" || !Array.isArray(data.results) || !data.results.length){
      const msg = (data && data.error_message) ? data.error_message : (data && data.status) ? data.status : "No results";
      throw new Error(`ZIP lookup failed: ${msg}`);
    }

    const best = data.results[0];
    const loc = best.geometry && best.geometry.location ? best.geometry.location : null;
    if (!loc || typeof loc.lat !== "number" || typeof loc.lng !== "number"){
      throw new Error("ZIP lookup returned no coordinates.");
    }

    // Try to build a friendly label like "City, State"
    let city = "";
    let state = "";
    const comps = best.address_components || [];
    for (const c of comps){
      const types = c.types || [];
      if (!city && (types.includes("locality") || types.includes("postal_town"))) city = c.long_name || c.short_name || "";
      if (!state && types.includes("administrative_area_level_1")) state = c.short_name || c.long_name || "";
    }
    const label = (city && state) ? `${city}, ${state}` : (best.formatted_address || `ZIP ${z}`);

    return { zip: z, lat: loc.lat, lon: loc.lng, label };
  }

  function locationPickerHtml(config){
    const saved = readSavedLocation();
    const currentZip = saved && saved.zip ? saved.zip : "";

    return `
      <div class="fv-weather-loc" style="
        display:flex;align-items:center;justify-content:space-between;gap:10px;
        flex-wrap:wrap;margin-top:10px;
        padding-top:10px;border-top:1px solid rgba(148,163,184,0.25);
      ">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <div style="
            font-size:12px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;
            color:var(--muted,#67706B);
          ">Location</div>

          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            <input
              type="text"
              inputmode="numeric"
              autocomplete="postal-code"
              class="fv-weather-zip"
              value="${(currentZip || "").replace(/"/g,"&quot;")}"
              placeholder="ZIP (defaults to Divernon)"
              style="
                width:160px;max-width:62vw;
                border:1px solid var(--border,#d1d5db);
                border-radius:999px;
                padding:6px 10px;
                background:var(--surface);
                color:inherit;
                font:inherit;
                font-size:13px;
                outline:none;
              "
            />
            <button type="button" class="fv-weather-zip-apply" style="
              border-radius:999px;
              border:1px solid var(--border,#d1d5db);
              background:var(--surface);
              color:inherit;
              padding:6px 10px;
              font-size:13px;
              cursor:pointer;
              white-space:nowrap;
            ">Set ZIP</button>

            <button type="button" class="fv-weather-zip-default" style="
              border-radius:999px;
              border:1px solid rgba(59,126,70,0.45);
              background:rgba(59,126,70,0.10);
              color:inherit;
              padding:6px 10px;
              font-size:13px;
              cursor:pointer;
              white-space:nowrap;
            ">Use Divernon</button>
          </div>
        </div>

        <div class="fv-weather-zip-status" style="
          font-size:12px;color:var(--muted,#67706B);
          flex:1;text-align:right;min-width:180px;
        "></div>
      </div>
    `;
  }

  function wireLocationPicker(container, config, doRefresh){
    if (!container) return;

    const zipEl = container.querySelector(".fv-weather-zip");
    const applyBtn = container.querySelector(".fv-weather-zip-apply");
    const defBtn = container.querySelector(".fv-weather-zip-default");
    const statusEl = container.querySelector(".fv-weather-zip-status");

    if (!zipEl || !applyBtn || !defBtn) return;

    const setStatus = (msg) => {
      if (!statusEl) return;
      statusEl.textContent = msg || "";
    };

    const setBusy = (on) => {
      applyBtn.disabled = !!on;
      defBtn.disabled = !!on;
      zipEl.disabled = !!on;
      if (on) setStatus("Updating location…");
    };

    async function applyZip(){
      const z = clampZip(zipEl.value);
      zipEl.value = z;

      if (!z){
        // If they blank it, revert to default
        clearSavedLocation();
        saveLocation({ zip:"", lat: DEFAULT_LOCATION.lat, lon: DEFAULT_LOCATION.lon, label: DEFAULT_LOCATION.label });
        setStatus(`Using ${DEFAULT_LOCATION.label}`);
        await doRefresh(true);
        return;
      }

      setBusy(true);
      try{
        const loc = await geocodeZip(z, config.googleApiKey);
        saveLocation(loc);
        setStatus(`Using ${loc.label}`);
        await doRefresh(true);
      }catch(e){
        console.warn("[FVWeather] ZIP set failed:", e);
        setStatus(e && e.message ? e.message : "ZIP lookup failed.");
      }finally{
        setBusy(false);
      }
    }

    async function useDefault(){
      setBusy(true);
      try{
        clearSavedLocation();
        saveLocation({
          zip: "",
          lat: DEFAULT_LOCATION.lat,
          lon: DEFAULT_LOCATION.lon,
          label: DEFAULT_LOCATION.label
        });
        setStatus(`Using ${DEFAULT_LOCATION.label}`);
        await doRefresh(true);
      }finally{
        setBusy(false);
      }
    }

    applyBtn.addEventListener("click", (evt)=>{
      evt.preventDefault();
      evt.stopPropagation();
      applyZip();
    });

    defBtn.addEventListener("click", (evt)=>{
      evt.preventDefault();
      evt.stopPropagation();
      useDefault();
    });

    zipEl.addEventListener("keydown", (evt)=>{
      if (evt.key === "Enter"){
        evt.preventDefault();
        evt.stopPropagation();
        applyZip();
      }
    });

    // initial status
    const saved = readSavedLocation();
    if (saved && saved.label){
      setStatus(`Using ${saved.label}`);
    }else{
      setStatus(`Using ${DEFAULT_LOCATION.label}`);
    }
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
    if (!res.ok) {
      throw new Error(`currentConditions HTTP ${res.status}`);
    }
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
    if (!res.ok) {
      throw new Error(`history.hours HTTP ${res.status}`);
    }
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
    if (!res.ok) {
      throw new Error(`Open-Meteo rain HTTP ${res.status}`);
    }
    const data = await res.json();

    const daily = data.daily || {};
    const amounts = daily.precipitation_sum || [];
    const dates = daily.time || [];
    const n = amounts.length;

    let last30 = safeSum(amounts);
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
    if (!res.ok) {
      throw new Error(`Open-Meteo forecast HTTP ${res.status}`);
    }
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
     Render – card
     ========================== */

  function renderCard(container, combined, config) {
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

    const tempStr = formatTemp(temp);
    const feelsStr = formatTemp(feels);
    const humidStr = formatHumidity(humidity);
    const windStr = formatWind(wind);

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

    const autoTxt =
      (Number(config.autoRefreshSec) > 0)
        ? `<span class="fv-weather-next" style="white-space:nowrap;"></span>`
        : `<span class="fv-weather-next"></span>`;

    container.innerHTML = `
      <section class="fv-weather-card" style="
        border-radius:14px;border:1px solid var(--border,#d1d5db);
        background:var(--card-surface,var(--surface));
        box-shadow:0 8px 18px rgba(0,0,0,0.06);
        padding:10px 14px 12px;cursor:pointer;
      ">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;">
          <div>
            <div style="font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;">
              Weather · ${config.locationLabel || ""}
            </div>
            <div style="font-size:11px;color:var(--muted,#67706B);display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
              ${timeZone ? `<span>${timeZone}</span>` : ""}
              ${
                updatedLocal
                  ? `<span>• Updated ${new Date(updatedLocal).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit"
                    })}</span>`
                  : ""
              }
              ${autoTxt}
            </div>
          </div>
          <button type="button" class="fv-weather-refresh" style="
            border-radius:999px;border:1px solid var(--border,#d1d5db);
            background:var(--surface,#fff0);
            padding:4px 8px;
            font-size:12px;cursor:pointer;
            color:inherit;
          " aria-label="Refresh weather">
            ⟳
          </button>
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
          <div style="display:flex;flex-direction:column;gap:2px;min-width:0;">
            <div style="font-size:1.8rem;font-weight:600;">${tempStr}</div>
            <div style="font-size:0.9rem;">${desc}</div>
            <div style="font-size:0.8rem;color:var(--muted,#67706B);">
              Feels like <strong>${feelsStr}</strong>
            </div>
            <div style="font-size:0.8rem;color:var(--muted,#67706B);">
              Humidity: <strong>${humidStr}</strong> • Wind: <strong>${windStr}</strong>
            </div>
          </div>
          <div style="flex:0 0 auto;">
            ${
              iconUrl
                ? `<img src="${iconUrl}" alt="${desc}" style="width:48px;height:48px;display:block;" loading="lazy">`
                : ""
            }
          </div>
        </div>

        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;">
          <div class="fv-weather-rain-pill" style="
            padding:4px 8px;border-radius:999px;
            background:var(--surface);
            border:1px solid var(--border);
            font-size:11px;display:flex;gap:4px;align-items:center;
          ">
            <span style="font-weight:500;">Rain last 24 hours</span>
            <span style="font-variant-numeric:tabular-nums;">${rain24}</span>
          </div>
          <div class="fv-weather-rain-pill" style="
            padding:4px 8px;border-radius:999px;
            background:var(--surface);
            border:1px solid var(--border);
            font-size:11px;display:flex;gap:4px;align-items:center;
          ">
            <span style="font-weight:500;">Rain last 7 days</span>
            <span style="font-variant-numeric:tabular-nums;">${rain7}</span>
          </div>
          <div class="fv-weather-rain-pill" style="
            padding:4px 8px;border-radius:999px;
            background:var(--surface);
            border:1px solid var(--border);
            font-size:11px;display:flex;gap:4px;align-items:center;
          ">
            <span style="font-weight:500;">Rain last 30 days</span>
            <span style="font-variant-numeric:tabular-nums;">${rain30}</span>
          </div>
        </div>

        ${locationPickerHtml(config)}
      </section>
    `;

    // manual refresh button
    const btn = container.querySelector(".fv-weather-refresh");
    if (btn) {
      btn.addEventListener("click", (evt) => {
        evt.stopPropagation(); // don’t open modal when hitting refresh
        initWeatherModule({ ...config });
      });
    }

    // wire ZIP picker (re-renders using saved location)
    wireLocationPicker(container, config, async (forceFromSaved)=>{
      const saved = readSavedLocation();
      const nextCfg = { ...config };
      if (saved){
        nextCfg.lat = saved.lat;
        nextCfg.lon = saved.lon;
        nextCfg.locationLabel = saved.label || nextCfg.locationLabel;
      }else{
        nextCfg.lat = DEFAULT_LOCATION.lat;
        nextCfg.lon = DEFAULT_LOCATION.lon;
        nextCfg.locationLabel = DEFAULT_LOCATION.label;
      }
      await initWeatherModule(nextCfg);
    });
  }

  /* ==========================
     Render – modal
     ========================== */

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

    // --- Forecast: only today and forward ---
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const allDays = forecast.days || [];
    const upcoming = allDays.filter(d => {
      const dt = new Date(d.date);
      return dt >= today;
    });
    const forecastDays = upcoming.slice(0, 5);

    const forecastRowsHtml = forecastDays.length
      ? forecastDays
          .map((day, idx) => {
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
                <div class="fv-forecast-day" style="display:flex;flex-direction:column;gap:2px;">
                  <div class="fv-forecast-dow" style="font-weight:600;">${fmtDayShort(day.date)}</div>
                  <div class="fv-forecast-date" style="font-size:11px;color:var(--muted,#67706B);">
                    ${fmtMD(day.date)}
                  </div>
                </div>
                <div class="fv-forecast-temps" style="
                  display:flex;align-items:center;gap:6px;
                  font-variant-numeric:tabular-nums;
                ">
                  <span class="hi" style="font-weight:600;">${hi}</span>
                  <span class="lo" style="color:var(--muted,#67706B);">${lo}</span>
                </div>
                <div class="fv-forecast-rain" style="
                  display:flex;justify-content:flex-end;gap:6px;
                  font-variant-numeric:tabular-nums;
                ">
                  <span class="amt" style="font-weight:500;">${rainIn}</span>
                  <span class="prob" style="color:var(--muted,#67706B);">${prob}</span>
                </div>
              </div>
            `;
          })
          .join("")
      : `<div class="fv-forecast-empty" style="font-size:12px;color:var(--muted,#67706B);">
           Forecast data not available.
         </div>`;

    const autoTxt =
      (Number(config.autoRefreshSec) > 0)
        ? `<span class="fv-weather-next" style="white-space:nowrap;"></span>`
        : `<span class="fv-weather-next"></span>`;

    const forecastHtml = `
      <div class="fv-forecast-list">
        ${forecastRowsHtml}
      </div>
      <div class="fv-forecast-detail" style="
        margin-top:8px;padding-top:6px;border-top:1px solid rgba(148,163,184,0.25);
        font-size:12px;color:var(--muted,#67706B);
      "></div>
    `;

    container.innerHTML = `
      <section class="fv-weather-card fv-weather-modal-card" style="cursor:auto;box-shadow:none;border:none;padding:0;">
        <header class="fv-weather-modal-head" style="margin-bottom:10px;">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap;">
            <div>
              <div class="fv-weather-title" style="
                font-size:13px;font-weight:600;letter-spacing:.06em;
                text-transform:uppercase;
              ">
                Weather · ${config.locationLabel || ""}
              </div>
              <div class="fv-weather-meta" style="
                font-size:11px;color:var(--muted,#67706B);
                display:flex;flex-wrap:wrap;gap:6px;align-items:center;
              ">
                <span>Detailed conditions, 5-day outlook, and rain history.</span>
                ${autoTxt}
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
            " aria-label="Refresh weather">
              Refresh
            </button>
          </div>

          ${locationPickerHtml(config)}
        </header>

        <div class="fv-weather-modal-body-inner" style="display:flex;flex-direction:column;gap:14px;">
          <section class="fv-weather-modal-section fv-weather-current" style="
            border-radius:12px;border:1px solid var(--border,#e5e7eb);
            padding:10px 12px 12px;background:var(--card-surface,var(--surface));
          ">
            <div class="fv-weather-main" style="
              display:flex;align-items:center;justify-content:space-between;
              gap:10px;flex-wrap:wrap;
            ">
              <div class="fv-weather-temp-block" style="display:flex;flex-direction:column;gap:2px;">
                <div class="fv-weather-temp" style="font-size:2rem;font-weight:600;">${tempStr}</div>
                <div class="fv-weather-desc" style="font-size:0.95rem;">${desc}</div>
                <div class="fv-weather-feels" style="font-size:0.85rem;color:var(--muted,#67706B);">
                  Feels like <strong>${feelsStr}</strong>
                </div>
                <div class="fv-weather-humidity" style="font-size:0.85rem;color:var(--muted,#67706B);">
                  Humidity: <strong>${humidStr}</strong> • Wind: <strong>${windStr}</strong>
                </div>
                <div class="fv-weather-rain-summary" style="margin-top:6px;font-size:0.82rem;color:var(--muted,#67706B);">
                  Rain last 24h: <strong>${rain24}</strong> ·
                  7 days: <strong>${rain7}</strong> ·
                  30 days: <strong>${rain30}</strong>
                </div>
              </div>
              <div class="fv-weather-icon-block" style="flex:0 0 auto;">
                ${
                  iconUrl
                    ? `<img src="${iconUrl}" alt="${desc}" class="fv-weather-icon" style="width:60px;height:60px;" loading="lazy">`
                    : ""
                }
              </div>
            </div>
          </section>

          <section class="fv-weather-modal-section fv-weather-forecast" style="
            border-radius:12px;border:1px solid var(--border,#e5e7eb);
            padding:10px 12px 12px;background:var(--card-surface,var(--surface));
          ">
            <h3 class="fv-weather-modal-subtitle" style="
              margin:0 0 6px 0;font-size:13px;font-weight:600;
              letter-spacing:.05em;text-transform:uppercase;
              color:var(--muted,#67706B);
            ">
              Next 5 days
            </h3>
            ${forecastHtml}
          </section>

          <section class="fv-weather-modal-section fv-weather-rain-history" style="
            border-radius:12px;border:1px solid var(--border,#e5e7eb);
            padding:10px 12px 12px;background:var(--card-surface,var(--surface));
          ">
            <h3 class="fv-weather-modal-subtitle" style="
              margin:0 0 6px 0;font-size:13px;font-weight:600;
              letter-spacing:.05em;text-transform:uppercase;
              color:var(--muted,#67706B);
            ">
              Rainfall – last 7 days
            </h3>
            <div class="fv-rain-chart">
              ${rainChartHtml}
            </div>
          </section>
        </div>
      </section>
    `;

    // manual refresh
    const btn = container.querySelector(".fv-weather-refresh");
    if (btn) {
      btn.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        initWeatherModule({ ...config });
      });
    }

    // wire ZIP picker (re-renders using saved location)
    wireLocationPicker(container, config, async ()=>{
      const saved = readSavedLocation();
      const nextCfg = { ...config };
      if (saved){
        nextCfg.lat = saved.lat;
        nextCfg.lon = saved.lon;
        nextCfg.locationLabel = saved.label || nextCfg.locationLabel;
      }else{
        nextCfg.lat = DEFAULT_LOCATION.lat;
        nextCfg.lon = DEFAULT_LOCATION.lon;
        nextCfg.locationLabel = DEFAULT_LOCATION.label;
      }
      await initWeatherModule(nextCfg);
    });

    // --- Wire up "day details" click behavior ---
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
     Orchestration
     ========================== */

  async function initWeatherModule(options = {}) {
    const config = effectiveConfig(options);
    const container = getContainer(config.selector);
    if (!container) return;

    if (!config.googleApiKey) {
      renderError(container, "Missing Google Weather API key.");
      console.error("[FVWeather] No googleApiKey provided.");
      return;
    }

    // inner refresh function used by timers (re-read saved location each time)
    const refresh = async () => {
      const saved = readSavedLocation();
      const nextCfg = { ...config };
      if (saved){
        nextCfg.lat = saved.lat;
        nextCfg.lon = saved.lon;
        nextCfg.locationLabel = saved.label || nextCfg.locationLabel;
      }else{
        // if nothing saved, stick with whatever config already had
      }
      // prevent timer duplication (same selector/mode) by calling the internal render path below
      await __render(nextCfg);
    };

    // Render once, then wire timers (timers use refresh())
    await __render(config);
    wireAutoRefresh(container, config, refresh);
  }

  async function __render(config){
    const container = getContainer(config.selector);
    if (!container) return;

    renderLoading(container);

    const mode = config.mode || "card";
    const wantForecast = mode === "modal" && config.showOpenMeteo;

    const tasks = [
      fetchGoogleCurrent(config),
      fetchGoogleHistory24(config),
      config.showOpenMeteo ? fetchOpenMeteoRain(config) : Promise.resolve(null),
      wantForecast ? fetchOpenMeteoForecast(config) : Promise.resolve(null)
    ];

    let results;
    try {
      results = await Promise.allSettled(tasks);
    } catch (err) {
      console.error("[FVWeather] Unexpected Promise.allSettled error:", err);
      renderError(container, "Unexpected error.");
      return;
    }

    const [curRes, histRes, rainRes, fcRes] = results;

    const combined = {
      googleCurrent: curRes.status === "fulfilled" ? curRes.value : null,
      googleHistory: histRes.status === "fulfilled" ? histRes.value : null,
      openMeteo: rainRes.status === "fulfilled" ? rainRes.value : null,
      openForecast: fcRes.status === "fulfilled" ? fcRes.value : null
    };

    if (!combined.googleCurrent && !combined.googleHistory) {
      console.warn("[FVWeather] Google Weather failed:", {
        current: curRes,
        history: histRes
      });
      renderError(container, "Weather service error.");
      return;
    }

    if (mode === "modal") {
      renderModal(container, combined, config);
    } else {
      renderCard(container, combined, config);
    }
  }

  window.FVWeather = { initWeatherModule };
})();
