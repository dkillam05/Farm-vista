// /js/grain-contract-add.js
// Rev: 2026-08-14-grain-contract-add-v3
//
// PURPOSE:
// Add Grain Contract
//
// FEATURES:
// ✅ Modular Firebase / Firestore
// ✅ Search Buyer / Elevator
// ✅ Add Buyer / Elevator
// ✅ Search Customer
// ✅ Add Customer
// ✅ Buyer-specific Delivery Locations
// ✅ Add Delivery Location
// ✅ ZIP → City / State lookup
// ✅ Bushel comma formatting
// ✅ Bank-style Price Per Bushel
// ✅ $2.00 – $30.00 price validation
// ✅ Contract Date → Delivery Start validation
// ✅ Delivery Start → Delivery End validation
// ✅ Save grain contract
//
// FIRESTORE:
// grain_buyers
// grain_customers
// grain_delivery_locations
// grain_contracts


import {
  ready,
  getFirestore,
  collection,
  getDocs,
  addDoc,
  query,
  orderBy,
  serverTimestamp
} from "/js/firebase-init.js";


await ready;

const db = getFirestore();


/* ============================================================
   STATE
============================================================ */

const $ = (id) =>
  document.getElementById(id);


let buyers = [];
let customers = [];
let deliveryLocations = [];

let selectedBuyer = null;
let selectedCustomer = null;
let selectedDeliveryLocation = null;


/*
  CONTRACT PRICING

  Cash:
    Futures + Basis = Cash Price

  Basis:
    Basis only

  Futures:
    Futures only

  Program:
    Cash Price entered directly

  pricePerBushel remains the final cash price
  whenever one exists.
*/

let futuresPrice = null;
let basisPrice = null;
let cashPrice = null;

/*
  Basis sign is controlled separately
  from the dollar amount.

  +1 = positive basis
  -1 = negative basis
*/

let basisSign = 1;



/* ============================================================
   START
============================================================ */

function onReady(fn) {

  if (document.readyState === "loading") {

    document.addEventListener(
      "DOMContentLoaded",
      fn,
      { once: true }
    );

  } else {

    fn();

  }

}


onReady(async function () {

  const form =
    $("grain-contract-form");


  if (!form) {

    console.warn(
      "[Grain Contract] Form not found."
    );

    return;

  }


  setupBuyerPicker();
  setupCustomerPicker();
  setupDeliveryLocationPicker();

  setupBuyerModal();
  setupCustomerModal();
  setupDeliveryLocationModal();

  setupBushels();
  setupPrice();
  setupDates();

  setupImport();
  setupCancel();


  try {

    await Promise.all([
      loadBuyers(),
      loadCustomers(),
      loadDeliveryLocations()
    ]);

  } catch (err) {

    console.error(
      "[Grain Contract] Initial load failed:",
      err
    );

  }


  form.addEventListener(
    "submit",
    handleSaveContract
  );

});



/* ============================================================
   NAME FORMATTING
============================================================ */

