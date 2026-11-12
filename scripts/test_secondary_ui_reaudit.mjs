import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { parse } from '@babel/parser';
import * as secondary from '../src/models/secondaryModels.js';
import { getAllFactorDefs, getFactorDef } from '../src/config/factors.js';
import { readDelimitedRecords } from '../src/utils/pastePreview.js';
const source = fs.readFileSync(new URL('../src/components/SecondaryModel.jsx', import.meta.url), 'utf8');
const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
const component = ast.program.body.find(n => n.type === 'ExportDefaultDeclaration').declaration;
function fn(name, scope = ast.program.body, context = {}) {
  const n = scope.find(n => n.type === 'FunctionDeclaration' && n.id.name === name);
  return new Function(...Object.keys(context), `return (${source.slice(n.start, n.end)});`)(...Object.values(context));
}
const context = { ...secondary, getAllFactorDefs, getFactorDef, CONTOUR_STEPS: 3 };

test('target-aware inverse transform displays Arrhenius D rather than rate', () => {
  const inverse = fn('getInverseTransform', undefined, context)(['lnValue'], secondary.MODEL_SECONDARY_CONFIG.LOG_LINEAR.targets.D, 'ARRHENIUS');
  assert.ok(Math.abs(inverse.fn(Math.log(0.1)) - 10) < 1e-10);
});

test('Eyring grids retain natural-log regression response before target display', () => {
  const fitted = { secondaryModelId: 'ARRHENIUS_EYRING', params: { lnkRef: Math.log(0.1), EaR: 0, VaR: 0, Tref: 60, Pref: 400 } };
  const grid = fn('generateGridData', undefined, context)(fitted, [{ factors: { temp: 60, pressure: 400 } }], 'temp', 'pressure', {}, x => x);
  assert.ok(Math.abs(grid.z[1][1] - Math.log(0.1)) < 1e-10);
});

test('contour and 3D grids span low-aw data instead of a fixed aw floor', () => {
  const fitted = { secondaryModelId: 'EXTENDED_BIGELOW', params: { logDref: 1, Tref: 80, zT: 15, awRef: 0.2, zaw: 0.5 } };
  const rows = [
    { factors: { temp: 75, aw: 0.1 } },
    { factors: { temp: 85, aw: 0.3 } },
  ];
  const grid = fn('generateGridData', undefined, context)(fitted, rows, 'temp', 'aw', {}, x => x);
  assert.ok(grid.y[0] <= 0.1, `grid aw minimum ${grid.y[0]} must include aw 0.1`);
  assert.ok(grid.y[grid.y.length - 1] >= 0.3, `grid aw maximum ${grid.y.at(-1)} must include aw 0.3`);
  assert.ok(grid.z.flat().every(Number.isFinite));
});

test('3D experimental scatter preserves measured residuals on regression scale', () => {
  const n = ast.program.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === 'ResponseSurface3D');
  const declaration = n.body.body.find(n => n.type === 'VariableDeclaration' && n.declarations[0].id.name === 'scatterTrace');
  const row = { factors: { temp: 60, pressure: 400 }, y: Math.log(8) };
  const scope = { ...context, rows: [row], fittedModel: { secondaryModelId: 'ARRHENIUS_EYRING', params: { lnkRef: Math.log(4), EaR: 0, VaR: 0, Tref: 60, Pref: 400 } }, allDefaults: {}, xKey: 'temp', yKey: 'pressure', transformValue: v => v };
  const scatter = new Function(...Object.keys(scope), `${source.slice(declaration.start, declaration.end)} return scatterTrace;`)(...Object.values(scope));
  assert.equal(scatter.z[0], Math.log(8));
});

test('manual D import keeps blank optional metadata and discloses malformed rows', () => {
  const aliases = fn('buildHeaderAliases', component.body.body, { HEADER_ALIASES: { D: 'D', temp: 'temp', aw: 'aw', pH: 'pH' }, getFactorDefsWithCustom: secondary.getFactorDefsWithCustom });
  const result = fn('parseManualDText', component.body.body, { buildHeaderAliases: aliases, readDelimitedRecords })('D,temp,aw,pH\n1,60,,\n2,70,0.9,\ninvalid,80,,');
  assert.equal(result.entries.length, 2);
  assert.equal(result.rejectedCount, 1);
  assert.deepEqual(result.entries[0].factors, { temp: 60 });
});

