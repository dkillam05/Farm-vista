// /js/grain-contracts.js
// FarmVista — Grain Contracts / Reconciliation
// Split-load allocation model
// Updated 2026-08-18

import {
  ready,
  getFirestore,
  getAuth,
  collection,
  getDocs,
  doc,
  updateDoc,
  serverTimestamp
} from "/js/firebase-init.js";

await ready;

const db = getFirestore();
const auth = getAuth();

const CONTRACT_COLLECTION = "grain_contracts";
const BUYER_COLLECTION = "grain_buyers";
const CUSTOMER_COLLECTION = "grain_customers";
const LOCATION_COLLECTION = "grain_delivery_locations";
const TICKET_COLLECTION = "grain_tickets";
const VOID_REVERSAL_COLLECTION = "grain_ticket_void_reversals";

const $ = id => document.getElementById(id);

const clean = value =>
  String(value ?? "").trim();

const normalized = value =>
  clean(value).toLowerCase();

const numberValue = value => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const EPSILON = 0.005;
const RECONCILIATION_ALL = "__all__";

const roundBushels = value =>
  Number(numberValue(value).toFixed(2));


const state = {
  contracts: [],
  filteredContracts: [],
  buyers: [],
  customers: [],
  deliveryLocations: [],
  tickets: [],

  activeContract: null,
  activeTicket: null,

  reconcileBuyerId: RECONCILIATION_ALL,
  reconcileCustomerId: RECONCILIATION_ALL,

  selectedTicketIds: new Set(),

  draggingTicketId: "",
  draggingSourceType: "",
  draggingSourceId: "",

  busy: false,

  editFuturesPrice: null,
  editBasisPrice: null,
  editCashPrice: null,

  showVoided: false
};


/* ============================================================
   FORMATTERS
============================================================ */

function formatBushels(value) {
  return numberValue(value).toLocaleString(
    "en-US",
    {
      maximumFractionDigits: 2
    }
  );
}


function formatWholeNumber(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "—";
  }

  return Math.round(number).toLocaleString(
    "en-US"
  );
}


function formatGrade(
  value,
  suffix = ""
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return "—";
  }

  const number = Number(value);

  if (!Number.isFinite(number)) {
    return clean(value) || "—";
  }

  return `${number.toFixed(2)}${suffix}`;
}


function formatPrice(value) {
  return numberValue(value).toLocaleString(
    "en-US",
    {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }
  );
}


function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


function formatDate(iso) {
  const parts =
    clean(iso).split("-");

  if (parts.length !== 3) {
    return clean(iso);
  }

  return `${
    Number(parts[1])
  }/${
    Number(parts[2])
  }/${
    parts[0]
  }`;
}


function formatDeliveryWindow(
  contract
) {
  const start =
    clean(
      contract.deliveryStart
    );

  const end =
    clean(
      contract.deliveryEnd
    );

  if (
    !start &&
    !end
  ) {
    return "—";
  }

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

  return formatDate(
    start || end
  );
}


function uniqueSorted(values) {
  return [
    ...new Set(
      values
        .map(clean)
        .filter(Boolean)
    )
  ].sort(
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


function sortByName(items) {
  items.sort(
    (a, b) =>
      clean(a.name)
        .localeCompare(
          clean(b.name),
          undefined,
          {
            numeric: true,
            sensitivity: "base"
          }
        )
  );
}


function compareContracts(
  a,
  b
) {
  const dateCompare =
    clean(b.contractDate)
      .localeCompare(
        clean(a.contractDate)
      );

  if (dateCompare) {
    return dateCompare;
  }

  return clean(
    a.contractNumber
  ).localeCompare(
    clean(
      b.contractNumber
    ),
    undefined,
    {
      numeric: true,
      sensitivity: "base"
    }
  );
}


function compareTickets(
  a,
  b
) {
  const dateCompare =
    clean(a.ticketDate)
      .localeCompare(
        clean(b.ticketDate)
      );

  if (dateCompare) {
    return dateCompare;
  }

  return clean(
    a.ticketNumber
  ).localeCompare(
    clean(
      b.ticketNumber
    ),
    undefined,
    {
      numeric: true,
      sensitivity: "base"
    }
  );
}


function addDays(
  iso,
  days
) {
  const [
    year,
    month,
    day
  ] =
    clean(iso)
      .split("-")
      .map(Number);

  const date =
    new Date(
      year,
      month - 1,
      day
    );

  date.setDate(
    date.getDate() +
    days
  );

  return `${
    date.getFullYear()
  }-${
    String(
      date.getMonth() + 1
    ).padStart(2, "0")
  }-${
    String(
      date.getDate()
    ).padStart(2, "0")
  }`;
}


/* ============================================================
   SELECT HELPERS
============================================================ */

function setSelectValue(
  select,
  value
) {
  if (!select) {
    return false;
  }

  const wanted =
    clean(value);

  const option =
    [...select.options]
      .find(
        item =>
          clean(item.value) ===
          wanted
      );

  if (!option) {
    select.value = "";
    return false;
  }

  select.value =
    option.value;

  return true;
}


function populateObjectSelect(
  select,
  items,
  placeholder,
  selected = ""
) {
  if (!select) {
    return;
  }

  select.innerHTML = "";

  const blank =
    document.createElement(
      "option"
    );

  blank.value = "";
  blank.textContent =
    placeholder;

  select.appendChild(
    blank
  );

  items.forEach(
    item => {
      const option =
        document.createElement(
          "option"
        );

      option.value =
        item.id;

      option.textContent =
        item.name;

      select.appendChild(
        option
      );
    }
  );

  setSelectValue(
    select,
    selected
  );
}


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
      ?.cloneNode(true);

  select.innerHTML = "";

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

  setSelectValue(
    select,
    current
  );
}


/* ============================================================
   TICKET ALLOCATION MODEL
============================================================ */

function getTicketAllocations(
  ticket
) {
  if (
    !ticket ||
    ticket.voided
  ) {
    return [];
  }

  if (
    Array.isArray(
      ticket.contractAllocations
    )
  ) {
    return ticket.contractAllocations
      .map(
        allocation => ({
          contractId:
            clean(
              allocation?.contractId
            ),

          contractNumber:
            clean(
              allocation?.contractNumber
            ),

          bushels:
            roundBushels(
              allocation?.bushels
            )
        })
      )
      .filter(
        allocation =>
          allocation.contractId &&
          allocation.bushels >
          EPSILON
      );
  }

  if (
    clean(
      ticket.contractId
    )
  ) {
    return [
      {
        contractId:
          clean(
            ticket.contractId
          ),

        contractNumber:
          clean(
            ticket.contractNumber
          ),

        bushels:
          roundBushels(
            ticket.netBushels
          )
      }
    ];
  }

  return [];
}


function getContractAllocatedBushels(
  ticket
) {
  return roundBushels(
    getTicketAllocations(
      ticket
    ).reduce(
      (
        total,
        allocation
      ) =>
        total +
        allocation.bushels,
      0
    )
  );
}


function getSpotBushels(
  ticket
) {
  return roundBushels(
    Math.max(
      0,
      numberValue(
        ticket?.spotBushels
      )
    )
  );
}


function getUnassignedBushels(
  ticket
) {
  if (
    !ticket ||
    ticket.voided
  ) {
    return 0;
  }

  const total =
    numberValue(
      ticket.netBushels
    );

  const contracted =
    getContractAllocatedBushels(
      ticket
    );

  const spot =
    getSpotBushels(
      ticket
    );

  return roundBushels(
    Math.max(
      0,
      total -
      contracted -
      spot
    )
  );
}


function getAllocationToContract(
  ticket,
  contractId
) {
  return getTicketAllocations(
    ticket
  ).find(
    allocation =>
      clean(
        allocation.contractId
      ) ===
      clean(
        contractId
      )
  ) || null;
}


function getAllocationBushels(
  ticket,
  contractId
) {
  return roundBushels(
    getAllocationToContract(
      ticket,
      contractId
    )?.bushels ||
    0
  );
}


function setLocalAllocations(
  ticket,
  allocations,
  spotBushels = 0
) {
  ticket.contractAllocations =
    allocations
      .map(
        allocation => ({
          contractId:
            clean(
              allocation.contractId
            ),

          contractNumber:
            clean(
              allocation.contractNumber
            ),

          bushels:
            roundBushels(
              allocation.bushels
            )
        })
      )
      .filter(
        allocation =>
          allocation.contractId &&
          allocation.bushels >
          EPSILON
      );

  ticket.spotBushels =
    roundBushels(
      Math.max(
        0,
        spotBushels
      )
    );

  ticket.allocationModelVersion =
    2;

  const remaining =
    getUnassignedBushels(
      ticket
    );

  const onlyAllocation =
    ticket.contractAllocations
      .length === 1
      ? ticket.contractAllocations[0]
      : null;

  if (
    onlyAllocation &&
    remaining <= EPSILON &&
    ticket.spotBushels <=
      EPSILON
  ) {
    ticket.contractId =
      onlyAllocation.contractId;

    ticket.contractNumber =
      onlyAllocation.contractNumber;
  }
  else {
    ticket.contractId = "";
    ticket.contractNumber = "";
  }

  ticket.unassignedBushels =
    remaining;
}


function buildAllocationPatch(
  ticket,
  allocations,
  spotBushels = 0
) {
  const normalizedAllocations =
    allocations
      .map(
        allocation => ({
          contractId:
            clean(
              allocation.contractId
            ),

          contractNumber:
            clean(
              allocation.contractNumber
            ),

          bushels:
            roundBushels(
              allocation.bushels
            )
        })
      )
      .filter(
        allocation =>
          allocation.contractId &&
          allocation.bushels >
          EPSILON
      );

  const spot =
    roundBushels(
      Math.max(
        0,
        spotBushels
      )
    );

  const contractTotal =
    normalizedAllocations
      .reduce(
        (
          total,
          allocation
        ) =>
          total +
          allocation.bushels,
        0
      );

  const used =
    roundBushels(
      contractTotal +
      spot
    );

  const ticketTotal =
    numberValue(
      ticket.netBushels
    );

  if (
    used -
    ticketTotal >
    EPSILON
  ) {
    throw new Error(
      "Ticket allocations exceed the ticket bushels."
    );
  }

  const remaining =
    roundBushels(
      Math.max(
        0,
        ticketTotal -
        used
      )
    );

  const onlyAllocation =
    normalizedAllocations
      .length === 1
      ? normalizedAllocations[0]
      : null;

  const legacyWholeTicket =
    onlyAllocation &&
    remaining <= EPSILON &&
    spot <= EPSILON;

  return {
    contractAllocations:
      normalizedAllocations,

    spotBushels:
      spot,

    unassignedBushels:
      remaining,

    allocationModelVersion:
      2,

    contractId:
      legacyWholeTicket
        ? onlyAllocation.contractId
        : null,

    contractNumber:
      legacyWholeTicket
        ? (
            onlyAllocation
              .contractNumber ||
            null
          )
        : null,

    reconciliationStatus:
      remaining >
      EPSILON
        ? "needs_contract"
        : "reconciled",

    updatedAt:
      serverTimestamp()
  };
}


async function persistTicketAllocations(
  ticket,
  allocations,
  spotBushels = 0
) {
  const patch =
    buildAllocationPatch(
      ticket,
      allocations,
      spotBushels
    );

  await updateDoc(
    doc(
      db,
      TICKET_COLLECTION,
      ticket.id
    ),
    patch
  );

  setLocalAllocations(
    ticket,
    allocations,
    spotBushels
  );
}


function allocationSummary(
  ticket
) {
  const parts =
    getTicketAllocations(
      ticket
    ).map(
      allocation =>
        `${
          formatBushels(
            allocation.bushels
          )
        } bu → Contract ${
          allocation
            .contractNumber ||
          allocation
            .contractId
        }`
    );

  const spot =
    getSpotBushels(
      ticket
    );

  const remaining =
    getUnassignedBushels(
      ticket
    );

  if (
    spot >
    EPSILON
  ) {
    parts.push(
      `${
        formatBushels(
          spot
        )
      } bu → Spot`
    );
  }

  if (
    remaining >
    EPSILON
  ) {
    parts.push(
      `${
        formatBushels(
          remaining
        )
      } bu → Unassigned`
    );
  }

  return (
    parts.join(" • ") ||
    "Unassigned"
  );
}


/* ============================================================
   LEGACY ASSIGNMENT MIGRATION
============================================================ */

async function migrateLegacyAssignments() {
  const remainingByContract =
    new Map(
      state.contracts.map(
        contract => [
          clean(
            contract.id
          ),
          Math.max(
            0,
            numberValue(
              contract.contractBushels
            )
          )
        ]
      )
    );

  state.tickets.forEach(
    ticket => {
      if (
        ticket.voided ||
        !Array.isArray(
          ticket.contractAllocations
        )
      ) {
        return;
      }

      getTicketAllocations(
        ticket
      ).forEach(
        allocation => {
          const remaining =
            numberValue(
              remainingByContract.get(
                allocation.contractId
              )
            );

          remainingByContract.set(
            allocation.contractId,
            Math.max(
              0,
              remaining -
              allocation.bushels
            )
          );
        }
      );
    }
  );

  const legacyTickets =
    state.tickets
      .filter(
        ticket =>
          !ticket.voided &&
          !Array.isArray(
            ticket.contractAllocations
          ) &&
          clean(
            ticket.contractId
          )
      )
      .sort(
        compareTickets
      );

  const affectedContracts =
    new Set();

  for (
    const ticket
    of legacyTickets
  ) {
    const contractId =
      clean(
        ticket.contractId
      );

    const contract =
      state.contracts.find(
        item =>
          clean(item.id) ===
          contractId
      );

    if (!contract) {
      await persistTicketAllocations(
        ticket,
        [],
        0
      );

      continue;
    }

    const remaining =
      Math.max(
        0,
        numberValue(
          remainingByContract.get(
            contractId
          )
        )
      );

    const ticketBushels =
      numberValue(
        ticket.netBushels
      );

    const amount =
      roundBushels(
        Math.min(
          ticketBushels,
          remaining
        )
      );

    const allocations =
      amount >
      EPSILON
        ? [
            {
              contractId:
                contractId,

              contractNumber:
                clean(
                  ticket
                    .contractNumber ||
                  contract
                    .contractNumber
                ),

              bushels:
                amount
            }
          ]
        : [];

    await persistTicketAllocations(
      ticket,
      allocations,
      0
    );

    remainingByContract.set(
      contractId,
      roundBushels(
        Math.max(
          0,
          remaining -
          amount
        )
      )
    );

    affectedContracts.add(
      contractId
    );
  }

  return [
    ...affectedContracts
  ];
}


/* ============================================================
   CONTRACT TOTALS
============================================================ */

function getAssignedTickets(
  contractId
) {
  return state.tickets
    .filter(
      ticket =>
        !ticket.voided &&
        getAllocationBushels(
          ticket,
          contractId
        ) >
        EPSILON
    )
    .sort(
      compareTickets
    );
}


function calculateContractTotals(
  contract
) {
  const tickets =
    getAssignedTickets(
      contract.id
    );

  const deliveredBushels =
    roundBushels(
      tickets.reduce(
        (
          total,
          ticket
        ) =>
          total +
          getAllocationBushels(
            ticket,
            contract.id
          ),
        0
      )
    );

  const contractBushels =
    numberValue(
      contract.contractBushels
    );

  return {
    deliveredBushels,

    openBushels:
      roundBushels(
        Math.max(
          0,
          contractBushels -
          deliveredBushels
        )
      ),

    overhaulBushels:
      0,

    loadCount:
      tickets.length
  };
}


function rebuildContractTotalsFromTickets() {
  state.contracts.forEach(
    contract => {
      Object.assign(
        contract,
        calculateContractTotals(
          contract
        )
      );
    }
  );
}


async function syncContractTotalsForIds(
  contractIds
) {
  const unique =
    [
      ...new Set(
        contractIds
          .map(clean)
          .filter(Boolean)
      )
    ];

  for (
    const contractId
    of unique
  ) {
    const contract =
      state.contracts.find(
        item =>
          clean(item.id) ===
          contractId
      );

    if (!contract) {
      continue;
    }

    Object.assign(
      contract,
      calculateContractTotals(
        contract
      )
    );

    await updateDoc(
      doc(
        db,
        CONTRACT_COLLECTION,
        contract.id
      ),
      {
        deliveredBushels:
          contract.deliveredBushels,

        openBushels:
          contract.openBushels,

        updatedAt:
          serverTimestamp()
      }
    );
  }
}


/* ============================================================
   CONTRACT STATUS
============================================================ */

function getContractStatus(
  contract
) {
  if (
    contract?.voided
  ) {
    return "voided";
  }

  const total =
    numberValue(
      contract.contractBushels
    );

  const delivered =
    numberValue(
      contract.deliveredBushels
    );

  const open =
    total -
    delivered;

  if (
    open <= EPSILON &&
    total > 0
  ) {
    return "complete";
  }

  const deliveryStart =
    clean(
      contract.deliveryStart
    );

  if (
    deliveryStart
  ) {
    const now =
      new Date();

    const today =
      `${
        now.getFullYear()
      }-${
        String(
          now.getMonth() + 1
        ).padStart(
          2,
          "0"
        )
      }-${
        String(
          now.getDate()
        ).padStart(
          2,
          "0"
        )
      }`;

    if (
      deliveryStart >
      today
    ) {
      return "pending";
    }
  }

  if (
    total > 0 &&
    open > 0 &&
    open <=
      Math.max(
        total * 0.1,
        1000
      )
  ) {
    return "near";
  }

  return "open";
}


function getStatusLabel(
  contract
) {
  const status =
    getContractStatus(
      contract
    );

  return {
    voided:
      "Voided",

    complete:
      "Completed",

    pending:
      "Pending",

    near:
      "Near Full",

    open:
      "Open"
  }[status] || "Open";
}


function getStatusClass(
  contract
) {
  return `status-${
    getContractStatus(
      contract
    )
  }`;
}


/* ============================================================
   CURRENT USER
============================================================ */

function currentVoidUser() {
  const user =
    auth?.currentUser ||
    null;

  return {
    uid:
      clean(
        user?.uid
      ) ||
      null,

    name:
      clean(
        user?.displayName
      ) ||
      clean(
        user?.email
      ) ||
      "FarmVista User",

    email:
      clean(
        user?.email
      ) ||
      null
  };
}


async function requireRunTransaction() {
  const module =
    await import(
      "/js/firebase-init.js"
    );

  if (
    typeof module.runTransaction !==
    "function"
  ) {
    throw new Error(
      "Firestore transaction support is unavailable."
    );
  }

  return module.runTransaction;
}


/* ============================================================
   GRAIN BAG HELPERS FOR VOID REVERSALS
============================================================ */

function bagLength(data) {
  const number =
    Number(
      data?.bagSku?.sizeFeet ??
      data?.bagSku?.lengthFt
    );

  return (
    Number.isFinite(number) &&
    number > 0
  )
    ? number
    : 0;
}


function bagCurrentFeet(
  data,
  length
) {
  const counts =
    data?.counts ||
    {};

  const full =
    Math.max(
      0,
      Math.floor(
        numberValue(
          counts.full
        )
      )
    );

  const partial =
    Math.max(
      0,
      Math.floor(
        numberValue(
          counts.partial
        )
      )
    );

  const raw =
    Array.isArray(
      data?.partialFeet
    )
      ? data.partialFeet
      : (
          Array.isArray(
            counts.partialFeet
          )
            ? counts.partialFeet
            : []
        );

  let partialFeet =
    raw.reduce(
      (
        total,
        value
      ) =>
        total +
        Math.max(
          0,
          numberValue(value)
        ),
      0
    );

  if (
    partial > 0 &&
    partialFeet <= 0 &&
    length > 0
  ) {
    partialFeet =
      partial *
      0.5 *
      length;
  }

  return (
    full *
    length
  ) +
  partialFeet;
}


function bagCountsFromFeet(
  totalFeet,
  length
) {
  if (!(length > 0)) {
    throw new Error(
      "Original grain bag length is missing."
    );
  }

  const safe =
    Math.max(
      0,
      numberValue(
        totalFeet
      )
    );

  const full =
    Math.floor(
      safe /
      length
    );

  let remainder =
    safe -
    (
      full *
      length
    );

  if (
    remainder <
    0.01
  ) {
    remainder = 0;
  }

  return {
    full,

    partial:
      remainder > 0
        ? 1
        : 0,

    partialFeet:
      remainder > 0
        ? [
            Number(
              remainder.toFixed(2)
            )
          ]
        : []
  };
}


function bagSourceId(
  pickup
) {
  const applied =
    Array.isArray(
      pickup?.appliedTo
    )
      ? pickup.appliedTo
      : [];

  return clean(
    applied[0]
      ?.refPutDownId
  );
}


/* ============================================================
   STARTUP
============================================================ */

function onReady(fn) {
  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      fn,
      {
        once: true
      }
    );
  }
  else {
    fn();
  }
}


