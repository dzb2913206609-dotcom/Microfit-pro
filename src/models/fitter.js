import { expandPrimaryObservations } from '../utils/primaryObservations.js';

function getTCritical(df) {
  // Two-tailed t critical values for 95% CI (alpha=0.05), df=1..30
  const TABLE = [
    NaN, 12.706, 4.303, 3.182, 2.776, 2.571,
    2.447, 2.365, 2.306, 2.262, 2.228,
    2.201, 2.179, 2.160, 2.145, 2.131,
    2.120, 2.110, 2.101, 2.093, 2.086,
    2.080, 2.074, 2.069, 2.064, 2.060,
    2.056, 2.052, 2.048, 2.045, 2.042,
  ];
  if (df <= 0) return NaN;
  if (df < TABLE.length) return TABLE[df];
  return 1.96;
}

function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * absX);
  const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX));
  return sign * y;
}

function normalCDF(x) {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

function inverseNormalCDF(p) {
  if (!(p > 0 && p < 1)) {
    if (p === 0) return -Infinity;
    if (p === 1) return Infinity;
    return Number.NaN;
  }

  const a = [
    -39.69683028665376,
    220.9460984245205,
    -275.9285104469687,
    138.357751867269,
    -30.66479806614716,
    2.506628277459239,
  ];
  const b = [
    -54.47609879822406,
    161.5858368580409,
    -155.6989798598866,
    66.80131188771972,
    -13.28068155288572,
  ];
  const c = [
    -0.007784894002430293,
    -0.3223964580411365,
    -2.400758277161838,
    -2.549732539343734,
    4.374664141464968,
    2.938163982698783,
  ];
  const d = [
    0.007784695709041462,
    0.3224671290700398,
    2.445134137142996,
    3.754408661907416,
  ];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
      / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > pHigh) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
      / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }

  const q = p - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q
    / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

function computeResiduals(modelFn, params, data, getX, getY) {
  return data
    .map((row) => {
      const predictedY = modelFn(getX(row), params, row);
      const observedY = getY(row);
      if (!Number.isFinite(predictedY) || !Number.isFinite(observedY)) return null;
      return observedY - predictedY;
    })
    .filter((value) => Number.isFinite(value));
}

function polynomial(coefficients, x) {
  return coefficients.reduceRight((acc, value) => acc * x + value, 0);
}

// Royston's AS R94 approximation to Shapiro–Wilk for complete samples.
// Uses corrected SW order-statistic weights and the n=3 / n<=11 branches;
// the p-value approximation is supported for 3..5000 observations.
export function shapiroWilkPValue(values) {
  if (!Array.isArray(values) || values.length < 3 || values.length > 5000 || !values.every(Number.isFinite)) return Number.NaN;

  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((sum, value) => sum + value, 0) / n;
  const centeredSquares = sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  if (!Number.isFinite(centeredSquares) || centeredSquares <= 0) return Number.NaN;
  const half = Math.floor(n / 2);
  const weights = Array.from({ length: half }, (_, i) => inverseNormalCDF((i + 1 - .375) / (n + .25)));
  if (n === 3) weights[0] = Math.SQRT1_2;
  else {
    const sum2 = 2 * weights.reduce((acc, value) => acc + value * value, 0);
    const norm = Math.sqrt(sum2);
    const rsn = 1 / Math.sqrt(n);
    const a1 = polynomial([0, .221157, -.147981, -2.07119, 4.434685, -2.706056], rsn) - weights[0] / norm;
    let start = 1;
    let factor;
    if (n > 5) {
      const a2 = polynomial([0, .042981, -.293762, -1.752461, 5.682633, -3.582633], rsn) - weights[1] / norm;
      factor = Math.sqrt((sum2 - 2 * weights[0] ** 2 - 2 * weights[1] ** 2) / (1 - 2 * a1 ** 2 - 2 * a2 ** 2));
      weights[1] = a2;
      start = 2;
    } else factor = Math.sqrt((sum2 - 2 * weights[0] ** 2) / (1 - 2 * a1 ** 2));
    weights[0] = a1;
    for (let i = start; i < half; i++) weights[i] /= -factor;
  }
  const weightedSum = weights.reduce((acc, weight, i) => acc + weight * (sorted[n - 1 - i] - sorted[i]), 0);
  const w = Math.min(1, Math.max(0, weightedSum ** 2 / centeredSquares));
  if (n === 3) return Math.min(1, Math.max(0, 6 / Math.PI * (Math.asin(Math.sqrt(w)) - Math.PI / 3)));
  if (w >= 1) return 1;
  let y = Math.log1p(-w);
  let mu, sigma;
  if (n <= 11) {
    const gamma = polynomial([-2.273, .459], n);
    if (y >= gamma) return 0;
    y = -Math.log(gamma - y);
    mu = polynomial([.544, -.39978, .025054, -.0006714], n);
    sigma = Math.exp(polynomial([1.3822, -.77857, .062767, -.0020322], n));
  } else {
    const lnN = Math.log(n);
    mu = polynomial([-1.5861, -.31082, -.083751, .0038915], lnN);
    sigma = Math.exp(polynomial([-.4803, -.082676, .0030302], lnN));
  }
  const z = (y - mu) / sigma;
  const pValue = 1 - normalCDF(z);
  return Math.min(1, Math.max(0, pValue));
}

