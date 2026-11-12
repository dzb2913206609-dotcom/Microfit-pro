import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MODELS } from '../src/models/inactivationModels.js';
import {
  buildSecondaryRows, computeDEntryY, fitSecondaryModel,
  MODEL_SECONDARY_CONFIG, predictPrimaryParams, predictRawParameterValue,
} from '../src/models/secondaryModels.js';

const near = (actual, expected, tolerance = 1e-7) => assert.ok(
  Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)),
  `expected ${expected}, got ${actual}`,
);

function rowsFor(secondaryModelId, targetKey = 'D', scale = 1) {
  const values = [10, 8, 7, 5, 4, 3, 2.5, 2];
  const datasets = values.map((_, i) => ({ id: `sample_${i}`, conditions: { temp: 50 + 2 * i, pressure: 400 } }));
  const fitResults = Object.fromEntries(values.map((value, i) => [
    `sample_${i}_LOG_LINEAR`, { params: { kmax: Math.LN10 / (value * scale) } },
  ]));
  return buildSecondaryRows({ datasets, fitResults, primaryModelId: 'LOG_LINEAR', targetKey, secondaryModelId });
}

test('rate targets use their actual kmax rather than its reciprocal', () => {
  for (const model of ['ARRHENIUS', 'SQRTMODEL', 'ARRHENIUS_EYRING']) {
    const rows = rowsFor(model, 'kmax');
    for (const row of rows) {
      near(row.fitValue, row.rawValue);
      near(row.y, model === 'SQRTMODEL' ? Math.sqrt(row.rawValue) : Math.log(row.rawValue));
    }
    const raw = predictRawParameterValue({ secondaryModelId: model,
      params: model === 'SQRTMODEL' ? { b: 0.1, Tmin: 0 } : model === 'ARRHENIUS'
        ? { lnA: 1, Ea: 0 } : { lnkRef: 1, EaR: 0, VaR: 0, Tref: 60, Pref: 400 },
      factors: { temp: 60, pressure: 400 }, targetConfig: MODEL_SECONDARY_CONFIG.LOG_LINEAR.targets.kmax });
    if (model === 'ARRHENIUS') near(raw, Math.E);
    if (model === 'SQRTMODEL') near(raw, 36);
    if (model === 'ARRHENIUS_EYRING') near(raw, Math.E);
  }
});

test('manual and automatic D entries use the same per-model response scale', () => {
  for (const model of ['BIGELOW', 'ARRHENIUS', 'SQRTMODEL', 'AVERAGE']) {
    const rows = rowsFor(model);
    const manual = computeDEntryY({ dValue: rows[0].rawValue, factors: rows[0].factors,
      primaryModelId: 'LOG_LINEAR', targetKey: 'D', secondaryModelId: model });
    near(manual.y, rows[0].y);
    near(manual.fitValue, rows[0].fitValue);
    assert.equal(manual.secondaryModelId, model);
    assert.equal(manual.responseTransform, rows[0].responseTransform);
  }
});

test('unbound Weibull time scales fall as treatment strengthens while rates rise', () => {
  for (const [primaryModelId, manualParams] of [
    ['WEIBULL', { logN0: 7, delta: 5, p: 1 }],
    ['WEIBULL_TAIL', { logN0: 7, delta: 5, p: 1, logNres: 1 }],
    ['MIXED_WEIBULL', { logN0: 7, delta1: 5, delta2: 10, p1: 1, p2: 1, f: 0.5 }],
  ]) {
    for (const factors of [{ temp: 70 }, { pressure: 500 }, { intensity: 15 }, { electricField: 30 }, { concentration: 300 }]) {
      const predicted = predictPrimaryParams({ primaryModelId, manualParams, factors });
      for (const param of ['delta', 'delta1', 'delta2']) {
        if (param in manualParams) near(predicted[param], manualParams[param] / 10);
      }
    }
    const base = predictPrimaryParams({ primaryModelId, manualParams, factors: { temp: 60 } });
    const hotter = predictPrimaryParams({ primaryModelId, manualParams, factors: { temp: 70 } });
    assert.ok(MODELS[primaryModelId].fn(5, hotter) < MODELS[primaryModelId].fn(5, base));
  }
  near(predictPrimaryParams({ primaryModelId: 'LOG_LINEAR', manualParams: { kmax: 2 }, factors: { temp: 70 } }).kmax, 20);
});

