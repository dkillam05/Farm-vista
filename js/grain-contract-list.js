// /Farm-vista/js/grain-contract-list.js
// Rev: 2026-08-15-grain-contract-list-v1
//
// PURPOSE:
// View and edit existing grain contracts.
//
// FIRESTORE:
// grain_contracts
// grain_buyers
// grain_customers
// grain_delivery_locations
//
// IMPORTANT:
// Editing Contract Bushels DOES NOT reset Delivered Bushels.
//
// openBushels = contractBushels - deliveredBushels
//
// If delivered bushels exceeds the updated contract bushels,
// openBushels will be negative and the contract is shown as
// "Over Delivered".


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
   HELPERS
============================================================ */

const $ = (id) =>
  document.getElementById(id);


function numberValue(value) {

  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : 0;

}


function formatBushels(value) {

  return numberValue(value)
    .toLocaleString(
      "en-US",
      {
        maximumFractionDigits:2
      }
    );

}


function formatPrice(value) {

  return numberValue(value)
    .toLocaleString(
      "en-US",
      {
        style:"currency",
        currency:"USD",
        minimumFractionDigits:2,
        maximumFractionDigits:2
      }
    );

}


function clean(value) {

  return String(value || "")
    .trim();

}


function sortByName(items) {

  return items.sort(
    function(a, b) {

      return clean(a.name)
        .localeCompare(
          clean(b.name)
        );

    }
  );

}



/* ============================================================
   STATE
============================================================ */

let contracts = [];
let filteredContracts = [];

let buyers = [];
let customers = [];
let deliveryLocations = [];

let activeContract = null;

let editPriceCents = 0;
let editPriceHasValue = false;



/* ============================================================
   START
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
        once:true
      }
    );

  } else {

    fn();

  }

}


onReady(
  async function() {

    setupNavigation();
    setupFilters();
    setupModal();
    setupEditBushels();
    setupEditPrice();
    setupEditDates();


    try {

      await Promise.all([
        loadContracts(),
        loadBuyers(),
        loadCustomers(),
        loadDeliveryLocations()
      ]);


      populateFilters();
      populateEditPickers();

      applyFilters();


    } catch (err) {

      console.error(
        "[Grain Contracts] Initial load failed:",
        err
      );


      $("loading-state").textContent =
        "Unable to load grain contracts.";

    }

  }
);



/* ============================================================
   NAVIGATION
============================================================ */

function setupNavigation() {

  $("back-btn")
    ?.addEventListener(
      "click",
      function() {

        window.location.href =
          "/Farm-vista/pages/grain/grain-contracts.html";

      }
    );


  $("add-contract-btn")
    ?.addEventListener(
      "click",
      function() {

        window.location.href =
          "/Farm-vista/pages/grain/grain-contract-add.html";

      }
    );

}



/* ============================================================
   LOAD CONTRACTS
============================================================ */

