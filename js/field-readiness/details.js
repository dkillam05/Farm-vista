/* =====================================================================
/Farm-vista/js/field-readiness/details.js  (FULL FILE)
Rev: 2025-12-26a
Keeps details trimming separate so it never pollutes tiles/prefs/range.
===================================================================== */
'use strict';

export function trimDetailsPanelsOnce(){
  const body = document.querySelector('#detailsPanel .details-body');
  if (!body) return;

  const kids = Array.from(body.children || []);
  // Hide Inputs + Field/Weather grid (matches your plan)
  if (kids[0]) kids[0].style.display = 'none';
  if (kids[1]) kids[1].style.display = 'none';

  const sum = document.querySelector('#detailsPanel summary .muted');
  if (sum) sum.textContent = '(beta + tables)';
}

export function renderDetails(state){
  // Placeholder for now.
  // Next step: port your current Beta + tables rendering into this module.
}
