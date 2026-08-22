/**
 * Клиентский шов аутентификации (Phase 4 бэкенда — см. `api/.../Auth/`).
 *
 * Зеркалит фиксированную identity, которую в режиме `Auth:Mode=Stub` отдаёт
 * `GET /api/auth/me`: personId, displayName и роль (Viewer | Planner | Admin) без
 * реального похода в сеть. Phase 5 подключит его к живому `GET /api/auth/me`
 * (сейчас `memoryRepository`/фикстуры ещё не срезаны — контекст остаётся
 * заглушкой намеренно, а не временно забытой заготовкой).
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';

/** Совпадает с `ShiftOMator.Domain.AppRole` — иерархия Viewer < Planner < Admin. */
export type AppRole = 'Viewer' | 'Planner' | 'Admin';

export interface AuthIdentity {
  readonly personId: string;
  readonly displayName: string;
  readonly role: AppRole;
}

// Совпадает с `StubAuthenticationHandler` на сервере — тот же personId/displayName/role,
// чтобы клиентская заглушка и серверная не разошлись молча.
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
