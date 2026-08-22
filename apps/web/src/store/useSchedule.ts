/**
 * NOTE: State for the planning screen.
 *
 * Published data and the draft are kept apart (ADR-0015): `published` is what
 * everyone sees, `draft` is the current editor's ordered changes. The grid
 * shows `published + draft`, but publishing only happens on an explicit action.
 *
 * NOTE: Undo/redo falls out of every change carrying a `before` and an `after`.
 */

import { create } from 'zustand';
import type { AutoPopulateResult } from '../api/planning.ts';
import {
  referenceQueryOptions,
  scheduleQueryKey,
  scheduleQueryOptions,
  type ScheduleResponse,
} from '../api/queries.ts';
import { queryClient } from '../api/queryClient.ts';
import { scheduleRepository } from '../data/httpRepository.ts';
import type { DraftSyncItem, PublishOutcome } from '../data/repository.ts';
import {
  absenceChange,
  applyChanges,
  assignmentChange,
  compDayChange,
  isNoop,
} from '../domain/draft.ts';
import { buildIndex, cellKey, type DatasetIndex } from '../domain/lookup.ts';
import type {
  Absence,
  Acknowledgement,
  Assignment,
  CompDayEntry,
  DateRange,
  DraftChange,
  DraftSession,
  IsoDate,
  Person,
  PersonId,
  PlanData,
  PublishConflict,
  PublishResult,
  ReferenceData,
  ScheduleDataset,
  ShiftId,
  UnitId,
} from '../domain/types.ts';
import { scopeIncludes } from '../domain/unitScope.ts';
import { isWeekendIn } from '../engine/dates.ts';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

/** NOTE: Grid cell: a (person, date) pair. */
export interface CellRef {
  readonly personId: PersonId;
  readonly date: IsoDate;
}

export interface ScheduleState {
  status: LoadStatus;
  error: string | undefined;

  unitId: UnitId | undefined;
  range: DateRange | undefined;
  currentUserId: PersonId | undefined;

  reference: ReferenceData | undefined;
  /** NOTE: Published data — what everyone sees. */
  published: PlanData | undefined;
  /** NOTE: Published plus the applied draft — what the grid renders. */
  plan: PlanData | undefined;
  index: DatasetIndex | undefined;

  session: DraftSession | undefined;
  changes: DraftChange[];
  /** NOTE: Changes undone and available for redo. */
  redoStack: DraftChange[][];
  /** NOTE: Batches for undo: one user action is one batch. */
  undoStack: DraftChange[][];
  /** NOTE: Other people's open drafts for the same period — informational banner. */
  overlappingDrafts: readonly DraftSession[];

  publishing: boolean;
  lastPublish: PublishResult | undefined;
  conflicts: readonly PublishConflict[];

  /**
   * Draft-change sync is debounced and coverage/issues revalidate only
   * after the batch settles (Phase 5 step 5) — `pendingSync` is true between
   * a cell edit and that flush landing, for a "saving…" indicator that
   * doesn't require touching the (memoized, perf-sensitive — CLAUDE.md)
   * grid cells themselves.
   */
  pendingSync: boolean;

  /**
   * NOTE: Why edits didn't make it to the draft, if they didn't.
   *
   * WHY: A sync failure used to go only to `console.error` and show up nowhere
   * else: the grid displayed the edit as done, the server didn't know about
   * it, and the two silently diverged — until publish, which saved half.
   * Now this is visible state, and publish is blocked while it's set.
   */
  syncError: string | undefined;

  load: (unitId: UnitId, range: DateRange) => Promise<void>;
  startDraft: () => Promise<void>;
  setCell: (personId: PersonId, date: IsoDate, shiftId: ShiftId | null) => void;
  setCells: (cells: readonly CellRef[], shiftId: ShiftId | null) => void;
  setMarker: (cells: readonly CellRef[], marker: 'OFF' | 'NOT_SCHEDULED') => void;
  setAbsence: (absence: Absence | null, previous?: Absence) => void;
  setAbsences: (absences: readonly Absence[]) => void;
  setCompDay: (entry: CompDayEntry, previous?: CompDayEntry) => void;
  acknowledge: (issueKey: string, comment: string) => Promise<void>;
  /** NOTE: A person's profile — reference data, goes around the draft. */
  savePerson: (person: Person) => Promise<void>;
  /** NOTE: Stages the auto-populate preview result into the draft, opening it if needed. */
  commitAutoPopulate: (result: AutoPopulateResult) => Promise<void>;
  /** NOTE: Stages an absence import into the draft as one batch — Undo rolls it all back. */
  commitAbsenceImport: (changes: readonly DraftChange[]) => Promise<void>;
  undo: () => void;
  redo: () => void;
  /** NOTE: Flushes everything still waiting on the debounce and awaits any already in flight. */
  flushNow: () => Promise<void>;
  publish: () => Promise<PublishOutcome | undefined>;
  discard: () => Promise<void>;
}

