import { useState } from 'react';
import { StarterSketch } from './Art';
import { Modal } from './Modal';

const STEPS = [
  {
    title: 'You are handed a problem, not a diagram',
    body: (
      <>
        <p>
          Every challenge gives you a workload — how much traffic arrives and when — plus the outcomes you
          have to hit. How you get there is up to you. There is no single right answer, and several very
          different designs pass.
        </p>
        <div className="walkthrough-art">
          <StarterSketch />
        </div>
        <p className="tiny muted">
          You start with the simplest thing that could work: shoppers, one application server, one
          database. It will not survive the spike. That is the point.
        </p>
      </>
    ),
  },
  {
    title: 'Build by connecting blocks',
    body: (
      <>
        <p>
          Click a block in the palette to drop it on the canvas, then drag from the small square on a
          block's right edge to the square on another block's left edge to connect them.
        </p>
        <p>
          Connections mean something. A cache has to be connected to a database or it has nowhere to fetch
          from; a load balancer with no application servers behind it has nothing to balance. If a
          connection would not make sense, the app refuses it and tells you why.
        </p>
        <p className="tiny muted">
          Prefer the keyboard? Palette items are buttons, blocks are selectable with <kbd>Tab</kbd>, and{' '}
          <kbd>Delete</kbd> removes whatever is selected. Every connection can also be made without a
          mouse: select a block and use the <strong>Connections</strong> picker in the Inspector.
        </p>
      </>
    ),
  },
  {
    title: 'Run it and watch',
    body: (
      <>
        <p>
          Press <kbd>Space</kbd> or the Run button. Requests flow through your design in simulated time:
          line thickness tracks the measured request rate, blocks fill up as their capacity is used, and a{' '}
          <strong>⚠ tag</strong> appears on anything that is saturated, filling its queue, or turning
          requests away.
        </p>
        <p>
          Playback speed changes only how fast you watch. The result is exactly the same at 0.5× and 10×,
          because simulated time is tracked independently of the animation.
        </p>
        <p className="tiny muted">
          The canvas locks while a run is in progress, so a design cannot change underneath its own
          results. Press Reset to edit again.
        </p>
      </>
    ),
  },
  {
    title: 'Read the numbers, then change one thing',
    body: (
      <>
        <p>
          When the run ends you get a verdict against the challenge criteria, plus the evidence behind it:
          which queue filled, how many requests each component handled, what share the cache answered.
        </p>
        <p>
          The advice you get is generated from those measurements — nothing is graded by matching your
          diagram against a reference answer. Change one thing, run again, and compare.
        </p>
      </>
    ),
  },
  {
    title: 'This is a teaching model, not a cloud',
    body: (
      <>
        <p>
          The capacities here are chosen so tradeoffs are visible in ten seconds of simulated time. They
          are not measurements of any real database or cloud service, and the simulation deliberately
          leaves out most of what a production system has to deal with.
        </p>
        <p>
          The <strong>Assumptions</strong> button in the top bar lists exactly what is modelled and what is
          not. It is worth a read once you have run the first design.
        </p>
      </>
    ),
  },
];

export function Walkthrough({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const current = STEPS[step];
  const last = step === STEPS.length - 1;

  return (
    <Modal
      title={current.title}
      subtitle={`Getting started — ${step + 1} of ${STEPS.length}`}
      onClose={onClose}
      footer={
        <>
          <div className="step-dots" aria-hidden>
            {STEPS.map((_, i) => (
              <span key={i} className={`step-dot${i === step ? ' active' : ''}`} />
            ))}
          </div>
          <button type="button" className="btn" onClick={onClose}>
            Skip
          </button>
          {step > 0 && (
            <button type="button" className="btn" onClick={() => setStep((s) => s - 1)}>
              Back
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => (last ? onClose() : setStep((s) => s + 1))}
          >
            {last ? 'Start building' : 'Next'}
          </button>
        </>
      }
    >
      {current.body}
    </Modal>
  );
}
