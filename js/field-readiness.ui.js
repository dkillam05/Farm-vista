/* =====================================================================
/Farm-vista/js/field-readiness.ui.js  (FULL FILE)
Rev: 2025-12-23f

FIXES (per Dane, after failed attempt):
✅ Countdown/status panel ALWAYS renders (auto-creates #calibCooldownMsg if missing)
✅ Do NOT change gauge geometry:
   - Threshold line stays at true operation threshold
   - Readiness marker stays at true readiness
✅ Only change color perception based on operation threshold:
   - pill color
   - gauge gradient
   - badge background (perception)
✅ Adjust slider UX:
   - slider remains anchored to readiness
   - wrong-direction movement blocked
   - label shows INTENSITY (0–100 distance from anchor), not raw slider value
===================================================================== */
'use strict';

import {
  summarizeAvailability,
  fetchWeatherForField,
  warmWeatherForFields,
  getWeatherSeriesForFieldId
} from '/Farm-vista/js/field-readiness.weather.js';

import {
  runField,
  etaFor,
  readinessColor,
  markerLeftCSS,
  modelClassFromRun
} from '/Farm-vista/js/field-readiness.model.js';

/* ---------- helpers ---------- */
const $ = id => document.getElementById(id);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round = (v, d=2) => {
  const p = Math.pow(10,d);
  return Math.round(v*p)/p;
};
function isGlobalCalLocked(){
  const nextMs = Number(state._nextAllowedMs || 0);
  return !!(nextMs && Date.now() < nextMs);
}
function esc(s){
  return String(s||'')
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'","&#039;");
}
function setErr(msg){
  const el = $('err');
  if (!el) return;
  if (!msg){ el.hidden = true; el.textContent=''; return; }
  el.hidden = false;
  el.textContent = msg;
}
function normalizeStatus(s){ return String(s||'').trim().toLowerCase(); }

function showModal(backdropId, on){
  const b = $(backdropId);
  if (b) b.classList.toggle('pv-hide', !on);

  // Guarantee cooldown panel renders whenever Adjust modal opens (no dependency on observers)
  if (backdropId === 'adjustBackdrop'){
    if (on){
      // Let the DOM paint first, then render the cooldown panel
      setTimeout(async ()=>{
        try{
          __ensureCooldownSlot();
          await loadCooldownFromFirestore();
          __renderCooldownCard();
          stopCooldownTicker();
          startCooldownTicker();
        }catch(e){
          console.warn('[FieldReadiness] cooldown render failed:', e);
        }
      }, 0);
    } else {
      stopCooldownTicker();
    }
  }
}

function on(id, ev, fn){
  const el = $(id);
  if (el) el.addEventListener(ev, fn);
}

/* ---------- threshold-centered color perception (COLORS ONLY) ---------- */
/**
 * Map a readiness value into a perceived 0..100 scale where the OP THRESHOLD
 * is treated as the perceptual midpoint (50). IMPORTANT:
 * - This is ONLY used to pick colors (pill/badge/gradient feel)
 * - DO NOT use this for positioning the marker/threshold lines.
 */
function perceivedFromThreshold(readiness, thr){
  const r = clamp(Math.round(Number(readiness)), 0, 100);
  const t = clamp(Math.round(Number(thr)), 0, 100);

  if (t <= 0) return 100;   // everything acceptable
  if (t >= 100) return Math.round((r/100)*50); // extremely strict

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
    h = 10 + (45 - 10) * frac;   // red -> amber
  } else {
    const frac = (x - 50) / 50;
    h = 45 + (120 - 45) * frac;  // amber -> green
  }
  const s = 70;
  const l = 38;
  return `hsl(${h.toFixed(0)} ${s}% ${l}%)`;
}

/**
 * Gauge gradient that “feels” correct for the current threshold:
 * - amber point sits at the TRUE threshold percent (thr%)
 * - so low thresholds yield mostly green
 * - high thresholds yield mostly red/amber
 *
 * Marker/threshold lines still sit at their TRUE values.
 */
function gradientForThreshold(thr){
  const t = clamp(Math.round(Number(thr)), 0, 100);
  const a = `${t}%`;
  return `linear-gradient(90deg,
    hsl(10 70% 38%) 0%,
    hsl(45 75% 38%) ${a},
    hsl(120 55% 34%) 100%
  )`;
}

/* ---------- constants ---------- */
const WX_BASE = 'https://farmvista-field-weather-300398089669.us-central1.run.app';
const WX_ENDPOINT = WX_BASE + '/api/open-meteo';
const WX_TTL_MS = 4 * 60 * 60 * 1000;
const WX_CACHE_PREFIX = 'fv_fr_wx_daily_cache_v2_';

const LOSS_SCALE = 0.55;
const ETA_MAX_HOURS = 72;

const LS_KEY = 'fv_dev_field_readiness_params_v2_0_100';
const LS_OP_KEY = 'fv_dev_field_readiness_op';
const LS_THR_KEY = 'fv_dev_field_readiness_thresholds_v1';
const LS_ADJ_LOG = 'fv_fr_adjust_log_v1';

// UI prefs
const LS_FARM_FILTER = 'fv_fr_farm_filter_v1';
const LS_PAGE_SIZE = 'fv_fr_page_size_v1';

const THR_COLLECTION = 'field_readiness_thresholds';
const THR_DOC_ID = 'default';
const ADJ_COLLECTION = 'field_readiness_adjustments';

// weights doc for cooldown UI
const WEIGHTS_COLLECTION = 'field_readiness_model_weights';
const WEIGHTS_DOC = 'default';

const OPS = [
  { key:'spring_tillage', label:'Spring tillage' },
  { key:'planting', label:'Planting' },
  { key:'spraying', label:'Spraying' },
  { key:'harvest', label:'Harvest' },
  { key:'fall_tillage', label:'Fall tillage' }
];

const EXTRA = {
  DRYPWR_VPD_W: 0.06,
  DRYPWR_CLOUD_W: 0.04,
  LOSS_ET0_W: 0.08,
  ADD_SM010_W: 0.10,
  STORAGE_CAP_SM010_W: 0.05
};

/* ---------- state ---------- */
const state = {
  weather30: [],
  weatherByFieldId: new Map(),
  wxInfoByFieldId: new Map(),
  seed: Date.now() % 1000000,
  selectedFieldId: null,
  lastRuns: new Map(),
  fields: [],
  farmsById: new Map(),
  perFieldParams: new Map(),
  thresholdsByOp: new Map(),
  fb: null,
  _thrSaveTimer: null,
  _renderTimer: null,

  // filters
  farmFilter: '__all__',
  pageSize: 25, // -1 means all

  // Adjust (GLOBAL)
  _adjFeel: null,               // 'wet' | 'dry' | null
  _cooldownTimer: null,
  _nextAllowedMs: 0,
  _lastAppliedMs: 0,
  _cooldownHours: 72,

  // slider anchoring
  _adjAnchorReadiness: null,    // integer 0..100

  // map
  _mapsPromise: null,
  _gmap: null,
  _gmarker: null
};

const wxCtx = {
  WX_ENDPOINT,
  WX_TTL_MS,
  WX_CACHE_PREFIX,
  timezone: 'America/Chicago',
  weatherByFieldId: state.weatherByFieldId,
  wxInfoByFieldId: state.wxInfoByFieldId,
  weather30: state.weather30
};

