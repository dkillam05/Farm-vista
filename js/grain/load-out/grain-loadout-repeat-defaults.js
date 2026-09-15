/* =====================================================================
   FarmVista — Grain Load Out Repeat-Run Defaults

   When a dispatcher selects a driver on a NEW load, copy the operational
   setup from that driver's most recent load:
     • Hauling Job
     • Grain Source

   The hauling-job change handler is the source of truth for:
     • Crop
     • Destination
     • Sold Under / Customer

   Important safety rules:
     • Works across calendar days; the latest load is the source.
     • Never copies Load #, load time, preload date, or ETA.
     • Never changes Edit Load forms.
     • Only restores choices that are still valid/selectable now.
     • Never separately rewrites Sold Under after selecting a hauling job.
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

const elements = {
  backdrop: $("loadout-modal-backdrop"),
  modalTitle: $("loadout-modal-title"),
  driver: $("loadout-driver"),
  subdriver: $("loadout-subdriver"),
  haulingJob: $("loadout-hauling-job"),
  crop: $("loadout-crop"),
  sourceButton: $("loadout-source-button"),
  sourceMenu: $("loadout-source-menu"),
  message: $("loadout-form-message")
};

let applyToken = 0;

function clean(value) {
  return String(value ?? "").trim();
}

function norm(value) {
  return clean(value).toLowerCase();
}

function millis(value) {
  if (value?.toMillis) return value.toMillis();
  if (value?.toDate) return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();

  const parsed = new Date(value || 0);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function modalIsOpenForCreate() {
  return (
    elements.backdrop?.classList.contains("open") &&
    norm(elements.modalTitle?.textContent) === "assign load"
  );
}

function currentDriverKey() {
  const driverValue = clean(elements.driver?.value);

  if (driverValue.startsWith("emp:")) {
    return driverValue;
  }

  if (driverValue.startsWith("sub:")) {
    const subdriverId = clean(elements.subdriver?.value);
    if (!subdriverId) return "";
    return `${driverValue}:${subdriverId}`;
  }

  return "";
}

function loadMatchesDriverKey(load, key) {
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

function latestLoadForDriver(loads, driverKey) {
  return loads
    .filter(load => loadMatchesDriverKey(load, driverKey))
    .sort(
      (a, b) =>
        millis(b.loadedAt || b.createdAt || b.updatedAt) -
        millis(a.loadedAt || a.createdAt || a.updatedAt)
    )[0] || null;
}

function waitFrame() {
  return new Promise(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  );
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function showGoodMessage(text) {
  if (!elements.message) return;
  elements.message.textContent = text;
  elements.message.className = "loadout-form-message show good";
}

function exactHaulingJobOption(jobId) {
  const wanted = clean(jobId);
  if (!wanted || !elements.haulingJob) return null;

  return Array.from(elements.haulingJob.options || []).find(
    option => clean(option.value) === wanted
  ) || null;
}

async function waitForHaulingJobOption(jobId, token, driverKey) {
  const started = Date.now();

  while (Date.now() - started < 3000) {
    if (
      token !== applyToken ||
      driverKey !== currentDriverKey() ||
      !modalIsOpenForCreate()
    ) {
      return null;
    }

    const option = exactHaulingJobOption(jobId);
    if (option) return option;

    await wait(100);
  }

  return null;
}

async function selectHaulingJob(jobId, token, driverKey) {
  const option = await waitForHaulingJobOption(jobId, token, driverKey);
  if (!option || !elements.haulingJob) return false;

  /*
    Match the exact sequence proven in DevTools to work correctly:
      1. Set the native SELECT value.
      2. Mark the matching OPTION selected.
      3. Fire input + change so grain-ticket.html runs its normal
         hauling-job workflow and fills Crop, Destination and Sold Under.
  */
  elements.haulingJob.value = option.value;
  option.selected = true;

  elements.haulingJob.dispatchEvent(
    new Event("input", { bubbles: true })
  );

  elements.haulingJob.dispatchEvent(
    new Event("change", { bubbles: true })
  );

  /*
    Give the page's canonical hauling-job handler time to finish rebuilding
    dependent controls before restoring Grain Source.
  */
  await wait(250);
  await waitFrame();

  if (
    token !== applyToken ||
    driverKey !== currentDriverKey() ||
    !modalIsOpenForCreate()
  ) {
    return false;
  }

  return clean(elements.haulingJob.value) === clean(jobId);
}

function clickChoiceByData(container, attribute, value) {
  const wanted = clean(value);
  if (!container || !wanted) return false;

  const match = Array.from(
    container.querySelectorAll(`[${attribute}]`)
  ).find(button => clean(button.getAttribute(attribute)) === wanted);

  if (!match) return false;
  match.click();
  return true;
}

