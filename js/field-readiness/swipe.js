/* =====================================================================
/Farm-vista/js/field-readiness/swipe.js  (FULL FILE)
Rev: 2025-12-26a

Swipe helper for Field Readiness tiles.
- Injects swipe-list.css if missing
- Uses /Farm-vista/js/fv-swipe-list.js
- Only enabled when user has edit permission (crop-weather.edit)

===================================================================== */
'use strict';

import { canEdit } from './perm.js';

const SWIPE_CSS_HREF = '/Farm-vista/assets/css/swipe-list.css';

function ensureSwipeCSS(){
  try{
    const existing = document.querySelector(`link[rel="stylesheet"][href="${SWIPE_CSS_HREF}"]`);
    if (existing) return;

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = SWIPE_CSS_HREF;
    document.head.appendChild(link);
  }catch(_){}
}

export async function initSwipeOnTiles(state, { onDetails }){
  // If no edit permission, do not attach swipe UI at all.
  if (!canEdit(state)) return;

  ensureSwipeCSS();

  const root = document.getElementById('fieldsGrid');
  if (!root) return;

  // Lazy import (keeps startup fast)
  let swipe = null;
  try{
    swipe = await import('/Farm-vista/js/fv-swipe-list.js');
  }catch(e){
    console.warn('[FieldReadiness] swipe import failed:', e);
    return;
  }

  if (!swipe || typeof swipe.initSwipeList !== 'function') return;

  // Re-init is safe because renderTiles wipes innerHTML each time.
  swipe.initSwipeList(root, {
    itemSelector: '.fv-swipe-item',
    leftAction: {
      label: 'Details',
      intent: 'positive',
      onAction: (itemEl)=>{
        try{
          const fieldId = itemEl && itemEl.dataset ? itemEl.dataset.fieldId : null;
          if (!fieldId) return;
          if (typeof onDetails === 'function') onDetails(fieldId);
        }catch(_){}
      }
    },
    rightAction: null
  });
}
