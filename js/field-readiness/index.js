/* =====================================================================
/Farm-vista/js/field-readiness/index.js  (FULL FILE)
Rev: 2026-01-01b

Fix (per Dane):
✅ Stop immediate double-render (blank/rebuild):
   - Do initial render once
   - Kick refreshAll async (non-blocking) so UI stays visible

Keeps:
✅ Details edit gate behavior
✅ BFCache reapply
✅ Everything else unchanged from your provided Rev: 2025-12-29a
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

function applySavedRangeToUI(){
  try{
    const inp = document.getElementById('jobRangeInput');
    if (!inp) return false;

    const raw = String(localStorage.getItem(LS_RANGE_KEY) || '').trim();
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

    sum.addEventListener('click', (e)=>{
      try{
        const st = window.__FV_FR;
        if (!st) return;

        if (!canEdit(st)){
          e.preventDefault();
          e.stopPropagation();
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
      dp.open = false;
      dp.removeAttribute('open');

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

  try{
    const dp = document.getElementById('detailsPanel');
    if (dp){
      dp.open = false;
      dp.removeAttribute('open');
    }
  }catch(_){}

  const br = document.getElementById('btnRegen');
  if (br){ br.style.display = 'none'; br.disabled = true; }

  loadParamsFromLocal(state);
  loadThresholdsFromLocal(state);

  await wireUIOnce(state);

  await importFirebaseInit(state);
  await loadFieldReadinessPerms(state);

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

  await loadPrefsFromLocalToUI(state);
  applySavedRangeToUI();

  await loadRangeFromLocalToUI();
  enforceCalendarNoFuture();

  await loadThresholdsFromFirestore(state);
  await loadFarmsOptional(state);
  await loadFields(state);

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
        refreshAll(state).catch(()=>{});
      }
    }catch(_){}
  });

  const reapplyPrefs = async ()=>{
    try{
      const opChanged = applySavedOpToUI(state, { fire:false });
      const sortChanged = applySavedSortToUI({ fire:false });
      const rangeChanged = applySavedRangeToUI();

      await loadPrefsFromLocalToUI(state);
      enforceCalendarNoFuture();
      applyDetailsEditGateState(state);

      if (opChanged || sortChanged || rangeChanged){
        refreshAll(state).catch(()=>{});
      }
    }catch(_){}
  };

  window.addEventListener('pageshow', ()=>{ reapplyPrefs(); });

  document.addEventListener('visibilitychange', ()=>{
    if (!document.hidden){
      reapplyPrefs();
    }
  });

  // ✅ Initial paint once
  await renderTiles(state);
  await renderDetails(state);

  // ✅ Kick refresh async so UI stays visible (no blank wait)
  setTimeout(()=>{ refreshAll(state).catch(()=>{}); }, 0);

  wireFieldsHiddenTap(state);
  applyDetailsEditGateState(state);

  try{
    const dp2 = document.getElementById('detailsPanel');
    if (dp2){
      dp2.open = false;
      dp2.removeAttribute('open');
    }
  }catch(_){}
})();