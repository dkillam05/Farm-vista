/* FarmVista — Grain Contracts hauling-job filter combo anchoring
   Sept. 16, 2026
   Keep the Hauling Jobs table filter menus attached to the box that opened them.
*/
(() => {
  'use strict';

  if (window.__FV_GRAIN_CONTRACTS_FILTER_COMBO_ANCHOR_20260916) return;
  window.__FV_GRAIN_CONTRACTS_FILTER_COMBO_ANCHOR_20260916 = true;

  const FILTER_GRID_SELECTOR = '.filter-grid';
  let activeCombo = null;
  let frame = 0;

  function installStyles() {
    if (document.getElementById('fv-grain-contracts-filter-combo-anchor-style')) return;
    const style = document.createElement('style');
    style.id = 'fv-grain-contracts-filter-combo-anchor-style';
    style.textContent = `
      ${FILTER_GRID_SELECTOR} .fv-combo{
        position:relative!important;
        overflow:visible!important;
      }
      ${FILTER_GRID_SELECTOR} .fv-combo > .fv-panel.fv-filter-local-panel{
        position:absolute!important;
        top:calc(100% + 4px)!important;
        left:0!important;
        right:auto!important;
        bottom:auto!important;
        width:100%!important;
        min-width:100%!important;
        max-width:max(100%, 320px)!important;
        margin:0!important;
        transform:none!important;
        translate:none!important;
        z-index:1200!important;
        max-height:min(50vh, 360px)!important;
        overflow:hidden!important;
      }
      ${FILTER_GRID_SELECTOR} .fv-combo > .fv-panel.fv-filter-local-panel .fv-list{
        max-height:min(44vh, 320px)!important;
        overflow-y:auto!important;
        overflow-x:hidden!important;
        -webkit-overflow-scrolling:touch!important;
        overscroll-behavior:contain!important;
      }
    `;
    document.head.appendChild(style);
  }

  function localizeOpenPanel() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!activeCombo?.isConnected) return;

      const visiblePanels = Array.from(document.querySelectorAll('.fv-panel.show'));
      const panel = visiblePanels[visiblePanels.length - 1];
      if (!panel) return;

      if (panel.parentElement !== activeCombo) activeCombo.appendChild(panel);
      panel.classList.add('fv-filter-local-panel');

      ['inset','top','right','bottom','left','width','min-width','max-width','margin','transform','translate','position','visibility','z-index','max-height']
        .forEach(prop => panel.style.removeProperty(prop));

      panel.style.setProperty('position', 'absolute', 'important');
      panel.style.setProperty('top', 'calc(100% + 4px)', 'important');
      panel.style.setProperty('left', '0', 'important');
      panel.style.setProperty('right', 'auto', 'important');
      panel.style.setProperty('bottom', 'auto', 'important');
      panel.style.setProperty('width', '100%', 'important');
      panel.style.setProperty('min-width', '100%', 'important');
      panel.style.setProperty('max-width', 'max(100%, 320px)', 'important');
      panel.style.setProperty('margin', '0', 'important');
      panel.style.setProperty('transform', 'none', 'important');
      panel.style.setProperty('translate', 'none', 'important');
      panel.style.setProperty('z-index', '1200', 'important');
      panel.style.setProperty('visibility', 'visible', 'important');
    });
  }

  function rememberFilterCombo(event) {
    const button = event.target.closest?.(`${FILTER_GRID_SELECTOR} .fv-buttonish`);
    if (!button) return;
    const combo = button.closest('.fv-combo');
    if (!combo) return;
    activeCombo = combo;
    queueMicrotask(localizeOpenPanel);
    setTimeout(localizeOpenPanel, 0);
    setTimeout(localizeOpenPanel, 20);
    setTimeout(localizeOpenPanel, 70);
  }

  function start() {
    installStyles();
    document.addEventListener('pointerdown', rememberFilterCombo, true);
    document.addEventListener('click', rememberFilterCombo, true);

    new MutationObserver(() => {
      if (activeCombo) localizeOpenPanel();
    }).observe(document.body, {
      childList:true,
      subtree:true,
      attributes:true,
      attributeFilter:['class']
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();
})();
