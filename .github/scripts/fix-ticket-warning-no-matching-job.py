from pathlib import Path

path = Path('pages/grain/grain-ticket.html')
text = path.read_text(encoding='utf-8')
old = '          reason.includes("no_match") ||\n'
new = '          reason.includes("no_match") ||\n          reason.includes("no_matching") ||\n'
if 'reason.includes("no_matching")' in text:
    print('Patch already present')
    raise SystemExit(0)
if old not in text:
    raise SystemExit('Expected warning matcher anchor not found')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
print('Patched grain-ticket.html')