let assignmentSeq = 0;
let seqCounter = 0;

function newAssignmentId(): string {
  assignmentSeq += 1;
  return `as-local-${Date.now().toString(36)}-${assignmentSeq}`;
}

function nextSeq(): number {
  seqCounter += 1;
  return seqCounter;
}

function datasetOf(reference: ReferenceData, plan: PlanData): ScheduleDataset {
  return { ...reference, ...plan, history: [] };
}

/**
 * NOTE: Sync key: what the change is about, not what kind of change it is.
 *
 * For an assignment it's the cell (a cell never holds two assignments); for
 * an absence or comp day it's the record's id. Twenty edits to one cell are
 * twenty versions of one decision; the server gets the last one, not a tape
 * of operations over a state it doesn't have.
 */
type SyncKey = string;

function syncKeyOf(change: DraftChange): SyncKey | undefined {
  if (change.targetType === 'ASSIGNMENT') {
    const entity = change.after ?? change.before;
    return entity ? `ASSIGNMENT ${cellKey(entity.personId, entity.date)}` : undefined;
  }
  const entity = change.after ?? change.before;
  return entity ? `${change.targetType} ${entity.id}` : undefined;
}

/**
 * NOTE: Reads the desired state off the plan for each key.
 *
 * WHY: The indexes are built once per batch, not looked up per key: painting
 * a range produces a hundred keys against a plan of a couple thousand
 * assignments (CLAUDE.md: the grid is performance-sensitive).
 */
function syncItemsFor(keys: readonly SyncKey[], plan: PlanData): DraftSyncItem[] {
  const assignments = new Map(plan.assignments.map((a) => [cellKey(a.personId, a.date), a]));
  const absences = new Map(plan.absences.map((a) => [a.id, a]));
  const compDays = new Map(plan.compDays.map((c) => [c.id, c]));

  return keys.map((key) => {
    const separator = key.indexOf(' ');
    const targetType = key.slice(0, separator) as DraftChange['targetType'];
    const entityKey = key.slice(separator + 1);
    const after =
      targetType === 'ASSIGNMENT'
        ? (assignments.get(entityKey) ?? null)
        : targetType === 'ABSENCE'
          ? (absences.get(entityKey) ?? null)
          : (compDays.get(entityKey) ?? null);
    return { targetType, key: entityKey, after };
  });
}

/** The date span one change touches — a single date for an assignment/comp
 * day, the whole `[from, to]` for an absence. */
function dateRangeOfChange(change: DraftChange): DateRange | undefined {
  if (change.targetType === 'ABSENCE') {
    const entity = change.after ?? change.before;
    return entity ? { from: entity.from, to: entity.to } : undefined;
  }
  if (change.targetType === 'ASSIGNMENT') {
    const entity = change.after ?? change.before;
    return entity ? { from: entity.date, to: entity.date } : undefined;
  }
  const entity = change.after ?? change.before;
  return entity ? { from: entity.earnedForDate, to: entity.earnedForDate } : undefined;
}

/** Union of every change's touched span — what a scoped revalidation needs
 * to re-fetch, instead of the whole visible period (Phase 5 step 5). */
function dateRangeOfChanges(changes: readonly DraftChange[]): DateRange | undefined {
  let from: IsoDate | undefined;
  let to: IsoDate | undefined;
  for (const change of changes) {
    const span = dateRangeOfChange(change);
    if (!span) continue;
    if (!from || span.from < from) from = span.from;
    if (!to || span.to > to) to = span.to;
  }
  return from && to ? { from, to } : undefined;
}

