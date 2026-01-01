/* =====================================================================
/Farm-vista/js/field-readiness/index.js  (FULL FILE)
Rev: 2026-01-01a

New (per Dane):
✅ Instant tiles on return (500-field friendly):
   - Cache last-known fields list in localStorage
   - On boot, if cache exists: renderTiles immediately from cached fields
   - Continue normal remote load + refreshAll in background
   - Cache is refreshed after loadFields(state)

Keeps:
✅ Edit permission controls interactivity:
   - Details panel is ALWAYS shown, but cannot be opened when edit is false
   - Gate is applied on boot and whenever perms update (fv:user-ready)

✅ Persist + restore (iOS/Safari BFCache safe): Operation, Farm, Sort, Rain range
✅ Re-apply on pageshow + visibilitychange
===================================================================== */
'use strict';

import { createState } from './state.js';
import { importFirebaseInit } from './firebase.js';
import { loadThresholdsFromLocal, loadThresholdsFromFirestore } from './thresholds.js';
import { loadParamsFromLocal } from './params.js';
import { loadPrefsFromLocalToUI, applySavedOpToUI, applySavedSortToUI } from './prefs.js';
import { loadRangeFromLocalToUI, enforceCalendarNoFuture } from './range.js';
import { loadFarmsOptional, loadFields } from './data.js';
import { wireUIOnce } from './wiring.js';
import { renderTiles, renderDetails, refreshAll, ensureModelWeatherModules } from './render.js';
import { wireFieldsHiddenTap } from './adjust.js';
import { loadFieldReadinessPerms, canView, canEdit } from './perm.js';
import { buildFarmFilterOptions } from './farm-filter.js';
import { initMap } from './map.js';
import { initLayoutFix } from './layout.js';
import { initOpThresholds } from './op-thresholds.js';

const LS_RANGE_KEY = 'fv_fr_range_v1';

/* =====================================================================
   NEW: Fields cache (instant tiles on return)
   - We cache a compact list of fields so tiles can render immediately.
   - Read cache early -> renderTiles -> then remote load overwrites.
===================================================================== */
const LS_FIELDS_CACHE_KEY = 'fv_fr_fields_cache_v1';
const FIELDS_CACHE_MAX = 2500;      // safety cap
const FIELDS_CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

function _now(){ return Date.now(); }

function _pickFieldForCache(f){
  // Keep this conservative to avoid schema mismatches.
  // Include only things the tile list commonly needs.
  const o = f && typeof f === 'object' ? f : {};
  return {
    id: o.id || o.fieldId || o.docId || null,
    name: o.name || o.fieldName || '',
    farmId: o.farmId || null,
    farmName: o.farmName || o.farm || '',
    acres: (typeof o.acres === 'number' ? o.acres : (o.acres ? Number(o.acres) : null)),
    lat: (typeof o.lat === 'number' ? o.lat : (o.lat ? Number(o.lat) : null)),
    lng: (typeof o.lng === 'number' ? o.lng : (o.lng ? Number(o.lng) : null)),
    status: o.status || o.fieldStatus || null,
    archived: !!(o.archived || o.isArchived || o.inactive)
  };
}

function _isUsableCachedField(cf){
  return cf && typeof cf === 'object' && typeof cf.id === 'string' && cf.id.length > 0;
}

function loadFieldsFromLocalCache(state){
  try{
    const raw = String(localStorage.getItem(LS_FIELDS_CACHE_KEY) || '').trim();
    if (!raw) return false;

    const payload = JSON.parse(raw);
    if (!payload || typeof payload !== 'object') return false;

    const ts = Number(payload.ts || 0);
    if (!ts || !Number.isFinite(ts)) return false;

    // expire old cache to prevent weirdness
    if ((_now() - ts) > FIELDS_CACHE_MAX_AGE_MS) return false;

    const arr = Array.isArray(payload.fields) ? payload.fields : [];
    if (!arr.length) return false;

    // sanitize + cap
    const cleaned = [];
    for (let i=0; i<arr.length && cleaned.length < FIELDS_CACHE_MAX; i++){
      const cf = arr[i];
      if (_isUsableCachedField(cf)) cleaned.push(cf);
    }
    if (!cleaned.length) return false;

    state.fields = cleaned;
    state._fvFieldsFromCache = true;
    return true;
  }catch(_){
    return false;
  }
}

