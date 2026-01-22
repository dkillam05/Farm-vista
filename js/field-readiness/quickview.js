/* =====================================================================
/Farm-vista/js/field-readiness/quickview.js  (FULL FILE)
Rev: 2026-01-22a-quickview-ruleA-noRewind-noSaveTruth

RULE A (per Dane):
✅ Sliders change TANK SIZE + RATES only (live preview)
✅ Sliders do NOT change TODAY’S storage truth while sliding
✅ Save & Close updates ONLY:
   1) fields/{fieldId} params (RAW values you set)
   2) local cache (perFieldParams + localStorage)
❌ Save & Close does NOT write field_readiness_state (truth storage)
   - truth storage is changed only by global calibration (and/or dedicated truth tools)

Learning:
✅ Applies global learning DRY_LOSS_MULT (drying side only).

UI:
✅ Helper text stays the same
===================================================================== */
'use strict';

import { buildWxCtx, EXTRA, CONST, OPS } from './state.js';
import { getAPI } from './firebase.js';
import { getFieldParams, saveParamsToLocal } from './params.js';
import { getCurrentOp, getThresholdForOp } from './thresholds.js';
import { esc, clamp } from './utils.js';
import { canEdit } from './perm.js';
import { parseRangeFromInput, rainInRange } from './rain.js';

function $(id){ return document.getElementById(id); }

/* =====================================================================
   Truth state collection (kept; read-only here)
===================================================================== */
const FR_STATE_COLLECTION = 'field_readiness_state';

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
   CAL helper — MUST MATCH render.js (ALL ZERO)
===================================================================== */
function getCalForDeps(_state){
  return { wetBias:0, opWetBias:{}, readinessShift:0, opReadinessShift:{} };
}

/* =====================================================================
   Persisted truth state passthrough (used by Truth run)
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
   Global tuning read (learning apply) — DRY ONLY
===================================================================== */
const FR_TUNE_COLLECTION = 'field_readiness_tuning';
const FR_TUNE_DOC = 'global';
const TUNE_TTL_MS = 30000;

const DRY_LOSS_MULT_MIN = 0.30;
const DRY_LOSS_MULT_MAX = 3.00;

