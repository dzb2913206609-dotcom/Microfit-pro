import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as secondary from '../src/models/secondaryModels.js';
const { MODEL_SECONDARY_CONFIG, SECONDARY_MODELS, buildSecondaryRows, computeLinkedPrimaryCurveMetrics, computeDEntryY, predictPrimaryParams } = secondary;
const base = { primaryModelId: 'LOG_LINEAR', targetKey: 'D', secondaryModelId: 'BIGELOW', datasets: [{ id: 'a', conditions: { temp: 60 }, data: [{ t: 1, logN: 6 }] }], fitResults: { a_LOG_LINEAR: { params: { logN0: 7, kmax: 1 } } } };

test('invalid D predictions remain invalid when bound to primary rates', () => {
  const target = MODEL_SECONDARY_CONFIG.LOG_LINEAR.targets.D;
  for (const D of [null, NaN, Infinity, 0, -1]) assert.ok(!Number.isFinite(target.invertPredictedValue(D)));
  const predicted = predictPrimaryParams({ primaryModelId: 'LOG_LINEAR', bindings: { kmax: 'bound' }, fittedSecondaryModels: { bound: { secondaryModelId: 'BIGELOW', targetKey: 'D', params: { logDref: 0, Tref: 60, z: 10 } } }, factors: {}, manualParams: { kmax: 0.5 } });
  assert.ok(!Number.isFinite(predicted.kmax));
  assert.equal(computeLinkedPrimaryCurveMetrics({ ...base, datasets: [{ ...base.datasets[0], conditions: {} }], secondaryParams: { logDref: 0, Tref: 60, z: 10 } }), null);
});

test('failed and explicitly unconverged primary fits supply no secondary observations or linked metrics', () => {
  for (const status of [{ failed: true }, { converged: false }]) {
    const fitResults = { a_LOG_LINEAR: { ...base.fitResults.a_LOG_LINEAR, ...status } };
    assert.deepEqual(buildSecondaryRows({ ...base, fitResults }), []);
    assert.equal(computeLinkedPrimaryCurveMetrics({ ...base, fitResults, secondaryParams: { logDref: 0, Tref: 60, z: 10 } }), null);
  }
  assert.equal(buildSecondaryRows(base).length, 1);
});

test('PATP observations and curves use the pressure axis named by the model', () => {
  const rows = buildSecondaryRows({ ...base, secondaryModelId: 'PATP_TRIPLE', datasets: [{ id: 'a', conditions: { temp: 50, pressure: 300, aw: 1 } }] });
  assert.equal(rows[0].x, 300);
  assert.equal(SECONDARY_MODELS.PATP_TRIPLE.factorKeys[0], 'pressure');
});

test('unbound scaling uses the operative primary factor even with hidden defaults', () => {
  const predicted = predictPrimaryParams({ primaryModelId: 'LOG_LINEAR', manualParams: { kmax: 0.5 }, factors: { temp: 60, pressure: 500 }, primaryFactorKey: 'pressure' });
  assert.equal(predicted.kmax, 5);
});

test('D and delta displays reverse both response and reciprocal transforms', () => {
  for (const [primaryModelId, targetKey] of [['LOG_LINEAR', 'D'], ['WEIBULL', 'delta']]) {
    const targetConfig = MODEL_SECONDARY_CONFIG[primaryModelId].targets[targetKey];
    for (const [secondaryModelId, value] of [['ARRHENIUS', Math.log(0.1)], ['SQRTMODEL', Math.sqrt(0.1)], ['ARRHENIUS_EYRING', Math.log(0.1)]]) {
      assert.ok(Math.abs(secondary.secondaryResponseToRaw({ value, targetConfig, secondaryModelId }) - 10) < 1e-10);
    }
  }
});

test('manual rows missing factors required by the selected model cannot enter calibration', () => {
  assert.equal(computeDEntryY({ dValue: 10, factors: { pressure: 300 }, primaryModelId: 'LOG_LINEAR', targetKey: 'D', secondaryModelId: 'PATP_TRIPLE' }), null);
});

test('every model display agrees with its predicted raw target', () => {
  for (const secondaryModelId of Object.keys(SECONDARY_MODELS)) {
    const model = SECONDARY_MODELS[secondaryModelId];
    const params = Object.fromEntries(model.params.map(param => [param.name, param.defaultValue]));
    const factors = { temp: 60, pressure: 400, aw: 1, pH: 7, intensity: 10, turbidity: 0, electricField: 20, conductivity: 2, concentration: 200, doseRate: 5 };
    for (const targetConfig of [MODEL_SECONDARY_CONFIG.LOG_LINEAR.targets.D, MODEL_SECONDARY_CONFIG.LOG_LINEAR.targets.kmax]) {
      const response = model.predictY(factors, params);
      const raw = secondary.predictRawParameterValue({ secondaryModelId, params, factors, targetConfig });
      if (!Number.isFinite(response) || !Number.isFinite(raw)) continue;
      const displayed = secondary.secondaryResponseToRaw({ value: response, targetConfig, secondaryModelId });
      assert.ok(Number.isFinite(displayed) && Math.abs(displayed - raw) < 1e-9 * Math.max(1, Math.abs(raw)), `${secondaryModelId}: displayed ${displayed}, raw ${raw}`);
    }
  }
  const targetConfig = MODEL_SECONDARY_CONFIG.LOG_LINEAR.targets.D;
  assert.equal(secondary.secondaryResponseToRaw({ value: -0.1, targetConfig, secondaryModelId: 'SQRTMODEL' }), 1 / (-0.1) ** 2);
});

test('irradiation unbound defaults scale proportionally to dose rate despite hidden temperature', () => {
  const rate = predictPrimaryParams({ primaryModelId: 'LOG_LINEAR', manualParams: { kmax: 0.5 }, primaryFactorKey: 'doseRate', factors: { temp: 60, doseRate: 10 } });
  assert.equal(rate.kmax, 1);
  const time = predictPrimaryParams({ primaryModelId: 'WEIBULL', manualParams: { delta: 5, p: 1 }, primaryFactorKey: 'doseRate', factors: { temp: 60, doseRate: 10 } });
  assert.equal(time.delta, 2.5);
  for (const doseRate of [null, undefined, NaN, Infinity, 0, -1]) {
    const result = predictPrimaryParams({ primaryModelId: 'LOG_LINEAR', manualParams: { kmax: 0.5 }, primaryFactorKey: 'doseRate', factors: { temp: 60, doseRate } });
    assert.ok(!Number.isFinite(result.kmax), `invalid doseRate ${doseRate} must remain invalid`);
  }
});
