/**
 * Global Sensitivity Analysis — Standardized Regression Coefficients (SRC)
 *
 * Reuses Monte Carlo sampled inputs and outputs to quantify each parameter's
 * contribution to output variance via OLS regression on standardized variables.
 *
 * Supports two source categories:
 *   - "factor"  — environmental factors (T, P, aw) representing process control variance
 *   - "model"   — primary model parameters representing model knowledge/fitting variance
 */

import { MODELS } from './inactivationModels.js';
import { FACTOR_DEFS, SECONDARY_MODELS, MODEL_SECONDARY_CONFIG } from './secondaryModels.js';

/* ── Fallback label map for all known parameter names ────────────────── */

const PARAM_LABEL_MAP = {
  // Primary model params
  logN0: 'log₁₀(N₀)',
  kmax: 'k_max (1/min)',
  kmax1: 'k_max₁ (1/min)',
  kmax2: 'k_max₂ (1/min)',
  Sl: 'S_L (log₁₀)',
  delta: 'δ (min)',
  delta1: 'δ₁ (min)',
  delta2: 'δ₂ (min)',
  p: 'p (shape)',
  p1: 'p₁',
  p2: 'p₂',
  f: 'f (fraction)',
  A: 'A (asymptote)',
  mu: 'μ (rate)',
  h0: 'h₀',
  lambda: 'λ (min)',
  // Secondary model params — thermal
  Dref: 'D_ref (min)',
  logDref: 'log₁₀(D_ref)',
  zT: 'z_T (°C)',
  zaw: 'z_aw',
  zpH: 'z_pH',
  Tref: 'T_ref (°C)',
  awRef: 'a_w,ref',
  pHref: 'pH_ref',
  Ea: 'E_a (kJ/mol)',
  Aref: 'A_ref',
  b: 'b (√rate)',
  // Secondary model params — HPP
  zP: 'z_P (MPa)',
  Pref: 'P_ref (MPa)',
  // Secondary model params — Photoinactivation / PEF / Chemical / Irradiation
  zI: 'z_I (mW/cm²)',
  Iref: 'I_ref (mW/cm²)',
  zE: 'z_E (kV/cm)',
  Eref: 'E_ref (kV/cm)',
  zC: 'z_C (mg/L)',
  Cref: 'C_ref (mg/L)',
  zD: 'z_D (kGy)',
  Dref_irrad: 'D_ref (kGy)',
  zTurb: 'z_Turb (NTU)',
  zCond: 'z_σ (mS/cm)',
};

// A bound primary parameter is controlled by its secondary model. Sampling it
// again as an independent input would count the same mechanism twice.
function boundPrimaryParams(bindings, fittedSecondaryModels) {
  const names = new Set();
  for (const [targetKey, fitKey] of Object.entries(bindings ?? {})) {
    const fit = fittedSecondaryModels?.[fitKey];
    if (!fit?.params || fit.failed) continue;
    const configs = fit.primaryModelId
      ? [MODEL_SECONDARY_CONFIG[fit.primaryModelId]]
      : Object.values(MODEL_SECONDARY_CONFIG);
    const target = configs.find(config => config?.targets?.[targetKey])?.targets[targetKey];
    names.add(target?.mapsToParam ?? targetKey);
  }
  return names;
}

/* ── helpers ─────────────────────────────────────────────────────────── */

function mean(arr) {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
}

function std(arr, mu) {
  let s = 0;
  for (let i = 0; i < arr.length; i++) { const d = arr[i] - mu; s += d * d; }
  return Math.sqrt(s / (arr.length - 1));
}

/**
 * Solve A x = b via Gaussian elimination with partial pivoting.
 * Mutates A and b in place. Returns x or null if singular.
 */
function solveLinear(A, b) {
  const k = b.length;
  for (let col = 0; col < k; col++) {
    let maxRow = col, maxVal = Math.abs(A[col][col]);
    for (let row = col + 1; row < k; row++) {
      const v = Math.abs(A[row][col]);
      if (v > maxVal) { maxVal = v; maxRow = row; }
    }
    if (maxVal < 1e-14) return null;
    if (maxRow !== col) {
      [A[col], A[maxRow]] = [A[maxRow], A[col]];
      [b[col], b[maxRow]] = [b[maxRow], b[col]];
    }
    for (let row = col + 1; row < k; row++) {
      const factor = A[row][col] / A[col][col];
      for (let j = col; j < k; j++) A[row][j] -= factor * A[col][j];
      b[row] -= factor * b[col];
    }
  }
  const x = new Array(k);
  for (let i = k - 1; i >= 0; i--) {
    let s = b[i];
    for (let j = i + 1; j < k; j++) s -= A[i][j] * x[j];
    x[i] = s / A[i][i];
  }
  return x;
}

/** Get a display label for a factor key using FACTOR_DEFS */
function getFactorLabel(key) {
  const def = FACTOR_DEFS.find(f => f.key === key);
  if (!def) return key;
  return def.unit ? `${def.label} (${def.unit})` : def.label;
}

/* ── main GSA computation ────────────────────────────────────────────── */

