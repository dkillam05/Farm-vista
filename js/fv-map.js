/* ====================================================================
/Farm-vista/js/fv-map.js
Google Maps helper for FarmVista – drop a pin + use my location
Exports:
 • window.FVMap   – small helper object
 • window.fvMapInit – callback used by Google Maps script tag
==================================================================== */
(function () {
  "use strict";

  const MapState = {
    map: null,
    marker: null,
    lastLatLng: null
  };

  function $(id) {
    return document.getElementById(id);
  }

  function updateOutputs(latLng) {
    if (!latLng) return;

    const lat = latLng.lat();
    const lng = latLng.lng();
    const latStr = lat.toFixed(6);
    const lngStr = lng.toFixed(6);

    const coordLine = $("coordLine");
    const latField = $("latField");
    const lngField = $("lngField");
    const help = $("mapHelp");

    if (coordLine) {
      coordLine.textContent = `${latStr}, ${lngStr}`;
    }
    if (latField) latField.value = latStr;
    if (lngField) lngField.value = lngStr;
    if (help) help.textContent = "Pin set. Tap again to move it.";
  }

  function setPin(latLng) {
    if (!MapState.marker) return;
    MapState.marker.setPosition(latLng);
    MapState.lastLatLng = latLng;
    updateOutputs(latLng);
  }

  function wireButtons() {
    const btnUseLoc = $("btnUseLocation");
    const btnMap = $("btnMapTypeMap");
    const btnSat = $("btnMapTypeSat");
    const status = $("locationStatus");

    if (btnUseLoc) {
      btnUseLoc.addEventListener("click", () => {
        if (!navigator.geolocation) {
          if (status) {
            status.textContent = "Geolocation not supported on this device.";
          }
          return;
        }

        if (status) {
          status.textContent = "Getting current location…";
        }

        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const ll = new google.maps.LatLng(
              pos.coords.latitude,
              pos.coords.longitude
            );
            MapState.map.setCenter(ll);
            MapState.map.setZoom(17);
            setPin(ll);
            if (status) {
              status.textContent = "";
            }
          },
          (err) => {
            console.warn("geolocation error", err);
            if (status) {
              if (err && err.code === 1) {
                status.textContent =
                  "Location permission denied. Check Safari → Settings → Location for dkillam05.github.io.";
              } else {
                status.textContent = "Could not get current location.";
              }
            }
          },
          {
            enableHighAccuracy: true,
            maximumAge: 60000,
            timeout: 10000
          }
        );
      });
    }

    function setMode(active) {
      if (!MapState.map) return;
      if (active === "sat") {
        MapState.map.setMapTypeId(google.maps.MapTypeId.SATELLITE);
        btnSat && btnSat.classList.add("mode-active");
        btnMap && btnMap.classList.remove("mode-active");
      } else {
        MapState.map.setMapTypeId(google.maps.MapTypeId.ROADMAP);
        btnMap && btnMap.classList.add("mode-active");
        btnSat && btnSat.classList.remove("mode-active");
      }
    }

    if (btnMap) {
      btnMap.addEventListener("click", () => setMode("map"));
    }
    if (btnSat) {
      btnSat.addEventListener("click", () => setMode("sat"));
    }

    // Default -> map
    setMode("map");
  }

  function init() {
    const mapEl = $("fvMap");
    const help = $("mapHelp");
    if (!mapEl) {
      console.error("fv-map.js: #fvMap element not found.");
      return;
    }
    if (!(window.google && google.maps)) {
      console.error("fv-map.js: Google Maps JS not loaded.");
      if (help) help.textContent = "Google Maps failed to load.";
      return;
    }

    const centerUSA = { lat: 39.8283, lng: -98.5795 };

    MapState.map = new google.maps.Map(mapEl, {
      center: centerUSA,
      zoom: 5,
      mapTypeId: google.maps.MapTypeId.ROADMAP,
      streetViewControl: false,
      fullscreenControl: false,
      mapTypeControl: false
    });

    MapState.marker = new google.maps.Marker({
      map: MapState.map,
      draggable: false
    });

    MapState.map.addListener("click", (e) => {
      setPin(e.latLng);
    });

    if (help) {
      help.textContent = "Tap anywhere on the map to drop a pin. Drag the map to move around.";
    }

    const coordLine = $("coordLine");
    if (coordLine) {
      coordLine.textContent = "Waiting for pin…";
    }

    wireButtons();
  }

  // Expose to global for Google callback + future forms
  window.FVMap = {
    init,
    setPin,
    getLastLatLng() {
      return MapState.lastLatLng;
    }
  };

  // This is the callback Google Maps will call.
  window.fvMapInit = init;
})();