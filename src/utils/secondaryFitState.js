import { buildSecondaryRows, computeDEntryY } from '../models/secondaryModels.js';

export function reconcileSecondaryFits(precomputed = {}, local = {}, inputSignature) {
  return { ...precomputed, ...Object.fromEntries(Object.entries(local).filter(([, fit]) =>
    fit.userOverride && fit.inputSignature === inputSignature)) };
}

export function buildRowsForSecondary({ manualDEntries = [], ...input }) {
  const rows = buildSecondaryRows(input);
  for (const entry of manualDEntries) {
    const row = computeDEntryY({ ...input, dValue: entry.D, factors: entry.factors });
    if (row) rows.push({ ...row, datasetId: `manual_${entry.id}` });
  }
  return rows;
}

export function rankSecondaryCandidates(candidates, { primaryParameter = false } = {}) {
  const valueKey = primaryParameter ? 'aiccPrimaryParameter' : 'aicc';
  const validityKey = primaryParameter ? 'aiccPrimaryParameterValid' : 'aiccValid';
  const scaleKey = primaryParameter ? 'aiccPrimaryParameterScale' : 'aiccScale';
  const valid = candidates.filter(([, fit]) => !fit.failed && fit.converged !== false && fit[validityKey] !== false && Number.isFinite(fit[valueKey]));
  // Likelihoods compare only the same observations on the same response scale.
  const groups = new Map();
  for (const entry of valid) {
    const fit = entry[1];
    const key = JSON.stringify([fit[scaleKey] ?? fit.targetKey, (fit.rows ?? []).map(row => row.datasetId).sort()]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  const comparable = [...groups.values()].sort((a, b) => (b[0][1].rows?.length ?? 0) - (a[0][1].rows?.length ?? 0) || b.length - a.length)[0] ?? [];
  return comparable.sort((a, b) => a[1][valueKey] - b[1][valueKey]);
}
