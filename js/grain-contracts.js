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

  /*
    Compact reconciliation cards:
    contracts and Spot start collapsed, then expand when clicked.
    These values intentionally live only in page state — nothing
    about expansion is written to Firestore.
  */
  expandedContractDropIds: new Set(),
  spotDropExpanded: false,

  draggingTicketId: "",
  draggingTicketIds: [],
  draggingSourceType: "",
  draggingSourceId: "",

  busy: false,

  editFuturesPrice: null,
  editBasisPrice: null,
  editCashPrice: null,
  editBasisSign: 1,

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

  const deliveryStart =
    clean(
      contract.deliveryStart
    );

  if (
    deliveryStart &&
    deliveryStart >
    today
  ) {
    return "pending";
  }

  const deliveryEnd =
    clean(
      contract.deliveryEnd
    );

  if (
    deliveryEnd &&
    deliveryEnd <
    today &&
    open >
    EPSILON
  ) {
    return "past_due";
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

    past_due:
      "Past Due",

    near:
      "Near Full",

    open:
      "Open"
  }[status] || "Open";
}


function getStatusClass(
  contract
) {
  const status =
    getContractStatus(
      contract
    );

  return status ===
    "past_due"
      ? "status-voided"
      : `status-${
          status
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
   COMPACT RECONCILIATION CARD STYLES
   Injected here so this full JS replacement does not require
   another grain-contracts.html edit.
============================================================ */

function ensureCompactReconciliationStyles() {
  if (
    document.getElementById(
      "fv-compact-reconciliation-styles"
    )
  ) {
    return;
  }

  const style =
    document.createElement(
      "style"
    );

  style.id =
    "fv-compact-reconciliation-styles";

  style.textContent = `
    .reconciliation-compact-card{
      padding:0 !important;
      overflow:hidden;
    }

    .reconciliation-compact-card .contract-drop-toggle{
      appearance:none;
      -webkit-appearance:none;
      width:100%;
      border:0;
      background:transparent;
      color:inherit;
      font:inherit;
      text-align:left;
      padding:10px 12px;
      cursor:pointer;
      display:grid;
      grid-template-columns:minmax(0,1fr) auto auto;
      align-items:center;
      gap:10px;
    }

    .reconciliation-compact-card .contract-drop-toggle:hover,
    .reconciliation-compact-card .contract-drop-toggle:focus-visible{
      background:rgba(59,126,70,.06);
      outline:none;
    }

    .reconciliation-compact-card.spot-drop-card .contract-drop-toggle:hover,
    .reconciliation-compact-card.spot-drop-card .contract-drop-toggle:focus-visible{
      background:rgba(154,103,0,.07);
    }

    .compact-contract-main{
      min-width:0;
    }

    .compact-contract-title{
      font-size:.92rem;
      font-weight:900;
      line-height:1.2;
      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
    }

    .compact-contract-meta{
      margin-top:3px;
      font-size:.75rem;
      font-weight:700;
      line-height:1.25;
      opacity:.7;
      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
    }

    .compact-contract-numbers{
      display:flex;
      align-items:center;
      justify-content:flex-end;
      gap:12px;
      white-space:nowrap;
      font-size:.78rem;
    }

    .compact-contract-number{
      display:flex;
      flex-direction:column;
      align-items:flex-end;
      line-height:1.08;
    }

    .compact-contract-number strong{
      font-size:.86rem;
      font-weight:900;
    }

    .compact-contract-number span{
      margin-top:2px;
      font-size:.64rem;
      font-weight:800;
      opacity:.58;
      text-transform:uppercase;
      letter-spacing:.03em;
    }

    .compact-contract-chevron{
      width:24px;
      height:24px;
      flex:0 0 24px;
      display:grid;
      place-items:center;
      border-radius:6px;
      font-size:15px;
      font-weight:900;
      transition:transform .15s ease;
      opacity:.72;
    }

    .reconciliation-compact-card.expanded .compact-contract-chevron{
      transform:rotate(180deg);
    }

    .contract-drop-expanded{
      border-top:1px solid var(--border,rgba(0,0,0,.12));
      padding:12px;
    }

    .contract-drop-expanded[hidden]{
      display:none !important;
    }

    .reconciliation-compact-card.drag-over .contract-drop-toggle{
      background:rgba(59,126,70,.10);
    }

    .reconciliation-compact-card.spot-drop-card.drag-over .contract-drop-toggle{
      background:rgba(154,103,0,.10);
    }

    @media (max-width:760px){
      .reconciliation-compact-card .contract-drop-toggle{
        grid-template-columns:minmax(0,1fr) auto;
        gap:8px;
      }

      .compact-contract-numbers{
        grid-column:1 / -1;
        justify-content:flex-start;
        gap:16px;
        padding-top:3px;
      }

      .compact-contract-number{
        align-items:flex-start;
      }

      .compact-contract-chevron{
        grid-column:2;
        grid-row:1;
      }
    }


    /*
      PHONE LANDSCAPE

      Keep desktop/tablet compact rows unchanged.
      On a phone turned sideways, give each contract the same
      readable stacked-card feel as the Hauling Job cards:
        title
        crop/type/location
        contract / remaining / tickets / status
    */
    @media
      (orientation:landscape)
      and (max-height:500px)
      and (max-width:1000px){

      .reconciliation-compact-card
      .contract-drop-toggle{
        display:grid;
        grid-template-columns:minmax(0,1fr) auto;
        grid-template-areas:
          "main chevron"
          "numbers numbers";
        align-items:start;
        gap:8px 10px;
        padding:11px 12px;
      }

      .reconciliation-compact-card
      .compact-contract-main{
        grid-area:main;
        min-width:0;
      }

      .reconciliation-compact-card
      .compact-contract-title{
        font-size:.92rem;
        line-height:1.2;
        white-space:normal;
        overflow:visible;
        text-overflow:clip;
      }

      .reconciliation-compact-card
      .compact-contract-meta{
        margin-top:4px;
        font-size:.75rem;
        line-height:1.3;
        white-space:normal;
        overflow:visible;
        text-overflow:clip;
      }

      .reconciliation-compact-card
      .compact-contract-chevron{
        grid-area:chevron;
        align-self:start;
        justify-self:end;
        width:24px;
        height:24px;
      }

      .reconciliation-compact-card
      .compact-contract-numbers{
        grid-area:numbers;
        width:100%;
        display:grid;
        grid-template-columns:
          minmax(0,1fr)
          minmax(0,1fr)
          minmax(0,.75fr)
          auto;
        align-items:end;
        justify-content:stretch;
        gap:8px;
        padding-top:5px;
      }

      .reconciliation-compact-card
      .compact-contract-number{
        min-width:0;
        align-items:flex-start;
      }

      .reconciliation-compact-card
      .compact-contract-number strong{
        font-size:.86rem;
        white-space:nowrap;
      }

      .reconciliation-compact-card
      .compact-contract-number span{
        font-size:.61rem;
        white-space:nowrap;
      }

      .reconciliation-compact-card
      .compact-contract-numbers
      .status-pill{
        align-self:center;
        justify-self:end;
        white-space:nowrap;
      }

      .reconciliation-compact-card.spot-drop-card
      .compact-contract-numbers{
        grid-template-columns:
          minmax(0,1fr)
          minmax(0,1fr)
          auto;
      }
    }
  `;

  document.head.appendChild(
    style
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
    ensureCompactReconciliationStyles();
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

haulingJobId:
  clean(
    data.haulingJobId
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

haulingJobId:
  clean(
    data.haulingJobId
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
              "past_due",
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
            past_due: 0,
            open: 1,
            near: 1,
            pending: 2,
            complete: 3,
            voided: 4
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
          status !== "past_due" &&
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
    $("ticket-unassign-drop");

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
        "drag-over"
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
        "drag-over"
      );
    }
  );


  unassigned.addEventListener(
    "drop",
    event => {
      event.preventDefault();

      unassigned.classList.remove(
        "drag-over"
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

function selectedDragTicketIds(
  ticketId,
  type
) {
  const id =
    clean(
      ticketId
    );


  /*
    Group dragging only applies to UNASSIGNED ticket cards.

    If the ticket being dragged is checked, every checked
    unassigned ticket becomes part of the drag group.
  */
  if (
    type ===
      "unassigned" &&
    state.selectedTicketIds
      .has(
        id
      )
  ) {
    const ids =
      [
        ...state.selectedTicketIds
      ]
        .filter(
          selectedId => {

            const ticket =
              state.tickets.find(
                item =>
                  item.id ===
                    selectedId
              );


            return (
              !!ticket &&
              !ticket.voided &&
              getUnassignedBushels(
                ticket
              ) >
                EPSILON
            );

          }
        );


    if (
      ids.length
    ) {
      return ids;
    }
  }


  return id
    ? [
        id
      ]
    : [];
}


function dragStart(
  ticketId,
  type,
  sourceId = ""
) {
  state.draggingTicketId =
    clean(
      ticketId
    );

  state.draggingTicketIds =
    selectedDragTicketIds(
      ticketId,
      type
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
  state.draggingTicketIds = [];
  state.draggingSourceType = "";
  state.draggingSourceId = "";
}


function dragPayload(
  ticketId,
  type,
  sourceId = ""
) {
  const ticketIds =
    selectedDragTicketIds(
      ticketId,
      type
    );


  return JSON.stringify({
    ticketId,
    ticketIds,
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

    const parsedIds =
      Array.isArray(
        parsed.ticketIds
      )
        ? parsed.ticketIds
            .map(
              clean
            )
            .filter(
              Boolean
            )
        : [];


    const ticketId =
      clean(
        parsed.ticketId
      );


    return {
      ticketId,

      ticketIds:
        parsedIds.length
          ? parsedIds
          : (
              ticketId
                ? [
                    ticketId
                  ]
                : []
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
    const ticketId =
      clean(
        raw ||
        state.draggingTicketId
      );


    return {
      ticketId,

      ticketIds:
        state.draggingTicketIds
          .length
          ? [
              ...state.draggingTicketIds
            ]
          : (
              ticketId
                ? [
                    ticketId
                  ]
                : []
            ),

      type:
        state.draggingSourceType,

      sourceId:
        state.draggingSourceId
    };
  }
}


function validateTicketGroupAgainstContract(
  ticketIds,
  contract
) {
  const ids =
    Array.isArray(
      ticketIds
    )
      ? ticketIds
      : [];


  for (
    const ticketId
    of ids
  ) {
    const ticket =
      state.tickets.find(
        item =>
          item.id ===
            ticketId
      );


    const validation =
      validateTicketAgainstContract(
        ticket,
        contract
      );


    if (
      validation
    ) {
      return {
        ok:
          false,

        ticket,

        message:
          validation
      };
    }
  }


  return {
    ok:
      true,

    ticket:
      null,

    message:
      ""
  };
}


function selectedDragFailureMessage(
  result
) {
  if (
    !result ||
    result.ok
  ) {
    return "";
  }


  const ticketLabel =
    result.ticket?.ticketNumber ||
    result.ticket?.id ||
    "Unknown";


  return `Selected tickets were not moved. Ticket ${ticketLabel} failed: ${result.message}`;
}


/* ============================================================
   TOUCH DRAG & DROP
   iPad / iPhone / touch screens

   Desktop HTML drag/drop remains unchanged.

   Touch behavior:
   - normal tap = existing click behavior
   - normal swipe = scroll
   - press and hold ~300ms = begin drag
============================================================ */

const touchDrag = {
  timer: null,
  active: false,

  startX: 0,
  startY: 0,

  sourceElement: null,
  payload: null,

  ghost: null,
  dropTarget: null,

  previousUserSelect: ""
};


function getTouchDragSource(
  target
) {
  if (
    !(target instanceof Element)
  ) {
    return null;
  }


  /*
    Never start a drag from the ticket checkbox.
  */
  if (
    target.closest(
      ".ticket-select"
    )
  ) {
    return null;
  }


  /*
    SPOT assigned ticket.
  */
  const spotButton =
    target.closest(
      "[data-spot-ticket]"
    );

  if (spotButton) {
    return {
      element:
        spotButton,

      payload: {
        ticketId:
          clean(
            spotButton.dataset
              .spotTicket
          ),

        type:
          "spot",

        sourceId:
          ""
      }
    };
  }


  /*
    CONTRACT assigned ticket.
  */
  const assignedButton =
    target.closest(
      "[data-ticket][data-contract]"
    );

  if (assignedButton) {
    return {
      element:
        assignedButton,

      payload: {
        ticketId:
          clean(
            assignedButton.dataset
              .ticket
          ),

        type:
          "contract",

        sourceId:
          clean(
            assignedButton.dataset
              .contract
          )
      }
    };
  }


  /*
    UNASSIGNED ticket card.

    data-touch-ticket-id is added in Edit #2.
  */
  const unassignedCard =
    target.closest(
      "[data-touch-ticket-id]"
    );

  if (unassignedCard) {
    return {
      element:
        unassignedCard,

      payload: {
        ticketId:
          clean(
            unassignedCard.dataset
              .touchTicketId
          ),

        ticketIds:
          selectedDragTicketIds(
            unassignedCard.dataset
              .touchTicketId,
            "unassigned"
          ),

        type:
          "unassigned",

        sourceId:
          ""
      }
    };
  }


  return null;
}


function clearTouchDropHighlights() {
  document
    .querySelectorAll(
      ".drag-over"
    )
    .forEach(
      element =>
        element.classList.remove(
          "drag-over"
        )
    );


  $("ticket-unassign-drop")
    ?.classList
    .remove(
      "drag-over"
    );


  touchDrag.dropTarget =
    null;
}


function createTouchDragGhost(
  payload
) {
  const ticket =
    state.tickets.find(
      item =>
        item.id ===
        payload.ticketId
    );


  const ghost =
    document.createElement(
      "div"
    );


  ghost.className =
    "fv-touch-drag-ghost";


  const groupCount =
    Array.isArray(
      payload.ticketIds
    )
      ? payload.ticketIds.length
      : 0;


  ghost.textContent =
    groupCount >
      1
      ? `${groupCount} selected tickets`
      : `Ticket ${
          ticket?.ticketNumber ||
          payload.ticketId
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
        "2px solid var(--fv-green, #3B7E46)",

      background:
        "var(--surface, #fff)",

      color:
        "inherit",

      boxShadow:
        "0 10px 30px rgba(0,0,0,.25)",

      fontSize:
        ".9rem",

      fontWeight:
        "800",

      whiteSpace:
        "nowrap",

      opacity:
        ".96",

      transform:
        "translate(-50%, -120%)"
    }
  );


  document.body.appendChild(
    ghost
  );


  touchDrag.ghost =
    ghost;


  return ghost;
}


