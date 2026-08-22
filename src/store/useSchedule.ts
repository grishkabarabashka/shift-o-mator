/**
 * Состояние экрана планирования.
 *
 * Опубликованные данные и черновик разделены (ADR-0015): `published` — то, что
 * видят все, `draft` — упорядоченные изменения текущего редактора. Сетка
 * показывает `published + draft`, но публикуется только явным действием.
 *
 * Undo/redo получается из того, что каждое изменение несёт `before` и `after`.
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
import type { PublishOutcome } from '../data/repository.ts';
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
  RoleId,
  ScheduleDataset,
  UnitId,
} from '../domain/types.ts';
import { ALL_UNITS } from '../domain/types.ts';
import { isWeekendIn } from '../engine/dates.ts';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Ячейка сетки: пара (человек, дата). */
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
  /** Опубликованные данные — то, что видят все. */
  published: PlanData | undefined;
  /** Опубликованные плюс применённый черновик — то, что рисует сетка. */
  plan: PlanData | undefined;
  index: DatasetIndex | undefined;

  session: DraftSession | undefined;
  changes: DraftChange[];
  /** Изменения, отменённые undo и доступные для redo. */
  redoStack: DraftChange[][];
  /** Батчи для undo: одно действие пользователя — один батч. */
  undoStack: DraftChange[][];
  /** Чужие открытые черновики на тот же период — информационный баннер. */
  overlappingDrafts: readonly DraftSession[];

  publishing: boolean;
  lastPublish: PublishResult | undefined;
  conflicts: readonly PublishConflict[];

  /**
   * Draft-change POSTs are debounced and coverage/issues revalidate only
   * after the batch settles (Phase 5 step 5) — `pendingSync` is true between
   * a cell edit and that flush landing, for a "saving…" indicator that
   * doesn't require touching the (memoized, perf-sensitive — CLAUDE.md)
   * grid cells themselves.
   */
  pendingSync: boolean;

  load: (unitId: UnitId, range: DateRange) => Promise<void>;
  startDraft: () => Promise<void>;
  setCell: (personId: PersonId, date: IsoDate, roleId: RoleId | null) => void;
  setCells: (cells: readonly CellRef[], roleId: RoleId | null) => void;
  setMarker: (cells: readonly CellRef[], marker: 'OFF' | 'NOT_SCHEDULED') => void;
  setAbsence: (absence: Absence | null, previous?: Absence) => void;
  setAbsences: (absences: readonly Absence[]) => void;
  setCompDay: (entry: CompDayEntry, previous?: CompDayEntry) => void;
  acknowledge: (issueKey: string, comment: string) => Promise<void>;
  /** Профиль человека — справочные данные, идут мимо черновика. */
  savePerson: (person: Person) => Promise<void>;
  /** Ставит результат превью auto-populate в черновик, открывая его при нужде. */
  commitAutoPopulate: (result: AutoPopulateResult) => Promise<void>;
  /** Ставит импорт отсутствий в черновик одним батчем — Undo откатывает его целиком. */
  commitAbsenceImport: (changes: readonly DraftChange[]) => Promise<void>;
  undo: () => void;
  redo: () => void;
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

/** TanStack Query rejects an in-flight query's promise with this shape when
 * it's cancelled (queryClient.clear()/removeQueries, a superseding fetch) —
 * not a failure, just a query that stopped mattering. */
function isCancellationError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'revert' in error && 'silent' in error;
}

