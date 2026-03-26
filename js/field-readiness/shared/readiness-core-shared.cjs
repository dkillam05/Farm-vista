/* =====================================================================
/js/field-readiness/shared/readiness-core-shared.cjs  (FULL FILE)
Rev: 2026-03-26b-readiness-disabled-noop

PURPOSE
✅ Shared readiness core intentionally disabled for this Cloud Run job
✅ Prevents backend rainfall sync job from recalculating readiness
✅ Keeps exports in place so older imports do not crash
===================================================================== */

'use strict';

function runFieldReadinessCore(){
  return null;
}

function runReadinessFromPersistedStateOnly(){
  return null;
}

module.exports = {
  runFieldReadinessCore,
  runReadinessFromPersistedStateOnly
};