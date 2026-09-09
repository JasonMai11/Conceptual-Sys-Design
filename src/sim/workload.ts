import { createZipfSampler } from './rng';
import type { Challenge } from './types';

export interface WorkloadSummary {
  total: number;
  seconds: number;
  perSecond: number[];
  peakRps: number;
  peakSecond: number;
  meanRps: number;
  catalogSize: number;
  /** Share of all requests landing in the top N most popular product IDs. */
  shares: { top10: number; top50: number; top250: number; top500: number };
  timeoutMs: number;
  seed: number;
}

/**
 * Everything the challenge panel needs to *state* the workload rather than
 * merely assert it. Derived from the same sampler the engine uses, so the
 * displayed distribution is the distribution that runs.
 */
export function summarizeWorkload(challenge: Challenge): WorkloadSummary {
  const w = challenge.workload;
  const perSecond = [...w.requestsPerSecond];
  const total = perSecond.reduce((a, b) => a + b, 0);
  let peakRps = 0;
  let peakSecond = 0;
  perSecond.forEach((r, i) => {
    if (r > peakRps) {
      peakRps = r;
      peakSecond = i;
    }
  });
  const sampler = createZipfSampler(w.catalogSize, w.zipfExponent, w.seed);
  return {
    total,
    seconds: perSecond.length,
    perSecond,
    peakRps,
    peakSecond,
    meanRps: total / perSecond.length,
    catalogSize: w.catalogSize,
    shares: {
      top10: sampler.topShare(10),
      top50: sampler.topShare(50),
      top250: sampler.topShare(250),
      top500: sampler.topShare(500),
    },
    timeoutMs: w.requestTimeoutMs,
    seed: w.seed,
  };
}
