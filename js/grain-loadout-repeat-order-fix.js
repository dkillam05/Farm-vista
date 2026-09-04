/* =====================================================================
   FarmVista — Load Out Repeat-Run Stable Defaults

   Reuses the selected driver's most recent load on a NEW Assign Load.

   Order is intentional:
     1. Hauling Job
     2. let grain-ticket.html apply Crop / Destination rules
     3. Sold Under / Customer
     4. Grain Source LAST

   The hauling-job SELECT is watched during the short page render window.
   If grain-ticket.html rebuilds its options and temporarily blanks the
   selected value, this module re-selects the exact previous hauling-job ID
   WITHOUT firing a second change event. A manual choice of a different
   hauling job always wins.
===================================================================== */

import {
  ready,
  getFirestore,
  collection,
  getDocs
} from "/js/firebase-init.js";

await ready;

const db = getFirestore();
const $ = id => document.getElementById(id);

const el = {
  backdrop: $("loadout-modal-backdrop"),
  modalTitle: $("loadout-modal-title"),
  driver: $("loadout-driver"),
  subdriver: $("loadout-subdriver"),
  haulingJob: $("loadout-hauling-job"),
  customerButton: $("loadout-customer-button"),
  customerMenu: $("loadout-customer-menu"),
  sourceButton: $("loadout-source-button"),
  sourceMenu: $("loadout-source-menu"),
  message: $("loadout-form-message")
};

let runToken = 0;
let previousLoadForDriver = null;
let applyingPreviousRun = false;
let expectedJobId = "";
let guardUntil = 0;
let haulingObserver = null;

function clean(value) {
  return String(value ?? "").trim();
}

