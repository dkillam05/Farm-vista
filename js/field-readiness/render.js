/* =====================================================================
/Farm-vista/js/field-readiness/render.js
Rev: 2026-05-15-backend-eta-days-tiles

PURPOSE:
✅ Tiles read ONLY field_conditions_current for readiness
✅ Tiles read daily subcollection for backend ETA buckets
✅ No browser-side readiness recompute
✅ No frontend weather/soil ETA physics
✅ ETA uses backend eta.etaDays only
✅ ETA text click opens eta-helper popup
✅ Details read selected field daily subcollection
✅ Keep same public exports used by index.js
✅ Keep threshold/gauge UI behavior
✅ Keep MRMS rain range display
✅ Keep quickview/swipe hooks
✅ Details grid grouped into History / Current / Forecast
✅ Field Information displayed as stacked UI-friendly rows
✅ Timestamps displayed in Central Time
===================================================================== */

'use strict';

import { $, esc, clamp } from './utils.js';
import { ensureSelectedParamsToSliders } from './params.js';
import { getCurrentOp, getThresholdForOp } from './thresholds.js';
import { canEdit } from './perm.js';
import { openQuickView } from './quickview.js';
import { initSwipeOnTiles } from './swipe.js';
import { parseRangeFromInput, mrmsRainInRange } from './rain.js';
import { fetchAndHydrateFieldParams, loadFieldMrmsDoc } from './data.js';
import { getAPI } from './firebase.js';

const FIELD_CONDITIONS_COLLECTION = 'field_conditions_current';
const DAILY_SUBCOLLECTION = 'daily';
const FIELD_SEARCH_INPUT_ID = 'fieldSearch';
const READINESS_TTL_MS = 30000;
const DAILY_TTL_MS = 30000;
const ETA_UNAVAILABLE_TEXT = 'ETA can not be calculated at this time';
const ETA_HORIZON_HOURS = 168;

/* =====================================================================
   BASIC HELPERS
===================================================================== */
function safeObj(x){
  return x && typeof x === 'object' ? x : null;
}

function safeStr(x){
  const s = String(x || '');
  return s ? s : '';
}

function safeNum(v, fallback = null){
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function safeInt(v, fallback = null){
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

function round(v, d = 2){
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const p = Math.pow(10, d);
  return Math.round(n * p) / p;
}

function toIsoFromAny(v){
  try{
    if (!v) return '';
    if (typeof v === 'string') return v;

    if (v && typeof v.toDate === 'function'){
      const d = v.toDate();
      return Number.isFinite(d.getTime()) ? d.toISOString() : '';
    }

    if (v && typeof v.seconds === 'number'){
      const ms =
        Number(v.seconds) * 1000 +
        Math.round(Number(v.nanoseconds || 0) / 1e6);

      const d = new Date(ms);
      return Number.isFinite(d.getTime()) ? d.toISOString() : '';
    }

    if (v && typeof v.__time__ === 'string'){
      return v.__time__;
    }
  }catch(_){}

  return '';
}

function formatCentralTime(value){
  try{
    if (!value) return '—';

    let d = null;

    if (value && typeof value.toDate === 'function'){
      d = value.toDate();
    } else if (value && typeof value.seconds === 'number'){
      d = new Date(
        Number(value.seconds) * 1000 +
        Math.round(Number(value.nanoseconds || 0) / 1e6)
      );
    } else if (typeof value === 'string'){
      d = new Date(value);
    } else {
      d = new Date(value);
    }

    if (!d || !Number.isFinite(d.getTime())){
      return String(value || '—');
    }

    return new Intl.DateTimeFormat('en-US', {
      timeZone:'America/Chicago',
      year:'numeric',
      month:'2-digit',
      day:'2-digit',
      hour:'numeric',
      minute:'2-digit',
      hour12:true
    }).format(d);
  }catch(_){
    return String(value || '—');
  }
}

function markerLeftCSS(v){
  return `${clamp(Number(v) || 0, 0, 100)}%`;
}

function getFieldName(f, rec){
  return safeStr(rec?.fieldName || f?.name || 'Field');
}

function todayISOChicago(){
  try{
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone:'America/Chicago',
      year:'numeric',
      month:'2-digit',
      day:'2-digit'
    }).formatToParts(new Date());

    const y = parts.find(p=>p.type === 'year')?.value;
    const m = parts.find(p=>p.type === 'month')?.value;
    const d = parts.find(p=>p.type === 'day')?.value;

    if (y && m && d) return `${y}-${m}-${d}`;
  }catch(_){}

  return new Date().toISOString().slice(0, 10);
}

function normalizeGroupedInput(rowsOrGroups){
  if (!Array.isArray(rowsOrGroups)) return [];

  if (
    rowsOrGroups.length &&
    safeObj(rowsOrGroups[0]) &&
    Array.isArray(rowsOrGroups[0].rows)
  ){
    return rowsOrGroups;
  }

  return [
    {
      label:'',
      rows:rowsOrGroups
    }
  ];
}

function appendGroupHeader(tbody, label, colspan){
  if (!tbody || !label) return;

  const tr = document.createElement('tr');
  tr.className = 'fr-detail-group-row';

  tr.innerHTML = `
    <td
      colspan="${Number(colspan || 1)}"
      style="
        padding:10px 12px;
        font-weight:900;
        font-size:12px;
        letter-spacing:.02em;
        background:color-mix(in srgb, var(--surface) 88%, var(--text) 12%);
        color:var(--text);
        border-top:1px solid var(--border);
        border-bottom:1px solid var(--border);
      "
    >
      ${esc(label)}
    </td>
  `;

  tbody.appendChild(tr);
}

/* =====================================================================
   FIRESTORE LOADER
===================================================================== */
function normalizeCurrentDoc(raw, fallbackId){
  const d = safeObj(raw) || {};
  const final = safeObj(d.final) || {};
  const soil = safeObj(d.soil) || {};
  const surface = safeObj(d.surface) || {};

  const fieldId = safeStr(d.fieldId || fallbackId);
  if (!fieldId) return null;

  const readiness = safeInt(final.readiness ?? d.readiness);
  const wetness = safeInt(final.wetness ?? d.wetness);

  return {
    fieldId,
    fieldName: safeStr(d.fieldName),
    farmId: safeStr(d.farmId),
    farmName: safeStr(d.farmName),
    county: safeStr(d.county),
    state: safeStr(d.state),

    readiness,
    wetness,

    baseReadiness: safeNum(final.baseReadiness ?? d.baseReadiness),
    surfacePenalty: safeNum(final.surfacePenalty ?? d.surfacePenalty),

    storageFinal: safeNum(final.storageFinal ?? soil.storage ?? d.storageFinal),
    storageForReadiness: safeNum(final.storageForReadiness ?? d.storageForReadiness),
    surfaceFinal: safeNum(final.surfaceFinal ?? surface.water ?? d.surfaceStorageFinal),

    soilWetness: safeNum(d.soilWetness),
    drainageIndex: safeNum(d.drainageIndex),

    status: safeStr(d.status),
    reason: safeStr(d.reason),

    updatedAtISO: toIsoFromAny(d.updatedAt ?? d.computedAt),
    computedAtISO: toIsoFromAny(d.computedAt ?? d.updatedAt),

    location: safeObj(d.location),

    _raw: d
  };
}

