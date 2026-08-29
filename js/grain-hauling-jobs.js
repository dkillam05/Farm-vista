// /js/grain-hauling-jobs.js
// FarmVista — Hauling Jobs / Contract Planning Link
//
// PURPOSE
// - Keeps Hauling Job planning separate from grain-contracts.js.
// - Creates and renders grain_hauling_jobs.
// - Lets a contract be linked to ONE hauling job.
// - DOES NOT alter grain-ticket contract allocations.
// - DOES NOT alter contract delivered/open bushels.
// - DOES NOT alter ticket-to-contract reconciliation.

import {
  ready,
  getFirestore,
  getAuth,
  collection,
  getDocs,
  addDoc,
  doc,
  updateDoc,
  serverTimestamp
} from "/js/firebase-init.js";

await ready;

const db = getFirestore();
const auth = getAuth();

const JOB_COLLECTION = "grain_hauling_jobs";
const CONTRACT_COLLECTION = "grain_contracts";
const TICKET_COLLECTION = "grain_tickets";
const BUYER_COLLECTION = "grain_buyers";
const CUSTOMER_COLLECTION = "grain_customers";
const LOCATION_COLLECTION = "grain_delivery_locations";

const EPSILON = 0.005;

const $ = id =>
  document.getElementById(id);

const clean = value =>
  String(value ?? "").trim();

const normalized = value =>
  clean(value).toLowerCase();

const numberValue = value => {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : 0;
};

const roundBushels = value =>
  Number(
    numberValue(value)
      .toFixed(2)
  );


function escapeHtml(value) {

  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

}


function formatBushels(value) {

  return numberValue(value)
    .toLocaleString(
      "en-US",
      {
        maximumFractionDigits: 2
      }
    );

}


function formatDate(iso) {

  const parts =
    clean(iso)
      .split("-");


  if (
    parts.length !== 3
  ) {

    return clean(iso) || "—";

  }


  return `${
    Number(parts[1])
  }/${
    Number(parts[2])
  }/${
    parts[0]
  }`;

}


function localISO(
  date = new Date()
) {

  return `${
    date.getFullYear()
  }-${
    String(
      date.getMonth() + 1
    ).padStart(
      2,
      "0"
    )
  }-${
    String(
      date.getDate()
    ).padStart(
      2,
      "0"
    )
  }`;

}


function uniqueSorted(values) {

  return [
    ...new Set(
      values
        .map(clean)
        .filter(Boolean)
    )
  ]
    .sort(
      (a, b) =>
        a.localeCompare(
          b,
          undefined,
          {
            numeric: true,
            sensitivity: "base"
          }
        )
    );

}


const state = {

  jobs: [],

  contracts: [],

  tickets: [],

  buyers: [],

  customers: [],

  locations: [],

  draggingContractId: "",

  busy: false,

  contractObserver: null,

  decorateQueued: false

};


/* ============================================================
   HAULING JOB HELPERS
============================================================ */

function jobStartingBushels(job) {

  return Math.max(
    0,
    numberValue(
      job?.startingBushels ??
      job?.jobBushels ??
      job?.bushels
    )
  );

}


function ticketBelongsToJob(
  ticket,
  jobId
) {

  return (
    !ticket?.voided &&
    clean(
      ticket?.haulingJobId
    ) ===
    clean(jobId)
  );

}


function jobTicketedBushels(job) {

  return roundBushels(
    state.tickets
      .filter(
        ticket =>
          ticketBelongsToJob(
            ticket,
            job.id
          )
      )
      .reduce(
        (
          total,
          ticket
        ) =>
          total +
          numberValue(
            ticket.netBushels
          ),
        0
      )
  );

}


function jobRemainingBushels(job) {

  return roundBushels(
    Math.max(
      0,
      jobStartingBushels(job) -
      jobTicketedBushels(job)
    )
  );

}


function jobBuyerId(job) {

  return clean(
    job?.buyerId
  );

}


function jobCustomerId(job) {

  return clean(
    job?.customerId
  );

}


function jobLocationId(job) {

  return clean(
    job?.deliveryLocationId ||
    job?.locationId ||
    job?.destinationId
  );

}


function jobCrop(job) {

  return clean(
    job?.crop ||
    job?.commodity
  );

}


function jobDisplayName(job) {

  const saved =
    clean(
      job?.displayName ||
      job?.jobName ||
      job?.haulingJobName
    );


  if (saved) {

    return saved;

  }


  const buyer =
    clean(
      job?.buyerName
    );


  const location =
    clean(
      job?.deliveryLocationName ||
      job?.locationName ||
      job?.destinationName
    );


  const place =
    buyer &&
    location &&
    !normalized(
      location
    ).startsWith(
      normalized(
        buyer
      )
    )
      ? `${
          buyer
        } ${
          location
        }`
      : (
          location ||
          buyer ||
          "Hauling Job"
        );


  return `${
    place
  } — ${
    formatBushels(
      jobStartingBushels(
        job
      )
    )
  } bu`;

}


function jobDeliveryWindow(job) {

  const start =
    clean(
      job?.deliveryStartDate ||
      job?.startDate
    );


  const end =
    clean(
      job?.deliveryEndDate ||
      job?.endDate
    );


  if (
    start &&
    end
  ) {

    return `${
      formatDate(start)
    } – ${
      formatDate(end)
    }`;

  }


  return start
    ? formatDate(start)
    : end
      ? formatDate(end)
      : "—";

}


function jobStatus(job) {

  const raw =
    normalized(
      job?.status ||
      "active"
    );


  if (
    raw.includes(
      "closed"
    ) ||
    raw.includes(
      "cancel"
    ) ||
    raw.includes(
      "void"
    ) ||
    job?.active === false
  ) {

    return "closed";

  }


  const starting =
    jobStartingBushels(
      job
    );


  const remaining =
    jobRemainingBushels(
      job
    );


  if (
    starting > 0 &&
    remaining <=
    EPSILON
  ) {

    return "complete";

  }


  const today =
    localISO();


  const start =
    clean(
      job?.deliveryStartDate ||
      job?.startDate
    );


  if (
    start &&
    start > today
  ) {

    return "upcoming";

  }


  return "active";

}


function jobStatusLabel(job) {

  return {

    active:
      "Active",

    upcoming:
      "Upcoming",

    complete:
      "Completed",

    closed:
      "Closed"

  }[
    jobStatus(job)
  ] || "Active";

}


