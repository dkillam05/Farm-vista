// /js/dash-weather-modal.js
// Rev: 2026-09-11-weather-zip-modal-only-v2
// Dashboard weather card -> modal wiring.
// ZIP editing stays ONLY inside Weather details.

(function () {
  "use strict";

  const WEATHER_GOOGLE_KEY = "AIzaSyD5qLrXZch_rM4sVXmBrpGDH3Zp7RgfVHc";

  /* Hide modal scrollbars without disabling scrolling, and never show the ZIP row on the main tile. */
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

  function validLocation(loc) {
    if (!loc) return false;
    const lat = Number(loc.lat);
    const lon = Number(loc.lon);
    return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  }

  function savedLocation() {
    try {
      const lat = Number(localStorage.getItem("fv_weather_lat"));
      const lon = Number(localStorage.getItem("fv_weather_lon"));
      const zip = String(localStorage.getItem("fv_weather_zip") || "").trim();
      const locationLabel = String(localStorage.getItem("fv_weather_label") || "").trim();
      if (Number.isFinite(lat) && Number.isFinite(lon) && lat !== 0 && lon !== 0) {
        return { lat, lon, zip, locationLabel: locationLabel || zip };
      }
    } catch (err) {
      console.warn("Weather modal: saved location could not be read.", err);
    }
    return null;
  }

  async function refreshMainTileFromSaved() {
    const loc = savedLocation();
    if (!validLocation(loc)) return;
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
      console.error("Weather modal: main tile refresh failed.", err);
    }
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

    async function openModal() {
      modal.removeAttribute("hidden");
      document.body.style.overflow = "hidden";
      modalBody.innerHTML = '<div class="fv-weather-card">Loading weather…</div>';

      if (!window.FVWeather || typeof window.FVWeather.initWeatherModule !== "function") {
        modalBody.innerHTML = '<div class="fv-weather-card">Weather could not be loaded.</div>';
        console.warn("Weather modal: FVWeather.initWeatherModule is unavailable.");
        return;
      }

      /*
       * IMPORTANT: use the exact location already powering the working dashboard tile.
       * Do not independently re-resolve/geocode it here. That keeps the modal and tile
       * on one source of truth and avoids the modal-only loading failure.
       */
      let loc = savedLocation();
      if (!validLocation(loc)) loc = window.FV_DASH_WEATHER_LOCATION || null;

      if (!validLocation(loc)) {
        modalBody.innerHTML = '<div class="fv-weather-card">Weather location could not be loaded.</div>';
        return;
      }

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

      /*
       * fv-weather.js owns ZIP lookup + persistence. We only watch for that saved
       * location to change, then refresh the main tile from the same saved values.
       */
      const zipInput = modalBody.querySelector(".fv-weather-zip");
      if (zipInput && !zipInput.__fvDashboardSyncWired) {
        zipInput.__fvDashboardSyncWired = true;

        let syncTimer = null;
        const scheduleSync = function () {
          if (syncTimer) clearTimeout(syncTimer);
          syncTimer = setTimeout(refreshMainTileFromSaved, 1000);
        };

        zipInput.addEventListener("input", function () {
          if (String(zipInput.value || "").replace(/\D/g, "").length === 5) scheduleSync();
        });
        zipInput.addEventListener("change", scheduleSync);
        zipInput.addEventListener("blur", scheduleSync);
        zipInput.addEventListener("keydown", function (evt) {
          if (evt.key === "Enter") scheduleSync();
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