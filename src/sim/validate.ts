import { KINDS, edgeRejection, edgeRole } from './catalog';
import { compile, findCycle, reachableFromClients } from './routing';
import type { Architecture, ValidationIssue, ValidationResult } from './types';

/**
 * Static checks run on every edit. Errors block the run and name the fix;
 * warnings and info notes teach without getting in the way.
 */
export function validate(arch: Architecture): ValidationResult {
  const issues: ValidationIssue[] = [];
  const byId = new Map(arch.nodes.map((n) => [n.id, n]));
  const label = (id: string) => byId.get(id)?.label ?? id;

  /* --- structural: does the graph even make sense? --- */

  const clients = arch.nodes.filter((n) => n.kind === 'client');
  if (clients.length === 0) {
    issues.push({
      severity: 'error',
      code: 'no-client',
      message: 'There is no traffic source. Add the Client traffic block to send requests.',
    });
  }

  const seenPairs = new Set<string>();
  for (const e of arch.edges) {
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (!s || !t) {
      issues.push({
        severity: 'error',
        code: 'dangling-edge',
        message: 'A connection points at a component that no longer exists. Delete it and redraw.',
        edgeIds: [e.id],
      });
      continue;
    }
    if (!edgeRole(s.kind, t.kind)) {
      issues.push({
        severity: 'error',
        code: 'unsupported-edge',
        message: `${label(e.source)} → ${label(e.target)}: ${edgeRejection(s.kind, t.kind)}`,
        edgeIds: [e.id],
        nodeIds: [e.source, e.target],
      });
      continue;
    }
    const pair = `${e.source}>${e.target}`;
    if (seenPairs.has(pair)) {
      issues.push({
        severity: 'warning',
        code: 'duplicate-edge',
        message: `${label(e.source)} is connected to ${label(e.target)} more than once. The extra connection carries no additional traffic.`,
        edgeIds: [e.id],
      });
    }
    seenPairs.add(pair);
  }

  const plan = compile(arch);

  const cycle = findCycle(plan);
  if (cycle) {
    issues.push({
      severity: 'error',
      code: 'cycle',
      message: `Requests would loop forever: ${cycle.map(label).join(' → ')}. Remove one of those connections.`,
      nodeIds: cycle,
    });
  }

  /* --- per-component obligations --- */

  for (const node of arch.nodes) {
    const outs = plan.out.get(node.id) ?? [];
    const ins = plan.in.get(node.id) ?? [];

    switch (node.kind) {
      case 'client': {
        if ((plan.entryTargets.get(node.id) ?? []).length === 0) {
          issues.push({
            severity: 'error',
            code: 'client-no-entry',
            message: `${label(node.id)} has nowhere to send requests. Connect it to an application server or a load balancer.`,
            nodeIds: [node.id],
          });
        }
        break;
      }
      case 'loadBalancer': {
        if ((plan.balanceTargets.get(node.id) ?? []).length === 0) {
          issues.push({
            severity: 'error',
            code: 'lb-no-targets',
            message: `${label(node.id)} has no application servers behind it. A load balancer with nothing to balance drops every request.`,
            nodeIds: [node.id],
          });
        } else if ((plan.balanceTargets.get(node.id) ?? []).length === 1) {
          issues.push({
            severity: 'info',
            code: 'lb-single-target',
            message: `${label(node.id)} sits in front of a single application server, so it is not spreading load yet. Add another application server behind it.`,
            nodeIds: [node.id],
          });
        }
        break;
      }
      case 'appServer': {
        const backends = plan.readBackends.get(node.id) ?? [];
        if (backends.length === 0) {
          issues.push({
            severity: 'error',
            code: 'app-no-backend',
            message: `${label(node.id)} has no read backend. Connect it to a cache, a database, or a read replica so it has somewhere to get product data.`,
            nodeIds: [node.id],
          });
        }
        const kinds = backends.map((id) => byId.get(id)!.kind);
        if (kinds.includes('cache') && (kinds.includes('database') || kinds.includes('replica'))) {
          issues.push({
            severity: 'info',
            code: 'mixed-backends',
            message: `${label(node.id)} reads from a cache *and* directly from storage, so only some reads get the cache's protection. That is allowed — watch the cache hit rate to see the cost.`,
            nodeIds: [node.id],
          });
        }
        if (ins.length === 0) {
          issues.push({
            severity: 'warning',
            code: 'app-unreachable',
            message: `Nothing sends traffic to ${label(node.id)}. Connect the client or a load balancer to it, or it will sit idle.`,
            nodeIds: [node.id],
          });
        }
        break;
      }
      case 'cache': {
        if ((plan.fillTargets.get(node.id) ?? []).length === 0) {
          issues.push({
            severity: 'error',
            code: 'cache-no-source',
            message: `${label(node.id)} has no source of truth. Connect it to the database (or a read replica) so it can fill on a miss.`,
            nodeIds: [node.id],
          });
        }
        if (ins.length === 0) {
          issues.push({
            severity: 'warning',
            code: 'cache-unused',
            message: `No application server reads through ${label(node.id)}, so it will never be used.`,
            nodeIds: [node.id],
          });
        }
        break;
      }
      case 'database':
      case 'replica': {
        if (ins.length === 0) {
          issues.push({
            severity: 'warning',
            code: 'storage-unused',
            message: `Nothing queries ${label(node.id)}. Connect an application server or a cache to it.`,
            nodeIds: [node.id],
          });
        }
        if (outs.length > 0) {
          issues.push({
            severity: 'warning',
            code: 'storage-outbound',
            message: `${label(node.id)} has outgoing connections, which this model ignores. Storage only answers queries.`,
            nodeIds: [node.id],
          });
        }
        break;
      }
    }
  }

  /* --- reachability --- */

  const reachable = reachableFromClients(plan);
  for (const node of arch.nodes) {
    if (node.kind === 'client') continue;
    if (!reachable.has(node.id)) {
      const already = issues.some(
        (i) => i.nodeIds?.includes(node.id) && i.code.endsWith('unreachable'),
      );
      if (!already) {
        issues.push({
          severity: 'warning',
          code: 'node-unreachable',
          message: `${label(node.id)} (${KINDS[node.kind].name}) cannot be reached from the client, so no traffic will flow through it.`,
          nodeIds: [node.id],
        });
      }
    }
  }

  /* --- instance limits --- */

  for (const kind of Object.keys(KINDS) as (keyof typeof KINDS)[]) {
    const spec = KINDS[kind];
    const count = arch.nodes.filter((n) => n.kind === kind).length;
    if (count > spec.maxInstances) {
      issues.push({
        severity: 'error',
        code: 'too-many',
        message: `This challenge allows at most ${spec.maxInstances} × ${spec.name}. You have ${count}.`,
        nodeIds: arch.nodes.filter((n) => n.kind === kind).map((n) => n.id),
      });
    }
  }

  const order = { error: 0, warning: 1, info: 2 } as const;
  issues.sort((a, b) => order[a.severity] - order[b.severity]);
  return { issues, runnable: !issues.some((i) => i.severity === 'error') };
}