function jobStatusClass(job) {

  return `status-job-${
    jobStatus(job)
  }`;

}


function contractsForJob(jobId) {

  return state.contracts
    .filter(
      contract =>
        clean(
          contract.haulingJobId
        ) ===
        clean(jobId)
    );

}


/* ============================================================
   CONTRACT HELPERS
============================================================ */

function contractBuyerId(contract) {

  return clean(
    contract?.buyerId
  );

}


function contractCustomerId(contract) {

  return clean(
    contract?.customerId
  );

}


function contractLocationId(contract) {

  return clean(
    contract?.deliveryLocationId ||
    contract?.locationId ||
    contract?.destinationId
  );

}


function contractCrop(contract) {

  return clean(
    contract?.crop ||
    contract?.commodity
  );

}


function contractDisplayNumber(
  contract
) {

  return clean(
    contract?.contractNumber ||
    contract?.number ||
    contract?.contractNo ||
    contract?.referenceNumber
  ) ||
  contract?.id ||
  "Contract";

}


function linkedJob(contract) {

  const jobId =
    clean(
      contract?.haulingJobId
    );


  if (!jobId) {

    return null;

  }


  return state.jobs.find(
    job =>
      job.id ===
      jobId
  ) ||
  null;

}


function validateContractJobMatch(
  contract,
  job
) {

  if (
    !contract ||
    !job
  ) {

    return "Contract or hauling job was not found.";

  }


  if (
    contract?.voided
  ) {

    return "Voided contracts cannot be linked to a hauling job.";

  }


  if (
    jobStatus(job) ===
    "closed"
  ) {

    return "Closed hauling jobs cannot receive contracts.";

  }


  if (
    contractBuyerId(
      contract
    ) !==
    jobBuyerId(
      job
    )
  ) {

    return "Buyer does not match this hauling job.";

  }


  if (
    contractCustomerId(
      contract
    ) !==
    jobCustomerId(
      job
    )
  ) {

    return "Sold Under does not match this hauling job.";

  }


  if (
    contractLocationId(
      contract
    ) !==
    jobLocationId(
      job
    )
  ) {

    return "Delivery Location does not match this hauling job.";

  }


  if (
    normalized(
      contractCrop(
        contract
      )
    ) !==
    normalized(
      jobCrop(
        job
      )
    )
  ) {

    return "Crop does not match this hauling job.";

  }


  return "";

}


/* ============================================================
   LOAD DATA
============================================================ */

async function loadData() {

  const [
    jobSnapshot,
    contractSnapshot,
    ticketSnapshot,
    buyerSnapshot,
    customerSnapshot,
    locationSnapshot
  ] =
    await Promise.all([

      getDocs(
        collection(
          db,
          JOB_COLLECTION
        )
      ),

      getDocs(
        collection(
          db,
          CONTRACT_COLLECTION
        )
      ),

      getDocs(
        collection(
          db,
          TICKET_COLLECTION
        )
      ),

      getDocs(
        collection(
          db,
          BUYER_COLLECTION
        )
      ),

      getDocs(
        collection(
          db,
          CUSTOMER_COLLECTION
        )
      ),

      getDocs(
        collection(
          db,
          LOCATION_COLLECTION
        )
      )

    ]);


  state.jobs =
    jobSnapshot.docs
      .map(
        snapshot => ({

          id:
            snapshot.id,

          ...snapshot.data()

        })
      );


  state.contracts =
    contractSnapshot.docs
      .map(
        snapshot => ({

          id:
            snapshot.id,

          ...snapshot.data()

        })
      );


  state.tickets =
    ticketSnapshot.docs
      .map(
        snapshot => ({

          id:
            snapshot.id,

          ...snapshot.data()

        })
      );


  state.buyers =
    buyerSnapshot.docs
      .map(
        snapshot => ({

          id:
            snapshot.id,

          name:
            clean(
              snapshot.data()
                ?.name
            )

        })
      )
      .filter(
        item =>
          item.name
      )
      .sort(
        (
          a,
          b
        ) =>
          a.name.localeCompare(
            b.name,
            undefined,
            {
              numeric: true,
              sensitivity: "base"
            }
          )
      );


  state.customers =
    customerSnapshot.docs
      .map(
        snapshot => ({

          id:
            snapshot.id,

          name:
            clean(
              snapshot.data()
                ?.name
            )

        })
      )
      .filter(
        item =>
          item.name
      )
      .sort(
        (
          a,
          b
        ) =>
          a.name.localeCompare(
            b.name,
            undefined,
            {
              numeric: true,
              sensitivity: "base"
            }
          )
      );


  state.locations =
    locationSnapshot.docs
      .map(
        snapshot => {

          const data =
            snapshot.data() ||
            {};


          return {

            id:
              snapshot.id,

            buyerId:
              clean(
                data.buyerId
              ),

            buyerName:
              clean(
                data.buyerName
              ),

            locationName:
              clean(
                data.locationName
              ),

            street:
              clean(
                data.street
              ),

            city:
              clean(
                data.city
              ),

            state:
              clean(
                data.state
              ),

            zip:
              clean(
                data.zip
              )

          };

        }
      )
      .filter(
        item =>
          item.locationName
      )
      .sort(
        (
          a,
          b
        ) =>
          a.locationName
            .localeCompare(
              b.locationName,
              undefined,
              {
                numeric: true,
                sensitivity: "base"
              }
            )
      );

}


/* ============================================================
   FILTER HELPERS
============================================================ */

function populateSimpleFilter(
  select,
  values
) {

  if (!select) {

    return;

  }


  const current =
    select.value;


  const first =
    select.options[0]
      ?.cloneNode(
        true
      );


  select.innerHTML =
    "";


  if (first) {

    select.appendChild(
      first
    );

  }


  values.forEach(
    value => {

      const option =
        document.createElement(
          "option"
        );


      option.value =
        value;


      option.textContent =
        value;


      select.appendChild(
        option
      );

    }
  );


  if (
    [
      ...select.options
    ].some(
      option =>
        option.value ===
        current
    )
  ) {

    select.value =
      current;

  }

}


