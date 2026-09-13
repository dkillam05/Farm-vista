from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"Expected anchor not found: {label}")
    return text.replace(old, new, 1)


# ============================================================
# 1) Hauling jobs: explicit 0 bushels = Spot Loads
# ============================================================
path = Path("js/grain-hauling-jobs-core.js")
text = path.read_text(encoding="utf-8")

if "spotLoadOnly" not in text:
    anchor = '''function setJobMessage(\n  message,\n  type =\n    "error"\n) {\n'''
    confirm_helper = '''function confirmSpotLoadOnly(message) {\n\n  return new Promise(resolve => {\n\n    const existing =\n      document.getElementById("fv-spot-load-confirm");\n\n    existing?.remove();\n\n    const backdrop =\n      document.createElement("div");\n\n    backdrop.id =\n      "fv-spot-load-confirm";\n\n    Object.assign(backdrop.style, {\n      position: "fixed",\n      inset: "0",\n      zIndex: "20000",\n      display: "flex",\n      alignItems: "center",\n      justifyContent: "center",\n      padding: "18px",\n      background: "rgba(0,0,0,.58)"\n    });\n\n    const card =\n      document.createElement("div");\n\n    Object.assign(card.style, {\n      width: "min(460px, 100%)",\n      border: "1px solid var(--border)",\n      borderRadius: "16px",\n      background: "var(--surface)",\n      color: "var(--text)",\n      boxShadow: "0 22px 60px rgba(0,0,0,.35)",\n      padding: "18px"\n    });\n\n    const title =\n      document.createElement("div");\n\n    title.textContent =\n      "Spot Loads Only";\n\n    Object.assign(title.style, {\n      fontSize: "20px",\n      fontWeight: "950",\n      marginBottom: "8px"\n    });\n\n    const body =\n      document.createElement("div");\n\n    body.textContent =\n      message;\n\n    Object.assign(body.style, {\n      lineHeight: "1.45",\n      marginBottom: "18px"\n    });\n\n    const actions =\n      document.createElement("div");\n\n    Object.assign(actions.style, {\n      display: "flex",\n      justifyContent: "flex-end",\n      gap: "10px"\n    });\n\n    const finish = value => {\n      backdrop.remove();\n      resolve(value);\n    };\n\n    const cancel =\n      document.createElement("button");\n\n    cancel.type = "button";\n    cancel.textContent = "Cancel";\n    cancel.className = "btn";\n    cancel.addEventListener("click", () => finish(false));\n\n    const proceed =\n      document.createElement("button");\n\n    proceed.type = "button";\n    proceed.textContent = "Continue";\n    proceed.className = "btn btn-primary";\n    proceed.addEventListener("click", () => finish(true));\n\n    backdrop.addEventListener("click", event => {\n      if (event.target === backdrop) finish(false);\n    });\n\n    actions.append(cancel, proceed);\n    card.append(title, body, actions);\n    backdrop.appendChild(card);\n    document.body.appendChild(backdrop);\n\n    proceed.focus();\n\n  });\n\n}\n\n\nfunction setJobMessage(\n  message,\n  type =\n    "error"\n) {\n'''
    text = replace_once(text, anchor, confirm_helper, "hauling spot confirmation helper")

    old = '''  const startingBushels =\n    num(\n      $(\n        "hauling-job-bushels"\n      )\n        ?.value\n    );\n'''
    new = '''  const startingBushelsRaw =\n    clean(\n      $(\n        "hauling-job-bushels"\n      )\n        ?.value\n    )\n      .replace(/,/g, "");\n\n\n  const startingBushels =\n    Number(startingBushelsRaw);\n\n\n  const bushelsEntered =\n    startingBushelsRaw !== "" &&\n    Number.isFinite(startingBushels) &&\n    startingBushels >= 0;\n\n\n  const spotLoadOnly =\n    bushelsEntered &&\n    startingBushels === 0;\n'''
    text = replace_once(text, old, new, "hauling explicit zero parsing")

    old = '''  !customer ||\n  !crop ||\n  !(startingBushels > 0) ||\n  !deliveryStartDate ||\n'''
    new = '''  !customer ||\n  !crop ||\n  !bushelsEntered ||\n  !deliveryStartDate ||\n'''
    text = replace_once(text, old, new, "hauling zero validation")

    old = '''  if (\n    deliveryEndDate <\n    deliveryStartDate\n  ) {\n\n    setJobMessage(\n      "Delivery end date cannot be before the start date."\n    );\n\n\n    return;\n\n  }\n\n\n  const oldJob =\n'''
    new = '''  if (\n    deliveryEndDate <\n    deliveryStartDate\n  ) {\n\n    setJobMessage(\n      "Delivery end date cannot be before the start date."\n    );\n\n\n    return;\n\n  }\n\n\n  if (\n    !editId &&\n    spotLoadOnly\n  ) {\n\n    const proceed =\n      await confirmSpotLoadOnly(\n        "This hauling job is for spot loads only. Destination, Sold Under, and delivery dates must match for tickets to be assigned to it."\n      );\n\n    if (!proceed) {\n      return;\n    }\n\n  }\n\n\n  const oldJob =\n'''
    text = replace_once(text, old, new, "hauling spot confirmation")

    old = '''  const jobNameValue =\n    `${\n      clean(\n        location?.buyerName ||\n        buyer.name\n      )\n    } ${\n      location.locationName\n    } — ${\n      Math.round(\n        startingBushels\n      ).toLocaleString(\n        "en-US"\n      )\n    } bu`\n      .trim();\n'''
    new = '''  const jobNameValue =\n    spotLoadOnly\n      ? `${\n          clean(\n            location?.buyerName ||\n            buyer.name\n          )\n        } ${\n          location.locationName\n        } — Spot Loads`\n          .trim()\n      : `${\n          clean(\n            location?.buyerName ||\n            buyer.name\n          )\n        } ${\n          location.locationName\n        } — ${\n          Math.round(\n            startingBushels\n          ).toLocaleString(\n            "en-US"\n          )\n        } bu`\n          .trim();\n'''
    text = replace_once(text, old, new, "hauling spot display name")

    old = '''    startingBushels,\n\n    deliveryStartDate,\n'''
    new = '''    startingBushels,\n\n    spotLoadOnly,\n\n    deliveryStartDate,\n'''
    text = replace_once(text, old, new, "hauling spot flag")

    path.write_text(text, encoding="utf-8")
    print("Patched hauling jobs for explicit zero-bushel Spot Loads")
