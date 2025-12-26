/* =====================================================================
/Farm-vista/js/field-readiness/prefs.js  (FULL FILE)
Rev: 2025-12-26a
Owns: op/sort/farm/page prefs load/save.
===================================================================== */
'use strict';

import { CONSTANTS, OPS } from './state.js';

const $ = (id)=>document.getElementById(id);
const clamp = (v, lo, hi)=>Math.max(lo, Math.min(hi, v));

export function initPrefs(state){
  // No-op until UI exists; wiring occurs in ui.js
  // This module only provides load/save helpers.
}

export async function loadPrefsToUI(state){
  // wait for selects to exist (mobile module timing)
  await waitForEl('opSel', 2500);
  await waitForEl('sortSel', 2500);

  // Operation
  const opSel = $('opSel');
  if (opSel){
    let raw = '';
    try{ raw = String(localStorage.getItem(CONSTANTS.LS_OP_KEY) || ''); }catch(_){ raw=''; }
    raw = (raw||'').trim();
    if (raw && OPS.some(o=>o.key===raw)) opSel.value = raw;
    state.opKey = String(opSel.value || OPS[0].key);
  }

  // Sort
  const sortSel = $('sortSel');
  if (sortSel){
    let raw = '';
    try{ raw = String(localStorage.getItem(CONSTANTS.LS_SORT_KEY) || ''); }catch(_){ raw=''; }
    raw = (raw||'').trim();
    const ok = raw && Array.from(sortSel.options).some(o=>o.value===raw);
    if (ok) sortSel.value = raw;
    state.sortMode = String(sortSel.value || 'name_az');
  }

  // Farm filter
  const farmSel = $('farmSel');
  if (farmSel){
    let raw = '__all__';
    try{ raw = String(localStorage.getItem(CONSTANTS.LS_FARM_FILTER) || '__all__'); }catch(_){}
    raw = (raw||'__all__').trim() || '__all__';
    farmSel.value = raw;
    state.farmFilter = raw;
  }

  // Page size
  const pageSel = $('pageSel');
  if (pageSel){
    let raw = '25';
    try{ raw = String(localStorage.getItem(CONSTANTS.LS_PAGE_SIZE) || '25'); }catch(_){}
    raw = (raw||'25').trim() || '25';
    pageSel.value = raw;
    state.pageSize = (raw === '__all__') ? -1 : (isFinite(Number(raw)) ? clamp(Math.round(Number(raw)), 1, 10000) : 25);
  }
}

export function saveOp(state){
  const opSel = $('opSel');
  if (!opSel) return;
  const v = String(opSel.value||'').trim();
  if (!v) return;
  state.opKey = v;
  try{ localStorage.setItem(CONSTANTS.LS_OP_KEY, v); }catch(_){}
  try{ sessionStorage.setItem(CONSTANTS.LS_OP_KEY, v); }catch(_){}
}

export function saveSort(state){
  const sel = $('sortSel');
  if (!sel) return;
  const v = String(sel.value||'name_az');
  state.sortMode = v;
  try{ localStorage.setItem(CONSTANTS.LS_SORT_KEY, v); }catch(_){}
}

export function saveFarm(state){
  const sel = $('farmSel');
  const v = String(sel ? sel.value : '__all__') || '__all__';
  state.farmFilter = v;
  try{ localStorage.setItem(CONSTANTS.LS_FARM_FILTER, v); }catch(_){}
}

export function savePageSize(state){
  const sel = $('pageSel');
  const raw = String(sel ? sel.value : '25');
  state.pageSize = (raw === '__all__') ? -1 : (isFinite(Number(raw)) ? clamp(Math.round(Number(raw)), 1, 10000) : 25);
  try{ localStorage.setItem(CONSTANTS.LS_PAGE_SIZE, raw); }catch(_){}
}

/* small util */
async function waitForEl(id, timeoutMs=2000){
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs){
    const el = document.getElementById(id);
    if (el) return el;
    await new Promise(r=>requestAnimationFrame(r));
  }
  return null;
}
