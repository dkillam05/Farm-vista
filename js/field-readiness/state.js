/* =====================================================================
/Farm-vista/js/field-readiness/state.js  (FULL FILE)
Rev: 2025-12-26c

Permission key switched to: crop-weather
===================================================================== */
'use strict';

export const OPS = [
  { key:'spring_tillage', label:'Spring tillage' },
  { key:'planting', label:'Planting' },
  { key:'spraying', label:'Spraying' },
  { key:'harvest', label:'Harvest' },
  { key:'fall_tillage', label:'Fall tillage' }
];

export const EXTRA = {
  DRYPWR_VPD_W: 0.06,
  DRYPWR_CLOUD_W: 0.04,
  LOSS_ET0_W: 0.08,
  ADD_SM010_W: 0.10,
  STORAGE_CAP_SM010_W: 0.05
};

export const CONST = {
  WX_BASE: 'https://farmvista-field-weather-300398089669.us-central1.run.app',
  WX_ENDPOINT_SUFFIX: '/api/open-meteo',
  WX_TTL_MS: 4 * 60 * 60 * 1000,
  WX_CACHE_PREFIX: 'fv_fr_wx_daily_cache_v2_',
  WX_FIRESTORE_COLLECTION: 'field_weather_cache',

  LOSS_SCALE: 0.55,
  ETA_MAX_HOURS: 72,

  LS_KEY: 'fv_dev_field_readiness_params_v2_0_100',
  LS_OP_KEY: 'fv_dev_field_readiness_op',
  LS_THR_KEY: 'fv_dev_field_readiness_thresholds_v1',
  LS_ADJ_LOG: 'fv_fr_adjust_log_v1',

  LS_FARM_FILTER: 'fv_fr_farm_filter_v1',
  LS_PAGE_SIZE: 'fv_fr_page_size_v1',

  THR_COLLECTION: 'field_readiness_thresholds',
  THR_DOC_ID: 'default',
  ADJ_COLLECTION: 'field_readiness_adjustments',

  WEIGHTS_COLLECTION: 'field_readiness_model_weights',
  WEIGHTS_DOC: 'default'
};

export function createState(){
  return {
    // permissions (default fail-open until loaded)
    perm: {
      key: 'crop-weather',
      view: true,
      edit: true,
      add: true,
      delete: true,
      loaded: false,
      roleName: null,
      email: null
    },

    weather30: [],
    weatherByFieldId: new Map(),
    wxInfoByFieldId: new Map(),
    seed: Date.now() % 1000000,
    selectedFieldId: null,
    lastRuns: new Map(),
    fields: [],
    farmsById: new Map(),
    perFieldParams: new Map(),
    thresholdsByOp: new Map(),
    fb: null,
    _thrSaveTimer: null,
    _renderTimer: null,
    _wiredUI: false,

    farmFilter: '__all__',
    pageSize: 25,

    _adjFeel: null,
    _cooldownTimer: null,
    _nextAllowedMs: 0,
    _lastAppliedMs: 0,
    _cooldownHours: 72,

    _adjAnchorReadiness: null,

    _mapsPromise: null,
    _gmap: null,
    _gmarker: null,

    _mods: { model:null, weather:null }
  };
}

export function buildWxCtx(state){
  const WX_ENDPOINT = CONST.WX_BASE + CONST.WX_ENDPOINT_SUFFIX;
  return {
    WX_ENDPOINT,
    WX_TTL_MS: CONST.WX_TTL_MS,
    WX_CACHE_PREFIX: CONST.WX_CACHE_PREFIX,
    timezone: 'America/Chicago',
    WX_FIRESTORE_COLLECTION: CONST.WX_FIRESTORE_COLLECTION,
    weatherByFieldId: state.weatherByFieldId,
    wxInfoByFieldId: state.wxInfoByFieldId,
    weather30: state.weather30
  };
}
