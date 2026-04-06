import { MODELS } from './inactivationModels.js';
import { fitRegressionModel } from './fitter.js';

export const FACTOR_DEFS = [
  {
    key: 'temp',
    label: 'Temperature',
    unit: '°C',
    min: 20,
    max: 150,
    step: 1,
    defaultValue: 60,
  },
];

function getFactorValue(factors, key) {
  const value = factors?.[key];
  return Number.isFinite(value) ? value : null;
}

function clampPositive(value, min = 1e-10) {
  return Math.max(value, min);
}

function linearRegression(xs, ys) {
  const n = xs.length;
  if (n === 0) return { a: 0, b: 0 };
  let sumX = 0; let sumY = 0; let sumXY = 0; let sumX2 = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i];
    const y = ys[i];
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (Math.abs(denom) < 1e-12) return { a: sumY / n, b: 0 };
  const b = (n * sumXY - sumX * sumY) / denom;
  const a = (sumY - b * sumX) / n;
  return { a, b };
}

export const SECONDARY_MODELS = {
  BIGELOW: {
    id: 'BIGELOW',
    name: 'Bigelow (z-value model)',
    description: 'Classic z-value model: log D vs. temperature is linear.',
    factorKeys: ['temp'],
    xLabel: 'Temperature T (°C)',
    yLabel: 'log₁₀(D)',
    responseLabel: 'D value',
    params: [
      { name: 'logDref', label: 'log₁₀(D_ref)', defaultValue: 1 },
      { name: 'Tref', label: 'T_ref (°C)', defaultValue: 60 },
      { name: 'z', label: 'z (°C)', defaultValue: 7, min: 0.01 },
    ],
    formula: 'log D = log D_ref - (T - T_ref) / z',
    getX: (factors) => getFactorValue(factors, 'temp'),
    predictY: (factors, { logDref, Tref, z }) => {
      const temp = getFactorValue(factors, 'temp');
      if (!Number.isFinite(temp)) return Number.NaN;
      return logDref - (temp - Tref) / clampPositive(z, 1e-6);
    },
    responseTransforms: ['logD'],
    predictParameterValue: (factors, params) => Math.pow(10, SECONDARY_MODELS.BIGELOW.predictY(factors, params)),
  },
  ARRHENIUS: {
    id: 'ARRHENIUS',
    name: 'Arrhenius',
    description: 'Activation energy model: ln k vs. 1/T is linear.',
    factorKeys: ['temp'],
    xLabel: 'Temperature T (°C)',
    yLabel: 'ln(parameter)',
    responseLabel: 'parameter value',
    params: [
      { name: 'lnA', label: 'ln(A)', defaultValue: 1 },
      { name: 'Ea', label: 'E_a / R (K)', defaultValue: 10000, min: 0 },
    ],
    formula: 'ln y = ln A - E_a / (R·T)',
    getX: (factors) => getFactorValue(factors, 'temp'),
    predictY: (factors, { lnA, Ea }) => {
      const temp = getFactorValue(factors, 'temp');
      if (!Number.isFinite(temp)) return Number.NaN;
      return lnA - Ea / (temp + 273.15);
    },
    responseTransforms: ['lnValue'],
    predictParameterValue: (factors, params) => Math.exp(SECONDARY_MODELS.ARRHENIUS.predictY(factors, params)),
  },
  SQRTMODEL: {
    id: 'SQRTMODEL',
    name: 'Square Root (Ratkowsky)',
    description: 'Square-root model: √parameter vs. temperature is linear.',
    factorKeys: ['temp'],
    xLabel: 'Temperature T (°C)',
    yLabel: '√parameter',
    responseLabel: 'parameter value',
    params: [
      { name: 'b', label: 'b (slope)', defaultValue: 0.1, min: 1e-6 },
      { name: 'Tmin', label: 'T_min (°C)', defaultValue: -10, min: -100, max: 60 },
    ],
    formula: '√y = b · (T - T_min)',
    getX: (factors) => getFactorValue(factors, 'temp'),
    predictY: (factors, { b, Tmin }) => {
      const temp = getFactorValue(factors, 'temp');
      if (!Number.isFinite(temp)) return Number.NaN;
      return b * (temp - Tmin);
    },
    responseTransforms: ['sqrtValue'],
    predictParameterValue: (factors, params) => {
      const root = SECONDARY_MODELS.SQRTMODEL.predictY(factors, params);
      return root ** 2;
    },
  },
  LINEAR: {
    id: 'LINEAR',
    name: 'Linear',
    description: 'Simple linear model: y = a + b·T (no transformation).',
    factorKeys: ['temp'],
    xLabel: 'Temperature T (°C)',
    yLabel: 'parameter',
    responseLabel: 'parameter value',
    params: [
      { name: 'a', label: 'intercept', defaultValue: 1 },
      { name: 'b', label: 'slope', defaultValue: 0 },
    ],
    formula: 'y = a + b·T',
    getX: (factors) => getFactorValue(factors, 'temp'),
    predictY: (factors, { a, b }) => {
      const temp = getFactorValue(factors, 'temp');
      if (!Number.isFinite(temp)) return Number.NaN;
      return a + b * temp;
    },
    responseTransforms: ['identity'],
    predictParameterValue: (factors, params) => SECONDARY_MODELS.LINEAR.predictY(factors, params),
  },
  AVERAGE: {
    id: 'AVERAGE',
    name: 'Average (constant)',
    description: 'Constant fit: y = c (mean-level model).',
    factorKeys: ['temp'],
    xLabel: 'Temperature T (°C)',
    yLabel: 'parameter',
    responseLabel: 'parameter value',
    params: [
      { name: 'c', label: 'c (mean)', defaultValue: 1 },
    ],
    formula: 'y = c',
    getX: (factors) => getFactorValue(factors, 'temp'),
    predictY: (_, { c }) => c,
    responseTransforms: ['identity'],
    predictParameterValue: (_, params) => params.c,
  },
};

