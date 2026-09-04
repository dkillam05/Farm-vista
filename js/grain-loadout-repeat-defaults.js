/* =====================================================================
   FarmVista — Grain Load Out Repeat-Run Defaults

   When a dispatcher selects a driver on a NEW load, copy the operational
   setup from that driver's most recent load:
     • Hauling Job
     • Sold Under / Customer
     • Grain Source

   Crop and Destination are filled by the hauling job, exactly like the
   normal FarmVista load-out workflow.

   Important safety rules:
     • Works across calendar days; the latest load is the source.
     • Never copies Load #, load time, preload date, or ETA.
     • Never changes Edit Load forms.
     • Only restores choices that are still valid/selectable now.
       If an old bin/bag/field or hauling job is no longer available,
       FarmVista leaves that item for the dispatcher to choose.
     • Every copied value remains editable before Assign Load is pressed.
===================================================================== */

import {
  ready,
  getFirestore,
  collection,
  getDocs
} from "/js/firebase-init.js";

await ready;

const db =
  getFirestore();


const $ =
  id =>
    document.getElementById(
      id
    );


const elements = {
  backdrop:
    $("loadout-modal-backdrop"),

  modalTitle:
    $("loadout-modal-title"),

  driver:
    $("loadout-driver"),

  subdriver:
    $("loadout-subdriver"),

  haulingJob:
    $("loadout-hauling-job"),

  customerButton:
    $("loadout-customer-button"),

  customerMenu:
    $("loadout-customer-menu"),

  sourceButton:
    $("loadout-source-button"),

  sourceMenu:
    $("loadout-source-menu"),

  message:
    $("loadout-form-message")
};


let applyToken =
  0;


function clean(
  value
) {

  return String(
    value ??
    ""
  ).trim();

}


function norm(
  value
) {

  return clean(
    value
  ).toLowerCase();

}


function millis(
  value
) {

  if (
    value?.toMillis
  ) {

    return value.toMillis();

  }


  if (
    value?.toDate
  ) {

    return value
      .toDate()
      .getTime();

  }


  if (
    value instanceof Date
  ) {

    return value.getTime();

  }


  const parsed =
    new Date(
      value ||
      0
    );


  return Number.isNaN(
    parsed.getTime()
  )
    ? 0
    : parsed.getTime();

}


function modalIsOpenForCreate() {

  return (
    elements.backdrop
      ?.classList.contains(
        "open"
      ) &&
    norm(
      elements.modalTitle
        ?.textContent
    ) ===
      "assign load"
  );

}


function currentDriverKey() {

  const driverValue =
    clean(
      elements.driver
        ?.value
    );


  if (
    driverValue.startsWith(
      "emp:"
    )
  ) {

    return driverValue;

  }


  if (
    driverValue.startsWith(
      "sub:"
    )
  ) {

    const subdriverId =
      clean(
        elements.subdriver
          ?.value
      );


    if (
      !subdriverId
    ) {

      return "";

    }


    return `${driverValue}:${subdriverId}`;

  }


  return "";

}


function loadMatchesDriverKey(
  load,
  key
) {

  if (
    !load ||
    !key
  ) {

    return false;

  }


  if (
    key.startsWith(
      "emp:"
    )
  ) {

    const employeeId =
      key.slice(
        4
      );


    return clean(
      load.driverEmployeeId
    ) ===
      clean(
        employeeId
      );

  }


  if (
    key.startsWith(
      "sub:"
    )
  ) {

    const parts =
      key.split(
        ":"
      );


    const subcontractorId =
      clean(
        parts[1]
      );


    const subdriverId =
      clean(
        parts.slice(
          2
        ).join(
          ":"
        )
      );


    return (
      clean(
        load.driverSubcontractorId
      ) ===
        subcontractorId &&
      clean(
        load.driverSubcontractorDriverId
      ) ===
        subdriverId
    );

  }


  return false;

}


function latestLoadForDriver(
  loads,
  driverKey
) {

  return loads
    .filter(
      load =>
        loadMatchesDriverKey(
          load,
          driverKey
        )
    )
    .sort(
      (
        a,
        b
      ) =>
        millis(
          b.loadedAt ||
          b.createdAt ||
          b.updatedAt
        ) -
        millis(
          a.loadedAt ||
          a.createdAt ||
          a.updatedAt
        )
    )[0] ||
    null;

}


