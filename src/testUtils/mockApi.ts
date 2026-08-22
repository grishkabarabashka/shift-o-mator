/**
 * MSW-backed stand-in for the .NET API (Phase 5 step 6) — replaces the old
 * `MemoryScheduleRepository` as the thing tests run against. Unlike that
 * repository, this intercepts real `fetch()` calls at the network boundary,
 * so it exercises the exact same code path (`HttpScheduleRepository`,
 * `api/mapping.ts`, TanStack Query) production traffic does.
 *
 * Deliberately not a full reimplementation of the backend: coverage/issues
 * are always empty (nothing here asserts on them — that's the differential
 * test's job, `api/tests/...`), and comp-day generation isn't simulated
 * (Phase 5 moved that to `DraftService.Publish`, server-side only — see
 * `useSchedule.ts`'s `commitCells` doc comment).
 */

import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { API_BASE_URL } from '../api/client.ts';
import { instantToWire, timeToWire, upperSnakeToCamel, weekdaysToWire } from '../api/mapping.ts';
import type {
  Absence,
  Assignment,
  CompDayEntry,
  DateRange,
  DraftChange,
  DraftOp,
  DraftSession,
  DraftTargetType,
  IsoDate,
  Location,
  Person,
  PlanningUnit,
  Region,
  ScheduleDataset,
  Weekday,
  ShiftDefinition,
  ShiftRole,
} from '../domain/types.ts';
import { buildMockDataset } from './mockDataset.ts';

function locationToWire(l: Location) {
  return { ...l, weekendDays: weekdaysToWire(l.weekendDays) };
}
function regionToWire(r: Region) {
  return {
    ...r,
    compOffPolicy: { ...r.compOffPolicy, excludedWeekdays: weekdaysToWire(r.compOffPolicy.excludedWeekdays) },
  };
}
function unitToWire(u: PlanningUnit) {
  return { ...u, kind: upperSnakeToCamel(u.kind), groupBy: upperSnakeToCamel(u.groupBy) };
}
function shiftToWire(s: ShiftDefinition) {
  return { ...s, start: timeToWire(s.start), end: timeToWire(s.end) };
}
function roleToWire(r: ShiftRole) {
  return { ...r, start: timeToWire(r.start), end: timeToWire(r.end) };
}
function dayConfigToWire(c: ScheduleDataset['dayConfigurations'][number]) {
  return {
    ...c,
    weekdays: weekdaysToWire(c.weekdays),
    roleRequirements: c.roleRequirements.map((r) => ({
      roleId: r.roleId,
      min: r.min,
      max: r.max ?? null,
      isDefault: r.isDefault,
      timingOverrideStart: r.timingOverride ? timeToWire(r.timingOverride.start) : null,
      timingOverrideEnd: r.timingOverride ? timeToWire(r.timingOverride.end) : null,
      timingOverrideCrossesMidnight: r.timingOverride?.crossesMidnight ?? null,
    })),
  };
}
function personToWire(p: Person) {
  return {
    ...p,
    orgCategory: upperSnakeToCamel(p.orgCategory),
    availableWeekdays: weekdaysToWire(p.availableWeekdays),
    eligibility: p.eligibility.map((e) => ({ ...e, minPerWeek: e.minPerWeek ?? null, maxPerWeek: e.maxPerWeek ?? null })),
    preferences: p.preferences
      ? {
          avoidsWeekdays: weekdaysToWire(p.preferences.avoidsWeekdays ?? []),
          preferredPartnerIds: p.preferences.preferredPartnerIds ?? [],
          blackoutDates: p.preferences.blackoutDates ?? [],
          note: p.preferences.note ?? null,
        }
      : null,
  };
}
function assignmentToWireLocal(a: Assignment) {
  return {
    id: a.id,
    personId: a.personId,
    date: a.date,
    regionId: a.regionId,
    contentKind: a.content.kind === 'ROLE' ? 'role' : 'marker',
    roleId: a.content.kind === 'ROLE' ? a.content.roleId : null,
    timeOverride:
      a.content.kind === 'ROLE' && a.content.timeOverride
        ? {
            start: timeToWire(a.content.timeOverride.start),
            end: timeToWire(a.content.timeOverride.end),
            crossesMidnight: a.content.timeOverride.crossesMidnight,
          }
        : null,
    marker: a.content.kind === 'MARKER' ? upperSnakeToCamel(a.content.marker) : null,
    isWeekend: a.isWeekend,
    note: a.note ?? null,
    source: upperSnakeToCamel(a.source),
    version: a.version,
    createdBy: a.createdBy,
    createdAt: instantToWire(a.createdAt),
    updatedBy: a.updatedBy ?? null,
    updatedAt: a.updatedAt ? instantToWire(a.updatedAt) : null,
  };
}
function absenceToWireLocal(a: Absence) {
  return {
    ...a,
    type: upperSnakeToCamel(a.type),
    source: upperSnakeToCamel(a.source),
    importBatchId: a.importBatchId ?? null,
    lastSeenInImportAt: a.lastSeenInImportAt ?? null,
    syncedToHrAt: a.syncedToHrAt ?? null,
    note: a.note ?? null,
  };
}
function compDayToWireLocal(c: CompDayEntry) {
  return {
    ...c,
    trigger: upperSnakeToCamel(c.trigger),
    status: upperSnakeToCamel(c.status),
    proposedDate: c.proposedDate ?? null,
    actualDate: c.actualDate ?? null,
    syncedToHrAt: c.syncedToHrAt ?? null,
  };
}

