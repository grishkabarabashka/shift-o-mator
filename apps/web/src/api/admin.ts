/**
 * `/api/admin/*` — Phase 6 CRUD, updated for Phase 8's unit model. One
 * generic resource factory (`adminResource`) backs every entity except day
 * configurations, which get their own module (`adminDayConfigurations`)
 * because "edit" there means "create a new effective-dated version", not PUT
 * (ADR-0021).
 *
 * Phase 8 deleted `/api/admin/regions` — its editable fields (name, primary
 * location, member locations, comp-off policy) merged into
 * `/api/admin/units`. `/api/admin/roles` was renamed to `/api/admin/shifts`
 * and now serves the single `Shift` entity (absolute window, no separate
 * per-location `ShiftDefinition`).
 *
 * Request bodies are hand-built per entity (not reused `*ToWire` helpers —
 * those don't exist yet because reference data was read-only before Phase 6)
 * using the same wire conventions `mapping.ts` already established:
 * camelCase enums, weekday names, `HH:mm:ss` times.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiDelete, apiGet, apiPost, apiPut } from './client.ts';
import {
  absenceCapacityRuleFromWire,
  dayConfigurationFromWire,
  eventTypeFromWire,
  holidayFromWire,
  locationFromWire,
  presenceTypeFromWire,
  shiftFromWire,
  timeToWire,
  unitFromWire,
  weekdaysToWire,
} from './mapping.ts';
import { referenceQueryKey } from './queries.ts';
import type {
  AbsenceCapacityRule,
  AbsenceDurationBucket,

  CompOffPolicy,
  DayConfiguration,
  DayConfigKey,
  EventType,
  GroupBy,
  OrgCategory,
  Holiday,
  Location,
  PlanningUnit,
  PresenceType,
  Shift,
  UnitKind,
} from '../domain/types.ts';

// ---------------------------------------------------------------------------
// Field-error shape shared by every /api/admin/* endpoint
// ---------------------------------------------------------------------------

export interface FieldErrors {
  readonly [field: string]: readonly string[];
}

export class AdminValidationError extends Error {
  constructor(readonly fieldErrors: FieldErrors) {
    super('Validation failed');
    this.name = 'AdminValidationError';
  }
}

function fieldErrorsOf(error: unknown): FieldErrors | undefined {
  const err = error as { status?: number; body?: { errors?: unknown } } | undefined;
  if (!err || err.status !== 400 || !err.body || typeof err.body.errors !== 'object') return undefined;
  return err.body.errors as FieldErrors;
}

/** Wraps a mutation so a 400 becomes a typed `AdminValidationError` the form can render
 * field-by-field, instead of a generic toast. */
async function withFieldErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const fieldErrors = fieldErrorsOf(error);
    if (fieldErrors) throw new AdminValidationError(fieldErrors);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Generic resource: list + create + update + delete, invalidating `reference`
// ---------------------------------------------------------------------------

function adminResource<TDomain extends { readonly id: string }, TRequest>(
  path: string,
  fromWire: (wire: never) => TDomain,
) {
  const queryKey = ['admin', path] as const;

  function useList() {
    return useQuery({
      queryKey,
      queryFn: async () => {
        const wire = await apiGet<readonly never[]>(`/api/admin/${path}`);
        return wire.map(fromWire);
      },
    });
  }

  function useInvalidate() {
    const client = useQueryClient();
    return () => {
      void client.invalidateQueries({ queryKey });
      void client.invalidateQueries({ queryKey: referenceQueryKey });
    };
  }

  function useCreate() {
    const invalidate = useInvalidate();
    return useMutation({
      mutationFn: (body: TRequest) => withFieldErrors(() => apiPost(`/api/admin/${path}`, body)),
      onSuccess: invalidate,
    });
  }

  function useUpdate() {
    const invalidate = useInvalidate();
    return useMutation({
      mutationFn: ({ id, body }: { id: string; body: TRequest }) =>
        withFieldErrors(() => apiPut(`/api/admin/${path}/${id}`, body)),
      onSuccess: invalidate,
    });
  }

  function useRemove() {
    const invalidate = useInvalidate();
    return useMutation({
      mutationFn: (id: string) => apiDelete(`/api/admin/${path}/${id}`),
      onSuccess: invalidate,
    });
  }

  return { useList, useCreate, useUpdate, useRemove };
}

// -- Locations ----------------------------------------------------------------

export interface LocationRequest {
  readonly name: string;
  readonly country: string;
  readonly timeZone: string;
  readonly holidayCalendarKey: string;
  readonly weekendDays: readonly string[];
}