/* ---------- debounce ---------- */
function debounceRender(){
  if (state._renderTimer) return;
  state._renderTimer = setTimeout(()=>{
    state._renderTimer = null;
    renderTiles();
    renderDetails();
  }, 250);
}

/* ---------- firebase-init ---------- */
async function importFirebaseInit(){
  try{
    const mod = await import('/Farm-vista/js/firebase-init.js');
    state.fb = mod;
    if (mod && mod.ready) await mod.ready;
    return true;
  }catch(e){
    console.warn('[FieldReadiness] firebase-init import failed:', e);
    state.fb = null;
    return false;
  }
}
function getAPI(){
  const m = state.fb;
  if (m && m.getFirestore && m.collection && m.getDocs && m.query && m.where){
    return { kind:'module', ...m };
  }
  if (window.firebase && window.firebase.firestore){
    return { kind:'compat' };
  }
  return null;
}

/* ---------- thresholds per op ---------- */
function defaultThresholds(){
  return {
    spring_tillage: 70,
    planting: 70,
    spraying: 70,
    harvest: 70,
    fall_tillage: 70
  };
}
function applyThresholdObject(obj){
  const defs = defaultThresholds();
  state.thresholdsByOp = new Map();
  for (const op of OPS){
    const v = (obj && typeof obj === 'object') ? obj[op.key] : undefined;
    const num = isFinite(Number(v)) ? Number(v) : defs[op.key];
    state.thresholdsByOp.set(op.key, clamp(Math.round(num), 0, 100));
  }
}
function loadThresholdsFromLocal(){
  let parsed = null;
  try{
    const raw = localStorage.getItem(LS_THR_KEY);
    parsed = raw ? JSON.parse(raw) : null;
  }catch(_){ parsed = null; }
  applyThresholdObject(parsed);
}
function saveThresholdsToLocal(){
  try{
    const obj = {};
    for (const op of OPS) obj[op.key] = state.thresholdsByOp.get(op.key);
    localStorage.setItem(LS_THR_KEY, JSON.stringify(obj));
  }catch(_){}
}
async function loadThresholdsFromFirestore(){
  const api = getAPI();
  if (!api || api.kind === 'compat') return false;
  try{
    const db = api.getFirestore();
    const ref = api.doc(db, THR_COLLECTION, THR_DOC_ID);
    const snap = await api.getDoc(ref);
    if (snap && snap.exists && snap.exists()){
      const data = snap.data() || {};
      const thr = data.thresholds || data;
      applyThresholdObject(thr);
      saveThresholdsToLocal();
      return true;
    }
    return false;
  }catch(e){
    console.warn('[FieldReadiness] thresholds read failed:', e);
    return false;
  }
}
async function saveThresholdsToFirestoreNow(){
  const api = getAPI();
  if (!api || api.kind === 'compat') return;

  try{
    const db = api.getFirestore();
    const auth = api.getAuth ? api.getAuth() : null;
    const user = auth && auth.currentUser ? auth.currentUser : null;

    const obj = {};
    for (const op of OPS) obj[op.key] = state.thresholdsByOp.get(op.key);

    const ref = api.doc(db, THR_COLLECTION, THR_DOC_ID);
    await api.setDoc(ref, {
      thresholds: obj,
      updatedAt: api.serverTimestamp ? api.serverTimestamp() : new Date().toISOString(),
      updatedBy: user ? (user.email || user.uid || null) : null
    }, { merge:true });
  }catch(e){
    console.warn('[FieldReadiness] thresholds save failed:', e);
  }
}
function scheduleThresholdSave(){
  try{ if (state._thrSaveTimer) clearTimeout(state._thrSaveTimer); }catch(_){}
  state._thrSaveTimer = setTimeout(async ()=>{
    saveThresholdsToLocal();
    await saveThresholdsToFirestoreNow();
  }, 600);
}
function getCurrentOp(){
  const opSel = $('opSel');
  const key = String(opSel ? opSel.value : OPS[0].key);
  return OPS.find(o=>o.key===key) ? key : OPS[0].key;
}
function getThresholdForOp(opKey){
  const v = state.thresholdsByOp.get(opKey);
  return isFinite(Number(v)) ? Number(v) : 70;
}

/* ---------- per-field params (local safe default) ---------- */
function loadParamsFromLocal(){
  state.perFieldParams = new Map();
  try{
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return;
    for (const [k,v] of Object.entries(obj)){
      if (!v || typeof v !== 'object') continue;
      state.perFieldParams.set(k, {
        soilWetness: clamp(Number(v.soilWetness ?? 60), 0, 100),
        drainageIndex: clamp(Number(v.drainageIndex ?? 45), 0, 100)
      });
    }
  }catch(_){}
}
function saveParamsToLocal(){
  try{
    const obj = {};
    for (const [k,v] of state.perFieldParams.entries()){
      obj[k] = { soilWetness:v.soilWetness, drainageIndex:v.drainageIndex };
    }
    localStorage.setItem(LS_KEY, JSON.stringify(obj));
  }catch(_){}
}
function getFieldParams(fieldId){
  const p = state.perFieldParams.get(fieldId);
  if (p) return p;
  const def = { soilWetness:60, drainageIndex:45 };
  state.perFieldParams.set(fieldId, def);
  return def;
}
function ensureSelectedParamsToSliders(){
  if (!state.selectedFieldId) return;
  const p = getFieldParams(state.selectedFieldId);
  const a = $('soilWet'), b = $('drain');
  if (a) a.value = String(p.soilWetness);
  if (b) b.value = String(p.drainageIndex);
}
function hydrateParamsFromFieldDoc(field){
  if (!field) return;
  const cur = getFieldParams(field.id);
  if (isFinite(field.soilWetness)) cur.soilWetness = clamp(Number(field.soilWetness), 0, 100);
  if (isFinite(field.drainageIndex)) cur.drainageIndex = clamp(Number(field.drainageIndex), 0, 100);
  state.perFieldParams.set(field.id, cur);
}

/* ---------- UI prefs ---------- */
function loadFarmFilterDefault(){
  try{ state.farmFilter = String(localStorage.getItem(LS_FARM_FILTER) || '__all__') || '__all__'; }
  catch(_){ state.farmFilter='__all__'; }
  const sel = $('farmSel');
  if (sel) sel.value = state.farmFilter;
}
function saveFarmFilterDefault(){
  const sel = $('farmSel');
  const v = String(sel ? sel.value : '__all__') || '__all__';
  state.farmFilter = v;
  try{ localStorage.setItem(LS_FARM_FILTER, v); }catch(_){}
}
function loadPageSizeDefault(){
  let raw = '25';
  try{ raw = String(localStorage.getItem(LS_PAGE_SIZE) || '25'); }catch(_){ raw='25'; }
  state.pageSize = (raw === '__all__') ? -1 : (isFinite(Number(raw)) ? clamp(Math.round(Number(raw)), 1, 10000) : 25);
  const sel = $('pageSel');
  if (sel) sel.value = (state.pageSize === -1) ? '__all__' : String(state.pageSize);
}
function savePageSizeDefault(){
  const sel = $('pageSel');
  const raw = String(sel ? sel.value : '25');
  state.pageSize = (raw === '__all__') ? -1 : (isFinite(Number(raw)) ? clamp(Math.round(Number(raw)), 1, 10000) : 25);
  try{ localStorage.setItem(LS_PAGE_SIZE, raw); }catch(_){}
}
function renderFarmFilterOptions(){
  const sel = $('farmSel');
  if (!sel) return;

  const used = new Map();
  for (const f of state.fields){
    const id = String(f.farmId||'').trim();
    if (!id) continue;
    used.set(id, state.farmsById.get(id) || id);
  }

  const keep = state.farmFilter || '__all__';

  sel.innerHTML = '';
  const oAll = document.createElement('option');
  oAll.value = '__all__';
  oAll.textContent = 'All';
  sel.appendChild(oAll);

  const ids = Array.from(used.keys()).sort((a,b)=>{
    const na = String(used.get(a)||a);
    const nb = String(used.get(b)||b);
    return na.localeCompare(nb, undefined, {numeric:true, sensitivity:'base'});
  });

  for (const id of ids){
    const o = document.createElement('option');
    o.value = id;
    o.textContent = String(used.get(id));
    sel.appendChild(o);
  }

  const ok = (keep === '__all__') || ids.includes(keep);
  sel.value = ok ? keep : '__all__';
  state.farmFilter = sel.value;
}

