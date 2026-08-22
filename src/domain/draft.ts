/**
 * Черновик как упорядоченный список изменений — ADR-0015.
 *
 * Каждое изменение несёт и предыдущее, и новое значение. Из этого почти
 * бесплатно получается undo/redo (обратное изменение — то же самое с
 * переставленными `before`/`after`) и экран сравнения при конфликте
 * публикации.
 */

import type {
  Absence,
  Assignment,
  CompDayEntry,
  DraftChange,
  DraftOp,
  IsoInstant,
  PlanData,
} from './types.ts';

let sequence = 0;

function nextId(): string {
  sequence += 1;
  return `dc-${Date.now().toString(36)}-${sequence}`;
}

function opFor(before: unknown | null, after: unknown | null): DraftOp {
  if (before === null) return 'CREATE';
  if (after === null) return 'DELETE';
  return 'UPDATE';
}

// ---------------------------------------------------------------------------
// Конструкторы
// ---------------------------------------------------------------------------

export function assignmentChange(
  before: Assignment | null,
  after: Assignment | null,
  seq: number,
  at: IsoInstant,
): DraftChange {
  return { id: nextId(), seq, at, targetType: 'ASSIGNMENT', op: opFor(before, after), before, after };
}

export function absenceChange(
  before: Absence | null,
  after: Absence | null,
  seq: number,
  at: IsoInstant,
): DraftChange {
  return { id: nextId(), seq, at, targetType: 'ABSENCE', op: opFor(before, after), before, after };
}

export function compDayChange(
  before: CompDayEntry | null,
  after: CompDayEntry | null,
  seq: number,
  at: IsoInstant,
): DraftChange {
  return { id: nextId(), seq, at, targetType: 'COMP_DAY', op: opFor(before, after), before, after };
}

// ---------------------------------------------------------------------------
// Применение
// ---------------------------------------------------------------------------

function replaceById<T extends { id: string }>(
  items: readonly T[],
  before: T | null,
  after: T | null,
): T[] {
  const removeId = before?.id ?? after?.id;
  const result = removeId === undefined ? [...items] : items.filter((item) => item.id !== removeId);
  if (after) result.push(after);
  return result;
}

export function applyChange(plan: PlanData, change: DraftChange): PlanData {
  switch (change.targetType) {
    case 'ASSIGNMENT': {
      // Ячейка — пара (человек, дата), и в ней не больше одного назначения.
      const anchor = change.after ?? change.before;
      if (!anchor) return plan;
      const assignments = plan.assignments.filter(
        (a) => !(a.personId === anchor.personId && a.date === anchor.date),
      );
      if (change.after) assignments.push(change.after);
      return { ...plan, assignments };
    }
    case 'ABSENCE':
      return { ...plan, absences: replaceById(plan.absences, change.before, change.after) };
    case 'COMP_DAY':
      return { ...plan, compDays: replaceById(plan.compDays, change.before, change.after) };
  }
}

export function applyChanges(plan: PlanData, changes: readonly DraftChange[]): PlanData {
  return [...changes].sort((a, b) => a.seq - b.seq).reduce(applyChange, plan);
}

// ---------------------------------------------------------------------------
// Обращение
// ---------------------------------------------------------------------------

export function invertChange(change: DraftChange): DraftChange {
  const before = change.after;
  const after = change.before;
  const op = opFor(before, after);
  switch (change.targetType) {
    case 'ASSIGNMENT':
      return { ...change, op, before, after } as DraftChange;
    case 'ABSENCE':
      return { ...change, op, before, after } as DraftChange;
    case 'COMP_DAY':
      return { ...change, op, before, after } as DraftChange;
  }
}

/** Изменения, отменяющие переданные. Порядок обратный. */
export function invertAll(changes: readonly DraftChange[]): DraftChange[] {
  return [...changes]
    .sort((a, b) => b.seq - a.seq)
    .map((change, index) => ({ ...invertChange(change), seq: index }));
}

// ---------------------------------------------------------------------------
// Прочее
// ---------------------------------------------------------------------------

/** Изменение, которое ничего не меняет. */
export function isNoop(change: DraftChange): boolean {
  if (change.before === null && change.after === null) return true;
  if (change.targetType === 'ASSIGNMENT' && change.before && change.after) {
    const before = change.before.content;
    const after = change.after.content;
    if (before.kind !== after.kind) return false;
    if (before.kind === 'ROLE' && after.kind === 'ROLE') return before.roleId === after.roleId;
    if (before.kind === 'MARKER' && after.kind === 'MARKER') return before.marker === after.marker;
  }
  return false;
}

/** Сводка для экрана review. */
export interface ChangeSummary {
  readonly created: number;
  readonly updated: number;
  readonly deleted: number;
}

export function summarizeChanges(changes: readonly DraftChange[]): ChangeSummary {
  let created = 0;
  let updated = 0;
  let deleted = 0;
  for (const change of changes) {
    if (change.op === 'CREATE') created += 1;
    else if (change.op === 'UPDATE') updated += 1;
    else deleted += 1;
  }
  return { created, updated, deleted };
}