onReady(
  async () => {
    setupFilters();
    setupReconciliationControls();
    setupModal();
    setupTicketDetailModal();
    setupEditBushels();
    setupEditPrice();
    setupEditDates();
    setupVoidControls();

    try {
      await loadAllData();

      await migrateLegacyAssignments();

      rebuildContractTotalsFromTickets();

      await syncContractTotalsForIds(
        state.contracts.map(
          contract =>
            contract.id
        )
      );

      populateAllPickers();

      renderAll();
    }
    catch (error) {
      console.error(
        "[Grain Contracts] Initial load failed:",
        error
      );

      if (
        $("contracts-table-body")
      ) {
        $("contracts-table-body")
          .innerHTML = `
            <tr>
              <td colspan="11">
                <div class="empty-state">
                  <div class="empty-title">
                    Unable to Load Grain Contracts
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
  }
);


/* ============================================================
   LOAD FIRESTORE
============================================================ */

async function loadAllData() {
  const [
    contractSnapshot,
    buyerSnapshot,
    customerSnapshot,
    locationSnapshot,
    ticketSnapshot
  ] =
    await Promise.all([
      getDocs(
        collection(
          db,
          CONTRACT_COLLECTION
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
      ),

      getDocs(
        collection(
          db,
          TICKET_COLLECTION
        )
      )
    ]);


  state.contracts =
    contractSnapshot.docs
      .map(
        snapshot => {
          const data =
            snapshot.data() ||
            {};

          return {
            id:
              snapshot.id,

            ...data,

            buyerId:
              clean(
                data.buyerId
              ),

            buyerName:
              clean(
                data.buyerName
              ),

            customerId:
              clean(
                data.customerId
              ),

            customerName:
              clean(
                data.customerName
              ),

            crop:
              clean(
                data.crop
              ),

            contractType:
              clean(
                data.contractType
              ),

            contractNumber:
              clean(
                data.contractNumber
              ),

            contractDate:
              clean(
                data.contractDate
              ),

            deliveryLocationId:
              clean(
                data.deliveryLocationId
              ),

            deliveryLocationName:
              clean(
                data.deliveryLocationName
              ),

            deliveryStreet:
              clean(
                data.deliveryStreet
              ),

            deliveryCity:
              clean(
                data.deliveryCity
              ),

            deliveryState:
              clean(
                data.deliveryState
              ),

            deliveryZip:
              clean(
                data.deliveryZip
              ),

            deliveryStart:
              clean(
                data.deliveryStart
              ),

            deliveryEnd:
              clean(
                data.deliveryEnd
              ),

            notes:
              clean(
                data.notes
              ),

            contractBushels:
              numberValue(
                data.contractBushels
              ),

            deliveredBushels:
              numberValue(
                data.deliveredBushels
              ),

            openBushels:
              numberValue(
                data.openBushels
              ),

            pricePerBushel:
              numberValue(
                data.pricePerBushel
              )
          };
        }
      )
      .sort(
        compareContracts
      );


  state.buyers =
    buyerSnapshot.docs
      .map(
        snapshot => ({
          id:
            snapshot.id,

          name:
            clean(
              snapshot
                .data()
                ?.name
            )
        })
      )
      .filter(
        item =>
          item.name
      );

  sortByName(
    state.buyers
  );


  state.customers =
    customerSnapshot.docs
      .map(
        snapshot => ({
          id:
            snapshot.id,

          name:
            clean(
              snapshot
                .data()
                ?.name
            )
        })
      )
      .filter(
        item =>
          item.name
      );

  sortByName(
    state.customers
  );


  state.deliveryLocations =
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
      .sort(
        (a, b) =>
          clean(
            a.locationName
          ).localeCompare(
            clean(
              b.locationName
            )
          )
      );


  state.tickets =
    ticketSnapshot.docs
      .map(
        snapshot => {
          const data =
            snapshot.data() ||
            {};

          return {
            id:
              snapshot.id,

            ...data,

            buyerId:
              clean(
                data.buyerId
              ),

            buyerName:
              clean(
                data.buyerName
              ),

            customerId:
              clean(
                data.customerId
              ),

            customerName:
              clean(
                data.customerName
              ),

            ticketNumber:
              clean(
                data.ticketNumber
              ),

            ticketDate:
              clean(
                data.ticketDate
              ),

            crop:
              clean(
                data.crop
              ),

            netBushels:
              numberValue(
                data.netBushels
              ),

            contractId:
              clean(
                data.contractId
              ),

            contractNumber:
              clean(
                data.contractNumber
              ),

            contractAllocations:
              Array.isArray(
                data.contractAllocations
              )
                ? data.contractAllocations
                : undefined,

            spotBushels:
              numberValue(
                data.spotBushels
              ),

            unassignedBushels:
              numberValue(
                data.unassignedBushels
              ),

            allocationModelVersion:
              numberValue(
                data.allocationModelVersion
              ),

            driverName:
              clean(
                data.driverName
              ),

            deliveryLocationName:
              clean(
                data.deliveryLocationName
              )
          };
        }
      );
}


/* ============================================================
   VOID CONTROLS
============================================================ */

function setupVoidControls() {
  state.showVoided =
    Boolean(
      $("show-voided-checkbox")
        ?.checked
    );

  $("show-voided-checkbox")
    ?.addEventListener(
      "change",
      function () {
        state.showVoided =
          Boolean(
            this.checked
          );

        renderAll();
      }
    );

  $("void-contract-btn")
    ?.addEventListener(
      "click",
      voidActiveContract
    );

  $("void-ticket-btn")
    ?.addEventListener(
      "click",
      voidActiveTicket
    );
}


function updateContractVoidButton() {
  const button =
    $("void-contract-btn");

  const contract =
    state.activeContract;

  if (!button) {
    return;
  }

  if (!contract) {
    button.disabled = true;
    return;
  }

  if (
    contract.voided
  ) {
    button.disabled = true;
    button.textContent =
      "Contract Voided";
    return;
  }

  const assigned =
    getAssignedTickets(
      contract.id
    );

  button.disabled =
    state.busy ||
    assigned.length > 0;

  button.textContent =
    assigned.length
      ? `Void Contract (${
          assigned.length
        } active ticket${
          assigned.length === 1
            ? ""
            : "s"
        } assigned)`
      : "Void Contract";
}


function updateTicketVoidButton() {
  const button =
    $("void-ticket-btn");

  const ticket =
    state.activeTicket;

  if (!button) {
    return;
  }

  if (!ticket) {
    button.disabled = true;
    return;
  }

  button.disabled =
    state.busy ||
    Boolean(
      ticket.voided
    );

  button.textContent =
    ticket.voided
      ? "Ticket Voided"
      : "Void Ticket";
}


/* ============================================================
   VOID CONTRACT
============================================================ */

async function voidActiveContract() {
  const contract =
    state.activeContract;

  if (
    !contract ||
    state.busy
  ) {
    return;
  }

  if (
    contract.voided
  ) {
    alert(
      "This grain contract is already voided."
    );

    return;
  }

  const assigned =
    getAssignedTickets(
      contract.id
    );

  if (
    assigned.length
  ) {
    alert(
      `Contract ${
        contract.contractNumber ||
        contract.id
      } cannot be voided while ${
        assigned.length
      } active grain ticket${
        assigned.length === 1
          ? " is"
          : "s are"
      } assigned to it.\n\nMove or void those tickets first.`
    );

    return;
  }

  const reason =
    clean(
      window.prompt(
        `Why are you voiding Contract ${
          contract.contractNumber ||
          contract.id
        }?`
      )
    );

  if (!reason) {
    return;
  }

  const confirmed =
    window.confirm(
      `Void Contract ${
        contract.contractNumber ||
        contract.id
      }?\n\nThis does not delete the contract. It will be hidden by default and cannot receive grain tickets.`
    );

  if (!confirmed) {
    return;
  }

  state.busy = true;

  updateContractVoidButton();

  try {
    const runTransaction =
      await requireRunTransaction();

    const who =
      currentVoidUser();

    const contractRef =
      doc(
        db,
        CONTRACT_COLLECTION,
        contract.id
      );

    await runTransaction(
      db,
      async transaction => {
        const snapshot =
          await transaction.get(
            contractRef
          );

        if (
          !snapshot.exists()
        ) {
          throw new Error(
            "That grain contract no longer exists."
          );
        }

        const latest =
          snapshot.data() ||
          {};

        if (
          latest.voided
        ) {
          return;
        }

        const activeAssigned =
          state.tickets.filter(
            ticket =>
              !ticket.voided &&
              getAllocationBushels(
                ticket,
                contract.id
              ) >
              EPSILON
          );

        if (
          activeAssigned.length
        ) {
          throw new Error(
            "This contract still has active grain tickets assigned. Move or void them first."
          );
        }

        transaction.update(
          contractRef,
          {
            voided:
              true,

            voidedAt:
              serverTimestamp(),

            voidedByUid:
              who.uid,

            voidedByName:
              who.name,

            voidedByEmail:
              who.email,

            voidReason:
              reason,

            voidedContractBushels:
              numberValue(
                latest.contractBushels
              ),

            voidedDeliveredBushels:
              numberValue(
                latest.deliveredBushels
              ),

            voidedOpenBushels:
              numberValue(
                latest.openBushels
              ),

            updatedAt:
              serverTimestamp()
          }
        );
      }
    );

    contract.voided = true;
    contract.voidReason = reason;

    closeEditModal();

    populateContractFilters();

    renderAll();
  }
  catch (error) {
    console.error(
      "[Grain Contracts] Contract void failed:",
      error
    );

    alert(
      error?.message ||
      "Unable to void this grain contract."
    );
  }
  finally {
    state.busy = false;

    updateContractVoidButton();
  }
}


/* ============================================================
   VOID TICKET
============================================================ */

async function voidActiveTicket() {
  const ticket =
    state.activeTicket;

  if (
    !ticket ||
    state.busy
  ) {
    return;
  }

  if (
    ticket.voided
  ) {
    alert(
      "This grain ticket is already voided."
    );

    return;
  }

  const reason =
    clean(
      window.prompt(
        `Why are you voiding Grain Ticket ${
          ticket.ticketNumber ||
          ticket.id
        }?`
      )
    );

  if (!reason) {
    return;
  }

  const currentAllocation =
    allocationSummary(
      ticket
    );

  const confirmed =
    window.confirm(
      `Void Grain Ticket ${
        ticket.ticketNumber ||
        ticket.id
      }?\n\nCurrent allocation:\n${
        currentAllocation
      }\n\nFarmVista will remove all contract allocations and reverse the proven storage posting.`
    );

  if (!confirmed) {
    return;
  }

  state.busy = true;

  updateTicketVoidButton();

  const affectedContractIds =
    getTicketAllocations(
      ticket
    ).map(
      allocation =>
        allocation.contractId
    );

  try {
    const result =
      await voidTicketWithStorageReversal(
        ticket,
        reason
      );

    ticket.voided = true;
    ticket.voidReason = reason;

    ticket.contractAllocations = [];
    ticket.spotBushels = 0;

    ticket.contractId = "";
    ticket.contractNumber = "";

    ticket.storageReversal =
      result.storageReversal;

    state.selectedTicketIds
      .delete(
        ticket.id
      );

    await syncContractTotalsForIds(
      affectedContractIds
    );

    closeTicketDetail();

    populateContractFilters();

    renderAll();

    if (
      result.storageReversal
        ?.type ===
      "none"
    ) {
      alert(
        "Ticket voided. No prior storage posting was found."
      );
    }
    else {
      alert(
        `Ticket voided and ${
          formatBushels(
            result
              .storageReversal
              ?.bushels
          )
        } bushels were restored to storage.`
      );
    }
  }
  catch (error) {
    console.error(
      "[Grain Contracts] Ticket void failed:",
      error
    );

    alert(
      error?.message ||
      "FarmVista could not safely void this ticket."
    );

    await refreshData();
  }
  finally {
    state.busy = false;

    updateTicketVoidButton();
  }
}


/* ============================================================
   STORAGE REVERSAL
============================================================ */

async function voidTicketWithStorageReversal(
  localTicket,
  reason
) {
  const runTransaction =
    await requireRunTransaction();

  const who =
    currentVoidUser();

  const ticketRef =
    doc(
      db,
      TICKET_COLLECTION,
      localTicket.id
    );

  const reversalRef =
    doc(
      db,
      VOID_REVERSAL_COLLECTION,
      `ticket_${localTicket.id}_void_reversal`
    );

  const binMovementRef =
    doc(
      db,
      "binMovements",
      `ticket_${localTicket.id}`
    );

  const bagPickupRef =
    doc(
      db,
      "grain_bag_events",
      `ticket_${localTicket.id}`
    );

  return runTransaction(
    db,
    async transaction => {
      const [
        ticketSnapshot,
        reversalSnapshot,
        binSnapshot,
        bagSnapshot
      ] =
        await Promise.all([
          transaction.get(
            ticketRef
          ),

          transaction.get(
            reversalRef
          ),

          transaction.get(
            binMovementRef
          ),

          transaction.get(
            bagPickupRef
          )
        ]);

      if (
        !ticketSnapshot.exists()
      ) {
        throw new Error(
          "The grain ticket no longer exists."
        );
      }

      const ticket =
        ticketSnapshot.data() ||
        {};

      if (
        ticket.voided
      ) {
        return {
          storageReversal:
            ticket.storageReversal ||
            (
              reversalSnapshot.exists()
                ? reversalSnapshot.data()
                : null
            )
        };
      }

      if (
        reversalSnapshot.exists()
      ) {
        throw new Error(
          "A storage reversal already exists for this ticket."
        );
      }

      const hasBinPosting =
        binSnapshot.exists() &&
        normalized(
          binSnapshot
            .data()
            ?.direction
        ) === "out" &&
        numberValue(
          binSnapshot
            .data()
            ?.bushels
        ) > 0;

      const hasBagPosting =
        bagSnapshot.exists() &&
        normalized(
          bagSnapshot
            .data()
            ?.type
        ) === "pickup" &&
        Boolean(
          bagSnapshot
            .data()
            ?.autoPostedFromTicket
        ) &&
        numberValue(
          bagSnapshot
            .data()
            ?.bushelsPicked
        ) > 0;

      if (
        hasBinPosting &&
        hasBagPosting
      ) {
        throw new Error(
          "Both bin and grain-bag postings were found. Void stopped to prevent double credit."
        );
      }

      let storageType =
        "none";

      let storageBushels =
        0;

      let storageFeet =
        0;

      let sourceId =
        "";

      let sourceLabel =
        "";

      let sourceRef =
        null;

      let sourcePatch =
        null;

      let postingRef =
        null;

      let postingPatch =
        null;


      if (
        hasBinPosting
      ) {
        const movement =
          binSnapshot.data() ||
          {};

        const siteId =
          clean(
            movement.siteId
          );

        const binIndex =
          Number(
            movement.binIndex
          );

        const restoreBushels =
          numberValue(
            movement.bushels
          );

        if (
          !siteId ||
          !Number.isInteger(
            binIndex
          ) ||
          binIndex < 0 ||
          !(restoreBushels > 0)
        ) {
          throw new Error(
            "Original bin movement is incomplete."
          );
        }

        sourceRef =
          doc(
            db,
            "binSites",
            siteId
          );

        const sourceSnapshot =
          await transaction.get(
            sourceRef
          );

        if (
          !sourceSnapshot.exists()
        ) {
          throw new Error(
            "Original bin site no longer exists."
          );
        }

        const site =
          sourceSnapshot.data() ||
          {};

        const bins =
          Array.isArray(
            site.bins
          )
            ? [
                ...site.bins
              ]
            : [];

        if (
          !bins[binIndex]
        ) {
          throw new Error(
            "Original bin can no longer be found."
          );
        }

        bins[binIndex] = {
          ...bins[binIndex],

          onHand:
            roundBushels(
              numberValue(
                bins[binIndex]
                  .onHand
              ) +
              restoreBushels
            ),

          lastUpdatedBy:
            who.name,

          lastUpdatedUid:
            who.uid,

          lastUpdatedMs:
            Date.now()
        };

        storageType =
          "bin";

        storageBushels =
          restoreBushels;

        sourceId =
          siteId;

        sourceLabel =
          clean(
            movement.siteName
          ) ||
          clean(
            site.name
          ) ||
          `Bin Site ${siteId}`;

        sourcePatch = {
          bins
        };

        postingRef =
          binMovementRef;

        postingPatch = {
          voidReversed:
            true,

          voidReversedAt:
            serverTimestamp(),

          voidReversalId:
            reversalRef.id,

          voidReversedByUid:
            who.uid,

          voidReversedByName:
            who.name,

          voidReversedByEmail:
            who.email
        };
      }

      else if (
        hasBagPosting
      ) {
        const pickup =
          bagSnapshot.data() ||
          {};

        const putDownId =
          bagSourceId(
            pickup
          );

        const restoreBushels =
          numberValue(
            pickup.bushelsPicked
          );

        const restoreFeet =
          numberValue(
            pickup.feetPicked
          );

        if (
          !putDownId ||
          !(restoreBushels > 0) ||
          !(restoreFeet > 0)
        ) {
          throw new Error(
            "Original grain-bag pickup is incomplete."
          );
        }

        sourceRef =
          doc(
            db,
            "grain_bag_events",
            putDownId
          );

        const sourceSnapshot =
          await transaction.get(
            sourceRef
          );

        if (
          !sourceSnapshot.exists()
        ) {
          throw new Error(
            "Original grain-bag source no longer exists."
          );
        }

        const source =
          sourceSnapshot.data() ||
          {};

        if (
          normalized(
            source.type
          ) !==
          "putdown"
        ) {
          throw new Error(
            "Original grain-bag source is not a putDown record."
          );
        }

        const length =
          bagLength(
            source
          );

        const restoredFeet =
          roundBushels(
            bagCurrentFeet(
              source,
              length
            ) +
            restoreFeet
          );

        const counts =
          bagCountsFromFeet(
            restoredFeet,
            length
          );

        storageType =
          "grain_bag";

        storageBushels =
          restoreBushels;

        storageFeet =
          restoreFeet;

        sourceId =
          putDownId;

        sourceLabel =
          clean(
            source?.field?.name
          ) ||
          `Grain Bag ${putDownId}`;

        sourcePatch = {
          "counts.full":
            counts.full,

          "counts.partial":
            counts.partial,

          "counts.partialFeet":
            counts.partialFeet,

          partialFeet:
            counts.partialFeet,

          status:
            null,

          pickedUpAt:
            null,

          pickedUpBy:
            null,

          updatedAt:
            serverTimestamp()
        };

        postingRef =
          bagPickupRef;

        postingPatch = {
          voidReversed:
            true,

          voidReversedAt:
            serverTimestamp(),

          voidReversalId:
            reversalRef.id,

          voidReversedByUid:
            who.uid,

          voidReversedByName:
            who.name,

          voidReversedByEmail:
            who.email,

          updatedAt:
            serverTimestamp()
        };
      }

      else if (
        ticket.inventoryPosted ===
        true
      ) {
        throw new Error(
          "Ticket says inventory was posted, but the original storage transaction cannot be proven. Void stopped to prevent an incorrect storage credit."
        );
      }


      if (
        sourceRef &&
        sourcePatch
      ) {
        transaction.set(
          sourceRef,
          sourcePatch,
          {
            merge: true
          }
        );
      }


      if (
        postingRef &&
        postingPatch
      ) {
        transaction.set(
          postingRef,
          postingPatch,
          {
            merge: true
          }
        );
      }


      const existingAllocations =
        Array.isArray(
          ticket.contractAllocations
        )
          ? ticket.contractAllocations
          : [];

      const legacyContractId =
        clean(
          ticket.contractId
        );

      const legacyContractNumber =
        clean(
          ticket.contractNumber
        );

      const originalAllocations =
        existingAllocations.length
          ? existingAllocations
          : (
              legacyContractId
                ? [
                    {
                      contractId:
                        legacyContractId,

                      contractNumber:
                        legacyContractNumber,

                      bushels:
                        numberValue(
                          ticket.netBushels
                        )
                    }
                  ]
                : []
            );


      const storageReversal = {
        type:
          storageType,

        bushels:
          storageBushels,

        feet:
          storageFeet ||
          null,

        sourceId:
          sourceId ||
          null,

        sourceLabel:
          sourceLabel ||
          null,

        originalPostingId:
          storageType ===
          "bin"
            ? binMovementRef.id
            : (
                storageType ===
                "grain_bag"
                  ? bagPickupRef.id
                  : null
              ),

        reversalId:
          reversalRef.id
      };


      transaction.set(
        reversalRef,
        {
          status:
            "complete",

          reversalType:
            storageType,

          ticketId:
            localTicket.id,

          ticketNumber:
            clean(
              ticket.ticketNumber
            ) ||
            null,

          originalContractAllocations:
            originalAllocations,

          originalSpotBushels:
            numberValue(
              ticket.spotBushels
            ),

          storageBushelsRestored:
            storageBushels,

          storageFeetRestored:
            storageFeet ||
            null,

          sourceId:
            sourceId ||
            null,

          sourceLabel:
            sourceLabel ||
            null,

          originalPostingId:
            storageReversal
              .originalPostingId,

          voidReason:
            reason,

          reversedByUid:
            who.uid,

          reversedByName:
            who.name,

          reversedByEmail:
            who.email,

          createdAt:
            serverTimestamp(),

          completedAt:
            serverTimestamp()
        }
      );


      transaction.update(
        ticketRef,
        {
          voided:
            true,

          voidedAt:
            serverTimestamp(),

          voidedByUid:
            who.uid,

          voidedByName:
            who.name,

          voidedByEmail:
            who.email,

          voidReason:
            reason,

          originalContractAllocations:
            originalAllocations,

          originalSpotBushels:
            numberValue(
              ticket.spotBushels
            ),

          originalContractId:
            legacyContractId ||
            null,

          originalContractNumber:
            legacyContractNumber ||
            null,

          contractId:
            null,

          contractNumber:
            null,

          contractAssignedAt:
            null,

          contractAllocations:
            [],

          spotBushels:
            0,

          unassignedBushels:
            0,

          allocationModelVersion:
            2,

          storageReversal,

          storageReversalId:
            reversalRef.id,

          inventoryReversedByVoid:
            storageType !==
            "none",

          storageReversedAt:
            serverTimestamp(),

          updatedAt:
            serverTimestamp()
        }
      );


      return {
        storageReversal
      };
    }
  );
}


/* ============================================================
   CONTRACT FILTERS
============================================================ */

function setupFilters() {
  [
    "search-filter",
    "status-filter",
    "crop-filter",
    "buyer-filter",
    "customer-filter"
  ].forEach(
    id => {
      const element =
        $(id);

      if (!element) {
        return;
      }

      element.addEventListener(
        id ===
        "search-filter"
          ? "input"
          : "change",
        applyContractFilters
      );
    }
  );
}


function populateAllPickers() {
  populateContractFilters();
  populateEditPickers();
  populateReconciliationPickers();
}


function populateContractFilters() {
  populateSimpleFilter(
    $("crop-filter"),
    uniqueSorted(
      state.contracts.map(
        contract =>
          contract.crop
      )
    )
  );

  populateSimpleFilter(
    $("buyer-filter"),
    uniqueSorted(
      state.contracts.map(
        contract =>
          contract.buyerName
      )
    )
  );

  populateSimpleFilter(
    $("customer-filter"),
    uniqueSorted(
      state.contracts.map(
        contract =>
          contract.customerName
      )
    )
  );
}


function applyContractFilters() {
  const search =
    normalized(
      $("search-filter")
        ?.value
    );

  const status =
    $("status-filter")
      ?.value ||
    "open";

  const crop =
    $("crop-filter")
      ?.value ||
    "";

  const buyer =
    $("buyer-filter")
      ?.value ||
    "";

  const customer =
    $("customer-filter")
      ?.value ||
    "";


  state.filteredContracts =
    state.contracts
      .filter(
        contract => {

          if (
            contract.voided &&
            !state.showVoided
          ) {
            return false;
          }


          if (
            search
          ) {
            const haystack =
              [
                contract.contractNumber,
                contract.buyerName,
                contract.customerName,
                contract.crop,
                contract.contractType,
                contract.deliveryLocationName,
                contract.deliveryCity,
                contract.deliveryState
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


          if (
            crop &&
            contract.crop !==
            crop
          ) {
            return false;
          }


          if (
            buyer &&
            contract.buyerName !==
            buyer
          ) {
            return false;
          }


          if (
            customer &&
            contract.customerName !==
            customer
          ) {
            return false;
          }


          const contractStatus =
            getContractStatus(
              contract
            );


          if (
            status ===
            "open"
          ) {
            return [
              "open",
              "near",
              "pending"
            ].includes(
              contractStatus
            );
          }


          if (
            status ===
            "all"
          ) {
            if (
              contractStatus ===
              "complete"
            ) {
              return false;
            }

            return true;
          }


          if (
            contractStatus !==
            status
          ) {
            return false;
          }


          return true;

        }
      )
      .sort(
        (
          a,
          b
        ) => {

          const aStatus =
            getContractStatus(
              a
            );

          const bStatus =
            getContractStatus(
              b
            );


          const statusOrder = {
            open: 0,
            near: 0,
            pending: 1,
            complete: 2,
            voided: 3
          };


          const orderCompare =
            (
              statusOrder[
                aStatus
              ] ?? 9
            ) -
            (
              statusOrder[
                bStatus
              ] ?? 9
            );


          if (
            orderCompare !==
            0
          ) {
            return orderCompare;
          }


          if (
            aStatus ===
              "pending" &&
            bStatus ===
              "pending"
          ) {

            const dateCompare =
              clean(
                a.deliveryStart
              ).localeCompare(
                clean(
                  b.deliveryStart
                )
              );


            if (
              dateCompare
            ) {
              return dateCompare;
            }

          }


          return compareContracts(
            a,
            b
          );

        }
      );


  renderContracts();
}


/* ============================================================
   MAIN RENDER
============================================================ */

function renderAll() {
  rebuildContractTotalsFromTickets();

  applyContractFilters();

  renderReconciliation();

  renderSettlementShell();
}


function renderContracts() {
  renderContractSummary();
  renderContractTable();
}


function renderContractSummary() {
  const activeContracts =
    state.filteredContracts
      .filter(
        contract =>
          !contract.voided
      );

  const totals =
    activeContracts.reduce(
      (
        result,
        contract
      ) => {
        result.contracted +=
          numberValue(
            contract.contractBushels
          );

        result.delivered +=
          numberValue(
            contract.deliveredBushels
          );

        result.open +=
          Math.max(
            0,
            numberValue(
              contract.openBushels
            )
          );

        return result;
      },
      {
        contracted: 0,
        delivered: 0,
        open: 0
      }
    );

  if (
    $("summary-contracts")
  ) {
    $("summary-contracts")
      .textContent =
        activeContracts.length
          .toLocaleString(
            "en-US"
          );
  }

  if (
    $("summary-contracted")
  ) {
    $("summary-contracted")
      .textContent =
        formatBushels(
          totals.contracted
        );
  }

  if (
    $("summary-delivered")
  ) {
    $("summary-delivered")
      .textContent =
        formatBushels(
          totals.delivered
        );
  }

  if (
    $("summary-open")
  ) {
    $("summary-open")
      .textContent =
        formatBushels(
          totals.open
        );
  }

  if (
    $("summary-over")
  ) {
    $("summary-over")
      .textContent =
        "0";
  }
}


function renderContractTable() {
  const tbody =
    $("contracts-table-body");

  if (!tbody) {
    return;
  }

  if (
    !state.filteredContracts
      .length
  ) {
    tbody.innerHTML = `
      <tr>
        <td colspan="12">
          <div class="empty-state">
            <div class="empty-title">
              No Contracts Found
            </div>

            <div class="empty-sub">
              No grain contracts match the selected filters.
            </div>
          </div>
        </td>
      </tr>
    `;

    return;
  }

  tbody.innerHTML = "";

  state.filteredContracts
    .forEach(
      contract => {
        const row =
          document.createElement(
            "tr"
          );

        row.className =
          contract.voided
            ? "contract-row voided-record"
            : "contract-row";

        row.tabIndex = 0;

        row.innerHTML = `
          <td>
            <span class="status-pill ${getStatusClass(contract)}">
              ${escapeHtml(getStatusLabel(contract))}
            </span>
          </td>

          <td class="contract-number">
            ${escapeHtml(contract.contractNumber || "—")}
          </td>

          <td>
            ${escapeHtml(contract.buyerName || "—")}
          </td>

          <td>
            ${escapeHtml(contract.customerName || "—")}
          </td>

          <td>
            ${escapeHtml(contract.crop || "—")}
          </td>

          <td>
            <span class="contract-type-pill ${
              ["Basis", "Futures"].includes(contract.contractType)
                ? "contract-type-needs-price"
                : "contract-type-complete"
            }">
              ${escapeHtml(contract.contractType || "—")}
            </span>
          </td>

          <td class="number-cell">
            ${formatBushels(contract.contractBushels)}
          </td>

          <td class="number-cell">
            ${formatBushels(contract.deliveredBushels)}
          </td>

          <td class="number-cell">
            ${formatBushels(contract.openBushels)}
          </td>

          <td class="center-cell">
            ${numberValue(contract.loadCount).toLocaleString("en-US")}
          </td>

          <td>
            ${escapeHtml(formatDeliveryWindow(contract))}
          </td>
        `;

        row.addEventListener(
          "click",
          () =>
            openEditModal(
              contract.id
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

              openEditModal(
                contract.id
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
   RECONCILIATION BUYER / CUSTOMER FILTERS

   Buyer and Customer both support an ALL filter.
   Drag & Drop opens with BOTH set to All.

   IMPORTANT:
   The filters only control what is visible.
   validateTicketAgainstContract() still enforces the
   actual Buyer + Customer + Crop match before assignment.
============================================================ */

function populateReconciliationSelect(
  select,
  items,
  allLabel,
  selected
) {
  if (!select) {
    return;
  }

  select.innerHTML = "";

  const allOption =
    document.createElement(
      "option"
    );

  allOption.value =
    RECONCILIATION_ALL;

  allOption.textContent =
    allLabel;

  select.appendChild(
    allOption
  );

  items.forEach(
    item => {
      const option =
        document.createElement(
          "option"
        );

      option.value =
        item.id;

      option.textContent =
        item.name;

      select.appendChild(
        option
      );
    }
  );

  if (
    !setSelectValue(
      select,
      selected
    )
  ) {
    select.value =
      RECONCILIATION_ALL;
  }
}


function getBuyersWithActiveContracts() {
  const openContracts =
    state.contracts.filter(
      contract =>
        !contract.voided &&
        numberValue(
          contract.openBushels
        ) >
        EPSILON
    );

  const buyerIds =
    new Set(
      openContracts
        .map(
          contract =>
            clean(
              contract.buyerId
            )
        )
        .filter(Boolean)
    );

  const buyerNames =
    new Set(
      openContracts
        .map(
          contract =>
            normalized(
              contract.buyerName
            )
        )
        .filter(Boolean)
    );

  return state.buyers
    .filter(
      buyer =>
        buyerIds.has(
          clean(
            buyer.id
          )
        ) ||
        buyerNames.has(
          normalized(
            buyer.name
          )
        )
    )
    .sort(
      (a, b) =>
        clean(
          a.name
        ).localeCompare(
          clean(
            b.name
          )
        )
    );
}


function getCustomersForBuyer(
  buyerId
) {
  const allBuyers =
    clean(buyerId) ===
    RECONCILIATION_ALL;

  const buyer =
    allBuyers
      ? null
      : state.buyers.find(
          item =>
            clean(item.id) ===
            clean(buyerId)
        );

  if (
    !allBuyers &&
    !buyer
  ) {
    return [];
  }

  const contracts =
    state.contracts.filter(
      contract => {
        if (
          contract.voided ||
          numberValue(
            contract.openBushels
          ) <=
          EPSILON
        ) {
          return false;
        }

        if (allBuyers) {
          return true;
        }

        return (
          (
            clean(
              contract.buyerId
            ) &&
            clean(
              contract.buyerId
            ) ===
            clean(
              buyer.id
            )
          ) ||
          (
            normalized(
              contract.buyerName
            ) &&
            normalized(
              contract.buyerName
            ) ===
            normalized(
              buyer.name
            )
          )
        );
      }
    );

  const customerIds =
    new Set(
      contracts
        .map(
          contract =>
            clean(
              contract.customerId
            )
        )
        .filter(Boolean)
    );

  const customerNames =
    new Set(
      contracts
        .map(
          contract =>
            normalized(
              contract.customerName
            )
        )
        .filter(Boolean)
    );

  return state.customers
    .filter(
      customer =>
        customerIds.has(
          clean(
            customer.id
          )
        ) ||
        customerNames.has(
          normalized(
            customer.name
          )
        )
    )
    .sort(
      (a, b) =>
        clean(
          a.name
        ).localeCompare(
          clean(
            b.name
          )
        )
    );
}


function populateReconciliationPickers() {
  const buyers =
    getBuyersWithActiveContracts();

  const buyerIsValid =
    state.reconcileBuyerId ===
      RECONCILIATION_ALL ||
    buyers.some(
      buyer =>
        clean(
          buyer.id
        ) ===
        clean(
          state.reconcileBuyerId
        )
    );

  if (!buyerIsValid) {
    state.reconcileBuyerId =
      RECONCILIATION_ALL;

    state.reconcileCustomerId =
      RECONCILIATION_ALL;
  }

  populateReconciliationSelect(
    $("reconcile-buyer"),
    buyers,
    "All Buyers",
    state.reconcileBuyerId
  );

  populateReconciliationCustomerPicker();
}


function populateReconciliationCustomerPicker() {
  const select =
    $("reconcile-customer");

  if (!select) {
    return;
  }

  const customers =
    getCustomersForBuyer(
      state.reconcileBuyerId
    );

  const customerIsValid =
    state.reconcileCustomerId ===
      RECONCILIATION_ALL ||
    customers.some(
      customer =>
        clean(
          customer.id
        ) ===
        clean(
          state.reconcileCustomerId
        )
    );

  if (!customerIsValid) {
    state.reconcileCustomerId =
      RECONCILIATION_ALL;
  }

  populateReconciliationSelect(
    select,
    customers,
    "All Customers",
    state.reconcileCustomerId
  );

  select.disabled =
    !customers.length;
}


function reconciliationReady() {
  return Boolean(
    state.reconcileBuyerId &&
    state.reconcileCustomerId
  );
}


function ticketMatchesCurrent(
  ticket
) {
  const allBuyers =
    state.reconcileBuyerId ===
    RECONCILIATION_ALL;

  const allCustomers =
    state.reconcileCustomerId ===
    RECONCILIATION_ALL;

  const buyer =
    allBuyers
      ? null
      : state.buyers.find(
          item =>
            clean(item.id) ===
            clean(
              state.reconcileBuyerId
            )
        );

  const customer =
    allCustomers
      ? null
      : state.customers.find(
          item =>
            clean(item.id) ===
            clean(
              state.reconcileCustomerId
            )
        );

  if (
    (!allBuyers && !buyer) ||
    (!allCustomers && !customer)
  ) {
    return false;
  }

  const buyerMatches =
    allBuyers ||
    (
      (
        clean(
          ticket.buyerId
        ) &&
        clean(
          ticket.buyerId
        ) ===
        clean(
          buyer.id
        )
      ) ||
      (
        normalized(
          ticket.buyerName
        ) &&
        normalized(
          ticket.buyerName
        ) ===
        normalized(
          buyer.name
        )
      )
    );

  const customerMatches =
    allCustomers ||
    (
      (
        clean(
          ticket.customerId
        ) &&
        clean(
          ticket.customerId
        ) ===
        clean(
          customer.id
        )
      ) ||
      (
        normalized(
          ticket.customerName
        ) &&
        normalized(
          ticket.customerName
        ) ===
        normalized(
          customer.name
        )
      )
    );

  return (
    buyerMatches &&
    customerMatches
  );
}


function getVisibleUnassignedTickets() {
  if (
    !reconciliationReady()
  ) {
    return [];
  }

  return state.tickets
    .filter(
      ticket => {
        if (
          ticket.voided &&
          !state.showVoided
        ) {
          return false;
        }

        if (
          !ticketMatchesCurrent(
            ticket
          )
        ) {
          return false;
        }

        if (
          ticket.voided
        ) {
          return true;
        }

        return (
          getUnassignedBushels(
            ticket
          ) >
          EPSILON
        );
      }
    )
    .sort(
      compareTickets
    );
}


function getAvailableContracts() {
  if (
    !reconciliationReady()
  ) {
    return [];
  }

  const allBuyers =
    state.reconcileBuyerId ===
    RECONCILIATION_ALL;

  const allCustomers =
    state.reconcileCustomerId ===
    RECONCILIATION_ALL;

  const buyer =
    allBuyers
      ? null
      : state.buyers.find(
          item =>
            clean(item.id) ===
            clean(
              state.reconcileBuyerId
            )
        );

  const customer =
    allCustomers
      ? null
      : state.customers.find(
          item =>
            clean(item.id) ===
            clean(
              state.reconcileCustomerId
            )
        );

  if (
    (!allBuyers && !buyer) ||
    (!allCustomers && !customer)
  ) {
    return [];
  }

  return state.contracts
    .filter(
      contract => {
        const status =
          getContractStatus(
            contract
          );

        if (
          status !== "open" &&
          status !== "near"
        ) {
          return false;
        }

        const buyerMatches =
          allBuyers ||
          (
            (
              clean(
                contract.buyerId
              ) &&
              clean(
                contract.buyerId
              ) ===
              clean(
                buyer.id
              )
            ) ||
            (
              normalized(
                contract.buyerName
              ) ===
              normalized(
                buyer.name
              )
            )
          );

        const customerMatches =
          allCustomers ||
          (
            (
              clean(
                contract.customerId
              ) &&
              clean(
                contract.customerId
              ) ===
              clean(
                customer.id
              )
            ) ||
            (
              normalized(
                contract.customerName
              ) ===
              normalized(
                customer.name
              )
            )
          );

        return (
          buyerMatches &&
          customerMatches
        );
      }
    )
    .sort(
      compareContracts
    );
}


/* ============================================================
   RECONCILIATION CONTROLS
============================================================ */

function setupReconciliationControls() {
  $("reconcile-buyer")
    ?.addEventListener(
      "change",
      function () {
        state.reconcileBuyerId =
          clean(
            this.value
          ) ||
          RECONCILIATION_ALL;

        state.reconcileCustomerId =
          RECONCILIATION_ALL;

        state.selectedTicketIds
          .clear();

        populateReconciliationCustomerPicker();

        renderReconciliation();
      }
    );


  $("reconcile-customer")
    ?.addEventListener(
      "change",
      function () {
        state.reconcileCustomerId =
          clean(
            this.value
          ) ||
          RECONCILIATION_ALL;

        state.selectedTicketIds
          .clear();

        renderReconciliation();
      }
    );


  $("select-all-tickets-btn")
    ?.addEventListener(
      "click",
      () => {
        state.selectedTicketIds
          .clear();

        getVisibleUnassignedTickets()
          .filter(
            ticket =>
              !ticket.voided
          )
          .forEach(
            ticket =>
              state.selectedTicketIds
                .add(
                  ticket.id
                )
          );

        renderReconciliation();
      }
    );


  $("clear-ticket-selection-btn")
    ?.addEventListener(
      "click",
      () => {
        state.selectedTicketIds
          .clear();

        renderReconciliation();
      }
    );


  $("refresh-reconciliation-btn")
    ?.addEventListener(
      "click",
      refreshData
    );


  const unassigned =
    $("unassigned-ticket-list");

  if (!unassigned) {
    return;
  }


  unassigned.addEventListener(
    "dragover",
    event => {
      if (
        state.busy ||
        ![
          "contract",
          "spot"
        ].includes(
          state.draggingSourceType
        )
      ) {
        return;
      }

      const ticket =
        state.tickets.find(
          item =>
            item.id ===
            state.draggingTicketId
        );

      if (
        !ticket ||
        ticket.voided ||
        !ticketMatchesCurrent(
          ticket
        )
      ) {
        return;
      }

      event.preventDefault();

      unassigned.classList.add(
        "drag-over-unassign"
      );
    }
  );


  unassigned.addEventListener(
    "dragleave",
    event => {
      if (
        event.relatedTarget &&
        unassigned.contains(
          event.relatedTarget
        )
      ) {
        return;
      }

      unassigned.classList.remove(
        "drag-over-unassign"
      );
    }
  );


  unassigned.addEventListener(
    "drop",
    event => {
      event.preventDefault();

      unassigned.classList.remove(
        "drag-over-unassign"
      );

      const payload =
        parseDragPayload(
          event
        );

      if (
        payload.type ===
        "contract"
      ) {
        unassignTicketFromContract(
          payload.ticketId,
          payload.sourceId
        );
      }
      else if (
        payload.type ===
        "spot"
      ) {
        unassignSpotBushels(
          payload.ticketId
        );
      }
    }
  );
}


/* ============================================================
   DRAG HELPERS
============================================================ */

function dragStart(
  ticketId,
  type,
  sourceId = ""
) {
  state.draggingTicketId =
    clean(
      ticketId
    );

  state.draggingSourceType =
    type;

  state.draggingSourceId =
    clean(
      sourceId
    );
}


function dragClear() {
  state.draggingTicketId = "";
  state.draggingSourceType = "";
  state.draggingSourceId = "";
}


function dragPayload(
  ticketId,
  type,
  sourceId = ""
) {
  return JSON.stringify({
    ticketId,
    type,
    sourceId
  });
}


function parseDragPayload(
  event
) {
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

    return {
      ticketId:
        clean(
          parsed.ticketId
        ),

      type:
        clean(
          parsed.type
        ),

      sourceId:
        clean(
          parsed.sourceId
        )
    };
  }
  catch {
    return {
      ticketId:
        clean(
          raw ||
          state.draggingTicketId
        ),

      type:
        state.draggingSourceType,

      sourceId:
        state.draggingSourceId
    };
  }
}


/* ============================================================
   RECONCILIATION RENDER
============================================================ */

function renderReconciliation() {
  const ready =
    reconciliationReady();

  const message =
    $("reconcile-filter-message");


  if (message) {
    message.innerHTML = `
      <span
        style="
          display:inline-flex;
          align-items:center;
          gap:7px;
          white-space:nowrap;
        "
        title="Choose a Buyer and Customer, then drag available ticket bushels to a matching crop contract or to Spot. FarmVista automatically stops at the contract limit."
      >
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
          style="flex:0 0 auto;"
        >
          <circle
            cx="12"
            cy="12"
            r="9"
            stroke="currentColor"
            stroke-width="2"
          />
          <path
            d="M12 10.75V17"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          />
          <circle
            cx="12"
            cy="7.25"
            r="1.15"
            fill="currentColor"
          />
        </svg>

        <span>
          Drag tickets to a matching contract or Spot
        </span>
      </span>
    `;

    message.classList.toggle(
      "ready",
      ready
    );
  }


  if (
    $("select-all-tickets-btn")
  ) {
    $("select-all-tickets-btn")
      .disabled =
        !ready ||
        state.busy;
  }


  if (
    $("clear-ticket-selection-btn")
  ) {
    $("clear-ticket-selection-btn")
      .disabled =
        !ready ||
        !state.selectedTicketIds
          .size ||
        state.busy;
  }


  if (
    $("refresh-reconciliation-btn")
  ) {
    $("refresh-reconciliation-btn")
      .disabled =
        !ready ||
        state.busy;
  }


  if (!ready) {
    if (
      $("selection-count")
    ) {
      $("selection-count")
        .textContent =
          "0 selected";
    }

    if (
      $("unassigned-count")
    ) {
      $("unassigned-count")
        .textContent =
          "0 tickets";
    }

    if (
      $("available-contract-count")
    ) {
      $("available-contract-count")
        .textContent =
          "0 contracts";
    }

    if (
      $("unassigned-ticket-list")
    ) {
      $("unassigned-ticket-list")
        .innerHTML = `
          <div class="empty-state">
            <div class="empty-title">
              Select Buyer and Customer
            </div>
          </div>
        `;
    }

    if (
      $("available-contract-list")
    ) {
      $("available-contract-list")
        .innerHTML = `
          <div class="empty-state">
            <div class="empty-title">
              Select Buyer and Customer
            </div>
          </div>
        `;
    }

    return;
  }


  const tickets =
    getVisibleUnassignedTickets();

  const contracts =
    getAvailableContracts();


  [
    ...state.selectedTicketIds
  ].forEach(
    ticketId => {
      if (
        !tickets.some(
          ticket =>
            ticket.id ===
            ticketId &&
            !ticket.voided
        )
      ) {
        state.selectedTicketIds
          .delete(
            ticketId
          );
      }
    }
  );


  if (
    $("selection-count")
  ) {
    $("selection-count")
      .textContent =
        `${
          state.selectedTicketIds
            .size
        } selected`;
  }


  if (
    $("unassigned-count")
  ) {
    $("unassigned-count")
      .textContent =
        `${
          tickets.length
        } ${
          tickets.length === 1
            ? "ticket"
            : "tickets"
        }`;
  }


  if (
    $("available-contract-count")
  ) {
    $("available-contract-count")
      .textContent =
        `${
          contracts.length
        } ${
          contracts.length === 1
            ? "contract"
            : "contracts"
        }`;
  }


  renderTicketCards(
    tickets
  );

  renderContractDropCards(
    contracts,
    tickets
  );
}


/* ============================================================
   UNASSIGNED TICKET CARDS
============================================================ */

function renderTicketCards(
  tickets
) {
  const container =
    $("unassigned-ticket-list");

  if (!container) {
    return;
  }

  container.classList.remove(
    "drag-over-unassign"
  );

  container.innerHTML = "";


  if (!tickets.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-title">
          No Unassigned Bushels
        </div>

        <div class="empty-sub">
          Everything matching these filters is allocated.
        </div>
      </div>
    `;

    return;
  }


  tickets.forEach(
    ticket => {
      const remaining =
        ticket.voided
          ? 0
          : getUnassignedBushels(
              ticket
            );

      const partial =
        !ticket.voided &&
        remaining <
          numberValue(
            ticket.netBushels
          ) -
          EPSILON;

      const card =
        document.createElement(
          "div"
        );

      card.className =
        ticket.voided
          ? "ticket-card voided-record"
          : "ticket-card";

      card.draggable =
        !state.busy &&
        !ticket.voided &&
        remaining >
        EPSILON;


      card.innerHTML = `
        <input
          class="ticket-select"
          type="checkbox"
          ${
            state.selectedTicketIds
              .has(ticket.id)
              ? "checked"
              : ""
          }
          ${
            ticket.voided
              ? "disabled"
              : ""
          }
        />

        <div class="ticket-content">

          <div class="ticket-top">

            <div>

              <div class="ticket-number">
                Ticket ${escapeHtml(ticket.ticketNumber || "—")}
                ${
                  partial
                    ? `
                      <span style="color:#9a6700;font-weight:900;">
                        • PARTIAL
                      </span>
                    `
                    : ""
                }
              </div>

              <div
                style="
                  margin-top:4px;
                  font-size:.9rem;
                  font-weight:700;
                  line-height:1.35;
                "
              >
                ${escapeHtml(ticket.buyerName || "Unknown Buyer")}
                <span style="opacity:.55;"> • </span>
                ${escapeHtml(ticket.customerName || "Unknown Customer")}
              </div>

            </div>

            <div class="ticket-bushels">
              ${formatBushels(remaining)} bu available
            </div>

          </div>


          <div class="ticket-meta">

            <span>
              ${
                escapeHtml(
                  ticket.ticketDate
                    ? formatDate(
                        ticket.ticketDate
                      )
                    : "No date"
                )
              }
            </span>

            <span>
              ${escapeHtml(ticket.crop || "No crop")}
            </span>

            <span>
              Total ${formatBushels(ticket.netBushels)} bu
            </span>

            ${
              getContractAllocatedBushels(
                ticket
              ) >
              EPSILON
                ? `
                  <span>
                    ${formatBushels(getContractAllocatedBushels(ticket))} bu contracted
                  </span>
                `
                : ""
            }

            ${
              getSpotBushels(
                ticket
              ) >
              EPSILON
                ? `
                  <span>
                    ${formatBushels(getSpotBushels(ticket))} bu Spot
                  </span>
                `
                : ""
            }

          </div>

        </div>
      `;


      const checkbox =
        card.querySelector(
          ".ticket-select"
        );

      checkbox
        ?.addEventListener(
          "change",
          function () {
            if (
              this.checked
            ) {
              state.selectedTicketIds
                .add(
                  ticket.id
                );
            }
            else {
              state.selectedTicketIds
                .delete(
                  ticket.id
                );
            }

            renderReconciliation();
          }
        );


      card.addEventListener(
        "dragstart",
        event => {
          dragStart(
            ticket.id,
            "unassigned"
          );

          card.classList.add(
            "dragging"
          );

          event.dataTransfer
            .effectAllowed =
              "move";

          event.dataTransfer
            .setData(
              "text/plain",
              dragPayload(
                ticket.id,
                "unassigned"
              )
            );
        }
      );


      card.addEventListener(
        "dragend",
        () => {
          dragClear();

          card.classList.remove(
            "dragging"
          );
        }
      );


      card.addEventListener(
        "click",
        event => {
          if (
            !event.target.closest(
              ".ticket-select"
            )
          ) {
            openTicketDetail(
              ticket.id
            );
          }
        }
      );


      container.appendChild(
        card
      );
    }
  );
}


/* ============================================================
   ASSIGNED TICKETS
============================================================ */

function assignedTicketMarkup(
  contract
) {
  const tickets =
    getAssignedTickets(
      contract.id
    );

  if (!tickets.length) {
    return `
      <div class="assigned-ticket-section">
        <div class="assigned-ticket-empty">
          No grain-ticket bushels assigned yet.
        </div>
      </div>
    `;
  }


  return `
    <div class="assigned-ticket-section">

      <div class="assigned-ticket-head">

        <div class="assigned-ticket-title">
          Assigned Tickets
        </div>

        <div class="assigned-ticket-count">
          ${tickets.length} tickets
        </div>

      </div>

      <div class="assigned-ticket-list">

        ${
          tickets.map(
            ticket => `
              <button
                type="button"
                class="assigned-ticket-item"
                data-ticket="${escapeHtml(ticket.id)}"
                data-contract="${escapeHtml(contract.id)}"
                draggable="${state.busy ? "false" : "true"}"
              >

                <div class="assigned-ticket-top">

                  <div class="assigned-ticket-number">
                    Ticket ${escapeHtml(ticket.ticketNumber || ticket.id)}
                  </div>

                  <div class="assigned-ticket-bu">
                    ${formatBushels(getAllocationBushels(ticket, contract.id))} bu
                  </div>

                </div>

                <div class="assigned-ticket-meta">

                  <span>
                    Total ticket ${formatBushels(ticket.netBushels)} bu
                  </span>

                  ${
                    getUnassignedBushels(
                      ticket
                    ) >
                    EPSILON
                      ? `
                        <span>
                          ${formatBushels(getUnassignedBushels(ticket))} bu still unassigned
                        </span>
                      `
                      : ""
                  }

                </div>

              </button>
            `
          ).join("")
        }

      </div>

    </div>
  `;
}


/* ============================================================
   CONTRACT GRADE AVERAGES
============================================================ */

function calculateContractGradeAverages(
  contract
) {
  const tickets =
    getAssignedTickets(
      contract.id
    );

  function average(
    getter
  ) {
    let weighted = 0;
    let weight = 0;

    tickets.forEach(
      ticket => {
        const value =
          Number(
            getter(ticket)
          );

        const bushels =
          getAllocationBushels(
            ticket,
            contract.id
          );

        if (
          Number.isFinite(
            value
          ) &&
          bushels >
          EPSILON
        ) {
          weighted +=
            value *
            bushels;

          weight +=
            bushels;
        }
      }
    );

    return (
      weight >
      EPSILON
    )
      ? weighted /
        weight
      : null;
  }


  return {
    moisture:
      average(
        ticket =>
          ticket.moisture ??
          ticket.mo
      ),

    damage:
      average(
        ticket =>
          ticket.damage ??
          ticket.dm
      ),

    fm:
      average(
        ticket =>
          ticket.foreignMaterial ??
          ticket.fm
      )
  };
}


/* ============================================================
   CONTRACT DROP CARDS
============================================================ */

function renderContractDropCards(
  contracts,
  visibleTickets
) {
  const container =
    $("available-contract-list");

  if (!container) {
    return;
  }

  container.innerHTML = "";


  contracts.forEach(
    contract => {
      Object.assign(
        contract,
        calculateContractTotals(
          contract
        )
      );

      const full =
        contract.openBushels <=
        EPSILON;

      const averages =
        calculateContractGradeAverages(
          contract
        );

      /*
        IMPORTANT WITH "ALL" FILTERS:

        Do not match only by crop here.
        A visible ticket must actually pass Buyer,
        Customer AND Crop validation for this contract.
      */
      const matchingTickets =
        visibleTickets.filter(
          ticket =>
            !ticket.voided &&
            getUnassignedBushels(
              ticket
            ) >
            EPSILON &&
            !validateTicketAgainstContract(
              ticket,
              contract
            )
        );

      const selectedTickets =
        matchingTickets.filter(
          ticket =>
            state.selectedTicketIds
              .has(
                ticket.id
              )
        );


      const card =
        document.createElement(
          "div"
        );

      card.className =
        "contract-drop-card";

      if (full) {
        card.style.opacity =
          ".82";
      }


      card.innerHTML = `
        <div class="contract-drop-head">

          <div>

            <div class="contract-drop-title">
              Contract ${escapeHtml(contract.contractNumber || contract.id)}
            </div>

            <div class="contract-drop-meta">
              ${escapeHtml(contract.crop || "—")}
              •
              ${escapeHtml(contract.contractType || "—")}
              •
              ${escapeHtml(contract.deliveryLocationName || "No location")}
            </div>

          </div>

          <span class="status-pill ${getStatusClass(contract)}">
            ${getStatusLabel(contract)}
          </span>

        </div>


        <div class="contract-stats">

          <div class="contract-stat">
            <div class="contract-stat-label">
              Contract
            </div>

            <div class="contract-stat-value">
              ${formatBushels(contract.contractBushels)}
            </div>
          </div>


          <div class="contract-stat">
            <div class="contract-stat-label">
              Assigned
            </div>

            <div class="contract-stat-value">
              ${formatBushels(contract.deliveredBushels)}
            </div>
          </div>


          <div class="contract-stat">
            <div class="contract-stat-label">
              Remaining
            </div>

            <div class="contract-stat-value">
              ${formatBushels(contract.openBushels)}
            </div>
          </div>


          <div class="contract-stat">
            <div class="contract-stat-label">
              Loads
            </div>

            <div class="contract-stat-value">
              ${contract.loadCount}
            </div>
          </div>

        </div>


        <div class="contract-average-block">

          <div class="contract-average-title">
            Average
          </div>

          <div class="contract-average-grid">

            <div class="contract-average-item">
              <div class="contract-average-label">
                Moisture
              </div>

              <div class="contract-average-value">
                ${
                  averages.moisture ===
                  null
                    ? "—"
                    : `${averages.moisture.toFixed(2)}%`
                }
              </div>
            </div>


            <div class="contract-average-item">
              <div class="contract-average-label">
                Damage
              </div>

              <div class="contract-average-value">
                ${
                  averages.damage ===
                  null
                    ? "—"
                    : `${averages.damage.toFixed(2)}%`
                }
              </div>
            </div>


            <div class="contract-average-item">
              <div class="contract-average-label">
                FM
              </div>

              <div class="contract-average-value">
                ${
                  averages.fm ===
                  null
                    ? "—"
                    : `${averages.fm.toFixed(2)}%`
                }
              </div>
            </div>

          </div>

        </div>


        ${assignedTicketMarkup(contract)}


        <div class="contract-actions">

          <button
            type="button"
            class="btn btn-primary btn-small assign-selected-btn"
            ${
              selectedTickets.length &&
              !full &&
              !state.busy
                ? ""
                : "disabled"
            }
          >
            Assign Selected (${selectedTickets.length})
          </button>


          <button
            type="button"
            class="btn btn-secondary btn-small assign-all-btn"
            ${
              matchingTickets.length &&
              !full &&
              !state.busy
                ? ""
                : "disabled"
            }
          >
            Assign All ${escapeHtml(contract.crop || "")} (${matchingTickets.length})
          </button>

        </div>


        <div class="contract-drop-helper">
          ${
            full
              ? "Contract is full — no more bushels can be assigned"
              : "Drop ticket bushels here — FarmVista stops exactly at the contract limit"
          }
        </div>
      `;


      card
        .querySelectorAll(
          "[data-ticket]"
        )
        .forEach(
          button => {
            button.addEventListener(
              "click",
              event => {
                event.stopPropagation();

                openTicketDetail(
                  button.dataset
                    .ticket
                );
              }
            );


            button.addEventListener(
              "dragstart",
              event => {
                dragStart(
                  button.dataset
                    .ticket,
                  "contract",
                  button.dataset
                    .contract
                );

                event.dataTransfer
                  .effectAllowed =
                    "move";

                event.dataTransfer
                  .setData(
                    "text/plain",
                    dragPayload(
                      button.dataset
                        .ticket,
                      "contract",
                      button.dataset
                        .contract
                    )
                  );
              }
            );


            button.addEventListener(
              "dragend",
              dragClear
            );
          }
        );


      card
        .querySelector(
          ".assign-selected-btn"
        )
        ?.addEventListener(
          "click",
          event => {
            event.stopPropagation();

            assignTicketsToContract(
              selectedTickets.map(
                ticket =>
                  ticket.id
              ),
              contract.id
            );
          }
        );


      card
        .querySelector(
          ".assign-all-btn"
        )
        ?.addEventListener(
          "click",
          event => {
            event.stopPropagation();

            assignTicketsToContract(
              matchingTickets.map(
                ticket =>
                  ticket.id
              ),
              contract.id
            );
          }
        );


      card.addEventListener(
        "dragover",
        event => {
          if (
            state.busy ||
            full ||
            !state.draggingTicketId
          ) {
            return;
          }

          const ticket =
            state.tickets.find(
              item =>
                item.id ===
                state.draggingTicketId
            );

          if (!ticket) {
            return;
          }

          const validation =
            validateTicketAgainstContract(
              ticket,
              contract
            );

          if (validation) {
            return;
          }

          if (
            state.draggingSourceType ===
            "contract" &&
            state.draggingSourceId ===
            contract.id
          ) {
            return;
          }

          event.preventDefault();

          card.classList.add(
            "drag-over"
          );
        }
      );


      card.addEventListener(
        "dragleave",
        event => {
          if (
            event.relatedTarget &&
            card.contains(
              event.relatedTarget
            )
          ) {
            return;
          }

          card.classList.remove(
            "drag-over"
          );
        }
      );


      card.addEventListener(
        "drop",
        event => {
          event.preventDefault();

          card.classList.remove(
            "drag-over"
          );

          const payload =
            parseDragPayload(
              event
            );

          moveTicketToContract(
            payload.ticketId,
            contract.id,
            payload.type,
            payload.sourceId
          );
        }
      );


      container.appendChild(
        card
      );
    }
  );


  renderSpotCard(
    container
  );
}


/* ============================================================
   SPOT BUSHEL CARD
============================================================ */

function renderSpotCard(
  container
) {
  const tickets =
    state.tickets
      .filter(
        ticket =>
          !ticket.voided &&
          ticketMatchesCurrent(
            ticket
          ) &&
          getSpotBushels(
            ticket
          ) >
          EPSILON
      )
      .sort(
        compareTickets
      );

  const total =
    roundBushels(
      tickets.reduce(
        (
          result,
          ticket
        ) =>
          result +
          getSpotBushels(
            ticket
          ),
        0
      )
    );


  const card =
    document.createElement(
      "div"
    );

  card.className =
    "contract-drop-card spot-drop-card";

  card.style.borderColor =
    "rgba(154,103,0,.6)";


  card.innerHTML = `
    <div class="contract-drop-head">

      <div>

        <div class="contract-drop-title">
          Spot Bushels
        </div>

        <div class="contract-drop-meta">
          Bushels sold Spot instead of applied to a contract
        </div>

      </div>

      <span class="status-pill status-near">
        SPOT
      </span>

    </div>


    <div
      class="contract-stats"
      style="grid-template-columns:repeat(2,minmax(0,1fr));"
    >

      <div class="contract-stat">

        <div class="contract-stat-label">
          Spot Bushels
        </div>

        <div class="contract-stat-value">
          ${formatBushels(total)}
        </div>

      </div>


      <div class="contract-stat">

        <div class="contract-stat-label">
          Tickets
        </div>

        <div class="contract-stat-value">
          ${tickets.length}
        </div>

      </div>

    </div>


    <div class="assigned-ticket-section">

      <div class="assigned-ticket-list">

        ${
          tickets.length
            ? tickets.map(
                ticket => `
                  <button
                    type="button"
                    class="assigned-ticket-item"
                    data-spot-ticket="${escapeHtml(ticket.id)}"
                    draggable="${state.busy ? "false" : "true"}"
                  >

                    <div class="assigned-ticket-top">

                      <div class="assigned-ticket-number">
                        Ticket ${escapeHtml(ticket.ticketNumber || ticket.id)}
                      </div>

                      <div class="assigned-ticket-bu">
                        ${formatBushels(getSpotBushels(ticket))} bu
                      </div>

                    </div>

                  </button>
                `
              ).join("")
            : `
                <div class="assigned-ticket-empty">
                  Drop ticket bushels here to record them as Spot.
                </div>
              `
        }

      </div>

    </div>


    <div class="contract-drop-helper">
      Drop ticket bushels here to record as Spot
    </div>
  `;


  card
    .querySelectorAll(
      "[data-spot-ticket]"
    )
    .forEach(
      button => {
        button.addEventListener(
          "click",
          event => {
            event.stopPropagation();

            openTicketDetail(
              button.dataset
                .spotTicket
            );
          }
        );


        button.addEventListener(
          "dragstart",
          event => {
            dragStart(
              button.dataset
                .spotTicket,
              "spot"
            );

            event.dataTransfer
              .effectAllowed =
                "move";

            event.dataTransfer
              .setData(
                "text/plain",
                dragPayload(
                  button.dataset
                    .spotTicket,
                  "spot"
                )
              );
          }
        );


        button.addEventListener(
          "dragend",
          dragClear
        );
      }
    );


  card.addEventListener(
    "dragover",
    event => {
      if (
        state.busy ||
        !state.draggingTicketId ||
        state.draggingSourceType ===
        "spot"
      ) {
        return;
      }

      event.preventDefault();

      card.classList.add(
        "drag-over"
      );
    }
  );


  card.addEventListener(
    "dragleave",
    () => {
      card.classList.remove(
        "drag-over"
      );
    }
  );


  card.addEventListener(
    "drop",
    event => {
      event.preventDefault();

      card.classList.remove(
        "drag-over"
      );

      const payload =
        parseDragPayload(
          event
        );

      moveTicketBushelsToSpot(
        payload.ticketId,
        payload.type,
        payload.sourceId
      );
    }
  );


  container.appendChild(
    card
  );
}


/* ============================================================
   VALIDATION
============================================================ */

function validateTicketAgainstContract(
  ticket,
  contract
) {
  if (
    !ticket ||
    !contract
  ) {
    return "Ticket or contract not found.";
  }

  if (
    ticket.voided
  ) {
    return "Voided tickets cannot be assigned.";
  }

  if (
    contract.voided
  ) {
    return "Voided contracts cannot receive tickets.";
  }

  const buyerMatches =
    (
      clean(
        ticket.buyerId
      ) &&
      clean(
        contract.buyerId
      ) &&
      clean(
        ticket.buyerId
      ) ===
      clean(
        contract.buyerId
      )
    ) ||
    (
      normalized(
        ticket.buyerName
      ) &&
      normalized(
        ticket.buyerName
      ) ===
      normalized(
        contract.buyerName
      )
    );

  if (
    !buyerMatches
  ) {
    return "This ticket does not match the Buyer on that contract.";
  }

  const customerMatches =
    (
      clean(
        ticket.customerId
      ) &&
      clean(
        contract.customerId
      ) &&
      clean(
        ticket.customerId
      ) ===
      clean(
        contract.customerId
      )
    ) ||
    (
      normalized(
        ticket.customerName
      ) &&
      normalized(
        ticket.customerName
      ) ===
      normalized(
        contract.customerName
      )
    );

  if (
    !customerMatches
  ) {
    return "This ticket does not match the Customer on that contract.";
  }

  if (
    normalized(
      ticket.crop
    ) !==
    normalized(
      contract.crop
    )
  ) {
    return `Ticket ${
      ticket.ticketNumber ||
      ticket.id
    } is ${
      ticket.crop ||
      "a different crop"
    } and cannot be assigned to a ${
      contract.crop ||
      "different crop"
    } contract.`;
  }

  return "";
}


/* ============================================================
   MOVE TICKET BUSHELS TO CONTRACT
============================================================ */

async function moveTicketToContract(
  ticketId,
  targetContractId,
  sourceType = "unassigned",
  sourceId = ""
) {
  if (
    state.busy
  ) {
    return;
  }

  const ticket =
    state.tickets.find(
      item =>
        item.id ===
        ticketId
    );

  const contract =
    state.contracts.find(
      item =>
        item.id ===
        targetContractId
    );

  const validation =
    validateTicketAgainstContract(
      ticket,
      contract
    );

  if (validation) {
    alert(
      validation
    );

    return;
  }


  Object.assign(
    contract,
    calculateContractTotals(
      contract
    )
  );


  const capacity =
    roundBushels(
      Math.max(
        0,
        numberValue(
          contract.contractBushels
        ) -
        numberValue(
          contract.deliveredBushels
        )
      )
    );


  if (
    capacity <=
    EPSILON
  ) {
    alert(
      "That contract is full."
    );

    return;
  }


  let available = 0;


  if (
    sourceType ===
    "contract"
  ) {
    available =
      getAllocationBushels(
        ticket,
        sourceId
      );
  }
  else if (
    sourceType ===
    "spot"
  ) {
    available =
      getSpotBushels(
        ticket
      );
  }
  else {
    available =
      getUnassignedBushels(
        ticket
      );
  }


  if (
    available <=
    EPSILON
  ) {
    return;
  }


  const moving =
    roundBushels(
      Math.min(
        available,
        capacity
      )
    );


  if (
    moving +
    EPSILON <
    available
  ) {
    const confirmed =
      window.confirm(
        `Contract ${
          contract.contractNumber ||
          contract.id
        } only has ${
          formatBushels(
            capacity
          )
        } bu remaining.\n\nFarmVista will assign exactly ${
          formatBushels(
            moving
          )
        } bu to this contract and leave ${
          formatBushels(
            available -
            moving
          )
        } bu in its current location.\n\nContinue?`
      );

    if (!confirmed) {
      return;
    }
  }


  const allocations =
    getTicketAllocations(
      ticket
    ).map(
      allocation => ({
        ...allocation
      })
    );

  let spot =
    getSpotBushels(
      ticket
    );

  const affected =
    new Set([
      targetContractId
    ]);


  if (
    sourceType ===
    "contract"
  ) {
    const sourceIndex =
      allocations.findIndex(
        allocation =>
          allocation.contractId ===
          sourceId
      );

    if (
      sourceIndex <
      0
    ) {
      return;
    }

    allocations[
      sourceIndex
    ].bushels =
      roundBushels(
        allocations[
          sourceIndex
        ].bushels -
        moving
      );

    if (
      allocations[
        sourceIndex
      ].bushels <=
      EPSILON
    ) {
      allocations.splice(
        sourceIndex,
        1
      );
    }

    affected.add(
      sourceId
    );
  }

  else if (
    sourceType ===
    "spot"
  ) {
    spot =
      roundBushels(
        spot -
        moving
      );
  }


  const targetIndex =
    allocations.findIndex(
      allocation =>
        allocation.contractId ===
        targetContractId
    );


  if (
    targetIndex >= 0
  ) {
    allocations[
      targetIndex
    ].bushels =
      roundBushels(
        allocations[
          targetIndex
        ].bushels +
        moving
      );
  }
  else {
    allocations.push({
      contractId:
        contract.id,

      contractNumber:
        contract.contractNumber ||
        "",

      bushels:
        moving
    });
  }


  state.busy = true;

  renderReconciliation();


  try {
    await persistTicketAllocations(
      ticket,
      allocations,
      spot
    );

    await syncContractTotalsForIds(
      [
        ...affected
      ]
    );

    populateContractFilters();
  }
  catch (error) {
    console.error(
      "[Grain Contracts] Allocation move failed:",
      error
    );

    alert(
      error?.message ||
      "Allocation move failed."
    );

    await refreshData();
  }
  finally {
    state.busy = false;

    dragClear();

    renderAll();
  }
}


/* ============================================================
   UNASSIGN CONTRACT PORTION
============================================================ */

async function unassignTicketFromContract(
  ticketId,
  sourceContractId
) {
  if (
    state.busy
  ) {
    return;
  }

  const ticket =
    state.tickets.find(
      item =>
        item.id ===
        ticketId
    );

  if (!ticket) {
    return;
  }

  const allocations =
    getTicketAllocations(
      ticket
    ).map(
      allocation => ({
        ...allocation
      })
    );

  const index =
    allocations.findIndex(
      allocation =>
        allocation.contractId ===
        sourceContractId
    );

  if (
    index <
    0
  ) {
    return;
  }

  const amount =
    allocations[index]
      .bushels;

  const confirmed =
    window.confirm(
      `Release ${
        formatBushels(
          amount
        )
      } bu from Contract ${
        allocations[index]
          .contractNumber ||
        sourceContractId
      } back to Unassigned?`
    );

  if (!confirmed) {
    return;
  }

  allocations.splice(
    index,
    1
  );

  state.busy = true;

  try {
    await persistTicketAllocations(
      ticket,
      allocations,
      getSpotBushels(
        ticket
      )
    );

    await syncContractTotalsForIds(
      [
        sourceContractId
      ]
    );
  }
  catch (error) {
    console.error(
      "[Grain Contracts] Unassign failed:",
      error
    );

    alert(
      error?.message ||
      "Unable to unassign those bushels."
    );

    await refreshData();
  }
  finally {
    state.busy = false;

    dragClear();

    renderAll();
  }
}


/* ============================================================
   UNASSIGN SPOT
============================================================ */

async function unassignSpotBushels(
  ticketId
) {
  if (
    state.busy
  ) {
    return;
  }

  const ticket =
    state.tickets.find(
      item =>
        item.id ===
        ticketId
    );

  if (!ticket) {
    return;
  }

  const amount =
    getSpotBushels(
      ticket
    );

  if (
    amount <=
    EPSILON
  ) {
    return;
  }

  const confirmed =
    window.confirm(
      `Release ${
        formatBushels(
          amount
        )
      } Spot bu back to Unassigned?`
    );

  if (!confirmed) {
    return;
  }

  state.busy = true;

  try {
    await persistTicketAllocations(
      ticket,
      getTicketAllocations(
        ticket
      ),
      0
    );
  }
  catch (error) {
    console.error(
      "[Grain Contracts] Spot unassign failed:",
      error
    );

    alert(
      error?.message ||
      "Unable to release Spot bushels."
    );

    await refreshData();
  }
  finally {
    state.busy = false;

    dragClear();

    renderAll();
  }
}


/* ============================================================
   MOVE BUSHELS TO SPOT
============================================================ */

async function moveTicketBushelsToSpot(
  ticketId,
  sourceType = "unassigned",
  sourceId = ""
) {
  if (
    state.busy
  ) {
    return;
  }

  const ticket =
    state.tickets.find(
      item =>
        item.id ===
        ticketId
    );

  if (
    !ticket ||
    ticket.voided
  ) {
    return;
  }

  const allocations =
    getTicketAllocations(
      ticket
    ).map(
      allocation => ({
        ...allocation
      })
    );

  let amount = 0;


  if (
    sourceType ===
    "contract"
  ) {
    const index =
      allocations.findIndex(
        allocation =>
          allocation.contractId ===
          sourceId
      );

    if (
      index <
      0
    ) {
      return;
    }

    amount =
      allocations[index]
        .bushels;

    allocations.splice(
      index,
      1
    );
  }
  else {
    amount =
      getUnassignedBushels(
        ticket
      );
  }


  if (
    amount <=
    EPSILON
  ) {
    return;
  }


  const confirmed =
    window.confirm(
      `Record ${
        formatBushels(
          amount
        )
      } bu from Ticket ${
        ticket.ticketNumber ||
        ticket.id
      } as Spot bushels?`
    );

  if (!confirmed) {
    return;
  }


  state.busy = true;


  try {
    await persistTicketAllocations(
      ticket,
      allocations,
      roundBushels(
        getSpotBushels(
          ticket
        ) +
        amount
      )
    );

    if (
      sourceType ===
      "contract"
    ) {
      await syncContractTotalsForIds(
        [
          sourceId
        ]
      );
    }
  }
  catch (error) {
    console.error(
      "[Grain Contracts] Spot assignment failed:",
      error
    );

    alert(
      error?.message ||
      "Unable to assign Spot bushels."
    );

    await refreshData();
  }
  finally {
    state.busy = false;

    dragClear();

    renderAll();
  }
}


/* ============================================================
   ASSIGN SELECTED / ASSIGN ALL
============================================================ */

async function assignTicketsToContract(
  ticketIds,
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

  if (!contract) {
    return;
  }


  Object.assign(
    contract,
    calculateContractTotals(
      contract
    )
  );


  let capacity =
    roundBushels(
      Math.max(
        0,
        numberValue(
          contract.contractBushels
        ) -
        numberValue(
          contract.deliveredBushels
        )
      )
    );


  if (
    capacity <=
    EPSILON
  ) {
    alert(
      "That contract is full."
    );

    return;
  }


  const tickets =
    ticketIds
      .map(
        ticketId =>
          state.tickets.find(
            ticket =>
              ticket.id ===
              ticketId
          )
      )
      .filter(
        ticket =>
          ticket &&
          !ticket.voided &&
          getUnassignedBushels(
            ticket
          ) >
          EPSILON
      )
      .sort(
        compareTickets
      );


  const invalid =
    tickets.find(
      ticket =>
        validateTicketAgainstContract(
          ticket,
          contract
        )
    );


  if (invalid) {
    alert(
      validateTicketAgainstContract(
        invalid,
        contract
      )
    );

    return;
  }


  const plans = [];


  for (
    const ticket
    of tickets
  ) {
    if (
      capacity <=
      EPSILON
    ) {
      break;
    }

    const available =
      getUnassignedBushels(
        ticket
      );

    const amount =
      roundBushels(
        Math.min(
          available,
          capacity
        )
      );

    plans.push({
      ticket,
      available,
      amount
    });

    capacity =
      roundBushels(
        capacity -
        amount
      );
  }


  if (
    !plans.length
  ) {
    return;
  }


  const splitPlan =
    plans.find(
      plan =>
        plan.amount +
        EPSILON <
        plan.available
    );


  if (
    splitPlan
  ) {
    const remaining =
      roundBushels(
        splitPlan.available -
        splitPlan.amount
      );

    const confirmed =
      window.confirm(
        `Contract ${
          contract.contractNumber ||
          contract.id
        } will fill exactly at ${
          formatBushels(
            contract.contractBushels
          )
        } bu.\n\nTicket ${
          splitPlan.ticket
            .ticketNumber ||
          splitPlan.ticket.id
        } will be split:\n\n${
          formatBushels(
            splitPlan.amount
          )
        } bu → Contract ${
          contract.contractNumber ||
          contract.id
        }\n${
          formatBushels(
            remaining
          )
        } bu → Unassigned\n\nThe remaining bushels can then be dragged to another contract or Spot.\n\nContinue?`
      );

    if (!confirmed) {
      return;
    }
  }


  state.busy = true;

  renderReconciliation();


  try {
    for (
      const plan
      of plans
    ) {
      const allocations =
        getTicketAllocations(
          plan.ticket
        ).map(
          allocation => ({
            ...allocation
          })
        );

      const existingIndex =
        allocations.findIndex(
          allocation =>
            allocation.contractId ===
            contract.id
        );


      if (
        existingIndex >=
        0
      ) {
        allocations[
          existingIndex
        ].bushels =
          roundBushels(
            allocations[
              existingIndex
            ].bushels +
            plan.amount
          );
      }
      else {
        allocations.push({
          contractId:
            contract.id,

          contractNumber:
            contract.contractNumber ||
            "",

          bushels:
            plan.amount
        });
      }


      await persistTicketAllocations(
        plan.ticket,
        allocations,
        getSpotBushels(
          plan.ticket
        )
      );
    }


    state.selectedTicketIds
      .clear();


    await syncContractTotalsForIds(
      [
        contract.id
      ]
    );


    populateContractFilters();
  }
  catch (error) {
    console.error(
      "[Grain Contracts] Ticket assignment failed:",
      error
    );

    alert(
      error?.message ||
      "Ticket assignment failed."
    );

    await refreshData();
  }
  finally {
    state.busy = false;

    renderAll();
  }
}


/* ============================================================
   TICKET DETAIL MODAL
============================================================ */

function setupTicketDetailModal() {
  $("close-ticket-detail-btn")
    ?.addEventListener(
      "click",
      closeTicketDetail
    );

  $("close-ticket-detail-bottom-btn")
    ?.addEventListener(
      "click",
      closeTicketDetail
    );

  $("ticket-detail-modal")
    ?.addEventListener(
      "click",
      event => {
        if (
          event.target ===
          $("ticket-detail-modal")
        ) {
          closeTicketDetail();
        }
      }
    );

  $("open-full-ticket-btn")
    ?.addEventListener(
      "click",
      () => {
        if (
          state.activeTicket
        ) {
          location.href =
            `/pages/grain/grain-ticket-detail.html?id=${
              encodeURIComponent(
                state.activeTicket.id
              )
            }`;
        }
      }
    );

  document.addEventListener(
    "keydown",
    event => {
      if (
        event.key ===
        "Escape" &&
        $("ticket-detail-modal")
          ?.classList
          .contains(
            "open"
          )
      ) {
        closeTicketDetail();
      }
    }
  );
}


function openTicketDetail(
  ticketId
) {
  const ticket =
    state.tickets.find(
      item =>
        item.id ===
        ticketId
    );

  if (!ticket) {
    return;
  }

  state.activeTicket =
    ticket;


  $("ticket-detail-title")
    .textContent =
      `Grain Ticket ${
        ticket.ticketNumber ||
        ticket.id
      }`;


  $("ticket-detail-sub")
    .textContent =
      ticket.voided
        ? `VOIDED${
            ticket.voidReason
              ? ` — ${ticket.voidReason}`
              : ""
          }`
        : allocationSummary(
            ticket
          );


  $("detail-ticket-number")
    .textContent =
      ticket.ticketNumber ||
      "—";


  $("detail-ticket-date")
    .textContent =
      ticket.ticketDate
        ? formatDate(
            ticket.ticketDate
          )
        : "—";


  $("detail-ticket-buyer")
    .textContent =
      clean(
        ticket.buyerName ||
        ticket.ocrElevatorName
      ) ||
      "—";


  $("detail-ticket-location")
    .textContent =
      clean(
        ticket.deliveryLocationName
      ) ||
      "—";


  $("detail-ticket-customer")
    .textContent =
      clean(
        ticket.customerName
      ) ||
      "—";


  $("detail-ticket-crop")
    .textContent =
      clean(
        ticket.crop
      ) ||
      "—";


  $("detail-ticket-driver")
    .textContent =
      clean(
        ticket.driverName ||
        ticket.driverEmail
      ) ||
      "—";


  $("detail-ticket-contract")
    .textContent =
      ticket.voided
        ? (
            clean(
              ticket.originalContractNumber
            ) ||
            "—"
          )
        : allocationSummary(
            ticket
          );


  $("detail-ticket-gross")
    .textContent =
      formatWholeNumber(
        ticket.grossWeight
      );


  $("detail-ticket-tare")
    .textContent =
      formatWholeNumber(
        ticket.tareWeight
      );


  $("detail-ticket-net-weight")
    .textContent =
      formatWholeNumber(
        ticket.netWeight
      );


  $("detail-ticket-gross-bu")
    .textContent =
      ticket.grossBushels !==
      undefined
        ? `${
            formatBushels(
              ticket.grossBushels
            )
          } bu`
        : "—";


  $("detail-ticket-shrink-bu")
    .textContent =
      ticket.shrinkBushels !==
      undefined
        ? `${
            formatBushels(
              ticket.shrinkBushels
            )
          } bu`
        : "—";


  $("detail-ticket-net-bu")
    .textContent =
      `${
        formatBushels(
          ticket.netBushels
        )
      } bu`;


  $("detail-ticket-tw")
    .textContent =
      formatGrade(
        ticket.testWeight ??
        ticket.tw
      );


  $("detail-ticket-mo")
    .textContent =
      formatGrade(
        ticket.moisture ??
        ticket.mo,
        "%"
      );


  $("detail-ticket-dm")
    .textContent =
      formatGrade(
        ticket.damage ??
        ticket.dm,
        "%"
      );


  $("detail-ticket-fm")
    .textContent =
      formatGrade(
        ticket.foreignMaterial ??
        ticket.fm,
        "%"
      );


  updateTicketVoidButton();


  $("ticket-detail-modal")
    .classList
    .add(
      "open"
    );


  document.body.style
    .overflow =
      "hidden";
}


function closeTicketDetail() {
  $("ticket-detail-modal")
    ?.classList
    .remove(
      "open"
    );

  state.activeTicket =
    null;

  if (
    !$("edit-modal")
      ?.classList
      .contains(
        "open"
      )
  ) {
    document.body.style
      .overflow =
        "";
  }
}


/* ============================================================
   REFRESH
============================================================ */

async function refreshData() {
  if (
    state.busy
  ) {
    return;
  }

  state.busy = true;

  try {
    await loadAllData();

    await migrateLegacyAssignments();

    rebuildContractTotalsFromTickets();

    await syncContractTotalsForIds(
      state.contracts.map(
        contract =>
          contract.id
      )
    );

    populateAllPickers();
  }
  catch (error) {
    console.error(
      "[Grain Contracts] Refresh failed:",
      error
    );

    alert(
      "Unable to refresh grain contracts."
    );
  }
  finally {
    state.busy = false;

    renderAll();
  }
}


/* ============================================================
   SETTLEMENT SHELL
============================================================ */

function renderSettlementShell() {
  const tbody =
    $("settlement-table-body");

  if (!tbody) {
    return;
  }

  const candidates =
    state.contracts
      .filter(
        contract =>
          !contract.voided &&
          getContractStatus(
            contract
          ) ===
          "complete"
      )
      .sort(
        compareContracts
      );


  if (!candidates.length) {
    tbody.innerHTML = `
      <tr>

        <td colspan="8">

          <div class="empty-state">

            <div class="empty-title">
              No Completed Contracts Yet
            </div>

            <div class="empty-sub">
              Completed contracts will appear here when settlement-sheet imports are wired.
            </div>

          </div>

        </td>

      </tr>
    `;

    return;
  }


  tbody.innerHTML =
    candidates
      .map(
        contract => `
          <tr>

            <td class="contract-number">
              ${escapeHtml(contract.contractNumber || "—")}
            </td>

            <td>
              ${escapeHtml(contract.buyerName || "—")}
            </td>

            <td>
              ${escapeHtml(contract.customerName || "—")}
            </td>

            <td>
              ${escapeHtml(contract.crop || "—")}
            </td>

            <td class="number-cell">
              ${formatBushels(contract.deliveredBushels)}
            </td>

            <td class="number-cell">
              —
            </td>

            <td class="number-cell">
              —
            </td>

            <td>
              Pending Settlement
            </td>

          </tr>
        `
      )
      .join("");
}


/* ============================================================
   EDIT CONTRACT MODAL
============================================================ */

function populateEditPickers() {
  populateObjectSelect(
    $("edit-buyer"),
    state.buyers,
    "Select Buyer / Elevator"
  );

  populateObjectSelect(
    $("edit-customer"),
    state.customers,
    "Select Customer"
  );
}


function setupModal() {
  $("close-modal-btn")
    ?.addEventListener(
      "click",
      closeEditModal
    );

  $("cancel-edit-btn")
    ?.addEventListener(
      "click",
      closeEditModal
    );

  $("edit-modal")
    ?.addEventListener(
      "click",
      event => {
        if (
          event.target ===
          $("edit-modal")
        ) {
          closeEditModal();
        }
      }
    );


  $("edit-buyer")
    ?.addEventListener(
      "change",
      function () {
        populateLocationPicker(
          this.value
        );
      }
    );


  $("edit-contract-form")
    ?.addEventListener(
      "submit",
      saveContractChanges
    );
}


function rebuildEditStaticSelect(
  id,
  options,
  savedValue
) {
  const select =
    $(id);

  if (!select) {
    return;
  }

  select.innerHTML = "";

  options.forEach(
    (
      [
        value,
        label
      ]
    ) => {
      const option =
        document.createElement(
          "option"
        );

      option.value =
        value;

      option.textContent =
        label;

      select.appendChild(
        option
      );
    }
  );

  setSelectValue(
    select,
    savedValue
  );
}


function openEditModal(
  contractId
) {
  const contract =
    state.contracts.find(
      item =>
        item.id ===
        contractId
    );

  if (!contract) {
    return;
  }


  state.activeContract =
    contract;


  Object.assign(
    contract,
    calculateContractTotals(
      contract
    )
  );


  $("edit-contract-form")
    ?.reset();


  populateEditPickers();


  $("edit-modal-sub")
    .textContent =
      `Contract ${
        contract.contractNumber ||
        contract.id
      }${
        contract.voided
          ? " — VOIDED"
          : ""
      }`;


  setSelectValue(
    $("edit-buyer"),
    contract.buyerId
  );


  setSelectValue(
    $("edit-customer"),
    contract.customerId
  );


  rebuildEditStaticSelect(
    "edit-crop",
    [
      [
        "",
        "Select crop"
      ],
      [
        "Corn",
        "Corn"
      ],
      [
        "Soybeans",
        "Soybeans"
      ]
    ],
    contract.crop
  );


  rebuildEditStaticSelect(
    "edit-contract-type",
    [
      [
        "",
        "Select type"
      ],
      [
        "Cash",
        "Cash"
      ],
      [
        "Basis",
        "Basis"
      ],
      [
        "Futures",
        "Futures"
      ],
      [
        "Program",
        "Program"
      ]
    ],
    contract.contractType
  );


  $("edit-contract-number")
    .value =
      contract.contractNumber;


  $("edit-contract-date")
    .value =
      contract.contractDate;


  setEditBushels(
    contract.contractBushels
  );


  setEditPricing(
    contract
  );


  populateLocationPicker(
    contract.buyerId,
    contract.deliveryLocationId
  );


  $("edit-delivery-start")
    .value =
      contract.deliveryStart;


  $("edit-delivery-end")
    .value =
      contract.deliveryEnd;


  $("edit-delivered")
    .value =
      formatBushels(
        contract.deliveredBushels
      );


  $("edit-notes")
    .value =
      contract.notes;


  updateEditDateLimits();

  updateEditOpenBushels();

  updateContractVoidButton();


  const saveButton =
    $("save-edit-btn");

  if (saveButton) {
    saveButton.disabled =
      Boolean(
        contract.voided
      );

    saveButton.textContent =
      contract.voided
        ? "Contract Voided"
        : "Save Changes";
  }


  $("edit-modal")
    .classList
    .add(
      "open"
    );


  document.body.style
    .overflow =
      "hidden";
}


function closeEditModal() {
  $("edit-modal")
    ?.classList
    .remove(
      "open"
    );

  state.activeContract =
    null;

  if (
    !$("ticket-detail-modal")
      ?.classList
      .contains(
        "open"
      )
  ) {
    document.body.style
      .overflow =
        "";
  }
}


/* ============================================================
   DELIVERY LOCATION PICKER
============================================================ */

function formatLocationOption(
  location
) {
  const cityState =
    [
      location.city,
      location.state
    ]
      .filter(Boolean)
      .join(", ");

  const address =
    [
      location.street,
      cityState,
      location.zip
    ]
      .filter(Boolean)
      .join(" • ");

  return address
    ? `${
        location.locationName
      } — ${
        address
      }`
    : location.locationName;
}


function populateLocationPicker(
  buyerId,
  selected = ""
) {
  const select =
    $("edit-delivery-location");

  if (!select) {
    return;
  }

  select.innerHTML = "";

  const blank =
    document.createElement(
      "option"
    );

  blank.value = "";

  blank.textContent =
    buyerId
      ? "Select Delivery Location"
      : "Select Buyer / Elevator first";

  select.appendChild(
    blank
  );


  if (!buyerId) {
    select.disabled = true;
    return;
  }


  select.disabled = false;


  state.deliveryLocations
    .filter(
      location =>
        clean(
          location.buyerId
        ) ===
        clean(
          buyerId
        )
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
          formatLocationOption(
            location
          );

        select.appendChild(
          option
        );
      }
    );


  setSelectValue(
    select,
    selected
  );
}


