/**
 * The signed-in identity and what it may do, read from `GET /api/auth/me`.
 *
 * WHY a network call and not a constant: the client used to hard-code the same fixed
 * identity the server's stub issues, *and* `useSchedule.load()` separately guessed a
 * "current user" by picking the first manager in scope. Those two answers routinely
 * disagreed with each other and both disagreed with what the audit trail recorded
 * (ADR-0039). There is now one answer, and the server gives it.
 *
 * WHY the identity carries a *list* of grants: roles are a set, and each one is scoped to
 * a planning unit (ADR-0051). "What is my role" has no single answer — somebody can plan
 * AMER, approve EMEA and administer neither.
 *
 * The endpoint's shape does not change when `Auth:Mode` switches from `Stub` to a real
 * IdP — only the identity behind it does.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { apiGet, getImpersonation, setDebugIdentity } from '../api/client.ts';
import { startImpersonation, stopImpersonation } from '../api/impersonation.ts';

// `AppRole`/`APP_ROLES` live in `domain/` (ADR-0066 casing, ADR-0051 semantics) and are
// re-exported here because most callers reach for them alongside the identity.
export { APP_ROLES, type AppRole } from '../domain/types.ts';
import { APP_ROLES, type AppRole } from '../domain/types.ts';

/** One role in one unit. `unitId` undefined is a global grant: every unit. */
export interface RoleGrant {
  readonly role: AppRole;
  readonly unitId: string | undefined;
}

export interface AuthIdentity {
  readonly personId: string;
  readonly displayName: string;
  readonly grants: readonly RoleGrant[];
  /** NOTE: false while `/api/auth/me` is still in flight or has failed. */
  readonly resolved: boolean;
  /** NOTE: true only when the server runs `Auth:Mode=Stub`, which is the only mode that
   * honours the dev identity headers. Gates the switcher out of any real deployment. */
  readonly stubMode: boolean;
  /**
   * The administrator behind an open lens, or undefined (ADR-0069).
   *
   * NOTE: when this is set, every field above describes the **subject** — that is the
   * whole point. What it does not change is who a write is attributed to, which is still
   * the person named here.
   */
  readonly impersonatedBy?: { readonly personId: string; readonly displayName: string };
  /** Holds Admin somewhere, so the lens is worth offering. Whether it may be opened over a
   * *particular* person is the server's answer, on the POST. */
  readonly canImpersonate?: boolean;
}

interface WireMe {
  readonly personId?: string | null;
  readonly displayName?: string | null;
  readonly roles?: readonly { role?: string | null; unitId?: string | null }[] | null;
  readonly stubMode?: boolean;
  readonly impersonatedBy?: { readonly personId?: string | null; readonly displayName?: string | null } | null;
  readonly canImpersonate?: boolean;
}

/**
 * NOTE: the pre-resolution placeholder. It is deliberately *not* a plausible person:
 * nothing may be written under it, and `resolved: false` is what callers gate on.
 */
const UNRESOLVED: AuthIdentity = {
  personId: '',
  displayName: 'Signing in…',
  grants: [],
  resolved: false,
  stubMode: false,
};

export interface DebugIdentity {
  readonly personId?: string;
  /**
   * Comma-separated on the wire: the stub grants a *set*.
   *
   * `undefined` means "use whatever this person really holds". An empty **array** of roles
   * is a different thing — "override them down to nothing" — and is sent as the literal
   * `Viewer`, because everyone signed in is a Viewer and an empty header is indistinguish-
   * able from no header at all. Without that distinction there was no way to test what a
   * plain Viewer sees.
   */
  readonly role?: string;
}

/** The switcher's current override, so the UI can tell "no override" from "overridden to
 * nothing" — two states that look identical in the resulting grant list. */
export interface SwitcherState {
  readonly override: DebugIdentity | undefined;
  readonly set: Dispatch<SetStateAction<DebugIdentity | undefined>>;
}

/** The open lens, so the provider can re-key `/api/auth/me` and the shell can close it. */
interface LensState {
  readonly subject: string | undefined;
  readonly set: Dispatch<SetStateAction<string | undefined>>;
}

const AuthContext = createContext<AuthIdentity | undefined>(undefined);
const SwitcherContext = createContext<SwitcherState | undefined>(undefined);
const LensContext = createContext<LensState | undefined>(undefined);