async function loadContracts() {

  const snapshot =
    await getDocs(
      collection(
        db,
        "grain_contracts"
      )
    );


  contracts =
    snapshot.docs
      .map(
        function(documentSnapshot) {

          const data =
            documentSnapshot.data() || {};


          return {

            id:
              documentSnapshot.id,

            ...data,

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


  contracts.sort(
    compareContracts
  );

}



function compareContracts(a, b) {

  const aDate =
    clean(
      a.contractDate
    );

  const bDate =
    clean(
      b.contractDate
    );


  if (aDate !== bDate) {

    return bDate.localeCompare(
      aDate
    );

  }


  return clean(
    a.contractNumber
  ).localeCompare(
    clean(
      b.contractNumber
    )
  );

}



/* ============================================================
   LOAD BUYERS
============================================================ */

async function loadBuyers() {

  const snapshot =
    await getDocs(
      collection(
        db,
        "grain_buyers"
      )
    );


  buyers =
    snapshot.docs
      .map(
        function(documentSnapshot) {

          const data =
            documentSnapshot.data() || {};


          return {

            id:
              documentSnapshot.id,

            name:
              clean(
                data.name
              )

          };

        }
      )
      .filter(
        function(item) {

          return item.name;

        }
      );


  sortByName(
    buyers
  );

}



/* ============================================================
   LOAD CUSTOMERS
============================================================ */

async function loadCustomers() {

  const snapshot =
    await getDocs(
      collection(
        db,
        "grain_customers"
      )
    );


  customers =
    snapshot.docs
      .map(
        function(documentSnapshot) {

          const data =
            documentSnapshot.data() || {};


          return {

            id:
              documentSnapshot.id,

            name:
              clean(
                data.name
              )

          };

        }
      )
      .filter(
        function(item) {

          return item.name;

        }
      );


  sortByName(
    customers
  );

}



/* ============================================================
   LOAD DELIVERY LOCATIONS
============================================================ */

async function loadDeliveryLocations() {

  const snapshot =
    await getDocs(
      collection(
        db,
        "grain_delivery_locations"
      )
    );


  deliveryLocations =
    snapshot.docs
      .map(
        function(documentSnapshot) {

          const data =
            documentSnapshot.data() || {};


          return {

            id:
              documentSnapshot.id,

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


  deliveryLocations.sort(
    function(a, b) {

      return a.locationName
        .localeCompare(
          b.locationName
        );

    }
  );

}



/* ============================================================
   FILTER SETUP
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
      function(id) {

        const element =
          $(id);


        if (!element) {
          return;
        }


        element.addEventListener(
          id === "search-filter"
            ? "input"
            : "change",
          applyFilters
        );

      }
    );

}



/* ============================================================
   POPULATE FILTERS
============================================================ */

function populateFilters() {

  populateSimpleFilter(
    $("crop-filter"),
    uniqueSorted(
      contracts.map(
        function(contract) {

          return contract.crop;

        }
      )
    )
  );


  populateSimpleFilter(
    $("buyer-filter"),
    uniqueSorted(
      contracts.map(
        function(contract) {

          return contract.buyerName;

        }
      )
    )
  );


  populateSimpleFilter(
    $("customer-filter"),
    uniqueSorted(
      contracts.map(
        function(contract) {

          return contract.customerName;

        }
      )
    )
  );

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
      function(a, b) {

        return a.localeCompare(
          b
        );

      }
    );

}



function populateSimpleFilter(
  select,
  values
) {

  if (!select) {
    return;
  }


  const firstOption =
    select.options[0];


  select.innerHTML =
    "";


  if (firstOption) {

    select.appendChild(
      firstOption
    );

  }


  values.forEach(
    function(value) {

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

}



/* ============================================================
   APPLY FILTERS
============================================================ */

function applyFilters() {

  const search =
    clean(
      $("search-filter")?.value
    )
      .toLowerCase();


  const status =
    $("status-filter")?.value ||
    "all";


  const crop =
    $("crop-filter")?.value ||
    "";


  const buyer =
    $("buyer-filter")?.value ||
    "";


  const customer =
    $("customer-filter")?.value ||
    "";


  filteredContracts =
    contracts.filter(
      function(contract) {

        if (search) {

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
          contract.crop !== crop
        ) {

          return false;

        }


        if (
          buyer &&
          contract.buyerName !== buyer
        ) {

          return false;

        }


        if (
          customer &&
          contract.customerName !== customer
        ) {

          return false;

        }


        const contractStatus =
          getContractStatus(
            contract
          );


        if (
          status !== "all" &&
          contractStatus !== status
        ) {

          return false;

        }


        return true;

      }
    );


  renderContracts();

}



/* ============================================================
   STATUS
============================================================ */

function getContractStatus(
  contract
) {

  const open =
    numberValue(
      contract.openBushels
    );


  if (open < 0) {

    return "over";

  }


  if (open === 0) {

    return "complete";

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


  if (status === "complete") {

    return "Completed";

  }


  if (status === "over") {

    return "Over Delivered";

  }


  return "Open";

}



function getStatusClass(
  contract
) {

  const status =
    getContractStatus(
      contract
    );


  if (status === "complete") {

    return "status-complete";

  }


  if (status === "over") {

    return "status-over";

  }


  return "status-open";

}



/* ============================================================
   RENDER
============================================================ */

function renderContracts() {

  $("loading-state").hidden =
    true;


  $("list-count").textContent =
    `${filteredContracts.length} of ${contracts.length}`;


  renderSummary();

  renderDesktopTable();
  renderMobileCards();

}



/* ============================================================
   SUMMARY
============================================================ */

function renderSummary() {

  let contracted =
    0;

  let delivered =
    0;

  let open =
    0;


  filteredContracts.forEach(
    function(contract) {

      contracted +=
        numberValue(
          contract.contractBushels
        );


      delivered +=
        numberValue(
          contract.deliveredBushels
        );


      open +=
        numberValue(
          contract.openBushels
        );

    }
  );


  $("summary-contracts").textContent =
    filteredContracts.length
      .toLocaleString(
        "en-US"
      );


  $("summary-contracted").textContent =
    formatBushels(
      contracted
    );


  $("summary-delivered").textContent =
    formatBushels(
      delivered
    );


  $("summary-open").textContent =
    formatBushels(
      open
    );

}



/* ============================================================
   DESKTOP TABLE
============================================================ */

function renderDesktopTable() {

  const tbody =
    $("contracts-tbody");

  const tableWrap =
    $("table-wrap");

  const emptyState =
    $("empty-state");


  tbody.innerHTML =
    "";


  if (
    !filteredContracts.length
  ) {

    tableWrap.hidden =
      true;


    emptyState.hidden =
      false;


    return;

  }


  tableWrap.hidden =
    false;


  emptyState.hidden =
    true;


  filteredContracts.forEach(
    function(contract) {

      const row =
        document.createElement(
          "tr"
        );


      row.className =
        "contract-row";


      row.tabIndex =
        0;


      row.innerHTML =
        `
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

          <td>
            ${formatBushels(contract.contractBushels)}
          </td>

          <td>
            ${formatBushels(contract.deliveredBushels)}
          </td>

          <td>
            ${formatBushels(contract.openBushels)}
          </td>

          <td>
            ${formatPrice(contract.pricePerBushel)}
          </td>

          <td>
            ${escapeHtml(formatDeliveryWindow(contract))}
          </td>
        `;


      row.addEventListener(
        "click",
        function() {

          openEditModal(
            contract.id
          );

        }
      );


      row.addEventListener(
        "keydown",
        function(event) {

          if (
            event.key === "Enter" ||
            event.key === " "
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
   MOBILE CARDS
============================================================ */

function renderMobileCards() {

  const container =
    $("mobile-contracts");


  container.innerHTML =
    "";


  if (
    !filteredContracts.length
  ) {

    return;

  }


  filteredContracts.forEach(
    function(contract) {

      const card =
        document.createElement(
          "div"
        );


      card.className =
        "mobile-contract-card";


      card.innerHTML =
        `
          <div class="mobile-contract-top">

            <div>

              <div class="mobile-contract-number">
                ${escapeHtml(contract.contractNumber || "No Contract #")}
              </div>

              <div class="mobile-contract-buyer">
                ${escapeHtml(contract.buyerName || "—")}
              </div>

            </div>

            <span class="status-pill ${getStatusClass(contract)}">
              ${escapeHtml(getStatusLabel(contract))}
            </span>

          </div>


          <div class="mobile-contract-grid">

            <div>
              <div class="mobile-label">
                Customer
              </div>
              <div class="mobile-value">
                ${escapeHtml(contract.customerName || "—")}
              </div>
            </div>

            <div>
              <div class="mobile-label">
                Crop
              </div>
              <div class="mobile-value">
                ${escapeHtml(contract.crop || "—")}
              </div>
            </div>

            <div>
              <div class="mobile-label">
                Contracted
              </div>
              <div class="mobile-value">
                ${formatBushels(contract.contractBushels)}
              </div>
            </div>

            <div>
              <div class="mobile-label">
                Open
              </div>
              <div class="mobile-value">
                ${formatBushels(contract.openBushels)}
              </div>
            </div>

            <div>
              <div class="mobile-label">
                Price
              </div>
              <div class="mobile-value">
                ${formatPrice(contract.pricePerBushel)}
              </div>
            </div>

            <div>
              <div class="mobile-label">
                Delivery
              </div>
              <div class="mobile-value">
                ${escapeHtml(formatDeliveryWindow(contract))}
              </div>
            </div>

          </div>
        `;


      card.addEventListener(
        "click",
        function() {

          openEditModal(
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
   DELIVERY DISPLAY
============================================================ */

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


  if (!start && !end) {

    return "—";

  }


  if (start && end) {

    return `${formatDate(start)} – ${formatDate(end)}`;

  }


  return formatDate(
    start || end
  );

}



function formatDate(
  iso
) {

  if (!iso) {
    return "";
  }


  const parts =
    iso.split("-");


  if (
    parts.length !== 3
  ) {

    return iso;

  }


  return (
    `${Number(parts[1])}/${Number(parts[2])}/${parts[0]}`
  );

}



/* ============================================================
   EDIT PICKERS
============================================================ */

function populateEditPickers() {

  populateObjectSelect(
    $("edit-buyer"),
    buyers,
    "Select Buyer / Elevator"
  );


  populateObjectSelect(
    $("edit-customer"),
    customers,
    "Select Customer"
  );

}



function populateObjectSelect(
  select,
  items,
  placeholder
) {

  if (!select) {
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
    placeholder;


  select.appendChild(
    blank
  );


  items.forEach(
    function(item) {

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

}



/* ============================================================
   MODAL SETUP
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
      function(event) {

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
   OPEN MODAL
============================================================ */

function openEditModal(
  contractId
) {

  const contract =
    contracts.find(
      function(item) {

        return item.id ===
          contractId;

      }
    );


  if (!contract) {
    return;
  }


  activeContract =
    contract;


  $("edit-modal-sub").textContent =
    `Contract ${contract.contractNumber || contract.id}`;


/* ============================================================
   RESTORE SAVED CONTRACT PICKERS

   Handles:
   - normal current records using IDs
   - older/imported records that may only have saved names
   - capitalization differences
   - FarmVista styled SELECT synchronization
============================================================ */

function restoreSelectValue(
  select,
  wantedValue,
  wantedText = ""
) {

  if (!select) {
    return;
  }


  const cleanValue =
    clean(
      wantedValue
    );


  const cleanText =
    clean(
      wantedText
    )
      .toLowerCase();


  let matchedOption =
    null;


  /*
    First choice:
    exact option VALUE match.
  */
  if (cleanValue) {

    matchedOption =
      Array.from(
        select.options
      )
        .find(
          option =>
            clean(
              option.value
            ) ===
            cleanValue
        ) ||
      null;

  }


  /*
    Second choice:
    case-insensitive VALUE match.

    Important for Crop / Contract Type.
  */
  if (
    !matchedOption &&
    cleanValue
  ) {

    matchedOption =
      Array.from(
        select.options
      )
        .find(
          option =>
            clean(
              option.value
            )
              .toLowerCase() ===
            cleanValue.toLowerCase()
        ) ||
      null;

  }


  /*
    Third choice:
    match visible OPTION text.

    This allows older contracts that have a buyer/customer name
    but may be missing the corresponding Firestore ID to restore.
  */
  if (
    !matchedOption &&
    cleanText
  ) {

    matchedOption =
      Array.from(
        select.options
      )
        .find(
          option =>
            clean(
              option.textContent
            )
              .toLowerCase() ===
            cleanText
        ) ||
      null;

  }


  if (matchedOption) {

    select.value =
      matchedOption.value;


    matchedOption.selected =
      true;

  }
  else {

    select.value =
      "";

  }


  /*
    Notify FarmVista / browser UI that the value changed.
  */
  select.dispatchEvent(
    new Event(
      "input",
      {
        bubbles:true
      }
    )
  );


  select.dispatchEvent(
    new Event(
      "change",
      {
        bubbles:true
      }
    )
  );


  /*
    Re-apply after the browser/custom select UI has painted.
  */
  requestAnimationFrame(
    () => {

      if (matchedOption) {

        select.value =
          matchedOption.value;


        matchedOption.selected =
          true;

      }


      select.dispatchEvent(
        new Event(
          "input",
          {
            bubbles:true
          }
        )
      );


      select.dispatchEvent(
        new Event(
          "change",
          {
            bubbles:true
          }
        )
      );

    }
  );

}



/*
  Buyer / Elevator
*/
restoreSelectValue(
  $("edit-buyer"),
  contract.buyerId,
  contract.buyerName
);


/*
  Customer
*/
restoreSelectValue(
  $("edit-customer"),
  contract.customerId,
  contract.customerName
);


/*
  Crop
*/
restoreSelectValue(
  $("edit-crop"),
  contract.crop,
  contract.crop
);


/*
  Contract Type
*/
restoreSelectValue(
  $("edit-contract-type"),
  contract.contractType ||
  contract.type,
  contract.contractType ||
  contract.type
);


  $("edit-contract-number").value =
    contract.contractNumber || "";


  $("edit-contract-date").value =
    contract.contractDate || "";


  setEditBushels(
    contract.contractBushels
  );


  setEditPrice(
    contract.pricePerBushel
  );


const restoredBuyerId =
  $("edit-buyer").value;


populateLocationPicker(
  restoredBuyerId,
  contract.deliveryLocationId
);


  $("edit-delivery-start").value =
    contract.deliveryStart || "";


  $("edit-delivery-end").value =
    contract.deliveryEnd || "";


  $("edit-delivered").value =
    formatBushels(
      contract.deliveredBushels
    );


  $("edit-notes").value =
    contract.notes || "";


  updateEditDateLimits();
  updateEditOpenBushels();


  $("edit-modal")
    .classList
    .add(
      "open"
    );


  document.body.style.overflow =
    "hidden";

}



/* ============================================================
   CLOSE MODAL
============================================================ */

function closeEditModal() {

  $("edit-modal")
    ?.classList
    .remove(
      "open"
    );


  document.body.style.overflow =
    "";


  activeContract =
    null;

}



/* ============================================================
   LOCATION PICKER
============================================================ */

function populateLocationPicker(
  buyerId,
  selectedLocationId = ""
) {

  const select =
    $("edit-delivery-location");


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


  if (!buyerId) {

    select.disabled =
      true;

    return;

  }


  select.disabled =
    false;


  const locations =
    deliveryLocations
      .filter(
        function(location) {

          return (
            location.buyerId ===
            buyerId
          );

        }
      );


  locations.forEach(
    function(location) {

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


  if (selectedLocationId) {

    select.value =
      selectedLocationId;

  }

}



/* ============================================================
   LOCATION DISPLAY
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


  if (!address) {

    return location.locationName;

  }


  return (
    `${location.locationName} — ${address}`
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
    function() {

      const digits =
        String(
          input.value || ""
        )
          .replace(
            /\D/g,
            ""
          );


      if (!digits) {

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
    numeric
      .toLocaleString(
        "en-US"
      );

}



/* ============================================================
   OPEN BUSHEL CALCULATION
============================================================ */

function updateEditOpenBushels() {

  if (!activeContract) {
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
      activeContract.deliveredBushels
    );


  const open =
    contracted -
    delivered;


  $("edit-open").value =
    formatBushels(
      open
    );


  $("modal-contracted").textContent =
    formatBushels(
      contracted
    );


  $("modal-delivered").textContent =
    formatBushels(
      delivered
    );


  $("modal-open").textContent =
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


  if (!input) {
    return;
  }


  input.addEventListener(
    "input",
    function() {

      const digits =
        String(
          input.value || ""
        )
          .replace(
            /\D/g,
            ""
          );


      if (!digits) {

        editPriceCents =
          0;


        editPriceHasValue =
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


      editPriceCents =
        Number(
          digits
        );


      editPriceHasValue =
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


  editPriceCents =
    Math.round(
      numeric * 100
    );


  editPriceHasValue =
    numeric > 0;


  if (
    !editPriceHasValue
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


  if (!editPriceHasValue) {

    input.value =
      "";


    input.dataset.rawValue =
      "";


    return;

  }


  const value =
    editPriceCents /
    100;


  input.value =
    value.toLocaleString(
      "en-US",
      {
        style:"currency",
        currency:"USD",
        minimumFractionDigits:2,
        maximumFractionDigits:2
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
    !editPriceHasValue
  ) {

    input.setCustomValidity(
      "Enter Price Per Bushel."
    );

    return false;

  }


  const value =
    editPriceCents /
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



/* ============================================================
   DATE LIMITS
============================================================ */

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

  } else {

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

  } else {

    end.removeAttribute(
      "min"
    );

  }

}



/* ============================================================
   DATE VALIDATION
============================================================ */

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
   ADD DAYS
============================================================ */

function addDays(
  isoDate,
  days
) {

  const parts =
    isoDate
      .split("-")
      .map(Number);


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
      date.getMonth() + 1
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


  return (
    `${yyyy}-${mm}-${dd}`
  );

}



/* ============================================================
   SAVE EDIT
============================================================ */

async function saveContractChanges(
  event
) {

  event.preventDefault();


  if (!activeContract) {

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
    contractBushels <= 0
  ) {

    $("edit-contract-bushels")
      .setCustomValidity(
        "Enter Contract Bushels."
      );

  } else {

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
    buyers.find(
      function(item) {

        return item.id ===
          $("edit-buyer").value;

      }
    );


  const customer =
    customers.find(
      function(item) {

        return item.id ===
          $("edit-customer").value;

      }
    );


  const location =
    deliveryLocations.find(
      function(item) {

        return item.id ===
          $("edit-delivery-location").value;

      }
    );


  if (!buyer) {

    alert(
      "Select Buyer / Elevator."
    );

    return;

  }


  if (!customer) {

    alert(
      "Select Customer."
    );

    return;

  }


  if (!location) {

    alert(
      "Select Delivery Location."
    );

    return;

  }


  const deliveredBushels =
    numberValue(
      activeContract.deliveredBushels
    );


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
      $("edit-crop").value,


    contractType:
      $("edit-contract-type").value,


    contractNumber:
      clean(
        $("edit-contract-number").value
      ),


    contractDate:
      $("edit-contract-date").value,


    contractBushels:
      contractBushels,


    /*
      KEEP EXISTING DELIVERED TOTAL.
    */

    deliveredBushels:
      deliveredBushels,


    /*
      RECOMPUTE OPEN BUSHELS.
    */

    openBushels:
      openBushels,


    pricePerBushel:
      editPriceCents /
      100,


    /*
      DELIVERY LOCATION SNAPSHOT
    */

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
      $("edit-delivery-start").value,


    deliveryEnd:
      $("edit-delivery-end").value,


    notes:
      clean(
        $("edit-notes").value
      ),


    updatedAt:
      serverTimestamp()

  };


  saveBtn.disabled =
    true;


  saveBtn.textContent =
    "Saving...";


  try {

    await updateDoc(
      doc(
        db,
        "grain_contracts",
        activeContract.id
      ),
      payload
    );


    /*
      UPDATE LOCAL STATE SO WE DO NOT
      NEED ANOTHER FIRESTORE READ.
    */

    Object.assign(
      activeContract,
      payload
    );


    contracts.sort(
      compareContracts
    );


    closeEditModal();


    populateFilters();

    applyFilters();


  } catch (err) {

    console.error(
      "[Grain Contracts] Update failed:",
      err
    );


    alert(
      "Unable to update grain contract."
    );


  } finally {

    saveBtn.disabled =
      false;


    saveBtn.textContent =
      "Save Changes";

  }

}



/* ============================================================
   HTML ESCAPE
============================================================ */

function escapeHtml(
  value
) {

  return String(
    value ?? ""
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
