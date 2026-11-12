import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runDynamicSimulation, buildKFn, validateDynamicProfile, parseProfileCSV } from '../src/models/dynamicSimulation.js';
import { runMonteCarlo, runMonteCarloWithFactors } from '../src/models/monteCarlo.js';
import { computeGSA, computeMorris, computeSobolTotal, generateConclusions } from '../src/models/sensitivityAnalysis.js';
import { MODELS, getParamsForDoseAxis } from '../src/models/inactivationModels.js';
import { STERILIZATION_MODES as modes } from '../src/config/sterilizationModes.js';
import { createSeededRng } from '../src/utils/random.js';

const photoFit = { primaryModelId: 'LOG_LINEAR', targetKey: 'kmax', secondaryModelId: 'LINEAR_PHOTO', params: { a: 0, b: Math.LN10 } };
test('every dynamic profile knot contributes, including a sub-grid triangular pulse', () => {
  const profile = [{t:0,intensity:0},{t:.001,intensity:100},{t:.002,intensity:0},{t:60,intensity:0}];
  const result = runDynamicSimulation({logN0:7,profile,kFn:buildKFn(photoFit,['intensity']).kFn,steps:500,modeConfig:modes.photoinactivation,lethalityParams:{}});
  assert.ok(Math.abs(result.at(-1).logReduction-.1)<1e-10);
  assert.ok(Math.abs(result.at(-1).F-6)<1e-10);
  assert.ok(result.some(row=>row.t===.001));
  assert.ok(result.length<510);
});
test('dynamic blank factor, invalid rate, initial count, and step count reject instead of acting like zero treatment', () => {
  const blank = parseProfileCSV('time,temp\n0,60\n5,\n10,60',modes.thermal);
  assert.match(validateDynamicProfile(blank),/temp|factor/i);
  const base = {logN0:7,profile:[{t:0},{t:1}],kFn:()=>1,steps:2};
  for (const kFn of [()=>NaN,()=>Infinity,()=>-1]) assert.throws(()=>runDynamicSimulation({...base,kFn}),/rate/i);
  for (const steps of [0,-1,1.5,NaN,Infinity]) assert.throws(()=>runDynamicSimulation({...base,steps}),/steps/i);
  assert.throws(()=>runDynamicSimulation({...base,logN0:NaN}),/logN0/i);
  assert.equal(runDynamicSimulation({...base,kFn:()=>0}).at(-1).logN,7);
  const invalid = buildKFn({...photoFit,params:{a:-1,b:0}},['intensity']);
  assert.throws(()=>runDynamicSimulation({...base,profile:[{t:0,intensity:1},{t:1,intensity:1}],kFn:invalid.kFn}),/rate|prediction/i);
});
for (const [mode,key,end,expected,params] of [[modes.photoinactivation,'intensity',10,300,{}],[modes.chemical,'concentration',10,5,{}],[modes.irradiation,'doseRate',60,.5,{}],[modes.pef,'electricField',1,40000,{conductivity:2,density:1000}]]) {
 test(`${mode.id} cumulative metric integrates ramp in its declared units`,()=>{
  const r=runDynamicSimulation({logN0:7,profile:[{t:0,[key]:0},{t:1,[key]:end}],kFn:()=>0,steps:1,modeConfig:mode,lethalityParams:params});
  assert.ok(Math.abs(r.at(-1).F-expected)<1e-7,`${r.at(-1).F} != ${expected}`);
 });
}
test('zero conductivity is zero PEF energy and photo dose axis is J/cm²',()=>{
 const r=runDynamicSimulation({logN0:7,profile:[{t:0,electricField:1},{t:1,electricField:1}],kFn:()=>0,steps:1,modeConfig:modes.pef,lethalityParams:{conductivity:0,density:1000}});
 assert.equal(r.at(-1).F,0);
 assert.equal(modes.photoinactivation.doseAxis.convert(1,{intensity:10}),.6);
});
test('deterministic MC preserves valid Weibull shape and survival values below -20',()=>{
 const params={logN0:7,delta:5,p:.05};
 const r=runMonteCarlo({params,paramNames:Object.keys(params),modelFn:MODELS.WEIBULL.fn,tArray:[0,500],nSamples:10});
 assert.equal(r.paramSamples[2][0],.05);
 assert.equal(r.finalLogNSamples[0],MODELS.WEIBULL.fn(500,params));
 const l=runMonteCarlo({params:{logN0:7,kmax:Math.LN10},paramNames:['logN0','kmax'],modelFn:MODELS.LOG_LINEAR.fn,tArray:[0,30,40],nSamples:10});
 assert.ok(Math.abs(l.allSamples[1][0]+23)<1e-10);
 assert.ok(Math.abs(l.allSamples[2][0]+33)<1e-10);
});
test('SRC accounts for independent factor uncertainty instead of derived rate',()=>{
 const r=runMonteCarloWithFactors({predictedParams:{logN0:7,kmax:1},paramNames:['logN0','kmax'],modelFn:MODELS.LOG_LINEAR.fn,tArray:[0,1],nSamples:1000,factorValues:{temp:60},factorSDs:{temp:1},factorKeys:['temp'],predictParamsFn:f=>({logN0:7,kmax:Math.pow(10,(f.temp-60)/10)}),bindings:{kmax:'fit'},fittedSecondaryModels:{fit:{primaryModelId:'LOG_LINEAR',params:{}}},rng:createSeededRng('audit')});
 const g=computeGSA(r.independentParamSamples ?? r.paramSamples,r.finalLogNSamples,r.paramNames,r.factorSamples,r.factorKeys,'LOG_LINEAR');
 assert.equal(g.factorContribution,100);assert.equal(g.modelContribution,0);
});
test('Morris tail constraints and invalid trajectories never yield NaN effects',()=>{
 const r=computeMorris({modelFn:MODELS.LOG_LINEAR_TAIL.fn,nominalParams:{logN0:7,kmax:.5,logNres:6.5},paramNames:['logN0','kmax','logNres'],modelId:'LOG_LINEAR_TAIL',tEval:10,rng:createSeededRng('4')});
 assert.ok(r);assert.ok(r.results.every(x=>[x.muStar,x.sigma,x.contribution].every(Number.isFinite)));
 assert.ok(Number.isFinite(r.modelContribution));
});
test('Sobol has no invented direction and SRC direction names the selected metric',()=>{
 const r=computeSobolTotal({modelFn:MODELS.LOG_LINEAR.fn,nominalParams:{logN0:7,kmax:2},paramNames:['logN0','kmax'],tEval:10,N:512,rng:createSeededRng('audit')});
 assert.ok(r.results.every(x=>x.src==null));
 assert.ok(generateConclusions(r.results,'LOG_LINEAR',0,100,0).every(x=>!x.startsWith('Increasing')));
 const text=generateConclusions([{param:'kmax',label:'kmax',category:'model',contribution:100,src:1}],'LOG_LINEAR',0,100,0,'logReduction');
 assert.ok(text.some(x=>x.includes('increase log reduction')));
});

