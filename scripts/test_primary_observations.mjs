import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fitModel, fitModelMultiStart } from '../src/models/fitter.js';
import { fitPrimaryInTimeUnit } from '../src/utils/unitFitting.js';
import { MODELS } from '../src/models/inactivationModels.js';
import { buildPrimaryFitReportRows } from '../src/utils/primaryReport.js';
import { buildSecondaryRows, computeLinkedPrimaryCurveMetrics, fitSecondaryModel } from '../src/models/secondaryModels.js';
import { EXAMPLE_CASES } from '../src/config/exampleDatasets.js';

const groups = [
  { t: 0, logN: 8, rawValues: [7.8, 8.2] },
  { t: 1, logN: 7.2, rawValues: [7.1, 7.2, 7.3] },
  { t: 2, logN: 6, rawValues: [6] },
  { t: 3, logN: 5.8, rawValues: [5.6, 5.8, 6] },
  { t: 4, logN: 4, rawValues: [3.9, 4.1] },
];
const observations = groups.flatMap(row => row.rawValues.map(logN => ({ t: row.t, logN })));
const near = (actual, expected, tol = 1e-7) => assert.ok(Math.abs(actual - expected) < tol, `${actual} != ${expected}`);

test('unbalanced repeats fit individual-observation OLS and use consistent n, SSE, likelihood and covariance', () => {
  const original = structuredClone(groups);
  const result = fitModel('LOG_LINEAR', groups);
  const n = observations.length, k = 2, K = 3;
  const mx = observations.reduce((s, row) => s + row.t, 0) / n;
  const my = observations.reduce((s, row) => s + row.logN, 0) / n;
  const sxx = observations.reduce((s, row) => s + (row.t - mx) ** 2, 0);
  const slope = observations.reduce((s, row) => s + (row.t - mx) * (row.logN - my), 0) / sxx;
  const intercept = my - slope * mx;
  const sse = observations.reduce((s, row) => s + (row.logN - intercept - slope * row.t) ** 2, 0);
  const sst = observations.reduce((s, row) => s + (row.logN - my) ** 2, 0);
  assert.equal(result.n, n);
  assert.equal(result.residuals.length, n);
  near(result.params.logN0, intercept);
  near(result.params.kmax, -slope * Math.LN10);
  near(result.sse, sse);
  near(result.rmse, Math.sqrt(sse / n));
  near(result.r2, 1 - sse / sst);
  near(result.r2adj, 1 - sse / sst * (n - 1) / (n - k));
  near(result.aicc, n * Math.log(sse / n) + 2 * K + 2 * K * (K + 1) / (n - K - 1));
  near(result.mse, sse / (n - k));
  near(result.paramErrors.kmax, Math.sqrt(sse / (n - k) / sxx) * Math.LN10);
  assert.deepEqual(groups, original, 'fit must preserve means, SD and raw observations for plotting');
  const meanFit = fitModel('LOG_LINEAR', groups.map(({ t, logN }) => ({ t, logN })));
  assert.ok(Math.abs(meanFit.params.kmax - result.params.kmax) > .01);
});

test('balanced repeats retain optimal curve while including within-group error in statistics', () => {
  const data = groups.map(row => ({ ...row, rawValues: [row.logN - .2, row.logN + .2] }));
  const actual = fitModel('LOG_LINEAR', data);
  const means = fitModel('LOG_LINEAR', data.map(({ t, logN }) => ({ t, logN })));
  near(actual.params.kmax, means.params.kmax);
  near(actual.sse, 2 * means.sse + data.length * 2 * .2 ** 2);
  assert.equal(actual.n, 10);
});

test('nonlinear multi-start and physical time conversion agree with explicit expansion', () => {
  const params = { logN0: 8, delta: 2, p: 1.3 };
  const data = [0, 1, 2, 3, 4, 5].map(t => {
    const logN = MODELS.WEIBULL.fn(t, params);
    return { t, logN, rawValues: [logN - .1, logN + .1] };
  });
  const flat = data.flatMap(row => row.rawValues.map(logN => ({ t: row.t, logN })));
  const expected = fitModelMultiStart('WEIBULL', flat);
  const actual = fitModelMultiStart('WEIBULL', data);
  assert.equal(actual.n, 12);
  near(actual.sse, expected.sse);
  for (const name of ['logN0', 'delta', 'p']) near(actual.params[name], expected.params[name]);
  const unitFit = fitPrimaryInTimeUnit('LOG_LINEAR', groups.map(row => ({ ...row, t: row.t * 60 })), { timeUnitToMin: 1 / 60 });
  const baseline = fitModel('LOG_LINEAR', observations);
  assert.equal(unitFit.n, observations.length);
  near(unitFit.params.kmax * 60, baseline.params.kmax);
  near(unitFit.aicc, baseline.aicc);
});