async function loadFieldConditionsCurrent(state, { force=false } = {}){
  if (!state) return;

  const now = Date.now();
  const last = Number(state._fieldConditionsLoadedAt || 0);

  if (
    !force &&
    state.fieldConditionsById &&
    now - last < READINESS_TTL_MS
  ){
    return;
  }

  const out = {};
  const api = getAPI(state);

  if (!api){
    state.fieldConditionsById = out;
    state._fieldConditionsLoadedAt = now;
    return;
  }

  try{
    if (api.kind === 'compat' && window.firebase?.firestore){
      const db = window.firebase.firestore();
      const snap = await db.collection(FIELD_CONDITIONS_COLLECTION).get();

      snap.forEach(doc=>{
        const rec = normalizeCurrentDoc(doc.data() || {}, doc.id);
        if (rec && rec.fieldId) out[rec.fieldId] = rec;
      });

      state.fieldConditionsById = out;
      state._fieldConditionsLoadedAt = now;
      return;
    }

    const db = api.getFirestore();
    const col = api.collection(db, FIELD_CONDITIONS_COLLECTION);
    const snap = await api.getDocs(col);

    snap.forEach(doc=>{
      const rec = normalizeCurrentDoc(doc.data() || {}, doc.id);
      if (rec && rec.fieldId) out[rec.fieldId] = rec;
    });

    state.fieldConditionsById = out;
    state._fieldConditionsLoadedAt = now;

  }catch(e){
    console.warn('[FieldReadiness] failed loading field_conditions_current:', e);
    state.fieldConditionsById = state.fieldConditionsById || {};
    state._fieldConditionsLoadedAt = now;
  }
}

function getCurrentRecord(state, fieldId){
  try{
    const map = safeObj(state?.fieldConditionsById) || {};
    return safeObj(map[String(fieldId || '')]);
  }catch(_){
    return null;
  }
}

/* =====================================================================
   BACKEND ETA HELPERS
===================================================================== */
function getEtaFromDailyRows(rows){
  const today = todayISOChicago();
  const arr = Array.isArray(rows) ? rows : [];

  const todayRow =
    arr.find(r => String(r.dateISO || '') === today);

  const etaToday =
    safeObj(todayRow?._raw?.eta) ||
    safeObj(todayRow?.eta);

  if (
    etaToday &&
    Array.isArray(etaToday.etaDays) &&
    etaToday.etaDays.length
  ){
    return etaToday;
  }

  const latestWithEta = arr
    .filter(r=>{
      const e =
        safeObj(r?._raw?.eta) ||
        safeObj(r?.eta);

      return e &&
        Array.isArray(e.etaDays) &&
        e.etaDays.length;
    })
    .sort((a, b)=> String(b.dateISO).localeCompare(String(a.dateISO)))[0];

  return (
    safeObj(latestWithEta?._raw?.eta) ||
    safeObj(latestWithEta?.eta) ||
    null
  );
}

function calculateEtaFromDays({
  readinessNow,
  threshold,
  etaDays,
  horizonHours = ETA_HORIZON_HOURS
}){
  const rNow = safeNum(readinessNow);
  const thr = safeNum(threshold);

  if (rNow === null || thr === null){
    return {
      ok:false,
      status:'missing_inputs',
      text:ETA_UNAVAILABLE_TEXT,
      hours:null
    };
  }

  if (rNow >= thr){
    return {
      ok:true,
      status:'ready_now',
      text:'',
      hours:0
    };
  }

  const days = Array.isArray(etaDays) ? etaDays : [];

  if (!days.length){
    return {
      ok:false,
      status:'missing_eta_days',
      text:ETA_UNAVAILABLE_TEXT,
      hours:null
    };
  }

  let runningReadiness = rNow;
  let elapsedHours = 0;

  for (const day of days){
    const gain = safeNum(day?.readinessGain, 0);
    const hours = safeNum(day?.hours, 24);
    const rate = safeNum(day?.drydownPointsPerHour, null);

    if (
      gain > 0 &&
      rate !== null &&
      rate > 0 &&
      runningReadiness + gain >= thr
    ){
      const needed = thr - runningReadiness;
      const partialHours = needed / rate;
      const totalHours = elapsedHours + partialHours;

      if (totalHours > horizonHours){
        return {
          ok:false,
          status:'beyond_horizon',
          text:`>${Math.round(horizonHours)}h`,
          hours:horizonHours
        };
      }

      return {
        ok:true,
        status:'reaches_threshold',
        text:`~${Math.max(0, Math.round(totalHours))}h`,
        hours:totalHours
      };
    }

    runningReadiness += gain;
    runningReadiness = clamp(runningReadiness, 0, 100);
    elapsedHours += hours;
  }

  return {
    ok:false,
    status:'not_reached',
    text:`>${Math.round(horizonHours)}h`,
    hours:null
  };
}

function getTileEtaInfo(rows, readiness, threshold){
  const eta = getEtaFromDailyRows(rows);
  const etaDays = Array.isArray(eta?.etaDays) ? eta.etaDays : [];

  const calc = calculateEtaFromDays({
    readinessNow: readiness,
    threshold,
    etaDays,
    horizonHours: ETA_HORIZON_HOURS
  });

  return {
    eta,
    etaDays,
    ...calc
  };
}