function moveTouchDragGhost(
  x,
  y
) {
  if (
    !touchDrag.ghost
  ) {
    return;
  }


  touchDrag.ghost.style.left =
    `${x}px`;

  touchDrag.ghost.style.top =
    `${y}px`;
}


function getTouchDropTarget(
  x,
  y
) {
  const payload =
    touchDrag.payload;


  if (!payload) {
    return null;
  }


  const ticket =
    state.tickets.find(
      item =>
        item.id ===
        payload.ticketId
    );


  if (
    !ticket ||
    ticket.voided
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


  /*
    DROP BACK TO UNASSIGNED
  */
  const unassigned =
    element.closest(
      "#ticket-unassign-drop"
    );


  if (
    unassigned &&
    [
      "contract",
      "spot"
    ].includes(
      payload.type
    ) &&
    ticketMatchesCurrent(
      ticket
    )
  ) {
    return {
      type:
        "unassigned",

      id:
        "",

      element:
        unassigned
    };
  }


  /*
    DROP ON SPOT
  */
  const spot =
    element.closest(
      ".spot-drop-card"
    );


  if (
    spot &&
    payload.type !==
      "spot"
  ) {
    return {
      type:
        "spot",

      id:
        "",

      element:
        spot
    };
  }


  /*
    DROP ON CONTRACT

    data-touch-contract-id is added in Edit #3.
  */
  const contractCard =
    element.closest(
      "[data-touch-contract-id]"
    );


  if (contractCard) {
    const contractId =
      clean(
        contractCard.dataset
          .touchContractId
      );


    const contract =
      state.contracts.find(
        item =>
          item.id ===
          contractId
      );


    if (
      !contract ||
      contract.voided
    ) {
      return null;
    }


    /*
      Don't drop back onto the same
      contract it came from.
    */
    if (
      payload.type ===
        "contract" &&
      payload.sourceId ===
        contract.id
    ) {
      return null;
    }


    Object.assign(
      contract,
      calculateContractTotals(
        contract
      )
    );


    if (
      contract.openBushels <=
      EPSILON
    ) {
      return null;
    }


    const dragIds =
      Array.isArray(
        payload.ticketIds
      ) &&
      payload.ticketIds.length
        ? payload.ticketIds
        : [
            payload.ticketId
          ];


    const groupValidation =
      validateTicketGroupAgainstContract(
        dragIds,
        contract
      );


    /*
      A selected group is still allowed to reach the drop handler
      when one item is invalid so FarmVista can explain WHY the
      entire group was rejected.

      Single-ticket touch dragging keeps the old behavior.
    */
    if (
      !groupValidation.ok &&
      dragIds.length <=
        1
    ) {
      return null;
    }


    return {
      type:
        "contract",

      id:
        contract.id,

      element:
        contractCard
    };
  }


  return null;
}


function highlightTouchDropTarget(
  target
) {
  clearTouchDropHighlights();


  if (!target) {
    return;
  }


  touchDrag.dropTarget =
    target;


  if (
    target.type ===
    "unassigned"
  ) {
    target.element
      .classList
      .add(
        "drag-over"
      );

    return;
  }


  target.element
    .classList
    .add(
      "drag-over"
    );
}


function beginTouchDrag(
  source,
  touch
) {
  if (
    state.busy ||
    !source?.payload
  ) {
    return;
  }


  touchDrag.active =
    true;

  touchDrag.sourceElement =
    source.element;

  touchDrag.payload =
    source.payload;


  dragStart(
    source.payload.ticketId,
    source.payload.type,
    source.payload.sourceId
  );


  if (
    Array.isArray(
      source.payload.ticketIds
    ) &&
    source.payload.ticketIds.length
  ) {
    state.draggingTicketIds =
      [
        ...source.payload.ticketIds
      ];

    touchDrag.payload.ticketIds =
      [
        ...source.payload.ticketIds
      ];
  }


  source.element
    .classList
    .add(
      "dragging"
    );


  /*
    Prevent text selection while actively dragging.
  */
  touchDrag.previousUserSelect =
    document.body.style
      .userSelect;


  document.body.style
    .userSelect =
      "none";


  createTouchDragGhost(
    source.payload
  );


  moveTouchDragGhost(
    touch.clientX,
    touch.clientY
  );


  highlightTouchDropTarget(
    getTouchDropTarget(
      touch.clientX,
      touch.clientY
    )
  );
}


function cleanupTouchDrag() {
  if (
    touchDrag.timer
  ) {
    clearTimeout(
      touchDrag.timer
    );

    touchDrag.timer =
      null;
  }


  touchDrag.sourceElement
    ?.classList
    .remove(
      "dragging"
    );


  touchDrag.ghost
    ?.remove();


  clearTouchDropHighlights();


  document.body.style
    .userSelect =
      touchDrag.previousUserSelect;


  touchDrag.active =
    false;

  touchDrag.sourceElement =
    null;

  touchDrag.payload =
    null;

  touchDrag.ghost =
    null;

  touchDrag.dropTarget =
    null;

  touchDrag.previousUserSelect =
    "";


  dragClear();
}


function performTouchDrop(
  target
) {
  const payload =
    touchDrag.payload;


  if (
    !payload ||
    !target
  ) {
    return;
  }


  /*
    CONTRACT / SPOT → UNASSIGNED
  */
  if (
    target.type ===
    "unassigned"
  ) {
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

    return;
  }


  /*
    ANY VALID SOURCE → CONTRACT
  */
  if (
    target.type ===
    "contract"
  ) {
    const ticketIds =
      Array.isArray(
        payload.ticketIds
      ) &&
      payload.ticketIds.length
        ? payload.ticketIds
        : [
            payload.ticketId
          ];


    if (
      payload.type ===
        "unassigned" &&
      ticketIds.length >
        1
    ) {
      const contract =
        state.contracts.find(
          item =>
            item.id ===
              target.id
        );


      const validation =
        validateTicketGroupAgainstContract(
          ticketIds,
          contract
        );


      if (
        !validation.ok
      ) {
        alert(
          selectedDragFailureMessage(
            validation
          )
        );

        return;
      }


      assignTicketsToContract(
        ticketIds,
        target.id
      );

      return;
    }


    moveTicketToContract(
      payload.ticketId,
      target.id,
      payload.type,
      payload.sourceId
    );

    return;
  }


  /*
    UNASSIGNED / CONTRACT → SPOT
  */
  if (
    target.type ===
    "spot"
  ) {
    moveTicketBushelsToSpot(
      payload.ticketId,
      payload.type,
      payload.sourceId
    );
  }
}


/*
  Delegated touch handling means dynamically-rendered
  ticket cards do not need individual touch listeners.
*/

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


    const source =
      getTouchDragSource(
        event.target
      );


    if (
      !source ||
      !source.payload.ticketId
    ) {
      return;
    }


    const touch =
      event.touches[0];


    touchDrag.startX =
      touch.clientX;

    touchDrag.startY =
      touch.clientY;


    touchDrag.sourceElement =
      source.element;

    touchDrag.payload =
      source.payload;


    if (
      touchDrag.timer
    ) {
      clearTimeout(
        touchDrag.timer
      );
    }


    /*
      Long enough to distinguish drag from
      normal tap or scrolling.
    */
    touchDrag.timer =
      setTimeout(
        () => {
          touchDrag.timer =
            null;

          beginTouchDrag(
            source,
            touch
          );
        },
        300
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
      cleanupTouchDrag();

      return;
    }


    const touch =
      event.touches[0];


    /*
      Before the 300ms hold activates:
      if the finger moves normally, treat it
      as scrolling and cancel the pending drag.
    */
    if (
      !touchDrag.active
    ) {
      const dx =
        touch.clientX -
        touchDrag.startX;

      const dy =
        touch.clientY -
        touchDrag.startY;


      const distance =
        Math.hypot(
          dx,
          dy
        );


      if (
        distance > 12 &&
        touchDrag.timer
      ) {
        clearTimeout(
          touchDrag.timer
        );

        touchDrag.timer =
          null;

        touchDrag.sourceElement =
          null;

        touchDrag.payload =
          null;
      }


      return;
    }


    /*
      Once long-press drag is active,
      stop page scrolling while the ticket moves.
    */
    event.preventDefault();


    moveTouchDragGhost(
      touch.clientX,
      touch.clientY
    );


    highlightTouchDropTarget(
      getTouchDropTarget(
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
      !touchDrag.active
    ) {
      if (
        touchDrag.timer
      ) {
        clearTimeout(
          touchDrag.timer
        );

        touchDrag.timer =
          null;
      }


      touchDrag.sourceElement =
        null;

      touchDrag.payload =
        null;

      return;
    }


    const touch =
      event.changedTouches[0];


    const target =
      touch
        ? getTouchDropTarget(
            touch.clientX,
            touch.clientY
          )
        : touchDrag.dropTarget;


    /*
      Prevent the synthetic click that iOS may
      fire after finishing a drag.
    */
    const sourceElement =
      touchDrag.sourceElement;


    if (sourceElement) {
      sourceElement.dataset
        .touchSuppressClick =
          "1";


      setTimeout(
        () => {
          delete sourceElement
            .dataset
            .touchSuppressClick;
        },
        500
      );
    }


    performTouchDrop(
      target
    );


    cleanupTouchDrag();
  },
  {
    passive:
      true
  }
);


