import { getParamsForDoseAxis } from '../models/inactivationModels.js';
import { expandPrimaryObservations } from './primaryObservations.js';

export function buildPrimaryFitReportRows(dataset, result, model, visibleFactors = [], { axisUnit = 'min', axisLabel = 'Time' } = {}) {
  const rows = [];
  const observations = expandPrimaryObservations(dataset?.data ?? []);
  rows.push(['Section', 'Field', 'Value']);
  rows.push(['Basic Info', 'Dataset', dataset?.name ?? '']);
  rows.push(['Basic Info', 'Model', model?.name ?? result?.modelId ?? '']);
  rows.push(['Basic Info', 'n', result?.n ?? observations.length]);
  rows.push(['Basic Info', 'Observation basis', 'All supplied individual log-count observations; single supplied values used when raw replicates are unavailable']);
  visibleFactors.forEach((factor) => {
    const value = dataset?.conditions?.[factor.key];
    if (Number.isFinite(value)) {
      rows.push(['Basic Info', `${factor.label}${factor.unit ? ` (${factor.unit})` : ''}`, factor.key === 'aw' ? value.toFixed(3) : value]);
    }
  });
  rows.push([]);

  rows.push(['Statistics', 'Metric', 'Value']);
  rows.push(['Statistics', 'R2', result?.r2 ?? '']);
  rows.push(['Statistics', 'Adj. R2', result?.r2adj ?? '']);
  rows.push(['Statistics', 'RMSE', result?.rmse ?? '']);
  rows.push(['Statistics', 'Residual standard error', result?.residualSE ?? '']);
  rows.push(['Statistics', 'AICc parameter count (including variance)', result?.aiccParameterCount ?? '']);
  rows.push(['Statistics', 'AICc', result?.aiccValid === false ? 'N/A' : (result?.aicc ?? '')]);
  rows.push(['Statistics', 'Converged', result?.converged !== undefined ? (result.converged ? 'Yes' : 'No') : '']);
  rows.push(['Statistics', 'Convergence reason', result?.convergenceReason?.replace(/_/g, ' ') ?? '']);
  rows.push(['Statistics', 'Iterations', result?.iterations ?? '']);
  rows.push(['Statistics', 'Residual normality p-value', result?.normalityPValue ?? '']);
  rows.push(['Statistics', 'Residual trend slope', result?.resTrendSlope ?? '']);
  rows.push(['Statistics', 'Max absolute residual', result?.maxAbsResidual ?? '']);
  rows.push(['Statistics', 'Runs test p-value', result?.runsTestP ?? '']);
  rows.push([]);

  rows.push(['Parameters', 'Parameter', 'Estimate', 'Standard Error', '95% Param CI Lower', '95% Param CI Upper']);
  getParamsForDoseAxis(model?.params ?? [], axisUnit).forEach((param) => {
    const ci = result?.paramCI95?.[param.name];
    rows.push([
      'Parameters',
      param.label,
      result?.params?.[param.name] ?? '',
      result?.paramErrors?.[param.name] ?? '',
      ci?.[0] ?? '',
      ci?.[1] ?? '',
    ]);
  });
  rows.push([]);

  rows.push(['Observed vs Predicted', `${axisLabel}${axisUnit ? ` (${axisUnit})` : ''}`,  'Observed', 'Predicted', 'Residual']);
  observations.forEach((point) => {
    const predicted = model?.fn ? model.fn(point.t, result?.params ?? {}) : null;
    rows.push([
      'Observed vs Predicted',
      point.t,
      point.logN,
      Number.isFinite(predicted) ? predicted : '',
      Number.isFinite(predicted) && Number.isFinite(point.logN) ? point.logN - predicted : '',
    ]);
  });

  return rows;
}

