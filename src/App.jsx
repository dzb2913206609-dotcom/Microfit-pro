import { useState, useEffect, useRef } from 'react';
import DataInput from './components/DataInput';
import ModelSelector from './components/ModelSelector';
import ResultChart from './components/ResultChart';
import ResultTable from './components/ResultTable';
import SecondaryModel from './components/SecondaryModel';
import { getModelList, predictCurve } from './models/inactivationModels';
import { fitModel } from './models/fitter';
import './App.css';

const ALL_MODEL_IDS = getModelList().map((m) => m.id);

export default function App() {
  const [datasets, setDatasets] = useState([]);
  const [activeDatasetId, setActiveDatasetId] = useState(null);
  const [selectedModels, setSelectedModels] = useState([]);
  const [fitResults, setFitResults] = useState({});
  const [tab, setTab] = useState('primary');
  const [isFitting, setIsFitting] = useState(false);
  const [hoveredModel, setHoveredModel] = useState(null);

  const activeDataset = datasets.find((d) => d.id === activeDatasetId);

  // Auto-fit all models silently whenever the active dataset changes
  const lastFittedDatasetId = useRef(null);
  useEffect(() => {
    if (!activeDataset || activeDataset.data.length < 3) return;
    if (lastFittedDatasetId.current === activeDataset.id) return;
    lastFittedDatasetId.current = activeDataset.id;

    setIsFitting(true);
    setTimeout(() => {
      const newResults = { ...fitResults };
      const tMax = Math.max(...activeDataset.data.map((d) => d.t)) * 1.1;

      ALL_MODEL_IDS.forEach((modelId) => {
        const result = fitModel(modelId, activeDataset.data, null);
        // Filter out degenerate fits where R² ≥ 0.9999 (effectively R²=1)
        if (result && result.r2 < 0.9999) {
          result.curve = predictCurve(modelId, result.params, tMax);
          result.modelId = modelId;
          result.datasetId = activeDataset.id;
          newResults[`${activeDataset.id}_${modelId}`] = result;
        }
      });

      setFitResults(newResults);
      setIsFitting(false);
    }, 20);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDataset?.id]);

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-content">
          <h1>MicroFit Pro</h1>
          <p className="subtitle">Microbial inactivation model fitting and comparison platform</p>
        </div>
        <nav className="tab-nav">
          <button className={tab === 'primary' ? 'active' : ''} onClick={() => setTab('primary')}>
            Primary models
          </button>
          <button className={tab === 'secondary' ? 'active' : ''} onClick={() => setTab('secondary')}>
            Secondary models
          </button>
        </nav>
      </header>

      <main className="app-body">
        {tab === 'primary' && (
          <div className="primary-layout">
            <aside className="left-panel">
              <DataInput
                datasets={datasets}
                setDatasets={setDatasets}
                activeDatasetId={activeDatasetId}
                setActiveDatasetId={setActiveDatasetId}
              />
              <ModelSelector
                selectedModels={selectedModels}
                setSelectedModels={setSelectedModels}
                activeDataset={activeDataset}
                fitResults={fitResults}
                datasets={datasets}
                hoveredModel={hoveredModel}
                setHoveredModel={setHoveredModel}
                isFitting={isFitting}
              />
            </aside>
            <section className="right-panel">
              <ResultChart
                datasets={datasets}
                selectedModels={selectedModels}
                fitResults={fitResults}
                hoveredModel={hoveredModel}
                setHoveredModel={setHoveredModel}
              />
              <ResultTable
                datasets={datasets}
                activeDatasetId={activeDatasetId}
                selectedModels={selectedModels}
                fitResults={fitResults}
              />
            </section>
          </div>
        )}
        {tab === 'secondary' && (
          <SecondaryModel datasets={datasets} fitResults={fitResults} />
        )}
      </main>
    </div>
  );
}
