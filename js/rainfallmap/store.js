/* ======================================================================
   /Farm-vista/js/rainfallmap/store.js
   FULL FILE REBUILD
   Fix:
   - readinessState now matches the structure expected by
     field-readiness/state.js
   - adds missing weather caches required by buildWxCtx()
====================================================================== */

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

  /* ============================================================
     Field Readiness compatible state
  ============================================================ */
  readinessState: {

    fields: [],
    farmsById: new Map(),

    farmFilter: '__all__',
    selectedFieldId: '',

    persistedStateByFieldId: {},
    _persistLoadedAt: 0,

    /* modules loaded by formula.js */
    _mods: {},

    lastRuns: new Map(),

    /* MRMS */
    _mrmsDocByFieldId: new Map(),
    _mrmsDocLoadedAtByFieldId: new Map(),

    /* params */
    perFieldParams: new Map(),
    paramMetaByFieldId: new Map(),

    /* weather model caches */
    _frModelWxCache: new Map(),
    _frForecastCache: new Map(),
    _frForecastMetaByFieldId: new Map(),

    /* ---------------------------------------------------------
       REQUIRED for buildWxCtx() (this was missing before)
    --------------------------------------------------------- */
    weather30: [],
    weatherByFieldId: new Map(),
    wxInfoByFieldId: new Map(),

    /* MRMS display caches */
    mrmsByFieldId: new Map(),
    mrmsInfoByFieldId: new Map()
  }
};
