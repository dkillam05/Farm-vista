/* =====================================================================
/Farm-vista/js/field-readiness/render.js  (FULL FILE)
Rev: 2026-03-15f-eta-debug-and-forecast-cache-warm

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
✅ FIX: if latest readiness is below threshold, tile ETA may NOT show 0 / ~0h
✅ DEBUG: log ETA inputs/results so we can see why fields are blank
✅ DEBUG: warm forecast cache into state._frForecastCache during tile ETA path
✅ No trimmed sections

NEW CENTRALIZED READINESS SOURCE:
- Collection: field_readiness_latest
- Key: fieldId
- Primary displayed number: readiness

IMPORTANT BEHAVIOR:
- Tiles, sorting, selected tile refresh, and list rendering now use the
  cached field_readiness_latest collection first.
- If a field does not yet have a latest readiness doc, that tile shows
  "Field Readiness —".
- Heavy model math is no longer required just to draw/sort tiles.
- Details panel still attempts deep model/trace rendering when needed,
  but displayed readiness truth is anchored to field_readiness_latest.
- ETA is restored as a secondary post-render enhancement so tile loading
  stays fast.
- This file now hard-guards tile ETA so below-threshold latest readiness
  cannot visually collapse to zero.
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
const ETA_DEBUG = true;

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

  const readinessR = safeInt(rec.readiness);
  if (!Number.isFinite(readinessR)) return null;

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
    computedAtISO: safeStr(rec.computedAtISO),
    weatherFetchedAtISO: safeStr(rec.weatherFetchedAtISO),
    county: safeStr(rec.county || f.county),
    state: safeStr(rec.state || f.state),
    trace: [],
    rows: [],
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

    if (!totalN){
      el.textContent = 'Showing 0 fields';
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
      timer: null
    };
  }
  return state._renderGate;
}

async function scheduleRender(state, mode){
  const g = ensureRenderGate(state);
  if (!g) return;

  if (mode === 'all') g.wantAll = true;
  if (mode === 'details') g.wantDetails = true;
  if (g.inFlight) return;

  if (g.timer) clearTimeout(g.timer);
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
      if (g.wantAll || g.wantDetails){
        scheduleRender(state, g.wantAll ? 'all' : 'details');
      }
    }
  }, 25);
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

  // Only true extremes are dark
  if (x <= 2) return `hsl(5 75% 30%)`;     // dark red (only near 0)
  if (x >= 98) return `hsl(120 60% 28%)`;  // dark green (only near 100)

  // Everything else uses lighter colors
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

/* ---------- page size helpers ---------- */
function getEffectivePageSize(state){
  try{
    const sel = document.getElementById('pageSel');
    const raw = String(sel ? sel.value : (state && state.pageSize === -1 ? '__all__' : String((state && state.pageSize) || 25))).trim();
    if (raw === '__all__') return -1;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return Math.max(1, Math.round(n));
  }catch(_){}
  return (state && Number(state.pageSize) === -1) ? -1 : Math.max(1, Math.round(Number((state && state.pageSize) || 25)));
}

