/**
 * Черновик графика.
 *
 * Правки идут списком патчей (`Patch`), из чего почти бесплатно получается
 * undo/redo. Серверное состояние и несохранённые правки не смешиваются:
 * `plan` — это база плюс применённые патчи, `pending` — то, что ещё не ушло
 * в репозиторий.
 */

import { create } from 'zustand';
import { scheduleRepository } from '../data/memoryRepository.ts';
import type { LockResult } from '../data/repository.ts';
import { buildIndex, type DatasetIndex } from '../domain/lookup.ts';
import { applyPatches, invertAll, isNoop, type Patch } from '../domain/patch.ts';
import type {
  Absence,
  Assignment,
  CompDayEntry,
  DateRange,
  IsoDate,
  PeriodLock,
  PersonId,
  PlanData,
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
  plan: PlanData | undefined;
  index: DatasetIndex | undefined;

  undoStack: Patch[][];
  redoStack: Patch[][];
  /** Патчи, не ушедшие в репозиторий. */
  pending: Patch[];
  saving: boolean;
  lastSavedAt: string | undefined;

  lock: PeriodLock | undefined;
  lockConflict: PeriodLock | undefined;

  load: (unitId: UnitId, range: DateRange) => Promise<void>;
  setCell: (personId: PersonId, date: IsoDate, roleId: RoleId | null) => void;
  setCells: (cells: readonly CellRef[], roleId: RoleId | null) => void;
  setAbsence: (absence: Absence | null, previous?: Absence) => void;
  /** Несколько отсутствий одним батчем — одна отмена вместо N. */
  setAbsences: (absences: readonly Absence[]) => void;
  setCompDay: (entry: CompDayEntry, previous?: CompDayEntry) => void;
  acknowledge: (issueKey: string, comment: string) => void;
  undo: () => void;
  redo: () => void;
  save: () => Promise<void>;
  acquireLock: () => Promise<LockResult | undefined>;
  releaseLock: () => Promise<void>;
}

let assignmentSeq = 0;

function newAssignmentId(): string {
  assignmentSeq += 1;
  return `as-local-${Date.now().toString(36)}-${assignmentSeq}`;
}

function datasetOf(reference: ReferenceData, plan: PlanData): ScheduleDataset {
  return { ...reference, ...plan };
}

