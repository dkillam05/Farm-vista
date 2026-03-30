/* =====================================================================
/Farm-vista/js/field-readiness/render.js  (FULL FILE)
Rev: 2026-03-29a-live-details-trace-matches-runtruth

GOAL (per Dane):
✅ Read ALL displayed readiness numbers from Firestore collection:
   field_readiness_latest
✅ Treat that collection as the centralized readiness truth
✅ Make tile loading / sorting much faster by avoiding heavy per-field
   model weather computation during list rendering
✅ Keep MRMS rain range support
✅ Keep details / trace / weather panels supported as a secondary view
✅ Restore ETA helper on tiles using forecast path
✅ Cap ETA horizon to 1 week / 168 hours
✅ Show ETA as compact hours or >168h
✅ Restore dynamic readiness gradient based on operation threshold
✅ PREP: pass centralized latest truth context cleanly into ETA path
✅ FIX: stop converting blank ETA failures into fake ~1h
✅ FIX: only force ~1h when model explicitly returns 0h / dryNow while
   latest readiness is still below threshold
✅ NEW: add ETA debug logging + per-field debug cache on window.__FV_FR
✅ NEW: unresolved ETA now shows "ETA ?" instead of silently collapsing
   into a fake 1h value
✅ FIX: placeholder backend docs with status waiting_for_weather_cache
   are ignored by tile synthetic readiness path
✅ FIX: remove duplicate readinessR declaration bug
✅ FIX: render queue now truly awaits actual tile render
✅ FIX: page size is normalized on boot render so first load respects
   saved / fresh default page size instead of behaving like All
✅ NEW: field-name search filter tied to #fieldSearch input
✅ NEW: search filters rendered field tiles by field name only
✅ FIX: details tank trace + model rows now come from live runFieldReadiness(...)
   so trace matches current live model / quickview
✅ FALLBACK: if live run is unavailable, details still fall back to saved doc rows
✅ No trimmed sections

IMPORTANT ETA CHANGE:
- Before this rev, blank ETA + below-threshold could visually become ~1h.
- Now:
   * real model ETA result -> show real ETA
   * explicit contradictory 0h / dryNow -> force ~1h
   * missing forecast / error / blank -> show "ETA ?"
===================================================================== */
'use strict';

// NOTE: do NOT import PATHS; some builds don't have paths.js
import { buildWxCtx } from './state.js';
import { $, esc, clamp } from './utils.js';
import { ensureSelectedParamsToSliders } from './params.js';
import { getCurrentOp, getThresholdForOp } from './thresholds.js';
import { canEdit } from './perm.js';
import { openQuickView } from './quickview.js';
import { initSwipeOnTiles } from './swipe.js';
import { parseRangeFromInput, rainInRange, mrmsRainInRange } from './rain.js';
import { fetchAndHydrateFieldParams, loadFieldMrmsDoc } from './data.js';
import { getAPI } from './firebase.js';

// Keep these imports for details / deeper fallbacks.
// Tile rendering path no longer depends on them for readiness numbers,
// but ETA helper can lazily use them after tile render.
import { ensureFRModules, buildFRDeps, runFieldReadiness } from './formula.js';

/* =====================================================================
   Centralized readiness latest collection
===================================================================== */
const FR_LATEST_COLLECTION = 'field_readiness_latest';
const FR_LATEST_TTL_MS = 30000;

/* =====================================================================
   Persisted soil truth state (per-field)
===================================================================== */
const FR_STATE_COLLECTION = 'field_readiness_state';
const STATE_TTL_MS = 30000;

/* =====================================================================
   ETA config / cache
===================================================================== */
const ETA_HELPER_URL = '/Farm-vista/js/field-readiness/eta-helper.js';
const ETA_HELP_EVENT = 'fr:eta-help';
const ETA_HORIZON_HOURS = 168;
const ETA_CACHE_TTL_MS = 10 * 60 * 1000;
const ETA_DEBUG_ENABLED = true;

/* =====================================================================
   Search config
===================================================================== */
const FIELD_SEARCH_INPUT_ID = 'fieldSearch';
const FIELD_SEARCH_DEBOUNCE_MS = 120;

function safeObj(x){
  return (x && typeof x === 'object') ? x : null;
}
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
function markerLeftCSS(v){
  return `${clamp(Number(v) || 0, 0, 100)}%`;
}