import { panelHarness } from './helpers/panelHarness.mjs';
import { FACTOR_DEFS, predictPrimaryParams } from '../src/models/secondaryModels.js';
import * as monteCarlo from '../src/models/monteCarlo.js';
function renderMC(unit='min') {
 return panelHarness('src/components/MonteCarloPanel.jsx','MonteCarloPanel',{
  useScenario:()=>({timeUnit:unit,mode:modes.thermal}),MODELS,FACTOR_DEFS,predictPrimaryParams,
  ...monteCarlo,createSeededRng,generateRandomSeed:()=> 'seed',
 },['handleRun','result','successCount','safeTimeResult','setTargetReduction','setNSamples']);
}
test('MC panel reduction targets use each sampled initial state',async ()=>{
 const render=renderMC();const props={modelId:'LOG_LINEAR',tMax:5,predictedParams:{logN0:7,kmax:Math.LN10},primaryFit:{params:{logN0:7,kmax:Math.LN10},paramNames:['logN0','kmax'],covMatrix:[[1,0],[0,0]],mse:1},visibleFactorKeys:[]};
 render(props).setNSamples(1000);await render(props).handleRun();
 assert.equal(render(props).successCount,1000);
 assert.equal(render(props).safeTimeResult.safeTime,5);
});

import { readFileSync } from 'node:fs';
import Papa from 'papaparse';
test('validation CSV roundtrips dataset and diagnostic labels containing quotes, commas and line breaks',async()=>{
 const src=readFileSync('src/components/ExternalValidation.jsx','utf8');
 const code=src.slice(src.indexOf('function exportValidationCSV('),src.indexOf('let nextSetId'));
 let blob;
 const download=new Function('triggerDownload',code+';return exportValidationCSV;')((b)=>{blob=b;});
 const name='heldout,"replicate"\nsecond line';
 download({points:[{datasetName:name,t:1,observed:2,predicted:3}],Bf:1,Af:1,RMSE:1,n:1},{targetLabel:'D, min'});
 const rows=Papa.parse(await blob.text()).data;
 assert.equal(rows[1][0],name);assert.equal(rows[1].length,5);
 assert.deepEqual(rows.find(r=>r[0]==='Target'),['Target','D, min']);
});

