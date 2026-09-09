import { useCallback, useRef, useState } from 'react';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'bad';
  action?: ToastAction;
}

/** Toasts carrying an action stay up longer — you have to decide to use them. */
const PLAIN_MS = 6000;
const WITH_ACTION_MS = 12000;

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (message: string, tone: Toast['tone'] = 'info', action?: ToastAction) => {
      const id = nextId.current++;
      setToasts((list) => [...list.slice(-2), { id, message, tone, action }]);
      window.setTimeout(() => dismiss(id), action ? WITH_ACTION_MS : PLAIN_MS);
      return id;
    },
    [dismiss],
  );

  return { toasts, push, dismiss };
}

export function Toasts({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast${t.tone === 'bad' ? ' bad' : ''}`}>
          <span className="toast-msg">{t.message}</span>
          {t.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                t.action!.onClick();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button type="button" className="toast-close" onClick={() => dismiss(t.id)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