/* =====================================================================
   Search helpers
===================================================================== */
function normalizeFieldSearchText(v){
  return String(v || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function getFieldSearchEl(){
  try{
    return document.getElementById(FIELD_SEARCH_INPUT_ID);
  }catch(_){
    return null;
  }
}

function getFieldSearchQuery(state){
  try{
    const el = getFieldSearchEl();
    const raw = el ? String(el.value || '') : String(state && state.fieldSearchQuery || '');
    const q = normalizeFieldSearchText(raw);
    if (state) state.fieldSearchQuery = q;
    return q;
  }catch(_){
    return '';
  }
}

function fieldMatchesSearch(fieldObj, query){
  try{
    const q = normalizeFieldSearchText(query);
    if (!q) return true;
    const name = normalizeFieldSearchText(fieldObj && fieldObj.name);
    return name.includes(q);
  }catch(_){
    return true;
  }
}

function updateEmptyMessageForCurrentFilters(state, filteredCount){
  try{
    const empty = $('emptyMsg');
    if (!empty) return;

    const farmId = String(state && state.farmFilter ? state.farmFilter : '__all__');
    const hasFarmFilter = farmId !== '__all__';
    const q = getFieldSearchQuery(state);
    const hasSearch = !!q;
    const count = Math.max(0, Number(filteredCount || 0));

    if (count > 0){
      empty.textContent = 'No active fields with GPS (lat/lng) found.';
      return;
    }

    if (hasSearch && hasFarmFilter){
      empty.textContent = 'No fields matched your current farm filter and search.';
      return;
    }

    if (hasSearch){
      empty.textContent = 'No fields matched your search.';
      return;
    }

    if (hasFarmFilter){
      empty.textContent = 'No fields matched the selected farm.';
      return;
    }

    empty.textContent = 'No active fields with GPS (lat/lng) found.';
  }catch(_){}
}

/* =====================================================================
   ETA debug helpers
===================================================================== */
function setEtaDebug(state, fieldId, payload){
  try{
    if (!state || !fieldId) return;
    if (!state._etaDebugByFieldId) state._etaDebugByFieldId = {};
    state._etaDebugByFieldId[String(fieldId)] = {
      atISO: new Date().toISOString(),
      ...(safeObj(payload) || {})
    };
    if (ETA_DEBUG_ENABLED){
      console.debug('[FieldReadiness][ETA DEBUG]', String(fieldId), state._etaDebugByFieldId[String(fieldId)]);
    }
  }catch(_){}
}

/* =====================================================================
   field_readiness_latest helpers
===================================================================== */
function buildLatestReadinessRecord(raw, fallbackId){
  const d = safeObj(raw) || {};
  const fieldId = safeStr(d.fieldId || fallbackId);
  if (!fieldId) return null;

  const readiness = safeInt(d.readiness);
  const wetness = safeInt(d.wetness);
  const soilWetness = safeNum(d.soilWetness);
  const drainageIndex = safeNum(d.drainageIndex);

  return {
    fieldId,
    farmId: safeStr(d.farmId),
    farmName: d.farmName == null ? null : safeStr(d.farmName),
    fieldName: safeStr(d.fieldName),
    county: safeStr(d.county),
    state: safeStr(d.state),
    readiness,
    wetness,
    soilWetness,
    drainageIndex,
    readinessCreditIn: safeNum(d.readinessCreditIn) ?? 0,
    storageFinal: safeNum(d.storageFinal),
    storageForReadiness: safeNum(d.storageForReadiness),
    storagePhysFinal: safeNum(d.storagePhysFinal),
    wetBiasApplied: safeNum(d.wetBiasApplied),
    runKey: safeStr(d.runKey),
    seedSource: safeStr(d.seedSource),
    weatherSource: safeStr(d.weatherSource),
    timezone: safeStr(d.timezone),
    status: safeStr(d.status),
    reason: safeStr(d.reason),
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
    const last = Number(state._latestReadinessLoadedAt || 0);
    if (!force && state.latestReadinessByFieldId && (now - last) < FR_LATEST_TTL_MS) return;

    state.latestReadinessByFieldId = state.latestReadinessByFieldId || {};
    const out = {};

    const api = getAPI(state);
    if (!api){
      state.latestReadinessByFieldId = out;
      state._latestReadinessLoadedAt = now;
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
      state._latestReadinessLoadedAt = now;
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
      state._latestReadinessLoadedAt = now;
      return;
    }
  }catch(e){
    console.warn('[FieldReadiness] latest readiness load failed:', e);
    state.latestReadinessByFieldId = state.latestReadinessByFieldId || {};
    state._latestReadinessLoadedAt = Date.now();
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

  // Ignore placeholder rows still waiting for backend weather cache.
  if (String(rec.status || '').toLowerCase() === 'waiting_for_weather_cache'){
    return null;
  }

  const readinessR = safeInt(rec.readiness);
  if (!Number.isFinite(readinessR)) return null;

  const raw = safeObj(rec && rec._raw) || {};

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
    wetBiasApplied: safeNum(rec.wetBiasApplied),
    runKey: safeStr(rec.runKey),
    seedSource: safeStr(rec.seedSource),
    weatherSource: safeStr(rec.weatherSource),
    timezone: safeStr(rec.timezone),
    status: safeStr(rec.status),
    reason: safeStr(rec.reason),
    computedAtISO: safeStr(rec.computedAtISO),
    weatherFetchedAtISO: safeStr(rec.weatherFetchedAtISO),
    county: safeStr(rec.county || f.county),
    state: safeStr(rec.state || f.state),

    trace:
      Array.isArray(raw.trace) ? raw.trace :
      Array.isArray(raw.soilMoistureTrace) ? raw.soilMoistureTrace :
      Array.isArray(raw.surfaceWetnessTrace) ? raw.surfaceWetnessTrace :
      Array.isArray(raw.soilTrace) ? raw.soilTrace :
      Array.isArray(raw.surfaceTrace) ? raw.surfaceTrace :
      Array.isArray(raw.tankTrace) ? raw.tankTrace :
      [],

    rows:
      Array.isArray(raw.rows) ? raw.rows :
      Array.isArray(raw.modelRows) ? raw.modelRows :
      [],

    _latest: rec
  };
}

/* =====================================================================
   Persisted state loader (kept for details/model fallback)
===================================================================== */
async function loadPersistedState(state, { force=false } = {}){
  try{
    if (!state) return;

    const now = Date.now();
    const last = Number(state._persistLoadedAt || 0);
    if (!force && state.persistedStateByFieldId && (now - last) < STATE_TTL_MS) return;

    state.persistedStateByFieldId = state.persistedStateByFieldId || {};
    const out = {};

    const api = getAPI(state);
    if (!api){
      state.persistedStateByFieldId = out;
      state._persistLoadedAt = now;
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
      state._persistLoadedAt = now;
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
      state._persistLoadedAt = now;
      return;
    }
  }catch(e){
    console.warn('[FieldReadiness] persisted state load failed:', e);
    state.persistedStateByFieldId = state.persistedStateByFieldId || {};
    state._persistLoadedAt = Date.now();
  }
}

function getPersistedStateForDeps(state, fieldId){
  try{
    const map = safeObj(state && state.persistedStateByFieldId) || {};
    const fid = safeStr(fieldId);
    const s = map[fid];
    return safeObj(s);
  }catch(_){
    return null;
  }
}

/* =====================================================================
   Inline field loading + count helper
===================================================================== */
function ensureFieldsUiStyleOnce(){
  try{
    if (window.__FV_FR_FIELDS_UI_STYLE__) return;
    window.__FV_FR_FIELDS_UI_STYLE__ = true;

    const s = document.createElement('style');
    s.setAttribute('data-fv-fr-fields-ui', '1');
    s.textContent = `
      .fr-fields-helper{
        margin-top:6px;
        font-size:12px;
        line-height:1.2;
        color:var(--muted,#67706B);
      }
      .fr-fields-loading{
        border:1px solid var(--border);
        border-radius:14px;
        background:color-mix(in srgb, var(--surface) 96%, #ffffff 4%);
        padding:16px 14px;
        display:grid;
        gap:10px;
        box-shadow:0 6px 16px rgba(0,0,0,.04);
      }
      .fr-fields-loading-row{
        display:flex;
        align-items:center;
        gap:12px;
        min-width:0;
      }
      .fr-fields-spinner{
        width:22px;
        height:22px;
        border-radius:999px;
        border:2px solid color-mix(in srgb, var(--border) 75%, transparent 25%);
        border-top-color: var(--accent, #2F6C3C);
        animation: fr-fields-spin 0.85s linear infinite;
        flex:0 0 auto;
      }
      .fr-fields-loading-title{
        font-weight:900;
        font-size:13px;
        line-height:1.2;
        color:var(--text);
      }
      .fr-fields-loading-sub{
        font-size:12px;
        line-height:1.35;
        color:var(--muted,#67706B);
      }
      .fr-fields-loading-bars{
        display:grid;
        gap:8px;
      }
      .fr-fields-loading-bar{
        height:10px;
        border-radius:999px;
        background:
          linear-gradient(90deg,
            color-mix(in srgb, var(--surface) 92%, #ffffff 8%) 0%,
            color-mix(in srgb, var(--accent) 12%, var(--surface) 88%) 50%,
            color-mix(in srgb, var(--surface) 92%, #ffffff 8%) 100%);
        background-size: 220% 100%;
        animation: fr-fields-sheen 1.35s ease-in-out infinite;
      }
      .fr-fields-loading-bar:nth-child(1){ width:100%; }
      .fr-fields-loading-bar:nth-child(2){ width:88%; }
      .fr-fields-loading-bar:nth-child(3){ width:94%; }
      .fr-fields-loading-bar:nth-child(4){ width:76%; }

      @keyframes fr-fields-spin{
        from{ transform:rotate(0deg); }
        to{ transform:rotate(360deg); }
      }
      @keyframes fr-fields-sheen{
        0%{ background-position:200% 0; }
        100%{ background-position:-20% 0; }
      }
    `;
    document.head.appendChild(s);
  }catch(_){}
}

function ensureFieldsCountHelperEl(){
  try{
    ensureFieldsUiStyleOnce();

    let el = document.getElementById('frFieldsCountHelper');
    if (el) return el;

    const grid = document.getElementById('fieldsGrid');
    if (!grid || !grid.parentElement) return null;

    el = document.createElement('div');
    el.id = 'frFieldsCountHelper';
    el.className = 'fr-fields-helper muted';
    el.textContent = '';

    grid.insertAdjacentElement('beforebegin', el);
    return el;
  }catch(_){
    return null;
  }
}

function updateFieldsCountHelper(showingCount, totalCount){
  try{
    const el = ensureFieldsCountHelperEl();
    if (!el) return;

    const showN = Math.max(0, Number(showingCount || 0));
    const totalN = Math.max(0, Number(totalCount || 0));
    const q = getFieldSearchQuery(window.__FV_FR || null);

    if (!totalN){
      el.textContent = q ? 'Showing 0 matching fields' : 'Showing 0 fields';
      return;
    }

    if (q){
      el.textContent = `Showing ${showN} of ${totalN} matching field${totalN === 1 ? '' : 's'}`;
      return;
    }

    el.textContent = `Showing ${showN} of ${totalN} field${totalN === 1 ? '' : 's'}`;
  }catch(_){}
}

function setFieldsCountHelperMessage(msg){
  try{
    const el = ensureFieldsCountHelperEl();
    if (!el) return;
    el.textContent = String(msg || '');
  }catch(_){}
}

function renderFieldsInlineLoading(message, subtext){
  try{
    ensureFieldsUiStyleOnce();

    const wrap = document.getElementById('fieldsGrid');
    if (!wrap) return;

    wrap.innerHTML = `
      <div class="fr-fields-loading" aria-live="polite" aria-busy="true">
        <div class="fr-fields-loading-row">
          <div class="fr-fields-spinner" aria-hidden="true"></div>
          <div style="min-width:0;">
            <div class="fr-fields-loading-title">${esc(message || 'Loading field readiness...')}</div>
            <div class="fr-fields-loading-sub">${esc(subtext || 'Centralized readiness values are being loaded now.')}</div>
          </div>
        </div>
        <div class="fr-fields-loading-bars" aria-hidden="true">
          <div class="fr-fields-loading-bar"></div>
          <div class="fr-fields-loading-bar"></div>
          <div class="fr-fields-loading-bar"></div>
          <div class="fr-fields-loading-bar"></div>
        </div>
      </div>
    `;
  }catch(_){}
}

/* =====================================================================
   Render gate
===================================================================== */
function ensureRenderGate(state){
  if (!state) return null;
  if (!state._renderGate){
    state._renderGate = {
      inFlight: false,
      wantAll: false,
      wantDetails: false,
      timer: null,
      pendingPromise: null,
      pendingResolve: null
    };
  }
  return state._renderGate;
}

function ensureGatePendingPromise(g){
  if (!g) return Promise.resolve();
  if (!g.pendingPromise){
    g.pendingPromise = new Promise((resolve)=>{
      g.pendingResolve = resolve;
    });
  }
  return g.pendingPromise;
}

function resolveGatePendingPromise(g){
  try{
    const resolve = g && g.pendingResolve;
    g.pendingResolve = null;
    g.pendingPromise = null;
    if (typeof resolve === 'function') resolve();
  }catch(_){}
}

async function scheduleRender(state, mode){
  const g = ensureRenderGate(state);
  if (!g) return;

  if (mode === 'all') g.wantAll = true;
  if (mode === 'details') g.wantDetails = true;

  const waitForThisCycle = ensureGatePendingPromise(g);

  if (g.inFlight) return waitForThisCycle;
  if (g.timer) return waitForThisCycle;

  g.timer = setTimeout(async ()=>{
    g.timer = null;
    if (g.inFlight) return;

    g.inFlight = true;
    try{
      const doAll = !!g.wantAll;
      const doDetails = !!g.wantDetails;

      g.wantAll = false;
      g.wantDetails = false;

      if (doAll){
        await _renderTilesInternal(state);
        await _renderDetailsInternal(state);
      } else if (doDetails){
        await _renderDetailsInternal(state);
        try{
          if (state && state.selectedFieldId) await updateTileForField(state, state.selectedFieldId);
        }catch(_){}
      }
    }catch(_){
    }finally{
      g.inFlight = false;
      resolveGatePendingPromise(g);

      if (g.wantAll || g.wantDetails){
        scheduleRender(state, g.wantAll ? 'all' : 'details');
      }
    }
  }, 25);

  return waitForThisCycle;
}

/* ---------- optional deep module loader ---------- */
export async function ensureModelWeatherModules(state){
  await ensureFRModules(state);
}

/* =====================================================================
   ETA helper module
===================================================================== */
async function ensureEtaHelperModule(state){
  try{
    if (!state) return;
    if (!state._mods) state._mods = {};
    if (state._mods.etaHelperLoaded) return;
    await import(ETA_HELPER_URL);
    state._mods.etaHelperLoaded = true;
  }catch(e){
    console.warn('[FieldReadiness] eta-helper load failed:', e);
  }
}

function dispatchEtaHelp(state, payload){
  try{ ensureEtaHelperModule(state); }catch(_){}
  try{ document.dispatchEvent(new CustomEvent(ETA_HELP_EVENT, { detail: payload || {} })); }catch(_){}
}

/* ---------- colors ---------- */
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

  if (x <= 2) return `hsl(5 75% 30%)`;
  if (x >= 98) return `hsl(120 60% 28%)`;

  let h;
  if (x <= 50){
    const frac = x / 50;
    h = 10 + (45 - 10) * frac;
  } else {
    const frac = (x - 50) / 50;
    h = 45 + (120 - 45) * frac;
  }

  return `hsl(${h.toFixed(0)} 70% 45%)`;
}
function buildThresholdGradientStops(thr){
  const t = clamp(Math.round(Number(thr)), 0, 100);

  if (t <= 0){
    return {
      redEnd: 0,
      yellowAt: 4,
      greenStart: 8
    };
  }
  if (t >= 100){
    return {
      redEnd: 92,
      yellowAt: 96,
      greenStart: 100
    };
  }

  const redEnd = clamp(Math.round(t * 0.50), 0, 96);
  const yellowAt = clamp(t, redEnd + 1, 98);
  const greenStart = clamp(Math.round(t + ((100 - t) * 0.40)), yellowAt + 1, 100);

  return { redEnd, yellowAt, greenStart };
}
function gradientForThreshold(thr){
  const t = clamp(Math.round(Number(thr)), 0, 100);

  const redEnd = clamp(Math.round(t * 0.52), 0, 82);
  const orangeAt = clamp(t - 12, redEnd + 2, 90);
  const yellowMid = clamp(t, orangeAt + 2, 94);
  const yellowEnd = clamp(t + 10, yellowMid + 2, 96);
  const limeAt = clamp(yellowEnd + 6, yellowEnd + 2, 98);

  return `linear-gradient(90deg,
    hsl(8 78% 44%) 0%,
    hsl(16 82% 47%) ${redEnd}%,
    hsl(30 84% 49%) ${orangeAt}%,
    hsl(46 88% 51%) ${yellowMid}%,
    hsl(54 86% 50%) ${yellowEnd}%,
    hsl(82 70% 46%) ${limeAt}%,
    hsl(112 58% 42%) 100%
  )`;
}

/* =====================================================================
   MRMS tile rainfall helpers
===================================================================== */
async function getMrmsRainResultForField(state, fieldId, range, { force=false } = {}){
  try{
    const doc = await loadFieldMrmsDoc(state, String(fieldId), { force });
    return mrmsRainInRange(doc, range);
  }catch(_){
    return { ready:false, inches:null, mm:null, reason:'load-failed' };
  }
}

function rainTileTextFromMrmsResult(res){
  if (!res || res.ready !== true) return 'Processing Data';
  return `${Number(res.inches || 0).toFixed(2)} in`;
}

function rainSortValueFromMrmsResult(res){
  if (!res || res.ready !== true) return null;
  const n = Number(res.inches);
  return Number.isFinite(n) ? n : null;
}

function getSortMode(){
  const sel = $('sortSel');
  return String(sel ? sel.value : 'name_az');
}

function sortNeedsComputedData(mode){
  return (
    mode === 'ready_dry_wet' ||
    mode === 'ready_wet_dry' ||
    mode === 'rain_most' ||
    mode === 'rain_least'
  );
}
void sortNeedsComputedData;

/* ---------- page size helpers ---------- */
function normalizePageSizeRaw(raw, pageSel){
  const allowed = pageSel
    ? Array.from(pageSel.options || []).map(o => String(o.value))
    : ['25', '50', '100', '250', '__all__'];

  const v = String(raw || '').trim();
  if (allowed.includes(v)) return v;
  return '25';
}

function rawPageSizeToNumber(raw){
  return (raw === '__all__')
    ? -1
    : (Number.isFinite(Number(raw)) ? Math.max(1, Math.round(Number(raw))) : 25);
}

function syncEffectivePageSize(state){
  try{
    const sel = document.getElementById('pageSel');
    const stateRaw = (state && Number(state.pageSize) === -1)
      ? '__all__'
      : String((state && state.pageSize) || '25');

    const currentRaw = String(sel ? sel.value : stateRaw).trim();
    const normalizedRaw = normalizePageSizeRaw(currentRaw || stateRaw, sel || null);
    const normalizedNum = rawPageSizeToNumber(normalizedRaw);

    if (sel && sel.value !== normalizedRaw){
      sel.value = normalizedRaw;
    }

    if (state){
      state.pageSize = normalizedNum;
    }

    return normalizedNum;
  }catch(_){
    return (state && Number(state.pageSize) === -1) ? -1 : Math.max(1, Math.round(Number((state && state.pageSize) || 25)));
  }
}

function getEffectivePageSize(state){
  return syncEffectivePageSize(state);
}

/* ---------- view key ---------- */
function getTilesViewKey(state){
  const opKey = getCurrentOp();
  const farmId = String(state && state.farmFilter ? state.farmFilter : '__all__');
  const pageSize = String(getEffectivePageSize(state));
  const sort = getSortMode();
  const rangeStr = String(($('jobRangeInput') && $('jobRangeInput').value) ? $('jobRangeInput').value : '');
  const latestStamp = String(Number(state && state._latestReadinessLoadedAt || 0));
  const searchQ = getFieldSearchQuery(state);
  return `${opKey}__${farmId}__${pageSize}__${sort}__${rangeStr}__${latestStamp}__${searchQ}`;
}

/* ---------- sorting ---------- */
function sortFields(fields, runsById, mrmsRangeById){
  const mode = getSortMode();
  const range = parseRangeFromInput();
  const collator = new Intl.Collator(undefined, { numeric:true, sensitivity:'base' });
  const arr = fields.slice();

  arr.sort((a,b)=>{
    const ra = runsById.get(a.id);
    const rb = runsById.get(b.id);

    const nameA = `${a.name||''}`;
    const nameB = `${b.name||''}`;

    const readyA = ra ? safeNum(ra.readinessR) : null;
    const readyB = rb ? safeNum(rb.readinessR) : null;

    const mrmsA = mrmsRangeById ? mrmsRangeById.get(a.id) : null;
    const mrmsB = mrmsRangeById ? mrmsRangeById.get(b.id) : null;
    const rainA = rainSortValueFromMrmsResult(mrmsA);
    const rainB = rainSortValueFromMrmsResult(mrmsB);

    if (mode === 'name_az') return collator.compare(nameA, nameB);
    if (mode === 'name_za') return collator.compare(nameB, nameA);

    if (mode === 'ready_dry_wet'){
      if (readyA == null && readyB != null) return 1;
      if (readyA != null && readyB == null) return -1;
      if (readyB !== readyA) return Number(readyB || 0) - Number(readyA || 0);
      return collator.compare(nameA, nameB);
    }

    if (mode === 'ready_wet_dry'){
      if (readyA == null && readyB != null) return 1;
      if (readyA != null && readyB == null) return -1;
      if (readyB !== readyA) return Number(readyA || 0) - Number(readyB || 0);
      return collator.compare(nameA, nameB);
    }

    if (mode === 'rain_most'){
      const va = (rainA == null ? -1 : rainA);
      const vb = (rainB == null ? -1 : rainB);
      if (vb !== va) return vb - va;
      return collator.compare(nameA, nameB);
    }

    if (mode === 'rain_least'){
      const va = (rainA == null ? Number.POSITIVE_INFINITY : rainA);
      const vb = (rainB == null ? Number.POSITIVE_INFINITY : rainB);
      if (va !== vb) return va - vb;
      return collator.compare(nameA, nameB);
    }

    const legacyA = ra ? rainInRange(ra, range) : 0;
    const legacyB = rb ? rainInRange(rb, range) : 0;
    return legacyA - legacyB;
  });

  return arr;
}

/* ---------- farm filter + search filter ---------- */
function getFilteredFields(state){
  const farmId = String(state.farmFilter || '__all__');
  const searchQ = getFieldSearchQuery(state);

  let out = state.fields.slice();

  if (farmId !== '__all__'){
    out = out.filter(f => String(f.farmId || '') === farmId);
  }

  if (searchQ){
    out = out.filter(f => fieldMatchesSearch(f, searchQ));
  }

  return out;
}

function getFilteredFieldSignature(fields){
  try{
    const list = Array.isArray(fields) ? fields : [];
    return list.map(f => String(f && f.id || '')).filter(Boolean).join('|');
  }catch(_){
    return '';
  }
}

/* =====================================================================
   Selection CSS
===================================================================== */
function ensureSelectionStyleOnce(){
  try{
    if (window.__FV_FR_SELSTYLE__) return;
    window.__FV_FR_SELSTYLE__ = true;

    const s = document.createElement('style');
    s.setAttribute('data-fv-fr-selstyle','1');
    s.textContent = `
      .tile .tile-top{
        display:flex !important;
        align-items:center !important;
        justify-content:space-between !important;
        gap:8px !important;
        flex-wrap:nowrap !important;
        min-width:0 !important;
      }
      .tile .tile-top .titleline{
        display:flex !important;
        align-items:center !important;
        flex:1 1 0 !important;
        min-width:0 !important;
        flex-wrap:nowrap !important;
      }
      .tile .tile-top .readiness-pill{
        flex:0 0 auto !important;
        white-space:nowrap !important;
      }
      .tile .tile-top .titleline .name{
        flex:1 1 auto !important;
        display:block !important;
        min-width:0 !important;
        max-width:100% !important;
        white-space:nowrap !important;
        overflow:hidden !important;
        text-overflow:ellipsis !important;
      }

      @media (hover: none) and (pointer: coarse){
        .tile.fv-selected .tile-top .titleline .name{
          color: inherit !important;
          text-decoration: underline !important;
          text-decoration-thickness: 2px !important;
          text-underline-offset: 3px !important;
          text-decoration-color: var(--accent, #2F6C3C) !important;
          font-weight: 950 !important;

          display:block !important;
          min-width:0 !important;
          max-width:100% !important;
          white-space:nowrap !important;
          overflow:hidden !important;
          text-overflow:ellipsis !important;

          padding: 2px 6px !important;
          border-radius: 8px !important;
          background: rgba(47,108,60,0.12) !important;
          box-shadow: inset 0 -2px 0 rgba(47,108,60,0.55) !important;
        }

        html.dark .tile.fv-selected .tile-top .titleline .name{
          background: rgba(47,108,60,0.18) !important;
          box-shadow: inset 0 -2px 0 rgba(47,108,60,0.70) !important;
        }
      }

      @media (hover: hover) and (pointer: fine){
        .tile.fv-selected{
          box-shadow:
            0 0 0 2px rgba(47,108,60,0.40),
            0 10px 18px rgba(15,23,42,0.08);
          border-radius: 14px;
        }

        html.dark .tile.fv-selected{
          box-shadow:
            0 0 0 2px rgba(47,108,60,0.45),
            0 12px 22px rgba(0,0,0,0.28);
        }

        .tile.fv-selected .tile-top .titleline .name{
          color: inherit !important;
          text-decoration: none !important;
          font-weight: inherit !important;
          padding: 0 !important;
          border-radius: 0 !important;
          background: transparent !important;
          box-shadow: none !important;

          display:block !important;
          min-width:0 !important;
          max-width:100% !important;
          white-space:nowrap !important;
          overflow:hidden !important;
          text-overflow:ellipsis !important;
        }
      }

      #frDetailsHeaderPanel{
        margin: 0 !important;
        padding: 10px 12px !important;
      }
      #frDetailsHeaderPanel .frdh-title{
        font-weight: 950;
        font-size: 13px;
        line-height: 1.2;
      }
      #frDetailsHeaderPanel .frdh-sub{
        font-size: 12px;
        line-height: 1.2;
        color: var(--muted,#67706B);
        margin-top: 4px;
      }

      .tile .etaSlot{
        display:flex;
        justify-content:flex-start;
        align-items:center;
        margin-top: 6px;
        min-height: 18px;
      }
      .tile .help{
        display:flex;
        justify-content:flex-start;
        align-items:center;
        width: 100%;
        margin: 0;
      }
      .tile .eta-help-btn{
        -webkit-tap-highlight-color: transparent;
        border: 0;
        background: transparent;
        padding: 2px 4px;
        margin: 0;
        border-radius: 10px;
        font-weight: 500;
        font-size: 12px;
        line-height: 1.1;
        color: var(--text, #111);
        cursor: pointer;
        text-align: left;
      }
      html.dark .tile .eta-help-btn{
        color: var(--text, #f1f5f9);
      }
      @media (hover: none) and (pointer: coarse){
        .tile .eta-help-btn{
          padding: 6px 6px;
        }
      }
      .tile .eta-help-btn:active{
        transform: scale(0.99);
      }
      .tile .eta-help-btn:focus{
        outline: none;
        box-shadow: 0 0 0 2px rgba(47,108,60,0.25);
      }
    `;
    document.head.appendChild(s);
  }catch(_){}
}

function setSelectedTileClass(state, fieldId){
  try{
    const fid = String(fieldId || '');
    if (!fid) return;

    const prev = String(state._selectedTileId || '');
    if (prev && prev !== fid){
      const prevEl = document.querySelector('.tile[data-field-id="' + CSS.escape(prev) + '"]');
      if (prevEl) prevEl.classList.remove('fv-selected');
    }

    const curEl = document.querySelector('.tile[data-field-id="' + CSS.escape(fid) + '"]');
    if (curEl) curEl.classList.add('fv-selected');

    state._selectedTileId = fid;
  }catch(_){}
}

function setSelectedField(state, fieldId){
  state.selectedFieldId = fieldId;
  ensureSelectionStyleOnce();
  setSelectedTileClass(state, fieldId);
  try{ document.dispatchEvent(new CustomEvent('fr:selected-field-changed', { detail:{ fieldId } })); }catch(_){}
}

/* =====================================================================
   Details header panel
===================================================================== */
function ensureDetailsHeaderPanel(){
  const details = document.getElementById('detailsPanel');
  if (!details) return null;

  const body = details.querySelector('.details-body');
  if (!body) return null;

  let panel = document.getElementById('frDetailsHeaderPanel');
  if (panel && panel.parentElement === body) return panel;

  panel = document.createElement('div');
  panel.id = 'frDetailsHeaderPanel';
  panel.className = 'panel';
  panel.style.margin = '0';
  panel.style.display = 'grid';
  panel.style.gap = '4px';

  body.prepend(panel);
  return panel;
}

function updateDetailsHeaderPanel(state){
  const f = (state.fields || []).find(x=>x.id === state.selectedFieldId);
  if (!f) return;

  const latest = getLatestReadinessForField(state, f.id);

  const panel = ensureDetailsHeaderPanel();
  if (!panel) return;

  const farmName =
    (latest && latest.farmName) ||
    ((state.farmsById && state.farmsById.get) ? (state.farmsById.get(f.farmId) || '') : '');

  const title = farmName ? `${farmName} • ${f.name || ''}` : (f.name || '—');
  const locCounty = (latest && latest.county) || f.county || '—';
  const locState = (latest && latest.state) || f.state || '—';
  const loc = `${String(locCounty)} / ${String(locState)}`;

  const readinessTxt = (latest && Number.isFinite(Number(latest.readiness)))
    ? ` • Field Readiness ${Math.round(Number(latest.readiness))}`
    : '';

  panel.innerHTML = `
    <div class="frdh-title">${esc(title)}${esc(readinessTxt)}</div>
    <div class="frdh-sub">${esc(loc)}</div>
  `;
}

/* =====================================================================
   ETA helpers
===================================================================== */
const ETA_FORCE_ONE_HOUR_MAX_GAP = 1; // only allow ~1h if field is within 1 point of threshold

function parseEtaHoursFromText(txt){
  const s = String(txt || '');
  let m = s.match(/~\s*(\d+)\s*hours/i);
  if (m){
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
  }
  m = s.match(/~\s*(\d+)\s*h\b/i);
  if (m){
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function compactEtaForMobile(txt, horizonHours){
  const s = String(txt || '');
  const h = parseEtaHoursFromText(s);

  if (h != null && Number.isFinite(h)){
    if (h <= horizonHours) return `~${Math.round(h)}h`;
    return `>${Math.round(horizonHours)}h`;
  }

  if (/greater\s+than/i.test(s) || />\s*\d+/.test(s) || /beyond/i.test(s) || /over\s+\d+/i.test(s)){
    return `>${Math.round(horizonHours)}h`;
  }

  return s;
}

function isZeroEtaLike(txt){
  const s = String(txt || '').trim().toLowerCase();
  if (!s) return false;
  return (
    s === '0' ||
    s === '~0h' ||
    s === '0h' ||
    s === '~0' ||
    s === 'dry now' ||
    s === 'drynow'
  );
}

/*
  IMPORTANT CHANGE:
  We no longer "massage" zero-ish ETA into ~1h here.
  If the model gives a contradictory zero-ish answer while the field is still
  below threshold, treat that as unresolved unless shouldForceOneHourEta()
  explicitly allows it.
*/
function forceNonZeroEtaText(txt, readinessNow, thr){
  const s = String(txt || '').trim();
  if (!s) return '';

  const h = parseEtaHoursFromText(s);
  if (Number.isFinite(h)){
    return `~${Math.max(1, Math.round(h))}h`;
  }

  return s;
}

/*
  IMPORTANT CHANGE:
  Do NOT force ~1h anymore.
  Show the exact modeled hour count when available.
*/
function shouldForceOneHourEta(_res, _txt, _readinessNow, _thr, _forecastCount=0){
  return false;
}

function buildEtaFailureText(res, readinessNow, thr){
  const ready = Number(readinessNow);
  const threshold = Number(thr);

  if (!Number.isFinite(ready) || !Number.isFinite(threshold)) return '';
  if (ready >= threshold) return '';

  const status = String((res && res.status) || '').toLowerCase();
  const hours = Number(res && res.hours);
  const text = String((res && res.text) || '').trim();

  if (status === 'beyond' || status === 'notwithin72'){
    return `>${ETA_HORIZON_HOURS}h`;
  }

  if (Number.isFinite(hours)){
    return hours <= ETA_HORIZON_HOURS
      ? `~${Math.max(1, Math.round(hours))}h`
      : `>${ETA_HORIZON_HOURS}h`;
  }

  if (text){
    const compact = compactEtaForMobile(text, ETA_HORIZON_HOURS);
    if (compact) return compact;
  }

  return 'ETA ?';
}

function getEtaCacheKey(fieldObj, opKey, thr, latestRec){
  const fid = safeStr(fieldObj && fieldObj.id);
  const latestStamp =
    safeStr(latestRec && latestRec.computedAtISO) ||
    safeStr(latestRec && latestRec.weatherFetchedAtISO) ||
    safeStr(latestRec && latestRec.runKey) ||
    safeStr(latestRec && latestRec.fieldId);

  const latestReadiness = safeStr(latestRec && latestRec.readiness);
  return `${fid}__${safeStr(opKey)}__${Math.round(Number(thr) || 0)}__${latestStamp}__${latestReadiness}`;
}

function getEtaCacheValue(state, key, { readinessNow=null, threshold=null } = {}){
  try{
    const map = safeObj(state && state._etaTileCache) || {};
    const hit = safeObj(map[key]);
    if (!hit) return null;

    const ts = Number(hit.ts || 0);
    if (!ts || (Date.now() - ts) > ETA_CACHE_TTL_MS) return null;

    const txt = safeStr(hit.text);
    const ready = Number(readinessNow);
    const thr = Number(threshold);

    // Never trust cached fake-short or unresolved ETA.
    if (txt === '~1h' || txt === 'ETA ?') return null;

    if (Number.isFinite(ready) && Number.isFinite(thr) && ready < thr && isZeroEtaLike(txt)){
      return null;
    }

    return txt;
  }catch(_){
    return null;
  }
}

function setEtaCacheValue(state, key, text){
  try{
    const txt = safeStr(text);

    // Do not cache unresolved or suspiciously short fallback ETA.
    if (!txt || txt === '~1h' || txt === 'ETA ?') return;

    if (!state._etaTileCache) state._etaTileCache = {};
    state._etaTileCache[key] = {
      ts: Date.now(),
      text: txt
    };
  }catch(_){}
}

function normalizeEtaResult(res, horizonHours){
  try{
    const r = safeObj(res) || {};
    const status = String(r.status || '').toLowerCase();

    if (status === 'beyond' || status === 'notwithin72'){
      return `>${horizonHours}h`;
    }

    if (Number.isFinite(Number(r.hours))){
      const hrs = Math.round(Number(r.hours));
      return (hrs <= horizonHours) ? `~${hrs}h` : `>${horizonHours}h`;
    }

    const txt = safeStr(r.text).trim();
    if (txt){
      return compactEtaForMobile(txt, horizonHours);
    }

    if (r.exceedsHorizon === true || r.withinHorizon === false || r.reached === false){
      return `>${horizonHours}h`;
    }
  }catch(_){}
  return '';
}

function buildEtaDepsForField(state, fieldObj, opKey, latestRec){
  const deps = buildDepsForState(state, opKey);
  const rec = latestRec || getLatestReadinessForField(state, fieldObj && fieldObj.id) || null;

  if (!deps || typeof deps !== 'object') return deps;

  function getRecForField(id){
    const fid = String(id || '');
    if (rec && String(rec.fieldId || fieldObj?.id || '') === fid) return rec;
    try{
      return getLatestReadinessForField(state, fid);
    }catch(_){
      return null;
    }
  }

  function getRawLatestDocForField(id){
    try{
      const useRec = getRecForField(id);
      return safeObj(useRec && useRec._raw) || {};
    }catch(_){
      return {};
    }
  }

  function normalizeForecastRows(rows){
    try{
      return (Array.isArray(rows) ? rows : [])
        .map(r => normalizeForecastRow(r))
        .filter(r => r && r.dateISO)
        .map(r => ({
          ...r,
          rainInAdj: Number.isFinite(Number(r.rainInAdj)) ? Number(r.rainInAdj) : Number(r.rainIn || 0),
          rainSource: String(r.rainSource || 'open-meteo')
        }));
    }catch(_){
      return [];
    }
  }

  function normalizeHistoryRows(rows){
    try{
      return (Array.isArray(rows) ? rows : [])
        .map(r => normalizeDailyWxRow(r))
        .filter(r => r && r.dateISO)
        .map(r => ({
          ...r,
          rainInAdj: Number.isFinite(Number(r.rainInAdj)) ? Number(r.rainInAdj) : 0,
          rainSource: String(r.rainSource || 'history')
        }));
    }catch(_){
      return [];
    }
  }

  function getForecastRowsFromAnySource(id){
    const fid = String(id || '');

    try{
      if (deps && typeof deps.getForecastSeriesForFieldId === 'function'){
        const got = deps.getForecastSeriesForFieldId(fid);
        if (Array.isArray(got) && got.length){
          const norm = normalizeForecastRows(got);
          if (norm.length) return norm;
        }
      }
    }catch(_){}

    try{
      const cache = state && state._frForecastCache instanceof Map ? state._frForecastCache : null;
      const got = cache ? cache.get(fid) : null;
      if (Array.isArray(got) && got.length){
        const norm = normalizeForecastRows(got);
        if (norm.length) return norm;
      }
    }catch(_){}

    try{
      const raw = getRawLatestDocForField(fid);

      const direct =
        Array.isArray(raw.dailySeriesFcst) ? raw.dailySeriesFcst :
        Array.isArray(raw.forecastRows) ? raw.forecastRows :
        Array.isArray(raw.weatherForecastRows) ? raw.weatherForecastRows :
        Array.isArray(raw.forecastDailyRows) ? raw.forecastDailyRows :
        Array.isArray(raw.openMeteoForecastRows) ? raw.openMeteoForecastRows :
        [];

      const norm = normalizeForecastRows(direct);
      if (norm.length) return norm;
    }catch(_){}

    return [];
  }

  function getMergedWxRowsFromAnySource(id){
    const fid = String(id || '');

    try{
      if (deps && typeof deps.getWxSeriesWithForecastForFieldId === 'function'){
        const got = deps.getWxSeriesWithForecastForFieldId(fid);
        if (Array.isArray(got) && got.length) return got;
      }
    }catch(_){}

    try{
      const raw = getRawLatestDocForField(fid);
      const hist = normalizeHistoryRows(
        Array.isArray(raw.dailySeries30d) ? raw.dailySeries30d : []
      );
      const fcst = getForecastRowsFromAnySource(fid);

      if (hist.length || fcst.length){
        return [...hist, ...fcst];
      }
    }catch(_){}

    return [];
  }

  return {
    ...deps,

    getCentralizedLatestForFieldId: (id)=>{
      return getRecForField(id);
    },

    getEtaSeedForFieldId: (id)=>{
      const fid = String(id || '');
      const useRec = getRecForField(fid);

      if (!useRec) return null;

      return {
        fieldId: String(useRec.fieldId || fid),
        readiness: safeNum(useRec.readiness),
        wetness: safeNum(useRec.wetness),
        storagePhysFinal: safeNum(useRec.storagePhysFinal),
        storageFinal: safeNum(useRec.storageFinal),
        storageForReadiness: safeNum(useRec.storageForReadiness),
        readinessCreditIn: safeNum(useRec.readinessCreditIn),
        wetBiasApplied: safeNum(useRec.wetBiasApplied),
        computedAtISO: safeStr(useRec.computedAtISO),
        weatherFetchedAtISO: safeStr(useRec.weatherFetchedAtISO),
        runKey: safeStr(useRec.runKey),
        source: 'field_readiness_latest'
      };
    },

    // CRITICAL FIX:
    // ETA can now read forecast directly from Firestore latest doc fallback
    getForecastSeriesForFieldId: (id)=>{
      return getForecastRowsFromAnySource(id);
    },

    // CRITICAL FIX:
    // ETA fallback path can also read merged history + forecast from latest doc
    getWxSeriesWithForecastForFieldId: (id)=>{
      return getMergedWxRowsFromAnySource(id);
    }
  };
}

async function getTileEtaText(state, fieldObj, deps, run0, thr, latestRec){
  const HORIZON_HOURS = ETA_HORIZON_HOURS;
  const readinessNow = Number(run0 && run0.readinessR);
  const fid = String(fieldObj && fieldObj.id || '');

  if (!Number.isFinite(readinessNow)) {
    setEtaDebug(state, fid, {
      phase: 'precheck',
      reason: 'no-readiness-now',
      readinessNow,
      threshold: Number(thr)
    });
    return '';
  }

  if (readinessNow >= Number(thr)) {
    setEtaDebug(state, fid, {
      phase: 'precheck',
      reason: 'already-at-threshold',
      readinessNow,
      threshold: Number(thr)
    });
    return '';
  }

  try{
    const latest = latestRec || getLatestReadinessForField(state, fieldObj && fieldObj.id);
    const authoritativeReadiness = Number(
      latest && Number.isFinite(Number(latest.readiness))
        ? Number(latest.readiness)
        : readinessNow
    );

    const opKey = getCurrentOp();
    const cacheKey = getEtaCacheKey(fieldObj, opKey, thr, latest);
    const cached = getEtaCacheValue(state, cacheKey, {
      readinessNow: authoritativeReadiness,
      threshold: thr
    });

    if (cached){
      const outCached = forceNonZeroEtaText(cached, authoritativeReadiness, thr) || cached;
      setEtaDebug(state, fid, {
        phase: 'cache-hit',
        readinessNow,
        authoritativeReadiness,
        threshold: Number(thr),
        latestComputedAtISO: safeStr(latest && latest.computedAtISO),
        latestWeatherFetchedAtISO: safeStr(latest && latest.weatherFetchedAtISO),
        latestStoragePhysFinal: safeNum(latest && latest.storagePhysFinal),
        latestStorageFinal: safeNum(latest && latest.storageFinal),
        outText: outCached
      });
      return outCached;
    }

    await ensureFRModules(state);
    await ensureEtaHelperModule(state);
    await loadPersistedState(state, { force:false });

    const fc = state && state._mods ? state._mods.forecast : null;
    if (fc && typeof fc.readWxSeriesFromCache === 'function'){
      try{
        const wx = await fc.readWxSeriesFromCache(String(fieldObj.id), {});
        const fcstRows = Array.isArray(wx?.fcst) ? wx.fcst.map(r => ({
          ...r,
          rainInAdj: Number.isFinite(Number(r?.rainInAdj)) ? Number(r.rainInAdj) : Number(r?.rainIn || 0),
          rainSource: String(r?.rainSource || r?.precipSource || 'open-meteo')
        })) : [];

        state._frForecastCache = (state._frForecastCache instanceof Map) ? state._frForecastCache : new Map();
        state._frForecastMetaByFieldId = (state._frForecastMetaByFieldId instanceof Map) ? state._frForecastMetaByFieldId : new Map();

        state._frForecastCache.set(String(fieldObj.id), fcstRows);
        state._frForecastMetaByFieldId.set(String(fieldObj.id), {
          count: fcstRows.length,
          updatedAt: Date.now(),
          source: 'open-meteo'
        });
      }catch(_){}
    }

const model = state && state._mods ? state._mods.model : null;
if (!model || typeof model.etaToThreshold !== 'function'){
  setEtaDebug(state, fid, {
    phase: 'model-missing',
    readinessNow,
    authoritativeReadiness,
    threshold: Number(thr)
  });
  return `>${ETA_HORIZON_HOURS}h`;
}

    const etaDeps = buildEtaDepsForField(state, fieldObj, opKey, latest);
    const forecastRows =
      (etaDeps && typeof etaDeps.getForecastSeriesForFieldId === 'function')
        ? (etaDeps.getForecastSeriesForFieldId(fid) || [])
        : [];
    const forecastCount = Array.isArray(forecastRows) ? forecastRows.length : 0;

    const res = await model.etaToThreshold(fieldObj, etaDeps || deps, Number(thr), HORIZON_HOURS, 3);

    let txt = normalizeEtaResult(res, HORIZON_HOURS);

    const status = String(res && res.status || '').toLowerCase();
    if (
      !txt &&
      (
        status === 'beyond' ||
        status === 'notwithin72' ||
        res?.exceedsHorizon === true ||
        res?.withinHorizon === false ||
        res?.reached === false
      )
    ){
      txt = `>${HORIZON_HOURS}h`;
    }

txt = forceNonZeroEtaText(txt, authoritativeReadiness, thr);

if (!txt){
  txt = buildEtaFailureText(res, authoritativeReadiness, thr);
}

    if (txt){
      setEtaCacheValue(state, cacheKey, txt);
    }

    setEtaDebug(state, fid, {
      phase: 'model-result',
      readinessNow,
      authoritativeReadiness,
      threshold: Number(thr),
      thresholdGap: Number(thr) - authoritativeReadiness,
      latestComputedAtISO: safeStr(latest && latest.computedAtISO),
      latestWeatherFetchedAtISO: safeStr(latest && latest.weatherFetchedAtISO),
      latestStoragePhysFinal: safeNum(latest && latest.storagePhysFinal),
      latestStorageFinal: safeNum(latest && latest.storageFinal),
      latestStorageForReadiness: safeNum(latest && latest.storageForReadiness),
      latestRunKey: safeStr(latest && latest.runKey),
      forecastCount,
      modelStatus: safeStr(res && res.status),
      modelHours: safeNum(res && res.hours),
      modelText: safeStr(res && res.text),
      outText: txt
    });

    return txt;
}catch(err){
  setEtaDebug(state, fid, {
    phase: 'exception',
    readinessNow,
    threshold: Number(thr),
    error: safeStr(err && err.message || err)
  });
  return `>${ETA_HORIZON_HOURS}h`;
}
}

/* =====================================================================
   ETA help UI in tile
===================================================================== */
function upsertEtaHelp(state, tile, ctx){
  try{
    const etaTxt = String(ctx.etaText || '').trim();
    let help = tile.querySelector('.help');

    if (!etaTxt){
      if (help) help.remove();
      return;
    }

    if (!help){
      help = document.createElement('div');
      help.className = 'help';

      const slot = tile.querySelector('.etaSlot');
      if (slot) slot.appendChild(help);
      else {
        const gw = tile.querySelector('.gauge-wrap');
        if (gw) gw.appendChild(help);
        else tile.appendChild(help);
      }
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'eta-help-btn';
    btn.setAttribute('aria-label', 'Open ETA helper');
    btn.textContent = etaTxt;

    btn.addEventListener('click', (e)=>{
      try{
        e.preventDefault();
        e.stopPropagation();
      }catch(_){}

      const payload = {
        fieldId: String(ctx.fieldId || ''),
        fieldName: String(ctx.fieldName || ''),
        opKey: String(ctx.opKey || ''),
        threshold: Number(ctx.threshold),
        readinessNow: Number(ctx.readinessNow),
        etaText: etaTxt,
        horizonHours: Number(ctx.horizonHours || ETA_HORIZON_HOURS),
        nowTs: Date.now(),
        note: 'ETA helper'
      };

      dispatchEtaHelp(state, payload);
    }, { passive:false });

    help.replaceChildren(btn);
  }catch(_){}
}

/* =====================================================================
   SWIPE FALLBACK
===================================================================== */
function isCoarsePointer(){
  try{
    return window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  }catch(_){
    return false;
  }
}

function initFallbackSwipeOnTiles(state, wrap, opts){
  try{
    if (!wrap) return;
    if (!isCoarsePointer()) return;

    const tiles = Array.from(wrap.querySelectorAll('.tile[data-field-id]'));
    for (const tile of tiles){
      if (!tile) continue;
      if (tile.dataset && tile.dataset.fvSwipeWired === '1') continue;

      if (tile.dataset) tile.dataset.fvSwipeWired = '1';

      let startX = 0, startY = 0, lastX = 0, lastY = 0;
      let tracking = false;
      let horizLock = false;
      let pid = null;

      const SWIPE_MIN_PX = 42;
      const LOCK_PX = 10;
      const DOMINANCE = 1.15;

      function reset(){
        tracking = false;
        horizLock = false;
        pid = null;
      }

      tile.addEventListener('pointerdown', (e)=>{
        try{
          if (!e || e.pointerType !== 'touch') return;
          const t = e.target;
          if (t && (t.closest && t.closest('button, a, input, select, textarea'))) return;

          tracking = true;
          horizLock = false;
          pid = e.pointerId;

          startX = e.clientX;
          startY = e.clientY;
          lastX = startX;
          lastY = startY;

          try{ tile.setPointerCapture && tile.setPointerCapture(pid); }catch(_){}
        }catch(_){}
      }, { passive:true });

      tile.addEventListener('pointermove', (e)=>{
        try{
          if (!tracking) return;
          if (pid != null && e.pointerId !== pid) return;

          lastX = e.clientX;
          lastY = e.clientY;

          const dx = lastX - startX;
          const dy = lastY - startY;

          if (!horizLock){
            if (Math.abs(dx) < LOCK_PX && Math.abs(dy) < LOCK_PX) return;
            if (Math.abs(dx) > Math.abs(dy) * DOMINANCE){
              horizLock = true;
            } else {
              reset();
              return;
            }
          }

          if (horizLock){
            try{ e.preventDefault(); }catch(_){}
          }
        }catch(_){}
      }, { passive:false });

      tile.addEventListener('pointerup', async (e)=>{
        try{
          if (!tracking) return;
          if (pid != null && e.pointerId !== pid) return;

          const dx = (e.clientX - startX);
          const dy = (e.clientY - startY);

          const left = (dx <= -SWIPE_MIN_PX) && (Math.abs(dx) > Math.abs(dy) * DOMINANCE);

          if (left){
            const now = Date.now();
            tile._fvSwipeJustTs = now;
            if (state) state._suppressClickUntil = now + 500;

            const fid = String(tile.getAttribute('data-field-id') || tile.dataset.fieldId || '');
            if (fid && opts && typeof opts.onDetails === 'function'){
              try{ await opts.onDetails(fid); }catch(_){}
            }
          }
        }catch(_){
        }finally{
          reset();
        }
      }, { passive:true });

      tile.addEventListener('pointercancel', ()=>{ reset(); }, { passive:true });
      tile.addEventListener('lostpointercapture', ()=>{ reset(); }, { passive:true });
    }
  }catch(_){}
}

/* =====================================================================
   Helper: build deps via formula.js
===================================================================== */
function buildDepsForState(state, opKey){
  const wxCtx = buildWxCtx(state);
  return buildFRDeps(state, {
    opKey: String(opKey),
    wxCtx,
    persistedGetter: (id)=> getPersistedStateForDeps(state, id)
  });
}

/* =====================================================================
   Optional deep model helpers (kept for details panel)
===================================================================== */
async function warmWeatherForFieldSet(state, fields){
  try{
    const list = Array.isArray(fields) ? fields.filter(Boolean) : [];
    if (!list.length) return;

    const weather = state && state._mods ? state._mods.weather : null;
    if (!weather || typeof weather.warmWeatherForFields !== 'function') return;

    const wxCtx = buildWxCtx(state);
    await weather.warmWeatherForFields(list, wxCtx, { force:false, onEach:()=>{} });
  }catch(e){
    console.warn('[FieldReadiness] warmWeatherForFieldSet failed:', e);
  }
}

async function computeDeepModelRunForField(state, fieldObj, opKey){
  try{
    const wxCtx = buildWxCtx(state);
    const run = await runFieldReadiness(state, fieldObj, {
      opKey,
      wxCtx,
      persistedGetter: (id)=> getPersistedStateForDeps(state, id)
    });
    if (run) return run;
  }catch(_){}

  try{
    const deps = buildDepsForState(state, opKey);
    const model = state && state._mods ? state._mods.model : null;
    if (model && typeof model.runField === 'function'){
      const legacy = model.runField(fieldObj, deps);
      if (legacy) return legacy;
    }
  }catch(e){
    console.warn('[FieldReadiness] legacy model fallback failed for field:', fieldObj && fieldObj.id, e);
  }

  return null;
}

/* =====================================================================
   Trace/model row adapters for details
===================================================================== */
function getLiveTraceRowsForDetails(runTruth, savedRawDoc){
  try{
    const liveRows = Array.isArray(runTruth && runTruth.trace) ? runTruth.trace : [];
    if (liveRows.length){
      return liveRows.map((t)=>({
        dateISO: safeStr(t.dateISO),
        rainIn: safeNum(t.rain),
        infilMult: safeNum(t.infilMult),
        addIn: safeNum(t.add),
        dryPwr: safeNum(t.dryPwr),
        lossIn: safeNum(t.loss),
        storageStart: safeNum(t.before),
        storageEnd: safeNum(t.after)
      }));
    }

    const d = safeObj(savedRawDoc) || {};
    return Array.isArray(d.tankTrace) ? d.tankTrace : [];
  }catch(_){
    const d = safeObj(savedRawDoc) || {};
    return Array.isArray(d.tankTrace) ? d.tankTrace : [];
  }
}

function getLiveModelRowsForDetails(runTruth, savedRawDoc){
  try{
    const liveRows = Array.isArray(runTruth && runTruth.rows) ? runTruth.rows : [];
    if (liveRows.length) return liveRows;

    const d = safeObj(savedRawDoc) || {};
    return Array.isArray(d.modelRows) ? d.modelRows : [];
  }catch(_){
    const d = safeObj(savedRawDoc) || {};
    return Array.isArray(d.modelRows) ? d.modelRows : [];
  }
}
function fmtMoisturePair(value, cap){
  const v = safeNum(value);
  const c = safeNum(cap);
  if (v != null && c != null) return `${v.toFixed(2)} / ${c.toFixed(2)}`;
  if (v != null) return v.toFixed(2);
  return '—';
}

function fmtSingleMoisture(value){
  const v = safeNum(value);
  return v != null ? v.toFixed(2) : '—';
}

function getSoilMoistureSnapshot(runTruth, latestRec, savedRawDoc){
  const d = safeObj(savedRawDoc) || {};
  const rec = safeObj(latestRec && latestRec._raw ? latestRec._raw : latestRec) || {};

  const soilValue =
    safeNum(runTruth && runTruth.storageForReadiness) ??
    safeNum(runTruth && runTruth.soilWetness) ??
    safeNum(rec.storageForReadiness) ??
    safeNum(rec.soilWetness) ??
    safeNum(d.storageForReadiness) ??
    safeNum(d.soilWetness) ??
    safeNum(runTruth && runTruth.storageFinal) ??
    safeNum(rec.storageFinal) ??
    safeNum(d.storageFinal);

  const soilCap =
    safeNum(runTruth && runTruth.storageMax) ??
    safeNum(runTruth && runTruth.storageCapacity) ??
    safeNum(runTruth && runTruth.storageMaxFinal) ??
    safeNum(runTruth && runTruth.factors && runTruth.factors.Smax) ??
    safeNum(rec.storageMax) ??
    safeNum(rec.storageCapacity) ??
    safeNum(rec.storageMaxFinal) ??
    safeNum(d.storageMax) ??
    safeNum(d.storageCapacity) ??
    safeNum(d.storageMaxFinal);

  return fmtMoisturePair(soilValue, soilCap);
}

function getSurfaceWetnessSnapshot(runTruth, latestRec, savedRawDoc){
  const d = safeObj(savedRawDoc) || {};
  const rec = safeObj(latestRec && latestRec._raw ? latestRec._raw : latestRec) || {};

  const surfaceValue =
    safeNum(runTruth && runTruth.surfaceStorageFinal) ??
    safeNum(rec.surfaceStorageFinal) ??
    safeNum(d.surfaceStorageFinal) ??
    safeNum(runTruth && runTruth.storagePhysFinal) ??
    safeNum(rec.storagePhysFinal) ??
    safeNum(d.storagePhysFinal);

  return fmtSingleMoisture(surfaceValue);
}

function getSoilTraceRowsForDetails(runTruth, savedRawDoc){
  try{
    const liveRows = Array.isArray(runTruth && runTruth.trace) ? runTruth.trace : [];

    // ✅ ONLY use live if it actually has enough history
    if (liveRows.length >= 10){
      return liveRows.map((t)=>({
        dateISO: safeStr(t.dateISO),
        rainIn: safeNum(t.rainIn) ?? safeNum(t.rain),
        infilMult: safeNum(t.infilMult),
        addIn: safeNum(t.addIn) ?? safeNum(t.add),
        dryPwr: safeNum(t.dryPwr),
        lossIn: safeNum(t.lossIn) ?? safeNum(t.loss),
        storageStart:
          safeNum(t.soilStart) ??
          safeNum(t.storageForReadinessStart) ??
          safeNum(t.before),
        storageEnd:
          safeNum(t.soilEnd) ??
          safeNum(t.storageForReadinessEnd) ??
          safeNum(t.after)
      }));
    }

    // ✅ FALLBACK → use saved 30-day trace
    const d = safeObj(savedRawDoc) || {};

    if (Array.isArray(d.tankTrace)) return d.tankTrace;   // ← YOUR DATA
    if (Array.isArray(d.soilMoistureTrace)) return d.soilMoistureTrace;
    if (Array.isArray(d.soilTrace)) return d.soilTrace;

    return [];
  }catch(_){
    return [];
  }
}

function getSurfaceTraceRowsForDetails(runTruth, savedRawDoc){
  try{
    const liveRows = Array.isArray(runTruth && runTruth.trace) ? runTruth.trace : [];
    if (liveRows.length){
      return liveRows
        .map((t)=>({
          dateISO: safeStr(t.dateISO),
          rainIn: safeNum(t.rainIn) ?? safeNum(t.rain),
          infilMult: safeNum(t.infilMult),
          addIn:
            safeNum(t.surfaceAdd) ??
            safeNum(t.addIn) ??
            safeNum(t.add),
          dryPwr:
            safeNum(t.surfaceDry) ??
            safeNum(t.dryPwr),
          lossIn:
            safeNum(t.surfaceToStorage) ??
            safeNum(t.lossIn) ??
            safeNum(t.loss),
          storageStart:
            safeNum(t.surfaceBefore) ??
            safeNum(t.surfaceStart) ??
            safeNum(t.storagePhysStart) ??
            safeNum(t.beforePhys),
          storageEnd:
            safeNum(t.surfaceAfter) ??
            safeNum(t.surfaceEnd) ??
            safeNum(t.storagePhysEnd) ??
            safeNum(t.afterPhys)
        }))
        .filter((r)=>
          r.dateISO &&
          (r.storageStart != null || r.storageEnd != null)
        );
    }

    const d = safeObj(savedRawDoc) || {};
    if (Array.isArray(d.surfaceWetnessTrace)) return d.surfaceWetnessTrace;
    if (Array.isArray(d.surfaceTrace)) return d.surfaceTrace;

    return [];
  }catch(_){
    return [];
  }
}

function renderMoistureTraceTableRows(tbodyEl, rows, emptyMsg){
  if (!tbodyEl) return;

  tbodyEl.innerHTML = '';

  if (!Array.isArray(rows) || !rows.length){
    tbodyEl.innerHTML = `<tr><td colspan="7" class="muted">${esc(emptyMsg || 'No trace data.')}</td></tr>`;
    return;
  }

  for (const t of rows){
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="mono">${esc(String(t.dateISO || ''))}</td>
      <td class="right mono">${Number(t.rainIn ?? 0).toFixed(2)}</td>
      <td class="right mono">${Number(t.infilMult ?? 0).toFixed(2)}</td>
      <td class="right mono">${Number(t.addIn ?? 0).toFixed(2)}</td>
      <td class="right mono">${Number(t.dryPwr ?? 0).toFixed(2)}</td>
      <td class="right mono">${Number(t.lossIn ?? 0).toFixed(2)}</td>
      <td class="right mono">${Number(t.storageStart ?? 0).toFixed(2)}→${Number(t.storageEnd ?? 0).toFixed(2)}</td>
    `;
    tbodyEl.appendChild(tr);
  }
}

/* =====================================================================
   FAST helper: build runs from field_readiness_latest
===================================================================== */
async function buildRunsForFields(state, fields, opKey){
  const map = new Map();
  const list = Array.isArray(fields) ? fields : [];
  void opKey;

  await loadLatestReadiness(state, { force:false });

  for (const f of list){
    const latest = getLatestReadinessForField(state, f.id);
    const run = buildSyntheticRunFromLatest(state, f, latest);
    if (run) map.set(f.id, run);
  }

  return map;
}

/* =====================================================================
   Tile fallback helpers
===================================================================== */
function buildWaitingTileHtml(f, isSelected, thr){
  const selectedClass = isSelected ? ' fv-selected' : '';
  const title = esc(String((f && f.name) || 'Field'));
  const grad = gradientForThreshold(thr);
  const thrPos = markerLeftCSS(thr);

  return {
    className: `tile fv-swipe-item${selectedClass}`,
    html: `
      <div class="tile-top">
        <div class="titleline">
          <div class="name" title="${title}">${title}</div>
        </div>
        <div class="readiness-pill" style="background:color-mix(in srgb, var(--surface) 86%, #8b949e 14%);color:var(--text);">Field Readiness —</div>
      </div>

      <p class="subline">Rain (range): <span class="mono">Processing Data</span></p>

      <div class="gauge-wrap">
        <div class="chips">
          <div class="chip wet">Wet</div>
          <div class="chip readiness">Readiness</div>
        </div>

        <div class="gauge" style="background:${grad};opacity:.82;">
          <div class="thr" style="left:${thrPos};"></div>
          <div class="marker" style="left:50%;opacity:.45;"></div>
          <div class="badge" style="left:50%;background:color-mix(in srgb, var(--surface) 88%, #8b949e 12%);color:var(--text);">Loading…</div>
        </div>

        <div class="etaSlot"></div>
      </div>
    `
  };
}

/* =====================================================================
   Lightweight rainfall-only patch helpers
===================================================================== */
async function patchTileRainOnly(state, fieldId){
  try{
    if (!fieldId) return;
    const fid = String(fieldId);
    const tile = document.querySelector('.tile[data-field-id="' + CSS.escape(fid) + '"]');
    if (!tile) return;

    const range = parseRangeFromInput();
    const mrmsRes = await getMrmsRainResultForField(state, fid, range, { force:true });
    const rainLine = tile.querySelector('.subline .mono');
    if (rainLine) rainLine.textContent = rainTileTextFromMrmsResult(mrmsRes);
  }catch(_){}
}

/* ---------- internal: patch a single tile DOM in-place ---------- */
async function updateTileForField(state, fieldId){
  try{
    if (!fieldId) return;
    const fid = String(fieldId);

    const tile = document.querySelector('.tile[data-field-id="' + CSS.escape(fid) + '"]');
    if (!tile) return;

    ensureSelectionStyleOnce();
    ensureFieldsCountHelperEl();
    await loadLatestReadiness(state, { force:false });

    const f = (state.fields || []).find(x=>x.id === fid);
    if (!f) return;

    const opKey = getCurrentOp();
    const latest = getLatestReadinessForField(state, fid);
    const run0 = buildSyntheticRunFromLatest(state, f, latest);

    const range = parseRangeFromInput();
    const mrmsRes = await getMrmsRainResultForField(state, fid, range, { force:true });
    const rainText = rainTileTextFromMrmsResult(mrmsRes);

    const rainLine = tile.querySelector('.subline .mono');
    if (rainLine) rainLine.textContent = rainText;

    const thr = getThresholdForOp(state, opKey);
    const thrPos  = markerLeftCSS(thr);
    const grad = gradientForThreshold(thr);

    const gauge = tile.querySelector('.gauge');
    if (gauge) gauge.style.background = grad;

    const thrEl = tile.querySelector('.thr');
    if (thrEl) thrEl.style.left = thrPos;

    if (!run0){
      const pill = tile.querySelector('.readiness-pill');
      if (pill) pill.textContent = 'Field Readiness —';

      const badge = tile.querySelector('.badge');
      if (badge) badge.textContent = 'Loading…';

      const markerEl = tile.querySelector('.marker');
      if (markerEl){
        markerEl.style.left = '50%';
        markerEl.style.opacity = '.45';
      }

      setEtaDebug(state, fid, {
        phase: 'tile-update',
        reason: 'no-run0',
        threshold: Number(thr)
      });

      upsertEtaHelp(state, tile, { etaText:'' });
      return;
    }

    try{
      state.lastRuns = state.lastRuns || new Map();
      state.lastRuns.set(fid, run0);
    }catch(_){}

    const readiness = run0.readinessR;
    const leftPos = markerLeftCSS(readiness);

    const perceived = perceivedFromThreshold(readiness, thr);
    const pillBg = colorForPerceived(perceived);

    const markerEl = tile.querySelector('.marker');
    if (markerEl){
      markerEl.style.left = leftPos;
      markerEl.style.opacity = '';
    }

    const pill = tile.querySelector('.readiness-pill');
    if (pill){
      pill.style.background = pillBg;
      pill.style.color = '#fff';
      pill.textContent = `Field Readiness ${readiness}`;
    }

    const badge = tile.querySelector('.badge');
    if (badge){
      badge.style.left = leftPos;
      badge.style.background = pillBg;
      badge.style.color = '#fff';
      badge.textContent = `Field Readiness ${readiness}`;
    }

      let etaText = '';
    try{
      const deps = buildDepsForState(state, opKey);
      etaText = await getTileEtaText(state, f, deps, run0, thr, latest);
    }catch(err){
      setEtaDebug(state, fid, {
        phase: 'tile-update-exception',
        readinessNow: Number(readiness),
        threshold: Number(thr),
        error: safeStr(err && err.message || err)
      });
      etaText = `>${ETA_HORIZON_HOURS}h`;
    }

    upsertEtaHelp(state, tile, {
      fieldId: fid,
      fieldName: String(f.name || ''),
      opKey,
      threshold: thr,
      readinessNow: readiness,
      etaText,
      horizonHours: ETA_HORIZON_HOURS
    });

    if (String(state.selectedFieldId) === fid){
      tile.classList.add('fv-selected');
      state._selectedTileId = fid;
    }
  }catch(_){}
}

/* =====================================================================
   Batch update visible tiles
===================================================================== */
async function updateVisibleTilesBatched(state, ids){
  try{
    const list = Array.isArray(ids)
      ? ids.map(x => String(x || '')).filter(Boolean)
      : [];
    if (!list.length) return;

    ensureSelectionStyleOnce();
    ensureFieldsCountHelperEl();
    await loadLatestReadiness(state, { force:false });

    const BATCH_SIZE = 10;
    const YIELD_MS = 8;

    for (let i = 0; i < list.length; i += BATCH_SIZE){
      const batchIds = list.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batchIds.map(async (fid)=>{
          try{
            await updateTileForField(state, fid);
          }catch(e){
            try{
              console.warn('[FieldReadiness] visible tile refresh failed for field:', fid, e);
            }catch(_){}
          }
        })
      );

      if ((i + BATCH_SIZE) < list.length){
        await new Promise(resolve => setTimeout(resolve, YIELD_MS));
      }
    }
  }catch(e){
    console.warn('[FieldReadiness] updateVisibleTilesBatched failed:', e);
  }
}

/* ---------- click vs dblclick separation ---------- */
function wireTileInteractions(state, tileEl, fieldId){
  const CLICK_DELAY_MS = 360;
  tileEl._fvClickTimer = null;

  tileEl.addEventListener('click', ()=>{
    const until = Number(state._suppressClickUntil || 0);
    if (Date.now() < until) return;

    const swipeTs = Number(tileEl._fvSwipeJustTs || 0);
    if (swipeTs && (Date.now() - swipeTs) < 650) return;

    if (tileEl._fvClickTimer) clearTimeout(tileEl._fvClickTimer);
    tileEl._fvClickTimer = setTimeout(()=>{
      tileEl._fvClickTimer = null;
      selectField(state, fieldId);
    }, CLICK_DELAY_MS);
  });

  tileEl.addEventListener('dblclick', async (e)=>{
    e.preventDefault();
    e.stopPropagation();

    if (tileEl._fvClickTimer) clearTimeout(tileEl._fvClickTimer);
    tileEl._fvClickTimer = null;

    setSelectedField(state, fieldId);
    ensureSelectedParamsToSliders(state);

    state._suppressClickUntil = Date.now() + 350;

    if (!canEdit(state)) return;

    try{ await fetchAndHydrateFieldParams(state, fieldId); }catch(_){}
    if (String(state.selectedFieldId) !== String(fieldId)) return;

    ensureSelectedParamsToSliders(state);
    await refreshDetailsOnly(state);
    await updateTileForField(state, fieldId);

    openQuickView(state, fieldId);
  });
}

/* ---------- tile render (CORE) ---------- */
async function _renderTilesInternal(state){
  ensureSelectionStyleOnce();
  ensureFieldsCountHelperEl();
  await loadLatestReadiness(state, { force:false });

  const wrap = $('fieldsGrid');
  if (!wrap) return;

  const effectivePageSize = getEffectivePageSize(state);
  const filteredNow = getFilteredFields(state);
  const filteredSigNow = getFilteredFieldSignature(filteredNow);

  try{ state.pageSize = effectivePageSize; }catch(_){}

  const viewKey = getTilesViewKey(state);
  const prevKey = String(state._fvTilesViewKey || '');
  const prevSig = String(state._fvTilesFieldSig || '');
  const hasTiles = !!wrap.querySelector('.tile[data-field-id]');
  const sameView = (prevKey === viewKey) && (prevSig === filteredSigNow) && hasTiles;

  state._fvTilesViewKey = viewKey;
  state._fvTilesFieldSig = filteredSigNow;

  if (sameView){
    const filteredExisting = filteredNow;
    const tiles = Array.from(wrap.querySelectorAll('.tile[data-field-id]'));

    const desiredCount = (effectivePageSize === -1)
      ? filteredExisting.length
      : Math.min(filteredExisting.length, effectivePageSize);

    if (tiles.length === desiredCount){
      const ids = tiles
        .slice(0, desiredCount)
        .map(t => String(t.getAttribute('data-field-id') || ''))
        .filter(Boolean);

      updateFieldsCountHelper(desiredCount, filteredExisting.length);
      updateEmptyMessageForCurrentFilters(state, filteredExisting.length);

      initFallbackSwipeOnTiles(state, wrap, {
        onDetails: async (fieldId)=>{
          if (!canEdit(state)) return;
          await openQuickView(state, fieldId);
        }
      });

      await updateVisibleTilesBatched(state, ids);
      return;
    }
  }

  const searchQ = getFieldSearchQuery(state);
  setFieldsCountHelperMessage(searchQ ? 'Searching fields…' : 'Preparing fields…');
  renderFieldsInlineLoading(
    searchQ ? 'Searching field readiness...' : 'Loading field readiness...',
    searchQ
      ? 'Matching field names are being filtered, loaded, and sorted now.'
      : 'Centralized field_readiness_latest values are being loaded and sorted now.'
  );

  const opKey = getCurrentOp();
  const filtered = filteredNow;

  state.lastRuns = state.lastRuns || new Map();
  state.lastRuns.clear();

  const filteredRuns = await buildRunsForFields(state, filtered, opKey);

  for (const [fid, run] of filteredRuns.entries()){
    state.lastRuns.set(fid, run);
  }

  const range = parseRangeFromInput();
  const mrmsRangeById = new Map();

  await Promise.all(
    filtered.map(async (f)=>{
      const res = await getMrmsRainResultForField(state, f.id, range, { force:true });
      mrmsRangeById.set(f.id, res);
    })
  );

  const sorted = sortFields(filtered, state.lastRuns, mrmsRangeById);
  const thr = getThresholdForOp(state, opKey);

  const cap = (effectivePageSize === -1)
    ? sorted.length
    : Math.min(sorted.length, effectivePageSize);
  const show = sorted.slice(0, cap);

  await ensureFRModules(state);

  const fc = state && state._mods ? state._mods.forecast : null;
  if (fc && typeof fc.readWxSeriesFromCache === 'function'){
    await Promise.all(
      show.map(async (f)=>{
        try{
          await fc.readWxSeriesFromCache(String(f.id), {});
        }catch(_){}
      })
    );
  }

  const frag = document.createDocumentFragment();
  const idsForPostPatch = [];
  let renderedCount = 0;

  for (const f of show){
    const run0 = state.lastRuns.get(f.id);

    const tile = document.createElement('div');
    tile.dataset.fieldId = f.id;
    tile.setAttribute('data-field-id', f.id);

    if (!run0){
      const waiting = buildWaitingTileHtml(f, String(state.selectedFieldId) === String(f.id), thr);
      tile.className = waiting.className;
      tile.innerHTML = waiting.html;
    } else {
      const readiness = run0.readinessR;

      const leftPos = markerLeftCSS(readiness);
      const thrPos  = markerLeftCSS(thr);

      const perceived = perceivedFromThreshold(readiness, thr);
      const pillBg = colorForPerceived(perceived);
      const grad = gradientForThreshold(thr);

      const mrmsRes = mrmsRangeById.get(f.id);
      const rainText = rainTileTextFromMrmsResult(mrmsRes);

      tile.className = 'tile fv-swipe-item';

      if (String(state.selectedFieldId) === String(f.id)){
        tile.classList.add('fv-selected');
        state._selectedTileId = String(f.id);
      }

      tile.innerHTML = `
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

          <div class="etaSlot"></div>
        </div>
      `;
    }

    wireTileInteractions(state, tile, f.id);
    frag.appendChild(tile);
    idsForPostPatch.push(String(f.id));
    renderedCount++;
  }

  wrap.replaceChildren(frag);

  updateFieldsCountHelper(renderedCount, filtered.length);
  updateEmptyMessageForCurrentFilters(state, filtered.length);

  const empty = $('emptyMsg');
  if (empty) empty.style.display = renderedCount ? 'none' : 'block';

  try{
    await initSwipeOnTiles(state, {
      onDetails: async (fieldId)=>{
        if (!canEdit(state)) return;
        await openQuickView(state, fieldId);
      }
    });
  }catch(e){
    console.warn('[FieldReadiness] initSwipeOnTiles failed; using fallback swipe.', e);
  }

  initFallbackSwipeOnTiles(state, wrap, {
    onDetails: async (fieldId)=>{
      if (!canEdit(state)) return;
      await openQuickView(state, fieldId);
    }
  });

  setTimeout(async ()=>{
    try{
      await updateVisibleTilesBatched(state, idsForPostPatch);
    }catch(_){}
  }, 0);
}

/* ---------- tile render (PUBLIC) ---------- */
export async function renderTiles(state){
  await scheduleRender(state, 'all');
}

/* ---------- select field ---------- */
export function selectField(state, id){
  const f = state.fields.find(x=>x.id === id);
  if (!f) return;

  setSelectedField(state, id);
  ensureSelectedParamsToSliders(state);

  refreshDetailsOnly(state);

  (async ()=>{
    try{
      await loadLatestReadiness(state, { force:false });
      const ok = await fetchAndHydrateFieldParams(state, id);
      if (!ok) return;
      if (String(state.selectedFieldId) !== String(id)) return;

      ensureSelectedParamsToSliders(state);
      await refreshDetailsOnly(state);
      await updateTileForField(state, id);
    }catch(_){}
  })();
}

/* ---------- beta panel ---------- */
function renderBetaInputs(state){
  const box = $('betaInputs');
  const meta = $('betaInputsMeta');
  if (!box || !meta) return;

  const fid = state.selectedFieldId;
  const info = fid ? state.wxInfoByFieldId.get(fid) : null;
  const latest = fid ? getLatestReadinessForField(state, fid) : null;

  if (!info){
    const latestMeta = latest
      ? `Centralized readiness source: field_readiness_latest • Computed: ${latest.computedAtISO || '—'} • Weather fetched: ${latest.weatherFetchedAtISO || '—'}`
      : 'Weather is loading…';
    meta.textContent = latestMeta;
    box.innerHTML = '';
    return;
  }

  const when = info.fetchedAt ? new Date(info.fetchedAt) : null;
  const whenTxt = when ? when.toLocaleString() : '—';

  const latestPrefix = latest
    ? `Centralized readiness source: field_readiness_latest • Readiness: ${Number(latest.readiness).toFixed(0)} • Computed: ${latest.computedAtISO || '—'} • `
    : '';

  meta.textContent =
    `${latestPrefix}Source: ${info.source || '—'} • Updated: ${whenTxt} • Primary + light-influence variables are used now; weights are still being tuned.`;

  const unitsHourly = info.units && info.units.hourly ? info.units.hourly : null;
  const unitsDaily = info.units && info.units.daily ? info.units.daily : null;

  const a = info.availability || { vars:{} };
  const vars = a.vars || {};

  const usedPrimary = [
    ['rain_mm','Precipitation (hourly → daily sum)', unitsHourly?.precipitation || 'mm → in'],
    ['temp_c','Air temperature (hourly avg)', unitsHourly?.temperature_2m || '°C → °F'],
    ['wind_mph','Wind speed (hourly avg)', 'mph (converted)'],
    ['rh_pct','Relative humidity (hourly avg)', unitsHourly?.relative_humidity_2m || '%'],
    ['solar_wm2','Shortwave radiation (hourly avg)', unitsHourly?.shortwave_radiation || 'W/m²']
  ];

  const usedLight = [
    ['vapour_pressure_deficit_kpa','VPD (hourly avg)', unitsHourly?.vapour_pressure_deficit || 'kPa'],
    ['cloud_cover_pct','Cloud cover (hourly avg)', unitsHourly?.cloud_cover || '%'],
    ['soil_moisture_0_10','Soil moisture 0–10cm (hourly avg)', unitsHourly?.soil_moisture_0_to_10cm || 'm³/m³'],
    ['soil_temp_c_0_10','Soil temp 0–10cm (hourly avg)', unitsHourly?.soil_temperature_0_to_10cm || '°C → °F'],
    ['et0_mm','ET₀ (daily)', unitsDaily?.et0_fao_evapotranspiration || 'mm/day → in/day'],
    ['daylight_s','Daylight duration (daily)', unitsDaily?.daylight_duration || 's/day → hr/day'],
    ['sunshine_s','Sunshine duration (daily)', unitsDaily?.sunshine_duration || 's/day → hr/day']
  ];

  const pulledNotUsed = [
    ['soil_temp_c_10_40','Soil temp 10–40cm (hourly)', unitsHourly?.soil_temperature_10_to_40cm || '°C'],
    ['soil_temp_c_40_100','Soil temp 40–100cm (hourly)', unitsHourly?.soil_temperature_40_to_100cm || '°C → °F'],
    ['soil_temp_c_100_200','Soil temp 100–200cm (hourly)', unitsHourly?.soil_temperature_100_to_200cm || '°C → °F'],
    ['soil_moisture_10_40','Soil moisture 10–40cm (hourly)', unitsHourly?.soil_moisture_10_to_40cm || 'm³/m³'],
    ['soil_moisture_40_100','Soil moisture 40–100cm (hourly)', unitsHourly?.soil_moisture_40_to_100cm || 'm³/m³'],
    ['soil_moisture_100_200','Soil moisture 100–200cm (hourly)', unitsHourly?.soil_moisture_100_to_200cm || 'm³/m³']
  ];

  function itemRow(k,label,u,tagClass,tagText){
    const ok = vars[k] ? !!vars[k].ok : true;
    const tag = ok ? `<div class="vtag ${tagClass}">${esc(tagText)}</div>` : `<div class="vtag tag-missing">Not in response</div>`;
    return `
      <div class="vitem">
        <div>
          <div class="vname">${esc(label)}</div>
          <div class="vmeta">${esc(u || '')}</div>
        </div>
        ${tag}
      </div>
    `;
  }
  function groupHtml(title, rows, tagClass, tagText){
    const items = rows.map(([k,label,u])=> itemRow(k,label,u,tagClass,tagText)).join('');
    return `
      <div class="vgroup">
        <div class="vgroup-title">${esc(title)}</div>
        <div class="vitems">${items}</div>
      </div>
    `;
  }

  box.innerHTML =
    groupHtml('Used now (primary drivers)', usedPrimary, 'tag-primary', 'Used') +
    groupHtml('Used now (light influence / nudges)', usedLight, 'tag-light', 'Light') +
    groupHtml('Pulled (not yet used)', pulledNotUsed, 'tag-pulled', 'Pulled');
}

/* ---------- MRMS panel helpers ---------- */
function numOrZero(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function mmToIn(mm){
  return numOrZero(mm) / 25.4;
}
function fmt2(v){
  return numOrZero(v).toFixed(2);
}
function sumMrmsMm(rows){
  return (Array.isArray(rows) ? rows : []).reduce((a, r)=> a + numOrZero(r && r.rainMm), 0);
}
function localTs(iso){
  try{
    if (!iso) return '—';
    const d = new Date(String(iso));
    if (!Number.isFinite(d.getTime())) return String(iso);
    return d.toLocaleString();
  }catch(_){
    return String(iso || '—');
  }
}
function setPanelText(id, txt){
  const el = $(id);
  if (el) el.textContent = String(txt ?? '—');
}
function renderMrmsPanelEmpty(msg){
  setPanelText('mrmsMeta', msg || 'No MRMS data found for this field.');
  setPanelText('mrmsLatestHour', '—');
  setPanelText('mrmsLast24Total', '—');
  setPanelText('mrmsLast7dTotal', '—');
  setPanelText('mrmsUnits', 'mm');

  const hourly = $('mrmsHourlyRows');
  if (hourly){
    hourly.innerHTML = `<tr><td colspan="5" class="muted">${esc(msg || 'No MRMS hourly data.')}</td></tr>`;
  }

  const daily = $('mrmsDailyRows');
  if (daily){
    daily.innerHTML = `<tr><td colspan="4" class="muted">${esc(msg || 'No MRMS daily data.')}</td></tr>`;
  }
}

function renderMrmsPanelFromDoc(doc){
  if (!doc || typeof doc !== 'object'){
    renderMrmsPanelEmpty('No MRMS data found for this field.');
    return;
  }

  const meta = doc.mrmsHistoryMeta || {};
  const hourly = Array.isArray(doc.mrmsHourlyLast24) ? doc.mrmsHourlyLast24.slice() : [];
  const daily = Array.isArray(doc.mrmsDailySeries30d) ? doc.mrmsDailySeries30d.slice() : [];
  const latest = doc.mrmsHourlyLatest || {};

  const units = String(meta.units || 'mm');
  const latestHourMm = numOrZero(
    latest.weightedHourlyRainMm != null ? latest.weightedHourlyRainMm :
    latest.rainMm != null ? latest.rainMm :
    hourly.length ? hourly[0].rainMm : 0
  );
  const last24Mm = hourly.length ? sumMrmsMm(hourly) : 0;
  const last7Mm = sumMrmsMm(daily.slice(-7));

  const latestTs = latest.fileTimestampUtc || meta.latestFileTimestampUtc || '';
  const latestProduct = latest.selectedProduct || meta.latestSelectedProduct || '—';

  setPanelText(
    'mrmsMeta',
    `Latest file: ${latestTs ? localTs(latestTs) : '—'} • Product: ${latestProduct} • Daily rows: ${daily.length} • Hourly rows: ${hourly.length}`
  );
  setPanelText('mrmsLatestHour', `${fmt2(latestHourMm)} mm`);
  setPanelText('mrmsLast24Total', `${fmt2(mmToIn(last24Mm))} in`);
  setPanelText('mrmsLast7dTotal', `${fmt2(mmToIn(last7Mm))} in`);
  setPanelText('mrmsUnits', units);

  const hourlyBody = $('mrmsHourlyRows');
  if (hourlyBody){
    hourlyBody.innerHTML = '';
    if (!hourly.length){
      hourlyBody.innerHTML = `<tr><td colspan="5" class="muted">No MRMS hourly data.</td></tr>`;
    } else {
      for (const r of hourly){
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="mono">${esc(localTs(r.fileTimestampUtc || r.hourKey || '—'))}</td>
          <td class="right mono">${fmt2(r.rainMm)}</td>
          <td class="mono">${esc(String(r.selectedProduct || '—'))}</td>
          <td class="mono">${esc(String(r.mode || '—'))}</td>
          <td class="mono">${esc(String(r.source || '—'))}</td>
        `;
        hourlyBody.appendChild(tr);
      }
    }
  }

  const dailyBody = $('mrmsDailyRows');
  if (dailyBody){
    dailyBody.innerHTML = '';
    if (!daily.length){
      dailyBody.innerHTML = `<tr><td colspan="4" class="muted">No MRMS daily data.</td></tr>`;
    } else {
      for (const r of daily){
        const mm = numOrZero(r.rainMm);
        const inches = mmToIn(mm);
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="mono">${esc(String(r.dateISO || '—'))}</td>
          <td class="right mono">${Math.round(numOrZero(r.hoursCount))}</td>
          <td class="right mono">${fmt2(mm)}</td>
          <td class="right mono">${fmt2(inches)}</td>
        `;
        dailyBody.appendChild(tr);
      }
    }
  }
}
/* =====================================================================
   Forecast rows helpers for details weather section
===================================================================== */
function firstArrayFrom(obj, keys){
  try{
    const src = safeObj(obj) || {};
    for (const k of (Array.isArray(keys) ? keys : [])){
      const v = src[k];
      if (Array.isArray(v) && v.length) return v;
    }
  }catch(_){}
  return [];
}

function normalizeForecastRow(raw){
  try{
    const r = safeObj(raw) || {};

    const dateISO =
      safeStr(r.dateISO) ||
      safeISO10(r.date) ||
      safeISO10(r.day) ||
      safeISO10(r.timeISO) ||
      safeISO10(r.timestampISO) ||
      safeISO10(r.validDate) ||
      safeISO10(r.validTime) ||
      safeISO10(r.ds) ||
      '';

    const rainInAdj =
      safeNum(r.rainInAdj) ??
      safeNum(r.rainIn) ??
      safeNum(r.precipIn) ??
      safeNum(r.precipitationIn) ??
      safeNum(r.rain) ??
      safeNum(r.rainForecastIn) ??
      0;

    const tempF =
      safeNum(r.tempF) ??
      safeNum(r.tempAvgF) ??
      safeNum(r.avgTempF) ??
      safeNum(r.temperatureF) ??
      safeNum(r.tavgF) ??
      safeNum(r.tempMaxF) ??
      0;

    const windMph =
      safeNum(r.windMph) ??
      safeNum(r.windSpeedMph) ??
      safeNum(r.windspeedMph) ??
      safeNum(r.windAvgMph) ??
      0;

    const rh =
      safeNum(r.rh) ??
      safeNum(r.rhPct) ??
      safeNum(r.relativeHumidity) ??
      safeNum(r.relativeHumidityPct) ??
      0;

    const solarWm2 =
      safeNum(r.solarWm2) ??
      safeNum(r.shortwaveWm2) ??
      safeNum(r.shortwaveRadiation) ??
      safeNum(r.solar) ??
      0;

    const et0In =
      safeNum(r.et0In) ??
      safeNum(r.etIn) ??
      safeNum(r.et0) ??
      safeNum(r.evapotranspirationIn) ??
      0;

    const sm010 =
      safeNum(r.sm010) ??
      safeNum(r.soilMoisture010) ??
      safeNum(r.soilMoisture0to10) ??
      safeNum(r.soilMoisture_0_10) ??
      0;

    const st010F =
      safeNum(r.st010F) ??
      safeNum(r.soilTemp010F) ??
      safeNum(r.soilTemp0to10F) ??
      safeNum(r.soilTempF_0_10) ??
      safeNum(r.soilTemperatureF) ??
      0;

    return {
      dateISO,
      rainInAdj,
      tempF,
      windMph,
      rh,
      solarWm2,
      et0In,
      sm010,
      st010F,
      __isForecast: true
    };
  }catch(_){
    return null;
  }
}

function getSavedForecastRowsForDetails(rawDoc){
  try{
    const d = safeObj(rawDoc) || {};

    const direct =
      firstArrayFrom(d, [
        'forecastRows',
        'weatherForecastRows',
        'forecastDailyRows',
        'openMeteoForecastRows',
        'forecast',
        'forecastDaily',
        'wxForecast',
        'weatherForecast'
      ]);

    let rows = direct;

    if (!rows.length && d.forecast && typeof d.forecast === 'object'){
      rows =
        firstArrayFrom(d.forecast, [
          'rows',
          'dailyRows',
          'forecastRows',
          'weatherForecastRows'
        ]);
    }

    if (!rows.length && d.openMeteo && typeof d.openMeteo === 'object'){
      rows =
        firstArrayFrom(d.openMeteo, [
          'forecastRows',
          'dailyRows',
          'rows'
        ]);
    }

    return (Array.isArray(rows) ? rows : [])
      .map(normalizeForecastRow)
      .filter(r => r && r.dateISO);
  }catch(_){
    return [];
  }
}
/* =====================================================================
   Daily weather series helpers for details weather section
===================================================================== */
function toISODateOnly(v){
  try{
    const s = String(v || '').trim();
    if (!s) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = new Date(s);
    if (!Number.isFinite(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  }catch(_){
    return '';
  }
}

function normalizeDailyWxRow(raw){
  try{
    const r = safeObj(raw) || {};

    return {
      dateISO: toISODateOnly(r.dateISO || r.date || r.day || r.timeISO || ''),
      rainInAdj: safeNum(r.rainInAdj) ?? safeNum(r.rainIn) ?? 0,
      tempF: safeNum(r.tempF) ?? 0,
      windMph: safeNum(r.windMph) ?? 0,
      rh: safeNum(r.rh) ?? 0,
      solarWm2: safeNum(r.solarWm2) ?? 0,
      et0In: safeNum(r.et0In) ?? 0,
      sm010: safeNum(r.sm010) ?? 0,
      st010F: safeNum(r.st010F) ?? 0
    };
  }catch(_){
    return null;
  }
}

function extractDailySeriesRows(rawDoc){
  try{
    const d = safeObj(rawDoc) || {};

    if (Array.isArray(d.dailySeries)) return d.dailySeries;
    if (Array.isArray(d.weatherDailySeries)) return d.weatherDailySeries;
    if (Array.isArray(d.wxDailySeries)) return d.wxDailySeries;

    const ds = d.dailySeries;
    if (Array.isArray(ds)) return ds;

    if (safeObj(ds)){
      const numericKeys = Object.keys(ds)
        .filter(k => /^\d+$/.test(String(k)))
        .sort((a,b)=> Number(a) - Number(b));

      if (numericKeys.length){
        return numericKeys.map(k => ds[k]).filter(Boolean);
      }

      if (Array.isArray(ds.rows)) return ds.rows;
      if (Array.isArray(ds.items)) return ds.items;
      if (Array.isArray(ds.series)) return ds.series;
    }

    const topLevelNumericKeys = Object.keys(d)
      .filter(k => /^\d+$/.test(String(k)))
      .sort((a,b)=> Number(a) - Number(b));

    if (topLevelNumericKeys.length){
      return topLevelNumericKeys
        .map(k => d[k])
        .filter(row => row && typeof row === 'object' && (
          row.dateISO != null ||
          row.rainIn != null ||
          row.tempF != null ||
          row.windMph != null ||
          row.rh != null ||
          row.solarWm2 != null ||
          row.et0In != null ||
          row.sm010 != null ||
          row.st010F != null
        ));
    }

    return [];
  }catch(_){
    return [];
  }
}

function getDailySeriesMeta(rawDoc){
  try{
    const d = safeObj(rawDoc) || {};
    const m = safeObj(d.dailySeriesMeta) || {};

    return {
      todayISO: toISODateOnly(m.todayISO || d.todayISO || ''),
      histDays: safeInt(m.histDays, 0) || 0,
      fcstDays: safeInt(m.fcstDays, 0) || 0
    };
  }catch(_){
    return { todayISO:'', histDays:0, fcstDays:0 };
  }
}

function splitWeatherHistoryAndForecast(rawDoc){
  try{
    const d = safeObj(rawDoc) || {};
    const meta = getDailySeriesMeta(d);

    const historyRows = (Array.isArray(d.dailySeries30d) ? d.dailySeries30d : [])
      .map(normalizeDailyWxRow)
      .filter(r => r && r.dateISO);

    const forecastRows = (Array.isArray(d.dailySeriesFcst) ? d.dailySeriesFcst : [])
      .map(normalizeDailyWxRow)
      .filter(r => r && r.dateISO);

    if (historyRows.length || forecastRows.length){
      return { historyRows, forecastRows };
    }

    const rows = extractDailySeriesRows(d)
      .map(normalizeDailyWxRow)
      .filter(r => r && r.dateISO);

    if (!rows.length){
      return {
        historyRows: [],
        forecastRows: []
      };
    }

    const todayISO = meta.todayISO;

    if (todayISO){
      const hist = [];
      const fcst = [];

      for (const r of rows){
        if (String(r.dateISO) <= todayISO) hist.push(r);
        else fcst.push(r);
      }

      return { historyRows: hist, forecastRows: fcst };
    }

    const fcstDays = Math.max(0, Number(meta.fcstDays || 0));
    if (fcstDays > 0 && rows.length > fcstDays){
      return {
        historyRows: rows.slice(0, rows.length - fcstDays),
        forecastRows: rows.slice(rows.length - fcstDays)
      };
    }

    return {
      historyRows: rows,
      forecastRows: []
    };
  }catch(_){
    return {
      historyRows: [],
      forecastRows: []
    };
  }
}

async function _renderDetailsInternal(state){
  ensureFieldsCountHelperEl();
  await loadLatestReadiness(state, { force:false });

  const f = state.fields.find(x=>x.id === state.selectedFieldId);
  if (!f) return;

  updateDetailsHeaderPanel(state);

  const latest = getLatestReadinessForField(state, f.id);
  if (!latest || !latest._raw){
    console.warn('[Details] No latest doc found');
    return;
  }

  const d = latest._raw;

  let runTruth = null;
  try{
    await ensureFRModules(state);
    await loadPersistedState(state, { force:false });

    const opKey = getCurrentOp();
    runTruth = await computeDeepModelRunForField(state, f, opKey);
  }catch(e){
    console.warn('[Details] live runTruth failed, falling back to saved rows:', e);
    runTruth = null;
  }

  renderBetaInputs(state);

  /* ===============================
     ✅ CURRENT MOISTURE SNAPSHOT
  =============================== */
  setPanelText('detailsSoilMoisture', getSoilMoistureSnapshot(runTruth, latest, d));
  setPanelText('detailsSurfaceWetness', getSurfaceWetnessSnapshot(runTruth, latest, d));

  /* ===============================
     ✅ SOIL MOISTURE TRACE
  =============================== */
  {
    const soilRows = getSoilTraceRowsForDetails(runTruth, d);
    renderMoistureTraceTableRows(
      $('soilTraceRows'),
      soilRows,
      'Waiting for soil moisture trace.'
    );
  }

  /* ===============================
     ✅ SURFACE WETNESS TRACE
  =============================== */
  {
    const surfaceRows = getSurfaceTraceRowsForDetails(runTruth, d);
    renderMoistureTraceTableRows(
      $('surfaceTraceRows'),
      surfaceRows,
      'Waiting for surface wetness trace.'
    );
  }

  /* ===============================
     ✅ DRY / MODEL ROWS (LIVE RUN FIRST, SAVED FALLBACK)
  =============================== */
  const drb = $('dryRows');
  if (drb){
    drb.innerHTML = '';
    const rows = getLiveModelRowsForDetails(runTruth, d);

    if (!rows.length){
      drb.innerHTML = `<tr><td colspan="15" class="muted">No rows.</td></tr>`;
    } else {
      for (const r of rows){
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="mono">${esc(r.dateISO)}</td>
          <td class="right mono">${Math.round(Number(r.tempF||0))}</td>
          <td class="right mono">${Number(r.tempN||0).toFixed(2)}</td>
          <td class="right mono">${Math.round(Number(r.windMph||0))}</td>
          <td class="right mono">${Number(r.windN||0).toFixed(2)}</td>
          <td class="right mono">${Math.round(Number(r.rh||0))}</td>
          <td class="right mono">${Number(r.rhN||0).toFixed(2)}</td>
          <td class="right mono">${Math.round(Number(r.solarWm2||0))}</td>
          <td class="right mono">${Number(r.solarN||0).toFixed(2)}</td>
          <td class="right mono">${Number(r.vpdKpa||0).toFixed(2)}</td>
          <td class="right mono">${Number(r.vpdN||0).toFixed(2)}</td>
          <td class="right mono">${Math.round(Number(r.cloudPct||0))}</td>
          <td class="right mono">${Number(r.cloudN||0).toFixed(2)}</td>
          <td class="right mono">${Number(r.raw||0).toFixed(2)}</td>
          <td class="right mono">${Number(r.dryPwr||0).toFixed(2)}</td>
        `;
        drb.appendChild(tr);
      }
    }
  }

  /* ===============================
     ✅ WEATHER (DAILY SERIES: HISTORY + FORECAST)
  =============================== */
  const wxb = $('wxRows');
  if (wxb){
    wxb.innerHTML = '';

    const split = splitWeatherHistoryAndForecast(d);
    const historyRows = Array.isArray(split.historyRows) ? split.historyRows : [];
    const forecastRows = Array.isArray(split.forecastRows) ? split.forecastRows : [];

    if (!historyRows.length && !forecastRows.length){
      wxb.innerHTML = `<tr><td colspan="9" class="muted">No weather rows.</td></tr>`;
    } else {
      for (const r of historyRows){
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="mono">${esc(String(r.dateISO || ''))}</td>
          <td class="right mono">${Number(r.rainInAdj||0).toFixed(2)}</td>
          <td class="right mono">${Math.round(Number(r.tempF||0))}</td>
          <td class="right mono">${Math.round(Number(r.windMph||0))}</td>
          <td class="right mono">${Math.round(Number(r.rh||0))}</td>
          <td class="right mono">${Math.round(Number(r.solarWm2||0))}</td>
          <td class="right mono">${Number(r.et0In||0).toFixed(2)}</td>
          <td class="right mono">${Number(r.sm010||0).toFixed(3)}</td>
          <td class="right mono">${Math.round(Number(r.st010F||0))}</td>
        `;
        wxb.appendChild(tr);
      }

      if (forecastRows.length){
        const sep = document.createElement('tr');
        sep.innerHTML = `
          <td colspan="9" class="muted" style="font-weight:900;padding-top:10px;">
            Forecast
          </td>
        `;
        wxb.appendChild(sep);

        for (const r of forecastRows){
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td class="mono">Forecast • ${esc(String(r.dateISO || ''))}</td>
            <td class="right mono">${Number(r.rainInAdj||0).toFixed(2)}</td>
            <td class="right mono">${Math.round(Number(r.tempF||0))}</td>
            <td class="right mono">${Math.round(Number(r.windMph||0))}</td>
            <td class="right mono">${Math.round(Number(r.rh||0))}</td>
            <td class="right mono">${Math.round(Number(r.solarWm2||0))}</td>
            <td class="right mono">${Number(r.et0In||0).toFixed(2)}</td>
            <td class="right mono">${Number(r.sm010||0).toFixed(3)}</td>
            <td class="right mono">${Math.round(Number(r.st010F||0))}</td>
          `;
          wxb.appendChild(tr);
        }
      }
    }
  }

  /* ===============================
     ✅ MRMS (LIVE FROM field_mrms_weather + mrms_hourly fallback)
  =============================== */
  try{
    let liveMrmsDoc = await loadFieldMrmsDoc(state, f.id, { force:true });

    if (!liveMrmsDoc?.mrmsHourlyLast24 || !liveMrmsDoc.mrmsHourlyLast24.length){
      try{
        const db = window.firebase.firestore();
        const snap = await db
          .collection('field_mrms_weather')
          .doc(String(f.id))
          .collection('mrms_hourly')
          .orderBy('fileTimestampUtc', 'desc')
          .limit(24)
          .get();

        const rows = [];
        snap.forEach(doc => rows.push(doc.data()));

        if (rows.length){
          liveMrmsDoc = {
            ...(liveMrmsDoc || {}),
            mrmsHourlyLast24: rows,
            mrmsHourlyLatest: rows[0] || {},
            mrmsHistoryMeta: {
              ...((liveMrmsDoc && liveMrmsDoc.mrmsHistoryMeta) || {}),
              source: 'mrms_hourly_fallback'
            }
          };
        }
      }catch(e){
        console.warn('[MRMS fallback] failed:', e);
      }
    }

    renderMrmsPanelFromDoc(liveMrmsDoc);

  }catch(_){
    renderMrmsPanelFromDoc({
      mrmsDailySeries30d: d.mrmsDailySeries30d || [],
      mrmsHourlyLast24: d.mrmsHourlyLast24 || [],
      mrmsHourlyLatest: d.mrmsHourlyLatest || {},
      mrmsHistoryMeta: d.mrmsHistoryMeta || {}
    });
  }
}

/* ---------- details render (PUBLIC) ---------- */
export async function renderDetails(state){
  await scheduleRender(state, 'details');
}

/* ---------- refresh ---------- */
export async function refreshAll(state){
  await scheduleRender(state, 'all');
}
export async function refreshDetailsOnly(state){
  await scheduleRender(state, 'details');
}

/* =====================================================================
   GLOBAL LISTENERS
===================================================================== */
(function wireGlobalLightRefreshOnce(){
  try{
    if (window.__FV_FR_TILE_REFRESH_WIRED__) return;
    window.__FV_FR_TILE_REFRESH_WIRED__ = true;

    document.addEventListener('fr:tile-refresh', async (e)=>{
      try{
        const state = window.__FV_FR;
        if (!state) return;
        const fid = e && e.detail ? String(e.detail.fieldId || '') : '';
        if (!fid) return;

        await patchTileRainOnly(state, fid);
        await updateTileForField(state, fid);
      }catch(_){}
    });

    document.addEventListener('fr:details-refresh', async (e)=>{
      try{
        const state = window.__FV_FR;
        if (!state) return;
        const fid = e && e.detail ? String(e.detail.fieldId || '') : '';
        if (fid) setSelectedField(state, fid);
        await refreshDetailsOnly(state);
      }catch(_){}
    });

    document.addEventListener('fr:soft-reload', async ()=>{
      try{
        const state = window.__FV_FR;
        if (!state) return;

        state._persistLoadedAt = 0;
        state._latestReadinessLoadedAt = 0;
        state._etaTileCache = {};
        state._etaDebugByFieldId = {};
        state.mrmsByFieldId = new Map();
        state.mrmsInfoByFieldId = new Map();

        await loadPersistedState(state, { force:true });
        await loadLatestReadiness(state, { force:true });
        await refreshAll(state);
      }catch(_){}
    });

  }catch(_){}
})();

/* =====================================================================
   GLOBAL SEARCH WIRING
===================================================================== */
(function wireFieldSearchOnce(){
  try{
    if (window.__FV_FR_SEARCH_WIRED__) return;
    window.__FV_FR_SEARCH_WIRED__ = true;

    let timer = null;

    function trigger(){
      try{
        const state = window.__FV_FR;
        if (!state) return;

        const q = getFieldSearchQuery(state);
        state.fieldSearchQuery = q;

        refreshAll(state);
      }catch(_){}
    }

    function schedule(){
      try{
        if (timer) clearTimeout(timer);
      }catch(_){}
      timer = setTimeout(()=>{
        timer = null;
        trigger();
      }, FIELD_SEARCH_DEBOUNCE_MS);
    }

    document.addEventListener('input', (e)=>{
      try{
        const t = e && e.target;
        if (!t || t.id !== FIELD_SEARCH_INPUT_ID) return;
        schedule();
      }catch(_){}
    }, true);

    document.addEventListener('search', (e)=>{
      try{
        const t = e && e.target;
        if (!t || t.id !== FIELD_SEARCH_INPUT_ID) return;
        schedule();
      }catch(_){}
    }, true);

    document.addEventListener('keydown', (e)=>{
      try{
        const t = e && e.target;
        if (!t || t.id !== FIELD_SEARCH_INPUT_ID) return;
        if (e.key !== 'Escape') return;

        if (String(t.value || '')){
          t.value = '';
          schedule();
        }
      }catch(_){}
    }, true);
  }catch(_){}
})();
