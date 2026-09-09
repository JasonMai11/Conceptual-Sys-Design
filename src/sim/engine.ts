import { Buckets } from './buckets';
import { KINDS, num, str } from './catalog';
import { MinHeap } from './heap';
import { createZipfSampler } from './rng';
import { compile, type RoutePlan } from './routing';
import type {
  Architecture,
  Challenge,
  EdgeRuntimeState,
  Frame,
  NodeKind,
  NodeRuntimeState,
  RunMetrics,
} from './types';

const RATE_BUCKET_MS = 250;
const LIVE_WINDOW_MS = 1000;

/* ------------------------------------------------------------------ */

type EventKind = 'arrive' | 'enter' | 'localDone' | 'return' | 'deadline';

interface SimEvent {
  time: number;
  seq: number;
  kind: EventKind;
  req: Req;
  node?: NodeState;
}

interface Req {
  id: number;
  product: number;
  t0: number;
  deadline: number;
  /** Components currently holding this request open, outermost first. */
  stack: NodeState[];
  /** The node whose queue it is waiting in, if any. */
  queuedAt: NodeState | null;
  /** The node actively doing work for it right now (as opposed to waiting). */
  working: NodeState | null;
  done: boolean;
  dead: boolean;
}

interface NodeState {
  id: string;
  kind: NodeKind;
  label: string;
  concurrency: number;
  queueCapacity: number;
  networkMs: number;
  /** Local work before delegating (or before answering, for storage). */
  serviceMs: number;
  algorithm: string;
  backendPolicy: string;

  busy: number;
  queue: Req[];
  lastTs: number;

  arrived: number;
  completed: number;
  rejected: number;
  peakQueue: number;

  busyIntegral: Buckets;
  queueIntegral: Buckets;
  arrivals: Buckets;

  rr: number;
  targets: string[];

  // cache only
  entries: Map<number, true> | null;
  cacheCapacity: number;
  eviction: string;
  hits: number;
  misses: number;
}

export interface NodeSummary {
  id: string;
  label: string;
  kind: NodeKind;
  arrived: number;
  completed: number;
  rejected: number;
  peakQueue: number;
  queueCapacity: number;
  concurrency: number;
  /** Time-averaged over the whole run, 0..1. */
  utilization: number;
  meanQueueDepth: number;
  hits?: number;
  misses?: number;
  hitRate?: number;
  entries?: number;
  /** Theoretical ceiling in requests/second, where meaningful. */
  capacityPerSecond?: number;
}

export interface RunResult {
  metrics: RunMetrics;
  nodes: NodeSummary[];
  edges: { id: string; source: string; target: string; traversals: number }[];
  finished: boolean;
  /** Requests that could not be routed because of a graph gap. */
  routingFailures: number;
  horizonMs: number;
  lastArrivalMs: number;
  workloadPerSecond: number[];
}

/* ------------------------------------------------------------------ */

/**
 * Deterministic discrete-event simulation of one architecture under one
 * workload.
 *
 * Time is simulated milliseconds held in `this.now`; nothing here reads a clock.
 * The UI advances the model with `advanceTo(ms)` and may do so in chunks of any
 * size — the event ordering, and therefore every metric, is identical either
 * way.
 *
 * Call semantics: a component holds one unit of its own concurrency for the
 * *whole* time a request is in its care, including while a downstream component
 * works. So a slow database occupies application workers, exactly as a blocking
 * call would.
 */
export class Simulation {
  readonly challenge: Challenge;
  readonly plan: RoutePlan;
  readonly horizonMs: number;
  readonly lastArrivalMs: number;

  private nodes = new Map<string, NodeState>();
  private events = new MinHeap<SimEvent>();
  private seq = 0;
  private requests: Req[] = [];
  private edgeTraversals = new Map<string, number>();
  private edgeRates = new Map<string, Buckets>();

  private now = 0;
  private _finished = false;

  private generated = 0;
  private completedCount = 0;
  private failedCount = 0;
  private timedOutCount = 0;
  private routingFailures = 0;

  private latencies: number[] = [];
  /** Latency of every request that finished, successfully or not. */
  private finishedLatencies: number[] = [];
  private completions: Buckets;

