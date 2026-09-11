from pathlib import Path

path = Path("pages/grain/grain-ticket.html")
text = path.read_text(encoding="utf-8")

# Undo the overly broad rule that made every generic hauling_job_not_assigned
# review reason red. A ticket can simply be unassigned while valid matching
# jobs still exist, which should not be treated as the destination/Sold Under
# mismatch warning.
text = text.replace(
    '      "customer_mismatch",\n      "hauling_job_not_assigned"\n    ]);',
    '      "customer_mismatch"\n    ]);',
    1,
)

marker = '''    const warningReasons = new Set([
      "buyer_not_matched",
      "delivery_location_not_matched",
      "delivery_location_conflict",
      "destination_not_matched",
      "destination_conflict",
      "customer_not_matched",
      "customer_not_selected",
      "sold_under_unknown",
      "sold_under_requires_review",
      "elevator_mismatch",
      "buyer_mismatch",
      "customer_mismatch"
    ]);

'''

insert = marker + '''    /*
      RED WARNING RULE — NO OPEN MATCHING HAULING JOB

      Do not make a ticket red merely because it is unassigned.
      Make it red when the assignment engine definitively found ZERO
      hauling jobs matching this ticket's operational combination.

      For scanned elevator tickets customerName/customerId is the Sold Under
      party. buyer/delivery location is the destination. matchingHaulingJobIds
      is populated by the hauling-job matcher after checking destination,
      crop, Sold Under and active/open job eligibility.
    */
    const soldUnderKnown = !!String(
      ticket?.customerId || ticket?.customerName || ""
    ).trim();

    const destinationKnown = !!String(
      ticket?.deliveryLocationId || ticket?.buyerId ||
      ticket?.deliveryLocationName || ticket?.buyerName || ""
    ).trim();

    const cropKnown = !!String(ticket?.crop || "").trim();

    const matchingJobIds = Array.isArray(ticket?.matchingHaulingJobIds)
      ? ticket.matchingHaulingJobIds.filter(value => String(value || "").trim())
      : null;

    const noOpenMatchingHaulingJob =
      ticket?.haulingJobMatched === false &&
      matchingJobIds !== null &&
      matchingJobIds.length === 0 &&
      soldUnderKnown &&
      destinationKnown &&
      cropKnown;

    if (noOpenMatchingHaulingJob) return true;

'''

if "const noOpenMatchingHaulingJob" not in text:
    if marker not in text:
        raise SystemExit("Expected warningReasons block not found; refusing unsafe patch")
    text = text.replace(marker, insert, 1)

path.write_text(text, encoding="utf-8")
print("Warning now requires zero matching hauling jobs for Sold Under + destination + crop")
