/* ======================================================================
   /Farm-vista/js/rainfallmap/builders.js
   FULL FILE REBUILD
   Fix:
   - rainfall map readiness now uses the SAME weather-warmed state
     as Quick View
====================================================================== */

import { appState } from './store.js';
import {
  loadFieldDocs,
  loadFarmDocs,
  loadMrmsDocs,
  loadPersistedStateMap
} from './data-loaders.js';

import { getSelectedFarmId } from './selection.js';
import {
  hasUsableRainData,
  buildFieldPoints,
  buildRainSummary,
  totalRainInLast72h
} from './rain-data.js';

import { setDebug } from './dom.js';

import { computeReadinessRunForMapField } from './readiness-core.js';

import { fetchAndHydrateFieldParams } from '/Farm-vista/js/field-readiness/data.js';
import { ensureFRModules } from '/Farm-vista/js/field-readiness/formula.js';
import { getCurrentOp } from '/Farm-vista/js/field-readiness/thresholds.js';

/* =====================================================================
   Rain builder
===================================================================== */

export async function buildRainRenderableRows(requestId, force=false){

  const rows = await loadMrmsDocs(force);

  if (requestId !== appState.currentRequestId) return { cancelled:true };

  const selectedFarmId = getSelectedFarmId();

  const usableRows = rows.filter(row=>{
    if (!hasUsableRainData(row.raw)) return false;
    if (!selectedFarmId) return true;
    return String(row.farmId || '') === String(selectedFarmId);
  });

  const points = [];
  const summaries = [];
  const renderedFields = [];

  usableRows.forEach(row=>{

    const fieldPoints = buildFieldPoints(row);
    const summary = buildRainSummary(row);

    if (!fieldPoints.length || !summary) return;

    renderedFields.push({
      fieldId: row.fieldId,
      fieldName: row.fieldName,
      farmId: row.farmId,
      lat: row.location.lat,
      lng: row.location.lng
    });

    summaries.push(summary);
    points.push(...fieldPoints);

  });

  return { points, summaries, renderedFields };
}

/* =====================================================================
   Readiness builder
===================================================================== */

export async function buildReadinessRenderableRows(requestId, force=false){

  const [fields, farms, mrmsRows, persistedMap] = await Promise.all([
    loadFieldDocs(force),
    loadFarmDocs(force),
    loadMrmsDocs(force),
    loadPersistedStateMap(force)
  ]);

  if (requestId !== appState.currentRequestId) return { cancelled:true };

  const selectedFarmId = getSelectedFarmId();
  const opKey = getCurrentOp();

  const farmMap = new Map();
  farms.forEach(f=>{
    farmMap.set(String(f.id || ''), String(f.name || ''));
  });

  const state = appState.readinessState;

  state.fields = Array.isArray(fields) ? fields.slice() : [];
  state.farmsById = farmMap;
  state.farmFilter = selectedFarmId || '__all__';
  state.persistedStateByFieldId = persistedMap || {};
  state._persistLoadedAt = Date.now();
  state.lastRuns = new Map();

  await ensureFRModules(state);

  const mrmsByFieldId = new Map();
  mrmsRows.forEach(r=>{
    if (r && r.fieldId) mrmsByFieldId.set(String(r.fieldId), r);
  });

  const renderedFields = [];
  const summaries = [];

  for (let i=0;i<fields.length;i++){

    if (requestId !== appState.currentRequestId) return { cancelled:true };

    const f = fields[i];

    if (!f || !f.id) continue;
    if (selectedFarmId && String(f.farmId || '') !== String(selectedFarmId)) continue;

    const lat = Number(f?.location?.lat ?? f.lat);
    const lng = Number(f?.location?.lng ?? f.lng ?? f.lon);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    setDebug(`building readiness ${i+1}/${fields.length} • ${f.name}`);

    try{
      await fetchAndHydrateFieldParams(state, f.id);
    }catch(e){
      console.warn('[WeatherMap] param load failed', f.id, e);
    }

    const run = await computeReadinessRunForMapField(
      state,
      {
        id:f.id,
        fieldId:f.id,
        name:f.name,
        farmId:f.farmId,
        county:f.county,
        state:f.state,
        location:{lat,lng}
      },
      opKey
    );

    if (!run) continue;

    const readiness = Number(run.readinessR);
    if (!Number.isFinite(readiness)) continue;

    const rain72hInches = totalRainInLast72h(
      (mrmsByFieldId.get(String(f.id)) || {}).raw
    );

    const rendered = {
      kind:'readiness',
      fieldId:f.id,
      fieldName:f.name,
      farmId:f.farmId,
      farmName:farmMap.get(String(f.farmId)) || '',
      county:f.county,
      state:f.state,
      lat,
      lng,
      readiness,
      rain72hInches
    };

    renderedFields.push(rendered);
    summaries.push(rendered);

    state.lastRuns.set(f.id, run);

  }

  return { summaries, renderedFields };
}
