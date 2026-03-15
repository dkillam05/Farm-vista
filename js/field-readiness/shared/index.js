// /js/field-readiness/shared/index.js  (FULL FILE)
// FarmVista Readiness Rebuilder (Cloud Run)
// Rev: 2026-03-15g-readiness-only-updater
//
// THIS REV:
// ✅ DOES NOT fetch Open-Meteo
// ✅ DOES NOT write field_weather_cache
// ✅ ONLY rebuilds field_readiness_latest
// ✅ Uses shared readiness core from readiness-core-shared.cjs
// ✅ Uses existing field_weather_cache as input only
// ✅ Uses MRMS overlay when ready
// ✅ Uses persisted truth from field_readiness_state
// ✅ Uses same field param paths as frontend
//
const express = require("express");
const { runFieldReadinessCore } = require("./readiness-core-shared.cjs");

const app = express();
app.disable("x-powered-by");

const PORT = process.env.PORT || 8080;

// Optional: lock CORS to your domains (comma-separated).
const ALLOWED = (process.env.FV_ALLOWED_ORIGINS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

function cors(req, res) {
  const origin = req.headers.origin || "";
  if (!ALLOWED.length) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  } else if (ALLOWED.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

app.options("*", (req, res) => {
  cors(req, res);
  res.status(204).send("");
});

function num(v, d = null){
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
function clamp(n, lo, hi){
  n = Number(n);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
function round(v, d=2){
  const p = Math.pow(10,d);
  return Math.round(Number(v) * p) / p;
}
function mmToIn(mm){ return (Number(mm || 0) / 25.4); }

const READINESS_LATEST_COLLECTION = process.env.FV_READINESS_LATEST_COLLECTION || "field_readiness_latest";
const READINESS_RUNS_COLLECTION = process.env.FV_READINESS_RUNS_COLLECTION || "field_readiness_runs";
const PERSISTED_STATE_COLLECTION = process.env.FV_PERSISTED_STATE_COLLECTION || "field_readiness_state";
const MRMS_COLLECTION = process.env.FV_MRMS_COLLECTION || "field_mrms_weather";
const WEATHER_CACHE_COLLECTION = process.env.FV_WEATHER_CACHE_COLLECTION || "field_weather_cache";

const LOSS_SCALE = Number.isFinite(Number(process.env.FV_READINESS_LOSS_SCALE))
  ? Number(process.env.FV_READINESS_LOSS_SCALE)
  : 0.55;

const EXTRA = {
  DRYPWR_VPD_W: Number.isFinite(Number(process.env.FV_DRYPWR_VPD_W)) ? Number(process.env.FV_DRYPWR_VPD_W) : 0.06,
  DRYPWR_CLOUD_W: Number.isFinite(Number(process.env.FV_DRYPWR_CLOUD_W)) ? Number(process.env.FV_DRYPWR_CLOUD_W) : 0.04,
  LOSS_ET0_W: Number.isFinite(Number(process.env.FV_LOSS_ET0_W)) ? Number(process.env.FV_LOSS_ET0_W) : 0.08,
  ADD_SM010_W: Number.isFinite(Number(process.env.FV_ADD_SM010_W)) ? Number(process.env.FV_ADD_SM010_W) : 0.10,
  STORAGE_CAP_SM010_W: Number.isFinite(Number(process.env.FV_STORAGE_CAP_SM010_W)) ? Number(process.env.FV_STORAGE_CAP_SM010_W) : 0.05,
  DRY_LOSS_MULT: Number.isFinite(Number(process.env.FV_DRY_LOSS_MULT)) ? Number(process.env.FV_DRY_LOSS_MULT) : 1.0,
  RAIN_EFF_MULT: Number.isFinite(Number(process.env.FV_RAIN_EFF_MULT)) ? Number(process.env.FV_RAIN_EFF_MULT) : 1.0
};

const FV_TUNE = {
  SAT_RUNOFF_START: Number.isFinite(Number(process.env.FV_SAT_RUNOFF_START)) ? Number(process.env.FV_SAT_RUNOFF_START) : 0.75,
  RUNOFF_EXP: Number.isFinite(Number(process.env.FV_RUNOFF_EXP)) ? Number(process.env.FV_RUNOFF_EXP) : 2.2,
  RUNOFF_DRAINPOOR_W: Number.isFinite(Number(process.env.FV_RUNOFF_DRAINPOOR_W)) ? Number(process.env.FV_RUNOFF_DRAINPOOR_W) : 0.35,

  DRY_BYPASS_END: Number.isFinite(Number(process.env.FV_DRY_BYPASS_END)) ? Number(process.env.FV_DRY_BYPASS_END) : 0.35,
  DRY_EXP: Number.isFinite(Number(process.env.FV_DRY_EXP)) ? Number(process.env.FV_DR...