/* ---------- fields/firestore ---------- */
function extractFieldDoc(docId, d){
  const loc = d.location || {};
  const lat = Number(loc.lat);
  const lng = Number(loc.lng);
  const soilWetness = Number(d.soilWetness);
  const drainageIndex = Number(d.drainageIndex);
  return {
    id: docId,
    name: String(d.name||''),
    county: String(d.county||''),
    state: String(d.state||''),
    farmId: String(d.farmId||''),
    status: String(d.status||''),
    tillable: Number(d.tillable||0),
    location: (isFinite(lat) && isFinite(lng)) ? { lat, lng } : null,
    soilWetness: isFinite(soilWetness) ? soilWetness : null,
    drainageIndex: isFinite(drainageIndex) ? drainageIndex : null
  };
}

async function loadFarmsOptional(){
  const api = getAPI();
  if (!api || api.kind === 'compat') return;
  try{
    const db = api.getFirestore();
    const snap = await api.getDocs(api.collection(db,'farms'));
    const map = new Map();
    snap.forEach(doc=>{
      const d = doc.data() || {};
      if (d && d.name) map.set(doc.id, String(d.name));
    });
    state.farmsById = map;
  }catch(_){}
}

async function loadFields(){
  const api = getAPI();
  if (!api){
    setErr('Firestore helpers not found.');
    state.fields = [];
    renderTiles();
    return;
  }

  try{
    let rawDocs = [];

    if (api.kind !== 'compat'){
      const db = api.getFirestore();
      const q = api.query(api.collection(db,'fields'), api.where('status','==','active'));
      const snap = await api.getDocs(q);
      snap.forEach(doc=> rawDocs.push({ id: doc.id, data: doc.data() || {} }));
      if (rawDocs.length === 0){
        const snap2 = await api.getDocs(api.collection(db,'fields'));
        snap2.forEach(doc=> rawDocs.push({ id: doc.id, data: doc.data() || {} }));
      }
    } else {
      const db = window.firebase.firestore();
      let snap = await db.collection('fields').where('status','==','active').get();
      snap.forEach(doc=> rawDocs.push({ id: doc.id, data: doc.data() || {} }));
      if (rawDocs.length === 0){
        snap = await db.collection('fields').get();
        snap.forEach(doc=> rawDocs.push({ id: doc.id, data: doc.data() || {} }));
      }
    }

    const arr = [];
    for (const r of rawDocs){
      const f = extractFieldDoc(r.id, r.data);
      if (normalizeStatus(f.status) !== 'active') continue;
      if (!f.location) continue;
      arr.push(f);
      hydrateParamsFromFieldDoc(f);
    }

    arr.sort((a,b)=> String(a.name).localeCompare(String(b.name), undefined, {numeric:true, sensitivity:'base'}));
    state.fields = arr;
    saveParamsToLocal();

    if (!state.selectedFieldId || !state.fields.find(x=>x.id===state.selectedFieldId)){
      state.selectedFieldId = state.fields.length ? state.fields[0].id : null;
    }

    const empty = $('emptyMsg');
    if (empty) empty.style.display = state.fields.length ? 'none' : 'block';

    ensureSelectedParamsToSliders();

    await warmWeatherForFields(state.fields, wxCtx, { force:false, onEach:debounceRender });

    renderFarmFilterOptions();
    renderTiles();
    renderDetails();
  }catch(e){
    setErr(`Failed to load fields: ${e.message}`);
    state.fields = [];
    const empty = $('emptyMsg');
    if (empty) empty.style.display = 'block';
    renderTiles();
  }
}

/* ---------- range helpers ---------- */
function parseRangeFromInput(){
  const inp = $('jobRangeInput');
  const raw = String(inp ? inp.value : '').trim();
  if (!raw) return { start:null, end:null };

  const parts = raw.split('–').map(s=>s.trim());
  if (parts.length === 2){
    const a = new Date(parts[0]);
    const b = new Date(parts[1]);
    if (isFinite(a.getTime()) && isFinite(b.getTime())){
      a.setHours(0,0,0,0);
      b.setHours(23,59,59,999);
      return { start:a, end:b };
    }
  }

  const d = new Date(raw);
  if (isFinite(d.getTime())){
    d.setHours(0,0,0,0);
    const e = new Date(d);
    e.setHours(23,59,59,999);
    return { start:d, end:e };
  }

  return { start:null, end:null };
}
function isDateInRange(dateISO, range){
  if (!range || !range.start || !range.end) return true;
  const d = new Date(dateISO + 'T12:00:00');
  return d >= range.start && d <= range.end;
}
function rainInRange(run, range){
  if (!run || !run.rows) return 0;
  let sum = 0;
  for (const r of run.rows){
    if (isDateInRange(r.dateISO, range)) sum += Number(r.rainInAdj||0);
  }
  return round(sum, 2);
}
function sortFields(fields, runsById){
  const sel = $('sortSel');
  const mode = String(sel ? sel.value : 'name_az');
  const range = parseRangeFromInput();
  const collator = new Intl.Collator(undefined, { numeric:true, sensitivity:'base' });
  const arr = fields.slice();

  arr.sort((a,b)=>{
    const ra = runsById.get(a.id);
    const rb = runsById.get(b.id);

    const nameA = `${a.name||''}`;
    const nameB = `${b.name||''}`;

    const readyA = ra ? ra.readinessR : 0;
    const readyB = rb ? rb.readinessR : 0;

    const rainA = ra ? rainInRange(ra, range) : 0;

    if (mode === 'name_az') return collator.compare(nameA, nameB);
    if (mode === 'name_za') return collator.compare(nameB, nameA);

    if (mode === 'ready_dry_wet'){ if (readyB !== readyA) return readyB - readyA; return collator.compare(nameA, nameB); }
    if (mode === 'ready_wet_dry'){ if (readyB !== readyA) return readyA - readyB; return collator.compare(nameA, nameB); }

    const rainB2 = rb ? rainInRange(rb, range) : 0;
    if (mode === 'rain_most'){ if (rainB2 !== rainA) return rainB2 - rainA; return collator.compare(nameA, nameB); }
    if (mode === 'rain_least'){ if (rainB2 !== rainA) return rainA - rainB2; return collator.compare(nameA, nameB); }

    return collator.compare(nameA, nameB);
  });

  return arr;
}

/* ---------- render ---------- */
function getFilteredFields(){
  const farmId = String(state.farmFilter || '__all__');
  if (farmId === '__all__') return state.fields.slice();
  return state.fields.filter(f => String(f.farmId||'') === farmId);
}

