import assert from 'node:assert/strict';
import { test } from 'node:test';
const unitFitter=await import('../src/utils/unitFitting.js').catch(()=>({}));
import { MODELS } from '../src/models/inactivationModels.js';
import { fitModelMultiStart } from '../src/models/fitter.js';
import { getExampleCase } from '../src/config/exampleDatasets.js';

const near=(actual,expected,rtol=1e-7)=>assert.ok(Math.abs(actual-expected)<=rtol*Math.max(1e-12,Math.abs(expected)),`${actual} != ${expected}`);
const multipliers={min:1,ms:60000,'μs':60000000};

// Keep the former incorrect built-in sample only as an explicit numerical
// stress fixture. It is not the author-confirmed N5-Sa source dataset.
const incompleteStressData = [[15.7,5.3],[30.2,4.5],[76.1,3.8],[151.1,3.6],[300,3.3],[500.4,2.9]]
  .map(([t,logN])=>({t,logN}));

test('microsecond Weibull kinetics recover a 20 μs scale without a minute-axis floor',()=> {
  const data=Array.from({length:15},(_,i)=>({t:i*10,logN:MODELS.WEIBULL.fn(i*10,{logN0:7,delta:20,p:.8})+.005*Math.sin(i)}));
  const result=unitFitter.fitPrimaryInTimeUnit('WEIBULL',data,{timeUnitToMin:1/60000000});
  assert.ok(result.converged);
  assert.ok(result.rmse<.005,`fast Weibull RMSE=${result.rmse}`);
  near(result.params.delta,20,.005);
  assert.ok(!result.boundaryWarnings.some(warning=>warning.paramName==='delta'));
  assert.ok(result.covMatrix?.every(row=>row.every(Number.isFinite)));
});

test('a fast Weibull scale is not clipped even when the observation window exceeds .1 min',()=> {
  const data=[0,1e-4,3e-4,.001,.01,.1,.2].map((t,i)=>({t,logN:MODELS.WEIBULL.fn(t,{logN0:7,delta:2e-4,p:.15})+.002*Math.sin(i)}));
  const result=unitFitter.fitPrimaryInTimeUnit('WEIBULL',data);
  assert.ok(result.converged);
  assert.ok(result.rmse<.002,`RMSE=${result.rmse}`);
  near(result.params.delta,2e-4,.01);
});

for(const dataset of getExampleCase('paper-n5-primary-time-us').datasets) {
  test(`${dataset.id} real PEF Weibull fit is not clipped at 60000 μs`,()=> {
    const result=unitFitter.fitPrimaryInTimeUnit('WEIBULL',dataset.data,{timeUnitToMin:1/60000000});
    assert.ok(result.converged);
    assert.ok(result.rmse<.2,`${dataset.id} RMSE=${result.rmse}`);
    assert.ok(result.params.delta>0&&result.params.delta<60000,`${dataset.id} δ=${result.params.delta} μs`);
    assert.ok(!result.boundaryWarnings.some(warning=>warning.paramName==='delta'&&warning.boundValue===60000));
  });
}

test('an incomplete stress curve reports its shape boundary and does not return underflowed covariance as certainty',()=> {
  const result=unitFitter.fitPrimaryInTimeUnit('WEIBULL',incompleteStressData,{timeUnitToMin:1/60000000});
  assert.ok(result.boundaryWarnings.some(warning=>warning.paramName==='p'&&warning.bound==='min'));
  assert.ok(result.paramErrors.logN0>result.params.logN0);
  assert.equal(result.covMatrix,null);
  assert.match(result.covarianceWarning,/represent|underflow/i);
  assert.ok(Object.values(result.paramCI95).flat().every(Number.isFinite));
  for(const scale of [1/60000000,.001]) {
    const other=unitFitter.fitPrimaryInTimeUnit('WEIBULL',incompleteStressData.map(row=>({...row,t:row.t*scale})),{timeUnitToMin:1/60000000/scale});
    near(other.rmse,result.rmse);
    near(other.params.delta/(result.params.delta*scale),1,1e-7);
    near(other.paramErrors.delta/(result.paramErrors.delta*scale),1,1e-5);
    assert.equal(other.covMatrix,null);
    assert.deepEqual(other.boundaryWarnings,result.boundaryWarnings);
  }
});

