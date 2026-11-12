import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MonteCarloPanel from './MonteCarloPanel';
import ExternalValidation from './ExternalValidation';
import SecondaryFitSummary from './SecondaryFitSummary';
import Plotly from 'plotly.js-dist-min';

const Plot = lazy(() => import('./PlotlyChart'));
import { MODELS, predictCurve } from '../models/inactivationModels';
import {
  formatMetric,
  formatPValue,
  formatParameterValue,
} from '../models/fitter';
import {
  MODEL_SECONDARY_CONFIG,
  SECONDARY_MODELS,
  FACTOR_DEFS,
  computeLinkedPrimaryCurveMetrics,
  createDefaultFactorState,
  fitSecondaryModel,
  getAvailablePrimaryModels,
  getFactorDefsWithCustom,
  getFactorDefs,
  getSecondaryModelList,
  secondaryResponseToRaw,
  predictPrimaryParams,
} from '../models/secondaryModels';
import { useScenario } from '../ScenarioContext';
import { getAllFactorDefs, getFactorDef } from '../config/factors';
import { computePaddedAxisRange } from '../utils/chartRanges.js';
import { formatLabelToHtml } from '../utils/formatLabels.js';
import { FormattedLabel } from '../utils/formatLabels.jsx';
import { fittingInputSignature, scheduleFit } from '../utils/fittingState.js';
import { buildRowsForSecondary, rankSecondaryCandidates, reconcileSecondaryFits } from '../utils/secondaryFitState.js';
import { readDelimitedRecords } from '../utils/pastePreview.js';

const NORMALITY_WARNING = 'Warning: residuals are not normally distributed. Consider switching models or checking for outliers.';

function getInverseTransform(responseTransforms, targetConfig = {}, secondaryModelId) {
  const t = targetConfig.responseTransformMap?.[secondaryModelId] ?? responseTransforms?.[0] ?? targetConfig.responseTransform ?? 'identity';
  const reciprocal = targetConfig.rateLikeModels?.includes(secondaryModelId);
  const rawLabel = targetConfig.label ?? 'parameter';
  const fitLabel = reciprocal ? `1/${rawLabel}` : rawLabel;
  const transformedLabel = t === 'logD' ? `log₁₀(${fitLabel})`
    : t === 'lnValue' ? `ln(${fitLabel})` : t === 'sqrtValue' ? `√(${fitLabel})` : fitLabel;
  return {
    fn: (value) => secondaryResponseToRaw({ value, targetConfig, secondaryModelId }),
    stripLabel: () => rawLabel,
    transformedLabel,
    isIdentity: t === 'identity' && !reciprocal,
  };
}

