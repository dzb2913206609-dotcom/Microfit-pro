import { getExampleCase } from '../src/config/exampleDatasets.js';
import { fitPrimaryInTimeUnit } from '../src/utils/unitFitting.js';
import { runAllSecondaryFits, predictPrimaryParams } from '../src/models/secondaryModels.js';
import { computeSobolTotal } from '../src/models/sensitivityAnalysis.js';
import { createSeededRng, deriveSeed } from '../src/utils/random.js';
import { MODELS } from '../src/models/inactivationModels.js';

const t1 = getExampleCase('t1-milk-powder-wmp');
const primaryFits = {};
for (const dataset of t1.datasets) {
  primaryFits[`${dataset.id}_LOG_LINEAR`] = {
    ...fitPrimaryInTimeUnit('LOG_LINEAR', dataset.data, { timeUnitToMin: 1 }),
    modelId: 'LOG_LINEAR',
    datasetId: dataset.id,
  };
}
const secondary = runAllSecondaryFits({
  datasets: t1.datasets,
  fitResults: primaryFits,
  scenario: 'thermal',
  primaryFactorKey: 'temp',
  referenceParams: { Tref: 80, awRef: 0.2 },
});
const sec = secondary.EXTENDED_BIGELOW_D;
const factorValues = { temp: 80, aw: 0.2, pH: 7 };
const manualParams = { logN0: 7.5 };
const bindings = { kmax: 'EXTENDED_BIGELOW_D' };
const predict = (fitted, factors) => predictPrimaryParams({
  primaryModelId: 'LOG_LINEAR', primaryFactorKey: 'temp', bindings,
  fittedSecondaryModels: fitted, manualParams, factors,
});
const predictedParams = predict({ EXTENDED_BIGELOW_D: sec }, factorValues);
const paramNames = MODELS.LOG_LINEAR.params.map(param => param.name);
const modelFn = MODELS.LOG_LINEAR.fn;
const factorValuesForSensitivity = factorValues;
const factorKeys = ['temp', 'aw', 'pH'];
const fittedSecondaryModels = { EXTENDED_BIGELOW_D: sec };
const predictParamsFn = factors => predict(fittedSecondaryModels, factors);
const predictParamsFnFactory = fitted => factors => predict(fitted, factors);
const factorRanges = { temp: { min: 75, max: 85 }, aw: { min: 0.1, max: 0.3 }, pH: { min: 7, max: 7 } };

for (const N of [128, 512, 1024, 2048, 8192]) {
  const result = computeSobolTotal({
    modelFn, nominalParams: predictedParams, paramNames,
    modelId: 'LOG_LINEAR', timeUnitToMin: 1, tEval: 60,
    predictParamsFn, factorValues: factorValuesForSensitivity, factorKeys,
    fittedSecondaryModels, bindings, predictParamsFnFactory, factorRanges,
    N, rng: createSeededRng(deriveSeed('20260430', `sobol-${N}`)),
  });
  console.log(JSON.stringify({
    N,
    sumS1: result?.sumS1,
    sumST: result?.sumST,
    results: result?.results.map(r => ({ param: r.param, label: r.label, category: r.category, s1: r.s1, st: r.st, contribution: r.contribution })),
    warnings: result?.estimationWarnings,
  }, null, 2));
}
