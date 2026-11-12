import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getExampleCase } from '../src/config/exampleDatasets.js';
import { fitPrimaryInTimeUnit } from '../src/utils/unitFitting.js';

// Author-confirmed source: Saldaña et al. (2010), S. aureus STCC 4459,
// 15 kV/cm, pH 7.0. Values are log10(N) with N0 = 8.
const sourcePoints = [[0, 7.98649], [13.9555, 7.67602], [73.0644, 7.46113], [148.376, 7.32769], [297.854, 6.97971], [498.334, 6.41666]];

test('N5-Sa built-in example preserves all six author-confirmed source observations', () => {
  const dataset = getExampleCase('paper-n5-primary-time-us').datasets.find(row => row.id === 'n5_sa');
  assert.deepEqual(dataset.data.map(({ t, logN }) => [t, logN]), sourcePoints);
});

test('N5-Sa source data retain their observed initial count through fitting', () => {
  const data = getExampleCase('paper-n5-primary-time-us').datasets.find(row => row.id === 'n5_sa').data;
  const fit = fitPrimaryInTimeUnit('WEIBULL', data, { timeUnitToMin: 1/60000000 });
  assert.equal(fit.n, 6);
  assert.ok(fit.converged);
  assert.ok(Math.abs(fit.params.logN0 - 8) < 0.1);
  assert.ok(fit.params.p > 0.01);
  assert.ok(fit.covMatrix?.every(row => row.every(Number.isFinite)));
});
