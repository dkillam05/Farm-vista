/* =====================================================================
/Farm-vista/js/field-readiness/swipe.js  (FULL FILE)
Rev: 2025-12-26b

Swipe is MOBILE ONLY:
- Only initializes on touch/coarse-pointer devices
- Still requires edit permission
===================================================================== */
'use strict';

import { canEdit } from './perm.js';

const SWIPE_CSS_HREF = '/Farm-vista/assets/css/swipe-list.css';

function isTouchLike(){
  try{
    if (window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches) return true;
  }catch(_){}
  try{
    if ('ontouchstart' in window) return true;
    if (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) return true;
  }catch(_){}
  return false;
}

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
  // Mobile only + edit only
  if (!isTouchLike()) return;
  if (!canEdit(state)) return;

  ensureSwipeCSS();

  const root = document.getElementById('fieldsGrid');
  if (!root) return;

  let swipe = null;
  try{
    swipe = await import('/Farm-vista/js/fv-swipe-list.js');
  }catch(e){
    console.warn('[FieldReadiness] swipe import failed:', e);
    return;
  }
  if (!swipe || typeof swipe.initSwipeList !== 'function') return;

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
