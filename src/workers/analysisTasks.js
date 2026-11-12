import { MODELS } from '../models/inactivationModels.js';
import { predictPrimaryParams } from '../models/secondaryModels.js';
import { runMonteCarloFromPredicted, runMonteCarloWithFactors, secondaryUncertainParamNames } from '../models/monteCarlo.js';
import { computeMorris, computeSobolTotal } from '../models/sensitivityAnalysis.js';
import { createSeededRng, deriveSeed } from '../utils/random.js';

// Reconstruct closures in the worker; only data crosses the thread boundary.
export function executeAnalysisTask(type, config) {
  const model = MODELS[config.modelId];
  if (!model) throw new Error(`Unknown primary model: ${config.modelId}`);
  const predict = fittedSecondaryModels => factors => predictPrimaryParams({
    primaryModelId: config.modelId, primaryFactorKey: config.primaryFactorKey,
    bindings: config.bindings, fittedSecondaryModels, manualParams: config.manualParams, factors,
  });
  const args = { ...config, modelFn: model.fn, paramNames: model.params.map(p => p.name) };
  const hasFactorInfo = config.factorKeys?.length > 0 && config.factorValues && config.bindings;
  if (type === 'monteCarlo') {
    const hasFactorSD = hasFactorInfo && config.factorKeys.some(key => (config.factorSDs[key] || 0) > 0);
    const hasSecondaryUncertainty = config.factorValues && Object.values(config.bindings ?? {}).some(
      key => secondaryUncertainParamNames(config.fittedSecondaryModels?.[key]).length > 0,
    );
    args.rng = createSeededRng(config.seed);
    return hasFactorSD || hasSecondaryUncertainty
      ? runMonteCarloWithFactors({ ...args, factorKeys: config.factorKeys ?? [],
        predictParamsFn: predict(config.fittedSecondaryModels), predictParamsFnFactory: predict })
      : runMonteCarloFromPredicted(args);
  }
  args.predictParamsFn = hasFactorInfo && config.fittedSecondaryModels ? predict(config.fittedSecondaryModels) : null;
  args.predictParamsFnFactory = hasFactorInfo && config.fittedSecondaryModels ? predict : null;
  if (type === 'morris') return computeMorris({ ...args, rng: createSeededRng(deriveSeed(config.seed, 'morris')) });
  if (type === 'sobol') return computeSobolTotal({ ...args, rng: createSeededRng(deriveSeed(config.seed, `sobol-${config.N}`)) });
  throw new Error(`Unknown analysis task: ${type}`);
}
