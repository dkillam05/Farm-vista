/* =====================================================================
/Farm-vista/js/field-readiness/adjust.js  (FULL FILE)
Rev: 2025-12-27a

Fixes (per Dane):
✅ Only the word "Fields" is clickable (small hidden hotspot) — NOT the whole row
✅ Permission gate:
   - if canEdit(state) is false -> hotspot hidden + calibration not wired
✅ Still uses global-calibration.js for the real 72h rule + modal behavior

===================================================================== */
'use strict';

import { initGlobalCalibration } from './global-calibration.js';
import { canEdit } from './perm.js';

export function wireFieldsHiddenTap(state){
  // Ensure the hotspot is tiny + gated.
  try{
    const hot = document.getElementById('fieldsTitle'); // this is now the *span* with the word "Fields"
    if (hot){
      // Always prevent the label area from becoming a giant tap target
      hot.style.userSelect = 'none';

      // Gate by permission (edit only)
      if (!canEdit(state)){
        hot.style.display = 'none';
        hot.style.pointerEvents = 'none';
        hot.setAttribute('aria-hidden','true');
        return; // do NOT wire global calibration for view-only users
      } else {
        hot.style.display = 'inline';
        hot.style.pointerEvents = 'auto';
        hot.removeAttribute('aria-hidden');
      }
    }
  }catch(_){}

  // Kept for compatibility with older imports — now does the real init.
  // NOTE: cooldown / lock logic is in global-calibration.js
  initGlobalCalibration(state);
}
