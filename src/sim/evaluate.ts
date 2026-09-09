import { KINDS } from './catalog';
import type { NodeSummary, RunResult } from './engine';
import type { Architecture, Challenge, ValidationResult } from './types';

export type Verdict = 'invalid' | 'missed' | 'passed';

export interface CriterionResult {
  label: string;
  met: boolean;
  detail: string;
}

export interface Evaluation {
  verdict: Verdict;
  headline: string;
  criteria: CriterionResult[];
  /** What the run actually did, each line traceable to simulation state. */
  evidence: string[];
  /** Concrete next moves, chosen by rule from the same state. */
  suggestions: string[];
  /** Real-world caveats. Labelled as context, not as modelled behaviour. */
  tradeoffs: string[];
  cost: { units: number; breakdown: { label: string; units: number }[] };
}

/** Relative educational cost units — a teaching scale, not money. */
const COST_UNITS: Record<string, number> = {
  client: 0,
  loadBalancer: 1,
  appServer: 3,
  cache: 2,
  database: 5,
  replica: 4,
};

const fmt = new Intl.NumberFormat('en-US');
const n = (v: number) => fmt.format(Math.round(v));
const pct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`;
const ms = (v: number) => `${Math.round(v)} ms`;

export function architectureCost(arch: Architecture): Evaluation['cost'] {
  const breakdown: { label: string; units: number }[] = [];
  let units = 0;
  const counts = new Map<string, number>();
  for (const node of arch.nodes) counts.set(node.kind, (counts.get(node.kind) ?? 0) + 1);
  for (const [kind, count] of counts) {
    const per = COST_UNITS[kind] ?? 0;
    if (per === 0) continue;
    units += per * count;
    breakdown.push({ label: `${count} × ${KINDS[kind as keyof typeof KINDS].name}`, units: per * count });
  }
  breakdown.sort((a, b) => b.units - a.units);
  return { units, breakdown };
}

export interface EvaluateInput {
  challenge: Challenge;
  architecture: Architecture;
  validation: ValidationResult;
  result: RunResult | null;
  /** The previous completed run, if any, for before/after statements. */
  previous?: { result: RunResult; architecture: Architecture } | null;
}

/**
 * Deterministic, evidence-based grading. No model in the loop: every sentence
 * below is produced by a rule reading numbers the simulation measured.
 */
export function evaluate({
  challenge,
  architecture,
  validation,
  result,
  previous,
}: EvaluateInput): Evaluation {
  const cost = architectureCost(architecture);

  if (!validation.runnable) {
    const errors = validation.issues.filter((i) => i.severity === 'error');
    return {
      verdict: 'invalid',
      headline:
        errors.length === 1
          ? 'This design cannot run yet — one thing to fix.'
          : `This design cannot run yet — ${errors.length} things to fix.`,
      criteria: [],
      evidence: errors.map((e) => e.message),
      suggestions: [
        'Fix the errors above, then press Run. Warnings are safe to ignore, but they usually point at something you did not intend.',
      ],
      tradeoffs: [],
      cost,
    };
  }

  if (!result) {
    return {
      verdict: 'missed',
      headline: 'Ready to run.',
      criteria: [],
      evidence: [],
      suggestions: ['Press Run to send the workload through this design.'],
      tradeoffs: [],
      cost,
    };
  }

  const m = result.metrics;
  const c = challenge.criteria;
  const criteria: CriterionResult[] = [
    {
      label: `At least ${pct(c.minSuccessRate, 0)} of requests answered`,
      met: m.successRate >= c.minSuccessRate,
      detail: `${pct(m.successRate, 2)} — ${n(m.completed)} of ${n(m.generated)} answered, ${n(m.failed)} rejected, ${n(m.timedOut)} timed out.`,
    },
    {
      label: `p95 latency under ${ms(c.maxP95LatencyMs)}`,
      met: m.latency.p95 <= c.maxP95LatencyMs,
      detail: `p95 is ${ms(m.latency.p95)} across answered requests (p50 ${ms(m.latency.p50)}, p99 ${ms(m.latency.p99)}). Counting failures at the moment they failed, p95 is ${ms(m.latency.p95IncludingFailures)}.`,
    },
  ];
  if (c.forbidDatabaseOverflow) {
    criteria.push({
      label: 'No database queue overflow',
      met: m.database.overflowed === 0,
      detail:
        m.database.overflowed === 0
          ? `Deepest storage queue reached ${n(m.database.peakQueueDepth)} waiting queries and never overflowed.`
          : `${n(m.database.overflowed)} queries were turned away by a full storage queue (deepest queue ${n(m.database.peakQueueDepth)}).`,
    });
  }

  const passed = criteria.every((x) => x.met);
  const evidence = buildEvidence(result, challenge, previous);
  const suggestions = passed
    ? buildPassSuggestions(result, cost)
    : buildFixSuggestions(result, criteria);

  return {
    verdict: passed ? 'passed' : 'missed',
    headline: passed
      ? `Challenge passed — ${pct(m.successRate, 2)} of ${n(m.generated)} requests answered, p95 ${ms(m.latency.p95)}.`
      : headlineForFailure(result, criteria),
    criteria,
    evidence,
    suggestions,
    tradeoffs: buildTradeoffs(architecture, result, cost),
    cost,
  };
}

/* ------------------------------------------------------------------ */

function storageNodes(result: RunResult): NodeSummary[] {
  return result.nodes.filter((x) => x.kind === 'database' || x.kind === 'replica');
}

function headlineForFailure(result: RunResult, criteria: CriterionResult[]): string {
  const m = result.metrics;
  const failedCriteria = criteria.filter((x) => !x.met).length;
  const worstRejector = [...result.nodes].sort((a, b) => b.rejected - a.rejected)[0];
  if (worstRejector && worstRejector.rejected > 0) {
    return `Not there yet — ${worstRejector.label} turned away ${n(worstRejector.rejected)} requests (${failedCriteria} criteria missed).`;
  }
  if (m.timedOut > 0) {
    return `Not there yet — ${n(m.timedOut)} requests waited too long and gave up (${failedCriteria} criteria missed).`;
  }
  return `Not there yet — the design held together but missed ${failedCriteria === 1 ? 'one target' : `${failedCriteria} targets`}.`;
}

function buildEvidence(
  result: RunResult,
  challenge: Challenge,
  previous?: { result: RunResult; architecture: Architecture } | null,
): string[] {
  const m = result.metrics;
  const out: string[] = [];

  out.push(
    `${n(m.generated)} requests arrived over ${(result.lastArrivalMs / 1000).toFixed(0)} simulated seconds. ${n(m.completed)} were answered, ${n(m.failed)} were rejected by a full queue, and ${n(m.timedOut)} gave up after ${(challenge.workload.requestTimeoutMs / 1000).toFixed(1)} s.`,
  );

  for (const node of [...result.nodes].sort((a, b) => b.rejected - a.rejected)) {
    if (node.rejected <= 0) continue;
    out.push(
      `${node.label}'s queue filled (capacity ${n(node.queueCapacity)}, peak ${n(node.peakQueue)}), so ${n(node.rejected)} requests were turned away there.`,
    );
  }

  const caches = result.nodes.filter((x) => x.kind === 'cache');
  if (caches.length === 0) {
    out.push('There is no cache in this design, so every read reached storage directly.');
  } else {
    for (const cache of caches) {
      const total = (cache.hits ?? 0) + (cache.misses ?? 0);
      if (total === 0) {
        out.push(`${cache.label} was never asked for anything — no application server reads through it.`);
        continue;
      }
      out.push(
        `${cache.label} served ${pct(cache.hitRate ?? 0)} of the reads it saw (${n(cache.hits ?? 0)} hits, ${n(cache.misses ?? 0)} misses), holding ${n(cache.entries ?? 0)} products at the end. Only the misses became storage queries.`,
      );
    }
  }

  const storage = storageNodes(result);
  const totalCapacity = storage.reduce((a, s) => a + (s.capacityPerSecond ?? 0), 0);
  if (storage.length === 1) {
    const s = storage[0];
    out.push(
      `${s.label} answered ${n(s.completed)} queries at ${pct(s.utilization, 0)} of its capacity (about ${n(s.capacityPerSecond ?? 0)} queries/second), with a mean queue of ${(s.meanQueueDepth).toFixed(1)} and a peak of ${n(s.peakQueue)}.`,
    );
  } else if (storage.length > 1) {
    out.push(
      `Reads were spread across ${storage.length} storage components with a combined ceiling of about ${n(totalCapacity)} queries/second; together they answered ${n(m.database.served)} queries at ${pct(m.database.utilization, 0)} utilisation.`,
    );
  }

  const apps = result.nodes.filter((x) => x.kind === 'appServer');
  if (apps.length > 0) {
    const busiest = [...apps].sort((a, b) => b.utilization - a.utilization)[0];
    out.push(
      `Application workers: ${apps.length === 1 ? busiest.label : `${apps.length} servers, busiest is ${busiest.label}`} at ${pct(busiest.utilization, 0)} of its ${n(busiest.concurrency)} workers, mean queue ${busiest.meanQueueDepth.toFixed(1)}, peak ${n(busiest.peakQueue)} of ${n(busiest.queueCapacity)}. A worker stays occupied while it waits for data, so this number reflects waiting as much as computing.`,
    );
  }

  const tps = m.throughputPerSecond;
  if (tps.length) {
    let best = 0;
    let bestSec = 0;
    tps.forEach((v, i) => {
      if (v > best) {
        best = v;
        bestSec = i;
      }
    });
    out.push(`Peak answered throughput was ${n(best)} requests in second ${bestSec + 1}.`);
  }

  if (result.routingFailures > 0) {
    out.push(
      `${n(result.routingFailures)} requests could not be routed at all — a component had nowhere to send them.`,
    );
  }

  if (previous) {
    out.push(...compareRuns(previous, result));
  }

  return out;
}