test('MC rejects invalid secondary sample centers instead of repairing them into positive rates',()=>{
 const r=runMonteCarloWithFactors({predictedParams:{logN0:7,kmax:1},paramNames:['logN0','kmax'],modelFn:MODELS.LOG_LINEAR.fn,tArray:[0,1],nSamples:10,factorValues:{temp:60},factorSDs:{temp:0},factorKeys:['temp'],predictParamsFn:()=>({logN0:7,kmax:-1})});
 assert.equal(r.finalLogNSamples.length,0);assert.equal(r.rejectedSamples,10);
});

test('dynamic profile CSV rejects malformed quoting and rate fallback uses the fitted reference factors',()=>{
 assert.throws(()=>parseProfileCSV('time,temp\n0,60\n1,"60',modes.thermal),/CSV|quote/i);
 const fit={primaryModelId:'LOG_LINEAR',targetKey:'kmax',secondaryModelId:'ARRHENIUS_EYRING',params:{lnkRef:0,EaR:5000,VaR:0,Tref:40,Pref:400}};
 const built=buildKFn(fit,['pressure']);
 assert.equal(built.fallbacks.find(x=>x.factorKey==='temp').value,40);
 assert.equal(built.kFn({pressure:400}),1);
 const sigmaFit={...fit,targetKey:'D',secondaryModelId:'PEF_FIELD_CONDUCTIVITY',params:{logDref:0,Eref:20,zE:10,sigmaRef:3,zSigma:2}};
 assert.equal(buildKFn(sigmaFit,['electricField']).fallbacks.find(x=>x.factorKey==='conductivity').value,3);
});
test('zero-variance Monte Carlo preserves small positive rates after a physical time-unit conversion',()=>{
 const params={logN0:7,kmax:.0005};
 const r=runMonteCarlo({params,paramNames:['logN0','kmax'],modelFn:MODELS.LOG_LINEAR.fn,tArray:[0,1000],nSamples:10});
 assert.equal(r.paramSamples[1][0],.0005);
 assert.equal(r.finalLogNSamples[0],MODELS.LOG_LINEAR.fn(1000,params));
});

test('Monte Carlo dimensional rate nominal remains invariant at microsecond scale',()=>{
 const rate=.5/60000000; const params={logN0:7,kmax:rate};
 const r=runMonteCarlo({params,paramNames:['logN0','kmax'],modelFn:MODELS.LOG_LINEAR.fn,tArray:[0,60000000],nSamples:10});
 assert.equal(r.paramSamples[1][0],rate);
 assert.ok(Math.abs(r.finalLogNSamples[0]-MODELS.LOG_LINEAR.fn(1,{logN0:7,kmax:.5}))<1e-12);
 const tiny={logN0:7,kmax:1e-20};
 assert.equal(runMonteCarlo({params:tiny,paramNames:['logN0','kmax'],modelFn:MODELS.LOG_LINEAR.fn,tArray:[0,1],nSamples:1}).paramSamples[1][0],1e-20);
});

test('Morris keeps physically small rate as an independent dimension in microsecond units',()=>{
 const r=computeMorris({modelId:'LOG_LINEAR',timeUnitToMin:1/60000000,modelFn:MODELS.LOG_LINEAR.fn,nominalParams:{logN0:7,kmax:.5/60000000},paramNames:['logN0','kmax'],tEval:60000000,rng:createSeededRng('rate-units')});
 assert.ok(r.results.find(row=>row.param==='kmax')?.muStar>0);
 const sobol=computeSobolTotal({modelId:'LOG_LINEAR',timeUnitToMin:1/60000000,modelFn:MODELS.LOG_LINEAR.fn,nominalParams:{logN0:7,kmax:.5/60000000},paramNames:['logN0','kmax'],tEval:60000000,rng:createSeededRng('rate-units'),N:512});
 assert.ok(sobol.results.find(row=>row.param==='kmax')?.st>0);
});