test('an incomplete stress curve retains its profiled boundary seed with empty or explicit custom starts',()=> {
  const data=incompleteStressData;
  const baseline=unitFitter.fitPrimaryInTimeUnit('WEIBULL',data,{timeUnitToMin:1/60000000});
  for(const customInit of [{},{logN0:5.3,delta:40,p:.36}]) {
    const result=unitFitter.fitPrimaryInTimeUnit('WEIBULL',data,{timeUnitToMin:1/60000000,customInit});
    assert.ok(result.converged,`custom start ${JSON.stringify(customInit)} did not converge`);
    near(result.sse,baseline.sse);
    assert.equal(result.params.p,baseline.params.p);
    assert.deepEqual(result.boundaryWarnings,baseline.boundaryWarnings);
    assert.equal(result.covMatrix,null);
  }
});

for(const [modelId,model] of Object.entries(MODELS)) {
  test(`${modelId} supports stable PEF fits and uncertainty in min/ms/μs while retaining its thermal fit`,()=> {
    const metadata=JSON.stringify(model.params);
    const params=Object.fromEntries(model.params.map(param=>[param.name,param.defaultValue]));
    const thermal=Array.from({length:21},(_,i)=>({t:i/2,logN:model.fn(i/2,params)+.005*Math.sin(i)}));
    const expected=fitModelMultiStart(modelId,thermal);
    const unchanged=unitFitter.fitPrimaryInTimeUnit(modelId,thermal);
    for(const field of ['params','initialParams','paramErrors','paramCI95','covMatrix','sse','rmse','converged','boundaryWarnings']) assert.deepEqual(unchanged[field],expected[field]);
    const data=thermal.map(row=>({...row,t:row.t*20}));
    const baseline=unitFitter.fitPrimaryInTimeUnit(modelId,data,{timeUnitToMin:1/60000000});
    assert.ok(baseline.converged,`${modelId} did not converge`);
    assert.ok(baseline.rmse<.006);
    for(const [unit,scale] of [['min',1/60000000],['ms',.001]]) {
      const result=unitFitter.fitPrimaryInTimeUnit(modelId,data.map(row=>({...row,t:row.t*scale})),{timeUnitToMin:1/60000000/scale});
      near(result.sse,baseline.sse,1e-5);
      for(const row of data) near(model.fn(row.t*scale,result.params),model.fn(row.t,baseline.params),1e-6);
      const factor=name=> {const role=model.params.find(param=>param.name===name).role;return role==='rate'?1/scale:['time','timeScale'].includes(role)?scale:1;};
      for(const def of model.params) {
        near(result.params[def.name],baseline.params[def.name]*factor(def.name),1e-3);
        if(baseline.paramErrors[def.name]!=null) near(result.paramErrors[def.name],baseline.paramErrors[def.name]*factor(def.name),1e-3);
        baseline.paramCI95[def.name]?.forEach((value,i)=>near(result.paramCI95[def.name][i],value*factor(def.name),1e-3));
      }
      baseline.covMatrix?.forEach((row,i)=>row.forEach((value,j)=>near(result.covMatrix[i][j],value*factor(result.paramNames[i])*factor(result.paramNames[j]),1e-3)));
      // Optimized residual trends can be essentially zero; compare their
      // absolute slopes on the common μs axis rather than relative zero error.
      assert.ok(Math.abs(result.resTrendSlope*scale-baseline.resTrendSlope)<1e-10);
      assert.equal(result.converged,baseline.converged,unit);
    }
    assert.equal(JSON.stringify(model.params),metadata,'fitting must not mutate global model metadata');
  });
}

test('fast-axis custom initialization and invalid-prediction diagnostics preserve their units',()=> {
  const data=Array.from({length:12},(_,i)=>({t:i*5,logN:7-.03*i*5/Math.LN10+.002*Math.sin(i)}));
  const result=unitFitter.fitPrimaryInTimeUnit('LOG_LINEAR',data,{timeUnitToMin:1/60000000,customInit:{logN0:7,kmax:.03}});
  near(result.initialParams.kmax,.03);
  const invalid=unitFitter.fitPrimaryInTimeUnit('LOG_LINEAR',data.map((row,i)=>i===0?{...row,logN:NaN}:row),{timeUnitToMin:1/60000000});
  assert.ok(invalid.failed);
  assert.equal(invalid.converged,false);
  assert.equal(invalid.aiccValid,false);
  assert.equal(invalid.covMatrix,null);
});

test('primary unit wrapper exists without changing default fitter APIs',()=> {
  assert.equal(typeof unitFitter.fitPrimaryInTimeUnit,'function');
});

