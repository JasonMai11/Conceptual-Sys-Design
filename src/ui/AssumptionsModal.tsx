import type { Challenge } from '../sim';
import { Modal } from './Modal';

const fmt = new Intl.NumberFormat('en-US');

/** Plain statement of what the model does and does not do. */
export function AssumptionsModal({ challenge, onClose }: { challenge: Challenge; onClose: () => void }) {
  const w = challenge.workload;
  return (
    <Modal
      title="How this simulation works"
      subtitle="What is modelled, how the numbers are produced, and what is deliberately left out."
      onClose={onClose}
      footer={
        <button type="button" className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={onClose}>
          Got it
        </button>
      }
    >
      <section>
        <h3 style={{ fontSize: 14 }}>The model</h3>
        <p className="tiny">
          It is a discrete-event simulation. Every arrival, service completion, response, and timeout is an
          event on a queue ordered by simulated time, with ties broken by insertion order — so a run is a
          total order of events and is reproducible exactly.
        </p>
        <ul className="tiny" style={{ paddingLeft: 18, display: 'grid', gap: 5 }}>
          <li>
            <strong>Arrivals.</strong> {fmt.format(w.requestsPerSecond.reduce((a, b) => a + b, 0))} requests
            over {w.requestsPerSecond.length} simulated seconds, evenly spaced inside each second according
            to that second's rate.
          </li>
          <li>
            <strong>Requested products.</strong> Drawn from a Zipf distribution (exponent {w.zipfExponent})
            over {fmt.format(w.catalogSize)} IDs using seed {w.seed}. The same seed always produces the same
            sequence, so two designs face identical traffic.
          </li>
          <li>
            <strong>Service and concurrency.</strong> Each component serves a fixed number of requests at
            once. A component holds its slot for the whole time a request is in its care —{' '}
            <em>including while it waits for something downstream</em>. That is why a slow database keeps
            application workers busy.
          </li>
          <li>
            <strong>Queues.</strong> Each component has a bounded FIFO queue. When it is full, an arriving
            request is rejected immediately and that rejection travels straight back up to the client,
            freeing every caller that was waiting on it.
          </li>
          <li>
            <strong>Load balancing.</strong> Round robin takes strict turns; least-busy picks the server
            with the fewest requests in flight plus queued, breaking ties toward the first connection.
          </li>
          <li>
            <strong>Cache.</strong> Read-through. A hit answers from memory. A miss fetches from the
            connected database or replica, stores the answer, then replies. Eviction is least-recently-used
            or first-in-first-out, your choice. It starts empty.
          </li>
          <li>
            <strong>Timeouts.</strong> A request abandoned at {(w.requestTimeoutMs / 1000).toFixed(1)} s
            frees every component that was merely <em>waiting</em> for it. A component already mid-work
            finishes that work and discards the answer — cancelling a query in flight would flatter the
            design.
          </li>
          <li>
            <strong>End of run.</strong> The clock stops {challenge.maxDrainMs / 1000} s after the last
            arrival at the latest. Anything unresolved then is counted as a timeout, so{' '}
            <code>answered + rejected + timed out</code> always equals the number of requests generated.
          </li>
        </ul>
      </section>

      <section>
        <h3 style={{ fontSize: 14 }}>How the numbers are calculated</h3>
        <ul className="tiny" style={{ paddingLeft: 18, display: 'grid', gap: 5 }}>
          <li>
            <strong>Latency</strong> is measured end to end: from the moment a request arrives to the moment
            its answer reaches the client, including all queueing and both directions of every network hop.
          </li>
          <li>
            <strong>p95</strong> is nearest-rank over answered requests — the smallest latency at or below
            which 95% of them landed, with no interpolation, so it is always a latency some request really
            experienced. Rejections and timeouts are reported as their own counts rather than folded in. A
            second figure, <em>p95 including failures</em>, counts every finished request (a failure at the
            moment it failed) so a design cannot look fast by dropping its slowest traffic.
          </li>
          <li>
            <strong>Utilisation</strong> is time-weighted: busy-slot-time divided by (elapsed simulated time
            × concurrency). The live number on a block uses the last second only; the results panel uses the
            whole run.
          </li>
          <li>
            <strong>Traffic animation</strong> is aggregated, not per-request. Stroke width and the moving
            dots represent the measured requests per second on a connection; drawing ten thousand
            individual requests would tell you less and cost more.
          </li>
        </ul>
      </section>

      <section>
        <h3 style={{ fontSize: 14 }}>Not modelled</h3>
        <p className="tiny">
          These are real and important. They are simply not in this challenge, and nothing you see here can
          tell you about them:
        </p>
        <ul className="tiny" style={{ paddingLeft: 18, display: 'grid', gap: 5 }}>
          <li>
            <strong>Writes and consistency.</strong> This catalog is read-only. There is no cache
            invalidation, no replication lag, no write contention. Cached data cannot be stale here because
            nothing changes it.
          </li>
          <li>
            <strong>Failures.</strong> Nothing crashes, no network partitions, no retries, no
            circuit-breakers, no cold-start latency, no garbage collection pauses.
          </li>
          <li>
            <strong>Variability.</strong> Service times are fixed per component rather than drawn from a
            distribution, and arrivals are evenly spaced within a second rather than bursty. Real systems
            have long tails that this understates.
          </li>
          <li>
            <strong>Request coalescing.</strong> Two simultaneous misses for the same product make two
            database queries. Real caches often collapse them; this one does not, which makes cold starts
            look worse than they might.
          </li>
          <li>
            <strong>Cost.</strong> Relative cost units compare designs against each other. They are not
            money and not any provider's pricing.
          </li>
          <li>
            <strong>Real services.</strong> Where a block mentions an AWS equivalent, it is an analogy to
            help you carry the idea across. A block here does not reproduce that service's actual
            behaviour, limits, or performance.
          </li>
        </ul>
      </section>
    </Modal>
  );
}
