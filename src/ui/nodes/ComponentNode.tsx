import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { KINDS, type ArchNode, type NodeRuntimeState } from '../../sim';
import { Art } from '../Art';

export interface ComponentNodeData extends Record<string, unknown> {
  archNode: ArchNode;
  runtime: NodeRuntimeState | null;
  isBottleneck: boolean;
  issue: 'error' | 'warning' | null;
  animate: boolean;
  selected: boolean;
}

export type ComponentFlowNode = Node<ComponentNodeData, 'component'>;

const fmt = new Intl.NumberFormat('en-US');

/**
 * One building block on the canvas. Everything it shows about the run comes
 * from the simulation's own state — utilisation, queue depth, hit rate — and
 * every colour is paired with a number or a word so the meaning survives
 * without it.
 */
export function ComponentNode({ data }: NodeProps<ComponentFlowNode>) {
  const { archNode, runtime, isBottleneck, issue, animate, selected } = data;
  const spec = KINDS[archNode.kind];
  const accent = `var(--k-${archNode.kind})`;
  const isClient = archNode.kind === 'client';
  const isStorage = archNode.kind === 'database' || archNode.kind === 'replica';

  const util = runtime?.utilization ?? 0;
  const utilClass = util >= 0.85 ? 'hot' : util >= 0.6 ? 'warm' : '';
  const queue = runtime?.queueDepth ?? 0;
  const queueRatio = runtime && runtime.queueCapacity > 0 ? queue / runtime.queueCapacity : 0;

  const bottleneckReason = !runtime
    ? null
    : runtime.rejected > 0
      ? 'Rejecting'
      : queueRatio >= 0.4
        ? 'Queue filling'
        : util >= 0.85
          ? 'Saturated'
          : null;

  return (
    <div
      className={[
        'node',
        selected ? 'node-selected' : '',
        isBottleneck && bottleneckReason ? 'is-bottleneck' : '',
        animate ? 'animate' : '',
        isClient ? 'no-inputs' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ ['--accent' as string]: accent }}
    >
      {isBottleneck && bottleneckReason && (
        <span className="bottleneck-tag">⚠ {bottleneckReason}</span>
      )}
      {issue && <span className={`node-issue${issue === 'error' ? ' error' : ''}`}>{issue === 'error' ? 'Fix me' : 'Check'}</span>}

      {!isClient && <Handle type="target" position={Position.Left} isConnectable={!isStorage ? true : true} />}
      {!isStorage && <Handle type="source" position={Position.Right} />}

      <div className="node-head">
        <span className="node-art" style={{ color: accent }}>
          <Art kind={archNode.kind} size={30} />
        </span>
        <span style={{ minWidth: 0 }}>
          <div className="node-name">{archNode.label}</div>
          <div className="node-kind">{spec.name}</div>
        </span>
      </div>

      <div className="node-body">
        {isClient ? (
          <div className="node-stats">
            <span className="stat">
              {runtime ? `${fmt.format(Math.round(runtime.arrivalRate))} req/s now` : 'Idle'}
            </span>
            <span className="stat">{runtime ? `${fmt.format(runtime.arrived)} sent` : 'Press Run'}</span>
          </div>
        ) : (
          <>
            <div className="meter">
              <div className="meter-top">
                <span>{isStorage ? 'Queries in flight' : 'Capacity used'}</span>
                <span>
                  {runtime ? `${Math.round(util * 100)}%` : '—'}
                  {runtime ? ` · ${runtime.busy}/${runtime.concurrency}` : ''}
                </span>
              </div>
              <div className="meter-track">
                <div className={`meter-fill ${utilClass}`} style={{ width: `${Math.round(util * 100)}%` }} />
              </div>
            </div>

            <div className="node-stats">
              <span className={`stat${queueRatio >= 0.75 ? ' bad' : queueRatio >= 0.4 ? ' warn' : ''}`}>
                Queue {fmt.format(queue)}/{fmt.format(runtime?.queueCapacity ?? 0)}
              </span>
              {archNode.kind === 'cache' && runtime && (
                <span className={`stat${hitRate(runtime) >= 0.7 ? ' good' : ''}`}>
                  Hits {Math.round(hitRate(runtime) * 100)}%
                </span>
              )}
              {archNode.kind === 'cache' && runtime && (
                <span className="stat">{fmt.format(runtime.cacheEntries ?? 0)} held</span>
              )}
              {runtime && runtime.rejected > 0 && (
                <span className="stat bad">{fmt.format(runtime.rejected)} rejected</span>
              )}
              {runtime && runtime.rejected === 0 && archNode.kind !== 'cache' && (
                <span className="stat">{fmt.format(runtime.completed)} done</span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function hitRate(runtime: NodeRuntimeState): number {
  const total = (runtime.cacheHits ?? 0) + (runtime.cacheMisses ?? 0);
  return total === 0 ? 0 : (runtime.cacheHits ?? 0) / total;
}
