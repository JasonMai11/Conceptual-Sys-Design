# Conceptually

Learn system design by building it. You are handed a workload and a set of outcomes to
hit; you assemble an architecture out of building blocks, run simulated traffic through
it, and read what actually happened. Several very different designs pass — the app grades
the *behaviour it measured*, not your diagram.

The first challenge, **Survive the traffic spike**, sends 10,000 read requests at a
product catalog over 10 simulated seconds and asks you to keep the database alive.

---

## Install and run

Requires Node 18+ (developed on Node 20.10).

```bash
npm install
npm run dev        # http://localhost:5173
```

Other commands:

```bash
npm run build      # type-check (tsc -b) then production build to dist/
npm run preview    # serve the production build
npm test           # run the engine + validation + persistence test suites
npm run verify     # build and test together
```

---

## Playing the first challenge

1. **Read the brief** in the left rail. It states the exact arrival pattern (a bar per
   simulated second), how popular products are distributed, the starting capacities of
   every component, and the three criteria you have to clear.
2. **Press Run** (or <kbd>Space</kbd>). The starting design — shoppers → one application
   server → one database — collapses: about 1,363 of 10,000 requests are answered, the
   application server's queue fills and rejects 4,493, and 4,144 more give up waiting.
   The database sits at 99% utilisation the whole time, which is the tell.
3. **Read the Results tab.** It says which queue filled, how many requests died there,
   what the database's ceiling actually is, and what to try next. Every sentence is
   generated from numbers the run measured.
4. **Press Reset, change one thing, run again.** The usual first insight is that a cache
   in front of the database removes most reads before they become queries — a handful of
   products account for roughly half the traffic.
5. **Compare.** After a second run the results include a before/after line, so you can
   see whether your change actually helped or just moved the queue somewhere else.

If you get stuck, **Show an example solution** reveals one passing design (and three other
routes to a pass) with its real measured scores. **Restore starting design** puts you back
to the beginning.

### Passing criteria

| Criterion | Threshold |
| --- | --- |
| Requests answered | ≥ 99% of 10,000 |
| p95 latency | < 500 ms |
| Database queue overflow | none |

### Designs that pass, and one that does not

Verified by `tests/challenge.test.ts` on every test run:

| Design | Answered | p95 | Verdict |
| --- | --- | --- | --- |
| Client → app → database (the start) | 1,363 (13.6%) | 1,829 ms | fails |
| Client → app → **cache** → database | 10,000 (100%) | 116 ms | passes |
| Client → LB → 2 apps → **database + 4 read replicas** | 10,000 (100%) | 146 ms | passes |
| Client → LB → **4 apps** → database | 3,330 (33.3%) | 504 ms | fails: the database now overflows instead |

The two passing designs are genuinely different — one avoids reads, the other spreads
them — and they cost different amounts in relative units (10 vs 28).

### Controls

| | |
| --- | --- |
| <kbd>Space</kbd> | Run / pause |
| <kbd>S</kbd> | Step 250 simulated ms |
| <kbd>R</kbd> | Reset |
| <kbd>Delete</kbd> | Remove the selected block or connection |

Playback speed (0.5× to 10×) changes only how fast you watch. Everything is reachable from
the keyboard: palette entries are buttons, and connections can be made from the
**Connections** picker in the Inspector as well as by dragging between handles. Motion can
be switched off from the toolbar, and `prefers-reduced-motion` is respected by default.

---

## Simulation rules and assumptions

The app has an in-app **Assumptions** panel that says all of this; the short version:

### What is modelled

- **Discrete events.** Arrivals, service completions, responses and timeouts are events on
  a queue ordered by simulated time, with ties broken by insertion order. A run is a total
  order of events and is byte-for-byte reproducible.
- **Fixed workload.** 10,000 requests over 10 seconds on a published per-second schedule,
  evenly spaced within each second. Product IDs are drawn from a Zipf distribution
  (exponent 1.1) over 1,000 IDs from seed `20260908`, so two designs face identical
  traffic.
- **Blocking calls.** A component holds one unit of its own concurrency for the whole time
  a request is in its care, *including while it waits for something downstream*. This is
  why a slow database keeps application workers busy.
- **Bounded queues.** Each component has a FIFO queue with a capacity. When it is full an
  arriving request is rejected, and that rejection travels straight back to the client,
  freeing every caller that was waiting on it.
- **Routing.** One request follows exactly one path — nothing fans out, and no component
  sees the same request twice. Round robin takes strict turns; least-busy picks the fewest
  in-flight-plus-queued, ties going to the first connection. Responses return the way they
  came, paying the same network hop again.
- **Read-through cache.** A hit answers from memory. A miss fetches from the connected
  database or replica, stores the answer, then replies. LRU or FIFO eviction. Starts empty.
- **Timeouts.** A request abandoned at 2 s frees every component that was only *waiting*
  for it. A component already mid-work finishes and discards the answer — cancelling a
  query in flight would flatter the design.
- **Closing the books.** The clock stops at most 8 s after the last arrival. Anything
  unresolved is counted as a timeout, so `answered + rejected + timed out` always equals
  the number of requests generated. This is asserted in the tests.

### How the numbers are produced

- **Latency** is end to end: arrival to answer, including all queueing and both directions
  of every network hop.
