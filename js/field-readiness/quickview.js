/* =====================================================================
/Farm-vista/js/field-readiness/quickview.js  (FULL FILE)
Rev: 2026-03-20a-fix-mrms-model-path-and-centralized-writeback

GOAL (per Dane, Feb 2026):
✅ Make Quick View readiness MATCH centralized app readiness
✅ Show centralized readiness from field_readiness_latest
✅ Support LIVE preview when sliders move
✅ Save slider values to fields/{fieldId}
✅ Save updated live readiness to field_readiness_latest/{fieldId}
✅ Keep Range rain display aligned with MRMS tile logic
✅ Support lightweight MRMS UI refresh while Quick View is open
✅ FIX: Storage display now uses true storage cap on right side again

THIS REV:
✅ CRITICAL FIX: Quick View model recompute now uses runFieldReadiness(...)
   instead of calling model.runField(...) directly
✅ This forces the proper formula.js model-weather prewarm path
✅ Quick View live preview now follows the same MRMS/Open-Meteo selection logic
   used by formula.js
✅ Save & Close now also writes centralized readiness from runFieldReadiness(...)
   so field_readiness_latest is no longer rewritten from the wrong model path
✅ Keeps existing UI / modal / map / save behavior intact

NOTES:
- While sliders are moving, Quick View shows LIVE PREVIEW from the model.
- Before any slider movement, Quick View still shows centralized readiness.
- After Save & Close, centralized readiness is rewritten so the rest of the app
  sees the updated number from Firestore.

===================================================================== */
'use strict';

import { buildWxCtx, OPS } from './state.js';
import { getAPI } from './firebase.js';
import { getFieldParams, saveParamsToLocal } from './params.js';
import { getCurrentOp, getThresholdForOp } from './thresholds.js';
import { esc, clamp } from './utils.js';
import { canEdit } from './perm.js';
import { parseRangeFromInput, mrmsRainInRange } from './rain.js';
import { loadFieldMrmsDoc } from './data.js';

// ✅ SINGLE SOURCE OF TRUTH: readiness wiring lives here
import { ensureFRModules, buildFRDeps, runFieldReadiness } from './formula.js';

function $(id){ return document.getElementById(id); }

/* =====================================================================
   Truth state collection (kept; read-only here)
===================================================================== */
const FR_STATE_COLLECTION = 'field_readiness_state';
const STATE_TTL_MS = 30000;

/* =====================================================================
   Centralized readiness collection
===================================================================== */
const FR_LATEST_COLLECTION = 'field_readiness_latest';
const LATEST_TTL_MS = 30000;

