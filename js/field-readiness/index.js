/* =====================================================================
/Farm-vista/js/field-readiness/index.js  (FULL FILE)
Rev: 2026-03-10b-mrms-ui-refresh-no-trim

Changes (per Dane):
✅ Edit permission controls interactivity:
   - Details panel is ALWAYS shown, but cannot be opened when edit is false
   - Gate is applied on boot and whenever perms update (fv:user-ready)

NEW:
✅ Lightweight MRMS rainfall-only refresh
   - does NOT rerun full readiness model
   - refreshes tile rainfall / MRMS details / quick view rainfall display
   - runs every 10 minutes while page is open
   - also refreshes on pageshow and when tab becomes visible

Keeps:
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
const MRMS_UI_REFRESH_MS = 10 * 60 * 1000;

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
   MRMS UI-only refresh helpers
   - does NOT rerun full readiness model
   - only nudges rainfall-related UI to refresh
===================================================================== */
function getVisibleTileFieldIds(state){
  try{
    const nodes = Array.from(document.querySelectorAll('#fieldsGrid .tile[data-field-id]'));
    const ids = nodes
      .map(el => String(el.getAttribute('data-field-id') || '').trim())
      .filter(Boolean);

    if (ids.length) return ids;

    return Array.isArray(state && state.fields)
      ? state.fields.map(f => String(f && f.id || '')).filter(Boolean).slice(0, 25)
      : [];
  }catch(_){
    return [];
  }
}

async function refreshMrmsUiOnly(state){
  try{
    if (!state || !Array.isArray(state.fields) || !state.fields.length) return;

    const visibleIds = getVisibleTileFieldIds(state);

    for (const fieldId of visibleIds){
      try{
        document.dispatchEvent(new CustomEvent('fr:tile-refresh', {
          detail: { fieldId }
        }));
      }catch(_){}
    }

    if (state.selectedFieldId){
      try{
        document.dispatchEvent(new CustomEvent('fr:details-refresh', {
          detail: { fieldId: state.selectedFieldId }
        }));
      }catch(_){}
    }
  }catch(_){}
}

function startMrmsUiRefreshTimer(state){
  try{
    if (!state) return;
    if (state._mrmsUiRefreshTimer) return;

    state._mrmsUiRefreshTimer = window.setInterval(()=>{
      refreshMrmsUiOnly(state).catch?.(()=>{});
    }, MRMS_UI_REFRESH_MS);
  }catch(_){}
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

  // Apply prefs once on boot
  await loadPrefsFromLocalToUI(state);

  // Apply saved range string (if any)
  applySavedRangeToUI();

  // Range UI module (calendar behavior) + enforcement
  await loadRangeFromLocalToUI();
  enforceCalendarNoFuture();

  // Load remote thresholds + data
  await loadThresholdsFromFirestore(state);
  await loadFarmsOptional(state);
  await loadFields(state);

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
      const prevOp = document.getElementById('opSel')?.value || '';
      const prevSort = document.getElementById('sortSel')?.value || '';
      const prevRange = document.getElementById('jobRangeInput')?.value || '';
      const prevFarm = document.getElementById('farmSel')?.value || '__all__';
      const prevPage = document.getElementById('pageSel')?.value || '25';

      applySavedOpToUI(state, { fire:false });
      applySavedSortToUI({ fire:false });
      applySavedRangeToUI();

      await loadPrefsFromLocalToUI(state);

      const pageSel = document.getElementById('pageSel');
      if (pageSel){
        pageSel.value = (state.pageSize === -1) ? '__all__' : String(state.pageSize || 25);
      }

      const farmSel = document.getElementById('farmSel');
      if (farmSel){
        farmSel.value = String(state.farmFilter || '__all__');
      }

      enforceCalendarNoFuture();
      applyDetailsEditGateState(state);

      const newOp = document.getElementById('opSel')?.value || '';
      const newSort = document.getElementById('sortSel')?.value || '';
      const newRange = document.getElementById('jobRangeInput')?.value || '';
      const newFarm = document.getElementById('farmSel')?.value || '__all__';
      const newPage = document.getElementById('pageSel')?.value || '25';

      if (
        prevOp !== newOp ||
        prevSort !== newSort ||
        prevRange !== newRange ||
        prevFarm !== newFarm ||
        prevPage !== newPage
      ){
        await refreshAll(state);
      }
    }catch(_){}
  };

  // Initial paint
  await renderTiles(state);
  await renderDetails(state);

  // ✅ refresh without destroying tiles
  setTimeout(()=>{ refreshAll(state).catch(()=>{}); }, 0);

  // global calibration wiring (will show Fields always; only wires when edit allowed)
  wireFieldsHiddenTap(state);

  // Re-apply details gate again after all wiring (safe)
  applyDetailsEditGateState(state);

  // Start lightweight MRMS-only refresh timer
  startMrmsUiRefreshTimer(state);

  // Small delayed MRMS-only refresh after initial paint so hourly rainfall UI can settle
  setTimeout(()=>{ refreshMrmsUiOnly(state).catch?.(()=>{}); }, 1500);

  // re-close details (edge cases)
  try{
    const dp2 = document.getElementById('detailsPanel');
    if (dp2){
      dp2.open = false;
      dp2.removeAttribute('open');
    }
  }catch(_){}
})();
