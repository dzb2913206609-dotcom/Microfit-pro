import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { getExampleCase } from '../src/config/exampleDatasets.js';
import { expandPrimaryObservations } from '../src/utils/primaryObservations.js';
import { fitPrimaryInTimeUnit } from '../src/utils/unitFitting.js';
import { buildSecondaryRows, fitSecondaryModel } from '../src/models/secondaryModels.js';

const near = (actual, expected, tolerance = 1e-7) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

function milkPowderSamples() {
  const wmp = getExampleCase('t1-milk-powder-wmp');
  const nfdm = getExampleCase('t2-milk-powder-nfdm');
  assert.ok(wmp, 'the WMP milk-powder example must be registered');
  assert.ok(nfdm, 'the NFDM milk-powder example must be registered');
  return { wmp, nfdm, datasets: [...wmp.datasets, ...nfdm.datasets] };
}

test('milk-powder examples retain every original measurement, batch and worksheet row', () => {
  const { wmp, nfdm, datasets } = milkPowderSamples();
  assert.equal(wmp.datasets.length, 9);
  assert.equal(nfdm.datasets.length, 9);
  assert.ok(wmp.datasets.every(dataset => dataset.material === 'WMP'));
  assert.ok(nfdm.datasets.every(dataset => dataset.material === 'NFDM'));
  for (const sample of [wmp, nfdm]) {
    assert.deepEqual(sample.secondaryDefaults.referenceParams, { Tref: 80, awRef: 0.2 });
  }
  const records = datasets.flatMap(dataset => {
    assert.equal(dataset.data.length, 6);
    assert.deepEqual(Object.keys(dataset.conditions).sort(), ['aw', 'temp']);
    return dataset.data.flatMap(point => {
      assert.equal(point.replicates, 3);
      assert.deepEqual(point.batchIds, [1, 2, 3]);
      return point.rawValues.map((logN, i) => [dataset.material, point.sourceRows[i],
        point.batchIds[i], dataset.conditions.temp, dataset.conditions.aw, point.t, logN]);
    });
  }).sort((a, b) => a[1] - b[1]);
  assert.equal(records.length, 324);
  assert.equal(new Set(records.map(row => row[1])).size, 324);
  assert.deepEqual(records.map(row => row[1]), Array.from({ length: 324 }, (_, i) => i + 2));
  // Independently extracted from Sheet1!A1:F325 of the supplied workbook.
  // Row 164 contains both the NFDM marker and its first valid observation.
  assert.equal(createHash('sha256').update(JSON.stringify(records)).digest('hex'),
    '3b33c3aa7a4bf36b3fb5a7d1788085b2df8aa98d5c1fefc71186737a7631162c');
  for (const [id, material] of [['t1-milk-powder-wmp', 'WMP'], ['t2-milk-powder-nfdm', 'NFDM']]) {
    const sample = getExampleCase(id);
    assert.ok(sample);
    assert.equal(sample.datasets.length, 9);
    assert.ok(sample.datasets.every(dataset => dataset.material === material));
  }
});

test('milk-powder primary fits use all observations and match independent OLS', () => {
  const { datasets } = milkPowderSamples();
  for (const dataset of datasets) {
    const points = expandPrimaryObservations(dataset.data);
    const n = points.length;
    assert.equal(n, 18);
    const mx = points.reduce((sum, point) => sum + point.t, 0) / n;
    const my = points.reduce((sum, point) => sum + point.logN, 0) / n;
    const slope = points.reduce((sum, point) => sum + (point.t - mx) * (point.logN - my), 0)
      / points.reduce((sum, point) => sum + (point.t - mx) ** 2, 0);
    const intercept = my - slope * mx;
    const sse = points.reduce((sum, point) => sum + (point.logN - intercept - slope * point.t) ** 2, 0);
    const fit = fitPrimaryInTimeUnit('LOG_LINEAR', dataset.data);
    assert.equal(fit.failed, false);
    assert.equal(fit.n, n);
    near(fit.params.logN0, intercept);
    near(fit.params.kmax, -slope * Math.LN10);
    near(fit.rmse, Math.sqrt(sse / n));
    const K = 3; // intercept, slope, residual variance
    near(fit.aicc, n * Math.log(sse / n) + 2 * K + 2 * K * (K + 1) / (n - K - 1));
    for (const point of dataset.data) {
      const mean = point.rawValues.reduce((sum, value) => sum + value, 0) / 3;
      near(point.logN, mean);
      near(point.mean, mean);
      near(point.sd, Math.sqrt(point.rawValues.reduce((sum, value) => sum + (value - mean) ** 2, 0) / 2));
    }
  }
});

test('milk-powder secondary fit matches the balanced-design OLS solution and counts curves', () => {
  const { datasets, wmp } = milkPowderSamples();
  const fitResults = Object.fromEntries(datasets.map(dataset => [
    `${dataset.id}_LOG_LINEAR`, { ...fitPrimaryInTimeUnit('LOG_LINEAR', dataset.data), modelId: 'LOG_LINEAR' },
  ]));
  const rows = buildSecondaryRows({ datasets, fitResults, primaryModelId: 'LOG_LINEAR',
    targetKey: 'D', secondaryModelId: 'EXTENDED_BIGELOW' });
  assert.equal(rows.length, 18);
  // The full factorial design is centered on 80°C and aw=0.20; the columns are orthogonal.
  const logDref = rows.reduce((sum, row) => sum + row.y, 0) / rows.length;
  const slope = key => rows.reduce((sum, row) => sum + (row.factors[key] - (key === 'temp' ? 80 : 0.2)) * (row.y - logDref), 0)
    / rows.reduce((sum, row) => sum + (row.factors[key] - (key === 'temp' ? 80 : 0.2)) ** 2, 0);
  const fit = fitSecondaryModel('EXTENDED_BIGELOW', rows, wmp.secondaryDefaults.referenceParams);
  assert.equal(fit.n, 18);
  assert.equal(fit.aiccValid, true);
  near(fit.params.logDref, logDref);
  near(fit.params.zT, -1 / slope('temp'));
  near(fit.params.zaw, -1 / slope('aw'));
  near(10 ** fit.params.logDref, 12.483851830863058);
  assert.ok(fit.paramCI95.zT.every(Number.isFinite));
  assert.ok(fit.paramCI95.zaw.every(Number.isFinite));
});
