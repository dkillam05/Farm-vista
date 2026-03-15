/* =====================================================================
/Farm-vista/js/rainfallmap/ui.js   (FULL FILE)
Rev: 2026-03-15b-force-rain-reload-on-date-change

PURPOSE
✔ Wires hamburger menu UI
✔ Handles map mode, map style, blend radius, refresh buttons
✔ Keeps menu open while interacting with controls
✔ Reacts to date-range picker events

FIX IN THIS REV
✔ Date-range Apply now forces rainfall reload
✔ Date-range Clear now forces rainfall reload
✔ Radius changes also force rainfall redraw
✔ File clearly labeled at top

DANE NOTE
When the user changes the rainfall time frame, blob dots and tap popups
must reflect the new selected dates immediately without requiring manual reload.
===================================================================== */

import { appState } from './store.js';
import { $, setModeText, setModeChip } from './dom.js';
import { renderActiveMode, renderRain } from './render-flow.js';
import { updateMapStyle } from './map-core.js';
import { updateReadinessLegend, updateRainLegend, buildRainScale } from './legend.js';
import { saveCurrentMapModeToLocal } from './view-mode.js';
import { syncCurrentRangeFromPicker, applyDefault72HourRangeToPicker } from './date-range.js';

export function applyMapModeUi(){
  const isReadiness = appState.currentMapMode === 'readiness';

  const sel = $('mapModeSel');
  if (sel) sel.value = isReadiness ? 'readiness' : 'rainfall';

  const rainModeSection = $('rainModeSection');
  const readinessModeSection = $('readinessModeSection');

  if (rainModeSection) rainModeSection.hidden = isReadiness;
  if (readinessModeSection) readinessModeSection.hidden = !isReadiness;

  if (isReadiness){
    updateReadinessLegend();
  } else if (appState.lastScaleMeta){
    updateRainLegend(appState.lastScaleMeta);
  } else {
    updateRainLegend(buildRainScale([0]));
  }

  setModeText(isReadiness ? 'Readiness' : 'Rainfall');
  setModeChip(isReadiness ? 'Readiness Map' : 'Rainfall Map');
}

export function wireUi(){
  if (appState.hasWiredUi) return;
  appState.hasWiredUi = true;

  const btnMenu = $('btnMenu');
  const menuPanel = $('menuPanel');
  const calendarPopover = $('calendarPopover');
  const jobRangeInput = $('jobRangeInput');
  const monthSelect = $('monthSelect');
  const yearSelect = $('yearSelect');
  const clearRangeBtn = $('clearRangeBtn');
  const applyRangeBtn = $('applyRangeBtn');
  const closeCalBtn = $('closeCalBtn');
  const calDays = $('calDays');
  const mapModeSel = $('mapModeSel');
  const viewSel = $('viewSel');
  const radiusSel = $('radiusSel');
  const btnRefreshRain = $('btnRefreshRain');
  const btnRefreshReadiness = $('btnRefreshReadiness');

  const keepMenuOpen = (e)=>{
    if (!e) return;
    e.stopPropagation();
  };

  const interactiveControls = [
    btnMenu,
    menuPanel,
    calendarPopover,
    jobRangeInput,
    monthSelect,
    yearSelect,
    clearRangeBtn,
    applyRangeBtn,
    closeCalBtn,
    calDays,
    mapModeSel,
    viewSel,
    radiusSel,
    btnRefreshRain,
    btnRefreshReadiness
  ].filter(Boolean);

  interactiveControls.forEach(el=>{
    el.addEventListener('pointerdown', keepMenuOpen);
    el.addEventListener('mousedown', keepMenuOpen);
    el.addEventListener('touchstart', keepMenuOpen, { passive:true });
    el.addEventListener('click', keepMenuOpen);
  });

  if (btnMenu && menuPanel){
    btnMenu.addEventListener('click', (e)=>{
      e.preventDefault();
      e.stopPropagation();
      menuPanel.classList.toggle('open');
    });

    document.addEventListener('pointerdown', (e)=>{
      if (!menuPanel.classList.contains('open')) return;

      const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
      const clickedInsideMenu = path.includes(menuPanel);
      const clickedMenuButton = path.includes(btnMenu);
      const clickedCalendar = calendarPopover ? path.includes(calendarPopover) : false;

      if (clickedInsideMenu || clickedMenuButton || clickedCalendar) return;
      menuPanel.classList.remove('open');
    });
  }

  if (jobRangeInput){
    jobRangeInput.addEventListener('focus', ()=>{
      try{ jobRangeInput.blur(); }catch(_){}
    });
  }

  if (btnRefreshRain){
    btnRefreshRain.addEventListener('click', ()=>{
      appState.currentMapMode = 'rainfall';
      saveCurrentMapModeToLocal();
      applyMapModeUi();
      renderActiveMode(true);
    });
  }

  if (btnRefreshReadiness){
    btnRefreshReadiness.addEventListener('click', ()=>{
      appState.currentMapMode = 'readiness';
      saveCurrentMapModeToLocal();
      applyMapModeUi();
      renderActiveMode(true);
    });
  }

  if (mapModeSel){
    mapModeSel.addEventListener('change', async (e)=>{
      appState.currentMapMode = String(e && e.target && e.target.value || 'rainfall');
      saveCurrentMapModeToLocal();
      applyMapModeUi();
      await renderActiveMode(false);
    });
  }

  if (viewSel){
    viewSel.addEventListener('change', ()=>{
      updateMapStyle();
    });
  }

  if (radiusSel){
    radiusSel.addEventListener('change', ()=>{
      if (appState.currentMapMode === 'rainfall'){
        renderRain(true);
      }
    });
  }

  document.addEventListener('fv:date-range-applied', ()=>{
    syncCurrentRangeFromPicker(true);

    if (appState.currentMapMode === 'rainfall'){
      renderRain(true);
    }
  });

  document.addEventListener('fv:date-range-cleared', ()=>{
    applyDefault72HourRangeToPicker({ silent:true });
    syncCurrentRangeFromPicker(true);

    if (appState.currentMapMode === 'rainfall'){
      renderRain(true);
    }
  });
}
