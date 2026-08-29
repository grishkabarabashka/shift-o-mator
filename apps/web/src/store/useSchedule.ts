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
import type {
  AbsenceUpsert,
  DraftSyncItem,
  PresenceUpsert,
  PublishOutcome,
} from '../data/repository.ts';
import {
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
  PresenceRecord,
  PersonId,
  PlanData,
  PublishConflict,
  ReferenceData,
  ScheduleDataset,
  ShiftId,
  UnitId,
} from '../domain/types.ts';
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

  /**
   * NOTE: Why the last explicit action (publish, discard) failed.
   *
   * WHY separate from `error`: `error` puts the app into `status: 'error'`, which
   * replaces the whole screen with "Could not load the schedule". A publish that
   * failed must not do that — the draft is intact and the planner needs to see it to
   * decide what to do. This used to be written into `error` and rendered nowhere at
   * all, so clicking Publish with an unsynced edit did visibly nothing.
   */
  actionError: string | undefined;

  /** NOTE: Clears `actionError` — the banner is dismissible, the failure is not fatal. */
  dismissActionError: () => void;
  /** NOTE: Reports a failure the user has to see. A control that silently does nothing
   * is the failure mode ADR-0023 exists to prevent. */
  setActionError: (message: string) => void;

  /**
   * NOTE: Publishes the signed-in identity into the store (ADR-0039).
   *
   * WHY an action rather than something `load()` derives: `load()` used to guess —
   * "the first MANAGEMENT person in scope, else anyone" — and that guess became the
   * `createdBy`/`updatedBy` on every edit and the author of every acknowledgement.
   * The server now decides who the actor is; this only mirrors that answer so the
   * optimistic UI shows the same name the audit trail will.
   */
  setCurrentUser: (personId: PersonId | undefined) => void;
  load: (unitId: UnitId, range: DateRange) => Promise<void>;
  startDraft: () => Promise<void>;
  setCell: (personId: PersonId, date: IsoDate, shiftId: ShiftId | null) => void;
  setCells: (cells: readonly CellRef[], shiftId: ShiftId | null) => void;
  setCompDay: (entry: CompDayEntry, previous?: CompDayEntry) => Promise<void>;
  /**
   * NOTE: Time off (ADR-0052). Like presence, this goes around the draft entirely:
   * drafts publish the rota, and time off is asked for and granted separately. A kind of
   * absence that needs approval is refused here by the server — it goes through a request.
   */
  saveAbsence: (record: AbsenceUpsert) => Promise<void>;
  removeAbsence: (id: string) => Promise<void>;
  acknowledge: (issueKey: string, comment: string) => Promise<void>;
  /** NOTE: A person's profile — reference data, goes around the draft. */
  savePerson: (person: Person) => Promise<void>;
  /**
   * NOTE: Where someone works (ADR-0043). Like `savePerson`, this goes around the draft
   * — presence is not a roster decision and must not wait on a planner's publish.
   */
  savePresence: (record: PresenceUpsert) => Promise<void>;
  removePresence: (id: string) => Promise<void>;
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

/**
 * NOTE: Rebuilds `plan` and the index from published plus the draft.
 *
 * At module scope rather than inside the store, because the query-cache subscription at
 * the bottom of this file needs the same arithmetic and must not have a second copy of it.
 */
