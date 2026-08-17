// /Farm-vista/js/grain-contracts.js
//
// FULL FILE
//
// FIX:
// - Edit Contract now restores ALL saved Firestore values.
// - Buyer restores by buyerId, with buyerName fallback.
// - Customer restores by customerId, with customerName fallback.
// - Crop restores safely.
// - Contract Type restores safely.
// - Delivery Location restores by deliveryLocationId, with saved
//   location/address fallback.
// - Existing contract totals, ticket assignment, drag/drop,
//   assigned ticket details, filters, and settlement shell retained.


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

const db =
  getFirestore();


/* ============================================================
   COLLECTIONS
============================================================ */

const CONTRACT_COLLECTION =
  "grain_contracts";

const BUYER_COLLECTION =
  "grain_buyers";

const CUSTOMER_COLLECTION =
  "grain_customers";

const LOCATION_COLLECTION =
  "grain_delivery_locations";

const TICKET_COLLECTION =
  "grain_tickets";


/* ============================================================
   HELPERS
============================================================ */

const $ =
  id =>
    document.getElementById(
      id
    );


function clean(
  value
) {

  return String(
    value ??
    ""
  )
    .trim();

}


function normalized(
  value
) {

  return clean(
    value
  )
    .toLowerCase();

}


function numberValue(
  value
) {

  const n =
    Number(
      value
    );


  return Number.isFinite(
    n
  )
    ? n
    : 0;

}


function formatBushels(
  value
) {

  return numberValue(
    value
  )
    .toLocaleString(
      "en-US",
      {
        minimumFractionDigits:
          0,

        maximumFractionDigits:
          2
      }
    );

}


function formatWholeNumber(
  value
) {

  const number =
    Number(
      value
    );


  if (
    !Number.isFinite(
      number
    )
  ) {

    return "—";

  }


  return Math.round(
    number
  )
    .toLocaleString(
      "en-US"
    );

}


function formatGrade(
  value,
  suffix = ""
) {

  if (
    value ===
      null ||
    value ===
      undefined ||
    value ===
      ""
  ) {

    return "—";

  }


  const number =
    Number(
      value
    );


  if (
    !Number.isFinite(
      number
    )
  ) {

    return clean(
      value
    ) ||
    "—";

  }


  return `${number.toFixed(2)}${suffix}`;

}


function formatPrice(
  value
) {

  return numberValue(
    value
  )
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


function escapeHtml(
  value
) {

  return String(
    value ??
    ""
  )
    .replaceAll(
      "&",
      "&amp;"
    )
    .replaceAll(
      "<",
      "&lt;"
    )
    .replaceAll(
      ">",
      "&gt;"
    )
    .replaceAll(
      '"',
      "&quot;"
    )
    .replaceAll(
      "'",
      "&#039;"
    );

}


function formatDate(
  iso
) {

  if (
    !iso
  ) {

    return "";

  }


  const parts =
    String(
      iso
    )
      .split(
        "-"
      );


  if (
    parts.length !==
    3
  ) {

    return String(
      iso
    );

  }


  return `${Number(parts[1])}/${Number(parts[2])}/${parts[0]}`;

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

    return `${formatDate(start)} – ${formatDate(end)}`;

  }


  return formatDate(
    start ||
    end
  );

}


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


