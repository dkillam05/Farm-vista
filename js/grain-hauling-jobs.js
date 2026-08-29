// /js/grain-hauling-jobs.js
// FarmVista — Hauling Jobs + Contract Planning Link
//
// Separate from /js/grain-contracts.js on purpose.
// This file owns ONLY:
//   • Hauling Job create / edit / void
//   • Hauling Job list + live ticketed / remaining bushels
//   • Contract → Hauling Job planning links
//   • Hauling Job DND workspace
//   • Hauling Job label in the contracts table
//
// It DOES NOT change ticket-to-contract allocations, contract delivered/open
// bushels, split-load logic, spot bushels, settlement logic, or void/reversal
// accounting in grain-contracts.js.

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

const COLLECTIONS = {
  jobs: "grain_hauling_jobs",
  contracts: "grain_contracts",
  tickets: "grain_tickets",
  buyers: "grain_buyers",
  customers: "grain_customers",
  locations: "grain_delivery_locations"
};

const $ = id => document.getElementById(id);

const clean = value =>
  String(value ?? "").trim();

const norm = value =>
  clean(value).toLowerCase();

const num = value => {
  const n =
    Number(
      String(value ?? "")
        .replace(/,/g, "")
    );

  return Number.isFinite(n)
    ? n
    : 0;
};

const round2 = value =>
  Number(
    num(value).toFixed(2)
  );

const fmtBu = value =>
  num(value).toLocaleString(
    "en-US",
    {
      maximumFractionDigits: 2
    }
  );

