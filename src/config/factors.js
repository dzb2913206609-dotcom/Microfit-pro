/**
 * Single source of truth for all environmental factor definitions.
 * sterilizationModes.js references factors by key only.
 *
 * - default:    UI initial value for form inputs
 * - scalingRef: mathematical reference value for secondary model regression
 */

export const FACTORS = {
  temp: {
    key: 'temp',
    label: 'Temperature',
    shortLabel: 'T',
    unit: '°C',
    min: 20,
    max: 150,
    step: 1,
    default: 60,
    scalingRef: 60,
  },
  pressure: {
    key: 'pressure',
    label: 'Pressure',
    shortLabel: 'P',
    unit: 'MPa',
    min: 100,
    max: 800,
    step: 10,
    default: 400,
    scalingRef: 400,
  },
  aw: {
    key: 'aw',
    label: 'Water Activity',
    shortLabel: 'a_w',
    unit: '',
    min: 0,
    max: 1,
    step: 0.001,
    default: 1.0,
    scalingRef: 1.0,
  },
  pH: {
    key: 'pH',
    label: 'pH',
    shortLabel: 'pH',
    unit: '',
    min: 1,
    max: 12,
    step: 0.1,
    default: 7.0,
    scalingRef: 7.0,
  },
  intensity: {
    key: 'intensity',
    label: 'Intensity',
    shortLabel: 'I',
    unit: 'mW/cm²',
    min: 0,
    max: 500,
    step: 1,
    default: 10,
    scalingRef: 10,
  },
  turbidity: {
    key: 'turbidity',
    label: 'Turbidity',
    shortLabel: 'NTU',
    unit: 'NTU',
    min: 0,
    max: 1000,
    step: 1,
    default: 0,
    scalingRef: 0,
  },
  electricField: {
    key: 'electricField',
    label: 'Electric Field',
    shortLabel: 'E',
    unit: 'kV/cm',
    min: 0,
    max: 80,
    step: 0.5,
    default: 20,
    scalingRef: 20,
  },
  conductivity: {
    key: 'conductivity',
    label: 'Conductivity',
    shortLabel: 'σ',
    unit: 'mS/cm',
    min: 0,
    max: 20,
    step: 0.1,
    default: 2.0,
    scalingRef: 2.0,
  },
  concentration: {
    key: 'concentration',
    label: 'Concentration',
    shortLabel: 'C',
    unit: 'ppm',
    min: 0,
    max: 10000,
    step: 10,
    default: 200,
    scalingRef: 200,
  },
  doseRate: {
    key: 'doseRate',
    label: 'Dose Rate',
    shortLabel: 'DR',
    unit: 'kGy/h',
    min: 0,
    max: 50,
    step: 0.1,
    default: 5,
    scalingRef: 5,
  },
};

/**
 * Runtime registry for user-defined custom factors.
 * Entries are created/removed via registerCustomFactor / clearCustomFactors.
 */
const CUSTOM_FACTORS = {};

export function registerCustomFactor({ key, label, shortLabel, unit, min, max, step, defaultValue }) {
  const resolvedMin = Number.isFinite(min) ? min : 0;
  const resolvedMax = Number.isFinite(max) ? max : 100;
  const resolvedDefault = Number.isFinite(defaultValue) ? defaultValue : (resolvedMin + resolvedMax) / 2;
  const def = {
    key,
    label: label || key,
    shortLabel: shortLabel || label || key,
    unit: unit || '',
    min: resolvedMin,
    max: resolvedMax,
    step: Number.isFinite(step) ? step : 1,
    default: resolvedDefault,
    scalingRef: resolvedDefault,
    isCustom: true,
  };
  CUSTOM_FACTORS[key] = def;
  return def;
}

export function clearCustomFactors() {
  Object.keys(CUSTOM_FACTORS).forEach((k) => delete CUSTOM_FACTORS[k]);
}

export function getCustomFactors() {
  return { ...CUSTOM_FACTORS };
}

/** Get a single factor definition by key. */
export function getFactorDef(key) {
  return FACTORS[key] || CUSTOM_FACTORS[key];
}

/** Get an array of factor definitions for the given keys. */
export function getFactorDefs(keys) {
  return keys.map((k) => FACTORS[k] || CUSTOM_FACTORS[k]).filter(Boolean);
}

/** Get all factor definitions as an array. */
export function getAllFactorDefs() {
  return [...Object.values(FACTORS), ...Object.values(CUSTOM_FACTORS)];
}
