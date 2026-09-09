import type { NodeKind } from '../sim';

/**
 * Component illustrations, drawn locally as inline SVG so every block has a
 * recognisable silhouette at a glance and at any size. `currentColor` picks up
 * the kind accent from CSS, and each shape is distinct in outline alone so the
 * set still reads when colour is unavailable.
 */
export function Art({ kind, size = 32 }: { kind: NodeKind; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 32 32',
    fill: 'none',
    'aria-hidden': true as const,
    focusable: 'false' as const,
  };
  const stroke = { stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const tint = { fill: 'currentColor', opacity: 0.13 };

  switch (kind) {
    case 'client':
      return (
        <svg {...common}>
          <rect x="3.5" y="5.5" width="25" height="17" rx="3" {...tint} />
          <rect x="3.5" y="5.5" width="25" height="17" rx="3" {...stroke} />
          <path d="M3.5 10.5h25" {...stroke} />
          <circle cx="7.2" cy="8" r="0.9" fill="currentColor" />
          <circle cx="10" cy="8" r="0.9" fill="currentColor" />
          <path d="M9 16.5h8M9 19.5h5" {...stroke} />
          <path d="M11 26.5h10" {...stroke} />
          <path d="M16 22.5v4" {...stroke} />
          <path d="M20.5 15.5l6 3.2-2.6 1 1.6 2.5-1.6 1-1.7-2.5-1.7 1.6z" fill="currentColor" />
        </svg>
      );

    case 'loadBalancer':
      return (
        <svg {...common}>
          <path d="M16 3.5l9 6v13l-9 6-9-6v-13z" {...tint} />
          <path d="M16 3.5l9 6v13l-9 6-9-6v-13z" {...stroke} />
          <path d="M11 16h4" {...stroke} />
          <path d="M15 16l5-5.5M15 16l5 5.5M15 16h5.5" {...stroke} />
          <circle cx="21.5" cy="10" r="1.7" fill="currentColor" />
          <circle cx="22" cy="16" r="1.7" fill="currentColor" />
          <circle cx="21.5" cy="22" r="1.7" fill="currentColor" />
        </svg>
      );

    case 'appServer':
      return (
        <svg {...common}>
          <rect x="4.5" y="4.5" width="23" height="23" rx="4" {...tint} />
          <rect x="4.5" y="4.5" width="23" height="23" rx="4" {...stroke} />
          <path d="M13 11.5L9.5 16l3.5 4.5M19 11.5l3.5 4.5-3.5 4.5" {...stroke} />
          <path d="M16.8 10.5l-1.6 11" {...stroke} />
        </svg>
      );

    case 'cache':
      return (
        <svg {...common}>
          <rect x="4.5" y="7.5" width="23" height="17" rx="3" {...tint} />
          <rect x="4.5" y="7.5" width="23" height="17" rx="3" {...stroke} />
          <path d="M9 7.5v-3M13.7 7.5v-3M18.3 7.5v-3M23 7.5v-3M9 27.5v-3M13.7 27.5v-3M18.3 27.5v-3M23 27.5v-3" {...stroke} />
          <path d="M17.6 10.5l-5.1 6.2h3.4l-1.5 4.8 5.1-6.6h-3.4z" fill="currentColor" />
        </svg>
      );

    case 'database':
      return (
        <svg {...common}>
          <path d="M5.5 8c0-2 4.7-3.6 10.5-3.6S26.5 6 26.5 8v16c0 2-4.7 3.6-10.5 3.6S5.5 26 5.5 24z" {...tint} />
          <ellipse cx="16" cy="8" rx="10.5" ry="3.6" {...stroke} />
          <path d="M5.5 8v16c0 2 4.7 3.6 10.5 3.6S26.5 26 26.5 24V8" {...stroke} />
          <path d="M5.5 14.7c0 2 4.7 3.6 10.5 3.6s10.5-1.6 10.5-3.6" {...stroke} />
          <path d="M5.5 20.7c0 2 4.7 3.6 10.5 3.6s10.5-1.6 10.5-3.6" {...stroke} />
        </svg>
      );

    case 'replica':
      return (
        <svg {...common}>
          <path d="M11.5 9.5c0-1.7 3.7-3 8-3s8 1.3 8 3v14c0 1.7-3.7 3-8 3s-8-1.3-8-3z" {...tint} />
          <path d="M8 6.5c-1.6.5-2.5 1.2-2.5 2v14c0 1.4 2.6 2.6 6 2.9" {...stroke} strokeDasharray="2.6 2.4" />
          <ellipse cx="19.5" cy="9.5" rx="8" ry="3" {...stroke} />
          <path d="M11.5 9.5v14c0 1.7 3.7 3 8 3s8-1.3 8-3v-14" {...stroke} />
          <path d="M11.5 16.5c0 1.7 3.7 3 8 3s8-1.3 8-3" {...stroke} />
          <path d="M9.5 12.5l2.2-2.2" {...stroke} />
        </svg>
      );
  }
}

/** The three-block sketch used in the walkthrough. */
export function StarterSketch() {
  return (
    <svg width="100%" viewBox="0 0 420 100" fill="none" aria-hidden focusable="false" style={{ maxWidth: 420 }}>
      {[
        { x: 8, label: 'Shoppers', color: 'var(--k-client)' },
        { x: 152, label: 'App server', color: 'var(--k-appServer)' },
        { x: 296, label: 'Database', color: 'var(--k-database)' },
      ].map((b) => (
        <g key={b.label}>
          <rect x={b.x} y={26} width={116} height={48} rx={10} fill="var(--surface)" stroke={b.color} strokeWidth={1.6} />
          <text x={b.x + 58} y={55} textAnchor="middle" fontSize="12.5" fill="var(--ink)" fontWeight="600">
            {b.label}
          </text>
        </g>
      ))}
      {[130, 274].map((x) => (
        <g key={x}>
          <path d={`M${x} 50h16`} stroke="var(--line-strong)" strokeWidth={1.6} />
          <path d={`M${x + 12} 46l5 4-5 4`} stroke="var(--line-strong)" strokeWidth={1.6} fill="none" />
        </g>
      ))}
    </svg>
  );
}