/* ============================================================
   EDIT BUSHELS
============================================================ */

function setupEditBushels() {
  const input =
    $("edit-contract-bushels");

  if (!input) {
    return;
  }

  input.addEventListener(
    "input",
    () => {
      const digits =
        String(
          input.value ||
          ""
        ).replace(
          /\D/g,
          ""
        );

      if (!digits) {
        input.value = "";
        input.dataset.rawValue = "";

        updateEditOpenBushels();

        return;
      }

      const value =
        Number(
          digits
        );

      input.dataset.rawValue =
        String(
          value
        );

      input.value =
        value.toLocaleString(
          "en-US"
        );

      updateEditOpenBushels();
    }
  );
}


function setEditBushels(
  value
) {
  const input =
    $("edit-contract-bushels");

  if (!input) {
    return;
  }

  const number =
    numberValue(
      value
    );

  input.dataset.rawValue =
    String(
      number
    );

  input.value =
    number.toLocaleString(
      "en-US"
    );
}


function updateEditOpenBushels() {
  if (
    !state.activeContract
  ) {
    return;
  }

  const contracted =
    numberValue(
      $("edit-contract-bushels")
        ?.dataset
        .rawValue
    );

  const delivered =
    numberValue(
      state.activeContract
        .deliveredBushels
    );

  const open =
    contracted -
    delivered;


  if (
    $("edit-open")
  ) {
    $("edit-open")
      .value =
        formatBushels(
          open
        );
  }


  if (
    $("modal-contracted")
  ) {
    $("modal-contracted")
      .textContent =
        formatBushels(
          contracted
        );
  }


  if (
    $("modal-delivered")
  ) {
    $("modal-delivered")
      .textContent =
        formatBushels(
          delivered
        );
  }


  if (
    $("modal-open")
  ) {
    $("modal-open")
      .textContent =
        formatBushels(
          open
        );
  }
}


