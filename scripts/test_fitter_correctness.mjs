import assert from 'node:assert/strict';
import test from 'node:test';
import { computeSSE, fitModel, fitRegressionModel } from '../src/models/fitter.js';
import { MODELS } from '../src/models/inactivationModels.js';

const linearDefs = [{ name: 'a', defaultValue: 9 }, { name: 'b', defaultValue: 1 }];
const data = [0, 1, 2, 3, 4, 5].map((x, i) => ({ x, y: 10 - x + [.2, -.1, .1, -.2, .1, -.1][i] }));
const linearFit = () => fitRegressionModel({ modelFn: (x, p) => p.a - p.b * x, paramDefs: linearDefs, data });
const close = (actual, expected, tol = 1e-7) => assert.ok(Math.abs(actual - expected) < tol, `${actual} vs ${expected}`);

test('RMSE and adjusted R² use their own degrees of freedom', () => {
  const r = linearFit();
  close(r.rmse, Math.sqrt(r.sse / r.n));
  close(r.r2adj, 1 - (1 - r.r2) * (r.n - 1) / (r.n - r.k));
  close(r.residualSE, Math.sqrt(r.sse / (r.n - r.k)));
});
test('Gaussian AICc includes estimated variance and rejects insufficient n', () => {
  const r = linearFit(), K = r.k + 1;
  close(r.aicc, r.n * Math.log(r.sse / r.n) + 2 * K + 2 * K * (K + 1) / (r.n - K - 1));
  const small = fitRegressionModel({ modelFn: (x, p) => p.a - p.b * x, paramDefs: linearDefs, data: data.slice(0, 4) });
  assert.equal(small.aiccValid, false);
  assert.equal(small.aicc, null);
});
test('nonfinite predictions cannot look like a perfect fit', () => {
  assert.equal(computeSSE(() => NaN, {}, data), Infinity);
  const r = fitRegressionModel({ modelFn: () => NaN, paramDefs: linearDefs, data });
  assert.equal(r.failed, true);
  assert.equal(r.aiccValid, false);
  assert.equal(r.r2, null);
  assert.equal(r.rmse, null);
  const invalidX = fitRegressionModel({ modelFn: (_, p) => p.a, paramDefs: [{ name: 'a', defaultValue: 0 }], data: data.map((row, i) => ({ ...row, x: i === 0 ? NaN : row.x })) });
  assert.equal(invalidX.failed, true);
  assert.equal(invalidX.aiccValid, false);
  assert.equal(invalidX.aicc, null);
});
test('active bound still optimizes the other parameters', () => {
  const r = fitModel('LOG_LINEAR', [0, 1, 2, 3].map(t => ({ t, logN: 1 + t })));
  close(r.params.logN0, 2.5 + .001 * 1.5 / Math.LN10, 1e-6);
  assert.ok(r.converged);
  assert.ok(r.r2 < 0);
});
test('equal initial and residual populations can move together along their constraint', () => {
  const data = [0, 1, 3, 4].map((logN, t) => ({ t, logN }));
  for (const id of ['LOG_LINEAR_TAIL', 'WEIBULL_TAIL', 'SHOULDER_TAIL', 'BARANYI']) {
    const r = fitModel(id, data, { logN0: 1, logNres: 1, logNmin: 1, kmax: 1 });
    assert.ok(r.sse <= 10.000001, `${id} SSE=${r.sse} exceeds a feasible constant mean fit`);
    assert.ok(!r.failed);
  }
});
test('coupled population projection respects declared residual bounds', () => {
  const r = fitModel('LOG_LINEAR_TAIL', Array.from({ length: 6 }, (_, t) => ({ t, logN: -30 })), { logN0: -30, logNres: -30, kmax: 1 });
  assert.ok(r.params.logNres >= -20);
  assert.ok(r.params.logN0 >= r.params.logNres);
});
test('undefined centered R² and residual degrees of freedom are not fabricated', () => {
  const constant = fitRegressionModel({ modelFn: (_, p) => p.a, paramDefs: [{ name: 'a', defaultValue: 5 }], data: [0, 1, 2].map(x => ({ x, y: 5 })) });
  assert.equal(constant.r2, null);
  const saturated = fitRegressionModel({ modelFn: (x, p) => p.a - p.b * x, paramDefs: linearDefs, data: data.slice(0, 2) });
  assert.equal(saturated.r2adj, null);
  assert.equal(saturated.mse, null);
});
test('tail parameters represent initial total population and residual population', () => {
  const p = { logN0: 3, logNres: 2, kmax: 1 };
  close(MODELS.LOG_LINEAR_TAIL.fn(0, p), 3);
  close(MODELS.LOG_LINEAR_TAIL.fn(1000, p), 2);
});
test('shoulder models retain finite initial values for large k times shoulder', () => {
  for (const id of ['SHOULDER_TAIL', 'SHOULDER_NOTAIL', 'BIPHASIC_SHOULDER']) {
    const p = Object.fromEntries(MODELS[id].params.map(d => [d.name, d.defaultValue]));
    Object.assign(p, { kmax: 10, kmax1: 10, Sl: 100 });
    close(MODELS[id].fn(0, p), p.logN0);
    assert.ok(Number.isFinite(MODELS[id].fn(50, p)));
    assert.ok(MODELS[id].fn(50, p) <= p.logN0);
  }
});
test('concentration models do not manufacture a -10 log survival plateau', () => {
  close(MODELS.BIPHASIC.fn(100, { logN0: 7, kmax1: 1, kmax2: 1, f: .5 }), 7 - 100 / Math.LN10);
});
test('Shapiro–Wilk p values match reference results for small and larger samples', () => {
  for (const [values, expected] of [
    [[-5, 0, 0, 0, 5], .32542950716414576],
    [[1, 2, 3, 4, 5, 6], .9605549608523398],
    [[1, 1, 2], 0],
    [[-2, -1, 0, 1, 2], .9671739349728582],
  ]) {
    const r = fitRegressionModel({ modelFn: () => 0, paramDefs: [{ name: 'a', defaultValue: 0, fixed: true }], data: values.map((y, x) => ({ x, y })) });
    close(r.normalityPValue, expected, 2e-6);
  }
});