  constructor(architecture: Architecture, challenge: Challenge) {
    this.challenge = challenge;
    this.plan = compile(architecture);

    const w = challenge.workload;
    const arrivalWindowMs = w.requestsPerSecond.length * 1000;
    this.horizonMs = arrivalWindowMs + challenge.maxDrainMs;

    for (const node of architecture.nodes) this.nodes.set(node.id, this.makeNode(node));
    for (const e of this.plan.edges) {
      this.edgeTraversals.set(e.id, 0);
      this.edgeRates.set(e.id, new Buckets(this.horizonMs, RATE_BUCKET_MS));
    }
    this.completions = new Buckets(this.horizonMs, RATE_BUCKET_MS);

    // Resolve routing targets once. Sorted-edge order in `compile` makes the
    // round-robin sequence a property of the design, not of the drawing order.
    for (const node of this.nodes.values()) {
      if (node.kind === 'client') node.targets = this.plan.entryTargets.get(node.id) ?? [];
      else if (node.kind === 'loadBalancer') node.targets = this.plan.balanceTargets.get(node.id) ?? [];
      else if (node.kind === 'appServer') node.targets = this.plan.readBackends.get(node.id) ?? [];
      else if (node.kind === 'cache') node.targets = this.plan.fillTargets.get(node.id) ?? [];
    }

    this.lastArrivalMs = this.generateWorkload();
  }

  /* ---------------- setup ---------------- */

  private makeNode(node: { id: string; kind: NodeKind; label: string; config: Record<string, unknown> }): NodeState {
    const k = node.kind;
    const cfg = node.config ?? {};
    const serviceMs =
      k === 'cache'
        ? num(cfg, k, 'hitLatencyMs')
        : k === 'database' || k === 'replica'
          ? num(cfg, k, 'serviceTimeMs')
          : k === 'client'
            ? 0
            : num(cfg, k, 'processingMs');

    return {
      id: node.id,
      kind: k,
      label: node.label,
      concurrency: k === 'client' ? Number.MAX_SAFE_INTEGER : Math.max(1, Math.round(num(cfg, k, 'concurrency'))),
      queueCapacity: k === 'client' ? 0 : Math.max(0, Math.round(num(cfg, k, 'queueCapacity'))),
      networkMs: k === 'client' ? 0 : num(cfg, k, 'networkMs'),
      serviceMs,
      algorithm: k === 'loadBalancer' ? str(cfg, k, 'algorithm') : '',
      backendPolicy: k === 'appServer' ? str(cfg, k, 'backendPolicy') : '',
      busy: 0,
      queue: [],
      lastTs: 0,
      arrived: 0,
      completed: 0,
      rejected: 0,
      peakQueue: 0,
      busyIntegral: new Buckets(this.horizonMs, RATE_BUCKET_MS),
      queueIntegral: new Buckets(this.horizonMs, RATE_BUCKET_MS),
      arrivals: new Buckets(this.horizonMs, RATE_BUCKET_MS),
      rr: 0,
      targets: [],
      entries: k === 'cache' ? new Map() : null,
      cacheCapacity: k === 'cache' ? Math.max(1, Math.round(num(cfg, k, 'capacityEntries'))) : 0,
      eviction: k === 'cache' ? str(cfg, k, 'eviction') : '',
      hits: 0,
      misses: 0,
    };
  }

  /**
   * Every request for the whole run is created up front from the challenge
   * workload, so the request stream is a property of the challenge and the seed
   * alone — two different architectures face exactly the same traffic.
   */
  private generateWorkload(): number {
    const w = this.challenge.workload;
    const sampler = createZipfSampler(w.catalogSize, w.zipfExponent, w.seed);
    let id = 0;
    let last = 0;
    for (let second = 0; second < w.requestsPerSecond.length; second++) {
      const rate = w.requestsPerSecond[second];
      if (rate <= 0) continue;
      const gap = 1000 / rate;
      for (let i = 0; i < rate; i++) {
        const t = second * 1000 + (i + 0.5) * gap;
        const req: Req = {
          id: id++,
          product: sampler.sample(),
          t0: t,
          deadline: t + w.requestTimeoutMs,
          stack: [],
          queuedAt: null,
          working: null,
          done: false,
          dead: false,
        };
        this.requests.push(req);
        this.push({ time: t, seq: 0, kind: 'arrive', req });
        this.push({ time: req.deadline, seq: 0, kind: 'deadline', req });
        last = Math.max(last, t);
      }
    }
    return last;
  }

