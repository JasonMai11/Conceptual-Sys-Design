import { describe, expect, it } from 'vitest';
import { runArchitecture } from '../src/sim/engine';
import { SURVIVE_THE_SPIKE, edge, node, totalRequests } from '../src/sim/challenges';
import { evaluate } from '../src/sim/evaluate';
import { validate } from '../src/sim/validate';
import type { Architecture } from '../src/sim/types';
import { CACHED, REPLICATED, arch } from './fixtures';

const CH = SURVIVE_THE_SPIKE;

function grade(design: Architecture) {
  const validation = validate(design);
  const result = runArchitecture(design, CH);
  const evaluation = evaluate({
    challenge: CH,
    architecture: design,
    validation,
    result,
  });
  return { result, evaluation, metrics: result.metrics };
}

describe('the challenge is calibrated', () => {
  it('the starting design is valid but fails, badly and visibly', () => {
    const { evaluation, metrics } = grade(CH.startingArchitecture);
    expect(validate(CH.startingArchitecture).runnable).toBe(true);
    expect(evaluation.verdict).toBe('missed');
    expect(metrics.successRate).toBeLessThan(CH.criteria.minSuccessRate);
    expect(metrics.latency.p95).toBeGreaterThan(CH.criteria.maxP95LatencyMs);
    expect(metrics.failed + metrics.timedOut).toBeGreaterThan(1000);
    // The lesson has to be legible: storage is pinned, not merely busy.
    expect(metrics.database.utilization).toBeGreaterThan(0.9);
    expect(evaluation.evidence.join(' ')).toMatch(/queue/i);
    expect(evaluation.suggestions.join(' ')).toMatch(/cache/i);
  });

  it('caching in front of the database passes', () => {
    const { evaluation, metrics } = grade(CACHED);
    expect(evaluation.verdict).toBe('passed');
    expect(metrics.successRate).toBeGreaterThanOrEqual(CH.criteria.minSuccessRate);
    expect(metrics.latency.p95).toBeLessThanOrEqual(CH.criteria.maxP95LatencyMs);
    expect(metrics.database.overflowed).toBe(0);
    expect(metrics.cache!.hitRate).toBeGreaterThan(0.6);
  });

  it('spreading reads over replicas passes too, with no cache at all', () => {
    const { evaluation, metrics } = grade(REPLICATED);
    expect(evaluation.verdict).toBe('passed');
    expect(metrics.cache).toBeNull();
    expect(metrics.database.served).toBe(totalRequests(CH));
    expect(metrics.database.overflowed).toBe(0);
    expect(metrics.latency.p95).toBeLessThanOrEqual(CH.criteria.maxP95LatencyMs);
  });

  it('the two passing designs are genuinely different, and cost differently', () => {
    const cached = grade(CACHED);
    const replicated = grade(REPLICATED);
    expect(cached.evaluation.cost.units).toBeLessThan(replicated.evaluation.cost.units);
    expect(cached.metrics.database.served).toBeLessThan(replicated.metrics.database.served / 3);
  });

  it('the bundled example solution passes', () => {
    const { evaluation } = grade(CH.exampleSolution.architecture);
    expect(evaluation.verdict).toBe('passed');
  });

  it('adding application servers alone does not rescue the design', () => {
    const moreApps: Architecture = {
      nodes: [
        node('client', 'client', 'Shoppers', 0, 0),
        node('lb', 'loadBalancer', 'LB', 0, 0),
        node('app-1', 'appServer', 'App 1', 0, 0),
        node('app-2', 'appServer', 'App 2', 0, 0),
        node('app-3', 'appServer', 'App 3', 0, 0),
        node('db', 'database', 'DB', 0, 0),
      ],
      edges: [
        edge('client', 'lb'),
        edge('lb', 'app-1'),
        edge('lb', 'app-2'),
        edge('lb', 'app-3'),
        edge('app-1', 'db'),
        edge('app-2', 'db'),
        edge('app-3', 'db'),
      ],
    };
    const { evaluation, metrics } = grade(moreApps);
    expect(evaluation.verdict).toBe('missed');
    // The database is now the thing that overflows, which is the point.
    expect(metrics.database.overflowed).toBeGreaterThan(0);
    expect(metrics.database.utilization).toBeGreaterThan(0.8);
  });

  it('explains a before/after comparison when app servers were the only change', () => {
    const before = arch(['client', 'appServer', 'database'], [
      [0, 1],
      [1, 2],
    ]);
    const after: Architecture = {
      nodes: [
        node('client', 'client', 'Shoppers', 0, 0),
        node('lb', 'loadBalancer', 'LB', 0, 0),
        node('app-1', 'appServer', 'App 1', 0, 0),
        node('app-2', 'appServer', 'App 2', 0, 0),
        node('app-3', 'appServer', 'App 3', 0, 0),
        node('app-4', 'appServer', 'App 4', 0, 0),
        node('db', 'database', 'DB', 0, 0),
      ],
      edges: [
        edge('client', 'lb'),
        edge('lb', 'app-1'),
        edge('lb', 'app-2'),
        edge('lb', 'app-3'),
        edge('lb', 'app-4'),
        edge('app-1', 'db'),
        edge('app-2', 'db'),
        edge('app-3', 'db'),
        edge('app-4', 'db'),
      ],
    };
    const beforeResult = runArchitecture(before, CH);
    const afterResult = runArchitecture(after, CH);
    const evaluation = evaluate({
      challenge: CH,
      architecture: after,
      validation: validate(after),
      result: afterResult,
      previous: { result: beforeResult, architecture: before },
    });
    const text = evaluation.evidence.join(' ');
    expect(text).toMatch(/Compared with your previous run/);
    expect(text).toMatch(/saturated/i);
  });
});

describe('feedback distinguishes the three outcomes', () => {
  it('calls an unrunnable design invalid and does not invent metrics', () => {
    const broken = arch(['client', 'appServer'], [[0, 1]]);
    const evaluation = evaluate({
      challenge: CH,
      architecture: broken,
      validation: validate(broken),
      result: null,
    });
    expect(evaluation.verdict).toBe('invalid');
    expect(evaluation.criteria).toHaveLength(0);
    expect(evaluation.evidence.join(' ')).toMatch(/read backend/i);
  });

  it('quotes real numbers, never placeholders', () => {
    const { evaluation, metrics } = grade(CACHED);
    const text = [...evaluation.evidence, ...evaluation.criteria.map((c) => c.detail)].join(' ');
    expect(text).toContain(metrics.completed.toLocaleString('en-US'));
    expect(text).toMatch(/\d/);
    expect(text).not.toMatch(/TODO|lorem|placeholder|XX/i);
  });

  it('separates real-world tradeoffs from what was simulated', () => {
    const { evaluation } = grade(CACHED);
    expect(evaluation.tradeoffs.join(' ')).toMatch(/read-only|stale/i);
    const replicated = grade(REPLICATED);
    expect(replicated.evaluation.tradeoffs.join(' ')).toMatch(/write/i);
  });

  it('reports cost only in relative educational units', () => {
    const { evaluation } = grade(CACHED);
    expect(evaluation.cost.units).toBeGreaterThan(0);
    const text = [...evaluation.tradeoffs, ...evaluation.suggestions].join(' ');
    expect(text).toMatch(/relative cost units/);
    expect(text).not.toMatch(/\$|USD|dollar/);
  });
});
