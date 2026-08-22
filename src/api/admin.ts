/**
 * `/api/admin/*` — Phase 6 CRUD. One generic resource factory
 * (`adminResource`) backs every entity except day configurations, which get
 * their own module (`adminDayConfigurations`) because "edit" there means
 * "create a new effective-dated version", not PUT (ADR-0021).
 *
 * Request bodies are hand-built per entity (not reused `*ToWire` helpers —
 * those don't exist yet because reference data was read-only before this
 * phase) using the same wire conventions `mapping.ts` already established:
 * camelCase enums, weekday names, `HH:mm:ss` times.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiDelete, apiGet, apiPost, apiPut } from './client.ts';
import {
  absenceCapacityRuleFromWire,
  camelToUpperSnake,
  dayConfigurationFromWire,
  holidayFromWire,
  locationFromWire,
  regionFromWire,
  roleFromWire,
  shiftFromWire,
  timeToWire,
  unitFromWire,
  upperSnakeToCamel,
  weekdaysToWire,
} from './mapping.ts';
import { referenceQueryKey } from './queries.ts';
import type {
  AbsenceCapacityRule,
  AbsenceDurationBucket,
  AbsenceType,
  DayConfiguration,
  DayConfigKey,
  GroupBy,
  Holiday,
  Location,
  PlanningUnit,
  Region,
  ShiftDefinition,
  ShiftRole,
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
  readonly timeZone: string;
  readonly holidayCalendarKey: string;
  readonly weekendDays: readonly string[];
}

export function locationToWire(l: Pick<Location, 'name' | 'timeZone' | 'holidayCalendarKey' | 'weekendDays'>): LocationRequest {
  return { name: l.name, timeZone: l.timeZone, holidayCalendarKey: l.holidayCalendarKey, weekendDays: weekdaysToWire(l.weekendDays) };
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

// -- Units ------------------------------------------------------------------

export interface UnitRequest {
  readonly name: string;
  readonly kind: string;
  readonly regionId: string | null;
  readonly groupBy: string;
}

export function unitToWire(u: Pick<PlanningUnit, 'name' | 'kind' | 'regionId' | 'groupBy'>): UnitRequest {
  return {
    name: u.name,
    kind: upperSnakeToCamel(u.kind as UnitKind),
    regionId: u.regionId ?? null,
    groupBy: upperSnakeToCamel(u.groupBy as GroupBy),
  };
}

export const adminUnits = adminResource<PlanningUnit, UnitRequest>('units', unitFromWire as never);

// -- Absence capacity rules -------------------------------------------------

export interface AbsenceCapacityRuleRequest {
  readonly regionId: string;
  readonly scopeKind: string;
  readonly scopeRoleId: string | null;
  readonly durationBucket: string;
  readonly longThresholdWorkdays: number;
  readonly maxConcurrent: number;
  readonly countsTypes: readonly string[];
  readonly countsCompDays: boolean;
}

export function absenceCapacityRuleToWire(r: AbsenceCapacityRule): AbsenceCapacityRuleRequest {
  return {
    regionId: r.regionId,
    scopeKind: r.scope.kind === 'ROLE_POOL' ? 'rolePool' : 'region',
    scopeRoleId: r.scope.kind === 'ROLE_POOL' ? r.scope.roleId : null,
    durationBucket: upperSnakeToCamel(r.durationBucket as AbsenceDurationBucket),
    longThresholdWorkdays: r.longThresholdWorkdays,
    maxConcurrent: r.maxConcurrent,
    countsTypes: r.countsTypes.map((t) => upperSnakeToCamel(t as AbsenceType)),
    countsCompDays: r.countsCompDays,
  };
}

export const adminAbsenceCapacityRules = adminResource<AbsenceCapacityRule, AbsenceCapacityRuleRequest>(
  'absence-capacity-rules',
  absenceCapacityRuleFromWire as never,
);

// -- Shifts -------------------------------------------------------------------

export interface ShiftRequest {
  readonly regionId: string;
  readonly code: string;
  readonly name: string;
  readonly timeZone: string;
  readonly start: string;
  readonly end: string;
  readonly crossesMidnight: boolean;
  readonly breakMinutes: number;
}

export function shiftToWire(s: Omit<ShiftDefinition, 'id'>): ShiftRequest {
  return {
    regionId: s.regionId,
    code: s.code,
    name: s.name,
    timeZone: s.timeZone,
    start: timeToWire(s.start),
    end: timeToWire(s.end),
    crossesMidnight: s.crossesMidnight,
    breakMinutes: s.breakMinutes,
  };
}

export const adminShifts = adminResource<ShiftDefinition, ShiftRequest>('shifts', shiftFromWire as never);

// -- Roles ----------------------------------------------------------------

export interface RoleRequest {
  readonly regionId: string;
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

export function roleToWire(r: Omit<ShiftRole, 'id'>): RoleRequest {
  return {
    regionId: r.regionId,
    code: r.code,
    label: r.label,
    description: r.description ?? null,
    color: r.color,
    hotkey: r.hotkey ?? null,
    timeZone: r.timeZone,
    start: timeToWire(r.start),
    end: timeToWire(r.end),
    crossesMidnight: r.crossesMidnight,
    breakMinutes: r.breakMinutes,
    countsAsCoverage: r.countsAsCoverage,
    editableTime: r.editableTime,
  };
}

export const adminRoles = adminResource<ShiftRole, RoleRequest>('roles', roleFromWire as never);

// -- Regions (in-place only — no create/delete) ------------------------------

export interface RegionRequest {
  readonly name: string;
  readonly primaryTimeZone: string;
  readonly primaryLocationId: string;
  readonly locationIds: readonly string[];
  readonly compOffPolicy: {
    readonly windowBeforeDays: number;
    readonly windowAfterDays: number;
    readonly excludedWeekdays: readonly string[];
    readonly agingThresholdDays: number;
    readonly requiresApprovalWhenNoSlot: boolean;
  };
}

export function regionToWire(r: Omit<Region, 'id'>): RegionRequest {
  return {
    name: r.name,
    primaryTimeZone: r.primaryTimeZone,
    primaryLocationId: r.primaryLocationId,
    locationIds: [...r.locationIds],
    compOffPolicy: {
      windowBeforeDays: r.compOffPolicy.windowBeforeDays,
      windowAfterDays: r.compOffPolicy.windowAfterDays,
      excludedWeekdays: weekdaysToWire(r.compOffPolicy.excludedWeekdays),
      agingThresholdDays: r.compOffPolicy.agingThresholdDays,
      requiresApprovalWhenNoSlot: r.compOffPolicy.requiresApprovalWhenNoSlot,
    },
  };
}

export function useAdminRegions() {
  return useQuery({
    queryKey: ['admin', 'regions'] as const,
    queryFn: async () => (await apiGet<readonly never[]>('/api/admin/regions')).map(regionFromWire as never) as Region[],
  });
}

export function useUpdateAdminRegion() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: RegionRequest }) =>
      withFieldErrors(() => apiPut(`/api/admin/regions/${id}`, body)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['admin', 'regions'] });
      void client.invalidateQueries({ queryKey: referenceQueryKey });
    },
  });
}

// -- Day configurations: create-only versioning (ADR-0021) -------------------

export interface DayConfigRoleRequirementRequest {
  readonly roleId: string;
  readonly min: number;
  readonly max: number | null;
  readonly isDefault: boolean;
  readonly timingOverrideStart: string | null;
  readonly timingOverrideEnd: string | null;
  readonly timingOverrideCrossesMidnight: boolean | null;
}

export interface NewDayConfigVersionRequest {
  readonly regionId: string;
  readonly key: DayConfigKey;
  readonly weekdays: readonly string[];
  readonly date: string | null;
  readonly label: string | null;
  readonly effectiveFrom: string;
  readonly roleRequirements: readonly DayConfigRoleRequirementRequest[];
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
  readonly regionId: string;
  readonly unitId: string;
  readonly locationId: string;
  readonly defaultShiftId: string;
  readonly orgCategory: string;
  readonly isActive: boolean;
  readonly isIncluded: boolean;
}

export interface PersonAdminRequest {
  readonly displayName: string;
  readonly initials: string;
  readonly employeeId: string | null;
  readonly regionId: string;
  readonly unitId: string;
  readonly locationId: string;
  readonly defaultShiftId: string;
  readonly orgCategory: string;
  readonly isActive: boolean;
  readonly isIncluded: boolean;
}

export function personAdminToWire(p: {
  displayName: string;
  initials: string;
  employeeId?: string;
  regionId: string;
  unitId: string;
  locationId: string;
  defaultShiftId: string;
  orgCategory: string;
  isActive: boolean;
  isIncluded: boolean;
}): PersonAdminRequest {
  return {
    displayName: p.displayName,
    initials: p.initials,
    employeeId: p.employeeId ?? null,
    regionId: p.regionId,
    unitId: p.unitId,
    locationId: p.locationId,
    defaultShiftId: p.defaultShiftId,
    orgCategory: upperSnakeToCamel(p.orgCategory),
    isActive: p.isActive,
    isIncluded: p.isIncluded,
  };
}

function adminPersonFromWire(w: {
  id: string;
  displayName: string;
  initials: string;
  employeeId?: string | null;
  regionId: string;
  unitId: string;
  locationId: string;
  defaultShiftId: string;
  orgCategory: string;
  isActive: boolean;
  isIncluded: boolean;
}): AdminPersonSummary {
  return {
    id: w.id,
    displayName: w.displayName,
    initials: w.initials,
    ...(w.employeeId ? { employeeId: w.employeeId } : {}),
    regionId: w.regionId,
    unitId: w.unitId,
    locationId: w.locationId,
    defaultShiftId: w.defaultShiftId,
    orgCategory: camelToUpperSnake(w.orgCategory),
    isActive: w.isActive,
    isIncluded: w.isIncluded,
  };
}

export const adminPeople = adminResource<AdminPersonSummary, PersonAdminRequest>('people', adminPersonFromWire as never);