/* ============================================================
   EDIT CONTRACT PRICING
============================================================ */

function setupEditPrice() {
  const typeInput =
    $("edit-contract-type");

  const futuresInput =
    $("edit-futures-price");

  const basisInput =
    $("edit-basis-price");

  const cashInput =
    $("edit-price");


  if (
    !typeInput ||
    !futuresInput ||
    !basisInput ||
    !cashInput
  ) {
    return;
  }


  typeInput.addEventListener(
    "change",
    function () {
      updateEditPriceFields();
      calculateEditCashPrice();
      validateEditPrice();
    }
  );


  futuresInput.addEventListener(
    "input",
    function () {
      state.editFuturesPrice =
        parseEditDollarPrice(
          this.value
        );

      this.setCustomValidity("");

      calculateEditCashPrice();
    }
  );


  futuresInput.addEventListener(
    "blur",
    function () {
      if (
        state.editFuturesPrice !==
        null
      ) {
        this.value =
          formatEditDollarPrice(
            state.editFuturesPrice
          );
      }

      validateEditPrice();
    }
  );


  basisInput.addEventListener(
    "input",
    function () {
      state.editBasisPrice =
        parseEditBasisPrice(
          this.value
        );

      this.setCustomValidity("");

      calculateEditCashPrice();
    }
  );


  basisInput.addEventListener(
    "blur",
    function () {
      if (
        state.editBasisPrice !==
        null
      ) {
        this.value =
          formatEditBasisPrice(
            state.editBasisPrice
          );
      }

      validateEditPrice();
    }
  );


  cashInput.addEventListener(
    "input",
    function () {
      if (
        $("edit-contract-type")
          ?.value !==
        "Program"
      ) {
        return;
      }

      state.editCashPrice =
        parseEditDollarPrice(
          this.value
        );

      this.setCustomValidity("");
    }
  );


  cashInput.addEventListener(
    "blur",
    function () {
      if (
        state.editCashPrice !==
        null
      ) {
        this.value =
          formatEditDollarPrice(
            state.editCashPrice
          );
      }

      validateEditPrice();
    }
  );
}