function populateHaulingFilters() {

  populateSimpleFilter(
    $(
      "hauling-crop-filter"
    ),
    uniqueSorted(
      state.jobs.map(
        job =>
          jobCrop(job)
      )
    )
  );


  populateSimpleFilter(
    $(
      "hauling-buyer-filter"
    ),
    uniqueSorted(
      state.jobs.map(
        job =>
          job.buyerName
      )
    )
  );


  populateSimpleFilter(
    $(
      "hauling-customer-filter"
    ),
    uniqueSorted(
      state.jobs.map(
        job =>
          job.customerName
      )
    )
  );

}


function filteredJobs() {

  const search =
    normalized(
      $(
        "hauling-search-filter"
      )
        ?.value
    );


  const statusFilter =
    $(
      "hauling-status-filter"
    )
      ?.value ||
    "active";


  const crop =
    $(
      "hauling-crop-filter"
    )
      ?.value ||
    "";


  const buyer =
    $(
      "hauling-buyer-filter"
    )
      ?.value ||
    "";


  const customer =
    $(
      "hauling-customer-filter"
    )
      ?.value ||
    "";


  return state.jobs
    .filter(
      job => {

        const status =
          jobStatus(
            job
          );


        if (
          statusFilter ===
            "active" &&
          ![
            "active",
            "upcoming"
          ].includes(
            status
          )
        ) {

          return false;

        }


        if (
          statusFilter ===
            "active_only" &&
          status !==
            "active"
        ) {

          return false;

        }


        if (
          statusFilter ===
            "upcoming" &&
          status !==
            "upcoming"
        ) {

          return false;

        }


        if (
          statusFilter ===
            "complete" &&
          status !==
            "complete"
        ) {

          return false;

        }


        if (
          statusFilter ===
            "closed" &&
          status !==
            "closed"
        ) {

          return false;

        }


        if (
          crop &&
          jobCrop(
            job
          ) !==
          crop
        ) {

          return false;

        }


        if (
          buyer &&
          clean(
            job.buyerName
          ) !==
          buyer
        ) {

          return false;

        }


        if (
          customer &&
          clean(
            job.customerName
          ) !==
          customer
        ) {

          return false;

        }


        if (search) {

          const haystack =
            [
              jobDisplayName(
                job
              ),
              job.buyerName,
              job.deliveryLocationName,
              job.customerName,
              jobCrop(job),
              job.deliveryStartDate,
              job.deliveryEndDate
            ]
              .join(" ")
              .toLowerCase();


          if (
            !haystack.includes(
              search
            )
          ) {

            return false;

          }

        }


        return true;

      }
    )
    .sort(
      (
        a,
        b
      ) => {

        const order = {

          active: 0,

          upcoming: 1,

          complete: 2,

          closed: 3

        };


        const statusCompare =
          (
            order[
              jobStatus(
                a
              )
            ] ?? 9
          ) -
          (
            order[
              jobStatus(
                b
              )
            ] ?? 9
          );


        if (
          statusCompare
        ) {

          return statusCompare;

        }


        const dateCompare =
          clean(
            a.deliveryStartDate
          )
            .localeCompare(
              clean(
                b.deliveryStartDate
              )
            );


        if (
          dateCompare
        ) {

          return dateCompare;

        }


        return jobDisplayName(
          a
        )
          .localeCompare(
            jobDisplayName(
              b
            ),
            undefined,
            {
              numeric: true,
              sensitivity: "base"
            }
          );

      }
    );

}


/* ============================================================
   HAULING JOB SUMMARY
============================================================ */

function renderHaulingSummary(
  jobs
) {

  const totals =
    jobs.reduce(
      (
        result,
        job
      ) => {

        result.starting +=
          jobStartingBushels(
            job
          );


        result.ticketed +=
          jobTicketedBushels(
            job
          );


        result.remaining +=
          jobRemainingBushels(
            job
          );


        result.contracts +=
          contractsForJob(
            job.id
          ).length;


        return result;

      },
      {

        starting: 0,

        ticketed: 0,

        remaining: 0,

        contracts: 0

      }
    );


  if (
    $(
      "hauling-summary-jobs"
    )
  ) {

    $(
      "hauling-summary-jobs"
    )
      .textContent =
        jobs.length
          .toLocaleString(
            "en-US"
          );

  }


  if (
    $(
      "hauling-summary-starting"
    )
  ) {

    $(
      "hauling-summary-starting"
    )
      .textContent =
        formatBushels(
          totals.starting
        );

  }


  if (
    $(
      "hauling-summary-delivered"
    )
  ) {

    $(
      "hauling-summary-delivered"
    )
      .textContent =
        formatBushels(
          totals.ticketed
        );

  }


  if (
    $(
      "hauling-summary-remaining"
    )
  ) {

    $(
      "hauling-summary-remaining"
    )
      .textContent =
        formatBushels(
          totals.remaining
        );

  }


  if (
    $(
      "hauling-summary-contracts"
    )
  ) {

    $(
      "hauling-summary-contracts"
    )
      .textContent =
        totals.contracts
          .toLocaleString(
            "en-US"
          );

  }

}


/* ============================================================
   HAULING JOB TABLE
============================================================ */

function renderHaulingJobs() {

  const tbody =
    $(
      "hauling-jobs-table-body"
    );


  if (!tbody) {

    return;

  }


  const jobs =
    filteredJobs();


  renderHaulingSummary(
    jobs
  );


  if (
    !jobs.length
  ) {

    tbody.innerHTML = `
      <tr>
        <td colspan="11">

          <div class="empty-state">

            <div class="empty-title">
              No Hauling Jobs Found
            </div>

            <div class="empty-sub">
              No hauling jobs match the selected filters.
            </div>

          </div>

        </td>
      </tr>
    `;


    return;

  }


  tbody.innerHTML =
    "";


  jobs.forEach(
    job => {

      const linkedContracts =
        contractsForJob(
          job.id
        );


      const row =
        document.createElement(
          "tr"
        );


      row.className =
        "hauling-row";


      row.dataset.haulingJobId =
        job.id;


      row.innerHTML = `

        <td>

          <span class="status-pill ${
            jobStatusClass(
              job
            )
          }">

            ${
              escapeHtml(
                jobStatusLabel(
                  job
                )
              )
            }

          </span>

        </td>


        <td>

          <div class="hauling-job-name">

            ${
              escapeHtml(
                jobDisplayName(
                  job
                )
              )
            }

          </div>

        </td>


        <td>
          ${
            escapeHtml(
              job.buyerName ||
              "—"
            )
          }
        </td>


        <td>
          ${
            escapeHtml(
              job.deliveryLocationName ||
              "—"
            )
          }
        </td>


        <td>
          ${
            escapeHtml(
              job.customerName ||
              "—"
            )
          }
        </td>


        <td>
          ${
            escapeHtml(
              jobCrop(
                job
              ) ||
              "—"
            )
          }
        </td>


        <td class="number-cell">
          ${
            formatBushels(
              jobStartingBushels(
                job
              )
            )
          }
        </td>


        <td class="number-cell">
          ${
            formatBushels(
              jobTicketedBushels(
                job
              )
            )
          }
        </td>


        <td class="number-cell">
          ${
            formatBushels(
              jobRemainingBushels(
                job
              )
            )
          }
        </td>


        <td class="center-cell">
          ${
            linkedContracts.length
              .toLocaleString(
                "en-US"
              )
          }
        </td>


        <td>
          ${
            escapeHtml(
              jobDeliveryWindow(
                job
              )
            )
          }
        </td>

      `;


      setupJobDesktopDrop(
        row,
        job
      );


      tbody.appendChild(
        row
      );

    }
  );

}


