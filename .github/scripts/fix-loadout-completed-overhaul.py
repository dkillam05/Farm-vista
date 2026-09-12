from pathlib import Path

path = Path('pages/grain/grain-ticket.html')
text = path.read_text(encoding='utf-8')

MARKER = 'COMPLETED • Overhaul Allowed'
if MARKER in text and 'loHaulingJobIsOverhaulEligible' in text:
    print('Completed hauling-job overhaul patch already present')
    raise SystemExit(0)


def replace_once(old: str, new: str, label: str) -> None:
    global text
    if old not in text:
        raise SystemExit(f'Expected anchor not found: {label}')
    text = text.replace(old, new, 1)


# 1) Completion/grace helpers.  A job is overhaul-eligible on its
# completion calendar date plus the following two calendar days.
anchor = '''  function loHaulingJobContractedBushels(job){
'''
helpers = '''  function loHaulingJobCompletionISO(job){
    if (!job) return "";

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
        const dateMillis = loDateFromISO(ticketDate)?.getTime() || 0;
        const eventMillis =
          loMillis(
            ticket.ticketLinkedAt ||
            ticket.linkedAt ||
            ticket.createdAt ||
            ticket.updatedAt
          ) || dateMillis;

        const rawBushels = Number(
          ticket?.netBushels ??
          ticket?.netBu ??
          ticket?.bushels ??
          0
        );

        return {
          ticketDate,
          eventMillis,
          bushels:Number.isFinite(rawBushels) ? Math.max(0,rawBushels) : 0
        };
      })
      .filter(item => item.bushels > 0)
      .sort((a,b) =>
        a.eventMillis - b.eventMillis ||
        a.ticketDate.localeCompare(b.ticketDate)
      );

    for (const item of jobTickets) {
      accumulated += item.bushels;

      if (accumulated + 0.005 >= starting) {
        if (item.eventMillis > 0) {
          return loLocalISO(new Date(item.eventMillis));
        }

        return item.ticketDate;
      }
    }

    /*
      Existing completed jobs may pre-date a dedicated completedAt field.
      If Firestore already marks the job complete, updatedAt is the safest
      final fallback for the two-calendar-day dispatch grace period.
    */
    const status = loNorm(job.status || "");
    if (status.includes("complete")) {
      const updatedMillis = loMillis(job.updatedAt);
      if (updatedMillis > 0) {
        return loLocalISO(new Date(updatedMillis));
      }
    }

    return "";
  }

  function loHaulingJobIsCompleted(job){
    if (!job) return false;

    const status = loNorm(job.status || "");

    if (
      status.includes("cancel") ||
      status.includes("void")
    ) {
      return false;
    }

    if (status.includes("complete")) {
      return true;
    }

    const starting = loHaulingJobStartingBushels(job);

    return (
      starting > 0 &&
      loHaulingJobRemainingBushels(job) <= 0.005
    );
  }

  function loHaulingJobIsOverhaulEligible(job){
    if (!loHaulingJobIsCompleted(job)) {
      return false;
    }

    const completionISO = loHaulingJobCompletionISO(job);
    const todayISO = loLocalISO();

    if (!completionISO || !todayISO) {
      return false;
    }

    const completed = loDateFromISO(completionISO);
    const today = loDateFromISO(todayISO);

    if (!completed || !today) {
      return false;
    }

    const completedDay = Date.UTC(
      completed.getFullYear(),
      completed.getMonth(),
      completed.getDate()
    );

    const todayDay = Date.UTC(
      today.getFullYear(),
      today.getMonth(),
      today.getDate()
    );

    const calendarDaysSinceCompletion =
      Math.round((todayDay - completedDay) / 86400000);

    return (
      calendarDaysSinceCompletion >= 0 &&
      calendarDaysSinceCompletion <= 2
    );
  }

  function loHaulingJobContractedBushels(job){
'''
replace_once(anchor, helpers, 'hauling job completion helper insertion')


