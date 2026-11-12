import assert from 'node:assert/strict';
import { splitDataLine, buildPastePreview } from '../src/utils/pastePreview.js';

// Empty delimited cells retain identity, including the first column.
assert.deepEqual(splitDataLine('10,,5.1,5.2'), ['10', '', '5.1', '5.2']);
assert.deepEqual(splitDataLine('\t60\t5.1'), ['', '60', '5.1']);
assert.equal(buildPastePreview('x,,rep1\n10,60,5.1', { requiredNumericCols: 2 }).hasInvalidRequiredFields, true);

const imports = await import('../src/utils/pastePreview.js');
assert.equal(typeof imports.readNumericRows, 'function');
assert.throws(() => imports.readNumericRows('10,,5.1\n20,60,4.1', 2), /line 1/i);
assert.throws(() => imports.readNumericRows('time,temp,rep1\n10,60oops,5.1', 2), /line 2/i);
assert.throws(() => imports.readNumericRows('time,,rep1\n10,60,5.1', 2), /line 1/i);
assert.throws(() => imports.readNumericRows('NaN,5.1\n10,4.1'), /line 1/i);
assert.throws(() => imports.readNumericRows('bad,5.1\n10,4.1'), /line 1/i);
assert.deepEqual(imports.readNumericRows('time,rep1,rep2\n10,,5.1\n20,4.2,', 1).map(r => r.values), [[5.1], [4.2]]);

const state = await import('../src/utils/fittingState.js').catch(() => ({}));
assert.equal(typeof state.createDatasetId, 'function');
assert.equal(new Set(Array.from({length: 1000}, () => state.createDatasetId())).size, 1000);
const datasets = [{ id: 'same', conditions: { temp: 60 }, data: [{t: 0, logN: 6}] }];
const fits = { same_LOG_LINEAR: {params: {kmax: 1}, converged: true} };
const sig = state.fittingInputSignature({ datasets, fitResults: fits });
assert.notEqual(sig, state.fittingInputSignature({ datasets, fitResults: {same_LOG_LINEAR: {...fits.same_LOG_LINEAR, params: {kmax: 2}}} }));
assert.notEqual(sig, state.fittingInputSignature({ datasets: [{...datasets[0], data: [{t: 0, logN: 5}]}], fitResults: fits }));
let called = false;
const cancel = state.scheduleFit(() => { called = true; }, 5);
cancel();
await new Promise(resolve => setTimeout(resolve, 15));
assert.equal(called, false);

const { buildRowsForSecondary, rankSecondaryCandidates } = await import('../src/utils/secondaryFitState.js').catch(() => ({}));
assert.equal(typeof buildRowsForSecondary, 'function');
const input = { datasets: [{id:'a', conditions:{temp:60}}], fitResults: {a_LOG_LINEAR: {params:{kmax:Math.LN10/10}}}, primaryModelId: 'LOG_LINEAR', targetKey: 'D', manualDEntries: [{id:'b', D:10, factors:{temp:65}}] };
assert.deepEqual(buildRowsForSecondary({...input, secondaryModelId:'AVERAGE'}).map(r=>r.y), [10,10]);
assert.deepEqual(buildRowsForSecondary({...input, secondaryModelId:'BIGELOW'}).map(r=>r.y), [1,1]);
const good = {converged:true,aiccValid:true,aicc:2, params:{a:1}, paramErrors:{a:100}};
const ranked = rankSecondaryCandidates([['good',good],['bad',{...good,aicc:-20,failed:true}],['unstable',{...good,aicc:3}],['not-converged',{...good,aicc:-10,converged:false}],['invalid',{...good,aicc:-30,aiccValid:false}]]);
assert.deepEqual(ranked.map(([key])=>key), ['good','unstable']);
const reconcile = (await import('../src/utils/secondaryFitState.js')).reconcileSecondaryFits;
assert.equal(typeof reconcile, 'function');
const fresh = {params:{a:2}};
const stale = {params:{a:1},inputSignature:'old',userOverride:true};
assert.equal(reconcile({model:fresh},{model:stale},'new').model, fresh);
assert.equal(reconcile({model:fresh},{model:{...stale,inputSignature:'new',userOverride:false}},'new').model, fresh);
const manual = {...stale,inputSignature:'new'};
assert.equal(reconcile({model:fresh},{model:manual},'new').model, manual);
assert.deepEqual(reconcile({}, {model:stale}, 'new'), {});
console.log('State/import/secondary regression checks passed.');
