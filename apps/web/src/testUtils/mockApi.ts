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
 *
 * Phase 8 deleted Region (units are the single computation scope now) and
 * merged `ShiftRole`/`ShiftDefinition` into one `Shift` entity — this mock
 * follows both changes.
 */

import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { API_BASE_URL } from '../api/client.ts';
import { instantToWire, timeToWire, upperSnakeToCamel, weekdaysToWire } from '../api/mapping.ts';
import {
  MOCK_REQUEST_TYPES,
  presenceToWire,
  selfServiceHandlers,
  type MockNotification,
  type MockRequest,
} from './mockSelfService.ts';
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
  ScheduleDataset,
  Weekday,
  Shift,
} from '../domain/types.ts';
import { buildMockDataset } from './mockDataset.ts';

function locationToWire(l: Location) {
  return { ...l, weekendDays: weekdaysToWire(l.weekendDays) };
}
function unitToWire(u: PlanningUnit) {
  return {
    ...u,
    kind: upperSnakeToCamel(u.kind),
    groupBy: upperSnakeToCamel(u.groupBy),
    compOffPolicy: { ...u.compOffPolicy, excludedWeekdays: weekdaysToWire(u.compOffPolicy.excludedWeekdays) },
  };
}
function shiftToWire(s: Shift) {
  return { ...s, start: timeToWire(s.start), end: timeToWire(s.end) };
}
function dayConfigToWire(c: ScheduleDataset['dayConfigurations'][number]) {
  return {
    ...c,
    weekdays: weekdaysToWire(c.weekdays),
    shiftRequirements: c.shiftRequirements.map((r) => ({
      shiftId: r.shiftId,
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
    unitId: a.unitId,
    shiftId: a.content.kind === 'SHIFT' ? a.content.shiftId : null,
    timeOverride:
      a.content.kind === 'SHIFT' && a.content.timeOverride
        ? {
            start: timeToWire(a.content.timeOverride.start),
            end: timeToWire(a.content.timeOverride.end),
            crossesMidnight: a.content.timeOverride.crossesMidnight,
          }
        : null,
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
    eventTypeId: a.eventTypeId,
    portion: upperSnakeToCamel(a.portion),
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
  /** Self-service state (ADR-0047), kept alongside the plan so a test can approve a
   * request and then assert on the presence record it produced. */
  requests: MockRequest[] = [];

  /** Role grants, as `/api/admin/role-assignments` stores them (ADR-0051). */
  roleAssignments: {
    id: string;
    personId: string;
    unitId: string | null;
    role: string;
    grantedBy: string;
    grantedAt: string;
  }[] = [];
  notifications: MockNotification[] = [];
  /**
   * The roles `/api/auth/me` reports. A **set**, and scoped to a unit or global
   * (ADR-0051) — the real server resolves the same shape from `RoleAssignment` rows.
   *
   * The default is a planner-and-approver of everywhere, which is what most tests want;
   * a test that cares about scoping sets the list itself.
   */
  roles: readonly { role: string; unitId?: string }[] = [
    { role: 'planner' },
    { role: 'approver' },
  ];
  private seq = 0;

  /**
   * The signed-in person, as the real server resolves it (ADR-0039): a real member of
   * the roster, not a phantom id. Both `/api/auth/me` and the draft editor come from
   * here, so the client can never see the two disagree.
   */
  get currentPersonId(): string {
    return this.data.people.find((p) => p.orgCategory === 'MANAGEMENT')?.id
      ?? this.data.people[0]?.id
      ?? 'p-unknown';
  }

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
  mockBackend.requests = [];
  mockBackend.notifications = [];
  mockBackend.roles = [{ role: 'planner' }, { role: 'approver' }];
  mockBackend.roleAssignments = [];
}

function inRange(date: IsoDate, range: DateRange): boolean {
  return date >= range.from && date <= range.to;
}

/** Mirrors `ScheduleEndpoints.ResolveUnitIds` closely enough for tests:
 * `ALL_UNITS` sees every unit, an existing unit id sees just itself. */
function resolveUnitIds(unitId: string): string[] {
  if (!unitId || unitId === 'ALL' || unitId === 'ALL_UNITS') return mockBackend.data.units.map((u) => u.id);
  // A scope may name several units (`unit-amer,unit-st`) — same grammar the real
  // ScheduleEndpoints.ResolveUnitIds parses.
  if (unitId.includes(',')) {
    const named = new Set(unitId.split(',').filter(Boolean));
    const known = mockBackend.data.units.filter((u) => named.has(u.id)).map((u) => u.id);
    if (known.length > 0) return known;
  }
  const unit = mockBackend.data.units.find((u) => u.id === unitId);
  return unit ? [unit.id] : mockBackend.data.units.map((u) => u.id);
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
function resolveMockDayConfig(unitId: string, date: IsoDate) {
  const utcDay = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0=Sun..6=Sat
  const weekday = (utcDay === 0 ? 7 : utcDay) as Weekday;
  return mockBackend.data.dayConfigurations.find(
    (c) => c.unitId === unitId && c.weekdays.includes(weekday),
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
  // ADR-0039: the client asks the server who it is instead of assuming.
  http.get(`${base}/api/auth/me`, () =>
    HttpResponse.json({
      personId: mockBackend.currentPersonId,
      displayName: 'Planner (test)',
      roles: [{ role: 'viewer', unitId: null }, ...mockBackend.roles.map((r) => ({
        role: r.role,
        unitId: r.unitId ?? null,
      }))],
      stubMode: true,
    })),

  http.get(`${base}/api/reference`, () => {
    const d = mockBackend.data;
    return HttpResponse.json({
      locations: d.locations.map(locationToWire),
      holidays: d.holidays,
      units: d.units.map(unitToWire),
      shifts: d.shifts.map(shiftToWire),
      dayConfigurations: d.dayConfigurations.map(dayConfigToWire),
      people: d.people.map(personToWire),
      absenceCapacityRules: d.absenceCapacityRules,
      // The real ReferenceResponse carries these (ADR-0045). Omitting them left the cell
      // menu with an empty Time off section and no test could see it -- the same class of
      // gap that hid presence from `/api/schedule`.
      eventTypes: d.eventTypes,
      presenceTypes: d.presenceTypes,
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

    const unitIds = resolveUnitIds(unitId);
    const dates = eachIsoDate(from, to);

    const dayConfigs = unitIds.flatMap((uid) =>
      dates
        .map((date) => {
          const config = resolveMockDayConfig(uid, date);
          return config
            ? { date, unitId: uid, dayConfigurationId: config.id, key: config.key, label: config.label ?? null }
            : undefined;
        })
        .filter((c): c is NonNullable<typeof c> => c !== undefined),
    );

    const coverage = unitIds.flatMap((uid) =>
      dates.flatMap((date) => {
        const config = resolveMockDayConfig(uid, date);
        if (!config) return [];
        return config.shiftRequirements.map((req) => {
          const actual = assignments.filter(
            (a) => a.date === date && a.content.kind === 'SHIFT' && a.content.shiftId === req.shiftId,
          ).length;
          const level = actual < req.min ? 'gap' : actual === req.min ? 'thin' : 'ok';
          return {
            date,
            unitId: uid,
            shiftId: req.shiftId,
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
        key: `COVERAGE_GAP|${cell.date}||${cell.shiftId}`,
        // INFO, not BLOCKING — coverage gaps stopped blocking publication
        // (ADR-0035); mirrors Validator.cs's CheckCoverage.
        level: 'info',
        category: 'gap',
        code: 'coverageGap',
        message: `${cell.shiftId}: ${cell.actual} assigned, minimum is ${cell.min}`,
        unitId: cell.unitId,
        date: cell.date,
        personId: null,
        shiftId: cell.shiftId,
      }));

    return HttpResponse.json({
      unitIds,
      plan: {
        assignments: assignments.filter((a) => inRange(a.date, { from, to })).map(assignmentToWireLocal),
        absences: absences
          .filter((a) => mockBackend.overlaps({ from: a.from, to: a.to }, { from, to }))
          .map(absenceToWireLocal),
        compDays: compDays.map(compDayToWireLocal),
        // Presence rides on the plan response so the grid needs one round trip, not two
        // (ADR-0043). Overlap, not containment: a block that started earlier still
        // covers days in this window.
        presence: mockBackend.data.presence
          .filter((p) => mockBackend.overlaps({ from: p.from, to: p.to }, { from, to }))
          .map(presenceToWire),
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
      unitId: string;
      rangeFrom: string;
      rangeTo: string;
    };
    const now = new Date().toISOString();
    const session: DraftSession = {
      id: mockBackend.nextId('draft'),
      // The editor comes from the authenticated principal, not the payload (ADR-0039).
      editorPersonId: mockBackend.currentPersonId,
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

  // Used two ways: other people's overlapping drafts (the informational banner) and, with
  // `mine`, the caller's own — which is how a view change resumes a draft instead of
  // dropping it. Returning a flat [] made the second unobservable in any test.
  http.get(`${base}/api/drafts`, ({ request }) => {
    const url = new URL(request.url);
    const unitId = url.searchParams.get('unitId');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const mine = url.searchParams.get('mine') === 'true';

    const open = [...mockBackend.sessions.values()]
      .map((entry) => entry.session)
      .filter((s) => s.status === 'OPEN')
      .filter((s) => !unitId || s.unitId === unitId)
      .filter((s) => !from || s.range.to >= from)
      .filter((s) => !to || s.range.from <= to)
      .filter((s) => !mine || s.editorPersonId === mockBackend.currentPersonId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    return HttpResponse.json(
      open.map((s) => ({
        id: s.id,
        editorPersonId: s.editorPersonId,
        unitId: s.unitId,
        rangeFrom: s.range.from,
        rangeTo: s.range.to,
        status: 'open',
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
    );
  }),

  // The advisory "somebody else is editing here" overlay (ADR-0015). Empty rather than
  // absent: the grid polls it on every render, and an unhandled request is the sort of
  // gap that has twice hidden a real one here.
  http.get(`${base}/api/drafts/staged`, () => HttpResponse.json({ cells: [] })),

  // One person's own year. Filtered here rather than returned whole, because "does this
  // screen show somebody else's rows" is the property most worth being able to test.
  http.get(`${base}/api/me/calendar`, ({ request }) => {
    const url = new URL(request.url);
    const from = url.searchParams.get('from') ?? '';
    const to = url.searchParams.get('to') ?? '';
    const me = mockBackend.currentPersonId;
    const d = mockBackend.data;
    const overlaps = (a: { from: string; to: string }) => a.from <= to && a.to >= from;

    return HttpResponse.json({
      personId: me,
      assignments: d.assignments
        .filter((a) => a.personId === me && a.date >= from && a.date <= to)
        .map(assignmentToWireLocal),
      absences: d.absences.filter((a) => a.personId === me && overlaps(a)).map(absenceToWireLocal),
      compDays: d.compDays.filter((c) => c.personId === me).map(compDayToWireLocal),
      presence: d.presence.filter((p) => p.personId === me && overlaps(p)).map(presenceToWire),
      pendingRequests: mockBackend.requests
        .filter((r) => r.subjectPersonId === me && (r.state === 'submitted' || r.state === 'approved'))
        .map((r) => ({
          id: r.id,
          typeId: r.typeId,
          typeLabel: MOCK_REQUEST_TYPES.find((t) => t.id === r.typeId)?.label ?? r.typeId,
          from: r.from,
          to: r.to,
          portion: 'full',
          state: r.state,
        })),
    });
  }),

  http.get(`${base}/api/me/calendar-feed`, () =>
    HttpResponse.json({ url: `${base}/api/calendar/mock-token.ics` })),

  http.post(`${base}/api/me/calendar-feed/reset`, () =>
    HttpResponse.json({ url: `${base}/api/calendar/mock-token-2.ics` })),

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

  // Mirrors DraftsEndpoints.SyncAssignment/SyncAbsence/SyncCompDay: `before`
  // comes from *published* data only (never from the draft overlay), the op is
  // derived from it, and one change is kept per key. Being as strict as the real
  // server here is the point — the previous handler resolved `before` against
  // the overlay, which is exactly why the client's op mismatch never showed up
  // in tests while failing in the browser.
  http.post(`${base}/api/drafts/:id/changes/sync`, async ({ params, request }) => {
    const entry = mockBackend.sessions.get(params.id as string);
    if (!entry) return HttpResponse.json({ code: 'DRAFT_NOT_FOUND' }, { status: 404 });
    const body = (await request.json()) as {
      changes: readonly { targetType: string; key: string; after: unknown }[];
    };
    const now = new Date().toISOString();

    for (const item of body.changes) {
      const targetType = upperSnakeToCamelReverse(item.targetType);
      const before = findPublished(targetType, item.key);
      const raw = item.after ? domainOf(targetType, item.after) : null;

      entry.changes = entry.changes.filter((c) => keyOfChange(c) !== `${targetType} ${item.key}`);
      if (!before && !raw) continue;

      // The client's locally-minted id loses to the published row's, same as
      // the server does.
      const after =
        raw && before && targetType === 'ASSIGNMENT' ? { ...raw, id: before.id } : raw;
      const op: DraftOp = !before ? 'CREATE' : !after ? 'DELETE' : 'UPDATE';
      const seq = entry.changes.length === 0 ? 1 : Math.max(...entry.changes.map((c) => c.seq)) + 1;
      entry.changes.push({
        id: mockBackend.nextId('change'),
        seq,
        at: now,
        targetType,
        op,
        before,
        after,
      } as DraftChange);
    }

    entry.session = { ...entry.session, updatedAt: now };
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

  // ADR-0048: the deciding factor is computed and always present; the prose is null
  // when no model is configured, which is the default everywhere including tests.
  http.post(`${base}/api/insights/candidate-explanation`, () =>
    HttpResponse.json({
      explanation: null,
      digest: '',
      suggestedPersonId: null,
      suggestedPersonName: null,
      decidingFactor: 'nobody is both eligible and available',
      availableCount: 0,
      excludedCount: 0,
      model: null,
      generatedAt: new Date().toISOString(),
    })),

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

  http.post(`${base}/api/admin/day-configurations`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const created = { id: mockBackend.nextId('dc'), ...body };
    mockBackend.data = { ...mockBackend.data, dayConfigurations: [...mockBackend.data.dayConfigurations, created as never] };
    return HttpResponse.json(created);
  }),

  // Absences are direct writes now (ADR-0052) — no draft, no publish.
  http.post(`${base}/api/absences`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const created = {
      id: mockBackend.nextId('abs'),
      personId: body.personId as string,
      eventTypeId: body.eventTypeId as string,
      from: body.from as string,
      to: body.to as string,
      portion: ((body.portion as string) ?? 'full'),
      source: 'manual',
      note: (body.note as string | null) ?? null,
      version: 1,
    };
    mockBackend.data = {
      ...mockBackend.data,
      absences: [
        ...mockBackend.data.absences,
        {
          id: created.id,
          personId: created.personId,
          eventTypeId: created.eventTypeId,
          from: created.from,
          to: created.to,
          portion: upperOf(created.portion),
          source: 'MANUAL' as const,
          version: 1,
          ...(created.note ? { note: created.note } : {}),
        },
      ],
    };
    return HttpResponse.json(created, { status: 201 });
  }),

  http.put(`${base}/api/absences/:id`, async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const id = params.id as string;
    const existing = mockBackend.data.absences.find((a) => a.id === id);
    if (!existing) return new HttpResponse(null, { status: 404 });
    const updated = {
      ...existing,
      eventTypeId: body.eventTypeId as string,
      portion: upperOf((body.portion as string) ?? 'full'),
      ...(body.note ? { note: body.note as string } : {}),
      version: existing.version + 1,
    };
    mockBackend.data = {
      ...mockBackend.data,
      absences: mockBackend.data.absences.map((a) => (a.id === id ? updated : a)),
    };
    return HttpResponse.json({ ...updated, portion: (updated.portion as string).toLowerCase() });
  }),

  http.delete(`${base}/api/absences/:id`, ({ params }) => {
    mockBackend.data = {
      ...mockBackend.data,
      absences: mockBackend.data.absences.filter((a) => a.id !== params.id),
    };
    return new HttpResponse(null, { status: 204 });
  }),

  http.get(`${base}/api/admin/role-assignments`, ({ request }) => {
    const unitId = new URL(request.url).searchParams.get('unitId');
    return HttpResponse.json(
      unitId === null
        ? mockBackend.roleAssignments
        : mockBackend.roleAssignments.filter((r) => r.unitId === unitId),
    );
  }),

  http.post(`${base}/api/admin/role-assignments`, async ({ request }) => {
    const body = (await request.json()) as { personId: string; unitId: string | null; role: string };
    // Granting something already held is the same grant, not a second row — the server
    // returns the existing one rather than erroring.
    const existing = mockBackend.roleAssignments.find(
      (r) => r.personId === body.personId && r.unitId === body.unitId && r.role === body.role,
    );
    if (existing) return HttpResponse.json(existing);

    const created = {
      id: mockBackend.nextId('ra'),
      personId: body.personId,
      unitId: body.unitId,
      role: body.role,
      grantedBy: mockBackend.currentPersonId,
      grantedAt: new Date().toISOString(),
    };
    mockBackend.roleAssignments.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),

  http.delete(`${base}/api/admin/role-assignments/:id`, ({ params }) => {
    mockBackend.roleAssignments = mockBackend.roleAssignments.filter((r) => r.id !== params.id);
    return new HttpResponse(null, { status: 204 });
  }),

  ...selfServiceHandlers(base),
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

/** Published state behind a sync key — an assignment's key is its cell. */
function findPublished(
  targetType: DraftTargetType,
  key: string,
): Assignment | Absence | CompDayEntry | null {
  if (targetType === 'ASSIGNMENT') {
    return mockBackend.data.assignments.find((a) => `${a.personId}|${a.date}` === key) ?? null;
  }
  if (targetType === 'ABSENCE') return mockBackend.data.absences.find((a) => a.id === key) ?? null;
  return mockBackend.data.compDays.find((c) => c.id === key) ?? null;
}

/** Same identity rule as `DraftService.KeyOf` server-side. */
function keyOfChange(change: DraftChange): string {
  const entity = change.after ?? change.before;
  if (!entity) return change.id;
  if (change.targetType === 'ASSIGNMENT') {
    const a = entity as Assignment;
    return `ASSIGNMENT ${a.personId}|${a.date}`;
  }
  return `${change.targetType} ${entity.id}`;
}

// Minimal local wire->domain reversal — small enough not to warrant reusing
// api/mapping.ts's private helpers, and keeps this mock free-standing.
/** The wire is camelCase; the domain is upper snake. One helper, two absence routes. */
function upperOf(portion: string): 'FULL' | 'MORNING' | 'AFTERNOON' {
  const upper = portion.toUpperCase();
  return upper === 'MORNING' || upper === 'AFTERNOON' ? upper : 'FULL';
}

function fromWireAssignment(w: Record<string, unknown>): Assignment {
  return {
    id: w.id as string,
    personId: w.personId as string,
    date: w.date as string,
    unitId: w.unitId as string,
    content: { kind: 'SHIFT', shiftId: w.shiftId as string },
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
    eventTypeId: w.eventTypeId as string,
    portion: ((w.portion as string) ?? 'full').toUpperCase() as Absence['portion'],
    from: w.from as string,
    to: w.to as string,
    source: (w.source as string).toUpperCase() as Absence['source'],
    version: (w.version as number) ?? 1,
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
    version: (w.version as number) ?? 1,
  };
}
function upperSnakeFromCamel(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
}
