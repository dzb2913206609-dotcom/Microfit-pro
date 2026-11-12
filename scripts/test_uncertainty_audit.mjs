import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runDynamicSimulation } from '../src/models/dynamicSimulation.js';
import { runMonteCarlo, runMonteCarloWithFactors, runMonteCarloFromPredicted } from '../src/models/monteCarlo.js';
import { computeMorris, computeSobolTotal, computeOATSensitivity } from '../src/models/sensitivityAnalysis.js';
import { createSeededRng } from '../src/utils/random.js';
import { MODELS } from '../src/models/inactivationModels.js';
import { FACTOR_DEFS, MODEL_SECONDARY_CONFIG, predictPrimaryParams, predictRawParameterValue } from '../src/models/secondaryModels.js';
import { resolveValidationTarget } from '../src/utils/validationDiagnostics.js';
import { fitModel } from '../src/models/fitter.js';
import { fitPrimaryInTimeUnit } from '../src/utils/unitFitting.js';
import { panelHarness } from './helpers/panelHarness.mjs';
import * as monteCarlo from '../src/models/monteCarlo.js';

function monteCarloHarness() {
  return panelHarness('src/components/MonteCarloPanel.jsx', 'MonteCarloPanel', {
    useScenario: () => ({ timeUnit: 'min', mode: { id: 'thermal' } }),
    MODELS, FACTOR_DEFS, predictPrimaryParams, runMonteCarloFromPredicted, runMonteCarloWithFactors,
    secondaryUncertainParamNames: monteCarlo.secondaryUncertainParamNames,
    createSeededRng, generateRandomSeed: () => 'generated',
  }, ['handleRun', 'result', 'stale', 'hasMC', 'sliderTime', 'safeTimeResult', 'setFactorSDs', 'setNSamples', 'setTargetReduction']);
}

const panelProps = { modelId: 'LOG_LINEAR', tMax: 10, predictedParams: { logN0: 7, kmax: Math.LN10 }, factorValues: { temp: 60 }, visibleFactorKeys: ['temp'], bindings: {}, fittedSecondaryModels: {}, manualParams: { logN0: 7, kmax: Math.LN10 } };

for (const errors of [{ logDref: 0.1, z: 0.1 }, undefined]) {
  test(`MC panel propagates bound secondary covariance with zero factor sigma ${errors ? 'and SE' : 'without SE metadata'}`, async () => {
    const render = monteCarloHarness();
    const props = {
      ...panelProps, primaryFit: null,
      predictedParams: { logN0: 7, kmax: Math.LN10 / 10 },
      manualParams: { logN0: 7, kmax: Math.LN10 / 10 }, bindings: { kmax: 'fit' },
      fittedSecondaryModels: { fit: { primaryModelId: 'LOG_LINEAR', secondaryModelId: 'BIGELOW', targetKey: 'D', params: { logDref: 1, z: 10, Tref: 60 }, paramNames: ['logDref', 'z'], paramErrors: errors, covMatrix: [[0.01, 0.006], [0.006, 0.01]], mse: 1 } },
    };
    render(props).setFactorSDs({ temp: 0 });
    render(props).setNSamples(100);
    await render(props).handleRun();
    const result = render(props).result;
    assert.ok(result.bands.at(-1).p95 > result.bands.at(-1).p5);
    assert.equal(result.secondaryParamSamples?.length, 2);
    assert.equal(result.secondaryParamSamples[0].length, 100);
  });
}

test('secondary covariance alone retains covariance correlation in factor sampling', () => {
  const result = runMonteCarloWithFactors({
    predictedParams: { logN0: 7, kmax: 1 }, paramNames: ['logN0', 'kmax'],
    modelFn: (t, p) => p.logN0 - p.kmax * t, tArray: [0, 1], nSamples: 2000,
    factorValues: { temp: 60 }, factorKeys: ['temp'], factorSDs: { temp: 0 }, bindings: { kmax: 'fit' },
    fittedSecondaryModels: { fit: { params: { a: 2, b: 3 }, paramNames: ['a', 'b'], covMatrix: [[1, 0.6], [0.6, 1]], mse: 1 } },
    predictParamsFnFactory: fitted => () => ({ logN0: 7, kmax: fitted.fit.params.a }),
    rng: createSeededRng('secondary-correlation'),
  });
  assert.equal(result.secondaryParamSamples?.length, 2);
  const [a, b] = result.secondaryParamSamples;
  const mean = xs => xs.reduce((sum, x) => sum + x, 0) / xs.length;
  const am = mean(a), bm = mean(b);
  const cross = a.reduce((sum, x, i) => sum + (x - am) * (b[i] - bm), 0);
  const sdProduct = Math.sqrt(a.reduce((sum, x) => sum + (x - am) ** 2, 0) * b.reduce((sum, x) => sum + (x - bm) ** 2, 0));
  assert.ok(Math.abs(cross / sdProduct - 0.6) < 0.05);
});

