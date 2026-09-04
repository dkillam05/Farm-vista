/* =====================================================================
   FarmVista — Load Out Repeat-Run Defaults

   PURPOSE
   When a driver is selected on a NEW load, reuse that driver's most recent
   operational setup, even across calendar days:
     1. Hauling Job
     2. Sold Under / Customer
     3. Grain Source

   IMPORTANT ROOT FIX
   grain-ticket.html still contains a legacy customer change listener that
   clears the Hauling Job and rebuilds the hauling-job SELECT. Sold Under is
   downstream of Hauling Job, so changing/restoring Sold Under must NEVER
   clear the selected hauling job.

   This module blocks that legacy clear only while the Assign Load create
   modal has a hauling job selected/pinned. It also keeps the exact previous
   hauling job selected for the life of the open create modal unless the user
   manually chooses a different hauling job.
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
  sourceButton: $("loadout-source-button"),
  sourceMenu: $("loadout-source-menu"),
  message: $("loadout-form-message")
};

let applyToken = 0;
let pinnedJobId = "";
let pinnedJob = null;
let pinnedLoad = null;
let pinTimer = null;
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

    return (
      clean(load.driverSubcontractorId) === clean(parts[1]) &&
      clean(load.driverSubcontractorDriverId) ===
        clean(parts.slice(2).join(":"))
    );
  }

  return false;
}

function latestLoadForDriver(loads, key) {
  return loads
    .filter(load => loadMatchesDriver(load, key))
    .sort(
      (a, b) =>
        millis(b.loadedAt || b.createdAt || b.updatedAt) -
        millis(a.loadedAt || a.createdAt || a.updatedAt)
    )[0] || null;
}

function showGood(text) {
  if (!el.message) return;

  el.message.textContent = text || "";
  el.message.className = text
    ? "loadout-form-message show good"
    : "loadout-form-message";
}

function haulingJobLabel(job, previousLoad) {
  const buyer = clean(
    job?.buyerName ||
    previousLoad?.buyerName
  );

  const destination = clean(
    job?.deliveryLocationName ||
    job?.destinationName ||
    previousLoad?.deliveryLocationName ||
    previousLoad?.destinationName
  );

  const crop = clean(
    job?.crop ||
    job?.commodity ||
    previousLoad?.crop
  );

  const bushels = Number(
    job?.startingBushels ??
    job?.jobBushels ??
    job?.bushels ??
    previousLoad?.haulingJobBushels ??
    0
  );

  const location = [buyer, destination]
    .filter(Boolean)
    .filter((value, index, array) =>
      index === 0 || norm(value) !== norm(array[index - 1])
    )
    .join(" — ");

  const parts = [];
  if (location) parts.push(location);
  if (crop) parts.push(crop);

  if (Number.isFinite(bushels) && bushels > 0) {
    parts.push(`${bushels.toLocaleString("en-US")} bu`);
  }

  return parts.join(" • ") || "Previous hauling job";
}

function ensureJobOption(jobId, job = pinnedJob, previousLoad = pinnedLoad) {
  if (!el.haulingJob || !jobId) return null;

  let option = Array.from(el.haulingJob.options || [])
    .find(item => clean(item.value) === clean(jobId)) || null;

  if (!option) {
    option = document.createElement("option");
    option.value = jobId;
    option.textContent = haulingJobLabel(job, previousLoad);
    option.dataset.fvRepeatInjected = "1";
    el.haulingJob.appendChild(option);
  }

  return option;
}

function forcePinnedJob() {
  if (!pinnedJobId || !el.haulingJob || !isCreateModal()) {
    return false;
  }

  const option = ensureJobOption(pinnedJobId);
  if (!option) return false;

  el.haulingJob.value = pinnedJobId;

  Array.from(el.haulingJob.options || []).forEach(item => {
    item.selected = item === option;
  });

  return clean(el.haulingJob.value) === pinnedJobId;
}

function stopPinTimer() {
  if (pinTimer) {
    clearInterval(pinTimer);
    pinTimer = null;
  }
}

function startPinTimer() {
  stopPinTimer();

  pinTimer = setInterval(() => {
    if (!isCreateModal() || !pinnedJobId) {
      stopPinTimer();
      return;
    }

    const current = clean(el.haulingJob?.value);

    /*
      Only repair a blank select or the already-pinned selection.
      A real different selection is never overwritten.
    */
    if (!current || current === pinnedJobId) {
      forcePinnedJob();
    }
  }, 100);
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
    forcePinnedJob();
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
    ).find(button => norm(button.textContent) === "fields") || null;

    if (!fieldsButton) {
      if (el.sourceMenu?.classList.contains("open")) {
        el.sourceButton.click();
      }
      return false;
    }

    fieldsButton.click();
    await delay(70);

    const fieldModal = $("loadout-field-source-backdrop");
    if (!fieldModal) return false;

    const wantedId = clean(previousLoad.grainSourceFieldId);
    const wantedName = norm(
      previousLoad.grainSourceFieldName ||
      previousLoad.grainSourceName
    );

    const fieldButton = Array.from(fieldModal.querySelectorAll("button"))
      .find(button => {
        const text = norm(button.textContent);

        return (
          (wantedName && text === wantedName) ||
          (wantedId && text.includes(norm(wantedId)))
        );
      }) || null;

    if (!fieldButton) return false;

    fieldButton.click();
    forcePinnedJob();
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
    forcePinnedJob();
    return true;
  }

  if (el.sourceMenu?.classList.contains("open")) {
    el.sourceButton.click();
  }

  return false;
}