/* =====================================================================
   DAILY SUBCOLLECTION LOADER
===================================================================== */
function normalizeDailyDoc(raw, fallbackDate){
  const d = safeObj(raw) || {};
  const weather = safeObj(d.weather) || {};
  const trace = safeObj(d.trace) || {};
  const dry = safeObj(d.dryPwrBreakdown) || {};
  const final = safeObj(d.final) || {};
  const eta = safeObj(d.eta) || {};

  const dateISO = safeStr(d.dateISO || fallbackDate);
  if (!dateISO) return null;

  return {
    dateISO,

    eta,

    weather: {
      rainSource: safeStr(weather.rainSource),
      rainUsedInMath: safeNum(weather.rainUsedInMath, 0),
      rainMrmsIn: safeNum(weather.rainMrmsIn, null),
      rainOpenMeteoIn: safeNum(weather.rainOpenMeteoIn, null),
      tempF: safeNum(weather.tempF, null),
      windMph: safeNum(weather.windMph, null),
      rh: safeNum(weather.rh, null),
      solarWm2: safeNum(weather.solarWm2, null),
      et0In: safeNum(weather.et0In, null),
      sm010: safeNum(weather.sm010, null),
      st010: safeNum(weather.st010, null),
      vpd: safeNum(weather.vpd, null),
      cloud: safeNum(weather.cloud, null)
    },

    dryPwrBreakdown: {
      temp: safeNum(dry.temp ?? weather.tempF, null),
      tempN: safeNum(dry.tempN, null),
      wind: safeNum(dry.wind ?? weather.windMph, null),
      windN: safeNum(dry.windN, null),
      rh: safeNum(dry.rh ?? weather.rh, null),
      rhN: safeNum(dry.rhN, null),
      solar: safeNum(dry.solar ?? weather.solarWm2, null),
      solarN: safeNum(dry.solarN, null),
      vpd: safeNum(dry.vpd ?? weather.vpd, null),
      vpdN: safeNum(dry.vpdN, null),
      cloud: safeNum(dry.cloud ?? weather.cloud, null),
      cloudN: safeNum(dry.cloudN, null),
      raw: safeNum(dry.raw, null),
      dryPwr: safeNum(dry.dryPwr, null)
    },

    trace: {
      storage: safeNum(trace.storage, null),
      surface: safeNum(trace.surface, null),
      rain: safeNum(trace.rain, null),
      rainEff: safeNum(trace.rainEff, null),
      addRain: safeNum(trace.addRain, null),
      surfaceAdd: safeNum(trace.surfaceAdd, null),
      surfaceToSoil: safeNum(trace.surfaceToSoil, null),
      loss: safeNum(trace.loss, null),
      surfaceLoss: safeNum(trace.surfaceLoss, null),
      surfacePenalty: safeNum(trace.surfacePenalty, null),
      infilMult: safeNum(trace.infilMult, null)
    },

    final: {
      readiness: safeNum(final.readiness, null),
      wetness: safeNum(final.wetness, null),
      baseReadiness: safeNum(final.baseReadiness, null),
      storageFinal: safeNum(final.storageFinal, null),
      storageForReadiness: safeNum(final.storageForReadiness, null),
      surfaceFinal: safeNum(final.surfaceFinal, null),
      surfacePenalty: safeNum(final.surfacePenalty, null)
    },

    factors: safeObj(d.factors) || {},
    debug: safeObj(d.debug) || {},
    _raw: d
  };
}

async function loadDailyRowsForField(state, fieldId, { force=false } = {}){
  if (!state || !fieldId) return [];

  state.dailyRowsByFieldId = state.dailyRowsByFieldId || {};
  state._dailyRowsLoadedAt = state._dailyRowsLoadedAt || {};

  const fid = String(fieldId);
  const now = Date.now();
  const last = Number(state._dailyRowsLoadedAt[fid] || 0);

  if (
    !force &&
    Array.isArray(state.dailyRowsByFieldId[fid]) &&
    now - last < DAILY_TTL_MS
  ){
    return state.dailyRowsByFieldId[fid];
  }

  const rows = [];
  const api = getAPI(state);

  try{
    if (api?.kind === 'compat' && window.firebase?.firestore){
      const db = window.firebase.firestore();

      const snap = await db
        .collection(FIELD_CONDITIONS_COLLECTION)
        .doc(fid)
        .collection(DAILY_SUBCOLLECTION)
        .get();

      snap.forEach(doc=>{
        const rec = normalizeDailyDoc(doc.data() || {}, doc.id);
        if (rec) rows.push(rec);
      });
    } else if (api){
      const db = api.getFirestore();
      const col = api.collection(
        db,
        FIELD_CONDITIONS_COLLECTION,
        fid,
        DAILY_SUBCOLLECTION
      );

      const snap = await api.getDocs(col);

      snap.forEach(doc=>{
        const rec = normalizeDailyDoc(doc.data() || {}, doc.id);
        if (rec) rows.push(rec);
      });
    }
  }catch(e){
    console.warn('[FieldReadiness] failed loading daily rows:', fid, e);
  }

  rows.sort((a, b)=> String(a.dateISO).localeCompare(String(b.dateISO)));

  state.dailyRowsByFieldId[fid] = rows;
  state._dailyRowsLoadedAt[fid] = now;

  return rows;
}