function waitFrame() {

  return new Promise(
    resolve =>
      requestAnimationFrame(
        () =>
          requestAnimationFrame(
            resolve
          )
      )
  );

}


function showGoodMessage(
  text
) {

  if (
    !elements.message
  ) {

    return;

  }


  elements.message.textContent =
    text;


  elements.message.className =
    "loadout-form-message show good";

}


function clickChoiceByData(
  container,
  attribute,
  value
) {

  const wanted =
    clean(
      value
    );


  if (
    !container ||
    !wanted
  ) {

    return false;

  }


  const buttons =
    Array.from(
      container.querySelectorAll(
        `[${attribute}]`
      )
    );


  const match =
    buttons.find(
      button =>
        clean(
          button.getAttribute(
            attribute
          )
        ) ===
          wanted
    );


  if (
    !match
  ) {

    return false;

  }


  match.click();


  return true;

}


async function restoreCustomer(
  previousLoad
) {

  if (
    !elements.customerButton ||
    elements.customerButton.disabled
  ) {

    return false;

  }


  elements.customerButton.click();

  await waitFrame();


  const customerValue =
    clean(
      previousLoad.customerId
    ) ||
    (
      norm(
        previousLoad.customerName
      ) ===
        "unknown"
        ? "__unknown__"
        : ""
    );


  let restored =
    clickChoiceByData(
      elements.customerMenu,
      "data-customer-value",
      customerValue
    );


  /*
    Legacy fallback: older loads may have only customerName.
    Use an exact visible-text match; never fuzzy-match Sold Under.
  */
  if (
    !restored &&
    clean(
      previousLoad.customerName
    )
  ) {

    const wantedName =
      norm(
        previousLoad.customerName
      );


    const buttons =
      Array.from(
        elements.customerMenu
          ?.querySelectorAll(
            "button[data-customer-value]"
          ) ||
        []
      );


    const match =
      buttons.find(
        button =>
          norm(
            button.textContent
          ) ===
            wantedName
      );


    if (
      match
    ) {

      match.click();

      restored =
        true;

    }

  }


  /*
    If nothing matched, clicking the picker left it open.
    Close it by clicking the toggle again.
  */
  if (
    !restored &&
    elements.customerMenu
      ?.classList.contains(
        "open"
      )
  ) {

    elements.customerButton.click();

  }


  return restored;

}


async function restoreFieldSource(
  previousLoad
) {

  if (
    !elements.sourceButton ||
    elements.sourceButton.disabled
  ) {

    return false;

  }


  elements.sourceButton.click();

  await waitFrame();


  const fieldsButton =
    Array.from(
      elements.sourceMenu
        ?.querySelectorAll(
          "button"
        ) ||
      []
    )
      .find(
        button =>
          norm(
            button.textContent
          ) ===
            "fields"
      );


  if (
    !fieldsButton
  ) {

    if (
      elements.sourceMenu
        ?.classList.contains(
          "open"
        )
    ) {

      elements.sourceButton.click();

    }


    return false;

  }


  fieldsButton.click();

  await waitFrame();


  const fieldModal =
    document.getElementById(
      "loadout-field-source-backdrop"
    );


  if (
    !fieldModal
  ) {

    return false;

  }


  const wantedFieldId =
    clean(
      previousLoad.grainSourceFieldId
    );


  const wantedFieldName =
    norm(
      previousLoad.grainSourceFieldName ||
      previousLoad.grainSourceName
    );


  const buttons =
    Array.from(
      fieldModal.querySelectorAll(
        "button"
      )
    );


  const fieldButton =
    buttons.find(
      button => {

        const text =
          clean(
            button.textContent
          );


        if (
          wantedFieldName &&
          norm(
            text
          ) ===
            wantedFieldName
        ) {

          return true;

        }


        /*
          Some field labels include the numeric/ID identifier.
        */
        return !!(
          wantedFieldId &&
          norm(
            text
          ).includes(
            norm(
              wantedFieldId
            )
          )
        );

      }
    );


  if (
    !fieldButton
  ) {

    const closeButton =
      buttons.find(
        button =>
          /close|cancel|back/i.test(
            clean(
              button.textContent
            )
          )
      );


    closeButton?.click();


    return false;

  }


  fieldButton.click();


  return true;

}