/* ============================================================
   CONTRACT TABLE DECORATION

   grain-contracts.js owns this table.

   This file only:
   - identifies the rendered contract
   - adds the Hauling Job cell
   - makes the row a hauling-job drag source
============================================================ */

function findContractForRenderedRow(
  row
) {

  if (
    !row ||
    row.cells.length < 10
  ) {

    return null;

  }


  const contractNumber =
    clean(
      row.cells[1]
        ?.textContent
    );


  const buyerName =
    clean(
      row.cells[2]
        ?.textContent
    );


  const customerName =
    clean(
      row.cells[3]
        ?.textContent
    );


  const crop =
    clean(
      row.cells[4]
        ?.textContent
    );


  return state.contracts.find(
    contract =>
      clean(
        contract.contractNumber
      ) ===
      contractNumber &&
      clean(
        contract.buyerName
      ) ===
      buyerName &&
      clean(
        contract.customerName
      ) ===
      customerName &&
      clean(
        contract.crop
      ) ===
      crop
  ) ||
  null;

}


function contractJobCellMarkup(
  contract
) {

  const job =
    linkedJob(
      contract
    );


  if (!job) {

    return `
      <span
        style="
          opacity:.58;
          font-weight:800;
        "
      >
        Not Linked
      </span>
    `;

  }


  return `
    <span
      style="
        font-weight:900;
      "
      title="${
        escapeHtml(
          jobDisplayName(
            job
          )
        )
      }"
    >
      ${
        escapeHtml(
          jobDisplayName(
            job
          )
        )
      }
    </span>
  `;

}


function decorateContractRows() {

  const tbody =
    $(
      "contracts-table-body"
    );


  if (!tbody) {

    return;

  }


  [
    ...tbody.rows
  ]
    .forEach(
      row => {

        const contract =
          findContractForRenderedRow(
            row
          );


        if (!contract) {

          return;

        }


        row.dataset.haulingContractId =
          contract.id;


        row.draggable =
          !state.busy &&
          !contract.voided;


        let jobCell =
          row.querySelector(
            ":scope > td[data-hauling-job-cell]"
          );


        if (!jobCell) {

          jobCell =
            document.createElement(
              "td"
            );


          jobCell.dataset.haulingJobCell =
            "1";


          /*
            grain-contracts.js puts Delivery in the final cell.
            Hauling Job belongs immediately before Delivery.
          */
          const deliveryCell =
            row.lastElementChild;


          if (
            deliveryCell
          ) {

            row.insertBefore(
              jobCell,
              deliveryCell
            );

          }
          else {

            row.appendChild(
              jobCell
            );

          }

        }


        jobCell.innerHTML =
          contractJobCellMarkup(
            contract
          );


        if (
          row.dataset
            .haulingDragBound !==
          "1"
        ) {

          row.dataset.haulingDragBound =
            "1";


          setupContractDesktopDrag(
            row,
            contract
          );

        }

      }
    );

}


function queueDecorateContractRows() {

  if (
    state.decorateQueued
  ) {

    return;

  }


  state.decorateQueued =
    true;


  requestAnimationFrame(
    () => {

      state.decorateQueued =
        false;


      decorateContractRows();

    }
  );

}


function observeContractTable() {

  const tbody =
    $(
      "contracts-table-body"
    );


  if (!tbody) {

    return;

  }


  state.contractObserver
    ?.disconnect();


  state.contractObserver =
    new MutationObserver(
      queueDecorateContractRows
    );


  state.contractObserver
    .observe(
      tbody,
      {
        childList: true,
        subtree: true
      }
    );


  queueDecorateContractRows();

}


/* ============================================================
   DESKTOP DRAG & DROP
============================================================ */

function clearDesktopHighlights() {

  document
    .querySelectorAll(
      ".hauling-row.drag-over"
    )
    .forEach(
      row =>
        row.classList.remove(
          "drag-over"
        )
    );


  $(
    "hauling-unassign-drop"
  )
    ?.classList
    .remove(
      "drag-over"
    );

}


function setupContractDesktopDrag(
  row,
  contract
) {

  row.addEventListener(
    "dragstart",
    event => {

      if (
        state.busy ||
        contract.voided
      ) {

        event.preventDefault();

        return;

      }


      state.draggingContractId =
        contract.id;


      row.classList.add(
        "dragging"
      );


      event.dataTransfer
        .effectAllowed =
          "move";


      event.dataTransfer
        .setData(
          "text/plain",
          JSON.stringify({
            type:
              "hauling-contract-link",

            contractId:
              contract.id
          })
        );

    }
  );


  row.addEventListener(
    "dragend",
    () => {

      state.draggingContractId =
        "";


      row.classList.remove(
        "dragging"
      );


      clearDesktopHighlights();

    }
  );

}


function readContractDragId(
  event
) {

  if (
    state.draggingContractId
  ) {

    return state.draggingContractId;

  }


  const raw =
    event.dataTransfer
      ?.getData(
        "text/plain"
      ) ||
    "";


  try {

    const parsed =
      JSON.parse(
        raw
      );


    if (
      parsed?.type ===
      "hauling-contract-link"
    ) {

      return clean(
        parsed.contractId
      );

    }

  }
  catch {

    return "";

  }


  return "";

}


