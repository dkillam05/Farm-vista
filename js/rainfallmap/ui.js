/* =====================================================================
/Farm-vista/js/rainfallmap/ui.js  (FULL FILE)
Rev: 2026-03-13a-debug-hamburger-menu-state

Purpose:
- Keep hamburger menu opening reliably
- Add full debug dump into #debugText from the menu
- Show UI wiring state, menu state, map mode, picker state, cache/meta basics
===================================================================== */

import { appState } from './store.js';
import { $, setModeText, setModeChip, setDebug } from './dom.js';
import { renderActiveMode, renderRain } from './render-flow.js';
import { updateMapStyle } from './map-core.js';
import { updateReadinessLegend, updateRainLegend, buildRainScale } from './legend.js';
import { saveCurrentMapModeToLocal } from './view-mode.js';
import { syncCurrentRangeFromPicker, applyDefault72HourRangeToPicker } from './date-range.js';

function safeBool(v){
  return v ? 'yes' : 'no';
}

function safeCount(v){
  return Number.isFinite(Number(v)) ? String(Number(v)) : '0';
}

function getPickerStateText(){
  try{
    const api = window.FVDateRangePicker;
    if (!api || typeof api.getRange !== 'function'){
      return 'picker=missing';
    }

    const r = api.getRange() || {};
    const startISO = String(r.startISO || '').trim() || 'none';
    const endISO = String(r.endISO || '').trim() || 'none';
    return `picker=${startISO}→${endISO}`;
  }catch(_){
    return 'picker=error';
  }
}

function buildFullDebugText(){
  const menuPanel = $('menuPanel');
  const mapModeSel = $('mapModeSel');
  const viewSel = $('viewSel');
  const radiusSel = $('radiusSel');
  const statusText = $('statusText');
  const fieldsText = $('fieldsText');
  const pointsText = $('pointsText');
  const rainModeSection = $('rainModeSection');
  const readinessModeSection = $('readinessModeSection');

  const parts = [
    `wired=${safeBool(appState.hasWiredUi)}`,
    `menuOpen=${safeBool(!!(menuPanel && menuPanel.classList.contains('open')))}`,
    `mode=${String(appState.currentMapMode || 'unknown')}`,
    `modeSel=${String(mapModeSel && mapModeSel.value || 'missing')}`,
    `view=${String(viewSel && viewSel.value || 'missing')}`,
    `radius=${String(radiusSel && radiusSel.value || 'n/a')}`,
    `status=${String(statusText && statusText.textContent || '').trim() || 'blank'}`,
    `fields=${String(fieldsText && fieldsText.textContent || '0').trim() || '0'}`,
    `points=${String(pointsText && pointsText.textContent || '0').trim() || '0'}`,
    `mapReady=${safeBool(!!appState.map)}`,
    `infoWindow=${safeBool(!!appState.infoWindow)}`,
    `reqId=${safeCount(appState.currentRequestId)}`,
    `summaries=${safeCount(appState.lastFieldSummaries && appState.lastFieldSummaries.length)}`,
    `rendered=${safeCount(appState.lastRenderedFields && appState.lastRenderedFields.length)}`,
    `tapTargets=${safeCount(appState.lastTapTargets && appState.lastTapTargets.length)}`,
    `circles=${safeCount(appState.mapCircles && appState.mapCircles.length)}`,
    `fieldsCache=${safeCount(appState.fieldsCache && appState.fieldsCache.data && appState.fieldsCache.data.length)}`,
    `mrmsCache=${safeCount(appState.mrmsCache && appState.mrmsCache.data && appState.mrmsCache.data.length)}`,
    `farmsCache=${safeCount(appState.farmsCache && appState.farmsCache.data && appState.farmsCache.data.length)}`,
    `rainSectionHidden=${safeBool(!!(rainModeSection && rainModeSection.hidden))}`,
    `readinessSectionHidden=${safeBool(!!(readinessModeSection && readinessModeSection.hidden))}`,
    `rangeKey=${String(appState.currentRangeKey || 'none')}`,
    `rangeStart=${String(appState.currentRangeStartISO || 'none')}`,
    `rangeEnd=${String(appState.currentRangeEndISO || 'none')}`,
    getPickerStateText()
  ];

  return parts.join(' • ');
}

export function refreshMenuDebug(){
  setDebug(buildFullDebugText());
}

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
  refreshMenuDebug();
}

export function wireUi(){
  if (appState.hasWiredUi){
    refreshMenuDebug();
    return;
  }
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
      refreshMenuDebug();
    });

    document.addEventListener('pointerdown', (e)=>{
      if (!menuPanel.classList.contains('open')) return;

      const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
      const clickedInsideMenu = path.includes(menuPanel);
      const clickedMenuButton = path.includes(btnMenu);
      const clickedCalendar = calendarPopover ? path.includes(calendarPopover) : false;

      if (clickedInsideMenu || clickedMenuButton || clickedCalendar) return;
      menuPanel.classList.remove('open');
      refreshMenuDebug();
    });
  }

  if (jobRangeInput){
    jobRangeInput.addEventListener('focus', ()=>{
      try{ jobRangeInput.blur(); }catch(_){}
      refreshMenuDebug();
    });
  }

  if (btnRefreshRain){
    btnRefreshRain.addEventListener('click', ()=>{
      appState.currentMapMode = 'rainfall';
      saveCurrentMapModeToLocal();
      applyMapModeUi();
      refreshMenuDebug();
      renderActiveMode(true);
    });
  }

  if (btnRefreshReadiness){
    btnRefreshReadiness.addEventListener('click', ()=>{
      appState.currentMapMode = 'readiness';
      saveCurrentMapModeToLocal();
      applyMapModeUi();
      refreshMenuDebug();
      renderActiveMode(true);
    });
  }

  if (mapModeSel){
    mapModeSel.addEventListener('change', async (e)=>{
      appState.currentMapMode = String(e && e.target && e.target.value || 'rainfall');
      saveCurrentMapModeToLocal();
      applyMapModeUi();
      refreshMenuDebug();
      await renderActiveMode(false);
      refreshMenuDebug();
    });
  }

  if (viewSel){
    viewSel.addEventListener('change', ()=>{
      updateMapStyle();
      refreshMenuDebug();
    });
  }

  if (radiusSel){
    radiusSel.addEventListener('change', ()=>{
      refreshMenuDebug();
      if (appState.currentMapMode === 'rainfall'){
        renderRain(false);
      }
    });
  }

  document.addEventListener('fv:date-range-applied', ()=>{
    syncCurrentRangeFromPicker(true);
    refreshMenuDebug();
    if (appState.currentMapMode === 'rainfall'){
      renderRain(false);
    }
  });

  document.addEventListener('fv:date-range-cleared', ()=>{
    applyDefault72HourRangeToPicker({ silent:true });
    syncCurrentRangeFromPicker(true);
    refreshMenuDebug();
    if (appState.currentMapMode === 'rainfall'){
      renderRain(false);
    }
  });

  refreshMenuDebug();
}