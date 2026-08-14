// /Farm-vista/js/grain-ticket-add.js
// Rev: 2026-08-14-grain-ticket-add-v1
//
// PURPOSE:
// Manual Grain Ticket Entry
//
// FIRESTORE:
// grain_buyers
// grain_customers
// grain_delivery_locations
// grain_contracts
// grain_tickets
//
// VALIDATION:
// Gross: 30,000 - 105,000 lb
// Tare: 20,000 - 40,000 lb
// Net: 1,000 - 80,000 lb
// TW: 30 - 70
// Moisture: 5 - 40
// Damage: 0 - 30
// FM / BCFM: 0 - 30
// Net Bushels: > 0
// Gross - Tare MUST equal Net
//
// Customer + Crop:
// If no matching grain contract exists,
// ticket saves as needs_review.


import {
  ready,
  getFirestore,
  collection,
  getDocs,
  addDoc,
  query,
  orderBy,
  serverTimestamp,
  getAuth
} from "/Farm-vista/js/firebase-init.js";


await ready;


const db =
  getFirestore();

const auth =
  getAuth();


/* ============================================================
   COLLECTIONS
============================================================ */

const BUYER_COLLECTION =
  "grain_buyers";

const CUSTOMER_COLLECTION =
  "grain_customers";

const LOCATION_COLLECTION =
  "grain_delivery_locations";

const CONTRACT_COLLECTION =
  "grain_contracts";

const TICKET_COLLECTION =
  "grain_tickets";


/* ============================================================
   STATE
============================================================ */

const $ = id =>
  document.getElementById(id);


const state = {

  user:
    null,

  buyers:
    [],

  customers:
    [],

  deliveryLocations:
    [],

  contracts:
    [],

  selectedBuyer:
    null,

  selectedCustomer:
    null,

  selectedDeliveryLocation:
    null,

  saving:
    false

};


/* ============================================================
   LIMITS
============================================================ */

