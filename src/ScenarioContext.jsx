/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useMemo, useState, useCallback } from 'react';
import { STERILIZATION_MODES } from './config/sterilizationModes.js';
import { FACTORS } from './config/factors.js';

/**
 * Derive SCENARIO_CONFIG dynamically from STERILIZATION_MODES.
 * This preserves the existing shape consumed by components while
 * adding the full mode object for new consumers.
 */
function buildScenarioConfig() {
  return Object.fromEntries(
    Object.values(STERILIZATION_MODES).map((mode) => [
      mode.id,
      {
        label: mode.label,
        primaryFactorKey: mode.primaryFactor,
        visibleFactorKeys: [
          ...new Set([
            mode.primaryFactor,
            ...(mode.secondaryFactor ? [mode.secondaryFactor] : []),
            ...(mode.zFactor ? [mode.zFactor] : []),
            ...(mode.profileColumns ?? []),
          ]),
        ],
        mode, // full mode config for downstream access
      },
    ])
  );
}

let SCENARIO_CONFIG = buildScenarioConfig();

const ScenarioContext = createContext({
  scenario: 'thermal',
  setScenario: () => {},
  primaryFactorKey: 'temp',
  visibleFactorKeys: ['temp', 'aw', 'pH'],
  config: SCENARIO_CONFIG.thermal,
  mode: STERILIZATION_MODES.thermal,
  useDoseAxis: false,
  setUseDoseAxis: () => {},
  timeUnit: 'min',
  setTimeUnit: () => {},
  timeUnitToMin: 1,
  refreshCustomConfig: () => {},
});

export function ScenarioProvider({ children }) {
  const [scenario, setScenario] = useState('thermal');
  const [useDoseAxis, setUseDoseAxis] = useState(false);
  const [timeUnit, setTimeUnit] = useState('min');
  // Bump this counter after calling updateCustomModeFactors to force re-derivation
  const [customConfigVersion, setCustomConfigVersion] = useState(0);

  const refreshCustomConfig = useCallback(() => {
    SCENARIO_CONFIG = buildScenarioConfig();
    setCustomConfigVersion((v) => v + 1);
  }, []);

  const value = useMemo(() => {
    const config = SCENARIO_CONFIG[scenario];
    const hasDoseAxis = !!config.mode.doseAxis;
    const doseActive = hasDoseAxis && useDoseAxis;
    const visibleFactorKeys = doseActive
      ? config.visibleFactorKeys.filter((k) => k !== config.mode.doseAxis.factor)
      : config.visibleFactorKeys;
    const activeTimeUnit = config.mode.timeUnitOptions ? timeUnit : 'min';
    const tuOpt = (config.mode.timeUnitOptions || []).find((o) => o.key === activeTimeUnit);
    const timeUnitToMin = tuOpt ? tuOpt.toMin : 1;
    const axisFactor = FACTORS[config.primaryFactorKey];
    const primaryAxisLabel = doseActive
      ? `${config.mode.doseAxis.label} (${config.mode.doseAxis.unit})`
      : scenario === 'custom' && axisFactor
        ? `${axisFactor.label}${axisFactor.unit ? ` (${axisFactor.unit})` : ''}`
        : `Time (${activeTimeUnit})`;
    return {
      primaryAxisLabel,
      axisSettings: { useDoseAxis: doseActive, timeUnit: activeTimeUnit },
      scenario,
      setScenario,
      primaryFactorKey: config.primaryFactorKey,
      visibleFactorKeys,
      config,
      mode: config.mode,
      useDoseAxis: doseActive,
      setUseDoseAxis,
      timeUnit: activeTimeUnit,
      setTimeUnit,
      timeUnitToMin,
      refreshCustomConfig,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario, useDoseAxis, timeUnit, customConfigVersion]);

  return (
    <ScenarioContext.Provider value={value}>
      {children}
    </ScenarioContext.Provider>
  );
}

export function useScenario() {
  return useContext(ScenarioContext);
}

export { SCENARIO_CONFIG };
