/* =======================================================================
/Farm-vista/js/fv-yield-math.js
Rev: 2025-11-26b

Shared yield-math helpers for FarmVista.

Goals:
- Single source of truth for "true shrink" yield math.
- Trials page can dry corn to 15.0% and beans to 13.0%.
- Combine Yield calculator can keep using 15.5% corn standard.
- IMPORTANT: Going drier than the standard DOES NOT increase yield
  (no "over-dry credit"). Anything under the target moisture is treated
  as the standard in the math so bushels never inflate.

Usage example (trials page):

  import { calcTrueYield } from '/Farm-vista/js/fv-yield-math.js';

  const res = calcTrueYield({
    cropKind: 'corn',          // 'corn' | 'soy' | 'other'
    wetWeightLbs: 52000,       // pounds of grain
    wetMoisturePct: 19.2,      // wet moisture %
    acres: 4.37,               // acres in the block
    stdMoistOverride: 15       // OPTIONAL; trials page uses 15 for corn
  });

  if (res) {
    console.log(res.yieldBuAc);   // bu/ac
    console.log(res.bushels);     // total bu
  }

======================================================================= */

export const CROP_CONFIG = {
  corn: {
    testWeight: 56,   // lb/bu
    stdMoist: 15.5    // "book" standard for the main calculator
  },
  soy: {
    testWeight: 60,
    stdMoist: 13.0
  },
  other: {
    testWeight: 56,
    stdMoist: 15.0
  }
};

/**
 * Normalize a crop string to 'corn' | 'soy' | 'other'.
 */
export function normalizeCropKind(raw) {
  const c = String(raw || '').toLowerCase();
  if (c.includes('soy')) return 'soy';
  if (c.includes('corn')) return 'corn';
  return 'other';
}

/**
 * Core "true shrink" yield calculation with NO over-dry credit.
 *
 * 1. Take wet weight @ wet moisture.
 * 2. Clamp moisture to [0, 60].
 * 3. If moisture is below standard, treat it AS the standard in the math
 *    so you never gain yield just by being too dry.
 * 4. Convert to dry matter using that effective moisture.
 * 5. Re-hydrate to standard moisture.
 * 6. Convert to bushels (test weight).
 * 7. Divide by acres for bu/ac.
 *
 * Returns null if any inputs are missing/invalid.
 */
export function calcTrueYield({
  cropKind,
  wetWeightLbs,
  wetMoisturePct,
  acres,
  stdMoistOverride
}) {
  const kind = normalizeCropKind(cropKind);
  const cfg = CROP_CONFIG[kind] || CROP_CONFIG.other;

  const tw = Number(cfg.testWeight);
  const stdMoist = typeof stdMoistOverride === 'number' && !Number.isNaN(stdMoistOverride)
    ? stdMoistOverride
    : Number(cfg.stdMoist);

  const W = Number(wetWeightLbs);
  const M = Number(wetMoisturePct);
  const A = Number(acres);

  // Basic guards
  if (!(W > 0 && A > 0) || Number.isNaN(M) || Number.isNaN(stdMoist)) {
    return null;
  }
  if (stdMoist < 0 || stdMoist > 60) {
    return null;
  }

  // Clamp actual input moisture to a sane range
  const mClamped = Math.min(Math.max(M, 0), 60);

  // 🚫 NO OVER-DRY CREDIT:
  // If actual moisture is BELOW the chosen standard, we use the STANDARD
  // in the math so yield cannot increase just because grain is drier.
  const mUsed = Math.max(mClamped, stdMoist);

  // Dry matter (lb) at 0% moisture, using the effective moisture
  const dryMatter = W * (100 - mUsed) / 100;

  // Pounds at the chosen standard moisture
  const stdWetPounds = dryMatter / (1 - stdMoist / 100);

  // Bushels & yield
  const bushels = stdWetPounds / tw;
  const yieldBuAc = bushels / A;

  return {
    cropKind: kind,
    testWeight: tw,
    stdMoist,              // standard moisture actually used
    wetWeightLbs: W,
    wetMoisturePct: mClamped,   // actual (clamped) input moisture
    effectiveMoistPct: mUsed,   // moisture used in the math (>= stdMoist)
    acres: A,
    bushels,
    yieldBuAc
  };
}