function renderTiles(){
  const wrap = $('fieldsGrid');
  if (!wrap) return;
  wrap.innerHTML = '';

  state.lastRuns.clear();
  const deps = {
    getWeatherSeriesForFieldId: (fieldId)=> getWeatherSeriesForFieldId(fieldId, wxCtx),
    getFieldParams,
    LOSS_SCALE,
    EXTRA
  };

  for (const f of state.fields){
    state.lastRuns.set(f.id, runField(f, deps));
  }

  const filtered = getFilteredFields();
  const sorted = sortFields(filtered, state.lastRuns);
  const thr = getThresholdForOp(getCurrentOp());
  const range = parseRangeFromInput();

  const cap = (state.pageSize === -1) ? sorted.length : Math.min(sorted.length, state.pageSize);
  const show = sorted.slice(0, cap);

  for (const f of show){
    const run0 = state.lastRuns.get(f.id);
    if (!run0) continue;

    const readiness = run0.readinessR; // TRUE readiness number (unchanged)
    const eta = etaFor(run0, thr, ETA_MAX_HOURS);
    const rainRange = rainInRange(run0, range);

    // TRUE positions (unchanged)
    const leftPos = markerLeftCSS(readiness); // marker at readiness
    const thrPos  = markerLeftCSS(thr);       // threshold at threshold

    // COLORS ONLY (perception)
    const perceived = perceivedFromThreshold(readiness, thr);
    const pillBg = colorForPerceived(perceived);
    const grad = gradientForThreshold(thr);

    // FIELD ONLY
    const labelLeft = f.name;

    const tile = document.createElement('div');
    tile.className = 'tile' + (f.id === state.selectedFieldId ? ' active' : '');

    tile.innerHTML = `
      <div class="tile-top">
        <div class="titleline">
          <div class="name" title="${esc(labelLeft)}">${esc(labelLeft)}</div>
        </div>
        <div class="readiness-pill" style="background:${pillBg};color:#fff;">Field Readiness ${readiness}</div>
      </div>

      <p class="subline">Rain (range): <span class="mono">${rainRange.toFixed(2)}</span> in</p>

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
    `;

    tile.addEventListener('click', ()=>{
      selectField(f.id);
    });

    wrap.appendChild(tile);
  }

  const empty = $('emptyMsg');
  if (empty) empty.style.display = show.length ? 'none' : 'block';
}

function selectField(id){
  const f = state.fields.find(x=>x.id === id);
  if (!f) return;
  state.selectedFieldId = id;
  ensureSelectedParamsToSliders();
  refreshAll();
}

