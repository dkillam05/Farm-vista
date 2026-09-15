// /js/dash-weather-modal.js
// Rev: 2026-09-11-weather-single-render-v4
//
// Dashboard weather card -> modal wiring.
// ZIP editing exists ONLY inside Weather details.
// The saved ZIP is authoritative for BOTH the dashboard tile and details modal.
// This file does not create a second dashboard weather render on page load.

(function () {
  "use strict";

  const WEATHER_GOOGLE_KEY = "AIzaSyD5qLrXZch_rM4sVXmBrpGDH3Zp7RgfVHc";
  const LS_KEYS = {
    zip: "fv_weather_zip",
    lat: "fv_weather_lat",
    lon: "fv_weather_lon",
    label: "fv_weather_label"
  };

  let zipSyncTimer = null;
  let modalRenderVersion = 0;

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
        return {
          lat,
          lon,
          zip,
          locationLabel: label || zip
        };
      }
    } catch (err) {
      console.warn("Weather: unable to read saved location.", err);
    }

    return null;
  }

  function onReady(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once:true });
    } else {
      fn();
    }
  }

  /*
    IMPORTANT:

    index.html owns the normal dashboard weather render. Previously this helper
    also rendered the dashboard, which created a race: Divernon could paint first,
    then the saved ZIP painted second, causing the visible flash.

    Instead, wrap the existing weather initializer BEFORE index.html calls it.
    Any render whose target is the main #fv-weather tile is given the saved ZIP
    coordinates up front. That means the dashboard still renders only once, but it
    renders the correct saved location on that one pass.
  */
  function installMainWeatherInterceptor() {
    if (!window.FVWeather || typeof window.FVWeather.initWeatherModule !== "function") {
      return false;
    }

    if (window.FVWeather.__fvSavedZipInterceptorInstalled) return true;

    const originalInit = window.FVWeather.initWeatherModule.bind(window.FVWeather);

    window.FVWeather.__fvOriginalInitWeatherModule = originalInit;
    window.FVWeather.initWeatherModule = function (options) {
      const next = Object.assign({}, options || {});
      const selector = String(next.selector || "");

      if (selector === "#fv-weather" || selector.startsWith("#fv-weather[")) {
        const saved = readSaved();
        if (hasCoords(saved)) {
          next.lat = Number(saved.lat);
          next.lon = Number(saved.lon);
          next.locationLabel = saved.locationLabel || saved.zip || "";
          window.FV_DASH_WEATHER_LOCATION = saved;
        }
      }

      return originalInit(next);
    };

    window.FVWeather.__fvSavedZipInterceptorInstalled = true;
    return true;
  }

  installMainWeatherInterceptor();

  function originalWeatherInit() {
    if (!window.FVWeather) return null;
    return (
      window.FVWeather.__fvOriginalInitWeatherModule ||
      window.FVWeather.initWeatherModule ||
      null
    );
  }

  async function refreshMainFromSaved(forceRefresh) {
    const shell = document.getElementById("fv-weather");
    const init = originalWeatherInit();
    const saved = readSaved();

    if (!shell || !init || !hasCoords(saved)) return false;

    window.FV_DASH_WEATHER_LOCATION = saved;

    const options = {
      googleApiKey: WEATHER_GOOGLE_KEY,
      lat: Number(saved.lat),
      lon: Number(saved.lon),
      unitsSystem: "IMPERIAL",
      selector: "#fv-weather",
      showOpenMeteo: true,
      mode: "card",
      locationLabel: saved.locationLabel || saved.zip || ""
    };

    if (forceRefresh === true) options.__forceRefresh = true;

    try {
      await init(options);
      return true;
    } catch (err) {
      console.error("Weather: dashboard tile refresh failed.", err);
      return false;
    }
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
        await refreshMainFromSaved(true);
        return;
      }

      if (attempts < 20) {
        zipSyncTimer = setTimeout(run, 100);
      }
    }

    zipSyncTimer = setTimeout(run, 100);
  }

  onReady(function () {
    /* In case script ordering ever changes, make one more safe interceptor check. */
    installMainWeatherInterceptor();

    const shell = document.getElementById("fv-weather");
    const modal = document.getElementById("fv-weather-modal");
    const modalBody = document.getElementById("fv-weather-modal-body");
    const closeBtn = document.getElementById("fv-weather-modal-close");

    if (!shell || !modal || !modalBody || !closeBtn) return;

    const savedAtReady = readSaved();
    if (hasCoords(savedAtReady)) {
      window.FV_DASH_WEATHER_LOCATION = savedAtReady;
    }

    async function openModal() {
      modal.removeAttribute("hidden");
      document.body.style.overflow = "hidden";

      const init = originalWeatherInit();
      if (!init) {
        modalBody.innerHTML = shell.innerHTML;
        return;
      }

      const saved = readSaved();
      const configured = hasCoords(saved)
        ? saved
        : (hasCoords(window.FV_DASH_WEATHER_LOCATION)
            ? window.FV_DASH_WEATHER_LOCATION
            : { lat:39.5656, lon:-89.6573, zip:"62530", locationLabel:"Divernon, IL" });

      window.FV_DASH_WEATHER_LOCATION = configured;

      /*
        fv-weather.js remembers selectors it has already rendered. Reusing the same
        modal selector after clearing the modal body can therefore leave the modal
        blank or stuck on a later open. Give each modal opening a fresh selector so
        its complete weather structure is always rebuilt reliably.
      */
      modalRenderVersion += 1;
      const attr = `data-fv-weather-modal-render-${modalRenderVersion}`;
      modalBody.getAttributeNames()
        .filter(name => name.startsWith("data-fv-weather-modal-render-"))
        .forEach(name => modalBody.removeAttribute(name));
      modalBody.setAttribute(attr, "");
      modalBody.innerHTML = "";

      try {
        await init({
          googleApiKey: WEATHER_GOOGLE_KEY,
          lat: Number(configured.lat),
          lon: Number(configured.lon),
          unitsSystem: "IMPERIAL",
          selector: `#fv-weather-modal-body[${attr}]`,
          showOpenMeteo: true,
          mode: "modal",
          locationLabel: configured.locationLabel || configured.zip || ""
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
      openModal();
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