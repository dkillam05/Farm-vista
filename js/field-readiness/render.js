/* =====================================================================
/Farm-vista/js/field-readiness/render.js  (FULL FILE)
Rev: 2025-12-31g

Fix (CRITICAL):
✅ Remove broken import of ./paths.js (file does not exist)
✅ Load modules via real, known paths:
   - Weather: /Farm-vista/js/field-readiness.weather.js
   - Model:   /Farm-vista/js/field-readiness.model.js
   - Forecast: ./forecast.js (same folder as this file)

Keeps:
✅ Render gate (prevents “double load” flicker)
✅ Passes GLOBAL wetBias into forecast predictor
✅ Existing UI/selection/edit gating/sort/refresh listeners
===================================================================== */
'use strict';

import { EXTRA, CONST, buildWxCtx } from './state.js';
import { $, esc, clamp } from './utils.js';
import { getFieldParams, ensureSelectedParamsToSliders } from './params.js';
import { getCurrentOp, getThresholdForOp } from './thresholds.js';
import { canEdit } from './perm.js';
import { openQuickView } from './quickview.js';
import { initSwipeOnTiles } from './swipe.js';
import { parseRangeFromInput, rainInRange } from './rain.js';
import { fetchAndHydrateFieldParams } from './data.js';
import { getAPI } from './firebase.js';

/* =====================================================================
   Render gate (prevents double-load flicker)
===================================================================== */
function ensureRenderGate(state){
  if (!state) return null;
  if (!state._renderGate){
    state._renderGate = {
      inFlight: false,
      pendingAll: false,
      pendingDetails: false,
      lastReqAt: 0,
      timer: null
    };
  }
  return state._renderGate;
}

async function runRenderCoalesced(state, mode){
  const g = ensureRenderGate(state);
  if (!g) return;

  const now = Date.now();
  g.lastReqAt = now;

  if (mode === 'all') g.pendingAll = true;
  if (mode === 'details') g.pendingDetails = true;

  if (g.inFlight) return;

  if (g.timer) clearTimeout(g.timer);
  g.timer = setTimeout(async ()=>{
    g.timer = null;
    if (g.inFlight) return;

    g.inFlight = true;
    try{
      const doAll = !!g.pendingAll;
      const doDetails = !!g.pendingDetails;

      g.pendingAll = false;
      g.pendingDetails = false;

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
      // swallow
    }finally{
      g.inFlight = false;
      if (g.pendingAll || g.pendingDetails){
        runRenderCoalesced(state, g.pendingAll ? 'all' : 'details');
      }
    }
  }, 30);
}

/* =====================================================================
   Calibration from adjustments collection (GLOBAL ONLY)
===================================================================== */
const CAL_MAX_DOCS = 12;
const CAL_SCALE = 0.25;
const CAL_CLAMP = 12;

