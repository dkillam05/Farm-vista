from pathlib import Path

path = Path("pages/grain/grain-ticket.html")
text = path.read_text(encoding="utf-8")

# Keep generic hauling_job_not_assigned out of the blanket warning list.
text = text.replace(
    '      "customer_mismatch",\n      "hauling_job_not_assigned"\n    ]);',
    '      "customer_mismatch"\n    ]);',
    1,
)

old = '''    const noOpenMatchingHaulingJob =
      ticket?.haulingJobMatched === false &&
      matchingJobIds !== null &&
      matchingJobIds.length === 0 &&
      soldUnderKnown &&
      destinationKnown &&
      cropKnown;
'''

new = '''    const scannerCouldNotAutoAssign =
      reasons.includes("hauling_job_not_auto_assigned") &&
      !ticketHasHaulingJob(ticket);

    const noOpenMatchingHaulingJob =
      soldUnderKnown &&
      destinationKnown &&
      cropKnown &&
      (
        (
          ticket?.haulingJobMatched === false &&
          matchingJobIds !== null &&
          matchingJobIds.length === 0
        ) ||
        scannerCouldNotAutoAssign
      );
'''

if old not in text:
    if new in text:
        print("Scanner fallback already present")
    else:
        raise SystemExit("Expected noOpenMatchingHaulingJob block not found; refusing unsafe patch")
else:
    text = text.replace(old, new, 1)

path.write_text(text, encoding="utf-8")
print("Warning now recognizes scanner no-auto-assignment as no matching open hauling job")
