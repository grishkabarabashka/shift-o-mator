/**
 * NOTE: client-side authentication seam (backend Phase 4 — see `api/.../Auth/`).
 *
 * Mirrors the fixed identity that `GET /api/auth/me` returns in `Auth:Mode=Stub`
 * mode: personId, displayName, and role (Viewer | Planner | Admin), with no
 * actual network round trip. Phase 5 will wire this to the live `GET /api/auth/me`
 * (right now `memoryRepository`/fixtures haven't been cut over yet — this context
 * is a stub deliberately, not a forgotten placeholder).
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';

/** NOTE: matches `ShiftOMator.Domain.AppRole` — hierarchy Viewer < Planner < Admin. */
export type AppRole = 'Viewer' | 'Planner' | 'Admin';

export interface AuthIdentity {
  readonly personId: string;
  readonly displayName: string;
  readonly role: AppRole;
}

// NOTE: matches `StubAuthenticationHandler` on the server — the same
// personId/displayName/role, so the client stub and the server one don't silently drift apart.
const STUB_IDENTITY: AuthIdentity = {
  personId: 'p-planner',
  displayName: 'Planner (stub)',
  role: 'Planner',
};

const AuthContext = createContext<AuthIdentity | undefined>(undefined);

export function AuthProvider({ children, identity }: { readonly children: ReactNode; readonly identity?: AuthIdentity }) {
  const value = useMemo(() => identity ?? STUB_IDENTITY, [identity]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthIdentity {
  const identity = useContext(AuthContext);
  if (!identity) throw new Error('useAuth() called outside <AuthProvider>.');
  return identity;
}

/** Order matches the server's `AppRole` enum — used for the same Viewer < Planner <
 * Admin comparisons Phase 6's admin screens will need on the client side. */
const ROLE_ORDER: readonly AppRole[] = ['Viewer', 'Planner', 'Admin'];

export function roleAtLeast(role: AppRole, minimum: AppRole): boolean {
  return ROLE_ORDER.indexOf(role) >= ROLE_ORDER.indexOf(minimum);
}
