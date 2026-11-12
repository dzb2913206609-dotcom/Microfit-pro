/** Original log-count observations for primary fits and curve-level reports.
 * Means remain in the dataset for plotting. Never infer observations from SD
 * or replicate counts when the individual values were not supplied. */
export function expandPrimaryObservations(data) {
  if (!Array.isArray(data)) return data;
  return data.flatMap(row => {
    if (!Array.isArray(row.rawValues) || row.rawValues.length === 0) return [row];
    const { rawValues, ...point } = row;
    // Remove rawValues so repeated normalization cannot multiply observations.
    // Keep invalid supplied values: the fitter must reject, rather than drop, them.
    return rawValues.map(logN => ({ ...point, logN }));
  });
}