for (const [modelId,params] of [['LOG_LINEAR',{logN0:7,kmax:.5}],['WEIBULL',{logN0:7,delta:4,p:1.2}]]) {
  test(`${modelId} fitted physical curve and uncertainty agree in min/ms/μs`,()=> {
    const data=Array.from({length:15},(_,i)=>({t:i*.5,logN:MODELS[modelId].fn(i*.5,params)+.012*Math.sin(i*1.8)}));
    const baseline=fitModelMultiStart(modelId,data);
    assert.equal(baseline.failed,false);
    for (const [unit,scale] of Object.entries(multipliers)) {
      const result=unitFitter.fitPrimaryInTimeUnit(modelId,data.map(row=>({...row,t:row.t*scale})),{timeUnitToMin:1/scale});
      for(const field of ['sse','rmse','r2','r2adj','aicc','mse','residualSE','normalityPValue','runsTestP']) near(result[field],baseline[field],1e-4);
      for (const row of data) near(MODELS[modelId].fn(row.t*scale,result.params),MODELS[modelId].fn(row.t,baseline.params));
      for (const def of MODELS[modelId].params) {
        const factor=def.role==='rate'?1/scale:['time','timeScale'].includes(def.role)?scale:1;
        near(result.params[def.name],baseline.params[def.name]*factor);
        near(result.initialParams[def.name],baseline.initialParams[def.name]*factor);
        if(baseline.paramErrors[def.name]!=null) near(result.paramErrors[def.name],baseline.paramErrors[def.name]*factor);
        if(baseline.paramCI95[def.name]) baseline.paramCI95[def.name].forEach((value,i)=>near(result.paramCI95[def.name][i],value*factor));
      }
      baseline.covMatrix?.forEach((row,i)=>row.forEach((value,j)=> {
        const roleFactor=name=> {const role=MODELS[modelId].params.find(p=>p.name===name).role;return role==='rate'?1/scale:['time','timeScale'].includes(role)?scale:1;};
        near(result.covMatrix[i][j],value*roleFactor(result.paramNames[i])*roleFactor(result.paramNames[j]),1e-4);
      }));
      near(result.resTrendSlope,baseline.resTrendSlope/scale,1e-4);
      assert.equal(result.converged,baseline.converged);
      assert.equal(result.timeUnitToMin,1/scale);
      assert.equal(unitFitter.fitPrimaryInTimeUnit(modelId,data,{timeUnitToMin:1}).params[Object.keys(params)[0]],baseline.params[Object.keys(params)[0]]);
      assert.ok(unit);
    }
  });
}

test('fast PEF rate converts below the legacy .001 displayed bound without refitting it',()=> {
  const data=Array.from({length:12},(_,i)=>({t:i*.5,logN:7-.5*i*.5/Math.LN10+.001*Math.sin(i)}));
  const ms=unitFitter.fitPrimaryInTimeUnit('LOG_LINEAR',data,{timeUnitToMin:1/60000});
  const us=unitFitter.fitPrimaryInTimeUnit('LOG_LINEAR',data.map(row=>({...row,t:row.t*1000})),{timeUnitToMin:1/60000000});
  near(us.params.kmax,ms.params.kmax/1000);
  assert.ok(us.params.kmax<.001);
  near(MODELS.LOG_LINEAR.fn(1000,us.params),MODELS.LOG_LINEAR.fn(1,ms.params));
});

test('displayed custom initialization, boundary diagnostics, and residual trends scale with the time axis',()=> {
  const data=Array.from({length:14},(_,i)=>({t:i*2,logN:7-.001*i*2/Math.LN10+.0001*Math.cos(i)}));
  const minute=unitFitter.fitPrimaryInTimeUnit('LOG_LINEAR',data,{customInit:{logN0:7,kmax:.001}});
  const scale=60000;
  const displayed=unitFitter.fitPrimaryInTimeUnit('LOG_LINEAR',data.map(row=>({...row,t:row.t*scale})),{timeUnitToMin:1/scale,customInit:{logN0:7,kmax:.001/scale}});
  near(displayed.params.kmax,minute.params.kmax/scale);
  near(displayed.initialParams.kmax,.001/scale);
  for(let i=0;i<minute.boundaryWarnings.length;i++) {
    const warning=minute.boundaryWarnings[i],other=displayed.boundaryWarnings[i];
    const factor=warning.paramName==='kmax'?1/scale:1;
    near(other.boundValue,warning.boundValue*factor);
    near(other.paramValue,warning.paramValue*factor);
  }
  near(displayed.resTrendSlope,minute.resTrendSlope/scale,1e-4);
  assert.throws(()=>unitFitter.fitPrimaryInTimeUnit('LOG_LINEAR',data,{timeUnitToMin:0}),/positive/);
});
