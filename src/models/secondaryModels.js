import { MODELS } from './inactivationModels.js';
import { calcAICc, fitRegressionModel } from './fitter.js';
import { expandPrimaryObservations } from '../utils/primaryObservations.js';
import { getAllFactorDefs, FACTORS, getCustomFactors, getFactorDef } from '../config/factors.js';

let _manualIdCounter = 0;

/**
 * FACTOR_DEFS is now derived from the central config/factors.js.
 * We map to the legacy shape (defaultValue) for backward compatibility.
 */
export const FACTOR_DEFS = getAllFactorDefs().map((f) => ({
  ...f,
  defaultValue: f.default,
}));

/** Returns FACTOR_DEFS including any runtime-registered custom factors. */
export function getFactorDefsWithCustom() {
  return getAllFactorDefs().map((f) => ({
    ...f,
    defaultValue: f.default,
  }));
}

function getFactorValue(factors, key) {
  const value = factors?.[key];
  return Number.isFinite(value) ? value : null;
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

/* ── Custom-mode helpers: resolve dynamic factor keys at call time ── */

function _customFactorKeys() {
  return Object.keys(getCustomFactors());
}

function _customConditionFactorKeys() {
  return _customFactorKeys().slice(1);
}

function _customFactorLabel(key) {
  const def = getFactorDef(key);
  return def ? def.shortLabel || def.label : key;
}

function _customFactorDef(key) {
  return getFactorDef(key) || { default: 0, scalingRef: 0 };
}

function _customZ1Params() {
  const keys = _customConditionFactorKeys();
  const d1 = _customFactorDef(keys[0]);
  return [
    { name: 'logDref', label: 'log₁₀(D_ref)', defaultValue: 1 },
    { name: 'x1ref', label: `${_customFactorLabel(keys[0])}_ref`, defaultValue: d1.scalingRef ?? d1.default, fixed: true },
    { name: 'z1', label: `z_${_customFactorLabel(keys[0])}`, defaultValue: 10, min: 0.01 },
  ];
}

function _customZ1Formula() {
  const keys = _customConditionFactorKeys();
  const n1 = _customFactorLabel(keys[0]);
  return `log D = log D_ref - (${n1} - ${n1}_ref) / z_${n1}`;
}

function _customZ2Params() {
  const keys = _customConditionFactorKeys();
  const d1 = _customFactorDef(keys[0]);
  const d2 = _customFactorDef(keys[1]);
  return [
    { name: 'logDref', label: 'log₁₀(D_ref)', defaultValue: 1 },
    { name: 'x1ref', label: `${_customFactorLabel(keys[0])}_ref`, defaultValue: d1.scalingRef ?? d1.default, fixed: true },
    { name: 'z1', label: `z_${_customFactorLabel(keys[0])}`, defaultValue: 10, min: 0.01 },
    { name: 'x2ref', label: `${_customFactorLabel(keys[1])}_ref`, defaultValue: d2.scalingRef ?? d2.default, fixed: true },
    { name: 'z2', label: `z_${_customFactorLabel(keys[1])}`, defaultValue: 10 },
  ];
}

function _customZ2Formula() {
  const keys = _customConditionFactorKeys();
  const n1 = _customFactorLabel(keys[0]);
  const n2 = _customFactorLabel(keys[1]);
  return `log D = log D_ref - (${n1} - ${n1}_ref)/z_${n1} - (${n2} - ${n2}_ref)/z_${n2}`;
}

function _customZ3Params() {
  const keys = _customConditionFactorKeys();
  const d1 = _customFactorDef(keys[0]);
  const d2 = _customFactorDef(keys[1]);
  const d3 = _customFactorDef(keys[2]);
  return [
    { name: 'logDref', label: 'log₁₀(D_ref)', defaultValue: 1 },
    { name: 'x1ref', label: `${_customFactorLabel(keys[0])}_ref`, defaultValue: d1.scalingRef ?? d1.default, fixed: true },
    { name: 'z1', label: `z_${_customFactorLabel(keys[0])}`, defaultValue: 10, min: 0.01 },
    { name: 'x2ref', label: `${_customFactorLabel(keys[1])}_ref`, defaultValue: d2.scalingRef ?? d2.default, fixed: true },
    { name: 'z2', label: `z_${_customFactorLabel(keys[1])}`, defaultValue: 10 },
    { name: 'x3ref', label: `${_customFactorLabel(keys[2])}_ref`, defaultValue: d3.scalingRef ?? d3.default, fixed: true },
    { name: 'z3', label: `z_${_customFactorLabel(keys[2])}`, defaultValue: 10 },
  ];
}

function _customZ3Formula() {
  const keys = _customConditionFactorKeys();
  const n1 = _customFactorLabel(keys[0]);
  const n2 = _customFactorLabel(keys[1]);
  const n3 = _customFactorLabel(keys[2]);
  return `log D = log D_ref - (${n1} - ${n1}_ref)/z_${n1} - (${n2} - ${n2}_ref)/z_${n2} - (${n3} - ${n3}_ref)/z_${n3}`;
}

export const SECONDARY_MODELS = {
  BIGELOW: {
    id: 'BIGELOW',
    name: 'Bigelow (z-value model)',
    description: 'Classic z-value model: log D vs. temperature is linear.',
    scenarios: ['thermal'],
    factorKeys: ['temp'],
    xLabel: 'Temperature T (°C)',
    yLabel: 'log₁₀(D)',
    responseLabel: 'D value',
    params: [
      { name: 'logDref', label: 'log₁₀(D_ref)', defaultValue: 1 },
      { name: 'Tref', label: 'T_ref (°C)', defaultValue: 60, fixed: true },
      { name: 'z', label: 'z (°C)', defaultValue: 7, min: 0.01 },
    ],
    formula: 'log D = log D_ref - (T - T_ref) / z',
    getX: (factors) => getFactorValue(factors, 'temp'),
    predictY: (factors, { logDref, Tref, z }) => {
      const temp = getFactorValue(factors, 'temp');
      if (!Number.isFinite(temp)) return Number.NaN;
      const safeZ = Math.abs(z) < 1e-6 ? (z < 0 ? -1e-6 : 1e-6) : z;
      return logDref - (temp - Tref) / safeZ;
    },
    responseTransforms: ['logD'],
    predictParameterValue: (factors, params) => Math.pow(10, SECONDARY_MODELS.BIGELOW.predictY(factors, params)),
  },
  ARRHENIUS: {
    id: 'ARRHENIUS',
    name: 'Arrhenius',
    description: 'Activation energy model: ln k vs. 1/T is linear.',
    scenarios: ['thermal'],
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
      const result = lnA - Ea / (temp + 273.15);
      return result;
    },
    responseTransforms: ['lnValue'],
    predictParameterValue: (factors, params) => Math.exp(SECONDARY_MODELS.ARRHENIUS.predictY(factors, params)),
  },
  SQRTMODEL: {
    id: 'SQRTMODEL',
    name: 'Square Root (Ratkowsky)',
    description: 'Square-root model: √parameter vs. temperature is linear.',
    scenarios: ['thermal'],
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
    scenarios: ['thermal'],
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
    scenarios: ['thermal', 'hpp', 'photoinactivation', 'pef', 'chemical', 'irradiation', 'custom'],
    factorKeys: [],
    xLabel: 'Factor',
    yLabel: 'parameter',
    responseLabel: 'parameter value',
    params: [
      { name: 'c', label: 'c (mean)', defaultValue: 1 },
    ],
    formula: 'y = c',
    getX: (factors) => {
      // Pick whichever primary factor is available
      for (const k of ['temp', 'intensity', 'electricField', 'concentration', 'pressure', 'doseRate', ..._customFactorKeys()]) {
        const v = getFactorValue(factors, k);
        if (v != null) return v;
      }
      return 0;
    },
    predictY: (_, { c }) => c,
    responseTransforms: ['identity'],
    predictParameterValue: (_, params) => params.c,
  },
  EXTENDED_BIGELOW: {
    id: 'EXTENDED_BIGELOW',
    name: 'Extended Bigelow (T + aw)',
    description: 'Extended z-value model: log D depends on both temperature and water activity.',
    scenarios: ['thermal'],
    factorKeys: ['temp', 'aw'],
    xLabel: 'Temperature T (°C)',
    yLabel: 'log₁₀(D)',
    responseLabel: 'D value',
    params: [
      { name: 'logDref', label: 'log₁₀(D_ref)', defaultValue: 1 },
      { name: 'Tref', label: 'T_ref (°C)', defaultValue: 60, fixed: true },
      { name: 'zT', label: 'z_T (°C)', defaultValue: 7, min: 0.01 },
      { name: 'awRef', label: 'aw_ref', defaultValue: 1, min: 0, max: 1, fixed: true },
      { name: 'zaw', label: 'z_aw', defaultValue: 0.2 },
    ],
    formula: 'log D = log D_ref - (T - T_ref)/z_T - (aw - aw_ref)/z_aw',
    getX: (factors) => getFactorValue(factors, 'temp'),
    predictY: (factors, { logDref, Tref, zT, awRef, zaw }) => {
      const temp = getFactorValue(factors, 'temp');
      const aw = getFactorValue(factors, 'aw') ?? 1;
      if (!Number.isFinite(temp)) return Number.NaN;
      const safeZT = Math.abs(zT) < 1e-6 ? (zT < 0 ? -1e-6 : 1e-6) : zT;
      const safeZaw = Math.abs(zaw) < 1e-6 ? (zaw < 0 ? -1e-6 : 1e-6) : zaw;
      return logDref - (temp - Tref) / safeZT - (aw - awRef) / safeZaw;
    },
    responseTransforms: ['logD'],
    predictParameterValue: (factors, params) => Math.pow(10, SECONDARY_MODELS.EXTENDED_BIGELOW.predictY(factors, params)),
  },
  EXTENDED_BIGELOW_PH: {
    id: 'EXTENDED_BIGELOW_PH',
    name: 'Extended Bigelow (T + pH)',
    description: 'Extended z-value model: log D depends on temperature and pH.',
    scenarios: ['thermal'],
    factorKeys: ['temp', 'pH'],
    xLabel: 'Temperature T (°C)',
    yLabel: 'log₁₀(D)',
    responseLabel: 'D value',
    params: [
      { name: 'logDref', label: 'log₁₀(D_ref)', defaultValue: 1 },
      { name: 'Tref', label: 'T_ref (°C)', defaultValue: 60, fixed: true },
      { name: 'zT', label: 'z_T (°C)', defaultValue: 7, min: 0.01 },
      { name: 'pHref', label: 'pH_ref', defaultValue: 7.0, fixed: true },
      { name: 'zpH', label: 'z_pH', defaultValue: 2.0 },
    ],
    formula: 'log D = log D_ref - (T - T_ref)/z_T - (pH - pH_ref)/z_pH',
    getX: (factors) => getFactorValue(factors, 'temp'),
    predictY: (factors, { logDref, Tref, zT, pHref, zpH }) => {
      const temp = getFactorValue(factors, 'temp');
      const pH = getFactorValue(factors, 'pH') ?? 7.0;
      if (!Number.isFinite(temp)) return Number.NaN;
      const safeZT = Math.abs(zT) < 1e-6 ? (zT < 0 ? -1e-6 : 1e-6) : zT;
      const safeZpH = Math.abs(zpH) < 1e-6 ? (zpH < 0 ? -1e-6 : 1e-6) : zpH;
      return logDref - (temp - Tref) / safeZT - (pH - pHref) / safeZpH;
    },
    responseTransforms: ['logD'],
    predictParameterValue: (factors, params) => Math.pow(10, SECONDARY_MODELS.EXTENDED_BIGELOW_PH.predictY(factors, params)),
  },
  BIGELOW_TRIPLE: {
    id: 'BIGELOW_TRIPLE',
    name: 'Bigelow Triple (T + aw + pH)',
    description: 'Full three-factor z-value model: log D depends on temperature, water activity and pH.',
    scenarios: ['thermal'],
    factorKeys: ['temp', 'aw', 'pH'],
    xLabel: 'Temperature T (°C)',
    yLabel: 'log₁₀(D)',
    responseLabel: 'D value',
    params: [
      { name: 'logDref', label: 'log₁₀(D_ref)', defaultValue: 1 },
      { name: 'Tref', label: 'T_ref (°C)', defaultValue: 60, fixed: true },
      { name: 'zT', label: 'z_T (°C)', defaultValue: 7, min: 0.01 },
      { name: 'awRef', label: 'aw_ref', defaultValue: 1, min: 0, max: 1, fixed: true },
      { name: 'zaw', label: 'z_aw', defaultValue: 0.2 },
      { name: 'pHref', label: 'pH_ref', defaultValue: 7.0, fixed: true },
      { name: 'zpH', label: 'z_pH', defaultValue: 2.0 },
    ],
    formula: 'log D = log D_ref - (T - T_ref)/z_T - (aw - aw_ref)/z_aw - (pH - pH_ref)/z_pH',
    getX: (factors) => getFactorValue(factors, 'temp'),
    predictY: (factors, { logDref, Tref, zT, awRef, zaw, pHref, zpH }) => {
      const temp = getFactorValue(factors, 'temp');
      const aw = getFactorValue(factors, 'aw') ?? 1;
      const pH = getFactorValue(factors, 'pH') ?? 7.0;
      if (!Number.isFinite(temp)) return Number.NaN;
      const safeZT = Math.abs(zT) < 1e-6 ? (zT < 0 ? -1e-6 : 1e-6) : zT;
      const safeZaw = Math.abs(zaw) < 1e-6 ? (zaw < 0 ? -1e-6 : 1e-6) : zaw;
      const safeZpH = Math.abs(zpH) < 1e-6 ? (zpH < 0 ? -1e-6 : 1e-6) : zpH;
      return logDref - (temp - Tref) / safeZT - (aw - awRef) / safeZaw - (pH - pHref) / safeZpH;
    },
    responseTransforms: ['logD'],
    predictParameterValue: (factors, params) => Math.pow(10, SECONDARY_MODELS.BIGELOW_TRIPLE.predictY(factors, params)),
  },
  BIGELOW_PRESSURE: {
    id: 'BIGELOW_PRESSURE',
    name: 'Bigelow-Pressure (z_P model)',
    description: 'Pressure z-value model: log D vs. pressure is linear.',
    scenarios: ['hpp'],
    factorKeys: ['pressure'],
    xLabel: 'Pressure P (MPa)',
    yLabel: 'log₁₀(D)',
    responseLabel: 'D value',
    params: [
      { name: 'logDref', label: 'log₁₀(D_ref)', defaultValue: 1 },
      { name: 'Pref', label: 'P_ref (MPa)', defaultValue: 400, fixed: true },
      { name: 'zP', label: 'z_P (MPa)', defaultValue: 100, min: 0.01 },
    ],
    formula: 'log D = log D_ref - (P - P_ref) / z_P',
    getX: (factors) => getFactorValue(factors, 'pressure'),
    predictY: (factors, { logDref, Pref, zP }) => {
      const pressure = getFactorValue(factors, 'pressure');
      if (!Number.isFinite(pressure)) return Number.NaN;
      const safeZP = Math.abs(zP) < 1e-6 ? (zP < 0 ? -1e-6 : 1e-6) : zP;
      return logDref - (pressure - Pref) / safeZP;
    },
    responseTransforms: ['logD'],
    predictParameterValue: (factors, params) => Math.pow(10, SECONDARY_MODELS.BIGELOW_PRESSURE.predictY(factors, params)),
  },
  EXTENDED_BIGELOW_PRESSURE: {
    id: 'EXTENDED_BIGELOW_PRESSURE',
    name: 'Extended Bigelow-Pressure (P + aw)',
    description: 'Extended z-value model for HPP: log D depends on pressure and water activity (Baroprotection).',
    scenarios: ['hpp'],
    factorKeys: ['pressure', 'aw'],
    xLabel: 'Pressure P (MPa)',
    yLabel: 'log₁₀(D)',
    responseLabel: 'D value',
    params: [
      { name: 'logDref', label: 'log₁₀(D_ref)', defaultValue: 1 },
      { name: 'Pref', label: 'P_ref (MPa)', defaultValue: 400, fixed: true },
      { name: 'zP', label: 'z_P (MPa)', defaultValue: 100, min: 0.01 },
      { name: 'awRef', label: 'aw_ref', defaultValue: 1, min: 0, max: 1, fixed: true },
      { name: 'zaw', label: 'z_aw', defaultValue: 0.2 },
    ],
    formula: 'log D = log D_ref - (P - P_ref)/z_P - (aw - aw_ref)/z_aw',
    getX: (factors) => getFactorValue(factors, 'pressure'),
    predictY: (factors, { logDref, Pref, zP, awRef, zaw }) => {
      const pressure = getFactorValue(factors, 'pressure');
      const aw = getFactorValue(factors, 'aw') ?? 1;
      if (!Number.isFinite(pressure)) return Number.NaN;
      const safeZP = Math.abs(zP) < 1e-6 ? (zP < 0 ? -1e-6 : 1e-6) : zP;
      const safeZaw = Math.abs(zaw) < 1e-6 ? (zaw < 0 ? -1e-6 : 1e-6) : zaw;
      return logDref - (pressure - Pref) / safeZP - (aw - awRef) / safeZaw;
    },
    responseTransforms: ['logD'],
    predictParameterValue: (factors, params) => Math.pow(10, SECONDARY_MODELS.EXTENDED_BIGELOW_PRESSURE.predictY(factors, params)),
  },
  PATP_TRIPLE: {
    id: 'PATP_TRIPLE',
    name: 'PATP Triple (T + P + aw)',
    description: 'Full three-factor z-value model for PATP: log D depends on temperature, pressure and water activity.',
    scenarios: ['hpp'],
    factorKeys: ['pressure', 'temp', 'aw'],
    xLabel: 'Pressure P (MPa)',
    yLabel: 'log₁₀(D)',
    responseLabel: 'D value',
    params: [
      { name: 'logDref', label: 'log₁₀(D_ref)', defaultValue: 1 },
      { name: 'Tref', label: 'T_ref (°C)', defaultValue: 60, fixed: true },
      { name: 'zT', label: 'z_T (°C)', defaultValue: 7, min: 0.01 },
      { name: 'Pref', label: 'P_ref (MPa)', defaultValue: 400, fixed: true },
      { name: 'zP', label: 'z_P (MPa)', defaultValue: 100, min: 0.01 },
      { name: 'awRef', label: 'aw_ref', defaultValue: 1, min: 0, max: 1, fixed: true },
      { name: 'zaw', label: 'z_aw', defaultValue: 0.2 },
    ],
    formula: 'log D = log D_ref - (T - T_ref)/z_T - (P - P_ref)/z_P - (aw - aw_ref)/z_aw',
    getX: (factors) => getFactorValue(factors, 'pressure'),
    predictY: (factors, { logDref, Tref, zT, Pref, zP, awRef, zaw }) => {
      const temp = getFactorValue(factors, 'temp');
      const pressure = getFactorValue(factors, 'pressure');
      const aw = getFactorValue(factors, 'aw') ?? 1;
      if (!Number.isFinite(temp) || !Number.isFinite(pressure)) return Number.NaN;
      const safeZT = Math.abs(zT) < 1e-6 ? (zT < 0 ? -1e-6 : 1e-6) : zT;
      const safeZP = Math.abs(zP) < 1e-6 ? (zP < 0 ? -1e-6 : 1e-6) : zP;
      const safeZaw = Math.abs(zaw) < 1e-6 ? (zaw < 0 ? -1e-6 : 1e-6) : zaw;
      return logDref - (temp - Tref) / safeZT - (pressure - Pref) / safeZP - (aw - awRef) / safeZaw;
    },
    responseTransforms: ['logD'],
    predictParameterValue: (factors, params) => Math.pow(10, SECONDARY_MODELS.PATP_TRIPLE.predictY(factors, params)),
  },

  BIGELOW_PRESSURE_PH: {
    id: 'BIGELOW_PRESSURE_PH',
    name: 'HPP Pressure + pH (P + pH)',
    description: 'Extended HPP model: log D depends on pressure and pH.',
    scenarios: ['hpp'],
    factorKeys: ['pressure', 'pH'],
    xLabel: 'Pressure P (MPa)',
    yLabel: 'log₁₀(D)',
    responseLabel: 'D value',
    params: [
      { name: 'logDref', label: 'log₁₀(D_ref)', defaultValue: 1 },
      { name: 'Pref', label: 'P_ref (MPa)', defaultValue: 400, fixed: true },
      { name: 'zP', label: 'z_P (MPa)', defaultValue: 200, min: 0.01 },
      { name: 'pHref', label: 'pH_ref', defaultValue: 7.0, fixed: true },
      { name: 'zpH', label: 'z_pH', defaultValue: 2.0 },
    ],
    formula: 'log D = log D_ref − (P − P_ref)/z_P − (pH − pH_ref)/z_pH',
    getX: (factors) => getFactorValue(factors, 'pressure'),
    predictY: (factors, { logDref, Pref, zP, pHref, zpH }) => {
      const P = getFactorValue(factors, 'pressure');
      const pH = getFactorValue(factors, 'pH') ?? 7.0;
      if (!Number.isFinite(P)) return Number.NaN;
      const safeZP = Math.abs(zP) < 1e-6 ? (zP < 0 ? -1e-6 : 1e-6) : zP;
      const safeZpH = Math.abs(zpH) < 1e-6 ? (zpH < 0 ? -1e-6 : 1e-6) : zpH;
      return logDref - (P - Pref) / safeZP - (pH - pHref) / safeZpH;
    },
    responseTransforms: ['logD'],
    predictParameterValue: (factors, params) => Math.pow(10, SECONDARY_MODELS.BIGELOW_PRESSURE_PH.predictY(factors, params)),
  },

  BIGELOW_PRESSURE_TEMP_PH: {
    id: 'BIGELOW_PRESSURE_TEMP_PH',
    name: 'HPP Pressure + Temp + pH (P + T + pH)',
    description: 'Three-factor HPP model: log D depends on pressure, temperature and pH.',
    scenarios: ['hpp'],
    factorKeys: ['pressure', 'temp', 'pH'],
    xLabel: 'Pressure P (MPa)',
    yLabel: 'log₁₀(D)',
    responseLabel: 'D value',
    params: [
      { name: 'logDref', label: 'log₁₀(D_ref)', defaultValue: 1 },
      { name: 'Pref', label: 'P_ref (MPa)', defaultValue: 400, fixed: true },
      { name: 'zP', label: 'z_P (MPa)', defaultValue: 200, min: 0.01 },
      { name: 'Tref', label: 'T_ref (°C)', defaultValue: 25, fixed: true },
      { name: 'zT', label: 'z_T (°C)', defaultValue: 10, min: 0.01 },
      { name: 'pHref', label: 'pH_ref', defaultValue: 7.0, fixed: true },
      { name: 'zpH', label: 'z_pH', defaultValue: 2.0 },
    ],
    formula: 'log D = log D_ref − (P − P_ref)/z_P − (T − T_ref)/z_T − (pH − pH_ref)/z_pH',
    getX: (factors) => getFactorValue(factors, 'pressure'),
    predictY: (factors, { logDref, Pref, zP, Tref, zT, pHref, zpH }) => {
      const P = getFactorValue(factors, 'pressure');
      const T = getFactorValue(factors, 'temp') ?? 25;
      const pH = getFactorValue(factors, 'pH') ?? 7.0;
      if (!Number.isFinite(P)) return Number.NaN;
      const safeZP = Math.abs(zP) < 1e-6 ? (zP < 0 ? -1e-6 : 1e-6) : zP;
      const safeZT = Math.abs(zT) < 1e-6 ? (zT < 0 ? -1e-6 : 1e-6) : zT;
      const safeZpH = Math.abs(zpH) < 1e-6 ? (zpH < 0 ? -1e-6 : 1e-6) : zpH;
      return logDref - (P - Pref) / safeZP - (T - Tref) / safeZT - (pH - pHref) / safeZpH;
    },
    responseTransforms: ['logD'],
    predictParameterValue: (factors, params) => Math.pow(10, SECONDARY_MODELS.BIGELOW_PRESSURE_TEMP_PH.predictY(factors, params)),
  },

  BIGELOW_PRESSURE_AW_PH: {
    id: 'BIGELOW_PRESSURE_AW_PH',
    name: 'HPP Pressure + aw + pH (P + aw + pH)',
    description: 'Three-factor HPP model: log D depends on pressure, water activity and pH.',
    scenarios: ['hpp'],
    factorKeys: ['pressure', 'aw', 'pH'],
    xLabel: 'Pressure P (MPa)',
    yLabel: 'log₁₀(D)',
    responseLabel: 'D value',
    params: [
      { name: 'logDref', label: 'log₁₀(D_ref)', defaultValue: 1 },
      { name: 'Pref', label: 'P_ref (MPa)', defaultValue: 400, fixed: true },
      { name: 'zP', label: 'z_P (MPa)', defaultValue: 200, min: 0.01 },
      { name: 'awRef', label: 'aw_ref', defaultValue: 1, min: 0, max: 1, fixed: true },
      { name: 'zaw', label: 'z_aw', defaultValue: 0.2 },
      { name: 'pHref', label: 'pH_ref', defaultValue: 7.0, fixed: true },
      { name: 'zpH', label: 'z_pH', defaultValue: 2.0 },
    ],
    formula: 'log D = log D_ref − (P − P_ref)/z_P − (aw − aw_ref)/z_aw − (pH − pH_ref)/z_pH',
    getX: (factors) => getFactorValue(factors, 'pressure'),
    predictY: (factors, { logDref, Pref, zP, awRef, zaw, pHref, zpH }) => {
      const P = getFactorValue(factors, 'pressure');
      const aw = getFactorValue(factors, 'aw') ?? 1;
      const pH = getFactorValue(factors, 'pH') ?? 7.0;
      if (!Number.isFinite(P)) return Number.NaN;
      const safeZP = Math.abs(zP) < 1e-6 ? (zP < 0 ? -1e-6 : 1e-6) : zP;
      const safeZaw = Math.abs(zaw) < 1e-6 ? (zaw < 0 ? -1e-6 : 1e-6) : zaw;
      const safeZpH = Math.abs(zpH) < 1e-6 ? (zpH < 0 ? -1e-6 : 1e-6) : zpH;
      return logDref - (P - Pref) / safeZP - (aw - awRef) / safeZaw - (pH - pHref) / safeZpH;
    },
    responseTransforms: ['logD'],
    predictParameterValue: (factors, params) => Math.pow(10, SECONDARY_MODELS.BIGELOW_PRESSURE_AW_PH.predictY(factors, params)),
  },

  LINEAR_PRESSURE: {
    id: 'LINEAR_PRESSURE',
    name: 'Linear-Pressure',
    description: 'Simple linear model: y = a + b·P (no transformation).',
    scenarios: ['hpp'],
    factorKeys: ['pressure'],
    xLabel: 'Pressure P (MPa)',
    yLabel: 'parameter',
    responseLabel: 'parameter value',
    params: [
      { name: 'a', label: 'intercept', defaultValue: 1 },
      { name: 'b', label: 'slope', defaultValue: 0 },
    ],
    formula: 'y = a + b·P',
    getX: (factors) => getFactorValue(factors, 'pressure'),
    predictY: (factors, { a, b }) => {
      const pressure = getFactorValue(factors, 'pressure');
      if (!Number.isFinite(pressure)) return Number.NaN;
      return a + b * pressure;
    },
    responseTransforms: ['identity'],
    predictParameterValue: (factors, params) => SECONDARY_MODELS.LINEAR_PRESSURE.predictY(factors, params),
  },
  ARRHENIUS_EYRING: {
    id: 'ARRHENIUS_EYRING',
    name: 'Arrhenius-Eyring (P + T cooperative)',
    description: 'Dual-factor cooperative model for pressure-assisted thermal processing. Combines Arrhenius (thermal) and Eyring (pressure) activation.',
    scenarios: ['hpp'],
    factorKeys: ['pressure', 'temp'],
    xLabel: 'Pressure P (MPa)',
    yLabel: 'ln(k)',
    responseLabel: 'rate constant k',
    params: [
      { name: 'lnkRef', label: 'ln(k_ref)', defaultValue: 0 },
      { name: 'EaR', label: 'E_a / R (K)', defaultValue: 9600, min: 0 },
      { name: 'VaR', label: 'V_a / R (cm³·K⁻¹·mol⁻¹)', defaultValue: -1.2 },
      { name: 'Tref', label: 'T_ref (°C)', defaultValue: 40, fixed: true },
      { name: 'Pref', label: 'P_ref (MPa)', defaultValue: 400, fixed: true },
    ],
    formula: 'ln k = ln k_ref − (E_a/R)·(1/T − 1/T_ref) − (V_a/R)·(P − P_ref)/T',
    getX: (factors) => getFactorValue(factors, 'pressure'),
    predictY: (factors, { lnkRef, EaR, VaR, Tref, Pref }) => {
      const temp = getFactorValue(factors, 'temp');
      const pressure = getFactorValue(factors, 'pressure');
      if (!Number.isFinite(temp) || !Number.isFinite(pressure)) return Number.NaN;
      const T_K = temp + 273.15;
      const Tref_K = Tref + 273.15;
      return lnkRef - EaR * (1 / T_K - 1 / Tref_K) - VaR * (pressure - Pref) / T_K;
    },
    responseTransforms: ['lnValue'],
    predictParameterValue: (factors, params) => Math.exp(SECONDARY_MODELS.ARRHENIUS_EYRING.predictY(factors, params)),
  },

  // ── Photoinactivation secondary models ──────────────────────────────────────────

  PHOTO_INTENSITY: {
    id: 'PHOTO_INTENSITY',
    name: 'Photoinactivation Intensity (z_I model)',
    description: 'Photoinactivation z-value model: log D vs. intensity is linear.',
    scenarios: ['photoinactivation'],
    factorKeys: ['intensity'],
    xLabel: 'Intensity I (mW/cm²)',
    yLabel: 'log₁₀(D)',
    responseLabel: 'D value',
    params: [
      { name: 'logDref', label: 'log₁₀(D_ref)', defaultValue: 1 },
      { name: 'Iref', label: 'I_ref (mW/cm²)', defaultValue: 10, fixed: true },
      { name: 'zI', label: 'z_I (mW/cm²)', defaultValue: 5, min: 0.01 },
    ],
    formula: 'log D = log D_ref − (I − I_ref) / z_I',
    getX: (factors) => getFactorValue(factors, 'intensity'),
    predictY: (factors, { logDref, Iref, zI }) => {
      const I = getFactorValue(factors, 'intensity');
      if (!Number.isFinite(I)) return Number.NaN;
      const safeZI = Math.abs(zI) < 1e-6 ? (zI < 0 ? -1e-6 : 1e-6) : zI;
      return logDref - (I - Iref) / safeZI;
    },
    responseTransforms: ['logD'],
    predictParameterValue: (factors, params) => Math.pow(10, SECONDARY_MODELS.PHOTO_INTENSITY.predictY(factors, params)),
  },

  PHOTO_INTENSITY_TURBIDITY: {
    id: 'PHOTO_INTENSITY_TURBIDITY',
    name: 'Photoinactivation Intensity + Turbidity (I + NTU)',
    description: 'Extended photoinactivation model: log D depends on intensity and turbidity.',
    scenarios: ['photoinactivation'],
    factorKeys: ['intensity', 'turbidity'],
    xLabel: 'Intensity I (mW/cm²)',
    yLabel: 'log₁₀(D)',
    responseLabel: 'D value',
    params: [
      { name: 'logDref', label: 'log₁₀(D_ref)', defaultValue: 1 },
      { name: 'Iref', label: 'I_ref (mW/cm²)', defaultValue: 10, fixed: true },
      { name: 'zI', label: 'z_I (mW/cm²)', defaultValue: 5, min: 0.01 },
      { name: 'kTurb', label: 'k_turb', defaultValue: 0.005 },
    ],
    formula: 'log D = log D_ref − (I − I_ref)/z_I + k_turb · NTU',
    getX: (factors) => getFactorValue(factors, 'intensity'),
    predictY: (factors, { logDref, Iref, zI, kTurb }) => {
      const I = getFactorValue(factors, 'intensity');
      const turb = getFactorValue(factors, 'turbidity') ?? 0;
      if (!Number.isFinite(I)) return Number.NaN;
      const safeZI = Math.abs(zI) < 1e-6 ? (zI < 0 ? -1e-6 : 1e-6) : zI;
      return logDref - (I - Iref) / safeZI + kTurb * turb;
    },
    responseTransforms: ['logD'],
    predictParameterValue: (factors, params) => Math.pow(10, SECONDARY_MODELS.PHOTO_INTENSITY_TURBIDITY.predictY(factors, params)),
  },

  PHOTO_INTENSITY_AW: {
    id: 'PHOTO_INTENSITY_AW',
    name: 'Photoinactivation Intensity + aw (I + aw)',
    description: 'Extended photoinactivation model: log D depends on intensity and water activity.',
    scenarios: ['photoinactivation'],
    factorKeys: ['intensity', 'aw'],
    xLabel: 'Intensity I (mW/cm²)',
    yLabel: 'log₁₀(D)',
    responseLabel: 'D value',
    params: [
      { name: 'logDref', label: 'log₁₀(D_ref)', defaultValue: 1 },
      { name: 'Iref', label: 'I_ref (mW/cm²)', defaultValue: 10, fixed: true },
      { name: 'zI', label: 'z_I (mW/cm²)', defaultValue: 5, min: 0.01 },
      { name: 'awRef', label: 'aw_ref', defaultValue: 1, min: 0, max: 1, fixed: true },
      { name: 'zaw', label: 'z_aw', defaultValue: 0.2 },
    ],
    formula: 'log D = log D_ref − (I − I_ref)/z_I − (aw − aw_ref)/z_aw',
    getX: (factors) => getFactorValue(factors, 'intensity'),
    predictY: (factors, { logDref, Iref, zI, awRef, zaw }) => {
      const I = getFactorValue(factors, 'intensity');
      const aw = getFactorValue(factors, 'aw') ?? 1;
      if (!Number.isFinite(I)) return Number.NaN;
      const safeZI = Math.abs(zI) < 1e-6 ? (zI < 0 ? -1e-6 : 1e-6) : zI;
      const safeZaw = Math.abs(zaw) < 1e-6 ? (zaw < 0 ? -1e-6 : 1e-6) : zaw;
      return logDref - (I - Iref) / safeZI - (aw - awRef) / safeZaw;
    },
    responseTransforms: ['logD'],
    predictParameterValue: (factors, params) => Math.pow(10, SECONDARY_MODELS.PHOTO_INTENSITY_AW.predictY(factors, params)),
  },

  PHOTO_TRIPLE: {
    id: 'PHOTO_TRIPLE',
    name: 'Photoinactivation Triple (I + aw + turbidity)',
    description: 'Full three-factor model: log D depends on photoinactivation intensity, water activity and turbidity.',
    scenarios: ['photoinactivation'],
    factorKeys: ['intensity', 'aw', 'turbidity'],
    xLabel: 'Intensity I (mW/cm²)',
    yLabel: 'log₁₀(D)',
    responseLabel: 'D value',
    params: [
      { name: 'logDref', label: 'log₁₀(D_ref)', defaultValue: 1 },
      { name: 'Iref', label: 'I_ref (mW/cm²)', defaultValue: 10, fixed: true },
      { name: 'zI', label: 'z_I (mW/cm²)', defaultValue: 5, min: 0.01 },
      { name: 'awRef', label: 'aw_ref', defaultValue: 1, min: 0, max: 1, fixed: true },
      { name: 'zaw', label: 'z_aw', defaultValue: 0.2 },
      { name: 'kTurb', label: 'k_turb', defaultValue: 0.005 },
    ],
    formula: 'log D = log D_ref − (I − I_ref)/z_I − (aw − aw_ref)/z_aw + k_turb · NTU',
    getX: (factors) => getFactorValue(factors, 'intensity'),
    predictY: (factors, { logDref, Iref, zI, awRef, zaw, kTurb }) => {
      const I = getFactorValue(factors, 'intensity');
      const aw = getFactorValue(factors, 'aw') ?? 1;
      const turb = getFactorValue(factors, 'turbidity') ?? 0;
      if (!Number.isFinite(I)) return Number.NaN;
      const safeZI = Math.abs(zI) < 1e-6 ? (zI < 0 ? -1e-6 : 1e-6) : zI;
      const safeZaw = Math.abs(zaw) < 1e-6 ? (zaw < 0 ? -1e-6 : 1e-6) : zaw;
      return logDref - (I - Iref) / safeZI - (aw - awRef) / safeZaw + kTurb * turb;
    },
    responseTransforms: ['logD'],
    predictParameterValue: (factors, params) => Math.pow(10, SECONDARY_MODELS.PHOTO_TRIPLE.predictY(factors, params)),
  },

  LINEAR_PHOTO: {
    id: 'LINEAR_PHOTO',
    name: 'Linear-Photoinactivation',
    description: 'Simple linear model: y = a + b·I (no transformation).',
    scenarios: ['photoinactivation'],
    factorKeys: ['intensity'],
    xLabel: 'Intensity I (mW/cm²)',
    yLabel: 'parameter',
    responseLabel: 'parameter value',
    params: [
      { name: 'a', label: 'intercept', defaultValue: 1 },
      { name: 'b', label: 'slope', defaultValue: 0 },
    ],
    formula: 'y = a + b·I',
    getX: (factors) => getFactorValue(factors, 'intensity'),
    predictY: (factors, { a, b }) => {
      const I = getFactorValue(factors, 'intensity');
      if (!Number.isFinite(I)) return Number.NaN;
      return a + b * I;
    },
    responseTransforms: ['identity'],
    predictParameterValue: (factors, params) => SECONDARY_MODELS.LINEAR_PHOTO.predictY(factors, params),
  },

  // ── PEF secondary models ──────────────────────────────────────────

  PEF_FIELD: {
    id: 'PEF_FIELD',
    name: 'PEF Field (z_E model)',
    description: 'PEF z-value model: log D vs. electric field is linear.',
    scenarios: ['pef'],
    factorKeys: ['electricField'],
    xLabel: 'Electric Field E (kV/cm)',
    yLabel: 'log₁₀(D)',
    responseLabel: 'D value',
    params: [
      { name: 'logDref', label: 'log₁₀(D_ref)', defaultValue: 1 },
      { name: 'Eref', label: 'E_ref (kV/cm)', defaultValue: 20, fixed: true },
      { name: 'zE', label: 'z_E (kV/cm)', defaultValue: 10, min: 0.01 },
    ],
    formula: 'log D = log D_ref − (E − E_ref) / z_E',
    getX: (factors) => getFactorValue(factors, 'electricField'),
    predictY: (factors, { logDref, Eref, zE }) => {
      const E = getFactorValue(factors, 'electricField');
      if (!Number.isFinite(E)) return Number.NaN;
      const safeZE = Math.abs(zE) < 1e-6 ? (zE < 0 ? -1e-6 : 1e-6) : zE;
      return logDref - (E - Eref) / safeZE;
    },
    responseTransforms: ['logD'],
    predictParameterValue: (factors, params) => Math.pow(10, SECONDARY_MODELS.PEF_FIELD.predictY(factors, params)),
  },

  PEF_FIELD_CONDUCTIVITY: {
    id: 'PEF_FIELD_CONDUCTIVITY',
    name: 'PEF Field + Conductivity (E + σ)',
    description: 'Extended PEF model: log D depends on electric field and conductivity.',
    scenarios: ['pef'],
    factorKeys: ['electricField', 'conductivity'],
    xLabel: 'Electric Field E (kV/cm)',
    yLabel: 'log₁₀(D)',
    responseLabel: 'D value',
    params: [
      { name: 'logDref', label: 'log₁₀(D_ref)', defaultValue: 1 },
      { name: 'Eref', label: 'E_ref (kV/cm)', defaultValue: 20, fixed: true },
      { name: 'zE', label: 'z_E (kV/cm)', defaultValue: 10, min: 0.01 },
      { name: 'sigmaRef', label: 'σ_ref (mS/cm)', defaultValue: 2.0, fixed: true },
      { name: 'zSigma', label: 'z_σ (mS/cm)', defaultValue: 2.0 },
    ],
    formula: 'log D = log D_ref − (E − E_ref)/z_E − (σ − σ_ref)/z_σ',
    getX: (factors) => getFactorValue(factors, 'electricField'),
    predictY: (factors, { logDref, Eref, zE, sigmaRef, zSigma }) => {
      const E = getFactorValue(factors, 'electricField');
      const sigma = getFactorValue(factors, 'conductivity') ?? 2.0;
      if (!Number.isFinite(E)) return Number.NaN;
      const safeZE = Math.abs(zE) < 1e-6 ? (zE < 0 ? -1e-6 : 1e-6) : zE;
      const safeZSigma = Math.abs(zSigma) < 1e-6 ? (zSigma < 0 ? -1e-6 : 1e-6) : zSigma;
      return logDref - (E - Eref) / safeZE - (sigma - sigmaRef) / safeZSigma;
    },
    responseTransforms: ['logD'],
    predictParameterValue: (factors, params) => Math.pow(10, SECONDARY_MODELS.PEF_FIELD_CONDUCTIVITY.predictY(factors, params)),
  },

  PEF_FIELD_AW: {
    id: 'PEF_FIELD_AW',
    name: 'PEF Field + aw (E + aw)',
    description: 'Extended PEF model: log D depends on electric field and water activity.',
    scenarios: ['pef'],
    factorKeys: ['electricField', 'aw'],
    xLabel: 'Electric Field E (kV/cm)',
    yLabel: 'log₁₀(D)',
    responseLabel: 'D value',
    params: [
      { name: 'logDref', label: 'log₁₀(D_ref)', defaultValue: 1 },
      { name: 'Eref', label: 'E_ref (kV/cm)', defaultValue: 20, fixed: true },
      { name: 'zE', label: 'z_E (kV/cm)', defaultValue: 10, min: 0.01 },
      { name: 'awRef', label: 'aw_ref', defaultValue: 1, min: 0, max: 1, fixed: true },
      { name: 'zaw', label: 'z_aw', defaultValue: 0.2 },
    ],
    formula: 'log D = log D_ref − (E − E_ref)/z_E − (aw − aw_ref)/z_aw',
    getX: (factors) => getFactorValue(factors, 'electricField'),
    predictY: (factors, { logDref, Eref, zE, awRef, zaw }) => {
      const E = getFactorValue(factors, 'electricField');
      const aw = getFactorValue(factors, 'aw') ?? 1;
      if (!Number.isFinite(E)) return Number.NaN;
      const safeZE = Math.abs(zE) < 1e-6 ? (zE < 0 ? -1e-6 : 1e-6) : zE;
      const safeZaw = Math.abs(zaw) < 1e-6 ? (zaw < 0 ? -1e-6 : 1e-6) : zaw;
      return logDref - (E - Eref) / safeZE - (aw - awRef) / safeZaw;
    },
    responseTransforms: ['logD'],
    predictParameterValue: (factors, params) => Math.pow(10, SECONDARY_MODELS.PEF_FIELD_AW.predictY(factors, params)),
  },

  PEF_TRIPLE: {
    id: 'PEF_TRIPLE',
    name: 'PEF Triple (E + aw + σ)',
    description: 'Full three-factor model: log D depends on electric field, water activity and conductivity.',
    scenarios: ['pef'],
    factorKeys: ['electricField', 'aw', 'conductivity'],
    xLabel: 'Electric Field E (kV/cm)',
    yLabel: 'log₁₀(D)',
    responseLabel: 'D value',
    params: [
      { name: 'logDref', label: 'log₁₀(D_ref)', defaultValue: 1 },
      { name: 'Eref', label: 'E_ref (kV/cm)', defaultValue: 20, fixed: true },
      { name: 'zE', label: 'z_E (kV/cm)', defaultValue: 10, min: 0.01 },
      { name: 'awRef', label: 'aw_ref', defaultValue: 1, min: 0, max: 1, fixed: true },
      { name: 'zaw', label: 'z_aw', defaultValue: 0.2 },
      { name: 'sigmaRef', label: 'σ_ref (mS/cm)', defaultValue: 2.0, fixed: true },
      { name: 'zSigma', label: 'z_σ (mS/cm)', defaultValue: 2.0 },
    ],
    formula: 'log D = log D_ref − (E − E_ref)/z_E − (aw − aw_ref)/z_aw − (σ − σ_ref)/z_σ',
    getX: (factors) => getFactorValue(factors, 'electricField'),
    predictY: (factors, { logDref, Eref, zE, awRef, zaw, sigmaRef, zSigma }) => {
      const E = getFactorValue(factors, 'electricField');
      const aw = getFactorValue(factors, 'aw') ?? 1;
      const sigma = getFactorValue(factors, 'conductivity') ?? 2.0;
      if (!Number.isFinite(E)) return Number.NaN;
      const safeZE = Math.abs(zE) < 1e-6 ? (zE < 0 ? -1e-6 : 1e-6) : zE;
      const safeZaw = Math.abs(zaw) < 1e-6 ? (zaw < 0 ? -1e-6 : 1e-6) : zaw;
      const safeZSigma = Math.abs(zSigma) < 1e-6 ? (zSigma < 0 ? -1e-6 : 1e-6) : zSigma;
      return logDref - (E - Eref) / safeZE - (aw - awRef) / safeZaw - (sigma - sigmaRef) / safeZSigma;
    },
    responseTransforms: ['logD'],
    predictParameterValue: (factors, params) => Math.pow(10, SECONDARY_MODELS.PEF_TRIPLE.predictY(factors, params)),
  },

  LINEAR_PEF: {
    id: 'LINEAR_PEF',
    name: 'Linear-PEF',
    description: 'Simple linear model: y = a + b·E (no transformation).',
    scenarios: ['pef'],
    factorKeys: ['electricField'],
    xLabel: 'Electric Field E (kV/cm)',
    yLabel: 'parameter',
    responseLabel: 'parameter value',
    params: [
      { name: 'a', label: 'intercept', defaultValue: 1 },
      { name: 'b', label: 'slope', defaultValue: 0 },
    ],
    formula: 'y = a + b·E',
    getX: (factors) => getFactorValue(factors, 'electricField'),
    predictY: (factors, { a, b }) => {
      const E = getFactorValue(factors, 'electricField');
      if (!Number.isFinite(E)) return Number.NaN;
      return a + b * E;
    },
    responseTransforms: ['identity'],
    predictParameterValue: (factors, params) => SECONDARY_MODELS.LINEAR_PEF.predictY(factors, params),
  },

  // ── Chemical secondary models ──────────────────────────────────────

  CHEMICAL_CONC: {
    id: 'CHEMICAL_CONC',
    name: 'Chemical Concentration (z_C model)',
    description: 'Chemical z-value model: log D vs. concentration is linear.',
    scenarios: ['chemical'],
    factorKeys: ['concentration'],
    xLabel: 'Concentration C (ppm)',
    yLabel: 'log₁₀(D)',
    responseLabel: 'D value',
    params: [
      { name: 'logDref', label: 'log₁₀(D_ref)', defaultValue: 1 },
      { name: 'Cref', label: 'C_ref (ppm)', defaultValue: 200, fixed: true },
      { name: 'zC', label: 'z_C (ppm)', defaultValue: 100, min: 0.01 },
    ],
    formula: 'log D = log D_ref − (C − C_ref) / z_C',
    getX: (factors) => getFactorValue(factors, 'concentration'),
    predictY: (factors, { logDref, Cref, zC }) => {
      const C = getFactorValue(factors, 'concentration');
      if (!Number.isFinite(C)) return Number.NaN;
      const safeZC = Math.abs(zC) < 1e-6 ? (zC < 0 ? -1e-6 : 1e-6) : zC;
      return logDref - (C - Cref) / safeZC;
    },
    responseTransforms: ['logD'],
    predictParameterValue: (factors, params) => Math.pow(10, SECONDARY_MODELS.CHEMICAL_CONC.predictY(factors, params)),
  },

  CHEMICAL_CONC_PH: {
    id: 'CHEMICAL_CONC_PH',
    name: 'Chemical Conc + pH (C + pH)',
    description: 'Extended chemical model: log D depends on concentration and pH.',
    scenarios: ['chemical'],
    factorKeys: ['concentration', 'pH'],
    xLabel: 'Concentration C (ppm)',
    yLabel: 'log₁₀(D)',
    responseLabel: 'D value',
    params: [
      { name: 'logDref', label: 'log₁₀(D_ref)', defaultValue: 1 },
      { name: 'Cref', label: 'C_ref (ppm)', defaultValue: 200, fixed: true },
      { name: 'zC', label: 'z_C (ppm)', defaultValue: 100, min: 0.01 },
      { name: 'pHref', label: 'pH_ref', defaultValue: 7.0, fixed: true },
      { name: 'zpH', label: 'z_pH', defaultValue: 2.0 },
    ],
    formula: 'log D = log D_ref − (C − C_ref)/z_C − (pH − pH_ref)/z_pH',
    getX: (factors) => getFactorValue(factors, 'concentration'),
    predictY: (factors, { logDref, Cref, zC, pHref, zpH }) => {
      const C = getFactorValue(factors, 'concentration');
      const pH = getFactorValue(factors, 'pH') ?? 7.0;
      if (!Number.isFinite(C)) return Number.NaN;
      const safeZC = Math.abs(zC) < 1e-6 ? (zC < 0 ? -1e-6 : 1e-6) : zC;
      const safeZpH = Math.abs(zpH) < 1e-6 ? (zpH < 0 ? -1e-6 : 1e-6) : zpH;
      return logDref - (C - Cref) / safeZC - (pH - pHref) / safeZpH;
    },
    responseTransforms: ['logD'],
    predictParameterValue: (factors, params) => Math.pow(10, SECONDARY_MODELS.CHEMICAL_CONC_PH.predictY(factors, params)),
  },

  CHEMICAL_CONC_AW: {
    id: 'CHEMICAL_CONC_AW',
    name: 'Chemical Conc + aw (C + aw)',
    description: 'Extended chemical model: log D depends on concentration and water activity.',
    scenarios: ['chemical'],
    factorKeys: ['concentration', 'aw'],
    xLabel: 'Concentration C (ppm)',
    yLabel: 'log₁₀(D)',
    responseLabel: 'D value',
    params: [
      { name: 'logDref', label: 'log₁₀(D_ref)', defaultValue: 1 },
      { name: 'Cref', label: 'C_ref (ppm)', defaultValue: 200, fixed: true },
      { name: 'zC', label: 'z_C (ppm)', defaultValue: 100, min: 0.01 },
      { name: 'awRef', label: 'aw_ref', defaultValue: 1, min: 0, max: 1, fixed: true },
      { name: 'zaw', label: 'z_aw', defaultValue: 0.2 },
    ],
    formula: 'log D = log D_ref − (C − C_ref)/z_C − (aw − aw_ref)/z_aw',
    getX: (factors) => getFactorValue(factors, 'concentration'),
    predictY: (factors, { logDref, Cref, zC, awRef, zaw }) => {
      const C = getFactorValue(factors, 'concentration');
      const aw = getFactorValue(factors, 'aw') ?? 1;
      if (!Number.isFinite(C)) return Number.NaN;
      const safeZC = Math.abs(zC) < 1e-6 ? (zC < 0 ? -1e-6 : 1e-6) : zC;
      const safeZaw = Math.abs(zaw) < 1e-6 ? (zaw < 0 ? -1e-6 : 1e-6) : zaw;
      return logDref - (C - Cref) / safeZC - (aw - awRef) / safeZaw;
    },
    responseTransforms: ['logD'],
    predictParameterValue: (factors, params) => Math.pow(10, SECONDARY_MODELS.CHEMICAL_CONC_AW.predictY(factors, params)),
  },

  CHEMICAL_TRIPLE: {
    id: 'CHEMICAL_TRIPLE',
    name: 'Chemical Triple (C + aw + pH)',
    description: 'Full three-factor model: log D depends on concentration, water activity and pH.',
    scenarios: ['chemical'],
    factorKeys: ['concentration', 'aw', 'pH'],
    xLabel: 'Concentration C (ppm)',
    yLabel: 'log₁₀(D)',
    responseLabel: 'D value',
    params: [
      { name: 'logDref', label: 'log₁₀(D_ref)', defaultValue: 1 },
      { name: 'Cref', label: 'C_ref (ppm)', defaultValue: 200, fixed: true },
      { name: 'zC', label: 'z_C (ppm)', defaultValue: 100, min: 0.01 },
      { name: 'awRef', label: 'aw_ref', defaultValue: 1, min: 0, max: 1, fixed: true },
      { name: 'zaw', label: 'z_aw', defaultValue: 0.2 },
      { name: 'pHref', label: 'pH_ref', defaultValue: 7.0, fixed: true },
      { name: 'zpH', label: 'z_pH', defaultValue: 2.0 },
    ],
    formula: 'log D = log D_ref − (C − C_ref)/z_C − (aw − aw_ref)/z_aw − (pH − pH_ref)/z_pH',
    getX: (factors) => getFactorValue(factors, 'concentration'),
    predictY: (factors, { logDref, Cref, zC, awRef, zaw, pHref, zpH }) => {
      const C = getFactorValue(factors, 'concentration');
      const aw = getFactorValue(factors, 'aw') ?? 1;
      const pH = getFactorValue(factors, 'pH') ?? 7.0;
      if (!Number.isFinite(C)) return Number.NaN;
      const safeZC = Math.abs(zC) < 1e-6 ? (zC < 0 ? -1e-6 : 1e-6) : zC;
      const safeZaw = Math.abs(zaw) < 1e-6 ? (zaw < 0 ? -1e-6 : 1e-6) : zaw;
      const safeZpH = Math.abs(zpH) < 1e-6 ? (zpH < 0 ? -1e-6 : 1e-6) : zpH;
      return logDref - (C - Cref) / safeZC - (aw - awRef) / safeZaw - (pH - pHref) / safeZpH;
    },
    responseTransforms: ['logD'],
    predictParameterValue: (factors, params) => Math.pow(10, SECONDARY_MODELS.CHEMICAL_TRIPLE.predictY(factors, params)),
  },

  CHEMICAL_CONC_TEMP: {
    id: 'CHEMICAL_CONC_TEMP',
    name: 'Chemical Conc + Temp (C + T)',
    description: 'Extended chemical model: log D depends on concentration and temperature.',
    scenarios: ['chemical'],
    factorKeys: ['concentration', 'temp'],
    xLabel: 'Concentration C (ppm)',
    yLabel: 'log₁₀(D)',
    responseLabel: 'D value',
    params: [
      { name: 'logDref', label: 'log₁₀(D_ref)', defaultValue: 1 },
      { name: 'Cref', label: 'C_ref (ppm)', defaultValue: 200, fixed: true },
      { name: 'zC', label: 'z_C (ppm)', defaultValue: 100, min: 0.01 },
      { name: 'Tref', label: 'T_ref (°C)', defaultValue: 25, fixed: true },
      { name: 'zT', label: 'z_T (°C)', defaultValue: 10, min: 0.01 },
    ],
    formula: 'log D = log D_ref − (C − C_ref)/z_C − (T − T_ref)/z_T',
    getX: (factors) => getFactorValue(factors, 'concentration'),
    predictY: (factors, { logDref, Cref, zC, Tref, zT }) => {
      const C = getFactorValue(factors, 'concentration');
      const T = getFactorValue(factors, 'temp') ?? 25;
      if (!Number.isFinite(C)) return Number.NaN;
      const safeZC = Math.abs(zC) < 1e-6 ? (zC < 0 ? -1e-6 : 1e-6) : zC;
      const safeZT = Math.abs(zT) < 1e-6 ? (zT < 0 ? -1e-6 : 1e-6) : zT;
      return logDref - (C - Cref) / safeZC - (T - Tref) / safeZT;
    },
    responseTransforms: ['logD'],
    predictParameterValue: (factors, params) => Math.pow(10, SECONDARY_MODELS.CHEMICAL_CONC_TEMP.predictY(factors, params)),
  },

  CHEMICAL_CONC_TEMP_PH: {
    id: 'CHEMICAL_CONC_TEMP_PH',
    name: 'Chemical Conc + Temp + pH (C + T + pH)',
    description: 'Extended chemical model: log D depends on concentration, temperature and pH.',
    scenarios: ['chemical'],
    factorKeys: ['concentration', 'temp', 'pH'],
    xLabel: 'Concentration C (ppm)',
    yLabel: 'log₁₀(D)',
    responseLabel: 'D value',
    params: [
      { name: 'logDref', label: 'log₁₀(D_ref)', defaultValue: 1 },
      { name: 'Cref', label: 'C_ref (ppm)', defaultValue: 200, fixed: true },
      { name: 'zC', label: 'z_C (ppm)', defaultValue: 100, min: 0.01 },
      { name: 'Tref', label: 'T_ref (°C)', defaultValue: 25, fixed: true },
      { name: 'zT', label: 'z_T (°C)', defaultValue: 10, min: 0.01 },
      { name: 'pHref', label: 'pH_ref', defaultValue: 7.0, fixed: true },
      { name: 'zpH', label: 'z_pH', defaultValue: 2.0 },
    ],
    formula: 'log D = log D_ref − (C − C_ref)/z_C − (T − T_ref)/z_T − (pH − pH_ref)/z_pH',
    getX: (factors) => getFactorValue(factors, 'concentration'),
    predictY: (factors, { logDref, Cref, zC, Tref, zT, pHref, zpH }) => {
      const C = getFactorValue(factors, 'concentration');
      const T = getFactorValue(factors, 'temp') ?? 25;
      const pH = getFactorValue(factors, 'pH') ?? 7.0;
      if (!Number.isFinite(C)) return Number.NaN;
      const safeZC = Math.abs(zC) < 1e-6 ? (zC < 0 ? -1e-6 : 1e-6) : zC;
      const safeZT = Math.abs(zT) < 1e-6 ? (zT < 0 ? -1e-6 : 1e-6) : zT;
      const safeZpH = Math.abs(zpH) < 1e-6 ? (zpH < 0 ? -1e-6 : 1e-6) : zpH;
      return logDref - (C - Cref) / safeZC - (T - Tref) / safeZT - (pH - pHref) / safeZpH;
    },
    responseTransforms: ['logD'],
    predictParameterValue: (factors, params) => Math.pow(10, SECONDARY_MODELS.CHEMICAL_CONC_TEMP_PH.predictY(factors, params)),
  },

  CHEMICAL_QUAD: {
    id: 'CHEMICAL_QUAD',
    name: 'Chemical Quad (C + T + aw + pH)',
    description: 'Full four-factor model: log D depends on concentration, temperature, water activity and pH.',
    scenarios: ['chemical'],
    factorKeys: ['concentration', 'temp', 'aw', 'pH'],
    xLabel: 'Concentration C (ppm)',
    yLabel: 'log₁₀(D)',
    responseLabel: 'D value',
    params: [
      { name: 'logDref', label: 'log₁₀(D_ref)', defaultValue: 1 },
      { name: 'Cref', label: 'C_ref (ppm)', defaultValue: 200, fixed: true },
      { name: 'zC', label: 'z_C (ppm)', defaultValue: 100, min: 0.01 },
      { name: 'Tref', label: 'T_ref (°C)', defaultValue: 25, fixed: true },
      { name: 'zT', label: 'z_T (°C)', defaultValue: 10, min: 0.01 },
      { name: 'awRef', label: 'aw_ref', defaultValue: 1, min: 0, max: 1, fixed: true },
      { name: 'zaw', label: 'z_aw', defaultValue: 0.2 },
      { name: 'pHref', label: 'pH_ref', defaultValue: 7.0, fixed: true },
      { name: 'zpH', label: 'z_pH', defaultValue: 2.0 },
    ],
    formula: 'log D = log D_ref − (C − C_ref)/z_C − (T − T_ref)/z_T − (aw − aw_ref)/z_aw − (pH − pH_ref)/z_pH',
    getX: (factors) => getFactorValue(factors, 'concentration'),
    predictY: (factors, { logDref, Cref, zC, Tref, zT, awRef, zaw, pHref, zpH }) => {
      const C = getFactorValue(factors, 'concentration');
      const T = getFactorValue(factors, 'temp') ?? 25;
      const aw = getFactorValue(factors, 'aw') ?? 1;
      const pH = getFactorValue(factors, 'pH') ?? 7.0;
      if (!Number.isFinite(C)) return Number.NaN;
      const safeZC = Math.abs(zC) < 1e-6 ? (zC < 0 ? -1e-6 : 1e-6) : zC;
      const safeZT = Math.abs(zT) < 1e-6 ? (zT < 0 ? -1e-6 : 1e-6) : zT;
      const safeZaw = Math.abs(zaw) < 1e-6 ? (zaw < 0 ? -1e-6 : 1e-6) : zaw;
      const safeZpH = Math.abs(zpH) < 1e-6 ? (zpH < 0 ? -1e-6 : 1e-6) : zpH;
      return logDref - (C - Cref) / safeZC - (T - Tref) / safeZT - (aw - awRef) / safeZaw - (pH - pHref) / safeZpH;
    },
    responseTransforms: ['logD'],
    predictParameterValue: (factors, params) => Math.pow(10, SECONDARY_MODELS.CHEMICAL_QUAD.predictY(factors, params)),
  },

  LINEAR_CHEM: {
    id: 'LINEAR_CHEM',
    name: 'Linear-Chemical',
    description: 'Simple linear model: y = a + b·C (no transformation).',
    scenarios: ['chemical'],
    factorKeys: ['concentration'],
    xLabel: 'Concentration C (ppm)',
    yLabel: 'parameter',
    responseLabel: 'parameter value',
    params: [
      { name: 'a', label: 'intercept', defaultValue: 1 },
      { name: 'b', label: 'slope', defaultValue: 0 },
    ],
    formula: 'y = a + b·C',
    getX: (factors) => getFactorValue(factors, 'concentration'),
    predictY: (factors, { a, b }) => {
      const C = getFactorValue(factors, 'concentration');
      if (!Number.isFinite(C)) return Number.NaN;
      return a + b * C;
    },
    responseTransforms: ['identity'],
    predictParameterValue: (factors, params) => SECONDARY_MODELS.LINEAR_CHEM.predictY(factors, params),
  },

  // ── Irradiation secondary models ──────────────────────────────────────

  IRRAD_DOSE: {
    id: 'IRRAD_DOSE',
    name: 'Irradiation Dose Rate (z_DR model)',
    description: 'Irradiation z-value model: log D vs. dose rate is linear.',
    scenarios: ['irradiation'],
    factorKeys: ['doseRate'],
    xLabel: 'Dose Rate DR (kGy/h)',
    yLabel: 'log₁₀(D)',
    responseLabel: 'D value',
    params: [
      { name: 'logDref', label: 'log₁₀(D_ref)', defaultValue: 1 },
      { name: 'DRref', label: 'DR_ref (kGy/h)', defaultValue: 5, fixed: true },
      { name: 'zDR', label: 'z_DR (kGy/h)', defaultValue: 5, min: 0.01 },
    ],
    formula: 'log D = log D_ref − (DR − DR_ref) / z_DR',
    getX: (factors) => getFactorValue(factors, 'doseRate'),
    predictY: (factors, { logDref, DRref, zDR }) => {
      const DR = getFactorValue(factors, 'doseRate');
      if (!Number.isFinite(DR)) return Number.NaN;
      const safeZDR = Math.abs(zDR) < 1e-6 ? (zDR < 0 ? -1e-6 : 1e-6) : zDR;
      return logDref - (DR - DRref) / safeZDR;
    },
    responseTransforms: ['logD'],
    predictParameterValue: (factors, params) => Math.pow(10, SECONDARY_MODELS.IRRAD_DOSE.predictY(factors, params)),
  },

  IRRAD_DOSE_TEMP: {
    id: 'IRRAD_DOSE_TEMP',
    name: 'Irradiation DR + Temp (DR + T)',
    description: 'Extended irradiation model: log D depends on dose rate and temperature.',
    scenarios: ['irradiation'],
    factorKeys: ['doseRate', 'temp'],
    xLabel: 'Dose Rate DR (kGy/h)',
    yLabel: 'log₁₀(D)',
    responseLabel: 'D value',
    params: [
      { name: 'logDref', label: 'log₁₀(D_ref)', defaultValue: 1 },
      { name: 'DRref', label: 'DR_ref (kGy/h)', defaultValue: 5, fixed: true },
      { name: 'zDR', label: 'z_DR (kGy/h)', defaultValue: 5, min: 0.01 },
      { name: 'Tref', label: 'T_ref (°C)', defaultValue: 25, fixed: true },
      { name: 'zT', label: 'z_T (°C)', defaultValue: 20, min: 0.01 },
    ],
    formula: 'log D = log D_ref − (DR − DR_ref)/z_DR − (T − T_ref)/z_T',
    getX: (factors) => getFactorValue(factors, 'doseRate'),
    predictY: (factors, { logDref, DRref, zDR, Tref, zT }) => {
      const DR = getFactorValue(factors, 'doseRate');
      const T = getFactorValue(factors, 'temp') ?? 25;
      if (!Number.isFinite(DR)) return Number.NaN;
      const safeZDR = Math.abs(zDR) < 1e-6 ? (zDR < 0 ? -1e-6 : 1e-6) : zDR;
      const safeZT = Math.abs(zT) < 1e-6 ? (zT < 0 ? -1e-6 : 1e-6) : zT;
      return logDref - (DR - DRref) / safeZDR - (T - Tref) / safeZT;
    },
    responseTransforms: ['logD'],
    predictParameterValue: (factors, params) => Math.pow(10, SECONDARY_MODELS.IRRAD_DOSE_TEMP.predictY(factors, params)),
  },

  IRRAD_DOSE_AW: {
    id: 'IRRAD_DOSE_AW',
    name: 'Irradiation DR + aw (DR + aw)',
    description: 'Extended irradiation model: log D depends on dose rate and water activity.',
    scenarios: ['irradiation'],
    factorKeys: ['doseRate', 'aw'],
    xLabel: 'Dose Rate DR (kGy/h)',
    yLabel: 'log₁₀(D)',
    responseLabel: 'D value',
    params: [
      { name: 'logDref', label: 'log₁₀(D_ref)', defaultValue: 1 },
      { name: 'DRref', label: 'DR_ref (kGy/h)', defaultValue: 5, fixed: true },
      { name: 'zDR', label: 'z_DR (kGy/h)', defaultValue: 5, min: 0.01 },
      { name: 'awRef', label: 'aw_ref', defaultValue: 1, min: 0, max: 1, fixed: true },
      { name: 'zaw', label: 'z_aw', defaultValue: 0.2 },
    ],
    formula: 'log D = log D_ref − (DR − DR_ref)/z_DR − (aw − aw_ref)/z_aw',
    getX: (factors) => getFactorValue(factors, 'doseRate'),
    predictY: (factors, { logDref, DRref, zDR, awRef, zaw }) => {
      const DR = getFactorValue(factors, 'doseRate');
      const aw = getFactorValue(factors, 'aw') ?? 1;
      if (!Number.isFinite(DR)) return Number.NaN;
      const safeZDR = Math.abs(zDR) < 1e-6 ? (zDR < 0 ? -1e-6 : 1e-6) : zDR;
      const safeZaw = Math.abs(zaw) < 1e-6 ? (zaw < 0 ? -1e-6 : 1e-6) : zaw;
      return logDref - (DR - DRref) / safeZDR - (aw - awRef) / safeZaw;
    },
    responseTransforms: ['logD'],
    predictParameterValue: (factors, params) => Math.pow(10, SECONDARY_MODELS.IRRAD_DOSE_AW.predictY(factors, params)),
  },

  IRRAD_TRIPLE: {
    id: 'IRRAD_TRIPLE',
    name: 'Irradiation Triple (DR + T + aw)',
    description: 'Full three-factor model: log D depends on dose rate, temperature and water activity.',
    scenarios: ['irradiation'],
    factorKeys: ['doseRate', 'temp', 'aw'],
    xLabel: 'Dose Rate DR (kGy/h)',
    yLabel: 'log₁₀(D)',
    responseLabel: 'D value',
    params: [
      { name: 'logDref', label: 'log₁₀(D_ref)', defaultValue: 1 },
      { name: 'DRref', label: 'DR_ref (kGy/h)', defaultValue: 5, fixed: true },
      { name: 'zDR', label: 'z_DR (kGy/h)', defaultValue: 5, min: 0.01 },
      { name: 'Tref', label: 'T_ref (°C)', defaultValue: 25, fixed: true },
      { name: 'zT', label: 'z_T (°C)', defaultValue: 20, min: 0.01 },
      { name: 'awRef', label: 'aw_ref', defaultValue: 1, min: 0, max: 1, fixed: true },
      { name: 'zaw', label: 'z_aw', defaultValue: 0.2 },
    ],
    formula: 'log D = log D_ref − (DR − DR_ref)/z_DR − (T − T_ref)/z_T − (aw − aw_ref)/z_aw',
    getX: (factors) => getFactorValue(factors, 'doseRate'),
    predictY: (factors, { logDref, DRref, zDR, Tref, zT, awRef, zaw }) => {
      const DR = getFactorValue(factors, 'doseRate');
      const T = getFactorValue(factors, 'temp') ?? 25;
      const aw = getFactorValue(factors, 'aw') ?? 1;
      if (!Number.isFinite(DR)) return Number.NaN;
      const safeZDR = Math.abs(zDR) < 1e-6 ? (zDR < 0 ? -1e-6 : 1e-6) : zDR;
      const safeZT = Math.abs(zT) < 1e-6 ? (zT < 0 ? -1e-6 : 1e-6) : zT;
      const safeZaw = Math.abs(zaw) < 1e-6 ? (zaw < 0 ? -1e-6 : 1e-6) : zaw;
      return logDref - (DR - DRref) / safeZDR - (T - Tref) / safeZT - (aw - awRef) / safeZaw;
    },
    responseTransforms: ['logD'],
    predictParameterValue: (factors, params) => Math.pow(10, SECONDARY_MODELS.IRRAD_TRIPLE.predictY(factors, params)),
  },

  LINEAR_IRRAD: {
    id: 'LINEAR_IRRAD',
    name: 'Linear-Irradiation',
    description: 'Simple linear model: y = a + b·DR (no transformation).',
    scenarios: ['irradiation'],
    factorKeys: ['doseRate'],
    xLabel: 'Dose Rate DR (kGy/h)',
    yLabel: 'parameter',
    responseLabel: 'parameter value',
    params: [
      { name: 'a', label: 'intercept', defaultValue: 1 },
      { name: 'b', label: 'slope', defaultValue: 0 },
    ],
    formula: 'y = a + b·DR',
    getX: (factors) => getFactorValue(factors, 'doseRate'),
    predictY: (factors, { a, b }) => {
      const DR = getFactorValue(factors, 'doseRate');
      if (!Number.isFinite(DR)) return Number.NaN;
      return a + b * DR;
    },
    responseTransforms: ['identity'],
    predictParameterValue: (factors, params) => SECONDARY_MODELS.LINEAR_IRRAD.predictY(factors, params),
  },

  /* ────────────────────────────────────────────────────────────────
   * CUSTOM MODE — dynamic z-value models (1-, 2-, 3-factor)
   * Factor keys are resolved at runtime via getCustomFactors().
   * ──────────────────────────────────────────────────────────────── */

  CUSTOM_Z1: {
    id: 'CUSTOM_Z1',
    name: 'z-value (1 factor)',
    description: 'Single-factor z-value model for custom mode: log D = log D_ref - (X₁ - X₁_ref) / z₁',
    scenarios: ['custom'],
    get factorKeys() { return _customConditionFactorKeys().slice(0, 1); },
    xLabel: 'Factor 1',
    yLabel: 'log₁₀(D)',
    responseLabel: 'D value',
    get params() { return _customZ1Params(); },
    get formula() { return _customZ1Formula(); },
    getX: (factors) => {
      const keys = _customConditionFactorKeys();
      return getFactorValue(factors, keys[0]);
    },
    predictY: (factors, params) => {
      const keys = _customConditionFactorKeys();
      const x1 = getFactorValue(factors, keys[0]);
      if (!Number.isFinite(x1)) return Number.NaN;
      const z1 = Math.abs(params.z1) < 1e-6 ? 1e-6 : params.z1;
      return params.logDref - (x1 - params.x1ref) / z1;
    },
    responseTransforms: ['logD'],
    predictParameterValue: (factors, params) => Math.pow(10, SECONDARY_MODELS.CUSTOM_Z1.predictY(factors, params)),
  },

  CUSTOM_Z2: {
    id: 'CUSTOM_Z2',
    name: 'z-value (2 factors)',
    description: 'Two-factor z-value model for custom mode.',
    scenarios: ['custom'],
    get factorKeys() { return _customConditionFactorKeys().slice(0, 2); },
    xLabel: 'Factor 1',
    yLabel: 'log₁₀(D)',
    responseLabel: 'D value',
    get params() { return _customZ2Params(); },
    get formula() { return _customZ2Formula(); },
    getX: (factors) => {
      const keys = _customConditionFactorKeys();
      return getFactorValue(factors, keys[0]);
    },
    predictY: (factors, params) => {
      const keys = _customConditionFactorKeys();
      const x1 = getFactorValue(factors, keys[0]);
      const x2 = getFactorValue(factors, keys[1]);
      if (!Number.isFinite(x1)) return Number.NaN;
      const z1 = Math.abs(params.z1) < 1e-6 ? 1e-6 : params.z1;
      const z2 = Math.abs(params.z2) < 1e-6 ? 1e-6 : params.z2;
      let result = params.logDref - (x1 - params.x1ref) / z1;
      if (Number.isFinite(x2)) result -= (x2 - params.x2ref) / z2;
      return result;
    },
    responseTransforms: ['logD'],
    predictParameterValue: (factors, params) => Math.pow(10, SECONDARY_MODELS.CUSTOM_Z2.predictY(factors, params)),
  },

  CUSTOM_Z3: {
    id: 'CUSTOM_Z3',
    name: 'z-value (3 factors)',
    description: 'Three-factor z-value model for custom mode.',
    scenarios: ['custom'],
    get factorKeys() { return _customConditionFactorKeys().slice(0, 3); },
    xLabel: 'Factor 1',
    yLabel: 'log₁₀(D)',
    responseLabel: 'D value',
    get params() { return _customZ3Params(); },
    get formula() { return _customZ3Formula(); },
    getX: (factors) => {
      const keys = _customConditionFactorKeys();
      return getFactorValue(factors, keys[0]);
    },
    predictY: (factors, params) => {
      const keys = _customConditionFactorKeys();
      const x1 = getFactorValue(factors, keys[0]);
      const x2 = getFactorValue(factors, keys[1]);
      const x3 = getFactorValue(factors, keys[2]);
      if (!Number.isFinite(x1)) return Number.NaN;
      const z1 = Math.abs(params.z1) < 1e-6 ? 1e-6 : params.z1;
      const z2 = Math.abs(params.z2) < 1e-6 ? 1e-6 : params.z2;
      const z3 = Math.abs(params.z3) < 1e-6 ? 1e-6 : params.z3;
      let result = params.logDref - (x1 - params.x1ref) / z1;
      if (Number.isFinite(x2)) result -= (x2 - params.x2ref) / z2;
      if (Number.isFinite(x3)) result -= (x3 - params.x3ref) / z3;
      return result;
    },
    responseTransforms: ['logD'],
    predictParameterValue: (factors, params) => Math.pow(10, SECONDARY_MODELS.CUSTOM_Z3.predictY(factors, params)),
  },

  LINEAR_CUSTOM: {
    id: 'LINEAR_CUSTOM',
    name: 'Linear (Custom)',
    description: 'Simple linear model for custom mode: y = a + b·X₁.',
    scenarios: ['custom'],
    get factorKeys() { return _customConditionFactorKeys().slice(0, 1); },
    xLabel: 'Factor 1',
    yLabel: 'parameter',
    responseLabel: 'parameter value',
    params: [
      { name: 'a', label: 'intercept', defaultValue: 1 },
      { name: 'b', label: 'slope', defaultValue: 0 },
    ],
    get formula() {
      const keys = _customConditionFactorKeys();
      const name = _customFactorLabel(keys[0]);
      return `y = a + b·${name}`;
    },
    getX: (factors) => {
      const keys = _customConditionFactorKeys();
      return getFactorValue(factors, keys[0]);
    },
    predictY: (factors, { a, b }) => {
      const keys = _customConditionFactorKeys();
      const x = getFactorValue(factors, keys[0]);
      if (!Number.isFinite(x)) return Number.NaN;
      return a + b * x;
    },
    responseTransforms: ['identity'],
    predictParameterValue: (factors, params) => SECONDARY_MODELS.LINEAR_CUSTOM.predictY(factors, params),
  },
};

