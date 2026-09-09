import { describe, expect, it } from 'vitest';
import { Simulation, runArchitecture } from '../src/sim/engine';
import { SURVIVE_THE_SPIKE, edge, node, totalRequests } from '../src/sim/challenges';
import type { Architecture, Challenge } from '../src/sim/types';
import { BASELINE, CACHED, REPLICATED, arch } from './fixtures';

const CH = SURVIVE_THE_SPIKE;

/** A short challenge for tests that need to reason about exact counts. */
function tinyChallenge(overrides: Partial<Challenge> = {}): Challenge {
  return {
    ...CH,
    id: 'tiny',
    workload: {
      requestsPerSecond: [100, 100],
      catalogSize: 20,
      zipfExponent: 1.1,
      seed: 7,
      requestTimeoutMs: 5000,
      ...(overrides.workload ?? {}),
    },
    maxDrainMs: 10000,
    ...overrides,
  };
}

describe('determinism', () => {
  it('produces identical results for identical inputs', () => {
    const a = runArchitecture(CACHED, CH);
    const b = runArchitecture(CACHED, CH);
    expect(b.metrics).toEqual(a.metrics);
    expect(b.nodes).toEqual(a.nodes);
    expect(b.edges).toEqual(a.edges);
  });

  it('gives every architecture the same request stream', () => {
    const a = runArchitecture(BASELINE, CH);
    const b = runArchitecture(CACHED, CH);
    expect(a.metrics.generated).toBe(totalRequests(CH));
    expect(b.metrics.generated).toBe(totalRequests(CH));
  });

  it('is unaffected by the order connections were drawn in', () => {
    const forward: Architecture = arch(
      ['client', 'loadBalancer', 'appServer', 'appServer', 'database'],
      [
        [0, 1],
        [1, 2],
        [1, 3],
        [2, 4],
        [3, 4],
      ],
    );
    const shuffled: Architecture = {
      nodes: [...forward.nodes].reverse(),
      edges: [forward.edges[3], forward.edges[0], forward.edges[4], forward.edges[2], forward.edges[1]],
    };
    const a = runArchitecture(forward, CH);
    const b = runArchitecture(shuffled, CH);
    expect(b.metrics.completed).toBe(a.metrics.completed);
    expect(b.metrics.latency.p95).toBe(a.metrics.latency.p95);
  });
});

describe('request accounting', () => {
  it('resolves every generated request exactly once', () => {
    for (const design of [BASELINE, CACHED, REPLICATED]) {
      const { metrics } = runArchitecture(design, CH);
      expect(metrics.generated).toBe(totalRequests(CH));
      expect(metrics.completed + metrics.failed + metrics.timedOut).toBe(metrics.generated);
      expect(metrics.inFlight).toBe(0);
    }
  });

  it('reports latency percentiles in order, and never above the timeout', () => {
    const { metrics } = runArchitecture(BASELINE, CH);
    const l = metrics.latency;
    expect(l.p50).toBeLessThanOrEqual(l.p95);
    expect(l.p95).toBeLessThanOrEqual(l.p99);
    expect(l.p99).toBeLessThanOrEqual(l.max);
    expect(l.max).toBeLessThanOrEqual(CH.workload.requestTimeoutMs);
  });

  it('keeps failures visible in their own counters', () => {
    const { metrics } = runArchitecture(BASELINE, CH);
    expect(metrics.failed + metrics.timedOut).toBeGreaterThan(0);
    // A design that loses most of its traffic must not be able to report a
    // flattering p95 without that loss showing up somewhere.
    expect(metrics.successRate).toBeLessThan(0.5);
    expect(metrics.latency.p95IncludingFailures).toBeGreaterThanOrEqual(metrics.latency.p95);
  });

  it('leaves nothing unresolved when the drain window closes', () => {
    // A drain window far too short for the work in flight.
    const impatient: Challenge = { ...tinyChallenge(), maxDrainMs: 0 };
    const slow = arch(['client', 'appServer', ['database', { concurrency: 1, serviceTimeMs: 200 }]], [
      [0, 1],
      [1, 2],
    ]);
    const { metrics } = runArchitecture(slow, impatient);
    expect(metrics.generated).toBe(200);
    expect(metrics.completed + metrics.failed + metrics.timedOut).toBe(200);
    expect(metrics.timedOut).toBeGreaterThan(0);
  });
});