/**
 * Compute Standardized Regression Coefficients with factor/param categorization.
 *
 * @param {number[][]} paramSamples   k arrays of n values (model params)
 * @param {number[]}   outputSamples  n output values (log10N at some time)
 * @param {string[]}   paramNames     k model parameter names
 * @param {number[][]} [factorSamples]  m arrays of n values (environmental factors)
 * @param {string[]}   [factorKeys]     m factor key names
 * @returns {{ results, rSquared, factorContribution, modelContribution } | null}
 */
export function computeGSA(paramSamples, outputSamples, paramNames, factorSamples, factorKeys, modelId,
  secondaryParamSamples, secondaryParamNames, secondaryParamLabels) {
  const n = outputSamples?.length ?? 0;
  if (!paramSamples || !outputSamples || !outputSamples.every(Number.isFinite) || n < 10) return null;

  const yMu = mean(outputSamples);
  const yStd = std(outputSamples, yMu);
  if (yStd < 1e-12) return null;

  const zY = new Array(n);
  for (let i = 0; i < n; i++) zY[i] = (outputSamples[i] - yMu) / yStd;

  // Build unified column list: factors first, then model params
  // Each entry: { name, label, category, samples }
  const columns = [];

  // Factor columns
  const fKeys = factorKeys ?? [];
  const fSamples = factorSamples ?? [];
  for (let fi = 0; fi < fKeys.length; fi++) {
    const col = fSamples[fi];
    if (!col || col.length !== n) continue;
    columns.push({
      name: fKeys[fi],
      label: getFactorLabel(fKeys[fi]),
      category: 'factor',
      samples: col,
    });
  }

  // Model param columns
  const modelDef = (modelId && MODELS[modelId]) || Object.values(MODELS).find(m =>
    m.params.some(p => paramNames.includes(p.name))
  );
  const paramMeta = modelDef?.params ?? [];

  for (let j = 0; j < paramNames.length; j++) {
    const col = paramSamples[j];
    if (!col || col.length !== n) continue;
    const meta = paramMeta.find(p => p.name === paramNames[j]);
    columns.push({
      name: paramNames[j],
      label: meta?.label ?? PARAM_LABEL_MAP[paramNames[j]] ?? paramNames[j],
      category: 'model',
      samples: col,
    });
  }

  // Secondary model param columns
  const secNames = secondaryParamNames ?? [];
  const secSamples = secondaryParamSamples ?? [];
  const secLabels = secondaryParamLabels ?? [];
  for (let si = 0; si < secNames.length; si++) {
    const col = secSamples[si];
    if (!col || col.length !== n) continue;
    const rawName = secNames[si].replace(/^sec:[^:]+:/, '');
    columns.push({
      name: secNames[si],
      label: secLabels[si] ?? PARAM_LABEL_MAP[rawName] ?? rawName,
      category: 'secondary',
      samples: col,
    });
  }

  // Compute stats and filter zero-variance columns
  const colStats = columns.map((c, idx) => {
    const mu = mean(c.samples);
    const sd = std(c.samples, mu);
    return { ...c, idx, mu, sd, active: sd > 1e-12 };
  });

  const activeStats = colStats.filter(s => s.active);
  const activeK = activeStats.length;
  if (activeK === 0) return null;

  // Build standardized X columns
  const zX = activeStats.map(({ samples, mu, sd }) => {
    const z = new Array(n);
    for (let i = 0; i < n; i++) z[i] = (samples[i] - mu) / sd;
    return z;
  });

  // OLS: (X^T X) beta = X^T y
  const XtX = Array.from({ length: activeK }, () => new Array(activeK).fill(0));
  const XtY = new Array(activeK).fill(0);

  for (let a = 0; a < activeK; a++) {
    for (let i = 0; i < n; i++) XtY[a] += zX[a][i] * zY[i];
    for (let b = a; b < activeK; b++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += zX[a][i] * zX[b][i];
      XtX[a][b] = s;
      XtX[b][a] = s;
    }
  }

  let beta = solveLinear(XtX, XtY);

  // A singular regression cannot be reported as SRC.
  if (!beta) return null;

  // Map SRC back to all columns
  const totalCols = colStats.length;
  const srcAll = new Array(totalCols).fill(0);
  if (beta) {
    activeStats.forEach((stat, a) => { srcAll[stat.idx] = beta[a]; });
  }

  // Compute proper R² from residuals (robust to correlated inputs)
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    let yHat = 0;
    for (let a = 0; a < activeK; a++) yHat += beta[a] * zX[a][i];
    ssRes += (zY[i] - yHat) ** 2;
    ssTot += zY[i] * zY[i];
  }
  const rSquared = ssTot > 0 ? Math.max(0, Math.min(1, 1 - ssRes / ssTot)) : 0;

  // Normalize contributions by Σ(SRC²) so they always sum to 100%
  const sumSrc2 = srcAll.reduce((s, v) => s + v * v, 0);
  const totalSrc2 = sumSrc2 > 1e-14 ? sumSrc2 : 1;

  const results = colStats.filter(c => c.active).map(c => ({
    param: c.name,
    label: c.label,
    src: srcAll[c.idx],
    contribution: (srcAll[c.idx] * srcAll[c.idx] / totalSrc2) * 100,
    category: c.category,
  }));

  results.sort((a, b) => b.contribution - a.contribution);

  // Category subtotals
  let factorContribution = 0;
  let modelContribution = 0;
  let secondaryContribution = 0;
  for (const r of results) {
    if (r.category === 'factor') factorContribution += r.contribution;
    else if (r.category === 'secondary') secondaryContribution += r.contribution;
    else modelContribution += r.contribution;
  }

  return {
    results,
    rSquared: Math.min(rSquared, 1),
    factorContribution: Math.round(factorContribution * 10) / 10,
    modelContribution: Math.round(modelContribution * 10) / 10,
    secondaryContribution: Math.round(secondaryContribution * 10) / 10,
  };
}