function safeObj(x){ return (x && typeof x === 'object') ? x : null; }
function safeStr(x){
  const s = String(x || '');
  return s ? s : '';
}
function safeISO10(x){
  const s = safeStr(x);
  return (s.length >= 10) ? s.slice(0,10) : s;
}
function safeNum(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function safeInt(v, fallback = null){
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}
function toIsoFromAny(v){
  try{
    if (!v) return '';
    if (typeof v === 'string'){
      const d = new Date(v);
      return Number.isFinite(d.getTime()) ? d.toISOString() : v;
    }
    if (v && typeof v.toDate === 'function'){
      const d = v.toDate();
      return Number.isFinite(d.getTime()) ? d.toISOString() : '';
    }
    if (v && typeof v === 'object' && typeof v.seconds === 'number'){
      const ms = (Number(v.seconds) * 1000) + Math.round(Number(v.nanoseconds || 0) / 1e6);
      const d = new Date(ms);
      return Number.isFinite(d.getTime()) ? d.toISOString() : '';
    }
    if (v && typeof v === 'object' && typeof v.__time__ === 'string'){
      const d = new Date(v.__time__);
      return Number.isFinite(d.getTime()) ? d.toISOString() : String(v.__time__ || '');
    }
  }catch(_){}
  return '';
}

async function loadPersistedState(state, { force=false } = {}){
  try{
    if (!state) return;

    const now = Date.now();
    const last = Number(state._qvPersistLoadedAt || 0);
    if (!force && state.persistedStateByFieldId && (now - last) < STATE_TTL_MS) return;

    state.persistedStateByFieldId = state.persistedStateByFieldId || {};
    const out = {};

    const api = getAPI(state);
    if (!api){
      state.persistedStateByFieldId = out;
      state._qvPersistLoadedAt = now;
      return;
    }

    if (api.kind === 'compat' && window.firebase && window.firebase.firestore){
      const db = window.firebase.firestore();
      const snap = await db.collection(FR_STATE_COLLECTION).get();

      snap.forEach(doc=>{
        const d = doc.data() || {};
        const fid = safeStr(d.fieldId || doc.id);
        if (!fid) return;

        const storageFinal = safeNum(d.storageFinal);
        const asOfDateISO = safeISO10(d.asOfDateISO);
        if (storageFinal == null || !asOfDateISO) return;

        out[fid] = {
          fieldId: fid,
          storageFinal,
          asOfDateISO,
          SmaxAtSave: safeNum(d.SmaxAtSave) ?? safeNum(d.SmaxAtSave || d.smaxAtSave) ?? 0
        };
      });

      state.persistedStateByFieldId = out;
      state._qvPersistLoadedAt = now;
      return;
    }

    if (api.kind !== 'compat'){
      const db = api.getFirestore();
      const col = api.collection(db, FR_STATE_COLLECTION);
      const snap = await api.getDocs(col);

      snap.forEach(doc=>{
        const d = doc.data() || {};
        const fid = safeStr(d.fieldId || doc.id);
        if (!fid) return;

        const storageFinal = safeNum(d.storageFinal);
        const asOfDateISO = safeISO10(d.asOfDateISO);
        if (storageFinal == null || !asOfDateISO) return;

        out[fid] = {
          fieldId: fid,
          storageFinal,
          asOfDateISO,
          SmaxAtSave: safeNum(d.SmaxAtSave) ?? safeNum(d.SmaxAtSave || d.smaxAtSave) ?? 0
        };
      });

      state.persistedStateByFieldId = out;
      state._qvPersistLoadedAt = now;
      return;
    }
  }catch(e){
    console.warn('[FieldReadiness] quickview persisted state load failed:', e);
    state.persistedStateByFieldId = state.persistedStateByFieldId || {};
    state._qvPersistLoadedAt = Date.now();
  }
}

/* =====================================================================
   Centralized latest readiness load
===================================================================== */
function buildLatestReadinessRecord(raw, fallbackId){
  const d = safeObj(raw) || {};
  const fieldId = safeStr(d.fieldId || fallbackId);
  if (!fieldId) return null;

  return {
    fieldId,
    farmId: safeStr(d.farmId),
    farmName: d.farmName == null ? null : safeStr(d.farmName),
    fieldName: safeStr(d.fieldName),
    county: safeStr(d.county),
    state: safeStr(d.state),
    readiness: safeInt(d.readiness),
    wetness: safeInt(d.wetness),
    soilWetness: safeNum(d.soilWetness),
    drainageIndex: safeNum(d.drainageIndex),
    readinessCreditIn: safeNum(d.readinessCreditIn) ?? 0,
    storageFinal: safeNum(d.storageFinal),
    storageForReadiness: safeNum(d.storageForReadiness),
    storagePhysFinal: safeNum(d.storagePhysFinal),
    storageMax: safeNum(d.storageMax),
    storageCapacity: safeNum(d.storageCapacity),
    storageMaxFinal: safeNum(d.storageMaxFinal),
    wetBiasApplied: safeNum(d.wetBiasApplied),
    runKey: safeStr(d.runKey),
    seedSource: safeStr(d.seedSource),
    weatherSource: safeStr(d.weatherSource),
    timezone: safeStr(d.timezone),
    computedAtISO: toIsoFromAny(d.computedAt),
    weatherFetchedAtISO: toIsoFromAny(d.weatherFetchedAt),
    location: {
      lat: safeNum(d && d.location && d.location.lat),
      lng: safeNum(d && d.location && d.location.lng)
    },
    _raw: d
  };
}

async function loadLatestReadiness(state, { force=false } = {}){
  try{
    if (!state) return;

    const now = Date.now();
    const last = Number(state._qvLatestLoadedAt || 0);
    if (!force && state.latestReadinessByFieldId && (now - last) < LATEST_TTL_MS) return;

    state.latestReadinessByFieldId = state.latestReadinessByFieldId || {};
    const out = {};

    const api = getAPI(state);
    if (!api){
      state.latestReadinessByFieldId = out;
      state._qvLatestLoadedAt = now;
      return;
    }

    if (api.kind === 'compat' && window.firebase && window.firebase.firestore){
      const db = window.firebase.firestore();
      const snap = await db.collection(FR_LATEST_COLLECTION).get();

      snap.forEach(doc=>{
        const rec = buildLatestReadinessRecord(doc.data() || {}, doc.id);
        if (!rec || !rec.fieldId) return;
        out[rec.fieldId] = rec;
      });

      state.latestReadinessByFieldId = out;
      state._qvLatestLoadedAt = now;
      return;
    }

    if (api.kind !== 'compat'){
      const db = api.getFirestore();
      const col = api.collection(db, FR_LATEST_COLLECTION);
      const snap = await api.getDocs(col);

      snap.forEach(doc=>{
        const rec = buildLatestReadinessRecord(doc.data() || {}, doc.id);
        if (!rec || !rec.fieldId) return;
        out[rec.fieldId] = rec;
      });

      state.latestReadinessByFieldId = out;
      state._qvLatestLoadedAt = now;
      return;
    }
  }catch(e){
    console.warn('[FieldReadiness] quickview latest readiness load failed:', e);
    state.latestReadinessByFieldId = state.latestReadinessByFieldId || {};
    state._qvLatestLoadedAt = Date.now();
  }
}

function getLatestReadinessForField(state, fieldId){
  try{
    const map = safeObj(state && state.latestReadinessByFieldId) || {};
    const fid = safeStr(fieldId);
    const rec = map[fid];
    return safeObj(rec);
  }catch(_){
    return null;
  }
}

function buildSyntheticRunFromLatest(state, fieldObj, latestRec){
  const f = fieldObj || {};
  const rec = latestRec || getLatestReadinessForField(state, f.id);
  if (!rec) return null;

  const readinessR = safeInt(rec.readiness);
  if (!Number.isFinite(readinessR)) return null;

  const storageCap =
    safeNum(rec.storageMax) ??
    safeNum(rec.storageCapacity) ??
    safeNum(rec.storageMaxFinal) ??
    safeNum(rec.storagePhysFinal) ??
    safeNum(rec.storageForReadiness) ??
    safeNum(rec.storageFinal) ??
    0;

  return {
    ok: true,
    source: 'field_readiness_latest',
    sourceLabel: 'field_readiness_latest',
    fieldId: safeStr(rec.fieldId || f.id),
    readinessR,
    readiness: readinessR,
    wetness: safeInt(rec.wetness),
    wetnessR: safeInt(rec.wetness),
    soilWetness: safeNum(rec.soilWetness),
    drainageIndex: safeNum(rec.drainageIndex),
    readinessCreditIn: safeNum(rec.readinessCreditIn) ?? 0,
    storageFinal: safeNum(rec.storageFinal),
    storageForReadiness: safeNum(rec.storageForReadiness),
    storagePhysFinal: safeNum(rec.storagePhysFinal),
    storageMax: safeNum(rec.storageMax) ?? storageCap,
    storageCapacity: safeNum(rec.storageCapacity) ?? storageCap,
    storageMaxFinal: safeNum(rec.storageMaxFinal) ?? storageCap,
    wetBiasApplied: safeNum(rec.wetBiasApplied),
    runKey: safeStr(rec.runKey),
    seedSource: safeStr(rec.seedSource),
    weatherSource: safeStr(rec.weatherSource),
    timezone: safeStr(rec.timezone),
    computedAtISO: safeStr(rec.computedAtISO),
    weatherFetchedAtISO: safeStr(rec.weatherFetchedAtISO),
    county: safeStr(rec.county || f.county),
    state: safeStr(rec.state || f.state),
    factors: {
      Smax: storageCap
    },
    trace: [],
    rows: [],
    _latest: rec
  };
}

/* =====================================================================
   Centralized latest writeback after Save & Close
===================================================================== */
function getModelWeatherSourceValue(run){
  try{
    const rows = Array.isArray(run && run.rows) ? run.rows : [];
    if (!rows.length) return 'open-meteo';

    let mrmsCount = 0;
    let omCount = 0;

    for (const r of rows){
      const src = String(r && r.rainSource || '').toLowerCase();
      if (src === 'mrms') mrmsCount++;
      else if (src) omCount++;
    }

    if (mrmsCount > 0 && omCount === 0) return 'mrms';
    if (mrmsCount > 0 && omCount > 0) return 'mixed';
    return 'open-meteo';
  }catch(_){
    return 'open-meteo';
  }
}

function buildLatestPayloadFromRun(state, field, run){
  const f = field || {};
  const r = run || {};
  const latestExisting = getLatestReadinessForField(state, f.id) || null;
  const info = (state && state.wxInfoByFieldId && state.wxInfoByFieldId.get)
    ? (state.wxInfoByFieldId.get(f.id) || null)
    : null;

  const farmName =
    (state && state.farmsById && state.farmsById.get && f.farmId)
      ? (state.farmsById.get(f.farmId) || '')
      : '';

  const nowIso = new Date().toISOString();

  const location = {
    lat: safeNum(f && f.location && f.location.lat),
    lng: safeNum(f && f.location && f.location.lng)
  };

  return {
    fieldId: safeStr(f.id),
    farmId: safeStr(f.farmId),
    farmName: farmName || null,
    fieldName: safeStr(f.name),
    county: safeStr(f.county),
    state: safeStr(f.state),

    readiness: safeInt(r.readinessR),
    wetness: safeInt(r.wetnessR),

    soilWetness: safeNum(f.soilWetness),
    drainageIndex: safeNum(f.drainageIndex),

    readinessCreditIn: safeNum(r.readinessCreditIn) ?? 0,
    storageFinal: safeNum(r.storageFinal),
    storageForReadiness:
      safeNum(r.storageForReadiness) ??
      safeNum(latestExisting && latestExisting.storageForReadiness),
    storagePhysFinal:
      safeNum(r.storagePhysFinal) ??
      safeNum(latestExisting && latestExisting.storagePhysFinal),
    storageMax:
      safeNum(r.storageMax) ??
      safeNum(r.storageCapacity) ??
      safeNum(r.storageMaxFinal) ??
      safeNum(r && r.factors && r.factors.Smax) ??
      safeNum(latestExisting && latestExisting.storageMax) ??
      safeNum(latestExisting && latestExisting.storageCapacity) ??
      safeNum(latestExisting && latestExisting.storageMaxFinal),
    storageCapacity:
      safeNum(r.storageCapacity) ??
      safeNum(r.storageMax) ??
      safeNum(r.storageMaxFinal) ??
      safeNum(r && r.factors && r.factors.Smax) ??
      safeNum(latestExisting && latestExisting.storageCapacity) ??
      safeNum(latestExisting && latestExisting.storageMax) ??
      safeNum(latestExisting && latestExisting.storageMaxFinal),
    storageMaxFinal:
      safeNum(r.storageMaxFinal) ??
      safeNum(r.storageMax) ??
      safeNum(r.storageCapacity) ??
      safeNum(r && r.factors && r.factors.Smax) ??
      safeNum(latestExisting && latestExisting.storageMaxFinal) ??
      safeNum(latestExisting && latestExisting.storageMax) ??
      safeNum(latestExisting && latestExisting.storageCapacity),
    wetBiasApplied:
      safeNum(r.wetBiasApplied) ??
      safeNum(latestExisting && latestExisting.wetBiasApplied),

    runKey: safeStr(r.runKey) || 'quickview-save',
    seedSource: 'quickview-save',
    weatherSource: getModelWeatherSourceValue(r),
    timezone:
      safeStr(r.timezone) ||
      safeStr(latestExisting && latestExisting.timezone) ||
      'America/Chicago',

    weatherFetchedAt: (info && info.fetchedAt) ? new Date(info.fetchedAt) : new Date(nowIso),
    computedAt: new Date(nowIso),

    location
  };
}

async function writeLatestReadinessDoc(state, fieldId, payload){
  const api = getAPI(state);
  if (!api) return;

  if (api.kind !== 'compat'){
    const db = api.getFirestore();
    const ref = api.doc(db, FR_LATEST_COLLECTION, String(fieldId));

    if (typeof api.setDoc === 'function'){
      await api.setDoc(ref, payload, { merge:true });
      return;
    }

    if (typeof api.updateDoc === 'function'){
      try{
        await api.updateDoc(ref, payload);
      }catch(_){
        if (typeof api.setDoc === 'function'){
          await api.setDoc(ref, payload, { merge:true });
        }else{
          throw _;
        }
      }
      return;
    }
  }

  if (api.kind === 'compat' && window.firebase && window.firebase.firestore){
    const db = window.firebase.firestore();
    await db.collection(FR_LATEST_COLLECTION).doc(String(fieldId)).set(payload, { merge:true });
  }
}

async function persistLatestReadinessForField(state, field, run){
  try{
    if (!state || !field || !field.id || !run) return;

    const payload = buildLatestPayloadFromRun(state, field, run);
    await writeLatestReadinessDoc(state, field.id, payload);

    state.latestReadinessByFieldId = state.latestReadinessByFieldId || {};
    state.latestReadinessByFieldId[String(field.id)] = buildLatestReadinessRecord(payload, String(field.id));
    state._qvLatestLoadedAt = Date.now();
  }catch(e){
    console.warn('[FieldReadiness] latest readiness write failed:', e);
    throw e;
  }
}

/* ---------- tile preview color helpers (match tiles) ---------- */
function perceivedFromThreshold(readiness, thr){
  const r = clamp(Math.round(Number(readiness)), 0, 100);
  const t = clamp(Math.round(Number(thr)), 0, 100);

  if (t <= 0) return 100;
  if (t >= 100) return Math.round((r/100)*50);
  if (r === t) return 50;

  if (r > t){
    const denom = Math.max(1, 100 - t);
    const frac = (r - t) / denom;
    return clamp(Math.round(50 + frac * 50), 0, 100);
  } else {
    const denom = Math.max(1, t);
    const frac = r / denom;
    return clamp(Math.round(frac * 50), 0, 100);
  }
}
function colorForPerceived(p){
  const x = clamp(Number(p), 0, 100);
  let h;
  if (x <= 50){
    const frac = x / 50;
    h = 10 + (45 - 10) * frac;
  } else {
    const frac = (x - 50) / 50;
    h = 45 + (120 - 45) * frac;
  }
  return `hsl(${h.toFixed(0)} 70% 38%)`;
}
function gradientForThreshold(thr){
  const t = clamp(Math.round(Number(thr)), 0, 100);
  const a = `${t}%`;
  return `linear-gradient(90deg,
    hsl(10 70% 38%) 0%,
    hsl(45 75% 38%) ${a},
    hsl(120 55% 34%) 100%
  )`;
}

/* =====================================================================
   Persisted truth state passthrough (used by deps via formula.js)
===================================================================== */
function getPersistedStateForDeps(state, fieldId){
  try{
    const fid = String(fieldId || '');
    if (!fid) return null;
    const map = (state && state.persistedStateByFieldId && typeof state.persistedStateByFieldId === 'object')
      ? state.persistedStateByFieldId
      : null;
    if (!map) return null;
    const s = map[fid];
    return (s && typeof s === 'object') ? s : null;
  }catch(_){
    return null;
  }
}

/* =====================================================================
   Quick View ↔ Map stacking fix
===================================================================== */
function mapEls(){
  return {
    backdrop: $('mapBackdrop'),
    canvas: $('fvMapCanvas'),
    sub: $('mapSub'),
    latlng: $('mapLatLng'),
    err: $('mapError'),
    wrap: $('mapWrap'),
    btnX: $('btnMapX')
  };
}

function showMapModal(on){
  const { backdrop } = mapEls();
  if (backdrop) backdrop.classList.toggle('pv-hide', !on);
}

function setMapError(msg){
  const { err, wrap } = mapEls();
  if (err){
    if (!msg){
      err.style.display = 'none';
      err.textContent = '';
    } else {
      err.style.display = 'block';
      err.textContent = String(msg);
    }
  }
  if (wrap) wrap.style.opacity = msg ? '0.65' : '1';
}

function waitForGoogleMaps(timeoutMs=8000){
  const t0 = Date.now();
  return new Promise((resolve, reject)=>{
    const tick = ()=>{
      if (window.google && window.google.maps) return resolve(window.google.maps);
      if (Date.now() - t0 > timeoutMs) return reject(new Error('Google Maps is still loading. Try again in a moment.'));
      setTimeout(tick, 50);
    };
    tick();
  });
}

async function openMapForField(state, field){
  const { canvas, sub, latlng } = mapEls();
  if (!field || !field.location || !canvas){
    setMapError('Map unavailable for this field.');
    showMapModal(true);
    return;
  }

  const lat = Number(field.location.lat);
  const lng = Number(field.location.lng);
  if (!isFinite(lat) || !isFinite(lng)){
    setMapError('Invalid GPS coordinates.');
    showMapModal(true);
    return;
  }

  if (sub) sub.textContent = (field.name ? `${field.name}` : 'Field') + ' • HYBRID';
  if (latlng) latlng.textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  setMapError('');
  showMapModal(true);

  try{
    const maps = await waitForGoogleMaps();
    const center = { lat, lng };

    if (!state._qvGMap){
      state._qvGMap = new maps.Map(canvas, {
        center,
        zoom: 16,
        mapTypeId: maps.MapTypeId.HYBRID,
        streetViewControl: false,
        fullscreenControl: false,
        mapTypeControl: true,
        clickableIcons: false
      });
    } else {
      state._qvGMap.setCenter(center);
      state._qvGMap.setZoom(16);
      state._qvGMap.setMapTypeId(maps.MapTypeId.HYBRID);
    }

    if (!state._qvGMarker){
      state._qvGMarker = new maps.Marker({ position: center, map: state._qvGMap });
    } else {
      state._qvGMarker.setMap(state._qvGMap);
      state._qvGMarker.setPosition(center);
    }

    setTimeout(()=>{
      try{ maps.event.trigger(state._qvGMap, 'resize'); }catch(_){}
      try{ state._qvGMap.setCenter(center); }catch(_){}
    }, 60);

  }catch(e){
    console.warn('[FieldReadiness] map open failed:', e);
    setMapError(e && e.message ? e.message : 'Map failed to load.');
  }
}

function hideQuickViewForMap(state){
  try{
    const qv = $('frQvBackdrop');
    if (!qv) return;
    state._qvHiddenForMap = true;
    qv.classList.add('pv-hide');
  }catch(_){}
}
function restoreQuickViewAfterMap(state){
  try{
    if (!state._qvHiddenForMap) return;
    const qv = $('frQvBackdrop');
    if (!qv) return;
    qv.classList.remove('pv-hide');
    state._qvHiddenForMap = false;
  }catch(_){}
}

/* =====================================================================
   Rain helpers
===================================================================== */
async function getQuickViewMrmsRainText(state, fieldId, range){
  try{
    const doc = await loadFieldMrmsDoc(state, String(fieldId), { force:false });
    const res = mrmsRainInRange(doc, range);
    if (!res || res.ready !== true) return 'Processing Data';
    return `${Number(res.inches || 0).toFixed(2)} in`;
  }catch(_){
    return 'Processing Data';
  }
}

function getModelRainSourceLabel(run){
  try{
    const rows = Array.isArray(run && run.rows) ? run.rows : [];
    if (!rows.length) return 'Open-Meteo';

    let mrmsCount = 0;
    let omCount = 0;

    for (const r of rows){
      const src = String(r && r.rainSource || '').toLowerCase();
      if (src === 'mrms') mrmsCount++;
      else if (src) omCount++;
    }

    if (mrmsCount > 0 && omCount === 0) return 'MRMS';
    if (mrmsCount > 0 && omCount > 0) return 'Mixed';
    return 'Open-Meteo';
  }catch(_){
    return 'Open-Meteo';
  }
}

/* =====================================================================
   Modal build (once)
===================================================================== */
function ensureBuiltOnce(state){
  if (state._qvBuilt) return;
  state._qvBuilt = true;

  const wrap = document.createElement('div');
  wrap.id = 'frQvBackdrop';
  wrap.className = 'modal-backdrop pv-hide';
  wrap.setAttribute('role','dialog');
  wrap.setAttribute('aria-modal','true');

  wrap.innerHTML = `
    <style>
      #frQvBackdrop{
        align-items:flex-start !important;
        padding-top: calc(env(safe-area-inset-top, 0px) + 10px) !important;
        padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 10px) !important;
      }
      #frQvBackdrop .modal{
        width: min(760px, 96vw);
        max-height: calc(100svh - 20px);
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }
      #frQvBackdrop .modal-h{
        position: sticky;
        top: 0;
        z-index: 2;
        background: var(--surface);
        border-bottom: 1px solid var(--border);
        padding: 14px 56px 10px 14px;
      }
      #frQvBackdrop .modal-b{
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
        padding: 14px;
        padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 18px);
      }
      #frQvX{
        width: 44px !important;
        height: 44px !important;
        border-radius: 14px !important;
        top: 10px !important;
        right: 10px !important;
        z-index: 3 !important;
        border: 1px solid var(--border) !important;
        background: color-mix(in srgb, var(--surface) 92%, #ffffff 8%) !important;
        color: var(--text) !important;
        box-shadow: 0 10px 25px rgba(0,0,0,.14) !important;
      }
      #frQvX svg{ width:20px;height:20px; }
      #frQvX:active{ transform: translateY(1px); }

      #frQvSaveClose{
        background: var(--accent, #2F6C3C) !important;
        border-color: transparent !important;
        color: #fff !important;
        border-radius: 12px !important;
        padding: 10px 14px !important;
        font-weight: 900 !important;
        box-shadow: 0 10px 26px rgba(47,108,60,.45) !important;
      }
      #frQvSaveClose:active{ transform: translateY(1px); }
      #frQvSaveClose:disabled{ opacity: .55 !important; cursor: not-allowed !important; box-shadow: none !important; }

      #frQvMapBtn{
        border: 1px solid var(--border) !important;
        background: color-mix(in srgb, var(--surface) 92%, #ffffff 8%) !important;
        color: var(--text) !important;
        border-radius: 10px !important;
        padding: 6px 10px !important;
        font-weight: 900 !important;
        font-size: 12px !important;
        line-height: 1 !important;
        cursor: pointer;
        user-select:none;
      }
      #frQvMapBtn:active{ transform: translateY(1px); }
      #frQvMapBtn:disabled{ opacity:.55 !important; cursor:not-allowed !important; }

      #frQvGpsRow{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:10px;
        flex-wrap:nowrap;
        min-width:0;
      }
      #frQvGpsRow .mono{
        min-width:0;
        overflow:hidden;
        text-overflow:ellipsis;
        white-space:nowrap;
      }

      .fv-range-help{
        margin-top: 6px;
        font-size: 12px;
        line-height: 1.25;
        color: var(--muted,#67706B);
      }
      .fv-range-ends{
        display:flex;
        justify-content:space-between;
        gap:10px;
        margin-top: 4px;
        font-size: 11px;
        color: var(--muted,#67706B);
        opacity: .95;
      }
      .fv-range-ends span{ white-space:nowrap; }

      @media (max-width: 420px){
        #frQvBackdrop{ padding-left: 10px !important; padding-right: 10px !important; }
        #frQvBackdrop .modal{ width: 100%; }
      }
    </style>

    <div class="modal">
      <div class="modal-h">
        <h3 id="frQvTitle">Field</h3>
        <button id="frQvX" class="xbtn" type="button" aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 6L18 18M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
          </svg>
        </button>
        <div class="muted" style="font-size:12px; margin-top:4px;" id="frQvSub">—</div>
      </div>

      <div class="modal-b" style="display:grid;gap:12px;">
        <div id="frQvTilePreview"></div>

        <div class="panel" style="margin:0;" id="frQvInputsPanel">
          <h3 style="margin:0 0 8px;font-size:13px;font-weight:900;">Inputs (field-specific)</h3>

          <div style="display:grid;gap:12px;grid-template-columns:1fr 1fr;align-items:start;">
            <div class="field">
              <label for="frQvSoil">Soil Wetness</label>
              <input id="frQvSoil" type="range" min="0" max="100" step="1" value="60"/>
              <div class="fv-range-help">0 = Dry • 100 = Wet • Current: <span class="mono" id="frQvSoilVal">60</span>/100</div>
              <div class="fv-range-ends"><span>Dry (0)</span><span>Wet (100)</span></div>
            </div>

            <div class="field">
              <label for="frQvDrain">Drainage Index</label>
              <input id="frQvDrain" type="range" min="0" max="100" step="1" value="45"/>
              <div class="fv-range-help">0 = Well-drained • 100 = Poor drainage • Current: <span class="mono" id="frQvDrainVal">45</span>/100</div>
              <div class="fv-range-ends"><span>Well-drained (0)</span><span>Poor (100)</span></div>
            </div>
          </div>

          <div class="actions" style="margin-top:12px;justify-content:flex-end;">
            <div class="help muted" id="frQvHint" style="margin:0;flex:1 1 auto;align-self:center;">—</div>
            <button id="frQvSaveClose" class="btn btn-primary" type="button">Save &amp; Close</button>
          </div>
        </div>

        <div class="panel" style="margin:0;">
          <h3 style="margin:0 0 8px;font-size:13px;font-weight:900;">Field + Settings</h3>
          <div class="kv">
            <div class="k">Field</div><div class="v" id="frQvFieldName">—</div>
            <div class="k">County / State</div><div class="v" id="frQvCounty">—</div>
            <div class="k">Tillable</div><div class="v" id="frQvAcres">—</div>

            <div class="k">GPS</div>
            <div class="v" id="frQvGpsRow">
              <span class="mono" id="frQvGps">—</span>
              <button id="frQvMapBtn" type="button">Map</button>
            </div>

            <div class="k">Operation</div><div class="v" id="frQvOp">—</div>
            <div class="k">Threshold</div><div class="v" id="frQvThr">—</div>
          </div>
          <div class="help" id="frQvParamExplain">—</div>
        </div>

        <div class="panel" style="margin:0;">
          <h3 style="margin:0 0 8px;font-size:13px;font-weight:900;">Weather + Output</h3>
          <div class="kv">
            <div class="k">Range rain</div><div class="v" id="frQvRain">—</div>
            <div class="k">Readiness</div><div class="v" id="frQvReadiness">—</div>
            <div class="k">Wetness</div><div class="v" id="frQvWetness">—</div>
            <div class="k">Storage</div><div class="v" id="frQvStorage">—</div>
          </div>
          <div class="help" id="frQvWxMeta">—</div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(wrap);

  const close = ()=> closeQuickView(state);
  const x = $('frQvX'); if (x) x.addEventListener('click', close);

  wrap.addEventListener('click', (e)=>{
    if (e.target && e.target.id === 'frQvBackdrop') close();
  });

  (function wireMapCloseOnce(){
    if (state._qvMapWired) return;
    state._qvMapWired = true;

    const { btnX, backdrop } = mapEls();
    function closeMapAndReturn(){
      showMapModal(false);
      restoreQuickViewAfterMap(state);
    }

    if (btnX) btnX.addEventListener('click', closeMapAndReturn);
    if (backdrop){
      backdrop.addEventListener('click', (e)=>{
        if (e.target && e.target.id === 'mapBackdrop') closeMapAndReturn();
      });
    }
  })();

  const soil = $('frQvSoil');
  const drain = $('frQvDrain');
  const soilVal = $('frQvSoilVal');
  const drainVal = $('frQvDrainVal');

  function onSliderChange(){
    state._qvDidAdjust = true;

    if (soilVal) soilVal.textContent = String(Math.round(clamp(Number(soil.value),0,100)));
    if (drainVal) drainVal.textContent = String(Math.round(clamp(Number(drain.value),0,100)));

    const fid = state._qvFieldId;
    if (!fid) return;

    const p = getFieldParams(state, fid);
    p.soilWetness = clamp(Number(soil.value), 0, 100);
    p.drainageIndex = clamp(Number(drain.value), 0, 100);
    state.perFieldParams.set(fid, p);

    saveParamsToLocal(state);
    fillQuickView(state, { live:true });
  }

  if (soil) soil.addEventListener('input', onSliderChange);
  if (drain) drain.addEventListener('input', onSliderChange);

  const saveClose = $('frQvSaveClose');
  if (saveClose){
    saveClose.addEventListener('click', async ()=>{
      if (!canEdit(state)) return;
      if (state._qvSaving) return;
      await saveAndClose(state);
    });
  }

  const mapBtn = $('frQvMapBtn');
  if (mapBtn){
    mapBtn.addEventListener('click', async (e)=>{
      e.preventDefault();
      e.stopPropagation();

      const fid = state._qvFieldId;
      const f = fid ? state.fields.find(x=>x.id===fid) : null;
      if (!f) return;

      hideQuickViewForMap(state);
      await openMapForField(state, f);
    });
  }

  if (!state._qvRefreshWired){
    state._qvRefreshWired = true;

    document.addEventListener('fr:tile-refresh', async (e)=>{
      try{
        if (!state._qvOpen) return;
        const fid = e && e.detail ? String(e.detail.fieldId || '') : '';
        if (!fid) return;
        if (String(state._qvFieldId || '') !== fid) return;
        await fillQuickView(state, { live:true });
      }catch(_){}
    });

    document.addEventListener('fr:details-refresh', async (e)=>{
      try{
        if (!state._qvOpen) return;
        const fid = e && e.detail ? String(e.detail.fieldId || '') : '';
        if (!fid) return;
        if (String(state._qvFieldId || '') !== fid) return;
        await fillQuickView(state, { live:true });
      }catch(_){}
    });
  }
}

/* ---------- open/close ---------- */
export function openQuickView(state, fieldId){
  if (!canEdit(state)) return;

  ensureBuiltOnce(state);

  const f = state.fields.find(x=>x.id===fieldId);
  if (!f) return;

  state._qvFieldId = fieldId;
  state.selectedFieldId = fieldId;
  state._qvDidAdjust = false;

  const b = $('frQvBackdrop');
  if (b) b.classList.remove('pv-hide');
  state._qvOpen = true;

  fillQuickView(state, { live:false });
}

export function closeQuickView(state){
  const b = $('frQvBackdrop');
  if (b) b.classList.add('pv-hide');
  state._qvOpen = false;
  try{ state._qvHiddenForMap = false; }catch(_){}
}

/* ---------- render inside modal ---------- */
function setText(id,val){
  const el = $(id);
  if (el) el.textContent = String(val);
}

async function renderTilePreview(state, run, thr, etaTxt){
  const wrap = $('frQvTilePreview');
  if (!wrap) return;

  const f = state.fields.find(x=>x.id===state._qvFieldId);
  if (!f || !run) return;

  const readiness = run.readinessR;
  const range = parseRangeFromInput();
  const rainText = await getQuickViewMrmsRainText(state, f.id, range);

  const leftPos = state._mods && state._mods.model && typeof state._mods.model.markerLeftCSS === 'function'
    ? state._mods.model.markerLeftCSS(readiness)
    : `${clamp(Number(readiness),0,100)}%`;

  const thrPos  = state._mods && state._mods.model && typeof state._mods.model.markerLeftCSS === 'function'
    ? state._mods.model.markerLeftCSS(thr)
    : `${clamp(Number(thr),0,100)}%`;

  const perceived = perceivedFromThreshold(readiness, thr);
  const pillBg = colorForPerceived(perceived);
  const grad = gradientForThreshold(thr);

  const eta = String(etaTxt || '').trim();

  wrap.innerHTML = `
    <div class="tile" style="cursor:default; user-select:none;">
      <div class="tile-top">
        <div class="titleline">
          <div class="name" title="${esc(f.name)}">${esc(f.name)}</div>
        </div>
        <div class="readiness-pill" style="background:${pillBg};color:#fff;">Field Readiness ${readiness}</div>
      </div>

      <p class="subline">Rain (range): <span class="mono">${esc(rainText)}</span></p>

      <div class="gauge-wrap">
        <div class="chips">
          <div class="chip wet">Wet</div>
          <div class="chip readiness">Readiness</div>
        </div>

        <div class="gauge" style="background:${grad};">
          <div class="thr" style="left:${thrPos};"></div>
          <div class="marker" style="left:${leftPos};"></div>
          <div class="badge" style="left:${leftPos};background:${pillBg};color:#fff;border:1px solid rgba(255,255,255,.18);">Field Readiness ${readiness}</div>
        </div>

        <div class="ticks"><span>0</span><span>50</span><span>100</span></div>
        ${eta ? `<div class="help"><b>${esc(eta)}</b></div>` : ``}
      </div>
    </div>
  `;
}

async function fillQuickView(state, { live=false } = {}){
  const fid = state._qvFieldId;
  const f = state.fields.find(x=>x.id===fid);
  if (!f) return;

  await ensureFRModules(state);
  await loadPersistedState(state, { force:true });
  await loadLatestReadiness(state, { force:true });

  const opKey = getCurrentOp();
  const wxCtx = buildWxCtx(state);

  const depsTruth = buildFRDeps(state, {
    opKey,
    wxCtx,
    persistedGetter: (id)=> getPersistedStateForDeps(state, id)
  });

  // ✅ CRITICAL FIX:
  // Always use formula.js entry point so model weather is properly prewarmed
  // and MRMS-vs-Open-Meteo selection stays consistent with the app.
  const runTruth = await runFieldReadiness(state, f, {
    opKey,
    wxCtx,
    persistedGetter: (id)=> getPersistedStateForDeps(state, id)
  });

  // Centralized doc remains default when modal first opens.
  const latestRec = getLatestReadinessForField(state, fid);
  const latestRun = buildSyntheticRunFromLatest(state, f, latestRec);

  const previewMode = !!live || !!state._qvDidAdjust;
  const displayRun = previewMode ? runTruth : (latestRun || runTruth);

  const farmName =
    (latestRec && latestRec.farmName) ||
    state.farmsById.get(f.farmId) ||
    '';

  const opLabel = (OPS.find(o=>o.key===opKey)?.label) || opKey;
  const thr = getThresholdForOp(state, opKey);

  const title = $('frQvTitle');
  const sub = $('frQvSub');
  if (title) title.textContent = f.name || 'Field';
  if (sub){
    let sourceTag = 'Centralized readiness';
    if (previewMode) sourceTag = 'Live preview';
    else if (!latestRun) sourceTag = 'Truth (Rule A)';
    sub.textContent = farmName ? `${farmName} • ${sourceTag}` : sourceTag;
  }

  const pRaw = getFieldParams(state, f.id);
  const soil = $('frQvSoil');
  const drain = $('frQvDrain');
  const soilVal = $('frQvSoilVal');
  const drainVal = $('frQvDrainVal');

  if (!live){
    if (soil) soil.value = String(pRaw.soilWetness);
    if (drain) drain.value = String(pRaw.drainageIndex);
    if (soilVal) soilVal.textContent = String(Math.round(Number(pRaw.soilWetness||0)));
    if (drainVal) drainVal.textContent = String(Math.round(Number(pRaw.drainageIndex||0)));
  }

  const hint = $('frQvHint');
  const saveBtn = $('frQvSaveClose');
  const inputsPanel = $('frQvInputsPanel');

  if (!canEdit(state)){
    if (hint) hint.textContent = 'View only. You do not have edit permission.';
    if (saveBtn) saveBtn.disabled = true;
    if (inputsPanel) inputsPanel.style.opacity = '0.75';
  } else {
    if (previewMode){
      if (hint) hint.textContent = 'Live preview shown below. Save & Close writes sliders + updates centralized readiness.';
    } else {
      if (hint) hint.textContent = 'Move sliders to preview readiness live. Save & Close updates Firestore.';
    }
    if (saveBtn) saveBtn.disabled = false;
    if (inputsPanel) inputsPanel.style.opacity = '1';
  }

  setText('frQvFieldName', farmName ? `${farmName} • ${f.name}` : (f.name || '—'));
  setText('frQvCounty', `${String((latestRec && latestRec.county) || f.county || '—')} / ${String((latestRec && latestRec.state) || f.state || '—')}`);
  setText('frQvAcres', isFinite(f.tillable) ? `${f.tillable.toFixed(2)} ac` : '—');

  const gpsText = f.location ? `${f.location.lat.toFixed(6)}, ${f.location.lng.toFixed(6)}` : '—';
  setText('frQvGps', gpsText);

  const mapBtn = $('frQvMapBtn');
  if (mapBtn) mapBtn.disabled = !(f && f.location);

  setText('frQvOp', opLabel);
  setText('frQvThr', thr);

  const range = parseRangeFromInput();
  const rainText = await getQuickViewMrmsRainText(state, fid, range);
  setText('frQvRain', rainText);

  setText('frQvReadiness', displayRun && Number.isFinite(Number(displayRun.readinessR)) ? displayRun.readinessR : '—');
  setText('frQvWetness', displayRun && Number.isFinite(Number(displayRun.wetnessR)) ? displayRun.wetnessR : '—');

  let storageText = '—';
  if (displayRun){
    const sf = safeNum(displayRun.storageFinal);
    const smax =
      safeNum(displayRun.storageMax) ??
      safeNum(displayRun.storageCapacity) ??
      safeNum(displayRun.storageMaxFinal) ??
      safeNum(displayRun && displayRun.factors && displayRun.factors.Smax) ??
      safeNum(displayRun.storagePhysFinal) ??
      safeNum(displayRun.storageForReadiness);

    if (sf != null && smax != null){
      storageText = `${sf.toFixed(2)} / ${smax.toFixed(2)}`;
    } else if (sf != null){
      storageText = `${sf.toFixed(2)}`;
    }
  }
  setText('frQvStorage', storageText);

  const info = state.wxInfoByFieldId.get(f.id) || null;
  const when = (info && info.fetchedAt) ? new Date(info.fetchedAt) : null;
  const whenTxt = when ? when.toLocaleString() : '—';
  const wxMeta = $('frQvWxMeta');

  if (wxMeta){
    const truthR = (runTruth && isFinite(Number(runTruth.readinessR))) ? Number(runTruth.readinessR) : null;
    const centralR = (latestRun && isFinite(Number(latestRun.readinessR))) ? Number(latestRun.readinessR) : null;
    const shownR = (displayRun && isFinite(Number(displayRun.readinessR))) ? Number(displayRun.readinessR) : null;
    const rainSource = getModelRainSourceLabel(runTruth);

    wxMeta.innerHTML =
      `Weather updated: <span class="mono">${esc(whenTxt)}</span>` +
      ` • Model rain: <span class="mono">${esc(rainSource)}</span>` +
      (shownR != null ? ` • Shown: <span class="mono">${shownR}</span>` : ``) +
      (centralR != null ? ` • Centralized: <span class="mono">${centralR}</span>` : ``) +
      (truthR != null ? ` • Model: <span class="mono">${truthR}</span>` : ``);
  }

  const pe = $('frQvParamExplain');
  if (pe){
    pe.innerHTML =
      `soil=<span class="mono">${Math.round(Number(pRaw.soilWetness||0))}</span>/100 • ` +
      `drain=<span class="mono">${Math.round(Number(pRaw.drainageIndex||0))}</span>/100`;
  }

  let etaTxt = '';
  try{
    const horizon = 168;
    if (state && state._mods && state._mods.model && typeof state._mods.model.etaToThreshold === 'function' && runTruth){
      const res = await state._mods.model.etaToThreshold(f, depsTruth, thr, horizon, 3);
      if (res && res.ok && res.text) etaTxt = String(res.text || '').trim();
    }
  }catch(_){
    etaTxt = '';
  }

  await renderTilePreview(state, displayRun, thr, etaTxt);
}

/* ---------- Save & Close ---------- */
async function saveAndClose(state){
  const fid = state._qvFieldId;
  const f = state.fields.find(x=>x.id===fid);
  if (!f) return;

  const soil = $('frQvSoil');
  const drain = $('frQvDrain');
  const btn = $('frQvSaveClose');
  const hint = $('frQvHint');

  const soilWetness = clamp(Number(soil ? soil.value : 60), 0, 100);
  const drainageIndex = clamp(Number(drain ? drain.value : 45), 0, 100);

  state._qvSaving = true;
  if (btn){ btn.disabled = true; btn.textContent = 'Saving…'; }
  if (hint) hint.textContent = 'Saving…';

  try{
    const p = getFieldParams(state, fid);
    p.soilWetness = soilWetness;
    p.drainageIndex = drainageIndex;
    state.perFieldParams.set(fid, p);
    saveParamsToLocal(state);

    f.soilWetness = soilWetness;
    f.drainageIndex = drainageIndex;

    const api = getAPI(state);
    if (api && api.kind !== 'compat'){
      const db = api.getFirestore();
      const auth = api.getAuth ? api.getAuth() : null;
      const user = auth && auth.currentUser ? auth.currentUser : null;

      const ref = api.doc(db, 'fields', fid);
      await api.updateDoc(ref, {
        soilWetness,
        drainageIndex,
        updatedAt: api.serverTimestamp ? api.serverTimestamp() : new Date().toISOString(),
        updatedBy: user ? (user.email || user.uid || null) : null
      });
    } else if (api && api.kind === 'compat' && window.firebase && window.firebase.firestore){
      const db = window.firebase.firestore();
      await db.collection('fields').doc(fid).set({
        soilWetness,
        drainageIndex,
        updatedAt: new Date().toISOString()
      }, { merge:true });
    }

    // Recompute centralized readiness using the NEW saved slider values.
    // ✅ CRITICAL FIX:
    // Use runFieldReadiness(...) so formula.js prewarm/model-weather selection
    // is applied before writing field_readiness_latest.
    await ensureFRModules(state);
    await loadPersistedState(state, { force:true });

    const opKey = getCurrentOp();
    const wxCtx = buildWxCtx(state);

    const runTruth = await runFieldReadiness(state, f, {
      opKey,
      wxCtx,
      persistedGetter: (id)=> getPersistedStateForDeps(state, id)
    });

    await persistLatestReadinessForField(state, f, runTruth);

    state._qvDidAdjust = false;

    try{ document.dispatchEvent(new CustomEvent('fr:tile-refresh', { detail:{ fieldId: fid } })); }catch(_){}
    try{ document.dispatchEvent(new CustomEvent('fr:details-refresh', { detail:{ fieldId: fid } })); }catch(_){}

    closeQuickView(state);

  }catch(e){
    console.warn('[FieldReadiness] Save & Close failed:', e);
    if (hint) hint.textContent = `Save failed: ${e.message || e}`;
    if (btn){ btn.disabled = false; btn.textContent = 'Save & Close'; }
    state._qvSaving = false;
    return;
  }

  state._qvSaving = false;
  if (btn){ btn.disabled = false; btn.textContent = 'Save & Close'; }
  if (hint) hint.textContent = 'Saved.';
}