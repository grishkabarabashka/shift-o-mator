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
import type { AppRole, UnitKind } from '../domain/types.ts';

export type SetupPreset = 'BARE' | 'DEMO';

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
  /**
   * What the founding administrator holds, globally, on top of `Admin` — which the server
   * adds whatever this says, because a system whose only account cannot reach Settings has
   * no way back.
   *
   * Asked at all because `Admin` does not imply `Planner` (ADR-0051): without this the
   * person who just set the system up could not open a draft in it, which is a correct
   * configuration that reads exactly like a broken one.
   */
  readonly roles?: readonly AppRole[];
}

export interface SetupDiagnostics {
  readonly auth: {
    /** As the server resolved it at startup. Not changeable from here: it decides which
     * authentication scheme `Program.cs` registered (ADR-0063). */
    readonly mode: string;
    readonly authority: string | null;
    readonly audience: string | null;
    readonly directoryRoles: boolean;
  };
  readonly caller: {
    readonly personId: string | null;
    readonly displayName: string | null;
    readonly tokenEmail: string | null;
    readonly linked: boolean;
    readonly grants: readonly { readonly role: string; readonly unitId: string | null }[];
  };
  readonly content: {
    readonly people: number;
    readonly plannedPeople: number;
    readonly units: number;
    readonly shifts: number;
    readonly dayConfigurations: number;
  };
  readonly ai: { readonly provider: string; readonly configured: boolean };
}

/**
 * What this system is and who you are in it. Authenticated but not necessarily *anybody*:
 * the caller who most needs this is the one whose token matches no person.
 *
 * `staleTime: 0` because it is read either side of a write that changes every answer in
 * it — the wizard asks before setting up and again to say what is still missing.
 */
export function useSetupDiagnostics(enabled = true) {
  return useQuery({
    queryKey: ['setup', 'diagnostics'],
    queryFn: () => apiGet<SetupDiagnostics>('/api/setup/diagnostics'),
    staleTime: 0,
    enabled,
    retry: false,
  });
}

export interface SetupResult {
  readonly preset: SetupPreset;
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
    mutationFn: (args: { preset: SetupPreset; bare?: BareSetupFields; directoryRoles?: boolean }) =>
      apiPost<SetupResult>('/api/setup', {
        preset: args.preset,
        directoryRoles: args.directoryRoles ?? false,
        bare: args.bare
          ? {
              locationName: args.bare.locationName,
              timeZone: args.bare.timeZone,
              holidayCalendarKey: args.bare.holidayCalendarKey,
              unitName: args.bare.unitName,
              unitKind: unitKindToWire(args.bare.unitKind),
              displayName: args.bare.displayName,
              email: args.bare.email,
              roles: args.bare.roles,
            }
          : undefined,
      }),
    onSuccess: () => {
      // Diagnostics only. The gate is *not* flipped here on purpose: `setup.state` going
      // to `required: false` swaps the wizard for the app mid-render, and the wizard has
      // one more thing to say — what the system still lacks. `useFinishSetup` below is the
      // button that ends it.
      void queryClient.invalidateQueries({ queryKey: ['setup', 'diagnostics'] });
    },
  });
}

/** Leaves the wizard for the app. Separate from completing setup so the summary of what
 * was written — and what is still missing — gets read before it disappears. */
export function useFinishSetup() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: STATE_KEY });
  };
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