export const useSchedule = create<ScheduleState>((set, get) => {
  /**
   * Применяет батч патчей: обновляет план, индекс, стеки undo/redo и очередь
   * несохранённого. Пустые батчи игнорируются, иначе Ctrl+Z станет
   * непредсказуемым.
   */
  function commit(patches: readonly Patch[], options: { readonly fromUndo?: boolean } = {}): void {
    const meaningful = patches.filter((patch) => !isNoop(patch));
    if (meaningful.length === 0) return;

    const state = get();
    const { reference, plan } = state;
    if (!reference || !plan) return;

    const nextPlan = applyPatches(plan, meaningful);
    set({
      plan: nextPlan,
      index: buildIndex(datasetOf(reference, nextPlan)),
      pending: [...state.pending, ...meaningful],
      ...(options.fromUndo
        ? {}
        : { undoStack: [...state.undoStack, [...meaningful]], redoStack: [] }),
    });
  }

  /**
   * Начисления comp days пересчитываются сразу после правки: планировщик должен
   * видеть последствие своего назначения в тот же момент, а не через неделю.
   * Предложения, потерявшие назначение, снимаются молча; подтверждённые — нет.
   */
  function compDayPatches(plan: PlanData, reference: ReferenceData, range: DateRange): Patch[] {
    const index = buildIndex(datasetOf(reference, plan));
    const result = proposeCompDays({
      range,
      assignments: plan.assignments,
      existing: plan.compDays,
      index,
    });

    const patches: Patch[] = result.added.map((entry) => ({
      kind: 'SET_COMP_DAY',
      before: null,
      after: entry,
    }));

    for (const orphan of result.orphaned) {
      if (orphan.status !== 'PROPOSED') continue;
      patches.push({ kind: 'SET_COMP_DAY', before: orphan, after: null });
    }

    return patches;
  }

  function cellPatches(cells: readonly CellRef[], roleId: RoleId | null): Patch[] {
    const { plan, index, reference, currentUserId } = get();
    if (!plan || !index || !reference) return [];

    const existing = new Map<string, Assignment>();
    for (const assignment of plan.assignments) {
      existing.set(`${assignment.personId}|${assignment.date}`, assignment);
    }

    const patches: Patch[] = [];
    for (const cell of cells) {
      const before = existing.get(`${cell.personId}|${cell.date}`) ?? null;

      if (roleId === null) {
        if (!before) continue;
        patches.push({ kind: 'SET_CELL', ...cell, before, after: null });
        continue;
      }

      // Роль всегда берётся из единицы человека: чужая роль в ячейку не попадёт.
      const person = index.people.get(cell.personId);
      const role = index.roles.get(roleId);
      if (!person || !role || role.unitId !== person.unitId) continue;
      if (before?.roleId === roleId) continue;

      const after: Assignment = {
        id: before?.id ?? newAssignmentId(),
        personId: cell.personId,
        roleId,
        date: cell.date,
        source: 'MANUAL',
        createdBy: currentUserId ?? 'unknown',
        createdAt: new Date().toISOString(),
      };
      patches.push({ kind: 'SET_CELL', ...cell, before, after });
    }

    return patches;
  }

  function commitCells(cells: readonly CellRef[], roleId: RoleId | null): void {
    const patches = cellPatches(cells, roleId);
    if (patches.length === 0) return;

    const state = get();
    const { reference, plan, range } = state;
    if (!reference || !plan || !range) return;

    const afterCells = applyPatches(plan, patches);
    const batch = [...patches, ...compDayPatches(afterCells, reference, range)];
    commit(batch);
  }

  return {
    status: 'idle',
    error: undefined,
    unitId: undefined,
    range: undefined,
    currentUserId: undefined,
    reference: undefined,
    plan: undefined,
    index: undefined,
    undoStack: [],
    redoStack: [],
    pending: [],
    saving: false,
    lastSavedAt: undefined,
    lock: undefined,
    lockConflict: undefined,

    async load(unitId, range) {
      set({ status: 'loading', error: undefined });
      try {
        const [reference, plan] = await Promise.all([
          scheduleRepository.loadReference(),
          scheduleRepository.loadPlan(unitId, range),
        ]);
        const unit = reference.units.find((u) => u.id === unitId);
        set({
          status: 'ready',
          unitId,
          range,
          reference,
          plan,
          index: buildIndex(datasetOf(reference, plan)),
          currentUserId: unit?.plannerPersonIds[0],
          undoStack: [],
          redoStack: [],
          pending: [],
          lock: await scheduleRepository.getLock(unitId, range),
          lockConflict: undefined,
        });

        // Начисления за уже существующие назначения — при первой загрузке
        // их в фикстурах нет.
        const patches = compDayPatches(plan, reference, range);
        if (patches.length > 0) {
          const nextPlan = applyPatches(plan, patches);
          set({ plan: nextPlan, index: buildIndex(datasetOf(reference, nextPlan)) });
        }
      } catch (error) {
        set({ status: 'error', error: error instanceof Error ? error.message : String(error) });
      }
    },

    setCell(personId, date, roleId) {
      commitCells([{ personId, date }], roleId);
    },

    setCells(cells, roleId) {
      commitCells(cells, roleId);
    },

    setAbsence(absence, previous) {
      commit([{ kind: 'SET_ABSENCE', before: previous ?? null, after: absence }]);
    },

    setAbsences(absences) {
      commit(absences.map((absence) => ({ kind: 'SET_ABSENCE', before: null, after: absence })));
    },

    setCompDay(entry, previous) {
      commit([{ kind: 'SET_COMP_DAY', before: previous ?? null, after: entry }]);
    },

    acknowledge(issueKey, comment) {
      const { currentUserId, plan } = get();
      if (!plan) return;
      const before = plan.acknowledgements.find((ack) => ack.issueKey === issueKey) ?? null;
      commit([
        {
          kind: 'SET_ACK',
          before,
          after: {
            issueKey,
            comment,
            byPersonId: currentUserId ?? 'unknown',
            at: new Date().toISOString(),
          },
        },
      ]);
    },

    undo() {
      const state = get();
      const batch = state.undoStack.at(-1);
      if (!batch) return;
      set({ undoStack: state.undoStack.slice(0, -1), redoStack: [...state.redoStack, batch] });
      commit(invertAll(batch), { fromUndo: true });
    },

    redo() {
      const state = get();
      const batch = state.redoStack.at(-1);
      if (!batch) return;
      set({ redoStack: state.redoStack.slice(0, -1), undoStack: [...state.undoStack, batch] });
      commit(batch, { fromUndo: true });
    },

    async save() {
      const { unitId, range, pending, reference } = get();
      if (!unitId || !range || !reference || pending.length === 0) return;
      set({ saving: true });
      try {
        const plan = await scheduleRepository.savePatches(unitId, range, pending);
        set({
          plan,
          index: buildIndex(datasetOf(reference, plan)),
          pending: [],
          saving: false,
          lastSavedAt: new Date().toISOString(),
        });
      } catch (error) {
        set({
          saving: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },

    async acquireLock() {
      const { unitId, range, currentUserId } = get();
      if (!unitId || !range || !currentUserId) return undefined;
      const result = await scheduleRepository.acquireLock(unitId, range, currentUserId);
      if (result.ok) set({ lock: result.lock, lockConflict: undefined });
      else set({ lockConflict: result.heldBy });
      return result;
    },

    async releaseLock() {
      const { unitId, range, currentUserId } = get();
      if (!unitId || !range || !currentUserId) return;
      await scheduleRepository.releaseLock(unitId, range, currentUserId);
      set({ lock: undefined });
    },
  };
});

/** Есть ли несохранённые правки. */
export function hasUnsavedChanges(state: ScheduleState): boolean {
  return state.pending.length > 0;
}
