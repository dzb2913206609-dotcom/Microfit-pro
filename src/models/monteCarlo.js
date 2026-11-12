/**
 * Monte Carlo uncertainty analysis for microbial inactivation models.
 * Uses multivariate normal sampling via Cholesky decomposition.
 * Positive parameters (kmax, delta, p) are sampled in log-space (log-normal)
 * to naturally avoid negative values.
 * Falls back to independent diagonal sampling if matrix is non-positive-definite.
 */

import { SECONDARY_MODELS } from './secondaryModels.js';

/* ── Physical constraint sets for sampled parameters ── */
const POSITIVE_PARAMS = new Set([
  'kmax', 'kmax1', 'kmax2', 'delta', 'delta1', 'delta2',
  'A', 'mu',
]);
const SHAPE_PARAMS = new Set(['p', 'p1', 'p2']);
const NON_NEGATIVE_PARAMS = new Set(['Sl', 'h0', 'lambda']);
const FRACTION_PARAMS = new Set(['f']);
const FLOOR = Number.MIN_VALUE;
const P_FLOOR = 0.01;

function clampSampledParams(sampledParams) {
  const clamped = { ...sampledParams };
  for (const [name, val] of Object.entries(clamped)) {
    if (SHAPE_PARAMS.has(name))               clamped[name] = Math.max(P_FLOOR, val);
    else if (POSITIVE_PARAMS.has(name))       clamped[name] = Math.max(FLOOR, val);
    else if (NON_NEGATIVE_PARAMS.has(name))   clamped[name] = Math.max(0, val);
    else if (FRACTION_PARAMS.has(name))       clamped[name] = Math.max(0.001, Math.min(0.999, val));
  }
  return clamped;
}

/** Returns true if param must be strictly positive */
function isPositiveParam(name) {
  return POSITIVE_PARAMS.has(name) || SHAPE_PARAMS.has(name);
}

/**
 * Cholesky decomposition: returns lower-triangular L such that C = L * L^T.
 * Returns null if C is not positive-definite.
 */
function cholesky(C) {
  const k = C.length;
  const L = Array.from({ length: k }, () => new Array(k).fill(0));
  for (let i = 0; i < k; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      for (let m = 0; m < j; m++) sum += L[i][m] * L[j][m];
      if (i === j) {
        const val = C[i][i] - sum;
        if (val <= 0) return null;
        L[i][j] = Math.sqrt(val);
      } else {
        if (L[j][j] === 0) return null;
        L[i][j] = (C[i][j] - sum) / L[j][j];
      }
    }
  }
  return L;
}

/**
 * Box-Muller transform: returns array of n standard normal samples.
 */
function sampleStdNormals(n, rng = Math.random) {
  const out = new Array(n);
  for (let i = 0; i < n; i += 2) {
    const u1 = rng() || 1e-300;
    const u2 = rng();
    const mag = Math.sqrt(-2 * Math.log(u1));
    out[i] = mag * Math.cos(2 * Math.PI * u2);
    if (i + 1 < n) out[i + 1] = mag * Math.sin(2 * Math.PI * u2);
  }
  return out;
}

function sampleMVN(mean, L, rng = Math.random) {
  const k = mean.length;
  const z = sampleStdNormals(k, rng);
  return mean.map((mu, i) => {
    let val = mu;
    for (let j = 0; j <= i; j++) val += L[i][j] * z[j];
    return val;
  });
}

function sampleDiagonal(mean, stdDevs, rng = Math.random) {
  const z = sampleStdNormals(mean.length, rng);
  return mean.map((mu, i) => mu + stdDevs[i] * z[i]);
}

