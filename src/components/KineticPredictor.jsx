import { useState, useMemo, useCallback, useEffect } from 'react';
import { MODELS, solveForTime } from '../models/inactivationModels';
import { formatTime } from '../models/fitter';
import { useScenario } from '../ScenarioContext';

export default function KineticPredictor({ datasets, selectedModels, fitResults, onPrediction }) {
  const { primaryAxisLabel } = useScenario();
  const [selectedKey, setSelectedKey] = useState('');
  const [timeStr, setTimeStr] = useState('');
  const [logNStr, setLogNStr] = useState('');

  // Build list of valid fitted model-dataset combinations
  const options = useMemo(() => {
    const list = [];
    datasets.forEach((ds) => {
      if (ds.showOnChart === false || !ds.data?.length) return;
      selectedModels.forEach((modelId) => {
        const key = `${ds.id}_${modelId}`;
        const r = fitResults[key];
        if (r && !r.failed && r.params) {
          const model = MODELS[modelId];
          list.push({
            key,
            label: `${ds.name} — ${model?.name ?? modelId}`,
            modelId,
            params: r.params,
            tMax: Math.max(...ds.data.map((d) => d.t)) * 2,
          });
        }
      });
    });
    return list;
  }, [datasets, selectedModels, fitResults]);

  // Auto-select first option when current selection is invalid
  const active = options.find((o) => o.key === selectedKey) ?? options[0] ?? null;

  const activeSignature = JSON.stringify({ key: active?.key, params: active?.params, axis: primaryAxisLabel });
  useEffect(() => {
    // Invalidate both editor values and the external chart marker together.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTimeStr('');
    setLogNStr('');
    onPrediction(null);
  }, [activeSignature, onPrediction]);

  const updatePrediction = useCallback(
    (t, logN) => {
      if (Number.isFinite(t) && Number.isFinite(logN)) {
        onPrediction({ t, logN });
      } else {
        onPrediction(null);
      }
    },
    [onPrediction],
  );

  const handleSelectChange = (e) => {
    const key = e.target.value;
    setSelectedKey(key);
    setTimeStr('');
    setLogNStr('');
    onPrediction(null);
  };

  const handleTimeChange = (e) => {
    const raw = e.target.value;
    setTimeStr(raw);
    if (!active) return;
    const t = parseFloat(raw);
    if (!Number.isFinite(t) || t < 0) {
      setLogNStr('');
      onPrediction(null);
      return;
    }
    const model = MODELS[active.modelId];
    if (!model) return;
    const logN = model.fn(t, active.params);
    if (Number.isFinite(logN)) {
      setLogNStr(logN.toFixed(2));
      updatePrediction(t, logN);
    } else {
      setLogNStr('');
      onPrediction(null);
    }
  };

  const handleLogNChange = (e) => {
    const raw = e.target.value;
    setLogNStr(raw);
    if (!active) return;
    const targetLogN = parseFloat(raw);
    if (!Number.isFinite(targetLogN)) {
      setTimeStr('');
      onPrediction(null);
      return;
    }
    const t = solveForTime(active.modelId, targetLogN, active.params, active.tMax);
    if (t !== null && Number.isFinite(t)) {
      setTimeStr(formatTime(t));
      updatePrediction(t, targetLogN);
    } else {
      setTimeStr('—');
      onPrediction(null);
    }
  };

  if (options.length === 0) return null;

  return (
    <div className="panel kinetic-predictor">
      <h2 className="panel-title">Kinetic Predictor</h2>
      <div className="predictor-row">
        <label className="predictor-field">
          <span className="predictor-label">Model</span>
          <select
            className="predictor-select"
            value={active?.key ?? ''}
            onChange={handleSelectChange}
          >
            {options.map((o) => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="predictor-row">
        <label className="predictor-field">
          <span className="predictor-label">{primaryAxisLabel}</span>
          <input
            type="number"
            className="predictor-input"
            value={timeStr}
            onChange={handleTimeChange}
            placeholder="Enter x value"
            min="0"
            step="any"
          />
        </label>
        <label className="predictor-field">
          <span className="predictor-label">Survival</span>
          <input
            type="number"
            className="predictor-input"
            value={logNStr}
            onChange={handleLogNChange}
            placeholder="Enter Survival"
            step="any"
          />
        </label>
      </div>
    </div>
  );
}