function rankCandidates(candidates, primaryParameter = false) {
  const ranked = rankSecondaryCandidates(candidates, { primaryParameter });
  candidates.splice(0, candidates.length, ...ranked);
  return candidates;
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

function getParamDisplayLabel(param) {
  return param?.name === 'logDref' ? 'D_ref' : param?.label;
}

function getFactorShortLabel(key) {
  const factor = getFactorDef(key);
  return factor?.shortLabel ?? factor?.label ?? key;
}

function getAllowedSecondaryIds(ids = [], scenario, mode) {
  const allowed = ids.filter((id) => SECONDARY_MODELS[id]?.scenarios?.includes(scenario));
  if (scenario !== 'custom') return allowed;

  const customIds = mode?.applicableSecondaryModels?.length
    ? mode.applicableSecondaryModels
    : ['CUSTOM_Z1', 'CUSTOM_Z2', 'CUSTOM_Z3', 'LINEAR_CUSTOM', 'AVERAGE'];
  const rankedCustomIds = customIds
    .filter((id) => SECONDARY_MODELS[id]?.scenarios?.includes('custom'))
    .sort((a, b) => {
      const aFactors = SECONDARY_MODELS[a]?.factorKeys?.length ?? 0;
      const bFactors = SECONDARY_MODELS[b]?.factorKeys?.length ?? 0;
      return bFactors - aFactors;
    });
  const result = [];
  const seen = new Set();
  rankedCustomIds.forEach((id) => {
    if (!seen.has(id)) {
      result.push(id);
      seen.add(id);
    }
  });
  allowed.forEach((id) => {
    if (!seen.has(id)) {
      result.push(id);
      seen.add(id);
    }
  });
  return result;
}

function getReferenceFactorKey(paramName, model, mode) {
  const refMap = {
    Tref: 'temp',
    awRef: 'aw',
    pHref: 'pH',
    Pref: 'pressure',
    Iref: 'intensity',
    Eref: 'electricField',
    Cref: 'concentration',
    DRref: 'doseRate',
    sigmaRef: 'conductivity',
  };
  if (refMap[paramName]) return refMap[paramName];
  const match = /^x(\d+)ref$/.exec(paramName);
  if (match) {
    const idx = Number(match[1]) - 1;
    return model?.factorKeys?.[idx] ?? mode?.profileColumns?.[idx] ?? null;
  }
  return null;
}

function getSecondaryRouteOptionLabel(fit, primaryModelId) {
  const secondaryModel = SECONDARY_MODELS[fit?.secondaryModelId];
  const modelName = stripModelName(secondaryModel?.name ?? fit?.secondaryModelId ?? '');
  const factorKeys = secondaryModel?.factorKeys ?? [];
  const factorTag = factorKeys.length > 0
    ? ` [${factorKeys.map(getFactorShortLabel).join(' + ')}]`
    : '';
  const targetLabel = MODEL_SECONDARY_CONFIG[primaryModelId]?.targets?.[fit?.targetKey]?.label ?? fit?.targetKey ?? '';
  return `${modelName}${factorTag} → ${targetLabel}`;
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

function downloadCsvFile(fileName, lines) {
  const csv = lines.map((line) => line.map(escapeCSV).join(',')).join('\n');
  triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8' }), fileName);
}

function downloadJsonFile(fileName, value) {
  triggerDownload(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' }),
    fileName,
  );
}

function buildResidualChartData(residuals = []) {
  return residuals.map((residual, index) => ({ index: index + 1, residual }));
}

function PlotlyExportActions({ plotId, baseName }) {
  const handleExport = (format) => {
    const gd = document.getElementById(plotId);
    if (!gd) return;
    const currentLayout = gd.layout || {};
    const exportLayout = {
      ...currentLayout,
      margin: { l: 80, r: 30, b: 80, t: 40, pad: 4 },
      xaxis: { ...currentLayout.xaxis, title: { ...currentLayout.xaxis?.title, standoff: 14 } },
      yaxis: { ...currentLayout.yaxis, title: { ...currentLayout.yaxis?.title, standoff: 14 } },
    };
    Plotly.relayout(gd, exportLayout).then(() => {
      Plotly.downloadImage(gd, {
        format,
        filename: baseName,
        width: 1200,
        height: 750,
        scale: 3,
      }).finally(() => {
        Plotly.relayout(gd, currentLayout);
      });
    });
  };

  return (
    <div className="export-actions">
      <button className="btn-secondary" onClick={() => handleExport('svg')}>
        Export SVG
      </button>
      <button className="btn-secondary" onClick={() => handleExport('png')}>
        Export PNG
      </button>
    </div>
  );
}

function buildSecondaryFitReportRows(activeFit) {
  const secondaryModel = SECONDARY_MODELS[activeFit?.secondaryModelId];
  const primaryModel = MODELS[activeFit?.primaryModelId];
  const targetLabel = MODEL_SECONDARY_CONFIG[activeFit?.primaryModelId]?.targets?.[activeFit?.targetKey]?.label;
  const rows = [];

  rows.push(['Section', 'Field', 'Value']);
  rows.push(['Basic Info', 'Dataset', activeFit?.rows?.map((row) => row.datasetName).join(' | ') ?? '']);
  rows.push(['Basic Info', 'Model', secondaryModel?.name ?? activeFit?.secondaryModelId ?? '']);
  rows.push(['Basic Info', 'Primary model', primaryModel?.name ?? activeFit?.primaryModelId ?? '']);
  rows.push(['Basic Info', 'Target', targetLabel ?? activeFit?.targetKey ?? '']);
  rows.push(['Basic Info', 'n', activeFit?.n ?? activeFit?.rows?.length ?? 0]);
  rows.push([]);

  rows.push(['Statistics', 'Metric', 'Value']);
  rows.push(['Statistics', 'R2', activeFit?.r2 ?? '']);
  rows.push(['Statistics', 'Adj. R2', activeFit?.r2adj ?? '']);
  rows.push(['Statistics', 'RMSE (regression scale)', activeFit?.rmse ?? '']);
  rows.push(['Statistics', 'Regression scale', activeFit?.rmseScale ?? '']);
  rows.push(['Statistics', 'Residual standard error', activeFit?.residualSE ?? '']);
  rows.push(['Statistics', 'Raw target RMSE', activeFit?.rawTargetRMSE ?? '']);
  rows.push(['Statistics', 'Linked curve-level RMSE', activeFit?.linkedCurveMetrics?.rmse ?? '']);
  rows.push(['Statistics', 'Linked curve-level n', activeFit?.linkedCurveMetrics?.n ?? '']);
  rows.push(['Statistics', 'AICc', activeFit?.aiccValid === false ? 'N/A' : activeFit?.aicc ?? '']);
  rows.push(['Statistics', 'AICc response scale', activeFit?.aiccScale ?? '']);
  rows.push(['Statistics', 'AICc parameter count (including variance)', activeFit?.aiccParameterCount ?? '']);
  rows.push(['Statistics', 'Residual normality p-value', activeFit?.normalityPValue ?? '']);
  rows.push([]);

  rows.push(['Parameters', 'Parameter', 'Estimate', 'Standard Error', '95% CI Lower', '95% CI Upper']);
  (secondaryModel?.params ?? []).forEach((param) => {
    const ci = activeFit?.paramCI95?.[param.name];
    rows.push([
      'Parameters',
      param.fixed ? `${param.label} (fixed)` : param.label,
      activeFit?.params?.[param.name] ?? '',
      param.fixed ? '—' : (activeFit?.paramErrors?.[param.name] ?? ''),
      param.fixed ? '—' : (ci?.[0] ?? ''),
      param.fixed ? '—' : (ci?.[1] ?? ''),
    ]);
  });
  rows.push([]);

  if (activeFit?.linkedCurveMetrics?.perDataset?.length) {
    rows.push(['Linked curve-level RMSE', 'Dataset', 'n', 'RMSE', 'Predicted raw target', 'Primary parameter', 'Primary parameter value']);
    activeFit.linkedCurveMetrics.perDataset.forEach((entry) => {
      rows.push([
        'Linked curve-level RMSE',
        entry.datasetName,
        entry.n,
        entry.rmse,
        entry.predictedRawValue,
        entry.primaryParamName,
        entry.primaryParamValue,
      ]);
    });
    rows.push([]);
  }

  rows.push(['Observed vs Predicted', 'Primary Factor', 'aw', 'Observed', 'Predicted', 'Residual']);
  (activeFit?.rows ?? []).forEach((row, index) => {
    const predicted = secondaryModel?.predictY ? secondaryModel.predictY(row.factors, activeFit?.params ?? {}) : null;
    rows.push([
      'Observed vs Predicted',
      row.x,
      row.factors?.aw ?? 1,
      row.y,
      Number.isFinite(predicted) ? predicted : '',
      activeFit?.residuals?.[index] ?? '',
    ]);
  });

  return rows;
}

function downloadSecondaryFitReport(activeFit) {
  if (!activeFit) return;
  const secondaryModel = SECONDARY_MODELS[activeFit.secondaryModelId];
  const datasetLabel = activeFit.rows?.map((row) => row.datasetName).join('-') || 'SecondaryFit';
  const baseName = buildResultBaseName(datasetLabel, secondaryModel?.name ?? activeFit.secondaryModelId);
  downloadCsvFile(`${baseName}.csv`, buildSecondaryFitReportRows(activeFit));
}

function ResidualPlot({ residuals = [], title, exportBaseName }) {
  const plotId = `residual-plot-${exportBaseName}`;
  const chartData = useMemo(() => buildResidualChartData(residuals), [residuals]);

  if (chartData.length === 0) {
    return <p className="hint">No residual data available.</p>;
  }

  const xs = chartData.map((p) => p.index);
  const ys = chartData.map((p) => p.residual);

  const traces = [
    {
      type: 'scatter', mode: 'lines', name: 'Zero line',
      x: [1, chartData.length], y: [0, 0],
      line: { color: '#94a3b8', width: 1.5, dash: 'dash' },
      hoverinfo: 'skip', showlegend: true,
    },
    {
      type: 'scatter', mode: 'markers', name: 'Residuals',
      x: xs, y: ys,
      marker: { color: '#1f3b73', size: 7, line: { color: 'white', width: 1 } },
      hovertemplate: 'Sample %{x}<br>Residual: %{y:.4f}<extra></extra>',
    },
  ];

  const layout = {
    autosize: true, height: 280,
    xaxis: {
      title: { text: 'Sample index', font: { size: 16, family: 'Inter, system-ui, sans-serif', color: '#334155' }, standoff: 8 },
      tickfont: { size: 14, color: '#475569' }, gridcolor: '#e2e8f0', zeroline: false,
      range: [0.5, chartData.length + 0.5], dtick: chartData.length <= 20 ? 1 : undefined,
    },
    yaxis: {
      title: { text: 'Residual', font: { size: 16, family: 'Inter, system-ui, sans-serif', color: '#334155' }, standoff: 8 },
      tickfont: { size: 14, color: '#475569' }, gridcolor: '#e2e8f0', zeroline: false,
    },
    legend: { orientation: 'h', xref: 'container', yref: 'container', x: 0.5, xanchor: 'center', y: 0, yanchor: 'bottom', font: { size: 14, color: '#334155' } },
    margin: { l: 75, r: 24, b: 100, t: 16, pad: 4 },
    paper_bgcolor: 'white', plot_bgcolor: 'white',
    font: { family: 'Inter, system-ui, sans-serif', color: '#334155' },
    hovermode: 'closest',
  };

  return (
    <div className="residual-plot-panel">
      <div className="chart-header">
        <h3>{title}</h3>
        <PlotlyExportActions plotId={plotId} baseName={`${exportBaseName}_Residual`} />
      </div>
      <Suspense fallback={<p className="hint">Loading chart...</p>}>
        <Plot divId={plotId} data={traces} layout={layout}
          config={{ responsive: true, displayModeBar: true, toImageButtonOptions: { format: 'png', width: 1200, height: 750, scale: 3 } }} style={{ width: '100%' }} useResizeHandler />
      </Suspense>
    </div>
  );
}

function buildInitialManualParams(modelId, overrides = null) {
  const model = MODELS[modelId];
  if (!model) return {};
  const params = model.params.reduce((acc, param) => {
    acc[param.name] = param.defaultValue;
    return acc;
  }, {});
  return { ...params, ...(overrides ?? {}) };
}

function FormulaNote({ note }) {
  if (!note) return null;

  return <div className="hint" style={{ fontSize: 14, marginTop: 4 }}>{note}</div>;
}

const CONTOUR_STEPS = 50; // grid resolution per axis

/**
 * Generic contour/surface data generator.
 * Uses factorKeys from the secondary model to determine which axes to vary.
 * xKey and yKey specify which factor maps to X and Y axes.
 * All other factors use their defaults from FACTORS or from factorValues.
 */
function generateGridData(fittedModel, rows, xKey, yKey, factorValues = {}, valueFn = null) {
  if (!fittedModel || !rows.length) return null;

  const xFactor = getFactorDef(xKey);
  const yFactor = getFactorDef(yKey);
  if (!xFactor || !yFactor) return null;

  // Determine X range from data or factor bounds
  const xValues = rows.map((r) => xKey === r.factorKeyForX ? r.x : (r.factors?.[xKey] ?? xFactor.default));
  const dataXMin = Math.min(...xValues);
  const dataXMax = Math.max(...xValues);
  const xPad = (dataXMax - dataXMin) * 0.1 || xFactor.step * 5;
  const xMin = Math.max(xFactor.min, dataXMin - xPad);
  const xMax = Math.min(xFactor.max, dataXMax + xPad);

  // Determine Y range from data or factor bounds. Deriving the range from the
  // observed factors keeps low-aw datasets (for example aw 0.10-0.30) visible;
  // a hardcoded lower bound would clip them out of the contour and 3D surface.
  const yValues = rows.map((r) => r.factors?.[yKey] ?? yFactor.default);
  const dataYMin = Math.min(...yValues);
  const dataYMax = Math.max(...yValues);
  const yPad = (dataYMax - dataYMin) * 0.1 || yFactor.step * 5;
  const yMin = Math.max(yFactor.min, dataYMin - yPad);
  const yMax = Math.min(yFactor.max, dataYMax + yPad);

  const xArr = Array.from({ length: CONTOUR_STEPS }, (_, i) => xMin + (xMax - xMin) * i / (CONTOUR_STEPS - 1));
  const yArr = Array.from({ length: CONTOUR_STEPS }, (_, i) => yMin + (yMax - yMin) * i / (CONTOUR_STEPS - 1));

  // Build base factors with defaults for all keys, so no factor is ever undefined
  const allDefaults = Object.fromEntries(
    getAllFactorDefs().map((f) => [f.key, f.default])
  );

  const zArr = yArr.map((yVal) =>
    xArr.map((xVal) => {
      // Order: defaults < user sliders < grid axes
      const factors = { ...allDefaults, ...factorValues, [xKey]: xVal, [yKey]: yVal };
      const val = SECONDARY_MODELS[fittedModel.secondaryModelId]?.predictY(factors, fittedModel.params);
      return Number.isFinite(val) ? (valueFn ? valueFn(val) : Math.pow(10, val)) : null;
    }),
  );

  return { x: xArr, y: yArr, z: zArr };
}

function ContourPlot({ fittedModel, rows, factorKeys, factorValues = {}, targetLabel = 'D value', transformedLabel = '', showOriginalScale = true, inverseTransform: invTx = null }) {
  const xKey = factorKeys[0];
  const yKey = factorKeys[1];
  const inverseFn = invTx?.fn;
  const transformValue = useCallback((value) => (
    showOriginalScale ? (inverseFn ? inverseFn(value) : Math.pow(10, value)) : value
  ), [showOriginalScale, inverseFn]);
  const displayLabel = showOriginalScale ? targetLabel : (transformedLabel || targetLabel);
  const displayLabelHtml = formatLabelToHtml(displayLabel);
  const grid = useMemo(() => {
    return generateGridData(fittedModel, rows, xKey, yKey, factorValues, transformValue);
  }, [fittedModel, rows, xKey, yKey, factorValues, transformValue]);

  if (!grid) {
    return (
      <div className="panel chart-placeholder">
        <p>Fit a multi-variable model to enable the Contour Plot.</p>
      </div>
    );
  }

  const xFactor = getFactorDef(xKey);
  const yFactor = getFactorDef(yKey);
  const xAxisLabel = xFactor ? `${xFactor.label}${xFactor.unit ? ` (${xFactor.unit})` : ''}` : xKey;
  const yAxisLabel = yFactor ? `${yFactor.label}${yFactor.unit ? ` (${yFactor.unit})` : ''}` : yKey;
  const xHoverFmt = xFactor
    ? `${xFactor.shortLabel}: %{x:.${xKey === 'pressure' ? '0' : '1'}f}${xFactor.unit ? ` ${xFactor.unit}` : ''}`
    : `${xKey}: %{x:.1f}`;
  const yHoverFmt = yFactor
    ? `${yFactor.shortLabel}: %{y:.3f}${yFactor.unit ? ` ${yFactor.unit}` : ''}`
    : `${yKey}: %{y:.3f}`;

  const contourTrace = {
    type: 'contour',
    x: grid.x,
    y: grid.y,
    z: grid.z,
    colorscale: 'Viridis',
    contours: { coloring: 'heatmap', showlabels: true, labelfont: { size: 14, color: 'white' } },
    colorbar: { title: { text: displayLabelHtml, side: 'right', font: { size: 20 } }, tickfont: { size: 16 }, thickness: 20, len: 0.85 },
    name: `${displayLabel} predicted`,
    hovertemplate: `${xHoverFmt}<br>${yHoverFmt}<br>${displayLabel}: %{z:.3f}<extra></extra>`,
    showscale: true,
  };

  const scatterTrace = {
    type: 'scatter',
    mode: 'markers',
    x: rows.map((r) => r.factors?.[xKey] ?? xFactor?.default),
    y: rows.map((r) => r.factors?.[yKey] ?? yFactor?.default),
    marker: { color: 'white', size: 9, symbol: 'circle', line: { color: 'black', width: 1.5 } },
    showlegend: true,
    name: 'Experimental Data Points',
    hovertemplate: `${xHoverFmt}<br>${yHoverFmt}<extra>Observed</extra>`,
  };

  const axisTitleFont = { size: 22, family: 'Inter, system-ui, sans-serif', color: '#334155' };
  const tickFont = { size: 17, family: 'Inter, system-ui, sans-serif', color: '#475569' };

  const layout = {
    autosize: true,
    xaxis: { title: { text: formatLabelToHtml(xAxisLabel), font: axisTitleFont, standoff: 8 }, tickfont: tickFont, gridcolor: '#e2e8f0' },
    yaxis: { title: { text: formatLabelToHtml(yAxisLabel), font: axisTitleFont, standoff: 8 }, tickfont: tickFont, gridcolor: '#e2e8f0' },
    legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: -0.15, yanchor: 'top', font: { size: 14, color: '#334155' }, bgcolor: 'rgba(255, 255, 255, 0)', bordercolor: 'rgba(0, 0, 0, 0)', borderwidth: 0 },
    margin: { l: 90, r: 45, b: 100, t: 30, pad: 4 },
    paper_bgcolor: 'white',
    plot_bgcolor: 'white',
    font: { family: 'Inter, system-ui, sans-serif', color: '#334155' },
  };

  return (
    <div className="secondary-plot-content">
      <h3 className="secondary-plot-caption">
        Contour Plot — <FormattedLabel text={displayLabel} /> vs <FormattedLabel text={xFactor?.shortLabel ?? xKey} /> &amp; <FormattedLabel text={yFactor?.shortLabel ?? yKey} />
      </h3>
      <Suspense fallback={<div className="plot-loading-placeholder">Loading chart...</div>}>
        <Plot
          divId="microfit-contour-plot"
          data={[contourTrace, scatterTrace]}
          layout={layout}
          config={{ responsive: true, scrollZoom: false, displayModeBar: true, modeBarButtonsToAdd: ['resetScale2d'], toImageButtonOptions: { format: 'png', width: 1200, height: 750, scale: 3 } }}
          style={{ width: '100%', height: 580 }}
          useResizeHandler={true}
        />
      </Suspense>
    </div>
  );
}


function ResponseSurface3D({ fittedModel, rows, factorKeys, factorValues = {}, targetLabel = 'D value', transformedLabel = '', showOriginalScale = true, inverseTransform: invTx = null }) {
  const availableFactors = factorKeys.filter((k) => getFactorDef(k));
  const [xKey, setXKey] = useState(availableFactors[0] ?? 'temp');
  const [yKey, setYKey] = useState(availableFactors[1] ?? 'aw');
  const inverseFn = invTx?.fn;
  const transformValue = useCallback((value) => (
    showOriginalScale ? (inverseFn ? inverseFn(value) : Math.pow(10, value)) : value
  ), [showOriginalScale, inverseFn]);
  const displayLabel = showOriginalScale ? targetLabel : (transformedLabel || targetLabel);
  const displayLabelHtml = formatLabelToHtml(displayLabel);

  const grid = useMemo(() => {
    if (!fittedModel || availableFactors.length < 2) return null;
    return generateGridData(fittedModel, rows, xKey, yKey, factorValues, transformValue);
  }, [fittedModel, rows, xKey, yKey, factorValues, availableFactors.length, transformValue]);

  if (availableFactors.length < 2) {
    return (
      <div className="panel chart-placeholder">
        <p>3D surface requires a model with 2+ factor keys.</p>
      </div>
    );
  }

  if (!grid) {
    return (
      <div className="panel chart-placeholder">
        <p>Fit a multi-variable model to enable the 3D Response Surface.</p>
      </div>
    );
  }

  const xFactor = getFactorDef(xKey);
  const yFactor = getFactorDef(yKey);

  const surfaceTrace = {
    type: 'surface',
    x: grid.x,
    y: grid.y,
    z: grid.z,
    colorscale: 'Viridis',
    colorbar: { title: { text: displayLabelHtml, side: 'right', font: { size: 20 } }, tickfont: { size: 16 }, thickness: 20, len: 0.82, x: 1.02 },
    hovertemplate:
      `${xFactor.shortLabel}: %{x:.2f}${xFactor.unit ? ` ${xFactor.unit}` : ''}<br>` +
      `${yFactor.shortLabel}: %{y:.3f}${yFactor.unit ? ` ${yFactor.unit}` : ''}<br>` +
      `${displayLabel}: %{z:.3f}<extra></extra>`,
  };

  const scatterTrace = {
    type: 'scatter3d',
    mode: 'markers',
    x: rows.map((r) => r.factors?.[xKey] ?? (xKey === r.factorKeyForX ? r.x : getFactorDef(xKey)?.default)),
    y: rows.map((r) => r.factors?.[yKey] ?? getFactorDef(yKey)?.default),
    z: rows.map((r) => transformValue(r.y)),
    marker: { color: '#c2410c', size: 5, symbol: 'circle', line: { color: 'white', width: 1 } },
    name: 'Experimental Data',
  };

  const axisTitleFont = { size: 22, family: 'Inter, system-ui, sans-serif', color: '#24364b' };
  const sceneAxisStyle = {
    tickfont: { size: 17, color: '#334155' },
    nticks: 5,
    gridcolor: '#dce4ed',
    showbackground: true,
    backgroundcolor: '#fafcfe',
    zerolinecolor: '#cbd5e1',
  };

  const layout = {
    autosize: true,
    scene: {
      xaxis: { ...sceneAxisStyle, title: { text: formatLabelToHtml(`${xFactor.label}${xFactor.unit ? ` (${xFactor.unit})` : ''}`), font: axisTitleFont } },
      yaxis: { ...sceneAxisStyle, title: { text: formatLabelToHtml(`${yFactor.label}${yFactor.unit ? ` (${yFactor.unit})` : ''}`), font: axisTitleFont } },
      zaxis: { ...sceneAxisStyle, title: { text: displayLabelHtml, font: axisTitleFont } },
      camera: { eye: { x: 1.45, y: 1.45, z: 1.1 } },
      aspectmode: 'manual',
      aspectratio: { x: 1, y: 1, z: 0.85 },
    },
    margin: { l: 35, r: 80, b: 80, t: 15, pad: 4 },
    paper_bgcolor: 'white',
    font: { size: 16, family: 'Inter, system-ui, sans-serif', color: '#334155' },
  };

  return (
    <div style={{ minWidth: 0, overflow: 'hidden' }}>
      <div className="surface-axis-selectors">
        <label>
          X-axis:
          <select value={xKey} onChange={(e) => setXKey(e.target.value)}>
            {availableFactors.map((k) => (
              <option key={k} value={k}>{getFactorDef(k)?.label ?? k}</option>
            ))}
          </select>
        </label>
        <label>
          Y-axis:
          <select value={yKey} onChange={(e) => setYKey(e.target.value)}>
            {availableFactors.map((k) => (
              <option key={k} value={k}>{getFactorDef(k)?.label ?? k}</option>
            ))}
          </select>
        </label>
      </div>
      <Suspense fallback={<div className="plot-loading-placeholder">Loading 3D surface...</div>}>
        <Plot
          divId="microfit-3d-surface-plot"
          data={[surfaceTrace, scatterTrace]}
          layout={layout}
          config={{ responsive: true, displayModeBar: true, toImageButtonOptions: { format: 'png', width: 1200, height: 750, scale: 3 } }}
          style={{ width: '100%', height: 620 }}
          useResizeHandler={true}
        />
      </Suspense>
    </div>
  );
}

function ObservedVsPredictedPlot({ activeFit, targetLabel = 'D value', transformedLabel = '', showOriginalScale = true, inverseTransform: invTx = null }) {
  const displayLabel = showOriginalScale ? targetLabel : (transformedLabel || targetLabel);
  const displayLabelHtml = formatLabelToHtml(displayLabel);
  const data = useMemo(() => {
    if (!activeFit?.rows?.length || !activeFit?.secondaryModelId || !activeFit?.params) return null;
    const model = SECONDARY_MODELS[activeFit.secondaryModelId];
    if (!model) return null;
    const txFn = showOriginalScale ? (invTx ? invTx.fn : (v) => Math.pow(10, v)) : (v) => v;

    const points = activeFit.rows
      .map((row) => {
        const observed = txFn(row.y);
        const predicted = txFn(model.predictY(row.factors, activeFit.params));
        return Number.isFinite(observed) && Number.isFinite(predicted)
          ? { observed, predicted }
          : null;
      })
      .filter(Boolean);

    if (points.length === 0) return null;

    const allValues = [...points.map((p) => p.observed), ...points.map((p) => p.predicted)];
    const min = Math.min(...allValues);
    const max = Math.max(...allValues);
    const pad = (max - min) * 0.05 || 0.5;

    return { points, min: min - pad, max: max + pad };
  }, [activeFit, showOriginalScale, invTx]);

  if (!data) {
    return (
      <div className="chart-placeholder">
        <p>Fit a multi-variable secondary model to see the Observed vs Predicted plot.</p>
      </div>
    );
  }

  const scatterTrace = {
    type: 'scatter',
    mode: 'markers',
    x: data.points.map((p) => p.observed),
    y: data.points.map((p) => p.predicted),
    marker: { color: '#1e40af', size: 9, symbol: 'circle', line: { color: '#ffffff', width: 1.5 } },
    showlegend: true,
    name: 'Experimental Data Points',
    hovertemplate: `Observed ${displayLabel}: %{x:.4f}<br>Predicted ${displayLabel}: %{y:.4f}<extra></extra>`,
  };

  const diagonalTrace = {
    type: 'scatter',
    mode: 'lines',
    x: [data.min, data.max],
    y: [data.min, data.max],
    line: { color: '#94a3b8', width: 2, dash: 'dash' },
    name: 'Perfect prediction',
    hoverinfo: 'skip',
  };

  const axisTitleFont = { size: 22, family: 'Inter, system-ui, sans-serif', color: '#334155' };
  const tickFont = { size: 17, family: 'Inter, system-ui, sans-serif', color: '#475569' };

  const layout = {
    autosize: true,
    height: 580,
    xaxis: { title: { text: `Observed ${displayLabelHtml}`, font: axisTitleFont, standoff: 12 }, tickfont: tickFont, range: [data.min, data.max], gridcolor: '#e2e8f0' },
    yaxis: {
      title: { text: `Predicted ${displayLabelHtml}`, font: axisTitleFont, standoff: 12 },
      tickfont: tickFont,
      range: [data.min, data.max],
      scaleanchor: 'x',
      scaleratio: 1,
      gridcolor: '#e2e8f0',
    },
    legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: -0.15, yanchor: 'top', font: { size: 14 }, bgcolor: 'rgba(255, 255, 255, 0)', bordercolor: 'rgba(0, 0, 0, 0)', borderwidth: 0 },
    margin: { l: 95, r: 50, b: 110, t: 30, pad: 4 },
    paper_bgcolor: 'white',
    plot_bgcolor: 'white',
    font: { family: 'Inter, system-ui, sans-serif', color: '#334155' },
  };

  return (
    <Suspense fallback={<p className="hint">Loading chart…</p>}>
      <Plot
        divId="microfit-obs-pred-plot"
        data={[diagonalTrace, scatterTrace]}
        layout={layout}
        config={{ responsive: true, displayModeBar: true, toImageButtonOptions: { format: 'png', width: 1200, height: 750, scale: 3 } }}
        style={{ width: '100%', height: 'auto' }}
        useResizeHandler
      />
    </Suspense>
  );
}