const LIMITS = {

  grossWeight: {
    min: 30000,
    max: 105000
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

  form:
    $("grain-ticket-form"),

  message:
    $("message"),


  buyerLookup:
    $("buyer-lookup"),

  buyerSearch:
    $("buyer-search"),

  buyerId:
    $("buyer-id"),

  buyerName:
    $("buyer-name"),

  buyerMenu:
    $("buyer-menu"),


  locationLookup:
    $("delivery-location-lookup"),

  locationSearch:
    $("delivery-location-search"),

  locationId:
    $("delivery-location-id"),

  locationMenu:
    $("delivery-location-menu"),


  customerLookup:
    $("customer-lookup"),

  customerSearch:
    $("customer-search"),

  customerId:
    $("customer-id"),

  customerName:
    $("customer-name"),

  customerMenu:
    $("customer-menu"),


  ticketNumber:
    $("ticket-number"),

  crop:
    $("crop"),

  ticketDate:
    $("ticket-date"),


  grossWeight:
    $("gross-weight"),

  tareWeight:
    $("tare-weight"),

  netWeight:
    $("net-weight"),

  weightCheck:
    $("weight-check"),


  testWeight:
    $("test-weight"),

  moisture:
    $("moisture"),

  damage:
    $("damage"),

  foreignMaterial:
    $("foreign-material"),

  netBushels:
    $("net-bushels"),


  driverName:
    $("driver-name"),

  contractStatus:
    $("contract-status"),


  cancelBtn:
    $("cancel-btn"),

  saveBtn:
    $("save-btn")

};


/* ============================================================
   GENERAL HELPERS
============================================================ */

function clean(value) {

  return String(
    value ?? ""
  ).trim();

}


function normalized(value) {

  return clean(value)
    .toLowerCase();

}


function cleanNumber(value) {

  const text =
    clean(value)
      .replace(/,/g, "")
      .replace(/[^\d.-]/g, "");


  if (!text) {

    return null;

  }


  const number =
    Number(text);


  return Number.isFinite(number)
    ? number
    : null;

}


function formatWholeNumber(value) {

  const number =
    cleanNumber(value);


  if (number === null) {

    return "";

  }


  return Math.round(number)
    .toLocaleString("en-US");

}


function showMessage(
  text,
  type = ""
) {

  elements.message.textContent =
    text;


  elements.message.className =
    `message show ${type}`;


  elements.message.scrollIntoView({
    behavior:
      "smooth",

    block:
      "nearest"
  });

}


function clearMessage() {

  elements.message.textContent =
    "";


  elements.message.className =
    "message";

}


function formatAddress(location) {

  const cityState =
    [
      location.city,
      location.state
    ]
      .filter(Boolean)
      .join(", ");


  const cityStateZip =
    [
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


/* ============================================================
   LOAD USER
============================================================ */

async function initializeUser() {

  elements.driverName.value =
    "Loading driver…";


  let attempts =
    0;

  const maxAttempts =
    40;


  return new Promise(resolve => {

    const checkUser =
      () => {

        attempts +=
          1;


        const user =
          auth?.currentUser ||
          null;


        if (user) {

          state.user =
            user;


          elements.driverName.value =
            user.displayName ||
            user.email ||
            "FarmVista User";


          console.log(
            "[Grain Ticket] Driver loaded:",
            elements.driverName.value
          );


          resolve(user);

          return;

        }


        if (
          attempts >=
          maxAttempts
        ) {

          state.user =
            null;


          elements.driverName.value =
            "Not signed in";


          showMessage(
            "Your FarmVista user account could not be loaded. Refresh the page or sign in again.",
            "error"
          );


          resolve(null);

          return;

        }


        setTimeout(
          checkUser,
          250
        );

      };


    checkUser();

  });

}


/* ============================================================
   LOAD FIRESTORE DATA
============================================================ */

async function loadData() {

  const [
    buyerSnapshot,
    customerSnapshot,
    locationSnapshot,
    contractSnapshot
  ] =
    await Promise.all([

      getDocs(
        query(
          collection(
            db,
            BUYER_COLLECTION
          ),
          orderBy("name")
        )
      ),

      getDocs(
        query(
          collection(
            db,
            CUSTOMER_COLLECTION
          ),
          orderBy("name")
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
          CONTRACT_COLLECTION
        )
      )

    ]);


  state.buyers =
    buyerSnapshot.docs
      .map(docSnapshot => {

        const data =
          docSnapshot.data() || {};


        return {

          id:
            docSnapshot.id,

          name:
            clean(data.name)

        };

      })
      .filter(
        buyer =>
          buyer.name
      );


  state.customers =
    customerSnapshot.docs
      .map(docSnapshot => {

        const data =
          docSnapshot.data() || {};


        return {

          id:
            docSnapshot.id,

          name:
            clean(data.name)

        };

      })
      .filter(
        customer =>
          customer.name
      );


  state.deliveryLocations =
    locationSnapshot.docs
      .map(docSnapshot => {

        const data =
          docSnapshot.data() || {};


        return {

          id:
            docSnapshot.id,

          buyerId:
            clean(data.buyerId),

          buyerName:
            clean(data.buyerName),

          locationName:
            clean(data.locationName),

          street:
            clean(data.street),

          city:
            clean(data.city),

          state:
            clean(data.state),

          zip:
            clean(data.zip)

        };

      })
      .filter(location => {

        return (
          location.buyerId &&
          location.locationName
        );

      });


  state.deliveryLocations.sort(
    (a, b) =>
      a.locationName.localeCompare(
        b.locationName
      )
  );


  state.contracts =
    contractSnapshot.docs
      .map(docSnapshot => {

        return {

          id:
            docSnapshot.id,

          ...docSnapshot.data()

        };

      });


  renderBuyerOptions("");
  renderCustomerOptions("");
  renderDeliveryLocationOptions("");


  console.log(
    "[Grain Ticket] Buyers:",
    state.buyers.length
  );


  console.log(
    "[Grain Ticket] Customers:",
    state.customers.length
  );


  console.log(
    "[Grain Ticket] Locations:",
    state.deliveryLocations.length
  );


  console.log(
    "[Grain Ticket] Contracts:",
    state.contracts.length
  );

}


/* ============================================================
   BUYER PICKER
============================================================ */

function setupBuyerPicker() {

  elements.buyerSearch.addEventListener(
    "focus",
    () => {

      elements.buyerLookup
        .classList
        .add("open");


      elements.buyerSearch
        .setAttribute(
          "aria-expanded",
          "true"
        );


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

        clearBuyerSelection();

      }


      elements.buyerLookup
        .classList
        .add("open");


      renderBuyerOptions(
        elements.buyerSearch.value
      );

    }
  );

}


function renderBuyerOptions(
  searchText
) {

  const search =
    normalized(searchText);


  const filtered =
    state.buyers.filter(
      buyer => {

        return (
          !search ||
          normalized(
            buyer.name
          ).includes(search)
        );

      }
    );


  elements.buyerMenu.innerHTML =
    "";


  if (!filtered.length) {

    const empty =
      document.createElement(
        "div"
      );


    empty.className =
      "lookup-empty";


    empty.textContent =
      "No matching buyers.";


    elements.buyerMenu
      .appendChild(empty);


    return;

  }


  filtered.forEach(
    buyer => {

      const button =
        document.createElement(
          "button"
        );


      button.type =
        "button";


      button.className =
        "lookup-option";


      button.textContent =
        buyer.name;


      button.addEventListener(
        "click",
        () => {

          selectBuyer(
            buyer
          );

        }
      );


      elements.buyerMenu
        .appendChild(button);

    }
  );

}


function selectBuyer(
  buyer
) {

  state.selectedBuyer =
    buyer;


  elements.buyerSearch.value =
    buyer.name;


  elements.buyerId.value =
    buyer.id;


  elements.buyerName.value =
    buyer.name;


  elements.buyerSearch
    .setCustomValidity("");


  elements.buyerLookup
    .classList
    .remove("open");


  clearDeliveryLocationSelection();


  elements.locationSearch.disabled =
    false;


  elements.locationSearch.placeholder =
    "Search Delivery Location";


  renderDeliveryLocationOptions("");


  checkContractMatch();

}


function clearBuyerSelection() {

  state.selectedBuyer =
    null;


  elements.buyerId.value =
    "";


  elements.buyerName.value =
    "";


  clearDeliveryLocationSelection();


  elements.locationSearch.value =
    "";


  elements.locationSearch.disabled =
    true;


  elements.locationSearch.placeholder =
    "Select Buyer / Elevator first";


  checkContractMatch();

}


/* ============================================================
   CUSTOMER PICKER
============================================================ */

function setupCustomerPicker() {

  elements.customerSearch.addEventListener(
    "focus",
    () => {

      elements.customerLookup
        .classList
        .add("open");


      elements.customerSearch
        .setAttribute(
          "aria-expanded",
          "true"
        );


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

        clearCustomerSelection();

      }


      elements.customerLookup
        .classList
        .add("open");


      renderCustomerOptions(
        elements.customerSearch.value
      );

    }
  );

}


function renderCustomerOptions(
  searchText
) {

  const search =
    normalized(searchText);


  const filtered =
    state.customers.filter(
      customer => {

        return (
          !search ||
          normalized(
            customer.name
          ).includes(search)
        );

      }
    );


  elements.customerMenu.innerHTML =
    "";


  if (!filtered.length) {

    const empty =
      document.createElement(
        "div"
      );


    empty.className =
      "lookup-empty";


    empty.textContent =
      "No matching customers.";


    elements.customerMenu
      .appendChild(empty);


    return;

  }


  filtered.forEach(
    customer => {

      const button =
        document.createElement(
          "button"
        );


      button.type =
        "button";


      button.className =
        "lookup-option";


      button.textContent =
        customer.name;


      button.addEventListener(
        "click",
        () => {

          selectCustomer(
            customer
          );

        }
      );


      elements.customerMenu
        .appendChild(button);

    }
  );

}


function selectCustomer(
  customer
) {

  state.selectedCustomer =
    customer;


  elements.customerSearch.value =
    customer.name;


  elements.customerId.value =
    customer.id;


  elements.customerName.value =
    customer.name;


  elements.customerSearch
    .setCustomValidity("");


  elements.customerLookup
    .classList
    .remove("open");


  checkContractMatch();

}


function clearCustomerSelection() {

  state.selectedCustomer =
    null;


  elements.customerId.value =
    "";


  elements.customerName.value =
    "";


  checkContractMatch();

}


/* ============================================================
   DELIVERY LOCATION PICKER
============================================================ */

function setupDeliveryLocationPicker() {

  elements.locationSearch.addEventListener(
    "focus",
    () => {

      if (
        !state.selectedBuyer
      ) {

        return;

      }


      elements.locationLookup
        .classList
        .add("open");


      renderDeliveryLocationOptions(
        elements.locationSearch.value
      );

    }
  );


  elements.locationSearch.addEventListener(
    "input",
    () => {

      if (
        !state.selectedBuyer
      ) {

        return;

      }


      if (
        state.selectedDeliveryLocation &&
        elements.locationSearch.value !==
          state.selectedDeliveryLocation.locationName
      ) {

        clearDeliveryLocationSelection(
          false
        );

      }


      elements.locationLookup
        .classList
        .add("open");


      renderDeliveryLocationOptions(
        elements.locationSearch.value
      );

    }
  );

}


function renderDeliveryLocationOptions(
  searchText
) {

  elements.locationMenu.innerHTML =
    "";


  if (
    !state.selectedBuyer
  ) {

    const empty =
      document.createElement(
        "div"
      );


    empty.className =
      "lookup-empty";


    empty.textContent =
      "Select Buyer / Elevator first.";


    elements.locationMenu
      .appendChild(empty);


    return;

  }


  const search =
    normalized(searchText);


  const filtered =
    state.deliveryLocations
      .filter(location => {

        return (
          location.buyerId ===
          state.selectedBuyer.id
        );

      })
      .filter(location => {

        const combined =
          [
            location.locationName,
            location.street,
            location.city,
            location.state,
            location.zip
          ].join(" ");


        return (
          !search ||
          normalized(
            combined
          ).includes(search)
        );

      });


  if (
    !filtered.length
  ) {

    const empty =
      document.createElement(
        "div"
      );


    empty.className =
      "lookup-empty";


    empty.textContent =
      "No delivery locations for this buyer.";


    elements.locationMenu
      .appendChild(empty);


    return;

  }


  filtered.forEach(
    location => {

      const button =
        document.createElement(
          "button"
        );


      button.type =
        "button";


      button.className =
        "lookup-option";


      const title =
        document.createElement(
          "span"
        );


      title.className =
        "lookup-option-title";


      title.textContent =
        location.locationName;


      const sub =
        document.createElement(
          "span"
        );


      sub.className =
        "lookup-option-sub";


      sub.textContent =
        formatAddress(
          location
        );


      button.appendChild(
        title
      );


      button.appendChild(
        sub
      );


      button.addEventListener(
        "click",
        () => {

          selectDeliveryLocation(
            location
          );

        }
      );


      elements.locationMenu
        .appendChild(button);

    }
  );

}


function selectDeliveryLocation(
  location
) {

  state.selectedDeliveryLocation =
    location;


  elements.locationSearch.value =
    location.locationName;


  elements.locationId.value =
    location.id;


  elements.locationSearch
    .setCustomValidity("");


  elements.locationLookup
    .classList
    .remove("open");


  checkContractMatch();

}


function clearDeliveryLocationSelection(
  clearText = true
) {

  state.selectedDeliveryLocation =
    null;


  elements.locationId.value =
    "";


  if (
    clearText
  ) {

    elements.locationSearch.value =
      "";

  }


  checkContractMatch();

}


/* ============================================================
   CONTRACT MATCH
============================================================ */

function matchingContracts() {

  if (
    !state.selectedCustomer ||
    !elements.crop.value
  ) {

    return [];

  }


  return state.contracts.filter(
    contract => {

      const customerMatches =
        clean(
          contract.customerId
        ) ===
        state.selectedCustomer.id;


      const cropMatches =
        normalized(
          contract.crop
        ) ===
        normalized(
          elements.crop.value
        );


      return (
        customerMatches &&
        cropMatches
      );

    }
  );

}


function checkContractMatch() {

  elements.contractStatus.className =
    "contract-status";


  elements.contractStatus.textContent =
    "";


  if (
    !state.selectedCustomer ||
    !elements.crop.value
  ) {

    return {
      matched:
        false,

      contracts:
        []
    };

  }


  const matches =
    matchingContracts();


  if (
    matches.length
  ) {

    elements.contractStatus.className =
      "contract-status good";


    elements.contractStatus.textContent =
      matches.length === 1
        ? "✓ Customer has a matching grain contract for this crop."
        : `✓ Customer has ${matches.length} matching grain contracts for this crop.`;


    return {
      matched:
        true,

      contracts:
        matches
    };

  }


  elements.contractStatus.className =
    "contract-status warning";


  elements.contractStatus.textContent =
    "No matching grain contract was found for this Customer / Vendor and crop. This ticket will be saved as Needs Review.";


  return {
    matched:
      false,

    contracts:
      []
  };

}


/* ============================================================
   WEIGHT FORMATTING
============================================================ */

function setupWeightInputs() {

  [
    elements.grossWeight,
    elements.tareWeight,
    elements.netWeight
  ].forEach(
    input => {

      input.addEventListener(
        "blur",
        () => {

          const value =
            cleanNumber(
              input.value
            );


          if (
            value !== null
          ) {

            input.value =
              formatWholeNumber(
                value
              );

          }


          validateWeights();

        }
      );


      input.addEventListener(
        "input",
        () => {

          input.setCustomValidity(
            ""
          );


          validateWeights();

        }
      );

    }
  );

}


/* ============================================================
   WEIGHT VALIDATION
============================================================ */

function validateWeights() {

  const gross =
    cleanNumber(
      elements.grossWeight.value
    );


  const tare =
    cleanNumber(
      elements.tareWeight.value
    );


  const net =
    cleanNumber(
      elements.netWeight.value
    );


  [
    elements.grossWeight,
    elements.tareWeight,
    elements.netWeight
  ].forEach(
    input => {

      input.setCustomValidity(
        ""
      );

    }
  );


  elements.weightCheck.className =
    "weight-check";


  elements.weightCheck.textContent =
    "";


  if (
    gross !== null &&
    (
      gross <
        LIMITS.grossWeight.min ||

      gross >
        LIMITS.grossWeight.max
    )
  ) {

    elements.grossWeight
      .setCustomValidity(
        "Gross Weight must be between 30,000 and 105,000 lb."
      );

  }


  if (
    tare !== null &&
    (
      tare <
        LIMITS.tareWeight.min ||

      tare >
        LIMITS.tareWeight.max
    )
  ) {

    elements.tareWeight
      .setCustomValidity(
        "Empty / Tare Weight must be between 20,000 and 40,000 lb."
      );

  }


  if (
    net !== null &&
    (
      net <
        LIMITS.netWeight.min ||

      net >
        LIMITS.netWeight.max
    )
  ) {

    elements.netWeight
      .setCustomValidity(
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


  const expectedNet =
    gross - tare;


  if (
    expectedNet !== net
  ) {

    elements.netWeight
      .setCustomValidity(
        `Gross minus Empty / Tare equals ${expectedNet.toLocaleString("en-US")} lb.`
      );


    elements.weightCheck.className =
      "weight-check bad";


    elements.weightCheck.textContent =
      `Weight check failed. ${gross.toLocaleString("en-US")} - ${tare.toLocaleString("en-US")} = ${expectedNet.toLocaleString("en-US")} lb, not ${net.toLocaleString("en-US")} lb.`;


    return false;

  }


  elements.weightCheck.className =
    "weight-check good";


  elements.weightCheck.textContent =
    "✓ Weight check passed. Gross minus Empty / Tare equals Net Weight.";


  return true;

}


/* ============================================================
   GRADE VALIDATION
============================================================ */

function validateOptionalRange(
  input,
  limits,
  label
) {

  input.setCustomValidity(
    ""
  );


  const value =
    cleanNumber(
      input.value
    );


  if (
    value === null
  ) {

    return true;

  }


  if (
    value <
      limits.min ||

    value >
      limits.max
  ) {

    input.setCustomValidity(
      `${label} must be between ${limits.min} and ${limits.max}.`
    );


    return false;

  }


  return true;

}


function validateGradeFactors() {

  const twValid =
    validateOptionalRange(
      elements.testWeight,
      LIMITS.testWeight,
      "Test Weight"
    );


  const moistureValid =
    validateOptionalRange(
      elements.moisture,
      LIMITS.moisture,
      "Moisture"
    );


  const damageValid =
    validateOptionalRange(
      elements.damage,
      LIMITS.damage,
      "Damage"
    );


  const fmValid =
    validateOptionalRange(
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
   BUSHEL VALIDATION
============================================================ */

function validateNetBushels() {

  elements.netBushels
    .setCustomValidity("");


  const value =
    cleanNumber(
      elements.netBushels.value
    );


  if (
    value === null ||
    value <= 0
  ) {

    elements.netBushels
      .setCustomValidity(
        "Net Bushels must be greater than 0."
      );


    return false;

  }


  return true;

}


/* ============================================================
   SELECTION VALIDATION
============================================================ */

function validateSelections() {

  elements.buyerSearch
    .setCustomValidity("");


  elements.customerSearch
    .setCustomValidity("");


  elements.locationSearch
    .setCustomValidity("");


  if (
    !state.selectedBuyer?.id
  ) {

    elements.buyerSearch
      .setCustomValidity(
        "Select a Buyer / Elevator from the list."
      );

  }


  if (
    !state.selectedCustomer?.id
  ) {

    elements.customerSearch
      .setCustomValidity(
        "Select a Customer / Vendor from the list."
      );

  }


  if (
    !state.selectedDeliveryLocation?.id
  ) {

    elements.locationSearch
      .setCustomValidity(
        "Select a Delivery Location from the list."
      );

  }


  return Boolean(
    state.selectedBuyer?.id &&
    state.selectedCustomer?.id &&
    state.selectedDeliveryLocation?.id
  );

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
    !state.user
  ) {

    showMessage(
      "Your FarmVista user account is not loaded.",
      "error"
    );


    return;

  }


  validateSelections();
  validateWeights();
  validateGradeFactors();
  validateNetBushels();


  if (
    !elements.form.reportValidity()
  ) {

    return;

  }


  const contractResult =
    checkContractMatch();


  const validationStatus =
    contractResult.matched
      ? "verified"
      : "needs_review";


  state.saving =
    true;


  elements.saveBtn.disabled =
    true;


  elements.saveBtn.textContent =
    "Saving…";


  try {

    const location =
      state.selectedDeliveryLocation;


    const payload = {

      /* =====================================
         BUYER
      ====================================== */

      buyerId:
        state.selectedBuyer.id,

      buyerName:
        state.selectedBuyer.name,


      /* =====================================
         DELIVERY LOCATION SNAPSHOT
      ====================================== */

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
         CUSTOMER
      ====================================== */

      customerId:
        state.selectedCustomer.id,

      customerName:
        state.selectedCustomer.name,


      /* =====================================
         TICKET
      ====================================== */

      ticketNumber:
        clean(
          elements.ticketNumber.value
        ),

      crop:
        elements.crop.value,

      ticketDate:
        elements.ticketDate.value,


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
         BUSHELS
      ====================================== */

      netBushels:
        cleanNumber(
          elements.netBushels.value
        ),


      /* =====================================
         DRIVER
      ====================================== */

      driverUid:
        state.user.uid,

      driverName:
        state.user.displayName ||
        state.user.email ||
        "FarmVista User",

      driverEmail:
        state.user.email ||
        null,


      /* =====================================
         SOURCE
      ====================================== */

      entryMethod:
        "manual",


      /* =====================================
         VALIDATION
      ====================================== */

      validationStatus:
        validationStatus,

      customerContractMatched:
        contractResult.matched,

      matchingContractIds:
        contractResult.contracts.map(
          contract =>
            contract.id
        ),


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


    const savedTicket =
      await addDoc(
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


    if (
      validationStatus ===
      "needs_review"
    ) {

      showMessage(
        "Grain ticket saved, but no matching customer contract was found. Ticket marked Needs Review.",
        "warning"
      );

    } else {

      showMessage(
        "Grain ticket saved successfully.",
        "success"
      );

    }


    setTimeout(
      () => {

        window.location.href =
          "/Farm-vista/pages/grain/grain-tickets.html";

      },
      1000
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

    state.saving =
      false;


    elements.saveBtn.disabled =
      false;


    elements.saveBtn.textContent =
      "Save Ticket";

  }

}


/* ============================================================
   CLOSE LOOKUPS
============================================================ */

function closeLookups(
  event
) {

  [
    elements.buyerLookup,
    elements.customerLookup,
    elements.locationLookup
  ].forEach(
    lookup => {

      if (
        !lookup.contains(
          event.target
        )
      ) {

        lookup.classList
          .remove("open");

      }

    }
  );

}


/* ============================================================
   SETUP EVENTS
============================================================ */

function setupEvents() {

  setupBuyerPicker();

  setupCustomerPicker();

  setupDeliveryLocationPicker();

  setupWeightInputs();


  elements.crop.addEventListener(
    "change",
    checkContractMatch
  );


  [
    elements.testWeight,
    elements.moisture,
    elements.damage,
    elements.foreignMaterial
  ].forEach(
    input => {

      input.addEventListener(
        "blur",
        validateGradeFactors
      );

    }
  );


  elements.netBushels
    .addEventListener(
      "blur",
      validateNetBushels
    );


  elements.cancelBtn
    .addEventListener(
      "click",
      () => {

        window.location.href =
          "/Farm-vista/pages/grain/grain-tickets.html";

      }
    );


  elements.form
    .addEventListener(
      "submit",
      saveTicket
    );


  document.addEventListener(
    "click",
    closeLookups
  );

}


/* ============================================================
   START
============================================================ */

async function startPage() {

  setupEvents();


  await initializeUser();


  if (
    !state.user
  ) {

    return;

  }


  try {

    await loadData();

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


startPage().catch(
  error => {

    console.error(
      "[Grain Ticket] Startup failed:",
      error
    );


    showMessage(
      "The Grain Ticket page could not finish loading.",
      "error"
    );

  }
);