const SYNC_DEBOUNCE_MS = 400;
/** NOTE: Pause before a retry after a failure — longer than the debounce: this is no longer batching. */
const SYNC_RETRY_MS = 2000;
const SYNC_MAX_RETRIES = 3;

/** TanStack Query rejects an in-flight query's promise with this shape when
 * it's cancelled (queryClient.clear()/removeQueries, a superseding fetch) —
 * not a failure, just a query that stopped mattering. */
function isCancellationError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'revert' in error && 'silent' in error;
}

export const useSchedule = create<ScheduleState>((set, get) => {
  // Batches edits into one request instead of one POST per keystroke/paint —
  // module-scoped (not component state) because edits happen from several
  // call sites (setCell, setCells, commitAutoPopulate, absence import…) that
  // all route through `commit()` below.
  //
  // NOTE: The queue holds **keys**, not changes: whatever happens to a cell
  // after the edit — a second paint, undo, rolling back the whole batch —
  // what goes to the server is its state at send time. So a retry after a
  // failure is safe and doesn't need to remember what exactly didn't land.
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | undefined;
  let dirtyKeys = new Set<SyncKey>();
  let pendingRange: DateRange | undefined;
  let consecutiveFailures = 0;

  /**
   * Overview and Schedule now own independent periods (ADR-0036) and each
   * writes `useUi.range` on mount — switching screens quickly fires two
   * overlapping `load()` calls for two different ranges. Without a guard, the
   * one that resolves last wins regardless of which is the one the user is
   * actually looking at. `loadSeq` tags each call; a `load()` that isn't the
   * newest anymore drops its response instead of overwriting fresher state.
   */
  let loadSeq = 0;

  /** NOTE: In-flight `startDraft`, so concurrent edits don't open two sessions. */
  let opening: Promise<void> | undefined;

  /**
   * Re-fetches coverage/issues/day-configurations for exactly the dates an
   * edit batch touched and patches them into the cached full-period schedule
   * query — not `invalidateQueries` on the whole (unitId, range) key, which
   * would re-fetch a full month of ~2300 assignments after every batch and
   * make range-painting unusable (Phase 5 step 5, the plan's own caution).
   */
  async function revalidateTouched(touched: DateRange): Promise<void> {
    const { unitId, range, session } = get();
    if (!unitId || !range) return;
    const draftId = session?.id;
    const delta = await queryClient.fetchQuery({
      ...scheduleQueryOptions(unitId, touched, draftId),
      staleTime: 0,
    });
    const key = scheduleQueryKey(unitId, range, draftId);
    queryClient.setQueryData(key, (old: ScheduleResponse | undefined) => {
      if (!old) return old;
      const inTouched = (date: IsoDate | undefined) =>
        date !== undefined && date >= touched.from && date <= touched.to;
      return {
        ...old,
        coverage: [...old.coverage.filter((c) => !inTouched(c.date)), ...delta.coverage],
        issues: [...old.issues.filter((i) => !inTouched(i.date)), ...delta.issues],
        dayConfigurations: [
          ...old.dayConfigurations.filter((c) => !inTouched(c.date)),
          ...delta.dayConfigurations,
        ],
        // Issue-acknowledgement keys are cheap and global, not worth diffing.
        acknowledgedIssueKeys: delta.acknowledgedIssueKeys,
      };
    });
  }

  function widenPendingRange(span: DateRange | undefined): void {
    if (!span) return;
    pendingRange = pendingRange
      ? {
          from: span.from < pendingRange.from ? span.from : pendingRange.from,
          to: span.to > pendingRange.to ? span.to : pendingRange.to,
        }
      : span;
  }

  /**
   * NOTE: Sends the current state of every "dirty" key in one request.
   *
   * WHY: A failure puts the keys back in the queue instead of losing them:
   * state is recomputed from the plan each time, so a retry never duplicates
   * anything. After `SYNC_MAX_RETRIES` in a row, retries stop — past that
   * point it's no longer a network hiccup but a failure the planner needs to
   * see; `syncError` stays set and blocks publish.
   */
  async function runFlush(sessionId: string): Promise<void> {
    flushTimer = undefined;
    const keys = [...dirtyKeys];
    const touched = pendingRange;
    dirtyKeys = new Set();
    pendingRange = undefined;

    const plan = get().plan;
    if (keys.length === 0 || !plan) {
      set({ pendingSync: false });
      return;
    }

    try {
      await scheduleRepository.syncChanges(sessionId, syncItemsFor(keys, plan));
      consecutiveFailures = 0;
      set({ syncError: undefined });
      if (touched) await revalidateTouched(touched);
    } catch (error) {
      // A query cancelled out from under this flush (period changed, cache
      // torn down mid-flight in a test) is expected and means nothing failed.
      if (isCancellationError(error)) return;

      for (const key of keys) dirtyKeys.add(key);
      widenPendingRange(touched);
      consecutiveFailures += 1;
      const message = error instanceof Error ? error.message : String(error);
      set({ syncError: message });
      console.error('Draft sync failed', error);
      if (consecutiveFailures < SYNC_MAX_RETRIES) {
        flushTimer = setTimeout(() => void flush(sessionId), SYNC_RETRY_MS);
      }
    } finally {
      // Only clear the indicator if nothing new queued up while this flush
      // was in flight.
      if (dirtyKeys.size === 0) set({ pendingSync: false });
    }
  }

  /** NOTE: Fire-and-forget wrapper: keeps a reference so `flushNow` can await it. */
  function flush(sessionId: string): void {
    const run = runFlush(sessionId).finally(() => {
      if (inFlight === run) inFlight = undefined;
    });
    inFlight = run;
    void run;
  }

  function queueForSync(sessionId: string, changes: readonly DraftChange[]): void {
    for (const change of changes) {
      const key = syncKeyOf(change);
      if (key) dirtyKeys.add(key);
    }
    widenPendingRange(dateRangeOfChanges(changes));
    set({ pendingSync: true });
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => flush(sessionId), SYNC_DEBOUNCE_MS);
  }

  /** NOTE: Clears everything queued up — the draft closed or the period changed. */
  function cancelSync(): void {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = undefined;
    dirtyKeys = new Set();
    pendingRange = undefined;
    consecutiveFailures = 0;
  }
  /** NOTE: Rebuilds `plan` and the index from published plus the draft. */
  function recompute(
    reference: ReferenceData,
    published: PlanData,
    changes: readonly DraftChange[],
  ): { plan: PlanData; index: DatasetIndex } {
    const plan = applyChanges(published, changes);
    return { plan, index: buildIndex(datasetOf(reference, plan)) };
  }

  /**
   * NOTE: Applies a batch of changes: updates the draft, the stacks, and
   * derived data. Empty batches are ignored, otherwise Ctrl+Z would become
   * unpredictable.
   */
  function commit(
    incoming: readonly DraftChange[],
    options: { readonly fromHistory?: boolean } = {},
  ): void {
    const meaningful = incoming.filter((change) => !isNoop(change));
    if (meaningful.length === 0) return;

    const state = get();
    const { reference, published } = state;
    if (!reference || !published) return;

    const changes = [...state.changes, ...meaningful];
    const { plan, index } = recompute(reference, published, changes);

    set({
      changes,
      plan,
      index,
      ...(options.fromHistory
        ? {}
        : { undoStack: [...state.undoStack, [...meaningful]], redoStack: [] }),
    });

    const sessionId = state.session?.id;
    if (sessionId) queueForSync(sessionId, meaningful);
  }

  /** NOTE: Builds cell changes, dropping impossible ones. */
  function cellChanges(
    cells: readonly CellRef[],
    content: Assignment['content'] | null,
  ): DraftChange[] {
    const { plan, index, currentUserId } = get();
    if (!plan || !index) return [];

    const existing = new Map<string, Assignment>();
    for (const assignment of plan.assignments) {
      existing.set(cellKey(assignment.personId, assignment.date), assignment);
    }

    const now = new Date().toISOString();
    const changes: DraftChange[] = [];

    for (const cell of cells) {
      const before = existing.get(cellKey(cell.personId, cell.date)) ?? null;

      if (content === null) {
        if (!before) continue;
        changes.push(assignmentChange(before, null, nextSeq(), now));
        continue;
      }

      const person = index.people.get(cell.personId);
      if (!person) continue;
      const location = index.locations.get(person.locationId);

      if (content.kind === 'SHIFT') {
        // NOTE: A shift is always taken from the person's own unit — one from elsewhere never matches.
        const shift = index.shifts.get(content.shiftId);
        if (!shift || shift.unitId !== person.unitId) continue;
        if (before?.content.kind === 'SHIFT' && before.content.shiftId === content.shiftId) continue;
      } else if (before?.content.kind === 'MARKER' && before.content.marker === content.marker) {
        continue;
      }

      const after: Assignment = {
        id: before?.id ?? newAssignmentId(),
        personId: cell.personId,
        date: cell.date,
        unitId: person.unitId,
        content,
        // NOTE: A day off follows the person's location calendar, not the
        // shift (ADR-0002) — the same check auto-populate uses for generated cells.
        isWeekend: location ? isWeekendIn(cell.date, location) : (before?.isWeekend ?? false),
        source: 'MANUAL',
        version: before?.version ?? 0,
        createdBy: before?.createdBy ?? currentUserId ?? 'unknown',
        createdAt: before?.createdAt ?? now,
        updatedBy: currentUserId ?? 'unknown',
        updatedAt: now,
      };
      changes.push(assignmentChange(before, after, nextSeq(), now));
    }

    return changes;
  }

  /**
   * Comp-day proposals no longer materialize into the draft the instant a
   * Saturday/Sunday cell is filled: that generation moved to the server
   * (`CompDayService.Propose`, run inside `DraftService.Publish`) along with
   * the rest of the accrual engine (ADR: domain logic on the server). The
   * planner sees the accrual once the batch is published, not before —
   * `commitAutoPopulate` still stages comp days directly when a preview
   * already carries them (`api/planning.ts`'s `runAutoPopulate`).
   */
  function commitCells(
    cells: readonly CellRef[],
    content: Assignment['content'] | null,
  ): void {
    const changes = cellChanges(cells, content);
    if (changes.length === 0) return;
    commit(changes);
  }

  return {
    status: 'idle',
    error: undefined,
    unitId: undefined,
    range: undefined,
    currentUserId: undefined,
    reference: undefined,
    published: undefined,
    plan: undefined,
    index: undefined,
    session: undefined,
    changes: [],
    undoStack: [],
    redoStack: [],
    overlappingDrafts: [],
    publishing: false,
    lastPublish: undefined,
    conflicts: [],
    pendingSync: false,
    syncError: undefined,

    async load(unitId, range) {
      const seq = ++loadSeq;
      cancelSync();
      set({ status: 'loading', error: undefined });
      try {
        // TanStack Query owns server state (Phase 5): both fetches go through
        // its cache, so a second consumer of the same (unitId, range) —
        // `usePlanningView`'s schedule query for coverage/issues — reuses this
        // request instead of firing it again.
        const [reference, scheduleResponse] = await Promise.all([
          queryClient.fetchQuery(referenceQueryOptions()),
          queryClient.fetchQuery(scheduleQueryOptions(unitId, range, undefined)),
        ]);
        // A newer `load()` started (and possibly already resolved) while this
        // one was in flight — its answer is stale, and applying it now would
        // yank the screen back to a period the user has already left.
        if (seq !== loadSeq) return;

        const published: PlanData = { ...scheduleResponse.plan, acknowledgements: [] };

        // NOTE: No authentication yet: the first included person in the unit.
        // With `ALL` there's no single unit — take any manager.
        const inScope = (p: (typeof reference.people)[number]): boolean =>
          scopeIncludes(unitId, p.unitId);
        const currentUserId =
          reference.people.find((p) => inScope(p) && p.orgCategory === 'MANAGEMENT')?.id ??
          reference.people.find(inScope)?.id;

        const { plan, index } = recompute(reference, published, []);
        set({
          status: 'ready',
          unitId,
          range,
          reference,
          published,
          plan,
          index,
          currentUserId,
          session: undefined,
          changes: [],
          undoStack: [],
          redoStack: [],
          overlappingDrafts: [],
          conflicts: [],
          pendingSync: false,
          syncError: undefined,
        });
      } catch (error) {
        if (seq !== loadSeq) return;
        set({ status: 'error', error: error instanceof Error ? error.message : String(error) });
      }
    },

    async startDraft() {
      // NOTE: Any edit opens the draft by itself (ADR-0023), and two quick
      // edits in a row both see `session === undefined`. Without this guard
      // they'd open two sessions: the first batch of edits went into one that
      // got immediately overwritten by the second, the second got published —
      // and part of the edits vanished.
      if (opening) return opening;
      const { unitId, range, currentUserId, session } = get();
      if (!unitId || !range || !currentUserId || session) return;

      opening = (async () => {
        try {
          const bundle = await scheduleRepository.openDraft(unitId, range, currentUserId);
          const overlapping = await scheduleRepository.listOverlappingDrafts(
            unitId,
            range,
            currentUserId,
          );
          set({
            session: bundle.session,
            changes: [...bundle.changes],
            overlappingDrafts: overlapping,
          });
        } finally {
          opening = undefined;
        }
      })();
      return opening;
    },

    setCell(personId, date, shiftId) {
      commitCells([{ personId, date }], shiftId === null ? null : { kind: 'SHIFT', shiftId });
    },

    setCells(cells, shiftId) {
      commitCells(cells, shiftId === null ? null : { kind: 'SHIFT', shiftId });
    },

    setMarker(cells, marker) {
      commitCells(cells, { kind: 'MARKER', marker });
    },

    setAbsence(absence, previous) {
      commit([absenceChange(previous ?? null, absence, nextSeq(), new Date().toISOString())]);
    },

    setAbsences(absences) {
      const now = new Date().toISOString();
      commit(absences.map((absence) => absenceChange(null, absence, nextSeq(), now)));
    },

    setCompDay(entry, previous) {
      commit([compDayChange(previous ?? null, entry, nextSeq(), new Date().toISOString())]);
    },

    async savePerson(person) {
      const saved = await scheduleRepository.savePerson(person);
      const state = get();
      if (!state.reference || !state.plan) return;

      const reference: ReferenceData = {
        ...state.reference,
        people: state.reference.people.map((p) => (p.id === saved.id ? saved : p)),
      };
      // NOTE: The index is rebuilt: the validator and role-picker read
      // eligibility and target shares, and they need to see the edit right away.
      set({ reference, index: buildIndex(datasetOf(reference, state.plan)) });
    },

    async commitAutoPopulate(result) {
      if (result.changes.length === 0) return;
      if (!get().session) await get().startDraft();

      const now = new Date().toISOString();
      // NOTE: The seq is recomputed from scratch: the preview was computed as
      // a pure function with its own local counter, while the store sets the
      // order within the draft itself — otherwise the next mouse edit would
      // get an earlier seq than changes generated before it, and undo would
      // run in the wrong order.
      const changes = result.changes.map((change) =>
        change.targetType === 'ASSIGNMENT'
          ? assignmentChange(null, change.after as Assignment, nextSeq(), now)
          : compDayChange(null, change.after as CompDayEntry, nextSeq(), now),
      );
      commit(changes);
    },

    async commitAbsenceImport(changes) {
      if (changes.length === 0) return;
      if (!get().session) await get().startDraft();

      const now = new Date().toISOString();
      // NOTE: Same trick as commitAutoPopulate: the foreign seq from the
      // preview is discarded, the store renumbers with its own counter.
      const resequenced = changes.map((change) =>
        change.targetType === 'ABSENCE'
          ? absenceChange(change.before, change.after, nextSeq(), now)
          : change,
      );
      // NOTE: One commit call is one batch in undoStack: the planner rolls
      // back the whole import with a single Undo, not record by record.
      commit(resequenced);
    },

    async acknowledge(issueKey, comment) {
      const { currentUserId, plan, reference, published } = get();
      if (!plan || !reference || !published) return;
      // NOTE: Acknowledgements don't go through the draft: they're an
      // assessment of the plan, not the plan itself — but, like edits, they
      // must survive a reload, so they go straight to the repository (ADR-0012).
      const ack: Acknowledgement = {
        issueKey,
        comment,
        byPersonId: currentUserId ?? 'unknown',
        at: new Date().toISOString(),
      };
      await scheduleRepository.saveAcknowledgement(ack);

      const acknowledgements = [
        ...plan.acknowledgements.filter((a) => a.issueKey !== issueKey),
        ack,
      ];
      const nextPlan = { ...plan, acknowledgements };
      set({
        plan: nextPlan,
        published: { ...published, acknowledgements },
        index: buildIndex(datasetOf(reference, nextPlan)),
      });
    },

    undo() {
      const state = get();
      const batch = state.undoStack.at(-1);
      if (!batch || !state.reference || !state.published) return;

      const drop = new Set(batch.map((change) => change.id));
      const changes = state.changes.filter((change) => !drop.has(change.id));
      const { plan, index } = recompute(state.reference, state.published, changes);

      set({
        changes,
        plan,
        index,
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, batch],
      });

      // NOTE: Undo is also just a new cell state, not a separate "delete this
      // change from the server" operation: we mark the same keys, and the
      // next flush sends whatever the cells became. Whether the undone
      // change had reached the server doesn't need to be known — that
      // distinction used to be a source of desync.
      const sessionId = state.session?.id;
      if (sessionId) queueForSync(sessionId, batch);
    },

    redo() {
      const state = get();
      const batch = state.redoStack.at(-1);
      if (!batch) return;
      set({ redoStack: state.redoStack.slice(0, -1) });
      commit(batch, { fromHistory: true });
      set({ undoStack: [...get().undoStack, batch] });
    },

    async flushNow() {
      const sessionId = get().session?.id;
      if (!sessionId) return;
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = undefined;
      }
      // NOTE: Wait for whatever's already in flight first, then send the
      // rest: keys could have been added in between, and the order here is deliberate.
      await inFlight;
      if (dirtyKeys.size > 0) {
        consecutiveFailures = 0; // NOTE: An explicit user action — a fresh attempt.
        await runFlush(sessionId);
      }
    },

    async publish() {
      const { session, unitId, range } = get();
      if (!session || !unitId || !range) return undefined;

      // NOTE: What gets published is what's on the server, not what's painted
      // on the grid. Without this, clicking Publish within the debounce
      // window would publish a draft missing the latest edits — exactly the
      // "part of the cells were saved" case.
      await get().flushNow();
      const syncError = get().syncError;
      if (syncError) {
        set({ error: `Some edits could not be saved (${syncError}) — publish cancelled.` });
        return undefined;
      }

      set({ publishing: true, conflicts: [] });
      try {
        const outcome = await scheduleRepository.publishDraft(session.id);
        if (!outcome.ok) {
          // NOTE: The draft is kept in full: a failed publish loses nothing.
          set({ publishing: false, conflicts: outcome.conflicts });
          return outcome;
        }
        // Publish changed the published plan server-side — every cached
        // schedule query (any draftId, this unit/range or overlapping ones)
        // is stale now, not just this session's overlay.
        await queryClient.invalidateQueries({ queryKey: ['schedule'] });
        const scheduleResponse = await queryClient.fetchQuery(
          scheduleQueryOptions(unitId, range, undefined),
        );
        const published: PlanData = { ...scheduleResponse.plan, acknowledgements: [] };
        const { reference } = get();
        if (!reference) return outcome;
        const { plan, index } = recompute(reference, published, []);
        set({
          publishing: false,
          published,
          plan,
          index,
          session: undefined,
          changes: [],
          undoStack: [],
          redoStack: [],
          lastPublish: outcome.result,
        });
        return outcome;
      } catch (error) {
        set({
          publishing: false,
          error: error instanceof Error ? error.message : String(error),
        });
        return undefined;
      }
    },

    async discard() {
      const state = get();
      // NOTE: Clear the queue before the request: otherwise a delayed flush
      // would wake up after discard and try to write to a closed session.
      cancelSync();
      if (state.session) await scheduleRepository.discardDraft(state.session.id);
      if (!state.reference || !state.published) return;
      const { plan, index } = recompute(state.reference, state.published, []);
      set({
        session: undefined,
        changes: [],
        undoStack: [],
        redoStack: [],
        conflicts: [],
        pendingSync: false,
        syncError: undefined,
        plan,
        index,
      });
    },
  };
});

/** NOTE: Whether there are unsaved edits. */
export function hasDraftChanges(state: ScheduleState): boolean {
  return state.changes.length > 0;
}

/** NOTE: Whether editing is in progress. */
export function isEditing(state: ScheduleState): boolean {
  return state.session !== undefined;
}
