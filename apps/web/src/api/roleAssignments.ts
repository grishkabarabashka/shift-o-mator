/**
 * Who may do what, and where (ADR-0051).
 *
 * WHY this is its own module rather than another entry in the generic admin CRUD table:
 * a grant has no update — you hold a role or you do not, and "changing" one is revoking
 * and granting. Threading that through a create/update/remove shape would mean inventing
 * an update that must never be called.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiDelete, apiGet, apiPost, qs } from './client.ts';
import type { AppRole } from '../auth/AuthProvider.tsx';

export interface RoleAssignment {
  readonly id: string;
  readonly personId: string;
  /** Null is a global grant: every unit. */
  readonly unitId: string | null;
  readonly role: Lowercase<AppRole>;
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
    mutationFn: (args: { personId: string; unitId: string | null; role: Lowercase<AppRole> }) =>
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
