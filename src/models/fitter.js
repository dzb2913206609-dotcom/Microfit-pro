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
      for (let j = 0; j < k; j++) {
        paramErrors[paramNames[j]] = Math.sqrt(Math.abs(cov[j][j] * mse));
      }
    }
  } catch (error) {
    void error;
  }

  return { params, paramErrors, sse: currentSSE, rmse, r2, r2adj, aicc, iterations: iter, n, k, failed };
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