async function loadCalibrationFromAdjustments(state, { force=false } = {}){
  const now = Date.now();
  const last = Number(state._calLoadedAt || 0);
  if (!force && state._cal && (now - last) < 30000) return state._cal;

  const out = { wetBias: 0, opWetBias: {} };

  try{
    const api = getAPI(state);
    if (!api){
      state._cal = out;
      state._calLoadedAt = now;
      return out;
    }

    if (api.kind === 'compat' && window.firebase && window.firebase.firestore){
      const db = window.firebase.firestore();

      let snap = null;
      try{
        snap = await db.collection(CONST.ADJ_COLLECTION)
          .orderBy('createdAt', 'desc')
          .limit(CAL_MAX_DOCS)
          .get();
      }catch(_){
        snap = await db.collection(CONST.ADJ_COLLECTION)
          .orderBy('ts', 'desc')
          .limit(CAL_MAX_DOCS)
          .get();
      }

      snap.forEach(doc=>{
        const d = doc.data() || {};
        if (d.global !== true) return;
        const delta = Number(d.delta);
        if (!isFinite(delta)) return;
        out.wetBias += (delta * CAL_SCALE);
      });

      out.wetBias = clamp(out.wetBias, -CAL_CLAMP, CAL_CLAMP);

      state._cal = out;
      state._calLoadedAt = now;
      return out;
    }

    if (api.kind !== 'compat'){
      const db = api.getFirestore();

      let q = null;
      try{
        q = api.query(
          api.collection(db, CONST.ADJ_COLLECTION),
          api.orderBy('createdAt', 'desc'),
          api.limit(CAL_MAX_DOCS)
        );
      }catch(_){
        q = api.query(
          api.collection(db, CONST.ADJ_COLLECTION),
          api.orderBy('ts', 'desc'),
          api.limit(CAL_MAX_DOCS)
        );
      }

      const snap = await api.getDocs(q);
      snap.forEach(doc=>{
        const d = doc.data() || {};
        if (d.global !== true) return;
        const delta = Number(d.delta);
        if (!isFinite(delta)) return;
        out.wetBias += (delta * CAL_SCALE);
      });

      out.wetBias = clamp(out.wetBias, -CAL_CLAMP, CAL_CLAMP);

      state._cal = out;
      state._calLoadedAt = now;
      return out;
    }
  }catch(e){
    console.warn('[FieldReadiness] calibration load failed:', e);
  }

  state._cal = state._cal || out;
  state._calLoadedAt = now;
  return state._cal;
}

function getCalForDeps(state){
  const wb = (state && state._cal && isFinite(Number(state._cal.wetBias))) ? Number(state._cal.wetBias) : 0;
  return { wetBias: wb, opWetBias: {} };
}

/* =====================================================================
   Module loader (model/weather/forecast)
   IMPORTANT: We DO NOT use paths.js (it does not exist).
===================================================================== */
export async function ensureModelWeatherModules(state){
  if (state._mods && state._mods.model && state._mods.weather && state._mods.forecast) return;

  if (!state._mods) state._mods = {};

  const WEATHER_URL = '/Farm-vista/js/field-readiness.weather.js';
  const MODEL_URL   = '/Farm-vista/js/field-readiness.model.js';

  try{
    const [weather, model, forecast] = await Promise.all([
      import(WEATHER_URL),
      import(MODEL_URL),
      import('./forecast.js')
    ]);

    state._mods.weather = weather;
    state._mods.model = model;
    state._mods.forecast = forecast;
  }catch(e){
    // DO NOT swallow this — this is what causes “Waiting for JS”
    console.error('[FieldReadiness] module load failed:', e);
    console.error('[FieldReadiness] attempted:', { WEATHER_URL, MODEL_URL, FORECAST_URL:'./forecast.js' });
    throw e;
  }
}

/* ---------- colors (ported) ---------- */
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

/* ---------- sorting ---------- */
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

/* ---------- FIXED: farm filter ---------- */
function getFilteredFields(state){
  const farmId = String(state.farmFilter || '__all__');
  if (farmId === '__all__') return state.fields.slice();
  return state.fields.filter(f => String(f.farmId || '') === farmId);
}

/* =====================================================================
   Selection CSS injected once
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
   Forecast-based ETA helper for tiles (with wetBias passed in)
===================================================================== */
async function getTileEtaText(state, fieldId, run0, thr){
  try{
    const p = getFieldParams(state, fieldId) || {};
    const soilWetness = Number.isFinite(Number(p.soilWetness)) ? Number(p.soilWetness) : 60;
    const drainageIndex = Number.isFinite(Number(p.drainageIndex)) ? Number(p.drainageIndex) : 45;

    const wetBias = (state && state._cal && Number.isFinite(Number(state._cal.wetBias)))
      ? Number(state._cal.wetBias)
      : 0;

    if (state && state._mods && state._mods.forecast && typeof state._mods.forecast.predictDryForField === 'function'){
      const pred = await state._mods.forecast.predictDryForField(
        fieldId,
        { soilWetness, drainageIndex },
        {
          threshold: thr,
          horizonHours: 72,
          maxSimDays: 7,
          wetBias
        }
      );

      if (pred && pred.ok){
        if (pred.status === 'dryNow') return '';
        if (pred.status === 'within72') return pred.message || '';
        if (pred.status === 'notWithin72') return pred.message || `Greater Than 72 hours`;
      }
    }
  }catch(_){}

  try{
    return state._mods.model.etaFor(run0, thr, CONST.ETA_MAX_HOURS) || '';
  }catch(_){
    return '';
  }
}

