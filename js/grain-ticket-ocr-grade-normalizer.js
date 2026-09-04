/* FarmVista grain ticket OCR grade normalizer
   Rev 2026-09-04

   Re-associates explicit grade labels with the numeric value OCR already read.
   This is deliberately conservative: FarmVista never invents an unlabeled
   grade value and flags conflicting explicit evidence for review.
*/

const clean = value => String(value ?? '').replace(/\r/g, '').trim();

function numeric(value) {
  if (value === null || value === undefined || value === '') return null;
  let raw = value;
  if (typeof value === 'object') {
    raw = value.value ?? value.normalizedValue ?? value.text ?? value.rawValue ?? null;
  }
  const match = clean(raw).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

const SPECS = {
  testWeight: { labels: ['TW', 'TEST WT', 'TEST WEIGHT'], min: 20, max: 80 },
  moisture: { labels: ['MO', 'MOIST', 'MOISTURE'], min: 0, max: 40 },
  damage: { labels: ['DM', 'DAM', 'DAMAGE', 'DAMAGED'], min: 0, max: 100 },
  foreignMaterial: { labels: ['FM', 'F.M.', 'FOREIGN MATERIAL'], min: 0, max: 100 },
  splits: { labels: ['SP', 'SPLITS'], min: 0, max: 100 }
};

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function inRange(field, value) {
  const spec = SPECS[field];
  return Number.isFinite(value) && value >= spec.min && value <= spec.max;
}

function rawCandidates(rawText, field) {
  const text = clean(rawText);
  if (!text) return [];
  const spec = SPECS[field];
  const out = [];

  for (const label of spec.labels) {
    const escaped = escapeRegex(label).replace(/\\ /g, '\\s+');
    const regex = new RegExp(
      `(?:^|\\n|\\s)${escaped}\\s*[:#-]?\\s*([0-9]{1,2}(?:\\.[0-9]{1,2})?)`,
      'gim'
    );
    let match;
    while ((match = regex.exec(text))) {
      const value = Number(match[1]);
      if (inRange(field, value)) {
        out.push({ value, label, evidence: match[0].trim(), index: match.index });
      }
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

function structuredValue(result, field) {
  const fromFields = numeric(result?.fields?.[field]);
  if (inRange(field, fromFields)) return fromFields;
  const fromTicket = numeric(result?.grainTicket?.[field]);
  if (inRange(field, fromTicket)) return fromTicket;
  return null;
}

function chooseField(result, rawText, field) {
  const raw = rawCandidates(rawText, field);
  const structured = structuredValue(result, field);

  if (raw.length) {
    const unique = [...new Set(raw.map(item => item.value))];
    if (unique.length === 1) {
      const value = unique[0];
      return {
        value,
        confidence: structured === value ? 'verified' : 'high',
        source: 'raw_label_value',
        evidence: raw[0].evidence,
        structuredValue: structured
      };
    }
    return {
      value: structured,
      confidence: 'review',
      source: 'conflicting_raw_labels',
      evidence: raw.map(item => item.evidence).join(' | '),
      structuredValue: structured
    };
  }

  return {
    value: structured,
    confidence: structured === null ? 'missing' : 'structured',
    source: structured === null ? 'missing' : 'structured_ocr',
    evidence: null,
    structuredValue: structured
  };
}

function elevatorFamily(result, rawText) {
  const haystack = `${result?.grainTicket?.parserProfile || ''} ${result?.grainTicket?.elevatorName || ''} ${rawText}`.toLowerCase();
  if (/archer\s+daniels|\badm\b/.test(haystack)) return 'ADM';
  if (/\bchs\b|lowder|waverly/.test(haystack)) return 'CHS';
  if (/bartlett/.test(haystack)) return 'Bartlett';
  if (/cahokia/.test(haystack)) return 'Cahokia';
  return 'Generic';
}

export function normalizeGrainTicketGrades(result) {
  if (!result?.grainTicket) return result;

  const rawText = clean(result?.grainTicket?.rawText || result?.document?.text || '');
  const family = elevatorFamily(result, rawText);
  const fields = ['testWeight', 'moisture', 'damage', 'foreignMaterial', 'splits'];
  const audit = {};
  const review = [];

  if (!result.fields || typeof result.fields !== 'object') result.fields = {};

  for (const field of fields) {
    const chosen = chooseField(result, rawText, field);
    audit[field] = chosen;

    if (chosen.value !== null && chosen.value !== undefined) {
      result.grainTicket[field] = chosen.value;

      /*
        The scan page has an older direct-field compatibility pass after this
        normalizer. When raw label/value evidence is unambiguous, update that
        structured field too so stale parser data cannot overwrite the verified
        value later in the same save path.
      */
      if (chosen.source === 'raw_label_value') {
        result.fields[field] = chosen.value;
      }
    }

    if (chosen.confidence === 'review') {
      review.push(`Conflicting OCR readings for ${field}.`);
    }
  }

  result.grainTicket.gradeParser = {
    version: 'farmvista-grade-v1',
    elevatorFamily: family,
    fields: audit
  };
  result.gradeNormalization = result.grainTicket.gradeParser;

  if (review.length) {
    result.reviewWarnings = [
      ...(Array.isArray(result.reviewWarnings) ? result.reviewWarnings : []),
      ...review
    ];
  }

  return result;
}
