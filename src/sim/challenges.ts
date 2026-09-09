import { defaultConfig } from './catalog';
import type { ArchNode, Architecture, Challenge, NodeKind } from './types';

/** Build a node with the kind's defaults, overriding only what a preset needs. */
export function node(
  id: string,
  kind: NodeKind,
  label: string,
  x: number,
  y: number,
  config: Record<string, number | string> = {},
): ArchNode {
  return { id, kind, label, position: { x, y }, config: { ...defaultConfig(kind), ...config } };
}

export function edge(source: string, target: string) {
  return { id: `${source}__${target}`, source, target };
}

/* ------------------------------------------------------------------ */
/* Challenge 1: Survive the traffic spike                              */
/* ------------------------------------------------------------------ */

/**
 * Arrival plan: 10,000 requests over 10 simulated seconds, front-loaded into a
 * spike. Within each second the arrivals are evenly spaced, so the stream is
 * fully reproducible and the shape is legible in the challenge panel.
 */
const REQUESTS_PER_SECOND = [300, 500, 1600, 1800, 1500, 1200, 900, 800, 700, 700];

const STARTING: Architecture = {
  nodes: [
    node('client', 'client', 'Shoppers', 20, 200),
    node('app-1', 'appServer', 'App server 1', 470, 200),
    node('db', 'database', 'Catalog database', 930, 200),
  ],
  edges: [edge('client', 'app-1'), edge('app-1', 'db')],
};

const EXAMPLE: Architecture = {
  nodes: [
    node('client', 'client', 'Shoppers', 20, 220),
    node('lb', 'loadBalancer', 'Load balancer', 250, 220),
    node('app-1', 'appServer', 'App server 1', 470, 110),
    node('app-2', 'appServer', 'App server 2', 470, 330),
    node('cache', 'cache', 'Product cache', 720, 220),
    node('db', 'database', 'Catalog database', 960, 220),
  ],
  edges: [
    edge('client', 'lb'),
    edge('lb', 'app-1'),
    edge('lb', 'app-2'),
    edge('app-1', 'cache'),
    edge('app-2', 'cache'),
    edge('cache', 'db'),
  ],
};

export const SURVIVE_THE_SPIKE: Challenge = {
  id: 'survive-the-spike',
  title: 'Survive the traffic spike',
  tagline: 'A catalog page goes viral. Serve the reads without melting the database.',
  briefing: [
    'Your product catalog is about to take 10,000 read requests in 10 simulated seconds — and they are not spread evenly. A promotion lands in second three and traffic jumps to roughly 1,800 requests per second before easing off.',
    'Every request asks for one product by ID and must come back with that product’s data. Requests are not all equal: a handful of products are asked for constantly while most of the catalog is barely touched.',
    'The database is the scarce resource. It answers 8 queries at a time, 25 ms each — about 320 queries per second, no matter how much traffic you point at it. Your job is to get correct data back to shoppers while keeping the number of queries that actually reach the database inside what it can serve.',
  ],
  scenarioRules: [
    'The catalog is read-only for this challenge: nothing writes, so no cached answer can ever be stale here.',
    'Read replicas start already synchronised with the primary and serve the same catalog data.',
    'A request that has not been answered within 2 seconds is abandoned and counted as a timeout.',
    'Caches do not coalesce duplicate misses: two simultaneous misses for the same product make two database queries. This is why a cold cache hurts most at the start of a spike.',
    'Requests arrive on a fixed schedule from a fixed seed, so the same design always produces the same result.',
  ],
  workload: {
    requestsPerSecond: REQUESTS_PER_SECOND,
    catalogSize: 1000,
    zipfExponent: 1.1,
    seed: 20260908,
    requestTimeoutMs: 2000,
  },
  criteria: {
    minSuccessRate: 0.99,
    maxP95LatencyMs: 500,
    forbidDatabaseOverflow: true,
  },
  maxDrainMs: 8000,
  availableKinds: ['client', 'loadBalancer', 'appServer', 'cache', 'database', 'replica'],
  startingArchitecture: STARTING,
  exampleSolution: {
    name: 'Cache in front, two app servers behind a balancer',
    explanation:
      'A 250-entry cache absorbs the popular products, so only the long tail reaches the database — enough of a reduction to stay under its 320 queries per second. The load balancer and second application server are there so that application workers are never the limit while the cache is warming up.',
    architecture: EXAMPLE,
  },
};

export const CHALLENGES: Challenge[] = [SURVIVE_THE_SPIKE];

export function getChallenge(id: string): Challenge {
  return CHALLENGES.find((c) => c.id === id) ?? SURVIVE_THE_SPIKE;
}

export function totalRequests(challenge: Challenge): number {
  return challenge.workload.requestsPerSecond.reduce((a, b) => a + b, 0);
}
