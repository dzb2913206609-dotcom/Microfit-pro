// Read-only numerical diagnostics. Run from the project: node scripts/audit_numeric_repro_20261009.mjs
import { computeSSE, fitModel, fitRegressionModel, shapiroWilkPValue } from '../src/models/fitter.js';
import { MODELS } from '../src/models/inactivationModels.js';
import { buildSecondaryRows, fitSecondaryModel, predictPrimaryParams } from '../src/models/secondaryModels.js';
import { runDynamicSimulation } from '../src/models/dynamicSimulation.js';
import { computeSobolTotal } from '../src/models/sensitivityAnalysis.js';
import { splitDataLine } from '../src/utils/pastePreview.js';

const output = (name, result) => console.log(name, JSON.stringify(result, (_, value) => typeof value === 'number' && !Number.isFinite(value) ? String(value) : value));
const data = [0, 1, 2, 3, 4, 5].map((x, i) => ({ x, y: 10 - x + [.2, -.1, .1, -.2, .1, -.1][i] }));
const fit = fitRegressionModel({ modelFn: (x, p) => p.a - p.b * x, paramDefs: [{ name: 'a', defaultValue: 9 }, { name: 'b', defaultValue: 1 }], data });
output('Adjusted R2', { actual: fit.r2adj, expected: 1 - (1 - fit.r2) * (fit.n - 1) / (fit.n - fit.k) });
output('NaN SSE', { actual: computeSSE(() => NaN, {}, data), expected: 'Reject invalid candidate' });
const boundary = fitModel('LOG_LINEAR', [0, 1, 2, 3].map(t => ({ t, logN: 1 + t })));
output('Boundary fit', { actual: boundary.params, sse: boundary.sse, converged: boundary.converged, optimalLogN0AtRateBound: 2.5 + .001 * 1.5 / Math.LN10 });
output('Tail initial value', { actual: MODELS.LOG_LINEAR_TAIL.fn(0, { logN0: 3, logNres: 2, kmax: 1 }), expectedIfN0IsTotal: 3 });
for (const temp of [60, 70]) {
  const params = predictPrimaryParams({ primaryModelId: 'WEIBULL', bindings: {}, fittedSecondaryModels: {}, manualParams: { logN0: 7, delta: 5, p: 1 }, factors: { temp } });
  output('Weibull default scaling', { temp, delta: params.delta, logNAt5: MODELS.WEIBULL.fn(5, params) });
}
const datasets = [50, 60, 70].map((temp, i) => ({ id: `d${i}`, conditions: { temp } }));
const fitResults = Object.fromEntries(datasets.map((d, i) => [`${d.id}_LOG_LINEAR`, { params: { kmax: 2 ** i } }]));
const rows = buildSecondaryRows({ datasets, fitResults, primaryModelId: 'LOG_LINEAR', targetKey: 'kmax', secondaryModelId: 'ARRHENIUS' });
output('Arrhenius rate transform', rows.map(r => ({ k: r.rawValue, actualY: r.y, expectedY: Math.log(r.rawValue) })));
output('Arrhenius fitted parameters', fitSecondaryModel('ARRHENIUS', rows).params);
try {
  output('Reversed dynamic time', runDynamicSimulation({ logN0: 7, profile: [{ t: 10, temp: 60 }, { t: 0, temp: 60 }], kFn: () => Math.LN10, steps: 50 }).at(-1));
} catch (error) {
  output('Reversed dynamic time rejected', error.message);
}
output('Missing CSV column', { actual: splitDataLine('10,,5.1,5.2'), expected: ['10', '', '5.1', '5.2'] });
output('Shapiro-Wilk comparison', { actual: shapiroWilkPValue([-5, 0, 0, 0, 5]), scipyReference: .32542950716414576 });
const nominalParams = { logN0: 7, kmax: 1 };
output('Sobol independent kmax contribution', computeSobolTotal({ modelFn: MODELS.LOG_LINEAR.fn, nominalParams, paramNames: ['kmax'], tEval: 1, factorValues: { temp: 60 }, factorKeys: [], predictParamsFn: () => ({ ...nominalParams }), predictParamsFnFactory: () => () => ({ ...nominalParams }), N: 32 }));