function nullablePrice(
  value
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number =
    Number(value);

  return Number.isFinite(number)
    ? roundEditPrice(number)
    : null;
}


function setEditPricing(
  contract
) {
  state.editFuturesPrice =
    nullablePrice(
      contract?.futuresPrice
    );

  state.editBasisPrice =
    nullablePrice(
      contract?.basisPrice
    );

  state.editCashPrice =
    nullablePrice(
      contract?.pricePerBushel
    );


  const futuresInput =
    $("edit-futures-price");

  const basisInput =
    $("edit-basis-price");

  const cashInput =
    $("edit-price");


  if (futuresInput) {
    futuresInput.value =
      state.editFuturesPrice ===
      null
        ? ""
        : formatEditDollarPrice(
            state.editFuturesPrice
          );
  }


  if (basisInput) {
    basisInput.value =
      state.editBasisPrice ===
      null
        ? ""
        : formatEditBasisPrice(
            state.editBasisPrice
          );
  }


  if (cashInput) {
    cashInput.value =
      state.editCashPrice ===
      null
        ? ""
        : formatEditDollarPrice(
            state.editCashPrice
          );
  }


  updateEditPriceFields();

  calculateEditCashPrice();
}


function updateEditPriceFields() {
  const type =
    $("edit-contract-type")
      ?.value || "";

  const futuresInput =
    $("edit-futures-price");

  const basisInput =
    $("edit-basis-price");

  const cashInput =
    $("edit-price");


  if (
    !futuresInput ||
    !basisInput ||
    !cashInput
  ) {
    return;
  }


  futuresInput.disabled =
    true;

  basisInput.disabled =
    true;

  cashInput.disabled =
    true;


  futuresInput.required =
    false;

  basisInput.required =
    false;

  cashInput.required =
    false;


  cashInput.placeholder =
    "Not set";


  if (
    type === "Cash"
  ) {
    futuresInput.disabled =
      false;

    basisInput.disabled =
      false;

    futuresInput.required =
      true;

    basisInput.required =
      true;

    cashInput.placeholder =
      "Calculated automatically";
  }


  else if (
    type === "Basis"
  ) {
    basisInput.disabled =
      false;

    basisInput.required =
      true;

    cashInput.placeholder =
      "Not set until contract becomes Cash";
  }


  else if (
    type === "Futures"
  ) {
    futuresInput.disabled =
      false;

    futuresInput.required =
      true;

    cashInput.placeholder =
      "Not set until contract becomes Cash";
  }


  else if (
    type === "Program"
  ) {
    cashInput.disabled =
      false;

    cashInput.required =
      true;

    cashInput.placeholder =
      "$0.00";
  }


  else {
    cashInput.placeholder =
      "Select contract type";
  }
}