  private push(e: Omit<SimEvent, 'seq'> & { seq?: number }): void {
    this.events.push({ ...e, seq: this.seq++ } as SimEvent);
  }

  /* ---------------- clock ---------------- */

  get currentTimeMs(): number {
    return this.now;
  }

  get finished(): boolean {
    return this._finished;
  }

  get totalRequests(): number {
    return this.requests.length;
  }

  /** Process every event at or before `targetMs`. Safe to call repeatedly. */
  advanceTo(targetMs: number): void {
    if (this._finished) return;
    const limit = Math.min(targetMs, this.horizonMs);
    for (;;) {
      const next = this.events.peek();
      if (!next || next.time > limit) break;
      const ev = this.events.pop()!;
      this.now = ev.time;
      this.handle(ev);
    }
    // Only let the clock run past the last event while events are still
    // pending. Otherwise a quiet drain window would dilute every time-averaged
    // metric with idle time that never actually happened.
    if (this.events.peek()) this.now = Math.max(this.now, limit);
    if (!this.events.peek() || this.now >= this.horizonMs) this.finish();
  }

  /** Run to the end of the drain window. Used by tests and the "skip" control. */
  runToEnd(): RunResult {
    this.advanceTo(this.horizonMs);
    return this.result();
  }

  private finish(): void {
    if (this._finished) return;
    this._finished = true;
    this.now = Math.min(this.now, this.horizonMs);
    // Anything still in flight when the drain window closes is a timeout, so
    // that generated === completed + failed + timedOut always holds.
    for (const req of this.requests) {
      if (req.done) continue;
      // The window has closed; nothing more will be processed, so release
      // everything including in-progress work.
      req.working = null;
      this.abandon(req, this.now, true);
    }
    for (const node of this.nodes.values()) this.integrate(node, this.now);
  }

  /* ---------------- event handling ---------------- */

  private handle(ev: SimEvent): void {
    switch (ev.kind) {
      case 'arrive':
        return this.onArrive(ev.req);
      case 'enter':
        return this.onEnter(ev.node!, ev.req);
      case 'localDone':
        return this.onLocalDone(ev.node!, ev.req);
      case 'return':
        return this.onReturn(ev.node!, ev.req);
      case 'deadline':
        return this.onDeadline(ev.req);
    }
  }

  private onArrive(req: Req): void {
    this.generated++;
    const client = this.nodes.get(this.plan.clientIds[0] ?? '');
    if (!client || client.targets.length === 0) {
      this.routingFailures++;
      this.fail(req, this.now);
      return;
    }
    client.arrived++;
    client.arrivals.point(this.now);
    const targetId = client.targets[client.rr++ % client.targets.length];
    this.dispatch(client, targetId, req);
  }

  /** Send `req` from `from` to `to`, paying the inbound network hop. */
  private dispatch(from: NodeState, toId: string, req: Req): void {
    const to = this.nodes.get(toId);
    if (!to) {
      this.routingFailures++;
      this.fail(req, this.now);
      return;
    }
    const edgeId = this.plan.edgeIndex.get(`${from.id}>${to.id}`);
    if (edgeId) {
      this.edgeTraversals.set(edgeId, (this.edgeTraversals.get(edgeId) ?? 0) + 1);
      this.edgeRates.get(edgeId)?.point(this.now);
    }
    this.push({ time: this.now + to.networkMs, kind: 'enter', req, node: to });
  }

  private onEnter(node: NodeState, req: Req): void {
    if (req.done || req.dead) return;
    this.integrate(node, this.now);
    node.arrived++;
    node.arrivals.point(this.now);

    if (node.busy < node.concurrency) {
      this.startService(node, req);
      return;
    }
    if (node.queue.length < node.queueCapacity) {
      node.queue.push(req);
      req.queuedAt = node;
      if (node.queue.length > node.peakQueue) node.peakQueue = node.queue.length;
      return;
    }
    // Queue full: the request is rejected here and the rejection propagates
    // straight back up, freeing every caller that was waiting on it.
    node.rejected++;
    this.fail(req, this.now);
  }

  private startService(node: NodeState, req: Req): void {
    this.integrate(node, this.now);
    node.busy++;
    req.stack.push(node);
    req.queuedAt = null;
    req.working = node;
    this.push({ time: this.now + node.serviceMs, kind: 'localDone', req, node });
  }