test('secondary editable inputs initialize from retained parent state', () => {
  const declarations = component.body.body.filter(n => n.type === 'VariableDeclaration');
  const d = declarations.find(n => n.declarations[0].id.type === 'ArrayPattern' && n.declarations[0].id.elements[0].name === 'manualDEntries');
  const retained = [{ id: 1, D: 5, factors: { temp: 60 } }];
  const actual = new Function('useState', 'initialState', `${source.slice(d.start, d.end)} return manualDEntries;`)(value => [typeof value === 'function' ? value() : value], { manualDEntries: retained });
  assert.deepEqual(actual, retained);
});

test('local empty-data fitting retains trusted literature while clearing obsolete calculated fits', () => {
  const effect = component.body.body.filter(n => n.type === 'ExpressionStatement' && n.expression.callee?.name === 'useEffect')
    .map(n => n.expression).find(effect => source.slice(effect.arguments[0].start, effect.arguments[0].end).includes('return scheduleFit'));
  const literature = { primaryModelId: 'LOG_LINEAR', source: 'literature', params: { logDref: 0 } };
  let local = { BIGELOW_D: literature, old: { primaryModelId: 'LOG_LINEAR', params: {} } };
  let published;
  const scope = { ...secondary, primaryModelId: 'LOG_LINEAR', datasets: [], fitResults: {}, scenario: 'thermal', mode: null, primaryFactorKey: 'temp', targetKey: 'D', manualDEntries: [], fixedSecondaryParams: {}, exampleDefaults: null, localFitSignature: 'empty',
    getAllowedSecondaryIds: fn('getAllowedSecondaryIds', undefined, context), buildRowsForSecondary: () => [], scheduleFit: callback => callback(), setFittedModels: callback => { local = callback(local); }, onSecondaryFit: next => { published = next; } };
  new Function(...Object.keys(scope), `return (${source.slice(effect.arguments[0].start, effect.arguments[0].end)})();`)(...Object.values(scope));
  assert.equal(local.BIGELOW_D, literature);
  assert.equal(local.old, undefined);
  assert.deepEqual(published, {});
});

test('manual D upload handles quoted multiline metadata and reports malformed CSV', async () => {
  const aliases = () => ({ D: 'D', temp: 'temp' });
  const parseManual = fn('parseManualDText', component.body.body, { buildHeaderAliases: aliases, readDelimitedRecords });
  const imported = parseManual('D,temp,note\n"1","60","first\nsecond"');
  assert.equal(imported.entries.length, 1);
  const rejected = parseManual('D,temp\n"1,60');
  assert.equal(rejected.entries.length, 0);
  assert.ok(rejected.error);
});

test('reference means exclude missing factor metadata rather than converting it to zero', () => {
  const n = component.body.body.find(n => n.type === 'VariableDeclaration' && n.declarations[0].id.name === 'referenceDataMeans');
  const scope = { useMemo: callback => callback(), referenceParams: [{ name: 'Tref' }, { name: 'awRef' }, { name: 'pHref' }], rows: [{ factors: { temp: 60 }, x: 60 }], secondaryModel: secondary.SECONDARY_MODELS.BIGELOW, mode: null, primaryFactorKey: 'temp', getReferenceFactorKey: fn('getReferenceFactorKey') };
  const means = new Function(...Object.keys(scope), `${source.slice(n.start, n.end)} return referenceDataMeans;`)(...Object.values(scope));
  assert.deepEqual(means, { Tref: 60 });
});

test('secondary local fits distinguish physical input units and time versus dose axis', () => {
  const n = component.body.body.find(n => n.type === 'VariableDeclaration' && n.declarations[0].id.name === 'localFitSignature');
  const scope = { fittingInputSignature: value => value, datasets: [], fitResults: {}, primaryModelId: 'LOG_LINEAR', scenario: 'pef', primaryFactorKey: 'electricField', mode: {}, fixedSecondaryParams: {}, manualDEntries: [], targetKey: 'D', timeUnit: 'μs', useDoseAxis: true };
  const signature = new Function(...Object.keys(scope), `${source.slice(n.start, n.end)} return localFitSignature;`)(...Object.values(scope));
  assert.equal(signature.timeUnit, 'μs');
  assert.equal(signature.useDoseAxis, true);
});
