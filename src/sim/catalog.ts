import type { EdgeRole, NodeKind } from './types';

export interface NumberField {
  type: 'number';
  key: string;
  label: string;
  unit?: string;
  min: number;
  max: number;
  step: number;
  default: number;
  help: string;
}

export interface SelectField {
  type: 'select';
  key: string;
  label: string;
  options: { value: string; label: string }[];
  default: string;
  help: string;
}

export type ConfigField = NumberField | SelectField;

export interface KindSpec {
  kind: NodeKind;
  name: string;
  /** One line, plain language, no jargon. */
  summary: string;
  /** Two or three sentences for the inspector and palette tooltip. */
  description: string;
  /** Optional real-world analogues. Explanatory only — see README limitations. */
  awsAnalogy?: string;
  accent: string;
  fields: ConfigField[];
  /** Can the learner place more than one? */
  multiple: boolean;
  maxInstances: number;
}

/**
 * Allowed connections, keyed `source -> target`, with the role each pair takes.
 * Any pair missing from this table is rejected by validation with an
 * explanation, which is what keeps topology meaningful instead of decorative.
 */
export const EDGE_RULES: Record<string, EdgeRole> = {
  'client>loadBalancer': 'client-to-entry',
  'client>appServer': 'client-to-entry',
  'loadBalancer>appServer': 'balance',
  'appServer>cache': 'read-backend',
  'appServer>database': 'read-backend',
  'appServer>replica': 'read-backend',
  'cache>database': 'cache-fill',
  'cache>replica': 'cache-fill',
};

export function edgeRole(source: NodeKind, target: NodeKind): EdgeRole | null {
  return EDGE_RULES[`${source}>${target}`] ?? null;
}

/** Human-readable reason a connection is not allowed. */
export function edgeRejection(source: NodeKind, target: NodeKind): string {
  const s = KINDS[source].name;
  const t = KINDS[target].name;
  if (source === target) return `A ${s} cannot connect to another ${s} in this model.`;
  if (target === 'client') return `Nothing sends requests *to* a ${t} — it is where traffic starts.`;
  if (source === 'database' || source === 'replica')
    return `A ${s} only answers queries; it never calls anything else. Point the caller at it instead.`;
  if (source === 'cache') return `A ${s} may only fall back to a database or read replica.`;
  if (source === 'client' && (target === 'cache' || target === 'database' || target === 'replica'))
    return `Clients talk to an application or a load balancer, not directly to a ${t}.`;
  if (source === 'loadBalancer')
    return `A ${s} spreads traffic across application servers, so its targets must be application servers.`;
  if (source === 'appServer' && target === 'loadBalancer')
    return `An ${s} reads from a cache, database, or replica. It does not call back into a load balancer.`;
  return `${s} → ${t} is not a connection this simulation models.`;
}

const NETWORK_FIELD: NumberField = {
  type: 'number',
  key: 'networkMs',
  label: 'Network hop',
  unit: 'ms',
  min: 0,
  max: 50,
  step: 1,
  default: 1,
  help: 'Time added each way when a request travels to this component and back.',
};

