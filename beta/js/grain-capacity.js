/* FarmVista — grain-capacity.js v1.0.0
   Shared helpers for converting storage capacity between crops.

   DESIGN:
   - All “rated capacity” on setup screens is stored as CORN bushels.
   - This helper converts that corn capacity into effective bushels for
     other crops (soybeans, wheat, oats, etc.) using multipliers.
   - Centralized here so you can tweak factors or add crops in ONE place.

   USAGE (in any page after this file is loaded):
     const cornBu = 60000;

     // Soybean capacity for a 60k corn-bin
     const sbBu = FVGrainCapacity.capacityForCrop(cornBu, 'soybeans');  // 55800

     // Corn bu equivalent for 55,800 bu of beans
     const cornEq = FVGrainCapacity.cornCapacityFromCrop(55800, 'soybeans'); // ~60000

     // Get factor for a crop (relative to corn)
     const f = FVGrainCapacity.getFactor('wheat'); // 1.07

   All APIs are attached to window.FVGrainCapacity.
*/
(function (root) {
  'use strict';

  // ---------- Internal tables ----------

  // Factors are *relative to corn*.
  // 1.00 = same as rated corn bu.
  // 0.93 = 100k corn bu bin ≈ 93k bu of that crop, etc.
  const FACTORS = {
    corn: 1.00,
    soybeans: 0.93,
    wheat: 1.07,
    milo: 1.02,
    oats: 0.78
  };

  // Nice labels for UI dropdowns, if needed.
  const LABELS = {
    corn: 'Corn (baseline)',
    soybeans: 'Soybeans',
    wheat: 'Wheat',
    milo: 'Milo / Grain Sorghum',
    oats: 'Oats'
  };

  // Aliases so users can pass “beans”, “sb”, etc.
  const ALIASES = {
    corn: 'corn',
    maize: 'corn',

    soybeans: 'soybeans',
    soybean: 'soybeans',
    beans: 'soybeans',
    sb: 'soybeans',

    wheat: 'wheat',
    hrw: 'wheat',
    srw: 'wheat',

    milo: 'milo',
    sorghum: 'milo',

    oats: 'oats'
  };

  function normalizeCropId(id) {
    if (!id) return 'corn';
    const key = String(id).trim().toLowerCase();
    return ALIASES[key] || key || 'corn';
  }

  function roundBushels(value, decimals) {
    if (typeof value !== 'number' || !isFinite(value)) return 0;
    if (decimals == null || decimals === false) return value;
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
  }

  // ---------- Public API ----------

  const api = {
    /**
     * Returns the factor for a crop relative to corn.
     * - 1.00  = same as rated corn capacity
     * - 0.93  = holds 93% as many bushels as corn
     * - 1.07  = holds 7% more bushels than corn
     *
     * @param {string} cropId  Crop id or alias ("corn", "soybeans", "beans", etc.)
     * @returns {number} factor (defaults to 1.0 for unknown crops)
     */
    getFactor(cropId) {
      const id = normalizeCropId(cropId);
      return FACTORS[id] != null ? FACTORS[id] : 1.0;
    },

    /**
     * Convert a rated CORN capacity into effective bushels for a given crop.
     *
     * @param {number} cornBushels   Rated capacity in corn bushels.
     * @param {string} cropId        Target crop id or alias.
     * @param {object} [opts]
     * @param {boolean|number} [opts.round=false]
     *        - false / undefined → no rounding
     *        - true              → round to whole bushels
     *        - number            → number of decimal places
     * @returns {number}
     */
    capacityForCrop(cornBushels, cropId, opts) {
      const factor = api.getFactor(cropId);
      const raw = (Number(cornBushels) || 0) * factor;
      const decimals = opts && opts.round === true ? 0 : opts && typeof opts.round === 'number' ? opts.round : false;
      return roundBushels(raw, decimals);
    },

    /**
     * Given bushels of a specific crop, return the equivalent rated corn capacity.
     * Useful when you only know “beans” but want to back into the corn-bu rating.
     *
     * @param {number} cropBushels   Bushels of the given crop.
     * @param {string} cropId        Crop id or alias.
     * @param {object} [opts]
     * @param {boolean|number} [opts.round=false]  Same behavior as capacityForCrop.
     * @returns {number}
     */
    cornCapacityFromCrop(cropBushels, cropId, opts) {
      const factor = api.getFactor(cropId) || 1.0;
      const raw = factor ? (Number(cropBushels) || 0) / factor : 0;
      const decimals = opts && opts.round === true ? 0 : opts && typeof opts.round === 'number' ? opts.round : false;
      return roundBushels(raw, decimals);
    },

    /**
     * Return an array of crop configs for UI dropdowns.
     * Each entry: { id, label, factor }
     */
    listCrops() {
      return Object.keys(FACTORS).map(id => ({
        id,
        label: LABELS[id] || id,
        factor: FACTORS[id]
      }));
    },

    /**
     * Override or add a factor for a crop.
     * Example:
     *   FVGrainCapacity.setFactor('sunflowers', 0.85);
     */
    setFactor(cropId, factor) {
      const id = normalizeCropId(cropId);
      if (!id) return;
      FACTORS[id] = Number(factor) || 0;
      if (!LABELS[id]) LABELS[id] = id.charAt(0).toUpperCase() + id.slice(1);
    },

    /**
     * Expose raw tables (read-only copies) for debugging or advanced UI.
     */
    getAllFactors() {
      return Object.assign({}, FACTORS);
    },
    getAllLabels() {
      return Object.assign({}, LABELS);
    }
  };

  // Attach to global
  const g = (typeof root !== 'undefined') ? root : (typeof window !== 'undefined' ? window : this);
  g.FVGrainCapacity = api;

})(typeof globalThis !== 'undefined' ? globalThis : this);