document.addEventListener(
  "touchcancel",
  cleanupTouchDrag,
  {
    passive:
      true
  }
);


/*
  Stop the click that Safari sometimes creates
  immediately after a completed touch drag.

  Normal taps are NOT affected.
*/
document.addEventListener(
  "click",
  event => {
    const source =
      event.target.closest?.(
        `
          [data-touch-ticket-id],
          [data-ticket][data-contract],
          [data-spot-ticket]
        `
      );


    if (
      source?.dataset
        ?.touchSuppressClick ===
        "1"
    ) {
      event.preventDefault();

      event.stopImmediatePropagation();
    }
  },
  true
);


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

  $("ticket-unassign-drop")
    ?.classList
    .remove(
      "drag-over"
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


      /*
        Touch DND source ID.

        Desktop still uses card.draggable below.
        Touch screens use this data attribute.
      */
      if (
        !ticket.voided &&
        remaining >
        EPSILON
      ) {
        card.dataset.touchTicketId =
          ticket.id;
      }


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

   Compact by default:
   - The whole compact row remains a valid DND target.
   - Click the row to expand/collapse details and assigned tickets.
   - Expansion is UI-only and is never written to Firestore.
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

      const expanded =
        state.expandedContractDropIds
          .has(
            contract.id
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
  `contract-drop-card reconciliation-compact-card${
    full
      ? " fully-assigned"
      : ""
  }${
    expanded
      ? " expanded"
      : ""
  }`;


      /*
        Touch DND target ID.

        The compact row is still the same contract drop target,
        so iPad / touchscreen dragging continues to work.
      */
      card.dataset.touchContractId =
        contract.id;


      if (full) {
        card.style.opacity =
          ".82";
      }


      card.innerHTML = `
        <button
          type="button"
          class="contract-drop-toggle"
          aria-expanded="${expanded ? "true" : "false"}"
          title="${expanded ? "Collapse contract tickets" : "Expand contract tickets"}"
        >

          <div class="compact-contract-main">

            <div class="compact-contract-title">
              Contract ${escapeHtml(contract.contractNumber || contract.id)}
            </div>

            <div class="compact-contract-meta">
              ${escapeHtml(contract.crop || "—")}
              •
              ${escapeHtml(contract.contractType || "—")}
              •
              ${escapeHtml(contract.deliveryLocationName || "No location")}
            </div>

          </div>


          <div class="compact-contract-numbers">

            <div class="compact-contract-number">
              <strong>
                ${formatBushels(contract.contractBushels)}
              </strong>
              <span>
                Contract
              </span>
            </div>

            <div class="compact-contract-number">
              <strong>
                ${formatBushels(contract.openBushels)}
              </strong>
              <span>
                Remaining
              </span>
            </div>

            <div class="compact-contract-number">
              <strong>
                ${contract.loadCount}
              </strong>
              <span>
                Tickets
              </span>
            </div>

            <span class="status-pill ${getStatusClass(contract)}">
              ${getStatusLabel(contract)}
            </span>

          </div>


          <span
            class="compact-contract-chevron"
            aria-hidden="true"
          >
            ▼
          </span>

        </button>


        <div
          class="contract-drop-expanded"
          ${expanded ? "" : "hidden"}
        >

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
                : "Drop ticket bushels on the compact row or anywhere in this card — FarmVista stops exactly at the contract limit"
            }
          </div>

        </div>
      `;


      card
        .querySelector(
          ".contract-drop-toggle"
        )
        ?.addEventListener(
          "click",
          event => {
            event.stopPropagation();

            if (
              state.expandedContractDropIds
                .has(
                  contract.id
                )
            ) {
              state.expandedContractDropIds
                .delete(
                  contract.id
                );
            }
            else {
              state.expandedContractDropIds
                .add(
                  contract.id
                );
            }

            renderReconciliation();
          }
        );


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

          const dragIds =
            state.draggingTicketIds
              .length
              ? state.draggingTicketIds
              : [
                  ticket.id
                ];


          const groupValidation =
            validateTicketGroupAgainstContract(
              dragIds,
              contract
            );


          /*
            For a checked multi-ticket drag, allow the drop event
            even when one ticket fails so we can display the exact
            reason and move NONE of them.
          */
          if (
            !groupValidation.ok
          ) {
            if (
              state.draggingSourceType ===
                "unassigned" &&
              dragIds.length >
                1
            ) {
              event.preventDefault();
            }

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

          const ticketIds =
            Array.isArray(
              payload.ticketIds
            ) &&
            payload.ticketIds.length
              ? payload.ticketIds
              : [
                  payload.ticketId
                ];


          if (
            payload.type ===
              "unassigned" &&
            ticketIds.length >
              1
          ) {
            const validation =
              validateTicketGroupAgainstContract(
                ticketIds,
                contract
              );


            if (
              !validation.ok
            ) {
              alert(
                selectedDragFailureMessage(
                  validation
                )
              );

              return;
            }


            assignTicketsToContract(
              ticketIds,
              contract.id
            );

            return;
          }


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

   Spot follows the exact same compact / expandable pattern
   as a grain contract. The collapsed Spot row is still a
   valid drag-and-drop target.
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

  const expanded =
    Boolean(
      state.spotDropExpanded
    );


  const card =
    document.createElement(
      "div"
    );

  card.className =
    `contract-drop-card spot-drop-card reconciliation-compact-card${
      expanded
        ? " expanded"
        : ""
    }`;

  card.style.borderColor =
    "rgba(154,103,0,.6)";


  card.innerHTML = `
    <button
      type="button"
      class="contract-drop-toggle"
      aria-expanded="${expanded ? "true" : "false"}"
      title="${expanded ? "Collapse Spot tickets" : "Expand Spot tickets"}"
    >

      <div class="compact-contract-main">

        <div class="compact-contract-title">
          Spot Bushels
        </div>

        <div class="compact-contract-meta">
          Bushels sold Spot instead of applied to a contract
        </div>

      </div>


      <div class="compact-contract-numbers">

        <div class="compact-contract-number">
          <strong>
            ${formatBushels(total)}
          </strong>
          <span>
            Spot Bu
          </span>
        </div>

        <div class="compact-contract-number">
          <strong>
            ${tickets.length}
          </strong>
          <span>
            Tickets
          </span>
        </div>

        <span class="status-pill status-near">
          SPOT
        </span>

      </div>


      <span
        class="compact-contract-chevron"
        aria-hidden="true"
      >
        ▼
      </span>

    </button>


    <div
      class="contract-drop-expanded"
      ${expanded ? "" : "hidden"}
    >

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
        Drop ticket bushels on the compact Spot row or anywhere in this card to record as Spot
      </div>

    </div>
  `;


  card
    .querySelector(
      ".contract-drop-toggle"
    )
    ?.addEventListener(
      "click",
      event => {
        event.stopPropagation();

        state.spotDropExpanded =
          !state.spotDropExpanded;

        renderReconciliation();
      }
    );


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

      const ticketIds =
        Array.isArray(
          payload.ticketIds
        ) &&
        payload.ticketIds.length
          ? payload.ticketIds
          : [
              payload.ticketId
            ];


      if (
        payload.type ===
          "unassigned" &&
        ticketIds.length >
          1
      ) {
        alert(
          "Multiple selected tickets can be dragged together onto a grain contract. For Spot, drag tickets one at a time."
        );

        return;
      }


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


/*
  If the ticket is already tied to a hauling job,
  it may only be assigned to contracts linked to
  that same hauling job.

  Tickets without a haulingJobId are still allowed
  through to the normal Buyer / Customer / Crop
  validation below for manual reconciliation.
*/
const ticketHaulingJobId =
  clean(
    ticket.haulingJobId
  );

const contractHaulingJobId =
  clean(
    contract.haulingJobId
  );


if (
  ticketHaulingJobId &&
  contractHaulingJobId !==
    ticketHaulingJobId
) {

  return "This contract is not linked to the same hauling job as this ticket.";

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


  setupEditBankMoneyInput(
    futuresInput,
    function (value) {
      state.editFuturesPrice =
        value;

      calculateEditCashPrice();
    }
  );


  setupEditBankMoneyInput(
    basisInput,
    function (value) {
      if (
        value === null
      ) {
        state.editBasisPrice =
          null;
      }
      else {
        state.editBasisPrice =
          roundEditPrice(
            Math.abs(value) *
            state.editBasisSign
          );
      }

      calculateEditCashPrice();
    }
  );


  setupEditBankMoneyInput(
    cashInput,
    function (value) {
      if (
        $("edit-contract-type")
          ?.value !==
        "Program"
      ) {
        return;
      }

      state.editCashPrice =
        value;
    }
  );


  setupEditBasisSignControl();


  typeInput.addEventListener(
    "change",
    function () {
      updateEditPriceFields();
      calculateEditCashPrice();
      validateEditPrice();
    }
  );


  futuresInput.addEventListener(
    "blur",
    validateEditPrice
  );


  basisInput.addEventListener(
    "blur",
    validateEditPrice
  );


  cashInput.addEventListener(
    "blur",
    validateEditPrice
  );
}


/* ============================================================
   EDIT BANK-STYLE MONEY INPUT
============================================================ */

function setupEditBankMoneyInput(
  input,
  onValueChange
) {
  if (!input) {
    return;
  }


  input.type =
    "text";

  input.inputMode =
    "numeric";

  input.autocomplete =
    "off";


  input.dataset.bankDigits =
    "";


  function updateFromDigits() {
    const digits =
      String(
        input.dataset.bankDigits ||
        ""
      )
        .replace(
          /\D/g,
          ""
        );


    if (!digits) {
      input.dataset.bankDigits =
        "";

      input.value =
        "$0.00";

      input.setCustomValidity(
        ""
      );

      onValueChange(
        null
      );

      return;
    }


    const cents =
      Number(
        digits
      );


    if (
      !Number.isFinite(cents)
    ) {
      return;
    }


    const value =
      roundEditPrice(
        cents / 100
      );


    input.value =
      formatEditBankDollarPrice(
        value
      );


    input.setCustomValidity(
      ""
    );


    onValueChange(
      value
    );
  }


  input.addEventListener(
    "keydown",
    function (event) {
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      ) {
        return;
      }


      if (
        /^\d$/.test(
          event.key
        )
      ) {
        event.preventDefault();


        const allSelected =
          input.selectionStart ===
            0 &&
          input.selectionEnd ===
            input.value.length;


        let digits =
          allSelected
            ? ""
            : String(
                input.dataset
                  .bankDigits ||
                ""
              );


        if (
          digits.length >=
          8
        ) {
          return;
        }


        digits +=
          event.key;


        digits =
          digits.replace(
            /^0+(?=\d)/,
            ""
          );


        input.dataset.bankDigits =
          digits;


        updateFromDigits();


        requestAnimationFrame(
          function () {
            input.setSelectionRange(
              input.value.length,
              input.value.length
            );
          }
        );


        return;
      }


      if (
        event.key ===
        "Backspace"
      ) {
        event.preventDefault();


        let digits =
          String(
            input.dataset
              .bankDigits ||
            ""
          );


        digits =
          digits.slice(
            0,
            -1
          );


        input.dataset.bankDigits =
          digits;


        updateFromDigits();


        requestAnimationFrame(
          function () {
            input.setSelectionRange(
              input.value.length,
              input.value.length
            );
          }
        );


        return;
      }


      if (
        event.key ===
        "Delete"
      ) {
        event.preventDefault();


        input.dataset.bankDigits =
          "";


        updateFromDigits();

        return;
      }


      if (
        [
          "Tab",
          "Enter",
          "Escape",
          "ArrowLeft",
          "ArrowRight",
          "Home",
          "End"
        ].includes(
          event.key
        )
      ) {
        return;
      }


      event.preventDefault();
    }
  );


  input.addEventListener(
    "paste",
    function (event) {
      event.preventDefault();


      const pasted =
        event.clipboardData
          ?.getData(
            "text"
          ) ||
        "";


      let digits =
        String(
          pasted
        )
          .replace(
            /\D/g,
            ""
          );


      if (!digits) {
        input.dataset.bankDigits =
          "";

        updateFromDigits();

        return;
      }


      digits =
        digits
          .slice(
            0,
            8
          )
          .replace(
            /^0+(?=\d)/,
            ""
          );


      input.dataset.bankDigits =
        digits;


      updateFromDigits();
    }
  );


  input.addEventListener(
    "input",
    function () {
      const digits =
        String(
          input.dataset.bankDigits ||
          ""
        );


      if (!digits) {
        input.value =
          "$0.00";

        return;
      }


      input.value =
        formatEditBankDollarPrice(
          Number(digits) /
          100
        );
    }
  );


  input.addEventListener(
    "focus",
    function () {
      if (
        !input.value
      ) {
        input.value =
          "$0.00";
      }


      requestAnimationFrame(
        function () {
          input.setSelectionRange(
            input.value.length,
            input.value.length
          );
        }
      );
    }
  );
}


/* ============================================================
   EDIT BASIS +/- CONTROL
============================================================ */

function setupEditBasisSignControl() {
  const basisInput =
    $("edit-basis-price");


  if (!basisInput) {
    return;
  }


  if (
    $("edit-basis-sign-control")
  ) {
    return;
  }


  const parent =
    basisInput.parentElement;


  if (!parent) {
    return;
  }


  const row =
    document.createElement(
      "div"
    );


  row.id =
    "edit-basis-price-row";

  row.style.display =
    "flex";

  row.style.alignItems =
    "stretch";

  row.style.gap =
    "8px";

  row.style.width =
    "100%";


  const control =
    document.createElement(
      "div"
    );


  control.id =
    "edit-basis-sign-control";

  control.style.display =
    "flex";

  control.style.flex =
    "0 0 auto";

  control.style.border =
    "1px solid rgba(0,0,0,.18)";

  control.style.borderRadius =
    "10px";

  control.style.overflow =
    "hidden";

  control.style.background =
    "#fff";


  const plusButton =
    document.createElement(
      "button"
    );


  plusButton.type =
    "button";

  plusButton.id =
    "edit-basis-sign-plus";

  plusButton.textContent =
    "+";

  plusButton.setAttribute(
    "aria-label",
    "Positive basis"
  );


  const minusButton =
    document.createElement(
      "button"
    );


  minusButton.type =
    "button";

  minusButton.id =
    "edit-basis-sign-minus";

  minusButton.textContent =
    "−";

  minusButton.setAttribute(
    "aria-label",
    "Negative basis"
  );


  [
    plusButton,
    minusButton
  ].forEach(
    function (button) {
      button.style.width =
        "42px";

      button.style.minWidth =
        "42px";

      button.style.border =
        "0";

      button.style.borderRadius =
        "0";

      button.style.fontSize =
        "18px";

      button.style.fontWeight =
        "700";

      button.style.cursor =
        "pointer";

      button.style.transition =
        "background .15s ease, color .15s ease";
    }
  );


  plusButton.style.borderRight =
    "1px solid rgba(0,0,0,.12)";


  control.appendChild(
    plusButton
  );


  control.appendChild(
    minusButton
  );


  parent.insertBefore(
    row,
    basisInput
  );


  row.appendChild(
    control
  );


  row.appendChild(
    basisInput
  );


  basisInput.style.flex =
    "1 1 auto";

  basisInput.style.minWidth =
    "0";


  plusButton.addEventListener(
    "click",
    function () {
      applyEditBasisSign(
        1
      );
    }
  );


  minusButton.addEventListener(
    "click",
    function () {
      applyEditBasisSign(
        -1
      );
    }
  );


  updateEditBasisSignButtons();
}


function applyEditBasisSign(
  sign
) {
  state.editBasisSign =
    sign;


  if (
    state.editBasisPrice !==
    null
  ) {
    state.editBasisPrice =
      roundEditPrice(
        Math.abs(
          state.editBasisPrice
        ) *
        state.editBasisSign
      );
  }


  updateEditBasisSignButtons();

  calculateEditCashPrice();
}


function updateEditBasisSignButtons() {
  const plusButton =
    $("edit-basis-sign-plus");

  const minusButton =
    $("edit-basis-sign-minus");


  if (
    !plusButton ||
    !minusButton
  ) {
    return;
  }


  const positive =
    state.editBasisSign >=
    0;


  plusButton.style.background =
    positive
      ? "#347841"
      : "#f3f4f6";

  plusButton.style.color =
    positive
      ? "#fff"
      : "#333";


  minusButton.style.background =
    positive
      ? "#f3f4f6"
      : "#347841";

  minusButton.style.color =
    positive
      ? "#333"
      : "#fff";


  plusButton.setAttribute(
    "aria-pressed",
    positive
      ? "true"
      : "false"
  );


  minusButton.setAttribute(
    "aria-pressed",
    positive
      ? "false"
      : "true"
  );
}


/* ============================================================
   EDIT NULLABLE PRICE
============================================================ */

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
    Number(
      value
    );


  return Number.isFinite(
    number
  )
    ? roundEditPrice(
        number
      )
    : null;
}


/* ============================================================
   SET EDIT PRICING
============================================================ */

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


  state.editBasisSign =
    state.editBasisPrice !==
      null &&
    state.editBasisPrice < 0
      ? -1
      : 1;


  const futuresInput =
    $("edit-futures-price");

  const basisInput =
    $("edit-basis-price");

  const cashInput =
    $("edit-price");


  setEditBankMoneyValue(
    futuresInput,
    state.editFuturesPrice
  );


  setEditBankMoneyValue(
    basisInput,
    state.editBasisPrice ===
      null
      ? null
      : Math.abs(
          state.editBasisPrice
        )
  );


  setEditBankMoneyValue(
    cashInput,
    state.editCashPrice
  );


  updateEditBasisSignButtons();

  updateEditPriceFields();

  calculateEditCashPrice();
}


