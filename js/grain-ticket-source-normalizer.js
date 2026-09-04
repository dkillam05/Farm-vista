import {
  ready,
  getFirestore,
  collection,
  getDocs,
  doc,
  updateDoc,
  serverTimestamp
} from '/js/firebase-init.js';

/*
  FarmVista grain ticket source normalizer
  ----------------------------------------
  Goal: make Manual, in-app OCR, and SMS/guest tickets roll up the same way.

  Some SMS tickets are linked to a grain_loadouts document that contains the
  correct Field / Active Harvest source, while the grain_tickets document may
  not contain the canonical source fields. Ticket Details can still LOOK right
  because it can recover data from the linked load, but Grain Inventory reads
  grain_tickets directly and therefore misses those tickets.

  This module repairs that mismatch by copying the linked load's canonical
  harvest-source fields onto the ticket document. Existing correctly-saved
  manual/OCR tickets are left alone.
*/

const clean = value => String(value == null ? '' : value).trim();
const norm = value => clean(value).toLowerCase();

function first(...values) {
  for (const value of values) {
    const v = clean(value);
    if (v) return v;
  }
  return '';
}

function ticketLoadId(ticket) {
  return first(
    ticket?.loadoutId,
    ticket?.loadOutId,
    ticket?.grainLoadoutId,
    ticket?.loadId
  );
}

function ticketLoadNumber(ticket) {
  return first(
    ticket?.loadNumber,
    ticket?.farmVistaLoadNumber,
    ticket?.farmvistaLoadNumber,
    ticket?.fvLoadNumber
  );
}

function loadNumberValue(load) {
  return first(
    load?.loadNumber,
    load?.farmVistaLoadNumber,
    load?.farmvistaLoadNumber,
    load?.fvLoadNumber
  );
}

function sourceFromRecord(record) {
  const sourceType = norm(
    first(
      record?.grainSourceType,
      record?.grainSource?.type,
      record?.sourceType
    )
  );

  const sourceScope = norm(
    first(
      record?.grainSourceScope,
      record?.grainSource?.sourceScope,
      record?.grainSource?.scope,
      record?.sourceScope
    )
  );

  const fieldId = first(
    record?.grainSourceFieldId,
    record?.fieldId,
    record?.grainSource?.fieldId,
    record?.sourceFieldId
  );

  const fieldName = first(
    record?.grainSourceFieldName,
    record?.fieldName,
    record?.grainSource?.fieldName,
    record?.sourceFieldName
  );

  const sourceId = first(
    record?.grainSourceId,
    record?.grainSource?.id,
    record?.grainSource?.sourceId,
    record?.sourceId
  );

  const sourceName = first(
    record?.grainSourceName,
    record?.grainSource?.name,
    record?.grainSource?.label,
    record?.sourceName
  );

  const sourceValue = first(
    record?.grainSourceValue,
    record?.grainSource?.value,
    record?.sourceValue
  );

  const fieldBased = Boolean(
    fieldId ||
    fieldName ||
    sourceScope === 'field' ||
    sourceType === 'field'
  );

  const activeHarvest = Boolean(
    fieldBased ||
    sourceType === 'active_field_harvest' ||
    sourceType === 'active harvest' ||
    sourceType === 'active_harvest'
  );

  return {
    activeHarvest,
    fieldBased,
    sourceType,
    sourceScope,
    fieldId,
    fieldName,
    sourceId,
    sourceName,
    sourceValue
  };
}

function sourceAlreadyCanonical(ticket) {
  const source = sourceFromRecord(ticket);
  if (!source.activeHarvest) return false;

  if (source.fieldBased) {
    return Boolean(
      norm(ticket?.grainSourceScope) === 'field' &&
      clean(ticket?.grainSourceFieldName || ticket?.grainSourceFieldId)
    );
  }

  return norm(ticket?.grainSourceType) === 'active_field_harvest';
}

