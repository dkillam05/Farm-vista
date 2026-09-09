/* FarmVista grain ticket OCR grade normalizer
   Rev 2026-09-09 — Scoular layout + customer support

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
  testWeight: {
    labels: ['TW', 'TEST WT', 'TEST WEIGHT'],
    min: 20,
    max: 80
  },
  moisture: {
    labels: ['MO', 'MOIST', 'MOISTURE', 'VOISTURE'],
    min: 0,
    max: 40
  },
  damage: {
    labels: ['DM', 'DAM', 'DAMAGE', 'DAMAGED', 'DAMAGED KERNELS', 'DAMAGED KERNELS (TOTAL)'],
    min: 0,
    max: 100
  },
  foreignMaterial: {
    labels: ['FM', 'F.M.', 'FOREIGN MATERIAL', 'BROKEN CORN & FOREIGN MAT', 'BROKEN CORN AND FOREIGN MAT'],
    min: 0,
    max: 100
  },
  splits: {
    labels: ['SP', 'SPLITS'],
    min: 0,
    max: 100
  }
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

function elevatorFamily(result, rawText) {
  const haystack = `${result?.grainTicket?.parserProfile || ''} ${result?.grainTicket?.elevatorName || ''} ${rawText}`.toLowerCase();

  /*
    Scoular has a Waverly, Illinois location. Detect Scoular before CHS so the
    word "Waverly" by itself never incorrectly classifies a Scoular ticket as CHS.
  */
  if (/\bscoular\b/.test(haystack)) return 'Scoular';
  if (/archer\s+daniels|\badm\b/.test(haystack)) return 'ADM';
  if (/\bchs\b|lowder/.test(haystack)) return 'CHS';
  if (/bartlett/.test(haystack)) return 'Bartlett';
  if (/cahokia/.test(haystack)) return 'Cahokia';
  return 'Generic';
}

function extractScoularCustomer(rawText) {
  const text = clean(rawText);
  if (!text || !/\bscoular\b/i.test(text)) return null;

  const lines = text
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean);

  let account = null;
  let name = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const accountMatch = line.match(/\bCustomer\s*ID\s*:\s*([A-Z0-9._-]+)/i);
    if (!accountMatch) continue;

    account = accountMatch[1].trim();

    for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
      const candidate = lines[j];
      if (
        /^(?:Inbound\s+Ticket|Scoular-|Elevator\s+ID|Yellow\s+Corn|Corn|Soybeans?|Wheat)\b/i.test(candidate)
      ) {
        break;
      }
      if (/[A-Za-z]/.test(candidate) && !/^Customer\s*ID\b/i.test(candidate)) {
        name = candidate;
        break;
      }
    }

    break;
  }

  return account || name ? { account, name } : null;
}

function scoularGradeBlock(rawText) {
  const text = clean(rawText);
  if (!text || !/\bscoular\b/i.test(text)) return null;

  /*
    Scoular's scale-ticket OCR commonly returns the four grade numbers in their
    visual column order while the labels are read on separate lines. Example:

      59.8
      Field #
      14.5
      Test Weight
      Voisture
      Damaged Kernels (total)
      Broken Corn & Foreign Mat
      1.9
      1.0

    On the printed ticket those values are TW, Moisture, Damage and FM.
    Restrict the recovery to the grade section only, bounded by the grade/hauler
    area and GROSS LBS, so weights, dates, ticket numbers and bushels cannot be
    mistaken for grade values.
  */
  const upper = text.toUpperCase();
  let start = upper.indexOf('GRADE:');
  if (start < 0) start = upper.indexOf('GRADE ');
  if (start < 0) start = upper.indexOf('TEST WEIGHT');
  if (start < 0) return null;

  let end = upper.indexOf('GROSS LBS', start);
  if (end < 0) end = upper.indexOf('GROSS WEIGHT', start);
  if (end < 0) return null;

  const section = text.slice(start, end);

  const hasExpectedLabels =
    /TEST\s+WEIGHT/i.test(section) &&
    /(?:MOISTURE|VOISTURE)/i.test(section) &&
    /DAMAGED\s+KERNELS?/i.test(section) &&
    /BROKEN\s+CORN\s*(?:&|AND)\s*FOREIGN\s+MAT/i.test(section);

  if (!hasExpectedLabels) return null;

  const decimals = [];
  const decimalRegex = /(?:^|\s)(\d{1,2}\.\d{1,2})(?=\s|$)/g;
  let match;
  while ((match = decimalRegex.exec(section))) {
    const value = Number(match[1]);
    if (Number.isFinite(value)) decimals.push(value);
  }

  if (decimals.length < 4) return null;

  const values = decimals.slice(0, 4);
  const [testWeight, moisture, damage, foreignMaterial] = values;

  if (
    !inRange('testWeight', testWeight) ||
    !inRange('moisture', moisture) ||
    !inRange('damage', damage) ||
    !inRange('foreignMaterial', foreignMaterial)
  ) {
    return null;
  }

  return {
    testWeight,
    moisture,
    damage,
    foreignMaterial,
    evidence: section,
    source: 'scoular_grade_column_order'
  };
}

function chooseField(result, rawText, field, family, scoularBlock) {
  const structured = structuredValue(result, field);

  if (
    family === 'Scoular' &&
    scoularBlock &&
    Object.prototype.hasOwnProperty.call(scoularBlock, field)
  ) {
    const value = scoularBlock[field];
    return {
      value,
      confidence: structured === value ? 'verified' : 'high',
      source: scoularBlock.source,
      evidence: scoularBlock.evidence,
      structuredValue: structured
    };
  }

  const raw = rawCandidates(rawText, field);

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

export function normalizeGrainTicketGrades(result) {
  if (!result?.grainTicket) return result;

  const rawText = clean(result?.grainTicket?.rawText || result?.document?.text || '');
  const family = elevatorFamily(result, rawText);
  const scoularBlock = family === 'Scoular' ? scoularGradeBlock(rawText) : null;
  const scoularCustomer = family === 'Scoular' ? extractScoularCustomer(rawText) : null;
  const fields = ['testWeight', 'moisture', 'damage', 'foreignMaterial', 'splits'];
  const audit = {};
  const review = [];

  if (!result.fields || typeof result.fields !== 'object') result.fields = {};

  if (scoularCustomer) {
    if (scoularCustomer.account) {
      result.grainTicket.customerAccountText = scoularCustomer.account;
      result.fields.customerAccountText = scoularCustomer.account;
    }
    if (scoularCustomer.name) {
      result.grainTicket.customerText = scoularCustomer.name;
      result.fields.customerText = scoularCustomer.name;
    }
  }

  for (const field of fields) {
    const chosen = chooseField(result, rawText, field, family, scoularBlock);
    audit[field] = chosen;

    if (chosen.value !== null && chosen.value !== undefined) {
      result.grainTicket[field] = chosen.value;

      if (
        chosen.source === 'raw_label_value' ||
        chosen.source === 'scoular_grade_column_order'
      ) {
        result.fields[field] = chosen.value;
      }
    }

    if (chosen.confidence === 'review') {
      review.push(`Conflicting OCR readings for ${field}.`);
    }
  }

  result.grainTicket.gradeParser = {
    version: 'farmvista-grade-v3',
    elevatorFamily: family,
    fields: audit,
    customer: scoularCustomer
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
