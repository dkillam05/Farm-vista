/* =====================================================================
/Farm-vista/js/field-readiness/ui.js  (FULL FILE)
Rev: 2025-12-26a

Owns:
- event wiring
- calling render pieces (tiles/details/quickview)
This file stays small: it orchestrates.
===================================================================== */
'use strict';

import { saveOp, saveSort, saveFarm, savePageSize } from './prefs.js';
import { loadRangeToUI, saveRangeFromUI } from './range.js';
import { renderTiles } from './tiles.js';
import { renderDetails, trimDetailsPanelsOnce } from './details.js';

const $ = (id)=>document.getElementById(id);

export function initUIWiring(state){
  // No-op; actual wiring happens in initUIWiring after DOM is there.
}

export function renderAll(state){
  renderTiles(state);
  renderDetails(state);
}

export function initUIWiring(state){
  if (state._wired) return;
  state._wired = true;

  // Ensure range is loaded into the input
  loadRangeToUI(state);

  // Wire selects
  const opSel = $('opSel');
  if (opSel){
    const h = ()=>{ saveOp(state); renderAll(state); };
    opSel.addEventListener('change', h);
    opSel.addEventListener('input', h);
  }

  const sortSel = $('sortSel');
  if (sortSel){
    const h = ()=>{ saveSort(state); renderAll(state); };
    sortSel.addEventListener('change', h);
    sortSel.addEventListener('input', h);
  }

  const farmSel = $('farmSel');
  if (farmSel){
    farmSel.addEventListener('change', ()=>{ saveFarm(state); renderAll(state); });
  }

  const pageSel = $('pageSel');
  if (pageSel){
    pageSel.addEventListener('change', ()=>{ savePageSize(state); renderAll(state); });
  }

  // Range buttons
  const applyBtn = $('applyRangeBtn');
  if (applyBtn) applyBtn.addEventListener('click', ()=>{ setTimeout(()=>{ saveRangeFromUI(state); renderAll(state); }, 0); });

  const clearBtn = $('clearRangeBtn');
  if (clearBtn) clearBtn.addEventListener('click', ()=>{ setTimeout(()=>{ $('jobRangeInput').value=''; saveRangeFromUI(state); renderAll(state); }, 0); });

  const rangeInp = $('jobRangeInput');
  if (rangeInp){
    rangeInp.addEventListener('change', ()=>{ saveRangeFromUI(state); renderAll(state); });
    rangeInp.addEventListener('input',  ()=>{ saveRangeFromUI(state); renderAll(state); });
  }

  // Trim details panels (hide the stuff you want moved out later)
  trimDetailsPanelsOnce();
}
