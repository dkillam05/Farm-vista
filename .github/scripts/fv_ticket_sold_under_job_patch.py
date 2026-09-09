from pathlib import Path
import re

DETAIL = Path('pages/grain/grain-ticket-detail.html')
JOBS = Path('js/grain-hauling-jobs.js')
CONTRACTS = Path('pages/grain/grain-contracts.html')

s = DETAIL.read_text()

# 1. A real Sold Under must not filter out a hauling job merely because no
# contract exists yet. A job-owned customer is valid; no-contract jobs can be
# taught from a reviewed ticket.
old = '''          /*
            When Sold Under is known, keep only hauling jobs with an
            OPEN linked contract for that customer/crop. Unknown does
            not force a contract match.
          */
          if (
            selectedCustomerId &&
            selectedCustomerId !== "__unknown__"
          ) {
            const customerCompatible =
              state.contracts.some(
                contract =>
                  contractIsOpen(contract) &&
                  clean(contract?.haulingJobId) ===
                    clean(job.id) &&
                  contractCustomerId(contract) ===
                    selectedCustomerId &&
                  (
                    !selectedCrop ||
                    contractCrop(contract) ===
                      selectedCrop
                  )
              );

            if (!customerCompatible) {
              return false;
            }
          }
'''
new = '''          /*
            Sold Under may be learned from a reviewed grain ticket before a
            grain contract exists. Do not remove an otherwise-valid hauling
            job simply because the selected customer has no linked contract.
          */
          if (
            selectedCustomerId &&
            selectedCustomerId !== "__unknown__"
          ) {
            const storedJobCustomerId =
              clean(
                job?.customerId ||
                job?.grainCustomerId
              );

            const linkedContracts =
              state.contracts.filter(
                contract =>
                  contractIsOpen(contract) &&
                  clean(contract?.haulingJobId) ===
                    clean(job.id)
              );

            const customerCompatible =
              storedJobCustomerId === selectedCustomerId ||
              linkedContracts.some(
                contract =>
                  contractCustomerId(contract) === selectedCustomerId &&
                  (
                    !selectedCrop ||
                    contractCrop(contract) === selectedCrop
                  )
              ) ||
              (
                !storedJobCustomerId &&
                linkedContracts.length === 0
              );

            if (!customerCompatible) {
              return false;
            }
          }
'''
if old not in s:
    raise SystemExit('renderContractOptions customer compatibility block not found')
s = s.replace(old, new, 1)

# 2. Preserve a ticket-selected customer when the hauling job has no contracts,
# and recognize a customer already learned directly on the hauling job.
old = '''  const eligibleCustomerIds =
    new Set(
      state.contracts

        .filter(
          contract =>
            contractIsOpen(
              contract
            ) &&
            clean(
              contract?.haulingJobId
            ) ===
              clean(
                job.id
              )
        )

        .map(
          contract =>
            contractCustomerId(
              contract
            )
        )

        .filter(
          Boolean
        )
    );
'''
add = old + '''\n\n  const storedJobCustomerId =\n    clean(\n      job?.customerId ||\n      job?.grainCustomerId\n    );\n\n\n  if (\n    storedJobCustomerId\n  ) {\n\n    eligibleCustomerIds.add(\n      storedJobCustomerId\n    );\n\n  }\n'''
if old not in s:
    raise SystemExit('applySelectedHaulingJob eligible customers block not found')
s = s.replace(old, add, 1)

old = '''  else if (
    currentCustomerId &&
    eligibleCustomerIds.has(
      currentCustomerId
    )
  ) {
'''
new = '''  else if (
    currentCustomerId &&
    (
      eligibleCustomerIds.size === 0 ||
      eligibleCustomerIds.has(
        currentCustomerId
      )
    )
  ) {
'''
if old not in s:
    raise SystemExit('applySelectedHaulingJob preservation condition not found')
s = s.replace(old, new, 1)

