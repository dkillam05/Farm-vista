// FarmVista — Grain Inventory hauling-job contract drill-down
// Updated 2026-09-12
// Detailed mode: hauling job -> linked contracts -> contract tickets.
// Simple mode: hauling job -> tickets directly, with no warning-style header.
// Also restores grade alert rings in hauling-job and Active Harvest drill-downs.

import {
  ready,
  getFirestore,
  collection,
  getDocs,
  getDoc,
  doc
} from "/js/firebase-init.js";

await ready;

if (String(location.pathname || "").toLowerCase().endsWith("/pages/grain/index.html")) {
  const db = getFirestore();
  const clean = value => String(value ?? "").trim();
  const norm = value => clean(value).toLowerCase();
  const num = value => {
    const parsed = Number(String(value ?? "").replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const esc = value => clean(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");

  const fmtBu = value => `${Math.round(num(value)).toLocaleString("en-US")} bu`;
  const fmtGrade = value => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? `${parsed.toFixed(2)}%` : "N/A";
  };
  const cropLabel = value => {
    const key = norm(value);
    if (["soy", "soybean", "soybeans", "beans", "sb"].includes(key)) return "Soybeans";
    if (["corn", "maize"].includes(key)) return "Corn";
    if (key === "wheat") return "Wheat";
    return clean(value) || "—";
  };
  const cropAlertKey = value => {
    const key = norm(value);
    if (key.includes("soy")) return "soybeans";
    if (key.includes("corn")) return "corn";
    return "";
  };

  const DEFAULT_ALERTS = {
    enabled: true,
    crops: {
      corn: {
        damage: { severe: { enabled: true, threshold: 8 }, trend: { enabled: true, threshold: 5 } },
        foreignMaterial: { severe: { enabled: true, threshold: 5 }, trend: { enabled: true, threshold: 3 } },
        moisture: { severe: { enabled: true, threshold: 20 }, trend: { enabled: true, threshold: 17 } }
      },
      soybeans: {
        damage: { severe: { enabled: true, threshold: 5 }, trend: { enabled: true, threshold: 3 } },
        foreignMaterial: { severe: { enabled: true, threshold: 3 }, trend: { enabled: true, threshold: 2 } },
        moisture: { severe: { enabled: true, threshold: 16 }, trend: { enabled: true, threshold: 14 } }
      }
    }
  };

  let alertSettings = DEFAULT_ALERTS;
  let jobs = [];
  let contracts = [];
  let tickets = [];

  const ticketBushels = ticket => Math.max(0, num(ticket?.netBushels ?? ticket?.netBu ?? ticket?.bushels));
  const ticketNumber = ticket => clean(ticket?.ticketNumber || ticket?.ticketNo || ticket?.number || ticket?.scaleTicketNumber) || clean(ticket?.id).slice(0, 8);
  const ticketDate = ticket => clean(ticket?.ticketDate || ticket?.date || ticket?.deliveryDate || "");
  const ticketDriver = ticket => clean(ticket?.driverName || ticket?.driver || ticket?.submittedByName || ticket?.submittedBy) || "—";
  const isTicketVoided = ticket => ticket?.voided === true || norm(ticket?.status).includes("void");
  const isContractVoided = contract => contract?.voided === true || norm(contract?.status || contract?.contractStatus).includes("void");
  const startingBushels = job => Math.max(0, num(job?.startingBushels ?? job?.jobBushels ?? job?.bushels));
  const jobName = job => {
    const saved = clean(job?.displayName || job?.jobName || job?.haulingJobName);
    if (saved) return saved;
    const buyer = clean(job?.buyerName || job?.buyer);
    const locationName = clean(job?.deliveryLocationName || job?.locationName || job?.destinationName || job?.destination);
    const place = buyer && locationName && !norm(locationName).startsWith(norm(buyer))
      ? `${buyer} ${locationName}`
      : (locationName || buyer || "Hauling Job");
    return `${place} — ${Math.round(startingBushels(job)).toLocaleString("en-US")} bu`;
  };
  const jobSoldUnder = job => clean(job?.customerName || job?.soldUnderName || job?.soldUnder || job?.customer) || "—";
  const contractNumber = contract => clean(contract?.contractNumber || contract?.number || contract?.contractNo || contract?.referenceNumber) || contract?.id || "Contract";
  const contractSoldUnder = contract => clean(contract?.customerName || contract?.soldUnderName || contract?.soldUnder || contract?.customer) || "—";

  function gradeLevel(crop, metric, value) {
    if (alertSettings?.enabled === false) return "";
    const cropKey = cropAlertKey(crop);
    if (!cropKey) return "";
    const rules = alertSettings?.crops?.[cropKey]?.[metric];
    const numeric = Number(value);
    if (!rules || !Number.isFinite(numeric)) return "";
    const severe = Number(rules.severe?.threshold);
    if (rules.severe?.enabled !== false && Number.isFinite(severe) && numeric >= severe) return "severe";
    const elevated = Number(rules.trend?.threshold);
    if (rules.trend?.enabled !== false && Number.isFinite(elevated) && numeric >= elevated) return "elevated";
    return "";
  }

  function gradeMarkup(crop, metric, value) {
    const level = gradeLevel(crop, metric, value);
    const title = level === "severe" ? "Severe grain alert level" : level === "elevated" ? "Elevated grain alert level" : "";
    return `<span class="fv-grade-alert ${level}"${title ? ` title="${title}"` : ""}>${fmtGrade(value)}</span>`;
  }

  function ticketAllocations(ticket) {
    if (!ticket || isTicketVoided(ticket)) return [];
    if (Array.isArray(ticket.contractAllocations)) {
      return ticket.contractAllocations
        .map(allocation => ({ contractId: clean(allocation?.contractId), bushels: Math.max(0, num(allocation?.bushels)) }))
        .filter(allocation => allocation.contractId && allocation.bushels > 0.005);
    }
    const legacyContractId = clean(ticket.contractId);
    return legacyContractId ? [{ contractId: legacyContractId, bushels: ticketBushels(ticket) }] : [];
  }

  function allocationFor(ticket, contractId) {
    return ticketAllocations(ticket)
      .filter(allocation => allocation.contractId === clean(contractId))
      .reduce((sum, allocation) => sum + allocation.bushels, 0);
  }

  function linkedContracts(jobId) {
    return contracts
      .filter(contract => !isContractVoided(contract) && clean(contract?.haulingJobId) === clean(jobId))
      .sort((a, b) => contractNumber(a).localeCompare(contractNumber(b), undefined, { numeric: true, sensitivity: "base" }));
  }

  function jobTickets(jobId) {
    return tickets
      .filter(ticket => !isTicketVoided(ticket) && clean(ticket?.haulingJobId) === clean(jobId))
      .sort((a, b) => ticketDate(b).localeCompare(ticketDate(a)) || ticketNumber(a).localeCompare(ticketNumber(b), undefined, { numeric: true, sensitivity: "base" }));
  }

  function weighted(ticketList) {
    let total = 0, mo = 0, moW = 0, fm = 0, fmW = 0, damage = 0, damageW = 0;
    ticketList.forEach(ticket => {
      const weight = ticketBushels(ticket);
      total += weight;
      if (!(weight > 0)) return;
      const moisture = Number(ticket?.moisture ?? ticket?.mo);
      const foreignMaterial = Number(ticket?.foreignMaterial ?? ticket?.fm);
      const dm = Number(ticket?.damage ?? ticket?.dm);
      if (Number.isFinite(moisture)) { mo += moisture * weight; moW += weight; }
      if (Number.isFinite(foreignMaterial)) { fm += foreignMaterial * weight; fmW += weight; }
      if (Number.isFinite(dm)) { damage += dm * weight; damageW += weight; }
    });
    return {
      bushels: total,
      loads: ticketList.length,
      moisture: moW ? mo / moW : null,
      fm: fmW ? fm / fmW : null,
      damage: damageW ? damage / damageW : null
    };
  }

  function soldUnderNamesForJob(job) {
    const names = [...new Set(linkedContracts(job.id).map(contractSoldUnder).filter(name => name && name !== "—"))];
    return names.length ? names.join(" / ") : jobSoldUnder(job);
  }

  function ticketRow(ticket, bushels, bushelLabel = "Bushels") {
    const crop = ticket?.crop || ticket?.commodity;
    return `
      <tr>
        <td><a class="fv-ahj-ticket-link" href="/pages/grain/grain-ticket-detail.html?id=${encodeURIComponent(ticket.id)}">${esc(ticketNumber(ticket))}</a></td>
        <td>${esc(ticketDate(ticket) || "—")}</td>
        <td>${esc(ticketDriver(ticket))}</td>
        <td>${fmtBu(bushels)}</td>
        <td>${gradeMarkup(crop, "moisture", ticket?.moisture ?? ticket?.mo)}</td>
        <td>${gradeMarkup(crop, "foreignMaterial", ticket?.foreignMaterial ?? ticket?.fm)}</td>
        <td>${gradeMarkup(crop, "damage", ticket?.damage ?? ticket?.dm)}</td>
      </tr>`;
  }

  function ticketTable(rows, bushelHeading = "Bushels") {
    return `
      <div class="table-wrap">
        <table class="harvest-drill-table">
          <thead><tr><th>Ticket #</th><th>Date</th><th>Driver</th><th>${esc(bushelHeading)}</th><th>MO</th><th>FM</th><th>Damage</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  function contractBlock(contract, jobTicketList) {
    const contractTickets = jobTicketList
      .map(ticket => ({ ticket, bushels: allocationFor(ticket, contract.id) }))
      .filter(item => item.bushels > 0.005);
    const allocated = contractTickets.reduce((sum, item) => sum + item.bushels, 0);
    return `
      <section class="fv-ahj-contract-block">
        <div class="fv-ahj-contract-head">
          <div>
            <div class="fv-ahj-contract-title">Contract ${esc(contractNumber(contract))}</div>
            <div class="fv-ahj-contract-sub">Sold Under: ${esc(contractSoldUnder(contract))}</div>
          </div>
          <div class="fv-ahj-contract-total">${fmtBu(allocated)} • ${contractTickets.length} ticket${contractTickets.length === 1 ? "" : "s"}</div>
        </div>
        ${contractTickets.length
          ? ticketTable(contractTickets.map(item => ticketRow(item.ticket, item.bushels)).join(""), "Contract Bu.")
          : `<div class="fv-ahj-contract-empty">No tickets are assigned to this contract yet.</div>`}
      </section>`;
  }

  function otherBushels(linked, jobTicketList) {
    const linkedIds = new Set(linked.map(contract => contract.id));
    return jobTicketList
      .map(ticket => {
        const linkedAllocated = ticketAllocations(ticket)
          .filter(allocation => linkedIds.has(allocation.contractId))
          .reduce((sum, allocation) => sum + allocation.bushels, 0);
        return { ticket, bushels: Math.max(0, ticketBushels(ticket) - linkedAllocated) };
      })
      .filter(item => item.bushels > 0.005);
  }

  function otherBushelBlock(linked, jobTicketList) {
    const other = otherBushels(linked, jobTicketList);
    if (!other.length) return "";
    const total = other.reduce((sum, item) => sum + item.bushels, 0);
    return `
      <section class="fv-ahj-contract-block fv-ahj-other-block">
        <div class="fv-ahj-contract-head">
          <div>
            <div class="fv-ahj-contract-title">Not Assigned to a Linked Contract</div>
            <div class="fv-ahj-contract-sub">Spot or still-unassigned bushels that are part of this hauling job.</div>
          </div>
          <div class="fv-ahj-contract-total">${fmtBu(total)}</div>
        </div>
        ${ticketTable(other.map(item => ticketRow(item.ticket, item.bushels)).join(""), "Other Bu.")}
      </section>`;
  }

  function simpleTicketList(jobTicketList) {
    if (!jobTicketList.length) return `<div class="fv-ahj-empty">No tickets are linked to this hauling job yet.</div>`;
    return ticketTable(jobTicketList.map(ticket => ticketRow(ticket, ticketBushels(ticket))).join(""), "Bushels");
  }

  function ensureStyles() {
    if (document.getElementById("fv-ahj-contract-drilldown-style")) return;
    const style = document.createElement("style");
    style.id = "fv-ahj-contract-drilldown-style";
    style.textContent = `
      #fv-ahj-modal-backdrop .modal{width:min(980px,96vw)}
      .fv-ahj-contract-block{margin-top:14px;border:1px solid var(--border,#d4d4d4);border-radius:12px;overflow:hidden;background:var(--surface,#fff)}
      .fv-ahj-contract-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:12px 14px;background:var(--surface-2,#f3f3f3);border-bottom:1px solid var(--border,#d4d4d4)}
      .fv-ahj-contract-title{font-size:.95rem;font-weight:900}
      .fv-ahj-contract-sub{margin-top:3px;font-size:.8rem;opacity:.72}
      .fv-ahj-contract-total{font-size:.82rem;font-weight:900;white-space:nowrap;text-align:right}
      .fv-ahj-contract-empty{padding:18px;text-align:center;opacity:.68}
      .fv-ahj-other-block .fv-ahj-contract-head{background:rgba(154,103,0,.08)}
      .fv-grade-alert{display:inline-flex;align-items:center;justify-content:center;min-width:42px;height:30px;padding:0 6px;border:2px solid transparent;border-radius:999px;box-sizing:border-box;font-weight:900;line-height:1}
      .fv-grade-alert.elevated{border-color:#C18413;background:rgba(193,132,19,.08)}
      .fv-grade-alert.severe{border-color:#C9444D;background:rgba(201,68,77,.10);color:#B52F38}
      [data-theme="dark"] .fv-grade-alert.severe{color:#ffb4ab}
      #harvest-modal-content td .fv-grade-alert{vertical-align:middle}
      @media(max-width:700px){.fv-ahj-contract-head{flex-direction:column}.fv-ahj-contract-total{text-align:left}}
    `;
    document.head.appendChild(style);
  }

  function showJob(job) {
    const modal = document.getElementById("fv-ahj-modal-backdrop");
    if (!modal) return;

    const jt = jobTickets(job.id);
    const totals = weighted(jt);
    const linked = linkedContracts(job.id);
    const linkedNames = [...new Set(linked.map(contractSoldUnder).filter(name => name && name !== "—"))];
    const crop = cropLabel(job?.crop || job?.commodity);

    modal.querySelector("#fv-ahj-modal-title").textContent = jobName(job);
    modal.querySelector("#fv-ahj-modal-sub").textContent = linked.length
      ? [crop, `${linked.length} linked contract${linked.length === 1 ? "" : "s"}`, linkedNames.length ? `Sold Under: ${linkedNames.join(" / ")}` : `Sold Under: ${jobSoldUnder(job)}`].filter(Boolean).join(" • ")
      : [crop, `Sold Under: ${jobSoldUnder(job)}`].filter(Boolean).join(" • ");

    modal.querySelector("#fv-ahj-summary").innerHTML = `
      <div class="detail-box"><div class="detail-label">Starting Bushels</div><div class="detail-value">${fmtBu(startingBushels(job))}</div></div>
      <div class="detail-box"><div class="detail-label">Ticketed Bushels</div><div class="detail-value">${fmtBu(totals.bushels)}</div></div>
      <div class="detail-box"><div class="detail-label">Remaining</div><div class="detail-value">${fmtBu(Math.max(0, startingBushels(job) - totals.bushels))}</div></div>
      <div class="detail-box"><div class="detail-label">Loads</div><div class="detail-value">${totals.loads}</div></div>
      <div class="detail-box"><div class="detail-label">Avg Moisture</div><div class="detail-value">${gradeMarkup(crop, "moisture", totals.moisture)}</div></div>
      <div class="detail-box"><div class="detail-label">Avg FM / Damage</div><div class="detail-value">${gradeMarkup(crop, "foreignMaterial", totals.fm)} / ${gradeMarkup(crop, "damage", totals.damage)}</div></div>`;

    modal.querySelector("#fv-ahj-ticket-list").innerHTML = linked.length
      ? `${linked.map(contract => contractBlock(contract, jt)).join("")}${otherBushelBlock(linked, jt)}`
      : simpleTicketList(jt);

    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function patchRows(section) {
    section.querySelectorAll("[data-job-id]").forEach(row => {
      const job = jobs.find(item => item.id === row.dataset.jobId);
      if (!job || !row.children[1]) return;
      const next = soldUnderNamesForJob(job);
      if (clean(row.children[1].textContent) !== clean(next)) {
        row.children[1].textContent = next;
      }
    });
  }

  function harvestCropFromModal() {
    const text = `${clean(document.getElementById("harvest-modal-title")?.textContent)} ${clean(document.getElementById("harvest-modal-subtitle")?.textContent)}`;
    return cropLabel(text.toLowerCase().includes("soy") ? "Soybeans" : text.toLowerCase().includes("corn") ? "Corn" : "");
  }

  function parseGradeCell(cell) {
    const text = clean(cell?.textContent).replace("%", "");
    const value = Number(text);
    return Number.isFinite(value) ? value : null;
  }

  function decorateHarvestAlerts() {
    const content = document.getElementById("harvest-modal-content");
    if (!content) return;
    const crop = harvestCropFromModal();
    if (!crop || crop === "—") return;

    content.querySelectorAll("table").forEach(table => {
      const headers = [...table.querySelectorAll("thead th")].map(th => norm(th.textContent));
      const metricByIndex = headers.map(header => {
        if (header.includes("moisture") || header === "mo") return "moisture";
        if (header.includes("fm") || header.includes("foreign")) return "foreignMaterial";
        if (header.includes("damage") || header === "dm") return "damage";
        return "";
      });

      table.querySelectorAll("tbody tr").forEach(row => {
        [...row.children].forEach((cell, index) => {
          const metric = metricByIndex[index];
          if (!metric || cell.querySelector(".fv-grade-alert")) return;
          const value = parseGradeCell(cell);
          if (value === null) return;
          cell.innerHTML = gradeMarkup(crop, metric, value);
        });
      });
    });
  }

  async function install() {
    const section = document.getElementById("fv-active-hauling-jobs-section");
    const modal = document.getElementById("fv-ahj-modal-backdrop");
    if (!section || !modal) return false;

    ensureStyles();

    const [jobSnap, contractSnap, ticketSnap, alertSnap] = await Promise.all([
      getDocs(collection(db, "grain_hauling_jobs")),
      getDocs(collection(db, "grain_contracts")),
      getDocs(collection(db, "grain_tickets")),
      getDoc(doc(db, "settings", "grainTicketAlerts")).catch(() => null)
    ]);

    if (alertSnap?.exists?.()) {
      const saved = alertSnap.data() || {};
      alertSettings = {
        ...DEFAULT_ALERTS,
        ...saved,
        crops: {
          ...DEFAULT_ALERTS.crops,
          ...(saved.crops || {}),
          corn: { ...DEFAULT_ALERTS.crops.corn, ...(saved.crops?.corn || {}) },
          soybeans: { ...DEFAULT_ALERTS.crops.soybeans, ...(saved.crops?.soybeans || {}) }
        }
      };
    }

    jobs = jobSnap.docs.map(snapshot => ({ id: snapshot.id, ...(snapshot.data() || {}) }));
    contracts = contractSnap.docs.map(snapshot => ({ id: snapshot.id, ...(snapshot.data() || {}) }));
    tickets = ticketSnap.docs.map(snapshot => ({ id: snapshot.id, ...(snapshot.data() || {}) }));

    patchRows(section);

    section.addEventListener("click", event => {
      const row = event.target.closest?.("[data-job-id]");
      if (!row || !section.contains(row)) return;
      const job = jobs.find(item => item.id === row.dataset.jobId);
      if (!job) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      showJob(job);
    }, true);

    const sectionObserver = new MutationObserver(() => patchRows(section));
    sectionObserver.observe(section, { childList: true, subtree: true });

    const harvestModal = document.getElementById("harvest-modal-backdrop");
    let harvestTimer = 0;
    const scheduleHarvestDecorate = () => {
      clearTimeout(harvestTimer);
      harvestTimer = window.setTimeout(decorateHarvestAlerts, 0);
    };
    const harvestObserver = harvestModal ? new MutationObserver(scheduleHarvestDecorate) : null;
    harvestObserver?.observe(harvestModal, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    document.addEventListener("click", event => {
      if (event.target.closest?.("[data-harvest-crop],[data-harvest-field],#harvest-field-back")) setTimeout(decorateHarvestAlerts, 0);
    }, true);

    window.addEventListener("pagehide", () => {
      sectionObserver.disconnect();
      harvestObserver?.disconnect();
      clearTimeout(harvestTimer);
    }, { once: true });

    return true;
  }

  async function waitForInstall() {
    if (document.readyState === "loading") {
      await new Promise(resolve => document.addEventListener("DOMContentLoaded", resolve, { once: true }));
    }
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (await install()) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  waitForInstall().catch(error => {
    console.error("[FarmVista] Hauling job contract drill-down failed:", error);
  });
}
