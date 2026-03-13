import { $, } from './dom.js';
import {
  RAIN_GUARDRAIL_ZERO_MAX,
  RAIN_GUARDRAIL_LIFT_MIN,
  RAIN_GUARDRAIL_SPREAD_MIN
} from './config.js';
import { clamp } from './utils.js';

export function buildRainScale(values){
  const cleaned = (Array.isArray(values) ? values : [])
    .map(v => Number(v))
    .filter(v => Number.isFinite(v) && v >= 0);

  const maxInches = cleaned.length ? Math.max(...cleaned) : 0;
  const minInches = cleaned.length ? Math.min(...cleaned) : 0;

  const stops = [
    { t:0.00, c:[88,168,255] },
    { t:0.16, c:[108,199,255] },
    { t:0.34, c:[99,223,137] },
    { t:0.52, c:[73,201,74] },
    { t:0.70, c:[215,223,73] },
    { t:0.84, c:[240,184,67] },
    { t:0.94, c:[239,107,70] },
    { t:1.00, c:[217,44,198] }
  ];

  if (!cleaned.length || maxInches <= RAIN_GUARDRAIL_ZERO_MAX){
    return {
      name: 'trace',
      domainMin: 0,
      domainMax: Math.max(0.10, maxInches || 0.10),
      actualMin: minInches,
      actualMax: maxInches,
      usedDynamicFloor: false,
      stops
    };
  }

  const spread = maxInches - minInches;
  const canLiftFloor = (
    minInches >= RAIN_GUARDRAIL_LIFT_MIN &&
    spread >= RAIN_GUARDRAIL_SPREAD_MIN
  );

  const domainMin = canLiftFloor ? minInches : 0;
  const domainMax = Math.max(maxInches, domainMin + 0.10);

  return {
    name: canLiftFloor ? 'dynamic-floor' : 'zero-floor',
    domainMin,
    domainMax,
    actualMin: minInches,
    actualMax: maxInches,
    usedDynamicFloor: canLiftFloor,
    stops
  };
}

export function normalizeRainValueForScale(v, scale){
  const min = Number(scale.domainMin || 0);
  const max = Number(scale.domainMax || 1);
  if (!Number.isFinite(v)) return 0;
  if (!Number.isFinite(min) || !Number.isFinite(max) || Math.abs(max - min) < 0.0001) return 0.5;
  return clamp((v - min) / (max - min), 0, 1);
}

export function normalizeReadinessValue(v){
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return clamp(n / 100, 0, 1);
}

export function formatLegendValue(n){
  const v = Number(n || 0);
  if (v >= 10) return v.toFixed(0) + '"+';
  if (v >= 1) return v.toFixed(1) + '"';
  if (v >= 0.1) return v.toFixed(1).replace(/^0/, '') + '"';
  return v.toFixed(2).replace(/^0/, '') + '"';
}

export function formatReadinessValue(n){
  const v = Number(n || 0);
  return `${Math.round(v)}`;
}

export function setLegendMode(mode){
  const bar = $('legendBar');
  if (!bar) return;
  bar.classList.toggle('readiness', mode === 'readiness');
}

export function updateRainLegend(scale){
  setLegendMode('rainfall');

  const min = Number(scale.domainMin || 0);
  const max = Number(scale.domainMax || 1);

  const q5 = min + ((max - min) * 0.83);
  const q4 = min + ((max - min) * 0.68);
  const mid = min + ((max - min) * 0.50);
  const q2 = min + ((max - min) * 0.34);
  const q1 = min + ((max - min) * 0.18);

  $('legendTop').textContent = formatLegendValue(max);
  $('legendQ5').textContent = formatLegendValue(q5);
  $('legendQ4').textContent = formatLegendValue(q4);
  $('legendMid').textContent = formatLegendValue(mid);
  $('legendQ2').textContent = formatLegendValue(q2);
  $('legendQ1').textContent = formatLegendValue(q1);
  $('legendBottom').textContent = formatLegendValue(min);
}

export function updateReadinessLegend(){
  setLegendMode('readiness');
  $('legendTop').textContent = '100';
  $('legendQ5').textContent = '85';
  $('legendQ4').textContent = '70';
  $('legendMid').textContent = '50';
  $('legendQ2').textContent = '30';
  $('legendQ1').textContent = '15';
  $('legendBottom').textContent = '0';
}
