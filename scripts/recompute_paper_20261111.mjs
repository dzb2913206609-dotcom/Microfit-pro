import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getExampleCase } from '../src/config/exampleDatasets.js';
import { STERILIZATION_MODES } from '../src/config/sterilizationModes.js';
import { MODELS } from '../src/models/inactivationModels.js';
import { fitPrimaryInTimeUnit } from '../src/utils/unitFitting.js';
import {
  runAllSecondaryFits,
  predictPrimaryParams,
  predictRawParameterValue,
  MODEL_SECONDARY_CONFIG,
  FACTOR_DEFS,
  computeDEntryY,
  fitSecondaryModel,
} from '../src/models/secondaryModels.js';
import { buildKFn, runDynamicSimulation, summarizeDynamicObservationFit } from '../src/models/dynamicSimulation.js';
import { runMonteCarloWithFactors } from '../src/models/monteCarlo.js';
import { computeGSA, computeOATSensitivity, computeMorris, computeSobolTotal } from '../src/models/sensitivityAnalysis.js';
import { createSeededRng, deriveSeed } from '../src/utils/random.js';
import { applyHeldOutInitialState } from '../src/utils/validationDiagnostics.js';

// Run from repository root: node scripts/recompute_paper_20261111.mjs
// New T1-T5 ordering: T1 WMP, T2 NFDM, T3 E. faecium, T4 Salmonella, T5 dynamic.
const out = path.resolve('reports/paper_sync_20261111');
fs.mkdirSync(out, { recursive: true });
const save = (name, value) => fs.writeFileSync(path.join(out, name + '.json'), JSON.stringify(value, null, 2) + '\n');
const esc = v => /[",\r\n]/.test(String(v ?? '')) ? `"${String(v).replaceAll('"', '""')}"` : String(v ?? '');
const csv = (name, rows) => {
  const keys = Object.keys(rows[0] ?? {});
  fs.writeFileSync(path.join(out, name + '.csv'), [keys, ...rows.map(r => keys.map(k => typeof r[k] === 'object' ? JSON.stringify(r[k]) : r[k]))].map(r => r.map(esc).join(',')).join('\n') + '\n');
};
const percentile = (values, q) => { const x = [...values].sort((a, b) => a - b); const at = (x.length - 1) * q; const i = Math.floor(at); return x[i] + (x[Math.min(i + 1, x.length - 1)] - x[i]) * (at - i); };
const fitPrimary = (example, dataset, modelId, timeUnitToMin = 1) => ({
  ...fitPrimaryInTimeUnit(modelId, dataset.data, { timeUnitToMin }),
  modelId,
  datasetId: dataset.id,
});

const t1 = getExampleCase('t1-milk-powder-wmp');
const t2 = getExampleCase('t2-milk-powder-nfdm');
const t3 = getExampleCase('t3-black-pepper-ef');
const t4 = getExampleCase('t4-black-pepper-salmonella');
const t5 = getExampleCase('t5-dynamic-simulation');
for (const [name, example] of [['T1', t1], ['T2', t2], ['T3', t3], ['T4', t4], ['T5', t5]]) {
  if (!example) throw new Error(`${name} example not found`);
}

const primaryFits = { T1: {}, T2: {} };
for (const [key, example] of [['T1', t1], ['T2', t2]]) {
  for (const dataset of example.datasets) {
    primaryFits[key][`${dataset.id}_LOG_LINEAR`] = fitPrimary(example, dataset, 'LOG_LINEAR');
  }
  save(`${key.toLowerCase()}_primary_fits`, primaryFits[key]);
}

const rep1 = t1.datasets.find(dataset => dataset.id === 'lab_milk_wmp_75_010');
const rep2 = t2.datasets.find(dataset => dataset.id === 'lab_milk_nfdm_75_010');
const candidates1 = Object.keys(MODELS).map(id => fitPrimary(t1, rep1, id)).sort((a, b) => a.aicc - b.aicc);
const candidates2 = Object.keys(MODELS).map(id => fitPrimary(t2, rep2, id)).sort((a, b) => a.aicc - b.aicc);
save('t1_table3_all_primary_fits', candidates1);
save('t2_table3_all_primary_fits', candidates2);
csv('t1_table3_primary_ranking', candidates1.map((f, i) => ({ rank: i + 1, modelId: f.modelId, model: MODELS[f.modelId].name, r2: f.r2, r2adj: f.r2adj, rmse: f.rmse, aicc: f.aicc, aiccValid: f.aiccValid, n: f.n, k: f.k, K: f.aiccParameterCount, converged: f.converged, params: f.params })));
csv('t2_table3_primary_ranking', candidates2.map((f, i) => ({ rank: i + 1, modelId: f.modelId, model: MODELS[f.modelId].name, r2: f.r2, r2adj: f.r2adj, rmse: f.rmse, aicc: f.aicc, aiccValid: f.aiccValid, n: f.n, k: f.k, K: f.aiccParameterCount, converged: f.converged, params: f.params })));

const secondary1 = runAllSecondaryFits({ datasets: t1.datasets, fitResults: primaryFits.T1, scenario: 'thermal', primaryFactorKey: 'temp', referenceParams: { Tref: 80, awRef: 0.2 } });
const secondary2 = runAllSecondaryFits({ datasets: t2.datasets, fitResults: primaryFits.T2, scenario: 'thermal', primaryFactorKey: 'temp', referenceParams: { Tref: 80, awRef: 0.2 } });
const sec1 = secondary1.EXTENDED_BIGELOW_D;
const sec2 = secondary2.EXTENDED_BIGELOW_D;
save('t1_all_secondary_fits', secondary1);
save('t2_all_secondary_fits', secondary2);

const target = MODEL_SECONDARY_CONFIG.LOG_LINEAR.targets.D;
const secondaryRows = (sec, secondaryModelId = sec.secondaryModelId) => sec.rows.map(r => ({
  ...r,
  observedD: r.rawValue,
  predictedD: predictRawParameterValue({ secondaryModelId, params: sec.params, factors: r.factors, targetConfig: target }),
}));
save('t1_secondary_points', secondaryRows(sec1));
save('t2_secondary_points', secondaryRows(sec2));

function surfaceFor(sec, tMin, tMax, awMin, awMax) {
  const rows = [];
  for (let ai = 0; ai <= 64; ai += 1) {
    for (let ti = 0; ti <= 64; ti += 1) {
      const temp = tMin + (tMax - tMin) * ti / 64;
      const aw = awMin + (awMax - awMin) * ai / 64;
      const D = predictRawParameterValue({ secondaryModelId: sec.secondaryModelId, params: sec.params, factors: { temp, aw, pH: 7 }, targetConfig: target });
      rows.push({ temp, aw, D, logD: Math.log10(D) });
    }
  }
  return rows;
}
csv('t1_secondary_surface', surfaceFor(sec1, 75, 85, 0.1, 0.3));
csv('t2_secondary_surface', surfaceFor(sec2, 75, 85, 0.1, 0.3));

const rows3 = t3.secondaryDefaults.manualDEntries.map(entry => computeDEntryY({
  dValue: entry.D, factors: entry.factors, primaryModelId: 'LOG_LINEAR', targetKey: 'D', secondaryModelId: 'EXTENDED_BIGELOW',
}));
const rows4 = t4.secondaryDefaults.manualDEntries.map(entry => computeDEntryY({
  dValue: entry.D, factors: entry.factors, primaryModelId: 'LOG_LINEAR', targetKey: 'D', secondaryModelId: 'EXTENDED_BIGELOW',
}));
const sec3 = fitSecondaryModel('EXTENDED_BIGELOW', rows3, t3.secondaryDefaults.referenceParams);
const sec4 = fitSecondaryModel('EXTENDED_BIGELOW', rows4, t4.secondaryDefaults.referenceParams);
sec3.secondaryModelId = 'EXTENDED_BIGELOW';
sec4.secondaryModelId = 'EXTENDED_BIGELOW';
save('t3_secondary_fit', sec3);
save('t4_secondary_fit', sec4);
save('t3_secondary_points', secondaryRows(sec3, 'EXTENDED_BIGELOW'));
save('t4_secondary_points', secondaryRows(sec4, 'EXTENDED_BIGELOW'));
csv('t3_secondary_surface', surfaceFor(sec3, 65, 85, 0.25, 0.65));
csv('t4_secondary_surface', surfaceFor(sec4, 65, 85, 0.25, 0.65));

// ── Hold-out diagnostics for T1 and T2 ──────────────────────────────────────
const holdoutSpecs = [
  ['T1', t1, primaryFits.T1, 'lab_milk_wmp_80_020'],
  ['T2', t2, primaryFits.T2, 'lab_milk_nfdm_80_020'],
];
const holdouts = {};
for (const [key, example, fits, heldId] of holdoutSpecs) {
  const held = example.datasets.find(dataset => dataset.id === heldId);
  const heldSecondary = runAllSecondaryFits({
    datasets: example.datasets.filter(dataset => dataset.id !== held.id),
    fitResults: fits,
    scenario: 'thermal',
    primaryFactorKey: 'temp',
    referenceParams: example.secondaryDefaults.referenceParams,
  }).EXTENDED_BIGELOW_D;
  const bindings = { kmax: 'EXTENDED_BIGELOW_D' };
  const manualParams = { logN0: 7.5 };
  const factorValues = { ...held.conditions, pH: 7 };
  const predict = (fitted, factors) => predictPrimaryParams({
    primaryModelId: 'LOG_LINEAR', primaryFactorKey: 'temp', bindings,
    fittedSecondaryModels: fitted, manualParams, factors,
  });
  const heldFit = fits[`${held.id}_LOG_LINEAR`];
  const heldParams = applyHeldOutInitialState({
    predictedParams: predict({ EXTENDED_BIGELOW_D: heldSecondary }, held.conditions),
    fittedParams: heldFit.params,
    primaryModel: MODELS.LOG_LINEAR,
  });
  const points = held.data.map(point => ({ ...point, observed: point.logN, predicted: MODELS.LOG_LINEAR.fn(point.t, heldParams) }));
  const metrics = (values) => {
    const n = values.length;
    const d = values.map(value => value.predicted - value.observed);
    return {
      n,
      Bf: 10 ** (d.reduce((sum, value) => sum + value, 0) / n),
      Af: 10 ** (d.reduce((sum, value) => sum + Math.abs(value), 0) / n),
      RMSE: Math.sqrt(d.reduce((sum, value) => sum + value * value, 0) / n),
    };
  };
  const observedD = Math.LN10 / heldFit.params.kmax;
  const predictedD = Math.LN10 / heldParams.kmax;
  holdouts[key] = {
    datasetId: held.id,
    conditions: held.conditions,
    primaryFit: heldFit,
    secondaryFit: heldSecondary,
    conditionalParams: heldParams,
    observedD,
    predictedD,
    parameterMetrics: metrics([{ observed: Math.log10(observedD), predicted: Math.log10(predictedD) }]),
    curveMetrics: metrics(points),
    points,
  };
}
save('holdout_t1_t2', holdouts);

// ── Dynamic simulation T5 (Huang 2013) ──────────────────────────────────────
const dd = t5.dynamicDefaults;
const dynamic = runDynamicSimulation({
  ...dd,
  kFn: buildKFn(t5.fittedSecondaryModels.BIGELOW_D, ['temp', 'aw', 'pH']).kFn,
  modeConfig: STERILIZATION_MODES.thermal,
  lethalityParams: { ...dd.lethalityParams, _timeUnitToMin: 1 },
});
const dynamicFit = summarizeDynamicObservationFit(dynamic, dd.observations);
save('figure_dynamic_t5', { config: dd, secondaryFit: t5.fittedSecondaryModels.BIGELOW_D, simulation: dynamic, observationFit: dynamicFit, endpoint: dynamic.at(-1) });

// ── Monte Carlo and sensitivity for T1 (WMP) ────────────────────────────────
const factorValues = { temp: 80, aw: 0.2, pH: 7 };
const manualParams = { logN0: 7.5 };
const bindings = { kmax: 'EXTENDED_BIGELOW_D' };
const fittedSecondaryModels = { EXTENDED_BIGELOW_D: sec1 };
const predict = (fitted, factors) => predictPrimaryParams({
  primaryModelId: 'LOG_LINEAR', primaryFactorKey: 'temp', bindings,
  fittedSecondaryModels: fitted, manualParams, factors,
});
const predictedParams = predict(fittedSecondaryModels, factorValues);
const paramNames = MODELS.LOG_LINEAR.params.map(param => param.name);
const modelFn = MODELS.LOG_LINEAR.fn;
const predictParamsFn = factors => predict(fittedSecondaryModels, factors);
const predictParamsFnFactory = fitted => factors => predict(fitted, factors);
const seed = '20260430';
const nSamples = 10000;
const tEval = 60;
const tMax = 120;
const tArray = Array.from({ length: 200 }, (_, i) => tMax * i / 199);
const mcConfig = {
  modelId: 'LOG_LINEAR',
  primaryFit: primaryFits.T1[`${rep1.id}_LOG_LINEAR`],
  predictedParams,
  manualParams,
  bindings,
  factorValues,
  factorSDs: { temp: 1, aw: 0.01, pH: 0 },
  factorKeys: ['temp', 'aw', 'pH'],
  fittedSecondaryModels,
  nSamples,
  seed,
  targetReduction: 5,
  confidence: 0.99,
  tEval,
  timeUnitToMin: 1,
  tMax,
  timePoints: 200,
};
const mc = runMonteCarloWithFactors({
  ...mcConfig,
  paramNames,
  modelFn,
  predictParamsFn,
  predictParamsFnFactory,
  tArray,
  rng: createSeededRng(seed),
});
const finalEval = mc.paramSamples[0].map((_, i) => modelFn(tEval, Object.fromEntries(paramNames.map((name, j) => [name, mc.paramSamples[j][i]]))));
const reductionEval = finalEval.map((value, i) => mc.initialLogNSamples[i] - value);
const hits = finalEval.map((_, sample) => {
  const index = mc.allSamples.findIndex(values => values[sample] <= mc.initialLogNSamples[sample] - 5 + 1e-10);
  return index < 0 ? Infinity : mc.tArray[index];
});
const sortedHits = [...hits].sort((a, b) => a - b);
const safeTimeUI = sortedHits[Math.ceil(0.99 * hits.length) - 1];
const exactHits = mc.paramSamples[1].map(k => 5 * Math.LN10 / k);
const sortedExact = [...exactHits].sort((a, b) => a - b);
const safeTimeExact = sortedExact[Math.ceil(0.99 * hits.length) - 1];
const checkpointSafeTimes = mc.convergence.checkpoints.map(checkpoint => {
  const times = hits.slice(0, checkpoint.n).sort((a, b) => a - b);
  return { n: checkpoint.n, safeTime: times[Math.ceil(0.99 * checkpoint.n) - 1] };
});
const mcSummary = {
  valid: finalEval.length,
  rejected: mc.rejectedSamples,
  covarianceMode: mc.covarianceMode,
  correlationIgnored: mc.correlationIgnored,
  nominalD: Math.LN10 / predictedParams.kmax,
  nominalLogNEval: modelFn(tEval, predictedParams),
  successCount: reductionEval.filter(value => value >= 5 - 1e-10).length,
  successPercent: 100 * reductionEval.filter(value => value >= 5 - 1e-10).length / finalEval.length,
  safeTimeUI,
  safeTimeExact,
  checkpointSafeTimes,
  endpointEval: {
    p5: percentile(finalEval, 0.05),
    p25: percentile(finalEval, 0.25),
    p50: percentile(finalEval, 0.5),
    p75: percentile(finalEval, 0.75),
    p95: percentile(finalEval, 0.95),
    p99: percentile(finalEval, 0.99),
  },
};
const globalRanges = { temp: { min: 75, max: 85 }, aw: { min: 0.1, max: 0.3 }, pH: { min: 7, max: 7 } };
const sensitivityArgs = {
  modelFn,
  nominalParams: predictedParams,
  paramNames,
  modelId: 'LOG_LINEAR',
  timeUnitToMin: 1,
  tEval,
  predictParamsFn,
  factorValues,
  factorKeys: mcConfig.factorKeys,
  fittedSecondaryModels,
  bindings,
  predictParamsFnFactory,
  factorRanges: globalRanges,
};
const sensitivity = {
  output: `log10(N) at exactly ${tEval} min`,
  oat: computeOATSensitivity({ ...sensitivityArgs, delta: 0.05 }),
  src: computeGSA(mc.independentParamSamples ?? mc.paramSamples, finalEval, paramNames, mc.factorSamples, mc.factorKeys, 'LOG_LINEAR', mc.secondaryParamSamples, mc.secondaryParamNames, mc.secondaryParamLabels),
  morris: computeMorris({ ...sensitivityArgs, r: 10, pLevels: 4, rng: createSeededRng(deriveSeed(seed, 'morris')) }),
  sobol: computeSobolTotal({ ...sensitivityArgs, N: 512, rng: createSeededRng(deriveSeed(seed, 'sobol-512')) }),
  sobolStability: computeSobolTotal({ ...sensitivityArgs, N: 8192, rng: createSeededRng(deriveSeed(seed, 'sobol-8192')) }),
  config: {
    oatDelta: 0.05,
    morrisR: 10,
    morrisLevels: 4,
    morrisSeed: deriveSeed(seed, 'morris'),
    sobolN: 512,
    sobolSeed: deriveSeed(seed, 'sobol-512'),
    globalRanges,
  },
};
save('figure_mc_summary_t1', { config: mcConfig, summary: mcSummary, sensitivity });
save('sensitivity_results_t1', sensitivity);
csv('mc_percentile_bands_t1', mc.bands);
csv('mc_endpoint_t1', finalEval.map((value, i) => ({ sample: i + 1, initialLogN: mc.initialLogNSamples[i], logN60: value, reduction60: reductionEval[i], hitTimeUI: Number.isFinite(hits[i]) ? hits[i] : null })));
csv('sensitivity_oat_t1', sensitivity.oat?.results ?? []);
csv('sensitivity_src_t1', sensitivity.src?.results ?? []);
csv('sensitivity_morris_t1', sensitivity.morris?.results ?? []);
csv('sensitivity_sobol_t1', sensitivity.sobol?.results ?? []);
csv('sensitivity_sobol_s1_t1', sensitivity.sobolStability?.results ?? []);

console.log(JSON.stringify({
  t1: { primaryN: Object.keys(primaryFits.T1).length, secondary: { params: sec1.params, rmse: sec1.rmse, r2adj: sec1.r2adj, linked: sec1.linkedCurveMetrics?.rmse, n: sec1.n }, topModel: candidates1[0]?.modelId, topAICc: candidates1[0]?.aicc },
  t2: { primaryN: Object.keys(primaryFits.T2).length, secondary: { params: sec2.params, rmse: sec2.rmse, r2adj: sec2.r2adj, linked: sec2.linkedCurveMetrics?.rmse, n: sec2.n }, topModel: candidates2[0]?.modelId, topAICc: candidates2[0]?.aicc },
  t3: { params: sec3.params, rmse: sec3.rmse, r2adj: sec3.r2adj, n: sec3.n },
  t4: { params: sec4.params, rmse: sec4.rmse, r2adj: sec4.r2adj, n: sec4.n },
  holdouts: {
    T1: { parameter: holdouts.T1.parameterMetrics, curve: holdouts.T1.curveMetrics },
    T2: { parameter: holdouts.T2.parameterMetrics, curve: holdouts.T2.curveMetrics },
  },
  dynamic: { rmse: dynamicFit.rmse, n: dynamicFit.n, endpoint: dynamic.at(-1) },
  mc: mcSummary,
  sensitivity: {
    oat: sensitivity.oat?.summary,
    src: sensitivity.src?.summary,
    morris: sensitivity.morris?.summary,
    sobol: sensitivity.sobol?.summary,
  },
}, null, 2));
