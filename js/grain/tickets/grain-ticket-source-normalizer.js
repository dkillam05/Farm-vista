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
  FarmVista canonical grain source normalizer
  -------------------------------------------
  ONE source model for Manual, OCR, SMS/guest, Load Out and Ticket Details.

  Canonical Active Harvest:
    grainSourceType      = "active_field_harvest"
    grainSourceScope     = null
    grainSourceValue     = "active_field_harvest"
    grainSourceName      = "Active Harvest"
    all field IDs/names  = null

  Canonical Field (a scoped Active Harvest source):
    grainSourceType      = "active_field_harvest"
    grainSourceScope     = "field"
    grainSourceValue     = "active_field_harvest:field:<fieldId>:<crop>"
    grainSourceId        = <fieldId>
    grainSourceName      = <actual fields/{id}.name>
    grainSourceFieldId   = <fieldId>
    grainSourceFieldName = <actual fields/{id}.name>
    fieldId              = <fieldId>
    fieldName            = <actual fields/{id}.name>

  Storage sources are intentionally left alone.

  This repairs existing records too.  Most importantly, it never treats
  labels such as "Active Field Harvest" or "Active Harvest" as field names.
  A record is a field only when it resolves to a real document in /fields.
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

function cropKey(value) {
  const c = norm(value);
  if (['soy', 'soybean', 'soybeans', 'beans', 'sb'].includes(c)) return 'soybeans';
  if (['corn', 'maize'].includes(c)) return 'corn';
  if (['wheat', 'winter wheat', 'spring wheat'].includes(c)) return 'wheat';
  return c.replace(/[^a-z0-9]+/g, '_');
}

