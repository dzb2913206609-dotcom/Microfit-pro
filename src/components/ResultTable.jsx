import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { toPng, toSvg } from 'html-to-image';
import { MODELS, getParamsForDoseAxis } from '../models/inactivationModels';
import {
  formatAxisTick,
  formatMetric,
  formatPValue,
  formatParameterValue,
} from '../models/fitter';
import { getAllFactorDefs, getFactorDef } from '../config/factors.js';
import { buildPrimaryFitReportRows } from '../utils/primaryReport.js';
import { useScenario } from '../ScenarioContext';
import { FormattedLabel } from '../utils/formatLabels.jsx';

const NORMALITY_WARNING = 'Warning: residuals are not normally distributed. Consider switching models or checking for outliers.';

const SHAPES = [
  ({ cx, cy, fill }) => (
    <circle cx={cx} cy={cy} r={4.5} fill={fill} stroke="white" strokeWidth={1.2} />
  ),
  ({ cx, cy, fill }) => (
    <polygon points={`${cx},${cy - 5} ${cx - 4.5},${cy + 4} ${cx + 4.5},${cy + 4}`}
      fill={fill} stroke="white" strokeWidth={1.2} />
  ),
  ({ cx, cy, fill }) => (
    <rect x={cx - 4} y={cy - 4} width={8} height={8} fill={fill} stroke="white" strokeWidth={1.2} />
  ),
  ({ cx, cy, fill }) => (
    <polygon points={`${cx},${cy - 5.5} ${cx - 5.5},${cy} ${cx},${cy + 5.5} ${cx + 5.5},${cy}`}
      fill={fill} stroke="white" strokeWidth={1.2} />
  ),
  ({ cx, cy, fill }) => (
    <path d={`M${cx - 4.5},${cy} L${cx + 4.5},${cy} M${cx},${cy - 4.5} L${cx},${cy + 4.5}`}
      stroke={fill} strokeWidth={2.5} fill="none" />
  ),
];

function getShape(shapeIdx) {
  return SHAPES[shapeIdx % SHAPES.length];
}

function ShapeIcon({ ds, dsIdx }) {
  const renderShape = getShape(ds?.shapeIdx ?? dsIdx ?? 0);
  return (
    <svg width="16" height="16" style={{ flexShrink: 0 }}>
      {renderShape({ cx: 8, cy: 8, fill: ds?.color ?? '#1f3b73' })}
    </svg>
  );
}

function stripModelName(name) {
  return (name ?? '').replace(/\s*\(.*\)\s*$/, '').trim();
}

function sanitizeFileNamePart(value) {
  return String(value ?? 'Unknown')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '') || 'Unknown';
}

function buildResultBaseName(datasetName, modelName) {
  return `${sanitizeFileNamePart(datasetName)}_${sanitizeFileNamePart(modelName)}_Result`;
}