const escapeHtml = value =>
  clean(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");


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


function fmtDate(
  iso
) {

  const parts =
    clean(iso)
      .split("-")
      .map(Number);


  if (
    parts.length !== 3 ||
    !parts[0] ||
    !parts[1] ||
    !parts[2]
  ) {

    return clean(iso) || "—";

  }


  return `${
    parts[1]
  }/${
    parts[2]
  }/${
    parts[0]
  }`;

}


const state = {

  jobs: [],

  contracts: [],

  tickets: [],

  buyers: [],

  customers: [],

  locations: [],

  busy: false,

  draggingContractId: "",

  contractObserver: null,

  decorateQueued: false,

  touch: {

    timer: null,

    active: false,

    contractId: "",

    ghost: null,

    source: null,

    target: null,

    startX: 0,

    startY: 0

  }

};


/* ============================================================
   DATA HELPERS
============================================================ */

function jobBuyerId(
  job
) {

  return clean(
    job?.buyerId
  );

}


function jobLocationId(
  job
) {

  return clean(
    job?.deliveryLocationId ||
    job?.locationId ||
    job?.destinationId
  );

}


function jobCustomerId(
  job
) {

  return clean(
    job?.customerId ||
    job?.grainCustomerId
  );

}


function jobCrop(
  job
) {

  return clean(
    job?.crop ||
    job?.commodity
  );

}


function jobStartingBushels(
  job
) {

  return Math.max(
    0,
    num(
      job?.startingBushels ??
      job?.jobBushels ??
      job?.bushels
    )
  );

}


function ticketIsVoided(
  ticket
) {

  return (
    ticket?.voided === true ||
    norm(
      ticket?.status
    ).includes(
      "void"
    )
  );

}


function jobTicketedBushels(
  job
) {

  return round2(

    state.tickets

      .filter(
        ticket =>
          !ticketIsVoided(
            ticket
          ) &&
          clean(
            ticket?.haulingJobId
          ) ===
          clean(
            job?.id
          )
      )

      .reduce(
        (
          sum,
          ticket
        ) =>
          sum +
          num(
            ticket?.netBushels ??
            ticket?.netBu ??
            ticket?.bushels
          ),
        0
      )

  );

}


function jobRemainingBushels(
  job
) {

  return round2(
    Math.max(
      0,
      jobStartingBushels(
        job
      ) -
      jobTicketedBushels(
        job
      )
    )
  );

}


function jobName(
  job
) {

  const saved =
    clean(
      job?.displayName ||
      job?.jobName ||
      job?.haulingJobName
    );


  if (
    saved
  ) {

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
    !norm(
      location
    ).startsWith(
      norm(
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
    fmtBu(
      jobStartingBushels(
        job
      )
    )
  } bu`;

}


function jobStatus(
  job
) {

  const raw =
    norm(
      job?.status
    );


  if (
    job?.active === false ||
    raw.includes(
      "void"
    )
  ) {

    return "voided";

  }


  if (
    raw.includes(
      "closed"
    ) ||
    raw.includes(
      "cancel"
    )
  ) {

    return "closed";

  }


  if (
    raw.includes(
      "complete"
    ) ||
    (
      jobStartingBushels(
        job
      ) > 0 &&
      jobRemainingBushels(
        job
      ) <= 0.005
    )
  ) {

    return "complete";

  }


  const start =
    clean(
      job?.deliveryStartDate ||
      job?.startDate
    );


  if (
    start &&
    start >
    localISO()
  ) {

    return "upcoming";

  }


  return "active";

}


function jobStatusLabel(
  job
) {

  return ({

    active:
      "Active",

    upcoming:
      "Upcoming",

    complete:
      "Completed",

    closed:
      "Closed",

    voided:
      "Voided"

  })[
    jobStatus(
      job
    )
  ] ||
  "Active";

}


function contractBuyerId(
  contract
) {

  return clean(
    contract?.buyerId ||
    contract?.grainBuyerId
  );

}


function contractLocationId(
  contract
) {

  return clean(
    contract?.deliveryLocationId ||
    contract?.locationId ||
    contract?.destinationId
  );

}


function contractCustomerId(
  contract
) {

  return clean(
    contract?.customerId ||
    contract?.grainCustomerId
  );

}


function contractCrop(
  contract
) {

  return clean(
    contract?.crop ||
    contract?.commodity
  );

}


function contractNumber(
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


function contractBushels(
  contract
) {

  return Math.max(
    0,
    num(
      contract?.contractBushels ??
      contract?.bushels ??
      contract?.quantity ??
      contract?.totalBushels
    )
  );

}


function contractOpenBushels(
  contract
) {

  const explicit =
    contract?.openBushels ??
    contract?.remainingBushels ??
    contract?.bushelsRemaining ??
    contract?.remainingBu;


  if (
    explicit !== undefined &&
    explicit !== null &&
    explicit !== ""
  ) {

    return Math.max(
      0,
      num(
        explicit
      )
    );

  }


  return Math.max(
    0,
    contractBushels(
      contract
    ) -
    num(
      contract?.deliveredBushels
    )
  );

}


function contractIsVoided(
  contract
) {

  return (
    contract?.voided === true ||
    norm(
      contract?.status ||
      contract?.contractStatus
    ).includes(
      "void"
    )
  );

}


function linkedJob(
  contract
) {

  const id =
    clean(
      contract?.haulingJobId
    );


  return id
    ? (
        state.jobs.find(
          job =>
            job.id ===
            id
        ) ||
        null
      )
    : null;

}


function contractsForJob(
  jobId
) {

  return state.contracts
    .filter(
      contract =>
        clean(
          contract?.haulingJobId
        ) ===
        clean(
          jobId
        )
    );

}


function matchingLocation(
  locationId
) {

  return state.locations.find(
    location =>
      location.id ===
      clean(
        locationId
      )
  ) ||
  null;

}


function matchingBuyer(
  buyerId
) {

  return state.buyers.find(
    buyer =>
      buyer.id ===
      clean(
        buyerId
      )
  ) ||
  null;

}


function matchingCustomer(
  customerId
) {

  return state.customers.find(
    customer =>
      customer.id ===
      clean(
        customerId
      )
  ) ||
  null;

}


function validateContractJob(
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
    contractIsVoided(
      contract
    )
  ) {

    return "Voided contracts cannot be linked to a hauling job.";

  }


  if (
    [
      "voided",
      "closed"
    ].includes(
      jobStatus(
        job
      )
    )
  ) {

    return "That hauling job is closed or voided.";

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
    norm(
      contractCrop(
        contract
      )
    ) !==
    norm(
      jobCrop(
        job
      )
    )
  ) {

    return "Crop does not match this hauling job.";

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


  return "";

}


/* ============================================================
   LOAD / REFRESH
============================================================ */

async function loadAllData() {

  const [
    jobSnap,
    contractSnap,
    ticketSnap,
    buyerSnap,
    customerSnap,
    locationSnap
  ] =
    await Promise.all([

      getDocs(
        collection(
          db,
          COLLECTIONS.jobs
        )
      ),

      getDocs(
        collection(
          db,
          COLLECTIONS.contracts
        )
      ),

      getDocs(
        collection(
          db,
          COLLECTIONS.tickets
        )
      ),

      getDocs(
        collection(
          db,
          COLLECTIONS.buyers
        )
      ),

      getDocs(
        collection(
          db,
          COLLECTIONS.customers
        )
      ),

      getDocs(
        collection(
          db,
          COLLECTIONS.locations
        )
      )

    ]);


  state.jobs =
    jobSnap.docs.map(
      snapshot => ({

        id:
          snapshot.id,

        ...snapshot.data()

      })
    );


  state.contracts =
    contractSnap.docs.map(
      snapshot => ({

        id:
          snapshot.id,

        ...snapshot.data()

      })
    );


  state.tickets =
    ticketSnap.docs.map(
      snapshot => ({

        id:
          snapshot.id,

        ...snapshot.data()

      })
    );


  state.buyers =
    buyerSnap.docs

      .map(
        snapshot => ({

          id:
            snapshot.id,

          ...snapshot.data(),

          name:
            clean(
              snapshot.data()?.name
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
              numeric:
                true,

              sensitivity:
                "base"
            }
          )
      );


  state.customers =
    customerSnap.docs

      .map(
        snapshot => ({

          id:
            snapshot.id,

          ...snapshot.data(),

          name:
            clean(
              snapshot.data()?.name
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
              numeric:
                true,

              sensitivity:
                "base"
            }
          )
      );


  state.locations =
    locationSnap.docs

      .map(
        snapshot => ({

          id:
            snapshot.id,

          ...snapshot.data(),

          buyerId:
            clean(
              snapshot.data()?.buyerId
            ),

          buyerName:
            clean(
              snapshot.data()?.buyerName
            ),

          locationName:
            clean(
              snapshot.data()?.locationName
            )

        })
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
          `${
            a.buyerName
          } ${
            a.locationName
          }`
            .localeCompare(
              `${
                b.buyerName
              } ${
                b.locationName
              }`,
              undefined,
              {
                numeric:
                  true,

                sensitivity:
                  "base"
              }
            )
      );

}


async function refreshHauling() {

  if (
    state.busy
  ) {

    return;

  }


  try {

    await loadAllData();


    populateJobFilters();


    renderJobs();


    populateLinkBuyer();


    rebuildLinkFiltersFromCurrent();


    renderLinkWorkspace();


    queueContractTableDecoration();

  }
  catch (
    error
  ) {

    console.warn(
      "[Hauling Jobs] refresh failed:",
      error
    );

  }

}


/* ============================================================
   MAIN HAULING JOB TABLE
============================================================ */

function uniqueSorted(
  values
) {

  return [
    ...new Set(
      values
        .map(
          clean
        )
        .filter(
          Boolean
        )
    )
  ]
    .sort(
      (
        a,
        b
      ) =>
        a.localeCompare(
          b,
          undefined,
          {
            numeric:
              true,

            sensitivity:
              "base"
          }
        )
    );

}


function refillSimpleSelect(
  select,
  values
) {

  if (
    !select
  ) {

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


  if (
    first
  ) {

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


function populateJobFilters() {

  refillSimpleSelect(
    $(
      "hauling-crop-filter"
    ),
    uniqueSorted(
      state.jobs.map(
        jobCrop
      )
    )
  );


  refillSimpleSelect(
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


  refillSimpleSelect(
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
    norm(
      $(
        "hauling-search-filter"
      )
        ?.value
    );


  const statusFilter =
    clean(
      $(
        "hauling-status-filter"
      )
        ?.value ||
      "all"
    );


  const crop =
    clean(
      $(
        "hauling-crop-filter"
      )
        ?.value
    );


  const buyer =
    clean(
      $(
        "hauling-buyer-filter"
      )
        ?.value
    );


  const customer =
    clean(
      $(
        "hauling-customer-filter"
      )
        ?.value
    );


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
          ![
            "closed",
            "voided"
          ].includes(
            status
          )
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
            job?.buyerName
          ) !==
          buyer
        ) {

          return false;

        }


        if (
          customer &&
          clean(
            job?.customerName
          ) !==
          customer
        ) {

          return false;

        }


        if (
          search
        ) {

          const haystack =
            norm(
              [

                jobName(
                  job
                ),

                job?.buyerName,

                job?.deliveryLocationName,

                job?.customerName,

                jobCrop(
                  job
                ),

                job?.deliveryStartDate,

                job?.deliveryEndDate

              ].join(
                " "
              )
            );


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

          active:
            0,

          upcoming:
            1,

          complete:
            2,

          closed:
            3,

          voided:
            4

        };


        const statusDiff =
          (
            order[
              jobStatus(
                a
              )
            ] ??
            9
          ) -
          (
            order[
              jobStatus(
                b
              )
            ] ??
            9
          );


        if (
          statusDiff
        ) {

          return statusDiff;

        }


        const dateDiff =
          clean(
            a?.deliveryStartDate
          )
            .localeCompare(
              clean(
                b?.deliveryStartDate
              )
            );


        if (
          dateDiff
        ) {

          return dateDiff;

        }


        return jobName(
          a
        )
          .localeCompare(
            jobName(
              b
            ),
            undefined,
            {
              numeric:
                true,

              sensitivity:
                "base"
            }
          );

      }
    );

}


function renderJobSummary(
  jobs
) {

  const summary =
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

        starting:
          0,

        ticketed:
          0,

        remaining:
          0,

        contracts:
          0

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
        fmtBu(
          summary.starting
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
        fmtBu(
          summary.ticketed
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
        fmtBu(
          summary.remaining
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
        summary.contracts
          .toLocaleString(
            "en-US"
          );

  }

}


function renderJobs() {

  const tbody =
    $(
      "hauling-jobs-table-body"
    );


  if (
    !tbody
  ) {

    return;

  }


  const jobs =
    filteredJobs();


  renderJobSummary(
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

      const row =
        document.createElement(
          "tr"
        );


      row.className =
        "hauling-row";


      row.dataset.haulingJobId =
        job.id;


      row.tabIndex =
        0;


      row.innerHTML = `

        <td>
          <span class="status-pill status-job-${
            escapeHtml(
              jobStatus(
                job
              )
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
                jobName(
                  job
                )
              )
            }
          </div>
        </td>

        <td>
          ${
            escapeHtml(
              job?.buyerName ||
              "—"
            )
          }
        </td>

        <td>
          ${
            escapeHtml(
              job?.deliveryLocationName ||
              "—"
            )
          }
        </td>

        <td>
          ${
            escapeHtml(
              job?.customerName ||
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
            fmtBu(
              jobStartingBushels(
                job
              )
            )
          }
        </td>

        <td class="number-cell">
          ${
            fmtBu(
              jobTicketedBushels(
                job
              )
            )
          }
        </td>

        <td class="number-cell">
          ${
            fmtBu(
              jobRemainingBushels(
                job
              )
            )
          }
        </td>

        <td class="center-cell">
          ${
            contractsForJob(
              job.id
            )
              .length
              .toLocaleString(
                "en-US"
              )
          }
        </td>

        <td>
          ${
            escapeHtml(
              fmtDate(
                job?.deliveryStartDate
              )
            )
          }
          –
          ${
            escapeHtml(
              fmtDate(
                job?.deliveryEndDate
              )
            )
          }
        </td>

      `;


      row.addEventListener(
        "click",
        () =>
          openEditJob(
            job.id
          )
      );


      row.addEventListener(
        "keydown",
        event => {

          if (
            event.key ===
              "Enter" ||
            event.key ===
              " "
          ) {

            event.preventDefault();


            openEditJob(
              job.id
            );

          }

        }
      );


      tbody.appendChild(
        row
      );

    }
  );

}


/* ============================================================
   ADD / EDIT / VOID HAULING JOB
============================================================ */

function setJobMessage(
  message,
  type =
    "error"
) {

  const element =
    $(
      "hauling-job-form-message"
    );


  if (
    !element
  ) {

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


function populateJobBuyerSelect(
  selectedId =
    ""
) {

  const select =
    $(
      "hauling-job-buyer"
    );


  if (
    !select
  ) {

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


  select.value =
    clean(
      selectedId
    );

}


function populateJobCustomerSelect(
  selectedId =
    ""
) {

  const select =
    $(
      "hauling-job-customer"
    );


  if (
    !select
  ) {

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


  select.value =
    clean(
      selectedId
    );

}


function populateJobLocationSelect(
  selectedId =
    ""
) {

  const select =
    $(
      "hauling-job-destination"
    );


  if (
    !select
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
          location?.buyerId
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


  if (
    [
      ...select.options
    ].some(
      option =>
        option.value ===
        clean(
          selectedId
        )
    )
  ) {

    select.value =
      clean(
        selectedId
      );

  }

}


function setJobModalMode(
  job =
    null
) {

  const editing =
    !!job;


  if (
    $(
      "hauling-job-edit-id"
    )
  ) {

    $(
      "hauling-job-edit-id"
    )
      .value =
        job?.id ||
        "";

  }


  if (
    $(
      "hauling-job-modal-title"
    )
  ) {

    $(
      "hauling-job-modal-title"
    )
      .textContent =
        editing
          ? "Edit Hauling Job"
          : "Add Hauling Job";

  }


  if (
    $(
      "save-hauling-job-btn"
    )
  ) {

    $(
      "save-hauling-job-btn"
    )
      .textContent =
        editing
          ? "Save Changes"
          : "Add Hauling Job";

  }


  if (
    $(
      "void-hauling-job-btn"
    )
  ) {

    $(
      "void-hauling-job-btn"
    )
      .hidden =
        !editing ||
        [
          "voided",
          "closed"
        ].includes(
          jobStatus(
            job
          )
        );

  }

}


function openAddJob() {

  const form =
    $(
      "hauling-job-form"
    );


  form?.reset();


  setJobMessage(
    ""
  );


  setJobModalMode(
    null
  );


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


  $(
    "hauling-job-modal"
  )
    ?.classList
    .add(
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


function openEditJob(
  jobId
) {

  const job =
    state.jobs.find(
      item =>
        item.id ===
        clean(
          jobId
        )
    );


  if (
    !job
  ) {

    return;

  }


  setJobMessage(
    ""
  );


  setJobModalMode(
    job
  );


  populateJobBuyerSelect(
    jobBuyerId(
      job
    )
  );


  populateJobLocationSelect(
    jobLocationId(
      job
    )
  );


  populateJobCustomerSelect(
    jobCustomerId(
      job
    )
  );


  if (
    $(
      "hauling-job-crop"
    )
  ) {

    $(
      "hauling-job-crop"
    )
      .value =
        jobCrop(
          job
        );

  }


  if (
    $(
      "hauling-job-bushels"
    )
  ) {

    $(
      "hauling-job-bushels"
    )
      .value =
        String(
          jobStartingBushels(
            job
          )
        );

  }


  if (
    $(
      "hauling-job-start-date"
    )
  ) {

    $(
      "hauling-job-start-date"
    )
      .value =
        clean(
          job?.deliveryStartDate ||
          job?.startDate
        );

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
        clean(
          job?.deliveryEndDate ||
          job?.endDate
        );

  }


  $(
    "hauling-job-modal"
  )
    ?.classList
    .add(
      "open"
    );


  document.body.style
    .overflow =
      "hidden";

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


  const editId =
    clean(
      $(
        "hauling-job-edit-id"
      )
        ?.value
    );


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
    num(
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
    matchingBuyer(
      buyerId
    );


  const location =
    matchingLocation(
      locationId
    );


  const customer =
    matchingCustomer(
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


  const oldJob =
    editId
      ? state.jobs.find(
          job =>
            job.id ===
            editId
        )
      : null;


  /*
    Once contracts are linked, do not allow edits that would
    make those existing links invalid.
  */
  if (
    oldJob
  ) {

    const linkedContracts =
      contractsForJob(
        oldJob.id
      );


    if (
      linkedContracts.length
    ) {

      const wouldBreak =
        linkedContracts.some(
          contract =>
            contractBuyerId(
              contract
            ) !==
              buyerId ||
            contractCustomerId(
              contract
            ) !==
              customerId ||
            norm(
              contractCrop(
                contract
              )
            ) !==
              norm(
                crop
              ) ||
            contractLocationId(
              contract
            ) !==
              locationId
        );


      if (
        wouldBreak
      ) {

        setJobMessage(
          "This job already has linked contracts. Unlink those contracts before changing Buyer, Location, Sold Under, or Crop."
        );


        return;

      }

    }

  }


  const jobNameValue =
    `${
      clean(
        location?.buyerName ||
        buyer.name
      )
    } ${
      location.locationName
    } — ${
      Math.round(
        startingBushels
      ).toLocaleString(
        "en-US"
      )
    } bu`
      .trim();


  const who =
    auth.currentUser;


  const payload = {

    buyerId,

    buyerName:
      clean(
        location?.buyerName ||
        buyer.name
      ),

    deliveryLocationId:
      locationId,

    deliveryLocationName:
      location.locationName,

    customerId,

    customerName:
      customer.name,

    crop,

    startingBushels,

    remainingBushels:
      Math.max(
        0,
        round2(
          startingBushels -
          (
            oldJob
              ? jobTicketedBushels(
                  oldJob
                )
              : 0
          )
        )
      ),

    deliveredBushels:
      oldJob
        ? jobTicketedBushels(
            oldJob
          )
        : 0,

    deliveryStartDate,

    deliveryEndDate,

    displayName:
      jobNameValue,

    jobName:
      jobNameValue,

    active:
      true,

    status:
      "active",

    updatedAt:
      serverTimestamp(),

    updatedByUid:
      who?.uid ||
      null,

    updatedByName:
      who?.displayName ||
      who?.email ||
      "FarmVista User",

    updatedByEmail:
      who?.email ||
      null

  };


  state.busy =
    true;


  const saveButton =
    $(
      "save-hauling-job-btn"
    );


  if (
    saveButton
  ) {

    saveButton.disabled =
      true;


    saveButton.textContent =
      editId
        ? "Saving…"
        : "Adding…";

  }


  try {

    if (
      editId
    ) {

      await updateDoc(
        doc(
          db,
          COLLECTIONS.jobs,
          editId
        ),
        payload
      );


      const index =
        state.jobs.findIndex(
          job =>
            job.id ===
            editId
        );


      if (
        index >= 0
      ) {

        state.jobs[
          index
        ] = {

          ...state.jobs[
            index
          ],

          ...payload

        };

      }

    }
    else {

      const createPayload = {

        ...payload,

        deliveredBushels:
          0,

        remainingBushels:
          startingBushels,

        createdAt:
          serverTimestamp(),

        createdByUid:
          who?.uid ||
          null,

        createdByName:
          who?.displayName ||
          who?.email ||
          "FarmVista User",

        createdByEmail:
          who?.email ||
          null

      };


      const saved =
        await addDoc(
          collection(
            db,
            COLLECTIONS.jobs
          ),
          createPayload
        );


      state.jobs.push({

        id:
          saved.id,

        ...createPayload

      });

    }


    closeJobModal();


    populateJobFilters();


    renderJobs();


    rebuildLinkFiltersFromCurrent();


    renderLinkWorkspace();


    queueContractTableDecoration();

  }
  catch (
    error
  ) {

    console.error(
      "[Hauling Jobs] save failed:",
      error
    );


    setJobMessage(
      error?.message ||
      "FarmVista could not save the hauling job."
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
        editId
          ? "Save Changes"
          : "Add Hauling Job";

    }

  }

}


async function voidJob() {

  if (
    state.busy
  ) {

    return;

  }


  const jobId =
    clean(
      $(
        "hauling-job-edit-id"
      )
        ?.value
    );


  const job =
    state.jobs.find(
      item =>
        item.id ===
        jobId
    );


  if (
    !job
  ) {

    return;

  }


  const linked =
    contractsForJob(
      job.id
    );


  if (
    linked.length
  ) {

    alert(
      `This hauling job still has ${
        linked.length
      } linked contract${
        linked.length === 1
          ? ""
          : "s"
      }. Unlink those contracts before voiding the job.`
    );


    return;

  }


  if (
    !window.confirm(
      `Void ${
        jobName(
          job
        )
      }?\n\nThe job will stay in history but will no longer be available for new load-outs.`
    )
  ) {

    return;

  }


  const who =
    auth.currentUser;


  state.busy =
    true;


  try {

    await updateDoc(
      doc(
        db,
        COLLECTIONS.jobs,
        job.id
      ),
      {

        active:
          false,

        status:
          "voided",

        voided:
          true,

        voidedAt:
          serverTimestamp(),

        voidedByUid:
          who?.uid ||
          null,

        voidedByName:
          who?.displayName ||
          who?.email ||
          "FarmVista User",

        voidedByEmail:
          who?.email ||
          null,

        updatedAt:
          serverTimestamp()

      }
    );


    job.active =
      false;


    job.status =
      "voided";


    job.voided =
      true;


    closeJobModal();


    populateJobFilters();


    renderJobs();


    renderLinkWorkspace();

  }
  catch (
    error
  ) {

    console.error(
      "[Hauling Jobs] void failed:",
      error
    );


    alert(
      error?.message ||
      "FarmVista could not void the hauling job."
    );

  }
  finally {

    state.busy =
      false;

  }

}


/* ============================================================
   DEDICATED CONTRACT → HAULING JOB DND WORKSPACE
============================================================ */

function populateLinkBuyer() {

  const select =
    $(
      "hauling-link-buyer"
    );


  if (
    !select
  ) {

    return;

  }


  const current =
    select.value;


  select.innerHTML =
    '<option value="">All Buyers</option>';


  const buyerIds =
    new Set(
      [

        ...state.contracts
          .filter(
            contract =>
              !contractIsVoided(
                contract
              )
          )
          .map(
            contractBuyerId
          ),

        ...state.jobs
          .filter(
            job =>
              ![
                "voided",
                "closed"
              ].includes(
                jobStatus(
                  job
                )
              )
          )
          .map(
            jobBuyerId
          )

      ].filter(
        Boolean
      )
    );


  state.buyers

    .filter(
      buyer =>
        buyerIds.has(
          buyer.id
        )
    )

    .forEach(
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


function populateLinkCustomer() {

  const buyerId =
    clean(
      $(
        "hauling-link-buyer"
      )
        ?.value
    );


  const select =
    $(
      "hauling-link-customer"
    );


  if (
    !select
  ) {

    return;

  }


  const current =
    select.value;


  select.innerHTML =
    '<option value="">All Sold Under</option>';


  select.disabled =
    false;


  const ids =
    new Set(
      [

        ...state.contracts
          .filter(
            contract =>
              !contractIsVoided(
                contract
              ) &&
              (
                !buyerId ||
                contractBuyerId(
                  contract
                ) ===
                buyerId
              )
          )
          .map(
            contractCustomerId
          ),

        ...state.jobs
          .filter(
            job =>
              ![
                "voided",
                "closed"
              ].includes(
                jobStatus(
                  job
                )
              ) &&
              (
                !buyerId ||
                jobBuyerId(
                  job
                ) ===
                buyerId
              )
          )
          .map(
            jobCustomerId
          )

      ].filter(
        Boolean
      )
    );


  state.customers

    .filter(
      customer =>
        ids.has(
          customer.id
        )
    )

    .forEach(
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


  populateLinkCrop();

}


function populateLinkCrop() {

  const buyerId =
    clean(
      $(
        "hauling-link-buyer"
      )
        ?.value
    );


  const customerId =
    clean(
      $(
        "hauling-link-customer"
      )
        ?.value
    );


  const select =
    $(
      "hauling-link-crop"
    );


  if (
    !select
  ) {

    return;

  }


  const current =
    select.value;


  select.innerHTML =
    '<option value="">All Crops</option>';


  select.disabled =
    false;


  const crops =
    uniqueSorted(
      [

        ...state.contracts
          .filter(
            contract =>
              !contractIsVoided(
                contract
              ) &&
              (
                !buyerId ||
                contractBuyerId(
                  contract
                ) ===
                buyerId
              ) &&
              (
                !customerId ||
                contractCustomerId(
                  contract
                ) ===
                customerId
              )
          )
          .map(
            contractCrop
          ),

        ...state.jobs
          .filter(
            job =>
              ![
                "voided",
                "closed"
              ].includes(
                jobStatus(
                  job
                )
              ) &&
              (
                !buyerId ||
                jobBuyerId(
                  job
                ) ===
                buyerId
              ) &&
              (
                !customerId ||
                jobCustomerId(
                  job
                ) ===
                customerId
              )
          )
          .map(
            jobCrop
          )

      ]
    );


  crops.forEach(
    crop => {

      const option =
        document.createElement(
          "option"
        );


      option.value =
        crop;


      option.textContent =
        crop;


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


function rebuildLinkFiltersFromCurrent() {

  populateLinkBuyer();


  populateLinkCustomer();

}


function linkFilterValues() {

  return {

    buyerId:
      clean(
        $(
          "hauling-link-buyer"
        )
          ?.value
      ),

    customerId:
      clean(
        $(
          "hauling-link-customer"
        )
          ?.value
      ),

    crop:
      clean(
        $(
          "hauling-link-crop"
        )
          ?.value
      )

  };

}


function currentUnlinkedContracts() {

  const {
    buyerId,
    customerId,
    crop
  } =
    linkFilterValues();


  return state.contracts

    .filter(
      contract =>
        !contractIsVoided(
          contract
        ) &&
        !clean(
          contract?.haulingJobId
        ) &&
        (
          !buyerId ||
          contractBuyerId(
            contract
          ) ===
          buyerId
        ) &&
        (
          !customerId ||
          contractCustomerId(
            contract
          ) ===
          customerId
        ) &&
        (
          !crop ||
          norm(
            contractCrop(
              contract
            )
          ) ===
          norm(
            crop
          )
        )
    )

    .sort(
      (
        a,
        b
      ) =>
        contractNumber(
          a
        )
          .localeCompare(
            contractNumber(
              b
            ),
            undefined,
            {
              numeric:
                true,

              sensitivity:
                "base"
            }
          )
    );

}


function currentMatchingJobs() {

  const {
    buyerId,
    customerId,
    crop
  } =
    linkFilterValues();


  return state.jobs

    .filter(
      job =>
        ![
          "voided",
          "closed"
        ].includes(
          jobStatus(
            job
          )
        ) &&
        (
          !buyerId ||
          jobBuyerId(
            job
          ) ===
          buyerId
        ) &&
        (
          !customerId ||
          jobCustomerId(
            job
          ) ===
          customerId
        ) &&
        (
          !crop ||
          norm(
            jobCrop(
              job
            )
          ) ===
          norm(
            crop
          )
        )
    )

    .sort(
      (
        a,
        b
      ) =>
        clean(
          a?.deliveryStartDate
        )
          .localeCompare(
            clean(
              b?.deliveryStartDate
            )
          ) ||
        jobName(
          a
        )
          .localeCompare(
            jobName(
              b
            )
          )
    );

}


function setLinkMessage(
  message,
  ready =
    false
) {

  const element =
    $(
      "hauling-link-message"
    );


  if (
    !element
  ) {

    return;

  }


  element.textContent =
    message;


  element.classList.toggle(
    "ready",
    !!ready
  );

}


function renderLinkWorkspace() {

  const contractList =
    $(
      "hauling-unlinked-contract-list"
    );


  const jobList =
    $(
      "hauling-job-drop-list"
    );


  if (
    !contractList ||
    !jobList
  ) {

    return;

  }


  const {
    buyerId,
    customerId,
    crop
  } =
    linkFilterValues();


  const contracts =
    currentUnlinkedContracts();


  const jobs =
    currentMatchingJobs();


  if (
    $(
      "hauling-unlinked-contract-count"
    )
  ) {

    $(
      "hauling-unlinked-contract-count"
    )
      .textContent =
        `${
          contracts.length
        } contract${
          contracts.length === 1
            ? ""
            : "s"
        }`;

  }


  if (
    $(
      "hauling-link-job-count"
    )
  ) {

    $(
      "hauling-link-job-count"
    )
      .textContent =
        `${
          jobs.length
        } job${
          jobs.length === 1
            ? ""
            : "s"
        }`;

  }


  const activeFilters =
    [];


  if (
    buyerId
  ) {

    activeFilters.push(
      matchingBuyer(
        buyerId
      )?.name ||
      "Buyer"
    );

  }


  if (
    customerId
  ) {

    activeFilters.push(
      matchingCustomer(
        customerId
      )?.name ||
      "Sold Under"
    );

  }


  if (
    crop
  ) {

    activeFilters.push(
      crop
    );

  }


  setLinkMessage(
    activeFilters.length
      ? `Filtered to ${
          activeFilters.join(
            " • "
          )
        }. Drag a contract from the left onto the correct hauling job. Location is checked when you drop it.`
      : "Showing all unlinked contracts and hauling jobs. Drag a contract from the left onto the correct hauling job. Location is checked when you drop it.",
    true
  );


  if (
    !contracts.length
  ) {

    contractList.innerHTML = `
      <div class="empty-state">

        <div class="empty-title">
          No Unlinked Contracts
        </div>

        <div class="empty-sub">
          All matching contracts are already linked, or no contracts match the current filters.
        </div>

      </div>
    `;

  }
  else {

    contractList.innerHTML =
      "";


    contracts.forEach(
      contract => {

        const card =
          document.createElement(
            "div"
          );


        card.className =
          "hauling-contract-card";


        card.draggable =
          true;


        card.dataset.haulingContractId =
          contract.id;


        card.innerHTML = `

          <div class="hauling-dnd-card-title">
            Contract ${
              escapeHtml(
                contractNumber(
                  contract
                )
              )
            }
          </div>

          <div class="hauling-dnd-card-meta">

            ${
              escapeHtml(
                contract?.buyerName ||
                "Unknown buyer"
              )
            }
            •
            ${
              escapeHtml(
                contract?.customerName ||
                "Unknown customer"
              )
            }
            •
            ${
              escapeHtml(
                contractCrop(
                  contract
                ) ||
                "Unknown crop"
              )
            }

            <br>

            ${
              escapeHtml(
                contract?.deliveryLocationName ||
                "No location"
              )
            }
            •
            ${
              fmtBu(
                contractBushels(
                  contract
                )
              )
            }
            bu contract
            •
            ${
              fmtBu(
                contractOpenBushels(
                  contract
                )
              )
            }
            bu open

          </div>

        `;


        bindContractDragSource(
          card,
          contract.id
        );


        contractList.appendChild(
          card
        );

      }
    );

  }


  if (
    !jobs.length
  ) {

    jobList.innerHTML = `
      <div class="empty-state">

        <div class="empty-title">
          No Hauling Jobs
        </div>

        <div class="empty-sub">
          No active hauling jobs match the current filters.
        </div>

      </div>
    `;

  }
  else {

    jobList.innerHTML =
      "";


    jobs.forEach(
      job => {

        const linked =
          contractsForJob(
            job.id
          );


        const card =
          document.createElement(
            "div"
          );


        card.className =
          "hauling-job-drop-card";


        card.dataset.haulingJobDropId =
          job.id;


        const linkedMarkup =
          linked.length
            ? `

              <div
                style="
                  margin-top:9px;
                  padding-top:8px;
                  border-top:1px solid var(--border,#ddd);
                "
              >

                <div
                  style="
                    font-size:.72rem;
                    font-weight:800;
                    opacity:.65;
                    margin-bottom:5px;
                  "
                >
                  Linked Contracts
                </div>

                ${
                  linked.map(
                    contract => `

                      <div
                        class="hauling-linked-contract-item"
                        draggable="true"
                        data-hauling-contract-id="${
                          escapeHtml(
                            contract.id
                          )
                        }"
                        style="
                          padding:6px 8px;
                          margin-top:4px;
                          border:1px solid var(--border,#ddd);
                          border-radius:7px;
                          background:var(--surface-2,#f4f4f4);
                          font-size:.76rem;
                          font-weight:800;
                          cursor:grab;
                        "
                      >
                        Contract ${
                          escapeHtml(
                            contractNumber(
                              contract
                            )
                          )
                        }
                        •
                        ${
                          fmtBu(
                            contractBushels(
                              contract
                            )
                          )
                        }
                        bu
                      </div>

                    `
                  ).join(
                    ""
                  )
                }

              </div>

            `
            : `

              <div
                style="
                  margin-top:8px;
                  font-size:.74rem;
                  opacity:.6;
                "
              >
                No contracts linked yet.
              </div>

            `;


        card.innerHTML = `

          <div class="hauling-dnd-card-title">
            ${
              escapeHtml(
                jobName(
                  job
                )
              )
            }
          </div>

          <div class="hauling-dnd-card-meta">

            ${
              escapeHtml(
                job?.buyerName ||
                "Unknown buyer"
              )
            }
            •
            ${
              escapeHtml(
                job?.customerName ||
                "Unknown customer"
              )
            }
            •
            ${
              escapeHtml(
                jobCrop(
                  job
                ) ||
                "Unknown crop"
              )
            }

            <br>

            ${
              escapeHtml(
                job?.deliveryLocationName ||
                "No location"
              )
            }
            • Delivery

            ${
              escapeHtml(
                fmtDate(
                  job?.deliveryStartDate
                )
              )
            }

            –

            ${
              escapeHtml(
                fmtDate(
                  job?.deliveryEndDate
                )
              )
            }

            <br>

            ${
              fmtBu(
                jobRemainingBushels(
                  job
                )
              )
            }
            bu remaining
            •
            ${
              linked.length
            }
            linked contract${
              linked.length === 1
                ? ""
                : "s"
            }

          </div>

          ${
            linkedMarkup
          }

        `;


        bindJobDropTarget(
          card,
          job.id
        );


        card
          .querySelectorAll(
            ".hauling-linked-contract-item"
          )
          .forEach(
            item =>
              bindContractDragSource(
                item,
                clean(
                  item.dataset
                    .haulingContractId
                )
              )
          );


        jobList.appendChild(
          card
        );

      }
    );

  }

}


/* ============================================================
   DESKTOP + TOUCH DND
============================================================ */

function clearDndHighlights() {

  document
    .querySelectorAll(
      ".hauling-job-drop-card.drag-over"
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

}


function bindContractDragSource(
  element,
  contractId
) {

  if (
    !element ||
    element.dataset.haulingDragBound ===
      "1"
  ) {

    return;

  }


  element.dataset.haulingDragBound =
    "1";


  element.addEventListener(
    "dragstart",
    event => {

      if (
        state.busy
      ) {

        event.preventDefault();

        return;

      }


      state.draggingContractId =
        contractId;


      element.classList.add(
        "dragging"
      );


      event.dataTransfer
        .effectAllowed =
          "move";


      event.dataTransfer
        .setData(
          "text/plain",
          contractId
        );

    }
  );


  element.addEventListener(
    "dragend",
    () => {

      state.draggingContractId =
        "";


      element.classList.remove(
        "dragging"
      );


      clearDndHighlights();

    }
  );


  element.addEventListener(
    "pointerdown",
    event =>
      beginPointerHold(
        event,
        element,
        contractId
      )
  );

}


function bindJobDropTarget(
  element,
  jobId
) {

  element.addEventListener(
    "dragover",
    event => {

      const contract =
        state.contracts.find(
          item =>
            item.id ===
            state.draggingContractId
        );


      const job =
        state.jobs.find(
          item =>
            item.id ===
            jobId
        );


      if (
        !contract ||
        !job ||
        validateContractJob(
          contract,
          job
        )
      ) {

        return;

      }


      event.preventDefault();


      clearDndHighlights();


      element.classList.add(
        "drag-over"
      );

    }
  );


  element.addEventListener(
    "dragleave",
    event => {

      if (
        !event.relatedTarget ||
        !element.contains(
          event.relatedTarget
        )
      ) {

        element.classList.remove(
          "drag-over"
        );

      }

    }
  );


  element.addEventListener(
    "drop",
    async event => {

      event.preventDefault();


      const contractId =
        state.draggingContractId ||
        clean(
          event.dataTransfer
            ?.getData(
              "text/plain"
            )
        );


      clearDndHighlights();


      if (
        contractId
      ) {

        await linkContractToJob(
          contractId,
          jobId
        );

      }

    }
  );

}


function setupUnassignDrop() {

  const zone =
    $(
      "hauling-unassign-drop"
    );


  if (
    !zone
  ) {

    return;

  }


  zone.addEventListener(
    "dragover",
    event => {

      const contract =
        state.contracts.find(
          item =>
            item.id ===
            state.draggingContractId
        );


      if (
        !contract ||
        !clean(
          contract?.haulingJobId
        )
      ) {

        return;

      }


      event.preventDefault();


      clearDndHighlights();


      zone.classList.add(
        "drag-over"
      );

    }
  );


  zone.addEventListener(
    "dragleave",
    () =>
      zone.classList.remove(
        "drag-over"
      )
  );


  zone.addEventListener(
    "drop",
    async event => {

      event.preventDefault();


      const contractId =
        state.draggingContractId ||
        clean(
          event.dataTransfer
            ?.getData(
              "text/plain"
            )
        );


      clearDndHighlights();


      if (
        contractId
      ) {

        await unlinkContract(
          contractId
        );

      }

    }
  );

}


function beginPointerHold(
  event,
  element,
  contractId
) {

  if (
    event.pointerType ===
      "mouse" ||
    state.busy
  ) {

    return;

  }


  if (
    event.target.closest(
      "button,a,input,select,textarea,label"
    )
  ) {

    return;

  }


  cancelTouchDrag();


  state.touch.contractId =
    contractId;


  state.touch.source =
    element;


  state.touch.startX =
    event.clientX;


  state.touch.startY =
    event.clientY;


  state.touch.timer =
    setTimeout(
      () => {

        state.touch.timer =
          null;


        state.touch.active =
          true;


        element.classList.add(
          "dragging"
        );


        const contract =
          state.contracts.find(
            item =>
              item.id ===
              contractId
          );


        const ghost =
          document.createElement(
            "div"
          );


        ghost.textContent =
          `Contract ${
            contract
              ? contractNumber(
                  contract
                )
              : ""
          }`;


        Object.assign(
          ghost.style,
          {

            position:
              "fixed",

            zIndex:
              "999999",

            pointerEvents:
              "none",

            padding:
              "9px 12px",

            borderRadius:
              "9px",

            border:
              "2px solid #4f718f",

            background:
              "var(--surface,#fff)",

            color:
              "inherit",

            boxShadow:
              "0 10px 28px rgba(0,0,0,.24)",

            fontWeight:
              "900",

            fontSize:
              ".82rem",

            whiteSpace:
              "nowrap"

          }
        );


        document.body.appendChild(
          ghost
        );


        state.touch.ghost =
          ghost;


        moveTouchGhost(
          event.clientX,
          event.clientY
        );


        navigator.vibrate?.(
          25
        );

      },
      400
    );


  const move =
    moveEvent => {

      if (
        !state.touch.contractId
      ) {

        return;

      }


      if (
        !state.touch.active
      ) {

        const distance =
          Math.hypot(
            moveEvent.clientX -
            state.touch.startX,
            moveEvent.clientY -
            state.touch.startY
          );


        if (
          distance >
            12 &&
          state.touch.timer
        ) {

          clearTimeout(
            state.touch.timer
          );


          state.touch.timer =
            null;

        }


        return;

      }


      moveEvent.preventDefault();


      moveTouchGhost(
        moveEvent.clientX,
        moveEvent.clientY
      );


      updateTouchTarget(
        moveEvent.clientX,
        moveEvent.clientY
      );

    };


  const up =
    async upEvent => {

      element.removeEventListener(
        "pointermove",
        move
      );


      element.removeEventListener(
        "pointerup",
        up
      );


      element.removeEventListener(
        "pointercancel",
        cancelTouchDrag
      );


      if (
        !state.touch.active
      ) {

        cancelTouchDrag();

        return;

      }


      upEvent.preventDefault();


      const contractIdValue =
        state.touch.contractId;


      const target =
        state.touch.target;


      cancelTouchDrag();


      if (
        target?.type ===
          "job"
      ) {

        await linkContractToJob(
          contractIdValue,
          target.jobId
        );

      }


      if (
        target?.type ===
          "unassign"
      ) {

        await unlinkContract(
          contractIdValue
        );

      }

    };


  element.addEventListener(
    "pointermove",
    move,
    {
      passive:
        false
    }
  );


  element.addEventListener(
    "pointerup",
    up
  );


  element.addEventListener(
    "pointercancel",
    cancelTouchDrag
  );

}


function moveTouchGhost(
  x,
  y
) {

  if (
    !state.touch.ghost
  ) {

    return;

  }


  state.touch.ghost.style.left =
    `${
      x + 14
    }px`;


  state.touch.ghost.style.top =
    `${
      y + 14
    }px`;

}


function updateTouchTarget(
  x,
  y
) {

  clearDndHighlights();


  state.touch.target =
    null;


  if (
    state.touch.ghost
  ) {

    state.touch.ghost.style.display =
      "none";

  }


  const targetElement =
    document.elementFromPoint(
      x,
      y
    );


  if (
    state.touch.ghost
  ) {

    state.touch.ghost.style.display =
      "";

  }


  if (
    !(
      targetElement instanceof
      Element
    )
  ) {

    return;

  }


  const unassign =
    targetElement.closest(
      "#hauling-unassign-drop"
    );


  if (
    unassign
  ) {

    const contract =
      state.contracts.find(
        item =>
          item.id ===
          state.touch.contractId
      );


    if (
      contract &&
      clean(
        contract?.haulingJobId
      )
    ) {

      unassign.classList.add(
        "drag-over"
      );


      state.touch.target = {

        type:
          "unassign"

      };


      return;

    }

  }


  const jobCard =
    targetElement.closest(
      "[data-hauling-job-drop-id]"
    );


  if (
    jobCard
  ) {

    const jobId =
      clean(
        jobCard.dataset
          .haulingJobDropId
      );


    const job =
      state.jobs.find(
        item =>
          item.id ===
          jobId
      );


    const contract =
      state.contracts.find(
        item =>
          item.id ===
          state.touch.contractId
      );


    if (
      job &&
      contract &&
      !validateContractJob(
        contract,
        job
      )
    ) {

      jobCard.classList.add(
        "drag-over"
      );


      state.touch.target = {

        type:
          "job",

        jobId

      };

    }

  }

}


function cancelTouchDrag() {

  if (
    state.touch.timer
  ) {

    clearTimeout(
      state.touch.timer
    );

  }


  state.touch.timer =
    null;


  state.touch.source
    ?.classList
    .remove(
      "dragging"
    );


  state.touch.ghost
    ?.remove();


  state.touch.active =
    false;


  state.touch.contractId =
    "";


  state.touch.ghost =
    null;


  state.touch.source =
    null;


  state.touch.target =
    null;


  clearDndHighlights();

}


/* ============================================================
   SAVE / REMOVE CONTRACT PLANNING LINK
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
        clean(
          contractId
        )
    );


  const job =
    state.jobs.find(
      item =>
        item.id ===
        clean(
          jobId
        )
    );


  const validation =
    validateContractJob(
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


  const oldJob =
    linkedJob(
      contract
    );


  if (
    oldJob?.id ===
    job.id
  ) {

    return;

  }


  /* ==========================================================
     HAULING JOB CONTRACT BUSHEL LIMIT

     Total linked contract bushels may not exceed the
     hauling job's starting bushels.
  ========================================================== */

  const jobBushels =
    jobStartingBushels(
      job
    );


  const alreadyLinkedContractBushels =
    contractsForJob(
      job.id
    )
      .filter(
        linkedContract =>
          linkedContract.id !==
          contract.id &&
          !contractIsVoided(
            linkedContract
          )
      )
      .reduce(
        (
          total,
          linkedContract
        ) =>
          total +
          contractBushels(
            linkedContract
          ),
        0
      );


  const incomingContractBushels =
    contractBushels(
      contract
    );


  const newLinkedTotal =
    alreadyLinkedContractBushels +
    incomingContractBushels;


  if (
    newLinkedTotal >
    jobBushels + 0.005
  ) {

    const overBy =
      newLinkedTotal -
      jobBushels;


    const availableBushels =
      Math.max(
        0,
        jobBushels -
        alreadyLinkedContractBushels
      );


    alert(
      `This contract cannot be linked to ${jobName(job)}.\n\n` +
      `Hauling Job: ${fmtBu(jobBushels)} bu\n` +
      `Already Linked: ${fmtBu(alreadyLinkedContractBushels)} bu\n` +
      `This Contract: ${fmtBu(incomingContractBushels)} bu\n` +
      `Available: ${fmtBu(availableBushels)} bu\n\n` +
      `This would exceed the hauling job by ${fmtBu(overBy)} bu.`
    );


    return;

  }


  if (
    oldJob &&
    !window.confirm(
      `Contract ${
        contractNumber(
          contract
        )
      } is currently linked to ${
        jobName(
          oldJob
        )
      }.\n\nMove it to ${
        jobName(
          job
        )
      }?`
    )
  ) {

    return;

  }


  const who =
    auth.currentUser;


  state.busy =
    true;


  try {

    await updateDoc(
      doc(
        db,
        COLLECTIONS.contracts,
        contract.id
      ),
      {

        haulingJobId:
          job.id,

        haulingJobName:
          jobName(
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


    contract.haulingJobId =
      job.id;


    contract.haulingJobName =
      jobName(
        job
      );


    renderJobs();


    renderLinkWorkspace();


    queueContractTableDecoration();

  }
  catch (
    error
  ) {

    console.error(
      "[Hauling Jobs] contract link failed:",
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


    clearDndHighlights();

  }

}


async function unlinkContract(
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
        clean(
          contractId
        )
    );


  if (
    !contract ||
    !clean(
      contract?.haulingJobId
    )
  ) {

    return;

  }


  const job =
    linkedJob(
      contract
    );


  if (
    !window.confirm(
      `Remove Contract ${
        contractNumber(
          contract
        )
      } from ${
        job
          ? jobName(
              job
            )
          : "its hauling job"
      }?\n\nThis does not change ticket-to-contract assignments.`
    )
  ) {

    return;

  }


  state.busy =
    true;


  try {

    await updateDoc(
      doc(
        db,
        COLLECTIONS.contracts,
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
      null;


    contract.haulingJobName =
      null;


    renderJobs();


    renderLinkWorkspace();


    queueContractTableDecoration();

  }
  catch (
    error
  ) {

    console.error(
      "[Hauling Jobs] contract unlink failed:",
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


    clearDndHighlights();

  }

}


/* ============================================================
   CONTRACT TABLE HAULING JOB COLUMN

   grain-contracts.js still owns the rest of the row.
============================================================ */

function findContractForTableRow(
  row
) {

  if (
    !row ||
    row.cells.length <
      10
  ) {

    return null;

  }


  const numberText =
    clean(
      row.cells[1]
        ?.textContent
    );


  const buyerText =
    clean(
      row.cells[2]
        ?.textContent
    );


  const customerText =
    clean(
      row.cells[3]
        ?.textContent
    );


  const cropText =
    clean(
      row.cells[4]
        ?.textContent
    );


  return state.contracts.find(
    contract =>
      clean(
        contractNumber(
          contract
        )
      ) ===
        numberText &&
      clean(
        contract?.buyerName
      ) ===
        buyerText &&
      clean(
        contract?.customerName
      ) ===
        customerText &&
      clean(
        contractCrop(
          contract
        )
      ) ===
        cropText
  ) ||
  null;

}


function decorateContractTable() {

  const tbody =
    $(
      "contracts-table-body"
    );


  if (
    !tbody
  ) {

    return;

  }


  [
    ...tbody.rows
  ]
    .forEach(
      row => {

        const contract =
          findContractForTableRow(
            row
          );


        if (
          !contract
        ) {

          return;

        }


        let cell =
          row.querySelector(
            ':scope > td[data-hauling-job-cell="1"]'
          );


        if (
          !cell
        ) {

          cell =
            document.createElement(
              "td"
            );


          cell.dataset.haulingJobCell =
            "1";


          /*
            Existing grain-contracts.js ends with Delivery,
            so insert the Hauling Job column directly before it.
          */
          const deliveryCell =
            row.lastElementChild;


          if (
            deliveryCell
          ) {

            row.insertBefore(
              cell,
              deliveryCell
            );

          }
          else {

            row.appendChild(
              cell
            );

          }

        }


        const job =
          linkedJob(
            contract
          );


        cell.innerHTML =
          job
            ? `

              <span
                class="planning-link-pill"
                title="${
                  escapeHtml(
                    jobName(
                      job
                    )
                  )
                }"
              >
                ${
                  escapeHtml(
                    jobName(
                      job
                    )
                  )
                }
              </span>

            `
            : `

              <span class="planning-link-pill none">
                Not Linked
              </span>

            `;

      }
    );

}


function queueContractTableDecoration() {

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


      decorateContractTable();

    }
  );

}


function observeContractTable() {

  const tbody =
    $(
      "contracts-table-body"
    );


  if (
    !tbody
  ) {

    return;

  }


  state.contractObserver
    ?.disconnect();


  state.contractObserver =
    new MutationObserver(
      queueContractTableDecoration
    );


  state.contractObserver
    .observe(
      tbody,
      {
        childList:
          true,

        subtree:
          true
      }
    );


  queueContractTableDecoration();

}


/* ============================================================
   EVENTS / START
============================================================ */

function setupEvents() {

  $(
    "add-hauling-job-btn"
  )
    ?.addEventListener(
      "click",
      openAddJob
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
    "void-hauling-job-btn"
  )
    ?.addEventListener(
      "click",
      voidJob
    );


  $(
    "hauling-job-form"
  )
    ?.addEventListener(
      "submit",
      saveJob
    );


  $(
    "hauling-job-buyer"
  )
    ?.addEventListener(
      "change",
      () =>
        populateJobLocationSelect()
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
          $(
            id
          );


        element
          ?.addEventListener(
            id ===
              "hauling-search-filter"
              ? "input"
              : "change",
            renderJobs
          );

      }
    );


  $(
    "hauling-link-buyer"
  )
    ?.addEventListener(
      "change",
      () => {

        populateLinkCustomer();


        renderLinkWorkspace();

      }
    );


  $(
    "hauling-link-customer"
  )
    ?.addEventListener(
      "change",
      () => {

        populateLinkCrop();


        renderLinkWorkspace();

      }
    );


  $(
    "hauling-link-crop"
  )
    ?.addEventListener(
      "change",
      renderLinkWorkspace
    );


  $(
    "refresh-hauling-link-btn"
  )
    ?.addEventListener(
      "click",
      refreshHauling
    );


  document.addEventListener(
    "keydown",
    event => {

      if (
        event.key ===
          "Escape"
      ) {

        closeJobModal();


        cancelTouchDrag();

      }

    }
  );


  setupUnassignDrop();

}


async function start() {

  setupEvents();


  await loadAllData();


  populateJobFilters();


  renderJobs();


  populateLinkBuyer();


  populateLinkCustomer();


  renderLinkWorkspace();


  observeContractTable();


  document.addEventListener(
    "visibilitychange",
    () => {

      if (
        document.visibilityState ===
          "visible"
      ) {

        refreshHauling();

      }

    }
  );


  window.addEventListener(
    "pageshow",
    event => {

      if (
        event.persisted
      ) {

        refreshHauling();

      }

    }
  );

}


start()
  .catch(
    error => {

      console.error(
        "[Hauling Jobs] startup failed:",
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
