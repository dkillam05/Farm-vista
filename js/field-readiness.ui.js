/* =====================================================================
/Farm-vista/js/field-readiness.ui.js  (FULL FILE)
Rev: 2025-12-23a

CHANGES (per Dane):
✅ Remove per-field "Adjust" button from tiles
✅ Make the word "Fields" a hidden tap target to open GLOBAL adjustment modal
✅ In global adjust:
   - Remove About Right (no "ok" selection; must pick Wet or Dry)
   - Remove/ignore Quick Obs section (adjObs no longer impacts delta)
✅ Intensity slider:
   - Only shows for opposite-direction correction (kept)
   - Starts at a best-guess intensity (based on model output)
   - Direction is locked by Wet/Dry choice (slider is magnitude only)
✅ Cooldown UI:
   - Reads field_readiness_model_weights/default.nextAllowedAt
   - Disables Apply + shows “Next allowed in Xh Ym”
   - Server still enforces cooldown
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
}

function on(id, ev, fn){
  const el = $(id);
  if (el) el.addEventListener(ev, fn);
}

/* ---------- constants (same as your inline) ---------- */
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

const THR_COLLECTION = 'field_readiness_thresholds';
const THR_DOC_ID = 'default';
const ADJ_COLLECTION = 'field_readiness_adjustments';

// NEW: weights doc for cooldown UI
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

  // Adjust (GLOBAL)
  _adjFeel: null,            // 'wet' | 'dry' | null
  _cooldownTimer: null,
  _nextAllowedMs: 0,

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

