// /js/dash-weather-modal.js
// Rev: 2026-09-11-weather-zip-persistent-sync-v2
//
// Dashboard weather card -> modal wiring.
// ZIP editing exists ONLY inside Weather details.
// The selected ZIP is persisted by fv-weather.js and is always reused by both
// the modal and the main dashboard weather tile on future page loads.

(function () {
  "use strict";

  const WEATHER_GOOGLE_KEY = "AIzaSyD5qLrXZch_rM4sVXmBrpGDH3Zp7RgfVHc";
  const DEFAULT_ZIP = "62530";
  const LS_KEYS = {
    zip: "fv_weather_zip",
    lat: "fv_weather_lat",
    lon: "fv_weather_lon",
    label: "fv_weather_label"
  };

  let resolvedWeatherLocationPromise = null;
  let zipSyncTimer = null;

  const style = document.createElement("style");
  style.textContent = `
    #fv-weather-modal,
    #fv-weather-modal-body {
      scrollbar-width:none;
      -ms-overflow-style:none;
    }
    #fv-weather-modal::-webkit-scrollbar,
    #fv-weather-modal-body::-webkit-scrollbar {
      display:none;
      width:0;
      height:0;
    }
    /* ZIP belongs in Weather details only. */
    #fv-weather .fv-weather-loc {
      display:none !important;
    }
  `;
  document.head.appendChild(style);

  function onReady(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once:true });
    } else {
      fn();
    }
  }

  function hasValidCoordinates(loc) {
    if (!loc) return false;
    const lat = Number(loc.lat);
    const lon = Number(loc.lon);
    return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  }

  function readSavedWeatherLocation() {
    try {
      const lat = Number(localStorage.getItem(LS_KEYS.lat));
      const lon = Number(localStorage.getItem(LS_KEYS.lon));
      const zip = String(localStorage.getItem(LS_KEYS.zip) || "").trim();
      const label = String(localStorage.getItem(LS_KEYS.label) || "").trim();
      if (Number.isFinite(lat) && Number.isFinite(lon) && lat !== 0 && lon !== 0) {
        return { lat, lon, zip, locationLabel: label || zip };
      }
    } catch (err) {
      console.warn("Weather: unable to read saved location.", err);
    }
    return null;
  }

  async function geocodeZip(zip) {
    const cleanZip = String(zip || DEFAULT_ZIP).replace(/\D/g, "").slice(0, 5);
    if (cleanZip.length !== 5) throw new Error("A valid 5-digit ZIP is required.");

    const response = await fetch(`https://api.zippopotam.us/us/${encodeURIComponent(cleanZip)}`, {
      cache: "no-store"
    });
    if (!response.ok) throw new Error(`ZIP lookup failed with HTTP ${response.status}.`);

    const data = await response.json();
    const place = Array.isArray(data?.places) ? data.places[0] : null;
    if (!place) throw new Error(`No weather location found for ZIP ${cleanZip}.`);

    const lat = Number(place.latitude);
    const lon = Number(place.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new Error(`Invalid coordinates returned for ZIP ${cleanZip}.`);
    }

    const city = String(place["place name"] || "").trim();
    const state = String(place["state abbreviation"] || "").trim();
    const locationLabel = city && state ? `${city}, ${state}` : city || cleanZip;
    return { lat, lon, zip:cleanZip, locationLabel };
  }

  async function resolveWeatherLocation() {
    const saved = readSavedWeatherLocation();
    if (hasValidCoordinates(saved)) {
      window.FV_DASH_WEATHER_LOCATION = saved;
      return saved;
    }

    const configured = window.FV_DASH_WEATHER_LOCATION || null;
    if (hasValidCoordinates(configured)) return configured;

    const company = window.FV_COMPANY || {};
    const companyZip = String(company.addressZip || DEFAULT_ZIP).replace(/\D/g, "").slice(0, 5);

    try {
      const loc = await geocodeZip(companyZip || DEFAULT_ZIP);
      window.FV_DASH_WEATHER_LOCATION = loc;
      return loc;
    } catch (err) {
      console.error("Weather: company ZIP lookup failed.", err);
    }

    try {
      const loc = await geocodeZip(DEFAULT_ZIP);
      window.FV_DASH_WEATHER_LOCATION = loc;
      return loc;
    } catch (err) {
      console.error("Weather: fallback ZIP lookup failed.", err);
      return null;
    }
  }

  function getWeatherLocation() {
    if (!resolvedWeatherLocationPromise) {
      resolvedWeatherLocationPromise = resolveWeatherLocation();
    }
    return resolvedWeatherLocationPromise;
  }

  async function renderMainWeather(loc) {
    const shell = document.getElementById("fv-weather");
    if (!shell || !hasValidCoordinates(loc)) return;
    if (!window.FVWeather || typeof window.FVWeather.initWeatherModule !== "function") return;

    window.FV_DASH_WEATHER_LOCATION = loc;

    try {
      await window.FVWeather.initWeatherModule({
        googleApiKey: WEATHER_GOOGLE_KEY,
        lat: Number(loc.lat),
        lon: Number(loc.lon),
        unitsSystem: "IMPERIAL",
        selector: "#fv-weather",
        showOpenMeteo: true,
        mode: "card",
        locationLabel: loc.locationLabel || "",
        __forceRefresh: true
      });
    } catch (err) {
      console.error("Weather: dashboard tile refresh failed.", err);
    }
  }

  async function forceSavedLocationOntoDashboard() {
    const saved = readSavedWeatherLocation();
    if (!hasValidCoordinates(saved)) return;
    window.FV_DASH_WEATHER_LOCATION = saved;
    resolvedWeatherLocationPromise = Promise.resolve(saved);
    await renderMainWeather(saved);
  }

  function queueSavedLocationOverride() {
    // index.html may initialize company weather after DOM ready/fv:company.
    // Reapply the user's saved ZIP after that initialization completes.
    setTimeout(forceSavedLocationOntoDashboard, 0);
    setTimeout(forceSavedLocationOntoDashboard, 250);
    setTimeout(forceSavedLocationOntoDashboard, 750);
  }

  function syncSavedZipToDashboard(expectedZip) {
    if (zipSyncTimer) clearTimeout(zipSyncTimer);
    const wantedZip = String(expectedZip || "").replace(/\D/g, "").slice(0, 5);
    let attempts = 0;

    async function check() {
      attempts += 1;
      const saved = readSavedWeatherLocation();
      const savedZip = String(saved?.zip || "").replace(/\D/g, "").slice(0, 5);

      if (hasValidCoordinates(saved) && savedZip === wantedZip) {
        window.FV_DASH_WEATHER_LOCATION = saved;
        resolvedWeatherLocationPromise = Promise.resolve(saved);
        await renderMainWeather(saved);
        return;
      }

      if (attempts < 16) zipSyncTimer = setTimeout(check, 250);
    }

    zipSyncTimer = setTimeout(check, 450);
  }

  onReady(function () {
    const shell = document.getElementById("fv-weather");
    const modal = document.getElementById("fv-weather-modal");
    const modalBody = document.getElementById("fv-weather-modal-body");
    const closeBtn = document.getElementById("fv-weather-modal-close");

    if (!shell || !modal || !modalBody || !closeBtn) {
      console.warn("Weather modal: required dashboard elements were not found.");
      return;
    }

    if (hasValidCoordinates(readSavedWeatherLocation())) {
      queueSavedLocationOverride();
    }

    document.addEventListener("fv:company", queueSavedLocationOverride);

    async function openModal() {
      modal.removeAttribute("hidden");
      document.body.style.overflow = "hidden";
      modalBody.innerHTML = '<div class="fv-weather-card">Loading weather...</div>';

      if (!window.FVWeather || typeof window.FVWeather.initWeatherModule !== "function") {
        modalBody.innerHTML = shell.innerHTML;
        return;
      }

      const saved = readSavedWeatherLocation();
      const loc = hasValidCoordinates(saved) ? saved : await getWeatherLocation();

      if (!hasValidCoordinates(loc)) {
        modalBody.innerHTML = '<div class="fv-weather-card">Weather location could not be loaded.</div>';
        return;
      }

      window.FV_DASH_WEATHER_LOCATION = loc;
      resolvedWeatherLocationPromise = Promise.resolve(loc);
      modalBody.innerHTML = "";

      try {
        await window.FVWeather.initWeatherModule({
          googleApiKey: WEATHER_GOOGLE_KEY,
          lat: Number(loc.lat),
          lon: Number(loc.lon),
          unitsSystem: "IMPERIAL",
          selector: "#fv-weather-modal-body",
          showOpenMeteo: true,
          mode: "modal",
          locationLabel: loc.locationLabel || ""
        });
      } catch (err) {
        console.error("Weather modal: FVWeather initialization failed.", err);
        modalBody.innerHTML = '<div class="fv-weather-card">Weather could not be loaded.</div>';
        return;
      }

      const zipInput = modalBody.querySelector(".fv-weather-zip");
      if (zipInput && !zipInput.__fvDashboardSyncWired) {
        zipInput.__fvDashboardSyncWired = true;

        const sync = function () {
          const zip = String(zipInput.value || "").replace(/\D/g, "").slice(0, 5);
          if (zip.length === 5) syncSavedZipToDashboard(zip);
        };

        zipInput.addEventListener("input", sync);
        zipInput.addEventListener("blur", sync);
        zipInput.addEventListener("keydown", function (evt) {
          if (evt.key === "Enter") sync();
        });
      }
    }

    function closeModal() {
      modal.setAttribute("hidden", "hidden");
      document.body.style.overflow = "";
    }

    shell.addEventListener("click", function (evt) {
      if (evt.target.closest(".fv-weather-refresh")) return;
      if (shell.querySelector(".fv-weather-card")) openModal();
    });

    closeBtn.addEventListener("click", closeModal);
    modal.addEventListener("click", function (evt) {
      if (evt.target === modal) closeModal();
    });
    document.addEventListener("keydown", function (evt) {
      if (evt.key === "Escape") closeModal();
    });
  });
})();