/* FarmVista — version.js (SSOT for version + tagline)
   Bump these fields for each release. Everything else reads from here. */

const FV_NUMBER  = "10.31.07";                 // ← edit this when releasing
const FV_DATE    = "2025-10-27";            // ← optional, informational
const FV_TAGLINE = "Farm Data - Simplified";

/* ===== DO NOT EDIT BELOW ===== */
window.FV_VERSION = {
  number: FV_NUMBER,
  date:   FV_DATE,
  tagline: FV_TAGLINE
};

/* Legacy shims so older code keeps working */
window.FarmVistaVersion = FV_NUMBER;        // older pages that referenced this
window.FV_BUILD = FV_NUMBER;                // legacy fallback
window.App = window.App || {};
window.App.getVersion = () => ({            // any code calling App.getVersion()
  number: FV_NUMBER,
  date:   FV_DATE,
  tagline: FV_TAGLINE
});