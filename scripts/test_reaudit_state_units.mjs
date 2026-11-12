import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { parse } from '@babel/parser';
import * as paste from '../src/utils/pastePreview.js';

test('quoted numeric CSV and escaped metadata preserve empty columns', () => {
  assert.deepEqual(paste.splitDataLine('"0",,"6"'), ['0','','6']);
  assert.deepEqual(paste.splitDataLine('"a,b","a""b"'), ['a,b','a"b']);
  assert.deepEqual(paste.readNumericRows('time,rep1\n"0","6"\n"1","5"').map(r=>r.required), [[0],[1]]);
  assert.throws(()=>paste.readNumericRows('time,rep1\n"0,6\n1,5'), /line 2/);
});

test('axis conversion preserves physical coordinates per dataset and refuses missing factors', async () => {
  const axis = await import('../src/utils/axisState.js').catch(()=>({}));
  assert.equal(typeof axis.convertDatasetsAxis,'function');
  const pef = {timeUnitOptions:[{key:'min',toMin:1},{key:'ms',toMin:1/60000},{key:'μs',toMin:1/60000000}]};
  const from={timeUnit:'ms',useDoseAxis:false}, to={...from,timeUnit:'μs'};
  const data=[{id:'a',data:[{t:2,logN:6,rawValues:[6]}],conditions:{intensity:10}}];
  assert.equal(axis.convertDatasetsAxis(pef,data,from,to)[0].data[0].t,2000);
  const photo={id:'photoinactivation',doseAxis:{factor:'intensity'}};
  const dose=axis.convertDatasetsAxis(photo,data,{timeUnit:'min',useDoseAxis:false},{timeUnit:'min',useDoseAxis:true});
  assert.equal(dose[0].data[0].t,1.2);
  assert.equal(axis.axisScale(photo,{intensity:'10'},{useDoseAxis:false},{useDoseAxis:true}),.6);
  assert.deepEqual(axis.convertDatasetsAxis(photo,dose,{timeUnit:'min',useDoseAxis:true},{timeUnit:'min',useDoseAxis:false})[0].data,data[0].data);
  assert.throws(()=>axis.convertDatasetsAxis(photo,[{...data[0],conditions:{intensity:0}}],{useDoseAxis:false},{useDoseAxis:true}), /intensity/);
  const irrad={id:'irradiation',doseAxis:{factor:'doseRate'}};
  assert.equal(axis.convertDatasetsAxis(irrad,[{...data[0],conditions:{doseRate:30}}],{useDoseAxis:false},{useDoseAxis:true})[0].data[0].t,1);
  assert.equal(axis.rescalePendingText('time,rep1\n"2","6"',1000,'Time (μs)'), 'Time (μs),rep1\n2000,6');
});

test('predictor invalidates old values when fallback model or fitted parameters change', () => {
  const source=fs.readFileSync(new URL('../src/components/KineticPredictor.jsx',import.meta.url),'utf8');
  const ast=parse(source,{sourceType:'module',plugins:['jsx']});
  const fn=ast.program.body.find(n=>n.type==='ExportDefaultDeclaration').declaration;
  const end=fn.body.body.find(n=>n.type==='IfStatement' && source.slice(n.start,n.end).includes('options.length === 0')).start;
  const head=source.slice(fn.start,end).replace('export default ','');
  const slots=[],deps=[];let cursor=0,effects=[];
  const useState=initial=>{const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],v=>slots[i]=typeof v==='function'?v(slots[i]):v];};
  const useEffect=(f,d)=>{const i=cursor++;if(!deps[i]||d.some((v,j)=>v!==deps[i][j])){deps[i]=d;effects.push(f);}};
  const scope={useState,useEffect,useMemo:f=>f(),useCallback:f=>f,useScenario:()=>({timeUnit:'min',mode:{},primaryAxisLabel:'Time (min)'}),MODELS:{A:{fn:()=>5},B:{fn:()=>5.5}}};
  const build=new Function(...Object.keys(scope),head+'return {handleTimeChange,timeStr,logNStr};} return KineticPredictor;')(...Object.values(scope));
  let prediction=null;
  let props={datasets:[{id:'a',name:'A',data:[{t:1}]}],selectedModels:['A','B'],fitResults:{a_A:{params:{x:1}},a_B:{params:{x:1}}},onPrediction:p=>prediction=p};
  const render=()=>{cursor=0;const result=build(props);const pending=effects;effects=[];pending.forEach(f=>f());return result;};
  render().handleTimeChange({target:{value:'1'}});assert.equal(prediction.logN,5);
  props={...props,selectedModels:['B']};render();
  assert.equal(prediction,null);
  assert.equal(render().logNStr,'');
});