async function applyPreviousRun() {
  const myToken = ++applyToken;
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
    console.warn("[grain repeat-run] history read failed:", error);
    return;
  }

  if (
    myToken !== applyToken ||
    key !== driverKey() ||
    !isCreateModal()
  ) {
    return;
  }

  const previousLoad = latestLoadForDriver(
    loadSnapshot.docs.map(snapshot => ({
      id: snapshot.id,
      ...snapshot.data()
    })),
    key
  );

  if (!previousLoad) return;

  const jobId = clean(previousLoad.haulingJobId);
  if (!jobId) return;

  const job = jobSnapshot.docs
    .map(snapshot => ({
      id: snapshot.id,
      ...snapshot.data()
    }))
    .find(item => clean(item.id) === jobId) || null;

  pinnedJobId = jobId;
  pinnedJob = job;
  pinnedLoad = previousLoad;
  applying = true;

  /* Let the page finish its driver-change rendering first. */
  await delay(180);

  if (
    myToken !== applyToken ||
    key !== driverKey() ||
    !isCreateModal()
  ) {
    applying = false;
    return;
  }

  if (!forcePinnedJob()) {
    applying = false;
    return;
  }

  startPinTimer();

  /*
    Hauling Job FIRST. This intentionally lets the main page populate Crop,
    Destination, and its dependent controls from the selected job.
  */
  el.haulingJob.dispatchEvent(
    new Event("change", { bubbles: true })
  );

  await delay(250);
  forcePinnedJob();

  const customerRestored = await restoreCustomer(previousLoad);

  await delay(100);
  forcePinnedJob();

  const sourceRestored = await restoreSource(previousLoad);

  await delay(150);
  forcePinnedJob();

  applying = false;

  if (customerRestored && sourceRestored) {
    showGood(
      "Previous load copied. Hauling Job, Sold Under, and Grain Source are ready; change anything that is different."
    );
  }
  else {
    showGood(
      "Previous hauling job copied. Review any field that could not be reused, then assign the load."
    );
  }
}

function scheduleApply() {
  setTimeout(applyPreviousRun, 100);
}

/* ============================================================
   ROOT BUG GUARD

   grain-ticket.html has a legacy listener:

     customer change -> haulingJob.value = "" -> loRenderHaulingJobs()

   Sold Under is DOWNSTREAM from Hauling Job. Prevent that legacy listener
   from clearing a valid hauling job during Assign Load. Capture phase is
   used so this runs before the old bubble listener, regardless of which
   script registered first.
============================================================ */
el.customer?.addEventListener(
  "change",
  event => {
    if (
      isCreateModal() &&
      (pinnedJobId || clean(el.haulingJob?.value))
    ) {
      event.stopImmediatePropagation();
      forcePinnedJob();
    }
  },
  true
);

el.driver?.addEventListener("change", scheduleApply);
el.subdriver?.addEventListener("change", scheduleApply);

/*
  Manual hauling-job choice always wins.

  Synthetic change = repeat-run applying the old job.
  Trusted change = dispatcher actually touched the dropdown.
*/
el.haulingJob?.addEventListener("change", event => {
  const selected = clean(el.haulingJob?.value);

  if (
    event.isTrusted &&
    !applying &&
    selected &&
    selected !== pinnedJobId
  ) {
    pinnedJobId = "";
    pinnedJob = null;
    pinnedLoad = null;
    stopPinTimer();
    return;
  }

  if (
    !applying &&
    pinnedJobId &&
    selected === pinnedJobId &&
    pinnedLoad
  ) {
    setTimeout(async () => {
      forcePinnedJob();
      await restoreCustomer(pinnedLoad);
      await restoreSource(pinnedLoad);
      forcePinnedJob();
    }, 180);
  }
});
