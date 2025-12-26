/* =====================================================================
/Farm-vista/js/field-readiness/farm-filter.js  (FULL FILE)
Rev: 2025-12-26a

Builds the Farm filter dropdown based on the farms present in Field Readiness fields.
- Always includes "__all__"
- Includes each farmId that appears in state.fields
- Uses state.farmsById name when available, else falls back to farmId
- Preserves current selection when possible
===================================================================== */
'use strict';

const $ = (id)=>document.getElementById(id);

export function buildFarmFilterOptions(state){
  const sel = $('farmSel');
  if (!sel) return;

  const used = new Map(); // farmId -> label
  for (const f of (state.fields || [])){
    const id = String(f.farmId || '').trim();
    if (!id) continue;
    const label = (state.farmsById && state.farmsById.get(id)) ? String(state.farmsById.get(id)) : id;
    used.set(id, label);
  }

  const keep = String(state.farmFilter || '__all__') || '__all__';

  // rebuild options
  sel.innerHTML = '';

  const oAll = document.createElement('option');
  oAll.value = '__all__';
  oAll.textContent = 'All';
  sel.appendChild(oAll);

  const ids = Array.from(used.keys()).sort((a,b)=>{
    const na = String(used.get(a) || a);
    const nb = String(used.get(b) || b);
    return na.localeCompare(nb, undefined, { numeric:true, sensitivity:'base' });
  });

  for (const id of ids){
    const o = document.createElement('option');
    o.value = id;
    o.textContent = String(used.get(id));
    sel.appendChild(o);
  }

  // preserve selection if still valid
  const ok = (keep === '__all__') || ids.includes(keep);
  sel.value = ok ? keep : '__all__';
  state.farmFilter = sel.value;
}
