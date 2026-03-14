/* ======================================================================
   /Farm-vista/js/rainfallmap/builders.js
   FULL FILE REBUILD
   Purpose:
   - Keep rain rows working
   - Build readiness rows
   - Feed detailed readiness trace into hamburger debug
   - Show where readiness numbers are coming from
   ====================================================================== */

import { appState } from './store.js';
import { loadFieldDocs, loadFarmDocs, loadMrmsDocs, loadPersistedStateMap } from './data-loaders.js';
import { getSelectedFarmId } from './selection.js';
import { hasUsableRainData, buildFieldPoints, buildRainSummary, totalRainInLast72h } from './rain-data.js';
import { setDebug } from './dom.js';
import { computeReadinessRunForMapField } from './readiness-core.js';
import { fetchAndHydrateFieldParams } from '/Farm-vista/js/field-readiness/data.js';
import { ensureFRModules } from '/Farm-vista/js/field-readiness/formula.js';

function safeNum(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function traceLine(parts){
  return parts.filter(Boolean).join(' • ');
}

function pushDebugTrace(line){
  try{
    appState.readinessBuildTrace = Array.isArray(appState.readinessBuildTrace)
      ? appState.readinessBuildTrace
      : [];
    appState.readinessBuildTrace.push(String(line || ''));
    if (appState.readinessBuildTrace.length > 120){
      appState.readinessBuildTrace = appState.readinessBuildTrace.slice(-120);
    }
  }catch(_){}
}

function setActiveDebug(line){
  setDebug(String(line || ''));
  pushDebugTrace(line);
}

function persistedTruthSummary(fieldId){
  try{
    const map = (appState.readinessState && appState.readinessState.persistedStateByFieldId) || {};
    const hit = map[String(fieldId || '')];
    if (!hit || typeof hit !== 'object') return 'persisted=no';

    const storageFinal = safeNum(hit.storageFinal);
    const asOfDateISO = String(hit.asOfDateISO || '').trim();

    return traceLine([
      'persisted=yes',
      storageFinal != null ? `storage=${storageFinal.toFixed(2)}` : '',
      asOfDateISO ? `asOf=${asOfDateISO}` : ''
    ]);
  }catch(_){
    return 'persisted=err';
  }
}

function paramSummary(fieldId){
  try{
    const map = appState.readinessState && appState.readinessState.perFieldParams;
    const hit = map && typeof map.get === 'function' ? map.get(String(fieldId || '')) : null;
    if (!hit || typeof hit !== 'object') return 'params=none';

    const soil = safeNum(hit.soilWetness);
    const drain = safeNum(hit.drainageIndex);

    return traceLine([
      'params=yes',
      soil != null ? `soil=${Math.round(soil)}` : '',
      drain != null ? `drain=${Math.round(drain)}` : ''
    ]);
  }catch(_){
    return 'params=err';
  }
}

function runSummary(run){
  try{
    if (!run || typeof run !== 'object') return 'run=null';

    const readiness = safeNum(run.readinessR);
    const wetness = safeNum(run.wetnessR);
    const storage = safeNum(run.storageFinal);
    const rows = Array.isArray(run.rows) ? run.rows.length : 0;
    const smax = safeNum(run && run.factors && run.factors.Smax);

    return traceLine([
      readiness != null ? `readiness=${Math.round(readiness)}` : 'readiness=NaN',
      wetness != null ? `wetness=${Math.round(wetness)}` : '',
      storage != null ? `storage=${storage.toFixed(2)}` : '',
      smax != null ? `smax=${smax.toFixed(2)}` : '',
      `rows=${rows}`
    ]);
  }catch(_){
    return 'run=err';
  }
}

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

  appState.readinessBuildTrace = [];

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

    if (selectedFarmId && String(f.farmId || '') !== String(selectedFarmId)) return;

    const lat = Number(f?.location?.lat ?? f.lat);
    const lng = Number(f?.location?.lng ?? f.lng ?? f.lon);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const fid = String(f.id);
    const mrms = mrmsByFieldId.get(fid) || null;

    candidates.push({
      id: fid,
      fieldId: fid,
      name: String(f.name || 'Field'),
      farmId: String(f.farmId || ''),
      farmName: String((farmMap.get(String(f.farmId || ''))) || (mrms && mrms.farmName) || ''),
      county: String(f.county || ''),
      state: String(f.state || ''),
      location: { lat, lng },
      mrmsRaw: mrms ? (mrms.raw || null) : null
    });

  });

  setActiveDebug(
    traceLine([
      `readiness candidates=${candidates.length}`,
      `fields=${Array.isArray(fields) ? fields.length : 0}`,
      `farms=${Array.isArray(farms) ? farms.length : 0}`,
      `mrms=${Array.isArray(mrmsRows) ? mrmsRows.length : 0}`,
      `selectedFarm=${selectedFarmId || '__all__'}`
    ])
  );

  const renderedFields = [];
  const summaries = [];

  for (let i = 0; i < candidates.length; i++){

    if (requestId !== appState.currentRequestId) return { cancelled:true };

    const field = candidates[i];

    setActiveDebug(
      traceLine([
        `building ${i + 1}/${candidates.length}`,
        field.name,
        persistedTruthSummary(field.id)
      ])
    );

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
      pushDebugTrace(traceLine([
        field.name,
        'paramLoad=ok',
        paramSummary(field.id)
      ]));
    }catch(e){
      console.warn('[WeatherMap] field params load failed', field.id, e);
      pushDebugTrace(traceLine([
        field.name,
        'paramLoad=fail',
        e && e.message ? e.message : 'unknown'
      ]));
    }

    let run = null;

    try{
      run = await computeReadinessRunForMapField(appState.readinessState, fieldObj);
      pushDebugTrace(traceLine([
        field.name,
        'compute=done',
        runSummary(run)
      ]));
    }catch(e){
      console.warn('[WeatherMap] readiness run failed', field.id, e);
      pushDebugTrace(traceLine([
        field.name,
        'compute=fail',
        e && e.message ? e.message : 'unknown'
      ]));
    }

    if (!run){
      pushDebugTrace(traceLine([
        field.name,
        'skip',
        'reason=no-run'
      ]));
      continue;
    }

    const readiness = Number(run.readinessR);

    if (!Number.isFinite(readiness)){
      pushDebugTrace(traceLine([
        field.name,
        'skip',
        'reason=bad-readiness'
      ]));
      continue;
    }

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

    try{
      appState.readinessState.lastRuns.set(field.id, run);
    }catch(_){}

    pushDebugTrace(traceLine([
      field.name,
      'rendered=yes',
      `readiness=${Math.round(readiness)}`,
      `rain72h=${Number(rain72hInches || 0).toFixed(2)}`
    ]));
  }

  const builtCount = renderedFields.length;
  const skippedCount = Math.max(0, candidates.length - builtCount);

  setActiveDebug(
    traceLine([
      `readiness done`,
      `built=${builtCount}`,
      `skipped=${skippedCount}`,
      `traceLines=${Array.isArray(appState.readinessBuildTrace) ? appState.readinessBuildTrace.length : 0}`
    ])
  );

  return { summaries, renderedFields };
}