/**
 * The notification manager's two halves (ADR-0064): the matrix that decides what goes
 * out, and the log that says what became of it.
 *
 * WHY separate from `requests.ts`, which holds the bell: that one is a person reading
 * their own inbox, this one is an administrator reading everybody's. They share a table
 * and nothing else — different permission, different question, different refetch rhythm.
 *
 * Wire values stay camelCase here rather than being mapped to the UPPER_SNAKE the bell
 * uses: these are matrix keys sent straight back to the server, and translating them in
 * both directions would only create a second spelling to get wrong.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPut, qs } from './client.ts';

export type NotificationChannel = 'email' | 'teams';

/** Mirrors `NotificationKind` on the server. A kind added there appears in the matrix by
 * itself — the seeder tops the rows up — so this type is for labelling, not for deciding
 * what exists. */
export type NotificationKindWire =
  | 'requestSubmitted'
  | 'requestApproved'
  | 'requestRejected'
  | 'requestApplyFailed'
  | 'requestSuperseded'
  | 'compDayAging'
  | 'coverageGap';

export type DeliveryStatus = 'pending' | 'sent' | 'failed' | 'skipped';
export type SkipReason = 'channelDisabled' | 'noAddress' | 'userOptedOut';

export interface NotificationRule {
  readonly id: string;
  readonly kind: NotificationKindWire;
  readonly channel: NotificationChannel;
  readonly enabled: boolean;
  readonly userOverridable: boolean;
}

export interface NotificationDeliveryView {
  readonly id: string;
  readonly channel: NotificationChannel;
  readonly status: DeliveryStatus;
  readonly skipReason: SkipReason | null;
  readonly attempts: number;
  readonly lastError: string | null;
  readonly sentAt: string | null;
}

export interface NotificationLogEntry {
  readonly id: string;
  readonly recipientPersonId: string;
  readonly recipientName: string | null;
  readonly kind: NotificationKindWire;
  readonly title: string;
  readonly body: string | null;
  readonly subjectType: string | null;
  readonly subjectId: string | null;
  readonly createdAt: string;
  readonly readAt: string | null;
  readonly deliveries: readonly NotificationDeliveryView[];
}

export interface NotificationLogFilter {
  readonly kind?: string;
  readonly channel?: string;
  readonly status?: string;
  readonly personId?: string;
  readonly from?: string;
  readonly to?: string;
  readonly take?: number;
}

const RULES_KEY = ['admin', 'notification-rules'] as const;
const LOG_KEY = ['admin', 'notification-log'] as const;

export function useNotificationRules() {
  return useQuery({
    queryKey: RULES_KEY,
    queryFn: () => apiGet<NotificationRule[]>('/api/admin/notifications/rules'),
  });
}

/** The whole matrix in one save: it is a grid of checkboxes and one intent. */
export function useSaveNotificationRules() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (rules: readonly NotificationRule[]) =>
      apiPut<NotificationRule[]>('/api/admin/notifications/rules', {
        rules: rules.map((r) => ({
          kind: r.kind,
          channel: r.channel,
          enabled: r.enabled,
          userOverridable: r.userOverridable,
        })),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: RULES_KEY });
    },
  });
}

export function useNotificationLog(filter: NotificationLogFilter) {
  return useQuery({
    queryKey: [...LOG_KEY, filter],
    queryFn: () =>
      apiGet<{ items: NotificationLogEntry[]; total: number }>(
        `/api/admin/notifications/log${qs({
          kind: filter.kind,
          channel: filter.channel,
          status: filter.status,
          personId: filter.personId,
          from: filter.from,
          to: filter.to,
          take: filter.take ? String(filter.take) : undefined,
        })}`,
      ),
  });
}

export function useRetryDelivery() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (deliveryId: string) =>
      apiPost(`/api/admin/notifications/log/deliveries/${deliveryId}/retry`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: LOG_KEY });
    },
  });
}
