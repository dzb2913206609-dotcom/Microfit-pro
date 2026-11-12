/**
 * Dynamic process simulation for microbial inactivation.
 * Solves ODE: d(logN)/dt = -k(env(t)) / ln(10)
 * using Simpson quadrature between profile knots. This equals RK4 for the
 * state-independent log-survival rate and also integrates cumulative metrics.
 *
 * Generic across all sterilization modes (Thermal, HPP, Photoinactivation, PEF, Chemical).
 * The lethality metric is computed according to the mode config:
 *   source: 'integral' → accumulated via compute()
 *   source: 'state'    → read directly from ODE state (logN0 - logN)
 */

import {
  MODEL_SECONDARY_CONFIG,
  SECONDARY_MODELS,
  predictRawParameterValue,
} from './secondaryModels.js';
import Papa from 'papaparse';
import { getFactorDef } from '../config/factors.js';

/**
 * Linear interpolation of a profile at time t.
 * profile: [{t, ...envVars}] sorted ascending by t.
 * Returns interpolated env object at time t.
 */
function interpolateProfile(profile, t) {
  if (profile.length === 0) return {};
  if (t <= profile[0].t) return { ...profile[0] };
  if (t >= profile[profile.length - 1].t) return { ...profile[profile.length - 1] };

  let lo = 0;
  let hi = profile.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (profile[mid].t <= t) lo = mid;
    else hi = mid;
  }

  const p0 = profile[lo];
  const p1 = profile[hi];
  const alpha = (t - p0.t) / (p1.t - p0.t);

  const result = { t };
  for (const key of Object.keys(p0)) {
    if (key === 't') continue;
    const v0 = p0[key];
    const v1 = p1[key];
    result[key] = Number.isFinite(v0) && Number.isFinite(v1)
      ? v0 + alpha * (v1 - v0)
      : v0;
  }
  return result;
}

/**
 * Build a kFn closure from a fitted secondary model result.
 * kFn(env) => k (inactivation rate constant in the profile time unit⁻¹)
 *
 * Generic: uses the model's factorKeys to extract values from env,
 * with fallback to model params for missing factors.
 *
 * @param {object} secondaryFit - result from fitSecondaryModel
 * @param {string[]} profileFactorKeys - which factor keys exist in the profile
 * @returns {{ kFn: Function, fallbacks: object[] }}
 */
export function buildKFn(secondaryFit, profileFactorKeys = []) {
  const { primaryModelId, secondaryModelId, targetKey, params } = secondaryFit;
  const modelDef = SECONDARY_MODELS[secondaryModelId];
  if (!modelDef) return null;
  const targetConfig = MODEL_SECONDARY_CONFIG[primaryModelId]?.targets?.[targetKey] ?? null;

  const fallbacks = [];

  // For each factor the model needs, determine if we get it from profile or params
  const factorSources = {};
  for (const fk of modelDef.factorKeys) {
    if (profileFactorKeys.includes(fk)) {
      factorSources[fk] = 'profile';
    } else {
      // Find fallback in model params (e.g., awRef, Pref, Tref)
      const configuredRefs = { temp: 'Tref', pressure: 'Pref', intensity: 'Iref', electricField: 'Eref', concentration: 'Cref', doseRate: 'DRref', conductivity: 'sigmaRef', aw: 'awRef', pH: 'pHref' };
      const customIndex = secondaryModelId.startsWith('CUSTOM_') ? modelDef.factorKeys.indexOf(fk) + 1 : null;
      const refAliases = [configuredRefs[fk], customIndex ? `x${customIndex}ref` : null, `${fk}Ref`, `${fk}_ref`, fk].filter(Boolean);
      const paramName = Object.keys(params).find((k) => refAliases.includes(k));
      let fallbackValue;
      if (paramName != null) {
        fallbackValue = params[paramName];
        fallbacks.push({ factorKey: fk, value: fallbackValue, paramName });
      } else {
        // Use sensible defaults
        const factorDef = getFactorDef(fk);
        fallbackValue = factorDef?.scalingRef ?? factorDef?.default ?? 0;
        fallbacks.push({ factorKey: fk, value: fallbackValue, paramName: `${fk} (default)` });
      }
      factorSources[fk] = { type: 'fallback', value: fallbackValue };
    }
  }

  // Determine if the target is a D-value (needs conversion to k)
  const isDValue = targetKey?.toLowerCase().includes('d') ||
    modelDef.responseLabel?.toLowerCase().includes('d value');

  const kFn = (env) => {
    const factors = {};
    for (const fk of modelDef.factorKeys) {
      const src = factorSources[fk];
      if (src === 'profile') {
        factors[fk] = env[fk];
      } else {
        factors[fk] = src.value;
      }
    }

    const paramValue = targetConfig
      ? predictRawParameterValue({ secondaryModelId, params, factors, targetConfig })
      : modelDef.predictParameterValue(factors, params);
    if (!Number.isFinite(paramValue) || paramValue < 0 || (isDValue && paramValue === 0)) return NaN;

    if (isDValue) {
      return Math.LN10 / paramValue;
    }
    return paramValue;
  };

  kFn.requiredFactorKeys = modelDef.factorKeys.filter(fk => factorSources[fk] === 'profile');
  return { kFn, fallbacks };
}

