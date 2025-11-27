/* =======================================================================
// /Farm-vista/js/fv-weather.js
// Rev: 2025-11-27b
//
// FarmVista Weather module
// - Google Maps Weather API (currentConditions + history.hours)
// - Open-Meteo (7-day & 30-day rainfall)
//
// This module:
//   • Uses GOOGLE for current conditions + last 24h precip
//   • Uses OPEN-METEO for last 7 & 30 day precip
//   • Renders a single hero-style card into a container.
//
// Google Weather docs:
//   currentConditions.lookup:
//     GET https://weather.googleapis.com/v1/currentConditions:lookup
//   history.hours.lookup:
//     GET https://weather.googleapis.com/v1/history/hours:lookup
//
// Open-Meteo docs (free, no key):
//   Forecast endpoint with past_days:
//     GET https://api.open-meteo.com/v1/forecast?
//       latitude=..&longitude=..&daily=precipitation_sum&past_days=30&forecast_days=0
//       &timezone=auto&precipitation_unit=inch
// ======================================================================= */

(() => {
  /* ==========================
     Config & constants
     ========================== */

  const GOOGLE_CURRENT_URL =
    "https://weather.googleapis.com/v1/currentConditions:lookup";
  const GOOGLE_HISTORY_URL =
    "https://weather.googleapis.com/v1/history/hours:lookup";
  const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";

  const DEFAULT_CONFIG = {
    googleApiKey: "",          // REQUIRED for Google calls
    lat: 39.278,               // override with your HQ or farm coords
    lon: -89.88,
    unitsSystem: "IMPERIAL",   // "IMPERIAL" or "METRIC" (Google Weather enum)
    selector: "#fv-weather",   // container for the card
    showOpenMeteo: true        // set false if you ever want Google-only
  };

  /* ==========================
     Small helpers
     ========================== */

  function getContainer(selector) {
    const el = document.querySelector(selector);
    if (!el) {
      console.warn("[FVWeather] Container not found:", selector);
    }
    return el;
  }

  function renderLoading(container) {
    if (!container) return;
    container.innerHTML = `
      <section class="fv-weather-card fv-weather-loading">
        <div class="fv-weather-head">
          <div>
            <div class="fv-weather-title">Weather</div>
            <div class="fv-weather-meta">Loading current conditions…</div>
          </div>
        </div>
      </section>
    `;
  }

  function renderError(container, message) {
    if (!container) return;
    container.innerHTML = `
      <section class="fv-weather-card fv-weather-error">
        <div class="fv-weather-head">
          <div>
            <div class="fv-weather-title">Weather</div>
            <div class="fv-weather-meta">Unavailable</div>
          </div>
        </div>
        <div class="fv-weather-body">
          <p class="fv-weather-error-text">
            Couldn’t load weather data. ${message || "Try again in a bit."}
          </p>
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
    // Google provides iconBaseUri; append ".svg" to get the icon.  [oai_citation:2‡Google for Developers](https://developers.google.com/maps/documentation/weather/reference/rest/v1/currentConditions/lookup?utm_source=chatgpt.com)
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

  /* ==========================
     Fetch: Google currentConditions
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
      throw new Error(`Google currentConditions error (${res.status})`);
    }
    const data = await res.json();
    // API returns CurrentConditionsHistory object with currentConditions[] in some examples;
    // To be robust, support both shapes: data.currentConditions[0] or data.currentConditions
    const current =
      Array.isArray(data.currentConditions) && data.currentConditions.length > 0
        ? data.currentConditions[0]
        : data.currentConditions || data;
    return {
      raw: data,
      current
    };
  }

  /* ==========================
     Fetch: Google 24h history (rain)
     ========================== */

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
      throw new Error(`Google history.hours error (${res.status})`);
    }
    const data = await res.json();
    const hoursArr = data.historyHours || [];

    // Sum QPF quantities (accumulated precip last hour) over 24 hours.  [oai_citation:3‡Google for Developers](https://developers.google.com/maps/documentation/weather/reference/rest/v1/history.hours/lookup)
    let totalInches = 0;
    for (const h of hoursArr) {
      const precip = h.precipitation;
      const qpf = precip && precip.qpf;
      const qty = qpf && typeof qpf.quantity === "number" ? qpf.quantity : 0;
      totalInches += qty;
    }

    return {
      raw: data,
      rain24hInches: totalInches
    };
  }

  /* ==========================
     Fetch: Open-Meteo 7d & 30d rainfall
     ========================== */

  async function fetchOpenMeteoRain(config) {
    const params = new URLSearchParams({
      latitude: String(config.lat),
      longitude: String(config.lon),
      daily: "precipitation_sum",
      past_days: "30",         // last 30 days history
      forecast_days: "0",      // no future needed
      timezone: "auto",
      precipitation_unit: "inch"
    });

    const url = `${OPEN_METEO_URL}?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Open-Meteo error (${res.status})`);
    }
    const data = await res.json();

    const daily = data.daily || {};
    const amounts = daily.precipitation_sum || [];

    // amounts is an array of 30 daily totals (inches).
    const n = amounts.length;

    let last30 = safeSum(amounts);
    let last7 = 0;
    if (n >= 7) {
      const last7Slice = amounts.slice(n - 7);
      last7 = safeSum(last7Slice);
    } else {
      last7 = safeSum(amounts);
    }

    return {
      raw: data,
      rain7dInches: last7,
      rain30dInches: last30
    };
  }

  /* ==========================
     Render card
     ========================== */

  function renderWeatherCard(container, combined, config) {
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

    // Rain amounts
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

    container.innerHTML = `
      <section class="fv-weather-card">
        <div class="fv-weather-head">
          <div>
            <div class="fv-weather-title">Weather</div>
            <div class="fv-weather-meta">
              ${timeZone ? `<span>${timeZone}</span>` : ""}
              ${
                updatedLocal
                  ? `<span>• Updated ${new Date(updatedLocal).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit"
                    })}</span>`
                  : ""
              }
            </div>
          </div>
          <button class="fv-weather-refresh" type="button" aria-label="Refresh weather">
            ⟳
          </button>
        </div>

        <div class="fv-weather-body">
          <div class="fv-weather-main">
            <div class="fv-weather-temp-block">
              <div class="fv-weather-temp">${tempStr}</div>
              <div class="fv-weather-desc">${desc}</div>
              <div class="fv-weather-feels">Feels like <strong>${feelsStr}</strong></div>
              <div class="fv-weather-humidity">
                Humidity: <strong>${humidStr}</strong> • Wind: <strong>${windStr}</strong>
              </div>
            </div>
            <div class="fv-weather-icon-block">
              ${
                iconUrl
                  ? `<img src="${iconUrl}" alt="${desc}" class="fv-weather-icon" loading="lazy">`
                  : ""
              }
            </div>
          </div>

          <div class="fv-weather-rain-row">
            <div class="fv-weather-rain-pill">
              <span class="fv-weather-label">Rain last 24h (Google)</span>
              <span class="fv-weather-value">${rain24}</span>
            </div>
            <div class="fv-weather-rain-pill">
              <span class="fv-weather-label">Rain last 7 days (Open-Meteo)</span>
              <span class="fv-weather-value">${rain7}</span>
            </div>
            <div class="fv-weather-rain-pill">
              <span class="fv-weather-label">Rain last 30 days (Open-Meteo)</span>
              <span class="fv-weather-value">${rain30}</span>
            </div>
          </div>
        </div>
      </section>
    `;

    const btn = container.querySelector(".fv-weather-refresh");
    if (btn) {
      btn.addEventListener("click", () => {
        initWeatherModule(config);
      });
    }
  }

  /* ==========================
     Orchestration
     ========================== */

  async function initWeatherModule(options = {}) {
    const config = { ...DEFAULT_CONFIG, ...options };
    const container = getContainer(config.selector);
    if (!container) return;

    if (!config.googleApiKey) {
      renderError(container, "Missing Google Weather API key.");
      console.error("[FVWeather] No googleApiKey provided.");
      return;
    }

    renderLoading(container);

    // Fire off all requests in parallel; tolerate partial failures.
    const promises = {
      googleCurrent: fetchGoogleCurrent(config),
      googleHistory: fetchGoogleHistory24(config),
      openMeteo: config.showOpenMeteo ? fetchOpenMeteoRain(config) : Promise.resolve(null)
    };

    try {
      const results = await Promise.allSettled([
        promises.googleCurrent,
        promises.googleHistory,
        promises.openMeteo
      ]);

      const [curRes, histRes, omRes] = results;

      const combined = {
        googleCurrent:
          curRes.status === "fulfilled" ? curRes.value : null,
        googleHistory:
          histRes.status === "fulfilled" ? histRes.value : null,
        openMeteo:
          omRes.status === "fulfilled" ? omRes.value : null
      };

      if (!combined.googleCurrent && !combined.googleHistory) {
        // If both Google calls failed, bail.
        throw new Error("All Google Weather calls failed.");
      }

      renderWeatherCard(container, combined, config);
    } catch (err) {
      console.error("[FVWeather] Failed to load combined weather:", err);
      renderError(container, err.message || "Unknown error.");
    }
  }

  // Expose a single global for your dashboard
  window.FVWeather = {
    initWeatherModule
  };
})();