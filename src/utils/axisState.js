import Papa from 'papaparse';
import { isHeaderLike, readDelimitedRecords } from './pastePreview.js';

export function axisScale(mode, conditions, from, to) {
  const toMin = unit => mode.timeUnitOptions?.find(option => option.key === unit)?.toMin ?? 1;
  if (Boolean(from.useDoseAxis) === Boolean(to.useDoseAxis)) {
    return from.useDoseAxis ? 1 : toMin(from.timeUnit) / toMin(to.timeUnit);
  }
  const key = mode.doseAxis?.factor;
  const value = Number(conditions?.[key]);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Cannot convert the x-axis without a positive ${key} for every dataset. Enter the original treatment condition first.`);
  }
  const dosePerMinute = key === 'intensity' ? value * 0.06 : key === 'doseRate' ? value / 60 : NaN;
  if (!Number.isFinite(dosePerMinute)) throw new Error('This dose-axis conversion is not supported.');
  return to.useDoseAxis ? dosePerMinute * toMin(from.timeUnit) : 1 / (dosePerMinute * toMin(to.timeUnit));
}

export function convertDatasetsAxis(mode, datasets, from, to) {
  return datasets.map(dataset => {
    if (!dataset.data?.length) return dataset;
    const scale = axisScale(mode, dataset.conditions, from, to);
    return { ...dataset, axis: { ...to }, data: dataset.data.map(point => ({ ...point, t: point.t * scale })) };
  });
}

export function rescalePendingText(text, scale, label) {
  if (!text.trim()) return text;
  const rows = readDelimitedRecords(text);
  const hasHeader = rows[0] && isHeaderLike(rows[0].cells);
  return Papa.unparse(rows.map((row, index) => {
    const cells = [...row.cells];
    if (hasHeader && index === 0) cells[0] = label;
    else {
      if (cells[0] === '' || !Number.isFinite(Number(cells[0]))) throw new Error(`Cannot convert the pending x value on line ${row.lineNumber}.`);
      cells[0] = Number(cells[0]) * scale;
    }
    return cells;
  }), { newline: '\n' });
}

export function convertSecondaryAxisState(mode, state, from, to, primaryModels) {
  if (!state) return state;
  if (Boolean(from.useDoseAxis) !== Boolean(to.useDoseAxis)) {
    throw new Error('Cannot change time/dose axes while retained secondary inputs exist. Clear the secondary inputs by replacing the current data or switching modes, then re-enter them on the new axis.');
  }
  const scale = axisScale(mode, {}, from, to);
  const roles = Object.fromEntries((primaryModels[state.primaryModelId]?.params ?? []).map(param => [param.name, param.role]));
  return {
    ...state,
    manualDEntries: state.manualDEntries?.map(entry => ({ ...entry, D: entry.D * scale })),
    manualParams: Object.fromEntries(Object.entries(state.manualParams ?? {}).map(([key, value]) => [key,
      roles[key] === 'rate' ? value / scale : ['time', 'timeScale'].includes(roles[key]) ? value * scale : value])),
  };
}
