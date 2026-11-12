import { useCallback, useState, useEffect, useMemo } from 'react';
import DataInput from './components/DataInput';
import ModelSelector from './components/ModelSelector';
import ResultChart from './components/ResultChart';
import ResultTable from './components/ResultTable';
import SecondaryModel from './components/SecondaryModel';
import KineticPredictor from './components/KineticPredictor';
import DynamicSimulator from './components/DynamicSimulator';
import { getModelList, predictCurve, MODELS } from './models/inactivationModels';
import { fitPrimaryInTimeUnit } from './utils/unitFitting.js';
import { runAllSecondaryFits } from './models/secondaryModels';
import { ScenarioProvider, useScenario, SCENARIO_CONFIG } from './ScenarioContext';
import { getModeById, getModeList } from './config/sterilizationModes';
import { createDefaultStateForMode } from './config/stateFactory';
import { Flame, Gauge, Sun, Zap, FlaskConical, Atom, SlidersHorizontal, HelpCircle } from 'lucide-react';
import { registerCustomFactor, clearCustomFactors } from './config/factors';
import { updateCustomModeFactors } from './config/sterilizationModes';
import { EXAMPLE_CASES, getExampleCase } from './config/exampleDatasets';
import UserGuide from './components/UserGuide';
import './App.css';
import { fittingInputSignature, scheduleFit } from './utils/fittingState.js';
import { convertSecondaryAxisState } from './utils/axisState.js';

const ALL_MODEL_IDS = getModelList().map((m) => m.id);

const MODE_ICONS = { Flame, Gauge, Sun, Zap, FlaskConical, Atom, SlidersHorizontal };

