/* =====================================================================
/Farm-vista/js/field-readiness/wiring.js  (FULL FILE)
Rev: 2025-12-26a

Wires UI handlers once (ported from your working file).
Phase 2: add sort/range persistence + quick view + swipe wiring here.
===================================================================== */
'use strict';

import { waitForEl } from './utils.js';
import { saveFarmFilterDefault, savePageSizeDefault, saveOpDefault } from './prefs.js';
import { refreshAll } from './render.js';

export async function wireUIOnce(state){
  if (state._wiredUI) return;
  state._wiredUI = true;

  await waitForEl('opSel', 3000);
  await waitForEl('sortSel', 3000);

  // Sort (kept as-is)
  const sortSel = document.getElementById('sortSel');
  if (sortSel){
    sortSel.addEventListener('change', ()=> refreshAll(state));
  }

  // Operation (kept as-is)
  const opSel = document.getElementById('opSel');
  if (opSel){
    const handler = ()=>{ saveOpDefault(); refreshAll(state); };
    opSel.addEventListener('change', handler);
    opSel.addEventListener('input', handler);
  }

  // Farm filter
  const farmSel = document.getElementById('farmSel');
  if (farmSel){
    farmSel.addEventListener('change', ()=>{
      saveFarmFilterDefault(state);
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

  // Sliders
  const soilWet = document.getElementById('soilWet');
  if (soilWet) soilWet.addEventListener('input', ()=> refreshAll(state));

  const drain = document.getElementById('drain');
  if (drain) drain.addEventListener('input', ()=> refreshAll(state));

  // Range controls (kept as-is)
  const applyRangeBtn = document.getElementById('applyRangeBtn');
  if (applyRangeBtn) applyRangeBtn.addEventListener('click', ()=> setTimeout(()=>refreshAll(state), 0));

  const clearRangeBtn = document.getElementById('clearRangeBtn');
  if (clearRangeBtn) clearRangeBtn.addEventListener('click', ()=> setTimeout(()=>refreshAll(state), 0));

  const jobRangeInput = document.getElementById('jobRangeInput');
  if (jobRangeInput){
    jobRangeInput.addEventListener('change', ()=> refreshAll(state));
    jobRangeInput.addEventListener('input',  ()=> refreshAll(state));
  }

  // Help tooltip (kept)
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

  // (We’re intentionally not moving your modals yet in Phase 1.)
}
