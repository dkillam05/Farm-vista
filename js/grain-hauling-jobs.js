// /js/grain-hauling-jobs.js
// FarmVista wrapper: preserve hauling-job implementation, add void-assignment guard,
// keep the Sold Under add action scoped only to the Sold Under combo,
// and propagate contract assignments back to linked hauling jobs.
import "/js/grain-hauling-jobs-core.js";
import "/js/grain-contracts-hauling-overview-groups.js?v=20260911-1540";
import {
  ready,
  getFirestore,
  collection,
  getDocs,
  doc,
  updateDoc,
  serverTimestamp
} from "/js/firebase-init.js";

await ready;
const db = getFirestore();

const clean = value => String(value ?? "").trim();
const norm = value => clean(value).toLowerCase();

function ticketIsVoided(ticket) {
  return ticket?.voided === true || norm(ticket?.status).includes("void");
}

function contractIsVoided(contract) {
  return contract?.voided === true || norm(contract?.status || contract?.contractStatus).includes("void");
}

function installVoidGuardStyles() {
  if (document.getElementById("fv-hauling-void-guard-style")) return;
  const style = document.createElement("style");
  style.id = "fv-hauling-void-guard-style";
  style.textContent = `
    #void-hauling-job-btn:disabled,
    #void-hauling-job-btn.fv-void-disabled {
      background: rgba(179,38,30,.12) !important;
      background-color: rgba(179,38,30,.12) !important;
      color: rgba(157,36,30,.58) !important;
      -webkit-text-fill-color: rgba(157,36,30,.58) !important;
      border: 1px solid rgba(179,38,30,.22) !important;
      box-shadow: none !important;
      cursor: not-allowed !important;
      opacity: 1 !important;
    }
  `;
  document.head.appendChild(style);
}

function comboSelectFromButton(button) {
  return button?.closest?.(".fv-combo")?.querySelector?.("select") || null;
}

function removeMisplacedSoldUnderRows() {
  const customerId = "hauling-job-customer";
  const visiblePanels = Array.from(document.querySelectorAll(".fv-panel.show"));

  visiblePanels.forEach(panel => {
    const ownerId = clean(panel.dataset?.fvSelectId || panel.dataset?.selectId || panel.getAttribute?.("data-for"));
    if (ownerId === customerId) return;

    panel.querySelectorAll(".fv-item").forEach(item => {
      if (clean(item.textContent) === "+ Add New Sold Under") item.remove();
    });
  });
}