function escapeCSV(value) {
  if (value == null) return '';
  const text = String(value);
  if (/[,"\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

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

const EXPORT_OPTIONS = {
  backgroundColor: '#ffffff',
  pixelRatio: 3,
  style: { margin: '0', padding: '8px' },
};

async function exportContainerAsSvg(container, baseName) {
  if (!container) return;
  try {
    const dataUrl = await toSvg(container, EXPORT_OPTIONS);
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    triggerDownload(blob, `${baseName}.svg`);
  } catch (err) {
    console.error('SVG export failed:', err);
    alert('SVG export failed. Please try again.');
  }
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
    alert('PNG export failed. Please try again.');
  }
}

function downloadCsvFile(fileName, lines) {
  const csv = lines.map((line) => line.map(escapeCSV).join(',')).join('\n');
  triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8' }), fileName);
}

function buildResidualChartData(residuals = []) {
  return residuals.map((residual, index) => ({ index: index + 1, residual }));
}

function ExportActions({ chartRef, baseName }) {
  return (
    <div className="export-actions">
      <button className="btn-secondary" onClick={() => exportContainerAsSvg(chartRef?.current, baseName)}>
        Export SVG
      </button>
      <button className="btn-secondary" onClick={() => exportContainerAsPng(chartRef?.current, baseName)}>
        Export PNG
      </button>
    </div>
  );
}

function downloadPrimaryFitReport(dataset, result, visibleFactors, axisInfo) {
  if (!dataset || !result) return;
  const model = MODELS[result.modelId];
  const baseName = buildResultBaseName(dataset.name, model?.name ?? result.modelId);
  downloadCsvFile(`${baseName}.csv`, buildPrimaryFitReportRows(dataset, result, model, visibleFactors, axisInfo));
}

function ResidualPlot({ residuals = [], title, exportBaseName }) {
  const chartRef = useRef(null);
  const chartData = useMemo(() => buildResidualChartData(residuals), [residuals]);

  // Residual diagnostics
  const diagnostics = useMemo(() => {
    if (residuals.length < 3) return null;
    const n = residuals.length;
    const meanR = residuals.reduce((s, v) => s + v, 0) / n;
    const maxAbs = Math.max(...residuals.map(Math.abs));

    // Trend slope: linear regression of residual vs index
    const xMean = (n - 1) / 2;
    let sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) {
      sxy += (i - xMean) * (residuals[i] - meanR);
      sxx += (i - xMean) ** 2;
    }
    const slope = sxx > 0 ? sxy / sxx : 0;
    const hasTrend = Math.abs(slope) > 0.01 * maxAbs;

    // Runs test: count sign changes
    let runs = 1;
    for (let i = 1; i < n; i++) {
      if ((residuals[i] >= 0) !== (residuals[i - 1] >= 0)) runs++;
    }
    const nPos = residuals.filter(v => v >= 0).length;
    const nNeg = n - nPos;
    const expectedRuns = nPos > 0 && nNeg > 0 ? 1 + (2 * nPos * nNeg) / n : n;
    const runsLow = runs < expectedRuns * 0.6;

    return { meanR, maxAbs, slope, hasTrend, runs, expectedRuns: Math.round(expectedRuns), runsLow };
  }, [residuals]);

  if (chartData.length === 0) {
    return <p className="hint">No residual data available.</p>;
  }

  const values = chartData.map((point) => point.residual);
  const minResidual = Math.min(...values, 0);
  const maxResidual = Math.max(...values, 0);

  return (
    <div className="residual-plot-panel">
      <div className="chart-header">
        <h3>{title}</h3>
        <ExportActions chartRef={chartRef} baseName={`${exportBaseName}_Residual`} />
      </div>
      <div ref={chartRef}>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={chartData} margin={{ top: 10, right: 24, bottom: 36, left: 6 }}>
            <CartesianGrid strokeDasharray="2 4" stroke="#d9e2f2" vertical={false} />
            <XAxis
              dataKey="index"
              type="number"
              domain={[1, chartData.length]}
              allowDecimals={false}
              label={{ value: 'Sample index', position: 'insideBottom', offset: -10, style: { fontSize: 15, fill: '#334155' } }}
              tick={{ fontSize: 14, fill: '#475569' }}
              axisLine={{ stroke: '#64748b' }}
              tickLine={{ stroke: '#64748b' }}
            />
            <YAxis
              type="number"
              domain={[minResidual, maxResidual]}
              width={80}
              minTickGap={24}
              tickFormatter={formatAxisTick}
              label={{ value: 'Residual', angle: -90, position: 'insideLeft', style: { fontSize: 15, fill: '#334155' } }}
              tick={{ fontSize: 14, fill: '#475569' }}
              axisLine={{ stroke: '#64748b' }}
              tickLine={{ stroke: '#64748b' }}
            />
            <Tooltip
              formatter={(value) => formatMetric(Number(value))}
              labelFormatter={(value) => `Sample ${value}`}
            />
            <Legend verticalAlign="bottom" wrapperStyle={{ fontSize: 14, paddingTop: '20px' }} />
            <Line
              data={chartData.map((point) => ({ ...point, baseline: 0 }))}
              dataKey="baseline"
              name="Zero line"
              stroke="#94a3b8"
              strokeDasharray="4 4"
              dot={false}
              isAnimationActive={false}
            />
            <Scatter data={chartData} dataKey="residual" name="Residuals" fill="#1f3b73" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {diagnostics && (
        <div className="residual-diagnostics">
          <span>Mean residual: {diagnostics.meanR.toFixed(4)}</span>
          <span>Max |residual|: {diagnostics.maxAbs.toFixed(4)}</span>
          <span>Trend slope: {diagnostics.slope.toFixed(5)}</span>
          <span>Runs: {diagnostics.runs}/{diagnostics.expectedRuns} expected</span>
          {diagnostics.hasTrend && (
            <span className="residual-diag-warn">Systematic residual trend detected; model may miss shoulder/tail/nonlinearity.</span>
          )}
          {diagnostics.runsLow && (
            <span className="residual-diag-warn">Low runs count suggests autocorrelated residuals.</span>
          )}
        </div>
      )}
    </div>
  );
}

function LatexFormulaTooltip({ formula, formulaNote }) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef(null);
  const tooltipRef = useRef(null);
  const closeTimer = useRef(null);

  const html = useMemo(() => {
    if (!formula) return '';
    try {
      let result = katex.renderToString(formula, { displayMode: true, throwOnError: false });
      if (formulaNote) {
        result += katex.renderToString(formulaNote, { displayMode: false, throwOnError: false });
      }
      return result;
    } catch {
      return `<span>${formula}</span>`;
    }
  }, [formula, formulaNote]);

  const reposition = useCallback(() => {
    const trigger = triggerRef.current;
    const tip = tooltipRef.current;
    if (!trigger || !tip) return;
    const tr = trigger.getBoundingClientRect();
    const tt = tip.getBoundingClientRect();
    const gap = 8;
    const pad = 12;

    // Default: below, centered
    let top = tr.bottom + gap;
    let left = tr.left + tr.width / 2 - tt.width / 2;

    // Flip up if overflows bottom
    if (top + tt.height > window.innerHeight - pad) {
      top = tr.top - gap - tt.height;
    }
    // Shift horizontal to stay in viewport
    if (left < pad) left = pad;
    if (left + tt.width > window.innerWidth - pad) {
      left = window.innerWidth - pad - tt.width;
    }
    // Clamp top
    if (top < pad) top = pad;

    setPos({ top, left });
  }, []);

  useEffect(() => {
    if (visible) {
      // Reposition after portal render
      requestAnimationFrame(reposition);
    }
  }, [visible, reposition]);

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setVisible(false), 300);
  };

  const handleTriggerEnter = () => {
    cancelClose();
    setVisible(true);
  };

  useEffect(() => () => cancelClose(), []);

  return (
    <>
      <span
        ref={triggerRef}
        className="model-formula-tooltip-trigger"
        onMouseEnter={handleTriggerEnter}
        onMouseLeave={scheduleClose}
        aria-label="Show formula"
        role="img"
      >
        ⓘ
      </span>
      {visible && createPortal(
        <div
          ref={tooltipRef}
          className="model-formula-tooltip-portal"
          style={{ top: pos.top, left: pos.left }}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          role="tooltip"
          dangerouslySetInnerHTML={{ __html: html }}
        />,
        document.body,
      )}
    </>
  );
}

