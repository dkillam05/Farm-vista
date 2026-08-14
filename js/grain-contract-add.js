// /Farm-vista/js/grain-contract-add.js
// PURPOSE:
// Grain Contract add/edit form
// - Import contract file
// - Prefill contract fields
// - Validate
// - Save to Firestore

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  function onReady(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  onReady(function () {

    const form = $("grain-contract-form");

    const importBtn = $("import-contract-btn");
    const fileInput = $("contract-file");
    const importStatus = $("import-status");

    const cancelBtn = $("cancel-btn");
    const saveBtn = $("save-btn");

    // ---------------------------------------------------------
    // DEFAULTS
    // ---------------------------------------------------------

    const cropYear = $("crop-year");

    if (cropYear && !cropYear.value) {
      cropYear.value = new Date().getFullYear();
    }


    // ---------------------------------------------------------
    // IMPORT BUTTON
    // ---------------------------------------------------------

    importBtn?.addEventListener("click", function () {
      fileInput?.click();
    });


    fileInput?.addEventListener("change", async function () {

      const file = fileInput.files?.[0];

      if (!file) return;

      showImportStatus(
        `Selected: ${file.name}`,
        false
      );

      try {

        await importContractFile(file);

      } catch (err) {

        console.error("[Grain Contract] Import failed:", err);

        showImportStatus(
          "Contract could not be imported.",
          true
        );
      }

    });


    // ---------------------------------------------------------
    // CANCEL
    // ---------------------------------------------------------

    cancelBtn?.addEventListener("click", function () {

      window.location.href =
        "/Farm-vista/pages/grain/grain-contracts.html";

    });


    // ---------------------------------------------------------
    // SAVE
    // ---------------------------------------------------------

    form?.addEventListener("submit", async function (event) {

      event.preventDefault();

      if (!form.reportValidity()) {
        return;
      }

      saveBtn.disabled = true;
      saveBtn.textContent = "Saving...";

      try {

        const data = getFormData();

        console.log("[Grain Contract] Save:", data);

        /*
          NEXT STEP:

          await db.collection("grain_contracts").add({
            ...data,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        */

        alert("Contract form is ready. Firestore save is next.");

      } catch (err) {

        console.error("[Grain Contract] Save failed:", err);

        alert("Unable to save contract.");

      } finally {

        saveBtn.disabled = false;
        saveBtn.textContent = "Save Contract";

      }

    });


    // ---------------------------------------------------------
    // IMPORT
    // ---------------------------------------------------------

    async function importContractFile(file) {

      /*
       * This is where we will eventually:
       *
       * 1. Upload/read the document
       * 2. Extract contract data
       * 3. Return normalized fields
       * 4. Call fillForm()
       *
       * Example:
       *
       * fillForm({
       *   contractNumber: "123456",
       *   buyer: "ADM",
       *   crop: "Corn",
       *   cropYear: 2026,
       *   quantityBu: 25000,
       *   price: 4.62,
       *   contractType: "Cash",
       *   deliveryLocation: "Taylorville",
       *   deliveryStart: "2026-10-01",
       *   deliveryEnd: "2026-10-31"
       * });
       */

      showImportStatus(
        `${file.name} is ready for contract extraction.`,
        false
      );

    }


    // ---------------------------------------------------------
    // PREFILL FORM
    // ---------------------------------------------------------

    function fillForm(data = {}) {

      setValue("contract-number", data.contractNumber);
      setValue("buyer", data.buyer);
      setValue("crop", data.crop);
      setValue("crop-year", data.cropYear);
      setValue("quantity", data.quantityBu);
      setValue("price", data.price);
      setValue("contract-type", data.contractType);
      setValue("delivery-location", data.deliveryLocation);
      setValue("delivery-start", data.deliveryStart);
      setValue("delivery-end", data.deliveryEnd);
      setValue("contract-date", data.contractDate);
      setValue("status", data.status);
      setValue("notes", data.notes);

    }


    function setValue(id, value) {

      if (
        value === undefined ||
        value === null ||
        value === ""
      ) {
        return;
      }

      const el = $(id);

      if (!el) return;

      el.value = value;

    }


    // ---------------------------------------------------------
    // COLLECT FORM DATA
    // ---------------------------------------------------------

    function getFormData() {

      return {

        contractNumber:
          $("contract-number")?.value.trim() || "",

        buyer:
          $("buyer")?.value.trim() || "",

        crop:
          $("crop")?.value || "",

        cropYear:
          Number($("crop-year")?.value) || null,

        quantityBu:
          Number($("quantity")?.value) || 0,

        price:
          $("price")?.value
            ? Number($("price").value)
            : null,

        contractType:
          $("contract-type")?.value || "",

        deliveryLocation:
          $("delivery-location")?.value.trim() || "",

        deliveryStart:
          $("delivery-start")?.value || null,

        deliveryEnd:
          $("delivery-end")?.value || null,

        contractDate:
          $("contract-date")?.value || null,

        status:
          $("status")?.value || "Open",

        notes:
          $("notes")?.value.trim() || ""

      };

    }


    // ---------------------------------------------------------
    // IMPORT STATUS
    // ---------------------------------------------------------

    function showImportStatus(message, isError) {

      if (!importStatus) return;

      importStatus.hidden = false;
      importStatus.textContent = message;

      importStatus.style.color =
        isError ? "#b3261e" : "";

    }

  });

})();
