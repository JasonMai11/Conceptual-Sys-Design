/** Deterministic PRNG (mulberry32). Same seed => same sequence, every platform. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Sampler over IDs `0..n-1` with weights `1/(rank+1)^exponent` (Zipf).
 * Built once, then sampled in O(log n) via binary search on the CDF.
 */
export function createZipfSampler(n: number, exponent: number, seed: number) {
  const cdf = new Float64Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    total += 1 / Math.pow(i + 1, exponent);
    cdf[i] = total;
  }
  for (let i = 0; i < n; i++) cdf[i] /= total;
  const rng = createRng(seed);

  function sample(): number {
    const u = rng();
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] < u) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Share of traffic expected to land in the top `k` IDs. Used for briefings. */
  function topShare(k: number): number {
    if (k <= 0) return 0;
    return cdf[Math.min(k, n) - 1];
  }

  return { sample, topShare };
}