/** Validate times and every factor supplied by the profile or required by a caller. */
export function validateDynamicProfile(profile, requiredFactorKeys = []) {
  if (!Array.isArray(profile) || profile.length < 2) return 'Profile must have at least 2 rows.';
  if (profile.some(row => !Number.isFinite(row?.t))) return 'Profile times must be finite numbers.';
  if (profile.some((row, i) => i > 0 && row.t <= profile[i - 1].t)) return 'Profile times must be strictly increasing.';
  const keys = new Set([...requiredFactorKeys, ...profile.flatMap(row => Object.keys(row).filter(key => key !== 't'))]);
  for (let i = 0; i < profile.length; i++) {
    for (const key of keys) {
      if (!Number.isFinite(profile[i][key])) return `Profile row ${i + 1}: factor ${key} must be a finite number.`;
    }
  }
  return null;
}

/** Simpson integration on a grid containing every profile knot. */
export function runDynamicSimulation({ logN0, profile, kFn, steps = 500, modeConfig, lethalityParams = {}, Tref, zValue }) {
  const requiredKeys = [...(kFn?.requiredFactorKeys ?? []), ...(modeConfig?.primaryFactor ? [modeConfig.primaryFactor] : [])];
  const profileError = validateDynamicProfile(profile, requiredKeys);
  if (profileError) throw new RangeError(profileError);
  if (!Number.isFinite(logN0)) throw new RangeError('logN0 must be finite.');
  if (!Number.isInteger(steps) || steps <= 0) throw new RangeError('Integration steps must be a positive integer.');
  if (typeof kFn !== 'function') throw new TypeError('A rate function is required.');
  const tStart = profile[0].t;
  const tEnd = profile.at(-1).t;
  const grid = new Set(profile.map(row => row.t));
  for (let i = 0; i <= steps; i++) grid.add(tStart + (tEnd - tStart) * i / steps);
  const times = [...grid].sort((a, b) => a - b);
  const source = modeConfig?.lethalityMetric?.source;
  const metric = modeConfig?.lethalityMetric;
  const legacy = !modeConfig && Number.isFinite(Tref) && Number.isFinite(zValue) && zValue > 0;
  const rateAt = t => {
    const rate = kFn(interpolateProfile(profile, t));
    if (!Number.isFinite(rate) || rate < 0) throw new RangeError(`Invalid rate prediction at t=${t}.`);
    return rate;
  };
  const metricRateAt = t => {
    const env = interpolateProfile(profile, t);
    let rate;
    if (legacy) rate = env.temp > Tref - 3 * zValue ? 10 ** ((env.temp - Tref) / zValue) : 0;
    else rate = metric.rate ? metric.rate(env, lethalityParams) : metric.compute(env, lethalityParams, 0, 1).dF;
    if (!Number.isFinite(rate) || rate < 0) throw new RangeError(`Invalid cumulative metric rate at t=${t}.`);
    return rate;
  };
  const integrate = (fn, t0, t1) => (t1 - t0) / 6 * (fn(t0) + 4 * fn((t0 + t1) / 2) + fn(t1));
  let logN = logN0;
  let cumulativeF = 0;
  const results = [];
  rateAt(tStart); // Also validate zero-duration initial state.
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    if (i > 0) {
      logN -= integrate(rateAt, times[i - 1], t) / Math.LN10;
      if (source === 'integral' || legacy) cumulativeF += integrate(metricRateAt, times[i - 1], t);
      if (!Number.isFinite(logN) || !Number.isFinite(cumulativeF)) throw new RangeError('Dynamic integration overflowed.');
    }
    const env = interpolateProfile(profile, t);
    const logReduction = logN0 - logN;
    results.push({ t, logN, logReduction, env, T: env.temp ?? null, P: env.pressure ?? null, aw: env.aw ?? null,
      F: source === 'state' ? logReduction : source === 'integral' || legacy ? cumulativeF : null });
  }
  return results;
}

