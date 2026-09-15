import { appState } from './store.js';

export function cacheRangeResult(cacheKey, data){
  appState.rangeCache.set(cacheKey, {
    ts: Date.now(),
    data
  });
}

export function getCachedRangeResult(cacheKey){
  const hit = appState.rangeCache.get(cacheKey);
  if (!hit) return null;
  if ((Date.now() - hit.ts) > (5 * 60 * 1000)) return null;
  return hit.data;
}