export const useSchedule = create<ScheduleState>((set, get) => {
  // Batches edits into one flush instead of one POST per keystroke/paint —
  // module-scoped (not component state) because edits happen from several
  // call sites (setCell, setCells, commitAutoPopulate, absence import…) that
  // all route through `commit()` below.
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingChanges: DraftChange[] = [];
  let pendingRange: DateRange | undefined;

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

  function flush(sessionId: string): void {
    flushTimer = undefined;
    const batch = pendingChanges;
    const touched = pendingRange;
    pendingChanges = [];
    pendingRange = undefined;
    if (batch.length === 0) {
      set({ pendingSync: false });
      return;
    }
    void (async () => {
      try {
        await scheduleRepository.appendChanges(sessionId, batch);
        if (touched) await revalidateTouched(touched);
      } catch (error) {
        // Fire-and-forget by design (this runs off a debounce timer, not a
        // caller awaiting it) — nothing to propagate to. A query cancelled
        // out from under this flush (period changed, cache torn down mid-
        // flight in a test) is expected; anything else is at least logged
        // instead of becoming a silent unhandled rejection.
        if (!isCancellationError(error)) console.error('Draft sync failed', error);
      } finally {
        // Only clear the indicator if nothing new queued up while this flush
        // was in flight.
        if (pendingChanges.length === 0) set({ pendingSync: false });
      }
    })();
  }

  function queueForSync(sessionId: string, changes: readonly DraftChange[]): void {
    pendingChanges = [...pendingChanges, ...changes];
    const span = dateRangeOfChanges(changes);
    if (span) {
      pendingRange = pendingRange
        ? { from: span.from < pendingRange.from ? span.from : pendingRange.from, to: span.to > pendingRange.to ? span.to : pendingRange.to }
        : span;
    }
    set({ pendingSync: true });
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => flush(sessionId), SYNC_DEBOUNCE_MS);
  }
  /** Пересобирает `plan` и индекс из опубликованного плюс черновик. */
  function recompute(
    reference: ReferenceData,
    published: PlanData,
    changes: readonly DraftChange[],
  ): { plan: PlanData; index: DatasetIndex } {
    const plan = applyChanges(published, changes);
    return { plan, index: buildIndex(datasetOf(reference, plan)) };
  }

  /**
   * Применяет батч изменений: обновляет черновик, стеки и производные данные.
   * Пустые батчи игнорируются, иначе Ctrl+Z станет непредсказуемым.
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

  /** Строит изменения ячеек, отбрасывая невозможные. */
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

      if (content.kind === 'ROLE') {
        // Роль всегда берётся из региона человека: чужая не попадёт.
        const role = index.roles.get(content.roleId);
        if (!role || role.regionId !== person.regionId) continue;
        if (before?.content.kind === 'ROLE' && before.content.roleId === content.roleId) continue;
      } else if (before?.content.kind === 'MARKER' && before.content.marker === content.marker) {
        continue;
      }

      const after: Assignment = {
        id: before?.id ?? newAssignmentId(),
        personId: cell.personId,
        date: cell.date,
        regionId: person.regionId,
        content,
        // Выходной по календарю локации человека, а не роли (ADR-0002) — та же
        // проверка, что использует автогенерация для сгенерированных ячеек.
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

    async load(unitId, range) {
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
        const published: PlanData = { ...scheduleResponse.plan, acknowledgements: [] };

        // Пока нет аутентификации: первый включённый человек единицы. При
        // `ALL` единицы нет — берём любого менеджера.
        const inScope = (p: (typeof reference.people)[number]): boolean =>
          unitId === ALL_UNITS || p.unitId === unitId;
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
        });
      } catch (error) {
        set({ status: 'error', error: error instanceof Error ? error.message : String(error) });
      }
    },

    async startDraft() {
      const { unitId, range, currentUserId, session } = get();
      if (!unitId || !range || !currentUserId || session) return;
      const bundle = await scheduleRepository.openDraft(unitId, range, currentUserId);
      const overlapping = await scheduleRepository.listOverlappingDrafts(
        unitId,
        range,
        currentUserId,
      );
      set({ session: bundle.session, changes: [...bundle.changes], overlappingDrafts: overlapping });
    },

    setCell(personId, date, roleId) {
      commitCells([{ personId, date }], roleId === null ? null : { kind: 'ROLE', roleId });
    },

    setCells(cells, roleId) {
      commitCells(cells, roleId === null ? null : { kind: 'ROLE', roleId });
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
      // Индекс пересобирается: eligibility и целевые доли читают валидатор и
      // подбор ролей, и они должны увидеть правку сразу.
      set({ reference, index: buildIndex(datasetOf(reference, state.plan)) });
    },

    async commitAutoPopulate(result) {
      if (result.changes.length === 0) return;
      if (!get().session) await get().startDraft();

      const now = new Date().toISOString();
      // Пересчитываем seq заново: превью считалось чистой функцией со своим
      // локальным счётчиком, а порядок в самом черновике задаёт store —
      // иначе следующая правка мышью получила бы более ранний seq, чем
      // сгенерированные до неё изменения, и undo пошёл бы не в том порядке.
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
      // Тот же приём, что у commitAutoPopulate: чужой seq из превью
      // отбрасывается, стор нумерует заново своим счётчиком.
      const resequenced = changes.map((change) =>
        change.targetType === 'ABSENCE'
          ? absenceChange(change.before, change.after, nextSeq(), now)
          : change,
      );
      // Один вызов commit — один батч в undoStack: планировщик откатывает
      // весь импорт одним Undo, не по записи.
      commit(resequenced);
    },

    async acknowledge(issueKey, comment) {
      const { currentUserId, plan, reference, published } = get();
      if (!plan || !reference || !published) return;
      // Подтверждения не проходят через черновик: они относятся к оценке
      // плана, а не к самому плану — но, как и правки, обязаны пережить
      // перезагрузку, поэтому идут в репозиторий напрямую (ADR-0012).
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

      const sessionId = state.session?.id;
      if (sessionId) {
        // A change undone before its debounced flush landed never reached the
        // server — drop it from the queue instead of asking the server to
        // remove something it never received.
        const stillPending = new Set(pendingChanges.filter((c) => drop.has(c.id)).map((c) => c.id));
        pendingChanges = pendingChanges.filter((c) => !drop.has(c.id));
        const alreadyFlushed = [...drop].filter((id) => !stillPending.has(id));
        if (alreadyFlushed.length > 0) void scheduleRepository.removeChanges(sessionId, alreadyFlushed);

        const touched = dateRangeOfChanges(batch);
        if (touched) {
          void revalidateTouched(touched).catch((error: unknown) => {
            if (!isCancellationError(error)) console.error('Undo revalidation failed', error);
          });
        }
      }
    },

    redo() {
      const state = get();
      const batch = state.redoStack.at(-1);
      if (!batch) return;
      set({ redoStack: state.redoStack.slice(0, -1) });
      commit(batch, { fromHistory: true });
      set({ undoStack: [...get().undoStack, batch] });
    },

    async publish() {
      const { session, unitId, range } = get();
      if (!session || !unitId || !range) return undefined;
      set({ publishing: true, conflicts: [] });
      try {
        const outcome = await scheduleRepository.publishDraft(session.id);
        if (!outcome.ok) {
          // Черновик сохраняется целиком: провал публикации ничего не теряет.
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
      if (state.session) await scheduleRepository.discardDraft(state.session.id);
      if (!state.reference || !state.published) return;
      const { plan, index } = recompute(state.reference, state.published, []);
      set({
        session: undefined,
        changes: [],
        undoStack: [],
        redoStack: [],
        conflicts: [],
        plan,
        index,
      });
    },
  };
});

/** Есть ли несохранённые правки. */
export function hasDraftChanges(state: ScheduleState): boolean {
  return state.changes.length > 0;
}

/** Идёт ли редактирование. */
export function isEditing(state: ScheduleState): boolean {
  return state.session !== undefined;
}
