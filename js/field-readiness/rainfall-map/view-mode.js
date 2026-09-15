import { LS_MODE_KEY } from './config.js';
import { appState } from './store.js';

export function saveCurrentMapModeToLocal(){
  try{
    localStorage.setItem(LS_MODE_KEY, String(appState.currentMapMode || 'rainfall'));
  }catch(_){}
}

export function restoreCurrentMapModeFromLocal(){
  try{
    const raw = String(localStorage.getItem(LS_MODE_KEY) || '').trim().toLowerCase();
    if (raw === 'readiness') return 'readiness';
  }catch(_){}
  return 'rainfall';
}