interface MockSession {
  session: DraftSession;
  changes: DraftChange[];
}

/** Mutable state for one test's server — reset between tests via `resetMockApi()`. */
class MockBackend {
  data: ScheduleDataset = buildMockDataset();
  sessions = new Map<string, MockSession>();
  private seq = 0;

  nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  overlaps(a: DateRange, b: DateRange): boolean {
    return a.from <= b.to && b.from <= a.to;
  }
}

export const mockBackend = new MockBackend();

export function resetMockApi(): void {
  mockBackend.data = buildMockDataset();
  mockBackend.sessions.clear();
}

function inRange(date: IsoDate, range: DateRange): boolean {
  return date >= range.from && date <= range.to;
}

/** Mirrors `ScheduleEndpoints.ResolveRegionIds` closely enough for tests:
 * `ALL_UNITS` sees every region, a region-kind unit sees its own region. */
function resolveRegionIds(unitId: string): string[] {
  if (!unitId || unitId === 'ALL') return mockBackend.data.regions.map((r) => r.id);
  const unit = mockBackend.data.units.find((u) => u.id === unitId);
  if (unit?.kind === 'REGION' && unit.regionId) return [unit.regionId];
  return mockBackend.data.regions.map((r) => r.id);
}

function eachIsoDate(from: IsoDate, to: IsoDate): IsoDate[] {
  const dates: IsoDate[] = [];
  let cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  return dates;
}

/** Small stand-in for `DayConfigurationResolver.Resolve`: this mock's three
 * fixture configs (weekday/friday/weekend) each own a disjoint weekday set,
 * so there's no effective-dated versioning to resolve between. */
function resolveMockDayConfig(regionId: string, date: IsoDate) {
  const utcDay = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0=Sun..6=Sat
  const weekday = (utcDay === 0 ? 7 : utcDay) as Weekday;
  return mockBackend.data.dayConfigurations.find(
    (c) => c.regionId === regionId && c.weekdays.includes(weekday),
  );
}

function overlayPlan(session?: MockSession) {
  const assignments = new Map(mockBackend.data.assignments.map((a) => [a.id, a]));
  const absences = new Map(mockBackend.data.absences.map((a) => [a.id, a]));
  const compDays = new Map(mockBackend.data.compDays.map((c) => [c.id, c]));
  if (session) {
    for (const change of [...session.changes].sort((x, y) => x.seq - y.seq)) {
      if (change.targetType === 'ASSIGNMENT') {
        if (change.after) assignments.set(change.after.id, change.after);
        else if (change.before) assignments.delete(change.before.id);
      } else if (change.targetType === 'ABSENCE') {
        if (change.after) absences.set(change.after.id, change.after);
        else if (change.before) absences.delete(change.before.id);
      } else {
        if (change.after) compDays.set(change.after.id, change.after);
        else if (change.before) compDays.delete(change.before.id);
      }
    }
  }
  return { assignments: [...assignments.values()], absences: [...absences.values()], compDays: [...compDays.values()] };
}

