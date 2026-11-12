import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeSobolTotal, computeMorris } from '../src/models/sensitivityAnalysis.js';
import { createSeededRng } from '../src/utils/random.js';
import { FACTOR_DEFS } from '../src/models/secondaryModels.js';

test('Jansen Sobol estimates preserve finite-sample values above two and flag estimation uncertainty', () => {
  const seed = '3', N = 16;
  const rng = createSeededRng(seed);
  const point = () => [0.8 + 0.4 * rng(), 0.8 + 0.4 * rng()];
  const A = Array.from({ length: N }, point);
  const B = Array.from({ length: N }, point);
  const response = x => Math.exp(50 * x[0] * x[1]);
  const Y = [...A.map(response), ...B.map(response)];
  const mean = Y.reduce((sum, value) => sum + value, 0) / Y.length;
  const variance = Y.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (Y.length - 1);
  const expected = A.reduce((sum, row, index) => sum + (
    response(row) - response([row[0], B[index][1]])
  ) ** 2, 0) / (2 * N * variance);
  assert.ok(expected > 2, 'this nonlinear finite sample exposes the former arbitrary clipping');
  const result = computeSobolTotal({
    modelId: 'LOG_LINEAR', modelFn: (_t, p) => Math.exp(50 * p.logN0 * p.kmax),
    nominalParams: { logN0: 1, kmax: 1 }, paramNames: ['logN0', 'kmax'],
    timeUnitToMin: 1, tEval: 1, N, rng: createSeededRng(seed),
  });
  const estimate = result.results.find(row => row.param === 'kmax').st;
  assert.ok(Math.abs(estimate - expected) < 1e-10, `expected raw estimate ${expected}, got ${estimate}`);
  assert.ok(result.estimationWarnings.some(warning => warning.includes('kmax')));
});

test('Jansen first-order Sobol estimate is one for a single-parameter model', () => {
  const result = computeSobolTotal({
    modelId: 'LOG_LINEAR', modelFn: (_t, p) => p.kmax,
    nominalParams: { kmax: 2 }, paramNames: ['kmax'],
    timeUnitToMin: 1, tEval: 1, N: 128, rng: createSeededRng('s1-one'),
  });
  assert.ok(result);
  assert.ok(Math.abs(result.results[0].s1 - 1) < 1e-12);
  assert.ok(Math.abs(result.sumS1 - 1) < 1e-12);
});

test('Jansen first-order Sobol estimates match total effects and sum to one for an additive model', () => {
  const result = computeSobolTotal({
    modelId: 'LOG_LINEAR', modelFn: (_t, p) => p.logN0 - 10 * p.kmax,
    nominalParams: { logN0: 7, kmax: 1 }, paramNames: ['logN0', 'kmax'],
    timeUnitToMin: 1, tEval: 10, N: 8192, rng: createSeededRng('s1-additive'),
  });
  assert.ok(result);
  for (const row of result.results) {
    assert.ok(Math.abs(row.s1 - row.st) < 0.05, `${row.param}: S1=${row.s1}, ST=${row.st}`);
  }
  assert.ok(Math.abs(result.sumS1 - 1) < 0.05, `sumS1=${result.sumS1}`);
});

for (const [method, compute] of [['Morris', computeMorris], ['Sobol', computeSobolTotal]]) {
  test(`${method} honors explicit calibrated factor bounds and omits a fixed factor`, () => {
    const result = compute({
      modelFn: (_t, p) => p.value, nominalParams: {}, paramNames: [], tEval: 1,
      factorValues: { temp: 70, pH: 7 }, factorKeys: ['temp', 'pH'],
      factorRanges: { temp: { min: 55, max: 70 }, pH: { min: 7, max: 7 } },
      predictParamsFn: factors => {
        assert.ok(factors.temp >= 55 && factors.temp <= 70, `sampled T=${factors.temp}`);
        assert.equal(factors.pH, 7);
        return { value: factors.temp };
      },
      rng: createSeededRng('calibrated'), N: 128,
    });
    assert.deepEqual(result.results.map(row => row.param), ['temp']);
    if (method === 'Morris') assert.ok(Math.abs(result.results[0].muStar - 15) < 1e-10);
  });
  test(`${method} defaults to bound-secondary calibration rows without mutating shared factor definitions`, () => {
    const before = structuredClone(FACTOR_DEFS);
    const args = {
      modelFn: (_t, p) => p.value, nominalParams: {}, paramNames: [], tEval: 1,
      factorValues: { temp: 70, pH: 7 }, factorKeys: ['temp', 'pH'],
      bindings: { kmax: 'fitted' },
      fittedSecondaryModels: { fitted: { params: {}, rows: [
        { factors: { temp: 55, pH: 7 } }, { factors: { temp: 70, pH: 7 } },
      ] } },
      predictParamsFn: factors => {
        assert.ok(factors.temp >= 55 && factors.temp <= 70, `sampled T=${factors.temp}`);
        assert.equal(factors.pH, 7);
        return { value: factors.temp };
      },
      rng: createSeededRng('calibrated'), N: 128,
    };
    assert.deepEqual(compute(args).results.map(row => row.param), ['temp']);
    compute({ ...args, factorRanges: { temp: { min: 60, max: 65 } },
      predictParamsFn: factors => {
        assert.ok(factors.temp >= 60 && factors.temp <= 65);
        return { value: factors.temp };
      }, rng: createSeededRng('override') });
    assert.deepEqual(FACTOR_DEFS, before);
  });
}

test('global sensitivity defaults use a common calibration range for multiple bound fits', () => {
  const result = computeMorris({
    modelFn: (_t, p) => p.value, nominalParams: {}, paramNames: [], tEval: 1,
    factorValues: { temp: 65 }, factorKeys: ['temp'], bindings: { kmax: 'a', Sl: 'b' },
    fittedSecondaryModels: {
      a: { params: {}, rows: [{ factors: { temp: 55 } }, { factors: { temp: 70 } }] },
      b: { params: {}, rows: [{ factors: { temp: 60 } }, { factors: { temp: 75 } }] },
    },
    predictParamsFn: factors => {
      assert.ok(factors.temp >= 60 && factors.temp <= 70);
      return { value: factors.temp };
    }, rng: createSeededRng('intersection'),
  });
  assert.deepEqual(result.factorRanges.temp, { min: 60, max: 70 });
});