function installSoldUnderComboScopeGuard() {
  let activeHaulingSelectId = "";

  document.addEventListener("click", event => {
    const button = event.target.closest?.(".fv-buttonish");
    const select = comboSelectFromButton(button);
    if (!select?.id?.startsWith("hauling-job-")) return;

    activeHaulingSelectId = select.id;
    if (activeHaulingSelectId !== "hauling-job-customer") {
      queueMicrotask(removeMisplacedSoldUnderRows);
      setTimeout(removeMisplacedSoldUnderRows, 0);
      setTimeout(removeMisplacedSoldUnderRows, 50);
    }
  }, true);

  const observer = new MutationObserver(() => {
    if (activeHaulingSelectId && activeHaulingSelectId !== "hauling-job-customer") {
      removeMisplacedSoldUnderRows();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

/* ============================================================
   CONTRACT -> HAULING JOB PROPAGATION

   Grain Contracts owns the split-load contract allocation model.
   Hauling-job totals, however, are intentionally calculated from
   grain tickets linked to the job. When an unassigned ticket is
   dragged/assigned to a contract that is already linked to a
   hauling job, carry that haulingJobId back onto the ticket.

   This also repairs older tickets that were assigned to a linked
   contract before this propagation existed.
============================================================ */

let contractJobSyncTimer = null;
let contractJobSyncRunning = false;
let contractJobSyncQueued = false;

function ticketContractIds(ticket) {
  const ids = [];

  if (Array.isArray(ticket?.contractAllocations)) {
    ticket.contractAllocations.forEach(allocation => {
      const contractId = clean(allocation?.contractId);
      const bushels = Number(allocation?.bushels || 0);
      if (contractId && Number.isFinite(bushels) && bushels > 0) ids.push(contractId);
    });
  }

  const legacyContractId = clean(ticket?.contractId);
  if (!ids.length && legacyContractId) ids.push(legacyContractId);

  return [...new Set(ids)];
}

async function syncContractAssignedTicketsToHaulingJobs() {
  if (contractJobSyncRunning) {
    contractJobSyncQueued = true;
    return;
  }

  contractJobSyncRunning = true;

  try {
    const [contractSnap, ticketSnap] = await Promise.all([
      getDocs(collection(db, "grain_contracts")),
      getDocs(collection(db, "grain_tickets"))
    ]);

    const contractJobById = new Map();

    contractSnap.docs.forEach(snapshot => {
      const contract = snapshot.data();
      if (contractIsVoided(contract)) return;

      const haulingJobId = clean(contract?.haulingJobId);
      if (haulingJobId) contractJobById.set(snapshot.id, haulingJobId);
    });

    const repairs = [];

    ticketSnap.docs.forEach(snapshot => {
      const ticket = snapshot.data();
      if (ticketIsVoided(ticket)) return;

      const contractIds = ticketContractIds(ticket);
      if (!contractIds.length) return;

      const linkedJobIds = [...new Set(
        contractIds
          .map(contractId => contractJobById.get(contractId))
          .filter(Boolean)
      )];

      // A ticket can safely inherit only one hauling job. Split-load
      // tickets spanning different jobs remain untouched for manual review.
      if (linkedJobIds.length !== 1) return;

      const haulingJobId = linkedJobIds[0];
      const currentJobId = clean(ticket?.haulingJobId);

      // Never silently move a ticket away from an existing hauling job.
      // Grain Contracts already blocks mismatched job/contract assignment.
      if (currentJobId && currentJobId !== haulingJobId) return;
      if (currentJobId === haulingJobId) return;

      repairs.push(
        updateDoc(
          doc(db, "grain_tickets", snapshot.id),
          {
            haulingJobId,
            haulingJobAssignmentSource: "contract_link",
            haulingJobAssignedAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          }
        )
      );
    });

    if (repairs.length) {
      await Promise.all(repairs);
      console.info(`[Hauling Jobs] Propagated linked hauling job to ${repairs.length} contract-assigned ticket(s).`);
    }
  } catch (error) {
    console.warn("[Hauling Jobs] Contract-to-job ticket propagation failed:", error);
  } finally {
    contractJobSyncRunning = false;

    if (contractJobSyncQueued) {
      contractJobSyncQueued = false;
      setTimeout(syncContractAssignedTicketsToHaulingJobs, 250);
    }
  }
}

function scheduleContractJobSync(delay = 450) {
  clearTimeout(contractJobSyncTimer);
  contractJobSyncTimer = setTimeout(syncContractAssignedTicketsToHaulingJobs, delay);
}

function installContractJobPropagation() {
  // Repair existing bottom-up assignments as soon as this page loads.
  scheduleContractJobSync(250);

  // Single drag, group drag, Assign Selected, and Assign All all flow
  // through the contracts UI. Re-check shortly after those actions save.
  document.addEventListener("drop", event => {
    if (event.target.closest?.(".contract-drop-card")) scheduleContractJobSync(700);
  }, true);

  document.addEventListener("click", event => {
    if (event.target.closest?.(".assign-selected-btn, .assign-all-btn")) {
      scheduleContractJobSync(700);
    }
  }, true);

  document.addEventListener("touchend", event => {
    if (event.target.closest?.("[data-touch-ticket-id], [data-ticket][data-contract]")) {
      scheduleContractJobSync(900);
    }
  }, true);
}

async function assignmentCounts(jobId) {
  const [contractSnap, ticketSnap] = await Promise.all([
    getDocs(collection(db, "grain_contracts")),
    getDocs(collection(db, "grain_tickets"))
  ]);

  const contracts = contractSnap.docs.filter(snapshot => {
    const contract = snapshot.data();
    return !contractIsVoided(contract) && clean(contract?.haulingJobId) === jobId;
  }).length;

  const tickets = ticketSnap.docs.filter(snapshot => {
    const ticket = snapshot.data();
    return !ticketIsVoided(ticket) && clean(ticket?.haulingJobId) === jobId;
  }).length;

  return { contracts, tickets };
}

function disabledReason({ contracts, tickets }) {
  if (contracts && tickets) return `${contracts} linked contract${contracts === 1 ? "" : "s"} and ${tickets} assigned ticket${tickets === 1 ? "" : "s"} must be unlinked first.`;
  if (contracts) return `${contracts} linked contract${contracts === 1 ? "" : "s"} must be unlinked first.`;
  if (tickets) return `${tickets} assigned ticket${tickets === 1 ? "" : "s"} must be unlinked first.`;
  return "";
}

async function syncVoidButton() {
  const button = document.getElementById("void-hauling-job-btn");
  const editId = clean(document.getElementById("hauling-job-edit-id")?.value);
  if (!button || button.hidden || !editId) return;

  button.disabled = true;
  button.classList.add("fv-void-disabled");
  button.title = "Checking hauling-job assignments…";
  button.setAttribute("aria-disabled", "true");

  try {
    const counts = await assignmentCounts(editId);
    const reason = disabledReason(counts);
    const stillSameJob = clean(document.getElementById("hauling-job-edit-id")?.value) === editId;
    if (!stillSameJob) return;

    button.dataset.fvBlockReason = reason;
    button.disabled = !!reason;
    button.classList.toggle("fv-void-disabled", !!reason);
    button.setAttribute("aria-disabled", reason ? "true" : "false");
    button.title = reason
      ? `Cannot void this hauling job: ${reason}`
      : "Void this hauling job";
  } catch (error) {
    console.warn("[Hauling Jobs] Could not verify void eligibility:", error);
    button.dataset.fvBlockReason = "FarmVista could not verify assignments. Refresh and try again.";
    button.disabled = true;
    button.classList.add("fv-void-disabled");
    button.title = button.dataset.fvBlockReason;
  }
}

installVoidGuardStyles();
installSoldUnderComboScopeGuard();
installContractJobPropagation();

const modal = document.getElementById("hauling-job-modal");
if (modal) {
  new MutationObserver(() => {
    if (modal.classList.contains("open")) {
      queueMicrotask(syncVoidButton);
    }
  }).observe(modal, { attributes: true, attributeFilter: ["class"] });
}

document.addEventListener("click", event => {
  const button = event.target.closest?.("#void-hauling-job-btn");
  if (!button) return;
  const reason = clean(button.dataset.fvBlockReason);
  if (button.disabled || reason) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (reason) alert(`This hauling job cannot be voided yet.\n\n${reason}`);
  }
}, true);
