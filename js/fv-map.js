// /Farm-vista/js/fv-map.js
// Simple helper for Google Maps pin-drop + "Use my location"
// Exposes: window.FVMap.initPicker(options)

(function () {
  if (window.FVMap) return; // don't double-define

  function toNumber(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function setStatus(el, msg) {
    if (!el) return;
    el.textContent = msg || "";
  }

  function initPicker(opts) {
    opts = opts || {};
    const container = document.getElementById(opts.containerId);
    if (!container || !window.google || !google.maps) {
      console.error("FVMap.initPicker: container or google.maps missing");
      return;
    }

    const latInput   = opts.latInputId   ? document.getElementById(opts.latInputId)   : null;
    const lngInput   = opts.lngInputId   ? document.getElementById(opts.lngInputId)   : null;
    const zoomInput  = opts.zoomInputId  ? document.getElementById(opts.zoomInputId)  : null;
    const statusEl   = opts.statusId     ? document.getElementById(opts.statusId)     : null;
    const locBtn     = opts.useLocationBtnId ? document.getElementById(opts.useLocationBtnId) : null;
    const mapBtn     = opts.mapBtnId     ? document.getElementById(opts.mapBtnId)     : null;
    const satBtn     = opts.satBtnId     ? document.getElementById(opts.satBtnId)     : null;

    const defaultCenter = opts.initialCenter || { lat: 39.8283, lng: -98.5795 }; // center of US

    const startLat = latInput ? toNumber(latInput.value, defaultCenter.lat) : defaultCenter.lat;
    const startLng = lngInput ? toNumber(lngInput.value, defaultCenter.lng) : defaultCenter.lng;
    const startZoom = zoomInput ? toNumber(zoomInput.value, 17) : 17;

    const map = new google.maps.Map(container, {
      center: { lat: startLat, lng: startLng },
      zoom: startZoom,
      mapTypeId: google.maps.MapTypeId.ROADMAP,
      gestureHandling: "greedy"
    });

    let marker = null;

    function updateInputs(pos, zoom) {
      if (latInput) latInput.value = pos.lat.toFixed(6);
      if (lngInput) lngInput.value = pos.lng.toFixed(6);
      if (zoomInput && typeof zoom === "number") zoomInput.value = String(zoom);
      setStatus(statusEl, pos.lat.toFixed(6) + ", " + pos.lng.toFixed(6));
    }

    function placeMarker(pos, zoomOverride) {
      const latLng = new google.maps.LatLng(pos.lat, pos.lng);
      if (!marker) {
        marker = new google.maps.Marker({
          map,
          position: latLng
        });
      } else {
        marker.setPosition(latLng);
      }
      if (typeof zoomOverride === "number") {
        map.setZoom(zoomOverride);
      }
      map.panTo(latLng);
      updateInputs({ lat: latLng.lat(), lng: latLng.lng() }, map.getZoom());
    }

    // If we already had lat/lng in the inputs, show that marker.
    if (latInput && lngInput && latInput.value && lngInput.value) {
      const lat = toNumber(latInput.value, defaultCenter.lat);
      const lng = toNumber(lngInput.value, defaultCenter.lng);
      placeMarker({ lat, lng }, startZoom);
    } else {
      updateInputs({ lat: startLat, lng: startLng }, startZoom);
    }

    // Clicking on map drops/moves the pin
    map.addListener("click", (e) => {
      if (!e || !e.latLng) return;
      const pos = e.latLng.toJSON ? e.latLng.toJSON() : { lat: e.latLng.lat(), lng: e.latLng.lng() };
      placeMarker(pos);
    });

    // Watch zoom changes
    map.addListener("zoom_changed", () => {
      if (!marker) return;
      const pos = marker.getPosition();
      if (!pos) return;
      updateInputs({ lat: pos.lat(), lng: pos.lng() }, map.getZoom());
    });

    // "Use my location" button
    if (locBtn) {
      if (!("geolocation" in navigator)) {
        locBtn.disabled = true;
        setStatus(statusEl, "Geolocation not supported on this device.");
      } else {
        locBtn.disabled = false;
        locBtn.addEventListener("click", () => {
          setStatus(statusEl, "Getting current location…");
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const coords = {
                lat: pos.coords.latitude,
                lng: pos.coords.longitude
              };
              placeMarker(coords, 18);
            },
            (err) => {
              console.warn("Geo error", err);
              if (err && err.code === 1) {
                setStatus(
                  statusEl,
                  "Location blocked. Check Safari/Browser location settings for dkillam05.github.io."
                );
              } else if (err && err.message) {
                setStatus(statusEl, "Could not get current location: " + err.message);
              } else {
                setStatus(statusEl, "Could not get current location.");
              }
            },
            {
              enableHighAccuracy: true,
              timeout: 15000,
              maximumAge: 0
            }
          );
        });
      }
    }

    // Map / Satellite toggle
    if (mapBtn && satBtn) {
      const ACTIVE = "mode-active";

      function setMode(mode) {
        if (mode === "sat") {
          map.setMapTypeId(google.maps.MapTypeId.SATELLITE);
          satBtn.classList.add(ACTIVE);
          mapBtn.classList.remove(ACTIVE);
        } else {
          map.setMapTypeId(google.maps.MapTypeId.ROADMAP);
          mapBtn.classList.add(ACTIVE);
          satBtn.classList.remove(ACTIVE);
        }
      }

      mapBtn.addEventListener("click", () => setMode("map"));
      satBtn.addEventListener("click", () => setMode("map"));

      satBtn.addEventListener("click", () => setMode("sat"));

      // default mode
      setMode("map");
    }

    return {
      getMap() {
        return map;
      },
      getMarker() {
        return marker;
      }
    };
  }

  window.FVMap = {
    initPicker
  };
})();