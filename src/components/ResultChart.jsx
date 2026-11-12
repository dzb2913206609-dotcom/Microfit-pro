import { lazy, Suspense, useMemo, useState } from 'react';
import Plotly from 'plotly.js-dist-min';
import { MODELS, predictCurve } from '../models/inactivationModels';
import { useScenario } from '../ScenarioContext';
import { getFactorDef } from '../config/factors';
import { computePaddedAxisRange } from '../utils/chartRanges.js';

const Plot = lazy(() => import('./PlotlyChart'));

const PLOTLY_SYMBOLS = ['circle', 'triangle-up', 'square', 'diamond', 'cross'];
const PLOTLY_DASHES = ['solid', 'dash', 'dot', 'dashdot', 'longdashdot'];

const AXIS_TITLE_FONT = { size: 20, family: 'Inter, system-ui, sans-serif', color: '#1a1a1a' };
const TICK_FONT = { size: 16, family: 'Inter, system-ui, sans-serif', color: '#333' };
const DEFAULT_Y_LABEL = 'Survival (log\u2081\u2080CFU/g)';

const INITIAL_AXIS = {
  xLabel: '', yLabel: '',
  xMin: '', xMax: '', yMin: '', yMax: '',
  titleFontSize: 20, tickFontSize: 16,
  dtickX: '', dtickY: '',
};

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

