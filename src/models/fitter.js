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

function shapiroWilkPValue(values) {
  if (!Array.isArray(values) || values.length < 3) return Number.NaN;

  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((sum, value) => sum + value, 0) / n;
  const centeredSquares = sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  if (!Number.isFinite(centeredSquares) || centeredSquares <= 0) return 1;

  const m = Array.from({ length: n }, (_, idx) => inverseNormalCDF((idx + 1 - 0.375) / (n + 0.25)));
  const norm = Math.sqrt(m.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(norm) || norm === 0) return Number.NaN;

  const weights = m.map((value) => value / norm);
  const weightedSum = sorted.reduce((sum, value, idx) => sum + weights[idx] * value, 0);
  const w = Math.min(0.999999, Math.max(1e-12, (weightedSum * weightedSum) / centeredSquares));

  const lnN = Math.log(n);
  const mu = -1.5861 - 0.31082 * lnN - 0.083751 * lnN ** 2 + 0.0038915 * lnN ** 3;
  const sigma = Math.exp(-0.4803 - 0.082676 * lnN + 0.0030302 * lnN ** 2);
  const y = Math.log(1 - w);
  if (!Number.isFinite(y) || !Number.isFinite(mu) || !Number.isFinite(sigma) || sigma <= 0) {
    return Number.NaN;
  }

  const z = (y - mu) / sigma;
  const pValue = 1 - normalCDF(z);
  return Math.min(1, Math.max(0, pValue));
}

function formatScientific(value, digits = 2) {
  return value.toExponential(digits).replace('e+', 'e');
}

export function formatMetric(value) {
  return Number.isFinite(value) ? value.toFixed(3) : 'NA';
}

export function formatParameterValue(value) {
  if (!Number.isFinite(value)) return 'NA';
  if (value !== 0 && Math.abs(value) < 0.001) return formatScientific(value, 2);
  return value.toFixed(3);
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

export function computeSSE(modelFn, params, data, getX = (d) => d.x, getY = (d) => d.y) {
  let s = 0;
  for (const row of data) {
    const pred = modelFn(getX(row), params, row);
    const actual = getY(row);
    if (Number.isFinite(pred) && Number.isFinite(actual)) {
      s += (pred - actual) ** 2;
    }
  }
  return s;
}

function calcAICc(sseValue, n, k) {
  const safeSSE = Math.max(sseValue, 1e-12);
  const aic = n * Math.log(safeSSE / n) + 2 * k;
  if (n - k - 1 <= 0) return Number.NaN;
  return aic + (2 * k * (k + 1)) / (n - k - 1);
}

function applyParameterBounds(params, paramDefs) {
  const bounded = { ...params };
  for (const pd of paramDefs) {
    const value = bounded[pd.name];
    if (!Number.isFinite(value)) continue;
    if (pd.min !== undefined) bounded[pd.name] = Math.max(pd.min, bounded[pd.name]);
    if (pd.max !== undefined) bounded[pd.name] = Math.min(pd.max, bounded[pd.name]);
  }
  return bounded;
}

function createInitialParams(paramDefs, customInit = null) {
  const params = {};
  for (const pd of paramDefs) {
    params[pd.name] = customInit?.[pd.name] ?? pd.defaultValue;
  }
  return applyParameterBounds(params, paramDefs);
}

export function fitRegressionModel({ modelFn, paramDefs, data, getX = (d) => d.x, getY = (d) => d.y, customInit = null }) {
  if (!modelFn || !paramDefs?.length || !data || data.length < 2) return null;

  const paramNames = paramDefs.map((p) => p.name);
  let params = createInitialParams(paramDefs, customInit);

  const maxIter = 2000;
  let lambda = 0.01;
  const lambdaFactor = 10;
  let currentSSE = computeSSE(modelFn, params, data, getX, getY);
  let iter = 0;

  for (iter = 0; iter < maxIter; iter++) {
    const h = 1e-5;
    const residuals = data.map((row) => getY(row) - modelFn(getX(row), params, row));
    const J = residuals.map(() => new Array(paramNames.length).fill(0));

    for (let j = 0; j < paramNames.length; j++) {
      const pPlus = { ...params, [paramNames[j]]: params[paramNames[j]] + h };
      for (let i = 0; i < data.length; i++) {
        const x = getX(data[i]);
        J[i][j] = (modelFn(x, pPlus, data[i]) - modelFn(x, params, data[i])) / h;
      }
    }

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

    const A = JtJ.map((row, i) => row.map((v, j) => (i === j ? v + lambda * Math.max(JtJ[i][i], 1e-8) : v)));
    const delta = solveLinear(A, Jtr);
    if (!delta) {
      lambda *= lambdaFactor;
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

    if (lambda > 1e9) break;
  }

  const residuals = computeResiduals(modelFn, params, data, getX, getY);
  const normalityPValue = shapiroWilkPValue(residuals);
  const n = data.length;
  const k = paramNames.length;
  const meanY = data.reduce((sum, row) => sum + getY(row), 0) / n;
  const sst = data.reduce((sum, row) => sum + (getY(row) - meanY) ** 2, 0);
  const failed = sst === 0;
  const r2 = sst > 0 ? Math.max(0, 1 - currentSSE / sst) : 1;
  const r2adj = n > k + 1 ? 1 - ((1 - r2) * (n - 1)) / (n - k - 1) : r2;
  const rmse = Math.sqrt(currentSSE / n);
  const aicc = calcAICc(currentSSE, n, k);

  const mse = currentSSE / Math.max(n - k, 1);
  const paramErrors = {};
  const paramCI95 = {};
  try {
    const h = 1e-5;
    const J2 = data.map(() => new Array(k).fill(0));
    for (let j = 0; j < k; j++) {
      const pPlus = { ...params, [paramNames[j]]: params[paramNames[j]] + h };
      for (let i = 0; i < n; i++) {
        const x = getX(data[i]);
        J2[i][j] = (modelFn(x, pPlus, data[i]) - modelFn(x, params, data[i])) / h;
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
    paramErrors,
    paramCI95,
    residuals,
    normalityPValue,
    sse: currentSSE,
    rmse,
    r2,
    r2adj,
    aicc,
    iterations: iter,
    n,
    k,
    failed,
  };
}

/**
 * Microbial primary-model adapter
 */
import { MODELS } from './inactivationModels.js';

export function fitModel(modelId, data, customInit = null) {
  const model = MODELS[modelId];
  if (!model) return null;

  return fitRegressionModel({
    modelFn: model.fn,
    paramDefs: model.params,
    data,
    getX: (d) => d.t,
    getY: (d) => d.logN,
    customInit,
  });
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
