/* =====================================================================
/Farm-vista/js/field-readiness/readiness-core-shared.js
Shared readiness engine used by BOTH:

- Browser UI (render / quickview / map)
- Cloud Run backend snapshot

This file MUST contain only pure math.
===================================================================== */

'use strict';

function clamp(v, lo, hi){
  return Math.max(lo, Math.min(hi, v));
}

function num(v, d=0){
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

const LOSS_SCALE = 0.55;

const EXTRA = {
  DRYPWR_VPD_W: 0.06,
  DRYPWR_CLOUD_W: 0.04,
  LOSS_ET0_W: 0.08,
  ADD_SM010_W: 0.10
};

function calcDryParts(r){
  const temp = Number(r.tempF||0);
  const wind = Number(r.windMph||0);
  const rh   = Number(r.rh||0);
  const solar= Number(r.solarWm2||0);

  const tempN = clamp((temp - 20) / 45, 0, 1);
  const windN = clamp((wind - 2) / 20, 0, 1);
  const solarN= clamp((solar - 60) / 300, 0, 1);
  const rhN   = clamp((rh - 35) / 65, 0, 1);

  const rawBase = (0.35*tempN + 0.30*solarN + 0.25*windN - 0.25*rhN);
  let dryPwr = clamp(rawBase, 0, 1);

  const vpd = Number(r.vpdKpa);
  const cloud = Number(r.cloudPct);

  const vpdN = Number.isFinite(vpd) ? clamp(vpd/2.6,0,1) : 0;
  const cloudN = Number.isFinite(cloud) ? clamp(cloud/100,0,1) : 0;

  dryPwr = clamp(
    dryPwr +
    EXTRA.DRYPWR_VPD_W * vpdN -
    EXTRA.DRYPWR_CLOUD_W * cloudN,
    0,
    1
  );

  return { dryPwr };
}

function mapFactors(soilWetness, drainageIndex){

  const soilHold = clamp(num(soilWetness)/100,0,1);
  const drainPoor= clamp(num(drainageIndex)/100,0,1);

  const infilMult = 0.60 + 0.30*soilHold + 0.35*drainPoor;
  const dryMult   = 1.20 - 0.35*soilHold - 0.40*drainPoor;

  const Smax = clamp(3 + soilHold + drainPoor,3,5);

  return { infilMult, dryMult, Smax };
}

export function runFieldReadinessCore(rows, soilWetness, drainageIndex, persistedState){

  if(!Array.isArray(rows) || !rows.length) return null;

  const last = rows[rows.length-1];
  const f = mapFactors(soilWetness, drainageIndex);

  let storage;

  if(
    persistedState &&
    Number.isFinite(Number(persistedState.storageFinal))
  ){
    storage = persistedState.storageFinal;
  }
  else{
    storage = 0.3 * f.Smax;
  }

  for(const r of rows){

    const rain = num(r.rainInAdj || r.rainIn);

    const { dryPwr } = calcDryParts(r);

    const et0N = clamp(num(r.et0In)/0.30,0,1);

    const addRain = rain * f.infilMult;

    const add = addRain;

    const loss =
      dryPwr *
      LOSS_SCALE *
      f.dryMult *
      (1 + EXTRA.LOSS_ET0_W * et0N);

    storage = clamp(storage + add - loss,0,f.Smax);
  }

  const wetness = clamp((storage / f.Smax) * 100,0,100);
  const readiness = Math.round(100 - wetness);

  return {
    readiness,
    wetness,
    storageFinal: storage
  };
}