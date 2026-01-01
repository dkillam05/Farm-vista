/* =====================================================================
/Farm-vista/js/field-readiness/index.js  (FULL FILE)
Rev: 2026-01-01c

Fix (per Dane):
✅ Instant tiles on page entry:
   - Restore last rendered tiles HTML from sessionStorage (fast paint)
✅ Stop extra re-renders:
   - Do ONE initial paint: refreshAll(state)
✅ Avoid duplicate soft-reload listeners:
   - render.js already listens for 'fr:soft-reload'

Keeps:
✅ Details gate (cannot open unless edit)
✅ Persist + restore prefs (Operation, Farm, Sort, Rain range)
✅ BFCache safe reapply on pageshow + visibilitychange
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
import { refreshAll } from './render.js';
import { wireFieldsHiddenTap } from './adjust.js';
import { loadFieldReadinessPerms, canView, canEdit } from './perm.js';
import { buildFarmFilterOptions } from './farm-filter.js';
import { initMap } from './map.js';
import { initLayoutFix } from './layout.js';
import { initOpThresholds } from './op-thresholds.js';

const LS_RANGE_KEY = 'fv_fr_range_v1';

// ✅ tiles DOM cache (session only — perfect for “when I come into the page”)
const SS_TILES_KEY = 'fv_fr_tiles_dom_v1';

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
   Restore tiles instantly (DOM cache)
===================================================================== */
function restoreTilesDomFast(state){
  try{
    const wrap = document.getElementById('fieldsGrid');
    if (!wrap) return false;

    const raw = sessionStorage.getItem(SS_TILES_KEY);
    if (!raw) return false;

    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return false;

    const html = String(obj.html || '');
    const sig  = String(obj.sig || '');
    if (!html || !sig) return false;

    // Paint instantly
    wrap.innerHTML = html;
    state._restoredTilesSig = sig;

    // Hide empty msg if we have tiles
    const empty = document.getElementById('emptyMsg');
    if (empty) empty.style.display = (wrap.children.length ? 'none' : '');

    return true;
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

  // ✅ Restore tiles ASAP (before we do anything heavy)
  restoreTilesDomFast(state);

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

  // Apply details edit gating immediately
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

  // Range UI module + enforcement
  await loadRangeFromLocalToUI();
  enforceCalendarNoFuture();

  // Load remote thresholds + data (data.js now loads fields from cache first, then silent refresh)
  await loadThresholdsFromFirestore(state);
  await loadFarmsOptional(state);
  await loadFields(state);

  buildFarmFilterOptions(state);

  if (!state.selectedFieldId && state.fields.length){
    state.selectedFieldId = state.fields[0].id;
  }

  initMap(state);
  initOpThresholds(state);

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
        await refreshAll(state);
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

  // ✅ One initial paint
  await refreshAll(state);

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