function residualTrendSlope(residuals, xValues) {
  const n = residuals.length;
  if (n < 3 || xValues.length < n) return NaN;
  const mx = xValues.reduce((a, b) => a + b, 0) / n;
  const mr = residuals.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xValues[i] - mx) * (residuals[i] - mr);
    den += (xValues[i] - mx) ** 2;
  }
  return den > 0 ? num / den : 0;
}

function maxAbsoluteResidual(residuals) {
  if (!residuals || residuals.length === 0) return NaN;
  return Math.max(...residuals.map(Math.abs));
}

function runsTestPValue(residuals) {
  if (!residuals || residuals.length < 4) return NaN;
  const signs = residuals.map(r => r >= 0 ? 1 : -1);
  const n = signs.length;
  const nPos = signs.filter(s => s === 1).length;
  const nNeg = n - nPos;
  if (nPos === 0 || nNeg === 0) return NaN;
  let runs = 1;
  for (let i = 1; i < n; i++) {
    if (signs[i] !== signs[i - 1]) runs++;
  }
  const expectedRuns = 1 + (2 * nPos * nNeg) / n;
  const variance = (2 * nPos * nNeg * (2 * nPos * nNeg - n)) / (n * n * (n - 1));
  if (variance <= 0) return NaN;
  const z = (runs - expectedRuns) / Math.sqrt(variance);
  return 2 * (1 - normalCDF(Math.abs(z)));
}

function formatScientific(value, digits = 2) {
  return value.toExponential(digits).replace('e+', 'e');
}

export function formatMetric(value) {
  return Number.isFinite(value) ? value.toFixed(3) : 'NA';
}

export function formatParameterValue(value) {
  if (!Number.isFinite(value)) return 'NA';
  if (value === 0) return '0';
  return value.toPrecision(3);
}

export function formatPValue(value) {
  if (!Number.isFinite(value)) return 'NA';
  if (value < 0.001) return '< 0.001';
  return value.toFixed(3);
}

export function formatAxisTick(value) {
  if (!Number.isFinite(value)) return '';
  if (value !== 0 && Math.abs(value) < 0.001) return formatScientific(value, 1);
  return value.toFixed(3);
}

export function formatLogN(value) {
  if (!Number.isFinite(value)) return 'NA';
  return value.toFixed(2);
}

export function formatTime(value) {
  if (!Number.isFinite(value)) return 'NA';
  return parseFloat(value.toPrecision(4)).toString();
}

export function computeSSE(modelFn, params, data, getX = (d) => d.x, getY = (d) => d.y) {
  let s = 0;
  for (const row of data) {
    const pred = modelFn(getX(row), params, row);
    const actual = getY(row);
    if (!Number.isFinite(pred) || !Number.isFinite(actual)) return Infinity;
    s += (pred - actual) ** 2;
  }
  return s;
}

export function calcAICc(sseValue, n, k, { logJacobian = 0 } = {}) {
  const K = k + 1; // All regression parameters plus estimated Gaussian variance.
  if (!Number.isFinite(sseValue) || sseValue < 0 || !Number.isFinite(logJacobian)) {
    return { value: null, valid: false, K, warning: 'Invalid residuals or likelihood transform' };
  }
  if (n <= K + 1) return { value: null, valid: false, K, warning: `Insufficient observations for AICc (n=${n}, K=${K}, including variance)` };
  if (sseValue === 0) return { value: null, valid: false, K, warning: 'AICc is undefined for zero residual variance' };
  const aic = n * Math.log(sseValue / n) - 2 * logJacobian + 2 * K;
  const aicc = aic + (2 * K * (K + 1)) / (n - K - 1);
  return { value: aicc, valid: true, K, warning: null };
}