export const MODEL_SECONDARY_CONFIG = {
  LOG_LINEAR: {
    factorKeys: ['temp'],
    targets: {
      kmax: {
        label: 'k_max',
        allowedSecondaryModels: ['ARRHENIUS', 'SQRTMODEL'],
        defaultSecondaryModelId: 'ARRHENIUS',
        responseTransform: 'lnValue',
        getValue: (fitResult) => fitResult?.params?.kmax,
      },
      D: {
        label: 'D value',
        allowedSecondaryModels: ['BIGELOW', 'ARRHENIUS', 'SQRTMODEL'],
        defaultSecondaryModelId: 'BIGELOW',
        responseTransformMap: {
          BIGELOW: 'logD',
          ARRHENIUS: 'lnValue',
          SQRTMODEL: 'sqrtValue',
        },
        rateLikeModels: ['ARRHENIUS', 'SQRTMODEL'],
        getValue: (fitResult) => {
          const kmax = fitResult?.params?.kmax;
          return Number.isFinite(kmax) && kmax > 0 ? Math.LN10 / kmax : null;
        },
        mapsToParam: 'kmax',
        invertPredictedValue: (predictedD) => Math.LN10 / clampPositive(predictedD, 1e-6),
      },
    },
  },
  WEIBULL: {
    factorKeys: ['temp'],
    targets: {
      delta: {
        label: 'δ (scale)',
        allowedSecondaryModels: ['ARRHENIUS', 'SQRTMODEL'],
        defaultSecondaryModelId: 'ARRHENIUS',
        responseTransformMap: {
          ARRHENIUS: 'lnValue',
          SQRTMODEL: 'sqrtValue',
        },
        rateLikeModels: ['ARRHENIUS', 'SQRTMODEL'],
        getValue: (fitResult) => fitResult?.params?.delta,
      },
      p: {
        label: 'p (shape)',
        allowedSecondaryModels: ['LINEAR', 'AVERAGE'],
        defaultSecondaryModelId: 'LINEAR',
        responseTransformMap: {
          LINEAR: 'identity',
          AVERAGE: 'identity',
        },
        rateLikeModels: [],
        getValue: (fitResult) => fitResult?.params?.p,
      },
    },
  },
};

export function getAvailablePrimaryModels() {
  return Object.keys(MODEL_SECONDARY_CONFIG)
    .map((modelId) => MODELS[modelId])
    .filter(Boolean);
}

