import fs from 'node:fs';
import { getExampleCase } from '../src/config/exampleDatasets.js';
import { MODELS } from '../src/models/inactivationModels.js';
import { fitPrimaryInTimeUnit } from '../src/utils/unitFitting.js';
import { runAllSecondaryFits, predictPrimaryParams } from '../src/models/secondaryModels.js';
import { runMonteCarloWithFactors } from '../src/models/monteCarlo.js';
import { createSeededRng } from '../src/utils/random.js';

const dir = 'reports/paper_sync_20261111';
const t1 = getExampleCase('t1-milk-powder-wmp');
const rep = t1.datasets.find(dataset => dataset.id === 'lab_milk_wmp_75_010');
const fits = Object.fromEntries(t1.datasets.map(dataset => [
  `${dataset.id}_LOG_LINEAR`,
  { ...fitPrimaryInTimeUnit('LOG_LINEAR', dataset.data), modelId: 'LOG_LINEAR', datasetId: dataset.id },
]));
const sec = runAllSecondaryFits({
  datasets: t1.datasets,
  fitResults: fits,
  scenario: 'thermal',
  primaryFactorKey: 'temp',
  referenceParams: t1.secondaryDefaults.referenceParams,
}).EXTENDED_BIGELOW_D;
const modelFn = MODELS.LOG_LINEAR.fn;
const paramNames = MODELS.LOG_LINEAR.params.map(param => param.name);
const bindings = { kmax: 'EXTENDED_BIGELOW_D' };
const manualParams = { logN0: 7.5 };
const factorValues = { temp: 80, aw: 0.2, pH: 7 };
const fittedSecondaryModels = { EXTENDED_BIGELOW_D: sec };
const predict = (fitted, factors) => predictPrimaryParams({
  primaryModelId: 'LOG_LINEAR', primaryFactorKey: 'temp', bindings,
  fittedSecondaryModels: fitted, manualParams, factors,
});
const predictedParams = predict(fittedSecondaryModels, factorValues);

const rows = [];
for (const nSamples of [10000, 50000]) {
  for (let seedIndex = 1; seedIndex <= 20; seedIndex += 1) {
    const seed = `review-20261111-${String(seedIndex).padStart(2, '0')}`;
    const mc = runMonteCarloWithFactors({
      modelId: 'LOG_LINEAR',
      primaryFit: fits[`${rep.id}_LOG_LINEAR`],
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
      tEval: 60,
      timeUnitToMin: 1,
      tMax: 60,
      timePoints: 2,
      paramNames,
      modelFn,
      predictParamsFn: factors => predict(fittedSecondaryModels, factors),
      predictParamsFnFactory: fitted => factors => predict(fitted, factors),
      tArray: [0, 60],
      rng: createSeededRng(seed),
    });
    const ks = mc.paramSamples[paramNames.indexOf('kmax')];
    const times = ks.map(k => 5 * Math.LN10 / k).sort((a, b) => a - b);
    const successCount = ks.filter(k => 60 * k / Math.LN10 >= 5 - 1e-10).length;
    rows.push({
      nSamples,
      seed,
      accepted: ks.length,
      rejected: mc.rejectedSamples,
      successPercent: 100 * successCount / ks.length,
      time99: times[Math.ceil(0.99 * times.length) - 1],
      time999: times[Math.ceil(0.999 * times.length) - 1],
    });
  }
}

const stats = values => {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    mean,
    sd: Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)),
    min: Math.min(...values),
    max: Math.max(...values),
  };
};
const summary = [10000, 50000].map(nSamples => ({
  nSamples,
  seeds: 20,
  successPercent: stats(rows.filter(row => row.nSamples === nSamples).map(row => row.successPercent)),
  time99: stats(rows.filter(row => row.nSamples === nSamples).map(row => row.time99)),
  time999: stats(rows.filter(row => row.nSamples === nSamples).map(row => row.time999)),
}));

fs.writeFileSync(`${dir}/mc_repeatability.json`, JSON.stringify({
  configuration: {
    seeds: 'review-20261111-01 through review-20261111-20',
    sampleSizes: [10000, 50000],
    targetReduction: 5,
    endpoint: 60,
    nominalFactorValues: factorValues,
    manualParams,
    quantiles: 'ceil(q*N) order statistic of exact log-linear first-passage times; no grid rounding',
    purpose: 'Numerical repeatability conditional on the same fitted T1 model and assumed uncertainty, not biological validation.',
  },
  summary,
  rows,
}, null, 2));
fs.writeFileSync(`${dir}/mc_repeatability.csv`, [
  'nSamples,seed,accepted,rejected,successPercent,time99,time999',
  ...rows.map(row => [row.nSamples, row.seed, row.accepted, row.rejected, row.successPercent, row.time99, row.time999].join(',')),
].join('\n') + '\n');
console.log(JSON.stringify(summary, null, 2));