  private onLocalDone(node: NodeState, req: Req): void {
    if (req.working === node) req.working = null;
    // A request that gave up while this component was mid-work does not undo
    // that work: the component finishes, releases its slot, and drops the
    // answer on the floor. Only *waiting* callers are freed early (see unwind).
    if (req.done || req.dead) {
      this.release(node);
      return;
    }
    switch (node.kind) {
      case 'loadBalancer': {
        const target = this.pickBalanceTarget(node);
        if (!target) {
          this.routingFailures++;
          this.failFrom(node, req);
          return;
        }
        this.dispatch(node, target, req);
        return;
      }
      case 'appServer': {
        const target = this.pickBackend(node);
        if (!target) {
          this.routingFailures++;
          this.failFrom(node, req);
          return;
        }
        this.dispatch(node, target, req);
        return;
      }
      case 'cache': {
        const has = node.entries!.has(req.product);
        if (has) {
          node.hits++;
          if (node.eviction === 'lru') {
            node.entries!.delete(req.product);
            node.entries!.set(req.product, true);
          }
          this.leaveAndReturn(node, req);
          return;
        }
        node.misses++;
        const target = node.targets[node.rr++ % Math.max(1, node.targets.length)];
        if (!target) {
          this.routingFailures++;
          this.failFrom(node, req);
          return;
        }
        this.dispatch(node, target, req);
        return;
      }
      case 'database':
      case 'replica':
        this.leaveAndReturn(node, req);
        return;
      default:
        this.leaveAndReturn(node, req);
    }
  }

  private pickBalanceTarget(node: NodeState): string | undefined {
    if (node.targets.length === 0) return undefined;
    if (node.algorithm === 'leastBusy') {
      let best: string | undefined;
      let bestLoad = Infinity;
      for (const id of node.targets) {
        const t = this.nodes.get(id);
        if (!t) continue;
        const load = t.busy + t.queue.length;
        if (load < bestLoad) {
          bestLoad = load;
          best = id;
        }
      }
      return best;
    }
    return node.targets[node.rr++ % node.targets.length];
  }

  private pickBackend(node: NodeState): string | undefined {
    if (node.targets.length === 0) return undefined;
    if (node.backendPolicy === 'firstAvailable') return node.targets[0];
    return node.targets[node.rr++ % node.targets.length];
  }

  /** Release `node`'s slot and hand the answer back to whoever called it. */
  private leaveAndReturn(node: NodeState, req: Req): void {
    if (req.working === node) req.working = null;
    this.release(node);
    req.stack.pop();
    const parent = req.stack[req.stack.length - 1];
    if (!parent) {
      this.complete(req);
      return;
    }
    this.push({ time: this.now + node.networkMs, kind: 'return', req, node: parent });
  }

  private onReturn(parent: NodeState, req: Req): void {
    if (req.done || req.dead) return;
    // A read-through cache stores what it just fetched, then answers.
    if (parent.kind === 'cache' && parent.entries) {
      if (!parent.entries.has(req.product)) {
        parent.entries.set(req.product, true);
        if (parent.entries.size > parent.cacheCapacity) {
          const oldest = parent.entries.keys().next();
          if (!oldest.done) parent.entries.delete(oldest.value);
        }
      }
    }
    this.leaveAndReturn(parent, req);
  }

  private onDeadline(req: Req): void {
    if (req.done) return;
    this.abandon(req, this.now, false);
  }

  /* ---------------- terminal states ---------------- */

  private release(node: NodeState): void {
    this.integrate(node, this.now);
    node.busy = Math.max(0, node.busy - 1);
    node.completed++;
    this.pump(node);
  }

  /** Start whatever is next in line, skipping requests that gave up. */
  private pump(node: NodeState): void {
    while (node.busy < node.concurrency && node.queue.length > 0) {
      const next = node.queue.shift()!;
      this.integrate(node, this.now);
      if (next.done || next.dead) continue;
      next.queuedAt = null;
      this.startService(node, next);
    }
  }

  private complete(req: Req): void {
    req.done = true;
    this.completedCount++;
    const latency = this.now - req.t0;
    this.latencies.push(latency);
    this.finishedLatencies.push(latency);
    this.completions.point(this.now);
  }