test('DataInput unit switches convert pending input and reject invalid dose transitions atomically', async () => {
  const axis = await import('../src/utils/axisState.js');
  const source=fs.readFileSync(new URL('../src/components/DataInput.jsx',import.meta.url),'utf8');
  const ast=parse(source,{sourceType:'module',plugins:['jsx']});
  const fn=ast.program.body.find(n=>n.type==='ExportDefaultDeclaration').declaration;
  const end=fn.body.body.find(n=>n.type==='ReturnStatement').start;
  const head=source.slice(fn.start,end).replace('export default ','');
  let context={scenario:'pef',primaryFactorKey:'electricField',visibleFactorKeys:[],useDoseAxis:false,timeUnit:'ms',mode:{timeUnitOptions:[{key:'ms',toMin:1/60000},{key:'μs',toMin:1/60000000}]}};
  context.setTimeUnit=v=>{context.timeUnit=v};context.setUseDoseAxis=v=>{context.useDoseAxis=v};
  const slots=[];let cursor=0;
  const useState=initial=>{const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],v=>slots[i]=typeof v==='function'?v(slots[i]):v];};
  const scope={...paste,...axis,useState,useRef:v=>useState({current:v})[0],useEffect:f=>f(),useCallback:f=>f,useScenario:()=>context,FACTOR_DEFS:[]};
  const build=new Function(...Object.keys(scope),head+'return {changeAxis,setPasteText,pasteText,error};} return DataInput;')(...Object.values(scope));
  let datasets=[{id:'a',data:[{t:2,logN:6}],conditions:{}}];
  const props=()=>({datasets,setDatasets:v=>{datasets=v},activeDatasetId:'a'});
  const render=()=>{cursor=0;return build(props());};
  render().setPasteText('time,rep1\n2,6');
  render().changeAxis({useDoseAxis:false,timeUnit:'μs'});
  assert.equal(datasets[0].data[0].t,2000);
  assert.equal(context.timeUnit,'μs');
  assert.equal(render().pasteText,'Time (μs),rep1\n2000,6');
  context={...context,scenario:'photoinactivation',timeUnit:'min',mode:{doseAxis:{factor:'intensity',label:'Fluence',unit:'J/cm²'}}};
  render().setPasteText('');
  const before=datasets;
  render().changeAxis({useDoseAxis:true,timeUnit:'min'});
  assert.equal(datasets,before);
  assert.equal(context.useDoseAxis,false);
  assert.match(render().error,/positive intensity/);
});

test('App state and secondary remount regressions remain asserted', async () => {
  await import('../reports/recheck_ui_repro_2026-10-09.mjs');
});

test('cached secondary time scales and rates convert while dose transitions reject without erasing inputs', async () => {
  const axis=await import('../src/utils/axisState.js');
  assert.equal(typeof axis.convertSecondaryAxisState,'function');
  const { MODELS }=await import('../src/models/inactivationModels.js');
  const pef={timeUnitOptions:[{key:'ms',toMin:1/60000},{key:'μs',toMin:1/60000000}]};
  const saved={primaryModelId:'SHOULDER_TAIL',manualDEntries:[{D:2,factors:{electricField:30}}],manualParams:{logN0:7,kmax:.5,Sl:3,logNres:1},secondaryParams:{LINEAR_PEF_Eref:30},bindings:{kmax:'LINEAR_PEF_D'}};
  const next=axis.convertSecondaryAxisState(pef,saved,{useDoseAxis:false,timeUnit:'ms'},{useDoseAxis:false,timeUnit:'μs'},MODELS);
  assert.equal(next.manualDEntries[0].D,2000);
  assert.equal(next.manualParams.kmax,.0005);
  assert.equal(next.manualParams.Sl,3000);
  assert.equal(next.manualParams.logN0,7);
  assert.deepEqual(next.secondaryParams,saved.secondaryParams);
  assert.throws(()=>axis.convertSecondaryAxisState({doseAxis:{factor:'intensity'}},saved,{useDoseAxis:false},{useDoseAxis:true},MODELS), /secondary inputs/i);
  assert.equal(saved.manualDEntries[0].D,2);
});
