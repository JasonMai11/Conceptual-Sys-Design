import { KINDS, type Challenge, type Evaluation, type Frame, type RunResult } from '../sim';
import type { Phase } from '../state/useSimulation';

const fmt = new Intl.NumberFormat('en-US');

interface Props {
  evaluation: Evaluation;
  phase: Phase;
  frame: Frame | null;
  lastResult: RunResult | null;
  challenge: Challenge;
  stale: boolean;
}

/**
 * The explanation half of the loop: what happened, why, and what to try next —
 * assembled by rule from the run's own numbers (see `src/sim/evaluate.ts`).
 */
export function ResultsPanel({ evaluation, phase, frame, lastResult, challenge, stale }: Props) {
  if (phase === 'running' || phase === 'paused') {
    return (
      <div className="panel">
        <div className="eyebrow">Run in progress</div>
        <p className="tiny muted">
          Watch the canvas: line thickness is the measured request rate, and a block tagged{' '}
          <strong>⚠</strong> is either saturated, filling its queue, or turning requests away. The full
          explanation appears when the run finishes.
        </p>
        {frame && <LiveSnapshot frame={frame} challenge={challenge} />}
      </div>
    );
  }

  return (
    <>
      <div className="panel">
        {stale && lastResult && (
          <div className="pill pill-muted" style={{ marginBottom: 10 }}>
            From your last run — press Run to test the current design
          </div>
        )}
        <div className={`verdict verdict-${evaluation.verdict}`}>
          <h3>{evaluation.headline}</h3>
          {evaluation.criteria.length > 0 && (
            <ul className="criteria-list" style={{ marginTop: 10 }}>
              {evaluation.criteria.map((c) => (
                <li key={c.label}>
                  <span
                    className="criteria-mark"
                    style={{ color: c.met ? 'var(--good)' : 'var(--bad)' }}
                  >
                    {c.met ? '✓' : '✕'}
                  </span>
                  <span>
                    <strong>{c.label}</strong>
                    <br />
                    <span className="muted">{c.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {evaluation.evidence.length > 0 && (
        <div className="panel">
          <div className="eyebrow">What happened</div>
          <ul className="evidence">
            {evaluation.evidence.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      {lastResult && !stale && <ThroughputChart result={lastResult} />}
      {lastResult && !stale && <ComponentTable result={lastResult} />}

      {evaluation.suggestions.length > 0 && (
        <div className="panel">
          <div className="eyebrow">What to try next</div>
          <ul className="evidence suggestions">
            {evaluation.suggestions.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      {evaluation.tradeoffs.length > 0 && (
        <div className="panel">
          <div className="eyebrow">Tradeoffs worth knowing</div>
          <p className="tiny muted">
            Context about the real world. These are <em>not</em> effects this challenge simulates — the run
            above cannot show them.
          </p>
          <ul className="evidence tradeoffs">
            {evaluation.tradeoffs.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function LiveSnapshot({ frame, challenge }: { frame: Frame; challenge: Challenge }) {
  const m = frame.metrics;
  const hot = frame.nodes.filter((n) => frame.bottlenecks.includes(n.id));
  return (
    <div className="card">
      <div className="bars">
        <Row label="Simulated time" value={`${(m.simTimeMs / 1000).toFixed(2)} s`} />
        <Row label="Answered" value={fmt.format(m.completed)} />
        <Row label="Lost so far" value={fmt.format(m.failed + m.timedOut)} />
        <Row label="In flight" value={fmt.format(m.inFlight)} />
        <Row
          label="Storage load"
          value={`${Math.round(m.database.utilization * 100)}% of ${challenge.criteria.forbidDatabaseOverflow ? 'capacity' : 'capacity'}`}
        />
      </div>
      {hot.length > 0 && (
        <p className="tiny" style={{ marginTop: 9, color: 'var(--bad)' }}>
          Under pressure now: {hot.map((n) => n.id).join(', ')}
        </p>
      )}
    </div>
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

function ThroughputChart({ result }: { result: RunResult }) {
  const answered = result.metrics.throughputPerSecond;
  const arrived = result.workloadPerSecond;
  const seconds = Math.max(answered.length, arrived.length);
  const peak = Math.max(1, ...arrived, ...answered);

  return (
    <div className="panel">
      <div className="eyebrow">Answered vs arrived, per second</div>
      <div
        className="chart"
        role="img"
        aria-label={`Per second: ${Array.from({ length: seconds }, (_, i) => `second ${i + 1}, ${arrived[i] ?? 0} arrived, ${answered[i] ?? 0} answered`).join('; ')}`}
      >
        {Array.from({ length: seconds }, (_, i) => {
          const a = arrived[i] ?? 0;
          const done = answered[i] ?? 0;
          return (
            <span className="chart-col" key={i} title={`Second ${i + 1}: ${a} arrived, ${done} answered`}>
              <span
                className="chart-seg arrived"
                style={{ height: `${(a / peak) * 100}%`, background: 'var(--line-strong)' }}
              />
              <span
                className="chart-seg answered"
                style={{ height: `${(done / peak) * 100}%`, background: 'var(--k-appServer)' }}
              />
            </span>
          );
        })}
      </div>
      <div className="chart-legend">
        <span>
          <span className="legend-swatch" style={{ background: 'var(--line-strong)' }} />
          Arrived
        </span>
        <span>
          <span className="legend-swatch" style={{ background: 'var(--k-appServer)' }} />
          Answered
        </span>
        <span className="muted">
          Bars past second {result.workloadPerSecond.length} are the drain: requests answered after the
          last one arrived.
        </span>
      </div>
    </div>
  );
}

function ComponentTable({ result }: { result: RunResult }) {
  const rows = result.nodes.filter((n) => n.kind !== 'client');
  return (
    <div className="panel">
      <div className="eyebrow">Per component</div>
      <div className="bars">
        {rows.map((n) => (
          <div key={n.id} style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
              <span style={{ fontWeight: 600 }}>
                <span className="legend-swatch" style={{ background: `var(--k-${n.kind})` }} aria-hidden />
                {n.label}
              </span>
              <span className="mono muted">{KINDS[n.kind].name}</span>
            </div>
            <div className="bar-row">
              <span className="muted">Capacity used</span>
              <span className="bar-track">
                <span
                  className="bar-fill"
                  style={{
                    width: `${Math.round(n.utilization * 100)}%`,
                    background: n.utilization >= 0.85 ? 'var(--bad)' : `var(--k-${n.kind})`,
                  }}
                />
              </span>
              <span className="bar-num">{Math.round(n.utilization * 100)}%</span>
            </div>
            <div className="tiny muted numeric">
              {fmt.format(n.completed)} handled · peak queue {fmt.format(n.peakQueue)}/
              {fmt.format(n.queueCapacity)} · mean queue {n.meanQueueDepth.toFixed(1)}
              {n.rejected > 0 && (
                <span style={{ color: 'var(--bad)' }}> · {fmt.format(n.rejected)} rejected</span>
              )}
              {n.hitRate !== undefined && ` · ${Math.round(n.hitRate * 100)}% hit rate`}
              {n.capacityPerSecond !== undefined &&
                ` · ceiling ≈ ${fmt.format(Math.round(n.capacityPerSecond))}/s`}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
