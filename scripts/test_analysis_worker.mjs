import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { MODELS } from '../src/models/inactivationModels.js';
import { runMonteCarloFromPredicted, runMonteCarloWithFactors } from '../src/models/monteCarlo.js';
import { predictPrimaryParams } from '../src/models/secondaryModels.js';
import { computeMorris, computeSobolTotal } from '../src/models/sensitivityAnalysis.js';
import { createSeededRng, deriveSeed } from '../src/utils/random.js';

// Exercise the production worker through Node's real thread/message transport.
class BrowserWorker {
  constructor() {
    const url = new URL('../src/workers/analysisWorker.js', import.meta.url).href;
    this.worker = new Worker(`
      const { parentPort } = require('node:worker_threads');
      global.self = { addEventListener: (_, handler) => parentPort.on('message', data => handler({ data })) };
      global.postMessage = (data, transfers) => parentPort.postMessage(data, transfers);
      import(${JSON.stringify(url)});
    `, { eval: true });
    this.worker.on('message', data => this.onmessage?.({ data }));
    this.worker.on('error', error => this.onerror?.(error));
  }
  postMessage(data) { this.worker.postMessage(data); }
  terminate() { this.worker.terminate(); }
}

const baseConfig = {
  modelId: 'LOG_LINEAR', primaryFactorKey: 'temp', predictedParams: { logN0: 8, kmax: 2 },
  tArray: Array.from({ length: 200 }, (_, i) => i / 10), nSamples: 300, seed: 'worker-regression',
};
async function start(type, config) {
  const client = new URL('../src/utils/analysisWorkerClient.js', import.meta.url);
  assert.ok(existsSync(client), 'Monte Carlo needs a background worker client');
  const { startAnalysisTask } = await import(client);
  return startAnalysisTask(type, config, () => new BrowserWorker());
}
function functions(config) {
  const predict = fittedSecondaryModels => factors => predictPrimaryParams({
    primaryModelId: config.modelId, primaryFactorKey: config.primaryFactorKey,
    bindings: config.bindings, fittedSecondaryModels, manualParams: config.manualParams, factors,
  });
  return { modelFn: MODELS[config.modelId].fn, paramNames: MODELS[config.modelId].params.map(p => p.name),
    predictParamsFn: predict(config.fittedSecondaryModels), predictParamsFnFactory: predict };
}

test('background Monte Carlo preserves every seeded curve, band and diagnostic', async () => {
  const factorConfig = { ...baseConfig, factorValues: { temp: 70, aw: .7, pH: 7 },
    factorSDs: { temp: 1, aw: .01 }, factorKeys: ['temp', 'aw'], bindings: { kmax: 'BIGELOW_D' },
    manualParams: { logN0: 8 }, fittedSecondaryModels: { BIGELOW_D: {
      secondaryModelId: 'BIGELOW', targetParam: 'D', params: { logDref: 0, zT: 10 },
      referenceParams: { Tref: 70 }, paramNames: ['logDref', 'zT'], paramErrors: { logDref: .01, zT: .1 },
    } } };
  for (const config of [baseConfig, factorConfig]) {
    const args = { ...config, ...functions(config), rng: createSeededRng(config.seed) };
    const expected = config.factorValues ? runMonteCarloWithFactors(args) : runMonteCarloFromPredicted(args);
    const job = await start('monteCarlo', config);
    const actual = await job.promise;
    assert.ok(actual.finalLogNSamples.length > 0, 'the regression scenario must accept curves');
    assert.ok(actual.allSamples.every(row => row instanceof Float64Array), 'curve buffers are transferred');
    assert.deepEqual({ ...actual, allSamples: actual.allSamples.map(row => Array.from(row)) }, expected);
  }
});

test('Morris and Sobol worker jobs preserve method-specific random seeds', async () => {
  const config = { ...baseConfig, nominalParams: baseConfig.predictedParams, tEval: 6, timeUnitToMin: 1, N: 128 };
  for (const type of ['morris', 'sobol']) {
    const args = { ...config, ...functions(config), predictParamsFn: null, predictParamsFnFactory: null,
      rng: createSeededRng(deriveSeed(config.seed, type === 'morris' ? 'morris' : `sobol-${config.N}`)) };
    const expected = type === 'morris' ? computeMorris(args) : computeSobolTotal(args);
    const job = await start(type, config);
    assert.deepEqual(await job.promise, expected);
  }
});

test('large Monte Carlo leaves the calling event loop responsive; cancellation settles', async () => {
  const job = await start('monteCarlo', { ...baseConfig, nSamples: 50000 });
  let ticks = 0;
  const timer = setInterval(() => ticks++, 10);
  try { await job.promise; } finally { clearInterval(timer); }
  assert.ok(ticks >= 3, `event loop heartbeat only ran ${ticks} times`);
  const cancelled = await start('monteCarlo', { ...baseConfig, nSamples: 50000 });
  cancelled.cancel();
  await assert.rejects(cancelled.promise, { name: 'AbortError' });
  const invalid = await start('monteCarlo', { ...baseConfig, modelId: 'UNKNOWN' });
  await assert.rejects(invalid.promise, /Unknown primary model/);
});
