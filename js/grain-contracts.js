// /Farm-vista/js/grain-contracts.js
// FarmVista — Grain Contracts
// Rebuilt 2026-08-17
//
// Reconciliation rules:
// 1) Buyer must be selected first.
// 2) Customer list only shows customers with contracts for that buyer.
// 3) Tickets can only be assigned/moved to the same Buyer + Customer + Crop.
// 4) Assigned tickets can be dragged back to Unassigned to remove the contract.
// 5) Assigned tickets can be dragged directly to another matching contract.

import {
  ready,
  getFirestore,
  collection,
  getDocs,
  doc,
  updateDoc,
  serverTimestamp
} from "/Farm-vista/js/firebase-init.js";

await ready;

const db = getFirestore();

const CONTRACT_COLLECTION = "grain_contracts";
const BUYER_COLLECTION = "grain_buyers";
const CUSTOMER_COLLECTION = "grain_customers";
const LOCATION_COLLECTION = "grain_delivery_locations";
const TICKET_COLLECTION = "grain_tickets";

const $ = id => document.getElementById(id);

const clean = value =>
  String(value ?? "").trim();

const normalized = value =>
  clean(value).toLowerCase();

const numberValue = value =>
  Number.isFinite(Number(value))
    ? Number(value)
    : 0;


/* ============================================================
   STATE
============================================================ */

const state = {
  contracts: [],
  filteredContracts: [],
  buyers: [],
  customers: [],
  deliveryLocations: [],
  tickets: [],

  activeContract: null,
  activeTicket: null,

  reconcileBuyerId: "",
  reconcileCustomerId: "",

  selectedTicketIds: new Set(),

  draggingTicketId: "",

  busy: false,

  editPriceCents: 0,
  editPriceHasValue: false
};


/* ============================================================
   BASIC FORMATTERS
============================================================ */

function formatBushels(value) {
  return numberValue(value).toLocaleString(
    "en-US",
    {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    }
  );
}


function formatWholeNumber(value) {
  const n = Number(value);

  return Number.isFinite(n)
    ? Math.round(n).toLocaleString("en-US")
    : "—";
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

  const n = Number(value);

  return Number.isFinite(n)
    ? `${n.toFixed(2)}${suffix}`
    : clean(value) || "—";
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

  if (
    parts.length !== 3
  ) {
    return clean(iso);
  }

  return (
    `${Number(parts[1])}/` +
    `${Number(parts[2])}/` +
    `${parts[0]}`
  );
}


