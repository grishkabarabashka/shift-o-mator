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
import { scheduleRepository } from '../data/memoryRepository.ts';
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
  Assignment,
  CompDayEntry,
  DateRange,
  DraftChange,
  DraftSession,
  IsoDate,
  PersonId,
  PlanData,
  PublishConflict,
  PublishResult,
  ReferenceData,
  RoleId,
  ScheduleDataset,
  UnitId,
} from '../domain/types.ts';
import { proposeCompDays } from '../engine/compDays.ts';

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

  load: (unitId: UnitId, range: DateRange) => Promise<void>;
  startDraft: () => Promise<void>;
  setCell: (personId: PersonId, date: IsoDate, roleId: RoleId | null) => void;
  setCells: (cells: readonly CellRef[], roleId: RoleId | null) => void;
  setMarker: (cells: readonly CellRef[], marker: 'OFF' | 'NOT_SCHEDULED') => void;
  setAbsence: (absence: Absence | null, previous?: Absence) => void;
  setAbsences: (absences: readonly Absence[]) => void;
  setCompDay: (entry: CompDayEntry, previous?: CompDayEntry) => void;
  acknowledge: (issueKey: string, comment: string) => void;
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

export const useSchedule = create<ScheduleState>((set, get) => {
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
    if (sessionId) void scheduleRepository.appendChanges(sessionId, meaningful);
  }

  /**
   * Начисления comp days пересчитываются сразу после правки: планировщик
   * должен видеть последствие назначения в тот же момент, а не через неделю.
   */
  function compDayChanges(
    plan: PlanData,
    reference: ReferenceData,
    range: DateRange,
    scopeAssignmentIds: ReadonlySet<string>,
  ): DraftChange[] {
    const index = buildIndex(datasetOf(reference, plan));
    const result = proposeCompDays({
      range,
      assignments: plan.assignments,
      absences: plan.absences,
      existing: plan.compDays,
      index,
      scopeAssignmentIds,
    });

    const changes: DraftChange[] = result.added.map((entry) =>
      compDayChange(null, entry, nextSeq(), new Date().toISOString()),
    );
    // Предложение, потерявшее назначение, снимается молча; подтверждённое —
    // требует решения планировщика и остаётся.
    for (const orphan of result.orphaned) {
      if (orphan.status !== 'PROPOSED') continue;
      changes.push(compDayChange(orphan, null, nextSeq(), new Date().toISOString()));
    }
    return changes;
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
        isWeekend: before?.isWeekend ?? false,
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

  function commitCells(
    cells: readonly CellRef[],
    content: Assignment['content'] | null,
  ): void {
    const changes = cellChanges(cells, content);
    if (changes.length === 0) return;

    const state = get();
    const { reference, plan, range } = state;
    if (!reference || !plan || !range) return;

    // Начисления считаются только за то, что тронула эта правка.
    const touched = new Set<string>();
    for (const change of changes) {
      if (change.targetType === 'ASSIGNMENT' && change.after) touched.add(change.after.id);
    }

    const afterCells = applyChanges(plan, changes);
    commit([...changes, ...compDayChanges(afterCells, reference, range, touched)]);
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

    async load(unitId, range) {
      set({ status: 'loading', error: undefined });
      try {
        const [reference, published] = await Promise.all([
          scheduleRepository.loadReference(),
          scheduleRepository.loadPublished(unitId, range),
        ]);

        // Пока нет аутентификации: первый включённый человек единицы.
        const currentUserId =
          reference.people.find((p) => p.unitId === unitId && p.orgCategory === 'MANAGEMENT')?.id ??
          reference.people.find((p) => p.unitId === unitId)?.id;

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

    acknowledge(issueKey, comment) {
      const { currentUserId, plan, reference, published } = get();
      if (!plan || !reference || !published) return;
      // Подтверждения не проходят через черновик: они относятся к оценке
      // плана, а не к самому плану.
      const acknowledgements = [
        ...plan.acknowledgements.filter((ack) => ack.issueKey !== issueKey),
        {
          issueKey,
          comment,
          byPersonId: currentUserId ?? 'unknown',
          at: new Date().toISOString(),
        },
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
      if (sessionId) void scheduleRepository.removeChanges(sessionId, [...drop]);
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
        const published = await scheduleRepository.loadPublished(unitId, range);
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
