import { useMemo, useState } from 'react';
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
import { MODELS } from '../models/inactivationModels';
import {
  formatAxisTick,
  formatMetric,
  formatPValue,
  formatParameterValue,
} from '../models/fitter';

const NORMALITY_WARNING = '注意：残差不符合正态分布，请考虑更换模型或检查离群点。';

function buildResidualChartData(residuals = []) {
  return residuals.map((residual, index) => ({ index: index + 1, residual }));
}

function ResidualPlot({ residuals = [], title }) {
  const chartData = useMemo(() => buildResidualChartData(residuals), [residuals]);

  if (chartData.length === 0) {
    return <p className="hint">No residual data available.</p>;
  }

  const values = chartData.map((point) => point.residual);
  const minResidual = Math.min(...values, 0);
  const maxResidual = Math.max(...values, 0);

  return (
    <div className="residual-plot-panel">
      <h3>{title}</h3>
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={chartData} margin={{ top: 10, right: 24, bottom: 12, left: 6 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="#d9e2f2" vertical={false} />
          <XAxis
            dataKey="index"
            type="number"
            domain={[1, chartData.length]}
            allowDecimals={false}
            label={{ value: 'Sample index', position: 'insideBottom', offset: -4, style: { fontSize: 13, fill: '#334155' } }}
            tick={{ fontSize: 12, fill: '#475569' }}
            axisLine={{ stroke: '#64748b' }}
            tickLine={{ stroke: '#64748b' }}
          />
          <YAxis
            type="number"
            domain={[minResidual, maxResidual]}
            width={80}
            minTickGap={24}
            tickFormatter={formatAxisTick}
            label={{ value: 'Residual', angle: -90, position: 'insideLeft', style: { fontSize: 13, fill: '#334155' } }}
            tick={{ fontSize: 12, fill: '#475569' }}
            axisLine={{ stroke: '#64748b' }}
            tickLine={{ stroke: '#64748b' }}
          />
          <Tooltip
            formatter={(value) => formatMetric(Number(value))}
            labelFormatter={(value) => `Sample ${value}`}
          />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
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
  );
}

export default function ResultTable({ datasets, activeDatasetId, fitResults }) {
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
    .sort((a, b) => {
      const aAicc = Number.isFinite(a.aicc) ? a.aicc : Infinity;
      const bAicc = Number.isFinite(b.aicc) ? b.aicc : Infinity;
      return aAicc - bAicc;
    });

  const activeDs = datasets.find((d) => d.id === activeTab);
  const residualTarget = resultsForTab.find((r) => `${r.datasetId}_${r.modelId}` === residualTargetKey) ?? null;

  return (
    <div className="panel">
      <div className="fit-stats-header">
        <h2 className="panel-title">Fit Statistics</h2>
        {visibleDatasets.length > 1 && (
          <div className="ds-tab-bar">
            {visibleDatasets.map((ds) => (
              <button
                key={ds.id}
                className={`ds-tab ${ds.id === activeTab ? 'active' : ''}`}
                style={{ '--ds-color': ds.color }}
                onClick={() => setSelectedTab(ds.id)}
              >
                <span className="ds-tab-dot" style={{ background: ds.color }} />
                {ds.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {visibleDatasets.length === 1 && activeDs && (
        <div className="ds-label-row">
          <span className="ds-tab-dot" style={{ background: activeDs.color }} />
          <span className="ds-label-name">{activeDs.name}</span>
        </div>
      )}

      <div className="table-scroll">
        <table className="result-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Model</th>
              <th>R²</th>
              <th>Adj. R²</th>
              <th>RMSE</th>
              <th>AICc</th>
              <th>SSE</th>
              <th>n</th>
              <th>Parameters</th>
              <th>Residuals</th>
            </tr>
          </thead>
          <tbody>
            {resultsForTab.map((r, idx) => {
              const model = MODELS[r.modelId];
              const parameterItems = model?.params?.map((p) => {
                const v = r.params[p.name];
                const se = r.paramErrors?.[p.name];
                const ci = r.paramCI95?.[p.name];
                return {
                  key: p.name,
                  label: p.label,
                  value: formatParameterValue(v),
                  se: Number.isFinite(se) ? formatParameterValue(se) : null,
                  ci: ci && Number.isFinite(ci[0]) && Number.isFinite(ci[1])
                    ? `[${formatParameterValue(ci[0])}, ${formatParameterValue(ci[1])}]`
                    : null,
                };
              }) ?? [];
              const isNonNormal = Number.isFinite(r.normalityPValue) && r.normalityPValue < 0.05;
              const rowKey = `${r.datasetId}_${r.modelId}`;

              return (
                <tr key={rowKey} className={idx === 0 ? 'best-row' : ''}>
                  <td>{idx + 1}</td>
                  <td>
                    <strong>{model?.name}</strong>
                    <div className="shape-tag">{model?.shape}</div>
                  </td>
                  <td className={r.r2 > 0.99 ? 'good' : r.r2 > 0.95 ? 'ok' : 'poor'}>
                    {formatMetric(r.r2)}
                  </td>
                  <td className={r.r2adj > 0.99 ? 'good' : r.r2adj > 0.95 ? 'ok' : 'poor'}>
                    {formatMetric(r.r2adj)}
                  </td>
                  <td>{formatMetric(r.rmse)}</td>
                  <td>{formatMetric(r.aicc)}</td>
                  <td>{formatMetric(r.sse)}</td>
                  <td>{r.n}</td>
                  <td className="param-cell">
                    <div className="param-list">
                      {parameterItems.map((item) => (
                        <div key={item.key} className="param-item">
                          <div className="param-main">{item.label} = {item.value}</div>
                          {(item.se || item.ci) && (
                            <div className="param-meta-line">
                              {item.se && <span>SE {item.se}</span>}
                              {item.ci && <span>95% CI {item.ci}</span>}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="residual-meta">Shapiro-Wilk p: {formatPValue(r.normalityPValue)}</div>
                    {isNonNormal && <div className="normality-warning">{NORMALITY_WARNING}</div>}
                  </td>
                  <td>
                    <button className="btn-secondary" onClick={() => setResidualTargetKey(rowKey)}>
                      显示残差图
                    </button>
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
          title={`${MODELS[residualTarget.modelId]?.name} 残差图`}
        />
      )}

      <BestModelSummary fittedResults={resultsForTab} />
    </div>
  );
}

function BestModelSummary({ fittedResults }) {
  const best = fittedResults[0];
  if (!best) return null;
  const isNonNormal = Number.isFinite(best.normalityPValue) && best.normalityPValue < 0.05;

  return (
    <div className="dvalue-box">
      <h3>Best model summary</h3>
      <div className="dvalue-grid">
        <div className="dvalue-item">
          <span className="dv-label">Model</span>
          <span className="dv-value compact">{MODELS[best.modelId]?.name}</span>
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
          <span className="dv-label">AICc</span>
          <span className="dv-value">{formatMetric(best.aicc)}</span>
        </div>
        <div className="dvalue-item">
          <span className="dv-label">Shapiro-Wilk p</span>
          <span className="dv-value">{formatPValue(best.normalityPValue)}</span>
        </div>
      </div>
      {isNonNormal && <div className="normality-warning summary-warning">{NORMALITY_WARNING}</div>}
    </div>
  );
}