  /** Rejected by a full queue. */
  private fail(req: Req, at: number): void {
    if (req.done) return;
    req.done = true;
    this.failedCount++;
    this.finishedLatencies.push(at - req.t0);
    this.unwind(req);
  }

  /** Rejection raised *at* a node that is itself holding the request. */
  private failFrom(node: NodeState, req: Req): void {
    this.release(node);
    req.stack.pop();
    this.fail(req, this.now);
  }

  private abandon(req: Req, at: number, atHorizon: boolean): void {
    if (req.done) return;
    req.done = true;
    req.dead = true;
    this.timedOutCount++;
    this.finishedLatencies.push(atHorizon ? at - req.t0 : this.challenge.workload.requestTimeoutMs);
    this.unwind(req);
  }

  /** Free every slot and queue place a dying request still occupies. */
  private unwind(req: Req): void {
    if (req.queuedAt) {
      const node = req.queuedAt;
      const idx = node.queue.indexOf(req);
      if (idx >= 0) {
        this.integrate(node, this.now);
        node.queue.splice(idx, 1);
      }
      req.queuedAt = null;
    }
    for (let i = req.stack.length - 1; i >= 0; i--) {
      const node = req.stack[i];
      // The component currently doing work keeps its slot until that work ends.
      if (node === req.working) continue;
      this.integrate(node, this.now);
      node.busy = Math.max(0, node.busy - 1);
      this.pump(node);
    }
    req.stack.length = 0;
  }

  /* ---------------- accounting ---------------- */

  private integrate(node: NodeState, to: number): void {
    if (to <= node.lastTs) return;
    node.busyIntegral.span(node.lastTs, to, node.busy);
    node.queueIntegral.span(node.lastTs, to, node.queue.length);
    node.lastTs = to;
  }

  /** Live view. Cheap enough to call every animation frame. */
  frame(): Frame {
    const nodes: NodeRuntimeState[] = [];
    const now = this.now;
    for (const node of this.nodes.values()) {
      const tail = Math.max(0, now - node.lastTs);
      const busyWindow = node.busyIntegral.window(node.lastTs, LIVE_WINDOW_MS) + tail * node.busy;
      const windowMs = Math.min(LIVE_WINDOW_MS, Math.max(1, now));
      const util =
        node.kind === 'client'
          ? 0
          : clamp(busyWindow / (windowMs * node.concurrency), 0, 1);
      nodes.push({
        id: node.id,
        kind: node.kind,
        busy: node.busy,
        concurrency: node.kind === 'client' ? 0 : node.concurrency,
        queueDepth: node.queue.length,
        queueCapacity: node.queueCapacity,
        utilization: util,
        arrivalRate: (node.arrivals.window(now, LIVE_WINDOW_MS) * 1000) / windowMs,
        arrived: node.arrived,
        completed: node.completed,
        rejected: node.rejected,
        cacheHits: node.kind === 'cache' ? node.hits : undefined,
        cacheMisses: node.kind === 'cache' ? node.misses : undefined,
        cacheEntries: node.kind === 'cache' ? node.entries!.size : undefined,
      });
    }

    const edges: EdgeRuntimeState[] = this.plan.edges.map((e) => {
      const windowMs = Math.min(LIVE_WINDOW_MS, Math.max(1, now));
      return {
        id: e.id,
        traversals: this.edgeTraversals.get(e.id) ?? 0,
        rate: ((this.edgeRates.get(e.id)?.window(now, LIVE_WINDOW_MS) ?? 0) * 1000) / windowMs,
      };
    });

    const bottlenecks = nodes
      .filter(
        (n) =>
          n.kind !== 'client' &&
          (n.rejected > 0 ||
            n.utilization >= 0.85 ||
            (n.queueCapacity > 0 && n.queueDepth / n.queueCapacity >= 0.4)),
      )
      .map((n) => n.id);

    return { metrics: this.metrics(), nodes, edges, bottlenecks, finished: this._finished };
  }

