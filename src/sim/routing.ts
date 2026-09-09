import { edgeRole } from './catalog';
import type { Architecture, ArchNode, EdgeRole, NodeKind } from './types';

export interface CompiledEdge {
  id: string;
  source: string;
  target: string;
  role: EdgeRole;
}

/**
 * A routing plan is the *executable* reading of the canvas: who may hand a
 * request to whom. The engine only ever consults this, never the raw edges.
 */
export interface RoutePlan {
  nodes: Map<string, ArchNode>;
  edges: CompiledEdge[];
  /** node id -> outgoing edges (in stable, id-sorted order). */
  out: Map<string, CompiledEdge[]>;
  in: Map<string, CompiledEdge[]>;
  clientIds: string[];
  /** Where the client sends requests: load balancers and/or app servers. */
  entryTargets: Map<string, string[]>;
  /** Load balancer -> app servers. */
  balanceTargets: Map<string, string[]>;
  /** App server -> caches / databases / replicas it reads from. */
  readBackends: Map<string, string[]>;
  /** Cache -> databases / replicas it falls back to on a miss. */
  fillTargets: Map<string, string[]>;
  /** (source,target) -> edge id, for traffic animation counters. */
  edgeIndex: Map<string, string>;
}

export function compile(arch: Architecture): RoutePlan {
  const nodes = new Map<string, ArchNode>();
  for (const n of arch.nodes) nodes.set(n.id, n);

  const edges: CompiledEdge[] = [];
  // Sorting keeps round-robin order stable no matter what order the learner
  // drew the connections in, which is a precondition for reproducible runs.
  const sorted = [...arch.edges].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const e of sorted) {
    const s = nodes.get(e.source);
    const t = nodes.get(e.target);
    if (!s || !t) continue;
    const role = edgeRole(s.kind, t.kind);
    if (!role) continue;
    edges.push({ id: e.id, source: e.source, target: e.target, role });
  }

  const out = new Map<string, CompiledEdge[]>();
  const inbound = new Map<string, CompiledEdge[]>();
  const edgeIndex = new Map<string, string>();
  for (const e of edges) {
    if (!out.has(e.source)) out.set(e.source, []);
    out.get(e.source)!.push(e);
    if (!inbound.has(e.target)) inbound.set(e.target, []);
    inbound.get(e.target)!.push(e);
    edgeIndex.set(`${e.source}>${e.target}`, e.id);
  }

  const byRole = (id: string, role: EdgeRole, kinds: NodeKind[]) =>
    (out.get(id) ?? [])
      .filter((e) => e.role === role && kinds.includes(nodes.get(e.target)!.kind))
      .map((e) => e.target);

  const clientIds = arch.nodes.filter((n) => n.kind === 'client').map((n) => n.id);
  const entryTargets = new Map<string, string[]>();
  for (const id of clientIds)
    entryTargets.set(id, byRole(id, 'client-to-entry', ['loadBalancer', 'appServer']));

  const balanceTargets = new Map<string, string[]>();
  for (const n of arch.nodes)
    if (n.kind === 'loadBalancer') balanceTargets.set(n.id, byRole(n.id, 'balance', ['appServer']));

  const readBackends = new Map<string, string[]>();
  for (const n of arch.nodes)
    if (n.kind === 'appServer')
      readBackends.set(n.id, byRole(n.id, 'read-backend', ['cache', 'database', 'replica']));

  const fillTargets = new Map<string, string[]>();
  for (const n of arch.nodes)
    if (n.kind === 'cache')
      fillTargets.set(n.id, byRole(n.id, 'cache-fill', ['database', 'replica']));

  return {
    nodes,
    edges,
    out,
    in: inbound,
    clientIds,
    entryTargets,
    balanceTargets,
    readBackends,
    fillTargets,
    edgeIndex,
  };
}

/** Every node that a request can actually reach, walking forward from clients. */
export function reachableFromClients(plan: RoutePlan): Set<string> {
  const seen = new Set<string>();
  const stack = [...plan.clientIds];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of plan.out.get(id) ?? []) stack.push(e.target);
  }
  return seen;
}

/**
 * Cycle detection over the compiled graph. The allowed-connection table happens
 * to be acyclic today, but routing rules are meant to be extended (queues and
 * workers in later challenges), so the engine refuses to run a cyclic graph
 * rather than trusting the table.
 */
export function findCycle(plan: RoutePlan): string[] | null {
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const id of plan.nodes.keys()) color.set(id, WHITE);
  const path: string[] = [];

  const visit = (id: string): string[] | null => {
    color.set(id, GREY);
    path.push(id);
    for (const e of plan.out.get(id) ?? []) {
      const c = color.get(e.target) ?? WHITE;
      if (c === GREY) return [...path.slice(path.indexOf(e.target)), e.target];
      if (c === WHITE) {
        const found = visit(e.target);
        if (found) return found;
      }
    }
    path.pop();
    color.set(id, BLACK);
    return null;
  };

  for (const id of plan.nodes.keys()) {
    if ((color.get(id) ?? WHITE) === WHITE) {
      const found = visit(id);
      if (found) return found;
    }
  }
  return null;
}
