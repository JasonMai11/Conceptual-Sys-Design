import { describe, expect, it } from 'vitest';
import { edgeRole, edgeRejection } from '../src/sim/catalog';
import { compile, findCycle } from '../src/sim/routing';
import { validate } from '../src/sim/validate';
import { edge, node } from '../src/sim/challenges';
import type { Architecture } from '../src/sim/types';
import { BASELINE, CACHED, arch } from './fixtures';

const codes = (a: Architecture) => validate(a).issues.map((i) => i.code);

describe('connection rules', () => {
  it('accepts the connections the model can route', () => {
    expect(edgeRole('client', 'appServer')).toBe('client-to-entry');
    expect(edgeRole('client', 'loadBalancer')).toBe('client-to-entry');
    expect(edgeRole('loadBalancer', 'appServer')).toBe('balance');
    expect(edgeRole('appServer', 'cache')).toBe('read-backend');
    expect(edgeRole('appServer', 'database')).toBe('read-backend');
    expect(edgeRole('appServer', 'replica')).toBe('read-backend');
    expect(edgeRole('cache', 'database')).toBe('cache-fill');
    expect(edgeRole('cache', 'replica')).toBe('cache-fill');
  });

  it('refuses the ones it cannot, with an explanation', () => {
    const bad: [Parameters<typeof edgeRole>[0], Parameters<typeof edgeRole>[1]][] = [
      ['client', 'database'],
      ['client', 'cache'],
      ['appServer', 'appServer'],
      ['appServer', 'loadBalancer'],
      ['loadBalancer', 'database'],
      ['loadBalancer', 'cache'],
      ['database', 'appServer'],
      ['database', 'cache'],
      ['replica', 'database'],
      ['cache', 'appServer'],
      ['cache', 'cache'],
      ['appServer', 'client'],
    ];
    for (const [s, t] of bad) {
      expect(edgeRole(s, t), `${s} -> ${t}`).toBeNull();
      expect(edgeRejection(s, t).length).toBeGreaterThan(20);
    }
  });

  it('flags an unsupported connection as an error naming both components', () => {
    const design = arch(['client', 'database'], [[0, 1]]);
    const result = validate(design);
    expect(result.runnable).toBe(false);
    const issue = result.issues.find((i) => i.code === 'unsupported-edge')!;
    expect(issue.nodeIds).toEqual([design.nodes[0].id, design.nodes[1].id]);
  });
});

describe('validation', () => {
  it('passes the starting design and a cached design', () => {
    expect(validate(BASELINE).runnable).toBe(true);
    expect(validate(CACHED).runnable).toBe(true);
    expect(codes(CACHED)).not.toContain('cache-no-source');
  });

  it('requires a traffic source', () => {
    expect(codes(arch(['appServer', 'database'], [[0, 1]]))).toContain('no-client');
  });

  it('requires the client to have somewhere to send requests', () => {
    expect(codes(arch(['client', 'appServer', 'database'], [[1, 2]]))).toContain('client-no-entry');
  });

  it('requires an application server to have a read backend', () => {
    expect(codes(arch(['client', 'appServer'], [[0, 1]]))).toContain('app-no-backend');
  });

  it('requires a cache to have a source of truth', () => {
    const design = arch(['client', 'appServer', 'cache'], [
      [0, 1],
      [1, 2],
    ]);
    expect(codes(design)).toContain('cache-no-source');
    expect(validate(design).runnable).toBe(false);
  });

  it('requires a load balancer to have application servers behind it', () => {
    const design = arch(['client', 'loadBalancer', 'appServer', 'database'], [
      [0, 1],
      [2, 3],
    ]);
    expect(codes(design)).toContain('lb-no-targets');
  });

  it('warns about components nothing can reach', () => {
    const design = arch(['client', 'appServer', 'database', 'replica'], [
      [0, 1],
      [1, 2],
    ]);
    const issues = validate(design).issues;
    expect(issues.some((i) => i.code === 'storage-unused')).toBe(true);
    expect(validate(design).runnable).toBe(true); // a warning, not a blocker
  });

  it('warns about a duplicate connection', () => {
    const design: Architecture = {
      nodes: BASELINE.nodes,
      edges: [...BASELINE.edges, { id: 'dupe', source: BASELINE.edges[1].source, target: BASELINE.edges[1].target }],
    };
    expect(codes(design)).toContain('duplicate-edge');
  });

  it('notes when only some reads go through the cache', () => {
    const design = arch(['client', 'appServer', 'cache', 'database'], [
      [0, 1],
      [1, 2],
      [1, 3],
      [2, 3],
    ]);
    expect(codes(design)).toContain('mixed-backends');
    expect(validate(design).runnable).toBe(true);
  });

  it('rejects a connection pointing at a component that is gone', () => {
    const design: Architecture = {
      nodes: [node('client', 'client', 'Client', 0, 0)],
      edges: [edge('client', 'ghost')],
    };
    expect(codes(design)).toContain('dangling-edge');
  });

  it('enforces the per-challenge instance limit', () => {
    const many = arch(
      ['client', 'appServer', 'database', 'database'],
      [
        [0, 1],
        [1, 2],
        [1, 3],
      ],
    );
    expect(codes(many)).toContain('too-many');
  });

  it('detects a cycle if the routing rules ever allow one', () => {
    // Hand-built cyclic plan: the rule table is acyclic today, so this proves
    // the guard itself works rather than relying on the table staying that way.
    const design = arch(['client', 'appServer', 'cache', 'database'], [
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
    const plan = compile(design);
    expect(findCycle(plan)).toBeNull();

    const cyclic = compile(design);
    const a = design.nodes[1].id;
    const b = design.nodes[2].id;
    cyclic.out.set(b, [{ id: 'loop', source: b, target: a, role: 'read-backend' }]);
    const cycle = findCycle(cyclic);
    expect(cycle).not.toBeNull();
    expect(cycle).toContain(a);
    expect(cycle).toContain(b);
  });
});
