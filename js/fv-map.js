// ====================================================================
// /Farm-vista/js/fv-map.js
// Reusable map picker with pin drop → writes lat/lng to provided inputs
// Depends on Leaflet (L) being loaded separately.
// ====================================================================
(function (global) {
  "use strict";

  const CSS_ID = "fv-map-picker-style";

  function injectStyles() {
    if (document.getElementById(CSS_ID)) return;
    const css = `
      .fv-map-modal-backdrop{
        position:fixed;inset:0;
        background:rgba(0,0,0,.45);
        z-index:100000;
        display:none;
        align-items:center;
        justify-content:center;
      }
      .fv-map-modal-backdrop.show{display:flex;}
      .fv-map-modal-shell{
        position:relative;
        width:min(100vw,900px);
        max-width:94vw;
        max-height:92vh;
        background:var(--surface,#fff);
        border-radius:14px;
        border:1px solid var(--border,#d0d3cf);
        box-shadow:0 20px 40px rgba(0,0,0,.35);
        display:flex;
        flex-direction:column;
        overflow:hidden;
      }
      .fv-map-modal-header{
        padding:10px 14px;
        border-bottom:1px solid var(--border,#d0d3cf);
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:8px;
        font-weight:800;
        color:var(--text,#222);
      }
      .fv-map-modal-title{font-size:16px;}
      .fv-map-modal-close{
        border:none;
        background:transparent;
        cursor:pointer;
        padding:4px 8px;
        border-radius:10px;
        color:inherit;
        font:inherit;
        font-weight:800;
      }
      .fv-map-modal-close:hover{
        background:var(--hover,rgba(0,0,0,.06));
      }
      .fv-map-modal-body{
        flex:1 1 auto;
        min-height:260px;
        display:flex;
        flex-direction:column;
      }
      .fv-map-toolbar{
        padding:8px 10px;
        border-bottom:1px solid var(--border,#d0d3cf);
        display:flex;
        flex-wrap:wrap;
        align-items:center;
        gap:8px;
        font-size:13px;
        color:var(--muted,#67706B);
      }
      .fv-map-toolbar button{
        border-radius:999px;
        border:1px solid var(--border,#ccd0cb);
        background:var(--card-surface,var(--surface,#fff));
        padding:4px 10px;
        font:inherit;
        font-size:13px;
        cursor:pointer;
      }
      .fv-map-toolbar button[disabled]{
        opacity:.6;
        cursor:not-allowed;
      }
      .fv-map-toolbar button:hover:not([disabled]){
        background:var(--hover,rgba(0,0,0,.04));
      }
      .fv-map-toolbar span{
        white-space:nowrap;
      }
      .fv-map-container{
        flex:1 1 auto;
        min-height:220px;
      }
      .fv-map-footer{
        padding:10px;
        border-top:1px solid var(--border,#d0d3cf);
        display:flex;
        justify-content:flex-end;
        gap:10px;
      }
      .fv-map-btn{
        display:inline-flex;
        align-items:center;
        justify-content:center;
        min-width:120px;
        padding:8px 14px;
        border-radius:12px;
        border:1px solid var(--border,#ccd0cb);
        font-weight:800;
        cursor:pointer;
        background:var(--card-surface,var(--surface,#fff));
        color:var(--text,#222);
      }
      .fv-map-btn-primary{
        border-color:transparent;
        background:var(--green,#3B7E46);
        color:#fff;
      }
      .fv-map-btn[disabled]{
        opacity:.6;
        cursor:not-allowed;
      }
      .fv-map-coord{
        margin-left:auto;
        font-variant-numeric:tabular-nums;
      }
      @media (max-width:640px){
        .fv-map-modal-shell{
          width:100vw;
          max-width:100vw;
          height:100vh;
          max-height:100vh;
          border-radius:0;
        }
      }
    `;
    const style = document.createElement("style");
    style.id = CSS_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }

  function createModalDom() {
    injectStyles();

    const backdrop = document.createElement("div");
    backdrop.className = "fv-map-modal-backdrop";
    backdrop.setAttribute("aria-hidden", "true");

    const shell = document.createElement("div");
    shell.className = "fv-map-modal-shell";
    shell.setAttribute("role", "dialog");
    shell.setAttribute("aria-modal", "true");
    shell.setAttribute("aria-label", "Pick map location");

    const header = document.createElement("div");
    header.className = "fv-map-modal-header";
    const title = document.createElement("div");
    title.className = "fv-map-modal-title";
    title.textContent = "Pick location";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "fv-map-modal-close";
    closeBtn.textContent = "Close";
    header.append(title, closeBtn);

    const body = document.createElement("div");
    body.className = "fv-map-modal-body";

    const toolbar = document.createElement("div");
    toolbar.className = "fv-map-toolbar";
    const geoBtn = document.createElement("button");
    geoBtn.type = "button";
    geoBtn.textContent = "Use my location";
    geoBtn.id = "fvMapGeoBtn";
    const hint = document.createElement("span");
    hint.textContent = "Tap on the map to drop a pin.";
    const coord = document.createElement("span");
    coord.className = "fv-map-coord";
    coord.id = "fvMapCoord";
    coord.textContent = "";
    toolbar.append(geoBtn, hint, coord);

    const mapBox = document.createElement("div");
    mapBox.className = "fv-map-container";
    const mapInner = document.createElement("div");
    mapInner.id = "fvMapCanvas";
    mapInner.style.width = "100%";
    mapInner.style.height = "100%";
    mapBox.appendChild(mapInner);

    body.append(toolbar, mapBox);

    const footer = document.createElement("div");
    footer.className = "fv-map-footer";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "fv-map-btn";
    cancelBtn.textContent = "Cancel";
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "fv-map-btn fv-map-btn-primary";
    saveBtn.textContent = "Save location";
    footer.append(cancelBtn, saveBtn);

    shell.append(header, body, footer);
    backdrop.appendChild(shell);
    document.body.appendChild(backdrop);

    return {
      backdrop,
      closeBtn,
      cancelBtn,
      saveBtn,
      geoBtn,
      mapContainer: mapInner,
      coordEl: coord,
      titleEl: title
    };
  }

  const FVMapPicker = (function () {
    let modal = null;
    let map = null;
    let marker = null;
    let currentLatLng = null;
    let resolveCb = null;
    let rejectCb = null;
    let initialized = false;
    let lastConfig = null;

    function ensureLeaflet() {
      if (!global.L || typeof global.L.map !== "function") {
        alert("Map library not loaded. Please include Leaflet before fv-map.js.");
        return false;
      }
      return true;
    }

    function ensureModal() {
      if (modal) return modal;
      modal = createModalDom();

      modal.backdrop.addEventListener("click", function (e) {
        if (e.target === modal.backdrop) {
          hide({ cancelled: true });
        }
      });
      modal.closeBtn.addEventListener("click", function () {
        hide({ cancelled: true });
      });
      modal.cancelBtn.addEventListener("click", function () {
        hide({ cancelled: true });
      });
      modal.saveBtn.addEventListener("click", function () {
        if (!currentLatLng) {
          alert("Tap on the map to drop a pin first.");
          return;
        }
        hide({ cancelled: false });
      });

      modal.geoBtn.addEventListener("click", function () {
        if (!navigator.geolocation) {
          alert("Geolocation not supported on this device.");
          return;
        }
        modal.geoBtn.disabled = true;
        navigator.geolocation.getCurrentPosition(
          function (pos) {
            modal.geoBtn.disabled = false;
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            setLatLng(lat, lng, true);
          },
          function () {
            modal.geoBtn.disabled = false;
            alert("Could not get current location.");
          },
          { enableHighAccuracy: true, timeout: 8000 }
        );
      });

      return modal;
    }

    function setLatLng(lat, lng, pan) {
      if (!map) return;
      const ll = L.latLng(lat, lng);
      currentLatLng = ll;

      if (!marker) {
        marker = L.marker(ll, { draggable: true }).addTo(map);
        marker.on("dragend", function (e) {
          const pos = e.target.getLatLng();
          currentLatLng = pos;
          updateCoordText();
        });
      } else {
        marker.setLatLng(ll);
      }
      if (pan) map.setView(ll, map.getZoom() || 16);
      updateCoordText();
    }

    function updateCoordText() {
      if (!modal || !currentLatLng) return;
      modal.coordEl.textContent = currentLatLng
        ? currentLatLng.lat.toFixed(6) + ", " + currentLatLng.lng.toFixed(6)
        : "";
    }

    function buildMap(initialLat, initialLng) {
      if (!ensureLeaflet()) return;

      const m = ensureModal();
      if (!initialized) {
        map = L.map(m.mapContainer).setView([initialLat, initialLng], 15);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: '&copy; OpenStreetMap contributors'
        }).addTo(map);

        map.on("click", function (e) {
          setLatLng(e.latlng.lat, e.latlng.lng, false);
        });

        initialized = true;
      } else {
        map.invalidateSize();
        if (initialLat != null && initialLng != null) {
          map.setView([initialLat, initialLng], map.getZoom() || 15);
        }
      }

      if (initialLat != null && initialLng != null) {
        setLatLng(initialLat, initialLng, true);
      } else {
        currentLatLng = null;
        if (marker) {
          map.removeLayer(marker);
          marker = null;
        }
        updateCoordText();
      }
    }

    function show(config) {
      const m = ensureModal();
      lastConfig = config || {};
      const title = (config && config.title) || "Pick location";
      m.titleEl.textContent = title;

      const initialLat = typeof config.initialLat === "number" ? config.initialLat : null;
      const initialLng = typeof config.initialLng === "number" ? config.initialLng : null;

      m.backdrop.classList.add("show");
      m.backdrop.setAttribute("aria-hidden", "false");
      document.body.style.overflow = "hidden";

      setTimeout(function () {
        buildMap(
          initialLat != null ? initialLat : 39.8283,  // default center (US-ish)
          initialLng != null ? initialLng : -98.5795
        );
      }, 50);
    }

    function hide(reason) {
      if (!modal) return;
      modal.backdrop.classList.remove("show");
      modal.backdrop.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";

      const cancelled = !!(reason && reason.cancelled);
      if (cancelled) {
        if (typeof rejectCb === "function") {
          rejectCb({ cancelled: true });
        }
      } else {
        if (typeof resolveCb === "function") {
          const lat = currentLatLng ? currentLatLng.lat : null;
          const lng = currentLatLng ? currentLatLng.lng : null;
          resolveCb({ lat, lng, config: lastConfig || null });
        }
      }
      resolveCb = null;
      rejectCb = null;
    }

    /**
     * Main public API:
     * FVMapPicker.pickFor({ latInput, lngInput, initialLat, initialLng, title, onPicked })
     */
    function pickFor(options) {
      options = options || {};
      const latInput = options.latInput;
      const lngInput = options.lngInput;

      if (!latInput || !lngInput) {
        console.error("FVMapPicker: latInput and lngInput are required.");
        return;
      }

      const rawLat = latInput.value ? parseFloat(latInput.value) : null;
      const rawLng = lngInput.value ? parseFloat(lngInput.value) : null;

      const useLat = typeof options.initialLat === "number" ? options.initialLat : rawLat;
      const useLng = typeof options.initialLng === "number" ? options.initialLng : rawLng;

      if (!ensureLeaflet()) return;

      return new Promise(function (resolve, reject) {
        resolveCb = function (result) {
          const lat = result.lat;
          const lng = result.lng;
          if (lat != null && lng != null) {
            latInput.value = lat.toFixed(6);
            lngInput.value = lng.toFixed(6);
            if (typeof options.onPicked === "function") {
              options.onPicked({ lat, lng });
            }
          }
          resolve(result);
        };
        rejectCb = function (err) {
          if (options.onCancel) options.onCancel(err);
          reject(err);
        };

        show({
          title: options.title || "Pick location",
          initialLat: useLat,
          initialLng: useLng
        });
      });
    }

    return {
      pickFor
    };
  })();

  global.FVMapPicker = FVMapPicker;

})(window);