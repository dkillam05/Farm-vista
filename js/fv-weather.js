/* =======================================================================
// /Farm-vista/js/fv-weather.js
// Rev: 2025-12-22a (Visual Crossing upgrade + optional Rain Map button)
//
// FarmVista Weather module
// ✅ Primary data source: Visual Crossing Timeline API
// ✅ Keeps your existing card + modal UI/UX (same structure)
// ✅ Computes:
//    - Rain last 24h (sum hourly precip)
//    - Rain last 7d / 30d (sum daily precip)
//    - Next 5 days (today-first) with click-for-details
// ✅ Optional: adds a “Rain Map” button in the modal that dispatches an event:
//      document.dispatchEvent(new CustomEvent("fv:open-rain-map", {detail:{lat,lon,label}}))
//
// Back-compat:
//  - If you still pass googleApiKey (old config), this file will treat it as
//    visualCrossingKey ONLY if visualCrossingKey is missing.
//  - NOTE: This revision does NOT call Google Weather or Open-Meteo.
// ======================================================================= */

(() => {
  // Visual Crossing Timeline API
  // Docs: /rest/services/timeline/{location}/{start}/{end}?unitGroup=us&contentType=json&key=...
  const VC_TIMELINE_URL = "https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline";

  const DEFAULT_CONFIG = {
    // NEW: Visual Crossing API key
    visualCrossingKey: "",

    // Back-compat: your dashboard currently passes googleApiKey
    // We’ll treat googleApiKey as VC key if visualCrossingKey not provided.
    googleApiKey: "",

    // Divernon, IL (approx)
    lat: 39.5656,
    lon: -89.6573,

    selector: "#fv-weather",
    mode: "card", // "card" | "modal"
    locationLabel: "Divernon, Illinois",

    // Optional: show “Rain Map” button inside modal
    showRainMapButton: true,

    // How far to pull:
    pastDaysForTotals: 30,     // for 30-day rainfall
    forecastDays: 7            // for forecast list (we use next 5)
  };

  /* ==========================
     Helpers
     ========================== */

  function getContainer(selector) {
    const el = document.querySelector(selector);
    if (!el) console.warn("[FVWeather] Container not found:", selector);
    return el;
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

  function roundTo2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
  }

  function safeSum(arr) {
    return (arr || []).reduce((sum, v) => sum + (Number.isFinite(Number(v)) ? Number(v) : 0), 0);
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

  function formatTempF(n) {
    if (!Number.isFinite(Number(n))) return "—";
    return `${Math.round(Number(n))}°F`;
  }

  function formatHumidity(value) {
    if (!Number.isFinite(Number(value))) return "—";
    return `${Math.round(Number(value))}%`;
  }

  function formatWindMph(speed, dirDeg) {
    if (!Number.isFinite(Number(speed))) return "—";
    const s = Math.round(Number(speed));
    const deg = Number(dirDeg);
    const card = Number.isFinite(deg) ? degToCardinal(deg) : "";
    return card ? `${s} mph ${card}` : `${s} mph`;
  }

  function degToCardinal(deg) {
    const d = ((deg % 360) + 360) % 360;
    const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
    const idx = Math.round(d / 22.5) % 16;
    return dirs[idx];
  }

  // Visual Crossing icon -> simple inline SVG (keeps things clean, no external deps)
  function iconSvgForVC(icon) {
    const k = (icon || "").toString().toLowerCase();
    const stroke = "currentColor";
    const fill = "none";

    // small, subtle line icons
    const wrap = (inner) => `
      <svg viewBox="0 0 24 24" width="48" height="48" aria-hidden="true"
        style="display:block;color:var(--muted,#67706B)">
        ${inner}
      </svg>
    `;

    if (k.includes("snow")) {
      return wrap(`
        <path d="M8 7h8" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round"/>
        <path d="M7 11h10" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round"/>
        <path d="M8 15h8" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round"/>
        <path d="M9 18l-1 2" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round"/>
        <path d="M12 18v2" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round"/>
        <path d="M15 18l1 2" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round"/>
      `);
    }

    if (k.includes("rain") || k.includes("showers")) {
      return wrap(`
        <path d="M8 16c-2.2 0-4-1.6-4-3.6C4 10.6 5.6 9.2 7.6 9c.6-2 2.4-3.4 4.6-3.4
                 2.6 0 4.8 2 5 4.6 1.6.3 2.8 1.7 2.8 3.4 0 1.9-1.7 3.6-3.8 3.6H8z"
              stroke="${stroke}" stroke-width="1.6" fill="${fill}" stroke-linejoin="round"/>
        <path d="M9 18l-1 2" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round"/>
        <path d="M12 18l-1 2" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round"/>
        <path d="M15 18l-1 2" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round"/>
      `);
    }

    if (k.includes("cloud")) {
      return wrap(`
        <path d="M8 16c-2.2 0-4-1.6-4-3.6C4 10.6 5.6 9.2 7.6 9c.6-2 2.4-3.4 4.6-3.4
                 2.6 0 4.8 2 5 4.6 1.6.3 2.8 1.7 2.8 3.4 0 1.9-1.7 3.6-3.8 3.6H8z"
              stroke="${stroke}" stroke-width="1.6" fill="${fill}" stroke-linejoin="round"/>
      `);
    }

    // default: sun / clear-day
    return wrap(`
      <path d="M12 18a6 6 0 1 0 0-12a6 6 0 0 0 0 12z" stroke="${stroke}" stroke-width="1.6" fill="${fill}"/>
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M19.8 4.2l-1.4 1.4M5.6 18.4l-1.4 1.4"
            stroke="${stroke}" stroke-width="1.6" stroke-linecap="round"/>
    `);
  }

  // Classify a day into Sunny / Cloudy / Rain / Snow and compute snow range text.
  function classifyDay(day) {
    const hi = day.tMax;
    const precip = day.precipIn || 0;
    const clouds = day.cloudCover != null ? day.cloudCover : 0;

    let type = "Unknown";
    if (precip >= 0.05 && Number(hi) <= 34) type = "Snow";
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

  function yyyyMmDdLocal(d) {
    const dt = new Date(d);
    dt.setHours(0, 0, 0, 0);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const day = String(dt.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  /* ==========================
     Visual Crossing fetch + normalize
     ========================== */

  async function fetchVisualCrossingTimeline(config) {
    const key = (config.visualCrossingKey || config.googleApiKey || "").toString().trim();
    if (!key) throw new Error("Missing Visual Crossing API key.");

    const loc = `${config.lat},${config.lon}`;

    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - Number(config.pastDaysForTotals || 30));
    const end = new Date(now);
    end.setDate(end.getDate() + Number(config.forecastDays || 7));

    const startStr = yyyyMmDdLocal(start);
    const endStr = yyyyMmDdLocal(end);

    const params = new URLSearchParams({
      key,
      unitGroup: "us",
      contentType: "json",
      include: "hours,days,current,alerts"
    });

    const url = `${VC_TIMELINE_URL}/${encodeURIComponent(loc)}/${startStr}/${endStr}?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`VisualCrossing HTTP ${res.status}`);

    const data = await res.json();

    // Normalize into your existing combined structure
    const current = data.currentConditions || {};
    const days = Array.isArray(data.days) ? data.days : [];

    // find "today" day bucket
    const today0 = new Date(); today0.setHours(0,0,0,0);
    const idxToday = days.findIndex(d => {
      const dt = new Date(d.datetime || d.datetimeStr || d.datetimeEpoch * 1000);
      dt.setHours(0,0,0,0);
      return dt.getTime() === today0.getTime();
    });
    const todayDay = idxToday >= 0 ? days[idxToday] : (days.length ? days[days.length - 1] : null);

    // Rain last 24h: sum hourly precip from the most recent 24 hours we can find
    // Best case: use today.hours + yesterday.hours tail.
    let rain24h = null;
    try {
      const hours = [];

      // Pull from today and yesterday buckets if present
      const todayBucket = idxToday >= 0 ? days[idxToday] : null;
      const yBucket = (idxToday > 0) ? days[idxToday - 1] : null;

      const pushHours = (bucket) => {
        if (!bucket || !Array.isArray(bucket.hours)) return;
        bucket.hours.forEach(h => {
          // VC hour has datetime / datetimeEpoch and precip
          const epochMs = Number(h.datetimeEpoch) ? Number(h.datetimeEpoch) * 1000 : null;
          hours.push({
            t: epochMs || Date.parse(`${bucket.datetime}T${(h.datetime || "00:00:00").slice(0,8)}`),
            precip: Number(h.precip) || 0
          });
        });
      };

      pushHours(yBucket);
      pushHours(todayBucket);

      hours.sort((a,b)=> (a.t||0) - (b.t||0));

      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      const last24 = hours.filter(h => Number.isFinite(h.t) && h.t >= cutoff);
      if (last24.length) rain24h = safeSum(last24.map(h => h.precip));
      else if (Number.isFinite(Number(current.precip))) rain24h = Number(current.precip); // fallback
      else rain24h = 0;
    } catch {
      rain24h = 0;
    }

    // Rain last 7d/30d from daily precip
    const dailyPrecip = days.map(d => Number(d.precip) || 0);
    const dailyDates = days.map(d => {
      // VC day datetime is "YYYY-MM-DD"
      return d.datetime || "";
    });

    // Use most recent slices ending today (if found) else end of array
    const endIdx = (idxToday >= 0) ? idxToday : (days.length - 1);

    const sliceLast = (n) => {
      const startIdx = Math.max(0, endIdx - (n - 1));
      return {
        amounts: dailyPrecip.slice(startIdx, endIdx + 1),
        dates: dailyDates.slice(startIdx, endIdx + 1)
      };
    };

    const last7 = sliceLast(7);
    const last30 = sliceLast(30);

    const openRain = {
      rain7dInches: safeSum(last7.amounts),
      rain30dInches: safeSum(last30.amounts),
      last7: { dates: last7.dates, amounts: last7.amounts }
    };

    // Forecast days (we’ll map into your existing day objects)
    const openForecast = {
      days: days.map(d => ({
        date: d.datetime || "",
        tMax: Number.isFinite(Number(d.tempmax)) ? Number(d.tempmax) : null,
        tMin: Number.isFinite(Number(d.tempmin)) ? Number(d.tempmin) : null,
        precipIn: Number.isFinite(Number(d.precip)) ? Number(d.precip) : 0,
        precipProb: Number.isFinite(Number(d.precipprob)) ? Number(d.precipprob) : null,
        cloudCover: Number.isFinite(Number(d.cloudcover)) ? Number(d.cloudcover) : null,
        windSpeedMax: Number.isFinite(Number(d.windspeed)) ? Number(d.windspeed) : null,
        windDirDeg: Number.isFinite(Number(d.winddir)) ? Number(d.winddir) : null,
        sunrise: d.sunrise ? `${d.datetime}T${d.sunrise}` : "",
        sunset: d.sunset ? `${d.datetime}T${d.sunset}` : ""
      }))
    };

    const googleCurrentLike = {
      // mimic previous structure enough for renderer
      current: {
        temperature: { degrees: Number(current.temp), unit: "FAHRENHEIT" },
        feelsLikeTemperature: { degrees: Number(current.feelslike), unit: "FAHRENHEIT" },
        relativeHumidity: Number(current.humidity),
        wind: {
          speed: { value: Number(current.windspeed) },
          direction: { cardinal: degToCardinal(Number(current.winddir) || 0) }
        },
        weatherCondition: {
          // store VC icon string; our renderer uses iconSvgForVC()
          type: (current.conditions || "").toString(),
          description: { text: (current.conditions || "").toString() },
          vcIcon: (current.icon || "").toString()
        },
        currentTime: current.datetimeEpoch ? new Date(Number(current.datetimeEpoch) * 1000).toISOString() : ""
      },
      raw: data
    };

    const googleHistoryLike = {
      raw: data,
      rain24hInches: Number(rain24h) || 0
    };

    return {
      googleCurrent: googleCurrentLike,
      googleHistory: googleHistoryLike,
      openMeteo: openRain,
      openForecast
    };
  }

  /* ==========================
     Render – card
     ========================== */

  function renderCard(container, combined, config) {
    if (!container) return;

    const current = combined.googleCurrent?.current || {};
    const dataRaw = combined.googleCurrent?.raw || {};
    const history24 = combined.googleHistory || {};
    const openRain = combined.openMeteo || {};

    const condition = current.weatherCondition || {};
    const vcIcon = condition.vcIcon || "";
    const desc =
      (condition.description && condition.description.text) ||
      condition.type ||
      "Current conditions";

    const tempStr = current.temperature ? formatTempF(current.temperature.degrees) : "—";
    const feelsStr = current.feelsLikeTemperature ? formatTempF(current.feelsLikeTemperature.degrees) : "—";
    const humidStr = formatHumidity(current.relativeHumidity);

    // wind (mph + cardinal)
    const windSpeed = current.wind && current.wind.speed ? current.wind.speed.value : null;
    const windDirCard = current.wind && current.wind.direction ? current.wind.direction.cardinal : "";
    const windStr = (Number.isFinite(Number(windSpeed)))
      ? `${Math.round(Number(windSpeed))} mph${windDirCard ? ` ${windDirCard}` : ""}`
      : "—";

    const tz = (dataRaw.timezone || "").toString();
    const updatedIso = current.currentTime || "";
    const updatedLabel = updatedIso
      ? `• Updated ${new Date(updatedIso).toLocaleTimeString([], { hour:"numeric", minute:"2-digit" })}`
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
            <div style="font-size:11px;color:var(--muted,#67706B);display:flex;flex-wrap:wrap;gap:6px;">
              ${tz ? `<span>${tz}</span>` : ""}
              ${updatedLabel ? `<span>${updatedLabel}</span>` : ""}
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
            ${iconSvgForVC(vcIcon)}
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
      </section>
    `;

    const btn = container.querySelector(".fv-weather-refresh");
    if (btn) {
      btn.addEventListener("click", (evt) => {
        evt.stopPropagation(); // don’t open modal when hitting refresh
        initWeatherModule({ ...config });
      });
    }
  }

  /* ==========================
     Render – modal
     ========================== */

  function renderModal(container, combined, config) {
    if (!container) return;

    const current = combined.googleCurrent?.current || {};
    const dataRaw = combined.googleCurrent?.raw || {};
    const history24 = combined.googleHistory || {};
    const openRain = combined.openMeteo || {};
    const forecast = combined.openForecast || {};

    const condition = current.weatherCondition || {};
    const vcIcon = condition.vcIcon || "";
    const desc =
      (condition.description && condition.description.text) ||
      condition.type ||
      "Current conditions";

    const tempStr = current.temperature ? formatTempF(current.temperature.degrees) : "—";
    const feelsStr = current.feelsLikeTemperature ? formatTempF(current.feelsLikeTemperature.degrees) : "—";
    const humidStr = formatHumidity(current.relativeHumidity);

    const windSpeed = current.wind && current.wind.speed ? current.wind.speed.value : null;
    const windDirCard = current.wind && current.wind.direction ? current.wind.direction.cardinal : "";
    const windStr = (Number.isFinite(Number(windSpeed)))
      ? `${Math.round(Number(windSpeed))} mph${windDirCard ? ` ${windDirCard}` : ""}`
      : "—";

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
      dt.setHours(0,0,0,0);
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

    const forecastHtml = `
      <div class="fv-forecast-list">
        ${forecastRowsHtml}
      </div>
      <div class="fv-forecast-detail" style="
        margin-top:8px;padding-top:6px;border-top:1px solid rgba(148,163,184,0.25);
        font-size:12px;color:var(--muted,#67706B);
      "></div>
    `;

    const tz = (dataRaw.timezone || "").toString();

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
              <div class="fv-weather-meta" style="font-size:11px;color:var(--muted,#67706B);">
                ${tz ? `${tz} · ` : ""}Detailed conditions, 5-day outlook, and rain history.
              </div>
            </div>

            ${
              config.showRainMapButton
                ? `<button type="button" class="fv-weather-rainmap" style="
                    border-radius:999px;
                    border:1px solid var(--border);
                    background:#3B7E46;
                    color:#fff !important;
                    padding:8px 12px;
                    font-size:12px;
                    cursor:pointer;
                    white-space:nowrap;
                  " aria-label="Open rainfall map">
                    Rain Map
                  </button>`
                : ``
            }
          </div>
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
                ${iconSvgForVC(vcIcon).replace('width="48" height="48"', 'width="60" height="60"')}
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

    // Rain map button -> dispatch event (dashboard decides how to show map)
    const mapBtn = container.querySelector(".fv-weather-rainmap");
    if (mapBtn) {
      mapBtn.addEventListener("click", () => {
        document.dispatchEvent(new CustomEvent("fv:open-rain-map", {
          detail: {
            lat: config.lat,
            lon: config.lon,
            label: config.locationLabel || ""
          }
        }));
      });
    }

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
    const config = { ...DEFAULT_CONFIG, ...options };
    const container = getContainer(config.selector);
    if (!container) return;

    // Key resolution: prefer visualCrossingKey, else accept googleApiKey as alias
    const key = (config.visualCrossingKey || config.googleApiKey || "").toString().trim();
    if (!key) {
      renderError(container, "Missing Visual Crossing API key.");
      console.error("[FVWeather] No visualCrossingKey (or googleApiKey alias) provided.");
      return;
    }

    renderLoading(container);

    let combined;
    try {
      combined = await fetchVisualCrossingTimeline({
        ...config,
        visualCrossingKey: key
      });
    } catch (err) {
      console.warn("[FVWeather] Visual Crossing fetch failed:", err);
      renderError(container, "Weather service error.");
      return;
    }

    const mode = config.mode || "card";
    if (mode === "modal") renderModal(container, combined, config);
    else renderCard(container, combined, config);
  }

  window.FVWeather = { initWeatherModule };
})();