export default function ResultChart({
  datasets, selectedModels, fitResults,
  hoveredModel, prediction, primaryFitDisplay = 'selected',
}) {
  const { scenario, primaryFactorKey, useDoseAxis, mode, timeUnit } = useScenario();
  const customPrimaryFactor = scenario === 'custom' ? getFactorDef(primaryFactorKey) : null;
  const xLabel = useDoseAxis
    ? `${mode.doseAxis.label} (${mode.doseAxis.unit})`
    : customPrimaryFactor
      ? `${customPrimaryFactor.label}${customPrimaryFactor.unit ? ` (${customPrimaryFactor.unit})` : ''}`
    : `Time (${timeUnit})`;
  const chartDatasets = useMemo(
    () => datasets.filter((d) => d.showOnChart !== false && d.data?.length > 0),
    [datasets],
  );

  const [ax, setAx] = useState(INITIAL_AXIS);
  const [showSettings, setShowSettings] = useState(false);
  const updateAx = (key, val) => setAx((prev) => ({ ...prev, [key]: val }));

  const tMaxExt = chartDatasets.length > 0
    ? Math.max(...chartDatasets.map((ds) => Math.max(...ds.data.map((d) => d.t)))) * 1.15
    : 0;

  const lines = useMemo(() => {
    if (primaryFitDisplay === 'pointsOnly') return [];

    if (primaryFitDisplay === 'bestAicc') {
      return chartDatasets.flatMap((ds) => {
        const candidates = Object.values(fitResults)
          .filter((fr) => fr?.datasetId === ds.id && !fr.failed && fr.params)
          .sort((a, b) => {
            const aScore = Number.isFinite(a.aicc) ? a.aicc : Number.POSITIVE_INFINITY;
            const bScore = Number.isFinite(b.aicc) ? b.aicc : Number.POSITIVE_INFINITY;
            if (aScore !== bScore) return aScore - bScore;
            return (a.rmse ?? Number.POSITIVE_INFINITY) - (b.rmse ?? Number.POSITIVE_INFINITY);
          });
        const fr = candidates[0];
        if (!fr) return [];
        const modelId = fr.modelId;
        const key = `${ds.id}_${modelId}`;
        const curve = fr.curve || predictCurve(modelId, fr.params, tMaxExt);
        return [{
          key,
          datasetId: ds.id,
          datasetName: ds.name,
          datasetColor: ds.color,
          modelId,
          curve,
          dashPattern: 'solid',
          bestFit: true,
        }];
      });
    }

    const dashMap = {};
    selectedModels.forEach((modelId, idx) => {
      dashMap[modelId] = PLOTLY_DASHES[idx % PLOTLY_DASHES.length];
    });
    const result = [];
    chartDatasets.forEach((ds) => {
      selectedModels.forEach((modelId) => {
        const key = `${ds.id}_${modelId}`;
        const fr = fitResults[key];
        if (fr && !fr.failed && fr.params) {
          const curve = fr.curve || predictCurve(modelId, fr.params, tMaxExt);
          result.push({
            key,
            datasetId: ds.id,
            datasetName: ds.name,
            datasetColor: ds.color,
            modelId,
            curve,
            dashPattern: dashMap[modelId],
          });
        }
      });
    });
    return result;
  }, [chartDatasets, selectedModels, fitResults, tMaxExt, primaryFitDisplay]);

  const selectedLine = useMemo(() => {
    if (hoveredModel) {
      return lines.find((line) => line.modelId === hoveredModel) ?? null;
    }
    if (selectedModels.length === 1) {
      return lines.find((line) => line.modelId === selectedModels[0]) ?? null;
    }
    return lines[0] ?? null;
  }, [hoveredModel, lines, selectedModels]);

  const exportBaseName = buildResultBaseName(
    selectedLine?.datasetName ?? chartDatasets[0]?.name,
    selectedLine ? MODELS[selectedLine.modelId]?.name ?? selectedLine.modelId : 'PrimaryModels',
  );

  const traces = useMemo(() => {
    const result = [];

    chartDatasets.forEach((ds, dsIdx) => {
      const dsData = ds.data;
      result.push({
        type: 'scatter',
        mode: 'markers',
        name: ds.name,
        x: dsData.map((d) => d.t),
        y: dsData.map((d) => d.logN),
        error_y: {
          type: 'data',
          array: dsData.map((d) => d.sd ?? 0),
          visible: true,
          color: ds.color + '99',
          thickness: 0.8,
          width: 3,
        },
        marker: {
          color: ds.color,
          size: 8,
          symbol: PLOTLY_SYMBOLS[(ds.shapeIdx ?? dsIdx) % PLOTLY_SYMBOLS.length],
          line: { color: 'white', width: 0.8 },
        },
        legendgroup: `ds_${ds.id}`,
        cliponaxis: false,
        hovertemplate: `${ds.name}<br>${xLabel}: %{x:.2f}<br>log\u2081\u2080(N): %{y:.3f}<extra></extra>`,
      });
    });

    lines.forEach((line) => {
      const curveData = line.curve.filter((p) => p.logN != null && Number.isFinite(p.logN));
      const modelName = stripModelName(MODELS[line.modelId]?.name);

      result.push({
        type: 'scatter',
        mode: 'lines',
        name: `${line.datasetName} \u2013 ${line.bestFit ? 'Best: ' : ''}${modelName}`,
        x: curveData.map((p) => p.t),
        y: curveData.map((p) => p.logN),
        line: {
          color: line.datasetColor,
          width: hoveredModel === line.modelId ? 4 : 2.4,
          dash: line.dashPattern,
        },
        opacity: hoveredModel != null && hoveredModel !== line.modelId ? .15 : 1,
        legendgroup: `line_${line.key}`,
        hovertemplate: `${modelName}<br>${xLabel}: %{x:.2f}<br>log\u2081\u2080(N): %{y:.3f}<extra></extra>`,
      });
    });

    if (prediction && Number.isFinite(prediction.t) && Number.isFinite(prediction.logN)) {
      result.push({
        type: 'scatter',
        mode: 'markers',
        name: 'Prediction',
        x: [prediction.t],
        y: [prediction.logN],
        marker: { color: '#e11d48', size: 10, symbol: 'circle', line: { color: 'white', width: 2 } },
        cliponaxis: false,
        showlegend: false,
        hovertemplate: `Prediction<br>${xLabel}: %{x:.2f}<br>log\u2081\u2080(N): %{y:.3f}<extra></extra>`,
      });
    }

    return result;
  }, [chartDatasets, lines, prediction, xLabel, hoveredModel]);

  const layout = useMemo(() => {
    const shapes = [];

    if (prediction && Number.isFinite(prediction.t) && Number.isFinite(prediction.logN)) {
      shapes.push(
        {
          type: 'line', x0: prediction.t, x1: prediction.t, y0: 0, y1: 1, yref: 'paper',
          line: { color: '#e11d48', width: 1.2, dash: 'dash' },
        },
        {
          type: 'line', x0: 0, x1: 1, xref: 'paper', y0: prediction.logN, y1: prediction.logN,
          line: { color: '#e11d48', width: 1.2, dash: 'dash' },
        },
      );
    }

    const traceCount = chartDatasets.length + lines.length;
    const legendHeight = Math.min(280, Math.max(100, traceCount * 9));
    const dynamicHeight = 440 + legendHeight;

    const titleFont = { ...AXIS_TITLE_FONT, size: ax.titleFontSize || 20 };
    const tickFont = { ...TICK_FONT, size: ax.tickFontSize || 16 };
    const xRange = (ax.xMin !== '' && ax.xMax !== '') ? [+ax.xMin, +ax.xMax] : undefined;
    const yRange = (ax.yMin !== '' && ax.yMax !== '') ? [+ax.yMin, +ax.yMax] : undefined;
    const autoXRange = !xRange
      ? computePaddedAxisRange(
        [
          ...chartDatasets.flatMap((ds) => ds.data.map((point) => point.t)),
          ...lines.flatMap((line) => line.curve.map((point) => point.t)),
          prediction?.t,
        ],
        { includeZero: true, minPad: 0.25 },
      )
      : undefined;

    return {
      autosize: true,
      height: dynamicHeight,
      xaxis: {
        title: { text: ax.xLabel || xLabel, font: titleFont, standoff: 12 },
        tickfont: tickFont,
        gridcolor: 'rgba(0,0,0,0.06)',
        gridwidth: 0.5,
        zeroline: false,
        showline: true,
        linecolor: '#1a1a1a',
        linewidth: 1.5,
        ticks: 'inside',
        tickwidth: 1,
        ticklen: 5,
        tickcolor: '#1a1a1a',
        range: xRange ?? autoXRange,
        dtick: ax.dtickX ? +ax.dtickX : undefined,
        mirror: true,
      },
      yaxis: {
        title: { text: ax.yLabel || DEFAULT_Y_LABEL, font: titleFont, standoff: 12 },
        tickfont: tickFont,
        gridcolor: 'rgba(0,0,0,0.06)',
        gridwidth: 0.5,
        zeroline: false,
        showline: true,
        linecolor: '#1a1a1a',
        linewidth: 1.5,
        ticks: 'inside',
        tickwidth: 1,
        ticklen: 5,
        tickcolor: '#1a1a1a',
        tickformat: 'd',
        rangemode: yRange ? undefined : 'tozero',
        range: yRange,
        dtick: ax.dtickY ? +ax.dtickY : undefined,
        mirror: true,
      },
      legend: {
        orientation: 'h',
        xref: 'container',
        yref: 'container',
        x: 0.5,
        xanchor: 'center',
        y: 0,
        yanchor: 'bottom',
        font: { size: 14, family: 'Inter, system-ui, sans-serif', color: '#1a1a1a' },
        bgcolor: 'rgba(255,255,255,0)',
        bordercolor: 'rgba(0,0,0,0)',
        borderwidth: 0,
        tracegroupgap: 8,
      },
      margin: { l: 80, r: 24, b: legendHeight + 50, t: 30, pad: 4 },
      paper_bgcolor: 'white',
      plot_bgcolor: 'white',
      font: { family: 'Inter, system-ui, sans-serif', color: '#1a1a1a' },
      shapes,
      hovermode: 'closest',
    };
  }, [xLabel, prediction, chartDatasets, lines, ax]);

  if (chartDatasets.length === 0) {
    return (
      <div className="panel chart-placeholder">
        <p>The fitted curves will appear here after data are loaded.</p>
      </div>
    );
  }

  return (
    <div className="panel" style={{ position: 'relative' }}>
      <div className="chart-header">
        <h2 className="panel-title">Inactivation Curve Comparison</h2>
        <div className="chart-actions">
          <button className="btn-secondary btn-compact"
            onClick={() => setShowSettings((v) => !v)}>
            {showSettings ? 'Hide Settings' : 'Chart Settings'}
          </button>
          <PlotlyExportActions plotId="primary-result-chart" baseName={exportBaseName} />
        </div>
      </div>

      {showSettings && (
        <div className="chart-settings-popover">
          <label className="chart-settings-label">
            X Label
            <input value={ax.xLabel} onChange={(e) => updateAx('xLabel', e.target.value)}
              placeholder={xLabel} />
          </label>
          <label className="chart-settings-label">
            Y Label
            <input value={ax.yLabel} onChange={(e) => updateAx('yLabel', e.target.value)}
              placeholder={DEFAULT_Y_LABEL} />
          </label>
          <label className="chart-settings-label">
            X Range (min–max)
            <span className="chart-range-inputs">
              <input type="number" value={ax.xMin} onChange={(e) => updateAx('xMin', e.target.value)}
                placeholder="auto" />
              <input type="number" value={ax.xMax} onChange={(e) => updateAx('xMax', e.target.value)}
                placeholder="auto" />
            </span>
          </label>
          <label className="chart-settings-label">
            Y Range (min–max)
            <span className="chart-range-inputs">
              <input type="number" value={ax.yMin} onChange={(e) => updateAx('yMin', e.target.value)}
                placeholder="auto" />
              <input type="number" value={ax.yMax} onChange={(e) => updateAx('yMax', e.target.value)}
                placeholder="auto" />
            </span>
          </label>
          <label className="chart-settings-label">
            Title Font Size
            <input type="number" value={ax.titleFontSize} min={8} max={36}
              onChange={(e) => updateAx('titleFontSize', +e.target.value || 18)} />
          </label>
          <label className="chart-settings-label">
            Tick Font Size
            <input type="number" value={ax.tickFontSize} min={6} max={28}
              onChange={(e) => updateAx('tickFontSize', +e.target.value || 14)} />
          </label>
          <label className="chart-settings-label">
            X Tick Interval
            <input type="number" value={ax.dtickX} onChange={(e) => updateAx('dtickX', e.target.value)}
              placeholder="auto" />
          </label>
          <label className="chart-settings-label">
            Y Tick Interval
            <input type="number" value={ax.dtickY} onChange={(e) => updateAx('dtickY', e.target.value)}
              placeholder="auto" />
          </label>
          <div className="chart-settings-reset">
            <button className="btn-secondary btn-compact"
              onClick={() => setAx(INITIAL_AXIS)}>Reset</button>
          </div>
        </div>
      )}

      <Suspense fallback={<p className="hint">Loading chart...</p>}>
        <div style={{ minHeight: layout.height }}>
        <Plot
          divId="primary-result-chart"
          data={traces}
          layout={layout}
          config={{
            responsive: true,
            scrollZoom: false,
            displayModeBar: true,
            modeBarButtonsToAdd: ['resetScale2d'],
            toImageButtonOptions: {
              format: 'svg',
              filename: exportBaseName,
              width: 1200,
              height: 750,
              scale: 3,
            },
          }}
          style={{ width: '100%', height: layout.height }}
          useResizeHandler
        />
        </div>
      </Suspense>
    </div>
  );
}
