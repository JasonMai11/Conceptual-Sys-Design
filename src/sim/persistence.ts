import { KINDS, defaultConfig } from './catalog';
import type { ArchNode, Architecture, DesignDocument, NodeKind } from './types';

export const FORMAT_VERSION = 1 as const;

export interface ParseSuccess {
  ok: true;
  doc: DesignDocument;
  /** Non-fatal repairs applied while reading (clamped values, dropped extras). */
  notes: string[];
}
export interface ParseFailure {
  ok: false;
  errors: string[];
}
export type ParseResult = ParseSuccess | ParseFailure;

export function makeDocument(
  challengeId: string,
  name: string,
  architecture: Architecture,
): DesignDocument {
  return {
    formatVersion: FORMAT_VERSION,
    challengeId,
    name,
    savedAt: new Date().toISOString(),
    architecture: cloneArchitecture(architecture),
  };
}

export function serialize(doc: DesignDocument): string {
  return JSON.stringify(doc, null, 2);
}

export function cloneArchitecture(arch: Architecture): Architecture {
  return {
    nodes: arch.nodes.map((n) => ({ ...n, position: { ...n.position }, config: { ...n.config } })),
    edges: arch.edges.map((e) => ({ ...e })),
  };
}

/**
 * Reads an exported design defensively. Anything structurally wrong is an
 * error; anything merely out of range is clamped and reported, so a
 * hand-edited file still loads with an explanation instead of silently
 * producing a nonsense simulation.
 */
export function parseDesign(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { ok: false, errors: [`This is not valid JSON: ${(err as Error).message}`] };
  }
  return validateDocument(raw);
}

export function validateDocument(raw: unknown): ParseResult {
  const errors: string[] = [];
  const notes: string[] = [];

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ['The file must contain a single design object.'] };
  }
  const obj = raw as Record<string, unknown>;

  if (obj.formatVersion !== FORMAT_VERSION) {
    errors.push(
      `Unsupported formatVersion ${JSON.stringify(obj.formatVersion)} — this build reads version ${FORMAT_VERSION}.`,
    );
  }
  const challengeId = typeof obj.challengeId === 'string' ? obj.challengeId : '';
  if (!challengeId) errors.push('Missing "challengeId".');

  const archRaw = obj.architecture;
  if (typeof archRaw !== 'object' || archRaw === null) {
    errors.push('Missing "architecture".');
    return { ok: false, errors };
  }
  const arch = archRaw as Record<string, unknown>;
  if (!Array.isArray(arch.nodes)) errors.push('"architecture.nodes" must be an array.');
  if (!Array.isArray(arch.edges)) errors.push('"architecture.edges" must be an array.');
  if (errors.length) return { ok: false, errors };

  const nodes: ArchNode[] = [];
  const seenIds = new Set<string>();

  for (const [i, item] of (arch.nodes as unknown[]).entries()) {
    if (typeof item !== 'object' || item === null) {
      errors.push(`Node ${i} is not an object.`);
      continue;
    }
    const nodeRaw = item as Record<string, unknown>;
    const id = typeof nodeRaw.id === 'string' ? nodeRaw.id : '';
    const kind = nodeRaw.kind as NodeKind;
    if (!id) {
      errors.push(`Node ${i} has no "id".`);
      continue;
    }
    if (seenIds.has(id)) {
      errors.push(`Duplicate node id "${id}".`);
      continue;
    }
    if (!(kind in KINDS)) {
      errors.push(`Node "${id}" has unknown kind ${JSON.stringify(nodeRaw.kind)}.`);
      continue;
    }
    seenIds.add(id);

    const pos = nodeRaw.position as Record<string, unknown> | undefined;
    const x = typeof pos?.x === 'number' && Number.isFinite(pos.x) ? pos.x : 0;
    const y = typeof pos?.y === 'number' && Number.isFinite(pos.y) ? pos.y : 0;
    if (!pos) notes.push(`Node "${id}" had no position; placed at the origin.`);

    const config: Record<string, number | string | boolean> = defaultConfig(kind);
    const providedConfig =
      typeof nodeRaw.config === 'object' && nodeRaw.config !== null
        ? (nodeRaw.config as Record<string, unknown>)
        : {};
    for (const field of KINDS[kind].fields) {
      const provided = providedConfig[field.key];
      if (provided === undefined) continue;
      if (field.type === 'number') {
        if (typeof provided !== 'number' || !Number.isFinite(provided)) {
          notes.push(`"${id}.${field.key}" was not a number; using the default ${field.default}.`);
          continue;
        }
        const clamped = Math.min(field.max, Math.max(field.min, provided));
        if (clamped !== provided) {
          notes.push(
            `"${id}.${field.key}" was ${provided}, outside ${field.min}–${field.max}; clamped to ${clamped}.`,
          );
        }
        config[field.key] = clamped;
      } else {
        const allowed = field.options.map((o) => o.value);
        if (typeof provided !== 'string' || !allowed.includes(provided)) {
          notes.push(
            `"${id}.${field.key}" was ${JSON.stringify(provided)}; using the default "${field.default}".`,
          );
          continue;
        }
        config[field.key] = provided;
      }
    }
    for (const key of Object.keys(providedConfig)) {
      if (!KINDS[kind].fields.some((f) => f.key === key)) {
        notes.push(`Ignored unknown setting "${key}" on node "${id}".`);
      }
    }

    nodes.push({
      id,
      kind,
      label: typeof nodeRaw.label === 'string' && nodeRaw.label ? nodeRaw.label : KINDS[kind].name,
      position: { x, y },
      config,
    });
  }

  const edges: Architecture['edges'] = [];
  const seenEdgeIds = new Set<string>();
  for (const [i, item] of (arch.edges as unknown[]).entries()) {
    if (typeof item !== 'object' || item === null) {
      errors.push(`Connection ${i} is not an object.`);
      continue;
    }
    const edgeRaw = item as Record<string, unknown>;
    const source = typeof edgeRaw.source === 'string' ? edgeRaw.source : '';
    const target = typeof edgeRaw.target === 'string' ? edgeRaw.target : '';
    if (!seenIds.has(source) || !seenIds.has(target)) {
      errors.push(
        `Connection ${i} refers to a component that is not in the file (${JSON.stringify(source)} → ${JSON.stringify(target)}).`,
      );
      continue;
    }
    const id = typeof edgeRaw.id === 'string' && edgeRaw.id ? edgeRaw.id : `${source}__${target}`;
    if (seenEdgeIds.has(id)) {
      notes.push(`Dropped a duplicate connection id "${id}".`);
      continue;
    }
    seenEdgeIds.add(id);
    edges.push({ id, source, target });
  }

  if (nodes.length === 0) errors.push('The design has no components.');
  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    notes,
    doc: {
      formatVersion: FORMAT_VERSION,
      challengeId,
      name: typeof obj.name === 'string' && obj.name ? obj.name : 'Imported design',
      savedAt: typeof obj.savedAt === 'string' ? obj.savedAt : new Date().toISOString(),
      architecture: { nodes, edges },
    },
  };
}

