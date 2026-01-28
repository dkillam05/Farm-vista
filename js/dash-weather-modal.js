// /Farm-vista/js/dash-weather-modal.js
// Rev: 2026-01-27-dash-weather-modal-v1
//
// Dashboard weather card → modal wiring.
// DOES NOT replace fv-weather.js.
// Only handles click → open modal, close modal, and re-init FVWeather in modal.

(function(){
  "use strict";

  function onReady(fn){
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once:true });
    } else {
      fn();
    }
  }

  onReady(function(){
    const shell     = document.getElementById("fv-weather");
    const modal     = document.getElementById("fv-weather-modal");
    const modalBody = document.getElementById("fv-weather-modal-body");
    const closeBtn  = document.getElementById("fv-weather-modal-close");

    if (!shell || !modal || !modalBody || !closeBtn) return;

    function openModal(){
      modal.removeAttribute("hidden");
      document.body.style.overflow = "hidden";

      // Re-render weather inside modal
      if (window.FVWeather && typeof FVWeather.initWeatherModule === "function") {
        FVWeather.initWeatherModule({
          googleApiKey: "AIzaSyD5qLrXZch_rM4sVXmBrpGDH3Zp7RgfVHc",
          lat: 39.5656,
          lon: -89.6573,
          unitsSystem: "IMPERIAL",
          selector: "#fv-weather-modal-body",
          showOpenMeteo: true,
          mode: "modal",
          locationLabel: "Divernon, Illinois"
        });
      } else {
        // fallback: clone card HTML
        modalBody.innerHTML = shell.innerHTML;
      }
    }

    function closeModal(){
      modal.setAttribute("hidden", "hidden");
      document.body.style.overflow = "";
    }

    shell.addEventListener("click", function(evt){
      // ignore refresh button clicks
      if (evt.target.closest(".fv-weather-refresh")) return;
      if (shell.querySelector(".fv-weather-card")) openModal();
    });

    closeBtn.addEventListener("click", closeModal);

    modal.addEventListener("click", function(evt){
      if (evt.target === modal) closeModal();
    });

    document.addEventListener("keydown", function(evt){
      if (evt.key === "Escape") closeModal();
    });
  });

})();