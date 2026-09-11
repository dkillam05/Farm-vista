// FarmVista — Grain Inventory hauling-job contract drill-down
// Added 2026-09-11
// Shows linked contracts under each hauling job, then the tickets allocated to
// each contract, while keeping the hauling-job summary as the roll-up total.

import {
  ready,
  getFirestore,
  collection,
  getDocs
} from "/js/firebase-init.js";

await ready;

if (!String(location.pathname || "").toLowerCase().endsWith("/pages/grain/index.html")) {
  // This helper is intentionally scoped to Grain Inventory only.
} else {
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
    .replace(/"/g, "&quot;")
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

  let jobs = [];
  let contracts = [];
  let tickets = [];

  function ticketAllocations(ticket) {
    if (!ticket || isTicketVoided(ticket)) return [];

    if (Array.isArray(ticket.contractAllocations)) {
      return ticket.contractAllocations
        .map(allocation => ({
          contractId: clean(allocation?.contractId),
          bushels: Math.max(0, num(allocation?.bushels))
        }))
        .filter(allocation => allocation.contractId && allocation.bushels > 0.005);
    }

    const legacyContractId = clean(ticket.contractId);
    return legacyContractId
      ? [{ contractId: legacyContractId, bushels: ticketBushels(ticket) }]
      : [];
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
    let total = 0;
    let mo = 0, moW = 0;
    let fm = 0, fmW = 0;
    let damage = 0, damageW = 0;

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
    const names = linkedContracts(job.id)
      .map(contractSoldUnder)
      .filter(name => name && name !== "—");

    const unique = [...new Set(names)];
    if (unique.length) return unique.join(" / ");
    return jobSoldUnder(job);
  }

  function ticketRow(ticket, bushels) {
    return `
      <tr>
        <td><a class="fv-ahj-ticket-link" href="/pages/grain/grain-ticket-detail.html?id=${encodeURIComponent(ticket.id)}">${esc(ticketNumber(ticket))}</a></td>
        <td>${esc(ticketDate(ticket) || "—")}</td>
        <td>${esc(ticketDriver(ticket))}</td>
        <td>${fmtBu(bushels)}</td>
        <td>${fmtGrade(ticket?.moisture ?? ticket?.mo)}</td>
        <td>${fmtGrade(ticket?.foreignMaterial ?? ticket?.fm)}</td>
        <td>${fmtGrade(ticket?.damage ?? ticket?.dm)}</td>
      </tr>`;
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
        ${contractTickets.length ? `
          <div class="table-wrap">
            <table class="harvest-drill-table">
              <thead><tr><th>Ticket #</th><th>Date</th><th>Driver</th><th>Contract Bu.</th><th>MO</th><th>FM</th><th>Damage</th></tr></thead>
              <tbody>${contractTickets.map(item => ticketRow(item.ticket, item.bushels)).join("")}</tbody>
            </table>
          </div>` : `<div class="fv-ahj-contract-empty">No tickets are assigned to this contract yet.</div>`}
      </section>`;
  }

  function otherBushelBlock(linked, jobTicketList) {
    const linkedIds = new Set(linked.map(contract => contract.id));
    const other = jobTicketList
      .map(ticket => {
        const linkedAllocated = ticketAllocations(ticket)
          .filter(allocation => linkedIds.has(allocation.contractId))
          .reduce((sum, allocation) => sum + allocation.bushels, 0);
        return { ticket, bushels: Math.max(0, ticketBushels(ticket) - linkedAllocated) };
      })
      .filter(item => item.bushels > 0.005);

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
        <div class="table-wrap">
          <table class="harvest-drill-table">
            <thead><tr><th>Ticket #</th><th>Date</th><th>Driver</th><th>Other Bu.</th><th>MO</th><th>FM</th><th>Damage</th></tr></thead>
            <tbody>${other.map(item => ticketRow(item.ticket, item.bushels)).join("")}</tbody>
          </table>
        </div>
      </section>`;
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

    modal.querySelector("#fv-ahj-modal-title").textContent = jobName(job);
    modal.querySelector("#fv-ahj-modal-sub").textContent = [
      cropLabel(job?.crop || job?.commodity),
      `${linked.length} linked contract${linked.length === 1 ? "" : "s"}`,
      linkedNames.length ? `Sold Under: ${linkedNames.join(" / ")}` : `Sold Under: ${jobSoldUnder(job)}`
    ].filter(Boolean).join(" • ");

    modal.querySelector("#fv-ahj-summary").innerHTML = `
      <div class="detail-box"><div class="detail-label">Starting Bushels</div><div class="detail-value">${fmtBu(startingBushels(job))}</div></div>
      <div class="detail-box"><div class="detail-label">Ticketed Bushels</div><div class="detail-value">${fmtBu(totals.bushels)}</div></div>
      <div class="detail-box"><div class="detail-label">Remaining</div><div class="detail-value">${fmtBu(Math.max(0, startingBushels(job) - totals.bushels))}</div></div>
      <div class="detail-box"><div class="detail-label">Loads</div><div class="detail-value">${totals.loads}</div></div>
      <div class="detail-box"><div class="detail-label">Avg Moisture</div><div class="detail-value">${fmtGrade(totals.moisture)}</div></div>
      <div class="detail-box"><div class="detail-label">Avg FM / Damage</div><div class="detail-value">${fmtGrade(totals.fm)} / ${fmtGrade(totals.damage)}</div></div>`;

    const content = linked.length
      ? `${linked.map(contract => contractBlock(contract, jt)).join("")}${otherBushelBlock(linked, jt)}`
      : (jt.length
          ? `${otherBushelBlock([], jt)}`
          : `<div class="fv-ahj-empty">No tickets are linked to this hauling job yet.</div>`);

    modal.querySelector("#fv-ahj-ticket-list").innerHTML = content;
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function patchRows(section) {
    section.querySelectorAll("[data-job-id]").forEach(row => {
      const job = jobs.find(item => item.id === row.dataset.jobId);
      if (!job) return;
      if (row.children[1]) row.children[1].textContent = soldUnderNamesForJob(job);
    });
  }

  async function install() {
    const section = document.getElementById("fv-active-hauling-jobs-section");
    const modal = document.getElementById("fv-ahj-modal-backdrop");
    if (!section || !modal) return false;

    ensureStyles();

    const [jobSnap, contractSnap, ticketSnap] = await Promise.all([
      getDocs(collection(db, "grain_hauling_jobs")),
      getDocs(collection(db, "grain_contracts")),
      getDocs(collection(db, "grain_tickets"))
    ]);

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

    const observer = new MutationObserver(() => patchRows(section));
    observer.observe(section, { childList: true, subtree: true });
    window.addEventListener("pagehide", () => observer.disconnect(), { once: true });

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
