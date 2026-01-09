/* =====================================================================
/Farm-vista/js/field-readiness/render.js  (FULL FILE)
Rev: 2026-01-09b-readinessShift-cal1

RECOVERY (critical):
✅ Fix syntax issues so module loads and tiles render again.

NEW (per Dane global calibration goal):
✅ Calibration loader now supports DIRECT readiness shift (1:1 points):
   - Uses newest global calibration doc’s (readinessSlider - readinessAnchor)
   - Applies to ALL fields immediately (via model CAL.readinessShift)
✅ Keeps existing wetBias behavior (physics lean) unchanged.

Keeps:
✅ ETA tap behavior, fast tile build, in-place updates, forecast rows, etc.
===================================================================== */
'use strict';

// NOTE: do NOT import PATHS; some builds don't have paths.js
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

  // already rendering; it'll loop once more if anything was requested
  if (g.inFlight) return;

  // coalesce bursts
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
      // swallow: render should not crash page
    }finally{
      g.inFlight = false;

      // run once more if queued during render
      if (g.wantAll || g.wantDetails){
        scheduleRender(state, g.wantAll ? 'all' : 'details');
      }
    }
  }, 25);
}

/* =====================================================================
   Calibration from adjustments collection (GLOBAL ONLY)

   Existing:
   - wetBias accumulates recent deltas (scaled) for physics lean.

   NEW:
   - readinessShift is taken from the NEWEST global adjustment that includes:
       readinessAnchor + readinessSlider
     and is applied 1:1 to readiness (ALL fields).
===================================================================== */
const CAL_MAX_DOCS = 12;
const CAL_SCALE = 0.25;
const CAL_CLAMP = 12;

// Direct readiness shift clamp (1:1 points)
const READY_SHIFT_CLAMP = 35;

