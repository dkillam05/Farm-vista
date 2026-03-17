/* =====================================================================
/Farm-vista/js/rainfallmap/ui.js   (FULL FILE)
Rev: 2026-03-17b-force-native-select-sync

PURPOSE
✔ Wires hamburger menu UI
✔ Handles map mode, map style, blend radius, refresh buttons
✔ Keeps menu open while interacting with controls
✔ Reacts to date-range picker events

FIX IN THIS REV
✔ Force-syncs native map-mode select using value + selectedIndex + option.selected
✔ Re-syncs again when hamburger opens
✔ Keeps dropdown/menu text synced to actual map mode
✔ Keeps last-used mode restore support
✔ Prevents iPhone/Safari stale select display issues
===================================================================== */

import { appState } from './store.js';
import { $, setModeText, setModeChip } from './dom.js';
import { renderActiveMode, renderRain } from './render-flow.js';
import { updateMapStyle } from './map-core.js';
import { updateReadinessLegend, updateRainLegend, buildRainScale } from './legend.js';
import {
  saveCurrentMapModeToLocal,
  restoreCurrentMapModeFromLocal
} from './view-mode.js';
import {
  syncCurrentRangeFromPicker,
  applyDefault72HourRangeToPicker
} from './date-range.js';

function normalizeMapMode(mode){
  return String(mode || '').toLowerCase() === 'readiness' ? 'readiness' : 'rainfall';
}

function forceSyncMapModeSelect(){
  const sel = $('mapModeSel');
  if (!sel) return;

  const desired = normalizeMapMode(appState.currentMapMode);
  const options = Array.from(sel.options || []);
  const idx = Math.max(
    0,
    options.findIndex(opt => String(opt.value || '').toLowerCase() === desired)
  );

  options.forEach((opt, i)=>{
    const isSelected = i === idx;
    opt.selected = isSelected;
    if (isSelected) opt.setAttribute('selected', 'selected');
    else opt.removeAttribute('selected');
  });

  sel.selectedIndex = idx;
  sel.value = options[idx] ? options[idx].value : desired;

  // extra nudge for iPhone/Safari native select paint
  sel.setAttribute('data-current-mode', desired);
  void sel.offsetHeight;
}

export function applyMapModeUi(){
  appState.currentMapMode = normalizeMapMode(appState.currentMapMode);
  const isReadiness = appState.currentMapMode === 'readiness';

  forceSyncMapModeSelect();

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

async function setMapMode(nextMode, forceRender = false){
  appState.currentMapMode = normalizeMapMode(nextMode);
  saveCurrentMapModeToLocal();

  applyMapModeUi();
  await renderActiveMode(!!forceRender);
  applyMapModeUi();
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

  appState.currentMapMode = normalizeMapMode(
    restoreCurrentMapModeFromLocal() || appState.currentMapMode
  );
  applyMapModeUi();

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

      // force sync again when panel opens
      if (menuPanel.classList.contains('open')){
        applyMapModeUi();
        requestAnimationFrame(()=> applyMapModeUi());
      }
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
    btnRefreshRain.addEventListener('click', async ()=>{
      await setMapMode('rainfall', true);
    });
  }

  if (btnRefreshReadiness){
    btnRefreshReadiness.addEventListener('click', async ()=>{
      await setMapMode('readiness', true);
    });
  }

  if (mapModeSel){
    mapModeSel.addEventListener('change', async (e)=>{
      const nextMode = e && e.target && e.target.value;
      await setMapMode(nextMode, false);
    });
  }

  if (viewSel){
    viewSel.addEventListener('change', ()=>{
      updateMapStyle();
    });
  }

  if (radiusSel){
    radiusSel.addEventListener('change', ()=>{
      if (normalizeMapMode(appState.currentMapMode) === 'rainfall'){
        renderRain(true);
      }
    });
  }

  document.addEventListener('fv:date-range-applied', ()=>{
    syncCurrentRangeFromPicker(true);

    if (normalizeMapMode(appState.currentMapMode) === 'rainfall'){
      renderRain(true);
    }
  });

  document.addEventListener('fv:date-range-cleared', ()=>{
    applyDefault72HourRangeToPicker({ silent:true });
    syncCurrentRangeFromPicker(true);

    if (normalizeMapMode(appState.currentMapMode) === 'rainfall'){
      renderRain(true);
    }
  });

  queueMicrotask(()=>{
    applyMapModeUi();
  });

  requestAnimationFrame(()=>{
    applyMapModeUi();
  });

  window.addEventListener('pageshow', ()=>{
    appState.currentMapMode = normalizeMapMode(
      restoreCurrentMapModeFromLocal() || appState.currentMapMode
    );
    applyMapModeUi();
  });
}