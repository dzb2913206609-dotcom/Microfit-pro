import { useState, useCallback, useRef, useEffect, useMemo, lazy, Suspense } from 'react';
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import Plotly from 'plotly.js-dist-min';
import { toPng, toSvg } from 'html-to-image';
import {
  runDynamicSimulation,
  validateDynamicProfile,
  parseProfileCSV,
  buildKFn,
  summarizeDynamicObservationFit,
} from '../models/dynamicSimulation.js';
import { SECONDARY_MODELS, MODEL_SECONDARY_CONFIG } from '../models/secondaryModels.js';
import { MODELS } from '../models/inactivationModels.js';
import { useScenario } from '../ScenarioContext';
import { getFactorDef } from '../config/factors.js';
import { formatLabelToHtml } from '../utils/formatLabels.js';
import { FormattedLabel } from '../utils/formatLabels.jsx';

const Plot = lazy(() => import('./PlotlyChart'));

const AXIS_TITLE_FONT = { size: 20, family: 'Inter, system-ui, sans-serif', color: '#1a1a1a' };
const TICK_FONT = { size: 16, family: 'Inter, system-ui, sans-serif', color: '#1a1a1a' };

const EXPORT_OPTIONS = {
  backgroundColor: '#ffffff',
  pixelRatio: 3,
  style: { margin: '0', padding: '8px' },
};

function triggerDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

async function exportContainerAsPng(container, baseName) {
  if (!container) return;
  try {
    const dataUrl = await toPng(container, EXPORT_OPTIONS);
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    triggerDownload(blob, `${baseName}.png`);
  } catch (err) {
    console.error('PNG export failed:', err);
    alert('PNG export failed. Please try again.');
  }
}

async function exportContainerAsSvg(container, baseName) {
  if (!container) return;
  try {
    const dataUrl = await toSvg(container, EXPORT_OPTIONS);
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    triggerDownload(blob, `${baseName}.svg`);
  } catch (err) {
    console.error('SVG export failed:', err);
    alert('SVG export failed. Please try again.');
  }
}