function formatName(value) {

  value =
    String(value || "")
      .trim()
      .replace(/\s+/g, " ");


  if (!value) {
    return "";
  }


  return value
    .split(" ")
    .map(function (word) {

      /*
        Preserve common all-cap abbreviations.

        ADM
        CHS
        LLC
        LP
        FS
      */

      if (
        /^[A-Z0-9]{2,}$/.test(word)
      ) {

        return word;

      }


      return word
        .toLowerCase()
        .replace(
          /(^|[-'/])([a-z])/g,
          function (
            match,
            prefix,
            letter
          ) {

            return (
              prefix +
              letter.toUpperCase()
            );

          }
        );

    })
    .join(" ");

}



/* ============================================================
   BUYERS
============================================================ */

async function loadBuyers() {

  try {

    const q =
      query(
        collection(
          db,
          "grain_buyers"
        ),
        orderBy("name")
      );


    const snapshot =
      await getDocs(q);


    buyers =
      snapshot.docs
        .map(function (doc) {

          const data =
            doc.data() || {};


          return {

            id:
              doc.id,

            name:
              data.name || ""

          };

        })
        .filter(function (buyer) {

          return buyer.name;

        });


    renderBuyerOptions("");


  } catch (err) {

    console.error(
      "[Grain Contract] Buyer load failed:",
      err
    );


    buyers = [];

    renderBuyerOptions("");

  }

}



function setupBuyerPicker() {

  const lookup =
    $("buyer-lookup");

  const input =
    $("buyer-search");


  if (!lookup || !input) {
    return;
  }


  input.addEventListener(
    "focus",
    function () {

      lookup.classList.add("open");


      input.setAttribute(
        "aria-expanded",
        "true"
      );


      renderBuyerOptions(
        input.value
      );

    }
  );


  input.addEventListener(
    "input",
    function () {

      if (
        selectedBuyer &&
        input.value !== selectedBuyer.name
      ) {

        clearBuyerSelection();

      }


      lookup.classList.add("open");


      input.setAttribute(
        "aria-expanded",
        "true"
      );


      renderBuyerOptions(
        input.value
      );

    }
  );


  document.addEventListener(
    "click",
    function (event) {

      if (!lookup.contains(event.target)) {

        lookup.classList.remove("open");


        input.setAttribute(
          "aria-expanded",
          "false"
        );

      }

    }
  );

}



function renderBuyerOptions(searchText) {

  const menu =
    $("buyer-menu");


  if (!menu) {
    return;
  }


  const search =
    String(searchText || "")
      .trim()
      .toLowerCase();


  const filtered =
    buyers.filter(function (buyer) {

      return buyer.name
        .toLowerCase()
        .includes(search);

    });


  menu.innerHTML = "";


  if (!filtered.length) {

    const empty =
      document.createElement("div");


    empty.className =
      "lookup-empty";


    empty.textContent =
      search
        ? "No matching buyers."
        : "No buyers added yet.";


    menu.appendChild(empty);

    return;

  }


  filtered.forEach(function (buyer) {

    const button =
      document.createElement("button");


    button.type =
      "button";


    button.className =
      "lookup-option";


    button.textContent =
      buyer.name;


    button.addEventListener(
      "click",
      function () {

        selectBuyer(buyer);

      }
    );


    menu.appendChild(button);

  });

}



function selectBuyer(buyer) {

  selectedBuyer =
    buyer;


  $("buyer-search").value =
    buyer.name;

  $("buyer-id").value =
    buyer.id;

  $("buyer-name").value =
    buyer.name;


  $("buyer-search")
    .setCustomValidity("");


  $("buyer-lookup")
    .classList
    .remove("open");


  $("buyer-search")
    .setAttribute(
      "aria-expanded",
      "false"
    );


  /*
    Buyer changed, so reset delivery location.
  */

  clearDeliveryLocationSelection();


  const locationInput =
    $("delivery-location-search");


  locationInput.disabled =
    false;


  locationInput.placeholder =
    "Search delivery location";


  $("add-delivery-location-btn")
    .disabled = false;


  renderDeliveryLocationOptions("");

}



function clearBuyerSelection() {

  selectedBuyer =
    null;


  $("buyer-id").value =
    "";

  $("buyer-name").value =
    "";


  clearDeliveryLocationSelection();


  const locationInput =
    $("delivery-location-search");


  locationInput.value =
    "";

  locationInput.disabled =
    true;


  locationInput.placeholder =
    "Select Buyer / Elevator first";


  $("add-delivery-location-btn")
    .disabled = true;


  renderDeliveryLocationOptions("");

}



/* ============================================================
   CUSTOMERS
============================================================ */

async function loadCustomers() {

  try {

    const q =
      query(
        collection(
          db,
          "grain_customers"
        ),
        orderBy("name")
      );


    const snapshot =
      await getDocs(q);


    customers =
      snapshot.docs
        .map(function (doc) {

          const data =
            doc.data() || {};


          return {

            id:
              doc.id,

            name:
              data.name || ""

          };

        })
        .filter(function (customer) {

          return customer.name;

        });


    renderCustomerOptions("");


  } catch (err) {

    console.error(
      "[Grain Contract] Customer load failed:",
      err
    );


    customers = [];

    renderCustomerOptions("");

  }

}



function setupCustomerPicker() {

  const lookup =
    $("customer-lookup");

  const input =
    $("customer-search");


  if (!lookup || !input) {
    return;
  }


  input.addEventListener(
    "focus",
    function () {

      lookup.classList.add("open");


      input.setAttribute(
        "aria-expanded",
        "true"
      );


      renderCustomerOptions(
        input.value
      );

    }
  );


  input.addEventListener(
    "input",
    function () {

      if (
        selectedCustomer &&
        input.value !== selectedCustomer.name
      ) {

        clearCustomerSelection();

      }


      lookup.classList.add("open");


      input.setAttribute(
        "aria-expanded",
        "true"
      );


      renderCustomerOptions(
        input.value
      );

    }
  );


  document.addEventListener(
    "click",
    function (event) {

      if (!lookup.contains(event.target)) {

        lookup.classList.remove("open");


        input.setAttribute(
          "aria-expanded",
          "false"
        );

      }

    }
  );

}



function renderCustomerOptions(searchText) {

  const menu =
    $("customer-menu");


  if (!menu) {
    return;
  }


  const search =
    String(searchText || "")
      .trim()
      .toLowerCase();


  const filtered =
    customers.filter(function (customer) {

      return customer.name
        .toLowerCase()
        .includes(search);

    });


  menu.innerHTML = "";


  if (!filtered.length) {

    const empty =
      document.createElement("div");


    empty.className =
      "lookup-empty";


    empty.textContent =
      search
        ? "No matching customers."
        : "No customers added yet.";


    menu.appendChild(empty);

    return;

  }


  filtered.forEach(function (customer) {

    const button =
      document.createElement("button");


    button.type =
      "button";


    button.className =
      "lookup-option";


    button.textContent =
      customer.name;


    button.addEventListener(
      "click",
      function () {

        selectCustomer(customer);

      }
    );


    menu.appendChild(button);

  });

}



function selectCustomer(customer) {

  selectedCustomer =
    customer;


  $("customer-search").value =
    customer.name;

  $("customer-id").value =
    customer.id;

  $("customer-name").value =
    customer.name;


  $("customer-search")
    .setCustomValidity("");


  $("customer-lookup")
    .classList
    .remove("open");


  $("customer-search")
    .setAttribute(
      "aria-expanded",
      "false"
    );

}



function clearCustomerSelection() {

  selectedCustomer =
    null;


  $("customer-id").value =
    "";

  $("customer-name").value =
    "";

}



/* ============================================================
   DELIVERY LOCATIONS
============================================================ */

async function loadDeliveryLocations() {

  try {

    const snapshot =
      await getDocs(
        collection(
          db,
          "grain_delivery_locations"
        )
      );


    deliveryLocations =
      snapshot.docs
        .map(function (doc) {

          const data =
            doc.data() || {};


          return {

            id:
              doc.id,

            buyerId:
              data.buyerId || "",

            buyerName:
              data.buyerName || "",

            locationName:
              data.locationName || "",

            street:
              data.street || "",

            city:
              data.city || "",

            state:
              data.state || "",

            zip:
              data.zip || ""

          };

        })
        .filter(function (location) {

          return (
            location.buyerId &&
            location.locationName
          );

        });


    sortDeliveryLocations();

    renderDeliveryLocationOptions("");


  } catch (err) {

    console.error(
      "[Grain Contract] Delivery location load failed:",
      err
    );


    deliveryLocations = [];

    renderDeliveryLocationOptions("");

  }

}



function sortDeliveryLocations() {

  deliveryLocations.sort(
    function (a, b) {

      return a.locationName
        .localeCompare(
          b.locationName
        );

    }
  );

}



function setupDeliveryLocationPicker() {

  const lookup =
    $("delivery-location-lookup");

  const input =
    $("delivery-location-search");


  if (!lookup || !input) {
    return;
  }


  input.addEventListener(
    "focus",
    function () {

      if (!selectedBuyer) {
        return;
      }


      lookup.classList.add("open");


      input.setAttribute(
        "aria-expanded",
        "true"
      );


      renderDeliveryLocationOptions(
        input.value
      );

    }
  );


  input.addEventListener(
    "input",
    function () {

      if (!selectedBuyer) {
        return;
      }


      if (
        selectedDeliveryLocation &&
        input.value !==
          selectedDeliveryLocation.locationName
      ) {

        clearDeliveryLocationSelection(
          false
        );

      }


      lookup.classList.add("open");


      input.setAttribute(
        "aria-expanded",
        "true"
      );


      renderDeliveryLocationOptions(
        input.value
      );

    }
  );


  document.addEventListener(
    "click",
    function (event) {

      if (!lookup.contains(event.target)) {

        lookup.classList.remove("open");


        input.setAttribute(
          "aria-expanded",
          "false"
        );

      }

    }
  );

}



function renderDeliveryLocationOptions(
  searchText
) {

  const menu =
    $("delivery-location-menu");


  if (!menu) {
    return;
  }


  menu.innerHTML = "";


  if (!selectedBuyer) {

    const empty =
      document.createElement("div");


    empty.className =
      "lookup-empty";


    empty.textContent =
      "Select Buyer / Elevator first.";


    menu.appendChild(empty);

    return;

  }


  const search =
    String(searchText || "")
      .trim()
      .toLowerCase();


  const filtered =
    deliveryLocations
      .filter(function (location) {

        return (
          location.buyerId ===
          selectedBuyer.id
        );

      })
      .filter(function (location) {

        const combined =
          [
            location.locationName,
            location.street,
            location.city,
            location.state,
            location.zip
          ]
            .join(" ")
            .toLowerCase();


        return combined.includes(
          search
        );

      });


  if (!filtered.length) {

    const empty =
      document.createElement("div");


    empty.className =
      "lookup-empty";


    empty.textContent =
      "No delivery locations for this buyer.";


    menu.appendChild(empty);

    return;

  }


  filtered.forEach(function (location) {

    const button =
      document.createElement("button");


    button.type =
      "button";


    button.className =
      "lookup-option";


    const title =
      document.createElement("span");


    title.textContent =
      location.locationName;


    const sub =
      document.createElement("span");


    sub.className =
      "lookup-option-sub";


    sub.textContent =
      formatLocationAddress(
        location
      );


    button.appendChild(title);
    button.appendChild(sub);


    button.addEventListener(
      "click",
      function () {

        selectDeliveryLocation(
          location
        );

      }
    );


    menu.appendChild(button);

  });

}



function selectDeliveryLocation(
  location
) {

  selectedDeliveryLocation =
    location;


  $("delivery-location-search").value =
    location.locationName;


  $("delivery-location-id").value =
    location.id;


  $("delivery-location-search")
    .setCustomValidity("");


  $("delivery-location-lookup")
    .classList
    .remove("open");


  $("delivery-location-search")
    .setAttribute(
      "aria-expanded",
      "false"
    );

}



function clearDeliveryLocationSelection(
  clearText = true
) {

  selectedDeliveryLocation =
    null;


  $("delivery-location-id").value =
    "";


  if (clearText) {

    $("delivery-location-search").value =
      "";

  }

}



function formatLocationAddress(
  location
) {

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
   ADD BUYER MODAL
============================================================ */

function setupBuyerModal() {

  const modal =
    $("buyer-modal");

  const addBtn =
    $("add-buyer-btn");

  const cancelBtn =
    $("cancel-add-buyer-btn");

  const saveBtn =
    $("save-buyer-btn");

  const input =
    $("new-buyer-name");


  if (
    !modal ||
    !addBtn ||
    !cancelBtn ||
    !saveBtn ||
    !input
  ) {
    return;
  }


  addBtn.addEventListener(
    "click",
    function () {

      input.value =
        "";


      modal.classList.add(
        "open"
      );


      setTimeout(
        function () {

          input.focus();

        },
        0
      );

    }
  );


  cancelBtn.addEventListener(
    "click",
    function () {

      modal.classList.remove(
        "open"
      );

    }
  );


  modal.addEventListener(
    "click",
    function (event) {

      if (event.target === modal) {

        modal.classList.remove(
          "open"
        );

      }

    }
  );


  input.addEventListener(
    "keydown",
    function (event) {

      if (event.key === "Enter") {

        event.preventDefault();

        saveBtn.click();

      }

    }
  );


  saveBtn.addEventListener(
    "click",
    addBuyer
  );

}



async function addBuyer() {

  const input =
    $("new-buyer-name");

  const saveBtn =
    $("save-buyer-btn");


  const name =
    formatName(
      input.value
    );


  if (!name) {

    input.focus();

    return;

  }


  const duplicate =
    buyers.find(function (buyer) {

      return (
        buyer.name.toLowerCase() ===
        name.toLowerCase()
      );

    });


  if (duplicate) {

    selectBuyer(
      duplicate
    );


    $("buyer-modal")
      .classList
      .remove("open");


    return;

  }


  saveBtn.disabled =
    true;


  saveBtn.textContent =
    "Adding...";


  try {

    const ref =
      await addDoc(
        collection(
          db,
          "grain_buyers"
        ),
        {

          name:
            name,

          createdAt:
            serverTimestamp(),

          updatedAt:
            serverTimestamp()

        }
      );


    const buyer = {

      id:
        ref.id,

      name:
        name

    };


    buyers.push(
      buyer
    );


    buyers.sort(
      function (a, b) {

        return a.name
          .localeCompare(
            b.name
          );

      }
    );


    selectBuyer(
      buyer
    );


    $("buyer-modal")
      .classList
      .remove("open");


  } catch (err) {

    console.error(
      "[Grain Contract] Add buyer failed:",
      err
    );


    alert(
      "Unable to add Buyer / Elevator."
    );


  } finally {

    saveBtn.disabled =
      false;


    saveBtn.textContent =
      "Add Buyer";

  }

}



/* ============================================================
   ADD CUSTOMER MODAL
============================================================ */

function setupCustomerModal() {

  const modal =
    $("customer-modal");

  const addBtn =
    $("add-customer-btn");

  const cancelBtn =
    $("cancel-add-customer-btn");

  const saveBtn =
    $("save-customer-btn");

  const input =
    $("new-customer-name");


  if (
    !modal ||
    !addBtn ||
    !cancelBtn ||
    !saveBtn ||
    !input
  ) {
    return;
  }


  addBtn.addEventListener(
    "click",
    function () {

      input.value =
        "";


      modal.classList.add(
        "open"
      );


      setTimeout(
        function () {

          input.focus();

        },
        0
      );

    }
  );


  cancelBtn.addEventListener(
    "click",
    function () {

      modal.classList.remove(
        "open"
      );

    }
  );


  modal.addEventListener(
    "click",
    function (event) {

      if (event.target === modal) {

        modal.classList.remove(
          "open"
        );

      }

    }
  );


  input.addEventListener(
    "keydown",
    function (event) {

      if (event.key === "Enter") {

        event.preventDefault();

        saveBtn.click();

      }

    }
  );


  saveBtn.addEventListener(
    "click",
    addCustomer
  );

}



async function addCustomer() {

  const input =
    $("new-customer-name");

  const saveBtn =
    $("save-customer-btn");


  const name =
    formatName(
      input.value
    );


  if (!name) {

    input.focus();

    return;

  }


  const duplicate =
    customers.find(function (
      customer
    ) {

      return (
        customer.name.toLowerCase() ===
        name.toLowerCase()
      );

    });


  if (duplicate) {

    selectCustomer(
      duplicate
    );


    $("customer-modal")
      .classList
      .remove("open");


    return;

  }


  saveBtn.disabled =
    true;


  saveBtn.textContent =
    "Adding...";


  try {

    const ref =
      await addDoc(
        collection(
          db,
          "grain_customers"
        ),
        {

          name:
            name,

          createdAt:
            serverTimestamp(),

          updatedAt:
            serverTimestamp()

        }
      );


    const customer = {

      id:
        ref.id,

      name:
        name

    };


    customers.push(
      customer
    );


    customers.sort(
      function (a, b) {

        return a.name
          .localeCompare(
            b.name
          );

      }
    );


    selectCustomer(
      customer
    );


    $("customer-modal")
      .classList
      .remove("open");


  } catch (err) {

    console.error(
      "[Grain Contract] Add customer failed:",
      err
    );


    alert(
      "Unable to add Customer."
    );


  } finally {

    saveBtn.disabled =
      false;


    saveBtn.textContent =
      "Add Customer";

  }

}



/* ============================================================
   ADD DELIVERY LOCATION MODAL
============================================================ */

function setupDeliveryLocationModal() {

  const modal =
    $("delivery-location-modal");

  const addBtn =
    $("add-delivery-location-btn");

  const cancelBtn =
    $("cancel-add-delivery-location-btn");

  const saveBtn =
    $("save-delivery-location-btn");


  if (
    !modal ||
    !addBtn ||
    !cancelBtn ||
    !saveBtn
  ) {
    return;
  }


  addBtn.addEventListener(
    "click",
    function () {

      if (!selectedBuyer) {

        alert(
          "Select Buyer / Elevator first."
        );

        return;

      }


      clearLocationModal();


      $("delivery-location-buyer-label")
        .textContent =
          `Add a delivery location for ${selectedBuyer.name}.`;


      modal.classList.add(
        "open"
      );


      setTimeout(
        function () {

          $("new-location-name")
            ?.focus();

        },
        0
      );

    }
  );


  cancelBtn.addEventListener(
    "click",
    function () {

      modal.classList.remove(
        "open"
      );

    }
  );


  modal.addEventListener(
    "click",
    function (event) {

      if (event.target === modal) {

        modal.classList.remove(
          "open"
        );

      }

    }
  );


  $("new-location-zip")
    ?.addEventListener(
      "input",
      handleZipInput
    );


  $("new-location-state")
    ?.addEventListener(
      "input",
      function () {

        this.value =
          this.value
            .replace(
              /[^a-zA-Z]/g,
              ""
            )
            .slice(0, 2)
            .toUpperCase();

      }
    );


  saveBtn.addEventListener(
    "click",
    addDeliveryLocation
  );

}



function clearLocationModal() {

  $("new-location-name").value =
    "";

  $("new-location-street").value =
    "";

  $("new-location-zip").value =
    "";

  $("new-location-city").value =
    "";

  $("new-location-state").value =
    "";

}



/* ============================================================
   ZIP LOOKUP
============================================================ */

async function handleZipInput(
  event
) {

  const input =
    event.target;


  input.value =
    input.value
      .replace(/\D/g, "")
      .slice(0, 5);


  if (
    input.value.length !== 5
  ) {
    return;
  }


  await lookupZip(
    input.value
  );

}



async function lookupZip(zip) {

  const cityInput =
    $("new-location-city");

  const stateInput =
    $("new-location-state");


  try {

    const response =
      await fetch(
        `https://api.zippopotam.us/us/${encodeURIComponent(zip)}`
      );


    if (!response.ok) {

      throw new Error(
        `ZIP lookup returned ${response.status}`
      );

    }


    const data =
      await response.json();


    const place =
      data?.places?.[0];


    if (!place) {
      return;
    }


    cityInput.value =
      place["place name"] || "";


    stateInput.value =
      place["state abbreviation"] || "";


  } catch (err) {

    console.warn(
      "[Grain Contract] ZIP lookup failed:",
      err
    );

  }

}



/* ============================================================
   ADD DELIVERY LOCATION
============================================================ */

async function addDeliveryLocation() {

  if (!selectedBuyer) {

    alert(
      "Select Buyer / Elevator first."
    );

    return;

  }


  const saveBtn =
    $("save-delivery-location-btn");


  const locationName =
    formatName(
      $("new-location-name").value
    );


  const street =
    formatName(
      $("new-location-street").value
    );


  const zip =
    $("new-location-zip")
      .value
      .trim();


  const city =
    formatName(
      $("new-location-city").value
    );


  const state =
    $("new-location-state")
      .value
      .trim()
      .toUpperCase();


  if (
    !locationName ||
    !street ||
    !zip ||
    !city ||
    !state
  ) {

    alert(
      "Complete all delivery location fields."
    );

    return;

  }


  if (!/^\d{5}$/.test(zip)) {

    alert(
      "ZIP Code must contain 5 numbers."
    );


    $("new-location-zip")
      .focus();


    return;

  }


  if (!/^[A-Z]{2}$/.test(state)) {

    alert(
      "State must contain a 2-letter abbreviation."
    );


    $("new-location-state")
      .focus();


    return;

  }


  const duplicate =
    deliveryLocations.find(
      function (location) {

        return (
          location.buyerId ===
            selectedBuyer.id &&

          location.locationName
            .toLowerCase() ===
            locationName.toLowerCase()
        );

      }
    );


  if (duplicate) {

    selectDeliveryLocation(
      duplicate
    );


    $("delivery-location-modal")
      .classList
      .remove("open");


    return;

  }


  saveBtn.disabled =
    true;


  saveBtn.textContent =
    "Adding...";


  try {

    const payload = {

      buyerId:
        selectedBuyer.id,

      buyerName:
        selectedBuyer.name,

      locationName:
        locationName,

      street:
        street,

      city:
        city,

      state:
        state,

      zip:
        zip,

      createdAt:
        serverTimestamp(),

      updatedAt:
        serverTimestamp()

    };


    const ref =
      await addDoc(
        collection(
          db,
          "grain_delivery_locations"
        ),
        payload
      );


    const location = {

      id:
        ref.id,

      buyerId:
        selectedBuyer.id,

      buyerName:
        selectedBuyer.name,

      locationName:
        locationName,

      street:
        street,

      city:
        city,

      state:
        state,

      zip:
        zip

    };


    deliveryLocations.push(
      location
    );


    sortDeliveryLocations();


    selectDeliveryLocation(
      location
    );


    $("delivery-location-modal")
      .classList
      .remove("open");


  } catch (err) {

    console.error(
      "[Grain Contract] Add delivery location failed:",
      err
    );


    alert(
      "Unable to add Delivery Location."
    );


  } finally {

    saveBtn.disabled =
      false;


    saveBtn.textContent =
      "Add Location";

  }

}



/* ============================================================
   BUSHEL FORMATTING
============================================================ */

function setupBushels() {

  const input =
    $("contract-bushels");


  if (!input) {
    return;
  }


  input.addEventListener(
    "input",
    function () {

      const digits =
        String(
          input.value || ""
        )
          .replace(/\D/g, "");


      if (!digits) {

        input.value =
          "";


        input.dataset.rawValue =
          "";


        input.setCustomValidity(
          ""
        );


        return;

      }


      const numericValue =
        Number(digits);


      if (!Number.isFinite(
        numericValue
      )) {

        return;

      }


      input.dataset.rawValue =
        String(
          numericValue
        );


      input.value =
        numericValue
          .toLocaleString(
            "en-US"
          );


      input.setCustomValidity(
        ""
      );

    }
  );

}



/* ============================================================
   CONTRACT PRICING
============================================================ */

function setupPrice() {

  const contractType =
    $("contract-type");

  const futuresInput =
    $("futures-price");

  const basisInput =
    $("basis-price");

  const cashInput =
    $("price");


  if (
    !contractType ||
    !futuresInput ||
    !basisInput ||
    !cashInput
  ) {
    return;
  }


  /*
    These fields act like a cash-register keypad.

    Examples:

      4    -> $0.04
      40   -> $0.40
      405  -> $4.05

    The user never needs to type
    a decimal point or dollar sign.
  */

  setupBankMoneyInput(
    futuresInput,
    function (value) {

      futuresPrice =
        value;

      calculateCashPrice();

    }
  );


  setupBankMoneyInput(
    basisInput,
    function (value) {

      if (value === null) {

        basisPrice =
          null;

      } else {

        basisPrice =
          roundPrice(
            Math.abs(value) *
            basisSign
          );

      }


      calculateCashPrice();

    }
  );


  setupBankMoneyInput(
    cashInput,
    function (value) {

      /*
        Cash is manually entered only
        for Program contracts.
      */

      if (
        $("contract-type").value !==
        "Program"
      ) {
        return;
      }


      cashPrice =
        value;

    }
  );


  setupBasisSignControl();


  contractType.addEventListener(
    "change",
    function () {

      resetPricing();

      updatePriceFields();

    }
  );


  futuresInput.addEventListener(
    "blur",
    validatePrice
  );


  basisInput.addEventListener(
    "blur",
    validatePrice
  );


  cashInput.addEventListener(
    "blur",
    validatePrice
  );


  updatePriceFields();

}



/* ============================================================
   BANK-STYLE MONEY INPUT
============================================================ */

function setupBankMoneyInput(
  input,
  onValueChange
) {

  if (!input) {
    return;
  }


  /*
    Force text mode so formatted values
    such as $4.05 can remain visible.
  */

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
        input.dataset.bankDigits || ""
      )
        .replace(/\D/g, "");


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


    /*
      Digits represent cents.

      4    = 4 cents
      40   = 40 cents
      405  = 405 cents = $4.05
    */

    const cents =
      Number(digits);


    if (
      !Number.isFinite(cents)
    ) {
      return;
    }


    const value =
      roundPrice(
        cents / 100
      );


    input.value =
      formatBankDollarPrice(
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


      /*
        Number entered.
      */

      if (/^\d$/.test(event.key)) {

        event.preventDefault();


        /*
          If the whole formatted value
          is selected, start fresh.
        */

        const allSelected =
          input.selectionStart === 0 &&
          input.selectionEnd ===
            input.value.length;


        let digits =
          allSelected
            ? ""
            : String(
                input.dataset.bankDigits ||
                ""
              );


        /*
          Keep the value reasonable.
          $999,999.99 is far above any
          grain price but prevents an
          accidental endless digit string.
        */

        if (
          digits.length >= 8
        ) {
          return;
        }


        digits +=
          event.key;


        /*
          Remove unnecessary leading zeros
          while still allowing zero itself.
        */

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


      /*
        Backspace moves the amount
        one digit to the right.

        $4.05
        -> $0.40
        -> $0.04
        -> $0.00
      */

      if (
        event.key === "Backspace"
      ) {

        event.preventDefault();


        let digits =
          String(
            input.dataset.bankDigits || ""
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


      /*
        Delete clears the field.
      */

      if (
        event.key === "Delete"
      ) {

        event.preventDefault();


        input.dataset.bankDigits =
          "";


        updateFromDigits();


        return;

      }


      /*
        Allow normal navigation keys.
      */

      if (
        [
          "Tab",
          "Enter",
          "Escape",
          "ArrowLeft",
          "ArrowRight",
          "Home",
          "End"
        ].includes(event.key)
      ) {

        return;

      }


      /*
        Block decimal points, dollar signs,
        minus signs, letters, etc.
      */

      event.preventDefault();

    }
  );


  /*
    Handle paste.

    Examples:

      paste 405
      -> $4.05

      paste $4.05
      -> $4.05
  */

  input.addEventListener(
    "paste",
    function (event) {

      event.preventDefault();


      const pasted =
        event.clipboardData
          ?.getData("text") || "";


      let digits =
        String(pasted)
          .replace(/\D/g, "");


      if (!digits) {

        input.dataset.bankDigits =
          "";

        updateFromDigits();

        return;

      }


      /*
        If somebody pastes an already
        formatted dollar amount such as
        $4.05, the digits are 405,
        which still produces $4.05.
      */

      digits =
        digits
          .slice(0, 8)
          .replace(
            /^0+(?=\d)/,
            ""
          );


      input.dataset.bankDigits =
        digits;


      updateFromDigits();

    }
  );


  /*
    Prevent browser/mobile input behavior
    from replacing our formatted value.
  */

  input.addEventListener(
    "input",
    function () {

      const digits =
        String(
          input.dataset.bankDigits || ""
        );


      if (!digits) {

        input.value =
          "$0.00";

        return;

      }


      const value =
        Number(digits) / 100;


      input.value =
        formatBankDollarPrice(
          value
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
   BASIS +/- CONTROL
============================================================ */

function setupBasisSignControl() {

  const basisInput =
    $("basis-price");


  if (!basisInput) {
    return;
  }


  /*
    Don't build it twice.
  */

  if (
    $("basis-sign-control")
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
    "basis-price-row";


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
    "basis-sign-control";


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
    "basis-sign-plus";

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
    "basis-sign-minus";

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


  function updateButtons() {

    const positive =
      basisSign >= 0;


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


  function applySign(
    sign
  ) {

    basisSign =
      sign;


    if (
      basisPrice !== null
    ) {

      basisPrice =
        roundPrice(
          Math.abs(
            basisPrice
          ) *
          basisSign
        );

    }


    updateButtons();

    calculateCashPrice();

  }


  plusButton.addEventListener(
    "click",
    function () {

      applySign(
        1
      );

    }
  );


  minusButton.addEventListener(
    "click",
    function () {

      applySign(
        -1
      );

    }
  );


  /*
    Default is positive.
  */

  basisSign =
    1;


  updateButtons();

}



/* ============================================================
   RESET PRICING
============================================================ */

function resetPricing() {

  futuresPrice =
    null;

  basisPrice =
    null;

  cashPrice =
    null;

  basisSign =
    1;


  const futuresInput =
    $("futures-price");

  const basisInput =
    $("basis-price");

  const cashInput =
    $("price");


  resetBankMoneyInput(
    futuresInput
  );


  resetBankMoneyInput(
    basisInput
  );


  resetBankMoneyInput(
    cashInput
  );


  updateBasisSignButtons();

}



function resetBankMoneyInput(
  input
) {

  if (!input) {
    return;
  }


  input.dataset.bankDigits =
    "";

  input.value =
    "";

  input.setCustomValidity(
    ""
  );

}



/* ============================================================
   BASIS SIGN BUTTON DISPLAY
============================================================ */

function updateBasisSignButtons() {

  const plusButton =
    $("basis-sign-plus");

  const minusButton =
    $("basis-sign-minus");


  if (
    !plusButton ||
    !minusButton
  ) {
    return;
  }


  const positive =
    basisSign >= 0;


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
   ENABLE / DISABLE PRICE FIELDS
============================================================ */

function updatePriceFields() {

  const type =
    $("contract-type")
      ?.value || "";


  const futuresInput =
    $("futures-price");

  const basisInput =
    $("basis-price");

  const cashInput =
    $("price");

  const plusButton =
    $("basis-sign-plus");

  const minusButton =
    $("basis-sign-minus");


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


  futuresInput.placeholder =
    "";

  basisInput.placeholder =
    "";

  cashInput.placeholder =
    "Not set";


  if (type === "Cash") {

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


    showEmptyBankValue(
      futuresInput
    );


    showEmptyBankValue(
      basisInput
    );


    cashInput.placeholder =
      "Calculated automatically";

  }


  else if (type === "Basis") {

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


    showEmptyBankValue(
      basisInput
    );


    cashInput.placeholder =
      "Not set until contract becomes Cash";

  }


  else if (type === "Futures") {

    futuresInput.disabled =
      false;

    futuresInput.required =
      true;


    showEmptyBankValue(
      futuresInput
    );


    cashInput.placeholder =
      "Not set until contract becomes Cash";

  }


  else if (type === "Program") {

    cashInput.disabled =
      false;

    cashInput.required =
      true;


    showEmptyBankValue(
      cashInput
    );

  }


  else {

    cashInput.placeholder =
      "Select contract type";

  }


  calculateCashPrice();

}



/* ============================================================
   EMPTY BANK VALUE DISPLAY
============================================================ */

function showEmptyBankValue(
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
   CALCULATE CASH PRICE
============================================================ */

function calculateCashPrice() {

  const type =
    $("contract-type")
      ?.value || "";


  const cashInput =
    $("price");


  if (!cashInput) {
    return;
  }


  if (type !== "Cash") {

    /*
      Program keeps its manually
      entered cash price.

      Basis and Futures have no
      final cash price yet.
    */

    if (
      type !== "Program"
    ) {

      cashPrice =
        null;

      cashInput.value =
        "";

      cashInput.dataset.bankDigits =
        "";

    }


    return;

  }


  if (
    futuresPrice === null ||
    basisPrice === null
  ) {

    cashPrice =
      null;

    cashInput.value =
      "";

    cashInput.dataset.bankDigits =
      "";

    return;

  }


  cashPrice =
    roundPrice(
      futuresPrice +
      basisPrice
    );


  cashInput.value =
    formatBankDollarPrice(
      cashPrice
    );

}



/* ============================================================
   PRICE HELPERS
============================================================ */

function roundPrice(
  value
) {

  return (
    Math.round(
      Number(value) * 10000
    ) / 10000
  );

}



function formatBankDollarPrice(
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



function formatDollarPrice(
  value
) {

  if (
    value === null ||
    !Number.isFinite(value)
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



function formatBasisPrice(
  value
) {

  if (
    value === null ||
    !Number.isFinite(value)
  ) {
    return "";
  }


  const absolute =
    Math.abs(value)
      .toLocaleString(
        "en-US",
        {

          minimumFractionDigits:
            2,

          maximumFractionDigits:
            2

        }
      );


  if (value > 0) {

    return (
      `+$${absolute}`
    );

  }


  if (value < 0) {

    return (
      `-$${absolute}`
    );

  }


  return "$0.00";

}



/* ============================================================
   PRICE VALIDATION
============================================================ */

function validatePrice() {

  const type =
    $("contract-type")
      ?.value || "";


  const futuresInput =
    $("futures-price");

  const basisInput =
    $("basis-price");

  const cashInput =
    $("price");


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


  if (type === "Cash") {

    if (futuresPrice === null) {

      futuresInput.setCustomValidity(
        "Enter the Futures Price."
      );

      return false;

    }


    if (basisPrice === null) {

      basisInput.setCustomValidity(
        "Enter the Basis."
      );

      return false;

    }


    if (cashPrice === null) {

      cashInput.setCustomValidity(
        "Unable to calculate Cash Price."
      );

      return false;

    }

  }


  else if (type === "Basis") {

    if (basisPrice === null) {

      basisInput.setCustomValidity(
        "Enter the Basis."
      );

      return false;

    }

  }


  else if (type === "Futures") {

    if (futuresPrice === null) {

      futuresInput.setCustomValidity(
        "Enter the Futures Price."
      );

      return false;

    }

  }


  else if (type === "Program") {

    if (cashPrice === null) {

      cashInput.setCustomValidity(
        "Enter the Cash Price."
      );

      return false;

    }

  }


  /*
    Keep normal grain price protection
    anywhere we actually have a final
    cash price.
  */

  if (
    cashPrice !== null &&
    (
      cashPrice < 2 ||
      cashPrice > 30
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
   DATE RULES
============================================================ */

function setupDates() {

  const contractDate =
    $("contract-date");

  const start =
    $("delivery-start");

  const end =
    $("delivery-end");


  if (
    !contractDate ||
    !start ||
    !end
  ) {
    return;
  }


  contractDate.addEventListener(
    "change",
    function () {

      updateDateLimits();

      validateDates();

    }
  );


  start.addEventListener(
    "change",
    function () {

      updateDateLimits();

      validateDates();

    }
  );


  end.addEventListener(
    "change",
    validateDates
  );


  updateDateLimits();

}



function updateDateLimits() {

  const contractDate =
    $("contract-date");

  const start =
    $("delivery-start");

  const end =
    $("delivery-end");


  /*
    Delivery Start cannot be before Contract Date.
  */

  if (contractDate.value) {

    start.min =
      contractDate.value;


    if (
      start.value &&
      start.value <
        contractDate.value
    ) {

      start.value =
        "";

    }

  } else {

    start.removeAttribute(
      "min"
    );

  }


  /*
    Delivery End must be after Delivery Start.
  */

  if (start.value) {

    const minimumEnd =
      addDays(
        start.value,
        1
      );


    end.min =
      minimumEnd;


    if (
      end.value &&
      end.value <
        minimumEnd
    ) {

      end.value =
        "";

    }

  } else {

    end.removeAttribute(
      "min"
    );

  }

}



function validateDates() {

  const contractDate =
    $("contract-date");

  const start =
    $("delivery-start");

  const end =
    $("delivery-end");


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
    date.getDate() + days
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
   IMPORT
============================================================ */

function setupImport() {

  const button =
    $("import-contract-btn");

  const input =
    $("contract-file");


  if (!button || !input) {
    return;
  }


  button.addEventListener(
    "click",
    function () {

      input.click();

    }
  );


  input.addEventListener(
    "change",
    function () {

      const file =
        input.files?.[0];


      if (!file) {
        return;
      }


      showImportStatus(
        `${file.name} selected.`
      );

    }
  );

}



function showImportStatus(
  message
) {

  const status =
    $("import-status");


  if (!status) {
    return;
  }


  status.hidden =
    false;


  status.textContent =
    message;

}



/* ============================================================
   CANCEL
============================================================ */

function setupCancel() {

  $("cancel-btn")
    ?.addEventListener(
      "click",
      function () {

        window.location.href =
          "/pages/grain/grain-contracts.html";

      }
    );

}



/* ============================================================
   VALIDATION
============================================================ */

function validateSelections() {

  const buyerInput =
    $("buyer-search");

  const customerInput =
    $("customer-search");

  const locationInput =
    $("delivery-location-search");


  buyerInput.setCustomValidity(
    ""
  );


  customerInput.setCustomValidity(
    ""
  );


  locationInput.setCustomValidity(
    ""
  );


  if (!selectedBuyer?.id) {

    buyerInput.setCustomValidity(
      "Select a Buyer / Elevator from the list or add a new one."
    );

  }


  if (!selectedCustomer?.id) {

    customerInput.setCustomValidity(
      "Select a Customer from the list or add a new one."
    );

  }


  if (!selectedDeliveryLocation?.id) {

    locationInput.setCustomValidity(
      "Select a Delivery Location from the list or add a new one."
    );

  }


  return Boolean(
    selectedBuyer?.id &&
    selectedCustomer?.id &&
    selectedDeliveryLocation?.id
  );

}



/* ============================================================
   SAVE
============================================================ */

async function handleSaveContract(
  event
) {

  event.preventDefault();


  const form =
    $("grain-contract-form");

  const saveBtn =
    $("save-btn");


  validateSelections();
  validatePrice();
  validateDates();


  const bushels =
    Number(
      $("contract-bushels")
        ?.dataset
        .rawValue
    );


  if (
    !Number.isFinite(bushels) ||
    bushels <= 0
  ) {

    $("contract-bushels")
      .setCustomValidity(
        "Enter Contract Bushels."
      );

  } else {

    $("contract-bushels")
      .setCustomValidity(
        ""
      );

  }


  if (!form.reportValidity()) {

    return;

  }


  saveBtn.disabled =
    true;


  saveBtn.textContent =
    "Saving...";


  try {

    const data =
      getFormData();


    console.log(
      "[Grain Contract] Saving:",
      data
    );


    await addDoc(
      collection(
        db,
        "grain_contracts"
      ),
      {

        ...data,

        createdAt:
          serverTimestamp(),

        updatedAt:
          serverTimestamp()

      }
    );


    window.location.href =
      "/pages/grain/grain-contracts.html";


  } catch (err) {

    console.error(
      "[Grain Contract] Save failed:",
      err
    );


    alert(
      "Unable to save grain contract."
    );


  } finally {

    saveBtn.disabled =
      false;


    saveBtn.textContent =
      "Save Contract";

  }

}



/* ============================================================
   CONTRACT DATA
============================================================ */

function getFormData() {

  const bushels =
    Number(
      $("contract-bushels")
        ?.dataset
        .rawValue
    ) || 0;


  const contractType =
    $("contract-type")
      .value;


  /*
    Only Cash and Program contracts
    have a final cash price.

    Basis and Futures contracts remain
    open-priced until converted to Cash.
  */

  const finalPricePerBushel =
    (
      contractType === "Cash" ||
      contractType === "Program"
    )
      ? cashPrice
      : null;


  return {

    /* Buyer */

    buyerId:
      selectedBuyer.id,

    buyerName:
      selectedBuyer.name,


    /* Customer */

    customerId:
      selectedCustomer.id,

    customerName:
      selectedCustomer.name,


    /* Contract */

    crop:
      $("crop").value,

    contractType:
      contractType,

    contractNumber:
      $("contract-number")
        .value
        .trim(),

    contractDate:
      $("contract-date")
        .value,


    /* Bushels */

    contractBushels:
      bushels,

    deliveredBushels:
      0,

    openBushels:
      bushels,


    /* Pricing */

    futuresPrice:
      futuresPrice,

    basisPrice:
      basisPrice,

    pricePerBushel:
      finalPricePerBushel,


    /* Delivery location snapshot */

    deliveryLocationId:
      selectedDeliveryLocation.id,

    deliveryLocationName:
      selectedDeliveryLocation.locationName,

    deliveryStreet:
      selectedDeliveryLocation.street,

    deliveryCity:
      selectedDeliveryLocation.city,

    deliveryState:
      selectedDeliveryLocation.state,

    deliveryZip:
      selectedDeliveryLocation.zip,


    /* Delivery dates */

    deliveryStart:
      $("delivery-start")
        .value,

    deliveryEnd:
      $("delivery-end")
        .value,


    /* Notes */

    notes:
      $("notes")
        .value
        .trim()

  };

}