function applyParameterBounds(params, paramDefs) {
  const bounded = { ...params };
  for (const pd of paramDefs) {
    const value = bounded[pd.name];
    if (!Number.isFinite(value)) continue;
    if (pd.min !== undefined) bounded[pd.name] = Math.max(pd.min, bounded[pd.name]);
    if (pd.max !== undefined) bounded[pd.name] = Math.min(pd.max, bounded[pd.name]);
  }
  // Residual/minimum populations must not exceed the initial total. Respect
  // fixed parameters rather than silently changing a fixed initial state.
  for (const residualName of ['logNres', 'logNmin']) {
    if (bounded[residualName] === undefined || bounded.logN0 === undefined) continue;
    if (bounded[residualName] <= bounded.logN0) continue;
    const residualDef = paramDefs.find(p => p.name === residualName);
    const initialDef = paramDefs.find(p => p.name === 'logN0');
    if (!residualDef?.fixed) bounded[residualName] = Math.max(residualDef?.min ?? -Infinity, bounded.logN0);
    if (bounded[residualName] > bounded.logN0 && !initialDef?.fixed) {
      bounded.logN0 = Math.min(initialDef?.max ?? Infinity, bounded[residualName]);
    }
  }
  return bounded;
}

function checkBoundaryProximity(params, paramDefs, threshold = 0.01) {
  const warnings = [];
  for (const pd of paramDefs) {
    const val = params[pd.name];
    if (!Number.isFinite(val)) continue;
    if (pd.min !== undefined && pd.max !== undefined) {
      const range = pd.max - pd.min;
      if (range > 0) {
        if ((val - pd.min) / range < threshold) warnings.push({ paramName: pd.name, bound: 'min', boundValue: pd.min, paramValue: val });
        if ((pd.max - val) / range < threshold) warnings.push({ paramName: pd.name, bound: 'max', boundValue: pd.max, paramValue: val });
      }
    } else if (pd.min !== undefined) {
      const ref = Math.max(Math.abs(pd.min), Math.abs(val), 1e-6);
      if ((val - pd.min) / ref < threshold) warnings.push({ paramName: pd.name, bound: 'min', boundValue: pd.min, paramValue: val });
    } else if (pd.max !== undefined) {
      const ref = Math.max(Math.abs(pd.max), Math.abs(val), 1e-6);
      if ((pd.max - val) / ref < threshold) warnings.push({ paramName: pd.name, bound: 'max', boundValue: pd.max, paramValue: val });
    }
  }
  return warnings;
}

function createInitialParams(paramDefs, customInit = null) {
  const params = {};
  for (const pd of paramDefs) {
    params[pd.name] = customInit?.[pd.name] ?? pd.defaultValue;
  }
  return applyParameterBounds(params, paramDefs);
}

// Solve a small positive-definite quadratic step on the tangent cone of all
// active constraints. KKT multipliers release constraints when their gradient
// points inward. Coupled population constraints permit joint movement.
function constrainedStep(matrix, gradient, constraints) {
  const k = gradient.length;
  const active = [];
  let solution;
  for (let attempt = 0; attempt < 4 * (constraints.length + 1); attempt++) {
    const system = matrix.map((row, i) => [...row, ...active.map(index => constraints[index][i])]);
    for (const index of active) system.push([...constraints[index], ...active.map(() => 0)]);
    solution = solveLinear(system, [...gradient, ...active.map(() => 0)]);
    if (!solution) return null;
    const multipliers = solution.slice(k);
    const release = multipliers.findIndex(value => value < -1e-10);
    if (release >= 0) { active.splice(release, 1); continue; }
    const violated = constraints.findIndex((normal, index) => !active.includes(index)
      && normal.reduce((sum, value, j) => sum + value * solution[j], 0) > 1e-10);
    if (violated < 0) return solution.slice(0, k);
    active.push(violated);
  }
  return null;
}

