import { appState } from './store.js';
import { setStatus, setDebug, setFieldsMeta, setPointMeta, setModeText, setModeChip } from './dom.js';
import { ensureMap, updateMapStyle, clearMapOverlays, showMapLoading, hideMapLoading } from './map-core.js';
import { syncCurrentRangeFromPicker, getCurrentRangeDisplay } from './date-range.js';
import { getSelectedFarmId } from './selection.js';
import { cacheRangeResult, getCachedRangeResult } from './cache.js';
import { buildRainScale, updateRainLegend, updateReadinessLegend } from './legend.js';
import { buildRainRenderableRows, buildReadinessRenderableRows } from './builders.js';
import { drawRainBlobs, drawReadinessMarkers, blendRadiusMeters } from './renderers.js';

export async function renderRain(force=false){
  const requestId = ++appState.currentRequestId;
  syncCurrentRangeFromPicker(false);

  try{
    ensureMap();
    updateMapStyle();
  }catch(e){
    setStatus('Map failed');
    setDebug(String(e && e.message ? e.message : e || 'map error'));
    return;
  }

  const cacheKey = `rain:${appState.currentRangeKey}:${getSelectedFarmId() || '__all__'}:${blendRadiusMeters()}`;
  const cached = !force ? getCachedRangeResult(cacheKey) : null;

  if (cached && Array.isArray(cached.points) && cached.points.length){
    appState.lastFieldSummaries = Array.isArray(cached.summaries) ? cached.summaries : [];
    appState.lastRenderedFields = Array.isArray(cached.renderedFields) ? cached.renderedFields : [];
    appState.lastScaleMeta = cached.scale || null;
    drawRainBlobs(cached.points || [], cached.renderedFields || [], cached.scale);
    setStatus('Cached');
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
    const values = points.map(p => Number(p.rainInches || 0)).filter(v => Number.isFinite(v));
    const scale = buildRainScale(values);

    appState.lastFieldSummaries = summaries;
    appState.lastRenderedFields = renderedFields;
    appState.lastScaleMeta = scale;

    if (!points.length || !renderedFields.length){
      clearMapOverlays();
      setFieldsMeta(0);
      setPointMeta(0);
      updateRainLegend(buildRainScale([0]));
      setStatus('No data');
      setDebug('no renderable rainfall rows • range=' + getCurrentRangeDisplay());
      return;
    }

    cacheRangeResult(cacheKey, { points, summaries, renderedFields, scale });
    drawRainBlobs(points, renderedFields, scale);
    const hasAnyRain = points.some(p => Number(p.rainInches || 0) > 0);
    setStatus(hasAnyRain ? 'Live' : 'Live (0 rain)');
  }catch(e){
    console.warn('[WeatherMap] rain render failed:', e);

    const fallback = getCachedRangeResult(cacheKey);
    if (fallback){
      appState.lastFieldSummaries = Array.isArray(fallback.summaries) ? fallback.summaries : [];
      appState.lastRenderedFields = Array.isArray(fallback.renderedFields) ? fallback.renderedFields : [];
      appState.lastScaleMeta = fallback.scale || null;
      drawRainBlobs(fallback.points || [], fallback.renderedFields || [], fallback.scale);
      setStatus('Cached');
      setDebug('live failed • showing cached');
      return;
    }

    clearMapOverlays();
    setFieldsMeta(0);
    setPointMeta(0);
    setStatus('Load failed');
    setDebug(String(e && e.message ? e.message : e || 'render failed'));
  }
}

export async function renderReadiness(force=false){
  const requestId = ++appState.currentRequestId;

  try{
    ensureMap();
    updateMapStyle();
  }catch(e){
    setStatus('Map failed');
    setDebug(String(e && e.message ? e.message : e || 'map error'));
    return;
  }

  const cacheKey = `readiness:${getSelectedFarmId() || '__all__'}`;
  const cached = !force ? getCachedRangeResult(cacheKey) : null;

  if (cached && Array.isArray(cached.renderedFields) && cached.renderedFields.length){
    appState.lastFieldSummaries = Array.isArray(cached.summaries) ? cached.summaries : [];
    appState.lastRenderedFields = Array.isArray(cached.renderedFields) ? cached.renderedFields : [];
    drawReadinessMarkers(cached.renderedFields || []);
    setStatus('Cached');
  } else {
    setStatus('Loading…');
    setDebug('building readiness runs…');
  }

  try{
    const res = await buildReadinessRenderableRows(requestId, force);
    if (!res || res.cancelled || requestId !== appState.currentRequestId) return;

    const summaries = Array.isArray(res.summaries) ? res.summaries : [];
    const renderedFields = Array.isArray(res.renderedFields) ? res.renderedFields : [];

    appState.lastFieldSummaries = summaries;
    appState.lastRenderedFields = renderedFields;

    if (!renderedFields.length){
      clearMapOverlays();
      setFieldsMeta(0);
      setPointMeta(0);
      updateReadinessLegend();
      setStatus('No data');
      setDebug('no readiness rows built');
      return;
    }

    cacheRangeResult(cacheKey, { summaries, renderedFields });
    drawReadinessMarkers(renderedFields);
    setStatus('Live');
  }catch(e){
    console.warn('[WeatherMap] readiness render failed:', e);

    const fallback = getCachedRangeResult(cacheKey);
    if (fallback){
      appState.lastFieldSummaries = Array.isArray(fallback.summaries) ? fallback.summaries : [];
      appState.lastRenderedFields = Array.isArray(fallback.renderedFields) ? fallback.renderedFields : [];
      drawReadinessMarkers(fallback.renderedFields || []);
      setStatus('Cached');
      setDebug('live failed • showing cached');
      return;
    }

    clearMapOverlays();
    setFieldsMeta(0);
    setPointMeta(0);
    setStatus('Load failed');
    setDebug(String(e && e.message ? e.message : e || 'readiness render failed'));
  }
}

export async function renderActiveMode(force=false){
  clearMapOverlays();
  setFieldsMeta(0);
  setPointMeta(0);

  if (appState.currentMapMode === 'readiness'){
    setModeText('Readiness');
    setModeChip('Readiness Map');
    showMapLoading('Loading readiness…');
    try{
      await renderReadiness(force);
    }finally{
      hideMapLoading();
    }
  } else {
    setModeText('Rainfall');
    setModeChip('Rainfall Map');
    showMapLoading('Loading rainfall…');
    try{
      await renderRain(force);
    }finally{
      hideMapLoading();
    }
  }
}