function calculateEditCashPrice() {
  const type =
    $("edit-contract-type")
      ?.value || "";

  const cashInput =
    $("edit-price");


  if (!cashInput) {
    return;
  }


  if (
    type === "Cash"
  ) {
    if (
      state.editFuturesPrice ===
        null ||
      state.editBasisPrice ===
        null
    ) {
      state.editCashPrice =
        null;

      cashInput.value =
        "";

      return;
    }


    state.editCashPrice =
      roundEditPrice(
        state.editFuturesPrice +
        state.editBasisPrice
      );


    cashInput.value =
      formatEditDollarPrice(
        state.editCashPrice
      );

    return;
  }


  if (
    type === "Basis" ||
    type === "Futures"
  ) {
    state.editCashPrice =
      null;

    cashInput.value =
      "";
  }
}


function parseEditDollarPrice(
  value
) {
  const cleaned =
    String(value || "")
      .trim()
      .replace(/\$/g, "")
      .replace(/,/g, "");


  if (!cleaned) {
    return null;
  }


  const number =
    Number(cleaned);


  if (!Number.isFinite(number)) {
    return null;
  }


  return roundEditPrice(number);
}


function parseEditBasisPrice(
  value
) {
  const cleaned =
    String(value || "")
      .trim()
      .replace(/\$/g, "")
      .replace(/,/g, "")
      .replace(/\s/g, "");


  if (!cleaned) {
    return null;
  }


  if (
    !/^[+-]?\d*(?:\.\d*)?$/.test(
      cleaned
    )
  ) {
    return null;
  }


  const number =
    Number(cleaned);


  if (!Number.isFinite(number)) {
    return null;
  }


  return roundEditPrice(number);
}


