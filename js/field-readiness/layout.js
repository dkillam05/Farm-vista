/* =====================================================================
/Farm-vista/js/field-readiness/layout.js  (FULL FILE)
Rev: 2025-12-26a

Fixes intermittent bottom clipping (last tile / Details summary hidden)
caused by fv-shell footer height loading late.

Approach:
- Injects a bottom spacer div at end of the page content
- Measures actual footer height (best-effort) and keeps spacer sized
- Works even if footer loads late or changes size (ResizeObserver)
===================================================================== */
'use strict';

function $(sel, root=document){ try { return root.querySelector(sel); } catch { return null; } }

function findFooterEl(){
  // best-effort selectors across shells
  return (
    document.querySelector('[data-fv-footer]') ||
    document.querySelector('.fv-footer') ||
    document.querySelector('footer') ||
    null
  );
}

function ensureSpacer(){
  let spacer = document.getElementById('frBottomSpacer');
  if (spacer) return spacer;

  // Put spacer near the bottom of the page body so it always adds scroll room
  const host =
    document.querySelector('.wrap') ||
    document.querySelector('fv-shell') ||
    document.body;

  spacer = document.createElement('div');
  spacer.id = 'frBottomSpacer';
  spacer.style.height = '220px'; // default until measured
  spacer.style.pointerEvents = 'none';
  spacer.style.userSelect = 'none';
  spacer.style.background = 'transparent';

  host.appendChild(spacer);
  return spacer;
}

function setSpacerHeight(spacer, footerH){
  // Extra breathing room beyond footer
  const EXTRA = 140; // px (enough to fully show last tile + Details)
  const safe = (()=> {
    try{
      // safe-area inset bottom if available
      const v = getComputedStyle(document.documentElement).getPropertyValue('env(safe-area-inset-bottom)');
      // env() isn't readable reliably; just add a small fixed pad
      return 18;
    }catch{ return 18; }
  })();

  const h = Math.max(120, Math.round((footerH || 0) + EXTRA + safe));
  spacer.style.height = `${h}px`;
}

function measureFooterHeight(){
  // If fv-shell exposes a CSS var, use it
  try{
    const v = getComputedStyle(document.documentElement).getPropertyValue('--ftr-h');
    const n = Number(String(v||'').replace('px','').trim());
    if (Number.isFinite(n) && n > 0) return n;
  }catch(_){}

  // Else attempt DOM footer element
  const footer = findFooterEl();
  if (footer){
    const r = footer.getBoundingClientRect();
    if (r && r.height) return r.height;
  }

  // Fallback
  return 42;
}

export function initLayoutFix(){
  const spacer = ensureSpacer();

  // Initial set (even before shell loads)
  setSpacerHeight(spacer, measureFooterHeight());

  // Re-measure after layout settles
  const kick = ()=> setSpacerHeight(spacer, measureFooterHeight());
  requestAnimationFrame(()=> requestAnimationFrame(kick));
  window.addEventListener('load', kick, { once:true });
  window.addEventListener('resize', kick);

  // Watch footer if we can find one now
  const footer = findFooterEl();
  if (footer && window.ResizeObserver){
    try{
      const ro = new ResizeObserver(()=> kick());
      ro.observe(footer);
    }catch(_){}
  }

  // Watch for footer appearing later (fv-shell late render)
  if (window.MutationObserver){
    try{
      const mo = new MutationObserver(()=>{
        const f = findFooterEl();
        if (f && window.ResizeObserver){
          try{
            const ro = new ResizeObserver(()=> kick());
            ro.observe(f);
          }catch(_){}
        }
        kick();
      });
      mo.observe(document.body, { childList:true, subtree:true });
      // stop watching after a bit (avoid forever observers)
      setTimeout(()=>{ try{ mo.disconnect(); }catch(_){ } }, 8000);
    }catch(_){}
  }
}
