/* =====================================================================
/Farm-vista/js/rainfallmap/render-flow.js   (FULL FILE)
Rev: 2026-03-17a-force-map-mode-select-sync

PURPOSE
✔ Controls rendering flow for Rainfall and Readiness map modes
✔ Handles caching, drawing, map loading indicators, and state updates
✔ Ensures rainfall blobs update when date range changes

FIX IN THIS REV
✔ Force-syncs the actual map mode dropdown to the live active mode
✔ Prevents startup/render flow from leaving the select stuck on Rainfall
✔ Rainfall blobs still reload automatically when date range changes
✔ Cache key still reflects the active date range
✔ Cache bypass still occurs when range changes so blobs don't stay on old data

DANE NOTE
If the user changes the time frame from the date picker, rainfall
blobs should immediately refresh without pressing Reload.
===================================================================== */

import { appState } from './store.js';
import {
  setStatus,
  setDebug,
  setFieldsMeta,
  setPointMeta,
  setModeText,
  setModeChip
} from './dom.js';
import {
  ensureMap,
  updateMapStyle,
  clearMapOverlays,
  showMapLoading,
  hideMapLoading
} from './map-core.js';
import {
  syncCurrentRangeFromPicker,
  getCurrentRangeDisplay
} from './date-range.js';
import { getSelectedFarmId } from './selection.js';
import { cacheRangeResult, getCachedRangeResult } from './cache.js';
import {
  buildRainScale,
  updateRainLegend,
  updateReadinessLegend
} from './legend.js';
import {
  buildRainRenderableRows,
  buildReadinessRenderableRows
} from './builders.js';
import {
  drawRainBlobs,
  drawReadinessMarkers,
  blendRadiusMeters
} from './renderers.js';

function safeErrMsg(e, fallback){
  return String((e && (e.message || e.code)) || e || fallback || 'error');
}

function normalizeMapMode(mode){
  return String(mode || '').toLowerCase() === 'readiness' ? 'readiness' : 'rainfall';
}

function syncMapModeSelect(){
  try{
    appState.currentMapMode = normalizeMapMode(appState.currentMapMode);

    const sel = document.getElementById('mapModeSel');
    if (sel){
      sel.value = appState.currentMapMode;
    }

    const rainModeSection = document.getElementById('rainModeSection');
    const readinessModeSection = document.getElementById('readinessModeSection');
    const isReadiness = appState.currentMapMode === 'readiness';

    if (rainModeSection) rainModeSection.hidden = isReadiness;
    if (readinessModeSection) readinessModeSection.hidden = !isReadiness;
  }catch(_){}
}

function applyCachedRain(cached){
  appState.lastFieldSummaries = Array.isArray(cached?.summaries) ? cached.summaries : [];
  appState.lastRenderedFields = Array.isArray(cached?.renderedFields) ? cached.renderedFields : [];
  appState.lastScaleMeta = cached?.scale || null;

  drawRainBlobs(
    Array.isArray(cached?.points) ? cached.points : [],
    Array.isArray(cached?.renderedFields) ? cached.renderedFields : [],
    cached?.scale || buildRainScale([0])
  );
}

function applyCachedReadiness(cached){
  appState.lastFieldSummaries = Array.isArray(cached?.summaries) ? cached.summaries : [];
  appState.lastRenderedFields = Array.isArray(cached?.renderedFields) ? cached.renderedFields : [];

  drawReadinessMarkers(
    Array.isArray(cached?.renderedFields) ? cached.renderedFields : []
  );
}

function resetEmptyRainState(){
  clearMapOverlays();
  setFieldsMeta(0);
  setPointMeta(0);
  updateRainLegend(buildRainScale([0]));
  setStatus('No data');
  setDebug(`no renderable rainfall rows • range=${getCurrentRangeDisplay()}`);
}

function resetEmptyReadinessState(){
  clearMapOverlays();
  setFieldsMeta(0);
  setPointMeta(0);
  updateReadinessLegend();
  setStatus('No data');
  setDebug('no readiness rows built');
}

function ensureMapReadyForRender(){
  ensureMap();
  updateMapStyle();
}

