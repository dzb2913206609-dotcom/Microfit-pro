import { useState } from 'react';
import { MODELS } from '../models/inactivationModels';

export default function ResultTable({ datasets, activeDatasetId, fitResults }) {
  const [selectedTab, setSelectedTab] = useState(null);

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
            </tr>
          </thead>
          <tbody>
            {resultsForTab.map((r, idx) => {
              const model = MODELS[r.modelId];
              const paramStr = model?.params
                .map((p) => {
                  const v = r.params[p.name];
                  const se = r.paramErrors?.[p.name];
                  return `${p.label}=${v?.toFixed(4)}${se ? ` ± ${se.toFixed(4)}` : ''}`;
                })
                .join(', ');

              return (
                <tr key={`${r.datasetId}_${r.modelId}`} className={idx === 0 ? 'best-row' : ''}>
                  <td>{idx + 1}</td>
                  <td>
                    <strong>{model?.name}</strong>
                    <div className="shape-tag">{model?.shape}</div>
                  </td>
                  <td className={r.r2 > 0.99 ? 'good' : r.r2 > 0.95 ? 'ok' : 'poor'}>
                    {r.r2?.toFixed(4)}
                  </td>
                  <td className={r.r2adj > 0.99 ? 'good' : r.r2adj > 0.95 ? 'ok' : 'poor'}>
                    {r.r2adj?.toFixed(4)}
                  </td>
                  <td>{r.rmse?.toFixed(4)}</td>
                  <td>{Number.isFinite(r.aicc) ? r.aicc.toFixed(4) : 'NA'}</td>
                  <td>{r.sse?.toFixed(4)}</td>
                  <td>{r.n}</td>
                  <td className="param-cell">{paramStr}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <BestModelSummary fittedResults={resultsForTab} />
    </div>
  );
}

function BestModelSummary({ fittedResults }) {
  const best = fittedResults[0];
  if (!best) return null;

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
          <span className="dv-value">{best.r2?.toFixed(4)}</span>
        </div>
        <div className="dvalue-item">
          <span className="dv-label">RMSE</span>
          <span className="dv-value">{best.rmse?.toFixed(4)}</span>
        </div>
        <div className="dvalue-item">
          <span className="dv-label">AICc</span>
          <span className="dv-value">{Number.isFinite(best.aicc) ? best.aicc.toFixed(4) : 'NA'}</span>
        </div>
      </div>
    </div>
  );
}