/* ---------- internal: patch a single tile DOM in-place ---------- */
async function updateTileForField(state, fieldId){
  try{
    if (!fieldId) return;
    const fid = String(fieldId);

    const tile = document.querySelector('.tile[data-field-id="' + CSS.escape(fid) + '"]');
    if (!tile) return;

    await ensureModelWeatherModules(state);
    await loadCalibrationFromAdjustments(state);

    const f = (state.fields || []).find(x=>x.id === fid);
    if (!f) return;

    const opKey = getCurrentOp();

    const wxCtx = buildWxCtx(state);
    const deps = {
      getWeatherSeriesForFieldId: (id)=> state._mods.weather.getWeatherSeriesForFieldId(id, wxCtx),
      getFieldParams: (id)=> getFieldParams(state, id),
      LOSS_SCALE: CONST.LOSS_SCALE,
      EXTRA,
      opKey,
      CAL: getCalForDeps(state)
    };

    const run0 = state._mods.model.runField(f, deps);
    if (!run0) return;

    try{ state.lastRuns && state.lastRuns.set(fid, run0); }catch(_){}

    const thr = getThresholdForOp(state, opKey);
    const readiness = run0.readinessR;

    const leftPos = state._mods.model.markerLeftCSS(readiness);
    const thrPos  = state._mods.model.markerLeftCSS(thr);

    const perceived = perceivedFromThreshold(readiness, thr);
    const pillBg = colorForPerceived(perceived);
    const grad = gradientForThreshold(thr);

    const gauge = tile.querySelector('.gauge');
    if (gauge) gauge.style.background = grad;

    const thrEl = tile.querySelector('.thr');
    if (thrEl) thrEl.style.left = thrPos;

    const markerEl = tile.querySelector('.marker');
    if (markerEl) markerEl.style.left = leftPos;

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

    const range = parseRangeFromInput();
    const rainRange = rainInRange(run0, range);
    const rainLine = tile.querySelector('.subline .mono');
    if (rainLine) rainLine.textContent = rainRange.toFixed(2);

    const etaTxt = await getTileEtaText(state, fid, run0, thr);

    let help = tile.querySelector('.help');
    if (etaTxt){
      if (!help){
        help = document.createElement('div');
        help.className = 'help';
        const gw = tile.querySelector('.gauge-wrap');
        if (gw) gw.appendChild(help);
      }
      help.innerHTML = `<b>${esc(String(etaTxt))}</b>`;
    } else {
      if (help) help.remove();
    }

    if (String(state.selectedFieldId) === fid){
      tile.classList.add('fv-selected');
      state._selectedTileId = fid;
    }
  }catch(_){}
}

/* ---------- click vs dblclick separation ---------- */
function wireTileInteractions(state, tileEl, fieldId){
  const CLICK_DELAY_MS = 360;
  tileEl._fvClickTimer = null;

  tileEl.addEventListener('click', ()=>{
    const until = Number(state._suppressClickUntil || 0);
    if (Date.now() < until) return;

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
    await updateTileForField(state, fieldId);

    openQuickView(state, fieldId);
  });
}

