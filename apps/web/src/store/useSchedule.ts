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
   * Draft-change sync is debounced and coverage/issues revalidate only
   * after the batch settles (Phase 5 step 5) — `pendingSync` is true between
   * a cell edit and that flush landing, for a "saving…" indicator that
   * doesn't require touching the (memoized, perf-sensitive — CLAUDE.md)
   * grid cells themselves.
   */
  pendingSync: boolean;

  /**
   * Почему правки не доехали до черновика, если не доехали.
   *
   * Раньше сбой синхронизации уходил в `console.error` и больше нигде не
   * проявлялся: сетка показывала правку как сделанную, сервер о ней не знал,
   * и расходились они молча — до публикации, которая сохраняла половину.
   * Теперь это видимое состояние, и публикация при нём не идёт.
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
  /** Профиль человека — справочные данные, идут мимо черновика. */
  savePerson: (person: Person) => Promise<void>;
  /** Ставит результат превью auto-populate в черновик, открывая его при нужде. */
  commitAutoPopulate: (result: AutoPopulateResult) => Promise<void>;
  /** Ставит импорт отсутствий в черновик одним батчем — Undo откатывает его целиком. */
  commitAbsenceImport: (changes: readonly DraftChange[]) => Promise<void>;
  undo: () => void;
  redo: () => void;
  /** Досылает всё, что ещё ждёт дебаунса, и дожидается уже летящего запроса. */
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
 * Ключ синхронизации: о чём изменение, а не какое оно.
 *
 * Для назначения это ячейка (в ней не бывает двух назначений), для отсутствия
 * и отгула — id записи. Двадцать правок одной ячейки — двадцать версий одного
 * решения; на сервер уходит последняя, а не лента операций поверх состояния,
 * которого там нет.
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
 * Снимает с плана желаемое состояние по каждому ключу.
 *
 * Индексы строятся один раз на батч, а не поиск на ключ: покраска диапазона
 * даёт сотню ключей на плане в пару тысяч назначений (CLAUDE.md: сетка —
 * место, чувствительное к производительности).
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
/** Пауза перед повтором после сбоя — дольше дебаунса: это уже не батчинг. */
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
  // Очередь хранит **ключи**, а не изменения: что бы ни случилось с ячейкой
  // после правки — вторая покраска, undo, откат всего батча, — на сервер
  // уходит её состояние на момент отправки. Поэтому повтор после сбоя
  // безопасен и не требует помнить, что именно не долетело.
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

  /** In-flight `startDraft`, чтобы параллельные правки не открыли две сессии. */
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
   * Отправляет текущее состояние всех «грязных» ключей одним запросом.
   *
   * Провал возвращает ключи в очередь, а не теряет их: состояние
   * пересчитывается из плана заново, так что повтор ничего не задваивает.
   * После `SYNC_MAX_RETRIES` подряд повторы прекращаются — дальше это уже не
   * сетевая икота, а отказ, который планировщик должен увидеть; `syncError`
   * остаётся и держит публикацию.
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

  /** Fire-and-forget обёртка: держит ссылку, чтобы `flushNow` мог дождаться. */
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

  /** Снимает всё запланированное — черновик закрыт или период сменился. */
  function cancelSync(): void {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = undefined;
    dirtyKeys = new Set();
    pendingRange = undefined;
    consecutiveFailures = 0;
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

      if (content.kind === 'SHIFT') {
        // Смена всегда берётся из единицы человека: чужая не попадёт.
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

        // Пока нет аутентификации: первый включённый человек единицы. При
        // `ALL` единицы нет — берём любого менеджера.
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
      // Любая правка открывает черновик сама (ADR-0023), и две быстрые правки
      // подряд обе видят `session === undefined`. Без этой блокировки они
      // открывали две сессии: первая партия правок уезжала в ту, что тут же
      // затиралась второй, публиковалась вторая — и часть правок пропадала.
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

      // Undo — это тоже просто новое состояние ячеек, а не отдельная операция
      // «удалить изменение с сервера»: помечаем те же ключи, и ближайший флаш
      // отправит то, чем ячейки стали. Дошло ли отменяемое изменение до
      // сервера, знать не нужно — раньше эта развилка была источником
      // рассинхрона.
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
      // Сначала дождаться уже летящего запроса, потом отправить остаток: между
      // ними могли добавиться ключи, и порядок здесь именно такой.
      await inFlight;
      if (dirtyKeys.size > 0) {
        consecutiveFailures = 0; // явное действие пользователя — попытка с чистого листа
        await runFlush(sessionId);
      }
    },

    async publish() {
      const { session, unitId, range } = get();
      if (!session || !unitId || !range) return undefined;

      // Публикуется то, что лежит на сервере, а не то, что нарисовано в сетке.
      // Без этого клик по Publish в пределах дебаунса публиковал черновик без
      // последних правок — ровно тот случай, когда «сохранилась часть ячеек».
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
      // Снять очередь до запроса: иначе отложенный флаш проснётся уже после
      // discard и попробует писать в закрытую сессию.
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

/** Есть ли несохранённые правки. */
export function hasDraftChanges(state: ScheduleState): boolean {
  return state.changes.length > 0;
}

/** Идёт ли редактирование. */
export function isEditing(state: ScheduleState): boolean {
  return state.session !== undefined;
}
