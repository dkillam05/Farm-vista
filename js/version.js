/* ==========================================================
   FarmVista — Version (single source of truth)
   Update ONLY here when you release.
   Everything else (sidebar/footer/shell) reads from this.
   ========================================================== */
(function (global) {
  const FV_VERSION = {
    number: "1.0.0",
    date: "Monday, October 13th, 2025", // America/Chicago
    tagline: "Clean farm data. Smarter reporting."
  };

  // Expose globals (simple to consume anywhere)
  global.FV_BUILD = FV_VERSION.number;
  global.FV_BUILD_DATE = FV_VERSION.date;
  global.FV_TAGLINE = FV_VERSION.tagline;

  // Also expose an immutable object for structured access
  global.FV_VERSION = Object.freeze({ ...FV_VERSION });
})(window);
