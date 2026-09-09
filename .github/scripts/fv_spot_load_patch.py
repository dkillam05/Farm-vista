from pathlib import Path

p = Path('pages/grain/grain-ticket-detail.html')
s = p.read_text()

def replace_once(old, new, label):
    global s
    if old not in s:
        raise SystemExit(f'missing patch marker: {label}')
    s = s.replace(old, new, 1)

# 1) Destination is ticket truth: show every existing location, regardless of contract/job.
old = '''  /*\n    A destination is eligible only when an OPEN contract exists for\n    the selected crop at that exact delivery location.\n  */\n  const cropContracts =\n    contractsForSelectedCrop();\n\n\nconst savedLocationId =\n  clean(\n    elements.locationSelect.value ||\n    state.ticket?.deliveryLocationId ||\n    state.loadout?.destinationId ||\n    state.loadout?.deliveryLocationId\n  );\n\n\nconst eligibleLocations =\n  state.locations\n    .filter(\n      location =>\n        (\n          cropContracts.some(\n            contract =>\n              contractMatchesLocation(\n                contract,\n                location\n              )\n          ) ||\n\n          /*\n            IMPORTANT:\n\n            A destination already saved on the grain ticket is\n            historical ticket truth.\n\n            Keep it visible even if there is no CURRENT active hauling job\n            for that destination.\n\n            Hauling Job availability determines what can be assigned\n            below. It must never erase the ticket's saved destination.\n          */\n          (\n            savedLocationId &&\n            location.id ===\n              savedLocationId\n          )\n        )\n    );'''
new = '''  /*\n    Destination is physical ticket truth and is independent of whether\n    FarmVista currently has an open contract or hauling job there.\n\n    This is required for legitimate spot loads: the reviewer must be able\n    to select any existing FarmVista elevator/location, then explicitly\n    choose Spot Load — No Hauling Job below.\n  */\n  const eligibleLocations =\n    [...state.locations];'''
replace_once(old, new, 'all destination locations')

# Improve empty destination wording.
replace_once(
'''    empty.textContent =\n      `No destination has an open ${clean(elements.crop.value)} contract.`;''',
'''    empty.textContent =\n      `No FarmVista destination matches “${clean(searchText)}”.`;''',
'destination empty text')

# 2) Preserve an explicit Spot Load selection when destination changes.
old = '''  elements.contractSelect.value =\n    \"\";\n\n  state.selectedContract =\n    null;'''
new = '''  const keepSpotLoad =\n    state.spotLoad ===\n      true;\n\n  elements.contractSelect.value =\n    keepSpotLoad\n      ? \"__spot_load__\"\n      : \"\";\n\n  state.selectedContract =\n    null;\n\n  state.spotLoad =\n    keepSpotLoad;'''
replace_once(old, new, 'preserve spot on destination change')

# 3) Customer picker: allow all existing customers when no job/contracts exist or Spot Load is selected.
old = '''  const otherCustomers =\n    hasUnallocatedCapacity\n      ? state.customers\n          .filter(\n            customer =>\n              !linkedIds.has(\n                customer.id\n              )\n          )\n          .filter(\n            customer =>\n              !search ||\n              normalize(\n                customer.name\n              ).includes(\n                search\n              )\n          )\n          .sort(\n            (\n              a,\n              b\n            ) =>\n              a.name.localeCompare(\n                b.name,\n                undefined,\n                {\n                  numeric:\n                    true,\n\n                  sensitivity:\n                    \"base\"\n                }\n              )\n          )\n      : [];'''
new = '''  const allowAllExistingCustomers =\n    state.spotLoad ===\n      true ||\n    (\n      !haulingJob &&\n      linkedCustomers.length ===\n        0\n    );\n\n\n  const otherCustomers =\n    (\n      hasUnallocatedCapacity ||\n      allowAllExistingCustomers\n    )\n      ? state.customers\n          .filter(\n            customer =>\n              !linkedIds.has(\n                customer.id\n              )\n          )\n          .filter(\n            customer =>\n              !search ||\n              normalize(\n                customer.name\n              ).includes(\n                search\n              )\n          )\n          .sort(\n            (\n              a,\n              b\n            ) =>\n              a.name.localeCompare(\n                b.name,\n                undefined,\n                {\n                  numeric:\n                    true,\n\n                  sensitivity:\n                    \"base\"\n                }\n              )\n          )\n      : [];'''
replace_once(old, new, 'all customers for spot/no-contract')

