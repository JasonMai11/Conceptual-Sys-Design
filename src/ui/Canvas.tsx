import { useCallback, useEffect, useMemo } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  Panel,
  ReactFlow,
  useReactFlow,
  type Connection,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { Architecture, Frame, ValidationResult } from '../sim';
import type { DesignAction } from '../state/useDesign';
import { ComponentNode, type ComponentFlowNode } from './nodes/ComponentNode';
import { FlowEdge, type TrafficEdge } from './edges/FlowEdge';

const nodeTypes = { component: ComponentNode };
const edgeTypes = { traffic: FlowEdge };

export interface Selection {
  type: 'node' | 'edge';
  id: string;
}

interface CanvasProps {
  architecture: Architecture;
  validation: ValidationResult;
  frame: Frame | null;
  locked: boolean;
  animate: boolean;
  selection: Selection | null;
  onSelect: (selection: Selection | null) => void;
  dispatch: (action: DesignAction) => void;
  onConnectAttempt: (source: string, target: string) => void;
  /** Bumped whenever the whole design is replaced, to re-frame the canvas. */
  fitSignal: number;
}

export function Canvas({
  architecture,
  validation,
  frame,
  locked,
  animate,
  selection,
  onSelect,
  dispatch,
  onConnectAttempt,
  fitSignal,
}: CanvasProps) {
  const { fitView, getInternalNode } = useReactFlow();

  // A loaded or imported design can sit anywhere, so re-frame it once React
  // Flow has measured the new nodes.
  useEffect(() => {
    if (fitSignal === 0) return;
    const id = window.setTimeout(() => {
      void fitView({ padding: 0.22, maxZoom: 1, duration: 240 });
    }, 60);
    return () => window.clearTimeout(id);
  }, [fitSignal, fitView]);

  const runtimeByNode = useMemo(() => {
    const map = new Map<string, Frame['nodes'][number]>();
    for (const n of frame?.nodes ?? []) map.set(n.id, n);
    return map;
  }, [frame]);

  const issueByNode = useMemo(() => {
    const map = new Map<string, 'error' | 'warning'>();
    for (const issue of validation.issues) {
      if (issue.severity === 'info') continue;
      for (const id of issue.nodeIds ?? []) {
        if (issue.severity === 'error') map.set(id, 'error');
        else if (!map.has(id)) map.set(id, 'warning');
      }
    }
    return map;
  }, [validation]);

  const bottlenecks = useMemo(() => new Set(frame?.bottlenecks ?? []), [frame]);

  // The architecture is the source of truth, so these node objects are rebuilt
  // whenever anything about them changes — selection, live runtime, warnings.
  // React Flow identifies a node it has already sized by object identity, so a
  // rebuilt object is treated as brand new and unmeasured: it hides the node
  // (`visibility: hidden`) until a ResizeObserver happens to fire again, and
  // `fitView` finds nothing to frame in the meantime. Carrying its own
  // measurement back across the rebuild is what keeps blocks on screen.
  const nodes: ComponentFlowNode[] = useMemo(
    () =>
      architecture.nodes.map((archNode) => {
        const measured = getInternalNode(archNode.id)?.measured;
        const isSelected = selection?.type === 'node' && selection.id === archNode.id;
        return {
          id: archNode.id,
          type: 'component' as const,
          position: archNode.position,
          selected: isSelected,
          ...(measured ? { measured } : {}),
          data: {
            archNode,
            runtime: runtimeByNode.get(archNode.id) ?? null,
            isBottleneck: bottlenecks.has(archNode.id),
            issue: issueByNode.get(archNode.id) ?? null,
            animate,
            selected: isSelected,
          },
        };
      }),
    [architecture.nodes, runtimeByNode, bottlenecks, issueByNode, animate, selection, getInternalNode],
  );

  const edges: TrafficEdge[] = useMemo(() => {
    const rates = new Map<string, { rate: number; traversals: number }>();
    for (const e of frame?.edges ?? []) rates.set(e.id, { rate: e.rate, traversals: e.traversals });
    const kindOf = new Map(architecture.nodes.map((n) => [n.id, n.kind]));
    return architecture.edges.map((e) => {
      const live = rates.get(e.id);
      const errored = validation.issues.some(
        (i) => i.severity === 'error' && i.edgeIds?.includes(e.id),
      );
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'traffic' as const,
        selected: selection?.type === 'edge' && selection.id === e.id,
        data: {
          rate: live?.rate ?? 0,
          traversals: live?.traversals ?? 0,
          hot: errored || bottlenecks.has(e.target),
          accent: errored ? 'var(--bad)' : `var(--k-${kindOf.get(e.source) ?? 'appServer'})`,
          animate,
          finished: frame?.finished ?? false,
        },
      };
    });
  }, [architecture, frame, bottlenecks, animate, selection, validation]);

  const onNodesChange = useCallback(
    (changes: NodeChange<ComponentFlowNode>[]) => {
      for (const change of changes) {
        if (change.type === 'position' && change.position && !locked) {
          dispatch({ type: 'moveNode', id: change.id, position: change.position });
        } else if (change.type === 'remove' && !locked) {
          dispatch({ type: 'removeNode', id: change.id });
          onSelect(null);
        } else if (change.type === 'select' && change.selected) {
          onSelect({ type: 'node', id: change.id });
        }
      }
    },
    [dispatch, locked, onSelect],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<TrafficEdge>[]) => {
      for (const change of changes) {
        if (change.type === 'remove' && !locked) {
          dispatch({ type: 'removeEdge', id: change.id });
          onSelect(null);
        } else if (change.type === 'select' && change.selected) {
          onSelect({ type: 'edge', id: change.id });
        }
      }
    },
    [dispatch, locked, onSelect],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      onConnectAttempt(connection.source, connection.target);
    },
    [onConnectAttempt],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onPaneClick={() => onSelect(null)}
      nodesDraggable={!locked}
      nodesConnectable={!locked}
      elementsSelectable
      deleteKeyCode={locked ? null : ['Backspace', 'Delete']}
      minZoom={0.35}
      maxZoom={1.6}
      // Double-click zooms toward the click point, which quietly walks the
      // design off-screen when you are just clicking blocks to select them.
      // Nothing in this app needs double-click, so it is off.
      zoomOnDoubleClick={false}
      fitView
      fitViewOptions={{ padding: 0.22, maxZoom: 1 }}
      proOptions={{ hideAttribution: true }}
      aria-label="Architecture canvas"
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="var(--line-strong)" />
      <Controls showInteractive={false} />
      <Panel position="top-right">
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => void fitView({ padding: 0.22, maxZoom: 1, duration: 240 })}
          title="Bring the whole design back into view"
        >
          ⤢ Fit design
        </button>
      </Panel>
    </ReactFlow>
  );
}