import { fitModel } from '../src/models/fitter.js';
import { fitPrimaryInTimeUnit } from '../src/utils/unitFitting.js';
import { applyHeldOutInitialState, resolveValidationTarget } from '../src/utils/validationDiagnostics.js';
import { MODEL_SECONDARY_CONFIG, predictRawParameterValue } from '../src/models/secondaryModels.js';
test('held-out curve and D validation fit physical microsecond rates in canonical time units',()=>{
 const src=readFileSync('src/components/ExternalValidation.jsx','utf8');
 const code=src.slice(src.indexOf('function computeCurveMetrics('),src.indexOf('/* ── Extrapolation detection'));
 const functions=new Function('MODELS','fitModel','fitPrimaryInTimeUnit','applyHeldOutInitialState','predictPrimaryParams','MODEL_SECONDARY_CONFIG','resolveValidationTarget','predictRawParameterValue',code+';return {computeCurveMetrics,computeParameterMetrics};')(MODELS,fitModel,fitPrimaryInTimeUnit,applyHeldOutInitialState,predictPrimaryParams,MODEL_SECONDARY_CONFIG,resolveValidationTarget,predictRawParameterValue);
 const unit=1/60000000;const params={logN0:9,kmax:.5*unit};
 const sets=[{id:'heldout',name:'heldout',conditions:{electricField:20},parsedData:[0,1,2,3,4,5].map(t=>({t:t/unit,logN:MODELS.LOG_LINEAR.fn(t,{logN0:7,kmax:.5})}))}];
 const curve=functions.computeCurveMetrics(sets,'LOG_LINEAR',{},{},params,'electricField',unit);
 assert.ok(curve.RMSE<1e-5);assert.ok(Math.abs(curve.points[0].predicted-7)<1e-5);
 const d=functions.computeParameterMetrics(sets,'LOG_LINEAR',{},{},params,'electricField',unit);
 assert.ok(d);assert.ok(Math.abs(d.Bf-1)<1e-5);
});
test('sensitivity selected-result labels express active microsecond parameter units',()=>{
 const src=readFileSync('src/components/SensitivityPanel.jsx','utf8');
 const code=src.slice(src.indexOf('  const resultMap ='),src.indexOf('  const conclusions ='));
 const fake={results:[{param:'kmax',category:'model',label:'k_max (1/min)',src:1,contribution:100}],modelContribution:100};
 const run=new Function('oatResult','gsaResult','morrisResult','sobolResult','mode','modelId','axisUnit','MODELS','getParamsForDoseAxis','useMemo',code+';return activeResult;');
 const result=run(fake,null,null,null,'oat','LOG_LINEAR','μs',MODELS,getParamsForDoseAxis,f=>f());
 assert.equal(result.results[0].label,'k_max (1/μs)');
});

test('zero shoulder Morris ranges preserve physical units',()=>{
 const nominal={logN0:7,kmax:.5,Sl:0};
 const options={modelId:'SHOULDER_NOTAIL',modelFn:MODELS.SHOULDER_NOTAIL.fn,paramNames:['Sl'],tEval:1};
 const min=computeMorris({...options,nominalParams:nominal,timeUnitToMin:1,rng:createSeededRng('zero-time')});
 const us=computeMorris({...options,nominalParams:{...nominal,kmax:nominal.kmax/60000000},tEval:60000000,timeUnitToMin:1/60000000,rng:createSeededRng('zero-time')});
 assert.ok(Math.abs(us.results[0].muStar-min.results[0].muStar)<1e-14);
});

test('zero shoulder OAT direction retains the same physical perturbation in microseconds',async()=>{
 const {computeOATSensitivity}=await import('../src/models/sensitivityAnalysis.js');
 const options={modelId:'SHOULDER_NOTAIL',modelFn:MODELS.SHOULDER_NOTAIL.fn,nominalParams:{logN0:7,kmax:.5,Sl:0},paramNames:['Sl','kmax'],tEval:1,delta:.05};
 const min=computeOATSensitivity({...options,timeUnitToMin:1});
 const us=computeOATSensitivity({...options,timeUnitToMin:1/60000000,nominalParams:{...options.nominalParams,kmax:.5/60000000},tEval:60000000});
 assert.ok(Math.abs(us.results.find(r=>r.param==='Sl').contribution-min.results.find(r=>r.param==='Sl').contribution)<1e-10);
});
