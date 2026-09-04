/**
 * The holiday-import allowlist (ADR-0063 shape): which hosts
 * `POST /api/admin/holidays/import` may fetch a calendar feed from. Global-admin-only,
 * same reasoning as `useDirectoryRoles` in `roleAssignments.ts` — a host allowed here is
 * reachable for every unit's import, and there is no unit to scope it to.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiDelete, apiGet, apiPost } from './client.ts';

export interface AllowedCalendarHost {
  readonly host: string;
}

const KEY = ['admin', 'allowed-calendar-hosts'] as const;

export function useAllowedCalendarHosts() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => apiGet<AllowedCalendarHost[]>('/api/admin/allowed-calendar-hosts'),
  });
}

export function useAddAllowedCalendarHost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (host: string) => apiPost<AllowedCalendarHost>('/api/admin/allowed-calendar-hosts', { host }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: KEY }),
  });
}

export function useRemoveAllowedCalendarHost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (host: string) => apiDelete(`/api/admin/allowed-calendar-hosts/${encodeURIComponent(host)}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: KEY }),
  });
}
