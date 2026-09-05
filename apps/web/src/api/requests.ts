/**
 * Self-service requests, approvals and the notification inbox (ADR-0047, ADR-0046).
 *
 * Its own module rather than part of `schedule.ts`, because none of this is *the plan*.
 * A request is a conversation about a future change; only its approved outcome — a
 * presence record or an absence — ever reaches the schedule, and that arrives through the
 * ordinary schedule query like any other server-side write (ADR-0067).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, qs } from './client.ts';
import type { DayPortion, IsoDate, IsoInstant, PersonId } from '../domain/types.ts';
import { notify } from './notifier.ts';

export type RequestState =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'APPLIED'
  | 'APPLY_FAILED';

export type RequestCategory = 'PRESENCE' | 'LEAVE' | 'SWAP' | 'COMP_DAY' | 'OTHER';

export type ApprovalDecisionKind = 'APPROVE' | 'REJECT' | 'RETURN';

export interface RequestType {
  readonly id: string;
  readonly code: string;
  readonly label: string;
  readonly category: RequestCategory;
  /** NOTE: Which way of working an approval materialises, when this is a presence
   * request. A type that names one of our offices also needs a site. */
  readonly presenceTypeId?: string;
}

export interface ApprovalDecision {
  readonly id: string;
  readonly step: number;
  readonly decision: ApprovalDecisionKind;
  readonly byPersonId: PersonId;
  readonly comment?: string;
  readonly at: IsoInstant;
}

export interface RequestRecord {
  readonly id: string;
  readonly typeId: string;
  readonly subjectPersonId: PersonId;
  readonly unitId: string;
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly note?: string;
  readonly state: RequestState;
  readonly failureReason?: string;
  readonly createdAt: IsoInstant;
  readonly decisions: readonly ApprovalDecision[];
}

/** NOTE: A request plus what a screen needs that is not on the row. */
export interface RequestView {
  readonly request: RequestRecord;
  readonly typeCode: string;
  readonly typeLabel: string;
  readonly subjectDisplayName: string;
  readonly pendingApproverIds: readonly PersonId[];
  /** NOTE: Whether *this* caller may approve or decline it. Computed server-side —
   * route membership is not something the client can work out. */
  readonly callerCanDecide: boolean;
}

export type NotificationKind =
  | 'REQUEST_SUBMITTED'
  | 'REQUEST_APPROVED'
  | 'REQUEST_REJECTED'
  | 'REQUEST_APPLY_FAILED'
  | 'REQUEST_SUPERSEDED'
  | 'COMP_DAY_AGING'
  | 'COVERAGE_GAP';

export interface NotificationItem {
  readonly id: string;
  readonly kind: NotificationKind;
  readonly title: string;
  readonly body?: string;
  readonly subjectType?: string;
  readonly subjectId?: string;
  readonly createdAt: IsoInstant;
  readonly readAt?: IsoInstant;
}

interface WireRequestView {
  readonly request: Record<string, unknown>;
  readonly typeCode: string;
  readonly typeLabel: string;
  readonly subjectDisplayName: string;
  readonly pendingApproverIds: readonly string[];
  readonly callerCanDecide: boolean;
}

function requestFromWire(w: Record<string, unknown>): RequestRecord {
  const decisions = (w.decisions as Record<string, unknown>[] | undefined) ?? [];
  return {
    id: w.id as string,
    typeId: w.typeId as string,
    subjectPersonId: w.subjectPersonId as string,
    unitId: w.unitId as string,
    from: w.from as IsoDate,
    to: w.to as IsoDate,
    ...(w.note ? { note: w.note as string } : {}),
    state: (w.state as string) as RequestState,
    ...(w.failureReason ? { failureReason: w.failureReason as string } : {}),
    createdAt: w.createdAt as IsoInstant,
    decisions: decisions.map((d) => ({
      id: d.id as string,
      step: d.step as number,
      decision: (d.decision as string) as ApprovalDecisionKind,
      byPersonId: d.byPersonId as string,
      ...(d.comment ? { comment: d.comment as string } : {}),
      at: d.at as IsoInstant,
    })),
  };
}

function viewFromWire(w: WireRequestView): RequestView {
  return {
    request: requestFromWire(w.request),
    typeCode: w.typeCode,
    typeLabel: w.typeLabel,
    subjectDisplayName: w.subjectDisplayName,
    pendingApproverIds: w.pendingApproverIds,
    callerCanDecide: w.callerCanDecide,
  };
}

export function useRequestTypes() {
  return useQuery({
    queryKey: ['request-types'],
    queryFn: async () => {
      const wire = await apiGet<readonly Record<string, unknown>[]>('/api/request-types');
      return wire.map(
        (t): RequestType => ({
          id: t.id as string,
          code: t.code as string,
          label: t.label as string,
          category: (t.category as string) as RequestCategory,
          ...(t.presenceTypeId ? { presenceTypeId: t.presenceTypeId as string } : {}),
        }),
      );
    },
    // Configuration, not plan data: it changes when an admin adds a type, which is rare.
    staleTime: 5 * 60_000,
  });
}