/* ---------- details (unchanged) ---------- */
function renderBetaInputs(){
  const box = $('betaInputs');
  const meta = $('betaInputsMeta');
  if (!box || !meta) return;

  const fid = state.selectedFieldId;
  const info = fid ? state.wxInfoByFieldId.get(fid) : null;

  if (!info){
    meta.textContent = 'Weather is loading…';
    box.innerHTML = '';
    return;
  }

  const when = info.fetchedAt ? new Date(info.fetchedAt) : null;
  const whenTxt = when ? when.toLocaleString() : '—';
  meta.textContent =
    `Source: ${info.source || '—'} • Updated: ${whenTxt} • Primary + light-influence variables are used now; weights are still being tuned.`;

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
    ['soil_temp_c_40_100','Soil temp 40–100cm (hourly)', unitsHourly?.soil_temperature_40_to_100cm || '°C'],
    ['soil_temp_c_100_200','Soil temp 100–200cm (hourly)', unitsHourly?.soil_temperature_100_to_200cm || '°C'],
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

function renderDetails(){
  // (UNCHANGED from your live file)
  const f = state.fields.find(x=>x.id === state.selectedFieldId);
  if (!f) return;

  const deps = {
    getWeatherSeriesForFieldId: (fieldId)=> getWeatherSeriesForFieldId(fieldId, wxCtx),
    getFieldParams,
    LOSS_SCALE,
    EXTRA
  };

  const run = state.lastRuns.get(f.id) || runField(f, deps);
  if (!run) return;

  const fac = run.factors;
  const p = getFieldParams(f.id);

  const opKey = getCurrentOp();
  const opLabel = (OPS.find(o=>o.key===opKey)?.label) || opKey;
  const thr = getThresholdForOp(opKey);

  const range = parseRangeFromInput();
  const rainRange = rainInRange(run, range);

  const farmName = state.farmsById.get(f.farmId) || '';

  const setText = (id, val) => { const el = $(id); if (el) el.textContent = String(val); };

  setText('dFieldName', farmName ? `${farmName} • ${f.name}` : (f.name || '—'));
  setText('dStatus', String(f.status||'—'));
  setText('dCounty', `${String(f.county||'—')} / ${String(f.state||'—')}`);
  setText('dAcres', (isFinite(f.tillable) ? `${f.tillable.toFixed(2)} ac` : '—'));
  setText('dGps', (f.location ? `${f.location.lat.toFixed(6)}, ${f.location.lng.toFixed(6)}` : '—'));

  const btnMap = $('btnMap');
  if (btnMap) btnMap.disabled = !f.location;

  setText('dSoilType', `${p.soilWetness}/100`);
  setText('dSoilHold', `${fac.soilHold.toFixed(2)} (normalized)`);
  setText('dDrainage', `${p.drainageIndex}/100`);

  setText('dThreshold', `${thr}`);
  setText('dOperation', opLabel);

  setText('dDays', String(run.rows.length || 0));
  setText('dRangeRain', `${rainRange.toFixed(2)} in`);
  setText('dReadiness', `${run.readinessR}`);
  setText('dWetness', `${run.wetnessR}`);
  setText('dStorage', `${run.storageFinal.toFixed(2)} / ${run.factors.Smax.toFixed(2)}`);

  const param = $('paramExplain');
  if (param){
    param.innerHTML =
      `soilHold=soilWetness/100=<span class="mono">${fac.soilHold.toFixed(2)}</span> • drainPoor=drainageIndex/100=<span class="mono">${fac.drainPoor.toFixed(2)}</span><br/>
       Smax=<span class="mono">${fac.Smax.toFixed(2)}</span> (base <span class="mono">${fac.SmaxBase.toFixed(2)}</span>) • infilMult=<span class="mono">${fac.infilMult.toFixed(2)}</span> • dryMult=<span class="mono">${fac.dryMult.toFixed(2)}</span> • LOSS_SCALE=<span class="mono">${LOSS_SCALE.toFixed(2)}</span>`;
  }

  const sum = $('mathSummary');
  if (sum){
    sum.innerHTML =
      `Model output: <b>Wet=${run.wetnessR}</b> • <b>Readiness=${run.readinessR}</b> • storage=<span class="mono">${run.storageFinal.toFixed(2)}</span>/<span class="mono">${run.factors.Smax.toFixed(2)}</span>`;
  }

  renderBetaInputs();
  updateAdjustPills();
}

function refreshAll(){
  setErr('');

  if (state.selectedFieldId){
    const a = $('soilWet');
    const b = $('drain');
    const p = getFieldParams(state.selectedFieldId);
    if (a) p.soilWetness = clamp(Number(a.value), 0, 100);
    if (b) p.drainageIndex = clamp(Number(b.value), 0, 100);
    state.perFieldParams.set(state.selectedFieldId, p);
    saveParamsToLocal();
  }

  renderTiles();
  renderDetails();
}

/* =====================================================================
   GLOBAL ADJUST (hidden behind tapping "Fields")
   ===================================================================== */

/* ---------- cooldown UI helpers ---------- */
function __fmtDur(ms){
  ms = Math.max(0, ms|0);
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${String(m).padStart(2,'0')}m`;
}
function __fmtAbs(tsMs){
  if (!tsMs) return '—';
  try{
    const d = new Date(tsMs);
    return d.toLocaleString(undefined, {
      year:'numeric', month:'short', day:'2-digit',
      hour:'numeric', minute:'2-digit'
    });
  }catch(_){
    return '—';
  }
}
function __tsToMs(ts){
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (ts.seconds && ts.nanoseconds != null){
    return (Number(ts.seconds)*1000) + Math.floor(Number(ts.nanoseconds)/1e6);
  }
  return 0;
}

/**
 * NEW: If the HTML doesn't have #calibCooldownMsg, create it and insert it
 * inside the Adjust modal near the top (above the Wet/Dry buttons).
 */
function __ensureCooldownSlot(){
  if ($('calibCooldownMsg')) return;

  const feelSeg = $('feelSeg');
  if (feelSeg && feelSeg.parentElement){
    const div = document.createElement('div');
    div.id = 'calibCooldownMsg';
    // small spacer so it doesn’t jam the layout
    div.style.margin = '8px 0 10px 0';
    feelSeg.parentElement.insertBefore(div, feelSeg);
    return;
  }

  // fallback: try to append inside adjustBackdrop modal body
  const back = $('adjustBackdrop');
  if (back){
    const body = back.querySelector('.modal-b') || back.querySelector('.modal') || back;
    const div = document.createElement('div');
    div.id = 'calibCooldownMsg';
    div.style.margin = '8px 0 10px 0';
    body.appendChild(div);
  }
}

function __setCooldownHtml(html){
  __ensureCooldownSlot();
  const el = $('calibCooldownMsg');
  if (!el) return;
  if (!html){
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }
  el.style.display = '';
  el.innerHTML = html;
}

function __renderCooldownCard(){
  const now = Date.now();
  const lastMs = Number(state._lastAppliedMs || 0);
  const nextMs = Number(state._nextAllowedMs || 0);
  const cdH = Number(state._cooldownHours || 72);

  const locked = (nextMs && now < nextMs);
  const since = lastMs ? __fmtDur(now - lastMs) : '—';
  const nextAbs = nextMs ? __fmtAbs(nextMs) : '—';

  const title = locked ? 'Global calibration is locked' : 'Global calibration is available';
  const sub = `Next global adjustment allowed: <span class="mono">${esc(nextAbs)}</span>`;

  const lastLine = lastMs
    ? `Last global adjustment: <span class="mono">${esc(since)}</span> ago`
    : `Last global adjustment: <span class="mono">—</span>`;

  const note =
    `If one specific field needs changes right now, do a <b>field-specific adjustment</b> using the field’s <b>Soil Wetness</b> and <b>Drainage Index</b> sliders (not global calibration).`;

  const cardStyle =
    'border:1px solid var(--border);border-radius:14px;padding:12px;' +
    'background:color-mix(in srgb, var(--surface) 96%, #ffffff 4%);' +
    'display:grid;gap:8px;';

  const headStyle = 'display:flex;align-items:flex-start;justify-content:space-between;gap:10px;';
  const hStyle = 'margin:0;font-weight:900;font-size:12px;line-height:1.2;';
  const badgeStyle =
    'padding:4px 8px;border-radius:999px;border:1px solid var(--border);' +
    'font-weight:900;font-size:12px;white-space:nowrap;' +
    (locked ? 'background:color-mix(in srgb, #b00020 10%, var(--surface) 90%);'
            : 'background:color-mix(in srgb, var(--accent) 12%, var(--surface) 88%);');

  const lineStyle = 'font-size:12px;color:var(--text);opacity:.92;';
  const mutedStyle = 'font-size:12px;color:var(--muted,#67706B);opacity:.95;line-height:1.35;';

  __setCooldownHtml(`
    <div style="${cardStyle}">
      <div style="${headStyle}">
        <div style="${hStyle}">${esc(title)}</div>
        <div style="${badgeStyle}">${locked ? `${cdH}h rule` : 'Unlocked'}</div>
      </div>
      <div style="${lineStyle}">${lastLine}</div>
      <div style="${lineStyle}">${sub}</div>
      <div style="${mutedStyle}">${note}</div>
    </div>
  `);
}

async function loadCooldownFromFirestore(){
  const api = getAPI();
  if (!api || api.kind === 'compat'){
    state._nextAllowedMs = 0;
    state._lastAppliedMs = 0;
    state._cooldownHours = 72;
    return;
  }
  try{
    const db = api.getFirestore();
    const ref = api.doc(db, WEIGHTS_COLLECTION, WEIGHTS_DOC);
    const snap = await api.getDoc(ref);
    if (!snap || !snap.exists || !snap.exists()){
      state._nextAllowedMs = 0;
      state._lastAppliedMs = 0;
      state._cooldownHours = 72;
      return;
    }
    const d = snap.data() || {};
    state._nextAllowedMs = __tsToMs(d.nextAllowedAt);
    state._lastAppliedMs = __tsToMs(d.lastAppliedAt);
    state._cooldownHours = isFinite(Number(d.cooldownHours)) ? Number(d.cooldownHours) : 72;
  }catch(e){
    console.warn('[FieldReadiness] cooldown read failed:', e);
    state._nextAllowedMs = 0;
    state._lastAppliedMs = 0;
    state._cooldownHours = 72;
  }
}

function startCooldownTicker(){
  const btn = $('btnAdjApply');

  function tick(){
    const now = Date.now();
    const locked = (state._nextAllowedMs && now < state._nextAllowedMs);
    if (btn) btn.disabled = !!locked;
    __renderCooldownCard();
  }

  try{ if (state._cooldownTimer) clearInterval(state._cooldownTimer); }catch(_){}
  tick();
  state._cooldownTimer = setInterval(tick, 30000);
}
function stopCooldownTicker(){
  try{ if (state._cooldownTimer) clearInterval(state._cooldownTimer); }catch(_){}
  state._cooldownTimer = null;
  __setCooldownHtml('');
}

/* ---------- Adjust pills/UI ---------- */
function updateAdjustPills(){
  const fid = state.selectedFieldId;
  const f = state.fields.find(x=>x.id===fid);
  if (!f) return;

  const deps = {
    getWeatherSeriesForFieldId: (fieldId)=> getWeatherSeriesForFieldId(fieldId, wxCtx),
    getFieldParams,
    LOSS_SCALE,
    EXTRA
  };

  const run = state.lastRuns.get(f.id) || runField(f, deps);
  if (!run) return;

  const p = getFieldParams(f.id);
  const set = (id,val)=>{ const el=$(id); if(el) el.textContent=String(val); };

  set('adjReadiness', run.readinessR);
  set('adjWetness', run.wetnessR);
  set('adjSoil', `${p.soilWetness}/100`);
  set('adjDrain', `${p.drainageIndex}/100`);

  const mc = modelClassFromRun(run);
  set('adjModelClass', mc.toUpperCase());

  updateAdjustUI();
}

function setFeel(feel){
   if (isGlobalCalLocked()) return;
  state._adjFeel = (feel === 'wet' || feel === 'dry') ? feel : null;

  const seg = $('feelSeg');
  if (seg){
    seg.querySelectorAll('.segbtn').forEach(btn=>{
      const bf = btn.getAttribute('data-feel');
      btn.classList.toggle('on', bf === state._adjFeel);
    });
  }
  updateAdjustUI();
}

/* Slider helpers */
function readSlider0100(){
  const el = $('adjIntensity');
  const v = el ? Number(el.value) : 50;
  return clamp(Math.round(isFinite(v) ? v : 50), 0, 100);
}
function updateIntensityLabel(){
  const out = $('adjIntensityVal');
  if (!out) return;

  // Show the actual slider value (anchored to current readiness),
  // so if readiness is 8, it displays 8/100.
  out.textContent = String(readSlider0100());
}

function getAnchorReadinessFromRun(run){
  return clamp(Math.round(Number(run?.readinessR ?? 50)), 0, 100);
}

/* Slider stays 0-100, anchored; wrong direction blocked */
function configureSliderAnchor(anchorReadiness){
  const slider = $('adjIntensity');
  if (!slider) return;
  const r = clamp(Math.round(Number(anchorReadiness)), 0, 100);
  slider.min = '0';
  slider.max = '100';
  slider.value = String(r);
  updateIntensityLabel();
}
function enforceAdjustSliderBounds(){
  const slider = $('adjIntensity');
  if (!slider) return;

  const anchor = clamp(Number(state._adjAnchorReadiness ?? 50), 0, 100);
  let v = readSlider0100();

  if (state._adjFeel === 'dry'){
    if (v < anchor) v = anchor;
  } else if (state._adjFeel === 'wet'){
    if (v > anchor) v = anchor;
  } else {
    v = anchor;
  }

  slider.value = String(v);
  updateIntensityLabel();
}

function computeNormalizedIntensity0100(anchor, feel){
  const target = readSlider0100();
  const r = clamp(Math.round(Number(anchor)), 0, 100);

  if (feel === 'dry'){
    const denom = Math.max(1, 100 - r);
    return Math.round(clamp((target - r) / denom, 0, 1) * 100);
  }
  if (feel === 'wet'){
    const denom = Math.max(1, r);
    return Math.round(clamp((r - target) / denom, 0, 1) * 100);
  }
  return 0;
}

function computeDelta(){
  const fid = state.selectedFieldId;
  const f = state.fields.find(x=>x.id===fid);
  const deps = {
    getWeatherSeriesForFieldId: (fieldId)=> getWeatherSeriesForFieldId(fieldId, wxCtx),
    getFieldParams,
    LOSS_SCALE,
    EXTRA
  };
  const run = f ? (state.lastRuns.get(f.id) || runField(f, deps)) : null;

  const mc = modelClassFromRun(run);
  const feel = state._adjFeel;

  if (!feel) return 0;

  let sign = 0;
  if (feel === 'wet') sign = +1;
  if (feel === 'dry') sign = -1;

  const opposite =
    (mc === 'wet' && feel === 'dry') ||
    (mc === 'dry' && feel === 'wet');

  let mag = 8;
  if (opposite){
    const anchor = (state._adjAnchorReadiness == null) ? getAnchorReadinessFromRun(run) : clamp(Number(state._adjAnchorReadiness), 0, 100);
    const intensity0100 = computeNormalizedIntensity0100(anchor, feel);
    mag = 8 + Math.round((intensity0100/100) * 10);
  }

  return clamp(sign * mag, -18, +18);
}

function updateAdjustGuard(){
  updateIntensityLabel();
  const el = $('adjGuard');
  if (!el) return;

  const d = computeDelta();
  if (d === 0){
    el.textContent = 'Choose Wet or Dry to submit a global calibration.';
    return;
  }
  el.textContent = `This will nudge the model by ${d > 0 ? '+' : ''}${d} (guardrailed).`;
}

function updateAdjustUI(){
  const fid = state.selectedFieldId;
  const f = state.fields.find(x=>x.id===fid);
  if (!f) return;

  const deps = {
    getWeatherSeriesForFieldId: (fieldId)=> getWeatherSeriesForFieldId(fieldId, wxCtx),
    getFieldParams,
    LOSS_SCALE,
    EXTRA
  };
  const run = state.lastRuns.get(f.id) || runField(f, deps);
  const mc = modelClassFromRun(run);

  const locked = isGlobalCalLocked();

const bWet = $('btnFeelWet');
const bDry = $('btnFeelDry');

// If locked: disable BOTH (no calibration allowed)
if (bWet) bWet.disabled = locked || (mc === 'wet');
if (bDry) bDry.disabled = locked || (mc === 'dry');

// Apply must stay disabled while locked
const applyBtn = $('btnAdjApply');
if (applyBtn) applyBtn.disabled = locked || !(state._adjFeel === 'wet' || state._adjFeel === 'dry');

// Optional: prevent playing with the slider while locked
const s = $('adjIntensity');
if (s) s.disabled = !!locked;

// If locked, force a clear message
const hint = $('adjHint');
if (hint && locked){
  hint.textContent = 'Global calibration is locked (72h rule). Use field-specific Soil Wetness and Drainage sliders instead.';
}

  if (mc === 'wet' && state._adjFeel === 'wet') state._adjFeel = null;
  if (mc === 'dry' && state._adjFeel === 'dry') state._adjFeel = null;

  const seg = $('feelSeg');
  if (seg){
    seg.querySelectorAll('.segbtn').forEach(btn=>{
      const bf = btn.getAttribute('data-feel');
      btn.classList.toggle('on', bf === state._adjFeel);
    });
  }

  const opposite =
    (mc === 'wet' && state._adjFeel === 'dry') ||
    (mc === 'dry' && state._adjFeel === 'wet');

  const box = $('intensityBox');
  const title = $('intensityTitle');
  const left = $('intensityLeft');
  const right = $('intensityRight');

  if (box) box.classList.toggle('pv-hide', !opposite);

  if (opposite){
    if (mc === 'wet' && title){
      title.textContent = 'If it’s NOT wet… how DRY is it?';
      if (left) left.textContent = 'Slightly dry';
      if (right) right.textContent = 'Extremely dry';
    }
    if (mc === 'dry' && title){
      title.textContent = 'If it’s NOT dry… how WET is it?';
      if (left) left.textContent = 'Slightly wet';
      if (right) right.textContent = 'Extremely wet';
    }

    const anchor = getAnchorReadinessFromRun(run);
    state._adjAnchorReadiness = anchor;

    configureSliderAnchor(anchor);
    enforceAdjustSliderBounds();
  } else {
    // ensure the intensity label goes back to 0 when slider is hidden
    updateIntensityLabel();
  }

  const hint = $('adjHint');
  if (hint){
    if (mc === 'wet'){
      hint.textContent = 'Model says WET → “Wet” disabled. Choose “Dry” to correct it (slider won’t allow going wetter).';
    } else if (mc === 'dry'){
      hint.textContent = 'Model says DRY → “Dry” disabled. Choose “Wet” to correct it (slider won’t allow going drier).';
    } else {
      hint.textContent = 'Model says OK → choose Wet or Dry if it’s wrong.';
    }
  }

  const applyBtn = $('btnAdjApply');
  if (applyBtn){
    const hasChoice = (state._adjFeel === 'wet' || state._adjFeel === 'dry');
    if (!hasChoice) applyBtn.disabled = true;
  }

  updateAdjustGuard();
}

/* ---------- logging + firestore write (GLOBAL-only) ---------- */
function appendAdjustLog(entry){
  try{
    const raw = localStorage.getItem(LS_ADJ_LOG);
    const arr = raw ? JSON.parse(raw) : [];
    const out = Array.isArray(arr) ? arr : [];
    out.unshift(entry);
    while (out.length > 60) out.pop();
    localStorage.setItem(LS_ADJ_LOG, JSON.stringify(out));
  }catch(_){}
}

async function writeAdjustToFirestore(entry){
  const api = getAPI();
  if (!api || api.kind === 'compat') return;

  try{
    const db = api.getFirestore();
    const auth = api.getAuth ? api.getAuth() : null;
    const user = auth && auth.currentUser ? auth.currentUser : null;

    const payload = {
      ...entry,
      createdAt: api.serverTimestamp ? api.serverTimestamp() : new Date().toISOString(),
      createdBy: user ? (user.email || user.uid || null) : null
    };

    const col = api.collection(db, ADJ_COLLECTION);
    if (api.addDoc){
      await api.addDoc(col, payload);
    } else {
      const id = String(Date.now());
      const ref = api.doc(db, ADJ_COLLECTION, id);
      await api.setDoc(ref, payload, { merge:true });
    }
  }catch(e){
    console.warn('[FieldReadiness] adjust log write failed:', e);
  }
}

async function applyAdjustment(){
  const fid = state.selectedFieldId;
  const f = state.fields.find(x=>x.id===fid);
  if (!f) return;

  const deps = {
    getWeatherSeriesForFieldId: (fieldId)=> getWeatherSeriesForFieldId(fieldId, wxCtx),
    getFieldParams,
    LOSS_SCALE,
    EXTRA
  };
  const run = state.lastRuns.get(f.id) || runField(f, deps);

  const d = computeDelta();
  const feel = state._adjFeel;

  if (!feel || d === 0){
    return;
  }

  const anchor = (state._adjAnchorReadiness == null) ? getAnchorReadinessFromRun(run) : Number(state._adjAnchorReadiness);

  const entry = {
    fieldId: f.id,
    fieldName: f.name || '',
    op: getCurrentOp(),

    feel,
    readinessAnchor: anchor,
    readinessSlider: readSlider0100(),
    intensity: computeNormalizedIntensity0100(anchor, feel),
    delta: d,

    global: true,

    model: {
      readinessBefore: run ? run.readinessR : null,
      wetnessBefore: run ? run.wetnessR : null,
      modelClass: modelClassFromRun(run)
    },
    ts: Date.now()
  };

  appendAdjustLog(entry);
  await writeAdjustToFirestore(entry);

  refreshAll();
  closeAdjust();
}

/* ---------- open/close adjust (GLOBAL) ---------- */
async function openAdjustGlobal(){
  if (!state.selectedFieldId && state.fields.length){
    state.selectedFieldId = state.fields[0].id;
  }

  const f = state.fields.find(x=>x.id===state.selectedFieldId);
  const sub = $('adjustSub');
  if (sub){
    sub.textContent = 'Global calibration';
    if (f && f.name) sub.textContent = `Global calibration • ${f.name}`;
  }

  state._adjFeel = null;

  const deps = {
    getWeatherSeriesForFieldId: (fieldId)=> getWeatherSeriesForFieldId(fieldId, wxCtx),
    getFieldParams,
    LOSS_SCALE,
    EXTRA
  };
  const run = f ? (state.lastRuns.get(f.id) || runField(f, deps)) : null;
  const anchor = getAnchorReadinessFromRun(run);
  state._adjAnchorReadiness = anchor;
  configureSliderAnchor(anchor);

  // ensure status slot exists before we render it
  __ensureCooldownSlot();

  updateAdjustPills();
  updateAdjustGuard();

  await loadCooldownFromFirestore();
  startCooldownTicker();

  showModal('adjustBackdrop', true);
}

function closeAdjust(){
  showModal('adjustBackdrop', false);
  stopCooldownTicker();
}

/* ---------- hidden "Fields" tap target ---------- */
function wireFieldsHiddenTap(){
  const el = $('fieldsTitle') || document.querySelector('[data-fields-tap]');
  if (!el) return;

  el.style.cursor = 'pointer';
  el.setAttribute('role','button');
  el.setAttribute('aria-label','Fields (tap for calibration)');

  el.addEventListener('click', (e)=>{
    e.preventDefault();
    e.stopPropagation();
    openAdjustGlobal();
  });
}

/* ---------- operation modal ---------- */
function renderOpThresholdModal(){
  const list = $('opList');
  if (!list) return;
  list.innerHTML = '';

  for (const op of OPS){
    const val = getThresholdForOp(op.key);

    const row = document.createElement('div');
    row.className = 'oprow';

    row.innerHTML = `
      <div class="oprow-top">
        <div class="opname">${esc(op.label)}</div>
        <div class="opval"><span class="mono" id="thrVal_${esc(op.key)}">${val}</span></div>
      </div>
      <input type="range" min="0" max="100" step="1" value="${val}" data-thr="${esc(op.key)}"/>
    `;

    const slider = row.querySelector('input[type="range"]');
    slider.addEventListener('input', ()=>{
      const k = slider.getAttribute('data-thr');
      const n = clamp(Number(slider.value), 0, 100);
      state.thresholdsByOp.set(k, n);

      const vEl = $('thrVal_' + k);
      if (vEl) vEl.textContent = String(n);

      scheduleThresholdSave();
      refreshAll();
    });

    list.appendChild(row);
  }
}
function openOpModal(){
  renderOpThresholdModal();
  showModal('opBackdrop', true);
}
function closeOpModal(){ showModal('opBackdrop', false); }

function loadOpDefault(){
  const op = $('opSel');
  if (!op) return;
  try{
    const raw = localStorage.getItem(LS_OP_KEY);
    if (raw) op.value = raw;
  }catch(_){}
}
function saveOpDefault(){
  const op = $('opSel');
  if (!op) return;
  try{ localStorage.setItem(LS_OP_KEY, String(op.value||'')); }catch(_){}
}

/* ---------- maps (kept as-is from your live file) ---------- */
function getMapsKey(){
  const k1 = (window && window.FV_GOOGLE_MAPS_KEY) ? String(window.FV_GOOGLE_MAPS_KEY) : '';
  let k2 = '';
  try{ k2 = String(localStorage.getItem('fv_google_maps_key') || ''); }catch(_){}
  return (k1 || k2 || '').trim();
}
function loadGoogleMapsOnce(){
  if (state._mapsPromise) return state._mapsPromise;

  state._mapsPromise = new Promise((resolve, reject)=>{
    if (window.google && window.google.maps){
      resolve(window.google.maps);
      return;
    }

    const key = getMapsKey();
    if (!key){
      reject(new Error('Missing Google Maps key. Set window.FV_GOOGLE_MAPS_KEY or localStorage.fv_google_maps_key.'));
      return;
    }

    const existing = document.querySelector('script[data-fv-google-maps="1"]');
    if (existing){
      const t0 = Date.now();
      const tick = ()=>{
        if (window.google && window.google.maps) return resolve(window.google.maps);
        if (Date.now() - t0 > 15000) return reject(new Error('Google Maps load timeout.'));
        setTimeout(tick, 50);
      };
      tick();
      return;
    }

    const s = document.createElement('script');
    s.setAttribute('data-fv-google-maps','1');
    s.async = true;
    s.defer = true;
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly`;
    s.onload = ()=>{
      if (window.google && window.google.maps) resolve(window.google.maps);
      else reject(new Error('Google Maps loaded but google.maps is missing.'));
    };
    s.onerror = ()=> reject(new Error('Failed to load Google Maps script.'));
    document.head.appendChild(s);
  });

  return state._mapsPromise;
}
function setMapError(msg){
  const el = $('mapError');
  const wrap = $('mapWrap');
  if (el){
    if (!msg){
      el.style.display = 'none';
      el.textContent = '';
    } else {
      el.style.display = 'block';
      el.textContent = msg;
    }
  }
  if (wrap) wrap.style.opacity = msg ? '0.65' : '1';
}
function openMapModal(){
  const f = state.fields.find(x=>x.id === state.selectedFieldId);
  if (!f || !f.location) return;

  const lat = Number(f.location.lat);
  const lng = Number(f.location.lng);
  const sub = $('mapSub');
  if (sub) sub.textContent = (f.name ? `${f.name}` : 'Field') + ' • HYBRID';

  const ll = $('mapLatLng');
  if (ll) ll.textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

  setMapError('');
  showModal('mapBackdrop', true);

  setTimeout(async ()=>{
    try{
      const maps = await loadGoogleMapsOnce();

      const canvas = $('fvMapCanvas');
      if (!canvas) throw new Error('Map canvas missing.');

      const center = { lat, lng };

      if (!state._gmap){
        state._gmap = new maps.Map(canvas, {
          center,
          zoom: 16,
          mapTypeId: maps.MapTypeId.HYBRID,
          streetViewControl: false,
          fullscreenControl: false,
          mapTypeControl: true,
          clickableIcons: false
        });
      } else {
        state._gmap.setCenter(center);
        state._gmap.setZoom(16);
        state._gmap.setMapTypeId(maps.MapTypeId.HYBRID);
      }

      if (!state._gmarker){
        state._gmarker = new maps.Marker({ position: center, map: state._gmap });
      } else {
        state._gmarker.setMap(state._gmap);
        state._gmarker.setPosition(center);
      }

      setTimeout(()=>{
        try{ maps.event.trigger(state._gmap, 'resize'); }catch(_){}
        try{ state._gmap.setCenter(center); }catch(_){}
      }, 60);

    }catch(e){
      console.warn('[FieldReadiness] map open failed:', e);
      setMapError(e?.message || 'Map failed to load.');
    }
  }, 0);
}
function closeMapModal(){ showModal('mapBackdrop', false); }