old = '''        otherGroup.textContent =\n          `Other Customers — ${haulingJobUnallocatedContractBushels(\n            haulingJob\n          ).toLocaleString(\n            \"en-US\",\n            {\n              maximumFractionDigits:\n                2\n            }\n          )} bu unallocated`;'''
new = '''        otherGroup.textContent =\n          allowAllExistingCustomers\n            ? \"All Existing Customers\"\n            : `Other Customers — ${haulingJobUnallocatedContractBushels(\n                haulingJob\n              ).toLocaleString(\n                \"en-US\",\n                {\n                  maximumFractionDigits:\n                    2\n                }\n              )} bu unallocated`;'''
replace_once(old, new, 'spot customer group label')

# 4) renderContractOptions remembers saved Spot Load.
old = '''  const wantedId =\n    currentlySelected ||\n    savedId;'''
new = '''  const savedSpotLoad =\n    state.loadout?.spotLoad ===\n      true ||\n    state.ticket?.spotLoad ===\n      true ||\n    normalize(\n      state.ticket?.reconciliationStatus\n    ) ===\n      \"spot_load\";\n\n\n  const wantedId =\n    currentlySelected ||\n    (\n      savedSpotLoad\n        ? \"__spot_load__\"\n        : savedId\n    );'''
replace_once(old, new, 'remember spot load')

# Replace no-jobs branch so Spot Load is a valid explicit selection.
old = '''  if (\n    !jobs.length\n  ) {\n\n    elements.contractSelect.disabled =\n      true;\n\n\n    blank.textContent =\n      \"No active hauling jobs\";\n\n\n    elements.contractSelect.appendChild(\n      blank\n    );\n\n\n    elements.contractStatus.className =\n      \"contract-box warning\";\n\n\n    elements.contractStatus.textContent =\n      \"No active hauling job is available for this crop, destination, and ticket date.\";\n\n\n    state.selectedContract =\n      null;\n\n\n    return;\n\n  }'''
new = '''  if (\n    !jobs.length\n  ) {\n\n    elements.contractSelect.disabled =\n      false;\n\n\n    blank.textContent =\n      \"Select hauling job option\";\n\n\n    elements.contractSelect.appendChild(\n      blank\n    );\n\n\n    const spotOption =\n      document.createElement(\n        \"option\"\n      );\n\n\n    spotOption.value =\n      \"__spot_load__\";\n\n\n    spotOption.textContent =\n      \"Spot Load — No Hauling Job\";\n\n\n    elements.contractSelect.appendChild(\n      spotOption\n    );\n\n\n    const chooseSavedSpot =\n      wantedId ===\n        \"__spot_load__\";\n\n\n    elements.contractSelect.value =\n      chooseSavedSpot\n        ? \"__spot_load__\"\n        : \"\";\n\n\n    state.selectedContract =\n      null;\n\n\n    state.spotLoad =\n      chooseSavedSpot;\n\n\n    elements.contractStatus.className =\n      chooseSavedSpot\n        ? \"contract-box good\"\n        : \"contract-box warning\";\n\n\n    elements.contractStatus.textContent =\n      chooseSavedSpot\n        ? \"Spot Load selected — this ticket will not be linked to a hauling job or grain contract.\"\n        : \"No active hauling job is available. Choose Spot Load — No Hauling Job if this delivery was intentional.\";\n\n\n    updateReviewUI();\n\n\n    return;\n\n  }'''
replace_once(old, new, 'no jobs spot option')

