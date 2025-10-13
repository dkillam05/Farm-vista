/* ==========================================================
   File: /js/version.js
   Purpose: Single source of truth for FarmVista app version.
   This value is read by fv-shell.js to display in the sidebar footer.
   ========================================================== */

window.FarmVistaVersion = "1.0.0";

/*
  Usage:
    - The <fv-shell> component automatically looks for this variable
      and injects it into its footer if present.
    - Any other script can read it globally:
          console.log(window.FarmVistaVersion);
*/