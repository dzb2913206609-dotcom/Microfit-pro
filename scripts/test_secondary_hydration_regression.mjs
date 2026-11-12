import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from '@babel/parser';
import { reconcileSecondaryFits } from '../src/utils/secondaryFitState.js';
import { buildRowsForSecondary } from '../src/utils/secondaryFitState.js';
import { MODEL_SECONDARY_CONFIG, SECONDARY_MODELS, fitSecondaryModel, computeLinkedPrimaryCurveMetrics } from '../src/models/secondaryModels.js';

const appSource = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const secondarySource = fs.readFileSync(new URL('../src/components/SecondaryModel.jsx', import.meta.url), 'utf8');
const app = parse(appSource, {sourceType:'module',plugins:['jsx']});
const secondary = parse(secondarySource, {sourceType:'module',plugins:['jsx']});
const appFunction = app.program.body.find(node => node.type==='FunctionDeclaration' && node.id.name==='AppContent');
const updateDeclaration = appFunction.body.body.find(node => node.type==='VariableDeclaration' && node.declarations[0].id.name==='handleSecondaryFitUpdate');
const secondaryFunction = secondary.program.body.find(node => node.type==='ExportDefaultDeclaration').declaration;
// Execute the actual parent callback and child hydration subscriptions, with
// React's dependency equality and commit ordering; numerical work is unrelated.
const effects = secondaryFunction.body.body.filter(node => node.type==='ExpressionStatement' && node.expression.callee?.name==='useEffect')
  .map(node => node.expression)
  .filter(effect => effect.arguments[1]?.elements.some(node => ['precomputedFits','fittedModels'].includes(node?.name)))
  .filter(effect => secondarySource.slice(effect.arguments[0].start,effect.arguments[0].end).includes('onSecondaryFit') || secondarySource.slice(effect.arguments[0].start,effect.arguments[0].end).includes('reconcileSecondaryFits'));
let parent = {example:{primaryModelId:'LOG_LINEAR',params:{a:1}}};
let local = {};
const update = new Function('useCallback','setFittedSecondaryModels', `${appSource.slice(updateDeclaration.start,updateDeclaration.end)}; return handleSecondaryFitUpdate;`)(fn=>fn, fn=>{ parent=fn(parent); });
const previousDependencies = new Map();
let commits = 0;
for (; commits < 20; commits++) {
  const parentBefore = parent;
  const localBefore = local;
  const values = {precomputedFits:parentBefore,fittedModels:localBefore,primaryModelId:'LOG_LINEAR',localFitSignature:'same-input',onSecondaryFit:update};
  for (const effect of effects) {
    const deps = effect.arguments[1].elements.map(node => values[node.name]);
    const prev = previousDependencies.get(effect);
    if (prev && deps.every((value,index)=>Object.is(value,prev[index]))) continue;
    previousDependencies.set(effect,deps);
    const callback = new Function(...Object.keys(values),'setFittedModels','reconcileSecondaryFits', `return (${secondarySource.slice(effect.arguments[0].start,effect.arguments[0].end)});`)(...Object.values(values),fn=>{local=fn(local);},reconcileSecondaryFits);
    callback();
  }
  if (parentBefore===parent && localBefore===local) break;
}
assert(commits < 5, `Hydration failed to settle after ${commits} commits`);
assert.deepEqual(parent,{example:{primaryModelId:'LOG_LINEAR',params:{a:1}}});
assert.equal(local.example,parent.example);
const fitEffect = secondaryFunction.body.body.filter(node => node.type==='ExpressionStatement' && node.expression.callee?.name==='useEffect')
  .map(node=>node.expression).find(effect=>secondarySource.slice(effect.arguments[0].start,effect.arguments[0].end).includes('return scheduleFit'));
const allowedFunction = secondary.program.body.find(node=>node.type==='FunctionDeclaration' && node.id.name==='getAllowedSecondaryIds');
const getAllowedSecondaryIds = new Function('SECONDARY_MODELS', `return (${secondarySource.slice(allowedFunction.start,allowedFunction.end)});`)(SECONDARY_MODELS);
let reports = 0;
let pending;
let cancelled;
const input = {MODEL_SECONDARY_CONFIG,SECONDARY_MODELS,fitSecondaryModel,computeLinkedPrimaryCurveMetrics,buildRowsForSecondary,getAllowedSecondaryIds,
  datasets:[],fitResults:{},primaryModelId:'LOG_LINEAR',scenario:'thermal',mode:null,primaryFactorKey:'temp',manualDEntries:[],targetKey:'D',fixedSecondaryParams:{},exampleDefaults:null,localFitSignature:'empty-input',
  setFittedModels:fn=>{local=fn(local);},onSecondaryFit:(...args)=>{reports++;update(...args);},scheduleFit:fn=>{pending=fn;cancelled=false;return ()=>{cancelled=true;};}};
const runFitEffect = () => new Function(...Object.keys(input), `return (${secondarySource.slice(fitEffect.arguments[0].start,fitEffect.arguments[0].end)})();`)(...Object.values(input));
const cancel = runFitEffect();
assert.equal(reports,0,'Scheduling must not publish before fitting completes');
cancel();
if (!cancelled) pending();
assert.equal(reports,0,'Cancelled input generations must not publish');
runFitEffect();
pending();
assert.equal(reports,1,'Only the completed local computation publishes');
assert.deepEqual(parent,{},'Insufficient current data removes obsolete fits after completion');
console.log(`Secondary hydration settled in ${commits + 1} commits without publishing parent results back.`);