const base = API_BASE_URL;

export const handlers = [
  http.get(`${base}/api/reference`, () => {
    const d = mockBackend.data;
    return HttpResponse.json({
      locations: d.locations.map(locationToWire),
      holidays: d.holidays,
      regions: d.regions.map(regionToWire),
      units: d.units.map(unitToWire),
      shifts: d.shifts.map(shiftToWire),
      roles: d.roles.map(roleToWire),
      dayConfigurations: d.dayConfigurations.map(dayConfigToWire),
      people: d.people.map(personToWire),
      absenceCapacityRules: d.absenceCapacityRules,
    });
  }),

  http.get(`${base}/api/schedule`, ({ request }) => {
    const url = new URL(request.url);
    const unitId = url.searchParams.get('unitId') ?? 'ALL';
    const from = url.searchParams.get('from') ?? '';
    const to = url.searchParams.get('to') ?? '';
    const draftId = url.searchParams.get('draftId');
    const session = draftId ? mockBackend.sessions.get(draftId) : undefined;
    const { assignments, absences, compDays } = overlayPlan(session);

    const regionIds = resolveRegionIds(unitId);
    const dates = eachIsoDate(from, to);

    const dayConfigs = regionIds.flatMap((regionId) =>
      dates
        .map((date) => {
          const config = resolveMockDayConfig(regionId, date);
          return config
            ? { date, regionId, dayConfigurationId: config.id, key: config.key, label: config.label ?? null }
            : undefined;
        })
        .filter((c): c is NonNullable<typeof c> => c !== undefined),
    );

    const coverage = regionIds.flatMap((regionId) =>
      dates.flatMap((date) => {
        const config = resolveMockDayConfig(regionId, date);
        if (!config) return [];
        return config.roleRequirements.map((req) => {
          const actual = assignments.filter(
            (a) => a.date === date && a.content.kind === 'ROLE' && a.content.roleId === req.roleId,
          ).length;
          const level = actual < req.min ? 'gap' : actual === req.min ? 'thin' : 'ok';
          return {
            date,
            regionId,
            roleId: req.roleId,
            actual,
            min: req.min,
            max: req.max ?? null,
            level,
            appliedKey: config.key,
            ruleLabel: null,
          };
        });
      }),
    );

    const issues = coverage
      .filter((cell) => cell.level === 'gap')
      .map((cell) => ({
        key: `COVERAGE_GAP|${cell.date}||${cell.roleId}`,
        level: 'blocking',
        category: 'gap',
        code: 'coverageGap',
        message: `${cell.roleId}: ${cell.actual} assigned, minimum is ${cell.min}`,
        regionId: cell.regionId,
        date: cell.date,
        personId: null,
        roleId: cell.roleId,
      }));

    return HttpResponse.json({
      regionIds,
      plan: {
        assignments: assignments.filter((a) => inRange(a.date, { from, to })).map(assignmentToWireLocal),
        absences: absences
          .filter((a) => mockBackend.overlaps({ from: a.from, to: a.to }, { from, to }))
          .map(absenceToWireLocal),
        compDays: compDays.map(compDayToWireLocal),
      },
      coverage,
      issues,
      acknowledgedIssueKeys: [],
      dayConfigurations: dayConfigs,
      overlaidDraftId: draftId,
    });
  }),

  http.post(`${base}/api/drafts`, async ({ request }) => {
    const body = (await request.json()) as {
      editorPersonId: string;
      unitId: string;
      rangeFrom: string;
      rangeTo: string;
    };
    const now = new Date().toISOString();
    const session: DraftSession = {
      id: mockBackend.nextId('draft'),
      editorPersonId: body.editorPersonId,
      unitId: body.unitId,
      range: { from: body.rangeFrom, to: body.rangeTo },
      status: 'OPEN',
      createdAt: now,
      updatedAt: now,
    };
    mockBackend.sessions.set(session.id, { session, changes: [] });
    return HttpResponse.json({
      id: session.id,
      editorPersonId: session.editorPersonId,
      unitId: session.unitId,
      rangeFrom: session.range.from,
      rangeTo: session.range.to,
      status: 'open',
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    });
  }),

  http.get(`${base}/api/drafts`, () => HttpResponse.json([])),

  http.get(`${base}/api/drafts/:id/changes`, ({ params }) => {
    const entry = mockBackend.sessions.get(params.id as string);
    if (!entry) return HttpResponse.json({ code: 'DRAFT_NOT_FOUND' }, { status: 404 });
    return HttpResponse.json(
      entry.changes.map((c) => ({
        id: c.id,
        draftSessionId: entry.session.id,
        seq: c.seq,
        at: c.at,
        targetType: upperSnakeToCamel(c.targetType),
        op: upperSnakeToCamel(c.op),
        beforeJson: c.before ? JSON.stringify(wireOf(c.targetType, c.before)) : null,
        afterJson: c.after ? JSON.stringify(wireOf(c.targetType, c.after)) : null,
      })),
    );
  }),

  http.post(`${base}/api/drafts/:id/changes`, async ({ params, request }) => {
    const entry = mockBackend.sessions.get(params.id as string);
    if (!entry) return HttpResponse.json({ code: 'DRAFT_NOT_FOUND' }, { status: 404 });
    const body = (await request.json()) as { targetType: string; op: string; entityId: string; after: unknown };
    const targetType = upperSnakeToCamelReverse(body.targetType);
    const op = upperSnakeToCamelReverse(body.op) as DraftOp;
    const seq = entry.changes.length === 0 ? 1 : Math.max(...entry.changes.map((c) => c.seq)) + 1;
    const now = new Date().toISOString();

    const overlay = overlayPlan(entry);
    const before = findBefore(targetType, body.entityId, overlay);
    const after = body.after ? domainOf(targetType, body.after) : null;

    const change = { id: mockBackend.nextId('change'), seq, at: now, targetType, op, before, after } as DraftChange;
    entry.changes.push(change);
    entry.session = { ...entry.session, updatedAt: now };

    return HttpResponse.json({
      id: change.id,
      draftSessionId: entry.session.id,
      seq: change.seq,
      at: change.at,
      targetType: body.targetType,
      op: body.op,
      beforeJson: before ? JSON.stringify(wireOf(targetType, before)) : null,
      afterJson: after ? JSON.stringify(wireOf(targetType, after)) : null,
    });
  }),

  http.delete(`${base}/api/drafts/:id/changes/:changeId`, ({ params }) => {
    const entry = mockBackend.sessions.get(params.id as string);
    if (!entry) return HttpResponse.json({ code: 'DRAFT_NOT_FOUND' }, { status: 404 });
    entry.changes = entry.changes.filter((c) => c.id !== params.changeId);
    return new HttpResponse(null, { status: 204 });
  }),

  http.post(`${base}/api/drafts/:id/discard`, ({ params }) => {
    const entry = mockBackend.sessions.get(params.id as string);
    if (!entry) return HttpResponse.json({ code: 'DRAFT_NOT_FOUND' }, { status: 404 });
    entry.session = { ...entry.session, status: 'DISCARDED' };
    return HttpResponse.json({});
  }),

  http.post(`${base}/api/drafts/:id/publish`, ({ params }) => {
    const entry = mockBackend.sessions.get(params.id as string);
    if (!entry) return HttpResponse.json({ code: 'DRAFT_NOT_FOUND' }, { status: 404 });
    const { assignments, absences, compDays } = overlayPlan(entry);
    mockBackend.data = { ...mockBackend.data, assignments, absences, compDays };
    entry.session = { ...entry.session, status: 'PUBLISHED' };
    return HttpResponse.json({ remainingGaps: 0, history: [], generatedCompDays: [] });
  }),

  http.post(`${base}/api/acknowledgements`, async ({ request }) => {
    const body = await request.json();
    return HttpResponse.json({ ...(body as object), at: new Date().toISOString() });
  }),

  http.get(`${base}/api/history`, () => HttpResponse.json([])),

  http.post(`${base}/api/suggest`, () => HttpResponse.json({ available: [], excluded: [], teamWeekendAverage: 0 })),

  http.post(`${base}/api/auto-populate`, () => HttpResponse.json({ assignments: [], compDays: [], gaps: [] })),

  http.put(`${base}/api/people/:id`, async ({ params, request }) => {
    const body = await request.json();
    return HttpResponse.json({ id: params.id, ...(body as object) });
  }),

  // -- Phase 6 admin CRUD ---------------------------------------------------
  // Minimal — enough for the Settings interaction tests to exercise the real
  // request/response round trip without reimplementing every validation rule
  // the .NET differential/integration tests already cover.

  ...adminCrudHandlers(base, 'locations', (d) => d.locations, (d, list) => ({ ...d, locations: list }), locationToWire),
  ...adminCrudHandlers(base, 'holidays', (d) => d.holidays, (d, list) => ({ ...d, holidays: list }), (h) => h),
  ...adminCrudHandlers(base, 'units', (d) => d.units, (d, list) => ({ ...d, units: list }), unitToWire),
  ...adminCrudHandlers(
    base,
    'absence-capacity-rules',
    (d) => d.absenceCapacityRules,
    (d, list) => ({ ...d, absenceCapacityRules: list }),
    (r) => r,
  ),
  ...adminCrudHandlers(base, 'shifts', (d) => d.shifts, (d, list) => ({ ...d, shifts: list }), shiftToWire),
  ...adminCrudHandlers(base, 'roles', (d) => d.roles, (d, list) => ({ ...d, roles: list }), roleToWire),

  http.put(`${base}/api/admin/regions/:id`, async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    mockBackend.data = {
      ...mockBackend.data,
      regions: mockBackend.data.regions.map((r) => (r.id === params.id ? { ...r, ...body } : r)),
    };
    return HttpResponse.json({ id: params.id, ...body });
  }),

  http.post(`${base}/api/admin/day-configurations`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const created = { id: mockBackend.nextId('dc'), ...body };
    mockBackend.data = { ...mockBackend.data, dayConfigurations: [...mockBackend.data.dayConfigurations, created as never] };
    return HttpResponse.json(created);
  }),
];