export const MODEL_SECONDARY_CONFIG = {
  LOG_LINEAR: {
    factorKeys: ['temp', 'aw', 'pressure', 'intensity', 'electricField', 'concentration', 'turbidity', 'conductivity', 'pH', 'doseRate'],
    targets: {
      D: {
        label: 'D value',
        allowedSecondaryModels: [
          'BIGELOW', 'ARRHENIUS', 'SQRTMODEL', 'EXTENDED_BIGELOW', 'EXTENDED_BIGELOW_PH', 'BIGELOW_TRIPLE',
          'BIGELOW_PRESSURE', 'EXTENDED_BIGELOW_PRESSURE', 'PATP_TRIPLE',
          'BIGELOW_PRESSURE_PH', 'BIGELOW_PRESSURE_TEMP_PH', 'BIGELOW_PRESSURE_AW_PH',
          'LINEAR_PRESSURE', 'ARRHENIUS_EYRING',
          'PHOTO_INTENSITY', 'PHOTO_INTENSITY_TURBIDITY', 'PHOTO_INTENSITY_AW', 'PHOTO_TRIPLE', 'LINEAR_PHOTO',
          'PEF_FIELD', 'PEF_FIELD_CONDUCTIVITY', 'PEF_FIELD_AW', 'PEF_TRIPLE', 'LINEAR_PEF',
          'CHEMICAL_CONC', 'CHEMICAL_CONC_TEMP', 'CHEMICAL_CONC_PH', 'CHEMICAL_CONC_AW',
          'CHEMICAL_CONC_TEMP_PH', 'CHEMICAL_TRIPLE', 'CHEMICAL_QUAD', 'LINEAR_CHEM',
          'IRRAD_DOSE', 'IRRAD_DOSE_TEMP', 'IRRAD_DOSE_AW', 'IRRAD_TRIPLE', 'LINEAR_IRRAD',
          'AVERAGE',
        ],
        defaultSecondaryModelId: 'BIGELOW',
        responseTransformMap: {
          BIGELOW: 'logD',
          ARRHENIUS: 'lnValue',
          SQRTMODEL: 'sqrtValue',
          EXTENDED_BIGELOW: 'logD',
          EXTENDED_BIGELOW_PH: 'logD',
          BIGELOW_TRIPLE: 'logD',
          BIGELOW_PRESSURE: 'logD',
          EXTENDED_BIGELOW_PRESSURE: 'logD',
          PATP_TRIPLE: 'logD',
          BIGELOW_PRESSURE_PH: 'logD',
          BIGELOW_PRESSURE_TEMP_PH: 'logD',
          BIGELOW_PRESSURE_AW_PH: 'logD',
          LINEAR_PRESSURE: 'identity',
          ARRHENIUS_EYRING: 'lnValue',
          PHOTO_INTENSITY: 'logD',
          PHOTO_INTENSITY_TURBIDITY: 'logD',
          PHOTO_INTENSITY_AW: 'logD',
          PHOTO_TRIPLE: 'logD',
          LINEAR_PHOTO: 'identity',
          PEF_FIELD: 'logD',
          PEF_FIELD_CONDUCTIVITY: 'logD',
          PEF_FIELD_AW: 'logD',
          PEF_TRIPLE: 'logD',
          LINEAR_PEF: 'identity',
          CHEMICAL_CONC: 'logD',
          CHEMICAL_CONC_TEMP: 'logD',
          CHEMICAL_CONC_PH: 'logD',
          CHEMICAL_CONC_AW: 'logD',
          CHEMICAL_CONC_TEMP_PH: 'logD',
          CHEMICAL_TRIPLE: 'logD',
          CHEMICAL_QUAD: 'logD',
          LINEAR_CHEM: 'identity',
          IRRAD_DOSE: 'logD',
          IRRAD_DOSE_TEMP: 'logD',
          IRRAD_DOSE_AW: 'logD',
          IRRAD_TRIPLE: 'logD',
          LINEAR_IRRAD: 'identity',
          AVERAGE: 'identity',
        },
        rateLikeModels: ['ARRHENIUS', 'SQRTMODEL', 'ARRHENIUS_EYRING'],
        getValue: (fitResult) => {
          const kmax = fitResult?.params?.kmax;
          return Number.isFinite(kmax) && kmax > 0 ? Math.LN10 / kmax : null;
        },
        mapsToParam: 'kmax',
        invertPredictedValue: (predictedD) => Number.isFinite(predictedD) && predictedD > 0 ? Math.LN10 / predictedD : Number.NaN,
        // |dD/dkmax| = D² / ln(10), for comparing D and kmax fits.
        primaryParameterLogJacobian: (D) => 2 * Math.log(D) - Math.log(Math.LN10),
        unit: 'min',
      },
      kmax: {
        label: 'k_max',
        allowedSecondaryModels: ['ARRHENIUS', 'SQRTMODEL', 'LINEAR_PRESSURE', 'ARRHENIUS_EYRING', 'LINEAR_PHOTO', 'LINEAR_PEF', 'LINEAR_CHEM', 'LINEAR_IRRAD'],
        defaultSecondaryModelId: 'ARRHENIUS',
        responseTransform: 'lnValue',
        responseTransformMap: {
          ARRHENIUS: 'lnValue',
          SQRTMODEL: 'sqrtValue',
          LINEAR_PRESSURE: 'identity',
          ARRHENIUS_EYRING: 'lnValue',
          LINEAR_PHOTO: 'identity',
          LINEAR_PEF: 'identity',
          LINEAR_CHEM: 'identity',
          LINEAR_IRRAD: 'identity',
        },
        rateLikeModels: [],
        getValue: (fitResult) => fitResult?.params?.kmax,
        unit: 'min⁻¹',
      },
    },
  },
  WEIBULL: {
    factorKeys: ['temp', 'aw', 'pressure', 'intensity', 'electricField', 'concentration', 'turbidity', 'conductivity', 'pH', 'doseRate'],
    targets: {
      delta: {
        label: 'δ (scale)',
        allowedSecondaryModels: [
          'BIGELOW', 'ARRHENIUS', 'SQRTMODEL', 'EXTENDED_BIGELOW', 'EXTENDED_BIGELOW_PH', 'BIGELOW_TRIPLE',
          'BIGELOW_PRESSURE', 'EXTENDED_BIGELOW_PRESSURE', 'PATP_TRIPLE',
          'BIGELOW_PRESSURE_PH', 'BIGELOW_PRESSURE_TEMP_PH', 'BIGELOW_PRESSURE_AW_PH',
          'LINEAR_PRESSURE', 'ARRHENIUS_EYRING',
          'PHOTO_INTENSITY', 'PHOTO_INTENSITY_TURBIDITY', 'PHOTO_INTENSITY_AW', 'PHOTO_TRIPLE', 'LINEAR_PHOTO',
          'PEF_FIELD', 'PEF_FIELD_CONDUCTIVITY', 'PEF_FIELD_AW', 'PEF_TRIPLE', 'LINEAR_PEF',
          'CHEMICAL_CONC', 'CHEMICAL_CONC_TEMP', 'CHEMICAL_CONC_PH', 'CHEMICAL_CONC_AW',
          'CHEMICAL_CONC_TEMP_PH', 'CHEMICAL_TRIPLE', 'CHEMICAL_QUAD', 'LINEAR_CHEM',
          'IRRAD_DOSE', 'IRRAD_DOSE_TEMP', 'IRRAD_DOSE_AW', 'IRRAD_TRIPLE', 'LINEAR_IRRAD',
          'AVERAGE',
        ],
        defaultSecondaryModelId: 'ARRHENIUS',
        responseTransformMap: {
          BIGELOW: 'logD',
          ARRHENIUS: 'lnValue',
          SQRTMODEL: 'sqrtValue',
          EXTENDED_BIGELOW: 'logD',
          EXTENDED_BIGELOW_PH: 'logD',
          BIGELOW_TRIPLE: 'logD',
          BIGELOW_PRESSURE: 'logD',
          EXTENDED_BIGELOW_PRESSURE: 'logD',
          PATP_TRIPLE: 'logD',
          BIGELOW_PRESSURE_PH: 'logD',
          BIGELOW_PRESSURE_TEMP_PH: 'logD',
          BIGELOW_PRESSURE_AW_PH: 'logD',
          LINEAR_PRESSURE: 'identity',
          ARRHENIUS_EYRING: 'lnValue',
          PHOTO_INTENSITY: 'logD',
          PHOTO_INTENSITY_TURBIDITY: 'logD',
          PHOTO_INTENSITY_AW: 'logD',
          PHOTO_TRIPLE: 'logD',
          LINEAR_PHOTO: 'identity',
          PEF_FIELD: 'logD',
          PEF_FIELD_CONDUCTIVITY: 'logD',
          PEF_FIELD_AW: 'logD',
          PEF_TRIPLE: 'logD',
          LINEAR_PEF: 'identity',
          CHEMICAL_CONC: 'logD',
          CHEMICAL_CONC_TEMP: 'logD',
          CHEMICAL_CONC_PH: 'logD',
          CHEMICAL_CONC_AW: 'logD',
          CHEMICAL_CONC_TEMP_PH: 'logD',
          CHEMICAL_TRIPLE: 'logD',
          CHEMICAL_QUAD: 'logD',
          LINEAR_CHEM: 'identity',
          IRRAD_DOSE: 'logD',
          IRRAD_DOSE_TEMP: 'logD',
          IRRAD_DOSE_AW: 'logD',
          IRRAD_TRIPLE: 'logD',
          LINEAR_IRRAD: 'identity',
          AVERAGE: 'identity',
        },
        rateLikeModels: ['ARRHENIUS', 'SQRTMODEL', 'ARRHENIUS_EYRING'],
        getValue: (fitResult) => fitResult?.params?.delta,
        unit: 'min',
      },
      p: {
        label: 'p (shape)',
        allowedSecondaryModels: [
          'LINEAR', 'LINEAR_PRESSURE', 'LINEAR_PHOTO', 'LINEAR_PEF', 'LINEAR_CHEM', 'LINEAR_IRRAD', 'AVERAGE',
        ],
        defaultSecondaryModelId: 'LINEAR',
        responseTransformMap: {
          LINEAR: 'identity',
          LINEAR_PRESSURE: 'identity',
          LINEAR_PHOTO: 'identity',
          LINEAR_PEF: 'identity',
          LINEAR_CHEM: 'identity',
          LINEAR_IRRAD: 'identity',
          AVERAGE: 'identity',
        },
        rateLikeModels: [],
        getValue: (fitResult) => fitResult?.params?.p,
        unit: 'dimensionless',
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
  const all = getFactorDefsWithCustom();
  return all.filter((factor) => keys.includes(factor.key));
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
    const mapped = config.responseTransformMap[secondaryModelId];
    if (mapped) return mapped;
  }
  // For dynamically injected models (custom mode), infer from the model's own responseTransforms
  if (secondaryModelId) {
    const model = SECONDARY_MODELS[secondaryModelId];
    if (model?.responseTransforms?.length) return model.responseTransforms[0];
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

// Convert a regression response to the target's actual units, including the
// reciprocal used when a rate model represents a D/delta time scale.
export function secondaryResponseToRaw({ value, targetConfig = {}, secondaryModelId }) {
  if (!Number.isFinite(value)) return null;
  const transform = resolveTransform(targetConfig, secondaryModelId);
  const fitValue = transform === 'logD' ? Math.pow(10, value)
    : transform === 'lnValue' ? Math.exp(value)
      : transform === 'sqrtValue' ? value * value : value;
  return fromFitValue(fitValue, targetConfig, secondaryModelId);
}

// Change-of-variable density: p(raw) = p(g(raw)) * |g'(raw)|.
// The reciprocal used for time-scale targets is part of g, so its derivative
// must be included before the log/square-root response derivative.
function responseLogJacobian(rawValue, config, secondaryModelId) {
  const fitValue = toFitValue(rawValue, config, secondaryModelId);
  const transform = resolveTransform(config, secondaryModelId);
  let logDerivative = isRateLike(config, secondaryModelId) ? -2 * Math.log(rawValue) : 0;
  if (transform === 'logD') logDerivative -= Math.log(fitValue) + Math.log(Math.LN10);
  else if (transform === 'lnValue') logDerivative -= Math.log(fitValue);
  else if (transform === 'sqrtValue') logDerivative -= Math.log(2) + 0.5 * Math.log(fitValue);
  return logDerivative;
}

export function predictRawParameterValue({ secondaryModelId, params, factors, targetConfig }) {
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
    const temps = rows.map((r) => r.x);
    const meanT = temps.reduce((s, v) => s + v, 0) / temps.length;
    const meanY = ys.reduce((s, v) => s + v, 0) / ys.length;
    const z = Math.abs(b) > 1e-10 ? -1 / b : 7;
    return { logDref: meanY, Tref: meanT, z };
  }

  if (secondaryModelId === 'EXTENDED_BIGELOW') {
    const temps = rows.map((r) => getFactorValue(r.factors, 'temp') ?? r.x);
    const aws = rows.map((r) => getFactorValue(r.factors, 'aw') ?? 1);
    const n = rows.length;
    const meanT = temps.reduce((s, v) => s + v, 0) / n;
    const meanAw = aws.reduce((s, v) => s + v, 0) / n;
    const meanY = ys.reduce((s, v) => s + v, 0) / n;

    let s11 = 0; let s22 = 0; let s12 = 0; let sy1 = 0; let sy2 = 0;
    for (let i = 0; i < n; i++) {
      const dT = temps[i] - meanT;
      const dAw = aws[i] - meanAw;
      const dY = ys[i] - meanY;
      s11 += dT * dT;
      s22 += dAw * dAw;
      s12 += dT * dAw;
      sy1 += dT * dY;
      sy2 += dAw * dY;
    }

    const det = s11 * s22 - s12 * s12;
    let b1; let b2;
    if (Math.abs(det) < 1e-12) {
      b1 = s11 > 0 ? sy1 / s11 : 0;
      b2 = 0;
    } else {
      b1 = (s22 * sy1 - s12 * sy2) / det;
      b2 = (s11 * sy2 - s12 * sy1) / det;
    }

    const Tref = meanT;
    const awRef = meanAw;
    const zT = Math.abs(b1) > 1e-10 ? -1 / b1 : 10;
    const zaw = Math.abs(b2) > 1e-10 ? -1 / b2 : 0.2;
    const logDref = meanY;
    return { logDref, Tref, zT, awRef, zaw };
  }

  if (secondaryModelId === 'EXTENDED_BIGELOW_PH') {
    const temps = rows.map((r) => getFactorValue(r.factors, 'temp') ?? r.x);
    const pHs = rows.map((r) => getFactorValue(r.factors, 'pH') ?? 7.0);
    const n = rows.length;
    const meanT = temps.reduce((s, v) => s + v, 0) / n;
    const meanPH = pHs.reduce((s, v) => s + v, 0) / n;
    const meanY = ys.reduce((s, v) => s + v, 0) / n;

    let s11 = 0; let s22 = 0; let s12 = 0; let sy1 = 0; let sy2 = 0;
    for (let i = 0; i < n; i++) {
      const dT = temps[i] - meanT;
      const dpH = pHs[i] - meanPH;
      const dY = ys[i] - meanY;
      s11 += dT * dT;
      s22 += dpH * dpH;
      s12 += dT * dpH;
      sy1 += dT * dY;
      sy2 += dpH * dY;
    }

    const det = s11 * s22 - s12 * s12;
    let b1; let b2;
    if (Math.abs(det) < 1e-12) {
      b1 = s11 > 0 ? sy1 / s11 : 0;
      b2 = 0;
    } else {
      b1 = (s22 * sy1 - s12 * sy2) / det;
      b2 = (s11 * sy2 - s12 * sy1) / det;
    }

    const Tref = meanT;
    const pHref = meanPH;
    const zT = Math.abs(b1) > 1e-10 ? -1 / b1 : 7;
    const zpH = Math.abs(b2) > 1e-10 ? -1 / b2 : 2.0;
    const logDref = meanY;
    return { logDref, Tref, zT, pHref, zpH };
  }

  if (secondaryModelId === 'BIGELOW_TRIPLE') {
    const temps = rows.map((r) => getFactorValue(r.factors, 'temp') ?? r.x);
    const aws = rows.map((r) => getFactorValue(r.factors, 'aw') ?? 1);
    const pHs = rows.map((r) => getFactorValue(r.factors, 'pH') ?? 7.0);
    const n = rows.length;
    const meanT = temps.reduce((s, v) => s + v, 0) / n;
    const meanAw = aws.reduce((s, v) => s + v, 0) / n;
    const meanPH = pHs.reduce((s, v) => s + v, 0) / n;
    const meanY = ys.reduce((s, v) => s + v, 0) / n;

    let s11 = 0; let s22 = 0; let s33 = 0;
    let s12 = 0; let s13 = 0; let s23 = 0;
    let sy1 = 0; let sy2 = 0; let sy3 = 0;
    for (let i = 0; i < n; i++) {
      const dT = temps[i] - meanT;
      const dAw = aws[i] - meanAw;
      const dpH = pHs[i] - meanPH;
      const dY = ys[i] - meanY;
      s11 += dT * dT; s22 += dAw * dAw; s33 += dpH * dpH;
      s12 += dT * dAw; s13 += dT * dpH; s23 += dAw * dpH;
      sy1 += dT * dY; sy2 += dAw * dY; sy3 += dpH * dY;
    }

    const det = s11 * (s22 * s33 - s23 * s23) - s12 * (s12 * s33 - s23 * s13) + s13 * (s12 * s23 - s22 * s13);
    let b1; let b2; let b3;
    if (Math.abs(det) < 1e-20) {
      b1 = s11 > 0 ? sy1 / s11 : 0;
      b2 = s22 > 0 ? sy2 / s22 : 0;
      b3 = s33 > 0 ? sy3 / s33 : 0;
    } else {
      b1 = ((s22 * s33 - s23 * s23) * sy1 + (s13 * s23 - s12 * s33) * sy2 + (s12 * s23 - s13 * s22) * sy3) / det;
      b2 = ((s23 * s13 - s12 * s33) * sy1 + (s11 * s33 - s13 * s13) * sy2 + (s12 * s13 - s11 * s23) * sy3) / det;
      b3 = ((s12 * s23 - s22 * s13) * sy1 + (s12 * s13 - s11 * s23) * sy2 + (s11 * s22 - s12 * s12) * sy3) / det;
    }

    const Tref = meanT;
    const awRef = meanAw;
    const pHref = meanPH;
    const zT = Math.abs(b1) > 1e-10 ? -1 / b1 : 7;
    const zaw = Math.abs(b2) > 1e-10 ? -1 / b2 : 0.2;
    const zpH = Math.abs(b3) > 1e-10 ? -1 / b3 : 2.0;
    const logDref = meanY;
    return { logDref, Tref, zT, awRef, zaw, pHref, zpH };
  }

  if (secondaryModelId === 'BIGELOW_PRESSURE') {
    const ps = rows.map((r) => r.x);
    const meanP = ps.reduce((s, v) => s + v, 0) / ps.length;
    const meanY = ys.reduce((s, v) => s + v, 0) / ys.length;
    const zP = Math.abs(b) > 1e-10 ? -1 / b : 100;
    return { logDref: meanY, Pref: meanP, zP };
  }

  if (secondaryModelId === 'EXTENDED_BIGELOW_PRESSURE') {
    const pressures = rows.map((r) => getFactorValue(r.factors, 'pressure') ?? r.x);
    const aws = rows.map((r) => getFactorValue(r.factors, 'aw') ?? 1);
    const n = rows.length;
    const meanP = pressures.reduce((s, v) => s + v, 0) / n;
    const meanAw = aws.reduce((s, v) => s + v, 0) / n;
    const meanY = ys.reduce((s, v) => s + v, 0) / n;

    let s11 = 0; let s22 = 0; let s12 = 0; let sy1 = 0; let sy2 = 0;
    for (let i = 0; i < n; i++) {
      const dP = pressures[i] - meanP;
      const dAw = aws[i] - meanAw;
      const dY = ys[i] - meanY;
      s11 += dP * dP;
      s22 += dAw * dAw;
      s12 += dP * dAw;
      sy1 += dP * dY;
      sy2 += dAw * dY;
    }

    const det = s11 * s22 - s12 * s12;
    let b1; let b2;
    if (Math.abs(det) < 1e-12) {
      b1 = s11 > 0 ? sy1 / s11 : 0;
      b2 = 0;
    } else {
      b1 = (s22 * sy1 - s12 * sy2) / det;
      b2 = (s11 * sy2 - s12 * sy1) / det;
    }

    const Pref = meanP;
    const awRef = meanAw;
    const zP = Math.abs(b1) > 1e-10 ? -1 / b1 : 100;
    const zaw = Math.abs(b2) > 1e-10 ? -1 / b2 : 0.2;
    const logDref = meanY;
    return { logDref, Pref, zP, awRef, zaw };
  }

  if (secondaryModelId === 'PATP_TRIPLE') {
    const temps = rows.map((r) => getFactorValue(r.factors, 'temp') ?? r.x);
    const pressures = rows.map((r) => getFactorValue(r.factors, 'pressure') ?? 400);
    const aws = rows.map((r) => getFactorValue(r.factors, 'aw') ?? 1);
    const n = rows.length;
    const meanT = temps.reduce((s, v) => s + v, 0) / n;
    const meanP = pressures.reduce((s, v) => s + v, 0) / n;
    const meanAw = aws.reduce((s, v) => s + v, 0) / n;
    const meanY = ys.reduce((s, v) => s + v, 0) / n;

    // Simple OLS for y = b0 + b1*T + b2*P + b3*aw (normal equations via centered vars)
    let s11 = 0; let s22 = 0; let s33 = 0;
    let s12 = 0; let s13 = 0; let s23 = 0;
    let sy1 = 0; let sy2 = 0; let sy3 = 0;
    for (let i = 0; i < n; i++) {
      const dT = temps[i] - meanT;
      const dP = pressures[i] - meanP;
      const dAw = aws[i] - meanAw;
      const dY = ys[i] - meanY;
      s11 += dT * dT; s22 += dP * dP; s33 += dAw * dAw;
      s12 += dT * dP; s13 += dT * dAw; s23 += dP * dAw;
      sy1 += dT * dY; sy2 += dP * dY; sy3 += dAw * dY;
    }

    // Solve 3x3 linear system via Cramer's rule
    const det = s11 * (s22 * s33 - s23 * s23) - s12 * (s12 * s33 - s23 * s13) + s13 * (s12 * s23 - s22 * s13);
    let b1; let b2; let b3;
    if (Math.abs(det) < 1e-20) {
      b1 = s11 > 0 ? sy1 / s11 : 0;
      b2 = s22 > 0 ? sy2 / s22 : 0;
      b3 = s33 > 0 ? sy3 / s33 : 0;
    } else {
      b1 = ((s22 * s33 - s23 * s23) * sy1 + (s13 * s23 - s12 * s33) * sy2 + (s12 * s23 - s13 * s22) * sy3) / det;
      b2 = ((s23 * s13 - s12 * s33) * sy1 + (s11 * s33 - s13 * s13) * sy2 + (s12 * s13 - s11 * s23) * sy3) / det;
      b3 = ((s12 * s23 - s22 * s13) * sy1 + (s12 * s13 - s11 * s23) * sy2 + (s11 * s22 - s12 * s12) * sy3) / det;
    }

    const Tref = meanT;
    const Pref = meanP;
    const awRef = meanAw;
    const zT = Math.abs(b1) > 1e-10 ? -1 / b1 : 10;
    const zP = Math.abs(b2) > 1e-10 ? -1 / b2 : 100;
    const zaw = Math.abs(b3) > 1e-10 ? -1 / b3 : 0.2;
    const logDref = meanY;
    return { logDref, Tref, zT, Pref, zP, awRef, zaw };
  }

  if (secondaryModelId === 'BIGELOW_PRESSURE_PH') {
    const pressures = rows.map((r) => getFactorValue(r.factors, 'pressure') ?? r.x);
    const pHs = rows.map((r) => getFactorValue(r.factors, 'pH') ?? 7.0);
    const n = rows.length;
    const meanP = pressures.reduce((s, v) => s + v, 0) / n;
    const meanPH = pHs.reduce((s, v) => s + v, 0) / n;
    const meanY = ys.reduce((s, v) => s + v, 0) / n;
    let s11 = 0; let s22 = 0; let s12 = 0; let sy1 = 0; let sy2 = 0;
    for (let i = 0; i < n; i++) {
      const dP = pressures[i] - meanP; const dPH = pHs[i] - meanPH; const dY = ys[i] - meanY;
      s11 += dP * dP; s22 += dPH * dPH; s12 += dP * dPH; sy1 += dP * dY; sy2 += dPH * dY;
    }
    const det = s11 * s22 - s12 * s12;
    let b1; let b2;
    if (Math.abs(det) < 1e-12) { b1 = s11 > 0 ? sy1 / s11 : 0; b2 = 0; }
    else { b1 = (s22 * sy1 - s12 * sy2) / det; b2 = (s11 * sy2 - s12 * sy1) / det; }
    const Pref = meanP; const pHref = meanPH;
    const zP = Math.abs(b1) > 1e-10 ? -1 / b1 : 200;
    const zpH = Math.abs(b2) > 1e-10 ? -1 / b2 : 2.0;
    const logDref = meanY;
    return { logDref, Pref, zP, pHref, zpH };
  }

  if (secondaryModelId === 'BIGELOW_PRESSURE_TEMP_PH') {
    const pressures = rows.map((r) => getFactorValue(r.factors, 'pressure') ?? r.x);
    const temps = rows.map((r) => getFactorValue(r.factors, 'temp') ?? 25);
    const pHs = rows.map((r) => getFactorValue(r.factors, 'pH') ?? 7.0);
    const n = rows.length;
    const meanP = pressures.reduce((s, v) => s + v, 0) / n;
    const meanT = temps.reduce((s, v) => s + v, 0) / n;
    const meanPH = pHs.reduce((s, v) => s + v, 0) / n;
    const meanY = ys.reduce((s, v) => s + v, 0) / n;
    let s11 = 0; let s22 = 0; let s33 = 0;
    let s12 = 0; let s13 = 0; let s23 = 0;
    let sy1 = 0; let sy2 = 0; let sy3 = 0;
    for (let i = 0; i < n; i++) {
      const dP = pressures[i] - meanP; const dT = temps[i] - meanT; const dPH = pHs[i] - meanPH; const dY = ys[i] - meanY;
      s11 += dP * dP; s22 += dT * dT; s33 += dPH * dPH;
      s12 += dP * dT; s13 += dP * dPH; s23 += dT * dPH;
      sy1 += dP * dY; sy2 += dT * dY; sy3 += dPH * dY;
    }
    const det = s11 * (s22 * s33 - s23 * s23) - s12 * (s12 * s33 - s23 * s13) + s13 * (s12 * s23 - s22 * s13);
    let b1; let b2; let b3;
    if (Math.abs(det) < 1e-20) { b1 = s11 > 0 ? sy1 / s11 : 0; b2 = s22 > 0 ? sy2 / s22 : 0; b3 = s33 > 0 ? sy3 / s33 : 0; }
    else {
      b1 = ((s22 * s33 - s23 * s23) * sy1 + (s13 * s23 - s12 * s33) * sy2 + (s12 * s23 - s13 * s22) * sy3) / det;
      b2 = ((s23 * s13 - s12 * s33) * sy1 + (s11 * s33 - s13 * s13) * sy2 + (s12 * s13 - s11 * s23) * sy3) / det;
      b3 = ((s12 * s23 - s22 * s13) * sy1 + (s12 * s13 - s11 * s23) * sy2 + (s11 * s22 - s12 * s12) * sy3) / det;
    }
    const Pref = meanP; const Tref = meanT; const pHref = meanPH;
    const zP = Math.abs(b1) > 1e-10 ? -1 / b1 : 200;
    const zT = Math.abs(b2) > 1e-10 ? -1 / b2 : 10;
    const zpH = Math.abs(b3) > 1e-10 ? -1 / b3 : 2.0;
    const logDref = meanY;
    return { logDref, Pref, zP, Tref, zT, pHref, zpH };
  }

  if (secondaryModelId === 'BIGELOW_PRESSURE_AW_PH') {
    const pressures = rows.map((r) => getFactorValue(r.factors, 'pressure') ?? r.x);
    const aws = rows.map((r) => getFactorValue(r.factors, 'aw') ?? 1);
    const pHs = rows.map((r) => getFactorValue(r.factors, 'pH') ?? 7.0);
    const n = rows.length;
    const meanP = pressures.reduce((s, v) => s + v, 0) / n;
    const meanAw = aws.reduce((s, v) => s + v, 0) / n;
    const meanPH = pHs.reduce((s, v) => s + v, 0) / n;
    const meanY = ys.reduce((s, v) => s + v, 0) / n;
    let s11 = 0; let s22 = 0; let s33 = 0;
    let s12 = 0; let s13 = 0; let s23 = 0;
    let sy1 = 0; let sy2 = 0; let sy3 = 0;
    for (let i = 0; i < n; i++) {
      const dP = pressures[i] - meanP; const dAw = aws[i] - meanAw; const dPH = pHs[i] - meanPH; const dY = ys[i] - meanY;
      s11 += dP * dP; s22 += dAw * dAw; s33 += dPH * dPH;
      s12 += dP * dAw; s13 += dP * dPH; s23 += dAw * dPH;
      sy1 += dP * dY; sy2 += dAw * dY; sy3 += dPH * dY;
    }
    const det = s11 * (s22 * s33 - s23 * s23) - s12 * (s12 * s33 - s23 * s13) + s13 * (s12 * s23 - s22 * s13);
    let b1; let b2; let b3;
    if (Math.abs(det) < 1e-20) { b1 = s11 > 0 ? sy1 / s11 : 0; b2 = s22 > 0 ? sy2 / s22 : 0; b3 = s33 > 0 ? sy3 / s33 : 0; }
    else {
      b1 = ((s22 * s33 - s23 * s23) * sy1 + (s13 * s23 - s12 * s33) * sy2 + (s12 * s23 - s13 * s22) * sy3) / det;
      b2 = ((s23 * s13 - s12 * s33) * sy1 + (s11 * s33 - s13 * s13) * sy2 + (s12 * s13 - s11 * s23) * sy3) / det;
      b3 = ((s12 * s23 - s22 * s13) * sy1 + (s12 * s13 - s11 * s23) * sy2 + (s11 * s22 - s12 * s12) * sy3) / det;
    }
    const Pref = meanP; const awRef = meanAw; const pHref = meanPH;
    const zP = Math.abs(b1) > 1e-10 ? -1 / b1 : 200;
    const zaw = Math.abs(b2) > 1e-10 ? -1 / b2 : 0.2;
    const zpH = Math.abs(b3) > 1e-10 ? -1 / b3 : 2.0;
    const logDref = meanY;
    return { logDref, Pref, zP, awRef, zaw, pHref, zpH };
  }

  if (secondaryModelId === 'LINEAR_PRESSURE') {
    return { a, b };
  }

  if (secondaryModelId === 'ARRHENIUS_EYRING') {
    // ln k = lnkRef - EaR*(1/T - 1/Tref) - VaR*(P - Pref)/T
    // Regress y on [1/T_K, P/T_K] centered
    const temps = rows.map((r) => getFactorValue(r.factors, 'temp') ?? 40);
    const pressures = rows.map((r) => getFactorValue(r.factors, 'pressure') ?? r.x);
    const n = rows.length;
    const Tref = temps.reduce((s, v) => s + v, 0) / n;
    const Pref = pressures.reduce((s, v) => s + v, 0) / n;
    const Tref_K = Tref + 273.15;

    // Build X1 = 1/T_K - 1/Tref_K, X2 = (P - Pref)/T_K
    const x1 = temps.map((t) => 1 / (t + 273.15) - 1 / Tref_K);
    const x2 = temps.map((t, i) => (pressures[i] - Pref) / (t + 273.15));
    const meanY = ys.reduce((s, v) => s + v, 0) / n;

    let s11 = 0; let s22 = 0; let s12 = 0; let sy1 = 0; let sy2 = 0;
    for (let i = 0; i < n; i++) {
      s11 += x1[i] * x1[i];
      s22 += x2[i] * x2[i];
      s12 += x1[i] * x2[i];
      sy1 += x1[i] * ys[i];
      sy2 += x2[i] * ys[i];
    }

    const det = s11 * s22 - s12 * s12;
    let EaR, VaR;
    if (Math.abs(det) < 1e-20) {
      // Near-singular: use fallback values (multicollinearity safeguard)
      EaR = 9600;  // ~80 kJ/mol
      VaR = -1.2;  // ~-10 cm³/mol
    } else {
      const c1 = (s22 * sy1 - s12 * sy2) / det;
      const c2 = (s11 * sy2 - s12 * sy1) / det;
      EaR = -c1;
      VaR = -c2;
      // Validate physically reasonable values
      if (EaR < 0 || EaR > 100000) EaR = 9600;
      if (Math.abs(VaR) > 1000) VaR = -1.2;
    }

    return { lnkRef: meanY, EaR, VaR, Tref, Pref };
  }

  // ── Photoinactivation models ──

  if (secondaryModelId === 'PHOTO_INTENSITY') {
    const is = rows.map((r) => r.x);
    const meanI = is.reduce((s, v) => s + v, 0) / is.length;
    const meanY = ys.reduce((s, v) => s + v, 0) / ys.length;
    const zI = Math.abs(b) > 1e-10 ? -1 / b : 5;
    return { logDref: meanY, Iref: meanI, zI };
  }

  if (secondaryModelId === 'PHOTO_INTENSITY_TURBIDITY') {
    const intensities = rows.map((r) => getFactorValue(r.factors, 'intensity') ?? r.x);
    const turbs = rows.map((r) => getFactorValue(r.factors, 'turbidity') ?? 0);
    const n = rows.length;
    const meanI = intensities.reduce((s, v) => s + v, 0) / n;
    const meanTurb = turbs.reduce((s, v) => s + v, 0) / n;
    const meanY = ys.reduce((s, v) => s + v, 0) / n;

    let s11 = 0; let s22 = 0; let s12 = 0; let sy1 = 0; let sy2 = 0;
    for (let i = 0; i < n; i++) {
      const dI = intensities[i] - meanI;
      const dTurb = turbs[i] - meanTurb;
      const dY = ys[i] - meanY;
      s11 += dI * dI;
      s22 += dTurb * dTurb;
      s12 += dI * dTurb;
      sy1 += dI * dY;
      sy2 += dTurb * dY;
    }

    const det = s11 * s22 - s12 * s12;
    let b1; let b2;
    if (Math.abs(det) < 1e-12) {
      b1 = s11 > 0 ? sy1 / s11 : 0;
      b2 = 0;
    } else {
      b1 = (s22 * sy1 - s12 * sy2) / det;
      b2 = (s11 * sy2 - s12 * sy1) / det;
    }

    const Iref = meanI;
    const zI = Math.abs(b1) > 1e-10 ? -1 / b1 : 5;
    const kTurb = b2;
    const logDref = meanY;
    return { logDref, Iref, zI, kTurb };
  }

  if (secondaryModelId === 'PHOTO_INTENSITY_AW') {
    const intensities = rows.map((r) => getFactorValue(r.factors, 'intensity') ?? r.x);
    const aws = rows.map((r) => getFactorValue(r.factors, 'aw') ?? 1);
    const n = rows.length;
    const meanI = intensities.reduce((s, v) => s + v, 0) / n;
    const meanAw = aws.reduce((s, v) => s + v, 0) / n;
    const meanY = ys.reduce((s, v) => s + v, 0) / n;

    let s11 = 0; let s22 = 0; let s12 = 0; let sy1 = 0; let sy2 = 0;
    for (let i = 0; i < n; i++) {
      const dI = intensities[i] - meanI;
      const dAw = aws[i] - meanAw;
      const dY = ys[i] - meanY;
      s11 += dI * dI;
      s22 += dAw * dAw;
      s12 += dI * dAw;
      sy1 += dI * dY;
      sy2 += dAw * dY;
    }

    const det = s11 * s22 - s12 * s12;
    let b1; let b2;
    if (Math.abs(det) < 1e-12) {
      b1 = s11 > 0 ? sy1 / s11 : 0;
      b2 = 0;
    } else {
      b1 = (s22 * sy1 - s12 * sy2) / det;
      b2 = (s11 * sy2 - s12 * sy1) / det;
    }

    const Iref = meanI;
    const awRef = meanAw;
    const zI = Math.abs(b1) > 1e-10 ? -1 / b1 : 5;
    const zaw = Math.abs(b2) > 1e-10 ? -1 / b2 : 0.2;
    const logDref = meanY;
    return { logDref, Iref, zI, awRef, zaw };
  }

  if (secondaryModelId === 'PHOTO_TRIPLE') {
    const intensities = rows.map((r) => getFactorValue(r.factors, 'intensity') ?? r.x);
    const aws = rows.map((r) => getFactorValue(r.factors, 'aw') ?? 1);
    const turbs = rows.map((r) => getFactorValue(r.factors, 'turbidity') ?? 0);
    const n = rows.length;
    const meanI = intensities.reduce((s, v) => s + v, 0) / n;
    const meanAw = aws.reduce((s, v) => s + v, 0) / n;
    const meanTurb = turbs.reduce((s, v) => s + v, 0) / n;
    const meanY = ys.reduce((s, v) => s + v, 0) / n;

    let s11 = 0; let s22 = 0; let s33 = 0;
    let s12 = 0; let s13 = 0; let s23 = 0;
    let sy1 = 0; let sy2 = 0; let sy3 = 0;
    for (let i = 0; i < n; i++) {
      const dI = intensities[i] - meanI;
      const dAw = aws[i] - meanAw;
      const dTurb = turbs[i] - meanTurb;
      const dY = ys[i] - meanY;
      s11 += dI * dI; s22 += dAw * dAw; s33 += dTurb * dTurb;
      s12 += dI * dAw; s13 += dI * dTurb; s23 += dAw * dTurb;
      sy1 += dI * dY; sy2 += dAw * dY; sy3 += dTurb * dY;
    }

    const det = s11 * (s22 * s33 - s23 * s23) - s12 * (s12 * s33 - s23 * s13) + s13 * (s12 * s23 - s22 * s13);
    let b1; let b2; let b3;
    if (Math.abs(det) < 1e-20) {
      b1 = s11 > 0 ? sy1 / s11 : 0;
      b2 = s22 > 0 ? sy2 / s22 : 0;
      b3 = s33 > 0 ? sy3 / s33 : 0;
    } else {
      b1 = ((s22 * s33 - s23 * s23) * sy1 + (s13 * s23 - s12 * s33) * sy2 + (s12 * s23 - s13 * s22) * sy3) / det;
      b2 = ((s23 * s13 - s12 * s33) * sy1 + (s11 * s33 - s13 * s13) * sy2 + (s12 * s13 - s11 * s23) * sy3) / det;
      b3 = ((s12 * s23 - s22 * s13) * sy1 + (s12 * s13 - s11 * s23) * sy2 + (s11 * s22 - s12 * s12) * sy3) / det;
    }

    const Iref = meanI;
    const awRef = meanAw;
    const zI = Math.abs(b1) > 1e-10 ? -1 / b1 : 5;
    const zaw = Math.abs(b2) > 1e-10 ? -1 / b2 : 0.2;
    const kTurb = b3;
    const logDref = meanY;
    return { logDref, Iref, zI, awRef, zaw, kTurb };
  }

  if (secondaryModelId === 'LINEAR_PHOTO') {
    return { a, b };
  }

  // ── PEF models ──

  if (secondaryModelId === 'PEF_FIELD') {
    const es = rows.map((r) => r.x);
    const meanE = es.reduce((s, v) => s + v, 0) / es.length;
    const meanY = ys.reduce((s, v) => s + v, 0) / ys.length;
    const zE = Math.abs(b) > 1e-10 ? -1 / b : 10;
    return { logDref: meanY, Eref: meanE, zE };
  }

  if (secondaryModelId === 'PEF_FIELD_CONDUCTIVITY') {
    const fields = rows.map((r) => getFactorValue(r.factors, 'electricField') ?? r.x);
    const sigmas = rows.map((r) => getFactorValue(r.factors, 'conductivity') ?? 2.0);
    const n = rows.length;
    const meanE = fields.reduce((s, v) => s + v, 0) / n;
    const meanSigma = sigmas.reduce((s, v) => s + v, 0) / n;
    const meanY = ys.reduce((s, v) => s + v, 0) / n;

    let s11 = 0; let s22 = 0; let s12 = 0; let sy1 = 0; let sy2 = 0;
    for (let i = 0; i < n; i++) {
      const dE = fields[i] - meanE;
      const dSigma = sigmas[i] - meanSigma;
      const dY = ys[i] - meanY;
      s11 += dE * dE;
      s22 += dSigma * dSigma;
      s12 += dE * dSigma;
      sy1 += dE * dY;
      sy2 += dSigma * dY;
    }

    const det = s11 * s22 - s12 * s12;
    let b1; let b2;
    if (Math.abs(det) < 1e-12) {
      b1 = s11 > 0 ? sy1 / s11 : 0;
      b2 = 0;
    } else {
      b1 = (s22 * sy1 - s12 * sy2) / det;
      b2 = (s11 * sy2 - s12 * sy1) / det;
    }

    const Eref = meanE;
    const sigmaRef = meanSigma;
    const zE = Math.abs(b1) > 1e-10 ? -1 / b1 : 10;
    const zSigma = Math.abs(b2) > 1e-10 ? -1 / b2 : 2.0;
    const logDref = meanY;
    return { logDref, Eref, zE, sigmaRef, zSigma };
  }

  if (secondaryModelId === 'PEF_FIELD_AW') {
    const fields = rows.map((r) => getFactorValue(r.factors, 'electricField') ?? r.x);
    const aws = rows.map((r) => getFactorValue(r.factors, 'aw') ?? 1);
    const n = rows.length;
    const meanE = fields.reduce((s, v) => s + v, 0) / n;
    const meanAw = aws.reduce((s, v) => s + v, 0) / n;
    const meanY = ys.reduce((s, v) => s + v, 0) / n;

    let s11 = 0; let s22 = 0; let s12 = 0; let sy1 = 0; let sy2 = 0;
    for (let i = 0; i < n; i++) {
      const dE = fields[i] - meanE;
      const dAw = aws[i] - meanAw;
      const dY = ys[i] - meanY;
      s11 += dE * dE;
      s22 += dAw * dAw;
      s12 += dE * dAw;
      sy1 += dE * dY;
      sy2 += dAw * dY;
    }

    const det = s11 * s22 - s12 * s12;
    let b1; let b2;
    if (Math.abs(det) < 1e-12) {
      b1 = s11 > 0 ? sy1 / s11 : 0;
      b2 = 0;
    } else {
      b1 = (s22 * sy1 - s12 * sy2) / det;
      b2 = (s11 * sy2 - s12 * sy1) / det;
    }

    const Eref = meanE;
    const awRef = meanAw;
    const zE = Math.abs(b1) > 1e-10 ? -1 / b1 : 10;
    const zaw = Math.abs(b2) > 1e-10 ? -1 / b2 : 0.2;
    const logDref = meanY;
    return { logDref, Eref, zE, awRef, zaw };
  }

  if (secondaryModelId === 'PEF_TRIPLE') {
    const fields = rows.map((r) => getFactorValue(r.factors, 'electricField') ?? r.x);
    const aws = rows.map((r) => getFactorValue(r.factors, 'aw') ?? 1);
    const sigmas = rows.map((r) => getFactorValue(r.factors, 'conductivity') ?? 2.0);
    const n = rows.length;
    const meanE = fields.reduce((s, v) => s + v, 0) / n;
    const meanAw = aws.reduce((s, v) => s + v, 0) / n;
    const meanSigma = sigmas.reduce((s, v) => s + v, 0) / n;
    const meanY = ys.reduce((s, v) => s + v, 0) / n;

    let s11 = 0; let s22 = 0; let s33 = 0;
    let s12 = 0; let s13 = 0; let s23 = 0;
    let sy1 = 0; let sy2 = 0; let sy3 = 0;
    for (let i = 0; i < n; i++) {
      const dE = fields[i] - meanE;
      const dAw = aws[i] - meanAw;
      const dSigma = sigmas[i] - meanSigma;
      const dY = ys[i] - meanY;
      s11 += dE * dE; s22 += dAw * dAw; s33 += dSigma * dSigma;
      s12 += dE * dAw; s13 += dE * dSigma; s23 += dAw * dSigma;
      sy1 += dE * dY; sy2 += dAw * dY; sy3 += dSigma * dY;
    }

    const det = s11 * (s22 * s33 - s23 * s23) - s12 * (s12 * s33 - s23 * s13) + s13 * (s12 * s23 - s22 * s13);
    let b1; let b2; let b3;
    if (Math.abs(det) < 1e-20) {
      b1 = s11 > 0 ? sy1 / s11 : 0;
      b2 = s22 > 0 ? sy2 / s22 : 0;
      b3 = s33 > 0 ? sy3 / s33 : 0;
    } else {
      b1 = ((s22 * s33 - s23 * s23) * sy1 + (s13 * s23 - s12 * s33) * sy2 + (s12 * s23 - s13 * s22) * sy3) / det;
      b2 = ((s23 * s13 - s12 * s33) * sy1 + (s11 * s33 - s13 * s13) * sy2 + (s12 * s13 - s11 * s23) * sy3) / det;
      b3 = ((s12 * s23 - s22 * s13) * sy1 + (s12 * s13 - s11 * s23) * sy2 + (s11 * s22 - s12 * s12) * sy3) / det;
    }

    const Eref = meanE;
    const awRef = meanAw;
    const sigmaRef = meanSigma;
    const zE = Math.abs(b1) > 1e-10 ? -1 / b1 : 10;
    const zaw = Math.abs(b2) > 1e-10 ? -1 / b2 : 0.2;
    const zSigma = Math.abs(b3) > 1e-10 ? -1 / b3 : 2.0;
    const logDref = meanY;
    return { logDref, Eref, zE, awRef, zaw, sigmaRef, zSigma };
  }

  if (secondaryModelId === 'LINEAR_PEF') {
    return { a, b };
  }

  // ── Chemical models ──

  if (secondaryModelId === 'CHEMICAL_CONC') {
    const cs = rows.map((r) => r.x);
    const meanC = cs.reduce((s, v) => s + v, 0) / cs.length;
    const meanY = ys.reduce((s, v) => s + v, 0) / ys.length;
    const zC = Math.abs(b) > 1e-10 ? -1 / b : 100;
    return { logDref: meanY, Cref: meanC, zC };
  }

  if (secondaryModelId === 'CHEMICAL_CONC_PH') {
    const concs = rows.map((r) => getFactorValue(r.factors, 'concentration') ?? r.x);
    const pHs = rows.map((r) => getFactorValue(r.factors, 'pH') ?? 7.0);
    const n = rows.length;
    const meanC = concs.reduce((s, v) => s + v, 0) / n;
    const meanPH = pHs.reduce((s, v) => s + v, 0) / n;
    const meanY = ys.reduce((s, v) => s + v, 0) / n;

    let s11 = 0; let s22 = 0; let s12 = 0; let sy1 = 0; let sy2 = 0;
    for (let i = 0; i < n; i++) {
      const dC = concs[i] - meanC;
      const dpH = pHs[i] - meanPH;
      const dY = ys[i] - meanY;
      s11 += dC * dC;
      s22 += dpH * dpH;
      s12 += dC * dpH;
      sy1 += dC * dY;
      sy2 += dpH * dY;
    }

    const det = s11 * s22 - s12 * s12;
    let b1; let b2;
    if (Math.abs(det) < 1e-12) {
      b1 = s11 > 0 ? sy1 / s11 : 0;
      b2 = 0;
    } else {
      b1 = (s22 * sy1 - s12 * sy2) / det;
      b2 = (s11 * sy2 - s12 * sy1) / det;
    }

    const Cref = meanC;
    const pHref = meanPH;
    const zC = Math.abs(b1) > 1e-10 ? -1 / b1 : 100;
    const zpH = Math.abs(b2) > 1e-10 ? -1 / b2 : 2.0;
    const logDref = meanY;
    return { logDref, Cref, zC, pHref, zpH };
  }

  if (secondaryModelId === 'CHEMICAL_CONC_AW') {
    const concs = rows.map((r) => getFactorValue(r.factors, 'concentration') ?? r.x);
    const aws = rows.map((r) => getFactorValue(r.factors, 'aw') ?? 1);
    const n = rows.length;
    const meanC = concs.reduce((s, v) => s + v, 0) / n;
    const meanAw = aws.reduce((s, v) => s + v, 0) / n;
    const meanY = ys.reduce((s, v) => s + v, 0) / n;

    let s11 = 0; let s22 = 0; let s12 = 0; let sy1 = 0; let sy2 = 0;
    for (let i = 0; i < n; i++) {
      const dC = concs[i] - meanC;
      const dAw = aws[i] - meanAw;
      const dY = ys[i] - meanY;
      s11 += dC * dC;
      s22 += dAw * dAw;
      s12 += dC * dAw;
      sy1 += dC * dY;
      sy2 += dAw * dY;
    }

    const det = s11 * s22 - s12 * s12;
    let b1; let b2;
    if (Math.abs(det) < 1e-12) {
      b1 = s11 > 0 ? sy1 / s11 : 0;
      b2 = 0;
    } else {
      b1 = (s22 * sy1 - s12 * sy2) / det;
      b2 = (s11 * sy2 - s12 * sy1) / det;
    }

    const Cref = meanC;
    const awRef = meanAw;
    const zC = Math.abs(b1) > 1e-10 ? -1 / b1 : 100;
    const zaw = Math.abs(b2) > 1e-10 ? -1 / b2 : 0.2;
    const logDref = meanY;
    return { logDref, Cref, zC, awRef, zaw };
  }

  if (secondaryModelId === 'CHEMICAL_TRIPLE') {
    const concs = rows.map((r) => getFactorValue(r.factors, 'concentration') ?? r.x);
    const aws = rows.map((r) => getFactorValue(r.factors, 'aw') ?? 1);
    const pHs = rows.map((r) => getFactorValue(r.factors, 'pH') ?? 7.0);
    const n = rows.length;
    const meanC = concs.reduce((s, v) => s + v, 0) / n;
    const meanAw = aws.reduce((s, v) => s + v, 0) / n;
    const meanPH = pHs.reduce((s, v) => s + v, 0) / n;
    const meanY = ys.reduce((s, v) => s + v, 0) / n;

    let s11 = 0; let s22 = 0; let s33 = 0;
    let s12 = 0; let s13 = 0; let s23 = 0;
    let sy1 = 0; let sy2 = 0; let sy3 = 0;
    for (let i = 0; i < n; i++) {
      const dC = concs[i] - meanC;
      const dAw = aws[i] - meanAw;
      const dpH = pHs[i] - meanPH;
      const dY = ys[i] - meanY;
      s11 += dC * dC; s22 += dAw * dAw; s33 += dpH * dpH;
      s12 += dC * dAw; s13 += dC * dpH; s23 += dAw * dpH;
      sy1 += dC * dY; sy2 += dAw * dY; sy3 += dpH * dY;
    }

    const det = s11 * (s22 * s33 - s23 * s23) - s12 * (s12 * s33 - s23 * s13) + s13 * (s12 * s23 - s22 * s13);
    let b1; let b2; let b3;
    if (Math.abs(det) < 1e-20) {
      b1 = s11 > 0 ? sy1 / s11 : 0;
      b2 = s22 > 0 ? sy2 / s22 : 0;
      b3 = s33 > 0 ? sy3 / s33 : 0;
    } else {
      b1 = ((s22 * s33 - s23 * s23) * sy1 + (s13 * s23 - s12 * s33) * sy2 + (s12 * s23 - s13 * s22) * sy3) / det;
      b2 = ((s23 * s13 - s12 * s33) * sy1 + (s11 * s33 - s13 * s13) * sy2 + (s12 * s13 - s11 * s23) * sy3) / det;
      b3 = ((s12 * s23 - s22 * s13) * sy1 + (s12 * s13 - s11 * s23) * sy2 + (s11 * s22 - s12 * s12) * sy3) / det;
    }

    const Cref = meanC;
    const awRef = meanAw;
    const pHref = meanPH;
    const zC = Math.abs(b1) > 1e-10 ? -1 / b1 : 100;
    const zaw = Math.abs(b2) > 1e-10 ? -1 / b2 : 0.2;
    const zpH = Math.abs(b3) > 1e-10 ? -1 / b3 : 2.0;
    const logDref = meanY;
    return { logDref, Cref, zC, awRef, zaw, pHref, zpH };
  }

  if (secondaryModelId === 'CHEMICAL_CONC_TEMP') {
    const concs = rows.map((r) => getFactorValue(r.factors, 'concentration') ?? r.x);
    const temps = rows.map((r) => getFactorValue(r.factors, 'temp') ?? 25);
    const n = rows.length;
    const meanC = concs.reduce((s, v) => s + v, 0) / n;
    const meanT = temps.reduce((s, v) => s + v, 0) / n;
    const meanY = ys.reduce((s, v) => s + v, 0) / n;

    let s11 = 0; let s22 = 0; let s12 = 0; let sy1 = 0; let sy2 = 0;
    for (let i = 0; i < n; i++) {
      const dC = concs[i] - meanC;
      const dT = temps[i] - meanT;
      const dY = ys[i] - meanY;
      s11 += dC * dC;
      s22 += dT * dT;
      s12 += dC * dT;
      sy1 += dC * dY;
      sy2 += dT * dY;
    }

    const det = s11 * s22 - s12 * s12;
    let b1; let b2;
    if (Math.abs(det) < 1e-12) {
      b1 = s11 > 0 ? sy1 / s11 : 0;
      b2 = 0;
    } else {
      b1 = (s22 * sy1 - s12 * sy2) / det;
      b2 = (s11 * sy2 - s12 * sy1) / det;
    }

    const Cref = meanC;
    const Tref = meanT;
    const zC = Math.abs(b1) > 1e-10 ? -1 / b1 : 100;
    const zT = Math.abs(b2) > 1e-10 ? -1 / b2 : 10;
    const logDref = meanY;
    return { logDref, Cref, zC, Tref, zT };
  }

  if (secondaryModelId === 'CHEMICAL_CONC_TEMP_PH') {
    const concs = rows.map((r) => getFactorValue(r.factors, 'concentration') ?? r.x);
    const temps = rows.map((r) => getFactorValue(r.factors, 'temp') ?? 25);
    const pHs = rows.map((r) => getFactorValue(r.factors, 'pH') ?? 7.0);
    const n = rows.length;
    const meanC = concs.reduce((s, v) => s + v, 0) / n;
    const meanT = temps.reduce((s, v) => s + v, 0) / n;
    const meanPH = pHs.reduce((s, v) => s + v, 0) / n;
    const meanY = ys.reduce((s, v) => s + v, 0) / n;

    let s11 = 0; let s22 = 0; let s33 = 0;
    let s12 = 0; let s13 = 0; let s23 = 0;
    let sy1 = 0; let sy2 = 0; let sy3 = 0;
    for (let i = 0; i < n; i++) {
      const dC = concs[i] - meanC;
      const dT = temps[i] - meanT;
      const dpH = pHs[i] - meanPH;
      const dY = ys[i] - meanY;
      s11 += dC * dC; s22 += dT * dT; s33 += dpH * dpH;
      s12 += dC * dT; s13 += dC * dpH; s23 += dT * dpH;
      sy1 += dC * dY; sy2 += dT * dY; sy3 += dpH * dY;
    }

    const det = s11 * (s22 * s33 - s23 * s23) - s12 * (s12 * s33 - s23 * s13) + s13 * (s12 * s23 - s22 * s13);
    let b1; let b2; let b3;
    if (Math.abs(det) < 1e-20) {
      b1 = s11 > 0 ? sy1 / s11 : 0;
      b2 = s22 > 0 ? sy2 / s22 : 0;
      b3 = s33 > 0 ? sy3 / s33 : 0;
    } else {
      b1 = ((s22 * s33 - s23 * s23) * sy1 + (s13 * s23 - s12 * s33) * sy2 + (s12 * s23 - s13 * s22) * sy3) / det;
      b2 = ((s23 * s13 - s12 * s33) * sy1 + (s11 * s33 - s13 * s13) * sy2 + (s12 * s13 - s11 * s23) * sy3) / det;
      b3 = ((s12 * s23 - s22 * s13) * sy1 + (s12 * s13 - s11 * s23) * sy2 + (s11 * s22 - s12 * s12) * sy3) / det;
    }

    const Cref = meanC;
    const Tref = meanT;
    const pHref = meanPH;
    const zC = Math.abs(b1) > 1e-10 ? -1 / b1 : 100;
    const zT = Math.abs(b2) > 1e-10 ? -1 / b2 : 10;
    const zpH = Math.abs(b3) > 1e-10 ? -1 / b3 : 2.0;
    const logDref = meanY;
    return { logDref, Cref, zC, Tref, zT, pHref, zpH };
  }

  if (secondaryModelId === 'CHEMICAL_QUAD') {
    const concs = rows.map((r) => getFactorValue(r.factors, 'concentration') ?? r.x);
    const temps = rows.map((r) => getFactorValue(r.factors, 'temp') ?? 25);
    const aws = rows.map((r) => getFactorValue(r.factors, 'aw') ?? 1);
    const pHs = rows.map((r) => getFactorValue(r.factors, 'pH') ?? 7.0);
    const n = rows.length;
    const meanC = concs.reduce((s, v) => s + v, 0) / n;
    const meanT = temps.reduce((s, v) => s + v, 0) / n;
    const meanAw = aws.reduce((s, v) => s + v, 0) / n;
    const meanPH = pHs.reduce((s, v) => s + v, 0) / n;
    const meanY = ys.reduce((s, v) => s + v, 0) / n;

    // 4-variable OLS via simple fallback: regress on each factor independently
    const regC = linearRegression(concs, ys);
    const regT = linearRegression(temps, ys);
    const regAw = linearRegression(aws, ys);
    const regPH = linearRegression(pHs, ys);

    const Cref = meanC;
    const Tref = meanT;
    const awRef = meanAw;
    const pHref = meanPH;
    const zC = Math.abs(regC.b) > 1e-10 ? -1 / regC.b : 100;
    const zT = Math.abs(regT.b) > 1e-10 ? -1 / regT.b : 10;
    const zaw = Math.abs(regAw.b) > 1e-10 ? -1 / regAw.b : 0.2;
    const zpH = Math.abs(regPH.b) > 1e-10 ? -1 / regPH.b : 2.0;
    const logDref = meanY;
    return { logDref, Cref, zC, Tref, zT, awRef, zaw, pHref, zpH };
  }

  if (secondaryModelId === 'LINEAR_CHEM') {
    return { a, b };
  }

  // ── Irradiation models ──

  if (secondaryModelId === 'IRRAD_DOSE') {
    const drs = rows.map((r) => getFactorValue(r.factors, 'doseRate') ?? r.x);
    const meanDR = drs.reduce((s, v) => s + v, 0) / drs.length;
    const meanY = ys.reduce((s, v) => s + v, 0) / ys.length;
    const zDR = Math.abs(b) > 1e-10 ? -1 / b : 5;
    return { logDref: meanY, DRref: meanDR, zDR };
  }

  if (secondaryModelId === 'IRRAD_DOSE_TEMP') {
    const drs = rows.map((r) => getFactorValue(r.factors, 'doseRate') ?? r.x);
    const temps = rows.map((r) => getFactorValue(r.factors, 'temp') ?? 25);
    const n = rows.length;
    const meanDR = drs.reduce((s, v) => s + v, 0) / n;
    const meanT = temps.reduce((s, v) => s + v, 0) / n;
    const meanY = ys.reduce((s, v) => s + v, 0) / n;

    let s11 = 0; let s22 = 0; let s12 = 0; let sy1 = 0; let sy2 = 0;
    for (let i = 0; i < n; i++) {
      const dDR = drs[i] - meanDR;
      const dT = temps[i] - meanT;
      const dY = ys[i] - meanY;
      s11 += dDR * dDR;
      s22 += dT * dT;
      s12 += dDR * dT;
      sy1 += dDR * dY;
      sy2 += dT * dY;
    }

    const det = s11 * s22 - s12 * s12;
    let b1; let b2;
    if (Math.abs(det) < 1e-12) {
      b1 = s11 > 0 ? sy1 / s11 : 0;
      b2 = 0;
    } else {
      b1 = (s22 * sy1 - s12 * sy2) / det;
      b2 = (s11 * sy2 - s12 * sy1) / det;
    }

    const DRref = meanDR;
    const Tref = meanT;
    const zDR = Math.abs(b1) > 1e-10 ? -1 / b1 : 5;
    const zT = Math.abs(b2) > 1e-10 ? -1 / b2 : 20;
    const logDref = meanY;
    return { logDref, DRref, zDR, Tref, zT };
  }

  if (secondaryModelId === 'IRRAD_DOSE_AW') {
    const drs = rows.map((r) => getFactorValue(r.factors, 'doseRate') ?? r.x);
    const aws = rows.map((r) => getFactorValue(r.factors, 'aw') ?? 1);
    const n = rows.length;
    const meanDR = drs.reduce((s, v) => s + v, 0) / n;
    const meanAw = aws.reduce((s, v) => s + v, 0) / n;
    const meanY = ys.reduce((s, v) => s + v, 0) / n;

    let s11 = 0; let s22 = 0; let s12 = 0; let sy1 = 0; let sy2 = 0;
    for (let i = 0; i < n; i++) {
      const dDR = drs[i] - meanDR;
      const dAw = aws[i] - meanAw;
      const dY = ys[i] - meanY;
      s11 += dDR * dDR;
      s22 += dAw * dAw;
      s12 += dDR * dAw;
      sy1 += dDR * dY;
      sy2 += dAw * dY;
    }

    const det = s11 * s22 - s12 * s12;
    let b1; let b2;
    if (Math.abs(det) < 1e-12) {
      b1 = s11 > 0 ? sy1 / s11 : 0;
      b2 = 0;
    } else {
      b1 = (s22 * sy1 - s12 * sy2) / det;
      b2 = (s11 * sy2 - s12 * sy1) / det;
    }

    const DRref = meanDR;
    const awRef = meanAw;
    const zDR = Math.abs(b1) > 1e-10 ? -1 / b1 : 5;
    const zaw = Math.abs(b2) > 1e-10 ? -1 / b2 : 0.2;
    const logDref = meanY;
    return { logDref, DRref, zDR, awRef, zaw };
  }

  if (secondaryModelId === 'IRRAD_TRIPLE') {
    const drs = rows.map((r) => getFactorValue(r.factors, 'doseRate') ?? r.x);
    const temps = rows.map((r) => getFactorValue(r.factors, 'temp') ?? 25);
    const aws = rows.map((r) => getFactorValue(r.factors, 'aw') ?? 1);
    const n = rows.length;
    const meanDR = drs.reduce((s, v) => s + v, 0) / n;
    const meanT = temps.reduce((s, v) => s + v, 0) / n;
    const meanAw = aws.reduce((s, v) => s + v, 0) / n;
    const meanY = ys.reduce((s, v) => s + v, 0) / n;

    let s11 = 0; let s22 = 0; let s33 = 0;
    let s12 = 0; let s13 = 0; let s23 = 0;
    let sy1 = 0; let sy2 = 0; let sy3 = 0;
    for (let i = 0; i < n; i++) {
      const dDR = drs[i] - meanDR;
      const dT = temps[i] - meanT;
      const dAw = aws[i] - meanAw;
      const dY = ys[i] - meanY;
      s11 += dDR * dDR; s22 += dT * dT; s33 += dAw * dAw;
      s12 += dDR * dT; s13 += dDR * dAw; s23 += dT * dAw;
      sy1 += dDR * dY; sy2 += dT * dY; sy3 += dAw * dY;
    }

    const det = s11 * (s22 * s33 - s23 * s23) - s12 * (s12 * s33 - s23 * s13) + s13 * (s12 * s23 - s22 * s13);
    let b1; let b2; let b3;
    if (Math.abs(det) < 1e-20) {
      b1 = s11 > 0 ? sy1 / s11 : 0;
      b2 = s22 > 0 ? sy2 / s22 : 0;
      b3 = s33 > 0 ? sy3 / s33 : 0;
    } else {
      b1 = ((s22 * s33 - s23 * s23) * sy1 + (s13 * s23 - s12 * s33) * sy2 + (s12 * s23 - s13 * s22) * sy3) / det;
      b2 = ((s23 * s13 - s12 * s33) * sy1 + (s11 * s33 - s13 * s13) * sy2 + (s12 * s13 - s11 * s23) * sy3) / det;
      b3 = ((s12 * s23 - s22 * s13) * sy1 + (s12 * s13 - s11 * s23) * sy2 + (s11 * s22 - s12 * s12) * sy3) / det;
    }

    const DRref = meanDR;
    const Tref = meanT;
    const awRef = meanAw;
    const zDR = Math.abs(b1) > 1e-10 ? -1 / b1 : 5;
    const zT = Math.abs(b2) > 1e-10 ? -1 / b2 : 20;
    const zaw = Math.abs(b3) > 1e-10 ? -1 / b3 : 0.2;
    const logDref = meanY;
    return { logDref, DRref, zDR, Tref, zT, awRef, zaw };
  }

  if (secondaryModelId === 'LINEAR_IRRAD') {
    return { a, b };
  }

  // ── Custom mode models ──

  if (secondaryModelId === 'CUSTOM_Z1') {
    const xs = rows.map((r) => r.x);
    const meanX = xs.reduce((s, v) => s + v, 0) / xs.length;
    const meanY = ys.reduce((s, v) => s + v, 0) / ys.length;
    const z1 = Math.abs(b) > 1e-10 ? -1 / b : 10;
    return { logDref: meanY, x1ref: meanX, z1 };
  }

  if (secondaryModelId === 'CUSTOM_Z2') {
    const keys = _customConditionFactorKeys();
    const vals1 = rows.map((r) => getFactorValue(r.factors, keys[0]) ?? r.x);
    const vals2 = rows.map((r) => getFactorValue(r.factors, keys[1]) ?? 0);
    const n = rows.length;
    const mean1 = vals1.reduce((s, v) => s + v, 0) / n;
    const mean2 = vals2.reduce((s, v) => s + v, 0) / n;
    const meanY2 = ys.reduce((s, v) => s + v, 0) / n;
    let s11 = 0; let s22 = 0; let s12 = 0; let sy1 = 0; let sy2 = 0;
    for (let i = 0; i < n; i++) {
      const d1 = vals1[i] - mean1; const d2 = vals2[i] - mean2; const dY = ys[i] - meanY2;
      s11 += d1 * d1; s22 += d2 * d2; s12 += d1 * d2; sy1 += d1 * dY; sy2 += d2 * dY;
    }
    const det = s11 * s22 - s12 * s12;
    let b1; let b2c;
    if (Math.abs(det) < 1e-12) { b1 = s11 > 0 ? sy1 / s11 : 0; b2c = 0; }
    else { b1 = (s22 * sy1 - s12 * sy2) / det; b2c = (s11 * sy2 - s12 * sy1) / det; }
    const z1 = Math.abs(b1) > 1e-10 ? -1 / b1 : 10;
    const z2 = Math.abs(b2c) > 1e-10 ? -1 / b2c : 10;
    const logDref = meanY2;
    return { logDref, x1ref: mean1, z1, x2ref: mean2, z2 };
  }

  if (secondaryModelId === 'CUSTOM_Z3') {
    const keys = _customConditionFactorKeys();
    const meanY3 = ys.reduce((s, v) => s + v, 0) / ys.length;
    const x1ref = _customFactorDef(keys[0])?.scalingRef ?? 0;
    const x2ref = _customFactorDef(keys[1])?.scalingRef ?? 0;
    const x3ref = _customFactorDef(keys[2])?.scalingRef ?? 0;
    return { logDref: meanY3, x1ref, z1: 10, x2ref, z2: 10, x3ref, z3: 10 };
  }

  if (secondaryModelId === 'LINEAR_CUSTOM') {
    return { a, b };
  }

  return null;
}

export function buildSecondaryRows({ datasets, fitResults, primaryModelId, targetKey, secondaryModelId, primaryFactorKey = 'temp' }) {
  const config = MODEL_SECONDARY_CONFIG[primaryModelId]?.targets?.[targetKey];
  if (!config) return [];

  const model = SECONDARY_MODELS[secondaryModelId];
  const xFactorKey = model?.factorKeys?.[0] ?? primaryFactorKey;
  const transform = resolveTransform(config, secondaryModelId);

  return datasets.flatMap((dataset) => {
    const factorValue = model?.factorKeys?.length
      ? getFactorValue(dataset.conditions, xFactorKey)
      : (getFactorValue(dataset.conditions, primaryFactorKey) ?? 0);
    const fitResult = fitResults[`${dataset.id}_${primaryModelId}`];
    if (!fitResult?.params || fitResult.failed || fitResult.converged === false || model?.factorKeys?.some(key => !Number.isFinite(getFactorValue(dataset.conditions, key)))) return [];
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
      secondaryModelId,
      responseTransform: transform,
    }];
  });
}

export function fitSecondaryModel(secondaryModelId, rows, customInit = null) {
  const model = SECONDARY_MODELS[secondaryModelId];
  if (!model || rows.length < 2) return null;

  const { primaryModelId, targetKey } = rows[0];
  const targetConfig = MODEL_SECONDARY_CONFIG[primaryModelId]?.targets?.[targetKey];
  const regressionScale = resolveTransform(targetConfig ?? {}, secondaryModelId);
  // A transformed observation belongs to a particular target and model. Do
  // not silently accept cached rows from another response transformation.
  if (rows.some((row) => {
    if (row.secondaryModelId && row.secondaryModelId !== secondaryModelId) return true;
    if (row.responseTransform && row.responseTransform !== regressionScale) return true;
    if (!targetConfig) return false;
    if (row.primaryModelId !== primaryModelId || row.targetKey !== targetKey) return true;
    const expectedY = transformResponse(toFitValue(row.rawValue, targetConfig, secondaryModelId), regressionScale);
    return !Number.isFinite(expectedY) || !Number.isFinite(row.y)
      || Math.abs(row.y - expectedY) > 1e-10 * Math.max(1, Math.abs(expectedY));
  })) return null;

  const estimatedInit = estimateInitialParams(secondaryModelId, rows) ?? {};
  const initGuess = customInit ? { ...estimatedInit, ...customInit } : estimatedInit;

  const result = fitRegressionModel({
    modelFn: (_, params, row) => model.predictY(row.factors, params),
    paramDefs: model.params,
    data: rows,
    getX: (row) => row.x,
    getY: (row) => row.y,
    customInit: initGuess,
  });

  if (!result) return null;

  const hasRawScale = !!targetConfig && rows.every((row) => (
    row.primaryModelId === primaryModelId && row.targetKey === targetKey && Number.isFinite(row.rawValue)
  ));
  const logJacobian = hasRawScale
    ? rows.reduce((sum, row) => sum + responseLogJacobian(row.rawValue, targetConfig, secondaryModelId), 0)
    : Number.NaN;
  const likelihoodSSE = result.failed ? Infinity : result.sse;
  const aiccResult = calcAICc(likelihoodSSE, result.n, result.k, { logJacobian });
  const primaryParameterScale = targetConfig?.mapsToParam ?? targetKey;
  const primaryParameterLogJacobian = hasRawScale && targetConfig.primaryParameterLogJacobian
    ? rows.reduce((sum, row) => sum + targetConfig.primaryParameterLogJacobian(row.rawValue), 0)
    : 0;
  const primaryAiccResult = calcAICc(likelihoodSSE, result.n, result.k, {
    logJacobian: logJacobian + primaryParameterLogJacobian,
  });
  const rawSSE = hasRawScale ? rows.reduce((sum, row) => {
    const predicted = predictRawParameterValue({ secondaryModelId, params: result.params,
      factors: row.factors, targetConfig });
    return Number.isFinite(predicted) ? sum + (row.rawValue - predicted) ** 2 : Number.NaN;
  }, 0) : Number.NaN;

  return {
    ...result,
    aicc: aiccResult.value,
    aiccValid: aiccResult.valid,
    aiccWarning: aiccResult.warning,
    aiccScale: hasRawScale ? targetKey : null,
    aiccLogJacobian: Number.isFinite(logJacobian) ? logJacobian : null,
    aiccPrimaryParameter: primaryAiccResult.value,
    aiccPrimaryParameterValid: primaryAiccResult.valid,
    aiccPrimaryParameterScale: hasRawScale ? primaryParameterScale : null,
    aiccConvention: 'Gaussian likelihood with response Jacobian; K = regression parameters + residual variance',
    regressionScale,
    sseScale: regressionScale,
    rmseScale: regressionScale,
    rawTargetRMSE: !result.failed && Number.isFinite(rawSSE) ? Math.sqrt(rawSSE / rows.length) : null,
    rawTargetScale: hasRawScale ? targetKey : null,
    rawTargetUnit: targetConfig?.unit ?? null,
    curve: buildSecondaryCurve(secondaryModelId, result.params, rows, model, MODEL_SECONDARY_CONFIG),
    rows,
  };
}

export function computeLinkedPrimaryCurveMetrics({
  datasets,
  fitResults,
  primaryModelId,
  targetKey,
  secondaryModelId,
  secondaryParams,
}) {
  const primaryModel = MODELS[primaryModelId];
  const targetConfig = MODEL_SECONDARY_CONFIG[primaryModelId]?.targets?.[targetKey];
  const targetParamName = targetConfig?.mapsToParam ?? targetKey;

  if (!primaryModel || !targetConfig || !secondaryModelId || !secondaryParams) {
    return null;
  }

  let sse = 0;
  let n = 0;
  const perDataset = [];

  for (const dataset of datasets ?? []) {
    const fitResult = fitResults?.[`${dataset.id}_${primaryModelId}`];
    if (!fitResult?.params || fitResult.failed || fitResult.converged === false || !Array.isArray(dataset.data)) continue;

    const predictedRawValue = predictRawParameterValue({
      secondaryModelId,
      params: secondaryParams,
      factors: dataset.conditions ?? {},
      targetConfig,
    });
    const primaryParamValue = targetConfig.invertPredictedValue
      ? targetConfig.invertPredictedValue(predictedRawValue)
      : predictedRawValue;

    if (!Number.isFinite(primaryParamValue)) continue;

    const linkedParams = {
      ...fitResult.params,
      [targetParamName]: primaryParamValue,
    };

    let datasetSSE = 0;
    let datasetN = 0;
    for (const point of expandPrimaryObservations(dataset.data)) {
      const predicted = primaryModel.fn(point.t, linkedParams);
      const observed = point.logN;
      if (!Number.isFinite(predicted) || !Number.isFinite(observed)) continue;
      const residual = observed - predicted;
      datasetSSE += residual ** 2;
      datasetN += 1;
    }

    if (datasetN > 0) {
      sse += datasetSSE;
      n += datasetN;
      perDataset.push({
        datasetId: dataset.id,
        datasetName: dataset.name,
        n: datasetN,
        sse: datasetSSE,
        rmse: Math.sqrt(datasetSSE / datasetN),
        predictedRawValue,
        primaryParamName: targetParamName,
        primaryParamValue,
      });
    }
  }

  if (n === 0) return null;

  return {
    n,
    datasetCount: perDataset.length,
    sse,
    rmse: Math.sqrt(sse / n),
    scale: 'log10 count',
    note: 'Curve-level RMSE uses all supplied individual log-count observations, replacing the selected primary parameter with the secondary-model prediction while keeping other primary-fit parameters dataset-specific.',
    perDataset,
  };
}

/**
 * Batch-fit all applicable secondary models for every primary model + target combination.
 * Returns a flat Record keyed by `${secondaryModelId}_${targetKey}`.
 */
export function runAllSecondaryFits({ datasets, fitResults, scenario, primaryFactorKey, referenceParams = null }) {
  const results = {};
  const customConditionFactorCount = _customConditionFactorKeys().length;
  const customSecIds = scenario === 'custom'
    ? [
      'AVERAGE',
      ...(customConditionFactorCount >= 1 ? ['LINEAR_CUSTOM', 'CUSTOM_Z1'] : []),
      ...(customConditionFactorCount >= 2 ? ['CUSTOM_Z2'] : []),
      ...(customConditionFactorCount >= 3 ? ['CUSTOM_Z3'] : []),
    ].filter((id) => SECONDARY_MODELS[id]?.scenarios?.includes(scenario))
    : [];
  for (const [primaryModelId, config] of Object.entries(MODEL_SECONDARY_CONFIG)) {
    for (const [targetKey, targetCfg] of Object.entries(config.targets ?? {})) {
      let allowed = (targetCfg.allowedSecondaryModels ?? [])
        .filter((id) => SECONDARY_MODELS[id]?.scenarios?.includes(scenario));
      // For custom scenario, inject custom secondary models into every target
      if (scenario === 'custom') {
        const existing = new Set(allowed);
        for (const id of customSecIds) {
          if (!existing.has(id)) allowed.push(id);
        }
      }
      for (const secId of allowed) {
        const rows = buildSecondaryRows({
          datasets, fitResults, primaryModelId, targetKey,
          secondaryModelId: secId, primaryFactorKey,
        });
        if (rows.length < 2) continue;
        const result = fitSecondaryModel(secId, rows, referenceParams);
        if (!result) continue;
        const fitKey = `${secId}_${targetKey}`;
        const linkedCurveMetrics = computeLinkedPrimaryCurveMetrics({
          datasets,
          fitResults,
          primaryModelId,
          targetKey,
          secondaryModelId: secId,
          secondaryParams: result.params,
        });
        results[fitKey] = {
          fitKey, primaryModelId, targetKey,
          secondaryModelId: secId,
          lowConfidence: rows.length <= 2,
          linkedCurveMetrics,
          ...result,
        };
      }
    }
  }
  return results;
}

export function buildSecondaryCurve(secondaryModelId, params, rows, modelOverride = null, configOverride = null, pointCount = 100) {
  const model = modelOverride || SECONDARY_MODELS[secondaryModelId];
  if (!model || !rows.length) return [];

  const primaryKey = model.factorKeys[0];
  const xValues = rows.map((row) => row.x);
  const min = Math.min(...xValues);
  const max = Math.max(...xValues);
  const span = Math.max(max - min, 1);
  const start = min - span * 0.05;
  const end = max + span * 0.05;

  const primaryId = rows[0]?.primaryModelId;
  const targetKey = rows[0]?.targetKey;
  const cfg = primaryId && targetKey ? configOverride?.[primaryId]?.targets?.[targetKey] : null;

  const otherFactorMeans = {};
  model.factorKeys.slice(1).forEach((key) => {
    const vals = rows.map((r) => getFactorValue(r.factors, key) ?? (getFactorDef(key)?.default ?? 0));
    otherFactorMeans[key] = vals.reduce((s, v) => s + v, 0) / vals.length;
  });

  return Array.from({ length: pointCount }, (_, index) => {
    const xVal = start + ((end - start) * index) / Math.max(pointCount - 1, 1);
    const factors = { [primaryKey]: xVal, ...otherFactorMeans };
    const yFit = model.predictY(factors, params);
    const rawValue = cfg ? predictRawParameterValue({ secondaryModelId, params, factors, targetConfig: cfg }) : model.predictParameterValue(factors, params);
    return {
      x: xVal,
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

/**
 * Predict log10(D) at given factor values using a fitted secondary model.
 * Returns null for invalid/unsupported inputs.
 * Works for any secondary model; unused factors are ignored.
 */
export function predictLog10D(fittedModel, factors) {
  if (!fittedModel?.secondaryModelId || !fittedModel?.params) return null;
  const model = SECONDARY_MODELS[fittedModel.secondaryModelId];
  if (!model) return null;

  let log10D;

  const directLogDModels = [
    'BIGELOW', 'EXTENDED_BIGELOW',
    'BIGELOW_PRESSURE', 'EXTENDED_BIGELOW_PRESSURE', 'PATP_TRIPLE',
    'BIGELOW_PRESSURE_PH', 'BIGELOW_PRESSURE_TEMP_PH', 'BIGELOW_PRESSURE_AW_PH',
    'PHOTO_INTENSITY', 'PHOTO_INTENSITY_TURBIDITY',
    'PEF_FIELD', 'PEF_FIELD_CONDUCTIVITY',
    'CHEMICAL_CONC', 'CHEMICAL_CONC_TEMP', 'CHEMICAL_CONC_PH', 'CHEMICAL_CONC_TEMP_PH',
    'IRRAD_DOSE', 'IRRAD_DOSE_TEMP',
  ];
  if (directLogDModels.includes(fittedModel.secondaryModelId)) {
    log10D = model.predictY(factors, fittedModel.params);
  } else {
    const rawD = model.predictParameterValue(factors, fittedModel.params);
    if (!Number.isFinite(rawD) || rawD <= 0) return null;
    log10D = Math.log10(rawD);
  }

  if (!Number.isFinite(log10D)) return null;
  return log10D;
}

export function getSecondaryModelsForScenario(scenario) {
  return Object.values(SECONDARY_MODELS).filter(
    (m) => !m.scenarios || m.scenarios.includes(scenario),
  );
}

/* ── Default factor scaling for unbound parameters ── */
const RATE_PARAMS = new Set(['kmax', 'kmax1', 'kmax2']);
const TIME_SCALE_PARAMS = new Set(['delta', 'delta1', 'delta2']);

function applyDefaultFactorScaling(paramName, baseValue, factors, primaryFactorKey) {
  if (!RATE_PARAMS.has(paramName) && !TIME_SCALE_PARAMS.has(paramName)) return baseValue;
  const direction = TIME_SCALE_PARAMS.has(paramName) ? -1 : 1;
  // Irradiation assumes a fixed dose-response shape: rate is proportional
  // to dose rate, while the characteristic treatment time is reciprocal.
  if (primaryFactorKey === 'doseRate') {
    const ref = getFactorDef('doseRate')?.scalingRef;
    const doseRate = factors?.doseRate;
    if (!Number.isFinite(ref) || ref <= 0 || !Number.isFinite(doseRate) || doseRate <= 0) return Number.NaN;
    return baseValue * Math.pow(doseRate / ref, direction);
  }
  // Try each primary factor in order — use scalingRef from FACTORS
  const scalingCandidates = [
    { key: 'temp', z: 10 },
    { key: 'pressure', z: 100 },
    { key: 'intensity', z: 5 },
    { key: 'electricField', z: 10 },
    { key: 'concentration', z: 100 },
    ...Object.keys(getCustomFactors()).map((key) => ({ key, z: 10 })),
  ];
  for (const { key, z } of scalingCandidates.filter(candidate => !primaryFactorKey || candidate.key === primaryFactorKey)) {
    const factor = getFactorDef(key);
    if (factors?.[key] != null && factor) {
      const ref = factor.scalingRef;
      const diff = factors[key] - ref;
      if (Math.abs(diff) < 0.01) return baseValue;
      return baseValue * Math.pow(10, direction * diff / z);
    }
  }
  return baseValue;
}

export function predictPrimaryParams({ primaryModelId, bindings, fittedSecondaryModels, manualParams, factors, primaryFactorKey }) {
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
        predictedParams[paramDef.name] = Number.isFinite(finalValue) ? finalValue : Number.NaN;
        return;
      }
    }

    const baseValue = manualParams?.[paramDef.name] ?? paramDef.defaultValue;
    predictedParams[paramDef.name] = applyDefaultFactorScaling(paramDef.name, baseValue, factors, primaryFactorKey);
  });

  return predictedParams;
}


/**
 * Compute the y-value (for secondary model fitting) from a manual D-value entry.
 * Mirrors the logic in buildSecondaryRows but works on a single D value + factors.
 * Returns null if inputs are invalid.
 */
export function computeDEntryY({ dValue, factors, primaryModelId, targetKey, secondaryModelId, primaryFactorKey = 'temp' }) {
  const config = MODEL_SECONDARY_CONFIG[primaryModelId]?.targets?.[targetKey];
  if (!config || !Number.isFinite(dValue) || dValue <= 0) return null;

  const model = SECONDARY_MODELS[secondaryModelId];
  const xFactorKey = model?.factorKeys?.[0] ?? primaryFactorKey;
  const factorValue = model?.factorKeys?.length
    ? getFactorValue(factors, xFactorKey)
    : (getFactorValue(factors, primaryFactorKey) ?? 0);
  if (!Number.isFinite(factorValue) || model?.factorKeys?.some(key => !Number.isFinite(getFactorValue(factors, key)))) return null;

  const transform = resolveTransform(config, secondaryModelId);
  const fitValue = toFitValue(dValue, config, secondaryModelId);
  const transformedValue = transformResponse(fitValue, transform);

  if (!Number.isFinite(transformedValue)) return null;

  return {
    datasetId: `manual_${Date.now()}_${_manualIdCounter++}`,
    datasetName: 'Manual D',
    factors,
    x: factorValue,
    rawValue: dValue,
    fitValue,
    y: transformedValue,
    primaryModelId,
    targetKey,
    secondaryModelId,
    responseTransform: transform,
  };
}