function recomputeFor(
  reference: ReferenceData,
  published: PlanData,
  changes: readonly DraftChange[],
): { plan: PlanData; index: DatasetIndex } {
  const plan = applyChanges(published, changes);
  return { plan, index: buildIndex(datasetOf(reference, plan)) };
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
  const recompute = recomputeFor;

  /**
   * NOTE: The caller's open draft over this scope, with its staged changes — or nothing.
   *
   * Failures are swallowed on purpose. This is a convenience on top of a load that has
   * already succeeded; a viewer with no planning rights gets an empty answer, and a
   * network hiccup here must not turn a working screen into the error page.
   */
  async function resumeDraftFor(
    unitId: UnitId,
    range: DateRange,
  ): Promise<{ session: DraftSession; changes: DraftChange[]; overlapping: readonly DraftSession[] } | undefined> {
    try {
      const mine = await scheduleRepository.listMyOpenDrafts(unitId, range);
      const session = mine[0];
      if (!session) return undefined;

      const [changes, overlapping] = await Promise.all([
        scheduleRepository.draftChanges(session.id),
        scheduleRepository.listOverlappingDrafts(unitId, range, session.editorPersonId),
      ]);
      return { session, changes: [...changes], overlapping };
    } catch {
      return undefined;
    }
  }

  /**
   * NOTE: Writes a new presence list into both `published` and `plan`.
   *
   * WHY both: presence never passes through a draft (ADR-0043), so there is no change
   * list to replay it from — `plan` is not derivable from `published` for this one
   * field. Recomputing the index keeps the two consistent for everything else.
   */
  /**
   * NOTE: My calendar reads its own long window through its own query, so a direct write
   * here has to tell it. The grid gets the row through this store; the calendar does not,
   * and without this a day recorded from the calendar sat there unchanged until a reload —
   * the same shape of defect as an approval never reaching the grid.
   */
  function invalidatePersonalCalendar(): void {
    void queryClient.invalidateQueries({ queryKey: ['my-calendar'] });
  }

  function applyPresence(presence: readonly PresenceRecord[]): void {
    invalidatePersonalCalendar();
    const { reference, published, changes } = get();
    if (!reference || !published) return;
    const nextPublished: PlanData = { ...published, presence };
    const { plan, index } = recompute(reference, nextPublished, changes);
    set({ published: nextPublished, plan, index });
  }

  /** The same, for absences, which are direct writes now (ADR-0052). Any open draft is
   * left alone: the two flows do not meet. */
  function applyAbsences(absences: readonly Absence[]): void {
    invalidatePersonalCalendar();
    const { reference, published, changes } = get();
    if (!reference || !published) return;
    const nextPublished: PlanData = { ...published, absences };
    const { plan, index } = recompute(reference, nextPublished, changes);
    set({ published: nextPublished, plan, index });
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

      // NOTE: A shift is always taken from the person's own unit — one from elsewhere never matches.
      const shift = index.shifts.get(content.shiftId);
      if (!shift || shift.unitId !== person.unitId) continue;
      if (before?.content.shiftId === content.shiftId) continue;

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
    actionError: undefined,
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
      conflicts: [],
    pendingSync: false,
    syncError: undefined,

    setActionError(message) {
      set({ actionError: message });
    },

    dismissActionError() {
      set({ actionError: undefined });
    },

    setCurrentUser(personId) {
      if (get().currentUserId === personId) return;
      set({ currentUserId: personId });
    },

    async load(unitId, range) {
      // WHY flush before anything else: switching unit or period drops the local view of
      // the draft (below). Any edit still sitting in the debounce queue would be dropped
      // with it — painted on the grid a second ago, never sent, and gone. The session
      // itself survives on the server and reopens on the next edit; the unsent edits
      // would not have.
      if (get().session && dirtyKeys.size > 0) {
        try {
          await get().flushNow();
        } catch {
          // A failed flush already surfaced through `syncError`; loading the new period
          // must not be blocked by it.
        }
      }

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

        // WHY the draft is resumed rather than dropped: changing the unit or the period
        // used to blank `session` and `changes`, so a planner who had generated a period
        // and then switched to the combined view watched their staged cells disappear and
        // the Publish button with them — while the draft sat on the server, visible to
        // everybody else as hatched cells. Nothing had been lost; the screen had simply
        // stopped looking.
        //
        // It **resumes**, never opens: looking at a unit must not mint an empty session
        // in it. Newest first, and only one — the schedule overlay takes a single draft
        // id, so two of your own open drafts inside one view show the more recent.
        const resumed = await resumeDraftFor(unitId, range);
        if (seq !== loadSeq) return;

        const { plan, index } = recompute(reference, published, resumed?.changes ?? []);
        set({
          status: 'ready',
          unitId,
          range,
          reference,
          published,
          plan,
          index,
          // NOTE: deliberately not reset — identity is owned by `setCurrentUser`
          // (ADR-0039) and survives changing unit or period.
          session: resumed?.session,
          changes: resumed?.changes ?? [],
          undoStack: [],
          redoStack: [],
          overlappingDrafts: resumed?.overlapping ?? [],
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
      // NOTE: no longer gated on knowing who we are. The server takes the editor from the
      // authenticated principal (ADR-0039), so waiting for the client's copy of that
      // answer would only mean an edit silently doing nothing while `/api/auth/me` is
      // still in flight.
      if (!unitId || !range || session) return;

      opening = (async () => {
        try {
          const bundle = await scheduleRepository.openDraft(unitId, range, currentUserId ?? '');
          // The server's answer for "who owns this draft" beats the client's guess: it is
          // the id that will appear in the audit trail.
          const editorId = bundle.session.editorPersonId || (currentUserId ?? '');
          const overlapping = await scheduleRepository.listOverlappingDrafts(
            unitId,
            range,
            editorId,
          );
          set({
            session: bundle.session,
            changes: [...bundle.changes],
            overlappingDrafts: overlapping,
          });
        } catch (error) {
          // WHY: this used to propagate as an unhandled rejection, so a caller without
          // the Planner role clicked a cell and nothing happened at all — no draft, no
          // edit, no message.
          set({
            actionError:
              error instanceof Error && 'status' in error && (error as { status?: number }).status === 403
                ? 'You do not have permission to edit the plan. Ask a planner, or raise a request for your own days.'
                : `Could not open a draft: ${error instanceof Error ? error.message : String(error)}`,
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

    async setCompDay(entry, previous) {
      if (!get().session) await get().startDraft();
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

    /**
     * NOTE: Applies an import as direct writes (ADR-0052).
     *
     * It used to be staged as one draft batch so a single Undo rolled the whole import
     * back. Absences no longer go through the draft at all, so there is no batch to undo:
     * each row is written as it is applied, and a failure part-way through leaves the ones
     * already written alone. The preview screen is what makes that acceptable — nothing is
     * written until the planner has seen the diff and pressed the button.
     */
    async commitAbsenceImport(changes) {
      if (changes.length === 0) return;

      for (const change of changes) {
        if (change.targetType !== 'ABSENCE') continue;
        const { before, after } = change;

        if (after) {
          await get().saveAbsence({
            ...(before ? { id: before.id, version: before.version } : {}),
            personId: after.personId,
            eventTypeId: after.eventTypeId,
            from: after.from,
            to: after.to,
            portion: after.portion,
            ...(after.note ? { note: after.note } : {}),
          });
        } else if (before) {
          await get().removeAbsence(before.id);
        }
      }
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

    async saveAbsence(record) {
      const { published } = get();
      if (!published) return;
      try {
        const saved = await scheduleRepository.saveAbsence(record);
        const next = published.absences.some((a) => a.id === saved.id)
          ? published.absences.map((a) => (a.id === saved.id ? saved : a))
          : [...published.absences, saved];
        applyAbsences(next);
      } catch (error) {
        set({
          actionError: `Could not save the absence: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    },

    async removeAbsence(id) {
      const { published } = get();
      if (!published) return;
      try {
        await scheduleRepository.deleteAbsence(id);
        applyAbsences(published.absences.filter((a) => a.id !== id));
      } catch (error) {
        set({
          actionError: `Could not remove the absence: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    },

    async savePresence(record) {
      const { plan, published, reference } = get();
      if (!plan || !published || !reference) return;
      try {
        const saved = await scheduleRepository.savePresence(record);
        // Replace in place when it already existed; append otherwise. The server is the
        // source of truth for the version, so the echoed record is what goes in.
        const next = published.presence.some((p) => p.id === saved.id)
          ? published.presence.map((p) => (p.id === saved.id ? saved : p))
          : [...published.presence, saved];
        applyPresence(next);
      } catch (error) {
        set({
          actionError: `Could not save presence: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    },

    async removePresence(id) {
      const { published } = get();
      if (!published) return;
      try {
        await scheduleRepository.deletePresence(id);
        applyPresence(published.presence.filter((p) => p.id !== id));
      } catch (error) {
        set({
          actionError: `Could not remove presence: ${error instanceof Error ? error.message : String(error)}`,
        });
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
        set({
          actionError: `Some edits could not be saved (${syncError}) — publish cancelled. Retry once the connection recovers; nothing was lost.`,
        });
        return undefined;
      }

      set({ publishing: true, conflicts: [], actionError: undefined });
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
        });
        return outcome;
      } catch (error) {
        set({
          publishing: false,
          actionError: `Publishing failed: ${error instanceof Error ? error.message : String(error)}. Your draft is intact.`,
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

/**
 * The store follows the schedule query instead of snapshotting it once.
 *
 * WHY this exists at all: absences, comp days and presence reach the grid through
 * `plan` here, and `load()` was the only thing that ever filled it. Anything the
 * **server** wrote on our behalf therefore had no way in — and every approval is exactly
 * that. Approving leave from the cell menu removed the dashed pending band, which is
 * query-backed, and never drew the granted day, which is not: the cell went empty and
 * stayed empty until the tab was reloaded.
 *
 * Invalidating `['schedule']` is now enough, from anywhere, for the grid to catch up —
 * which is the property that was missing, not a faster path for one caller.
 *
 * Only a **fetch that succeeded** for the view currently on screen is taken. The delta
 * path writes the visible key with `setQueryData` (a different event) after fetching a
 * narrower range under a different key, so neither half of it can loop back through here.
 */
queryClient.getQueryCache().subscribe((event) => {
  if (event.type !== 'updated' || event.action.type !== 'success') return;

  const state = useSchedule.getState();
  const { unitId, range, reference, published, changes, session } = state;
  if (!unitId || !range || !reference || !published) return;

  const expected: readonly unknown[] = scheduleQueryKey(unitId, range, session?.id);
  const key: readonly unknown[] = event.query.queryKey;
  if (key.length !== expected.length) return;
  if (key.some((part: unknown, i: number) => part !== expected[i])) return;

  const next = event.query.state.data as ScheduleResponse | undefined;
  if (!next) return;

  const nextPublished: PlanData = { ...next.plan, acknowledgements: published.acknowledgements };
  useSchedule.setState({ published: nextPublished, ...recomputeFor(reference, nextPublished, changes) });
});

/** NOTE: Whether there are unsaved edits. */
export function hasDraftChanges(state: ScheduleState): boolean {
  return state.changes.length > 0;
}

/** NOTE: Whether editing is in progress. */
export function isEditing(state: ScheduleState): boolean {
  return state.session !== undefined;
}