function buildLoadIndexes(loadDocs) {
  const byId = new Map();
  const byTicketId = new Map();
  const byLoadNumber = new Map();

  for (const ds of loadDocs) {
    const load = { id: ds.id, ...(ds.data() || {}) };
    byId.set(ds.id, load);

    const grainTicketId = first(load.grainTicketId, load.ticketId);
    if (grainTicketId) byTicketId.set(grainTicketId, load);

    const loadNumber = loadNumberValue(load);
    if (loadNumber) {
      const key = norm(loadNumber);
      if (!byLoadNumber.has(key)) byLoadNumber.set(key, []);
      byLoadNumber.get(key).push(load);
    }
  }

  return { byId, byTicketId, byLoadNumber };
}

function linkedLoadForTicket(ticket, indexes) {
  const id = ticketLoadId(ticket);
  if (id && indexes.byId.has(id)) return indexes.byId.get(id);

  if (indexes.byTicketId.has(ticket.id)) {
    return indexes.byTicketId.get(ticket.id);
  }

  const number = ticketLoadNumber(ticket);
  if (number) {
    const matches = indexes.byLoadNumber.get(norm(number)) || [];
    if (matches.length === 1) return matches[0];
  }

  return null;
}

function buildPatch(ticket, load) {
  const loadSource = sourceFromRecord(load);
  if (!loadSource.activeHarvest) return null;

  const patch = {
    grainSourceType: 'active_field_harvest',
    grainSourceScope: loadSource.fieldBased ? 'field' : null,
    sourceNormalizedFromLoad: true,
    sourceNormalizedAt: serverTimestamp()
  };

  const loadId = first(load?.id, ticketLoadId(ticket));
  const loadNumber = loadNumberValue(load) || ticketLoadNumber(ticket);

  if (loadId && !ticketLoadId(ticket)) patch.loadoutId = loadId;
  if (loadNumber && !ticketLoadNumber(ticket)) patch.loadNumber = loadNumber;

  if (loadSource.fieldBased) {
    const fieldId = first(loadSource.fieldId, loadSource.sourceId);
    const fieldName = first(loadSource.fieldName, loadSource.sourceName);

    if (fieldId) {
      patch.grainSourceFieldId = fieldId;
      patch.fieldId = fieldId;
      patch.grainSourceId = fieldId;
    }

    if (fieldName) {
      patch.grainSourceFieldName = fieldName;
      patch.fieldName = fieldName;
      patch.grainSourceName = fieldName;
    }

    if (loadSource.sourceValue) patch.grainSourceValue = loadSource.sourceValue;
  } else {
    patch.grainSourceFieldId = null;
    patch.grainSourceFieldName = null;
  }

  return patch;
}

async function normalizeGrainTicketSources() {
  try {
    await ready;
    const db = getFirestore();

    const [ticketSnap, loadSnap] = await Promise.all([
      getDocs(collection(db, 'grain_tickets')),
      getDocs(collection(db, 'grain_loadouts'))
    ]);

    const indexes = buildLoadIndexes(loadSnap.docs);
    const updates = [];

    for (const ds of ticketSnap.docs) {
      const ticket = { id: ds.id, ...(ds.data() || {}) };
      if (ticket.voided === true) continue;
      if (sourceAlreadyCanonical(ticket)) continue;

      const load = linkedLoadForTicket(ticket, indexes);
      if (!load) continue;

      const patch = buildPatch(ticket, load);
      if (!patch) continue;

      updates.push(
        updateDoc(doc(db, 'grain_tickets', ds.id), patch)
      );
    }

    if (!updates.length) return 0;

    await Promise.all(updates);

    document.dispatchEvent(
      new CustomEvent('fv:grain-inventory-posted', {
        detail: {
          reason: 'grain-ticket-source-normalized',
          updatedTickets: updates.length
        }
      })
    );

    return updates.length;
  } catch (error) {
    console.warn('[FarmVista] Grain ticket source normalization failed:', error);
    return 0;
  }
}

normalizeGrainTicketSources();