function setupJobDesktopDrop(
  row,
  job
) {

  row.addEventListener(
    "dragover",
    event => {

      const contractId =
        state.draggingContractId;


      if (
        state.busy ||
        !contractId
      ) {

        return;

      }


      const contract =
        state.contracts.find(
          item =>
            item.id ===
            contractId
        );


      if (
        validateContractJobMatch(
          contract,
          job
        )
      ) {

        return;

      }


      event.preventDefault();


      clearDesktopHighlights();


      row.classList.add(
        "drag-over"
      );

    }
  );


  row.addEventListener(
    "dragleave",
    event => {

      if (
        event.relatedTarget &&
        row.contains(
          event.relatedTarget
        )
      ) {

        return;

      }


      row.classList.remove(
        "drag-over"
      );

    }
  );


  row.addEventListener(
    "drop",
    async event => {

      event.preventDefault();


      row.classList.remove(
        "drag-over"
      );


      const contractId =
        readContractDragId(
          event
        );


      if (!contractId) {

        return;

      }


      await linkContractToJob(
        contractId,
        job.id
      );

    }
  );

}


function setupUnassignDesktopDrop() {

  const zone =
    $(
      "hauling-unassign-drop"
    );


  if (!zone) {

    return;

  }


  zone.addEventListener(
    "dragover",
    event => {

      const contractId =
        state.draggingContractId;


      if (
        state.busy ||
        !contractId
      ) {

        return;

      }


      const contract =
        state.contracts.find(
          item =>
            item.id ===
            contractId
        );


      if (
        !contract ||
        !clean(
          contract.haulingJobId
        )
      ) {

        return;

      }


      event.preventDefault();


      clearDesktopHighlights();


      zone.classList.add(
        "drag-over"
      );

    }
  );


  zone.addEventListener(
    "dragleave",
    () => {

      zone.classList.remove(
        "drag-over"
      );

    }
  );


  zone.addEventListener(
    "drop",
    async event => {

      event.preventDefault();


      zone.classList.remove(
        "drag-over"
      );


      const contractId =
        readContractDragId(
          event
        );


      if (!contractId) {

        return;

      }


      await unlinkContractFromJob(
        contractId
      );

    }
  );

}


/* ============================================================
   LINK CONTRACT → HAULING JOB
============================================================ */

async function linkContractToJob(
  contractId,
  jobId
) {

  if (
    state.busy
  ) {

    return;

  }


  const contract =
    state.contracts.find(
      item =>
        item.id ===
        contractId
    );


  const job =
    state.jobs.find(
      item =>
        item.id ===
        jobId
    );


  const validation =
    validateContractJobMatch(
      contract,
      job
    );


  if (
    validation
  ) {

    alert(
      validation
    );


    return;

  }


  if (
    clean(
      contract.haulingJobId
    ) ===
    job.id
  ) {

    return;

  }


  const oldJob =
    linkedJob(
      contract
    );


  if (
    oldJob
  ) {

    const confirmed =
      window.confirm(
        `Contract ${
          contractDisplayNumber(
            contract
          )
        } is currently linked to ${
          jobDisplayName(
            oldJob
          )
        }.\n\nMove it to ${
          jobDisplayName(
            job
          )
        }?`
      );


    if (
      !confirmed
    ) {

      return;

    }

  }


  state.busy =
    true;


  try {

    const who =
      auth.currentUser;


    await updateDoc(
      doc(
        db,
        CONTRACT_COLLECTION,
        contract.id
      ),
      {

        haulingJobId:
          job.id,

        haulingJobName:
          jobDisplayName(
            job
          ),

        haulingJobLinkedAt:
          serverTimestamp(),

        haulingJobLinkedByUid:
          who?.uid ||
          null,

        haulingJobLinkedByName:
          who?.displayName ||
          who?.email ||
          "FarmVista User",

        haulingJobLinkedByEmail:
          who?.email ||
          null,

        updatedAt:
          serverTimestamp()

      }
    );


    /*
      IMPORTANT:
      This changes ONLY the planning link on the contract.

      It does NOT change:
      - grain ticket contractAllocations
      - contract deliveredBushels
      - contract openBushels
      - spotBushels
      - unassignedBushels
    */

    contract.haulingJobId =
      job.id;


    contract.haulingJobName =
      jobDisplayName(
        job
      );


    renderHaulingJobs();


    queueDecorateContractRows();

  }
  catch (error) {

    console.error(
      "[Hauling Jobs] Contract link failed:",
      error
    );


    alert(
      error?.message ||
      "FarmVista could not link that contract to the hauling job."
    );

  }
  finally {

    state.busy =
      false;


    state.draggingContractId =
      "";


    clearDesktopHighlights();

  }

}


/* ============================================================
   UNLINK CONTRACT FROM HAULING JOB
============================================================ */

async function unlinkContractFromJob(
  contractId
) {

  if (
    state.busy
  ) {

    return;

  }


  const contract =
    state.contracts.find(
      item =>
        item.id ===
        contractId
    );


  if (
    !contract ||
    !clean(
      contract.haulingJobId
    )
  ) {

    return;

  }


  const job =
    linkedJob(
      contract
    );


  const confirmed =
    window.confirm(
      `Remove Contract ${
        contractDisplayNumber(
          contract
        )
      } from ${
        job
          ? jobDisplayName(
              job
            )
          : "its hauling job"
      }?\n\nThis only removes the planning link. Ticket-to-contract assignments are not changed.`
    );


  if (
    !confirmed
  ) {

    return;

  }


  state.busy =
    true;


  try {

    await updateDoc(
      doc(
        db,
        CONTRACT_COLLECTION,
        contract.id
      ),
      {

        haulingJobId:
          null,

        haulingJobName:
          null,

        haulingJobLinkedAt:
          null,

        haulingJobLinkedByUid:
          null,

        haulingJobLinkedByName:
          null,

        haulingJobLinkedByEmail:
          null,

        updatedAt:
          serverTimestamp()

      }
    );


    contract.haulingJobId =
      "";


    contract.haulingJobName =
      "";


    renderHaulingJobs();


    queueDecorateContractRows();

  }
  catch (error) {

    console.error(
      "[Hauling Jobs] Contract unlink failed:",
      error
    );


    alert(
      error?.message ||
      "FarmVista could not remove that hauling-job link."
    );

  }
  finally {

    state.busy =
      false;


    state.draggingContractId =
      "";


    clearDesktopHighlights();

  }

}


