import { describe, expect, it } from 'vitest';
import {
  FORMAT_VERSION,
  cloneArchitecture,
  makeDocument,
  parseDesign,
  serialize,
} from '../src/sim/persistence';
import { SURVIVE_THE_SPIKE } from '../src/sim/challenges';
import { runArchitecture } from '../src/sim/engine';
import { CACHED } from './fixtures';

const CH = SURVIVE_THE_SPIKE;

describe('export and import', () => {
  it('round-trips a design without changing what it simulates', () => {
    const doc = makeDocument(CH.id, 'My design', CACHED);
    const parsed = parseDesign(serialize(doc));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.notes).toEqual([]);
    expect(parsed.doc.architecture).toEqual(cloneArchitecture(CACHED));
    expect(runArchitecture(parsed.doc.architecture, CH).metrics).toEqual(
      runArchitecture(CACHED, CH).metrics,
    );
  });

  it('preserves positions, names, and settings', () => {
    const doc = makeDocument(CH.id, 'Tweaked', {
      ...CACHED,
      nodes: CACHED.nodes.map((n) =>
        n.kind === 'cache'
          ? { ...n, label: 'Hot products', position: { x: 42, y: -17 }, config: { ...n.config, capacityEntries: 900 } }
          : n,
      ),
    });
    const parsed = parseDesign(serialize(doc));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const cache = parsed.doc.architecture.nodes.find((n) => n.kind === 'cache')!;
    expect(cache.label).toBe('Hot products');
    expect(cache.position).toEqual({ x: 42, y: -17 });
    expect(cache.config.capacityEntries).toBe(900);
  });

  it('rejects malformed input instead of guessing', () => {
    for (const bad of ['', 'not json', '[]', '{}', '{"formatVersion":1}']) {
      const parsed = parseDesign(bad);
      expect(parsed.ok, bad).toBe(false);
      if (!parsed.ok) expect(parsed.errors.length).toBeGreaterThan(0);
    }
  });

  it('refuses a future format version', () => {
    const parsed = parseDesign(JSON.stringify({ formatVersion: 99, challengeId: 'x', architecture: { nodes: [], edges: [] } }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors.join(' ')).toMatch(/formatVersion/);
  });

  it('refuses unknown component kinds and duplicate ids', () => {
    const unknown = parseDesign(
      JSON.stringify({
        formatVersion: FORMAT_VERSION,
        challengeId: CH.id,
        architecture: { nodes: [{ id: 'a', kind: 'quantumCache' }], edges: [] },
      }),
    );
    expect(unknown.ok).toBe(false);

    const dupes = parseDesign(
      JSON.stringify({
        formatVersion: FORMAT_VERSION,
        challengeId: CH.id,
        architecture: {
          nodes: [
            { id: 'a', kind: 'client' },
            { id: 'a', kind: 'appServer' },
          ],
          edges: [],
        },
      }),
    );
    expect(dupes.ok).toBe(false);
    if (!dupes.ok) expect(dupes.errors.join(' ')).toMatch(/Duplicate/);
  });

  it('refuses a connection to a component that is not in the file', () => {
    const parsed = parseDesign(
      JSON.stringify({
        formatVersion: FORMAT_VERSION,
        challengeId: CH.id,
        architecture: {
          nodes: [{ id: 'client', kind: 'client' }],
          edges: [{ id: 'e', source: 'client', target: 'nowhere' }],
        },
      }),
    );
    expect(parsed.ok).toBe(false);
  });

  it('clamps out-of-range settings and says so, rather than simulating nonsense', () => {
    const parsed = parseDesign(
      JSON.stringify({
        formatVersion: FORMAT_VERSION,
        challengeId: CH.id,
        architecture: {
          nodes: [
            { id: 'client', kind: 'client' },
            { id: 'app', kind: 'appServer', config: { concurrency: -50, processingMs: 1e9, mystery: 3 } },
            { id: 'db', kind: 'database', config: { serviceTimeMs: 'fast', queueCapacity: 10 } },
          ],
          edges: [
            { id: 'e1', source: 'client', target: 'app' },
            { id: 'e2', source: 'app', target: 'db' },
          ],
        },
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const app = parsed.doc.architecture.nodes.find((n) => n.id === 'app')!;
    expect(app.config.concurrency).toBe(1);
    expect(app.config.processingMs).toBe(200);
    expect(app.config).not.toHaveProperty('mystery');
    const db = parsed.doc.architecture.nodes.find((n) => n.id === 'db')!;
    expect(db.config.serviceTimeMs).toBe(25); // fell back to the default
    expect(db.config.queueCapacity).toBe(10);
    expect(parsed.notes.length).toBeGreaterThanOrEqual(4);
    expect(parsed.notes.join(' ')).toMatch(/clamped/);
  });

  it('fills in missing settings with the component defaults', () => {
    const parsed = parseDesign(
      JSON.stringify({
        formatVersion: FORMAT_VERSION,
        challengeId: CH.id,
        architecture: {
          nodes: [
            { id: 'client', kind: 'client' },
            { id: 'app', kind: 'appServer' },
            { id: 'db', kind: 'database' },
          ],
          edges: [
            { source: 'client', target: 'app' },
            { source: 'app', target: 'db' },
          ],
        },
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const app = parsed.doc.architecture.nodes.find((n) => n.id === 'app')!;
    expect(app.config.concurrency).toBe(64);
    expect(parsed.doc.architecture.edges[0].id).toBe('client__app');
    // And the imported design behaves exactly like the built-in starting point.
    expect(runArchitecture(parsed.doc.architecture, CH).metrics.completed).toBe(
      runArchitecture(CH.startingArchitecture, CH).metrics.completed,
    );
  });
});
