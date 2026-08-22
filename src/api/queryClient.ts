/**
 * TanStack Query owns server state (Phase 5) — Zustand (`store/useSchedule.ts`,
 * `store/useUi.ts`) keeps only the draft session and UI state, the separation
 * `Docs/12-architecture.md` claimed but never had before the HTTP cutover.
 *
 * One singleton `QueryClient` for the app: `staleTime` is short (the plan
 * changes under a planner's own edits constantly) but not zero, so painting a
 * range doesn't refetch the same schedule query for every cell in the batch.
 */

import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