/* ============================================================
   TOUCH DRAG & DROP
   Contract → Hauling Job
============================================================ */

const touchLink = {

  timer: null,

  active: false,

  contractId: "",

  row: null,

  ghost: null,

  target: null,

  startX: 0,

  startY: 0,

  previousUserSelect: ""

};


function cleanupTouchLink() {

  if (
    touchLink.timer
  ) {

    clearTimeout(
      touchLink.timer
    );

  }


  touchLink.timer =
    null;


  touchLink.row
    ?.classList
    .remove(
      "dragging"
    );


  touchLink.ghost
    ?.remove();


  document
    .querySelectorAll(
      ".hauling-row.drag-over"
    )
    .forEach(
      element =>
        element.classList.remove(
          "drag-over"
        )
    );


  $(
    "hauling-unassign-drop"
  )
    ?.classList
    .remove(
      "drag-over"
    );


  document.body.style
    .userSelect =
      touchLink.previousUserSelect;


  touchLink.active =
    false;


  touchLink.contractId =
    "";


  touchLink.row =
    null;


  touchLink.ghost =
    null;


  touchLink.target =
    null;


  touchLink.startX =
    0;


  touchLink.startY =
    0;


  touchLink.previousUserSelect =
    "";

}


function createTouchGhost(
  contract
) {

  const ghost =
    document.createElement(
      "div"
    );


  ghost.className =
    "fv-hauling-touch-ghost";


  ghost.textContent =
    `Contract ${
      contractDisplayNumber(
        contract
      )
    }`;


  Object.assign(
    ghost.style,
    {

      position:
        "fixed",

      left:
        "0",

      top:
        "0",

      zIndex:
        "999999",

      pointerEvents:
        "none",

      padding:
        "10px 14px",

      borderRadius:
        "10px",

      border:
        "2px solid #4f718f",

      background:
        "var(--surface,#fff)",

      color:
        "inherit",

      boxShadow:
        "0 10px 30px rgba(0,0,0,.25)",

      fontSize:
        ".9rem",

      fontWeight:
        "900",

      whiteSpace:
        "nowrap",

      opacity:
        ".96",

      transform:
        "translate(-50%,-120%)"

    }
  );


  document.body.appendChild(
    ghost
  );


  touchLink.ghost =
    ghost;

}


function moveTouchGhost(
  x,
  y
) {

  if (
    !touchLink.ghost
  ) {

    return;

  }


  touchLink.ghost.style.left =
    `${x}px`;


  touchLink.ghost.style.top =
    `${y}px`;

}


function touchDropTarget(
  x,
  y
) {

  if (
    !touchLink.contractId
  ) {

    return null;

  }


  const contract =
    state.contracts.find(
      item =>
        item.id ===
        touchLink.contractId
    );


  if (
    !contract
  ) {

    return null;

  }


  const element =
    document.elementFromPoint(
      x,
      y
    );


  if (
    !(element instanceof Element)
  ) {

    return null;

  }


  const unassign =
    element.closest(
      "#hauling-unassign-drop"
    );


  if (
    unassign &&
    clean(
      contract.haulingJobId
    )
  ) {

    return {

      type:
        "unassign",

      element:
        unassign

    };

  }


  const jobRow =
    element.closest(
      "[data-hauling-job-id]"
    );


  if (
    jobRow
  ) {

    const job =
      state.jobs.find(
        item =>
          item.id ===
          clean(
            jobRow.dataset
              .haulingJobId
          )
      );


    if (
      job &&
      !validateContractJobMatch(
        contract,
        job
      )
    ) {

      return {

        type:
          "job",

        jobId:
          job.id,

        element:
          jobRow

      };

    }

  }


  return null;

}


function highlightTouchTarget(
  target
) {

  document
    .querySelectorAll(
      ".hauling-row.drag-over"
    )
    .forEach(
      element =>
        element.classList.remove(
          "drag-over"
        )
    );


  $(
    "hauling-unassign-drop"
  )
    ?.classList
    .remove(
      "drag-over"
    );


  touchLink.target =
    target;


  target?.element
    ?.classList
    .add(
      "drag-over"
    );

}


function beginTouchLink(
  row,
  contract,
  touch
) {

  if (
    state.busy ||
    contract.voided
  ) {

    return;

  }


  touchLink.active =
    true;


  touchLink.contractId =
    contract.id;


  touchLink.row =
    row;


  row.classList.add(
    "dragging"
  );


  touchLink.previousUserSelect =
    document.body.style
      .userSelect;


  document.body.style
    .userSelect =
      "none";


  createTouchGhost(
    contract
  );


  moveTouchGhost(
    touch.clientX,
    touch.clientY
  );


  highlightTouchTarget(
    touchDropTarget(
      touch.clientX,
      touch.clientY
    )
  );

}