export function fitRegressionModel({ modelFn, paramDefs, data, getX = (d) => d.x, getY = (d) => d.y, customInit = null }) {
  if (!modelFn || !paramDefs?.length || !data || data.length < 2) return null;

  const fittedDefs = paramDefs.filter((p) => !p.fixed);
  const paramNames = fittedDefs.map((p) => p.name);
  const initialParams = createInitialParams(paramDefs, customInit);
  let params = { ...initialParams };

  const maxIter = 2000;
  const GRAD_INF_TOL = 1e-8;
  let lambda = 0.01;
  const lambdaFactor = 10;
  let currentSSE = computeSSE(modelFn, params, data, getX, getY);
  let iter = 0;
  let converged = false;
  let convergenceReason = 'max_iterations';

  function derivative(pd, row) {
    const value = params[pd.name];
    const h = 1e-5 * Math.max(1, Math.abs(value));
    const x = getX(row);
    const base = modelFn(x, params, row);
    const plus = modelFn(x, { ...params, [pd.name]: value + h }, row);
    const minus = modelFn(x, { ...params, [pd.name]: value - h }, row);
    if (Number.isFinite(plus) && Number.isFinite(minus)) return (plus - minus) / (2 * h);
    if (Number.isFinite(plus)) return (plus - base) / h;
    if (Number.isFinite(minus)) return (base - minus) / h;
    return NaN;
  }

  function activeConstraints() {
    const constraints = [];
    fittedDefs.forEach((pd, j) => {
      const value = params[pd.name];
      const tol = 1e-10 * Math.max(1, Math.abs(value));
      if (pd.min !== undefined && value <= pd.min + tol) constraints.push(paramNames.map((_, i) => i === j ? -1 : 0));
      if (pd.max !== undefined && value >= pd.max - tol) constraints.push(paramNames.map((_, i) => i === j ? 1 : 0));
    });
    for (const name of ['logNres', 'logNmin']) {
      if (params[name] === undefined || params.logN0 === undefined || params[name] < params.logN0 - 1e-10) continue;
      const normal = paramNames.map(p => p === name ? 1 : p === 'logN0' ? -1 : 0);
      if (normal.some(value => value !== 0)) constraints.push(normal);
    }
    return constraints;
  }

  const validInput = data.every(row => Number.isFinite(getX(row)) && Number.isFinite(getY(row)));
  if (!validInput || !Number.isFinite(currentSSE)) convergenceReason = 'invalid_prediction';

  for (iter = 0; validInput && Number.isFinite(currentSSE) && iter < maxIter; iter++) {
    const residuals = data.map((row) => getY(row) - modelFn(getX(row), params, row));
    const J = residuals.map(() => new Array(paramNames.length).fill(0));

    for (let j = 0; j < paramNames.length; j++) for (let i = 0; i < data.length; i++) J[i][j] = derivative(fittedDefs[j], data[i]);
    if (J.some(row => row.some(value => !Number.isFinite(value)))) { convergenceReason = 'invalid_jacobian'; break; }

    const nParams = paramNames.length;
    const JtJ = Array.from({ length: nParams }, () => new Array(nParams).fill(0));
    const Jtr = new Array(nParams).fill(0);

    for (let i = 0; i < data.length; i++) {
      for (let a = 0; a < nParams; a++) {
        Jtr[a] += J[i][a] * residuals[i];
        for (let b = 0; b < nParams; b++) {
          JtJ[a][b] += J[i][a] * J[i][b];
        }
      }
    }

    const constraints = activeConstraints();
    const identity = paramNames.map((_, i) => paramNames.map((_, j) => i === j ? 1 : 0));
    const projectedGradient = constrainedStep(identity, Jtr, constraints);
    if (!projectedGradient) { convergenceReason = 'failed_to_converge'; break; }
    const gradInfNorm = Math.max(0, ...projectedGradient.map((value, j) => Math.abs(value) / Math.max(Math.sqrt(JtJ[j][j]), 1e-12)));
    if (gradInfNorm < GRAD_INF_TOL * Math.max(1, Math.sqrt(currentSSE))) {
      converged = true;
      convergenceReason = 'gradient_converged';
      break;
    }

    const A = JtJ.map((row, i) => row.map((v, j) => i === j ? v + lambda * Math.max(JtJ[i][i], 1e-8) : v));
    const delta = constrainedStep(A, Jtr, constraints);
    if (!delta) {
      lambda *= lambdaFactor;
      if (lambda > 1e9) { convergenceReason = 'failed_to_converge'; break; }
      continue;
    }

    const newParams = applyParameterBounds(
      paramNames.reduce((acc, name, idx) => {
        acc[name] = params[name] + delta[idx];
        return acc;
      }, { ...params }),
      paramDefs,
    );

    const newSSE = computeSSE(modelFn, newParams, data, getX, getY);
    if (newSSE < currentSSE) {
      params = newParams;
      currentSSE = newSSE;
      lambda = Math.max(lambda / lambdaFactor, 1e-10);
    } else {
      lambda = Math.min(lambda * lambdaFactor, 1e10);
    }

    if (lambda > 1e9) { convergenceReason = 'failed_to_converge'; break; }
  }

  const residuals = computeResiduals(modelFn, params, data, getX, getY);
  const normalityPValue = shapiroWilkPValue(residuals);
  const xValues = data.map(row => getX(row));
  const resTrendSlope = residualTrendSlope(residuals, xValues);
  const maxAbsResidual = maxAbsoluteResidual(residuals);
  const runsTestP = runsTestPValue(residuals);
  const n = data.length;
  const k = paramNames.length;
  const meanY = data.reduce((sum, row) => sum + getY(row), 0) / n;
  const sst = data.reduce((sum, row) => sum + (getY(row) - meanY) ** 2, 0);
  const failed = !validInput || !Number.isFinite(currentSSE) || convergenceReason === 'invalid_jacobian';
  if (failed) converged = false;
  const r2 = !failed && sst > 0 ? 1 - currentSSE / sst : null;
  const r2adj = Number.isFinite(r2) && n > k ? 1 - ((1 - r2) * (n - 1)) / (n - k) : null;
  const rmse = !failed ? Math.sqrt(currentSSE / n) : null;
  const aiccResult = calcAICc(failed ? Infinity : currentSSE, n, k);
  const boundaryWarnings = checkBoundaryProximity(params, fittedDefs);

  const mse = !failed && n > k ? currentSSE / (n - k) : null;
  const residualSE = Number.isFinite(mse) ? Math.sqrt(mse) : null;
  const paramErrors = {};
  const paramCI95 = {};
  let covMatrix = null;
  try {
    if (failed || !Number.isFinite(mse) || k === 0) throw new Error('Parameter covariance is not estimable');
    const J2 = data.map(() => new Array(k).fill(0));
    for (let j = 0; j < k; j++) {
      for (let i = 0; i < n; i++) {
        J2[i][j] = derivative(fittedDefs[j], data[i]);
      }
    }
    const JtJ2 = Array.from({ length: k }, () => new Array(k).fill(0));
    for (let i = 0; i < n; i++) {
      for (let a = 0; a < k; a++) {
        for (let b = 0; b < k; b++) {
          JtJ2[a][b] += J2[i][a] * J2[i][b];
        }
      }
    }
    const cov = invertMatrix(JtJ2);
    if (cov) {
      covMatrix = cov;
      const df = n - k;
      const tCrit = getTCritical(df);
      for (let j = 0; j < k; j++) {
        const se = Math.sqrt(Math.abs(cov[j][j] * mse));
        paramErrors[paramNames[j]] = se;
        if (Number.isFinite(se) && Number.isFinite(tCrit)) {
          const margin = tCrit * se;
          paramCI95[paramNames[j]] = [params[paramNames[j]] - margin, params[paramNames[j]] + margin];
        }
      }
    }
  } catch (error) {
    void error;
  }

  return {
    params,
    initialParams,
    paramErrors,
    paramCI95,
    covMatrix,
    mse,
    residualSE,
    paramNames,
    residuals,
    normalityPValue,
    resTrendSlope,
    maxAbsResidual,
    runsTestP,
    sse: currentSSE,
    rmse,
    r2,
    r2adj,
    aicc: aiccResult.value,
    aiccValid: aiccResult.valid,
    aiccWarning: aiccResult.warning,
    aiccParameterCount: aiccResult.K,
    iterations: iter,
    n,
    k,
    failed,
    converged,
    convergenceReason,
    finalLambda: lambda,
    boundaryWarnings,
  };
}

