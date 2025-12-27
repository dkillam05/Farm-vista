/* =====================================================================
/Farm-vista/js/field-readiness/prefs.js  (FULL FILE)
Rev: 2025-12-27b

Fix:
✅ Adds persistent Sort preference:
   - localStorage key: fv_fr_sort_v1
✅ Keeps:
   - Operation (local + session)
   - Farm filter
   - Page size

===================================================================== */
'use strict';

import { CONST, OPS } from './state.js';

const LS_SORT_KEY = 'fv_fr_sort_v1';

function getSavedOpKey(){
  return String(CONST.LS_OP_KEY || '').trim() || 'fv_dev_field_readiness_op';
}

function readSavedOp(){
  const k = getSavedOpKey();
  let raw = '';
  try{ raw = String(localStorage.getItem(k) || ''); }catch(_){ raw=''; }
  if (!raw){
    try{ raw = String(sessionStorage.getItem(k) || ''); }catch(_){ raw=''; }
  }
  raw = String(raw || '').trim();
  if (!raw) return '';
  if (!OPS.some(o=>o.key === raw)) return '';
  return raw;
}

export function applySavedOpToUI(state, { fire=false } = {}){
  const op = document.getElementById('opSel');
  if (!op) return false;

  const raw = readSavedOp();
  if (!raw) return false;

  if (op.value !== raw){
    op.value = raw;
    try{ op.dataset.saved = raw; }catch(_){}
    if (fire){
      try{ op.dispatchEvent(new Event('change', { bubbles:true })); }catch(_){}
    }
    return true;
  }
  return false;
}

export function applySavedSortToUI({ fire=false } = {}){
  const sel = document.getElementById('sortSel');
  if (!sel) return false;

  let raw = '';
  try{ raw = String(localStorage.getItem(LS_SORT_KEY) || ''); }catch(_){ raw=''; }
  raw = String(raw || '').trim();
  if (!raw) return false;

  // only apply if option exists
  const ok = Array.from(sel.options || []).some(o => String(o.value) === raw);
  if (!ok) return false;

  if (sel.value !== raw){
    sel.value = raw;
    try{ sel.dataset.saved = raw; }catch(_){}
    if (fire){
      try{ sel.dispatchEvent(new Event('change', { bubbles:true })); }catch(_){}
    }
    return true;
  }
  return false;
}

export async function loadPrefsFromLocalToUI(state){
  // Operation
  applySavedOpToUI(state, { fire:false });

  // Sort
  applySavedSortToUI({ fire:false });

  // Farm
  try{ state.farmFilter = String(localStorage.getItem(CONST.LS_FARM_FILTER) || '__all__') || '__all__'; }
  catch(_){ state.farmFilter='__all__'; }
  const farmSel = document.getElementById('farmSel');
  if (farmSel) farmSel.value = state.farmFilter;

  // Page size
  let rawPS = '25';
  try{ rawPS = String(localStorage.getItem(CONST.LS_PAGE_SIZE) || '25'); }catch(_){ rawPS='25'; }
  state.pageSize = (rawPS === '__all__') ? -1 : (isFinite(Number(rawPS)) ? Math.max(1, Math.round(Number(rawPS))) : 25);
  const pageSel = document.getElementById('pageSel');
  if (pageSel) pageSel.value = (state.pageSize === -1) ? '__all__' : String(state.pageSize);
}

export function saveOpDefault(){
  const op = document.getElementById('opSel');
  if (!op) return;
  const v = String(op.value||'').trim();
  if (!v) return;

  const k = getSavedOpKey();
  try{ localStorage.setItem(k, v); }catch(_){}
  try{ sessionStorage.setItem(k, v); }catch(_){}
}

export function saveSortDefault(){
  const sel = document.getElementById('sortSel');
  if (!sel) return;
  const v = String(sel.value || '').trim();
  if (!v) return;
  try{ localStorage.setItem(LS_SORT_KEY, v); }catch(_){}
}

export function saveFarmFilterDefault(state){
  const sel = document.getElementById('farmSel');
  const v = String(sel ? sel.value : '__all__') || '__all__';
  state.farmFilter = v;
  try{ localStorage.setItem(CONST.LS_FARM_FILTER, v); }catch(_){}
}

export function savePageSizeDefault(state){
  const sel = document.getElementById('pageSel');
  const raw = String(sel ? sel.value : '25');
  state.pageSize = (raw === '__all__') ? -1 : (isFinite(Number(raw)) ? Math.max(1, Math.round(Number(raw))) : 25);
  try{ localStorage.setItem(CONST.LS_PAGE_SIZE, raw); }catch(_){}
}