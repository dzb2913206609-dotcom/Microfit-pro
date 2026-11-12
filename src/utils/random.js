export function normalizeSeed(seed) {
  const text = String(seed ?? '').trim();
  if (!text) return null;
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createSeededRng(seed) {
  let state = normalizeSeed(seed);
  if (state == null) return Math.random;
  if (state === 0) state = 0x9e3779b9;

  return function rng() {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function deriveSeed(seed, suffix) {
  const text = String(seed ?? '').trim();
  return text ? `${text}:${suffix}` : '';
}

export function generateRandomSeed() {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj?.getRandomValues) {
    const values = new Uint32Array(2);
    cryptoObj.getRandomValues(values);
    return `${values[0].toString(36)}${values[1].toString(36)}`;
  }
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 0xffffffff).toString(36)}`;
}
