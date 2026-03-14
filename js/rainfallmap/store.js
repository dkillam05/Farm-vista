/* ======================================================================
   /Farm-vista/js/rainfallmap/store.js
   FULL FILE REBUILD
   FIX GOAL:
   - make rainfall-map readiness use a REAL field-readiness state object
   - stop using a hand-made partial readiness state shape
====================================================================== */

import { createState } from '/Farm-vista/js/field-readiness/state.js';

function createRainMapReadinessState(){
  const state = createState();

  // keep a few caches/fields the map code expects
  state.selectedFieldId = '';
  state.persistedStateByFieldId = {};
  state._persistLoadedAt = 0;

  state.paramMetaByFieldId = new Map();

  state._frModelWxCache = new Map();
  state._frForecastCache = new Map();
  state._frForecastMetaByFieldId = new Map();

  state._mrmsDocByFieldId = new Map();
  state._mrmsDocLoadedAtByFieldId = new Map();

  return state;
}

export const appState = {
  map: null,
  infoWindow: null,
  currentRangeKey: 'last72h',
  currentRangeStartISO: '',
  currentRangeEndISO: '',
  currentRequestId: 0,
  dbRef: null,
  authRef: null,
  hasWiredUi: false,
  startRequested: false,
  startFinished: false,
  currentMapMode: 'rainfall',

  mrmsCache: { loadedAt: 0, data: [] },
  fieldsCache: { loadedAt: 0, data: [] },
  farmsCache: { loadedAt: 0, data: [] },

  mapCircles: [],
  fieldMarkers: [],

  lastFieldSummaries: [],
  lastTapTargets: [],
  lastRenderedFields: [],
  lastScaleMeta: null,

  rangeCache: new Map(),

  // IMPORTANT: use the same base state shape as field readiness
  readinessState: createRainMapReadinessState()
};
