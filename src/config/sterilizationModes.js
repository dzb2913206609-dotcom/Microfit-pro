/**
 * Sterilization mode configurations.
 *
 * All 5 sterilization technologies: Thermal, HPP, Photoinactivation, PEF, Chemical.
 *
 * Each mode references factors by key (see factors.js) — no duplicated definitions.
 */

import { FACTORS, getFactorDef } from './factors.js';

export const STERILIZATION_MODES = {
  thermal: {
    id: 'thermal',
    label: 'Thermal',
    icon: 'Flame',
    primaryFactor: 'temp',
    secondaryFactor: 'aw',
    zFactor: 'pH',
    lethalityMetric: {
      name: 'Thermal Lethality',
      unit: 'min',
      source: 'integral',
      referenceParams: [
        { key: 'Tref', label: 'T<sub>ref</sub> (\u00B0C)', default: 121.1 },
        { key: 'zValue', label: 'z (\u00B0C)', default: 10 },
      ],
      targetParam: { key: 'targetF', label: 'Target F-value (min)', default: 3.0 },
      rate: (env, params) => {
        if (!Number.isFinite(params.Tref) || !Number.isFinite(params.zValue) || params.zValue <= 0) return NaN;
        return env.temp > params.Tref - 3 * params.zValue ? 10 ** ((env.temp - params.Tref) / params.zValue) : 0;
      },
      compute: (env, params, prevL, dt) => {
        const T = env.temp ?? 0;
        const threshold = params.Tref - 3 * params.zValue;
        const L =
          T > threshold
            ? Math.pow(10, (T - params.Tref) / params.zValue)
            : 0;
        return { lethality: L, dF: ((prevL + L) / 2) * dt };
      },
    },
    applicableSecondaryModels: [
      'BIGELOW',
      'ARRHENIUS',
      'SQRTMODEL',
      'LINEAR',
      'AVERAGE',
      'EXTENDED_BIGELOW',
      'EXTENDED_BIGELOW_PH',
      'BIGELOW_TRIPLE',
    ],
    profileColumns: ['temp', 'aw', 'pH'],
    csvAliases: {
      temp: ['temperature', 'temp', 't_c', 'temp_c'],
      aw: ['aw', 'water_activity', 'wateractivity'],
      pH: ['ph', 'pH'],
    },
    defaultProfile: [
      { t: 0, temp: 20, aw: 1, pH: 7 },
      { t: 5, temp: 80, aw: 1, pH: 7 },
      { t: 30, temp: 121, aw: 1, pH: 7 },
      { t: 35, temp: 20, aw: 1, pH: 7 },
    ],
  },

  hpp: {
    id: 'hpp',
    label: 'HPP',
    icon: 'Gauge',
    primaryFactor: 'pressure',
    secondaryFactor: 'aw',
    zFactor: 'temp',
    lethalityMetric: {
      name: 'Log Reduction',
      unit: 'log\u2081\u2080',
      source: 'state',
      referenceParams: [],
      targetParam: {
        key: 'targetLogRed',
        label: 'Target Log Reduction',
        default: 5.0,
      },
      compute: null,
    },
    applicableSecondaryModels: [
      'BIGELOW_PRESSURE',
      'EXTENDED_BIGELOW_PRESSURE',
      'PATP_TRIPLE',
      'BIGELOW_PRESSURE_PH',
      'BIGELOW_PRESSURE_TEMP_PH',
      'BIGELOW_PRESSURE_AW_PH',
      'LINEAR_PRESSURE',
      'ARRHENIUS_EYRING',
      'AVERAGE',
    ],
    profileColumns: ['pressure', 'temp', 'aw', 'pH'],
    csvAliases: {
      pressure: ['pressure', 'p', 'p_mpa', 'pressure_mpa'],
      temp: ['temperature', 'temp', 't_c', 'temp_c'],
      aw: ['aw', 'water_activity', 'wateractivity'],
    },
    defaultProfile: [
      { t: 0, pressure: 100, temp: 25, aw: 1 },
      { t: 1, pressure: 400, temp: 35, aw: 1 },
      { t: 10, pressure: 400, temp: 35, aw: 1 },
      { t: 11, pressure: 0.1, temp: 25, aw: 1 },
    ],
  },

  photoinactivation: {
    id: 'photoinactivation',
    label: 'Photoinactivation',
    icon: 'Sun',
    primaryFactor: 'intensity',
    doseAxis: {
      factor: 'intensity',
      label: 'Fluence',
      unit: 'J/cm²',
      convert: (t, env) => (env.intensity ?? 0) * t * 0.06,
    },
    secondaryFactor: 'aw',
    zFactor: 'turbidity',
    lethalityMetric: {
      name: 'Fluence',
      unit: 'mJ/cm\u00B2',
      source: 'integral',
      referenceParams: [],
      targetParam: { key: 'targetFluence', label: 'Target Fluence (mJ/cm\u00B2)', default: 40.0 },
      rate: env => env.intensity * 60,
      compute: (env, _params, _prevL, dt) => {
        const I = env.intensity ?? 0;
        const dF = I * dt * 60; // mW/cm² × min → mJ/cm² (×60 s/min)
        return { lethality: I, dF };
      },
    },
    applicableSecondaryModels: [
      'PHOTO_INTENSITY',
      'PHOTO_INTENSITY_TURBIDITY',
      'PHOTO_INTENSITY_AW',
      'PHOTO_TRIPLE',
      'LINEAR_PHOTO',
      'AVERAGE',
    ],
    profileColumns: ['intensity', 'aw'],
    csvAliases: {
      intensity: ['lightintensity', 'intensity', 'i', 'light_intensity', 'photoinactivation_intensity'],
      aw: ['aw', 'water_activity', 'wateractivity'],
    },
    defaultProfile: [
      { t: 0, intensity: 0, aw: 1 },
      { t: 0.5, intensity: 10, aw: 1 },
      { t: 5, intensity: 10, aw: 1 },
      { t: 5.5, intensity: 0, aw: 1 },
    ],
  },

  pef: {
    id: 'pef',
    label: 'PEF',
    icon: 'Zap',
    primaryFactor: 'electricField',
    secondaryFactor: 'aw',
    zFactor: 'conductivity',
    timeUnitOptions: [
      { key: 'min', label: 'min', toMin: 1 },
      { key: 'ms',  label: 'ms',  toMin: 1 / 60000 },
      { key: 'μs',  label: 'μs',  toMin: 1 / 60000000 },
    ],
    lethalityMetric: {
      name: 'Specific Energy',
      unit: 'kJ/kg',
      source: 'integral',
      referenceParams: [
        { key: 'conductivity', label: '\u03C3 (mS/cm)', default: 2.0 },
        { key: 'density', label: '\u03C1 (kg/m\u00B3)', default: 1000 },
      ],
      targetParam: { key: 'targetEnergy', label: 'Target Energy (kJ/kg)', default: 100.0 },
      rate: (env, params) => {
        const conductivity = params.conductivity ?? 2;
        const density = params.density ?? 1000;
        const timeFactor = params._timeUnitToMin ?? 1;
        if (![conductivity, density, timeFactor].every(Number.isFinite) || conductivity < 0 || density <= 0 || timeFactor <= 0) return NaN;
        return conductivity * .1 * (env.electricField * 1e5) ** 2 * timeFactor * 60 / (density * 1000);
      },
      compute: (env, params, _prevL, dt) => {
        const E_Vm = (env.electricField ?? 0) * 1e5;       // kV/cm → V/m
        const sigma_Sm = (params.conductivity ?? 2.0) * 0.1; // mS/cm → S/m
        const rho = params.density ?? 1000;                  // kg/m³
        const tuToMin = params._timeUnitToMin ?? 1;
        const dtMin = dt * tuToMin;
        const dF = (sigma_Sm * E_Vm * E_Vm * dtMin * 60) / (rho * 1000); // J/kg → kJ/kg
        const lethality = sigma_Sm * E_Vm * E_Vm / (rho * 1000);
        return { lethality, dF };
      },
    },
    applicableSecondaryModels: [
      'PEF_FIELD',
      'PEF_FIELD_CONDUCTIVITY',
      'PEF_FIELD_AW',
      'PEF_TRIPLE',
      'LINEAR_PEF',
      'AVERAGE',
    ],
    profileColumns: ['electricField', 'aw'],
    csvAliases: {
      electricField: ['electricfield', 'field', 'e', 'electric_field'],
      aw: ['aw', 'water_activity', 'wateractivity'],
    },
    defaultProfile: [
      { t: 0, electricField: 0, aw: 1 },
      { t: 0.01, electricField: 20, aw: 1 },
      { t: 0.1, electricField: 20, aw: 1 },
      { t: 0.11, electricField: 0, aw: 1 },
    ],
  },

  chemical: {
    id: 'chemical',
    label: 'Chemical',
    icon: 'FlaskConical',
    primaryFactor: 'concentration',
    secondaryFactor: 'temp',
    zFactor: 'pH',
    lethalityMetric: {
      name: 'CT Value',
      unit: 'mg\u00B7min/L',
      source: 'integral',
      referenceParams: [],
      targetParam: { key: 'targetCT', label: 'Target CT (mg\u00B7min/L)', default: 15.0 },
      rate: env => env.concentration,
      compute: (env, _params, _prevL, dt) => {
        const C = env.concentration ?? 0;
        const dF = C * dt; // mg/L × min = mg·min/L
        return { lethality: C, dF };
      },
    },
    applicableSecondaryModels: [
      'CHEMICAL_CONC',
      'CHEMICAL_CONC_TEMP',
      'CHEMICAL_CONC_PH',
      'CHEMICAL_CONC_AW',
      'CHEMICAL_CONC_TEMP_PH',
      'CHEMICAL_TRIPLE',
      'CHEMICAL_QUAD',
      'LINEAR_CHEM',
      'AVERAGE',
    ],
    profileColumns: ['concentration', 'temp', 'aw'],
    csvAliases: {
      concentration: ['concentration', 'conc', 'c', 'ppm'],
      temp: ['temperature', 'temp', 't_c', 'temp_c'],
      aw: ['aw', 'water_activity', 'wateractivity'],
    },
    defaultProfile: [
      { t: 0, concentration: 0, temp: 25, aw: 1 },
      { t: 1, concentration: 200, temp: 25, aw: 1 },
      { t: 30, concentration: 200, temp: 25, aw: 1 },
      { t: 31, concentration: 0, temp: 25, aw: 1 },
    ],
  },

  irradiation: {
    id: 'irradiation',
    label: 'Irradiation',
    icon: 'Atom',
    primaryFactor: 'doseRate',
    doseAxis: {
      factor: 'doseRate',
      label: 'Absorbed Dose',
      unit: 'kGy',
      convert: (t, env) => (env.doseRate ?? 0) * t / 60,
    },
    secondaryFactor: 'temp',
    zFactor: 'aw',
    lethalityMetric: {
      name: 'Absorbed Dose',
      unit: 'kGy',
      source: 'integral',
      referenceParams: [],
      targetParam: { key: 'targetDose', label: 'Target Dose (kGy)', default: 10.0 },
      rate: env => env.doseRate / 60,
      compute: (env, _params, _prevL, dt) => {
        const DR = env.doseRate ?? 0;
        const dF = DR * dt / 60; // kGy/h × min / 60 = kGy
        return { lethality: DR, dF };
      },
    },
    applicableSecondaryModels: [
      'IRRAD_DOSE',
      'IRRAD_DOSE_TEMP',
      'IRRAD_DOSE_AW',
      'IRRAD_TRIPLE',
      'LINEAR_IRRAD',
      'AVERAGE',
    ],
    profileColumns: ['doseRate', 'temp', 'aw'],
    csvAliases: {
      doseRate: ['doserate', 'dose_rate', 'dr', 'kgy_h'],
      temp: ['temperature', 'temp', 't_c', 'temp_c'],
      aw: ['aw', 'water_activity', 'wateractivity'],
    },
    defaultProfile: [
      { t: 0, doseRate: 0, temp: 25, aw: 1 },
      { t: 1, doseRate: 5, temp: 25, aw: 1 },
      { t: 60, doseRate: 5, temp: 25, aw: 1 },
      { t: 61, doseRate: 0, temp: 25, aw: 1 },
    ],
  },

  custom: {
    id: 'custom',
    label: 'Custom',
    icon: 'SlidersHorizontal',
    primaryFactor: 'custom_f1',
    secondaryFactor: null,
    zFactor: null,
    isCustomMode: true,
    lethalityMetric: {
      name: 'None',
      unit: '',
      source: 'state',
      referenceParams: [],
      targetParam: { key: 'targetLogRed', label: 'Target Log Reduction', default: 5.0 },
      compute: null,
    },
    applicableSecondaryModels: [
      'CUSTOM_Z1',
      'CUSTOM_Z2',
      'CUSTOM_Z3',
      'LINEAR_CUSTOM',
      'AVERAGE',
    ],
    profileColumns: ['custom_f1'],
    csvAliases: {},
    defaultProfile: [
      { t: 0, custom_f1: 0 },
      { t: 5, custom_f1: 50 },
      { t: 30, custom_f1: 50 },
      { t: 35, custom_f1: 0 },
    ],
  },
};

