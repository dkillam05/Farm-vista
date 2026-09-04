/* =====================================================================
   FarmVista — Load Out Repeat-Run Defaults

   Reuses the selected driver's most recent load setup on a NEW load:
     1. Hauling Job
     2. Sold Under / Customer
     3. Grain Source

   IMPORTANT:
   The Hauling Job SELECT is rebuilt by grain-ticket.html in several places.
   This module therefore restores BOTH the selected value AND the option text.
   That prevents the browser from showing a blank/placeholder hauling-job
   field even when the correct haulingJobId is already selected.
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

/*
  Dark-theme tune for the Load Out / Dispatch table.
  The light-mode row fills are intentionally pale, but in dark mode they made
  the inherited light text nearly disappear. Keep the same status meaning
  while using dark translucent fills, matching the Grain Tickets table.

  Also hide the temporary dropdown/modal surfaces that are opened by code
  while restoring a driver's previous load. Their click handlers still run,
  but the user only sees the finished field values instead of rapid flashes.
*/
(function installLoadoutDarkThemeFix() {
  if (document.getElementById("fv-loadout-dark-theme-fix")) return;

  const style = document.createElement("style");
  style.id = "fv-loadout-dark-theme-fix";
  style.textContent = `
    html.dark .loadout-table,
    html[data-theme="dark"] .loadout-table {
      color: var(--text);
    }

    html.dark .loadout-row-open,
    html[data-theme="dark"] .loadout-row-open {
      background: var(--surface);
      color: var(--text);
    }

    html.dark .loadout-row-missing,
    html[data-theme="dark"] .loadout-row-missing {
      background: rgba(201, 68, 77, .16);
      color: var(--text);
    }

    html.dark .loadout-row-linked,
    html[data-theme="dark"] .loadout-row-linked {
      background: rgba(47, 108, 60, .20);
      color: var(--text);
    }

    html.dark .loadout-row-preload,
    html[data-theme="dark"] .loadout-row-preload {
      background: rgba(70, 158, 208, .18);
      color: var(--text);
    }

    html.dark .loadout-table td,
    html[data-theme="dark"] .loadout-table td,
    html.dark .loadout-number,
    html[data-theme="dark"] .loadout-number {
      color: var(--text);
    }

    html.fv-loadout-silent-preload #loadout-customer-menu,
    html.fv-loadout-silent-preload #loadout-source-menu,
    html.fv-loadout-silent-preload #loadout-field-source-backdrop {
      visibility: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
      transition: none !important;
      animation: none !important;
    }
  `;

  document.head.appendChild(style);
})();

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

let token = 0;
let pinnedJobId = "";
let pinnedJob = null;
let pinnedLoad = null;
let applying = false;
let pinTimer = null;

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