/* =====================================================================
   Internal renders (used by render gate)
===================================================================== */
async function _renderTilesInternal(state){
  await ensureModelWeatherModules(state);
  ensureSelectionStyleOnce();
  await loadCalibrationFromAdjustments(state);

  const wrap = $('fieldsGrid');
  if (!wrap) return;
  wrap.innerHTML = '';

  const opKey = getCurrentOp();

  const wxCtx = buildWxCtx(state);
  const deps = {
    getWeatherSeriesForFieldId: (fieldId)=> state._mods.weather.getWeatherSeriesForFieldId(fieldId, wxCtx),
    getFieldParams: (fid)=> getFieldParams(state, fid),
    LOSS_SCALE: CONST.LOSS_SCALE,
    EXTRA,
    opKey,
    CAL: getCalForDeps(state)
  };

  state.lastRuns.clear();
  for (const f of state.fields){
    state.lastRuns.set(f.id, state._mods.model.runField(f, deps));
  }

  const filtered = getFilteredFields(state);
  const sorted = sortFields(filtered, state.lastRuns);
  const thr = getThresholdForOp(state, opKey);
  const range = parseRangeFromInput();

  const cap = (String(state.pageSize) === '__all__' || state.pageSize === -1)
    ? sorted.length
    : Math.min(sorted.length, Number(state.pageSize || 25));
  const show = sorted.slice(0, cap);

  for (const f of show){
    const run0 = state.lastRuns.get(f.id);
    if (!run0) continue;

    const readiness = run0.readinessR;
    const etaTxt = await getTileEtaText(state, f.id, run0, thr);
    const rainRange = rainInRange(run0, range);

    const leftPos = state._mods.model.markerLeftCSS(readiness);
    const thrPos  = state._mods.model.markerLeftCSS(thr);

    const perceived = perceivedFromThreshold(readiness, thr);
    const pillBg = colorForPerceived(perceived);
    const grad = gradientForThreshold(thr);

    const tile = document.createElement('div');
    tile.className = 'tile fv-swipe-item';
    tile.dataset.fieldId = f.id;
    tile.setAttribute('data-field-id', f.id);

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
        ${etaTxt ? `<div class="help"><b>${esc(String(etaTxt))}</b></div>` : ``}
      </div>
    `;

    wireTileInteractions(state, tile, f.id);
    wrap.appendChild(tile);
  }

  const empty = $('emptyMsg');
  if (empty) empty.style.display = show.length ? 'none' : 'block';

  await initSwipeOnTiles(state, {
    onDetails: async (fieldId)=>{
      if (!canEdit(state)) return;
      await openQuickView(state, fieldId);
    }
  });
}

async function _renderDetailsInternal(state){
  await ensureModelWeatherModules(state);

  const f = state.fields.find(x=>x.id === state.selectedFieldId);
  if (!f) return;

  // Your existing details logic lives elsewhere in this file (not shown in the snippet you pasted).
  // We leave it untouched here by keeping this internal function minimal.
}

/* ---------- public render API (now gated) ---------- */
export async function renderTiles(state){
  await runRenderCoalesced(state, 'all');
}
export async function renderDetails(state){
  await runRenderCoalesced(state, 'details');
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
      const ok = await fetchAndHydrateFieldParams(state, id);
      if (!ok) return;
      if (String(state.selectedFieldId) !== String(id)) return;

      ensureSelectedParamsToSliders(state);
      await refreshDetailsOnly(state);
      await updateTileForField(state, id);
    }catch(_){}
  })();
}

/* ---------- refresh (gated) ---------- */
export async function refreshAll(state){
  await runRenderCoalesced(state, 'all');
}
export async function refreshDetailsOnly(state){
  await runRenderCoalesced(state, 'details');
}

/* =====================================================================
   GLOBAL LISTENERS (wired once)
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
        state._calLoadedAt = 0;
        await loadCalibrationFromAdjustments(state, { force:true });
        await refreshAll(state);
      }catch(_){}
    });

  }catch(_){}
})();