function setupTouchContractLinking() {

  document.addEventListener(
    "touchstart",
    event => {

      if (
        state.busy ||
        event.touches.length !==
        1
      ) {

        return;

      }


      const target =
        event.target;


      if (
        !(target instanceof Element)
      ) {

        return;

      }


      /*
        Don't steal touch gestures from controls.
      */
      if (
        target.closest(
          "button,a,input,select,textarea,label"
        )
      ) {

        return;

      }


      const row =
        target.closest(
          "tr[data-hauling-contract-id]"
        );


      if (!row) {

        return;

      }


      const contract =
        state.contracts.find(
          item =>
            item.id ===
            clean(
              row.dataset
                .haulingContractId
            )
        );


      if (
        !contract ||
        contract.voided
      ) {

        return;

      }


      const touch =
        event.touches[0];


      touchLink.startX =
        touch.clientX;


      touchLink.startY =
        touch.clientY;


      touchLink.contractId =
        contract.id;


      touchLink.row =
        row;


      if (
        touchLink.timer
      ) {

        clearTimeout(
          touchLink.timer
        );

      }


      touchLink.timer =
        setTimeout(
          () => {

            touchLink.timer =
              null;


            beginTouchLink(
              row,
              contract,
              touch
            );

          },
          350
        );

    },
    {
      passive:
        true
    }
  );


  document.addEventListener(
    "touchmove",
    event => {

      if (
        event.touches.length !==
        1
      ) {

        cleanupTouchLink();

        return;

      }


      const touch =
        event.touches[0];


      if (
        !touchLink.active
      ) {

        const distance =
          Math.hypot(
            touch.clientX -
            touchLink.startX,
            touch.clientY -
            touchLink.startY
          );


        if (
          distance >
            12 &&
          touchLink.timer
        ) {

          clearTimeout(
            touchLink.timer
          );


          touchLink.timer =
            null;


          touchLink.contractId =
            "";


          touchLink.row =
            null;

        }


        return;

      }


      event.preventDefault();


      moveTouchGhost(
        touch.clientX,
        touch.clientY
      );


      highlightTouchTarget(
        touchDropTarget(
          touch.clientX,
          touch.clientY
        )
      );

    },
    {
      passive:
        false
    }
  );


  document.addEventListener(
    "touchend",
    event => {

      if (
        !touchLink.active
      ) {

        if (
          touchLink.timer
        ) {

          clearTimeout(
            touchLink.timer
          );

        }


        touchLink.timer =
          null;


        touchLink.contractId =
          "";


        touchLink.row =
          null;


        return;

      }


      const contractId =
        touchLink.contractId;


      const touch =
        event.changedTouches[0];


      const target =
        touch
          ? touchDropTarget(
              touch.clientX,
              touch.clientY
            )
          : touchLink.target;


      cleanupTouchLink();


      if (
        !target
      ) {

        return;

      }


      if (
        target.type ===
        "job"
      ) {

        linkContractToJob(
          contractId,
          target.jobId
        );

      }
      else if (
        target.type ===
        "unassign"
      ) {

        unlinkContractFromJob(
          contractId
        );

      }

    },
    {
      passive:
        true
    }
  );


  document.addEventListener(
    "touchcancel",
    cleanupTouchLink,
    {
      passive:
        true
    }
  );

}


/* ============================================================
   ADD HAULING JOB MODAL
============================================================ */

function setJobMessage(
  message,
  type = "error"
) {

  const element =
    $(
      "hauling-job-form-message"
    );


  if (!element) {

    return;

  }


  element.textContent =
    message ||
    "";


  element.className =
    `hauling-form-message${
      message
        ? ` show ${type}`
        : ""
    }`;

}


function populateJobBuyerSelect() {

  const select =
    $(
      "hauling-job-buyer"
    );


  if (!select) {

    return;

  }


  select.innerHTML =
    '<option value="">Select buyer</option>';


  state.buyers.forEach(
    buyer => {

      const option =
        document.createElement(
          "option"
        );


      option.value =
        buyer.id;


      option.textContent =
        buyer.name;


      select.appendChild(
        option
      );

    }
  );

}


function populateJobCustomerSelect() {

  const select =
    $(
      "hauling-job-customer"
    );


  if (!select) {

    return;

  }


  select.innerHTML =
    '<option value="">Select customer</option>';


  state.customers.forEach(
    customer => {

      const option =
        document.createElement(
          "option"
        );


      option.value =
        customer.id;


      option.textContent =
        customer.name;


      select.appendChild(
        option
      );

    }
  );

}


function populateJobLocationSelect() {

  const select =
    $(
      "hauling-job-destination"
    );


  if (!select) {

    return;

  }


  const buyerId =
    clean(
      $(
        "hauling-job-buyer"
      )
        ?.value
    );


  select.innerHTML =
    "";


  const blank =
    document.createElement(
      "option"
    );


  blank.value =
    "";


  blank.textContent =
    buyerId
      ? "Select location"
      : "Select buyer first";


  select.appendChild(
    blank
  );


  state.locations
    .filter(
      location =>
        clean(
          location.buyerId
        ) ===
        buyerId
    )
    .forEach(
      location => {

        const option =
          document.createElement(
            "option"
          );


        option.value =
          location.id;


        option.textContent =
          location.locationName;


        select.appendChild(
          option
        );

      }
    );


  select.disabled =
    !buyerId;

}


function openJobModal() {

  const modal =
    $(
      "hauling-job-modal"
    );


  if (!modal) {

    return;

  }


  $(
    "hauling-job-form"
  )
    ?.reset();


  populateJobBuyerSelect();


  populateJobCustomerSelect();


  populateJobLocationSelect();


  if (
    $(
      "hauling-job-start-date"
    )
  ) {

    $(
      "hauling-job-start-date"
    )
      .value =
        localISO();

  }


  if (
    $(
      "hauling-job-end-date"
    )
  ) {

    $(
      "hauling-job-end-date"
    )
      .value =
        localISO();

  }


  setJobMessage(
    ""
  );


  modal.classList.add(
    "open"
  );


  document.body.style
    .overflow =
      "hidden";


  setTimeout(
    () =>
      $(
        "hauling-job-buyer"
      )
        ?.focus(),
    0
  );

}


function closeJobModal() {

  $(
    "hauling-job-modal"
  )
    ?.classList
    .remove(
      "open"
    );


  document.body.style
    .overflow =
      "";


  setJobMessage(
    ""
  );

}


