import { getExampleCase } from '../src/config/exampleDatasets.js';
import { fitPrimaryInTimeUnit } from '../src/utils/unitFitting.js';
import { expandPrimaryObservations } from '../src/utils/primaryObservations.js';
import {
  runAllSecondaryFits,
  predictPrimaryParams,
} from '../src/models/secondaryModels.js';
import { runMonteCarloWithFactors } from '../src/models/monteCarlo.js';
import { createSeededRng } from '../src/utils/random.js';
import { MODELS } from '../src/models/inactivationModels.js';

const t1 = getExampleCase('t1-milk-powder-wmp');
if (!t1) throw new Error('T1 example not found');

function weightedLogLinearFit(data) {
  const rows = expandPrimaryObservations(data);
  const n = rows.length;
  const X = rows.map(row => [1, row.t]);
  const y = rows.map(row => row.logN);
  const w = rows.map(row => {
    const sd = Number(row.sd);
    return Number.isFinite(sd) && sd > 0 ? 1 / (sd * sd) : 1;
  });

  const XtWX = [[0, 0], [0, 0]];
  const XtWy = [0, 0];
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < 2; a++) {
      XtWy[a] += X[i][a] * w[i] * y[i];
      for (let b = 0; b < 2; b++) XtWX[a][b] += X[i][a] * w[i] * X[i][b];
    }
  }
  const det = XtWX[0][0] * XtWX[1][1] - XtWX[0][1] * XtWX[1][0];
  if (!Number.isFinite(det) || Math.abs(det) < 1e-15) return null;
  const inv = [
    [XtWX[1][1] / det, -XtWX[0][1] / det],
    [-XtWX[1][0] / det, XtWX[0][0] / det],
  ];
  const beta = [
    inv[0][0] * XtWy[0] + inv[0][1] * XtWy[1],
    inv[1][0] * XtWy[0] + inv[1][1] * XtWy[1],
  ];
  const residuals = rows.map((row, i) => y[i] - (beta[0] + beta[1] * row.t));
  const sseW = residuals.reduce((sum, r, i) => sum + w[i] * r * r, 0);
  const mse = n > 2 ? sseW / (n - 2) : NaN;
  const ln10 = Math.LN10;
  const cov = [
    [inv[0][0], -ln10 * inv[0][1]],
    [-ln10 * inv[1][0], ln10 * ln10 * inv[1][1]],
  ];
  const kmax = -beta[1] * ln10;
  const params = { logN0: beta[0], kmax };
  const paramErrors = {
    logN0: Math.sqrt(Math.max(cov[0][0] * mse, 0)),
    kmax: Math.sqrt(Math.max(cov[1][1] * mse, 0)),
  };
  return {
    params,
    initialParams: { ...params },
    paramErrors,
    paramCI95: {
      logN0: [params.logN0 - 1.96 * paramErrors.logN0, params.logN0 + 1.96 * paramErrors.logN0],
      kmax: [params.kmax - 1.96 * paramErrors.kmax, params.kmax + 1.96 * paramErrors.kmax],
    },
    covMatrix: cov,
    mse,
    residualSE: Math.sqrt(mse),
    paramNames: ['logN0', 'kmax'],
    residuals,
    sse: sseW,
    rmse: Math.sqrt(sseW / n),
    r2: null,
    r2adj: null,
    aicc: null,
    aiccValid: false,
    aiccWarning: 'WLS sensitivity fit; AICc not used',
    aiccParameterCount: 3,
    iterations: 1,
    n,
    k: 2,
    failed: false,
    converged: true,
    convergenceReason: 'weighted_linear_least_squares',
    boundaryWarnings: [],
    timeUnitToMin: 1,
  };
}

const nlsFits = {};
const wlsFits = {};
for (const dataset of t1.datasets) {
  const key = `${dataset.id}_LOG_LINEAR`;
  nlsFits[key] = { ...fitPrimaryInTimeUnit('LOG_LINEAR', dataset.data, { timeUnitToMin: 1 }), modelId: 'LOG_LINEAR', datasetId: dataset.id };
  wlsFits[key] = { ...weightedLogLinearFit(dataset.data), modelId: 'LOG_LINEAR', datasetId: dataset.id };
}

const secondaryNLS = runAllSecondaryFits({ datasets: t1.datasets, fitResults: nlsFits, scenario: 'thermal', primaryFactorKey: 'temp', referenceParams: { Tref: 80, awRef: 0.2 } });
const secondaryWLS = runAllSecondaryFits({ datasets: t1.datasets, fitResults: wlsFits, scenario: 'thermal', primaryFactorKey: 'temp', referenceParams: { Tref: 80, awRef: 0.2 } });
const secNLS = secondaryNLS.EXTENDED_BIGELOW_D;
const secWLS = secondaryWLS.EXTENDED_BIGELOW_D;

