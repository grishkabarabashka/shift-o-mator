/**
 * One person's own year — the read behind My calendar.
 *
 * WHY not the schedule query: that one is a planner's view, scoped to a unit and a month,
 * carrying coverage, issues and resolved day configurations for everybody in it. A
 * personal calendar wants one person over a year and none of the engines.
 *
 * The window is a **single** query keyed on its own from/to, refetched as the page grows
 * rather than one query per month. A month at a time would be tidier to write and would
 * mean twelve requests on the first paint, and twelve cache entries to invalidate every
 * time somebody asks for a day off.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, qs } from './client.ts';
import {
  absenceFromWire,
  assignmentFromWire,
  compDayFromWire,
  presenceFromWire,
  camelToUpperSnake,
} from './mapping.ts';
import type {
  Absence,
  Assignment,
  CompDayEntry,
  DateRange,
  DayPortion,
  IsoDate,
  PresenceRecord,
} from '../domain/types.ts';

/** A request of the caller's own that has not landed on the plan yet. */
export interface MyPendingRequest {
  readonly id: string;
  readonly typeId: string;
  readonly typeLabel: string;
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly portion: DayPortion;
  readonly state: string;
}

export interface MyCalendar {
  readonly personId: string;
  readonly assignments: readonly Assignment[];
  readonly absences: readonly Absence[];
  readonly compDays: readonly CompDayEntry[];
  readonly presence: readonly PresenceRecord[];
  readonly pendingRequests: readonly MyPendingRequest[];
}

export const myCalendarKey = ['my-calendar'] as const;

export function useMyCalendar(range: DateRange) {
  return useQuery({
    queryKey: [...myCalendarKey, range.from, range.to],
    queryFn: async () => {
      const wire = await apiGet<{
        readonly personId: string;
        readonly assignments: readonly Parameters<typeof assignmentFromWire>[0][];
        readonly absences: readonly Parameters<typeof absenceFromWire>[0][];
        readonly compDays: readonly Parameters<typeof compDayFromWire>[0][];
        readonly presence: readonly Parameters<typeof presenceFromWire>[0][];
        readonly pendingRequests: readonly Record<string, unknown>[];
      }>(`/api/me/calendar${qs({ from: range.from, to: range.to })}`);

      return {
        personId: wire.personId,
        assignments: wire.assignments.map(assignmentFromWire),
        absences: wire.absences.map(absenceFromWire),
        compDays: wire.compDays.map(compDayFromWire),
        presence: wire.presence.map(presenceFromWire),
        pendingRequests: wire.pendingRequests.map(
          (r): MyPendingRequest => ({
            id: r.id as string,
            typeId: r.typeId as string,
            typeLabel: r.typeLabel as string,
            from: r.from as IsoDate,
            to: r.to as IsoDate,
            portion: camelToUpperSnake<DayPortion>((r.portion as string) ?? 'full'),
            state: r.state as string,
          }),
        ),
      } satisfies MyCalendar;
    },
    // Growing the window is a new key; keeping the previous answer on screen is what makes
    // scrolling into next year feel like scrolling rather than reloading.
    placeholderData: (previous) => previous,
  });
}

/** The subscription address. The caller's own — the token in it is the only credential. */
export function useMyCalendarFeed() {
  return useQuery({
    queryKey: ['my-calendar-feed'],
    queryFn: () => apiGet<{ readonly url: string }>('/api/me/calendar-feed'),
    staleTime: Infinity,
  });
}

export function useResetCalendarFeed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<{ readonly url: string }>('/api/me/calendar-feed/reset'),
    onSuccess: (next) => queryClient.setQueryData(['my-calendar-feed'], next),
  });
}
