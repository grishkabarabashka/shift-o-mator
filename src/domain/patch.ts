/**
 * Правки плана как список патчей.
 *
 * Каждый патч несёт и предыдущее, и новое значение. Из этого почти бесплатно
 * получается undo/redo: обратный патч — это тот же патч с переставленными
 * `before` и `after`.
 */

import type {
  Absence,
  Acknowledgement,
  Assignment,
  CompDayEntry,
  IsoDate,
  PersonId,
  PlanData,
} from './types.ts';

export type Patch =
  | {
      readonly kind: 'SET_CELL';
      readonly personId: PersonId;
      readonly date: IsoDate;
      readonly before: Assignment | null;
      readonly after: Assignment | null;
    }
  | {
      readonly kind: 'SET_ABSENCE';
      readonly before: Absence | null;
      readonly after: Absence | null;
    }
  | {
      readonly kind: 'SET_COMP_DAY';
      readonly before: CompDayEntry | null;
      readonly after: CompDayEntry | null;
    }
  | {
      readonly kind: 'SET_ACK';
      readonly before: Acknowledgement | null;
      readonly after: Acknowledgement | null;
    };

/** Обратный патч. */
export function invert(patch: Patch): Patch {
  switch (patch.kind) {
    case 'SET_CELL':
      return { ...patch, before: patch.after, after: patch.before };
    case 'SET_ABSENCE':
      return { ...patch, before: patch.after, after: patch.before };
    case 'SET_COMP_DAY':
      return { ...patch, before: patch.after, after: patch.before };
    case 'SET_ACK':
      return { ...patch, before: patch.after, after: patch.before };
  }
}

function replaceById<T extends { id: string }>(
  items: readonly T[],
  before: T | null,
  after: T | null,
): T[] {
  const withoutBefore = before ? items.filter((item) => item.id !== before.id) : [...items];
  if (!after) return withoutBefore;
  const withoutAfter = withoutBefore.filter((item) => item.id !== after.id);
  withoutAfter.push(after);
  return withoutAfter;
}

export function applyPatch(plan: PlanData, patch: Patch): PlanData {
  switch (patch.kind) {
    case 'SET_CELL': {
      // Ячейка — пара (человек, дата), в ней не больше одного назначения.
      const assignments = plan.assignments.filter(
        (assignment) =>
          !(assignment.personId === patch.personId && assignment.date === patch.date),
      );
      if (patch.after) assignments.push(patch.after);
      return { ...plan, assignments };
    }
    case 'SET_ABSENCE':
      return { ...plan, absences: replaceById(plan.absences, patch.before, patch.after) };
    case 'SET_COMP_DAY':
      return { ...plan, compDays: replaceById(plan.compDays, patch.before, patch.after) };
    case 'SET_ACK': {
      const key = (patch.after ?? patch.before)?.issueKey;
      const acknowledgements = plan.acknowledgements.filter((ack) => ack.issueKey !== key);
      if (patch.after) acknowledgements.push(patch.after);
      return { ...plan, acknowledgements };
    }
  }
}

export function applyPatches(plan: PlanData, patches: readonly Patch[]): PlanData {
  return patches.reduce(applyPatch, plan);
}

/** Патчи, отменяющие переданные. Порядок обратный. */
export function invertAll(patches: readonly Patch[]): Patch[] {
  return [...patches].reverse().map(invert);
}

/** Пустой ли патч — ничего не меняет. */
export function isNoop(patch: Patch): boolean {
  if (patch.kind === 'SET_CELL') {
    return patch.before?.roleId === patch.after?.roleId && patch.before?.id === patch.after?.id;
  }
  return patch.before === null && patch.after === null;
}
