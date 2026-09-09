/**
 * Fixed-resolution time series used for rates, queue depth, and utilization.
 *
 * Values are only ever written at event boundaries, never at frame boundaries,
 * so the series a run produces does not depend on how finely the UI stepped
 * through simulated time. That is what makes playback speed irrelevant to
 * results.
 */
export class Buckets {
  readonly bucketMs: number;
  readonly data: Float64Array;

  constructor(horizonMs: number, bucketMs: number) {
    this.bucketMs = bucketMs;
    this.data = new Float64Array(Math.ceil(horizonMs / bucketMs) + 2);
  }

  /** Record a single occurrence at time `t`. */
  point(t: number, value = 1): void {
    const i = Math.min(this.data.length - 1, Math.max(0, Math.floor(t / this.bucketMs)));
    this.data[i] += value;
  }

  /** Record the integral of a constant `level` over `[t0, t1)`, split by bucket. */
  span(t0: number, t1: number, level: number): void {
    if (t1 <= t0 || level === 0) return;
    let start = t0;
    while (start < t1) {
      const i = Math.min(this.data.length - 1, Math.max(0, Math.floor(start / this.bucketMs)));
      const boundary = (i + 1) * this.bucketMs;
      const end = Math.min(t1, boundary);
      this.data[i] += (end - start) * level;
      if (end === start) break; // defensive: never spin on zero-width spans
      start = end;
    }
  }

  /** Sum over `[now - windowMs, now)`, prorating the partly elapsed buckets. */
  window(now: number, windowMs: number): number {
    const from = Math.max(0, now - windowMs);
    let total = 0;
    const first = Math.floor(from / this.bucketMs);
    const last = Math.min(this.data.length - 1, Math.floor(Math.max(0, now - 1e-9) / this.bucketMs));
    for (let i = first; i <= last; i++) {
      const lo = i * this.bucketMs;
      const hi = lo + this.bucketMs;
      const overlap = Math.min(hi, now) - Math.max(lo, from);
      if (overlap <= 0) continue;
      total += this.data[i] * (overlap / this.bucketMs);
    }
    return total;
  }

  total(): number {
    let sum = 0;
    for (let i = 0; i < this.data.length; i++) sum += this.data[i];
    return sum;
  }

  /** Per-second totals, for the charts in the results panel. */
  perSecond(): number[] {
    const perBucket = 1000 / this.bucketMs;
    const seconds = Math.ceil(this.data.length / perBucket);
    const out = new Array<number>(seconds).fill(0);
    for (let i = 0; i < this.data.length; i++) out[Math.floor(i / perBucket)] += this.data[i];
    return out;
  }
}