/* ---------- wiring ---------- */
on('sortSel','change', refreshAll);
on('opSel','change', ()=>{ saveOpDefault(); refreshAll(); });

on('farmSel','change', ()=>{
  saveFarmFilterDefault();
  const filtered = getFilteredFields();
  if (state.selectedFieldId && !filtered.find(x=>x.id===state.selectedFieldId)){
    state.selectedFieldId = filtered.length ? filtered[0].id : state.selectedFieldId;
  }
  refreshAll();
});
on('pageSel','change', ()=>{
  savePageSizeDefault();
  refreshAll();
});

on('soilWet','input', refreshAll);
on('drain','input', refreshAll);

on('applyRangeBtn','click', ()=> setTimeout(refreshAll, 0));
on('clearRangeBtn','click', ()=> setTimeout(refreshAll, 0));
on('jobRangeInput','change', refreshAll);

on('btnRegen','click', async ()=>{
  try{
    setErr('');
    await warmWeatherForFields(state.fields, wxCtx, { force:true, onEach:debounceRender });
    refreshAll();
  }catch(e){
    console.error(e);
    setErr('Weather refresh failed. Check Cloud Run logs / CORS.');
  }
});

(function(){
  const rainHelpBtn = $('rainHelpBtn');
  const rainHelpTip = $('rainHelpTip');
  if (!rainHelpBtn || !rainHelpTip) return;

  function close(){ rainHelpTip.classList.remove('on'); }
  rainHelpBtn.addEventListener('click', (e)=>{
    e.stopPropagation();
    rainHelpTip.classList.toggle('on');
  });
  document.addEventListener('click', (e)=>{
    if (!rainHelpTip.classList.contains('on')) return;
    const inside = e.target && e.target.closest && e.target.closest('#rainHelpTip');
    const btn = e.target && e.target.closest && e.target.closest('#rainHelpBtn');
    if (!inside && !btn) close();
  });
})();