function sortByName(
  items
) {

  items.sort(
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


function compareContracts(
  a,
  b
) {

  const aDate =
    clean(
      a.contractDate
    );


  const bDate =
    clean(
      b.contractDate
    );


  if (
    aDate !==
    bDate
  ) {

    return bDate.localeCompare(
      aDate
    );

  }


  return clean(
    a.contractNumber
  )
    .localeCompare(
      clean(
        b.contractNumber
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


function compareTickets(
  a,
  b
) {

  const dateCompare =
    clean(
      a.ticketDate
    )
      .localeCompare(
        clean(
          b.ticketDate
        )
      );


  if (
    dateCompare !==
    0
  ) {

    return dateCompare;

  }


  return clean(
    a.ticketNumber
  )
    .localeCompare(
      clean(
        b.ticketNumber
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


function addDays(
  isoDate,
  days
) {

  const parts =
    isoDate
      .split(
        "-"
      )
      .map(
        Number
      );


  const date =
    new Date(
      parts[0],
      parts[1] - 1,
      parts[2]
    );


  date.setDate(
    date.getDate() +
    days
  );


  const yyyy =
    date.getFullYear();


  const mm =
    String(
      date.getMonth() +
      1
    )
      .padStart(
        2,
        "0"
      );


  const dd =
    String(
      date.getDate()
    )
      .padStart(
        2,
        "0"
      );


  return `${yyyy}-${mm}-${dd}`;

}


/*
  Safely restore a select by its saved Firestore ID/value.
*/
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
    clean(
      value
    );


  if (
    !wanted
  ) {

    select.value =
      "";

    return false;

  }


  const option =
    [
      ...select.options
    ]
      .find(
        item =>
          clean(
            item.value
          ) ===
          wanted
      );


  if (
    !option
  ) {

    return false;

  }


  select.value =
    option.value;


  return true;

}


/*
  Fallback helper.

  If an old contract has a missing/bad ID but still has the saved
  Firestore name, locate the matching picker option by its name.
*/
function setObjectSelectByIdOrName(
  select,
  savedId,
  savedName,
  items
) {

  if (
    setSelectValue(
      select,
      savedId
    )
  ) {

    return clean(
      select.value
    );

  }


  const wantedName =
    normalized(
      savedName
    );


  if (
    !wantedName
  ) {

    select.value =
      "";

    return "";

  }


  const match =
    items.find(
      item =>
        normalized(
          item.name
        ) ===
        wantedName
    );


  if (
    !match
  ) {

    select.value =
      "";

    return "";

  }


  setSelectValue(
    select,
    match.id
  );


  return match.id;

}


/*
  Crop and Contract Type are static dropdowns.

  This restores them case-insensitively so Firestore values such
  as "Corn" and "Cash" always match the HTML option.
*/
function setStaticSelectValue(
  select,
  savedValue
) {

  if (
    !select
  ) {

    return false;

  }


  const wanted =
    normalized(
      savedValue
    );


  if (
    !wanted
  ) {

    select.value =
      "";

    return false;

  }


  const option =
    [
      ...select.options
    ]
      .find(
        item =>
          normalized(
            item.value
          ) ===
          wanted
      );


  if (
    !option
  ) {

    select.value =
      "";

    return false;

  }


  select.value =
    option.value;


  return true;

}

function forceSelectValue(
  select,
  savedValue
) {

  if (
    !select
  ) {

    return false;

  }


  const wanted =
    clean(
      savedValue
    );


  if (
    !wanted
  ) {

    select.selectedIndex =
      0;

    return false;

  }


  const options =
    [
      ...select.options
    ];


  let index =
    options.findIndex(
      option =>
        clean(
          option.value
        ).toLowerCase() ===
        wanted.toLowerCase()
    );


  if (
    index ===
    -1
  ) {

    index =
      options.findIndex(
        option =>
          clean(
            option.textContent
          ).toLowerCase() ===
          wanted.toLowerCase()
      );

  }


  if (
    index ===
    -1
  ) {

    console.warn(
      "[Grain Contracts] Could not restore select:",
      select.id,
      "saved value:",
      savedValue
    );


    return false;

  }


  select.selectedIndex =
    index;


  options.forEach(
    (
      option,
      optionIndex
    ) => {

      option.selected =
        optionIndex ===
        index;

    }
  );


  return true;

}


/* ============================================================
   STATE
============================================================ */

const state = {

  contracts:
    [],

  filteredContracts:
    [],

  buyers:
    [],

  customers:
    [],

  deliveryLocations:
    [],

  tickets:
    [],

  activeContract:
    null,

  activeTicket:
    null,

  reconcileBuyerId:
    "",

  reconcileCustomerId:
    "",

  selectedTicketIds:
    new Set(),

  draggingTicketId:
    null,

  editPriceCents:
    0,

  editPriceHasValue:
    false,

  busy:
    false

};


/* ============================================================
   START
============================================================ */

function onReady(
  fn
) {

  if (
    document.readyState ===
    "loading"
  ) {

    document.addEventListener(
      "DOMContentLoaded",
      fn,
      {
        once:
          true
      }
    );

  }
  else {

    fn();

  }

}


onReady(
  async function() {

    setupFilters();

    setupReconciliationControls();

    setupModal();

    setupTicketDetailModal();

    setupEditBushels();

    setupEditPrice();

    setupEditDates();


    try {

      await loadAllData();


      rebuildContractTotalsFromTickets(
        false
      );


      populateAllPickers();


      renderAll();

    }
    catch (
      err
    ) {

      console.error(
        "[Grain Contracts] Initial load failed:",
        err
      );


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
);


/* ============================================================
   LOAD DATA
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
        docSnapshot => {

          const data =
            docSnapshot.data() ||
            {};


          return {

            id:
              docSnapshot.id,

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
        docSnapshot => {

          const data =
            docSnapshot.data() ||
            {};


          return {

            id:
              docSnapshot.id,

            name:
              clean(
                data.name
              )

          };

        }
      )
      .filter(
        item =>
          item.name
      );


  state.customers =
    customerSnapshot.docs
      .map(
        docSnapshot => {

          const data =
            docSnapshot.data() ||
            {};


          return {

            id:
              docSnapshot.id,

            name:
              clean(
                data.name
              )

          };

        }
      )
      .filter(
        item =>
          item.name
      );


  state.deliveryLocations =
    locationSnapshot.docs
      .map(
        docSnapshot => {

          const data =
            docSnapshot.data() ||
            {};


          return {

            id:
              docSnapshot.id,

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
    ticketSnapshot.docs
      .map(
        docSnapshot => {

          const data =
            docSnapshot.data() ||
            {};


          return {

            id:
              docSnapshot.id,

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
      )
        .localeCompare(
          clean(
            b.locationName
          )
        )
  );

}


/* ============================================================
   CONTRACT TOTALS FROM TICKETS
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
        total,
        ticket
      ) =>
        total +
        numberValue(
          ticket.netBushels
        ),
      0
    );


  const contractBushels =
    numberValue(
      contract.contractBushels
    );


  const openBushels =
    contractBushels -
    deliveredBushels;


  const overhaulBushels =
    Math.max(
      0,
      deliveredBushels -
      contractBushels
    );


  return {

    deliveredBushels,

    openBushels,

    overhaulBushels,

    loadCount:
      assigned.length

  };

}


function rebuildContractTotalsFromTickets(
  writeToFirestore =
    false
) {

  state.contracts.forEach(
    contract => {

      const totals =
        calculateContractTotals(
          contract
        );


      contract.deliveredBushels =
        totals.deliveredBushels;


      contract.openBushels =
        totals.openBushels;


      contract.loadCount =
        totals.loadCount;


      contract.overhaulBushels =
        totals.overhaulBushels;

    }
  );


  if (
    writeToFirestore
  ) {

    return syncAllContractTotals();

  }


  return Promise.resolve();

}


async function syncAllContractTotals() {

  await Promise.all(

    state.contracts.map(
      contract => {

        return updateDoc(
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
    open <
    0
  ) {

    return "over";

  }


  if (
    open ===
      0 &&
    contracted >
      0
  ) {

    return "complete";

  }


  if (
    contracted >
      0 &&
    open >
      0 &&
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

  const status =
    getContractStatus(
      contract
    );


  if (
    status ===
    "over"
  ) {

    return "Overhauled";

  }


  if (
    status ===
    "complete"
  ) {

    return "Completed";

  }


  if (
    status ===
    "near"
  ) {

    return "Near Full";

  }


  return "Open";

}


function getStatusClass(
  contract
) {

  return `status-${getContractStatus(contract)}`;

}


/* ============================================================
   FILTERS
============================================================ */

function setupFilters() {

  [
    "search-filter",
    "status-filter",
    "crop-filter",
    "buyer-filter",
    "customer-filter"
  ]
    .forEach(
      id => {

        const element =
          $(
            id
          );


        if (
          !element
        ) {

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


  const firstOption =
    select.options[0]
      ? select.options[0]
          .cloneNode(
            true
          )
      : null;


  select.innerHTML =
    "";


  if (
    firstOption
  ) {

    select.appendChild(
      firstOption
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
    ]
      .some(
        option =>
          option.value ===
          current
      )
  ) {

    select.value =
      current;

  }

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
    state.contracts
      .filter(
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
                .join(
                  " "
                )
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
   RENDER CONTRACTS
============================================================ */

function renderAll() {

  applyContractFilters();

  renderReconciliation();

  renderSettlementShell();

}


function renderContracts() {

  renderContractSummary();

  renderContractTable();

}


function renderContractSummary() {

  let contracted =
    0;

  let delivered =
    0;

  let open =
    0;

  let over =
    0;


  state.filteredContracts.forEach(
    contract => {

      contracted +=
        numberValue(
          contract.contractBushels
        );


      delivered +=
        numberValue(
          contract.deliveredBushels
        );


      open +=
        Math.max(
          0,
          numberValue(
            contract.openBushels
          )
        );


      over +=
        Math.max(
          0,
          -numberValue(
            contract.openBushels
          )
        );

    }
  );


  $("summary-contracts")
    .textContent =
      state.filteredContracts
        .length
        .toLocaleString(
          "en-US"
        );


  $("summary-contracted")
    .textContent =
      formatBushels(
        contracted
      );


  $("summary-delivered")
    .textContent =
      formatBushels(
        delivered
      );


  $("summary-open")
    .textContent =
      formatBushels(
        open
      );


  $("summary-over")
    .textContent =
      formatBushels(
        over
      );

}


function renderContractTable() {

  const tbody =
    $("contracts-table-body");


  tbody.innerHTML =
    "";


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


  state.filteredContracts.forEach(
    contract => {

      const row =
        document.createElement(
          "tr"
        );


      row.className =
        "contract-row";


      row.tabIndex =
        0;


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
            ) <
              0
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
   OBJECT SELECTS
============================================================ */

function populateObjectSelect(
  select,
  items,
  placeholder
) {

  if (
    !select
  ) {

    return;

  }


  const current =
    select.value;


  select.innerHTML =
    "";


  const blank =
    document.createElement(
      "option"
    );


  blank.value =
    "";


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
    current
  );

}


/* ============================================================
   RECONCILIATION PICKERS
============================================================ */

function populateReconciliationPickers() {

  populateObjectSelect(
    $("reconcile-buyer"),
    state.buyers,
    "Select Buyer"
  );


  populateObjectSelect(
    $("reconcile-customer"),
    state.customers,
    "Select Customer"
  );

}


/* ============================================================
   RECONCILIATION EVENTS
============================================================ */

function setupReconciliationControls() {

  $("reconcile-buyer")
    ?.addEventListener(
      "change",
      function() {

        state.reconcileBuyerId =
          this.value;


        state.selectedTicketIds
          .clear();


        renderReconciliation();

      }
    );


  $("reconcile-customer")
    ?.addEventListener(
      "change",
      function() {

        state.reconcileCustomerId =
          this.value;


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
      function() {

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


  return state.tickets
    .filter(
      ticket => {

        return (
          ticket.buyerId ===
            state.reconcileBuyerId &&

          ticket.customerId ===
            state.reconcileCustomerId &&

          !clean(
            ticket.contractId
          )
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


  return state.contracts
    .filter(
      contract => {

        return (
          clean(
            contract.buyerId
          ) ===
            state.reconcileBuyerId &&

          clean(
            contract.customerId
          ) ===
            state.reconcileCustomerId
        );

      }
    )
    .sort(
      compareContracts
    );

}


function selectAllVisibleTickets() {

  const tickets =
    getVisibleUnassignedTickets();


  state.selectedTicketIds
    .clear();


  tickets.forEach(
    ticket => {

      state.selectedTicketIds
        .add(
          ticket.id
        );

    }
  );


  renderReconciliation();

}


/* ============================================================
   RENDER RECONCILIATION
============================================================ */

function renderReconciliation() {

  const ready =
    reconciliationReady();


  const message =
    $("reconcile-filter-message");


  const selectAllBtn =
    $("select-all-tickets-btn");


  const clearBtn =
    $("clear-ticket-selection-btn");


  const refreshBtn =
    $("refresh-reconciliation-btn");


  selectAllBtn.disabled =
    !ready;


  clearBtn.disabled =
    !ready ||
    state.selectedTicketIds
      .size ===
      0;


  refreshBtn.disabled =
    !ready;


  if (
    !ready
  ) {

    message.classList
      .remove(
        "ready"
      );


    message.textContent =
      "Select Buyer and Customer to begin assigning tickets.";


    $("selection-count")
      .textContent =
        "0 selected";


    $("unassigned-count")
      .textContent =
        "0 tickets";


    $("available-contract-count")
      .textContent =
        "0 contracts";


    $("unassigned-ticket-list")
      .innerHTML = `

        <div class="empty-state">
          <div class="empty-title">
            Select Buyer and Customer
          </div>

          <div class="empty-sub">
            Unassigned tickets will appear here after both filters are selected.
          </div>
        </div>

      `;


    $("available-contract-list")
      .innerHTML = `

        <div class="empty-state">
          <div class="empty-title">
            Select Buyer and Customer
          </div>

          <div class="empty-sub">
            Matching contracts will appear here after both filters are selected.
          </div>
        </div>

      `;


    return;

  }


  message.classList
    .add(
      "ready"
    );


  message.textContent =
    "Ready — drag tickets to a contract or use the assignment buttons.";


  const tickets =
    getVisibleUnassignedTickets();


  const contracts =
    getAvailableContracts();


  for (
    const ticketId
    of
    [
      ...state.selectedTicketIds
    ]
  ) {

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


  $("selection-count")
    .textContent =
      `${state.selectedTicketIds.size} selected`;


  $("unassigned-count")
    .textContent =
      `${tickets.length} ${
        tickets.length ===
          1
          ? "ticket"
          : "tickets"
      }`;


  $("available-contract-count")
    .textContent =
      `${contracts.length} ${
        contracts.length ===
          1
          ? "contract"
          : "contracts"
      }`;


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


  container.innerHTML =
    "";


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


      const checked =
        state.selectedTicketIds
          .has(
            ticket.id
          );


      card.innerHTML = `

        <input
          class="ticket-select"
          type="checkbox"
          ${checked ? "checked" : ""}
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
              ${escapeHtml(
                ticket.ticketDate
                  ? formatDate(
                      ticket.ticketDate
                    )
                  : "No date"
              )}
            </span>

            <span>
              ${escapeHtml(ticket.crop || "No crop")}
            </span>

            <span>
              ${escapeHtml(ticket.deliveryLocationName || "")}
            </span>

            <span>
              ${escapeHtml(ticket.driverName || "")}
            </span>

          </div>

        </div>

      `;


      const checkbox =
        card.querySelector(
          ".ticket-select"
        );


      checkbox.addEventListener(
        "change",
        function() {

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


          $("selection-count")
            .textContent =
              `${state.selectedTicketIds.size} selected`;


          $("clear-ticket-selection-btn")
            .disabled =
              state.selectedTicketIds
                .size ===
                0;


          renderContractDropCards(
            getAvailableContracts(),
            getVisibleUnassignedTickets()
          );

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


          card.classList
            .add(
              "dragging"
            );


          event.dataTransfer
            .effectAllowed =
              "move";


          event.dataTransfer
            .setData(
              "text/plain",
              ticket.id
            );

        }
      );


      card.addEventListener(
        "dragend",
        () => {

          state.draggingTicketId =
            null;


          card.classList
            .remove(
              "dragging"
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
   ASSIGNED TICKET HTML
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


  const rows =
    assigned
      .map(
        ticket => {

          const date =
            ticket.ticketDate
              ? formatDate(
                  ticket.ticketDate
                )
              : "No date";


          const location =
            clean(
              ticket.deliveryLocationName ||
              ticket.buyerName
            );


          const driver =
            clean(
              ticket.driverName
            );


          return `

            <button
              type="button"
              class="assigned-ticket-item"
              data-assigned-ticket-id="${escapeHtml(ticket.id)}"
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
                  ${escapeHtml(date)}
                </span>

                ${
                  location
                    ? `
                      <span>
                        ${escapeHtml(location)}
                      </span>
                    `
                    : ""
                }

                ${
                  driver
                    ? `
                      <span>
                        ${escapeHtml(driver)}
                      </span>
                    `
                    : ""
                }

              </div>

            </button>

          `;

        }
      )
      .join(
        ""
      );


  return `

    <div class="assigned-ticket-section">

      <div class="assigned-ticket-head">

        <div class="assigned-ticket-title">
          Assigned Tickets
        </div>

        <div class="assigned-ticket-count">
          ${assigned.length} ${
            assigned.length ===
              1
              ? "ticket"
              : "tickets"
          }
        </div>

      </div>

      <div class="assigned-ticket-list">
        ${rows}
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


  container.innerHTML =
    "";


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

      const totals =
        calculateContractTotals(
          contract
        );


      Object.assign(
        contract,
        totals
      );


      const status =
        getContractStatus(
          contract
        );


      const selectedMatchingTickets =
        visibleTickets
          .filter(
            ticket => {

              return (
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

            }
          );


      const allMatchingCropTickets =
        visibleTickets
          .filter(
            ticket => {

              return (
                normalized(
                  ticket.crop
                ) ===
                normalized(
                  contract.crop
                )
              );

            }
          );


      const card =
        document.createElement(
          "div"
        );


      card.className =
        `contract-drop-card ${
          status ===
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
                contract.openBushels <
                  0
                  ? "Overhaul"
                  : "Remaining"
              }
            </div>

            <div
              class="contract-stat-value ${
                contract.openBushels <
                  0
                  ? "contract-over"
                  : ""
              }"
            >
              ${formatBushels(
                contract.openBushels <
                  0
                  ? Math.abs(
                      contract.openBushels
                    )
                  : contract.openBushels
              )}
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
              selectedMatchingTickets.length
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
              allMatchingCropTickets.length
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

          }
        );


      const selectedBtn =
        card.querySelector(
          ".assign-selected-btn"
        );


      selectedBtn.addEventListener(
        "click",
        event => {

          event.stopPropagation();


          assignTicketsToContract(
            selectedMatchingTickets
              .map(
                ticket =>
                  ticket.id
              ),
            contract.id
          );

        }
      );


      const allBtn =
        card.querySelector(
          ".assign-all-btn"
        );


      allBtn.addEventListener(
        "click",
        event => {

          event.stopPropagation();


          assignTicketsToContract(
            allMatchingCropTickets
              .map(
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


          event.dataTransfer
            .dropEffect =
              "move";


          card.classList
            .add(
              "drag-over"
            );

        }
      );


      card.addEventListener(
        "dragleave",
        () => {

          card.classList
            .remove(
              "drag-over"
            );

        }
      );


      card.addEventListener(
        "drop",
        event => {

          event.preventDefault();


          card.classList
            .remove(
              "drag-over"
            );


          const ticketId =
            event.dataTransfer
              .getData(
                "text/plain"
              ) ||
            state.draggingTicketId;


          if (
            !ticketId
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


          if (
            normalized(
              ticket.crop
            ) !==
            normalized(
              contract.crop
            )
          ) {

            alert(
              `This is a ${
                ticket.crop ||
                "different crop"
              } ticket. It cannot be assigned to a ${
                contract.crop ||
                "different crop"
              } contract.`
            );


            return;

          }


          assignTicketsToContract(
            [
              ticketId
            ],
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
      function() {

        if (
          !state.activeTicket
        ) {

          return;

        }


        window.location.href =
          `/Farm-vista/pages/grain/grain-ticket-detail.html?id=${encodeURIComponent(
            state.activeTicket.id
          )}`;

      }
    );


  document.addEventListener(
    "keydown",
    event => {

      if (
        event.key !==
        "Escape"
      ) {

        return;

      }


      if (
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
        : "Assigned grain ticket";


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
   ASSIGN TICKETS
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
      .filter(
        Boolean
      )
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


  const invalidTicket =
    tickets.find(
      ticket => {

        return (
          ticket.buyerId !==
            clean(
              contract.buyerId
            ) ||

          ticket.customerId !==
            clean(
              contract.customerId
            )
        );

      }
    );


  if (
    invalidTicket
  ) {

    alert(
      "One or more selected tickets do not match this contract's Buyer and Customer."
    );


    return;

  }


  const cropMismatch =
    tickets.find(
      ticket => {

        return (
          normalized(
            ticket.crop
          ) !==
          normalized(
            contract.crop
          )
        );

      }
    );


  if (
    cropMismatch
  ) {

    alert(
      `Ticket ${
        cropMismatch.ticketNumber ||
        cropMismatch.id
      } is ${
        cropMismatch.crop ||
        "a different crop"
      } and cannot be assigned to this ${
        contract.crop ||
        ""
      } contract.`
    );


    return;

  }


  const currentTotals =
    calculateContractTotals(
      contract
    );


  const addingBushels =
    tickets.reduce(
      (
        total,
        ticket
      ) => {

        return total +
          numberValue(
            ticket.netBushels
          );

      },
      0
    );


  const afterDelivered =
    currentTotals.deliveredBushels +
    addingBushels;


  const afterOpen =
    numberValue(
      contract.contractBushels
    ) -
    afterDelivered;


  if (
    afterOpen <
    0
  ) {

    const overhaul =
      Math.abs(
        afterOpen
      );


    const confirmed =
      window.confirm(
        `This assignment will put Contract ${
          contract.contractNumber ||
          contract.id
        } over by ${
          formatBushels(
            overhaul
          )
        } bushels.\n\n` +

        `Contract: ${
          formatBushels(
            contract.contractBushels
          )
        } bu\n` +

        `Currently assigned: ${
          formatBushels(
            currentTotals.deliveredBushels
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

        `Continue and record the overhaul?`
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
        ticket => {

          return updateDoc(
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

        }
      )

    );


    const resultingDelivered =
      currentTotals.deliveredBushels +
      addingBushels;


    const resultingOpen =
      numberValue(
        contract.contractBushels
      ) -
      resultingDelivered;


    await updateDoc(
      doc(
        db,
        CONTRACT_COLLECTION,
        contract.id
      ),
      {

        deliveredBushels:
          resultingDelivered,

        openBushels:
          resultingOpen,

        updatedAt:
          serverTimestamp()

      }
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


    await rebuildContractTotalsFromTickets(
      false
    );


    populateContractFilters();


    renderAll();

  }
  catch (
    error
  ) {

    console.error(
      "[Grain Contracts] Ticket assignment failed:",
      error
    );


    alert(
      "The ticket assignment could not be saved. The page will refresh the Firestore data."
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


    rebuildContractTotalsFromTickets(
      false
    );


    populateAllPickers();


    renderAll();

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

  const candidates =
    state.contracts
      .filter(
        contract => {

          const status =
            getContractStatus(
              contract
            );


          return (
            status ===
              "complete" ||
            status ===
              "over"
          );

        }
      )
      .sort(
        compareContracts
      );


  const tbody =
    $("settlement-table-body");


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
              Completed or overhauled contracts will appear here when we wire settlement-sheet imports.
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
        contract => {

          return `

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

          `;

        }
      )
      .join(
        ""
      );

}


/* ============================================================
   EDIT MODAL PICKERS
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
   CONTRACT EDIT MODAL
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
      function() {

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
   OPEN / CLOSE CONTRACT EDIT MODAL

   IMPORTANT:
   Rebuild the dynamic dropdowns FIRST, then restore Firestore
   values AFTER their options exist.
============================================================ */

function openEditModal(
  contractId
) {

  /*
    Find the EXACT contract that was clicked.
  */
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

    console.error(
      "[Grain Contracts] Contract not found:",
      contractId
    );

    return;

  }


  /*
    IMPORTANT:
    Make this contract the active contract FIRST.
  */
  state.activeContract =
    contract;


  /*
    Recalculate assigned/open totals.
  */
  const totals =
    calculateContractTotals(
      contract
    );


  contract.deliveredBushels =
    totals.deliveredBushels;


  contract.openBushels =
    totals.openBushels;


  contract.loadCount =
    totals.loadCount;


  contract.overhaulBushels =
    totals.overhaulBushels;


  /*
    ============================================================
    COMPLETELY RESET THE EDIT FORM

    This prevents Crop / Contract Type / other selections from
    carrying over from the previously opened contract.
    ============================================================
  */

  $("edit-contract-form")
    ?.reset();


  $("edit-buyer")
    .value =
      "";


  $("edit-customer")
    .value =
      "";


  $("edit-crop")
    .value =
      "";


  $("edit-contract-type")
    .value =
      "";


  $("edit-delivery-location")
    .innerHTML =
      "";


  /*
    ============================================================
    REBUILD BUYER + CUSTOMER OPTIONS
    ============================================================
  */

  populateEditPickers();


  /*
    ============================================================
    HEADER
    ============================================================
  */

  $("edit-modal-sub")
    .textContent =
      `Contract ${
        clean(
          contract.contractNumber
        ) ||
        contract.id
      }`;


  /*
    ============================================================
    BUYER
    Pull directly from THIS contract.
    ============================================================
  */

  const buyer =
    state.buyers.find(
      item => {

        return (
          clean(
            item.id
          ) ===
          clean(
            contract.buyerId
          )
        );

      }
    ) ||
    state.buyers.find(
      item => {

        return (
          normalized(
            item.name
          ) ===
          normalized(
            contract.buyerName
          )
        );

      }
    );


  if (
    buyer
  ) {

    $("edit-buyer")
      .value =
        buyer.id;

  }
  else {

    $("edit-buyer")
      .value =
        "";

  }


  /*
    ============================================================
    CUSTOMER
    Pull directly from THIS contract.
    ============================================================
  */

  const customer =
    state.customers.find(
      item => {

        return (
          clean(
            item.id
          ) ===
          clean(
            contract.customerId
          )
        );

      }
    ) ||
    state.customers.find(
      item => {

        return (
          normalized(
            item.name
          ) ===
          normalized(
            contract.customerName
          )
        );

      }
    );


  if (
    customer
  ) {

    $("edit-customer")
      .value =
        customer.id;

  }
  else {

    $("edit-customer")
      .value =
        "";

  }


  /*
    ============================================================
    CROP
    Pull directly from Firestore contract data.

    Example:
    crop = "Corn"
    ============================================================
  */

  /*
    ============================================================
    CROP + CONTRACT TYPE

    These values are already loaded from Firestore into
    contract.crop and contract.contractType.

    Set the native select value AND fire input/change events so
    FarmVista's select UI updates its visible selected value.
    ============================================================
  */

  const cropSelect =
    $("edit-crop");


  const contractTypeSelect =
    $("edit-contract-type");


  /*
    CROP
  */
  cropSelect.value =
    clean(
      contract.crop
    );


  /*
    If casing/spacing ever differs, find the matching option.
  */
  if (
    cropSelect.value !==
    clean(
      contract.crop
    )
  ) {

    const cropMatch =
      [
        ...cropSelect.options
      ]
        .find(
          option =>
            normalized(
              option.value
            ) ===
            normalized(
              contract.crop
            )
        );


    cropSelect.value =
      cropMatch
        ? cropMatch.value
        : "";

  }


  /*
    Tell any FarmVista/custom select handling that the value
    changed programmatically.
  */
  cropSelect.dispatchEvent(
    new Event(
      "input",
      {
        bubbles:
          true
      }
    )
  );


  cropSelect.dispatchEvent(
    new Event(
      "change",
      {
        bubbles:
          true
      }
    )
  );


  /*
    CONTRACT TYPE
  */
  contractTypeSelect.value =
    clean(
      contract.contractType
    );


  if (
    contractTypeSelect.value !==
    clean(
      contract.contractType
    )
  ) {

    const typeMatch =
      [
        ...contractTypeSelect.options
      ]
        .find(
          option =>
            normalized(
              option.value
            ) ===
            normalized(
              contract.contractType
            )
        );


    contractTypeSelect.value =
      typeMatch
        ? typeMatch.value
        : "";

  }


  contractTypeSelect.dispatchEvent(
    new Event(
      "input",
      {
        bubbles:
          true
      }
    )
  );


  contractTypeSelect.dispatchEvent(
    new Event(
      "change",
      {
        bubbles:
          true
      }
    )
  );


  /*
    ============================================================
    CONTRACT NUMBER
    ============================================================
  */

  $("edit-contract-number")
    .value =
      clean(
        contract.contractNumber
      );


  /*
    ============================================================
    CONTRACT DATE
    ============================================================
  */

  $("edit-contract-date")
    .value =
      clean(
        contract.contractDate
      );


  /*
    ============================================================
    CONTRACT BUSHELS
    ============================================================
  */

  setEditBushels(
    contract.contractBushels
  );


  /*
    ============================================================
    PRICE
    ============================================================
  */

  setEditPrice(
    contract.pricePerBushel
  );


  /*
    ============================================================
    DELIVERY LOCATION

    First rebuild locations for THIS contract's buyer.
    Then select THIS contract's saved location.
    ============================================================
  */

  populateLocationPicker(
    buyer
      ? buyer.id
      : clean(
          contract.buyerId
        ),
    clean(
      contract.deliveryLocationId
    ),
    contract
  );


  /*
    ============================================================
    DELIVERY DATES
    ============================================================
  */

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


  /*
    ============================================================
    ASSIGNED BUSHELS
    ============================================================
  */

  $("edit-delivered")
    .value =
      formatBushels(
        contract.deliveredBushels
      );


  /*
    ============================================================
    NOTES
    ============================================================
  */

  $("edit-notes")
    .value =
      clean(
        contract.notes
      );


  /*
    ============================================================
    DATE LIMITS + OPEN BUSHELS
    ============================================================
  */

  updateEditDateLimits();


  updateEditOpenBushels();


  /*
    Debugging line.

    This proves which contract values are being loaded into the
    modal each time a row is clicked.
  */
  console.log(
    "[Grain Contracts] Opening contract:",
    {
      id:
        contract.id,

      contractNumber:
        contract.contractNumber,

      buyerId:
        contract.buyerId,

      buyerName:
        contract.buyerName,

      customerId:
        contract.customerId,

      customerName:
        contract.customerName,

      crop:
        contract.crop,

      contractType:
        contract.contractType,

      deliveryLocationId:
        contract.deliveryLocationId
    }
  );


  /*
    ============================================================
    OPEN MODAL LAST
    ============================================================
  */

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


  document.body.style
    .overflow =
      "";


  state.activeContract =
    null;

}


/* ============================================================
   LOCATION PICKER
============================================================ */

function populateLocationPicker(
  buyerId,
  selectedLocationId =
    "",
  savedContract =
    null
) {

  const select =
    $("edit-delivery-location");


  if (
    !select
  ) {

    return;

  }


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


  const matchingLocations =
    state.deliveryLocations
      .filter(
        location =>
          clean(
            location.buyerId
          ) ===
          clean(
            buyerId
          )
      );


  matchingLocations
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


  /*
    First choice: exact saved Firestore document ID.
  */
  if (
    setSelectValue(
      select,
      selectedLocationId
    )
  ) {

    return;

  }


  /*
    Fallback for older/broken IDs:
    match the saved location name/address.
  */
  if (
    !savedContract
  ) {

    return;

  }


  const wantedName =
    normalized(
      savedContract
        .deliveryLocationName
    );


  const wantedStreet =
    normalized(
      savedContract
        .deliveryStreet
    );


  const wantedCity =
    normalized(
      savedContract
        .deliveryCity
    );


  const wantedState =
    normalized(
      savedContract
        .deliveryState
    );


  const wantedZip =
    normalized(
      savedContract
        .deliveryZip
    );


  let location =
    matchingLocations.find(
      item => {

        return (
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
        );

      }
    );


  if (
    !location
  ) {

    location =
      matchingLocations.find(
        item => {

          return (
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
          );

        }
      );

  }


  if (
    !location &&
    wantedName
  ) {

    location =
      matchingLocations.find(
        item =>
          normalized(
            item.locationName
          ) ===
          wantedName
      );

  }


  if (
    location
  ) {

    setSelectValue(
      select,
      location.id
    );

  }

}


function formatLocationOption(
  location
) {

  const cityState =
    [
      location.city,
      location.state
    ]
      .filter(
        Boolean
      )
      .join(
        ", "
      );


  const address =
    [
      location.street,
      cityState,
      location.zip
    ]
      .filter(
        Boolean
      )
      .join(
        " • "
      );


  if (
    !address
  ) {

    return location.locationName;

  }


  return `${location.locationName} — ${address}`;

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
    function() {

      const digits =
        String(
          input.value ||
          ""
        )
          .replace(
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


  $("edit-open")
    .value =
      formatBushels(
        open
      );


  $("modal-contracted")
    .textContent =
      formatBushels(
        contracted
      );


  $("modal-delivered")
    .textContent =
      formatBushels(
        delivered
      );


  $("modal-open")
    .textContent =
      formatBushels(
        open
      );

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
    function() {

      const digits =
        String(
          input.value ||
          ""
        )
          .replace(
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

  const input =
    $("edit-price");


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
    numeric >
    0;


  if (
    !state.editPriceHasValue
  ) {

    input.value =
      "";


    input.dataset.rawValue =
      "";


    return;

  }


  renderEditPrice();

}


function renderEditPrice() {

  const input =
    $("edit-price");


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


  input.dataset.rawValue =
    value.toFixed(
      2
    );


  validateEditPrice();

}


function validateEditPrice() {

  const input =
    $("edit-price");


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
    value <
      2 ||
    value >
      30
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
      function() {

        updateEditDateLimits();

        validateEditDates();

      }
    );


  $("edit-delivery-start")
    ?.addEventListener(
      "change",
      function() {

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
   SAVE CONTRACT EDIT
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


  if (
    contractBushels <=
    0
  ) {

    $("edit-contract-bushels")
      .setCustomValidity(
        "Enter Contract Bushels."
      );

  }
  else {

    $("edit-contract-bushels")
      .setCustomValidity(
        ""
      );

  }


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
    )
      .deliveredBushels;


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

    contractBushels:
      contractBushels,

    deliveredBushels:
      deliveredBushels,

    openBushels:
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
