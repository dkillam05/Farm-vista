// /Farm-vista/js/grain-ticket-add.js
// Rev: 2026-08-17-grain-ticket-add-v2
//
// FarmVista — Manual Grain Ticket Entry
//
// MATCHING ORDER:
// 1. Crop
// 2. Grain Source
// 3. Destination / Elevator
// 4. Sold Under / Customer
// 5. Contract
// 6. Ticket Information
// 7. Bushels
// 8. Weights
// 9. Grade Factors
// 10. Driver
//
// RULES:
// - Grain Source must contain the selected crop.
// - Destination must have an open contract for selected crop.
// - Sold Under must have an open contract for destination + crop.
// - Contract must match crop + destination + customer.
// - Driver is assigned manually on this page.
// - Gross - Tare must equal Net.
// - Gross bushels calculated from Net Weight.
// - Net Bushels must equal Gross Bushels - Shrink.
// - Duplicate Buyer + Ticket Number is blocked.

import {
  ready,
  getFirestore,
  collection,
  getDocs,
  addDoc,
  query,
  orderBy,
  where,
  serverTimestamp,
  getAuth
} from "/Farm-vista/js/firebase-init.js";

await ready;

const db = getFirestore();
const auth = getAuth();

const $ = id => document.getElementById(id);

/* ============================================================
   COLLECTIONS
============================================================ */

const BUYER_COLLECTION = "grain_buyers";
const CUSTOMER_COLLECTION = "grain_customers";
const LOCATION_COLLECTION = "grain_delivery_locations";
const CONTRACT_COLLECTION = "grain_contracts";
const TICKET_COLLECTION = "grain_tickets";
const EMPLOYEE_COLLECTION = "employees";
const SUBCONTRACTOR_COLLECTION = "subcontractors";
const GRAIN_INVENTORY_COLLECTION = "grain_inventory";

/* ============================================================
   STATE
============================================================ */

const state = {
  user: null,

  buyers: [],
  customers: [],
  deliveryLocations: [],
  contracts: [],
  grainInventory: [],

  employeeDrivers: [],
  subcontractorDrivers: [],
  drivers: [],

  selectedSource: null,
  selectedBuyer: null,
  selectedCustomer: null,
  selectedDeliveryLocation: null,
  selectedContract: null,
  selectedDriver: null,

  saving: false
};

/* ============================================================
   LIMITS
============================================================ */

const LIMITS = {
  grossWeight: {
    min: 30000,
    max: 110000
  },

  tareWeight: {
    min: 20000,
    max: 40000
  },

  netWeight: {
    min: 1000,
    max: 80000
  },

  testWeight: {
    min: 30,
    max: 70
  },

  moisture: {
    min: 5,
    max: 40
  },

  damage: {
    min: 0,
    max: 30
  },

  foreignMaterial: {
    min: 0,
    max: 30
  }
};

/* ============================================================
   ELEMENTS
============================================================ */

const elements = {
  form: $("grain-ticket-form"),
  message: $("message"),

  crop: $("crop"),

  sourceLookup: $("source-lookup"),
  sourceSearch: $("source-search"),
  sourceId: $("source-id"),
  sourceName: $("source-name"),
  sourceType: $("source-type"),
  sourceMenu: $("source-menu"),

  buyerLookup: $("buyer-lookup"),
  buyerSearch: $("buyer-search"),
  buyerId: $("buyer-id"),
  buyerName: $("buyer-name"),
  buyerMenu: $("buyer-menu"),

  locationLookup: $("delivery-location-lookup"),
  locationSearch: $("delivery-location-search"),
  locationId: $("delivery-location-id"),
  locationMenu: $("delivery-location-menu"),

  customerLookup: $("customer-lookup"),
  customerSearch: $("customer-search"),
  customerId: $("customer-id"),
  customerName: $("customer-name"),
  customerMenu: $("customer-menu"),

  contractLookup: $("contract-lookup"),
  contractSearch: $("contract-search"),
  contractId: $("contract-id"),
  contractNumber: $("contract-number"),
  contractMenu: $("contract-menu"),
  contractStatus: $("contract-status"),

  ticketNumber: $("ticket-number"),
  ticketDate: $("ticket-date"),

  grossBushels: $("gross-bushels"),
  shrinkBushels: $("shrink-bushels"),
  netBushels: $("net-bushels"),
  bushelCheck: $("bushel-check"),

  grossWeight: $("gross-weight"),
  tareWeight: $("tare-weight"),
  netWeight: $("net-weight"),
  weightCheck: $("weight-check"),

  testWeight: $("test-weight"),
  moisture: $("moisture"),
  damage: $("damage"),
  foreignMaterial: $("foreign-material"),

  driverLookup: $("driver-lookup"),
  driverSearch: $("driver-search"),
  driverId: $("driver-id"),
  driverName: $("driver-name"),
  driverEmail: $("driver-email"),
  driverMenu: $("driver-menu"),

  cancelBtn: $("cancel-btn"),
  saveBtn: $("save-btn")
};

/* ============================================================
   GENERAL HELPERS
============================================================ */

function clean(value) {
  return String(value ?? "").trim();
}

function normalized(value) {
  return clean(value).toLowerCase();
}

function cleanNumber(value) {
  const text = clean(value)
    .replace(/,/g, "")
    .replace(/[^\d.-]/g, "");

  if (!text) return null;

  const number = Number(text);

  return Number.isFinite(number)
    ? number
    : null;
}