const factorValues = { temp: 80, aw: 0.2, pH: 7 };
const manualParams = { logN0: 7.5 };
const bindings = { kmax: 'EXTENDED_BIGELOW_D' };
const predict = (fitted, factors) => predictPrimaryParams({
  primaryModelId: 'LOG_LINEAR', primaryFactorKey: 'temp', bindings,
  fittedSecondaryModels: fitted, manualParams, factors,
});
const predictedNLS = predict({ EXTENDED_BIGELOW_D: secNLS }, factorValues);
const predictedWLS = predict({ EXTENDED_BIGELOW_D: secWLS }, factorValues);

const paramNames = MODELS.LOG_LINEAR.params.map(param => param.name);
const modelFn = MODELS.LOG_LINEAR.fn;
const seed = '20260430';
const nSamples = 10000;
const tEval = 60;
const tMax = 120;
const tArray = Array.from({ length: 200 }, (_, i) => tMax * i / 199);

function runMc(primaryFit, predictedParams, fittedSecondaryModels) {
  return runMonteCarloWithFactors({
    modelId: 'LOG_LINEAR',
    primaryFit,
    predictedParams,
    manualParams,
    bindings,
    factorValues,
    factorSDs: { temp: 1, aw: 0.01, pH: 0 },
    factorKeys: ['temp', 'aw', 'pH'],
    fittedSecondaryModels,
    nSamples,
    seed,
    targetReduction: 5,
    confidence: 0.99,
    tEval,
    timeUnitToMin: 1,
    tMax,
    timePoints: 200,
    paramNames,
    modelFn,
    predictParamsFn: factors => predict(fittedSecondaryModels, factors),
    predictParamsFnFactory: fitted => factors => predict(fitted, factors),
    tArray,
    rng: createSeededRng(seed),
  });
}

function summarize(mc, predictedParams) {
  const finalEval = mc.paramSamples[0].map((_, i) => modelFn(tEval, Object.fromEntries(paramNames.map((name, j) => [name, mc.paramSamples[j][i]]))));
  const reductionEval = finalEval.map((value, i) => mc.initialLogNSamples[i] - value);
  const hits = finalEval.map((_, sample) => {
    const index = mc.allSamples.findIndex(values => values[sample] <= mc.initialLogNSamples[sample] - 5 + 1e-10);
    return index < 0 ? Infinity : mc.tArray[index];
  });
  const sortedHits = [...hits].sort((a, b) => a - b);
  const safeTime = sortedHits[Math.ceil(0.99 * hits.length) - 1];
  const sortedReduction = [...reductionEval].sort((a, b) => a - b);
  const q = p => sortedReduction[Math.min(sortedReduction.length - 1, Math.ceil(p * sortedReduction.length) - 1)];
  const success = reductionEval.filter(v => v >= 5 - 1e-10).length / reductionEval.length;
  const mean = reductionEval.reduce((a, b) => a + b, 0) / reductionEval.length;
  return {
    predicted: predictedParams,
    n: reductionEval.length,
    rejected: mc.rejectedSamples,
    meanReduction60: mean,
    medianReduction60: q(0.5),
    p5Reduction60: q(0.05),
    p95Reduction60: q(0.95),
    success5Log60: success,
    safeTime99: safeTime,
    paramSD: Object.fromEntries(paramNames.map((name, i) => [name, Math.sqrt(
      mc.paramSamples[i].reduce((sum, v) => sum + (v - predictedParams[name]) ** 2, 0) / mc.paramSamples[i].length,
    )])),
  };
}

const mcNLS = runMc(nlsFits['lab_milk_wmp_75_010_LOG_LINEAR'], predictedNLS, { EXTENDED_BIGELOW_D: secNLS });
const mcWLS = runMc(wlsFits['lab_milk_wmp_75_010_LOG_LINEAR'], predictedWLS, { EXTENDED_BIGELOW_D: secWLS });

const summary = {
  secondary: {
    NLS: { params: secNLS.params, paramErrors: secNLS.paramErrors, rmse: secNLS.rmse, n: secNLS.n },
    WLS: { params: secWLS.params, paramErrors: secWLS.paramErrors, rmse: secWLS.rmse, n: secWLS.n },
  },
  primaryActive: {
    NLS: { params: nlsFits['lab_milk_wmp_75_010_LOG_LINEAR'].params, mse: nlsFits['lab_milk_wmp_75_010_LOG_LINEAR'].mse },
    WLS: { params: wlsFits['lab_milk_wmp_75_010_LOG_LINEAR'].params, mse: wlsFits['lab_milk_wmp_75_010_LOG_LINEAR'].mse },
  },
  predictedAt80: { NLS: predictedNLS, WLS: predictedWLS },
  mc: { NLS: summarize(mcNLS, predictedNLS), WLS: summarize(mcWLS, predictedWLS) },
};
console.log(JSON.stringify(summary, null, 2));
