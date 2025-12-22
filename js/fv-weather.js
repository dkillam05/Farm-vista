/* =======================================================================
// /Farm-vista/js/fv-weather.js
// Rev: 2025-12-22c (Open-Meteo Proxy version)
//
// FarmVista Weather module (Dashboard card + Modal)
// ✅ Uses your Cloud Run proxy:
//    GET {weatherEndpoint}/api/open-meteo?lat=..&lng=..&days=30&timezone=America/Chicago
// ✅ Reads:
//    json.normalized.hourly (back-compat core)
//    json.normalized.hourly_ext
//    json.normalized.daily
// ✅ Computes:
//    - "Current" from most recent hourly sample <= now
//    - Rain last 24h / 7d / 30d from hourly precipitation
//    - 7-day rain bar chart (daily sums derived from hourly)
//    - Next 5 days (today-first) using normalized.daily (fallback to fewer days if backend only returns 3 forecast days)
//
// Optional:
// ✅ “Rain Map” button dispatches:
//    document.dispatchEvent(new CustomEvent("fv:open-rain-map",{detail:{lat,lon,label}}))
//
// IMPORTANT:
// - This file does NOT use Google Weather or Open-Meteo direct.
// - It expects your proxy payload structure from /index.js rev 2025-12-22b.
// ======================================================================= */

