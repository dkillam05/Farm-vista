/* =====================================================================
/Farm-vista/js/field-readiness/adjust.js  (FULL FILE)
Rev: 2025-12-29a

Change (per Dane):
✅ "Fields" label is ALWAYS visible
   - If edit NOT allowed: it is NOT clickable (no link behavior) + calibration not wired
   - If edit allowed: it remains the tiny hotspot + calibration wired

Keeps:
✅ Tiny hotspot (only the word "Fields")
✅ Global calibration logic stays in global-calibration.js
===================================================================== */
'use strict';

import { initGlobalCalibration } from './global-calibration.js';
import { canEdit } from './perm.js';

export function wireFieldsHiddenTap(state){
  // Ensure the hotspot is tiny + gated.
  try{
    const hot = document.getElementById('fieldsTitle'); // span with the word "Fields"
    if (hot){
      hot.style.userSelect = 'none';

      // ALWAYS visible, but only clickable when edit is allowed
      hot.style.display = 'inline';
      hot.removeAttribute('aria-hidden');

      if (!canEdit(state)){
        // Show but NOT a link/hotspot
        hot.style.pointerEvents = 'none';
        hot.style.cursor = 'default';
        hot.style.textDecoration = 'none';
        hot.setAttribute('aria-disabled','true');
        return; // do NOT wire global calibration for view-only users
      } else {
        hot.style.pointerEvents = 'auto';
        hot.style.cursor = 'pointer';
        hot.removeAttribute('aria-disabled');
      }
    }
  }catch(_){}

  // Kept for compatibility with older imports — now does the real init.
  // NOTE: cooldown / lock logic is in global-calibration.js
  initGlobalCalibration(state);
}
