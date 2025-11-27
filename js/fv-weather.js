/* =======================================================================
// /Farm-vista/js/fv-weather.js
// Rev: 2025-11-27d
//
// FarmVista Weather module
// - Google Maps Weather API (currentConditions + history.hours)
// - Open-Meteo (7-day & 30-day rainfall + 7-day forecast)
//
// Card above dashboard:
//   • Current conditions
//   • Last 24h rain
//   • Last 7d, 30d rain
//
// Modal popup:
//   • Current conditions (detailed)
//   • 5-day forecast (high/low, rain, chance)
//   • 7-day rainfall chart
//
// ======================================================================= */

(() => {
  const GOOGLE_CURRENT_URL =
    "https://weather.googleapis.com/v1/currentConditions:lookup";
  const GOOGLE_HISTORY_URL =
    "https://weather.googleapis.com/v1/history/hours:lookup";
  const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";

  const DEFAULT_CONFIG = {
    googleApiKey: "",
    // Divernon, IL (approx)
    lat: 39.5656,
    lon: -89.6573,
    unitsSystem: "IMPERIAL",
    selector: "#fv-weather",
    showOpenMeteo: true,
    mode: "card",          // "card" | "modal"
    locationLabel: "Divernon, Illinois"
  };

  /* ---------- helpers ---------- */

  function getContainer(selector) {
    const el = document.querySelector(selector);
    if (!el) console.warn("[FVWeather] Container not found:", selector);
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

  function renderError(container, message, debugLines = []) {
    if (!container) return;
    const extra =
      Array.isArray(debugLines) && debugLines.length
        ? `<div class="fv-weather-error-debug" style="margin-top:6px;font-size:11px;color:#9b1c1c;white-space:pre-wrap;">
             ${debugLines.map(line => line.replace(/</g,"&lt;")).join("\n")}
           </div>`
        : "";

    container.innerHTML = `
      <section class="fv-weather-card fv-weather-error">
        <div class="fv-weather-head">
          <div>
            <div class="fv-weather-title">Weather</div>
            <div class="fv-weather-meta">Unavailable</div>
          </div>
        </div>
        <div class="fv-weather-body">
          <p class="fv-weather-error-text" style="font-size:13px;">
            Couldn’t load weather data. ${message || "Try again in a bit."}
          </p>
          ${extra}
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

  function reasonToText(label, reason) {
    if (!reason) return `${label}: unknown error`;
    if (reason instanceof Error) return `${label}: ${reason.message}`;
    try { return `${label}: ${String(reason)}`; }
    catch { return `${label}: [unprintable error]`; }
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

  /* ---------- fetch: Google current ---------- */

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
      throw new Error(`currentConditions HTTP ${res.status} (${res.statusText || "error"})`);
    }
    const data = await res.json();
    const current =
      Array.isArray(data.currentConditions) && data.currentConditions.length > 0
        ? data.currentConditions[0]
        : data.currentConditions || data;

    return { raw: data, current };
  }

  /* ---------- fetch: Google 24h history ---------- */

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
      throw new Error(`history.hours HTTP ${res.status} (${res.statusText || "error"})`);
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

  /* ---------- fetch: Open-Meteo rain history (30d) ---------- */

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
      throw new Error(`Open-Meteo rain HTTP ${res.status} (${res.statusText || "error"})`);
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
      last7: {
        dates: last7Dates,
        amounts: last7Amounts
      }
    };
  }

  /* ---------- fetch: Open-Meteo forecast (7d) ---------- */

  async function fetchOpenMeteoForecast(config) {
    const params = new URLSearchParams({
      latitude: String(config.lat),
      longitude: String(config.lon),
      daily: "temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_mean",
      forecast_days: "7",
      timezone: "auto",
      precipitation_unit: "inch"
    });

    const url = `${OPEN_METEO_URL}?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Open-Meteo forecast HTTP ${res.status} (${res.statusText || "error"})`);
    }
    const data = await res.json();
    const daily = data.daily || {};
    const times = daily.time || [];
    const tMax = daily.temperature_2m_max || [];
    const tMin = daily.temperature_2m_min || [];
    const precip = daily.precipitation_sum || [];
    const prob = daily.precipitation_probability_mean || [];

    const days = [];
    for (let i = 0; i < times.length; i++) {
      days.push({
        date: times[i],
        tMax: typeof tMax[i] === "number" ? tMax[i] : null,
        tMin: typeof tMin[i] === "number" ? tMin[i] : null,
        precipIn: typeof precip[i] === "number" ? precip[i] : 0,
        precipProb: typeof prob[i] === "number" ? prob[i] : null
      });
    }

    return { raw: data, days };
  }

  /* ---------- render: compact card (dashboard strip) ---------- */

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
            <div class="fv-weather-title">Weather · ${config.locationLabel || ""}</div>
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
              <span class="fv-weather-label">Rain last 24 hours</span>
              <span class="fv-weather-value">${rain24}</span>
            </div>
            <div class="fv-weather-rain-pill">
              <span class="fv-weather-label">Rain last 7 days</span>
              <span class="fv-weather-value">${rain7}</span>
            </div>
            <div class="fv-weather-rain-pill">
              <span class="fv-weather-label">Rain last 30 days</span>
              <span class="fv-weather-value">${rain30}</span>
            </div>
          </div>
        </div>
      </section>
    `;

    const btn = container.querySelector(".fv-weather-refresh");
    if (btn) {
      btn.addEventListener("click", () => {
        initWeatherModule({ ...config }); // re-use same config
      });
    }
  }

  /* ---------- render: modal (detailed) ---------- */

  function renderWeatherModal(container, combined, config) {
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
      ? `
      <div class="fv-rain-chart">
        ${seriesDates
          .map((d, idx) => {
            const val = seriesAmounts[idx] || 0;
            const pct = Math.max(5, (val / maxAmt) * 100); // never tiny sliver
            return `
              <div class="fv-rain-row">
                <div class="fv-rain-label">${fmtDayShort(d)}</div>
                <div class="fv-rain-bar-wrap">
                  <div class="fv-rain-bar" style="width:${pct}%;"></div>
                </div>
                <div class="fv-rain-value">${roundTo2(val)}"</div>
              </div>
            `;
          })
          .join("")}
      </div>
    `
      : `<div class="fv-rain-chart-empty">No recent rainfall data.</div>`;

    const forecastDays = (forecast.days || []).slice(0, 5);
    const forecastHtml = forecastDays.length
      ? `
      <div class="fv-forecast-list">
        ${forecastDays
          .map(day => {
            const hi = day.tMax != null ? `${Math.round(day.tMax)}°` : "—";
            const lo = day.tMin != null ? `${Math.round(day.tMin)}°` : "—";
            const rainIn = day.precipIn != null ? `${roundTo2(day.precipIn)}"` : "—";
            const prob = day.precipProb != null ? `${Math.round(day.precipProb)}%` : "—";
            return `
              <div class="fv-forecast-row">
                <div class="fv-forecast-day">
                  <div class="fv-forecast-dow">${fmtDayShort(day.date)}</div>
                  <div class="fv-forecast-date">${fmtMD(day.date)}</div>
                </div>
                <div class="fv-forecast-temps">
                  <span class="hi">${hi}</span>
                  <span class="lo">${lo}</span>
                </div>
                <div class="fv-forecast-rain">
                  <span class="amt">${rainIn}</span>
                  <span class="prob">${prob}</span>
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
    `
      : `<div class="fv-forecast-empty">Forecast data not available.</div>`;

    container.innerHTML = `
      <section class="fv-weather-card fv-weather-modal-card">
        <header class="fv-weather-modal-head">
          <div>
            <div class="fv-weather-title">Weather · ${config.locationLabel || ""}</div>
            <div class="fv-weather-meta">
              Detailed conditions, 5-day outlook, and rain history.
            </div>
          </div>
        </header>

        <div class="fv-weather-modal-body-inner">
          <section class="fv-weather-modal-section fv-weather-current">
            <div class="fv-weather-main">
              <div class="fv-weather-temp-block">
                <div class="fv-weather-temp">${tempStr}</div>
                <div class="fv-weather-desc">${desc}</div>
                <div class="fv-weather-feels">Feels like <strong>${feelsStr}</strong></div>
                <div class="fv-weather-humidity">
                  Humidity: <strong>${humidStr}</strong> • Wind: <strong>${windStr}</strong>
                </div>
                <div class="fv-weather-rain-summary">
                  Rain last 24h: <strong>${rain24}</strong> ·
                  7 days: <strong>${rain7}</strong> ·
                  30 days: <strong>${rain30}</strong>
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
          </section>

          <section class="fv-weather-modal-section fv-weather-forecast">
            <h3 class="fv-weather-modal-subtitle">Next 5 days</h3>
            ${forecastHtml}
          </section>

          <section class="fv-weather-modal-section fv-weather-rain-history">
            <h3 class="fv-weather-modal-subtitle">Rainfall – last 7 days</h3>
            ${rainChartHtml}
          </section>
        </div>
      </section>
    `;
  }

  /* ---------- orchestration ---------- */

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
      renderError(container, err.message || "Unexpected error.");
      return;
    }

    const [curRes, histRes, rainRes, fcRes] = results;

    const combined = {
      googleCurrent: curRes.status === "fulfilled" ? curRes.value : null,
      googleHistory: histRes.status === "fulfilled" ? histRes.value : null,
      openMeteo: rainRes.status === "fulfilled" ? rainRes.value : null,
      openForecast: fcRes.status === "fulfilled" ? fcRes.value : null
    };

    const debugLines = [];
    if (curRes.status === "rejected") {
      console.warn("[FVWeather] Google currentConditions failed:", curRes.reason);
      debugLines.push(reasonToText("Google currentConditions", curRes.reason));
    }
    if (histRes.status === "rejected") {
      console.warn("[FVWeather] Google history.hours failed:", histRes.reason);
      debugLines.push(reasonToText("Google history.hours", histRes.reason));
    }
    if (rainRes.status === "rejected") {
      console.warn("[FVWeather] Open-Meteo rainfall failed:", rainRes.reason);
      debugLines.push(reasonToText("Open-Meteo rain", rainRes.reason));
    }
    if (fcRes.status === "rejected") {
      console.warn("[FVWeather] Open-Meteo forecast failed:", fcRes.reason);
      debugLines.push(reasonToText("Open-Meteo forecast", fcRes.reason));
    }

    if (!combined.googleCurrent && !combined.googleHistory) {
      renderError(container, "All Google Weather calls failed.", debugLines);
      return;
    }

    if (mode === "modal") {
      renderWeatherModal(container, combined, config);
    } else {
      renderWeatherCard(container, combined, config);
    }
  }

  window.FVWeather = { initWeatherModule };
})();