/* ── smart conclusions ───────────────────────────────────────────────── */

/**
 * Generate hierarchical conclusions from GSA results.
 */
export function generateConclusions(results, modelId, factorContribution, modelContribution, secondaryContribution, outputMetric = 'finalLogN') {
  if (!results || results.length === 0) return [];

  const model = MODELS[modelId];
  const secondaryTargets = new Set(model?.secondaryTargets ?? []);
  const lines = [];

  const hasFactors = results.some(r => r.category === 'factor');
  const hasSecondary = results.some(r => r.category === 'secondary');

  // ── Primary contradiction summary (always first) ──
  if (hasFactors && factorContribution != null && modelContribution != null) {
    const dominantFactor = results.find(r => r.category === 'factor');

    if (factorContribution > modelContribution) {
      const factorLabel = dominantFactor?.label ?? 'process factors';
      lines.push(
        `Process factors account for ${factorContribution.toFixed(1)}% of normalized influence in this analysis. ` +
        `The leading process input is ${factorLabel}.`
      );
    } else {
      lines.push(
        `Primary parameters account for ${modelContribution.toFixed(1)}% of normalized influence in this analysis. ` +
        `Additional data may help constrain these parameters.`
      );
    }
  }

  // ── Secondary model insight ──
  if (hasSecondary && secondaryContribution > 15) {
    const topSec = results.filter(r => r.category === 'secondary' && r.contribution > 10);
    if (topSec.length > 0) {
      const names = topSec.map(r => `"${r.label}"`).join(', ');
      lines.push(
        `The secondary parameter group, led by ${names}, contributes ${secondaryContribution.toFixed(1)}% of normalized influence. ` +
        `Consider collecting more data to refine secondary model fitting.`
      );
    }
  }

  // ── Individual factor insights ──
  const topFactors = results.filter(r => r.category === 'factor' && r.contribution > 40);
  for (const f of topFactors) {
    lines.push(`${f.label} has high relative influence within the selected input ranges (${f.contribution.toFixed(1)}%).`);
  }

  // ── Model parameter insights ──
  if (!hasFactors || modelContribution > 50) {
    const dominant = results.find(r => r.category === 'model');
    if (dominant && dominant.contribution > 30) {
      const secondaryTargets2 = new Set(model?.secondaryTargets ?? []);
      if (secondaryTargets2.has(dominant.param)) {
        lines.push(
          `Model parameter "${dominant.label}" contributes ${dominant.contribution.toFixed(1)}% — ` +
          `consider refining secondary model fitting to reduce prediction uncertainty.`
        );
      }
    }
  }

  // ── Secondary model refinement ──
  const highSensSecondary = results.filter(r =>
    r.category === 'model' && secondaryTargets.has(r.param) && r.contribution > 25
  );
  if (highSensSecondary.length > 0) {
    const names = highSensSecondary.map(r => `"${r.label}"`).join(', ');
    lines.push(
      `Model uncertainty is high for ${names}. Consider refining secondary model fitting.`
    );
  }

  // ── Negligible items ──
  const negligible = results.filter(r => r.contribution < 5);
  if (negligible.length > 0) {
    const names = negligible.map(r => `"${r.label}"`).join(', ');
    lines.push(
      `${names} ${negligible.length > 1 ? 'have' : 'has'} less than 5% normalized influence in this analysis. ` +
      `This ranking alone does not justify treating these inputs as fixed.`
    );
  }

  // ── Directional insights ──
  const top = results.filter(r => r.contribution >= 10 && Number.isFinite(r.src));
  const outputLabel = { finalLogN: 'surviving organisms', logReduction: 'log reduction', timeToTarget: 'required treatment time (capped at the simulation horizon)', successProb: 'target achievement probability' }[outputMetric] ?? outputMetric;
  const positives = top.filter(r => r.src > 0);
  const negatives = top.filter(r => r.src < 0);
  if (positives.length > 0) {
    lines.push(
      `Increasing ${positives.map(r => `"${r.label}"`).join(', ')} tends to increase ${outputLabel}.`
    );
  }
  if (negatives.length > 0) {
    lines.push(
      `Increasing ${negatives.map(r => `"${r.label}"`).join(', ')} tends to decrease ${outputLabel}.`
    );
  }

  return lines;
}

