import { appState } from './store.js';
import { $, setDebug } from './dom.js';
import { clamp, toNum } from './utils.js';

export function waitForGoogleMaps(timeoutMs=20000){
  const started = Date.now();
  return new Promise((resolve, reject)=>{
    const tick = ()=>{
      if (window.google && window.google.maps){
        resolve(window.google.maps);
        return;
      }
      if (Date.now() - started > timeoutMs){
        reject(new Error('Google Maps is still loading.'));
        return;
      }
      setTimeout(tick, 80);
    };
    tick();
  });
}

export function ensureMap(){
  if (appState.map) return appState.map;
  if (!(window.google && window.google.maps)) throw new Error('Google Maps not loaded.');

  appState.map = new google.maps.Map($('rainMap'), {
    center: { lat:39.72, lng:-89.67 },
    zoom: 8,
    mapTypeId: google.maps.MapTypeId.HYBRID,
    streetViewControl: false,
    fullscreenControl: false,
    mapTypeControl: false,
    clickableIcons: false,
    gestureHandling: 'greedy',
    zoomControl: false
  });

  appState.infoWindow = new google.maps.InfoWindow();

  appState.map.addListener('click', (ev)=>{
    if (window.FVRainMapHandleTap) window.FVRainMapHandleTap(ev);
  });

  appState.map.addListener('zoom_changed', ()=>{
    if (appState.lastTapTargets.length && window.FVRainMapUpdateTapTargets){
      window.FVRainMapUpdateTapTargets();
    }
  });

  return appState.map;
}

export function updateMapStyle(){
  if (!appState.map) return;
  const v = String($('viewSel')?.value || 'hybrid').toLowerCase();
  if (v === 'terrain') appState.map.setMapTypeId(google.maps.MapTypeId.TERRAIN);
  else if (v === 'roadmap') appState.map.setMapTypeId(google.maps.MapTypeId.ROADMAP);
  else appState.map.setMapTypeId(google.maps.MapTypeId.HYBRID);
}

export function clearMapOverlays(){
  appState.mapCircles.forEach(x=>{
    try{ x.setMap(null); }catch(_){}
  });
  appState.fieldMarkers.forEach(x=>{
    try{ x.setMap(null); }catch(_){}
  });

  appState.mapCircles = [];
  appState.fieldMarkers = [];
  appState.lastTapTargets = [];

  if (appState.infoWindow){
    try{ appState.infoWindow.close(); }catch(_){}
  }
}

export function fitToFields(rows){
  if (!appState.map || !Array.isArray(rows) || !rows.length || !(window.google && google.maps && google.maps.LatLngBounds)) return;

  if (rows.length === 1){
    const only = rows[0];
    const lat = toNum(only.lat ?? (only.location && only.location.lat));
    const lng = toNum(only.lng ?? (only.location && only.location.lng));
    if (lat == null || lng == null) return;
    appState.map.setCenter({ lat, lng });
    if ((appState.map.getZoom() || 0) < 11) appState.map.setZoom(11);
    return;
  }

  const bounds = new google.maps.LatLngBounds();
  let added = 0;

  rows.forEach(r=>{
    const lat = toNum(r.lat ?? (r.location && r.location.lat));
    const lng = toNum(r.lng ?? (r.location && r.location.lng));
    if (lat == null || lng == null) return;
    bounds.extend({ lat, lng });
    added++;
  });

  if (!added) return;

  appState.map.fitBounds(bounds, {
    top: 60,
    right: 60,
    bottom: 60,
    left: 60
  });

  google.maps.event.addListenerOnce(appState.map, 'idle', ()=>{
    const z = appState.map.getZoom() || 0;
    if (z > 13) appState.map.setZoom(13);
  });
}

export function metersPerPixelAtLat(lat, zoom){
  const safeLat = clamp(Number(lat || 0), -85, 85);
  const z = Number.isFinite(Number(zoom)) ? Number(zoom) : 8;
  return (156543.03392 * Math.cos(safeLat * Math.PI / 180)) / Math.pow(2, z);
}

