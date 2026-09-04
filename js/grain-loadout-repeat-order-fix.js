/* =====================================================================
   FarmVista — Load Out Repeat-Run Order Fix

   Fixes the last repeat-run race on Assign Load:
     1. Driver is selected.
     2. Previous hauling job is restored FIRST.
     3. The page is allowed to apply Crop / Destination / Sold Under rules.
     4. Previous Sold Under is restored.
     5. Previous Grain Source is restored LAST.

   The page intentionally clears Grain Source whenever Hauling Job changes.
   Therefore Grain Source must never be restored before the hauling-job
   change has completely finished.

   This module also protects the selected hauling job from a late render
   clearing the SELECT after the other fields were already restored.
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
  customer: $("loadout-customer"),
  customerButton: $("loadout-customer-button"),
  customerMenu: $("loadout-customer-menu"),
  source: $("loadout-source"),
  sourceButton: $("loadout-source-button"),
  sourceMenu: $("loadout-source-menu"),
  message: $("loadout-form-message")
};

let token = 0;
let currentPreviousLoad = null;
let applying = false;

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
  const date = new Date(value || 0);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function isCreateModal() {
  return Boolean(
    el.backdrop?.classList.contains("open") &&
    norm(el.modalTitle?.textContent) === "assign load"
  );
}

function driverKey() {
  const value = clean(el.driver?.value);

  if (value.startsWith("emp:")) return value;

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
  el.message.textContent = text;
  el.message.className = "loadout-form-message show good";
}

function exactOption(select, value) {
  const wanted = clean(value);
  return Array.from(select?.options || []).find(
    option => clean(option.value) === wanted
  ) || null;
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
  await delay(40);

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

async function restoreSource(previousLoad) {
  if (!el.sourceButton || el.sourceButton.disabled) return false;

  const sourceValue = clean(previousLoad.grainSourceValue);
  const sourceScope = norm(previousLoad.grainSourceScope);
  const isField =
    sourceScope === "field" ||
    sourceValue.includes("active_field_harvest:field:");

  if (isField) {
    el.sourceButton.click();
    await delay(40);

    const fieldsButton = Array.from(
      el.sourceMenu?.querySelectorAll("button") || []
    ).find(button => norm(button.textContent) === "fields");

    if (!fieldsButton) {
      if (el.sourceMenu?.classList.contains("open")) el.sourceButton.click();
      return false;
    }

    fieldsButton.click();
    await delay(50);

    const fieldModal = $("loadout-field-source-backdrop");
    if (!fieldModal) return false;

    const wantedFieldId = clean(previousLoad.grainSourceFieldId);
    const wantedFieldName = norm(
      previousLoad.grainSourceFieldName || previousLoad.grainSourceName
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

  if (!sourceValue) return false;

  el.sourceButton.click();
  await delay(40);

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

async function restoreCustomerAndSource(previousLoad, expectedJobId) {
  if (!isCreateModal()) return;
  if (clean(el.haulingJob?.value) !== clean(expectedJobId)) return;

  const customerRestored = await restoreCustomer(previousLoad);
  await delay(50);

  if (clean(el.haulingJob?.value) !== clean(expectedJobId)) {
    /*
      A late page render cleared the SELECT. Reassert only the value;
      DO NOT fire change again because change intentionally clears source.
    */
    if (exactOption(el.haulingJob, expectedJobId)) {
      el.haulingJob.value = expectedJobId;
    }
  }

  const sourceRestored = await restoreSource(previousLoad);
  await delay(120);

  /* Final stabilization after every page listener/render has run. */
  if (
    isCreateModal() &&
    exactOption(el.haulingJob, expectedJobId)
  ) {
    el.haulingJob.value = expectedJobId;
  }

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
}

async function applyPreviousRun() {
  const myToken = ++token;

  if (!isCreateModal()) return;

  const key = driverKey();
  if (!key) return;

  let snapshot;
  try {
    snapshot = await getDocs(collection(db, "grain_loadouts"));
  }
  catch (error) {
    console.warn("[repeat-run order fix] load history read failed", error);
    return;
  }

  if (myToken !== token || key !== driverKey() || !isCreateModal()) return;

  const previousLoad = latestLoad(
    snapshot.docs.map(docSnapshot => ({
      id: docSnapshot.id,
      ...docSnapshot.data()
    })),
    key
  );

  currentPreviousLoad = previousLoad;
  if (!previousLoad) return;

  const jobId = clean(previousLoad.haulingJobId);
  if (!jobId || !el.haulingJob) return;

  /*
    Let the page and the older repeat module finish their work first.
    Then this fix owns the FINAL field order.
  */
  await delay(220);

  if (myToken !== token || key !== driverKey() || !isCreateModal()) return;

  const option = exactOption(el.haulingJob, jobId);
  if (!option) {
    showMessage(
      "Previous load found, but its hauling job is no longer available. Choose the current hauling job."
    );
    return;
  }

  applying = true;

  /* Hauling Job FIRST. Its normal change handler may clear source. */
  el.haulingJob.value = jobId;
  el.haulingJob.dispatchEvent(new Event("change", { bubbles: true }));

  await delay(120);

  /* Guard against a late render blanking the select. No second change. */
  if (exactOption(el.haulingJob, jobId)) {
    el.haulingJob.value = jobId;
  }

  await restoreCustomerAndSource(previousLoad, jobId);

  applying = false;
}

function scheduleApply() {
  setTimeout(applyPreviousRun, 120);
}

el.driver?.addEventListener("change", scheduleApply);
el.subdriver?.addEventListener("change", scheduleApply);

/*
  If the dispatcher manually chooses the SAME hauling job that was on the
  driver's previous load, the page correctly clears Grain Source first.
  Restore the matching previous Sold Under + Grain Source immediately after
  that normal change completes. Different hauling jobs are left untouched.
*/
el.haulingJob?.addEventListener("change", () => {
  if (applying || !isCreateModal() || !currentPreviousLoad) return;

  const selectedJobId = clean(el.haulingJob.value);
  const previousJobId = clean(currentPreviousLoad.haulingJobId);

  if (!selectedJobId || selectedJobId !== previousJobId) return;

  setTimeout(
    () => restoreCustomerAndSource(currentPreviousLoad, previousJobId),
    120
  );
});
