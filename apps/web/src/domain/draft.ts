/**
 * NOTE: A draft is an ordered list of changes — ADR-0015.
 *
 * Every change carries both the previous and the new value. That gets
 * undo/redo almost for free (the inverse change is the same thing with
 * `before`/`after` swapped) and the publish-conflict comparison screen.
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
// Constructors
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
// Application
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
      // NOTE: A cell is a (person, date) pair, holding at most one assignment.
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
// Inversion
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

/** NOTE: Changes that undo the given ones. Order is reversed. */
export function invertAll(changes: readonly DraftChange[]): DraftChange[] {
  return [...changes]
    .sort((a, b) => b.seq - a.seq)
    .map((change, index) => ({ ...invertChange(change), seq: index }));
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

/** NOTE: A change that changes nothing. */
export function isNoop(change: DraftChange): boolean {
  if (change.before === null && change.after === null) return true;
  if (change.targetType === 'ASSIGNMENT' && change.before && change.after) {
    const before = change.before.content;
    const after = change.after.content;
    if (before.kind !== after.kind) return false;
    if (before.kind === 'SHIFT' && after.kind === 'SHIFT') return before.shiftId === after.shiftId;
    if (before.kind === 'MARKER' && after.kind === 'MARKER') return before.marker === after.marker;
  }
  return false;
}

/** NOTE: Summary for the review screen. */
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