on('opBtn','click', openOpModal);
on('btnOpX','click', closeOpModal);
(function(){
  const b = $('opBackdrop');
  if (!b) return;
  b.addEventListener('click', (e)=>{
    if (e.target && e.target.id === 'opBackdrop') closeOpModal();
  });
})();

on('btnAdjX','click', closeAdjust);
/* ---------- ensure cooldown panel always renders when Adjust opens ---------- */
(function wireAdjustCooldownAuto(){
  const back = $('adjustBackdrop');
  if (!back) return;

  const obs = new MutationObserver(async ()=>{
    const open = !back.classList.contains('pv-hide');
    if (!open) return;

    // Ensure the slot exists + render immediately
    __ensureCooldownSlot();
    await loadCooldownFromFirestore();
    __renderCooldownCard();

    // Keep it updating + enforce disable state
    stopCooldownTicker();   // make sure no previous interval is running
startCooldownTicker();  // start fresh
  });

  obs.observe(back, { attributes:true, attributeFilter:['class'] });
})();
on('btnAdjCancel','click', closeAdjust);
on('btnAdjApply','click', ()=>{
  const btn = $('btnAdjApply');
  if (btn && btn.disabled) return;
  showModal('confirmAdjBackdrop', true);
});
on('btnAdjNo','click', ()=>{ showModal('confirmAdjBackdrop', false); });
on('btnAdjYes','click', async ()=>{
  showModal('confirmAdjBackdrop', false);
  await applyAdjustment();
});

