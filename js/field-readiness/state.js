/* =====================================================================
/Farm-vista/js/field-readiness/state.js  (FULL FILE)
Rev: 2025-12-26a
Shared state + constants for modular Field Readiness.
===================================================================== */
'use strict';

export const OPS = [
  { key:'spring_tillage', label:'Spring tillage' },
  { key:'planting', label:'Planting' },
  { key:'spraying', label:'Spraying' },
  { key:'harvest', label:'Harvest' },
  { key:'fall_tillage', label:'Fall tillage' }
];

export const CONSTANTS = {
  // Weather
  WX_BASE: 'https://farmvista-field-weather-300398089669.us-central1.run.app',
  WX_TTL_MS: 4 * 60 * 60 * 1000,
  WX_CACHE_PREFIX: 'fv_fr_wx_daily_cache_v2_',
  WX_FIRESTORE_COLLECTION: 'field_weather_cache',

  // Model
  LOSS_SCALE: 0.55,
  ETA_MAX_HOURS: 72,

  // Firestore collections
  THR_COLLECTION: 'field_readiness_thresholds',
  THR_DOC_ID: 'default',
  ADJ_COLLECTION: 'field_readiness_adjustments',
  WEIGHTS_COLLECTION: 'field_readiness_model_weights',
  WEIGHTS_DOC: 'default',
  FIELDS_COLLECTION: 'fields',
  FARMS_COLLECTION: 'farms',

  // Local storage keys
  LS_PER_FIELD_PARAMS: 'fv_dev_field_readiness_params_v2_0_100',
  LS_OP_KEY: 'fv_dev_field_readiness_op',
  LS_THR_KEY: 'fv_dev_field_readiness_thresholds_v1',
  LS_ADJ_LOG: 'fv_fr_adjust_log_v1',

  LS_FARM_FILTER: 'fv_fr_farm_filter_v1',
  LS_PAGE_SIZE:   'fv_fr_page_size_v1',
  LS_SORT_KEY:    'fv_fr_sort_v1',
  LS_RANGE_KEY:   'fv_fr_rain_range_v1'
};

export function createState(){
  return {
    // firebase-init module
    fb: null,

    // data
    fields: [],
    farmsById: new Map(),
    thresholdsByOp: new Map(),

    // weather caches
    weather30: [],
    weatherByFieldId: new Map(),
    wxInfoByFieldId: new Map(),

    // model results
    lastRuns: new Map(),

    // selection + per-field params
    selectedFieldId: null,
    perFieldParams: new Map(),

    // UI prefs (mirrors)
    farmFilter: '__all__',
    pageSize: 25, // -1 => all
    sortMode: 'name_az',
    opKey: OPS[0].key,

    // range (stored as raw input string too)
    rangeText: '',

    // timers
    _renderTimer: null,
    _thrSaveTimer: null,
    _wired: false,

    // quickview
    _qvBuilt: false,
    _qvOpen: false,
    _qvFieldId: null,
    _qvSaving: false
  };
}
