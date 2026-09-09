import { useMemo } from 'react';
import { KINDS, summarizeWorkload, type Challenge, type RunResult } from '../sim';
import { Tooltip } from './Tooltip';

const fmt = new Intl.NumberFormat('en-US');

/** Read a component default straight from the catalog so copy cannot drift. */
function def_(kind: keyof typeof KINDS, key: string): number {
  const field = KINDS[kind].fields.find((f) => f.key === key);
  return field && field.type === 'number' ? field.default : 0;
}

interface Props {
  challenge: Challenge;
  lastResult: RunResult | null;
  onShowExample: () => void;
  onRestore: () => void;
  onClear: () => void;
  /** False when the canvas is already back to just the traffic source. */
  canClear: boolean;
  locked: boolean;
}

/** States the problem, the numbers, and the bar to clear — all of it explicit. */
export function ChallengePanel({
  challenge,
  lastResult,
  onShowExample,
  onRestore,
  onClear,
  canClear,
  locked,
}: Props) {
  const w = useMemo(() => summarizeWorkload(challenge), [challenge]);
  const m = lastResult?.metrics;
  const c = challenge.criteria;

  const criteria = [
    {
      label: `${Math.round(c.minSuccessRate * 100)}% of requests answered`,
      met: m ? m.successRate >= c.minSuccessRate : null,
      actual: m ? `${(m.successRate * 100).toFixed(2)}%` : null,
    },
    {
      label: `p95 latency under ${c.maxP95LatencyMs} ms`,
      met: m ? m.latency.p95 <= c.maxP95LatencyMs : null,
      actual: m ? `${Math.round(m.latency.p95)} ms` : null,
    },
    {
      label: 'No database queue overflow',
      met: m ? m.database.overflowed === 0 : null,
      actual: m ? (m.database.overflowed === 0 ? 'none' : `${fmt.format(m.database.overflowed)} dropped`) : null,
    },
  ];

  return (
    <div className="panel">
      <div>
        <div className="eyebrow">Challenge 1 of 1</div>
        <h2 className="challenge-title">{challenge.title}</h2>
        <p className="challenge-tagline" style={{ marginTop: 4 }}>
          {challenge.tagline}
        </p>
      </div>

      <div className="spec-grid">
        <div className="spec">
          <div className="spec-label">Requests</div>
          <div className="spec-value">{fmt.format(w.total)}</div>
          <div className="spec-note">over {w.seconds} simulated seconds</div>
        </div>
        <div className="spec">
          <div className="spec-label">Peak rate</div>
          <div className="spec-value">{fmt.format(w.peakRps)}/s</div>
          <div className="spec-note">in second {w.peakSecond + 1}</div>
        </div>
        <div className="spec">
          <div className="spec-label">Catalog</div>
          <div className="spec-value">{fmt.format(w.catalogSize)}</div>
          <div className="spec-note">distinct product IDs</div>
        </div>
        <div className="spec">
          <div className="spec-label">Give-up time</div>
          <div className="spec-value">{(w.timeoutMs / 1000).toFixed(1)}s</div>
          <div className="spec-note">then counted as a timeout</div>
        </div>
      </div>

      <div>
        <div className="eyebrow" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          Arrival pattern
          <Tooltip label="the arrival pattern">
            Requests per simulated second. Within each second arrivals are evenly spaced, so the traffic
            is identical on every run — the only thing that changes between runs is your design.
          </Tooltip>
        </div>
        <div className="arrival-chart" style={{ marginTop: 6 }} role="img"
          aria-label={`Arrivals per second: ${w.perSecond.map((v, i) => `second ${i + 1}, ${v}`).join('; ')}`}>
          {w.perSecond.map((v, i) => (
            <div
              key={i}
              className={`arrival-bar${v === w.peakRps ? ' peak' : ''}`}
              style={{ height: `${(v / w.peakRps) * 100}%` }}
              title={`Second ${i + 1}: ${fmt.format(v)} requests`}
            />
          ))}
        </div>
        <div className="arrival-axis">
          <span>1s</span>
          <span>mean {fmt.format(Math.round(w.meanRps))}/s</span>
          <span>{w.seconds}s</span>
        </div>
      </div>

      {challenge.briefing.map((para, i) => (
        <p key={i} className="tiny" style={{ color: 'var(--ink-2)', fontSize: 12.5 }}>
          {para}
        </p>
      ))}

      <div>
        <div className="eyebrow" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          Which products get asked for
          <Tooltip label="the request distribution">
            A Zipf distribution: rank a product by popularity and its share of traffic falls off roughly
            as one over that rank. It is the shape real catalogs, search terms and page views tend to
            follow, and it is why a small cache can cover most of the traffic.
          </Tooltip>
        </div>
        <div className="bars" style={{ marginTop: 7 }}>
          {[
            { label: 'Top 10 IDs', share: w.shares.top10 },
            { label: 'Top 50 IDs', share: w.shares.top50 },
            { label: 'Top 250 IDs', share: w.shares.top250 },
            { label: 'Top 500 IDs', share: w.shares.top500 },
          ].map((row) => (
            <div className="bar-row" key={row.label}>
              <span className="muted">{row.label}</span>
              <span className="bar-track">
                <span
                  className="bar-fill"
                  style={{ width: `${row.share * 100}%`, background: 'var(--k-cache)' }}
                />
              </span>
              <span className="bar-num">{(row.share * 100).toFixed(0)}%</span>
            </div>
          ))}
        </div>
        <p className="tiny muted" style={{ marginTop: 6 }}>
          Zipf distribution (exponent {challenge.workload.zipfExponent}), seed {w.seed}. Deterministic:
          the same seed always produces the same sequence of product IDs.
        </p>
      </div>

      <div>
        <div className="eyebrow">Passing criteria</div>
        <ul className="criteria-list" style={{ marginTop: 7 }}>
          {criteria.map((row) => (
            <li key={row.label}>
              <span
                className="criteria-mark"
                style={{ color: row.met === null ? 'var(--ink-3)' : row.met ? 'var(--good)' : 'var(--bad)' }}
              >
                {row.met === null ? '○' : row.met ? '✓' : '✕'}
              </span>
              <span>
                {row.label}
                {row.actual && (
                  <span className="muted numeric"> — last run: {row.actual}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <details className="disclosure">
        <summary>Starting capacities</summary>
        <div className="disclosure-body">
          <p>
            <strong>Database:</strong> {def_('database', 'concurrency')} queries at a time,{' '}
            {def_('database', 'serviceTimeMs')} ms each — about{' '}
            {fmt.format(Math.round((def_('database', 'concurrency') / def_('database', 'serviceTimeMs')) * 1000))}{' '}
            queries per second. Queue holds {fmt.format(def_('database', 'queueCapacity'))} waiting queries;
            past that, queries are rejected.
          </p>
          <p>
            <strong>Application server:</strong> {def_('appServer', 'concurrency')} workers,{' '}
            {def_('appServer', 'processingMs')} ms of its own compute per request, queue of{' '}
            {fmt.format(def_('appServer', 'queueCapacity'))}. A worker stays busy while it waits for data.
          </p>
          <p>
            <strong>Cache (if you add one):</strong> {fmt.format(def_('cache', 'capacityEntries'))} products
            held, {def_('cache', 'hitLatencyMs')} ms to answer a hit, least recently used entry evicted
            first. It starts <strong>cold</strong> — empty — so the beginning of the spike gets no help from
            it.
          </p>
          <p>
            <strong>Read replica (if you add one):</strong> same capacity as the database, serving the same
            catalog.
          </p>
          <p>
            <strong>Drain window:</strong> the run stops {challenge.maxDrainMs / 1000} s after the last
            request arrives at the latest. Anything still unanswered then is counted as a timeout.
          </p>
          <p className="muted">
            These are educational scenario parameters chosen to make the tradeoffs visible. They are not
            measurements of any real database or cloud service.
          </p>
        </div>
      </details>

      <details className="disclosure">
        <summary>Ground rules for this challenge</summary>
        <div className="disclosure-body">
          <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
            {challenge.scenarioRules.map((rule, i) => (
              <li key={i}>{rule}</li>
            ))}
          </ul>
        </div>
      </details>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn btn-sm"
          onClick={onRestore}
          disabled={locked}
          title="Put the original client → application server → database design back"
        >
          Restore starting design
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={onClear}
          disabled={locked || !canClear}
          title={
            canClear
              ? 'Remove every block and connection except the traffic source, and build again from scratch'
              : 'The canvas is already empty'
          }
        >
          Clear canvas
        </button>
        <button type="button" className="btn btn-sm" onClick={onShowExample}>
          Show an example solution
        </button>
      </div>
      <p className="tiny muted">
        Both of these can be undone from the message that appears, so nothing is lost by trying
        something and starting over.
      </p>
    </div>
  );
}