/* ── OAT (One-At-a-Time) Local Sensitivity ──────────────────────────── */

/**
 * Compute local sensitivity by perturbing each factor/param ±δ% around its
 * nominal value and measuring the output change. Every factor always appears
 * in the result regardless of its MC standard deviation setting.
 *
 * @param {Function} modelFn          (t, params) => logN
 * @param {Object}   nominalParams    { paramName: value }
 * @param {string[]} paramNames       model parameter names
 * @param {number}   tEval            time point at which to evaluate
 * @param {Function} [predictParamsFn]  (factors) => predicted params
 * @param {Object}   [factorValues]   { factorKey: nominalValue }
 * @param {string[]} [factorKeys]     factor keys to perturb
 * @param {number}   [delta=0.05]     fractional perturbation (5%)
 * @returns {{ results, factorContribution, modelContribution } | null}
 */
export function computeOATSensitivity({
  modelFn, nominalParams, paramNames, modelId, timeUnitToMin = 1, tEval,
  predictParamsFn, factorValues, factorKeys,
  fittedSecondaryModels, bindings, predictParamsFnFactory,
  delta = 0.05,
}) {
  if (!modelFn || !nominalParams || !paramNames) return null;

  const baseOutput = modelFn(tEval, nominalParams);
  if (!Number.isFinite(baseOutput)) return null;

  const entries = []; // { name, label, category, sensitivity (dY/dX normalized) }

  // ── Factor perturbation ──
  const fKeys = factorKeys ?? [];
  if (predictParamsFn && factorValues && fKeys.length > 0) {
    for (const key of fKeys) {
      const nominal = factorValues[key] ?? 0;
      const step = nominal !== 0 ? Math.abs(nominal) * delta : delta;

      const factorsHi = { ...factorValues, [key]: nominal + step };
      const factorsLo = { ...factorValues, [key]: nominal - step };

      const paramsHi = predictParamsFn(factorsHi);
      const paramsLo = predictParamsFn(factorsLo);

      if (!paramsHi || !paramsLo) continue;

      const yHi = modelFn(tEval, paramsHi);
      const yLo = modelFn(tEval, paramsLo);

      if (!Number.isFinite(yHi) || !Number.isFinite(yLo)) continue;

      const dY = (yHi - yLo) / 2;
      entries.push({
        name: key,
        label: getFactorLabel(key),
        category: 'factor',
        sensitivity: Math.abs(dY),
        direction: dY,
      });
    }
  }

  // ── Model parameter perturbation ──
  const modelDef = MODELS[modelId] ?? Object.values(MODELS).find(m => m.params.length === paramNames.length && m.params.every(p => paramNames.includes(p.name)));
  const paramMeta = modelDef?.params ?? [];

  const boundParams = boundPrimaryParams(bindings, fittedSecondaryModels);
  for (const name of paramNames) {
    if (boundParams.has(name) && predictParamsFn) continue;
    const nominal = nominalParams[name];
    if (nominal == null) continue;
    const meta = paramMeta.find(p => p.name === name);
    const dimensionScale = meta?.role === 'rate' ? timeUnitToMin : ['time', 'timeScale'].includes(meta?.role) ? 1 / timeUnitToMin : 1;
    const step = nominal !== 0 ? Math.abs(nominal) * delta : delta * (Number.isFinite(dimensionScale) ? dimensionScale : 1);

    const paramsHi = { ...nominalParams, [name]: nominal + step };
    const paramsLo = { ...nominalParams, [name]: nominal - step };

    const yHi = modelFn(tEval, paramsHi);
    const yLo = modelFn(tEval, paramsLo);

    if (!Number.isFinite(yHi) || !Number.isFinite(yLo)) continue;

    const dY = (yHi - yLo) / 2;
    entries.push({
      name,
      label: meta?.label ?? PARAM_LABEL_MAP[name] ?? name,
      category: 'model',
      sensitivity: Math.abs(dY),
      direction: dY,
    });
  }

  // ── Secondary model parameter perturbation ──
  if (fittedSecondaryModels && bindings && predictParamsFnFactory && factorValues) {
    const seenFitKeys = new Set();
    for (const [, fitKey] of Object.entries(bindings)) {
      if (!fitKey || seenFitKeys.has(fitKey)) continue;
      seenFitKeys.add(fitKey);
      const fit = fittedSecondaryModels[fitKey];
      if (!fit?.params || fit.failed || !fit.paramNames?.length) continue;

      const fittedParamNames = fit.paramNames.filter(n => {
        const se = fit.paramErrors?.[n];
        return se != null && se > 0;
      });
      if (fittedParamNames.length === 0) continue;

      const secModelDef = SECONDARY_MODELS[fit.secondaryModelId];
      const secModelParams = secModelDef?.params ?? [];

      for (const secName of fittedParamNames) {
        const nominal = fit.params[secName];
        if (nominal == null) continue;
        const step = nominal !== 0 ? Math.abs(nominal) * delta : delta;

        const overrideHi = { ...fittedSecondaryModels, [fitKey]: { ...fit, params: { ...fit.params, [secName]: nominal + step } } };
        const overrideLo = { ...fittedSecondaryModels, [fitKey]: { ...fit, params: { ...fit.params, [secName]: nominal - step } } };

        const predictHi = predictParamsFnFactory(overrideHi);
        const predictLo = predictParamsFnFactory(overrideLo);

        const paramsHi = predictHi(factorValues);
        const paramsLo = predictLo(factorValues);
        if (!paramsHi || !paramsLo) continue;

        const yHi = modelFn(tEval, paramsHi);
        const yLo = modelFn(tEval, paramsLo);
        if (!Number.isFinite(yHi) || !Number.isFinite(yLo)) continue;

        const dY = (yHi - yLo) / 2;
        const meta = secModelParams.find(p => p.name === secName);
        const rawName = secName;
        entries.push({
          name: `sec:${fitKey}:${secName}`,
          label: meta?.label ?? PARAM_LABEL_MAP[rawName] ?? rawName,
          category: 'secondary',
          sensitivity: Math.abs(dY),
          direction: dY,
        });
      }
    }
  }

  if (entries.length === 0) return null;

  // Normalize to percentage contributions
  const totalSens = entries.reduce((s, e) => s + e.sensitivity, 0);
  if (totalSens < 1e-14) return null;

  const results = entries.map(e => ({
    param: e.name,
    label: e.label,
    src: e.direction / totalSens, // normalized direction for color coding
    contribution: (e.sensitivity / totalSens) * 100,
    category: e.category,
  }));

  results.sort((a, b) => b.contribution - a.contribution);

  let factorContribution = 0;
  let modelContribution = 0;
  let secondaryContribution = 0;
  for (const r of results) {
    if (r.category === 'factor') factorContribution += r.contribution;
    else if (r.category === 'secondary') secondaryContribution += r.contribution;
    else modelContribution += r.contribution;
  }

  return {
    results,
    rSquared: null, // not applicable for OAT
    factorContribution: Math.round(factorContribution * 10) / 10,
    modelContribution: Math.round(modelContribution * 10) / 10,
    secondaryContribution: Math.round(secondaryContribution * 10) / 10,
  };
}