/* ---------- range helpers (kept inline behavior) ---------- */
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

  const sorted = sortFields(state.fields, state.lastRuns);
  const thr = getThresholdForOp(getCurrentOp());
  const range = parseRangeFromInput();

  for (const f of sorted){
    const run0 = state.lastRuns.get(f.id);
    if (!run0) continue;

    const readiness = run0.readinessR;
    const eta = etaFor(run0, thr, ETA_MAX_HOURS);
    const rainRange = rainInRange(run0, range);

    const leftPos = markerLeftCSS(readiness);
    const thrPos  = markerLeftCSS(thr);
    const pillBg = readinessColor(readiness);

    const farmName = state.farmsById.get(f.farmId) || '';
    const labelLeft = farmName ? `${farmName} • ${f.name}` : f.name;

    const tile = document.createElement('div');
    tile.className = 'tile' + (f.id === state.selectedFieldId ? ' active' : '');

    // ✅ Removed Adjust button entirely
    tile.innerHTML = `
      <div class="tile-top">
        <div class="titleline">
          <div class="name" title="${esc(labelLeft)}">${esc(labelLeft)}</div>
        </div>
        <div class="readiness-pill" style="background:${pillBg};">Field Readiness ${readiness}</div>
      </div>

      <p class="subline">Rain (range): <span class="mono">${rainRange.toFixed(2)}</span> in</p>

      <div class="gauge-wrap">
        <div class="chips">
          <div class="chip wet">Wet</div>
          <div class="chip readiness">Readiness</div>
        </div>

        <div class="gauge">
          <div class="thr" style="left:${thrPos};"></div>
          <div class="marker" style="left:${leftPos};"></div>
          <div class="badge" style="left:${leftPos};">Field Readiness ${readiness}</div>
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
  if (empty) empty.style.display = state.fields.length ? 'none' : 'block';
}

function selectField(id){
  const f = state.fields.find(x=>x.id === id);
  if (!f) return;
  state.selectedFieldId = id;
  ensureSelectedParamsToSliders();
  refreshAll();
}

/* ---------- beta inputs UI ---------- */
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

  const trb = $('traceRows');
  if (trb){
    trb.innerHTML = '';
    for (const t of run.trace){
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="mono">${t.dateISO}</td>
        <td class="right mono">${t.rain.toFixed(2)}</td>
        <td class="right mono">${t.infilMult.toFixed(2)}</td>
        <td class="right mono">${t.add.toFixed(2)}</td>
        <td class="right mono">${t.dryPwr.toFixed(2)}</td>
        <td class="right mono">${t.loss.toFixed(2)}</td>
        <td class="right mono">${t.before.toFixed(2)}→${t.after.toFixed(2)}</td>
      `;
      trb.appendChild(tr);
    }
  }

  const drb = $('dryRows');
  if (drb){
    drb.innerHTML = '';
    for (const r of run.rows){
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="mono">${r.dateISO}</td>
        <td class="right mono">${Math.round(r.temp)}</td>
        <td class="right mono">${r.tempN.toFixed(2)}</td>
        <td class="right mono">${Math.round(r.wind)}</td>
        <td class="right mono">${r.windN.toFixed(2)}</td>
        <td class="right mono">${Math.round(r.rh)}</td>
        <td class="right mono">${r.rhN.toFixed(2)}</td>
        <td class="right mono">${Math.round(r.solar)}</td>
        <td class="right mono">${r.solarN.toFixed(2)}</td>
        <td class="right mono">${(r.vpd||0).toFixed(2)}</td>
        <td class="right mono">${(r.vpdN||0).toFixed(2)}</td>
        <td class="right mono">${Math.round(r.cloud||0)}</td>
        <td class="right mono">${(r.cloudN||0).toFixed(2)}</td>
        <td class="right mono">${r.raw.toFixed(2)}</td>
        <td class="right mono">${r.dryPwr.toFixed(2)}</td>
      `;
      drb.appendChild(tr);
    }
  }

  const wxb = $('wxRows');
  if (wxb){
    wxb.innerHTML = '';
    for (const r of run.rows){
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="mono">${r.dateISO}</td>
        <td class="right mono">${Number(r.rainInAdj||0).toFixed(2)}</td>
        <td class="right mono">${Math.round(r.temp)}</td>
        <td class="right mono">${Math.round(r.wind)}</td>
        <td class="right mono">${Math.round(r.rh)}</td>
        <td class="right mono">${Math.round(r.solar)}</td>
        <td class="right mono">${(r.et0||0).toFixed(2)}</td>
        <td class="right mono">${(r.sm010===null||r.sm010===undefined)?'—':Number(r.sm010).toFixed(3)}</td>
        <td class="right mono">${(r.st010F===null||r.st010F===undefined)?'—':Math.round(r.st010F)}</td>
      `;
      wxb.appendChild(tr);
    }
  }

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
function __tsToMs(ts){
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (ts.seconds && ts.nanoseconds != null){
    return (Number(ts.seconds)*1000) + Math.floor(Number(ts.nanoseconds)/1e6);
  }
  return 0;
}
function __setCooldownLine(text){
  // Prefer a dedicated element if it exists; otherwise append to adjHint
  const el = $('calibCooldownMsg') || $('adjCooldown');
  const hint = $('adjHint');
  if (el){
    el.style.display = text ? '' : 'none';
    el.textContent = text || '';
    return;
  }
  if (hint){
    // Keep hint + add a second subtle line (no HTML assumptions)
    if (!text){
      hint.textContent = String(hint.textContent || '').split('\n')[0];
    } else {
      const base = String(hint.textContent || '').split('\n')[0];
      hint.textContent = base + '\n' + text;
    }
  }
}

async function loadCooldownFromFirestore(){
  const api = getAPI();
  if (!api || api.kind === 'compat'){
    state._nextAllowedMs = 0;
    return;
  }
  try{
    const db = api.getFirestore();
    const ref = api.doc(db, WEIGHTS_COLLECTION, WEIGHTS_DOC);
    const snap = await api.getDoc(ref);
    if (!snap || !snap.exists || !snap.exists()){
      state._nextAllowedMs = 0;
      return;
    }
    const d = snap.data() || {};
    state._nextAllowedMs = __tsToMs(d.nextAllowedAt);
  }catch(e){
    console.warn('[FieldReadiness] cooldown read failed:', e);
    state._nextAllowedMs = 0;
  }
}

