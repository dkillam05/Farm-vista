/* =====================================================================
/Farm-vista/js/field-readiness/wiring.js  (FULL FILE)
Rev: 2025-12-27a

Fix:
✅ No functional change other than restoring the missing tail of the file
✅ Keeps:
   - op save on change/input
   - farm/page size save
   - tooltip close logic
===================================================================== */
'use strict';

import { waitForEl } from './utils.js';
import { saveFarmFilterDefault, savePageSizeDefault, saveOpDefault } from './prefs.js';
import { refreshAll } from './render.js';
import { buildFarmFilterOptions } from './farm-filter.js';

export async function wireUIOnce(state){
  if (state._wiredUI) return;
  state._wiredUI = true;

  await waitForEl('opSel', 3000);
  await waitForEl('sortSel', 3000);

  // Sort
  const sortSel = document.getElementById('sortSel');
  if (sortSel){
    sortSel.addEventListener('change', ()=> refreshAll(state));
  }

  // Operation
  const opSel = document.getElementById('opSel');
  if (opSel){
    const handler = ()=>{
      saveOpDefault();
      refreshAll(state);
    };
    opSel.addEventListener('change', handler);
    opSel.addEventListener('input', handler);
  }

  // Farm filter (persist)
  const farmSel = document.getElementById('farmSel');
  if (farmSel){
    farmSel.addEventListener('change', ()=>{
      saveFarmFilterDefault(state);

      // If the saved farm is no longer present, snap back to All
      buildFarmFilterOptions(state);

      // If current selected field isn't in the filtered list anymore, keep it safe:
      const farmId = String(state.farmFilter || '__all__');
      if (farmId !== '__all__'){
        const ok = (state.fields || []).some(f => f.id === state.selectedFieldId && String(f.farmId||'') === farmId);
        if (!ok){
          const first = (state.fields || []).find(f => String(f.farmId||'') === farmId);
          state.selectedFieldId = first ? first.id : state.selectedFieldId;
        }
      }

      refreshAll(state);
    });
  }

  // Page size
  const pageSel = document.getElementById('pageSel');
  if (pageSel){
    pageSel.addEventListener('change', ()=>{
      savePageSizeDefault(state);
      refreshAll(state);
    });
  }

  // Range controls
  const applyRangeBtn = document.getElementById('applyRangeBtn');
  if (applyRangeBtn) applyRangeBtn.addEventListener('click', ()=> setTimeout(()=>refreshAll(state), 0));

  const clearRangeBtn = document.getElementById('clearRangeBtn');
  if (clearRangeBtn) clearRangeBtn.addEventListener('click', ()=> setTimeout(()=>refreshAll(state), 0));

  const jobRangeInput = document.getElementById('jobRangeInput');
  if (jobRangeInput){
    jobRangeInput.addEventListener('change', ()=> refreshAll(state));
    jobRangeInput.addEventListener('input',  ()=> refreshAll(state));
  }

  // Rain help tooltip
  (function(){
    const rainHelpBtn = document.getElementById('rainHelpBtn');
    const rainHelpTip = document.getElementById('rainHelpTip');
    if (!rainHelpBtn || !rainHelpTip) return;

    function close(){ rainHelpTip.classList.remove('on'); }

    rainHelpBtn.addEventListener('click', (e)=>{
      e.stopPropagation();
      rainHelpTip.classList.toggle('on');
    });

    document.addEventListener('click', (e)=>{
      if (!rainHelpTip.classList.contains('on')) return;
      const inside = e.target && e.target.closest && e.target.closest('#rainHelpTip');
      const btn = e.target && e.target.closest && e.target.closest('#rainHelpBtn');
      if (!inside && !btn) close();
    });
  })();
}