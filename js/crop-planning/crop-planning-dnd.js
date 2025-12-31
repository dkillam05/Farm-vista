/* =====================================================================
/Farm-vista/js/crop-planning/crop-planning-dnd.js  (FULL FILE)
Rev: 2025-12-31b

Fixes:
✅ Drop now works when you drop on the bucket CARD (header/body/empty state),
   not just inside .bucketBody. This is what usually makes "Unplanned" feel broken.
✅ Highlight applies to the whole bucket while hovering.

DnD types:
- field   : single field
- fields  : multi-selected fields
- bucket  : all fields in a farm bucket (unplanned/corn/soybeans)
- farm    : all fields in a farm (in-scope)

Uses explicit drag intent:
- data-drag-type="field"  (on field grip)
- data-drag-type="bucket" (on bucket grip)
- data-drag-type="farm"   (on farm grip)
===================================================================== */
'use strict';

export function wireDnd({ root, onDrop, isEnabled }) {
  if (!root) throw new Error('wireDnd: missing root');
  if (typeof onDrop !== 'function') throw new Error('wireDnd: missing onDrop');

  const enabled = () => (typeof isEnabled === 'function' ? !!isEnabled() : true);

  const getZone = (target) => {
    // We mark the entire bucket as a drop zone in the module (data-dropzone="1")
    // so dropping on header / empty state / body all works.
    return target?.closest?.('[data-dropzone="1"]') || null;
  };

  const setOver = (zone, on) => {
    if (!zone) return;
    if (on) zone.classList.add('is-over');
    else zone.classList.remove('is-over');
  };

  // ---- Drag start (delegated) ----
  root.addEventListener('dragstart', (e) => {
    if (!enabled()) return;

    const grip = e.target.closest('[data-drag-type]');
    if (!grip) return;

    const type = grip.dataset.dragType;

    if (type === 'field') {
      const row = grip.closest('[data-field-id]');
      if (!row) return;

      // if dragging a selected row, allow multi-drag via dataset on row
      const selectedJson = row.dataset.selectedIds || '';

      if (selectedJson) {
        e.dataTransfer.setData('text/fv-type', 'fields');
        e.dataTransfer.setData('text/fv-field-ids', selectedJson);
        e.dataTransfer.effectAllowed = 'move';
        return;
      }

      e.dataTransfer.setData('text/fv-type', 'field');
      e.dataTransfer.setData('text/fv-field-id', row.dataset.fieldId || '');
      e.dataTransfer.setData('text/fv-from-crop', row.dataset.crop || '');
      e.dataTransfer.effectAllowed = 'move';
      return;
    }

    if (type === 'bucket') {
      const bucket = grip.closest('[data-bucket-crop][data-bucket-farm]');
      if (!bucket) return;

      e.dataTransfer.setData('text/fv-type', 'bucket');
      e.dataTransfer.setData('text/fv-bucket-crop', bucket.dataset.bucketCrop || '');
      e.dataTransfer.setData('text/fv-bucket-farm', bucket.dataset.bucketFarm || '');
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

  // ---- Dropzone highlight (delegated) ----
  root.addEventListener('dragover', (e) => {
    if (!enabled()) return;

    const zone = getZone(e.target);
    if (!zone) return;

    e.preventDefault();
    setOver(zone, true);
  });

  root.addEventListener('dragleave', (e) => {
    const zone = getZone(e.target);
    if (!zone) return;
    setOver(zone, false);
  });

  // ---- Drop (delegated) ----
  root.addEventListener('drop', async (e) => {
    if (!enabled()) return;

    const zone = getZone(e.target);
    if (!zone) return;

    e.preventDefault();
    setOver(zone, false);

    const type = e.dataTransfer.getData('text/fv-type');
    const toCrop = zone.dataset.crop || '';

    if (type === 'field') {
      const fieldId = e.dataTransfer.getData('text/fv-field-id');
      const fromCrop = e.dataTransfer.getData('text/fv-from-crop');
      if (!fieldId) return;
      await onDrop({ type: 'field', fieldId, fromCrop, toCrop });
      return;
    }

    if (type === 'fields') {
      const idsJson = e.dataTransfer.getData('text/fv-field-ids');
      if (!idsJson) return;
      await onDrop({ type: 'fields', fieldIdsJson: idsJson, toCrop });
      return;
    }

    if (type === 'bucket') {
      const bucketCrop = e.dataTransfer.getData('text/fv-bucket-crop');
      const bucketFarm = e.dataTransfer.getData('text/fv-bucket-farm');
      if (!bucketFarm && bucketFarm !== '') return;
      await onDrop({ type: 'bucket', bucketCrop, bucketFarm, toCrop });
      return;
    }

    if (type === 'farm') {
      const farmId = e.dataTransfer.getData('text/fv-farm-id');
      if (!farmId) return;
      await onDrop({ type: 'farm', farmId, toCrop });
    }
  });
}
