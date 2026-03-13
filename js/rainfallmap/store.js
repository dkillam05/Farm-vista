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

  readinessState: {
    fields: [],
    farmsById: new Map(),
    farmFilter: '__all__',
    selectedFieldId: '',
    persistedStateByFieldId: {},
    _persistLoadedAt: 0,
    _mods: {},
    lastRuns: new Map(),
    _mrmsDocByFieldId: new Map(),
    _mrmsDocLoadedAtByFieldId: new Map(),
    perFieldParams: new Map(),
    paramMetaByFieldId: new Map(),
    _frModelWxCache: new Map(),
    _frForecastCache: new Map(),
    _frForecastMetaByFieldId: new Map()
  }
};