export function getFactorDefs(keys = FACTOR_DEFS.map((factor) => factor.key)) {
  return FACTOR_DEFS.filter((factor) => keys.includes(factor.key));
}

export function getSecondaryModelList(ids = Object.keys(SECONDARY_MODELS)) {
  return ids.map((id) => SECONDARY_MODELS[id]).filter(Boolean);
}

function transformResponse(value, transform) {
  if (!Number.isFinite(value)) return null;
  if (transform === 'identity') return value;
  if (value <= 0) return null;
  if (transform === 'logD') return Math.log10(value);
  if (transform === 'lnValue') return Math.log(value);
  if (transform === 'sqrtValue') return Math.sqrt(value);
  return value;
}

function resolveTransform(config, secondaryModelId) {
  if (config.responseTransformMap && secondaryModelId) {
    return config.responseTransformMap[secondaryModelId] ?? config.responseTransform ?? 'identity';
  }
  return config.responseTransform ?? 'identity';
}

function isRateLike(config, secondaryModelId) {
  return !!config?.rateLikeModels?.includes?.(secondaryModelId);
}

function toFitValue(rawValue, config, secondaryModelId) {
  if (!Number.isFinite(rawValue)) return null;
  if (isRateLike(config, secondaryModelId)) {
    const inv = 1 / rawValue;
    if (!Number.isFinite(inv) || inv <= 0) return null;
    return inv;
  }
  return rawValue;
}

function fromFitValue(fitValue, config, secondaryModelId) {
  if (!Number.isFinite(fitValue)) return null;
  if (isRateLike(config, secondaryModelId)) {
    const inv = 1 / fitValue;
    if (!Number.isFinite(inv) || inv <= 0) return null;
    return inv;
  }
  return fitValue;
}

function predictRawParameterValue({ secondaryModelId, params, factors, targetConfig }) {
  const model = SECONDARY_MODELS[secondaryModelId];
  if (!model) return null;
  const fitSpaceValue = model.predictParameterValue(factors, params);
  return fromFitValue(fitSpaceValue, targetConfig, secondaryModelId);
}

function estimateInitialParams(secondaryModelId, rows) {
  if (!rows.length) return null;
  const xs = rows.map((r) => r.x);
  const ys = rows.map((r) => r.y);
  const { a, b } = linearRegression(xs, ys);

  if (secondaryModelId === 'ARRHENIUS') {
    // ln y = lnA - Ea / T_K => regress y vs 1/T_K
    const invT = rows.map((r) => 1 / (r.x + 273.15));
    const { a: a2, b: b2 } = linearRegression(invT, ys);
    const lnA = a2;
    const Ea = Math.max(-b2, 1e-6);
    return { lnA, Ea };
  }

  if (secondaryModelId === 'SQRTMODEL') {
    // y = b*(T - Tmin) => y = b*T - b*Tmin
    const bHat = Math.max(b, 1e-6);
    const Tmin = -a / Math.max(bHat, 1e-6);
    return { b: bHat, Tmin: Math.min(60, Math.max(-100, Tmin)) };
  }

  if (secondaryModelId === 'LINEAR') {
    return { a, b };
  }

  if (secondaryModelId === 'AVERAGE') {
    const mean = ys.reduce((s, v) => s + v, 0) / ys.length;
    return { c: mean };
  }

  if (secondaryModelId === 'BIGELOW') {
    // logD vs T: y = logDref - (T - Tref)/z -> y = (-1/z)T + (logDref + Tref/z)
    const z = Math.max(-1 / b, 1e-3);
    const logDref = a + (rows[0]?.x ?? 60) / z;
    return { logDref, Tref: rows[0]?.x ?? 60, z };
  }

  return null;
}