function norm(value) {
  return clean(value).toLowerCase();
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function millis(value) {
  if (value?.toMillis) return value.toMillis();
  if (value?.toDate) return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();

  const parsed = new Date(value || 0);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function isCreateModal() {
  return Boolean(
    el.backdrop?.classList.contains("open") &&
    norm(el.modalTitle?.textContent) === "assign load"
  );
}

function driverKey() {
  const value = clean(el.driver?.value);

  if (value.startsWith("emp:")) {
    return value;
  }

  if (value.startsWith("sub:")) {
    const subdriverId = clean(el.subdriver?.value);
    return subdriverId ? `${value}:${subdriverId}` : "";
  }

  return "";
}

function loadMatchesDriver(load, key) {
  if (!load || !key) return false;

  if (key.startsWith("emp:")) {
    return clean(load.driverEmployeeId) === clean(key.slice(4));
  }

  if (key.startsWith("sub:")) {
    const parts = key.split(":");
    const subcontractorId = clean(parts[1]);
    const subdriverId = clean(parts.slice(2).join(":"));

    return (
      clean(load.driverSubcontractorId) === subcontractorId &&
      clean(load.driverSubcontractorDriverId) === subdriverId
    );
  }

  return false;
}

function latestLoad(loads, key) {
  return loads
    .filter(load => loadMatchesDriver(load, key))
    .sort((a, b) =>
      millis(b.loadedAt || b.createdAt || b.updatedAt) -
      millis(a.loadedAt || a.createdAt || a.updatedAt)
    )[0] || null;
}

function showMessage(text) {
  if (!el.message) return;
  el.message.textContent = text || "";
  el.message.className = text
    ? "loadout-form-message show good"
    : "loadout-form-message";
}

function exactOption(select, value) {
  const wanted = clean(value);

  return Array.from(select?.options || []).find(
    option => clean(option.value) === wanted
  ) || null;
}

async function waitForJobOption(jobId, timeoutMs = 3500) {
  const started = Date.now();

  while (
    isCreateModal() &&
    Date.now() - started < timeoutMs
  ) {
    const option = exactOption(el.haulingJob, jobId);
    if (option) return option;
    await delay(60);
  }

  return null;
}

function reassertExpectedJob() {
  if (
    !expectedJobId ||
    Date.now() > guardUntil ||
    !isCreateModal() ||
    !el.haulingJob
  ) {
    return;
  }

  const current = clean(el.haulingJob.value);

  /*
    A real manual choice of ANOTHER hauling job wins immediately.
    Only repair the transient blank state caused by option re-rendering.
  */
  if (current && current !== expectedJobId) {
    expectedJobId = "";
    guardUntil = 0;
    return;
  }

  if (!current) {
    const option = exactOption(el.haulingJob, expectedJobId);

    if (option) {
      el.haulingJob.value = option.value;
      option.selected = true;
    }
  }
}

function startHaulingJobGuard(jobId) {
  expectedJobId = clean(jobId);
  guardUntil = Date.now() + 3000;

  if (!haulingObserver && el.haulingJob) {
    haulingObserver = new MutationObserver(() => {
      queueMicrotask(reassertExpectedJob);
    });

    haulingObserver.observe(el.haulingJob, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["selected", "value"]
    });
  }

  [0, 50, 120, 250, 450, 750, 1100, 1600, 2200, 2900]
    .forEach(ms => setTimeout(reassertExpectedJob, ms));
}

function findChoice(container, attribute, value) {
  const wanted = clean(value);
  if (!container || !wanted) return null;

  return Array.from(container.querySelectorAll(`[${attribute}]`)).find(
    button => clean(button.getAttribute(attribute)) === wanted
  ) || null;
}

async function restoreCustomer(previousLoad) {
  if (!el.customerButton || el.customerButton.disabled) return false;

  const customerValue =
    clean(previousLoad.customerId) ||
    (norm(previousLoad.customerName) === "unknown" ? "__unknown__" : "");

  if (!customerValue) return false;

  el.customerButton.click();
  await delay(50);

  let button = findChoice(
    el.customerMenu,
    "data-customer-value",
    customerValue
  );

  if (!button && clean(previousLoad.customerName)) {
    const wantedName = norm(previousLoad.customerName);

    button = Array.from(
      el.customerMenu?.querySelectorAll("button[data-customer-value]") || []
    ).find(item => norm(item.textContent) === wantedName) || null;
  }

  if (button) {
    button.click();
    return true;
  }

  if (el.customerMenu?.classList.contains("open")) {
    el.customerButton.click();
  }

  return false;
}

async function restoreFieldSource(previousLoad) {
  el.sourceButton.click();
  await delay(50);

  const fieldsButton = Array.from(
    el.sourceMenu?.querySelectorAll("button") || []
  ).find(button => norm(button.textContent) === "fields");

  if (!fieldsButton) {
    if (el.sourceMenu?.classList.contains("open")) {
      el.sourceButton.click();
    }
    return false;
  }

  fieldsButton.click();
  await delay(60);

  const fieldModal = $("loadout-field-source-backdrop");
  if (!fieldModal) return false;

  const wantedFieldId = clean(previousLoad.grainSourceFieldId);
  const wantedFieldName = norm(
    previousLoad.grainSourceFieldName ||
    previousLoad.grainSourceName
  );

  const fieldButton = Array.from(fieldModal.querySelectorAll("button")).find(
    button => {
      const text = norm(button.textContent);
      return (
        (wantedFieldName && text === wantedFieldName) ||
        (wantedFieldId && text.includes(norm(wantedFieldId)))
      );
    }
  );

  if (!fieldButton) return false;

  fieldButton.click();
  return true;
}

async function restoreSource(previousLoad) {
  if (!el.sourceButton || el.sourceButton.disabled) return false;

  const sourceValue = clean(previousLoad.grainSourceValue);
  const sourceScope = norm(previousLoad.grainSourceScope);

  const isField =
    sourceScope === "field" ||
    sourceValue.includes("active_field_harvest:field:");

  if (isField) {
    return restoreFieldSource(previousLoad);
  }

  if (!sourceValue) return false;

  el.sourceButton.click();
  await delay(50);

  const button = findChoice(
    el.sourceMenu,
    "data-source-value",
    sourceValue
  );

  if (button) {
    button.click();
    return true;
  }

  if (el.sourceMenu?.classList.contains("open")) {
    el.sourceButton.click();
  }

  return false;
}

async function restoreDependentFields(previousLoad, jobId) {
  reassertExpectedJob();

  if (clean(el.haulingJob?.value) !== clean(jobId)) {
    return;
  }

  const customerRestored = await restoreCustomer(previousLoad);
  await delay(60);

  reassertExpectedJob();

  const sourceRestored = await restoreSource(previousLoad);
  await delay(100);

  reassertExpectedJob();

  if (customerRestored && sourceRestored) {
    showMessage(
      "Previous load copied: Hauling Job, Sold Under, and Grain Source. Change anything that is different, then assign the load."
    );
  }
  else if (sourceRestored) {
    showMessage(
      "Previous Hauling Job and Grain Source copied. Review Sold Under, then assign the load."
    );
  }
  else {
    showMessage(
      "Previous Hauling Job copied. Review Sold Under and Grain Source before assigning the load."
    );
  }
}

async function applyPreviousRun() {
  const myToken = ++runToken;

  if (!isCreateModal()) return;

  const key = driverKey();
  if (!key) return;

  let snapshot;

  try {
    snapshot = await getDocs(collection(db, "grain_loadouts"));
  }
  catch (error) {
    console.warn("[repeat-run stable defaults] load history read failed", error);
    return;
  }

  if (
    myToken !== runToken ||
    key !== driverKey() ||
    !isCreateModal()
  ) {
    return;
  }

  const previousLoad = latestLoad(
    snapshot.docs.map(docSnapshot => ({
      id: docSnapshot.id,
      ...docSnapshot.data()
    })),
    key
  );

  previousLoadForDriver = previousLoad;
  if (!previousLoad) return;

  const jobId = clean(previousLoad.haulingJobId);
  if (!jobId || !el.haulingJob) return;

  const option = await waitForJobOption(jobId);

  if (
    myToken !== runToken ||
    key !== driverKey() ||
    !isCreateModal()
  ) {
    return;
  }

  if (!option) {
    showMessage(
      "Previous load found, but its hauling job is no longer available. Choose the current hauling job."
    );
    return;
  }

  applyingPreviousRun = true;
  startHaulingJobGuard(jobId);

  /*
    Hauling Job FIRST. This is the one and only change event we fire for it.
    grain-ticket.html is then free to populate Crop / Destination and clear
    dependent controls as part of its normal logic.
  */
  el.haulingJob.value = option.value;
  option.selected = true;

  el.haulingJob.dispatchEvent(
    new Event("change", { bubbles: true })
  );

  await delay(220);
  reassertExpectedJob();

  await restoreDependentFields(previousLoad, jobId);

  applyingPreviousRun = false;
}

function scheduleApply() {
  setTimeout(applyPreviousRun, 140);
}

el.driver?.addEventListener("change", scheduleApply);
el.subdriver?.addEventListener("change", scheduleApply);

/*
  Manual behavior:

  - Different hauling job: do nothing; user choice wins.
  - Same hauling job as previous load: its normal change handler clears
    Grain Source, then we restore Sold Under + Grain Source from the prior run.
*/
el.haulingJob?.addEventListener("change", () => {
  if (!isCreateModal() || !previousLoadForDriver) return;

  const selectedJobId = clean(el.haulingJob.value);
  const previousJobId = clean(previousLoadForDriver.haulingJobId);

  if (!selectedJobId) return;

  if (
    expectedJobId &&
    selectedJobId !== expectedJobId
  ) {
    expectedJobId = "";
    guardUntil = 0;
  }

  if (
    applyingPreviousRun ||
    selectedJobId !== previousJobId
  ) {
    return;
  }

  startHaulingJobGuard(previousJobId);

  setTimeout(
    () => restoreDependentFields(previousLoadForDriver, previousJobId),
    180
  );
});