else:
    print("Hauling spot-load patch already present")


# ============================================================
# 2) Detailed contracts: explicit 0 bushels = Spot Loads
# ============================================================
path = Path("js/grain-contract-add.js")
text = path.read_text(encoding="utf-8")

if "spotLoadOnly" not in text:
    anchor = '''/* ============================================================\n   SAVE\n============================================================ */\n\nasync function handleSaveContract(\n'''
    helper = '''/* ============================================================\n   SPOT LOAD CONFIRMATION\n============================================================ */\n\nfunction confirmSpotLoadOnly(message) {\n\n  return new Promise(resolve => {\n\n    document.getElementById("fv-spot-load-confirm")?.remove();\n\n    const backdrop = document.createElement("div");\n    backdrop.id = "fv-spot-load-confirm";\n    Object.assign(backdrop.style, {\n      position:"fixed", inset:"0", zIndex:"20000",\n      display:"flex", alignItems:"center", justifyContent:"center",\n      padding:"18px", background:"rgba(0,0,0,.58)"\n    });\n\n    const card = document.createElement("div");\n    Object.assign(card.style, {\n      width:"min(460px, 100%)", border:"1px solid var(--border)",\n      borderRadius:"16px", background:"var(--surface)", color:"var(--text)",\n      boxShadow:"0 22px 60px rgba(0,0,0,.35)", padding:"18px"\n    });\n\n    const title = document.createElement("div");\n    title.textContent = "Spot Loads Only";\n    Object.assign(title.style, {fontSize:"20px", fontWeight:"950", marginBottom:"8px"});\n\n    const body = document.createElement("div");\n    body.textContent = message;\n    Object.assign(body.style, {lineHeight:"1.45", marginBottom:"18px"});\n\n    const actions = document.createElement("div");\n    Object.assign(actions.style, {display:"flex", justifyContent:"flex-end", gap:"10px"});\n\n    const finish = value => { backdrop.remove(); resolve(value); };\n\n    const cancel = document.createElement("button");\n    cancel.type = "button";\n    cancel.textContent = "Cancel";\n    cancel.className = "btn";\n    cancel.addEventListener("click", () => finish(false));\n\n    const proceed = document.createElement("button");\n    proceed.type = "button";\n    proceed.textContent = "Continue";\n    proceed.className = "btn btn-primary";\n    proceed.addEventListener("click", () => finish(true));\n\n    backdrop.addEventListener("click", event => {\n      if (event.target === backdrop) finish(false);\n    });\n\n    actions.append(cancel, proceed);\n    card.append(title, body, actions);\n    backdrop.appendChild(card);\n    document.body.appendChild(backdrop);\n    proceed.focus();\n\n  });\n\n}\n\n\n/* ============================================================\n   SAVE\n============================================================ */\n\nasync function handleSaveContract(\n'''
    text = replace_once(text, anchor, helper, "contract spot confirmation helper")

    old = '''  const bushels =\n    Number(\n      $("contract-bushels")\n        ?.dataset\n        .rawValue\n    );\n\n\n  if (\n    !Number.isFinite(bushels) ||\n    bushels <= 0\n  ) {\n'''
    new = '''  const bushelRawValue =\n    $("contract-bushels")\n      ?.dataset\n      .rawValue ??\n      "";\n\n\n  const bushels =\n    Number(bushelRawValue);\n\n\n  const bushelsEntered =\n    bushelRawValue !== "" &&\n    Number.isFinite(bushels) &&\n    bushels >= 0;\n\n\n  const spotLoadOnly =\n    bushelsEntered &&\n    bushels === 0;\n\n\n  if (\n    !bushelsEntered\n  ) {\n'''
    text = replace_once(text, old, new, "contract explicit zero validation")

    old = '''  if (!form.reportValidity()) {\n\n    return;\n\n  }\n\n\n  saveBtn.disabled =\n'''
    new = '''  if (!form.reportValidity()) {\n\n    return;\n\n  }\n\n\n  if (spotLoadOnly) {\n\n    const proceed =\n      await confirmSpotLoadOnly(\n        "This contract is for spot loads only. Destination, Sold Under, and delivery dates must match for tickets to be assigned to it."\n      );\n\n    if (!proceed) {\n      return;\n    }\n\n  }\n\n\n  saveBtn.disabled =\n'''
    text = replace_once(text, old, new, "contract spot confirmation")

    old = '''    contractBushels:\n      bushels,\n\n    deliveredBushels:\n'''
    new = '''    contractBushels:\n      bushels,\n\n    spotLoadOnly:\n      bushels === 0,\n\n    deliveredBushels:\n'''
    text = replace_once(text, old, new, "contract spot flag")

    path.write_text(text, encoding="utf-8")
    print("Patched detailed contracts for explicit zero-bushel Spot Loads")