function saveFieldsToLocalCache(state){
  try{
    const src = Array.isArray(state.fields) ? state.fields : [];
    if (!src.length) return;

    const out = [];
    for (let i=0; i<src.length && out.length < FIELDS_CACHE_MAX; i++){
      const cf = _pickFieldForCache(src[i]);
      if (_isUsableCachedField(cf)) out.push(cf);
    }
    if (!out.length) return;

    const payload = { ts: _now(), fields: out };
    localStorage.setItem(LS_FIELDS_CACHE_KEY, JSON.stringify(payload));
  }catch(_){}
}

function applySavedRangeToUI(){
  try{
    const inp = document.getElementById('jobRangeInput');
    if (!inp) return false;

    const raw = String(localStorage.getItem(LS_RANGE_KEY) || '').trim();
    // allow empty (meaning default 30d) but still apply if it differs
    if (String(inp.value || '').trim() !== raw){
      inp.value = raw;
      return true;
    }
    return false;
  }catch(_){
    return false;
  }
}

/* =====================================================================
   Edit-gates (Details shown, but not openable unless edit allowed)
===================================================================== */
function ensureDetailsEditGateWired(){
  try{
    const dp = document.getElementById('detailsPanel');
    if (!dp) return;

    const sum = dp.querySelector('summary');
    if (!sum) return;

    if (dp._fvEditGateWired) return;
    dp._fvEditGateWired = true;

    // Capture-phase so we beat the native <details> toggle reliably.
    sum.addEventListener('click', (e)=>{
      try{
        const st = window.__FV_FR;
        if (!st) return;

        if (!canEdit(st)){
          e.preventDefault();
          e.stopPropagation();

          // Force closed (native toggle might already have flipped)
          dp.open = false;
          dp.removeAttribute('open');
        }
      }catch(_){}
    }, true);
  }catch(_){}
}

function applyDetailsEditGateState(state){
  try{
    const dp = document.getElementById('detailsPanel');
    if (!dp) return;

    ensureDetailsEditGateWired();

    if (!canEdit(state)){
      // Keep visible, but never open
      dp.open = false;
      dp.removeAttribute('open');

      // Optional subtle disabled feel on the summary
      const sum = dp.querySelector('summary');
      if (sum){
        sum.style.opacity = '0.72';
        sum.style.cursor = 'not-allowed';
      }
    } else {
      const sum = dp.querySelector('summary');
      if (sum){
        sum.style.opacity = '';
        sum.style.cursor = 'pointer';
      }
    }
  }catch(_){}
}