/**
 * Microbial primary-model adapter
 */
import { MODELS } from './inactivationModels.js';

function olsSlope(xs, ys) {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  return den > 0 ? num / den : 0;
}

function maxLocalSlope(data) {
  let maxS = 0;
  for (let i = 1; i < data.length; i++) {
    const dt = data[i].t - data[i - 1].t;
    if (dt > 0) { const s = Math.abs(data[i].logN - data[i - 1].logN) / dt; if (s > maxS) maxS = s; }
  }
  return maxS;
}

function shoulderTime(data, logN0, threshold = 0.2) {
  for (const d of data) { if (logN0 - d.logN > threshold) return Math.max(d.t, 0.01); }
  return data.length > 2 ? data[1].t : 0.5;
}

export function computeDataDrivenInit(modelId, data) {
  if (!data || data.length < 2) return null;
  const sorted = [...data].sort((a, b) => a.t - b.t);
  const ts = sorted.map(d => d.t);
  const logNs = sorted.map(d => d.logN);
  const logN0 = logNs[0];
  const logNmin = Math.min(...logNs);
  const slope = olsSlope(ts, logNs);
  const kFromSlope = Math.max(-slope * Math.LN10, 0.001);

  switch (modelId) {
    case 'LOG_LINEAR':
      return { logN0, kmax: kFromSlope };
    case 'LOG_LINEAR_TAIL':
      return { logN0, kmax: kFromSlope, logNres: logNmin };
    case 'SHOULDER_TAIL': {
      const Sl = shoulderTime(sorted, logN0);
      const postShoulder = sorted.filter(d => d.t > Sl);
      const kPost = postShoulder.length >= 2 ? Math.max(-olsSlope(postShoulder.map(d => d.t), postShoulder.map(d => d.logN)) * Math.LN10, 0.001) : kFromSlope;
      return { logN0, kmax: kPost, logNres: logNmin, Sl };
    }
    case 'SHOULDER_NOTAIL': {
      const Sl = shoulderTime(sorted, logN0);
      const postShoulder = sorted.filter(d => d.t > Sl);
      const kPost = postShoulder.length >= 2 ? Math.max(-olsSlope(postShoulder.map(d => d.t), postShoulder.map(d => d.logN)) * Math.LN10, 0.001) : kFromSlope;
      return { logN0, kmax: kPost, Sl };
    }
    case 'WEIBULL': {
      const reductions = sorted.filter(d => logN0 - d.logN > 0.01 && d.t > 0);
      if (reductions.length >= 2) {
        const logR = reductions.map(d => Math.log10(Math.max(logN0 - d.logN, 1e-6)));
        const logT = reductions.map(d => Math.log10(d.t));
        const pInit = Math.max(olsSlope(logT, logR), 0.1);
        const intercept = logR.reduce((a, b) => a + b, 0) / logR.length - pInit * (logT.reduce((a, b) => a + b, 0) / logT.length);
        const deltaInit = Math.max(Math.pow(10, -intercept / Math.max(pInit, 0.01)), 0.01);
        return { logN0, delta: deltaInit, p: pInit };
      }
      return { logN0, delta: 5, p: 1 };
    }
    case 'WEIBULL_TAIL': {
      const base = computeDataDrivenInit('WEIBULL', data);
      return { ...base, logNres: logNmin };
    }
    case 'BIPHASIC': {
      const mid = Math.floor(sorted.length / 2);
      const early = sorted.slice(0, Math.max(mid, 2));
      const late = sorted.slice(mid);
      const k1 = Math.max(-olsSlope(early.map(d => d.t), early.map(d => d.logN)) * Math.LN10, 0.001);
      const k2 = late.length >= 2 ? Math.max(-olsSlope(late.map(d => d.t), late.map(d => d.logN)) * Math.LN10, 0.001) : k1 * 0.1;
      return { logN0, kmax1: k1, kmax2: k2, f: 0.9 };
    }
    case 'BIPHASIC_SHOULDER': {
      const base = computeDataDrivenInit('BIPHASIC', data);
      return { ...base, Sl: shoulderTime(sorted, logN0) };
    }
    case 'MIXED_WEIBULL': {
      const wb = computeDataDrivenInit('WEIBULL', data);
      return { logN0, delta1: wb.delta, p1: wb.p, delta2: wb.delta * 3, p2: Math.max(wb.p * 0.5, 0.1), f: 0.9 };
    }
    case 'GOMPERTZ': {
      const A = Math.max(logN0 - logNmin, 0.1);
      const mu = Math.max(maxLocalSlope(sorted) * Math.LN10, 0.01);
      const lam = shoulderTime(sorted, logN0);
      return { logN0, A, mu, lambda: lam };
    }
    case 'BARANYI': {
      const kmax = Math.max(maxLocalSlope(sorted) * Math.LN10, 0.01);
      const Sl = shoulderTime(sorted, logN0);
      return { logN0, kmax, logNmin, h0: kmax * Sl };
    }
    default:
      return null;
  }
}