/* =====================================================================
   SEARCH / FILTER / SORT
===================================================================== */
function getFieldSearchQuery(state){
  try{
    const el = document.getElementById(FIELD_SEARCH_INPUT_ID);
    const raw = el ? el.value : state?.fieldSearchQuery;
    const q = String(raw || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (state) state.fieldSearchQuery = q;
    return q;
  }catch(_){
    return '';
  }
}

function getFilteredFields(state){
  const fields = Array.isArray(state?.fields) ? state.fields : [];
  const farmId = String(state?.farmFilter || '__all__');
  const q = getFieldSearchQuery(state);

  return fields.filter(f=>{
    if (farmId !== '__all__' && String(f.farmId || '') !== farmId) return false;
    if (q && !String(f.name || '').toLowerCase().includes(q)) return false;
    return true;
  });
}

function getSortMode(){
  const el = $('sortSel');
  return String(el?.value || 'name_az');
}

function getEffectivePageSize(state){
  const el = $('pageSel');
  const raw = String(el?.value || state?.pageSize || '25');

  if (raw === '__all__'){
    if (state) state.pageSize = -1;
    return -1;
  }

  const n = Math.max(1, Math.round(Number(raw) || 25));
  if (state) state.pageSize = n;
  return n;
}

function compareName(a, b){
  return new Intl.Collator(undefined, {
    numeric:true,
    sensitivity:'base'
  }).compare(String(a?.name || ''), String(b?.name || ''));
}

function sortFields(state, fields, rainById){
  const mode = getSortMode();
  const arr = fields.slice();

  arr.sort((a, b)=>{
    const ra = getCurrentRecord(state, a.id);
    const rb = getCurrentRecord(state, b.id);

    const readyA = safeNum(ra?.readiness, null);
    const readyB = safeNum(rb?.readiness, null);

    const rainA = safeNum(rainById?.get(String(a.id))?.inches, null);
    const rainB = safeNum(rainById?.get(String(b.id))?.inches, null);

    if (mode === 'name_az') return compareName(a, b);
    if (mode === 'name_za') return compareName(b, a);

    if (mode === 'ready_dry_wet'){
      if (readyA == null && readyB != null) return 1;
      if (readyA != null && readyB == null) return -1;
      if (readyA !== readyB) return Number(readyB || 0) - Number(readyA || 0);
      return compareName(a, b);
    }

    if (mode === 'ready_wet_dry'){
      if (readyA == null && readyB != null) return 1;
      if (readyA != null && readyB == null) return -1;
      if (readyA !== readyB) return Number(readyA || 0) - Number(readyB || 0);
      return compareName(a, b);
    }

    if (mode === 'rain_most'){
      const va = rainA == null ? -1 : rainA;
      const vb = rainB == null ? -1 : rainB;
      if (va !== vb) return vb - va;
      return compareName(a, b);
    }

    if (mode === 'rain_least'){
      const va = rainA == null ? Number.POSITIVE_INFINITY : rainA;
      const vb = rainB == null ? Number.POSITIVE_INFINITY : rainB;
      if (va !== vb) return va - vb;
      return compareName(a, b);
    }

    return compareName(a, b);
  });

  return arr;
}

/* =====================================================================
   UI COLORS / GAUGE
===================================================================== */
function perceivedFromThreshold(readiness, thr){
  const r = clamp(Math.round(Number(readiness)), 0, 100);
  const t = clamp(Math.round(Number(thr)), 0, 100);

  if (t <= 0) return 100;
  if (r === t) return 50;

  if (r > t){
    return clamp(Math.round(50 + ((r - t) / Math.max(1, 100 - t)) * 50), 0, 100);
  }

  return clamp(Math.round((r / Math.max(1, t)) * 50), 0, 100);
}

function colorForPerceived(p){
  const x = clamp(Number(p), 0, 100);

  if (x <= 2) return 'hsl(5 75% 30%)';
  if (x >= 98) return 'hsl(120 60% 28%)';

  const h = x <= 50
    ? 10 + (45 - 10) * (x / 50)
    : 45 + (120 - 45) * ((x - 50) / 50);

  return `hsl(${h.toFixed(0)} 70% 45%)`;
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
   SMALL UI HELPERS
===================================================================== */
function ensureFieldsHelper(){
  let el = document.getElementById('frFieldsCountHelper');
  if (el) return el;

  const grid = $('fieldsGrid');
  if (!grid?.parentElement) return null;

  el = document.createElement('div');
  el.id = 'frFieldsCountHelper';
  el.className = 'fr-fields-helper muted';
  el.style.marginTop = '6px';
  el.style.fontSize = '12px';

  grid.insertAdjacentElement('beforebegin', el);
  return el;
}

function updateFieldsCount(showing, total){
  const el = ensureFieldsHelper();
  if (!el) return;
  el.textContent = `Showing ${showing} of ${total} field${total === 1 ? '' : 's'}`;
}

function setEmptyMessage(showing){
  const el = $('emptyMsg');
  if (!el) return;
  el.style.display = showing ? 'none' : 'block';
}

function showLoadingTiles(){
  const wrap = $('fieldsGrid');
  if (!wrap) return;

  wrap.innerHTML = `
    <div class="fr-fields-loading" style="padding:16px;border:1px solid var(--border);border-radius:14px;">
      <div style="font-weight:900;">Loading field readiness...</div>
      <div class="muted" style="font-size:12px;margin-top:4px;">
        Reading field_conditions_current.
      </div>
    </div>
  `;
}

function setSelectedTileClass(state, fieldId){
  try{
    document.querySelectorAll('.tile.fv-selected').forEach(el=>{
      el.classList.remove('fv-selected');
    });

    const cur = document.querySelector(
      `.tile[data-field-id="${CSS.escape(String(fieldId || ''))}"]`
    );

    if (cur) cur.classList.add('fv-selected');
    if (state) state._selectedTileId = String(fieldId || '');
  }catch(_){}
}

function setSelectedField(state, fieldId){
  state.selectedFieldId = fieldId;
  setSelectedTileClass(state, fieldId);

  try{
    document.dispatchEvent(
      new CustomEvent('fr:selected-field-changed', {
        detail:{ fieldId }
      })
    );
  }catch(_){}
}

/* =====================================================================
   MRMS RAIN
===================================================================== */
async function getMrmsRainResultForField(state, fieldId, range){
  try{
    const doc = await loadFieldMrmsDoc(state, String(fieldId), { force:true });
    return mrmsRainInRange(doc, range);
  }catch(_){
    return { ready:false, inches:null };
  }
}

function rainTileText(res){
  if (!res || res.ready !== true) return 'Processing Data';
  return `${Number(res.inches || 0).toFixed(2)} in`;
}

/* =====================================================================
   TILE RENDER
===================================================================== */
function buildWaitingTile(f, state, thr){
  const tile = document.createElement('div');
  tile.className = 'tile fv-swipe-item';
  tile.style.transition =
    'transform .16s ease, box-shadow .16s ease, border-color .16s ease';

  if (String(state.selectedFieldId) === String(f.id)){
    tile.classList.add('fv-selected');
    tile.style.border = '2px solid rgba(46,125,50,.95)';
    tile.style.boxShadow = '0 0 0 2px rgba(46,125,50,.14)';
    tile.style.transform = 'translateY(-2px)';
  }

  tile.dataset.fieldId = f.id;
  tile.setAttribute('data-field-id', f.id);

  const grad = gradientForThreshold(thr);
  const thrPos = markerLeftCSS(thr);

  tile.innerHTML = `
    <div class="tile-top" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:nowrap;gap:10px;width:100%;min-width:0;">
      <div class="name" title="${esc(f.name || 'Field')}" style="flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:900;">
        ${esc(f.name || 'Field')}
      </div>

      <div class="readiness-pill" style="background:color-mix(in srgb, var(--surface) 86%, #8b949e 14%);color:var(--text);flex:0 0 auto;white-space:nowrap;">
        Field Readiness —
      </div>
    </div>

    <p class="subline">
      Rain (range): <span class="mono">Processing Data</span>
    </p>

    <div class="gauge-wrap">
      <div class="chips">
        <div class="chip wet">Wet</div>
        <div class="chip readiness">Readiness</div>
      </div>

      <div class="gauge" style="background:${grad};opacity:.82;">
        <div class="thr" style="left:${thrPos};"></div>
        <div class="marker" style="left:50%;opacity:.45;"></div>

        <div class="badge" style="left:50%;background:color-mix(in srgb, var(--surface) 88%, #8b949e 12%);color:var(--text);">
          Loading…
        </div>
      </div>

      <div class="etaSlot"></div>
    </div>
  `;

  return tile;
}

function buildReadyTile(f, state, rec, rainText, thr, etaInfo, opKey){
  const readiness = safeInt(rec.readiness, 0);
  const leftPos = markerLeftCSS(readiness);
  const thrPos = markerLeftCSS(thr);

  const perceived = perceivedFromThreshold(readiness, thr);
  const pillBg = colorForPerceived(perceived);
  const grad = gradientForThreshold(thr);

  const tile = document.createElement('div');
  tile.className = 'tile fv-swipe-item';
  tile.dataset.fieldId = f.id;
  tile.setAttribute('data-field-id', f.id);

  if (String(state.selectedFieldId) === String(f.id)){
    tile.classList.add('fv-selected');
  }

const etaText =
  Number(readiness) >= Number(thr)
    ? ''
    : `ETA to operational threshold ${
        safeStr(
          etaInfo?.text ||
          ETA_UNAVAILABLE_TEXT
        )
      }`;

  tile.innerHTML = `
    <div class="tile-top" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:nowrap;gap:10px;width:100%;min-width:0;">
      <div class="name" title="${esc(getFieldName(f, rec))}" style="flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:900;">
        ${esc(getFieldName(f, rec))}
      </div>

      <div class="readiness-pill" style="background:${pillBg};color:#fff;flex:0 0 auto;white-space:nowrap;">
        Field Readiness ${readiness}
      </div>
    </div>

    <p class="subline">
      Rain (range): <span class="mono">${esc(rainText)}</span>
    </p>

    <div class="gauge-wrap">
      <div class="chips">
        <div class="chip wet">Wet</div>
        <div class="chip readiness">Readiness</div>
      </div>

      <div class="gauge" style="background:${grad};">
        <div class="thr" style="left:${thrPos};"></div>
        <div class="marker" style="left:${leftPos};"></div>

        <div class="badge" style="left:${leftPos};background:${pillBg};color:#fff;border:1px solid rgba(255,255,255,.18);">
          Field Readiness ${readiness}
        </div>
      </div>

      <div class="etaSlot">
        ${
          etaText
            ? `
              <button
                class="etaText fvEtaHelpBtn"
                type="button"
                data-field-id="${esc(f.id)}"
                style="
                  margin-top:8px;
                  font-size:12px;
                  opacity:.86;
                  text-align:center;
                  color:var(--text);
                  background:transparent;
                  border:0;
                  padding:0;
                  width:100%;
                  cursor:pointer;
                  text-decoration:underline;
                  text-underline-offset:3px;
                "
              >
                ${esc(etaText)}
              </button>
            `
            : ''
        }
      </div>
    </div>
  `;

  const etaBtn = tile.querySelector('.fvEtaHelpBtn');

  if (etaBtn){
    etaBtn.addEventListener('click', e=>{
      e.preventDefault();
      e.stopPropagation();

      try{
        document.dispatchEvent(
          new CustomEvent('fr:eta-help', {
            detail:{
              fieldId:f.id,
              fieldName:getFieldName(f, rec),
              opKey,
              threshold:thr,
              readinessNow:readiness,
              etaText,
              horizonHours:ETA_HORIZON_HOURS,
              etaDays:Array.isArray(etaInfo?.etaDays) ? etaInfo.etaDays : []
            }
          })
        );
      }catch(err){
        console.warn('[FieldReadiness] ETA helper dispatch failed:', err);
      }
    });
  }

  return tile;
}

function wireTileInteractions(state, tile, fieldId){
  tile.addEventListener('click', ()=>{
    selectField(state, fieldId);
  });

  tile.addEventListener('dblclick', async (e)=>{
    e.preventDefault();
    e.stopPropagation();

    setSelectedField(state, fieldId);
    ensureSelectedParamsToSliders(state);

    if (!canEdit(state)) return;

    try{
      await fetchAndHydrateFieldParams(state, fieldId);
    }catch(_){}

    await refreshDetailsOnly(state);
    openQuickView(state, fieldId);
  });
}

function isCoarsePointer(){
  try{
    return window.matchMedia &&
      window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  }catch(_){
    return false;
  }
}

function initFallbackSwipeOnTiles(state, wrap, opts){
  try{
    if (!wrap || !isCoarsePointer()) return;

    const tiles = Array.from(wrap.querySelectorAll('.tile[data-field-id]'));

    for (const tile of tiles){
      if (tile.dataset.fvSwipeWired === '1') continue;
      tile.dataset.fvSwipeWired = '1';

      let startX = 0;
      let startY = 0;

      tile.addEventListener('touchstart', e=>{
        const t = e.touches && e.touches[0];
        if (!t) return;
        startX = t.clientX;
        startY = t.clientY;
      }, { passive:true });

      tile.addEventListener('touchend', async e=>{
        const t = e.changedTouches && e.changedTouches[0];
        if (!t) return;

        const dx = t.clientX - startX;
        const dy = t.clientY - startY;

        if (dx <= -42 && Math.abs(dx) > Math.abs(dy) * 1.15){
          const fid = tile.getAttribute('data-field-id');
          if (fid && opts?.onDetails){
            await opts.onDetails(fid);
          }
        }
      }, { passive:true });
    }
  }catch(_){}
}

/* =====================================================================
   DETAILS RENDER
===================================================================== */
function setPanelText(id, txt){
  const el = $(id);
  if (el) el.textContent = String(txt ?? '—');
}

function renderTraceRows(tbody, rowsOrGroups, type){
  if (!tbody) return;

  tbody.innerHTML = '';

  const groups = normalizeGroupedInput(rowsOrGroups);
  const hasRows = groups.some(g=> Array.isArray(g.rows) && g.rows.length);

  if (!hasRows){
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="muted">
          No ${esc(type)} trace data.
        </td>
      </tr>
    `;
    return;
  }

  for (const group of groups){
    const rows = Array.isArray(group.rows) ? group.rows : [];
    if (!rows.length) continue;

    appendGroupHeader(tbody, group.label, 7);

    for (const r of rows){

      const tr = document.createElement('tr');

      const add =
        type === 'surface'
          ? r.trace.surfaceAdd
          : r.trace.addRain;

      const loss =
        type === 'surface'
          ? r.trace.surfaceLoss
          : r.trace.loss;

      const end =
        type === 'surface'
          ? r.trace.surface
          : r.trace.storage;

      const infilMult =
        Number.isFinite(Number(r?.trace?.infilMult))
          ? Number(r.trace.infilMult)
          : null;

      tr.innerHTML = `
        <td class="mono">${esc(r.dateISO)}</td>
        <td class="right mono">${Number(r.weather.rainUsedInMath ?? 0).toFixed(2)}</td>
        <td class="right mono">${infilMult != null ? infilMult.toFixed(3) : '—'}</td>
        <td class="right mono">${Number(add ?? 0).toFixed(2)}</td>
        <td class="right mono">${Number(r.dryPwrBreakdown.dryPwr ?? 0).toFixed(2)}</td>
        <td class="right mono">${Number(loss ?? 0).toFixed(2)}</td>
        <td class="right mono">${Number(end ?? 0).toFixed(2)}</td>
      `;

      tbody.appendChild(tr);
    }
  }
}

function renderDryRows(tbody, rowsOrGroups){
  if (!tbody) return;
  tbody.innerHTML = '';

  const groups = normalizeGroupedInput(rowsOrGroups);
  const hasRows = groups.some(g=> Array.isArray(g.rows) && g.rows.length);

  if (!hasRows){
    tbody.innerHTML = `<tr><td colspan="15" class="muted">No DryPwr rows.</td></tr>`;
    return;
  }

  for (const group of groups){
    const rows = Array.isArray(group.rows) ? group.rows : [];
    if (!rows.length) continue;

    appendGroupHeader(tbody, group.label, 15);

    for (const r of rows){
      const d = r.dryPwrBreakdown;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="mono">${esc(r.dateISO)}</td>
        <td class="right mono">${Math.round(Number(d.temp ?? 0))}</td>
        <td class="right mono">${Number(d.tempN ?? 0).toFixed(2)}</td>
        <td class="right mono">${Math.round(Number(d.wind ?? 0))}</td>
        <td class="right mono">${Number(d.windN ?? 0).toFixed(2)}</td>
        <td class="right mono">${Math.round(Number(d.rh ?? 0))}</td>
        <td class="right mono">${Number(d.rhN ?? 0).toFixed(2)}</td>
        <td class="right mono">${Math.round(Number(d.solar ?? 0))}</td>
        <td class="right mono">${Number(d.solarN ?? 0).toFixed(2)}</td>
        <td class="right mono">${Number(d.vpd ?? 0).toFixed(2)}</td>
        <td class="right mono">${Number(d.vpdN ?? 0).toFixed(2)}</td>
        <td class="right mono">${Math.round(Number(d.cloud ?? 0))}</td>
        <td class="right mono">${Number(d.cloudN ?? 0).toFixed(2)}</td>
        <td class="right mono">${Number(d.raw ?? 0).toFixed(2)}</td>
        <td class="right mono">${Number(d.dryPwr ?? 0).toFixed(2)}</td>
      `;

      tbody.appendChild(tr);
    }
  }
}

function renderWeatherRows(tbody, rowsOrGroups){
  if (!tbody) return;
  tbody.innerHTML = '';

  const groups = normalizeGroupedInput(rowsOrGroups);
  const hasRows = groups.some(g=> Array.isArray(g.rows) && g.rows.length);

  if (!hasRows){
    tbody.innerHTML = `<tr><td colspan="9" class="muted">No weather rows.</td></tr>`;
    return;
  }

  for (const group of groups){
    const rows = Array.isArray(group.rows) ? group.rows : [];
    if (!rows.length) continue;

    appendGroupHeader(tbody, group.label, 9);

    for (const r of rows){
      const w = r.weather;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="mono">${esc(r.dateISO)}</td>
        <td class="right mono">${Number(w.rainUsedInMath ?? 0).toFixed(2)}</td>
        <td class="right mono">${Math.round(Number(w.tempF ?? 0))}</td>
        <td class="right mono">${Math.round(Number(w.windMph ?? 0))}</td>
        <td class="right mono">${Math.round(Number(w.rh ?? 0))}</td>
        <td class="right mono">${Math.round(Number(w.solarWm2 ?? 0))}</td>
        <td class="right mono">${Number(w.et0In ?? 0).toFixed(2)}</td>
        <td class="right mono">${Number(w.sm010 ?? 0).toFixed(3)}</td>
        <td class="right mono">${Math.round(Number(w.st010 ?? 0))}</td>
      `;

      tbody.appendChild(tr);
    }
  }
}

function renderMrmsPanelEmpty(){
  setPanelText('mrmsMeta', 'No MRMS data found for this field.');
  setPanelText('mrmsLatestHour', '—');
  setPanelText('mrmsLast24Total', '—');
  setPanelText('mrmsLast7dTotal', '—');
  setPanelText('mrmsUnits', 'mm');

  const hourly = $('mrmsHourlyRows');
  if (hourly){
    hourly.innerHTML = `<tr><td colspan="5" class="muted">No MRMS hourly data.</td></tr>`;
  }

  const daily = $('mrmsDailyRows');
  if (daily){
    daily.innerHTML = `<tr><td colspan="4" class="muted">No MRMS daily data.</td></tr>`;
  }
}

function mmToIn(mm){
  return Number(mm || 0) / 25.4;
}

function renderMrmsPanelFromDoc(doc){
  if (!doc){
    renderMrmsPanelEmpty();
    return;
  }

  const hourly = Array.isArray(doc.mrmsHourlyLast24) ? doc.mrmsHourlyLast24 : [];
  const daily = Array.isArray(doc.mrmsDailySeries30d) ? doc.mrmsDailySeries30d : [];
  const latest = safeObj(doc.mrmsHourlyLatest) || {};
  const meta = safeObj(doc.mrmsHistoryMeta) || {};

  const latestMm =
    safeNum(latest.weightedHourlyRainMm) ??
    safeNum(latest.rainMm) ??
    0;

  const last24Mm = hourly.reduce((a, r)=> a + Number(r?.rainMm || 0), 0);
  const last7Mm = daily.slice(-7).reduce((a, r)=> a + Number(r?.rainMm || 0), 0);

  setPanelText(
    'mrmsMeta',
    `Product: ${latest.selectedProduct || meta.latestSelectedProduct || '—'} • Daily rows: ${daily.length} • Hourly rows: ${hourly.length}`
  );

  setPanelText('mrmsLatestHour', `${latestMm.toFixed(2)} mm`);
  setPanelText('mrmsLast24Total', `${mmToIn(last24Mm).toFixed(2)} in`);
  setPanelText('mrmsLast7dTotal', `${mmToIn(last7Mm).toFixed(2)} in`);
  setPanelText('mrmsUnits', 'mm');

  const hourlyBody = $('mrmsHourlyRows');
  if (hourlyBody){
    hourlyBody.innerHTML = '';

    if (!hourly.length){
      hourlyBody.innerHTML = `<tr><td colspan="5" class="muted">No MRMS hourly data.</td></tr>`;
    } else {
      for (const r of hourly){
        const rawTime = r.fileTimestampUtc || r.hourKey || '';
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="mono">${esc(formatCentralTime(rawTime))}</td>
          <td class="right mono">${Number(r.rainMm || 0).toFixed(2)}</td>
          <td class="mono">${esc(r.selectedProduct || '—')}</td>
          <td class="mono">${esc(r.mode || '—')}</td>
          <td class="mono">${esc(r.source || '—')}</td>
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
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="mono">${esc(r.dateISO || '—')}</td>
          <td class="right mono">${Math.round(Number(r.hoursCount || 0))}</td>
          <td class="right mono">${Number(r.rainMm || 0).toFixed(2)}</td>
          <td class="right mono">${mmToIn(r.rainMm || 0).toFixed(2)}</td>
        `;
        dailyBody.appendChild(tr);
      }
    }
  }
}

