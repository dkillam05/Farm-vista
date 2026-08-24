/**
 * FarmVista — Grain Transfers
 * /js/grain-transfers.js
 *
 * PURPOSE
 * ============================================================
 * Records estimated grain movements after harvest from:
 *
 *   • Offsite bin sites
 *   • Grain bags
 *
 * back to:
 *
 *   • Active CENTRAL bin sites
 *
 *
 * IMPORTANT
 * ============================================================
 * Grain Transfers are INTERNAL inventory movements.
 *
 * They DO NOT:
 *   • create grain tickets
 *   • create load outs
 *   • affect grain contracts
 *   • record scale weights
 *   • record grain grades
 *
 *
 * USER WORKFLOW
 * ============================================================
 *   Crop
 *     ↓
 *   Driver
 *     ↓
 *   From
 *     ↓
 *   To Central Site
 *     ↓
 *   Record Grain Transfer
 *
 *
 * BIN SITE BEHAVIOR
 * ============================================================
 * Users select the SITE — never an individual bin.
 *
 * FarmVista automatically removes grain from matching bins
 * in bin order.
 *
 * Example:
 *
 *   Bin 1 Corn =   300 bu
 *   Bin 2 Corn = 5,000 bu
 *
 *   Transfer = 950 estimated bu
 *
 * Result:
 *
 *   Bin 1 =     0
 *   Bin 2 = 4,350
 *
 *
 * TABLE
 * ============================================================
 * Only TODAY'S transfers are displayed.
 *
 * Columns:
 *   Date / Time
 *   Driver
 *   Crop
 *   From
 *   To
 *
 * Estimated bushels and inventory numbers are intentionally
 * NOT displayed in the dashboard table.
 */


import {
  ready,
  getAuth,
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  serverTimestamp
} from "/js/firebase-init.js";


// ============================================================
// COLLECTIONS
// ============================================================

const TRANSFER_COLLECTION =
  "grain_transfers";

const SETTINGS_COLLECTION =
  "grain_transfer_settings";

const SETTINGS_DOCUMENT =
  "main";

const BIN_MOVEMENT_COLLECTION =
  "binMovements";

const BAG_COLLECTION =
  "grain_bag_events";

const BAG_PRODUCT_COLLECTION =
  "productsGrainBags";

const BIN_SITE_COLLECTION =
  "binSites";

const EMPLOYEE_COLLECTION =
  "employees";

const SUBCONTRACTOR_COLLECTION =
  "subcontractors";



// ============================================================
// FIREBASE
// ============================================================

let db = null;
let auth = null;


// ============================================================
// STATE
// ============================================================

const state = {

  drivers: [],

  binSites: [],

  bags: [],

  bagProducts:
    new Map(),

  transfers: [],

  settings: {},

  selectedCrop:
    "",

  selectedDriver:
    "",

  selectedSource:
    "",

  selectedDestination:
    "",

  saving:
    false
};


// ============================================================
// DOM
// ============================================================

const els = {};


// ============================================================
// BASIC HELPERS
// ============================================================

function clean(
  value
) {

  return typeof value ===
    "string"
      ? value.trim()
      : "";
}


function norm(
  value
) {

  return clean(
    value
  )
    .toLowerCase()
    .replace(
      /\s+/g,
      " "
    );
}


function numberValue(
  value,
  fallback = 0
) {

  const valueNumber =
    Number(
      value
    );

  return Number.isFinite(
    valueNumber
  )
    ? valueNumber
    : fallback;
}


function roundBushels(
  value
) {

  return Math.round(
    numberValue(
      value
    ) *
    100
  ) / 100;
}


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


function todayISO() {

  const now =
    new Date();

  const year =
    now.getFullYear();

  const month =
    String(
      now.getMonth() + 1
    ).padStart(
      2,
      "0"
    );

  const day =
    String(
      now.getDate()
    ).padStart(
      2,
      "0"
    );

  return (
    `${year}-${month}-${day}`
  );
}


function timestampDate(
  value
) {

  if (
    !value
  ) {

    return null;
  }


  if (
    typeof value.toDate ===
      "function"
  ) {

    return value.toDate();
  }


  if (
    value instanceof Date
  ) {

    return value;
  }


  const parsed =
    new Date(
      value
    );

  return Number.isNaN(
    parsed.getTime()
  )
    ? null
    : parsed;
}


function localDateISO(
  value
) {

  const date =
    timestampDate(
      value
    );

  if (
    !date
  ) {

    return "";
  }


  const year =
    date.getFullYear();

  const month =
    String(
      date.getMonth() + 1
    ).padStart(
      2,
      "0"
    );

  const day =
    String(
      date.getDate()
    ).padStart(
      2,
      "0"
    );

  return (
    `${year}-${month}-${day}`
  );
}


function displayDateTime(
  value
) {

  const date =
    timestampDate(
      value
    );

  if (
    !date
  ) {

    return "—";
  }


  return date.toLocaleString(
    "en-US",
    {
      month:
        "short",

      day:
        "numeric",

      hour:
        "numeric",

      minute:
        "2-digit"
    }
  );
}


