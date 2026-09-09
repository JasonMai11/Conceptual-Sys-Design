import { useState } from 'react';
import {
  KINDS,
  architectureCost,
  edgeRole,
  type ArchNode,
  type Architecture,
  type ConfigField,
  type Frame,
  type ValidationResult,
} from '../sim';
import type { DesignAction } from '../state/useDesign';
import { Art } from './Art';
import type { Selection } from './Canvas';

const fmt = new Intl.NumberFormat('en-US');

interface Props {
  architecture: Architecture;
  validation: ValidationResult;
  frame: Frame | null;
  selection: Selection | null;
  locked: boolean;
  dispatch: (action: DesignAction) => void;
  onSelect: (selection: Selection | null) => void;
}

export function Inspector({
  architecture,
  validation,
  frame,
  selection,
  locked,
  dispatch,
  onSelect,
}: Props) {
  const node = selection?.type === 'node' ? architecture.nodes.find((n) => n.id === selection.id) : undefined;
  const edge = selection?.type === 'edge' ? architecture.edges.find((e) => e.id === selection.id) : undefined;

  return (
    <>
      <IssuesSection validation={validation} onSelect={onSelect} />
      {node ? (
        <NodeInspector
          architecture={architecture}
          node={node}
          frame={frame}
          locked={locked}
          dispatch={dispatch}
          onSelect={onSelect}
        />
      ) : edge ? (
        <EdgeInspector
          architecture={architecture}
          edgeId={edge.id}
          locked={locked}
          dispatch={dispatch}
          onSelect={onSelect}
        />
      ) : (
        <DesignSummary architecture={architecture} />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */

function IssuesSection({
  validation,
  onSelect,
}: {
  validation: ValidationResult;
  onSelect: (selection: Selection | null) => void;
}) {
  if (validation.issues.length === 0) {
    return (
      <div className="panel">
        <div className="pill pill-good">✓ This design is ready to run</div>
      </div>
    );
  }
  const errors = validation.issues.filter((i) => i.severity === 'error').length;
  return (
    <div className="panel">
      <div className="eyebrow">
        {errors > 0 ? `${errors} problem${errors === 1 ? '' : 's'} to fix` : 'Notes on this design'}
      </div>
      <div>
        {validation.issues.map((issue, i) => (
          <div key={`${issue.code}-${i}`} className={`issue issue-${issue.severity}`}>
            <span className="issue-mark">
              {issue.severity === 'error' ? '✕' : issue.severity === 'warning' ? '!' : 'i'}
            </span>
            <span>
              {issue.message}
              {issue.nodeIds && issue.nodeIds.length > 0 && (
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  style={{ marginLeft: 4, padding: '0 5px' }}
                  onClick={() => onSelect({ type: 'node', id: issue.nodeIds![0] })}
                >
                  show
                </button>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function NodeInspector({
  architecture,
  node,
  frame,
  locked,
  dispatch,
  onSelect,
}: {
  architecture: Architecture;
  node: ArchNode;
  frame: Frame | null;
  locked: boolean;
  dispatch: (action: DesignAction) => void;
  onSelect: (selection: Selection | null) => void;
}) {
  const spec = KINDS[node.kind];
  const runtime = frame?.nodes.find((n) => n.id === node.id) ?? null;
  const accent = `var(--k-${node.kind})`;

  return (
    <div className="panel" style={{ ['--accent' as string]: accent }}>
      <div style={{ display: 'flex', gap: 11, alignItems: 'flex-start' }}>
        <span style={{ color: accent, flex: '0 0 auto' }}>
          <Art kind={node.kind} size={38} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div className="eyebrow">{spec.name}</div>
          <h3 style={{ fontSize: 15 }}>{node.label}</h3>
        </div>
      </div>

      <p className="tiny" style={{ color: 'var(--ink-2)' }}>{spec.description}</p>
      {spec.awsAnalogy && (
        <p className="tiny muted" style={{ fontStyle: 'italic' }}>
          {spec.awsAnalogy} The block here is a teaching simplification and does not reproduce that
          service's real behaviour.
        </p>
      )}

      {runtime && (
        <div className="card">
          <div className="eyebrow" style={{ marginBottom: 6 }}>Right now</div>
          <div className="bars">
            <Readout label="In service" value={`${runtime.busy} / ${runtime.concurrency}`} />
            <Readout label="Waiting" value={`${fmt.format(runtime.queueDepth)} / ${fmt.format(runtime.queueCapacity)}`} />
            <Readout label="Arriving" value={`${fmt.format(Math.round(runtime.arrivalRate))} /s`} />
            <Readout label="Handled" value={fmt.format(runtime.completed)} />
            {runtime.rejected > 0 && <Readout label="Rejected" value={fmt.format(runtime.rejected)} bad />}
            {node.kind === 'cache' && (
              <>
                <Readout label="Hits" value={fmt.format(runtime.cacheHits ?? 0)} />
                <Readout label="Misses" value={fmt.format(runtime.cacheMisses ?? 0)} />
                <Readout label="Products held" value={fmt.format(runtime.cacheEntries ?? 0)} />
              </>
            )}
          </div>
        </div>
      )}

      <Connections architecture={architecture} node={node} locked={locked} dispatch={dispatch} />

      {node.kind !== 'client' && (
        <div className="field">
          <label className="field-label" htmlFor={`name-${node.id}`}>
            Name
          </label>
          <input
            id={`name-${node.id}`}
            type="text"
            value={node.label}
            disabled={locked}
            onChange={(e) => dispatch({ type: 'rename', id: node.id, label: e.target.value })}
          />
        </div>
      )}

      {spec.fields.length === 0 ? (
        <p className="tiny muted">
          Nothing to configure here — the workload is fixed by the challenge so every design faces the
          same traffic.
        </p>
      ) : (
        spec.fields.map((field) => (
          <Field
            key={field.key}
            field={field}
            value={node.config[field.key]}
            disabled={locked}
            onChange={(value) => dispatch({ type: 'setConfig', id: node.id, key: field.key, value })}
          />
        ))
      )}

      {node.kind !== 'client' && (
        <button
          type="button"
          className="btn btn-sm"
          disabled={locked}
          onClick={() => {
            dispatch({ type: 'removeNode', id: node.id });
            onSelect(null);
          }}
        >
          Remove this component
        </button>
      )}
    </div>
  );
}

/**
 * Connecting by dragging between handles is quick with a mouse and impossible
 * without one, so the same operation lives here as a list plus a picker. Only
 * targets the routing rules actually allow are offered.
 */
function Connections({
  architecture,
  node,
  locked,
  dispatch,
}: {
  architecture: Architecture;
  node: ArchNode;
  locked: boolean;
  dispatch: (action: DesignAction) => void;
}) {
  const outgoing = architecture.edges.filter((e) => e.source === node.id);
  const incoming = architecture.edges.filter((e) => e.target === node.id);
  const byId = new Map(architecture.nodes.map((n) => [n.id, n]));

  const candidates = architecture.nodes.filter(
    (other) =>
      other.id !== node.id &&
      edgeRole(node.kind, other.kind) !== null &&
      !outgoing.some((e) => e.target === other.id),
  );
  const [pick, setPick] = useState('');
  const choice = candidates.some((c) => c.id === pick) ? pick : (candidates[0]?.id ?? '');

  return (
    <div className="card">
      <div className="eyebrow" style={{ marginBottom: 7 }}>Connections</div>

      {outgoing.length === 0 && incoming.length === 0 && (
        <p className="tiny muted" style={{ margin: 0 }}>
          Not connected to anything yet.
        </p>
      )}

      {incoming.length > 0 && (
        <p className="tiny muted" style={{ margin: '0 0 7px' }}>
          Receives requests from {incoming.map((e) => byId.get(e.source)?.label ?? e.source).join(', ')}.
        </p>
      )}

      {outgoing.map((e) => (
        <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
          <span className="tiny" style={{ flex: 1, minWidth: 0 }}>
            → {byId.get(e.target)?.label ?? e.target}
          </span>
          <button
            type="button"
            className="btn btn-sm"
            disabled={locked}
            onClick={() => dispatch({ type: 'removeEdge', id: e.id })}
          >
            Disconnect
          </button>
        </div>
      ))}

      {candidates.length > 0 ? (
        <div className="field-row" style={{ marginTop: 9 }}>
          <label className="sr-only" htmlFor={`connect-${node.id}`}>
            Connect {node.label} to
          </label>
          <select
            id={`connect-${node.id}`}
            value={choice}
            disabled={locked}
            onChange={(ev) => setPick(ev.target.value)}
            style={{ flex: 1 }}
          >
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-sm"
            disabled={locked || !choice}
            onClick={() => dispatch({ type: 'connect', source: node.id, target: choice })}
          >
            Connect
          </button>
        </div>
      ) : (
        <p className="tiny muted" style={{ margin: '7px 0 0' }}>
          Nothing left that this component is allowed to send requests to.
        </p>
      )}
    </div>
  );
}

function Readout({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
      <span className="muted">{label}</span>
      <span className="mono" style={{ color: bad ? 'var(--bad)' : undefined, fontWeight: 600 }}>
        {value}
      </span>
    </div>
  );
}

function Field({
  field,
  value,
  disabled,
  onChange,
}: {
  field: ConfigField;
  value: unknown;
  disabled: boolean;
  onChange: (value: number | string) => void;
}) {
  const id = `field-${field.key}`;
  if (field.type === 'select') {
    const current = typeof value === 'string' ? value : field.default;
    return (
      <div className="field">
        <label className="field-label" htmlFor={id}>
          {field.label}
        </label>
        <select id={id} value={current} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <span className="field-help">{field.help}</span>
      </div>
    );
  }

  const current = typeof value === 'number' ? value : field.default;
  return (
    <div className="field">
      <span className="field-label">
        <label htmlFor={id}>{field.label}</label>
        <span className="field-value">
          {fmt.format(current)}
          {field.unit ? ` ${field.unit}` : ''}
        </span>
      </span>
      <div className="field-row">
        <input
          id={id}
          type="range"
          min={field.min}
          max={field.max}
          step={field.step}
          value={current}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <input
          type="number"
          min={field.min}
          max={field.max}
          value={current}
          disabled={disabled}
          aria-label={`${field.label} exact value`}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) onChange(Math.min(field.max, Math.max(field.min, v)));
          }}
        />
      </div>
      <span className="field-help">{field.help}</span>
    </div>
  );
}

function EdgeInspector({
  architecture,
  edgeId,
  locked,
  dispatch,
  onSelect,
}: {
  architecture: Architecture;
  edgeId: string;
  locked: boolean;
  dispatch: (action: DesignAction) => void;
  onSelect: (selection: Selection | null) => void;
}) {
  const edge = architecture.edges.find((e) => e.id === edgeId)!;
  const source = architecture.nodes.find((n) => n.id === edge.source)!;
  const target = architecture.nodes.find((n) => n.id === edge.target)!;
  const role = edgeRole(source.kind, target.kind);

  const explanation: Record<string, string> = {
    'client-to-entry':
      'Requests enter the system here. If the client is connected to more than one entry point, it takes turns between them.',
    balance:
      'The load balancer hands each request to one of the application servers behind it — one request goes to exactly one server, never to all of them.',
    'read-backend':
      'The application server reads product data through this connection. If several read backends are connected, it takes turns between them, so each read uses exactly one of them.',
    'cache-fill':
      'On a miss, the cache fetches the product through this connection, stores the answer, and then replies. Hits never travel down this path.',
  };

  return (
    <div className="panel">
      <div className="eyebrow">Connection</div>
      <h3 style={{ fontSize: 14.5 }}>
        {source.label} → {target.label}
      </h3>
      <div className="pill pill-info">{role ?? 'not supported'}</div>
      <p className="tiny" style={{ color: 'var(--ink-2)' }}>
        {role ? explanation[role] : 'This connection is not one the simulation can route requests along.'}
      </p>
      <p className="tiny muted">
        Responses travel back the same way they came, paying the same network hop again. Nothing fans out:
        one request follows exactly one path, so no component ever sees the same request twice.
      </p>
      <button
        type="button"
        className="btn btn-sm"
        disabled={locked}
        onClick={() => {
          dispatch({ type: 'removeEdge', id: edge.id });
          onSelect(null);
        }}
      >
        Remove this connection
      </button>
    </div>
  );
}

function DesignSummary({ architecture }: { architecture: Architecture }) {
  const cost = architectureCost(architecture);
  const counts = new Map<string, number>();
  for (const n of architecture.nodes) counts.set(n.kind, (counts.get(n.kind) ?? 0) + 1);

  return (
    <div className="panel">
      <div className="eyebrow">Your design</div>
      <p className="tiny muted">
        Select a block or a connection on the canvas to configure it. Nothing is selected right now.
      </p>
      <div className="bars">
        {[...counts].map(([kind, count]) => (
          <div key={kind} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
            <span>
              <span
                className="legend-swatch"
                style={{ background: `var(--k-${kind})` }}
                aria-hidden
              />
              {KINDS[kind as keyof typeof KINDS].name}
            </span>
            <span className="mono">×{count}</span>
          </div>
        ))}
      </div>
      <hr className="rule" />
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span className="tiny muted">Relative cost</span>
        <span className="mono" style={{ fontWeight: 650 }}>
          {cost.units} units
        </span>
      </div>
      <p className="tiny muted">
        Teaching units for comparing one design against another — not dollars, and not any provider's
        pricing. Databases cost more than caches, which cost more than a load balancer.
      </p>
      <div className="bars">
        {cost.breakdown.map((row) => (
          <div className="bar-row" key={row.label}>
            <span className="muted">{row.label}</span>
            <span className="bar-track">
              <span
                className="bar-fill"
                style={{ width: `${(row.units / Math.max(1, cost.units)) * 100}%` }}
              />
            </span>
            <span className="bar-num">{row.units}</span>
          </div>
        ))}
      </div>
      <p className="tiny muted">{architecture.edges.length} connections drawn.</p>
    </div>
  );
}
