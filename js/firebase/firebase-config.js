// /js/firebase/firebase-config.js
// FarmVista multi-farm Firebase configuration loader.
//
// No farm is hard-coded as the default.
//
// A farm can be selected with:
//   ?farm=dowson
//   ?farm=borrowman
//
// Once selected, the farm key is remembered in localStorage.
//
// If no farm has been selected yet, FarmVista stays in a
// neutral "no farm selected" state and does NOT load Firebase.

(() => {

  /* ==========================================================
     GRAIN TICKET SCAN SUPPORT

     grain-ticket-scan.html does not use fv-shell/version.js, so
     load its signed-in scan helper directly from this script,
     which the scan page already loads before its main module.
  ========================================================== */

  const currentPath =
    String(window.location.pathname || '').toLowerCase();

  if (
    currentPath.endsWith('/pages/grain/grain-ticket-scan.html') &&
    !window.__FV_GRAIN_TICKET_SCAN_SOURCE_FLOW_DIRECT_20260904
  ) {
    window.__FV_GRAIN_TICKET_SCAN_SOURCE_FLOW_DIRECT_20260904 = true;

    const helperScript = document.createElement('script');
    helperScript.type = 'module';
    helperScript.src = '/js/grain/scanning/capture/grain-ticket-scan-source-flow.js?v=20260904-5';
    helperScript.dataset.fvGrainTicketScanSourceFlowDirect = '1';
    document.head.appendChild(helperScript);
  }

  const FARM_STORAGE_KEY =
    "fv:farm-key";

  window.FV_FARM = null;
  window.FV_FARM_KEY = "";
  window.FV_FIREBASE_CONFIG = null;
  window.__FV_NO_FARM_SELECTED = false;
  window.__FV_FARM_CONFIG_FAILED = false;
  window.__FV_FARM_CONFIG_LOADING = true;

  let resolveFarmReady;

  window.FV_FARM_READY = new Promise(resolve => {
    resolveFarmReady = resolve;
  });

  function finish(result) {
    window.__FV_FARM_CONFIG_LOADING = false;
    if (typeof resolveFarmReady === "function") {
      resolveFarmReady(result);
      resolveFarmReady = null;
    }
  }

  function normalizeFarmKey(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "");
  }

  const params = new URLSearchParams(window.location.search);
  const requestedFarm = normalizeFarmKey(params.get("farm"));

  let storedFarm = "";
  try {
    storedFarm = normalizeFarmKey(localStorage.getItem(FARM_STORAGE_KEY));
  }
  catch {}

  const farmKey = requestedFarm || storedFarm;

  if (!farmKey) {
    window.FV_FARM = null;
    window.FV_FARM_KEY = "";
    window.FV_FIREBASE_CONFIG = null;
    window.__FV_NO_FARM_SELECTED = true;
    window.__FV_FARM_CONFIG_FAILED = false;

    console.info("[FarmVista] No farm selected.");

    finish({
      ok: true,
      selected: false,
      farm: null,
      farmKey: "",
      firebaseConfig: null
    });
    return;
  }

  (async () => {
    try {
      const configFileKey = ({
        dowson: "dowsonfarms-illinois",
        borrowman: "borrowman-farms"
      })[farmKey] || farmKey;

      const response = await fetch(
        `/assets/farm-accounts/${encodeURIComponent(configFileKey)}.json`,
        { cache: "no-store" }
      );

      if (!response.ok) {
        throw new Error(`Farm configuration not found: ${farmKey}`);
      }

      const farm = await response.json();

      if (!farm || typeof farm !== "object") {
        throw new Error(`Invalid farm configuration: ${farmKey}`);
      }

      if (farm.active === false) {
        throw new Error(`Farm is inactive: ${farmKey}`);
      }

      if (!farm.firebaseConfig || typeof farm.firebaseConfig !== "object") {
        throw new Error(`Firebase configuration missing for farm: ${farmKey}`);
      }

      const resolvedFarmKey = normalizeFarmKey(farm.farmKey || farmKey);
      if (!resolvedFarmKey) {
        throw new Error(`Farm key is invalid: ${farmKey}`);
      }

      window.FV_FARM = farm;
      window.FV_FARM_KEY = resolvedFarmKey;
      window.FV_FIREBASE_CONFIG = farm.firebaseConfig;
      window.__FV_NO_FARM_SELECTED = false;
      window.__FV_FARM_CONFIG_FAILED = false;

      try {
        localStorage.setItem(FARM_STORAGE_KEY, resolvedFarmKey);
      }
      catch {}

      console.info("[FarmVista] Farm loaded:", farm.name || resolvedFarmKey);

      finish({
        ok: true,
        selected: true,
        farm,
        farmKey: resolvedFarmKey,
        firebaseConfig: farm.firebaseConfig
      });
    }
    catch (error) {
      console.error("[FarmVista] Unable to load farm configuration.", error);

      if (requestedFarm) {
        try {
          localStorage.removeItem(FARM_STORAGE_KEY);
        }
        catch {}
      }

      window.FV_FARM = null;
      window.FV_FARM_KEY = "";
      window.FV_FIREBASE_CONFIG = null;
      window.__FV_NO_FARM_SELECTED = true;
      window.__FV_FARM_CONFIG_FAILED = true;

      finish({
        ok: false,
        selected: false,
        farm: null,
        farmKey: "",
        firebaseConfig: null,
        error
      });
    }
  })();

})();
