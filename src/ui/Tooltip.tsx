import { useEffect, useId, useRef, useState } from 'react';

/**
 * A definition popover attached to a real button, so it opens on hover *and* on
 * keyboard focus, and is announced through `aria-describedby`.
 */
export function Tooltip({ label, children }: { label: string; children: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  return (
    <span className="tip" ref={ref}>
      <button
        type="button"
        className="tip-btn"
        aria-label={`What is ${label}?`}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        ?
      </button>
      {open && (
        <span className="tip-bubble" id={id} role="tooltip">
          {children}
        </span>
      )}
    </span>
  );
}