/* ── Parameter range builder (shared by Morris & Sobol) ─────────────── */

// Use the intersection of bound fits' calibration boxes. Explicit overrides
// support a deliberate alternative domain without changing shared factor metadata.
function resolveGlobalFactorRanges({ factorKeys, fittedSecondaryModels, bindings, factorRanges }) {
  const ranges = {};
  const fits = [...new Set(Object.values(bindings ?? {}))]
    .map(key => fittedSecondaryModels?.[key]).filter(fit => fit?.params && !fit.failed);
  for (const key of factorKeys ?? []) {
    const calibration = fits.flatMap(fit => {
      const values = (fit.rows ?? []).map(row => row.factors?.[key]);
      return values.length >= 2 && values.every(Number.isFinite)
        ? [{ min: Math.min(...values), max: Math.max(...values) }] : [];
    });
    const range = factorRanges?.[key] ?? (calibration.length ? {
      min: Math.max(...calibration.map(box => box.min)),
      max: Math.min(...calibration.map(box => box.max)),
    } : null);
    if (!range) continue;
    if (!Number.isFinite(range.min) || !Number.isFinite(range.max) || range.min > range.max) {
      throw new RangeError(`Invalid global sensitivity range for ${key}.`);
    }
    ranges[key] = { min: range.min, max: range.max };
  }
  return ranges;
}

function applyFixedGlobalFactors(factorValues, ranges) {
  const factors = { ...factorValues };
  for (const [key, range] of Object.entries(ranges)) {
    if (range.min === range.max) factors[key] = range.min;
  }
  return factors;
}

