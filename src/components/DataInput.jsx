import { useRef, useState } from 'react';
import { FACTOR_DEFS } from '../models/secondaryModels';

const COLORS = ['#1f3b73', '#9a3412', '#166534', '#7c3aed', '#0f766e', '#b45309'];

function summarizeReplicates(rows) {
  const grouped = new Map();

  rows.forEach(({ t, logN }) => {
    if (!grouped.has(t)) grouped.set(t, []);
    grouped.get(t).push(logN);
  });

  return [...grouped.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, values]) => {
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      const variance = values.length > 1
        ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)
        : 0;

      return {
        t,
        logN: mean,
        mean,
        sd: Math.sqrt(Math.max(variance, 0)),
        replicates: values.length,
        rawValues: values,
      };
    });
}

export default function DataInput({ datasets, setDatasets, activeDatasetId, setActiveDatasetId }) {
  const [pasteText, setPasteText] = useState('');
  const [newName, setNewName] = useState('Dataset 1');
  const [newConditions, setNewConditions] = useState(() =>
    FACTOR_DEFS.reduce((acc, factor) => {
      acc[factor.key] = factor.defaultValue;
      return acc;
    }, {}),
  );
  const [error, setError] = useState('');
  const fileRef = useRef();

  function parseText(text) {
    const lines = text.trim().split(/\n/).filter(Boolean);
    const points = [];

    for (const line of lines) {
      const parts = line.trim().split(/[\t,;]+|\s{2,}/).map((part) => part.trim()).filter(Boolean);
      if (parts.length < 2) continue;

      const t = parseFloat(parts[0]);
      if (Number.isNaN(t)) continue;

      for (let i = 1; i < parts.length; i++) {
        const logN = parseFloat(parts[i]);
        if (!Number.isNaN(logN)) points.push({ t, logN });
      }
    }

    return summarizeReplicates(points);
  }

  function addDataset(data, name) {
    if (data.length < 3) {
      setError('At least 3 time points are required.');
      return;
    }

    const dsCount = datasets.length;
    const id = Date.now().toString();
    const color = COLORS[dsCount % COLORS.length];
    const conditions = FACTOR_DEFS.reduce((acc, factor) => {
      const value = parseFloat(newConditions[factor.key]);
      acc[factor.key] = Number.isFinite(value) ? value : factor.defaultValue;
      return acc;
    }, {});
    const ds = {
      id,
      name: name || `Dataset ${dsCount + 1}`,
      data,
      color,
      shapeIdx: dsCount,
      showOnChart: true,
      conditions,
    };
    setDatasets((prev) => [...prev, ds]);
    setActiveDatasetId(id);
    setPasteText('');
    setError('');
    setNewName(`Dataset ${datasets.length + 2}`);
  }

  function handlePaste() {
    const data = parseText(pasteText);
    addDataset(data, newName);
  }

  function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const data = parseText(ev.target.result);
      addDataset(data, file.name.replace(/\.[^.]+$/, ''));
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function removeDataset(id) {
    setDatasets((prev) => prev.filter((d) => d.id !== id));
    if (activeDatasetId === id) {
      setActiveDatasetId(datasets.find((d) => d.id !== id)?.id || null);
    }
  }

  return (
    <div className="panel">
      <h2 className="panel-title">Data Input</h2>

      <div className="form-group">
        <label>Dataset name</label>
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Dataset name"
        />
      </div>

      <div className="form-group">
        <label>Dataset conditions</label>
        <div style={{ display: 'grid', gap: 8 }}>
          {FACTOR_DEFS.map((factor) => (
            <div key={factor.key} className="param-row">
              <label>{factor.label} ({factor.unit})</label>
              <input
                type="number"
                step={factor.step}
                min={factor.min}
                max={factor.max}
                value={newConditions[factor.key] ?? factor.defaultValue}
                onChange={(e) => {
                  const value = e.target.value;
                  setNewConditions((prev) => ({ ...prev, [factor.key]: value }));
                }}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="form-group">
        <label>Paste data (time in the first column, replicate values in the remaining columns)</label>
        <textarea
          rows={7}
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          placeholder={'time\trep1\trep2\trep3\n10\t4.92\t4.76\t4.98\n20\t4.40\t4.37\t3.96\n30\t3.63\t3.92\t3.71'}
        />
        <p className="hint">Each row can contain one time point with multiple replicate measurements. The app will calculate mean and SD automatically.</p>
        {error && <div className="error">{error}</div>}
        <button onClick={handlePaste} disabled={!pasteText.trim()} className="btn-primary">
          Add dataset
        </button>
      </div>

      <div className="form-group">
        <label>Or upload a CSV / TXT file</label>
        <input type="file" accept=".csv,.txt,.tsv" ref={fileRef} onChange={handleFile} />
      </div>

      {datasets.length > 0 && (
        <div className="dataset-list">
          <h3>Loaded datasets</h3>
          {datasets.map((ds) => {
            const totalReplicates = ds.data.reduce((sum, point) => sum + point.replicates, 0);
            return (
              <div
                key={ds.id}
                className={`dataset-item ${ds.id === activeDatasetId ? 'active' : ''}`}
                onClick={() => setActiveDatasetId(ds.id)}
              >
                <input
                  type="checkbox"
                  title="Show on chart"
                  checked={ds.showOnChart !== false}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    setDatasets((prev) => prev.map((d) => d.id === ds.id ? { ...d, showOnChart: e.target.checked } : d));
                  }}
                />
                <span className="ds-dot" style={{ background: ds.color }} />
                <input
                  type="text"
                  className="ds-name-input"
                  value={ds.name}
                  title="Click to rename (updates chart legend)"
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    const newName = e.target.value;
                    setDatasets((prev) => prev.map((d) => d.id === ds.id ? { ...d, name: newName } : d));
                  }}
                />
                <span className="ds-count">({ds.data.length} time points, {totalReplicates} values)</span>
                {FACTOR_DEFS.map((factor) => (
                  <input
                    key={factor.key}
                    type="number"
                    className="ds-name-input"
                    style={{ maxWidth: 92 }}
                    title={`${factor.label} (${factor.unit})`}
                    value={ds.conditions?.[factor.key] ?? factor.defaultValue}
                    min={factor.min}
                    max={factor.max}
                    step={factor.step}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      const value = parseFloat(e.target.value);
                      setDatasets((prev) => prev.map((d) => d.id === ds.id
                        ? {
                          ...d,
                          conditions: {
                            ...(d.conditions ?? {}),
                            [factor.key]: Number.isFinite(value) ? value : factor.defaultValue,
                          },
                        }
                        : d));
                    }}
                  />
                ))}
                <button
                  className="ds-remove"
                  onClick={(e) => { e.stopPropagation(); removeDataset(ds.id); }}
                >×</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
