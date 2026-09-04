/* =====================================================================
   FarmVista — Load Out Repeat-Run Defaults

   Restore the selected driver's most recent operational setup in a stable
   order and keep the Hauling Job SELECT from visually falling back to blank.

   Order:
     1. Driver
     2. Hauling Job
     3. Sold Under / Customer
     4. Grain Source LAST

   The main page intentionally clears dependent fields when Hauling Job
   changes. This module therefore restores the source only after the hauling
   job has settled, and recreates the hauling-job option if a later page render
   removes it from the SELECT while the job itself is still valid.
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

let token = 0;
let activePreviousLoad = null;
let activePreviousJob = null;
let applying = false;
let stabilizerTimer = null;

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
    return (
      clean(load.driverSubcontractorId) === clean(parts[1]) &&
      clean(load.driverSubcontractorDriverId) === clean(parts.slice(2).join(":"))
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

function jobLabel(job, previousLoad) {
  const destination = clean(
    job?.deliveryLocationName ||
    job?.destinationName ||
    job?.buyerName ||
    previousLoad?.destinationName ||
    previousLoad?.deliveryLocationName
  );

  const crop = clean(job?.crop || job?.commodity || previousLoad?.crop);
  const bushels = Number(
    job?.startingBushels ??
    job?.jobBushels ??
    job?.bushels ??
    previousLoad?.haulingJobBushels ??
    0
  );

  const parts = [];
  if (destination) parts.push(destination);
  if (crop) parts.push(crop);
  if (Number.isFinite(bushels) && bushels > 0) {
    parts.push(`${bushels.toLocaleString("en-US")} bu`);
  }

  return parts.join(" — ") || "Previous hauling job";
}

function ensureJobOption(jobId, job, previousLoad) {
  if (!el.haulingJob || !jobId) return null;

  let option = Array.from(el.haulingJob.options || [])
    .find(item => clean(item.value) === clean(jobId)) || null;

  if (!option) {
    option = document.createElement("option");
    option.value = jobId;
    option.textContent = jobLabel(job, previousLoad);
    option.dataset.fvRepeatInjected = "1";
    el.haulingJob.appendChild(option);
  }

  return option;
}

function forceJobSelected(jobId, job, previousLoad) {
  const option = ensureJobOption(jobId, job, previousLoad);
  if (!option || !el.haulingJob) return false;

  el.haulingJob.value = option.value;

  Array.from(el.haulingJob.options || []).forEach(item => {
    item.selected = item === option;
  });

  return clean(el.haulingJob.value) === clean(jobId);
}

function findChoice(container, attribute, value) {
  const wanted = clean(value);
  if (!container || !wanted) return null;

  return Array.from(container.querySelectorAll(`[${attribute}]`))
    .find(button => clean(button.getAttribute(attribute)) === wanted) || null;
}

async function restoreCustomer(previousLoad) {
  if (!el.customerButton || el.customerButton.disabled) return false;

  const customerValue =
    clean(previousLoad.customerId) ||
    (norm(previousLoad.customerName) === "unknown" ? "__unknown__" : "");

  if (!customerValue) return false;

  el.customerButton.click();
  await delay(60);

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
    await delay(60);

    const fieldsButton = Array.from(
      el.sourceMenu?.querySelectorAll("button") || []
    ).find(button => norm(button.textContent) === "fields");

    if (!fieldsButton) {
      if (el.sourceMenu?.classList.contains("open")) el.sourceButton.click();
      return false;
    }

    fieldsButton.click();
    await delay(70);

    const fieldModal = $("loadout-field-source-backdrop");
    if (!fieldModal) return false;

    const wantedFieldId = clean(previousLoad.grainSourceFieldId);
    const wantedFieldName = norm(
      previousLoad.grainSourceFieldName || previousLoad.grainSourceName
    );

    const fieldButton = Array.from(fieldModal.querySelectorAll("button"))
      .find(button => {
        const text = norm(button.textContent);
        return (
          (wantedFieldName && text === wantedFieldName) ||
          (wantedFieldId && text.includes(norm(wantedFieldId)))
        );
      }) || null;

    if (!fieldButton) return false;
    fieldButton.click();
    return true;
  }

  if (!sourceValue) return false;

  el.sourceButton.click();
  await delay(60);

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

function startJobStabilizer(jobId, job, previousLoad, myToken, key) {
  if (stabilizerTimer) {
    clearInterval(stabilizerTimer);
    stabilizerTimer = null;
  }

  const started = Date.now();

  stabilizerTimer = setInterval(() => {
    if (
      myToken !== token ||
      key !== driverKey() ||
      !isCreateModal() ||
      Date.now() - started > 3000
    ) {
      clearInterval(stabilizerTimer);
      stabilizerTimer = null;
      return;
    }

    /*
      During autofill only, if the page rebuilds the SELECT and drops the
      previous hauling job, put that exact option back and keep it selected.
      A real manual change to another nonblank job is never overwritten.
    */
    const current = clean(el.haulingJob?.value);

    if (!current || current === jobId) {
      forceJobSelected(jobId, job, previousLoad);
    }
  }, 100);
}

