import { fitModelMultiStart } from '../models/fitter.js';
import { MODELS } from '../models/inactivationModels.js';

/** Use minutes for ordinary time ranges, and a normalized working axis for
 * short PEF curves. The working scale depends on physical time, never on the
 * displayed unit; positive dimensional parameters use log coordinates there. */
export function fitPrimaryInTimeUnit(modelId, data, { timeUnitToMin = 1, customInit = null } = {}) {
  if (!Number.isFinite(timeUnitToMin) || timeUnitToMin <= 0) throw new Error('The fitting time-unit conversion must be positive.');
  const model = MODELS[modelId];
  if (!model) return null;
  const maxTimeMin = data.reduce((max, row) => Number.isFinite(row.t) ? Math.max(max, Math.abs(row.t * timeUnitToMin)) : max, 0);
  function fitOnAxis(workingTimeMin, logarithmic) {
    const displayToWorking = timeUnitToMin / workingTimeMin;
    const factors = Object.fromEntries(model.params.map(param => [param.name,
      param.role === 'rate' ? displayToWorking : ['time', 'timeScale'].includes(param.role) ? 1 / displayToWorking : 1]));
    const scaleParams = (values, inverse = false) => values && Object.fromEntries(Object.entries(values).map(([key, value]) =>
      [key, value * (inverse ? 1 / (factors[key] ?? 1) : factors[key] ?? 1)]));
    const logParameters = !logarithmic ? [] : model.params
      .filter(param => param.positive && ['rate', 'timeScale'].includes(param.role)).map(param => param.name);
    const paramDefs = model.params.map(param => logParameters.includes(param.name) ? { ...param, min: Number.MIN_VALUE } : param);
    const result = fitModelMultiStart(modelId,
      data.map(row => ({ ...row, t: row.t * displayToWorking })), scaleParams(customInit, true), { paramDefs, logParameters });
    return { result, displayToWorking, factors, scaleParams };
  }
  const shortAxis = maxTimeMin > 0 && maxTimeMin < .1;
  let fit = fitOnAxis(shortAxis ? maxTimeMin : 1, shortAxis);
  // Preserve the established minute fit unless its legacy scale bound is
  // active. A long observation window can still contain very fast kinetics.
  if (!shortAxis && maxTimeMin > 0 && fit.result?.boundaryWarnings?.some(warning =>
    warning.bound === 'min' && model.params.some(param => param.name === warning.paramName && param.role === 'timeScale'))) {
    fit = fitOnAxis(maxTimeMin, true);
  }
  const { result, displayToWorking, factors, scaleParams } = fit;
  if (!result) return null;
  return {
    ...result,
    params: scaleParams(result.params),
    initialParams: scaleParams(result.initialParams),
    paramErrors: scaleParams(result.paramErrors),
    paramCI95: Object.fromEntries(Object.entries(result.paramCI95 ?? {}).map(([key, interval]) =>
      [key, interval.map(value => value * (factors[key] ?? 1))])),
    covMatrix: result.covMatrix?.map((row, i) => row.map((value, j) =>
      value * (factors[result.paramNames[i]] ?? 1) * (factors[result.paramNames[j]] ?? 1))) ?? null,
    resTrendSlope: result.resTrendSlope * displayToWorking,
    boundaryWarnings: result.boundaryWarnings?.map(warning => ({ ...warning,
      boundValue: warning.boundValue * (factors[warning.paramName] ?? 1),
      paramValue: warning.paramValue * (factors[warning.paramName] ?? 1),
    })),
    timeUnitToMin,
  };
}