async function renderDetailsForSelected(state){
  await loadFieldConditionsCurrent(state, { force:false });

  const f =
    (state.fields || [])
      .find(x => x.id === state.selectedFieldId);

  if (!f) return;

  const rec = getCurrentRecord(state, f.id);

  const rows =
    await loadDailyRowsForField(
      state,
      f.id,
      { force:false }
    );

  const todayISO = todayISOChicago();

  const historyRows =
    rows.filter(r => r.dateISO < todayISO).slice(-15);

  const currentRows =
    rows.filter(r => r.dateISO === todayISO);

  const forecastRows =
    rows.filter(r => r.dateISO > todayISO);

  const currentDay =
    currentRows[currentRows.length - 1] || null;

  setPanelText(
    'detailsSoilMoisture',
    currentDay?.final?.storageFinal != null
      ? Number(currentDay.final.storageFinal).toFixed(2)
      : (
          rec?.storageFinal != null
            ? Number(rec.storageFinal).toFixed(2)
            : '—'
        )
  );

  setPanelText(
    'detailsSurfaceWetness',
    currentDay?.final?.surfaceFinal != null
      ? Number(currentDay.final.surfaceFinal).toFixed(2)
      : (
          rec?.surfaceFinal != null
            ? Number(rec.surfaceFinal).toFixed(2)
            : '—'
        )
  );

  const meta = $('betaInputsMeta');

  if (meta){
    meta.innerHTML = rec
      ? `
        <div style="display:grid;gap:7px;padding:12px;border:1px solid var(--border);border-radius:14px;background:color-mix(in srgb, var(--surface) 92%, var(--text) 8%);">
          <div style="font-weight:900;font-size:15px;margin-bottom:2px;">
            Field Information
          </div>
          <div>• Field: ${esc(f.name || 'Unknown')}</div>
          <div>• Acres: ${Number(f.acres || 0).toFixed(1)}</div>
          <div>• County: ${esc(rec.county || f.county || '—')}</div>
          <div>• Readiness: ${esc(rec.readiness ?? '—')}</div>
          <div>• Updated: ${esc(formatCentralTime(rec.updatedAtISO || rec.computedAtISO))}</div>
        </div>
      `
      : `
        <div style="padding:12px;border:1px solid var(--border);border-radius:14px;">
          No field_conditions_current record found.
        </div>
      `;
  }

  const box = $('betaInputs');

  if (box){
    box.innerHTML = '';
  }

  renderTraceRows(
    $('soilTraceRows'),
    [
      {
        label:'15 Day History',
        rows:historyRows
      },
      {
        label:'Current Day + Forecasted Remaining Hours',
        rows:currentRows
      },
      {
        label:'Forecast Days',
        rows:forecastRows
      }
    ],
    'soil'
  );

  renderTraceRows(
    $('surfaceTraceRows'),
    [
      {
        label:'15 Day History',
        rows:historyRows
      },
      {
        label:'Current Day + Forecasted Remaining Hours',
        rows:currentRows
      },
      {
        label:'Forecast Days',
        rows:forecastRows
      }
    ],
    'surface'
  );

  renderDryRows(
    $('dryRows'),
    [
      {
        label:'15 Day History',
        rows:historyRows
      },
      {
        label:'Current Day',
        rows:currentRows
      }
    ]
  );

  renderWeatherRows(
    $('wxRows'),
    [
      {
        label:'15 Day History',
        rows:historyRows
      },
      {
        label:'Current Day',
        rows:currentRows
      }
    ]
  );

  try{
    const mrmsDoc =
      await loadFieldMrmsDoc(
        state,
        f.id,
        { force:true }
      );

    renderMrmsPanelFromDoc(mrmsDoc);
  }catch(_){
    renderMrmsPanelEmpty();
  }
}

