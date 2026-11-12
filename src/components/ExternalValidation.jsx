import { lazy, Suspense, useMemo, useRef, useState } from 'react';
import { toPng, toSvg } from 'html-to-image';
import { MODELS } from '../models/inactivationModels';
import { fitPrimaryInTimeUnit } from '../utils/unitFitting.js';
import {
  predictPrimaryParams,
  predictRawParameterValue,
  FACTOR_DEFS,
  MODEL_SECONDARY_CONFIG,
} from '../models/secondaryModels';
import {
  applyHeldOutInitialState,
  interpretValidationMetrics,
  resolveValidationTarget,
} from '../utils/validationDiagnostics';
import { useScenario } from '../ScenarioContext';
import { FormattedLabel } from '../utils/formatLabels.jsx';

const Plot = lazy(() => import('./PlotlyChart'));

const COLORS = ['#1f3b73', '#9a3412', '#166534', '#7c3aed', '#0f766e', '#b45309'];

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

function exportValidationCSV(metrics, interpretation) {
  if (!metrics || !metrics.points.length) return;
  const escape = value => {
    const text = String(value ?? '');
    return /[,"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const rows = [
    ['Dataset', 'Time', 'Observed', 'Predicted', 'Residual'],
    ...metrics.points.map(p => [p.datasetName, p.t, p.observed, p.predicted, (p.predicted - p.observed).toFixed(6)]),
    [], ['Summary'],
    ['Bf', metrics.Bf.toFixed(6)], ['Af', metrics.Af.toFixed(6)], ['RMSE', metrics.RMSE.toFixed(6)], ['n', metrics.n],
    ['Target', interpretation?.targetLabel],
    ['Diagnostic agreement', interpretation?.agreement?.label],
    ['Strict Bf/Af zone', interpretation?.strictZone?.label],
    ['Bias direction', interpretation?.biasDirection],
    ['Evidence level', interpretation?.evidence?.label],
  ];
  const csv = rows.map(row => row.map(escape).join(',')).join('\n');
  triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'independent_condition_validation.csv');
}

let nextSetId = 1;

/* ── Parsing ── */

