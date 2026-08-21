// /Farm-vista/js/grain-ticket-add.js
// FarmVista — Manual Grain Ticket Entry
//
// Matches the CURRENT grain-ticket-add.html IDs.
//
// FLOW:
// Crop
// → Grain Source
// → Destination / Elevator
// → Sold Under / Customer
// → Contract
// → Ticket Information
// → Bushels
// → Weights
// → Grade Factors
// → Driver

import {
  ready,
  getAuth,
  getFirestore,
  collection,
  getDocs,
  addDoc,
  doc,
  updateDoc,
  serverTimestamp
} from "/Farm-vista/js/firebase-init.js";


await ready;


const db =
  getFirestore();


const auth =
  getAuth();


const $ =
  id =>
    document.getElementById(
      id
    );


/* ============================================================
   STATE
============================================================ */

const state = {

  user:
    null,

  buyers:
    [],

  customers:
    [],

  locations:
    [],

  contracts:
    [],

  binSources:
    [],

  bagSources:
    [],

  employeeDrivers:
    [],

  subcontractors:
    [],

  selectedSource:
    null,

  selectedBuyer:
    null,

  selectedLocation:
    null,

  selectedCustomer:
    null,

  selectedContract:
    null,

  selectedDriver:
    null,

  saving:
    false

};


/* ============================================================
   ELEMENTS
============================================================ */

const el = {

  form:
    $("ticketForm"),

  backBtn:
    $("backBtn"),

  cancelBtn:
    $("cancelBtn"),

  saveBtn:
    $("saveBtn"),

  message:
    $("message"),


  crop:
    $("ticketCrop"),


  sourcePicker:
    $("grainSourcePicker"),

  sourceButton:
    $("grainSourceButton"),

  sourceButtonText:
    $("grainSourceButtonText"),

  sourceMenu:
    $("grainSourceMenu"),

  sourceValue:
    $("grainSourceValue"),


  destinationPicker:
    $("destinationPicker"),

  destinationButton:
    $("destinationButton"),

  destinationButtonText:
    $("destinationButtonText"),

  destinationMenu:
    $("destinationMenu"),

  locationSelect:
    $("locationSelect"),

  buyerSelect:
    $("buyerSelect"),


  customerPicker:
    $("customerPicker"),

  customerButton:
    $("customerButton"),

  customerButtonText:
    $("customerButtonText"),

  customerMenu:
    $("customerMenu"),

  customerSelect:
    $("customerSelect"),


  contractSelect:
    $("contractSelect"),

  contractStatus:
    $("contractStatus"),


  ticketNumber:
    $("ticketNumber"),

  ticketDate:
    $("ticketDate"),


  grossBushels:
    $("grossBushels"),

  shrinkBushels:
    $("shrinkBushels"),

  netBushels:
    $("netBushels"),

  bushelCheck:
    $("bushelCheck"),


  grossWeight:
    $("grossWeight"),

  tareWeight:
    $("tareWeight"),

  netWeight:
    $("netWeight"),

  weightCheck:
    $("weightCheck"),


  testWeight:
    $("testWeight"),

  moisture:
    $("moisture"),

  damage:
    $("damage"),

  foreignMaterial:
    $("foreignMaterial"),


  driverCompany:
    $("driverCompany"),

  driverSelect:
    $("driverSelect"),

  addDriverBtn:
    $("addDriverBtn"),

  addDriverPanel:
    $("addDriverPanel"),

  driverFirstName:
    $("driverFirstName"),

  driverLastName:
    $("driverLastName"),

  driverCell:
    $("driverCell"),

  driverAddCancel:
    $("driverAddCancel"),

  driverAddSave:
    $("driverAddSave")

};


/* ============================================================
   BASIC HELPERS
============================================================ */

function clean(
  value
) {

  return String(
    value ?? ""
  )
    .trim();

}