# 2) A completed job manually chosen from Load Out is a valid selection
# during the grace period.  Its saved Sold Under is valid even when the
# linked contract itself has already closed.
old = '''  if (
    !destination ||
    !customer ||
    !crop ||
    !loHaulingJobIsActive(
      job
    )
  ) {

    return false;

  }
'''
new = '''  const overhaulAllowed =
    loHaulingJobIsOverhaulEligible(
      job
    );

  if (
    !destination ||
    !customer ||
    !crop ||
    (
      !loHaulingJobIsActive(
        job
      ) &&
      !overhaulAllowed
    )
  ) {

    return false;

  }
'''
replace_once(old, new, 'hauling job active validation')

old = '''  /*
    A real Sold Under customer is valid only if
    there is at least one OPEN contract for that
    customer linked to this hauling job.

    This does NOT select that contract.
  */
  const linkedCustomer =
'''
new = '''  /*
    A dispatcher can deliberately select a just-completed hauling job
    for two calendar days.  In that case its saved Sold Under remains
    valid even though the underlying contract/job is already complete.
  */
  if (
    overhaulAllowed &&
    loClean(customer.id) ===
      loHaulingJobCustomerId(job)
  ) {
    return true;
  }


  /*
    A real Sold Under customer is valid only if
    there is at least one OPEN contract for that
    customer linked to this hauling job.

    This does NOT select that contract.
  */
  const linkedCustomer =
'''
replace_once(old, new, 'completed job sold-under validation')


# 3) When a completed job is selected, keep its saved Sold Under available
# even if all contracts tied to the job have closed.
anchor = '''

  const linkedCustomers =
    Array.from(
      customerMap.values()
    )
'''
insert = '''

  if (
    loHaulingJobIsOverhaulEligible(
      haulingJob
    )
  ) {

    const jobCustomerId =
      loHaulingJobCustomerId(
        haulingJob
      );

    const masterCustomer =
      loState.customers.find(
        customer =>
          customer.id ===
          jobCustomerId
      ) ||
      null;

    const jobCustomerName =
      loClean(
        masterCustomer?.name ||
        haulingJob.customerName
      );

    if (
      jobCustomerId &&
      jobCustomerName
    ) {
      customerMap.set(
        jobCustomerId,
        {
          id:jobCustomerId,
          name:jobCustomerName
        }
      );
    }
  }


  const linkedCustomers =
    Array.from(
      customerMap.values()
    )
'''
replace_once(anchor, insert, 'completed job customer picker fallback')


# 4) Exact completed/overhaul display label requested for the dropdown.
anchor = '''  function loHaulingJobNote(job){
'''
label_helper = '''  function loHaulingJobOverhaulLabel(job){
    const destination =
      loClean(
        job.deliveryLocationName ||
        job.locationName ||
        job.destinationName
      ) ||
      loClean(job.buyerName) ||
      "Hauling Job";

    const buyer = loClean(job.buyerName);
    const place =
      buyer && !loNorm(destination).startsWith(loNorm(buyer))
        ? `${buyer} ${destination}`
        : destination;

    const crop =
      loClean(
        job.crop ||
        job.commodity
      ) ||
      "Crop";

    const customerId =
      loHaulingJobCustomerId(job);

    const masterCustomer =
      loState.customers.find(
        customer =>
          customer.id ===
          customerId
      ) ||
      null;

    const customerName =
      loClean(
        masterCustomer?.name ||
        job.customerName
      ) ||
      "Unknown";

    return `${place} — ${crop} — ${customerName} • COMPLETED • Overhaul Allowed`;
  }

  function loHaulingJobNote(job){
'''
replace_once(anchor, label_helper, 'overhaul dropdown label helper')


