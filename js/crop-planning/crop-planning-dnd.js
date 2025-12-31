/* =====================================================================
/Farm-vista/js/crop-planning/crop-planning-dnd.js  (FULL FILE)
Rev: 2025-12-30j

Fix:
✅ Explicit drag intent via data-drag-type:
   - farm grip: data-drag-type="farm"
   - field grip: data-drag-type="field"

✅ Event delegation for dropzones (no rebind issues after render).
===================================================================== */
'use strict';

export function wireDnd({ root, onDrop }) {
  if (!root) throw new Error('wireDnd: missing root');
  if (typeof onDrop !== 'function') throw new Error('wireDnd: missing onDrop');

  const isDesktop = () => window.matchMedia('(min-width: 981px)').matches;

  // ---------------- Drag start (explicit) ----------------
  root.addEventListener('dragstart', (e) => {
    if (!isDesktop()) return;

    const grip = e.target.closest('[data-drag-type]');
    if (!grip) return;

    const type = grip.dataset.dragType;

    if (type === 'field') {
      const row = grip.closest('[data-field-id]');
      if (!row) return;

      e.dataTransfer.setData('text/fv-type', 'field');
      e.dataTransfer.setData('text/fv-field-id', row.dataset.fieldId || '');
      e.dataTransfer.setData('text/fv-from-crop', row.dataset.crop || '');
      e.dataTransfer.effectAllowed = 'move';
      return;
    }

    if (type === 'farm') {
      const lane = grip.closest('[data-farm-id]');
      if (!lane) return;

      e.dataTransfer.setData('text/fv-type', 'farm');
      e.dataTransfer.setData('text/fv-farm-id', lane.dataset.farmId || '');
      e.dataTransfer.effectAllowed = 'move';
      return;
    }
  });

  // ---------------- Dropzone highlighting (delegated) ----------------
  root.addEventListener('dragover', (e) => {
    if (!isDesktop()) return;
    const zone = e.target.closest('.bucketBody');
    if (!zone) return;
    e.preventDefault();
    zone.classList.add('is-over');
  });

  root.addEventListener('dragleave', (e) => {
    const zone = e.target.closest?.('.bucketBody');
    if (!zone) return;
    zone.classList.remove('is-over');
  });

  // ---------------- Drop (delegated) ----------------
  root.addEventListener('drop', async (e) => {
    if (!isDesktop()) return;

    const zone = e.target.closest('.bucketBody');
    if (!zone) return;

    e.preventDefault();
    zone.classList.remove('is-over');

    const type = e.dataTransfer.getData('text/fv-type');
    const toCrop = zone.dataset.crop || '';

    if (type === 'field') {
      const fieldId = e.dataTransfer.getData('text/fv-field-id');
      const fromCrop = e.dataTransfer.getData('text/fv-from-crop');
      if (!fieldId) return;
      await onDrop({ type: 'field', fieldId, fromCrop, toCrop });
      return;
    }

    if (type === 'farm') {
      const farmId = e.dataTransfer.getData('text/fv-farm-id');
      if (!farmId) return;
      await onDrop({ type: 'farm', farmId, toCrop });
    }
  });
}
