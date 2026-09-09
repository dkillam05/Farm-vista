from pathlib import Path

normalizer = Path('js/grain-ticket-ocr-grade-normalizer.js')
s = normalizer.read_text()
start = s.index('function scoularGradeBlock(rawText) {')
end = s.index('\nfunction chooseField(', start)
new_func = r'''function scoularGradeBlock(rawText) {
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
'''
s = s[:start] + new_func + s[end:]
s = s.replace("chosen.source === 'scoular_grade_column_order_v2'", "chosen.source === 'scoular_waverly_template_v3'", 1)
s = s.replace("version: 'farmvista-grade-v5'", "version: 'farmvista-grade-v6'", 1)
s = s.replace('Rev 2026-09-09c — labeled-row and reversed-row grade recovery', 'Rev 2026-09-09d — Scoular-Waverly authoritative grade template', 1)
normalizer.write_text(s)

core = Path('pages/grain/grain-ticket-scan-core.html')
c = core.read_text()
old = '/js/grain-ticket-ocr-grade-normalizer.js?v=20260909-5'
new = '/js/grain-ticket-ocr-grade-normalizer.js?v=20260909-6'
if old not in c:
    raise SystemExit('scanner core normalizer v5 marker missing')
c = c.replace(old, new, 1)
core.write_text(c)

wrapper = Path('pages/grain/grain-ticket-scan.html')
w = wrapper.read_text()
old_core = '/pages/grain/grain-ticket-scan-core.html?v=20260909-4'
new_core = '/pages/grain/grain-ticket-scan-core.html?v=20260909-5'
if old_core not in w:
    raise SystemExit('scanner wrapper core v4 marker missing')
w = w.replace(old_core, new_core, 1)
w = w.replace(
    "'/js/grain-ticket-ocr-grade-normalizer.js?v=20260909-5',\n        '/js/grain-ticket-ocr-grade-normalizer.js?v=20260909-5'",
    "'/js/grain-ticket-ocr-grade-normalizer.js?v=20260909-6',\n        '/js/grain-ticket-ocr-grade-normalizer.js?v=20260909-6'",
    1
)
wrapper.write_text(w)

version = Path('js/version.js')
v = version.read_text()
if 'number:  "09.09.08"' not in v:
    raise SystemExit('expected app version 09.09.08 not found')
v = v.replace('number:  "09.09.08"', 'number:  "09.09.09"', 1)
version.write_text(v)
