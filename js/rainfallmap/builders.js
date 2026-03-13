import { appState } from './store.js';
import { loadFieldDocs, loadFarmDocs, loadMrmsDocs, loadPersistedStateMap } from './data-loaders.js';
import { getSelectedFarmId } from './selection.js';
import { hasUsableRainData, buildFieldPoints, buildRainSummary, totalRainInLast72h } from './rain-data.js';
import { setDebug } from './dom.js';
import { computeReadinessRunForMapField } from './readiness-core.js';
import { fetchAndHydrateFieldParams } from '/Farm-vista/js/field-readiness/data.js';
import { ensureFRModules } from '/Farm-vista/js/field-readiness/formula.js';

function safeStr(v){
  return String(v || '');
}

function safeNum(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function makeNormalizedMapField(sourceField, farmName='', mrmsRaw=null){
  const lat = safeNum(
    sourceField && (
      (sourceField.location && sourceField.location.lat) ??
      sourceField.lat
    )
  );

  const lng = safeNum(
    sourceField && (
      (sourceField.location && sourceField.location.lng) ??
      (sourceField.location && sourceField.location.lon) ??
      sourceField.lng ??
      sourceField.lon
    )
  );

  if (lat == null || lng == null) return null;

  return {
    ...sourceField,
    id: safeStr(sourceField && sourceField.id),
    fieldId: safeStr((sourceField && (sourceField.fieldId || sourceField.id)) || ''),
    name: safeStr((sourceField && (sourceField.name || sourceField.fieldName)) || 'Field'),
    farmId: safeStr(sourceField && sourceField.farmId),
    farmName: safeStr(farmName),
    county: safeStr(sourceField && sourceField.county),
    state: safeStr(sourceField && sourceField.state),
    location: { lat, lng },
    mrmsRaw: mrmsRaw || null
  };
}

export async function buildRainRenderableRows(requestId, force=false){
  const rows = await loadMrmsDocs(force);
  if (requestId !== appState.currentRequestId) return { cancelled:true };

  const selectedFarmId = getSelectedFarmId();
  const farmFiltered = selectedFarmId
    ? rows.filter(row => String(row.farmId || '') === selectedFarmId)
    : rows.slice();

  const usableRows = farmFiltered.filter(row => hasUsableRainData(row.raw));

  usableRows.sort((a, b)=>
    String(a.fieldName).localeCompare(String(b.fieldName), undefined, { numeric:true, sensitivity:'base' })
  );

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

  (Array.isArray(fields) ? fields : []).forEach(sourceField=>{
    if (!sourceField || !sourceField.id) return;
    if (selectedFarmId && String(sourceField.farmId || '') !== selectedFarmId) return;

    const fid = String(sourceField.id);
    const mrmsRow = mrmsByFieldId.get(fid) || null;
    const farmName = String(
      farmMap.get(String(sourceField.farmId || '')) ||
      (mrmsRow && mrmsRow.farmName) ||
      ''
    );

    const fieldObj = makeNormalizedMapField(sourceField, farmName, mrmsRow ? (mrmsRow.raw || null) : null);
    if (!fieldObj) return;

    candidates.push(fieldObj);
  });

  candidates.sort((a, b)=>
    String(a.name || '').localeCompare(String(b.name || ''), undefined, {
      numeric:true,
      sensitivity:'base'
    })
  );

  const renderedFields = [];
  const summaries = [];

  const withTimeout = (promise, ms, label='timeout')=>{
    return Promise.race([
      promise,
      new Promise((_, reject)=>{
        setTimeout(()=> reject(new Error(label)), ms);
      })
    ]);
  };

  async function buildOne(field, index, total){
    if (requestId !== appState.currentRequestId) return null;

    setDebug(`building readiness ${index + 1}/${total} • ${field.name || field.id}`);

    try{
      await withTimeout(
        fetchAndHydrateFieldParams(appState.readinessState, String(field.id)),
        2500,
        'param load timeout'
      );
    }catch(e){
      console.warn('[WeatherMap] field params load failed:', field && field.id, e);
    }

    let run = null;
    try{
      run = await withTimeout(
        computeReadinessRunForMapField(appState.readinessState, field),
        9000,
        'readiness timeout'
      );
    }catch(e){
      console.warn('[WeatherMap] readiness run failed:', field && field.id, e);
    }

    if (!run || !Number.isFinite(Number(run.readinessR))){
      return null;
    }

    const rain72hInches = totalRainInLast72h(field.mrmsRaw);

    const rendered = {
      kind: 'readiness',
      fieldId: String(field.id),
      fieldName: String(field.name || 'Field'),
      farmId: String(field.farmId || ''),
      farmName: String(field.farmName || ''),
      county: String(field.county || ''),
      state: String(field.state || ''),
      lat: Number(field.location.lat),
      lng: Number(field.location.lng),
      readiness: Number(run.readinessR),
      rain72hInches
    };

    try{
      appState.readinessState.lastRuns.set(String(field.id), run);
    }catch(_){}

    return rendered;
  }

  const BATCH_SIZE = 8;

  for (let start = 0; start < candidates.length; start += BATCH_SIZE){
    if (requestId !== appState.currentRequestId) return { cancelled:true };

    const batch = candidates.slice(start, start + BATCH_SIZE);
    const built = await Promise.all(
      batch.map((field, idx)=> buildOne(field, start + idx, candidates.length))
    );

    built.forEach(rendered=>{
      if (!rendered) return;
      renderedFields.push(rendered);
      summaries.push(rendered);
    });

    if ((start + BATCH_SIZE) < candidates.length){
      await new Promise(resolve => setTimeout(resolve, 8));
    }
  }

  return { summaries, renderedFields };
}