# 3. Auto-match Sold Under from the hauling job even without contracts.
marker = '''  const eligibleCustomers =
    state.customers.filter(
      customer =>
        eligibleCustomerIds.has(
          customer.id
        )
    );
'''
replacement = '''  const storedJobCustomerId =
    clean(
      haulingJob?.customerId ||
      haulingJob?.grainCustomerId
    );


  if (
    storedJobCustomerId
  ) {

    eligibleCustomerIds.add(
      storedJobCustomerId
    );

  }


''' + marker
if marker not in s:
    raise SystemExit('autoMatchCustomer eligible marker not found')
s = s.replace(marker, replacement, 1)

old = '''  if (
    savedCustomerId
  ) {

    const saved =
      eligibleCustomers.find(
        customer =>
          customer.id ===
          savedCustomerId
      );


    if (
      saved
    ) {

      return saved;

    }

  }
'''
new = '''  if (
    savedCustomerId
  ) {

    const saved =
      state.customers.find(
        customer =>
          customer.id ===
          savedCustomerId
      ) ||
      null;


    if (
      saved &&
      (
        eligibleCustomerIds.size === 0 ||
        eligibleCustomerIds.has(
          savedCustomerId
        )
      )
    ) {

      return saved;

    }

  }
'''
if old not in s:
    raise SystemExit('autoMatchCustomer saved block not found')
s = s.replace(old, new, 1)

# 4. Helpers: backfeed Sold Under to hauling job and resolve one unique hauling
# job for other tickets in the exact same OCR-review backlog.
marker = '''    // ==========================================================
    // BULK SOLD UNDER CORRECTION FOR REVIEW TICKETS
    // ==========================================================
'''
helpers = '''    async function syncSoldUnderToHaulingJob(
      job,
      selectedCustomer,
      sourceTicketId = ticketId
    ) {

      if (
        !job?.id ||
        !selectedCustomer?.id ||
        selectedCustomer?.unknown === true
      ) {
        return false;
      }

      const linkedOpenContracts =
        state.contracts.filter(
          contract =>
            contractIsOpen(contract) &&
            clean(contract?.haulingJobId) === clean(job.id)
        );

      const linkedCustomerIds =
        new Set(
          linkedOpenContracts
            .map(contractCustomerId)
            .filter(Boolean)
        );

      /* Do not override a job that has contracts for a different customer. */
      if (
        linkedCustomerIds.size > 0 &&
        !linkedCustomerIds.has(clean(selectedCustomer.id))
      ) {
        return false;
      }

      const patch = {
        customerId: selectedCustomer.id,
        grainCustomerId: selectedCustomer.id,
        customerName: selectedCustomer.name,
        soldUnderSource: "grain_ticket_review",
        soldUnderLearnedFromTicketId: sourceTicketId,
        soldUnderLearnedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      await updateDoc(
        doc(db, "grain_hauling_jobs", job.id),
        patch
      );

      Object.assign(job, patch);
      return true;
    }


    function matchingHaulingJobForReviewTicket(ticket) {
      const existingId = clean(ticket?.haulingJobId);
      if (existingId) {
        const existing =
          state.haulingJobs.find(job => clean(job.id) === existingId) || null;
        if (existing) return existing;
      }

      const crop = normalize(ticket?.crop);
      const locationId = clean(
        ticket?.deliveryLocationId ||
        ticket?.destinationId
      );
      const ticketDate = clean(ticket?.ticketDate);

      const matches = state.haulingJobs.filter(job => {
        if (job?.active === false || job?.voided === true) return false;

        const status = normalize(job?.status);
        if (
          status.includes("void") ||
          status.includes("closed") ||
          status.includes("cancel") ||
          status.includes("complete")
        ) return false;

        if (
          crop &&
          normalize(job?.crop || job?.commodity) !== crop
        ) return false;

        const jobLocationId = clean(
          job?.deliveryLocationId ||
          job?.locationId ||
          job?.destinationId
        );
        if (locationId && jobLocationId && jobLocationId !== locationId) return false;

        const start = clean(job?.deliveryStartDate || job?.deliveryStart);
        const end = clean(job?.deliveryEndDate || job?.deliveryEnd);
        if (ticketDate && start && ticketDate < start) return false;
        if (ticketDate && end && ticketDate > end) return false;
        return true;
      });

      return matches.length === 1 ? matches[0] : null;
    }


'''
if marker not in s:
    raise SystemExit('bulk marker not found')
