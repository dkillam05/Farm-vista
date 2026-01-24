/* =====================================================================
   FarmVista — version.js
   Single Source of Truth (SSOT) for version + tagline
   HARD-SAFE to load multiple times (no redeclaration errors)
===================================================================== */

(function () {
  'use strict';

  // HARD GUARD — if version already exists, do nothing
  if (window.FV_VERSION && window.FV_VERSION.number) return;

  // ---- EDIT THESE FOR RELEASES ONLY ----
  window.FV_VERSION = {
    number:  "01.23.01",
    date:    "2026-01-23",
    tagline: "Farm Data - Simplified"
  };
  // -------------------------------------

  // Legacy shims (keep these stable)
  window.FarmVistaVersion = window.FV_VERSION.number;
  window.FV_BUILD = window.FV_VERSION.number;

  window.App = window.App || {};
  window.App.getVersion = () => ({
    number:  window.FV_VERSION.number,
    date:    window.FV_VERSION.date,
    tagline: window.FV_VERSION.tagline
  });
})();