/** Builds GET(list is unused by the UI, which reads `/api/reference` instead) +
 * POST/PUT/DELETE handlers for one admin resource backed by a `mockBackend.data`
 * array. `toWireDomain` isn't applied here — the admin request body already *is*
 * the wire shape the real endpoint expects, so it's stored close to as-sent and
 * `/api/reference`'s own `*ToWire` mapping (already in this file) takes care of
 * shaping the read side consistently. */
function adminCrudHandlers<T extends { id: string }>(
  base: string,
  path: string,
  getList: (d: ScheduleDataset) => readonly T[],
  setList: (d: ScheduleDataset, list: T[]) => ScheduleDataset,
  _unused: (t: T) => unknown,
) {
  return [
    http.post(`${base}/api/admin/${path}`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      const created = { id: mockBackend.nextId(path), ...body } as unknown as T;
      mockBackend.data = setList(mockBackend.data, [...getList(mockBackend.data), created]);
      return HttpResponse.json(created);
    }),
    http.put(`${base}/api/admin/${path}/:id`, async ({ params, request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      const list = getList(mockBackend.data).map((item) =>
        item.id === params.id ? ({ ...item, ...body, id: item.id } as unknown as T) : item,
      );
      mockBackend.data = setList(mockBackend.data, list as T[]);
      return HttpResponse.json({ id: params.id, ...body });
    }),
    http.delete(`${base}/api/admin/${path}/:id`, ({ params }) => {
      const list = getList(mockBackend.data).filter((item) => item.id !== params.id);
      mockBackend.data = setList(mockBackend.data, list as T[]);
      return new HttpResponse(null, { status: 204 });
    }),
  ];
}

