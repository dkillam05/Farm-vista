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

  $('rainModeSection').hidden = isReadiness;
  $('readinessModeSection').hidden = !isReadiness;

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

  const keepMenuOpen = (e)=>{
    if (!e) return;
    e.stopPropagation();
  };

  const interactiveControls = [
    $('btnMenu'),
    $('menuPanel'),
    $('calendarPopover'),
    $('jobRangeInput'),
    $('monthSelect'),
    $('yearSelect'),
    $('clearRangeBtn'),
    $('applyRangeBtn'),
    $('closeCalBtn'),
    $('calDays'),
    $('mapModeSel'),
    $('viewSel'),
    $('radiusSel'),
    $('btnRefreshRain'),
    $('btnRefreshReadiness')
  ].filter(Boolean);

  interactiveControls.forEach(el=>{
    el.addEventListener('pointerdown', keepMenuOpen);
    el.addEventListener('mousedown', keepMenuOpen);
    el.addEventListener('touchstart', keepMenuOpen, { passive:true });
    el.addEventListener('click', keepMenuOpen);
  });

  if (btnMenu && menuPanel){
    btnMenu.addEventListener('click', ()=>{
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

  $('jobRangeInput')?.addEventListener('focus', ()=>{
    try{ $('jobRangeInput').blur(); }catch(_){}
  });

  $('btnRefreshRain')?.addEventListener('click', ()=>{
    appState.currentMapMode = 'rainfall';
    saveCurrentMapModeToLocal();
    applyMapModeUi();
    renderActiveMode(true);
  });

  $('btnRefreshReadiness')?.addEventListener('click', ()=>{
    appState.currentMapMode = 'readiness';
    saveCurrentMapModeToLocal();
    applyMapModeUi();
    renderActiveMode(true);
  });

  $('mapModeSel')?.addEventListener('change', async (e)=>{
    appState.currentMapMode = String(e && e.target && e.target.value || 'rainfall');
    saveCurrentMapModeToLocal();
    applyMapModeUi();
    await renderActiveMode(false);
  });

  $('viewSel')?.addEventListener('change', ()=>{
    updateMapStyle();
  });

  $('radiusSel')?.addEventListener('change', ()=>{
    if (appState.currentMapMode === 'rainfall'){
      renderRain(false);
    }
  });

  document.addEventListener('fv:date-range-applied', ()=>{
    syncCurrentRangeFromPicker(true);
    if (appState.currentMapMode === 'rainfall'){
      renderRain(false);
    }
  });

  document.addEventListener('fv:date-range-cleared', ()=>{
    applyDefault72HourRangeToPicker({ silent:true });
    syncCurrentRangeFromPicker(true);
    if (appState.currentMapMode === 'rainfall'){
      renderRain(false);
    }
  });
}
