import {
  ready,
  getFirestore,
  collection,
  getDocs
} from "/js/firebase-init.js";

await ready;

const db = getFirestore();
const $ = id => document.getElementById(id);
const clean = value => String(value ?? "").trim();
const norm = value => clean(value).toLowerCase();
const num = value => {
  const parsed = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};
const millis = value => {
  if (value?.toMillis) return value.toMillis();
  if (value?.toDate) return value.toDate().getTime();
  const date = new Date(value || 0);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const E = {
  backdrop: $("loadout-modal-backdrop"),
  title: $("loadout-modal-title"),
  driver: $("loadout-driver"),
  subdriver: $("loadout-subdriver"),
  job: $("loadout-hauling-job"),
  crop: $("loadout-crop"),
  customer: $("loadout-customer"),
  customerButton: $("loadout-customer-button"),
  customerText: $("loadout-customer-button-text"),
  customerMenu: $("loadout-customer-menu"),
  sourceButton: $("loadout-source-button"),
  sourceMenu: $("loadout-source-menu"),
  message: $("loadout-form-message")
};

function keepCropLocked() {
  if (!E.crop) return;

  E.crop.disabled = true;
  E.crop.setAttribute("aria-disabled", "true");

  const combo = E.crop.closest(".fv-combo");
  const comboButton = combo?.querySelector(".fv-buttonish");

  if (comboButton) {
    const selected = E.crop.options?.[E.crop.selectedIndex];
    if (selected) comboButton.textContent = selected.textContent;

    comboButton.disabled = true;
    comboButton.setAttribute("aria-disabled", "true");
    comboButton.classList.add("is-disabled");
    comboButton.style.background = "var(--surface-2, rgba(255,255,255,.04))";
    comboButton.style.color = "var(--muted, #87908a)";
    comboButton.style.opacity = ".55";
    comboButton.style.cursor = "not-allowed";

    /* The custom combo is the visible control. Fully hide the native select
       so Chrome cannot paint its own tiny second dropdown arrow beside it. */
    E.crop.style.display = "none";
  }
  else {
    /* Before the FarmVista combo enhancer wraps Crop, keep the native select
       visually disabled. Once wrapped, the branch above takes over. */
    E.crop.style.backgroundColor = "var(--surface-2, rgba(255,255,255,.04))";
    E.crop.style.opacity = ".62";
    E.crop.style.cursor = "not-allowed";
  }
}

const cropFieldHost = E.crop?.closest(".loadout-field") || E.crop?.parentElement;
if (cropFieldHost) {
  new MutationObserver(() => keepCropLocked())
    .observe(cropFieldHost, { childList: true, subtree: true });
}

keepCropLocked();

let state = {
  jobs: [],
  tickets: [],
  customers: []
};
let refreshing = null;
let token = 0;
let observerTimer = 0;

const createMode = () =>
  E.backdrop?.classList.contains("open") &&
  norm(E.title?.textContent) === "assign load";

const jobCustomerId = job =>
  clean(job?.customerId || job?.grainCustomerId);

const customerName = id =>
  clean(
    state.customers.find(item => clean(item.id) === clean(id))?.name ||
    state.customers.find(item => clean(item.id) === clean(id))?.customerName
  );

const jobCustomerName = job =>
  clean(
    job?.customerName ||
    job?.soldUnderName ||
    customerName(jobCustomerId(job))
  ) || "Unknown";

const jobCrop = job =>
  clean(job?.crop || job?.commodity || job?.cropName || job?.cropType);

const jobPlace = job => {
  const buyer = clean(job?.buyerName);
  const destination = clean(
    job?.deliveryLocationName ||
    job?.locationName ||
    job?.destinationName
  );

  return (
    buyer && destination && !norm(destination).startsWith(norm(buyer))
      ? `${buyer} ${destination}`
      : destination || buyer || clean(job?.displayName || job?.jobName) || "Hauling Job"
  );
};

const startingBushels = job =>
  Math.max(
    0,
    num(job?.startingBushels ?? job?.jobBushels ?? job?.bushels)
  );

const voidTicket = ticket =>
  ticket?.voided === true ||
  norm(ticket?.status).includes("void");

const ticketedBushels = job =>
  state.tickets
    .filter(ticket =>
      !voidTicket(ticket) &&
      clean(ticket?.haulingJobId || ticket?.grainHaulingJobId) === clean(job.id)
    )
    .reduce(
      (sum, ticket) =>
        sum + num(ticket?.netBushels ?? ticket?.netBu ?? ticket?.bushels),
      0
    );

const remaining = job => {
  const starting = startingBushels(job);
  if (starting > 0) {
    return Math.max(0, starting - ticketedBushels(job));
  }

  const explicit =
    job?.remainingBushels ??
    job?.bushelsRemaining ??
    job?.remainingBu;

  return explicit !== undefined && explicit !== null && explicit !== ""
    ? Math.max(0, num(explicit))
    : 0;
};

const openJob = job => {
  if (
    !job ||
    job.active === false ||
    job.isActive === false ||
    job.manualClosed === true
  ) {
    return false;
  }

  const status = norm(job.status || job.jobStatus);
  if (["void", "cancel", "closed", "complete"].some(word => status.includes(word))) {
    return false;
  }

  return !(startingBushels(job) > 0 && remaining(job) <= 0.005);
};

const oldest = job => {
  const iso = clean(job?.deliveryStartDate || job?.startDate);
  if (iso) {
    const date = new Date(`${iso}T12:00:00`);
    if (!Number.isNaN(date.getTime())) return date.getTime();
  }

  return millis(job?.createdAt || job?.createdAtISO || job?.updatedAt) ||
    Number.MAX_SAFE_INTEGER;
};

const groupingKey = job =>
  `${norm(jobPlace(job))}|${norm(jobCrop(job))}|${
    jobCustomerId(job)
      ? `id:${jobCustomerId(job)}`
      : `name:${norm(jobCustomerName(job))}`
  }`;

const visibleIds = () => {
  const map = new Map();

  state.jobs
    .filter(openJob)
    .sort((a, b) => oldest(a) - oldest(b))
    .forEach(job => {
      const key = groupingKey(job);
      if (!map.has(key)) map.set(key, clean(job.id));
    });

  return new Set(map.values());
};

const formatBushels = value =>
  num(value).toLocaleString("en-US", { maximumFractionDigits: 2 });

const shortDate = value => {
  const parts = clean(value).split("-").map(Number);
  return parts.length === 3 && parts[1] && parts[2]
    ? `${parts[1]}/${parts[2]}`
    : clean(value);
};

const label = job => {
  const place = jobPlace(job);
  const crop = jobCrop(job) || "Crop not set";
  const parts = [`${place} — ${crop} — ${jobCustomerName(job)}`];
  const starting = startingBushels(job);
  const start = clean(job?.deliveryStartDate || job?.startDate);
  const end = clean(job?.deliveryEndDate || job?.endDate);

  if (starting) parts.push(`${formatBushels(starting)} bu`);
  if (start || end) {
    parts.push(`Delivery ${shortDate(start) || "—"}–${shortDate(end) || "—"}`);
  }
  parts.push(`Remaining ${formatBushels(remaining(job))} bu`);

  return parts.join(" • ");
};

const compareJobs = (a, b) =>
  jobPlace(a).localeCompare(jobPlace(b), undefined, {
    numeric: true,
    sensitivity: "base"
  }) ||
  jobCrop(a).localeCompare(jobCrop(b), undefined, {
    numeric: true,
    sensitivity: "base"
  }) ||
  oldest(a) - oldest(b) ||
  jobCustomerName(a).localeCompare(jobCustomerName(b), undefined, {
    numeric: true,
    sensitivity: "base"
  });

async function refresh(force = false) {
  if (refreshing && !force) return refreshing;

  refreshing = (async () => {
    try {
      const [jobs, tickets, customers] = await Promise.all([
        getDocs(collection(db, "grain_hauling_jobs")),
        getDocs(collection(db, "grain_tickets")),
        getDocs(collection(db, "grain_customers"))
      ]);

      state = {
        jobs: jobs.docs.map(doc => ({ id: doc.id, ...doc.data() })),
        tickets: tickets.docs.map(doc => ({ id: doc.id, ...doc.data() })),
        customers: customers.docs.map(doc => ({ id: doc.id, ...doc.data() }))
      };
    }
    catch (error) {
      console.warn("[grain loadout flow] read failed", error);
    }
    finally {
      refreshing = null;
    }

    return state;
  })();

  return refreshing;
}

function syncCrop(job) {
  if (!job || !E.crop) return;

  const crop = jobCrop(job);
  if (crop) {
    const match = Array.from(E.crop.options || []).find(
      option => option.value && norm(option.value) === norm(crop)
    );

    if (match) E.crop.value = match.value;
  }

  keepCropLocked();
}

function syncCustomer(job) {
  if (!job || !E.customer) return;

  const id = jobCustomerId(job);
  const name = jobCustomerName(job);
  const value = id || (norm(name) === "unknown" ? "__unknown__" : "");
  if (!value) return;

  E.customer.value = value;
  if (E.customerText) E.customerText.textContent = name;

  /* Sold Under belongs to the hauling job. It is display-only on Load Out. */
  if (E.customerButton) {
    E.customerButton.disabled = true;
    E.customerButton.setAttribute("aria-disabled", "true");
  }

  E.customerMenu?.classList.remove("open");
  E.customerButton?.setAttribute("aria-expanded", "false");

  E.customerMenu
    ?.querySelectorAll("[data-customer-value]")
    .forEach(button => {
      const selected =
        clean(button.getAttribute("data-customer-value")) === value;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-selected", selected ? "true" : "false");
    });
}

function lockJobDetails(job) {
  if (!job) return;
  syncCrop(job);
  syncCustomer(job);
}

function decorate() {
  if (!E.job || !state.jobs.length) return;

  const allowed = visibleIds();
  const selected = clean(E.job.value);
  const special = [];
  const jobOptions = [];

  Array.from(E.job.options || []).forEach(option => {
    const id = clean(option.value);

    if (!id || id === "__add_new__" || id === "__add_new_job__") {
      special.push(option);
      return;
    }

    const job = state.jobs.find(item => clean(item.id) === id);
    if (!job) return;

    const show = allowed.has(id) || id === selected;
    if (!show) {
      option.remove();
      return;
    }

    option.hidden = false;
    option.disabled = false;
    option.textContent = label(job);
    option.label = option.textContent;
    jobOptions.push({ option, job });
  });

  /* Native select order: Elevator A-Z, then Crop A-Z, then oldest job. */
  jobOptions
    .sort((a, b) => compareJobs(a.job, b.job))
    .forEach(({ option }) => E.job.appendChild(option));

  /* Keep Add New at the bottom while the blank prompt remains at the top. */
  special
    .filter(option => clean(option.value))
    .forEach(option => E.job.appendChild(option));

  const blank = special.find(option => !clean(option.value));
  if (blank) E.job.insertBefore(blank, E.job.firstChild);

  const job = state.jobs.find(item => clean(item.id) === clean(E.job.value));
  if (job) lockJobDetails(job);
}

const queueDecorate = () => {
  clearTimeout(observerTimer);
  observerTimer = setTimeout(decorate, 0);
};

function sourceChoices() {
  return Array.from(
    E.sourceMenu?.querySelectorAll("[data-source-value]") || []
  );
}

function sourceChoice(value) {
  const wanted = clean(value);
  const choices = sourceChoices();

  let match = choices.find(
    button => clean(button.getAttribute("data-source-value")) === wanted
  );

  if (!match && wanted === "active_field_harvest") {
    match = choices.find(button =>
      clean(button.getAttribute("data-source-value"))
        .startsWith("active_field_harvest:")
    );
  }

  return match || null;
}

async function restoreSource(load) {
  const value = clean(load?.grainSourceValue);
  if (!value || !E.sourceButton || E.sourceButton.disabled) return false;

  E.sourceButton.click();
  await wait(80);

  const choice = sourceChoice(value);
  if (choice) {
    choice.click();
    return true;
  }

  if (E.sourceMenu?.classList.contains("open")) {
    E.sourceButton.click();
  }

  return false;
}

function driverKey() {
  const value = clean(E.driver?.value);

  if (value.startsWith("emp:")) return value;

  if (value.startsWith("sub:")) {
    const subdriverId = clean(E.subdriver?.value);
    return subdriverId ? `${value}:${subdriverId}` : "";
  }

  return "";
}

function loadMatches(load, key) {
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

async function repeatRun() {
  const mine = ++token;
  const key = driverKey();

  if (!createMode() || !key) return;

  try {
    const snapshot = await getDocs(collection(db, "grain_loadouts"));
    await refresh(true);

    if (mine !== token || key !== driverKey() || !createMode()) return;

    const load = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(item => loadMatches(item, key))
      .sort(
        (a, b) =>
          millis(b.loadedAt || b.createdAt || b.updatedAt) -
          millis(a.loadedAt || a.createdAt || a.updatedAt)
      )[0];

    if (!load) return;

    const id = clean(load.haulingJobId);
    const job = state.jobs.find(item => clean(item.id) === id);

    if (!id || !job || !visibleIds().has(id)) return;

    let option = Array.from(E.job?.options || [])
      .find(item => clean(item.value) === id);

    if (!option) {
      option = document.createElement("option");
      option.value = id;
      option.dataset.fvRepeatInjected = "1";
      E.job?.appendChild(option);
    }

    option.hidden = false;
    option.disabled = false;
    option.textContent = label(job);
    option.label = option.textContent;

    document.documentElement.classList.add("fv-loadout-silent-preload");

    E.job.value = id;
    option.selected = true;

    E.job.dispatchEvent(new Event("input", { bubbles: true }));
    E.job.dispatchEvent(new Event("change", { bubbles: true }));

    await wait(260);

    if (mine !== token || key !== driverKey() || !createMode()) return;

    lockJobDetails(job);

    const sourceRestored = await restoreSource(load);

    await wait(120);

    if (E.message) {
      E.message.textContent = sourceRestored
        ? "Data copied from previous load."
        : "Previous route copied. Choose the current grain source.";
      E.message.className = "loadout-form-message show good";
    }
  }
  catch (error) {
    console.warn("[grain repeat-run] failed", error);
  }
  finally {
    document.documentElement.classList.remove("fv-loadout-silent-preload");
  }
}

E.job?.addEventListener("change", () => {
  const id = clean(E.job.value);
  const job = state.jobs.find(item => clean(item.id) === id);

  if (job) {
    setTimeout(() => lockJobDetails(job), 0);
    setTimeout(() => lockJobDetails(job), 80);
    setTimeout(() => lockJobDetails(job), 220);
  }

  keepCropLocked();
  queueDecorate();
});

E.driver?.addEventListener("change", () => {
  token += 1;
  setTimeout(repeatRun, 100);
});

E.subdriver?.addEventListener("change", () => {
  token += 1;
  setTimeout(repeatRun, 100);
});

if (E.job) {
  new MutationObserver(queueDecorate)
    .observe(E.job, { childList: true });
}

if (E.backdrop) {
  new MutationObserver(() => {
    if (!createMode()) return;

    keepCropLocked();
    setTimeout(keepCropLocked, 0);
    setTimeout(keepCropLocked, 100);
    setTimeout(keepCropLocked, 300);

    refresh(true).then(() => {
      keepCropLocked();
      decorate();
      const job = state.jobs.find(
        item => clean(item.id) === clean(E.job?.value)
      );
      if (job) lockJobDetails(job);
    });
  }).observe(E.backdrop, {
    attributes: true,
    attributeFilter: ["class"]
  });
}

refresh().then(() => {
  keepCropLocked();
  decorate();
});
