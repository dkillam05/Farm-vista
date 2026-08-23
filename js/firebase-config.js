// /js/firebase-config.js
// FarmVista multi-farm Firebase configuration loader.
//
// IMPORTANT:
// There is NO default farm.
// A farm must be explicitly identified before FarmVista
// loads that farm's Firebase project.

(async () => {

  const FARM_STORAGE_KEY =
    "fv:farm-key";


  const params =
    new URLSearchParams(
      window.location.search
    );


  const requestedFarm =
    String(
      params.get("farm") ||
      ""
    )
      .trim()
      .toLowerCase();


  let storedFarm =
    "";


  try {

    storedFarm =
      String(
        localStorage.getItem(
          FARM_STORAGE_KEY
        ) ||
        ""
      )
        .trim()
        .toLowerCase();

  }
  catch {}


  const farmKey =
    requestedFarm ||
    storedFarm;


  // ==========================================================
  // NO FARM SELECTED
  // ==========================================================

  if (
    !farmKey
  ) {

    console.info(
      "[FarmVista] No farm selected. Showing generic FarmVista login."
    );


    window.FV_FARM =
      null;

    window.FV_FARM_KEY =
      "";

    window.FV_FIREBASE_CONFIG =
      null;

    window.__FV_NO_FARM_SELECTED =
      true;


    return;

  }


  // ==========================================================
  // LOAD FARM
  // ==========================================================

  try {

    const response =
      await fetch(
        `/farms/${encodeURIComponent(farmKey)}.json`,
        {
          cache:
            "no-store"
        }
      );


    if (
      !response.ok
    ) {

      throw new Error(
        `Farm configuration not found: ${farmKey}`
      );

    }


    const farm =
      await response.json();


    if (
      !farm ||
      farm.active === false ||
      !farm.firebaseConfig
    ) {

      throw new Error(
        `Invalid or inactive farm configuration: ${farmKey}`
      );

    }


    window.FV_FARM =
      farm;


    window.FV_FARM_KEY =
      String(
        farm.farmKey ||
        farmKey
      )
        .trim()
        .toLowerCase();


    window.FV_FIREBASE_CONFIG =
      farm.firebaseConfig;


    window.__FV_NO_FARM_SELECTED =
      false;


    try {

      localStorage.setItem(
        FARM_STORAGE_KEY,
        window.FV_FARM_KEY
      );

    }
    catch {}


    console.info(
      "[FarmVista] Farm loaded:",
      farm.name ||
      window.FV_FARM_KEY
    );

  }
  catch (
    error
  ) {

    console.error(
      "[FarmVista] Unable to load farm configuration.",
      error
    );


    window.FV_FARM =
      null;

    window.FV_FARM_KEY =
      "";

    window.FV_FIREBASE_CONFIG =
      null;

    window.__FV_FARM_CONFIG_FAILED =
      true;

  }

})();
