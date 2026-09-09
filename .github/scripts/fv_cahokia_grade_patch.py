from pathlib import Path

p = Path('js/grain-ticket-ocr-grade-normalizer.js')
s = p.read_text()

s = s.replace(
    'Rev 2026-09-09b — Scoular split-column grade recovery',
    'Rev 2026-09-09c — labeled-row and reversed-row grade recovery',
    1
)

start = s.index('function rawCandidates(rawText, field) {')
end = s.index('\nfunction structuredValue(result, field) {', start)
new_func = r'''function rawCandidates(rawText, field) {
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
'''
s = s[:start] + new_func + s[end:]

old_family = """  if (/\\bscoular\\b/.test(haystack)) return 'Scoular';
  if (/archer\\s+daniels|\\badm\\b/.test(haystack)) return 'ADM';
  if (/\\bchs\\b|lowder/.test(haystack)) return 'CHS';
  if (/bartlett/.test(haystack)) return 'Bartlett';
  if (/cahokia/.test(haystack)) return 'Cahokia';"""
new_family = """  if (/\\bscoular\\b/.test(haystack)) return 'Scoular';
  if (/archer\\s+daniels|\\badm\\b/.test(haystack)) return 'ADM';

  /*
    Cahokia Grain tickets can contain \"CHS Elevators Sycamore, IL\" in the
    weigher/footer area. The ticket header is stronger evidence than that footer,
    so classify Cahokia before the generic CHS family test.
  */
  if (/\\bcahokia\\s+grain\\b|\\bcahokia,?\\s+il\\b/.test(haystack)) return 'Cahokia';

  if (/\\bchs\\b|lowder/.test(haystack)) return 'CHS';
  if (/bartlett/.test(haystack)) return 'Bartlett';"""
if old_family not in s:
    raise SystemExit('elevator family marker missing')
s = s.replace(old_family, new_family, 1)
s = s.replace("version: 'farmvista-grade-v4'", "version: 'farmvista-grade-v5'", 1)
p.write_text(s)

core = Path('pages/grain/grain-ticket-scan-core.html')
c = core.read_text()
old_import = '/js/grain-ticket-ocr-grade-normalizer.js?v=20260904-1'
if old_import not in c:
    raise SystemExit('scan core normalizer import marker missing')
c = c.replace(old_import, '/js/grain-ticket-ocr-grade-normalizer.js?v=20260909-4', 1)
core.write_text(c)

scan = Path('pages/grain/grain-ticket-scan.html')
h = scan.read_text()
old_core = "const CORE_URL = '/pages/grain/grain-ticket-scan-core.html?v=20260909-2';"
if old_core not in h:
    raise SystemExit('scanner core cache marker missing')
h = h.replace(old_core, "const CORE_URL = '/pages/grain/grain-ticket-scan-core.html?v=20260909-3';", 1)
old_patch = "'/js/grain-ticket-ocr-grade-normalizer.js?v=20260904-1',\n        '/js/grain-ticket-ocr-grade-normalizer.js?v=20260909-3',"
if old_patch not in h:
    raise SystemExit('scanner normalizer patch marker missing')
h = h.replace(
    old_patch,
    "'/js/grain-ticket-ocr-grade-normalizer.js?v=20260909-4',\n        '/js/grain-ticket-ocr-grade-normalizer.js?v=20260909-4',",
    1
)
scan.write_text(h)

version = Path('js/version.js')
v = version.read_text()
if 'number:  "09.09.04"' not in v:
    raise SystemExit('expected version 09.09.04 not found')
v = v.replace('number:  "09.09.04"', 'number:  "09.09.05"', 1)
v = v.replace('date:    "2026-09-08"', 'date:    "2026-09-09"', 1)
version.write_text(v)
