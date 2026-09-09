import type { Frame } from '../sim';
import { SPEEDS, type Phase } from '../state/useSimulation';
import { Tooltip } from './Tooltip';

interface Props {
  phase: Phase;
  frame: Frame | null;
  horizonMs: number;
  speed: number;
  runnable: boolean;
  reducedMotion: boolean;
  onRun: () => void;
  onPause: () => void;
  onStep: () => void;
  onSkip: () => void;
  onReset: () => void;
  onSpeed: (speed: number) => void;
  onToggleMotion: () => void;
}

export function SimControls({
  phase,
  frame,
  horizonMs,
  speed,
  runnable,
  reducedMotion,
  onRun,
  onPause,
  onStep,
  onSkip,
  onReset,
  onSpeed,
  onToggleMotion,
}: Props) {
  const t = frame?.metrics.simTimeMs ?? 0;
  const progress = Math.min(100, (t / horizonMs) * 100);
  const running = phase === 'running';

  return (
    <div className="simbar">
      <button
        type="button"
        className="btn btn-primary"
        onClick={running ? onPause : onRun}
        disabled={!runnable || phase === 'finished'}
        title={running ? 'Pause (Space)' : 'Run the workload through this design (Space)'}
      >
        {running ? '❙❙ Pause' : phase === 'paused' ? '▶ Resume' : '▶ Run'}
      </button>
      <button
        type="button"
        className="btn"
        onClick={onStep}
        disabled={!runnable || running || phase === 'finished'}
        title="Advance 250 simulated milliseconds (S)"
      >
        ⏭ Step
      </button>
      <button
        type="button"
        className="btn"
        onClick={onSkip}
        disabled={!runnable || phase === 'finished'}
        title="Jump straight to the end of the run"
      >
        ⏩ Skip to end
      </button>
      <button
        type="button"
        className="btn"
        onClick={onReset}
        disabled={phase === 'idle'}
        title="Clear the run and unlock the canvas (R)"
      >
        ↺ Reset
      </button>

      <span className="sim-clock" aria-live="off">
        {(t / 1000).toFixed(2)}s
      </span>
      <div
        className="sim-progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress)}
        aria-label="Simulated time elapsed"
      >
        <div className="sim-progress-fill" style={{ width: `${progress}%` }} />
      </div>

      <div className="speed-group" role="group" aria-label="Playback speed">
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={speed === s}
            onClick={() => onSpeed(s)}
            title={`${s}× playback speed`}
          >
            {s}×
          </button>
        ))}
      </div>
      <Tooltip label="playback speed">
        Speed changes only how fast you watch. Simulated time is tracked separately from the animation, so
        the results are identical at 0.5× and at 10×.
      </Tooltip>

      <button
        type="button"
        className="btn btn-sm btn-ghost"
        onClick={onToggleMotion}
        aria-pressed={reducedMotion}
        title="Stop the moving traffic dots and pulsing highlights"
      >
        {reducedMotion ? '◻ Motion off' : '◼ Motion on'}
      </button>

      <span className={`pill ${phaseTone(phase)}`}>{phaseLabel(phase)}</span>
    </div>
  );
}

function phaseLabel(phase: Phase): string {
  switch (phase) {
    case 'idle':
      return 'Editing';
    case 'running':
      return 'Running';
    case 'paused':
      return 'Paused';
    case 'finished':
      return 'Run complete';
  }
}

function phaseTone(phase: Phase): string {
  switch (phase) {
    case 'idle':
      return 'pill-muted';
    case 'running':
      return 'pill-info';
    case 'paused':
      return 'pill-warn';
    case 'finished':
      return 'pill-good';
  }
}