export const server = setupServer(...handlers);

// -- helpers ------------------------------------------------------------

function upperSnakeToCamelReverse(wireValue: string): DraftTargetType {
  const map: Record<string, DraftTargetType> = {
    assignment: 'ASSIGNMENT',
    absence: 'ABSENCE',
    compDay: 'COMP_DAY',
  };
  return map[wireValue] ?? 'ASSIGNMENT';
}

function domainOf(targetType: DraftTargetType, wire: unknown): Assignment | Absence | CompDayEntry {
  // The wire payload the client sends is already produced by
  // `draftChangeToWireBody`/`assignmentToWire` et al. — reversing it here
  // with the real `*FromWire` mappers keeps this mock honest about the
  // wire contract instead of accepting domain shapes it never receives.
  const w = wire as Record<string, unknown>;
  if (targetType === 'ASSIGNMENT') return fromWireAssignment(w);
  if (targetType === 'ABSENCE') return fromWireAbsence(w);
  return fromWireCompDay(w);
}

function wireOf(targetType: DraftTargetType, entity: Assignment | Absence | CompDayEntry): unknown {
  if (targetType === 'ASSIGNMENT') return assignmentToWireLocal(entity as Assignment);
  if (targetType === 'ABSENCE') return absenceToWireLocal(entity as Absence);
  return compDayToWireLocal(entity as CompDayEntry);
}

