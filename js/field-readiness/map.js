/* =====================================================================
/Farm-vista/js/field-readiness/map.js  (FULL FILE)
Rev: 2025-12-28b

Fix (per Dane):
✅ Map actually renders (adds missing CSS: map-wrap height + canvas 100%)
✅ Map modal appears ABOVE Quick View (z-index bump on open, reset on close)
✅ Still uses existing HTML ids:
   - btnMap (main page) if present
   - mapBackdrop, btnMapX, mapSub, mapError, mapWrap, fvMapCanvas, mapLatLng
✅ Uses page Google Maps script (window.google.maps), with fallback injection

No new tabs/windows. Uses in-page modal.
===================================================================== */
'use strict';

function $(id){ return document.getElementById(id); }

function ensureMapModalStylesOnce(){
  try{
    if (window.__FV_FR_MAPSTYLE__) return;
    window.__FV_FR_MAPSTYLE__ = true;

    const st = document.createElement('style');
    st.setAttribute('data-fv-fr-mapstyle','1');
    st.textContent = `
      /* Map modal sizing (was missing in current HTML) */
      #mapBackdrop .modal.map-modal,
      #mapBackdrop .modal{
        width: min(880px, 96vw);
      }

      #mapWrap.map-wrap,
      #mapWrap{
        border:1px solid var(--border);
        border-radius:14px;
        overflow:hidden;
        background:var(--surface);
        height:min(58vh, 520px);
      }
      @media (max-width:560px){
        #mapWrap.map-wrap,
        #mapWrap{
          height:min(52vh, 420px);
        }
      }

      #fvMapCanvas{
        width:100%;
        height:100%;
        min-height: 220px; /* safety net */
      }

      /* Make sure the map modal can sit above Quick View when needed */
      #mapBackdrop{
        z-index: 99999; /* base */
      }
      #mapBackdrop.fv-map-top{
        z-index: 100200 !important;
      }
    `;
    document.head.appendChild(st);
  }catch(_){}
}

function getMapsKey(){
  const k1 = (window && window.FV_GOOGLE_MAPS_KEY) ? String(window.FV_GOOGLE_MAPS_KEY) : '';
  let k2 = '';
  try{ k2 = String(localStorage.getItem('fv_google_maps_key') || ''); }catch(_){}
  return (k1 || k2 || '').trim();
}

function showModal(backdropId, on){
  const b = $(backdropId);
  if (b) b.classList.toggle('pv-hide', !on);
}

function setMapError(msg){
  const el = $('mapError');
  const wrap = $('mapWrap');
  if (el){
    if (!msg){
      el.style.display = 'none';
      el.textContent = '';
    } else {
      el.style.display = 'block';
      el.textContent = msg;
    }
  }
  if (wrap) wrap.style.opacity = msg ? '0.65' : '1';
}

function ensureGoogleMapsLoaded(state){
  if (state._mapsPromise) return state._mapsPromise;

  state._mapsPromise = new Promise((resolve, reject)=>{
    if (window.google && window.google.maps){
      resolve(window.google.maps);
      return;
    }

    const t0 = Date.now();
    const tick = ()=>{
      if (window.google && window.google.maps) return resolve(window.google.maps);

      if (Date.now() - t0 > 15000){
        const key = getMapsKey();
        if (!key) return reject(new Error('Google Maps not loaded. Missing key.'));
        const existing = document.querySelector('script[data-fv-google-maps="1"]');
        if (existing) return reject(new Error('Google Maps load timeout.'));

        const s = document.createElement('script');
        s.setAttribute('data-fv-google-maps','1');
        s.async = true;
        s.defer = true;
        s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly`;
        s.onload = ()=>{
          if (window.google && window.google.maps) resolve(window.google.maps);
          else reject(new Error('Google Maps loaded but google.maps is missing.'));
        };
        s.onerror = ()=> reject(new Error('Failed to load Google Maps script.'));
        document.head.appendChild(s);
        return;
      }

      setTimeout(tick, 60);
    };
    tick();
  });

  return state._mapsPromise;
}

/* When opening from Quick View, this forces the map modal above it */
function bumpMapOnTop(on){
  try{
    const b = $('mapBackdrop');
    if (!b) return;
    b.classList.toggle('fv-map-top', !!on);
  }catch(_){}
}

async function openMapModal(state){
  ensureMapModalStylesOnce();

  const f = (state.fields || []).find(x=>x.id === state.selectedFieldId);
  if (!f || !f.location) return;

  const lat = Number(f.location.lat);
  const lng = Number(f.location.lng);
  if (!isFinite(lat) || !isFinite(lng)) return;

  const sub = $('mapSub');
  if (sub) sub.textContent = (f.name ? `${f.name}` : 'Field') + ' • HYBRID';

  const ll = $('mapLatLng');
  if (ll) ll.textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

  setMapError('');

  // ✅ show and bring on top (important when Quick View is open)
  bumpMapOnTop(true);
  showModal('mapBackdrop', true);

  // Build map after modal is visible (canvas has size)
  setTimeout(async ()=>{
    try{
      const maps = await ensureGoogleMapsLoaded(state);

      const canvas = $('fvMapCanvas');
      if (!canvas) throw new Error('Map canvas missing.');

      const center = { lat, lng };

      if (!state._gmap){
        state._gmap = new maps.Map(canvas, {
          center,
          zoom: 16,
          mapTypeId: maps.MapTypeId.HYBRID,
          streetViewControl: false,
          fullscreenControl: false,
          mapTypeControl: true,
          clickableIcons: false
        });
      } else {
        state._gmap.setCenter(center);
        state._gmap.setZoom(16);
        state._gmap.setMapTypeId(maps.MapTypeId.HYBRID);
      }

      if (!state._gmarker){
        state._gmarker = new maps.Marker({ position: center, map: state._gmap });
      } else {
        state._gmarker.setMap(state._gmap);
        state._gmarker.setPosition(center);
      }

      setTimeout(()=>{
        try{ maps.event.trigger(state._gmap, 'resize'); }catch(_){}
        try{ state._gmap.setCenter(center); }catch(_){}
      }, 80);

    }catch(e){
      console.warn('[FieldReadiness] map open failed:', e);
      setMapError(e?.message || 'Map failed to load.');
    }
  }, 0);
}

function closeMapModal(){
  showModal('mapBackdrop', false);
  bumpMapOnTop(false);
}

export function initMap(state){
  ensureMapModalStylesOnce();

  // Main page button (if still present somewhere)
  const btnMap = $('btnMap');
  if (btnMap){
    btnMap.addEventListener('click', (e)=>{
      e.preventDefault();
      e.stopPropagation();
      openMapModal(state);
    });
  }

  const btnMapX = $('btnMapX');
  if (btnMapX) btnMapX.addEventListener('click', closeMapModal);

  const b = $('mapBackdrop');
  if (b){
    b.addEventListener('click', (e)=>{
      if (e.target && e.target.id === 'mapBackdrop') closeMapModal();
    });
  }

  // ✅ Allow other modules (Quick View) to request opening map on top
  // Dispatch: document.dispatchEvent(new CustomEvent('fr:open-map'))
  if (!state._mapEventWired){
    state._mapEventWired = true;
    document.addEventListener('fr:open-map', (e)=>{
      try{
        // Optional detail: { fieldId }
        const fid = e && e.detail && e.detail.fieldId ? String(e.detail.fieldId) : '';
        if (fid){
          state.selectedFieldId = fid;
        }
      }catch(_){}
      openMapModal(state);
    });
  }
}