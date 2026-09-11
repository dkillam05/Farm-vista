from pathlib import Path

path = Path("pages/grain/grain-ticket.html")
text = path.read_text(encoding="utf-8")

old = '    return reasons.some(reason => warningReasons.has(reason));'
new = '''    return reasons.some(reason => {

      if (warningReasons.has(reason)) return true;

      /*
        A clean/readable ticket that cannot be matched to an ACTIVE hauling
        job is an operational mismatch, not an OCR/data-entry review item.
        Keep these red so dispatch immediately sees that the destination /
        crop / Sold Under combination has no current hauling job available.
      */
      const haulingJobMismatch =
        (reason.includes("hauling") || reason.includes("job")) &&
        (
          reason.includes("not_matched") ||
          reason.includes("not_found") ||
          reason.includes("no_match") ||
          reason.includes("missing") ||
          reason.includes("inactive") ||
          reason.includes("no_active") ||
          reason.includes("requires_review")
        );

      return haulingJobMismatch;

    });'''

if "const haulingJobMismatch" in text:
    print("Patch already present.")
    raise SystemExit(0)

if old not in text:
    raise SystemExit("Expected isTicketWarning return statement was not found; refusing unsafe patch.")

path.write_text(text.replace(old, new, 1), encoding="utf-8")
print("Patched pages/grain/grain-ticket.html")
