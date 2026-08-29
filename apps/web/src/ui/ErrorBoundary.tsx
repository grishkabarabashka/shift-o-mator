/**
 * NOTE: the last line of defence (ADR-0057).
 *
 * There was none. A throw during render unmounted the whole tree and left a white page —
 * no message, no way back, and nothing in the UI to suggest a reload would help.
 *
 * That was not hypothetical. `useAdminEdits.saveAll` deliberately rethrew any error that
 * was not a validation failure, out of an async click handler, with no boundary anywhere
 * above it: a 500 or a dropped connection during Settings → Save all produced exactly this.
 *
 * WHY a class: `getDerivedStateFromError` and `componentDidCatch` have no hook equivalent,
 * so React offers no other way. This is the one class component in the codebase, and it is
 * cheaper than adding `react-error-boundary` for forty lines.
 *
 * WHY two of them: one around the whole app catches anything at all, and one inside the
 * shell catches a page and keeps the header and the tabs alive — so a broken screen is one
 * broken screen you can navigate away from, rather than the end of the session.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  readonly children: ReactNode;
  /** What broke, in the user's terms. */
  readonly title: string;
}

interface State {
  readonly error: Error | undefined;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: undefined };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // There is no error-reporting service wired up, and the console is the only place this
    // can go. Losing the stack entirely would make the fallback actively worse than the
    // white page it replaces — at least that one left something in the console.
    console.error('Unhandled error in the UI', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="grid h-full place-items-center p-8">
        <div className="card max-w-md p-6 text-center shadow-elev-2">
          <h2 className="text-lg font-semibold">{this.props.title}</h2>
          <p className="mt-1 text-base text-muted">
            Nothing you had open was sent anywhere. The details are in the browser console.
          </p>
          <p className="mt-2 font-mono text-xs break-words text-faint">{error.message}</p>
          <div className="mt-4 flex justify-center gap-2">
            {/* Clearing the error re-renders the same subtree, which is worth trying when
                the cause was a one-off bad response. Reload is the honest fallback when it
                is not. */}
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => this.setState({ error: undefined })}
            >
              Try again
            </button>
            <button
              type="button"
              className="btn btn--sm btn--primary"
              onClick={() => window.location.reload()}
            >
              Reload the page
            </button>
          </div>
        </div>
      </div>
    );
  }
}
