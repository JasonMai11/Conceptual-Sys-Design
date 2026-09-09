import type { Challenge, Frame } from '../sim';
import { Tooltip } from './Tooltip';

const fmt = new Intl.NumberFormat('en-US');

interface Props {
  frame: Frame | null;
  challenge: Challenge;
  totalRequests: number;
}

/** Live readout. Every value is read straight off the simulation's own state. */
export function MetricsStrip({ frame, challenge, totalRequests }: Props) {
  const m = frame?.metrics;
  const deepest = (frame?.nodes ?? [])
    .filter((n) => n.kind !== 'client')
    .reduce<{ id: string; depth: number; cap: number } | null>((best, n) => {
      if (!best || n.queueDepth > best.depth) return { id: n.id, depth: n.queueDepth, cap: n.queueCapacity };
      return best;
    }, null);

  const p95 = m?.latency.p95 ?? 0;
  const errors = (m?.failed ?? 0) + (m?.timedOut ?? 0);

  return (
    <div className="metrics-strip">
      <Metric
        label="Answered"
        value={m ? fmt.format(m.completed) : '—'}
        sub={m ? `of ${fmt.format(totalRequests)} · ${(m.successRate * 100).toFixed(1)}%` : 'press Run'}
        tone={m && m.completed > 0 ? 'good' : undefined}
      />
      <Metric
        label="Rejected"
        value={m ? fmt.format(m.failed) : '—'}
        sub="queue was full"
        tone={m && m.failed > 0 ? 'bad' : undefined}
        tip="A request rejected outright because the component it reached had no room left in its queue. Counted separately from timeouts so failures cannot hide inside an average."
      />
      <Metric
        label="Timed out"
        value={m ? fmt.format(m.timedOut) : '—'}
        sub={`waited > ${(challenge.workload.requestTimeoutMs / 1000).toFixed(1)}s`}
        tone={m && m.timedOut > 0 ? 'bad' : undefined}
      />
      <Metric
        label="p95 latency"
        value={m ? `${Math.round(p95)} ms` : '—'}
        sub={`target < ${challenge.criteria.maxP95LatencyMs} ms`}
        tone={m && m.completed > 0 ? (p95 <= challenge.criteria.maxP95LatencyMs ? 'good' : 'bad') : undefined}
        tip="Nearest-rank p95 over requests that were answered: the smallest latency at or below which 95% of answered requests landed. Rejected and timed-out requests are counted in their own columns instead of being folded in here."
      />
      <Metric
        label="Deepest queue"
        value={deepest ? fmt.format(deepest.depth) : '—'}
        sub={deepest ? `${deepest.id} · cap ${fmt.format(deepest.cap)}` : 'nothing waiting'}
        tone={deepest && deepest.cap > 0 && deepest.depth / deepest.cap > 0.5 ? 'warn' : undefined}
      />
      <Metric
        label="Cache hits"
        value={m?.cache ? `${(m.cache.hitRate * 100).toFixed(0)}%` : 'no cache'}
        sub={m?.cache ? `${fmt.format(m.cache.hits)} hit · ${fmt.format(m.cache.misses)} miss` : 'reads go straight to storage'}
        tone={m?.cache && m.cache.hitRate >= 0.7 ? 'good' : undefined}
        tip="Share of the reads a cache saw that it could answer from memory. Only the misses turn into storage queries."
      />
      <Metric
        label="Storage load"
        value={m ? `${Math.round(m.database.utilization * 100)}%` : '—'}
        sub={m ? `${fmt.format(m.database.served)} queries · peak queue ${fmt.format(m.database.peakQueueDepth)}` : ''}
        tone={m ? (m.database.utilization >= 0.9 ? 'bad' : m.database.utilization >= 0.7 ? 'warn' : undefined) : undefined}
      />
      <Metric
        label="In flight"
        value={m ? fmt.format(m.inFlight) : '—'}
        sub={m && errors > 0 ? `${fmt.format(errors)} lost so far` : 'being handled now'}
      />
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
  tone,
  tip,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'good' | 'bad' | 'warn';
  tip?: string;
}) {
  return (
    <div className={`metric${tone ? ` is-${tone}` : ''}`}>
      <div className="metric-label">
        {label}
        {tip && <Tooltip label={label}>{tip}</Tooltip>}
      </div>
      <div className="metric-value">{value}</div>
      {sub && <div className="metric-sub">{sub}</div>}
    </div>
  );
}