function normalize(
  value
) {

  return clean(
    value
  )
    .toLowerCase()
    .replace(
      /[^a-z0-9]+/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();

}


function numberOrNull(
  value
) {

  if (
    value === "" ||
    value === null ||
    value === undefined
  ) {

    return null;

  }


  const number =
    Number(
      String(
        value
      )
        .replace(
          /,/g,
          ""
        )
    );


  return Number.isFinite(
    number
  )
    ? number
    : null;

}


function localISO(
  date =
    new Date()
) {

  return [
    date.getFullYear(),

    String(
      date.getMonth() +
      1
    )
      .padStart(
        2,
        "0"
      ),

    String(
      date.getDate()
    )
      .padStart(
        2,
        "0"
      )
  ]
    .join(
      "-"
    );

}


function formatLocation(
  location
) {

  if (
    !location
  ) {

    return "";

  }


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


  const cityStateZip =
    [
      cityState,
      location.zip
    ]
      .filter(
        Boolean
      )
      .join(
        " "
      );


  return [
    location.street,
    cityStateZip
  ]
    .filter(
      Boolean
    )
    .join(
      " • "
    );

}


function displayDriverName(
  data
) {

  return clean(
    data?.fullName ||
    data?.name ||
    [
      data?.firstName,
      data?.lastName
    ]
      .filter(
        Boolean
      )
      .join(
        " "
      )
  );

}


function showMessage(
  text,
  type =
    "error"
) {

  if (
    !el.message
  ) {

    return;

  }


  el.message.textContent =
    text;


  el.message.className =
    `message show ${type}`;


  el.message.scrollIntoView({
    behavior:
      "smooth",

    block:
      "nearest"
  });

}


function clearMessage() {

  if (
    !el.message
  ) {

    return;

  }


  el.message.textContent =
    "";


  el.message.className =
    "message";

}


function setCheck(
  element,
  ok,
  text
) {

  if (
    !element
  ) {

    return;

  }


  element.className =
    `check ${ok ? "good" : "warning"}`;


  element.textContent =
    text;

}


/* ============================================================
   PICKER HELPERS
============================================================ */

function addSearch(
  menu,
  placeholder,
  value,
  onInput
) {

  const wrap =
    document.createElement(
      "div"
    );


  wrap.className =
    "picker-search-wrap";


  const input =
    document.createElement(
      "input"
    );


  input.type =
    "search";


  input.className =
    "picker-search";


  input.placeholder =
    placeholder;


  input.autocomplete =
    "off";


  input.value =
    value;


  input.addEventListener(
    "input",
    () => {

      onInput(
        input.value
      );

    }
  );


  wrap.appendChild(
    input
  );


  menu.appendChild(
    wrap
  );


  return input;

}


function addGroup(
  menu,
  text
) {

  const div =
    document.createElement(
      "div"
    );


  div.className =
    "picker-group";


  div.textContent =
    text;


  menu.appendChild(
    div
  );

}


function addEmpty(
  menu,
  text
) {

  const div =
    document.createElement(
      "div"
    );


  div.className =
    "picker-empty";


  div.textContent =
    text;


  menu.appendChild(
    div
  );

}


function addChoice(
  menu,
  {
    title,
    sub = "",
    selected = false,
    onClick
  }
) {

  const button =
    document.createElement(
      "button"
    );


  button.type =
    "button";


  button.className =
    `picker-choice${selected ? " selected" : ""}`;


  const titleSpan =
    document.createElement(
      "span"
    );


  titleSpan.className =
    "picker-choice-title";


  titleSpan.textContent =
    title;


  button.appendChild(
    titleSpan
  );


  if (
    sub
  ) {

    const subSpan =
      document.createElement(
        "span"
      );


    subSpan.className =
      "picker-choice-sub";


    subSpan.textContent =
      sub;


    button.appendChild(
      subSpan
    );

  }


  button.addEventListener(
    "click",
    onClick
  );


  menu.appendChild(
    button
  );


  return button;

}


function closeMenus(
  except =
    null
) {

  const pairs = [

    [
      el.sourceButton,
      el.sourceMenu
    ],

    [
      el.destinationButton,
      el.destinationMenu
    ],

    [
      el.customerButton,
      el.customerMenu
    ],

    [
      el.driverButton,
      el.driverMenu
    ]

  ];


  pairs.forEach(
    (
      [
        button,
        menu
      ]
    ) => {

      if (
        !menu
      ) {

        return;

      }


      if (
        menu !==
        except
      ) {

        menu.classList.remove(
          "open"
        );


        button?.setAttribute(
          "aria-expanded",
          "false"
        );

      }

    }
  );

}


function openMenu(
  button,
  menu,
  render
) {

  if (
    !button ||
    !menu ||
    button.disabled
  ) {

    return;

  }


  if (
    menu.classList.contains(
      "open"
    )
  ) {

    closeMenus();

    return;

  }


  closeMenus(
    menu
  );


  render(
    ""
  );


  menu.classList.add(
    "open"
  );


  button.setAttribute(
    "aria-expanded",
    "true"
  );


  setTimeout(
    () => {

      menu
        .querySelector(
          ".picker-search"
        )
        ?.focus();

    },
    0
  );

}


function refocus(
  menu,
  value
) {

  const replacement =
    menu.querySelector(
      ".picker-search"
    );


  replacement?.focus();


  replacement?.setSelectionRange(
    value.length,
    value.length
  );

}


/* ============================================================
   CONTRACT RULES
============================================================ */

function contractIsOpen(
  contract
) {

  if (
    contract?.isActive ===
      false ||
    contract?.active ===
      false
  ) {

    return false;

  }


  const status =
    normalize(
      contract?.status ||
      contract?.contractStatus
    );


  if (
    status.includes(
      "closed"
    ) ||
    status.includes(
      "complete"
    ) ||
    status.includes(
      "cancel"
    ) ||
    status.includes(
      "void"
    )
  ) {

    return false;

  }


  const remaining =
    [
      contract?.remainingBushels,
      contract?.bushelsRemaining,
      contract?.remainingBu,
      contract?.openBushels
    ]
      .find(
        value =>
          value !==
            undefined &&
          value !==
            null &&
          value !==
            ""
      );


  if (
    remaining !==
      undefined &&
    Number.isFinite(
      Number(
        remaining
      )
    ) &&
    Number(
      remaining
    ) <=
      0
  ) {

    return false;

  }


  return true;

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

  return normalize(
    contract?.crop ||
    contract?.commodity
  );

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


function contractMatchesLocation(
  contract,
  location
) {

  if (
    !contract ||
    !location
  ) {

    return false;

  }


  const id =
    contractLocationId(
      contract
    );


  if (
    id
  ) {

    return (
      id ===
      clean(
        location.id
      )
    );

  }


  const buyerId =
    contractBuyerId(
      contract
    );


  const buyerMatches =
    !buyerId ||
    buyerId ===
      clean(
        location.buyerId
      );


  const locationName =
    normalize(
      contract?.deliveryLocationName ||
      contract?.locationName ||
      contract?.destinationName
    );


  return (
    buyerMatches &&
    !!locationName &&
    locationName ===
      normalize(
        location.locationName
      )
  );

}


function openContracts() {

  return state.contracts.filter(
    contractIsOpen
  );

}


function contractsForSelectedCrop() {

  const crop =
    normalize(
      el.crop.value
    );


  if (
    !crop
  ) {

    return [];

  }


  return openContracts()
    .filter(
      contract =>
        contractCrop(
          contract
        ) ===
        crop
    );

}


function contractsForDestination() {

  const location =
    state.locations.find(
      item =>
        item.id ===
        el.locationSelect.value
    ) ||
    null;


  if (
    !location
  ) {

    return [];

  }


  return contractsForSelectedCrop()
    .filter(
      contract =>
        contractMatchesLocation(
          contract,
          location
        )
    );

}


function contractsForCustomer() {

  const customerId =
    clean(
      el.customerSelect.value
    );


  if (
    !customerId
  ) {

    return [];

  }


  return contractsForDestination()
    .filter(
      contract =>
        contractCustomerId(
          contract
        ) ===
        customerId
    );

}


function matchingContracts() {

  if (
    !el.crop.value ||
    !state.selectedSource ||
    !state.selectedLocation ||
    !state.selectedCustomer
  ) {

    return [];

  }


  return contractsForCustomer()
    .sort(
      (
        a,
        b
      ) =>
        clean(
          a.contractNumber ||
          a.number
        )
          .localeCompare(
            clean(
              b.contractNumber ||
              b.number
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


function contractLabel(
  contract
) {

  const number =
    clean(
      contract?.contractNumber ||
      contract?.number ||
      contract?.contractNo ||
      contract?.referenceNumber
    ) ||
    "Contract";


  const remainingRaw =
    contract?.remainingBushels ??
    contract?.bushelsRemaining ??
    contract?.remainingBu ??
    contract?.openBushels ??
    null;


  const remaining =
    remainingRaw !==
      null &&
    remainingRaw !==
      "" &&
    Number.isFinite(
      Number(
        remainingRaw
      )
    )
      ? ` • ${Number(
          remainingRaw
        ).toLocaleString(
          "en-US",
          {
            maximumFractionDigits:
              2
          }
        )} bu left`
      : "";


  return `${number}${remaining}`;

}


/* ============================================================
   GRAIN SOURCE
============================================================ */

function allSources() {

  return [
    ...state.binSources,
    ...state.bagSources
  ];

}


function sourceFromValue(
  value
) {

  return allSources()
    .find(
      item =>
        item.value ===
        value
    ) ||
    null;

}


function currentSources() {

  const crop =
    normalize(
      el.crop.value
    );


  if (
    !crop
  ) {

    return [];

  }


  return allSources()
    .filter(
      item =>
        clean(
          item.crop
        ) &&
        normalize(
          item.crop
        ) ===
        crop
    );

}


function syncSource() {

  state.selectedSource =
    sourceFromValue(
      el.sourceValue.value
    );


  el.sourceButtonText.textContent =
    state.selectedSource?.label ||
    (
      el.crop.value
        ? "Select bin or grain bag"
        : "Select crop first"
    );

}


function renderSource(
  searchText =
    ""
) {

  const search =
    normalize(
      searchText
    );


  el.sourceMenu.innerHTML =
    "";


  const ready =
    !!normalize(
      el.crop.value
    );


  el.sourceButton.disabled =
    !ready;


  if (
    !ready
  ) {

    el.sourceValue.value =
      "";


    state.selectedSource =
      null;


    el.sourceButtonText.textContent =
      "Select crop first";


    addEmpty(
      el.sourceMenu,
      "Select a crop first."
    );


    return;

  }


  const items =
    currentSources();


  if (
    el.sourceValue.value &&
    !items.some(
      item =>
        item.value ===
        el.sourceValue.value
    )
  ) {

    el.sourceValue.value =
      "";


    state.selectedSource =
      null;

  }


  addSearch(
    el.sourceMenu,
    "Search matching bin site, bin, or field…",
    searchText,
    value => {

      renderSource(
        value
      );


      refocus(
        el.sourceMenu,
        value
      );

    }
  );


  const filtered =
    items.filter(
      item =>
        !search ||
        normalize(
          `${item.label} ${item.searchText || ""}`
        )
          .includes(
            search
          )
    );


  const bins =
    filtered.filter(
      item =>
        item.type ===
        "bin"
    );


  const bags =
    filtered.filter(
      item =>
        item.type ===
        "grain_bag"
    );


  if (
    bins.length
  ) {

    addGroup(
      el.sourceMenu,
      "Bin Sites"
    );


    bins.forEach(
      item => {

        addChoice(
          el.sourceMenu,
          {
            title:
              item.label,

            selected:
              item.value ===
              el.sourceValue.value,

            onClick:
              () => {

                chooseSource(
                  item.value
                );

              }
          }
        );

      }
    );

  }


  if (
    bags.length
  ) {

    addGroup(
      el.sourceMenu,
      "Grain Bags"
    );


    bags.forEach(
      item => {

        addChoice(
          el.sourceMenu,
          {
            title:
              item.label,

            selected:
              item.value ===
              el.sourceValue.value,

            onClick:
              () => {

                chooseSource(
                  item.value
                );

              }
          }
        );

      }
    );

  }


  if (
    !bins.length &&
    !bags.length
  ) {

    addEmpty(
      el.sourceMenu,
      `No grain source with available ${clean(
        el.crop.value
      )} inventory was found.`
    );

  }


  syncSource();

}


function chooseSource(
  value
) {

  const selected =
    sourceFromValue(
      value
    );


  if (
    !selected ||
    normalize(
      selected.crop
    ) !==
    normalize(
      el.crop.value
    )
  ) {

    showMessage(
      "That grain source does not match the selected crop."
    );


    return;

  }


  el.sourceValue.value =
    selected.value;


  state.selectedSource =
    selected;


  clearBelowSource();


  syncSource();


  renderDestination();


  renderCustomer();


  renderContract();


  closeMenus();


  clearMessage();

}


/* ============================================================
   DESTINATION
============================================================ */

function clearBelowSource() {

  el.locationSelect.value =
    "";


  el.buyerSelect.value =
    "";


  state.selectedLocation =
    null;


  state.selectedBuyer =
    null;


  el.customerSelect.value =
    "";


  state.selectedCustomer =
    null;


  el.contractSelect.value =
    "";


  state.selectedContract =
    null;


  syncDestination();


  syncCustomer();

}


function syncDestination() {

  state.selectedLocation =
    state.locations.find(
      location =>
        location.id ===
        el.locationSelect.value
    ) ||
    null;


  state.selectedBuyer =
    state.selectedLocation
      ? (
          state.buyers.find(
            buyer =>
              buyer.id ===
              state.selectedLocation.buyerId
          ) ||
          {
            id:
              state.selectedLocation.buyerId,

            name:
              state.selectedLocation.buyerName
          }
        )
      : null;


  el.buyerSelect.value =
    state.selectedBuyer?.id ||
    "";


  el.destinationButtonText.textContent =
    state.selectedLocation
      ? `${
          state.selectedLocation.buyerName
            ? `${state.selectedLocation.buyerName} — `
            : ""
        }${state.selectedLocation.locationName}`
      : (
          state.selectedSource
            ? "Select destination"
            : (
                el.crop.value
                  ? "Select grain source first"
                  : "Select crop first"
              )
        );

}


function renderDestination(
  searchText =
    ""
) {

  const search =
    normalize(
      searchText
    );


  el.destinationMenu.innerHTML =
    "";


  const ready =
    !!normalize(
      el.crop.value
    ) &&
    !!state.selectedSource;


  el.destinationButton.disabled =
    !ready;


  if (
    !ready
  ) {

    el.locationSelect.value =
      "";


    el.buyerSelect.value =
      "";


    state.selectedLocation =
      null;


    state.selectedBuyer =
      null;


    syncDestination();


    addEmpty(
      el.destinationMenu,
      el.crop.value
        ? "Select a grain source first."
        : "Select a crop first."
    );


    return;

  }


  addSearch(
    el.destinationMenu,
    "Search matching elevator or location…",
    searchText,
    value => {

      renderDestination(
        value
      );


      refocus(
        el.destinationMenu,
        value
      );

    }
  );


  const cropContracts =
    contractsForSelectedCrop();


  const eligible =
    state.locations
      .filter(
        location =>
          cropContracts.some(
            contract =>
              contractMatchesLocation(
                contract,
                location
              )
          )
      );


  if (
    el.locationSelect.value &&
    !eligible.some(
      location =>
        location.id ===
        el.locationSelect.value
    )
  ) {

    el.locationSelect.value =
      "";


    el.buyerSelect.value =
      "";


    state.selectedLocation =
      null;


    state.selectedBuyer =
      null;

  }


  const filtered =
    eligible
      .filter(
        location => {

          if (
            !search
          ) {

            return true;

          }


          return normalize(
            [
              location.buyerName,
              location.locationName,
              location.street,
              location.city,
              location.state,
              location.zip
            ]
              .filter(
                Boolean
              )
              .join(
                " "
              )
          )
            .includes(
              search
            );

        }
      );


  let lastBuyer =
    "";


  filtered.forEach(
    location => {

      const buyerName =
        clean(
          location.buyerName
        ) ||
        "Elevator";


      if (
        buyerName !==
        lastBuyer
      ) {

        addGroup(
          el.destinationMenu,
          buyerName
        );


        lastBuyer =
          buyerName;

      }


      addChoice(
        el.destinationMenu,
        {
          title:
            location.locationName,

          sub:
            formatLocation(
              location
            ),

          selected:
            location.id ===
            el.locationSelect.value,

          onClick:
            () => {

              chooseDestination(
                location.id
              );

            }
        }
      );

    }
  );


  if (
    !filtered.length
  ) {

    addEmpty(
      el.destinationMenu,
      `No destination has an open ${clean(
        el.crop.value
      )} contract.`
    );

  }


  syncDestination();

}


function chooseDestination(
  locationId
) {

  const selected =
    state.locations.find(
      location =>
        location.id ===
        locationId
    ) ||
    null;


  el.locationSelect.value =
    selected?.id ||
    "";


  el.buyerSelect.value =
    selected?.buyerId ||
    "";


  state.selectedLocation =
    selected;


  state.selectedBuyer =
    selected
      ? (
          state.buyers.find(
            buyer =>
              buyer.id ===
              selected.buyerId
          ) ||
          {
            id:
              selected.buyerId,

            name:
              selected.buyerName
          }
        )
      : null;


  el.customerSelect.value =
    "";


  state.selectedCustomer =
    null;


  el.contractSelect.value =
    "";


  state.selectedContract =
    null;


  syncDestination();


  syncCustomer();


  renderCustomer();


  renderContract();


  closeMenus();


  clearMessage();

}


/* ============================================================
   CUSTOMER
============================================================ */

function syncCustomer() {

  state.selectedCustomer =
    state.customers.find(
      customer =>
        customer.id ===
        el.customerSelect.value
    ) ||
    null;


  el.customerButtonText.textContent =
    state.selectedCustomer?.name ||
    (
      state.selectedLocation
        ? "Select customer"
        : "Select destination first"
    );

}


function renderCustomer(
  searchText =
    ""
) {

  const search =
    normalize(
      searchText
    );


  el.customerMenu.innerHTML =
    "";


  const ready =
    !!state.selectedLocation;


  el.customerButton.disabled =
    !ready;


  if (
    !ready
  ) {

    el.customerSelect.value =
      "";


    state.selectedCustomer =
      null;


    syncCustomer();


    addEmpty(
      el.customerMenu,
      "Select a destination first."
    );


    return;

  }


  addSearch(
    el.customerMenu,
    "Search matching customer…",
    searchText,
    value => {

      renderCustomer(
        value
      );


      refocus(
        el.customerMenu,
        value
      );

    }
  );


  const eligibleIds =
    new Set(
      contractsForDestination()
        .map(
          contractCustomerId
        )
        .filter(
          Boolean
        )
    );


  const customers =
    state.customers
      .filter(
        customer =>
          eligibleIds.has(
            customer.id
          )
      )
      .filter(
        customer =>
          !search ||
          normalize(
            customer.name
          )
            .includes(
              search
            )
      );


  customers.forEach(
    customer => {

      addChoice(
        el.customerMenu,
        {
          title:
            customer.name,

          selected:
            customer.id ===
            el.customerSelect.value,

          onClick:
            () => {

              chooseCustomer(
                customer.id
              );

            }
        }
      );

    }
  );


  if (
    !customers.length
  ) {

    addEmpty(
      el.customerMenu,
      "No Sold Under customer has an open contract for this crop and destination."
    );

  }


  syncCustomer();

}


function chooseCustomer(
  id
) {

  el.customerSelect.value =
    id;


  state.selectedCustomer =
    state.customers.find(
      customer =>
        customer.id ===
        id
    ) ||
    null;


  el.contractSelect.value =
    "";


  state.selectedContract =
    null;


  syncCustomer();


  renderContract();


  closeMenus();


  clearMessage();

}


/* ============================================================
   CONTRACT SELECT
============================================================ */

function renderContract() {

  const matches =
    matchingContracts();


  el.contractSelect.innerHTML =
    "";


  const option =
    document.createElement(
      "option"
    );


  option.value =
    "";


  if (
    !el.crop.value
  ) {

    el.contractSelect.disabled =
      true;


    option.textContent =
      "Select crop first";


    setCheck(
      el.contractStatus,
      false,
      "Select the crop first."
    );

  }
  else if (
    !state.selectedSource
  ) {

    el.contractSelect.disabled =
      true;


    option.textContent =
      "Select grain source first";


    setCheck(
      el.contractStatus,
      false,
      "Select a matching bin or grain bag."
    );

  }
  else if (
    !state.selectedLocation
  ) {

    el.contractSelect.disabled =
      true;


    option.textContent =
      "Select destination first";


    setCheck(
      el.contractStatus,
      false,
      "Select a destination with an open matching contract."
    );

  }
  else if (
    !state.selectedCustomer
  ) {

    el.contractSelect.disabled =
      true;


    option.textContent =
      "Select Sold Under first";


    setCheck(
      el.contractStatus,
      false,
      "Select who this grain was sold under."
    );

  }
  else if (
    !matches.length
  ) {

    el.contractSelect.disabled =
      true;


    option.textContent =
      "No open matching contracts";


    setCheck(
      el.contractStatus,
      false,
      "No open contract matches this crop, exact destination, and Sold Under customer."
    );

  }
  else {

    el.contractSelect.disabled =
      false;


    option.textContent =
      matches.length ===
        1
          ? "Select contract"
          : `Select one of ${matches.length} contracts`;


    setCheck(
      el.contractStatus,
      true,
      `${matches.length} possible open contract${matches.length === 1 ? "" : "s"}.`
    );

  }


  el.contractSelect.appendChild(
    option
  );


  matches.forEach(
    contract => {

      const contractOption =
        document.createElement(
          "option"
        );


      contractOption.value =
        contract.id;


      contractOption.textContent =
        contractLabel(
          contract
        );


      el.contractSelect.appendChild(
        contractOption
      );

    }
  );


  state.selectedContract =
    state.contracts.find(
      contract =>
        contract.id ===
        el.contractSelect.value
    ) ||
    null;

}


/* ============================================================
   SUBCONTRACTOR DRIVER
============================================================ */

function selectedSubcontractor() {

  return state.subcontractors.find(
    subcontractor =>
      subcontractor.id ===
      clean(
        el.driverCompany?.value
      )
  ) || null;

}


function selectedSubcontractorDriver() {

  const subcontractor =
    selectedSubcontractor();


  if (
    !subcontractor ||
    !el.driverSelect?.value
  ) {

    return null;

  }


  return (
    Array.isArray(
      subcontractor.drivers
    )
      ? subcontractor.drivers
      : []
  )
    .find(
      driver =>
        clean(
          driver.id
        ) ===
        clean(
          el.driverSelect.value
        )
    ) ||
    null;

}


function syncDriverSelection() {

  const subcontractor =
    selectedSubcontractor();


  const driver =
    selectedSubcontractorDriver();


  if (
    !subcontractor ||
    !driver
  ) {

    state.selectedDriver =
      null;

    return;

  }


  state.selectedDriver = {

    type:
      "subcontractor",

    value:
      `sub:${subcontractor.id}:${driver.id}`,

    id:
      driver.id,

    uid:
      null,

    name:
      driver.name,

    email:
      "",

    phone:
      driver.phone ||
      "",

    subcontractorId:
      subcontractor.id,

    subcontractorName:
      subcontractor.company

  };

}


function renderDriverCompanies() {

  if (
    !el.driverCompany
  ) {

    return;

  }


  const current =
    clean(
      el.driverCompany.value
    );


  el.driverCompany.innerHTML =
    "";


  const blank =
    document.createElement(
      "option"
    );


  blank.value =
    "";


  blank.textContent =
    state.subcontractors.length
      ? "Select trucking company"
      : "No active trucking companies";


  el.driverCompany.appendChild(
    blank
  );


  state.subcontractors.forEach(
    subcontractor => {

      const option =
        document.createElement(
          "option"
        );


      option.value =
        subcontractor.id;


      option.textContent =
        subcontractor.company;


      el.driverCompany.appendChild(
        option
      );

    }
  );


  if (
    current &&
    state.subcontractors.some(
      subcontractor =>
        subcontractor.id ===
        current
    )
  ) {

    el.driverCompany.value =
      current;

  }


  renderSubcontractorDrivers();

}


function renderSubcontractorDrivers() {

  if (
    !el.driverSelect
  ) {

    return;

  }


  const subcontractor =
    selectedSubcontractor();


  const current =
    clean(
      el.driverSelect.value
    );


  el.driverSelect.innerHTML =
    "";


  const blank =
    document.createElement(
      "option"
    );


  blank.value =
    "";


  if (
    !subcontractor
  ) {

    blank.textContent =
      "Select trucking company first";


    el.driverSelect.disabled =
      true;


    if (
      el.addDriverBtn
    ) {

      el.addDriverBtn.disabled =
        true;

    }


    el.addDriverPanel
      ?.classList.remove(
        "show"
      );


    el.driverSelect.appendChild(
      blank
    );


    state.selectedDriver =
      null;


    return;

  }


  const drivers =
    (
      Array.isArray(
        subcontractor.drivers
      )
        ? subcontractor.drivers
        : []
    )
      .filter(
        driver =>
          driver &&
          driver.active !==
            false &&
          clean(
            driver.name
          )
      )
      .slice()
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


  blank.textContent =
    drivers.length
      ? "Select driver"
      : "No drivers saved — add one";


  el.driverSelect.appendChild(
    blank
  );


  drivers.forEach(
    driver => {

      const option =
        document.createElement(
          "option"
        );


      option.value =
        driver.id;


      /*
        Name only.

        No employee email.
        No subcontractor email.
        No driver email.
      */
      option.textContent =
        driver.name;


      el.driverSelect.appendChild(
        option
      );

    }
  );


  el.driverSelect.disabled =
    false;


  if (
    el.addDriverBtn
  ) {

    el.addDriverBtn.disabled =
      false;

  }


  if (
    current &&
    drivers.some(
      driver =>
        driver.id ===
        current
    )
  ) {

    el.driverSelect.value =
      current;

  }


  syncDriverSelection();

}


function formatUSCell(
  value
) {

  const digits =
    clean(
      value
    )
      .replace(
        /\D/g,
        ""
      )
      .replace(
        /^1(?=\d{10}$)/,
        ""
      );


  if (
    digits.length !==
    10
  ) {

    return "";

  }


  return (
    `(${digits.slice(
      0,
      3
    )}) ` +
    `${digits.slice(
      3,
      6
    )}-` +
    digits.slice(
      6
    )
  );

}


function resetAddDriverPanel() {

  if (
    el.driverFirstName
  ) {

    el.driverFirstName.value =
      "";

  }


  if (
    el.driverLastName
  ) {

    el.driverLastName.value =
      "";

  }


  if (
    el.driverCell
  ) {

    el.driverCell.value =
      "";

  }


  el.addDriverPanel
    ?.classList.remove(
      "show"
    );

}


function openAddDriverPanel() {

  const subcontractor =
    selectedSubcontractor();


  if (
    !subcontractor
  ) {

    showMessage(
      "Select a trucking company first."
    );


    return;

  }


  clearMessage();


  el.addDriverPanel
    ?.classList.add(
      "show"
    );


  setTimeout(
    () => {

      el.driverFirstName
        ?.focus();

    },
    0
  );

}


async function saveSubcontractorDriver() {

  const subcontractor =
    selectedSubcontractor();


  if (
    !subcontractor
  ) {

    showMessage(
      "Select a trucking company first."
    );


    return;

  }


  const firstName =
    clean(
      el.driverFirstName?.value
    );


  const lastName =
    clean(
      el.driverLastName?.value
    );


  const phone =
    formatUSCell(
      el.driverCell?.value
    );


  if (
    !firstName ||
    !lastName ||
    !phone
  ) {

    showMessage(
      "Enter the driver's first name, last name, and a valid 10-digit cell number."
    );


    return;

  }


  const existingDriver =
    (
      Array.isArray(
        subcontractor.drivers
      )
        ? subcontractor.drivers
        : []
    )
      .find(
        driver =>
          normalize(
            driver.name
          ) ===
          normalize(
            `${firstName} ${lastName}`
          )
      );


  if (
    existingDriver
  ) {

    showMessage(
      `${existingDriver.name} is already saved under ${subcontractor.company}.`
    );


    el.driverSelect.value =
      existingDriver.id;


    syncDriverSelection();


    return;

  }


  const driverId =
    globalThis.crypto
      ?.randomUUID?.() ||
    (
      `${Date.now()}-` +
      Math.random()
        .toString(36)
        .slice(
          2,
          10
        )
    );


  const newDriver = {

    id:
      driverId,

    firstName,

    lastName,

    name:
      `${firstName} ${lastName}`,

    phone,

    active:
      true,

    createdAtISO:
      new Date()
        .toISOString()

  };


  const nextDrivers = [

    ...(
      Array.isArray(
        subcontractor.drivers
      )
        ? subcontractor.drivers
        : []
    ),

    newDriver

  ];


  if (
    el.driverAddSave
  ) {

    el.driverAddSave.disabled =
      true;


    el.driverAddSave.textContent =
      "Saving…";

  }


  try {

    await updateDoc(

      doc(
        db,
        "subcontractors",
        subcontractor.id
      ),

      {

        drivers:
          nextDrivers,

        updatedAt:
          serverTimestamp()

      }

    );


    subcontractor.drivers =
      nextDrivers;


    renderSubcontractorDrivers();


    el.driverSelect.value =
      driverId;


    syncDriverSelection();


    resetAddDriverPanel();


    showMessage(
      `${newDriver.name} added to ${subcontractor.company}.`,
      "success"
    );

  }
  catch (
    error
  ) {

    console.error(
      "[Grain Ticket Add] subcontractor driver save failed:",
      error
    );


    showMessage(
      "Driver could not be saved. Check Firestore permissions for subcontractors."
    );

  }
  finally {

    if (
      el.driverAddSave
    ) {

      el.driverAddSave.disabled =
        false;


      el.driverAddSave.textContent =
        "Save Driver";

    }

  }

}

/* ============================================================
   VALIDATION
============================================================ */

function validateWeights() {

  const gross =
    numberOrNull(
      el.grossWeight.value
    );


  const tare =
    numberOrNull(
      el.tareWeight.value
    );


  const net =
    numberOrNull(
      el.netWeight.value
    );


  if (
    gross === null ||
    tare === null ||
    net === null
  ) {

    setCheck(
      el.weightCheck,
      false,
      "Weight check incomplete."
    );


    return false;

  }


  if (
    gross <
      30000 ||
    gross >
      110000
  ) {

    setCheck(
      el.weightCheck,
      false,
      "Gross Weight must be between 30,000 and 110,000 lb."
    );


    return false;

  }


  if (
    tare <
      20000 ||
    tare >
      40000
  ) {

    setCheck(
      el.weightCheck,
      false,
      "Tare Weight must be between 20,000 and 40,000 lb."
    );


    return false;

  }


  if (
    net <
      1000 ||
    net >
      80000
  ) {

    setCheck(
      el.weightCheck,
      false,
      "Net Weight must be between 1,000 and 80,000 lb."
    );


    return false;

  }


  if (
    gross -
      tare !==
    net
  ) {

    setCheck(
      el.weightCheck,
      false,
      `${gross.toLocaleString()} Gross - ${tare.toLocaleString()} Tare does not equal ${net.toLocaleString()} Net.`
    );


    return false;

  }


  setCheck(
    el.weightCheck,
    true,
    `✓ ${gross.toLocaleString()} Gross - ${tare.toLocaleString()} Tare = ${net.toLocaleString()} Net.`
  );


  return true;

}


function bushelDivisor() {

  const crop =
    normalize(
      el.crop.value
    );


  if (
    crop ===
    "corn"
  ) {

    return 56;

  }


  if (
    crop ===
      "soybeans" ||
    crop ===
      "wheat"
  ) {

    return 60;

  }


  return null;

}


function calculateBushels() {

  const netWeight =
    numberOrNull(
      el.netWeight.value
    );


  const divisor =
    bushelDivisor();


  if (
    netWeight === null ||
    !divisor
  ) {

    el.grossBushels.value =
      "";


    return;

  }


  const gross =
    Number(
      (
        netWeight /
        divisor
      )
        .toFixed(
          2
        )
    );


  el.grossBushels.value =
    gross.toFixed(
      2
    );


  const shrink =
    numberOrNull(
      el.shrinkBushels.value
    ) ??
    0;


  el.netBushels.value =
    Math.max(
      0,
      Number(
        (
          gross -
          shrink
        )
          .toFixed(
            2
          )
      )
    )
      .toFixed(
        2
      );

}


function validateBushels() {

  const gross =
    numberOrNull(
      el.grossBushels.value
    );


  const shrink =
    numberOrNull(
      el.shrinkBushels.value
    ) ??
    0;


  const net =
    numberOrNull(
      el.netBushels.value
    );


  if (
    gross === null ||
    net === null
  ) {

    setCheck(
      el.bushelCheck,
      false,
      "Bushel check incomplete."
    );


    return false;

  }


  const expected =
    Number(
      (
        gross -
        shrink
      )
        .toFixed(
          2
        )
    );


  if (
    Math.abs(
      expected -
      net
    ) >
    0.02
  ) {

    setCheck(
      el.bushelCheck,
      false,
      `${gross.toFixed(2)} Gross - ${shrink.toFixed(2)} Shrink = ${expected.toFixed(2)} Net, but ticket shows ${net.toFixed(2)}.`
    );


    return false;

  }


  setCheck(
    el.bushelCheck,
    true,
    `✓ ${gross.toFixed(2)} Gross - ${shrink.toFixed(2)} Shrink = ${net.toFixed(2)} Net Bushels.`
  );


  return true;

}


function validateGrade(
  input,
  min,
  max,
  label
) {

  const value =
    numberOrNull(
      input.value
    );


  if (
    value === null
  ) {

    return true;

  }


  if (
    value <
      min ||
    value >
      max
  ) {

    showMessage(
      `${label} must be between ${min} and ${max}.`
    );


    input.focus();


    return false;

  }


  return true;

}


/* ============================================================
   LOAD FIRESTORE REFERENCE DATA
============================================================ */

async function loadReferenceData() {

  const [
    buyerSnap,
    customerSnap,
    locationSnap,
    contractSnap,
    binSnap,
    bagSnap,
    employeeSnap,
    subSnap
  ] =
    await Promise.all([

      getDocs(
        collection(
          db,
          "grain_buyers"
        )
      ),

      getDocs(
        collection(
          db,
          "grain_customers"
        )
      ),

      getDocs(
        collection(
          db,
          "grain_delivery_locations"
        )
      ),

      getDocs(
        collection(
          db,
          "grain_contracts"
        )
      ),

      getDocs(
        collection(
          db,
          "binSites"
        )
      ),

      getDocs(
        collection(
          db,
          "grain_bag_events"
        )
      ),

      getDocs(
        collection(
          db,
          "employees"
        )
      ),

      getDocs(
        collection(
          db,
          "subcontractors"
        )
      )

    ]);


  /* ========================================================
     BUYERS
  ======================================================== */

  state.buyers =
    buyerSnap.docs
      .map(
        snapshot => ({

          id:
            snapshot.id,

          name:
            clean(
              snapshot.data()?.name
            )

        })
      )
      .filter(
        buyer =>
          buyer.name
      )
      .sort(
        (
          a,
          b
        ) =>
          a.name.localeCompare(
            b.name
          )
      );


  const buyerMap =
    new Map(
      state.buyers.map(
        buyer => [
          buyer.id,
          buyer
        ]
      )
    );


  /* ========================================================
     CUSTOMERS
  ======================================================== */

  state.customers =
    customerSnap.docs
      .map(
        snapshot => ({

          id:
            snapshot.id,

          name:
            clean(
              snapshot.data()?.name
            )

        })
      )
      .filter(
        customer =>
          customer.name
      )
      .sort(
        (
          a,
          b
        ) =>
          a.name.localeCompare(
            b.name
          )
      );


  /* ========================================================
     DELIVERY LOCATIONS
  ======================================================== */

  state.locations =
    locationSnap.docs
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
              ) ||
              clean(
                buyerMap.get(
                  clean(
                    data.buyerId
                  )
                )?.name
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
        location =>
          location.locationName
      )
      .sort(
        (
          a,
          b
        ) =>
          `${a.buyerName} ${a.locationName}`
            .localeCompare(
              `${b.buyerName} ${b.locationName}`,
              undefined,
              {
                numeric:
                  true,

                sensitivity:
                  "base"
              }
            )
      );


  state.contracts =
    contractSnap.docs
      .map(
        snapshot => ({

          id:
            snapshot.id,

          ...snapshot.data()

        })
      );


  /* ========================================================
     BIN SOURCES
  ======================================================== */

  state.binSources =
    [];


  binSnap.docs.forEach(
    snapshot => {

      const data =
        snapshot.data() ||
        {};


      const siteName =
        clean(
          data.name
        ) ||
        `Bin Site ${snapshot.id.slice(
          0,
          6
        )}`;


      const fieldId =
        clean(
          data.fieldId ||
          data.farmFieldId ||
          data.field?.id
        );


      const fieldName =
        clean(
          data.fieldName ||
          data.farmFieldName ||
          data.field?.name
        );


      const bins =
        Array.isArray(
          data.bins
        )
          ? data.bins
          : [];


      bins.forEach(
        (
          bin,
          index
        ) => {

          const onHand =
            Number(
              bin?.onHand ||
              0
            );


          if (
            !Number.isFinite(
              onHand
            ) ||
            onHand <=
              0
          ) {

            return;

          }


          const binNumber =
            bin?.num ??
            (
              index +
              1
            );


          const crop =
            clean(
              bin?.lastCropType ||
              bin?.crop ||
              bin?.cropType
            );


          const cropYear =
            clean(
              bin?.cropYear ||
              bin?.lastCropYear ||
              data.cropYear
            );


          state.binSources.push({

            type:
              "bin",

            value:
              `bin:${snapshot.id}:${binNumber}`,

            id:
              `${snapshot.id}:${binNumber}`,

            siteId:
              snapshot.id,

            siteName,

            binNumber,

            binIndex:
              index,

            fieldId,

            fieldName,

            crop,

            cropYear,

            onHand,

            label:
              `${siteName} — Bin ${binNumber}` +
              `${crop ? ` — ${crop}` : ""}` +
              ` — ${Math.round(
                onHand
              ).toLocaleString(
                "en-US"
              )} bu`,

            searchText:
              `${siteName} bin ${binNumber} ${fieldName} ${crop} ${cropYear}`

          });

        }
      );

    }
  );


  state.binSources.sort(
    (
      a,
      b
    ) =>
      a.label.localeCompare(
        b.label,
        undefined,
        {
          numeric:
            true,

          sensitivity:
            "base"
        }
      )
  );


  /* ========================================================
     GRAIN BAG SOURCES
  ======================================================== */

  state.bagSources =
    bagSnap.docs
      .map(
        snapshot => ({

          id:
            snapshot.id,

          ...snapshot.data()

        })
      )
      .filter(
        event => {

          const type =
            normalize(
              event.type
            );


          return (
            type ===
              "putdown" ||
            type ===
              "put down"
          );

        }
      )
      .filter(
        event => {

          const status =
            normalize(
              event.status
            );


          return (
            status !==
              "pickedup" &&
            status !==
              "picked up"
          );

        }
      )
      .map(
        event => {

          const counts =
            event.counts ||
            {};


          const full =
            Math.max(
              0,
              Number(
                counts.full ||
                0
              )
            );


          const partial =
            Math.max(
              0,
              Number(
                counts.partial ||
                0
              )
            );


          const partialFeet =
            Array.isArray(
              event.partialFeet
            )
              ? event.partialFeet.reduce(
                  (
                    sum,
                    value
                  ) =>
                    sum +
                    Math.max(
                      0,
                      Number(
                        value
                      ) ||
                      0
                    ),
                  0
                )
              : 0;


          if (
            full <=
              0 &&
            partial <=
              0 &&
            partialFeet <=
              0
          ) {

            return null;

          }


          const fieldId =
            clean(
              event.field?.id
            );


          const fieldName =
            clean(
              event.field?.name
            ) ||
            "Unknown Field";


          const crop =
            clean(
              event.cropType ||
              event.crop
            );


          const cropYear =
            clean(
              event.cropYear
            );


          const brand =
            clean(
              event.bagSku?.brand
            );


          const location =
            clean(
              event.bagSku?.location
            );


          const sizeFeet =
            clean(
              event.bagSku?.sizeFeet ||
              event.bagSku?.lengthFt
            );


          const details =
            [
              crop,

              cropYear
                ? `CY ${cropYear}`
                : "",

              brand,

              sizeFeet
                ? `${sizeFeet}'`
                : "",

              location,

              full >
                0
                  ? `${full} full`
                  : "",

              partial >
                0
                  ? `${partial} partial`
                  : "",

              partialFeet >
                0
                  ? `${Number(
                      partialFeet.toFixed(
                        1
                      )
                    )} ft partial`
                  : ""
            ]
              .filter(
                Boolean
              );


          return {

            type:
              "grain_bag",

            value:
              `bag:${event.id}`,

            id:
              event.id,

            siteId:
              null,

            siteName:
              null,

            binNumber:
              null,

            binIndex:
              null,

            fieldId,

            fieldName,

            crop,

            cropYear,

            label:
              `${fieldName}${details.length ? ` — ${details.join(" • ")}` : ""}`,

            searchText:
              `${fieldName} ${crop} ${cropYear} ${brand} ${location}`

          };

        }
      )
      .filter(
        Boolean
      )
      .sort(
        (
          a,
          b
        ) =>
          a.label.localeCompare(
            b.label,
            undefined,
            {
              numeric:
                true,

              sensitivity:
                "base"
            }
          )
      );


  /* ========================================================
     EMPLOYEE DRIVERS
  ======================================================== */

  state.employeeDrivers =
    employeeSnap.docs
      .map(
        snapshot => {

          const data =
            snapshot.data() ||
            {};


          const roles =
            Array.isArray(
              data.roles
            )
              ? data.roles
              : (
                  clean(
                    data.role
                  )
                    ? [
                        data.role
                      ]
                    : []
                );


          return {

            type:
              "employee",

            value:
              `emp:${snapshot.id}`,

            id:
              snapshot.id,

            uid:
              clean(
                data.uid ||
                data.userUid ||
                data.authUid
              ) ||
              null,

            name:
              displayDriverName(
                data
              ),

            email:
              clean(
                data.email
              ),

            phone:
              clean(
                data.phone
              ),

            roles,

            active:
              data.active !==
                false &&
              normalize(
                data.status ||
                "Active"
              ) ===
                "active"

          };

        }
      )
      .filter(
        driver =>
          driver.name &&
          driver.active &&
          driver.roles.some(
            role =>
              normalize(
                role
              ) ===
              "semi driver"
          )
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


  /* ========================================================
     TRUCKING SUBCONTRACTORS
  ======================================================== */

  state.subcontractors =
    subSnap.docs
      .map(
        snapshot => {

          const data =
            snapshot.data() ||
            {};


          return {

            id:
              snapshot.id,

            company:
              clean(
                data.company ||
                data.name
              ),

            service:
              clean(
                data.service
              ),

            active:
              data.active !==
                false &&
              normalize(
                data.status ||
                "Active"
              ) ===
                "active",

            drivers:
              (
                Array.isArray(
                  data.drivers
                )
                  ? data.drivers
                  : []
              )
                .map(
                  (
                    driver,
                    index
                  ) => ({

                    id:
                      clean(
                        driver?.id
                      ) ||
                      `legacy-${index}`,

                    name:
                      clean(
                        driver?.name ||
                        [
                          driver?.firstName,
                          driver?.lastName
                        ]
                          .filter(
                            Boolean
                          )
                          .join(
                            " "
                          )
                      ),

                    phone:
                      clean(
                        driver?.phone ||
                        driver?.cell ||
                        driver?.cellPhone
                      ),

                    active:
                      driver?.active !==
                        false

                  })
                )
                .filter(
                  driver =>
                    driver.name &&
                    driver.active
                )

          };

        }
      )
      .filter(
        subcontractor =>
          subcontractor.company &&
          subcontractor.active &&
          normalize(
            subcontractor.service
          ) ===
            "trucking"
      )
      .sort(
        (
          a,
          b
        ) =>
          a.company.localeCompare(
            b.company,
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


/* ============================================================
   DUPLICATE CHECK
============================================================ */

async function duplicateExists() {

  const buyerId =
    clean(
      el.buyerSelect.value
    );


  const ticketNumber =
    clean(
      el.ticketNumber.value
    );


  if (
    !buyerId ||
    !ticketNumber
  ) {

    return false;

  }


  const snapshot =
    await getDocs(
      collection(
        db,
        "grain_tickets"
      )
    );


  return snapshot.docs.some(
    ticketSnapshot => {

      const data =
        ticketSnapshot.data() ||
        {};


      return (
        clean(
          data.buyerId
        ) ===
          buyerId &&
        clean(
          data.ticketNumber
        )
          .toLowerCase() ===
          ticketNumber.toLowerCase()
      );

    }
  );

}


/* ============================================================
   CURRENT SELECTIONS
============================================================ */

function updateSelected() {

  state.selectedSource =
    sourceFromValue(
      el.sourceValue.value
    );


  state.selectedLocation =
    state.locations.find(
      location =>
        location.id ===
        el.locationSelect.value
    ) ||
    null;


  state.selectedBuyer =
    state.selectedLocation
      ? (
          state.buyers.find(
            buyer =>
              buyer.id ===
              state.selectedLocation.buyerId
          ) ||
          {
            id:
              state.selectedLocation.buyerId,

            name:
              state.selectedLocation.buyerName
          }
        )
      : null;


  state.selectedCustomer =
    state.customers.find(
      customer =>
        customer.id ===
        el.customerSelect.value
    ) ||
    null;


  state.selectedContract =
    state.contracts.find(
      contract =>
        contract.id ===
        el.contractSelect.value
    ) ||
    null;


  syncDriverSelection();

}


function validateRequiredLoadDetails() {

  updateSelected();


  const fields = [

    [
      !!el.crop.value,
      "Select the crop."
    ],

    [
      !!state.selectedSource,
      "Select the grain source."
    ],

    [
      !!state.selectedLocation,
      "Select the destination / elevator."
    ],

    [
      !!state.selectedCustomer,
      "Select Sold Under / Customer."
    ],

    [
      !!state.selectedContract,
      "Select the contract."
    ],

    [
      !!state.selectedDriver,
      "Select the driver."
    ]

  ];


  const failed =
    fields.find(
      (
        [
          ok
        ]
      ) =>
        !ok
    );


  if (
    failed
  ) {

    showMessage(
      failed[1]
    );


    return false;

  }


  if (
    normalize(
      state.selectedSource.crop
    ) !==
    normalize(
      el.crop.value
    )
  ) {

    showMessage(
      "The grain source crop no longer matches the ticket crop."
    );


    return false;

  }


  if (
    !matchingContracts()
      .some(
        contract =>
          contract.id ===
          state.selectedContract.id
      )
  ) {

    showMessage(
      "The selected contract no longer matches the crop, destination, and customer."
    );


    return false;

  }


  return true;

}


/* ============================================================
   SAVE
============================================================ */

async function saveTicket(
  event
) {

  event.preventDefault();


  if (
    state.saving
  ) {

    return;

  }


  clearMessage();


  if (
    !el.form.reportValidity()
  ) {

    return;

  }


  if (
    !validateRequiredLoadDetails()
  ) {

    return;

  }


  if (
    !validateWeights()
  ) {

    showMessage(
      "Fix the weight check before saving."
    );


    return;

  }


  if (
    !validateBushels()
  ) {

    showMessage(
      "Fix the bushel check before saving."
    );


    return;

  }


  if (
    !validateGrade(
      el.testWeight,
      30,
      70,
      "Test Weight"
    ) ||
    !validateGrade(
      el.moisture,
      5,
      40,
      "Moisture"
    ) ||
    !validateGrade(
      el.damage,
      0,
      30,
      "Damage"
    ) ||
    !validateGrade(
      el.foreignMaterial,
      0,
      30,
      "FM / BCFM"
    )
  ) {

    return;

  }


  state.saving =
    true;


  el.saveBtn.disabled =
    true;


  el.saveBtn.textContent =
    "Saving…";


  try {

    if (
      await duplicateExists()
    ) {

      throw new Error(
        "It appears this Buyer / Elevator already has a ticket with this Ticket Number."
      );

    }


    const location =
      state.selectedLocation;


    const buyer =
      state.selectedBuyer;


    const customer =
      state.selectedCustomer;


    const contract =
      state.selectedContract;


    const source =
      state.selectedSource;


    const driver =
      state.selectedDriver;


    const contractNumber =
      clean(
        contract.contractNumber ||
        contract.number ||
        contract.contractNo ||
        contract.referenceNumber
      ) ||
      null;


    const payload = {

      buyerId:
        buyer?.id ||
        null,

      buyerName:
        buyer?.name ||
        location?.buyerName ||
        null,


      deliveryLocationId:
        location?.id ||
        null,

      deliveryLocationName:
        location?.locationName ||
        null,

      deliveryStreet:
        location?.street ||
        null,

      deliveryCity:
        location?.city ||
        null,

      deliveryState:
        location?.state ||
        null,

      deliveryZip:
        location?.zip ||
        null,


      customerId:
        customer?.id ||
        null,

      customerName:
        customer?.name ||
        null,


      ticketNumber:
        clean(
          el.ticketNumber.value
        ),

      ticketDate:
        clean(
          el.ticketDate.value
        ),

      crop:
        clean(
          el.crop.value
        ),


      grossWeight:
        numberOrNull(
          el.grossWeight.value
        ),

      tareWeight:
        numberOrNull(
          el.tareWeight.value
        ),

      netWeight:
        numberOrNull(
          el.netWeight.value
        ),


      testWeight:
        numberOrNull(
          el.testWeight.value
        ),

      moisture:
        numberOrNull(
          el.moisture.value
        ),

      damage:
        numberOrNull(
          el.damage.value
        ),

      foreignMaterial:
        numberOrNull(
          el.foreignMaterial.value
        ),


      grossBushels:
        numberOrNull(
          el.grossBushels.value
        ),

      shrinkBushels:
        numberOrNull(
          el.shrinkBushels.value
        ) ??
        0,

      netBushels:
        numberOrNull(
          el.netBushels.value
        ),


      grainSourceType:
        source?.type ||
        null,

      grainSourceValue:
        source?.value ||
        null,

      grainSourceId:
        source?.id ||
        null,

      grainSourceName:
        source?.label ||
        null,

      grainSourceSiteId:
        source?.siteId ||
        null,

      grainSourceSiteName:
        source?.siteName ||
        null,

      grainSourceBinNumber:
        source?.binNumber ??
        null,

      grainSourceBinIndex:
        source?.binIndex ??
        null,

      grainSourceFieldId:
        source?.fieldId ||
        null,

      grainSourceFieldName:
        source?.fieldName ||
        null,

      grainSourceCropYear:
        source?.cropYear ||
        null,


      contractId:
        contract?.id ||
        null,

      contractNumber,

      contractLabel:
        contractLabel(
          contract
        ),

      customerContractMatched:
        true,

      matchingContractIds:
        [
          contract.id
        ],


      driverType:
        driver.type,

      driverId:
        driver.id ||
        null,

      driverUid:
        driver.uid ||
        null,

      driverName:
        driver.name ||
        null,

      driverEmail:
        driver.email ||
        null,

      driverPhone:
        driver.phone ||
        null,


      subcontractorId:
        driver.subcontractorId ||
        null,

      subcontractorName:
        driver.subcontractorName ||
        null,


      entryMethod:
        "manual_entry",

      source:
        "manual",

      validationStatus:
        "verified",

      reconciliationStatus:
        "reconciled",

      reviewReasons:
        [],


      createdByUid:
        state.user?.uid ||
        null,

      createdByName:
        state.user?.displayName ||
        state.user?.email ||
        "FarmVista User",

      createdByEmail:
        state.user?.email ||
        null,


      reviewedByUid:
        state.user?.uid ||
        null,

      reviewedByName:
        state.user?.displayName ||
        state.user?.email ||
        "FarmVista User",

      reviewedByEmail:
        state.user?.email ||
        null,


      createdAt:
        serverTimestamp(),

      updatedAt:
        serverTimestamp(),

      reviewedAt:
        serverTimestamp()

    };


    await addDoc(
      collection(
        db,
        "grain_tickets"
      ),
      payload
    );


    showMessage(
      "Ticket saved and verified.",
      "success"
    );


    window.location.href =
      "/Farm-vista/pages/grain/grain-ticket.html";

  }
  catch (
    error
  ) {

    console.error(
      "[Grain Ticket Add] Save failed:",
      error
    );


    showMessage(
      error?.message ||
      "The grain ticket could not be saved."
    );

  }
  finally {

    state.saving =
      false;


    el.saveBtn.disabled =
      false;


    el.saveBtn.textContent =
      "Save Ticket";

  }

}


/* ============================================================
   RESET AFTER CROP CHANGE
============================================================ */

function clearAfterCrop() {

  el.sourceValue.value =
    "";


  state.selectedSource =
    null;


  el.locationSelect.value =
    "";


  el.buyerSelect.value =
    "";


  state.selectedLocation =
    null;


  state.selectedBuyer =
    null;


  el.customerSelect.value =
    "";


  state.selectedCustomer =
    null;


  el.contractSelect.value =
    "";


  state.selectedContract =
    null;


  syncSource();


  syncDestination();


  syncCustomer();


  renderSource();


  renderDestination();


  renderCustomer();


  renderContract();

}


/* ============================================================
   EVENTS
============================================================ */

function setupEvents() {

  /*
    IMPORTANT:
    Back and Cancel are wired FIRST.

    Even if Firebase loading fails later,
    these buttons still work.
  */

  const goBack =
    () => {

      window.location.href =
        "/Farm-vista/pages/grain/grain-ticket.html";

    };


  el.backBtn?.addEventListener(
    "click",
    goBack
  );


  el.cancelBtn?.addEventListener(
    "click",
    goBack
  );


  el.sourceButton?.addEventListener(
    "click",
    event => {

      event.stopPropagation();


      openMenu(
        el.sourceButton,
        el.sourceMenu,
        renderSource
      );

    }
  );


  el.destinationButton?.addEventListener(
    "click",
    event => {

      event.stopPropagation();


      openMenu(
        el.destinationButton,
        el.destinationMenu,
        renderDestination
      );

    }
  );


  el.customerButton?.addEventListener(
    "click",
    event => {

      event.stopPropagation();


      openMenu(
        el.customerButton,
        el.customerMenu,
        renderCustomer
      );

    }
  );


  el.driverCompany?.addEventListener(
    "change",
    () => {

      if (
        el.driverSelect
      ) {

        el.driverSelect.value =
          "";

      }


      state.selectedDriver =
        null;


      resetAddDriverPanel();


      renderSubcontractorDrivers();


      clearMessage();

    }
  );


  el.driverSelect?.addEventListener(
    "change",
    () => {

      syncDriverSelection();


      clearMessage();

    }
  );


  el.addDriverBtn?.addEventListener(
    "click",
    openAddDriverPanel
  );


  el.driverAddCancel?.addEventListener(
    "click",
    resetAddDriverPanel
  );


  el.driverAddSave?.addEventListener(
    "click",
    saveSubcontractorDriver
  );


  document.addEventListener(
    "click",
    event => {

      const insidePicker =
        [
          el.sourcePicker,
          el.destinationPicker,
          el.customerPicker
        ]
          .some(
            picker =>
              picker?.contains(
                event.target
              )
          );


      if (
        !insidePicker
      ) {

        closeMenus();

      }

    }
  );


  document.addEventListener(
    "keydown",
    event => {

      if (
        event.key ===
        "Escape"
      ) {

        closeMenus();

      }

    }
  );


  el.crop?.addEventListener(
    "change",
    () => {

      clearAfterCrop();


      calculateBushels();


      validateBushels();


      clearMessage();

    }
  );


  el.contractSelect?.addEventListener(
    "change",
    () => {

      state.selectedContract =
        state.contracts.find(
          contract =>
            contract.id ===
            el.contractSelect.value
        ) ||
        null;


      clearMessage();

    }
  );


  [
    el.grossWeight,
    el.tareWeight,
    el.netWeight
  ]
    .filter(
      Boolean
    )
    .forEach(
      input => {

        input.addEventListener(
          "input",
          () => {

            validateWeights();


            calculateBushels();


            validateBushels();

          }
        );

      }
    );


  el.shrinkBushels?.addEventListener(
    "input",
    () => {

      calculateBushels();


      validateBushels();

    }
  );


  el.netBushels?.addEventListener(
    "input",
    validateBushels
  );


  el.form?.addEventListener(
    "submit",
    saveTicket
  );

}


/* ============================================================
   WAIT FOR AUTH
============================================================ */

async function waitForSignedInUser() {

  /*
    Firebase auth can take a moment to restore the signed-in user.

    Do NOT immediately treat auth.currentUser === null as logged out.
  */

  for (
    let attempt =
      0;
    attempt <
      40;
    attempt +=
      1
  ) {

    const user =
      auth.currentUser;


    if (
      user
    ) {

      return user;

    }


    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          250
        )
    );

  }


  return null;

}


/* ============================================================
   START
============================================================ */

async function start() {

  /*
    Wire controls immediately.
    This fixes Back / Cancel even if Firestore fails.
  */

  setupEvents();


  state.user =
    await waitForSignedInUser();


  if (
    !state.user
  ) {

    throw new Error(
      "You must be signed in to add a grain ticket."
    );

  }


  el.ticketDate.value =
    localISO();


  await loadReferenceData();


  syncSource();

  syncDestination();

  syncCustomer();

  renderSource();

  renderDestination();

  renderCustomer();

  renderContract();

  renderDriverCompanies();

  validateWeights();

  validateBushels();

}


/* ============================================================
   START PAGE
============================================================ */

start()
  .catch(
    error => {

      console.error(
        "[Grain Ticket Add] Startup failed:",
        error
      );


      showMessage(
        error?.message ||
        "The Add Grain Ticket page could not load."
      );


      if (
        el.saveBtn
      ) {

        el.saveBtn.disabled =
          true;

      }

    }
  );