function startCooldownTicker(){
  const btn = $('btnAdjApply');
  function tick(){
    const now = Date.now();
    const locked = (state._nextAllowedMs && now < state._nextAllowedMs);
    if (btn) btn.disabled = !!locked;

    if (locked){
      __setCooldownLine(`Model update locked. Next allowed in ${__fmtDur(state._nextAllowedMs - now)}.`);
    } else {
      __setCooldownLine('');
    }
  }

  try{ if (state._cooldownTimer) clearInterval(state._cooldownTimer); }catch(_){}
  tick();
  state._cooldownTimer = setInterval(tick, 30000);
}
function stopCooldownTicker(){
  try{ if (state._cooldownTimer) clearInterval(state._cooldownTimer); }catch(_){}
  state._cooldownTimer = null;
  __setCooldownLine('');
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

/* About Right removed -> feel is only wet/dry */
function setFeel(feel){
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

function readIntensity0100(){
  const el = $('adjIntensity');
  const v = el ? Number(el.value) : 50;
  return clamp(Math.round(isFinite(v) ? v : 50), 0, 100);
}
function setIntensity0100(v){
  const el = $('adjIntensity');
  if (!el) return;
  el.value = String(clamp(Math.round(v), 0, 100));
  updateIntensityLabel();
}
function updateIntensityLabel(){
  const v = readIntensity0100();
  const out = $('adjIntensityVal');
  if (out) out.textContent = String(v);
}

/* Best-guess intensity starting point */
function guessIntensity(run, modelClass, feel){
  // Only used when opposite correction is chosen.
  // Use wetnessR as primary: farther from 50 -> stronger intensity.
  // Example:
  // - modelClass wet & user says dry: higher wetnessR => higher intensity
  // - modelClass dry & user says wet: lower wetnessR => higher intensity
  const w = clamp(Number(run?.wetnessR ?? 50), 0, 100);

  if (modelClass === 'wet' && feel === 'dry'){
    // if model says wet strongly (w=80), intensity ~60
    return clamp(Math.round((w - 50) * 2), 10, 100);
  }
  if (modelClass === 'dry' && feel === 'wet'){
    // if model says very dry (w=20), intensity ~60
    return clamp(Math.round((50 - w) * 2), 10, 100);
  }
  return 50;
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
  const feel = state._adjFeel; // wet|dry|null

  // About Right removed: require a direction
  if (!feel) return 0;

  let sign = 0;
  if (feel === 'wet') sign = +1;
  if (feel === 'dry') sign = -1;
  if (sign === 0) return 0;

  const opposite =
    (mc === 'wet' && feel === 'dry') ||
    (mc === 'dry' && feel === 'wet');

  // Base magnitude
  let mag = 8;

  // Only allow magnitude slider on opposite corrections
  if (opposite){
    const intensity = readIntensity0100();
    mag = 8 + Math.round((intensity/100) * 10);
  }

  // Quick Obs removed: no obsBoost anymore
  const delta = (sign * mag);
  return clamp(delta, -18, +18);
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
  const feel = state._adjFeel; // wet|dry|null

  // Keep your existing validation: if model says wet, wet disabled; if dry, dry disabled
  const bWet = $('btnFeelWet');
  const bDry = $('btnFeelDry');
  if (bWet) bWet.disabled = (mc === 'wet');
  if (bDry) bDry.disabled = (mc === 'dry');

  // If user selected the disabled direction, clear it
  if (mc === 'wet' && feel === 'wet') state._adjFeel = null;
  if (mc === 'dry' && feel === 'dry') state._adjFeel = null;

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
    // Set title and endpoints (same as your current copy)
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

    // ✅ Start slider at best guess (only if user just chose opposite)
    // We do NOT force it every render; only if it’s still at the default 50.
    const slider = $('adjIntensity');
    if (slider){
      const cur = Number(slider.value);
      if (!isFinite(cur) || cur === 50){
        setIntensity0100(guessIntensity(run, mc, state._adjFeel));
      }
    }
  }

  const hint = $('adjHint');
  if (hint){
    if (mc === 'wet'){
      hint.textContent = 'Model says WET → “Wet” disabled. Choose “Dry” to correct it (with intensity).';
    } else if (mc === 'dry'){
      hint.textContent = 'Model says DRY → “Dry” disabled. Choose “Wet” to correct it (with intensity).';
    } else {
      hint.textContent = 'Model says OK → choose Wet or Dry if it’s wrong.';
    }
  }

  // Disable Apply unless user chose a direction (and cooldown ticker may further disable)
  const applyBtn = $('btnAdjApply');
  if (applyBtn){
    const hasChoice = (state._adjFeel === 'wet' || state._adjFeel === 'dry');
    if (!hasChoice) applyBtn.disabled = true;
  }

  updateAdjustGuard();
}

/* ---------- logging + firestore write (kept, but GLOBAL-only now) ---------- */
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

  // About Right removed -> must pick wet/dry
  if (!feel || d === 0){
    return;
  }

  // GLOBAL calibration only: do NOT change per-field params here
  const entry = {
    // Context only (still helpful for audit)
    fieldId: f.id,
    fieldName: f.name || '',
    op: getCurrentOp(),

    // Calibration signals
    feel,
    intensity: readIntensity0100(),
    delta: d,

    // Explicitly mark this as a GLOBAL calibration
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

  // Refresh (no per-field param change now)
  refreshAll();
  closeAdjust();
}

/* ---------- open/close adjust (GLOBAL) ---------- */
async function openAdjustGlobal(){
  // Keep current selected field as the context (no per-field buttons anymore)
  if (!state.selectedFieldId && state.fields.length){
    state.selectedFieldId = state.fields[0].id;
  }

  const f = state.fields.find(x=>x.id===state.selectedFieldId);
  const sub = $('adjustSub');
  if (sub){
    sub.textContent = 'Global calibration';
    if (f && f.name) sub.textContent = `Global calibration • ${f.name}`;
  }

  // Clear/ignore Quick Obs
  const obs = $('adjObs');
  if (obs) obs.value = 'none';

  // Start intensity at 50 (we’ll set best-guess when opposite is chosen)
  const intensity = $('adjIntensity');
  if (intensity) intensity.value = '50';
  updateIntensityLabel();

  // Must choose wet/dry (no ok)
  state._adjFeel = null;

  // Update pills + UI first
  updateAdjustPills();
  updateAdjustGuard();

  // Load cooldown and start ticker
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
  const direct = $('fieldsTitle') || document.querySelector('[data-fields-tap]');
  let el = direct;

  if (!el){
    // fallback: find a header whose text is exactly "Fields"
    const heads = Array.from(document.querySelectorAll('h1,h2,h3'));
    el = heads.find(x => String(x.textContent || '').trim() === 'Fields') || null;
  }
  if (!el) return;

  // Make it feel like a hidden button, but subtle
  el.style.cursor = 'pointer';
  el.setAttribute('role','button');
  el.setAttribute('aria-label','Fields (tap for calibration)');

  el.addEventListener('click', (e)=>{
    // Don’t break other header behavior if it exists; just open
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

/* ---------- maps (kept as-is) ---------- */
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

/* ---------- wiring (same behavior) ---------- */
on('sortSel','change', refreshAll);
on('opSel','change', ()=>{ saveOpDefault(); refreshAll(); });

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

// Adjust modal buttons
on('btnAdjX','click', closeAdjust);
on('btnAdjCancel','click', closeAdjust);
on('btnAdjApply','click', ()=>{
  // If cooldown ticker has disabled it, do nothing
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
  const b = $('confirmAdjBackdrop');
  if (!b) return;
  b.addEventListener('click', (e)=>{
    if (e.target && e.target.id === 'confirmAdjBackdrop'){
      e.stopPropagation();
    }
  });
})();

(function(){
  const b = $('adjustBackdrop');
  if (!b) return;
  b.addEventListener('click', (e)=>{
    if (e.target && e.target.id === 'adjustBackdrop') closeAdjust();
  });
})();

// Feel segment
(function(){
  const seg = $('feelSeg');
  if (!seg) return;
  seg.addEventListener('click', (e)=>{
    const btn = e.target && e.target.closest ? e.target.closest('button[data-feel]') : null;
    if (!btn) return;
    const f = btn.getAttribute('data-feel');

    // Only allow wet/dry now (ignore 'ok' if it still exists in HTML)
    if (f !== 'wet' && f !== 'dry') return;
    setFeel(f);
  });
})();

on('adjObs','change', updateAdjustGuard);
on('adjIntensity','input', updateAdjustGuard);

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

  const ok = await importFirebaseInit();
  if (!ok) setErr('firebase-init.js failed to import as a module.');

  await loadThresholdsFromFirestore();
  await loadFarmsOptional();
  await loadFields();

  if (!state.selectedFieldId && state.fields.length){
    state.selectedFieldId = state.fields[0].id;
  }

  // ✅ Hidden global calibration entry point
  wireFieldsHiddenTap();

  ensureSelectedParamsToSliders();
  refreshAll();
})();
