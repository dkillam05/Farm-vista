// FarmVista — Grain ticket table quality highlighting
// Keep hauling-job ticket tables synchronized with Settings > Grain Ticket Alerts.

import "/js/grain-contract-remaining-colors.js?v=20260912-1";
import {
  ready,
  getFirestore,
  doc,
  getDoc
} from "/js/firebase-init.js";

await ready;

const db = getFirestore();
const SETTINGS_COLLECTION = "settings";
const SETTINGS_DOC = "grainTicketAlerts";

const clean = value => String(value ?? "").trim();
const norm = value => clean(value).toLowerCase();

let settings = null;
let settingsPromise = null;
let applyQueued = false;

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

async function loadSettings(force = false) {
  if (settingsPromise && !force) return settingsPromise;

  settingsPromise = (async () => {
    try {
      const snap = await getDoc(doc(db, SETTINGS_COLLECTION, SETTINGS_DOC));
      settings = snap.exists() ? (snap.data() || {}) : null;
    } catch (error) {
      console.warn("[FarmVista] Could not load Grain Ticket Alert settings for table highlighting:", error);
      settings = null;
    }

    return settings;
  })();

  return settingsPromise;
}

function currentCrop() {
  const modal = document.getElementById("fv-contract-hauling-overview");
  if (!modal) return "";

  const text = [
    modal.querySelector(".modal-sub")?.textContent,
    modal.querySelector("[data-fv-hauling-subtitle]")?.textContent,
    modal.textContent
  ].filter(Boolean).join(" ");

  if (/soy/i.test(text)) return "soybeans";
  if (/corn/i.test(text)) return "corn";
  return "";
}

function metricKey(headerText) {
  const key = norm(headerText).replace(/[^a-z]/g, "");
  if (key === "mo" || key.includes("moisture")) return "moisture";
  if (key === "fm" || key.includes("foreignmaterial")) return "foreignMaterial";
  if (key === "damage" || key === "dm" || key.includes("damaged")) return "damage";
  return "";
}

function ruleFor(crop, metric) {
  if (!settings || settings.alertsEnabled === false) return null;

  const cropRules = settings?.crops?.[crop];
  const metricRules = cropRules?.[metric];
  if (!metricRules) return null;

  return metricRules;
}

function classForValue(crop, metric, value) {
  const rules = ruleFor(crop, metric);
  if (!rules) return "";

  const severeEnabled = rules?.severe?.enabled !== false;
  const severeThreshold = numberOrNull(rules?.severe?.threshold);

  if (
    severeEnabled &&
    severeThreshold !== null &&
    value >= severeThreshold
  ) {
    return "severe";
  }

  const trendEnabled = rules?.trend?.enabled !== false;
  const trendThreshold = numberOrNull(rules?.trend?.threshold);

  if (
    trendEnabled &&
    trendThreshold !== null &&
    value >= trendThreshold
  ) {
    return "warn";
  }

  return "";
}

function applyToTable(table, crop) {
  if (!table || !crop) return;

  const headers = Array.from(table.querySelectorAll("thead th"));
  const metricColumns = headers
    .map((header, index) => ({ index, metric: metricKey(header.textContent) }))
    .filter(item => item.metric);

  if (!metricColumns.length) return;

  table.querySelectorAll("tbody tr").forEach(row => {
    metricColumns.forEach(({ index, metric }) => {
      const cell = row.cells[index];
      if (!cell) return;

      const pill = cell.querySelector(".fv-job-grade-pill");
      if (!pill) return;

      const value = numberOrNull(pill.textContent);
      pill.classList.remove("warn", "severe");
      pill.removeAttribute("title");

      if (value === null) return;

      const cls = classForValue(crop, metric, value);
      if (cls) pill.classList.add(cls);

      const rules = ruleFor(crop, metric);
      if (!rules) return;

      if (cls === "severe") {
        pill.title = `Severe threshold: ${rules.severe.threshold}%`;
      } else if (cls === "warn") {
        pill.title = `Elevated threshold: ${rules.trend.threshold}%`;
      }
    });
  });
}

async function applyAlertSettingsToTables(forceReload = false) {
  await loadSettings(forceReload);

  const crop = currentCrop();
  document.querySelectorAll("#fv-contract-hauling-overview .fv-job-contract-table")
    .forEach(table => applyToTable(table, crop));
}

function queueApply(forceReload = false) {
  if (applyQueued) return;
  applyQueued = true;

  requestAnimationFrame(() => {
    applyQueued = false;
    applyAlertSettingsToTables(forceReload);
  });
}

// The hauling overview is rendered/re-rendered dynamically. Re-apply after each render.
new MutationObserver(() => queueApply(false)).observe(document.body, {
  childList: true,
  subtree: true
});

document.addEventListener("click", event => {
  if (event.target.closest?.("tr.hauling-row[data-hauling-job-id]")) {
    // Re-read settings each time a hauling job is opened so changes made on
    // Grain Ticket Alerts are reflected without stale fixed thresholds.
    settingsPromise = null;
    queueApply(true);
    setTimeout(() => applyAlertSettingsToTables(false), 200);
    setTimeout(() => applyAlertSettingsToTables(false), 700);
  }
}, true);

queueApply(true);