/* =====================================================================
   RENDER CORE
===================================================================== */
async function renderTilesInternal(state){
  await loadFieldConditionsCurrent(state, { force:false });

  const wrap = $('fieldsGrid');
  if (!wrap) return;

  showLoadingTiles();

  const opKey = getCurrentOp();
  const thr = getThresholdForOp(state, opKey);
  const filtered = getFilteredFields(state);
  const pageSize = getEffectivePageSize(state);

  const range = parseRangeFromInput();
  const rainById = new Map();

  await Promise.all(
    filtered.map(async f=>{
      const res = await getMrmsRainResultForField(state, f.id, range);
      rainById.set(String(f.id), res);
    })
  );

  const sorted = sortFields(state, filtered, rainById);
  const show = pageSize === -1
    ? sorted
    : sorted.slice(0, pageSize);

  const dailyRowsById = new Map();

  await Promise.all(
    show.map(async f=>{
      const rows = await loadDailyRowsForField(state, f.id, { force:false });
      dailyRowsById.set(String(f.id), rows);
    })
  );

  const frag = document.createDocumentFragment();

  for (const f of show){
    const rec = getCurrentRecord(state, f.id);
    const rainText = rainTileText(rainById.get(String(f.id)));

    let etaInfo = null;

    if (rec && Number.isFinite(Number(rec.readiness))){
      const dailyRows = dailyRowsById.get(String(f.id)) || [];
      etaInfo = getTileEtaInfo(dailyRows, rec.readiness, thr);
    }

    const tile = rec && Number.isFinite(Number(rec.readiness))
      ? buildReadyTile(f, state, rec, rainText, thr, etaInfo, opKey)
      : buildWaitingTile(f, state, thr);

    wireTileInteractions(state, tile, f.id);
    frag.appendChild(tile);
  }

  wrap.replaceChildren(frag);

  updateFieldsCount(show.length, filtered.length);
  setEmptyMessage(show.length);

  try{
    await initSwipeOnTiles(state, {
      onDetails: async fieldId=>{
        if (!canEdit(state)) return;
        await openQuickView(state, fieldId);
      }
    });
  }catch(_){}

  initFallbackSwipeOnTiles(state, wrap, {
    onDetails: async fieldId=>{
      if (!canEdit(state)) return;
      await openQuickView(state, fieldId);
    }
  });
}