function AppContent() {
  const { scenario, setScenario, setUseDoseAxis, setTimeUnit, refreshCustomConfig, useDoseAxis, timeUnit, primaryAxisLabel, timeUnitToMin } = useScenario();
  const [datasets, setDatasets] = useState([]);
  const [activeDatasetId, setActiveDatasetId] = useState(null);
  const [selectedModels, setSelectedModels] = useState([]);
  const [fitResults, setFitResults] = useState({});
  const [staleConditionDatasetId, setStaleConditionDatasetId] = useState(null);
  const [tab, setTab] = useState('primary');
  const [isFitting, setIsFitting] = useState(false);
  const [hoveredModel, setHoveredModel] = useState(null);
  const [prediction, setPrediction] = useState(null);
  const [computedSecondaryModels, setFittedSecondaryModels] = useState({});
  const [literatureSecondaryModels, setLiteratureSecondaryModels] = useState({});
  const fittedSecondaryModels = useMemo(() => ({ ...literatureSecondaryModels, ...computedSecondaryModels }), [literatureSecondaryModels, computedSecondaryModels]);
  const [secondaryInputState, setSecondaryInputState] = useState(null);
  const [secondaryInputGeneration, setSecondaryInputGeneration] = useState(0);
  const handleSecondaryStateChange = useCallback((nextState) => {
    setSecondaryInputState(previous => JSON.stringify(previous) === JSON.stringify(nextState) ? previous : nextState);
  }, []);
  const handleDatasetsChange = useCallback((next) => {
    setLiteratureSecondaryModels({});
    setDatasets(next);
  }, []);
  const [, setLastViewedSecondaryModel] = useState(null);
  const [exampleDefaults, setExampleDefaults] = useState(null);
  const [dynamicDefaults, setDynamicDefaults] = useState(null);
  const [primaryFitDisplay, setPrimaryFitDisplay] = useState('selected');
  const [activeExample, setActiveExample] = useState(null);
  const [showGuide, setShowGuide] = useState(false);

  // Custom mode: factor configurator state
  const [customFactorsConfigured, setCustomFactorsConfigured] = useState(false);
  const [customPrimaryAxis, setCustomPrimaryAxis] = useState({
    key: 'custom_f1',
    label: 'Time / Dose',
    shortLabel: 'x',
    unit: '',
    min: 0,
    max: 100,
    step: 1,
    defaultValue: 0,
  });
  const [customFactorDefs, setCustomFactorDefs] = useState([
    { key: 'custom_f2', label: 'Factor 1', shortLabel: 'F1', unit: '', min: 0, max: 100, step: 1, defaultValue: 50 },
  ]);

  const handleSecondaryFitUpdate = useCallback((nextFits, primaryModelId) => {
    setFittedSecondaryModels((prev) => {
      const next = Object.fromEntries(Object.entries(prev).filter(([, fit]) => fit.primaryModelId !== primaryModelId));
      Object.assign(next, Object.fromEntries(Object.entries(nextFits ?? {}).filter(([, fit]) => fit.source !== 'literature')));
      return Object.keys(next).length === Object.keys(prev).length && Object.keys(next).every(key => next[key] === prev[key]) ? prev : next;
    });
  }, []);

  function handleAxisChange(nextAxis) {
    if (Object.keys(literatureSecondaryModels).length) {
      throw new Error('The loaded literature parameters use their original axis units. Replace this example or switch modes before changing the axis.');
    }
    const converted = convertSecondaryAxisState(getModeById(scenario), secondaryInputState,
      { useDoseAxis, timeUnit }, nextAxis, MODELS);
    setSecondaryInputState(converted);
    setFittedSecondaryModels({});
    setUseDoseAxis(nextAxis.useDoseAxis);
    setTimeUnit(nextAxis.timeUnit);
  }

  function addCustomFactor() {
    if (customFactorDefs.length >= 3) return;
    const idx = customFactorDefs.length + 1;
    setCustomFactorDefs((prev) => [
      ...prev,
      { key: `custom_f${idx + 1}`, label: `Factor ${idx}`, shortLabel: `F${idx}`, unit: '', min: 0, max: 100, step: 1, defaultValue: 50 },
    ]);
  }

  function removeCustomFactor(idx) {
    if (customFactorDefs.length <= 1) return;
    setCustomFactorDefs((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateCustomFactorDef(idx, field, value) {
    setCustomFactorDefs((prev) => prev.map((f, i) => i === idx ? { ...f, [field]: value } : f));
  }

  function updateCustomPrimaryAxis(field, value) {
    setCustomPrimaryAxis((prev) => ({ ...prev, [field]: value }));
  }

  function applyCustomFactors() {
    const readNumber = (value, fallback) => {
      const parsed = parseFloat(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    };
    const normalizeFactor = (factor, index, isPrimary = false) => {
      const min = readNumber(factor.min, 0);
      const max = readNumber(factor.max, 100);
      const step = readNumber(factor.step, 1);
      const defaultValue = readNumber(factor.defaultValue, isPrimary ? min : (min + max) / 2);
      const key = `custom_f${index + 1}`;
      const fallbackLabel = isPrimary ? 'Time / Dose' : `Factor ${index}`;
      const fallbackShortLabel = isPrimary ? 'x' : `F${index}`;
      return {
        key,
        label: factor.label || fallbackLabel,
        shortLabel: factor.shortLabel || factor.label || fallbackShortLabel,
        unit: factor.unit || '',
        min,
        max,
        step,
        defaultValue,
      };
    };

    clearCustomFactors();
    const primaryAxis = normalizeFactor(customPrimaryAxis, 0, true);
    const conditionFactors = customFactorDefs.map((factor, idx) => normalizeFactor(factor, idx + 1));
    const registeredFactors = [primaryAxis, ...conditionFactors];
    registeredFactors.forEach(registerCustomFactor);
    const keys = registeredFactors.map((factor) => factor.key);
    updateCustomModeFactors(keys);
    refreshCustomConfig();

    // Reset state for the custom mode
    const newMode = getModeById('custom');
    const defaults = createDefaultStateForMode(newMode);
    setDatasets(defaults.datasets);
    setActiveDatasetId(defaults.activeDatasetId);
    setSelectedModels(defaults.selectedModels);
    setFitResults(defaults.fitResults);
    setFittedSecondaryModels(defaults.fittedSecondaryModels);
    setLiteratureSecondaryModels({});
    setSecondaryInputState(null);
    setSecondaryInputGeneration(generation => generation + 1);
    setIsFitting(defaults.isFitting);
    setStaleConditionDatasetId(null);
    setPrediction(null);
    setLastViewedSecondaryModel(null);
    setExampleDefaults(null);
    setDynamicDefaults(null);
    setPrimaryFitDisplay('selected');
    setActiveExample(null);
    setUseDoseAxis(false);
    setTimeUnit('min');
    setTab('primary');
    setCustomFactorsConfigured(true);
  }

  const activeDataset = datasets.find((d) => d.id === activeDatasetId);
  const isPrimaryOnlyExample = Boolean(
    activeExample && activeExample.secondaryDefaults == null && activeExample.dynamicDefaults == null,
  );

  // Auto-fit all primary models for every dataset whenever data or conditions change.
  const fitKey = fittingInputSignature({ datasets, scenario, useDoseAxis, timeUnit, primaryAxisLabel });
  useEffect(() => {
    const fitDatasets = datasets.filter((dataset) => dataset.data?.length >= 3);
    setFitResults({});
    setFittedSecondaryModels({});
    setPrediction(null);
    if (fitDatasets.length === 0) { setIsFitting(false); return; }
    setIsFitting(true);
    return scheduleFit(() => {
      const newResults = {};

      fitDatasets.forEach((dataset) => {
        const tMax = Math.max(...dataset.data.map((d) => d.t)) * 1.1;
        ALL_MODEL_IDS.forEach((modelId) => {
          const result = fitPrimaryInTimeUnit(modelId, dataset.data, { timeUnitToMin: useDoseAxis || scenario === 'custom' ? 1 : timeUnitToMin });
          if (result) {
            result.curve = predictCurve(modelId, result.params, tMax);
            result.modelId = modelId;
            result.datasetId = dataset.id;
            newResults[`${dataset.id}_${modelId}`] = result;
          }
        });
      });

      setFitResults(newResults);
      setStaleConditionDatasetId(null);
      setIsFitting(false);
    }, 20);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  // Auto-fit all secondary models in background once primary fits exist
  const secondaryFitKey = fittingInputSignature({ datasets, fitResults, scenario, useDoseAxis, timeUnit, primaryAxisLabel, primaryFactorKey: SCENARIO_CONFIG[scenario].primaryFactorKey, referenceParams: exampleDefaults?.referenceParams ?? null });
  useEffect(() => {
    setFittedSecondaryModels({});
    if (datasets.length < 2 || Object.keys(fitResults).length === 0) return;
    return scheduleFit(() => {
      const results = runAllSecondaryFits({
        datasets,
        fitResults,
        scenario,
        primaryFactorKey: SCENARIO_CONFIG[scenario].primaryFactorKey,
        referenceParams: exampleDefaults?.referenceParams ?? null,
      });
      setFittedSecondaryModels(results);
    }, 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondaryFitKey]);

  function handleScenarioChange(newScenario) {
    if (newScenario === scenario) return;
    if (datasets.length > 0) {
      const confirmed = window.confirm(
        'Switching modes will clear all datasets, fits, and simulation state. Continue?',
      );
      if (!confirmed) return;
    }

    setLiteratureSecondaryModels({});
    setSecondaryInputState(null);
    setSecondaryInputGeneration(generation => generation + 1);

    // For custom mode, show configurator instead of resetting immediately
    if (newScenario === 'custom') {
      setCustomFactorsConfigured(false);
      setDatasets([]);
      setActiveDatasetId(null);
      setSelectedModels([]);
      setFitResults({});
      setFittedSecondaryModels({});
      setIsFitting(false);
      setStaleConditionDatasetId(null);
      setPrediction(null);
      setLastViewedSecondaryModel(null);
      setExampleDefaults(null);
      setDynamicDefaults(null);
      setPrimaryFitDisplay('selected');
      setActiveExample(null);
      setUseDoseAxis(false);
      setTimeUnit('min');
          setTab('primary');
      setScenario(newScenario);
      return;
    }

    // Full state reset via stateFactory — prevents state bleed between modes
    setCustomFactorsConfigured(false);
    const newMode = getModeById(newScenario);
    const defaults = createDefaultStateForMode(newMode);
    setDatasets(defaults.datasets);
    setActiveDatasetId(defaults.activeDatasetId);
    setSelectedModels(defaults.selectedModels);
    setFitResults(defaults.fitResults);
    setFittedSecondaryModels(defaults.fittedSecondaryModels);
    setLiteratureSecondaryModels({});
    setSecondaryInputState(null);
    setSecondaryInputGeneration(generation => generation + 1);
    setIsFitting(defaults.isFitting);
    setStaleConditionDatasetId(null);
    setPrediction(null);
    setLastViewedSecondaryModel(null);
    setExampleDefaults(null);
    setDynamicDefaults(null);
    setPrimaryFitDisplay('selected');
    setActiveExample(null);
    setUseDoseAxis(false);
    setTimeUnit('min');
    setTab('primary');
    setScenario(newScenario);
  }

  function loadExampleCase(exampleId) {
    const example = getExampleCase(exampleId);
    if (!example) return;
    if (datasets.length > 0) {
      const confirmed = window.confirm('Loading an example will replace current datasets, fits, and simulations. Continue?');
      if (!confirmed) return;
    }
    clearCustomFactors();
    setCustomFactorsConfigured(false);
    setScenario(example.scenario);
    setUseDoseAxis(example.axisSettings?.useDoseAxis ?? false);
    setTimeUnit(example.axisSettings?.timeUnit ?? 'min');
    setDatasets(structuredClone(example.datasets));
    setActiveDatasetId(example.activeDatasetId ?? example.datasets[0]?.id ?? null);
    setSelectedModels(example.selectedModels ?? ALL_MODEL_IDS);
    setFitResults({});
    setFittedSecondaryModels({});
    setLiteratureSecondaryModels(Object.fromEntries(Object.entries(structuredClone(example.fittedSecondaryModels ?? {})).map(([key, fit]) => [key, { ...fit, source: 'literature' }])));
    setSecondaryInputState(null);
    setSecondaryInputGeneration(generation => generation + 1);
    setIsFitting(false);
    setStaleConditionDatasetId(null);
    setPrediction(null);
    setLastViewedSecondaryModel(null);
    setExampleDefaults(example.secondaryDefaults ? {
      id: example.id,
      loadedAt: Date.now(),
      ...structuredClone(example.secondaryDefaults),
    } : null);
    setDynamicDefaults(example.dynamicDefaults ? {
      id: example.id,
      loadedAt: Date.now(),
      ...structuredClone(example.dynamicDefaults),
    } : null);
    setPrimaryFitDisplay(example.primaryFitDisplay ?? 'selected');
    setActiveExample(example);
    setTab(example.initialTab ?? 'primary');
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-row header-top">
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
            <button className={tab === 'dynamic' ? 'active' : ''} onClick={() => setTab('dynamic')}>
              Dynamic simulation
            </button>
            <button className="guide-trigger" onClick={() => setShowGuide(true)} title="User Guide">
              <HelpCircle size={16} />
            </button>
          </nav>
        </div>
        <div className="header-row header-controls">
          <div className="scenario-switcher">
            {getModeList().map((m) => {
              const Icon = MODE_ICONS[m.icon];
              return (
                <button
                  key={m.id}
                  className={`scenario-btn ${scenario === m.id ? 'active' : ''}`}
                  onClick={() => handleScenarioChange(m.id)}
                >
                  {Icon && <Icon size={16} />}
                  {m.label}
                </button>
              );
            })}
          </div>
          <div className="example-loader">
            <select
              defaultValue=""
              onChange={(e) => {
                if (!e.target.value) return;
                loadExampleCase(e.target.value);
                e.target.value = '';
              }}
              title="Load reproducible paper example"
            >
              <option value="" disabled>Examples</option>
              {EXAMPLE_CASES.map((example) => (
                <option key={example.id} value={example.id}>{example.label}</option>
              ))}
            </select>
          </div>
        </div>
      </header>

      <main className="app-body">
        {activeExample && (
          <section className="sample-info sample-info-compact" aria-label="Loaded sample details">
            <div className="sample-info-main">
              <span className="sample-badge">{SCENARIO_CONFIG[activeExample.scenario]?.label ?? activeExample.scenario}</span>
              <div>
                <h2>{activeExample.label}</h2>
              </div>
            </div>
            <details className="sample-info-details">
              <summary>Details</summary>
              <p>{activeExample.description}</p>
              <dl className="sample-info-grid">
                <div><dt>Source</dt><dd>{activeExample.source ?? 'Not specified'}</dd></div>
                <div><dt>X-axis</dt><dd>{activeExample.xLabel ?? (activeExample.axisSettings?.useDoseAxis ? 'Dose/fluence' : `Time (${activeExample.axisSettings?.timeUnit ?? 'min'})`)}</dd></div>
                <div><dt>Default view</dt><dd>{activeExample.defaultView ?? 'Selected models are shown on the chart.'}</dd></div>
                <div><dt>Secondary model</dt><dd>{activeExample.secondarySupport ?? 'Use only when multiple environmental conditions are provided.'}</dd></div>
              </dl>
            </details>
          </section>
        )}

        {/* Custom mode: factor configurator */}
        {scenario === 'custom' && !customFactorsConfigured && (
          <div className="custom-configurator">
            <div className="panel" style={{ maxWidth: 760, margin: '0 auto' }}>
              <h2 className="panel-title">Custom Mode Setup</h2>
              <p className="hint" style={{ marginBottom: 12 }}>
                Set the first column used for primary fitting, then add fixed condition factors for secondary modeling.
              </p>
              <div className="custom-factor-row">
                <div className="custom-factor-header">
                  <strong>Primary x-axis</strong>
                  <span className="hint" style={{ margin: 0 }}>Required first column</span>
                </div>
                <div className="custom-factor-fields">
                  <div className="custom-factor-row-top">
                    <div className="param-row" style={{ flex: 2 }}>
                      <label>Name</label>
                      <input value={customPrimaryAxis.label} onChange={(e) => updateCustomPrimaryAxis('label', e.target.value)} placeholder="e.g. Time, Dose, F value, CT value" />
                    </div>
                    <div className="param-row" style={{ flex: 1 }}>
                      <label>Short label</label>
                      <input value={customPrimaryAxis.shortLabel} onChange={(e) => updateCustomPrimaryAxis('shortLabel', e.target.value)} placeholder="e.g. t, D, F, x" />
                    </div>
                    <div className="param-row" style={{ flex: 1 }}>
                      <label>Unit</label>
                      <input value={customPrimaryAxis.unit} onChange={(e) => updateCustomPrimaryAxis('unit', e.target.value)} placeholder="optional" />
                    </div>
                  </div>
                </div>
              </div>
              <h3 style={{ margin: '14px 0 8px', fontSize: 15 }}>Condition factors</h3>
              {customFactorDefs.map((f, idx) => (
                <div key={idx} className="custom-factor-row">
                  <div className="custom-factor-header">
                    <strong>Factor {idx + 1}</strong>
                    {customFactorDefs.length > 1 && (
                      <button className="btn-small btn-danger" onClick={() => removeCustomFactor(idx)}>Remove</button>
                    )}
                  </div>
                  <div className="custom-factor-fields">
                    <div className="custom-factor-row-top">
                      <div className="param-row" style={{ flex: 2 }}>
                        <label>Name</label>
                        <input value={f.label} onChange={(e) => updateCustomFactorDef(idx, 'label', e.target.value)} placeholder="e.g. Temperature" />
                      </div>
                      <div className="param-row" style={{ flex: 1 }}>
                        <label>Short label</label>
                        <input value={f.shortLabel} onChange={(e) => updateCustomFactorDef(idx, 'shortLabel', e.target.value)} placeholder="e.g. T" />
                      </div>
                      <div className="param-row" style={{ flex: 1 }}>
                        <label>Unit</label>
                        <input value={f.unit} onChange={(e) => updateCustomFactorDef(idx, 'unit', e.target.value)} placeholder="e.g. °C" />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                {customFactorDefs.length < 3 && (
                  <button className="btn-secondary" onClick={addCustomFactor}>+ Add factor</button>
                )}
                <button className="btn-primary" onClick={applyCustomFactors}>
                  Start with primary x-axis + {customFactorDefs.length} factor{customFactorDefs.length > 1 ? 's' : ''}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Normal content (non-custom or already configured) */}
        {(scenario !== 'custom' || customFactorsConfigured) && tab === 'primary' && (
          <div className="primary-layout">
            <aside className="left-panel">
              <DataInput
                datasets={datasets}
                setDatasets={handleDatasetsChange}
                activeDatasetId={activeDatasetId}
                setActiveDatasetId={setActiveDatasetId}
                hideConditions={isPrimaryOnlyExample}
                onAxisChange={handleAxisChange}
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
                prediction={prediction}
                primaryFitDisplay={primaryFitDisplay}
              />
              <KineticPredictor
                datasets={datasets}
                selectedModels={selectedModels}
                fitResults={fitResults}
                onPrediction={setPrediction}
              />
              <ResultTable
                datasets={datasets}
                activeDatasetId={activeDatasetId}
                selectedModels={selectedModels}
                fitResults={fitResults}
                staleConditionDatasetId={staleConditionDatasetId}
              />
            </section>
          </div>
        )}
        {(scenario !== 'custom' || customFactorsConfigured) && tab === 'secondary' && (
          isPrimaryOnlyExample ? (
            <div className="panel">
              <h2 className="panel-title">Secondary Model</h2>
              <p className="hint warn">
                This sample contains only time/dose and log survival data. Secondary modeling requires
                condition metadata across multiple experimental settings; use the T1 sample or import
                datasets with treatment conditions for this workflow.
              </p>
            </div>
          ) : (
            <SecondaryModel
              key={secondaryInputGeneration}
              datasets={datasets}
              fitResults={fitResults}
              onSecondaryFit={handleSecondaryFitUpdate}
              precomputedFits={fittedSecondaryModels}
              onViewedModelChange={setLastViewedSecondaryModel}
              exampleDefaults={exampleDefaults}
              initialState={secondaryInputState}
              onStateChange={handleSecondaryStateChange}
            />
          )
        )}
        {(scenario !== 'custom' || customFactorsConfigured) && tab === 'dynamic' && (
          <DynamicSimulator fittedSecondaryModels={fittedSecondaryModels} exampleDefaults={dynamicDefaults} />
        )}
      </main>
      <UserGuide open={showGuide} onClose={() => setShowGuide(false)} />
    </div>
  );
}

export default function App() {
  return (
    <ScenarioProvider>
      <AppContent />
    </ScenarioProvider>
  );
}
