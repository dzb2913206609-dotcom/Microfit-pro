import { Fragment } from 'react';
import { getFormattedLabelParts } from './formatLabels.js';

export function FormattedLabel({ text, children, className, style }) {
  const parts = getFormattedLabelParts(text ?? children);
  return (
    <span className={className} style={style}>
      {parts.map((part, index) => (
        part.sub != null
          ? (
            <Fragment key={index}>
              {part.base}<sub>{part.sub}</sub>
            </Fragment>
          )
          : <Fragment key={index}>{part.text}</Fragment>
      ))}
    </span>
  );
}

export function SvgFormattedLabel({
  x,
  y,
  payload,
  value,
  textAnchor = 'end',
  fill = '#475569',
  fontSize = 12,
}) {
  const parts = getFormattedLabelParts(value ?? payload?.value ?? '');
  return (
    <text x={x} y={y} textAnchor={textAnchor} fill={fill} fontSize={fontSize} dominantBaseline="central">
      {parts.map((part, index) => (
        part.sub != null
          ? (
            <Fragment key={index}>
              <tspan>{part.base}</tspan>
              <tspan baselineShift="sub" fontSize="0.72em">{part.sub}</tspan>
            </Fragment>
          )
          : <tspan key={index}>{part.text}</tspan>
      ))}
    </text>
  );
}
