export function computePaddedAxisRange(
  values,
  {
    includeZero = false,
    padFraction = 0.08,
    minPad = 0.5,
  } = {},
) {
  const finiteValues = values.filter((value) => Number.isFinite(value));
  if (finiteValues.length === 0) return undefined;

  const min = Math.min(...finiteValues);
  const max = Math.max(...finiteValues);
  const span = max - min;
  const pad = Math.max(span * padFraction, minPad);
  const lowerCandidate = min - pad;
  const lower = includeZero && min >= 0 ? 0 : lowerCandidate;
  const upper = max + pad;

  if (lower === upper) {
    const fallbackPad = Math.max(minPad, Math.abs(max) * padFraction, 1);
    return [lower - (includeZero && min >= 0 ? 0 : fallbackPad), upper + fallbackPad];
  }

  return [lower, upper];
}
