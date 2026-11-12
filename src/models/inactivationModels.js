/**
 * Microbial Inactivation Models
 * Based on GInaFiT (Geeraerd et al., 2005) and extended with additional models.
 *
 * All models return log10(N) given time t and parameters.
 */

function clampPositive(value, min = 1e-10) {
  // Unit conversion can make a valid positive rate arbitrarily small.
  // Keep it exactly; the fallback applies only to nonpositive parameters.
  return value > 0 ? value : Math.max(value, min);
}

function withPositiveMeta(param, meta = {}) {
  return { ...param, ...meta };
}

// Work in log space so small populations and large shoulders do not create
// artificial survival floors, overflow, or Infinity / Infinity expressions.
function logAddExp(a, b) {
  if (a === -Infinity) return b;
  if (b === -Infinity) return a;
  const hi = Math.max(a, b);
  return hi + Math.log1p(Math.exp(Math.min(a, b) - hi));
}

function logShoulderSurvival(kt, h) {
  if (h === 0) return -kt;
  const logOneMinusQ = Math.log(-Math.expm1(-h));
  return -logAddExp(logOneMinusQ, kt - h);
}

function logPopulationWithResidual(logN0, logNres, logSurvival) {
  if (!Number.isFinite(logN0) || !Number.isFinite(logNres) || logNres > logN0) return NaN;
  if (logNres === logN0) return logN0;
  const lnN0 = logN0 * Math.LN10;
  const lnRes = logNres * Math.LN10;
  const lnSensitive = lnN0 + Math.log(-Math.expm1(lnRes - lnN0));
  return logAddExp(lnRes, lnSensitive + logSurvival) / Math.LN10;
}

