/* =====================================================================
/Farm-vista/js/crop-planning/crop-planning-dnd.js  (FULL FILE)
Rev: 2025-12-30h

Fix:
✅ Field drags must NOT be misclassified as farm drags.
   - We now detect FIELD first (closest [data-field-id])
   - Only if no field wrapper, detect FARM (closest [data-farm-id] lane)

DnD supports:
- field drag (data-field-id + data-farm-id + data-crop)
- farm drag  (farm lane [data-farm-id])

Drop targets:
- bucket bodies: .bucketBody (data-crop + data-farm-id)
===================================================================== */
'use strict';

export function wireDnd(opts){
  const root = opts?.root;
  const onDrop = opts?.onDrop;
  if(!root) throw new Error('wireDnd: missing root');

  const isDesktop = () => window.matchMedia('(min-width: 981px)').matches;

  // Bind dropzones (bucket bodies)
  function bindZones(){
    root.querySelectorAll('.bucketBody').forEach(zone=>{
      if(zone._fvBound) return;
      zone._fvBound = true;

      zone.addEventListener('dragover', (e)=>{
        if(!isDesktop()) return;
        e.preventDefault();
        zone.classList.add('is-over');
      });

      zone.addEventListener('dragleave', ()=>{
        zone.classList.remove('is-over');
      });

      zone.addEventListener('drop', async (e)=>{
        zone.classList.remove('is-over');
        if(!isDesktop()) return;
        e.preventDefault();

        const type = e.dataTransfer?.getData('text/fv-type') || 'field';
        const toCrop = zone.getAttribute('data-crop') || '';
        const toFarmId = zone.getAttribute('data-farm-id') || '';

        if(type === 'farm'){
          const farmId = e.dataTransfer?.getData('text/fv-farm-id') || '';
          if(!farmId) return;
          if(typeof onDrop === 'function'){
            await onDrop({ type:'farm', farmId, toCrop, toFarmId });
          }
          return;
        }

        const fieldId = e.dataTransfer?.getData('text/fv-field-id') || '';
        const fromCrop = e.dataTransfer?.getData('text/fv-from-crop') || '';
        const fromFarmId = e.dataTransfer?.getData('text/fv-from-farm-id') || '';
        if(!fieldId) return;

        if(typeof onDrop === 'function'){
          await onDrop({ type:'field', fieldId, fromCrop, toCrop, fromFarmId, toFarmId });
        }
      });
    });
  }

  // Drag start from grips (FIELD first, then FARM)
  root.addEventListener('dragstart', (e)=>{
    if(!isDesktop()) return;

    const grip = e.target?.closest?.('[data-drag-grip="1"]');
    if(!grip) return;

    // 1) FIELD drag takes priority
    const fieldWrap = grip.closest('[data-field-id]');
    if(fieldWrap){
      const fieldId = fieldWrap.getAttribute('data-field-id') || '';
      const fromCrop = fieldWrap.getAttribute('data-crop') || '';
      const fromFarmId = fieldWrap.getAttribute('data-farm-id') || '';
      if(!fieldId) return;

      e.dataTransfer.setData('text/fv-type', 'field');
      e.dataTransfer.setData('text/fv-field-id', fieldId);
      e.dataTransfer.setData('text/fv-from-crop', fromCrop);
      e.dataTransfer.setData('text/fv-from-farm-id', fromFarmId);
      e.dataTransfer.effectAllowed = 'move';
      return;
    }

    // 2) FARM drag (only if not a field)
    const farmLane = grip.closest('.farmLane[data-farm-id]');
    if(farmLane){
      const farmId = farmLane.getAttribute('data-farm-id') || '';
      if(!farmId) return;

      e.dataTransfer.setData('text/fv-type', 'farm');
      e.dataTransfer.setData('text/fv-farm-id', farmId);
      e.dataTransfer.effectAllowed = 'move';
      return;
    }
  });

  // Initial bind
  bindZones();

  // Optional hook (if caller wants to rebind after rerender)
  if(typeof opts?.onNeedBind === 'function'){
    opts.onNeedBind(bindZones);
  }
}