function safeObj(x){ return (x && typeof x === 'object') ? x : null; }
function safeNum(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function normalizeTuneDoc(d){
  const doc = safeObj(d) || {};
  const dryLoss = safeNum(doc.DRY_LOSS_MULT);
  return {
    DRY_LOSS_MULT: clamp((dryLoss == null ? 1.0 : dryLoss), DRY_LOSS_MULT_MIN, DRY_LOSS_MULT_MAX),
    updatedAt: doc.updatedAt || null
  };
}
async function loadGlobalTuning(state, { force=false } = {}){
  try{
    if (!state) return normalizeTuneDoc(null);

    const now = Date.now();
    const last = Number(state._qvTuneLoadedAt || 0);
    if (!force && state._qvGlobalTune && (now - last) < TUNE_TTL_MS){
      return state._qvGlobalTune;
    }

    const api = getAPI(state);
    const fallback = normalizeTuneDoc(null);

    if (!api){
      state._qvGlobalTune = fallback;
      state._qvTuneLoadedAt = now;
      return fallback;
    }

    if (api.kind === 'compat' && window.firebase && window.firebase.firestore){
      const db = window.firebase.firestore();
      const snap = await db.collection(FR_TUNE_COLLECTION).doc(FR_TUNE_DOC).get();
      const tuned = (snap && snap.exists) ? normalizeTuneDoc(snap.data() || {}) : fallback;
      state._qvGlobalTune = tuned;
      state._qvTuneLoadedAt = now;
      return tuned;
    }

    if (api.kind !== 'compat'){
      const db = api.getFirestore();
      const ref = api.doc(db, FR_TUNE_COLLECTION, FR_TUNE_DOC);
      const snap = await api.getDoc(ref);

      const ok =
        !!snap &&
        ((typeof snap.exists === 'function' && snap.exists()) || (snap.exists === true));

      const tuned = ok ? normalizeTuneDoc(snap.data() || {}) : fallback;
      state._qvGlobalTune = tuned;
      state._qvTuneLoadedAt = now;
      return tuned;
    }

    state._qvGlobalTune = fallback;
    state._qvTuneLoadedAt = now;
    return fallback;
  }catch(e){
    console.warn('[FieldReadiness] quickview tuning load failed:', e);
    const fallback = normalizeTuneDoc(null);
    try{
      state._qvGlobalTune = fallback;
      state._qvTuneLoadedAt = Date.now();
    }catch(_){}
    return fallback;
  }
}
async function getExtraForDeps(state){
  const t = await loadGlobalTuning(state);
  const dryLossMult = clamp(Number(t && t.DRY_LOSS_MULT ? t.DRY_LOSS_MULT : 1.0), DRY_LOSS_MULT_MIN, DRY_LOSS_MULT_MAX);
  return { ...EXTRA, DRY_LOSS_MULT: dryLossMult };
}

/* =====================================================================
   Map modal helpers (uses existing #mapBackdrop modal in field-readiness.html)
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

/* =====================================================================
   Quick View ↔ Map stacking fix
===================================================================== */
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

    // Update in-memory params immediately (Rule A)
    const p = getFieldParams(state, fid);
    p.soilWetness = clamp(Number(soil.value), 0, 100);
    p.drainageIndex = clamp(Number(drain.value), 0, 100);
    state.perFieldParams.set(fid, p);

    // Live-save local cache so Quick View stays consistent if closed without Save
    saveParamsToLocal(state);

    // Re-render inside modal (Rule A uses truth run only)
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

function renderTilePreview(state, run, thr){
  const wrap = $('frQvTilePreview');
  if (!wrap) return;

  const f = state.fields.find(x=>x.id===state._qvFieldId);
  if (!f || !run) return;

  const readiness = run.readinessR;
  const range = parseRangeFromInput();
  const rainRange = rainInRange(run, range);

  const leftPos = state._mods.model.markerLeftCSS(readiness);
  const thrPos  = state._mods.model.markerLeftCSS(thr);

  const perceived = perceivedFromThreshold(readiness, thr);
  const pillBg = colorForPerceived(perceived);
  const grad = gradientForThreshold(thr);

  const eta = state._mods.model.etaFor(run, thr, CONST.ETA_MAX_HOURS);

  wrap.innerHTML = `
    <div class="tile" style="cursor:default; user-select:none;">
      <div class="tile-top">
        <div class="titleline">
          <div class="name" title="${esc(f.name)}">${esc(f.name)}</div>
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
    </div>
  `;
}

async function fillQuickView(state, { live=false } = {}){
  const fid = state._qvFieldId;
  const f = state.fields.find(x=>x.id===fid);
  if (!f) return;

  const opKey = getCurrentOp();
  const CAL = getCalForDeps(state);

  const wxCtx = buildWxCtx(state);
  const extraWithLearning = await getExtraForDeps(state);

  // RULE A: Always show TRUTH run (persisted seed + current params).
  // Sliders update params live (tank size + rate response), but do not rewrite truth storage.
  const depsTruth = {
    getWeatherSeriesForFieldId: (fieldId)=> state._mods.weather.getWeatherSeriesForFieldId(fieldId, wxCtx),
    getFieldParams: (id)=> getFieldParams(state, id),
    LOSS_SCALE: CONST.LOSS_SCALE,
    EXTRA: extraWithLearning,
    opKey,
    CAL,
    getPersistedState: (id)=> getPersistedStateForDeps(state, id)
  };

  const runTruth = state._mods.model.runField(f, depsTruth);
  const displayRun = runTruth;

  const farmName = state.farmsById.get(f.farmId) || '';
  const opLabel = (OPS.find(o=>o.key===opKey)?.label) || opKey;
  const thr = getThresholdForOp(state, opKey);

  const title = $('frQvTitle');
  const sub = $('frQvSub');
  if (title) title.textContent = f.name || 'Field';
  if (sub) sub.textContent = farmName ? `${farmName} • Truth (Rule A)` : 'Truth (Rule A)';

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
    if (hint) hint.textContent = 'Rule A: sliders change tank + rates only. Save stores sliders (does not change truth storage).';
    if (saveBtn) saveBtn.disabled = false;
    if (inputsPanel) inputsPanel.style.opacity = '1';
  }

  setText('frQvFieldName', farmName ? `${farmName} • ${f.name}` : (f.name || '—'));
  setText('frQvCounty', `${String(f.county||'—')} / ${String(f.state||'—')}`);
  setText('frQvAcres', isFinite(f.tillable) ? `${f.tillable.toFixed(2)} ac` : '—');

  const gpsText = f.location ? `${f.location.lat.toFixed(6)}, ${f.location.lng.toFixed(6)}` : '—';
  setText('frQvGps', gpsText);

  const mapBtn = $('frQvMapBtn');
  if (mapBtn) mapBtn.disabled = !(f && f.location);

  setText('frQvOp', opLabel);
  setText('frQvThr', thr);

  const range = parseRangeFromInput();
  const rr = displayRun ? rainInRange(displayRun, range) : 0;
  setText('frQvRain', displayRun ? `${rr.toFixed(2)} in` : '—');
  setText('frQvReadiness', displayRun ? displayRun.readinessR : '—');
  setText('frQvWetness', displayRun ? displayRun.wetnessR : '—');
  setText('frQvStorage', displayRun ? `${displayRun.storageFinal.toFixed(2)} / ${displayRun.factors.Smax.toFixed(2)}` : '—');

  const info = state.wxInfoByFieldId.get(f.id) || null;
  const when = (info && info.fetchedAt) ? new Date(info.fetchedAt) : null;
  const whenTxt = when ? when.toLocaleString() : '—';
  const wxMeta = $('frQvWxMeta');

  if (wxMeta){
    const truthR = (runTruth && isFinite(Number(runTruth.readinessR))) ? Number(runTruth.readinessR) : null;
    wxMeta.innerHTML =
      `Weather updated: <span class="mono">${esc(whenTxt)}</span>` +
      (truthR != null ? ` • Truth: <span class="mono">${truthR}</span>` : ``);
  }

  const pe = $('frQvParamExplain');
  if (pe){
    pe.innerHTML =
      `soil=<span class="mono">${Math.round(Number(pRaw.soilWetness||0))}</span>/100 • ` +
      `drain=<span class="mono">${Math.round(Number(pRaw.drainageIndex||0))}</span>/100`;
  }

  renderTilePreview(state, displayRun, thr);
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
    // Save RAW params locally
    const p = getFieldParams(state, fid);
    p.soilWetness = soilWetness;
    p.drainageIndex = drainageIndex;
    state.perFieldParams.set(fid, p);
    saveParamsToLocal(state);

    // Mirror on field object
    f.soilWetness = soilWetness;
    f.drainageIndex = drainageIndex;

    // Save RAW params to Firestore fields/{fid}
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

    // RULE A: DO NOT write truth storage here.
    // Refresh UI to show new params effects (tank size/rates), but truth storage remains.
    try{ document.dispatchEvent(new CustomEvent('fr:tile-refresh', { detail:{ fieldId: fid } })); }catch(_){}
    try{ document.dispatchEvent(new CustomEvent('fr:details-refresh', { detail:{ fieldId: fid } })); }catch(_){}
    // no fr:soft-reload needed; we did not change persisted truth

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
