/**
 * The seam that lets `api/` announce the outcome of a mutation without importing `ui/`.
 *
 * WHY this exists rather than a direct `import { toast } from '../ui/toasts.ts'`: the
 * layering runs downward — `features → store → api → data → engine → domain` — and `ui`
 * sits at the top with `features`. ADR-0057 states the rule for `store`; `api` is a layer
 * further down, so the same edge is worse there, not better.
 *
 * WHY a seam rather than moving the calls up to each `useMutation` call site: that is the
 * arrangement this replaced. `decide.isError` and `cancel.isError` were rendered nowhere,
 * so approving with the API down re-enabled the button and said nothing. One place per
 * mutation family is what makes "every request mutation reports itself" true by
 * construction instead of by remembering.
 *
 * This is the same shape as `setAccessTokenProvider` in `api/client.ts`, for the same
 * reason: something above needs to be reachable from below, so it is injected at startup
 * rather than imported. The default is a no-op, so tests and any consumer that never
 * installs one simply stay silent.
 */
export interface MutationNotifier {
  readonly ok: (message: string) => void;
  readonly bad: (message: string) => void;
}

const silent: MutationNotifier = { ok: () => {}, bad: () => {} };

let notifier: MutationNotifier = silent;

export function setMutationNotifier(next: MutationNotifier | undefined): void {
  notifier = next ?? silent;
}

export function notify(): MutationNotifier {
  return notifier;
}
