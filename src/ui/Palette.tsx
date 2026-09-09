import { KINDS, type Architecture, type Challenge, type NodeKind } from '../sim';
import { Art } from './Art';
import { Tooltip } from './Tooltip';

interface PaletteProps {
  challenge: Challenge;
  architecture: Architecture;
  locked: boolean;
  onAdd: (kind: NodeKind) => void;
}

/**
 * Palette entries are real buttons, so the whole canvas can be assembled from
 * the keyboard; dragging is offered as a shortcut, not as the only way in.
 */
export function Palette({ challenge, architecture, locked, onAdd }: PaletteProps) {
  return (
    <div className="panel">
      <div>
        <div className="eyebrow">Building blocks</div>
        <p className="tiny muted" style={{ marginTop: 4 }}>
          Click to add one, then drag from a block's right edge to another block's left edge to connect them — or select a block and use the Connections picker in the Inspector.
        </p>
      </div>
      <div className="palette">
        {challenge.availableKinds.map((kind) => {
          const spec = KINDS[kind];
          const count = architecture.nodes.filter((n) => n.kind === kind).length;
          const atLimit = count >= spec.maxInstances;
          return (
            <button
              key={kind}
              type="button"
              className="palette-item"
              style={{ ['--accent' as string]: `var(--k-${kind})` }}
              disabled={locked || atLimit}
              onClick={() => onAdd(kind)}
              draggable={!locked && !atLimit}
              onDragStart={(e) => {
                e.dataTransfer.setData('application/conceptually-kind', kind);
                e.dataTransfer.effectAllowed = 'move';
              }}
              title={
                atLimit
                  ? `This challenge allows at most ${spec.maxInstances}`
                  : `Add ${spec.name} to the canvas`
              }
            >
              <span className="palette-art" style={{ color: `var(--k-${kind})` }}>
                <Art kind={kind} size={40} />
              </span>
              <span style={{ minWidth: 0 }}>
                <span className="pi-name">{spec.name}</span>
                <span className="pi-sub" style={{ display: 'block' }}>
                  {spec.summary}
                </span>
              </span>
              <span className="pi-count">
                {count > 0 ? `${count}/${spec.maxInstances}` : atLimit ? 'max' : ''}
              </span>
            </button>
          );
        })}
      </div>
      <div className="tiny muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        Connections have rules
        <Tooltip label="connection rules">
          Clients talk to a load balancer or an application server. Load balancers talk to application
          servers. Application servers read from a cache, a database, or a read replica. A cache falls
          back to a database or replica. Anything else is refused with an explanation.
        </Tooltip>
      </div>
    </div>
  );
}