export async function renderRain(force = false){
  const requestId = ++appState.currentRequestId;

  try{
    syncCurrentRangeFromPicker(false);
  }catch(e){
    console.warn('[WeatherMap] range sync failed:', e);
  }

  try{
    ensureMapReadyForRender();
  }catch(e){
    setStatus('Map failed');
    setDebug(safeErrMsg(e, 'map error'));
    return;
  }

  const cacheKey = `rain:${appState.currentRangeKey}:${getSelectedFarmId() || '__all__'}:${blendRadiusMeters()}`;

  const cached = (!force && appState.lastRangeKey === appState.currentRangeKey)
    ? getCachedRangeResult(cacheKey)
    : null;

  appState.lastRangeKey = appState.currentRangeKey;

  if (cached && Array.isArray(cached.points) && cached.points.length){
    try{
      applyCachedRain(cached);
      setStatus('Cached');
      setDebug(
        `cached rain • range=${getCurrentRangeDisplay()} • fields=${Array.isArray(cached?.renderedFields) ? cached.renderedFields.length : 0} • points=${Array.isArray(cached?.points) ? cached.points.length : 0}`
      );
    }catch(e){
      console.warn('[WeatherMap] cached rain draw failed:', e);
    }
  } else {
    setStatus('Loading…');
    setDebug('loading MRMS docs…');
  }

  try{
    const res = await buildRainRenderableRows(requestId, force);
    if (!res || res.cancelled || requestId !== appState.currentRequestId) return;

    const points = Array.isArray(res.points) ? res.points : [];
    const summaries = Array.isArray(res.summaries) ? res.summaries : [];
    const renderedFields = Array.isArray(res.renderedFields) ? res.renderedFields : [];

    const values = points
      .map(p => Number(p?.rainInches || 0))
      .filter(v => Number.isFinite(v));

    const scale = buildRainScale(values);

    appState.lastFieldSummaries = summaries;
    appState.lastRenderedFields = renderedFields;
    appState.lastScaleMeta = scale;

    if (!points.length || !renderedFields.length){
      resetEmptyRainState();
      return;
    }

    cacheRangeResult(cacheKey, { points, summaries, renderedFields, scale });

    drawRainBlobs(points, renderedFields, scale);

    const hasAnyRain = points.some(p => Number(p?.rainInches || 0) > 0);
    setStatus(hasAnyRain ? 'Live' : 'Live (0 rain)');
    setDebug(
      `range=${getCurrentRangeDisplay()} • fields=${renderedFields.length} • points=${points.length}`
    );
  }catch(e){
    console.warn('[WeatherMap] rain render failed:', e);

    const fallback = getCachedRangeResult(cacheKey);
    if (fallback){
      try{
        applyCachedRain(fallback);
        setStatus('Cached');
        setDebug('live failed • showing cached');
        return;
      }catch(drawErr){
        console.warn('[WeatherMap] rain fallback draw failed:', drawErr);
      }
    }

    clearMapOverlays();
    setFieldsMeta(0);
    setPointMeta(0);
    setStatus('Load failed');
    setDebug(safeErrMsg(e, 'render failed'));
  }
}

export async function renderReadiness(force = false){
  const requestId = ++appState.currentRequestId;

  try{
    ensureMapReadyForRender();
  }catch(e){
    setStatus('Map failed');
    setDebug(safeErrMsg(e, 'map error'));
    return;
  }

  const cacheKey = `readiness:${getSelectedFarmId() || '__all__'}`;
  const cached = !force ? getCachedRangeResult(cacheKey) : null;

  if (cached && Array.isArray(cached.renderedFields) && cached.renderedFields.length){
    try{
      applyCachedReadiness(cached);
      setStatus('Cached');
      setDebug(`cached readiness • fields=${Array.isArray(cached?.renderedFields) ? cached.renderedFields.length : 0}`);
    }catch(e){
      console.warn('[WeatherMap] cached readiness draw failed:', e);
    }
  } else {
    setStatus('Loading…');
    setDebug('loading readiness from Firestore…');
  }

  try{
    const res = await buildReadinessRenderableRows(requestId, force);
    if (!res || res.cancelled || requestId !== appState.currentRequestId) return;

    const summaries = Array.isArray(res.summaries) ? res.summaries : [];
    const renderedFields = Array.isArray(res.renderedFields) ? res.renderedFields : [];

    appState.lastFieldSummaries = summaries;
    appState.lastRenderedFields = renderedFields;

    if (!renderedFields.length){
      resetEmptyReadinessState();
      return;
    }

    cacheRangeResult(cacheKey, { summaries, renderedFields });
    drawReadinessMarkers(renderedFields);
    setStatus('Live');
    setDebug(`readiness • fields=${renderedFields.length} • markers=${renderedFields.length}`);
  }catch(e){
    console.warn('[WeatherMap] readiness render failed:', e);

    const fallback = getCachedRangeResult(cacheKey);
    if (fallback){
      try{
        applyCachedReadiness(fallback);
        setStatus('Cached');
        setDebug('live failed • showing cached');
        return;
      }catch(drawErr){
        console.warn('[WeatherMap] readiness fallback draw failed:', drawErr);
      }
    }

    clearMapOverlays();
    setFieldsMeta(0);
    setPointMeta(0);
    setStatus('Load failed');
    setDebug(safeErrMsg(e, 'readiness render failed'));
  }
}

export async function renderActiveMode(force = false){
  appState.currentMapMode = normalizeMapMode(appState.currentMapMode);

  syncMapModeSelect();

  if (appState.currentMapMode === 'readiness'){
    setModeText('Readiness');
    setModeChip('Readiness Map');
    updateReadinessLegend();
    showMapLoading('Loading readiness…');

    try{
      await renderReadiness(force);
    }finally{
      syncMapModeSelect();
      hideMapLoading();
    }

    return;
  }

  setModeText('Rainfall');
  setModeChip('Rainfall Map');
  if (appState.lastScaleMeta){
    updateRainLegend(appState.lastScaleMeta);
  }
  showMapLoading('Loading rainfall…');

  try{
    await renderRain(force);
  }finally{
    syncMapModeSelect();
    hideMapLoading();
  }
}