export function AuthProvider({
  children,
  identity,
}: {
  readonly children: ReactNode;
  readonly identity?: AuthIdentity;
}) {
  // WHY the override lives in React state and not only in the fetch client: the switcher
  // has to reflect the choice on the very next render. Deriving it from the query meant
  // the picker showed nothing until the refetch landed, which read as "the dropdown does
  // not select".
  const [override, setOverride] = useState<DebugIdentity>();

  // WHY the lens subject is React state as well as a module variable in `api/client.ts`:
  // the query key below has to change when it does, or switching person would answer from
  // the cached `/api/auth/me` of the person before. The module variable is what puts the
  // header on every *other* request; this is what makes this one refetch.
  const [lens, setLens] = useState<string | undefined>(() => getImpersonation());

  const query = useQuery({
    queryKey: ['auth', 'me', override?.personId ?? '', override?.role ?? '', lens ?? ''],
    queryFn: () => apiGet<WireMe>('/api/auth/me'),
    enabled: identity === undefined,
    staleTime: Infinity,
    retry: 1,
  });

  const value = useMemo<AuthIdentity>(() => {
    if (identity) return identity;
    const me = query.data;
    if (!me?.personId) {
      // Keep the chosen roles visible while the round trip is in flight, so the switcher
      // never appears to reject the click.
      return override?.role ? { ...UNRESOLVED, grants: parseOverride(override.role) } : UNRESOLVED;
    }
    return {
      personId: me.personId,
      displayName: me.displayName ?? me.personId,
      grants: (me.roles ?? [])
        .map((grant) => ({
          role: normalizeRole(grant.role),
          unitId: grant.unitId ?? undefined,
        }))
        .filter((grant): grant is RoleGrant => grant.role !== undefined),
      resolved: true,
      stubMode: me.stubMode === true,
      // Everything above describes the subject while this is set — the server decides
      // that, not the client, so there is nothing to merge here (ADR-0069).
      ...(me.impersonatedBy?.personId
        ? {
            impersonatedBy: {
              personId: me.impersonatedBy.personId,
              displayName: me.impersonatedBy.displayName ?? me.impersonatedBy.personId,
            },
          }
        : {}),
      canImpersonate: me.canImpersonate === true,
    };
  }, [identity, query.data, override?.role]);

  const switcher = useMemo<SwitcherState>(
    () => ({ override, set: setOverride }),
    [override],
  );

  const lensState = useMemo<LensState>(() => ({ subject: lens, set: setLens }), [lens]);

  return (
    <AuthContext.Provider value={value}>
      <SwitcherContext.Provider value={switcher}>
        <LensContext.Provider value={lensState}>{children}</LensContext.Provider>
      </SwitcherContext.Provider>
    </AuthContext.Provider>
  );
}

/** The wire is camelCase (`JsonStringEnumConverter` with a camel-case policy). */
function normalizeRole(value: string | null | undefined): AppRole | undefined {
  const match = APP_ROLES.find((role) => role.toLowerCase() === value?.toLowerCase());
  return match;
}

/** The switcher's roles are global by definition — it is standing in for the grants,
 * not adding to them. */
function parseOverride(roles: string): RoleGrant[] {
  return roles
    .split(',')
    .map((name) => normalizeRole(name.trim()))
    .filter((role): role is AppRole => role !== undefined)
    .map((role) => ({ role, unitId: undefined }));
}

export function useAuth(): AuthIdentity {
  const identity = useContext(AuthContext);
  if (!identity) throw new Error('useAuth() called outside <AuthProvider>.');
  return identity;
}

/**
 * Holds this role in this unit, or globally.
 *
 * `unitId` undefined asks only about a global grant — the client-side mirror of
 * `Capabilities.Has`, and it must stay that way: two answers to "may I" that disagree is
 * worse than one that is merely strict.
 */
export function hasRole(
  identity: AuthIdentity,
  role: AppRole,
  unitId: string | undefined,
): boolean {
  return identity.grants.some(
    (grant) =>
      grant.role === role && (grant.unitId === undefined || (unitId !== undefined && grant.unitId === unitId)),
  );
}

/** Holds this role in at least one unit — for deciding whether a screen is worth
 * rendering at all, before any particular unit is in question. */
export function hasRoleAnywhere(identity: AuthIdentity, role: AppRole): boolean {
  return identity.grants.some((grant) => grant.role === role);
}

/**
 * Switches the dev identity (stub mode only).
 *
 * Everything cached is keyed on data the server filtered by identity — the inbox, the
 * request lists, what the grid lets you touch — so the whole cache is dropped rather
 * than surgically invalidated. Acting as someone else is not an incremental change.
 */
export function useIdentitySwitcher() {
  const queryClient = useQueryClient();
  const switcher = useContext(SwitcherContext);

  return useCallback(
    (next: DebugIdentity) => {
      setDebugIdentity(next);
      switcher?.set(next);
      // `resetQueries`, not `clear()`. Clearing removes the cache *and* its observers, so
      // every screen briefly had no data at all — which is what made switching feel slow
      // and made the auth query fall back to "unresolved" mid-interaction.
      void queryClient.resetQueries();
    },
    [queryClient, switcher],
  );
}

/** What the switcher is currently overriding, if anything. */
export function useIdentityOverride(): DebugIdentity | undefined {
  return useContext(SwitcherContext)?.override;
}

/**
 * Opens and closes the impersonation lens (ADR-0069).
 *
 * Every cache entry was filtered by identity on the server — the inbox, My calendar, what
 * the grid lets you touch — so the whole cache is reset rather than invalidated key by
 * key, exactly as the dev switcher does. Looking through somebody else's screen is not an
 * incremental change to what is on screen.
 *
 * `resetQueries` and not `clear()`: clearing drops the observers too, so every screen is
 * briefly dataless and `/api/auth/me` falls back to "unresolved" mid-interaction.
 */
export function useImpersonation(): {
  readonly start: (personId: string) => Promise<void>;
  readonly stop: () => void;
} {
  const queryClient = useQueryClient();
  const lens = useContext(LensContext);

  const start = useCallback(
    async (personId: string) => {
      // Awaited, and the header is only set inside: a refused lens must not leave the
      // client sending a header the server answers 403 to for the rest of the session.
      await startImpersonation(personId);
      lens?.set(personId);
      await queryClient.resetQueries();
    },
    [queryClient, lens],
  );

  const stop = useCallback(() => {
    stopImpersonation();
    lens?.set(undefined);
    void queryClient.resetQueries();
  }, [queryClient, lens]);

  return { start, stop };
}