function percentile(sorted, p) {
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function checkConvergence(allSamples, tLen, checkpoints = [1000, 3000, 5000, 10000, 20000, 50000]) {
  const lastTi = tLen - 1;
  const samples = allSamples[lastTi];
  if (!samples || samples.length < 100) return null;
  const n = samples.length;
  const results = [];
  for (const cp of checkpoints) {
    if (cp > n) break;
    const sub = samples.slice(0, cp).sort((a, b) => a - b);
    results.push({ n: cp, q95: percentile(sub, 95), q99: percentile(sub, 99) });
  }
  if (results.length < 2) return { checkpoints: results, level: null };

  const last = results[results.length - 1];
  const prev = results[results.length - 2];
  const recentChange99 = Math.abs(last.q99 - prev.q99);
  const recentChange95 = Math.abs(last.q95 - prev.q95);
  const earlyToFinal99 = results.length >= 2 ? Math.abs(last.q99 - results[0].q99) : null;

  let q99Level;
  if (recentChange99 <= 0.10) q99Level = 'stable';
  else if (recentChange99 <= 0.25) q99Level = 'moderate';
  else q99Level = 'exploratory';

  let q95Level;
  if (recentChange95 <= 0.05) q95Level = 'stable';
  else if (recentChange95 <= 0.15) q95Level = 'moderate';
  else q95Level = 'exploratory';

  const rank = { stable: 0, moderate: 1, exploratory: 2 };
  const level = rank[q99Level] >= rank[q95Level] ? q99Level : q95Level;

  return {
    checkpoints: results, level, q99Level, q95Level,
    recentChange99, recentChange95, earlyToFinal99,
    recentPair: [prev.n, last.n],
  };
}

/**
 * Build the actual standard deviation array for each parameter.
 * SE[j] = sqrt(covMatrix[j][j] * mse)
 * No artificial variance is added when covariance is zero or unavailable.
 */
function buildStdDevs(mean, covMatrix, mse) {
  return mean.map((_, j) => {
    const rawVar = (covMatrix?.[j]?.[j] ?? 0) * mse;
    return Number.isFinite(rawVar) && rawVar >= 0 ? Math.sqrt(rawVar) : 0;
  });
}

export function secondaryUncertainParamNames(fit) {
  if (!fit?.params || fit.failed || !fit.paramNames?.length) return [];
  return fit.paramNames.filter((name, i) => {
    const variance = fit.covMatrix && Number.isFinite(fit.mse) && fit.mse >= 0
      ? (fit.covMatrix[i]?.[i] ?? 0) * fit.mse
      : fit.paramErrors?.[name] ** 2;
    return Number.isFinite(fit.params[name]) && Number.isFinite(variance) && variance > 0;
  });
}

/**
 * For positive parameters, transform normal samples into log-normal space.
 * For each positive param: sample z ~ N(0, sigma_log), then value = mu * exp(z)
 * where sigma_log = SE / mu (relative SE mapped to log-space).
 * High-CV params (CV > 100%) are truncated to 3-sigma in log-space.
 */
function applyLogNormalForPositive(sampledValues, mean, stdDevs, paramNames) {
  for (let i = 0; i < paramNames.length; i++) {
    if (!isPositiveParam(paramNames[i])) continue;
    const mu = mean[i];
    if (mu <= 0) continue; // skip if mean is non-positive (shouldn't happen for these params)

    const sd = stdDevs[i];
    const cv = sd / Math.abs(mu);
    // Convert the normal deviation to log-space
    const sigmaLog = Math.sqrt(Math.log(1 + cv * cv)); // exact log-normal sigma
    const normalDeviation = (sampledValues[i] - mu) / (sd || 1);

    // Truncate at 3-sigma in log-space for high-CV params
    const zClamped = cv > 1.0
      ? Math.max(-3, Math.min(3, normalDeviation))
      : normalDeviation;

    // Log-normal transform: mu * exp(sigma_log * z - sigma_log^2/2)
    // The -sigma_log^2/2 bias correction preserves the mean at mu
    sampledValues[i] = mu * Math.exp(sigmaLog * zClamped - 0.5 * sigmaLog * sigmaLog);
  }
}

/**
 * Main Monte Carlo entry point.
 */
export function runMonteCarlo({ params, covMatrix, mse, paramNames, modelFn, tArray, nSamples, rng = Math.random }) {
  const k = paramNames.length;
  const mean = paramNames.map((name) => params[name]);

  // Compute standard deviations from the supplied covariance only
  const stdDevs = buildStdDevs(mean, covMatrix, mse ?? 0);

  // Build full covariance matrix Σ = covMatrix * mse (for Cholesky)
  let sigma = null;
  if (covMatrix && mse > 0) {
    sigma = covMatrix.map((row, i) =>
      row.map((v, j) => {
        if (i === j) return stdDevs[i] ** 2;
        const rawVar_i = Math.abs(covMatrix[i][i] * mse) || 1e-8;
        const rawVar_j = Math.abs(covMatrix[j][j] * mse) || 1e-8;
        const corr = v * mse / Math.sqrt(rawVar_i * rawVar_j);
        const clampedCorr = Math.max(-0.999, Math.min(0.999, corr));
        return clampedCorr * stdDevs[i] * stdDevs[j];
      })
    );
  }

  // Try Cholesky on the regularised sigma
  let L = null;
  let correlationIgnored = false;
  if (sigma) {
    try {
      L = cholesky(sigma);
    } catch {
      L = null;
    }
  }
  if (!L) {
    correlationIgnored = !!covMatrix && stdDevs.some(sd => sd > 0);
  }

  // Storage: for each t index, collect all logN samples
  const tLen = tArray.length;
  const allSamples = Array.from({ length: tLen }, () => []);

  // Storage for GSA: paramSamples[paramIndex][sampleIndex]
  const paramSamples = Array.from({ length: k }, () => []);
  const initialLogNSamples = [];
  const independentParamSamples = Array.from({ length: k }, () => []);

  for (let s = 0; s < nSamples; s++) {
    const sampledValues = L
      ? sampleMVN(mean, L, rng)
      : sampleDiagonal(mean, stdDevs, rng);

    // Transform positive params to log-normal space
    applyLogNormalForPositive(sampledValues, mean, stdDevs, paramNames);

    const sampledParams = {};
    paramNames.forEach((name, i) => { sampledParams[name] = sampledValues[i]; });

    const clampedParams = clampSampledParams(sampledParams);

    // Keep sample identity across time and GSA inputs. A partially invalid
    // curve cannot contribute to first-passage or probability calculations.
    const curve = tArray.map(t => modelFn(t, clampedParams));
    const initialLogN = modelFn(0, clampedParams);
    if (!Number.isFinite(initialLogN) || !curve.every(Number.isFinite)) continue;
    initialLogNSamples.push(initialLogN);
    paramNames.forEach((name, i) => { paramSamples[i].push(clampedParams[name]); });
    paramNames.forEach((name, i) => independentParamSamples[i].push(clampedParams[name]));
    curve.forEach((logN, ti) => allSamples[ti].push(logN));
  }

  // Compute percentile bands
  const bands = tArray.map((t, ti) => {
    const sorted = allSamples[ti].slice().sort((a, b) => a - b);
    if (sorted.length === 0) return { t, p5: null, p25: null, p50: null, p75: null, p95: null };
    return {
      t,
      p5:  percentile(sorted, 5),
      p25: percentile(sorted, 25),
      p50: percentile(sorted, 50),
      p75: percentile(sorted, 75),
      p95: percentile(sorted, 95),
    };
  });

  const finalLogNSamples = allSamples[tLen - 1]?.slice() ?? [];
  const convergence = checkConvergence(allSamples, tLen);
  const covarianceMode = stdDevs.every(sd => sd === 0) ? 'deterministic' : L ? 'full' : (correlationIgnored ? 'diagonal_fallback' : 'diagonal');

  return { initialLogNSamples, independentParamSamples, bands, tArray: [...tArray], rejectedSamples: nSamples - finalLogNSamples.length, finalLogNSamples, allSamples, correlationIgnored, covarianceMode, convergence, paramSamples, paramNames };
}

/**
 * Monte Carlo entry point for predicted (secondary-model) parameters.
 *
 * Uses predictedParams as the sampling center. Rescales the primary fit's
 * covariance structure proportionally so uncertainty tracks the predicted values.
 * Parameters remain deterministic if no primary fit covariance is available.
 */
export function runMonteCarloFromPredicted({ predictedParams, primaryFit, paramNames, modelFn, tArray, nSamples, rng = Math.random }) {
  const mean = paramNames.map((name) => predictedParams[name]);

  let covMatrix = null;
  let mse = 0;

  if (primaryFit?.covMatrix && !primaryFit.failed && primaryFit?.mse > 0 &&
      primaryFit.paramNames?.length === paramNames.length &&
      primaryFit.paramNames.every((n, i) => n === paramNames[i])) {
    const fittedMean = primaryFit.paramNames.map((name) => primaryFit.params[name]);
    const scaleFactors = mean.map((pred, i) => {
      const fitted = fittedMean[i];
      if (Math.abs(fitted) < 1e-10) return 1;
      return pred / fitted;
    });
    covMatrix = primaryFit.covMatrix.map((row, i) =>
      row.map((v, j) => v * scaleFactors[i] * scaleFactors[j])
    );
    mse = primaryFit.mse;
  }

  const params = {};
  paramNames.forEach((name, i) => { params[name] = mean[i]; });

  return runMonteCarlo({ params, covMatrix, mse, paramNames, modelFn, tArray, nSamples, rng });
}

/**
 * Monte Carlo with environmental factor sampling for GSA.
 *
 * Extends runMonteCarloFromPredicted by also sampling environmental factors
 * (T, P, aw) each iteration. For each sample:
 *   1. Perturb factors: factor_s = factor_mean + N(0, σ)
 *   2. Re-predict primary params at perturbed factors via secondary model
 *   3. Add model parameter noise from covariance structure
 *   4. Run inactivation model
 *
 * This lets the GSA separate "process control" variance from "model knowledge" variance.
 */
export function runMonteCarloWithFactors({
  predictedParams, primaryFit, paramNames, modelFn, tArray, nSamples,
  factorValues, factorSDs, factorKeys, predictParamsFn,
  fittedSecondaryModels, bindings, predictParamsFnFactory,
  rng = Math.random,
}) {
  const k = paramNames.length;
  const nominalMean = paramNames.map((name) => predictedParams[name]);

  // Build covariance and stdDevs once from nominal predicted params
  let covMatrix = null;
  let mse = 0;
  if (primaryFit?.covMatrix && !primaryFit.failed && primaryFit?.mse > 0 &&
      primaryFit.paramNames?.length === paramNames.length &&
      primaryFit.paramNames.every((n, i) => n === paramNames[i])) {
    const fittedMean = primaryFit.paramNames.map((name) => primaryFit.params[name]);
    const scaleFactors = nominalMean.map((pred, i) => {
      const fitted = fittedMean[i];
      if (Math.abs(fitted) < 1e-10) return 1;
      return pred / fitted;
    });
    covMatrix = primaryFit.covMatrix.map((row, i) =>
      row.map((v, j) => v * scaleFactors[i] * scaleFactors[j])
    );
    mse = primaryFit.mse;
  }

  const stdDevs = buildStdDevs(nominalMean, covMatrix, mse ?? 0);

  // Build Cholesky for model param noise
  let sigma = null;
  if (covMatrix && mse > 0) {
    sigma = covMatrix.map((row, i) =>
      row.map((v, j) => {
        if (i === j) return stdDevs[i] ** 2;
        const rawVar_i = Math.abs(covMatrix[i][i] * mse) || 1e-8;
        const rawVar_j = Math.abs(covMatrix[j][j] * mse) || 1e-8;
        const corr = v * mse / Math.sqrt(rawVar_i * rawVar_j);
        const clampedCorr = Math.max(-0.999, Math.min(0.999, corr));
        return clampedCorr * stdDevs[i] * stdDevs[j];
      })
    );
  }
  let L = null;
  let correlationIgnored = false;
  if (sigma) {
    try { L = cholesky(sigma); } catch { L = null; }
  }
  if (!L) correlationIgnored = !!covMatrix && stdDevs.some(sd => sd > 0);

  // ── Prepare secondary model parameter sampling ──
  // Collect unique secondary fits that are bound to primary params
  const secFitEntries = []; // { fitKey, fit, paramNames, mean, L, stdDevs, labels }
  const secParamNamesList = [];  // flat list of all secondary param names (prefixed)
  const secParamLabelsList = []; // flat list of display labels

  if (fittedSecondaryModels && bindings) {
    const seenFitKeys = new Set();
    for (const [, fitKey] of Object.entries(bindings)) {
      if (!fitKey || seenFitKeys.has(fitKey)) continue;
      seenFitKeys.add(fitKey);
      const fit = fittedSecondaryModels[fitKey];
      if (!fit?.params || fit.failed || !fit.paramNames?.length) continue;

      // Only sample non-fixed params (those with non-zero variance)
      const fittedParamNames = secondaryUncertainParamNames(fit);
      if (fittedParamNames.length === 0) continue;

      const indices = fittedParamNames.map(n => fit.paramNames.indexOf(n));
      const secMean = fittedParamNames.map(n => fit.params[n]);

      // Build covariance sub-matrix for non-fixed params
      let secL = null;
      let secStdDevs;
      if (fit.covMatrix && fit.mse > 0) {
        const subCov = indices.map(i => indices.map(j => fit.covMatrix[i][j] * fit.mse));
        secStdDevs = secMean.map((_, idx) => {
          const variance = subCov[idx][idx];
          return Number.isFinite(variance) && variance >= 0 ? Math.sqrt(variance) : 0;
        });
        // Regularize and Cholesky
        const secSigma = subCov.map((row, i) =>
          row.map((v, j) => {
            if (i === j) return secStdDevs[i] ** 2;
            const corr = v / (Math.sqrt(Math.abs(subCov[i][i])) * Math.sqrt(Math.abs(subCov[j][j])) || 1);
            const cc = Math.max(-0.999, Math.min(0.999, corr));
            return cc * secStdDevs[i] * secStdDevs[j];
          })
        );
        try { secL = cholesky(secSigma); } catch { secL = null; }
      }
      if (!secStdDevs) {
        secStdDevs = fittedParamNames.map(n => {
          const se = fit.paramErrors?.[n] ?? 0;
          return Number.isFinite(se) && se >= 0 ? se : 0;
        });
      }

      // Build labels from secondary model definition
      const secModelDef = SECONDARY_MODELS[fit.secondaryModelId];
      const secModelParams = secModelDef?.params ?? [];
      const labels = fittedParamNames.map(n => {
        const meta = secModelParams.find(p => p.name === n);
        return meta?.label ?? n;
      });

      secFitEntries.push({
        fitKey, fit, paramNames: fittedParamNames,
        mean: secMean, L: secL, stdDevs: secStdDevs, labels,
      });

      for (let pi = 0; pi < fittedParamNames.length; pi++) {
        secParamNamesList.push(`sec:${fitKey}:${fittedParamNames[pi]}`);
        secParamLabelsList.push(labels[pi]);
      }
    }
  }

  const nSecParams = secParamNamesList.length;
  const hasSecSampling = nSecParams > 0 && predictParamsFnFactory;

  // Storage
  const tLen = tArray.length;
  const allSamples = Array.from({ length: tLen }, () => []);
  const paramSamples = Array.from({ length: k }, () => []);
  const initialLogNSamples = [];
  const independentParamSamples = Array.from({ length: k }, () => []);
  const nFactors = factorKeys.length;
  const factorSamples = Array.from({ length: nFactors }, () => []);
  const secondaryParamSamples = Array.from({ length: nSecParams }, () => []);

  for (let s = 0; s < nSamples; s++) {
    // 1. Sample environmental factors
    const fz = sampleStdNormals(nFactors, rng);
    const sampledFactors = {};
    for (let fi = 0; fi < nFactors; fi++) {
      const key = factorKeys[fi];
      const sd = factorSDs[key] || 0;
      sampledFactors[key] = (factorValues[key] ?? 0) + fz[fi] * sd;
    }
    // Also carry forward any factors not in factorKeys
    for (const key of Object.keys(factorValues)) {
      if (!(key in sampledFactors)) sampledFactors[key] = factorValues[key];
    }

    // 2. Sample secondary model params and re-predict primary params
    let sampleMean;
    let secOffset = 0;

    if (hasSecSampling) {
      // Build overridden fittedSecondaryModels with sampled params
      const overrides = {};
      for (const entry of secFitEntries) {
        const sampledSecValues = entry.L
          ? sampleMVN(entry.mean, entry.L, rng)
          : sampleDiagonal(entry.mean, entry.stdDevs, rng);

        const sampledSecParams = { ...entry.fit.params };
        entry.paramNames.forEach((n, i) => { sampledSecParams[n] = sampledSecValues[i]; });
        overrides[entry.fitKey] = { ...entry.fit, params: sampledSecParams };

        // Record secondary param samples
        for (let pi = 0; pi < entry.paramNames.length; pi++) {
          secondaryParamSamples[secOffset + pi].push(sampledSecValues[pi]);
        }
        secOffset += entry.paramNames.length;
      }

      // Merge overrides into a temporary fittedSecondaryModels
      const mergedFitted = { ...fittedSecondaryModels, ...overrides };
      const predictFn = predictParamsFnFactory(mergedFitted);
      const predicted_s = predictFn(sampledFactors);
      sampleMean = paramNames.map((name) => predicted_s?.[name] ?? NaN);
    } else if (predictParamsFn) {
      const predicted_s = predictParamsFn(sampledFactors);
      sampleMean = paramNames.map((name) => predicted_s?.[name] ?? NaN);
    } else {
      sampleMean = nominalMean;
    }

    // Invalid secondary predictions are rejected, never converted into plausible rates.
    if (sampleMean.some((value, i) => !Number.isFinite(value) ||
      (isPositiveParam(paramNames[i]) && value <= 0) ||
      (NON_NEGATIVE_PARAMS.has(paramNames[i]) && value < 0))) {
      if (hasSecSampling) secondaryParamSamples.forEach(samples => samples.pop());
      continue;
    }

    // 3. Add model parameter noise
    const noise = L
      ? sampleMVN(new Array(k).fill(0), L, rng)
      : sampleDiagonal(new Array(k).fill(0), stdDevs, rng);

    const sampledValues = sampleMean.map((mu, i) => mu + noise[i]);

    // Transform positive params to log-normal space
    applyLogNormalForPositive(sampledValues, sampleMean, stdDevs, paramNames);

    const sampledParams = {};
    paramNames.forEach((name, i) => { sampledParams[name] = sampledValues[i]; });

    const clampedParams = clampSampledParams(sampledParams);

    const curve = tArray.map(t => modelFn(t, clampedParams));
    const initialLogN = modelFn(0, clampedParams);
    if (!Number.isFinite(initialLogN) || !curve.every(Number.isFinite)) {
      // Secondary inputs were recorded during re-prediction above.
      if (hasSecSampling) secondaryParamSamples.forEach(samples => samples.pop());
      continue;
    }

    initialLogNSamples.push(initialLogN);
    // Independent primary sampling deviations are inputs; re-predicted
    // primary parameters are deterministic outputs of factor/secondary inputs.
    paramNames.forEach((name, i) => independentParamSamples[i].push(noise[i]));
    // Record samples for GSA
    for (let fi = 0; fi < nFactors; fi++) {
      factorSamples[fi].push(sampledFactors[factorKeys[fi]]);
    }
    paramNames.forEach((name, i) => { paramSamples[i].push(clampedParams[name]); });

    // 4. Store the complete accepted curve.
    curve.forEach((logN, ti) => allSamples[ti].push(logN));
  }

  // Compute percentile bands
  const bands = tArray.map((t, ti) => {
    const sorted = allSamples[ti].slice().sort((a, b) => a - b);
    if (sorted.length === 0) return { t, p5: null, p25: null, p50: null, p75: null, p95: null };
    return {
      t,
      p5: percentile(sorted, 5),
      p25: percentile(sorted, 25),
      p50: percentile(sorted, 50),
      p75: percentile(sorted, 75),
      p95: percentile(sorted, 95),
    };
  });

  const finalLogNSamples = allSamples[tLen - 1]?.slice() ?? [];
  const convergence = checkConvergence(allSamples, tLen);
  const covarianceMode = stdDevs.every(sd => sd === 0) ? 'deterministic' : L ? 'full' : (correlationIgnored ? 'diagonal_fallback' : 'diagonal');

  return {
    initialLogNSamples, independentParamSamples, bands, tArray: [...tArray], rejectedSamples: nSamples - finalLogNSamples.length, finalLogNSamples, allSamples, correlationIgnored, covarianceMode, convergence,
    paramSamples, paramNames, factorSamples, factorKeys,
    secondaryParamSamples: hasSecSampling ? secondaryParamSamples : null,
    secondaryParamNames: hasSecSampling ? secParamNamesList : null,
    secondaryParamLabels: hasSecSampling ? secParamLabelsList : null,
  };
}
