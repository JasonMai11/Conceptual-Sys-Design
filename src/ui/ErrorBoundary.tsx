import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Without this, any render-time exception unmounts the whole tree and leaves a
 * blank page with nothing to act on. Show what broke, and offer the two things
 * that actually recover: reload, or reload having cleared the stored design in
 * case that is what is malformed.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Conceptually crashed while rendering:', error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div style={{ padding: 32, maxWidth: 680, margin: '0 auto' }}>
        <div className="verdict verdict-invalid">
          <h3>Something in the interface broke.</h3>
          <p className="tiny" style={{ marginTop: 6 }}>
            This is a bug in Conceptually, not in your design. Your work in progress is saved in this
            browser, so reloading should bring it back.
          </p>
        </div>

        <div className="card" style={{ marginTop: 14 }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>What went wrong</div>
          <p className="mono tiny" style={{ margin: 0, wordBreak: 'break-word' }}>
            {error.message || String(error)}
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            Reload the app
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              try {
                window.localStorage.removeItem('conceptually.v1.autosave');
              } catch {
                /* storage may be blocked; reloading is still worth a try */
              }
              window.location.reload();
            }}
          >
            Discard the saved design and reload
          </button>
        </div>
      </div>
    );
  }
}
