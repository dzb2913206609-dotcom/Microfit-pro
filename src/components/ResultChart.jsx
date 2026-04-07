import {
  ComposedChart, Line, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, ErrorBar,
} from 'recharts';
import { MODELS, predictCurve } from '../models/inactivationModels';
import { formatAxisTick, formatMetric } from '../models/fitter';

// color = group, shape = observed data points, linestyle = model rank by AICc
const DASH_PATTERNS = [undefined, '6 3', '2 3', '8 3 2 3', '4 2 4 2'];

// 5 distinct SVG shapes for dataset points
const SHAPES = [
  // Circle
  ({ cx, cy, fill }) => (
    <circle cx={cx} cy={cy} r={4.5} fill={fill} stroke="white" strokeWidth={1.2} />
  ),
  // Triangle (up)
  ({ cx, cy, fill }) => (
    <polygon
      points={`${cx},${cy - 5} ${cx - 4.5},${cy + 4} ${cx + 4.5},${cy + 4}`}
      fill={fill} stroke="white" strokeWidth={1.2}
    />
  ),
  // Square
  ({ cx, cy, fill }) => (
    <rect x={cx - 4} y={cy - 4} width={8} height={8} fill={fill} stroke="white" strokeWidth={1.2} />
  ),
  // Diamond
  ({ cx, cy, fill }) => (
    <polygon
      points={`${cx},${cy - 5.5} ${cx - 5.5},${cy} ${cx},${cy + 5.5} ${cx + 5.5},${cy}`}
      fill={fill} stroke="white" strokeWidth={1.2}
    />
  ),
  // Plus / cross
  ({ cx, cy, fill }) => (
    <path
      d={`M${cx - 4.5},${cy} L${cx + 4.5},${cy} M${cx},${cy - 4.5} L${cx},${cy + 4.5}`}
      stroke={fill} strokeWidth={2.5} fill="none"
    />
  ),
];

function getShape(shapeIdx) {
  return SHAPES[shapeIdx % SHAPES.length];
}

