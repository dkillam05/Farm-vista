/* =====================================================================
/Farm-vista/js/field-readiness/eta-engine.js  (FULL FILE)
Rev: 2026-03-31c-eta-engine-null-default-fix

GOAL:
✅ Dedicated ETA-only engine
✅ Start from SAVED readiness
✅ Forecast-driven ETA only
✅ No fake fallback numbers
✅ Return strong debug payload when ETA cannot be calculated
✅ Drying-first logic for next 2 days
✅ If threshold can be reached within 2 days from drying potential,
   ignore rain during that early crossing window
✅ If threshold cannot be reached in that window, include rain normally
✅ If threshold already met, return READY
✅ FIX: support BOTH positional args and object-style args
✅ FIX: null / blank values no longer become 0
===================================================================== */

const ETA_UNAVAILABLE_TEXT = 'ETA temporarily unavailable';
const DEFAULT_MAX_HOURS = 168;
const DEFAULT_EARLY_IGNORE_RAIN_HOURS = 48;

function safeStr(v) {
  return String(v == null ? '' : v).trim();
}

function safeNum(v, fallback = null) {
  if (v == null) return fallback;
  if (typeof v === 'string' && v.trim() === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function round1(n) {
  return Math.round(Number(n || 0) * 10) / 10;
}

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function formatEtaText(hours) {
  const h = safeNum(hours, null);

  if (h == null) return ETA_UNAVAILABLE_TEXT;

  if (h <= 0.5) return 'Ready';

  // ALWAYS show hours with ~ prefix
  if (h <= 168) {
    return `~${Math.round(h)}h`;
  }

  // Beyond horizon
  return `>168h`;
}

function normalizeForecastRow(raw) {
  const r = raw || {};

  const dateISO = safeStr(
    r.dateISO ||
    r.date ||
    r.day ||
    r.timeISO ||
    r.timestampISO ||
    r.validDate ||
    r.validTime ||
    ''
  ).slice(0, 10);

  const rainInAdj =
    safeNum(r.rainInAdj, null) ??
    safeNum(r.rainIn, null) ??
    safeNum(r.precipIn, null) ??
    safeNum(r.precipitationIn, null) ??
    0;

  return {
    dateISO,
    rainInAdj,
    rainIn: safeNum(r.rainIn, rainInAdj),
    rainSource: safeStr(r.rainSource || 'unknown'),
    tempF: safeNum(r.tempF ?? r.tempAvgF ?? r.avgTempF ?? r.temperatureF, null),
    windMph: safeNum(r.windMph ?? r.windSpeedMph ?? r.windspeedMph, null),
    rh: safeNum(r.rh ?? r.rhPct ?? r.relativeHumidityPct ?? r.relativeHumidity, null),
    solarWm2: safeNum(r.solarWm2 ?? r.shortwaveWm2 ?? r.shortwaveRadiation ?? r.solar, null),
    sunshineHr: safeNum(r.sunshineHr ?? r.sunshineHours ?? r.sunshine_duration_hr, null),
    daylightHr: safeNum(r.daylightHr ?? r.daylightHours ?? r.daylight_duration_hr, null),
    cloudPct: safeNum(r.cloudPct ?? r.cloudCoverPct ?? r.cloud_cover, null),
    vpdKpa: safeNum(r.vpdKpa ?? r.vpd ?? r.vapour_pressure_deficit_kpa, null),
    sm010: safeNum(r.sm010 ?? r.soilMoisture010 ?? r.soilMoisture_0_10, null),
    et0In: safeNum(r.et0In ?? r.etIn ?? r.et0, null),
    rainMorningIn: safeNum(r.rainMorningIn, 0),
    rainMiddayIn: safeNum(r.rainMiddayIn, 0),
    rainEveningIn: safeNum(r.rainEveningIn, 0)
  };
}

function normalizeForecastRows(rows) {
  const out = [];
  const seen = new Set();

  for (const raw of Array.isArray(rows) ? rows : []) {
    const row = normalizeForecastRow(raw);
    if (!row.dateISO) continue;
    if (seen.has(row.dateISO)) continue;
    seen.add(row.dateISO);
    out.push(row);
  }

  out.sort((a, b) => String(a.dateISO).localeCompare(String(b.dateISO)));
  return out;
}

function isUsableForecastRow(row) {
  return !!(
    safeStr(row?.dateISO) &&
    safeNum(row?.tempF, null) != null &&
    safeNum(row?.windMph, null) != null &&
    safeNum(row?.rh, null) != null &&
    safeNum(row?.solarWm2, null) != null
  );
}

function calcDryGain(row) {
  const temp = safeNum(row.tempF, 50);
  const wind = safeNum(row.windMph, 8);
  const rh = safeNum(row.rh, 65);
  const solar = safeNum(row.solarWm2, 120);
  const et0 = safeNum(row.et0In, 0.08);
  const sun = safeNum(row.sunshineHr, 6);
  const cloud = safeNum(row.cloudPct, 60);
  const vpd = safeNum(row.vpdKpa, 0.6);

  let gain = 0;
  gain += Math.max(0, temp - 40) * 0.18;
  gain += wind * 0.22;
  gain += Math.max(0, 75 - rh) * 0.06;
  gain += solar * 0.010;
  gain += et0 * 24;
  gain += sun * 0.55;
  gain += Math.max(0, 70 - cloud) * 0.035;
  gain += vpd * 3.2;

  return clamp(gain, 0, 14);
}

function calcRainPenalty(row) {
  const rain = safeNum(row.rainInAdj ?? row.rainIn, 0);
  const sm = safeNum(row.sm010, 0.28);

  let penalty = 0;
  penalty += rain * 26;

  if (rain >= 0.10) penalty += 5;
  if (rain >= 0.25) penalty += 6;
  if (rain >= 0.50) penalty += 8;
  if (rain >= 1.00) penalty += 10;

  if (sm >= 0.34) penalty += 5;
  else if (sm >= 0.30) penalty += 2;

  return clamp(penalty, 0, 45);
}

function estimateDailyDelta(row, options = {}) {
  const ignoreRain = !!options.ignoreRain;
  const dryGain = calcDryGain(row);
  const rainPenalty = ignoreRain ? 0 : calcRainPenalty(row);

  return {
    dryGain,
    rainPenalty,
    dailyDelta: dryGain - rainPenalty
  };
}

function buildForecastDiagnostics(rows) {
  const normalized = normalizeForecastRows(rows);
  const usable = normalized.filter(isUsableForecastRow);
  const unusable = normalized
    .filter((r) => !isUsableForecastRow(r))
    .map((r) => ({
      dateISO: r.dateISO,
      tempF: safeNum(r.tempF, null),
      windMph: safeNum(r.windMph, null),
      rh: safeNum(r.rh, null),
      solarWm2: safeNum(r.solarWm2, null)
    }));

  return {
    total: normalized.length,
    usable: usable.length,
    bad: unusable.length,
    firstDate: normalized.length ? normalized[0].dateISO : '',
    lastDate: normalized.length ? normalized[normalized.length - 1].dateISO : '',
    badRowsPreview: unusable.slice(0, 6)
  };
}

function projectWindow(startReadiness, rows, options = {}) {
  const maxHours = safeNum(options.maxHours, DEFAULT_MAX_HOURS);
  const ignoreRain = !!options.ignoreRain;

  let readiness = clamp(safeNum(startReadiness, 0), 0, 100);
  let elapsed = 0;
  const steps = [];

  for (const row of rows) {
    if (elapsed >= maxHours) break;
    if (!isUsableForecastRow(row)) continue;

    const { dryGain, rainPenalty, dailyDelta } = estimateDailyDelta(row, { ignoreRain });
    const nextReadiness = clamp(readiness + dailyDelta, 0, 100);

    steps.push({
      dateISO: safeStr(row.dateISO),
      ignoreRain,
      readinessStart: round2(readiness),
      readinessEnd: round2(nextReadiness),
      dryGain: round2(dryGain),
      rainPenalty: round2(rainPenalty),
      dailyDelta: round2(dailyDelta),
      rainInAdj: round2(safeNum(row.rainInAdj ?? row.rainIn, 0))
    });

    readiness = nextReadiness;
    elapsed += 24;
  }

  return {
    readinessEnd: round2(readiness),
    hoursSimulated: elapsed,
    steps
  };
}

function findCrossing(startReadiness, threshold, rows, options = {}) {
  const maxHours = safeNum(options.maxHours, DEFAULT_MAX_HOURS);
  const ignoreRain = !!options.ignoreRain;

  let readiness = clamp(safeNum(startReadiness, 0), 0, 100);
  let elapsed = 0;
  const steps = [];

  for (const row of rows) {
    if (elapsed >= maxHours) break;
    if (!isUsableForecastRow(row)) continue;

    const { dryGain, rainPenalty, dailyDelta } = estimateDailyDelta(row, { ignoreRain });
    const nextReadiness = clamp(readiness + dailyDelta, 0, 100);

    const step = {
      dateISO: safeStr(row.dateISO),
      ignoreRain,
      readinessStart: round2(readiness),
      readinessEnd: round2(nextReadiness),
      dryGain: round2(dryGain),
      rainPenalty: round2(rainPenalty),
      dailyDelta: round2(dailyDelta),
      rainInAdj: round2(safeNum(row.rainInAdj ?? row.rainIn, 0))
    };
    steps.push(step);

    if (dailyDelta > 0 && readiness < threshold && nextReadiness >= threshold) {
      const needed = threshold - readiness;
      const fraction = clamp(needed / dailyDelta, 0, 1);
      const hoursIntoDay = fraction * 24;
      const totalHours = clamp(elapsed + hoursIntoDay, 0, maxHours);

      return {
        crossed: true,
        hours: round1(totalHours),
        crossedOnDate: step.dateISO,
        steps
      };
    }

    readiness = nextReadiness;
    elapsed += 24;
  }

  return {
    crossed: false,
    hours: null,
    crossedOnDate: '',
    steps
  };
}

function buildUnavailable(reason, extra = {}) {
  return {
    ok: false,
    status: 'unavailable',
    text: ETA_UNAVAILABLE_TEXT,
    hours: null,
    reason,
    ...extra
  };
}

function buildReady(savedReadiness, threshold) {
  return {
    ok: true,
    status: 'ready',
    text: 'Ready',
    hours: 0,
    savedReadiness: safeNum(savedReadiness, null),
    threshold: safeNum(threshold, null)
  };
}

function parseEngineArgs(arg1, arg2, arg3, arg4) {
  const isObjectStyle =
    arg1 &&
    typeof arg1 === 'object' &&
    !Array.isArray(arg1);

  if (isObjectStyle) {
    const input = arg1 || {};
    return {
      savedReadiness: safeNum(input.savedReadiness, null),
      threshold: safeNum(input.threshold, null),
      forecastRows: Array.isArray(input.forecastRows)
        ? input.forecastRows
        : Array.isArray(input.rows)
          ? input.rows
          : Array.isArray(input.dailySeriesFcst)
            ? input.dailySeriesFcst
            : [],
      options: {
        maxHours: safeNum(input.maxHours, null),
        earlyIgnoreRainHours: safeNum(input.earlyIgnoreRainHours, null),
        field: input.field || null,
        latestDoc: input.latestDoc || null,
        weatherDoc: input.weatherDoc || null,
        fieldDoc: input.fieldDoc || null,
        historyRows: Array.isArray(input.historyRows) ? input.historyRows : [],
        mergedRows: Array.isArray(input.mergedRows) ? input.mergedRows : [],
        fieldParams: input.fieldParams || null,
        callStyle: 'object'
      }
    };
  }

  return {
    savedReadiness: safeNum(arg1, null),
    threshold: safeNum(arg2, null),
    forecastRows: Array.isArray(arg3) ? arg3 : [],
    options: {
      ...(arg4 || {}),
      callStyle: 'positional'
    }
  };
}

export function calculateEtaFromSavedReadiness(arg1, arg2, arg3, arg4) {
  const parsed = parseEngineArgs(arg1, arg2, arg3, arg4);

  const saved = safeNum(parsed.savedReadiness, null);
  const thr = safeNum(parsed.threshold, null);
  const maxHours = safeNum(parsed.options.maxHours, DEFAULT_MAX_HOURS);
  const earlyIgnoreRainHours = safeNum(
    parsed.options.earlyIgnoreRainHours,
    DEFAULT_EARLY_IGNORE_RAIN_HOURS
  );

  const rows = normalizeForecastRows(parsed.forecastRows);
  const usableRows = rows.filter(isUsableForecastRow);
  const diagnostics = buildForecastDiagnostics(rows);

  if (saved == null) {
    return buildUnavailable('missing-saved-readiness', {
      savedReadiness: saved,
      threshold: thr,
      debug: {
        diagnostics,
        callStyle: parsed.options.callStyle
      }
    });
  }

  if (thr == null) {
    return buildUnavailable('missing-threshold', {
      savedReadiness: saved,
      threshold: thr,
      debug: {
        diagnostics,
        callStyle: parsed.options.callStyle
      }
    });
  }

  if (saved >= thr) {
    return buildReady(saved, thr);
  }

  if (!rows.length) {
    return buildUnavailable('no-forecast-rows', {
      savedReadiness: saved,
      threshold: thr,
      debug: {
        diagnostics,
        callStyle: parsed.options.callStyle
      }
    });
  }

  if (!usableRows.length) {
    return buildUnavailable('no-usable-forecast-rows', {
      savedReadiness: saved,
      threshold: thr,
      debug: {
        diagnostics,
        rowsPreview: rows.slice(0, 6),
        callStyle: parsed.options.callStyle
      }
    });
  }

  const earlyRows = usableRows.filter((_, idx) => idx * 24 < earlyIgnoreRainHours);

  const earlyDryOnlyProjection = projectWindow(saved, earlyRows, {
    maxHours: earlyIgnoreRainHours,
    ignoreRain: true
  });

  const canReachInEarlyWindowIgnoringRain = earlyDryOnlyProjection.readinessEnd >= thr;

  const crossing = findCrossing(saved, thr, usableRows, {
    maxHours,
    ignoreRain: canReachInEarlyWindowIgnoringRain
  });

  const fullProjection = projectWindow(saved, usableRows, {
    maxHours,
    ignoreRain: canReachInEarlyWindowIgnoringRain
  });

  if (crossing.crossed) {
    return {
      ok: true,
      status: 'crossed',
      text: formatEtaText(crossing.hours),
      hours: crossing.hours,
      crossedOnDate: crossing.crossedOnDate,
      savedReadiness: saved,
      threshold: thr,
      logic: {
        earlyIgnoreRainHours,
        ignoredRainForEarlyWindow: canReachInEarlyWindowIgnoringRain
      },
      debug: {
        diagnostics,
        earlyDryOnlyProjection,
        fullProjection,
        steps: crossing.steps,
        callStyle: parsed.options.callStyle
      }
    };
  }

  return {
    ok: true,
    status: 'beyond',
    text: '>168h'
    hours: maxHours,
    savedReadiness: saved,
    threshold: thr,
    logic: {
      earlyIgnoreRainHours,
      ignoredRainForEarlyWindow: canReachInEarlyWindowIgnoringRain
    },
    debug: {
      diagnostics,
      earlyDryOnlyProjection,
      fullProjection,
      reason: 'did-not-cross-threshold-within-horizon',
      callStyle: parsed.options.callStyle
    }
  };
}

export function explainEtaFailure(result) {
  if (result && result.ok) return '';
  const reason = safeStr(result && result.reason);

  switch (reason) {
    case 'missing-saved-readiness':
      return 'Saved readiness was not available.';
    case 'missing-threshold':
      return 'Threshold was not provided.';
    case 'no-forecast-rows':
      return 'No forecast rows were available.';
    case 'no-usable-forecast-rows':
      return 'Forecast rows were present, but required weather fields were missing.';
    default:
      return 'ETA could not be calculated.';
  }
}

export {
  ETA_UNAVAILABLE_TEXT,
  normalizeForecastRow,
  normalizeForecastRows,
  isUsableForecastRow,
  calcDryGain,
  calcRainPenalty,
  estimateDailyDelta,
  buildForecastDiagnostics
};
