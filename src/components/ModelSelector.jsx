import { getModelList, MODELS } from '../models/inactivationModels';
import { FormattedLabel } from '../utils/formatLabels.jsx';

const ALL_MODELS = getModelList();

function stripModelName(name) {
  return (name ?? '').replace(/\s*\(.*\)\s*$/, '').trim();
}

export default function ModelSelector({
  selectedModels, setSelectedModels,
  activeDataset, fitResults, datasets,
  hoveredModel, setHoveredModel,
  isFitting,
}) {
  // Collect model IDs that have at least one valid fit result across all datasets
  const fittedModelIds = ALL_MODELS
    .map((m) => m.id)
    .filter((modelId) =>
      datasets.some((ds) => {
        const res = fitResults[`${ds.id}_${modelId}`];
        return res && !res.failed && res.params;
      })
    );

  function toggleModel(id) {
    setSelectedModels((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  }

  function toggleAll() {
    if (selectedModels.length === fittedModelIds.length) {
      setSelectedModels([]);
    } else {
      setSelectedModels(fittedModelIds);
    }
  }

  const allChecked = fittedModelIds.length > 0 && fittedModelIds.every((id) => selectedModels.includes(id));

  return (
    <div className="panel">
      <div className="mvp-header">
        <h2 className="panel-title" style={{ marginBottom: 0, paddingBottom: 0, borderBottom: 'none' }}>
          Model Selection
        </h2>
        {fittedModelIds.length > 0 && (
          <button className="btn-secondary mvp-toggle-all" onClick={toggleAll}>
            {allChecked ? 'Hide all' : 'Show all'}
          </button>
        )}
      </div>
      <p className="hint" style={{ marginBottom: 8, marginTop: 6 }}>
        Check to show curve on chart · Hover to highlight
      </p>

      {isFitting && fittedModelIds.length === 0 && (
        <p className="hint">Fitting all models…</p>
      )}

      {!isFitting && fittedModelIds.length === 0 && (
        <p className="hint warn">Load an experimental dataset first.</p>
      )}

      <ul className="mvp-list">
        {fittedModelIds.map((modelId) => {
          const model = MODELS[modelId];
          const checked = selectedModels.includes(modelId);
          const hovered = hoveredModel === modelId;

          const aicc = activeDataset
            ? fitResults[`${activeDataset.id}_${modelId}`]?.aicc
            : null;
          const aiccStr = Number.isFinite(aicc) ? aicc.toFixed(1) : null;

          return (
            <li
              key={modelId}
              className={`mvp-item${hovered ? ' mvp-hovered' : ''}${!checked ? ' mvp-hidden' : ''}`}
              onMouseEnter={() => setHoveredModel(modelId)}
              onMouseLeave={() => setHoveredModel(null)}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleModel(modelId)}
                className="mvp-checkbox"
              />
              <span className="mvp-name">{stripModelName(model?.name ?? modelId)}</span>
              {aiccStr && (
                <span className="mvp-aicc"><FormattedLabel text="AICc" /> {aiccStr}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
