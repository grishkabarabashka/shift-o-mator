/**
 * Who may do what, and where (ADR-0051).
 *
 * WHY this is its own module rather than another entry in the generic admin CRUD table:
 * a grant has no update — you hold a role or you do not, and "changing" one is revoking
 * and granting. Threading that through a create/update/remove shape would mean inventing
 * an update that must never be called.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiDelete, apiGet, apiPost, apiPut, qs } from './client.ts';
import type { AppRole } from '../domain/types.ts';

export interface RoleAssignment {
  readonly id: string;
  readonly personId: string;
  /** Null is a global grant: every unit. */
  readonly unitId: string | null;
  readonly role: AppRole;
  readonly grantedBy: string;
  readonly grantedAt: string;
}

const KEY = ['admin', 'role-assignments'] as const;

export function useRoleAssignments(unitId?: string) {
  return useQuery({
    queryKey: [...KEY, unitId ?? 'all'],
    queryFn: () => apiGet<RoleAssignment[]>(`/api/admin/role-assignments${qs({ unitId })}`),
  });
}

export function useGrantRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { personId: string; unitId: string | null; role: AppRole }) =>
      apiPost<RoleAssignment>('/api/admin/role-assignments', args),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KEY });
      // The caller's own capabilities may have just changed, and every screen is gated
      // on them.
      void queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
    },
  });
}

export function useRevokeRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/api/admin/role-assignments/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KEY });
      void queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Directory roles — the one access setting that is a row, not configuration
// ---------------------------------------------------------------------------

const DIRECTORY_ROLES_KEY = ['admin', 'directory-roles'] as const;

/**
 * Whether Entra ID app roles are honoured alongside the stored grants (ADR-0062,
 * ADR-0063).
 *
 * It belongs on this screen and not in a deploy file because it changes what this screen
 * *means*: with it on, a person can hold a role that has no tick here and that nobody can
 * revoke from the product. Saying so next to the grants is the least the screen owes.
 */
export function useDirectoryRoles() {
  return useQuery({
    queryKey: DIRECTORY_ROLES_KEY,
    queryFn: () => apiGet<{ enabled: boolean }>('/api/admin/directory-roles'),
  });
}

export function useSetDirectoryRoles() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) =>
      apiPut<{ enabled: boolean }>('/api/admin/directory-roles', { enabled }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: DIRECTORY_ROLES_KEY });
      // What the caller may do can change with it — their own token roles start or stop
      // counting on the very next request.
      void queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
    },
  });
}