describe('queues and overflow', () => {
  it('rejects at a full queue and counts the rejections on that component', () => {
    const design = arch(
      [
        'client',
        ['appServer', { concurrency: 200, queueCapacity: 2000 }],
        ['database', { concurrency: 1, serviceTimeMs: 50, queueCapacity: 5 }],
      ],
      [
        [0, 1],
        [1, 2],
      ],
    );
    const result = runArchitecture(design, tinyChallenge());
    const db = result.nodes.find((n) => n.kind === 'database')!;
    expect(db.rejected).toBeGreaterThan(0);
    expect(db.peakQueue).toBe(5);
    expect(result.metrics.database.overflowed).toBe(db.rejected);
    expect(result.metrics.database.peakQueueDepth).toBe(5);
  });

  it('never exceeds the configured concurrency or queue capacity', () => {
    const design = arch(
      ['client', ['appServer', { concurrency: 4, queueCapacity: 20 }], ['database', { concurrency: 2, queueCapacity: 10 }]],
      [
        [0, 1],
        [1, 2],
      ],
    );
    const sim = new Simulation(design, tinyChallenge());
    for (let t = 0; t <= 12000; t += 37) {
      sim.advanceTo(t);
      for (const n of sim.frame().nodes) {
        if (n.kind === 'client') continue;
        expect(n.busy).toBeLessThanOrEqual(n.concurrency);
        expect(n.queueDepth).toBeLessThanOrEqual(n.queueCapacity);
      }
    }
  });

  it('turns rejections into waiting when the queue is deepened', () => {
    const build = (queueCapacity: number) =>
      arch(
        ['client', ['appServer', { concurrency: 200, queueCapacity: 5000 }], ['database', { concurrency: 2, serviceTimeMs: 40, queueCapacity }]],
        [
          [0, 1],
          [1, 2],
        ],
      );
    const shallow = runArchitecture(build(2), tinyChallenge());
    const deep = runArchitecture(build(400), tinyChallenge());
    expect(deep.metrics.failed).toBeLessThan(shallow.metrics.failed);
    expect(deep.metrics.latency.p95).toBeGreaterThan(shallow.metrics.latency.p95);
  });
});

