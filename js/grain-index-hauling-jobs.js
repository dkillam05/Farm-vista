/* FarmVista — Grain Index hauling jobs
   Sept. 13, 2026

   Keeps the Grain Index dashboard in sync with the hauling-job date-window rules.
   Zero-bushel hauling jobs are Spot Loads:
     • Upcoming before delivery start
     • Active during the delivery window
     • Completed after delivery end
   Active and Upcoming jobs are shown on Grain Index. Completed/closed/voided/past-due
   jobs stay off the dashboard.
*/

import {
  ready,
  getFirestore,
  collection,
  getDocs
} from "/js/firebase-init.js";

await ready;

if (!window.__FV_GRAIN_INDEX_HAULING_JOBS_20260913_V1) {
  window.__FV_GRAIN_INDEX_HAULING_JOBS_20260913_V1 = true;

  const db = getFirestore();
  const clean = value => String(value ?? "").trim();
  const norm = value => clean(value).toLowerCase();
  const num = value => {
    const n = Number(String(value ?? "").replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  };
  const esc = value => clean(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

  function localISO(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function startDate(job) {
    return clean(job?.deliveryStartDate || job?.startDate);
  }

  function endDate(job) {
    return clean(job?.deliveryEndDate || job?.endDate);
  }

  function startingBushels(job) {
    return Math.max(0, num(job?.startingBushels ?? job?.jobBushels ?? job?.bushels));
  }

  function ticketIsVoided(ticket) {
    return ticket?.voided === true || norm(ticket?.status).includes("void");
  }

  function ticketedBushels(job, tickets) {
    const id = clean(job?.id);
    return tickets
      .filter(ticket => !ticketIsVoided(ticket) && clean(ticket?.haulingJobId) === id)
      .reduce((sum, ticket) => sum + num(ticket?.netBushels ?? ticket?.netBu ?? ticket?.bushels), 0);
  }

  function remainingBushels(job, tickets) {
    return Math.max(0, startingBushels(job) - ticketedBushels(job, tickets));
  }

  function status(job, tickets) {
    if (job?.manualClosed === true) return "closed";

    const raw = norm(job?.status);
    if (job?.active === false || raw.includes("void")) return "voided";
    if (raw.includes("closed") || raw.includes("cancel")) return "closed";

    const start = startDate(job);
    const end = endDate(job);
    const today = localISO();
    const total = startingBushels(job);
    const remaining = remainingBushels(job, tickets);

    // Explicitly keep Spot Loads date-driven. A zero-bushel job must never
    // look completed merely because remaining bushels are zero.
    if (total <= 0.005) {
      if (start && start > today) return "upcoming";
      if (end && end < today) return "complete";
      return "active";
    }

    if (raw.includes("complete") || (total > 0 && remaining <= 0.005)) return "complete";
    if (start && start > today) return "upcoming";
    if (end && end < today) return remaining > 0.005 ? "past_due" : "complete";
    return "active";
  }

  function fmtBu(value) {
    return num(value).toLocaleString("en-US", { maximumFractionDigits: 2 });
  }

  function fmtDate(iso) {
    const parts = clean(iso).split("-").map(Number);
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return "—";
    return `${parts[1]}/${parts[2]}/${parts[0]}`;
  }

  function jobBuyer(job) {
    return clean(job?.buyerName || job?.buyer) || "—";
  }

  function jobLocation(job) {
    return clean(job?.deliveryLocationName || job?.locationName || job?.destinationName || job?.destination) || "—";
  }

  function jobCrop(job) {
    return clean(job?.crop || job?.commodity || job?.cropName || job?.cropType) || "—";
  }

  function jobCustomer(job, customersById) {
    const saved = clean(job?.customerName || job?.soldUnderName || job?.grainCustomerName);
    if (saved) return saved;
    const id = clean(job?.customerId || job?.grainCustomerId);
    return clean(customersById.get(id)?.name || customersById.get(id)?.customerName) || "—";
  }

  function jobName(job) {
    const saved = clean(job?.displayName || job?.jobName || job?.haulingJobName);
    if (saved) return saved;

    const buyer = jobBuyer(job);
    const location = jobLocation(job);
    const place = buyer !== "—" && location !== "—" && !norm(location).startsWith(norm(buyer))
      ? `${buyer} ${location}`
      : (location !== "—" ? location : buyer);

    return startingBushels(job) <= 0.005
      ? `${place} — Spot Loads`
      : `${place} — ${fmtBu(startingBushels(job))} bu`;
  }

  function installStyles() {
    if (document.getElementById("fv-grain-index-hauling-jobs-style")) return;
    const style = document.createElement("style");
    style.id = "fv-grain-index-hauling-jobs-style";
    style.textContent = `
      #fv-active-hauling-jobs-section .fv-ahj-table{width:100%;border-collapse:collapse;min-width:1180px}
      #fv-active-hauling-jobs-section .fv-ahj-table th{padding:10px 12px;background:var(--surface-2,#f3f3f3);border-bottom:1px solid var(--border,#d4d4d4);font-size:.78rem;font-weight:800;text-align:center;white-space:nowrap}
      #fv-active-hauling-jobs-section .fv-ahj-table td{padding:11px 12px;border-bottom:1px solid var(--border,#e1e1e1);font-size:.88rem;vertical-align:middle;text-align:center}
      #fv-active-hauling-jobs-section .fv-ahj-table td:nth-child(2){text-align:left;font-weight:800}
      #fv-active-hauling-jobs-section .fv-ahj-group-row td{padding:10px 12px;text-align:left!important;font-weight:900;background:rgba(79,113,143,.08)}
      #fv-active-hauling-jobs-section .fv-ahj-group-row.upcoming td{background:rgba(154,103,0,.08)}
      .fv-ahj-status{display:inline-flex;align-items:center;justify-content:center;min-width:78px;padding:5px 9px;border-radius:999px;font-size:.76rem;font-weight:850;white-space:nowrap}
      .fv-ahj-status.active{background:rgba(59,126,70,.14);color:#2d6937}
      .fv-ahj-status.upcoming{background:rgba(154,103,0,.13);color:#8a5c00}
      [data-theme="dark"] .fv-ahj-status.active{color:#b9e4bf}
      [data-theme="dark"] .fv-ahj-status.upcoming{color:#f4ca78}
      .fv-ahj-spot{font-weight:850}
    `;
    document.head.appendChild(style);
  }

  function ensureSection() {
    let section = document.getElementById("fv-active-hauling-jobs-section");
    if (section) return section;

    const harvestSection = document.getElementById("active-harvest-section")?.closest("section.workspace-section");
    if (!harvestSection) return null;

    section = document.createElement("section");
    section.className = "workspace-section";
    section.innerHTML = `
      <div class="inventory-card" id="fv-active-hauling-jobs-section">
        <div class="inventory-head">
          <div>
            <h2 class="inventory-title">Hauling Jobs</h2>
            <div class="inventory-sub">Current and upcoming hauling jobs, including Spot Loads during their valid delivery windows.</div>
          </div>
        </div>
        <div class="inventory-body">
          <div class="table-wrap">
            <table class="fv-ahj-table inventory-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Hauling Job</th>
                  <th>Buyer</th>
                  <th>Location</th>
                  <th>Sold Under</th>
                  <th>Crop</th>
                  <th>Starting Bu.</th>
                  <th>Ticketed Bu.</th>
                  <th>Remaining Bu.</th>
                  <th>Delivery Window</th>
                </tr>
              </thead>
              <tbody id="fv-grain-index-hauling-jobs-tbody">
                <tr><td colspan="10" class="empty-row">Loading hauling jobs…</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
    harvestSection.parentNode.insertBefore(section, harvestSection);
    return document.getElementById("fv-active-hauling-jobs-section");
  }

  function rowHtml(job, stateName, tickets, customersById) {
    const total = startingBushels(job);
    const ticketed = ticketedBushels(job, tickets);
    const remaining = remainingBushels(job, tickets);
    const spot = total <= 0.005;
    return `
      <tr data-hauling-job-id="${esc(job.id)}">
        <td><span class="fv-ahj-status ${stateName}">${stateName === "active" ? "Active" : "Upcoming"}</span></td>
        <td>${esc(jobName(job))}</td>
        <td>${esc(jobBuyer(job))}</td>
        <td>${esc(jobLocation(job))}</td>
        <td>${esc(jobCustomer(job, customersById))}</td>
        <td>${esc(jobCrop(job))}</td>
        <td class="num-cell ${spot ? "fv-ahj-spot" : ""}">${spot ? "Spot Load" : fmtBu(total)}</td>
        <td class="num-cell">${fmtBu(ticketed)}</td>
        <td class="num-cell">${spot ? "—" : fmtBu(remaining)}</td>
        <td>${esc(fmtDate(startDate(job)))} – ${esc(fmtDate(endDate(job)))}</td>
      </tr>
    `;
  }

  async function render() {
    installStyles();
    const section = ensureSection();
    if (!section) return;
    const tbody = document.getElementById("fv-grain-index-hauling-jobs-tbody");
    if (!tbody) return;

    try {
      const [jobSnap, ticketSnap, customerSnap] = await Promise.all([
        getDocs(collection(db, "grain_hauling_jobs")),
        getDocs(collection(db, "grain_tickets")),
        getDocs(collection(db, "grain_customers"))
      ]);

      const jobs = jobSnap.docs.map(ds => ({ id: ds.id, ...(ds.data() || {}) }));
      const tickets = ticketSnap.docs.map(ds => ({ id: ds.id, ...(ds.data() || {}) }));
      const customersById = new Map(customerSnap.docs.map(ds => [ds.id, ds.data() || {}]));

      const active = jobs.filter(job => status(job, tickets) === "active");
      const upcoming = jobs.filter(job => status(job, tickets) === "upcoming");

      active.sort((a, b) => jobName(a).localeCompare(jobName(b), undefined, { numeric: true, sensitivity: "base" }));
      upcoming.sort((a, b) => startDate(a).localeCompare(startDate(b)) || jobName(a).localeCompare(jobName(b), undefined, { numeric: true, sensitivity: "base" }));

      let html = "";
      if (active.length) {
        html += `<tr class="fv-ahj-group-row"><td colspan="10">Active Hauling Jobs</td></tr>`;
        html += active.map(job => rowHtml(job, "active", tickets, customersById)).join("");
      }
      if (upcoming.length) {
        html += `<tr class="fv-ahj-group-row upcoming"><td colspan="10">Upcoming Hauling Jobs</td></tr>`;
        html += upcoming.map(job => rowHtml(job, "upcoming", tickets, customersById)).join("");
      }

      tbody.innerHTML = html || `<tr><td colspan="10" class="empty-row">No active or upcoming hauling jobs.</td></tr>`;

      // Allow existing Grain Index sort/remaining helpers to redecorate this live table.
      document.dispatchEvent(new CustomEvent("fv:grain-index-hauling-jobs-rendered"));
    } catch (error) {
      console.warn("[Grain Index] Could not load hauling jobs:", error);
      tbody.innerHTML = `<tr><td colspan="10" class="empty-row">Hauling jobs could not be loaded.</td></tr>`;
    }
  }

  const start = () => {
    render();
    document.addEventListener("fv:grain-inventory-posted", render);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") render();
    });
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}