function escapeCSV(value) {
  if (value == null) return '';
  const text = String(value);
  if (/[,"\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function downloadCsvFile(fileName, lines) {
  const csv = lines.map((line) => line.map(escapeCSV).join(',')).join('\n');
  triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8' }), fileName);
}

function ExportActions({ chartRef, baseName, onCsvExport }) {
  return (
    <div className="export-actions">
      <button className="btn-secondary" onClick={() => exportContainerAsSvg(chartRef?.current, baseName)}>Export SVG</button>
      <button className="btn-secondary" onClick={() => exportContainerAsPng(chartRef?.current, baseName)}>Export PNG</button>
      {onCsvExport && (
        <button className="btn-secondary" onClick={onCsvExport}>Export CSV</button>
      )}
    </div>
  );
}

function PlotlyExportActions({ plotId, baseName, onCsvExport }) {
  const handleExport = (format) => {
    const gd = document.getElementById(plotId);
    if (!gd) return;
    const currentLayout = gd.layout || {};
    const hasRightAxis = Boolean(currentLayout.yaxis2);
    const exportLayout = {
      ...currentLayout,
      margin: { l: 80, r: hasRightAxis ? 150 : 30, b: 80, t: 40, pad: 4 },
      xaxis: { ...currentLayout.xaxis, title: { ...currentLayout.xaxis?.title, standoff: 14 } },
      yaxis: { ...currentLayout.yaxis, title: { ...currentLayout.yaxis?.title, standoff: 14 } },
      ...(hasRightAxis ? {
        yaxis2: {
          ...currentLayout.yaxis2,
          title: { ...currentLayout.yaxis2?.title, standoff: 26 },
        },
      } : {}),
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
      <button className="btn-secondary" onClick={() => handleExport('svg')}>Export SVG</button>
      <button className="btn-secondary" onClick={() => handleExport('png')}>Export PNG</button>
      {onCsvExport && (
        <button className="btn-secondary" onClick={onCsvExport}>Export CSV</button>
      )}
    </div>
  );
}

function getSecondaryIdsForDynamic(targetCfg, scenario, mode) {
  const ids = (targetCfg?.allowedSecondaryModels ?? [])
    .filter((id) => SECONDARY_MODELS[id]?.scenarios?.includes(scenario));

  if (scenario !== 'custom') return ids;

  const seen = new Set(ids);
  (mode?.applicableSecondaryModels ?? []).forEach((id) => {
    if (SECONDARY_MODELS[id]?.scenarios?.includes('custom') && !seen.has(id)) {
      ids.push(id);
      seen.add(id);
    }
  });
  return ids;
}

/** Get column header label for a factor key */
function getFactorColumnHeader(key) {
  const f = getFactorDef(key);
  if (!f) return key;
  if (key === 'aw') return 'a_w';
  return f.unit ? `${f.shortLabel} (${f.unit})` : f.shortLabel;
}

function ProfileTable({ profile, setProfile, visibleKeys }) {
  const keys = visibleKeys;

  function updateCell(rowIdx, key, value) {
    setProfile((prev) => prev.map((row, i) =>
      i === rowIdx ? { ...row, [key]: parseFloat(value) } : row
    ));
  }

  function addRow() {
    const last = profile[profile.length - 1] ?? { t: 0 };
    const newRow = { ...last, t: (last.t ?? 0) + 5 };
    setProfile((prev) => [...prev, newRow]);
  }

  function removeRow(idx) {
    setProfile((prev) => prev.filter((_, i) => i !== idx));
  }

  const colHeaders = ['Time', ...keys.map(getFactorColumnHeader)];

  return (
    <div className="profile-table-wrap">
      <table className="profile-table">
        <thead>
          <tr>
            {colHeaders.map((h) => <th key={h}><FormattedLabel text={h} /></th>)}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {profile.map((row, i) => (
            <tr key={i}>
              <td>
                <input type="number" value={Number.isFinite(row.t) ? row.t : ''} step="1"
                  onChange={(e) => updateCell(i, 't', e.target.value)} />
              </td>
              {keys.map((k) => (
                <td key={k}>
                  <input type="number" value={Number.isFinite(row[k]) ? row[k] : ''} step="any"
                    onChange={(e) => updateCell(i, k, e.target.value)} />
                </td>
              ))}
              <td>
                <button className="btn-icon" onClick={() => removeRow(i)} title="Remove row">✕</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="btn-secondary" onClick={addRow}>+ Add row</button>
    </div>
  );
}

function ProfilePreview({ profile, visibleKeys, modeConfig }) {
  const { timeUnit } = useScenario();

  if (profile.length < 2) return null;

  const primaryKey = modeConfig?.primaryFactor;
  const primaryFactor = primaryKey ? getFactorDef(primaryKey) : getFactorDef('temp');
  const hasPrimary = visibleKeys.includes(primaryKey || 'temp');
  const hasAw = visibleKeys.includes('aw');

  // Find secondary factor keys that are not the primary and not aw
  const otherKeys = visibleKeys.filter((k) => k !== (primaryKey || 'temp') && k !== 'aw');

  const rightMargin = hasAw ? 48 : 16;
  const primaryLabel = primaryFactor ? `${primaryFactor.shortLabel} (${primaryFactor.unit})` : 'Temp (°C)';
  const primaryDataKey = primaryKey || 'temp';

  return (
    <ResponsiveContainer width="100%" height={230}>
      <ComposedChart data={profile} margin={{ top: 12, right: rightMargin, bottom: 36, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
        <XAxis
          dataKey="t"
          label={{ value: `Time (${timeUnit})`, position: 'insideBottom', offset: -10, fontSize: 14 }}
          tick={{ fontSize: 14 }}
        />
        {/* Left Y-axis: Primary factor */}
        <YAxis
          yAxisId="left"
          width={60}
          tick={{ fontSize: 14, fill: '#ef4444' }}
          label={{ value: primaryLabel, angle: -90, position: 'insideLeft', style: { fontSize: 14, fill: '#ef4444' } }}
        />
        {/* Right Y-axis: Water activity */}
        {hasAw && (
          <YAxis
            yAxisId="right"
            orientation="right"
            domain={[0.8, 1.0]}
            tick={{ fontSize: 14, fill: '#10b981' }}
            label={{ value: 'a_w', angle: 90, position: 'insideRight', style: { fontSize: 14, fill: '#10b981' } }}
            width={40}
          />
        )}
        <Tooltip
          formatter={(value, name) => {
            if (name === 'a_w') return [Number(value).toFixed(3), name];
            return [Number(value).toFixed(1), name];
          }}
        />
        <Legend verticalAlign="bottom" wrapperStyle={{ paddingTop: '16px', fontSize: '14px' }} />
        {/* Other factors as semi-transparent area background */}
        {otherKeys.map((k) => {
          const f = getFactorDef(k);
          const label = f ? (f.unit ? `${f.shortLabel} (${f.unit})` : f.shortLabel) : k;
          return (
            <Area
              key={k}
              yAxisId="left"
              dataKey={k}
              name={label}
              fill="#3b82f6"
              fillOpacity={0.12}
              stroke="#3b82f6"
              strokeWidth={1}
              strokeOpacity={0.35}
              dot={false}
              isAnimationActive={false}
              legendType="rect"
            />
          );
        })}
        {/* Primary factor line on left axis */}
        {hasPrimary && (
          <Line
            yAxisId="left"
            dataKey={primaryDataKey}
            name={primaryLabel}
            stroke="#ef4444"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        )}
        {/* Water activity line on right axis */}
        {hasAw && (
          <Line
            yAxisId="right"
            dataKey="aw"
            name="a_w"
            stroke="#10b981"
            strokeWidth={2}
            dot={false}
            strokeDasharray="5 3"
            isAnimationActive={false}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export default function DynamicSimulator({ fittedSecondaryModels, exampleDefaults }) {
  const { scenario, mode, timeUnit, timeUnitToMin } = useScenario();

  // Default profile from mode config
  const defaultProfile = useMemo(
    () => structuredClone(mode?.defaultProfile ?? [
      { t: 0, temp: 20, aw: 1.0 },
      { t: 5, temp: 80, aw: 1.0 },
      { t: 30, temp: 121, aw: 1.0 },
      { t: 35, temp: 20, aw: 1.0 },
    ]).map(row => ({ ...row, t: row.t / timeUnitToMin })),
    [mode, timeUnitToMin]
  );

  const [profile, setProfile] = useState(defaultProfile);
  const [logN0, setLogN0] = useState(9);
  const [steps, setSteps] = useState(500);
  const [selectedFitKey, setSelectedFitKey] = useState('');
  const [simResult, setSimResult] = useState(null);
  const [fallbackWarnings, setFallbackWarnings] = useState([]);
  const [error, setError] = useState(null);
  const [yLabel, setYLabel] = useState('Survival (log\u2081\u2080CFU/g)');
  const [xLabel, setXLabel] = useState(`Time (${timeUnit})`);
  const [dynamicObservations, setDynamicObservations] = useState([]);

  // Lethality reference params — initialized from mode config
  const [lethalityState, setLethalityState] = useState(() => {
    const params = {};
    for (const p of mode?.lethalityMetric?.referenceParams ?? []) {
      params[p.key] = p.default;
    }
    return params;
  });
  const [targetValue, setTargetValue] = useState(
    mode?.lethalityMetric?.targetParam?.default ?? 3.0
  );

  const fileInputRef = useRef(null);
  const pendingExampleAutoRunRef = useRef(null);
  const profileUnitRef = useRef({ modeId: mode?.id, toMin: timeUnitToMin });
  useEffect(() => {
    const previous = profileUnitRef.current;
    profileUnitRef.current = { modeId: mode?.id, toMin: timeUnitToMin };
    if (previous.modeId !== mode?.id || previous.toMin === timeUnitToMin) return;
    const scale = previous.toMin / timeUnitToMin;
    const timer = window.setTimeout(() => {
      setProfile(rows => rows.map(row => ({ ...row, t: row.t * scale })));
      setDynamicObservations(rows => rows.map(row => ({ ...row, t: row.t * scale })));
      setSimResult(null);
      setXLabel(`Time (${timeUnit})`);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [mode?.id, timeUnitToMin, timeUnit]);

  // Reset profile and lethality params when mode changes
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setProfile(defaultProfile);
      const params = {};
      for (const p of mode?.lethalityMetric?.referenceParams ?? []) {
        params[p.key] = p.default;
      }
      setLethalityState(params);
      setTargetValue(mode?.lethalityMetric?.targetParam?.default ?? 3.0);
      setSimResult(null);
      setSelectedFitKey('');
      setDynamicObservations([]);
      setError(null);
      setFallbackWarnings([]);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [scenario]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!exampleDefaults) return;
    const timer = window.setTimeout(() => {
      if (Array.isArray(exampleDefaults.profile) && exampleDefaults.profile.length >= 2) {
        setProfile(structuredClone(exampleDefaults.profile));
      }
      if (Number.isFinite(exampleDefaults.logN0)) setLogN0(exampleDefaults.logN0);
      if (Number.isFinite(exampleDefaults.steps)) setSteps(exampleDefaults.steps);
      if (exampleDefaults.selectedFitKey) setSelectedFitKey(exampleDefaults.selectedFitKey);
      if (exampleDefaults.lethalityParams) {
        setLethalityState((prev) => ({ ...prev, ...exampleDefaults.lethalityParams }));
      }
      if (Number.isFinite(exampleDefaults.targetValue)) setTargetValue(exampleDefaults.targetValue);
      if (exampleDefaults.xLabel) setXLabel(exampleDefaults.xLabel);
      if (exampleDefaults.yLabel) setYLabel(exampleDefaults.yLabel);
      setDynamicObservations(Array.isArray(exampleDefaults.observations)
        ? structuredClone(exampleDefaults.observations)
        : []);
      pendingExampleAutoRunRef.current = exampleDefaults.autoRun ? exampleDefaults.loadedAt : null;
      setSimResult(null);
      setError(null);
      setFallbackWarnings([]);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [exampleDefaults]);

  const fitEntries = Object.entries(fittedSecondaryModels ?? {});

  const selectedFit = fittedSecondaryModels?.[selectedFitKey];
  const selectedModelDef = selectedFit
    ? SECONDARY_MODELS[selectedFit.secondaryModelId]
    : null;

  // Visible profile columns from mode config
  const visibleKeys = useMemo(() => {
    const cols = mode?.profileColumns ?? ['temp', 'aw'];
    // If the selected model needs additional factors, include them
    if (selectedModelDef) {
      const extra = selectedModelDef.factorKeys.filter((k) => !cols.includes(k));
      if (extra.length > 0) return [...cols, ...extra];
    }
    return cols;
  }, [mode, selectedModelDef]);

  // Extract z and Tref from Bigelow-type models for auto-fill (thermal mode)
  const BIGELOW_IDS = ['BIGELOW', 'EXTENDED_BIGELOW', 'BIGELOW_PRESSURE', 'EXTENDED_BIGELOW_PRESSURE'];
  const modelZ = selectedFit && BIGELOW_IDS.includes(selectedFit.secondaryModelId) && Number.isFinite(selectedFit.params?.z)
    ? selectedFit.params.z : null;
  const modelTref = selectedFit && BIGELOW_IDS.includes(selectedFit.secondaryModelId) && Number.isFinite(selectedFit.params?.Tref)
    ? selectedFit.params.Tref : null;

  // Auto-fill z/Tref when a Bigelow model is selected and we're in thermal mode
  useEffect(() => {
    if (mode?.lethalityMetric?.source !== 'integral') return;
    const refParams = mode?.lethalityMetric?.referenceParams ?? [];
    const timer = window.setTimeout(() => {
      setLethalityState((prev) => {
        let next = prev;
        if (modelZ != null && refParams.some((p) => p.key === 'zValue')) {
          next = { ...next, zValue: modelZ };
        }
        if (modelTref != null && refParams.some((p) => p.key === 'Tref')) {
          next = next === prev ? { ...next, Tref: modelTref } : { ...next, Tref: modelTref };
        }
        return next;
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [selectedFitKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Build grouped options for the secondary model dropdown
  const groupedOptions = useMemo(() => {
    const groups = [];
    for (const [primaryId, config] of Object.entries(MODEL_SECONDARY_CONFIG)) {
      const primaryName = MODELS[primaryId]?.name ?? primaryId;
      const options = [];
      for (const [targetKey, targetCfg] of Object.entries(config.targets)) {
        for (const secModelId of getSecondaryIdsForDynamic(targetCfg, scenario, mode)) {
          const secModel = SECONDARY_MODELS[secModelId];
          if (!secModel) continue;
          const fitKey = `${secModelId}_${targetKey}`;
          const paramLabel = targetCfg.label ?? targetKey;
          const factorDesc = secModel.factorKeys
            .map((k) => getFactorDef(k)?.shortLabel ?? k)
            .join(' + ') || 'constant';
          const shortName = secModel.name.replace(/\s*\(.*\)/, '');
          const label = `${paramLabel} vs ${factorDesc} (${shortName})`;
          options.push({ fitKey, label, isFitted: !!fittedSecondaryModels?.[fitKey] });
        }
      }
      if (options.length > 0) {
        groups.push({ primaryId, primaryName, options });
      }
    }
    return groups;
  }, [fittedSecondaryModels, scenario, mode]);

  const isUnfitted = selectedFitKey && !fittedSecondaryModels?.[selectedFitKey];

  const DYNAMIC_COMPATIBLE_PRIMARIES = new Set(['LOG_LINEAR', 'LOG_LINEAR_TAIL']);
  const selectedPrimaryId = useMemo(() => {
    if (!selectedFitKey) return null;
    for (const group of groupedOptions) {
      if (group.options.some(o => o.fitKey === selectedFitKey)) return group.primaryId;
    }
    return null;
  }, [selectedFitKey, groupedOptions]);
  const isDynamicIncompatible = selectedPrimaryId && !DYNAMIC_COMPATIBLE_PRIMARIES.has(selectedPrimaryId);

  const visibleKeysSig = visibleKeys.join(',');

  // Patch profile with defaults when new columns become visible
  useEffect(() => {
    const keys = visibleKeysSig.split(',').filter(Boolean);
    const timer = window.setTimeout(() => {
      setProfile((prev) => {
        let changed = false;
        const patched = prev.map((row) => {
          const newRow = { ...row };
          for (const key of keys) {
            if (newRow[key] == null) {
              const f = getFactorDef(key);
              newRow[key] = f?.default ?? 0;
              changed = true;
            }
          }
          return newRow;
        });
        return changed ? patched : prev;
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [visibleKeysSig]);

  function handleCSVUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      let parsed;
      try { parsed = parseProfileCSV(ev.target.result, mode); }
      catch (err) { setError(err.message); return; }
      const parsedError = validateDynamicProfile(parsed, mode?.primaryFactor ? [mode.primaryFactor] : []);
      if (!parsedError) {
        setProfile(parsed);
        setError(null);
      } else {
        setError(parsedError);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  const handleSimulate = useCallback(() => {
    setError(null);
    setFallbackWarnings([]);
    setSimResult(null);

    const profileError = validateDynamicProfile(profile, mode?.primaryFactor ? [mode.primaryFactor] : []);
    if (profileError) {
      setError(profileError);
      return;
    }

    const fitData = fittedSecondaryModels?.[selectedFitKey];
    if (!fitData) {
      setError('Please select a fitted secondary model.');
      return;
    }

    // Determine which factor keys exist in the profile
    const profileFactorKeys = [];
    const firstRow = profile[0];
    for (const key of Object.keys(firstRow)) {
      if (key !== 't') {
        profileFactorKeys.push(key);
      }
    }

    const built = buildKFn(fitData, profileFactorKeys);
    if (!built) {
      setError('Could not build rate function from selected model.');
      return;
    }

    if (built.fallbacks?.length > 0) {
      setFallbackWarnings(
        built.fallbacks.map((fb) => {
          const f = getFactorDef(fb.factorKey);
          const label = f?.label ?? fb.factorKey;
          return `${label} not found in profile — using reference value (${fb.value} from ${fb.paramName})`;
        })
      );
    }

    // Extrapolation detection: check if profile factors exceed calibration range
    const extrapolationWarns = [];
    if (fitData.rows?.length > 0) {
      for (const fk of profileFactorKeys) {
        const calValues = fitData.rows.map(r => r.factors?.[fk]).filter(Number.isFinite);
        if (calValues.length === 0) continue;
        const calMin = Math.min(...calValues);
        const calMax = Math.max(...calValues);
        const profValues = profile.map(r => r[fk]).filter(Number.isFinite);
        const profMin = Math.min(...profValues);
        const profMax = Math.max(...profValues);
        const fDef = getFactorDef(fk);
        const label = fDef?.label ?? fk;
        if (profMin < calMin - 1e-9 || profMax > calMax + 1e-9) {
          extrapolationWarns.push(
            `${label} outside calibration range [${calMin.toFixed(1)}, ${calMax.toFixed(1)}]: profile has [${profMin.toFixed(1)}, ${profMax.toFixed(1)}]`
          );
        }
      }
    }
    if (extrapolationWarns.length > 0) {
      setFallbackWarnings(prev => [
        ...prev,
        ...extrapolationWarns.map(w => `Extrapolation detected: ${w}`),
      ]);
    }

    try {
      const result = runDynamicSimulation({
        logN0,
        profile,
        kFn: built.kFn,
        steps,
        modeConfig: mode,
        lethalityParams: { ...lethalityState, _timeUnitToMin: timeUnitToMin },
      });
      setSimResult(result);
    } catch (err) {
      setError(err.message || 'Dynamic simulation failed.');
    }
  }, [profile, logN0, steps, selectedFitKey, fittedSecondaryModels, mode, lethalityState, timeUnitToMin]);

  const lethalityMetric = mode?.lethalityMetric;
  const isThermalIntegral = mode?.id === 'thermal' && lethalityMetric?.source === 'integral';
  const cumulativeMetricLabel = isThermalIntegral
    ? 'Cumulative F-value (min)'
    : `Cumulative ${lethalityMetric?.name?.toLowerCase() ?? 'lethality'}`;
  const targetAnnotationLabel = isThermalIntegral ? 'Target F' : 'Target';
  const finalResult = simResult?.length ? simResult[simResult.length - 1] : null;
  const finalLogReduction = finalResult?.logReduction ?? null;
  const finalCumulativeMetric = finalResult?.F ?? null;
  const observationFit = useMemo(
    () => (simResult?.length ? summarizeDynamicObservationFit(simResult, dynamicObservations) : null),
    [simResult, dynamicObservations]
  );

  useEffect(() => {
    const pendingId = pendingExampleAutoRunRef.current;
    if (!pendingId || pendingId !== exampleDefaults?.loadedAt) return;
    if (!exampleDefaults?.autoRun || !exampleDefaults.selectedFitKey) return;
    if (selectedFitKey !== exampleDefaults.selectedFitKey) return;
    if (!fittedSecondaryModels?.[selectedFitKey]) return;
    if (!profile || profile.length < 2) return;
    const timer = window.setTimeout(() => {
      if (pendingExampleAutoRunRef.current !== pendingId) return;
      pendingExampleAutoRunRef.current = null;
      handleSimulate();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [exampleDefaults, fittedSecondaryModels, handleSimulate, profile, selectedFitKey]);

  // CSV hint columns
  const csvHintCols = visibleKeys.map((k) => {
    const f = getFactorDef(k);
    return f?.label?.toLowerCase() ?? k;
  });

  return (
    <div className="dynamic-simulator">
      <h2 className="section-title">Dynamic Process Simulation</h2>
      <p className="section-hint">
        Simulate microbial inactivation under a time-varying process profile with Simpson integration split at every profile knot (equivalent to RK4 for the log-survival rate).
      </p>
      {exampleDefaults?.id && (
        <div className="ds-sample-note">
          <strong>Loaded dynamic sample:</strong> profile and model settings were loaded from the selected example. Press Simulate again after editing the profile or parameters.
        </div>
      )}

      <div className="ds-layout">
        {/* Left: profile input */}
        <div className="ds-left">
          <div className="ds-section-header">
            <span>Process Profile</span>
            <button className="btn-secondary" onClick={() => fileInputRef.current?.click()}>
              Upload CSV
            </button>
            <input ref={fileInputRef} type="file" accept=".csv,.txt" style={{ display: 'none' }} onChange={handleCSVUpload} />
          </div>
          <p className="ds-hint">
            CSV columns: <code>time</code>
            {csvHintCols.map((col) => (
              <span key={col}>, <code>{col}</code></span>
            ))}
            {' '}(extra columns auto-detected)
          </p>
          <ProfileTable profile={profile} setProfile={setProfile} visibleKeys={visibleKeys} />
          <div className="ds-preview-title">Profile Preview</div>
          <ProfilePreview profile={profile} visibleKeys={visibleKeys} modeConfig={mode} />
        </div>

        {/* Right: parameters + results */}
        <div className="ds-right">
          <div className="ds-section-header">Simulation Parameters</div>

          <label className="ds-label">
            Initial log₁₀(N₀)
            <input type="number" className="ds-input" value={logN0} step="0.5"
              onChange={(e) => setLogN0(parseFloat(e.target.value) || 9)} />
          </label>

          <label className="ds-label">
            Integration steps
            <input type="number" className="ds-input" value={steps} min={50} max={5000} step={50}
              onChange={(e) => setSteps(Math.max(50, parseInt(e.target.value) || 500))} />
          </label>

          <label className="ds-label">
            Secondary model (k source)
            <select className="ds-select" value={selectedFitKey}
              onChange={(e) => setSelectedFitKey(e.target.value)}>
              <option value="">— select —</option>
              {groupedOptions.map(group => (
                <optgroup key={group.primaryId} label={`${group.primaryName} Models`}>
                  {group.options.map(opt => (
                    <option key={opt.fitKey} value={opt.fitKey}>
                      {opt.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          {/* Lethality settings — dynamically rendered from mode config */}
          {lethalityMetric && lethalityMetric.source === 'integral' && lethalityMetric.referenceParams.length > 0 && (
            <div className="ds-f-settings">
              <span className="ds-f-settings-title">{lethalityMetric.name} settings</span>
              {lethalityMetric.referenceParams.map((param) => (
                <label key={param.key} className="ds-label">
                  <span dangerouslySetInnerHTML={{ __html: param.label }} />
                  <div className="ds-inline-control">
                    <input
                      type="number"
                      className="ds-input"
                      value={lethalityState[param.key] ?? param.default}
                      step={0.1}
                      onChange={(e) => setLethalityState((prev) => ({
                        ...prev,
                        [param.key]: parseFloat(e.target.value) || param.default,
                      }))}
                    />
                    {param.key === 'zValue' && modelZ != null && (
                      <button className="btn-secondary ds-use-model-btn"
                        title={`Use model z = ${modelZ.toFixed(2)}`}
                        onClick={() => {
                          setLethalityState((prev) => ({
                            ...prev,
                            zValue: modelZ,
                            ...(modelTref != null ? { Tref: modelTref } : {}),
                          }));
                        }}>
                        Use z
                      </button>
                    )}
                  </div>
                </label>
              ))}
              {lethalityMetric.targetParam && (
                <label className="ds-label">
                  {lethalityMetric.targetParam.label}
                  <input type="number" className="ds-input" value={targetValue} step={0.5} min={0}
                    onChange={(e) => setTargetValue(parseFloat(e.target.value) || lethalityMetric.targetParam.default)} />
                </label>
              )}
            </div>
          )}

          {/* State-based lethality: just show target */}
          {lethalityMetric && lethalityMetric.source === 'state' && lethalityMetric.targetParam && (
            <div className="ds-f-settings">
              <span className="ds-f-settings-title">{lethalityMetric.name} settings</span>
              <label className="ds-label">
                {lethalityMetric.targetParam.label}
                <input type="number" className="ds-input" value={targetValue} step={0.5} min={0}
                  onChange={(e) => setTargetValue(parseFloat(e.target.value) || lethalityMetric.targetParam.default)} />
              </label>
            </div>
          )}

          {fitEntries.length === 0 && (
            <p className="ds-hint ds-hint-warn">
              No secondary models fitted yet. Go to the Secondary models tab and fit a model first.
            </p>
          )}

          {isUnfitted && (
            <p className="ds-hint ds-hint-warn">
              Selected model has no fitted parameters. Please fit it in the Secondary Models tab first.
            </p>
          )}

          {isDynamicIncompatible && (
            <div className="ds-warning">
              Dynamic simulation for non-log-linear primary models ({MODELS[selectedPrimaryId]?.name ?? selectedPrimaryId}) is not rigorously supported.
              The ODE d(log N)/dt = −k(t)/ln(10) assumes first-order kinetics. Results should be interpreted as approximate.
              For Weibull, biphasic, shoulder-tail, or Baranyi models, treat the result as fixed-condition fitting only.
            </div>
          )}

          <button className="btn-primary ds-run-btn" onClick={handleSimulate}
            disabled={!selectedFitKey || isUnfitted || profile.length < 2}>
            Simulate
          </button>

          {error && <div className="ds-error">{error}</div>}
          {fallbackWarnings.map((w, i) => (
            <div key={i} className="ds-warning">{w}</div>
          ))}

          {finalLogReduction != null && (
            <div className="ds-result-summary">
              <div>
                Final log reduction: <strong>{finalLogReduction.toFixed(2)}</strong> log cycles
              </div>
              {isThermalIntegral && finalCumulativeMetric != null && (
                <div className="ds-result-detail">
                  Final F-value: <strong>{Number(finalCumulativeMetric).toFixed(2)}</strong> min at T<sub>ref</sub>.
                  {' '}For D-value models, log reduction equals F / D<sub>ref</sub>.
                </div>
              )}
              {observationFit?.n > 0 && (
                <div className="ds-result-detail">
                  Observation RMSE: <strong>{observationFit.rmse.toFixed(3)}</strong> log units
                  {' '}(n = {observationFit.n}; residual = observed - predicted).
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {simResult && simResult.length > 0 && (() => {
        const hasFDataLocal = simResult.some((r) => r.F != null);
        const traces = [];
        traces.push({
          type: 'scatter',
          mode: 'lines',
          name: 'log\u2081\u2080(N)',
          x: simResult.map((r) => r.t),
          y: simResult.map((r) => r.logN),
          line: { color: '#1d4ed8', width: 2.4 },
          hovertemplate: 'Time: %{x:.2f}<br>log\u2081\u2080(N): %{y:.3f}<extra></extra>',
        });
        if (hasFDataLocal) {
          traces.push({
            type: 'scatter',
            mode: 'lines',
            name: cumulativeMetricLabel,
            x: simResult.map((r) => r.t),
            y: simResult.map((r) => r.F),
            yaxis: 'y2',
            line: { color: '#dc2626', width: 2.4 },
            hovertemplate: `Time: %{x:.2f}<br>${cumulativeMetricLabel}: %{y:.3f}<extra></extra>`,
          });
        }
        const observationFitLocal = observationFit;
        const observationColors = {
          'Fig. 3A': '#f97316',
          'Fig. 3B': '#16a34a',
          'Fig. 3C': '#7c3aed',
        };
        if (observationFitLocal?.rows?.length > 0) {
          const bySeries = new Map();
          observationFitLocal.rows.forEach((row) => {
            const key = row.series ?? 'Observed';
            if (!bySeries.has(key)) bySeries.set(key, []);
            bySeries.get(key).push(row);
          });
          bySeries.forEach((rows, series) => {
            traces.push({
              type: 'scatter',
              mode: 'markers',
              name: `${series} observations`,
              x: rows.map((r) => r.t),
              y: rows.map((r) => r.observedLogN),
              marker: {
                color: observationColors[series] ?? '#525252',
                size: 8,
                symbol: 'circle-open',
                line: { width: 1.8 },
              },
              customdata: rows.map((r) => [r.predictedLogN, r.residual]),
              hovertemplate: 'Time: %{x:.2f}<br>Observed: %{y:.3f}<br>Predicted: %{customdata[0]:.3f}<br>Residual: %{customdata[1]:.3f}<extra></extra>',
            });
          });
        }
        const simLayout = {
          autosize: true,
          height: 420,
          xaxis: {
            title: { text: formatLabelToHtml(xLabel), font: AXIS_TITLE_FONT, standoff: 12 },
            tickfont: TICK_FONT,
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
            mirror: true,
          },
          yaxis: {
            title: { text: formatLabelToHtml(yLabel), font: AXIS_TITLE_FONT, standoff: 12 },
            tickfont: TICK_FONT,
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
            mirror: true,
          },
          ...(hasFDataLocal ? {
            yaxis2: {
              title: { text: cumulativeMetricLabel, font: { ...AXIS_TITLE_FONT, color: '#dc2626' }, standoff: 26 },
              tickfont: { ...TICK_FONT, color: '#dc2626' },
              overlaying: 'y',
              side: 'right',
              showline: true,
              linecolor: '#dc2626',
              linewidth: 1.5,
              ticks: 'inside',
              tickwidth: 1,
              ticklen: 5,
              tickcolor: '#dc2626',
              gridcolor: 'rgba(0,0,0,0)',
              zeroline: false,
              mirror: true,
            },
          } : {}),
          legend: {
            orientation: 'h',
            x: 0.5,
            xanchor: 'center',
            y: -0.18,
            yanchor: 'top',
            font: { size: 14, family: 'Inter, system-ui, sans-serif', color: '#1a1a1a' },
            bgcolor: 'rgba(255,255,255,0)',
          },
          margin: { l: 70, r: hasFDataLocal ? 135 : 20, b: 80, t: 30, pad: 4 },
          paper_bgcolor: 'white',
          plot_bgcolor: 'white',
          font: { family: 'Inter, system-ui, sans-serif', color: '#1a1a1a' },
          shapes: hasFDataLocal ? [{
            type: 'line',
            x0: 0, x1: 1, xref: 'paper',
            y0: targetValue, y1: targetValue,
            yref: 'y2',
            line: { color: '#dc2626', width: 1.2, dash: 'dash' },
          }] : [],
          annotations: hasFDataLocal ? [{
            x: 0.985, xref: 'paper', xanchor: 'right',
            y: targetValue, yref: 'y2',
            text: targetAnnotationLabel,
            showarrow: false,
            bgcolor: 'rgba(255,255,255,0.85)',
            borderpad: 2,
            font: { size: 14, color: '#dc2626' },
          }] : [],
          hovermode: 'closest',
        };
        const csvExport = () => {
          const envKeys = visibleKeys;
          const headers = ['Time', 'log10(N)', 'Log Reduction', ...envKeys.map((k) => {
            const f = getFactorDef(k);
            return f ? `${f.label} (${f.unit})` : k;
	          }), cumulativeMetricLabel];
          const rows = simResult.map((r) => [
            r.t, r.logN, r.logReduction,
            ...envKeys.map((k) => r.env?.[k] ?? r[k] ?? ''),
            r.F,
          ]);
          const csvRows = [headers, ...rows];
          if (observationFitLocal?.rows?.length > 0) {
            csvRows.push([]);
            csvRows.push(['Observation series', 'Observation time', 'Observed log10(N)', 'Predicted log10(N)', 'Residual (observed - predicted)']);
            observationFitLocal.rows.forEach((row) => {
              csvRows.push([
                row.series ?? '',
                row.t,
                row.observedLogN,
                row.predictedLogN,
                row.residual,
              ]);
            });
          }
          downloadCsvFile('DynamicSimulation_logN.csv', csvRows);
        };
        return (
          <div className="ds-chart-section">
            <div className="ds-chart-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>log₁₀(N) vs Time</span>
              <PlotlyExportActions plotId="dynamic-sim-chart" baseName="DynamicSimulation_logN" onCsvExport={csvExport} />
            </div>
            <div style={{ display: 'flex', gap: 12, fontSize: 14, margin: '6px 0 4px' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                X Label
                <input value={xLabel} onChange={(e) => setXLabel(e.target.value)}
                  placeholder={`Time (${timeUnit})`} style={{ fontSize: 14, padding: '3px 6px', width: 180 }} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                Y Label
                <input value={yLabel} onChange={(e) => setYLabel(e.target.value)}
                  placeholder="Survival (log₁₀CFU/g)" style={{ fontSize: 14, padding: '3px 6px', width: 220 }} />
              </label>
            </div>
            <Suspense fallback={<p className="hint">Loading chart...</p>}>
              <div style={{ minHeight: simLayout.height }}>
                <Plot
                  divId="dynamic-sim-chart"
                  data={traces}
                  layout={simLayout}
                  config={{
                    responsive: true,
                    scrollZoom: false,
                    displayModeBar: true,
                    modeBarButtonsToAdd: ['resetScale2d'],
                    toImageButtonOptions: {
                      format: 'svg',
                      filename: 'DynamicSimulation_logN',
                      width: 1200,
                      height: 750,
                      scale: 3,
                    },
                  }}
                  style={{ width: '100%' }}
                  useResizeHandler
                />
              </div>
            </Suspense>
          </div>
        );
      })()}
    </div>
  );
}