describe('cache behaviour', () => {
  it('starts cold: the first request for a product is always a miss', () => {
    const single: Challenge = {
      ...tinyChallenge(),
      workload: { ...tinyChallenge().workload, requestsPerSecond: [1], catalogSize: 1 },
    };
    const result = runArchitecture(CACHED, single);
    const cache = result.nodes.find((n) => n.kind === 'cache')!;
    expect(cache.hits).toBe(0);
    expect(cache.misses).toBe(1);
    expect(result.metrics.database.served).toBe(1);
  });

  it('serves repeats from memory, so storage sees only distinct products', () => {
    const repeats: Challenge = {
      ...tinyChallenge(),
      workload: { ...tinyChallenge().workload, requestsPerSecond: [50], catalogSize: 1, requestTimeoutMs: 20000 },
    };
    // One product, arrivals 20 ms apart: the first fills the cache and the rest hit.
    const result = runArchitecture(CACHED, repeats);
    const cache = result.nodes.find((n) => n.kind === 'cache')!;
    expect(cache.hits! + cache.misses!).toBe(50);
    expect(cache.misses).toBeGreaterThanOrEqual(1);
    expect(cache.hits).toBeGreaterThan(40);
    expect(result.metrics.database.served).toBe(cache.misses);
  });

  it('holds no more than its configured capacity, and evicts to stay there', () => {
    const design = arch(['client', 'appServer', ['cache', { capacityEntries: 10 }], 'database'], [
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
    const result = runArchitecture(design, tinyChallenge());
    const cache = result.nodes.find((n) => n.kind === 'cache')!;
    expect(cache.entries).toBeLessThanOrEqual(10);
    expect(cache.misses).toBeGreaterThan(0);
  });

  it('keeps popular products better with LRU than with FIFO', () => {
    const build = (eviction: string) =>
      arch(['client', 'appServer', ['cache', { capacityEntries: 40, eviction }], 'database'], [
        [0, 1],
        [1, 2],
        [2, 3],
      ]);
    const lru = runArchitecture(build('lru'), CH);
    const fifo = runArchitecture(build('fifo'), CH);
    expect(lru.metrics.cache!.hitRate).toBeGreaterThan(fifo.metrics.cache!.hitRate);
  });

  it('reduces the queries storage has to answer', () => {
    const withCache = runArchitecture(CACHED, CH);
    const without = runArchitecture(BASELINE, CH);
    expect(withCache.metrics.database.served).toBeLessThan(without.metrics.generated);
    expect(withCache.metrics.cache!.hits).toBeGreaterThan(0);
  });
});

describe('load balancing', () => {
  it('round robin splits traffic evenly across application servers', () => {
    const design = arch(
      ['client', 'loadBalancer', 'appServer', 'appServer', 'appServer', ['database', { concurrency: 64 }]],
      [
        [0, 1],
        [1, 2],
        [1, 3],
        [1, 4],
        [2, 5],
        [3, 5],
        [4, 5],
      ],
    );
    const result = runArchitecture(design, tinyChallenge());
    const apps = result.nodes.filter((n) => n.kind === 'appServer');
    expect(apps).toHaveLength(3);
    const arrivals = apps.map((a) => a.arrived);
    expect(Math.max(...arrivals) - Math.min(...arrivals)).toBeLessThanOrEqual(1);
    expect(arrivals.reduce((a, b) => a + b, 0)).toBe(200);
  });

  it('least-busy sends less traffic to a slower application server', () => {
    const design: Architecture = {
      nodes: [
        node('client', 'client', 'Client', 0, 0),
        node('lb', 'loadBalancer', 'LB', 0, 0, { algorithm: 'leastBusy' }),
        node('fast', 'appServer', 'Fast', 0, 0, { concurrency: 8, processingMs: 2 }),
        node('slow', 'appServer', 'Slow', 0, 0, { concurrency: 8, processingMs: 60 }),
        node('db', 'database', 'DB', 0, 0, { concurrency: 64 }),
      ],
      edges: [
        edge('client', 'lb'),
        edge('lb', 'fast'),
        edge('lb', 'slow'),
        edge('fast', 'db'),
        edge('slow', 'db'),
      ],
    };
    const result = runArchitecture(design, tinyChallenge());
    const fast = result.nodes.find((n) => n.id === 'fast')!;
    const slow = result.nodes.find((n) => n.id === 'slow')!;
    expect(fast.arrived).toBeGreaterThan(slow.arrived);
  });

  it('spreads reads across every connected storage backend', () => {
    const result = runArchitecture(REPLICATED, CH);
    const storage = result.nodes.filter((n) => n.kind === 'database' || n.kind === 'replica');
    expect(storage).toHaveLength(5);
    const served = storage.map((s) => s.completed);
    expect(Math.min(...served)).toBeGreaterThan(0);
    // Round robin across five backends: no backend should carry a fifth more
    // than another.
    expect(Math.max(...served) / Math.min(...served)).toBeLessThan(1.2);
  });
});

describe('playback speed independence', () => {
  const CHUNKS = [7, 33, 250, 1000, 5000];

  it('reaches the same result whatever step size time advances in', () => {
    const reference = runArchitecture(CACHED, CH);
    for (const chunk of CHUNKS) {
      const sim = new Simulation(CACHED, CH);
      let t = 0;
      while (!sim.finished) {
        t += chunk;
        sim.advanceTo(t);
        if (t > 1_000_000) throw new Error('simulation did not finish');
      }
      const result = sim.result();
      expect(result.metrics.completed).toBe(reference.metrics.completed);
      expect(result.metrics.failed).toBe(reference.metrics.failed);
      expect(result.metrics.timedOut).toBe(reference.metrics.timedOut);
      expect(result.metrics.latency.p50).toBe(reference.metrics.latency.p50);
      expect(result.metrics.latency.p95).toBe(reference.metrics.latency.p95);
      expect(result.metrics.latency.p99).toBe(reference.metrics.latency.p99);
      expect(result.metrics.cache!.hits).toBe(reference.metrics.cache!.hits);
      expect(result.metrics.database.served).toBe(reference.metrics.database.served);
      expect(result.metrics.database.peakQueueDepth).toBe(reference.metrics.database.peakQueueDepth);
      expect(result.nodes).toEqual(reference.nodes);
    }
  });

  it('is unaffected by irregular, jittery advances', () => {
    const reference = runArchitecture(BASELINE, CH);
    const sim = new Simulation(BASELINE, CH);
    let t = 0;
    let i = 0;
    while (!sim.finished) {
      t += [3, 17, 90, 400, 1, 2500][i++ % 6];
      sim.advanceTo(t);
      sim.frame(); // the UI reads a frame every animation tick; must not mutate
      if (t > 1_000_000) throw new Error('simulation did not finish');
    }
    expect(sim.result().metrics).toEqual(reference.metrics);
  });
});