async function restoreSource(
  previousLoad
) {

  if (
    !elements.sourceButton ||
    elements.sourceButton.disabled
  ) {

    return false;

  }


  const sourceScope =
    norm(
      previousLoad.grainSourceScope
    );


  const sourceValue =
    clean(
      previousLoad.grainSourceValue
    );


  const isField =
    sourceScope ===
      "field" ||
    sourceValue.includes(
      "active_field_harvest:field:"
    );


  if (
    isField
  ) {

    return restoreFieldSource(
      previousLoad
    );

  }


  if (
    !sourceValue
  ) {

    return false;

  }


  elements.sourceButton.click();

  await waitFrame();


  const restored =
    clickChoiceByData(
      elements.sourceMenu,
      "data-source-value",
      sourceValue
    );


  if (
    !restored &&
    elements.sourceMenu
      ?.classList.contains(
        "open"
      )
  ) {

    elements.sourceButton.click();

  }


  return restored;

}


async function applyPreviousLoadDefaults() {

  const token =
    ++applyToken;


  if (
    !modalIsOpenForCreate()
  ) {

    return;

  }


  const driverKey =
    currentDriverKey();


  if (
    !driverKey
  ) {

    return;

  }


  let snapshot;


  try {

    snapshot =
      await getDocs(
        collection(
          db,
          "grain_loadouts"
        )
      );

  }
  catch (
    error
  ) {

    console.warn(
      "[grain loadout repeat defaults] load history could not be read:",
      error
    );


    return;

  }


  if (
    token !==
      applyToken ||
    driverKey !==
      currentDriverKey() ||
    !modalIsOpenForCreate()
  ) {

    return;

  }


  const previousLoad =
    latestLoadForDriver(
      snapshot.docs.map(
        docSnapshot => ({
          id:
            docSnapshot.id,

          ...docSnapshot.data()
        })
      ),
      driverKey
    );


  if (
    !previousLoad
  ) {

    return;

  }


  const previousHaulingJobId =
    clean(
      previousLoad.haulingJobId
    );


  if (
    !previousHaulingJobId ||
    !elements.haulingJob
  ) {

    return;

  }


  const jobOption =
    Array.from(
      elements.haulingJob.options ||
      []
    )
      .find(
        option =>
          clean(
            option.value
          ) ===
            previousHaulingJobId
      );


  /*
    Do not revive a closed/completed/full hauling job merely because
    this driver used it previously.
  */
  if (
    !jobOption
  ) {

    showGoodMessage(
      "Previous run found, but that hauling job is no longer available. Choose the current hauling job."
    );


    return;

  }


  elements.haulingJob.value =
    previousHaulingJobId;


  elements.haulingJob.dispatchEvent(
    new Event(
      "change",
      {
        bubbles:
          true
      }
    )
  );


  await waitFrame();


  if (
    token !==
      applyToken ||
    driverKey !==
      currentDriverKey() ||
    !modalIsOpenForCreate()
  ) {

    return;

  }


  const customerRestored =
    await restoreCustomer(
      previousLoad
    );


  await waitFrame();


  if (
    token !==
      applyToken ||
    driverKey !==
      currentDriverKey() ||
    !modalIsOpenForCreate()
  ) {

    return;

  }


  const sourceRestored =
    await restoreSource(
      previousLoad
    );


  if (
    customerRestored &&
    sourceRestored
  ) {

    showGoodMessage(
      "Previous load for this driver copied. Change anything that is different, then assign the new load."
    );

  }
  else if (
    customerRestored
  ) {

    showGoodMessage(
      "Previous route copied. The prior grain source is not currently available, so choose the current source."
    );

  }
  else {

    showGoodMessage(
      "Previous hauling job copied. Review Sold Under and Grain Source before assigning the new load."
    );

  }

}


function scheduleApply() {

  /*
    Let grain-ticket.html finish its own driver/subdriver rendering first.
  */
  setTimeout(
    applyPreviousLoadDefaults,
    75
  );

}


if (
  elements.driver &&
  !elements.driver.dataset
    .fvRepeatDefaultsWired
) {

  elements.driver.dataset
    .fvRepeatDefaultsWired =
      "1";


  elements.driver.addEventListener(
    "change",
    scheduleApply
  );

}


if (
  elements.subdriver &&
  !elements.subdriver.dataset
    .fvRepeatDefaultsWired
) {

  elements.subdriver.dataset
    .fvRepeatDefaultsWired =
      "1";


  elements.subdriver.addEventListener(
    "change",
    scheduleApply
  );

}