function computeAiccRank(r) {
  if (r.converged === false) return Infinity;
  if (r.aiccValid === false || !Number.isFinite(r.aicc)) return Infinity;
  return r.aicc;
}

function sortByAiccThenRmse(a, b) {
  const aRank = computeAiccRank(a);
  const bRank = computeAiccRank(b);
  if (aRank !== bRank) return aRank - bRank;
  return (a.rmse ?? Infinity) - (b.rmse ?? Infinity);
}

function getPenaltyReasons(r) {
  const reasons = [];

  // Check logNres >= logN0 (physically impossible)
  if (r.params?.logNres !== undefined && r.params?.logN0 !== undefined) {
    if (r.params.logNres >= r.params.logN0) {
      reasons.push('Parameter value is physically impossible: log\u2081\u2080(N_res) \u2265 log\u2081\u2080(N\u2080)');
    }
  }

  if (r.params) {
    // Check if R² ≈ 1 (over-fitted) — used for SE-unavailable context
    const overFitted = Number.isFinite(r.r2) && r.r2 > 0.9999;

    for (const name of Object.keys(r.params)) {
      const est = r.params[name];
      const se = r.paramErrors?.[name];
      if (se == null || !Number.isFinite(se)) {
        if (overFitted) {
          reasons.push(`Model over-fitted (R\u00b2 = ${r.r2.toFixed(4)}): standard errors cannot be computed`);
          break; // one message is enough for over-fit
        } else {
          reasons.push(`Parameter "${name}": standard error unavailable \u2014 model may be poorly conditioned or parameters have reached physical boundaries`);
        }
      } else if (Number.isFinite(est) && Math.abs(est) > 0 && se / Math.abs(est) > 1.0) {
        reasons.push(`Parameter "${name}" is unstable (uncertainty ${(se / Math.abs(est) * 100).toFixed(0)}% of estimate)`);
      }
    }
  }

  const df = r.n - r.k;
  if (df <= 0) {
    reasons.push(`Not enough data points (n=${r.n}) for ${r.k} parameters \u2014 results unreliable`);
  } else if (df <= 1) {
    reasons.push(`Only ${df} spare data point after fitting ${r.k} parameters`);
  } else if (df <= 2) {
    reasons.push(`Limited data: only ${df} degrees of freedom remaining`);
  }

  if (Number.isFinite(r.r2) && Number.isFinite(r.r2adj) && r.r2 - r.r2adj > 0.05) {
    reasons.push(`Possible overfitting: model complexity not justified by data (R\u00b2\u2212Adj.R\u00b2 = ${(r.r2 - r.r2adj).toFixed(4)})`);
  }

  if (r.converged === false) {
    const reasonMap = { failed_to_converge: 'lambda overflow', max_iterations: 'max iterations reached' };
    reasons.push(`Did not converge: ${reasonMap[r.convergenceReason] || r.convergenceReason}`);
  }

  if (r.boundaryWarnings?.length > 0) {
    for (const w of r.boundaryWarnings) {
      reasons.push(`Parameter "${w.paramName}" near ${w.bound} bound (${w.boundValue}); interpretation may be unstable`);
    }
  }

  if (r.aiccValid === false) {
    reasons.push(r.aiccWarning || 'AICc not valid for this sample size');
  }

  return reasons;
}