test('safe-time considers a target reached exactly at the simulation horizon reachable', async () => {
  const render = monteCarloHarness();
  const props = { ...panelProps, visibleFactorKeys: [] };
  render(props).setTargetReduction(10);
  await render(props).handleRun();
  assert.deepEqual(render(props).safeTimeResult, { safeTime: 10, allReached: true });
});

for (const withFactors of [false, true]) {
  test(`MC ${withFactors ? 'factor' : 'parameter'} sampling retains only complete finite curves and aligned input samples`, () => {
    const options = { params: { logN0: 7, kmax: 1 }, predictedParams: { logN0: 7, kmax: 1 }, paramNames: ['logN0', 'kmax'], covMatrix: [[1, 0], [0, 0]], mse: 1, primaryFit: { params: { logN0: 7, kmax: 1 }, paramNames: ['logN0', 'kmax'], covMatrix: [[1, 0], [0, 0]], mse: 1 }, modelFn: (t, p) => t === 1 && p.logN0 > 7 ? NaN : p.logN0 - t, tArray: [0, 1, 2], nSamples: 100, factorValues: { temp: 60 }, factorKeys: ['temp'], factorSDs: { temp: 0 }, rng: createSeededRng('audit') };
    const result = (withFactors ? runMonteCarloWithFactors : runMonteCarlo)(options);
    const n = result.finalLogNSamples.length;
    assert.ok(n > 0 && n < 100);
    for (const samples of [...result.allSamples, ...result.paramSamples, ...(result.factorSamples ?? [])]) assert.equal(samples.length, n);
    for (let i = 0; i < n; i++) assert.equal(result.allSamples[2][i], result.paramSamples[0][i] - 2);
  });
}

test('all-invalid Monte Carlo output has empty aligned samples and unavailable bands', () => {
  const result = runMonteCarlo({ params: { logN0: 7 }, paramNames: ['logN0'], modelFn: t => t === 1 ? NaN : 7, tArray: [0, 1], nSamples: 10, rng: createSeededRng('audit') });
  assert.deepEqual(result.allSamples, [[], []]);
  assert.deepEqual(result.paramSamples, [[]]);
  assert.equal(result.bands[0].p50, null);
});

test('sensitivity time-to-target uses saved nonuniform times', () => {
  const source = readFileSync('src/components/SensitivityPanel.jsx', 'utf8');
  const calculation = source.slice(source.indexOf('  const effectiveOutputSamples ='), source.indexOf('  const gsaResult ='));
  const compute = new Function('outputSamples', 'allSamples', 'tArray', 'targetLogN', 'tMax', 'useMemo', 'outputMetric', 'paramSamples', 'paramNames', 'sampleTargets', 'initialLogNSamples', "const expanded = true, mode = 'variance';\n" + calculation + '; return effectiveOutputSamples;');
  const outputs = new Array(10).fill(2);
  const allSamples = [new Array(10).fill(7), new Array(10).fill(4), outputs];
  const hitTimes = compute(outputs, allSamples, [0, 2, 10], 5, 20, f => f(), 'timeToTarget', [], [], new Array(10).fill(5));
  assert.deepEqual(hitTimes, new Array(10).fill(2));
});