function latestLoadForDriver(loads, key) {
  return loads
    .filter(load => loadMatchesDriver(load, key))
    .sort((a, b) =>
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

function setSilentPreload(active) {
  document.documentElement.classList.toggle("fv-loadout-silent-preload", Boolean(active));
}

function stopPinTimer() {
  if (pinTimer) clearInterval(pinTimer);
  pinTimer = null;
}

/*
  Repeat data belongs to ONE driver only. Whenever the driver changes, clear
  every reference to the previously selected driver's load before doing any
  new lookup. This prevents a manually selected hauling job from reviving the
  prior driver's Sold Under / Grain Source values.
*/
function clearPinnedRepeatState() {
  pinnedJobId = "";
  pinnedJob = null;
  pinnedLoad = null;
  applying = false;
  stopPinTimer();
  setSilentPreload(false);
  showGood("");
}

/*
  A driver change is a fresh load setup. Clear the visible hauling-job choice
  and let grain-ticket.html's normal hauling-job change handler reset Crop,
  Destination, Sold Under and Grain Source to their standard defaults.

  This is intentionally separate from clearPinnedRepeatState(): clearing our
  cached repeat data alone does not clear values already rendered in the form.
*/
function resetVisibleDriverDefaults() {
  if (!isCreateModal() || !el.haulingJob) return;

  const blankIndex = Array.from(el.haulingJob.options || [])
    .findIndex(option => clean(option.value) === "");

  el.haulingJob.value = "";
  if (blankIndex >= 0) el.haulingJob.selectedIndex = blankIndex;

  el.haulingJob.dispatchEvent(
    new Event("change", { bubbles: true })
  );
}

/*
  The saved load already stores haulingJobName/haulingJobLabel. Use that
  FIRST. The old code rebuilt a generic destination/crop label instead of
  restoring the actual hauling-job name, which is why the value could be
  correct while the visible text was wrong or blank.
*/
function haulingJobLabel(job, previousLoad) {
  const explicitName = clean(
    job?.jobName ||
    job?.displayName ||
    job?.name ||
    previousLoad?.haulingJobName ||
    previousLoad?.haulingJobLabel
  );

  if (explicitName) return explicitName;

  const buyer = clean(job?.buyerName || previousLoad?.buyerName);
  const destination = clean(
    job?.deliveryLocationName ||
    job?.destinationName ||
    previousLoad?.deliveryLocationName ||
    previousLoad?.destinationName
  );
  const crop = clean(job?.crop || job?.commodity || previousLoad?.crop);

  const location = [buyer, destination]
    .filter(Boolean)
    .filter((value, index, array) =>
      index === 0 || norm(value) !== norm(array[index - 1])
    )
    .join(" — ");

  return [location, crop].filter(Boolean).join(" • ") || "Previous hauling job";
}

/*
  Critical rendering fix:
  - create the option if the page removed it;
  - ALWAYS refresh its visible text, even when the option already exists;
  - explicitly select the exact option.
*/
function ensureJobOption(jobId, job = pinnedJob, previousLoad = pinnedLoad) {
  if (!el.haulingJob || !jobId) return null;

  let option = Array.from(el.haulingJob.options || [])
    .find(item => clean(item.value) === clean(jobId)) || null;

  if (!option) {
    option = document.createElement("option");
    option.value = jobId;
    option.dataset.fvRepeatInjected = "1";
    el.haulingJob.appendChild(option);
  }

  const label = haulingJobLabel(job, previousLoad);
  option.textContent = label;
  option.label = label;
  option.hidden = false;
  option.disabled = false;

  return option;
}

function forcePinnedJob() {
  if (!pinnedJobId || !pinnedLoad || !el.haulingJob || !isCreateModal()) return false;

  const option = ensureJobOption(pinnedJobId);
  if (!option) return false;

  Array.from(el.haulingJob.options || []).forEach(item => {
    item.selected = clean(item.value) === pinnedJobId;
  });

  el.haulingJob.value = pinnedJobId;
  el.haulingJob.selectedIndex = Array.from(el.haulingJob.options || [])
    .findIndex(item => clean(item.value) === pinnedJobId);

  return clean(el.haulingJob.value) === pinnedJobId;
}

function startPinTimer() {
  stopPinTimer();

  pinTimer = setInterval(() => {
    if (!isCreateModal() || !pinnedJobId || !pinnedLoad) {
      stopPinTimer();
      return;
    }

    const current = clean(el.haulingJob?.value);

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

    const fieldsButton = Array.from(el.sourceMenu?.querySelectorAll("button") || [])
      .find(button => norm(button.textContent) === "fields") || null;

    if (!fieldsButton) {
      if (el.sourceMenu?.classList.contains("open")) el.sourceButton.click();
      return false;
    }

    fieldsButton.click();
    await delay(70);

    const fieldModal = $("loadout-field-source-backdrop");
    if (!fieldModal) return false;

    const wantedId = clean(previousLoad.grainSourceFieldId);
    const wantedName = norm(
      previousLoad.grainSourceFieldName || previousLoad.grainSourceName
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
  const myToken = ++token;
  const key = driverKey();

  /* Never carry repeat state across drivers, even if the next driver has no history. */
  clearPinnedRepeatState();

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

  if (myToken !== token || key !== driverKey() || !isCreateModal()) return;

  const previousLoad = latestLoadForDriver(
    loadSnapshot.docs.map(snapshot => ({
      id: snapshot.id,
      ...snapshot.data()
    })),
    key
  );

  /* No history for this driver means the freshly reset defaults stay in place. */
  if (!previousLoad) return;

  const jobId = clean(previousLoad.haulingJobId);
  if (!jobId) return;

  const job = jobSnapshot.docs
    .map(snapshot => ({ id: snapshot.id, ...snapshot.data() }))
    .find(item => clean(item.id) === jobId) || null;

  pinnedJobId = jobId;
  pinnedJob = job;
  pinnedLoad = previousLoad;
  applying = true;
  setSilentPreload(true);

  try {
    await delay(180);

    if (myToken !== token || key !== driverKey() || !isCreateModal()) return;

    if (!forcePinnedJob()) return;

    startPinTimer();

    /* Let the main page populate crop/destination from the selected job. */
    el.haulingJob.dispatchEvent(new Event("change", { bubbles: true }));

    await delay(250);
    forcePinnedJob();

    await restoreCustomer(previousLoad);
    await delay(100);
    forcePinnedJob();

    await restoreSource(previousLoad);
    await delay(150);
    forcePinnedJob();

    showGood("Data copied from previous load.");
  }
  finally {
    applying = false;
    setSilentPreload(false);
  }
}

function scheduleApply() {
  /*
    Changing Driver means start from the normal blank load-out state first.
    Then, and only then, apply that newly selected driver's own previous load
    if one exists.
  */
  token += 1;
  clearPinnedRepeatState();
  resetVisibleDriverDefaults();
  setTimeout(applyPreviousRun, 100);
}

/* Prevent the page's legacy customer-change listener from blanking a job only
   while we are actively restoring THIS driver's previous load. */
el.customer?.addEventListener(
  "change",
  event => {
    if (isCreateModal() && pinnedJobId && pinnedLoad) {
      event.stopImmediatePropagation();
      forcePinnedJob();
    }
  },
  true
);

el.driver?.addEventListener("change", scheduleApply);
el.subdriver?.addEventListener("change", scheduleApply);

/* Manual hauling-job choice always wins. It must never trigger a previous
   driver's customer/source data when the current driver has no repeat state. */
el.haulingJob?.addEventListener("change", event => {
  const selected = clean(el.haulingJob?.value);

  if (
    event.isTrusted &&
    !applying &&
    selected &&
    selected !== pinnedJobId
  ) {
    clearPinnedRepeatState();
    return;
  }

  if (!applying && pinnedJobId && pinnedLoad && selected === pinnedJobId) {
    setTimeout(async () => {
      /* Confirm this repeat state still belongs to the currently selected driver. */
      if (!pinnedLoad || !loadMatchesDriver(pinnedLoad, driverKey())) return;

      setSilentPreload(true);
      try {
        forcePinnedJob();
        await restoreCustomer(pinnedLoad);
        await restoreSource(pinnedLoad);
        forcePinnedJob();
      }
      finally {
        setSilentPreload(false);
      }
    }, 180);
  }
});