/** Before/after statements. Only fires on the specific patterns it can defend. */
function compareRuns(
  previous: { result: RunResult; architecture: Architecture },
  result: RunResult,
): string[] {
  const out: string[] = [];
  const before = previous.result.metrics;
  const after = result.metrics;
  if (before.generated !== after.generated) return out;

  const prevApps = previous.architecture.nodes.filter((x) => x.kind === 'appServer').length;
  const nowApps = result.nodes.filter((x) => x.kind === 'appServer').length;
  const gain = (after.completed - before.completed) / Math.max(1, before.completed);
  const storageCeiling = result.nodes
    .filter((x) => x.kind === 'database' || x.kind === 'replica')
    .reduce((a, x) => a + (x.capacityPerSecond ?? 0), 0);
  const storagePinned = after.database.utilization >= 0.8 || after.database.overflowed > 0;

  out.push(
    `Compared with your previous run: answered ${n(before.completed)} → ${n(after.completed)}, p95 ${ms(before.latency.p95)} → ${ms(after.latency.p95)}.`,
  );

  if (nowApps > prevApps && storagePinned) {
    const stalled =
      gain < 0.05
        ? `Adding application servers (${prevApps} → ${nowApps}) did not improve throughput`
        : `Adding application servers (${prevApps} → ${nowApps}) helped only up to a point`;
    out.push(
      `${stalled}: storage is saturated at ${pct(after.database.utilization, 0)} of its ceiling of about ${n(storageCeiling)} queries/second, and it turned away ${n(after.database.overflowed)} queries. More workers cannot raise throughput past that ceiling — they only queue at the same database faster.`,
    );
  }

  const prevCaches = previous.architecture.nodes.filter((x) => x.kind === 'cache').length;
  const nowCaches = result.nodes.filter((x) => x.kind === 'cache').length;
  if (nowCaches > prevCaches && after.cache) {
    const saved = after.cache.hits;
    out.push(
      `The cache you added kept ${n(saved)} reads away from storage: storage queries went ${n(before.database.served)} → ${n(after.database.served)}.`,
    );
  }
  return out;
}

