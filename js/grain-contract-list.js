// /Farm-vista/js/grain-contract-list.js
// Rev: 2026-08-17-grain-contract-list-v3-void-support
//
// PURPOSE:
// View and edit existing grain contracts.
//
// FIRESTORE:
// grain_contracts
// grain_buyers
// grain_customers
// grain_delivery_locations
// grain_tickets
//
// IMPORTANT:
// Editing Contract Bushels DOES NOT reset Delivered Bushels.
//
// openBushels = contractBushels - deliveredBushels
//
// VOID RULES:
// - Never delete contracts.
// - Voided contracts are hidden by default.
// - Voided contracts cannot be edited.
// - A contract cannot be voided while active tickets are assigned.
// - Void audit information stays on the contract.
//
// EDIT RESTORE:
// Every time a contract is opened, every edit field is populated
// fresh from that specific grain_contracts Firestore document.


import {
  ready,
  getFirestore,
  getAuth,
  collection,
  getDocs,
  doc,
  updateDoc,
  serverTimestamp
} from "/Farm-vista/js/firebase-init.js";


await ready;

const db =
  getFirestore();

const auth =
  getAuth();


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

  return String(
    value ?? ""
  )
    .trim();

}


function normalized(value) {

  return clean(value)
    .toLowerCase();

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


/*
  Set a native SELECT from a saved Firestore value.

  This does NOT replace the select.
  This does NOT rebuild the select.
  This does NOT dispatch change events.

  It simply finds the matching existing option and selects it.
*/
function setNativeSelectValue(
  select,
  savedValue
) {

  if (!select) {
    return false;
  }


  const wanted =
    normalized(
      savedValue
    );


  if (!wanted) {

    select.selectedIndex =
      0;

    return false;

  }


  const options =
    Array.from(
      select.options
    );


  const match =
    options.find(
      function(option) {

        return (
          normalized(
            option.value
          ) ===
          wanted
        );

      }
    ) ||
    options.find(
      function(option) {

        return (
          normalized(
            option.textContent
          ) ===
          wanted
        );

      }
    );


  if (!match) {

    console.warn(
      "[Grain Contracts] No matching option:",
      {
        selectId:
          select.id,

        savedValue:
          savedValue,

        availableValues:
          options.map(
            function(option) {

              return option.value;

            }
          )
      }
    );


    select.selectedIndex =
      0;

    return false;

  }


  options.forEach(
    function(option) {

      option.selected =
        false;

    }
  );


  match.selected =
    true;


  select.value =
    match.value;


  return true;

}


/*
  Restore an ID-based dropdown such as Buyer or Customer.

  First use Firestore ID.
  If an older record does not have a valid ID, fall back to name.
*/
function setObjectSelectValue(
  select,
  savedId,
  savedName,
  items
) {

  if (!select) {
    return "";
  }


  const wantedId =
    clean(
      savedId
    );


  if (wantedId) {

    const idMatch =
      Array.from(
        select.options
      )
        .find(
          function(option) {

            return (
              clean(
                option.value
              ) ===
              wantedId
            );

          }
        );


    if (idMatch) {

      select.value =
        idMatch.value;

      return idMatch.value;

    }

  }


  const wantedName =
    normalized(
      savedName
    );


  if (wantedName) {

    const item =
      items.find(
        function(candidate) {

          return (
            normalized(
              candidate.name
            ) ===
            wantedName
          );

        }
      );


    if (item) {

      select.value =
        item.id;

      return item.id;

    }

  }


  select.value =
    "";

  return "";

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

let showVoided = false;



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
    setupVoidControls();


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
   VOID CONTROLS
============================================================ */

function setupVoidControls() {

  const checkbox =
    $("show-voided-checkbox");


  showVoided =
    Boolean(
      checkbox?.checked
    );


  checkbox
    ?.addEventListener(
      "change",
      function() {

        showVoided =
          Boolean(
            this.checked
          );


        applyFilters();

      }
    );


  $("void-contract-btn")
    ?.addEventListener(
      "click",
      voidActiveContract
    );

}


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


async function getActiveTicketsForContract(
  contractId
) {

  const snapshot =
    await getDocs(
      collection(
        db,
        "grain_tickets"
      )
    );


  return snapshot.docs
    .map(
      function(documentSnapshot) {

        return {

          id:
            documentSnapshot.id,

          ...(
            documentSnapshot.data() ||
            {}
          )

        };

      }
    )
    .filter(
      function(ticket) {

        return (
          !ticket.voided &&
          clean(
            ticket.contractId
          ) ===
          clean(
            contractId
          )
        );

      }
    );

}


async function updateVoidContractButton() {

  const button =
    $("void-contract-btn");


  if (!button) {
    return;
  }


  if (!activeContract) {

    button.disabled =
      true;

    button.textContent =
      "Void Contract";

    return;

  }


  if (
    activeContract.voided
  ) {

    button.disabled =
      true;

    button.textContent =
      "Contract Voided";

    return;

  }


  button.disabled =
    false;

  button.textContent =
    "Void Contract";

}


async function voidActiveContract() {

  if (
    !activeContract ||
    activeContract.voided
  ) {

    return;

  }


  const button =
    $("void-contract-btn");


  if (button) {

    button.disabled =
      true;

    button.textContent =
      "Checking...";

  }


  try {

    const activeTickets =
      await getActiveTicketsForContract(
        activeContract.id
      );


    if (
      activeTickets.length
    ) {

      alert(
        `Contract ${
          activeContract.contractNumber ||
          activeContract.id
        } cannot be voided because ${
          activeTickets.length
        } active grain ticket${
          activeTickets.length === 1
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
            activeContract.contractNumber ||
            activeContract.id
          }?`
        )
      );


    if (!reason) {
      return;
    }


    const confirmed =
      window.confirm(
        `Void Contract ${
          activeContract.contractNumber ||
          activeContract.id
        }?\n\nThe contract will stay in Firestore for history, but it will be hidden by default and cannot receive grain tickets.`
      );


    if (!confirmed) {
      return;
    }


    /*
      Check again immediately before saving.
      This protects against a ticket being assigned while
      the void confirmation is open.
    */
    const finalActiveTickets =
      await getActiveTicketsForContract(
        activeContract.id
      );


    if (
      finalActiveTickets.length
    ) {

      alert(
        "This contract now has an active grain ticket assigned to it, so FarmVista stopped the void."
      );


      return;

    }


    const who =
      currentVoidUser();


    const payload = {

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
          activeContract.contractBushels
        ),

      voidedDeliveredBushels:
        numberValue(
          activeContract.deliveredBushels
        ),

      voidedOpenBushels:
        numberValue(
          activeContract.openBushels
        ),

      updatedAt:
        serverTimestamp()

    };


    await updateDoc(
      doc(
        db,
        "grain_contracts",
        activeContract.id
      ),
      payload
    );


    Object.assign(
      activeContract,
      {
        ...payload,
        voided:true,
        voidReason:reason
      }
    );


    closeEditModal();


    populateFilters();

    applyFilters();


  } catch (err) {

    console.error(
      "[Grain Contracts] Contract void failed:",
      err
    );


    alert(
      "Unable to void grain contract."
    );


  } finally {

    if (
      activeContract &&
      !activeContract.voided
    ) {

      updateVoidContractButton();

    }

  }

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
    select.options[0]
      ? select.options[0].cloneNode(true)
      : null;


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

        if (
          contract.voided &&
          !showVoided
        ) {

          return false;

        }


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


        /*
          When Show voided is checked,
          voided records should still appear
          even if the status dropdown is Open.
        */
        if (
          contract.voided &&
          showVoided
        ) {

          return true;

        }


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

  if (
    contract.voided
  ) {

    return "voided";

  }


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


  if (status === "voided") {

    return "Voided";

  }


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


  if (status === "voided") {

    return "status-voided";

  }


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


  const activeFilteredContracts =
    filteredContracts.filter(
      function(contract) {

        return !contract.voided;

      }
    );


  activeFilteredContracts.forEach(
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
    activeFilteredContracts.length
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
        contract.voided
          ? "contract-row voided-record"
          : "contract-row";


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
        contract.voided
          ? "mobile-contract-card voided-record"
          : "mobile-contract-card";


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

        return (
          clean(
            item.id
          ) ===
          clean(
            contractId
          )
        );

      }
    );


  if (!contract) {

    console.error(
      "[Grain Contracts] Contract not found:",
      contractId
    );

    return;

  }


  activeContract =
    contract;


  $("edit-contract-form")
    ?.reset();


  populateEditPickers();


  $("edit-modal-sub").textContent =
    contract.voided
      ? `Contract ${
          contract.contractNumber ||
          contract.id
        } — VOIDED${
          contract.voidReason
            ? ` — ${contract.voidReason}`
            : ""
        }`
      : `Contract ${
          contract.contractNumber ||
          contract.id
        }`;


  const restoredBuyerId =
    setObjectSelectValue(
      $("edit-buyer"),
      contract.buyerId,
      contract.buyerName,
      buyers
    );


  setObjectSelectValue(
    $("edit-customer"),
    contract.customerId,
    contract.customerName,
    customers
  );


  setNativeSelectValue(
    $("edit-crop"),
    contract.crop
  );


  setNativeSelectValue(
    $("edit-contract-type"),
    contract.contractType
  );


  $("edit-contract-number").value =
    clean(
      contract.contractNumber
    );


  $("edit-contract-date").value =
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
    restoredBuyerId ||
    contract.buyerId,
    contract.deliveryLocationId,
    contract
  );


  $("edit-delivery-start").value =
    clean(
      contract.deliveryStart
    );


  $("edit-delivery-end").value =
    clean(
      contract.deliveryEnd
    );


  $("edit-delivered").value =
    formatBushels(
      contract.deliveredBushels
    );


  $("edit-notes").value =
    clean(
      contract.notes
    );


  updateEditDateLimits();

  updateEditOpenBushels();


  console.log(
    "[Grain Contracts] Loaded edit contract:",
    {

      id:
        contract.id,

      contractNumber:
        contract.contractNumber,

      firestoreBuyerId:
        contract.buyerId,

      actualBuyerId:
        $("edit-buyer").value,

      firestoreCustomerId:
        contract.customerId,

      actualCustomerId:
        $("edit-customer").value,

      firestoreCrop:
        contract.crop,

      actualCrop:
        $("edit-crop").value,

      firestoreContractType:
        contract.contractType,

      actualContractType:
        $("edit-contract-type").value,

      firestoreDeliveryLocationId:
        contract.deliveryLocationId,

      actualDeliveryLocationId:
        $("edit-delivery-location").value

    }
  );


  updateVoidContractButton();


  if (
    $("save-edit-btn")
  ) {

    $("save-edit-btn").disabled =
      Boolean(
        contract.voided
      );


    $("save-edit-btn").textContent =
      contract.voided
        ? "Contract Voided"
        : "Save Changes";

  }


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
  selectedLocationId = "",
  savedContract = null
) {

  const select =
    $("edit-delivery-location");


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
            clean(
              location.buyerId
            ) ===
            clean(
              buyerId
            )
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

    const exact =
      Array.from(
        select.options
      )
        .find(
          function(option) {

            return (
              clean(
                option.value
              ) ===
              clean(
                selectedLocationId
              )
            );

          }
        );


    if (exact) {

      select.value =
        exact.value;

      return;

    }

  }


  if (!savedContract) {
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


  let match =
    locations.find(
      function(location) {

        return (
          wantedName &&
          normalized(
            location.locationName
          ) ===
          wantedName &&
          (
            !wantedStreet ||
            normalized(
              location.street
            ) ===
            wantedStreet
          ) &&
          (
            !wantedCity ||
            normalized(
              location.city
            ) ===
            wantedCity
          )
        );

      }
    );


  if (
    !match &&
    wantedName
  ) {

    match =
      locations.find(
        function(location) {

          return (
            normalized(
              location.locationName
            ) ===
            wantedName
          );

        }
      );

  }


  if (match) {

    select.value =
      match.id;

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


  if (!input) {
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


  if (!input) {
    return;
  }


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


  if (!input) {
    return;
  }


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


  if (!input) {
    return false;
  }


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


  if (
    activeContract.voided
  ) {

    alert(
      "Voided grain contracts cannot be edited."
    );

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


    deliveredBushels:
      deliveredBushels,


    openBushels:
      openBushels,


    pricePerBushel:
      editPriceCents /
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