s = s.replace(marker, helpers + marker, 1)

# 5. Bulk fix also removes sold_under_requires_review and restores the unique job.
old = '''      const customerReviewReasons =
        new Set([
          "customer_not_matched",
          "customer_not_selected",
          "sold_under_unknown",
          "sold_under_driver_skipped"
        ]);
'''
new = '''      const customerReviewReasons =
        new Set([
          "customer_not_matched",
          "customer_not_selected",
          "sold_under_unknown",
          "sold_under_driver_skipped",
          "sold_under_requires_review"
        ]);
'''
if old not in s:
    raise SystemExit('bulk reason set not found')
s = s.replace(old, new, 1)

old = '''        const reviewReasons =
          existingReasons.filter(
            reason =>
              !customerReviewReasons.has(
                String(
                  reason ||
                  ""
                )
              )
          );


        try {

          await updateDoc(
'''
new = '''        const matchingJob =
          matchingHaulingJobForReviewTicket(ticket);

        const reviewReasons =
          existingReasons.filter(reason => {
            const key = String(reason || "");
            if (customerReviewReasons.has(key)) return false;
            if (matchingJob && key === "hauling_job_not_assigned") return false;
            return true;
          });


        try {

          if (matchingJob) {
            await syncSoldUnderToHaulingJob(
              matchingJob,
              selectedCustomer,
              ticketId
            );
          }

          await updateDoc(
'''
if old not in s:
    raise SystemExit('bulk pre-update block not found')
s = s.replace(old, new, 1)

old = '''              customerName:
                selectedCustomer.name,

              reviewReasons,
'''
new = '''              customerName:
                selectedCustomer.name,

              haulingJobId:
                matchingJob?.id ||
                ticket?.haulingJobId ||
                null,

              haulingJobName:
                matchingJob
                  ? contractLabel(matchingJob)
                  : (ticket?.haulingJobName || null),

              haulingJobMatched:
                Boolean(matchingJob || ticket?.haulingJobId),

              matchingHaulingJobIds:
                matchingJob
                  ? [matchingJob.id]
                  : (
                      Array.isArray(ticket?.matchingHaulingJobIds)
                        ? ticket.matchingHaulingJobIds
                        : []
                    ),

              reviewReasons,
'''
if old not in s:
    raise SystemExit('bulk update payload block not found')
s = s.replace(old, new, 1)

old = '''          ticket.customerName =
            selectedCustomer.name;

          ticket.reviewReasons =
            reviewReasons;
'''
new = '''          ticket.customerName =
            selectedCustomer.name;

          if (matchingJob) {
            ticket.haulingJobId = matchingJob.id;
            ticket.haulingJobName = contractLabel(matchingJob);
            ticket.haulingJobMatched = true;
            ticket.matchingHaulingJobIds = [matchingJob.id];
          }

          ticket.reviewReasons =
            reviewReasons;
'''
if old not in s:
    raise SystemExit('bulk local update block not found')
s = s.replace(old, new, 1)

# 6. Backfeed source ticket Sold Under onto selected hauling job before bulk update.
marker = '''        /*
          Apply an office Sold Under correction to every OTHER ticket
          still under review with the same exact OCR customer identity.
        */
'''
insert = '''        if (
          state.selectedContract &&
          state.selectedCustomer &&
          state.selectedCustomer.unknown !== true &&
          state.selectedCustomer.id
        ) {
          await syncSoldUnderToHaulingJob(
            state.selectedContract,
            state.selectedCustomer,
            ticketId
          );
        }


'''
if marker not in s:
    raise SystemExit('source-ticket backfeed marker not found')
