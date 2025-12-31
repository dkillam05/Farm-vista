/* =====================================================================
/Farm-vista/js/crop-planning/crop-planning-dnd.js  (FULL FILE)
Rev: 2025-12-30g

DnD supports:
- field drag (data-field-id)
- farm drag  (data-farm-id)

Drop targets:
- bucket bodies: .bucketBody (data-crop + data-farm-id)
===================================================================== */
'use strict';

export function wireDnd(opts){
  const root = opts?.root;
  const onDrop = opts?.onDrop;
  if(!root) throw new Error('wireDnd: missing root');

  const isDesktop = () => window.matchMedia('(min-width: 981px)').matches;

  // Bucket dropzones
  const bindZones = () => {
    root.querySelectorAll('.bucketBody').forEach(zone=>{
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
          if(typeof onDrop === 'function') await onDrop({ type:'farm', farmId, toCrop, toFarmId });
          return;
        }

        const fieldId = e.dataTransfer?.getData('text/fv-field-id') || '';
        const fromCrop = e.dataTransfer?.getData('text/fv-from-crop') || '';
        const fromFarmId = e.dataTransfer?.getData('text/fv-from-farm-id') || '';
        if(!fieldId) return;

        if(typeof onDrop === 'function') await onDrop({ type:'field', fieldId, fromCrop, toCrop, fromFarmId, toFarmId });
      });
    });
  };

  // Drag start from grips
  root.addEventListener('dragstart', (e)=>{
    if(!isDesktop()) return;

    const grip = e.target?.closest?.('[data-drag-grip="1"]');
    if(!grip) return;

    // Farm drag?
    const farmWrap = grip.closest('[data-farm-id]');
    if(farmWrap){
      const farmId = farmWrap.getAttribute('data-farm-id') || '';
      if(!farmId) return;
      e.dataTransfer.setData('text/fv-type', 'farm');
      e.dataTransfer.setData('text/fv-farm-id', farmId);
      e.dataTransfer.effectAllowed = 'move';
      return;
    }

    // Field drag?
    const card = grip.closest('[data-field-id]');
    if(!card) return;

    const fieldId = card.getAttribute('data-field-id') || '';
    const fromCrop = card.getAttribute('data-crop') || '';
    const fromFarmId = card.getAttribute('data-farm-id') || '';
    if(!fieldId) return;

    e.dataTransfer.setData('text/fv-type', 'field');
    e.dataTransfer.setData('text/fv-field-id', fieldId);
    e.dataTransfer.setData('text/fv-from-crop', fromCrop);
    e.dataTransfer.setData('text/fv-from-farm-id', fromFarmId);
    e.dataTransfer.effectAllowed = 'move';
  });

  // Allow rebind after rerenders
  if(typeof opts?.onNeedBind === 'function'){
    opts.onNeedBind(bindZones);
  }
  bindZones();
}