test('sensitivity records unreachable time-to-target samples as censored', () => {
  const source = readFileSync('src/components/SensitivityPanel.jsx', 'utf8');
  const calculation = source.slice(source.indexOf('  const effectiveOutputSamples ='), source.indexOf('  const gsaResult ='));
  const compute = new Function('outputSamples', 'allSamples', 'tArray', 'targetLogN', 'tMax', 'useMemo', 'outputMetric', 'paramSamples', 'paramNames', 'sampleTargets', 'initialLogNSamples', "const expanded = true, mode = 'variance';\n" + calculation + '; return typeof censoredTimeSamples === "undefined" ? null : censoredTimeSamples;');
  const outputs = [7, ...new Array(9).fill(2)];
  const allSamples = [new Array(10).fill(7), [7, ...new Array(9).fill(4)], outputs];
  assert.equal(compute(outputs, allSamples, [0, 2, 10], 5, 20, f => f(), 'timeToTarget', [], [], new Array(10).fill(5)), 1);
});

test('dynamic simulation UI reports runtime core failures without uncaught exceptions', () => {
  const source = readFileSync('src/components/DynamicSimulator.jsx', 'utf8');
  const handler = source.slice(source.indexOf('  const handleSimulate = useCallback('), source.indexOf('  const lethalityMetric ='));
  let error = null;
  const deps = { useCallback: fn => fn, setError: value => { error = value; }, setFallbackWarnings: () => {}, setSimResult: () => {}, profile: [{ t: 0, temp: 60 }, { t: 1, temp: 60 }], validateDynamicProfile: () => null, fittedSecondaryModels: { fit: { params: {} } }, selectedFitKey: 'fit', buildKFn: () => ({ kFn: () => { throw new Error('Invalid rate prediction'); } }), runDynamicSimulation, logN0: 7, steps: 2, mode: null, lethalityState: {}, timeUnitToMin: 1 };
  const simulate = new Function(...Object.keys(deps), handler + '; return handleSimulate;')(...Object.values(deps));
  assert.doesNotThrow(simulate);
  assert.match(error, /Invalid rate prediction/);
});

test('Monte Carlo keeps the saved time grid after the requested time range changes', async () => {
  const render = monteCarloHarness();
  await render(panelProps).handleRun();
  const before = render(panelProps);
  const after = render({ ...panelProps, tMax: 20 });
  assert.equal(before.sliderTime, 10);
  assert.equal(after.sliderTime, 10);
  assert.equal(after.safeTimeResult.safeTime, before.safeTimeResult.safeTime);
  assert.equal(after.stale, true);
  assert.equal(after.hasMC, false, 'outdated probabilities must not be presented as current');
});

test('Monte Carlo invalidates on factor SD, covariance, manual params, bindings, model, and sample count', async () => {
  for (const patch of [
    { primaryFit: { covMatrix: [[0, 0], [0, 1]], mse: 1, params: panelProps.predictedParams, paramNames: ['logN0', 'kmax'] } },
    { manualParams: { ...panelProps.manualParams, kmax: 3 } },
    { bindings: { D: 'fit' } },
    { fittedSecondaryModels: { fit: { params: { Dref: 2 } } } },
    { modelId: 'WEIBULL' },
    { visibleFactorKeys: [] },
  ]) {
    const render = monteCarloHarness();
    await render(panelProps).handleRun();
    assert.equal(render({ ...panelProps, ...patch }).stale || render({ ...panelProps, ...patch }).stale, true);
  }
  for (const change of [p => p.setFactorSDs({ temp: 2 }), p => p.setNSamples(200)]) {
    const render = monteCarloHarness();
    await render(panelProps).handleRun();
    change(render(panelProps));
    assert.equal(render(panelProps).stale || render(panelProps).stale, true);
  }
});

test('dynamic integration rejects finite but unordered, duplicated, and nonfinite times', () => {
  for (const times of [[10, 0], [0, 5, 4, 10], [0, 0], [0, NaN], [0, Infinity]]) {
    assert.throws(() => runDynamicSimulation({ logN0: 7, profile: times.map(t => ({ t, temp: 60 })), kFn: () => Math.LN10 }), /finite|increasing/i);
  }
  const valid = runDynamicSimulation({ logN0: 7, profile: [{ t: 0 }, { t: 10 }], kFn: () => Math.LN10, steps: 10 });
  assert.equal(valid.at(-1).logN, -3);
});

