import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react';

export interface FlowEdgeData extends Record<string, unknown> {
  rate: number;
  traversals: number;
  hot: boolean;
  accent: string;
  animate: boolean;
  finished: boolean;
}

export type TrafficEdge = Edge<FlowEdgeData, 'traffic'>;

const fmt = new Intl.NumberFormat('en-US');

/**
 * Traffic is drawn as an *aggregate*: stroke weight and a handful of moving dots
 * stand in for the measured requests-per-second on this connection. Ten
 * thousand individual requests are never rendered — the rate is real, the dots
 * are a sample of it.
 */
export function FlowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps<TrafficEdge>) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const rate = data?.rate ?? 0;
  const hot = data?.hot ?? false;
  const accent = data?.accent ?? 'var(--line-strong)';
  const animate = data?.animate ?? false;
  const width = rate > 0 ? 1.6 + Math.min(4.4, rate / 420) : 1.4;
  const dots = animate && rate >= 1 ? Math.min(6, Math.max(1, Math.round(rate / 260))) : 0;
  const duration = Math.max(0.75, 2.4 - Math.min(1.5, rate / 900));

  const label = data?.finished
    ? data.traversals > 0
      ? `${fmt.format(data.traversals)} total`
      : 'unused'
    : rate >= 1
      ? `${fmt.format(Math.round(rate))}/s`
      : null;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: rate > 0 ? (hot ? 'var(--bad)' : accent) : 'var(--line-strong)',
          strokeWidth: selected ? width + 1.4 : width,
          opacity: rate > 0 ? 0.95 : 0.6,
        }}
      />
      {Array.from({ length: dots }, (_, i) => (
        <circle key={i} r={3.1} fill={hot ? 'var(--bad)' : accent}>
          <animateMotion
            dur={`${duration}s`}
            repeatCount="indefinite"
            path={path}
            begin={`-${((i * duration) / dots).toFixed(2)}s`}
          />
        </circle>
      ))}
      {label && (
        <EdgeLabelRenderer>
          <div
            className={`edge-label${hot ? ' hot' : ''}`}
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