# Add Spot Load option when normal jobs also exist.
old = '''  elements.contractSelect.appendChild(\n    blank\n  );\n\n\n  jobs.forEach('''
new = '''  elements.contractSelect.appendChild(\n    blank\n  );\n\n\n  const spotOption =\n    document.createElement(\n      \"option\"\n    );\n\n\n  spotOption.value =\n    \"__spot_load__\";\n\n\n  spotOption.textContent =\n    \"Spot Load — No Hauling Job\";\n\n\n  elements.contractSelect.appendChild(\n    spotOption\n  );\n\n\n  jobs.forEach('''
replace_once(old, new, 'spot option with jobs')

# Replace validWanted / selection/status tail.
old = '''  const validWanted =\n    jobs.find(\n      job =>\n        job.id ===\n        wantedId\n    ) ||\n    (\n      jobs.length === 1\n        ? jobs[0]\n        : null\n    );\n\n\n  elements.contractSelect.value =\n    validWanted?.id ||\n    \"\";\n\n\n  state.selectedContract =\n    validWanted;\n\n\n  elements.contractStatus.className =\n    \"contract-box good\";\n\n\n  elements.contractStatus.textContent =\n    `${jobs.length} active hauling job${jobs.length === 1 ? \"\" : \"s\"} available.`;'''
new = '''  const choosingSpot =\n    wantedId ===\n      \"__spot_load__\";\n\n\n  const validWanted =\n    choosingSpot\n      ? null\n      : (\n          jobs.find(\n            job =>\n              job.id ===\n              wantedId\n          ) ||\n          (\n            jobs.length === 1 &&\n            !savedSpotLoad\n              ? jobs[0]\n              : null\n          )\n        );\n\n\n  elements.contractSelect.value =\n    choosingSpot\n      ? \"__spot_load__\"\n      : (\n          validWanted?.id ||\n          \"\"\n        );\n\n\n  state.selectedContract =\n    validWanted;\n\n\n  state.spotLoad =\n    choosingSpot;\n\n\n  elements.contractStatus.className =\n    \"contract-box good\";\n\n\n  elements.contractStatus.textContent =\n    choosingSpot\n      ? \"Spot Load selected — this ticket will not be linked to a hauling job or grain contract.\"\n      : `${jobs.length} active hauling job${jobs.length === 1 ? \"\" : \"s\"} available.`;'''
replace_once(old, new, 'spot selection status')

# 5) applySelectedHaulingJob handles special value without touching destination/customer.
old = '''function applySelectedHaulingJob() {\n\n  const job ='''
new = '''function applySelectedHaulingJob() {\n\n  if (\n    elements.contractSelect.value ===\n      \"__spot_load__\"\n  ) {\n\n    state.selectedContract =\n      null;\n\n    state.spotLoad =\n      true;\n\n\n    elements.contractStatus.className =\n      \"contract-box good\";\n\n\n    elements.contractStatus.textContent =\n      \"Spot Load selected — this ticket will not be linked to a hauling job or grain contract.\";\n\n\n    renderCustomerOptions();\n    syncCustomerButton();\n    clearMessage();\n    updateReviewUI();\n\n    return;\n\n  }\n\n\n  state.spotLoad =\n    false;\n\n\n  const job ='''
replace_once(old, new, 'apply spot selection')

# 6) Spot Load satisfies the hauling-job requirement.
old = '''  if (\n    !state.selectedContract\n  ) {\n\n    reasons.push(\n      \"hauling_job_not_assigned\"\n    );\n\n  }'''
new = '''  if (\n    !state.selectedContract &&\n    state.spotLoad !==\n      true\n  ) {\n\n    reasons.push(\n      \"hauling_job_not_assigned\"\n    );\n\n  }'''
replace_once(old, new, 'spot review rule')