  private metrics(): RunMetrics {
    const storage = [...this.nodes.values()].filter(
      (n) => n.kind === 'database' || n.kind === 'replica',
    );
    const caches = [...this.nodes.values()].filter((n) => n.kind === 'cache');

    let hits = 0;
    let misses = 0;
    let entries = 0;
    for (const c of caches) {
      hits += c.hits;
      misses += c.misses;
      entries += c.entries!.size;
    }

    let served = 0;
    let overflowed = 0;
    let peakQueueDepth = 0;
    let busySum = 0;
    let capacitySum = 0;
    const elapsed = Math.max(1, this.now);
    for (const s of storage) {
      served += s.completed;
      overflowed += s.rejected;
      peakQueueDepth = Math.max(peakQueueDepth, s.peakQueue);
      const tail = Math.max(0, this.now - s.lastTs);
      busySum += s.busyIntegral.total() + tail * s.busy;
      capacitySum += elapsed * s.concurrency;
    }

    const inFlight = this.generated - this.completedCount - this.failedCount - this.timedOutCount;

    return {
      simTimeMs: this.now,
      generated: this.generated,
      completed: this.completedCount,
      failed: this.failedCount,
      timedOut: this.timedOutCount,
      inFlight,
      successRate: this.generated === 0 ? 0 : this.completedCount / this.generated,
      latency: {
        mean: mean(this.latencies),
        p50: percentile(this.latencies, 0.5),
        p95: percentile(this.latencies, 0.95),
        p99: percentile(this.latencies, 0.99),
        max: this.latencies.length ? Math.max(...this.latencies) : 0,
        p95IncludingFailures: percentile(this.finishedLatencies, 0.95),
      },
      cache: caches.length
        ? { hits, misses, hitRate: hits + misses === 0 ? 0 : hits / (hits + misses), entries }
        : null,
      database: {
        served,
        peakQueueDepth,
        overflowed,
        utilization: capacitySum === 0 ? 0 : clamp(busySum / capacitySum, 0, 1),
      },
      throughputPerSecond: this.completions.perSecond(),
    };
  }

  /** Everything the feedback engine and results panel read. */
  result(): RunResult {
    const nodes: NodeSummary[] = [...this.nodes.values()].map((node) => {
      const elapsed = Math.max(1, this.now);
      const tail = Math.max(0, this.now - node.lastTs);
      const busy = node.busyIntegral.total() + tail * node.busy;
      const queue = node.queueIntegral.total() + tail * node.queue.length;
      const summary: NodeSummary = {
        id: node.id,
        label: node.label,
        kind: node.kind,
        arrived: node.arrived,
        completed: node.completed,
        rejected: node.rejected,
        peakQueue: node.peakQueue,
        queueCapacity: node.queueCapacity,
        concurrency: node.kind === 'client' ? 0 : node.concurrency,
        utilization: node.kind === 'client' ? 0 : clamp(busy / (elapsed * node.concurrency), 0, 1),
        meanQueueDepth: queue / elapsed,
      };
      if (node.kind === 'cache') {
        summary.hits = node.hits;
        summary.misses = node.misses;
        summary.hitRate = node.hits + node.misses === 0 ? 0 : node.hits / (node.hits + node.misses);
        summary.entries = node.entries!.size;
      }
      if (node.kind === 'database' || node.kind === 'replica') {
        summary.capacityPerSecond = (node.concurrency / Math.max(1e-6, node.serviceMs)) * 1000;
      }
      if (node.kind === 'appServer' && node.serviceMs > 0) {
        summary.capacityPerSecond = undefined;
      }
      return summary;
    });

    return {
      metrics: this.metrics(),
      nodes,
      edges: this.plan.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        traversals: this.edgeTraversals.get(e.id) ?? 0,
      })),
      finished: this._finished,
      routingFailures: this.routingFailures,
      horizonMs: this.horizonMs,
      lastArrivalMs: this.lastArrivalMs,
      workloadPerSecond: [...this.challenge.workload.requestsPerSecond],
    };
  }
}

/* ------------------------------------------------------------------ */

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/**
 * Nearest-rank percentile on the sorted sample: the smallest observed value at
 * or above which `p` of the sample falls. No interpolation, so a reported p95 is
 * always a latency some real request actually experienced.
 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(p * sorted.length);
  return sorted[clamp(rank - 1, 0, sorted.length - 1)];
}

/** Convenience for tests and the example-solution check. */
export function runArchitecture(architecture: Architecture, challenge: Challenge): RunResult {
  return new Simulation(architecture, challenge).runToEnd();
}

export { KINDS };
