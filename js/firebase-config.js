// /js/firebase-config.js
// FarmVista multi-farm Firebase config loader

(async () => {

  const DEFAULT_FARM =
    "dowson";


  const params =
    new URLSearchParams(
      window.location.search
    );


  const farmKey =
    String(
      params.get("farm") ||
      localStorage.getItem(
        "fv:farm-key"
      ) ||
      DEFAULT_FARM
    )
      .trim()
      .toLowerCase();


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
      farm.farmKey ||
      farmKey;


    window.FV_FIREBASE_CONFIG =
      farm.firebaseConfig;


    localStorage.setItem(
      "fv:farm-key",
      window.FV_FARM_KEY
    );


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


    window.__FV_FARM_CONFIG_FAILED =
      true;

  }

})();
