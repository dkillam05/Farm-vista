/* ======================================================================
   /Farm-vista/js/rainfallmap/builders.js
   FULL FILE REBUILD
   Critical fix:
   - pass the SAME selected opKey into computeReadinessRunForMapField()
   so map readiness matches render.js / quickview math
   ====================================================================== */

import { appState } from './store.js';
import { loadFieldDocs, loadFarmDocs, loadMrmsDocs, loadPersistedStateMap } from './data-loaders.js';
import { getSelectedFarmId } from './selection.js';
import { hasUsableRainData, buildFieldPoints, buildRainSummary, totalRainInLast72h } from './rain-data.js';
import { setDebug } from './dom.js';
import { computeReadinessRunForMapField } from './readiness-core.js';
import { fetchAndHydrateFieldParams } from '/Farm-vista/js/field-readiness/data.js';
import { ensureFRModules } from '/Farm-vista/js/field-readiness/formula.js';
import { getCurrentOp } from '/Farm-vista/js/field-readiness/thresholds.js';

export async function buildRainRenderableRows(requestId, force=false){

  const rows = await loadMrmsDocs(force);
  if (requestId !== appState.currentRequestId) return { cancelled:true };

  const selectedFarmId = getSelectedFarmId();

  const usableRows = rows.filter(row => {
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

  appState.readinessState.fields = Array.isArray(fields) ? fields.slice() : [];
  appState.readinessState.farmsById = farmMap;
  appState.readinessState.farmFilter = selectedFarmId || '__all__';
  appState.readinessState.persistedStateByFieldId = persistedMap || {};
  appState.readinessState._persistLoadedAt = Date.now();
  appState.readinessState.lastRuns = new Map();

  await ensureFRModules(appState.readinessState);

  const mrmsByFieldId = new Map();
  mrmsRows.forEach(r=>{
    if (r && r.fieldId) mrmsByFieldId.set(String(r.fieldId), r);
  });

  const candidates = [];

  (Array.isArray(fields) ? fields : []).forEach(f=>{
    if (!f || !f.id) return;
    if (selectedFarmId && String(f.farmId || '') !== String(selectedFarmId)) return;

    const lat = Number(f?.location?.lat ?? f.lat);
    const lng = Number(f?.location?.lng ?? f.lng ?? f.lon);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const fid = String(f.id);
    const m = mrmsByFieldId.get(fid) || null;

    candidates.push({
      id: fid,
      fieldId: fid,
      name: String(f.name || 'Field'),
      farmId: String(f.farmId || ''),
      farmName: String((farmMap.get(String(f.farmId || ''))) || (m && m.farmName) || ''),
      county: String(f.county || ''),
      state: String(f.state || ''),
      location: { lat, lng },
      mrmsRaw: m ? (m.raw || null) : null
    });
  });

  const renderedFields = [];
  const summaries = [];

  for (let i = 0; i < candidates.length; i++){

    if (requestId !== appState.currentRequestId) return { cancelled:true };

    const field = candidates[i];

    setDebug(`building readiness ${i+1}/${candidates.length} • ${field.name} • op=${opKey}`);

    const fieldObj = {
      id: field.id,
      fieldId: field.fieldId,
      name: field.name,
      farmId: field.farmId,
      county: field.county,
      state: field.state,
      location: field.location
    };

    try{
      await fetchAndHydrateFieldParams(appState.readinessState, field.id);
    }catch(e){
      console.warn('[WeatherMap] field params load failed', field.id, e);
    }

    const run = await computeReadinessRunForMapField(
      appState.readinessState,
      fieldObj,
      opKey
    );

    if (!run) continue;

    const readiness = Number(run.readinessR);
    if (!Number.isFinite(readiness)) continue;

    const rain72hInches = totalRainInLast72h(field.mrmsRaw);

    const rendered = {
      kind:'readiness',
      fieldId:field.id,
      fieldName:field.name,
      farmId:field.farmId,
      farmName:field.farmName,
      county:field.county,
      state:field.state,
      lat:field.location.lat,
      lng:field.location.lng,
      readiness,
      rain72hInches
    };

    renderedFields.push(rendered);
    summaries.push(rendered);

    appState.readinessState.lastRuns.set(field.id, run);
  }

  return { summaries, renderedFields };
}