async function renderAll(state){
  await renderTilesInternal(state);
  await renderDetailsForSelected(state);
}

/* =====================================================================
   PUBLIC EXPORTS
===================================================================== */
export async function ensureModelWeatherModules(state){
  return true;
}

export async function renderTiles(state){
  await renderAll(state);
}

export async function renderDetails(state){
  await renderDetailsForSelected(state);
}

export async function refreshAll(state){
  state._fieldConditionsLoadedAt = 0;
  await renderAll(state);
}

export async function refreshDetailsOnly(state){
  await renderDetailsForSelected(state);
}

export async function selectField(state, id){
  const f =
    (state.fields || []).find(
      x => String(x.id) === String(id)
    );

  if (!f) return;

  state.selectedFieldId = id;

  try{
    document
      .querySelectorAll('.tile.fv-selected')
      .forEach(el=>{
        el.classList.remove('fv-selected');
      });

    const tile =
      document.querySelector(
        `.tile[data-field-id="${CSS.escape(String(id))}"]`
      );

    if (tile){
      tile.classList.add('fv-selected');
    }
  }catch(_){}

  try{
    ensureSelectedParamsToSliders(state);
  }catch(_){}

  try{
    state._fieldConditionsLoadedAt = 0;

    await loadFieldConditionsCurrent(
      state,
      { force:true }
    );
  }catch(e){
    console.warn(
      '[FieldReadiness] force refresh failed:',
      e
    );
  }

  try{
    await fetchAndHydrateFieldParams(
      state,
      id
    );
  }catch(_){}

  try{
    await renderDetailsForSelected(state);
  }catch(e){
    console.warn(
      '[FieldReadiness] renderDetailsForSelected failed:',
      e
    );
  }

  try{
    document
      .querySelectorAll('.tile.fv-selected')
      .forEach(el=>{
        el.classList.remove('fv-selected');
      });

    const tile =
      document.querySelector(
        `.tile[data-field-id="${CSS.escape(String(id))}"]`
      );

    if (tile){
      tile.classList.add('fv-selected');

      tile.scrollIntoView({
        behavior:'smooth',
        block:'nearest'
      });
    }
  }catch(_){}

  try{
    const tile =
      document.querySelector(
        `.tile[data-field-id="${CSS.escape(String(id))}"]`
      );

    if (tile){
      tile.classList.add('fv-selected');
    }
  }catch(_){}
}