function currentUser() {

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


// ============================================================
// DRIVER HELPERS
// ============================================================

function employeeName(
  data
) {

  return clean(
    data?.fullName ||
    data?.name ||
    [
      clean(
        data?.firstName
      ),
      clean(
        data?.lastName
      )
    ]
      .filter(
        Boolean
      )
      .join(
        " "
      )
  );
}


function isSemiDriver(
  data
) {

  const roles =
    Array.isArray(
      data?.roles
    )
      ? data.roles
      : [];


  return roles.some(
    role =>
      norm(
        role
      ) ===
      "semi driver"
  );
}


function isActiveEmployee(
  data
) {

  return (
    data?.active !==
      false &&
    norm(
      data?.status ||
      "Active"
    ) ===
      "active"
  );
}


// ============================================================
// BIN HELPERS
// ============================================================

function binCrop(
  bin
) {

  return clean(
    bin?.lastCropType ||
    bin?.crop ||
    bin?.cropType
  );
}


function sameCrop(
  cropA,
  cropB
) {

  return (
    norm(
      cropA
    ) ===
    norm(
      cropB
    )
  );
}


function siteIsActive(
  site
) {

  return (
    site?.active !==
      false &&
    norm(
      site?.status ||
      "active"
    ) ===
      "active"
  );
}


function siteIsCentral(
  site
) {

  return (
    norm(
      site?.siteType
    ) ===
    "central"
  );
}


function siteCropBushels(
  site,
  crop
) {

  const bins =
    Array.isArray(
      site?.bins
    )
      ? site.bins
      : [];


  return roundBushels(
    bins.reduce(
      (
        total,
        bin
      ) => {

        if (
          !sameCrop(
            binCrop(
              bin
            ),
            crop
          )
        ) {

          return total;
        }


        return (
          total +
          Math.max(
            0,
            numberValue(
              bin?.onHand
            )
          )
        );
      },
      0
    )
  );
}


function siteHasCrop(
  site,
  crop
) {

  return (
    siteCropBushels(
      site,
      crop
    ) >
    0
  );
}


function binCapacity(
  bin
) {

  const candidates = [

    bin?.bushels,

    bin?.capacityBushels,

    bin?.capacity,

    bin?.totalBushels

  ];


  for (
    const candidate of
      candidates
  ) {

    const value =
      numberValue(
        candidate
      );

    if (
      value >
      0
    ) {

      return value;
    }
  }


  return null;
}


// ============================================================
// SOURCE BIN ALLOCATION
// ============================================================

function buildBinRemovalPlan(
  site,
  crop,
  requestedBushels
) {

  const bins =
    Array.isArray(
      site?.bins
    )
      ? site.bins.map(
          bin => ({
            ...bin
          })
        )
      : [];


  let remaining =
    roundBushels(
      requestedBushels
    );


  const allocations =
    [];


  /*
    IMPORTANT:

    We intentionally walk the bins in their existing array order.

    This gives us:

      first matching bin
             ↓
      empty it if necessary
             ↓
      continue to next matching bin
  */

  for (
    let index = 0;
    index < bins.length;
    index += 1
  ) {

    if (
      remaining <=
      0
    ) {

      break;
    }


    const bin =
      bins[
        index
      ];


    if (
      !sameCrop(
        binCrop(
          bin
        ),
        crop
      )
    ) {

      continue;
    }


    const onHand =
      Math.max(
        0,
        roundBushels(
          bin?.onHand
        )
      );


    if (
      onHand <=
      0
    ) {

      continue;
    }


    const amount =
      roundBushels(
        Math.min(
          onHand,
          remaining
        )
      );


    if (
      amount <=
      0
    ) {

      continue;
    }


    const after =
      Math.max(
        0,
        roundBushels(
          onHand -
          amount
        )
      );


    bins[
      index
    ] = {

      ...bin,

      onHand:
        after

    };


    allocations.push({

      binIndex:
        index,

      binNum:
        bin?.num ??
        (
          index +
          1
        ),

      bushels:
        amount,

      before:
        onHand,

      after

    });


    remaining =
      Math.max(
        0,
        roundBushels(
          remaining -
          amount
        )
      );
  }


  return {

    bins,

    allocations,

    removedBushels:
      roundBushels(
        requestedBushels -
        remaining
      ),

    shortfallBushels:
      remaining

  };
}


// ============================================================
// DESTINATION BIN ALLOCATION
// ============================================================

function buildBinAdditionPlan(
  site,
  crop,
  requestedBushels
) {

  const bins =
    Array.isArray(
      site?.bins
    )
      ? site.bins.map(
          bin => ({
            ...bin
          })
        )
      : [];


  let remaining =
    roundBushels(
      requestedBushels
    );


  const allocations =
    [];


  /*
    Only bins already assigned to this crop are eligible.

    The user never chooses the individual bin.

    FarmVista fills matching bins in their existing array order.
  */

  for (
    let index = 0;
    index < bins.length;
    index += 1
  ) {

    if (
      remaining <=
      0
    ) {

      break;
    }


    const bin =
      bins[
        index
      ];


    if (
      !sameCrop(
        binCrop(
          bin
        ),
        crop
      )
    ) {

      continue;
    }


    const before =
      Math.max(
        0,
        roundBushels(
          bin?.onHand
        )
      );


    const capacity =
      binCapacity(
        bin
      );


    const availableRoom =
      capacity ===
        null
        ? remaining
        : Math.max(
            0,
            roundBushels(
              capacity -
              before
            )
          );


    if (
      availableRoom <=
      0
    ) {

      continue;
    }


    const amount =
      roundBushels(
        Math.min(
          remaining,
          availableRoom
        )
      );


    if (
      amount <=
      0
    ) {

      continue;
    }


    const after =
      roundBushels(
        before +
        amount
      );


    bins[
      index
    ] = {

      ...bin,

      onHand:
        after,

      lastCropType:
        clean(
          bin?.lastCropType
        ) ||
        crop

    };


    allocations.push({

      binIndex:
        index,

      binNum:
        bin?.num ??
        (
          index +
          1
        ),

      bushels:
        amount,

      before,

      after

    });


    remaining =
      Math.max(
        0,
        roundBushels(
          remaining -
          amount
        )
      );
  }


  return {

    bins,

    allocations,

    addedBushels:
      roundBushels(
        requestedBushels -
        remaining
      ),

    shortfallBushels:
      remaining

  };
}


// ============================================================
// GRAIN BAG CAPACITY
// ============================================================

function cropFactor(
  crop
) {

  try {

    const api =
      window.FVGrainCapacity;


    if (
      api &&
      typeof api.getFactor ===
        "function"
    ) {

      const factor =
        Number(
          api.getFactor(
            crop
          )
        );


      if (
        Number.isFinite(
          factor
        ) &&
        factor >
        0
      ) {

        return factor;
      }
    }

  }
  catch (_) {}


  return 1;
}


function fallbackBuPerFoot(
  diameter
) {

  const d =
    Number(
      diameter
    ) ||
    0;


  if (d >= 12) return 60;
  if (d >= 11) return 50;
  if (d >= 10) return 43;
  if (d >= 9) return 30;
  if (d > 0) return 25;


  return 0;
}


function bagCapacity(
  bag
) {

  const product =
    state.bagProducts.get(
      clean(
        bag?.bagSku?.id
      )
    ) ||
    null;


  const lengthFt =
    numberValue(
      product?.lengthFt ||
      bag?.bagSku?.sizeFeet ||
      bag?.bagSku?.lengthFt
    );


  const diameterFt =
    numberValue(
      bag?.bagSku?.diameterFt
    );


  const cornBushels =
    numberValue(
      product?.bushels
    );


  const cornBuPerFoot =
    (
      cornBushels >
        0 &&
      lengthFt >
        0
    )
      ? (
          cornBushels /
          lengthFt
        )
      : fallbackBuPerFoot(
          diameterFt
        );


  const crop =
    clean(
      bag?.cropType ||
      bag?.crop
    );


  return {

    lengthFt,

    bushelsPerFoot:
      cornBuPerFoot *
      cropFactor(
        crop
      )

  };
}


function bagPartialFeet(
  bag
) {

  const counts =
    bag?.counts ||
    {};


  if (
    Array.isArray(
      bag?.partialFeet
    )
  ) {

    return bag.partialFeet
      .map(
        value =>
          Math.max(
            0,
            numberValue(
              value
            )
          )
      )
      .filter(
        value =>
          value >
          0
      );
  }


  if (
    Array.isArray(
      counts.partialFeet
    )
  ) {

    return counts.partialFeet
      .map(
        value =>
          Math.max(
            0,
            numberValue(
              value
            )
          )
      )
      .filter(
        value =>
          value >
          0
      );
  }


  return [];
}


function bagCurrentFeet(
  bag
) {

  const capacity =
    bagCapacity(
      bag
    );


  const counts =
    bag?.counts ||
    {};


  const full =
    Math.max(
      0,
      numberValue(
        counts.full
      )
    );


  const partial =
    Math.max(
      0,
      numberValue(
        counts.partial
      )
    );


  let partialFeet =
    bagPartialFeet(
      bag
    );


  let partialTotal =
    partialFeet.reduce(
      (
        total,
        feet
      ) =>
        total +
        feet,
      0
    );


  /*
    Legacy fallback.

    If an old bag record says it has a partial bag but does not
    contain exact partial feet, use half a bag.
  */

  if (
    partial >
      0 &&
    partialTotal <=
      0 &&
    capacity.lengthFt >
      0
  ) {

    partialTotal =
      partial *
      capacity.lengthFt *
      0.5;
  }


  return (
    (
      full *
      capacity.lengthFt
    ) +
    partialTotal
  );
}


function bagAvailableBushels(
  bag
) {

  const capacity =
    bagCapacity(
      bag
    );


  if (
    capacity.bushelsPerFoot <=
      0
  ) {

    return 0;
  }


  return roundBushels(
    bagCurrentFeet(
      bag
    ) *
    capacity.bushelsPerFoot
  );
}


// ============================================================
// BAG REMOVAL PLAN
// ============================================================

function buildBagRemovalPlan(
  bag,
  requestedBushels
) {

  const capacity =
    bagCapacity(
      bag
    );


  if (
    capacity.bushelsPerFoot <=
      0 ||
    capacity.lengthFt <=
      0
  ) {

    throw new Error(
      "FarmVista cannot determine the capacity of the selected grain bag."
    );
  }


  const currentFeet =
    bagCurrentFeet(
      bag
    );


  const availableBushels =
    roundBushels(
      currentFeet *
      capacity.bushelsPerFoot
    );


  const removeBushels =
    roundBushels(
      Math.min(
        requestedBushels,
        availableBushels
      )
    );


  const removeFeet =
    removeBushels /
    capacity.bushelsPerFoot;


  const remainingFeet =
    Math.max(
      0,
      currentFeet -
      removeFeet
    );


  const full =
    Math.floor(
      remainingFeet /
      capacity.lengthFt
    );


  const leftoverFeet =
    Math.max(
      0,
      remainingFeet -
      (
        full *
        capacity.lengthFt
      )
    );


  const partialFeet =
    leftoverFeet >
      0.01
      ? [
          roundBushels(
            leftoverFeet
          )
        ]
      : [];


  return {

    availableBushels,

    removedBushels:
      removeBushels,

    shortfallBushels:
      Math.max(
        0,
        roundBushels(
          requestedBushels -
          removeBushels
        )
      ),

    remainingFeet:
      roundBushels(
        remainingFeet
      ),

    countsAfter: {

      full,

      partial:
        partialFeet.length,

      partialFeet

    }

  };
}


// ============================================================
// SETTINGS
// ============================================================

function settingsMap(
  data
) {

  if (
    !data ||
    typeof data !==
      "object"
  ) {

    return {};
  }


  const source =
    data.estimatedBushelsByCrop &&
    typeof data.estimatedBushelsByCrop ===
      "object"
      ? data.estimatedBushelsByCrop
      : data;


  const result =
    {};


  Object.entries(
    source
  ).forEach(
    (
      [
        crop,
        value
      ]
    ) => {

      const bushels =
        roundBushels(
          value
        );


      if (
        clean(
          crop
        ) &&
        bushels >
          0
      ) {

        result[
          clean(
            crop
          )
        ] =
          bushels;
      }
    }
  );


  return result;
}


function estimatedBushelsForCrop(
  crop
) {

  const wanted =
    norm(
      crop
    );


  for (
    const [
      key,
      value
    ] of
      Object.entries(
        state.settings
      )
  ) {

    if (
      norm(
        key
      ) ===
      wanted
    ) {

      return roundBushels(
        value
      );
    }
  }


  return 0;
}


// ============================================================
// AVAILABLE CROPS
// ============================================================

function inventoryCrops() {

  const crops =
    new Map();


  state.binSites
    .filter(
      site =>
        siteIsActive(
          site
        )
    )
    .forEach(
      site => {

        const bins =
          Array.isArray(
            site.bins
          )
            ? site.bins
            : [];


        bins.forEach(
          bin => {

            const crop =
              binCrop(
                bin
              );


            const onHand =
              numberValue(
                bin?.onHand
              );


            if (
              crop &&
              onHand >
                0
            ) {

              crops.set(
                norm(
                  crop
                ),
                crop
              );
            }
          }
        );
      }
    );


  state.bags.forEach(
    bag => {

      const crop =
        clean(
          bag?.cropType ||
          bag?.crop
        );


      if (
        crop &&
        bagAvailableBushels(
          bag
        ) >
          0
      ) {

        crops.set(
          norm(
            crop
          ),
          crop
        );
      }
    }
  );


  return [
    ...crops.values()
  ]
    .sort(
      (
        a,
        b
      ) =>
        a.localeCompare(
          b,
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


// ============================================================
// SOURCE OPTIONS
// ============================================================

function sourceOptions(
  crop
) {

  const options =
    [];


  /*
    OFFSITE BIN SITES ONLY.

    Central sites are destinations, not transfer sources.
  */

  state.binSites
    .filter(
      site =>
        siteIsActive(
          site
        )
    )
    .filter(
      site =>
        !siteIsCentral(
          site
        )
    )
    .filter(
      site =>
        siteHasCrop(
          site,
          crop
        )
    )
    .forEach(
      site => {

        options.push({

          type:
            "bin_site",

          value:
            `site:${site.id}`,

          id:
            site.id,

          name:
            clean(
              site.name
            ) ||
            "Bin Site"

        });
      }
    );


  state.bags
    .filter(
      bag =>
        sameCrop(
          clean(
            bag?.cropType ||
            bag?.crop
          ),
          crop
        )
    )
    .filter(
      bag =>
        bagAvailableBushels(
          bag
        ) >
        0
    )
    .forEach(
      bag => {

        const fieldName =
          clean(
            bag?.field?.name
          ) ||
          "Grain Bag";


        const location =
          clean(
            bag?.bagSku?.location
          );


        options.push({

          type:
            "grain_bag",

          value:
            `bag:${bag.id}`,

          id:
            bag.id,

          name:
            location
              ? `${fieldName} — ${location}`
              : fieldName

        });
      }
    );


  return options.sort(
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
}


// ============================================================
// DESTINATION OPTIONS
// ============================================================

function destinationOptions(
  crop
) {

  return state.binSites
    .filter(
      site =>
        siteIsActive(
          site
        )
    )
    .filter(
      site =>
        siteIsCentral(
          site
        )
    )
    .filter(
      site => {

        const bins =
          Array.isArray(
            site.bins
          )
            ? site.bins
            : [];


        /*
          Destination site is eligible only if it already has
          at least one bin assigned to the selected crop.
        */

        return bins.some(
          bin =>
            sameCrop(
              binCrop(
                bin
              ),
              crop
            )
        );
      }
    )
    .map(
      site => ({

        id:
          site.id,

        name:
          clean(
            site.name
          ) ||
          "Central Grain Site"

      })
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
}


// ============================================================
// LOAD DATA
// ============================================================

async function loadData() {

  const [
    employeeSnapshot,
    subcontractorSnapshot,
    binSiteSnapshot,
    bagSnapshot,
    productSnapshot,
    transferSnapshot,
    settingsSnapshot
  ] =
    await Promise.all([

      getDocs(
        collection(
          db,
          EMPLOYEE_COLLECTION
        )
      ),

      getDocs(
        collection(
          db,
          SUBCONTRACTOR_COLLECTION
        )
      ),

      getDocs(
        collection(
          db,
          BIN_SITE_COLLECTION
        )
      ),

      getDocs(
        collection(
          db,
          BAG_COLLECTION
        )
      ),

      getDocs(
        collection(
          db,
          BAG_PRODUCT_COLLECTION
        )
      ),

      getDocs(
        collection(
          db,
          TRANSFER_COLLECTION
        )
      ),

      getDoc(
        doc(
          db,
          SETTINGS_COLLECTION,
          SETTINGS_DOCUMENT
        )
      )

    ]);


  // ----------------------------------------------------------
  // EMPLOYEE DRIVERS
  // ----------------------------------------------------------

  const employeeDrivers =
    employeeSnapshot.docs
      .map(
        snapshot => {

          const data =
            snapshot.data() ||
            {};


          return {

            type:
              "employee",

            value:
              `employee:${snapshot.id}`,

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
              employeeName(
                data
              ),

            company:
              "",

            phone:
              clean(
                data.phone ||
                data.mobile
              ),

            active:
              isActiveEmployee(
                data
              ),

            semiDriver:
              isSemiDriver(
                data
              )

          };
        }
      )
      .filter(
        driver =>
          driver.name &&
          driver.active &&
          driver.semiDriver
      );


  // ----------------------------------------------------------
  // SUBCONTRACTOR DRIVERS
  // ----------------------------------------------------------

  const subcontractorDrivers =
    [];


  subcontractorSnapshot.docs
    .forEach(
      snapshot => {

        const data =
          snapshot.data() ||
          {};


        const active =
          data.active !==
            false &&
          norm(
            data.status ||
            "Active"
          ) ===
            "active";


        const service =
          norm(
            data.service
          );


        if (
          !active ||
          service !==
            "trucking"
        ) {

          return;
        }


        const company =
          clean(
            data.company ||
            data.name
          );


        const drivers =
          Array.isArray(
            data.drivers
          )
            ? data.drivers
            : [];


        drivers.forEach(
          (
            driver,
            index
          ) => {

            if (
              driver?.active ===
                false
            ) {

              return;
            }


            const name =
              clean(
                driver?.name
              ) ||
              [
                clean(
                  driver?.firstName
                ),
                clean(
                  driver?.lastName
                )
              ]
                .filter(
                  Boolean
                )
                .join(
                  " "
                );


            if (
              !name
            ) {

              return;
            }


            const driverId =
              clean(
                driver?.id
              ) ||
              `legacy-${index}`;


            subcontractorDrivers.push({

              type:
                "subcontractor",

              value:
                `sub:${snapshot.id}:${driverId}`,

              id:
                driverId,

              subcontractorId:
                snapshot.id,

              uid:
                null,

              name,

              company,

              phone:
                clean(
                  driver?.phone ||
                  driver?.cell ||
                  driver?.cellPhone
                )

            });
          }
        );
      }
    );


  state.drivers = [

    ...employeeDrivers,

    ...subcontractorDrivers

  ].sort(
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


  // ----------------------------------------------------------
  // BIN SITES
  // ----------------------------------------------------------

  state.binSites =
    binSiteSnapshot.docs.map(
      snapshot => ({

        id:
          snapshot.id,

        ...snapshot.data()

      })
    );


  // ----------------------------------------------------------
  // BAG PRODUCTS
  // ----------------------------------------------------------

  state.bagProducts =
    new Map(
      productSnapshot.docs.map(
        snapshot => [

          snapshot.id,

          snapshot.data() ||
          {}

        ]
      )
    );


  // ----------------------------------------------------------
  // OPEN GRAIN BAGS
  // ----------------------------------------------------------

  state.bags =
    bagSnapshot.docs
      .map(
        snapshot => ({

          id:
            snapshot.id,

          ...snapshot.data()

        })
      )
      .filter(
        bag =>
          norm(
            bag.type
          ) ===
          "putdown"
      )
      .filter(
        bag =>
          norm(
            bag.status
          ) !==
          "pickedup"
      );


  // ----------------------------------------------------------
  // SETTINGS
  // ----------------------------------------------------------

  state.settings =
    settingsSnapshot.exists()
      ? settingsMap(
          settingsSnapshot.data()
        )
      : {};


  // ----------------------------------------------------------
  // TRANSFERS
  // ----------------------------------------------------------

  state.transfers =
    transferSnapshot.docs.map(
      snapshot => ({

        id:
          snapshot.id,

        ...snapshot.data()

      })
    );


  renderTable();
}


// ============================================================
// BUILD SECTION
// ============================================================

function injectStyles() {

  if (
    document.getElementById(
      "grain-transfer-styles"
    )
  ) {

    return;
  }


  const style =
    document.createElement(
      "style"
    );


  style.id =
    "grain-transfer-styles";


  style.textContent = `

/* ============================================================
   FARMVISTA GRAIN TRANSFERS
============================================================ */

.grain-transfer-card{
  display:block !important;
  width:100%;
  max-width:none !important;
  margin:0 !important;
  padding:0 !important;
  overflow:hidden;
}

.grain-transfer-head{
  width:100%;
  display:grid;
  grid-template-columns:26px minmax(0,1fr) auto;
  gap:10px;
  align-items:center;
  padding:13px 15px;
  border-bottom:1px solid var(--border);
  background:linear-gradient(
    90deg,
    rgba(47,108,60,.12),
    transparent
  );
}

.grain-transfer-settings-btn{
  appearance:none;
  width:26px;
  height:26px;
  display:grid;
  place-items:center;
  padding:0;
  border:0;
  border-radius:999px;
  background:transparent;
  color:var(--text);
  cursor:pointer;
}

.grain-transfer-settings-btn svg{
  width:17px;
  height:17px;
  display:block;
  stroke:currentColor;
}

.grain-transfer-settings-btn:hover,
.grain-transfer-settings-btn:focus{
  background:var(--surface-2,rgba(59,126,70,.09));
  outline:none;
}

.grain-transfer-settings-btn:focus-visible{
  box-shadow:0 0 0 3px rgba(59,126,70,.16);
}

.grain-transfer-title-wrap{
  min-width:0;
}

.grain-transfer-title{
  display:block;
  font-size:15px;
  font-weight:950;
}

.grain-transfer-subtitle{
  margin-top:2px;
  color:var(--muted,#67706b);
  font-size:12px;
  font-weight:700;
  line-height:1.35;
}

.grain-transfer-add-btn{
  appearance:none;
  border:0;
  border-radius:10px;
  padding:9px 14px;
  background:#3B7E46;
  color:#fff !important;
  -webkit-text-fill-color:#fff !important;
  font-weight:900;
  cursor:pointer;
  white-space:nowrap;
}

.grain-transfer-add-btn:hover{
  filter:brightness(.96);
}

.grain-transfer-table-wrap{
  width:calc(100% - 28px);
  margin:12px 14px 14px;
  overflow-x:auto;
  border:1px solid var(--border);
  border-radius:12px;
}

.grain-transfer-table{
  width:100%;
  min-width:720px;
  border-collapse:collapse;
}

.grain-transfer-table th{
  padding:9px 8px;
  background:var(--surface-2,var(--surface));
  border-bottom:1px solid var(--border);
  color:var(--muted,#87908a);
  font-size:11px;
  font-weight:900;
  text-align:left;
  white-space:nowrap;
}

.grain-transfer-table td{
  padding:10px 8px;
  border-bottom:1px solid var(--border);
  color:var(--text);
  font-size:12px;
  white-space:nowrap;
}

.grain-transfer-table tbody tr:last-child td{
  border-bottom:0;
}

.grain-transfer-empty{
  padding:24px 12px !important;
  text-align:center;
  color:var(--muted,#87908a) !important;
}


/* ============================================================
   MODAL
============================================================ */

.grain-transfer-backdrop{
  position:fixed;
  inset:0;
  z-index:12000;
  display:none;
  align-items:center;
  justify-content:center;
  padding:18px;
  background:rgba(0,0,0,.52);
}

.grain-transfer-backdrop.open{
  display:flex;
}

.grain-transfer-modal{
  width:min(560px,100%);
  max-height:calc(100vh - 36px);
  overflow:auto;
  scrollbar-width:none;
  -ms-overflow-style:none;
  background:var(--surface);
  color:var(--text);
  border:1px solid var(--border);
  border-radius:16px;
  box-shadow:0 22px 70px rgba(0,0,0,.28);
}

.grain-transfer-modal::-webkit-scrollbar{
  display:none;
}

.grain-transfer-modal-head{
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:12px;
  padding:18px;
  border-bottom:1px solid var(--border);
}

.grain-transfer-modal-title{
  margin:0;
  font-size:20px;
  font-weight:950;
}

.grain-transfer-modal-sub{
  margin-top:4px;
  color:var(--muted,#87908a);
  font-size:12px;
  line-height:1.4;
}

.grain-transfer-close{
  appearance:none;
  width:34px;
  height:34px;
  flex:0 0 auto;
  border:1px solid var(--border);
  border-radius:9px;
  background:var(--surface);
  color:var(--text);
  font-size:20px;
  line-height:1;
  cursor:pointer;
}

.grain-transfer-form{
  padding:16px 18px 18px;
}

.grain-transfer-field{
  margin-bottom:15px;
}

.grain-transfer-label{
  display:block;
  margin-bottom:6px;
  color:var(--muted,#87908a);
  font-size:12px;
  font-weight:850;
}

.grain-transfer-help{
  margin-top:5px;
  color:var(--muted,#87908a);
  font-size:11px;
  line-height:1.4;
}


/* ============================================================
   CROP BUTTONS
============================================================ */

.grain-transfer-crops{
  display:grid;
  grid-template-columns:repeat(3,minmax(0,1fr));
  gap:8px;
}

.grain-transfer-crop-btn{
  appearance:none;
  min-height:46px;
  border:1px solid var(--border);
  border-radius:11px;
  background:var(--surface);
  color:var(--text);
  font:inherit;
  font-weight:850;
  cursor:pointer;
}

.grain-transfer-crop-btn:hover{
  background:var(--surface-2,rgba(59,126,70,.07));
}

.grain-transfer-crop-btn.selected{
  border-color:#3B7E46;
  background:rgba(59,126,70,.12);
  color:#2F6C3C;
}


/* ============================================================
   SELECTS
============================================================ */

.grain-transfer-select{
  width:100%;
  box-sizing:border-box;
  border:1px solid var(--border);
  border-radius:10px;
  background:var(--surface);
  color:var(--text);
  padding:10px 11px;
  font:inherit;
}

.grain-transfer-select:disabled{
  opacity:.58;
  cursor:not-allowed;
  background:var(--surface-2,rgba(255,255,255,.04));
}


/* ============================================================
   MESSAGE
============================================================ */

.grain-transfer-message{
  display:none;
  margin-top:12px;
  padding:10px 11px;
  border-radius:9px;
  font-size:12px;
  font-weight:750;
  line-height:1.4;
}

.grain-transfer-message.show{
  display:block;
}

.grain-transfer-message.error{
  background:#FDE8EA;
  color:#9F2530;
}

.grain-transfer-message.good{
  background:#E7F5E9;
  color:#2F6C3C;
}


/* ============================================================
   ACTIONS
============================================================ */

.grain-transfer-actions{
  display:flex;
  justify-content:flex-end;
  gap:9px;
  margin-top:17px;
}

.grain-transfer-btn{
  appearance:none;
  border:1px solid var(--border);
  border-radius:10px;
  background:var(--surface);
  color:var(--text);
  padding:9px 14px;
  font-weight:850;
  cursor:pointer;
}

.grain-transfer-btn.primary{
  border-color:#3B7E46;
  background:#3B7E46;
  color:#fff;
}

.grain-transfer-btn:disabled{
  opacity:.55;
  cursor:not-allowed;
}


/* ============================================================
   MOBILE
============================================================ */

@media (max-width:700px){

  .grain-transfer-head{
    grid-template-columns:auto minmax(0,1fr);
  }

  .grain-transfer-add-btn{
    grid-column:1 / -1;
    width:100%;
  }

  .grain-transfer-table-wrap{
    width:calc(100% - 20px);
    margin-left:10px;
    margin-right:10px;
  }

  .grain-transfer-backdrop{
    align-items:flex-end;
    padding:0;
  }

  .grain-transfer-modal{
    width:100%;
    max-height:92vh;
    border-radius:16px 16px 0 0;
  }

  .grain-transfer-crops{
    grid-template-columns:repeat(2,minmax(0,1fr));
  }

}

  `;


  document.head.appendChild(
    style
  );
}


function injectSection() {

  if (
    document.getElementById(
      "grain-transfers-summary"
    )
  ) {

    return;
  }


  const ticketSection =
    document.getElementById(
      "grain-tickets-summary"
    );


  if (
    !ticketSection
  ) {

    console.warn(
      "[grain transfers] Grain Tickets section was not found."
    );

    return;
  }


  const section =
    document.createElement(
      "section"
    );


  section.id =
    "grain-transfers-summary";

  section.className =
    "sum-card grain-transfer-card";


  section.innerHTML = `

    <header class="grain-transfer-head">

<button
  id="grain-transfer-settings-btn"
  type="button"
  class="grain-transfer-settings-btn"
  aria-label="Grain Transfer Settings"
  title="Grain Transfer Settings"
>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
      stroke-width="1.8"
    />
    <path
      d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 8.92 4a1.65 1.65 0 0 0 1-1.51V2a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 15 3.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.12.61.65 1.05 1.27 1.05H21a2 2 0 1 1 0 4h-.09c-.62 0-1.15.44-1.27 1.05Z"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
</button>

      <div class="grain-transfer-title-wrap">

        <strong class="grain-transfer-title">
          Grain Transfers
        </strong>

        <div class="grain-transfer-subtitle">
          Record grain moved after harvest from offsite storage back to a central grain site.
        </div>

      </div>

      <button
        id="grain-transfer-add-btn"
        type="button"
        class="grain-transfer-add-btn"
      >
        + Record Grain Transfer
      </button>

    </header>


    <div class="grain-transfer-table-wrap">

      <table class="grain-transfer-table">

        <thead>
          <tr>
            <th>Date / Time</th>
            <th>Driver</th>
            <th>Crop</th>
            <th>From</th>
            <th>To</th>
          </tr>
        </thead>

        <tbody id="grain-transfer-table-body">

          <tr>
            <td
              colspan="5"
              class="grain-transfer-empty"
            >
              Loading today's grain transfers…
            </td>
          </tr>

        </tbody>

      </table>

    </div>

  `;


  ticketSection.parentNode.insertBefore(
    section,
    ticketSection
  );
}


// ============================================================
// BUILD MODAL
// ============================================================

function injectModal() {

  if (
    document.getElementById(
      "grain-transfer-backdrop"
    )
  ) {

    return;
  }


  const backdrop =
    document.createElement(
      "div"
    );


  backdrop.id =
    "grain-transfer-backdrop";

  backdrop.className =
    "grain-transfer-backdrop";

  backdrop.setAttribute(
    "role",
    "dialog"
  );

  backdrop.setAttribute(
    "aria-modal",
    "true"
  );


  backdrop.innerHTML = `

    <div class="grain-transfer-modal">

      <div class="grain-transfer-modal-head">

        <div>

          <h2 class="grain-transfer-modal-title">
            Record Grain Transfer
          </h2>

          <div class="grain-transfer-modal-sub">
            Move an estimated load from offsite storage into a central grain site.
          </div>

        </div>

        <button
          id="grain-transfer-x"
          type="button"
          class="grain-transfer-close"
          aria-label="Close"
        >
          ×
        </button>

      </div>


      <form
        id="grain-transfer-form"
        class="grain-transfer-form"
      >

        <div class="grain-transfer-field">

          <label class="grain-transfer-label">
            Crop
          </label>

          <div
            id="grain-transfer-crops"
            class="grain-transfer-crops"
          ></div>

          <div class="grain-transfer-help">
            Only crops currently in FarmVista inventory are shown.
          </div>

        </div>


        <div class="grain-transfer-field">

          <label
            class="grain-transfer-label"
            for="grain-transfer-driver"
          >
            Driver
          </label>

          <select
            id="grain-transfer-driver"
            class="grain-transfer-select"
            required
          >
            <option value="">
              Select driver
            </option>
          </select>

        </div>


        <div class="grain-transfer-field">

          <label
            class="grain-transfer-label"
            for="grain-transfer-source"
          >
            From
          </label>

          <select
            id="grain-transfer-source"
            class="grain-transfer-select"
            disabled
            required
          >
            <option value="">
              Select crop first
            </option>
          </select>

          <div class="grain-transfer-help">
            Offsite bin sites and grain bags containing the selected crop are shown.
          </div>

        </div>


        <div class="grain-transfer-field">

          <label
            class="grain-transfer-label"
            for="grain-transfer-destination"
          >
            To
          </label>

          <select
            id="grain-transfer-destination"
            class="grain-transfer-select"
            disabled
            required
          >
            <option value="">
              Select crop first
            </option>
          </select>

          <div class="grain-transfer-help">
            Only central grain sites containing the selected crop are available.
          </div>

        </div>


        <div
          id="grain-transfer-message"
          class="grain-transfer-message"
        ></div>


        <div class="grain-transfer-actions">

          <button
            id="grain-transfer-cancel"
            type="button"
            class="grain-transfer-btn"
          >
            Cancel
          </button>

          <button
            id="grain-transfer-save"
            type="submit"
            class="grain-transfer-btn primary"
          >
            Record Transfer
          </button>

        </div>

      </form>

    </div>

  `;


document.body.appendChild(
  backdrop
);


// ============================================================
// TRANSFER SETTINGS MODAL
// ============================================================

const settingsBackdrop =
  document.createElement(
    "div"
  );


settingsBackdrop.id =
  "grain-transfer-settings-backdrop";

settingsBackdrop.className =
  "grain-transfer-backdrop";

settingsBackdrop.setAttribute(
  "role",
  "dialog"
);

settingsBackdrop.setAttribute(
  "aria-modal",
  "true"
);


settingsBackdrop.innerHTML = `

  <div class="grain-transfer-modal">

    <div class="grain-transfer-modal-head">

      <div>

        <h2 class="grain-transfer-modal-title">
          Grain Transfer Settings
        </h2>

        <div class="grain-transfer-modal-sub">
          Set the estimated bushels for one truckload of each crop.
        </div>

      </div>

      <button
        id="grain-transfer-settings-x"
        type="button"
        class="grain-transfer-close"
        aria-label="Close"
      >
        ×
      </button>

    </div>


    <form
      id="grain-transfer-settings-form"
      class="grain-transfer-form"
    >

      <div
        id="grain-transfer-settings-fields"
      ></div>


      <div class="grain-transfer-help">
        These estimates are used behind the scenes when an offsite grain transfer is recorded.
      </div>


      <div
        id="grain-transfer-settings-message"
        class="grain-transfer-message"
      ></div>


      <div class="grain-transfer-actions">

        <button
          id="grain-transfer-settings-cancel"
          type="button"
          class="grain-transfer-btn"
        >
          Cancel
        </button>

        <button
          id="grain-transfer-settings-save"
          type="submit"
          class="grain-transfer-btn primary"
        >
          Save Settings
        </button>

      </div>

    </form>

  </div>

`;


document.body.appendChild(
  settingsBackdrop
);
}


// ============================================================
// CACHE ELEMENTS
// ============================================================

function cacheElements() {

  els.section =
    document.getElementById(
      "grain-transfers-summary"
    );

  els.settings =
    document.getElementById(
      "grain-transfer-settings-btn"
    );

  els.add =
    document.getElementById(
      "grain-transfer-add-btn"
    );

  els.tableBody =
    document.getElementById(
      "grain-transfer-table-body"
    );

  els.backdrop =
    document.getElementById(
      "grain-transfer-backdrop"
    );

  els.close =
    document.getElementById(
      "grain-transfer-x"
    );

  els.form =
    document.getElementById(
      "grain-transfer-form"
    );

  els.crops =
    document.getElementById(
      "grain-transfer-crops"
    );

  els.driver =
    document.getElementById(
      "grain-transfer-driver"
    );

  els.source =
    document.getElementById(
      "grain-transfer-source"
    );

  els.destination =
    document.getElementById(
      "grain-transfer-destination"
    );

  els.message =
    document.getElementById(
      "grain-transfer-message"
    );

  els.cancel =
    document.getElementById(
      "grain-transfer-cancel"
    );

  els.save =
    document.getElementById(
      "grain-transfer-save"
    );

  els.settingsBackdrop =
  document.getElementById(
    "grain-transfer-settings-backdrop"
  );

els.settingsClose =
  document.getElementById(
    "grain-transfer-settings-x"
  );

els.settingsForm =
  document.getElementById(
    "grain-transfer-settings-form"
  );

els.settingsFields =
  document.getElementById(
    "grain-transfer-settings-fields"
  );

els.settingsMessage =
  document.getElementById(
    "grain-transfer-settings-message"
  );

els.settingsCancel =
  document.getElementById(
    "grain-transfer-settings-cancel"
  );

els.settingsSave =
  document.getElementById(
    "grain-transfer-settings-save"
  );
}


// ============================================================
// TABLE
// ============================================================

function renderTable() {

  if (
    !els.tableBody
  ) {

    return;
  }


  const today =
    todayISO();


  const transfers =
    state.transfers
      .filter(
        transfer => {

          const transferDate =
            clean(
              transfer.dateISO
            ) ||
            localDateISO(
              transfer.createdAt
            );


          return (
            transferDate ===
            today
          );
        }
      )
      .sort(
        (
          a,
          b
        ) => {

          const aDate =
            timestampDate(
              a.createdAt
            );

          const bDate =
            timestampDate(
              b.createdAt
            );


          return (
            (
              bDate?.getTime() ||
              0
            ) -
            (
              aDate?.getTime() ||
              0
            )
          );
        }
      );


  if (
    !transfers.length
  ) {

    els.tableBody.innerHTML = `

      <tr>
        <td
          colspan="5"
          class="grain-transfer-empty"
        >
          No grain transfers recorded today.
        </td>
      </tr>

    `;

    return;
  }


  els.tableBody.innerHTML =
    transfers.map(
      transfer => `

        <tr>

          <td>
            ${escapeHtml(
              displayDateTime(
                transfer.createdAt ||
                transfer.recordedAt
              )
            )}
          </td>

          <td>
            ${escapeHtml(
              transfer.driverName ||
              "—"
            )}
          </td>

          <td>
            ${escapeHtml(
              transfer.crop ||
              "—"
            )}
          </td>

          <td>
            ${escapeHtml(
              transfer.sourceName ||
              "—"
            )}
          </td>

          <td>
            ${escapeHtml(
              transfer.destinationName ||
              "—"
            )}
          </td>

        </tr>

      `
    ).join(
      ""
    );
}


// ============================================================
// MODAL RENDERING
// ============================================================

function renderCropButtons() {

  const crops =
    inventoryCrops();


  if (
    !crops.length
  ) {

    els.crops.innerHTML = `

      <div class="grain-transfer-help">
        No grain is currently available in inventory.
      </div>

    `;

    return;
  }


  els.crops.innerHTML =
    crops.map(
      crop => `

        <button
          type="button"
          class="grain-transfer-crop-btn${
            sameCrop(
              crop,
              state.selectedCrop
            )
              ? " selected"
              : ""
          }"
          data-transfer-crop="${escapeHtml(
            crop
          )}"
        >
          ${escapeHtml(
            crop
          )}
        </button>

      `
    ).join(
      ""
    );


  els.crops
    .querySelectorAll(
      "[data-transfer-crop]"
    )
    .forEach(
      button => {

        button.addEventListener(
          "click",
          () => {

            selectCrop(
              button.dataset.transferCrop ||
              ""
            );
          }
        );
      }
    );
}


function renderDrivers() {

  els.driver.innerHTML = `

    <option value="">
      Select driver
    </option>

  `;


  const employees =
    state.drivers.filter(
      driver =>
        driver.type ===
        "employee"
    );


  const subs =
    state.drivers.filter(
      driver =>
        driver.type ===
        "subcontractor"
    );


  if (
    employees.length
  ) {

    const group =
      document.createElement(
        "optgroup"
      );

    group.label =
      "FarmVista Drivers";


    employees.forEach(
      driver => {

        const option =
          document.createElement(
            "option"
          );

        option.value =
          driver.value;

        option.textContent =
          driver.name;

        group.appendChild(
          option
        );
      }
    );


    els.driver.appendChild(
      group
    );
  }


  if (
    subs.length
  ) {

    const grouped =
      new Map();


    subs.forEach(
      driver => {

        const company =
          driver.company ||
          "Trucking Subcontractors";


        if (
          !grouped.has(
            company
          )
        ) {

          grouped.set(
            company,
            []
          );
        }


        grouped.get(
          company
        ).push(
          driver
        );
      }
    );


    [
      ...grouped.entries()
    ]
      .sort(
        (
          a,
          b
        ) =>
          a[0].localeCompare(
            b[0]
          )
      )
      .forEach(
        (
          [
            company,
            drivers
          ]
        ) => {

          const group =
            document.createElement(
              "optgroup"
            );

          group.label =
            company;


          drivers.forEach(
            driver => {

              const option =
                document.createElement(
                  "option"
                );

              option.value =
                driver.value;

              option.textContent =
                driver.name;

              group.appendChild(
                option
              );
            }
          );


          els.driver.appendChild(
            group
          );
        }
      );
  }
}


function renderSources() {

  els.source.innerHTML =
    "";


  if (
    !state.selectedCrop
  ) {

    els.source.disabled =
      true;

    els.source.innerHTML = `

      <option value="">
        Select crop first
      </option>

    `;

    return;
  }


  const sources =
    sourceOptions(
      state.selectedCrop
    );


  els.source.disabled =
    false;


  els.source.innerHTML = `

    <option value="">
      Select offsite storage
    </option>

  `;


  const binSources =
    sources.filter(
      source =>
        source.type ===
        "bin_site"
    );


  const bagSources =
    sources.filter(
      source =>
        source.type ===
        "grain_bag"
    );


  if (
    binSources.length
  ) {

    const group =
      document.createElement(
        "optgroup"
      );

    group.label =
      "Bin Sites";


    binSources.forEach(
      source => {

        const option =
          document.createElement(
            "option"
          );

        option.value =
          source.value;

        option.textContent =
          source.name;

        group.appendChild(
          option
        );
      }
    );


    els.source.appendChild(
      group
    );
  }


  if (
    bagSources.length
  ) {

    const group =
      document.createElement(
        "optgroup"
      );

    group.label =
      "Grain Bags";


    bagSources.forEach(
      source => {

        const option =
          document.createElement(
            "option"
          );

        option.value =
          source.value;

        option.textContent =
          source.name;

        group.appendChild(
          option
        );
      }
    );


    els.source.appendChild(
      group
    );
  }


  if (
    !sources.length
  ) {

    els.source.innerHTML = `

      <option value="">
        No offsite ${escapeHtml(
          state.selectedCrop
        )} inventory available
      </option>

    `;

    els.source.disabled =
      true;
  }
}


function renderDestinations() {

  els.destination.innerHTML =
    "";


  if (
    !state.selectedCrop
  ) {

    els.destination.disabled =
      true;

    els.destination.innerHTML = `

      <option value="">
        Select crop first
      </option>

    `;

    return;
  }


  const destinations =
    destinationOptions(
      state.selectedCrop
    );


  els.destination.disabled =
    false;


  els.destination.innerHTML = `

    <option value="">
      Select central grain site
    </option>

  `;


  destinations.forEach(
    destination => {

      const option =
        document.createElement(
          "option"
        );

      option.value =
        destination.id;

      option.textContent =
        destination.name;

      els.destination.appendChild(
        option
      );
    }
  );


  if (
    !destinations.length
  ) {

    els.destination.innerHTML = `

      <option value="">
        No central site available for ${escapeHtml(
          state.selectedCrop
        )}
      </option>

    `;

    els.destination.disabled =
      true;
  }
}


function selectCrop(
  crop
) {

  state.selectedCrop =
    clean(
      crop
    );

  state.selectedSource =
    "";

  state.selectedDestination =
    "";


  renderCropButtons();
  renderSources();
  renderDestinations();
  clearMessage();
}


// ============================================================
// MESSAGE
// ============================================================

function clearMessage() {

  if (
    !els.message
  ) {

    return;
  }


  els.message.className =
    "grain-transfer-message";

  els.message.textContent =
    "";
}


function showMessage(
  text,
  type = "error"
) {

  els.message.className =
    `grain-transfer-message show ${type}`;

  els.message.textContent =
    text;
}


// ============================================================
// MODAL OPEN / CLOSE
// ============================================================

function resetForm() {

  state.selectedCrop =
    "";

  state.selectedDriver =
    "";

  state.selectedSource =
    "";

  state.selectedDestination =
    "";


  if (
    els.form
  ) {

    els.form.reset();
  }


  renderCropButtons();
  renderDrivers();
  renderSources();
  renderDestinations();
  clearMessage();
}


function openModal() {

  resetForm();


  els.backdrop.classList.add(
    "open"
  );


  document.body.style.overflow =
    "hidden";
}


function closeModal() {

  if (
    state.saving
  ) {

    return;
  }


  els.backdrop.classList.remove(
    "open"
  );


  document.body.style.overflow =
    "";
}


// ============================================================
// FIND SELECTED OBJECTS
// ============================================================

function selectedDriver() {

  const value =
    clean(
      els.driver.value
    );


  return state.drivers.find(
    driver =>
      driver.value ===
      value
  ) ||
  null;
}


function selectedSource() {

  const value =
    clean(
      els.source.value
    );


  if (
    value.startsWith(
      "site:"
    )
  ) {

    const id =
      value.slice(
        5
      );


    const site =
      state.binSites.find(
        item =>
          item.id ===
          id
      );


    if (
      !site
    ) {

      return null;
    }


    return {

      type:
        "bin_site",

      id:
        site.id,

      name:
        clean(
          site.name
        ) ||
        "Bin Site",

      data:
        site

    };
  }


  if (
    value.startsWith(
      "bag:"
    )
  ) {

    const id =
      value.slice(
        4
      );


    const bag =
      state.bags.find(
        item =>
          item.id ===
          id
      );


    if (
      !bag
    ) {

      return null;
    }


    const fieldName =
      clean(
        bag?.field?.name
      ) ||
      "Grain Bag";


    const location =
      clean(
        bag?.bagSku?.location
      );


    return {

      type:
        "grain_bag",

      id:
        bag.id,

      name:
        location
          ? `${fieldName} — ${location}`
          : fieldName,

      data:
        bag

    };
  }


  return null;
}


function selectedDestination() {

  const id =
    clean(
      els.destination.value
    );


  if (
    !id
  ) {

    return null;
  }


  const site =
    state.binSites.find(
      item =>
        item.id ===
        id
    );


  if (
    !site
  ) {

    return null;
  }


  return {

    id:
      site.id,

    name:
      clean(
        site.name
      ) ||
      "Central Grain Site",

    data:
      site

  };
}


// ============================================================
// TRANSACTION SUPPORT
// ============================================================

async function getTransactionRunner() {

  const module =
    await import(
      "/js/firebase-init.js"
    );


  if (
    typeof module.runTransaction !==
      "function"
  ) {

    throw new Error(
      "Firestore transaction support is unavailable. Inventory was not changed."
    );
  }


  return module.runTransaction;
}


// ============================================================
// CREATE MOVEMENT REFERENCES
// ============================================================

function createMovementRefs(
  sourceAllocationCount,
  destinationAllocationCount
) {

  const sourceRefs =
    [];

  const destinationRefs =
    [];


  for (
    let index = 0;
    index <
      sourceAllocationCount;
    index += 1
  ) {

    sourceRefs.push(
      doc(
        collection(
          db,
          BIN_MOVEMENT_COLLECTION
        )
      )
    );
  }


  for (
    let index = 0;
    index <
      destinationAllocationCount;
    index += 1
  ) {

    destinationRefs.push(
      doc(
        collection(
          db,
          BIN_MOVEMENT_COLLECTION
        )
      )
    );
  }


  return {
    sourceRefs,
    destinationRefs
  };
}


// ============================================================
// SAVE BIN SITE → CENTRAL SITE
// ============================================================

async function saveBinSiteTransfer({
  transferRef,
  source,
  destination,
  driver,
  crop,
  requestedBushels
}) {

  const runTransaction =
    await getTransactionRunner();


  const sourceRef =
    doc(
      db,
      BIN_SITE_COLLECTION,
      source.id
    );


  const destinationRef =
    doc(
      db,
      BIN_SITE_COLLECTION,
      destination.id
    );


  const who =
    currentUser();


  await runTransaction(
    db,
    async transaction => {

      const sourceSnapshot =
        await transaction.get(
          sourceRef
        );


      const destinationSnapshot =
        await transaction.get(
          destinationRef
        );


      if (
        !sourceSnapshot.exists()
      ) {

        throw new Error(
          "The selected offsite bin site no longer exists."
        );
      }


      if (
        !destinationSnapshot.exists()
      ) {

        throw new Error(
          "The selected central grain site no longer exists."
        );
      }


      const sourceData = {

        id:
          sourceSnapshot.id,

        ...sourceSnapshot.data()

      };


      const destinationData = {

        id:
          destinationSnapshot.id,

        ...destinationSnapshot.data()

      };


      if (
        siteIsCentral(
          sourceData
        )
      ) {

        throw new Error(
          "The grain source must be an offsite bin site."
        );
      }


      if (
        !siteIsCentral(
          destinationData
        )
      ) {

        throw new Error(
          "Grain can only be transferred into a central grain site."
        );
      }


      const sourceAvailable =
        siteCropBushels(
          sourceData,
          crop
        );


      if (
        sourceAvailable <=
        0
      ) {

        throw new Error(
          `The selected source no longer has ${crop} inventory.`
        );
      }


      /*
        If the source contains less than one normal estimated load,
        use everything remaining instead of creating negative inventory.
      */

      const actualBushels =
        roundBushels(
          Math.min(
            requestedBushels,
            sourceAvailable
          )
        );


      const sourcePlan =
        buildBinRemovalPlan(
          sourceData,
          crop,
          actualBushels
        );


      if (
        sourcePlan.removedBushels <=
        0
      ) {

        throw new Error(
          `No ${crop} could be removed from the selected source.`
        );
      }


      const destinationPlan =
        buildBinAdditionPlan(
          destinationData,
          crop,
          sourcePlan.removedBushels
        );


      if (
        destinationPlan.shortfallBushels >
        0
      ) {

        throw new Error(
          `The selected central site does not have enough available ${crop} bin capacity for this transfer.`
        );
      }


      const movementRefs =
        createMovementRefs(
          sourcePlan.allocations.length,
          destinationPlan.allocations.length
        );


      const nowMs =
        Date.now();


      // ------------------------------------------------------
      // UPDATE SOURCE SITE
      // ------------------------------------------------------

      const sourceBins =
        sourcePlan.bins.map(
          bin => ({
            ...bin
          })
        );


      sourcePlan.allocations.forEach(
        allocation => {

          sourceBins[
            allocation.binIndex
          ] = {

            ...sourceBins[
              allocation.binIndex
            ],

            lastUpdatedBy:
              who.name,

            lastUpdatedUid:
              who.uid,

            lastUpdatedMs:
              nowMs

          };
        }
      );


      transaction.set(
        sourceRef,
        {
          bins:
            sourceBins,

          updatedAt:
            serverTimestamp()
        },
        {
          merge:
            true
        }
      );


      // ------------------------------------------------------
      // UPDATE DESTINATION SITE
      // ------------------------------------------------------

      const destinationBins =
        destinationPlan.bins.map(
          bin => ({
            ...bin
          })
        );


      destinationPlan.allocations.forEach(
        allocation => {

          destinationBins[
            allocation.binIndex
          ] = {

            ...destinationBins[
              allocation.binIndex
            ],

            lastUpdatedBy:
              who.name,

            lastUpdatedUid:
              who.uid,

            lastUpdatedMs:
              nowMs

          };
        }
      );


      transaction.set(
        destinationRef,
        {
          bins:
            destinationBins,

          updatedAt:
            serverTimestamp()
        },
        {
          merge:
            true
        }
      );


      // ------------------------------------------------------
      // SOURCE BIN MOVEMENTS
      // ------------------------------------------------------

      sourcePlan.allocations.forEach(
        (
          allocation,
          index
        ) => {

          transaction.set(
            movementRefs.sourceRefs[
              index
            ],
            {
              siteId:
                sourceData.id,

              siteName:
                clean(
                  sourceData.name
                ) ||
                source.name,

              binIndex:
                allocation.binIndex,

              binNum:
                allocation.binNum,

              crop,

              direction:
                "out",

              bushels:
                allocation.bushels,

              grainTransferId:
                transferRef.id,

              transferType:
                "grain_transfer",

              sourceSiteId:
                sourceData.id,

              destinationSiteId:
                destinationData.id,

              driverName:
                driver.name,

              note:
                `Grain transfer to ${clean(destinationData.name) || destination.name}`,

              submittedBy:
                who.name,

              submittedByUid:
                who.uid,

              dateISO:
                todayISO(),

              createdAt:
                serverTimestamp()
            }
          );
        }
      );


      // ------------------------------------------------------
      // DESTINATION BIN MOVEMENTS
      // ------------------------------------------------------

      destinationPlan.allocations.forEach(
        (
          allocation,
          index
        ) => {

          transaction.set(
            movementRefs.destinationRefs[
              index
            ],
            {
              siteId:
                destinationData.id,

              siteName:
                clean(
                  destinationData.name
                ) ||
                destination.name,

              binIndex:
                allocation.binIndex,

              binNum:
                allocation.binNum,

              crop,

              direction:
                "in",

              bushels:
                allocation.bushels,

              grainTransferId:
                transferRef.id,

              transferType:
                "grain_transfer",

              sourceSiteId:
                sourceData.id,

              destinationSiteId:
                destinationData.id,

              driverName:
                driver.name,

              note:
                `Grain transfer from ${clean(sourceData.name) || source.name}`,

              submittedBy:
                who.name,

              submittedByUid:
                who.uid,

              dateISO:
                todayISO(),

              createdAt:
                serverTimestamp()
            }
          );
        }
      );


      // ------------------------------------------------------
      // TRANSFER RECORD
      // ------------------------------------------------------

      transaction.set(
        transferRef,
        {
          crop,

          estimatedBushels:
            sourcePlan.removedBushels,

          configuredEstimatedBushels:
            requestedBushels,

          sourceType:
            "bin_site",

          sourceId:
            sourceData.id,

          sourceName:
            clean(
              sourceData.name
            ) ||
            source.name,

          destinationSiteId:
            destinationData.id,

          destinationName:
            clean(
              destinationData.name
            ) ||
            destination.name,

          driverType:
            driver.type,

          driverId:
            driver.id,

          driverUid:
            driver.uid ||
            null,

          driverName:
            driver.name,

          driverCompany:
            driver.company ||
            null,

          sourceAllocations:
            sourcePlan.allocations,

          destinationAllocations:
            destinationPlan.allocations,

          sourceMovementIds:
            movementRefs.sourceRefs.map(
              ref =>
                ref.id
            ),

          destinationMovementIds:
            movementRefs.destinationRefs.map(
              ref =>
                ref.id
            ),

          dateISO:
            todayISO(),

          createdByUid:
            who.uid,

          createdByName:
            who.name,

          createdByEmail:
            who.email,

          createdAt:
            serverTimestamp(),

          status:
            "complete"
        }
      );
    }
  );
}


// ============================================================
// SAVE BAG → CENTRAL SITE
// ============================================================

async function saveBagTransfer({
  transferRef,
  source,
  destination,
  driver,
  crop,
  requestedBushels
}) {

  const runTransaction =
    await getTransactionRunner();


  const bagRef =
    doc(
      db,
      BAG_COLLECTION,
      source.id
    );


  const destinationRef =
    doc(
      db,
      BIN_SITE_COLLECTION,
      destination.id
    );


  const who =
    currentUser();


  await runTransaction(
    db,
    async transaction => {

      const bagSnapshot =
        await transaction.get(
          bagRef
        );


      const destinationSnapshot =
        await transaction.get(
          destinationRef
        );


      if (
        !bagSnapshot.exists()
      ) {

        throw new Error(
          "The selected grain bag no longer exists."
        );
      }


      if (
        !destinationSnapshot.exists()
      ) {

        throw new Error(
          "The selected central grain site no longer exists."
        );
      }


      const bagData = {

        id:
          bagSnapshot.id,

        ...bagSnapshot.data()

      };


      const destinationData = {

        id:
          destinationSnapshot.id,

        ...destinationSnapshot.data()

      };


      if (
        norm(
          bagData.status
        ) ===
        "pickedup"
      ) {

        throw new Error(
          "The selected grain bag has already been picked up."
        );
      }


      const bagCrop =
        clean(
          bagData.cropType ||
          bagData.crop
        );


      if (
        !sameCrop(
          bagCrop,
          crop
        )
      ) {

        throw new Error(
          "The grain bag crop no longer matches this transfer."
        );
      }


      if (
        !siteIsCentral(
          destinationData
        )
      ) {

        throw new Error(
          "Grain can only be transferred into a central grain site."
        );
      }


      const bagPlan =
        buildBagRemovalPlan(
          bagData,
          requestedBushels
        );


      if (
        bagPlan.removedBushels <=
        0
      ) {

        throw new Error(
          "The selected grain bag no longer has inventory."
        );
      }


      const destinationPlan =
        buildBinAdditionPlan(
          destinationData,
          crop,
          bagPlan.removedBushels
        );


      if (
        destinationPlan.shortfallBushels >
        0
      ) {

        throw new Error(
          `The selected central site does not have enough available ${crop} bin capacity for this transfer.`
        );
      }


      const movementRefs =
        createMovementRefs(
          0,
          destinationPlan.allocations.length
        );


      const pickupRef =
        doc(
          db,
          BAG_COLLECTION,
          `transfer_${transferRef.id}`
        );


      // ------------------------------------------------------
      // UPDATE BAG
      // ------------------------------------------------------

 const bagPatch = {

  counts: {
    full:
      bagPlan.countsAfter.full,

    partial:
      bagPlan.countsAfter.partial
  },

  partialFeet:
    bagPlan.countsAfter.partialFeet,

  updatedAt:
    serverTimestamp()
};


      if (
        bagPlan.remainingFeet <=
        0.01
      ) {

        bagPatch.status =
          "pickedUp";

        bagPatch.pickedUpAt =
          todayISO();

        bagPatch.pickedUpBy = {

          employeeId:
            who.uid ||
            who.email ||
            null,

          name:
            who.name,

          email:
            who.email

        };
      }


      transaction.set(
        bagRef,
        bagPatch,
        {
          merge:
            true
        }
      );


      // ------------------------------------------------------
      // BAG PICKUP EVENT
      // ------------------------------------------------------

      transaction.set(
        pickupRef,
        {
          type:
            "pickUp",

          grainTransfer:
            true,

          grainTransferId:
            transferRef.id,

          sourcePutDownId:
            bagData.id,

          field:
            bagData.field ||
            null,

          cropType:
            crop,

          crop:
            crop,

          bushels:
            bagPlan.removedBushels,

          driverName:
            driver.name,

          destinationSiteId:
            destinationData.id,

          destinationName:
            clean(
              destinationData.name
            ) ||
            destination.name,

          dateISO:
            todayISO(),

          submittedBy:
            who.name,

          submittedByUid:
            who.uid,

          createdAt:
            serverTimestamp()
        }
      );


      // ------------------------------------------------------
      // UPDATE CENTRAL SITE
      // ------------------------------------------------------

      const destinationBins =
        destinationPlan.bins.map(
          bin => ({
            ...bin
          })
        );


      const nowMs =
        Date.now();


      destinationPlan.allocations.forEach(
        allocation => {

          destinationBins[
            allocation.binIndex
          ] = {

            ...destinationBins[
              allocation.binIndex
            ],

            lastUpdatedBy:
              who.name,

            lastUpdatedUid:
              who.uid,

            lastUpdatedMs:
              nowMs

          };
        }
      );


      transaction.set(
        destinationRef,
        {
          bins:
            destinationBins,

          updatedAt:
            serverTimestamp()
        },
        {
          merge:
            true
        }
      );


      // ------------------------------------------------------
      // DESTINATION MOVEMENTS
      // ------------------------------------------------------

      destinationPlan.allocations.forEach(
        (
          allocation,
          index
        ) => {

          transaction.set(
            movementRefs.destinationRefs[
              index
            ],
            {
              siteId:
                destinationData.id,

              siteName:
                clean(
                  destinationData.name
                ) ||
                destination.name,

              binIndex:
                allocation.binIndex,

              binNum:
                allocation.binNum,

              crop,

              direction:
                "in",

              bushels:
                allocation.bushels,

              grainTransferId:
                transferRef.id,

              transferType:
                "grain_transfer",

              sourceBagId:
                bagData.id,

              destinationSiteId:
                destinationData.id,

              driverName:
                driver.name,

              note:
                `Grain transfer from ${source.name}`,

              submittedBy:
                who.name,

              submittedByUid:
                who.uid,

              dateISO:
                todayISO(),

              createdAt:
                serverTimestamp()
            }
          );
        }
      );


      // ------------------------------------------------------
      // TRANSFER RECORD
      // ------------------------------------------------------

      transaction.set(
        transferRef,
        {
          crop,

          estimatedBushels:
            bagPlan.removedBushels,

          configuredEstimatedBushels:
            requestedBushels,

          sourceType:
            "grain_bag",

          sourceId:
            bagData.id,

          sourceName:
            source.name,

          destinationSiteId:
            destinationData.id,

          destinationName:
            clean(
              destinationData.name
            ) ||
            destination.name,

          driverType:
            driver.type,

          driverId:
            driver.id,

          driverUid:
            driver.uid ||
            null,

          driverName:
            driver.name,

          driverCompany:
            driver.company ||
            null,

          destinationAllocations:
            destinationPlan.allocations,

          destinationMovementIds:
            movementRefs.destinationRefs.map(
              ref =>
                ref.id
            ),

          bagPickupEventId:
            pickupRef.id,

          dateISO:
            todayISO(),

          createdByUid:
            who.uid,

          createdByName:
            who.name,

          createdByEmail:
            who.email,

          createdAt:
            serverTimestamp(),

          status:
            "complete"
        }
      );
    }
  );
}


// ============================================================
// RECORD TRANSFER
// ============================================================

async function recordTransfer(
  event
) {

  event.preventDefault();


  if (
    state.saving
  ) {

    return;
  }


  clearMessage();


  const crop =
    clean(
      state.selectedCrop
    );


  const driver =
    selectedDriver();


  const source =
    selectedSource();


  const destination =
    selectedDestination();


  if (
    !crop
  ) {

    showMessage(
      "Select a crop."
    );

    return;
  }


  if (
    !driver
  ) {

    showMessage(
      "Select the driver."
    );

    return;
  }


  if (
    !source
  ) {

    showMessage(
      "Select the offsite grain source."
    );

    return;
  }


  if (
    !destination
  ) {

    showMessage(
      "Select the central grain site."
    );

    return;
  }


  if (
    source.type ===
      "bin_site" &&
    source.id ===
      destination.id
  ) {

    showMessage(
      "The source and destination cannot be the same site."
    );

    return;
  }


  const estimatedBushels =
    estimatedBushelsForCrop(
      crop
    );


  if (
    estimatedBushels <=
    0
  ) {

    showMessage(
      `Estimated transfer bushels have not been configured for ${crop}. Open Grain Transfer Settings first.`
    );

    return;
  }


  state.saving =
    true;


  els.save.disabled =
    true;

  els.cancel.disabled =
    true;

  els.save.textContent =
    "Recording…";


  try {

    const transferRef =
      doc(
        collection(
          db,
          TRANSFER_COLLECTION
        )
      );


    if (
      source.type ===
      "bin_site"
    ) {

      await saveBinSiteTransfer({

        transferRef,

        source,

        destination,

        driver,

        crop,

        requestedBushels:
          estimatedBushels

      });

    }
    else if (
      source.type ===
      "grain_bag"
    ) {

      await saveBagTransfer({

        transferRef,

        source,

        destination,

        driver,

        crop,

        requestedBushels:
          estimatedBushels

      });

    }
    else {

      throw new Error(
        "The selected grain source is not supported."
      );
    }


    showMessage(
      "Grain transfer recorded.",
      "good"
    );


    await loadData();


    window.setTimeout(
      () => {

        state.saving =
          false;

        els.save.disabled =
          false;

        els.cancel.disabled =
          false;

        els.save.textContent =
          "Record Transfer";

        closeModal();

      },
      500
    );

  }
  catch (
    error
  ) {

    console.error(
      "[grain transfers] Save failed:",
      error
    );


    showMessage(
      clean(
        error?.message
      ) ||
      "FarmVista could not record this grain transfer."
    );


    state.saving =
      false;

    els.save.disabled =
      false;

    els.cancel.disabled =
      false;

    els.save.textContent =
      "Record Transfer";
  }
}


// ============================================================
// EVENTS
// ============================================================

function bindEvents() {

// ============================================================
// TRANSFER SETTINGS POPUP
// ============================================================

function renderTransferSettings() {

  const crops =
    inventoryCrops();


  if (
    !crops.length
  ) {

    els.settingsFields.innerHTML = `

      <div class="grain-transfer-help">
        No crops are currently in inventory.
      </div>

    `;

    return;
  }


  els.settingsFields.innerHTML =
    crops.map(
      crop => {

        const current =
          estimatedBushelsForCrop(
            crop
          );


        return `

          <div class="grain-transfer-field">

            <label
              class="grain-transfer-label"
              for="grain-transfer-setting-${escapeHtml(
                norm(crop)
                  .replace(/[^a-z0-9]+/g,"-")
              )}"
            >
              ${escapeHtml(crop)} — Estimated Bushels Per Load
            </label>

            <input
              id="grain-transfer-setting-${escapeHtml(
                norm(crop)
                  .replace(/[^a-z0-9]+/g,"-")
              )}"
              class="grain-transfer-select"
              type="number"
              inputmode="decimal"
              min="1"
              step="0.01"
              data-transfer-setting-crop="${escapeHtml(crop)}"
              value="${
                current > 0
                  ? escapeHtml(current)
                  : ""
              }"
              placeholder="Enter estimated bushels"
              required
            >

          </div>

        `;
      }
    )
    .join("");
}


function openTransferSettings() {

  renderTransferSettings();


  els.settingsMessage.className =
    "grain-transfer-message";

  els.settingsMessage.textContent =
    "";


  els.settingsBackdrop.classList.add(
    "open"
  );


  document.body.style.overflow =
    "hidden";
}


function closeTransferSettings() {

  els.settingsBackdrop.classList.remove(
    "open"
  );


  document.body.style.overflow =
    "";
}


async function saveTransferSettings(
  event
) {

  event.preventDefault();


  const inputs =
    Array.from(
      els.settingsFields.querySelectorAll(
        "[data-transfer-setting-crop]"
      )
    );


  const estimatedBushelsByCrop =
    {};


  for (
    const input of inputs
  ) {

    const crop =
      clean(
        input.dataset.transferSettingCrop
      );


    const bushels =
      roundBushels(
        input.value
      );


    if (
      !crop ||
      bushels <= 0
    ) {

      els.settingsMessage.className =
        "grain-transfer-message show error";

      els.settingsMessage.textContent =
        `Enter estimated bushels for ${crop || "each crop"}.`;

      return;
    }


    estimatedBushelsByCrop[
      crop
    ] =
      bushels;
  }


  els.settingsSave.disabled =
    true;

  els.settingsSave.textContent =
    "Saving…";


  try {

    await setDoc(
      doc(
        db,
        SETTINGS_COLLECTION,
        SETTINGS_DOCUMENT
      ),
      {
        estimatedBushelsByCrop,

        updatedAt:
          serverTimestamp(),

        updatedByUid:
          currentUser().uid,

        updatedByName:
          currentUser().name
      },
      {
        merge:
          true
      }
    );


    state.settings =
      estimatedBushelsByCrop;


    els.settingsMessage.className =
      "grain-transfer-message show good";

    els.settingsMessage.textContent =
      "Grain transfer settings saved.";


    window.setTimeout(
      closeTransferSettings,
      450
    );

  }
  catch (
    error
  ) {

    console.error(
      "[grain transfers] Settings save failed:",
      error
    );


    els.settingsMessage.className =
      "grain-transfer-message show error";

    els.settingsMessage.textContent =
      clean(
        error?.message
      ) ||
      "FarmVista could not save the transfer settings.";
  }
  finally {

    els.settingsSave.disabled =
      false;

    els.settingsSave.textContent =
      "Save Settings";
  }
}


els.settings.addEventListener(
  "click",
  openTransferSettings
);


els.settingsClose.addEventListener(
  "click",
  closeTransferSettings
);


els.settingsCancel.addEventListener(
  "click",
  closeTransferSettings
);


els.settingsForm.addEventListener(
  "submit",
  saveTransferSettings
);


els.settingsBackdrop.addEventListener(
  "click",
  event => {

    if (
      event.target ===
      els.settingsBackdrop
    ) {

      closeTransferSettings();
    }
  }
);


  els.add.addEventListener(
    "click",
    openModal
  );


  els.close.addEventListener(
    "click",
    closeModal
  );


  els.cancel.addEventListener(
    "click",
    closeModal
  );


  els.form.addEventListener(
    "submit",
    recordTransfer
  );


  els.driver.addEventListener(
    "change",
    () => {

      state.selectedDriver =
        clean(
          els.driver.value
        );

      clearMessage();
    }
  );


  els.source.addEventListener(
    "change",
    () => {

      state.selectedSource =
        clean(
          els.source.value
        );

      clearMessage();
    }
  );


  els.destination.addEventListener(
    "change",
    () => {

      state.selectedDestination =
        clean(
          els.destination.value
        );

      clearMessage();
    }
  );


  els.backdrop.addEventListener(
    "click",
    event => {

      if (
        event.target ===
        els.backdrop
      ) {

        closeModal();
      }
    }
  );


  document.addEventListener(
    "keydown",
    event => {

      if (
        event.key ===
          "Escape" &&
        els.backdrop.classList.contains(
          "open"
        )
      ) {

        closeModal();
      }
    }
  );
}


// ============================================================
// INITIALIZE
// ============================================================

async function init() {

  try {

    await ready;


    auth =
      getAuth();

    db =
      getFirestore();


    injectStyles();

    injectSection();

    injectModal();

    cacheElements();

    bindEvents();


    await loadData();

  }
  catch (
    error
  ) {

    console.error(
      "[grain transfers] Initialization failed:",
      error
    );


    if (
      els.tableBody
    ) {

      els.tableBody.innerHTML = `

        <tr>

          <td
            colspan="5"
            class="grain-transfer-empty"
          >
            Grain Transfers could not be loaded.
          </td>

        </tr>

      `;
    }
  }
}


// ============================================================
// START
// ============================================================

init();