function interpolateSimulationLogN(simResult, t) {
  if (!Array.isArray(simResult) || simResult.length === 0 || !Number.isFinite(t)) return null;
  if (t < simResult[0].t || t > simResult[simResult.length - 1].t) return null;

  let lo = 0;
  let hi = simResult.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (simResult[mid].t <= t) lo = mid;
    else hi = mid;
  }

  const p0 = simResult[lo];
  const p1 = simResult[hi];
  if (!p0 || !p1 || !Number.isFinite(p0.logN) || !Number.isFinite(p1.logN)) return null;
  if (Math.abs(p1.t - p0.t) < 1e-12) return p0.logN;

  const alpha = (t - p0.t) / (p1.t - p0.t);
  return p0.logN + alpha * (p1.logN - p0.logN);
}

export function summarizeDynamicObservationFit(simResult, observations) {
  const rows = [];
  for (const obs of observations ?? []) {
    const t = Number(obs.t);
    const observedLogN = Number(obs.logN);
    if (!Number.isFinite(t) || !Number.isFinite(observedLogN)) continue;

    const predictedLogN = interpolateSimulationLogN(simResult, t);
    if (!Number.isFinite(predictedLogN)) continue;

    const residual = observedLogN - predictedLogN;
    rows.push({
      ...obs,
      t,
      observedLogN,
      predictedLogN,
      residual,
    });
  }

  if (rows.length === 0) {
    return { n: 0, rmse: null, mae: null, meanResidual: null, rows };
  }

  const sumSquares = rows.reduce((sum, row) => sum + row.residual ** 2, 0);
  const sumAbs = rows.reduce((sum, row) => sum + Math.abs(row.residual), 0);
  const sumResidual = rows.reduce((sum, row) => sum + row.residual, 0);
  return {
    n: rows.length,
    rmse: Math.sqrt(sumSquares / rows.length),
    mae: sumAbs / rows.length,
    meanResidual: sumResidual / rows.length,
    rows,
  };
}

/**
 * Normalize a CSV header for alias matching.
 * Lowercase, trim, remove underscores/hyphens/parenthesized blocks.
 * e.g. "Temperature (°C)" → "temperature", "Photoinactivation_Intensity" → "lightintensity"
 */
function normalizeHeader(h) {
  return h
    .toLowerCase()
    .trim()
    .replace(/\([^)]*\)/g, '')  // remove parenthesized blocks
    .replace(/[_\-\s]/g, '')    // remove underscores, hyphens, spaces
    .trim();
}

/**
 * Parse a CSV string into a profile array.
 * When modeConfig is provided, uses csvAliases for column matching.
 * Falls back to built-in aliases for backward compatibility.
 *
 * @param {string} csvText
 * @param {object} [modeConfig] - Mode config with csvAliases
 * @returns {Array} [{t, ...envVars}] sorted by t.
 */
export function parseProfileCSV(csvText, modeConfig) {
  const parsed = Papa.parse(csvText.trim(), { delimiter: ',', skipEmptyLines: 'greedy' });
  if (parsed.errors.length) throw new RangeError(`Invalid profile CSV: ${parsed.errors[0].message}`);
  const records = parsed.data;
  if (records.length < 2) return [];

  const rawHeaders = records[0].map(h => h.trim());
  const normHeaders = rawHeaders.map(normalizeHeader);

  // Time column (always universal)
  const tIdx = normHeaders.findIndex((h) => h === 't' || h === 'time');
  if (tIdx === -1) return [];

  // Build column map from mode config aliases or fallback
  const colMap = {};
  if (modeConfig?.csvAliases) {
    for (const [factorKey, aliases] of Object.entries(modeConfig.csvAliases)) {
      const normAliases = aliases.map(normalizeHeader);
      const idx = normHeaders.findIndex((h, i) => i !== tIdx && normAliases.includes(h));
      if (idx >= 0) colMap[factorKey] = idx;
    }
  } else {
    // Legacy fallback
    const legacyAliases = {
      temp: ['temperature', 'temp', 'tc', 'tempc'],
      pressure: ['pressure', 'p', 'pmpa', 'pressurempa'],
      aw: ['aw', 'wateractivity'],
    };
    for (const [factorKey, aliases] of Object.entries(legacyAliases)) {
      const idx = normHeaders.findIndex((h, i) => i !== tIdx && aliases.includes(h));
      if (idx >= 0) colMap[factorKey] = idx;
    }
  }

  const rows = [];
  for (let i = 1; i < records.length; i++) {
    const cols = records[i].map(c => c.trim());
    const t = cols[tIdx] ? Number(cols[tIdx]) : NaN;

    const row = { t };
    for (const [factorKey, idx] of Object.entries(colMap)) {
      row[factorKey] = cols[idx] ? Number(cols[idx]) : NaN;
    }
    rows.push(row);
  }

  return rows;
}
