from pathlib import Path

path = Path("pages/grain/grain-ticket.html")
text = path.read_text(encoding="utf-8")

needle = '      "customer_mismatch"\n    ]);'
replacement = '      "customer_mismatch",\n      "hauling_job_not_assigned"\n    ]);'

if '"hauling_job_not_assigned"' in text:
    print("hauling_job_not_assigned already classified as warning")
    raise SystemExit(0)

if needle not in text:
    raise SystemExit("Expected warningReasons block not found; refusing unsafe patch")

path.write_text(text.replace(needle, replacement, 1), encoding="utf-8")
print("Added hauling_job_not_assigned to warningReasons")
