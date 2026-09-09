import { useMemo } from 'react';
import { KINDS, runArchitecture, type Challenge } from '../sim';
import { Modal } from './Modal';

const fmt = new Intl.NumberFormat('en-US');

/**
 * Shown only when asked for. The numbers quoted here are produced by running
 * the example through the same engine, at display time — they cannot drift away
 * from what the learner would actually see.
 */
export function ExampleModal({
  challenge,
  onLoad,
  onClose,
}: {
  challenge: Challenge;
  onLoad: () => void;
  onClose: () => void;
}) {
  const { architecture, name, explanation } = challenge.exampleSolution;
  const result = useMemo(() => runArchitecture(architecture, challenge), [architecture, challenge]);
  const m = result.metrics;

  const counts = new Map<string, number>();
  for (const node of architecture.nodes) counts.set(node.kind, (counts.get(node.kind) ?? 0) + 1);

  return (
    <Modal
      title="One example solution"
      subtitle="This is not the answer — it is an answer. Several quite different designs pass."
      onClose={onClose}
      footer={
        <>
          <span className="tiny muted" style={{ marginRight: 'auto' }}>
            Loading this replaces what is on your canvas.
          </span>
          <button type="button" className="btn" onClick={onClose}>
            Keep my design
          </button>
          <button type="button" className="btn btn-primary" onClick={onLoad}>
            Load it onto the canvas
          </button>
        </>
      }
    >
      <section>
        <h3 style={{ fontSize: 14 }}>{name}</h3>
        <p className="tiny">{explanation}</p>
        <div className="bars" style={{ marginTop: 10 }}>
          {[...counts]
            .filter(([kind]) => kind !== 'client')
            .map(([kind, count]) => (
              <div key={kind} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                <span>
                  <span className="legend-swatch" style={{ background: `var(--k-${kind})` }} aria-hidden />
                  {KINDS[kind as keyof typeof KINDS].name}
                </span>
                <span className="mono">×{count}</span>
              </div>
            ))}
        </div>
      </section>

      <section>
        <h3 style={{ fontSize: 14 }}>What it scores</h3>
        <div className="bars">
          <Row label="Answered" value={`${fmt.format(m.completed)} of ${fmt.format(m.generated)} (${(m.successRate * 100).toFixed(2)}%)`} />
          <Row label="Rejected / timed out" value={`${fmt.format(m.failed)} / ${fmt.format(m.timedOut)}`} />
          <Row label="p95 latency" value={`${Math.round(m.latency.p95)} ms`} />
          <Row label="Cache hit rate" value={m.cache ? `${(m.cache.hitRate * 100).toFixed(1)}%` : 'no cache'} />
          <Row label="Storage queries" value={`${fmt.format(m.database.served)} at ${Math.round(m.database.utilization * 100)}% load`} />
        </div>
        <p className="tiny muted" style={{ marginTop: 8 }}>
          Measured by running this design through the same engine your own runs use.
        </p>
      </section>

      <section>
        <h3 style={{ fontSize: 14 }}>Other ways to pass</h3>
        <ul className="tiny" style={{ paddingLeft: 18, display: 'grid', gap: 5 }}>
          <li>
            <strong>Spread the reads instead of avoiding them.</strong> Add read replicas next to the
            database and connect your application servers to all of them. With no cache at all, enough read
            capacity also clears the bar — at a higher relative cost.
          </li>
          <li>
            <strong>One application server plus a cache.</strong> The load balancer is not strictly
            necessary here; the cheapest passing designs are usually smaller than people expect.
          </li>
          <li>
            <strong>Buy a bigger database.</strong> Raising the database's concurrent queries far enough
            passes too, and is the most expensive route. Worth trying, to feel why.
          </li>
        </ul>
      </section>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
      <span className="muted">{label}</span>
      <span className="mono" style={{ fontWeight: 600 }}>
        {value}
      </span>
    </div>
  );
}