function PenaltyTooltip({ result }) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef(null);
  const tooltipRef = useRef(null);
  const closeTimer = useRef(null);

  const reasons = getPenaltyReasons(result);
  if (reasons.length === 0) return null;

  const reposition = () => {
    const trigger = triggerRef.current;
    const tip = tooltipRef.current;
    if (!trigger || !tip) return;
    const tr = trigger.getBoundingClientRect();
    const tt = tip.getBoundingClientRect();
    const gap = 8;
    const pad = 12;
    let top = tr.bottom + gap;
    let left = tr.left + tr.width / 2 - tt.width / 2;
    if (top + tt.height > window.innerHeight - pad) top = tr.top - gap - tt.height;
    if (left < pad) left = pad;
    if (left + tt.width > window.innerWidth - pad) left = window.innerWidth - pad - tt.width;
    if (top < pad) top = pad;
    setPos({ top, left });
  };

  const cancelClose = () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; } };
  const scheduleClose = () => { cancelClose(); closeTimer.current = setTimeout(() => setVisible(false), 300); };
  const handleEnter = () => { cancelClose(); setVisible(true); };

  return (
    <>
      <span
        ref={triggerRef}
        className="penalty-icon"
        onMouseEnter={() => { handleEnter(); requestAnimationFrame(reposition); }}
        onMouseLeave={scheduleClose}
      >
        {'\u26a0\ufe0f'}
      </span>
      {visible && createPortal(
        <div
          ref={(el) => { tooltipRef.current = el; if (el) requestAnimationFrame(reposition); }}
          className="penalty-tooltip-portal"
          style={{ top: pos.top, left: pos.left }}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          role="tooltip"
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Statistical risks:</div>
          <ul>
            {reasons.map((reason, i) => <li key={i}>{reason}</li>)}
          </ul>
        </div>,
        document.body,
      )}
    </>
  );
}

