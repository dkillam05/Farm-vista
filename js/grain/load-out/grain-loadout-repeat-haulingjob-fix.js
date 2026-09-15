/* =====================================================================
   FarmVista — Repeat Load Hauling Job Restore Guard

   Companion to grain-loadout-repeat-defaults.js.

   The repeat-run helper correctly restores Crop, Destination, Sold Under,
   and Grain Source, but the page's existing customer/render cycle can clear
   the hauling-job SELECT after those values are restored. That leaves the
   visible form looking complete except for "Select hauling job".

   This guard reasserts ONLY the previous hauling-job ID when:
     • Assign Load is open in CREATE mode
     • the dispatcher just selected a driver
     • the hauling-job control is still blank
     • that exact previous hauling job is still present in today's dropdown

   It never overwrites a hauling job the dispatcher manually selected.
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
  haulingJob: $("loadout-hauling-job")
};

let restoreToken = 0;

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

function modalIsCreate() {
  return (
    elements.backdrop?.classList.contains("open") &&
    norm(elements.modalTitle?.textContent) === "assign load"
  );
}

function currentDriverKey() {
  const value = clean(elements.driver?.value);

  if (value.startsWith("emp:")) {
    return value;
  }

  if (value.startsWith("sub:")) {
    const subdriverId = clean(elements.subdriver?.value);
    return subdriverId ? `${value}:${subdriverId}` : "";
  }

  return "";
}

function loadMatchesDriver(load, driverKey) {
  if (!load || !driverKey) return false;

  if (driverKey.startsWith("emp:")) {
    return (
      clean(load.driverEmployeeId) ===
      clean(driverKey.slice(4))
    );
  }

  if (driverKey.startsWith("sub:")) {
    const parts = driverKey.split(":");
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
    .filter(load => loadMatchesDriver(load, driverKey))
    .sort((a, b) =>
      millis(b.loadedAt || b.createdAt || b.updatedAt) -
      millis(a.loadedAt || a.createdAt || a.updatedAt)
    )[0] || null;
}

function exactJobOption(jobId) {
  if (!elements.haulingJob || !jobId) return null;

  return Array.from(elements.haulingJob.options || [])
    .find(option => clean(option.value) === clean(jobId)) || null;
}

function reassertIfBlank(jobId, driverKey, token) {
  if (
    token !== restoreToken ||
    !modalIsCreate() ||
    driverKey !== currentDriverKey() ||
    !elements.haulingJob ||
    clean(elements.haulingJob.value)
  ) {
    return;
  }

  const option = exactJobOption(jobId);

  if (!option) {
    return;
  }

  /*
    Direct assignment is intentional.

    Do NOT dispatch another change event here. The original repeat helper
    already applied the hauling job and filled Crop / Destination / Customer /
    Grain Source. Another change event would rebuild those controls again.
  */
  elements.haulingJob.value = option.value;
  option.selected = true;

  console.log(
    "[grain loadout repeat defaults] hauling job reasserted:",
    option.value
  );
}

async function scheduleHaulingJobGuard() {
  const token = ++restoreToken;

  if (!modalIsCreate()) return;

  const driverKey = currentDriverKey();
  if (!driverKey) return;

  let snapshot;

  try {
    snapshot = await getDocs(
      collection(db, "grain_loadouts")
    );
  }
  catch (error) {
    console.warn(
      "[grain loadout repeat defaults] hauling-job guard could not read load history:",
      error
    );
    return;
  }

  if (
    token !== restoreToken ||
    driverKey !== currentDriverKey() ||
    !modalIsCreate()
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

  const jobId = clean(previousLoad?.haulingJobId);
  if (!jobId) return;

  /*
    The original repeat-default module uses Firestore + several UI render
    frames. Check after each likely render window. Each attempt only acts if
    the hauling job is STILL blank, so a manual user selection always wins.
  */
  [250, 650, 1200, 1800].forEach(delay => {
    setTimeout(
      () => reassertIfBlank(jobId, driverKey, token),
      delay
    );
  });
}

function wire(control) {
  if (!control || control.dataset.fvRepeatHaulingJobGuardWired) {
    return;
  }

  control.dataset.fvRepeatHaulingJobGuardWired = "1";
  control.addEventListener("change", scheduleHaulingJobGuard);
}

wire(elements.driver);
wire(elements.subdriver);
