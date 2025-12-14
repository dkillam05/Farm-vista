/* =====================================================================
   FarmVista — version.js
   Single Source of Truth (SSOT) for version + tagline
   SAFE to load multiple times (no redeclaration errors)
===================================================================== */

(function () {
  // HARD GUARD — if version already exists, do nothing
  if (window.FV_VERSION && window.FV_VERSION.number) return;

  // ---- EDIT THESE FOR RELEASES ONLY ----
  const NUMBER  = "12.10.01";
  const DATE    = "2025-12-10";
  const TAGLINE = "Farm Data - Simplified";
  // -------------------------------------

  window.FV_VERSION = { number: NUMBER, date: DATE, tagline: TAGLINE };

  // Legacy shims
  window.FarmVistaVersion = NUMBER;
  window.FV_BUILD = NUMBER;

  window.App = window.App || {};
  window.App.getVersion = () => ({ number: NUMBER, date: DATE, tagline: TAGLINE });
})();