export default function ResultTable({ datasets, activeDatasetId, fitResults, staleConditionDatasetId }) {
  const { visibleFactorKeys, useDoseAxis, mode, timeUnit, scenario, primaryFactorKey } = useScenario();
  const doseUnit = useDoseAxis ? mode.doseAxis?.unit : null;
  const visibleFactors = getAllFactorDefs().filter((f) => visibleFactorKeys.includes(f.key) && !(scenario === 'custom' && f.key === primaryFactorKey));
  const customAxis = scenario === 'custom' ? getFactorDef(primaryFactorKey) : null;
  const axisInfo = { axisUnit: doseUnit ?? (customAxis ? customAxis.unit || customAxis.shortLabel || 'x' : timeUnit), axisLabel: useDoseAxis ? mode.doseAxis.label : customAxis?.label || 'Time' };
  const [selectedTab, setSelectedTab] = useState(null);
  const [residualTargetKey, setResidualTargetKey] = useState(null);
  // Determine which dataset to show; fall back to first that has results
  const visibleDatasets = datasets.filter((ds) => {
    return Object.values(fitResults).some(
      (r) => r.datasetId === ds.id && r.params && r.sse !== undefined && !r.failed,
    );
  });

  if (visibleDatasets.length === 0) {
    return (
      <div className="panel">
        <h2 className="panel-title">Fit Statistics</h2>
        <p className="hint">Fit the selected models to see the summary table.</p>
      </div>
    );
  }

  // Resolve active tab: user-clicked tab > activeDatasetId (from sidebar) > first with results
  const preferredId = selectedTab ?? activeDatasetId;
  const activeTab = visibleDatasets.find((d) => d.id === preferredId)?.id
    ?? visibleDatasets[0].id;

  const resultsForTab = Object.values(fitResults)
    .filter((r) => r.datasetId === activeTab && r.params && r.sse !== undefined && !r.failed)
    .sort(sortByAiccThenRmse);

  // Compute ΔAICc and Akaike weights (only converged models with valid AICc)
  const validAiccResults = resultsForTab.filter(r => r.converged !== false && r.aiccValid !== false && Number.isFinite(r.aicc));
  const aiccMin = validAiccResults.length > 0
    ? Math.min(...validAiccResults.map(r => r.aicc))
    : 0;
  const deltaAiccMap = {};
  const akaikeWeightMap = {};
  if (validAiccResults.length > 1) {
    const deltas = validAiccResults.map(r => {
      const d = r.aicc - aiccMin;
      deltaAiccMap[`${r.datasetId}_${r.modelId}`] = d;
      return d;
    });
    const expTerms = deltas.map(d => Number.isFinite(d) ? Math.exp(-0.5 * d) : 0);
    const sumExp = expTerms.reduce((s, v) => s + v, 0);
    validAiccResults.forEach((r, i) => {
      akaikeWeightMap[`${r.datasetId}_${r.modelId}`] = sumExp > 0 ? expTerms[i] / sumExp : 0;
    });
  }

  const activeDs = datasets.find((d) => d.id === activeTab);
  const residualTarget = resultsForTab.find((r) => `${r.datasetId}_${r.modelId}` === residualTargetKey) ?? null;
  const residualExportBaseName = residualTarget
    ? buildResultBaseName(activeDs?.name ?? residualTarget.datasetId, MODELS[residualTarget.modelId]?.name ?? residualTarget.modelId)
    : null;

  function exportCsvTable() {
    const escapeCSV = (v) => {
      if (v == null) return '';
      const s = String(v);
      return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [];
    lines.push(['Rank', 'Model', 'R2', 'Adj. R2', 'RMSE', 'Residual_standard_error', 'AICc_parameter_count', 'AICc', 'AICc_valid', 'deltaAICc', 'Akaike_weight', 'SSE', 'Converged', 'Convergence_reason', 'Iterations', 'Final_lambda', 'Boundary_warnings', 'Multi-start_attempts', 'Multi-start_converged', 'n'].map(escapeCSV).join(','));
    resultsForTab.forEach((r, idx) => {
      const model = MODELS[r.modelId];
      const name = stripModelName(model?.name);
      const rowKey = `${r.datasetId}_${r.modelId}`;
      const r2 = Number.isFinite(r.r2) ? r.r2.toFixed(4) : '';
      const r2adj = Number.isFinite(r.r2adj) ? r.r2adj.toFixed(4) : '';
      const rmse = Number.isFinite(r.rmse) ? r.rmse.toFixed(4) : '';
      const aicc = r.aiccValid === false ? 'N/A' : (Number.isFinite(r.aicc) ? r.aicc.toFixed(2) : '');
      const aiccValid = r.aiccValid === false ? 'No' : 'Yes';
      const dAicc = deltaAiccMap[rowKey] != null ? deltaAiccMap[rowKey].toFixed(2) : '';
      const wAicc = akaikeWeightMap[rowKey] != null ? akaikeWeightMap[rowKey].toFixed(4) : '';
      const sse = Number.isFinite(r.sse) ? r.sse.toFixed(6) : '';
      const conv = r.converged !== undefined ? (r.converged ? 'Yes' : 'No') : '';
      const convReason = r.convergenceReason?.replace(/_/g, ' ') ?? '';
      const finalLambda = Number.isFinite(r.finalLambda) ? r.finalLambda.toExponential(2) : '';
      const bndWarn = r.boundaryWarnings?.length > 0 ? r.boundaryWarnings.map(w => `${w.paramName}(${w.bound})`).join('; ') : '';
      const msAttempts = r.multiStart?.totalAttempts ?? '';
      const msConv = r.multiStart?.convergedCount ?? '';
      lines.push([idx + 1, name, r2, r2adj, rmse, r.residualSE ?? '', r.aiccParameterCount ?? '', aicc, aiccValid, dAicc, wAicc, sse, conv, convReason, r.iterations ?? '', finalLambda, bndWarn, msAttempts, msConv, r.n].map(escapeCSV).join(','));
    });
    const csv = lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sanitizeFileNamePart(activeDs?.name ?? 'FitStatistics')}_ModelComparison.csv`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  return (
    <div className="panel">
      <div className="fit-stats-header">
        <h2 className="panel-title">Fit Statistics</h2>
        <button className="btn-copy-latex" onClick={exportCsvTable}>
          Export CSV
        </button>
        {visibleDatasets.length > 1 && (
          <div className="ds-tab-bar">
            {visibleDatasets.map((ds) => (
              <button
                key={ds.id}
                className={`ds-tab ${ds.id === activeTab ? 'active' : ''}`}
                style={{ '--ds-color': ds.color }}
                onClick={() => setSelectedTab(ds.id)}
              >
                <ShapeIcon ds={ds} />
                {ds.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {staleConditionDatasetId === activeTab && (
        <div className="fit-stale-hint">
          Conditions changed — parameters above are stale. Re-select this dataset to re-fit.
        </div>
      )}

      {visibleDatasets.length === 1 && activeDs && (
        <div className="ds-label-row">
          <ShapeIcon ds={activeDs} />
          <span className="ds-label-name">{activeDs.name}</span>
        </div>
      )}

      <p className="hint">Fits and statistics use all supplied individual observations. Charts show mean ± SD; n counts the observations used in fitting.</p>
      <div className="table-scroll">
        <table className="result-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Model</th>
              <th>R²</th>
              <th>Adj. R²</th>
              <th>RMSE</th>
              <th><FormattedLabel text="AICc" /></th>
              <th>Δ<FormattedLabel text="AICc" /></th>
              <th>w<sub>i</sub></th>
              <th>SSE</th>
              <th>n</th>
              <th>Parameters</th>
              <th>Residuals</th>
            </tr>
          </thead>
          <tbody>
            {resultsForTab.map((r, idx) => {
              const model = MODELS[r.modelId];
              const displayParams = getParamsForDoseAxis(model?.params ?? [], axisInfo.axisUnit);
              const parameterItems = displayParams?.map((p) => {
                const v = r.params[p.name];
                const se = r.paramErrors?.[p.name];
                const ci = r.paramCI95?.[p.name];
                const unstable = se == null || !Number.isFinite(se) ||
                  (Number.isFinite(v) && Math.abs(v) > 0 && Number.isFinite(se) && se / Math.abs(v) > 1.0);
                return {
                  key: p.name,
                  label: p.label,
                  value: formatParameterValue(v),
                  se: Number.isFinite(se) ? formatParameterValue(se) : null,
                  ci: ci && Number.isFinite(ci[0]) && Number.isFinite(ci[1])
                    ? `[${formatParameterValue(ci[0])}, ${formatParameterValue(ci[1])}]`
                    : null,
                  unstable,
                };
              }) ?? [];

              if (r.modelId === 'LOG_LINEAR' && Number.isFinite(r.params?.kmax) && r.params.kmax > 0) {
                const k = r.params.kmax;
                const Dval = Math.LN10 / k;
                const xUnit = axisInfo.axisUnit;
                const kSe = r.paramErrors?.kmax;
                const Dse = Number.isFinite(kSe) && k > 0 ? (Math.LN10 / (k * k)) * kSe : null;
                const kCi = r.paramCI95?.kmax;
                const Dci = kCi && Number.isFinite(kCi[0]) && Number.isFinite(kCi[1]) && kCi[0] > 0 && kCi[1] > 0
                  ? [Math.LN10 / kCi[1], Math.LN10 / kCi[0]]
                  : null;
                parameterItems.push({
                  key: 'D_value_derived',
                  label: `D-value (${xUnit})`,
                  value: formatParameterValue(Dval),
                  se: Dse ? formatParameterValue(Dse) : null,
                  ci: Dci ? `[${formatParameterValue(Dci[0])}, ${formatParameterValue(Dci[1])}]` : null,
                  unstable: false,
                  derived: true,
                  formula: 'D = ln(10) / k_max',
                });
              }
              const isNonNormal = Number.isFinite(r.normalityPValue) && r.normalityPValue < 0.05;
              const rowKey = `${r.datasetId}_${r.modelId}`;

              return (
                <tr key={rowKey} className={idx === 0 ? 'best-row' : ''}>
                  <td>{idx + 1}</td>
                  <td>
                    <div className="model-cell">
                      <div className="model-main-line">
                        <strong>{stripModelName(model?.name)}</strong>
                        <PenaltyTooltip result={r} />
                        <LatexFormulaTooltip formula={model?.formula} formulaNote={model?.formulaNote} />
                      </div>
                      <div className={`normality-pill ${isNonNormal ? 'warn' : 'pass'}`}>
                        Normality (p): {formatPValue(r.normalityPValue)}
                      </div>
                      <div className={`normality-pill ${Number.isFinite(r.runsTestP) && r.runsTestP < 0.05 ? 'warn' : 'pass'}`}>
                        Runs test (p): {formatPValue(r.runsTestP)}
                      </div>
                      <div className="normality-pill pass" style={{fontSize:'0.72em'}}>
                        Trend slope: {Number.isFinite(r.resTrendSlope) ? r.resTrendSlope.toFixed(4) : 'NA'} | Max |res|: {Number.isFinite(r.maxAbsResidual) ? r.maxAbsResidual.toFixed(3) : 'NA'}
                      </div>
                    </div>
                  </td>
                  <td className={r.r2 > 0.99 ? 'good' : r.r2 > 0.95 ? 'ok' : 'poor'}>
                    {formatMetric(r.r2)}
                  </td>
                  <td className={r.r2adj > 0.99 ? 'good' : r.r2adj > 0.95 ? 'ok' : 'poor'}>
                    {formatMetric(r.r2adj)}
                  </td>
                  <td>{formatMetric(r.rmse)}</td>
                  <td>{r.aiccValid === false ? <span title={r.aiccWarning || ''} style={{color:'#b91c1c',cursor:'help'}}>N/A</span> : formatMetric(r.aicc)}</td>
                  <td className={(() => {
                    const d = deltaAiccMap[rowKey];
                    return d != null && d < 2 ? 'good' : d != null && d < 7 ? 'ok' : 'poor';
                  })()}>
                    {deltaAiccMap[rowKey] != null ? deltaAiccMap[rowKey].toFixed(1) : '—'}
                  </td>
                  <td>{akaikeWeightMap[rowKey] != null ? akaikeWeightMap[rowKey].toFixed(3) : '—'}</td>
                  <td>{formatMetric(r.sse)}</td>
                  <td>{r.n}</td>
                  <td className="param-cell">
                    <div className="param-list">
                      {parameterItems.map((item) => (
                        <div key={item.key} className="param-item">
                          <div className={`param-main${item.unstable ? ' param-unstable' : ''}${item.derived ? ' param-derived' : ''}`}>
                            <FormattedLabel text={item.label} />:{item.value}{item.se ? `\u00b1${item.se}` : ''}
                          </div>
                          {item.ci && <div className="param-ci-line">{item.ci}</div>}
                        </div>
                      ))}
                    </div>
                    {r.converged !== undefined && (
                      <div className={`convergence-info ${r.converged ? 'converged' : 'not-converged'}`} style={{marginTop:4,fontSize:'0.82em',padding:'2px 6px',borderRadius:4,background:r.converged?'#ecfdf5':'#fef2f2',color:r.converged?'#065f46':'#991b1b'}}>
                        {r.converged ? '✓ Converged' : '✗ Not converged'} ({r.convergenceReason?.replace(/_/g,' ')}) · {r.iterations} iter
                        {r.multiStart && ` · Best of ${r.multiStart.convergedCount}/${r.multiStart.totalAttempts} starts`}
                      </div>
                    )}
                    {r.boundaryWarnings?.length > 0 && (
                      <div style={{marginTop:2,fontSize:'0.8em',color:'#92400e',background:'#fffbeb',padding:'2px 6px',borderRadius:4}}>
                        ⚠ Near bound: {r.boundaryWarnings.map((w, i) => (
                          <Fragment key={`${w.paramName}_${w.bound}_${i}`}>
                            {i > 0 ? ', ' : ''}<FormattedLabel text={`${w.paramName} (${w.bound})`} />
                          </Fragment>
                        ))} — interpretation may be unstable
                      </div>
                    )}
                    {isNonNormal && <div className="normality-warning">{NORMALITY_WARNING}</div>}
                  </td>
                  <td>
                    <div className="table-action-stack">
                      <button className="btn-secondary" onClick={() => setResidualTargetKey(rowKey)}>
                        Show residual plot
                      </button>
                      <button className="btn-secondary" onClick={() => downloadPrimaryFitReport(activeDs, r, visibleFactors, axisInfo)}>
                        Export fit report (CSV)
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {residualTarget && (
        <ResidualPlot
          residuals={residualTarget.residuals}
          title={`${stripModelName(MODELS[residualTarget.modelId]?.name)} Residual Plot`}
          exportBaseName={residualExportBaseName}
        />
      )}

      <BestModelSummary fittedResults={resultsForTab} />
    </div>
  );
}

function BestModelSummary({ fittedResults }) {
  const convergedResults = fittedResults.filter(r => r.converged !== false);
  const validAicc = convergedResults.filter(r => r.aiccValid !== false && Number.isFinite(r.aicc));
  const rankedByAicc = validAicc.length > 0;
  const best = rankedByAicc
    ? validAicc.reduce((a, b) => a.aicc < b.aicc ? a : b)
    : convergedResults.sort((a, b) => (a.rmse ?? Infinity) - (b.rmse ?? Infinity))[0];
  if (!best) return null;
  const isNonNormal = Number.isFinite(best.normalityPValue) && best.normalityPValue < 0.05;

  return (
    <div className="dvalue-box">
      <h3>Best model summary {rankedByAicc ? <>(by <FormattedLabel text="AICc" />)</> : <>(by RMSE — <FormattedLabel text="AICc" /> unavailable)</>}</h3>
      {!rankedByAicc && (
        <div style={{fontSize:'0.85em',color:'#92400e',background:'#fffbeb',padding:'4px 8px',borderRadius:4,marginBottom:8}}>
          <FormattedLabel text="AICc" /> ranking unavailable because converged models have insufficient sample size (n ≤ k+2) or zero residual variance; RMSE ranking is shown for descriptive purposes only.
        </div>
      )}
      <div className="dvalue-grid">
        <div className="dvalue-item">
          <span className="dv-label">Model</span>
          <span className="dv-value compact">{stripModelName(MODELS[best.modelId]?.name)}</span>
        </div>
        <div className="dvalue-item">
          <span className="dv-label">R²</span>
          <span className="dv-value">{formatMetric(best.r2)}</span>
        </div>
        <div className="dvalue-item">
          <span className="dv-label">RMSE</span>
          <span className="dv-value">{formatMetric(best.rmse)}</span>
        </div>
        <div className="dvalue-item">
          <span className="dv-label"><FormattedLabel text="AICc" /></span>
          <span className="dv-value">{best.aiccValid === false ? 'N/A' : formatMetric(best.aicc)}</span>
        </div>
        <div className="dvalue-item">
          <span className="dv-label">Converged</span>
          <span className="dv-value" style={{color: best.converged ? '#065f46' : '#991b1b'}}>{best.converged ? 'Yes' : 'No'}</span>
        </div>
        <div className="dvalue-item">
          <span className="dv-label">Shapiro-Wilk p</span>
          <span className="dv-value">{formatPValue(best.normalityPValue)}</span>
        </div>
        <div className="dvalue-item">
          <span className="dv-label">Runs test p</span>
          <span className="dv-value">{formatPValue(best.runsTestP)}</span>
        </div>
        <div className="dvalue-item">
          <span className="dv-label">Trend slope</span>
          <span className="dv-value">{Number.isFinite(best.resTrendSlope) ? best.resTrendSlope.toFixed(4) : 'NA'}</span>
        </div>
        <div className="dvalue-item">
          <span className="dv-label">Max |residual|</span>
          <span className="dv-value">{Number.isFinite(best.maxAbsResidual) ? best.maxAbsResidual.toFixed(3) : 'NA'}</span>
        </div>
      </div>
      {isNonNormal && <div className="normality-warning summary-warning">{NORMALITY_WARNING}</div>}
    </div>
  );
}