function buildParamSpecs({
  nominalParams, paramNames, modelId, timeUnitToMin,
  predictParamsFn, factorValues, factorKeys,
  fittedSecondaryModels, bindings, predictParamsFnFactory, factorRanges,
  spreadFraction = 0.20,
}) {
  const specs = [];

  const modelDef = MODELS[modelId] ?? Object.values(MODELS).find(m => m.params.length === paramNames.length && m.params.every(p => paramNames.includes(p.name)));
  const paramMeta = modelDef?.params ?? [];

  const fKeys = factorKeys ?? [];
  if (predictParamsFn && factorValues && fKeys.length > 0) {
    for (const key of fKeys) {
      const nom = factorValues[key] ?? 0;
      const def = FACTOR_DEFS.find(f => f.key === key);
      let lo, hi;
      if (factorRanges?.[key]) {
        lo = factorRanges[key].min; hi = factorRanges[key].max;
      } else if (def?.min != null && def?.max != null) {
        lo = def.min; hi = def.max;
      } else {
        const spread = Math.max(Math.abs(nom) * spreadFraction, 1e-6);
        lo = nom - spread; hi = nom + spread;
      }
      specs.push({ name: key, label: getFactorLabel(key), category: 'factor', nominal: nom, lo, hi });
    }
  }

  const boundParams = boundPrimaryParams(bindings, fittedSecondaryModels);
  for (const name of paramNames) {
    if (boundParams.has(name) && predictParamsFn) continue;
    const nom = nominalParams[name];
    if (nom == null) continue;
    const meta = paramMeta.find(p => p.name === name);
    const dimensional = ['rate', 'time', 'timeScale'].includes(meta?.role);
    const boundScale = meta?.role === 'rate' ? timeUnitToMin : ['time', 'timeScale'].includes(meta?.role) ? 1 / timeUnitToMin : 1;
    const zeroSpread = 1e-6 * (Number.isFinite(boundScale) && boundScale > 0 ? boundScale : 1);
    const spread = Math.max(Math.abs(nom) * spreadFraction, dimensional && nom !== 0 ? Number.MIN_VALUE : zeroSpread);
    const lower = dimensional ? Number.isFinite(boundScale) && boundScale > 0 ? (meta?.min ?? 0) * boundScale : meta?.nonNegative ? 0 : Number.MIN_VALUE : meta?.min ?? -Infinity;
    const upper = Number.isFinite(meta?.max) && dimensional ? meta.max * (Number.isFinite(boundScale) ? boundScale : 1) : meta?.max ?? Infinity;
    let lo = Math.max(nom - spread, lower);
    let hi = Math.min(nom + spread, upper);
    // Rectangular domain stays within the coupled residual < initial count constraint.
    if (name === 'logNres') hi = Math.min(hi, Math.max(nominalParams.logN0 - Math.max(Math.abs(nominalParams.logN0) * spreadFraction, 1e-6), nom + 1e-9) - 1e-9);
    if (name === 'logN0' && Number.isFinite(nominalParams.logNres)) lo = Math.max(lo, nominalParams.logNres + 1e-9);
    if (!(hi > lo)) continue;
    specs.push({ name, label: meta?.label ?? PARAM_LABEL_MAP[name] ?? name, category: 'model', nominal: nom, lo, hi });
  }

  if (fittedSecondaryModels && bindings && predictParamsFnFactory && factorValues) {
    const seen = new Set();
    for (const [, fitKey] of Object.entries(bindings)) {
      if (!fitKey || seen.has(fitKey)) continue;
      seen.add(fitKey);
      const fit = fittedSecondaryModels[fitKey];
      if (!fit?.params || fit.failed || !fit.paramNames?.length) continue;
      const secModelDef = SECONDARY_MODELS[fit.secondaryModelId];
      const secParams = secModelDef?.params ?? [];
      for (const secName of fit.paramNames) {
        const se = fit.paramErrors?.[secName];
        if (se == null || se <= 0) continue;
        const nom = fit.params[secName];
        if (nom == null) continue;
        const spread = Math.max(3 * se, Math.abs(nom) * spreadFraction, 1e-6);
        const meta = secParams.find(p => p.name === secName);
        specs.push({
          name: `sec:${fitKey}:${secName}`, label: meta?.label ?? PARAM_LABEL_MAP[secName] ?? secName,
          category: 'secondary', nominal: nom, lo: Math.max(nom - spread, meta?.min ?? -Infinity), hi: Math.min(nom + spread, meta?.max ?? Infinity),
          _fitKey: fitKey, _secName: secName,
        });
      }
    }
  }

  return specs.filter(s => Number.isFinite(s.lo) && Number.isFinite(s.hi) && s.hi > s.lo);
}

function evaluateAtPoint(specs, values, { modelFn, tEval, nominalParams, predictParamsFn, factorValues, fittedSecondaryModels, predictParamsFnFactory }) {
  const factors = factorValues ? { ...factorValues } : {};
  let params = { ...nominalParams };
  const directParams = {};
  let secOverrides = null;

  for (let i = 0; i < specs.length; i++) {
    const s = specs[i];
    if (s.category === 'factor') {
      factors[s.name] = values[i];
    } else if (s.category === 'model') {
      directParams[s.name] = values[i];
    } else if (s.category === 'secondary') {
      if (!secOverrides) secOverrides = JSON.parse(JSON.stringify(fittedSecondaryModels));
      secOverrides[s._fitKey].params[s._secName] = values[i];
    }
  }

  if (Object.keys(factors).length > 0 && (predictParamsFn || predictParamsFnFactory)) {
    const predict = secOverrides ? predictParamsFnFactory(secOverrides) : predictParamsFn;
    if (predict) {
      const predicted = predict(factors);
      if (!predicted || Object.values(predicted).some(value => !Number.isFinite(value))) return NaN;
      params = { ...params, ...predicted };
    }
  }

  const combined = { ...params, ...directParams };
  if (Number.isFinite(combined.logNres) && !(combined.logNres < combined.logN0)) return NaN;
  return modelFn(tEval, combined);
}

/* ── Morris Elementary Effects ──────────────────────────────────────── */