(async function init(){
  const state = createState();
  window.__FV_FR = state;

  initLayoutFix();

  // FORCE details closed on boot
  try{
    const dp = document.getElementById('detailsPanel');
    if (dp){
      dp.open = false;
      dp.removeAttribute('open');
    }
  }catch(_){}

  const br = document.getElementById('btnRegen');
  if (br){ br.style.display = 'none'; br.disabled = true; }

  // Local caches
  loadParamsFromLocal(state);
  loadThresholdsFromLocal(state);

  // Wire UI early
  await wireUIOnce(state);

  // Apply prefs once on boot (sets selects early so cached tiles match UI)
  await loadPrefsFromLocalToUI(state);

  // Apply saved range string (if any)
  applySavedRangeToUI();

  // Range UI module (calendar behavior) + enforcement (safe even before remote)
  await loadRangeFromLocalToUI();
  enforceCalendarNoFuture();

  /* -------------------------------------------------------------
     ✅ NEW: Instant tile render from cached fields
     - Render tiles ASAP (before firebase/remote fetch)
     - Interactions stay consistent because render.js wires clicks each render.
     - refreshAll still runs later with fresh data.
  -------------------------------------------------------------- */
  try{
    const hadCache = loadFieldsFromLocalCache(state);
    if (hadCache && Array.isArray(state.fields) && state.fields.length){
      // Build farm dropdown based on cached fields (fast)
      try{ buildFarmFilterOptions(state); }catch(_){}

      if (!state.selectedFieldId && state.fields.length){
        state.selectedFieldId = state.fields[0].id;
      }

      // Paint tiles immediately (do NOT run refreshAll yet)
      try{ await renderTiles(state); }catch(_){}
      // Details can stay placeholder until fresh model runs
      try{ await renderDetails(state); }catch(_){}
    }
  }catch(_){}

  // Firebase
  await importFirebaseInit(state);

  // Initial perms read (may be provisional)
  await loadFieldReadinessPerms(state);

  // Apply details edit gating immediately (covers provisional + loaded)
  applyDetailsEditGateState(state);

  if (!canView(state)){
    const grid = document.getElementById('fieldsGrid');
    if (grid){
      grid.innerHTML = '';
      const msg = document.createElement('div');
      msg.className = 'help muted';
      msg.style.padding = '10px 2px';
      msg.textContent = 'You do not have permission to view Field Readiness.';
      grid.appendChild(msg);
    }
    return;
  }

  // Load remote thresholds + data
  await loadThresholdsFromFirestore(state);
  await loadFarmsOptional(state);

  // Remote load fields (authoritative)
  await loadFields(state);

  // ✅ NEW: refresh local cache with authoritative fields
  saveFieldsToLocalCache(state);

  // Farm options can change after farms/fields load
  buildFarmFilterOptions(state);

  if (!state.selectedFieldId && state.fields.length){
    state.selectedFieldId = state.fields[0].id;
  }

  await ensureModelWeatherModules(state);

  initMap(state);
  initOpThresholds(state);

  document.addEventListener('fr:soft-reload', async ()=>{ try{ await refreshAll(state); }catch(_){ } });

  document.addEventListener('fv:user-ready', async ()=>{
    try{
      const prevLoaded = !!(state.perm && state.perm.loaded);
      const prevEdit = !!(state.perm && state.perm.edit);

      await loadFieldReadinessPerms(state);

      // Re-apply details gate anytime perms might have changed
      applyDetailsEditGateState(state);

      if (state.perm && state.perm.loaded && !state.perm.view){
        const grid = document.getElementById('fieldsGrid');
        if (grid){
          grid.innerHTML = '';
          const msg = document.createElement('div');
          msg.className = 'help muted';
          msg.style.padding = '10px 2px';
          msg.textContent = 'You do not have permission to view Field Readiness.';
          grid.appendChild(msg);
        }
        return;
      }

      const nowEdit = !!(state.perm && state.perm.loaded && state.perm.edit);
      if (!prevLoaded || (prevEdit !== nowEdit)){
        await refreshAll(state);
      }
    }catch(_){}
  });

  // ✅ iOS/Safari: re-apply selects + range after returning to page
  const reapplyPrefs = async ()=>{
    try{
      const opChanged = applySavedOpToUI(state, { fire:false });
      const sortChanged = applySavedSortToUI({ fire:false });
      const rangeChanged = applySavedRangeToUI();

      // keep farm/page in sync too
      await loadPrefsFromLocalToUI(state);

      // range module constraints (safe)
      enforceCalendarNoFuture();

      // Re-apply details gate on return (covers BFCache + perms already known)
      applyDetailsEditGateState(state);

      if (opChanged || sortChanged || rangeChanged){
        await refreshAll(state);
      }
    }catch(_){}
  };

  window.addEventListener('pageshow', ()=>{ reapplyPrefs(); });

  document.addEventListener('visibilitychange', ()=>{
    if (!document.hidden){
      reapplyPrefs();
    }
  });

  // Initial paint (authoritative)
  await renderTiles(state);
  await renderDetails(state);
  await refreshAll(state);

  // global calibration wiring (will show Fields always; only wires when edit allowed)
  wireFieldsHiddenTap(state);

  // Re-apply details gate again after all wiring (safe)
  applyDetailsEditGateState(state);

  // re-close details (edge cases)
  try{
    const dp2 = document.getElementById('detailsPanel');
    if (dp2){
      dp2.open = false;
      dp2.removeAttribute('open');
    }
  }catch(_){}
})();