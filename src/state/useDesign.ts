import { useCallback, useMemo, useReducer } from 'react';
import {
  KINDS,
  cloneArchitecture,
  defaultConfig,
  edgeRejection,
  edgeRole,
  validate,
  type ArchNode,
  type Architecture,
  type Challenge,
  type NodeKind,
} from '../sim';

export type DesignAction =
  | { type: 'addNode'; kind: NodeKind; position?: { x: number; y: number } }
  | { type: 'moveNode'; id: string; position: { x: number; y: number } }
  | { type: 'setConfig'; id: string; key: string; value: number | string }
  | { type: 'rename'; id: string; label: string }
  | { type: 'removeNode'; id: string }
  | { type: 'connect'; source: string; target: string }
  | { type: 'removeEdge'; id: string }
  | { type: 'replace'; architecture: Architecture };

/** Tidy columns by role, so an auto-placed block lands where it belongs. */
const COLUMN: Record<NodeKind, number> = {
  client: 20,
  loadBalancer: 250,
  appServer: 470,
  cache: 700,
  database: 930,
  replica: 930,
};

function nextId(arch: Architecture, kind: NodeKind): string {
  let i = 1;
  for (;;) {
    const id = `${kind}-${i}`;
    if (!arch.nodes.some((n) => n.id === id)) return id;
    i++;
  }
}

function nextLabel(arch: Architecture, kind: NodeKind): string {
  const base = KINDS[kind].name;
  const count = arch.nodes.filter((n) => n.kind === kind).length;
  if (count === 0) return base;
  return `${base} ${count + 1}`;
}

function autoPosition(arch: Architecture, kind: NodeKind): { x: number; y: number } {
  const column = COLUMN[kind];
  const siblings = arch.nodes.filter((n) => Math.abs(n.position.x - column) < 90);
  const rows = siblings.map((n) => n.position.y).sort((a, b) => a - b);
  let y = 120;
  for (const row of rows) if (Math.abs(row - y) < 130) y = row + 150;
  return { x: column, y };
}

export function designReducer(arch: Architecture, action: DesignAction): Architecture {
  switch (action.type) {
    case 'addNode': {
      const node: ArchNode = {
        id: nextId(arch, action.kind),
        kind: action.kind,
        label: nextLabel(arch, action.kind),
        position: action.position ?? autoPosition(arch, action.kind),
        config: defaultConfig(action.kind),
      };
      return { nodes: [...arch.nodes, node], edges: arch.edges };
    }
    case 'moveNode':
      return {
        nodes: arch.nodes.map((n) => (n.id === action.id ? { ...n, position: action.position } : n)),
        edges: arch.edges,
      };
    case 'setConfig':
      return {
        nodes: arch.nodes.map((n) =>
          n.id === action.id ? { ...n, config: { ...n.config, [action.key]: action.value } } : n,
        ),
        edges: arch.edges,
      };
    case 'rename':
      return {
        nodes: arch.nodes.map((n) => (n.id === action.id ? { ...n, label: action.label } : n)),
        edges: arch.edges,
      };
    case 'removeNode':
      return {
        nodes: arch.nodes.filter((n) => n.id !== action.id),
        edges: arch.edges.filter((e) => e.source !== action.id && e.target !== action.id),
      };
    case 'connect': {
      if (action.source === action.target) return arch;
      const id = `${action.source}__${action.target}`;
      if (arch.edges.some((e) => e.id === id)) return arch;
      return { nodes: arch.nodes, edges: [...arch.edges, { id, source: action.source, target: action.target }] };
    }
    case 'removeEdge':
      return { nodes: arch.nodes, edges: arch.edges.filter((e) => e.id !== action.id) };
    case 'replace':
      return cloneArchitecture(action.architecture);
  }
}

export function useDesign(challenge: Challenge, initial?: Architecture) {
  const [architecture, dispatch] = useReducer(
    designReducer,
    initial ?? challenge.startingArchitecture,
    cloneArchitecture,
  );

  const validation = useMemo(() => validate(architecture), [architecture]);

  /** Pre-flight check used by the canvas before it accepts a new connection. */
  const canConnect = useCallback(
    (source: string, target: string): { ok: boolean; reason?: string } => {
      const s = architecture.nodes.find((n) => n.id === source);
      const t = architecture.nodes.find((n) => n.id === target);
      if (!s || !t) return { ok: false, reason: 'One of those components no longer exists.' };
      if (source === target) return { ok: false, reason: 'A component cannot connect to itself.' };
      if (architecture.edges.some((e) => e.source === source && e.target === target))
        return { ok: false, reason: `${s.label} already sends requests to ${t.label}.` };
      if (!edgeRole(s.kind, t.kind)) return { ok: false, reason: edgeRejection(s.kind, t.kind) };
      return { ok: true };
    },
    [architecture],
  );

  return { architecture, dispatch, validation, canConnect };
}