/** Resolve a factor key to its full FACTORS definition within a mode. */
export function resolveModeFactor(modeConfig, role) {
  const key = modeConfig[role];
  return key ? getFactorDef(key) : null;
}

/** Get a mode config by id. */
export function getModeById(id) {
  return STERILIZATION_MODES[id];
}

/** Get all mode configs as an array. */
export function getModeList() {
  return Object.values(STERILIZATION_MODES);
}

/**
 * Update the custom mode's factor layout at runtime based on user-defined factors.
 * @param {string[]} factorKeys - primary x-axis key plus 1–3 condition factor keys already registered in FACTORS.
 */
export function updateCustomModeFactors(factorKeys) {
  const mode = STERILIZATION_MODES.custom;
  if (!mode) return;
  const [f1, f2, f3] = factorKeys;
  mode.primaryFactor = f1 || 'custom_f1';
  mode.secondaryFactor = f2 || null;
  mode.zFactor = f3 || null;
  mode.profileColumns = factorKeys.slice();
  mode.csvAliases = Object.fromEntries(factorKeys.map((k) => {
    const def = getFactorDef(k);
    return [
      k,
      [k, k.toLowerCase(), def?.label, def?.shortLabel]
        .filter(Boolean)
        .map((alias) => String(alias)),
    ];
  }));

  // Rebuild default profile
  const row = { t: 0 };
  factorKeys.forEach((k) => {
    const def = getFactorDef(k);
    row[k] = def ? def.default : 0;
  });
  mode.defaultProfile = [
    { ...row, t: 0 },
    { ...row, t: 5 },
    { ...row, t: 30 },
    { ...row, t: 35 },
  ];

  // Choose applicable secondary models based on factor count
  const conditionFactorCount = Math.max(factorKeys.length - 1, 0);
  const models = ['AVERAGE'];
  if (conditionFactorCount >= 1) models.push('LINEAR_CUSTOM', 'CUSTOM_Z1');
  if (conditionFactorCount >= 2) models.push('CUSTOM_Z2');
  if (conditionFactorCount >= 3) models.push('CUSTOM_Z3');
  mode.applicableSecondaryModels = models;
}