function setEditBankMoneyValue(
  input,
  value
) {
  if (!input) {
    return;
  }


  if (
    value === null ||
    !Number.isFinite(
      Number(value)
    )
  ) {
    input.dataset.bankDigits =
      "";

    input.value =
      "";

    return;
  }


  const cents =
    Math.round(
      Math.abs(
        Number(value)
      ) *
      100
    );


  input.dataset.bankDigits =
    String(
      cents
    );


  input.value =
    formatEditBankDollarPrice(
      Math.abs(
        Number(value)
      )
    );
}


/* ============================================================
   EDIT PRICE FIELD STATE
============================================================ */

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

  const plusButton =
    $("edit-basis-sign-plus");

  const minusButton =
    $("edit-basis-sign-minus");


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


  if (plusButton) {
    plusButton.disabled =
      true;

    plusButton.style.opacity =
      ".5";
  }


  if (minusButton) {
    minusButton.disabled =
      true;

    minusButton.style.opacity =
      ".5";
  }


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


    if (plusButton) {
      plusButton.disabled =
        false;

      plusButton.style.opacity =
        "1";
    }


    if (minusButton) {
      minusButton.disabled =
        false;

      minusButton.style.opacity =
        "1";
    }


    showEditEmptyBankValue(
      futuresInput
    );


    showEditEmptyBankValue(
      basisInput
    );


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


    if (plusButton) {
      plusButton.disabled =
        false;

      plusButton.style.opacity =
        "1";
    }


    if (minusButton) {
      minusButton.disabled =
        false;

      minusButton.style.opacity =
        "1";
    }


    showEditEmptyBankValue(
      basisInput
    );


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


    showEditEmptyBankValue(
      futuresInput
    );


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


    showEditEmptyBankValue(
      cashInput
    );
  }


  else {
    cashInput.placeholder =
      "Select contract type";
  }
}