# 5) Active jobs stay first.  Completed grace-period jobs are red and
# immediately above Add New Hauling Job.
old = '''  function loRenderHaulingJobs(preferredJobId=""){
    if (!loEls.haulingJob || !loEls.haulingJobNote) return;

    const wanted = loClean(preferredJobId || loEls.haulingJob.value);
    loEls.haulingJob.innerHTML = "";
    loEls.haulingJob.disabled = false;
    loEls.haulingJobNote.className = "loadout-contract-note";
    loEls.haulingJobNote.textContent = "";

    const activeJobs = loState.haulingJobs
      .filter(loHaulingJobIsActive)
      .sort((a,b) => {
        const aStart = loClean(a.deliveryStartDate || a.startDate);
        const bStart = loClean(b.deliveryStartDate || b.startDate);
        return aStart.localeCompare(bStart) || loHaulingJobLabel(a).localeCompare(
          loHaulingJobLabel(b), undefined, {numeric:true,sensitivity:"base"}
        );
      });

    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = activeJobs.length ? "Select hauling job" : "No active hauling jobs yet";
    loEls.haulingJob.appendChild(blank);

    activeJobs.forEach(job => {
      const option = document.createElement("option");
      option.value = job.id;
      option.textContent = `${loHaulingJobLabel(job)} • ${loHaulingJobNote(job)}`;
      loEls.haulingJob.appendChild(option);
    });

    const addNew = document.createElement("option");
    addNew.value = "__add_new__";
    addNew.textContent = "+ Add New Hauling Job";
    loEls.haulingJob.appendChild(addNew);

    if (wanted && activeJobs.some(job => job.id === wanted)) {
      loEls.haulingJob.value = wanted;
      const selected = loSelectedHaulingJob();
      loEls.haulingJobNote.className = "loadout-contract-note good";
      loEls.haulingJobNote.textContent = loHaulingJobNote(selected);
    }
  }
'''
new = '''  function loRenderHaulingJobs(preferredJobId=""){
    if (!loEls.haulingJob || !loEls.haulingJobNote) return;

    const wanted = loClean(preferredJobId || loEls.haulingJob.value);
    loEls.haulingJob.innerHTML = "";
    loEls.haulingJob.disabled = false;
    loEls.haulingJob.style.color = "";
    loEls.haulingJob.style.fontWeight = "";
    loEls.haulingJobNote.className = "loadout-contract-note";
    loEls.haulingJobNote.textContent = "";

    const activeJobs = loState.haulingJobs
      .filter(loHaulingJobIsActive)
      .sort((a,b) => {
        const aStart = loClean(a.deliveryStartDate || a.startDate);
        const bStart = loClean(b.deliveryStartDate || b.startDate);
        return aStart.localeCompare(bStart) || loHaulingJobLabel(a).localeCompare(
          loHaulingJobLabel(b), undefined, {numeric:true,sensitivity:"base"}
        );
      });

    const overhaulJobs = loState.haulingJobs
      .filter(job =>
        !loHaulingJobIsActive(job) &&
        loHaulingJobIsOverhaulEligible(job)
      )
      .sort((a,b) =>
        loHaulingJobCompletionISO(b).localeCompare(
          loHaulingJobCompletionISO(a)
        ) ||
        loHaulingJobOverhaulLabel(a).localeCompare(
          loHaulingJobOverhaulLabel(b),
          undefined,
          {numeric:true,sensitivity:"base"}
        )
      );

    const selectableJobs = [
      ...activeJobs,
      ...overhaulJobs
    ];

    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = selectableJobs.length ? "Select hauling job" : "No active hauling jobs yet";
    loEls.haulingJob.appendChild(blank);

    activeJobs.forEach(job => {
      const option = document.createElement("option");
      option.value = job.id;
      option.textContent = `${loHaulingJobLabel(job)} • ${loHaulingJobNote(job)}`;
      loEls.haulingJob.appendChild(option);
    });

    overhaulJobs.forEach(job => {
      const option = document.createElement("option");
      option.value = job.id;
      option.textContent = loHaulingJobOverhaulLabel(job);
      option.dataset.overhaul = "true";
      option.style.color = "#C9444D";
      option.style.fontWeight = "900";
      loEls.haulingJob.appendChild(option);
    });

    const addNew = document.createElement("option");
    addNew.value = "__add_new__";
    addNew.textContent = "+ Add New Hauling Job";
    loEls.haulingJob.appendChild(addNew);

    if (wanted && selectableJobs.some(job => job.id === wanted)) {
      loEls.haulingJob.value = wanted;
      const selected = loSelectedHaulingJob();
      const overhaulSelected =
        selected &&
        !loHaulingJobIsActive(selected) &&
        loHaulingJobIsOverhaulEligible(selected);

      loEls.haulingJob.style.color =
        overhaulSelected
          ? "#C9444D"
          : "";

      loEls.haulingJob.style.fontWeight =
        overhaulSelected
          ? "900"
          : "";

      loEls.haulingJobNote.className =
        overhaulSelected
          ? "loadout-contract-note warn"
          : "loadout-contract-note good";

      loEls.haulingJobNote.textContent =
        overhaulSelected
          ? "COMPLETED • Overhaul Allowed"
          : loHaulingJobNote(selected);
    }
  }
'''
replace_once(old, new, 'hauling job dropdown renderer')