export function locationToWire(
  l: Pick<Location, 'name' | 'country' | 'timeZone' | 'holidayCalendarKey' | 'weekendDays'>,
): LocationRequest {
  return {
    name: l.name,
    country: l.country,
    timeZone: l.timeZone,
    holidayCalendarKey: l.holidayCalendarKey,
    weekendDays: weekdaysToWire(l.weekendDays),
  };
}

export const adminLocations = adminResource<Location, LocationRequest>('locations', locationFromWire as never);

// -- Holidays -------------------------------------------------------------

export interface HolidayRequest {
  readonly date: string;
  readonly name: string;
  readonly locationIds: readonly string[];
  readonly isFullDay: boolean;
}

export function holidayToWire(h: Pick<Holiday, 'date' | 'name' | 'locationIds' | 'isFullDay'>): HolidayRequest {
  return { date: h.date, name: h.name, locationIds: [...h.locationIds], isFullDay: h.isFullDay };
}

export const adminHolidays = adminResource<Holiday, HolidayRequest>('holidays', holidayFromWire as never);

// -- Event types ------------------------------------------------------------
//
// The kinds of non-working day: colour, short label, and the four flags that decide how
// one behaves (ADR-0049). There is no delete — an absence points at these by id, so a
// retired kind is `isActive: false` and keeps its name for the rows that already use it.

export interface EventTypeRequest {
  readonly code: string;
  readonly label: string;
  readonly shortLabel: string;
  readonly color: string;
  readonly category: string;
  readonly blocksAssignment: boolean;
  readonly countsTowardCapacity: boolean;
  readonly requiresApproval: boolean;
  readonly allowsHalfDay: boolean;
  readonly isActive: boolean;
  readonly sortOrder: number;
}

export function eventTypeToWire(t: EventType): EventTypeRequest {
  return {
    code: t.code,
    label: t.label,
    shortLabel: t.shortLabel,
    color: t.color,
    category: t.category,
    blocksAssignment: t.blocksAssignment,
    countsTowardCapacity: t.countsTowardCapacity,
    requiresApproval: t.requiresApproval,
    allowsHalfDay: t.allowsHalfDay,
    isActive: t.isActive,
    sortOrder: t.sortOrder,
  };
}

export const adminEventTypes = adminResource<EventType, EventTypeRequest>(
  'event-types',
  eventTypeFromWire as never,
);

// -- Presence types ---------------------------------------------------------
//
// Full CRUD (ADR-0054). Deleting is refused by the server once anything points at the
// type, because a presence record names its type and carries nothing else — retiring with
// `isActive = false` is the ordinary answer and keeps history readable.

export interface PresenceTypeRequest {
  readonly label: string;
  readonly glyph: string;
  readonly color: string;
  readonly namesALocation: boolean;
  readonly countsAs: string;
  readonly requiresApproval: boolean;
  readonly isActive: boolean;
  readonly sortOrder: number;
}

export function presenceTypeToWire(t: PresenceType): PresenceTypeRequest {
  return {
    label: t.label,
    glyph: t.glyph,
    color: t.color,
    namesALocation: t.namesALocation,
    countsAs: t.countsAs,
    requiresApproval: t.requiresApproval,
    isActive: t.isActive,
    sortOrder: t.sortOrder,
  };
}

export const adminPresenceTypes = adminResource<PresenceType, PresenceTypeRequest>(
  'presence-types',
  presenceTypeFromWire as never,
);

// -- Units ------------------------------------------------------------------
//
// Phase 8 merged Region's editable fields here: name, primary location,
// member locations, comp-off policy ride along with the unit's own Kind and
// GroupBy — one screen (Settings' Units tab) instead of two.

export interface CompOffPolicyRequest {
  readonly windowBeforeDays: number;
  readonly windowAfterDays: number;
  readonly excludedWeekdays: readonly string[];
  readonly agingThresholdDays: number;
  readonly requiresApprovalWhenNoSlot: boolean;
}

export interface UnitRequest {
  readonly name: string;
  readonly kind: string;
  readonly groupBy: string;
  readonly primaryLocationId: string;
  readonly locationIds: readonly string[];
  readonly compOffPolicy: CompOffPolicyRequest;
}

export function compOffPolicyToWire(p: CompOffPolicy): CompOffPolicyRequest {
  return {
    windowBeforeDays: p.windowBeforeDays,
    windowAfterDays: p.windowAfterDays,
    excludedWeekdays: weekdaysToWire(p.excludedWeekdays),
    agingThresholdDays: p.agingThresholdDays,
    requiresApprovalWhenNoSlot: p.requiresApprovalWhenNoSlot,
  };
}

