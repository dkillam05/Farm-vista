/* =====================================================================
/Farm-vista/js/rainfallmap/renderers.js   (FULL FILE)
Rev: 2026-03-15b-label-and-reset-tap-targets

PURPOSE
✔ Draws rainfall blobs and readiness markers on the Google Map
✔ Updates tap targets for blob/marker hit detection
✔ Updates legend and debug/meta text after rendering

FIX IN THIS REV
✔ File clearly labeled at top
✔ Resets appState.lastTapTargets before each redraw
✔ Helps prevent stale popup hit targets from older renders
✔ Keeps current visual blob behavior intact

IMPORTANT NOTE
If rainfall values still stay stuck on old 72h dates after this,
the most likely remaining source is builders.js, where the rainfall
summaries/points are assembled for the selected range.
===================================================================== */

import { appState } from './store.js';
import { setDebug, setFieldsMeta, setPointMeta } from './dom.js';
import { toNum, colorFromGradientStops } from './utils.js';
import { getCurrentRangeDisplay } from './date-range.js';
import { normalizeRainValueForScale, normalizeReadinessValue, updateRainLegend, updateReadinessLegend } from './legend.js';
import { ensureMap, clearMapOverlays, fitToFields, updateTapTargetsForCurrentZoom } from './map-core.js';
import { getModelReadinessColor } from './readiness-core.js';
import { openPopupForHit } from './popups.js';

export function buildLayersForRain(n){
  if (n <= 0.18){
    return [
      { scale:1.75, opacity:0.028 + (n * 0.015) },
      { scale:1.28, opacity:0.042 + (n * 0.018) },
      { scale:0.95, opacity:0.060 + (n * 0.022) }
    ];
  }
  return [
    { scale:1.90, opacity:0.026 + (n * 0.020) },
    { scale:1.45, opacity:0.040 + (n * 0.024) },
    { scale:1.08, opacity:0.056 + (n * 0.028) },
    { scale:0.76, opacity:0.072 + (n * 0.032) }
  ];
}

export function blendRadiusMeters(){
  const n = Number(document.getElementById('radiusSel')?.value || 1800);
  return Number.isFinite(n) ? n : 1800;
}

export function drawRainBlobs(points, fields, scale){
  ensureMap();
  clearMapOverlays();

  // IMPORTANT:
  // Start fresh so old tap targets/popups do not survive a redraw.
  appState.lastTapTargets = [];

  const radius = blendRadiusMeters();
  updateRainLegend(scale);

  points.forEach(p=>{
    const lat = toNum(p.lat);
    const lng = toNum(p.lng);
    const rain = Number(p.rainInches || 0);
    if (lat == null || lng == null) return;

    const n = normalizeRainValueForScale(rain, scale);
    const color = colorFromGradientStops(n, scale.stops);
    const center = { lat, lng };

    const layers = buildLayersForRain(n);
    const outerScale = layers.reduce((m, layer)=> Math.max(m, Number(layer.scale || 0)), 1);
    const blobOuterRadiusMeters = radius * outerScale;

    const tapTarget = {
      kind: 'rainfall',
      fieldId: p.fieldId,
      fieldName: p.fieldName,
      pointLabel: p.pointLabel,
      lat: p.lat,
      lng: p.lng,
      blobOuterRadiusMeters,
      hitRadiusMeters: blobOuterRadiusMeters
    };

    layers.forEach((layer, layerIdx)=>{
      const circle = new google.maps.Circle({
        map: appState.map,
        center,
        radius: radius * layer.scale,
        strokeOpacity: 0,
        strokeWeight: 0,
        fillColor: color,
        fillOpacity: Math.min(0.14, layer.opacity),
        zIndex: 10 + layerIdx,
        clickable: true
      });

      circle.__tapTarget = tapTarget;
      circle.addListener('click', ()=> openPopupForHit(circle.__tapTarget));

      appState.mapCircles.push(circle);
    });

    appState.lastTapTargets.push(tapTarget);
  });

  updateTapTargetsForCurrentZoom();
  setPointMeta(points.length);
  setFieldsMeta(fields.length);
  fitToFields(fields);

  const sampleHit = appState.lastTapTargets[0] ? Math.round(appState.lastTapTargets[0].hitRadiusMeters) : 0;
  const floorLabel = scale.usedDynamicFloor
    ? `dynamic floor ${scale.domainMin.toFixed(2)}"`
    : 'zero floor';

  setDebug(
    'range=' + getCurrentRangeDisplay() +
    ' • fields=' + fields.length +
    ' • points=' + points.length +
    ' • tap≈' + sampleHit + 'm' +
    ' • ' + floorLabel +
    ' • max=' + Number(scale.domainMax || 0).toFixed(2) + '"'
  );
}

export function drawReadinessMarkers(fields){
  ensureMap();
  clearMapOverlays();

  // IMPORTANT:
  // Start fresh so old tap targets do not survive a redraw.
  appState.lastTapTargets = [];

  updateReadinessLegend();

  const radius = blendRadiusMeters();

  fields.forEach(f=>{
    const lat = toNum(f.lat);
    const lng = toNum(f.lng);
    const readiness = Number(f.readiness);
    if (lat == null || lng == null || !Number.isFinite(readiness)) return;

    const n = normalizeReadinessValue(readiness);
    const color = getModelReadinessColor(appState.readinessState, Math.round(readiness));
    const center = { lat, lng };

    const layers = buildLayersForRain(n);
    const outerScale = layers.reduce((m, layer)=> Math.max(m, Number(layer.scale || 0)), 1);
    const blobOuterRadiusMeters = radius * outerScale;

    const tapTarget = {
      kind: 'readiness',
      fieldId: f.fieldId,
      fieldName: f.fieldName,
      lat,
      lng,
      pointLabel: 'Field',
      blobOuterRadiusMeters,
      hitRadiusMeters: blobOuterRadiusMeters
    };

    layers.forEach((layer, layerIdx)=>{
      const circle = new google.maps.Circle({
        map: appState.map,
        center,
        radius: radius * layer.scale,
        strokeOpacity: 0,
        strokeWeight: 0,
        fillColor: color,
        fillOpacity: Math.min(0.75, Number(layer.opacity || 0) + 0.25),
        zIndex: 20 + layerIdx,
        clickable: true
      });

      circle.__tapTarget = tapTarget;
      circle.addListener('click', ()=> openPopupForHit(circle.__tapTarget));

      appState.mapCircles.push(circle);
    });

    appState.lastTapTargets.push(tapTarget);
  });

  updateTapTargetsForCurrentZoom();
  setPointMeta(fields.length);
  setFieldsMeta(fields.length);
  fitToFields(fields);

  const sampleHit = appState.lastTapTargets[0] ? Math.round(appState.lastTapTargets[0].hitRadiusMeters) : 0;

  setDebug(
    'readiness' +
    ' • fields=' + fields.length +
    ' • points=' + fields.length +
    ' • tap≈' + sampleHit + 'm' +
    ' • radius=' + Math.round(radius) + 'm'
  );
}