// Optional log coordinates keep positive dimensional parameters resolvable
// without imposing a physical time/rate floor. Metadata remains per-fit.
function fitPrimaryRegression(model, paramDefs, data, customInit, logParameters = []) {
  if (!logParameters.length) return fitRegressionModel({ modelFn: model.fn, paramDefs, data,
    getX: d => d.t, getY: d => d.logN, customInit });
  const logarithmic = new Set(logParameters);
  const toPhysical = values => Object.fromEntries(Object.entries(values).map(([name, value]) =>
    [name, logarithmic.has(name) ? Math.exp(value) : value]));
  const coordinateDefs = paramDefs.map(pd => !logarithmic.has(pd.name) ? pd : {
    ...pd,
    defaultValue: Math.log(pd.defaultValue),
    min: Math.log(pd.min ?? Number.MIN_VALUE),
    ...(pd.max === undefined ? {} : { max: Math.log(pd.max) }),
  });
  const coordinateInit = customInit && Object.fromEntries(Object.entries(customInit).map(([name, value]) =>
    [name, logarithmic.has(name) ? Math.log(Math.max(value, Number.MIN_VALUE)) : value]));
  const result = fitRegressionModel({ modelFn: (t, params) => model.fn(t, toPhysical(params)),
    paramDefs: coordinateDefs, data, getX: d => d.t, getY: d => d.logN, customInit: coordinateInit });
  if (!result) return null;
  const params = toPhysical(result.params);
  const factors = result.paramNames.map(name => logarithmic.has(name) ? params[name] : 1);
  const paramErrors = Object.fromEntries(Object.entries(result.paramErrors).map(([name, error]) =>
    [name, error * (logarithmic.has(name) ? params[name] : 1)]));
  const covMatrix = result.covMatrix?.map((row, i) => row.map((value, j) => value * factors[i] * factors[j])) ?? null;
  const unrepresentableCovariance = covMatrix?.some((row, i) => row.some((value, j) =>
    !Number.isFinite(value) || (value === 0 && result.covMatrix[i][j] !== 0 && factors[i] !== 0 && factors[j] !== 0)));
  const tCrit = getTCritical(result.n - result.k);
  return { ...result, params, initialParams: toPhysical(result.initialParams), paramErrors,
    // Use the same local Wald convention as untransformed fits. Extrapolated,
    // weakly identified scales can therefore have a negative lower CI limit.
    paramCI95: Object.fromEntries(Object.entries(paramErrors).filter(([, error]) => Number.isFinite(error) && Number.isFinite(tCrit)).map(([name, error]) =>
      [name, [params[name] - tCrit * error, params[name] + tCrit * error]])),
    covMatrix: unrepresentableCovariance ? null : covMatrix,
    ...(unrepresentableCovariance ? { covarianceWarning: 'Parameter covariance cannot be represented at this scale (floating-point underflow or overflow).' } : {}),
    boundaryWarnings: result.boundaryWarnings.map(warning => !logarithmic.has(warning.paramName) ? warning : {
      ...warning, boundValue: Math.exp(warning.boundValue), paramValue: params[warning.paramName],
    }),
  };
}