else:
    print("Contract spot-load patch already present")


# ============================================================
# 3) Load Out: spot jobs/contracts remain eligible in date window
# ============================================================
path = Path("pages/grain/grain-ticket.html")
text = path.read_text(encoding="utf-8")

if "loHaulingJobIsSpotEligible" not in text:
    anchor = '''  function loOpenContracts(){\n    return loState.contracts.filter(loContractIsOpen);\n  }\n'''
    helper = '''  function loContractStartingBushels(contract){\n    const value = Number(\n      contract?.contractBushels ??\n      contract?.bushels ??\n      contract?.quantity ??\n      contract?.totalBushels ??\n      0\n    );\n\n    return Number.isFinite(value)\n      ? Math.max(0,value)\n      : 0;\n  }\n\n  function loContractIsSpot(contract){\n    return (\n      contract?.spotLoadOnly === true ||\n      loContractStartingBushels(contract) === 0\n    );\n  }\n\n  function loContractIsSpotEligible(contract){\n    if (!contract || !loContractIsSpot(contract)) return false;\n    if (contract.isActive === false || contract.active === false) return false;\n\n    const status = loNorm(contract.status || contract.contractStatus);\n    if (\n      status.includes("closed") ||\n      status.includes("cancel") ||\n      status.includes("void")\n    ) {\n      return false;\n    }\n\n    const deliveryDate = loDeliveryDateForForm();\n    const start = loClean(contract.deliveryStart || contract.deliveryStartDate || contract.startDate);\n    const end = loClean(contract.deliveryEnd || contract.deliveryEndDate || contract.endDate);\n\n    return (\n      !!deliveryDate &&\n      !!start &&\n      !!end &&\n      deliveryDate >= start &&\n      deliveryDate <= end\n    );\n  }\n\n  function loOpenContracts(){\n    return loState.contracts.filter(loContractIsOpen);\n  }\n'''
    text = replace_once(text, anchor, helper, "loadout spot contract helpers")

    old = '''  function loContractIsOpen(contract){\n    if (contract.isActive === false || contract.active === false) {\n      return false;\n    }\n'''
    new = '''  function loContractIsOpen(contract){\n    if (loContractIsSpot(contract)) {\n      return loContractIsSpotEligible(contract);\n    }\n\n    if (contract.isActive === false || contract.active === false) {\n      return false;\n    }\n'''
    text = replace_once(text, old, new, "loadout spot contract open rule")

    old = '''  function loContractLabel(contract){\n    const number =\n      loClean(\n        contract.contractNumber ||\n        contract.number ||\n        contract.contractNo ||\n        contract.referenceNumber\n      ) ||\n      `Contract ${contract.id.slice(0,6)}`;\n\n    const remainingRaw =\n'''
    new = '''  function loContractLabel(contract){\n    const number =\n      loClean(\n        contract.contractNumber ||\n        contract.number ||\n        contract.contractNo ||\n        contract.referenceNumber\n      ) ||\n      `Contract ${contract.id.slice(0,6)}`;\n\n    if (loContractIsSpot(contract)) {\n      return `${number} • Spot Loads`;\n    }\n\n    const remainingRaw =\n'''
    text = replace_once(text, old, new, "loadout spot contract label")

    anchor = '''  function loHaulingJobTicketedBushels(job){\n'''
    helper = '''  function loHaulingJobIsSpot(job){\n    return (\n      job?.spotLoadOnly === true ||\n      loHaulingJobStartingBushels(job) === 0\n    );\n  }\n\n  function loHaulingJobIsSpotEligible(job){\n    if (!job || !loHaulingJobIsSpot(job)) return false;\n    if (job.active === false || job.isActive === false) return false;\n\n    const status = loNorm(job.status || "active");\n    if (\n      status.includes("closed") ||\n      status.includes("cancel") ||\n      status.includes("void")\n    ) {\n      return false;\n    }\n\n    const deliveryDate = loDeliveryDateForForm();\n    const start = loClean(job.deliveryStartDate || job.startDate);\n    const end = loClean(job.deliveryEndDate || job.endDate);\n\n    return (\n      !!deliveryDate &&\n      !!start &&\n      !!end &&\n      deliveryDate >= start &&\n      deliveryDate <= end\n    );\n  }\n\n  function loHaulingJobTicketedBushels(job){\n'''
    text = replace_once(text, anchor, helper, "loadout spot hauling helpers")

    old = '''  function loHaulingJobIsActive(job){\n    if (!job || job.active === false || job.isActive === false) return false;\n\n    const status = loNorm(job.status || "active");\n'''
    new = '''  function loHaulingJobIsActive(job){\n    if (!job || job.active === false || job.isActive === false) return false;\n\n    if (loHaulingJobIsSpot(job)) {\n      return loHaulingJobIsSpotEligible(job);\n    }\n\n    const status = loNorm(job.status || "active");\n'''
    text = replace_once(text, old, new, "loadout spot hauling active rule")

    old = '''  if (\n    overhaulAllowed &&\n    loClean(customer.id) ===\n      loHaulingJobCustomerId(job)\n  ) {\n    return true;\n  }\n'''
    new = '''  if (\n    (\n      overhaulAllowed ||\n      loHaulingJobIsSpotEligible(job)\n    ) &&\n    loClean(customer.id) ===\n      loHaulingJobCustomerId(job)\n  ) {\n    return true;\n  }\n'''
    text = replace_once(text, old, new, "loadout spot hauling sold-under validation")

    old = '''  function loHaulingJobLabel(job){\n    const destination =\n'''
    new = '''  function loHaulingJobLabel(job){\n    const destination =\n'''
    # Label body is patched at its final starting-bushels return.
    if old not in text:
        raise SystemExit("Expected anchor not found: loadout hauling label start")

    old = '''    const starting = loHaulingJobStartingBushels(job);\n    return `${place} — ${starting.toLocaleString("en-US")} bu`;\n  }\n'''
    new = '''    if (loHaulingJobIsSpot(job)) {\n      const crop = loClean(job.crop || job.commodity) || "Crop";\n      const customerId = loHaulingJobCustomerId(job);\n      const customer = loState.customers.find(item => item.id === customerId) || null;\n      const customerName = loClean(customer?.name || job.customerName) || "Unknown";\n      return `${place} — ${crop} — ${customerName} • Spot Loads`;\n    }\n\n    const starting = loHaulingJobStartingBushels(job);\n    return `${place} — ${starting.toLocaleString("en-US")} bu`;\n  }\n'''
    text = replace_once(text, old, new, "loadout spot hauling label")

    old = '''  function loHaulingJobNote(job){\n    if (!job) return "";\n\n    const start = loFormatShortDate(\n'''
    new = '''  function loHaulingJobNote(job){\n    if (!job) return "";\n\n    const start = loFormatShortDate(\n'''
    if old not in text:
        raise SystemExit("Expected anchor not found: loadout hauling note start")

    old = '''    const remaining = loHaulingJobRemainingBushels(job);\n\n    return [\n      dates ? `Delivery ${dates}` : "",\n      `Remaining ${remaining.toLocaleString("en-US")} bu`\n    ]\n'''
    new = '''    if (loHaulingJobIsSpot(job)) {\n      return [\n        dates ? `Delivery ${dates}` : "",\n        "Spot Loads"\n      ]\n        .filter(Boolean)\n        .join(" • ");\n    }\n\n    const remaining = loHaulingJobRemainingBushels(job);\n\n    return [\n      dates ? `Delivery ${dates}` : "",\n      `Remaining ${remaining.toLocaleString("en-US")} bu`\n    ]\n'''
    text = replace_once(text, old, new, "loadout spot hauling note")

    old = '''  if (\n    loHaulingJobIsOverhaulEligible(\n      haulingJob\n    )\n  ) {\n'''
    new = '''  if (\n    loHaulingJobIsOverhaulEligible(\n      haulingJob\n    ) ||\n    loHaulingJobIsSpotEligible(\n      haulingJob\n    )\n  ) {\n'''
    text = replace_once(text, old, new, "loadout spot hauling customer fallback")

    path.write_text(text, encoding="utf-8")
    print("Patched Load Out spot hauling jobs and contracts")
else:
    print("Load Out spot-load patch already present")
