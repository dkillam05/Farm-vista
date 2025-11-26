/* =======================================================================
/Farm-vista/js/fv-yield-math.js
Rev: 2025-11-26a

Shared yield-math helpers for FarmVista.

Goals:
- Single source of truth for "true shrink" yield math.
- Trials page can dry corn to 15.0% and beans to 13.0%.
- Combine Yield calculator can keep using 15.5% corn standard.

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
 * Core "true shrink" yield calculation.
 *
 * 1. Take wet weight @ wet moisture.
 * 2. Convert to dry matter.
 * 3. Re-hydrate to standard moisture.
 * 4. Convert to bushels (test weight).
 * 5. Divide by acres for bu/ac.
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

  if (!(W > 0 && A > 0) || Number.isNaN(M)) {
    return null;
  }

  // Clamp moisture to a sane range just to avoid wild math
  const mClamped = Math.min(Math.max(M, 0), 60);

  // Dry matter (lb) at 0% moisture
  const dryMatter = W * (100 - mClamped) / 100;

  // Pounds at the chosen standard moisture
  const stdWetPounds = dryMatter / (1 - stdMoist / 100);

  // Bushels & yield
  const bushels = stdWetPounds / tw;
  const yieldBuAc = bushels / A;

  return {
    cropKind: kind,
    testWeight: tw,
    stdMoist,          // actual standard used
    wetWeightLbs: W,
    wetMoisturePct: mClamped,
    acres: A,
    bushels,
    yieldBuAc
  };
}