export const KINDS: Record<NodeKind, KindSpec> = {
  client: {
    kind: 'client',
    name: 'Client traffic',
    summary: 'Where the requests come from.',
    description:
      'Represents the shoppers hitting your catalog. The challenge fixes how many requests arrive and when, so this block has nothing to tune — it is the workload you have to survive.',
    accent: '#7c8cf8',
    multiple: false,
    maxInstances: 1,
    fields: [],
  },

  loadBalancer: {
    kind: 'loadBalancer',
    name: 'Load balancer',
    summary: 'Spreads incoming requests across several application servers.',
    description:
      'Takes one stream of requests and hands each one to a connected application server. It does almost no work itself, so it is rarely the bottleneck — its job is to stop a single application server from being the only door in.',
    awsAnalogy: 'Comparable in spirit to an Application Load Balancer (ALB).',
    accent: '#4bb3c4',
    multiple: true,
    maxInstances: 2,
    fields: [
      {
        type: 'select',
        key: 'algorithm',
        label: 'Algorithm',
        default: 'roundRobin',
        options: [
          { value: 'roundRobin', label: 'Round robin (take turns)' },
          { value: 'leastBusy', label: 'Least busy (fewest in flight)' },
        ],
        help: 'Round robin ignores how loaded each server is. Least busy checks first, which helps when servers respond at different speeds.',
      },
      {
        type: 'number',
        key: 'processingMs',
        label: 'Routing overhead',
        unit: 'ms',
        min: 0,
        max: 20,
        step: 1,
        default: 1,
        help: 'Time spent deciding where to send each request.',
      },
      {
        type: 'number',
        key: 'concurrency',
        label: 'Concurrent routes',
        min: 1,
        max: 4096,
        step: 32,
        default: 1024,
        help: 'How many requests it can route at once. Deliberately generous — a balancer that throttles traffic would hide the lesson.',
      },
      {
        type: 'number',
        key: 'queueCapacity',
        label: 'Queue capacity',
        unit: 'requests',
        min: 0,
        max: 20000,
        step: 100,
        default: 4000,
        help: 'Requests allowed to wait here. When it is full, new requests are rejected.',
      },
      NETWORK_FIELD,
    ],
  },

  appServer: {
    kind: 'appServer',
    name: 'Application server',
    summary: 'Runs your code: receives a request, fetches data, returns a response.',
    description:
      'Each server has a fixed number of workers. A worker stays occupied for the whole request — including the time it spends waiting for a cache or database to answer. That is why a slow database can make application servers look full even when they are barely computing.',
    awsAnalogy: 'Think of one EC2 instance or one container task.',
    accent: '#6ea8fe',
    multiple: true,
    maxInstances: 8,
    fields: [
      {
        type: 'number',
        key: 'concurrency',
        label: 'Workers',
        min: 1,
        max: 512,
        step: 1,
        default: 64,
        help: 'Requests this server can have in progress at once, including time spent waiting on a backend.',
      },
      {
        type: 'number',
        key: 'processingMs',
        label: 'Own compute',
        unit: 'ms',
        min: 0,
        max: 200,
        step: 1,
        default: 3,
        help: 'CPU time the server itself spends per request, on top of waiting for data.',
      },
      {
        type: 'number',
        key: 'queueCapacity',
        label: 'Queue capacity',
        unit: 'requests',
        min: 0,
        max: 20000,
        step: 50,
        default: 1000,
        help: 'Requests allowed to wait for a free worker. Beyond this, requests are rejected immediately.',
      },
      {
        type: 'select',
        key: 'backendPolicy',
        label: 'Backend choice',
        default: 'roundRobin',
        options: [
          { value: 'roundRobin', label: 'Round robin across read backends' },
          { value: 'firstAvailable', label: 'Prefer the first connected backend' },
        ],
        help: 'How this server picks among the caches, databases, and replicas you connected to it.',
      },
      NETWORK_FIELD,
    ],
  },

  cache: {
    kind: 'cache',
    name: 'Cache',
    summary: 'Remembers recent answers in memory so the database is asked less often.',
    description:
      'On a hit the answer comes straight back in a millisecond or two. On a miss the cache asks the database it is connected to, stores the result, and then answers. It only holds a limited number of entries; the least recently used entry is dropped to make room.',
    awsAnalogy: 'In the spirit of ElastiCache (Redis or Memcached).',
    accent: '#f0a35e',
    multiple: true,
    maxInstances: 3,
    fields: [
      {
        type: 'number',
        key: 'capacityEntries',
        label: 'Entries held',
        unit: 'products',
        min: 1,
        max: 2000,
        step: 10,
        default: 250,
        help: 'How many distinct products fit in memory. The catalog is larger than this by design, so what you keep matters.',
      },
      {
        type: 'number',
        key: 'hitLatencyMs',
        label: 'Hit latency',
        unit: 'ms',
        min: 0,
        max: 50,
        step: 1,
        default: 2,
        help: 'Time to answer from memory.',
      },
      {
        type: 'select',
        key: 'eviction',
        label: 'Eviction',
        default: 'lru',
        options: [
          { value: 'lru', label: 'Least recently used' },
          { value: 'fifo', label: 'First in, first out' },
        ],
        help: 'Which entry is dropped when the cache is full. LRU keeps popular products; FIFO does not care how often something is asked for.',
      },
      {
        type: 'number',
        key: 'concurrency',
        label: 'Concurrent lookups',
        min: 1,
        max: 4096,
        step: 32,
        default: 512,
        help: 'Lookups it can serve at once. Memory is fast, so this is high on purpose.',
      },
      {
        type: 'number',
        key: 'queueCapacity',
        label: 'Queue capacity',
        unit: 'requests',
        min: 0,
        max: 20000,
        step: 100,
        default: 4000,
        help: 'Lookups allowed to wait. Rarely reached.',
      },
      NETWORK_FIELD,
    ],
  },

  database: {
    kind: 'database',
    name: 'Database',
    summary: 'The source of truth for product data — accurate, but limited.',
    description:
      'Answers a fixed number of queries at a time; the rest wait in a queue. When that queue is full, further queries are rejected outright and those requests fail. This is the scarce resource in this challenge.',
    awsAnalogy: 'Comparable in spirit to a single RDS primary instance.',
    accent: '#8f7ae5',
    multiple: false,
    maxInstances: 1,
    fields: [
      {
        type: 'number',
        key: 'concurrency',
        label: 'Concurrent queries',
        min: 1,
        max: 256,
        step: 1,
        default: 8,
        help: 'Queries served simultaneously. Raising this is "buy a bigger database" — it works, up to a point, and costs more.',
      },
      {
        type: 'number',
        key: 'serviceTimeMs',
        label: 'Query time',
        unit: 'ms',
        min: 1,
        max: 500,
        step: 1,
        default: 25,
        help: 'How long one product lookup takes. Concurrency ÷ query time sets the ceiling: 8 ÷ 25 ms ≈ 320 queries per second.',
      },
      {
        type: 'number',
        key: 'queueCapacity',
        label: 'Queue capacity',
        unit: 'queries',
        min: 0,
        max: 10000,
        step: 10,
        default: 150,
        help: 'Queries allowed to wait. A deeper queue trades failures for latency; it does not add capacity.',
      },
      NETWORK_FIELD,
    ],
  },

  replica: {
    kind: 'replica',
    name: 'Read replica',
    summary: 'A read-only copy of the database that shares the read load.',
    description:
      'Serves the same catalog as the primary database and can be added several times over. Replicas help when reads are the problem; they add nothing to write capacity, because every write still goes to the primary.',
    awsAnalogy: 'In the spirit of an RDS read replica.',
    accent: '#a78bfa',
    multiple: true,
    maxInstances: 6,
    fields: [
      {
        type: 'number',
        key: 'concurrency',
        label: 'Concurrent queries',
        min: 1,
        max: 256,
        step: 1,
        default: 8,
        help: 'Queries served simultaneously by this replica.',
      },
      {
        type: 'number',
        key: 'serviceTimeMs',
        label: 'Query time',
        unit: 'ms',
        min: 1,
        max: 500,
        step: 1,
        default: 25,
        help: 'How long one lookup takes on this replica.',
      },
      {
        type: 'number',
        key: 'queueCapacity',
        label: 'Queue capacity',
        unit: 'queries',
        min: 0,
        max: 10000,
        step: 10,
        default: 150,
        help: 'Queries allowed to wait at this replica.',
      },
      NETWORK_FIELD,
    ],
  },
};

export const KIND_ORDER: NodeKind[] = [
  'client',
  'loadBalancer',
  'appServer',
  'cache',
  'database',
  'replica',
];

/** Read a numeric config value, falling back to the kind default. */
export function num(config: Record<string, unknown>, kind: NodeKind, key: string): number {
  const raw = config[key];
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const field = KINDS[kind].fields.find((f) => f.key === key);
  if (field && field.type === 'number') return field.default;
  return 0;
}

/** Read a string config value, falling back to the kind default. */
export function str(config: Record<string, unknown>, kind: NodeKind, key: string): string {
  const raw = config[key];
  if (typeof raw === 'string') return raw;
  const field = KINDS[kind].fields.find((f) => f.key === key);
  if (field && field.type === 'select') return field.default;
  return '';
}

export function defaultConfig(kind: NodeKind): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const field of KINDS[kind].fields) out[field.key] = field.default;
  return out;
}