s = s.replace(marker, insert + marker, 1)

# 7. Learn both printed OCR customer name and elevator customer/account ID.
old = '''    async function saveAlias(
      type,
      targetId,
      targetName
    ) {

      const ocrText =
        aliasValueForType(
          type
        );
'''
new = '''    async function saveAlias(
      type,
      targetId,
      targetName,
      ocrTextOverride = ""
    ) {

      const ocrText =
        clean(ocrTextOverride) ||
        aliasValueForType(
          type
        );
'''
if old not in s:
    raise SystemExit('saveAlias signature not found')
s = s.replace(old, new, 1)

old = '''state.selectedCustomer &&
state.selectedCustomer.unknown !==
  true &&
state.selectedCustomer.id
  ? saveAlias(
      "customer",
      state.selectedCustomer.id,
      state.selectedCustomer.name
    )
  : Promise.resolve(),
'''
new = '''state.selectedCustomer &&
state.selectedCustomer.unknown !==
  true &&
state.selectedCustomer.id
  ? Promise.all([
      saveAlias(
        "customer",
        state.selectedCustomer.id,
        state.selectedCustomer.name
      ),
      clean(
        state.ticket?.ocrCustomerAccountText ||
        state.ticket?.customerAccountText
      )
        ? saveAlias(
            "customer",
            state.selectedCustomer.id,
            state.selectedCustomer.name,
            state.ticket?.ocrCustomerAccountText ||
            state.ticket?.customerAccountText
          )
        : Promise.resolve()
    ])
  : Promise.resolve(),
'''
if old not in s:
    raise SystemExit('customer alias call not found')
s = s.replace(old, new, 1)

s = s.replace(
    'Sold Under comes from contracts linked to the hauling job.',
    'Sold Under can come from the hauling job or linked contracts. A reviewed ticket can teach the hauling job its Sold Under before a contract exists.',
    1
)

DETAIL.write_text(s)

# 8. Hauling Jobs table/filter must display a customer learned directly on the job.
j = JOBS.read_text()
old = '''/*
  Sold Under belongs to the contracts linked to a hauling job,
  not to the hauling job itself.

  Unknown is ALWAYS available.
'''
new = '''/*
  Sold Under may be learned directly on a hauling job from a reviewed
  elevator ticket before any grain contract exists. Linked contracts remain
  additional authoritative Sold Under sources.

  Unknown is ALWAYS available.
'''
if old not in j:
    raise SystemExit('job Sold Under comment block not found')
j = j.replace(old, new, 1)

marker = '''  const seen =
    new Set();


  contractsForJob(
    jobId
  )
'''
insert = '''  const seen =
    new Set();


  const job =
    state.jobs.find(
      item => clean(item.id) === clean(jobId)
    ) || null;

  const storedCustomerId =
    jobCustomerId(job);

  const storedCustomerName =
    clean(
      job?.customerName ||
      matchingCustomer(storedCustomerId)?.name
    );

  if (storedCustomerId || storedCustomerName) {
    const key = storedCustomerId
      ? `id:${storedCustomerId}`
      : `name:${norm(storedCustomerName)}`;

    seen.add(key);
    options.push({
      id: storedCustomerId,
      name: storedCustomerName || "Unknown",
      unknown: false
    });
  }


  contractsForJob(
    jobId
  )
'''
if marker not in j:
    raise SystemExit('jobSoldUnderOptions marker not found')
j = j.replace(marker, insert, 1)
JOBS.write_text(j)

# 9. Cache-bust the hauling-job module on Grain Contracts.
c = CONTRACTS.read_text()
c2, count = re.subn(
    r'/js/grain-hauling-jobs\.js(?:\?v=[^"\']*)?',
    '/js/grain-hauling-jobs.js?v=20260909-1146',
    c,
    count=1
)
if count != 1:
    raise SystemExit('grain hauling module script tag not found')
CONTRACTS.write_text(c2)

print('FarmVista Sold Under / hauling-job sync patch applied.')
