/* =====================================================================
/Farm-vista/js/field-readiness/op-thresholds.js  (FULL FILE)
Rev: 2025-12-27b

Fix (per Dane):
✅ Operation Thresholds modal layout restored on mobile:
   - Label + value stay on ONE line
   - Slider is full width and aligned
   - Modal scrolls internally on small screens
   - Close (X) tap target is larger and always reachable

Keeps:
✅ Same IDs + behavior:
   - opBtn opens modal
   - btnOpX closes modal
   - clicking backdrop closes
✅ Uses state.thresholdsByOp + scheduleThresholdSave(state)
✅ Refreshes tiles/details live via refreshAll(state)
===================================================================== */
'use strict';

import { OPS } from './state.js';
import { clamp } from './utils.js';
import { getThresholdForOp, scheduleThresholdSave } from './thresholds.js';
import { refreshAll } from './render.js';
import { canEdit } from './perm.js';

function $(id){ return document.getElementById(id); }

function ensureOpModalStylesOnce(){
  try{
    if (window.__FV_FR_OPMODAL_STYLES__) return;
    window.__FV_FR_OPMODAL_STYLES__ = true;

    const css = document.createElement('style');
    css.setAttribute('data-fv-fr-opmodal','1');
    css.textContent = `
      /* Mobile-safe modal sizing + scroll */
      #opBackdrop{
        align-items:flex-start !important;
        padding-top: calc(env(safe-area-inset-top, 0px) + 10px) !important;
        padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 10px) !important;
      }
      #opBackdrop .modal{
        max-height: calc(100svh - 20px);
        display:flex;
        flex-direction:column;
        overflow:hidden;
      }
      #opBackdrop .modal-b{
        overflow:auto;
        -webkit-overflow-scrolling:touch;
      }

      /* Bigger close button tap target */
      #btnOpX{
        width:44px !important;
        height:44px !important;
        border-radius:14px !important;
      }

      /* Row layout: label/value on one line */
      #opList .oprow{
        display:grid;
        gap:10px;
      }
      #opList .oprow-top{
        display:flex !important;
        align-items:baseline !important;
        justify-content:space-between !important;
        gap:10px !important;
        flex-wrap:nowrap !important;
      }
      #opList .oprow-top .opname{
        font-weight:900 !important;
        white-space:nowrap;
        overflow:hidden;
        text-overflow:ellipsis;
        min-width:0;
        flex:1 1 auto;
      }
      #opList .oprow-top .opval{
        font-weight:900 !important;
        white-space:nowrap;
        flex:0 0 auto;
        opacity:.92;
      }

      /* Slider full width */
      #opList input[type="range"]{
        width:100% !important;
        margin:0 !important;
      }

      /* Small helper note */
      #opList .fv-op-note{
        font-size:12px;
        margin:0 0 6px;
        opacity:.85;
      }
    `;
    document.head.appendChild(css);
  }catch(_){}
}

function showModal(on){
  const b = $('opBackdrop');
  if (b) b.classList.toggle('pv-hide', !on);
}

function renderOpThresholdModal(state){
  ensureOpModalStylesOnce();

  const list = $('opList');
  if (!list) return;

  list.innerHTML = '';

  const editable = canEdit(state);

  // If view-only, show a subtle note at top
  if (!editable){
    const note = document.createElement('div');
    note.className = 'help muted fv-op-note';
    note.textContent = 'View only — you do not have permission to edit thresholds.';
    list.appendChild(note);
  }

  for (const op of OPS){
    const val = getThresholdForOp(state, op.key);

    const row = document.createElement('div');
    row.className = 'oprow';

    row.innerHTML = `
      <div class="oprow-top">
        <div class="opname" title="${String(op.label||op.key)}">${String(op.label||op.key)}</div>
        <div class="opval"><span class="mono" id="thrVal_${op.key}">${val}</span></div>
      </div>
      <input type="range" min="0" max="100" step="1" value="${val}" data-thr="${op.key}" ${editable ? '' : 'disabled'}/>
    `;

    const slider = row.querySelector('input[type="range"]');
    slider.addEventListener('input', ()=>{
      if (!editable) return;

      const k = slider.getAttribute('data-thr');
      const n = clamp(Number(slider.value), 0, 100);

      state.thresholdsByOp.set(k, n);

      const vEl = $('thrVal_' + k);
      if (vEl) vEl.textContent = String(n);

      scheduleThresholdSave(state);
      refreshAll(state);
    });

    list.appendChild(row);
  }
}

function openOpModal(state){
  renderOpThresholdModal(state);
  showModal(true);
}

function closeOpModal(){
  showModal(false);
}

export function initOpThresholds(state){
  ensureOpModalStylesOnce();

  const opBtn = $('opBtn');
  if (opBtn){
    opBtn.addEventListener('click', (e)=>{
      try{ e.preventDefault(); e.stopPropagation(); }catch(_){}
      openOpModal(state);
    });
  }

  const btnOpX = $('btnOpX');
  if (btnOpX) btnOpX.addEventListener('click', closeOpModal);

  const b = $('opBackdrop');
  if (b){
    b.addEventListener('click', (e)=>{
      if (e.target && e.target.id === 'opBackdrop') closeOpModal();
    });
  }
}
