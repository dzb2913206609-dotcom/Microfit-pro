import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, Line, ComposedChart,
} from 'recharts';
import { MODELS, predictCurve } from '../models/inactivationModels';
import {
  formatAxisTick,
  formatMetric,
  formatPValue,
  formatParameterValue,
} from '../models/fitter';
import {
  MODEL_SECONDARY_CONFIG,
  SECONDARY_MODELS,
  buildSecondaryRows,
  createDefaultFactorState,
  fitSecondaryModel,
  getAvailablePrimaryModels,
  getFactorDefs,
  getSecondaryModelList,
  predictPrimaryParams,
} from '../models/secondaryModels';

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

function buildInitialManualParams(modelId) {
  const model = MODELS[modelId];
  if (!model) return {};
  return model.params.reduce((acc, param) => {
    acc[param.name] = param.defaultValue;
    return acc;
  }, {});
}

export default function SecondaryModel({ datasets, fitResults }) {
  const primaryModels = useMemo(() => getAvailablePrimaryModels(), []);
  const [primaryModelId, setPrimaryModelId] = useState(primaryModels[0]?.id ?? 'LOG_LINEAR');
  const [requestedTargetKey, setRequestedTargetKey] = useState('kmax');
  const [requestedSecondaryModelId, setRequestedSecondaryModelId] = useState(primaryModels[0]
    ? MODEL_SECONDARY_CONFIG[primaryModels[0].id]?.targets?.kmax?.defaultSecondaryModelId ?? ''
    : '');
  const [secondaryParams, setSecondaryParams] = useState({});
  const [fittedModels, setFittedModels] = useState({});
  const [bindings, setBindings] = useState({});
  const [manualParams, setManualParams] = useState(() => buildInitialManualParams(primaryModels[0]?.id ?? 'LOG_LINEAR'));
  const [factorValues, setFactorValues] = useState(() => createDefaultFactorState(['temp']));
  const [showResidualPlot, setShowResidualPlot] = useState(false);
  const currentTemperature = factorValues.temp;
  const selectedRouting = JSON.stringify(bindings);
  const predictorWatcherRef = useRef({ currentTemperature, selectedRouting });

  const config = MODEL_SECONDARY_CONFIG[primaryModelId];
  const targetEntries = useMemo(() => Object.entries(config?.targets ?? {}), [config]);
  const targetKey = config?.targets?.[requestedTargetKey]
    ? requestedTargetKey
    : (targetEntries[0]?.[0] ?? '');
  const activeTargetConfig = config?.targets?.[targetKey];
  const secondaryModelOptions = useMemo(
    () => getSecondaryModelList(activeTargetConfig?.allowedSecondaryModels ?? []),
    [activeTargetConfig],
  );
  const selectedSecondaryModelId = activeTargetConfig?.allowedSecondaryModels?.includes(requestedSecondaryModelId)
    ? requestedSecondaryModelId
    : (activeTargetConfig?.defaultSecondaryModelId ?? '');
  const secondaryModel = SECONDARY_MODELS[selectedSecondaryModelId];
  const currentSecondaryParams = useMemo(() => {
    if (!secondaryModel) return {};
    return secondaryModel.params.reduce((acc, param) => {
      acc[param.name] = secondaryParams[`${selectedSecondaryModelId}_${param.name}`] ?? param.defaultValue;
      return acc;
    }, {});
  }, [secondaryModel, secondaryParams, selectedSecondaryModelId]);

  const rows = useMemo(() => buildSecondaryRows({
    datasets,
    fitResults,
    primaryModelId,
    targetKey,
    secondaryModelId: selectedSecondaryModelId,
  }), [datasets, fitResults, primaryModelId, targetKey, selectedSecondaryModelId]);

  const fittedKeys = useMemo(() => Object.keys(fittedModels), [fittedModels]);
  const factorDefs = getFactorDefs(config?.factorKeys ?? FACTOR_DEFS.map((factor) => factor.key));

  useEffect(() => {
    predictorWatcherRef.current = { currentTemperature, selectedRouting };
  }, [currentTemperature, selectedRouting]);

  const predictedParams = useMemo(() => predictPrimaryParams({
    primaryModelId,
    bindings,
    fittedSecondaryModels: fittedModels,
    manualParams,
    factors: factorValues,
  }), [primaryModelId, bindings, fittedModels, manualParams, factorValues]);

  const predictionCurve = useMemo(() => {
    const watcher = predictorWatcherRef.current;
    void watcher;
    if (!predictedParams) return [];
    return predictCurve(primaryModelId, predictedParams, 120);
  }, [primaryModelId, predictedParams]);

  function fitCurrentSecondaryModel() {
    if (!secondaryModel || rows.length < 2) return;
    const result = fitSecondaryModel(selectedSecondaryModelId, rows, currentSecondaryParams);
    if (!result) return;

    const fitKey = `${primaryModelId}:${targetKey}`;
    setFittedModels((prev) => ({
      ...prev,
      [fitKey]: {
        fitKey,
        primaryModelId,
        targetKey,
        secondaryModelId: selectedSecondaryModelId,
        ...result,
      },
    }));
    setBindings((prev) => ({
      ...prev,
      [activeTargetConfig.mapsToParam ?? targetKey]: fitKey,
    }));
    setSecondaryParams((prev) => {
      const next = { ...prev };
      secondaryModel.params.forEach((param) => {
        next[`${selectedSecondaryModelId}_${param.name}`] = result.params[param.name];
      });
      return next;
    });
  }

  function updateSecondaryParam(name, value) {
    setSecondaryParams((prev) => ({
      ...prev,
      [`${selectedSecondaryModelId}_${name}`]: parseFloat(value) || 0,
    }));
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

  const currentFitKey = `${primaryModelId}:${targetKey}`;
  const activeFit = fittedModels[currentFitKey] ?? null;
  const primaryModel = MODELS[primaryModelId];

  return (
    <div className="secondary-layout">
      <aside className="left-panel">
        <div className="panel">
          <h2 className="panel-title">Secondary Model</h2>
          <p className="hint">Temperature-driven secondary fitting built from primary-model results.</p>

          <div className="form-group">
            <label>Primary model</label>
            <select value={primaryModelId} onChange={(e) => {
              const nextModelId = e.target.value;
              const nextConfig = MODEL_SECONDARY_CONFIG[nextModelId];
              const firstTarget = Object.keys(nextConfig?.targets ?? {})[0] ?? '';
              setPrimaryModelId(nextModelId);
              setRequestedTargetKey(firstTarget);
              setRequestedSecondaryModelId(nextConfig?.targets?.[firstTarget]?.defaultSecondaryModelId ?? '');
              setManualParams(buildInitialManualParams(nextModelId));
              setFactorValues(createDefaultFactorState(nextConfig?.factorKeys ?? ['temp']));
            }}>
              {primaryModels.map((model) => (
                <option key={model.id} value={model.id}>{model.name}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Target parameter</label>
            <select value={targetKey} onChange={(e) => {
              const nextTargetKey = e.target.value;
              setRequestedTargetKey(nextTargetKey);
              setRequestedSecondaryModelId(config?.targets?.[nextTargetKey]?.defaultSecondaryModelId ?? '');
            }}>
              {targetEntries.map(([key, target]) => (
                <option key={key} value={key}>{target.label}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Secondary model</label>
            <select value={selectedSecondaryModelId} onChange={(e) => setRequestedSecondaryModelId(e.target.value)}>
              {secondaryModelOptions.map((model) => (
                <option key={model.id} value={model.id}>{model.name}</option>
              ))}
            </select>
          </div>

          <div className="model-description">{secondaryModel?.description}</div>
          <code className="model-formula">{secondaryModel?.formula}</code>

          <h3 style={{ marginTop: 12, marginBottom: 6, fontSize: 13 }}>Auto-collected secondary data</h3>
          <div className="table-scroll" style={{ maxHeight: 220 }}>
            <table className="result-table">
              <thead>
                <tr>
                  <th>Dataset</th>
                  <th>Temp</th>
                  <th>Value</th>
                  <th>Fitted y</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.datasetId}>
                    <td>{row.datasetName}</td>
                    <td>{row.x.toFixed(2)}</td>
                    <td>{row.rawValue.toFixed(4)}</td>
                    <td>{row.y.toFixed(4)}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan="4">Need fitted datasets with temperature metadata.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <h3 style={{ marginTop: 12, marginBottom: 6, fontSize: 13 }}>Initial parameters</h3>
          {secondaryModel?.params.map((param) => (
            <div key={param.name} className="param-row">
              <label>{param.label}</label>
              <input
                type="number"
                step="any"
                min={param.min}
                max={param.max}
                value={currentSecondaryParams[param.name]}
                onChange={(e) => updateSecondaryParam(param.name, e.target.value)}
              />
            </div>
          ))}

          <button className="btn-primary" onClick={fitCurrentSecondaryModel} disabled={rows.length < 2}>
            Fit secondary model
          </button>
        </div>

        <div className="panel">
          <h2 className="panel-title">Predictor</h2>
          <p className="hint">Factor controls are rendered from configuration.</p>

          {factorDefs.map((factor) => (
            <div key={factor.key} className="form-group">
              <label>{factor.label} ({factor.unit})</label>
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

          <h3 style={{ marginTop: 12, marginBottom: 6, fontSize: 13 }}>Parameter routing</h3>
          {primaryModel?.params.map((param) => {
            const candidateFits = fittedKeys.filter((fitKey) => {
              const fit = fittedModels[fitKey];
              if (!fit || fit.primaryModelId !== primaryModelId) return false;
              const target = MODEL_SECONDARY_CONFIG[primaryModelId]?.targets?.[fit.targetKey];
              return (target?.mapsToParam ?? fit.targetKey) === param.name;
            });

            return (
              <div key={param.name} className="form-group">
                <label>{param.label}</label>
                <select
                  value={bindings[param.name] ?? ''}
                  onChange={(e) => updateBinding(param.name, e.target.value)}
                >
                  <option value="">Manual input</option>
                  {candidateFits.map((fitKey) => {
                    const fit = fittedModels[fitKey];
                    return (
                      <option key={fitKey} value={fitKey}>
                        {SECONDARY_MODELS[fit.secondaryModelId]?.name} → {MODEL_SECONDARY_CONFIG[primaryModelId]?.targets?.[fit.targetKey]?.label}
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
            <div className="panel">
              <h2 className="panel-title">Secondary Fit</h2>
              <ResponsiveContainer width="100%" height={320}>
                <ComposedChart margin={{ top: 10, right: 24, bottom: 12, left: 6 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke="#d9e2f2" vertical={false} />
                  <XAxis
                    dataKey="x"
                    type="number"
                    domain={['auto', 'auto']}
                    label={{ value: secondaryModel?.xLabel, position: 'insideBottom', offset: -4, style: { fontSize: 13, fill: '#334155' } }}
                    tick={{ fontSize: 12, fill: '#475569' }}
                    axisLine={{ stroke: '#64748b' }}
                    tickLine={{ stroke: '#64748b' }}
                  />
                  <YAxis
                    width={80}
                    minTickGap={24}
                    tickFormatter={formatAxisTick}
                    label={{ value: secondaryModel?.yLabel, angle: -90, position: 'insideLeft', style: { fontSize: 13, fill: '#334155' } }}
                    tick={{ fontSize: 12, fill: '#475569' }}
                    axisLine={{ stroke: '#64748b' }}
                    tickLine={{ stroke: '#64748b' }}
                  />
                  <Tooltip formatter={(v) => formatMetric(Number(v))} />
                  <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                  <Scatter data={activeFit.rows} dataKey="y" name="Observed" fill="#1f3b73" />
                  <Line data={activeFit.curve} dataKey="y" name="Fitted curve" stroke="#9a3412" strokeWidth={2.4} dot={false} type="monotone" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="panel">
              <h2 className="panel-title">Secondary Fit Statistics</h2>
              <div className="stats-toolbar">
                <button className="btn-secondary" onClick={() => setShowResidualPlot((prev) => !prev)}>
                  显示残差图
                </button>
                <span className="residual-meta">
                  Shapiro-Wilk p: {formatPValue(activeFit.normalityPValue)}
                </span>
              </div>
              {Number.isFinite(activeFit.normalityPValue) && activeFit.normalityPValue < 0.05 && (
                <div className="normality-warning">{NORMALITY_WARNING}</div>
              )}
              {showResidualPlot && (
                <ResidualPlot
                  residuals={activeFit.residuals}
                  title={`${SECONDARY_MODELS[activeFit.secondaryModelId]?.name} 残差图`}
                />
              )}
              <table className="result-table">
                <tbody>
                  <tr><th>Primary model</th><td>{MODELS[activeFit.primaryModelId]?.name}</td></tr>
                  <tr><th>Target</th><td>{MODEL_SECONDARY_CONFIG[activeFit.primaryModelId]?.targets?.[activeFit.targetKey]?.label}</td></tr>
                  <tr><th>Secondary model</th><td>{SECONDARY_MODELS[activeFit.secondaryModelId]?.name}</td></tr>
                  <tr><th>R²</th><td>{formatMetric(activeFit.r2)}</td></tr>
                  <tr><th>Adj. R²</th><td>{formatMetric(activeFit.r2adj)}</td></tr>
                  <tr><th>RMSE</th><td>{formatMetric(activeFit.rmse)}</td></tr>
                  <tr><th>AICc</th><td>{formatMetric(activeFit.aicc)}</td></tr>
                  {secondaryModel?.params.map((param) => (
                    <tr key={param.name}>
                      <th>{param.label}</th>
                      <td>{formatParameterValue(activeFit.params[param.name])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="panel chart-placeholder">
            <p>Select a registered target and fit a secondary model.</p>
            <p className="hint">The page auto-loads temperature/value pairs from primary fit results.</p>
          </div>
        )}

        <div className="panel">
          <h2 className="panel-title">Predicted Primary Curve</h2>
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={predictionCurve} margin={{ top: 10, right: 24, bottom: 12, left: 6 }}>
              <CartesianGrid strokeDasharray="2 4" stroke="#d9e2f2" vertical={false} />
              <XAxis
                dataKey="t"
                type="number"
                domain={[0, 'auto']}
                label={{ value: 'Time (min)', position: 'insideBottom', offset: -4, style: { fontSize: 13, fill: '#334155' } }}
                tick={{ fontSize: 12, fill: '#475569' }}
                axisLine={{ stroke: '#64748b' }}
                tickLine={{ stroke: '#64748b' }}
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
              <Tooltip formatter={(v) => formatMetric(Number(v))} />
              <Line dataKey="logN" name="Predicted curve" stroke="#166534" strokeWidth={2.4} dot={false} type="monotone" />
            </ComposedChart>
          </ResponsiveContainer>

          <table className="result-table">
            <tbody>
              <tr><th>Primary model</th><td>{primaryModel?.name}</td></tr>
              {factorDefs.map((factor) => (
                <tr key={factor.key}>
                  <th>{factor.label}</th>
                  <td>{Number(factorValues[factor.key]).toFixed(2)} {factor.unit}</td>
                </tr>
              ))}
              {primaryModel?.params.map((param) => (
                <tr key={param.name}>
                  <th>{param.label}</th>
                  <td>{predictedParams?.[param.name]?.toFixed?.(4) ?? 'NA'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