(function(){
  const seg = $('feelSeg');
  if (!seg) return;
  seg.addEventListener('click', (e)=>{
    const btn = e.target && e.target.closest ? e.target.closest('button[data-feel]') : null;
    if (!btn) return;
    const f = btn.getAttribute('data-feel');
    if (f !== 'wet' && f !== 'dry') return;
    setFeel(f);
  });
})();

on('adjIntensity','input', ()=>{
  enforceAdjustSliderBounds();
  updateAdjustGuard();
});

// Map
on('btnMap','click', (e)=>{
  e.preventDefault();
  e.stopPropagation();
  openMapModal();
});
on('btnMapX','click', closeMapModal);
(function(){
  const b = $('mapBackdrop');
  if (!b) return;
  b.addEventListener('click', (e)=>{
    if (e.target && e.target.id === 'mapBackdrop') closeMapModal();
  });
})();

/* ---------- init ---------- */
(async function init(){
  const dp = $('detailsPanel');
  if (dp) dp.open = false;

  loadParamsFromLocal();
  loadOpDefault();
  loadThresholdsFromLocal();

  loadFarmFilterDefault();
  loadPageSizeDefault();

  const ok = await importFirebaseInit();
  if (!ok) setErr('firebase-init.js failed to import as a module.');

  await loadThresholdsFromFirestore();
  await loadFarmsOptional();
  await loadFields();

  if (!state.selectedFieldId && state.fields.length){
    state.selectedFieldId = state.fields[0].id;
  }

  wireFieldsHiddenTap();

  ensureSelectedParamsToSliders();
  refreshAll();
})();
