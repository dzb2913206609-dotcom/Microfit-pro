/**
 * Microbial Inactivation Models
 * Based on GInaFiT (Geeraerd et al., 2005) and extended with additional models.
 *
 * All models return log10(N) given time t and parameters.
 */

function clampPositive(value, min = 1e-10) {
  return Math.max(value, min);
}

function withPositiveMeta(param, meta = {}) {
  return { ...param, ...meta };
}

export const MODELS = {
  LOG_LINEAR: {
    id: 'LOG_LINEAR',
    name: 'Log-linear (Bigelow)',
    shape: 'Shape I',
    description: 'Classic first-order kinetics; all cells equally sensitive.',
    secondaryTargets: ['kmax'],
    params: [
      withPositiveMeta({ name: 'logN0', label: 'log₁₀(N₀)', defaultValue: 7, description: 'Initial cell concentration (log scale)' }, { role: 'state' }),
      withPositiveMeta({ name: 'kmax', label: 'k_max (1/min)', defaultValue: 0.5, min: 0.001, description: 'First-order inactivation rate constant' }, { role: 'rate', positive: true }),
    ],
    formula: 'log₁₀(N) = log₁₀(N₀) - k_max·t / ln(10)',
    fn: (t, { logN0, kmax }) => logN0 - (clampPositive(kmax, 1e-6) * t) / Math.LN10,
  },

  LOG_LINEAR_TAIL: {
    id: 'LOG_LINEAR_TAIL',
    name: 'Log-linear + Tail',
    shape: 'Shape II',
    description: 'First-order kinetics with a resistant sub-population (tail).',
    secondaryTargets: ['kmax'],
    params: [
      withPositiveMeta({ name: 'logN0', label: 'log₁₀(N₀)', defaultValue: 7, description: 'Initial cell concentration (log scale)' }, { role: 'state' }),
      withPositiveMeta({ name: 'kmax', label: 'k_max (1/min)', defaultValue: 0.5, min: 0.001 }, { role: 'rate', positive: true }),
      withPositiveMeta({ name: 'logNres', label: 'log₁₀(N_res)', defaultValue: 1, description: 'Residual resistant sub-population (log scale)' }, { role: 'residual' }),
    ],
    formula: 'log₁₀(N) = log(e^(logN0·ln10) · e^(-kmax·t) + e^(logNres·ln10)) / ln(10)',
    fn: (t, { logN0, kmax, logNres }) => {
      const N0 = Math.pow(10, logN0);
      const Nres = Math.pow(10, logNres);
      return Math.log10(clampPositive(N0 * Math.exp(-clampPositive(kmax, 1e-6) * t) + Nres));
    },
  },

  SHOULDER_TAIL: {
    id: 'SHOULDER_TAIL',
    name: 'Shoulder + Tail (Geeraerd)',
    shape: 'Shape III',
    description: 'Sigmoidal curve with a shoulder lag and a tailing resistant sub-population.',
    secondaryTargets: ['kmax', 'Sl'],
    params: [
      withPositiveMeta({ name: 'logN0', label: 'log₁₀(N₀)', defaultValue: 7 }, { role: 'state' }),
      withPositiveMeta({ name: 'kmax', label: 'k_max (1/min)', defaultValue: 0.5, min: 0.001 }, { role: 'rate', positive: true }),
      withPositiveMeta({ name: 'logNres', label: 'log₁₀(N_res)', defaultValue: 1 }, { role: 'residual' }),
      withPositiveMeta({ name: 'Sl', label: 'S_L (shoulder length, min)', defaultValue: 2, min: 0 }, { role: 'time', nonNegative: true }),
    ],
    formula: 'Geeraerd et al. 2000: log(N) = log((N0-Nres)·e^(-kmax·t)·(1+Cc)/(1+Cc·e^(-kmax·t)) + Nres)',
    fn: (t, { logN0, kmax, logNres, Sl }) => {
      const N0 = Math.pow(10, logN0);
      const Nres = Math.pow(10, logNres);
      const safeK = clampPositive(kmax, 1e-6);
      const cc = Math.exp(safeK * Math.max(Sl, 0)) - 1;
      const N = (N0 - Nres) * Math.exp(-safeK * t) * (1 + cc) / (1 + cc * Math.exp(-safeK * t)) + Nres;
      return Math.log10(clampPositive(N));
    },
  },

  SHOULDER_NOTAIL: {
    id: 'SHOULDER_NOTAIL',
    name: 'Linear + Shoulder (Geeraerd)',
    shape: 'Shape IV',
    description: 'First-order kinetics with a shoulder lag; no tailing.',
    secondaryTargets: ['kmax', 'Sl'],
    params: [
      withPositiveMeta({ name: 'logN0', label: 'log₁₀(N₀)', defaultValue: 7 }, { role: 'state' }),
      withPositiveMeta({ name: 'kmax', label: 'k_max (1/min)', defaultValue: 0.5, min: 0.001 }, { role: 'rate', positive: true }),
      withPositiveMeta({ name: 'Sl', label: 'S_L (shoulder length, min)', defaultValue: 2, min: 0 }, { role: 'time', nonNegative: true }),
    ],
    formula: 'log₁₀(N) = logN0 - kmax/ln10 · [t + 1/kmax·ln((1+C_c·e^(-kmax·t))/(1+C_c))]',
    fn: (t, { logN0, kmax, Sl }) => {
      const safeK = clampPositive(kmax, 1e-6);
      const cc = Math.exp(safeK * Math.max(Sl, 0)) - 1;
      return logN0 - (safeK / Math.LN10) * (t + (1 / safeK) * Math.log((1 + cc * Math.exp(-safeK * t)) / (1 + cc)));
    },
  },

  WEIBULL: {
    id: 'WEIBULL',
    name: 'Weibull (Mafart / Peleg-Cole)',
    shape: 'Shape VI/VIII',
    description: 'Shape parameter p < 1 gives concave, p > 1 gives convex curvature.',
    secondaryTargets: ['delta', 'p'],
    params: [
      withPositiveMeta({ name: 'logN0', label: 'log₁₀(N₀)', defaultValue: 7 }, { role: 'state' }),
      withPositiveMeta({ name: 'delta', label: 'δ (scale, min)', defaultValue: 5, min: 0.001, description: 'Characteristic time for 1-log reduction' }, { role: 'timeScale', positive: true }),
      withPositiveMeta({ name: 'p', label: 'p (shape)', defaultValue: 1, min: 0.01, description: 'p < 1 concave, p = 1 linear, p > 1 convex' }, { role: 'shape', positive: true }),
    ],
    formula: 'log₁₀(N) = logN0 - (t/δ)^p',
    fn: (t, { logN0, delta, p }) => logN0 - Math.pow(t / clampPositive(delta, 1e-6), clampPositive(p, 1e-6)),
  },

  WEIBULL_TAIL: {
    id: 'WEIBULL_TAIL',
    name: 'Weibull + Tail (Albert & Mafart)',
    shape: 'Shape IX',
    description: 'Weibull model with a tailing resistant sub-population.',
    secondaryTargets: ['delta', 'p'],
    params: [
      withPositiveMeta({ name: 'logN0', label: 'log₁₀(N₀)', defaultValue: 7 }, { role: 'state' }),
      withPositiveMeta({ name: 'delta', label: 'δ (scale, min)', defaultValue: 5, min: 0.001 }, { role: 'timeScale', positive: true }),
      withPositiveMeta({ name: 'p', label: 'p (shape)', defaultValue: 1.5, min: 0.01 }, { role: 'shape', positive: true }),
      withPositiveMeta({ name: 'logNres', label: 'log₁₀(N_res)', defaultValue: 1 }, { role: 'residual' }),
    ],
    formula: 'log₁₀(N) = logNres + log(1 + (10^(logN0-logNres) - 1)·exp(-(t/δ)^p·ln10))',
    fn: (t, { logN0, delta, p, logNres }) => {
      const N0 = Math.pow(10, logN0);
      const Nres = Math.pow(10, logNres);
      return Math.log10(clampPositive(Nres + (N0 - Nres) * Math.exp(-Math.pow(t / clampPositive(delta, 1e-6), clampPositive(p, 1e-6)) * Math.LN10)));
    },
  },

  BIPHASIC: {
    id: 'BIPHASIC',
    name: 'Biphasic (Cerf)',
    shape: 'Shape V',
    description: 'Two sub-populations with different inactivation rates.',
    secondaryTargets: ['kmax1', 'kmax2'],
    params: [
      withPositiveMeta({ name: 'logN0', label: 'log₁₀(N₀)', defaultValue: 7 }, { role: 'state' }),
      withPositiveMeta({ name: 'kmax1', label: 'k₁ (sensitive, 1/min)', defaultValue: 1.0, min: 0.001 }, { role: 'rate', positive: true }),
      withPositiveMeta({ name: 'kmax2', label: 'k₂ (resistant, 1/min)', defaultValue: 0.1, min: 0.001 }, { role: 'rate', positive: true }),
      withPositiveMeta({ name: 'f', label: 'f (fraction sensitive, 0–1)', defaultValue: 0.9, min: 0.001, max: 0.999 }, { role: 'fraction', bounded: true }),
    ],
    formula: 'log₁₀(N) = log₁₀(N₀·[f·e^(-k₁t) + (1-f)·e^(-k₂t)])',
    fn: (t, { logN0, kmax1, kmax2, f }) => {
      const N0 = Math.pow(10, logN0);
      return Math.log10(clampPositive(N0 * (f * Math.exp(-clampPositive(kmax1, 1e-6) * t) + (1 - f) * Math.exp(-clampPositive(kmax2, 1e-6) * t))));
    },
  },

  BIPHASIC_SHOULDER: {
    id: 'BIPHASIC_SHOULDER',
    name: 'Biphasic + Shoulder (Geeraerd)',
    shape: 'Shape VII',
    description: 'Most complex shape: biphasic kinetics with a shoulder lag.',
    secondaryTargets: ['kmax1', 'kmax2', 'Sl'],
    params: [
      withPositiveMeta({ name: 'logN0', label: 'log₁₀(N₀)', defaultValue: 7 }, { role: 'state' }),
      withPositiveMeta({ name: 'kmax1', label: 'k₁ (1/min)', defaultValue: 1.0, min: 0.001 }, { role: 'rate', positive: true }),
      withPositiveMeta({ name: 'kmax2', label: 'k₂ (1/min)', defaultValue: 0.1, min: 0.001 }, { role: 'rate', positive: true }),
      withPositiveMeta({ name: 'f', label: 'f (fraction sensitive)', defaultValue: 0.9, min: 0.001, max: 0.999 }, { role: 'fraction', bounded: true }),
      withPositiveMeta({ name: 'Sl', label: 'S_L (shoulder length, min)', defaultValue: 2, min: 0 }, { role: 'time', nonNegative: true }),
    ],
    formula: 'Biphasic with Geeraerd shoulder correction',
    fn: (t, { logN0, kmax1, kmax2, f, Sl }) => {
      const N0 = Math.pow(10, logN0);
      const safeK1 = clampPositive(kmax1, 1e-6);
      const cc = Math.exp(safeK1 * Math.max(Sl, 0)) - 1;
      const shoulderFactor = (1 + cc) / (1 + cc * Math.exp(-safeK1 * t));
      const N = N0 * (f * Math.exp(-safeK1 * t) * shoulderFactor + (1 - f) * Math.exp(-clampPositive(kmax2, 1e-6) * t));
      return Math.log10(clampPositive(N));
    },
  },

  MIXED_WEIBULL: {
    id: 'MIXED_WEIBULL',
    name: 'Mixed Weibull (Coroller)',
    shape: 'Shape X',
    description: 'Superposition of two Weibull distributions; double concave/convex.',
    secondaryTargets: ['delta1', 'p1', 'delta2', 'p2'],
    params: [
      withPositiveMeta({ name: 'logN0', label: 'log₁₀(N₀)', defaultValue: 7 }, { role: 'state' }),
      withPositiveMeta({ name: 'delta1', label: 'δ₁ (min)', defaultValue: 3, min: 0.001 }, { role: 'timeScale', positive: true }),
      withPositiveMeta({ name: 'p1', label: 'p₁', defaultValue: 2, min: 0.01 }, { role: 'shape', positive: true }),
      withPositiveMeta({ name: 'delta2', label: 'δ₂ (min)', defaultValue: 15, min: 0.001 }, { role: 'timeScale', positive: true }),
      withPositiveMeta({ name: 'p2', label: 'p₂', defaultValue: 0.5, min: 0.01 }, { role: 'shape', positive: true }),
      withPositiveMeta({ name: 'f', label: 'f (fraction of first sub-pop.)', defaultValue: 0.9, min: 0.001, max: 0.999 }, { role: 'fraction', bounded: true }),
    ],
    formula: 'log₁₀(N) = log₁₀(N₀·[f·exp(-(t/δ₁)^p₁·ln10) + (1-f)·exp(-(t/δ₂)^p₂·ln10)])',
    fn: (t, { logN0, delta1, p1, delta2, p2, f }) => {
      const N0 = Math.pow(10, logN0);
      const part1 = f * Math.exp(-Math.pow(t / clampPositive(delta1, 1e-6), clampPositive(p1, 1e-6)) * Math.LN10);
      const part2 = (1 - f) * Math.exp(-Math.pow(t / clampPositive(delta2, 1e-6), clampPositive(p2, 1e-6)) * Math.LN10);
      return Math.log10(clampPositive(N0 * (part1 + part2)));
    },
  },

  GOMPERTZ: {
    id: 'GOMPERTZ',
    name: 'Modified Gompertz',
    shape: 'Sigmoid',
    description: 'Modified Gompertz sigmoidal curve with shoulder and tailing.',
    secondaryTargets: ['mu', 'lambda'],
    params: [
      withPositiveMeta({ name: 'logN0', label: 'log₁₀(N₀)', defaultValue: 7 }, { role: 'state' }),
      withPositiveMeta({ name: 'A', label: 'A (max reduction, log)', defaultValue: 5, min: 0.01 }, { role: 'amplitude', positive: true }),
      withPositiveMeta({ name: 'mu', label: 'μ (max inactivation rate)', defaultValue: 1, min: 0.001 }, { role: 'rate', positive: true }),
      withPositiveMeta({ name: 'lambda', label: 'λ (shoulder length, min)', defaultValue: 2, min: 0 }, { role: 'time', nonNegative: true }),
    ],
    formula: 'log₁₀(N) = logN0 - A·exp(-exp(μ·e/A·(λ-t)+1))',
    fn: (t, { logN0, A, mu, lambda }) => {
      const safeA = clampPositive(A, 1e-6);
      return logN0 - safeA * Math.exp(-Math.exp((clampPositive(mu, 1e-6) * Math.E) / safeA * (Math.max(lambda, 0) - t) + 1));
    },
  },

  BARANYI: {
    id: 'BARANYI',
    name: 'Baranyi Inactivation',
    shape: 'Sigmoid',
    description: 'Baranyi & Roberts framework adapted for inactivation; includes physiological state parameter.',
    secondaryTargets: ['kmax', 'h0'],
    params: [
      withPositiveMeta({ name: 'logN0', label: 'log₁₀(N₀)', defaultValue: 7 }, { role: 'state' }),
      withPositiveMeta({ name: 'kmax', label: 'k_max (1/min)', defaultValue: 0.5, min: 0.001 }, { role: 'rate', positive: true }),
      withPositiveMeta({ name: 'logNmin', label: 'log₁₀(N_min)', defaultValue: 0, description: 'Minimum survival concentration' }, { role: 'minimum' }),
      withPositiveMeta({ name: 'h0', label: 'h₀ (physiological state)', defaultValue: 1, min: 0 }, { role: 'stateModifier', nonNegative: true }),
    ],
    formula: 'Baranyi inactivation with adjustment function',
    fn: (t, { logN0, kmax, logNmin, h0 }) => {
      const safeK = clampPositive(kmax, 1e-6);
      const safeH0 = Math.max(h0, 0);
      const A = t + (1 / safeK) * Math.log(Math.exp(-safeK * t) + Math.exp(-safeH0) - Math.exp(-safeK * t - safeH0));
      const Nmin = Math.pow(10, logNmin);
      const N0 = Math.pow(10, logN0);
      return Math.log10(clampPositive(Nmin + (N0 - Nmin) * Math.exp(-safeK * A)));
    },
  },
};

export const getModelList = () => Object.values(MODELS);

export function predictCurve(modelId, params, tMax, nPoints = 200) {
  const model = MODELS[modelId];
  if (!model) return [];
  const points = [];
  for (let i = 0; i <= nPoints; i++) {
    const t = (tMax * i) / nPoints;
    const logN = model.fn(t, params);
    points.push({ t, logN: Number.isFinite(logN) ? logN : null });
  }
  return points;
}
