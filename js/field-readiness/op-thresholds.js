/* =====================================================================
/Farm-vista/js/field-readiness/op-thresholds.js  (FULL FILE)
Rev: 2025-12-26a

Operation Thresholds modal wiring (restored):
- opBtn opens modal
- sliders change thresholds in state.thresholdsByOp
- schedule save to local + Firestore field_readiness_thresholds/default
- refresh tiles/details live

IDs used (must exist in HTML):
- opBtn, opBackdrop, opList, btnOpX

===================================================================== */
'use strict';

import { OPS } from './state.js';
import { clamp } from './utils.js';
import { getThresholdForOp, scheduleThresholdSave } from './thresholds.js';
import { refreshAll } from './render.js';
import { canEdit } from './perm.js';

function $(id){ return document.getElementById(id); }

function showModal(id, on){
  const b = $(id);
  if (b) b.classList.toggle('pv-hide', !on);
}

function renderOpThresholdModal(state){
  const list = $('opList');
  if (!list) return;

  list.innerHTML = '';

  const editable = canEdit(state);

  for (const op of OPS){
    const val = getThresholdForOp(state, op.key);

    const row = document.createElement('div');
    row.className = 'oprow';

    row.innerHTML = `
      <div class="oprow-top">
        <div class="opname">${op.label}</div>
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

  // If view-only, show a subtle note at top
  if (!editable){
    const note = document.createElement('div');
    note.className = 'help muted';
    note.style.marginTop = '6px';
    note.textContent = 'View only — you do not have permission to edit thresholds.';
    list.prepend(note);
  }
}

function openOpModal(state){
  renderOpThresholdModal(state);
  showModal('opBackdrop', true);
}

function closeOpModal(){
  showModal('opBackdrop', false);
}

export function initOpThresholds(state){
  const opBtn = $('opBtn');
  if (opBtn) opBtn.addEventListener('click', ()=> openOpModal(state));

  const btnOpX = $('btnOpX');
  if (btnOpX) btnOpX.addEventListener('click', closeOpModal);

  const b = $('opBackdrop');
  if (b){
    b.addEventListener('click', (e)=>{
      if (e.target && e.target.id === 'opBackdrop') closeOpModal();
    });
  }
}
