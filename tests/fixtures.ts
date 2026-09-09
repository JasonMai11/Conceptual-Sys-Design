import { edge, node } from '../src/sim/challenges';
import type { Architecture, NodeKind } from '../src/sim/types';

/** Compact architecture builder for tests: `arch(['client','appServer'], [[0,1]])`. */
export function arch(
  kinds: (NodeKind | [NodeKind, Record<string, number | string>])[],
  links: [number, number][],
): Architecture {
  const nodes = kinds.map((entry, i) => {
    const [kind, config] = Array.isArray(entry) ? entry : [entry, {}];
    return node(`${kind}-${i}`, kind, `${kind} ${i}`, i * 200, 0, config);
  });
  return {
    nodes,
    edges: links.map(([a, b]) => edge(nodes[a].id, nodes[b].id)),
  };
}

/** client -> app -> db, the challenge's starting shape. */
export const BASELINE = arch(['client', 'appServer', 'database'], [
  [0, 1],
  [1, 2],
]);

/** client -> app -> cache -> db. */
export const CACHED = arch(['client', 'appServer', 'cache', 'database'], [
  [0, 1],
  [1, 2],
  [2, 3],
]);

/** client -> lb -> 2 apps -> (db + 4 replicas), no cache. */
export const REPLICATED: Architecture = (() => {
  const a = arch(
    ['client', 'loadBalancer', 'appServer', 'appServer', 'database', 'replica', 'replica', 'replica', 'replica'],
    [
      [0, 1],
      [1, 2],
      [1, 3],
      [2, 4],
      [2, 5],
      [2, 6],
      [2, 7],
      [2, 8],
      [3, 4],
      [3, 5],
      [3, 6],
      [3, 7],
      [3, 8],
    ],
  );
  return a;
})();
