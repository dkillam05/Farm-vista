/* =====================================================================
/Farm-vista/js/field-readiness/tiles.js  (FULL FILE)
Rev: 2025-12-26a

This is currently a minimal renderer placeholder.
Next step: port your exact tile rendering + model calls into here.
===================================================================== */
'use strict';

const $ = (id)=>document.getElementById(id);

export function renderTiles(state){
  const wrap = $('fieldsGrid');
  if (!wrap) return;
  wrap.innerHTML = '';

  // Minimal “it’s wired” view for now:
  for (const f of (state.fields || [])){
    const div = document.createElement('div');
    div.className = 'tile';
    div.textContent = f.name || f.id;
    div.addEventListener('click', ()=>{ state.selectedFieldId = f.id; });
    wrap.appendChild(div);
  }
}