test('means-only data are never multiplied by replicate counts or SD; bad raw values are not discarded', () => {
  const means = groups.map(({ t, logN }) => ({ t, logN }));
  const summary = means.map(row => ({ ...row, replicates: 20, sd: 1, rawValues: [] }));
  const result = fitModel('LOG_LINEAR', summary);
  assert.equal(result.n, means.length);
  near(result.sse, fitModel('LOG_LINEAR', means).sse);
  for (const fn of [fitModel, fitModelMultiStart]) {
    const invalid = fn('LOG_LINEAR', groups.map((row, i) => i ? row : { ...row, rawValues: [7.8, NaN] }));
    assert.equal(invalid.failed, true);
    assert.equal(invalid.aiccValid, false);
  }
});

test('primary CSV exports every observation and its matching residual', () => {
  const result = fitModel('LOG_LINEAR', groups);
  const rows = buildPrimaryFitReportRows({ data: groups }, result, MODELS.LOG_LINEAR);
  const values = rows.filter(row => row[0] === 'Observed vs Predicted' && typeof row[1] === 'number');
  assert.equal(values.length, observations.length);
  values.forEach((row, i) => {
    assert.equal(row[1], observations[i].t);
    assert.equal(row[2], observations[i].logN);
    near(row[4], row[2] - row[3]);
    near(row[4], result.residuals[i]);
  });
});

test('linked curve RMSE counts original repeats but secondary regression remains condition-level', () => {
  const fit = fitModel('LOG_LINEAR', groups);
  const metrics = computeLinkedPrimaryCurveMetrics({
    datasets: [{ id: 'd', data: groups, conditions: { temp: 60 } }],
    fitResults: { d_LOG_LINEAR: { ...fit, modelId: 'LOG_LINEAR' } }, primaryModelId: 'LOG_LINEAR',
    targetKey: 'D', secondaryModelId: 'BIGELOW', secondaryParams: { logDref: 0, z: 10, Tref: 60 },
  });
  assert.equal(metrics.n, observations.length);
  const expectedSSE = observations.reduce((s, row) => s + (row.logN - (fit.params.logN0 - row.t)) ** 2, 0);
  near(metrics.sse, expectedSSE);
  near(metrics.rmse, Math.sqrt(expectedSSE / observations.length));
});

test('secondary AICc n remains the number of condition-level parameter estimates', () => {
  const datasets = Array.from({ length: 6 }, (_, i) => ({ id: `d${i}`, name: `Condition ${i}`,
    conditions: { temp: 55 + i * 2 }, data: groups.map(row => ({ ...row,
      logN: row.logN - row.t * i * .1, rawValues: row.rawValues.map(value => value - row.t * i * .1),
    })) }));
  const fitResults = Object.fromEntries(datasets.map(ds => [`${ds.id}_LOG_LINEAR`, {
    ...fitModel('LOG_LINEAR', ds.data), datasetId: ds.id, modelId: 'LOG_LINEAR',
  }]));
  const rows = buildSecondaryRows({ datasets, fitResults, primaryModelId: 'LOG_LINEAR', targetKey: 'D', secondaryModelId: 'BIGELOW' });
  assert.equal(rows.length, datasets.length);
  const secondary = fitSecondaryModel('BIGELOW', rows, { Tref: 60 });
  assert.equal(secondary.n, datasets.length);
  assert.equal(secondary.aiccValid, true);
});

test('paper examples retain the same supplied observations, including duplicate times', () => {
  for (const example of EXAMPLE_CASES) {
    // The paper samples transcribe single mean values; laboratory samples such
    // as the milk-powder examples intentionally keep their replicate observations.
    if (!example.id.startsWith('paper-')) continue;
    for (const dataset of example.datasets ?? []) {
      const data = dataset.data;
      assert.ok(data.every(row => !row.rawValues?.length || (row.rawValues.length === 1 && row.rawValues[0] === row.logN)),
        `${example.id}/${dataset.id}: paper example requires a numerical recheck`);
      const actual = fitModel('LOG_LINEAR', data);
      const expected = fitModel('LOG_LINEAR', data.map(({ t, logN }) => ({ t, logN })));
      assert.equal(actual.n, expected.n);
      assert.deepEqual(actual.params, expected.params);
      assert.equal(actual.aicc, expected.aicc);
    }
  }
});
