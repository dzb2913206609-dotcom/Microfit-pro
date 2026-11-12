import assert from 'node:assert/strict';

import { getExampleCase } from '../src/config/exampleDatasets.js';
import { fitPrimaryInTimeUnit } from '../src/utils/unitFitting.js';
import {
  buildSecondaryRows,
  computeLinkedPrimaryCurveMetrics,
  fitSecondaryModel,
} from '../src/models/secondaryModels.js';

const example = getExampleCase('t1-milk-powder-wmp');
assert.ok(example, 't1-milk-powder-wmp example should exist');

const fitResults = {};
for (const dataset of example.datasets) {
  const result = fitPrimaryInTimeUnit('LOG_LINEAR', dataset.data);
  assert.ok(result?.params, `LOG_LINEAR fit should succeed for ${dataset.id}`);
  fitResults[`${dataset.id}_LOG_LINEAR`] = {
    ...result,
    datasetId: dataset.id,
    modelId: 'LOG_LINEAR',
  };
}

const rows = buildSecondaryRows({
  datasets: example.datasets,
  fitResults,
  primaryModelId: 'LOG_LINEAR',
  targetKey: 'D',
  secondaryModelId: 'EXTENDED_BIGELOW',
});

const secondaryFit = fitSecondaryModel(
  'EXTENDED_BIGELOW',
  rows,
  example.secondaryDefaults.referenceParams,
);

assert.ok(secondaryFit?.params, 'EXTENDED_BIGELOW secondary fit should succeed');

const metrics = computeLinkedPrimaryCurveMetrics({
  datasets: example.datasets,
  fitResults,
  primaryModelId: 'LOG_LINEAR',
  targetKey: 'D',
  secondaryModelId: 'EXTENDED_BIGELOW',
  secondaryParams: secondaryFit.params,
});

// Nine WMP survival curves x six time points x three batch replicates.
assert.equal(metrics.n, 162);
assert.equal(metrics.datasetCount, 9);
assert.ok(
  Math.abs(metrics.rmse - 0.25993686479362915) < 1e-8,
  `expected linked curve RMSE for the WMP calibration data, got ${metrics.rmse}`,
);

console.log('linked curve metrics test passed');
