/* FarmVista grain ticket OCR grade normalizer
   Rev 2026-09-09d — Scoular-Waverly authoritative grade template

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
  const lines = text
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean);
  const out = [];

  const numericOnly = line => {
    const match = clean(line)
      .replace(/,/g, '')
      .match(/^([0-9]{1,2}(?:\.[0-9]{1,2})?)$/);
    if (!match) return null;
    const value = Number(match[1]);
    return inRange(field, value) ? value : null;
  };

  for (const label of spec.labels) {
    const escaped = escapeRegex(label).replace(/\\ /g, '\\s+');
    const sameLineForward = new RegExp(
      `^${escaped}[ \\t]*[:#-]?[ \\t]*([0-9]{1,2}(?:\\.[0-9]{1,2})?)[ \\t]*$`,
      'i'
    );
    const sameLineReverse = new RegExp(
      `^([0-9]{1,2}(?:\\.[0-9]{1,2})?)[ \\t]+${escaped}[ \\t]*[:#-]?[ \\t]*$`,
      'i'
    );
    const labelOnly = new RegExp(
      `^${escaped}[ \\t]*[:#-]?[ \\t]*$`,
      'i'
    );

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      let match = line.match(sameLineForward);
      if (match) {
        const value = Number(match[1]);
        if (inRange(field, value)) {
          out.push({ value, label, evidence: line, index: i, direction: 'label_then_value_same_line' });
        }
        continue;
      }

      match = line.match(sameLineReverse);
      if (match) {
        const value = Number(match[1]);
        if (inRange(field, value)) {
          out.push({ value, label, evidence: line, index: i, direction: 'value_then_label_same_line' });
        }
        continue;
      }

      if (!labelOnly.test(line)) continue;

      /*
        Google OCR often returns narrow receipt columns as:

          12.60
          MOISTURE
          59.60
          TEST WEIGHT

        Prefer the number immediately BEFORE an explicit label. Only use the
        next numeric line when no valid previous numeric line exists. Never let
        whitespace matching cross a newline; that old behavior allowed FOREIGN
        MATERIAL to steal the following DAMAGE value.
      */
      const previousValue = i > 0 ? numericOnly(lines[i - 1]) : null;
      if (previousValue !== null) {
        out.push({
          value: previousValue,
          label,
          evidence: `${lines[i - 1]} | ${line}`,
          index: i,
          direction: 'value_previous_line'
        });
        continue;
      }

      const nextValue = i + 1 < lines.length ? numericOnly(lines[i + 1]) : null;
      if (nextValue !== null) {
        out.push({
          value: nextValue,
          label,
          evidence: `${line} | ${lines[i + 1]}`,
          index: i,
          direction: 'value_next_line'
        });
      }
    }
  }

  const seen = new Set();
  return out
    .filter(item => {
      const key = `${item.label}|${item.value}|${item.index}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.index - b.index);
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

  /*
    Cahokia Grain tickets can contain "CHS Elevators Sycamore, IL" in the
    weigher/footer area. The ticket header is stronger evidence than that footer,
    so classify Cahokia before the generic CHS family test.
  */
  if (/\bcahokia\s+grain\b|\bcahokia,?\s+il\b/.test(haystack)) return 'Cahokia';

  if (/\bchs\b|lowder/.test(haystack)) return 'CHS';
  if (/bartlett/.test(haystack)) return 'Bartlett';
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

  const isWaverlyTemplate =
    /scoular\s*[-–]?\s*waverly/i.test(text) ||
    /elevator\s*id\s*:?\s*wave\b/i.test(text) ||
    /15379\s+jasmine\s+road/i.test(text);

  if (!isWaverlyTemplate) return null;

  /*
    SCOULAR-WAVERLY TEMPLATE

    Known printed grade order:
      Test Weight
      Moisture / OCR may read "Voisture"
      Damaged Kernels (total)
      Broken Corn & Foreign Mat

    Google OCR can return these as normal rows, number-before-label rows,
    labels first with values later, or with a faint decimal split as "15 2".
    Keep this tolerance limited to Scoular-Waverly so generic ticket parsing
    remains conservative.

    Regression ticket 448225 (09/09/2026):
      TW 61.5, MO 15.2, DM 1.8, FM 1.0
  */
  const upper = text.toUpperCase();
  let start = upper.indexOf('GRADE:');
  if (start < 0) start = upper.indexOf('GRADE ');
  if (start < 0) start = upper.indexOf('TEST WEIGHT');
  if (start < 0) return null;

  let end = upper.indexOf('NET LBS', start);
  if (end < 0) end = upper.indexOf('NET L.BS', start);
  if (end < 0) end = upper.indexOf('GROSS BUSHELS', start);
  if (end < 0) end = upper.indexOf('NET BUSHELS', start);
  if (end < 0) end = Math.min(text.length, start + 1800);

  const section = text.slice(start, end);
  const lines = section
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean);

  const labelPatterns = {
    testWeight: /\bTEST\s*(?:WEIGHT|WT)\b/i,
    moisture: /\b(?:MOISTURE|VOISTURE|MOIST\s*URE)\b/i,
    damage: /\b(?:DAMAGED?\s+KERNELS?(?:\s*\(TOTAL\))?|DAMAGE)\b/i,
    foreignMaterial: /\b(?:BROKEN\s+CORN\s*(?:&|AND)\s*FOREIGN\s+MAT(?:ERIAL)?|FOREIGN\s+MATERIAL)\b/i
  };

  if (!Object.values(labelPatterns).every(pattern => pattern.test(section))) {
    return null;
  }

  function flexibleNumber(valueText, field) {
    const value = clean(valueText);
    if (!value) return null;

    let match = value.match(/(?:^|[^0-9])(\d{1,2})\s*[.,]\s*(\d{1,2})(?!\d)/);
    if (match) {
      const n = Number(`${match[1]}.${match[2]}`);
      return inRange(field, n) ? n : null;
    }

    /* A faint decimal is sometimes OCR'd as a space: 15.2 -> "15 2". */
    match = value.match(/(?:^|[^0-9])(\d{1,2})\s+(\d)(?!\d)/);
    if (match) {
      const n = Number(`${match[1]}.${match[2]}`);
      return inRange(field, n) ? n : null;
    }

    return null;
  }

  function sameRowValue(field) {
    const pattern = labelPatterns[field];
    for (const line of lines) {
      if (!pattern.test(line)) continue;
      const withoutLabel = line.replace(pattern, ' ');
      const value = flexibleNumber(withoutLabel, field);
      if (value !== null) return value;
    }
    return null;
  }

  const rowValues = {
    testWeight: sameRowValue('testWeight'),
    moisture: sameRowValue('moisture'),
    damage: sameRowValue('damage'),
    foreignMaterial: sameRowValue('foreignMaterial')
  };

  /*
    Split-column fallback. Gather only decimal-like grade readings; whole-pound
    weights and clock times are intentionally ignored. The first four readings
    in this known Scoular-Waverly block are TW, MO, DM, FM.
  */
  const sequence = [];
  for (const line of lines) {
    if (/\b(?:NET|TARE)\s+L\.?BS\b/i.test(line)) break;
    if (/\b\d{1,2}:\d{2}(?::\d{2})?\b/.test(line)) {
      /* A line may contain a clock time next to a grade; remove time first. */
      const stripped = line.replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, ' ');
      const n = flexibleNumber(stripped, sequence.length === 0 ? 'testWeight' : 'foreignMaterial');
      if (n !== null) sequence.push(n);
      continue;
    }

    let match;
    const decimalRegex = /(?:^|[^0-9])(\d{1,2})\s*[.,]\s*(\d{1,2})(?!\d)/g;
    while ((match = decimalRegex.exec(line))) {
      sequence.push(Number(`${match[1]}.${match[2]}`));
    }

    if (!match && /^\s*\d{1,2}\s+\d\s*$/.test(line)) {
      const split = line.trim().match(/^(\d{1,2})\s+(\d)$/);
      if (split) sequence.push(Number(`${split[1]}.${split[2]}`));
    }
  }

  const positional = sequence.length >= 4
    ? {
        testWeight: sequence[0],
        moisture: sequence[1],
        damage: sequence[2],
        foreignMaterial: sequence[3]
      }
    : {};

  const values = {
    testWeight: rowValues.testWeight ?? positional.testWeight ?? null,
    moisture: rowValues.moisture ?? positional.moisture ?? null,
    damage: rowValues.damage ?? positional.damage ?? null,
    foreignMaterial: rowValues.foreignMaterial ?? positional.foreignMaterial ?? null
  };

  if (
    !inRange('testWeight', values.testWeight) ||
    !inRange('moisture', values.moisture) ||
    !inRange('damage', values.damage) ||
    !inRange('foreignMaterial', values.foreignMaterial)
  ) {
    return null;
  }

  return {
    ...values,
    evidence: section,
    source: 'scoular_waverly_template_v3'
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
        chosen.source === 'scoular_waverly_template_v3'
      ) {
        result.fields[field] = chosen.value;
      }
    }

    if (chosen.confidence === 'review') {
      review.push(`Conflicting OCR readings for ${field}.`);
    }
  }

  result.grainTicket.gradeParser = {
    version: 'farmvista-grade-v6',
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