function parseFieldSourceValue(value) {
  const parts = clean(value).split(':').map(clean);
  const isField =
    norm(parts[0]) === 'active_field_harvest' &&
    norm(parts[1]) === 'field' &&
    Boolean(parts[2]);

  return {
    isField,
    fieldId: isField ? parts[2] : '',
    crop: isField ? parts[3] || '' : ''
  };
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

function rawSource(record) {
  const sourceValue = first(
    record?.grainSourceValue,
    record?.grainSource?.value,
    record?.sourceValue
  );

  return {
    sourceType: norm(first(
      record?.grainSourceType,
      record?.grainSource?.type,
      record?.sourceType
    )),
    sourceScope: norm(first(
      record?.grainSourceScope,
      record?.grainSource?.sourceScope,
      record?.grainSource?.scope,
      record?.sourceScope
    )),
    sourceValue,
    sourceId: first(
      record?.grainSourceId,
      record?.grainSource?.id,
      record?.grainSource?.sourceId,
      record?.sourceId
    ),
    sourceName: first(
      record?.grainSourceName,
      record?.grainSource?.name,
      record?.grainSource?.label,
      record?.sourceName
    ),
    fieldId: first(
      record?.grainSourceFieldId,
      record?.fieldId,
      record?.grainSource?.fieldId,
      record?.sourceFieldId
    ),
    fieldName: first(
      record?.grainSourceFieldName,
      record?.fieldName,
      record?.grainSource?.fieldName,
      record?.sourceFieldName
    )
  };
}

function isActiveHarvestSignal(source) {
  const parsed = parseFieldSourceValue(source.sourceValue);
  return Boolean(
    parsed.isField ||
    source.sourceType === 'field' ||
    source.sourceScope === 'field' ||
    source.sourceType === 'active_field_harvest' ||
    source.sourceType === 'active harvest' ||
    source.sourceType === 'active_harvest' ||
    norm(source.sourceValue).startsWith('active_field_harvest')
  );
}

function buildFieldIndexes(fieldDocs) {
  const byId = new Map();
  const byName = new Map();

  for (const ds of fieldDocs) {
    const data = ds.data() || {};
    const name = clean(data.name);
    if (!name) continue;

    const field = {
      id: ds.id,
      name,
      farmId: clean(data.farmId),
      status: clean(data.status || 'active')
    };

    byId.set(ds.id, field);
    const nameKey = norm(name);
    if (!byName.has(nameKey)) byName.set(nameKey, []);
    byName.get(nameKey).push(field);
  }

  return { byId, byName };
}

function resolveRealField(record, fieldIndexes) {
  const source = rawSource(record);
  const parsed = parseFieldSourceValue(source.sourceValue);

  const idCandidates = [
    source.fieldId,
    parsed.fieldId,
    source.sourceScope === 'field' || parsed.isField || source.sourceType === 'field'
      ? source.sourceId
      : ''
  ].map(clean).filter(Boolean);

  for (const id of idCandidates) {
    const field = fieldIndexes.byId.get(id);
    if (field) return field;
  }

  const nameCandidates = [
    source.fieldName,
    source.sourceScope === 'field' || parsed.isField || source.sourceType === 'field'
      ? source.sourceName
      : ''
  ].map(clean).filter(Boolean);

  for (const name of nameCandidates) {
    const matches = fieldIndexes.byName.get(norm(name)) || [];
    if (matches.length === 1) return matches[0];
  }

  return null;
}

function canonicalSourceForRecord(record, fieldIndexes, fallbackCrop = '') {
  const source = rawSource(record);
  if (!isActiveHarvestSignal(source)) return null;

  const field = resolveRealField(record, fieldIndexes);
  const crop = cropKey(first(record?.crop, fallbackCrop));

  if (field) {
    return {
      kind: 'field',
      field,
      crop,
      value: `active_field_harvest:field:${field.id}:${crop}`
    };
  }

  return {
    kind: 'active',
    field: null,
    crop,
    value: 'active_field_harvest'
  };
}

function canonicalPatch(source) {
  if (!source) return null;

  if (source.kind === 'field') {
    return {
      grainSourceType: 'active_field_harvest',
      grainSourceScope: 'field',
      grainSourceValue: source.value,
      grainSourceId: source.field.id,
      grainSourceName: source.field.name,
      grainSourceFieldId: source.field.id,
      grainSourceFieldName: source.field.name,
      fieldId: source.field.id,
      fieldName: source.field.name,
      sourceNormalizedAt: serverTimestamp()
    };
  }

  return {
    grainSourceType: 'active_field_harvest',
    grainSourceScope: null,
    grainSourceValue: 'active_field_harvest',
    grainSourceId: null,
    grainSourceName: 'Active Harvest',
    grainSourceFieldId: null,
    grainSourceFieldName: null,
    fieldId: null,
    fieldName: null,
    sourceNormalizedAt: serverTimestamp()
  };
}

function sameCanonicalValues(record, source) {
  if (!source) return true;

  const raw = rawSource(record);

  if (source.kind === 'field') {
    return (
      raw.sourceType === 'active_field_harvest' &&
      raw.sourceScope === 'field' &&
      clean(raw.sourceValue) === source.value &&
      clean(record?.grainSourceFieldId) === source.field.id &&
      clean(record?.grainSourceFieldName) === source.field.name &&
      clean(record?.grainSourceId) === source.field.id &&
      clean(record?.grainSourceName) === source.field.name &&
      clean(record?.fieldId) === source.field.id &&
      clean(record?.fieldName) === source.field.name
    );
  }

  return (
    raw.sourceType === 'active_field_harvest' &&
    !raw.sourceScope &&
    clean(raw.sourceValue) === 'active_field_harvest' &&
    clean(record?.grainSourceName) === 'Active Harvest' &&
    !clean(record?.grainSourceFieldId) &&
    !clean(record?.grainSourceFieldName) &&
    !clean(record?.fieldId) &&
    !clean(record?.fieldName)
  );
}

function buildLoadIndexes(loadDocs) {
  const byId = new Map();
  const byTicketId = new Map();
  const byLoadNumber = new Map();

  for (const ds of loadDocs) {
    const load = { id: ds.id, ...(ds.data() || {}) };
    byId.set(ds.id, load);

    const ticketId = first(load.grainTicketId, load.ticketId);
    if (ticketId) byTicketId.set(ticketId, load);

    const number = loadNumberValue(load);
    if (number) {
      const key = norm(number);
      if (!byLoadNumber.has(key)) byLoadNumber.set(key, []);
      byLoadNumber.get(key).push(load);
    }
  }

  return { byId, byTicketId, byLoadNumber };
}

function linkedLoadForTicket(ticket, indexes) {
  const id = ticketLoadId(ticket);
  if (id && indexes.byId.has(id)) return indexes.byId.get(id);

  if (indexes.byTicketId.has(ticket.id)) return indexes.byTicketId.get(ticket.id);

  const number = ticketLoadNumber(ticket);
  if (number) {
    const matches = indexes.byLoadNumber.get(norm(number)) || [];
    if (matches.length === 1) return matches[0];
  }

  return null;
}

function chooseTicketSource(ticket, load, fieldIndexes) {
  const ticketSource = canonicalSourceForRecord(ticket, fieldIndexes, load?.crop || '');
  const loadSource = load
    ? canonicalSourceForRecord(load, fieldIndexes, ticket?.crop || '')
    : null;

  /*
    A real field selected on Ticket Details / Manual / OCR is authoritative.
    Otherwise a linked load's real field fills older SMS tickets that were
    created without canonical field fields on grain_tickets.
  */
  if (ticketSource?.kind === 'field') return ticketSource;
  if (loadSource?.kind === 'field') return loadSource;
  if (ticketSource) return ticketSource;
  if (loadSource) return loadSource;
  return null;
}

async function normalizeGrainSources() {
  try {
    await ready;
    const db = getFirestore();

    const [ticketSnap, loadSnap, fieldSnap] = await Promise.all([
      getDocs(collection(db, 'grain_tickets')),
      getDocs(collection(db, 'grain_loadouts')),
      getDocs(collection(db, 'fields'))
    ]);

    const fieldIndexes = buildFieldIndexes(fieldSnap.docs);
    const loadIndexes = buildLoadIndexes(loadSnap.docs);
    const updates = [];
    let ticketUpdates = 0;
    let loadUpdates = 0;

    /* First canonicalize every harvest loadout itself. */
    for (const ds of loadSnap.docs) {
      const load = { id: ds.id, ...(ds.data() || {}) };
      const source = canonicalSourceForRecord(load, fieldIndexes);
      if (!source || sameCanonicalValues(load, source)) continue;

      updates.push(
        updateDoc(doc(db, 'grain_loadouts', ds.id), {
          ...canonicalPatch(source),
          sourceNormalizedBy: 'grain-source-canonical-v2'
        })
      );
      loadUpdates += 1;
    }

    /* Then canonicalize every ticket, using its linked load when needed. */
    for (const ds of ticketSnap.docs) {
      const ticket = { id: ds.id, ...(ds.data() || {}) };
      if (ticket.voided === true) continue;

      const load = linkedLoadForTicket(ticket, loadIndexes);
      const source = chooseTicketSource(ticket, load, fieldIndexes);
      if (!source || sameCanonicalValues(ticket, source)) continue;

      const patch = {
        ...canonicalPatch(source),
        sourceNormalizedBy: 'grain-source-canonical-v2'
      };

      if (load) {
        if (!ticketLoadId(ticket)) patch.loadoutId = load.id;
        const number = loadNumberValue(load);
        if (number && !ticketLoadNumber(ticket)) patch.loadNumber = number;
      }

      updates.push(updateDoc(doc(db, 'grain_tickets', ds.id), patch));
      ticketUpdates += 1;
    }

    if (updates.length) await Promise.all(updates);

    document.dispatchEvent(
      new CustomEvent('fv:grain-inventory-posted', {
        detail: {
          reason: 'grain-source-canonical-v2',
          updatedTickets: ticketUpdates,
          updatedLoadouts: loadUpdates
        }
      })
    );

    return { ticketUpdates, loadUpdates };
  } catch (error) {
    console.warn('[FarmVista] Grain source canonicalization failed:', error);
    return { ticketUpdates: 0, loadUpdates: 0 };
  }
}

normalizeGrainSources();
