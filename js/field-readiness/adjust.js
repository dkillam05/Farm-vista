/* =====================================================================
/Farm-vista/js/field-readiness/adjust.js  (FULL FILE)
Rev: 2025-12-26a
Phase 1: only the hidden Fields tap wiring (kept).
Phase 2: move full global adjust system here.
===================================================================== */
'use strict';

export function wireFieldsHiddenTap(state){
  const el = document.getElementById('fieldsTitle') || document.querySelector('[data-fields-tap]');
  if (!el) return;

  el.style.cursor = 'pointer';
  el.setAttribute('role','button');
  el.setAttribute('aria-label','Fields (tap for calibration)');

  el.addEventListener('click', (e)=>{
    e.preventDefault();
    e.stopPropagation();
    // In Phase 2 we’ll move openAdjustGlobal() into this module.
    // For now we just open the existing modal if it exists.
    const b = document.getElementById('adjustBackdrop');
    if (b) b.classList.remove('pv-hide');
  });
}