function createPredictorFactorState(factorKeys, predictorFactors = null) {
  const keys = Array.from(new Set([...(factorKeys ?? []), ...Object.keys(predictorFactors ?? {})]));
  return {
    ...createDefaultFactorState(keys),
    ...(predictorFactors ?? {}),
  };
}

function createInitialSecondaryParams({ exampleDefaults, scenario, allowedModelIds }) {
  const refDefaults = exampleDefaults?.referenceParams ?? {};
  if (!refDefaults || Object.keys(refDefaults).length === 0) return {};

  const allowed = new Set(allowedModelIds ?? []);
  const next = {};
  Object.values(SECONDARY_MODELS).forEach((model) => {
    if (!model?.scenarios?.includes(scenario)) return;
    if (allowed.size > 0 && !allowed.has(model.id)) return;
    model.params?.forEach((param) => {
      if (param.fixed && Object.hasOwn(refDefaults, param.name)) {
        next[`${model.id}_${param.name}`] = Number(refDefaults[param.name]);
      }
    });
  });
  return next;
}

export default function SecondaryModel({ datasets, fitResults, onSecondaryFit, precomputedFits, onViewedModelChange, exampleDefaults, initialState = null, onStateChange }) {
  const { scenario, primaryFactorKey, visibleFactorKeys, mode, timeUnit, useDoseAxis } = useScenario();
  const replaceTimeUnit = (label) =>
    timeUnit === 'min' ? label : label.replace(/1\/min/g, `1/${timeUnit}`).replace(/min\)/g, `${timeUnit})`);
  const primaryModels = useMemo(() => getAvailablePrimaryModels(), []);
  const initialPrimaryModelId = initialState?.primaryModelId ?? exampleDefaults?.primaryModelId ?? primaryModels[0]?.id ?? 'LOG_LINEAR';
  const initialConfig = MODEL_SECONDARY_CONFIG[initialPrimaryModelId];
  const initialPredictorFactorKeys = scenario === 'custom'
    ? visibleFactorKeys
    : (initialConfig?.factorKeys ?? visibleFactorKeys);
  const initialTargetKey = initialConfig?.targets?.[exampleDefaults?.targetKey]
    ? exampleDefaults.targetKey
    : (Object.keys(initialConfig?.targets ?? {})[0] ?? 'D');
  const initialAllowedSecondaryModels = getAllowedSecondaryIds(
    initialConfig?.targets?.[initialTargetKey]?.allowedSecondaryModels ?? [],
    scenario,
    mode,
  );
  const initialDefaultSecondaryModelId = initialConfig?.targets?.[initialTargetKey]?.defaultSecondaryModelId ?? '';
  const initialSecondaryModelId = initialAllowedSecondaryModels.includes(exampleDefaults?.secondaryModelId)
    ? exampleDefaults.secondaryModelId
    : initialAllowedSecondaryModels.includes(initialDefaultSecondaryModelId)
      ? initialDefaultSecondaryModelId
      : (initialAllowedSecondaryModels[0] ?? '');
  const [primaryModelId, setPrimaryModelId] = useState(initialPrimaryModelId);
  const [requestedTargetKey, setRequestedTargetKey] = useState(initialState?.requestedTargetKey ?? initialTargetKey);
  const [requestedSecondaryModelId, setRequestedSecondaryModelId] = useState(initialState?.requestedSecondaryModelId ?? initialSecondaryModelId);
  const [secondaryParams, setSecondaryParams] = useState(() => initialState?.secondaryParams ?? createInitialSecondaryParams({
    exampleDefaults,
    scenario,
    allowedModelIds: initialAllowedSecondaryModels,
  }));
  const [fittedModels, setFittedModels] = useState({});
  const [bindings, setBindings] = useState(() => initialState?.bindings ?? {});
  const [manualParams, setManualParams] = useState(() => initialState?.manualParams ?? buildInitialManualParams(
    initialPrimaryModelId,
    exampleDefaults?.manualParams,
  ));
  const [factorValues, setFactorValues] = useState(() => initialState?.factorValues ?? createPredictorFactorState(
    initialPredictorFactorKeys,
    exampleDefaults?.predictorFactors,
  ));
  const [showResidualPlot, setShowResidualPlot] = useState(false);
  const [multiVarChartView, setMultiVarChartView] = useState('contour');
  const [showOriginalScale, setShowOriginalScale] = useState(false);
  const [manualDEntries, setManualDEntries] = useState(() => initialState?.manualDEntries ?? exampleDefaults?.manualDEntries ?? []);
  const [manualDImportMessage, setManualDImportMessage] = useState('');
  const [manualDPasteText, setManualDPasteText] = useState('');
  const [showManualDInput, setShowManualDInput] = useState(false);
  const manualDFileRef = useRef();
  const appliedExampleDefaultsRef = useRef(initialState && exampleDefaults ? `${exampleDefaults.id ?? 'example'}_${exampleDefaults.loadedAt ?? ''}` : null);
  const lastScenarioRef = useRef(scenario);
  const currentPrimaryValue = factorValues[primaryFactorKey];
  const selectedRouting = JSON.stringify(bindings);
  const predictorWatcherRef = useRef({ currentPrimaryValue, selectedRouting });

  // Publish editable inputs only. Parent results hydrate through precomputedFits.
  useEffect(() => {
    onStateChange?.({ manualDEntries, secondaryParams, bindings, manualParams, factorValues,
      primaryModelId, requestedTargetKey, requestedSecondaryModelId });
  }, [manualDEntries, secondaryParams, bindings, manualParams, factorValues,
    primaryModelId, requestedTargetKey, requestedSecondaryModelId, onStateChange]);

  const config = MODEL_SECONDARY_CONFIG[primaryModelId];
  const targetEntries = useMemo(() => Object.entries(config?.targets ?? {}), [config]);
  const targetKey = config?.targets?.[requestedTargetKey]
    ? requestedTargetKey
    : (targetEntries[0]?.[0] ?? '');
  const activeTargetConfig = config?.targets?.[targetKey];
  const scenarioFiltered = useMemo(
    () => getAllowedSecondaryIds(activeTargetConfig?.allowedSecondaryModels ?? [], scenario, mode),
    [activeTargetConfig, scenario, mode],
  );
  const secondaryModelOptions = useMemo(
    () => getSecondaryModelList(scenarioFiltered)
      .sort((a, b) => {
        const diff = (a.factorKeys?.length ?? 0) - (b.factorKeys?.length ?? 0);
        return scenario === 'custom' ? -diff : diff;
      }),
    [scenarioFiltered, scenario],
  );
  const selectedSecondaryModelId = scenarioFiltered.includes(requestedSecondaryModelId)
    ? requestedSecondaryModelId
    : (scenarioFiltered[0] ?? '');
  const secondaryModel = SECONDARY_MODELS[selectedSecondaryModelId];
  const isMultiVariable = (secondaryModel?.factorKeys?.length ?? 0) >= 2;
  const inverseTransform = useMemo(() => getInverseTransform(secondaryModel?.responseTransforms, activeTargetConfig, selectedSecondaryModelId), [secondaryModel, activeTargetConfig, selectedSecondaryModelId]);
  // Collect all unique fixed (reference) params across all available secondary models
  // so that e.g. aw_ref is always visible even when a T-only model is selected
  const referenceParams = useMemo(() => {
    const seen = new Set();
    const result = [];
    for (const modelId of scenarioFiltered) {
      const model = SECONDARY_MODELS[modelId];
      if (!model?.params) continue;
      for (const p of model.params) {
        if (p.fixed && !seen.has(p.name)) {
          seen.add(p.name);
          result.push(p);
        }
      }
    }
    return result;
  }, [scenarioFiltered]);
  const estimatedParamDefs = useMemo(
    () => secondaryModel?.params.filter((p) => !p.fixed) ?? [],
    [secondaryModel]
  );
  const currentSecondaryParams = useMemo(() => {
    if (!secondaryModel) return {};
    return secondaryModel.params.reduce((acc, param) => {
      acc[param.name] = secondaryParams[`${selectedSecondaryModelId}_${param.name}`] ?? param.defaultValue;
      return acc;
    }, {});
  }, [secondaryModel, secondaryParams, selectedSecondaryModelId]);
  // Resolve reference param values: look across all models since the current model may not have them
  const resolvedRefValues = useMemo(() => {
    const values = {};
    for (const param of referenceParams) {
      // Try current model first
      let val = currentSecondaryParams[param.name];
      // If not found, search other models
      if (val == null) {
        for (const modelId of scenarioFiltered) {
          const stored = secondaryParams[`${modelId}_${param.name}`];
          if (stored != null) { val = stored; break; }
        }
      }
      values[param.name] = val ?? param.defaultValue;
    }
    return values;
  }, [referenceParams, currentSecondaryParams, secondaryParams, scenarioFiltered]);
  const rows = useMemo(() => buildRowsForSecondary({
    datasets, fitResults, primaryModelId, targetKey,
    secondaryModelId: selectedSecondaryModelId, primaryFactorKey, manualDEntries,
  }), [datasets, fitResults, primaryModelId, targetKey, selectedSecondaryModelId, primaryFactorKey, manualDEntries]);

  const referenceDataMeans = useMemo(() => {
    const means = {};
    referenceParams.forEach((param) => {
      const factorKey = getReferenceFactorKey(param.name, secondaryModel, mode);
      if (!factorKey) return;
      const values = rows
        .map((row) => row.factors?.[factorKey] ?? (factorKey === primaryFactorKey ? row.x : null))
        .filter(value => value != null && value !== '')
        .map((value) => Number(value))
        .filter(Number.isFinite);
      if (values.length > 0) {
        means[param.name] = values.reduce((sum, value) => sum + value, 0) / values.length;
      }
    });
    return means;
  }, [referenceParams, rows, secondaryModel, mode, primaryFactorKey]);

  // Column alias map: header text -> factor key
  const HEADER_ALIASES = {
    d: 'D', 'D': 'D', 'D-value': 'D', 'd-value': 'D', 'D_value': 'D', 'd_value': 'D', 'D(min)': 'D', 'D (min)': 'D',
    temp: 'temp', temperature: 'temp', 'T': 'temp', 'T(°C)': 'temp', 'T (°C)': 'temp', 'T(C)': 'temp',
    aw: 'aw', 'a_w': 'aw', 'Aw': 'aw', 'water activity': 'aw',
    pH: 'pH', 'ph': 'pH', 'PH': 'pH',
    pressure: 'pressure', 'P': 'pressure', 'P(MPa)': 'pressure', 'P (MPa)': 'pressure', 'MPa': 'pressure',
    intensity: 'intensity', 'I': 'intensity', 'I(mW/cm²)': 'intensity',
    concentration: 'concentration', 'conc': 'concentration',
  };

  function buildHeaderAliases() {
    const aliases = { ...HEADER_ALIASES };
    getFactorDefsWithCustom().forEach((factor) => {
      [factor.key, factor.label, factor.shortLabel]
        .filter(Boolean)
        .forEach((label) => {
          const normalized = String(label).trim();
          aliases[normalized] = factor.key;
          aliases[normalized.toLowerCase()] = factor.key;
          aliases[normalized.replace(/\s+/g, '_').toLowerCase()] = factor.key;
        });
    });
    return aliases;
  }

  function parseManualDText(text) {
    let records;
    try { records = readDelimitedRecords(text); }
    catch (error) { return { entries: [], rejectedCount: 0, error: error.message }; }
    const lines = records.filter(row => row.cells.some(Boolean));
    if (lines.length < 2) return { entries: [], rejectedCount: Math.max(0, lines.length - 1) };
    const aliases = buildHeaderAliases();
    const colMap = lines[0].cells.map(h => aliases[h] || aliases[h.toLowerCase()] || null);
    if (!colMap.includes('D')) return { entries: [], rejectedCount: lines.length - 1 };
    const entries = [];
    let rejectedCount = 0;
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].cells;
      const factors = {};
      let D = NaN;
      let valid = parts.length === colMap.length;
      for (let j = 0; j < parts.length && j < colMap.length; j++) {
        const key = colMap[j];
        if (!key) continue;
        if (parts[j] === '' && key !== 'D') continue;
        const val = parts[j] === '' ? NaN : Number(parts[j]);
        if (!Number.isFinite(val)) { valid = false; break; }
        if (key === 'D') D = val;
        else factors[key] = val;
      }
      if (valid && Number.isFinite(D) && D > 0) entries.push({ id: Date.now() + i, D, factors });
      else rejectedCount++;
    }
    return { entries, rejectedCount };
  }

  function importManualDText(text) {
    const { entries, rejectedCount, error } = parseManualDText(text);
    if (error) { setManualDImportMessage(`Import rejected: ${error}`); return 0; }
    if (entries.length) setManualDEntries(prev => [...prev, ...entries]);
    setManualDImportMessage(`Imported ${entries.length} entries; rejected ${rejectedCount} malformed rows. Entries missing factors required by the selected model are excluded from its fit.`);
    return entries.length;
  }

  function handleManualDPaste() {
    if (importManualDText(manualDPasteText)) setManualDPasteText('');
  }

  function handleManualDFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => importManualDText(ev.target.result);
    reader.readAsText(file);
    e.target.value = '';
  }

  function removeManualDEntry(id) {
    setManualDEntries((prev) => prev.filter((e) => e.id !== id));
  }

  function clearAllManualDEntries() {
    setManualDEntries([]);
  }

  // Determine which factor keys actually have finite data across rows
  const availableDataFactors = useMemo(() => {
    const keys = new Set();
    rows.forEach((r) => {
      if (r.factors) {
        Object.entries(r.factors).forEach(([k, v]) => {
          if (v != null && Number.isFinite(Number(v))) keys.add(k);
        });
      }
    });
    return Array.from(keys);
  }, [rows]);

  const constantFactors = useMemo(() => {
    if (datasets.length < 2) return [];
    const factorVals = {};
    datasets.forEach((ds) => {
      Object.entries(ds.conditions || {}).forEach(([k, v]) => {
        if (!factorVals[k]) factorVals[k] = new Set();
        if (Number.isFinite(v)) factorVals[k].add(v);
      });
    });
    return Object.keys(factorVals).filter((k) => factorVals[k].size <= 1);
  }, [datasets]);

  const fittedKeys = useMemo(() => Object.keys(fittedModels), [fittedModels]);

  // Rank all fitted models for the current target (filtered by scenario)
  const rankedForTarget = useMemo(() => {
    const candidates = Object.entries(fittedModels)
      .filter(([, fit]) => fit.primaryModelId === primaryModelId && fit.targetKey === targetKey && scenarioFiltered.includes(fit.secondaryModelId));
    if (candidates.length === 0) return [];
    rankCandidates(candidates);
    return candidates.map(([key, fit], idx) => ({
      key,
      fit,
      rank: idx + 1,
    }));
  }, [fittedModels, primaryModelId, targetKey, scenarioFiltered]);

  // Follow rank #1 until the user explicitly selects a secondary model.
  const userSelectedSecondaryRef = useRef(false);
  useEffect(() => {
    if (rankedForTarget.length === 0) {
      return;
    }
    if (userSelectedSecondaryRef.current) return;
    if (exampleDefaults?.secondaryModelId && selectedSecondaryModelId === exampleDefaults.secondaryModelId) return;
    const bestModelId = rankedForTarget[0].fit.secondaryModelId;
    if (bestModelId && bestModelId !== selectedSecondaryModelId) {
      setRequestedSecondaryModelId(bestModelId);
    }
  }, [rankedForTarget, selectedSecondaryModelId, exampleDefaults]);

  const factorDefs = getFactorDefs(
    scenario === 'custom'
      ? visibleFactorKeys
      : (config?.factorKeys ?? FACTOR_DEFS.map((factor) => factor.key))
  );
  const secondaryDataFactorKeys = scenario === 'custom'
    ? visibleFactorKeys.filter((key) => key !== primaryFactorKey)
    : visibleFactorKeys;

  // Pick the first primary-model fit result for the current primaryModelId to feed MonteCarloPanel
  const primaryFitForMC = useMemo(() => {
    const key = Object.keys(fitResults).find((k) => k.endsWith(`_${primaryModelId}`) && !fitResults[k]?.failed && fitResults[k]?.converged !== false);
    return key ? fitResults[key] : null;
  }, [fitResults, primaryModelId]);

  useEffect(() => {
    predictorWatcherRef.current = { currentPrimaryValue, selectedRouting };
  }, [currentPrimaryValue, selectedRouting]);

  useEffect(() => {
    setMultiVarChartView('contour');
  }, [selectedSecondaryModelId]);

  useEffect(() => {
    if (lastScenarioRef.current === scenario) return;
    lastScenarioRef.current = scenario;
    setFittedModels({});
    setBindings({});
    setFactorValues(createPredictorFactorState(
      scenario === 'custom'
        ? visibleFactorKeys
        : (MODEL_SECONDARY_CONFIG[primaryModelId]?.factorKeys ?? visibleFactorKeys),
      exampleDefaults?.predictorFactors,
    ));
    userSelectedSecondaryRef.current = false;
    const nextConfig = MODEL_SECONDARY_CONFIG[primaryModelId];
    const firstTarget = Object.keys(nextConfig?.targets ?? {})[0] ?? '';
    setRequestedTargetKey(firstTarget);
    const filtered = getAllowedSecondaryIds(
      nextConfig?.targets?.[firstTarget]?.allowedSecondaryModels ?? [],
      scenario,
      mode,
    );
    setRequestedSecondaryModelId(filtered[0] ?? '');
  }, [scenario, exampleDefaults, visibleFactorKeys, primaryModelId, mode]);

  useEffect(() => {
    if (!exampleDefaults) return;
    const signature = `${exampleDefaults.id ?? 'example'}_${exampleDefaults.loadedAt ?? ''}`;
    if (appliedExampleDefaultsRef.current === signature) return;
    appliedExampleDefaultsRef.current = signature;

    const nextPrimaryModelId = exampleDefaults.primaryModelId ?? primaryModelId;
    const nextConfig = MODEL_SECONDARY_CONFIG[nextPrimaryModelId];
    const nextTargetKey = nextConfig?.targets?.[exampleDefaults.targetKey]
      ? exampleDefaults.targetKey
      : (Object.keys(nextConfig?.targets ?? {})[0] ?? '');
    const allowed = getAllowedSecondaryIds(
      nextConfig?.targets?.[nextTargetKey]?.allowedSecondaryModels ?? [],
      scenario,
      mode,
    );
    const nextSecondaryModelId = allowed.includes(exampleDefaults.secondaryModelId)
      ? exampleDefaults.secondaryModelId
      : (allowed[0] ?? '');

    setPrimaryModelId(nextPrimaryModelId);
    setRequestedTargetKey(nextTargetKey);
    setRequestedSecondaryModelId(nextSecondaryModelId);
    setManualParams(buildInitialManualParams(nextPrimaryModelId, exampleDefaults.manualParams));
    setFactorValues(createPredictorFactorState(
      scenario === 'custom' ? visibleFactorKeys : (nextConfig?.factorKeys ?? visibleFactorKeys),
      exampleDefaults.predictorFactors,
    ));

    const refDefaults = exampleDefaults.referenceParams ?? {};
    setSecondaryParams((prev) => {
      const next = { ...prev };
      Object.values(SECONDARY_MODELS).forEach((model) => {
        if (!model?.scenarios?.includes(scenario)) return;
        model.params?.forEach((param) => {
          if (param.fixed && Object.hasOwn(refDefaults, param.name)) {
            next[`${model.id}_${param.name}`] = Number(refDefaults[param.name]);
          }
        });
      });
      return next;
    });
    userSelectedSecondaryRef.current = false;
  }, [exampleDefaults, primaryModelId, scenario, visibleFactorKeys, mode]);

  // Report which secondary model the user is currently viewing
  useEffect(() => {
    if (!selectedSecondaryModelId || !targetKey) return;
    onViewedModelChange?.(`${selectedSecondaryModelId}_${targetKey}`);
  }, [selectedSecondaryModelId, targetKey, onViewedModelChange]);

  // Auto-bind parameters to best available fitted model ("fit it and it's applied")
  useEffect(() => {
    if (Object.keys(fittedModels).length === 0) return;
    const primaryModel = MODELS[primaryModelId];
    if (!primaryModel) return;
    const cfg = MODEL_SECONDARY_CONFIG[primaryModelId];
    if (!cfg) return;

    setBindings((prev) => {
      const next = { ...prev };
      let changed = false;

      primaryModel.params.forEach((param) => {
        const cfg = MODEL_SECONDARY_CONFIG[primaryModelId];
        const candidates = Object.entries(fittedModels).filter(([, fit]) => {
          if (fit.failed || fit.converged === false || fit.aiccValid === false || !Number.isFinite(fit.aicc)) return false;
          if (fit.primaryModelId !== primaryModelId) return false;
          if (fit.targetKey === param.name) return true;
          const targetCfg = cfg?.targets?.[fit.targetKey];
          return targetCfg?.mapsToParam === param.name;
        });

        if (candidates.length === 0) { if (next[param.name]) { delete next[param.name]; changed = true; } return; }

        // Prefer the model currently being viewed on the secondary page
        const currentViewKey = `${selectedSecondaryModelId}_${targetKey}`;
        const viewMatch = candidates.find(([k]) => k === currentViewKey);

        if (viewMatch && next[param.name] !== viewMatch[0]) {
          next[param.name] = viewMatch[0];
          changed = true;
        } else if (!next[param.name] || !candidates.some(([key]) => key === next[param.name])) {
          rankCandidates(candidates, true);
          if (candidates.length === 0) return;
          next[param.name] = candidates[0][0];
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  }, [fittedModels, primaryModelId, selectedSecondaryModelId, targetKey]);

  const predictedParams = useMemo(() => predictPrimaryParams({
    primaryModelId,
    bindings,
    fittedSecondaryModels: fittedModels,
    manualParams,
    factors: factorValues,
    primaryFactorKey,
  }), [primaryModelId, bindings, fittedModels, manualParams, factorValues, primaryFactorKey]);

  // Factors that actually affect the prediction curve via bound secondary models
  const effectiveFactorKeys = useMemo(() => {
    const keys = new Set([primaryFactorKey]);
    Object.keys(exampleDefaults?.predictorFactors ?? {}).forEach((key) => keys.add(key));
    Object.values(bindings).forEach((fitKey) => {
      const fit = fittedModels[fitKey];
      if (!fit) return;
      const secModel = SECONDARY_MODELS[fit.secondaryModelId];
      if (secModel?.factorKeys) {
        secModel.factorKeys.forEach((k) => keys.add(k));
      }
    });
    return Array.from(keys);
  }, [bindings, fittedModels, exampleDefaults, primaryFactorKey]);

  const predictionCurve = useMemo(() => {
    const watcher = predictorWatcherRef.current;
    void watcher;
    if (!predictedParams) return [];
    return predictCurve(primaryModelId, predictedParams, 120);
  }, [primaryModelId, predictedParams]);

  function exportAnalysisJson() {
    const primaryFits = Object.values(fitResults)
      .filter((fit) => fit?.params)
      .map((fit) => ({
        datasetId: fit.datasetId,
        modelId: fit.modelId,
        params: fit.params,
        paramErrors: fit.paramErrors,
        paramCI95: fit.paramCI95,
        rmse: fit.rmse,
        residualSE: fit.residualSE,
        aiccParameterCount: fit.aiccParameterCount,
        r2: fit.r2,
        r2adj: fit.r2adj,
        aicc: fit.aicc,
        aiccValid: fit.aiccValid,
        converged: fit.converged,
        convergenceReason: fit.convergenceReason,
        boundaryWarnings: fit.boundaryWarnings,
      }));
    const report = {
      reportType: 'MicroFit Pro Analysis Report',
      appVersion: '0.1.0',
      exportedAt: new Date().toISOString(),
      scenario,
      primaryModelId,
      targetKey,
      selectedSecondaryModelId,
      datasets: datasets.map((dataset) => ({
        id: dataset.id,
        name: dataset.name,
        conditions: dataset.conditions,
        data: dataset.data,
      })),
      primaryFits,
      secondaryFits: fittedModels,
      activeSecondaryFit: activeFit,
      bindings,
      factorValues,
      manualParams,
      predictedParams,
      notes: [
        'Use the random seed reported in Monte Carlo JSON exports to reproduce stochastic uncertainty and sensitivity analyses.',
        'Secondary fits with low degrees of freedom should be treated as screening-level evidence.',
      ],
    };
    downloadJsonFile(`MicroFit_Analysis_${primaryModelId}_${targetKey}.json`, report);
  }

  // Fit every target using a complete snapshot, rebuilding its own response transform.
  const fixedSecondaryParams = Object.fromEntries(Object.entries(secondaryParams).filter(([key]) =>
    Object.values(SECONDARY_MODELS).some(model => model.params?.some(param => param.fixed && key === `${model.id}_${param.name}`))));
  const localFitSignature = fittingInputSignature({ datasets, fitResults, primaryModelId, scenario, primaryFactorKey, mode, fixedSecondaryParams, manualDEntries, targetKey, timeUnit, useDoseAxis });
  useEffect(() => {
    // A fresh parent fit wins over obsolete local automatic fits.
    setFittedModels(prev => reconcileSecondaryFits(precomputedFits, prev, localFitSignature));
  }, [precomputedFits, localFitSignature]);
  useEffect(() => {
    const cfg = MODEL_SECONDARY_CONFIG[primaryModelId];
    if (!cfg) return;
    return scheduleFit(() => {
      const newFits = {};
      for (const [tKey, tCfg] of Object.entries(cfg.targets ?? {})) {
        for (const secId of getAllowedSecondaryIds(tCfg.allowedSecondaryModels ?? [], scenario, mode)) {
          const secRows = buildRowsForSecondary({ datasets, fitResults, primaryModelId, targetKey: tKey,
            secondaryModelId: secId, primaryFactorKey, manualDEntries: tKey === targetKey ? manualDEntries : [] });
          if (secRows.length < 2) continue;
          const modelDef = SECONDARY_MODELS[secId];
          const params = Object.fromEntries(modelDef.params.filter(param => param.fixed).map(param =>
            [param.name, fixedSecondaryParams[`${secId}_${param.name}`] ?? exampleDefaults?.referenceParams?.[param.name] ?? param.defaultValue]));
          const result = fitSecondaryModel(secId, secRows, params);
          if (!result) continue;
          const fitKey = `${secId}_${tKey}`;
          newFits[fitKey] = { ...result, fitKey, primaryModelId, targetKey: tKey, secondaryModelId: secId,
            lowConfidence: secRows.length <= 2,
            inputSignature: localFitSignature,
            userOverride: (tKey === targetKey && manualDEntries.length > 0) || modelDef.params.some(param => param.fixed && params[param.name] !== (exampleDefaults?.referenceParams?.[param.name] ?? param.defaultValue)),
            linkedCurveMetrics: computeLinkedPrimaryCurveMetrics({ datasets, fitResults, primaryModelId,
              targetKey: tKey, secondaryModelId: secId, secondaryParams: result.params }) };
        }
      }
      setFittedModels(prev => ({ ...Object.fromEntries(Object.entries(prev).filter(([, fit]) => fit.primaryModelId !== primaryModelId || fit.source === 'literature')), ...newFits }));
      // Publish only this completed computation. Hydrating parent results must
      // never send those results back through the parent state setter.
      onSecondaryFit?.(newFits, primaryModelId);
    }, 60);
    // The signature includes all computation inputs; precomputed results separately trigger replacement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localFitSignature]);

  function updateSecondaryParam(name, value) {
    const numVal = parseFloat(value) || 0;
    // For reference (fixed) params, broadcast to ALL secondary models that use this param
    // so the value persists when the user switches models
    const refParam = referenceParams.find(p => p.name === name);
    if (refParam) {
      setSecondaryParams((prev) => {
        const next = { ...prev };
        for (const modelId of scenarioFiltered) {
          const model = SECONDARY_MODELS[modelId];
          if (model?.params?.some(p => p.name === name)) {
            next[`${modelId}_${name}`] = numVal;
          }
        }
        return next;
      });
    } else {
      setSecondaryParams((prev) => ({
        ...prev,
        [`${selectedSecondaryModelId}_${name}`]: numVal,
      }));
    }
  }

  function updateManualParam(name, value) {
    setManualParams((prev) => ({ ...prev, [name]: parseFloat(value) || 0 }));
  }

  function updateBinding(paramName, fitKey) {
    setBindings((prev) => {
      const next = { ...prev };
      if (!fitKey) {
        delete next[paramName];
        return next;
      }
      next[paramName] = fitKey;
      return next;
    });
  }

  const currentFitKey = `${selectedSecondaryModelId}_${targetKey}`;
  const activeFit = fittedModels[currentFitKey] ?? null;

  const primaryModel = MODELS[primaryModelId];
  const residualExportBaseName = activeFit
    ? buildResultBaseName(
      activeFit.rows?.map((row) => row.datasetName).join('-') || 'SecondaryFit',
      SECONDARY_MODELS[activeFit.secondaryModelId]?.name ?? activeFit.secondaryModelId,
    )
    : null;

  const lowData = rows.length === 2;

  return (
    <div className="secondary-layout">
      {lowData && (
        <div className="alert alert-warning">
          Detected 2 datasets. Preliminary fitting is possible, but due to limited statistical degrees of freedom, at least 3 datasets are recommended to ensure prediction reliability.
        </div>
      )}
      <aside className="left-panel">
        <div className="panel">
          <h2 className="panel-title">Secondary Model</h2>
          <p className="hint">{mode?.label ?? scenario}-driven secondary fitting built from primary-model results.</p>

          <div className="form-group">
            <label>Primary model</label>
            <select value={primaryModelId} onChange={(e) => {
              const nextModelId = e.target.value;
              const nextConfig = MODEL_SECONDARY_CONFIG[nextModelId];
              const firstTarget = Object.keys(nextConfig?.targets ?? {})[0] ?? '';
              setPrimaryModelId(nextModelId);
              setRequestedTargetKey(firstTarget);
              userSelectedSecondaryRef.current = false;
              setRequestedSecondaryModelId(nextConfig?.targets?.[firstTarget]?.defaultSecondaryModelId ?? '');
              setManualParams(buildInitialManualParams(
                nextModelId,
                nextModelId === exampleDefaults?.primaryModelId ? exampleDefaults?.manualParams : null,
              ));
              setFactorValues(createDefaultFactorState(
                scenario === 'custom' ? visibleFactorKeys : (nextConfig?.factorKeys ?? visibleFactorKeys)
              ));
            }}>
              {primaryModels.map((model) => (
                <option key={model.id} value={model.id}>{stripModelName(model.name)}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Target parameter</label>
            <select value={targetKey} onChange={(e) => {
              const nextTargetKey = e.target.value;
              setRequestedTargetKey(nextTargetKey);
              userSelectedSecondaryRef.current = false;
              setRequestedSecondaryModelId(config?.targets?.[nextTargetKey]?.defaultSecondaryModelId ?? '');
            }}>
              {targetEntries.map(([key, target]) => (
                <option key={key} value={key}>{target.label}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Secondary model</label>
            <select value={selectedSecondaryModelId} onChange={(e) => {
              userSelectedSecondaryRef.current = true;
              setRequestedSecondaryModelId(e.target.value);
            }}>
              {secondaryModelOptions.map((model) => {
                const missingFactors = (model.factorKeys ?? []).filter(
                  (k) => !availableDataFactors.includes(k)
                );
                const insufficientFactors = (model.factorKeys ?? []).filter(
                  (k) => k !== primaryFactorKey && constantFactors.includes(k)
                );
                const isDisabled = missingFactors.length > 0 || insufficientFactors.length > 0;
                const disabledLabel = missingFactors.length > 0
                  ? ` (missing: ${missingFactors.map(getFactorShortLabel).join(', ')})`
                  : insufficientFactors.length > 0
                  ? ` (no variation: ${insufficientFactors.map(getFactorShortLabel).join(', ')})`
                  : '';
                const factorTag = (model.factorKeys ?? []).length > 0
                  ? ` (${(model.factorKeys).map(getFactorShortLabel).join(', ')})`
                  : '';
                return (
                  <option key={model.id} value={model.id} disabled={isDisabled}>
                    {stripModelName(model.name)}{factorTag}{disabledLabel}
                  </option>
                );
              })}
            </select>
          </div>

          <div className="model-description">{secondaryModel?.description}</div>
          <code className="model-formula"><FormattedLabel text={secondaryModel?.formula} /></code>
          <FormulaNote note={primaryModel?.formulaNote} />

          <h3 style={{ marginTop: 12, marginBottom: 6, fontSize: 15 }}>Auto-collected secondary data</h3>
          <div className="table-scroll" style={{ maxHeight: 220 }}>
            <table className="result-table">
              <thead>
                <tr>
                  <th>Dataset</th>
                  {secondaryDataFactorKeys.map((key) => {
                    const def = getFactorDef(key);
                    return <th key={key}>{key === 'aw' ? <FormattedLabel text="a_w" /> : (def?.label ?? key)}</th>;
                  })}
                  <th>Value</th>
                  <th>Fitted y</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIdx) => (
                  <tr key={`${row.datasetId}_${rowIdx}`}>
                    <td>{row.datasetName}</td>
                    {secondaryDataFactorKeys.map((key) => {
                      const val = row.factors?.[key] ?? getFactorDef(key)?.default ?? '';
                      return <td key={key}>{key === 'aw' ? Number(val).toFixed(3) : Number(val).toFixed(2)}</td>;
                    })}
                    <td>{row.rawValue.toFixed(4)}</td>
                    <td>{row.y.toFixed(4)}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={3 + secondaryDataFactorKeys.length}>
                      Need fitted datasets with {getFactorDef(secondaryModel?.factorKeys?.[0] ?? primaryFactorKey)?.label?.toLowerCase() ?? primaryFactorKey} metadata.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {referenceParams.length > 0 && (
            <>
              <h3 style={{ marginTop: 12, marginBottom: 6, fontSize: 15 }}>Reference settings</h3>
              {referenceParams.map((param) => (
                <div key={param.name} className="param-row">
                  <label><FormattedLabel text={param.label} /></label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input
                      type="number"
                      step="any"
                      min={param.min}
                      max={param.max}
                      value={resolvedRefValues[param.name] ?? param.defaultValue}
                      onChange={(e) => updateSecondaryParam(param.name, e.target.value)}
                      style={{ flex: 1 }}
                    />
                    <button
                      className="ref-reset-btn"
                      title={`Reset to default: ${param.defaultValue}`}
                      onClick={() => updateSecondaryParam(param.name, param.defaultValue)}
                    >↺</button>
                    {Number.isFinite(referenceDataMeans[param.name]) && (
                      <button
                        className="ref-reset-btn"
                        title={`Use data mean: ${referenceDataMeans[param.name].toPrecision(4)}`}
                        onClick={() => updateSecondaryParam(param.name, referenceDataMeans[param.name])}
                      >μ</button>
                    )}
                  </div>
                </div>
              ))}
              <p className="hint" style={{ fontSize: 14, marginTop: 4 }}>
                Reference values are fixed centering points. Use μ to center them at the current data mean; fitted reference parameters are recalculated after the change.
              </p>
            </>
          )}

        <div className="panel manual-d-input-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>Literature D-value Import</h3>
            <button
              className="btn-secondary"
              style={{ fontSize: 14, padding: '2px 8px' }}
              onClick={() => setShowManualDInput((v) => !v)}
            >
              {showManualDInput ? 'Collapse' : 'Expand'}
            </button>
          </div>
          {showManualDInput && (
            <>
              <p className="hint" style={{ fontSize: 14, marginBottom: 6 }}>
                Paste a table from Excel or literature. First row = header, one row per D-value.
                Only include columns you have — missing columns are ignored.
              </p>
              <p className="hint" style={{ fontSize: 14, marginBottom: 8 }}>
                Recognized headers: D / D-value, T / temp, aw, pH, P / pressure, I / intensity, conc
              </p>
              <textarea
                rows={5}
                wrap="off"
                placeholder={'D\tT\taw\tpH\n5.2\t60\t0.98\t7.0\n3.1\t65\t\t6.5\n1.8\t70\t0.95\t'}
                value={manualDPasteText}
                onChange={(e) => setManualDPasteText(e.target.value)}
                style={{ width: '100%', fontSize: 14, fontFamily: 'monospace', resize: 'vertical', boxSizing: 'border-box', whiteSpace: 'pre', overflowX: 'auto' }}
              />
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <button className="btn-primary" style={{ fontSize: 14 }} onClick={handleManualDPaste} disabled={!manualDPasteText.trim()}>
                  Import
                </button>
                <input ref={manualDFileRef} type="file" accept=".csv,.tsv,.txt" style={{ display: 'none' }} onChange={handleManualDFile} />
                <button className="btn-secondary" style={{ fontSize: 14 }} onClick={() => manualDFileRef.current?.click()}>
                  Upload CSV
                </button>
              </div>
            </>
          )}

          {manualDImportMessage && <p className="hint" role="status">{manualDImportMessage}</p>}
          {manualDEntries.length > 0 && <p className="hint">{manualDEntries.length - rows.filter(row => String(row.datasetId).startsWith('manual_')).length} manual entries excluded from the selected model because required factors are missing.</p>}
          {manualDEntries.length > 0 && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                <span style={{ fontSize: 14, color: '#475569' }}>{manualDEntries.length} entries</span>
                <button
                  className="btn-secondary"
                  style={{ fontSize: 14, padding: '2px 8px', color: '#c00' }}
                  onClick={clearAllManualDEntries}
                >
                  Clear all
                </button>
              </div>
              <div className="table-scroll" style={{ maxHeight: 200, marginTop: 4 }}>
                <table className="result-table">
                  <thead>
                    <tr>
                      <th>D</th>
                      {manualDEntries.some((e) => 'temp' in e.factors) && <th>T</th>}
                      {manualDEntries.some((e) => 'aw' in e.factors) && <th>aw</th>}
                      {manualDEntries.some((e) => 'pH' in e.factors) && <th>pH</th>}
                      {manualDEntries.some((e) => 'pressure' in e.factors) && <th>P</th>}
                      {manualDEntries.some((e) => 'intensity' in e.factors) && <th>I</th>}
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {manualDEntries.map((entry) => (
                      <tr key={entry.id}>
                        <td>{entry.D}</td>
                        {manualDEntries.some((e) => 'temp' in e.factors) && <td>{entry.factors.temp ?? '—'}</td>}
                        {manualDEntries.some((e) => 'aw' in e.factors) && <td>{entry.factors.aw ?? '—'}</td>}
                        {manualDEntries.some((e) => 'pH' in e.factors) && <td>{entry.factors.pH ?? '—'}</td>}
                        {manualDEntries.some((e) => 'pressure' in e.factors) && <td>{entry.factors.pressure ?? '—'}</td>}
                        {manualDEntries.some((e) => 'intensity' in e.factors) && <td>{entry.factors.intensity ?? '—'}</td>}
                        <td>
                          <button
                            onClick={() => removeManualDEntry(entry.id)}
                            style={{ color: '#c00', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14 }}
                          >×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
{activeFit && activeFit.secondaryModelId === selectedSecondaryModelId && (
            <>
              <h3 style={{ marginTop: 12, marginBottom: 6, fontSize: 15 }}>Estimated parameters</h3>
              <div>
                {estimatedParamDefs.map((param) => (
                  <div key={param.name} className="param-row">
                    <label><FormattedLabel text={getParamDisplayLabel(param)} /></label>
                    <span style={{ fontSize: 15, fontVariantNumeric: 'tabular-nums', cursor: 'text' }}>
                      {param.name === 'logDref'
                        ? formatParameterValue(Math.pow(10, activeFit.params[param.name]))
                        : formatParameterValue(activeFit.params[param.name])}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="panel">
          <h2 className="panel-title">Predictor</h2>
          <p className="hint">Factor controls are rendered from configuration.</p>
          {primaryFactorKey === 'doseRate' && !useDoseAxis && <p className="hint">Unbound manual rate parameters scale in proportion to dose rate relative to {getFactorDef('doseRate')?.scalingRef} kGy/h; characteristic time parameters scale inversely. This assumes the dose response stays constant.</p>}

          {factorDefs.filter((factor) => visibleFactorKeys.includes(factor.key) && !constantFactors.includes(factor.key) && effectiveFactorKeys.includes(factor.key)).map((factor) => (
            <div key={factor.key} className="form-group">
              <label>{factor.label}{factor.unit ? ` (${factor.unit})` : ''}</label>
              <div style={{ display: 'grid', gap: 6 }}>
                <input
                  type="range"
                  min={factor.min}
                  max={factor.max}
                  step={factor.step}
                  value={factorValues[factor.key] ?? factor.defaultValue}
                  onChange={(e) => setFactorValues((prev) => ({ ...prev, [factor.key]: parseFloat(e.target.value) }))}
                />
                <input
                  type="number"
                  min={factor.min}
                  max={factor.max}
                  step={factor.step}
                  value={factorValues[factor.key] ?? factor.defaultValue}
                  onChange={(e) => setFactorValues((prev) => ({ ...prev, [factor.key]: parseFloat(e.target.value) || 0 }))}
                />
              </div>
            </div>
          ))}

          <h3 style={{ marginTop: 12, marginBottom: 6, fontSize: 15 }}>Parameter routing</h3>
          {primaryModel?.params.map((param) => {
            const cfg = MODEL_SECONDARY_CONFIG[primaryModelId];
            const candidateFits = fittedKeys.filter((fitKey) => {
              const fit = fittedModels[fitKey];
              if (!fit || fit.failed || fit.converged === false || fit.primaryModelId !== primaryModelId) return false;
              // Direct match: targetKey === param.name
              if (fit.targetKey === param.name) return true;
              // Indirect match via mapsToParam (e.g. D target maps to kmax)
              const targetCfg = cfg?.targets?.[fit.targetKey];
              return targetCfg?.mapsToParam === param.name;
            });

            return (
              <div key={param.name} className="form-group">
                <label><FormattedLabel text={replaceTimeUnit(param.label)} /></label>
                <select
                  value={bindings[param.name] ?? ''}
                  onChange={(e) => updateBinding(param.name, e.target.value)}
                >
                  <option value="">Manual input</option>
                  {candidateFits.map((fitKey) => {
                    const fit = fittedModels[fitKey];
                    return (
                      <option key={fitKey} value={fitKey}>
                        {getSecondaryRouteOptionLabel(fit, primaryModelId)}
                      </option>
                    );
                  })}
                </select>
                {!bindings[param.name] && (
                  <input
                    type="number"
                    step="any"
                    min={param.min}
                    max={param.max}
                    value={manualParams[param.name] ?? param.defaultValue}
                    onChange={(e) => updateManualParam(param.name, e.target.value)}
                  />
                )}
              </div>
            );
          })}
        </div>
      </aside>

      <section className="right-panel">
        {activeFit ? (
          <>
            <div className="secondary-fit-row">
            <div className="panel secondary-visual-panel">
              <div className="chart-header">
                <h2 className="panel-title">Secondary Fit</h2>
                {isMultiVariable ? (
                  <>
                    <div className="chart-view-toggle">
                      <button
                        className={`btn-secondary${multiVarChartView === 'contour' ? ' active' : ''}`}
                        onClick={() => setMultiVarChartView('contour')}
                      >
                        Contour Map
                      </button>
                      <button
                        className={`btn-secondary${multiVarChartView === '3d' ? ' active' : ''}`}
                        onClick={() => setMultiVarChartView('3d')}
                      >
                        3D Surface
                      </button>
                      <button
                        className={`btn-secondary${multiVarChartView === 'obsPred' ? ' active' : ''}`}
                        onClick={() => setMultiVarChartView('obsPred')}
                      >
                        Observed vs Predicted
                      </button>
                    </div>
                    <PlotlyExportActions
                      plotId={
                        multiVarChartView === 'contour' ? 'microfit-contour-plot'
                        : multiVarChartView === '3d' ? 'microfit-3d-surface-plot'
                        : 'microfit-obs-pred-plot'
                      }
                      baseName={
                        multiVarChartView === 'contour' ? 'MicroFit_Contour_Plot'
                        : multiVarChartView === '3d' ? 'MicroFit_3D_Surface'
                        : 'MicroFit_ObsPred_Plot'
                      }
                    />
                  </>
                ) : (
                  <PlotlyExportActions plotId="secondary-fit-chart" baseName={residualExportBaseName} />
                )}
                {!inverseTransform.isIdentity && (
                  <button
                    className={`btn-secondary${showOriginalScale ? ' active' : ''}`}
                    style={{ fontSize: 14, padding: '2px 8px', whiteSpace: 'nowrap' }}
                    onClick={() => setShowOriginalScale((v) => !v)}
                  >
                    {showOriginalScale ? 'Original Scale' : 'Transformed'}
                  </button>
                )}
              </div>

              {!isMultiVariable ? (
                <div style={{ position: 'relative' }}>
                  {lowData && activeFit && (
                    <div className="chart-watermark">Preliminary fit (n=2)</div>
                  )}
                  <Suspense fallback={<p className="hint">Loading chart...</p>}>
                    <Plot
                      divId="secondary-fit-chart"
                      data={(() => {
                        const txFn = showOriginalScale ? inverseTransform.fn : (y) => y;
                        const validRows = activeFit.rows.filter((r) => Number.isFinite(r.y));
                        const seen = new Map();
                        validRows.forEach((row) => {
                          if (!seen.has(row.datasetId)) {
                            const ds = datasets.find((d) => d.id === row.datasetId);
                            seen.set(row.datasetId, { ds, rows: [] });
                          }
                          seen.get(row.datasetId).rows.push(row);
                        });
                        const groups = [...seen.values()];
                        const PLOTLY_SYMBOLS = ['circle', 'triangle-up', 'square', 'diamond', 'cross'];
                        const traces = groups.map((g, i) => ({
                          type: 'scatter', mode: 'markers',
                          name: g.ds?.name ?? `Dataset ${i + 1}`,
                          x: g.rows.map((r) => r.x), y: g.rows.map((r) => txFn(r.y)),
                          marker: {
                            color: g.ds?.color ?? '#1f3b73', size: 8,
                            symbol: PLOTLY_SYMBOLS[(g.ds?.shapeIdx ?? i) % PLOTLY_SYMBOLS.length],
                            line: { color: 'white', width: 1 },
                          },
                          hovertemplate: `${g.ds?.name ?? 'Dataset'}<br>x: %{x:.2f}<br>y: %{y:.4f}<extra></extra>`,
                        }));
                        const curveData = activeFit.curve.filter((r) => Number.isFinite(r.y));
                        traces.push({
                          type: 'scatter', mode: 'lines', name: 'Fitted curve',
                          x: curveData.map((r) => r.x), y: curveData.map((r) => txFn(r.y)),
                          line: { color: '#9a3412', width: 2.4 },
                          hovertemplate: 'x: %{x:.2f}<br>y: %{y:.4f}<extra></extra>',
                        });
                        return traces;
                      })()}
                      layout={{
                        autosize: true, height: 320,
                        xaxis: {
                          title: { text: (() => {
                            const raw = secondaryModel?.xLabel ?? '';
                            if (raw === 'Factor') {
                            const f = getFactorDef(primaryFactorKey);
                            return formatLabelToHtml(f ? `${f.label}${f.unit ? ` (${f.unit})` : ''}` : raw);
                          }
                            return formatLabelToHtml(raw);
                          })(), font: { size: 16, family: 'Inter, system-ui, sans-serif', color: '#334155' }, standoff: 8 },
                          tickfont: { size: 14, color: '#475569' }, gridcolor: '#e2e8f0', zeroline: false,
                          range: (() => {
                            const validRows = activeFit.rows.filter((r) => Number.isFinite(r.y));
                            const curveData = activeFit.curve.filter((r) => Number.isFinite(r.y));
                            return computePaddedAxisRange(
                              [
                                ...validRows.map((row) => row.x),
                                ...curveData.map((row) => row.x),
                              ],
                              { minPad: 0.25 },
                            );
                          })(),
                        },
                        yaxis: {
                          title: { text: (() => {
                            const base = inverseTransform.transformedLabel;
                            return formatLabelToHtml(showOriginalScale ? inverseTransform.stripLabel(base) : base);
                          })(), font: { size: 16, family: 'Inter, system-ui, sans-serif', color: '#334155' }, standoff: 8 },
                          tickfont: { size: 14, color: '#475569' }, gridcolor: '#e2e8f0', zeroline: false,
                        },
                        legend: { orientation: 'h', xref: 'container', yref: 'container', x: 0.5, xanchor: 'center', y: 0, yanchor: 'bottom', font: { size: 14, color: '#334155' } },
                        margin: { l: 75, r: 24, b: 100, t: 16, pad: 4 },
                        paper_bgcolor: 'white', plot_bgcolor: 'white',
                        font: { family: 'Inter, system-ui, sans-serif', color: '#334155' },
                        hovermode: 'closest',
                      }}
                      config={{ responsive: true, displayModeBar: true, toImageButtonOptions: { format: 'png', width: 1200, height: 750, scale: 3 } }}
                      style={{ width: '100%' }}
                      useResizeHandler
                    />
                  </Suspense>
                </div>
              ) : multiVarChartView === 'contour' ? (
                (() => {
                  const keys = secondaryModel?.factorKeys ?? [primaryFactorKey, 'aw'];
                  if (keys.length < 2) {
                    return (
                      <div className="panel chart-placeholder">
                        <p>Single-factor model — contour visualization requires 2+ factors. Use Observed vs Predicted view.</p>
                      </div>
                    );
                  }
                  return (
                    <ContourPlot
                      fittedModel={activeFit}
                      rows={activeFit?.rows ?? rows}
                      factorKeys={keys}
                      factorValues={factorValues}
                      targetLabel={activeTargetConfig?.label ?? targetKey}
                      transformedLabel={inverseTransform.transformedLabel}
                      showOriginalScale={showOriginalScale}
                      inverseTransform={inverseTransform}
                    />
                  );
                })()
              ) : multiVarChartView === '3d' ? (
                <ResponseSurface3D
                  fittedModel={activeFit}
                  rows={activeFit?.rows ?? rows}
                  factorKeys={secondaryModel?.factorKeys ?? [primaryFactorKey, 'aw']}
                  factorValues={factorValues}
                  targetLabel={activeTargetConfig?.label ?? targetKey}
                  transformedLabel={inverseTransform.transformedLabel}
                  showOriginalScale={showOriginalScale}
                  inverseTransform={inverseTransform}
                />
              ) : (
                <ObservedVsPredictedPlot
                  activeFit={activeFit}
                  targetLabel={activeTargetConfig?.label ?? targetKey}
                  transformedLabel={inverseTransform.transformedLabel}
                  showOriginalScale={showOriginalScale}
                  inverseTransform={inverseTransform}
                />
              )}
            </div>

            <div className="panel secondary-summary-panel">
              <h2 className="panel-title">Secondary Fit Statistics</h2>
              <SecondaryFitSummary
                fit={activeFit}
                model={secondaryModel}
                primaryModelName={stripModelName(MODELS[activeFit.primaryModelId]?.name)}
                targetLabel={MODEL_SECONDARY_CONFIG[activeFit.primaryModelId]?.targets?.[activeFit.targetKey]?.label ?? targetKey}
              />
              {Number.isFinite(activeFit.normalityPValue) && activeFit.normalityPValue < 0.05 && (
                <div className="normality-warning">{NORMALITY_WARNING}</div>
              )}
              <div className="secondary-summary-exports">
                <button className="btn-secondary" onClick={() => downloadSecondaryFitReport(activeFit)}>Export fit report (CSV)</button>
                <button className="btn-secondary" onClick={exportAnalysisJson}>Export analysis (JSON)</button>
              </div>
            </div>
            </div>

            <details className="panel secondary-analysis-details">
              <summary>Diagnostics and model ranking</summary>
              <div className="secondary-analysis-body">
              <div className="stats-toolbar">
                <button className="btn-secondary" onClick={() => setShowResidualPlot((prev) => !prev)}>
                  Show residual plot
                </button>
                <span className="residual-meta">
                  Shapiro-Wilk p: {formatPValue(activeFit.normalityPValue)}
                </span>
              </div>
              {showResidualPlot && (
                <ResidualPlot
                  residuals={activeFit.residuals}
                  title={`${stripModelName(SECONDARY_MODELS[activeFit.secondaryModelId]?.name)} Residual Plot`}
                  exportBaseName={residualExportBaseName}
                />
              )}
              <table className="result-table">
                <tbody>
                  <tr><th>Primary model</th><td>{stripModelName(MODELS[activeFit.primaryModelId]?.name)}</td></tr>
                  <tr><th>Target</th><td><FormattedLabel text={MODEL_SECONDARY_CONFIG[activeFit.primaryModelId]?.targets?.[activeFit.targetKey]?.label} /></td></tr>
                  <tr><th>Secondary model</th><td>{stripModelName(SECONDARY_MODELS[activeFit.secondaryModelId]?.name)}</td></tr>
                  <tr><th>R²</th><td>{formatMetric(activeFit.r2)}</td></tr>
                  <tr><th>Adj. R²</th><td>{formatMetric(activeFit.r2adj)}</td></tr>
                  <tr><th>RMSE (regression scale)</th><td>{formatMetric(activeFit.rmse)} ({activeFit.rmseScale ?? "identity"})</td></tr>
                  <tr><th>Residual standard error</th><td>{formatMetric(activeFit.residualSE)}</td></tr>
                  <tr><th>Raw target RMSE</th><td>{formatMetric(activeFit.rawTargetRMSE)}</td></tr>
                  {activeFit.linkedCurveMetrics && (
                    <tr>
                      <th>Linked curve RMSE</th>
                      <td>
                        {formatMetric(activeFit.linkedCurveMetrics.rmse)}
                        <span className="muted"> (log count, n={activeFit.linkedCurveMetrics.n})</span>
                      </td>
                    </tr>
                  )}
                  <tr><th><FormattedLabel text="AICc" /></th><td>{activeFit.aiccValid === false ? "N/A" : formatMetric(activeFit.aicc)} ({activeFit.aiccScale ?? targetKey})</td></tr>
                  {secondaryModel?.params.map((param) => (
                    <tr key={param.name}>
                      <th><FormattedLabel text={getParamDisplayLabel(param)} />{param.fixed ? ' (fixed)' : ''}</th>
                      <td>{param.name === 'logDref'
                        ? formatParameterValue(Math.pow(10, activeFit.params[param.name]))
                        : formatParameterValue(activeFit.params[param.name])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {rankedForTarget.length > 0 && (
                <>
                  <h3 style={{ marginTop: 16, marginBottom: 6, fontSize: 15, fontWeight: 600 }}>Model Ranking for {activeTargetConfig?.label ?? targetKey}</h3>
                  <p className="hint">Ranked by AICc on the raw target scale, using converged fits with valid AICc and the same observations. R² uses each model’s regression scale.</p>
                  <table className="secondary-rank-table">
                    <thead>
                      <tr>
                        <th>Rank</th>
                        <th>Model</th>
                        <th>R²</th>
                        <th>Adj. R²</th>
                        <th>Raw target RMSE</th>
                        <th><FormattedLabel text="AICc" /></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rankedForTarget.map((entry) => {
                        const fKeys = SECONDARY_MODELS[entry.fit.secondaryModelId]?.factorKeys ?? [];
                        const constKeys = fKeys.filter((k) => k !== primaryFactorKey && constantFactors.includes(k));
                        const factorLabel = fKeys.length > 0
                          ? ` (${fKeys.map(getFactorShortLabel).join(', ')})`
                          : '';
                        return (
                        <tr key={entry.key} className={entry.rank === 1 ? 'rank-1' : ''} style={constKeys.length > 0 ? { opacity: 0.4 } : undefined}>
                          <td>{entry.rank}</td>
                          <td>
                            {stripModelName(SECONDARY_MODELS[entry.fit.secondaryModelId]?.name)}
                            <span style={{ fontSize: 14, color: '#888', marginLeft: 4 }}><FormattedLabel text={factorLabel} /></span>
                            {constKeys.length > 0 && (
                              <span style={{ fontSize: 14, color: '#c00', marginLeft: 4 }}>
                                — no variation: <FormattedLabel text={constKeys.map(getFactorShortLabel).join(', ')} />
                              </span>
                            )}
                          </td>
                          <td>{formatMetric(entry.fit.r2)}</td>
                          <td>{formatMetric(entry.fit.r2adj)}</td>
                          <td>{formatMetric(entry.fit.rawTargetRMSE)}</td>
                          <td>{formatMetric(entry.fit.aicc)}</td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </>
              )}
              </div>
            </details>

          </>
        ) : (
          <div className="panel chart-placeholder">
            <p>Select a registered target and fit a secondary model.</p>
            <p className="hint">The page auto-loads temperature/value pairs from primary fit results.</p>
          </div>
        )}

        <ExternalValidation
          primaryModelId={primaryModelId}
          bindings={bindings}
          fittedModels={fittedModels}
          manualParams={manualParams}
          visibleFactorKeys={visibleFactorKeys}
          datasets={datasets}
          fitResults={fitResults}
        />

        {/* Card 1: Predicted Primary Curve */}
        <div className="panel prediction-card">
          <div className="chart-header">
            <h2 className="panel-title">Predicted Primary Curve</h2>
            <PlotlyExportActions
              plotId="predicted-primary-curve"
              baseName="PredictedCurve"
            />
          </div>

          <table className="result-table rra-params-table">
            <tbody>
              <tr><th>Primary model</th><td>{stripModelName(primaryModel?.name)}</td></tr>
              {factorDefs
                .filter((factor) => secondaryModel?.factorKeys?.includes(factor.key) ?? true)
                .map((factor) => (
                <tr key={factor.key}>
                  <th>{factor.label}</th>
                  <td>{factor.key === 'aw' ? Number(factorValues[factor.key]).toFixed(3) : factor.key === 'pressure' ? Math.round(Number(factorValues[factor.key])) : Number(factorValues[factor.key]).toFixed(1)}{factor.unit ? ` ${factor.unit}` : ''}</td>
                </tr>
              ))}
              {primaryModel?.params.map((param) => {
                const val = predictedParams?.[param.name];
                return (
                  <tr key={param.name}>
                    <th><FormattedLabel text={replaceTimeUnit(param.label)} /></th>
                    <td>{val?.toPrecision?.(3) ?? 'NA'}</td>
                  </tr>
                );
              })}
              {/* Derived D-value rows for kmax-based models */}
              {predictedParams?.kmax != null && Number.isFinite(predictedParams.kmax) && predictedParams.kmax > 0 && (
                <tr>
                  <th>D-value ({timeUnit})</th>
                  <td>{(Math.LN10 / predictedParams.kmax).toPrecision(3)}</td>
                </tr>
              )}
              {predictedParams?.kmax1 != null && Number.isFinite(predictedParams.kmax1) && predictedParams.kmax1 > 0 && (
                <tr>
                  <th>D₁-value (min)</th>
                  <td>{(Math.LN10 / predictedParams.kmax1).toPrecision(3)}</td>
                </tr>
              )}
              {predictedParams?.kmax2 != null && Number.isFinite(predictedParams.kmax2) && predictedParams.kmax2 > 0 && (
                <tr>
                  <th>D₂-value (min)</th>
                  <td>{(Math.LN10 / predictedParams.kmax2).toPrecision(3)}</td>
                </tr>
              )}
            </tbody>
          </table>

          <div>
            {predictionCurve && predictionCurve.length > 0 && (
              <Suspense fallback={<p className="hint">Loading chart...</p>}>
                {(() => {
                  const curvePoints = predictionCurve.filter((p) => Number.isFinite(p.logN));
                  const autoXRange = computePaddedAxisRange(
                    curvePoints.map((point) => point.t),
                    { includeZero: true, minPad: 0.25 },
                  );
                  return (
                <Plot
                  divId="predicted-primary-curve"
                  data={[{
                    type: 'scatter', mode: 'lines', name: 'Predicted curve',
                    x: curvePoints.map((p) => p.t),
                    y: curvePoints.map((p) => p.logN),
                    line: { color: '#166534', width: 2.4 },
                    hovertemplate: 't: %{x:.2f}<br>Survival: %{y:.3f}<extra></extra>',
                  }]}
                  layout={{
                    autosize: true, height: 300,
                    xaxis: {
                      title: { text: `Time (${timeUnit})`, font: { size: 14, family: 'Inter, system-ui, sans-serif', color: '#1a1a1a' }, standoff: 8 },
                      tickfont: { size: 14, family: 'Inter, system-ui, sans-serif', color: '#333' },
                      gridcolor: 'rgba(0,0,0,0.06)', gridwidth: 0.5, zeroline: false,
                      showline: true, linecolor: '#1a1a1a', linewidth: 1.5,
                      ticks: 'inside', tickwidth: 1, ticklen: 4, tickcolor: '#1a1a1a',
                      range: autoXRange, mirror: true,
                    },
                    yaxis: {
                      title: { text: 'Survival (log\u2081\u2080CFU/g)', font: { size: 14, family: 'Inter, system-ui, sans-serif', color: '#1a1a1a' }, standoff: 8 },
                      tickfont: { size: 14, family: 'Inter, system-ui, sans-serif', color: '#333' },
                      gridcolor: 'rgba(0,0,0,0.06)', gridwidth: 0.5, zeroline: false,
                      showline: true, linecolor: '#1a1a1a', linewidth: 1.5,
                      ticks: 'inside', tickwidth: 1, ticklen: 4, tickcolor: '#1a1a1a',
                      rangemode: 'tozero', tickformat: 'd', mirror: true,
                    },
                    margin: { l: 60, r: 20, b: 50, t: 10, pad: 4 },
                    paper_bgcolor: 'white', plot_bgcolor: 'white',
                    font: { family: 'Inter, system-ui, sans-serif', color: '#1a1a1a' },
                    hovermode: 'closest',
                  }}
                  config={{ responsive: true, displayModeBar: true, toImageButtonOptions: { format: 'png', width: 1200, height: 750, scale: 3 } }}
                  style={{ width: '100%' }}
                  useResizeHandler
                />
                  );
                })()}
              </Suspense>
            )}
          </div>
        </div>

        {/* Card 2: Risk Assessment (Monte Carlo) */}
        <div className="panel risk-assessment-card">
          <div className="chart-header">
            <h2 className="panel-title">Risk Assessment</h2>
          </div>
          <MonteCarloPanel
            predictedParams={predictedParams}
            primaryFit={primaryFitForMC}
            modelId={primaryModelId}
            tMax={Math.max(...(datasets.flatMap((d) => d.data.map((p) => p.t))), 10) * 1.2}
            factorValues={factorValues}
            visibleFactorKeys={visibleFactorKeys}
            bindings={bindings}
            fittedSecondaryModels={fittedModels}
            manualParams={manualParams}
          />
        </div>
      </section>
    </div>
  );
}