function formatTwoDecimals(value) {
  const number = cleanNumber(value);

  if (number === null) return "";

  return number.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function showMessage(text, type = "") {
  if (!elements.message) return;

  elements.message.textContent = text;
  elements.message.className = `message show ${type}`;

  elements.message.scrollIntoView({
    behavior: "smooth",
    block: "nearest"
  });
}

function clearMessage() {
  if (!elements.message) return;

  elements.message.textContent = "";
  elements.message.className = "message";
}

function formatAddress(location) {
  const cityState = [
    location.city,
    location.state
  ]
    .filter(Boolean)
    .join(", ");

  const cityStateZip = [
    cityState,
    location.zip
  ]
    .filter(Boolean)
    .join(" ");

  return [
    location.street,
    cityStateZip
  ]
    .filter(Boolean)
    .join(" • ");
}

function contractIsOpen(contract) {
  const status = normalized(contract.status);

  if (
    status === "closed" ||
    status === "complete" ||
    status === "completed" ||
    status === "cancelled" ||
    status === "canceled" ||
    status === "archived"
  ) {
    return false;
  }

  const remaining =
    cleanNumber(
      contract.remainingBushels ??
      contract.bushelsRemaining ??
      contract.remaining
    );

  if (remaining !== null && remaining <= 0) {
    return false;
  }

  return true;
}

function contractMatchesCrop(contract) {
  return (
    normalized(contract.crop) ===
    normalized(elements.crop?.value)
  );
}

function contractMatchesBuyer(contract, buyer) {
  if (!buyer) return false;

  if (clean(contract.buyerId)) {
    return clean(contract.buyerId) === buyer.id;
  }

  return (
    normalized(contract.buyerName) ===
    normalized(buyer.name)
  );
}

function contractMatchesCustomer(contract, customer) {
  if (!customer) return false;

  if (clean(contract.customerId)) {
    return clean(contract.customerId) === customer.id;
  }

  return (
    normalized(contract.customerName) ===
    normalized(customer.name)
  );
}

function contractMatchesLocation(contract, location) {
  if (!location) return false;

  const contractLocationId = clean(
    contract.deliveryLocationId ||
    contract.locationId
  );

  if (contractLocationId) {
    return contractLocationId === location.id;
  }

  const contractLocationName = clean(
    contract.deliveryLocationName ||
    contract.deliveryLocation ||
    contract.locationName
  );

  if (contractLocationName) {
    return (
      normalized(contractLocationName) ===
      normalized(location.locationName)
    );
  }

  /*
    Older contracts may not have a deliveryLocationId.
    Buyer match is still required elsewhere.
  */
  return true;
}

function remainingBushels(contract) {
  return cleanNumber(
    contract.remainingBushels ??
    contract.bushelsRemaining ??
    contract.remaining
  );
}

/* ============================================================
   USER
============================================================ */

async function initializeUser() {
  let attempts = 0;
  const maxAttempts = 40;

  return new Promise(resolve => {
    const checkUser = () => {
      attempts += 1;

      const user =
        auth?.currentUser ||
        null;

      if (user) {
        state.user = user;
        resolve(user);
        return;
      }

      if (attempts >= maxAttempts) {
        state.user = null;

        showMessage(
          "Your FarmVista user account could not be loaded. Refresh the page or sign in again.",
          "error"
        );

        resolve(null);
        return;
      }

      setTimeout(checkUser, 250);
    };

    checkUser();
  });
}

/* ============================================================
   FIRESTORE DATA
============================================================ */

async function loadData() {
  const [
    buyerSnapshot,
    customerSnapshot,
    locationSnapshot,
    contractSnapshot,
    inventorySnapshot,
    employeeSnapshot,
    subcontractorSnapshot
  ] = await Promise.all([
    getDocs(
      query(
        collection(db, BUYER_COLLECTION),
        orderBy("name")
      )
    ),

    getDocs(
      query(
        collection(db, CUSTOMER_COLLECTION),
        orderBy("name")
      )
    ),

    getDocs(
      collection(db, LOCATION_COLLECTION)
    ),

    getDocs(
      collection(db, CONTRACT_COLLECTION)
    ),

    getDocs(
      collection(db, GRAIN_INVENTORY_COLLECTION)
    ),

    getDocs(
      collection(db, EMPLOYEE_COLLECTION)
    ),

    getDocs(
      collection(db, SUBCONTRACTOR_COLLECTION)
    )
  ]);

  state.buyers = buyerSnapshot.docs
    .map(docSnapshot => {
      const data = docSnapshot.data() || {};

      return {
        id: docSnapshot.id,
        name: clean(data.name)
      };
    })
    .filter(item => item.name);

  state.customers = customerSnapshot.docs
    .map(docSnapshot => {
      const data = docSnapshot.data() || {};

      return {
        id: docSnapshot.id,
        name: clean(data.name)
      };
    })
    .filter(item => item.name);

  state.deliveryLocations = locationSnapshot.docs
    .map(docSnapshot => {
      const data = docSnapshot.data() || {};

      return {
        id: docSnapshot.id,
        buyerId: clean(data.buyerId),
        buyerName: clean(data.buyerName),
        locationName: clean(
          data.locationName ||
          data.name
        ),
        street: clean(data.street),
        city: clean(data.city),
        state: clean(data.state),
        zip: clean(data.zip)
      };
    })
    .filter(item => item.locationName);

  state.contracts = contractSnapshot.docs
    .map(docSnapshot => ({
      id: docSnapshot.id,
      ...docSnapshot.data()
    }));

  state.grainInventory = inventorySnapshot.docs
    .map(docSnapshot => ({
      id: docSnapshot.id,
      ...docSnapshot.data()
    }));

  /* ========================================================
     EMPLOYEE DRIVERS
  ======================================================== */

  state.employeeDrivers = employeeSnapshot.docs
    .map(docSnapshot => {
      const data = docSnapshot.data() || {};

      const name = clean(
        data.fullName ||
        [
          data.firstName,
          data.lastName
        ]
          .filter(Boolean)
          .join(" ")
      );

      const roles = Array.isArray(data.roles)
        ? data.roles.map(normalized)
        : [normalized(data.role)];

      return {
        id: docSnapshot.id,

        uid:
          clean(
            data.uid ||
            data.userUid ||
            data.authUid
          ) || null,

        name,

        email: clean(data.email),

        type: "employee",

        companyName: "",

        active:
          data.active !== false &&
          data.archived !== true,

        isSemiDriver:
          roles.some(role =>
            role === "semi driver" ||
            role === "semi_driver" ||
            role === "semidriver"
          )
      };
    })
    .filter(driver =>
      driver.name &&
      driver.active &&
      driver.isSemiDriver
    );

  /* ========================================================
     SUBCONTRACTOR DRIVERS
  ======================================================== */

  state.subcontractorDrivers = [];

  subcontractorSnapshot.docs.forEach(docSnapshot => {
    const data = docSnapshot.data() || {};

    const service = normalized(
      data.service ||
      data.category ||
      data.type
    );

    const isTrucking =
      service === "trucking" ||
      service.includes("truck");

    if (!isTrucking) return;

    if (
      data.active === false ||
      data.archived === true
    ) {
      return;
    }

    const companyName = clean(
      data.name ||
      data.companyName
    );

    const drivers =
      Array.isArray(data.drivers)
        ? data.drivers
        : [];

    drivers.forEach((driver, index) => {
      if (!driver) return;

      if (
        driver.active === false ||
        driver.archived === true
      ) {
        return;
      }

      const name = clean(
        driver.fullName ||
        driver.name ||
        [
          driver.firstName,
          driver.lastName
        ]
          .filter(Boolean)
          .join(" ")
      );

      if (!name) return;

      state.subcontractorDrivers.push({
        id:
          clean(driver.id) ||
          `${docSnapshot.id}-${index}`,

        uid: null,

        name,

        email: clean(driver.email),

        phone: clean(
          driver.phone ||
          driver.cell ||
          driver.cellPhone
        ),

        type: "subcontractor",

        subcontractorId: docSnapshot.id,

        companyName
      });
    });
  });

  state.employeeDrivers.sort((a, b) =>
    a.name.localeCompare(
      b.name,
      undefined,
      {
        numeric: true,
        sensitivity: "base"
      }
    )
  );

  state.subcontractorDrivers.sort((a, b) =>
    a.name.localeCompare(
      b.name,
      undefined,
      {
        numeric: true,
        sensitivity: "base"
      }
    )
  );

  state.drivers = [
    ...state.employeeDrivers,
    ...state.subcontractorDrivers
  ];

  renderSourceOptions("");
  renderBuyerOptions("");
  renderCustomerOptions("");
  renderDeliveryLocationOptions("");
  renderContractOptions("");
  renderDriverOptions("");
}

/* ============================================================
   GRAIN SOURCE
============================================================ */

function inventoryCrop(item) {
  return clean(
    item.crop ||
    item.cropName ||
    item.grainType
  );
}

function inventoryBushels(item) {
  return cleanNumber(
    item.bushels ??
    item.currentBushels ??
    item.quantityBushels ??
    item.inventoryBushels ??
    item.estimatedBushels
  );
}

function sourceDisplayName(item) {
  const site = clean(
    item.siteName ||
    item.farmName ||
    item.locationName
  );

  const source = clean(
    item.binName ||
    item.bagName ||
    item.sourceName ||
    item.name
  );

  if (site && source) {
    return `${site} • ${source}`;
  }

  return source || site || "Grain Source";
}

function sourceType(item) {
  const explicit = normalized(
    item.sourceType ||
    item.type ||
    item.storageType
  );

  if (explicit.includes("bag")) {
    return "bag";
  }

  if (explicit.includes("bin")) {
    return "bin";
  }

  if (
    item.bagId ||
    item.bagName
  ) {
    return "bag";
  }

  return "bin";
}

function availableSources() {
  const crop = normalized(
    elements.crop?.value
  );

  if (!crop) return [];

  return state.grainInventory
    .filter(item =>
      normalized(inventoryCrop(item)) === crop
    )
    .filter(item => {
      const bushels = inventoryBushels(item);

      /*
        If inventory quantity exists, it must be > 0.
        Older records without quantity are still allowed.
      */
      return (
        bushels === null ||
        bushels > 0
      );
    });
}

function setupSourcePicker() {
  if (!elements.sourceSearch) return;

  elements.sourceSearch.addEventListener(
    "focus",
    () => {
      if (!elements.crop.value) return;

      elements.sourceLookup.classList.add("open");

      renderSourceOptions(
        elements.sourceSearch.value
      );
    }
  );

  elements.sourceSearch.addEventListener(
    "input",
    () => {
      if (
        state.selectedSource &&
        elements.sourceSearch.value !==
          sourceDisplayName(state.selectedSource)
      ) {
        clearSourceSelection(false);
      }

      elements.sourceLookup.classList.add("open");

      renderSourceOptions(
        elements.sourceSearch.value
      );
    }
  );
}

function renderSourceOptions(searchText) {
  if (!elements.sourceMenu) return;

  elements.sourceMenu.innerHTML = "";

  if (!elements.crop?.value) {
    const empty = document.createElement("div");

    empty.className = "lookup-empty";
    empty.textContent = "Select Crop first.";

    elements.sourceMenu.appendChild(empty);
    return;
  }

  const search = normalized(searchText);

  const filtered = availableSources()
    .filter(item => {
      const combined = [
        sourceDisplayName(item),
        inventoryCrop(item),
        sourceType(item)
      ].join(" ");

      return (
        !search ||
        normalized(combined).includes(search)
      );
    });

  if (!filtered.length) {
    const empty = document.createElement("div");

    empty.className = "lookup-empty";
    empty.textContent =
      "No grain sources with this crop were found.";

    elements.sourceMenu.appendChild(empty);
    return;
  }

  filtered.forEach(item => {
    const button = document.createElement("button");

    button.type = "button";
    button.className = "lookup-option";

    const title = document.createElement("span");

    title.className = "lookup-option-title";
    title.textContent = sourceDisplayName(item);

    const sub = document.createElement("span");

    sub.className = "lookup-option-sub";

    const bushels = inventoryBushels(item);

    sub.textContent = [
      sourceType(item) === "bag"
        ? "Grain Bag"
        : "Grain Bin",

      bushels !== null
        ? `${bushels.toLocaleString("en-US", {
            maximumFractionDigits: 2
          })} bu`
        : ""
    ]
      .filter(Boolean)
      .join(" • ");

    button.appendChild(title);
    button.appendChild(sub);

    button.addEventListener(
      "click",
      () => selectSource(item)
    );

    elements.sourceMenu.appendChild(button);
  });
}

function selectSource(item) {
  state.selectedSource = item;

  elements.sourceSearch.value =
    sourceDisplayName(item);

  if (elements.sourceId) {
    elements.sourceId.value = item.id;
  }

  if (elements.sourceName) {
    elements.sourceName.value =
      sourceDisplayName(item);
  }

  if (elements.sourceType) {
    elements.sourceType.value =
      sourceType(item);
  }

  elements.sourceSearch.setCustomValidity("");

  elements.sourceLookup.classList.remove("open");
}

function clearSourceSelection(clearText = true) {
  state.selectedSource = null;

  if (elements.sourceId) {
    elements.sourceId.value = "";
  }

  if (elements.sourceName) {
    elements.sourceName.value = "";
  }

  if (elements.sourceType) {
    elements.sourceType.value = "";
  }

  if (clearText && elements.sourceSearch) {
    elements.sourceSearch.value = "";
  }
}

/* ============================================================
   DESTINATION / BUYER
============================================================ */

function availableBuyers() {
  const crop = elements.crop?.value;

  if (!crop) return [];

  const allowedBuyerIds = new Set();

  state.contracts.forEach(contract => {
    if (
      !contractIsOpen(contract) ||
      !contractMatchesCrop(contract)
    ) {
      return;
    }

    const buyerId = clean(contract.buyerId);

    if (buyerId) {
      allowedBuyerIds.add(buyerId);
    }
  });

  return state.buyers.filter(buyer =>
    allowedBuyerIds.has(buyer.id)
  );
}

function setupBuyerPicker() {
  elements.buyerSearch.addEventListener(
    "focus",
    () => {
      if (!elements.crop.value) return;

      elements.buyerLookup.classList.add("open");

      renderBuyerOptions(
        elements.buyerSearch.value
      );
    }
  );

  elements.buyerSearch.addEventListener(
    "input",
    () => {
      if (
        state.selectedBuyer &&
        elements.buyerSearch.value !==
          state.selectedBuyer.name
      ) {
        clearBuyerSelection(false);
      }

      elements.buyerLookup.classList.add("open");

      renderBuyerOptions(
        elements.buyerSearch.value
      );
    }
  );
}

function renderBuyerOptions(searchText) {
  elements.buyerMenu.innerHTML = "";

  if (!elements.crop.value) {
    const empty = document.createElement("div");

    empty.className = "lookup-empty";
    empty.textContent = "Select Crop first.";

    elements.buyerMenu.appendChild(empty);
    return;
  }

  const search = normalized(searchText);

  const filtered = availableBuyers()
    .filter(buyer =>
      !search ||
      normalized(buyer.name).includes(search)
    );

  if (!filtered.length) {
    const empty = document.createElement("div");

    empty.className = "lookup-empty";
    empty.textContent =
      "No destinations have an open contract for this crop.";

    elements.buyerMenu.appendChild(empty);
    return;
  }

  filtered.forEach(buyer => {
    const button = document.createElement("button");

    button.type = "button";
    button.className = "lookup-option";
    button.textContent = buyer.name;

    button.addEventListener(
      "click",
      () => selectBuyer(buyer)
    );

    elements.buyerMenu.appendChild(button);
  });
}

function selectBuyer(buyer) {
  state.selectedBuyer = buyer;

  elements.buyerSearch.value = buyer.name;
  elements.buyerId.value = buyer.id;
  elements.buyerName.value = buyer.name;

  elements.buyerSearch.setCustomValidity("");
  elements.buyerLookup.classList.remove("open");

  clearDeliveryLocationSelection();
  clearCustomerSelection();
  clearContractSelection();

  elements.locationSearch.disabled = false;
  elements.locationSearch.placeholder =
    "Search Delivery Location";

  renderDeliveryLocationOptions("");
}

function clearBuyerSelection(clearText = true) {
  state.selectedBuyer = null;

  elements.buyerId.value = "";
  elements.buyerName.value = "";

  if (clearText) {
    elements.buyerSearch.value = "";
  }

  clearDeliveryLocationSelection();
  clearCustomerSelection();
  clearContractSelection();

  elements.locationSearch.value = "";
  elements.locationSearch.disabled = true;
  elements.locationSearch.placeholder =
    "Select Destination first";

  elements.customerSearch.value = "";
  elements.customerSearch.disabled = true;

  if (elements.contractSearch) {
    elements.contractSearch.value = "";
    elements.contractSearch.disabled = true;
  }
}

/* ============================================================
   DELIVERY LOCATION
============================================================ */

function availableDeliveryLocations() {
  if (
    !state.selectedBuyer ||
    !elements.crop.value
  ) {
    return [];
  }

  return state.deliveryLocations.filter(location => {
    if (
      location.buyerId &&
      location.buyerId !== state.selectedBuyer.id
    ) {
      return false;
    }

    return state.contracts.some(contract =>
      contractIsOpen(contract) &&
      contractMatchesCrop(contract) &&
      contractMatchesBuyer(
        contract,
        state.selectedBuyer
      ) &&
      contractMatchesLocation(
        contract,
        location
      )
    );
  });
}

function setupDeliveryLocationPicker() {
  elements.locationSearch.addEventListener(
    "focus",
    () => {
      if (!state.selectedBuyer) return;

      elements.locationLookup.classList.add("open");

      renderDeliveryLocationOptions(
        elements.locationSearch.value
      );
    }
  );

  elements.locationSearch.addEventListener(
    "input",
    () => {
      if (!state.selectedBuyer) return;

      if (
        state.selectedDeliveryLocation &&
        elements.locationSearch.value !==
          state.selectedDeliveryLocation.locationName
      ) {
        clearDeliveryLocationSelection(false);
      }

      elements.locationLookup.classList.add("open");

      renderDeliveryLocationOptions(
        elements.locationSearch.value
      );
    }
  );
}

function renderDeliveryLocationOptions(searchText) {
  elements.locationMenu.innerHTML = "";

  if (!state.selectedBuyer) {
    const empty = document.createElement("div");

    empty.className = "lookup-empty";
    empty.textContent = "Select Destination first.";

    elements.locationMenu.appendChild(empty);
    return;
  }

  const search = normalized(searchText);

  const filtered = availableDeliveryLocations()
    .filter(location => {
      const combined = [
        location.locationName,
        location.street,
        location.city,
        location.state,
        location.zip
      ].join(" ");

      return (
        !search ||
        normalized(combined).includes(search)
      );
    });

  if (!filtered.length) {
    const empty = document.createElement("div");

    empty.className = "lookup-empty";
    empty.textContent =
      "No delivery locations with an open matching contract.";

    elements.locationMenu.appendChild(empty);
    return;
  }

  filtered.forEach(location => {
    const button = document.createElement("button");

    button.type = "button";
    button.className = "lookup-option";

    const title = document.createElement("span");

    title.className = "lookup-option-title";
    title.textContent = location.locationName;

    const sub = document.createElement("span");

    sub.className = "lookup-option-sub";
    sub.textContent = formatAddress(location);

    button.appendChild(title);

    if (sub.textContent) {
      button.appendChild(sub);
    }

    button.addEventListener(
      "click",
      () => selectDeliveryLocation(location)
    );

    elements.locationMenu.appendChild(button);
  });
}

function selectDeliveryLocation(location) {
  state.selectedDeliveryLocation = location;

  elements.locationSearch.value =
    location.locationName;

  elements.locationId.value =
    location.id;

  elements.locationSearch.setCustomValidity("");
  elements.locationLookup.classList.remove("open");

  clearCustomerSelection();
  clearContractSelection();

  elements.customerSearch.disabled = false;
  elements.customerSearch.placeholder =
    "Search Customer / Vendor";

  renderCustomerOptions("");
}

function clearDeliveryLocationSelection(
  clearText = true
) {
  state.selectedDeliveryLocation = null;

  elements.locationId.value = "";

  if (clearText) {
    elements.locationSearch.value = "";
  }

  clearCustomerSelection();
  clearContractSelection();

  elements.customerSearch.value = "";
  elements.customerSearch.disabled = true;
  elements.customerSearch.placeholder =
    "Select Delivery Location first";
}

/* ============================================================
   SOLD UNDER / CUSTOMER
============================================================ */

function availableCustomers() {
  if (
    !state.selectedBuyer ||
    !state.selectedDeliveryLocation ||
    !elements.crop.value
  ) {
    return [];
  }

  const customerIds = new Set();

  state.contracts.forEach(contract => {
    if (
      !contractIsOpen(contract) ||
      !contractMatchesCrop(contract) ||
      !contractMatchesBuyer(
        contract,
        state.selectedBuyer
      ) ||
      !contractMatchesLocation(
        contract,
        state.selectedDeliveryLocation
      )
    ) {
      return;
    }

    const customerId =
      clean(contract.customerId);

    if (customerId) {
      customerIds.add(customerId);
    }
  });

  return state.customers.filter(customer =>
    customerIds.has(customer.id)
  );
}

function setupCustomerPicker() {
  elements.customerSearch.addEventListener(
    "focus",
    () => {
      if (!state.selectedDeliveryLocation) return;

      elements.customerLookup.classList.add("open");

      renderCustomerOptions(
        elements.customerSearch.value
      );
    }
  );

  elements.customerSearch.addEventListener(
    "input",
    () => {
      if (
        state.selectedCustomer &&
        elements.customerSearch.value !==
          state.selectedCustomer.name
      ) {
        clearCustomerSelection(false);
      }

      elements.customerLookup.classList.add("open");

      renderCustomerOptions(
        elements.customerSearch.value
      );
    }
  );
}

function renderCustomerOptions(searchText) {
  elements.customerMenu.innerHTML = "";

  if (!state.selectedDeliveryLocation) {
    const empty = document.createElement("div");

    empty.className = "lookup-empty";
    empty.textContent =
      "Select Delivery Location first.";

    elements.customerMenu.appendChild(empty);
    return;
  }

  const search = normalized(searchText);

  const filtered = availableCustomers()
    .filter(customer =>
      !search ||
      normalized(customer.name).includes(search)
    );

  if (!filtered.length) {
    const empty = document.createElement("div");

    empty.className = "lookup-empty";
    empty.textContent =
      "No customers have an open contract for this destination and crop.";

    elements.customerMenu.appendChild(empty);
    return;
  }

  filtered.forEach(customer => {
    const button = document.createElement("button");

    button.type = "button";
    button.className = "lookup-option";
    button.textContent = customer.name;

    button.addEventListener(
      "click",
      () => selectCustomer(customer)
    );

    elements.customerMenu.appendChild(button);
  });
}

function selectCustomer(customer) {
  state.selectedCustomer = customer;

  elements.customerSearch.value = customer.name;
  elements.customerId.value = customer.id;
  elements.customerName.value = customer.name;

  elements.customerSearch.setCustomValidity("");
  elements.customerLookup.classList.remove("open");

  clearContractSelection();

  if (elements.contractSearch) {
    elements.contractSearch.disabled = false;
    elements.contractSearch.placeholder =
      "Search Contract";
  }

  renderContractOptions("");
}

function clearCustomerSelection(
  clearText = true
) {
  state.selectedCustomer = null;

  elements.customerId.value = "";
  elements.customerName.value = "";

  if (clearText) {
    elements.customerSearch.value = "";
  }

  clearContractSelection();

  if (elements.contractSearch) {
    elements.contractSearch.value = "";
    elements.contractSearch.disabled = true;
    elements.contractSearch.placeholder =
      "Select Sold Under first";
  }
}

/* ============================================================
   CONTRACT
============================================================ */

function matchingContracts() {
  if (
    !state.selectedBuyer ||
    !state.selectedDeliveryLocation ||
    !state.selectedCustomer ||
    !elements.crop.value
  ) {
    return [];
  }

  return state.contracts.filter(contract =>
    contractIsOpen(contract) &&
    contractMatchesCrop(contract) &&
    contractMatchesBuyer(
      contract,
      state.selectedBuyer
    ) &&
    contractMatchesLocation(
      contract,
      state.selectedDeliveryLocation
    ) &&
    contractMatchesCustomer(
      contract,
      state.selectedCustomer
    )
  );
}

function contractLabel(contract) {
  const number = clean(
    contract.contractNumber ||
    contract.number
  );

  const remaining =
    remainingBushels(contract);

  if (remaining !== null) {
    return `${number || "Contract"} • ${remaining.toLocaleString(
      "en-US",
      {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }
    )} bu left`;
  }

  return number || "Contract";
}

function setupContractPicker() {
  if (!elements.contractSearch) return;

  elements.contractSearch.addEventListener(
    "focus",
    () => {
      if (!state.selectedCustomer) return;

      elements.contractLookup.classList.add("open");

      renderContractOptions(
        elements.contractSearch.value
      );
    }
  );

  elements.contractSearch.addEventListener(
    "input",
    () => {
      if (
        state.selectedContract &&
        elements.contractSearch.value !==
          contractLabel(state.selectedContract)
      ) {
        clearContractSelection(false);
      }

      elements.contractLookup.classList.add("open");

      renderContractOptions(
        elements.contractSearch.value
      );
    }
  );
}

function renderContractOptions(searchText) {
  if (!elements.contractMenu) return;

  elements.contractMenu.innerHTML = "";

  if (!state.selectedCustomer) {
    const empty = document.createElement("div");

    empty.className = "lookup-empty";
    empty.textContent = "Select Sold Under first.";

    elements.contractMenu.appendChild(empty);
    return;
  }

  const search = normalized(searchText);

  const filtered = matchingContracts()
    .filter(contract => {
      const combined = [
        contractLabel(contract),
        contract.contractNumber,
        contract.number
      ].join(" ");

      return (
        !search ||
        normalized(combined).includes(search)
      );
    });

  if (!filtered.length) {
    const empty = document.createElement("div");

    empty.className = "lookup-empty";
    empty.textContent =
      "No open matching contracts were found.";

    elements.contractMenu.appendChild(empty);

    updateContractStatus();
    return;
  }

  filtered.forEach(contract => {
    const button = document.createElement("button");

    button.type = "button";
    button.className = "lookup-option";

    const title = document.createElement("span");

    title.className = "lookup-option-title";
    title.textContent = contractLabel(contract);

    button.appendChild(title);

    button.addEventListener(
      "click",
      () => selectContract(contract)
    );

    elements.contractMenu.appendChild(button);
  });

  updateContractStatus();
}

function selectContract(contract) {
  state.selectedContract = contract;

  if (elements.contractSearch) {
    elements.contractSearch.value =
      contractLabel(contract);

    elements.contractSearch.setCustomValidity("");
  }

  if (elements.contractId) {
    elements.contractId.value = contract.id;
  }

  if (elements.contractNumber) {
    elements.contractNumber.value =
      clean(
        contract.contractNumber ||
        contract.number
      );
  }

  if (elements.contractLookup) {
    elements.contractLookup.classList.remove("open");
  }

  updateContractStatus();
}

function clearContractSelection(
  clearText = true
) {
  state.selectedContract = null;

  if (elements.contractId) {
    elements.contractId.value = "";
  }

  if (elements.contractNumber) {
    elements.contractNumber.value = "";
  }

  if (
    clearText &&
    elements.contractSearch
  ) {
    elements.contractSearch.value = "";
  }

  updateContractStatus();
}

function updateContractStatus() {
  if (!elements.contractStatus) return;

  elements.contractStatus.className =
    "contract-status";

  elements.contractStatus.textContent = "";

  if (!state.selectedCustomer) {
    return;
  }

  const matches = matchingContracts();

  if (!matches.length) {
    elements.contractStatus.className =
      "contract-status warning";

    elements.contractStatus.textContent =
      "No open contract matches the selected Crop, Destination, Delivery Location, and Sold Under.";

    return;
  }

  if (!state.selectedContract) {
    elements.contractStatus.className =
      "contract-status good";

    elements.contractStatus.textContent =
      matches.length === 1
        ? "✓ 1 matching contract available."
        : `✓ ${matches.length} matching contracts available.`;

    return;
  }

  elements.contractStatus.className =
    "contract-status good";

  elements.contractStatus.textContent =
    `✓ Assigned to ${contractLabel(
      state.selectedContract
    )}.`;
}

/* ============================================================
   DRIVER
============================================================ */

function setupDriverPicker() {
  elements.driverSearch.addEventListener(
    "focus",
    () => {
      elements.driverLookup.classList.add("open");

      elements.driverSearch.setAttribute(
        "aria-expanded",
        "true"
      );

      renderDriverOptions(
        elements.driverSearch.value
      );
    }
  );

  elements.driverSearch.addEventListener(
    "input",
    () => {
      if (
        state.selectedDriver &&
        elements.driverSearch.value !==
          state.selectedDriver.name
      ) {
        clearDriverSelection();
      }

      elements.driverLookup.classList.add("open");

      renderDriverOptions(
        elements.driverSearch.value
      );
    }
  );
}

function renderDriverOptions(searchText) {
  const search = normalized(searchText);

  const employeeDrivers =
    state.employeeDrivers.filter(driver => {
      const combined = [
        driver.name,
        driver.email
      ].join(" ");

      return (
        !search ||
        normalized(combined).includes(search)
      );
    });

  const subcontractorDrivers =
    state.subcontractorDrivers.filter(driver => {
      const combined = [
        driver.name,
        driver.companyName,
        driver.email,
        driver.phone
      ].join(" ");

      return (
        !search ||
        normalized(combined).includes(search)
      );
    });

  elements.driverMenu.innerHTML = "";

  if (
    !employeeDrivers.length &&
    !subcontractorDrivers.length
  ) {
    const empty = document.createElement("div");

    empty.className = "lookup-empty";
    empty.textContent = "No matching drivers.";

    elements.driverMenu.appendChild(empty);
    return;
  }

  if (employeeDrivers.length) {
    const header = document.createElement("div");

    header.className = "lookup-group-title";
    header.textContent = "FarmVista Drivers";

    elements.driverMenu.appendChild(header);

    employeeDrivers.forEach(driver =>
      appendDriverOption(driver)
    );
  }

  if (subcontractorDrivers.length) {
    const header = document.createElement("div");

    header.className = "lookup-group-title";
    header.textContent = "Subcontractors";

    elements.driverMenu.appendChild(header);

    subcontractorDrivers.forEach(driver =>
      appendDriverOption(driver)
    );
  }
}

function appendDriverOption(driver) {
  const button = document.createElement("button");

  button.type = "button";
  button.className = "lookup-option";

  const title = document.createElement("span");

  title.className = "lookup-option-title";
  title.textContent = driver.name;

  button.appendChild(title);

  if (
    driver.type === "subcontractor" &&
    driver.companyName
  ) {
    const sub = document.createElement("span");

    sub.className = "lookup-option-sub";
    sub.textContent = driver.companyName;

    button.appendChild(sub);
  }

  button.addEventListener(
    "click",
    () => selectDriver(driver)
  );

  elements.driverMenu.appendChild(button);
}

function selectDriver(driver) {
  state.selectedDriver = driver;

  elements.driverSearch.value = driver.name;
  elements.driverId.value = driver.id;
  elements.driverName.value = driver.name;
  elements.driverEmail.value =
    driver.email || "";

  elements.driverSearch.setCustomValidity("");

  elements.driverLookup.classList.remove("open");

  elements.driverSearch.setAttribute(
    "aria-expanded",
    "false"
  );
}

function clearDriverSelection() {
  state.selectedDriver = null;

  elements.driverId.value = "";
  elements.driverName.value = "";
  elements.driverEmail.value = "";
}

/* ============================================================
   WEIGHT INPUTS
============================================================ */

function setupWeightInputs() {
  const weightFields = [
    {
      input: elements.grossWeight,
      max: LIMITS.grossWeight.max
    },
    {
      input: elements.tareWeight,
      max: LIMITS.tareWeight.max
    },
    {
      input: elements.netWeight,
      max: LIMITS.netWeight.max
    }
  ];

  weightFields.forEach(field => {
    const input = field.input;

    input.addEventListener(
      "beforeinput",
      event => {
        if (
          event.inputType === "insertText" &&
          event.data &&
          !/^\d+$/.test(event.data)
        ) {
          event.preventDefault();
        }
      }
    );

    input.addEventListener(
      "input",
      () => {
        let digits = String(
          input.value || ""
        ).replace(/\D/g, "");

        if (!digits) {
          input.value = "";
          input.setCustomValidity("");

          validateWeights();
          updateBushelCalculation();

          return;
        }

        let numericValue = Number(digits);

        if (numericValue > field.max) {
          numericValue = field.max;
        }

        input.value =
          numericValue.toLocaleString("en-US");

        input.setCustomValidity("");

        validateWeights();
        updateBushelCalculation();
      }
    );
  });
}

/* ============================================================
   WEIGHT VALIDATION
============================================================ */

function validateWeights() {
  const gross = cleanNumber(
    elements.grossWeight.value
  );

  const tare = cleanNumber(
    elements.tareWeight.value
  );

  const net = cleanNumber(
    elements.netWeight.value
  );

  [
    elements.grossWeight,
    elements.tareWeight,
    elements.netWeight
  ].forEach(input =>
    input.setCustomValidity("")
  );

  elements.weightCheck.className =
    "weight-check";

  elements.weightCheck.textContent = "";

  if (
    gross !== null &&
    (
      gross < LIMITS.grossWeight.min ||
      gross > LIMITS.grossWeight.max
    )
  ) {
    elements.grossWeight.setCustomValidity(
      "Gross Weight must be between 30,000 and 110,000 lb."
    );
  }

  if (
    tare !== null &&
    (
      tare < LIMITS.tareWeight.min ||
      tare > LIMITS.tareWeight.max
    )
  ) {
    elements.tareWeight.setCustomValidity(
      "Empty / Tare Weight must be between 20,000 and 40,000 lb."
    );
  }

  if (
    net !== null &&
    (
      net < LIMITS.netWeight.min ||
      net > LIMITS.netWeight.max
    )
  ) {
    elements.netWeight.setCustomValidity(
      "Net Weight must be between 1,000 and 80,000 lb."
    );
  }

  if (
    gross === null ||
    tare === null ||
    net === null
  ) {
    return false;
  }

  const expectedNet = gross - tare;

  if (expectedNet !== net) {
    elements.netWeight.setCustomValidity(
      `Gross minus Empty / Tare equals ${expectedNet.toLocaleString(
        "en-US"
      )} lb.`
    );

    elements.weightCheck.className =
      "weight-check bad";

    elements.weightCheck.textContent =
      `Weight check failed. ${gross.toLocaleString(
        "en-US"
      )} - ${tare.toLocaleString(
        "en-US"
      )} = ${expectedNet.toLocaleString(
        "en-US"
      )} lb, not ${net.toLocaleString(
        "en-US"
      )} lb.`;

    return false;
  }

  elements.weightCheck.className =
    "weight-check good";

  elements.weightCheck.textContent =
    "✓ Weight check passed. Gross minus Empty / Tare equals Net Weight.";

  return true;
}

/* ============================================================
   GRADE FACTORS
============================================================ */

function validateOptionalRange(
  input,
  limits,
  label
) {
  input.setCustomValidity("");

  const value = cleanNumber(input.value);

  if (value === null) return true;

  if (value < limits.min) {
    input.setCustomValidity(
      `${label} cannot be less than ${limits.min.toFixed(
        2
      )}.`
    );

    return false;
  }

  if (value > limits.max) {
    input.setCustomValidity(
      `${label} cannot be more than ${limits.max.toFixed(
        2
      )}.`
    );

    return false;
  }

  return true;
}

function setupGradeFactorInputs() {
  const gradeFields = [
    {
      input: elements.testWeight,
      max: 70
    },
    {
      input: elements.moisture,
      max: 40
    },
    {
      input: elements.damage,
      max: 30
    },
    {
      input: elements.foreignMaterial,
      max: 30
    }
  ];

  gradeFields.forEach(field => {
    const input = field.input;

    input.addEventListener(
      "beforeinput",
      event => {
        if (
          event.inputType === "insertText" &&
          event.data &&
          !/^[0-9.]$/.test(event.data)
        ) {
          event.preventDefault();
        }
      }
    );

    input.addEventListener(
      "input",
      () => {
        let value = String(
          input.value || ""
        ).replace(/[^\d.]/g, "");

        const firstDot = value.indexOf(".");

        if (firstDot !== -1) {
          value =
            value.slice(0, firstDot + 1) +
            value
              .slice(firstDot + 1)
              .replace(/\./g, "");
        }

        let parts = value.split(".");

        parts[0] =
          (parts[0] || "").slice(0, 2);

        if (parts.length > 1) {
          parts[1] =
            (parts[1] || "").slice(0, 2);

          value =
            parts[0] + "." + parts[1];
        } else {
          value = parts[0];
        }

        const numericValue = Number(value);

        if (
          value &&
          Number.isFinite(numericValue) &&
          numericValue > field.max
        ) {
          value = String(field.max);
        }

        input.value = value;
        input.setCustomValidity("");
      }
    );

    input.addEventListener(
      "blur",
      () => {
        const value = cleanNumber(input.value);

        if (value === null) {
          input.value = "";
          return;
        }

        input.value =
          Number(value).toFixed(2);

        validateGradeFactors();
      }
    );
  });
}

function validateGradeFactors() {
  const twValid = validateOptionalRange(
    elements.testWeight,
    LIMITS.testWeight,
    "Test Weight"
  );

  const moistureValid = validateOptionalRange(
    elements.moisture,
    LIMITS.moisture,
    "Moisture"
  );

  const damageValid = validateOptionalRange(
    elements.damage,
    LIMITS.damage,
    "Damage"
  );

  const fmValid = validateOptionalRange(
    elements.foreignMaterial,
    LIMITS.foreignMaterial,
    "FM / BCFM"
  );

  return (
    twValid &&
    moistureValid &&
    damageValid &&
    fmValid
  );
}

/* ============================================================
   BUSHELS
============================================================ */

function getCropBushelWeight() {
  const crop = normalized(
    elements.crop.value
  );

  if (crop === "corn") return 56;

  if (
    crop === "soybeans" ||
    crop === "wheat"
  ) {
    return 60;
  }

  return null;
}

function updateBushelCalculation() {
  const netWeight = cleanNumber(
    elements.netWeight.value
  );

  const poundsPerBushel =
    getCropBushelWeight();

  elements.bushelCheck.className =
    "weight-check";

  elements.bushelCheck.textContent = "";

  if (
    netWeight === null ||
    !poundsPerBushel
  ) {
    elements.grossBushels.value = "";
    return false;
  }

  const grossBushels =
    netWeight / poundsPerBushel;

  elements.grossBushels.value =
    grossBushels.toFixed(2);

  return validateBushels();
}

function setupBushelInputs() {
  elements.shrinkBushels.addEventListener(
    "focus",
    () => {
      const value = cleanNumber(
        elements.shrinkBushels.value
      );

      if (value === 0) {
        elements.shrinkBushels.value = "";
      }
    }
  );

  elements.shrinkBushels.addEventListener(
    "input",
    () => {
      elements.shrinkBushels.setCustomValidity("");
      validateBushels();
    }
  );

  elements.shrinkBushels.addEventListener(
    "blur",
    () => {
      const value = cleanNumber(
        elements.shrinkBushels.value
      );

      elements.shrinkBushels.value =
        value === null
          ? "0.00"
          : formatTwoDecimals(value);

      validateBushels();
    }
  );

  elements.netBushels.addEventListener(
    "input",
    () => {
      elements.netBushels.setCustomValidity("");
      validateBushels();
    }
  );

  elements.netBushels.addEventListener(
    "blur",
    () => {
      const value = cleanNumber(
        elements.netBushels.value
      );

      if (value !== null) {
        elements.netBushels.value =
          formatTwoDecimals(value);
      }

      validateBushels();
    }
  );
}

function validateBushels() {
  elements.netBushels.setCustomValidity("");
  elements.shrinkBushels.setCustomValidity("");

  const grossBushels = cleanNumber(
    elements.grossBushels.value
  );

  const shrinkBushels =
    cleanNumber(
      elements.shrinkBushels.value
    ) ?? 0;

  const netBushels = cleanNumber(
    elements.netBushels.value
  );

  elements.bushelCheck.className =
    "weight-check";

  elements.bushelCheck.textContent = "";

  if (shrinkBushels < 0) {
    elements.shrinkBushels.setCustomValidity(
      "Shrink Bushels cannot be negative."
    );

    return false;
  }

  if (grossBushels === null) {
    return false;
  }

  if (shrinkBushels >= grossBushels) {
    elements.shrinkBushels.setCustomValidity(
      "Shrink Bushels must be less than Gross Bushels."
    );

    return false;
  }

  if (
    netBushels === null ||
    netBushels <= 0
  ) {
    elements.netBushels.setCustomValidity(
      "Enter the Net Bushels shown on the grain ticket."
    );

    return false;
  }

  const expectedNet =
    grossBushels - shrinkBushels;

  const difference = Math.abs(
    expectedNet - netBushels
  );

  if (difference > 0.02) {
    elements.netBushels.setCustomValidity(
      `Expected Net Bushels are ${expectedNet.toFixed(
        2
      )}.`
    );

    elements.bushelCheck.className =
      "weight-check bad";

    elements.bushelCheck.textContent =
      `Bushel check failed. ${grossBushels.toFixed(
        2
      )} Gross - ${shrinkBushels.toFixed(
        2
      )} Shrink = ${expectedNet.toFixed(
        2
      )} Net Bushels, but the ticket shows ${netBushels.toFixed(
        2
      )}.`;

    return false;
  }

  elements.bushelCheck.className =
    "weight-check good";

  elements.bushelCheck.textContent =
    `✓ Bushel check passed. ${grossBushels.toFixed(
      2
    )} Gross - ${shrinkBushels.toFixed(
      2
    )} Shrink = ${netBushels.toFixed(
      2
    )} Net Bushels.`;

  return true;
}

/* ============================================================
   SELECTION VALIDATION
============================================================ */

function validateSelections() {
  const inputs = [
    elements.sourceSearch,
    elements.buyerSearch,
    elements.locationSearch,
    elements.customerSearch,
    elements.contractSearch,
    elements.driverSearch
  ].filter(Boolean);

  inputs.forEach(input =>
    input.setCustomValidity("")
  );

  if (
    elements.sourceSearch &&
    !state.selectedSource?.id
  ) {
    elements.sourceSearch.setCustomValidity(
      "Select a Grain Source from the list."
    );
  }

  if (!state.selectedBuyer?.id) {
    elements.buyerSearch.setCustomValidity(
      "Select a Destination / Elevator from the list."
    );
  }

  if (!state.selectedDeliveryLocation?.id) {
    elements.locationSearch.setCustomValidity(
      "Select a Delivery Location from the list."
    );
  }

  if (!state.selectedCustomer?.id) {
    elements.customerSearch.setCustomValidity(
      "Select Sold Under / Customer from the list."
    );
  }

  if (
    elements.contractSearch &&
    !state.selectedContract?.id
  ) {
    elements.contractSearch.setCustomValidity(
      "Select a Contract from the list."
    );
  }

  if (!state.selectedDriver?.id) {
    elements.driverSearch.setCustomValidity(
      "Select the Driver from the list."
    );
  }

  return Boolean(
    (!elements.sourceSearch ||
      state.selectedSource?.id) &&
    state.selectedBuyer?.id &&
    state.selectedDeliveryLocation?.id &&
    state.selectedCustomer?.id &&
    (!elements.contractSearch ||
      state.selectedContract?.id) &&
    state.selectedDriver?.id
  );
}

/* ============================================================
   DUPLICATE CHECK
============================================================ */

async function duplicateTicketExists() {
  const ticketNumber = clean(
    elements.ticketNumber.value
  );

  if (
    !ticketNumber ||
    !state.selectedBuyer?.id
  ) {
    return false;
  }

  const snapshot = await getDocs(
    query(
      collection(db, TICKET_COLLECTION),
      where(
        "buyerId",
        "==",
        state.selectedBuyer.id
      ),
      where(
        "ticketNumber",
        "==",
        ticketNumber
      )
    )
  );

  return !snapshot.empty;
}

/* ============================================================
   SAVE
============================================================ */

async function saveTicket(event) {
  event.preventDefault();

  if (state.saving) return;

  clearMessage();

  if (!state.user) {
    showMessage(
      "Your FarmVista user account is not loaded.",
      "error"
    );

    return;
  }

  validateSelections();
  validateWeights();
  validateGradeFactors();
  updateBushelCalculation();
  validateBushels();

  if (!elements.form.reportValidity()) {
    return;
  }

  if (await duplicateTicketExists()) {
    showMessage(
      "It appears this ticket is already in the system for this elevator.",
      "error"
    );

    elements.ticketNumber.setCustomValidity(
      "This ticket number already exists for this elevator."
    );

    elements.ticketNumber.reportValidity();

    return;
  }

  state.saving = true;

  elements.saveBtn.disabled = true;
  elements.saveBtn.textContent = "Saving…";

  try {
    const location =
      state.selectedDeliveryLocation;

    const contract =
      state.selectedContract;

    const source =
      state.selectedSource;

    const driver =
      state.selectedDriver;

    const payload = {
      /* =====================================
         LOAD-OUT / MATCHING
      ====================================== */

      crop:
        elements.crop.value,

      grainSourceId:
        source?.id || null,

      grainSourceName:
        source
          ? sourceDisplayName(source)
          : null,

      grainSourceType:
        source
          ? sourceType(source)
          : null,

      grainSourceSiteId:
        clean(
          source?.siteId ||
          source?.farmId
        ) || null,

      grainSourceSiteName:
        clean(
          source?.siteName ||
          source?.farmName ||
          source?.locationName
        ) || null,

      /* =====================================
         DESTINATION
      ====================================== */

      buyerId:
        state.selectedBuyer.id,

      buyerName:
        state.selectedBuyer.name,

      deliveryLocationId:
        location.id,

      deliveryLocationName:
        location.locationName,

      deliveryStreet:
        location.street || null,

      deliveryCity:
        location.city || null,

      deliveryState:
        location.state || null,

      deliveryZip:
        location.zip || null,

      /* =====================================
         SOLD UNDER
      ====================================== */

      customerId:
        state.selectedCustomer.id,

      customerName:
        state.selectedCustomer.name,

      /* =====================================
         CONTRACT
      ====================================== */

      contractId:
        contract.id,

      contractNumber:
        clean(
          contract.contractNumber ||
          contract.number
        ) || null,

      contractLabel:
        contractLabel(contract),

      autoPostingEligible:
        true,

      /* =====================================
         TICKET
      ====================================== */

      ticketNumber:
        clean(elements.ticketNumber.value),

      ticketDate:
        elements.ticketDate.value,

      /* =====================================
         BUSHELS
      ====================================== */

      grossBushels:
        cleanNumber(
          elements.grossBushels.value
        ),

      shrinkBushels:
        cleanNumber(
          elements.shrinkBushels.value
        ) ?? 0,

      netBushels:
        cleanNumber(
          elements.netBushels.value
        ),

      /* =====================================
         WEIGHTS
      ====================================== */

      grossWeight:
        cleanNumber(
          elements.grossWeight.value
        ),

      tareWeight:
        cleanNumber(
          elements.tareWeight.value
        ),

      netWeight:
        cleanNumber(
          elements.netWeight.value
        ),

      /* =====================================
         GRADE FACTORS
      ====================================== */

      testWeight:
        cleanNumber(
          elements.testWeight.value
        ),

      moisture:
        cleanNumber(
          elements.moisture.value
        ),

      damage:
        cleanNumber(
          elements.damage.value
        ),

      foreignMaterial:
        cleanNumber(
          elements.foreignMaterial.value
        ),

      /* =====================================
         DRIVER
      ====================================== */

      driverEmployeeId:
        driver.type === "employee"
          ? driver.id
          : null,

      driverSubcontractorId:
        driver.type === "subcontractor"
          ? driver.subcontractorId
          : null,

      driverSubcontractorDriverId:
        driver.type === "subcontractor"
          ? driver.id
          : null,

      driverType:
        driver.type,

      driverUid:
        driver.uid || null,

      driverName:
        driver.name,

      driverEmail:
        driver.email || null,

      driverPhone:
        driver.phone || null,

      driverCompanyName:
        driver.companyName || null,

      /* =====================================
         ENTERED BY
      ====================================== */

      enteredByUid:
        state.user.uid,

      enteredByName:
        state.user.displayName ||
        state.user.email ||
        "FarmVista User",

      enteredByEmail:
        state.user.email || null,

      /* =====================================
         SOURCE / STATUS
      ====================================== */

      entryMethod:
        "manual",

      validationStatus:
        "verified",

      customerContractMatched:
        true,

      matchingContractIds:
        [contract.id],

      loadoutComplete:
        true,

      needsReview:
        false,

      /* =====================================
         TIMESTAMPS
      ====================================== */

      createdAt:
        serverTimestamp(),

      updatedAt:
        serverTimestamp()
    };

    console.log(
      "[Grain Ticket] Saving:",
      payload
    );

    const savedTicket = await addDoc(
      collection(
        db,
        TICKET_COLLECTION
      ),
      payload
    );

    console.log(
      "[Grain Ticket] Saved:",
      savedTicket.id
    );

    showMessage(
      "Grain ticket saved successfully.",
      "success"
    );

    setTimeout(
      () => {
        window.location.href =
          "/Farm-vista/pages/grain/grain-ticket.html";
      },
      800
    );
  } catch (error) {
    console.error(
      "[Grain Ticket] Save failed:",
      error
    );

    showMessage(
      "The grain ticket could not be saved. Your entries are still on the screen.",
      "error"
    );
  } finally {
    state.saving = false;

    elements.saveBtn.disabled = false;
    elements.saveBtn.textContent =
      "Save Ticket";
  }
}

/* ============================================================
   CROP CHANGE
============================================================ */

function handleCropChange() {
  clearSourceSelection();

  clearBuyerSelection();

  if (elements.sourceSearch) {
    elements.sourceSearch.disabled =
      !elements.crop.value;

    elements.sourceSearch.placeholder =
      elements.crop.value
        ? "Search Grain Source"
        : "Select Crop first";
  }

  elements.buyerSearch.disabled =
    !elements.crop.value;

  elements.buyerSearch.placeholder =
    elements.crop.value
      ? "Search Destination / Elevator"
      : "Select Crop first";

  renderSourceOptions("");
  renderBuyerOptions("");

  updateBushelCalculation();
}

/* ============================================================
   CLOSE LOOKUPS
============================================================ */

function closeLookups(event) {
  [
    elements.sourceLookup,
    elements.buyerLookup,
    elements.locationLookup,
    elements.customerLookup,
    elements.contractLookup,
    elements.driverLookup
  ]
    .filter(Boolean)
    .forEach(lookup => {
      if (!lookup.contains(event.target)) {
        lookup.classList.remove("open");
      }
    });
}

/* ============================================================
   SETUP
============================================================ */

function setupEvents() {
  setupSourcePicker();
  setupBuyerPicker();
  setupDeliveryLocationPicker();
  setupCustomerPicker();
  setupContractPicker();
  setupDriverPicker();

  setupWeightInputs();
  setupBushelInputs();
  setupGradeFactorInputs();

  elements.crop.addEventListener(
    "change",
    handleCropChange
  );

  [
    elements.testWeight,
    elements.moisture,
    elements.damage,
    elements.foreignMaterial
  ].forEach(input => {
    input.addEventListener(
      "blur",
      validateGradeFactors
    );
  });

  elements.netWeight.addEventListener(
    "input",
    updateBushelCalculation
  );

  elements.netWeight.addEventListener(
    "blur",
    updateBushelCalculation
  );

  elements.ticketNumber.addEventListener(
    "input",
    () => {
      elements.ticketNumber.setCustomValidity("");
    }
  );

  elements.cancelBtn.addEventListener(
    "click",
    () => {
      window.location.href =
        "/Farm-vista/pages/grain/grain-ticket.html";
    }
  );

  elements.form.addEventListener(
    "submit",
    saveTicket
  );

  document.addEventListener(
    "click",
    closeLookups
  );
}

/* ============================================================
   INITIAL FIELD STATE
============================================================ */

function initializeFieldState() {
  if (elements.sourceSearch) {
    elements.sourceSearch.disabled = true;
    elements.sourceSearch.placeholder =
      "Select Crop first";
  }

  elements.buyerSearch.disabled = true;
  elements.buyerSearch.placeholder =
    "Select Crop first";

  elements.locationSearch.disabled = true;
  elements.locationSearch.placeholder =
    "Select Destination first";

  elements.customerSearch.disabled = true;
  elements.customerSearch.placeholder =
    "Select Delivery Location first";

  if (elements.contractSearch) {
    elements.contractSearch.disabled = true;
    elements.contractSearch.placeholder =
      "Select Sold Under first";
  }
}

/* ============================================================
   START
============================================================ */

async function startPage() {
  initializeFieldState();

  setupEvents();

  await initializeUser();

  if (!state.user) {
    return;
  }

  try {
    await loadData();

    handleCropChange();
  } catch (error) {
    console.error(
      "[Grain Ticket] Initial load failed:",
      error
    );

    showMessage(
      "FarmVista could not load the grain ticket data.",
      "error"
    );
  }
}

startPage().catch(error => {
  console.error(
    "[Grain Ticket] Startup failed:",
    error
  );

  showMessage(
    "The Grain Ticket page could not finish loading.",
    "error"
  );
});