function formatDeliveryWindow(
  contract
) {
  const start =
    clean(contract.deliveryStart);

  const end =
    clean(contract.deliveryEnd);

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
    return (
      `${formatDate(start)} – ` +
      `${formatDate(end)}`
    );
  }

  return formatDate(
    start ||
    end
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
    (
      a,
      b
    ) =>
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
    (
      a,
      b
    ) =>
      clean(a.name).localeCompare(
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
    clean(
      b.contractDate
    ).localeCompare(
      clean(a.contractDate)
    );

  if (
    dateCompare
  ) {
    return dateCompare;
  }

  return clean(
    a.contractNumber
  ).localeCompare(
    clean(b.contractNumber),
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
    clean(
      a.ticketDate
    ).localeCompare(
      clean(b.ticketDate)
    );

  if (
    dateCompare
  ) {
    return dateCompare;
  }

  return clean(
    a.ticketNumber
  ).localeCompare(
    clean(b.ticketNumber),
    undefined,
    {
      numeric: true,
      sensitivity: "base"
    }
  );
}


function addDays(
  isoDate,
  days
) {
  const [
    year,
    month,
    day
  ] =
    clean(isoDate)
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

  return (
    `${date.getFullYear()}-` +
    `${String(
      date.getMonth() + 1
    ).padStart(2, "0")}-` +
    `${String(
      date.getDate()
    ).padStart(2, "0")}`
  );
}


/* ============================================================
   SELECT HELPERS
============================================================ */

function setSelectValue(
  select,
  value
) {
  if (
    !select
  ) {
    return false;
  }

  const wanted =
    clean(value);

  const option =
    [
      ...select.options
    ].find(
      item =>
        clean(item.value) ===
        wanted
    );

  if (
    !option
  ) {
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
  selectedValue = ""
) {
  if (
    !select
  ) {
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
    selectedValue
  );
}


function populateSimpleFilter(
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
      ?.cloneNode(true);

  select.innerHTML = "";

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

  setSelectValue(
    select,
    current
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

    try {
      await loadAllData();

      rebuildContractTotalsFromTickets();

      populateAllPickers();

      renderAll();
    }
    catch (
      error
    ) {
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
              <td colspan="12">
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
    contractSnapshot.docs.map(
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
            Number.isFinite(
              Number(
                data.openBushels
              )
            )
              ? Number(
                  data.openBushels
                )
              : (
                  numberValue(
                    data.contractBushels
                  ) -
                  numberValue(
                    data.deliveredBushels
                  )
                ),

          pricePerBushel:
            numberValue(
              data.pricePerBushel
            )
        };
      }
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


  state.deliveryLocations =
    locationSnapshot.docs.map(
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
    );


  state.tickets =
    ticketSnapshot.docs.map(
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


  state.contracts.sort(
    compareContracts
  );

  sortByName(
    state.buyers
  );

  sortByName(
    state.customers
  );

  state.deliveryLocations.sort(
    (
      a,
      b
    ) =>
      clean(
        a.locationName
      ).localeCompare(
        clean(
          b.locationName
        )
      )
  );
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
        clean(
          ticket.contractId
        ) ===
        clean(
          contractId
        )
    )
    .sort(
      compareTickets
    );
}


function calculateContractTotals(
  contract
) {
  const assigned =
    getAssignedTickets(
      contract.id
    );

  const deliveredBushels =
    assigned.reduce(
      (
        sum,
        ticket
      ) =>
        sum +
        numberValue(
          ticket.netBushels
        ),
      0
    );

  const contractBushels =
    numberValue(
      contract.contractBushels
    );

  return {
    deliveredBushels,

    openBushels:
      contractBushels -
      deliveredBushels,

    overhaulBushels:
      Math.max(
        0,
        deliveredBushels -
        contractBushels
      ),

    loadCount:
      assigned.length
  };
}


function rebuildContractTotalsFromTickets() {
  state.contracts.forEach(
    contract =>
      Object.assign(
        contract,
        calculateContractTotals(
          contract
        )
      )
  );
}


async function syncContractTotalsForIds(
  contractIds
) {
  const ids =
    [
      ...new Set(
        contractIds
          .map(clean)
          .filter(Boolean)
      )
    ];

  await Promise.all(
    ids.map(
      async contractId => {
        const contract =
          state.contracts.find(
            item =>
              clean(
                item.id
              ) ===
              contractId
          );

        if (
          !contract
        ) {
          return;
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
              numberValue(
                contract.deliveredBushels
              ),

            openBushels:
              numberValue(
                contract.openBushels
              ),

            updatedAt:
              serverTimestamp()
          }
        );
      }
    )
  );
}


/* ============================================================
   CONTRACT STATUS
============================================================ */

function getContractStatus(
  contract
) {
  const contracted =
    numberValue(
      contract.contractBushels
    );

  const delivered =
    numberValue(
      contract.deliveredBushels
    );

  const open =
    contracted -
    delivered;

  if (
    open < 0
  ) {
    return "over";
  }

  if (
    open === 0 &&
    contracted > 0
  ) {
    return "complete";
  }

  if (
    contracted > 0 &&
    open > 0 &&
    open <=
      Math.max(
        contracted *
        0.10,
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
  return {
    over:
      "Overhauled",

    complete:
      "Completed",

    near:
      "Near Full",

    open:
      "Open"
  }[
    getContractStatus(
      contract
    )
  ];
}


function getStatusClass(
  contract
) {
  return (
    `status-${getContractStatus(contract)}`
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
      const el =
        $(id);

      if (
        !el
      ) {
        return;
      }

      el.addEventListener(
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
    "all";

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
    state.contracts.filter(
      contract => {
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

        if (
          status !==
            "all" &&
          getContractStatus(
            contract
          ) !==
            status
        ) {
          return false;
        }

        return true;
      }
    );

  renderContracts();
}


/* ============================================================
   RENDER ALL
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


/* ============================================================
   CONTRACT SUMMARY
============================================================ */

function renderContractSummary() {
  const totals =
    state.filteredContracts.reduce(
      (
        acc,
        contract
      ) => {
        acc.contracted +=
          numberValue(
            contract.contractBushels
          );

        acc.delivered +=
          numberValue(
            contract.deliveredBushels
          );

        acc.open +=
          Math.max(
            0,
            numberValue(
              contract.openBushels
            )
          );

        acc.over +=
          Math.max(
            0,
            -numberValue(
              contract.openBushels
            )
          );

        return acc;
      },
      {
        contracted: 0,
        delivered: 0,
        open: 0,
        over: 0
      }
    );

  if (
    $("summary-contracts")
  ) {
    $("summary-contracts")
      .textContent =
        state.filteredContracts
          .length
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
        formatBushels(
          totals.over
        );
  }
}


/* ============================================================
   CONTRACT TABLE
============================================================ */

function renderContractTable() {
  const tbody =
    $("contracts-table-body");

  if (
    !tbody
  ) {
    return;
  }

  tbody.innerHTML = "";

  if (
    !state.filteredContracts.length
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

  state.filteredContracts.forEach(
    contract => {
      const row =
        document.createElement(
          "tr"
        );

      row.className =
        "contract-row";

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
          ${escapeHtml(contract.contractType || "—")}
        </td>

        <td class="number-cell">
          ${formatBushels(contract.contractBushels)}
        </td>

        <td class="number-cell">
          ${formatBushels(contract.deliveredBushels)}
        </td>

        <td
          class="number-cell ${
            numberValue(
              contract.openBushels
            ) < 0
              ? "contract-over"
              : ""
          }"
        >
          ${formatBushels(contract.openBushels)}
        </td>

        <td class="center-cell">
          ${numberValue(contract.loadCount).toLocaleString("en-US")}
        </td>

        <td class="number-cell">
          ${formatPrice(contract.pricePerBushel)}
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
   RECONCILIATION BUYER -> CUSTOMER
============================================================ */

function getCustomersForBuyer(
  buyerId
) {
  const selectedBuyer =
    state.buyers.find(
      buyer =>
        clean(
          buyer.id
        ) ===
        clean(
          buyerId
        )
    );

  if (
    !selectedBuyer
  ) {
    return [];
  }


  /*
    Match existing contracts by buyer ID OR buyer name.

    This matters because some older FarmVista contract
    records may have the correct buyerName even if their
    buyerId is blank or from older data.
  */

  const matchingContracts =
    state.contracts.filter(
      contract => {

        const idMatches =
          clean(
            contract.buyerId
          ) &&
          clean(
            contract.buyerId
          ) ===
          clean(
            selectedBuyer.id
          );


        const nameMatches =
          normalized(
            contract.buyerName
          ) &&
          normalized(
            contract.buyerName
          ) ===
          normalized(
            selectedBuyer.name
          );


        return (
          idMatches ||
          nameMatches
        );

      }
    );


  /*
    Build both an ID list and a name list.

    That lets current customer records match older
    contract records even when one side has only a name.
  */

  const customerIds =
    new Set(
      matchingContracts
        .map(
          contract =>
            clean(
              contract.customerId
            )
        )
        .filter(
          Boolean
        )
    );


  const customerNames =
    new Set(
      matchingContracts
        .map(
          contract =>
            normalized(
              contract.customerName
            )
        )
        .filter(
          Boolean
        )
    );


  return state.customers
    .filter(
      customer => {

        const idMatches =
          customerIds.has(
            clean(
              customer.id
            )
          );


        const nameMatches =
          customerNames.has(
            normalized(
              customer.name
            )
          );


        return (
          idMatches ||
          nameMatches
        );

      }
    )
    .sort(
      (
        a,
        b
      ) =>
        clean(
          a.name
        )
          .localeCompare(
            clean(
              b.name
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


function populateReconciliationPickers() {
  populateObjectSelect(
    $("reconcile-buyer"),
    state.buyers,
    "Select Buyer",
    state.reconcileBuyerId
  );

  populateReconciliationCustomerPicker();
}


function populateReconciliationCustomerPicker() {
  const select =
    $("reconcile-customer");

  if (
    !select
  ) {
    return;
  }

  if (
    !state.reconcileBuyerId
  ) {
    state.reconcileCustomerId =
      "";

    populateObjectSelect(
      select,
      [],
      "Select Buyer first"
    );

    select.disabled =
      true;

    return;
  }

  const customers =
    getCustomersForBuyer(
      state.reconcileBuyerId
    );

  const valid =
    customers.some(
      customer =>
        clean(
          customer.id
        ) ===
        clean(
          state.reconcileCustomerId
        )
    );

  if (
    !valid
  ) {
    state.reconcileCustomerId =
      "";
  }

  populateObjectSelect(
    select,
    customers,

    customers.length
      ? "Select Customer"
      : "No Customers With Contracts",

    state.reconcileCustomerId
  );

  select.disabled =
    customers.length ===
    0;
}


/* ============================================================
   RECONCILIATION EVENTS
============================================================ */

function setupReconciliationControls() {
  $("reconcile-buyer")
    ?.addEventListener(
      "change",
      function () {
        state.reconcileBuyerId =
          clean(
            this.value
          );

        state.reconcileCustomerId =
          "";

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
        if (
          !state.reconcileBuyerId
        ) {
          this.value = "";

          state.reconcileCustomerId =
            "";

          return;
        }

        state.reconcileCustomerId =
          clean(
            this.value
          );

        state.selectedTicketIds
          .clear();

        renderReconciliation();
      }
    );


  $("select-all-tickets-btn")
    ?.addEventListener(
      "click",
      selectAllVisibleTickets
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


  /*
    LEFT-SIDE DROP TARGET

    Assigned tickets can be dragged
    back into Unassigned Grain Tickets.
  */

  const unassigned =
    $("unassigned-ticket-list");

  if (
    !unassigned
  ) {
    return;
  }


  unassigned.addEventListener(
    "dragover",
    event => {
      if (
        state.busy
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
        !clean(
          ticket.contractId
        )
      ) {
        return;
      }

      if (
        clean(
          ticket.buyerId
        ) !==
        clean(
          state.reconcileBuyerId
        )
      ) {
        return;
      }

      if (
        clean(
          ticket.customerId
        ) !==
        clean(
          state.reconcileCustomerId
        )
      ) {
        return;
      }

      event.preventDefault();

      event.dataTransfer.dropEffect =
        "move";

      unassigned.classList.add(
        "drag-over-unassign"
      );
    }
  );


  unassigned.addEventListener(
    "dragleave",
    event => {
      const related =
        event.relatedTarget;

      if (
        related &&
        unassigned.contains(
          related
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

      const ticketId =
        event.dataTransfer.getData(
          "text/plain"
        ) ||
        state.draggingTicketId;

      if (
        ticketId
      ) {
        unassignTicketFromContract(
          ticketId
        );
      }
    }
  );
}


/* ============================================================
   RECONCILIATION DATA
============================================================ */

function reconciliationReady() {
  return Boolean(
    state.reconcileBuyerId &&
    state.reconcileCustomerId
  );
}


function getVisibleUnassignedTickets() {

  if (
    !reconciliationReady()
  ) {
    return [];
  }


  const selectedBuyer =
    state.buyers.find(
      buyer =>
        clean(
          buyer.id
        ) ===
        clean(
          state.reconcileBuyerId
        )
    );


  const selectedCustomer =
    state.customers.find(
      customer =>
        clean(
          customer.id
        ) ===
        clean(
          state.reconcileCustomerId
        )
    );


  if (
    !selectedBuyer ||
    !selectedCustomer
  ) {
    return [];
  }


  return state.tickets
    .filter(
      ticket => {

        /*
          Only unassigned tickets belong on the left.
        */

        if (
          clean(
            ticket.contractId
          )
        ) {
          return false;
        }


        const buyerMatches =
          (
            clean(
              ticket.buyerId
            ) &&
            clean(
              ticket.buyerId
            ) ===
            clean(
              selectedBuyer.id
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
              selectedBuyer.name
            )
          );


        const customerMatches =
          (
            clean(
              ticket.customerId
            ) &&
            clean(
              ticket.customerId
            ) ===
            clean(
              selectedCustomer.id
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
              selectedCustomer.name
            )
          );


        return (
          buyerMatches &&
          customerMatches
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


  const selectedBuyer =
    state.buyers.find(
      buyer =>
        clean(
          buyer.id
        ) ===
        clean(
          state.reconcileBuyerId
        )
    );


  const selectedCustomer =
    state.customers.find(
      customer =>
        clean(
          customer.id
        ) ===
        clean(
          state.reconcileCustomerId
        )
    );


  if (
    !selectedBuyer ||
    !selectedCustomer
  ) {
    return [];
  }


  return state.contracts
    .filter(
      contract => {

        const buyerMatches =
          (
            clean(
              contract.buyerId
            ) &&
            clean(
              contract.buyerId
            ) ===
            clean(
              selectedBuyer.id
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
              selectedBuyer.name
            )
          );


        const customerMatches =
          (
            clean(
              contract.customerId
            ) &&
            clean(
              contract.customerId
            ) ===
            clean(
              selectedCustomer.id
            )
          ) ||
          (
            normalized(
              contract.customerName
            ) &&
            normalized(
              contract.customerName
            ) ===
            normalized(
              selectedCustomer.name
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


function selectAllVisibleTickets() {
  state.selectedTicketIds
    .clear();

  getVisibleUnassignedTickets()
    .forEach(
      ticket =>
        state.selectedTicketIds
          .add(
            ticket.id
          )
    );

  renderReconciliation();
}


/* ============================================================
   RENDER RECONCILIATION
============================================================ */

function renderReconciliation() {
  const readyNow =
    reconciliationReady();

  const message =
    $("reconcile-filter-message");

  const selectAllBtn =
    $("select-all-tickets-btn");

  const clearBtn =
    $("clear-ticket-selection-btn");

  const refreshBtn =
    $("refresh-reconciliation-btn");


  if (
    selectAllBtn
  ) {
    selectAllBtn.disabled =
      !readyNow ||
      state.busy;
  }


  if (
    clearBtn
  ) {
    clearBtn.disabled =
      !readyNow ||
      !state.selectedTicketIds
        .size ||
      state.busy;
  }


  if (
    refreshBtn
  ) {
    refreshBtn.disabled =
      !readyNow ||
      state.busy;
  }


  if (
    !readyNow
  ) {
    message
      ?.classList
      .remove(
        "ready"
      );

    if (
      message
    ) {
      message.textContent =
        !state.reconcileBuyerId
          ? (
              "Select Buyer first. " +
              "Customer choices will then be limited to customers with contracts for that buyer."
            )
          : (
              "Now select a Customer. " +
              "Only customers with contracts for this buyer are shown."
            );
    }


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
              ${
                state.reconcileBuyerId
                  ? "Select Customer"
                  : "Select Buyer"
              }
            </div>

            <div class="empty-sub">
              Unassigned tickets will appear here after the required filters are selected.
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
              ${
                state.reconcileBuyerId
                  ? "Select Customer"
                  : "Select Buyer"
              }
            </div>

            <div class="empty-sub">
              Matching contracts will appear here after the required filters are selected.
            </div>

          </div>
        `;
    }

    return;
  }


  message
    ?.classList
    .add(
      "ready"
    );


  if (
    message
  ) {
    message.textContent =
      "Ready — drag tickets to matching crop contracts. " +
      "Drag assigned tickets back left to unassign, or directly to another matching contract.";
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
            ticketId
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
        `${state.selectedTicketIds.size} selected`;
  }


  if (
    $("unassigned-count")
  ) {
    $("unassigned-count")
      .textContent =
        `${tickets.length} ${
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
        `${contracts.length} ${
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

  if (
    !container
  ) {
    return;
  }

  container.classList.remove(
    "drag-over-unassign"
  );

  container.innerHTML = "";


  if (
    !tickets.length
  ) {
    container.innerHTML = `
      <div class="empty-state">

        <div class="empty-title">
          No Unassigned Tickets
        </div>

        <div class="empty-sub">
          There are no unassigned grain tickets for this buyer and customer.
          Assigned tickets can be dragged back here to undo an assignment.
        </div>

      </div>
    `;

    return;
  }


  tickets.forEach(
    ticket => {
      const card =
        document.createElement(
          "div"
        );

      card.className =
        "ticket-card";

      card.draggable =
        !state.busy;


      card.innerHTML = `
        <input
          class="ticket-select"
          type="checkbox"
          ${
            state.selectedTicketIds.has(
              ticket.id
            )
              ? "checked"
              : ""
          }
          aria-label="Select ticket ${escapeHtml(ticket.ticketNumber || ticket.id)}"
        />

        <div class="ticket-content">

          <div class="ticket-top">

            <div class="ticket-number">
              Ticket ${escapeHtml(ticket.ticketNumber || "—")}
            </div>

            <div class="ticket-bushels">
              ${formatBushels(ticket.netBushels)} bu
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

            ${
              ticket.deliveryLocationName
                ? `
                    <span>
                      ${escapeHtml(ticket.deliveryLocationName)}
                    </span>
                  `
                : ""
            }

            ${
              ticket.driverName
                ? `
                    <span>
                      ${escapeHtml(ticket.driverName)}
                    </span>
                  `
                : ""
            }

          </div>

        </div>
      `;


      card
        .querySelector(
          ".ticket-select"
        )
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
          if (
            state.busy
          ) {
            event.preventDefault();

            return;
          }

          state.draggingTicketId =
            ticket.id;

          card.classList.add(
            "dragging"
          );

          event.dataTransfer.effectAllowed =
            "move";

          event.dataTransfer.setData(
            "text/plain",
            ticket.id
          );
        }
      );


      card.addEventListener(
        "dragend",
        () => {
          state.draggingTicketId =
            "";

          card.classList.remove(
            "dragging"
          );

          $("unassigned-ticket-list")
            ?.classList
            .remove(
              "drag-over-unassign"
            );

          document
            .querySelectorAll(
              ".contract-drop-card.drag-over"
            )
            .forEach(
              el =>
                el.classList.remove(
                  "drag-over"
                )
            );
        }
      );


      container.appendChild(
        card
      );
    }
  );
}


/* ============================================================
   ASSIGNED TICKET MARKUP
============================================================ */

function assignedTicketMarkup(
  contract
) {
  const assigned =
    getAssignedTickets(
      contract.id
    );


  if (
    !assigned.length
  ) {
    return `
      <div class="assigned-ticket-section">

        <div class="assigned-ticket-head">

          <div class="assigned-ticket-title">
            Assigned Tickets
          </div>

          <div class="assigned-ticket-count">
            0 tickets
          </div>

        </div>

        <div class="assigned-ticket-empty">
          No grain tickets assigned yet.
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
          ${assigned.length} ${
            assigned.length === 1
              ? "ticket"
              : "tickets"
          }
        </div>

      </div>

      <div class="assigned-ticket-list">

        ${
          assigned.map(
            ticket => `
              <button
                type="button"
                class="assigned-ticket-item"
                data-assigned-ticket-id="${escapeHtml(ticket.id)}"
                draggable="${state.busy ? "false" : "true"}"
                title="Click for details, or drag to another matching contract / back to Unassigned"
              >

                <div class="assigned-ticket-top">

                  <div class="assigned-ticket-number">
                    Ticket ${escapeHtml(ticket.ticketNumber || ticket.id)}
                  </div>

                  <div class="assigned-ticket-bu">
                    ${formatBushels(ticket.netBushels)} bu
                  </div>

                </div>

                <div class="assigned-ticket-meta">

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

                  ${
                    ticket.deliveryLocationName
                      ? `
                          <span>
                            ${escapeHtml(ticket.deliveryLocationName)}
                          </span>
                        `
                      : ""
                  }

                  ${
                    ticket.driverName
                      ? `
                          <span>
                            ${escapeHtml(ticket.driverName)}
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
   CONTRACT DROP CARDS
============================================================ */

function renderContractDropCards(
  contracts,
  visibleTickets
) {
  const container =
    $("available-contract-list");

  if (
    !container
  ) {
    return;
  }

  container.innerHTML = "";


  if (
    !contracts.length
  ) {
    container.innerHTML = `
      <div class="empty-state">

        <div class="empty-title">
          No Matching Contracts
        </div>

        <div class="empty-sub">
          No contracts were found for this buyer and customer.
        </div>

      </div>
    `;

    return;
  }


  contracts.forEach(
    contract => {
      Object.assign(
        contract,
        calculateContractTotals(
          contract
        )
      );


      const selectedMatchingTickets =
        visibleTickets.filter(
          ticket =>
            state.selectedTicketIds
              .has(
                ticket.id
              ) &&

            normalized(
              ticket.crop
            ) ===
              normalized(
                contract.crop
              )
        );


      const allMatchingCropTickets =
        visibleTickets.filter(
          ticket =>
            normalized(
              ticket.crop
            ) ===
              normalized(
                contract.crop
              )
        );


      const card =
        document.createElement(
          "div"
        );

      card.className =
        `contract-drop-card ${
          getContractStatus(
            contract
          ) ===
            "over"
            ? "over-contract"
            : ""
        }`;

      card.dataset.contractId =
        contract.id;


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
            ${escapeHtml(getStatusLabel(contract))}
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
              ${
                contract.openBushels < 0
                  ? "Overhaul"
                  : "Remaining"
              }
            </div>

            <div
              class="contract-stat-value ${
                contract.openBushels < 0
                  ? "contract-over"
                  : ""
              }"
            >
              ${
                formatBushels(
                  contract.openBushels < 0
                    ? Math.abs(
                        contract.openBushels
                      )
                    : contract.openBushels
                )
              }
            </div>

          </div>


          <div class="contract-stat">

            <div class="contract-stat-label">
              Loads
            </div>

            <div class="contract-stat-value">
              ${numberValue(contract.loadCount).toLocaleString("en-US")}
            </div>

          </div>

        </div>


        ${assignedTicketMarkup(contract)}


        <div class="contract-actions">

          <button
            type="button"
            class="btn btn-primary btn-small assign-selected-btn"
            ${
              selectedMatchingTickets.length &&
              !state.busy
                ? ""
                : "disabled"
            }
          >
            Assign Selected (${selectedMatchingTickets.length})
          </button>

          <button
            type="button"
            class="btn btn-secondary btn-small assign-all-btn"
            ${
              allMatchingCropTickets.length &&
              !state.busy
                ? ""
                : "disabled"
            }
          >
            Assign All ${escapeHtml(contract.crop || "")}
            (${allMatchingCropTickets.length})
          </button>

        </div>


        <div class="contract-drop-helper">
          Drop a ${escapeHtml(contract.crop || "")} ticket here
        </div>
      `;


      /*
        ASSIGNED TICKET:
        click = details
        drag = move/unassign
      */

      card
        .querySelectorAll(
          "[data-assigned-ticket-id]"
        )
        .forEach(
          button => {
            button.addEventListener(
              "click",
              event => {
                event.stopPropagation();

                openTicketDetail(
                  button.dataset
                    .assignedTicketId
                );
              }
            );


            button.addEventListener(
              "dragstart",
              event => {
                if (
                  state.busy
                ) {
                  event.preventDefault();

                  return;
                }

                const ticketId =
                  button.dataset
                    .assignedTicketId;

                state.draggingTicketId =
                  ticketId;

                button.classList.add(
                  "dragging"
                );

                event.dataTransfer.effectAllowed =
                  "move";

                event.dataTransfer.setData(
                  "text/plain",
                  ticketId
                );
              }
            );


            button.addEventListener(
              "dragend",
              () => {
                state.draggingTicketId =
                  "";

                button.classList.remove(
                  "dragging"
                );

                $("unassigned-ticket-list")
                  ?.classList
                  .remove(
                    "drag-over-unassign"
                  );

                document
                  .querySelectorAll(
                    ".contract-drop-card.drag-over"
                  )
                  .forEach(
                    el =>
                      el.classList.remove(
                        "drag-over"
                      )
                  );
              }
            );
          }
        );


      /*
        ASSIGN SELECTED
      */

      card
        .querySelector(
          ".assign-selected-btn"
        )
        ?.addEventListener(
          "click",
          event => {
            event.stopPropagation();

            assignTicketsToContract(
              selectedMatchingTickets.map(
                ticket =>
                  ticket.id
              ),
              contract.id
            );
          }
        );


      /*
        ASSIGN ALL OF THIS CROP
      */

      card
        .querySelector(
          ".assign-all-btn"
        )
        ?.addEventListener(
          "click",
          event => {
            event.stopPropagation();

            assignTicketsToContract(
              allMatchingCropTickets.map(
                ticket =>
                  ticket.id
              ),
              contract.id
            );
          }
        );


      /*
        CONTRACT DROP VALIDATION

        A drop zone only activates when:
        - Buyer matches
        - Customer matches
        - Crop matches
        - Ticket is not already on this contract
      */

      card.addEventListener(
        "dragover",
        event => {
          if (
            state.busy
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
            !ticket
          ) {
            return;
          }

          if (
            clean(
              ticket.contractId
            ) ===
            clean(
              contract.id
            )
          ) {
            return;
          }

          if (
            clean(
              ticket.buyerId
            ) !==
            clean(
              contract.buyerId
            )
          ) {
            return;
          }

          if (
            clean(
              ticket.customerId
            ) !==
            clean(
              contract.customerId
            )
          ) {
            return;
          }

          if (
            normalized(
              ticket.crop
            ) !==
            normalized(
              contract.crop
            )
          ) {
            return;
          }

          event.preventDefault();

          event.dataTransfer.dropEffect =
            "move";

          card.classList.add(
            "drag-over"
          );
        }
      );


      card.addEventListener(
        "dragleave",
        event => {
          const related =
            event.relatedTarget;

          if (
            related &&
            card.contains(
              related
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

          const ticketId =
            event.dataTransfer.getData(
              "text/plain"
            ) ||
            state.draggingTicketId;

          if (
            !ticketId
          ) {
            return;
          }

          moveTicketToContract(
            ticketId,
            contract.id
          );
        }
      );


      container.appendChild(
        card
      );
    }
  );
}


/* ============================================================
   TICKET / CONTRACT VALIDATION
============================================================ */

function validateTicketAgainstContract(
  ticket,
  contract
) {
  if (
    !ticket ||
    !contract
  ) {
    return (
      "That grain ticket or contract could not be found."
    );
  }


  if (
    clean(
      ticket.buyerId
    ) !==
    clean(
      contract.buyerId
    )
  ) {
    return (
      "This ticket does not match the Buyer on that contract."
    );
  }


  if (
    clean(
      ticket.customerId
    ) !==
    clean(
      contract.customerId
    )
  ) {
    return (
      "This ticket does not match the Customer on that contract."
    );
  }


  if (
    normalized(
      ticket.crop
    ) !==
    normalized(
      contract.crop
    )
  ) {
    return (
      `Ticket ${
        ticket.ticketNumber ||
        ticket.id
      } is ${
        ticket.crop ||
        "a different crop"
      } and cannot be assigned to a ${
        contract.crop ||
        "different crop"
      } contract.`
    );
  }


  return "";
}


/* ============================================================
   MOVE TICKET TO ANOTHER CONTRACT
============================================================ */

async function moveTicketToContract(
  ticketId,
  targetContractId
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


  const errorMessage =
    validateTicketAgainstContract(
      ticket,
      contract
    );


  if (
    errorMessage
  ) {
    alert(
      errorMessage
    );

    return;
  }


  const oldContractId =
    clean(
      ticket.contractId
    );


  /*
    Dropped back on same contract.
    Nothing to do.
  */

  if (
    oldContractId ===
    clean(
      contract.id
    )
  ) {
    return;
  }


  const totals =
    calculateContractTotals(
      contract
    );


  const adding =
    numberValue(
      ticket.netBushels
    );


  const afterDelivered =
    totals.deliveredBushels +
    adding;


  const afterOpen =
    numberValue(
      contract.contractBushels
    ) -
    afterDelivered;


  /*
    Warn before creating overhaul.
  */

  if (
    afterOpen < 0
  ) {
    const confirmed =
      window.confirm(
        `Moving Ticket ${
          ticket.ticketNumber ||
          ticket.id
        } will put Contract ${
          contract.contractNumber ||
          contract.id
        } over by ${
          formatBushels(
            Math.abs(
              afterOpen
            )
          )
        } bushels.\n\nContinue?`
      );

    if (
      !confirmed
    ) {
      return;
    }
  }


  state.busy =
    true;

  renderReconciliation();


  try {
    /*
      Save new contract on ticket.
    */

    await updateDoc(
      doc(
        db,
        TICKET_COLLECTION,
        ticket.id
      ),
      {
        contractId:
          contract.id,

        contractNumber:
          contract.contractNumber ||
          null,

        contractAssignedAt:
          serverTimestamp(),

        updatedAt:
          serverTimestamp()
      }
    );


    /*
      Update local ticket before recalculating totals.
    */

    ticket.contractId =
      contract.id;

    ticket.contractNumber =
      contract.contractNumber ||
      "";


    state.selectedTicketIds
      .delete(
        ticket.id
      );


    /*
      Recalculate BOTH:
      old contract + new contract.
    */

    await syncContractTotalsForIds([
      oldContractId,
      contract.id
    ]);


    populateContractFilters();
  }
  catch (
    error
  ) {
    console.error(
      "[Grain Contracts] Ticket move failed:",
      error
    );

    alert(
      "The ticket could not be moved. FarmVista will reload the current Firestore data."
    );

    state.busy =
      false;

    await refreshData();

    return;
  }
  finally {
    state.busy =
      false;

    state.draggingTicketId =
      "";

    renderAll();
  }
}


/* ============================================================
   UNASSIGN TICKET
============================================================ */

async function unassignTicketFromContract(
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


  if (
    !ticket
  ) {
    return;
  }


  const oldContractId =
    clean(
      ticket.contractId
    );


  if (
    !oldContractId
  ) {
    return;
  }


  /*
    Make sure we are only unassigning
    within the selected Buyer / Customer.
  */

  if (
    clean(
      ticket.buyerId
    ) !==
      clean(
        state.reconcileBuyerId
      ) ||

    clean(
      ticket.customerId
    ) !==
      clean(
        state.reconcileCustomerId
      )
  ) {
    alert(
      "That ticket does not belong to the Buyer and Customer currently selected."
    );

    return;
  }


  state.busy =
    true;

  renderReconciliation();


  try {
    /*
      Clear the ticket's contract.
    */

    await updateDoc(
      doc(
        db,
        TICKET_COLLECTION,
        ticket.id
      ),
      {
        contractId:
          null,

        contractNumber:
          null,

        contractAssignedAt:
          null,

        contractUnassignedAt:
          serverTimestamp(),

        updatedAt:
          serverTimestamp()
      }
    );


    /*
      Update local ticket.
    */

    ticket.contractId =
      "";

    ticket.contractNumber =
      "";


    state.selectedTicketIds
      .delete(
        ticket.id
      );


    /*
      Recalculate old contract.
    */

    await syncContractTotalsForIds([
      oldContractId
    ]);


    populateContractFilters();
  }
  catch (
    error
  ) {
    console.error(
      "[Grain Contracts] Ticket unassign failed:",
      error
    );

    alert(
      "The ticket could not be unassigned. FarmVista will reload the current Firestore data."
    );

    state.busy =
      false;

    await refreshData();

    return;
  }
  finally {
    state.busy =
      false;

    state.draggingTicketId =
      "";

    $("unassigned-ticket-list")
      ?.classList
      .remove(
        "drag-over-unassign"
      );

    renderAll();
  }
}


/* ============================================================
   ASSIGN UNASSIGNED TICKETS
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


  if (
    !contract
  ) {
    alert(
      "That grain contract could not be found."
    );

    return;
  }


  /*
    Bulk assign is only for currently
    unassigned tickets.
  */

  const tickets =
    ticketIds
      .map(
        ticketId =>
          state.tickets.find(
            item =>
              item.id ===
              ticketId
          )
      )
      .filter(Boolean)
      .filter(
        ticket =>
          !clean(
            ticket.contractId
          )
      );


  if (
    !tickets.length
  ) {
    return;
  }


  /*
    Every ticket must match:
    Buyer + Customer + Crop.
  */

  const invalid =
    tickets.find(
      ticket =>
        validateTicketAgainstContract(
          ticket,
          contract
        )
    );


  if (
    invalid
  ) {
    alert(
      validateTicketAgainstContract(
        invalid,
        contract
      )
    );

    return;
  }


  const totals =
    calculateContractTotals(
      contract
    );


  const addingBushels =
    tickets.reduce(
      (
        sum,
        ticket
      ) =>
        sum +
        numberValue(
          ticket.netBushels
        ),
      0
    );


  const afterDelivered =
    totals.deliveredBushels +
    addingBushels;


  const afterOpen =
    numberValue(
      contract.contractBushels
    ) -
    afterDelivered;


  if (
    afterOpen < 0
  ) {
    const confirmed =
      window.confirm(
        `This assignment will put Contract ${
          contract.contractNumber ||
          contract.id
        } over by ${
          formatBushels(
            Math.abs(
              afterOpen
            )
          )
        } bushels.\n\n` +

        `Contract: ${
          formatBushels(
            contract.contractBushels
          )
        } bu\n` +

        `Currently assigned: ${
          formatBushels(
            totals.deliveredBushels
          )
        } bu\n` +

        `Adding: ${
          formatBushels(
            addingBushels
          )
        } bu\n` +

        `After assignment: ${
          formatBushels(
            afterDelivered
          )
        } bu\n\n` +

        `Continue?`
      );

    if (
      !confirmed
    ) {
      return;
    }
  }


  state.busy =
    true;

  renderReconciliation();


  try {
    await Promise.all(
      tickets.map(
        ticket =>
          updateDoc(
            doc(
              db,
              TICKET_COLLECTION,
              ticket.id
            ),
            {
              contractId:
                contract.id,

              contractNumber:
                contract.contractNumber ||
                null,

              contractAssignedAt:
                serverTimestamp(),

              updatedAt:
                serverTimestamp()
            }
          )
      )
    );


    tickets.forEach(
      ticket => {
        ticket.contractId =
          contract.id;

        ticket.contractNumber =
          contract.contractNumber ||
          "";
      }
    );


    state.selectedTicketIds
      .clear();


    await syncContractTotalsForIds([
      contract.id
    ]);


    populateContractFilters();
  }
  catch (
    error
  ) {
    console.error(
      "[Grain Contracts] Ticket assignment failed:",
      error
    );

    alert(
      "The ticket assignment could not be saved. FarmVista will reload the current Firestore data."
    );

    state.busy =
      false;

    await refreshData();

    return;
  }
  finally {
    state.busy =
      false;

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
          !state.activeTicket
        ) {
          return;
        }

        window.location.href =
          `/Farm-vista/pages/grain/grain-ticket-detail.html?id=${
            encodeURIComponent(
              state.activeTicket.id
            )
          }`;
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

  if (
    !ticket
  ) {
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
      ticket.contractNumber
        ? `Assigned to Contract ${ticket.contractNumber}`
        : "Grain ticket details";


  $("detail-ticket-number")
    .textContent =
      clean(
        ticket.ticketNumber
      ) ||
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
      clean(
        ticket.contractNumber
      ) ||
      "—";


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
        ? `${formatBushels(ticket.grossBushels)} bu`
        : "—";


  $("detail-ticket-shrink-bu")
    .textContent =
      ticket.shrinkBushels !==
        undefined
        ? `${formatBushels(ticket.shrinkBushels)} bu`
        : "—";


  $("detail-ticket-net-bu")
    .textContent =
      `${formatBushels(ticket.netBushels)} bu`;


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

  state.busy =
    true;

  try {
    await loadAllData();

    rebuildContractTotalsFromTickets();

    populateAllPickers();
  }
  catch (
    error
  ) {
    console.error(
      "[Grain Contracts] Refresh failed:",
      error
    );

    alert(
      "Unable to refresh grain contracts."
    );
  }
  finally {
    state.busy =
      false;

    renderAll();
  }
}


/* ============================================================
   SETTLEMENT SHELL
============================================================ */

function renderSettlementShell() {
  const tbody =
    $("settlement-table-body");

  if (
    !tbody
  ) {
    return;
  }


  const candidates =
    state.contracts
      .filter(
        contract =>
          [
            "complete",
            "over"
          ].includes(
            getContractStatus(
              contract
            )
          )
      )
      .sort(
        compareContracts
      );


  if (
    !candidates.length
  ) {
    tbody.innerHTML = `
      <tr>

        <td colspan="8">

          <div class="empty-state">

            <div class="empty-title">
              No Completed Contracts Yet
            </div>

            <div class="empty-sub">
              Completed or overhauled contracts will appear here when settlement-sheet imports are wired.
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
   EDIT PICKERS
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


/* ============================================================
   EDIT MODAL SETUP
============================================================ */

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


/* ============================================================
   REBUILD STATIC EDIT SELECT
============================================================ */

function rebuildEditStaticSelect(
  selectId,
  options,
  savedValue
) {
  const select =
    $(selectId);

  if (
    !select
  ) {
    return null;
  }

  /*
    Keep the original FarmVista <select>.
    Only rebuild its options.
    This prevents the duplicate-dropdown issue.
  */

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

  return select;
}


/* ============================================================
   OPEN EDIT MODAL
============================================================ */

function openEditModal(
  contractId
) {
  const contract =
    state.contracts.find(
      item =>
        clean(
          item.id
        ) ===
        clean(
          contractId
        )
    );

  if (
    !contract
  ) {
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
        clean(
          contract.contractNumber
        ) ||
        contract.id
      }`;


  /*
    BUYER
  */

  setSelectValue(
    $("edit-buyer"),
    contract.buyerId
  );


  if (
    !$("edit-buyer")
      ?.value &&
    contract.buyerName
  ) {
    const buyer =
      state.buyers.find(
        item =>
          normalized(
            item.name
          ) ===
          normalized(
            contract.buyerName
          )
      );

    if (
      buyer
    ) {
      setSelectValue(
        $("edit-buyer"),
        buyer.id
      );
    }
  }


  /*
    CUSTOMER
  */

  setSelectValue(
    $("edit-customer"),
    contract.customerId
  );


  if (
    !$("edit-customer")
      ?.value &&
    contract.customerName
  ) {
    const customer =
      state.customers.find(
        item =>
          normalized(
            item.name
          ) ===
          normalized(
            contract.customerName
          )
      );

    if (
      customer
    ) {
      setSelectValue(
        $("edit-customer"),
        customer.id
      );
    }
  }


  /*
    CROP
  */

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


  /*
    CONTRACT TYPE
  */

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
      clean(
        contract.contractNumber
      );


  $("edit-contract-date")
    .value =
      clean(
        contract.contractDate
      );


  setEditBushels(
    contract.contractBushels
  );


  setEditPrice(
    contract.pricePerBushel
  );


  populateLocationPicker(
    $("edit-buyer")
      .value ||
      contract.buyerId,

    contract.deliveryLocationId,

    contract
  );


  $("edit-delivery-start")
    .value =
      clean(
        contract.deliveryStart
      );


  $("edit-delivery-end")
    .value =
      clean(
        contract.deliveryEnd
      );


  $("edit-delivered")
    .value =
      formatBushels(
        contract.deliveredBushels
      );


  $("edit-notes")
    .value =
      clean(
        contract.notes
      );


  updateEditDateLimits();

  updateEditOpenBushels();


  $("edit-modal")
    .classList
    .add(
      "open"
    );


  document.body.style
    .overflow =
      "hidden";
}


/* ============================================================
   CLOSE EDIT MODAL
============================================================ */

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
    ? (
        `${location.locationName} — ` +
        `${address}`
      )
    : location.locationName;
}


function populateLocationPicker(
  buyerId,
  selectedLocationId = "",
  savedContract = null
) {
  const select =
    $("edit-delivery-location");

  if (
    !select
  ) {
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


  if (
    !buyerId
  ) {
    select.disabled =
      true;

    return;
  }


  select.disabled =
    false;


  const matching =
    state.deliveryLocations.filter(
      location =>
        clean(
          location.buyerId
        ) ===
        clean(
          buyerId
        )
    );


  matching.forEach(
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


  /*
    Exact ID first.
  */

  if (
    setSelectValue(
      select,
      selectedLocationId
    )
  ) {
    return;
  }


  if (
    !savedContract
  ) {
    return;
  }


  const wantedName =
    normalized(
      savedContract.deliveryLocationName
    );

  const wantedStreet =
    normalized(
      savedContract.deliveryStreet
    );

  const wantedCity =
    normalized(
      savedContract.deliveryCity
    );

  const wantedState =
    normalized(
      savedContract.deliveryState
    );

  const wantedZip =
    normalized(
      savedContract.deliveryZip
    );


  const location =
    matching.find(
      item =>
        wantedName &&
        normalized(
          item.locationName
        ) ===
          wantedName &&

        (
          !wantedStreet ||
          normalized(
            item.street
          ) ===
            wantedStreet
        ) &&

        (
          !wantedCity ||
          normalized(
            item.city
          ) ===
            wantedCity
        )
    ) ||

    matching.find(
      item =>
        wantedStreet &&
        normalized(
          item.street
        ) ===
          wantedStreet &&

        (
          !wantedCity ||
          normalized(
            item.city
          ) ===
            wantedCity
        ) &&

        (
          !wantedState ||
          normalized(
            item.state
          ) ===
            wantedState
        ) &&

        (
          !wantedZip ||
          normalized(
            item.zip
          ) ===
            wantedZip
        )
    ) ||

    matching.find(
      item =>
        wantedName &&
        normalized(
          item.locationName
        ) ===
          wantedName
    );


  if (
    location
  ) {
    setSelectValue(
      select,
      location.id
    );
  }
}


/* ============================================================
   EDIT BUSHELS
============================================================ */

function setupEditBushels() {
  const input =
    $("edit-contract-bushels");

  if (
    !input
  ) {
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


      if (
        !digits
      ) {
        input.value =
          "";

        input.dataset.rawValue =
          "";

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

  if (
    !input
  ) {
    return;
  }

  const numeric =
    numberValue(
      value
    );

  input.dataset.rawValue =
    String(
      numeric
    );

  input.value =
    numeric.toLocaleString(
      "en-US"
    );
}


/* ============================================================
   EDIT OPEN BUSHELS
============================================================ */

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
   EDIT PRICE
============================================================ */

function setupEditPrice() {
  const input =
    $("edit-price");

  if (
    !input
  ) {
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


      if (
        !digits
      ) {
        state.editPriceCents =
          0;

        state.editPriceHasValue =
          false;

        input.value =
          "";

        input.dataset.rawValue =
          "";

        input.setCustomValidity(
          ""
        );

        return;
      }


      state.editPriceCents =
        Number(
          digits
        );


      state.editPriceHasValue =
        true;


      renderEditPrice();
    }
  );


  input.addEventListener(
    "blur",
    validateEditPrice
  );
}


function setEditPrice(
  value
) {
  const numeric =
    numberValue(
      value
    );

  state.editPriceCents =
    Math.round(
      numeric *
      100
    );

  state.editPriceHasValue =
    numeric > 0;

  renderEditPrice();
}


function renderEditPrice() {
  const input =
    $("edit-price");

  if (
    !input
  ) {
    return;
  }


  if (
    !state.editPriceHasValue
  ) {
    input.value =
      "";

    input.dataset.rawValue =
      "";

    return;
  }


  const value =
    state.editPriceCents /
    100;


  input.value =
    value.toLocaleString(
      "en-US",
      {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }
    );


  input.dataset.rawValue =
    value.toFixed(
      2
    );


  validateEditPrice();
}


function validateEditPrice() {
  const input =
    $("edit-price");

  if (
    !input
  ) {
    return false;
  }


  input.setCustomValidity(
    ""
  );


  if (
    !state.editPriceHasValue
  ) {
    input.setCustomValidity(
      "Enter Price Per Bushel."
    );

    return false;
  }


  const value =
    state.editPriceCents /
    100;


  if (
    value < 2 ||
    value > 30
  ) {
    input.setCustomValidity(
      "Price Per Bushel must be between $2.00 and $30.00."
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
   SAVE CONTRACT CHANGES
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

  const saveBtn =
    $("save-edit-btn");


  validateEditPrice();

  validateEditDates();


  const contractBushels =
    numberValue(
      $("edit-contract-bushels")
        ?.dataset
        .rawValue
    );


  $("edit-contract-bushels")
    ?.setCustomValidity(
      contractBushels > 0
        ? ""
        : "Enter Contract Bushels."
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
    state.deliveryLocations.find(
      item =>
        item.id ===
        $("edit-delivery-location")
          .value
    );


  if (
    !buyer
  ) {
    alert(
      "Select Buyer / Elevator."
    );

    return;
  }


  if (
    !customer
  ) {
    alert(
      "Select Customer."
    );

    return;
  }


  if (
    !location
  ) {
    alert(
      "Select Delivery Location."
    );

    return;
  }


  const deliveredBushels =
    calculateContractTotals(
      state.activeContract
    ).deliveredBushels;


  const openBushels =
    contractBushels -
    deliveredBushels;


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

    pricePerBushel:
      state.editPriceCents /
      100,

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


  state.busy =
    true;


  saveBtn.disabled =
    true;


  saveBtn.textContent =
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


    renderAll();
  }
  catch (
    error
  ) {
    console.error(
      "[Grain Contracts] Update failed:",
      error
    );

    alert(
      "Unable to update grain contract."
    );
  }
  finally {
    state.busy =
      false;


    saveBtn.disabled =
      false;


    saveBtn.textContent =
      "Save Changes";
  }
}