export function computeMorris({
  modelFn, nominalParams, paramNames, modelId, timeUnitToMin, tEval,
  predictParamsFn, factorValues, factorKeys,
  fittedSecondaryModels, bindings, predictParamsFnFactory, factorRanges,
  r = 10, pLevels = 4, rng = Math.random,
}) {
  const ranges = resolveGlobalFactorRanges({ factorKeys, fittedSecondaryModels, bindings, factorRanges });
  const effectiveFactors = applyFixedGlobalFactors(factorValues, ranges);
  const ctx = { modelFn, tEval, nominalParams, predictParamsFn, factorValues: effectiveFactors, fittedSecondaryModels, bindings, predictParamsFnFactory };
  const specs = buildParamSpecs({ nominalParams, paramNames, modelId, timeUnitToMin, predictParamsFn, factorValues: effectiveFactors, factorKeys, fittedSecondaryModels, bindings, predictParamsFnFactory, factorRanges: ranges });
  const k = specs.length;
  if (k === 0) return null;

  const delta = pLevels / (2 * (pLevels - 1));
  const eeMatrix = specs.map(() => []);

  for (let ri = 0; ri < r; ri++) {
    const base = specs.map(s => {
      const grid = Math.floor(rng() * pLevels) / (pLevels - 1);
      return s.lo + grid * (s.hi - s.lo);
    });

    const order = Array.from({ length: k }, (_, i) => i);
    for (let i = k - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }

    let current = [...base];
    let yPrev = evaluateAtPoint(specs, current, ctx);
    if (!Number.isFinite(yPrev)) continue;

    const trajectoryEffects = [];
    let validTrajectory = true;
    for (const idx of order) {
      const next = [...current];
      const sign = rng() < 0.5 ? -1 : 1;
      const step = sign * delta * (specs[idx].hi - specs[idx].lo);
      next[idx] = Math.max(specs[idx].lo, Math.min(specs[idx].hi, next[idx] + step));

      const yNext = evaluateAtPoint(specs, next, ctx);
      if (!Number.isFinite(yNext)) { validTrajectory = false; break; }

      const actualStep = next[idx] - current[idx];
      if (Math.abs(actualStep / (specs[idx].hi - specs[idx].lo)) > 1e-14) {
        trajectoryEffects.push([idx, (yNext - yPrev) / (actualStep / (specs[idx].hi - specs[idx].lo))]);
      }
      current = next;
      yPrev = yNext;
    }
    if (validTrajectory) for (const [idx, effect] of trajectoryEffects) eeMatrix[idx].push(effect);
  }

  const entries = [];
  for (let i = 0; i < k; i++) {
    const ee = eeMatrix[i];
    if (ee.length === 0) continue;
    const muStar = ee.reduce((s, v) => s + Math.abs(v), 0) / ee.length;
    const muRaw = ee.reduce((s, v) => s + v, 0) / ee.length;
    const sigma = ee.length > 1 ? Math.sqrt(ee.reduce((s, v) => s + (v - muRaw) ** 2, 0) / (ee.length - 1)) : 0;
    entries.push({ ...specs[i], muStar, sigma, mu: muRaw });
  }

  if (entries.length === 0) return null;
  const totalMuStar = entries.reduce((s, e) => s + e.muStar, 0) || 1;

  const results = entries.map(e => ({
    param: e.name, label: e.label, category: e.category,
    muStar: e.muStar, sigma: e.sigma,
    contribution: (e.muStar / totalMuStar) * 100,
    src: e.mu >= 0 ? 1 : -1,
  }));
  results.sort((a, b) => b.contribution - a.contribution);

  let factorContribution = 0, modelContribution = 0, secondaryContribution = 0;
  for (const r2 of results) {
    if (r2.category === 'factor') factorContribution += r2.contribution;
    else if (r2.category === 'secondary') secondaryContribution += r2.contribution;
    else modelContribution += r2.contribution;
  }

  return {
    results, rSquared: null,
    factorContribution: Math.round(factorContribution * 10) / 10,
    modelContribution: Math.round(modelContribution * 10) / 10,
    secondaryContribution: Math.round(secondaryContribution * 10) / 10,
    inputRanges: specs.map(({ name, category, lo, hi }) => ({ name, category, lo, hi })),
    factorRanges: ranges,
  };
}
/* ── Sobol Total-Order (Jansen estimator) ───────────────────────────── */