export function unitToWire(
  u: Pick<PlanningUnit, 'name' | 'kind' | 'groupBy' | 'primaryLocationId' | 'locationIds' | 'compOffPolicy'>,
): UnitRequest {
  return {
    name: u.name,
    kind: u.kind as UnitKind,
    groupBy: u.groupBy as GroupBy,
    primaryLocationId: u.primaryLocationId,
    locationIds: [...u.locationIds],
    compOffPolicy: compOffPolicyToWire(u.compOffPolicy),
  };
}

export const adminUnits = adminResource<PlanningUnit, UnitRequest>('units', unitFromWire as never);

// -- Absence capacity rules -------------------------------------------------

export interface AbsenceCapacityRuleRequest {
  readonly unitId: string;
  readonly scopeKind: string;
  readonly scopeShiftId: string | null;
  readonly durationBucket: string;
  readonly longThresholdWorkdays: number;
  readonly maxConcurrent: number;
  readonly countsEventTypeIds: readonly string[];
  readonly countsCompDays: boolean;
}

export function absenceCapacityRuleToWire(r: AbsenceCapacityRule): AbsenceCapacityRuleRequest {
  return {
    unitId: r.unitId,
    scopeKind: r.scope.kind === 'SHIFT_POOL' ? 'shiftPool' : 'unit',
    scopeShiftId: r.scope.kind === 'SHIFT_POOL' ? r.scope.shiftId : null,
    durationBucket: r.durationBucket as AbsenceDurationBucket,
    longThresholdWorkdays: r.longThresholdWorkdays,
    maxConcurrent: r.maxConcurrent,
    countsEventTypeIds: [...r.countsEventTypeIds],
    countsCompDays: r.countsCompDays,
  };
}

export const adminAbsenceCapacityRules = adminResource<AbsenceCapacityRule, AbsenceCapacityRuleRequest>(
  'absence-capacity-rules',
  absenceCapacityRuleFromWire as never,
);

// -- Shifts -------------------------------------------------------------------
//
// Phase 8 merged the old `ShiftRole`/`ShiftDefinition` split into one `Shift`
// entity carrying an absolute window; `/api/admin/roles` became
// `/api/admin/shifts`.

export interface ShiftRequest {
  readonly unitId: string;
  readonly code: string;
  readonly label: string;
  readonly description: string | null;
  readonly color: string;
  readonly hotkey: string | null;
  readonly timeZone: string;
  readonly start: string;
  readonly end: string;
  readonly crossesMidnight: boolean;
  readonly breakMinutes: number;
  readonly countsAsCoverage: boolean;
  readonly editableTime: boolean;
}

export function shiftToWire(s: Omit<Shift, 'id'>): ShiftRequest {
  return {
    unitId: s.unitId,
    code: s.code,
    label: s.label,
    description: s.description ?? null,
    color: s.color,
    hotkey: s.hotkey ?? null,
    timeZone: s.timeZone,
    start: timeToWire(s.start),
    end: timeToWire(s.end),
    crossesMidnight: s.crossesMidnight,
    breakMinutes: s.breakMinutes,
    countsAsCoverage: s.countsAsCoverage,
    editableTime: s.editableTime,
  };
}

export const adminShifts = adminResource<Shift, ShiftRequest>('shifts', shiftFromWire as never);

// -- Day configurations: create-only versioning (ADR-0021) -------------------

export interface DayConfigShiftRequirementRequest {
  readonly shiftId: string;
  readonly min: number;
  readonly max: number | null;
  readonly isDefault: boolean;
  readonly timingOverrideStart: string | null;
  readonly timingOverrideEnd: string | null;
  readonly timingOverrideCrossesMidnight: boolean | null;
}

export interface NewDayConfigVersionRequest {
  readonly unitId: string;
  readonly key: DayConfigKey;
  readonly weekdays: readonly string[];
  readonly date: string | null;
  readonly label: string | null;
  readonly effectiveFrom: string;
  readonly shiftRequirements: readonly DayConfigShiftRequirementRequest[];
}

export function useAdminDayConfigurations() {
  return useQuery({
    queryKey: ['admin', 'day-configurations'] as const,
    queryFn: async () =>
      (await apiGet<readonly never[]>('/api/admin/day-configurations')).map(dayConfigurationFromWire as never) as DayConfiguration[],
  });
}

export function useCreateDayConfigVersion() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: NewDayConfigVersionRequest) =>
      withFieldErrors(() => apiPost('/api/admin/day-configurations', body)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['admin', 'day-configurations'] });
      void client.invalidateQueries({ queryKey: referenceQueryKey });
    },
  });
}

export function useUpdateDayConfigLabel() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, label }: { id: string; label: string | null }) =>
      apiPut(`/api/admin/day-configurations/${id}/label`, { label }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['admin', 'day-configurations'] });
      void client.invalidateQueries({ queryKey: referenceQueryKey });
    },
  });
}