test('zero covariance gives deterministic seeded Monte Carlo curves', () => {
  const result = runMonteCarlo({ params: { logN0: 7, kmax: 1 }, paramNames: ['logN0', 'kmax'], covMatrix: [[0, 0], [0, 0]], mse: 1, modelFn: (t, p) => p.logN0 - p.kmax * t, tArray: [0, 1, 2], nSamples: 40, rng: createSeededRng('audit') });
  for (const b of result.bands) assert.equal(b.p5, b.p95);
  assert.equal(result.bands.at(-1).p50, 5);
  assert.equal(result.covarianceMode, 'deterministic');
});

test('no covariance and zero explicit factor uncertainty gives deterministic factor runs', () => {
  const result = runMonteCarloWithFactors({ predictedParams: { logN0: 7, kmax: 1 }, paramNames: ['logN0', 'kmax'], modelFn: (t, p) => p.logN0 - p.kmax * t, tArray: [0, 1], nSamples: 40, factorValues: { temp: 60 }, factorKeys: ['temp'], factorSDs: { temp: 0 }, predictParamsFn: () => ({ logN0: 7, kmax: 1 }), rng: createSeededRng('audit') });
  assert.equal(result.bands.at(-1).p5, 6);
  assert.equal(result.bands.at(-1).p95, 6);
});

for (const [name, compute] of [['Morris', computeMorris], ['Sobol', computeSobolTotal]]) {
  test(`${name} preserves unbound parameter perturbations with factor prediction`, () => {
    const result = compute({ modelFn: (_t, p) => p.kmax, nominalParams: { kmax: 2 }, paramNames: ['kmax'], tEval: 1, factorValues: { temp: 60 }, factorKeys: ['temp'], predictParamsFn: () => ({ kmax: 2 }), predictParamsFnFactory: () => () => ({ kmax: 2 }), rng: createSeededRng('audit'), N: 512 });
    assert.ok(result, 'parameter variation must produce nonzero variance');
    const rate = result.results.find(r => r.param === 'kmax');
    assert.ok(rate?.contribution > 99);
  });
  test(`${name} samples bound rate through factors instead of a second direct rate dimension`, () => {
    const result = compute({ modelFn: (_t, p) => p.kmax, nominalParams: { kmax: 2 }, paramNames: ['kmax'], tEval: 1, factorValues: { temp: 60 }, factorKeys: ['temp'], bindings: { D: 'fitted' }, fittedSecondaryModels: { fitted: { primaryModelId: 'LOG_LINEAR', params: {} } }, predictParamsFn: f => ({ kmax: f.temp / 30 }), rng: createSeededRng('audit'), N: 512 });
    assert.ok(result);
    assert.equal(result.results.some(r => r.param === 'kmax'), false);
    assert.ok(result.results.find(r => r.param === 'temp')?.contribution > 99);
  });
}

test('OAT direction means numeric increase even for a negative nominal', () => {
  const result = computeOATSensitivity({ modelFn: (_t, p) => p.logN0, nominalParams: { logN0: -2 }, paramNames: ['logN0'], tEval: 0 });
  assert.ok(result.results[0].src > 0);
});

test('external D validation converts manual natural-log rate back into D', () => {
  const source = readFileSync('src/components/ExternalValidation.jsx', 'utf8');
  const functions = source.slice(source.indexOf('function getValidationTargetInfo('), source.indexOf('/* ── Extrapolation detection'));
  const compute = new Function('MODELS', 'fitModel', 'fitPrimaryInTimeUnit', 'MODEL_SECONDARY_CONFIG', 'resolveValidationTarget', 'predictRawParameterValue', 'predictPrimaryParams', `${functions}; return computeParameterMetrics;`)(MODELS, fitModel, fitPrimaryInTimeUnit, MODEL_SECONDARY_CONFIG, resolveValidationTarget, predictRawParameterValue, predictPrimaryParams);
  const metrics = compute([{ id: 'heldout', name: 'heldout', conditions: { temp: 60 }, parsedData: [0, 1, 2, 3, 4].map(t => ({ t, logN: 7 - t / 2 })) }], 'LOG_LINEAR', {}, {}, { logN0: 7, kmax: Math.LN10 / 2 });
  assert.ok(metrics);
  assert.ok(Math.abs(metrics.points[0].predictedRaw - 2) < 1e-10);
  assert.ok(Math.abs(metrics.Bf - 1) < 1e-5);
});