export function approxDistanceMeters(lat1, lng1, lat2, lng2){
  const midLat = ((Number(lat1) + Number(lat2)) / 2) * Math.PI / 180;
  const dLat = (Number(lat2) - Number(lat1)) * 111320;
  const dLng = (Number(lng2) - Number(lng1)) * (111320 * Math.cos(midLat));
  return Math.sqrt((dLat * dLat) + (dLng * dLng));
}

export function updateTapTargetsForCurrentZoom(){
  if (!Array.isArray(appState.lastTapTargets) || !appState.lastTapTargets.length) return;
  const zoom = appState.map ? (appState.map.getZoom() || 8) : 8;

  appState.lastTapTargets.forEach(t=>{
    const lat = Number(t.lat || 0);
    const base = Number(t.blobOuterRadiusMeters || t.hitRadiusMeters || 320);
    const minPx = t.kind === 'readiness' ? 26 : 30;
    const minMeters = metersPerPixelAtLat(lat, zoom) * minPx;
    t.hitRadiusMeters = Math.max(base, minMeters);
  });
}

export function nearestTapTarget(lat, lng){
  if (!Array.isArray(appState.lastTapTargets) || !appState.lastTapTargets.length) return null;

  let best = null;
  let bestDist = Infinity;

  appState.lastTapTargets.forEach(t=>{
    const d = approxDistanceMeters(lat, lng, t.lat, t.lng);
    const hr = Number(t.hitRadiusMeters || 0);
    if (d <= hr && d < bestDist){
      best = t;
      bestDist = d;
    }
  });

  if (best) return best;

  appState.lastTapTargets.forEach(t=>{
    const d = approxDistanceMeters(lat, lng, t.lat, t.lng);
    if (d < bestDist){
      best = t;
      bestDist = d;
    }
  });

  return bestDist <= 800 ? best : null;
}

export function ensureMapLoadingOverlay(){
  let el = document.getElementById('mapLoadingOverlay');
  if (el) return el;

  const host = document.querySelector('.map-stage') || document.body;
  if (!host) return null;

  el = document.createElement('div');
  el.id = 'mapLoadingOverlay';
  el.style.position = 'absolute';
  el.style.inset = '0';
  el.style.zIndex = '34';
  el.style.display = 'none';
  el.style.alignItems = 'center';
  el.style.justifyContent = 'center';
  el.style.background = 'rgba(12,16,13,0.18)';
  el.style.backdropFilter = 'blur(2px)';
  el.style.webkitBackdropFilter = 'blur(2px)';
  el.style.pointerEvents = 'none';

  const card = document.createElement('div');
  card.style.display = 'grid';
  card.style.placeItems = 'center';
  card.style.gap = '10px';
  card.style.minWidth = '120px';
  card.style.padding = '16px 18px';
  card.style.borderRadius = '18px';
  card.style.background = 'rgba(255,255,255,0.94)';
  card.style.boxShadow = '0 14px 36px rgba(0,0,0,.18)';
  card.style.border = '1px solid rgba(0,0,0,.08)';
  card.style.color = '#18211b';

  const spinner = document.createElement('div');
  spinner.style.width = '34px';
  spinner.style.height = '34px';
  spinner.style.borderRadius = '999px';
  spinner.style.border = '3px solid rgba(47,108,60,0.18)';
  spinner.style.borderTopColor = '#2F6C3C';
  spinner.style.animation = 'fvMapSpin 0.8s linear infinite';

  const label = document.createElement('div');
  label.id = 'mapLoadingLabel';
  label.style.fontSize = '13px';
  label.style.fontWeight = '900';
  label.style.letterSpacing = '.02em';
  label.textContent = 'Loading map…';

  card.appendChild(spinner);
  card.appendChild(label);
  el.appendChild(card);

  if (!document.getElementById('fvMapSpinStyle')){
    const style = document.createElement('style');
    style.id = 'fvMapSpinStyle';
    style.textContent = `
      @keyframes fvMapSpin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }

  host.appendChild(el);
  return el;
}

export function showMapLoading(message='Loading map…'){
  const el = ensureMapLoadingOverlay();
  if (!el) return;
  const label = document.getElementById('mapLoadingLabel');
  if (label) label.textContent = String(message || 'Loading map…');
  el.style.display = 'flex';
}

export function hideMapLoading(){
  const el = document.getElementById('mapLoadingOverlay');
  if (el) el.style.display = 'none';
}