function roundEditPrice(
  value
) {
  return (
    Math.round(
      Number(value) *
      10000
    ) /
    10000
  );
}


function formatEditDollarPrice(
  value
) {
  if (
    value === null ||
    !Number.isFinite(
      Number(value)
    )
  ) {
    return "";
  }


  return Number(value)
    .toLocaleString(
      "en-US",
      {
        style:
          "currency",

        currency:
          "USD",

        minimumFractionDigits:
          2,

        maximumFractionDigits:
          4
      }
    );
}


function formatEditBasisPrice(
  value
) {
  if (
    value === null ||
    !Number.isFinite(
      Number(value)
    )
  ) {
    return "";
  }


  const number =
    Number(value);


  const absolute =
    Math.abs(number)
      .toLocaleString(
        "en-US",
        {
          minimumFractionDigits:
            2,

          maximumFractionDigits:
            4
        }
      );


  if (number > 0) {
    return `+$${absolute}`;
  }


  if (number < 0) {
    return `-$${absolute}`;
  }


  return "$0.00";
}


function validateEditPrice() {
  const type =
    $("edit-contract-type")
      ?.value || "";

  const futuresInput =
    $("edit-futures-price");

  const basisInput =
    $("edit-basis-price");

  const cashInput =
    $("edit-price");


  if (
    !futuresInput ||
    !basisInput ||
    !cashInput
  ) {
    return false;
  }


  futuresInput.setCustomValidity("");

  basisInput.setCustomValidity("");

  cashInput.setCustomValidity("");


  if (
    type === "Cash"
  ) {
    if (
      state.editFuturesPrice ===
      null
    ) {
      futuresInput.setCustomValidity(
        "Enter the Futures Price."
      );

      return false;
    }


    if (
      state.editBasisPrice ===
      null
    ) {
      basisInput.setCustomValidity(
        "Enter the Basis."
      );

      return false;
    }


    if (
      state.editCashPrice ===
      null
    ) {
      cashInput.setCustomValidity(
        "Unable to calculate Cash Price."
      );

      return false;
    }
  }


  else if (
    type === "Basis"
  ) {
    if (
      state.editBasisPrice ===
      null
    ) {
      basisInput.setCustomValidity(
        "Enter the Basis."
      );

      return false;
    }
  }


  else if (
    type === "Futures"
  ) {
    if (
      state.editFuturesPrice ===
      null
    ) {
      futuresInput.setCustomValidity(
        "Enter the Futures Price."
      );

      return false;
    }
  }


  else if (
    type === "Program"
  ) {
    if (
      state.editCashPrice ===
      null
    ) {
      cashInput.setCustomValidity(
        "Enter the Cash Price."
      );

      return false;
    }
  }


  if (
    state.editCashPrice !==
      null &&
    (
      state.editCashPrice < 2 ||
      state.editCashPrice > 30
    )
  ) {
    cashInput.setCustomValidity(
      "Cash Price must be between $2.00 and $30.00."
    );

    return false;
  }


  return true;
}