function buildFixSuggestions(result: RunResult, criteria: CriterionResult[]): string[] {
  const m = result.metrics;
  const out: string[] = [];
  const storage = storageNodes(result);
  const caches = result.nodes.filter((x) => x.kind === 'cache');
  const apps = result.nodes.filter((x) => x.kind === 'appServer');
  const storageSaturated = m.database.utilization >= 0.85 || m.database.overflowed > 0;
  const appRejected = apps.reduce((a, x) => a + x.rejected, 0);
  const storageRejected = storage.reduce((a, x) => a + x.rejected, 0);

  if (storageRejected > 0) {
    out.push(
      `Storage rejected ${n(storageRejected)} queries because its queue was full. A deeper queue would only make those requests wait instead of fail — the fix is to send storage fewer queries, or give it more capacity.`,
    );
  }

  if (caches.length === 0 && storageSaturated) {
    out.push(
      `Storage ran at ${pct(m.database.utilization, 0)}. Because a few products account for most of the traffic, a cache between your application servers and the database can remove most reads before they ever become queries. Connect App server → Cache → Database.`,
    );
  }

  for (const cache of caches) {
    const rate = cache.hitRate ?? 0;
    const seen = (cache.hits ?? 0) + (cache.misses ?? 0);
    if (seen === 0) {
      out.push(`${cache.label} is not in the request path. Connect an application server to it, and connect it to the database.`);
    } else if (rate < 0.7 && storageSaturated) {
      out.push(
        `${cache.label} only answered ${pct(rate)} of reads. Raise "Entries held" so more of the popular catalog stays resident, and check that "Eviction" is set to least recently used — first-in-first-out throws away popular products too.`,
      );
    }
  }

  if (appRejected > 0 && !storageSaturated) {
    out.push(
      `Application servers turned requests away while storage still had headroom (${pct(m.database.utilization, 0)} used). Add another application server behind a load balancer, or raise "Workers" — the requests are queueing before they ever reach the data.`,
    );
  }

  if (appRejected > 0 && storageSaturated) {
    out.push(
      `Application workers filled up because each one sits blocked waiting for a slow database. Reducing the work storage has to do (a cache, or more read replicas) frees those workers without adding a single one.`,
    );
  }

  if (storageSaturated && storage.length === 1) {
    out.push(
      `You can also widen the read path itself: add read replicas alongside the database and connect your application servers to all of them, so reads are shared. Because this challenge is read-only, replicas serve exactly the same data.`,
    );
  }

  const latencyOnly = criteria.every((x) => x.label.startsWith('p95') || x.met);
  if (latencyOnly && !criteria.find((x) => x.label.startsWith('p95'))?.met) {
    const deepest = [...result.nodes].sort((a, b) => b.meanQueueDepth - a.meanQueueDepth)[0];
    out.push(
      `Almost everything was answered, so the problem is waiting, not capacity. The deepest average queue was at ${deepest.label} (${deepest.meanQueueDepth.toFixed(1)} waiting on average). Remove work from whatever sits behind that queue and p95 will drop with it.`,
    );
  }

  if (out.length === 0) {
    out.push(
      'Look at which component shows the highest utilisation or the deepest queue on the canvas, and reduce the work reaching it.',
    );
  }
  return out;
}

