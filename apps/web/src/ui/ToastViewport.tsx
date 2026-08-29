/**
 * NOTE: where toasts appear, and how a screen reader hears them (ADR-0057).
 *
 * Two live regions rather than one. A success is `role="status"` / `aria-live="polite"` and
 * waits for a pause; a failure is `role="alert"` / `aria-live="assertive"` and interrupts.
 * Putting both in one region would force the choice for every message, and "your leave was
 * approved" is not worth cutting somebody off mid-sentence.
 *
 * Before this the app had no live region at all, so an assistive-technology user got no
 * announcement that a publish, an approval or a save had happened — matching the sighted
 * experience exactly, which was the problem.
 */

import { useToasts } from './toasts.ts';

export function ToastViewport() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);

  const ok = toasts.filter((t) => t.tone === 'ok');
  const bad = toasts.filter((t) => t.tone === 'bad');

  return (
    // `pointer-events-none` on the stack and `auto` on each toast: the region spans the
    // bottom of the screen, and an empty one must not swallow clicks on the grid under it.
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-90 flex flex-col items-center gap-2 p-4">
      <div role="status" aria-live="polite" className="contents">
        {ok.map((t) => (
          <ToastRow key={t.id} tone="ok" message={t.message} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
      <div role="alert" aria-live="assertive" className="contents">
        {bad.map((t) => (
          <ToastRow key={t.id} tone="bad" message={t.message} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </div>
  );
}

function ToastRow({
  tone,
  message,
  onDismiss,
}: {
  readonly tone: 'ok' | 'bad';
  readonly message: string;
  readonly onDismiss: () => void;
}) {
  return (
    <div
      className={`toast pointer-events-auto ${tone === 'ok' ? 'toast--ok' : 'toast--bad'}`}
    >
      <span>{message}</span>
      <button
        type="button"
        className="btn btn--sm btn--ghost"
        onClick={onDismiss}
        aria-label="Dismiss this message"
      >
        ✕
      </button>
    </div>
  );
}
