// /js/grain-hauling-jobs.js
// FarmVista wrapper: preserve hauling-job implementation, add void-assignment guard,
// keep the Sold Under add action scoped only to the Sold Under combo,
// and propagate contract assignments back to linked hauling jobs.
import "/js/grain-hauling-jobs-core.js";
import "/js/grain-contracts-hauling-overview-groups.js?v=20260911-1540";
import "/js/grain-contracts-ui-followup.js?v=20260912-0624";
import "/js/grain-ticket-alert-table-sync.js?v=20260912-0624";
import "/js/grain-hauling-status-dnd.js?v=20260912-0715";
import "/js/grain-hauling-status-dnd-followup.js?v=20260912-0744";
import "/js/grain-hauling-ticket-sequence.js?v=20260912-0748";
import "/js/grain-hauling-split-portion-dnd.js?v=20260912-0922";
import "/js/grain-hauling-left-drop-zone.js?v=20260912-0915";
import "/js/grain-hauling-effective-totals.js?v=20260912-0928";
import "/js/grain-hauling-partial-checkboxes.js?v=20260912-0940";
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

  const legacyContractId = clean(ticket.contractId);
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

      if (linkedJobIds.length !== 1) return;

      const haulingJobId = linkedJobIds[0];
      const currentJobId = clean(ticket?.haulingJobId);
      const manuallyUnassignedFromJobId = clean(ticket?.haulingJobManualUnassignedFromJobId);

      if (!currentJobId && manuallyUnassignedFromJobId === haulingJobId) return;
      if (currentJobId && currentJobId !== haulingJobId) return;
      if (currentJobId === haulingJobId) return;

      repairs.push(
        updateDoc(
          doc(db, "grain_tickets", snapshot.id),
          {
            haulingJobId,
            haulingJobAssignmentSource: "contract_link",
            haulingJobAssignedAt: serverTimestamp(),
            haulingJobManualUnassignedFromJobId: null,
            haulingJobManualUnassignedAt: null,
            haulingJobManualUnassignedByUid: null,
            haulingJobManualUnassignedByName: null,
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
  scheduleContractJobSync(250);

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

function installHaulingModalTouchRepair() {
  if (document.getElementById("fv-hauling-modal-touch-repair")) return;

  const style = document.createElement("style");
  style.id = "fv-hauling-modal-touch-repair";
  style.textContent = `
    @media (max-width: 900px), (pointer: coarse) {
      #hauling-job-modal {
        position: fixed !important;
        inset: 0 !important;
        width: 100dvw !important;
        height: 100dvh !important;
        max-width: 100dvw !important;
        max-height: 100dvh !important;
        padding: max(8px, env(safe-area-inset-top, 0px)) 8px max(8px, env(safe-area-inset-bottom, 0px)) !important;
        margin: 0 !important;
        overflow: hidden !important;
        justify-content: center !important;
        align-items: flex-start !important;
        touch-action: none !important;
      }

      #hauling-job-modal > .modal-card {
        width: min(100%, 900px) !important;
        max-width: 100% !important;
        min-width: 0 !important;
        height: auto !important;
        max-height: calc(100dvh - max(16px, env(safe-area-inset-top, 0px)) - max(16px, env(safe-area-inset-bottom, 0px))) !important;
        margin: 0 auto !important;
        overflow-x: hidden !important;
        overflow-y: auto !important;
        -webkit-overflow-scrolling: touch !important;
        overscroll-behavior: contain !important;
        touch-action: pan-y !important;
        border-radius: 14px !important;
      }

      #hauling-job-modal .modal-actions {
        position: relative !important;
        bottom: auto !important;
        padding-bottom: max(16px, env(safe-area-inset-bottom, 0px)) !important;
      }

      #hauling-job-modal .edit-grid,
      #hauling-job-modal .field,
      #hauling-job-modal .fv-combo,
      #hauling-job-modal input,
      #hauling-job-modal select,
      #hauling-job-modal textarea,
      #hauling-job-modal button {
        min-width: 0 !important;
        max-width: 100% !important;
        box-sizing: border-box !important;
      }

      .fv-panel.fv-hauling-job-panel {
        position: fixed !important;
        right: auto !important;
        margin: 0 !important;
        z-index: 12000 !important;
        max-height: min(46dvh, 420px) !important;
        overflow-y: auto !important;
        overflow-x: hidden !important;
        -webkit-overflow-scrolling: touch !important;
        overscroll-behavior: contain !important;
      }
    }
  `;
  document.head.appendChild(style);

  let activeSelectId = "";
  let frame = 0;

  const ownerIdForPanel = panel =>
    clean(
      panel?.dataset?.fvSelectId ||
      panel?.dataset?.selectId ||
      panel?.getAttribute?.("data-for") ||
      activeSelectId
    );

  const positionPanel = panel => {
    if (!panel?.classList?.contains("show")) return;
    if (!document.getElementById("hauling-job-modal")?.classList.contains("open")) return;

    const selectId = ownerIdForPanel(panel);
    if (!selectId.startsWith("hauling-job-")) return;

    const select = document.getElementById(selectId);
    const combo = select?.closest?.(".fv-combo");
    const anchor = combo?.querySelector?.(".fv-buttonish") || combo;
    if (!anchor) return;

    const rect = anchor.getBoundingClientRect();
    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    const gap = 4;
    const availableBelow = Math.max(120, viewportHeight - rect.bottom - gap - 8);

    panel.classList.add("fv-hauling-job-panel");
    panel.style.setProperty("top", `${Math.round(rect.bottom + gap)}px`, "important");
    panel.style.setProperty("left", `${Math.round(rect.left)}px`, "important");
    panel.style.setProperty("width", `${Math.round(rect.width)}px`, "important");
    panel.style.setProperty("max-width", `${Math.round(rect.width)}px`, "important");
    panel.style.setProperty("max-height", `${Math.min(420, availableBelow)}px`, "important");
  };

  const repositionVisiblePanels = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      document.querySelectorAll(".fv-panel.show").forEach(positionPanel);
    });
  };

  document.addEventListener("pointerdown", event => {
    const button = event.target.closest?.("#hauling-job-modal .fv-buttonish");
    if (!button) return;
    const select = comboSelectFromButton(button);
    if (!select?.id?.startsWith("hauling-job-")) return;
    activeSelectId = select.id;
  }, true);

  document.addEventListener("click", event => {
    const button = event.target.closest?.("#hauling-job-modal .fv-buttonish");
    if (!button) return;
    const select = comboSelectFromButton(button);
    if (!select?.id?.startsWith("hauling-job-")) return;
    activeSelectId = select.id;
    setTimeout(repositionVisiblePanels, 0);
    setTimeout(repositionVisiblePanels, 24);
    setTimeout(repositionVisiblePanels, 80);
  }, true);

  const bodyObserver = new MutationObserver(repositionVisiblePanels);
  bodyObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class"]
  });

  const modalCard = document.querySelector("#hauling-job-modal > .modal-card");
  modalCard?.addEventListener("scroll", repositionVisiblePanels, { passive: true });
  window.addEventListener("resize", repositionVisiblePanels, { passive: true });
  window.visualViewport?.addEventListener("resize", repositionVisiblePanels, { passive: true });
}

installVoidGuardStyles();
installSoldUnderComboScopeGuard();
installContractJobPropagation();
installHaulingModalTouchRepair();

const modal = document.getElementById("hauling-job-modal");
if (modal) {
  new MutationObserver(() => {
    if (modal.classList.contains("open")) {
      queueMicrotask(syncVoidButton);
      requestAnimationFrame(() => {
        const card = modal.querySelector(":scope > .modal-card");
        if (card) card.scrollTop = 0;
      });
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
