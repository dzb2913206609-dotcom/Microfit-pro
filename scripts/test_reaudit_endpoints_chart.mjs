import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { MODELS, predictCurve, solveForTime } from '../src/models/inactivationModels.js';
import { registerCustomFactor, clearCustomFactors } from '../src/config/factors.js';
import { computePaddedAxisRange } from '../src/utils/chartRanges.js';

test('positive kinetic parameters preserve physical curves after conversion to microseconds', () => {
  const scales = { rate: 1 / 60000000, time: 60000000, timeScale: 60000000 };
  for (const model of Object.values(MODELS)) {
    const p = Object.fromEntries(model.params.map(d => [d.name, d.defaultValue]));
    const converted = Object.fromEntries(model.params.map(d => [d.name, p[d.name] * (scales[d.role] ?? 1)]));
    for (const t of [0, 1, 5, 20]) {
      const original = model.fn(t, p);
      const actual = model.fn(t * 60000000, converted);
      assert.ok(Math.abs(original - actual) < 1e-10, `${model.id}, t=${t}: ${original} vs ${actual}`);
    }
  }
});

test('kinetic inversion rejects exact asymptotes and returns earliest initial endpoint', () => {
  for (const id of ['LOG_LINEAR_TAIL', 'WEIBULL_TAIL', 'SHOULDER_TAIL', 'BARANYI', 'GOMPERTZ']) {
    const p = Object.fromEntries(MODELS[id].params.map(d => [d.name, d.defaultValue]));
    const floor = id === 'BARANYI' ? p.logNmin : id === 'GOMPERTZ' ? p.logN0 - p.A : p.logNres;
    assert.equal(solveForTime(id, floor, p, 10000), null, id);
    const t = solveForTime(id, MODELS[id].fn(2, p), p, 100);
    assert.ok(Math.abs(t - 2) < 1e-6, `${id}: ${t}`);
  }
  assert.equal(solveForTime('SHOULDER_NOTAIL', 7, { logN0: 7, kmax: 10, Sl: 100 }, 20), 0);
  assert.equal(solveForTime('LOG_LINEAR', NaN, { logN0: 7, kmax: 1 }, 20), null);
  assert.equal(solveForTime('LOG_LINEAR', 6, { logN0: 7, kmax: 1 }, -20), null);
});

test('custom factors use normalized bounds when optional defaults are absent', () => {
  try {
    const f = registerCustomFactor({ key: 'test_default' });
    assert.equal(f.default, 50);
    assert.equal(f.scalingRef, 50);
  } finally { clearCustomFactors(); }
});

// Evaluate actual chart calculation hooks while omitting JSX rendering.
const require = createRequire(import.meta.url);
const { parse } = require('@babel/parser');
const source = readFileSync(new URL('../src/components/ResultChart.jsx', import.meta.url), 'utf8');
const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
const component = ast.program.body.find(n => n.type === 'ExportDefaultDeclaration').declaration;
const returnBoundary = component.body.body.find(n => n.type === 'IfStatement' && source.slice(n.test.start, n.test.end).includes('chartDatasets.length'));
const code = source.slice(component.start, returnBoundary.start) + '\n return { traces }; }';
const chartScope = {
  MODELS, predictCurve, computePaddedAxisRange,
  PLOTLY_SYMBOLS: ['circle'], PLOTLY_DASHES: ['solid'],
  AXIS_TITLE_FONT: {}, TICK_FONT: {}, DEFAULT_Y_LABEL: 'Survival',
  INITIAL_AXIS: {}, stripModelName: s => s, buildResultBaseName: () => 'chart',
  useScenario: () => ({ scenario: 'thermal', primaryFactorKey: 'temp', useDoseAxis: false, mode: {}, timeUnit: 'min' }),
  getFactorDef: () => null, useState: init => [init, () => {}], useMemo: fn => fn(),
};
test('chart hover styling travels with traces without concurrent imperative restyle', () => {
  let restyles = 0;
  const scope = {
    ...chartScope,
    useEffect: fn => fn(),
    document: { getElementById: () => ({ data: [{}, {}, {}], isConnected: true, emit() {} }) },
    Plotly: { restyle() { restyles++; return Promise.resolve(); } },
  };
  const render = new Function(...Object.keys(scope), code + '; return ResultChart;')(...Object.values(scope));
  const ds = { id: 'a', name: 'A', color: '#333333', data: [{ t: 0, logN: 7 }, { t: 1, logN: 6 }] };
  const props = { datasets: [ds], selectedModels: ['LOG_LINEAR', 'WEIBULL'], hoveredModel: 'LOG_LINEAR', fitResults: {
    a_LOG_LINEAR: { params: { logN0: 7, kmax: Math.LN10 } },
    a_WEIBULL: { params: { logN0: 7, delta: 2, p: 1 } },
  } };
  const { traces } = render(props);
  assert.equal(traces[1].line.width, 4);
  assert.equal(traces[2].opacity, .15);
  assert.equal(restyles, 0);
});
