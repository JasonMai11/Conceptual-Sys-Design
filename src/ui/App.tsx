import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import {
  SURVIVE_THE_SPIKE,
  cloneArchitecture,
  evaluate,
  hasOnboarded,
  loadAutosave,
  loadPrefs,
  loadSavedDesigns,
  makeDocument,
  saveAutosave,
  savePrefs,
  setOnboarded,
  totalRequests,
  writeSavedDesigns,
  type DesignDocument,
  type NodeKind,
} from '../sim';
import { useDesign, type DesignAction } from '../state/useDesign';
import { useSimulation } from '../state/useSimulation';
import { AssumptionsModal } from './AssumptionsModal';
import { Canvas, type Selection } from './Canvas';
import { ChallengePanel } from './ChallengePanel';
import { DesignsModal } from './DesignsModal';
import { ExampleModal } from './ExampleModal';
import { Inspector } from './Inspector';
import { MetricsStrip } from './MetricsStrip';
import { Palette } from './Palette';
import { ResultsPanel } from './ResultsPanel';
import { SimControls } from './SimControls';
import { Toasts, useToasts } from './Toasts';
import { Walkthrough } from './Walkthrough';

type ModalKind = 'walkthrough' | 'assumptions' | 'designs' | 'example' | null;

export function App() {
  const challenge = SURVIVE_THE_SPIKE;
  const restored = useRef<DesignDocument | null>(loadAutosave());
  const prefs = useRef(loadPrefs());

  const { architecture, dispatch: rawDispatch, validation, canConnect } = useDesign(
    challenge,
    restored.current?.challengeId === challenge.id ? restored.current.architecture : undefined,
  );
  const sim = useSimulation(challenge);
  const { toasts, push, dismiss } = useToasts();

  const [selection, setSelection] = useState<Selection | null>(null);
  const [tab, setTab] = useState<'inspector' | 'results'>('inspector');
  const [fitSignal, setFitSignal] = useState(0);
  const [modal, setModal] = useState<ModalKind>(hasOnboarded() ? null : 'walkthrough');
  const [saved, setSaved] = useState<DesignDocument[]>(() => loadSavedDesigns());
  const [reducedMotion, setReducedMotion] = useState<boolean>(() => {
    if (prefs.current.reducedMotion !== null) return prefs.current.reducedMotion;
    return typeof window !== 'undefined'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
  });

  /* --------- motion preference --------- */

  useEffect(() => {
    document.documentElement.dataset.motion = reducedMotion ? 'off' : 'on';
    savePrefs({ reducedMotion, speed: sim.speed });
  }, [reducedMotion, sim.speed]);

  /* --------- autosave --------- */

  useEffect(() => {
    const id = window.setTimeout(() => {
      saveAutosave(makeDocument(challenge.id, 'Work in progress', architecture));
    }, 400);
    return () => window.clearTimeout(id);
  }, [architecture, challenge.id]);

  /* --------- editing implies the finished run is history --------- */

  const dispatch = useCallback(
    (action: DesignAction) => {
      if (sim.locked) {
        push('The canvas is locked while a run is in progress. Press Reset to edit.', 'bad');
        return;
      }
      // After a completed run, the first edit clears the run but keeps its
      // feedback on screen, so you can read it while changing the design.
      if (sim.phase === 'finished') sim.reset();
      rawDispatch(action);
    },
    [rawDispatch, sim, push],
  );

  const onConnectAttempt = useCallback(
    (source: string, target: string) => {
      const check = canConnect(source, target);
      if (!check.ok) {
        push(check.reason ?? 'That connection is not allowed.', 'bad');
        return;
      }
      dispatch({ type: 'connect', source, target });
    },
    [canConnect, dispatch, push],
  );

  const addNode = useCallback(
    (kind: NodeKind) => {
      dispatch({ type: 'addNode', kind });
      push(`Added a ${kind === 'appServer' ? 'application server' : kind.toLowerCase()}. Connect it to put it to work.`);
    },
    [dispatch, push],
  );

  /* --------- run controls --------- */

  const runnable = validation.runnable;

  const handleRun = useCallback(() => {
    if (!runnable) {
      push('Fix the errors in the Inspector before running.', 'bad');
      return;
    }
    setTab('results');
    sim.run(architecture);
  }, [architecture, push, runnable, sim]);

  const handleReset = useCallback(() => {
    sim.reset();
  }, [sim]);

  useEffect(() => {
    if (sim.phase === 'finished') setTab('results');
  }, [sim.phase]);

  /* --------- keyboard shortcuts --------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        modal ||
        (target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'SELECT' ||
            target.isContentEditable))
      )
        return;
      if (e.key === ' ') {
        e.preventDefault();
        if (sim.phase === 'running') sim.pause();
        else handleRun();
      } else if (e.key === 'r' || e.key === 'R') {
        handleReset();
      } else if (e.key === 's' || e.key === 'S') {
        if (runnable) sim.step(architecture);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [architecture, handleReset, handleRun, modal, runnable, sim]);

  /* --------- feedback --------- */

  const evaluation = useMemo(
    () =>
      evaluate({
        challenge,
        architecture: sim.lastRun?.architecture ?? architecture,
        validation,
        result: sim.lastRun?.result ?? null,
        previous: sim.previousRun,
      }),
    [architecture, challenge, sim.lastRun, sim.previousRun, validation],
  );

  const stale = sim.phase === 'idle' && sim.lastRun !== null;

  /* --------- saved designs --------- */

  const saveDesign = useCallback(
    (name: string) => {
      const doc = makeDocument(challenge.id, name, architecture);
      const next = [doc, ...saved.filter((d) => d.name !== name)].slice(0, 20);
      setSaved(next);
      if (writeSavedDesigns(next)) push(`Saved “${name}”.`);
      else push('This browser would not let the app store data, so the save did not stick.', 'bad');
    },
    [architecture, challenge.id, push, saved],
  );

  const deleteDesign = useCallback(
    (name: string) => {
      const next = saved.filter((d) => d.name !== name);
      setSaved(next);
      writeSavedDesigns(next);
      push(`Deleted “${name}”.`);
    },
    [push, saved],
  );

  const loadDesign = useCallback(
    (doc: DesignDocument) => {
      sim.reset();
      sim.clearHistory();
      rawDispatch({ type: 'replace', architecture: doc.architecture });
      setSelection(null);
      setFitSignal((n) => n + 1);
      push(`Loaded “${doc.name}”.`);
    },
    [push, rawDispatch, sim],
  );

  const errorCount = validation.issues.filter((i) => i.severity === 'error').length;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>Conceptually</h1>
          <span className="brand-sub">Learn system design by building it</span>
        </div>
        <div className="topbar-spacer" />
        <div className="topbar-actions">
          <button type="button" className="btn btn-sm" onClick={() => setModal('walkthrough')}>
            How to play
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setModal('assumptions')}>
            Assumptions
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setModal('designs')}>
            Designs
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="rail rail-left" aria-label="Challenge and building blocks">
          <ChallengePanel
            challenge={challenge}
            lastResult={sim.lastRun?.result ?? null}
            locked={sim.locked}
            onShowExample={() => setModal('example')}
            onRestore={() => {
              sim.reset();
              rawDispatch({ type: 'replace', architecture: challenge.startingArchitecture });
              setSelection(null);
              setFitSignal((n) => n + 1);
              push('Back to the starting design.');
            }}
          />
          <Palette
            challenge={challenge}
            architecture={architecture}
            locked={sim.locked}
            onAdd={addNode}
          />
        </aside>

        <main className="stage">
          <SimControls
            phase={sim.phase}
            frame={sim.frame}
            horizonMs={sim.horizonMs}
            speed={sim.speed}
            runnable={runnable}
            reducedMotion={reducedMotion}
            onRun={handleRun}
            onPause={sim.pause}
            onStep={() => sim.step(architecture)}
            onSkip={() => {
              setTab('results');
              sim.skipToEnd(architecture);
            }}
            onReset={handleReset}
            onSpeed={sim.setSpeed}
            onToggleMotion={() => setReducedMotion((v) => !v)}
          />

          <div className="canvas-wrap">
            <ReactFlowProvider>
              <Canvas
                architecture={architecture}
                validation={validation}
                frame={sim.frame}
                locked={sim.locked}
                animate={!reducedMotion}
                selection={selection}
                onSelect={setSelection}
                dispatch={dispatch}
                onConnectAttempt={onConnectAttempt}
                fitSignal={fitSignal}
              />
            </ReactFlowProvider>

            {sim.phase === 'idle' && !sim.lastRun && (
              <div className="canvas-hint">
                Drag from a block's right edge to another block's left edge to connect them. Press{' '}
                <kbd>Space</kbd> to run.
              </div>
            )}

            {sim.locked && (
              <div className="canvas-overlay">
                <div className="canvas-lock">
                  <span>Locked while the run is in progress</span>
                  <button type="button" className="btn btn-sm" onClick={handleReset}>
                    Reset to edit
                  </button>
                </div>
              </div>
            )}
          </div>

          <MetricsStrip
            frame={sim.frame}
            challenge={challenge}
            totalRequests={totalRequests(challenge)}
          />
        </main>

        <aside className="rail rail-right" aria-label="Inspector and results">
          <div className="tabs" role="tablist">
            <button
              type="button"
              role="tab"
              className="tab"
              aria-selected={tab === 'inspector'}
              onClick={() => setTab('inspector')}
            >
              Inspector
              {errorCount > 0 && <span className="tab-badge">{errorCount}</span>}
            </button>
            <button
              type="button"
              role="tab"
              className="tab"
              aria-selected={tab === 'results'}
              onClick={() => setTab('results')}
            >
              Results
            </button>
          </div>

          {tab === 'inspector' ? (
            <Inspector
              architecture={architecture}
              validation={validation}
              frame={sim.frame}
              selection={selection}
              locked={sim.locked}
              dispatch={dispatch}
              onSelect={setSelection}
            />
          ) : (
            <ResultsPanel
              evaluation={evaluation}
              phase={sim.phase}
              frame={sim.frame}
              lastResult={sim.lastRun?.result ?? null}
              challenge={challenge}
              stale={stale}
            />
          )}
        </aside>
      </div>

      <Toasts toasts={toasts} dismiss={dismiss} />

      {modal === 'walkthrough' && (
        <Walkthrough
          onClose={() => {
            setOnboarded(true);
            setModal(null);
          }}
        />
      )}
      {modal === 'assumptions' && (
        <AssumptionsModal challenge={challenge} onClose={() => setModal(null)} />
      )}
      {modal === 'designs' && (
        <DesignsModal
          challenge={challenge}
          architecture={architecture}
          saved={saved}
          onSave={saveDesign}
          onDelete={deleteDesign}
          onLoad={loadDesign}
          onClose={() => setModal(null)}
          notify={push}
        />
      )}
      {modal === 'example' && (
        <ExampleModal
          challenge={challenge}
          onClose={() => setModal(null)}
          onLoad={() => {
            sim.reset();
            sim.clearHistory();
            rawDispatch({
              type: 'replace',
              architecture: cloneArchitecture(challenge.exampleSolution.architecture),
            });
            setSelection(null);
            setFitSignal((n) => n + 1);
            setModal(null);
            push('Example loaded. Run it, then try to beat it with something cheaper.');
          }}
        />
      )}
    </div>
  );
}