/* =====================================================================
   GLOBAL LISTENERS
===================================================================== */
(function wireGlobalListenersOnce(){
  try{
    if (window.__FV_FR_CLEAN_RENDER_WIRED__) return;
    window.__FV_FR_CLEAN_RENDER_WIRED__ = true;

    document.addEventListener('fr:tile-refresh', async e=>{
      try{
        const state = window.__FV_FR;
        if (!state) return;
        await refreshAll(state);
      }catch(_){}
    });

    document.addEventListener('fr:details-refresh', async e=>{
      try{
        const state = window.__FV_FR;
        if (!state) return;

        const fid = e?.detail?.fieldId;
        if (fid) setSelectedField(state, fid);

        await refreshDetailsOnly(state);
      }catch(_){}
    });

    document.addEventListener('fr:soft-reload', async ()=>{
      try{
        const state = window.__FV_FR;
        if (!state) return;

        state._fieldConditionsLoadedAt = 0;
        state._dailyRowsLoadedAt = {};
        state.dailyRowsByFieldId = {};

        await refreshAll(state);
      }catch(_){}
    });
    // =========================================================
    // ETA HELP POPUP
    // =========================================================
    document.addEventListener('fr:eta-help', e => {

      try{

        const d = e?.detail || {};

        const etaDays =
          Array.isArray(d.etaDays)
            ? d.etaDays
            : [];

        let rowsHtml = '';

        for (const day of etaDays){

          rowsHtml += `
            <tr>
              <td style="padding:6px 8px;">${day.day}</td>

              <td style="padding:6px 8px;">
                ${day.dateISO || '—'}
              </td>

              <td style="padding:6px 8px;text-align:right;">
                ${Number(day.readinessStart || 0).toFixed(1)}
              </td>

              <td style="padding:6px 8px;text-align:right;">
                ${Number(day.readinessEnd || 0).toFixed(1)}
              </td>

              <td style="
                padding:6px 8px;
                text-align:right;
                color:${Number(day.readinessGain || 0) >= 0 ? '#2e7d32' : '#c62828'};
                font-weight:700;
              ">
                ${Number(day.readinessGain || 0).toFixed(2)}
              </td>

              <td style="padding:6px 8px;text-align:right;">
                ${Number(day.drydownPointsPerHour || 0).toFixed(3)}
              </td>

              <td style="padding:6px 8px;text-align:right;">
                ${Number(day.rainIn || 0).toFixed(2)}
              </td>
            </tr>
          `;
        }

        const existing =
          document.getElementById('fvEtaHelpModal');

        if (existing){
          existing.remove();
        }

        const modal = document.createElement('div');

        modal.id = 'fvEtaHelpModal';

        modal.innerHTML = `
          <div
            style="
              position:fixed;
              inset:0;
              background:rgba(0,0,0,.55);
              z-index:999999;
              display:flex;
              align-items:center;
              justify-content:center;
              padding:20px;
            "
          >

            <div
              style="
                width:min(1000px,95vw);
                max-height:90vh;
                overflow:auto;
                background:var(--surface);
                color:var(--text);
                border-radius:18px;
                border:1px solid var(--border);
                padding:18px;
                box-shadow:0 20px 50px rgba(0,0,0,.35);
              "
            >

              <div
                style="
                  display:flex;
                  justify-content:space-between;
                  align-items:center;
                  margin-bottom:14px;
                "
              >
                <div>
                  <div style="font-size:20px;font-weight:900;">
                    ETA Forecast Breakdown
                  </div>

                  <div style="margin-top:4px;opacity:.75;">
                    ${d.fieldName || 'Field'}
                  </div>
                </div>

                <button
                  id="fvEtaHelpClose"
                  style="
                    border:0;
                    background:#c62828;
                    color:#fff;
                    border-radius:10px;
                    padding:8px 12px;
                    cursor:pointer;
                    font-weight:700;
                  "
                >
                  Close
                </button>
              </div>

              <div style="margin-bottom:16px;">
                Current Readiness:
                <strong>${Number(d.readinessNow || 0).toFixed(1)}</strong>

                &nbsp;&nbsp;•&nbsp;&nbsp;

                Operational Threshold:
                <strong>${Number(d.threshold || 0).toFixed(0)}</strong>
              </div>

              <div style="overflow:auto;">

                <table
                  style="
                    width:100%;
                    border-collapse:collapse;
                    font-size:13px;
                  "
                >

                  <thead>
                    <tr style="background:rgba(255,255,255,.06);">
                      <th style="padding:8px;text-align:left;">Day</th>
                      <th style="padding:8px;text-align:left;">Date</th>
                      <th style="padding:8px;text-align:right;">Start</th>
                      <th style="padding:8px;text-align:right;">End</th>
                      <th style="padding:8px;text-align:right;">Gain</th>
                      <th style="padding:8px;text-align:right;">Pts/Hr</th>
                      <th style="padding:8px;text-align:right;">Rain</th>
                    </tr>
                  </thead>

                  <tbody>
                    ${rowsHtml}
                  </tbody>

                </table>

              </div>

            </div>

          </div>
        `;

        document.body.appendChild(modal);

        document
          .getElementById('fvEtaHelpClose')
          ?.addEventListener('click', ()=>{
            modal.remove();
          });

        modal.addEventListener('click', ev=>{
          if (ev.target === modal.firstElementChild){
            modal.remove();
          }
        });

      }catch(err){

        console.warn(
          '[FieldReadiness] ETA popup failed:',
          err
        );
      }

    });
     
    let searchTimer = null;

    document.addEventListener('input', e=>{
      try{
        if (e?.target?.id !== FIELD_SEARCH_INPUT_ID) return;

        if (searchTimer) clearTimeout(searchTimer);

        searchTimer = setTimeout(async ()=>{
          const state = window.__FV_FR;
          if (!state) return;
          await refreshAll(state);
        }, 120);
      }catch(_){}
    }, true);

  }catch(_){}
})();
