/**
 * The setup wizard and Settings → Maintenance (ADR-0059) — what replaced the
 * `Seed:IncludeDemoData` / `--seed-demo` / `Auth:BootstrapAdminEmail` configuration keys.
 *
 * `GET /api/setup/state` is the one anonymous read besides the calendar feed: it has to
 * answer before `AuthProvider` has anything, and every other route is refused with
 * `SETUP_REQUIRED` while it says `required: true` — including `/api/auth/me`, which is
 * why `stubMode` rides along here instead of being read off that endpoint.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from './client.ts';
import type { UnitKind } from '../domain/types.ts';

export type SetupPreset = 'Bare' | 'Demo';

export interface SetupState {
  readonly required: boolean;
  /** True only when the server runs `Auth:Mode=Stub` — the wizard asks for a display
   * name and email itself only then; any other mode reads them from the caller's own
   * token and ignores whatever the client sends. */
  readonly stubMode: boolean;
}

export interface BareSetupFields {
  readonly locationName: string;
  readonly timeZone: string;
  readonly holidayCalendarKey: string;
  readonly unitName: string;
  readonly unitKind: UnitKind;
  /** Stub mode only — ignored by the server in every other mode. */
  readonly displayName?: string;
  readonly email?: string;
}

export interface SetupResult {
  readonly preset: 'bare' | 'demo';
  readonly adminPersonId: string | null;
  readonly adminDisplayName: string | null;
}

const STATE_KEY = ['setup', 'state'] as const;

export function useSetupState() {
  return useQuery({
    queryKey: STATE_KEY,
    queryFn: () => apiGet<SetupState>('/api/setup/state'),
    // Every other query in the app is blocked on the answer to this one — a stale
    // "required: true" after the wizard just finished would strand the app on its own
    // splash screen with nothing to retry it.
    staleTime: 0,
  });
}

export function useCompleteSetup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { preset: SetupPreset; bare?: BareSetupFields }) =>
      apiPost<SetupResult>('/api/setup', {
        preset: args.preset === 'Bare' ? 'bare' : 'demo',
        bare: args.bare
          ? {
              locationName: args.bare.locationName,
              timeZone: args.bare.timeZone,
              holidayCalendarKey: args.bare.holidayCalendarKey,
              unitName: args.bare.unitName,
              unitKind: unitKindToWire(args.bare.unitKind),
              displayName: args.bare.displayName,
              email: args.bare.email,
            }
          : undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: STATE_KEY });
    },
  });
}

function unitKindToWire(kind: UnitKind): string {
  return kind === 'REGION' ? 'region' : 'crossRegion';
}

// ---------------------------------------------------------------------------
// Settings → Maintenance
// ---------------------------------------------------------------------------

export function useCanLoadDemoData() {
  return useQuery({
    queryKey: ['setup', 'can-load-demo-data'],
    queryFn: () => apiGet<{ available: boolean }>('/api/admin/maintenance/can-load-demo-data'),
  });
}

export function useLoadDemoData() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost('/api/admin/maintenance/load-demo-data'),
    onSuccess: () => {
      // Everything the app has cached — reference data, the roster, the grid — describes
      // a system this call just replaced wholesale.
      void queryClient.invalidateQueries();
    },
  });
}

export function useResetSystem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost('/api/admin/maintenance/reset'),
    onSuccess: () => {
      void queryClient.invalidateQueries();
    },
  });
}
