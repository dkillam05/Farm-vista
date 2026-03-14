import { appState } from './store.js';
import { loadFieldDocs, loadFarmDocs, loadMrmsDocs, loadPersistedStateMap } from './data-loaders.js';
import { getSelectedFarmId } from './selection.js';
import { hasUsableRainData, buildFieldPoints, buildRainSummary, totalRainInLast72h } from './rain-data.js';
import { setDebug } from './dom.js';
import { computeReadinessRunForMapField } from './readiness-core.js';
import { fetchAndHydrateFieldParams } from '/Farm-vista/js/field-readiness/data.js';
import { ensureFRModules } from '/Farm-vista/js/field-readiness/formula.js';

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

  (Array.isArray(fields) ? fields : []).forEach(f=>{
    if (!f || !f.id) return;
    if (selectedFarmId && String(f.farmId || '') !== selectedFarmId) return;

    const lat = Number(f && ((f.location && f.location.lat) ?? f.lat));
    const lng = Number(f && ((f.location && f.location.lng) ?? (f.location && f.location.lon) ?? f.lng ?? f.lon));

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const fid = String(f.id);
    const m = mrmsByFieldId.get(fid) || null;

    candidates.push({
      id: fid,
      sourceField: f,
      farmName: String((farmMap.get(String(f.farmId || ''))) || (m && m.farmName) || ''),
      mrmsRaw: m ? (m.raw || null) : null
    });
  });

  candidates.sort((a, b)=>
    String((a.sourceField && a.sourceField.name) || '').localeCompare(
      String((b.sourceField && b.sourceField.name) || ''),
      undefined,
      { numeric:true, sensitivity:'base' }
    )
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

  async function buildOne(candidate, index, total){
    if (requestId !== appState.currentRequestId) return null;

    const field = candidate && candidate.sourceField ? candidate.sourceField : null;
    if (!field || !field.id) return null;

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

    const rain72hInches = totalRainInLast72h(candidate.mrmsRaw);

    const rendered = {
      kind: 'readiness',
      fieldId: String(field.id),
      fieldName: String(field.name || 'Field'),
      farmId: String(field.farmId || ''),
      farmName: String(candidate.farmName || ''),
      county: String(field.county || ''),
      state: String(field.state || ''),
      lat: Number(field.location && field.location.lat),
      lng: Number(field.location && field.location.lng),
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
      batch.map((candidate, idx)=> buildOne(candidate, start + idx, candidates.length))
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