async function saveJob(
  event
) {

  event.preventDefault();


  if (
    state.busy
  ) {

    return;

  }


  const buyerId =
    clean(
      $(
        "hauling-job-buyer"
      )
        ?.value
    );


  const locationId =
    clean(
      $(
        "hauling-job-destination"
      )
        ?.value
    );


  const customerId =
    clean(
      $(
        "hauling-job-customer"
      )
        ?.value
    );


  const crop =
    clean(
      $(
        "hauling-job-crop"
      )
        ?.value
    );


  const startingBushels =
    numberValue(
      $(
        "hauling-job-bushels"
      )
        ?.value
    );


  const deliveryStartDate =
    clean(
      $(
        "hauling-job-start-date"
      )
        ?.value
    );


  const deliveryEndDate =
    clean(
      $(
        "hauling-job-end-date"
      )
        ?.value
    );


  const buyer =
    state.buyers.find(
      item =>
        item.id ===
        buyerId
    );


  const location =
    state.locations.find(
      item =>
        item.id ===
        locationId
    );


  const customer =
    state.customers.find(
      item =>
        item.id ===
        customerId
    );


  if (
    !buyer ||
    !location ||
    !customer ||
    !crop ||
    !(startingBushels > 0) ||
    !deliveryStartDate ||
    !deliveryEndDate
  ) {

    setJobMessage(
      "Select Buyer, Location, Sold Under, Crop, starting bushels, and both delivery dates."
    );


    return;

  }


  if (
    deliveryEndDate <
    deliveryStartDate
  ) {

    setJobMessage(
      "Delivery end date cannot be before the start date."
    );


    return;

  }


  const saveButton =
    $(
      "save-hauling-job-btn"
    );


  state.busy =
    true;


  if (
    saveButton
  ) {

    saveButton.disabled =
      true;


    saveButton.textContent =
      "Adding…";

  }


  try {

    const place =
      `${
        buyer.name
      } ${
        location.locationName
      }`
        .trim();


    const jobName =
      `${
        place
      } — ${
        Math.round(
          startingBushels
        ).toLocaleString(
          "en-US"
        )
      } bu`;


    const who =
      auth.currentUser;


    const payload = {

      active:
        true,

      buyerId:
        buyer.id,

      buyerName:
        buyer.name,

      crop,

      customerId:
        customer.id,

      customerName:
        customer.name,

      deliveredBushels:
        0,

      deliveryEndDate,

      deliveryLocationId:
        location.id,

      deliveryLocationName:
        location.locationName,

      deliveryStartDate,

      displayName:
        jobName,

      jobName,

      remainingBushels:
        startingBushels,

      startingBushels,

      status:
        "active",

      createdByUid:
        who?.uid ||
        null,

      createdByName:
        who?.displayName ||
        who?.email ||
        "FarmVista User",

      createdByEmail:
        who?.email ||
        null,

      createdAt:
        serverTimestamp(),

      updatedAt:
        serverTimestamp()

    };


    const saved =
      await addDoc(
        collection(
          db,
          JOB_COLLECTION
        ),
        payload
      );


    state.jobs.push({

      id:
        saved.id,

      ...payload

    });


    closeJobModal();


    populateHaulingFilters();


    renderHaulingJobs();


    setTimeout(
      queueDecorateContractRows,
      0
    );

  }
  catch (error) {

    console.error(
      "[Hauling Jobs] Add hauling job failed:",
      error
    );


    setJobMessage(
      error?.message ||
      "FarmVista could not add the hauling job."
    );

  }
  finally {

    state.busy =
      false;


    if (
      saveButton
    ) {

      saveButton.disabled =
        false;


      saveButton.textContent =
        "Add Hauling Job";

    }

  }

}


function setupJobModal() {

  $(
    "add-hauling-job-btn"
  )
    ?.addEventListener(
      "click",
      openJobModal
    );


  $(
    "close-hauling-job-modal-btn"
  )
    ?.addEventListener(
      "click",
      closeJobModal
    );


  $(
    "cancel-hauling-job-btn"
  )
    ?.addEventListener(
      "click",
      closeJobModal
    );


  $(
    "hauling-job-buyer"
  )
    ?.addEventListener(
      "change",
      populateJobLocationSelect
    );


  $(
    "hauling-job-form"
  )
    ?.addEventListener(
      "submit",
      saveJob
    );


  $(
    "hauling-job-modal"
  )
    ?.addEventListener(
      "click",
      event => {

        if (
          event.target ===
          $(
            "hauling-job-modal"
          )
        ) {

          closeJobModal();

        }

      }
    );


  document.addEventListener(
    "keydown",
    event => {

      if (
        event.key ===
          "Escape" &&
        $(
          "hauling-job-modal"
        )
          ?.classList
          .contains(
            "open"
          )
      ) {

        closeJobModal();

      }

    }
  );

}


/* ============================================================
   FILTER EVENTS
============================================================ */

function setupHaulingFilters() {

  [
    "hauling-search-filter",
    "hauling-status-filter",
    "hauling-crop-filter",
    "hauling-buyer-filter",
    "hauling-customer-filter"
  ]
    .forEach(
      id => {

        const element =
          $(id);


        if (!element) {

          return;

        }


        element.addEventListener(
          id ===
            "hauling-search-filter"
            ? "input"
            : "change",
          renderHaulingJobs
        );

      }
    );

}


/* ============================================================
   REFRESH
============================================================ */

async function refreshHaulingData() {

  if (
    state.busy
  ) {

    return;

  }


  try {

    const [
      jobSnapshot,
      contractSnapshot,
      ticketSnapshot
    ] =
      await Promise.all([

        getDocs(
          collection(
            db,
            JOB_COLLECTION
          )
        ),

        getDocs(
          collection(
            db,
            CONTRACT_COLLECTION
          )
        ),

        getDocs(
          collection(
            db,
            TICKET_COLLECTION
          )
        )

      ]);


    state.jobs =
      jobSnapshot.docs
        .map(
          snapshot => ({

            id:
              snapshot.id,

            ...snapshot.data()

          })
        );


    state.contracts =
      contractSnapshot.docs
        .map(
          snapshot => ({

            id:
              snapshot.id,

            ...snapshot.data()

          })
        );


    state.tickets =
      ticketSnapshot.docs
        .map(
          snapshot => ({

            id:
              snapshot.id,

            ...snapshot.data()

          })
        );


    populateHaulingFilters();


    renderHaulingJobs();


    queueDecorateContractRows();

  }
  catch (error) {

    console.warn(
      "[Hauling Jobs] Background refresh failed:",
      error
    );

  }

}


/* ============================================================
   START
============================================================ */

async function start() {

  setupJobModal();


  setupHaulingFilters();


  setupUnassignDesktopDrop();


  setupTouchContractLinking();


  await loadData();


  populateHaulingFilters();


  renderHaulingJobs();


  observeContractTable();


  document.addEventListener(
    "visibilitychange",
    () => {

      if (
        document.visibilityState ===
        "visible"
      ) {

        refreshHaulingData();

      }

    }
  );


  window.addEventListener(
    "pageshow",
    event => {

      if (
        event.persisted
      ) {

        refreshHaulingData();

      }

    }
  );

}


start()
  .catch(
    error => {

      console.error(
        "[Hauling Jobs] Startup failed:",
        error
      );


      const tbody =
        $(
          "hauling-jobs-table-body"
        );


      if (
        tbody
      ) {

        tbody.innerHTML = `
          <tr>

            <td colspan="11">

              <div class="empty-state">

                <div class="empty-title">
                  Unable to Load Hauling Jobs
                </div>

                <div class="empty-sub">
                  Check the browser console for the Firestore error.
                </div>

              </div>

            </td>

          </tr>
        `;

      }

    }
  );
