import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { parse } from '@babel/parser';

function harness({ expanded = true, mode = 'morris', fail = false, deferred = false } = {}) {
  const source = readFileSync(new URL('../src/components/SensitivityPanel.jsx', import.meta.url), 'utf8');
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
  const component = ast.program.body.find(node => node.type === 'ExportDefaultDeclaration').declaration;
  const effect = component.body.body.find(node => node.type === 'ExpressionStatement'
    && node.expression.callee?.name === 'useEffect');
  const callback = effect.expression.arguments[0];
  const state = { busy: false, error: '', morris: null, sobol: null };
  const queue = [], calls = [];
  let resolveTask;
  let cancelled = false;
  const compute = method => {
    calls.push(method);
    if (fail) throw new RangeError('Invalid global sensitivity range for temp.');
    return { results: [] };
  };
  const scope = {
    expanded, mode, analysisConfig: {}, modelFn: () => 1, nominalParams: {}, paramNames: ['D'], tEval: 6,
    timeUnitToMin: 1, morrisArgs: {}, sobolN: 512, randomSeed: 1,
    setTimeout: fn => { queue.push(fn); return queue.length; }, clearTimeout: () => {},
    setMorrisResult: value => { state.morris = value; }, setSobolResult: value => { state.sobol = value; },
    setGsaComputing: value => { state.busy = value; }, setGsaError: value => { state.error = value; },
    computeMorris: () => compute('morris'), computeSobolTotal: () => compute('sobol'),
    createSeededRng: () => () => .5, deriveSeed: () => 1,
    startAnalysisTask: method => ({
      promise: deferred ? new Promise(resolve => { resolveTask = resolve; }) : Promise.resolve().then(() => compute(method)),
      cancel: () => { cancelled = true; },
    }),
  };
  const run = new Function(...Object.keys(scope), `return (${source.slice(callback.start, callback.end)});`)(...Object.values(scope));
  return { state, calls, resolve: value => resolveTask(value), isCancelled: () => cancelled,
    async run() { const cleanup = run(); while (queue.length) queue.shift()();
    for (let i = 0; i < 8; i++) await Promise.resolve(); return cleanup; } };
}

test('collapsed and unselected global sensitivity methods do not calculate', async () => {
  for (const options of [{ expanded: false }, { mode: 'oat' }, { mode: 'variance' }]) {
    const h = harness(options);
    await h.run();
    assert.deepEqual(h.calls, []);
    assert.equal(h.state.busy, false);
  }
  for (const mode of ['morris', 'sobol']) {
    const h = harness({ mode });
    await h.run();
    assert.deepEqual(h.calls, [mode]);
    assert.ok(h.state[mode]);
  }
});

test('closing or changing sensitivity inputs cancels and ignores an obsolete worker result', async () => {
  const h = harness({ deferred: true });
  const cleanup = await h.run();
  assert.equal(h.state.busy, true);
  cleanup();
  assert.equal(h.isCancelled(), true);
  h.resolve({ results: [{ param: 'old' }] });
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(h.state.morris, null);
  assert.equal(h.state.sobol, null);
});

test('global sensitivity range failure clears busy state and a new run clears the error', async () => {
  const h = harness({ fail: true });
  await h.run();
  assert.equal(h.state.busy, false);
  assert.match(h.state.error, /range for temp/);
  assert.equal(h.state.morris, null);
  assert.equal(h.state.sobol, null);
  const retry = harness();
  await retry.run();
  assert.equal(retry.state.error, '');
  assert.equal(retry.state.busy, false);
  assert.ok(retry.state.morris);
});

test('sensitivity methods can be selected before their deferred result exists', () => {
  const source = readFileSync(new URL('../src/components/SensitivityPanel.jsx', import.meta.url), 'utf8');
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
  const buttons = [];
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'JSXElement' && node.openingElement.name.name === 'button') buttons.push(node);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  }
  visit(ast);
  const scope = { gsaResult: null, morrisResult: null, sobolResult: null,
    modelFn: () => 1, nominalParams: {}, paramNames: ['D'], tEval: 6, analysisConfig: {},
    paramSamples: [[1, 2]], outputSamples: new Array(100).fill(1) };
  for (const mode of ['variance', 'morris', 'sobol']) {
    const button = buttons.find(node => source.slice(node.start, node.end).includes(`setMode('${mode}')`));
    const disabled = button.openingElement.attributes.find(attr => attr.name?.name === 'disabled')?.value.expression;
    const value = disabled ? new Function(...Object.keys(scope), `return ${source.slice(disabled.start, disabled.end)}`)(...Object.values(scope)) : false;
    assert.equal(!!value, false, `${mode} must be selectable before its first calculation`);
  }
});