- **p95** is nearest-rank over *answered* requests, so it is always a latency some request
  really experienced. Rejections and timeouts are reported as separate counts rather than
  folded in, and a second figure — *p95 including failures*, counting each failure at the
  moment it failed — is shown alongside so a design cannot look fast by dropping its
  slowest traffic.
- **Utilisation** is time-weighted: busy-slot-time ÷ (elapsed simulated time × concurrency).
  Blocks show the last second; the results panel shows the whole run.
- **Traffic animation is aggregated.** Stroke width and the moving dots represent the
  measured requests per second on a connection. Ten thousand individual requests are never
  drawn.

### What is *not* modelled

Writes and consistency (this catalog is read-only, so nothing can go stale), replication
lag, failures, retries, cold starts, GC pauses, service-time variability (times are fixed,
not sampled), and request coalescing (two simultaneous misses for the same product make
two queries). Component capacities are educational scenario parameters chosen to make
tradeoffs visible in ten seconds — they are not measurements of any real database or cloud
service. Where a block mentions an AWS equivalent it is an analogy only.

Costs are shown as **relative educational cost units** for comparing designs. They are not
money and not anyone's pricing.

---

## Code organisation

```
src/
  sim/            the simulation — plain TypeScript, no React, no DOM
    types.ts        data model: architecture, challenge, metrics, frames
    catalog.ts      the six component kinds: copy, config fields, defaults,
                    and the table of allowed connections
    rng.ts          seeded PRNG + Zipf sampler
    heap.ts         event-queue min-heap (time, then insertion order)
    buckets.ts      fixed-resolution time series for rates and utilisation
    routing.ts      compiles a canvas into an executable routing plan;
                    reachability and cycle detection
    validate.ts     static checks with learner-facing messages
    engine.ts       the discrete-event simulation
    challenges.ts   challenge definitions (workload, criteria, presets)
    workload.ts     workload summary for the challenge panel
    evaluate.ts     deterministic, evidence-based feedback rules
    persistence.ts  validated JSON export/import + localStorage
  state/
    useDesign.ts     architecture reducer, validation, connection pre-flight
    useSimulation.ts drives the engine from the animation clock
  ui/                React components (canvas, panels, modals, illustrations)
tests/               vitest suites, run headless against src/sim
```

The engine has no React or DOM dependency, which is what lets the whole test suite drive
it headless. `src/sim/index.ts` is the single entry point the UI imports from.

**Adding a challenge** means adding a `Challenge` to `src/sim/challenges.ts`: a workload,
criteria, a starting architecture and an example. The model is deliberately shaped so that
later challenges can add queues, workers, write workloads and failures — new node kinds go
in `catalog.ts` with their connection rules, and the engine's per-kind service logic is one
`switch`. None of that is implemented here.

---

## Verification

`npm test` runs 54 tests across four suites:

- **`tests/engine.test.ts`** — determinism (identical inputs, identical outputs; drawing
  order irrelevant), request accounting (`answered + rejected + timed out == generated`,
  nothing left in flight), queue overflow and capacity invariants sampled throughout a run,
  the deeper-queue tradeoff, cache cold start / repeat hits / capacity and eviction /
  LRU-beats-FIFO, round-robin evenness, least-busy behaviour, replica spread, and
  **playback-speed independence**: the same run stepped in chunks of 7, 33, 250, 1000 and
  5000 ms — and in a jittery irregular sequence with frames read each tick — produces
  identical counts, percentiles and per-node state.
- **`tests/topology.test.ts`** — every allowed and disallowed connection pair, and each
  validation rule: missing client, no entry point, application server with no read backend,
  cache with no source of truth, load balancer with nothing behind it, unreachable
  components, duplicate connections, dangling connections, instance limits, and the cycle
  guard.
- **`tests/challenge.test.ts`** — the calibration itself: the starting design is valid but
  fails badly, two structurally different designs pass, the bundled example passes, adding
  application servers alone does not rescue the design (the overflow moves to the
  database), the three verdicts are distinguished, feedback quotes real measured numbers,
  and cost is only ever reported in relative units.
- **`tests/persistence.test.ts`** — export/import round-trips without changing what the
  design simulates, and malformed input is rejected rather than guessed at: bad JSON,
  future format versions, unknown component kinds, duplicate ids, connections to absent
  components. Out-of-range settings are clamped and reported.

The running application was also driven in Chrome: first-run walkthrough, running the
starting design to completion, adding and connecting a cache through the Inspector,
re-running to a pass (p95 116 ms — matching the headless result exactly), stepping 4 × 250
ms, save, JSON import with an out-of-range value that was clamped and reported, restore,
the assumptions and example modals, and both light and dark palettes.

### Known limitations

- **One challenge.** The framework takes more, but only *Survive the traffic spike* ships.
- **Live playback needs a visible tab.** The clock is driven by `requestAnimationFrame`, so
  a backgrounded tab runs in slow motion. *Step* and *Skip to end* are unaffected, and
  results never depend on playback rate.
- **Single-threaded.** The engine runs on the main thread. A 10,000-request run takes
  roughly 100 ms to complete headless, so *Skip to end* is instant, but a much larger
  workload would want a worker.
- **`localStorage` only.** Designs are saved per browser. Use Export JSON to keep or share
  one; there is no account or sync.
- **Connection rules are fixed per model, not per challenge.** The allowed-pair table lives
  in the component catalog rather than in the challenge, so a future challenge cannot
  currently narrow it.
- **No undo.** Restore starting design and the saved-design list are the recovery paths.
