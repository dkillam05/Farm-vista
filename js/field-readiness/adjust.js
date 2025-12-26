/* =====================================================================
/Farm-vista/js/field-readiness/adjust.js  (FULL FILE)
Rev: 2025-12-26a

Wires global calibration (72h rule) via global-calibration.js
===================================================================== */
'use strict';

import { initGlobalCalibration } from './global-calibration.js';

export function wireFieldsHiddenTap(state){
  // Kept for compatibility with older imports — now does the real init.
  initGlobalCalibration(state);
}
