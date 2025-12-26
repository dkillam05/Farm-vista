/* =====================================================================
/Farm-vista/js/field-readiness/utils.js  (FULL FILE)
Rev: 2025-12-26a
Shared tiny helpers only.
===================================================================== */
'use strict';

export const $ = (id)=>document.getElementById(id);

export const clamp = (v, lo, hi)=> Math.max(lo, Math.min(hi, v));

export const round = (v, d=2)=>{
  const p = Math.pow(10,d);
  return Math.round(Number(v||0)*p)/p;
};

export function esc(s){
  return String(s||'')
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'","&#039;");
}

export function setErr(msg){
  const el = $('err');
  if (!el) return;
  if (!msg){ el.hidden = true; el.textContent=''; return; }
  el.hidden = false;
  el.textContent = msg;
}

export function normalizeStatus(s){ return String(s||'').trim().toLowerCase(); }

export async function waitForEl(id, timeoutMs=2000){
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs){
    const el = document.getElementById(id);
    if (el) return el;
    await new Promise(r=>requestAnimationFrame(r));
  }
  return null;
}