function cropSlug(value) {
  const crop = norm(value);

  if (crop.includes("soy")) return "soybeans";
  if (crop.includes("corn")) return "corn";
  if (crop.includes("wheat")) return "wheat";
  if (crop.includes("sunflower")) return "sunflowers";

  return crop.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

async function restoreFieldSource(previousLoad) {
  if (!elements.sourceButton || elements.sourceButton.disabled) return false;

  elements.sourceButton.click();
  await waitFrame();

  const fieldsButton = Array.from(
    elements.sourceMenu?.querySelectorAll("button") || []
  ).find(button => norm(button.textContent) === "fields");

  if (!fieldsButton) {
    if (elements.sourceMenu?.classList.contains("open")) {
      elements.sourceButton.click();
    }
    return false;
  }

  fieldsButton.click();
  await waitFrame();

  const fieldModal = $("loadout-field-source-backdrop");
  if (!fieldModal) return false;

  const wantedFieldId = clean(previousLoad.grainSourceFieldId);
  const wantedFieldName = norm(
    previousLoad.grainSourceFieldName || previousLoad.grainSourceName
  );

  const buttons = Array.from(fieldModal.querySelectorAll("button"));

  const fieldButton = buttons.find(button => {
    const text = clean(button.textContent);

    if (wantedFieldName && norm(text) === wantedFieldName) {
      return true;
    }

    return !!(
      wantedFieldId &&
      norm(text).includes(norm(wantedFieldId))
    );
  });

  if (!fieldButton) {
    const closeButton = buttons.find(button =>
      /close|cancel|back/i.test(clean(button.textContent))
    );
    closeButton?.click();
    return false;
  }

  fieldButton.click();
  return true;
}

async function restoreSource(previousLoad) {
  if (!elements.sourceButton || elements.sourceButton.disabled) return false;

  const sourceScope = norm(previousLoad.grainSourceScope);
  const sourceValue = clean(previousLoad.grainSourceValue);

  const isField =
    sourceScope === "field" ||
    sourceValue.includes("active_field_harvest:field:");

  if (isField) {
    return restoreFieldSource(previousLoad);
  }

  if (!sourceValue) return false;

  elements.sourceButton.click();
  await waitFrame();

  let restored = false;

  /*
    Legacy Active Harvest loads were saved as:
      active_field_harvest

    The current picker intentionally stores Active Harvest by crop:
      active_field_harvest:corn
      active_field_harvest:soybeans

    Use the crop already selected by the hauling job to translate the old
    value into the current selectable value. This is the exact mismatch
    confirmed in DevTools on 09/11/2026.
  */
  if (sourceValue === "active_field_harvest") {
    const crop = cropSlug(
      elements.crop?.value ||
      previousLoad.crop ||
      previousLoad.cropName
    );

    if (crop) {
      restored = clickChoiceByData(
        elements.sourceMenu,
        "data-source-value",
        `active_field_harvest:${crop}`
      );
    }
  }

  if (!restored) {
    restored = clickChoiceByData(
      elements.sourceMenu,
      "data-source-value",
      sourceValue
    );
  }

  if (!restored && elements.sourceMenu?.classList.contains("open")) {
    elements.sourceButton.click();
  }

  return restored;
}

async function applyPreviousLoadDefaults() {
  const token = ++applyToken;

  if (!modalIsOpenForCreate()) return;

  const driverKey = currentDriverKey();
  if (!driverKey) return;

  let snapshot;

  try {
    snapshot = await getDocs(collection(db, "grain_loadouts"));
  }
  catch (error) {
    console.warn(
      "[grain loadout repeat defaults] load history could not be read:",
      error
    );
    return;
  }

  if (
    token !== applyToken ||
    driverKey !== currentDriverKey() ||
    !modalIsOpenForCreate()
  ) {
    return;
  }

  const previousLoad = latestLoadForDriver(
    snapshot.docs.map(docSnapshot => ({
      id: docSnapshot.id,
      ...docSnapshot.data()
    })),
    driverKey
  );

  if (!previousLoad) return;

  const previousHaulingJobId = clean(previousLoad.haulingJobId);

  if (!previousHaulingJobId || !elements.haulingJob) return;

  const haulingJobRestored = await selectHaulingJob(
    previousHaulingJobId,
    token,
    driverKey
  );

  if (!haulingJobRestored) {
    showGoodMessage(
      "Previous run found, but that hauling job is no longer available. Choose the current hauling job."
    );
    return;
  }

  const sourceRestored = await restoreSource(previousLoad);

  if (
    token !== applyToken ||
    driverKey !== currentDriverKey() ||
    !modalIsOpenForCreate()
  ) {
    return;
  }

  if (sourceRestored) {
    showGoodMessage(
      "Previous load for this driver copied. Change anything that is different, then assign the new load."
    );
  }
  else {
    showGoodMessage(
      "Previous route copied. The prior grain source is not currently available, so choose the current source."
    );
  }
}

function scheduleApply() {
  /*
    Let grain-ticket.html finish its own driver/subdriver rendering first.
    selectHaulingJob() also waits for the exact job option to exist, so this
    no longer depends on one fragile render-time guess.
  */
  setTimeout(applyPreviousLoadDefaults, 75);
}

if (elements.driver && !elements.driver.dataset.fvRepeatDefaultsWired) {
  elements.driver.dataset.fvRepeatDefaultsWired = "1";
  elements.driver.addEventListener("change", scheduleApply);
}

if (elements.subdriver && !elements.subdriver.dataset.fvRepeatDefaultsWired) {
  elements.subdriver.dataset.fvRepeatDefaultsWired = "1";
  elements.subdriver.addEventListener("change", scheduleApply);
}