# 7) updateSelectedReferences tracks the special picker value.
old = '''  state.selectedContract =\n    state.haulingJobs.find(\n      job =>\n        job.id ===\n        elements.contractSelect.value\n    ) ||\n    null;\n\n}'''
new = '''  state.spotLoad =\n    elements.contractSelect.value ===\n      \"__spot_load__\";\n\n\n  state.selectedContract =\n    state.spotLoad\n      ? null\n      : (\n          state.haulingJobs.find(\n            job =>\n              job.id ===\n              elements.contractSelect.value\n          ) ||\n          null\n        );\n\n}'''
replace_once(old, new, 'selected refs spot')

# 8) Reopening a Spot Load can resolve Sold Under without a hauling job.
old = '''  const ticket =\n    state.ticket ||\n    {};\n\n\n  /*\n    If the ticket was already explicitly saved as Unknown,'''
new = '''  const ticket =\n    state.ticket ||\n    {};\n\n\n  const savedSpotLoad =\n    state.loadout?.spotLoad ===\n      true ||\n    ticket.spotLoad ===\n      true ||\n    normalize(\n      ticket.reconciliationStatus\n    ) ===\n      \"spot_load\";\n\n\n  if (\n    savedSpotLoad\n  ) {\n\n    const savedCustomerId =\n      clean(\n        state.loadout?.customerId ||\n        ticket.customerId\n      );\n\n\n    const savedCustomer =\n      state.customers.find(\n        customer =>\n          customer.id ===\n          savedCustomerId\n      ) ||\n      null;\n\n\n    if (\n      savedCustomer\n    ) {\n\n      return savedCustomer;\n\n    }\n\n\n    const source =\n      clean(\n        ticket.ocrCustomerText ||\n        ticket.ocrCustomerAccountText ||\n        ticket.customerName\n      );\n\n\n    const matched =\n      state.customers.find(\n        customer =>\n          compactNormalize(customer.name) ===\n            compactNormalize(source) ||\n          normalizeNameWords(customer.name) ===\n            normalizeNameWords(source)\n      ) ||\n      null;\n\n\n    if (\n      matched\n    ) {\n\n      return matched;\n\n    }\n\n  }\n\n\n  /*\n    If the ticket was already explicitly saved as Unknown,'''
replace_once(old, new, 'spot customer reopen')

# 9) Save Spot Load accounting explicitly.
replace_once(
'''          spotBushels:\n            0,\n\n          unassignedBushels:\n            selectedGrainContract\n              ? 0\n              : ticketNetBushels,\n\n          reconciliationStatus:\n            selectedGrainContract\n              ? \"reconciled\"\n              : \"needs_contract\",''',
'''          spotLoad:\n            state.spotLoad ===\n              true,\n\n          spotLoadLabel:\n            state.spotLoad ===\n              true\n              ? \"Spot Load — No Hauling Job\"\n              : null,\n\n          spotBushels:\n            state.spotLoad ===\n              true\n              ? ticketNetBushels\n              : 0,\n\n          unassignedBushels:\n            state.spotLoad ===\n              true ||\n            selectedGrainContract\n              ? 0\n              : ticketNetBushels,\n\n          reconciliationStatus:\n            state.spotLoad ===\n              true\n              ? \"spot_load\"\n              : (\n                  selectedGrainContract\n                    ? \"reconciled\"\n                    : \"needs_contract\"\n                ),''',
'spot accounting payload')

# Add Spot Load to linked loadout patch too (if one exists).
old = '''            haulingJobId:\n              state.selectedContract?.id ||\n              null,\n\n            haulingJobName:\n              state.selectedContract\n                ? contractLabel(\n                    state.selectedContract\n                  )\n                : null,\n\n            haulingJobLabel:\n              state.selectedContract\n                ? contractLabel(\n                    state.selectedContract\n                  )\n                : null,'''
new = '''            spotLoad:\n              state.spotLoad ===\n                true,\n\n            haulingJobId:\n              state.selectedContract?.id ||\n              null,\n\n            haulingJobName:\n              state.selectedContract\n                ? contractLabel(\n                    state.selectedContract\n                  )\n                : null,\n\n            haulingJobLabel:\n              state.selectedContract\n                ? contractLabel(\n                    state.selectedContract\n                  )\n                : (\n                    state.spotLoad === true\n                      ? \"Spot Load — No Hauling Job\"\n                      : null\n                  ),'''
replace_once(old, new, 'spot linked loadout patch')

