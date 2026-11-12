import fs from 'node:fs';
import path from 'node:path';
import { getExampleCase } from '../src/config/exampleDatasets.js';
import { STERILIZATION_MODES } from '../src/config/sterilizationModes.js';
import { fitPrimaryInTimeUnit } from '../src/utils/unitFitting.js';
import { fitSecondaryModel, computeDEntryY } from '../src/models/secondaryModels.js';
import { buildKFn, runDynamicSimulation, summarizeDynamicObservationFit } from '../src/models/dynamicSimulation.js';

const out = path.resolve('reports/huang2013_digitization_20261111');
const summary = JSON.parse(fs.readFileSync(path.join(out, 'huang2013_fig1_summary.json'), 'utf8'));
const t5 = getExampleCase('t5-dynamic-simulation');

const temps = [57, 60, 63, 66];
const primary = [];
for (const temp of temps) {
  const pts = summary.series[String(temp)].points;
  // Work in minutes, the thermal time unit used by the dynamic simulator.
  const data = pts.map(p => ({ t: p.time_s / 60, logN: p.log10_N }));
  const fit = fitPrimaryInTimeUnit('LOG_LINEAR', data, { timeUnitToMin: 1 });
  const kmax = fit.params.kmax;
  const Dmin = Math.LN10 / kmax;
  const seK = fit.paramErrors?.kmax ?? null;
  const ciK = fit.paramCI95?.kmax ?? null;
  const seDmin = seK != null ? seK / (kmax * kmax) : null;
  const ciDmin = ciK ? [Math.LN10 / ciK[1], Math.LN10 / ciK[0]] : null;
  primary.push({
    temperature_C: temp,
    n: fit.n,
    logN0: fit.params.logN0,
    logN0_SE: fit.paramErrors?.logN0 ?? null,
    kmax_per_min: kmax,
    kmax_SE: seK,
    kmax_CI95: ciK,
    D_min: Dmin,
    D_s: Dmin * 60,
    D_SE_min: seDmin,
    D_SE_s: seDmin != null ? seDmin * 60 : null,
    D_CI95_min: ciDmin,
    D_CI95_s: ciDmin ? ciDmin.map(v => v * 60) : null,
    rmse: fit.rmse,
    r2: fit.r2,
    r2adj: fit.r2adj,
  });
}
console.log('PRIMARY (D in minutes and seconds)');
for (const p of primary) console.log(p);

const rows = primary.map(p => computeDEntryY({
  dValue: p.D_min,
  factors: { temp: p.temperature_C, aw: 1 },
  primaryModelId: 'LOG_LINEAR',
  targetKey: 'D',
  secondaryModelId: 'BIGELOW',
}));
const sec = fitSecondaryModel('BIGELOW', rows, { Tref: 60 });
sec.secondaryModelId = 'BIGELOW';
sec.primaryModelId = 'LOG_LINEAR';
sec.targetKey = 'D';
console.log('SECONDARY (Dref in minutes)');
console.log({
  n: sec.n,
  params: sec.params,
  paramErrors: sec.paramErrors,
  paramCI95: sec.paramCI95,
  rmse: sec.rmse,
  r2: sec.r2,
  r2adj: sec.r2adj,
  covMatrix: sec.covMatrix,
});

// Use the built-in T5 fit (rounded Dref = 77.0 s, z = 5.0137 °C) for the
// dynamic comparison so that this analysis matches the manuscript figure and
// the official recompute script.
const appFit = t5.fittedSecondaryModels.BIGELOW_D;
const kFnObj = buildKFn(appFit, ['temp']);
const dynamic = runDynamicSimulation({
  ...t5.dynamicDefaults,
  kFn: kFnObj.kFn,
  modeConfig: STERILIZATION_MODES.thermal,
  lethalityParams: { ...t5.dynamicDefaults.lethalityParams, Tref: 60, zValue: appFit.params.z, _timeUnitToMin: 1 },
});
const dynFit = summarizeDynamicObservationFit(dynamic, t5.dynamicDefaults.observations);
console.log('DYNAMIC', { rmse: dynFit.rmse, n: dynFit.n, endpoint: dynamic.at(-1) });

fs.writeFileSync(path.join(out, 'huang2013_full_workflow.json'), JSON.stringify({
  primary,
  secondary: sec,
  dynamic: { rmse: dynFit.rmse, n: dynFit.n, endpoint: dynamic.at(-1) },
}, null, 2) + '\n');
