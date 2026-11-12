let fallbackId = 0;

export function createDatasetId() {
  return `dataset_${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${fallbackId++}_${Math.random().toString(36).slice(2)}`}`;
}

export function fittingInputSignature(input) {
  return JSON.stringify(input);
}

export function scheduleFit(callback, delay = 20) {
  const timer = setTimeout(callback, delay);
  return () => clearTimeout(timer);
}