# Crop reset also exits Spot Load intentionally.
old = '''            state.selectedContract =\n              null;\n\n\n            syncGrainSourceButton();'''
new = '''            state.selectedContract =\n              null;\n\n            state.spotLoad =\n              false;\n\n\n            syncGrainSourceButton();'''
replace_once(old, new, 'crop clears spot')

# 10) Correct the previous destination-conflict safeguard: remove it from autoMatchBuyer.
misplaced_start = '''          const savedOcrCity =\n            compactNormalize(\n              state.ticket.ocrDeliveryCity ||\n              state.ticket.deliveryCity\n            );'''
misplaced_end = '''          );\n\n        }\n\n      }\n\n\n      const source =\n        clean(\n          state.loadout?.buyerName ||'''
start = s.find(misplaced_start, s.find('function autoMatchBuyer'))
end_marker_pos = s.find(misplaced_end, start)
if start < 0 or end_marker_pos < 0:
    raise SystemExit('misplaced buyer location safety block not found')
# Preserve closing of if(byId) and savedBuyerId blocks.
replacement = '''          return byId;\n\n        }\n\n      }\n\n\n      const source =\n        clean(\n          state.loadout?.buyerName ||'''
s = s[:start] + replacement + s[end_marker_pos + len(misplaced_end):]

# Insert saved-location conflict check into autoMatchLocation's byId block.
auto_loc = s.find('function autoMatchLocation()')
if auto_loc < 0:
    raise SystemExit('autoMatchLocation not found')
old = '''        if (\n          byId\n        ) {\n\n          return byId;\n\n        }'''
pos = s.find(old, auto_loc)
if pos < 0:
    raise SystemExit('autoMatchLocation byId block not found')
new = '''        if (\n          byId\n        ) {\n\n          const savedOcrCity =\n            compactNormalize(\n              state.ticket.ocrDeliveryCity ||\n              state.ticket.deliveryCity\n            );\n\n          const savedOcrState =\n            compactNormalize(\n              state.ticket.ocrDeliveryState ||\n              state.ticket.deliveryState\n            );\n\n          const savedOcrZip =\n            compactNormalize(\n              state.ticket.ocrDeliveryZip ||\n              state.ticket.deliveryZip\n            );\n\n          const savedLocationMatchesEvidence =\n            (\n              !savedOcrCity ||\n              compactNormalize(byId.city) ===\n                savedOcrCity\n            ) &&\n            (\n              !savedOcrState ||\n              compactNormalize(byId.state) ===\n                savedOcrState\n            ) &&\n            (\n              !savedOcrZip ||\n              compactNormalize(byId.zip) ===\n                savedOcrZip\n            );\n\n          if (\n            savedLocationMatchesEvidence\n          ) {\n\n            return byId;\n\n          }\n\n          console.warn(\n            \"[Grain Ticket Detail] Ignoring saved destination because OCR location evidence conflicts.\",\n            {\n              savedLocationId,\n              savedLocationName: byId.locationName,\n              savedLocationCity: byId.city,\n              savedLocationState: byId.state,\n              ocrCity: savedOcrCity,\n              ocrState: savedOcrState,\n              ocrZip: savedOcrZip\n            }\n          );\n\n        }'''
s = s[:pos] + s[pos:].replace(old, new, 1)

p.write_text(s)

# Version bump.
p = Path('js/version.js')
v = p.read_text()
if 'number:  "09.09.03"' not in v:
    raise SystemExit('expected FarmVista version 09.09.03 not found')
v = v.replace('number:  "09.09.03"', 'number:  "09.09.04"', 1)
v = v.replace('date:    "2026-09-08"', 'date:    "2026-09-09"', 1)
p.write_text(v)
