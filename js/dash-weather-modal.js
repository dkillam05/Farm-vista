// /js/dash-weather-modal.js
// Rev: 2026-09-11-weather-zip-persistent-sync
//
// Dashboard weather card -> modal wiring.
// ZIP editing is intentionally available ONLY inside the weather details modal.
// A ZIP entered there is persisted by fv-weather.js and remains the location used
// by both the details modal and the dashboard weather tile on future page loads.

(function () {
  "use strict";

  const DEFAULT_ZIP = "62530";
  const LS_KEYS = {
    zip: "fv_weather_zip",
    lat: "fv_weather_lat",
    lon: "fv_weather_lon",
    label: "fv_weather_label"
  };

  let resolvedWeatherLocationPromise = null;
  let zipSyncTimer = null;

  const weatherModalStyle = document.createElement("style");
  weatherModalStyle.textContent = `
    #fv-weather-modal,
    #fv-weather-modal-body {
      scrollbar-width: none;
      -ms-overflow-style: none;
    }

    #fv-weather-modal::-webkit-scrollbar,
    #fv-weather-modal-body::-webkit-scrollbar {
      display: none;
      width: 0;
      height: 0;
    }

    /* ZIP belongs in Weather details only, never on the main dashboard tile. */
    #fv-weather .fv-weather-loc {
      display: none !important;
    }
  `;
  document.head.appendChild(weatherModalStyle);

  function onReady(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  function getWeatherApiKey() {
    try {
      return typeof WEATHER_GOOGLE_KEY !== "undefined" ? WEATHER_GOOGLE_KEY : "";
    } catch (_) {
      return "";
    }
  }

  function hasValidCoordinates(location) {
    if (!location) return false;
    const lat = Number(location.lat);
    const lon = Number(location.lon);
    return (
      Number.isFinite(lat) &&
      Number.isFinite(lon) &&
      Math.abs(lat) <= 90 &&
      Math.abs(lon) <= 180
    );
  }

  function readSavedWeatherLocation() {
    try {
      const lat = Number(localStorage.getItem(LS_KEYS.lat));
      const lon = Number(localStorage.getItem(LS_KEYS.lon));
      const zip = String(localStorage.getItem(LS_KEYS.zip) || "").trim();
      const locationLabel = String(localStorage.getItem(LS_KEYS.label) || "").trim();

      if (Number.isFinite(lat) && Number.isFinite(lon) && lat !== 0 && lon !== 0) {
        return {
          lat,
          lon,
          zip,
          locationLabel: locationLabel || zip
        };
      }
    } catch (err) {
      console.warn("Weather: unable to read saved dashboard location.", err);
    }
    return null;
  }

  function getFirestoreDb() {
    if (window.db && typeof window.db.collection === "function") return window.db;

    if (window.firebase && typeof window.firebase.firestore === "function") {
      try {
        return window.firebase.firestore();
      } catch (err) {
        console.warn("Weather: unable to access Firebase Firestore.", err);
      }
    }
    return null;
  }

  async function getCompanyWeatherInfo() {
    const fallback = {
      addressZip: DEFAULT_ZIP,
      addressCity: "Divernon",
      addressState: "IL"
    };

    const db = getFirestoreDb();
    if (!db) return fallback;

    try {
      const snap = await db.collection("company").doc("main").get();
      if (!snap.exists) return fallback;

      const company = snap.data() || {};
      return {
        addressZip: String(company.addressZip || DEFAULT_ZIP).trim(),
        addressCity: String(company.addressCity || "").trim(),
        addressState: String(company.addressState || "").trim()
      };
    } catch (err) {
      console.error("Weather: failed reading company address.", err);
      return fallback;
    }
  }

  async function geocodeZip(zip, city, state) {
    const cleanZip = String(zip || DEFAULT_ZIP).replace(/\D/g, "").slice(0, 5);
    if (cleanZip.length !== 5) throw new Error("A valid 5-digit weather ZIP is required.");

    const response = await fetch(
      `https://api.zippopotam.us/us/${encodeURIComponent(cleanZip)}`,
      { cache: "no-store" }
    );

    if (!response.ok) throw new Error(`ZIP geocoding failed with HTTP ${response.status}.`);

    const data = await response.json();
    const place = Array.isArray(data && data.places) ? data.places[0] : null;
    if (!place) throw new Error(`No weather location found for ZIP ${cleanZip}.`);

    const lat = Number(place.latitude);
    const lon = Number(place.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new Error(`Invalid coordinates returned for ZIP ${cleanZip}.`);
    }

    const resolvedCity = String(place["place name"] || city || "").trim();
    const resolvedState = String(place["state abbreviation"] || state || "").trim();
    const locationLabel =
      resolvedCity && resolvedState
        ? `${resolvedCity}, ${resolvedState}`
        : resolvedCity || cleanZip;

    return { lat, lon, zip: cleanZip, locationLabel };
  }

  async function resolveWeatherLocation() {
    const saved = readSavedWeatherLocation();
    if (hasValidCoordinates(saved)) {
      window.FV_DASH_WEATHER_LOCATION = saved;
      return saved;
    }

    const configured = window.FV_DASH_WEATHER_LOCATION || null;
    if (hasValidCoordinates(configured)) {
      return {
        lat: Number(configured.lat),
        lon: Number(configured.lon),
        zip: String(configured.zip || ""),
        locationLabel: String(configured.locationLabel || "")
      };
    }

    const company = await getCompanyWeatherInfo();
    try {
      const location = await geocodeZip(
        company.addressZip,
        company.addressCity,
        company.addressState
      );
      window.FV_DASH_WEATHER_LOCATION = location;
      return location;
    } catch (err) {
      console.error("Weather: company ZIP geocoding failed.", err);
    }

    try {
      const fallback = await geocodeZip(DEFAULT_ZIP, "Divernon", "IL");
      window.FV_DASH_WEATHER_LOCATION = fallback;
      return fallback;
    } catch (err) {
      console.error("Weather: default ZIP geocoding failed.", err);
      return null;
    }
  }

  function getWeatherLocation() {
    if (!resolvedWeatherLocationPromise) {
      resolvedWeatherLocationPromise = resolveWeatherLocation();
    }
    return resolvedWeatherLocationPromise;
  }

  async function renderMainWeather(location) {
    const shell = document.getElementById("fv-weather");
    if (!shell || !hasValidCoordinates(location)) return;
    if (!window.FVWeather || typeof window.FVWeather.initWeatherModule !== "function") return;

    const apiKey = getWeatherApiKey();
    if (!apiKey) return;

    window.FV_DASH_WEATHER_LOCATION = location;

    try {
      await window.FVWeather.initWeatherModule({
        googleApiKey: apiKey,
        lat: Number(location.lat),
        lon: Number(location.lon),
        unitsSystem: "IMPERIAL",
        selector: "#fv-weather",
        showOpenMeteo: true,
        mode: "card",
        locationLabel: location.locationLabel || "",
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
    /*
      index.html also initializes weather from company/main after fv:company.
      Run after it so a user-selected ZIP always wins over the company ZIP.
    */
    setTimeout(forceSavedLocationOntoDashboard, 0);
    setTimeout(forceSavedLocationOntoDashboard, 350);
  }

  function syncSavedZipToDashboard(expectedZip) {
    if (zipSyncTimer) clearTimeout(zipSyncTimer);

    const wantedZip = String(expectedZip || "").replace(/\D/g, "").slice(0, 5);
    let attempts = 0;

    const check = async function () {
      attempts += 1;

      const saved = readSavedWeatherLocation();
      const savedZip = String((saved && saved.zip) || "").replace(/\D/g, "").slice(0, 5);

      if (hasValidCoordinates(saved) && (!wantedZip || savedZip === wantedZip)) {
        window.FV_DASH_WEATHER_LOCATION = saved;
        resolvedWeatherLocationPromise = Promise.resolve(saved);
        await renderMainWeather(saved);
        return;
      }

      if (attempts < 12) zipSyncTimer = setTimeout(check, 250);
    };

    zipSyncTimer = setTimeout(check, 750);
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

    const savedAtLoad = readSavedWeatherLocation();
    if (hasValidCoordinates(savedAtLoad)) {
      window.FV_DASH_WEATHER_LOCATION = savedAtLoad;
      resolvedWeatherLocationPromise = Promise.resolve(savedAtLoad);
      queueSavedLocationOverride();
    }

    /* Company initialization can happen after DOM ready; saved ZIP must still win. */
    document.addEventListener("fv:company", queueSavedLocationOverride);

    async function openModal() {
      modal.removeAttribute("hidden");
      document.body.style.overflow = "hidden";
      modalBody.innerHTML = '<div class="fv-weather-card">Loading weather...</div>';

      if (!window.FVWeather || typeof window.FVWeather.initWeatherModule !== "function") {
        modalBody.innerHTML = shell.innerHTML;
        console.warn("Weather modal: FVWeather.initWeatherModule is unavailable.");
        return;
      }

      const saved = readSavedWeatherLocation();
      if (hasValidCoordinates(saved)) {
        window.FV_DASH_WEATHER_LOCATION = saved;
        resolvedWeatherLocationPromise = Promise.resolve(saved);
      }

      const weatherLocation = saved || (await getWeatherLocation());
      if (!hasValidCoordinates(weatherLocation)) {
        modalBody.innerHTML =
          '<div class="fv-weather-card">Weather location could not be loaded.</div>';
        return;
      }

      const apiKey = getWeatherApiKey();
      if (!apiKey) {
        modalBody.innerHTML = '<div class="fv-weather-card">Weather could not be loaded.</div>';
        console.warn("Weather modal: dashboard API key is unavailable.");
        return;
      }

      modalBody.innerHTML = "";

      try {
        await window.FVWeather.initWeatherModule({
          googleApiKey: apiKey,
          lat: Number(weatherLocation.lat),
          lon: Number(weatherLocation.lon),
          unitsSystem: "IMPERIAL",
          selector: "#fv-weather-modal-body",
          showOpenMeteo: true,
          mode: "modal",
          locationLabel: weatherLocation.locationLabel || ""
        });
      } catch (err) {
        console.error("Weather modal: FVWeather initialization failed.", err);
        modalBody.innerHTML = '<div class="fv-weather-card">Weather could not be loaded.</div>';
        return;
      }

      const zipInput = modalBody.querySelector(".fv-weather-zip");
      if (zipInput && !zipInput.__fvDashboardSyncWired) {
        zipInput.__fvDashboardSyncWired = true;

        zipInput.addEventListener("input", function () {
          const zip = String(zipInput.value || "").replace(/\D/g, "").slice(0, 5);
          if (zip.length === 5) syncSavedZipToDashboard(zip);
        });

        zipInput.addEventListener("keydown", function (evt) {
          if (evt.key === "Enter") {
            const zip = String(zipInput.value || "").replace(/\D/g, "").slice(0, 5);
            if (zip.length === 5) syncSavedZipToDashboard(zip);
          }
        });

        zipInput.addEventListener("blur", function () {
          const zip = String(zipInput.value || "").replace(/\D/g, "").slice(0, 5);
          if (zip.length === 5) syncSavedZipToDashboard(zip);
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