/* ---------- view key ---------- */
function getTilesViewKey(state){
  const opKey = getCurrentOp();
  const farmId = String(state && state.farmFilter ? state.farmFilter : '__all__');
  const pageSize = String(getEffectivePageSize(state));
  const sort = getSortMode();
  const rangeStr = String(($('jobRangeInput') && $('jobRangeInput').value) ? $('jobRangeInput').value : '');
  const latestStamp = String(Number(state && state._latestReadinessLoadedAt || 0));
  return `${opKey}__${farmId}__${pageSize}__${sort}__${rangeStr}__${latestStamp}`;
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

/* ---------- farm filter ---------- */
function getFilteredFields(state){
  const farmId = String(state.farmFilter || '__all__');
  if (farmId === '__all__') return state.fields.slice();
  return state.fields.filter(f => String(f.farmId || '') === farmId);
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
   ETA helper
===================================================================== */
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

function forceNonZeroEtaText(txt, readinessNow, thr){
  const s = String(txt || '').trim();
  const ready = Number(readinessNow);
  const threshold = Number(thr);

  if (!Number.isFinite(ready) || !Number.isFinite(threshold)) return s;
  if (ready >= threshold) return s;

  if (!s || isZeroEtaLike(s)) return '~1h';

  const h = parseEtaHoursFromText(s);
  if (Number.isFinite(h) && h <= 0) return '~1h';

  return s;
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
    if (!state._etaTileCache) state._etaTileCache = {};
    state._etaTileCache[key] = {
      ts: Date.now(),
      text: safeStr(text)
    };
  }catch(_){}
}

function normalizeEtaResult(res, horizonHours){
  try{
    const r = safeObj(res) || {};

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

function normalizeForecastRowsLocal(rows){
  return (Array.isArray(rows) ? rows : []).map(r => ({
    ...r,
    rainInAdj: safeNum(r && r.rainInAdj) ?? safeNum(r && r.rainIn) ?? 0,
    rainSource: safeStr(r && (r.rainSource || r.precipSource || 'open-meteo')) || 'open-meteo'
  }));
}

function etaDebugLog(state, payload){
  try{
    if (!ETA_DEBUG) return;
    const out = safeObj(payload) || {};
    if (!state._etaDebugByFieldId) state._etaDebugByFieldId = {};
    const fid = safeStr(out.fieldId || 'unknown');
    state._etaDebugByFieldId[fid] = out;
    window.__FV_FR_ETA_DEBUG_LAST__ = out;
    window.__FV_FR_ETA_DEBUG_ALL__ = state._etaDebugByFieldId;
    console.log('[ETA DEBUG]', out);
  }catch(_){}
}

async function warmForecastCacheForEta(state, fieldId){
  try{
    const fid = safeStr(fieldId);
    if (!fid) return [];

    if (!state._frForecastCache) state._frForecastCache = new Map();

    const existing = state._frForecastCache.get(fid);
    if (Array.isArray(existing) && existing.length) return existing;

    const forecastMod = state && state._mods ? state._mods.forecast : null;
    if (!forecastMod || typeof forecastMod.readWxSeriesFromCache !== 'function'){
      state._frForecastCache.set(fid, []);
      return [];
    }

    const wx = await forecastMod.readWxSeriesFromCache(fid, {});
    const rows = normalizeForecastRowsLocal((wx && Array.isArray(wx.fcst)) ? wx.fcst : []);
    state._frForecastCache.set(fid, rows);
    return rows;
  }catch(_){
    return [];
  }
}

function buildEtaDepsForField(state, fieldObj, opKey, latestRec){
  const deps = buildDepsForState(state, opKey);
  const rec = latestRec || getLatestReadinessForField(state, fieldObj && fieldObj.id) || null;

  if (!deps || typeof deps !== 'object') return deps;

  return {
    ...deps,
    getCentralizedLatestForFieldId: (id)=>{
      const fid = String(id || '');
      if (rec && String(rec.fieldId || fieldObj?.id || '') === fid) return rec;
      try{
        return getLatestReadinessForField(state, fid);
      }catch(_){
        return null;
      }
    },
    getEtaSeedForFieldId: (id)=>{
      const fid = String(id || '');
      const useRec = (rec && String(rec.fieldId || fieldObj?.id || '') === fid)
        ? rec
        : getLatestReadinessForField(state, fid);

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
    }
  };
}

async function getTileEtaText(state, fieldObj, deps, run0, thr, latestRec){
  const HORIZON_HOURS = ETA_HORIZON_HOURS;
  const readinessNow = Number(run0 && run0.readinessR);

  if (!Number.isFinite(readinessNow)) return '';
  if (readinessNow >= Number(thr)) return '';

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
      etaDebugLog(state, {
        fieldId: safeStr(fieldObj && fieldObj.id),
        fieldName: safeStr(fieldObj && fieldObj.name),
        source: 'cache-hit',
        readinessTile: readinessNow,
        readinessLatest: authoritativeReadiness,
        threshold: Number(thr),
        etaText: cached
      });
      return forceNonZeroEtaText(cached, authoritativeReadiness, thr);
    }

    await ensureFRModules(state);
    await ensureEtaHelperModule(state);
    await loadPersistedState(state, { force:false });

    await warmForecastCacheForEta(state, fieldObj && fieldObj.id);

    const model = state && state._mods ? state._mods.model : null;
    if (!model || typeof model.etaToThreshold !== 'function'){
      etaDebugLog(state, {
        fieldId: safeStr(fieldObj && fieldObj.id),
        fieldName: safeStr(fieldObj && fieldObj.name),
        source: 'model-missing',
        readinessTile: readinessNow,
        readinessLatest: authoritativeReadiness,
        threshold: Number(thr)
      });
      return '';
    }

    const etaDeps = buildEtaDepsForField(state, fieldObj, opKey, latest);

    let forecastRows = [];
    try{
      forecastRows =
        (etaDeps && typeof etaDeps.getForecastSeriesForFieldId === 'function')
          ? (etaDeps.getForecastSeriesForFieldId(fieldObj.id) || [])
          : [];
    }catch(_){
      forecastRows = [];
    }

    const etaSeed =
      (etaDeps && typeof etaDeps.getEtaSeedForFieldId === 'function')
        ? etaDeps.getEtaSeedForFieldId(fieldObj.id)
        : null;

    const res = await model.etaToThreshold(fieldObj, etaDeps || deps, Number(thr), HORIZON_HOURS, 3);

    let txt = normalizeEtaResult(res, HORIZON_HOURS);

    if (!txt && res && (res.exceedsHorizon === true || res.withinHorizon === false || res.reached === false)){
      txt = `>${HORIZON_HOURS}h`;
    }

    if (
      authoritativeReadiness < Number(thr) &&
      (
        isZeroEtaLike(txt) ||
        Number(res && res.hours) === 0 ||
        String(res && res.status || '').toLowerCase() === 'drynow'
      )
    ){
      txt = '~1h';
    }

    txt = forceNonZeroEtaText(txt, authoritativeReadiness, thr);

    etaDebugLog(state, {
      fieldId: safeStr(fieldObj && fieldObj.id),
      fieldName: safeStr(fieldObj && fieldObj.name),
      source: 'model-run',
      readinessTile: readinessNow,
      readinessLatest: authoritativeReadiness,
      threshold: Number(thr),
      forecastCount: Array.isArray(forecastRows) ? forecastRows.length : 0,
      forecastFirstDate: Array.isArray(forecastRows) && forecastRows[0] ? safeStr(forecastRows[0].dateISO) : '',
      forecastLastDate: Array.isArray(forecastRows) && forecastRows.length ? safeStr(forecastRows[forecastRows.length - 1].dateISO) : '',
      etaSeed: etaSeed ? {
        readiness: safeNum(etaSeed.readiness),
        wetness: safeNum(etaSeed.wetness),
        storagePhysFinal: safeNum(etaSeed.storagePhysFinal),
        storageFinal: safeNum(etaSeed.storageFinal),
        storageForReadiness: safeNum(etaSeed.storageForReadiness),
        source: safeStr(etaSeed.source),
        computedAtISO: safeStr(etaSeed.computedAtISO),
        weatherFetchedAtISO: safeStr(etaSeed.weatherFetchedAtISO),
        runKey: safeStr(etaSeed.runKey)
      } : null,
      result: res ? {
        ok: !!res.ok,
        status: safeStr(res.status),
        hours: safeNum(res.hours),
        text: safeStr(res.text)
      } : null,
      etaTextFinal: safeStr(txt)
    });

    if (txt){
      setEtaCacheValue(state, cacheKey, txt);
    }

    return txt;
  }catch(err){
    etaDebugLog(state, {
      fieldId: safeStr(fieldObj && fieldObj.id),
      fieldName: safeStr(fieldObj && fieldObj.name),
      source: 'exception',
      readinessTile: readinessNow,
      threshold: Number(thr),
      error: safeStr(err && (err.stack || err.message || err))
    });
    return '';
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
    const mrmsRes = await getMrmsRainResultForField(state, fid, range, { force:false });
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
    const mrmsRes = await getMrmsRainResultForField(state, fid, range, { force:false });
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
    }catch(_){
      etaText = '';
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

  const filteredNow = getFilteredFields(state);
  const filteredSigNow = getFilteredFieldSignature(filteredNow);
  const effectivePageSize = getEffectivePageSize(state);

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
    const cap = (effectivePageSize === -1)
      ? tiles.length
      : Math.min(tiles.length, effectivePageSize);
    const ids = tiles.slice(0, cap).map(t=>String(t.getAttribute('data-field-id')||'')).filter(Boolean);

    updateFieldsCountHelper(Math.min(tiles.length, cap), filteredExisting.length);

    initFallbackSwipeOnTiles(state, wrap, {
      onDetails: async (fieldId)=>{
        if (!canEdit(state)) return;
        await openQuickView(state, fieldId);
      }
    });

    await updateVisibleTilesBatched(state, ids);
    return;
  }

  setFieldsCountHelperMessage('Preparing fields…');
  renderFieldsInlineLoading(
    'Loading field readiness...',
    'Centralized field_readiness_latest values are being loaded and sorted now.'
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
      const res = await getMrmsRainResultForField(state, f.id, range, { force:false });
      mrmsRangeById.set(f.id, res);
    })
  );

  const sorted = sortFields(filtered, state.lastRuns, mrmsRangeById);
  const thr = getThresholdForOp(state, opKey);

  const cap = (effectivePageSize === -1)
    ? sorted.length
    : Math.min(sorted.length, effectivePageSize);
  const show = sorted.slice(0, cap);

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
function setText(id, txt){
  const el = $(id);
  if (el) el.textContent = String(txt ?? '—');
}
function renderMrmsPanelEmpty(msg){
  setText('mrmsMeta', msg || 'No MRMS data found for this field.');
  setText('mrmsLatestHour', '—');
  setText('mrmsLast24Total', '—');
  setText('mrmsLast7dTotal', '—');
  setText('mrmsUnits', 'mm');

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

  setText(
    'mrmsMeta',
    `Latest file: ${latestTs ? localTs(latestTs) : '—'} • Product: ${latestProduct} • Daily rows: ${daily.length} • Hourly rows: ${hourly.length}`
  );
  setText('mrmsLatestHour', `${fmt2(latestHourMm)} mm`);
  setText('mrmsLast24Total', `${fmt2(mmToIn(last24Mm))} in`);
  setText('mrmsLast7dTotal', `${fmt2(mmToIn(last7Mm))} in`);
  setText('mrmsUnits', units);

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

/* ---------- details render (CORE) ---------- */
async function _renderDetailsInternal(state){
  ensureFieldsCountHelperEl();
  await loadLatestReadiness(state, { force:false });

  const f = state.fields.find(x=>x.id === state.selectedFieldId);
  if (!f) return;

  updateDetailsHeaderPanel(state);

  const latest = getLatestReadinessForField(state, f.id);
  const latestRun = buildSyntheticRunFromLatest(state, f, latest);
  if (latestRun){
    try{
      state.lastRuns = state.lastRuns || new Map();
      state.lastRuns.set(f.id, latestRun);
    }catch(_){}
  }

  let run = null;
  try{
    await ensureFRModules(state);
    ensureEtaHelperModule(state);
    await loadPersistedState(state, { force:false });
    const opKey = getCurrentOp();
    await warmWeatherForFieldSet(state, [f]);
    run = await computeDeepModelRunForField(state, f, opKey);
  }catch(e){
    console.warn('[FieldReadiness] details deep model load failed:', e);
  }

  renderBetaInputs(state);

  let traceDisplay = Array.isArray(run && run.trace) ? run.trace : [];
  if (!traceDisplay.length && run){
    try{
      const opKey = getCurrentOp();
      const deps = buildDepsForState(state, opKey);
      const depsDbg = { ...deps, seedMode:'rewind', rewindDays:14 };
      const dbg = state._mods.model.runField(f, depsDbg);
      const dbgTrace = Array.isArray(dbg && dbg.trace) ? dbg.trace : [];
      if (dbgTrace.length) traceDisplay = dbgTrace;
    }catch(_){}
  }

  const trb = $('traceRows');
  if (trb){
    trb.innerHTML = '';
    const rows = traceDisplay;
    if (!rows.length){
      trb.innerHTML = `<tr><td colspan="7" class="muted">No trace rows.</td></tr>`;
    } else {
      for (const t of rows){
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="mono">${esc(String(t.dateISO || ''))}</td>
          <td class="right mono">${Number(t.rain ?? 0).toFixed(2)}</td>
          <td class="right mono">${Number(t.infilMult ?? 0).toFixed(2)}</td>
          <td class="right mono">${Number(t.add ?? 0).toFixed(2)}</td>
          <td class="right mono">${Number(t.dryPwr ?? 0).toFixed(2)}</td>
          <td class="right mono">${Number(t.loss ?? 0).toFixed(2)}</td>
          <td class="right mono">${Number(t.before ?? 0).toFixed(2)}→${Number(t.after ?? 0).toFixed(2)}</td>
        `;
        trb.appendChild(tr);
      }
    }
  }

  const drb = $('dryRows');
  if (drb){
    drb.innerHTML = '';
    const rows = Array.isArray(run && run.rows) ? run.rows : [];
    if (!rows.length){
      drb.innerHTML = `<tr><td colspan="15" class="muted">No rows.</td></tr>`;
    } else {
      for (const r of rows){
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="mono">${esc(r.dateISO)}</td>
          <td class="right mono">${Math.round(Number(r.temp||0))}</td>
          <td class="right mono">${Number(r.tempN||0).toFixed(2)}</td>
          <td class="right mono">${Math.round(Number(r.wind||0))}</td>
          <td class="right mono">${Number(r.windN||0).toFixed(2)}</td>
          <td class="right mono">${Math.round(Number(r.rh||0))}</td>
          <td class="right mono">${Number(r.rhN||0).toFixed(2)}</td>
          <td class="right mono">${Math.round(Number(r.solar||0))}</td>
          <td class="right mono">${Number(r.solarN||0).toFixed(2)}</td>
          <td class="right mono">${Number(r.vpd||0).toFixed(2)}</td>
          <td class="right mono">${Number(r.vpdN||0).toFixed(2)}</td>
          <td class="right mono">${Math.round(Number(r.cloud||0))}</td>
          <td class="right mono">${Number(r.cloudN||0).toFixed(2)}</td>
          <td class="right mono">${Number(r.raw||0).toFixed(2)}</td>
          <td class="right mono">${Number(r.dryPwr||0).toFixed(2)}</td>
        `;
        drb.appendChild(tr);
      }
    }
  }

  const wxb = $('wxRows');
  if (wxb){
    wxb.innerHTML = '';
    const rows = Array.isArray(run && run.rows) ? run.rows : [];

    function addWxRow(row){
      const r = row || {};
      const dateISO = String(r.dateISO || '').slice(0,32) || '—';

      const rain = Number(r.rainInAdj ?? r.rainIn ?? 0);
      const temp = Math.round(Number(r.temp ?? r.tempF ?? 0));
      const wind = Math.round(Number(r.wind ?? 0));
      const rh = Math.round(Number(r.rh ?? 0));
      const solar = Math.round(Number(r.solar ?? 0));

      const et0Num = (r.et0In == null ? r.et0 : r.et0In);
      const et0 = (et0Num == null ? '—' : Number(et0Num).toFixed(2));

      const sm010 = (r.sm010 == null ? '—' : Number(r.sm010).toFixed(3));
      const st010F = (r.st010F == null ? '—' : String(Math.round(Number(r.st010F))));

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="mono">${esc(dateISO)}</td>
        <td class="right mono">${rain.toFixed(2)}</td>
        <td class="right mono">${temp}</td>
        <td class="right mono">${wind}</td>
        <td class="right mono">${rh}</td>
        <td class="right mono">${solar}</td>
        <td class="right mono">${esc(et0)}</td>
        <td class="right mono">${esc(sm010)}</td>
        <td class="right mono">${esc(st010F)}</td>
      `;
      wxb.appendChild(tr);
    }

    if (!rows.length){
      wxb.innerHTML = `<tr><td colspan="9" class="muted">No weather rows.</td></tr>`;
    } else {
      for (const r of rows) addWxRow(r);

      try{
        const fc = state && state._mods ? state._mods.forecast : null;
        if (fc && typeof fc.readWxSeriesFromCache === 'function'){
          const wx = await fc.readWxSeriesFromCache(String(f.id), {});
          const fcst = (wx && Array.isArray(wx.fcst)) ? wx.fcst : [];

          if (fcst && fcst.length){
            const div = document.createElement('tr');
            div.innerHTML = `<td colspan="9" class="muted" style="font-weight:900;">Forecast (next 7 days)</td>`;
            wxb.appendChild(div);

            for (const d of fcst.slice(0, 7)){
              addWxRow(d);
            }
          }
        }
      }catch(_){}
    }
  }

  try{
    const mrmsDoc = await loadFieldMrmsDoc(state, String(f.id), { force:false });
    renderMrmsPanelFromDoc(mrmsDoc);
  }catch(e){
    console.warn('[FieldReadiness] MRMS render failed:', e);
    renderMrmsPanelEmpty('MRMS data could not be loaded.');
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
        window.__FV_FR_ETA_DEBUG_LAST__ = null;
        window.__FV_FR_ETA_DEBUG_ALL__ = null;

        await loadPersistedState(state, { force:true });
        await loadLatestReadiness(state, { force:true });
        await refreshAll(state);
      }catch(_){}
    });

  }catch(_){}
})();