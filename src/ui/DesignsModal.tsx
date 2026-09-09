import { useRef, useState } from 'react';
import {
  makeDocument,
  parseDesign,
  serialize,
  type Architecture,
  type Challenge,
  type DesignDocument,
} from '../sim';
import { Modal } from './Modal';

interface Props {
  challenge: Challenge;
  architecture: Architecture;
  saved: DesignDocument[];
  onSave: (name: string) => void;
  onDelete: (name: string) => void;
  onLoad: (doc: DesignDocument) => void;
  onClose: () => void;
  notify: (message: string, tone?: 'info' | 'bad') => void;
}

export function DesignsModal({
  challenge,
  architecture,
  saved,
  onSave,
  onDelete,
  onLoad,
  onClose,
  notify,
}: Props) {
  const [name, setName] = useState('');
  const [pasted, setPasted] = useState('');
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const doImport = (text: string) => {
    const parsed = parseDesign(text);
    if (!parsed.ok) {
      setImportErrors(parsed.errors);
      return;
    }
    setImportErrors([]);
    if (parsed.doc.challengeId !== challenge.id) {
      notify(
        `That design was built for challenge "${parsed.doc.challengeId}". Loading it anyway — the components are the same.`,
      );
    }
    if (parsed.notes.length > 0) notify(`Imported with ${parsed.notes.length} adjustment(s): ${parsed.notes[0]}`);
    onLoad(parsed.doc);
    onClose();
  };

  const exportNow = () => {
    const doc = makeDocument(challenge.id, name.trim() || 'Conceptually design', architecture);
    const blob = new Blob([serialize(doc)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(doc.name || 'design').replace(/[^a-z0-9-_]+/gi, '-').toLowerCase()}.conceptually.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    notify('Design exported as JSON.');
  };

  return (
    <Modal
      title="Designs"
      subtitle="Saved in this browser. Export to keep a copy or share it."
      onClose={onClose}
      footer={
        <button type="button" className="btn" style={{ marginLeft: 'auto' }} onClick={onClose}>
          Close
        </button>
      }
    >
      <section>
        <h3 style={{ fontSize: 14 }}>Save the design on the canvas</h3>
        <div className="field-row" style={{ marginTop: 8 }}>
          <input
            type="text"
            value={name}
            placeholder="Name this design"
            onChange={(e) => setName(e.target.value)}
            style={{
              flex: 1,
              font: 'inherit',
              padding: '6px 8px',
              border: '1px solid var(--line-strong)',
              borderRadius: 8,
              background: 'var(--surface)',
              color: 'var(--ink)',
            }}
          />
          <button
            type="button"
            className="btn btn-primary"
            disabled={!name.trim()}
            onClick={() => {
              onSave(name.trim());
              setName('');
            }}
          >
            Save
          </button>
          <button type="button" className="btn" onClick={exportNow}>
            Export JSON
          </button>
        </div>
      </section>

      <section>
        <h3 style={{ fontSize: 14 }}>Saved designs</h3>
        {saved.length === 0 ? (
          <p className="tiny muted">Nothing saved yet. Your work in progress is kept automatically anyway.</p>
        ) : (
          <div className="saves-list" style={{ marginTop: 8 }}>
            {saved.map((doc) => (
              <div className="save-row" key={doc.name}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="save-name">{doc.name}</div>
                  <div className="save-meta">
                    {doc.architecture.nodes.length} components · {doc.architecture.edges.length} connections ·{' '}
                    {new Date(doc.savedAt).toLocaleString()}
                  </div>
                </div>
                <button type="button" className="btn btn-sm" onClick={() => { onLoad(doc); onClose(); }}>
                  Load
                </button>
                <button type="button" className="btn btn-sm" onClick={() => onDelete(doc.name)}>
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 style={{ fontSize: 14 }}>Import</h3>
        <p className="tiny muted">
          Pick an exported file, or paste its contents. Anything structurally wrong is reported rather than
          loaded; out-of-range settings are clamped and noted.
        </p>
        <div className="field-row" style={{ marginTop: 8 }}>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="tiny"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              doImport(await file.text());
              if (fileRef.current) fileRef.current.value = '';
            }}
          />
        </div>
        <textarea
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          placeholder='{ "formatVersion": 1, ... }'
          rows={3}
          style={{
            width: '100%',
            marginTop: 8,
            font: '12px/1.5 var(--mono)',
            padding: 8,
            border: '1px solid var(--line-strong)',
            borderRadius: 8,
            background: 'var(--surface)',
            color: 'var(--ink)',
            resize: 'vertical',
          }}
        />
        <button
          type="button"
          className="btn btn-sm"
          style={{ marginTop: 6 }}
          disabled={!pasted.trim()}
          onClick={() => doImport(pasted)}
        >
          Import pasted JSON
        </button>
        {importErrors.length > 0 && (
          <div style={{ marginTop: 10 }}>
            {importErrors.map((err, i) => (
              <div className="issue issue-error" key={i}>
                <span className="issue-mark">✕</span>
                <span>{err}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </Modal>
  );
}