function safeNum(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function computeReadinessShiftFromDoc(d){
  // Prefer explicit anchor/slider if present (your current global-calibration.js writes these)
  const a = safeNum(d && d.readinessAnchor);
  const s = safeNum(d && d.readinessSlider);

  if (a != null && s != null){
    // slider is the “truth” for readiness; anchor is what model said at time of adjust
    const shift = Math.round(s - a);
    return clamp(shift, -READY_SHIFT_CLAMP, READY_SHIFT_CLAMP);
  }

  // Fallback if older docs stored readinessBefore
  const before = safeNum(d && d.model && d.model.readinessBefore);
  const s2 = safeNum(d && d.readinessSlider);
  if (before != null && s2 != null){
    const shift = Math.round(s2 - before);
    return clamp(shift, -READY_SHIFT_CLAMP, READY_SHIFT_CLAMP);
  }

  return null;
}

async function loadCalibrationFromAdjustments(state, { force=false } = {}){
  const now = Date.now();
  const last = Number(state._calLoadedAt || 0);
  if (!force && state._cal && (now - last) < 30000) return state._cal;

  // ✅ expanded CAL shape
  const out = {
    wetBias: 0,
    opWetBias: {},
    readinessShift: 0,
    opReadinessShift: {}
  };

  try{
    const api = getAPI(state);
    if (!api){
      state._cal = out;
      state._calLoadedAt = now;
      return out;
    }

    // Helper: apply docs (common logic)
    const applyDocs = (docs)=>{
      let pickedGlobalShift = false;

      // Newest first (query already desc)
      for (const d0 of docs){
        const d = d0 || {};
        if (d.global !== true) continue;

        // ---- wetBias accumulate (existing) ----
        const delta = Number(d.delta);
        if (Number.isFinite(delta)){
          out.wetBias += (delta * CAL_SCALE);
        }

        // ---- readinessShift pick newest (NEW) ----
        if (!pickedGlobalShift){
          const rs = computeReadinessShiftFromDoc(d);
          if (rs != null){
            out.readinessShift = rs;
            pickedGlobalShift = true;
          }
        }

        // Optional: per-op readiness shift (if you ever want it)
        // (kept harmless — only sets if doc has op and a usable shift)
        try{
          const op = String(d.op || '');
          if (op && out.opReadinessShift && out.opReadinessShift[op] == null){
            const rsOp = computeReadinessShiftFromDoc(d);
            if (rsOp != null) out.opReadinessShift[op] = rsOp;
          }
        }catch(_){}
      }

      out.wetBias = clamp(out.wetBias, -CAL_CLAMP, CAL_CLAMP);
      out.readinessShift = clamp(out.readinessShift, -READY_SHIFT_CLAMP, READY_SHIFT_CLAMP);
    };

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

      const docs = [];
      snap.forEach(doc => docs.push(doc.data() || {}));
      applyDocs(docs);

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
      const docs = [];
      snap.forEach(doc => docs.push(doc.data() || {}));
      applyDocs(docs);

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
  const cal = (state && state._cal && typeof state._cal === 'object') ? state._cal : {};
  const wb = Number.isFinite(Number(cal.wetBias)) ? Number(cal.wetBias) : 0;
  const rs = Number.isFinite(Number(cal.readinessShift)) ? Number(cal.readinessShift) : 0;

  const opWB = (cal.opWetBias && typeof cal.opWetBias === 'object') ? cal.opWetBias : {};
  const opRS = (cal.opReadinessShift && typeof cal.opReadinessShift === 'object') ? cal.opReadinessShift : {};

  return {
    wetBias: wb,
    opWetBias: opWB,
    readinessShift: rs,
    opReadinessShift: opRS
  };
}

/* ---------- module loader (model/weather/forecast) ---------- */
export async function ensureModelWeatherModules(state){
  if (state._mods && state._mods.model && state._mods.weather && state._mods.forecast) return;

  if (!state._mods) state._mods = {};

  const WEATHER_URL = '/Farm-vista/js/field-readiness.weather.js';
  const MODEL_URL   = '/Farm-vista/js/field-readiness.model.js';

  const [weather, model, forecast] = await Promise.all([
    import(WEATHER_URL),
    import(MODEL_URL),
    import('./forecast.js')
  ]);

  state._mods.weather = weather;
  state._mods.model = model;
  state._mods.forecast = forecast;
}

/* =====================================================================
   ETA helper loader + dispatcher
===================================================================== */
const ETA_HELPER_URL = '/Farm-vista/js/field-readiness/eta-helper.js';
const ETA_HELP_EVENT = 'fr:eta-help';
const ETA_HORIZON_HOURS = 168;

async function ensureEtaHelperModule(state){
  try{
    if (!state) return;
    if (!state._mods) state._mods = {};
    if (state._mods.etaHelperLoaded) return;

    // best-effort dynamic import so its listener exists
    await import(ETA_HELPER_URL);
    state._mods.etaHelperLoaded = true;
  }catch(e){
    // Do not crash the page if helper fails; still allow tiles/details to render.
    console.warn('[FieldReadiness] eta-helper load failed:', e);
  }
}

function dispatchEtaHelp(state, payload){
  try{
    // Ensure listener is likely there (best effort). Do not await; we want instant UI response.
    ensureEtaHelperModule(state);
  }catch(_){}

  try{
    document.dispatchEvent(new CustomEvent(ETA_HELP_EVENT, { detail: payload || {} }));
  }catch(_){}
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

      /* ETA clickable target (tile only) — lower-left, smaller, not bold */
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
        font-weight: 500; /* not bold */
        font-size: 12px;  /* smaller */
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
   Details header panel (Farm • Field)
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

  const panel = ensureDetailsHeaderPanel();
  if (!panel) return;

  const farmName = (state.farmsById && state.farmsById.get) ? (state.farmsById.get(f.farmId) || '') : '';
  const title = farmName ? `${farmName} • ${f.name || ''}` : (f.name || '—');
  const loc = (f.county || f.state) ? `${String(f.county||'—')} / ${String(f.state||'—')}` : '';

  panel.innerHTML = `
    <div class="frdh-title">${esc(title)}</div>
    ${loc ? `<div class="frdh-sub">${esc(loc)}</div>` : ``}
  `;
}

/* =====================================================================
   Forecast-based ETA helper for tiles (with wetBias passed in)
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

  if (/greater\s+than/i.test(s) || />\s*\d+/.test(s)){
    return `>${Math.round(horizonHours)}h`;
  }

  return s;
}

async function getTileEtaText(state, fieldId, run0, thr){
  const HORIZON_HOURS = ETA_HORIZON_HOURS; // ✅ 7-day
  const NEAR_THR_POINTS = 5;

  let legacyTxt = '';
  try{
    legacyTxt = state._mods.model.etaFor(run0, thr, HORIZON_HOURS) || '';
  }catch(_){
    legacyTxt = '';
  }
  const legacyHours = parseEtaHoursFromText(legacyTxt);

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
          horizonHours: HORIZON_HOURS,
          maxSimDays: 7,
          wetBias
        }
      );

      if (pred && pred.ok){
        if (pred.status === 'dryNow') return '';

        if (pred.status === 'within72'){
          return pred.message || '';
        }

        if (pred.status === 'notWithin72'){
          const rNow = Number(run0 && run0.readinessR);
          const near = Number.isFinite(rNow) ? ((thr - rNow) >= 0 && (thr - rNow) <= NEAR_THR_POINTS) : false;

          if (near && legacyHours !== null && legacyHours <= HORIZON_HOURS){
            return compactEtaForMobile(legacyTxt, HORIZON_HOURS);
          }

          return pred.message || `>${HORIZON_HOURS}h`;
        }
      }
    }
  }catch(_){}

  return legacyTxt ? compactEtaForMobile(legacyTxt, HORIZON_HOURS) : '';
}

/* =====================================================================
   View key: if unchanged, we update numbers only (no rebuild)
===================================================================== */
function getTilesViewKey(state){
  const opKey = getCurrentOp();
  const farmId = String(state && state.farmFilter ? state.farmFilter : '__all__');
  const pageSize = String(state && state.pageSize != null ? state.pageSize : '');
  const sortSel = $('sortSel');
  const sort = String(sortSel ? sortSel.value : 'name_az');
  const rangeStr = String(($('jobRangeInput') && $('jobRangeInput').value) ? $('jobRangeInput').value : '');
  return `${opKey}__${farmId}__${pageSize}__${sort}__${rangeStr}`;
}

async function updateVisibleTilesBatched(state, ids){
  const list = Array.isArray(ids) ? ids.slice() : [];
  if (!list.length) return;

  const BATCH = 6;

  return new Promise((resolve)=>{
    const step = async ()=>{
      try{
        const n = Math.min(BATCH, list.length);
        for (let i=0; i<n; i++){
          const fid = list.shift();
          if (fid) await updateTileForField(state, fid);
        }
      }catch(_){}

      if (list.length){
        setTimeout(step, 0);
      } else {
        resolve();
      }
    };
    setTimeout(step, 0);
  });
}

/* =====================================================================
   ETA help UI in tile (render + tap wiring)
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

      // Prefer the dedicated slot at the bottom of the tile (lower-left)
      const slot = tile.querySelector('.etaSlot');
      if (slot) slot.appendChild(help);
      else {
        const gw = tile.querySelector('.gauge-wrap');
        if (gw) gw.appendChild(help);
        else tile.appendChild(help);
      }
    }

    // Build a real tap target (only the ETA text is clickable)
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'eta-help-btn';
    btn.setAttribute('aria-label', 'Open ETA helper');
    btn.textContent = etaTxt;

    btn.addEventListener('click', (e)=>{
      try{
        e.preventDefault();
        e.stopPropagation(); // do NOT select the tile
      }catch(_){}

      const payload = {
        fieldId: String(ctx.fieldId || ''),
        fieldName: String(ctx.fieldName || ''),
        opKey: String(ctx.opKey || ''),
        threshold: Number(ctx.threshold),
        readinessNow: Number(ctx.readinessNow),
        etaText: etaTxt,
        horizonHours: Number(ctx.horizonHours || ETA_HORIZON_HOURS),

        // Optional context for helper if it wants it:
        nowTs: Date.now(),
        note: 'ReadinessNow uses history-only; ETA uses forecast drying/forecast rain until threshold.'
      };

      dispatchEtaHelp(state, payload);
    }, { passive:false });

    help.replaceChildren(btn);
  }catch(_){}
}

/* ---------- internal: patch a single tile DOM in-place ---------- */
async function updateTileForField(state, fieldId){
  try{
    if (!fieldId) return;
    const fid = String(fieldId);

    const tile = document.querySelector('.tile[data-field-id="' + CSS.escape(fid) + '"]');
    if (!tile) return;

    await ensureModelWeatherModules(state);
    ensureSelectionStyleOnce();
    await loadCalibrationFromAdjustments(state);
    // Best-effort: ensure helper listener exists
    ensureEtaHelperModule(state);

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

    // ✅ Render ETA as the only clickable target and dispatch event to helper
    upsertEtaHelp(state, tile, {
      fieldId: fid,
      fieldName: String(f.name || ''),
      opKey,
      threshold: thr,
      readinessNow: readiness,
      etaText: etaTxt,
      horizonHours: ETA_HORIZON_HOURS
    });

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

/* ---------- tile render (CORE) ---------- */
async function _renderTilesInternal(state){
  await ensureModelWeatherModules(state);
  ensureSelectionStyleOnce();
  await loadCalibrationFromAdjustments(state);
  // Best-effort: load helper now so tap works immediately
  ensureEtaHelperModule(state);

  const wrap = $('fieldsGrid');
  if (!wrap) return;

  const viewKey = getTilesViewKey(state);
  const prevKey = String(state._fvTilesViewKey || '');
  const hasTiles = !!wrap.querySelector('.tile[data-field-id]');
  const sameView = (prevKey === viewKey) && hasTiles;

  state._fvTilesViewKey = viewKey;

  // ✅ SAME VIEW: update numbers only (no clear/rebuild)
  if (sameView){
    const tiles = Array.from(wrap.querySelectorAll('.tile[data-field-id]'));
    const cap = (String(state.pageSize) === '__all__' || state.pageSize === -1)
      ? tiles.length
      : Math.min(tiles.length, Number(state.pageSize || 25));
    const ids = tiles.slice(0, cap).map(t=>String(t.getAttribute('data-field-id')||'')).filter(Boolean);
    await updateVisibleTilesBatched(state, ids);
    return;
  }

  // ⛔ View changed OR first build: rebuild list order, but do it FAST (no ETA awaits in loop)
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

  const filtered = getFilteredFields(state);

  // compute runs for sorting + numbers
  state.lastRuns.clear();
  for (const f of state.fields){
    // keep original behavior (compute for all fields)
    state.lastRuns.set(f.id, state._mods.model.runField(f, deps));
  }

  const sorted = sortFields(filtered, state.lastRuns);
  const thr = getThresholdForOp(state, opKey);
  const range = parseRangeFromInput();

  const cap = (String(state.pageSize) === '__all__' || state.pageSize === -1)
    ? sorted.length
    : Math.min(sorted.length, Number(state.pageSize || 25));
  const show = sorted.slice(0, cap);

  // Build DOM in one shot so it appears immediately
  const frag = document.createDocumentFragment();
  const idsForEta = [];

  for (const f of show){
    const run0 = state.lastRuns.get(f.id);
    if (!run0) continue;

    const readiness = run0.readinessR;
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

        <!-- Removed 0/50/100 tick labels -->
        <div class="etaSlot"></div>
      </div>
    `;

    wireTileInteractions(state, tile, f.id);
    frag.appendChild(tile);
    idsForEta.push(String(f.id));
  }

  wrap.replaceChildren(frag);

  const empty = $('emptyMsg');
  if (empty) empty.style.display = idsForEta.length ? 'none' : 'block';

  await initSwipeOnTiles(state, {
    onDetails: async (fieldId)=>{
      if (!canEdit(state)) return;
      await openQuickView(state, fieldId);
    }
  });

  // Fill ETA after the tiles exist
  setTimeout(async ()=>{
    try{
      await updateVisibleTilesBatched(state, idsForEta);
    }catch(_){}
  }, 0);
}

/* ---------- tile render (PUBLIC) ---------- */
export async function renderTiles(state){
  // Tiles render is expensive; coalesce with details
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

/* ---------- details render (CORE) ---------- */
async function _renderDetailsInternal(state){
  await ensureModelWeatherModules(state);
  // Best-effort: ensure helper listener exists
  ensureEtaHelperModule(state);

  const f = state.fields.find(x=>x.id === state.selectedFieldId);
  if (!f) return;

  updateDetailsHeaderPanel(state);

  await loadCalibrationFromAdjustments(state);

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

  const run = state._mods.model.runField(f, deps);
  if (!run) return;

  try{ state.lastRuns && state.lastRuns.set(f.id, run); }catch(_){}

  renderBetaInputs(state);

  const trb = $('traceRows');
  if (trb){
    trb.innerHTML = '';
    const rows = Array.isArray(run.trace) ? run.trace : [];
    if (!rows.length){
      trb.innerHTML = `<tr><td colspan="7" class="muted">No trace rows.</td></tr>`;
    } else {
      for (const t of rows){
        const dateISO = String(t.dateISO || '');
        const rain = Number(t.rain ?? 0);
        const infilMult = Number(t.infilMult ?? 0);
        const add = Number(t.add ?? 0);
        const dryPwr = Number(t.dryPwr ?? 0);
        const loss = Number(t.loss ?? 0);
        const before = Number(t.before ?? 0);
        const after = Number(t.after ?? 0);

        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="mono">${esc(dateISO)}</td>
          <td class="right mono">${rain.toFixed(2)}</td>
          <td class="right mono">${infilMult.toFixed(2)}</td>
          <td class="right mono">${add.toFixed(2)}</td>
          <td class="right mono">${dryPwr.toFixed(2)}</td>
          <td class="right mono">${loss.toFixed(2)}</td>
          <td class="right mono">${before.toFixed(2)}→${after.toFixed(2)}</td>
        `;
        trb.appendChild(tr);
      }
    }
  }

  const drb = $('dryRows');
  if (drb){
    drb.innerHTML = '';
    const rows = Array.isArray(run.rows) ? run.rows : [];
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
    const rows = Array.isArray(run.rows) ? run.rows : [];

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
      // 1) History rows (what model used)
      for (const r of rows) addWxRow(r);

      // 2) Forecast rows (next 7 days) from cached dailySeriesFcst
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
      }catch(_){
        // ignore forecast failures; details should never crash page
      }
    }
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