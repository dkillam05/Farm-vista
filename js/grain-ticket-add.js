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

const EMPLOYEE_COLLECTION =
  "employees";


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

  drivers:
    [],

  selectedDriver:
    null,

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


  grossBushels:
    $("gross-bushels"),

  shrinkBushels:
    $("shrink-bushels"),

  netBushels:
    $("net-bushels"),

  bushelCheck:
    $("bushel-check"),


  driverLookup:
    $("driver-lookup"),

  driverSearch:
    $("driver-search"),

  driverId:
    $("driver-id"),

  driverName:
    $("driver-name"),

  driverEmail:
    $("driver-email"),

  driverMenu:
    $("driver-menu"),


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

function formatTwoDecimals(value) {

  const number =
    cleanNumber(value);


  if (number === null) {

    return "";

  }


  return number.toLocaleString(
    "en-US",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }
  );

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

  /*
    Signed-in user is the person entering the ticket.
    Driver is selected separately.
  */


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


          console.log(
            "[Grain Ticket] Entry user loaded:",
            user.displayName ||
            user.email ||
            "FarmVista User"
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
    contractSnapshot,
    employeeSnapshot
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
      ),

      getDocs(
        collection(
          db,
          EMPLOYEE_COLLECTION
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

    state.drivers =
    employeeSnapshot.docs
      .map(docSnapshot => {

        const data =
          docSnapshot.data() || {};


        const name =
          clean(
            data.fullName ||
            [
              data.firstName,
              data.lastName
            ]
              .filter(Boolean)
              .join(" ")
          );


        return {

          id:
            docSnapshot.id,

          uid:
            clean(
              data.uid ||
              data.userUid ||
              data.authUid
            ) || null,

          name:
            name,

          email:
            clean(
              data.email
            ),

          role:
            clean(
              data.role
            )

        };

      })
      .filter(driver => {

        return driver.name;

      });


  state.drivers.sort(
    (a, b) =>
      a.name.localeCompare(
        b.name,
        undefined,
        {
          numeric: true,
          sensitivity: "base"
        }
      )
  );


  renderBuyerOptions("");
  renderCustomerOptions("");
  renderDeliveryLocationOptions("");
  renderDriverOptions("");


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
   DRIVER PICKER
============================================================ */

function setupDriverPicker() {

  elements.driverSearch.addEventListener(
    "focus",
    () => {

      elements.driverLookup
        .classList
        .add("open");


      elements.driverSearch
        .setAttribute(
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


      elements.driverLookup
        .classList
        .add("open");


      elements.driverSearch
        .setAttribute(
          "aria-expanded",
          "true"
        );


      renderDriverOptions(
        elements.driverSearch.value
      );

    }
  );

}


function renderDriverOptions(
  searchText
) {

  const search =
    normalized(
      searchText
    );


  const filtered =
    state.drivers.filter(
      driver => {

        const combined =
          [
            driver.name,
            driver.email,
            driver.role
          ]
            .filter(Boolean)
            .join(" ");


        return (
          !search ||
          normalized(
            combined
          ).includes(search)
        );

      }
    );


  elements.driverMenu.innerHTML =
    "";


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
      "No matching drivers.";


    elements.driverMenu
      .appendChild(empty);


    return;

  }


  filtered.forEach(
    driver => {

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


      title.textContent =
        driver.name;


      button.appendChild(
        title
      );



      button.addEventListener(
        "click",
        () => {

          selectDriver(
            driver
          );

        }
      );


      elements.driverMenu
        .appendChild(button);

    }
  );

}


function selectDriver(
  driver
) {

  state.selectedDriver =
    driver;


  elements.driverSearch.value =
    driver.name;


  elements.driverId.value =
    driver.id;


  elements.driverName.value =
    driver.name;


  elements.driverEmail.value =
    driver.email || "";


  elements.driverSearch
    .setCustomValidity("");


  elements.driverLookup
    .classList
    .remove("open");


  elements.driverSearch
    .setAttribute(
      "aria-expanded",
      "false"
    );

}


function clearDriverSelection() {

  state.selectedDriver =
    null;


  elements.driverId.value =
    "";


  elements.driverName.value =
    "";


  elements.driverEmail.value =
    "";

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

  const weightFields = [
    {
      input: elements.grossWeight,
      max: 110000
    },
    {
      input: elements.tareWeight,
      max: 40000
    },
    {
      input: elements.netWeight,
      max: 80000
    }
  ];


  weightFields.forEach(
    field => {

      const input =
        field.input;


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

          let digits =
            String(
              input.value || ""
            )
              .replace(/\D/g, "");


          if (!digits) {

            input.value =
              "";

            input.setCustomValidity(
              ""
            );

            validateWeights();

            updateBushelCalculation();

            return;

          }


          let numericValue =
            Number(digits);


          /*
            HARD MAXIMUM:
            If typed/pasted value is too large,
            remove digits from the end until valid.
          */

          if (
            numericValue > field.max
          ) {

            numericValue =
              field.max;


            digits =
              String(
                field.max
              );

          }


          if (!digits) {

            input.value =
              "";

            return;

          }


          input.value =
            numericValue.toLocaleString(
              "en-US"
            );


          input.setCustomValidity(
            ""
          );


          validateWeights();

          updateBushelCalculation();

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
    value < limits.min
  ) {

    input.setCustomValidity(
      `${label} cannot be less than ${limits.min.toFixed(2)}.`
    );


    return false;

  }


  if (
    value > limits.max
  ) {

    input.setCustomValidity(
      `${label} cannot be more than ${limits.max.toFixed(2)}.`
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


  gradeFields.forEach(
    field => {

      const input =
        field.input;


      /*
        Only numbers and one decimal point
        can physically be typed.
      */
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

          let value =
            String(
              input.value || ""
            )
              .replace(/[^\d.]/g, "");


          /*
            Allow only ONE decimal point.
          */
          const firstDot =
            value.indexOf(".");


          if (
            firstDot !== -1
          ) {

            value =
              value.slice(
                0,
                firstDot + 1
              ) +
              value
                .slice(
                  firstDot + 1
                )
                .replace(/\./g, "");

          }


          let parts =
            value.split(".");


          /*
            Maximum shape is:
            00.00
          */
          parts[0] =
            (parts[0] || "")
              .slice(0, 2);


          if (
            parts.length > 1
          ) {

            parts[1] =
              (parts[1] || "")
                .slice(0, 2);


            value =
              parts[0] +
              "." +
              parts[1];

          } else {

            value =
              parts[0];

          }


          /*
            Do not allow the typed value
            to exceed this field's maximum.
          */
          const numericValue =
            Number(value);


          if (
            value &&
            Number.isFinite(numericValue) &&
            numericValue > field.max
          ) {

            value =
              String(field.max);

          }


          if (
  input === elements.testWeight
) {

  const wholePart =
    String(value)
      .split(".")[0];


  if (
    wholePart.length >= 2
  ) {

    const twValue =
      Number(value);


    if (
      Number.isFinite(twValue) &&
      twValue < 30
    ) {

      value =
        value.slice(0, -1);

    }

  }

}
          
          input.value =
            value;


          input.setCustomValidity(
            ""
          );

        }
      );


      /*
        Finish the display as 00.00 style
        when leaving the field.
      */
      input.addEventListener(
        "blur",
        () => {

          const value =
            cleanNumber(
              input.value
            );


          if (
            value === null
          ) {

            input.value =
              "";

            return;

          }


          if (
            input === elements.testWeight &&
            value < 30
          ) {

            input.value =
              "";

            input.setCustomValidity(
              "Test Weight cannot be less than 30.00."
            );

            input.reportValidity();

            return;

          }


          if (
            input === elements.moisture &&
            value < 5
          ) {

            input.value =
              "";

            input.setCustomValidity(
              "Moisture cannot be less than 5.00."
            );

            input.reportValidity();

            return;

          }


          input.value =
            Number(value)
              .toFixed(2);


          validateGradeFactors();

        }
      );

    }
  );

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
   BUSHEL CALCULATION + VALIDATION
============================================================ */

function getCropBushelWeight() {

  const crop =
    normalized(
      elements.crop.value
    );


  if (crop === "corn") {

    return 56;

  }


  if (
    crop === "soybeans" ||
    crop === "wheat"
  ) {

    return 60;

  }


  return null;

}


function updateBushelCalculation() {

  const netWeight =
    cleanNumber(
      elements.netWeight.value
    );


  const poundsPerBushel =
    getCropBushelWeight();


  elements.bushelCheck.className =
    "weight-check";


  elements.bushelCheck.textContent =
    "";


  if (
    netWeight === null ||
    !poundsPerBushel
  ) {

    elements.grossBushels.value =
      "";


    return false;

  }


  const grossBushels =
    netWeight /
    poundsPerBushel;


  elements.grossBushels.value =
    grossBushels.toFixed(2);


  return validateBushels();

}

function setupBushelInputs() {

  elements.shrinkBushels.addEventListener(
    "focus",
    () => {

      const value =
        cleanNumber(
          elements.shrinkBushels.value
        );


      if (
        value === 0
      ) {

        elements.shrinkBushels.value =
          "";

      }

    }
  );


  elements.shrinkBushels.addEventListener(
    "input",
    () => {

      elements.shrinkBushels
        .setCustomValidity("");


      validateBushels();

    }
  );


  elements.shrinkBushels.addEventListener(
    "blur",
    () => {

      const value =
        cleanNumber(
          elements.shrinkBushels.value
        );


      if (
        value === null
      ) {

        elements.shrinkBushels.value =
          "0.00";

      } else {

        elements.shrinkBushels.value =
          formatTwoDecimals(
            value
          );

      }


      validateBushels();

    }
  );


  elements.netBushels.addEventListener(
    "input",
    () => {

      elements.netBushels
        .setCustomValidity("");


      validateBushels();

    }
  );


  elements.netBushels.addEventListener(
    "blur",
    () => {

      const value =
        cleanNumber(
          elements.netBushels.value
        );


      if (
        value !== null
      ) {

        elements.netBushels.value =
          formatTwoDecimals(
            value
          );

      }


      validateBushels();

    }
  );

}

function validateBushels() {

  elements.netBushels
    .setCustomValidity("");


  elements.shrinkBushels
    .setCustomValidity("");


  const grossBushels =
    cleanNumber(
      elements.grossBushels.value
    );


  const shrinkBushels =
    cleanNumber(
      elements.shrinkBushels.value
    ) ?? 0;


  const netBushels =
    cleanNumber(
      elements.netBushels.value
    );


  elements.bushelCheck.className =
    "weight-check";


  elements.bushelCheck.textContent =
    "";


  if (
    shrinkBushels < 0
  ) {

    elements.shrinkBushels
      .setCustomValidity(
        "Shrink Bushels cannot be negative."
      );


    return false;

  }


  if (
    grossBushels === null
  ) {

    return false;

  }


  if (
    shrinkBushels >= grossBushels
  ) {

    elements.shrinkBushels
      .setCustomValidity(
        "Shrink Bushels must be less than Gross Bushels."
      );


    return false;

  }


  if (
    netBushels === null ||
    netBushels <= 0
  ) {

    elements.netBushels
      .setCustomValidity(
        "Enter the Net Bushels shown on the grain ticket."
      );


    return false;

  }


  const expectedNet =
    grossBushels -
    shrinkBushels;


  const difference =
    Math.abs(
      expectedNet -
      netBushels
    );


  /*
    Allow a small elevator rounding difference.
  */

  if (
    difference > 0.02
  ) {

    elements.netBushels
      .setCustomValidity(
        `Expected Net Bushels are ${expectedNet.toFixed(2)}.`
      );


    elements.bushelCheck.className =
      "weight-check bad";


    elements.bushelCheck.textContent =
      `Bushel check failed. ${grossBushels.toFixed(2)} Gross - ${shrinkBushels.toFixed(2)} Shrink = ${expectedNet.toFixed(2)} Net Bushels, but the ticket shows ${netBushels.toFixed(2)}.`;


    return false;

  }


  elements.bushelCheck.className =
    "weight-check good";


  elements.bushelCheck.textContent =
    `✓ Bushel check passed. ${grossBushels.toFixed(2)} Gross - ${shrinkBushels.toFixed(2)} Shrink = ${netBushels.toFixed(2)} Net Bushels.`;


  return true;

}


/* ============================================================
   SELECTION VALIDATION
============================================================ */

function validateSelections() {

  elements.driverSearch
    .setCustomValidity("");


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


  if (
    !state.selectedDriver?.id
  ) {

    elements.driverSearch
      .setCustomValidity(
        "Select the Driver from the list."
      );

  }


  return Boolean(
    state.selectedDriver?.id &&
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
  updateBushelCalculation();
  validateBushels();


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
         DRIVER
      ====================================== */

      driverEmployeeId:
        state.selectedDriver.id,

      driverUid:
        state.selectedDriver.uid ||
        null,

      driverName:
        state.selectedDriver.name,

      driverEmail:
        state.selectedDriver.email ||
        null,


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
  "/Farm-vista/pages/grain/grain-ticket-ocr.html";

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
    elements.driverLookup,
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

  setupDriverPicker();

  setupBuyerPicker();

  setupCustomerPicker();

  setupDeliveryLocationPicker();

  setupWeightInputs();

  setupBushelInputs();

  setupGradeFactorInputs();


  elements.crop.addEventListener(
    "change",
    () => {

      checkContractMatch();

      updateBushelCalculation();

    }
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


  elements.netWeight
    .addEventListener(
      "input",
      updateBushelCalculation
    );


  elements.netWeight
    .addEventListener(
      "blur",
      updateBushelCalculation
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
