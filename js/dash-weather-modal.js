// /js/dash-weather-modal.js
// Rev: 2026-09-11-weather-home-restore-fix
//
// Dashboard weather card -> modal wiring.
// ZIP editing exists ONLY inside Weather details.
// Saved ZIP remains authoritative for both the modal and main dashboard tile.
// Also repairs the main tile any time index.html replaces it with Loading weather.

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
  let retryTimer = null;
  let repairQueued = false;

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

  function hasCoords(loc) {
    if (!loc) return false;
    const lat = Number(loc.lat);
    const lon = Number(loc.lon);
    return Number.isFinite(lat) && Number.isFinite(lon) && lat !== 0 && lon !== 0;
  }

  function readSaved() {
    try {
      const lat = Number(localStorage.getItem(LS_KEYS.lat));
      const lon = Number(localStorage.getItem(LS_KEYS.lon));
      const zip = String(localStorage.getItem(LS_KEYS.zip) || "").trim();
      const label = String(localStorage.getItem(LS_KEYS.label) || "").trim();
      if (hasCoords({ lat, lon })) {
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
    if (!hasCoords({ lat, lon })) throw new Error(`Invalid coordinates returned for ZIP ${cleanZip}.`);

    const city = String(place["place name"] || "").trim();
    const state = String(place["state abbreviation"] || "").trim();
    return {
      lat,
      lon,
      zip: cleanZip,
      locationLabel: city && state ? `${city}, ${state}` : city || cleanZip
    };
  }

  async function resolveLocation() {
    const saved = readSaved();
    if (hasCoords(saved)) return saved;

    const configured = window.FV_DASH_WEATHER_LOCATION || null;
    if (hasCoords(configured)) return configured;

    const company = window.FV_COMPANY || {};
    const companyZip = String(company.addressZip || DEFAULT_ZIP).replace(/\D/g, "").slice(0, 5);

    try {
      return await geocodeZip(companyZip || DEFAULT_ZIP);
    } catch (err) {
      console.warn("Weather: company ZIP lookup failed.", err);
      try {
        return await geocodeZip(DEFAULT_ZIP);
      } catch (fallbackErr) {
        console.error("Weather: fallback ZIP lookup failed.", fallbackErr);
        return null;
      }
    }
  }

  function getLocation() {
    if (!resolvedWeatherLocationPromise) resolvedWeatherLocationPromise = resolveLocation();
    return resolvedWeatherLocationPromise;
  }

  async function renderMain(loc, forceRefresh) {
    const shell = document.getElementById("fv-weather");
    if (!shell || !hasCoords(loc)) return false;
    if (!window.FVWeather || typeof window.FVWeather.initWeatherModule !== "function") return false;

    window.FV_DASH_WEATHER_LOCATION = loc;

    const options = {
      googleApiKey: WEATHER_GOOGLE_KEY,
      lat: Number(loc.lat),
      lon: Number(loc.lon),
      unitsSystem: "IMPERIAL",
      selector: "#fv-weather",
      showOpenMeteo: true,
      mode: "card",
      locationLabel: loc.locationLabel || ""
    };
    if (forceRefresh === true) options.__forceRefresh = true;

    try {
      await window.FVWeather.initWeatherModule(options);
      return true;
    } catch (err) {
      console.error("Weather: dashboard tile refresh failed.", err);
      return false;
    }
  }

  function renderSavedWhenReady(forceRefresh) {
    if (retryTimer) clearTimeout(retryTimer);
    let attempts = 0;

    async function run() {
      attempts += 1;
      const saved = readSaved();
      if (!hasCoords(saved)) return;

      window.FV_DASH_WEATHER_LOCATION = saved;
      resolvedWeatherLocationPromise = Promise.resolve(saved);

      if (await renderMain(saved, forceRefresh === true)) return;
      if (attempts < 30) retryTimer = setTimeout(run, 50);
    }

    run();
  }

  function repairIfLoading() {
    const shell = document.getElementById("fv-weather");
    if (!shell || repairQueued) return;

    const text = String(shell.textContent || "").trim().toLowerCase();
    if (text !== "loading weather..." && text !== "loading weather…") return;

    repairQueued = true;
    setTimeout(function () {
      repairQueued = false;
      renderSavedWhenReady(false);
    }, 0);
  }

  function syncSavedZip(expectedZip) {
    if (zipSyncTimer) clearTimeout(zipSyncTimer);
    const wantedZip = String(expectedZip || "").replace(/\D/g, "").slice(0, 5);
    let attempts = 0;

    async function run() {
      attempts += 1;
      const saved = readSaved();
      const savedZip = String(saved?.zip || "").replace(/\D/g, "").slice(0, 5);

      if (hasCoords(saved) && savedZip === wantedZip) {
        window.FV_DASH_WEATHER_LOCATION = saved;
        resolvedWeatherLocationPromise = Promise.resolve(saved);
        await renderMain(saved, true);
        return;
      }

      if (attempts < 15) zipSyncTimer = setTimeout(run, 150);
    }

    zipSyncTimer = setTimeout(run, 150);
  }

  onReady(function () {
    const shell = document.getElementById("fv-weather");
    const modal = document.getElementById("fv-weather-modal");
    const modalBody = document.getElementById("fv-weather-modal-body");
    const closeBtn = document.getElementById("fv-weather-modal-close");

    if (!shell || !modal || !modalBody || !closeBtn) return;

    const saved = readSaved();
    if (hasCoords(saved)) {
      window.FV_DASH_WEATHER_LOCATION = saved;
      resolvedWeatherLocationPromise = Promise.resolve(saved);
      renderSavedWhenReady(false);
    }

    document.addEventListener("fv:company", function () {
      setTimeout(function () {
        renderSavedWhenReady(false);
      }, 0);
    });

    window.addEventListener("pageshow", function () {
      renderSavedWhenReady(false);
    });

    window.addEventListener("focus", repairIfLoading);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") repairIfLoading();
    });

    const observer = new MutationObserver(function () {
      repairIfLoading();
    });
    observer.observe(shell, {
      childList: true,
      subtree: true,
      characterData: true
    });

    async function openModal() {
      modal.removeAttribute("hidden");
      document.body.style.overflow = "hidden";
      modalBody.innerHTML = '<div class="fv-weather-card">Loading weather...</div>';

      if (!window.FVWeather || typeof window.FVWeather.initWeatherModule !== "function") {
        modalBody.innerHTML = shell.innerHTML;
        return;
      }

      const loc = readSaved() || await getLocation();
      if (!hasCoords(loc)) {
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
          if (zip.length === 5) syncSavedZip(zip);
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