export function computeSobolTotal({
  modelFn, nominalParams, paramNames, modelId, timeUnitToMin, tEval,
  predictParamsFn, factorValues, factorKeys,
  fittedSecondaryModels, bindings, predictParamsFnFactory, factorRanges,
  N = 128, rng = Math.random,
}) {
  const ranges = resolveGlobalFactorRanges({ factorKeys, fittedSecondaryModels, bindings, factorRanges });
  const effectiveFactors = applyFixedGlobalFactors(factorValues, ranges);
  const ctx = { modelFn, tEval, nominalParams, predictParamsFn, factorValues: effectiveFactors, fittedSecondaryModels, bindings, predictParamsFnFactory };
  const specs = buildParamSpecs({ modelFn, nominalParams, paramNames, modelId, timeUnitToMin, tEval, predictParamsFn, factorValues: effectiveFactors, factorKeys, fittedSecondaryModels, bindings, predictParamsFnFactory, factorRanges: ranges });
  const k = specs.length;
  if (k === 0) return null;

  const sampleUniform = () => specs.map(s => s.lo + rng() * (s.hi - s.lo));

  const matA = Array.from({ length: N }, sampleUniform);
  const matB = Array.from({ length: N }, sampleUniform);

  const fA = matA.map(row => evaluateAtPoint(specs, row, ctx));
  const fB = matB.map(row => evaluateAtPoint(specs, row, ctx));

  const validA = fA.filter(Number.isFinite);
  const validB = fB.filter(Number.isFinite);
  if (validA.length < N * 0.5 || validB.length < N * 0.5) return null;

  const allY = [...fA, ...fB].filter(Number.isFinite);
  const yMean = allY.reduce((s, v) => s + v, 0) / allY.length;
  const varY = allY.reduce((s, v) => s + (v - yMean) ** 2, 0) / (allY.length - 1);
  if (varY < 1e-14) return null;

  const stValues = [];
  const s1Values = [];
  const s1Warnings = [];
  for (let i = 0; i < k; i++) {
    const fABi = [];
    for (let j = 0; j < N; j++) {
      const row = [...matA[j]];
      row[i] = matB[j][i];
      fABi.push(evaluateAtPoint(specs, row, ctx));
    }

    let sumSq = 0, count = 0;
    let s1Sum = 0, s1Count = 0;
    for (let j = 0; j < N; j++) {
      if (!Number.isFinite(fA[j]) || !Number.isFinite(fABi[j])) continue;
      sumSq += (fA[j] - fABi[j]) ** 2;
      count++;
    }
    if (count < N * 0.3) { stValues.push(null); s1Values.push(null); continue; }
    const st = sumSq / (2 * count * varY);
    // A finite-sample Jansen estimate can exceed the population bound of one.
    // Preserve the estimate so numerical uncertainty is visible rather than
    // changing relative rankings through an arbitrary upper cap.
    stValues.push(Number.isFinite(st) ? Math.max(0, st) : null);

    // Jansen first-order estimator. It uses the same A/B/A_B^i design as ST,
    // so no additional model evaluations are needed, and it is more stable
    // than the Saltelli product estimator for this sample layout.
    for (let j = 0; j < N; j++) {
      if (!Number.isFinite(fB[j]) || !Number.isFinite(fABi[j])) continue;
      s1Sum += (fB[j] - fABi[j]) ** 2;
      s1Count++;
    }
    if (s1Count < N * 0.3) { s1Values.push(null); continue; }
    const s1Raw = 1 - s1Sum / (2 * s1Count * varY);
    if (!Number.isFinite(s1Raw)) { s1Values.push(null); continue; }
    if (s1Raw < 0) s1Warnings.push(`${specs[i].name}: first-order estimate was negative (${s1Raw.toPrecision(4)}); reported as 0.`);
    if (s1Raw > 1) s1Warnings.push(`${specs[i].name}: first-order estimate ${s1Raw.toPrecision(4)} exceeds one; finite-sample or nonlinear estimation uncertainty requires checking sample size and input ranges.`);
    s1Values.push(Math.max(0, s1Raw));
  }

  const entries = [];
  for (let i = 0; i < k; i++) {
    if (stValues[i] == null) continue;
    entries.push({ ...specs[i], s1: s1Values[i], st: stValues[i] });
  }
  if (entries.length === 0) return null;

  const totalST = entries.reduce((s, e) => s + e.st, 0) || 1;
  const sumS1 = entries.reduce((s, e) => s + (Number.isFinite(e.s1) ? e.s1 : 0), 0);
  const sumST = entries.reduce((s, e) => s + e.st, 0);
  const results = entries.map(e => ({
    param: e.name, label: e.label, category: e.category,
    s1: e.s1,
    st: e.st,
    contribution: (e.st / totalST) * 100,
    src: null,
  }));
  results.sort((a, b) => b.contribution - a.contribution);

  let factorContribution = 0, modelContribution = 0, secondaryContribution = 0;
  for (const r2 of results) {
    if (r2.category === 'factor') factorContribution += r2.contribution;
    else if (r2.category === 'secondary') secondaryContribution += r2.contribution;
    else modelContribution += r2.contribution;
  }

  return {
    results, rSquared: null,
    factorContribution: Math.round(factorContribution * 10) / 10,
    modelContribution: Math.round(modelContribution * 10) / 10,
    secondaryContribution: Math.round(secondaryContribution * 10) / 10,
    sumS1,
    sumST,
    inputRanges: specs.map(({ name, category, lo, hi }) => ({ name, category, lo, hi })),
    factorRanges: ranges,
    estimationWarnings: [
      ...entries.filter(e => e.st > 1).map(e =>
        `${e.name}: total-effect estimate ${e.st.toPrecision(4)} exceeds one; finite-sample or nonlinear estimation uncertainty requires checking sample size and input ranges.`),
      ...s1Warnings,
      ...(Number.isFinite(sumS1) && Math.abs(sumS1 - 1) > 0.25
        ? [`First-order estimates sum to ${sumS1.toPrecision(4)}; check sample size and seed stability before interpreting S1.`]
        : []),
    ],
  };
}