function findBefore(
  targetType: DraftTargetType,
  entityId: string,
  overlay: ReturnType<typeof overlayPlan>,
): Assignment | Absence | CompDayEntry | null {
  if (targetType === 'ASSIGNMENT') return overlay.assignments.find((a) => a.id === entityId) ?? null;
  if (targetType === 'ABSENCE') return overlay.absences.find((a) => a.id === entityId) ?? null;
  return overlay.compDays.find((c) => c.id === entityId) ?? null;
}

// Minimal local wire->domain reversal — small enough not to warrant reusing
// api/mapping.ts's private helpers, and keeps this mock free-standing.
function fromWireAssignment(w: Record<string, unknown>): Assignment {
  const contentKind = w.contentKind as string;
  return {
    id: w.id as string,
    personId: w.personId as string,
    date: w.date as string,
    regionId: w.regionId as string,
    content:
      contentKind === 'role'
        ? { kind: 'ROLE', roleId: w.roleId as string }
        : { kind: 'MARKER', marker: (w.marker as string) === 'off' ? 'OFF' : 'NOT_SCHEDULED' },
    isWeekend: Boolean(w.isWeekend),
    source: ((w.source as string) === 'manual' ? 'MANUAL' : (w.source as string) === 'generated' ? 'GENERATED' : 'IMPORTED'),
    version: (w.version as number) ?? 0,
    createdBy: (w.createdBy as string) ?? 'unknown',
    createdAt: (w.createdAt as string) ?? new Date().toISOString(),
    ...(w.updatedBy ? { updatedBy: w.updatedBy as string } : {}),
    ...(w.updatedAt ? { updatedAt: w.updatedAt as string } : {}),
  };
}
function fromWireAbsence(w: Record<string, unknown>): Absence {
  return {
    id: w.id as string,
    personId: w.personId as string,
    type: (w.type as string).toUpperCase() as Absence['type'],
    from: w.from as string,
    to: w.to as string,
    source: (w.source as string).toUpperCase() as Absence['source'],
  };
}
function fromWireCompDay(w: Record<string, unknown>): CompDayEntry {
  return {
    id: w.id as string,
    personId: w.personId as string,
    earnedForAssignmentId: w.earnedForAssignmentId as string,
    earnedForDate: w.earnedForDate as string,
    trigger: (w.trigger as string).toUpperCase() as CompDayEntry['trigger'],
    status: upperSnakeFromCamel(w.status as string) as CompDayEntry['status'],
    ...(w.proposedDate ? { proposedDate: w.proposedDate as string } : {}),
    ...(w.actualDate ? { actualDate: w.actualDate as string } : {}),
  };
}
function upperSnakeFromCamel(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
}