# 6) Selecting a completed job preselects its saved Sold Under and keeps
# the select itself red while dispatch is intentionally overhauling it.
old = '''  /*
    Sold Under does NOT come from the hauling job.

    It is built dynamically from contracts linked
    to this hauling job.

    Start a new selection at Unknown.
  */
  loEls.customer.value =
    "__unknown__";
'''
new = '''  /*
    Normal active jobs build Sold Under dynamically from linked contracts.

    A completed job selected during the two-calendar-day overhaul grace
    period keeps the Sold Under saved on that hauling job so the explicit
    Load Out assignment remains the source of truth for the later scan.
  */
  const overhaulCustomerId =
    loHaulingJobIsOverhaulEligible(job)
      ? loHaulingJobCustomerId(job)
      : "";

  loEls.customer.value =
    overhaulCustomerId ||
    "__unknown__";
'''
replace_once(old, new, 'completed job sold-under preselect')

old = '''  loEls.haulingJobNote.className =
    "loadout-contract-note good";


  loEls.haulingJobNote.textContent =
    loHaulingJobNote(
      job
    );
'''
new = '''  const overhaulSelected =
    !loHaulingJobIsActive(job) &&
    loHaulingJobIsOverhaulEligible(job);


  loEls.haulingJob.style.color =
    overhaulSelected
      ? "#C9444D"
      : "";


  loEls.haulingJob.style.fontWeight =
    overhaulSelected
      ? "900"
      : "";


  loEls.haulingJobNote.className =
    overhaulSelected
      ? "loadout-contract-note warn"
      : "loadout-contract-note good";


  loEls.haulingJobNote.textContent =
    overhaulSelected
      ? "COMPLETED • Overhaul Allowed"
      : loHaulingJobNote(
          job
        );
'''
replace_once(old, new, 'selected overhaul visual state')


# 7) No selected job means no red state can leak into the next load.
old = '''  if (
    !job
  ) {

    loEls.destination.value =
'''
new = '''  if (
    !job
  ) {

    loEls.haulingJob.style.color =
      "";

    loEls.haulingJob.style.fontWeight =
      "";

    loEls.destination.value =
'''
replace_once(old, new, 'reset overhaul visual state')


# Sanity checks before writing.
required = [
    'function loHaulingJobIsOverhaulEligible(job)',
    'function loHaulingJobOverhaulLabel(job)',
    'COMPLETED • Overhaul Allowed',
    'option.dataset.overhaul = "true"',
    'calendarDaysSinceCompletion <= 2'
]
for token in required:
    if token not in text:
        raise SystemExit(f'Patch sanity check failed: {token}')

path.write_text(text, encoding='utf-8')
print('Patched completed hauling-job two-day overhaul grace period')
