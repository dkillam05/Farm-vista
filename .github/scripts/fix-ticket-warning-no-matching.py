from pathlib import Path

path = Path("pages/grain/grain-ticket.html")
text = path.read_text(encoding="utf-8")

old = '''          reason.includes("no_match") ||
          reason.includes("missing") ||'''
new = '''          reason.includes("no_match") ||
          reason.includes("no_matching") ||
          reason.includes("missing") ||'''

if 'reason.includes("no_matching")' in text:
    print("Patch already present.")
    raise SystemExit(0)

if old not in text:
    raise SystemExit("Expected hauling-job warning matcher was not found; refusing unsafe patch.")

path.write_text(text.replace(old, new, 1), encoding="utf-8")
print("Patched pages/grain/grain-ticket.html")