export const MODELS = {
  LOG_LINEAR: {
    id: 'LOG_LINEAR',
    name: 'Log-linear',
    shape: 'Shape I',
    description: 'Classic first-order kinetics; all cells equally sensitive.',
    secondaryTargets: ['kmax'],
    params: [
      withPositiveMeta({ name: 'logN0', label: 'log₁₀(N₀)', defaultValue: 7, description: 'Initial cell concentration (log scale)' }, { role: 'state' }),
      withPositiveMeta({ name: 'kmax', label: 'k_max (1/min)', defaultValue: 0.5, min: 0.001, description: 'First-order inactivation rate constant' }, { role: 'rate', positive: true }),
    ],
    formula: '\\log_{10}(N) = \\log_{10}(N_0) - \\dfrac{k_{\\max}\\, t}{\\ln 10}',
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
      withPositiveMeta({ name: 'logNres', label: 'log₁₀(N_res)', defaultValue: 1, min: -20, description: 'Residual resistant sub-population (log scale)' }, { role: 'residual' }),
    ],
    formula: '\\log_{10}(N) = \\log_{10}\\!\\left((N_0-N_{\\mathrm{res}})\\, e^{-k_{\\max} t} + N_{\\mathrm{res}}\\right)',
    fn: (t, { logN0, kmax, logNres }) => {
      return logPopulationWithResidual(logN0, logNres, -clampPositive(kmax, 1e-6) * t);
    },
  },

  SHOULDER_TAIL: {
    id: 'SHOULDER_TAIL',
    name: 'Shoulder + Tail',
    shape: 'Shape III',
    description: 'Sigmoidal curve with a shoulder lag and a tailing resistant sub-population.',
    secondaryTargets: ['kmax', 'Sl'],
    params: [
      withPositiveMeta({ name: 'logN0', label: 'log₁₀(N₀)', defaultValue: 7 }, { role: 'state' }),
      withPositiveMeta({ name: 'kmax', label: 'k_max (1/min)', defaultValue: 0.5, min: 0.001 }, { role: 'rate', positive: true }),
      withPositiveMeta({ name: 'logNres', label: 'log₁₀(N_res)', defaultValue: 1, min: -20 }, { role: 'residual' }),
      withPositiveMeta({ name: 'Sl', label: 'S_L (shoulder length, min)', defaultValue: 2, min: 0 }, { role: 'time', nonNegative: true }),
    ],
    formula: '\\log_{10}(N) = \\log_{10}\\!\\left((N_0-N_{\\mathrm{res}})\\,e^{-k_{\\max}t}\\,\\frac{1+C_c}{1+C_c\\,e^{-k_{\\max}t}}+N_{\\mathrm{res}}\\right)',
    formulaNote: '\\text{where } C_c = e^{k_{\\max} S_L} - 1',
    fn: (t, { logN0, kmax, logNres, Sl }) => {
      const safeK = clampPositive(kmax, 1e-6);
      return logPopulationWithResidual(logN0, logNres, logShoulderSurvival(safeK * t, safeK * Math.max(Sl, 0)));
    },
  },

  SHOULDER_NOTAIL: {
    id: 'SHOULDER_NOTAIL',
    name: 'Linear + Shoulder',
    shape: 'Shape IV',
    description: 'First-order kinetics with a shoulder lag; no tailing.',
    secondaryTargets: ['kmax', 'Sl'],
    params: [
      withPositiveMeta({ name: 'logN0', label: 'log₁₀(N₀)', defaultValue: 7 }, { role: 'state' }),
      withPositiveMeta({ name: 'kmax', label: 'k_max (1/min)', defaultValue: 0.5, min: 0.001 }, { role: 'rate', positive: true }),
      withPositiveMeta({ name: 'Sl', label: 'S_L (shoulder length, min)', defaultValue: 2, min: 0 }, { role: 'time', nonNegative: true }),
    ],
    formula: '\\log_{10}(N) = \\log_{10}(N_0) - \\dfrac{k_{\\max}}{\\ln 10}\\left[t + \\dfrac{1}{k_{\\max}}\\ln\\dfrac{1+C_c\\,e^{-k_{\\max}t}}{1+C_c}\\right]',
    formulaNote: '\\text{where } C_c = e^{k_{\\max} S_L} - 1',
    fn: (t, { logN0, kmax, Sl }) => {
      const safeK = clampPositive(kmax, 1e-6);
      return logN0 + logShoulderSurvival(safeK * t, safeK * Math.max(Sl, 0)) / Math.LN10;
    },
  },

  WEIBULL: {
    id: 'WEIBULL',
    name: 'Weibull',
    shape: 'Shape VI/VIII',
    description: 'Shape parameter p < 1 gives concave, p > 1 gives convex curvature.',
    secondaryTargets: ['delta', 'p'],
    params: [
      withPositiveMeta({ name: 'logN0', label: 'log₁₀(N₀)', defaultValue: 7 }, { role: 'state' }),
      withPositiveMeta({ name: 'delta', label: 'δ (scale, min)', defaultValue: 5, min: 0.001, description: 'Characteristic time for 1-log reduction' }, { role: 'timeScale', positive: true }),
      withPositiveMeta({ name: 'p', label: 'p (shape)', defaultValue: 1, min: 0.01, description: 'p < 1 concave, p = 1 linear, p > 1 convex' }, { role: 'shape', positive: true }),
    ],
    formula: '\\log_{10}(N) = \\log_{10}(N_0) - \\left(\\dfrac{t}{\\delta}\\right)^{p}',
    fn: (t, { logN0, delta, p }) => logN0 - Math.pow(Math.max(t, 0) / clampPositive(delta, 1e-6), clampPositive(p, 1e-6)),
  },

  WEIBULL_TAIL: {
    id: 'WEIBULL_TAIL',
    name: 'Weibull + Tail',
    shape: 'Shape IX',
    description: 'Weibull model with a tailing resistant sub-population.',
    secondaryTargets: ['delta', 'p'],
    params: [
      withPositiveMeta({ name: 'logN0', label: 'log₁₀(N₀)', defaultValue: 7 }, { role: 'state' }),
      withPositiveMeta({ name: 'delta', label: 'δ (scale, min)', defaultValue: 5, min: 0.001 }, { role: 'timeScale', positive: true }),
      withPositiveMeta({ name: 'p', label: 'p (shape)', defaultValue: 1.5, min: 0.01 }, { role: 'shape', positive: true }),
      withPositiveMeta({ name: 'logNres', label: 'log₁₀(N_res)', defaultValue: 1, min: -20 }, { role: 'residual' }),
    ],
    formula: '\\log_{10}(N) = \\log_{10}(N_{\\mathrm{res}}) + \\log_{10}\\!\\left(1 + \\left(10^{\\log_{10}N_0 - \\log_{10}N_{\\mathrm{res}}}-1\\right)e^{-\\left(t/\\delta\\right)^p \\ln 10}\\right)',
    fn: (t, { logN0, delta, p, logNres }) => {
      return logPopulationWithResidual(logN0, logNres, -Math.pow(Math.max(t, 0) / clampPositive(delta, 1e-6), clampPositive(p, 1e-6)) * Math.LN10);
    },
  },

  BIPHASIC: {
    id: 'BIPHASIC',
    name: 'Biphasic',
    shape: 'Shape V',
    description: 'Two sub-populations with different inactivation rates.',
    secondaryTargets: ['kmax1', 'kmax2'],
    params: [
      withPositiveMeta({ name: 'logN0', label: 'log₁₀(N₀)', defaultValue: 7 }, { role: 'state' }),
      withPositiveMeta({ name: 'kmax1', label: 'k₁ (sensitive, 1/min)', defaultValue: 1.0, min: 0.001 }, { role: 'rate', positive: true }),
      withPositiveMeta({ name: 'kmax2', label: 'k₂ (resistant, 1/min)', defaultValue: 0.1, min: 0.001 }, { role: 'rate', positive: true }),
      withPositiveMeta({ name: 'f', label: 'f (fraction sensitive, 0–1)', defaultValue: 0.9, min: 0.001, max: 0.999 }, { role: 'fraction', bounded: true }),
    ],
    formula: '\\log_{10}(N) = \\log_{10}\\!\\left(N_0\\left[f\\,e^{-k_1 t} + (1-f)\\,e^{-k_2 t}\\right]\\right)',
    fn: (t, { logN0, kmax1, kmax2, f }) => {
      if (!(f >= 0 && f <= 1)) return NaN;
      return logN0 + logAddExp(Math.log(f) - clampPositive(kmax1, 1e-6) * t, Math.log1p(-f) - clampPositive(kmax2, 1e-6) * t) / Math.LN10;
    },
  },

  BIPHASIC_SHOULDER: {
    id: 'BIPHASIC_SHOULDER',
    name: 'Biphasic + Shoulder',
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
    formula: '\\log_{10}(N) = \\log_{10}\\!\\left(N_0\\left[f\\,e^{-k_1 t}\\,\\frac{1+C_c}{1+C_c\\,e^{-k_1 t}} + (1-f)\\,e^{-k_2 t}\\right]\\right)',
    formulaNote: '\\text{where } C_c = e^{k_1 S_L} - 1',
    fn: (t, { logN0, kmax1, kmax2, f, Sl }) => {
      const safeK1 = clampPositive(kmax1, 1e-6);
      if (!(f >= 0 && f <= 1)) return NaN;
      return logN0 + logAddExp(Math.log(f) + logShoulderSurvival(safeK1 * t, safeK1 * Math.max(Sl, 0)), Math.log1p(-f) - clampPositive(kmax2, 1e-6) * t) / Math.LN10;
    },
  },

  MIXED_WEIBULL: {
    id: 'MIXED_WEIBULL',
    name: 'Mixed Weibull',
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
    formula: '\\log_{10}(N) = \\log_{10}\\!\\left(N_0\\!\\left[f\\,\\exp\\!\\left(-\\left(\\tfrac{t}{\\delta_1}\\right)^{p_1}\\!\\ln 10\\right) + (1-f)\\,\\exp\\!\\left(-\\left(\\tfrac{t}{\\delta_2}\\right)^{p_2}\\!\\ln 10\\right)\\right]\\right)',
    fn: (t, { logN0, delta1, p1, delta2, p2, f }) => {
      if (!(f >= 0 && f <= 1)) return NaN;
      const part1 = Math.log(f) - Math.pow(Math.max(t, 0) / clampPositive(delta1, 1e-6), clampPositive(p1, 1e-6)) * Math.LN10;
      const part2 = Math.log1p(-f) - Math.pow(Math.max(t, 0) / clampPositive(delta2, 1e-6), clampPositive(p2, 1e-6)) * Math.LN10;
      return logN0 + logAddExp(part1, part2) / Math.LN10;
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
    formula: '\\log_{10}(N) = \\log_{10}(N_0) - A\\,\\exp\\!\\left(-\\exp\\!\\left(\\frac{\\mu\\,e}{A}(\\lambda - t)+1\\right)\\right)',
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
    formula: '\\log_{10}(N) = \\log_{10}\\!\\left(N_{\\min} + (N_0 - N_{\\min})\\, e^{-k_{\\max} A(t)}\\right), \\quad A(t) = t + \\frac{1}{k_{\\max}}\\ln\\!\\left(e^{-k_{\\max}t}+e^{-h_0}-e^{-k_{\\max}t-h_0}\\right)',
    fn: (t, { logN0, kmax, logNmin, h0 }) => {
      const safeK = clampPositive(kmax, 1e-6);
      const safeH0 = Math.max(h0, 0);
      return logPopulationWithResidual(logN0, logNmin, logShoulderSurvival(safeK * t, safeH0));
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

/**
 * Bisection solver: given a target log10(N), find the time t where model.fn(t, params) ≈ targetLogN.
 * All inactivation models are monotonically decreasing, so bisection is reliable.
 * Returns null if the target is outside the reachable range.
 */
export function solveForTime(modelId, targetLogN, params, tMax = 10000) {
  const model = MODELS[modelId];
  if (!model || !Number.isFinite(targetLogN) || !Number.isFinite(tMax) || tMax < 0) return null;

  const fn = (t) => model.fn(t, params);
  const logNat0 = fn(0);
  const logNatMax = fn(tMax);

  if (!Number.isFinite(logNat0) || !Number.isFinite(logNatMax)) return null;
  if (targetLogN === logNat0) return 0;

  // Rounded forward values can equal an asymptote at finite t, but the
  // decreasing population reaches that limit only as t approaches infinity.
  const floor = ['LOG_LINEAR_TAIL', 'WEIBULL_TAIL', 'SHOULDER_TAIL'].includes(modelId)
    ? params.logNres
    : modelId === 'BARANYI' ? params.logNmin
    : modelId === 'GOMPERTZ' ? params.logN0 - clampPositive(params.A, 1e-6) : null;
  if (Number.isFinite(floor) && targetLogN <= floor) return null;

  // Model is decreasing: logNat0 >= logNatMax
  const hi = Math.max(logNat0, logNatMax);
  const lo = Math.min(logNat0, logNatMax);
  if (targetLogN > hi || targetLogN < lo) return null;

  let a = 0;
  let b = tMax;
  for (let i = 0; i < 100; i++) {
    const mid = (a + b) / 2;
    const val = fn(mid);
    if (!Number.isFinite(val)) return null;
    // Keep the first crossing bracket instead of accepting a flat rounded
    // region based only on a small response error.
    if (val > targetLogN) a = mid;
    else b = mid;
    if (b - a <= 1e-10 * Math.max(1, Math.abs(mid))) break;
  }
  return (a + b) / 2;
}

export function getParamsForDoseAxis(modelParams, doseUnit) {
  return modelParams.map((p) => {
    if (p.role === 'rate') {
      return { ...p, label: p.label.replace(/1\/min/, `1/${doseUnit}`) };
    }
    if (p.role === 'timeScale') {
      return { ...p, label: p.label.replace(/min\)/, `${doseUnit})`) };
    }
    if (p.role === 'time') {
      return { ...p, label: p.label.replace(/min\)/, `${doseUnit})`) };
    }
    return p;
  });
}
