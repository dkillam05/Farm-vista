from pathlib import Path

core = Path('pages/grain/grain-ticket-scan-core.html')
s = core.read_text()
old = '/js/grain-ticket-ocr-grade-normalizer.js?v=20260909-4'
new = '/js/grain-ticket-ocr-grade-normalizer.js?v=20260909-5'
if old not in s:
    raise SystemExit('normalizer import version target missing')
s = s.replace(old, new, 1)
core.write_text(s)

wrapper = Path('pages/grain/grain-ticket-scan.html')
w = wrapper.read_text()
old_core = "/pages/grain/grain-ticket-scan-core.html?v=20260909-3"
new_core = "/pages/grain/grain-ticket-scan-core.html?v=20260909-4"
if old_core not in w:
    raise SystemExit('scanner core version target missing')
w = w.replace(old_core, new_core, 1)
# Keep the wrapper's runtime marker in sync with the core import it expects.
w = w.replace("'/js/grain-ticket-ocr-grade-normalizer.js?v=20260909-4',\n        '/js/grain-ticket-ocr-grade-normalizer.js?v=20260909-4'", "'/js/grain-ticket-ocr-grade-normalizer.js?v=20260909-5',\n        '/js/grain-ticket-ocr-grade-normalizer.js?v=20260909-5'", 1)
wrapper.write_text(w)

version = Path('js/version.js')
v = version.read_text()
if 'number:  "09.09.07"' not in v:
    raise SystemExit('expected version 09.09.07 not found')
v = v.replace('number:  "09.09.07"', 'number:  "09.09.08"', 1)
version.write_text(v)