function showEditEmptyBankValue(
  input
) {
  if (!input) {
    return;
  }


  if (
    !input.dataset.bankDigits
  ) {
    input.value =
      "$0.00";
  }
}


/* ============================================================
   CALCULATE EDIT CASH PRICE
============================================================ */

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

      cashInput.dataset.bankDigits =
        "";

      return;
    }


    state.editCashPrice =
      roundEditPrice(
        state.editFuturesPrice +
        state.editBasisPrice
      );


    cashInput.value =
      formatEditBankDollarPrice(
        state.editCashPrice
      );


    cashInput.dataset.bankDigits =
      String(
        Math.round(
          Math.abs(
            state.editCashPrice
          ) *
          100
        )
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

    cashInput.dataset.bankDigits =
      "";
  }
}


/* ============================================================
   EDIT PRICE HELPERS
============================================================ */

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


function formatEditBankDollarPrice(
  value
) {
  if (
    value === null ||
    !Number.isFinite(
      Number(value)
    )
  ) {
    return "$0.00";
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
          2
      }
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
          2
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
    Number(
      value
    );


  const absolute =
    Math.abs(
      number
    ).toLocaleString(
      "en-US",
      {
        minimumFractionDigits:
          2,

        maximumFractionDigits:
          2
      }
    );


  if (
    number > 0
  ) {
    return `+$${absolute}`;
  }


  if (
    number < 0
  ) {
    return `-$${absolute}`;
  }


  return "$0.00";
}


/* ============================================================
   EDIT PRICE VALIDATION
============================================================ */

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


  futuresInput.setCustomValidity(
    ""
  );

  basisInput.setCustomValidity(
    ""
  );

  cashInput.setCustomValidity(
    ""
  );


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
