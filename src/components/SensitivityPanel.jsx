import { useState, useMemo, useRef, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import { toPng, toSvg } from 'html-to-image';
import { computeGSA, generateConclusions, computeOATSensitivity } from '../models/sensitivityAnalysis.js';
import { startAnalysisTask } from '../utils/analysisWorkerClient.js';
import { MODELS, getParamsForDoseAxis } from '../models/inactivationModels.js';
import { FormattedLabel, SvgFormattedLabel } from '../utils/formatLabels.jsx';

const EXPORT_OPTIONS = {
  backgroundColor: '#ffffff',
  pixelRatio: 3,
  style: { margin: '0', padding: '8px' },
};

function triggerDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

function escapeCSV(value) {
  if (value == null) return '';
  const text = String(value);
  if (/[,"\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function downloadCsvFile(fileName, rows) {
  const csv = rows.map((row) => row.map(escapeCSV).join(',')).join('\n');
  triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8' }), fileName);
}

async function exportContainerAsPng(container, baseName) {
  if (!container) return;
  try {
    const dataUrl = await toPng(container, EXPORT_OPTIONS);
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    triggerDownload(blob, `${baseName}.png`);
  } catch (err) {
    console.error('PNG export failed:', err);
  }
}

async function exportContainerAsSvg(container, baseName) {
  if (!container) return;
  try {
    const dataUrl = await toSvg(container, EXPORT_OPTIONS);
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    triggerDownload(blob, `${baseName}.svg`);
  } catch (err) {
    console.error('SVG export failed:', err);
  }
}

/* Color scheme: factor vs model vs secondary × positive vs negative SRC */
const COLORS = {
  factor:    { pos: '#f59e0b', neg: '#0d9488' }, // amber / teal
  model:     { pos: '#ef4444', neg: '#3b82f6' }, // red / blue
  secondary: { pos: '#8b5cf6', neg: '#06b6d4' }, // violet / cyan
};

function barColor(entry) {
  const palette = COLORS[entry.category] ?? COLORS.model;
  return entry.src == null ? '#64748b' : entry.src >= 0 ? palette.pos : palette.neg;
}

/**
 * Sensitivity Analysis Panel — tornado chart + category summary + smart conclusions.
 * Placed below Monte Carlo results; collapsed by default.
 */
export default function SensitivityPanel({
  paramSamples, outputSamples, paramNames, modelId,
  factorSamples, factorKeys,
  modelFn, nominalParams, tEval, predictParamsFn, analysisConfig,
  factorValues, visibleFactorKeys,
  secondaryParamSamples, secondaryParamNames, secondaryParamLabels,
  fittedSecondaryModels, bindings, predictParamsFnFactory,
  allSamples, tArray, targetLogN, targetReduction, initialLogNSamples, independentParamSamples, timeUnitToMin, axisUnit = 'min', randomSeed,
}) {
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState('oat');
  const [oatDelta, setOatDelta] = useState(0.05);
  const [outputMetric, setOutputMetric] = useState('finalLogN');
  const [sobolN, setSobolN] = useState(128);
  const chartRef = useRef(null);
  const [morrisResult, setMorrisResult] = useState(null);
  const [sobolResult, setSobolResult] = useState(null);
  const [gsaComputing, setGsaComputing] = useState(false);
  const [gsaError, setGsaError] = useState('');
  const [r2TooltipVisible, setR2TooltipVisible] = useState(false);
  const [sobolTooltipVisible, setSobolTooltipVisible] = useState(false);
  const [sumSTTooltipVisible, setSumSTTooltipVisible] = useState(false);
  const [morrisTooltipVisible, setMorrisTooltipVisible] = useState(false);

  const sampleTargets = useMemo(() => {
    if (targetReduction == null) return outputSamples?.map(() => targetLogN) ?? [];
    const initial = initialLogNSamples ?? allSamples?.[0] ?? [];
    return initial.map(value => value - targetReduction);
  }, [targetReduction, initialLogNSamples, allSamples, outputSamples, targetLogN]);

  // Compute derived output samples based on selected metric
  const effectiveOutputSamples = useMemo(() => {
    if (!expanded || mode !== 'variance') return null;
    if (!outputSamples || outputSamples.length < 10) return outputSamples;
    if (outputMetric === 'finalLogN') return outputSamples;

    const n = outputSamples.length;
    if (outputMetric === 'logReduction') {
      if (initialLogNSamples) return outputSamples.map((logN, i) => initialLogNSamples[i] - logN);
      // Legacy callers may only retain the sampled initial parameter.
      if (!paramSamples || !paramNames) return outputSamples;
      const logN0Idx = paramNames.indexOf('logN0');
      if (logN0Idx < 0 || !paramSamples[logN0Idx]) return outputSamples;
      const logN0Arr = paramSamples[logN0Idx];
      return outputSamples.map((logN, i) => (logN0Arr[i] ?? 0) - logN);
    }

    if (outputMetric === 'timeToTarget') {
      // For each sample curve, find first time where logN <= targetLogN
      if (!allSamples || !tArray?.length) return outputSamples;
      const nTime = allSamples.length;
      const result = new Array(n);
      for (let s = 0; s < n; s++) {
        let hitIdx = -1;
        for (let ti = 0; ti < nTime; ti++) {
          if (allSamples[ti]?.[s] <= sampleTargets[s] + 1e-10) { hitIdx = ti; break; }
        }
        result[s] = hitIdx >= 0 ? tArray[hitIdx] : tArray.at(-1);
      }
      return result;
    }

    if (outputMetric === 'successProb') {
      // Binary: 1 if logN <= targetLogN, 0 otherwise
      return outputSamples.map((logN, i) => logN <= sampleTargets[i] + 1e-10 ? 1 : 0);
    }

    return outputSamples;
  }, [expanded, mode, outputSamples, outputMetric, initialLogNSamples, paramSamples, paramNames, allSamples, tArray, sampleTargets]);

  const censoredTimeSamples = useMemo(() => {
    if (!expanded || mode !== 'variance' || outputMetric !== 'timeToTarget' || !allSamples || !outputSamples || !tArray?.length) return 0;
    return outputSamples.reduce((count, _, sampleIndex) => count + (
      allSamples.some(samples => Number.isFinite(samples[sampleIndex]) && samples[sampleIndex] <= sampleTargets[sampleIndex] + 1e-10) ? 0 : 1
    ), 0);
  }, [expanded, mode, outputMetric, allSamples, outputSamples, tArray, sampleTargets]);

  const gsaResult = useMemo(() => {
    if (!expanded || mode !== 'variance') return null;
    if (!paramSamples || !effectiveOutputSamples || effectiveOutputSamples.length < 10) return null;
    return computeGSA(independentParamSamples ?? paramSamples, effectiveOutputSamples, paramNames, factorSamples, factorKeys, modelId,
      secondaryParamSamples, secondaryParamNames, secondaryParamLabels);
  }, [expanded, mode, independentParamSamples, paramSamples, effectiveOutputSamples, paramNames, factorSamples, factorKeys, modelId,
      secondaryParamSamples, secondaryParamNames, secondaryParamLabels]);

  const oatResult = useMemo(() => {
    if (!expanded || mode !== 'oat' || !modelFn || !nominalParams || !paramNames || tEval == null) return null;
    return computeOATSensitivity({
      modelFn, nominalParams, paramNames, modelId, timeUnitToMin, tEval,
      predictParamsFn, factorValues, factorKeys: visibleFactorKeys,
      fittedSecondaryModels, bindings, predictParamsFnFactory,
      delta: oatDelta,
    });
  }, [expanded, mode, modelFn, nominalParams, paramNames, modelId, timeUnitToMin, tEval, predictParamsFn, factorValues, visibleFactorKeys,
      fittedSecondaryModels, bindings, predictParamsFnFactory, oatDelta]);

  useEffect(() => {
    let active = true;
    let job = null;
    let computeTimer = null;
    const startTimer = setTimeout(() => {
      setMorrisResult(null);
      setSobolResult(null);
      setGsaError('');
      if (!expanded || (mode !== 'morris' && mode !== 'sobol') || !analysisConfig || tEval == null) {
        setGsaComputing(false);
        return;
      }
      setGsaComputing(true);
      // Debounce dragging; cancel obsolete jobs so old slider results cannot reappear.
      computeTimer = setTimeout(() => {
        job = startAnalysisTask(mode, { ...analysisConfig, tEval, timeUnitToMin, N: sobolN, seed: randomSeed });
        job.promise.then(value => {
          if (!active) return;
          if (mode === 'morris') setMorrisResult(value);
          else setSobolResult(value);
        }).catch(error => {
          if (active && error.name !== 'AbortError') setGsaError(error.message || 'Global sensitivity calculation failed.');
        }).finally(() => {
          if (active) setGsaComputing(false);
        });
      }, 200);
    }, 0);
    return () => {
      active = false;
      clearTimeout(startTimer);
      if (computeTimer) clearTimeout(computeTimer);
      job?.cancel();
    };
  }, [expanded, mode, analysisConfig, tEval, timeUnitToMin, sobolN, randomSeed]);

  const resultMap = { oat: oatResult, variance: gsaResult, morris: morrisResult, sobol: sobolResult };
  const selectedResult = resultMap[mode];
  const activeResult = useMemo(() => {
    if (!selectedResult) return null;
    const labels = Object.fromEntries(getParamsForDoseAxis(MODELS[modelId]?.params ?? [], axisUnit).map(param => [param.name, param.label]));
    return { ...selectedResult, results: selectedResult.results.map(row => ({ ...row,
      label: row.category === 'model' ? labels[row.param] ?? row.label
        : row.category === 'secondary' ? row.label.replace(/1\/min/g, `1/${axisUnit}`).replace(/min\)/g, `${axisUnit})`) : row.label,
    })) };
  }, [selectedResult, modelId, axisUnit]);

  const conclusions = useMemo(() => {
    if (!activeResult) return [];
    return generateConclusions(
      activeResult.results, modelId,
      activeResult.factorContribution, activeResult.modelContribution,
      activeResult.secondaryContribution, mode === 'variance' ? outputMetric : 'finalLogN',
    );
  }, [activeResult, modelId, mode, outputMetric]);



  const { results, rSquared, factorContribution, modelContribution, secondaryContribution } = activeResult ?? { results: [], factorContribution: 0, modelContribution: 0, secondaryContribution: 0 };
  const chartHeight = Math.max(160, results.length * 44 + 60);
  const hasFactors = factorContribution > 0;
  const hasSecondary = (secondaryContribution ?? 0) > 0;

  function exportSensitivityCsv() {
    if (!activeResult) return;
    const rows = [
      ['Mode', mode],
      ['Random seed', randomSeed ?? ''],
      ['Output metric', mode === 'variance' ? outputMetric : 'finalLogN'],
      ['Right-censored target-time samples', censoredTimeSamples],
      ['Target-time censoring', censoredTimeSamples > 0 ? 'Unreached curves are capped at the saved simulation horizon; SRC describes capped times, not exact attainment times.' : 'None'],
      ['R2', rSquared ?? ''],
      ['Process control contribution (%)', factorContribution ?? 0],
      ['Primary model contribution (%)', modelContribution ?? 0],
      ['Secondary model contribution (%)', secondaryContribution ?? 0],
      ['Score meaning', 'Normalized relative influence; these percentages are not an additive explained-variance partition.'],
      ...(activeResult.estimationWarnings ?? []).map(warning => ['Estimation warning', warning]),
      ...Object.entries(activeResult.factorRanges ?? {}).map(([name, range]) => ['Environmental range', name, range.min, range.max]),
      ...(activeResult.inputRanges ?? []).map(range => ['Sampled input range', range.name, range.category, range.lo, range.hi]),
      [],
      ['Rank', 'Parameter', 'Label', 'Category', 'Relative influence (%)', mode === 'variance' ? 'SRC' : mode === 'oat' ? 'Normalized output-change direction' : mode === 'morris' ? 'Mean effect direction' : 'Direction (not estimated)', 'Morris mu*', 'Morris sigma', 'Sobol S1', 'Sobol ST'],
      ...results.map((row, idx) => [
        idx + 1,
        row.param,
        row.label,
        row.category,
        row.contribution,
        row.src ?? '',
        row.muStar ?? '',
        row.sigma ?? '',
        row.s1 ?? '',
        row.st ?? '',
      ]),
    ];
    downloadCsvFile(`Sensitivity_${mode}.csv`, rows);
  }

  return (
    <div className="gsa-panel">
      <button
        className="btn-secondary gsa-toggle"
        onClick={() => setExpanded(e => !e)}
      >
        {expanded ? 'Hide' : 'Show'} Sensitivity Analysis (Tornado Chart)
      </button>

      {expanded && (
        <div className="gsa-content">
          {!activeResult && !gsaComputing && <div className="gsa-oat-note">{mode === 'variance' ? 'SRC cannot be calculated: the selected output has no variance or independent input regression is unavailable.' : 'The selected sensitivity method has no valid result for these inputs.'}</div>}
          {/* Mode toggle */}
          {gsaError && <div className="gsa-oat-note" role="alert">Morris/Sobol unavailable: {gsaError}</div>}
          <div className="gsa-mode-toggle">
            <button
              className={`btn-secondary gsa-mode-btn ${mode === 'oat' ? 'gsa-mode-active' : ''}`}
              onClick={() => setMode('oat')}
            >
              OAT
            </button>
            <button
              className={`btn-secondary gsa-mode-btn ${mode === 'variance' ? 'gsa-mode-active' : ''}`}
              onClick={() => setMode('variance')}
              disabled={!paramSamples || !outputSamples || outputSamples.length < 10}
              title="Calculate regression influence from the Monte Carlo samples"
            >
              SRC
            </button>
            <button
              className={`btn-secondary gsa-mode-btn ${mode === 'morris' ? 'gsa-mode-active' : ''}`}
              onClick={() => setMode('morris')}
              disabled={!analysisConfig || !modelFn || !nominalParams || tEval == null}
              title="Calculate Morris screening for the selected time"
            >
              Morris
              <span
                className="mc-adv-info-icon"
                style={{marginLeft:4,fontSize:'0.85em'}}
                onMouseEnter={() => setMorrisTooltipVisible(true)}
                onMouseLeave={() => setMorrisTooltipVisible(false)}
              >
                ⓘ
                {morrisTooltipVisible && (
                  <span className="mc-adv-tooltip" style={{width:280}}>
                    Morris elementary-effects analysis is a computationally efficient global screening method. μ* indicates overall importance; σ indicates nonlinearity or interactions. Not a precise variance decomposition.
                  </span>
                )}
              </span>
            </button>
            <button
              className={`btn-secondary gsa-mode-btn ${mode === 'sobol' ? 'gsa-mode-active' : ''}`}
              onClick={() => setMode('sobol')}
              disabled={!analysisConfig || !modelFn || !nominalParams || tEval == null}
              title="Calculate Sobol indices for the selected time"
            >
              Sobol S1/ST
              <span
                className="mc-adv-info-icon"
                style={{marginLeft:4,fontSize:'0.85em'}}
                onMouseEnter={() => setSobolTooltipVisible(true)}
                onMouseLeave={() => setSobolTooltipVisible(false)}
              >
                ⓘ
                {sobolTooltipVisible && (
                  <span className="mc-adv-tooltip" style={{width:300}}>
                    S1 is the first-order (main-effect) index. ST includes main effects plus all interaction effects. Both are reported; ST answers: "how much variance would remain if only this input were unknown?" Finite-sample S1 can be negative or noisy, so check sample-size and seed stability.
                  </span>
                )}
              </span>
            </button>
          </div>

          {/* OAT perturbation selector */}
          {mode === 'oat' && (
            <div className="gsa-oat-delta">
              <span>Perturbation:</span>
              {[0.01, 0.05, 0.10].map(d => (
                <button key={d}
                  className={`btn-secondary gsa-mode-btn ${oatDelta === d ? 'gsa-mode-active' : ''}`}
                  onClick={() => setOatDelta(d)}
                >±{(d * 100).toFixed(0)}%</button>
              ))}
              <span className="gsa-oat-note">OAT results are local to the selected baseline condition.</span>
            </div>
          )}

          {/* Output metric selector — SRC mode */}
          {mode === 'variance' && (
            <div className="gsa-output-metric">
              <span>Output metric:</span>
              <select
                className="mc-input"
                value={outputMetric}
                onChange={(e) => setOutputMetric(e.target.value)}
              >
                <option value="finalLogN">Final log₁₀(N) — final contamination level</option>
                <option value="logReduction">Log reduction — treatment effectiveness</option>
                <option value="timeToTarget" disabled={!allSamples}>Time to target — required treatment time</option>
                <option value="successProb">Success probability — target achievement probability</option>
              </select>
            </div>
          )}

          {/* Threshold endpoint warning */}
          {mode === 'variance' && outputMetric === 'timeToTarget' && censoredTimeSamples > 0 && (
            <div className="gsa-oat-note">
              {censoredTimeSamples} curves did not reach the target within the simulated time. These times are right-censored and capped at the saved horizon for SRC; contributions describe capped times, not exact target attainment times.
            </div>
          )}

          {mode === 'variance' && outputMetric === 'successProb' && (
            <div className="gsa-r2-badge gsa-r2-moderate">
              Threshold endpoint: SRC may have low R². Morris or Sobol ST is recommended.
            </div>
          )}

          {/* Sobol sample size selector */}
          {mode === 'sobol' && (
            <div className="gsa-oat-delta">
              <span>Sobol base samples (N):</span>
              {[128, 512, 2048, 8192].map(n => (
                <button key={n}
                  className={`btn-secondary gsa-mode-btn ${sobolN === n ? 'gsa-mode-active' : ''}`}
                  onClick={() => setSobolN(n)}
                >{n}</button>
              ))}
              <span className="gsa-oat-note" style={{color: sobolN < 2048 ? '#92400e' : '#065f46'}}>
                {sobolN < 2048 ? 'Screening estimate; S1 requires larger N. Increase N and check stability.' : 'Check stability across sample sizes and seeds; S1 is more sample-sensitive than ST.'}
              </span>
            </div>
          )}

          {/* Computing indicator for Morris/Sobol */}
          {gsaComputing && (mode === 'morris' || mode === 'sobol') && (
            <div className="gsa-computing">Computing {mode === 'morris' ? 'Morris' : 'Sobol'} indices...</div>
          )}

          {/* R² diagnostic badge — SRC mode */}
          {mode === 'variance' && <div className="gsa-oat-note">Normalized SRC² measures relative regression influence. Correlated inputs prevent interpreting these percentages as additive explained-variance fractions.</div>}
          {(mode === 'morris' || mode === 'sobol') && activeResult && (
            <div className="gsa-oat-note">
              Environmental ranges: {visibleFactorKeys?.map(key => {
                const range = activeResult.factorRanges?.[key] ?? activeResult.inputRanges?.find(input => input.name === key);
                return range ? `${key}: ${range.min ?? range.lo}–${range.max ?? range.hi}` : `${key}: fixed at ${factorValues?.[key]}`;
              }).join('; ') || 'No variable environmental factors'}. These ranges define a rectangular screening domain; they do not validate every combination.
              {activeResult.estimationWarnings?.map(warning => <p key={warning}>{warning}</p>)}
            </div>
          )}
          {mode === 'variance' && rSquared != null && (
            <div className={`gsa-r2-badge ${rSquared >= 0.7 ? 'gsa-r2-good' : rSquared >= 0.5 ? 'gsa-r2-moderate' : 'gsa-r2-poor'}`}>
              {rSquared >= 0.9995 ? 'R² > 0.999' : `R² = ${rSquared.toFixed(3)}`}
              <span className="gsa-r2-label">
                {rSquared >= 0.7 ? ' — Adequate linear approximation' : rSquared >= 0.5 ? ' — Moderate; interpret cautiously' : ' — Poor; exploratory only (use Morris/Sobol)'}
              </span>
              <span
                className="mc-adv-info-icon"
                onMouseEnter={() => setR2TooltipVisible(true)}
                onMouseLeave={() => setR2TooltipVisible(false)}
              >
                ⓘ
                {r2TooltipVisible && (
                  <span className="mc-adv-tooltip">
                    R² measures how well a linear model explains output variance from the sampled inputs. Normalized SRC² gives relative influence, with limited variance interpretation under correlated inputs. R² ≥ 0.70 is a heuristic for a useful linear approximation; lower R² requires caution or nonlinear screening.
                  </span>
                )}
              </span>
            </div>
          )}

          {/* Sobol ΣS1/ΣST diagnostic */}
          {mode === 'sobol' && sobolResult?.sumST != null && (
            <div className={`gsa-r2-badge ${sobolResult.sumST > 1.3 ? 'gsa-r2-moderate' : 'gsa-r2-good'}`}>
              ΣS1 = {sobolResult.sumS1 != null ? sobolResult.sumS1.toFixed(3) : 'NA'} | ΣST = {sobolResult.sumST.toFixed(3)}
              <span className="gsa-r2-label">
                {sobolResult.sumST > 1.0 ? ' — Interactions or sampling uncertainty' : ' — Check convergence before interpreting additivity'}
              </span>
              <span
                className="mc-adv-info-icon"
                onMouseEnter={() => setSumSTTooltipVisible(true)}
                onMouseLeave={() => setSumSTTooltipVisible(false)}
              >
                ⓘ
                {sumSTTooltipVisible && (
                  <span className="mc-adv-tooltip" style={{width:300}}>
                    S1 is the first-order (main-effect) share; ΣS1 should be near one for an additive model. ST counts shared interaction effects more than once, so ΣST can exceed one. Finite-sample uncertainty affects both estimates. Check sample-size and seed stability; this is not a formal interaction test.
                  </span>
                )}
              </span>
            </div>
          )}
          <div className="export-actions" style={{ marginBottom: 8 }}>
            <button className="btn-secondary" onClick={() => exportContainerAsSvg(chartRef.current, 'sensitivity_analysis')}>
              Export SVG
            </button>
            <button className="btn-secondary" onClick={() => exportContainerAsPng(chartRef.current, 'sensitivity_analysis')}>
              Export PNG
            </button>
            <button className="btn-secondary" onClick={exportSensitivityCsv}>
              Export CSV
            </button>
          </div>
          <div ref={chartRef}>
          {/* Category summary chips */}
          {(hasFactors || hasSecondary) && (
            <div className="gsa-category-summary">
              {hasFactors && (
                <span className="gsa-chip gsa-chip-factor">
                  Process Control: {factorContribution.toFixed(1)}%
                </span>
              )}
              <span className="gsa-chip gsa-chip-model">
                Primary Model: {modelContribution.toFixed(1)}%
              </span>
              {hasSecondary && (
                <span className="gsa-chip gsa-chip-secondary">
                  Secondary Model: {secondaryContribution.toFixed(1)}%
                </span>
              )}
            </div>
          )}

          <p className="gsa-chart-title">
            {mode === 'oat' ? `Local Sensitivity — Parameter Influence on Output (±${(oatDelta*100).toFixed(0)}% perturbation)`
              : mode === 'morris' ? 'Morris Screening — Elementary Effects (μ* ranking)'
              : mode === 'sobol' ? 'Sobol Total-Order Indices (ST)'
              : `SRC Relative Influence on ${
                  outputMetric === 'logReduction' ? 'Log Reduction'
                  : outputMetric === 'timeToTarget' ? 'Time to Target'
                  : outputMetric === 'successProb' ? 'Success Probability'
                  : 'Final log₁₀(N)'
                }`}
          </p>

          <ResponsiveContainer width="100%" height={chartHeight}>
            <BarChart
              data={results}
              layout="vertical"
              margin={{ top: 8, right: 40, bottom: 24, left: 10 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis
                type="number"
                domain={[0, 100]}
                tickFormatter={v => `${v}%`}
                label={{ value: 'Normalized Relative Influence (%)', position: 'insideBottom', offset: -2, fontSize: 14 }}
              />
              <YAxis
                type="category"
                dataKey="label"
                width={200}
                tick={<SvgFormattedLabel fontSize={14} />}
              />
              <Tooltip
                formatter={(value, _name, props) => {
                  const p = props.payload;
                  const tag = p.category === 'factor' ? 'Process' : p.category === 'secondary' ? 'Secondary' : 'Model';
                  const lines = [`${value.toFixed(1)}%  (${tag})`];
                  if (mode === 'morris' && p.muStar != null) lines.push(`μ*=${p.muStar.toFixed(4)}  σ=${p.sigma.toFixed(4)}`);
                  else if (mode === 'sobol') {
                    if (p.s1 != null) lines.push(`S1=${p.s1.toFixed(4)}`);
                    if (p.st != null) lines.push(`ST=${p.st.toFixed(4)}`);
                  }
                  else if (mode === 'variance') lines.push(`SRC: ${p.src >= 0 ? '+' : ''}${p.src.toFixed(3)}`);
                  else lines.push(`Output-change direction: ${p.src >= 0 ? '+' : '−'}`);
                  return lines;
                }}
                labelFormatter={(label) => <FormattedLabel text={label} />}
              />
              <Bar dataKey="contribution" isAnimationActive={false} radius={[0, 4, 4, 0]}>
                {results.map((entry, i) => (
                  <Cell key={i} fill={barColor(entry)} fillOpacity={0.82} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          {mode === 'sobol' && (
            <p className="gsa-oat-note">
              Bars show normalized total-order effects (ST). First-order indices (S1) are shown in the tooltip and included in the CSV export.
            </p>
          )}

          {/* Legend */}
          {mode !== 'sobol' && <div className="gsa-legend">
            {hasFactors && (
              <>
                <span className="gsa-legend-item">
                  <span className="gsa-legend-swatch" style={{ background: COLORS.factor.pos }} />
                  Process factor (+)
                </span>
                <span className="gsa-legend-item">
                  <span className="gsa-legend-swatch" style={{ background: COLORS.factor.neg }} />
                  Process factor (−)
                </span>
              </>
            )}
            <span className="gsa-legend-item">
              <span className="gsa-legend-swatch" style={{ background: COLORS.model.pos }} />
              Primary param (+)
            </span>
            <span className="gsa-legend-item">
              <span className="gsa-legend-swatch" style={{ background: COLORS.model.neg }} />
              Primary param (−)
            </span>
            {hasSecondary && (
              <>
                <span className="gsa-legend-item">
                  <span className="gsa-legend-swatch" style={{ background: COLORS.secondary.pos }} />
                  Secondary param (+)
                </span>
                <span className="gsa-legend-item">
                  <span className="gsa-legend-swatch" style={{ background: COLORS.secondary.neg }} />
                  Secondary param (−)
                </span>
              </>
            )}
          </div>}

          {/* Smart conclusions */}
          {conclusions.length > 0 && (
            <div className="gsa-conclusions">
              <strong>Analysis Summary</strong>
              <ul>
                {conclusions.map((line, i) => (
                  <li key={i}><FormattedLabel text={line} /></li>
                ))}
              </ul>
            </div>
          )}
          </div>
        </div>
      )}
    </div>
  );
}