export function fitModel(modelId, data, customInit = null, { paramDefs = null, logParameters = [] } = {}) {
  const model = MODELS[modelId];
  if (!model) return null;
  data = expandPrimaryObservations(data);

  const dataInit = computeDataDrivenInit(modelId, data);
  const mergedInit = customInit ? { ...dataInit, ...customInit } : dataInit;

  return fitPrimaryRegression(model, paramDefs ?? model.params, data, mergedInit, logParameters);
}

function generateMultiStartCandidates(baseInit, paramDefs) {
  const candidates = [{ ...baseInit }];
  const fittedDefs = paramDefs.filter(p => !p.fixed);
  for (const pd of fittedDefs) {
    const base = baseInit[pd.name];
    if (base === undefined) continue;
    let vals;
    if (pd.role === 'fraction') {
      vals = [0.2, 0.5, 0.8, 0.95].filter(v => v !== base);
    } else if (pd.role === 'shape') {
      vals = [0.3, 0.7, 1.0, 1.5, 2.0].filter(v => v !== base);
    } else if (pd.positive || pd.nonNegative || pd.role === 'rate' || pd.role === 'timeScale') {
      vals = [base * 0.5, base * 2.0].filter(v => v > 0);
    } else {
      vals = [base * 0.5, base * 2.0];
    }
    for (const v of vals) {
      const c = { ...baseInit, [pd.name]: v };
      candidates.push(c);
    }
  }
  return candidates.slice(0, 30);
}

