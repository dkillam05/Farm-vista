/* =====================================================================
/Farm-vista/js/crop-planning/crop-planning-dnd.js  (FULL FILE)
Rev: 2025-12-30c
HTML5 drag/drop wiring for the planner board.

Exports:
- wireDnd({ root, onDrop, onDragStart })
===================================================================== */
'use strict';

export function wireDnd(opts){
  const root = opts?.root;
  const onDrop = opts?.onDrop;
  const onDragStart = opts?.onDragStart;

  if(!root) throw new Error('wireDnd: missing root');

  const isDesktop = () => window.matchMedia('(min-width: 981px)').matches;

  // Dropzone behavior
  const zones = root.querySelectorAll('.dropzone');
  zones.forEach(zone=>{
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

      const fieldId = e.dataTransfer?.getData('text/fv-field-id') || '';
      const fromCrop = e.dataTransfer?.getData('text/fv-from-crop') || '';
      const toCrop = zone.getAttribute('data-crop') || '';

      if(!fieldId) return;
      if(typeof onDrop === 'function'){
        await onDrop({ fieldId, fromCrop, toCrop });
      }
    });
  });

  // Drag start on card grip
  root.addEventListener('dragstart', (e)=>{
    if(!isDesktop()) return;
    const grip = e.target?.closest?.('[data-drag-grip="1"]');
    if(!grip) return;

    const card = grip.closest('[data-field-id]');
    if(!card) return;

    const fieldId = card.getAttribute('data-field-id') || '';
    const fromCrop = card.getAttribute('data-crop') || '';
    if(!fieldId) return;

    e.dataTransfer.setData('text/fv-field-id', fieldId);
    e.dataTransfer.setData('text/fv-from-crop', fromCrop);
    e.dataTransfer.effectAllowed = 'move';

    if(typeof onDragStart === 'function'){
      onDragStart({ fieldId, fromCrop });
    }
  });
}