/* ============================================================
   EDIT DATES
============================================================ */

function setupEditDates() {
  $("edit-contract-date")
    ?.addEventListener(
      "change",
      () => {
        updateEditDateLimits();
        validateEditDates();
      }
    );


  $("edit-delivery-start")
    ?.addEventListener(
      "change",
      () => {
        updateEditDateLimits();
        validateEditDates();
      }
    );


  $("edit-delivery-end")
    ?.addEventListener(
      "change",
      validateEditDates
    );
}


function updateEditDateLimits() {
  const contractDate =
    $("edit-contract-date");

  const start =
    $("edit-delivery-start");

  const end =
    $("edit-delivery-end");

  if (
    !contractDate ||
    !start ||
    !end
  ) {
    return;
  }


  if (
    contractDate.value
  ) {
    start.min =
      contractDate.value;
  }
  else {
    start.removeAttribute(
      "min"
    );
  }


  if (
    start.value
  ) {
    end.min =
      addDays(
        start.value,
        1
      );
  }
  else {
    end.removeAttribute(
      "min"
    );
  }
}


function validateEditDates() {
  const contractDate =
    $("edit-contract-date");

  const start =
    $("edit-delivery-start");

  const end =
    $("edit-delivery-end");

  if (
    !contractDate ||
    !start ||
    !end
  ) {
    return false;
  }

  start.setCustomValidity(
    ""
  );

  end.setCustomValidity(
    ""
  );


  if (
    contractDate.value &&
    start.value &&
    start.value <
    contractDate.value
  ) {
    start.setCustomValidity(
      "Delivery Start cannot be before Contract Date."
    );

    return false;
  }


  if (
    start.value &&
    end.value &&
    end.value <=
    start.value
  ) {
    end.setCustomValidity(
      "Delivery End must be after Delivery Start."
    );

    return false;
  }

  return true;
}


/* ============================================================
   SAVE CONTRACT
============================================================ */

async function saveContractChanges(
  event
) {
  event.preventDefault();

  if (
    !state.activeContract ||
    state.busy
  ) {
    return;
  }

  const form =
    $("edit-contract-form");

  const saveButton =
    $("save-edit-btn");


  validateEditPrice();

  validateEditDates();


  const contractBushels =
    numberValue(
      $("edit-contract-bushels")
        ?.dataset
        .rawValue
    );


  const deliveredBushels =
    calculateContractTotals(
      state.activeContract
    ).deliveredBushels;


  let bushelValidity =
    "";


  if (
    !(contractBushels > 0)
  ) {
    bushelValidity =
      "Enter Contract Bushels.";
  }
  else if (
    contractBushels +
    EPSILON <
    deliveredBushels
  ) {
    bushelValidity =
      `Contract Bushels cannot be less than the ${
        formatBushels(
          deliveredBushels
        )
      } bushels already allocated.`;
  }


  $("edit-contract-bushels")
    ?.setCustomValidity(
      bushelValidity
    );


  if (
    !form.reportValidity()
  ) {
    return;
  }


  const buyer =
    state.buyers.find(
      item =>
        item.id ===
        $("edit-buyer")
          .value
    );


  const customer =
    state.customers.find(
      item =>
        item.id ===
        $("edit-customer")
          .value
    );


  const location =
    state.deliveryLocations
      .find(
        item =>
          item.id ===
          $("edit-delivery-location")
            .value
      );


  if (
    !buyer ||
    !customer ||
    !location
  ) {
    alert(
      "Select Buyer, Customer, and Delivery Location."
    );

    return;
  }


  const openBushels =
    roundBushels(
      Math.max(
        0,
        contractBushels -
        deliveredBushels
      )
    );


  const payload = {
    buyerId:
      buyer.id,

    buyerName:
      buyer.name,

    customerId:
      customer.id,

    customerName:
      customer.name,

    crop:
      $("edit-crop")
        .value,

    contractType:
      $("edit-contract-type")
        .value,

    contractNumber:
      clean(
        $("edit-contract-number")
          .value
      ),

    contractDate:
      $("edit-contract-date")
        .value,

    contractBushels,

    deliveredBushels,

    openBushels,

    futuresPrice:
      (
        $("edit-contract-type")
          .value === "Cash" ||
        $("edit-contract-type")
          .value === "Futures"
      )
        ? state.editFuturesPrice
        : null,

    basisPrice:
      (
        $("edit-contract-type")
          .value === "Cash" ||
        $("edit-contract-type")
          .value === "Basis"
      )
        ? state.editBasisPrice
        : null,

    pricePerBushel:
      (
        $("edit-contract-type")
          .value === "Cash" ||
        $("edit-contract-type")
          .value === "Program"
      )
        ? state.editCashPrice
        : null,

    deliveryLocationId:
      location.id,

    deliveryLocationName:
      location.locationName,

    deliveryStreet:
      location.street,

    deliveryCity:
      location.city,

    deliveryState:
      location.state,

    deliveryZip:
      location.zip,

    deliveryStart:
      $("edit-delivery-start")
        .value,

    deliveryEnd:
      $("edit-delivery-end")
        .value,

    notes:
      clean(
        $("edit-notes")
          .value
      ),

    updatedAt:
      serverTimestamp()
  };


  state.busy = true;


  saveButton.disabled =
    true;


  saveButton.textContent =
    "Saving...";


  try {
    await updateDoc(
      doc(
        db,
        CONTRACT_COLLECTION,
        state.activeContract.id
      ),
      payload
    );


    Object.assign(
      state.activeContract,
      payload
    );


    state.contracts.sort(
      compareContracts
    );


    closeEditModal();


    populateContractFilters();


    populateReconciliationPickers();


    renderAll();
  }
  catch (error) {
    console.error(
      "[Grain Contracts] Update failed:",
      error
    );

    alert(
      error?.message ||
      "Unable to update grain contract."
    );
  }
  finally {
    state.busy = false;


    saveButton.disabled =
      false;


    saveButton.textContent =
      "Save Changes";
  }
}
