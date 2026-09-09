import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Simulation,
  cloneArchitecture,
  type Architecture,
  type Challenge,
  type Frame,
  type RunResult,
} from '../sim';

export type Phase = 'idle' | 'running' | 'paused' | 'finished';

export const SPEEDS = [0.5, 1, 2, 4, 10] as const;

/** Wall-clock ms folded into one animation step, before the speed multiplier. */
const MAX_STEP_MS = 64;
/** How often the React tree sees a new frame while running (~18 fps of data). */
const EMIT_INTERVAL_MS = 55;

export interface CompletedRun {
  result: RunResult;
  architecture: Architecture;
}

/**
 * Drives a `Simulation` from the browser's animation clock.
 *
 * Playback speed only changes how much *simulated* time each animation frame
 * consumes; the engine's event order — and therefore every number it reports —
 * is unaffected. The architecture is snapshotted when a run starts, so editing
 * mid-run is impossible by construction rather than by convention.
 */
export function useSimulation(challenge: Challenge) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [speed, setSpeed] = useState<number>(1);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [lastRun, setLastRun] = useState<CompletedRun | null>(null);
  const [previousRun, setPreviousRun] = useState<CompletedRun | null>(null);

  const simRef = useRef<Simulation | null>(null);
  const snapshotRef = useRef<Architecture | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);
  const lastEmitRef = useRef<number>(0);
  const speedRef = useRef(speed);
  speedRef.current = speed;

  const horizonMs = useMemo(
    () => challenge.workload.requestsPerSecond.length * 1000 + challenge.maxDrainMs,
    [challenge],
  );

  const emit = useCallback(() => {
    const sim = simRef.current;
    if (sim) setFrame(sim.frame());
  }, []);

  const finalize = useCallback(() => {
    const sim = simRef.current;
    const snapshot = snapshotRef.current;
    if (!sim || !snapshot) return;
    const completed: CompletedRun = { result: sim.result(), architecture: snapshot };
    setPreviousRun(lastRun);
    setLastRun(completed);
    setFrame(sim.frame());
    setPhase('finished');
  }, [lastRun]);

  const ensureSim = useCallback(
    (architecture: Architecture) => {
      if (simRef.current) return simRef.current;
      const snapshot = cloneArchitecture(architecture);
      snapshotRef.current = snapshot;
      const sim = new Simulation(snapshot, challenge);
      simRef.current = sim;
      return sim;
    },
    [challenge],
  );

  /* --------- the animation loop --------- */

  useEffect(() => {
    if (phase !== 'running') {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      return;
    }
    lastTickRef.current = performance.now();

    const tick = (now: number) => {
      const sim = simRef.current;
      if (!sim) return;
      const wall = Math.min(MAX_STEP_MS, now - lastTickRef.current);
      lastTickRef.current = now;
      sim.advanceTo(sim.currentTimeMs + wall * speedRef.current);

      if (sim.finished) {
        finalize();
        return;
      }
      if (now - lastEmitRef.current >= EMIT_INTERVAL_MS) {
        lastEmitRef.current = now;
        emit();
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [phase, emit, finalize]);

  /* --------- controls --------- */

  const run = useCallback(
    (architecture: Architecture) => {
      if (phase === 'finished') return;
      ensureSim(architecture);
      setPhase('running');
    },
    [ensureSim, phase],
  );

  const pause = useCallback(() => {
    setPhase((p) => (p === 'running' ? 'paused' : p));
    emit();
  }, [emit]);

  const step = useCallback(
    (architecture: Architecture, ms = 250) => {
      if (phase === 'finished') return;
      const sim = ensureSim(architecture);
      sim.advanceTo(sim.currentTimeMs + ms);
      if (sim.finished) finalize();
      else {
        setPhase('paused');
        emit();
      }
    },
    [ensureSim, emit, finalize, phase],
  );

  const skipToEnd = useCallback(
    (architecture: Architecture) => {
      if (phase === 'finished') return;
      const sim = ensureSim(architecture);
      sim.advanceTo(horizonMs);
      finalize();
    },
    [ensureSim, finalize, horizonMs, phase],
  );

  /** Back to an editable canvas. Feedback from the finished run is kept. */
  const reset = useCallback(() => {
    simRef.current = null;
    snapshotRef.current = null;
    lastEmitRef.current = 0;
    setFrame(null);
    setPhase('idle');
  }, []);

  const clearHistory = useCallback(() => {
    setLastRun(null);
    setPreviousRun(null);
  }, []);

  const locked = phase === 'running' || phase === 'paused';

  return {
    phase,
    locked,
    frame,
    speed,
    setSpeed,
    run,
    pause,
    step,
    skipToEnd,
    reset,
    lastRun,
    previousRun,
    clearHistory,
    horizonMs,
    snapshot: snapshotRef.current,
  };
}
