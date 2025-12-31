/* =====================================================================
/Farm-vista/js/crop-planning/crop-planning-dnd.js  (FULL FILE)
Rev: 2025-12-30i

CRITICAL FIX:
- Drag intent is EXPLICIT.
- Field drag ≠ Farm drag.
- No parent guessing. No bubbling ambiguity.

Rules:
- data-drag-type="field" → move ONE field
- data-drag-type="farm"  → move ENTIRE farm
===================================================================== */
'use strict';

export function wireDnd({ root, onDrop }) {
  if (!root) throw new Error('wireDnd: missing root');

  const isDesktop = () => window.matchMedia('(min-width: 981px)').matches;

  /* ---------------- Drag Start ---------------- */
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

  /* ---------------- Drop Zones ---------------- */
  function bindZones() {
    root.querySelectorAll('.bucketBody').forEach(zone => {
      if (zone._fvBound) return;
      zone._fvBound = true;

      zone.addEventListener('dragover', (e) => {
        if (!isDesktop()) return;
        e.preventDefault();
        zone.classList.add('is-over');
      });

      zone.addEventListener('dragleave', () => {
        zone.classList.remove('is-over');
      });

      zone.addEventListener('drop', async (e) => {
        if (!isDesktop()) return;
        e.preventDefault();
        zone.classList.remove('is-over');

        const type = e.dataTransfer.getData('text/fv-type');
        const toCrop = zone.dataset.crop || '';

        if (!type) return;

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
    });
  }

  bindZones();
}
