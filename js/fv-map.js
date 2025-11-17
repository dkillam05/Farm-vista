/* ====================================================================
/Farm-vista/js/fv-map.js
Google Maps helper for FarmVista – pin drop + "Use my location"
Designed for use inside a modal. Satellite only, no visible lat/long.
Exports:
 • window.FVMap.init()        – called by Google callback (fvMapInit)
 • window.FVMap.useMyLocation()
 • window.FVMap.getLastLatLng()
==================================================================== */
(function () {
  "use strict";

  const MapState = {
    map: null,
    marker: null,
    lastLatLng: null,
    helpEl: null,
    statusEl: null
  };

  function $(id) {
    return document.getElementById(id);
  }

  function updateHidden(latLng) {
    if (!latLng) return;
    const lat = latLng.lat();
    const lng = latLng.lng();
    const latStr = lat.toFixed(6);
    const lngStr = lng.toFixed(6);

    const latH = $("latHidden");
    const lngH = $("lngHidden");
    if (latH) latH.value = latStr;
    if (lngH) lngH.value = lngStr;
  }

  function setPin(latLng) {
    if (!MapState.marker || !latLng) return;
    MapState.marker.setPosition(latLng);
    MapState.lastLatLng = latLng;
    updateHidden(latLng);

    if (MapState.helpEl) {
      MapState.helpEl.textContent = "Pin set. Tap again to move it.";
    }
  }

  function init() {
    const mapEl = $("fvMap");
    MapState.helpEl = $("mapHelp");
    MapState.statusEl = $("locationStatus");

    if (!mapEl) {
      console.error("fv-map.js: #fvMap element not found.");
      if (MapState.helpEl) {
        MapState.helpEl.textContent = "Map container not found.";
      }
      return;
    }
    if (!(window.google && google.maps)) {
      console.error("fv-map.js: Google Maps JS not loaded.");
      if (MapState.helpEl) {
        MapState.helpEl.textContent = "Google Maps failed to load.";
      }
      return;
    }

    const centerUSA = { lat: 39.8283, lng: -98.5795 };

    MapState.map = new google.maps.Map(mapEl, {
      center: centerUSA,
      zoom: 5,
      mapTypeId: google.maps.MapTypeId.SATELLITE,
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

    if (MapState.helpEl) {
      MapState.helpEl.textContent =
        "Tap anywhere on the map to drop a pin. Drag the map to move around.";
    }
    if (MapState.statusEl) {
      MapState.statusEl.textContent = "";
    }
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      if (MapState.statusEl) {
        MapState.statusEl.textContent =
          "Geolocation not supported on this device.";
      }
      return;
    }

    if (MapState.statusEl) {
      MapState.statusEl.textContent = "Getting current location…";
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!MapState.map) return;
        const ll = new google.maps.LatLng(
          pos.coords.latitude,
          pos.coords.longitude
        );
        MapState.map.setCenter(ll);
        MapState.map.setZoom(17);
        setPin(ll);
        if (MapState.statusEl) {
          MapState.statusEl.textContent = "";
        }
      },
      (err) => {
        console.warn("geolocation error", err);
        if (MapState.statusEl) {
          if (err && err.code === 1) {
            MapState.statusEl.textContent =
              "Location permission denied. Check Safari → Settings → Location for dkillam05.github.io.";
          } else {
            MapState.statusEl.textContent = "Could not get current location.";
          }
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 60000,
        timeout: 10000
      }
    );
  }

  window.FVMap = {
    init,
    useMyLocation,
    setPin,
    getLastLatLng() {
      return MapState.lastLatLng;
    }
  };

  // Callback used by the Google Maps script tag
  window.fvMapInit = init;
})();