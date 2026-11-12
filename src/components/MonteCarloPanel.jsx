import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useScenario } from '../ScenarioContext';
import {
  ComposedChart, Area, Line, ReferenceLine, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, BarChart, Bar, Cell,
} from 'recharts';
import { startAnalysisTask } from '../utils/analysisWorkerClient.js';
import { MODELS } from '../models/inactivationModels.js';
import { FACTOR_DEFS, predictPrimaryParams } from '../models/secondaryModels.js';
import SensitivityPanel from './SensitivityPanel.jsx';
import { generateRandomSeed } from '../utils/random.js';

const DEFAULT_SAMPLES = 10000;
const MAX_SAMPLES = 50000;
const MIN_RECOMMENDED_99 = 10000;
const T_POINTS = 200;

function buildTArray(tMax) {
  return Array.from({ length: T_POINTS }, (_, i) => (i / (T_POINTS - 1)) * tMax);
}

function buildHistogramBins(samples, bins = 30) {
  if (samples.length === 0) return [];
  const sorted = samples.slice().sort((a, b) => a - b);
  const lo = Math.floor(sorted.length * 0.005);
  const hi = Math.ceil(sorted.length * 0.995) - 1;
  const trimmed = sorted.slice(lo, hi + 1);
  if (trimmed.length === 0) return [];
  const min = trimmed[0];
  const max = trimmed[trimmed.length - 1];
  if (min === max) return [{ x: min.toFixed(3), count: trimmed.length }];
  const width = (max - min) / bins;
  const counts = new Array(bins).fill(0);
  trimmed.forEach((v) => {
    const idx = Math.min(Math.floor((v - min) / width), bins - 1);
    counts[idx]++;
  });
  return counts.map((count, i) => ({
    x: parseFloat((min + (i + 0.5) * width).toFixed(3)),
    count,
  }));
}

function transformBands(bands) {
  return bands.map((b) => ({
    t: b.t,
    band95: b.p5 != null ? [b.p5, b.p95] : null,
    band50: b.p25 != null ? [b.p25, b.p75] : null,
    p50: b.p50,
  }));
}

function triggerDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadCsvFile(fileName, lines) {
  const csv = lines.map(r => r.map(value => {
    const text = String(value ?? '');
    return /[,"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }).join(',')).join('\n');
  triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8' }), fileName);
}

function downloadJsonFile(fileName, value) {
  const json = JSON.stringify(value, null, 2);
  triggerDownload(new Blob([json], { type: 'application/json;charset=utf-8' }), fileName);
}

const DEFAULT_FACTOR_SDS = { temp: 1.0, pressure: 10, aw: 0.01 };

function factorSigmaSubscript(factorDef) {
  if (factorDef.key === 'aw') return 'aw';
  return String(factorDef.shortLabel ?? factorDef.key).replace(/_/g, '');
}

export default function MonteCarloPanel({
  predictedParams, primaryFit, modelId, tMax, factorValues,
  visibleFactorKeys, bindings, fittedSecondaryModels, manualParams,
}) {
  const { timeUnit, mode, useDoseAxis, primaryAxisLabel, timeUnitToMin } = useScenario();
  const inputUnit = useDoseAxis ? mode?.doseAxis?.unit : timeUnit;
  const inputLabel = primaryAxisLabel ?? `Time (${timeUnit})`;
  const [nSamples, setNSamples] = useState(DEFAULT_SAMPLES);
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState(null);
  const [sliderIndex, setSliderIndex] = useState(T_POINTS - 1);
  const [targetReduction, setTargetReduction] = useState(5.0);
  const [confidenceLevel, setConfidenceLevel] = useState(0.99);
  const [randomSeed, setRandomSeed] = useState('20260430');
  const [factorSDs, setFactorSDs] = useState(() => ({ ...DEFAULT_FACTOR_SDS }));
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [covTooltipVisible, setCovTooltipVisible] = useState(false);

  const simulationJobRef = useRef(null);
  useEffect(() => () => {
    simulationJobRef.current?.cancel();
    simulationJobRef.current = null;
  }, []);

  const sensitivityModelFn = useCallback((t, p) => MODELS[modelId]?.fn(t, p), [modelId]);
  const predictParamsFnFactory = useCallback((overriddenFitted) => (factors) => predictPrimaryParams({
    primaryModelId: modelId, primaryFactorKey: mode?.primaryFactor,
    bindings, fittedSecondaryModels: overriddenFitted, manualParams, factors,
  }), [modelId, mode?.primaryFactor, bindings, manualParams]);
  const predictParamsFn = useMemo(() => (
    visibleFactorKeys?.length > 0 && bindings && fittedSecondaryModels
      ? predictParamsFnFactory(fittedSecondaryModels) : null
  ), [visibleFactorKeys, bindings, fittedSecondaryModels, predictParamsFnFactory]);
  const analysisConfig = useMemo(() => ({
    modelId, primaryFactorKey: mode?.primaryFactor, bindings, fittedSecondaryModels,
    manualParams, factorValues, factorKeys: visibleFactorKeys, nominalParams: predictedParams,
  }), [modelId, mode?.primaryFactor, bindings, fittedSecondaryModels, manualParams,
      factorValues, visibleFactorKeys, predictedParams]);

  const handleGenerateSeed = useCallback(() => {
    setRandomSeed(generateRandomSeed());
  }, []);

  // Factor definitions for visible factors
  const factorDefs = useMemo(() => {
    if (!visibleFactorKeys) return [];
    return visibleFactorKeys
      .map(key => FACTOR_DEFS.find(f => f.key === key))
      .filter(Boolean);
  }, [visibleFactorKeys]);

  const effectiveTMax = tMax ?? 10;
  const currentKey = useMemo(() => JSON.stringify({
    useDoseAxis, primaryAxisLabel, predictedParams, primaryFit, modelId, tMax: effectiveTMax, factorValues,
    visibleFactorKeys, bindings, fittedSecondaryModels, manualParams,
    factorSDs, nSamples, randomSeed, timeUnit, modeId: mode?.id,
  }), [useDoseAxis, primaryAxisLabel, predictedParams, primaryFit, modelId, effectiveTMax, factorValues,
    visibleFactorKeys, bindings, fittedSecondaryModels, manualParams,
    factorSDs, nSamples, randomSeed, timeUnit, mode?.id]);
  const stale = !!result && result.inputSignature !== currentKey;
  const sliderTime = result?.tArray?.[sliderIndex] ?? 0;

  // Derive effectiveTargetLogN from logN0 and targetReduction
  const logN0 = result?.runMetadata?.predictedParams?.logN0 ?? predictedParams?.logN0 ?? primaryFit?.params?.logN0 ?? 7;
  const effectiveTargetLogN = logN0 - targetReduction;
  const sampleTargets = useMemo(() => {
    if (!result) return [];
    const initial = result.initialLogNSamples ?? result.allSamples?.[0] ?? [];
    return initial.map(value => value - targetReduction);
  }, [result, targetReduction]);

  const sliceSamples = useMemo(() => {
    if (!result?.allSamples) return [];
    return result.allSamples[sliderIndex] ?? [];
  }, [result, sliderIndex]);

  const histogramData = useMemo(() => buildHistogramBins(sliceSamples.map((value, i) => (sampleTargets[i] + targetReduction) - value)), [sliceSamples, sampleTargets, targetReduction]);

  const successCount = useMemo(() => sliceSamples.filter((v, i) => v <= sampleTargets[i] + 1e-10).length, [sliceSamples, sampleTargets]);
  const successRate = sliceSamples.length > 0 ? (successCount / sliceSamples.length) * 100 : 0;

  // Target Inversion: compute suggested safe time from MC curves
  const safeTimeResult = useMemo(() => {
    if (!result?.allSamples) return null;
    const tArr = result.allSamples; // tArr[timeIdx][sampleIdx]
    const nTimePoints = tArr.length;
    const nSamp = tArr[0]?.length ?? 0;
    if (nSamp === 0) return null;

    // Find the first saved time reaching each curve's reduction target.
    const hitTimes = new Array(nSamp);
    for (let s = 0; s < nSamp; s++) {
      let hitIdx = -1;
      for (let ti = 0; ti < nTimePoints; ti++) {
        if (tArr[ti][s] <= sampleTargets[s] + 1e-10) { hitIdx = ti; break; }
      }
      hitTimes[s] = hitIdx >= 0
        ? result.tArray[hitIdx]
        : Infinity;
    }

    // Sort ascending and pick quantile
    hitTimes.sort((a, b) => a - b);
    const qIdx = Math.min(Math.ceil(confidenceLevel * nSamp) - 1, nSamp - 1);
    const safeTime = hitTimes[qIdx];
    const allReached = Number.isFinite(safeTime);

    return { safeTime: allReached ? safeTime : null, allReached };
  }, [result, sampleTargets, confidenceLevel]);

  // Safe-time stability: compute safe time at checkpoints to measure convergence
  const safeTimeStability = useMemo(() => {
    if (!result?.allSamples || !result.convergence?.checkpoints) return null;
    const nTime = result.allSamples.length;
    const checkpoints = result.convergence.checkpoints;
    if (checkpoints.length < 2) return null;

    const computeSafeTimeForN = (nSamp) => {
      const hitTimes = new Array(nSamp);
      for (let s = 0; s < nSamp; s++) {
        let hitIdx = -1;
        for (let ti = 0; ti < nTime; ti++) {
          if (result.allSamples[ti]?.[s] <= sampleTargets[s] + 1e-10) { hitIdx = ti; break; }
        }
        hitTimes[s] = hitIdx >= 0 ? result.tArray[hitIdx] : Infinity;
      }
      hitTimes.sort((a, b) => a - b);
      const qIdx = Math.min(Math.ceil(confidenceLevel * nSamp) - 1, nSamp - 1);
      return hitTimes[qIdx];
    };

    const prev = checkpoints[checkpoints.length - 2];
    const last = checkpoints[checkpoints.length - 1];
    const stPrev = computeSafeTimeForN(prev.n);
    const stLast = computeSafeTimeForN(last.n);
    if (!Number.isFinite(stLast) || !Number.isFinite(stPrev)) return null;
    const recentChange = Math.abs(stLast - stPrev);

    let level;
    const recentChangeMinutes = recentChange * (mode?.timeUnitOptions?.find(option => option.key === timeUnit)?.toMin ?? 1);
    if (recentChangeMinutes <= 0.2) level = 'stable';
    else if (recentChangeMinutes <= 0.5) level = 'moderate';
    else level = 'exploratory';

    return { recentChange, level, pair: [prev.n, last.n] };
  }, [result, sampleTargets, confidenceLevel, mode, timeUnit]);

  // Combined convergence level: most conservative of q99 and safe-time
  const combinedConvergence = useMemo(() => {
    const conv = result?.convergence;
    if (!conv?.level) return null;
    const rank = { stable: 0, moderate: 1, exploratory: 2 };
    let level = conv.level;
    if (safeTimeStability?.level && rank[safeTimeStability.level] > rank[level]) {
      level = safeTimeStability.level;
    }
    return { ...conv, level, safeTimeStability };
  }, [result?.convergence, safeTimeStability]);

  // Run simulation on button click
  const handleRun = useCallback(async () => {
    if (!predictedParams || !modelId) return;
    const model = MODELS[modelId];
    if (!model) return;
    const paramNames = model.params.map((p) => p.name);
    if (paramNames.some((name) => predictedParams[name] == null)) return;

    setRunError(null);
    setRunning(true);
    let job;
    try {
      const tArray = buildTArray(effectiveTMax);
      const effectiveNSamples = Math.min(Math.max(1, nSamples), MAX_SAMPLES);
      const seedText = String(randomSeed ?? '').trim();
      const runSeed = seedText || generateRandomSeed();
      simulationJobRef.current?.cancel();
      job = startAnalysisTask('monteCarlo', {
        ...analysisConfig, predictedParams, primaryFit, tArray,
        nSamples: effectiveNSamples, factorSDs, seed: runSeed,
      });
      simulationJobRef.current = job;
      const mcResult = await job.promise;
      if (simulationJobRef.current !== job) return;

      if (mcResult.finalLogNSamples.length === 0) {
        setRunError('No valid simulation curves were produced. Check the model parameters and uncertainty inputs.');
      }
      setResult({
        ...mcResult,
        tArray: [...tArray],
        inputSignature: currentKey,
        inputSnapshot: JSON.parse(currentKey),
        chartData: transformBands(mcResult.bands),
        runMetadata: {
          modeId: mode?.id,
          timeUnit,
          tMax: effectiveTMax,
          visibleFactorKeys,
          bindings,
          fittedSecondaryModels,
          manualParams,
          seed: runSeed,
          seedMode: seedText ? 'fixed' : 'auto-generated',
          nSamples: effectiveNSamples,
          modelId,
          modelName: model.name,
          targetReduction,
          nominalEndpointLogN: effectiveTargetLogN,
          targetCriterion: 'Each curve initial log10(N) minus target reduction',
          confidenceLevel,
          factorValues,
          factorSDs,
          predictedParams,
          primaryFit: primaryFit ? {
            modelId: primaryFit.modelId,
            datasetId: primaryFit.datasetId,
            params: primaryFit.params,
            rmse: primaryFit.rmse,
            aicc: primaryFit.aicc,
            r2adj: primaryFit.r2adj,
            covMatrix: primaryFit.covMatrix,
            mse: primaryFit.mse,
            paramNames: primaryFit.paramNames,
            covarianceAvailable: !!primaryFit.covMatrix,
          } : null,
          timestamp: new Date().toISOString(),
        },
      });
      setSliderIndex(T_POINTS - 1);
    } catch (err) {
      if (err.name !== 'AbortError' && (!job || simulationJobRef.current === job)) {
        setRunError(err.message || 'Simulation failed.');
        console.error('Simulation Error:', err);
      }
    } finally {
      if (!job || simulationJobRef.current === job) {
        simulationJobRef.current = null;
        setRunning(false);
      }
    }
  }, [predictedParams, primaryFit, modelId, nSamples, effectiveTMax, currentKey, randomSeed,
      targetReduction, effectiveTargetLogN, confidenceLevel,
      visibleFactorKeys, factorValues, factorSDs, bindings, fittedSecondaryModels, manualParams, mode, timeUnit, analysisConfig]);

  const handleExportCsv = useCallback(() => {
    if (!result || stale) return;
    const model = MODELS[modelId];
    const lines = [
      ['Risk Assessment Report'],
      ['Model', model?.name ?? modelId],
      ['Valid simulations', String(result.finalLogNSamples.length)],
      ['Rejected simulations', String(result.rejectedSamples ?? 0)],
      ['Analysis Time', sliderTime.toFixed(2)],
      ['Target log reduction', targetReduction.toFixed(2)],
      ['Nominal endpoint log10(N)', effectiveTargetLogN.toFixed(2)],
      ['Target criterion', 'Each curve initial log10(N) minus target reduction'],
      ['Input axis', inputLabel],
      ['Success Count', String(successCount)],
      ['Total Samples', String(sliceSamples.length)],
      ['Success Rate (%)', successRate.toFixed(1)],
      [],
      ['--- Percentile Bands ---'],
      ['Time', 'P5', 'P25', 'P50 (Median)', 'P75', 'P95'],
      ...result.bands.map((b) => [
        b.t.toFixed(3),
        b.p5 != null ? b.p5.toFixed(4) : '',
        b.p25 != null ? b.p25.toFixed(4) : '',
        b.p50 != null ? b.p50.toFixed(4) : '',
        b.p75 != null ? b.p75.toFixed(4) : '',
        b.p95 != null ? b.p95.toFixed(4) : '',
      ]),
      [],
      [`--- Histogram at t=${sliderTime.toFixed(2)} ---`],
      ['Bin Center (log reduction)', 'Count'],
      ...histogramData.map((b) => [String(b.x), String(b.count)]),
    ];
    downloadCsvFile(`RiskAssessment_${model?.name ?? modelId}.csv`, lines);
  }, [result, stale, modelId, sliderTime, targetReduction, effectiveTargetLogN, successCount, sliceSamples.length, successRate, histogramData, inputLabel]);

  const handleExportJson = useCallback(() => {
    if (!result || stale) return;
    const model = MODELS[modelId];
    const report = {
      reportType: 'MicroFit Pro Monte Carlo Analysis',
      appVersion: '0.1.0',
      metadata: result.runMetadata,
      simulationInputs: result.inputSnapshot,
      tArray: result.tArray,
      summary: {
        covarianceMode: result.covarianceMode,
        rejectedSamples: result.rejectedSamples ?? 0,
        sampleCount: result.finalLogNSamples?.length ?? 0,
        analysisTime: sliderTime,
        targetLogReduction: targetReduction,
        nominalEndpointLogN: effectiveTargetLogN,
            targetCriterion: 'Each curve initial log10(N) minus target reduction',
        successCount,
        totalSamples: sliceSamples.length,
        successRatePercent: successRate,
        suggestedSafeTime: safeTimeResult,
        convergence: combinedConvergence,
      },
      model: {
        id: modelId,
        name: model?.name,
        predictedParams,
        manualParams,
        bindings,
      },
      inputs: {
        factorValues,
        factorSDs,
        visibleFactorKeys,
        timeUnit,
        tMax: effectiveTMax,
      },
      percentileBands: result.bands,
      histogramAtSelectedTime: histogramData,
    };
    downloadJsonFile(`MicroFit_Report_${model?.name ?? modelId}.json`, report);
  }, [result, stale, modelId, sliderTime, targetReduction, effectiveTargetLogN, successCount,
      sliceSamples.length, successRate, safeTimeResult, combinedConvergence, predictedParams,
      manualParams, bindings, factorValues, factorSDs, visibleFactorKeys, timeUnit,
      effectiveTMax, histogramData]);

  const hasMC = !!result && !stale && result.finalLogNSamples.length > 0;

  return (
    <div className="mc-panel">
      {/* Settings row + Run button */}
      <div className="mc-settings-row">
        <label className="mc-label">
          Samples
          <input
            type="number"
            className="mc-input"
            value={nSamples}
            min={100}
            max={MAX_SAMPLES}
            step={100}
            onChange={(e) => setNSamples(Math.min(MAX_SAMPLES, Math.max(1, parseInt(e.target.value) || DEFAULT_SAMPLES)))}
          />
          <span style={{fontSize:'0.82em',color:'#6b7280',marginLeft:4}}>
            (10,000 default; check tail stability across sizes/seeds)
          </span>
        </label>
        <label className="mc-label">
          Target log reduction
          <input
            type="number"
            className="mc-input mc-input-narrow"
            value={targetReduction}
            step={0.5}
            min={0}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (Number.isFinite(v) && v >= 0) setTargetReduction(v);
            }}
          />
          <span style={{fontSize:'0.82em',color:'#6b7280',marginLeft:4}}>
            (nominal endpoint={effectiveTargetLogN.toFixed(1)}; each curve uses its own baseline)
          </span>
        </label>
        <label className="mc-label">
          Confidence Level
          <select
            className="mc-input"
            value={confidenceLevel}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              setConfidenceLevel(v);
              if (v >= 0.999 && nSamples < 5000) setNSamples(5000);
            }}
          >
            <option value={0.95}>95%</option>
            <option value={0.99}>99%</option>
            <option value={0.999}>99.9%</option>
          </select>
        </label>
        <label className="mc-label">
          Random seed
          <span className="mc-seed-controls">
            <input
              type="text"
              className="mc-input mc-seed-input"
              value={randomSeed}
              onChange={(e) => setRandomSeed(e.target.value)}
              placeholder="blank = random"
              title="Keep a value for reproducible runs, or leave blank to auto-generate a new seed for each run."
            />
            <button
              type="button"
              className="btn-secondary mc-seed-btn"
              onClick={handleGenerateSeed}
              title="Generate and keep a new random seed"
            >
              Generate
            </button>
          </span>
        </label>
        <button
          className="btn-primary mc-run-btn"
          onClick={handleRun}
          disabled={running || !predictedParams || !modelId}
        >
          {running ? 'Simulating...' : 'Run Simulation'}
        </button>
      </div>

      {result?.runMetadata?.seed && (
        <div className="mc-seed-note">
          Last seed used: <code>{result.runMetadata.seed}</code>
          {result.runMetadata.seedMode === 'auto-generated' ? ' (auto-generated)' : ' (fixed)'}
        </div>
      )}

      {/* Factor uncertainty inputs */}
      {factorDefs.length > 0 && (
        <div className="gsa-factor-inputs">
          <span className="gsa-factor-inputs-label">Factor σ:</span>
          {factorDefs.map(fd => (
            <label key={fd.key} className="mc-label gsa-factor-sd-label">
              <span>
                σ<sub>{factorSigmaSubscript(fd)}</sub>{fd.unit ? ` (${fd.unit})` : ''}
              </span>
              <input
                type="number"
                className="mc-input mc-input-narrow"
                value={factorSDs[fd.key] ?? 0}
                min={0}
                step={fd.step ?? 1}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (Number.isFinite(v) && v >= 0) {
                    setFactorSDs(prev => ({ ...prev, [fd.key]: v }));
                  }
                }}
              />
            </label>
          ))}
        </div>
      )}

      {/* Stale params hint */}
      {stale && !running && (
        <div className="mc-stale-hint">
          Simulation inputs changed. Click Run to recalculate results.
        </div>
      )}

      {runError && <div className="mc-warning">{runError}</div>}
      {hasMC && result.rejectedSamples > 0 && (
        <div className="mc-warning">
          {result.rejectedSamples.toLocaleString()} sampled curves were rejected because the model produced nonfinite outputs. Probabilities use the remaining valid curves.
        </div>
      )}

      {/* Low sample count warning */}
      {nSamples < MIN_RECOMMENDED_99 && confidenceLevel >= 0.99 && (
        <div className="mc-warning">
          Warning: {nSamples.toLocaleString()} iterations may be insufficient for stable 99th-percentile estimates. Increase the sample size and check stability of the target quantile across sample sizes and seeds.
        </div>
      )}

      {/* Advanced diagnostics (collapsed by default) */}
      {hasMC && (
        <div className="mc-adv-diagnostics">
          <button
            className="mc-adv-toggle"
            onClick={() => setShowDiagnostics(v => !v)}
          >
            Advanced diagnostics {showDiagnostics ? '▲' : '▼'}
          </button>
          {showDiagnostics && (
            <div className="mc-adv-body">
              {result.covarianceMode && (
                <div className="mc-adv-row">
                  <span className="mc-adv-label">Covariance mode:</span>
                  <span className="mc-adv-value">
                    {result.covarianceMode === 'deterministic'
                      ? 'no primary parameter noise'
                      : result.covarianceMode === 'full'
                      ? 'full covariance'
                      : result.covarianceMode === 'diagonal_fallback'
                      ? 'diagonal approximation (fallback)'
                      : 'diagonal approximation'}
                  </span>
                  <span
                    className="mc-adv-info-icon"
                    onMouseEnter={() => setCovTooltipVisible(true)}
                    onMouseLeave={() => setCovTooltipVisible(false)}
                  >
                    ⓘ
                    {covTooltipVisible && (
                      <span className="mc-adv-tooltip">
                        Primary parameter noise comes from the supplied fit covariance. If correlations cannot be used, its diagonal variances are propagated independently. Zero or unavailable covariance adds no primary parameter noise. Fitted secondary uncertainty and the displayed factor σ are propagated separately when available.
                      </span>
                    )}
                  </span>
                </div>
              )}
              <div className="mc-adv-row">
                <span className="mc-adv-label">Samples:</span>
                <span className="mc-adv-value">{(result.finalLogNSamples?.length ?? nSamples).toLocaleString()}</span>
              </div>
              {combinedConvergence?.level && (
                <>
                  <div className="mc-adv-row">
                    <span className="mc-adv-label">Status:</span>
                    <span className={`mc-adv-value ${
                      combinedConvergence.level === 'stable' ? 'mc-adv-green'
                      : combinedConvergence.level === 'moderate' ? 'mc-adv-yellow'
                      : 'mc-adv-red'
                    }`}>
                      {combinedConvergence.level === 'stable' ? 'Stable for final reporting'
                        : combinedConvergence.level === 'moderate' ? 'Acceptable for screening; increase iterations for final reporting'
                        : 'Exploratory tail estimate; increase iterations before final use'}
                    </span>
                  </div>
                  <div className="mc-adv-row">
                    <span className="mc-adv-label">Recent q99 change:</span>
                    <span className="mc-adv-value">
                      {result.convergence.recentChange99.toFixed(3)} log units
                      ({(result.convergence.recentPair[0]/1000).toFixed(0)}k → {(result.convergence.recentPair[1]/1000).toFixed(0)}k)
                    </span>
                  </div>
                  <div className="mc-adv-row">
                    <span className="mc-adv-label">Recent q95 change:</span>
                    <span className="mc-adv-value">
                      {result.convergence.recentChange95.toFixed(3)} log units
                    </span>
                  </div>
                  {safeTimeStability && (
                    <div className="mc-adv-row">
                      <span className="mc-adv-label">Recent safe-time change:</span>
                      <span className="mc-adv-value">
                        {safeTimeStability.recentChange.toFixed(2)} {inputUnit}
                        ({(safeTimeStability.pair[0]/1000).toFixed(0)}k → {(safeTimeStability.pair[1]/1000).toFixed(0)}k)
                      </span>
                    </div>
                  )}
                  {result.convergence.earlyToFinal99 != null && (
                    <div className="mc-adv-row">
                      <span className="mc-adv-label">Early-to-final q99 change:</span>
                      <span className="mc-adv-value">
                        {result.convergence.earlyToFinal99.toFixed(3)} log units
                        ({(result.convergence.checkpoints[0].n/1000).toFixed(0)}k → {(result.convergence.recentPair[1]/1000).toFixed(0)}k)
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* MC results: cloud chart + histogram side by side */}
      {hasMC && (
        <div className="mc-bottom-section">
          {/* Success probability banner */}
          <div className={`mc-success-banner ${successRate >= 95 ? 'mc-success-pass' : successRate >= 80 ? 'mc-success-warn' : 'mc-success-fail'}`}>
            <span className="mc-success-label">Inactivation Success:</span>
            <span className="mc-success-value">{successRate.toFixed(1)}%</span>
            <span className="mc-success-detail">({successCount}/{sliceSamples.length} achieved ≥{targetReduction.toFixed(1)}-log reduction at x={sliderTime.toFixed(1)} {inputUnit})</span>
            {combinedConvergence?.level && (
              <span className={`mc-stability-badge ${
                combinedConvergence.level === 'stable' ? 'mc-conv-stable'
                : combinedConvergence.level === 'moderate' ? 'mc-conv-moderate'
                : 'mc-conv-unstable'
              }`}>
                {combinedConvergence.level === 'stable' ? 'MC stable'
                  : combinedConvergence.level === 'moderate' ? 'MC acceptable'
                  : 'MC exploratory'}
              </span>
            )}
          </div>

          {safeTimeResult && (
            <div className={`mc-safe-time-banner ${
              !safeTimeResult.allReached ? 'mc-safe-fail'
              : sliderTime >= safeTimeResult.safeTime ? 'mc-safe-pass' : 'mc-safe-warn'
            }`}>
              <span className="mc-safe-icon">
                {!safeTimeResult.allReached ? '⚠️' : sliderTime >= safeTimeResult.safeTime ? '✅' : '⚠️'}
              </span>
              <span className="mc-safe-label">Suggested Safe {useDoseAxis ? mode?.doseAxis?.label : 'Time'}:</span>
              {safeTimeResult.allReached ? (
                <>
                  <span className="mc-safe-value">{safeTimeResult.safeTime.toFixed(1)} {inputUnit}</span>
                  <span className="mc-safe-detail">
                    To ensure {(confidenceLevel * 100).toFixed(1)}% confidence under current process uncertainty, the required {useDoseAxis ? mode?.doseAxis?.label?.toLowerCase() : 'treatment time'} is at least {safeTimeResult.safeTime.toFixed(1)} {inputUnit}.
                  </span>
                </>
              ) : (
                <span className="mc-safe-detail">
                  Target not reachable within the simulated input range.
                </span>
              )}
            </div>
          )}

          <div className="mc-slider-row">
            <label className="mc-label">
              Analysis {inputLabel}
              <input
                type="range"
                className="mc-slider"
                min={0}
                max={T_POINTS - 1}
                step={1}
                value={sliderIndex}
                onChange={(e) => setSliderIndex(Number(e.target.value))}
              />
              <span className="mc-slider-value">{sliderTime.toFixed(1)}</span>
            </label>
          </div>

          {/* Side-by-side: cloud chart + histogram */}
          <div className="mc-charts-row">
            {/* Left: Uncertainty Cloud */}
            <div className="mc-chart-half">
              <div className="mc-chart-title">Uncertainty Cloud</div>
              <ResponsiveContainer width="100%" height={320}>
                <ComposedChart
                  data={result.chartData}
                  margin={{ top: 16, right: 24, bottom: 44, left: 8 }}
                >
                  <CartesianGrid strokeDasharray="2 4" stroke="#d9e2f2" vertical={false} />
                  <XAxis
                    dataKey="t"
                    type="number"
                    domain={[0, 'auto']}
                    tickFormatter={(v) => v.toFixed(1)}
                    label={{ value: inputLabel, position: 'insideBottom', offset: -10, style: { fontSize: 14, fill: '#334155' } }}
                    tick={{ fontSize: 14, fill: '#475569' }}
                  />
                  <YAxis
                    width={64}
                    label={{ value: 'log₁₀(N)', angle: -90, position: 'insideLeft', style: { fontSize: 14, fill: '#334155' } }}
                    tick={{ fontSize: 14, fill: '#475569' }}
                  />
                  <Tooltip
                    formatter={(v, name) => {
                      if (Array.isArray(v)) return [`[${v[0].toFixed(3)}, ${v[1].toFixed(3)}]`, name];
                      return [v?.toFixed(3), name];
                    }}
                    labelFormatter={(l) => `t = ${parseFloat(l).toFixed(2)}`}
                  />
                  <Legend verticalAlign="bottom" wrapperStyle={{ paddingTop: '8px', fontSize: '14px' }} />
                  <Area
                    dataKey="band95"
                    name="5th–95th MC uncertainty"
                    stroke="none"
                    fill="#93c5fd"
                    fillOpacity={0.35}
                    activeDot={false}
                    legendType="rect"
                    isAnimationActive={false}
                  />
                  <Area
                    dataKey="band50"
                    name="25th–75th MC uncertainty"
                    stroke="none"
                    fill="#2563eb"
                    fillOpacity={0.3}
                    activeDot={false}
                    legendType="rect"
                    isAnimationActive={false}
                  />
                  <Line
                    dataKey="p50"
                    name="Median (MC)"
                    stroke="#1d4ed8"
                    strokeWidth={1.5}
                    dot={false}
                    strokeDasharray="4 2"
                    isAnimationActive={false}
                  />
                  <ReferenceLine
                    y={effectiveTargetLogN}
                    stroke="#dc2626"
                    strokeWidth={1.5}
                    strokeDasharray="6 3"
                    label={{ value: `Nominal ${targetReduction}-log endpoint (${effectiveTargetLogN.toFixed(1)})`, position: 'insideTopRight', fontSize: 14, fill: '#dc2626' }}
                  />
                  <ReferenceLine
                    x={sliderTime}
                    stroke="#f59e0b"
                    strokeWidth={1}
                    strokeDasharray="4 3"
                    strokeOpacity={0.6}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Right: Histogram */}
            <div className="mc-chart-half">
              <div className="mc-chart-title">
                Log Reduction Distribution at t = {sliderTime.toFixed(1)}
                <span className="mc-hist-subtitle"> (n = {sliceSamples.length})</span>
              </div>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart
                  data={histogramData}
                  margin={{ top: 16, right: 24, bottom: 44, left: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                  <XAxis
                    dataKey="x"
                    type="number"
                    domain={['auto', 'auto']}
                    tickFormatter={(v) => Number(v).toFixed(1)}
                    label={{ value: 'Log reduction', position: 'insideBottom', offset: -10, fontSize: 14 }}
                  />
                  <YAxis
                    width={64}
                    label={{ value: 'Count', angle: -90, position: 'insideLeft', fontSize: 14 }}
                  />
                  <Tooltip
                    formatter={(v) => [v, 'Count']}
                    labelFormatter={(l) => `Log reduction ~ ${l}`}
                  />
                  <ReferenceLine
                    x={targetReduction}
                    stroke="#dc2626"
                    strokeWidth={1.5}
                    strokeDasharray="6 3"
                    label={{ value: 'Target', position: 'top', fontSize: 14, fill: '#dc2626' }}
                  />
                  <Bar dataKey="count" name="Count" isAnimationActive={false}>
                    {histogramData.map((bin, i) => (
                      <Cell key={i} fill={bin.x >= targetReduction ? '#22c55e' : '#ef4444'} fillOpacity={0.75} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="mc-export-row">
            <button className="btn-secondary" onClick={handleExportCsv}>
              Export Report (CSV)
            </button>
            <button className="btn-secondary" onClick={handleExportJson}>
              Export Report (JSON)
            </button>
          </div>

          <SensitivityPanel
            axisUnit={inputUnit}
            timeUnitToMin={useDoseAxis ? undefined : timeUnitToMin}
            paramSamples={result.paramSamples}
            outputSamples={result.allSamples[sliderIndex]}
            allSamples={result.allSamples}
            tArray={result.tArray}
            targetLogN={effectiveTargetLogN}
            targetReduction={targetReduction}
            initialLogNSamples={result.initialLogNSamples}
            independentParamSamples={result.independentParamSamples}
            confidenceLevel={confidenceLevel}
            randomSeed={result.runMetadata?.seed ?? randomSeed}
            paramNames={result.paramNames ?? MODELS[modelId]?.params.map(p => p.name) ?? []}
            modelId={modelId}
            factorSamples={result.factorSamples}
            factorKeys={result.factorKeys}
            modelFn={sensitivityModelFn}
            analysisConfig={analysisConfig}
            nominalParams={predictedParams}
            tEval={sliderTime}
            predictParamsFn={predictParamsFn}
            factorValues={factorValues}
            visibleFactorKeys={visibleFactorKeys}
            secondaryParamSamples={result.secondaryParamSamples}
            secondaryParamNames={result.secondaryParamNames}
            secondaryParamLabels={result.secondaryParamLabels}
            fittedSecondaryModels={fittedSecondaryModels}
            bindings={bindings}
            predictParamsFnFactory={predictParamsFn ? predictParamsFnFactory : null}
          />
        </div>
      )}
    </div>
  );
}