export function buildSecondaryRows({ datasets, fitResults, primaryModelId, targetKey, secondaryModelId }) {
  const config = MODEL_SECONDARY_CONFIG[primaryModelId]?.targets?.[targetKey];
  if (!config) return [];

  const transform = resolveTransform(config, secondaryModelId);

  return datasets.flatMap((dataset) => {
    const factorValue = getFactorValue(dataset.conditions, 'temp');
    const fitResult = fitResults[`${dataset.id}_${primaryModelId}`];
    const rawValue = config.getValue(fitResult);
    const fitValue = toFitValue(rawValue, config, secondaryModelId);
    const transformedValue = transformResponse(fitValue, transform);

    if (!Number.isFinite(factorValue) || !Number.isFinite(rawValue) || !Number.isFinite(fitValue) || !Number.isFinite(transformedValue)) {
      return [];
    }

    return [{
      datasetId: dataset.id,
      datasetName: dataset.name,
      factors: dataset.conditions ?? {},
      x: factorValue,
      rawValue,
      fitValue,
      y: transformedValue,
      primaryModelId,
      targetKey,
    }];
  });
}

export function fitSecondaryModel(secondaryModelId, rows, customInit = null) {
  const model = SECONDARY_MODELS[secondaryModelId];
  if (!model || rows.length < 2) return null;

  const initGuess = customInit ?? estimateInitialParams(secondaryModelId, rows);

  const result = fitRegressionModel({
    modelFn: (_, params, row) => model.predictY(row.factors, params),
    paramDefs: model.params,
    data: rows,
    getX: (row) => row.x,
    getY: (row) => row.y,
    customInit: initGuess,
  });

  if (!result) return null;

  return {
    ...result,
    curve: buildSecondaryCurve(secondaryModelId, result.params, rows, model, MODEL_SECONDARY_CONFIG),
    rows,
  };
}

export function buildSecondaryCurve(secondaryModelId, params, rows, modelOverride = null, configOverride = null, pointCount = 100) {
  const model = modelOverride || SECONDARY_MODELS[secondaryModelId];
  if (!model || !rows.length) return [];

  const temps = rows.map((row) => row.x);
  const min = Math.min(...temps);
  const max = Math.max(...temps);
  const span = Math.max(max - min, 1);
  const start = min - span * 0.05;
  const end = max + span * 0.05;

  const primaryId = rows[0]?.primaryModelId;
  const targetKey = rows[0]?.targetKey;
  const cfg = primaryId && targetKey ? configOverride?.[primaryId]?.targets?.[targetKey] : null;

  return Array.from({ length: pointCount }, (_, index) => {
    const temp = start + ((end - start) * index) / Math.max(pointCount - 1, 1);
    const factors = { temp };
    const yFit = model.predictY(factors, params);
    const rawValue = cfg ? predictRawParameterValue({ secondaryModelId, params, factors, targetConfig: cfg }) : model.predictParameterValue(factors, params);
    return {
      x: temp,
      y: yFit,
      rawValue,
      primaryModelId: primaryId,
      targetKey,
    };
  });
}

export function createDefaultFactorState(factorKeys) {
  return getFactorDefs(factorKeys).reduce((acc, factor) => {
    acc[factor.key] = factor.defaultValue;
    return acc;
  }, {});
}

export function predictPrimaryParams({ primaryModelId, bindings, fittedSecondaryModels, manualParams, factors }) {
  const primaryModel = MODELS[primaryModelId];
  if (!primaryModel) return null;

  const predictedParams = {};

  primaryModel.params.forEach((paramDef) => {
    const binding = bindings?.[paramDef.name];
    const fitted = binding ? fittedSecondaryModels?.[binding] : null;

    if (binding && fitted?.params) {
      const secondaryModel = SECONDARY_MODELS[fitted.secondaryModelId];
      const configTarget = MODEL_SECONDARY_CONFIG[primaryModelId]?.targets?.[fitted.targetKey];
      if (secondaryModel && configTarget) {
        const predictedFitValue = secondaryModel.predictParameterValue(factors, fitted.params);
        const rawPredicted = fromFitValue(predictedFitValue, configTarget, fitted.secondaryModelId);
        const finalValue = configTarget.invertPredictedValue
          ? configTarget.invertPredictedValue(rawPredicted)
          : rawPredicted;
        predictedParams[paramDef.name] = finalValue;
        return;
      }
    }

    predictedParams[paramDef.name] = manualParams?.[paramDef.name] ?? paramDef.defaultValue;
  });

  return predictedParams;
}
