/**
 * Core data model for Conceptually.
 *
 * Everything in `src/sim` is plain TypeScript with no React or DOM dependency so
 * the engine can be unit-tested and run headless (see `tests/`).
 */

export type NodeKind =
  | 'client'
  | 'loadBalancer'
  | 'appServer'
  | 'cache'
  | 'database'
  | 'replica';

/** A connection role is derived from the (source kind, target kind) pair. */
export type EdgeRole =
  | 'client-to-entry' // client -> load balancer | app server
  | 'balance' // load balancer -> app server
  | 'read-backend' // app server -> cache | database | replica
  | 'cache-fill'; // cache -> database | replica

export interface ArchNode {
  id: string;
  kind: NodeKind;
  label: string;
  /** Canvas position, kept in the design document so layouts round-trip. */
  position: { x: number; y: number };
  /** Kind-specific tunables. Missing keys fall back to the kind's defaults. */
  config: Record<string, number | string | boolean>;
}

export interface ArchEdge {
  id: string;
  source: string;
  target: string;
}

export interface Architecture {
  nodes: ArchNode[];
  edges: ArchEdge[];
}

export interface DesignDocument {
  formatVersion: 1;
  challengeId: string;
  name: string;
  savedAt: string;
  architecture: Architecture;
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export type IssueSeverity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
  /** Nodes/edges the message refers to, so the canvas can highlight them. */
  nodeIds?: string[];
  edgeIds?: string[];
}

export interface ValidationResult {
  issues: ValidationIssue[];
  /** True when there are no `error` issues — the design is runnable. */
  runnable: boolean;
}

/* ------------------------------------------------------------------ */
/* Workload + challenge definition                                     */
/* ------------------------------------------------------------------ */

export interface WorkloadSpec {
  /** Requests generated in each simulated second, index = second. */
  requestsPerSecond: number[];
  /** Number of distinct product IDs in the catalog. */
  catalogSize: number;
  /** Zipf exponent for the requested-ID distribution (higher = more skewed). */
  zipfExponent: number;
  /** Seed for the ID sampler. Same seed => same request stream, always. */
  seed: number;
  /** A request older than this is abandoned and counted as a timeout. */
  requestTimeoutMs: number;
}

export interface SuccessCriteria {
  minSuccessRate: number; // 0..1
  maxP95LatencyMs: number;
  /** When true, any queue overflow at a database or replica fails the run. */
  forbidDatabaseOverflow: boolean;
}

export interface Challenge {
  id: string;
  title: string;
  tagline: string;
  /** Short paragraphs shown in the challenge panel. */
  briefing: string[];
  /** Ground rules that are true for this challenge only. */
  scenarioRules: string[];
  workload: WorkloadSpec;
  criteria: SuccessCriteria;
  /** Simulated ms of drain allowed after the last arrival before we stop. */
  maxDrainMs: number;
  /** Palette entries available for this challenge. */
  availableKinds: NodeKind[];
  startingArchitecture: Architecture;
  exampleSolution: { name: string; explanation: string; architecture: Architecture };
}

/* ------------------------------------------------------------------ */
/* Simulation output                                                   */
/* ------------------------------------------------------------------ */

export interface NodeRuntimeState {
  id: string;
  kind: NodeKind;
  /** Requests currently being serviced. */
  busy: number;
  /** Max concurrent services. */
  concurrency: number;
  /** Requests waiting in this node's queue. */
  queueDepth: number;
  queueCapacity: number;
  /** Fraction of service capacity used, averaged over the whole run so far. */
  utilization: number;
  /** Rolling arrival rate (requests/simulated second) over the last window. */
  arrivalRate: number;
  arrived: number;
  completed: number;
  rejected: number;
  /** Cache-only counters. */
  cacheHits?: number;
  cacheMisses?: number;
  cacheEntries?: number;
}

export interface EdgeRuntimeState {
  id: string;
  /** Total requests that traversed this edge. */
  traversals: number;
  /** Rolling requests/simulated second over the last window. */
  rate: number;
}

export interface RunMetrics {
  simTimeMs: number;
  generated: number;
  completed: number;
  failed: number; // rejected by a full queue
  timedOut: number;
  inFlight: number;
  successRate: number;
  latency: {
    mean: number;
    p50: number;
    p95: number;
    p99: number;
    max: number;
    /** p95 over every finished request, counting a failure at the moment it failed. */
    p95IncludingFailures: number;
  };
  cache: { hits: number; misses: number; hitRate: number; entries: number } | null;
  database: {
    /** Reads served by databases + replicas. */
    served: number;
    /** Peak queue depth seen at any database/replica. */
    peakQueueDepth: number;
    overflowed: number;
    /** Time-weighted mean utilization across databases + replicas. */
    utilization: number;
  };
  throughputPerSecond: number[];
}

export interface Frame {
  metrics: RunMetrics;
  nodes: NodeRuntimeState[];
  edges: EdgeRuntimeState[];
  bottlenecks: string[];
  finished: boolean;
}
