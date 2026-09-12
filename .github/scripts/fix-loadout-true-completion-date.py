from pathlib import Path
import re

path = Path('pages/grain/grain-ticket.html')
text = path.read_text(encoding='utf-8')

start = '  function loHaulingJobCompletionISO(job){\n'
end = '  function loHaulingJobIsCompleted(job){\n'

if start not in text or end not in text:
    raise SystemExit('Expected hauling-job completion helpers were not found')

new_function = '''  function loHaulingJobCompletionISO(job){
    if (!job) return "";

    /*
      TRUE COMPLETION DATE PRIORITY

      1) A dedicated completion field wins when FarmVista has already
         stored one.
      2) Otherwise derive the date from the assigned ticket history:
         the calendar date on which cumulative ticket bushels first
         reached/exceeded the hauling-job starting bushels.
      3) Never use hauling-job updatedAt as a completion fallback.

      That last rule is important: editing a completed job later (for
      example correcting 50,000 bu to 5,000 bu) must NOT create a fresh
      two-day overhaul window.
    */
    const explicitCandidates = [
      job.completedDate,
      job.completionDate,
      job.completedAt,
      job.completionAt,
      job.closedDate,
      job.closedAt
    ];

    for (const value of explicitCandidates) {
      if (!value) continue;

      if (typeof value === "string") {
        const isoMatch = value.match(/^(\\d{4}-\\d{2}-\\d{2})/);
        if (isoMatch) return isoMatch[1];
      }

      const millis = loMillis(value);
      if (millis > 0) {
        return loLocalISO(new Date(millis));
      }
    }

    const starting = loHaulingJobStartingBushels(job);
    const jobId = loClean(job.id);

    if (!(starting > 0) || !jobId) {
      return "";
    }

    let accumulated = 0;

    const jobTickets = loState.tickets
      .filter(ticket => {
        const status = loNorm(ticket?.status);
        const voided =
          ticket?.voided === true ||
          status.includes("void");

        const ticketJobId = loClean(
          ticket?.haulingJobId ||
          ticket?.grainHaulingJobId
        );

        return !voided && ticketJobId === jobId;
      })
      .map(ticket => {
        const ticketDate = loClean(ticket.ticketDate);
        const ticketDateMillis =
          loDateFromISO(ticketDate)?.getTime() ||
          0;

        const eventMillis =
          loMillis(
            ticket.ticketLinkedAt ||
            ticket.linkedAt ||
            ticket.createdAt ||
            ticket.updatedAt
          );

        const rawBushels = Number(
          ticket?.netBushels ??
          ticket?.netBu ??
          ticket?.bushels ??
          0
        );

        /*
          The scale-ticket date is the operational date grain was hauled.
          Use it as the primary completion chronology. Timestamps are only
          a same-day/fallback tie-breaker for legacy tickets without a date.
        */
        return {
          ticketDate,
          ticketDateMillis,
          eventMillis,
          sortMillis:ticketDateMillis || eventMillis || 0,
          bushels:Number.isFinite(rawBushels) ? Math.max(0,rawBushels) : 0
        };
      })
      .filter(item => item.bushels > 0)
      .sort((a,b) =>
        a.sortMillis - b.sortMillis ||
        a.eventMillis - b.eventMillis ||
        a.ticketDate.localeCompare(b.ticketDate)
      );

    for (const item of jobTickets) {
      accumulated += item.bushels;

      if (accumulated + 0.005 >= starting) {
        if (item.ticketDate) {
          return item.ticketDate;
        }

        if (item.eventMillis > 0) {
          return loLocalISO(new Date(item.eventMillis));
        }

        return "";
      }
    }

    /*
      No reliable completion date means no overhaul grace period.
      Failing closed here is intentional and safer than treating a later
      edit/update timestamp as if the hauling job just completed.
    */
    return "";
  }

'''

pattern = re.compile(
    r'  function loHaulingJobCompletionISO\(job\)\{\n.*?(?=  function loHaulingJobIsCompleted\(job\)\{\n)',
    re.S,
)

updated, count = pattern.subn(new_function, text, count=1)
if count != 1:
    raise SystemExit(f'Expected to replace 1 completion helper, replaced {count}')

if updated == text:
    print('True completion-date logic already present')
    raise SystemExit(0)

path.write_text(updated, encoding='utf-8')
print('Strengthened hauling-job completion date logic')
