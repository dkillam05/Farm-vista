// /Farm-vista/js/grain-contract-add.js
// Rev: 2026-08-14-grain-contract-add-v1
//
// PURPOSE:
// Add Grain Contract
//
// Handles:
// ✅ Searchable Buyer / Elevator dropdown
// ✅ Add new Buyer / Elevator
// ✅ Searchable Customer dropdown
// ✅ Add new Customer
// ✅ Proper name formatting
// ✅ Required field validation
// ✅ Contract save to Firestore
// ✅ Import Contract file picker
//
// FIRESTORE COLLECTIONS:
// grain_buyers
// grain_customers
// grain_contracts

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  let db = null;

  let buyers = [];
  let customers = [];

  let selectedBuyer = null;
  let selectedCustomer = null;


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

    const form = $("grain-contract-form");

    if (!form) {
      console.warn("[Grain Contract] Form not found.");
      return;
    }


    /* ----------------------------------------------------------
       FIRESTORE
    ---------------------------------------------------------- */

    db = getFirestore();

    if (!db) {
      console.error(
        "[Grain Contract] Firestore was not available."
      );
    }


    /* ----------------------------------------------------------
       SETUP CONTROLS
    ---------------------------------------------------------- */

    setupBuyerPicker();
    setupCustomerPicker();

    setupBuyerModal();
    setupCustomerModal();

    setupImport();
    setupCancel();
    setupPrice();
    setupDeliveryDates();


    /* ----------------------------------------------------------
       LOAD LISTS
    ---------------------------------------------------------- */

    await Promise.all([
      loadBuyers(),
      loadCustomers()
    ]);


    /* ----------------------------------------------------------
       SAVE
    ---------------------------------------------------------- */

    form.addEventListener(
      "submit",
      handleSaveContract
    );

  });



  /* ============================================================
     GET FIRESTORE
  ============================================================ */

  function getFirestore() {

    /*
      FarmVista may already expose Firestore through
      one of these common locations.
    */

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



  /* ============================================================
     NAME FORMATTING
  ============================================================ */

  function formatName(value) {

    value = String(value || "")
      .trim()
      .replace(/\s+/g, " ");

    if (!value) return "";


    return value
      .split(" ")
      .map(function (word) {

        /*
          Preserve something intentionally entered
          completely uppercase such as ADM, CHS, LLC.
        */

        if (
          word.length >= 2 &&
          word === word.toUpperCase() &&
          /[A-Z]/.test(word)
        ) {
          return word;
        }


        /*
          Normal title case.
        */

        return word
          .toLowerCase()
          .replace(
            /(^|[-'/])([a-z])/g,
            function (_, prefix, letter) {
              return prefix + letter.toUpperCase();
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
      renderBuyerOptions("");
      return;
    }

    try {

      const snapshot =
        await db
          .collection("grain_buyers")
          .orderBy("name")
          .get();


      buyers = snapshot.docs
        .map(function (doc) {

          const data = doc.data() || {};

          return {
            id: doc.id,
            name: data.name || ""
          };

        })
        .filter(function (item) {
          return item.name;
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

    const lookup = $("buyer-lookup");
    const input = $("buyer-search");

    if (!lookup || !input) return;


    input.addEventListener("focus", function () {

      lookup.classList.add("open");

      input.setAttribute(
        "aria-expanded",
        "true"
      );

      renderBuyerOptions(input.value);

    });


    input.addEventListener("input", function () {

      /*
        If the user changes the text after selecting
        a buyer, it is no longer a valid selection.
      */

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

      renderBuyerOptions(input.value);

    });


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

    const menu = $("buyer-menu");

    if (!menu) return;


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

      empty.className = "lookup-empty";

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

      button.type = "button";
      button.className = "lookup-option";
      button.textContent = buyer.name;

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

    selectedBuyer = buyer;

    $("buyer-search").value =
      buyer.name;

    $("buyer-id").value =
      buyer.id;

    $("buyer-name").value =
      buyer.name;


    $("buyer-search").setCustomValidity("");


    $("buyer-lookup")
      .classList
      .remove("open");


    $("buyer-search").setAttribute(
      "aria-expanded",
      "false"
    );

  }



  function clearBuyerSelection() {

    selectedBuyer = null;

    $("buyer-id").value = "";
    $("buyer-name").value = "";

  }



  /* ============================================================
     CUSTOMERS
  ============================================================ */

  async function loadCustomers() {

    if (!db) {
      renderCustomerOptions("");
      return;
    }

    try {

      const snapshot =
        await db
          .collection("grain_customers")
          .orderBy("name")
          .get();


      customers = snapshot.docs
        .map(function (doc) {

          const data = doc.data() || {};

          return {
            id: doc.id,
            name: data.name || ""
          };

        })
        .filter(function (item) {
          return item.name;
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

    if (!lookup || !input) return;


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

    if (!menu) return;


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

        button.type = "button";

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

    selectedCustomer = customer;


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

    selectedCustomer = null;

    $("customer-id").value = "";
    $("customer-name").value = "";

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

        input.value = "";

        modal.classList.add("open");

        setTimeout(function () {
          input.focus();
        }, 0);

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
      buyers.find(function (buyer) {

        return buyer.name
          .toLowerCase() ===
          name.toLowerCase();

      });


    if (duplicate) {

      selectBuyer(duplicate);

      $("buyer-modal")
        .classList
        .remove("open");

      return;

    }


    if (!db) {

      alert(
        "Firestore is not available. Buyer could not be saved."
      );

      return;

    }


    saveBtn.disabled = true;
    saveBtn.textContent = "Adding...";


    try {

      const payload = {
        name: name,
        createdAt:
          firebase.firestore.FieldValue
            .serverTimestamp(),
        updatedAt:
          firebase.firestore.FieldValue
            .serverTimestamp()
      };


      const ref =
        await db
          .collection("grain_buyers")
          .add(payload);


      const buyer = {
        id: ref.id,
        name: name
      };


      buyers.push(buyer);

      buyers.sort(
        function (a, b) {
          return a.name.localeCompare(b.name);
        }
      );


      selectBuyer(buyer);

      renderBuyerOptions("");


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
      saveBtn.textContent = "Add Buyer";

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

        input.value = "";

        modal.classList.add("open");

        setTimeout(function () {
          input.focus();
        }, 0);

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

          return customer.name
            .toLowerCase() ===
            name.toLowerCase();

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
        "Firestore is not available. Customer could not be saved."
      );

      return;

    }


    saveBtn.disabled = true;
    saveBtn.textContent = "Adding...";


    try {

      const payload = {
        name: name,

        createdAt:
          firebase.firestore.FieldValue
            .serverTimestamp(),

        updatedAt:
          firebase.firestore.FieldValue
            .serverTimestamp()
      };


      const ref =
        await db
          .collection("grain_customers")
          .add(payload);


      const customer = {
        id: ref.id,
        name: name
      };


      customers.push(customer);

      customers.sort(
        function (a, b) {
          return a.name.localeCompare(b.name);
        }
      );


      selectCustomer(customer);

      renderCustomerOptions("");


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
      saveBtn.textContent = "Add Customer";

    }

  }



  /* ============================================================
     PRICE
  ============================================================ */

  function setupPrice() {

    const price = $("price");

    if (!price) return;


    price.addEventListener(
      "blur",
      function () {

        if (!price.value) return;

        const value =
          Number(
            String(price.value)
              .replace(/[$,]/g, "")
          );


        if (!Number.isFinite(value)) {
          return;
        }


        /*
          Grain prices often need 4 decimals.
        */

        price.value =
          value.toFixed(4);

      }
    );

  }



  /* ============================================================
     DELIVERY DATE VALIDATION
  ============================================================ */

  function setupDeliveryDates() {

    const start =
      $("delivery-start");

    const end =
      $("delivery-end");


    if (!start || !end) return;


    function validateDates() {

      end.setCustomValidity("");


      if (
        start.value &&
        end.value &&
        end.value < start.value
      ) {

        end.setCustomValidity(
          "Delivery End cannot be before Delivery Start."
        );

      }

    }


    start.addEventListener(
      "change",
      validateDates
    );

    end.addEventListener(
      "change",
      validateDates
    );

  }



  /* ============================================================
     IMPORT CONTRACT
  ============================================================ */

  function setupImport() {

    const button =
      $("import-contract-btn");

    const input =
      $("contract-file");


    if (!button || !input) return;


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

        if (!file) return;


        showImportStatus(
          `${file.name} selected. Automatic contract reading will be added next.`,
          false
        );

      }
    );

  }



  function showImportStatus(
    message,
    isError
  ) {

    const status =
      $("import-status");

    if (!status) return;


    status.hidden = false;

    status.textContent =
      message;

    status.style.color =
      isError
        ? "#b3261e"
        : "";

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
     VALIDATE BUYER + CUSTOMER
  ============================================================ */

  function validateLookupSelections() {

    const buyerInput =
      $("buyer-search");

    const customerInput =
      $("customer-search");


    buyerInput.setCustomValidity("");
    customerInput.setCustomValidity("");


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


    return Boolean(
      selectedBuyer?.id &&
      selectedCustomer?.id
    );

  }



  /* ============================================================
     SAVE CONTRACT
  ============================================================ */

  async function handleSaveContract(event) {

    event.preventDefault();


    const form =
      $("grain-contract-form");

    const saveBtn =
      $("save-btn");


    validateLookupSelections();


    if (!form.reportValidity()) {
      return;
    }


    if (!db) {

      alert(
        "Firestore is not available. Contract cannot be saved."
      );

      return;

    }


    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";


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
            firebase.firestore.FieldValue
              .serverTimestamp(),

          updatedAt:
            firebase.firestore.FieldValue
              .serverTimestamp()

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
     GET FORM DATA
  ============================================================ */

  function getFormData() {

    return {

      /* Buyer */

      buyerId:
        selectedBuyer?.id || "",

      buyerName:
        selectedBuyer?.name || "",


      /* Customer */

      customerId:
        selectedCustomer?.id || "",

      customerName:
        selectedCustomer?.name || "",


      /* Contract */

      crop:
        $("crop")?.value || "",

      contractType:
        $("contract-type")?.value || "",

      contractNumber:
        $("contract-number")
          ?.value
          .trim() || "",

      contractDate:
        $("contract-date")
          ?.value || "",


      /* Bushels */

      contractBushels:
        Number(
          $("contract-bushels")?.value
        ) || 0,


      /*
        These are initialized now because
        reconciliation will use them later.
      */

      deliveredBushels: 0,

      openBushels:
        Number(
          $("contract-bushels")?.value
        ) || 0,


      /* Price */

      price:
        Number(
          String(
            $("price")?.value || ""
          )
            .replace(/[$,]/g, "")
        ),


      /* Delivery */

      deliveryLocation:
        $("delivery-location")
          ?.value
          .trim() || "",

      deliveryStart:
        $("delivery-start")
          ?.value || "",

      deliveryEnd:
        $("delivery-end")
          ?.value || "",


      /* Notes */

      notes:
        $("notes")
          ?.value
          .trim() || ""

    };

  }

})();
