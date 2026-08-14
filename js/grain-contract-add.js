// /Farm-vista/js/grain-contract-add.js
// Rev: 2026-08-14-grain-contract-add-v2
//
// PURPOSE:
// Add Grain Contract
//
// FEATURES:
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
// ✅ Save contract to Firestore
//
// FIRESTORE:
// grain_buyers
// grain_customers
// grain_delivery_locations
// grain_contracts

(function () {
  "use strict";


  /* ============================================================
     STATE
  ============================================================ */

  const $ = (id) =>
    document.getElementById(id);


  let db = null;

  let buyers = [];
  let customers = [];
  let deliveryLocations = [];

  let selectedBuyer = null;
  let selectedCustomer = null;
  let selectedDeliveryLocation = null;

  let priceCents = 0;
  let priceHasValue = false;



  /* ============================================================
     READY
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


    db =
      getFirestore();


    if (!db) {

      console.error(
        "[Grain Contract] Firestore not available."
      );

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


    await Promise.all([
      loadBuyers(),
      loadCustomers(),
      loadDeliveryLocations()
    ]);


    form.addEventListener(
      "submit",
      handleSaveContract
    );

  });



  /* ============================================================
     FIRESTORE
  ============================================================ */

  function getFirestore() {

    if (window.db) {
      return window.db;
    }


    if (window.FV?.db) {
      return window.FV.db;
    }


    if (
      window.firebase &&
      typeof window.firebase.firestore === "function"
    ) {

      return window.firebase.firestore();

    }


    return null;

  }



  function serverTimestamp() {

    if (
      window.firebase?.firestore?.FieldValue
    ) {

      return window.firebase
        .firestore
        .FieldValue
        .serverTimestamp();

    }


    return new Date();

  }



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
          Preserve obvious acronyms:
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

    if (!db) {

      buyers = [];
      renderBuyerOptions("");

      return;

    }


    try {

      const snapshot =
        await db
          .collection("grain_buyers")
          .orderBy("name")
          .get();


      buyers =
        snapshot.docs
          .map(function (doc) {

            const data =
              doc.data() || {};


            return {
              id: doc.id,
              name: data.name || ""
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


    /*
      Changing Buyer resets Delivery Location.
    */

    clearDeliveryLocationSelection();


    const deliveryInput =
      $("delivery-location-search");

    const addLocationBtn =
      $("add-delivery-location-btn");


    deliveryInput.disabled =
      false;

    deliveryInput.placeholder =
      "Search delivery location";


    addLocationBtn.disabled =
      false;


    renderDeliveryLocationOptions("");


    $("buyer-search")
      .setAttribute(
        "aria-expanded",
        "false"
      );

  }



  function clearBuyerSelection() {

    selectedBuyer = null;


    $("buyer-id").value = "";
    $("buyer-name").value = "";


    clearDeliveryLocationSelection();


    const deliveryInput =
      $("delivery-location-search");


    deliveryInput.value = "";
    deliveryInput.disabled = true;

    deliveryInput.placeholder =
      "Select Buyer / Elevator first";


    $("add-delivery-location-btn")
      .disabled = true;


    renderDeliveryLocationOptions("");

  }



  /* ============================================================
     CUSTOMERS
  ============================================================ */

  async function loadCustomers() {

    if (!db) {

      customers = [];

      renderCustomerOptions("");

      return;

    }


    try {

      const snapshot =
        await db
          .collection("grain_customers")
          .orderBy("name")
          .get();


      customers =
        snapshot.docs
          .map(function (doc) {

            const data =
              doc.data() || {};


            return {
              id: doc.id,
              name: data.name || ""
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
      customers.filter(
        function (customer) {

          return customer.name
            .toLowerCase()
            .includes(search);

        }
      );


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


    filtered.forEach(
      function (customer) {

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

      }
    );

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

  }



  function clearCustomerSelection() {

    selectedCustomer =
      null;


    $("customer-id").value = "";
    $("customer-name").value = "";

  }



  /* ============================================================
     DELIVERY LOCATIONS
  ============================================================ */

  async function loadDeliveryLocations() {

    if (!db) {

      deliveryLocations = [];

      renderDeliveryLocationOptions("");

      return;

    }


    try {

      const snapshot =
        await db
          .collection(
            "grain_delivery_locations"
          )
          .get();


      deliveryLocations =
        snapshot.docs
          .map(function (doc) {

            const data =
              doc.data() || {};


            return {

              id: doc.id,

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


          return combined.includes(search);

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


    filtered.forEach(
      function (location) {

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


        const address =
          document.createElement("span");


        address.className =
          "lookup-option-sub";


        address.textContent =
          formatLocationAddress(
            location
          );


        button.appendChild(title);
        button.appendChild(address);


        button.addEventListener(
          "click",
          function () {

            selectDeliveryLocation(
              location
            );

          }
        );


        menu.appendChild(button);

      }
    );

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

    const cityStateZip =
      [
        location.city,
        location.state
      ]
        .filter(Boolean)
        .join(", ") +
      (
        location.zip
          ? ` ${location.zip}`
          : ""
      );


    return [
      location.street,
      cityStateZip.trim()
    ]
      .filter(Boolean)
      .join(" • ");

  }



  /* ============================================================
     ADD BUYER
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

        input.value = "";

        modal.classList.add("open");


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

        modal.classList.remove("open");

      }
    );


    modal.addEventListener(
      "click",
      function (event) {

        if (event.target === modal) {

          modal.classList.remove("open");

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
      formatName(input.value);


    if (!name) {

      input.focus();

      return;

    }


    const duplicate =
      buyers.find(
        function (buyer) {

          return (
            buyer.name.toLowerCase() ===
            name.toLowerCase()
          );

        }
      );


    if (duplicate) {

      selectBuyer(duplicate);

      $("buyer-modal")
        .classList
        .remove("open");

      return;

    }


    if (!db) {

      alert(
        "Firestore is not available."
      );

      return;

    }


    saveBtn.disabled = true;
    saveBtn.textContent = "Adding...";


    try {

      const ref =
        await db
          .collection("grain_buyers")
          .add({

            name: name,

            createdAt:
              serverTimestamp(),

            updatedAt:
              serverTimestamp()

          });


      const buyer = {
        id: ref.id,
        name: name
      };


      buyers.push(buyer);


      buyers.sort(
        function (a, b) {

          return a.name
            .localeCompare(b.name);

        }
      );


      selectBuyer(buyer);


      $("buyer-modal")
        .classList
        .remove("open");


    } catch (err) {

      console.error(
        "[Grain Contract] Add buyer failed:",
        err
      );


      alert(
        "Unable to add buyer."
      );


    } finally {

      saveBtn.disabled = false;
      saveBtn.textContent =
        "Add Buyer";

    }

  }



  /* ============================================================
     ADD CUSTOMER
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

        input.value = "";

        modal.classList.add("open");


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

        modal.classList.remove("open");

      }
    );


    modal.addEventListener(
      "click",
      function (event) {

        if (event.target === modal) {

          modal.classList.remove("open");

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
      formatName(input.value);


    if (!name) {

      input.focus();

      return;

    }


    const duplicate =
      customers.find(
        function (customer) {

          return (
            customer.name.toLowerCase() ===
            name.toLowerCase()
          );

        }
      );


    if (duplicate) {

      selectCustomer(duplicate);

      $("customer-modal")
        .classList
        .remove("open");

      return;

    }


    if (!db) {

      alert(
        "Firestore is not available."
      );

      return;

    }


    saveBtn.disabled = true;
    saveBtn.textContent = "Adding...";


    try {

      const ref =
        await db
          .collection("grain_customers")
          .add({

            name: name,

            createdAt:
              serverTimestamp(),

            updatedAt:
              serverTimestamp()

          });


      const customer = {
        id: ref.id,
        name: name
      };


      customers.push(customer);


      customers.sort(
        function (a, b) {

          return a.name
            .localeCompare(b.name);

        }
      );


      selectCustomer(customer);


      $("customer-modal")
        .classList
        .remove("open");


    } catch (err) {

      console.error(
        "[Grain Contract] Add customer failed:",
        err
      );


      alert(
        "Unable to add customer."
      );


    } finally {

      saveBtn.disabled = false;
      saveBtn.textContent =
        "Add Customer";

    }

  }



  /* ============================================================
     ADD DELIVERY LOCATION
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


        modal.classList.add("open");


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

        modal.classList.remove("open");

      }
    );


    modal.addEventListener(
      "click",
      function (event) {

        if (event.target === modal) {

          modal.classList.remove("open");

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
              .replace(/[^a-zA-Z]/g, "")
              .slice(0,2)
              .toUpperCase();

        }
      );


    saveBtn.addEventListener(
      "click",
      addDeliveryLocation
    );

  }



  function clearLocationModal() {

    $("new-location-name").value = "";
    $("new-location-street").value = "";
    $("new-location-zip").value = "";
    $("new-location-city").value = "";
    $("new-location-state").value = "";

  }



  async function handleZipInput(event) {

    const zipInput =
      event.target;


    zipInput.value =
      zipInput.value
        .replace(/\D/g, "")
        .slice(0,5);


    if (
      zipInput.value.length !== 5
    ) {
      return;
    }


    await lookupZip(
      zipInput.value
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

      /*
        Do not block the user.
        They can still manually enter City / State.
      */

      console.warn(
        "[Grain Contract] ZIP lookup failed:",
        err
      );

    }

  }



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
        "State must be a 2-letter abbreviation."
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


    if (!db) {

      alert(
        "Firestore is not available."
      );

      return;

    }


    saveBtn.disabled = true;
    saveBtn.textContent = "Adding...";


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
        await db
          .collection(
            "grain_delivery_locations"
          )
          .add(payload);


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
        "Unable to add delivery location."
      );


    } finally {

      saveBtn.disabled = false;
      saveBtn.textContent =
        "Add Location";

    }

  }



  /* ============================================================
     CONTRACT BUSHELS
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
          String(input.value || "")
            .replace(/\D/g, "");


        if (!digits) {

          input.value = "";

          input.dataset.rawValue = "";

          return;

        }


        /*
          Strip leading zeroes.
        */

        const raw =
          String(
            Number(digits)
          );


        input.dataset.rawValue =
          raw;


        input.value =
          Number(raw)
            .toLocaleString("en-US");

      }
    );

  }



  /* ============================================================
     PRICE PER BUSHEL
     BANK-STYLE INPUT
  ============================================================ */

  function setupPrice() {

    const input =
      $("price");


    if (!input) {
      return;
    }


    /*
      We control the contents ourselves.
      This avoids caret problems with "$" and ".".
    */

    input.addEventListener(
      "keydown",
      function (event) {

        /*
          Allow navigation/tab.
        */

        if (
          event.key === "Tab" ||
          event.key === "ArrowLeft" ||
          event.key === "ArrowRight" ||
          event.key === "Home" ||
          event.key === "End"
        ) {

          return;

        }


        /*
          Number pressed.
        */

        if (/^\d$/.test(event.key)) {

          event.preventDefault();


          priceHasValue =
            true;


          priceCents =
            Math.min(
              999999,
              (priceCents * 10) +
              Number(event.key)
            );


          renderPrice();

          return;

        }


        /*
          Backspace.
        */

        if (
          event.key === "Backspace" ||
          event.key === "Delete"
        ) {

          event.preventDefault();


          priceCents =
            Math.floor(
              priceCents / 10
            );


          if (priceCents === 0) {

            priceHasValue =
              false;

          }


          renderPrice();

          return;

        }


        /*
          Allow Ctrl / Cmd combinations.
        */

        if (
          event.ctrlKey ||
          event.metaKey
        ) {

          return;

        }


        event.preventDefault();

      }
    );


    /*
      Mobile keyboards are not always consistent
      with keydown. beforeinput provides backup.
    */

    input.addEventListener(
      "beforeinput",
      function (event) {

        if (
          event.inputType ===
          "insertText" &&
          /^\d$/.test(event.data || "")
        ) {

          event.preventDefault();


          priceHasValue =
            true;


          priceCents =
            Math.min(
              999999,
              (priceCents * 10) +
              Number(event.data)
            );


          renderPrice();

        }


        if (
          event.inputType ===
          "deleteContentBackward"
        ) {

          event.preventDefault();


          priceCents =
            Math.floor(
              priceCents / 10
            );


          if (priceCents === 0) {

            priceHasValue =
              false;

          }


          renderPrice();

        }

      }
    );


    input.addEventListener(
      "paste",
      function (event) {

        event.preventDefault();


        const text =
          event.clipboardData
            ?.getData("text") || "";


        const digits =
          text.replace(/\D/g, "");


        if (!digits) {
          return;
        }


        priceHasValue =
          true;


        priceCents =
          Number(digits);


        renderPrice();

      }
    );


    input.addEventListener(
      "blur",
      validatePrice
    );

  }



  function renderPrice() {

    const input =
      $("price");


    if (!input) {
      return;
    }


    if (!priceHasValue) {

      input.value = "";

      input.dataset.rawValue =
        "";

      input.setCustomValidity("");

      return;

    }


    const dollars =
      priceCents / 100;


    input.value =
      dollars.toLocaleString(
        "en-US",
        {
          style:"currency",
          currency:"USD",
          minimumFractionDigits:2,
          maximumFractionDigits:2
        }
      );


    input.dataset.rawValue =
      dollars.toFixed(2);


    validatePrice();

  }



  function validatePrice() {

    const input =
      $("price");


    if (!input) {
      return false;
    }


    input.setCustomValidity("");


    if (!priceHasValue) {

      return false;

    }


    const value =
      priceCents / 100;


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
     DATES
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
      Delivery Start may be the SAME date
      as Contract Date, but never before it.
    */

    if (contractDate.value) {

      start.min =
        contractDate.value;


      /*
        If an old selected value becomes invalid,
        clear it.
      */

      if (
        start.value &&
        start.value <
          contractDate.value
      ) {

        start.value = "";

      }

    } else {

      start.removeAttribute("min");

    }


    /*
      Delivery End must be AFTER Start,
      therefore minimum = next calendar day.
    */

    if (start.value) {

      const nextDay =
        addDays(
          start.value,
          1
        );


      end.min =
        nextDay;


      if (
        end.value &&
        end.value < nextDay
      ) {

        end.value = "";

      }

    } else {

      end.removeAttribute("min");

    }

  }



  function validateDates() {

    const contractDate =
      $("contract-date");

    const start =
      $("delivery-start");

    const end =
      $("delivery-end");


    start.setCustomValidity("");
    end.setCustomValidity("");


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
        .padStart(2,"0");


    const dd =
      String(
        date.getDate()
      )
        .padStart(2,"0");


    return `${yyyy}-${mm}-${dd}`;

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
            "/Farm-vista/pages/grain/grain-contracts.html";

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


    buyerInput.setCustomValidity("");
    customerInput.setCustomValidity("");
    locationInput.setCustomValidity("");


    if (!selectedBuyer?.id) {

      buyerInput.setCustomValidity(
        "Select Buyer / Elevator from the list or add a new one."
      );

    }


    if (!selectedCustomer?.id) {

      customerInput.setCustomValidity(
        "Select Customer from the list or add a new one."
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
     SAVE CONTRACT
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


    if (!form.reportValidity()) {

      return;

    }


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


      $("contract-bushels")
        .reportValidity();


      return;

    }


    $("contract-bushels")
      .setCustomValidity("");


    if (!db) {

      alert(
        "Firestore is not available. Contract cannot be saved."
      );

      return;

    }


    saveBtn.disabled = true;
    saveBtn.textContent =
      "Saving...";


    try {

      const data =
        getFormData();


      console.log(
        "[Grain Contract] Saving:",
        data
      );


      await db
        .collection("grain_contracts")
        .add({

          ...data,

          createdAt:
            serverTimestamp(),

          updatedAt:
            serverTimestamp()

        });


      window.location.href =
        "/Farm-vista/pages/grain/grain-contracts.html";


    } catch (err) {

      console.error(
        "[Grain Contract] Save failed:",
        err
      );


      alert(
        "Unable to save grain contract."
      );


    } finally {

      saveBtn.disabled = false;
      saveBtn.textContent =
        "Save Contract";

    }

  }



  /* ============================================================
     FORM DATA
  ============================================================ */

  function getFormData() {

    const bushels =
      Number(
        $("contract-bushels")
          ?.dataset
          .rawValue
      ) || 0;


    const price =
      priceCents / 100;


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


      /* Crop / Contract */

      crop:
        $("crop").value,

      contractType:
        $("contract-type").value,

      contractNumber:
        $("contract-number")
          .value
          .trim(),

      contractDate:
        $("contract-date")
          .value,


      /* Grain */

      contractBushels:
        bushels,

      deliveredBushels:
        0,

      openBushels:
        bushels,

      pricePerBushel:
        price,


      /* Delivery Location Snapshot */

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


      /* Delivery Dates */

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

})();