// With no zero-time observation, a Weibull curve can approach a logarithmic
// limit along an extremely shallow logN0/delta/p valley. Profile the existing
// shape boundary by OLS, rather than imposing a new lower bound on delta.
function weibullShapeBoundaryInit(data, p) {
  if (!(p > 0) || !data.every(row => Number.isFinite(row.t) && row.t >= 0 && Number.isFinite(row.logN))) return null;
  const xs = data.map(row => Math.pow(row.t, p));
  const ys = data.map(row => row.logN);
  const b = -olsSlope(xs, ys);
  if (!(b > 0)) return null;
  const logN0 = ys.reduce((sum, y) => sum + y, 0) / ys.length + b * xs.reduce((sum, x) => sum + x, 0) / xs.length;
  const delta = Math.exp(-Math.log(b) / p);
  return Number.isFinite(delta) && delta > 0 ? { logN0, delta, p } : null;
}

export function fitModelMultiStart(modelId, data, customInit = null, options = {}) {
  const model = MODELS[modelId];
  if (!model) return null;
  data = expandPrimaryObservations(data);

  const paramDefs = options.paramDefs ?? model.params;
  const fittedDefs = paramDefs.filter(p => !p.fixed);
  if (fittedDefs.length < 3) return fitModel(modelId, data, customInit, options);

  const dataInit = computeDataDrivenInit(modelId, data);
  const baseInit = customInit ? { ...dataInit, ...customInit } : dataInit;
  if (!baseInit) return fitModel(modelId, data, customInit, options);

  const candidates = generateMultiStartCandidates(baseInit, paramDefs);
  // Custom parameters are starting guesses, not constraints on the other
  // multi-start candidates, including this boundary candidate.
  if (modelId === 'WEIBULL' && options.logParameters?.includes('delta')) {
    const seed = weibullShapeBoundaryInit(data, paramDefs.find(param => param.name === 'p')?.min);
    if (seed) candidates.push(seed);
  }
  let bestResult = null;
  let convergedCount = 0;

  for (const init of candidates) {
    const result = fitPrimaryRegression(model, paramDefs, data, init, options.logParameters);
    if (!result) continue;
    if (result.converged) convergedCount++;
    if (result.converged && (!bestResult || result.sse < bestResult.sse)) {
      bestResult = result;
    }
  }

  if (!bestResult) {
    bestResult = fitModel(modelId, data, customInit, options);
  }

  if (bestResult) {
    bestResult.multiStart = {
      totalAttempts: candidates.length,
      convergedCount,
      bestSSE: bestResult.sse,
    };
  }
  return bestResult;
}

/** Gaussian elimination for Ax = b */
function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row;
    }
    [M[col], M[maxRow]] = [M[maxRow], M[col]];
    if (Math.abs(M[col][col]) < 1e-12) return null;
    for (let row = col + 1; row < n; row++) {
      const factor = M[row][col] / M[col][col];
      for (let k = col; k <= n; k++) M[row][k] -= factor * M[col][k];
    }
  }

  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = M[i][n];
    for (let j = i + 1; j < n; j++) x[i] -= M[i][j] * x[j];
    x[i] /= M[i][i];
  }
  return x;
}

/** Matrix inversion via Gaussian elimination */
function invertMatrix(M) {
  const n = M.length;
  const aug = M.map((row, i) => {
    const r = [...row, ...new Array(n).fill(0)];
    r[n + i] = 1;
    return r;
  });

  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row;
    }
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
    if (Math.abs(aug[col][col]) < 1e-12) return null;
    const div = aug[col][col];
    for (let k = col; k < 2 * n; k++) aug[col][k] /= div;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = aug[row][col];
      for (let k = col; k < 2 * n; k++) aug[row][k] -= factor * aug[col][k];
    }
  }
  return aug.map((row) => row.slice(n));
}