async function applyPreviousRun() {
  const myToken = ++token;
  const key = driverKey();

  if (!isCreateModal() || !key) return;

  let loadSnapshot;
  let jobSnapshot;

  try {
    [loadSnapshot, jobSnapshot] = await Promise.all([
      getDocs(collection(db, "grain_loadouts")),
      getDocs(collection(db, "grain_hauling_jobs"))
    ]);
  }
  catch (error) {
    console.warn("[repeat-run] history read failed", error);
    return;
  }

  if (myToken !== token || key !== driverKey() || !isCreateModal()) return;

  const previousLoad = latestLoad(
    loadSnapshot.docs.map(docSnapshot => ({
      id: docSnapshot.id,
      ...docSnapshot.data()
    })),
    key
  );

  if (!previousLoad) return;

  const jobId = clean(previousLoad.haulingJobId);
  if (!jobId) return;

  const job = jobSnapshot.docs
    .map(docSnapshot => ({ id: docSnapshot.id, ...docSnapshot.data() }))
    .find(item => clean(item.id) === jobId) || null;

  activePreviousLoad = previousLoad;
  activePreviousJob = job;
  applying = true;

  /* Give the main page's driver-change render a moment to finish. */
  await delay(180);

  if (myToken !== token || key !== driverKey() || !isCreateModal()) {
    applying = false;
    return;
  }

  if (!forceJobSelected(jobId, job, previousLoad)) {
    applying = false;
    return;
  }

  startJobStabilizer(jobId, job, previousLoad, myToken, key);

  /* Fire the page's normal hauling-job logic exactly once. */
  el.haulingJob.dispatchEvent(new Event("change", { bubbles: true }));

  await delay(250);
  forceJobSelected(jobId, job, previousLoad);

  const customerRestored = await restoreCustomer(previousLoad);
  await delay(100);
  forceJobSelected(jobId, job, previousLoad);

  const sourceRestored = await restoreSource(previousLoad);
  await delay(150);
  forceJobSelected(jobId, job, previousLoad);

  applying = false;

  if (customerRestored && sourceRestored) {
    showMessage(
      "Previous load copied. Hauling Job, Sold Under, and Grain Source are ready; change anything that is different."
    );
  }
  else {
    showMessage(
      "Previous hauling job copied. Review any field that could not be reused, then assign the load."
    );
  }
}

function scheduleApply() {
  setTimeout(applyPreviousRun, 100);
}

el.driver?.addEventListener("change", scheduleApply);
el.subdriver?.addEventListener("change", scheduleApply);

/*
  If the dispatcher manually reselects the SAME prior hauling job, the page
  clears Grain Source by design. Put the prior customer/source back afterward.
  A different hauling job is a genuine user change and is left alone.
*/
el.haulingJob?.addEventListener("change", () => {
  if (applying || !isCreateModal() || !activePreviousLoad) return;

  const selected = clean(el.haulingJob.value);
  const previousJobId = clean(activePreviousLoad.haulingJobId);

  if (!selected || selected !== previousJobId) return;

  setTimeout(async () => {
    forceJobSelected(previousJobId, activePreviousJob, activePreviousLoad);
    await restoreCustomer(activePreviousLoad);
    await restoreSource(activePreviousLoad);
    forceJobSelected(previousJobId, activePreviousJob, activePreviousLoad);
  }, 180);
});
