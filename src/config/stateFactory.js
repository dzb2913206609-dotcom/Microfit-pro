/**
 * Pure function that produces a clean default state for a given mode.
 * Called on mode switch to prevent state bleed between technologies.
 */

export function createDefaultStateForMode(modeConfig) {
  return {
    datasets: [],
    activeDatasetId: null,
    selectedModels: [],
    fitResults: {},
    fittedSecondaryModels: {},
    isFitting: false,
    // CRITICAL: Deep copy to prevent mutating the global config object
    profile: structuredClone(modeConfig.defaultProfile),
    lethalityParams: Object.fromEntries(
      (modeConfig.lethalityMetric.referenceParams || []).map((p) => [
        p.key,
        p.default,
      ])
    ),
    targetValue: modeConfig.lethalityMetric.targetParam?.default ?? null,
  };
}