/* ------------------------------------------------------------------ */
/* localStorage                                                        */
/* ------------------------------------------------------------------ */

const PREFIX = 'conceptually.v1';
export const STORAGE_KEYS = {
  autosave: `${PREFIX}.autosave`,
  saves: `${PREFIX}.saves`,
  onboarded: `${PREFIX}.onboarded`,
  prefs: `${PREFIX}.prefs`,
};

/** Every access is guarded: private windows and blocked site data must not throw. */
function readKey(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeKey(key: string, value: string): boolean {
  try {
    globalThis.localStorage?.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function loadAutosave(): DesignDocument | null {
  const text = readKey(STORAGE_KEYS.autosave);
  if (!text) return null;
  const parsed = parseDesign(text);
  return parsed.ok ? parsed.doc : null;
}

export function saveAutosave(doc: DesignDocument): void {
  writeKey(STORAGE_KEYS.autosave, serialize(doc));
}

export function loadSavedDesigns(): DesignDocument[] {
  const text = readKey(STORAGE_KEYS.saves);
  if (!text) return [];
  try {
    const raw = JSON.parse(text);
    if (!Array.isArray(raw)) return [];
    const out: DesignDocument[] = [];
    for (const item of raw) {
      const parsed = validateDocument(item);
      if (parsed.ok) out.push(parsed.doc);
    }
    return out;
  } catch {
    return [];
  }
}

export function writeSavedDesigns(docs: DesignDocument[]): boolean {
  return writeKey(STORAGE_KEYS.saves, JSON.stringify(docs));
}

export function hasOnboarded(): boolean {
  return readKey(STORAGE_KEYS.onboarded) === 'true';
}

export function setOnboarded(value: boolean): void {
  writeKey(STORAGE_KEYS.onboarded, String(value));
}

export interface Prefs {
  reducedMotion: boolean | null;
  speed: number;
}

export function loadPrefs(): Prefs {
  const text = readKey(STORAGE_KEYS.prefs);
  if (!text) return { reducedMotion: null, speed: 1 };
  try {
    const raw = JSON.parse(text) as Partial<Prefs>;
    return {
      reducedMotion: typeof raw.reducedMotion === 'boolean' ? raw.reducedMotion : null,
      speed: typeof raw.speed === 'number' && raw.speed > 0 ? raw.speed : 1,
    };
  } catch {
    return { reducedMotion: null, speed: 1 };
  }
}

export function savePrefs(prefs: Prefs): void {
  writeKey(STORAGE_KEYS.prefs, JSON.stringify(prefs));
}