function parseValidationText(text) {
  const lines = text.trim().split(/\n/).filter(Boolean);
  const points = [];
  for (const line of lines) {
    const parts = line.trim().split(/[\t,;]+|\s{2,}/).map((s) => s.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    const t = parseFloat(parts[0]);
    if (Number.isNaN(t)) continue;
    for (let i = 1; i < parts.length; i++) {
      const logN = parseFloat(parts[i]);
      if (!Number.isNaN(logN)) points.push({ t, logN });
    }
  }
  return points;
}

/* ── Metrics ── */

function computeCurveMetrics(validationSets, primaryModelId, bindings, fittedModels, manualParams, primaryFactorKey, timeUnitToMin = 1) {
  const primaryModel = MODELS[primaryModelId];
  if (!primaryModel) return null;

  const allPoints = [];

  for (const vs of validationSets) {
    if (!vs.parsedData?.length) continue;
    const factors = vs.conditions;

    let predParams = predictPrimaryParams({
      primaryModelId,
      primaryFactorKey,
      bindings,
      fittedSecondaryModels: fittedModels,
      manualParams,
      factors,
    });
    if (!predParams) continue;

    const fittedHeldOut = fitPrimaryInTimeUnit(
      primaryModelId,
      vs.parsedData.map(({ t, logN }) => ({ t, logN })),
      { timeUnitToMin },
    );
    if (!fittedHeldOut?.params || fittedHeldOut.failed || fittedHeldOut.converged === false) continue;
    if (fittedHeldOut.params) {
      predParams = applyHeldOutInitialState({
        predictedParams: predParams,
        fittedParams: fittedHeldOut.params,
        primaryModel,
      });
    }

    for (const { t, logN } of vs.parsedData) {
      const predicted = primaryModel.fn(t, predParams);
      if (Number.isFinite(predicted) && Number.isFinite(logN)) {
        allPoints.push({
          datasetName: vs.name,
          datasetId: vs.id,
          observed: logN,
          predicted,
          t,
        });
      }
    }
  }

  if (allPoints.length === 0) return null;
  const n = allPoints.length;

  let sumLogRatio = 0;
  let sumAbsLogRatio = 0;
  let sumSqDiff = 0;

  for (const p of allPoints) {
    const diff = p.predicted - p.observed;
    sumLogRatio += diff;
    sumAbsLogRatio += Math.abs(diff);
    sumSqDiff += diff * diff;
  }

  return {
    Bf: Math.pow(10, sumLogRatio / n),
    Af: Math.pow(10, sumAbsLogRatio / n),
    RMSE: Math.sqrt(sumSqDiff / n),
    n,
    points: allPoints,
  };
}

function getValidationTargetInfo(primaryModelId, bindings, fittedModels) {
  const config = MODEL_SECONDARY_CONFIG[primaryModelId];
  if (!config?.targets) return null;
  return resolveValidationTarget({
    targetKeys: Object.keys(config.targets),
    bindings,
    fittedModels,
  });
}

function computeParameterMetrics(validationSets, primaryModelId, bindings, fittedModels, manualParams, primaryFactorKey, timeUnitToMin = 1) {
  const primaryModel = MODELS[primaryModelId];
  if (!primaryModel) return null;

  const targetInfo = getValidationTargetInfo(primaryModelId, bindings, fittedModels);
  const targetKey = targetInfo?.targetKey;
  const targetConfig = MODEL_SECONDARY_CONFIG[primaryModelId]?.targets?.[targetKey];
  if (!targetKey || !targetConfig) return null;

  const allPoints = [];

  for (const vs of validationSets) {
    if (!vs.parsedData?.length || vs.parsedData.length < 3) continue;
    const factors = vs.conditions;

    const data = vs.parsedData.map(({ t, logN }) => ({ t, logN }));
    const fitResult = fitPrimaryInTimeUnit(primaryModelId, data, { timeUnitToMin });
    if (!fitResult?.params || fitResult.failed || fitResult.converged === false) continue;

    const observedParam = targetConfig.getValue
      ? targetConfig.getValue(fitResult)
      : fitResult.params[targetKey];
    if (!Number.isFinite(observedParam) || observedParam <= 0) continue;

    const fitted = targetInfo.fitKey ? fittedModels?.[targetInfo.fitKey] : null;
    let predictedParam = null;
    if (fitted?.params && !fitted.failed) {
      predictedParam = predictRawParameterValue({
        secondaryModelId: fitted.secondaryModelId,
        params: fitted.params,
        factors,
        targetConfig,
      });
    }
    if (!Number.isFinite(predictedParam) || predictedParam <= 0) {
      const predParams = predictPrimaryParams({
        primaryModelId,
        primaryFactorKey,
        bindings,
        fittedSecondaryModels: fittedModels,
        manualParams,
        factors,
      });
      predictedParam = targetConfig.getValue
        ? targetConfig.getValue({ params: predParams })
        : predParams?.[targetConfig.mapsToParam ?? targetKey];
    }
    if (!Number.isFinite(predictedParam) || predictedParam <= 0) continue;

    allPoints.push({
      datasetName: vs.name,
      datasetId: vs.id,
      observed: Math.log10(observedParam),
      predicted: Math.log10(predictedParam),
      observedRaw: observedParam,
      predictedRaw: predictedParam,
      t: null,
    });
  }

  if (allPoints.length === 0) return null;
  const n = allPoints.length;

  let sumLogRatio = 0;
  let sumAbsLogRatio = 0;
  let sumSqDiff = 0;

  for (const p of allPoints) {
    const diff = p.predicted - p.observed;
    sumLogRatio += diff;
    sumAbsLogRatio += Math.abs(diff);
    sumSqDiff += diff * diff;
  }

  return {
    Bf: Math.pow(10, sumLogRatio / n),
    Af: Math.pow(10, sumAbsLogRatio / n),
    RMSE: Math.sqrt(sumSqDiff / n),
    n,
    points: allPoints,
    targetKey,
    targetLabel: targetConfig.label ?? targetKey,
  };
}

/* ── Extrapolation detection ── */

function getFactorRanges(datasets) {
  const ranges = {};
  for (const ds of datasets) {
    const conds = ds.conditions ?? {};
    for (const key of Object.keys(conds)) {
      const val = parseFloat(conds[key]);
      if (!Number.isFinite(val)) continue;
      if (!ranges[key]) ranges[key] = { min: val, max: val };
      else {
        ranges[key].min = Math.min(ranges[key].min, val);
        ranges[key].max = Math.max(ranges[key].max, val);
      }
    }
  }
  return ranges;
}

function checkExtrapolation(conditions, factorRanges, visibleFactorKeys) {
  const warnings = {};
  for (const key of visibleFactorKeys) {
    const range = factorRanges[key];
    if (!range) continue;
    const val = parseFloat(conditions[key]);
    if (!Number.isFinite(val)) continue;
    if (val < range.min || val > range.max) {
      warnings[key] = { min: range.min, max: range.max, val };
    }
  }
  return warnings;
}

function formatConditions(conditions, visibleFactorKeys) {
  return visibleFactorKeys.map((key, i) => {
    const val = conditions[key];
    let content;
    if (key === 'temp') content = `${val} \u00B0C`;
    else if (key === 'pressure') content = `${val} MPa`;
    else if (key === 'aw') content = <span>a<sub>w</sub>={Number(val).toFixed(3)}</span>;
    else content = `${key}=${val}`;
    return <span key={key}>{i > 0 ? ', ' : ''}{content}</span>;
  });
}

/* ── Sub-components ── */

function formatMaybeNumber(value, digits = 4) {
  return Number.isFinite(value) ? value.toFixed(digits) : '--';
}

function MetricsDashboard({ metrics, interpretation, mode }) {
  const empty = !metrics;
  const singleParamPoint = mode === 'parameter' && metrics?.points?.length === 1 ? metrics.points[0] : null;

  return (
    <div className="validation-metrics">
      <table className="result-table">
        <tbody>
          <tr>
            <th>Target</th>
            <td>{empty ? '--' : <FormattedLabel text={interpretation.targetLabel} />}</td>
          </tr>
          {singleParamPoint?.observedRaw != null && (
            <tr>
              <th>Observed</th>
              <td>{formatMaybeNumber(singleParamPoint.observedRaw)}</td>
            </tr>
          )}
          {singleParamPoint?.predictedRaw != null && (
            <tr>
              <th>Predicted</th>
              <td>{formatMaybeNumber(singleParamPoint.predictedRaw)}</td>
            </tr>
          )}
          <tr>
            <th>Agreement</th>
            <td>
              {empty ? '--' : (
                <span className={interpretation.agreement.className}>{interpretation.agreement.label}</span>
              )}
            </td>
          </tr>
          <tr>
            <th>Strict zone</th>
            <td>
              {empty ? '--' : (
                <span className={interpretation.strictZone.className}>{interpretation.strictZone.label}</span>
              )}
            </td>
          </tr>
          <tr>
            <th>Bias direction</th>
            <td>{empty ? '--' : <FormattedLabel text={interpretation.biasDirection} />}</td>
          </tr>
          <tr>
            <th>B<sub>f</sub></th>
            <td>{empty ? '--' : metrics.Bf.toFixed(4)}</td>
          </tr>
          <tr><th>A<sub>f</sub></th><td>{empty ? '--' : metrics.Af.toFixed(4)}</td></tr>
          <tr><th>Fold difference</th><td>{empty ? '--' : `${formatMaybeNumber(interpretation.foldDifference)}-fold`}</td></tr>
          <tr><th>RMSE</th><td>{empty ? '--' : metrics.RMSE.toFixed(4)}</td></tr>
          <tr><th>n</th><td>{empty ? 0 : metrics.n}</td></tr>
          <tr>
            <th>Evidence</th>
            <td>
              {empty ? '--' : (
                <span className={interpretation.evidence.className}>{interpretation.evidence.label}</span>
              )}
            </td>
          </tr>
        </tbody>
      </table>
      {!empty && (
        <div className="validation-interpretation">
          <p>{interpretation.evidence.note}</p>
          {interpretation.lethalityNote && <p>{interpretation.lethalityNote}</p>}
          <p>{interpretation.useNote}</p>
        </div>
      )}
      {empty && (
        <p className="hint" style={{ fontSize: 14, marginTop: 8 }}>
          Add validation datasets to compute metrics.
        </p>
      )}
    </div>
  );
}

function ParityPlot({ metrics, mode }) {
  if (!metrics || metrics.points.length === 0) {
    return <div className="chart-placeholder"><p>No validation data to plot.</p></div>;
  }

  const isParam = mode === 'parameter';
  const grouped = {};
  for (const pt of metrics.points) {
    if (!grouped[pt.datasetId]) grouped[pt.datasetId] = { name: pt.datasetName, points: [] };
    grouped[pt.datasetId].points.push(pt);
  }

  const traces = Object.values(grouped).map((group, i) => ({
    x: group.points.map((p) => p.predicted),
    y: group.points.map((p) => p.observed),
    mode: 'markers',
    name: group.name,
    text: group.points.map((p) =>
      isParam ? group.name : `${group.name} (t=${p.t})`
    ),
    hoverinfo: 'text+x+y',
    marker: { size: isParam ? 10 : 8, color: COLORS[i % COLORS.length] },
    type: 'scatter',
  }));

  const allVals = metrics.points.flatMap((p) => [p.predicted, p.observed]);
  const lo = Math.min(...allVals);
  const hi = Math.max(...allVals);
  const pad = (hi - lo) * 0.05 || 0.5;

  traces.push({
    x: [lo - pad, hi + pad],
    y: [lo - pad, hi + pad],
    mode: 'lines',
    name: 'y = x',
    line: { dash: 'dash', color: '#94a3b8', width: 2 },
    type: 'scatter',
    showlegend: true,
  });

  return (
    <Suspense fallback={<div className="chart-placeholder"><p>Loading plot...</p></div>}>
      <Plot
        data={traces}
        layout={{
          autosize: true,
          height: 350,
          margin: { l: 56, r: 20, t: 30, b: 56 },
          xaxis: {
            title: isParam ? 'Predicted log\u2081\u2080(' + (metrics.targetKey || 'param') + ')' : 'Predicted log\u2081\u2080(N)',
            constrain: 'domain',
            range: [lo - pad, hi + pad],
          },
          yaxis: {
            title: isParam ? 'Observed log\u2081\u2080(' + (metrics.targetKey || 'param') + ')' : 'Observed log\u2081\u2080(N)',
            scaleanchor: 'x',
            scaleratio: 1,
            range: [lo - pad, hi + pad],
          },
          legend: { x: 0.01, y: 0.99, bgcolor: 'rgba(255,255,255,0.7)' },
          font: { size: 14 },
        }}
        config={{ responsive: true, displayModeBar: false }}
        style={{ width: '100%' }}
      />
    </Suspense>
  );
}

/* ── Main component ── */

export default function ExternalValidation({
  primaryModelId,
  bindings,
  fittedModels,
  manualParams,
  visibleFactorKeys,
  datasets,
}) {
  const { mode, timeUnitToMin, useDoseAxis, scenario } = useScenario();
  const fittingTimeUnitToMin = useDoseAxis || scenario === 'custom' ? 1 : timeUnitToMin;
  const primaryFactorKey = mode?.primaryFactor;
  const factorDefs = useMemo(
    () => FACTOR_DEFS.filter((f) => visibleFactorKeys.includes(f.key)),
    [visibleFactorKeys],
  );

  // Quick-add form state
  const [formName, setFormName] = useState('Validation 1');
  const [formConditions, setFormConditions] = useState(() =>
    factorDefs.reduce((acc, f) => { acc[f.key] = f.defaultValue; return acc; }, {}),
  );
  const [formText, setFormText] = useState('');
  const [editingId, setEditingId] = useState(null);

  // Committed datasets
  const [validationSets, setValidationSets] = useState([]);
  const [collapsed, setCollapsed] = useState(true);
  const [validationMode, setValidationMode] = useState('parameter');
  const [validationSourceType, setValidationSourceType] = useState('heldout');

  const nameInputRef = useRef(null);
  const resultsRef = useRef(null);

  const factorRanges = useMemo(
    () => getFactorRanges(datasets),
    [datasets],
  );

  const curveMetrics = useMemo(
    () => computeCurveMetrics(validationSets, primaryModelId, bindings, fittedModels, manualParams, primaryFactorKey, fittingTimeUnitToMin),
    [validationSets, primaryModelId, bindings, fittedModels, manualParams, primaryFactorKey, fittingTimeUnitToMin],
  );

  const paramMetrics = useMemo(
    () => computeParameterMetrics(validationSets, primaryModelId, bindings, fittedModels, manualParams, primaryFactorKey, fittingTimeUnitToMin),
    [validationSets, primaryModelId, bindings, fittedModels, manualParams, primaryFactorKey, fittingTimeUnitToMin],
  );

  const metrics = validationMode === 'parameter' ? paramMetrics : curveMetrics;

  const interpretation = useMemo(
    () => metrics ? interpretValidationMetrics({
      ...metrics,
      mode: validationMode,
      targetKey: metrics.targetKey,
      setCount: validationSets.length,
      sourceType: validationSourceType,
    }) : null,
    [metrics, validationMode, validationSets.length, validationSourceType],
  );

  const formExtrapWarnings = useMemo(
    () => checkExtrapolation(formConditions, factorRanges, visibleFactorKeys),
    [formConditions, factorRanges, visibleFactorKeys],
  );

  const parsedPreview = useMemo(
    () => parseValidationText(formText),
    [formText],
  );

  function resetForm() {
    const nextNum = validationSets.length + (editingId ? 0 : 1) + 1;
    setFormName(`Validation ${nextNum}`);
    setFormConditions(factorDefs.reduce((acc, f) => { acc[f.key] = f.defaultValue; return acc; }, {}));
    setFormText('');
    setEditingId(null);
  }

  function handleAddOrUpdate() {
    if (parsedPreview.length === 0) return;

    const conditions = {};
    for (const f of factorDefs) {
      const val = parseFloat(formConditions[f.key]);
      conditions[f.key] = Number.isFinite(val) ? val : f.defaultValue;
    }

    if (editingId) {
      setValidationSets((prev) => prev.map((vs) =>
        vs.id === editingId
          ? { ...vs, name: formName, conditions, rawText: formText, parsedData: parsedPreview }
          : vs,
      ));
      setEditingId(null);
    } else {
      const id = `val_${nextSetId++}`;
      setValidationSets((prev) => [...prev, {
        id,
        name: formName,
        conditions,
        rawText: formText,
        parsedData: parsedPreview,
      }]);
    }

    const nextNum = validationSets.length + (editingId ? 1 : 2);
    setFormName(`Validation ${nextNum}`);
    setFormConditions(factorDefs.reduce((acc, f) => { acc[f.key] = f.defaultValue; return acc; }, {}));
    setFormText('');
  }

  function handleRowClick(vs) {
    setEditingId(vs.id);
    setFormName(vs.name);
    setFormConditions({ ...vs.conditions });
    setFormText(vs.rawText);
    nameInputRef.current?.focus();
  }

  function handleDelete(id) {
    setValidationSets((prev) => prev.filter((vs) => vs.id !== id));
    if (editingId === id) resetForm();
  }

  function handleClearAll() {
    setValidationSets([]);
    nextSetId = 1;
    resetForm();
  }

  const hasAnyFit = Object.keys(fittedModels ?? {}).length > 0;

  return (
    <div className="panel validation-panel">
      <h2
        className="panel-title"
        onClick={() => setCollapsed((c) => !c)}
        style={{ cursor: 'pointer', userSelect: 'none' }}
      >
        <span>Hold-out Prediction Diagnostic (B<sub>f</sub> / A<sub>f</sub>)</span>
        <span className={`collapse-arrow ${collapsed ? '' : 'open'}`}>&#9654;</span>
      </h2>

      {!collapsed && (
        <>
          {!hasAnyFit && (
            <p className="hint" style={{ marginBottom: 12 }}>
              Fit a secondary model first for meaningful validation results.
            </p>
          )}
          <div className="validation-body">
            {/* ── Left: Quick-Add + Table ── */}
            <div className="validation-input-col">
              {/* Quick Add panel */}
              <div className="val-quick-add">
                <h3 className="val-section-title">
                  {editingId ? 'Edit Dataset' : 'Quick Add'}
                </h3>

                <div className="form-group">
                  <label>Dataset name</label>
                  <input
                    ref={nameInputRef}
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="Validation 1"
                  />
                </div>

                <div className="val-conditions-row">
                  {factorDefs.map((factor) => (
                    <div className="form-group" key={factor.key}>
                      <label>
                        {factor.key === 'temp' ? 'T (\u00B0C)' :
                         factor.key === 'pressure' ? 'P (MPa)' :
                         factor.key === 'aw' ? <span>a<sub>w</sub></span> : factor.label}
                        {formExtrapWarnings[factor.key] && (
                          <span
                            className="extrap-warning"
                            data-tooltip={`Extrapolation: value ${formExtrapWarnings[factor.key].val} is outside fitted data range [${formExtrapWarnings[factor.key].min}, ${formExtrapWarnings[factor.key].max}]`}
                          >
                            {' \u26A0'}
                          </span>
                        )}
                      </label>
                      <input
                        type="number"
                        value={formConditions[factor.key] ?? factor.defaultValue}
                        step={factor.step}
                        min={factor.min}
                        max={factor.max}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          setFormConditions((prev) => ({
                            ...prev,
                            [factor.key]: Number.isFinite(val) ? val : factor.defaultValue,
                          }));
                        }}
                      />
                    </div>
                  ))}
                </div>

                <div className="form-group">
                  <label>Time vs log\u2081\u2080(N)</label>
                  <textarea
                    className="val-textarea"
                    rows={4}
                    value={formText}
                    onChange={(e) => setFormText(e.target.value)}
                    placeholder={'0\t7.0\t6.9\t7.1\n5\t5.2\t5.0\t5.3\n10\t3.1\t3.0\t3.2'}
                  />
                  {parsedPreview.length > 0 && (
                    <span className="hint">{parsedPreview.length} point{parsedPreview.length !== 1 ? 's' : ''} parsed</span>
                  )}
                </div>

                <div className="val-form-actions">
                  <button
                    className="btn-primary"
                    disabled={parsedPreview.length === 0}
                    onClick={handleAddOrUpdate}
                  >
                    {editingId ? 'Update Dataset' : 'Add to Validation List'}
                  </button>
                  {editingId && (
                    <button className="btn-secondary" onClick={resetForm}>
                      Cancel
                    </button>
                  )}
                </div>
              </div>

              {/* Validation Sets Table */}
              {validationSets.length > 0 && (
                <div className="val-table-section">
                  <div className="val-table-header-row">
                    <h3 className="val-section-title" style={{ margin: 0 }}>
                      Validation Sets ({validationSets.length})
                    </h3>
                    <button className="btn-secondary btn-sm" onClick={handleClearAll}>
                      Clear All
                    </button>
                  </div>
                  <table className="val-sets-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Condition</th>
                        <th style={{ textAlign: 'right' }}>n</th>
                        <th style={{ width: 36 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {validationSets.map((vs) => {
                        const extrap = checkExtrapolation(vs.conditions, factorRanges, visibleFactorKeys);
                        const hasExtrap = Object.keys(extrap).length > 0;
                        return (
                          <tr
                            key={vs.id}
                            className={`val-row ${editingId === vs.id ? 'active' : ''}`}
                            onClick={() => handleRowClick(vs)}
                          >
                            <td className="val-cell-name">{vs.name}</td>
                            <td className="val-cell-cond">
                              {formatConditions(vs.conditions, visibleFactorKeys)}
                              {hasExtrap && (
                                <span className="extrap-warning" title="Extrapolation warning"> {'\u26A0'}</span>
                              )}
                            </td>
                            <td style={{ textAlign: 'right' }}>{vs.parsedData.length}</td>
                            <td>
                              <button
                                className="ds-remove"
                                onClick={(e) => { e.stopPropagation(); handleDelete(vs.id); }}
                                title="Delete"
                              >&times;</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* ── Right: Metrics + Parity Plot ── */}
            <div className="validation-results">
              <div className="val-mode-toggle">
                <button
                  className={`btn-small ${validationMode === 'parameter' ? 'active' : ''}`}
                  onClick={() => setValidationMode('parameter')}
                >
                  Parameter-level
                </button>
                <button
                  className={`btn-small ${validationMode === 'curve' ? 'active' : ''}`}
                  onClick={() => setValidationMode('curve')}
                >
                  Curve-level
                </button>
              </div>
              <div className="form-group validation-source-select">
                <label>Validation data source</label>
                <select
                  value={validationSourceType}
                  onChange={(e) => setValidationSourceType(e.target.value)}
                >
                  <option value="heldout">Held-out condition from calibration dataset</option>
                  <option value="external">Independent external dataset</option>
                  <option value="unknown">Unknown / exploratory diagnostic</option>
                </select>
              </div>
              {validationMode === 'parameter' && (
                <p className="hint" style={{ fontSize: 14, margin: '4px 0 8px' }}>
                  Each validation dataset is independently fitted to obtain observed {paramMetrics?.targetKey || 'parameter'} values; B<sub>f</sub>/A<sub>f</sub> compare observed vs. secondary-model-predicted parameters. Results are diagnostic summaries rather than pass-fail validation decisions.
                </p>
              )}
              {validationMode === 'curve' && (
                <p className="hint" style={{ fontSize: 14, margin: '4px 0 8px' }}>
                  Curve-level diagnostics retain the fitted initial count from each held-out curve, then propagate the secondary-model-predicted kinetic parameter and compare predicted and observed log<sub>10</sub>(N) point-wise.
                </p>
              )}
              <div ref={resultsRef}>
                <MetricsDashboard metrics={metrics} interpretation={interpretation} mode={validationMode} />
                <ParityPlot metrics={metrics} mode={validationMode} />
              </div>
              {metrics && metrics.points.length > 0 && (
                <div className="export-actions" style={{ marginTop: 8 }}>
                  <button className="btn-secondary" onClick={() => exportContainerAsSvg(resultsRef.current, 'independent_condition_validation')}>
                    Export SVG
                  </button>
                  <button className="btn-secondary" onClick={() => exportContainerAsPng(resultsRef.current, 'independent_condition_validation')}>
                    Export PNG
                  </button>
                  <button className="btn-secondary" onClick={() => exportValidationCSV(metrics, interpretation)}>
                    Export CSV
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