test('secondary AICc includes variance and response-transform Jacobians on raw D scale', () => {
  for (const model of ['BIGELOW', 'ARRHENIUS', 'SQRTMODEL', 'AVERAGE']) {
    const rows = rowsFor(model);
    const fit = fitSecondaryModel(model, rows);
    assert.ok(fit && !fit.failed, `${model} fit must succeed`);
    const logJacobian = rows.reduce((sum, row) => sum + (
      model === 'BIGELOW' ? -Math.log(row.rawValue * Math.LN10)
        : model === 'ARRHENIUS' ? -Math.log(row.rawValue)
          : model === 'SQRTMODEL' ? -Math.log(2) - 1.5 * Math.log(row.rawValue) : 0
    ), 0);
    const K = fit.k + 1;
    const expected = fit.n * Math.log(fit.sse / fit.n) + 2 * K
      + 2 * K * (K + 1) / (fit.n - K - 1) - 2 * logJacobian;
    near(fit.aicc, expected);
    near(fit.aiccLogJacobian, logJacobian);
    assert.equal(fit.aiccScale, 'D');
    assert.equal(fit.regressionScale, rows[0].responseTransform);
    const expectedRawSSE = rows.reduce((sum, row) => {
      const predicted = predictRawParameterValue({ secondaryModelId: model, params: fit.params,
        factors: row.factors, targetConfig: MODEL_SECONDARY_CONFIG.LOG_LINEAR.targets.D });
      return sum + (row.rawValue - predicted) ** 2;
    }, 0);
    near(fit.rawTargetRMSE, Math.sqrt(expectedRawSSE / rows.length));
  }
});

test('unit conversions preserve raw-target AICc differences and rankings', () => {
  const models = ['BIGELOW', 'ARRHENIUS', 'SQRTMODEL', 'AVERAGE'];
  const ordinary = models.map((model) => fitSecondaryModel(model, rowsFor(model)));
  const rescaled = models.map((model) => fitSecondaryModel(model, rowsFor(model, 'D', 0.001)));
  for (let i = 0; i < models.length; i++) {
    near(rescaled[i].aicc - ordinary[i].aicc, 2 * 8 * Math.log(0.001), 1e-5);
    near(rescaled[i].aicc - rescaled[0].aicc, ordinary[i].aicc - ordinary[0].aicc, 1e-5);
  }
});

test('D and kmax model likelihoods are normalized to the same primary parameter scale', () => {
  const Drows = rowsFor('ARRHENIUS');
  const Dfit = fitSecondaryModel('ARRHENIUS', Drows);
  const rateFit = fitSecondaryModel('ARRHENIUS', rowsFor('ARRHENIUS', 'kmax'));
  assert.equal(Dfit.aiccPrimaryParameterScale, 'kmax');
  assert.equal(rateFit.aiccPrimaryParameterScale, 'kmax');
  const mapJacobian = Drows.reduce((sum, row) => sum + Math.log(row.rawValue ** 2 / Math.LN10), 0);
  near(Dfit.aiccPrimaryParameter, Dfit.aicc - 2 * mapJacobian);
  near(rateFit.aiccPrimaryParameter, rateFit.aicc);
  near(Dfit.aiccPrimaryParameter, rateFit.aiccPrimaryParameter, 1e-5);
});

test('secondary fits reject reused response rows from a different transform or target', () => {
  assert.equal(fitSecondaryModel('AVERAGE', rowsFor('BIGELOW')), null);
  const rows = rowsFor('ARRHENIUS');
  rows[1] = rowsFor('ARRHENIUS', 'kmax')[1];
  assert.equal(fitSecondaryModel('ARRHENIUS', rows), null);
  const incorrectlyTransformed = rowsFor('BIGELOW').map((row) => ({ ...row, y: row.rawValue }));
  assert.equal(fitSecondaryModel('BIGELOW', incorrectlyTransformed), null);
});

test('likelihood rankings are unavailable without the original raw target scale', () => {
  const rows = rowsFor('AVERAGE').map(({ x, y, factors }) => ({ x, y, factors }));
  const fit = fitSecondaryModel('AVERAGE', rows);
  assert.ok(fit);
  assert.equal(fit.aiccValid, false);
  assert.equal(fit.aicc, null);
  assert.equal(fit.aiccPrimaryParameter, null);
});
test('a failed regression cannot regain valid likelihood metadata in its secondary adapter', () => {
  const rows = rowsFor('AVERAGE');
  rows[0].x = NaN;
  const fit = fitSecondaryModel('AVERAGE', rows);
  assert.ok(fit.failed);
  assert.equal(fit.aiccValid, false);
  assert.equal(fit.aiccPrimaryParameterValid, false);
  assert.equal(fit.aicc, null);
  assert.equal(fit.aiccPrimaryParameter, null);
});