export default function ResultChart({
  datasets, selectedModels, fitResults,
  hoveredModel, setHoveredModel,
}) {
  const chartDatasets = datasets.filter((d) => d.showOnChart !== false && d.data?.length > 0);

  if (chartDatasets.length === 0) {
    return (
      <div className="panel chart-placeholder">
        <p>The fitted curves will appear here after data are loaded.</p>
      </div>
    );
  }

  const tMaxExt = Math.max(
    ...chartDatasets.map((ds) => Math.max(...ds.data.map((d) => d.t))),
  ) * 1.15;

  // Assign a fixed dash pattern per model (by index in selectedModels),
  // so the same model always gets the same line style across all datasets.
  const modelDashMap = {};
  selectedModels.forEach((modelId, idx) => {
    modelDashMap[modelId] = DASH_PATTERNS[idx % DASH_PATTERNS.length];
  });

  // Build lines: per dataset, only selectedModels with valid fit results
  const lines = [];
  chartDatasets.forEach((ds) => {
    selectedModels.forEach((modelId) => {
      const key = `${ds.id}_${modelId}`;
      const result = fitResults[key];
      if (result && !result.failed && result.params) {
        const curve = result.curve || predictCurve(modelId, result.params, tMaxExt);
        lines.push({
          key,
          datasetId: ds.id,
          datasetName: ds.name,
          datasetColor: ds.color,
          modelId,
          curve,
          dashPattern: modelDashMap[modelId],
        });
      }
    });
  });

  // Collect observed t values only
  const tSet = new Set();
  chartDatasets.forEach((ds) => ds.data.forEach((d) => tSet.add(d.t)));
  const allT = [...tSet].sort((a, b) => a - b);

  // Build chart data keyed by t (observed points only)
  const chartData = allT.map((t) => {
    const point = { t };
    chartDatasets.forEach((ds) => {
      const obs = ds.data.find((d) => d.t === t);
      if (obs) {
        point[`obs_${ds.id}`] = obs.logN;
        point[`sd_${ds.id}`] = obs.sd;
      }
    });
    return point;
  });

  const hasHover = hoveredModel != null;

  function getLineProps(line) {
    const isHovered = hoveredModel === line.modelId;
    const isDimmed = hasHover && !isHovered;

    return {
      strokeWidth: isHovered ? 4 : 2.4,
      opacity: isDimmed ? 0.15 : 1,
      stroke: line.datasetColor,
    };
  }

  return (
    <div className="panel">
      <div className="chart-header">
        <h2 className="panel-title">Inactivation Curve Comparison</h2>
        <ExportBtn chartDatasets={chartDatasets} lines={lines} />
      </div>

      <ResponsiveContainer width="100%" height={420}>
        <ComposedChart data={chartData} margin={{ top: 10, right: 24, bottom: 12, left: 6 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="#d9e2f2" vertical={false} />
          <XAxis
            dataKey="t"
            label={{ value: 'Time (min)', position: 'insideBottom', offset: -4, style: { fontSize: 13, fill: '#334155' } }}
            tick={{ fontSize: 12, fill: '#475569' }}
            axisLine={{ stroke: '#64748b' }}
            tickLine={{ stroke: '#64748b' }}
            type="number"
            domain={[0, 'dataMax']}
          />
          <YAxis
            width={80}
            minTickGap={24}
            tickFormatter={formatAxisTick}
            label={{ value: 'log₁₀(N)', angle: -90, position: 'insideLeft', style: { fontSize: 13, fill: '#334155' } }}
            tick={{ fontSize: 12, fill: '#475569' }}
            axisLine={{ stroke: '#64748b' }}
            tickLine={{ stroke: '#64748b' }}
          />
          <Tooltip
            contentStyle={{ borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 12 }}
            formatter={(val, name) => [typeof val === 'number' ? formatMetric(val) : val, name]}
            labelFormatter={(t) => `Time: ${t?.toFixed(2)} min`}
          />
          <Legend
            content={
              <ChartLegend
                chartDatasets={chartDatasets}
                lines={lines}
                hoveredModel={hoveredModel}
                setHoveredModel={setHoveredModel}
              />
            }
          />

          {chartDatasets.map((ds, dsIdx) => (
            <Scatter
              key={ds.id}
              dataKey={`obs_${ds.id}`}
              name={ds.name}
              fill={ds.color}
              shape={getShape(ds.shapeIdx ?? dsIdx)}
              line={false}
            >
              <ErrorBar dataKey={`sd_${ds.id}`} direction="y" width={4} stroke={ds.color} strokeWidth={1.2} />
            </Scatter>
          ))}

          {lines.map((line) => {
            const lp = getLineProps(line);
            return (
              <Line
                key={line.key}
                data={line.curve.map((p) => ({ t: p.t, [line.key]: p.logN }))}
                type="monotone"
                dataKey={line.key}
                name={line.key}
                stroke={lp.stroke}
                strokeWidth={lp.strokeWidth}
                strokeOpacity={lp.opacity}
                dot={false}
                strokeDasharray={line.dashPattern}
                connectNulls={false}
                isAnimationActive={false}
              />
            );
          })}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function ChartLegend({ chartDatasets, lines, hoveredModel, setHoveredModel }) {
  const hasHover = hoveredModel != null;

  return (
    <div className="custom-legend">
      {chartDatasets.map((ds, dsIdx) => {
        const ShapeEl = getShape(ds.shapeIdx ?? dsIdx);
        return (
          <div key={`ds-${ds.id}`} className="legend-item">
            <svg width="16" height="16" style={{ flexShrink: 0 }}>
              <ShapeEl cx={8} cy={8} fill={ds.color} />
            </svg>
            <span>{ds.name}</span>
          </div>
        );
      })}
      {lines.map((line) => {
        const isHovered = hoveredModel === line.modelId;
        const isDimmed = hasHover && !isHovered;
        const opacity = isDimmed ? 0.3 : 1;

        return (
          <div
            key={`line-${line.key}`}
            className="legend-item"
            style={{ opacity, cursor: setHoveredModel ? 'pointer' : 'default' }}
            onMouseEnter={() => setHoveredModel?.(line.modelId)}
            onMouseLeave={() => setHoveredModel?.(null)}
          >
            <svg width="28" height="16" style={{ flexShrink: 0 }}>
              <line
                x1="0" y1="8" x2="28" y2="8"
                stroke={line.datasetColor}
                strokeWidth={isHovered ? 4 : 2.4}
                strokeDasharray={line.dashPattern || ''}
              />
            </svg>
            <span>
              {line.datasetName} – {MODELS[line.modelId]?.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ExportBtn({ chartDatasets, lines }) {
  function exportCSV() {
    const obsHeaders = chartDatasets.flatMap((ds) => [`mean_logN_${ds.name}`, `sd_${ds.name}`]);
    const lineHeaders = lines.map((l) => `${l.datasetName}_${l.modelId}`);
    const headers = ['time', ...obsHeaders, ...lineHeaders];

    const rowMap = new Map();
    chartDatasets.forEach((ds) => {
      ds.data.forEach((d) => {
        if (!rowMap.has(d.t)) rowMap.set(d.t, {});
        rowMap.get(d.t)[`mean_logN_${ds.name}`] = d.logN;
        rowMap.get(d.t)[`sd_${ds.name}`] = d.sd;
      });
    });
    lines.forEach((l) => {
      l.curve.forEach((pt) => {
        if (!rowMap.has(pt.t)) rowMap.set(pt.t, {});
        rowMap.get(pt.t)[`${l.datasetName}_${l.modelId}`] = pt.logN?.toFixed(4);
      });
    });

    const rows = [...rowMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([t, vals]) => [
        t.toFixed(4),
        ...obsHeaders.map((h) => vals[h] ?? ''),
        ...lineHeaders.map((h) => vals[h] ?? ''),
      ]);

    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'results.csv';
    a.click();
  }

  return (
    <button className="btn-secondary" onClick={exportCSV}>
      Export CSV
    </button>
  );
}