(() => {
  const DEFAULT_CONFIG = {
    // REQUIRED: base URL of your Cloud Run service (no trailing slash preferred)
    // Example: "https://farmvista-field-weather-xxxxx-uc.a.run.app"
    weatherEndpoint: "",

    // Divernon, IL (approx)
    lat: 39.5656,
    lon: -89.6573,

    selector: "#fv-weather",
    mode: "card", // "card" | "modal"
    locationLabel: "Divernon, Illinois",

    showRainMapButton: true,

    // history window request to proxy (clamped server-side 1..90)
    days: 30,

    timezone: "America/Chicago"
  };

  // Unit conversion
  const MM_PER_IN = 25.4;
  const C_TO_F = (c) => (Number(c) * 9/5) + 32;

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

  function formatTempF(valC) {
    const c = Number(valC);
    if (!Number.isFinite(c)) return "—";
    const f = C_TO_F(c);
    return `${Math.round(f)}°F`;
  }

  function formatHumidity(value) {
    const v = Number(value);
    if (!Number.isFinite(v)) return "—";
    return `${Math.round(v)}%`;
  }

  function safeArr(a) {
    return Array.isArray(a) ? a : [];
  }

  function dateOnly(isoLike) {
    if (!isoLike) return "";
    // Open-Meteo uses "YYYY-MM-DDTHH:MM" for hourly, and "YYYY-MM-DD" for daily
    return isoLike.slice(0, 10);
  }

  function pickMostRecentHour(hourlyCore, hourlyExt) {
    // Pick the most recent sample with time <= now
    const now = Date.now();
    let best = null;

    for (let i = 0; i < hourlyCore.length; i++) {
      const t = hourlyCore[i]?.time;
      if (!t) continue;
      const ms = Date.parse(t);
      if (!Number.isFinite(ms)) continue;
      if (ms <= now) best = { i, ms };
    }

    if (!best) {
      // fallback to last element
      const i = hourlyCore.length - 1;
      return { i, core: hourlyCore[i] || null, ext: hourlyExt[i] || null, ms: null };
    }

    return { i: best.i, core: hourlyCore[best.i] || null, ext: hourlyExt[best.i] || null, ms: best.ms };
  }

  function computeRainSums(hourlyCore) {
    // Returns inches for last 24h / 7d / 30d based on hourlyCore.rain_mm
    const now = Date.now();

    let mm24 = 0, mm7 = 0, mm30 = 0;

    for (const h of hourlyCore) {
      const t = h?.time;
      if (!t) continue;
      const ms = Date.parse(t);
      if (!Number.isFinite(ms)) continue;

      const mm = Number(h?.rain_mm);
      const rain = Number.isFinite(mm) ? mm : 0;

      const age = now - ms;
      if (age <= 24 * 60 * 60 * 1000) mm24 += rain;
      if (age <= 7 * 24 * 60 * 60 * 1000) mm7 += rain;
      if (age <= 30 * 24 * 60 * 60 * 1000) mm30 += rain;
    }

    return {
      in24: mm24 / MM_PER_IN,
      in7: mm7 / MM_PER_IN,
      in30: mm30 / MM_PER_IN
    };
  }

  function computeDailyRainFromHourly(hourlyCore, daysBack = 7) {
    // Builds last N daily totals ending today, from hourly precip
    // Returns: { dates:[YYYY-MM-DD], amountsIn:[inches] }
    const byDate = new Map();
    for (const h of hourlyCore) {
      const t = h?.time;
      if (!t) continue;
      const d = dateOnly(t);
      if (!d) continue;
      const mm = Number(h?.rain_mm);
      const rain = Number.isFinite(mm) ? mm : 0;
      byDate.set(d, (byDate.get(d) || 0) + rain);
    }

    // Determine today date in local time (best effort)
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    const todayStr = `${y}-${m}-${dd}`;

    const outDates = [];
    const outAmounts = [];

    for (let k = daysBack - 1; k >= 0; k--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - k);
      const yy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const ds = `${yy}-${mm}-${day}`;

      const mmSum = byDate.get(ds) || 0;
      outDates.push(ds);
      outAmounts.push(mmSum / MM_PER_IN);
    }

    // Ensure today is included even if timezone parsing oddities occur
    if (!outDates.includes(todayStr)) {
      outDates.push(todayStr);
      outAmounts.push((byDate.get(todayStr) || 0) / MM_PER_IN);
    }

    // Trim to exactly daysBack
    const start = Math.max(0, outDates.length - daysBack);
    return { dates: outDates.slice(start), amounts: outAmounts.slice(start) };
  }

  function classifyNow(core, ext) {
    const rainMm = Number(core?.rain_mm) || 0;
    const cloud = Number(ext?.cloud_cover_pct);
    const t = Number(core?.temp_c);

    let type = "Current conditions";
    let icon = "clear";

    if (rainMm >= 1.0) { type = "Rain"; icon = "rain"; }
    else if (rainMm >= 0.2) { type = "Light rain"; icon = "rain"; }
    else if (Number.isFinite(cloud)) {
      if (cloud >= 70) { type = "Cloudy"; icon = "cloud"; }
      else if (cloud >= 35) { type = "Partly cloudy"; icon = "cloud"; }
      else { type = "Clear"; icon = "clear"; }
    } else {
      type = "Clear";
      icon = "clear";
    }

    // crude snow hint if temp near freezing and precip
    if (rainMm >= 0.2 && Number.isFinite(t) && t <= 0.5) {
      type = "Snow";
      icon = "snow";
    }

    return { type, icon };
  }

  function iconSvg(iconKey, size = 48) {
    const stroke = "currentColor";
    const fill = "none";

    const wrap = (inner) => `
      <svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"
        style="display:block;color:var(--muted,#67706B)">
        ${inner}
      </svg>
    `;

    if (iconKey === "snow") {
      return wrap(`
        <path d="M8 7h8" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round"/>
        <path d="M7 11h10" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round"/>
        <path d="M8 15h8" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round"/>
        <path d="M9 18l-1 2" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round"/>
        <path d="M12 18v2" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round"/>
        <path d="M15 18l1 2" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round"/>
      `);
    }

    if (iconKey === "rain") {
      return wrap(`
        <path d="M8 16c-2.2 0-4-1.6-4-3.6C4 10.6 5.6 9.2 7.6 9c.6-2 2.4-3.4 4.6-3.4
                 2.6 0 4.8 2 5 4.6 1.6.3 2.8 1.7 2.8 3.4 0 1.9-1.7 3.6-3.8 3.6H8z"
              stroke="${stroke}" stroke-width="1.6" fill="${fill}" stroke-linejoin="round"/>
        <path d="M9 18l-1 2" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round"/>
        <path d="M12 18l-1 2" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round"/>
        <path d="M15 18l-1 2" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round"/>
      `);
    }

    if (iconKey === "cloud") {
      return wrap(`
        <path d="M8 16c-2.2 0-4-1.6-4-3.6C4 10.6 5.6 9.2 7.6 9c.6-2 2.4-3.4 4.6-3.4
                 2.6 0 4.8 2 5 4.6 1.6.3 2.8 1.7 2.8 3.4 0 1.9-1.7 3.6-3.8 3.6H8z"
              stroke="${stroke}" stroke-width="1.6" fill="${fill}" stroke-linejoin="round"/>
      `);
    }

    return wrap(`
      <path d="M12 18a6 6 0 1 0 0-12a6 6 0 0 0 0 12z" stroke="${stroke}" stroke-width="1.6" fill="${fill}"/>
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M19.8 4.2l-1.4 1.4M5.6 18.4l-1.4 1.4"
            stroke="${stroke}" stroke-width="1.6" stroke-linecap="round"/>
    `);
  }

  // For modal “day detail” panel
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

  /* ==========================
     Fetch from your proxy
     ========================== */

  async function fetchProxy(config) {
    const base = (config.weatherEndpoint || "").toString().trim().replace(/\/+$/,"");
    if (!base) throw new Error("Missing weatherEndpoint.");

    const params = new URLSearchParams({
      lat: String(config.lat),
      lng: String(config.lon),
      days: String(config.days || 30),
      timezone: String(config.timezone || "America/Chicago")
    });

    const url = `${base}/api/open-meteo?${params.toString()}`;

    const res = await fetch(url, { headers: { "Accept": "application/json" } });
    const json = await res.json().catch(() => ({}));

    if (!res.ok || !json || json.ok !== true) {
      const msg = json && (json.error || json.message) ? (json.error || json.message) : `HTTP ${res.status}`;
      throw new Error(msg);
    }

    return json;
  }

  function normalizeFromProxy(proxyJson) {
    const norm = (proxyJson && proxyJson.normalized) ? proxyJson.normalized : {};
    const hourlyCore = safeArr(norm.hourly);
    const hourlyExt  = safeArr(norm.hourly_ext);
    const daily      = safeArr(norm.daily);

    return { hourlyCore, hourlyExt, daily, raw: proxyJson.raw || null, meta: norm.meta || null };
  }

  /* ==========================
     Render – card
     ========================== */

  function renderCard(container, bundle, config) {
    if (!container) return;

    const { hourlyCore, hourlyExt } = bundle;

    const pick = pickMostRecentHour(hourlyCore, hourlyExt);
    const core = pick.core || {};
    const ext  = pick.ext  || {};

    const nowCls = classifyNow(core, ext);
    const tempStr = formatTempF(core.temp_c);
    const feelsStr = "—"; // not available from your proxy right now
    const humidStr = formatHumidity(core.rh_pct);

    const windStr = (core.wind_mph != null && Number.isFinite(Number(core.wind_mph)))
      ? `${Math.round(Number(core.wind_mph))} mph`
      : "—";

    const sums = computeRainSums(hourlyCore);
    const rain24 = `${roundTo2(sums.in24)}"`;
    const rain7  = `${roundTo2(sums.in7)}"`;
    const rain30 = `${roundTo2(sums.in30)}"`;

    const updatedLabel = pick.ms
      ? `• Updated ${new Date(pick.ms).toLocaleTimeString([], { hour:"numeric", minute:"2-digit" })}`
      : "";

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
            <div style="font-size:0.9rem;">${nowCls.type}</div>
            <div style="font-size:0.8rem;color:var(--muted,#67706B);">
              Feels like <strong>${feelsStr}</strong>
            </div>
            <div style="font-size:0.8rem;color:var(--muted,#67706B);">
              Humidity: <strong>${humidStr}</strong> • Wind: <strong>${windStr}</strong>
            </div>
          </div>
          <div style="flex:0 0 auto;">
            ${iconSvg(nowCls.icon, 48)}
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
        evt.stopPropagation();
        initWeatherModule({ ...config });
      });
    }
  }

  /* ==========================
     Render – modal
     ========================== */

  function renderModal(container, bundle, config) {
    if (!container) return;

    const { hourlyCore, hourlyExt, daily } = bundle;

    const pick = pickMostRecentHour(hourlyCore, hourlyExt);
    const core = pick.core || {};
    const ext  = pick.ext  || {};

    const nowCls = classifyNow(core, ext);

    const tempStr = formatTempF(core.temp_c);
    const feelsStr = "—";
    const humidStr = formatHumidity(core.rh_pct);
    const windStr = (core.wind_mph != null && Number.isFinite(Number(core.wind_mph)))
      ? `${Math.round(Number(core.wind_mph))} mph`
      : "—";

    const sums = computeRainSums(hourlyCore);
    const rain24 = `${roundTo2(sums.in24)}"`;
    const rain7  = `${roundTo2(sums.in7)}"`;
    const rain30 = `${roundTo2(sums.in30)}"`;

    // Rain chart: last 7 days (derived from hourly)
    const last7 = computeDailyRainFromHourly(hourlyCore, 7);
    const seriesDates = last7.dates || [];
    const seriesAmounts = last7.amounts || [];
    const maxAmt = Math.max(...seriesAmounts, 0.01);

    const rainChartHtml = seriesDates.length
      ? seriesDates.map((d, idx) => {
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
              <div class="fv-rain-value" style="text-align:right;font-variant-numeric:tabular-nums;">
                ${roundTo2(val)}"
              </div>
            </div>
          `;
        }).join("")
      : `<div class="fv-rain-chart-empty" style="font-size:12px;color:var(--muted,#67706B);">
           No recent rainfall data.
         </div>`;

    // Forecast days: build from normalized.daily
    // Your proxy sets forecast_days=3, so we may only have today + next 2.
    const today0 = new Date(); today0.setHours(0,0,0,0);

    const dailyUpcoming = daily
      .filter(d => {
        const dt = d?.date ? new Date(d.date) : null;
        if (!dt || !Number.isFinite(dt.getTime())) return false;
        dt.setHours(0,0,0,0);
        return dt >= today0;
      })
      .slice(0, 5);

    // We need precip per day (inches) -> derive from hourly by date
    const byDateIn = new Map();
    for (const h of hourlyCore) {
      const t = h?.time;
      if (!t) continue;
      const d = dateOnly(t);
      if (!d) continue;
      const mm = Number(h?.rain_mm);
      const inc = (Number.isFinite(mm) ? mm : 0) / MM_PER_IN;
      byDateIn.set(d, (byDateIn.get(d) || 0) + inc);
    }

    // cloud cover for the day -> average from hourly_ext if present
    const cloudByDate = new Map();
    const cloudCount = new Map();
    for (const h of hourlyExt) {
      const t = h?.time;
      if (!t) continue;
      const d = dateOnly(t);
      if (!d) continue;
      const c = Number(h?.cloud_cover_pct);
      if (!Number.isFinite(c)) continue;
      cloudByDate.set(d, (cloudByDate.get(d) || 0) + c);
      cloudCount.set(d, (cloudCount.get(d) || 0) + 1);
    }
    const avgCloud = (d) => {
      const s = cloudByDate.get(d);
      const n = cloudCount.get(d);
      if (!Number.isFinite(s) || !Number.isFinite(n) || n <= 0) return null;
      return s / n;
    };

    const forecastDays = dailyUpcoming.map(d => {
      const date = d.date || "";
      const tMaxC = d.temp_max_c;
      const tMinC = d.temp_min_c;
      const precipIn = byDateIn.get(date) || 0;
      return {
        date,
        tMax: Number.isFinite(Number(tMaxC)) ? C_TO_F(Number(tMaxC)) : null,
        tMin: Number.isFinite(Number(tMinC)) ? C_TO_F(Number(tMinC)) : null,
        precipIn: precipIn,
        precipProb: null,
        cloudCover: avgCloud(date),
        windSpeedMax: null,
        windDirDeg: null,
        sunrise: null,
        sunset: null
      };
    });

    const forecastRowsHtml = forecastDays.length
      ? forecastDays.map((day, idx) => {
          const hi = day.tMax != null ? `${Math.round(day.tMax)}°` : "—";
          const lo = day.tMin != null ? `${Math.round(day.tMin)}°` : "—";
          const rainIn = day.precipIn != null ? `${roundTo2(day.precipIn)}"` : "—";
          const prob = "—";
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
        }).join("")
      : `<div class="fv-forecast-empty" style="font-size:12px;color:var(--muted,#67706B);">
           Forecast data not available (your backend currently returns ~3 forecast days).
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
                Detailed conditions, outlook, and rain history.
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
                <div class="fv-weather-desc" style="font-size:0.95rem;">${nowCls.type}</div>
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
                ${iconSvg(nowCls.icon, 60)}
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
              Next days (today first)
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

    // Rain map button -> dispatch event (dashboard/page decides how to show map)
    const mapBtn = container.querySelector(".fv-weather-rainmap");
    if (mapBtn) {
      mapBtn.addEventListener("click", () => {
        document.dispatchEvent(new CustomEvent("fv:open-rain-map", {
          detail: { lat: config.lat, lon: config.lon, label: config.locationLabel || "" }
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
      const clouds = (day.cloudCover != null && Number.isFinite(Number(day.cloudCover)))
        ? `${Math.round(Number(day.cloudCover))}%`
        : "–";

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
          <div>Avg cloud cover: <strong>${clouds}</strong></div>
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

    renderLoading(container);

    try {
      const proxyJson = await fetchProxy(config);
      const bundle = normalizeFromProxy(proxyJson);

      // Validate minimal shape
      if (!bundle.hourlyCore.length) {
        renderError(container, "Weather payload missing hourly data.");
        return;
      }

      if ((config.mode || "card") === "modal") renderModal(container, bundle, config);
      else renderCard(container, bundle, config);

    } catch (err) {
      console.warn("[FVWeather] Load failed:", err);
      renderError(container, (err && err.message) ? err.message : "Weather service error.");
    }
  }

  window.FVWeather = { initWeatherModule };
})();
