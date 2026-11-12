import { formatMetric, formatParameterValue } from '../models/fitter';
import { FormattedLabel } from '../utils/formatLabels.jsx';

function ParameterValue({ parameter, params }) {
  return formatParameterValue(parameter.name === 'logDref'
    ? Math.pow(10, params[parameter.name])
    : params[parameter.name]);
}

export default function SecondaryFitSummary({ fit, model, primaryModelName, targetLabel }) {
  const estimated = model?.params.filter(parameter => !parameter.fixed) ?? [];
  const fixed = model?.params.filter(parameter => parameter.fixed) ?? [];
  const metrics = [
    { label: 'R²', value: formatMetric(fit.r2), note: 'Regression scale' },
    { label: 'Adj. R²', value: formatMetric(fit.r2adj), note: 'Regression scale' },
    { label: 'RMSE', value: formatMetric(fit.rmse), note: `Regression scale: ${fit.rmseScale ?? 'identity'}` },
    { label: 'AICc', value: fit.aiccValid === false ? 'N/A' : formatMetric(fit.aicc), note: `Target scale: ${fit.aiccScale ?? targetLabel}` },
  ];

  return (
    <>
      <div className="secondary-fit-context">
        <strong>{model?.name?.replace(/\s*\(.*\)\s*$/, '').trim()}</strong>
        <span>{primaryModelName} · <FormattedLabel text={targetLabel} /></span>
      </div>
      <dl className="secondary-metric-grid" aria-label="Key fit statistics">
        {metrics.map(metric => (
          <div className="secondary-metric" key={metric.label}>
            <dt><FormattedLabel text={metric.label} /></dt>
            <dd>{metric.value}</dd>
            <span>{metric.note}</span>
          </div>
        ))}
      </dl>
      <h3 className="secondary-group-title">Estimated parameters</h3>
      <dl className="secondary-estimates">
        {estimated.map(parameter => (
          <div key={parameter.name}>
            <dt><FormattedLabel text={parameter.name === 'logDref' ? 'D_ref' : parameter.label} /></dt>
            <dd><ParameterValue parameter={parameter} params={fit.params} /></dd>
          </div>
        ))}
      </dl>
      {fixed.length > 0 && (
        <div className="secondary-reference-values">
          <h3>Fixed reference values</h3>
          <dl>
            {fixed.map(parameter => (
              <div key={parameter.name}>
                <dt><FormattedLabel text={parameter.label} /></dt>
                <dd><ParameterValue parameter={parameter} params={fit.params} /></dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </>
  );
}
