import assert from 'node:assert/strict';

import { summarizeDynamicObservationFit } from '../src/models/dynamicSimulation.js';

const simulation = [
  { t: 0, logN: 10 },
  { t: 5, logN: 8 },
  { t: 10, logN: 4 },
];

const observations = [
  { series: 'A', t: 0, logN: 10 },
  { series: 'A', t: 2.5, logN: 9.5 },
  { series: 'A', t: 10, logN: 5 },
];

const summary = summarizeDynamicObservationFit(simulation, observations);

assert.equal(summary.n, 3);
assert.equal(summary.rows[1].predictedLogN, 9);
assert.equal(summary.rows[1].residual, 0.5);
assert.equal(summary.rows[2].predictedLogN, 4);
assert.equal(summary.rows[2].residual, 1);
assert.equal(summary.rmse, Math.sqrt((0 ** 2 + 0.5 ** 2 + 1 ** 2) / 3));
assert.equal(summary.mae, (0 + 0.5 + 1) / 3);

const emptySummary = summarizeDynamicObservationFit([], observations);
assert.equal(emptySummary.n, 0);
assert.equal(emptySummary.rmse, null);

console.log('dynamic observation fit utilities ok');
