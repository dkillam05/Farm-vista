/* =====================================================================
/Farm-vista/js/field-readiness/prefs.js  (FULL FILE)
Rev: 2025-12-26a
Farm + page size + op prefs (same as working file).
===================================================================== */
'use strict';

import { CONST, OPS } from './state.js';

export async function loadPrefsFromLocalToUI(state){
  // Operation
  const op = document.getElementById('opSel');
  if (op){
    let raw = '';
    try{ raw = String(localStorage.getItem(CONST.LS_OP_KEY) || ''); }catch(_){ raw=''; }
    if (!raw){
      try{ raw = String(sessionStorage.getItem(CONST.LS_OP_KEY) || ''); }catch(_){ raw=''; }
    }
    raw = String(raw||'').trim();
    if (raw && OPS.some(o=>o.key===raw)) op.value = raw;
  }

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
  try{ localStorage.setItem(CONST.LS_OP_KEY, v); }catch(_){}
  try{ sessionStorage.setItem(CONST.LS_OP_KEY, v); }catch(_){}
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