export function useRequests(scope: 'mine' | 'inbox' | 'all') {
  return useQuery({
    queryKey: ['requests', scope],
    queryFn: async () => {
      const wire = await apiGet<{ requests: readonly WireRequestView[] }>(
        `/api/requests${qs({ scope })}`,
      );
      return wire.requests.map(viewFromWire);
    },
  });
}

export function useNotifications() {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: async () => {
      const wire = await apiGet<{
        notifications: readonly Record<string, unknown>[];
        unreadCount: number;
      }>('/api/notifications');
      return {
        unreadCount: wire.unreadCount,
        items: wire.notifications.map(
          (n): NotificationItem => ({
            id: n.id as string,
            kind: (n.kind as string) as NotificationKind,
            title: n.title as string,
            ...(n.body ? { body: n.body as string } : {}),
            ...(n.subjectType ? { subjectType: n.subjectType as string } : {}),
            ...(n.subjectId ? { subjectId: n.subjectId as string } : {}),
            createdAt: n.createdAt as IsoInstant,
            ...(n.readAt ? { readAt: n.readAt as IsoInstant } : {}),
          }),
        ),
      };
    },
    // NOTE: polled rather than pushed. There is no realtime channel and, at a handful of
    // approvals a day, adding one would be infrastructure for its own sake (ADR-0046).
    refetchInterval: 60_000,
  });
}

/**
 * NOTE: Everything here invalidates `['schedule']` as well as the request lists.
 *
 * WHY: an approval writes a presence record or an absence, which is plan data the grid
 * is already showing. Without this the approver sees "approved" and the schedule behind
 * them still shows the old week until something else happens to refetch.
 */
function useRequestMutation<TArgs>(
  fn: (args: TArgs) => Promise<unknown>,
  /** What to say when it worked. One place per family covers create, decide and cancel. */
  successMessage?: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    // WHY here and not per call site: `decide.isError` and `cancel.isError` were never
    // rendered anywhere, so approving with the API down re-enabled the button and said
    // nothing at all — the request stayed in the inbox and the approver had no reason to
    // think their click had failed rather than been ignored.
    onError: (error: unknown) => {
      notify().bad(error instanceof Error ? error.message : 'That did not go through.');
    },
    onSuccess: async () => {
      if (successMessage) notify().ok(successMessage);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['requests'] }),
        queryClient.invalidateQueries({ queryKey: ['notifications'] }),
        // `useSchedule` re-seeds itself from this: it subscribes to the schedule query
        // rather than snapshotting it once, which is what makes an approval's *result*
        // reach the grid and not only the disappearance of the request.
        queryClient.invalidateQueries({ queryKey: ['schedule'] }),
        // My calendar holds its own long window, keyed separately from the planning one.
        queryClient.invalidateQueries({ queryKey: ['my-calendar'] }),
      ]);
    },
  });
}

export interface CreateRequestArgs {
  readonly typeId: string;
  /** WHY: omitted means "about me". A planner raising one on somebody else's row has to
   * name them, or the request lands on the planner (the server defaults to the caller). */
  readonly subjectPersonId?: string;
  /** For a comp-day placement: which earned day is being placed (ADR-0052). */
  readonly compDayId?: string;
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly note?: string;
  readonly siteLocationId?: string;
  readonly siteLabel?: string;
  readonly portion?: DayPortion;
}

export function useCreateRequest() {
  return useRequestMutation<CreateRequestArgs>((args) =>
    apiPost('/api/requests', {
      typeId: args.typeId,
      subjectPersonId: args.subjectPersonId ?? null,
      compDayId: args.compDayId ?? null,
      from: args.from,
      to: args.to,
      note: args.note ?? null,
      siteLocationId: args.siteLocationId ?? null,
      siteLabel: args.siteLabel ?? null,
      portion: args.portion ?? 'FULL',
    }),
    'Request sent. It is now waiting on an approver.',
  );
}

export function useDecideRequest() {
  return useRequestMutation<{
    readonly id: string;
    readonly decision: ApprovalDecisionKind;
    readonly comment?: string;
  }>((args) =>
    apiPost(`/api/requests/${args.id}/decide`, {
      decision: args.decision,
      comment: args.comment ?? null,
    }),
    'Decision recorded. The schedule has been updated.',
  );
}

export function useCancelRequest() {
  return useRequestMutation<{ readonly id: string }>(
    (args) => apiPost(`/api/requests/${args.id}/cancel`),
    'Request withdrawn.',
  );
}

export function useMarkNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost('/api/notifications/read'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
}
