const STRICT_ZONE_LIMITS = {
  excellentLow: 0.95,
  excellentHigh: 1.05,
  acceptableLow: 0.85,
  acceptableHigh: 1.15,
};

const AGREEMENT_LIMITS = {
  close: 1.25,
  moderate: 1.5,
  appreciable: 2,
};

const RESISTANCE_TARGETS = new Set([
  'D',
  'delta',
  'delta1',
  'delta2',
  'td',
  'Sl',
  'lambda',
]);

function isFinitePositive(value) {
  return Number.isFinite(value) && value > 0;
}

export function classifyStrictBfZone(Bf) {
  if (!Number.isFinite(Bf)) {
    return { label: '--', className: '', severity: 'unknown' };
  }
  if (Bf >= STRICT_ZONE_LIMITS.excellentLow && Bf <= STRICT_ZONE_LIMITS.excellentHigh) {
    return { label: 'Excellent fit', className: 'diag-good', severity: 'excellent' };
  }
  if (Bf >= STRICT_ZONE_LIMITS.acceptableLow && Bf <= STRICT_ZONE_LIMITS.acceptableHigh) {
    return { label: 'Acceptable', className: 'diag-ok', severity: 'acceptable' };
  }
  return { label: 'Outside preset zone', className: 'diag-caution', severity: 'outside' };
}

export function classifyDiagnosticAgreement(Af) {
  if (!isFinitePositive(Af)) {
    return { label: '--', className: '', severity: 'unknown' };
  }
  if (Af <= AGREEMENT_LIMITS.close) {
    return { label: 'Close agreement', className: 'diag-good', severity: 'close' };
  }
  if (Af <= AGREEMENT_LIMITS.moderate) {
    return { label: 'Moderate agreement', className: 'diag-ok', severity: 'moderate' };
  }
  if (Af <= AGREEMENT_LIMITS.appreciable) {
    return { label: 'Appreciable discrepancy', className: 'diag-caution', severity: 'appreciable' };
  }
  return { label: 'Large discrepancy', className: 'diag-alert', severity: 'large' };
}

export function getEvidenceLevel({ setCount = 0, sourceType = 'heldout' } = {}) {
  if (sourceType === 'crossValidation') {
    return {
      label: 'Cross-validation summary',
      className: 'diag-good',
      note: 'Systematic repeated hold-out results summarized across validation splits.',
    };
  }
  if (sourceType === 'external') {
    return {
      label: 'External validation dataset',
      className: 'diag-good',
      note: 'User-marked independent data not used for model calibration.',
    };
  }
  if (sourceType === 'unknown') {
    return {
      label: 'Exploratory diagnostic',
      className: 'diag-caution',
      note: 'Data source was not specified, so the result should be treated as exploratory.',
    };
  }
  if (setCount > 1) {
    return {
      label: 'Multi-condition hold-out check',
      className: 'diag-ok',
      note: 'Multiple held-out conditions were evaluated, but the result remains internal to the calibration data source.',
    };
  }
  if (setCount === 1) {
    return {
      label: 'Single-condition diagnostic',
      className: 'diag-caution',
      note: 'One held-out condition was evaluated; use this as a workflow and bias-direction check.',
    };
  }
  return {
    label: '--',
    className: '',
    note: 'Add validation data to compute diagnostic evidence.',
  };
}

export function resolveValidationTarget({ targetKeys = [], bindings = {}, fittedModels = {} } = {}) {
  const availableTargets = new Set(targetKeys);

  for (const [primaryParamName, fitKey] of Object.entries(bindings ?? {})) {
    if (!fitKey) continue;
    const fit = fittedModels?.[fitKey];
    if (fit?.targetKey && availableTargets.has(fit.targetKey)) {
      return {
        targetKey: fit.targetKey,
        primaryParamName,
        fitKey,
        secondaryModelId: fit.secondaryModelId,
      };
    }
    if (availableTargets.has(primaryParamName)) {
      return {
        targetKey: primaryParamName,
        primaryParamName,
        fitKey,
        secondaryModelId: fit?.secondaryModelId,
      };
    }
  }

  const fallbackTargetKey = targetKeys[0] ?? null;
  return fallbackTargetKey
    ? {
        targetKey: fallbackTargetKey,
        primaryParamName: fallbackTargetKey,
        fitKey: null,
        secondaryModelId: null,
      }
    : null;
}

export function applyHeldOutInitialState({ predictedParams = {}, fittedParams = {}, primaryModel } = {}) {
  const nextParams = { ...predictedParams };
  for (const paramDef of primaryModel?.params ?? []) {
    const isInitialState = paramDef.role === 'state' || paramDef.name === 'logN0';
    const fittedValue = fittedParams[paramDef.name];
    if (isInitialState && Number.isFinite(fittedValue)) {
      nextParams[paramDef.name] = fittedValue;
    }
  }
  return nextParams;
}

export function getValidationTargetLabel({ mode, targetKey } = {}) {
  if (mode === 'curve') return 'log10(N)';
  if (targetKey) return `log10(${targetKey})`;
  return 'log10(parameter)';
}

export function getBiasDirection({ Bf, mode, targetKey } = {}) {
  if (!Number.isFinite(Bf)) return '--';
  const predictedLower = Bf < 1;
  const predictedHigher = Bf > 1;
  if (!predictedLower && !predictedHigher) return 'No directional bias detected';

  if (mode === 'curve') {
    return predictedLower
      ? 'Predicted log10(N) lower than observed on average'
      : 'Predicted log10(N) higher than observed on average';
  }

  if (RESISTANCE_TARGETS.has(targetKey)) {
    return predictedLower
      ? 'Predicted resistance lower than observed'
      : 'Predicted resistance higher than observed';
  }

  return predictedLower
    ? 'Predicted parameter lower than observed'
    : 'Predicted parameter higher than observed';
}

export function getLethalityNote({ Bf, mode, targetKey } = {}) {
  if (mode !== 'parameter' || !RESISTANCE_TARGETS.has(targetKey) || !Number.isFinite(Bf)) return '';
  if (Bf < 1) {
    return 'Lower predicted resistance may overestimate inactivation if used for process-design calculations.';
  }
  if (Bf > 1) {
    return 'Higher predicted resistance may underestimate inactivation and is conservative for lethality calculations.';
  }
  return '';
}

export function interpretValidationMetrics({
  Bf,
  Af,
  RMSE,
  n,
  mode,
  targetKey,
  setCount,
  sourceType,
} = {}) {
  const agreement = classifyDiagnosticAgreement(Af);
  const strictZone = classifyStrictBfZone(Bf);
  const evidence = getEvidenceLevel({ setCount, sourceType });
  const targetLabel = getValidationTargetLabel({ mode, targetKey });
  const biasDirection = getBiasDirection({ Bf, mode, targetKey });
  const lethalityNote = getLethalityNote({ Bf, mode, targetKey });

  return {
    agreement,
    strictZone,
    evidence,
    targetLabel,
    biasDirection,
    lethalityNote,
    foldDifference: isFinitePositive(Af) ? Af : null,
    useNote: evidence.label === 'External validation dataset'
      ? 'Interpret with the stated data source and model assumptions.'
      : 'Use as a diagnostic check, not a full external validation or process-design approval.',
    Bf,
    Af,
    RMSE,
    n,
  };
}
