<!-- /Farm-vista/js/fv-map.js -->
<script>
// Guard so we don't double-define
(function () {
  if (window.FVMap) return;

  function toNumber(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  window.FVMap = {
    /**
     * Create a simple pin-drop picker.
     *
     * opts = {
     *   mapId: "map",
     *   useLocationBtnId: "btnUseLocation",
     *   mapModeBtnId: "btnMapMode",
     *   satModeBtnId: "btnSatMode",
     *   messageId: "mapMessage",
     *   latInputId: "lat",
     *   lngInputId: "lng",
     *   hiddenFieldId: "latlngHidden" (optional)
     * }
     */
    initPicker(opts) {
      const mapEl  = document.getElementById(opts.mapId);
      if (!mapEl || !window.google || !google.maps) {
        console.error("FVMap.initPicker: Google Maps not ready.");
        return;
      }

      const btnUseLoc = document.getElementById(opts.useLocationBtnId);
      const btnMap    = document.getElementById(opts.mapModeBtnId);
      const btnSat    = document.getElementById(opts.satModeBtnId);
      const msgEl     = document.getElementById(opts.messageId);
      const latEl     = document.getElementById(opts.latInputId);
      const lngEl     = document.getElementById(opts.lngInputId);
      const hiddenEl  = opts.hiddenFieldId ? document.getElementById(opts.hiddenFieldId) : null;

      function setMessage(text) {
        if (!msgEl) return;
        msgEl.textContent = text || "";
      }

      // Default center = US center-ish
      const defaultCenter = { lat: 39.8283, lng: -98.5795 };

      const map = new google.maps.Map(mapEl, {
        center: defaultCenter,
        zoom: 15,
        mapTypeId: google.maps.MapTypeId.SATELLITE,
        gestureHandling: "greedy",
        fullscreenControl: false,
        streetViewControl: false,
        mapTypeControl: false
      });

      let marker = null;

      function updateOutputs(latLng) {
        const lat = latLng.lat();
        const lng = latLng.lng();
        if (latEl) latEl.value = lat.toFixed(6);
        if (lngEl) lngEl.value = lng.toFixed(6);
        if (hiddenEl) hiddenEl.value = `${lat},${lng}`;
      }

      function placeMarker(latLng, fromUserClick) {
        if (!marker) {
          marker = new google.maps.Marker({
            position: latLng,
            map,
            draggable: false
          });
        } else {
          marker.setPosition(latLng);
        }
        updateOutputs(latLng);
        if (fromUserClick) {
          setMessage("Pin dropped. You can adjust by tapping a new spot.");
        }
      }

      // Restore from existing values if present
      if (latEl && lngEl && latEl.value && lngEl.value) {
        const lat = toNumber(latEl.value, NaN);
        const lng = toNumber(lngEl.value, NaN);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          const ll = new google.maps.LatLng(lat, lng);
          map.setCenter(ll);
          placeMarker(ll, false);
        }
      }

      // Click to drop pin
      map.addListener("click", (e) => {
        placeMarker(e.latLng, true);
      });

      // Use my location
      if (btnUseLoc && "geolocation" in navigator) {
        btnUseLoc.addEventListener("click", () => {
          setMessage("Locating…");
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const coords = {
                lat: pos.coords.latitude,
                lng: pos.coords.longitude
              };
              const ll = new google.maps.LatLng(coords.lat, coords.lng);
              map.setCenter(ll);
              map.setZoom(18);
              placeMarker(ll, false);
              setMessage("Location found. Pin placed at your current position.");
            },
            (err) => {
              console.warn("Geolocation error", err);
              if (err.code === 1) {
                setMessage("Location permission denied. Check Safari → Settings → Location for this site.");
              } else if (err.code === 2) {
                setMessage("Location unavailable. Move to an open area or check signal.");
              } else {
                setMessage("Could not get current location.");
              }
            },
            {
              enableHighAccuracy: true,
              timeout: 15000,
              maximumAge: 10000
            }
          );
        });
      } else if (btnUseLoc) {
        btnUseLoc.disabled = true;
        setMessage("This browser does not support location.");
      }

      // Map / Satellite toggle
      function setMode(mode) {
        if (!map) return;
        if (mode === "map") {
          map.setMapTypeId(google.maps.MapTypeId.ROADMAP);
          btnMap && btnMap.classList.add("map-mode-active");
          btnSat && btnSat.classList.remove("map-mode-active");
        } else {
          map.setMapTypeId(google.maps.MapTypeId.SATELLITE);
          btnSat && btnSat.classList.add("map-mode-active");
          btnMap && btnMap.classList.remove("map-mode-active");
        }
      }

      if (btnMap) {
        btnMap.addEventListener("click", () => setMode("map"));
      }
      if (btnSat) {
        btnSat.addEventListener("click", () => setMode("sat"));
      }

      // Default to satellite (field view)
      setMode("sat");

      // Expose the map + marker in case we want it later
      return { map, getMarker: () => marker };
    }
  };
})();
</script>