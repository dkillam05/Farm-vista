/* =====================================================================
/Farm-vista/js/field-readiness/wiring.js  (FULL FILE)
Rev: 2026-03-10b-range-persistence-hardened-no-trim

Fixes (per Dane):
✅ Prevent “refresh storms” that cause blank → slowly rebuild tiles:
   - Debounce refreshAll calls (single refresh after rapid UI events)
   - Support optional boot hold:
       state._fvHoldRefresh = true  => queue refresh (state._fvRefreshPending = true)
       state._fvHoldRefresh = false => next scheduleRefresh() runs normally

✅ Harden rain-range persistence so selected dates do NOT clear when leaving page:
   - Save on change/input as before
   - Save on blur/focusout
   - Save on pagehide / beforeunload / visibilitychange
   - Save shortly after pointer/key interactions in case the picker updates value
     after the immediate event cycle

Keeps:
✅ Persist + restore:
   - Sort (localStorage via prefs.js)
   - Rain range (localStorage key: fv_fr_range_v1)
✅ Keeps:
   - op save on change/input
   - farm/page size save
   - tooltip close logic
===================================================================== */
'use strict';

import { waitForEl } from './utils.js';
import { saveFarmFilterDefault, savePageSizeDefault, saveOpDefault, saveSortDefault } from './prefs.js';
import { refreshAll } from './render.js';
import { buildFarmFilterOptions } from './farm-filter.js';

const LS_RANGE_KEY = 'fv_fr_range_v1';

function saveRangeToLocal(){
  try{
    const inp = document.getElementById('jobRangeInput');
    const v = String(inp ? inp.value : '').trim();
    localStorage.setItem(LS_RANGE_KEY, v);
  }catch(_){}
}

export async function wireUIOnce(state){
  if (state._wiredUI) return;
  state._wiredUI = true;

  await waitForEl('opSel', 3000);
  await waitForEl('sortSel', 3000);

  /* -------------------------------------------------------------
     Debounced refresh (prevents rapid re-renders while UI restores)
     - If state._fvHoldRefresh is true, queue a single refresh
       by setting state._fvRefreshPending = true.
  -------------------------------------------------------------- */
  const scheduleRefresh = (()=>{
    let t = null;
    return ()=>{
      try{
        if (state && state._fvHoldRefresh){
          state._fvRefreshPending = true;
          return;
        }
      }catch(_){}

      if (t) clearTimeout(t);
      t = setTimeout(()=>{
        t = null;
        try{ refreshAll(state); }catch(_){}
      }, 140);
    };
  })();

  /* -------------------------------------------------------------
     Range persistence hardening
  -------------------------------------------------------------- */
  const scheduleRangeSave = (()=>{
    let t = null;
    return (delay = 0)=>{
      try{
        if (t) clearTimeout(t);
        t = setTimeout(()=>{
          t = null;
          saveRangeToLocal();
        }, Math.max(0, Number(delay) || 0));
      }catch(_){}
    };
  })();

  // Sort (persist + refresh)
  const sortSel = document.getElementById('sortSel');
  if (sortSel){
    sortSel.addEventListener('change', ()=>{
      saveSortDefault();
      scheduleRefresh();
    });
  }

  // Operation (persist + refresh)
  const opSel = document.getElementById('opSel');
  if (opSel){
    const handler = ()=>{
      saveOpDefault();
      scheduleRefresh();
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

      scheduleRefresh();
    });
  }

  // Page size
  const pageSel = document.getElementById('pageSel');
  if (pageSel){
    pageSel.addEventListener('change', ()=>{
      savePageSizeDefault(state);
      scheduleRefresh();
    });
  }

  // Range controls (persist + refresh)
  const applyRangeBtn = document.getElementById('applyRangeBtn');
  if (applyRangeBtn) applyRangeBtn.addEventListener('click', ()=>{
    saveRangeToLocal();
    setTimeout(()=>scheduleRefresh(), 0);
  });

  const clearRangeBtn = document.getElementById('clearRangeBtn');
  if (clearRangeBtn) clearRangeBtn.addEventListener('click', ()=>{
    // let the picker clear the input, then save
    setTimeout(()=>{
      saveRangeToLocal();
      scheduleRefresh();
    }, 0);
  });

  const jobRangeInput = document.getElementById('jobRangeInput');
  if (jobRangeInput){
    // Standard events
    jobRangeInput.addEventListener('change', ()=>{
      saveRangeToLocal();
      scheduleRefresh();
    });

    jobRangeInput.addEventListener('input', ()=>{
      saveRangeToLocal();
      scheduleRefresh();
    });

    // Extra persistence for picker flows that don’t always emit the same event timing
    jobRangeInput.addEventListener('blur', ()=>{
      saveRangeToLocal();
    });

    jobRangeInput.addEventListener('focusout', ()=>{
      saveRangeToLocal();
    });

    jobRangeInput.addEventListener('keyup', ()=>{
      scheduleRangeSave(0);
    });

    jobRangeInput.addEventListener('pointerup', ()=>{
      // many calendar pickers finalize the text right after pointer interaction
      scheduleRangeSave(20);
    });

    jobRangeInput.addEventListener('click', ()=>{
      scheduleRangeSave(20);
    });

    // Some pickers update the value after the current event loop
    jobRangeInput.addEventListener('mousedown', ()=>{
      scheduleRangeSave(60);
    });

    jobRangeInput.addEventListener('touchend', ()=>{
      scheduleRangeSave(60);
    });
  }

  // Save range when leaving / backgrounding page
  window.addEventListener('pagehide', ()=>{
    saveRangeToLocal();
  });

  window.addEventListener('beforeunload', ()=>{
    saveRangeToLocal();
  });

  document.addEventListener('visibilitychange', ()=>{
    if (document.hidden){
      saveRangeToLocal();
    } else {
      scheduleRangeSave(0);
    }
  });

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