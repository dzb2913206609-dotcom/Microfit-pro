import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { getExampleCase } from '../src/config/exampleDatasets.js';
import { computeDEntryY, fitSecondaryModel } from '../src/models/secondaryModels.js';

const near = (actual, expected, tolerance = 1e-7) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

const CASES = [
  {
    id: 't3-black-pepper-ef',
    hash: 'a24e65b26c06fe93e413407028ff6ac13e68ba3f2d39b358d4a5346d4791ff76',
    Dref: 15.340062869663205,
    zT: 12.709090732901899,
    zaw: 0.3146124337129026,
  },
  {
    id: 't4-black-pepper-salmonella',
    hash: '65648e797418b6465a7a1495ed48f3328ac23510a636a591c8039951b471c2d7',
    Dref: 8.493583218534065,
    zT: 12.793074702376783,
    zaw: 0.2992086477883507,
  },
];

test('black-pepper D-value examples retain all 27 replicate measurements', () => {
  for (const sample of CASES) {
    const example = getExampleCase(sample.id);
    assert.ok(example, `${sample.id} must be registered`);
    const entries = example.secondaryDefaults.manualDEntries;
    assert.equal(entries.length, 27);
    const records = entries.map((entry) => [entry.id, entry.D, entry.factors.temp, entry.factors.aw]);
    assert.equal(createHash('sha256').update(JSON.stringify(records)).digest('hex'), sample.hash);
    const conditionCounts = new Map();
    for (const entry of entries) {
      assert.ok(Number.isFinite(entry.D) && entry.D > 0);
      assert.ok(Number.isFinite(entry.factors.temp));
      assert.ok(Number.isFinite(entry.factors.aw));
      const key = `${entry.factors.temp}|${entry.factors.aw}`;
      conditionCounts.set(key, (conditionCounts.get(key) ?? 0) + 1);
    }
    assert.equal(conditionCounts.size, 9);
    assert.ok([...conditionCounts.values()].every((count) => count === 3));
  }
});

test('black-pepper D-value examples fit Extended Bigelow on all 27 observations', () => {
  for (const sample of CASES) {
    const example = getExampleCase(sample.id);
    const rows = example.secondaryDefaults.manualDEntries.map((entry) => computeDEntryY({
      dValue: entry.D,
      factors: entry.factors,
      primaryModelId: 'LOG_LINEAR',
      targetKey: 'D',
      secondaryModelId: 'EXTENDED_BIGELOW',
    }));
    const fit = fitSecondaryModel('EXTENDED_BIGELOW', rows, example.secondaryDefaults.referenceParams);
    assert.equal(fit.failed, false);
    assert.equal(fit.n, 27);
    assert.equal(fit.params.Tref, 75);
    assert.equal(fit.params.awRef, 0.45);
    near(Math.pow(10, fit.params.logDref), sample.Dref);
    near(fit.params.zT, sample.zT);
    near(fit.params.zaw, sample.zaw);
  }
});