export function useDeleteDayConfig() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/api/admin/day-configurations/${id}`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['admin', 'day-configurations'] });
      void client.invalidateQueries({ queryKey: referenceQueryKey });
    },
  });
}

// -- People (identity fields; eligibility/preferences stay on PUT /api/people/{id}) --

export interface AdminPersonSummary {
  readonly id: string;
  readonly displayName: string;
  readonly initials: string;
  readonly employeeId?: string;
  readonly email?: string;
  readonly unitId: string;
  readonly locationId: string;
  readonly orgCategory: string;
  readonly isActive: boolean;
  readonly isIncluded: boolean;
}

export interface PersonAdminRequest {
  readonly displayName: string;
  readonly initials: string;
  readonly employeeId: string | null;
  readonly email: string | null;
  readonly unitId: string;
  readonly locationId: string;
  readonly orgCategory: string;
  readonly isActive: boolean;
  readonly isIncluded: boolean;
}

export function personAdminToWire(p: {
  displayName: string;
  initials: string;
  employeeId?: string;
  email?: string;
  unitId: string;
  locationId: string;
  orgCategory: string;
  isActive: boolean;
  isIncluded: boolean;
}): PersonAdminRequest {
  return {
    displayName: p.displayName,
    initials: p.initials,
    // Blank, not just unset, must become null: an empty string is still a
    // value the unique index would enforce, and every person who left the
    // field blank would collide with every other one.
    employeeId: p.employeeId?.trim() ? p.employeeId.trim() : null,
    // Same reason, plus lowercasing: the server stores it lowercased so a sign-in
    // matches regardless of how the token cased it (ADR-0058).
    email: p.email?.trim() ? p.email.trim().toLowerCase() : null,
    unitId: p.unitId,
    locationId: p.locationId,
    orgCategory: p.orgCategory,
    isActive: p.isActive,
    isIncluded: p.isIncluded,
  };
}

function adminPersonFromWire(w: {
  id: string;
  displayName: string;
  initials: string;
  employeeId?: string | null;
  email?: string | null;
  unitId: string;
  locationId: string;
  orgCategory: string;
  isActive: boolean;
  isIncluded: boolean;
}): AdminPersonSummary {
  return {
    id: w.id,
    displayName: w.displayName,
    initials: w.initials,
    ...(w.employeeId ? { employeeId: w.employeeId } : {}),
    ...(w.email ? { email: w.email } : {}),
    unitId: w.unitId,
    locationId: w.locationId,
    orgCategory: w.orgCategory as OrgCategory,
    isActive: w.isActive,
    isIncluded: w.isIncluded,
  };
}

export const adminPeople = adminResource<AdminPersonSummary, PersonAdminRequest>('people', adminPersonFromWire as never);

/** One pending person edit, in the shape `POST /api/admin/people/batch` takes. */
export interface PeopleBatchOp {
  readonly kind: 'create' | 'update' | 'delete';
  readonly id?: string;
  readonly tempId?: string;
  readonly person?: PersonAdminRequest;
}

/**
 * Every pending person edit in one request, applied in one transaction (ADR-0061).
 *
 * WHY people and not the other admin resources: rows here are not independent. `email`
 * and `employeeId` carry filtered unique indexes, so moving a sign-in address from one
 * person to another is a release and a claim that are only valid together. Sent one at a
 * time, the claim was rejected and the release still committed — the address ended up on
 * nobody, and the person who held it could no longer sign in.
 *
 * Errors come back keyed by the op's index rather than as one flat object, because with
 * several rows in flight "email is taken" that does not say *which* row cannot be put
 * beside a field.
 */
export class PeopleBatchError extends Error {
  constructor(readonly byIndex: ReadonlyMap<number, FieldErrors>) {
    super('The changes were rejected and nothing was saved.');
    this.name = 'PeopleBatchError';
  }
}

export function usePeopleBatch() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (ops: readonly PeopleBatchOp[]) => {
      try {
        return await apiPost<{ results: readonly { index: number; tempId?: string; id: string }[] }>(
          '/api/admin/people/batch',
          { ops },
        );
      } catch (error) {
        const err = error as { status?: number; body?: { code?: string; errors?: Record<string, FieldErrors> } };
        if (err?.status === 400 && err.body?.code === 'BATCH_REJECTED' && err.body.errors) {
          const byIndex = new Map<number, FieldErrors>();
          for (const [index, fields] of Object.entries(err.body.errors)) byIndex.set(Number(index), fields);
          throw new PeopleBatchError(byIndex);
        }
        throw error;
      }
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['admin', 'people'] });
      void client.invalidateQueries({ queryKey: referenceQueryKey });
    },
  });
}