function buildPassSuggestions(result: RunResult, cost: Evaluation['cost']): string[] {
  const m = result.metrics;
  const out: string[] = [
    `Try trimming it back: this design costs ${cost.units} relative cost units. Can you still pass with one component fewer, or with a smaller cache?`,
  ];
  if (m.cache && m.cache.hitRate > 0) {
    out.push(
      `Set the cache's eviction to first-in-first-out and run again. The hit rate will fall even though the size is unchanged — which is the point: *what* you keep matters as much as how much.`,
    );
  }
  if (m.database.utilization < 0.4) {
    out.push(
      `Storage finished at only ${pct(m.database.utilization, 0)} utilisation, so you have headroom. Lower its "Concurrent queries" until the run stops passing to find where the real edge is.`,
    );
  }
  out.push(
    'Run it again with a cold start in mind: the first second of a spike is always the worst, because nothing is cached yet. Watch the first two seconds of the timeline.',
  );
  return out;
}

function buildTradeoffs(
  architecture: Architecture,
  result: RunResult,
  cost: Evaluation['cost'],
): string[] {
  const out: string[] = [];
  const hasCache = architecture.nodes.some((x) => x.kind === 'cache');
  const replicas = architecture.nodes.filter((x) => x.kind === 'replica').length;

  if (hasCache) {
    out.push(
      'Caching trades freshness for load. In a workload with writes, a cached copy can be served after the underlying record has changed, and you have to decide how long that is acceptable. This challenge is read-only, so nothing in this run went stale — the staleness cost is real, it is simply not one of the things being simulated here.',
    );
  }
  if (replicas > 0) {
    out.push(
      `Read replicas share read load and nothing else. Every write would still go to the single primary, so a write-heavy version of this problem would not be helped by the ${replicas} ${replicas === 1 ? 'replica' : 'replicas'} you added. Replication lag — a replica answering with slightly old data — is also real and is not modelled here.`,
    );
  }
  out.push(
    `Every block is infrastructure someone runs and pays for. This design is ${cost.units} relative cost units across ${architecture.nodes.filter((x) => x.kind !== 'client').length} components. These are teaching units for comparing designs, not prices.`,
  );

  const deepQueues = result.nodes.filter((x) => x.queueCapacity >= 1000 && x.peakQueue > 100);
  if (deepQueues.length > 0) {
    out.push(
      `A deep queue converts rejections into waiting: ${deepQueues[0].label} held up to ${n(deepQueues[0].peakQueue)} requests. That protects the success rate and punishes latency. It never adds throughput.`,
    );
  }
  return out;
}
